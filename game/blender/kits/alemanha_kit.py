"""Half-timbered Bavarian diorama kit for Era 3b 'Alemanha' (Phase 3 - T3.A1/T3.A3a).

Builds original paper-and-toy diorama landmarks and environment props in the
cool afternoon palette (`timber` #4a3525, `plasterWarm` #ede3ce, `paper` #f4ead4,
`roofRed` #a8432a, `steel` #8d99a6, `steelDark` #616d7a, `ipeGold` #f7c531,
`copper` #b8733a, `windowGlow` #ffe58a, `campusGrass` #5fae4e, `campusGrassDeep` #428738).

All coordinates in this module are Blender space (+Z up, +Y forward) unless
noted otherwise. Every landmark attaches analytical `cuboid*` colliders under
a `<Name>PhysicalFixed` parent via `vn_collide`.
"""

from __future__ import annotations

import math
from typing import Iterable

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from lib import vn_bevel, vn_collide, vn_palette, vn_scene, vn_shapes


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
    verts = ret["verts"]
    vert_set = set(verts)
    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
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
    verts = ret["verts"]
    vert_set = set(verts)
    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
    _assign_uv(bm, faces, swatch)
    return faces


def _add_pitched_roof(
    bm: bmesh.types.BMesh,
    width: float,
    depth: float,
    height: float,
    base_center: tuple[float, float, float],
    swatch: str,
    ridge_along_x: bool = True,
) -> list[bmesh.types.BMFace]:
    """Create a solid triangular-prism pitched roof seated at `base_center` (bottom Z)."""
    cx, cy, cz = base_center
    hw = width * 0.5
    hd = depth * 0.5
    if ridge_along_x:
        pts = [
            Vector((cx - hw, cy - hd, cz)),
            Vector((cx + hw, cy - hd, cz)),
            Vector((cx + hw, cy + hd, cz)),
            Vector((cx - hw, cy + hd, cz)),
            Vector((cx - hw, cy, cz + height)),
            Vector((cx + hw, cy, cz + height)),
        ]
        idx_faces = [
            (0, 3, 2, 1),
            (0, 1, 5, 4),
            (3, 4, 5, 2),
            (0, 4, 3),
            (1, 2, 5),
        ]
    else:
        pts = [
            Vector((cx - hw, cy - hd, cz)),
            Vector((cx + hw, cy - hd, cz)),
            Vector((cx + hw, cy + hd, cz)),
            Vector((cx - hw, cy + hd, cz)),
            Vector((cx, cy - hd, cz + height)),
            Vector((cx, cy + hd, cz + height)),
        ]
        idx_faces = [
            (0, 3, 2, 1),
            (0, 4, 5, 3),
            (1, 2, 5, 4),
            (0, 1, 4),
            (2, 3, 5),
        ]

    bverts = [bm.verts.new(p) for p in pts]
    faces = [bm.faces.new([bverts[i] for i in idxs]) for idxs in idx_faces]
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


