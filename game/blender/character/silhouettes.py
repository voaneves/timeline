"""T2.A1 — Victor Character Art Direction: 3 Distinct Silhouettes (Gate GA-1).

Builds 3 distinct character silhouette options for Victor based on D3 & PLAN-3D §2.3:
  - Option A ("Classico 2.6 cabecas — D3 Padrao"):
      1.20 m total height, ~0.4615 m head+hair (2.60 heads), medium build,
      crisp forward-swept quiff (topete para frente), structured open jacket with
      collar flare, compact square backpack, dynamic S-curve ribbon-scarf tail.
  - Option B ("Explorador Compacto / Toy Chunky 2.4 cabecas"):
      1.20 m total height, ~0.5000 m head+hair (2.40 heads), rounder head,
      higher wave-like quiff, puffier rolled-sleeve bomber jacket, rounded field
      backpack, wider twin-tail ribbon-scarf.
  - Option C ("Agil / Esguio 2.8 cabecas"):
      1.20 m total height, ~0.4286 m head+hair (2.80 heads), sharper angular
      forward quiff, longer open windbreaker jacket with tilted hem, slim tech
      pack, long sweeping arc ribbon-scarf.

Zero Nintendo trade dress: NO cap, NO overalls, NO mustache, NO white gloves.
All 3 options are rendered in flat ink (#0a0a0a unlit on #f4ead4 paper background)
with orthographic Front + Profile views and reference height/proportion guides to:
  - game/blender/out/previews/t2a1_silhouettes.png
  - game/blender/out/t2a1_silhouettes.glb
"""

from __future__ import annotations

import math
import os
import sys
import tempfile
from typing import Iterable, Sequence

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
BLENDER_ROOT = os.path.dirname(THIS_DIR)
if BLENDER_ROOT not in sys.path:
    sys.path.insert(0, BLENDER_ROOT)

from lib import vn_bevel, vn_scene, vn_shapes


# ------------------------------------------------------------------ constants

INK_HEX = "#0a0a0a"
PAPER_HEX = "#f4ead4"
GUIDE_INK_HEX = "#8c7f68"
ACCENT_GUIDE_HEX = "#b84a39"
TARGET_HEIGHT_M = 1.200


def _hex_to_srgb_tuple(hex_str: str) -> tuple[float, float, float]:
    h = hex_str.lstrip("#")
    return (
        int(h[0:2], 16) / 255.0,
        int(h[2:4], 16) / 255.0,
        int(h[4:6], 16) / 255.0,
    )


def _srgb_to_linear(c: float) -> float:
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def _hex_to_linear_rgba(hex_str: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    r, g, b = _hex_to_srgb_tuple(hex_str)
    return (_srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b), float(alpha))


# ------------------------------------------------------------------ materials


def make_flat_ink_material(name: str = "VN_FlatInk", hex_color: str = INK_HEX) -> bpy.types.Material:
    """Create a pure unlit emission material so silhouettes render as flat ink."""
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    if mat.node_tree is None and hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out_node = nt.nodes.new("ShaderNodeOutputMaterial")
    out_node.location = (260, 0)

    emit_node = nt.nodes.new("ShaderNodeEmission")
    emit_node.location = (0, 0)
    emit_node.inputs["Color"].default_value = _hex_to_linear_rgba(hex_color)
    emit_node.inputs["Strength"].default_value = 1.0

    nt.links.new(emit_node.outputs["Emission"], out_node.inputs["Surface"])
    mat.diffuse_color = _hex_to_linear_rgba(hex_color)
    return mat


def assign_material_recursive(objs: Iterable[bpy.types.Object], mat: bpy.types.Material) -> None:
    for obj in objs:
        if obj.type != "MESH" or obj.data is None:
            continue
        obj.data.materials.clear()
        obj.data.materials.append(mat)


# --------------------------------------------------------- geometry primitives


def _transform_and_finalize(
    obj: bpy.types.Object,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel_width: float = 0.008,
    bevel_segments: int = 2,
) -> bpy.types.Object:
    rot = Euler(
        (
            math.radians(rotation_deg[0]),
            math.radians(rotation_deg[1]),
            math.radians(rotation_deg[2]),
        ),
        "XYZ",
    ).to_matrix().to_4x4()
    trans = Matrix.Translation(Vector(location))
    obj.data.transform(trans @ rot)
    obj.data.update()
    obj.location = (0.0, 0.0, 0.0)
    obj.rotation_euler = (0.0, 0.0, 0.0)
    vn_shapes._ensure_mesh_uvs(obj)
    if bevel_width > 0.0 and bevel_segments > 0:
        vn_bevel.finalize_toy_mesh(
            obj,
            bevel_width=bevel_width,
            bevel_segments=bevel_segments,
            apply=True,
        )
    else:
        vn_bevel.apply_weighted_normals(
            obj,
            weight=50,
            keep_sharp=False,
            face_influence=False,
            apply=True,
        )
    return obj


def make_ellipsoid(
    name: str,
    radii: tuple[float, float, float],
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0),
    segments: int = 12,
    rings: int = 8,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a smooth ellipsoid mesh baked at `location` and `rotation_deg`."""
    bm = bmesh.new()
    try:
        bmesh.ops.create_uvsphere(
            bm,
            u_segments=max(12, int(segments)),
            v_segments=max(8, int(rings)),
            radius=1.0,
        )
        scale_mat = Matrix.Diagonal((float(radii[0]), float(radii[1]), float(radii[2]), 1.0))
        bmesh.ops.transform(bm, matrix=scale_mat, verts=bm.verts)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    obj = bpy.data.objects.new(name, mesh)
    vn_scene.link_object(obj, collection)
    return _transform_and_finalize(
        obj,
        location=location,
        rotation_deg=rotation_deg,
        bevel_width=0.0,
        bevel_segments=0,
    )


def make_tapered_limb(
    name: str,
    p_start: tuple[float, float, float],
    p_end: tuple[float, float, float],
    r_start: tuple[float, float],
    r_end: tuple[float, float],
    segments: int = 8,
    cap_roundness: float = 0.25,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a rounded lofted limb/torso segment between two 3D points with elliptical radii."""
    p0 = Vector(p_start)
    p1 = Vector(p_end)
    axis = p1 - p0
    length = max(axis.length, 1e-4)
    z_dir = axis / length

    ref = Vector((0.0, 1.0, 0.0)) if abs(z_dir.y) < 0.9 else Vector((1.0, 0.0, 0.0))
    x_dir = ref.cross(z_dir).normalized()
    y_dir = z_dir.cross(x_dir).normalized()

    segs = max(8, int(segments))
    bm = bmesh.new()
    try:
        # Profile stations along t in [0, 1], with subtle dome ends
        stations = [
            (-cap_roundness * 0.45, 0.35),
            (-cap_roundness * 0.20, 0.75),
            (0.0, 1.0),
            (0.25, 1.0),
            (0.50, 1.0),
            (0.75, 1.0),
            (1.0, 1.0),
            (1.0 + cap_roundness * 0.20, 0.75),
            (1.0 + cap_roundness * 0.45, 0.35),
        ]
        rings: list[list[bmesh.types.BMVert]] = []
        for t, cap_scale in stations:
            t_clamped = max(0.0, min(1.0, t))
            rx = (r_start[0] * (1.0 - t_clamped) + r_end[0] * t_clamped) * cap_scale
            ry = (r_start[1] * (1.0 - t_clamped) + r_end[1] * t_clamped) * cap_scale
            center = p0 + z_dir * (t * length)
            ring = []
            for s in range(segs):
                ang = (2.0 * math.pi * s) / segs
                pt = center + x_dir * (rx * math.cos(ang)) + y_dir * (ry * math.sin(ang))
                ring.append(bm.verts.new(pt))
            rings.append(ring)

        for r_idx in range(len(rings) - 1):
            ra = rings[r_idx]
            rb = rings[r_idx + 1]
            for s in range(segs):
                sn = (s + 1) % segs
                bm.faces.new((ra[s], rb[s], rb[sn], ra[sn]))

        # Close end caps
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    obj = bpy.data.objects.new(name, mesh)
    vn_scene.link_object(obj, collection)
    vn_shapes._ensure_mesh_uvs(obj)
    vn_bevel.apply_weighted_normals(
        obj,
        weight=50,
        keep_sharp=False,
        face_influence=False,
        apply=True,
    )
    return obj


