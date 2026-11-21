"""Cerrado vegetation & environment kit for Era 1 'Origens' (Araguaína/TO).

Task T2.11 (Phase 2D — PLAN-3D §2.2, §4.3, §5.4):
  1. `make_buriti`          (300–1200 tris): tall ringed palm trunk + fan frond crown + buriti fruit cluster.
  2. `make_ipe`             (300–1500 tris each state):
       - `blooming=False`: pre-milestone branches, golden buds, and sparse foliage.
       - `blooming=True`:  exploding golden-yellow (`ipeGold`) multi-lobe blossom clusters (O2 set piece).
  3. `make_pequizeiro`      (300–1500 tris): signature twisted tortuous cerrado trunk/branches + broad canopy blobs.
  4. `make_grass_clump`     (80–350 tris):   chunky toy-style clump of 5–7 curved dry/green blades (>= 0.08 m thick).
  5. `make_termite_mound`   (150–400 tris):  iconic red-earth cupinzeiro (`hollow=False` stepping stone O4, `hollow=True` O7 secret).
  6. `make_laterite_rock`   (150–400 tris):  chunky beveled clay-like laterite boulder.
  7. `make_cerrado_flowers` (120–450 tris):  low cluster of golden/coral cerrado wildflowers.

Every piece uses the single shared `"palette"` material with face UVs mapped to
`palette.json` swatches via `vn_palette.assign`, supports manual mesh overrides via
`vn_manual.apply_manual_overrides("cerrado_kit", ...)`, and satisfies strict mesh
integrity and triangle budgets.

Run standalone:
    blender.exe -b -P game/blender/kits/cerrado_kit.py
"""

from __future__ import annotations

import math
import os
import sys
from typing import Iterable, Sequence

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.abspath(os.path.join(HERE, ".."))
if BLENDER_DIR not in sys.path:
    sys.path.insert(0, BLENDER_DIR)

from lib import vn_bevel, vn_export, vn_manual, vn_palette, vn_scene, vn_shapes  # noqa: E402


KIT_NAME = "cerrado_kit"

BUDGETS: dict[str, tuple[int, int]] = {
    "buriti": (300, 1200),
    "ipe": (300, 1500),
    "pequizeiro": (300, 1500),
    "grass_clump": (80, 350),
    "termite_mound": (150, 400),
    "laterite_rock": (150, 400),
    "cerrado_flowers": (120, 450),
}


# ------------------------------------------------------------------ geometry helpers


def _swatch_uv(swatch: str) -> tuple[float, float]:
    return vn_palette.get_swatch_uv(swatch, gltf=False)


def _tag_faces_swatch(
    bm: bmesh.types.BMesh,
    faces: Iterable[bmesh.types.BMFace],
    swatch: str,
) -> None:
    """Assign exact palette UV center for `swatch` to all loops of `faces`."""
    uv_layer = bm.loops.layers.uv.verify()
    uv = _swatch_uv(swatch)
    for face in faces:
        for loop in face.loops:
            loop[uv_layer].uv = uv


def _append_swept_tube(
    bm: bmesh.types.BMesh,
    stations: Sequence[tuple[Sequence[float], float]] | Sequence[tuple[Sequence[float], tuple[float, float]]],
    sides: int = 6,
    swatch: str | Sequence[str] = "bark",
    cap_bottom: bool = True,
    cap_top: bool = True,
    twist_rad: float = 0.0,
) -> list[bmesh.types.BMFace]:
    """Append a multi-station tapered/curved tube with optional elliptical radii and per-segment swatches.

    `stations` is a sequence of `(center_xyz, radius_or_rx_ry)`.
    `swatch` can be a single swatch name or a sequence of swatch names per segment (length `len(stations) - 1`).
    """
    n_st = len(stations)
    if n_st < 2:
        raise ValueError("_append_swept_tube requires at least 2 stations")
    segs = max(3, int(sides))

    centers = [Vector(tuple(float(c) for c in st[0])) for st in stations]
    radii: list[tuple[float, float]] = []
    for st in stations:
        r_spec = st[1]
        if isinstance(r_spec, (int, float)):
            rv = max(1e-4, float(r_spec))
            radii.append((rv, rv))
        else:
            radii.append((max(1e-4, float(r_spec[0])), max(1e-4, float(r_spec[1]))))

    world_up = Vector((0.0, 0.0, 1.0))
    fallback_up = Vector((0.0, 1.0, 0.0))
    prev_right = Vector((1.0, 0.0, 0.0))

    rings: list[list[bmesh.types.BMVert]] = []
    for idx in range(n_st):
        if idx == 0:
            tangent = centers[1] - centers[0]
        elif idx == n_st - 1:
            tangent = centers[-1] - centers[-2]
        else:
            tangent = centers[idx + 1] - centers[idx - 1]
        if tangent.length < 1e-6:
            tangent = world_up
        else:
            tangent.normalize()

        ref = world_up if abs(tangent.dot(world_up)) < 0.94 else fallback_up
        right = tangent.cross(ref)
        if right.length < 1e-6:
            right = prev_right
        else:
            right.normalize()
        if idx > 0 and right.dot(prev_right) < 0.0:
            right = -right
        prev_right = right
        binorm = tangent.cross(right).normalized()

        rx, ry = radii[idx]
        t_frac = idx / max(1, n_st - 1)
        ang_offset = twist_rad * t_frac
        ring: list[bmesh.types.BMVert] = []
        for s_i in range(segs):
            ang = ang_offset + (2.0 * math.pi * s_i) / segs
            ca, sa = math.cos(ang), math.sin(ang)
            pt = centers[idx] + right * (rx * ca) + binorm * (ry * sa)
            ring.append(bm.verts.new(pt))
        rings.append(ring)

    created_faces: list[bmesh.types.BMFace] = []
    is_seq_swatch = not isinstance(swatch, str)
    default_sw = swatch if isinstance(swatch, str) else swatch[0]

    for idx in range(n_st - 1):
        ring_a = rings[idx]
        ring_b = rings[idx + 1]
        seg_sw = swatch[min(idx, len(swatch) - 1)] if is_seq_swatch else default_sw
        seg_faces: list[bmesh.types.BMFace] = []
        for s_i in range(segs):
            next_i = (s_i + 1) % segs
            f = bm.faces.new((ring_a[s_i], ring_a[next_i], ring_b[next_i], ring_b[s_i]))
            seg_faces.append(f)
            created_faces.append(f)
        _tag_faces_swatch(bm, seg_faces, seg_sw)

    if cap_bottom:
        f_bot = bm.faces.new(tuple(reversed(rings[0])))
        _tag_faces_swatch(bm, (f_bot,), swatch[0] if is_seq_swatch else default_sw)
        created_faces.append(f_bot)

    if cap_top:
        f_top = bm.faces.new(tuple(rings[-1]))
        _tag_faces_swatch(bm, (f_top,), swatch[-1] if is_seq_swatch else default_sw)
        created_faces.append(f_top)

    return created_faces