def _add_timber_frame_panel(
    bm: bmesh.types.BMesh,
    width: float,
    height: float,
    center: tuple[float, float, float],
    facing: str,
    beam_t: float = 0.14,
    depth_t: float = 0.10,
    diagonal: bool = True,
) -> None:
    """Add exposed half-timbered beams (`timber`) onto a facade plane."""
    cx, cy, cz = center
    hw = width * 0.5
    hh = height * 0.5
    if facing in ("+Y", "-Y"):
        # Horizontal top/bottom/mid beams
        for z_off in (-hh + beam_t * 0.5, 0.0, hh - beam_t * 0.5):
            _add_box(bm, (width, depth_t, beam_t), (cx, cy, cz + z_off), "timber")
        # Vertical posts
        for x_off in (-hw + beam_t * 0.5, 0.0, hw - beam_t * 0.5):
            _add_box(bm, (beam_t, depth_t, height), (cx + x_off, cy, cz), "timber")
        if diagonal:
            diag_len = math.hypot(hw - beam_t, hh - beam_t) * 0.92
            ang = math.atan2(hh, hw)
            _add_box(
                bm,
                (diag_len, depth_t * 0.9, beam_t * 0.8),
                (cx - hw * 0.5, cy, cz - hh * 0.5),
                "timber",
                rot_euler=(0.0, -ang, 0.0),
            )
            _add_box(
                bm,
                (diag_len, depth_t * 0.9, beam_t * 0.8),
                (cx + hw * 0.5, cy, cz - hh * 0.5),
                "timber",
                rot_euler=(0.0, ang, 0.0),
            )
    else:
        for z_off in (-hh + beam_t * 0.5, 0.0, hh - beam_t * 0.5):
            _add_box(bm, (depth_t, width, beam_t), (cx, cy, cz + z_off), "timber")
        for y_off in (-hw + beam_t * 0.5, 0.0, hw - beam_t * 0.5):
            _add_box(bm, (depth_t, beam_t, height), (cx, cy + y_off, cz), "timber")
        if diagonal:
            diag_len = math.hypot(hw - beam_t, hh - beam_t) * 0.92
            ang = math.atan2(hh, hw)
            _add_box(
                bm,
                (depth_t * 0.9, diag_len, beam_t * 0.8),
                (cx, cy - hw * 0.5, cz - hh * 0.5),
                "timber",
                rot_euler=(ang, 0.0, 0.0),
            )
            _add_box(
                bm,
                (depth_t * 0.9, diag_len, beam_t * 0.8),
                (cx, cy + hw * 0.5, cz - hh * 0.5),
                "timber",
                rot_euler=(-ang, 0.0, 0.0),
            )


# ------------------------------------------------------------------ Landmarks


def _make_physical_root(
    name: str,
    body_type: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
) -> bpy.types.Object:
    return vn_collide.wrap_physical_object(
        name,
        None,
        None,
        mass=0.0 if body_type == "fixed" else 8.0,
        body_type=body_type,
        location=location,
        rotation=(0.0, 0.0, math.radians(rot_z_deg)),
        collection=collection,
        engine_coords=False,
    )


def build_airship_landing_pad(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
) -> dict[str, object]:
    """Build the elevated timber & steel airship landing pad + boarding ramp + colliders."""
    phys_root = _make_physical_root(name, "fixed", location, collection, rot_z_deg)

    bm = bmesh.new()
    # Octagonal/wide landing deck at z=1.40 (top surface at z=1.50)
    _add_box(bm, (7.6, 7.6, 0.24), (0.0, 0.0, 1.38), "timber")
    _add_box(bm, (8.0, 8.0, 0.14), (0.0, 0.0, 1.24), "steelDark")
    # Corner support legs
    for sx in (-3.2, 3.2):
        for sy in (-3.2, 3.2):
            _add_box(bm, (0.45, 0.45, 1.30), (sx, sy, 0.65), "steel")
            _add_box(bm, (0.72, 0.72, 0.16), (sx, sy, 0.08), "grayLight")

    # Mooring bollards (`copper` + `ipeGold` caps)
    for bx, by in ((-3.4, -3.4), (3.4, -3.4), (-3.4, 3.4), (3.4, 3.4)):
        _add_prism(bm, 0.20, 0.58, (bx, by, 1.79), 10, "copper")
        _add_prism(bm, 0.25, 0.10, (bx, by, 2.08), 10, "ipeGold")

    # Safety edge rails along N/W/E edges (leave +Y / -Y ramp opening clear)
    _add_box(bm, (7.2, 0.12, 0.55), (0.0, 3.7, 1.78), "steel")
    _add_box(bm, (0.12, 7.2, 0.55), (-3.7, 0.0, 1.78), "steel")
    _add_box(bm, (0.12, 7.2, 0.55), (3.7, 0.0, 1.78), "steel")

    # Wind-sock / beacon mast on NW corner
    _add_prism(bm, 0.10, 3.6, (-3.4, 3.4, 3.30), 8, "steel")
    _add_prism(bm, 0.22, 0.22, (-3.4, 3.4, 5.15), 10, "signalEmissive")
    _add_box(bm, (0.95, 0.18, 0.24), (-2.85, 3.4, 4.75), "signal")

    # Boarding ramp descending along -Y from y=-3.8 to y=-8.2 (z=1.50 down to z=0.02)
    ramp_len = 4.65
    ramp_ang = math.atan2(1.48, 4.40)
    _add_box(
        bm,
        (2.8, ramp_len, 0.22),
        (0.0, -6.0, 0.72),
        "timber",
        rot_euler=(ramp_ang, 0.0, 0.0),
    )
    # Ramp side stringers
    for rx in (-1.35, 1.35):
        _add_box(
            bm,
            (0.14, ramp_len, 0.34),
            (rx, -6.0, 0.85),
            "steelDark",
            rot_euler=(ramp_ang, 0.0, 0.0),
        )

    vis = _finalize_bmesh(
        f"{name}Visual",
        bm,
        collection,
        parent=phys_root,
        bevel_width=0.015,
    )

    # Colliders (local to phys_root, Blender coords -> engine_coords=False)
    vn_collide.add_cuboid(
        f"{name}Deck",
        (8.0, 8.0, 0.30),
        location=(0.0, 0.0, 1.35),
        parent=phys_root,
        collection=collection,
        engine_coords=False,
    )
    vn_collide.add_cuboid(
        f"{name}Ramp",
        (2.8, ramp_len, 0.24),
        location=(0.0, -6.0, 0.72),
        rotation=(ramp_ang, 0.0, 0.0),
        parent=phys_root,
        collection=collection,
        engine_coords=False,
    )

    return {"root": phys_root, "visual": vis}


