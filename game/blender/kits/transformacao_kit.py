"""Era 5 'Transformação Digital' architectural & environment kit (Phase 3 - T3.T1).

Builds modular dusk-to-warm-night diorama pieces in Blender space (+Z up, +Y forward):
  - `build_arrival_pad`: terraced stone/paper arrival platform (`refRespawnTransformacao`)
  - `build_sebrae_storefront`: SEBRAE small-business vitrine storefront with striped awning,
    glowing display windows, and tiny craft/coffee goods
  - `build_sebrae_counter`: outdoor SEBRAE advisory counter ("balcão do SEBRAE")
  - `build_fairy_light_pole`: dusk plaza lamp post with `fairyGold` bulbs
  - `build_plaza_bench`: wood & charcoal plaza bench
  - `build_dusk_tree`: stylized low-poly dusk/ipê tree (`TransformacaoTree*`)
  - `build_shortcut_pipe`: octagonal copper shortcut pipe (`refPipeContact`)

All visual meshes share the single `'palette'` material via `vn_palette`.
Analytical `cuboid*` colliders are attached under `<Name>PhysicalFixed` parents via `vn_collide`.
"""

from __future__ import annotations

import math
from typing import Iterable

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from kits import platform_kit
from lib import vn_bevel, vn_collide, vn_palette, vn_scene


# ------------------------------------------------------------------ BMesh helpers


def _assign_uv(
    bm: bmesh.types.BMesh,
    faces: Iterable[bmesh.types.BMFace],
    swatch_name: str,
) -> None:
    uv_layer = bm.loops.layers.uv.verify()
    u, v = vn_palette.get_swatch_uv(swatch_name, gltf=False)
    for face in faces:
        for loop in face.loops:
            loop[uv_layer].uv = (u, v)


def _add_box(
    bm: bmesh.types.BMesh,
    size: tuple[float, float, float],
    center: tuple[float, float, float],
    swatch: str,
    rot_euler: tuple[float, float, float] | None = None,
) -> list[bmesh.types.BMFace]:
    sx, sy, sz = size
    mat = Matrix.Translation(Vector(center))
    if rot_euler is not None:
        mat = mat @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
    mat = mat @ Matrix.Diagonal((sx, sy, sz, 1.0))
    ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
    vset = set(ret["verts"])
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    _assign_uv(bm, faces, swatch)
    return faces


def _add_prism(
    bm: bmesh.types.BMesh,
    radius: float,
    height: float,
    center: tuple[float, float, float],
    segments: int,
    swatch: str,
    rot_euler: tuple[float, float, float] | None = None,
    taper_top: float = 1.0,
) -> list[bmesh.types.BMFace]:
    mat = Matrix.Translation(Vector(center))
    if rot_euler is not None:
        mat = mat @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=max(3, int(segments)),
        radius1=float(radius),
        radius2=float(radius) * float(taper_top),
        depth=float(height),
        matrix=mat,
    )
    vset = set(ret["verts"])
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    _assign_uv(bm, faces, swatch)
    return faces


