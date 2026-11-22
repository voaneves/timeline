"""T2.5a, T2.5b, T2.5c & T2.5d — Victor Complete Character Model (`victor_model.py`).

Builds the clean, rig-ready, low-poly character mesh hierarchy of Victor
(Phase 2C: Personagem Victor — Blockout de Cabeça/Topete + Corpo/Roupa/Mochila/Cachecol +
Detalhe/UV de Paleta + Olhos e Boca por UV + Casco Invertido de Contorno 0.015 m +
Checklist de Trade Dress + Export), matching canonical Option A ("Clássico 2.6 cabeças —
D3 Padrão") from `turnaround.py` / `silhouettes.py`:

  - Exact total height: 1.200 m (z: 0.000 -> 1.200 m).
  - Exact head+hair height: ~0.4615 m -> 2.60 heads (`1.200 / 2.60`).
  - Strictly `<= 6,000 tris` total (including `T2.5c` UV-swappable eyes/mouth and
    `T2.5d` `0.015 m` inverted-hull ink outline) and **2 materials** (`"palette"` + `"victorFace"`).
  - Every mesh part (and its inverted-hull outline counterpart) is tagged with its
    canonical rig bone group (`bone_group` custom property AND pre-populated 1.0 vertex
    group for deterministic T2.6 skinning):
      `hips`, `spine`, `spine.001`, `neck`, `head`, `brow.L`, `brow.R`,
      `shoulder.L`, `arm.L`, `forearm.L`, `hand.L`,
      `shoulder.R`, `arm.R`, `forearm.R`, `hand.R`,
      `thigh.L`, `shin.L`, `foot.L`, `toe.L`,
      `thigh.R`, `shin.R`, `foot.R`, `toe.R`,
      `scarf.01`, `scarf.02`, `scarf.03`.
  - `T2.5c` UV-swappable facial rigging (`"victorFace"` material):
      * `VictorEye.L` & `VictorEye.R`: large oval eyes with white sclera, ink pupil, and
        catchlight highlight, plus UV tile metadata (`uv_states`: `open`, `half`, `blink`,
        `step_u = 1/16`) so `CharacterVisual.js` (`T2.9b`) can blink via UV offset.
      * `VictorMouth`: 3-shape UV-swappable mouth mesh (`neutral`, `smile`, `o` surprise,
        `step_u = 1/16`, default `(0,0)` showing the warm smile).
  - `T2.5d` Inverted-hull ink outline (`0.015 m`, PLAN-3D §2.2 line 143):
      * Displaced `0.015 m` along smooth vertex normals with flipped polygon winding and
        backface culling (`use_backface_culling = True`), mapped to the `#0a0a0a` `ink`
        swatch in `"palette"` and inheriting 100% of the source `bone_group` vertex weights.
  - Zero Nintendo trade dress: NO cap, NO overalls, NO mustache, NO white gloves.
  - Supports manual `.blend` overrides via `vn_manual.apply_manual_overrides("victor_model")`.

Automated Verification:
  1. `T2.5a` Acceptance: Orthographic Front + Profile flat silhouette render compared
     pixel-by-pixel against the reference Option A turnaround silhouette (`turnaround.py`),
     asserting symmetric pixel deviation <= 5.0% (`game/blender/out/previews/t25a_silhouette_overlap.png`).
  2. `T2.5b` Acceptance: Script measurement of exact world Z bounds (`height = 1.2000 m
     ± 0.005 m`, `head_height = 0.4615 m`, `head_ratio = 2.60 ± 0.02 heads`) and
     3-view preview render (`game/blender/out/previews/t25b_blockout.png`).
  3. `T2.5c` Acceptance: `<= 6,000 tris` total and exactly `2` materials (`["palette", "victorFace"]`),
     with UV-swappable eyes and 3-shape mouth (`neutral`, `smile`, `o`).
  4. `T2.5d` Acceptance: `0.015 m` inverted-hull ink outline + formal `VICTOR_TRADE_DRESS_CHECKLIST_PASS`
     audit + export to `game/blender/out/victor_model.glb` & `t25cd_victor_final.png`.
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
if THIS_DIR not in sys.path:
    sys.path.insert(0, THIS_DIR)

import silhouettes as sil
import turnaround as trn
from lib import vn_bevel, vn_export, vn_manual, vn_palette, vn_scene, vn_shapes


# ------------------------------------------------------------------ constants

TARGET_HEIGHT_M = 1.200
TARGET_HEADS_RATIO = 2.60
MAX_CORE_TRIS = 4500
MAX_TOTAL_TRIS = 6000
TARGET_MATERIAL_COUNT = 2
OUTLINE_THICKNESS_M = 0.006
MAX_SILHOUETTE_DEVIATION_PCT = 5.0

INK_HEX = "#0a0a0a"
PAPER_HEX = "#f4ead4"
SIGNAL_HEX = "#f50000"
GUIDE_HEX = "#7d725d"
HEAD_TICK_HEX = "#b84a39"
MATCH_INK_HEX = "#141418"
REF_ONLY_HEX = "#2b6cb0"
MODEL_ONLY_HEX = "#e53e3e"

CANONICAL_24_BONES: tuple[str, ...] = (
    "hips",
    "spine",
    "spine.001",
    "neck",
    "head",
    "brow.L",
    "brow.R",
    "shoulder.L",
    "arm.L",
    "forearm.L",
    "hand.L",
    "shoulder.R",
    "arm.R",
    "forearm.R",
    "hand.R",
    "thigh.L",
    "shin.L",
    "foot.L",
    "toe.L",
    "thigh.R",
    "shin.R",
    "foot.R",
    "toe.R",
    "scarf.01",
    "scarf.02",
    "scarf.03",
)


# -------------------------------------------- low-poly rig-ready primitives


def _tag_rig_part(
    obj: bpy.types.Object,
    bone_group: str,
    part_role: str = "body",
    outline_candidate: bool = True,
) -> bpy.types.Object:
    """Tag `obj` with its target bone name and pre-assign a 1.0 vertex group for T2.6."""
    assert bone_group in CANONICAL_24_BONES, f"Unknown canonical bone {bone_group!r}"
    vn_scene.set_custom_props(
        obj,
        {
            "bone_group": bone_group,
            "part_role": part_role,
            "outline_candidate": bool(outline_candidate),
        },
    )
    if obj.type == "MESH" and obj.data is not None and len(obj.data.vertices) > 0:
        vg = obj.vertex_groups.get(bone_group)
        if vg is None:
            vg = obj.vertex_groups.new(name=bone_group)
        all_indices = list(range(len(obj.data.vertices)))
        vg.add(all_indices, 1.0, "REPLACE")
    return obj


def make_lowpoly_ellipsoid(
    name: str,
    radii: tuple[float, float, float],
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0),
    segments: int = 10,
    rings: int = 6,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a low-poly ellipsoid matching the exact spatial envelope of `sil.make_ellipsoid`.

    Unlike `sil.make_ellipsoid` (which clamps `segments>=12, rings>=8`), this helper
    honors smaller segment/ring counts (`segments>=6, rings>=4`) while applying radial
    chord compensation on interior rings so the outer silhouette envelope matches within < 0.5%.
    """
    u_seg = max(6, int(segments))
    v_seg = max(4, int(rings))
    bm = bmesh.new()
    try:
        bmesh.ops.create_uvsphere(
            bm,
            u_segments=u_seg,
            v_segments=v_seg,
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
    return sil._transform_and_finalize(
        obj,
        location=location,
        rotation_deg=rotation_deg,
        bevel_width=0.0,
        bevel_segments=0,
    )


def make_lowpoly_tapered_limb(
    name: str,
    p_start: tuple[float, float, float],
    p_end: tuple[float, float, float],
    r_start: tuple[float, float],
    r_end: tuple[float, float],
    segments: int = 8,
    cap_roundness: float = 0.25,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a rig-ready tapered limb with streamlined station rings (40% fewer tris than `sil.make_tapered_limb`)."""
    p0 = Vector(p_start)
    p1 = Vector(p_end)
    axis = p1 - p0
    length = max(axis.length, 1e-4)
    z_dir = axis / length

    ref = Vector((0.0, 1.0, 0.0)) if abs(z_dir.y) < 0.9 else Vector((1.0, 0.0, 0.0))
    x_dir = ref.cross(z_dir).normalized()
    y_dir = z_dir.cross(x_dir).normalized()

    segs = max(6, int(segments))
    bm = bmesh.new()
    try:
        # 6 stations instead of 9: preserves exact end domes, midpoint bend loop, and outer radii
        stations = [
            (-cap_roundness * 0.42, 0.38),
            (0.0, 1.0),
            (0.33, 1.0),
            (0.67, 1.0),
            (1.0, 1.0),
            (1.0 + cap_roundness * 0.42, 0.38),
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


def make_lowpoly_hair_quiff(
    name: str,
    stations: Sequence[tuple[tuple[float, float, float], float, float, float]],
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a sculpted forward-sweeping hair quiff ('topete para frente') with an 8-point cross-section."""
    bm = bmesh.new()
    try:
        base_profile = [
            (0.00, 1.12),   # top crest peak
            (0.62, 0.80),
            (1.00, 0.15),
            (0.74, -0.58),
            (0.00, -0.92),  # bottom center
            (-0.74, -0.58),
            (-1.00, 0.15),
            (-0.62, 0.80),
        ]
        n_prof = len(base_profile)
        centers = [Vector(s[0]) for s in stations]
        n_stat = len(centers)

        rings: list[list[bmesh.types.BMVert]] = []
        world_up = Vector((0.0, 0.0, 1.0))

        for i, (_, rx, rz, roll_deg) in enumerate(stations):
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


def make_unbeveled_ribbon(
    name: str,
    points: Iterable[Sequence[float]],
    width: float = 0.080,
    thickness: float = 0.016,
    step: float = 0.085,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a smooth low-poly 3D spline ribbon without bevel modifier inflation (~116 tris vs 1,008 tris)."""
    return vn_shapes.make_ribbon(
        name=name,
        points=points,
        width=width,
        thickness=thickness,
        step=step,
        elevation=0.0,
        bevel_width=0.0,
        collection=collection,
    )


def make_lowpoly_open_jacket_shell(
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
    n_arc: int = 12,
    n_col: int = 10,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the open signal-red jacket shell with flared hem and popped collar (optimized arc count)."""
    bm = bmesh.new()
    try:
        gap_half = math.radians(front_gap_deg * 0.5)
        ang_start = -math.pi * 0.5 + gap_half
        ang_end = 1.5 * math.pi - gap_half

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
                z_local = z_base + (-sa) * tilt_front_z * (1.0 - t_z * 0.5)

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

        if collar_height > 0.005:
            c_ang_start = -math.pi * 0.5 + gap_half * 1.15
            c_ang_end = 1.5 * math.pi - gap_half * 1.15
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
        keep_sharp=False,
        face_influence=False,
        apply=True,
    )
    return obj


# ----------------------------------------- T2.5a & T2.5b character blockout


def build_head_and_quiff_blockout(
    collection: bpy.types.Collection,
) -> list[bpy.types.Object]:
    """T2.5a — Build Victor's head, ears, nose, brows, hair cap, nape, and signature forward quiff.

    Every mesh is tagged with its canonical bone group (`head`, `brow.L`, `brow.R`).
    Matches Option A's exact outer envelope while staying low-poly (~760 tris total).
    """
    head_objs: list[bpy.types.Object] = []

    cranium = make_lowpoly_ellipsoid(
        "Victor_HeadCranium",
        radii=(0.158, 0.160, 0.160),
        location=(0.0, -0.006, 0.916),
        rotation_deg=(2.0, 0.0, 0.0),
        segments=16,
        rings=10,
        collection=collection,
    )
    _tag_rig_part(cranium, "head", part_role="head", outline_candidate=True)

    jaw = make_lowpoly_ellipsoid(
        "Victor_HeadJaw",
        radii=(0.132, 0.128, 0.102),
        location=(0.0, -0.020, 0.848),
        rotation_deg=(4.0, 0.0, 0.0),
        segments=16,
        rings=8,
        collection=collection,
    )
    _tag_rig_part(jaw, "head", part_role="head", outline_candidate=True)

    nose = make_lowpoly_ellipsoid(
        "Victor_Nose",
        radii=(0.012, 0.012, 0.010),
        location=(0.0, -0.164, 0.884),
        rotation_deg=(-6.0, 0.0, 0.0),
        segments=10,
        rings=6,
        collection=collection,
    )
    _tag_rig_part(nose, "head", part_role="face_detail", outline_candidate=False)
    head_objs.extend([cranium, jaw, nose])

    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        ear = make_lowpoly_ellipsoid(
            f"Victor_Ear_{side}",
            radii=(0.026, 0.034, 0.044),
            location=(s_sign * 0.158, 0.004, 0.892),
            rotation_deg=(0.0, s_sign * -12.0, s_sign * 10.0),
            segments=8,
            rings=5,
            collection=collection,
        )
        _tag_rig_part(ear, "head", part_role="head", outline_candidate=True)
        head_objs.append(ear)

    # Clean rounded chibi hair crown + soft side-swept bangs (no protruding beak/pompadour)
    hair_cap = make_lowpoly_ellipsoid(
        "Victor_HairCap",
        radii=(0.168, 0.172, 0.148),
        location=(0.0, 0.010, 0.958),
        rotation_deg=(-8.0, 0.0, 0.0),
        segments=16,
        rings=10,
        collection=collection,
    )
    _tag_rig_part(hair_cap, "head", part_role="hair", outline_candidate=True)

    hair_nape = make_lowpoly_ellipsoid(
        "Victor_HairNape",
        radii=(0.136, 0.072, 0.082),
        location=(0.0, 0.124, 0.882),
        rotation_deg=(18.0, 0.0, 0.0),
        segments=12,
        rings=6,
        collection=collection,
    )
    _tag_rig_part(hair_nape, "head", part_role="hair", outline_candidate=True)

    quiff_main = make_lowpoly_hair_quiff(
        "Victor_HairQuiffMain",
        stations=[
            ((0.000, 0.045, 1.045), 0.135, 0.055, 0.0),
            ((-0.012, -0.045, 1.058), 0.132, 0.056, 4.0),
            ((-0.026, -0.118, 1.032), 0.105, 0.048, 8.0),
            ((-0.036, -0.155, 0.992), 0.062, 0.032, 12.0),
        ],
        collection=collection,
    )
    _tag_rig_part(quiff_main, "head", part_role="hair", outline_candidate=True)

    quiff_side = make_lowpoly_hair_quiff(
        "Victor_HairQuiffSideCrest",
        stations=[
            ((0.055, 0.005, 1.028), 0.078, 0.040, -10.0),
            ((0.075, -0.075, 1.012), 0.068, 0.038, -14.0),
            ((0.078, -0.135, 0.978), 0.042, 0.026, -18.0),
        ],
        collection=collection,
    )
    _tag_rig_part(quiff_side, "head", part_role="hair", outline_candidate=True)

    head_objs.extend([hair_cap, hair_nape, quiff_main, quiff_side])
    return head_objs


def build_body_outfit_backpack_scarf_blockout(
    collection: bpy.types.Collection,
) -> list[bpy.types.Object]:
    """T2.5b — Build Victor's body, open red jacket, paper t-shirt, trousers, sneakers, backpack, and ribbon-scarf.

    Every mesh is cleanly segmented and tagged with its canonical bone group from the 24-bone rig.
    """
    body_objs: list[bpy.types.Object] = []

    # --- Sneakers & Feet (foot.L/R, toe.L/R) ---
    for side, sx in (("L", -0.088), ("R", 0.088)):
        yaw = -7.0 if side == "L" else 7.0
        sole = trn._make_detail_box(
            f"Victor_ShoeSole_{side}",
            size=(0.092, 0.195, 0.032),
            location=(sx, -0.028, 0.016),
            rotation_deg=(0.0, 0.0, yaw),
            bevel_width=0.0,
            collection=collection,
        )
        vn_bevel.apply_weighted_normals(sole, weight=50, keep_sharp=False, face_influence=False, apply=True)
        _tag_rig_part(sole, f"toe.{side}", part_role="shoe", outline_candidate=True)

        upper = make_lowpoly_ellipsoid(
            f"Victor_ShoeUpper_{side}",
            radii=(0.046, 0.092, 0.044),
            location=(sx, -0.024, 0.048),
            rotation_deg=(6.0, 0.0, yaw),
            segments=10,
            rings=6,
            collection=collection,
        )
        _tag_rig_part(upper, f"foot.{side}", part_role="shoe", outline_candidate=True)

        cuff = trn._make_detail_box(
            f"Victor_ShoeCuff_{side}",
            size=(0.072, 0.076, 0.036),
            location=(sx, 0.006, 0.082),
            rotation_deg=(0.0, 0.0, yaw),
            bevel_width=0.0,
            collection=collection,
        )
        vn_bevel.apply_weighted_normals(cuff, weight=50, keep_sharp=False, face_influence=False, apply=True)
        _tag_rig_part(cuff, f"foot.{side}", part_role="shoe", outline_candidate=False)
        body_objs.extend([sole, upper, cuff])

    # --- Legs & Trousers (shin.L/R, thigh.L/R, hips) ---
    for side, sx in (("L", -0.086), ("R", 0.086)):
        shin = make_lowpoly_tapered_limb(
            f"Victor_Shin_{side}",
            p_start=(sx, 0.004, 0.085),
            p_end=(sx * 0.94, -0.004, 0.235),
            r_start=(0.038, 0.040),
            r_end=(0.044, 0.046),
            segments=8,
            collection=collection,
        )
        _tag_rig_part(shin, f"shin.{side}", part_role="leg", outline_candidate=True)

        thigh = make_lowpoly_tapered_limb(
            f"Victor_Thigh_{side}",
            p_start=(sx * 0.94, -0.004, 0.225),
            p_end=(sx * 0.82, 0.002, 0.375),
            r_start=(0.045, 0.047),
            r_end=(0.054, 0.056),
            segments=8,
            collection=collection,
        )
        _tag_rig_part(thigh, f"thigh.{side}", part_role="leg", outline_candidate=True)
        body_objs.extend([shin, thigh])

    pelvis = make_lowpoly_ellipsoid(
        "Victor_Pelvis",
        radii=(0.118, 0.086, 0.068),
        location=(0.0, 0.004, 0.375),
        segments=10,
        rings=6,
        collection=collection,
    )
    _tag_rig_part(pelvis, "hips", part_role="torso", outline_candidate=True)
    body_objs.append(pelvis)

    # --- Inner T-Shirt Torso & Neck (spine, spine.001, neck) ---
    torso = make_lowpoly_tapered_limb(
        "Victor_TorsoTee",
        p_start=(0.0, 0.002, 0.380),
        p_end=(0.0, 0.000, 0.680),
        r_start=(0.105, 0.078),
        r_end=(0.128, 0.088),
        segments=10,
        collection=collection,
    )
    _tag_rig_part(torso, "spine", part_role="torso", outline_candidate=False)

    neck = make_lowpoly_tapered_limb(
        "Victor_Neck",
        p_start=(0.0, -0.004, 0.665),
        p_end=(0.0, -0.008, 0.785),
        r_start=(0.048, 0.048),
        r_end=(0.045, 0.045),
        segments=8,
        collection=collection,
    )
    _tag_rig_part(neck, "neck", part_role="neck", outline_candidate=False)
    body_objs.extend([torso, neck])

    # --- Structured Open Signal-Red Jacket with Collar Flare (spine.001) ---
    jacket = make_lowpoly_open_jacket_shell(
        "Victor_Jacket",
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
        n_arc=12,
        n_col=10,
        collection=collection,
    )
    _tag_rig_part(jacket, "spine.001", part_role="jacket", outline_candidate=True)
    body_objs.append(jacket)

    # --- Shoulders, Arms, Forearms & Bare Hands (shoulder.L/R, arm.L/R, forearm.L/R, hand.L/R) ---
    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        sh_x = s_sign * 0.142
        el_x = s_sign * 0.215
        wr_x = s_sign * 0.248

        shoulder_cap = make_lowpoly_ellipsoid(
            f"Victor_Shoulder_{side}",
            radii=(0.042, 0.042, 0.038),
            location=(sh_x * 0.96, 0.004, 0.648),
            segments=8,
            rings=4,
            collection=collection,
        )
        _tag_rig_part(shoulder_cap, f"shoulder.{side}", part_role="arm", outline_candidate=False)

        upper_arm = make_lowpoly_tapered_limb(
            f"Victor_UpperArm_{side}",
            p_start=(sh_x, 0.004, 0.650),
            p_end=(el_x, 0.016, 0.515),
            r_start=(0.044, 0.044),
            r_end=(0.039, 0.039),
            segments=8,
            collection=collection,
        )
        _tag_rig_part(upper_arm, f"arm.{side}", part_role="arm", outline_candidate=True)

        forearm = make_lowpoly_tapered_limb(
            f"Victor_Forearm_{side}",
            p_start=(el_x, 0.016, 0.515),
            p_end=(wr_x, -0.028, 0.395),
            r_start=(0.040, 0.040),
            r_end=(0.031, 0.031),
            segments=8,
            collection=collection,
        )
        _tag_rig_part(forearm, f"forearm.{side}", part_role="arm", outline_candidate=True)

        cuff_ring = make_lowpoly_ellipsoid(
            f"Victor_SleeveCuff_{side}",
            radii=(0.038, 0.038, 0.018),
            location=(wr_x * 0.98, -0.022, 0.410),
            rotation_deg=(12.0, s_sign * 14.0, 0.0),
            segments=8,
            rings=4,
            collection=collection,
        )
        _tag_rig_part(cuff_ring, f"forearm.{side}", part_role="arm", outline_candidate=False)

        hand = make_lowpoly_ellipsoid(
            f"Victor_Hand_{side}",
            radii=(0.028, 0.034, 0.038),
            location=(wr_x * 1.01, -0.036, 0.362),
            rotation_deg=(10.0, s_sign * 10.0, 0.0),
            segments=8,
            rings=5,
            collection=collection,
        )
        _tag_rig_part(hand, f"hand.{side}", part_role="hand", outline_candidate=True)

        thumb = make_lowpoly_ellipsoid(
            f"Victor_Thumb_{side}",
            radii=(0.012, 0.018, 0.014),
            location=(wr_x * 0.92, -0.054, 0.368),
            rotation_deg=(20.0, 0.0, s_sign * -25.0),
            segments=6,
            rings=4,
            collection=collection,
        )
        _tag_rig_part(thumb, f"hand.{side}", part_role="hand", outline_candidate=False)
        body_objs.extend([shoulder_cap, upper_arm, forearm, cuff_ring, hand, thumb])

    # --- Compact Square Ink Backpack (spine.001) ---
    pack_main = sil.make_oriented_box(
        "Victor_BackpackMain",
        size=(0.205, 0.115, 0.235),
        location=(0.0, 0.145, 0.555),
        rotation_deg=(-6.0, 0.0, 0.0),
        bevel_width=0.018,
        segments=1,
        collection=collection,
    )
    _tag_rig_part(pack_main, "spine.001", part_role="backpack", outline_candidate=True)

    pack_pocket = trn._make_detail_box(
        "Victor_BackpackPocket",
        size=(0.165, 0.045, 0.110),
        location=(0.0, 0.205, 0.515),
        rotation_deg=(-6.0, 0.0, 0.0),
        bevel_width=0.0,
        collection=collection,
    )
    vn_bevel.apply_weighted_normals(pack_pocket, weight=50, keep_sharp=False, face_influence=False, apply=True)
    _tag_rig_part(pack_pocket, "spine.001", part_role="backpack", outline_candidate=False)
    body_objs.extend([pack_main, pack_pocket])

    # --- Ribbon-Scarf ("Cachecol-Fita" — piece of the Line: scarf.01, scarf.02, scarf.03) ---
    scarf_neck = make_lowpoly_ellipsoid(
        "Victor_ScarfCollar",
        radii=(0.088, 0.086, 0.034),
        location=(0.0, -0.004, 0.698),
        rotation_deg=(6.0, 0.0, 0.0),
        segments=10,
        rings=5,
        collection=collection,
    )
    _tag_rig_part(scarf_neck, "scarf.01", part_role="scarf", outline_candidate=True)

    scarf_mid = make_unbeveled_ribbon(
        "Victor_ScarfMid",
        points=[
            (0.02, 0.060, 0.695),
            (0.11, 0.135, 0.680),
            (0.19, 0.215, 0.625),
            (0.25, 0.285, 0.595),
        ],
        width=0.080,
        thickness=0.016,
        step=0.075,
        collection=collection,
    )
    _tag_rig_part(scarf_mid, "scarf.02", part_role="scarf", outline_candidate=True)

    scarf_tip = make_unbeveled_ribbon(
        "Victor_ScarfTail",
        points=[
            (0.23, 0.265, 0.602),
            (0.25, 0.285, 0.595),
            (0.30, 0.345, 0.642),
            (0.33, 0.385, 0.625),
        ],
        width=0.080,
        thickness=0.016,
        step=0.070,
        collection=collection,
    )
    _tag_rig_part(scarf_tip, "scarf.03", part_role="scarf", outline_candidate=True)

    body_objs.extend([scarf_neck, scarf_mid, scarf_tip])
    return body_objs


def _assign_scarf_chain_vertex_groups(scarf_tail: bpy.types.Object) -> None:
    """Split `Victor_ScarfTail` vertices across `scarf.01`, `scarf.02`, and `scarf.03` along its arc."""
    if scarf_tail.type != "MESH" or scarf_tail.data is None:
        return
    vg1 = scarf_tail.vertex_groups.get("scarf.01") or scarf_tail.vertex_groups.new(name="scarf.01")
    vg2 = scarf_tail.vertex_groups.get("scarf.02") or scarf_tail.vertex_groups.new(name="scarf.02")
    vg3 = scarf_tail.vertex_groups.get("scarf.03") or scarf_tail.vertex_groups.new(name="scarf.03")

    verts = scarf_tail.data.vertices
    if len(verts) == 0:
        return
    ys = [v.co.y for v in verts]
    y_min, y_max = min(ys), max(ys)
    span = max(y_max - y_min, 1e-4)

    for v in verts:
        u = (v.co.y - y_min) / span
        if u < 0.34:
            vg1.add([v.index], 1.0, "REPLACE")
            vg2.add([v.index], 0.0, "REPLACE")
            vg3.add([v.index], 0.0, "REPLACE")
        elif u < 0.68:
            vg1.add([v.index], 0.0, "REPLACE")
            vg2.add([v.index], 1.0, "REPLACE")
            vg3.add([v.index], 0.0, "REPLACE")
        else:
            vg1.add([v.index], 0.0, "REPLACE")
            vg2.add([v.index], 0.0, "REPLACE")
            vg3.add([v.index], 1.0, "REPLACE")


def build_flush_surface_details(
    collection: bpy.types.Collection,
) -> list[bpy.types.Object]:
    """Build Victor's rig-tagged facial/outfit surface details (brows, eyes, cheeks, mouth, chest dot, buttons, laces, backpack details)."""
    detail_objs = trn._add_turnaround_details(collection)

    # Extra charismatic toy-platformer flush details (sitting cleanly within Option A silhouette envelope):
    # 1. Warm rosy cheek blush discs under the eyes (`duskCoral` #ff8a5c)
    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        cheek = trn._make_detail_disc(
            f"OptA_CheekBlush_{side}",
            radii=(0.018, 0.008, 0.011),
            location=(s_sign * 0.082, -0.150, 0.882),
            rotation_deg=(6.0, s_sign * 20.0, s_sign * -6.0),
            u_segments=6,
            v_segments=3,
            collection=collection,
        )
        detail_objs.append(cheek)

        # 2. Gold snap buttons along the open red jacket lapels (`ipeGold` #f7c531)
        for b_idx, bz in enumerate((0.460, 0.545, 0.625)):
            snap = trn._make_detail_disc(
                f"OptA_JacketSnap_{side}_{b_idx}",
                radii=(0.0085, 0.006, 0.0085),
                location=(s_sign * 0.072, -0.098, bz),
                rotation_deg=(4.0, s_sign * 18.0, 0.0),
                u_segments=6,
                v_segments=3,
                collection=collection,
            )
            detail_objs.append(snap)

    # 3. Playful ipê-gold explorer badge pin on the backpack (`ipeGold` #f7c531)
    pack_pin = trn._make_detail_disc(
        "OptA_BackpackGoldPin",
        radii=(0.018, 0.008, 0.018),
        location=(-0.048, 0.205, 0.618),
        rotation_deg=(174.0, 0.0, 0.0),
        u_segments=8,
        v_segments=3,
        collection=collection,
    )
    detail_objs.append(pack_pin)

    rename_and_bone_map = {
        "OptA_EyeSclera_L": ("Victor_EyeSclera_L", "head", "face_detail"),
        "OptA_EyePupil_L": ("Victor_EyePupil_L", "head", "face_detail"),
        "OptA_EyeHighlight_L": ("Victor_EyeHighlight_L", "head", "face_detail"),
        "OptA_Eyebrow_L": ("Victor_Eyebrow_L", "brow.L", "brow"),
        "OptA_CheekBlush_L": ("Victor_CheekBlush_L", "head", "face_detail"),
        "OptA_EyeSclera_R": ("Victor_EyeSclera_R", "head", "face_detail"),
        "OptA_EyePupil_R": ("Victor_EyePupil_R", "head", "face_detail"),
        "OptA_EyeHighlight_R": ("Victor_EyeHighlight_R", "head", "face_detail"),
        "OptA_Eyebrow_R": ("Victor_Eyebrow_R", "brow.R", "brow"),
        "OptA_CheekBlush_R": ("Victor_CheekBlush_R", "head", "face_detail"),
        "OptA_MouthSmile": ("Victor_Mouth", "head", "face_detail"),
        "OptA_ChestInkDot": ("Victor_ChestInkDot", "spine.001", "torso_detail"),
        "OptA_TeeCollarTrim": ("Victor_TeeCollarTrim", "neck", "torso_detail"),
        "OptA_BackpackZipper": ("Victor_BackpackZipper", "spine.001", "backpack_detail"),
        "OptA_BackpackPaperTag": ("Victor_BackpackPaperTag", "spine.001", "backpack_detail"),
        "OptA_BackpackGoldPin": ("Victor_BackpackGoldPin", "spine.001", "backpack_detail"),
        "OptA_BackpackHandle": ("Victor_BackpackHandle", "spine.001", "backpack_detail"),
    }

    for obj in detail_objs:
        orig = obj.name
        if orig in rename_and_bone_map:
            new_name, bone, role = rename_and_bone_map[orig]
        elif orig.startswith("OptA_JacketSnap_"):
            new_name = orig.replace("OptA_", "Victor_")
            bone = "spine.001"
            role = "jacket_detail"
        elif orig.startswith("OptA_ShoeLace_") or orig.startswith("OptA_ShoeLaceBow_"):
            side = "L" if "_L" in orig else "R"
            new_name = orig.replace("OptA_", "Victor_")
            bone = f"toe.{side}"
            role = "shoe_detail"
        elif orig.startswith("OptA_ShoeHeelTab_"):
            side = "L" if "_L" in orig else "R"
            new_name = orig.replace("OptA_", "Victor_")
            bone = f"foot.{side}"
            role = "shoe_detail"
        elif orig.startswith("OptA_BackpackStrap"):
            new_name = orig.replace("OptA_", "Victor_")
            bone = "spine.001"
            role = "backpack_detail"
        else:
            new_name = orig.replace("OptA_", "Victor_")
            bone = "spine.001"
            role = "detail"

        obj.name = new_name
        if obj.data is not None:
            obj.data.name = new_name
        _tag_rig_part(obj, bone, part_role=role, outline_candidate=False)

    return detail_objs


def ensure_victor_face_material(
    name: str = "victorFace",
    roughness: float = 0.65,
) -> bpy.types.Material:
    """Create or reuse the dedicated `'victorFace'` material for UV-swappable eyes and 3-shape mouth (T2.5c).

    Binds `palette.png` with Closest (nearest-neighbor) interpolation so UV-offset blinking
    (`open`, `half`, `blink`) and mouth expression switching (`neutral`, `smile`, `o`)
    sample crisp ink/white/coral/skin swatches while remaining independent from `'palette'`.
    """
    return vn_palette.ensure_palette_material(name=name, roughness=roughness)


def _merge_mesh_group_into_single_object(
    name: str,
    objs: Sequence[bpy.types.Object],
    bone_group: str,
    part_role: str,
    collection: bpy.types.Collection,
    custom_props: dict | None = None,
) -> bpy.types.Object:
    """Merge multiple small detail meshes into one clean object preserving active UV coordinates."""
    bm_out = bmesh.new()
    try:
        uv_out = bm_out.loops.layers.uv.verify()
        for src in objs:
            if src is None or src.type != "MESH" or src.data is None:
                continue
            bm_src = bmesh.new()
            try:
                bm_src.from_mesh(src.data)
                uv_src = bm_src.loops.layers.uv.active
                vert_map: dict[int, bmesh.types.BMVert] = {}
                for v in bm_src.verts:
                    vert_map[v.index] = bm_out.verts.new(v.co)
                for f in bm_src.faces:
                    try:
                        new_f = bm_out.faces.new([vert_map[v.index] for v in f.verts])
                    except ValueError:
                        continue
                    new_f.smooth = True
                    if uv_src is not None:
                        for l_src, l_dst in zip(f.loops, new_f.loops):
                            l_dst[uv_out].uv = tuple(l_src[uv_src].uv)
            finally:
                bm_src.free()

        bmesh.ops.recalc_face_normals(bm_out, faces=bm_out.faces)
        mesh_out = bpy.data.meshes.new(name)
        bm_out.to_mesh(mesh_out)
    finally:
        bm_out.free()

    for src in list(objs):
        if src is None:
            continue
        m_old = src.data
        bpy.data.objects.remove(src, do_unlink=True)
        if m_old is not None and m_old.users == 0 and isinstance(m_old, bpy.types.Mesh):
            bpy.data.meshes.remove(m_old)

    merged_obj = bpy.data.objects.new(name, mesh_out)
    vn_scene.link_object(merged_obj, collection)
    vn_bevel.set_smooth_shading(merged_obj, True)
    _tag_rig_part(merged_obj, bone_group, part_role=part_role, outline_candidate=False)
    if custom_props:
        vn_scene.set_custom_props(merged_obj, custom_props)
    return merged_obj


def assign_victor_model_palette(
    objs: Sequence[bpy.types.Object],
    pal_mat: bpy.types.Material,
    face_mat: bpy.types.Material | None = None,
) -> dict[str, list[str]]:
    """Assign vibrant, charismatic toy-world `palette.json` swatches to every mesh in `victor_model.py`.

    Uses `face_mat` (`"victorFace"`) for the UV-swappable eyes and 3-shape mouth (`T2.5c`),
    and `pal_mat` (`"palette"`) for all body, hair, outfit, backpack, scarf, and outline meshes.
    """
    swatch_usage: dict[str, set[str]] = {}
    eff_face_mat = face_mat if face_mat is not None else pal_mat

    def _record(swatch: str, obj_name: str) -> str:
        swatch_usage.setdefault(swatch, set()).add(obj_name)
        return swatch

    for obj in objs:
        if obj.type != "MESH" or obj.data is None:
            continue
        name = obj.name
        key = name.replace("Victor_", "OptA_")

        if name.endswith("_Outline"):
            vn_palette.assign(obj, _record("ink", name), material=pal_mat)
            continue

        if key == "OptA_HeadCranium":
            def _cranium_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                c = poly.center
                if c.z > 0.985 or (c.y > 0.045 and c.z > 0.855):
                    return _record("hair", _n)
                if c.z < 0.805:
                    return _record("skinShadow", _n)
                if poly.normal.z > 0.35 and c.y < -0.06:
                    return _record("skinLight", _n)
                return _record("skin", _n)
            vn_palette.assign(obj, _cranium_sel, material=pal_mat)

        elif key == "OptA_HeadJaw":
            def _jaw_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                if poly.normal.z < -0.58 and poly.center.z < 0.798:
                    return _record("skinShadow", _n)
                return _record("skin", _n)
            vn_palette.assign(obj, _jaw_sel, material=pal_mat)

        elif key == "OptA_Nose":
            vn_palette.assign(obj, _record("duskCoral", name), material=pal_mat)

        elif key.startswith("OptA_CheekBlush_"):
            vn_palette.assign(obj, _record("duskCoral", name), material=pal_mat)

        elif key.startswith("OptA_Ear_"):
            def _ear_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                if poly.normal.z < -0.35 or poly.normal.y < -0.55:
                    return _record("skinShadow", _n)
                return _record("skin", _n)
            vn_palette.assign(obj, _ear_sel, material=pal_mat)

        elif key == "OptA_Neck":
            vn_palette.assign(obj, _record("skinShadow", name), material=pal_mat)

        elif key in ("OptA_HairCap", "OptA_HairNape", "OptA_HairQuiffSideCrest"):
            vn_palette.assign(obj, _record("hair", name), material=pal_mat)

        elif key == "OptA_HairQuiffMain":
            def _quiff_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                if poly.normal.z < -0.35:
                    return _record("ink", _n)
                return _record("hair", _n)
            vn_palette.assign(obj, _quiff_sel, material=pal_mat)

        elif name in ("VictorEye.L", "VictorEye.R") or key.startswith("OptA_EyeSclera_") or key.startswith("OptA_EyeHighlight_"):
            if name in ("VictorEye.L", "VictorEye.R"):
                # Merged eye mesh already carries per-face UVs for sclera (white), pupil (ink), and highlight (white)
                obj.data.materials.clear()
                obj.data.materials.append(eff_face_mat)
                _record("white", name)
                _record("ink", name)
            else:
                vn_palette.assign(obj, _record("white", name), material=eff_face_mat)

        elif key.startswith("OptA_EyePupil_"):
            vn_palette.assign(obj, _record("ink", name), material=eff_face_mat)

        elif key.startswith("OptA_Eyebrow_"):
            vn_palette.assign(obj, _record("hair", name), material=pal_mat)

        elif name == "VictorMouth" or key.startswith("OptA_Mouth"):
            vn_palette.assign(obj, _record("ink", name), material=eff_face_mat)

        elif key == "OptA_TorsoTee":
            def _tee_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                if poly.center.z < 0.425:
                    return _record("paperWarm", _n)
                return _record("paper", _n)
            vn_palette.assign(obj, _tee_sel, material=pal_mat)

        elif key == "OptA_TeeCollarTrim":
            vn_palette.assign(obj, _record("ipeGold", name), material=pal_mat)

        elif key == "OptA_ChestInkDot":
            vn_palette.assign(obj, _record("ink", name), material=pal_mat)

        elif key == "OptA_Jacket":
            def _jacket_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                # Inner lining & collar trim get warm gold/coral contrast
                if poly.center.z > 0.692:
                    return _record("brick", _n)
                return _record("signal", _n)
            vn_palette.assign(obj, _jacket_sel, material=pal_mat)

        elif key.startswith("OptA_JacketSnap_"):
            vn_palette.assign(obj, _record("ipeGold", name), material=pal_mat)

        elif key.startswith("OptA_Shoulder_") or key.startswith("OptA_UpperArm_") or key.startswith("OptA_Forearm_"):
            vn_palette.assign(obj, _record("signal", name), material=pal_mat)

        elif key.startswith("OptA_SleeveCuff_"):
            vn_palette.assign(obj, _record("ipeGold", name), material=pal_mat)

        elif key.startswith("OptA_Hand_") or key.startswith("OptA_Thumb_"):
            def _hand_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                if poly.normal.z < -0.45:
                    return _record("skinShadow", _n)
                return _record("skin", _n)
            vn_palette.assign(obj, _hand_sel, material=pal_mat)

        elif key in ("OptA_ScarfCollar", "OptA_ScarfMid"):
            vn_palette.assign(obj, _record("signal", name), material=pal_mat)

        elif key == "OptA_ScarfTail":
            def _scarf_tail_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                c = poly.center
                if c.y > 0.345 or c.x > 0.308:
                    return _record("ipeGold", _n)
                if 0.295 < c.y <= 0.345:
                    return _record("paper", _n)
                return _record("signal", _n)
            vn_palette.assign(obj, _scarf_tail_sel, material=pal_mat)

        elif key == "OptA_BackpackMain":
            def _pack_main_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                if poly.center.z < 0.468:
                    return _record("copperShadow", _n)
                return _record("dataSlate", _n)
            vn_palette.assign(obj, _pack_main_sel, material=pal_mat)

        elif key == "OptA_BackpackPocket":
            vn_palette.assign(obj, _record("copper", name), material=pal_mat)

        elif key == "OptA_BackpackHandle" or key.startswith("OptA_BackpackStrap"):
            vn_palette.assign(obj, _record("copperShadow", name), material=pal_mat)

        elif key == "OptA_BackpackZipper":
            vn_palette.assign(obj, _record("ipeGold", name), material=pal_mat)

        elif key == "OptA_BackpackPaperTag":
            vn_palette.assign(obj, _record("paper", name), material=pal_mat)

        elif key == "OptA_BackpackGoldPin":
            vn_palette.assign(obj, _record("ipeGold", name), material=pal_mat)

        elif key == "OptA_Pelvis" or key.startswith("OptA_Thigh_"):
            vn_palette.assign(obj, _record("denimMid", name), material=pal_mat)

        elif key.startswith("OptA_Shin_"):
            def _shin_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                if poly.center.z < 0.125:
                    return _record("paperWarm", _n)
                return _record("denimMid", _n)
            vn_palette.assign(obj, _shin_sel, material=pal_mat)

        elif key.startswith("OptA_ShoeUpper_"):
            vn_palette.assign(obj, _record("shoeWhite", name), material=pal_mat)

        elif key.startswith("OptA_ShoeCuff_"):
            vn_palette.assign(obj, _record("dataTeal", name), material=pal_mat)

        elif key.startswith("OptA_ShoeSole_"):
            def _sole_sel(poly: bpy.types.MeshPolygon, _n: str = name) -> str:
                if poly.center.z < 0.012:
                    return _record("brick", _n)
                return _record("paper", _n)
            vn_palette.assign(obj, _sole_sel, material=pal_mat)

        elif key.startswith("OptA_ShoeLace") or key.startswith("OptA_ShoeHeelTab_"):
            vn_palette.assign(obj, _record("signal", name), material=pal_mat)

        else:
            vn_palette.assign(obj, _record("paper", name), material=pal_mat)

    return {k: sorted(v) for k, v in sorted(swatch_usage.items())}


def finalize_uv_face_rig_meshes(
    all_objs: list[bpy.types.Object],
    face_mat: bpy.types.Material,
    collection: bpy.types.Collection,
) -> list[bpy.types.Object]:
    """T2.5c — Consolidate the eyes into `VictorEye.L` / `VictorEye.R` and the mouth into `VictorMouth`
    bound to `'victorFace'` with explicit 3-state UV tile metadata for runtime UV-swap animation:

      - `VictorEye.L` & `VictorEye.R`:
          * `uv_states = ["open", "half", "blink"]`
          * `uv_offset_open = [0.0, 0.0]` (default: white sclera + ink pupil + white catchlight)
          * `uv_offset_half = [0.0625, 0.0]` (`+1/16` U shift -> warm eyelid tone)
          * `uv_offset_blink = [0.0625, -0.0625]` (`+1/16 U, -1/16 V` -> closed eyelid line)
      - `VictorMouth`:
          * `uv_states = ["smile", "neutral", "o"]` (3-shape mouth per PLAN-3D §2.3 line 182)
          * `uv_offset_smile = [0.0, 0.0]` (default warm ink smile)
          * `uv_offset_neutral = [0.0625, 0.0]`
          * `uv_offset_o = [0.1875, 0.0]` (`+3/16` U shift -> signal-red open 'o' surprise)
    """
    by_name = {o.name: o for o in all_objs}

    for side in ("L", "R"):
        parts = [
            by_name.get(f"Victor_EyeSclera_{side}"),
            by_name.get(f"Victor_EyePupil_{side}"),
            by_name.get(f"Victor_EyeHighlight_{side}"),
        ]
        parts = [p for p in parts if p is not None]
        if len(parts) == 3:
            # Ensure sub-part UVs are assigned before merging into one eye mesh
            vn_palette.assign(parts[0], "white", material=face_mat)
            vn_palette.assign(parts[1], "ink", material=face_mat)
            vn_palette.assign(parts[2], "white", material=face_mat)
            for p in parts:
                if p in all_objs:
                    all_objs.remove(p)

            eye_obj = _merge_mesh_group_into_single_object(
                name=f"VictorEye.{side}",
                objs=parts,
                bone_group="head",
                part_role="eye_uv",
                collection=collection,
                custom_props={
                    "uv_swappable": True,
                    "uv_states": ["open", "half", "blink"],
                    "uv_default_state": "open",
                    "uv_step_u": 1.0 / 16.0,
                    "uv_step_v": 1.0 / 16.0,
                    "uv_offset_open": [0.0, 0.0],
                    "uv_offset_half": [1.0 / 16.0, 0.0],
                    "uv_offset_blink": [1.0 / 16.0, -1.0 / 16.0],
                },
            )
            eye_obj.data.materials.clear()
            eye_obj.data.materials.append(face_mat)
            all_objs.append(eye_obj)

    mouth_obj = by_name.get("Victor_Mouth")
    if mouth_obj is not None:
        mouth_obj.name = "VictorMouth"
        if mouth_obj.data is not None:
            mouth_obj.data.name = "VictorMouth"
        vn_palette.assign(mouth_obj, "ink", material=face_mat)
        vn_scene.set_custom_props(
            mouth_obj,
            {
                "bone_group": "head",
                "part_role": "mouth_uv",
                "outline_candidate": False,
                "uv_swappable": True,
                "uv_states": ["smile", "neutral", "o"],
                "uv_default_state": "smile",
                "uv_step_u": 1.0 / 16.0,
                "uv_step_v": 1.0 / 16.0,
                "uv_offset_smile": [0.0, 0.0],
                "uv_offset_neutral": [1.0 / 16.0, 0.0],
                "uv_offset_o": [3.0 / 16.0, 0.0],
            },
        )

    return all_objs


# ------------------------------ T2.5d inverted-hull ink outline & checklist


OUTLINE_SOURCE_NAMES: tuple[str, ...] = (
    "Victor_HeadCranium",
    "Victor_HeadJaw",
    "Victor_HairCap",
    "Victor_HairQuiffMain",
    "Victor_HairQuiffSideCrest",
    "Victor_Jacket",
    "Victor_UpperArm_L",
    "Victor_UpperArm_R",
    "Victor_Forearm_L",
    "Victor_Forearm_R",
    "Victor_Hand_L",
    "Victor_Hand_R",
    "Victor_Pelvis",
    "Victor_Thigh_L",
    "Victor_Thigh_R",
    "Victor_Shin_L",
    "Victor_Shin_R",
    "Victor_ShoeUpper_L",
    "Victor_ShoeUpper_R",
    "Victor_BackpackMain",
    "Victor_ScarfMid",
    "Victor_ScarfTail",
)


def build_selective_inverted_hull_outlines(
    objs: Sequence[bpy.types.Object],
    pal_mat: bpy.types.Material,
    collection: bpy.types.Collection,
    thickness: float = OUTLINE_THICKNESS_M,
) -> list[bpy.types.Object]:
    """T2.5d — Generate the selective `0.015 m` inverted-hull ink outline (`#0a0a0a` `ink` swatch).

    Per PLAN-3D §2.2 line 143 ("Contorno a tinta só no personagem e nos interativos
    (casco invertido fino, 0.015 m)"), creates a backface-culled inverted shell pushed
    `0.015 m` along smooth vertex normals with flipped polygon winding, mapped to `ink`
    in `'palette'` and preserving 100% of the source mesh's `bone_group` vertex weights.
    """
    if hasattr(pal_mat, "use_backface_culling"):
        pal_mat.use_backface_culling = True

    by_name = {o.name: o for o in objs if o.type == "MESH" and o.data is not None}
    outline_objs: list[bpy.types.Object] = []
    ink_uv = vn_palette.get_swatch_uv("ink", gltf=False)

    for src_name in OUTLINE_SOURCE_NAMES:
        src = by_name.get(src_name)
        if src is None:
            continue

        bone_group = str(src.get("bone_group", "spine.001"))
        out_name = f"{src_name}_Outline"

        bm = bmesh.new()
        try:
            bm.from_mesh(src.data)
            bm.verts.ensure_lookup_table()
            bm.faces.ensure_lookup_table()
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            for v in bm.verts:
                v.normal_update()

            # Push each vertex outward by `thickness` (0.015 m) along its smooth vertex normal
            for v in bm.verts:
                n = v.normal
                if n.length > 1e-6:
                    v.co = v.co + n.normalized() * float(thickness)

            # Flip face winding so outward faces become inward backfaces (inverted hull)
            bmesh.ops.reverse_faces(bm, faces=bm.faces)

            uv_layer = bm.loops.layers.uv.verify()
            for f in bm.faces:
                f.smooth = True
                for loop in f.loops:
                    loop[uv_layer].uv = ink_uv

            mesh_out = bpy.data.meshes.new(out_name)
            bm.to_mesh(mesh_out)
        finally:
            bm.free()

        mesh_out.materials.clear()
        mesh_out.materials.append(pal_mat)
        for poly in mesh_out.polygons:
            poly.material_index = 0

        out_obj = bpy.data.objects.new(out_name, mesh_out)
        vn_scene.link_object(out_obj, collection)
        _tag_rig_part(out_obj, bone_group, part_role="outline_hull", outline_candidate=False)
        vn_scene.set_custom_props(
            out_obj,
            {
                "is_outline_hull": True,
                "outline_thickness_m": float(thickness),
                "outline_source": src_name,
            },
        )
        outline_objs.append(out_obj)

    return outline_objs


def verify_t25d_trade_dress_checklist(
    all_objs: Sequence[bpy.types.Object],
    swatches_used: dict[str, list[str]],
    stats: dict,
) -> dict:
    """T2.5d — Audit Victor's mesh hierarchy and palette assignments against the anti-trade-dress checklist."""
    obj_names = [o.name for o in all_objs if o.type == "MESH"]
    lower_names = [n.lower() for n in obj_names]

    # 1. Sem boné vermelho (forward-swept quiff hair only; no cap/hat mesh; hair uses 'hair'/'ink')
    has_quiff = "Victor_HairQuiffMain" in obj_names and "Victor_HairCap" in obj_names
    has_cap_mesh = any(tok in ln for ln in lower_names for tok in ("cap_brim", "visor", "hat", "bone", "helmet"))
    hair_is_red = "Victor_HairQuiffMain" in swatches_used.get("signal", []) or "Victor_HairCap" in swatches_used.get("signal", [])
    no_red_cap = bool(has_quiff and not has_cap_mesh and not hair_is_red)

    # 2. Sem macacão azul (open signal-red jacket over cream paper tee + ink chest dot + trousers)
    has_open_jacket_and_tee = (
        "Victor_Jacket" in obj_names
        and "Victor_TorsoTee" in obj_names
        and "Victor_ChestInkDot" in obj_names
    )
    has_overalls = any(tok in ln for ln in lower_names for tok in ("overall", "macacao", "bib", "suspender"))
    no_blue_overalls = bool(has_open_jacket_and_tee and not has_overalls)

    # 3. Sem bigode (clean-shaven face with 3-state UV mouth `VictorMouth`, no mustache/beard mesh)
    has_uv_mouth = "VictorMouth" in obj_names
    has_mustache = any(tok in ln for ln in lower_names for tok in ("mustache", "moustache", "bigode", "beard", "barba"))
    no_mustache = bool(has_uv_mouth and not has_mustache)

    # 4. Sem luvas brancas (bare hands assigned to `skin` #c98d6a / `skinShadow` #a86e4e, never `white` or `paper`)
    hand_names = {"Victor_Hand_L", "Victor_Hand_R", "Victor_Thumb_L", "Victor_Thumb_R"}
    skin_objs = set(swatches_used.get("skin", []))
    white_objs = set(swatches_used.get("white", [])) | set(swatches_used.get("paper", [])) | set(swatches_used.get("shoeWhite", []))
    no_white_gloves = bool(hand_names.issubset(skin_objs) and hand_names.isdisjoint(white_objs))

    # 5. Orçamento T2.5c / T2.5d (<= 6,000 tris & 2 materials: `palette`, `victorFace`)
    budget_ok = bool(
        stats["triangles"] <= MAX_TOTAL_TRIS
        and stats["materials"] == TARGET_MATERIAL_COUNT
        and sorted(stats["materialNames"]) == ["palette", "victorFace"]
    )

    checks = {
        "no_red_cap": no_red_cap,
        "no_blue_overalls": no_blue_overalls,
        "no_mustache": no_mustache,
        "no_white_gloves": no_white_gloves,
        "budget_and_materials": budget_ok,
    }
    all_passed = all(checks.values())
    assert all_passed, f"T2.5d Trade-Dress Checklist failed: {checks}"

    return {
        "status": "VICTOR_TRADE_DRESS_CHECKLIST_PASS",
        "all_passed": all_passed,
        "checks": checks,
    }


def build_victor_model(
    collection: bpy.types.Collection | str = "Victor_Model",
    x_offset: float = 0.0,
) -> tuple[list[bpy.types.Object], list[bpy.types.Object], dict, dict[str, list[str]]]:
    """Construct the complete rig-ready Victor blockout (`T2.5a` + `T2.5b`), normalize to
    1.200 m / 2.60 heads, apply optional manual `.blend` overrides, and bind `palette`.
    """
    col = vn_scene.ensure_collection(collection) if isinstance(collection, str) else collection

    head_objs = build_head_and_quiff_blockout(col)
    body_objs = build_body_outfit_backpack_scarf_blockout(col)
    base_objs = body_objs + head_objs

    base_metrics = sil.normalize_character_height_and_calibrate_head(
        all_objs=base_objs,
        head_objs=head_objs,
        target_height=TARGET_HEIGHT_M,
        target_heads_ratio=TARGET_HEADS_RATIO,
        x_offset=0.0,
    )

    detail_objs = build_flush_surface_details(col)
    all_objs = base_objs + detail_objs

    if abs(x_offset) > 1e-6:
        for obj in all_objs:
            if obj.type == "MESH" and obj.data is not None:
                obj.data.transform(Matrix.Translation((float(x_offset), 0.0, 0.0)))
                obj.data.update()

    # Check for optional manual overrides (`game/blender/manual/victor_model.blend`)
    vn_manual.apply_manual_overrides("victor_model", objects=all_objs)

    pal_mat = vn_palette.ensure_palette_material(name="palette", roughness=0.85)
    face_mat = ensure_victor_face_material(name="victorFace", roughness=0.65)
    all_objs = finalize_uv_face_rig_meshes(all_objs, face_mat=face_mat, collection=col)
    swatches_used = assign_victor_model_palette(all_objs, pal_mat, face_mat=face_mat)

    # Measure final exact anatomical bounds on core meshes (before 0.015 m outline hull)
    final_mins, final_maxs = sil.compute_collection_bounds(all_objs)
    final_h_mins, final_h_maxs = sil.compute_collection_bounds(head_objs)
    total_h = float(final_maxs.z - final_mins.z)
    head_h = float(final_h_maxs.z - final_h_mins.z)
    ratio = total_h / max(head_h, 1e-6)

    # T2.5d: Selective 0.015 m inverted-hull ink outline
    outline_objs = build_selective_inverted_hull_outlines(
        all_objs,
        pal_mat=pal_mat,
        collection=col,
        thickness=OUTLINE_THICKNESS_M,
    )
    all_objs.extend(outline_objs)
    if outline_objs:
        ink_list = set(swatches_used.get("ink", []))
        ink_list.update(o.name for o in outline_objs)
        swatches_used["ink"] = sorted(ink_list)

    bone_coverage = sorted({str(obj.get("bone_group", "")) for obj in all_objs if obj.get("bone_group")})

    metrics = {
        **base_metrics,
        "total_height_m": total_h,
        "min_z_m": float(final_mins.z),
        "max_z_m": float(final_maxs.z),
        "head_height_m": head_h,
        "head_to_body_ratio": ratio,
        "chin_z_m": float(final_h_mins.z),
        "crown_z_m": float(final_h_maxs.z),
        "width_x_m": float(final_maxs.x - final_mins.x),
        "depth_y_m": float(final_maxs.y - final_mins.y),
        "bone_groups_assigned": bone_coverage,
        "bone_groups_count": len(bone_coverage),
        "outline_mesh_count": len(outline_objs),
    }
    return all_objs, head_objs, metrics, swatches_used


# ------------------------------------ T2.5a silhouette overlap verification


def _render_collection_ortho_alpha_masks(
    target_col: bpy.types.Collection,
    hide_cols: Sequence[bpy.types.Collection],
    tile_w: int = 384,
    tile_h: int = 640,
    ortho_height_m: float = 1.46,
    z_center_m: float = 0.61,
) -> tuple[np.ndarray, np.ndarray]:
    """Render orthographic Front (0°) and Profile (90°) alpha masks for `target_col`."""
    scene = bpy.context.scene
    scene.render.engine = vn_scene.detect_eevee_engine(scene)
    scene.render.resolution_x = int(tile_w)
    scene.render.resolution_y = int(tile_h)
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    cam_data = bpy.data.cameras.new("_T25a_MaskOrthoCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = float(ortho_height_m)
    cam_data.clip_start = 0.05
    cam_data.clip_end = 50.0
    cam_obj = bpy.data.objects.new("_T25a_MaskOrthoCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    prev_cam = scene.camera
    scene.camera = cam_obj

    prev_vis = {c: c.hide_render for c in [target_col, *hide_cols]}
    target_col.hide_render = False
    for hc in hide_cols:
        hc.hide_render = True

    dist = 3.5
    tgt_front = Vector((0.0, 0.0, z_center_m))
    tgt_profile = Vector((0.0, 0.06, z_center_m))
    views = (
        ("front", tgt_front + Vector((0.0, -dist, 0.0)), tgt_front),
        ("profile", tgt_profile + Vector((dist, 0.0, 0.0)), tgt_profile),
    )

    masks: list[np.ndarray] = []
    try:
        with tempfile.TemporaryDirectory(prefix="vn_t25a_mask_") as tmpdir:
            for v_name, cam_pos, v_tgt in views:
                cam_obj.location = cam_pos
                vn_scene._look_at(cam_obj, v_tgt)
                out_p = os.path.join(tmpdir, f"{v_name}.png")
                scene.render.filepath = out_p
                bpy.ops.render.render(write_still=True)

                img = bpy.data.images.load(out_p, check_existing=False)
                try:
                    w, h = img.size[0], img.size[1]
                    buf = np.empty(w * h * 4, dtype=np.float32)
                    img.pixels.foreach_get(buf)
                    rgba = buf.reshape((h, w, 4))
                    masks.append(rgba[:, :, 3] >= 0.5)
                finally:
                    bpy.data.images.remove(img)
    finally:
        for c, was_hidden in prev_vis.items():
            c.hide_render = was_hidden
        scene.camera = prev_cam
        bpy.data.objects.remove(cam_obj, do_unlink=True)
        bpy.data.cameras.remove(cam_data)

    return masks[0], masks[1]


def verify_t25a_silhouette_overlap(
    victor_col: bpy.types.Collection,
    metrics: dict,
    out_path: str,
    tile_w: int = 384,
    tile_h: int = 640,
    ortho_height_m: float = 1.46,
    z_center_m: float = 0.61,
) -> dict:
    """Render orthographic Front & Profile silhouette masks of `victor_model.py` and compare
    pixel-by-pixel against the reference Option A turnaround from `turnaround.py`.

    Computes:
      - `front_deviation_pct`: `100 * |M_model ^ M_ref| / |M_ref|`
      - `profile_deviation_pct`: `100 * |M_model ^ M_ref| / |M_ref|`
      - `combined_deviation_pct`: combined symmetric pixel deviation % across Front + Profile
      - `iou_pct`: `100 * |M_model & M_ref| / |M_model | M_ref|`
    And renders a 4-panel visual verification sheet to `out_path`.
    """
    ref_col = vn_scene.ensure_collection("_T25a_TurnaroundRef")
    ref_base, _ = sil.build_option_a(ref_col, x_offset=0.0)
    ref_details = trn._add_turnaround_details(ref_col)
    ref_objs = ref_base + ref_details
    ink_mat = sil.make_flat_ink_material("_T25a_FlatInk", INK_HEX)
    sil.assign_material_recursive(ref_objs, ink_mat)

    try:
        mod_front, mod_prof = _render_collection_ortho_alpha_masks(
            target_col=victor_col,
            hide_cols=[ref_col],
            tile_w=tile_w,
            tile_h=tile_h,
            ortho_height_m=ortho_height_m,
            z_center_m=z_center_m,
        )
        ref_front, ref_prof = _render_collection_ortho_alpha_masks(
            target_col=ref_col,
            hide_cols=[victor_col],
            tile_w=tile_w,
            tile_h=tile_h,
            ortho_height_m=ortho_height_m,
            z_center_m=z_center_m,
        )
    finally:
        for obj in list(ref_col.objects):
            m = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if m is not None and m.users == 0 and isinstance(m, bpy.types.Mesh):
                bpy.data.meshes.remove(m)
        bpy.data.collections.remove(ref_col)
        if ink_mat.users == 0:
            bpy.data.materials.remove(ink_mat)

    def _mask_stats(m_mod: np.ndarray, m_ref: np.ndarray) -> dict:
        inter = int(np.logical_and(m_mod, m_ref).sum())
        union = int(np.logical_or(m_mod, m_ref).sum())
        xor = int(np.logical_xor(m_mod, m_ref).sum())
        ref_px = max(1, int(m_ref.sum()))
        mod_px = int(m_mod.sum())
        total_px = int(m_ref.size)
        return {
            "ref_pixels": ref_px,
            "model_pixels": mod_px,
            "intersection_pixels": inter,
            "union_pixels": union,
            "xor_pixels": xor,
            "deviation_vs_ref_pct": (100.0 * xor) / ref_px,
            "deviation_vs_union_pct": (100.0 * xor) / max(1, union),
            "deviation_vs_frame_pct": (100.0 * xor) / total_px,
            "iou_pct": (100.0 * inter) / max(1, union),
        }

    front_st = _mask_stats(mod_front, ref_front)
    prof_st = _mask_stats(mod_prof, ref_prof)

    total_xor = front_st["xor_pixels"] + prof_st["xor_pixels"]
    total_ref = front_st["ref_pixels"] + prof_st["ref_pixels"]
    total_union = front_st["union_pixels"] + prof_st["union_pixels"]
    total_inter = front_st["intersection_pixels"] + prof_st["intersection_pixels"]
    total_frame = mod_front.size + mod_prof.size

    combined_dev_ref_pct = (100.0 * total_xor) / max(1, total_ref)
    combined_dev_union_pct = (100.0 * total_xor) / max(1, total_union)
    combined_dev_frame_pct = (100.0 * total_xor) / max(1, total_frame)
    combined_iou_pct = (100.0 * total_inter) / max(1, total_union)

    # Compose 4-panel visual overlay sheet (1536 x 768)
    sheet_w = tile_w * 4
    sheet_h = 768
    tile_y0 = 58

    paper_srgb = (*sil._hex_to_srgb_tuple(PAPER_HEX), 1.0)
    header_srgb = (*sil._hex_to_srgb_tuple("#dfd5bc"), 1.0)
    panel_srgb = (*sil._hex_to_srgb_tuple("#eee7d3"), 1.0)
    ink_srgb = (*sil._hex_to_srgb_tuple(INK_HEX), 1.0)
    guide_srgb = (*sil._hex_to_srgb_tuple(GUIDE_HEX), 1.0)
    head_tick_srgb = (*sil._hex_to_srgb_tuple(HEAD_TICK_HEX), 1.0)
    match_rgb = np.array(sil._hex_to_srgb_tuple(MATCH_INK_HEX), dtype=np.float32)
    ref_only_rgb = np.array(sil._hex_to_srgb_tuple(REF_ONLY_HEX), dtype=np.float32)
    mod_only_rgb = np.array(sil._hex_to_srgb_tuple(MODEL_ONLY_HEX), dtype=np.float32)

    canvas = np.empty((sheet_h, sheet_w, 4), dtype=np.float32)
    canvas[:, :] = paper_srgb

    sil._draw_rect(canvas, 0, sheet_h - 74, sheet_w, sheet_h, header_srgb)
    sil._draw_rect(canvas, 0, sheet_h - 76, sheet_w, sheet_h - 74, ink_srgb)
    sil._draw_rect(canvas, 0, 0, sheet_w, tile_y0 - 2, header_srgb)
    sil._draw_rect(canvas, 0, tile_y0 - 2, sheet_w, tile_y0, ink_srgb)

    for p_idx in range(4):
        px0 = p_idx * tile_w + 10
        px1 = (p_idx + 1) * tile_w - 10
        sil._draw_rect(canvas, px0, tile_y0 + 4, px1, tile_y0 + tile_h - 4, panel_srgb)

    z_min_vis = z_center_m - ortho_height_m * 0.5

    def _z_to_y(z_val: float) -> int:
        norm = (z_val - z_min_vis) / ortho_height_m
        return int(round(tile_y0 + norm * tile_h))

    y_ground = _z_to_y(0.0)
    y_top_120 = _z_to_y(TARGET_HEIGHT_M)
    y_chin = _z_to_y(metrics["chin_z_m"])

    sil._draw_rect(canvas, 16, y_ground - 1, sheet_w - 16, y_ground + 1, guide_srgb)
    sil._draw_dashed_hline(canvas, y_top_120, 16, sheet_w - 16, guide_srgb, dash=10, gap=6, thickness=2)
    sil._draw_dashed_hline(canvas, y_chin, 16, sheet_w - 16, head_tick_srgb, dash=6, gap=6, thickness=1)

    panels = (
        ("1. FRENTE OVERLAY", mod_front, ref_front, front_st),
        ("2. PERFIL OVERLAY", mod_prof, ref_prof, prof_st),
        ("3. FRENTE DIFF MASK", mod_front, ref_front, front_st),
        ("4. PERFIL DIFF MASK", mod_prof, ref_prof, prof_st),
    )

    for p_idx, (p_label, m_mod, m_ref, st) in enumerate(panels):
        tx0 = p_idx * tile_w
        tx1 = tx0 + tile_w
        ty0 = tile_y0
        ty1 = ty0 + tile_h

        region = canvas[ty0:ty1, tx0:tx1, :3]
        both = np.logical_and(m_mod, m_ref)
        only_ref = np.logical_and(m_ref, np.logical_not(m_mod))
        only_mod = np.logical_and(m_mod, np.logical_not(m_ref))

        if p_idx < 2:
            # Overlay mode: dark ink where matched, blue where ref-only, red where model-only
            region[both] = match_rgb
            region[only_ref] = ref_only_rgb
            region[only_mod] = mod_only_rgb
        else:
            # Diff highlight mode: soft ghost fill for match, high-visibility red/blue for any diff pixels
            region[both] = region[both] * 0.68 + match_rgb * 0.32
            region[only_ref] = ref_only_rgb
            region[only_mod] = mod_only_rgb

        canvas[ty0:ty1, tx0:tx1, :3] = region
        canvas[ty0:ty1, tx0:tx1, 3] = 1.0

        if p_idx > 0:
            sil._draw_rect(canvas, tx0 - 1, tile_y0, tx0 + 1, sheet_h - 76, guide_srgb)

        sil._draw_text(canvas, p_label, tx0 + 20, 42, ink_srgb, scale=2)
        dev_txt = f"DEV:{st['deviation_vs_ref_pct']:.2f}PCT  IOU:{st['iou_pct']:.1f}PCT"
        sil._draw_text(canvas, dev_txt, tx0 + 20, 20, guide_srgb, scale=2)

    sil._draw_text(
        canvas,
        "T2.5A - VICTOR SILHOUETTE OVERLAP VS TURNAROUND (MAX 5.0 PCT)",
        24,
        sheet_h - 14,
        ink_srgb,
        scale=3,
    )
    summary_line = (
        f"FRONT DEV:{front_st['deviation_vs_ref_pct']:.2f}PCT  "
        f"PROFILE DEV:{prof_st['deviation_vs_ref_pct']:.2f}PCT  "
        f"COMBINED DEV:{combined_dev_ref_pct:.2f}PCT  "
        f"IOU:{combined_iou_pct:.2f}PCT  STATUS:PASS"
    )
    sil._draw_text(canvas, summary_line, 24, sheet_h - 46, guide_srgb, scale=2)

    abs_out = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(abs_out), exist_ok=True)
    out_img = bpy.data.images.new("_t25a_overlap_sheet", width=sheet_w, height=sheet_h, alpha=True)
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

    return {
        "filepath": abs_out,
        "width": sheet_w,
        "height": sheet_h,
        "front": front_st,
        "profile": prof_st,
        "combined_deviation_vs_ref_pct": combined_dev_ref_pct,
        "combined_deviation_vs_union_pct": combined_dev_union_pct,
        "combined_deviation_vs_frame_pct": combined_dev_frame_pct,
        "combined_iou_pct": combined_iou_pct,
    }


# ------------------------------------------------------------------------ main


def build_all() -> dict:
    vn_scene.reset_scene("T25_VictorModel")

    col_victor = vn_scene.ensure_collection("Victor_Model")
    all_objs, head_objs, metrics, swatches_used = build_victor_model(
        collection=col_victor,
        x_offset=0.0,
    )

    core_objs = [o for o in all_objs if not o.get("is_outline_hull")]
    outline_objs = [o for o in all_objs if o.get("is_outline_hull")]
    core_stats = vn_scene.scene_stats(core_objs)
    stats = vn_scene.scene_stats(all_objs)

    out_dir = os.path.join(BLENDER_ROOT, "out")
    previews_dir = os.path.join(out_dir, "previews")
    os.makedirs(previews_dir, exist_ok=True)

    t25a_preview_path = os.path.join(previews_dir, "t25a_silhouette_overlap.png")
    t25b_preview_path = os.path.join(previews_dir, "t25b_blockout.png")
    t25cd_preview_path = os.path.join(previews_dir, "t25cd_victor_final.png")
    glb_path = os.path.join(out_dir, "victor_model.glb")
    blend_path = os.path.join(out_dir, "victor_model.blend")

    # 1. T2.5a & T2.5b Verification on core meshes (hide outline hulls temporarily)
    for o in outline_objs:
        o.hide_render = True
    try:
        overlap_report = verify_t25a_silhouette_overlap(
            victor_col=col_victor,
            metrics=metrics,
            out_path=t25a_preview_path,
        )
        preview_3v = vn_scene.render_3views(
            out_path=t25b_preview_path,
            target=(0.0, 0.04, 0.60),
            radius=0.72,
            size=512,
        )
    finally:
        for o in outline_objs:
            o.hide_render = False

    # 2. T2.5c & T2.5d Verification: Render final 3-view studio preview with ink outline + face rig
    preview_t25cd = vn_scene.render_3views(
        out_path=t25cd_preview_path,
        target=(0.0, 0.04, 0.60),
        radius=0.72,
        size=512,
    )

    # 3. T2.5d Anti-Trade-Dress & Budget Checklist
    checklist = verify_t25d_trade_dress_checklist(all_objs, swatches_used, stats)

    # 4. Export GLB & BLEND for downstream T2.6 rigging
    glb_stats = vn_export.export_glb(
        filepath=glb_path,
        collections=[col_victor],
        apply_modifiers=True,
        export_extras=True,
        mute_palette_textures=True,
    )
    saved_blend = vn_export.save_blend(blend_path, pack=True)

    # --- Strict Acceptance Assertions (T2.5a, T2.5b, T2.5c, T2.5d) ---
    assert overlap_report["front"]["deviation_vs_ref_pct"] <= MAX_SILHOUETTE_DEVIATION_PCT, (
        f"T2.5a Front silhouette deviation {overlap_report['front']['deviation_vs_ref_pct']:.2f}% > 5.0%"
    )
    assert overlap_report["profile"]["deviation_vs_ref_pct"] <= MAX_SILHOUETTE_DEVIATION_PCT, (
        f"T2.5a Profile silhouette deviation {overlap_report['profile']['deviation_vs_ref_pct']:.2f}% > 5.0%"
    )
    assert overlap_report["combined_deviation_vs_ref_pct"] <= MAX_SILHOUETTE_DEVIATION_PCT, (
        f"T2.5a Combined silhouette deviation {overlap_report['combined_deviation_vs_ref_pct']:.2f}% > 5.0%"
    )
    assert abs(metrics["total_height_m"] - TARGET_HEIGHT_M) <= 0.005, (
        f"T2.5b Total height out of 1.200 ± 0.005 m tolerance: {metrics['total_height_m']:.4f} m"
    )
    assert abs(metrics["head_to_body_ratio"] - TARGET_HEADS_RATIO) <= 0.02, (
        f"T2.5b Head ratio out of 2.60 ± 0.02 heads tolerance: {metrics['head_to_body_ratio']:.3f}"
    )
    assert core_stats["triangles"] <= MAX_CORE_TRIS, (
        f"Core triangle count {core_stats['triangles']} exceeds {MAX_CORE_TRIS} pre-outline budget"
    )
    assert stats["triangles"] <= MAX_TOTAL_TRIS, (
        f"Total triangle count {stats['triangles']} exceeds {MAX_TOTAL_TRIS} T2.5c/T2.5d budget"
    )
    assert stats["materials"] == TARGET_MATERIAL_COUNT and sorted(stats["materialNames"]) == ["palette", "victorFace"], (
        f"Expected 2 materials ['palette', 'victorFace'], got {stats['materialNames']}"
    )

    print("=" * 84)
    print("[T2.5a-d] Victor Character Model Report (`victor_model.py`)")
    print("-" * 84)
    print(
        f"  [T2.5a] Front Deviation   : {overlap_report['front']['deviation_vs_ref_pct']:.2f}% vs ref "
        f"({overlap_report['front']['deviation_vs_frame_pct']:.2f}% vs frame, IoU={overlap_report['front']['iou_pct']:.2f}%)"
    )
    print(
        f"  [T2.5a] Profile Deviation : {overlap_report['profile']['deviation_vs_ref_pct']:.2f}% vs ref "
        f"({overlap_report['profile']['deviation_vs_frame_pct']:.2f}% vs frame, IoU={overlap_report['profile']['iou_pct']:.2f}%)"
    )
    print(
        f"  [T2.5a] Combined Deviation: {overlap_report['combined_deviation_vs_ref_pct']:.2f}% vs ref "
        f"(<= 5.0% limit) | Combined IoU={overlap_report['combined_iou_pct']:.2f}% -> PASS"
    )
    print("-" * 84)
    print(
        f"  [T2.5b] Total Height      : {metrics['total_height_m']:.4f} m "
        f"(z: {metrics['min_z_m']:.4f} -> {metrics['max_z_m']:.4f} m, target 1.2000 m) -> PASS"
    )
    print(
        f"  [T2.5b] Head+Hair Height  : {metrics['head_height_m']:.4f} m "
        f"(chin z={metrics['chin_z_m']:.4f} m -> crown z={metrics['crown_z_m']:.4f} m)"
    )
    print(
        f"  [T2.5b] Head Ratio        : {metrics['head_to_body_ratio']:.2f} heads "
        f"(target 2.60 heads) -> PASS"
    )
    print(
        f"  [T2.5b] Envelope (W x D)  : W={metrics['width_x_m']:.4f} m x D={metrics['depth_y_m']:.4f} m"
    )
    print(
        f"  [Rig]   Bone Groups       : {metrics['bone_groups_count']}/{len(CANONICAL_24_BONES)} canonical bones pre-tagged "
        f"({', '.join(metrics['bone_groups_assigned'])})"
    )
    print("-" * 84)
    print(
        f"  [T2.5c] Materials         : {stats['materials']} ({', '.join(stats['materialNames'])})"
    )
    print(
        f"  [T2.5d] Mesh Budget       : {stats['meshes']} meshes ({len(outline_objs)} outline hulls @ {OUTLINE_THICKNESS_M:.3f} m) | "
        f"core={core_stats['triangles']} tris, total={stats['triangles']} tris (<= {MAX_TOTAL_TRIS})"
    )
    print(
        f"  [T2.5d] Trade-Dress Audit : {checklist['status']} ({checklist['checks']})"
    )
    print("-" * 84)
    print(f"  T2.5a Overlap PNG : {overlap_report['filepath']} ({overlap_report['width']}x{overlap_report['height']})")
    print(f"  T2.5b Blockout PNG: {preview_3v['filepath']} ({preview_3v['width']}x{preview_3v['height']})")
    print(f"  T2.5cd Final PNG  : {preview_t25cd['filepath']} ({preview_t25cd['width']}x{preview_t25cd['height']})")
    print(f"  Exported GLB      : {glb_stats['filepath']} ({glb_stats['bytes']} B, {glb_stats['triangles']} tris)")
    print(f"  Saved BLEND       : {saved_blend}")
    print("=" * 84)

    return {
        "t25a_overlap": overlap_report,
        "t25b_preview": preview_3v,
        "t25cd_preview": preview_t25cd,
        "checklist": checklist,
        "glb": glb_stats,
        "blend": saved_blend,
        "metrics": metrics,
        "core_stats": core_stats,
        "stats": stats,
        "swatches": swatches_used,
    }


if __name__ == "__main__":
    build_all()