def build_half_timbered_workshop_clocktower(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
) -> dict[str, object]:
    """Build the hero Half-Timbered Workshop + Clocktower (`refMilestoneAlemanha`)."""
    phys_root = _make_physical_root(name, "fixed", location, collection, rot_z_deg)

    bm = bmesh.new()

    # 1. Workshop main hall (8.4 x 5.8 m)
    # Stone plinth
    _add_box(bm, (8.8, 6.2, 0.55), (0.0, 0.0, 0.275), "grayLight")
    # Ground floor plaster walls
    _add_box(bm, (8.2, 5.6, 2.50), (0.0, 0.0, 1.80), "plasterWarm")
    # Overhanging upper floor (jettying)
    _add_box(bm, (8.7, 6.1, 2.35), (0.0, 0.0, 4.22), "paper")
    # Floor divider timber belt
    _add_box(bm, (8.9, 6.3, 0.22), (0.0, 0.0, 3.04), "timber")

    # Exposed half-timbered framing on front (-Y) and back (+Y)
    _add_timber_frame_panel(bm, 8.2, 2.45, (0.0, -2.82, 1.80), "-Y", diagonal=False)
    _add_timber_frame_panel(bm, 8.7, 2.30, (0.0, -3.07, 4.22), "-Y", diagonal=True)
    _add_timber_frame_panel(bm, 8.7, 2.30, (0.0, 3.07, 4.22), "+Y", diagonal=True)
    _add_timber_frame_panel(bm, 6.1, 2.30, (-4.37, 0.0, 4.22), "-X", diagonal=True)
    _add_timber_frame_panel(bm, 6.1, 2.30, (4.37, 0.0, 4.22), "+X", diagonal=True)

    # Steep Bavarian pitched roof (`roofRed`)
    _add_pitched_roof(bm, 9.5, 6.9, 3.1, (0.0, 0.0, 5.38), "roofRed", ridge_along_x=True)
    # Roof ridge beam & chimney
    _add_box(bm, (9.6, 0.24, 0.24), (0.0, 0.0, 8.48), "timber")
    _add_box(bm, (0.85, 0.85, 2.2), (-2.6, 1.2, 7.6), "brick")
    _add_box(bm, (1.02, 1.02, 0.18), (-2.6, 1.2, 8.75), "grayLight")

    # Front workshop entrance door (-Y) + awning
    _add_box(bm, (1.65, 0.22, 2.10), (-1.1, -2.85, 1.60), "timber")
    _add_box(bm, (1.30, 0.18, 1.90), (-1.1, -2.88, 1.55), "woodDark")
    _add_box(bm, (2.30, 1.15, 0.16), (-1.1, -3.35, 2.75), "roofRed", rot_euler=(0.24, 0.0, 0.0))

    # Glowing workshop windows
    for wx in (1.6, 2.9):
        _add_box(bm, (0.92, 0.16, 1.05), (wx, -2.84, 1.85), "windowGlow")
        _add_box(bm, (1.06, 0.12, 0.12), (wx, -2.88, 1.30), "timber")
    for wx in (-2.7, 0.0, 2.7):
        _add_box(bm, (0.98, 0.16, 1.02), (wx, -3.09, 4.25), "windowGlow")
        _add_box(bm, (1.12, 0.12, 0.12), (wx, -3.14, 3.72), "timber")

    # 2. Attached Clocktower on the right (+X = +5.6, Y = -0.3)
    tx, ty = 5.55, -0.3
    _add_box(bm, (3.2, 3.2, 0.65), (tx, ty, 0.325), "grayLight")
    _add_box(bm, (2.85, 2.85, 7.20), (tx, ty, 4.25), "plasterWarm")
    _add_timber_frame_panel(bm, 2.85, 3.4, (tx, ty - 1.45, 2.40), "-Y", diagonal=True)
    _add_timber_frame_panel(bm, 2.85, 3.4, (tx, ty - 1.45, 6.00), "-Y", diagonal=False)
    _add_timber_frame_panel(bm, 2.85, 3.4, (tx + 1.45, ty, 6.00), "+X", diagonal=False)

    # Clock faces (`ipeGold` ring + `paper` dial + `ink` hands) on -Y and +X
    for face_pos, face_rot in (
        ((tx, ty - 1.50, 6.45), (math.pi * 0.5, 0.0, 0.0)),
        ((tx + 1.50, ty, 6.45), (0.0, math.pi * 0.5, 0.0)),
        ((tx, ty + 1.50, 6.45), (math.pi * 0.5, 0.0, 0.0)),
    ):
        _add_prism(bm, 0.88, 0.14, face_pos, 16, "ipeGold", rot_euler=face_rot)
        _add_prism(bm, 0.72, 0.18, face_pos, 16, "paper", rot_euler=face_rot)
    # Clock hands on front (-Y)
    _add_box(bm, (0.08, 0.10, 0.52), (tx, ty - 1.60, 6.66), "ink")
    _add_box(bm, (0.42, 0.10, 0.08), (tx + 0.18, ty - 1.60, 6.45), "ink")

    # Open belfry & pyramidal spire
    _add_box(bm, (3.15, 3.15, 0.24), (tx, ty, 7.95), "timber")
    for px in (-1.15, 1.15):
        for py in (-1.15, 1.15):
            _add_box(bm, (0.24, 0.24, 1.55), (tx + px, ty + py, 8.85), "timber")
    _add_prism(bm, 0.42, 0.65, (tx, ty, 8.95), 10, "copper")
    # Spire pyramid (4-sided cone rotated 45 deg)
    _add_prism(
        bm,
        2.35,
        3.40,
        (tx, ty, 11.30),
        4,
        "roofRed",
        rot_euler=(0.0, 0.0, math.pi * 0.25),
        taper_top=0.04,
    )
    _add_prism(bm, 0.12, 0.90, (tx, ty, 13.35), 8, "ipeGold")

    vis = _finalize_bmesh(
        f"{name}Visual",
        bm,
        collection,
        parent=phys_root,
        bevel_width=0.015,
    )

    # Colliders
    vn_collide.add_cuboid(
        f"{name}HallBody",
        (8.8, 6.2, 6.0),
        location=(0.0, 0.0, 3.0),
        parent=phys_root,
        collection=collection,
        engine_coords=False,
    )
    vn_collide.add_cuboid(
        f"{name}TowerBody",
        (3.2, 3.2, 9.5),
        location=(tx, ty, 4.75),
        parent=phys_root,
        collection=collection,
        engine_coords=False,
    )

    return {"root": phys_root, "visual": vis}


