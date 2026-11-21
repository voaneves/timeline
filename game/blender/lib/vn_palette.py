"""Palette lookup, shared 'palette' material setup, and per-face UV swatch assignment.

UV convention (shared with make_palette.py and PaletteCalibration.js):
  - palette.png is a 16x16 grid with row 0 at the top and col 0 at the left.
  - Blender UV space (bottom-left origin):
      u = (col + 0.5) / 16
      v = 1.0 - (row + 0.5) / 16
  - Blender's glTF 2.0 exporter flips V automatically on export (`v_gltf = 1.0 - v_blender`),
    producing `v_gltf = (row + 0.5) / 16`, which matches Three.js `texture.flipY = false`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable

try:
    import bpy
except ImportError:  # pragma: no cover - allows UV lookup outside Blender
    bpy = None  # type: ignore[assignment]

HERE = Path(__file__).resolve().parent
PALETTE_JSON_PATH = HERE.parent / "palette" / "palette.json"
PALETTE_PNG_PATH = HERE.parent.parent / "static" / "palette.png"

_CACHE: dict[Path, dict[str, Any]] = {}


def load_palette(json_path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    """Load and cache palette.json."""
    path = Path(json_path).resolve() if json_path is not None else PALETTE_JSON_PATH.resolve()
    cached = _CACHE.get(path)
    if cached is not None:
        return cached
    data = json.loads(path.read_text(encoding="utf-8"))
    _CACHE[path] = data
    return data


def list_swatches(json_path: str | os.PathLike[str] | None = None) -> list[str]:
    """Return all named swatches defined in palette.json."""
    return list(load_palette(json_path)["swatches"].keys())


def get_swatch(name: str, json_path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    """Return swatch metadata `{col, row, hex, group}` for `name`."""
    swatches = load_palette(json_path)["swatches"]
    if name not in swatches:
        available = ", ".join(sorted(swatches.keys()))
        raise KeyError(f"Unknown palette swatch {name!r}. Available: {available}")
    return swatches[name]


def get_swatch_uv(
    name: str,
    *,
    gltf: bool = False,
    json_path: str | os.PathLike[str] | None = None,
) -> tuple[float, float]:
    """Return the exact center `(u, v)` of swatch `name` in the 16x16 palette grid.

    By default (`gltf=False`) returns Blender UV coordinates (origin bottom-left),
    which glTF export flips to `(u, (row + 0.5) / 16)` automatically.
    Pass `gltf=True` to get glTF / Three.js (`flipY=False`, top-left origin) UVs directly.
    """
    palette = load_palette(json_path)
    size = float(palette.get("size", 16))
    spec = get_swatch(name, json_path=json_path)
    col = float(spec["col"])
    row = float(spec["row"])
    u = (col + 0.5) / size
    v = (row + 0.5) / size if gltf else 1.0 - (row + 0.5) / size
    return (u, v)


def _require_bpy() -> None:
    if bpy is None:
        raise RuntimeError("Blender `bpy` module is required for material and mesh operations")


def ensure_palette_material(
    image_path: str | os.PathLike[str] | None = None,
    *,
    name: str = "palette",
    roughness: float = 0.85,
) -> "bpy.types.Material":
    """Create or reuse the single matte Principled BSDF 'palette' material.

    Uses Closest (nearest-neighbor) interpolation on TEX_IMAGE and roughness 0.85.
    During glTF export, vn_export mutes TEX_IMAGE nodes on 'palette' materials so the
    runtime binds its hashed palette.png texture.
    """
    _require_bpy()
    img_path = Path(image_path).resolve() if image_path is not None else PALETTE_PNG_PATH.resolve()

    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)

    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True

    tree = mat.node_tree
    nodes = tree.nodes
    links = tree.links

    tex_node = next((n for n in nodes if n.type == "TEX_IMAGE"), None)
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    output = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)

    if tex_node is None or bsdf is None or output is None:
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        output.location = (320, 0)

        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.location = (20, 0)

        tex_node = nodes.new("ShaderNodeTexImage")
        tex_node.location = (-320, 0)

        links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
        links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    bsdf.inputs["Roughness"].default_value = float(roughness)
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.1

    tex_node.interpolation = "Closest"
    tex_node.extension = "CLIP"

    if img_path.exists():
        img = bpy.data.images.load(str(img_path), check_existing=True)
        img.colorspace_settings.name = "sRGB"
        tex_node.image = img

    return mat


def _resolve_face_swatch(
    selector_or_name: Any,
    poly: "bpy.types.MeshPolygon",
    slot_names: list[str],
) -> str | None:
    if isinstance(selector_or_name, str):
        return selector_or_name

    if isinstance(selector_or_name, dict):
        idx = poly.material_index
        if idx in selector_or_name:
            return selector_or_name[idx]
        if 0 <= idx < len(slot_names) and slot_names[idx] in selector_or_name:
            return selector_or_name[slot_names[idx]]
        return None

    if (
        isinstance(selector_or_name, tuple)
        and len(selector_or_name) == 2
        and callable(selector_or_name[0])
        and isinstance(selector_or_name[1], str)
    ):
        predicate, swatch_name = selector_or_name
        return swatch_name if predicate(poly) else None

    if callable(selector_or_name):
        result = selector_or_name(poly)
        if isinstance(result, str):
            return result
        return None

    raise TypeError(
        "selector_or_name must be a swatch name (str), a callable(poly) -> str | None, "
        "a dict mapping material slot index/name -> swatch name, or a (predicate, swatch_name) tuple"
    )


def assign(
    obj: "bpy.types.Object",
    selector_or_name: str | Callable[["bpy.types.MeshPolygon"], str | None] | dict[int | str, str] | tuple[Callable[["bpy.types.MeshPolygon"], bool], str],
    *,
    material: "bpy.types.Material | bool | None" = None,
    image_path: str | os.PathLike[str] | None = None,
    uv_layer_name: str = "UVMap",
    json_path: str | os.PathLike[str] | None = None,
) -> int:
    """Assign palette UVs on `obj` and bind the shared 'palette' material.

    `selector_or_name` may be:
      - `str`: assigns every face to that swatch name.
      - `callable(poly) -> str | None`: returns the swatch name per face (or None to leave unchanged).
      - `dict`: maps original material slot index or material name -> swatch name.
      - `(predicate, swatch_name)`: assigns faces where `predicate(poly)` is truthy.

    Pass `material=False` to keep existing material slots unchanged (useful across multiple
    selective `assign()` passes before binding the single palette material).
    Returns the number of polygons updated.
    """
    _require_bpy()
    if obj.type != "MESH" or obj.data is None:
        raise TypeError(f"Expected a MESH object, got {obj.name!r} ({obj.type})")

    mesh = obj.data
    slot_names = [slot.material.name if slot.material else "" for slot in obj.material_slots]

    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        uv_layer = mesh.uv_layers.new(name=uv_layer_name)
        mesh.uv_layers.active = uv_layer

    uv_cache: dict[str, tuple[float, float]] = {}
    updated = 0

    for poly in mesh.polygons:
        swatch_name = _resolve_face_swatch(selector_or_name, poly, slot_names)
        if not swatch_name:
            continue
        uv = uv_cache.get(swatch_name)
        if uv is None:
            uv = get_swatch_uv(swatch_name, gltf=False, json_path=json_path)
            uv_cache[swatch_name] = uv
        for loop_idx in poly.loop_indices:
            uv_layer.data[loop_idx].uv = uv
        updated += 1

    if material is not False:
        pal_mat = material if isinstance(material, bpy.types.Material) else ensure_palette_material(image_path=image_path)
        mesh.materials.clear()
        mesh.materials.append(pal_mat)
        for poly in mesh.polygons:
            poly.material_index = 0

    return updated