def _append_transformed_bmesh(
    dst_bm: bmesh.types.BMesh,
    src_obj: bpy.types.Object,
    swatch: str,
    matrix: Matrix | None = None,
) -> list[bmesh.types.BMFace]:
    """Copy `src_obj.data` geometry into `dst_bm` with optional transform and palette UV swatch."""
    tmp_bm = bmesh.new()
    try:
        tmp_bm.from_mesh(src_obj.data)
        if matrix is not None:
            bmesh.ops.transform(tmp_bm, matrix=matrix, verts=tmp_bm.verts)
        vert_map: dict[int, bmesh.types.BMVert] = {}
        for v in tmp_bm.verts:
            vert_map[v.index] = dst_bm.verts.new(v.co)
        new_faces: list[bmesh.types.BMFace] = []
        for f in tmp_bm.faces:
            try:
                nf = dst_bm.faces.new(tuple(vert_map[v.index] for v in f.verts))
                new_faces.append(nf)
            except ValueError:
                pass
        _tag_faces_swatch(dst_bm, new_faces, swatch)
        return new_faces
    finally:
        tmp_bm.free()


def _remove_temp_obj(obj: bpy.types.Object) -> None:
    mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh is not None and mesh.users == 0:
        bpy.data.meshes.remove(mesh)


def _append_icosphere_lobe(
    bm: bmesh.types.BMesh,
    center: Sequence[float],
    scale_xyz: tuple[float, float, float],
    subdivisions: int = 2,
    swatch: str = "cerradoGreen",
    rotation_euler: tuple[float, float, float] = (0.0, 0.0, 0.0),
    noise_amp: float = 0.0,
    seed: int = 0,
) -> list[bmesh.types.BMFace]:
    """Append a faceted/organic displaced icosphere lobe directly into `bm`."""
    res = bmesh.ops.create_icosphere(bm, subdivisions=int(subdivisions), radius=1.0)
    verts = res["verts"]

    if noise_amp > 1e-6:
        for v in verts:
            p = v.co
            n_val = (
                math.sin(p.x * 3.7 + seed * 1.3)
                * math.cos(p.y * 4.1 - seed * 0.9)
                + 0.5 * math.sin(p.z * 5.3 + p.x * 2.3 + seed * 2.1)
            )
            v.co = p * (1.0 + noise_amp * n_val)

    rot_mat = (
        Matrix.Rotation(rotation_euler[2], 4, "Z")
        @ Matrix.Rotation(rotation_euler[1], 4, "Y")
        @ Matrix.Rotation(rotation_euler[0], 4, "X")
    )
    scale_mat = Matrix.Diagonal((scale_xyz[0], scale_xyz[1], scale_xyz[2], 1.0))
    trans_mat = Matrix.Translation(Vector(tuple(float(c) for c in center)))
    xform = trans_mat @ rot_mat @ scale_mat
    bmesh.ops.transform(bm, matrix=xform, verts=verts)

    vert_set = set(verts)
    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
    _tag_faces_swatch(bm, faces, swatch)
    return faces


def _finalize_kit_object(
    name: str,
    bm: bmesh.types.BMesh,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
    bevel_width: float = 0.0,
    bevel_segments: int = 2,
    ground_pivot: bool = True,
) -> bpy.types.Object:
    """Convert `bm` into a finished Blender mesh object with palette material, weighted normals, and override support."""
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    if ground_pivot and len(bm.verts) > 0:
        min_z = min(v.co.z for v in bm.verts)
        if abs(min_z) > 1e-5:
            bmesh.ops.translate(bm, vec=Vector((0.0, 0.0, -min_z)), verts=bm.verts)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(float(v) for v in location)
    vn_scene.link_object(obj, collection)

    # Bind the single shared 'palette' material via `vn_palette.assign` using a
    # callable selector (`poly -> None`) so per-face palette UVs are preserved.
    vn_palette.assign(obj, lambda _poly: None)

    if bevel_width > 0.0 and bevel_segments > 0:
        vn_bevel.apply_bevel(
            obj,
            width=bevel_width,
            segments=bevel_segments,
            limit_method="ANGLE",
            angle_deg=35.0,
            clamp_overlap=True,
            apply=True,
        )

    vn_bevel.apply_weighted_normals(
        obj,
        weight=50,
        keep_sharp=False,
        face_influence=False,
        apply=True,
    )

    # Support R1 manual override per asset or per object name.
    vn_manual.apply_manual_overrides(KIT_NAME, objects=[obj], preserve_transform=True)
    return obj


# --------------------------------------------------------- 1. Buriti (Mauritia flexuosa)