def build_half_timbered_cottage(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    rot_z_deg: float = 0.0,
    scale: float = 1.0,
) -> dict[str, object]:
    """Build a smaller Bavarian half-timbered cottage to frame the square."""
    phys_root = _make_physical_root(name, "fixed", location, collection, rot_z_deg)
    bm = bmesh.new()
    s = float(scale)
    _add_box(bm, (5.2 * s, 4.2 * s, 0.45 * s), (0.0, 0.0, 0.225 * s), "grayLight")
    _add_box(bm, (4.8 * s, 3.8 * s, 2.4 * s), (0.0, 0.0, 1.65 * s), "plasterWarm")
    _add_timber_frame_panel(bm, 4.8 * s, 2.35 * s, (0.0, -1.92 * s, 1.65 * s), "-Y", diagonal=True)
    _add_timber_frame_panel(bm, 4.8 * s, 2.35 * s, (0.0, 1.92 * s, 1.65 * s), "+Y", diagonal=True)
    _add_pitched_roof(bm, 5.5 * s, 4.5 * s, 2.2 * s, (0.0, 0.0, 2.85 * s), "roofRed", ridge_along_x=True)
    _add_box(bm, (0.9 * s, 0.16 * s, 1.45 * s), (-0.9 * s, -1.94 * s, 1.15 * s), "woodDark")
    _add_box(bm, (0.85 * s, 0.16 * s, 0.85 * s), (1.0 * s, -1.94 * s, 1.75 * s), "windowGlow")

    vis = _finalize_bmesh(f"{name}Visual", bm, collection, parent=phys_root, bevel_width=0.012)
    vn_collide.add_cuboid(
        f"{name}Body",
        (5.2 * s, 4.2 * s, 3.6 * s),
        location=(0.0, 0.0, 1.8 * s),
        parent=phys_root,
        collection=collection,
        engine_coords=False,
    )
    return {"root": phys_root, "visual": vis}