def _add_icosphere(
    bm: bmesh.types.BMesh,
    radius: float,
    center: tuple[float, float, float],
    swatch: str,
    subdivisions: int = 1,
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> list[bmesh.types.BMFace]:
    mat = Matrix.Translation(Vector(center)) @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    ret = bmesh.ops.create_icosphere(
        bm,
        subdivisions=subdivisions,
        radius=float(radius),
        matrix=mat,
    )
    vset = set(ret["verts"])
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    _assign_uv(bm, faces, swatch)
    return faces


def _finalize_bmesh(
    name: str,
    bm: bmesh.types.BMesh,
    collection: bpy.types.Collection,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rot_z_deg: float = 0.0,
    parent: bpy.types.Object | None = None,
    bevel_width: float = 0.0,
) -> bpy.types.Object:
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    if abs(rot_z_deg) > 1e-5:
        obj.rotation_euler = (0.0, 0.0, math.radians(rot_z_deg))
    pal_mat = vn_palette.ensure_palette_material()
    mesh.materials.clear()
    mesh.materials.append(pal_mat)
    vn_scene.link_object(obj, collection)
    if parent is not None:
        obj.parent = parent
    if bevel_width > 0.0:
        vn_bevel.apply_bevel(obj, width=bevel_width, segments=2)
    return obj


def _make_physical_root(
    name: str,
    mode: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
) -> bpy.types.Object:
    suffix = "PhysicalFixed" if mode == "fixed" else "PhysicalKinematic"
    root = bpy.data.objects.new(f"{name}{suffix}", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.5
    root.location = location
    if abs(rot_z_deg) > 1e-5:
        root.rotation_euler = (0.0, 0.0, math.radians(rot_z_deg))
    vn_scene.link_object(root, collection)
    return root


# ------------------------------------------------------------------ Kit pieces


def build_arrival_pad(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
) -> dict[str, bpy.types.Object]:
    """Build the dusk plaza arrival terrace where Victor enters Era 5."""
    bm = bmesh.new()
    _add_prism(bm, 3.6, 0.28, (0.0, 0.0, 0.14), 12, "nightPlum")
    _add_prism(bm, 3.1, 0.08, (0.0, 0.0, 0.30), 12, "paperWarm")
    _add_prism(bm, 1.35, 0.04, (0.0, 0.0, 0.35), 12, "duskCoral")
    # Rim lanterns
    for i in range(4):
        ang = math.radians(45 + i * 90)
        lx, ly = 3.1 * math.cos(ang), 3.1 * math.sin(ang)
        _add_box(bm, (0.18, 0.18, 0.55), (lx, ly, 0.55), "charcoal")
        _add_box(bm, (0.22, 0.22, 0.18), (lx, ly, 0.88), "fairyGold")
    vis = _finalize_bmesh(f"{name}Visual", bm, collection, location=location, rot_z_deg=rot_z_deg, bevel_width=0.012)

    phys = _make_physical_root(name, "fixed", location, collection, rot_z_deg=rot_z_deg)
    vn_collide.add_cuboid(
        f"cuboid{name}Deck",
        (6.4, 6.4, 0.34),
        location=(0.0, 0.0, 0.17),
        parent=phys,
        collection=collection,
        engine_coords=False,
    )
    return {"visual": vis, "physical": phys}


def build_sebrae_storefront(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
    accent: str = "duskCoral",
) -> dict[str, bpy.types.Object]:
    """Build a small-business vitrine storefront for the SEBRAE ALI section."""
    bm = bmesh.new()
    # Plinth & main facade
    _add_box(bm, (5.4, 3.6, 0.24), (0.0, 0.0, 0.12), "concreteShadow")
    _add_box(bm, (5.0, 3.2, 3.4), (0.0, 0.0, 1.94), "paperWarm")
    # Roof cornice & parapet
    _add_box(bm, (5.3, 3.5, 0.32), (0.0, 0.0, 3.80), "nightPlum")
    _add_box(bm, (4.4, 0.22, 0.55), (0.0, -1.55, 4.20), accent)
    # Glowing display vitrine windows on front (-Y)
    _add_box(bm, (1.85, 0.16, 1.55), (-1.25, -1.58, 1.45), "charcoal")
    _add_box(bm, (1.65, 0.20, 1.35), (-1.25, -1.59, 1.45), "fairyGold")
    _add_box(bm, (1.85, 0.16, 1.55), (1.25, -1.58, 1.45), "charcoal")
    _add_box(bm, (1.65, 0.20, 1.35), (1.25, -1.59, 1.45), "windowGlow")
    # Center door
    _add_box(bm, (0.95, 0.16, 2.10), (0.0, -1.58, 1.29), "woodDark")
    _add_box(bm, (0.55, 0.20, 0.85), (0.0, -1.59, 1.72), "fairyGold")
    # Striped awning
    for i in range(7):
        ax = -2.1 + i * 0.70
        sw = accent if i % 2 == 0 else "paper"
        _add_box(bm, (0.68, 1.15, 0.10), (ax, -2.10, 2.65), sw, rot_euler=(math.radians(16), 0.0, 0.0))
    # Outdoor display crate & craft goods
    _add_box(bm, (1.25, 0.65, 0.68), (-1.35, -2.05, 0.58), "wood")
    _add_prism(bm, 0.14, 0.32, (-1.60, -2.05, 1.08), 8, "duskRose")
    _add_box(bm, (0.28, 0.24, 0.26), (-1.20, -2.05, 1.05), "ipeGold")
    _add_prism(bm, 0.13, 0.28, (-0.90, -2.05, 1.06), 8, "dataTeal")

    vis = _finalize_bmesh(f"{name}Visual", bm, collection, location=location, rot_z_deg=rot_z_deg, bevel_width=0.014)
    phys = _make_physical_root(name, "fixed", location, collection, rot_z_deg=rot_z_deg)
    vn_collide.add_cuboid(
        f"cuboid{name}Body",
        (5.2, 3.4, 3.9),
        location=(0.0, 0.0, 1.95),
        parent=phys,
        collection=collection,
        engine_coords=False,
    )
    return {"visual": vis, "physical": phys}


def build_sebrae_counter(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
) -> dict[str, bpy.types.Object]:
    """Build the SEBRAE advisory desk ('balcão do SEBRAE') in front of the storefronts."""
    bm = bmesh.new()
    _add_box(bm, (3.2, 1.1, 0.95), (0.0, 0.0, 0.475), "nightPlum")
    _add_box(bm, (3.4, 1.3, 0.12), (0.0, 0.0, 1.00), "paper")
    _add_box(bm, (2.6, 0.14, 0.55), (0.0, -0.52, 0.52), "duskCoral")
    # Canopy posts + sign header
    _add_box(bm, (0.14, 0.14, 2.35), (-1.45, 0.42, 1.18), "charcoal")
    _add_box(bm, (0.14, 0.14, 2.35), (1.45, 0.42, 1.18), "charcoal")
    _add_box(bm, (3.3, 0.26, 0.55), (0.0, 0.42, 2.35), "dataTeal")
    _add_box(bm, (2.7, 0.30, 0.30), (0.0, 0.42, 2.35), "fairyGold")
    # Laptop/tablet prop on desk
    _add_box(bm, (0.48, 0.34, 0.04), (-0.5, 0.0, 1.08), "charcoal")
    _add_box(bm, (0.48, 0.04, 0.32), (-0.5, 0.16, 1.24), "fairyGold", rot_euler=(math.radians(-18), 0.0, 0.0))

    vis = _finalize_bmesh(f"{name}Visual", bm, collection, location=location, rot_z_deg=rot_z_deg, bevel_width=0.01)
    phys = _make_physical_root(name, "fixed", location, collection, rot_z_deg=rot_z_deg)
    vn_collide.add_cuboid(
        f"cuboid{name}",
        (3.3, 1.2, 1.1),
        location=(0.0, 0.0, 0.55),
        parent=phys,
        collection=collection,
        engine_coords=False,
    )
    return {"visual": vis, "physical": phys}


def build_fairy_light_pole(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    height: float = 3.6,
) -> bpy.types.Object:
    """Build a dusk plaza lamp pole topped with a warm fairyGold lantern."""
    bm = bmesh.new()
    _add_prism(bm, 0.22, 0.24, (0.0, 0.0, 0.12), 8, "charcoal")
    _add_prism(bm, 0.08, height, (0.0, 0.0, height * 0.5), 8, "charcoal")
    _add_box(bm, (0.36, 0.36, 0.36), (0.0, 0.0, height + 0.16), "fairyGold")
    _add_prism(bm, 0.28, 0.18, (0.0, 0.0, height + 0.42), 4, "ink", taper_top=0.25)
    return _finalize_bmesh(name, bm, collection, location=location, bevel_width=0.008)


def build_plaza_bench(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
) -> bpy.types.Object:
    """Build a warm wood & charcoal plaza bench."""
    bm = bmesh.new()
    _add_box(bm, (1.9, 0.62, 0.10), (0.0, 0.0, 0.45), "wood")
    _add_box(bm, (1.9, 0.10, 0.45), (0.0, 0.26, 0.72), "wood")
    _add_box(bm, (0.14, 0.52, 0.44), (-0.78, 0.0, 0.22), "charcoal")
    _add_box(bm, (0.14, 0.52, 0.44), (0.78, 0.0, 0.22), "charcoal")
    return _finalize_bmesh(name, bm, collection, location=location, rot_z_deg=rot_z_deg, bevel_width=0.008)


def build_dusk_tree(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    height: float = 5.0,
    crown_swatch: str = "duskRose",
) -> bpy.types.Object:
    """Build a stylized low-poly dusk/ipê tree for Era 5."""
    bm = bmesh.new()
    trunk_h = height * 0.55
    _add_prism(bm, 0.26, trunk_h, (0.0, 0.0, trunk_h * 0.5), 7, "bark", taper_top=0.65)
    # 3 foliage lobes
    _add_icosphere(bm, height * 0.28, (0.0, 0.0, trunk_h + height * 0.18), crown_swatch, subdivisions=1, scale=(1.15, 1.15, 0.85))
    _add_icosphere(bm, height * 0.20, (-height * 0.16, height * 0.08, trunk_h + height * 0.10), crown_swatch, subdivisions=1)
    _add_icosphere(bm, height * 0.18, (height * 0.16, -height * 0.06, trunk_h + height * 0.12), crown_swatch, subdivisions=1)
    return _finalize_bmesh(name, bm, collection, location=location)


def build_shortcut_pipe(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
) -> dict[str, bpy.types.Object]:
    """Build the copper shortcut pipe to the Hub / Contact area."""
    pipe_vis = platform_kit.make_copper_pipe(name=f"{name}Visual", location=location, collection=collection)
    if abs(rot_z_deg) > 1e-5:
        pipe_vis.rotation_euler = (0.0, 0.0, math.radians(rot_z_deg))
    phys = _make_physical_root(name, "fixed", location, collection, rot_z_deg=rot_z_deg)
    vn_collide.add_cuboid(
        f"cuboid{name}",
        (1.45, 1.45, 1.4),
        location=(0.0, 0.0, 0.70),
        parent=phys,
        collection=collection,
        engine_coords=False,
    )
    return {"visual": pipe_vis, "physical": phys}