def make_oriented_box(
    name: str,
    size: tuple[float, float, float],
    location: tuple[float, float, float],
    rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel_width: float = 0.008,
    segments: int = 1,
    pivot: str = "CENTER",
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a beveled box rotated and baked in world space."""
    obj = vn_shapes.make_rounded_box(
        name=name,
        size=size,
        location=(0.0, 0.0, 0.0),
        bevel_width=bevel_width,
        segments=segments,
        pivot=pivot,
        collection=collection,
    )
    rot = Euler(
        (
            math.radians(rotation_deg[0]),
            math.radians(rotation_deg[1]),
            math.radians(rotation_deg[2]),
        ),
        "XYZ",
    ).to_matrix().to_4x4()
    trans = Matrix.Translation(Vector(location))
    obj.data.transform(trans @ rot)
    obj.data.update()
    return obj


def make_lofted_hair_quiff(
    name: str,
    stations: Sequence[tuple[tuple[float, float, float], float, float, float]],
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a sculpted forward-sweeping hair quiff ('topete para frente').

    Each station is `(center_xyz, half_width_x, half_height_z, roll_deg)`.
    The cross-section has a peaked top ridge and softer underside to read crisply
    in both Front and Profile views.
    """
    bm = bmesh.new()
    try:
        # 12-point stylized hair cross-section (peaked crest at top, tucked sides)
        base_profile = [
            (0.00, 1.12),   # top crest peak
            (0.42, 0.95),
            (0.82, 0.62),
            (1.00, 0.15),
            (0.88, -0.38),
            (0.52, -0.78),
            (0.00, -0.92),  # bottom center
            (-0.52, -0.78),
            (-0.88, -0.38),
            (-1.00, 0.15),
            (-0.82, 0.62),
            (-0.42, 0.95),
        ]
        n_prof = len(base_profile)
        centers = [Vector(s[0]) for s in stations]
        n_stat = len(centers)

        rings: list[list[bmesh.types.BMVert]] = []
        world_up = Vector((0.0, 0.0, 1.0))

        for i, (c_tuple, rx, rz, roll_deg) in enumerate(stations):
            c = centers[i]
            if i == 0:
                tangent = (centers[1] - centers[0]).normalized()
            elif i == n_stat - 1:
                tangent = (centers[-1] - centers[-2]).normalized()
            else:
                tangent = (centers[i + 1] - centers[i - 1]).normalized()

            right = tangent.cross(world_up)
            if right.length < 1e-5:
                right = Vector((1.0, 0.0, 0.0))
            else:
                right.normalize()
            up = right.cross(tangent).normalized()

            roll_rad = math.radians(roll_deg)
            cr, sr = math.cos(roll_rad), math.sin(roll_rad)
            r_axis = right * cr + up * sr
            u_axis = -right * sr + up * cr

            ring = []
            for px, pz in base_profile:
                pt = c + r_axis * (px * rx) + u_axis * (pz * rz)
                ring.append(bm.verts.new(pt))
            rings.append(ring)

        for i in range(n_stat - 1):
            ra = rings[i]
            rb = rings[i + 1]
            for p in range(n_prof):
                pn = (p + 1) % n_prof
                bm.faces.new((ra[p], rb[p], rb[pn], ra[pn]))

        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    obj = bpy.data.objects.new(name, mesh)
    vn_scene.link_object(obj, collection)
    vn_shapes._ensure_mesh_uvs(obj)
    vn_bevel.apply_weighted_normals(
        obj,
        weight=50,
        keep_sharp=False,
        face_influence=False,
        apply=True,
    )
    return obj


def make_open_jacket_shell(
    name: str,
    z_bottom: float,
    z_top: float,
    waist_rx: float,
    waist_ry: float,
    chest_rx: float,
    chest_ry: float,
    hem_flare: float,
    front_gap_deg: float,
    tilt_front_z: float,
    collar_height: float,
    collar_flare: float,
    thickness: float,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a stylized open jacket shell with front gap, flared hem, and popped collar.

    In Blender coordinates, character faces -Y (`angle = -pi/2`).
    The open front gap is centered around `-pi/2` so from the Front view you see
    the open jacket lapels framing the inner shirt and waist, and from Profile you
    see the crisp jacket hem tilt and collar silhouette.
    """
    bm = bmesh.new()
    try:
        gap_half = math.radians(front_gap_deg * 0.5)
        # Angle runs from (-pi/2 + gap_half) around the back (+pi/2) to (3*pi/2 - gap_half)
        ang_start = -math.pi * 0.5 + gap_half
        ang_end = 1.5 * math.pi - gap_half
        n_arc = 16

        z_levels = [
            (0.00, 1.00 + hem_flare, 1.00 + hem_flare * 0.85),
            (0.32, 0.98 + hem_flare * 0.35, 0.98 + hem_flare * 0.30),
            (0.68, 1.00, 1.00),
            (1.00, 0.94, 0.92),
        ]

        outer_grid: list[list[bmesh.types.BMVert]] = []
        inner_grid: list[list[bmesh.types.BMVert]] = []

        for t_z, sx_mult, sy_mult in z_levels:
            z_base = z_bottom + (z_top - z_bottom) * t_z
            rx = (waist_rx * (1.0 - t_z) + chest_rx * t_z) * sx_mult
            ry = (waist_ry * (1.0 - t_z) + chest_ry * t_z) * sy_mult

            row_out = []
            row_in = []
            for i in range(n_arc):
                u = i / (n_arc - 1)
                ang = ang_start + (ang_end - ang_start) * u
                ca, sa = math.cos(ang), math.sin(ang)
                # sa is -1 at front (-Y), +1 at back (+Y)
                z_local = z_base + (-sa) * tilt_front_z * (1.0 - t_z * 0.5)

                # Slight lapel outward kick near the front opening edges
                edge_proximity = max(0.0, 1.0 - min(u, 1.0 - u) * 5.5)
                lapel_out = edge_proximity * 0.018 * (0.4 + 0.6 * t_z)

                ox = (rx + thickness + lapel_out) * ca
                oy = (ry + thickness + lapel_out) * sa
                ix = rx * ca
                iy = ry * sa

                row_out.append(bm.verts.new((ox, oy, z_local)))
                row_in.append(bm.verts.new((ix, iy, z_local)))
            outer_grid.append(row_out)
            inner_grid.append(row_in)

        # Connect outer, inner, and boundary side/top/bottom strips
        n_rows = len(z_levels)
        for r in range(n_rows - 1):
            for c in range(n_arc - 1):
                bm.faces.new(
                    (
                        outer_grid[r][c],
                        outer_grid[r][c + 1],
                        outer_grid[r + 1][c + 1],
                        outer_grid[r + 1][c],
                    )
                )
                bm.faces.new(
                    (
                        inner_grid[r][c],
                        inner_grid[r + 1][c],
                        inner_grid[r + 1][c + 1],
                        inner_grid[r][c + 1],
                    )
                )

        # Bottom hem cap (r = 0) and top shoulder rim (r = n_rows - 1)
        for c in range(n_arc - 1):
            bm.faces.new(
                (
                    inner_grid[0][c],
                    inner_grid[0][c + 1],
                    outer_grid[0][c + 1],
                    outer_grid[0][c],
                )
            )
            bm.faces.new(
                (
                    outer_grid[-1][c],
                    outer_grid[-1][c + 1],
                    inner_grid[-1][c + 1],
                    inner_grid[-1][c],
                )
            )

        # Front opening vertical lapel edges (c = 0 and c = n_arc - 1)
        for r in range(n_rows - 1):
            bm.faces.new(
                (
                    outer_grid[r][0],
                    outer_grid[r + 1][0],
                    inner_grid[r + 1][0],
                    inner_grid[r][0],
                )
            )
            bm.faces.new(
                (
                    inner_grid[r][-1],
                    inner_grid[r + 1][-1],
                    outer_grid[r + 1][-1],
                    outer_grid[r][-1],
                )
            )

        # Popped collar around neck/upper jacket (distinct silhouette marker)
        if collar_height > 0.005:
            c_ang_start = -math.pi * 0.5 + gap_half * 1.15
            c_ang_end = 1.5 * math.pi - gap_half * 1.15
            n_col = 12
            col_rx_base = chest_rx * 0.58
            col_ry_base = chest_ry * 0.58
            col_thick = thickness * 0.85

            c_out_bot, c_in_bot = [], []
            c_out_top, c_in_top = [], []
            for i in range(n_col):
                u = i / (n_col - 1)
                ang = c_ang_start + (c_ang_end - c_ang_start) * u
                ca, sa = math.cos(ang), math.sin(ang)

                rx0, ry0 = col_rx_base, col_ry_base
                rx1 = col_rx_base + collar_flare
                ry1 = col_ry_base + collar_flare * 0.85
                z0 = z_top - 0.010
                z1 = z_top + collar_height * (0.85 + 0.15 * sa)

                c_out_bot.append(bm.verts.new(((rx0 + col_thick) * ca, (ry0 + col_thick) * sa, z0)))
                c_in_bot.append(bm.verts.new((rx0 * ca, ry0 * sa, z0)))
                c_out_top.append(bm.verts.new(((rx1 + col_thick) * ca, (ry1 + col_thick) * sa, z1)))
                c_in_top.append(bm.verts.new((rx1 * ca, ry1 * sa, z1)))

            for i in range(n_col - 1):
                bm.faces.new((c_out_bot[i], c_out_bot[i + 1], c_out_top[i + 1], c_out_top[i]))
                bm.faces.new((c_in_bot[i], c_in_top[i], c_in_top[i + 1], c_in_bot[i + 1]))
                bm.faces.new((c_out_top[i], c_out_top[i + 1], c_in_top[i + 1], c_in_top[i]))
                bm.faces.new((c_in_bot[i], c_in_bot[i + 1], c_out_bot[i + 1], c_out_bot[i]))

            bm.faces.new((c_out_bot[0], c_out_top[0], c_in_top[0], c_in_bot[0]))
            bm.faces.new((c_in_bot[-1], c_in_top[-1], c_out_top[-1], c_out_bot[-1]))

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    obj = bpy.data.objects.new(name, mesh)
    vn_scene.link_object(obj, collection)
    vn_shapes._ensure_mesh_uvs(obj)
    vn_bevel.apply_weighted_normals(
        obj,
        weight=50,
        keep_sharp=True,
        face_influence=False,
        apply=True,
    )
    return obj


# --------------------------------------------------- bounds & exact normalization


def compute_collection_bounds(objects: Sequence[bpy.types.Object]) -> tuple[Vector, Vector]:
    """Compute exact world-space bounding box `(mins, maxs)` across all meshes in `objects`."""
    mins = Vector((math.inf, math.inf, math.inf))
    maxs = Vector((-math.inf, -math.inf, -math.inf))

    for obj in objects:
        if obj.type != "MESH" or obj.data is None or len(obj.data.vertices) == 0:
            continue
        n_v = len(obj.data.vertices)
        coords = np.empty(n_v * 3, dtype=np.float64)
        obj.data.vertices.foreach_get("co", coords)
        pts = coords.reshape((n_v, 3))
        mat = obj.matrix_world
        # Since we bake transforms into mesh data (location=0, scale=1), fast path when identity
        if mat == Matrix.Identity(4):
            p_min = pts.min(axis=0)
            p_max = pts.max(axis=0)
        else:
            transformed = np.array([tuple(mat @ Vector(p)) for p in pts], dtype=np.float64)
            p_min = transformed.min(axis=0)
            p_max = transformed.max(axis=0)

        mins.x = min(mins.x, float(p_min[0]))
        mins.y = min(mins.y, float(p_min[1]))
        mins.z = min(mins.z, float(p_min[2]))
        maxs.x = max(maxs.x, float(p_max[0]))
        maxs.y = max(maxs.y, float(p_max[1]))
        maxs.z = max(maxs.z, float(p_max[2]))

    return mins, maxs


def normalize_character_height_and_calibrate_head(
    all_objs: Sequence[bpy.types.Object],
    head_objs: Sequence[bpy.types.Object],
    target_height: float,
    target_heads_ratio: float,
    x_offset: float = 0.0,
) -> dict:
    """Ensure the character sits on z=0, has exact total height `target_height` (1.200 m),
    and its head+hair crown segment matches `target_height / target_heads_ratio`.
    """
    # 1. Ground body and normalize overall height to target_height first
    mins, maxs = compute_collection_bounds(all_objs)
    cur_h = max(maxs.z - mins.z, 1e-5)
    body_scale_z = target_height / cur_h

    body_set = [o for o in all_objs if o not in head_objs]
    for obj in all_objs:
        if obj.type != "MESH" or obj.data is None:
            continue
        obj.data.transform(Matrix.Translation((0.0, 0.0, -mins.z)))
        obj.data.transform(Matrix.Diagonal((1.0, 1.0, body_scale_z, 1.0)))
        obj.data.update()

    # 2. Measure head+hair group and calibrate its vertical span + top alignment at z = target_height
    h_mins, h_maxs = compute_collection_bounds(head_objs)
    cur_head_h = max(h_maxs.z - h_mins.z, 1e-5)
    desired_head_h = target_height / float(target_heads_ratio)
    head_z_scale = desired_head_h / cur_head_h
    desired_chin_z = target_height - desired_head_h

    for obj in head_objs:
        if obj.type != "MESH" or obj.data is None:
            continue
        # Scale relative to chin base (h_mins.z) then place chin at desired_chin_z
        obj.data.transform(Matrix.Translation((0.0, 0.0, -h_mins.z)))
        obj.data.transform(Matrix.Diagonal((1.0, 1.0, head_z_scale, 1.0)))
        obj.data.transform(Matrix.Translation((0.0, 0.0, desired_chin_z)))
        obj.data.update()

    # Ensure no body object pokes above target_height or below 0.0
    b_mins, b_maxs = compute_collection_bounds(body_set)
    if b_mins.z < -1e-5:
        for obj in body_set:
            obj.data.transform(Matrix.Translation((0.0, 0.0, -b_mins.z)))
            obj.data.update()

    # 3. Translate character to its assigned world X offset if requested
    if abs(x_offset) > 1e-6:
        for obj in all_objs:
            if obj.type != "MESH" or obj.data is None:
                continue
            obj.data.transform(Matrix.Translation((float(x_offset), 0.0, 0.0)))
            obj.data.update()

    final_mins, final_maxs = compute_collection_bounds(all_objs)
    final_h_mins, final_h_maxs = compute_collection_bounds(head_objs)

    total_h = float(final_maxs.z - final_mins.z)
    head_h = float(final_h_maxs.z - final_h_mins.z)
    ratio = total_h / max(head_h, 1e-6)

    return {
        "total_height_m": total_h,
        "head_height_m": head_h,
        "head_to_body_ratio": ratio,
        "chin_z_m": float(final_h_mins.z),
        "crown_z_m": float(final_h_maxs.z),
        "width_x_m": float(final_maxs.x - final_mins.x),
        "depth_y_m": float(final_maxs.y - final_mins.y),
    }


# --------------------------------------------------------- 3 Victor silhouettes


def build_option_a(collection: bpy.types.Collection, x_offset: float = 0.0) -> tuple[list[bpy.types.Object], dict]:
    """Option A — 'Clássico 2.6 cabeças (D3 Padrão)'.

    - 1.20 m tall, head+hair ~0.4615 m (2.60 heads).
    - Crisp forward-swept quiff ('topete para frente' — signature silhouette mark).
    - Structured open jacket with flared collar over paper tee.
    - Compact square backpack.
    - Dynamic S-curve ribbon-scarf tail extending behind (+Y) and slightly to the side (+X).
    """
    all_objs: list[bpy.types.Object] = []
    head_objs: list[bpy.types.Object] = []

    # --- Shoes & Feet (z: 0.00 -> 0.095 m, facing -Y) ---
    for side, sx in (("L", -0.088), ("R", 0.088)):
        yaw = -7.0 if side == "L" else 7.0
        sole = make_oriented_box(
            f"OptA_ShoeSole_{side}",
            size=(0.092, 0.195, 0.032),
            location=(sx, -0.028, 0.016),
            rotation_deg=(0.0, 0.0, yaw),
            bevel_width=0.008,
            collection=collection,
        )
        upper = make_ellipsoid(
            f"OptA_ShoeUpper_{side}",
            radii=(0.046, 0.092, 0.044),
            location=(sx, -0.024, 0.048),
            rotation_deg=(6.0, 0.0, yaw),
            collection=collection,
        )
        cuff = make_oriented_box(
            f"OptA_ShoeCuff_{side}",
            size=(0.072, 0.076, 0.036),
            location=(sx, 0.006, 0.082),
            rotation_deg=(0.0, 0.0, yaw),
            bevel_width=0.010,
            collection=collection,
        )
        all_objs.extend([sole, upper, cuff])

    # --- Legs & Trousers (z: 0.08 -> 0.37 m) ---
    for side, sx in (("L", -0.086), ("R", 0.086)):
        shin = make_tapered_limb(
            f"OptA_Shin_{side}",
            p_start=(sx, 0.004, 0.085),
            p_end=(sx * 0.94, -0.004, 0.235),
            r_start=(0.038, 0.040),
            r_end=(0.044, 0.046),
            collection=collection,
        )
        thigh = make_tapered_limb(
            f"OptA_Thigh_{side}",
            p_start=(sx * 0.94, -0.004, 0.225),
            p_end=(sx * 0.82, 0.002, 0.375),
            r_start=(0.045, 0.047),
            r_end=(0.054, 0.056),
            collection=collection,
        )
        all_objs.extend([shin, thigh])

    pelvis = make_ellipsoid(
        "OptA_Pelvis",
        radii=(0.118, 0.086, 0.068),
        location=(0.0, 0.004, 0.375),
        collection=collection,
    )
    all_objs.append(pelvis)

    # --- Inner T-Shirt Torso & Neck (z: 0.37 -> 0.76 m) ---
    torso = make_tapered_limb(
        "OptA_TorsoTee",
        p_start=(0.0, 0.002, 0.380),
        p_end=(0.0, 0.000, 0.680),
        r_start=(0.105, 0.078),
        r_end=(0.128, 0.088),
        segments=12,
        collection=collection,
    )
    neck = make_tapered_limb(
        "OptA_Neck",
        p_start=(0.0, -0.004, 0.665),
        p_end=(0.0, -0.008, 0.785),
        r_start=(0.048, 0.048),
        r_end=(0.045, 0.045),
        segments=10,
        collection=collection,
    )
    all_objs.extend([torso, neck])

    # --- Structured Open Jacket with Collar Flare (z: 0.35 -> 0.73 m) ---
    jacket = make_open_jacket_shell(
        "OptA_Jacket",
        z_bottom=0.355,
        z_top=0.685,
        waist_rx=0.118,
        waist_ry=0.088,
        chest_rx=0.136,
        chest_ry=0.096,
        hem_flare=0.14,
        front_gap_deg=54.0,
        tilt_front_z=-0.014,
        collar_height=0.052,
        collar_flare=0.032,
        thickness=0.022,
        collection=collection,
    )
    all_objs.append(jacket)

    # --- Arms & Bare Hands (A-pose with lively elbow bend, clear of torso in Front view) ---
    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        sh_x = s_sign * 0.142
        el_x = s_sign * 0.215
        wr_x = s_sign * 0.248
        upper_arm = make_tapered_limb(
            f"OptA_UpperArm_{side}",
            p_start=(sh_x, 0.004, 0.650),
            p_end=(el_x, 0.016, 0.515),
            r_start=(0.044, 0.044),
            r_end=(0.039, 0.039),
            collection=collection,
        )
        forearm = make_tapered_limb(
            f"OptA_Forearm_{side}",
            p_start=(el_x, 0.016, 0.515),
            p_end=(wr_x, -0.028, 0.395),
            r_start=(0.040, 0.040),
            r_end=(0.031, 0.031),
            collection=collection,
        )
        cuff_ring = make_ellipsoid(
            f"OptA_SleeveCuff_{side}",
            radii=(0.038, 0.038, 0.018),
            location=(wr_x * 0.98, -0.022, 0.410),
            rotation_deg=(12.0, s_sign * 14.0, 0.0),
            collection=collection,
        )
        hand = make_ellipsoid(
            f"OptA_Hand_{side}",
            radii=(0.028, 0.034, 0.038),
            location=(wr_x * 1.01, -0.036, 0.362),
            rotation_deg=(10.0, s_sign * 10.0, 0.0),
            collection=collection,
        )
        thumb = make_ellipsoid(
            f"OptA_Thumb_{side}",
            radii=(0.012, 0.018, 0.014),
            location=(wr_x * 0.92, -0.054, 0.368),
            rotation_deg=(20.0, 0.0, s_sign * -25.0),
            collection=collection,
        )
        all_objs.extend([upper_arm, forearm, cuff_ring, hand, thumb])

    # --- Compact Square Backpack (on back +Y, crisp silhouette step) ---
    pack_main = make_oriented_box(
        "OptA_BackpackMain",
        size=(0.205, 0.115, 0.235),
        location=(0.0, 0.145, 0.555),
        rotation_deg=(-6.0, 0.0, 0.0),
        bevel_width=0.018,
        segments=2,
        collection=collection,
    )
    pack_pocket = make_oriented_box(
        "OptA_BackpackPocket",
        size=(0.165, 0.045, 0.110),
        location=(0.0, 0.205, 0.515),
        rotation_deg=(-6.0, 0.0, 0.0),
        bevel_width=0.012,
        segments=1,
        collection=collection,
    )
    all_objs.extend([pack_main, pack_pocket])

    # --- Ribbon-Scarf ("Cachecol-Fita" — piece of the Line) ---
    # Neck wrap loop + dynamic S-curve tail extending behind (+Y) and right (+X)
    scarf_neck = make_ellipsoid(
        "OptA_ScarfCollar",
        radii=(0.088, 0.086, 0.034),
        location=(0.0, -0.004, 0.698),
        rotation_deg=(6.0, 0.0, 0.0),
        collection=collection,
    )
    scarf_tail_pts = [
        (0.02, 0.060, 0.695),
        (0.11, 0.135, 0.680),
        (0.19, 0.215, 0.625),
        (0.25, 0.285, 0.595),
        (0.30, 0.345, 0.642),
        (0.33, 0.385, 0.625),
    ]
    scarf_tail = vn_shapes.make_ribbon(
        "OptA_ScarfTail",
        points=scarf_tail_pts,
        width=0.080,
        thickness=0.016,
        step=0.075,
        elevation=0.0,
        bevel_width=0.004,
        collection=collection,
    )
    all_objs.extend([scarf_neck, scarf_tail])

    # --- Head + Signature Forward Quiff ("Topete para frente", z: 0.7385 -> 1.200 m) ---
    cranium = make_ellipsoid(
        "OptA_HeadCranium",
        radii=(0.156, 0.162, 0.165),
        location=(0.0, -0.008, 0.912),
        rotation_deg=(3.0, 0.0, 0.0),
        collection=collection,
    )
    jaw = make_ellipsoid(
        "OptA_HeadJaw",
        radii=(0.128, 0.126, 0.105),
        location=(0.0, -0.025, 0.844),
        rotation_deg=(6.0, 0.0, 0.0),
        collection=collection,
    )
    nose = make_ellipsoid(
        "OptA_Nose",
        radii=(0.022, 0.032, 0.024),
        location=(0.0, -0.172, 0.888),
        rotation_deg=(-10.0, 0.0, 0.0),
        collection=collection,
    )
    head_objs.extend([cranium, jaw, nose])

    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        ear = make_ellipsoid(
            f"OptA_Ear_{side}",
            radii=(0.026, 0.034, 0.044),
            location=(s_sign * 0.158, 0.004, 0.892),
            rotation_deg=(0.0, s_sign * -12.0, s_sign * 10.0),
            collection=collection,
        )
        head_objs.append(ear)

    # Hair back/side cap + unmistakable forward-sweeping quiff tip projecting over forehead (-Y)
    hair_cap = make_ellipsoid(
        "OptA_HairCap",
        radii=(0.166, 0.170, 0.152),
        location=(0.0, 0.014, 0.952),
        rotation_deg=(-12.0, 0.0, 0.0),
        collection=collection,
    )
    hair_nape = make_ellipsoid(
        "OptA_HairNape",
        radii=(0.132, 0.075, 0.085),
        location=(0.0, 0.128, 0.875),
        rotation_deg=(24.0, 0.0, 0.0),
        collection=collection,
    )
    quiff_main = make_lofted_hair_quiff(
        "OptA_HairQuiffMain",
        stations=[
            ((0.000, 0.105, 1.015), 0.125, 0.055, 0.0),
            ((-0.010, 0.010, 1.075), 0.130, 0.078, 6.0),
            ((-0.032, -0.095, 1.125), 0.112, 0.086, 12.0),
            ((-0.064, -0.195, 1.160), 0.078, 0.066, 18.0),
            ((-0.098, -0.268, 1.182), 0.034, 0.030, 24.0),
        ],
        collection=collection,
    )
    quiff_side = make_lofted_hair_quiff(
        "OptA_HairQuiffSideCrest",
        stations=[
            ((0.045, 0.025, 1.045), 0.075, 0.042, -12.0),
            ((0.068, -0.075, 1.095), 0.066, 0.048, -16.0),
            ((0.088, -0.168, 1.132), 0.032, 0.026, -22.0),
        ],
        collection=collection,
    )
    head_objs.extend([hair_cap, hair_nape, quiff_main, quiff_side])

    all_objs.extend(head_objs)
    metrics = normalize_character_height_and_calibrate_head(
        all_objs=all_objs,
        head_objs=head_objs,
        target_height=TARGET_HEIGHT_M,
        target_heads_ratio=2.60,
        x_offset=x_offset,
    )
    return all_objs, metrics


def build_option_b(collection: bpy.types.Collection, x_offset: float = 0.0) -> tuple[list[bpy.types.Object], dict]:
    """Option B — 'Explorador Compacto / Toy Chunky 2.4 cabeças'.

    - 1.20 m tall, head+hair ~0.5000 m (2.40 heads).
    - Rounder head with a bold wave-like pompadour/quiff.
    - Puffier bomber jacket with wide rolled-sleeve cuffs and wider stance.
    - Rounded dome field backpack with sleeping-roll cylinder on top.
    - Wider twin-tail ribbon-scarf fanning out on both sides and behind.
    """
    all_objs: list[bpy.types.Object] = []
    head_objs: list[bpy.types.Object] = []

    # --- Chunky Toy Sneakers (wider stance, bulky rounded toe box) ---
    for side, sx in (("L", -0.106), ("R", 0.106)):
        yaw = -11.0 if side == "L" else 11.0
        sole = make_oriented_box(
            f"OptB_ShoeSole_{side}",
            size=(0.114, 0.215, 0.040),
            location=(sx, -0.030, 0.020),
            rotation_deg=(0.0, 0.0, yaw),
            bevel_width=0.012,
            collection=collection,
        )
        upper = make_ellipsoid(
            f"OptB_ShoeUpper_{side}",
            radii=(0.058, 0.104, 0.055),
            location=(sx, -0.025, 0.058),
            rotation_deg=(5.0, 0.0, yaw),
            collection=collection,
        )
        tongue = make_oriented_box(
            f"OptB_ShoeTongue_{side}",
            size=(0.088, 0.088, 0.042),
            location=(sx, 0.002, 0.095),
            rotation_deg=(8.0, 0.0, yaw),
            bevel_width=0.014,
            collection=collection,
        )
        all_objs.extend([sole, upper, tongue])

    # --- Shorter, Sturdier Legs & Rolled Cuffs (z: 0.09 -> 0.34 m) ---
    for side, sx in (("L", -0.102), ("R", 0.102)):
        pant_cuff = make_ellipsoid(
            f"OptB_PantRoll_{side}",
            radii=(0.056, 0.056, 0.024),
            location=(sx, 0.002, 0.115),
            collection=collection,
        )
        leg = make_tapered_limb(
            f"OptB_Leg_{side}",
            p_start=(sx, 0.002, 0.105),
            p_end=(sx * 0.85, 0.004, 0.345),
            r_start=(0.050, 0.052),
            r_end=(0.064, 0.066),
            collection=collection,
        )
        all_objs.extend([pant_cuff, leg])

    pelvis = make_ellipsoid(
        "OptB_Pelvis",
        radii=(0.142, 0.108, 0.075),
        location=(0.0, 0.005, 0.345),
        collection=collection,
    )
    all_objs.append(pelvis)

    # --- Chunky Torso & Puffy Bomber Jacket (z: 0.33 -> 0.67 m) ---
    torso = make_tapered_limb(
        "OptB_TorsoTee",
        p_start=(0.0, 0.002, 0.340),
        p_end=(0.0, 0.000, 0.650),
        r_start=(0.128, 0.098),
        r_end=(0.148, 0.108),
        segments=12,
        collection=collection,
    )
    neck = make_tapered_limb(
        "OptB_Neck",
        p_start=(0.0, -0.004, 0.620),
        p_end=(0.0, -0.006, 0.775),
        r_start=(0.058, 0.058),
        r_end=(0.055, 0.055),
        segments=10,
        collection=collection,
    )
    bomber = make_open_jacket_shell(
        "OptB_PuffyBomber",
        z_bottom=0.330,
        z_top=0.645,
        waist_rx=0.152,
        waist_ry=0.115,
        chest_rx=0.172,
        chest_ry=0.126,
        hem_flare=0.22,
        front_gap_deg=46.0,
        tilt_front_z=0.004,
        collar_height=0.044,
        collar_flare=0.022,
        thickness=0.036,
        collection=collection,
    )
    all_objs.extend([torso, neck, bomber])

    # --- Puffy Arms with Pronounced Rolled Forearm Sleeves ---
    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        sh_x = s_sign * 0.172
        el_x = s_sign * 0.258
        wr_x = s_sign * 0.295
        puffy_sleeve = make_tapered_limb(
            f"OptB_PuffySleeve_{side}",
            p_start=(sh_x, 0.006, 0.605),
            p_end=(el_x, 0.018, 0.475),
            r_start=(0.060, 0.060),
            r_end=(0.056, 0.056),
            collection=collection,
        )
        rolled_cuff = make_ellipsoid(
            f"OptB_RolledSleeveCuff_{side}",
            radii=(0.064, 0.064, 0.032),
            location=(el_x * 1.01, 0.014, 0.470),
            rotation_deg=(10.0, s_sign * 22.0, 0.0),
            collection=collection,
        )
        forearm = make_tapered_limb(
            f"OptB_Forearm_{side}",
            p_start=(el_x, 0.014, 0.465),
            p_end=(wr_x, -0.025, 0.360),
            r_start=(0.042, 0.042),
            r_end=(0.035, 0.035),
            collection=collection,
        )
        hand = make_ellipsoid(
            f"OptB_Hand_{side}",
            radii=(0.034, 0.038, 0.042),
            location=(wr_x * 1.01, -0.034, 0.328),
            rotation_deg=(10.0, s_sign * 12.0, 0.0),
            collection=collection,
        )
        thumb = make_ellipsoid(
            f"OptB_Thumb_{side}",
            radii=(0.014, 0.020, 0.016),
            location=(wr_x * 0.92, -0.054, 0.335),
            rotation_deg=(20.0, 0.0, s_sign * -25.0),
            collection=collection,
        )
        all_objs.extend([puffy_sleeve, rolled_cuff, forearm, hand, thumb])

    # --- Rounded Field Backpack with Top Gear Roll ---
    pack_dome = make_ellipsoid(
        "OptB_FieldPackMain",
        radii=(0.138, 0.095, 0.145),
        location=(0.0, 0.168, 0.495),
        rotation_deg=(-8.0, 0.0, 0.0),
        collection=collection,
    )
    pack_roll = make_tapered_limb(
        "OptB_FieldPackRoll",
        p_start=(-0.115, 0.155, 0.618),
        p_end=(0.115, 0.155, 0.618),
        r_start=(0.042, 0.042),
        r_end=(0.042, 0.042),
        collection=collection,
    )
    all_objs.extend([pack_dome, pack_roll])

    # --- Wider Twin-Tail Ribbon-Scarf ---
    scarf_collar = make_ellipsoid(
        "OptB_ScarfCollar",
        radii=(0.108, 0.104, 0.042),
        location=(0.0, -0.002, 0.655),
        rotation_deg=(5.0, 0.0, 0.0),
        collection=collection,
    )
    tail_main = vn_shapes.make_ribbon(
        "OptB_ScarfTailA",
        points=[
            (0.05, 0.070, 0.650),
            (0.15, 0.165, 0.628),
            (0.23, 0.265, 0.560),
            (0.29, 0.350, 0.580),
        ],
        width=0.102,
        thickness=0.020,
        step=0.075,
        elevation=0.0,
        bevel_width=0.005,
        collection=collection,
    )
    tail_second = vn_shapes.make_ribbon(
        "OptB_ScarfTailB",
        points=[
            (-0.05, 0.070, 0.645),
            (-0.15, 0.155, 0.590),
            (-0.22, 0.245, 0.495),
            (-0.26, 0.320, 0.468),
        ],
        width=0.090,
        thickness=0.018,
        step=0.075,
        elevation=0.0,
        bevel_width=0.005,
        collection=collection,
    )
    all_objs.extend([scarf_collar, tail_main, tail_second])

    # --- Head + Rounded Wave-Like Forward Quiff (2.4 heads -> 0.500 m head height) ---
    cranium = make_ellipsoid(
        "OptB_HeadCranium",
        radii=(0.182, 0.184, 0.176),
        location=(0.0, -0.008, 0.875),
        rotation_deg=(2.0, 0.0, 0.0),
        collection=collection,
    )
    cheeks = make_ellipsoid(
        "OptB_HeadCheeks",
        radii=(0.168, 0.152, 0.115),
        location=(0.0, -0.022, 0.812),
        rotation_deg=(5.0, 0.0, 0.0),
        collection=collection,
    )
    nose = make_ellipsoid(
        "OptB_Nose",
        radii=(0.026, 0.034, 0.026),
        location=(0.0, -0.192, 0.850),
        collection=collection,
    )
    head_objs.extend([cranium, cheeks, nose])

    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        ear = make_ellipsoid(
            f"OptB_Ear_{side}",
            radii=(0.032, 0.038, 0.048),
            location=(s_sign * 0.184, 0.002, 0.855),
            rotation_deg=(0.0, s_sign * -14.0, s_sign * 12.0),
            collection=collection,
        )
        head_objs.append(ear)

    hair_cap = make_ellipsoid(
        "OptB_HairCap",
        radii=(0.192, 0.194, 0.162),
        location=(0.0, 0.015, 0.920),
        rotation_deg=(-10.0, 0.0, 0.0),
        collection=collection,
    )
    # High wave-like curling quiff ("topete onda alta")
    wave_quiff = make_lofted_hair_quiff(
        "OptB_HairWaveQuiff",
        stations=[
            ((0.000, 0.115, 0.990), 0.148, 0.068, 0.0),
            ((0.015, 0.005, 1.068), 0.158, 0.096, 8.0),
            ((0.042, -0.105, 1.138), 0.138, 0.104, 16.0),
            ((0.075, -0.205, 1.178), 0.098, 0.082, 22.0),
            ((0.108, -0.258, 1.152), 0.048, 0.042, 28.0),
        ],
        collection=collection,
    )
    side_puff_l = make_ellipsoid(
        "OptB_HairSidePuffL",
        radii=(0.055, 0.085, 0.065),
        location=(-0.155, -0.020, 0.945),
        rotation_deg=(12.0, -20.0, 0.0),
        collection=collection,
    )
    side_puff_r = make_ellipsoid(
        "OptB_HairSidePuffR",
        radii=(0.055, 0.085, 0.065),
        location=(0.155, -0.020, 0.945),
        rotation_deg=(12.0, 20.0, 0.0),
        collection=collection,
    )
    head_objs.extend([hair_cap, wave_quiff, side_puff_l, side_puff_r])

    all_objs.extend(head_objs)
    metrics = normalize_character_height_and_calibrate_head(
        all_objs=all_objs,
        head_objs=head_objs,
        target_height=TARGET_HEIGHT_M,
        target_heads_ratio=2.40,
        x_offset=x_offset,
    )
    return all_objs, metrics


def build_option_c(collection: bpy.types.Collection, x_offset: float = 0.0) -> tuple[list[bpy.types.Object], dict]:
    """Option C — 'Ágil / Esguio 2.8 cabeças'.

    - 1.20 m tall, head+hair ~0.4286 m (2.80 heads).
    - Sharper angular forward quiff with twin dynamic locks.
    - Longer open windbreaker jacket with tilted dramatic hem and tall stand collar.
    - Slim geometric tech backpack.
    - Long sweeping arc ribbon-scarf trailing high and far behind.
    """
    all_objs: list[bpy.types.Object] = []
    head_objs: list[bpy.types.Object] = []

    # --- Sleek Runner Sneakers (z: 0.00 -> 0.09 m) ---
    for side, sx in (("L", -0.076), ("R", 0.076)):
        yaw = -5.0 if side == "L" else 5.0
        sole = make_oriented_box(
            f"OptC_ShoeSole_{side}",
            size=(0.078, 0.190, 0.028),
            location=(sx, -0.028, 0.014),
            rotation_deg=(0.0, 0.0, yaw),
            bevel_width=0.006,
            collection=collection,
        )
        upper = make_ellipsoid(
            f"OptC_ShoeUpper_{side}",
            radii=(0.039, 0.088, 0.038),
            location=(sx, -0.024, 0.042),
            rotation_deg=(7.0, 0.0, yaw),
            collection=collection,
        )
        ankle = make_oriented_box(
            f"OptC_ShoeAnkle_{side}",
            size=(0.060, 0.064, 0.038),
            location=(sx, 0.006, 0.076),
            rotation_deg=(0.0, 0.0, yaw),
            bevel_width=0.008,
            collection=collection,
        )
        all_objs.extend([sole, upper, ankle])

    # --- Longer Slender Legs (z: 0.08 -> 0.425 m) ---
    for side, sx in (("L", -0.075), ("R", 0.075)):
        shin = make_tapered_limb(
            f"OptC_Shin_{side}",
            p_start=(sx, 0.004, 0.082),
            p_end=(sx * 0.94, -0.004, 0.255),
            r_start=(0.031, 0.033),
            r_end=(0.037, 0.039),
            collection=collection,
        )
        thigh = make_tapered_limb(
            f"OptC_Thigh_{side}",
            p_start=(sx * 0.94, -0.004, 0.245),
            p_end=(sx * 0.82, 0.002, 0.425),
            r_start=(0.038, 0.040),
            r_end=(0.046, 0.048),
            collection=collection,
        )
        all_objs.extend([shin, thigh])

    pelvis = make_ellipsoid(
        "OptC_Pelvis",
        radii=(0.102, 0.076, 0.062),
        location=(0.0, 0.003, 0.425),
        collection=collection,
    )
    all_objs.append(pelvis)

    # --- Slender Torso & Longer Open Windbreaker with Tilted Hem (z: 0.32 -> 0.78 m) ---
    torso = make_tapered_limb(
        "OptC_TorsoTee",
        p_start=(0.0, 0.002, 0.420),
        p_end=(0.0, 0.000, 0.725),
        r_start=(0.092, 0.068),
        r_end=(0.114, 0.078),
        collection=collection,
    )
    neck = make_tapered_limb(
        "OptC_Neck",
        p_start=(0.0, -0.004, 0.710),
        p_end=(0.0, -0.008, 0.798),
        r_start=(0.038, 0.038),
        r_end=(0.035, 0.035),
        collection=collection,
    )
    windbreaker = make_open_jacket_shell(
        "OptC_Windbreaker",
        z_bottom=0.315,
        z_top=0.730,
        waist_rx=0.106,
        waist_ry=0.078,
        chest_rx=0.122,
        chest_ry=0.086,
        hem_flare=0.26,
        front_gap_deg=60.0,
        tilt_front_z=-0.038,  # Dramatic longer tail in back (+Y), higher cut in front (-Y)
        collar_height=0.068,
        collar_flare=0.038,
        thickness=0.018,
        collection=collection,
    )
    all_objs.extend([torso, neck, windbreaker])

    # --- Slender Agile Arms ---
    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        sh_x = s_sign * 0.128
        el_x = s_sign * 0.196
        wr_x = s_sign * 0.226
        upper_arm = make_tapered_limb(
            f"OptC_UpperArm_{side}",
            p_start=(sh_x, 0.004, 0.695),
            p_end=(el_x, 0.018, 0.545),
            r_start=(0.037, 0.037),
            r_end=(0.033, 0.033),
            collection=collection,
        )
        forearm = make_tapered_limb(
            f"OptC_Forearm_{side}",
            p_start=(el_x, 0.018, 0.545),
            p_end=(wr_x, -0.026, 0.415),
            r_start=(0.034, 0.034),
            r_end=(0.026, 0.026),
            collection=collection,
        )
        hand = make_ellipsoid(
            f"OptC_Hand_{side}",
            radii=(0.024, 0.030, 0.035),
            location=(wr_x * 1.01, -0.034, 0.382),
            rotation_deg=(12.0, s_sign * 10.0, 0.0),
            collection=collection,
        )
        thumb = make_ellipsoid(
            f"OptC_Thumb_{side}",
            radii=(0.010, 0.016, 0.012),
            location=(wr_x * 0.92, -0.050, 0.388),
            rotation_deg=(20.0, 0.0, s_sign * -25.0),
            collection=collection,
        )
        all_objs.extend([upper_arm, forearm, hand, thumb])

    # --- Slim Tech Pack (angled geometric profile) ---
    tech_pack = make_oriented_box(
        "OptC_SlimTechPack",
        size=(0.170, 0.082, 0.265),
        location=(0.0, 0.122, 0.590),
        rotation_deg=(-9.0, 0.0, 0.0),
        bevel_width=0.012,
        segments=2,
        collection=collection,
    )
    tech_fin = make_oriented_box(
        "OptC_TechPackUpperModule",
        size=(0.135, 0.045, 0.095),
        location=(0.0, 0.162, 0.655),
        rotation_deg=(-14.0, 0.0, 0.0),
        bevel_width=0.008,
        segments=2,
        collection=collection,
    )
    all_objs.extend([tech_pack, tech_fin])

    # --- Long Sweeping Arc Ribbon-Scarf ---
    scarf_collar = make_ellipsoid(
        "OptC_ScarfCollar",
        radii=(0.078, 0.076, 0.032),
        location=(0.0, -0.004, 0.742),
        rotation_deg=(6.0, 0.0, 0.0),
        collection=collection,
    )
    scarf_arc = vn_shapes.make_ribbon(
        "OptC_ScarfLongArc",
        points=[
            (0.02, 0.055, 0.742),
            (0.11, 0.135, 0.765),
            (0.20, 0.220, 0.738),
            (0.26, 0.300, 0.678),
            (0.31, 0.365, 0.705),
            (0.34, 0.410, 0.742),
        ],
        width=0.072,
        thickness=0.014,
        step=0.075,
        elevation=0.0,
        bevel_width=0.004,
        collection=collection,
    )
    all_objs.extend([scarf_collar, scarf_arc])

    # --- Head + Sharp Angular Forward Quiff (2.8 heads -> ~0.4286 m head height) ---
    cranium = make_ellipsoid(
        "OptC_HeadCranium",
        radii=(0.142, 0.148, 0.152),
        location=(0.0, -0.008, 0.935),
        rotation_deg=(3.0, 0.0, 0.0),
        collection=collection,
    )
    jaw = make_ellipsoid(
        "OptC_HeadJaw",
        radii=(0.112, 0.114, 0.098),
        location=(0.0, -0.026, 0.870),
        rotation_deg=(7.0, 0.0, 0.0),
        collection=collection,
    )
    nose = make_ellipsoid(
        "OptC_Nose",
        radii=(0.019, 0.032, 0.022),
        location=(0.0, -0.158, 0.912),
        rotation_deg=(-12.0, 0.0, 0.0),
        collection=collection,
    )
    head_objs.extend([cranium, jaw, nose])

    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        ear = make_ellipsoid(
            f"OptC_Ear_{side}",
            radii=(0.022, 0.030, 0.040),
            location=(s_sign * 0.144, 0.004, 0.915),
            rotation_deg=(0.0, s_sign * -10.0, s_sign * 8.0),
            collection=collection,
        )
        head_objs.append(ear)

    hair_cap = make_ellipsoid(
        "OptC_HairCap",
        radii=(0.150, 0.156, 0.142),
        location=(0.0, 0.012, 0.972),
        rotation_deg=(-14.0, 0.0, 0.0),
        collection=collection,
    )
    # Sharp angular blade-like forward quiff + secondary crown spike
    quiff_blade = make_lofted_hair_quiff(
        "OptC_HairAngularQuiff",
        stations=[
            ((0.000, 0.095, 1.028), 0.108, 0.048, 0.0),
            ((-0.015, 0.000, 1.088), 0.110, 0.068, -8.0),
            ((-0.042, -0.105, 1.142), 0.090, 0.072, -14.0),
            ((-0.076, -0.215, 1.178), 0.054, 0.048, -20.0),
            ((-0.112, -0.295, 1.198), 0.018, 0.018, -25.0),
        ],
        collection=collection,
    )
    quiff_upper_spike = make_lofted_hair_quiff(
        "OptC_HairUpperSpike",
        stations=[
            ((0.022, 0.065, 1.045), 0.068, 0.038, 10.0),
            ((0.052, -0.035, 1.115), 0.058, 0.045, 16.0),
            ((0.086, -0.135, 1.172), 0.022, 0.022, 22.0),
        ],
        collection=collection,
    )
    back_spike = make_lofted_hair_quiff(
        "OptC_HairBackKick",
        stations=[
            ((0.000, 0.085, 0.975), 0.088, 0.042, 0.0),
            ((0.000, 0.165, 0.995), 0.062, 0.034, 0.0),
            ((0.000, 0.225, 1.018), 0.022, 0.016, 0.0),
        ],
        collection=collection,
    )
    head_objs.extend([hair_cap, quiff_blade, quiff_upper_spike, back_spike])

    all_objs.extend(head_objs)
    metrics = normalize_character_height_and_calibrate_head(
        all_objs=all_objs,
        head_objs=head_objs,
        target_height=TARGET_HEIGHT_M,
        target_heads_ratio=2.80,
        x_offset=x_offset,
    )
    return all_objs, metrics


# ------------------------------------------------ sheet rendering & composition


def _draw_rect(
    canvas: np.ndarray,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color_rgba: tuple[float, float, float, float],
) -> None:
    h, w, _ = canvas.shape
    xa, xb = max(0, min(w, int(x0))), max(0, min(w, int(x1)))
    ya, yb = max(0, min(h, int(y0))), max(0, min(h, int(y1)))
    if xb > xa and yb > ya:
        canvas[ya:yb, xa:xb] = color_rgba


def _draw_dashed_hline(
    canvas: np.ndarray,
    y: int,
    x0: int,
    x1: int,
    color_rgba: tuple[float, float, float, float],
    dash: int = 8,
    gap: int = 6,
    thickness: int = 1,
) -> None:
    cur_x = int(x0)
    end_x = int(x1)
    step = max(1, dash + gap)
    while cur_x < end_x:
        seg_end = min(end_x, cur_x + dash)
        _draw_rect(canvas, cur_x, y, seg_end, y + thickness, color_rgba)
        cur_x += step


# Minimal 5x7 bitmap font for crisp headers/ruler labels on the comparison sheet
_FONT_5X7: dict[str, tuple[str, ...]] = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "C": ("01110", "10001", "10000", "10000", "10000", "10001", "01110"),
    "D": ("11110", "10001", "10001", "10001", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "F": ("11111", "10000", "10000", "11110", "10000", "10000", "10000"),
    "G": ("01110", "10001", "10000", "10111", "10001", "10001", "01110"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "I": ("01110", "00100", "00100", "00100", "00100", "00100", "01110"),
    "J": ("00111", "00010", "00010", "00010", "10010", "10010", "01100"),
    "K": ("10001", "10010", "10100", "11000", "10100", "10010", "10001"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "M": ("10001", "11011", "10101", "10101", "10001", "10001", "10001"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "Q": ("01110", "10001", "10001", "10001", "10101", "10010", "01101"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
    "V": ("10001", "10001", "10001", "10001", "10001", "01010", "00100"),
    "W": ("10001", "10001", "10001", "10101", "10101", "11011", "10001"),
    "X": ("10001", "10001", "01010", "00100", "01010", "10001", "10001"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
    "Z": ("11111", "00001", "00010", "00100", "01000", "10000", "11111"),
    "0": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "1": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "2": ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    "3": ("11110", "00001", "00001", "01110", "00001", "00001", "11110"),
    "4": ("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
    "5": ("11111", "10000", "10000", "11110", "00001", "00001", "11110"),
    "6": ("01110", "10000", "10000", "11110", "10001", "10001", "01110"),
    "7": ("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
    "8": ("01110", "10001", "10001", "01110", "10001", "10001", "01110"),
    "9": ("01110", "10001", "10001", "01111", "00001", "00001", "01110"),
    ".": ("00000", "00000", "00000", "00000", "00000", "01100", "01100"),
    ":": ("00000", "01100", "01100", "00000", "01100", "01100", "00000"),
    "-": ("00000", "00000", "00000", "11111", "00000", "00000", "00000"),
    "/": ("00001", "00010", "00010", "00100", "01000", "01000", "10000"),
    "(": ("00010", "00100", "01000", "01000", "01000", "00100", "00010"),
    ")": ("01000", "00100", "00010", "00010", "00010", "00100", "01000"),
    " ": ("00000", "00000", "00000", "00000", "00000", "00000", "00000"),
}


def _draw_text(
    canvas: np.ndarray,
    text: str,
    x: int,
    y_top: int,
    color_rgba: tuple[float, float, float, float],
    scale: int = 2,
) -> None:
    """Draw bitmap text where `y_top` is measured in image coordinates (0 = bottom)."""
    cursor_x = int(x)
    for ch in text.upper():
        glyph = _FONT_5X7.get(ch, _FONT_5X7[" "])
        for row_idx, row_bits in enumerate(glyph):
            # row_idx 0 is top of glyph -> highest y in bottom-up numpy buffer
            py = int(y_top) - (row_idx + 1) * scale
            for col_idx, bit in enumerate(row_bits):
                if bit == "1":
                    px = cursor_x + col_idx * scale
                    _draw_rect(canvas, px, py, px + scale, py + scale, color_rgba)
        cursor_x += 6 * scale


def render_silhouette_comparison_sheet(
    out_path: str,
    option_collections: Sequence[tuple[str, str, bpy.types.Collection, dict, float]],
    tile_w: int = 300,
    tile_h: int = 720,
    ortho_height_m: float = 1.60,
    z_center_m: float = 0.60,
) -> dict:
    """Render an orthographic Front + Profile flat-ink comparison sheet for Options A, B, C.

    Produces a clean 1800x900 high-contrast sheet (`#0a0a0a` flat ink on `#f4ead4` paper)
    with 3 option panels, 1.20 m / 0.00 m ground / head-crown proportion guide lines,
    and Front + Profile labels.
    """
    scene = bpy.context.scene
    scene.render.engine = vn_scene.detect_eevee_engine(scene)
    scene.render.resolution_x = int(tile_w)
    scene.render.resolution_y = int(tile_h)
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    # Neutral view transform so emission colors map cleanly
    if hasattr(scene, "view_settings"):
        try:
            scene.view_settings.view_transform = "Standard"
            scene.view_settings.look = "None"
        except Exception:
            pass

    cam_data = bpy.data.cameras.new("_SilhouetteOrthoCam")
    cam_data.type = "ORTHO"
    # In Blender when resolution_y >= resolution_x, ortho_scale is the vertical height in meters
    cam_data.ortho_scale = float(ortho_height_m)
    cam_data.clip_start = 0.05
    cam_data.clip_end = 50.0
    cam_obj = bpy.data.objects.new("_SilhouetteOrthoCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    paper_srgb = (*_hex_to_srgb_tuple(PAPER_HEX), 1.0)
    ink_srgb = (*_hex_to_srgb_tuple(INK_HEX), 1.0)
    guide_srgb = (*_hex_to_srgb_tuple(GUIDE_INK_HEX), 1.0)
    accent_srgb = (*_hex_to_srgb_tuple(ACCENT_GUIDE_HEX), 1.0)

    sheet_w = tile_w * 6  # 1800 px (3 options * 2 views)
    sheet_h = 900
    tile_y0 = 70  # bottom margin for view labels
    canvas = np.empty((sheet_h, sheet_w, 4), dtype=np.float32)
    canvas[:, :] = paper_srgb

    # World Z -> canvas Y pixel converter inside the tile region [tile_y0, tile_y0 + tile_h]
    z_min_vis = z_center_m - ortho_height_m * 0.5
    def _z_to_y(z_val: float) -> int:
        norm = (z_val - z_min_vis) / ortho_height_m
        return int(round(tile_y0 + norm * tile_h))

    y_ground = _z_to_y(0.0)
    y_top_120 = _z_to_y(TARGET_HEIGHT_M)

    # Top title banner
    _draw_rect(canvas, 24, sheet_h - 56, sheet_w - 24, sheet_h - 53, ink_srgb)
    _draw_text(
        canvas,
        "T2.A1 - VICTOR SILHOUETTES (1.20 M / FLAT INK FRONT - PROFILE)",
        32,
        sheet_h - 18,
        ink_srgb,
        scale=3,
    )

    # Global 0.00 m ground line and 1.20 m crown height ruler lines across all 3 columns
    _draw_rect(canvas, 24, y_ground - 1, sheet_w - 24, y_ground + 1, guide_srgb)
    _draw_dashed_hline(canvas, y_top_120, 24, sheet_w - 24, guide_srgb, dash=10, gap=6, thickness=2)
    _draw_text(canvas, "1.20M", 28, y_top_120 + 18, guide_srgb, scale=2)
    _draw_text(canvas, "0.00M", 28, y_ground + 18, guide_srgb, scale=2)

    try:
        with tempfile.TemporaryDirectory(prefix="vn_t2a1_") as tmpdir:
            for opt_idx, (opt_code, opt_title, opt_col, metrics, x_off) in enumerate(option_collections):
                # Hide other option collections during this option's render pass
                for _, _, other_col, _, _ in option_collections:
                    other_col.hide_render = (other_col != opt_col)

                col_x0 = opt_idx * (tile_w * 2)
                col_x1 = col_x0 + (tile_w * 2)

                # Draw head-chin proportion guide line for this option (1 head below 1.20 m)
                chin_z = metrics["chin_z_m"]
                y_chin = _z_to_y(chin_z)

                # Render Front (looking from -Y toward +Y) and Right Profile (looking from +X toward -X)
                tgt_front = Vector((x_off, 0.0, z_center_m))
                tgt_profile = Vector((x_off, 0.04, z_center_m))
                views = (
                    ("FRENTE", tgt_front + Vector((0.0, -3.5, 0.0)), tgt_front),
                    ("PERFIL", tgt_profile + Vector((3.5, 0.0, 0.0)), tgt_profile),
                )

                for v_idx, (v_label, cam_pos, v_tgt) in enumerate(views):
                    cam_obj.location = cam_pos
                    vn_scene._look_at(cam_obj, v_tgt)

                    tile_path = os.path.join(tmpdir, f"{opt_code}_{v_label}.png")
                    scene.render.filepath = tile_path
                    bpy.ops.render.render(write_still=True)

                    img = bpy.data.images.load(tile_path, check_existing=False)
                    try:
                        w, h = img.size[0], img.size[1]
                        buf = np.empty(w * h * 4, dtype=np.float32)
                        img.pixels.foreach_get(buf)
                        tile_rgba = buf.reshape((h, w, 4))
                    finally:
                        bpy.data.images.remove(img)

                    # Alpha-composite rendered flat-ink silhouette over paper canvas
                    tx0 = col_x0 + v_idx * tile_w
                    tx1 = tx0 + tile_w
                    ty0 = tile_y0
                    ty1 = ty0 + tile_h

                    alpha = tile_rgba[:, :, 3:4]
                    ink_rgb = np.empty_like(tile_rgba[:, :, :3])
                    ink_rgb[:, :] = ink_srgb[:3]
                    region = canvas[ty0:ty1, tx0:tx1, :3]
                    canvas[ty0:ty1, tx0:tx1, :3] = region * (1.0 - alpha) + ink_rgb * alpha
                    canvas[ty0:ty1, tx0:tx1, 3] = 1.0

                    # View sub-label at bottom
                    _draw_text(
                        canvas,
                        v_label,
                        tx0 + tile_w // 2 - 36,
                        46,
                        guide_srgb,
                        scale=2,
                    )

                # Overlay dashed chin line and proportion label AFTER compositing silhouette
                _draw_dashed_hline(
                    canvas,
                    y_chin,
                    col_x0 + 16,
                    col_x1 - 16,
                    accent_srgb,
                    dash=6,
                    gap=6,
                    thickness=1,
                )
                ratio_str = f"1/{metrics['head_to_body_ratio']:.1f}H"
                _draw_text(canvas, ratio_str, col_x0 + 18, y_chin + 18, accent_srgb, scale=2)

                # Column header & border separator
                _draw_text(
                    canvas,
                    opt_title,
                    col_x0 + 24,
                    sheet_h - 72,
                    ink_srgb,
                    scale=2,
                )
                sub_metrics = (
                    f"H:{metrics['total_height_m']:.3f}M  "
                    f"HEAD:{metrics['head_height_m']:.3f}M  "
                    f"RATIO:{metrics['head_to_body_ratio']:.2f}H"
                )
                _draw_text(
                    canvas,
                    sub_metrics,
                    col_x0 + 24,
                    sheet_h - 94,
                    guide_srgb,
                    scale=2,
                )

                if opt_idx > 0:
                    _draw_rect(canvas, col_x0 - 1, 20, col_x0 + 1, sheet_h - 62, guide_srgb)

            # Restore render visibility on all collections
            for _, _, col_restore, _, _ in option_collections:
                col_restore.hide_render = False
    finally:
        bpy.data.objects.remove(cam_obj, do_unlink=True)
        bpy.data.cameras.remove(cam_data)

    abs_out = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(abs_out), exist_ok=True)

    out_img = bpy.data.images.new("_t2a1_sheet", width=sheet_w, height=sheet_h, alpha=True)
    try:
        if hasattr(out_img, "colorspace_settings"):
            try:
                out_img.colorspace_settings.name = "sRGB"
            except Exception:
                pass
        out_img.pixels.foreach_set(canvas.ravel())
        out_img.filepath_raw = abs_out
        out_img.file_format = "PNG"
        out_img.save()
    finally:
        bpy.data.images.remove(out_img)

    return {"filepath": abs_out, "width": sheet_w, "height": sheet_h}


# ------------------------------------------------------------------------ main


def build_all() -> dict:
    vn_scene.reset_scene("T2A1_VictorSilhouettes")
    ink_mat = make_flat_ink_material("VN_VictorFlatInk", INK_HEX)

    col_a = vn_scene.ensure_collection("OptionA_Classico_2_6H")
    col_b = vn_scene.ensure_collection("OptionB_Compacto_2_4H")
    col_c = vn_scene.ensure_collection("OptionC_Agil_2_8H")

    objs_a, metrics_a = build_option_a(col_a, x_offset=-1.50)
    objs_b, metrics_b = build_option_b(col_b, x_offset=0.00)
    objs_c, metrics_c = build_option_c(col_c, x_offset=1.50)

    assign_material_recursive(objs_a + objs_b + objs_c, ink_mat)

    stats_a = vn_scene.scene_stats(objs_a)
    stats_b = vn_scene.scene_stats(objs_b)
    stats_c = vn_scene.scene_stats(objs_c)

    out_dir = os.path.join(BLENDER_ROOT, "out")
    previews_dir = os.path.join(out_dir, "previews")
    os.makedirs(previews_dir, exist_ok=True)

    preview_path = os.path.join(previews_dir, "t2a1_silhouettes.png")
    glb_path = os.path.join(out_dir, "t2a1_silhouettes.glb")

    option_specs = [
        ("A", "OPCAO A - CLASSICO 2.6 CABECAS (D3 PADRAO)", col_a, metrics_a, -1.50),
        ("B", "OPCAO B - EXPLORADOR COMPACTO 2.4 CABECAS", col_b, metrics_b, 0.00),
        ("C", "OPCAO C - AGIL ESGUIO 2.8 CABECAS", col_c, metrics_c, 1.50),
    ]
    sheet_info = render_silhouette_comparison_sheet(
        out_path=preview_path,
        option_collections=option_specs,
    )

    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )

    print("=" * 78)
    print("[T2.A1] Victor 3 Silhouettes Report (D3 & PLAN-3D §2.3)")
    print("-" * 78)
    for label, m, st in (
        ("Option A (Classico 2.6H - D3 Padrao)", metrics_a, stats_a),
        ("Option B (Explorador Compacto 2.4H)", metrics_b, stats_b),
        ("Option C (Agil / Esguio 2.8H)", metrics_c, stats_c),
    ):
        print(
            f"  {label:38s} | height={m['total_height_m']:.4f} m | "
            f"head={m['head_height_m']:.4f} m | ratio={m['head_to_body_ratio']:.2f} heads | "
            f"tris={st['triangles']} | meshes={st['meshes']}"
        )
        assert abs(m["total_height_m"] - TARGET_HEIGHT_M) <= 0.01, (
            f"Height out of 1.200 ± 0.01 m tolerance for {label}: {m['total_height_m']}"
        )
    print("-" * 78)
    print(f"  Preview PNG : {sheet_info['filepath']} ({sheet_info['width']}x{sheet_info['height']})")
    print(f"  Exported GLB: {glb_path}")
    print("=" * 78)

    return {
        "preview": sheet_info,
        "glb": glb_path,
        "optionA": {**metrics_a, **stats_a},
        "optionB": {**metrics_b, **stats_b},
        "optionC": {**metrics_c, **stats_c},
    }


if __name__ == "__main__":
    build_all()
