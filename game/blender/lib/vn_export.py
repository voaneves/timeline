"""glTF (.glb) and .blend export utilities for Blender 5.x."""

from __future__ import annotations

import json
import os
import struct
from typing import Iterable

import bpy


DEFAULT_EXPORT_TYPES = {"MESH", "EMPTY", "ARMATURE"}


def _collect_collection_objects(col: bpy.types.Collection, out: list[bpy.types.Object]) -> None:
    for obj in col.objects:
        if obj not in out:
            out.append(obj)
    for child in col.children:
        _collect_collection_objects(child, out)


def _resolve_export_objects(
    collections: Iterable[bpy.types.Collection | str] | None,
    objects: Iterable[bpy.types.Object | str] | None,
) -> list[bpy.types.Object]:
    """Resolve the list of objects to export from collections/objects arguments."""
    if collections is None and objects is None:
        return [
            obj
            for obj in bpy.context.scene.objects
            if obj.type in DEFAULT_EXPORT_TYPES
            and not any(c.name.startswith("_Preview") for c in obj.users_collection)
        ]

    resolved: list[bpy.types.Object] = []
    if collections is not None:
        for item in collections:
            col = bpy.data.collections.get(item) if isinstance(item, str) else item
            if col is None:
                raise KeyError(f"Collection not found for export: {item!r}")
            _collect_collection_objects(col, resolved)

    if objects is not None:
        for item in objects:
            obj = bpy.data.objects.get(item) if isinstance(item, str) else item
            if obj is None:
                raise KeyError(f"Object not found for export: {item!r}")
            if obj not in resolved:
                resolved.append(obj)

    return resolved


def _mute_palette_tex_nodes(materials: Iterable[bpy.types.Material]) -> list[tuple]:
    """Mute TEX_IMAGE nodes on materials named 'palette' and return restore list."""
    saved: list[tuple] = []
    for mat in materials:
        if mat is None or mat.node_tree is None:
            continue
        lname = mat.name.lower()
        if lname != "palette" and not lname.startswith("palette."):
            continue
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE":
                saved.append((node, node.mute))
                node.mute = True
    return saved


def _restore_muted_nodes(saved: list[tuple]) -> None:
    for node, prev_mute in saved:
        try:
            node.mute = prev_mute
        except ReferenceError:
            pass


def _filter_gltf_kwargs(candidate_kwargs: dict) -> dict:
    """Filter glTF export kwargs dynamically against Blender's operator RNA."""
    rna = bpy.ops.export_scene.gltf.get_rna_type()
    props = rna.properties
    filtered: dict = {}

    for key, value in candidate_kwargs.items():
        if key not in props:
            continue
        prop = props[key]
        if prop.type == "ENUM":
            valid = {item.identifier for item in prop.enum_items}
            if value not in valid:
                continue
        filtered[key] = value
    return filtered


def inspect_glb(filepath: str) -> dict:
    """Read a GLB header and JSON chunk to compute exact exported stats."""
    abs_path = os.path.abspath(filepath)
    with open(abs_path, "rb") as fh:
        data = fh.read()

    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError(f"Not a valid GLB file: {abs_path}")

    total_bytes = struct.unpack_from("<I", data, 8)[0]
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_len].decode("utf-8"))

    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    accessors = gltf.get("accessors", [])
    materials = gltf.get("materials", [])

    tris = 0
    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            if "indices" in prim:
                tris += accessors[prim["indices"]]["count"] // 3
            elif "POSITION" in prim.get("attributes", {}):
                tris += accessors[prim["attributes"]["POSITION"]]["count"] // 3

    return {
        "filepath": abs_path,
        "bytes": total_bytes,
        "nodes": len(nodes),
        "meshes": len(meshes),
        "triangles": tris,
        "materials": len(materials),
        "gltf": gltf,
    }


def export_glb(
    filepath: str,
    collections: Iterable[bpy.types.Collection | str] | None = None,
    objects: Iterable[bpy.types.Object | str] | None = None,
    apply_modifiers: bool = True,
    export_extras: bool = True,
    export_materials: str = "EXPORT",
    export_animations: bool = False,
    mute_palette_textures: bool = True,
    **extra_kwargs,
) -> dict:
    """Export requested collections/objects (or all scene mesh/empty/armature objects) to GLB.

    Inspects Blender's `export_scene.gltf` RNA dynamically so keyword changes across
    Blender 5.x releases never raise TypeError.
    """
    abs_path = os.path.abspath(filepath)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)

    targets = _resolve_export_objects(collections, objects)
    view_layer = bpy.context.view_layer

    prev_selected = [obj for obj in bpy.context.scene.objects if obj.select_get()]
    prev_active = view_layer.objects.active
    prev_hide_select: list[tuple[bpy.types.Object, bool]] = []
    muted_nodes: list[tuple] = []

    try:
        if mute_palette_textures:
            muted_nodes = _mute_palette_tex_nodes(bpy.data.materials)

        bpy.ops.object.select_all(action="DESELECT")
        for obj in targets:
            if obj.hide_select:
                prev_hide_select.append((obj, True))
                obj.hide_select = False
            obj.select_set(True)

        if targets:
            view_layer.objects.active = targets[0]

        has_armature = any(obj.type == "ARMATURE" for obj in targets)
        has_camera = any(obj.type == "CAMERA" for obj in targets)
        has_light = any(obj.type == "LIGHT" for obj in targets)

        candidate_kwargs = {
            "filepath": abs_path,
            "export_format": "GLB",
            "use_selection": True,
            "export_yup": True,
            "export_extras": bool(export_extras),
            "export_apply": bool(apply_modifiers),
            "export_materials": export_materials,
            "export_animations": bool(export_animations),
            "export_skins": bool(export_animations or has_armature),
            "export_cameras": bool(has_camera),
            "export_lights": bool(has_light),
            "export_normals": True,
            "export_texcoords": True,
            "export_tangents": False,
            "export_vertex_color": "MATERIAL",
            "export_all_vertex_colors": True,
        }
        candidate_kwargs.update(extra_kwargs)

        gltf_kwargs = _filter_gltf_kwargs(candidate_kwargs)
        bpy.ops.export_scene.gltf(**gltf_kwargs)
    finally:
        _restore_muted_nodes(muted_nodes)
        bpy.ops.object.select_all(action="DESELECT")
        for obj, prev_hs in prev_hide_select:
            try:
                obj.hide_select = prev_hs
            except ReferenceError:
                pass
        for obj in prev_selected:
            try:
                obj.select_set(True)
            except ReferenceError:
                pass
        try:
            view_layer.objects.active = prev_active
        except ReferenceError:
            pass

    info = inspect_glb(abs_path)
    stats = {
        "filepath": info["filepath"],
        "bytes": info["bytes"],
        "objects": len(targets),
        "nodes": info["nodes"],
        "triangles": info["triangles"],
        "materials": info["materials"],
    }
    print(
        f"[vn_export] {stats['filepath']} | {stats['bytes']} B | "
        f"{stats['objects']} objs ({stats['nodes']} nodes) | "
        f"{stats['triangles']} tris | {stats['materials']} mats"
    )
    return stats


def save_blend(filepath: str, pack: bool = True) -> str:
    """Save the current Blender file cleanly, creating parent directories automatically."""
    abs_path = os.path.abspath(filepath)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    if pack:
        try:
            bpy.ops.file.pack_all()
        except RuntimeError:
            pass
    bpy.ops.wm.save_as_mainfile(filepath=abs_path)
    size = os.path.getsize(abs_path)
    print(f"[vn_export] blend {abs_path} | {size} B")
    return abs_path