def build_bavarian_pine(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    height: float = 5.2,
    foliage_swatch: str = "campusGrassDeep",
) -> bpy.types.Object:
    """Build a layered paper-cut Bavarian pine tree (tagged `AlemanhaTree*` for foliage merge)."""
    bm = bmesh.new()
    h = float(height)
    _add_prism(bm, 0.24, h * 0.34, (0.0, 0.0, h * 0.17), 8, "timber")
    # 3 stacked conical tiers
    _add_prism(bm, h * 0.30, h * 0.36, (0.0, 0.0, h * 0.42), 9, foliage_swatch, taper_top=0.18)
    _add_prism(bm, h * 0.23, h * 0.32, (0.0, 0.0, h * 0.64), 9, "campusGrass", taper_top=0.14)
    _add_prism(bm, h * 0.15, h * 0.26, (0.0, 0.0, h * 0.84), 9, foliage_swatch, taper_top=0.05)
    return _finalize_bmesh(name, bm, collection, location=location, bevel_width=0.0)


def build_bavarian_fountain(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
) -> dict[str, object]:
    """Build a small octagonal town fountain in the cobblestone square."""
    phys_root = _make_physical_root(name, "fixed", location, collection)
    bm = bmesh.new()
    _add_prism(bm, 1.85, 0.48, (0.0, 0.0, 0.24), 8, "grayLight")
    _add_prism(bm, 1.50, 0.38, (0.0, 0.0, 0.32), 8, "waterOrigens")
    _add_prism(bm, 0.32, 1.45, (0.0, 0.0, 0.95), 8, "grayMid")
    _add_prism(bm, 0.45, 0.25, (0.0, 0.0, 1.75), 8, "copper")
    vis = _finalize_bmesh(f"{name}Visual", bm, collection, parent=phys_root, bevel_width=0.012)
    vn_collide.add_cuboid(
        f"{name}Basin",
        (3.4, 3.4, 0.6),
        location=(0.0, 0.0, 0.3),
        parent=phys_root,
        collection=collection,
        engine_coords=False,
    )
    return {"root": phys_root, "visual": vis}


def build_shortcut_pipe(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
) -> dict[str, object]:
    """Build the copper shortcut pipe with red collar leading to the Central Hub."""
    phys_root = _make_physical_root(name, "fixed", location, collection)
    bm = bmesh.new()
    _add_prism(bm, 0.82, 1.15, (0.0, 0.0, 0.575), 16, "copper")
    _add_prism(bm, 0.94, 0.28, (0.0, 0.0, 1.12), 16, "signal")
    _add_prism(bm, 0.64, 0.12, (0.0, 0.0, 1.24), 16, "ink")
    vis = _finalize_bmesh(f"{name}Visual", bm, collection, parent=phys_root, bevel_width=0.01)
    vn_collide.add_cuboid(
        f"{name}Body",
        (1.75, 1.75, 1.25),
        location=(0.0, 0.0, 0.625),
        parent=phys_root,
        collection=collection,
        engine_coords=False,
    )
    return {"root": phys_root, "visual": vis}