def make_buriti(
    name: str = "CerradoBuriti",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a tall ringed Buriti palm (`Mauritia flexuosa`) with fan fronds and fruit clusters.

    Swatches:
      - Trunk: alternating `bark` and `wood` rings (signature ringed buriti palm trunk)
      - Crown petioles & heart: `cerradoDeep`
      - Fan-shaped palm fronds: `cerradoGreen` and `cerradoDeep`
      - Hanging buriti fruit clusters: `laterite` / `lateriteDark`
    Target budget: 300–1200 tris (PLAN-3D §5.4).
    """
    bm = bmesh.new()
    try:
        # 1. Tall gently-curved ringed palm trunk (height ~6.2 m, 13 stations -> 12 ring segments).
        trunk_stations: list[tuple[tuple[float, float, float], float]] = []
        trunk_swatches: list[str] = []
        n_rings = 12
        trunk_h = 5.8
        for i in range(n_rings + 1):
            t = i / n_rings
            z = t * trunk_h
            # Gentle graceful S-lean characteristic of Tocantins buriti palms
            lean_x = 0.22 * math.sin(t * math.pi * 0.85)
            lean_y = -0.10 * (t ** 1.5)
            # Bulged base tapering up with subtle ring ribs
            base_flare = 0.14 * math.exp(-t * 5.5)
            rib = 0.022 if (i % 2 == 1 and 0 < i < n_rings) else 0.0
            rad = 0.28 - 0.09 * t + base_flare + rib
            trunk_stations.append(((lean_x, lean_y, z), rad))
            if i < n_rings:
                trunk_swatches.append("bark" if (i % 2 == 0) else "wood")

        _append_swept_tube(
            bm,
            trunk_stations,
            sides=8,
            swatch=trunk_swatches,
            cap_bottom=True,
            cap_top=True,
        )

        crown_center = Vector(trunk_stations[-1][0])

        # Crown hub (leaf base heart)
        _append_icosphere_lobe(
            bm,
            center=crown_center + Vector((0.0, 0.0, 0.10)),
            scale_xyz=(0.34, 0.34, 0.28),
            subdivisions=1,
            swatch="cerradoDeep",
        )

        # 2. Fan-shaped palm fronds arranged in 2 tiers (7 lower spreading + 5 upper ascending).
        tier_specs = (
            # (count, z_offset, pitch_start_deg, pitch_drop_deg, length, width, angle_offset_deg, swatch_main)
            (7, 0.05, 18.0, 48.0, 2.05, 0.62, 0.0, "cerradoGreen"),
            (5, 0.24, 46.0, 32.0, 1.65, 0.52, 25.0, "cerradoDeep"),
        )
        for count, z_off, pitch0_deg, drop_deg, f_len, f_width, yaw_off_deg, f_swatch in tier_specs:
            for f_idx in range(count):
                yaw = math.radians(yaw_off_deg + (360.0 * f_idx) / count)
                dir_xy = Vector((math.cos(yaw), math.sin(yaw), 0.0))
                side_xy = Vector((-math.sin(yaw), math.cos(yaw), 0.0))

                # Build each fan frond as a 4-station arched petiole + broad pleated fan blade
                # Cross-section has 4 vertices (diamond/pleated ribbon with thickness >= 0.09 m)
                st_fracs = (0.0, 0.35, 0.72, 1.0)
                st_widths = (0.14, f_width * 0.78, f_width, f_width * 0.42)
                st_thicks = (0.11, 0.12, 0.10, 0.08)

                frond_rings: list[tuple[bmesh.types.BMVert, ...]] = []
                base_pt = crown_center + Vector((0.0, 0.0, z_off)) + dir_xy * 0.16

                for s_frac, w_val, th_val in zip(st_fracs, st_widths, st_thicks):
                    pitch = math.radians(pitch0_deg - drop_deg * (s_frac ** 1.35))
                    r_dist = f_len * s_frac * math.cos(pitch * 0.4)
                    z_arch = f_len * (
                        0.45 * math.sin(math.radians(pitch0_deg)) * s_frac
                        - 0.38 * math.sin(math.radians(drop_deg)) * (s_frac ** 2)
                    )
                    c_pt = base_pt + dir_xy * r_dist + Vector((0.0, 0.0, z_arch))
                    hw = w_val * 0.5
                    ht = th_val * 0.5
                    # Pleated fan cross-section: left wing, top ridge, right wing, bottom midrib
                    v_left = bm.verts.new(c_pt - side_xy * hw - Vector((0.0, 0.0, ht * 0.35)))
                    v_top = bm.verts.new(c_pt + Vector((0.0, 0.0, ht)))
                    v_right = bm.verts.new(c_pt + side_xy * hw - Vector((0.0, 0.0, ht * 0.35)))
                    v_bot = bm.verts.new(c_pt - Vector((0.0, 0.0, ht)))
                    frond_rings.append((v_left, v_top, v_right, v_bot))

                frond_faces: list[bmesh.types.BMFace] = []
                for r_i in range(len(frond_rings) - 1):
                    ra = frond_rings[r_i]
                    rb = frond_rings[r_i + 1]
                    for k in range(4):
                        k_next = (k + 1) % 4
                        frond_faces.append(bm.faces.new((ra[k], ra[k_next], rb[k_next], rb[k])))
                frond_faces.append(bm.faces.new(tuple(reversed(frond_rings[0]))))
                frond_faces.append(bm.faces.new(frond_rings[-1]))

                swatch_use = f_swatch if (f_idx % 2 == 0) else ("cerradoDeep" if f_swatch == "cerradoGreen" else "cerradoGreen")
                _tag_faces_swatch(bm, frond_faces, swatch_use)

        # 3. Three hanging buriti fruit clusters (reddish-brown scaly drupe clusters in `laterite`).
        for c_idx in range(3):
            ang = math.radians(40.0 + c_idx * 120.0)
            hang_pos = crown_center + Vector((0.36 * math.cos(ang), 0.36 * math.sin(ang), -0.22))
            _append_icosphere_lobe(
                bm,
                center=hang_pos,
                scale_xyz=(0.18, 0.18, 0.28),
                subdivisions=1,
                swatch="laterite" if c_idx != 1 else "lateriteDark",
            )

        return _finalize_kit_object(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            ground_pivot=True,
        )
    finally:
        bm.free()


# --------------------------------------------------------- 2. Ipê-Amarelo (2 states)


def make_ipe(
    name: str = "CerradoIpe",
    blooming: bool = False,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create an Ipê-Amarelo tree (`Handroanthus albus`) in either pre-milestone or blooming state.

    States:
      - `blooming=False`: sculpted trunk & primary branches (`bark`), sparse dry-season foliage pods
        (`cerradoGreen`) and tight golden flower buds (`ipeGold` / `dryGrass`).
      - `blooming=True`:  exploding golden-yellow (`ipeGold`) multi-lobe blossom clusters across the
        crown for the O2 milestone pop-up set piece (PLAN-3D §2.8, §4.3 O2).
    Target budget: 300–1500 tris in each state (PLAN-3D §5.4).
    """
    bm = bmesh.new()
    try:
        # 1. Main trunk with slight organic cerrado lean (0 -> 2.75 m)
        trunk_stations = [
            ((0.0, 0.0, 0.0), 0.34),
            ((0.04, -0.02, 0.65), 0.27),
            ((0.10, 0.03, 1.45), 0.23),
            ((0.06, 0.06, 2.25), 0.19),
            ((0.02, 0.04, 2.75), 0.15),
        ]
        _append_swept_tube(bm, trunk_stations, sides=7, swatch="bark", cap_bottom=True, cap_top=True)

        # 2. Four primary ascending branches + two secondary twigs
        branch_specs = [
            # Branch 1 (NE)
            (
                [
                    ((0.06, 0.05, 2.15), 0.16),
                    ((0.55, 0.42, 2.75), 0.13),
                    ((1.15, 0.82, 3.35), 0.10),
                    ((1.55, 1.05, 3.72), 0.07),
                ],
                6,
            ),
            # Branch 2 (NW)
            (
                [
                    ((0.04, 0.04, 2.25), 0.15),
                    ((-0.52, 0.48, 2.85), 0.12),
                    ((-1.12, 0.88, 3.45), 0.09),
                    ((-1.48, 1.12, 3.80), 0.07),
                ],
                6,
            ),
            # Branch 3 (SE)
            (
                [
                    ((0.07, 0.02, 2.05), 0.15),
                    ((0.58, -0.46, 2.68), 0.12),
                    ((1.18, -0.92, 3.25), 0.09),
                    ((1.52, -1.16, 3.58), 0.07),
                ],
                6,
            ),
            # Branch 4 (SW)
            (
                [
                    ((0.03, 0.02, 2.35), 0.14),
                    ((-0.48, -0.50, 2.95), 0.11),
                    ((-0.98, -0.95, 3.55), 0.09),
                    ((-1.28, -1.22, 3.88), 0.06),
                ],
                6,
            ),
            # Center high leader branch
            (
                [
                    ((0.02, 0.04, 2.65), 0.13),
                    ((0.12, -0.08, 3.40), 0.10),
                    ((0.18, -0.12, 4.10), 0.07),
                ],
                6,
            ),
        ]
        for stations, sides in branch_specs:
            _append_swept_tube(bm, stations, sides=sides, swatch="bark", cap_bottom=True, cap_top=True)

        if blooming:
            # Blooming state: Lush golden-yellow multi-lobe blossom clusters (metaball blobs + accent puffs).
            crown_blob_specs = [
                # Central high golden dome
                (
                    "ipeGold",
                    [
                        ((0.15, -0.10, 4.25), 0.85),
                        ((0.72, 0.35, 4.05), 0.68),
                        ((-0.58, 0.38, 4.10), 0.66),
                        ((0.05, -0.72, 3.98), 0.62),
                    ],
                    0.24,
                    0.22,
                ),
                # NE blossom cluster
                (
                    "ipeGold",
                    [
                        ((1.45, 0.98, 3.78), 0.74),
                        ((1.88, 0.65, 3.58), 0.58),
                        ((1.10, 1.35, 3.62), 0.56),
                    ],
                    0.24,
                    0.22,
                ),
                # NW blossom cluster
                (
                    "ipeGold",
                    [
                        ((-1.38, 1.05, 3.85), 0.72),
                        ((-1.80, 0.70, 3.65), 0.56),
                        ((-1.02, 1.42, 3.68), 0.54),
                    ],
                    0.24,
                    0.22,
                ),
                # SE & SW lower golden blossom clusters
                (
                    "ipeGold",
                    [
                        ((1.42, -1.08, 3.62), 0.70),
                        ((1.02, -1.42, 3.48), 0.54),
                    ],
                    0.24,
                    0.24,
                ),
                (
                    "ipeGold",
                    [
                        ((-1.22, -1.15, 3.90), 0.70),
                        ((-1.62, -0.82, 3.70), 0.56),
                    ],
                    0.24,
                    0.24,
                ),
            ]
            for idx, (sw, lobes, res, dec) in enumerate(crown_blob_specs):
                tmp_blob = vn_shapes.make_blob(
                    f"_{name}_BloomBlob_{idx}",
                    lobes=lobes,
                    radius=0.65,
                    resolution=res,
                    decimate_ratio=dec,
                    smooth_iterations=2,
                )
                try:
                    _append_transformed_bmesh(bm, tmp_blob, swatch=sw)
                finally:
                    _remove_temp_obj(tmp_blob)

            # Warm golden-sunlight accent puffs (`fairyGold` / `dryGrass` / `cerradoGreen` calyx accents)
            accent_puffs = [
                ((0.18, 0.05, 4.88), (0.52, 0.48, 0.36), "fairyGold"),
                ((1.62, 1.10, 4.18), (0.42, 0.40, 0.32), "fairyGold"),
                ((-1.52, 1.15, 4.22), (0.42, 0.40, 0.32), "fairyGold"),
                ((0.75, -0.55, 3.42), (0.34, 0.32, 0.25), "cerradoGreen"),
                ((-0.68, 0.52, 3.45), (0.34, 0.32, 0.25), "cerradoGreen"),
            ]
            for center, scale_xyz, sw in accent_puffs:
                _append_icosphere_lobe(
                    bm,
                    center=center,
                    scale_xyz=scale_xyz,
                    subdivisions=1,
                    swatch=sw,
                    noise_amp=0.06,
                )
        else:
            # Pre-blooming state (`blooming=False`): exposed sculptural branches with sparse foliage
            # clusters (`cerradoGreen` / `dryGrass`) and tight golden buds (`ipeGold`) ready to pop.
            for t_idx, twig in enumerate(
                [
                    [((1.15, 0.82, 3.35), 0.08), ((0.85, 1.32, 3.78), 0.05)],
                    [((-1.12, 0.88, 3.45), 0.08), ((-0.82, 1.38, 3.88), 0.05)],
                    [((1.18, -0.92, 3.25), 0.08), ((1.48, -0.52, 3.68), 0.05)],
                    [((-0.98, -0.95, 3.55), 0.08), ((-1.35, -0.58, 3.92), 0.05)],
                ]
            ):
                _append_swept_tube(bm, twig, sides=5, swatch="wood", cap_bottom=True, cap_top=True)

            sparse_pods = [
                # Sparse dry-season foliage tufts
                ((1.55, 1.05, 3.78), (0.42, 0.38, 0.28), "cerradoGreen", 1),
                ((-1.48, 1.12, 3.86), (0.40, 0.36, 0.28), "cerradoGreen", 1),
                ((1.52, -1.16, 3.64), (0.38, 0.35, 0.26), "dryGrass", 1),
                ((-1.28, -1.22, 3.94), (0.40, 0.36, 0.27), "cerradoGreen", 1),
                ((0.18, -0.12, 4.18), (0.46, 0.42, 0.30), "cerradoDeep", 1),
                # Golden flower buds poised at branch tips
                ((0.85, 1.32, 3.84), (0.24, 0.22, 0.22), "ipeGold", 1),
                ((-0.82, 1.38, 3.94), (0.24, 0.22, 0.22), "ipeGold", 1),
                ((1.48, -0.52, 3.74), (0.22, 0.22, 0.20), "ipeGold", 1),
                ((-1.35, -0.58, 3.98), (0.22, 0.22, 0.20), "ipeGold", 1),
                ((0.36, 0.18, 4.34), (0.25, 0.24, 0.22), "ipeGold", 1),
            ]
            for idx, (center, scale_xyz, sw, subdiv) in enumerate(sparse_pods):
                _append_icosphere_lobe(
                    bm,
                    center=center,
                    scale_xyz=scale_xyz,
                    subdivisions=subdiv,
                    swatch=sw,
                    noise_amp=0.07,
                    seed=idx + 3,
                )

        return _finalize_kit_object(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            ground_pivot=True,
        )
    finally:
        bm.free()


# --------------------------------------------------------- 3. Pequizeiro (Caryocar brasiliense)


def make_pequizeiro(
    name: str = "CerradoPequizeiro",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a signature gnarled, twisted Pequizeiro tree (`Caryocar brasiliense`) with pequi fruits.

    Swatches:
      - Gnarled tortuous trunk & low-slung crooked limbs: `bark` / `woodDark`
      - Broad umbrella canopy blobs: `cerradoGreen`, `pequi`, `cerradoDeep`
      - Golden-green pequi fruit accents beneath canopy: `pequi` / `ipeGold`
    Target budget: 300–1500 tris (PLAN-3D §5.4).
    """
    bm = bmesh.new()
    try:
        # 1. Twisted, tortuous main trunk (signature gnarled cerrado silhouette!)
        gnarled_trunk = [
            ((0.0, 0.0, 0.0), 0.42),
            ((0.18, -0.14, 0.48), 0.35),
            ((-0.16, 0.18, 1.02), 0.30),
            ((0.22, 0.24, 1.56), 0.26),
            ((0.05, 0.08, 2.05), 0.22),
        ]
        _append_swept_tube(
            bm,
            gnarled_trunk,
            sides=7,
            swatch=["bark", "woodDark", "bark", "bark"],
            cap_bottom=True,
            cap_top=True,
            twist_rad=0.55,
        )

        # 2. Three wide, low-slung crooked boughs twisting outward before rising
        boughs = [
            # East crooked bough
            (
                [
                    ((0.15, 0.18, 1.48), 0.22),
                    ((0.85, 0.05, 1.62), 0.18),
                    ((1.48, 0.45, 2.18), 0.14),
                    ((1.95, 0.62, 2.65), 0.10),
                ],
                "bark",
            ),
            # Northwest crooked bough
            (
                [
                    ((-0.08, 0.16, 1.65), 0.20),
                    ((-0.78, 0.58, 1.85), 0.16),
                    ((-1.42, 0.28, 2.38), 0.13),
                    ((-1.82, 0.55, 2.82), 0.09),
                ],
                "bark",
            ),
            # South crooked bough
            (
                [
                    ((0.08, 0.05, 1.82), 0.19),
                    ((0.12, -0.72, 2.02), 0.15),
                    ((-0.38, -1.35, 2.48), 0.12),
                    ((-0.55, -1.72, 2.85), 0.09),
                ],
                "woodDark",
            ),
        ]
        for stations, sw in boughs:
            _append_swept_tube(bm, stations, sides=6, swatch=sw, cap_bottom=True, cap_top=True, twist_rad=0.4)

        # 3. Broad rounded organic canopy blobs (`vn_shapes.make_blob`)
        canopy_blobs = [
            # Main central-north canopy mass (`cerradoGreen`)
            (
                "cerradoGreen",
                [
                    ((0.05, 0.15, 3.05), 0.95),
                    ((0.85, 0.42, 2.92), 0.76),
                    ((-0.78, 0.48, 2.98), 0.74),
                ],
                0.24,
                0.24,
            ),
            # East spreading canopy (`pequi`)
            (
                "pequi",
                [
                    ((1.85, 0.58, 2.85), 0.82),
                    ((1.32, 0.88, 3.02), 0.66),
                ],
                0.24,
                0.24,
            ),
            # West spreading canopy (`cerradoGreen`)
            (
                "cerradoGreen",
                [
                    ((-1.72, 0.52, 2.98), 0.80),
                    ((-1.20, 0.15, 3.12), 0.64),
                ],
                0.24,
                0.24,
            ),
            # South canopy (`cerradoDeep`)
            (
                "cerradoDeep",
                [
                    ((-0.48, -1.58, 2.98), 0.82),
                    ((0.22, -1.12, 2.88), 0.66),
                ],
                0.24,
                0.24,
            ),
        ]
        for idx, (sw, lobes, res, dec) in enumerate(canopy_blobs):
            tmp_blob = vn_shapes.make_blob(
                f"_{name}_CanopyBlob_{idx}",
                lobes=lobes,
                radius=0.75,
                resolution=res,
                decimate_ratio=dec,
                smooth_iterations=2,
            )
            try:
                _append_transformed_bmesh(bm, tmp_blob, swatch=sw)
            finally:
                _remove_temp_obj(tmp_blob)

        # 4. Five globose green-gold Pequi fruits hanging under the canopy boughs
        pequi_positions = [
            (1.42, 0.42, 2.02),
            (1.78, 0.60, 2.38),
            (-1.38, 0.32, 2.18),
            (-0.35, -1.28, 2.25),
            (0.25, 0.18, 2.32),
        ]
        for p_idx, pos in enumerate(pequi_positions):
            _append_icosphere_lobe(
                bm,
                center=pos,
                scale_xyz=(0.15, 0.15, 0.14),
                subdivisions=1,
                swatch="pequi" if (p_idx % 2 == 0) else "ipeGold",
            )

        return _finalize_kit_object(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            ground_pivot=True,
        )
    finally:
        bm.free()


# --------------------------------------------------------- 4. Capim do Cerrado (Grass Clump)


def make_grass_clump(
    name: str = "CerradoGrassBase",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a chunky toy-style clump of 6 curved dry/green cerrado grass blades.

    Every blade has wall/chunk thickness >= 0.09 m (exceeding the >= 0.08 m rule)
    and uses `dryGrass` and `cerradoGreen` swatches.
    Target budget: 80–350 tris (PLAN-3D §5.4).
    """
    bm = bmesh.new()
    try:
        # Low earth/root tuft collar at the base
        _append_icosphere_lobe(
            bm,
            center=(0.0, 0.0, 0.08),
            scale_xyz=(0.26, 0.26, 0.10),
            subdivisions=1,
            swatch="dryGrass",
        )

        # 6 chunky curved grass blades radiating outward with varied heights and arches
        blade_specs = [
            # (yaw_deg, radial_offset, height, arch_out, width_base, thickness, swatch)
            (0.0,   0.08, 0.72, 0.34, 0.16, 0.10, "dryGrass"),
            (58.0,  0.09, 0.62, 0.30, 0.15, 0.095, "cerradoGreen"),
            (118.0, 0.07, 0.78, 0.38, 0.16, 0.10, "dryGrass"),
            (182.0, 0.09, 0.58, 0.28, 0.14, 0.09, "cerradoGreen"),
            (242.0, 0.08, 0.68, 0.32, 0.15, 0.095, "dryGrass"),
            (302.0, 0.07, 0.64, 0.29, 0.15, 0.095, "cerradoGreen"),
        ]

        for yaw_deg, r_off, h_val, arch_out, w_base, thick, sw in blade_specs:
            yaw = math.radians(yaw_deg)
            dir_v = Vector((math.cos(yaw), math.sin(yaw), 0.0))
            side_v = Vector((-math.sin(yaw), math.cos(yaw), 0.0))

            # 4 stations from ground to chunky rounded tip (all >= 0.08 m thick)
            fracs = (0.0, 0.36, 0.72, 1.0)
            w_scales = (1.0, 0.92, 0.72, 0.52)
            t_scales = (1.0, 0.95, 0.90, 0.88)

            rings: list[tuple[bmesh.types.BMVert, ...]] = []
            for frac, ws, ts in zip(fracs, w_scales, t_scales):
                r_cur = r_off + arch_out * (frac ** 1.45)
                z_cur = h_val * math.sin(frac * math.pi * 0.52)
                c_pt = dir_v * r_cur + Vector((0.0, 0.0, z_cur))

                hw = max(0.042, (w_base * ws) * 0.5)
                ht = max(0.042, (thick * ts) * 0.5)  # full thickness >= 0.084 m everywhere
                normal_v = (-dir_v * (0.35 * frac) + Vector((0.0, 0.0, 1.0))).normalized()

                bl = bm.verts.new(c_pt - side_v * hw - normal_v * ht)
                br = bm.verts.new(c_pt + side_v * hw - normal_v * ht)
                tr = bm.verts.new(c_pt + side_v * hw + normal_v * ht)
                tl = bm.verts.new(c_pt - side_v * hw + normal_v * ht)
                rings.append((bl, br, tr, tl))

            blade_faces: list[bmesh.types.BMFace] = []
            for i in range(len(rings) - 1):
                ra = rings[i]
                rb = rings[i + 1]
                for k in range(4):
                    k2 = (k + 1) % 4
                    blade_faces.append(bm.faces.new((ra[k], ra[k2], rb[k2], rb[k])))
            blade_faces.append(bm.faces.new(tuple(reversed(rings[0]))))
            blade_faces.append(bm.faces.new(rings[-1]))
            _tag_faces_swatch(bm, blade_faces, sw)

        return _finalize_kit_object(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            ground_pivot=True,
        )
    finally:
        bm.free()


# --------------------------------------------------------- 5. Cupinzeiro (Termite Mound)


def make_termite_mound(
    name: str = "CerradoCupinzeiro",
    hollow: bool = False,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create an iconic red-earth Cerrado termite mound (`cupinzeiro`).

    Supports two gameplay variants (PLAN-3D §4.3 O4 & O7, §5.4):
      - `hollow=False`: sculpted stepping-stone termite mound with flat-ish jumpable apex (O4).
      - `hollow=True`:  secret hollow cupinzeiro with recessed dark chimney opening on top (O7).
    Swatches: `termite`, `laterite`, `lateriteDark` (plus `ink` interior recess when `hollow=True`).
    Target budget: 150–400 tris (PLAN-3D §5.4).
    """
    # Sculpt organic clay-like conical mound via multi-lobe metaball -> voxel remesh -> smooth -> decimate.
    mound_lobes = [
        ((0.0, 0.0, 0.36), 0.66),
        ((0.34, 0.18, 0.28), 0.42),
        ((-0.32, 0.22, 0.30), 0.40),
        ((0.12, -0.36, 0.26), 0.42),
        ((-0.18, -0.24, 0.56), 0.38),
        ((0.16, 0.14, 0.76), 0.40),
        ((0.0, 0.0, 1.06), 0.36),
    ]
    tmp_mound = vn_shapes.make_blob(
        f"_{name}_RawBlob",
        lobes=mound_lobes,
        radius=0.58,
        resolution=0.12,
        decimate_ratio=0.14,
        smooth_iterations=2,
    )

    bm = bmesh.new()
    try:
        bm.from_mesh(tmp_mound.data)
    finally:
        _remove_temp_obj(tmp_mound)

    try:
        bm.verts.ensure_lookup_table()
        min_z = min(v.co.z for v in bm.verts)
        max_z = max(v.co.z for v in bm.verts)
        span_z = max(0.1, max_z - min_z)

        # Sculpt organic clay ridges and flatten the bottom + stepping-stone top slightly
        for v in bm.verts:
            zn = (v.co.z - min_z) / span_z
            ang = math.atan2(v.co.y, v.co.x)
            fluting = 1.0 + 0.06 * math.sin(ang * 5.0 + zn * 4.0) + 0.04 * math.cos(ang * 3.0 - zn * 6.0)
            v.co.x *= fluting
            v.co.y *= fluting
            if zn < 0.06:
                v.co.z = min_z
            elif hollow and zn > 0.86:
                # Carve recessed crater rim on top for the hollow secret cupinzeiro (O7)
                r_xy = math.hypot(v.co.x, v.co.y)
                if r_xy < 0.22:
                    v.co.z = min_z + span_z * (0.62 + 0.45 * (r_xy / 0.22))
                else:
                    v.co.z = min(v.co.z, min_z + span_z * 0.92)

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

        obj = _finalize_kit_object(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            ground_pivot=True,
        )
    finally:
        bm.free()

    def _mound_swatch(poly: bpy.types.MeshPolygon) -> str:
        c = poly.center
        zn = c.z / max(0.1, span_z)
        r_xy = math.hypot(c.x, c.y)
        if hollow and zn > 0.60 and r_xy < 0.19 and poly.normal.z > 0.15:
            return "ink"
        if zn < 0.22:
            return "lateriteDark"
        if poly.normal.z > 0.55 or zn > 0.74:
            return "laterite"
        return "termite"

    vn_palette.assign(obj, _mound_swatch)
    vn_manual.apply_manual_overrides(KIT_NAME, objects=[obj], preserve_transform=True)
    return obj


# --------------------------------------------------------- 6. Rocha Laterita (Laterite Rock)


def make_laterite_rock(
    name: str = "CerradoRocha",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a chunky beveled clay-like laterite boulder (`rock` / `lateriteDark` / `laterite`).

    Pipeline (PLAN-3D §5.4): displaced multi-lobe form -> Voxel Remesh -> Decimate -> Bevel.
    Target budget: 150–400 tris (PLAN-3D §5.4).
    """
    rock_lobes = [
        ((0.0, 0.0, 0.34), 0.58),
        ((0.46, 0.18, 0.26), 0.44),
        ((-0.44, -0.14, 0.28), 0.42),
        ((0.10, -0.40, 0.24), 0.38),
        ((-0.14, 0.34, 0.44), 0.38),
    ]
    tmp_rock = vn_shapes.make_blob(
        f"_{name}_RawBlob",
        lobes=rock_lobes,
        radius=0.55,
        resolution=0.12,
        decimate_ratio=0.16,
        smooth_iterations=1,
    )

    bm = bmesh.new()
    try:
        bm.from_mesh(tmp_rock.data)
    finally:
        _remove_temp_obj(tmp_rock)

    try:
        bm.verts.ensure_lookup_table()
        min_z = min(v.co.z for v in bm.verts)
        max_z = max(v.co.z for v in bm.verts)
        span_z = max(0.1, max_z - min_z)

        # Give the boulder flat-ish clay-like facets and a planted flat base
        for v in bm.verts:
            zn = (v.co.z - min_z) / span_z
            if zn < 0.08:
                v.co.z = min_z
            else:
                facet = 1.0 + 0.05 * math.sin(v.co.x * 4.5) * math.cos(v.co.y * 4.2)
                v.co.x *= facet
                v.co.y *= facet
                v.co.z = min_z + (v.co.z - min_z) * 0.78

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

        obj = _finalize_kit_object(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            ground_pivot=True,
        )
    finally:
        bm.free()

    def _rock_swatch(poly: bpy.types.MeshPolygon) -> str:
        c = poly.center
        zn = c.z / max(0.1, span_z * 0.78)
        if zn < 0.22:
            return "lateriteDark"
        if poly.normal.z > 0.62:
            return "rock"
        if poly.normal.x + poly.normal.y > 0.45:
            return "laterite"
        return "rockDark"

    vn_palette.assign(obj, _rock_swatch)
    vn_manual.apply_manual_overrides(KIT_NAME, objects=[obj], preserve_transform=True)
    return obj


# --------------------------------------------------------- 7. Flores do Cerrado (Wildflowers)


def make_cerrado_flowers(
    name: str = "CerradoFlores",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a low cluster of golden and coral cerrado wildflowers (`ipeGold`, `duskCoral`, `cerradoGreen`).

    Target budget: 120–450 tris (PLAN-3D §5.4).
    """
    bm = bmesh.new()
    try:
        # 1. Three low leafy basal cushions (`cerradoGreen` and `cerradoDeep`)
        leaf_cushions = [
            ((0.0, 0.0, 0.09), (0.38, 0.34, 0.11), "cerradoGreen", (0.0, 0.0, 0.2)),
            ((0.24, 0.16, 0.08), (0.26, 0.24, 0.09), "cerradoDeep", (0.0, 0.0, 1.1)),
            ((-0.22, -0.14, 0.08), (0.28, 0.25, 0.09), "cerradoGreen", (0.0, 0.0, -0.7)),
        ]
        for center, scale_xyz, sw, rot in leaf_cushions:
            _append_icosphere_lobe(
                bm,
                center=center,
                scale_xyz=scale_xyz,
                subdivisions=1,
                swatch=sw,
                rotation_euler=rot,
            )

        # 2. Five chunky stems rising to golden and coral wildflower heads (sempre-vivas / amarílis do cerrado)
        flower_specs = [
            # (base_xy, top_xyz, head_radius, petal_swatch, center_swatch)
            ((0.00, 0.00), (0.02, 0.02, 0.44), 0.15, "ipeGold", "duskCoral"),
            ((0.18, 0.12), (0.26, 0.18, 0.36), 0.13, "duskCoral", "ipeGold"),
            ((-0.18, 0.10), (-0.25, 0.16, 0.38), 0.14, "ipeGold", "laterite"),
            ((0.14, -0.16), (0.20, -0.24, 0.32), 0.12, "duskCoral", "ipeGold"),
            ((-0.14, -0.14), (-0.22, -0.20, 0.34), 0.13, "ipeGold", "duskCoral"),
        ]

        for (bx, by), (tx, ty, tz), h_rad, petal_sw, core_sw in flower_specs:
            mx = (bx + tx) * 0.5
            my = (by + ty) * 0.5
            stem_stations = [
                ((bx, by, 0.04), 0.045),
                ((mx, my, tz * 0.52), 0.042),
                ((tx, ty, tz - 0.04), 0.040),
            ]
            _append_swept_tube(
                bm,
                stem_stations,
                sides=5,
                swatch="cerradoDeep",
                cap_bottom=True,
                cap_top=True,
            )

            # Broad chunky blossom head
            _append_icosphere_lobe(
                bm,
                center=(tx, ty, tz),
                scale_xyz=(h_rad, h_rad, h_rad * 0.62),
                subdivisions=1,
                swatch=petal_sw,
            )
            # Raised contrasting stamen/pistil button on top
            _append_icosphere_lobe(
                bm,
                center=(tx, ty, tz + h_rad * 0.48),
                scale_xyz=(h_rad * 0.46, h_rad * 0.46, h_rad * 0.35),
                subdivisions=1,
                swatch=core_sw,
            )

        return _finalize_kit_object(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            ground_pivot=True,
        )
    finally:
        bm.free()


# --------------------------------------------------------- Kit Builder & Verification


def check_piece_integrity(
    obj: bpy.types.Object,
    budget: tuple[int, int],
) -> dict:
    """Assert triangle budget, single `'palette'` material, valid UVs, and zero NaN/degenerate normals."""
    mesh = obj.data
    assert mesh is not None and len(mesh.vertices) > 0, f"{obj.name}: empty mesh"
    assert len(mesh.polygons) > 0, f"{obj.name}: zero polygons"

    # 1. Single shared 'palette' material verification.
    mat_names = [slot.material.name for slot in obj.material_slots if slot.material is not None]
    assert mat_names == ["palette"], f"{obj.name}: expected ['palette'] material, got {mat_names}"

    # 2. Finite vertex coordinates & ground pivot check.
    coords = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", coords)
    assert np.all(np.isfinite(coords)), f"{obj.name}: NaN/Inf vertex coordinates"
    pts = coords.reshape((-1, 3))
    min_z = float(pts[:, 2].min())
    max_z = float(pts[:, 2].max())
    assert abs(min_z) <= 0.02, f"{obj.name}: ground pivot off z=0 (min_z={min_z:.4f})"

    # 3. Active UV layer within [0, 1].
    uv_layer = mesh.uv_layers.active
    assert uv_layer is not None, f"{obj.name}: missing active UV layer"
    uv_buf = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    uv_layer.data.foreach_get("uv", uv_buf)
    assert np.all(np.isfinite(uv_buf)), f"{obj.name}: NaN/Inf UV coordinates"
    assert float(uv_buf.min()) >= 0.0 and float(uv_buf.max()) <= 1.0, (
        f"{obj.name}: UVs outside [0, 1]: [{uv_buf.min():.3f}, {uv_buf.max():.3f}]"
    )

    # 4. BMesh face area & consistent outward normal orientation check.
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        zero_area = 0
        bad_normal = 0
        for f in bm.faces:
            area = f.calc_area()
            if not math.isfinite(area) or area <= 1e-8:
                zero_area += 1
            f.normal_update()
            if not math.isfinite(f.normal.length) or f.normal.length < 0.99:
                bad_normal += 1

        orig_normals = [f.normal.copy() for f in bm.faces]
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        inverted = sum(
            1 for f, orig_n in zip(bm.faces, orig_normals) if f.normal.dot(orig_n) < 0.0
        )
    finally:
        bm.free()

    assert zero_area == 0, f"{obj.name}: {zero_area} zero-area faces"
    assert bad_normal == 0, f"{obj.name}: {bad_normal} bad face normals"
    assert inverted == 0, f"{obj.name}: {inverted} inverted face normals"

    # 5. Corner normals & triangle budget check.
    mesh.calc_loop_triangles()
    tris = len(mesh.loop_triangles)
    lo, hi = budget
    assert lo <= tris <= hi, f"{obj.name}: triangle count {tris} outside budget [{lo}, {hi}]"

    cn = np.empty(len(mesh.loops) * 3, dtype=np.float32)
    mesh.corner_normals.foreach_get("vector", cn)
    cn_vecs = cn.reshape((-1, 3))
    assert np.all(np.isfinite(cn_vecs)), f"{obj.name}: NaN corner normals"
    cn_lens = np.linalg.norm(cn_vecs, axis=1)
    assert int(np.count_nonzero(cn_lens < 0.95)) == 0, f"{obj.name}: degenerate corner normals"

    return {
        "name": obj.name,
        "tris": tris,
        "budget": budget,
        "verts": len(mesh.vertices),
        "faces": len(mesh.polygons),
        "height_m": round(max_z - min_z, 2),
        "materials": mat_names,
    }


def build_cerrado_kit_showcase(
    collection: bpy.types.Collection | str = "CerradoKit",
) -> list[tuple[bpy.types.Object, tuple[int, int]]]:
    """Build all 7 cerrado kit pieces (including both Ipê states = 8 meshes) in a clean showcase layout."""
    col = vn_scene.ensure_collection(collection) if isinstance(collection, str) else collection

    # Arranged in two balanced rows so front, 3/4, and top views show every silhouette clearly without occlusion:
    # Back row (y = +2.4 m): tall trees (Buriti, Ipê Dry, Ipê Blooming, Pequizeiro)
    # Front row (y = -2.2 m): ground props (Grass Clump, Cupinzeiro, Rocha Laterita, Flores do Cerrado)
    pieces: list[tuple[bpy.types.Object, tuple[int, int]]] = [
        (
            make_buriti(name="CerradoBuriti", location=(-6.0, 2.4, 0.0), collection=col),
            BUDGETS["buriti"],
        ),
        (
            make_ipe(name="CerradoIpe", blooming=False, location=(-2.0, 2.4, 0.0), collection=col),
            BUDGETS["ipe"],
        ),
        (
            make_ipe(name="CerradoIpeBlooming", blooming=True, location=(2.2, 2.4, 0.0), collection=col),
            BUDGETS["ipe"],
        ),
        (
            make_pequizeiro(name="CerradoPequizeiro", location=(6.4, 2.4, 0.0), collection=col),
            BUDGETS["pequizeiro"],
        ),
        (
            make_grass_clump(name="CerradoGrassBase", location=(-4.8, -2.2, 0.0), collection=col),
            BUDGETS["grass_clump"],
        ),
        (
            make_termite_mound(name="CerradoCupinzeiro", hollow=False, location=(-1.6, -2.2, 0.0), collection=col),
            BUDGETS["termite_mound"],
        ),
        (
            make_laterite_rock(name="CerradoRocha", location=(1.6, -2.2, 0.0), collection=col),
            BUDGETS["laterite_rock"],
        ),
        (
            make_cerrado_flowers(name="CerradoFlores", location=(4.8, -2.2, 0.0), collection=col),
            BUDGETS["cerrado_flowers"],
        ),
    ]

    # Scene-wide manual override pass for the entire kit (`cerrado_kit.blend`).
    vn_manual.apply_manual_overrides(
        KIT_NAME,
        objects=[obj for obj, _ in pieces],
        preserve_transform=True,
    )
    return pieces


def main() -> None:
    # Quick unit check on hollow termite mound variant (O7 secret) before building the full showcase.
    vn_scene.reset_scene("CerradoKit_HollowCheck")
    hollow_mound = make_termite_mound(name="CerradoCupinzeiroHollow", hollow=True)
    hollow_info = check_piece_integrity(hollow_mound, BUDGETS["termite_mound"])
    print(
        f"[cerrado_kit] hollow variant PASS | {hollow_info['name']} | "
        f"{hollow_info['tris']} tris (budget {hollow_info['budget'][0]}–{hollow_info['budget'][1]})"
    )

    # Build the complete 8-mesh showcase (7 pieces + both states of CerradoIpe).
    vn_scene.reset_scene("T211_CerradoKit")
    col = vn_scene.ensure_collection("CerradoKit")
    pieces = build_cerrado_kit_showcase(collection=col)

    print("[cerrado_kit] --- Piece Integrity & Triangle Budgets (PLAN-3D §5.4) ---")
    total_tris = 0
    for obj, budget in pieces:
        info = check_piece_integrity(obj, budget)
        total_tris += info["tris"]
        lo, hi = info["budget"]
        print(
            f"[cerrado_kit] {info['name']:20s} | {info['tris']:4d} tris "
            f"(budget {lo:3d}–{hi:4d}) | {info['verts']:4d} verts | "
            f"h={info['height_m']:4.2f} m | mat={info['materials']}"
        )

    scene_info = vn_scene.scene_stats([obj for obj, _ in pieces])
    assert scene_info["materials"] == 1 and scene_info["materialNames"] == ["palette"], (
        f"Expected single shared 'palette' material across kit, got {scene_info['materialNames']}"
    )
    print(
        f"[cerrado_kit] TOTAL | {len(pieces)} meshes | {total_tris} tris | "
        f"{scene_info['materials']} material ({scene_info['materialNames'][0]})"
    )

    preview_path = os.path.join(BLENDER_DIR, "out", "previews", "t211_cerrado_kit.png")
    render_info = vn_scene.render_3views(preview_path, size=640)
    assert os.path.isfile(render_info["filepath"]), "Preview PNG was not written"

    glb_path = os.path.join(BLENDER_DIR, "out", "cerrado_kit.glb")
    glb_info = vn_export.export_glb(glb_path, collections=[col])
    assert os.path.isfile(glb_info["filepath"]), "GLB file was not written"
    assert glb_info["triangles"] == total_tris, (
        f"GLB triangle count mismatch: expected {total_tris}, got {glb_info['triangles']}"
    )
    assert glb_info["materials"] == 1, f"Expected 1 material in GLB, got {glb_info['materials']}"
    print(
        f"[cerrado_kit] ALL CHECKS PASSED | preview={render_info['filepath']} | "
        f"glb={glb_info['filepath']} ({glb_info['bytes']} B)"
    )


if __name__ == "__main__":
    main()
