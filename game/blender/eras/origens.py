"""Era 1 'Origens' (Araguaína/TO) layout & blockout generator (Phase 2D — Task T2.10).

Builds the complete 70 x 55 m diorama island for Era 1 'Origens' covering all 11 beats
O1–O11 from docs/PLAN-3D.md §4.3, the continuous spline of 'a Linha' (`OrigensLineRibbon`
+ `refLinePoint01..16` + `game/blender/out/origens_line_spline.json`), the accessible
auto-walk navigation graph (`refNav01..12` for `T2.NAV`), all 20 collectible signals
(`refSignal01..20` / `refSignal1..20`, including 3 hidden at O7), camera framing zones
(`refCamera1..5`), bounding/frustum zones (`refZoneBounding`, `refZoneFrustum`), and
interactive Rapier dynamic physics playground toys (domino brick line at O1, pequi crates
at O1 and O6, kickable pequi fruits and bowling stacks at O6, and launch ramp jump).

Run standalone:
    blender.exe -b -P game/blender/eras/origens.py -- --mode blockout --out game/blender/out/origens_blockout.glb
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import sys
import zlib
from pathlib import Path
from typing import Any, Iterable, Sequence

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
BLENDER_DIR = HERE.parent
ROOT_DIR = BLENDER_DIR.parent
if str(BLENDER_DIR) not in sys.path:
    sys.path.insert(0, str(BLENDER_DIR))

from kits import (  # noqa: E402
    cerrado_kit,
    origens_bus_enddot,
    origens_crt_desk,
    origens_house_ipe,
    origens_school,
    platform_kit,
)
from lib import (  # noqa: E402
    vn_bake_ao,
    vn_bake_shadow,
    vn_bevel,
    vn_collide,
    vn_export,
    vn_manual,
    vn_palette,
    vn_refs,
    vn_scene,
    vn_shapes,
)

OUT_DIR = BLENDER_DIR / "out"
PREVIEWS_DIR = OUT_DIR / "previews"
DEFAULT_GLB_OUT = OUT_DIR / "origens_blockout.glb"
DEFAULT_FINAL_OUT_DIR = OUT_DIR / "eras" / "origens"
DEFAULT_SPLINE_JSON_OUT = OUT_DIR / "origens_line_spline.json"
DEFAULT_PREVIEW_OUT = PREVIEWS_DIR / "t210_origens_blockout.png"
DEFAULT_FINAL_PREVIEW_OUT = PREVIEWS_DIR / "t214_origens_final.png"


# ------------------------------------------------------------------ CLI parsing


def parse_cli_args() -> dict[str, Any]:
    """Parse arguments after `--` on the Blender command line."""
    mode = "blockout"
    out_glb: Path | None = None
    out_dir: Path | None = None
    out_spline: Path | None = None
    out_preview: Path | None = None
    render_preview = True

    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1 :]
        i = 0
        while i < len(args):
            arg = args[i]
            if arg == "--mode" and i + 1 < len(args):
                mode = args[i + 1].strip().lower()
                i += 2
            elif arg == "--out" and i + 1 < len(args):
                out_glb = Path(os.path.abspath(args[i + 1]))
                i += 2
            elif arg == "--out-dir" and i + 1 < len(args):
                out_dir = Path(os.path.abspath(args[i + 1]))
                i += 2
            elif arg == "--spline-out" and i + 1 < len(args):
                out_spline = Path(os.path.abspath(args[i + 1]))
                i += 2
            elif arg == "--preview-out" and i + 1 < len(args):
                out_preview = Path(os.path.abspath(args[i + 1]))
                i += 2
            elif arg == "--no-preview":
                render_preview = False
                i += 1
            else:
                i += 1

    if mode == "final":
        resolved_out_dir = out_dir or DEFAULT_FINAL_OUT_DIR
        resolved_spline = out_spline or (resolved_out_dir / "origens_line_spline.json")
        resolved_preview = out_preview or DEFAULT_FINAL_PREVIEW_OUT
        resolved_out_glb = out_glb or (resolved_out_dir / "origensVisual.glb")
    else:
        resolved_out_dir = out_dir or OUT_DIR
        resolved_spline = out_spline or DEFAULT_SPLINE_JSON_OUT
        resolved_preview = out_preview or DEFAULT_PREVIEW_OUT
        resolved_out_glb = out_glb or DEFAULT_GLB_OUT

    return {
        "mode": mode,
        "out_glb": resolved_out_glb,
        "out_dir": resolved_out_dir,
        "out_spline": resolved_spline,
        "out_preview": resolved_preview,
        "render_preview": render_preview,
    }


# ------------------------------------------------------------------ BMesh helpers


def _assign_uv(
    bm: bmesh.types.BMesh,
    faces: Iterable[bmesh.types.BMFace],
    swatch_name: str,
) -> None:
    """Snap all loop UVs on `faces` to the exact center of `swatch_name` in palette.json."""
    uv_layer = bm.loops.layers.uv.verify()
    u, v = vn_palette.get_swatch_uv(swatch_name, gltf=False)
    for face in faces:
        for loop in face.loops:
            loop[uv_layer].uv = (u, v)


def _add_box(
    bm: bmesh.types.BMesh,
    size: tuple[float, float, float],
    center: tuple[float, float, float],
    swatch_name: str,
    rotation_euler: tuple[float, float, float] | None = None,
    top_swatch: str | None = None,
    side_swatch: str | None = None,
    bottom_swatch: str | None = None,
) -> list[bmesh.types.BMFace]:
    """Append an oriented box to `bm` (in Blender coordinates) and assign palette UVs."""
    ret = bmesh.ops.create_cube(bm, size=1.0)
    verts = list(ret["verts"])
    vert_set = set(verts)

    sx, sy, sz = (float(v) for v in size)
    mat = Matrix.Diagonal((sx, sy, sz, 1.0))
    if rotation_euler is not None:
        rot_mat = Euler(tuple(float(a) for a in rotation_euler), "XYZ").to_matrix().to_4x4()
        mat = rot_mat @ mat

    bmesh.ops.transform(bm, matrix=mat, verts=verts)
    bmesh.ops.translate(
        bm,
        vec=Vector(tuple(float(c) for c in center)),
        verts=verts,
    )

    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
    for f in faces:
        f.normal_update()
        if top_swatch and f.normal.z > 0.55:
            _assign_uv(bm, [f], top_swatch)
        elif bottom_swatch and f.normal.z < -0.55:
            _assign_uv(bm, [f], bottom_swatch)
        elif side_swatch and abs(f.normal.z) <= 0.55:
            _assign_uv(bm, [f], side_swatch)
        else:
            _assign_uv(bm, [f], swatch_name)
    return faces


def _add_cylinder_prism(
    bm: bmesh.types.BMesh,
    radius_bottom: float,
    radius_top: float,
    height: float,
    segments: int,
    center: tuple[float, float, float],
    swatch_name: str,
    top_swatch: str | None = None,
    side_swatch: str | None = None,
    rotation_euler: tuple[float, float, float] | None = None,
) -> list[bmesh.types.BMFace]:
    """Append a closed n-gon cylinder/frustum to `bm` and tag its faces with palette swatches."""
    segs = max(6, int(segments))
    rb = max(1e-4, float(radius_bottom))
    rt = max(1e-4, float(radius_top))
    hz = float(height) * 0.5

    rot_mat = (
        Euler(tuple(float(a) for a in rotation_euler), "XYZ").to_matrix().to_4x4()
        if rotation_euler is not None
        else Matrix.Identity(4)
    )
    trans_vec = Vector(tuple(float(c) for c in center))

    bot_ring: list[bmesh.types.BMVert] = []
    top_ring: list[bmesh.types.BMVert] = []
    for i in range(segs):
        ang = (2.0 * math.pi * i) / segs
        ca, sa = math.cos(ang), math.sin(ang)
        vb = (rot_mat @ Vector((rb * ca, rb * sa, -hz))) + trans_vec
        vt = (rot_mat @ Vector((rt * ca, rt * sa, hz))) + trans_vec
        bot_ring.append(bm.verts.new(vb))
        top_ring.append(bm.verts.new(vt))

    created_faces: list[bmesh.types.BMFace] = []
    s_sw = side_swatch or swatch_name
    t_sw = top_swatch or swatch_name

    for i in range(segs):
        j = (i + 1) % segs
        f_side = bm.faces.new((bot_ring[i], bot_ring[j], top_ring[j], top_ring[i]))
        _assign_uv(bm, [f_side], s_sw)
        created_faces.append(f_side)

    f_top = bm.faces.new(top_ring)
    _assign_uv(bm, [f_top], t_sw)
    created_faces.append(f_top)

    f_bot = bm.faces.new(list(reversed(bot_ring)))
    _assign_uv(bm, [f_bot], swatch_name)
    created_faces.append(f_bot)

    return created_faces


def _finalize_bmesh(
    bm: bmesh.types.BMesh,
    name: str,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
    bevel_width: float = 0.015,
    bevel_segments: int = 1,
) -> bpy.types.Object:
    """Convert `bm` into a mesh object bound to the shared `'palette'` material."""
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    for f in bm.faces:
        f.normal_update()

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    pal_mat = vn_palette.ensure_palette_material()
    mesh.materials.clear()
    mesh.materials.append(pal_mat)
    for poly in mesh.polygons:
        poly.material_index = 0

    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(float(v) for v in location)
    vn_scene.link_object(obj, collection)

    if bevel_width > 0.0:
        vn_bevel.finalize_toy_mesh(
            obj,
            bevel_width=bevel_width,
            bevel_segments=bevel_segments,
            apply=True,
        )
    else:
        vn_bevel.apply_weighted_normals(obj, weight=50, keep_sharp=True, apply=True)

    return obj


def _reparent_landmark_to_physical_fixed(
    root_name: str,
    visual_objs: Iterable[bpy.types.Object],
    collider_objs: Iterable[bpy.types.Object],
    collection: bpy.types.Collection | str | None = None,
    friction: float = 0.7,
    extra_props: dict[str, Any] | None = None,
) -> bpy.types.Object:
    """Wrap existing landmark meshes and colliders into a single `<root_name>PhysicalFixed` node.

    In `Objects.js` (`getFromModel`), only direct children of a `*Physical*` root node are
    parsed as Rapier colliders (`^cuboid`, `^tube`, `^ball`, `^trimesh`, `^hull`). Reparenting
    both the visual meshes and the collider empties as direct children of `<root_name>PhysicalFixed`
    (while preserving their world matrix) guarantees every landmark collider is active in Rapier!
    """
    visuals = [v for v in visual_objs if v is not None]
    colliders = [c for c in collider_objs if c is not None]

    bpy.context.view_layer.update()
    saved_vis_mats = [(v, v.matrix_world.copy()) for v in visuals]
    saved_col_mats = [(c, c.matrix_world.copy()) for c in colliders]

    root = vn_collide.wrap_physical_object(
        name=root_name,
        visual_obj=visuals,
        colliders=colliders,
        mass=0.0,
        friction=friction,
        category="floor",
        extra_props=extra_props,
        collection=collection,
        body_type="fixed",
        location=(0.0, 0.0, 0.0),
    )

    bpy.context.view_layer.update()
    for vis, world_mat in saved_vis_mats:
        vis.matrix_world = world_mat
    for col, world_mat in saved_col_mats:
        col.matrix_world = world_mat
    bpy.context.view_layer.update()
    return root


# ------------------------------------------------------------------ 1. Diorama Island & Terrain


def build_diorama_terrain_and_water(
    collection: bpy.types.Collection,
    stats: dict[str, Any],
) -> dict[str, bpy.types.Object]:
    """Build the 70 x 55 m Origens diorama paper-cut island, stepped terraces, street curb, and Rio Tocantins."""
    # 1. Submerged sandbar rim (replaces harsh dark cliff box so island slopes into stylized ocean)
    bm_borders = bmesh.new()
    _add_box(
        bm_borders,
        size=(76.0, 62.0, 0.35),
        center=(0.0, 17.0, -0.78),
        swatch_name="lateriteDark",
        top_swatch="paperWarm",
        side_swatch="lateriteDark",
        bottom_swatch="lateriteDark",
    )
    borders_vis = _finalize_bmesh(
        bm_borders,
        name="OrigensPaperBorders",
        location=(0.0, 0.0, 0.0),
        collection=collection,
        bevel_width=0.04,
        bevel_segments=1,
    )

    bm_terr = bmesh.new()

    # 2. Main Lowland Ground Slab (X in [-34, +34], Y in [-10, +46], top at Z = 0.0 m)
    # Walkable across O1 (Spawn), O2 (1994 block + Casa Natal), O3 (Contact Pipe), and approach corridors.
    _add_box(
        bm_terr,
        size=(68.0, 56.0, 0.50),
        center=(0.0, 18.0, -0.25),
        swatch_name="lateriteDark",
        top_swatch="dryGrass",
        side_swatch="laterite",
        bottom_swatch="lateriteDark",
    )

    # 3. O1 Laterite Street & Sidewalk Curb ("meio-fio da rua de laterita", Y in [-9.5, +4.5])
    # Elevated 6 cm above lowland Z=0.0 (top at Z = +0.06 m) to completely prevent depth-buffer z-fighting at distance.
    _add_box(
        bm_terr,
        size=(36.0, 4.0, 0.12),
        center=(-1.0, -3.8, 0.0),
        swatch_name="laterite",
        top_swatch="laterite",
        side_swatch="lateriteDark",
    )
    # Raised paper/concrete sidewalk curb ("meio-fio") along Y = -1.75 m (top at Z = 0.08 m, autostep 0.35 m)
    _add_box(
        bm_terr,
        size=(36.0, 0.42, 0.16),
        center=(-1.0, -1.75, 0.0),
        swatch_name="paperShadow",
        top_swatch="paperWarm",
        side_swatch="ink",
    )
    # Low town neighbor houses silhouette along the south-east/south-west backdrop (O1 "casas baixas ao fundo")
    _add_box(
        bm_terr,
        size=(4.6, 3.2, 2.4),
        center=(-15.5, -5.5, 1.2),
        swatch_name="paperWarm",
        top_swatch="brick",
        side_swatch="paperWarm",
    )
    _add_box(
        bm_terr,
        size=(4.8, 3.4, 0.55),
        center=(-15.5, -5.5, 2.65),
        swatch_name="brick",
        top_swatch="lateriteDark",
    )
    _add_box(
        bm_terr,
        size=(5.2, 3.4, 2.5),
        center=(16.5, -5.2, 1.25),
        swatch_name="paper",
        top_swatch="brick",
        side_swatch="paper",
    )
    _add_box(
        bm_terr,
        size=(5.4, 3.6, 0.55),
        center=(16.5, -5.2, 2.75),
        swatch_name="brick",
        top_swatch="brickDark",
    )

    # 4. West School Terrace (O8 at `blender (-12.0, 18.0, 0.8)`):
    # Broad plateau X in [-24.0, -4.0], Y in [10.0, 27.0], top at Z = 0.80 m
    _add_box(
        bm_terr,
        size=(20.0, 17.0, 0.80),
        center=(-14.0, 18.5, 0.40),
        swatch_name="laterite",
        top_swatch="dryGrass",
        side_swatch="lateriteDark",
    )
    # Gentle walkable access ramp from South (O1/O3, Y=5.0..10.0, Z=0.0->0.80 m, slope ~9 deg)
    # and stepped terrace blocks (0.27 m, 0.54 m) so auto-walk (`refNav*`) and player walk up effortlessly.
    for step_idx, (sy, sz_top) in enumerate(((7.2, 0.27), (8.8, 0.54)), start=1):
        _add_box(
            bm_terr,
            size=(10.0, 1.8, sz_top),
            center=(-11.0, sy, sz_top * 0.5),
            swatch_name="laterite",
            top_swatch="laterite",
            side_swatch="lateriteDark",
        )

    # 5. North Cerrado Plateau (O6 Pequi Orchard, O7 Secret Termite Mound, O9 Seriema Path, O10 Bus Stop):
    # Broad plateau X in [-24.0, +20.0], Y in [26.0, 47.0], top at Z = 1.60 m
    _add_box(
        bm_terr,
        size=(44.0, 21.0, 1.60),
        center=(-2.0, 36.5, 0.80),
        swatch_name="laterite",
        top_swatch="cerradoGreen",
        side_swatch="lateriteDark",
    )
    # Stepped transition stairs/ramps from central lowland (Z=0.0 -> 1.60 m along Y=20..26, X in [-3..+6])
    for s_idx, (sy, sz_top) in enumerate(
        ((20.0, 0.32), (21.5, 0.64), (23.0, 0.96), (24.5, 1.28)),
        start=1,
    ):
        _add_box(
            bm_terr,
            size=(8.5, 1.6, sz_top),
            center=(1.5, sy, sz_top * 0.5),
            swatch_name="laterite",
            top_swatch="laterite",
            side_swatch="lateriteDark",
        )
    # Stepped transition from O8 School Terrace (Z=0.80 m) to North Plateau (Z=1.60 m) at X=-11, Y=24.5..26.5
    for sy, sz_top in ((24.8, 1.08), (25.8, 1.35)):
        _add_box(
            bm_terr,
            size=(8.0, 1.2, sz_top),
            center=(-11.0, sy, sz_top * 0.5),
            swatch_name="laterite",
            top_swatch="laterite",
            side_swatch="lateriteDark",
        )

    # 6. Northeast CRT Hill (O5 at `blender (14.0, 22.0, 2.4)`):
    # Elevated terrace X in [7.5, 23.5], Y in [16.5, 29.5], top at Z = 2.40 m
    _add_box(
        bm_terr,
        size=(16.0, 13.0, 2.40),
        center=(15.5, 23.0, 1.20),
        swatch_name="lateriteDark",
        top_swatch="dryGrass",
        side_swatch="rock",
    )
    # Stepped bridge connecting O5 Hill (Z=2.40 m) westward to O6 North Plateau (Z=1.60 m) at X in [4.5..7.5], Y=25.5
    for sx, sz_top in ((6.8, 2.15), (5.4, 1.88)):
        _add_box(
            bm_terr,
            size=(1.5, 6.0, sz_top),
            center=(sx, 25.5, sz_top * 0.5),
            swatch_name="laterite",
            top_swatch="laterite",
            side_swatch="lateriteDark",
        )

    terrain_vis = _finalize_bmesh(
        bm_terr,
        name="OrigensTerrainVisual",
        location=(0.0, 0.0, 0.0),
        collection=collection,
        bevel_width=0.02,
        bevel_segments=1,
    )

    # 7. Sculpted Tidewater-tech organic shoreline & undulating cerrado outer rim (un-beveled smooth grid)
    # Terrain noise helpers adapted from dgreenheck/tidewater (MIT, (c) 2026 DRG Software Solutions LLC)
    def _tw_hash2(ix: int, iz: int, s: int) -> float:
        h = (ix * 374761393 + iz * 668265263 + s * 1274126177) & 0xFFFFFFFF
        h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
        h ^= h >> 16
        return (h & 0xFFFFFFFF) / 4294967296.0

    def _tw_erosion_relief(x: float, y: float) -> float:
        total = 0.0
        amp = 0.48
        cell = 11.5
        gx, gy = 0.35, -0.25
        for o in range(4):
            sl = math.hypot(gx, gy) or 1.0
            dx, dy = (gy / sl) * 0.9, (-gx / sl) * 0.9
            px, py = x / cell, y / cell
            ix, iy = math.floor(px), math.floor(py)
            fx, fy = px - ix, py - iy
            v = 0.0
            wt = 0.0
            for jj in (-1, 0, 1):
                for ii in (-1, 0, 1):
                    cx, cy = ix + ii, iy + jj
                    ox = fx - ii - 0.25 - _tw_hash2(cx, cy, 11 + o) * 0.5
                    oy = fy - jj - 0.25 - _tw_hash2(cx, cy, 57 + o) * 0.5
                    d2 = ox * ox + oy * oy
                    if d2 >= 1.5625:
                        continue
                    q = 1.0 - d2 / 1.5625
                    w = q * q * q
                    v += math.cos((ox * dx + oy * dy) * math.tau) * w
                    wt += w
            if wt > 1e-6:
                v /= wt
            total += amp * v
            amp *= 0.5
            cell *= 0.5
        return total

    bm_skirt = bmesh.new()
    nx_grid, ny_grid = 36, 32
    gx_min, gx_max = -42.0, 42.0
    gy_min, gy_max = -17.0, 52.0
    grid_verts: list[list[bmesh.types.BMVert]] = []
    for iy in range(ny_grid + 1):
        vy = gy_min + (gy_max - gy_min) * (iy / ny_grid)
        row_verts: list[bmesh.types.BMVert] = []
        for ix in range(nx_grid + 1):
            vx = gx_min + (gx_max - gx_min) * (ix / nx_grid)
            dx_out = max(0.0, abs(vx) - 31.5)
            dy_out = max(0.0, (-8.0 - vy) if vy < 18.0 else (vy - 44.5))
            edge_dist = math.hypot(dx_out, dy_out)
            relief = _tw_erosion_relief(vx, vy)
            if edge_dist <= 0.01:
                vz = -0.06
            else:
                t_drop = min(1.0, edge_dist / 8.5)
                smooth_drop = t_drop * t_drop * (3.0 - 2.0 * t_drop)
                mound = max(0.0, relief) * (1.0 - smooth_drop) * 1.15
                vz = -0.04 - smooth_drop * 0.92 + mound * 0.65 + relief * 0.14
            row_verts.append(bm_skirt.verts.new((vx, vy, vz)))
        grid_verts.append(row_verts)

    for iy in range(ny_grid):
        for ix in range(nx_grid):
            v00 = grid_verts[iy][ix]
            v10 = grid_verts[iy][ix + 1]
            v11 = grid_verts[iy + 1][ix + 1]
            v01 = grid_verts[iy + 1][ix]
            avg_z = (v00.co.z + v10.co.z + v11.co.z + v01.co.z) * 0.25
            if v00.co.z <= -0.059 and v10.co.z <= -0.059 and v11.co.z <= -0.059 and v01.co.z <= -0.059:
                continue
            try:
                f = bm_skirt.faces.new((v00, v10, v11, v01))
                f.smooth = True
                swatch = "paperWarm" if avg_z < -0.22 else ("laterite" if avg_z < -0.02 else "dryGrass")
                cerrado_kit._tag_faces_swatch(bm_skirt, [f], swatch)
            except ValueError:
                pass

    _finalize_bmesh(
        bm_skirt,
        name="OrigensTerrainSkirt",
        location=(0.0, 0.0, 0.0),
        collection=collection,
        bevel_width=0.0,
        bevel_segments=0,
    )

    # Analytical cuboid colliders matching every walkable terrace & step
    terr_colliders: list[bpy.types.Object] = [
        # Main lowland ground slab (top at Z = 0.0 m)
        vn_collide.add_cuboid(
            "cuboidTerrainLowland",
            size=(68.0, 56.0, 0.50),
            location=(0.0, 18.0, -0.25),
            collection=collection,
        ),
        # Curb along Y = -1.75 m (top at Z = 0.08 m)
        vn_collide.add_cuboid(
            "cuboidStreetCurb",
            size=(36.0, 0.42, 0.16),
            location=(-1.0, -1.75, 0.0),
            collection=collection,
        ),
        # Background low houses colliders
        vn_collide.add_cuboid(
            "cuboidBgHouseWest",
            size=(4.8, 3.4, 2.9),
            location=(-15.5, -5.5, 1.45),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidBgHouseEast",
            size=(5.4, 3.6, 3.0),
            location=(16.5, -5.2, 1.50),
            collection=collection,
        ),
        # O8 West School Terrace (top at Z = 0.80 m) + approach steps (0.27 m, 0.54 m)
        vn_collide.add_cuboid(
            "cuboidTerrainSchoolTerrace",
            size=(20.0, 17.0, 0.80),
            location=(-14.0, 18.5, 0.40),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidSchoolApproachStep1",
            size=(10.0, 1.8, 0.27),
            location=(-11.0, 7.2, 0.135),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidSchoolApproachStep2",
            size=(10.0, 1.8, 0.54),
            location=(-11.0, 8.8, 0.27),
            collection=collection,
        ),
        # North Cerrado Plateau (O6, O7, O9, O10 — top at Z = 1.60 m) + central stairs
        vn_collide.add_cuboid(
            "cuboidTerrainNorthPlateau",
            size=(44.0, 21.0, 1.60),
            location=(-2.0, 36.5, 0.80),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidNorthStep1",
            size=(8.5, 1.6, 0.32),
            location=(1.5, 20.0, 0.16),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidNorthStep2",
            size=(8.5, 1.6, 0.64),
            location=(1.5, 21.5, 0.32),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidNorthStep3",
            size=(8.5, 1.6, 0.96),
            location=(1.5, 23.0, 0.48),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidNorthStep4",
            size=(8.5, 1.6, 1.28),
            location=(1.5, 24.5, 0.64),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidSchoolToNorthStep1",
            size=(8.0, 1.2, 1.08),
            location=(-11.0, 24.8, 0.54),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidSchoolToNorthStep2",
            size=(8.0, 1.2, 1.35),
            location=(-11.0, 25.8, 0.675),
            collection=collection,
        ),
        # O5 Northeast CRT Hill (top at Z = 2.40 m) + west descent steps to O6
        vn_collide.add_cuboid(
            "cuboidTerrainCrtHill",
            size=(16.0, 13.0, 2.40),
            location=(15.5, 23.0, 1.20),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidCrtToNorthStep1",
            size=(1.5, 6.0, 2.15),
            location=(6.8, 25.5, 1.075),
            collection=collection,
        ),
        vn_collide.add_cuboid(
            "cuboidCrtToNorthStep2",
            size=(1.5, 6.0, 1.88),
            location=(5.4, 25.5, 0.94),
            collection=collection,
        ),
    ]

    terrain_root = vn_collide.wrap_physical_object(
        name="origensTerrain",
        visual_obj=terrain_vis,
        colliders=terr_colliders,
        mass=0.0,
        friction=0.75,
        category="floor",
        extra_props={"era": "origens", "islandSizeM": [70.0, 55.0]},
        collection=collection,
        body_type="fixed",
        location=(0.0, 0.0, 0.0),
    )
    stats["colliders"]["cuboid"] += len(terr_colliders)

    # 7. Rio Tocantins Water Strip to the South (`blender_y in [-22..-10]`, PLAN-3D §4.3)
    bm_water = bmesh.new()
    _add_box(
        bm_water,
        size=(70.0, 12.0, 0.35),
        center=(0.0, -16.0, -0.32),
        swatch_name="waterOrigens",
        top_swatch="waterOrigens",
        side_swatch="dataTeal",
    )
    # Riverbank sand/laterite shoreline edge at Y = -10.0 m
    _add_box(
        bm_water,
        size=(70.0, 1.2, 0.25),
        center=(0.0, -10.0, -0.10),
        swatch_name="laterite",
        top_swatch="paperWarm",
        side_swatch="lateriteDark",
    )
    water_vis = _finalize_bmesh(
        bm_water,
        name="OrigensRioTocantinsWater",
        location=(0.0, 0.0, 0.0),
        collection=collection,
        bevel_width=0.01,
        bevel_segments=1,
    )
    vn_scene.set_custom_props(
        water_vis,
        {
            "waterSurface": True,
            "river": "Rio Tocantins",
            "swatch": "waterOrigens",
            "boundsY": [-22.0, -10.0],
        },
    )

    return {"terrain_root": terrain_root, "water": water_vis, "borders": borders_vis}


# ------------------------------------------------------------------ 2. Beats O1, O2, O3


def build_beats_o1_o2_o3(
    collection: bpy.types.Collection,
    stats: dict[str, Any],
) -> dict[str, Any]:
    """Build O1 (Spawn + Immediate Physics Toys), O2 (Marco 1994 + Casa Natal), and O3 (Contact Pipe + End-Dot Island)."""
    built: dict[str, Any] = {}

    # --- O1: Spawn at (0, 0, 0) facing North (+Y in Blender / -Z in Engine) ---
    built["refRespawnOrigens"] = vn_refs.add_respawn(
        "Origens",
        location=(0.0, 0.0, 0.0),
        yaw_deg=0.0,
        props={"era": "origens", "beat": "O1"},
        collection=collection,
    )
    # Also add canonical `refRespawn` alias so existing World.js `references.get('refRespawn')` works seamlessly
    built["refRespawn"] = vn_refs.add_respawn(
        "",
        location=(0.0, 0.0, 0.0),
        yaw_deg=0.0,
        props={"era": "origens", "beat": "O1"},
        collection=collection,
    )

    # O1 Immediate Tactile Physics Toys within 2.5–3.5 m of spawn (west-northwest of spawn so O1->O2 northeast line is 100% clear):
    # a) 3 dynamic Pequi Crates (`crate1..3PhysicalDynamic`) at ~2.6–3.2 m from spawn
    o1_crate_positions = (
        (-2.2, 1.4, 0.0),  # 2.60 m from spawn
        (-2.9, 1.8, 0.0),  # 3.41 m from spawn
        (-2.55, 1.6, 0.84),  # stacked top crate, 3.01 m horizontal from spawn
    )
    for idx, pos in enumerate(o1_crate_positions, start=1):
        crate_root = platform_kit.wrap_pequi_crate_physical(
            name=f"crate{idx}",
            location=pos,
            collection=collection,
            mass=1.2,
            friction=0.5,
        )
        built[f"crate{idx}"] = crate_root
        stats["colliders"]["cuboid"] += 1
        stats["dynamic_toys"] += 1

    # b) 5-piece Domino Brick Line right by the curb (2.5–3.5 m west-southwest of spawn)
    domino_size = (0.18, 0.42, 0.86)
    for idx in range(5):
        dx = -1.6 - idx * 0.44
        dy = -1.15
        dz = domino_size[2] * 0.5
        bm_dom = bmesh.new()
        _add_box(
            bm_dom,
            size=domino_size,
            center=(0.0, 0.0, 0.0),
            swatch_name="brick",
            top_swatch="paperWarm",
            side_swatch="brick",
            bottom_swatch="lateriteDark",
        )
        # Red signal dot on domino face
        _add_box(
            bm_dom,
            size=(0.20, 0.14, 0.14),
            center=(0.0, 0.0, 0.16),
            swatch_name="signal",
        )
        dom_vis = _finalize_bmesh(
            bm_dom,
            name=f"dominoO1_{idx + 1}Visual",
            location=(0.0, 0.0, 0.0),
            collection=collection,
            bevel_width=0.012,
        )
        dom_col = vn_collide.add_cuboid(
            f"cuboidDominoO1_{idx + 1}",
            size=domino_size,
            location=(0.0, 0.0, 0.0),
            collection=collection,
        )
        dom_root = vn_collide.wrap_physical_object(
            name=f"dominoO1_{idx + 1}",
            visual_obj=dom_vis,
            colliders=dom_col,
            mass=0.45,
            friction=0.45,
            restitution=0.15,
            category="object",
            extra_props={"toyType": "domino_brick", "beat": "O1"},
            collection=collection,
            body_type="dynamic",
            location=(dx, dy, dz),
        )
        built[f"dominoO1_{idx + 1}"] = dom_root
        stats["colliders"]["cuboid"] += 1
        stats["dynamic_toys"] += 1

    # --- O2: Marco 1994 ("Nasci em Araguaína/TO") at `blender (1.8, 3.6, 0)` (4.02 m NE of spawn, ZERO obstacles!) ---
    # Floating Milestone Block 1994 at underside height = 2.10 m (center Z = 2.58 m) so Victor runs 4.0 m in ~0.6 s and jumps to hit from below in < 2.5 s!
    ms1994_vis = platform_kit.make_milestone_block(
        name="OrigensMilestone1994Visual",
        location=(0.0, 0.0, -0.48),
        collection=collection,
    )
    ms1994_col = vn_collide.add_cuboid(
        name="cuboidMilestone1994",
        size=(0.96, 0.96, 0.96),
        location=(0.0, 0.0, 0.0),
        props={"interactive": "milestone_block", "entryId": "e-1994-09"},
        collection=collection,
    )
    ms1994_root = vn_collide.wrap_physical_object(
        name="milestone1994Block",
        visual_obj=ms1994_vis,
        colliders=ms1994_col,
        mass=0.0,
        friction=0.5,
        category="floor",
        extra_props={
            "milestoneId": "1994",
            "entryId": "e-1994-09",
            "undersideHeightM": 2.1,
            "beat": "O2",
        },
        collection=collection,
        body_type="fixed",
        location=(1.8, 3.6, 2.58),
    )
    built["milestone1994Block"] = ms1994_root
    stats["colliders"]["cuboid"] += 1

    built["refMilestone1994"] = vn_refs.add_milestone(
        "1994",
        location=(1.8, 3.6, 2.1),
        entry_id="e-1994-09",
        props={
            "year": 1994,
            "title": "Nasci em Araguaína/TO",
            "beat": "O2",
            "distanceFromSpawnM": round(math.hypot(1.8, 3.6), 3),
        },
        collection=collection,
    )

    # Behind O2 (`blender (4.5, 6.5, 0)`) sits the Birthplace House + Ipê site (`refHouse1994`, T2.13a)
    house_data = origens_house_ipe.make_birthplace_house_ipe(
        name_prefix="OrigensHouse",
        location=(4.5, 8.8, 0.0),
        collection=collection,
    )
    built["house1994"] = _reparent_landmark_to_physical_fixed(
        root_name="origensHouse1994",
        visual_objs=house_data["meshes"].values(),
        collider_objs=house_data["colliders"].values(),
        collection=collection,
        friction=0.7,
        extra_props={"beat": "O2", "landmark": "origens_house_ipe", "entryId": "e-1994-09"},
    )
    stats["colliders"]["cuboid"] += len(house_data["colliders"])

    built["refHouse1994"] = vn_refs.add_ref(
        "refHouse1994",
        location=(4.5, 6.5, 0.0),
        props={"beat": "O2", "entryId": "e-1994-09", "landmark": "origens_house_ipe"},
        collection=collection,
    )

    # --- O3: Placa de cordel "Contato →" + cano-atalho at `blender (-6.0, 1.5, 0)` (6.18 m W of spawn, flat clear path!) ---
    pipe_vis = platform_kit.make_copper_pipe(
        name="OrigensContactPipeVisual",
        location=(0.0, 0.0, 0.0),
        collection=collection,
    )
    sign_vis = platform_kit.make_cordel_sign(
        name="OrigensContactCordelSignVisual",
        location=(1.35, -0.35, 0.0),
        collection=collection,
    )
    sign_vis.rotation_euler = (0.0, 0.0, math.radians(15.0))

    pipe_col = vn_collide.add_cylinder(
        name="tubeContactPipe",
        radius=0.60,
        height=1.24,
        location=(0.0, 0.0, 0.62),
        props={"interactive": "shortcut_pipe", "destinationRef": "refEndDotIsland"},
        collection=collection,
    )
    sign_col = vn_collide.add_cuboid(
        name="cuboidContactCordelSign",
        size=(1.12, 0.34, 1.44),
        location=(1.35, -0.35, 0.72),
        rotation=(0.0, 0.0, math.radians(15.0)),
        collection=collection,
    )
    built["contactPipeRoot"] = vn_collide.wrap_physical_object(
        name="origensContactPipe",
        visual_obj=[pipe_vis, sign_vis],
        colliders=[pipe_col, sign_col],
        mass=0.0,
        friction=0.6,
        category="floor",
        extra_props={
            "beat": "O3",
            "interactive": "shortcut_pipe",
            "targetRef": "refEndDotIsland",
            "warpDurationS": 1.5,
        },
        collection=collection,
        body_type="fixed",
        location=(-6.0, 1.5, 0.0),
    )
    stats["colliders"]["tube"] += 1
    stats["colliders"]["cuboid"] += 1

    built["refPipeContact"] = vn_refs.add_ref(
        "refPipeContact",
        location=(-6.0, 1.5, 0.0),
        props={
            "beat": "O3",
            "label": "Contato →",
            "targetRef": "refEndDotIsland",
            "targetSphereRef": "refEndDotSphere",
            "warpDurationS": 1.5,
            "distanceFromSpawnM": round(math.hypot(-6.0, 1.5), 3),
        },
        collection=collection,
    )

    # Provisional End-Dot Mini-Island at `blender (-22.0, 20.0, 4.0)` (T2.13d)
    enddot_data = origens_bus_enddot.make_provisional_enddot_island(
        name_prefix="OrigensEndDot",
        location=(-22.0, 20.0, 4.0),
        collection=collection,
        include_colliders=True,
    )
    enddot_visuals = [
        enddot_data["island"],
        enddot_data["sphere"],
        enddot_data["pipe"],
        enddot_data["sign"],
        enddot_data["line_spiral"],
    ]
    built["endDotIslandRoot"] = _reparent_landmark_to_physical_fixed(
        root_name="origensEndDotIsland",
        visual_objs=enddot_visuals,
        collider_objs=enddot_data["colliders"],
        collection=collection,
        friction=0.75,
        extra_props={"beat": "O3_destination", "landmark": "origens_enddot_island"},
    )
    for col_obj in enddot_data["colliders"]:
        lname = col_obj.name.lower()
        if lname.startswith("cuboid"):
            stats["colliders"]["cuboid"] += 1
        elif lname.startswith("tube"):
            stats["colliders"]["tube"] += 1
        elif lname.startswith("ball"):
            stats["colliders"]["ball"] += 1

    # Reference points on the End-Dot Mini-Island
    # Arrival landing terrace pad (`loc + (-3.15, -2.35, 1.25)` -> `(-25.15, 17.65, 5.25)`)
    built["refEndDotIsland"] = vn_refs.add_ref(
        "refEndDotIsland",
        location=(-22.0, 20.0, 4.0),
        props={
            "beat": "O3_destination",
            "arrivalLanding": [-25.15, 17.65, 5.25],
            "summitSphere": [-21.90, 20.15, 6.48],
        },
        collection=collection,
    )
    built["refEndDotSphere"] = vn_refs.add_ref(
        "refEndDotSphere",
        location=(-21.90, 20.15, 6.48),
        props={
            "beat": "O3_destination",
            "interactive": "contact_stamp_trigger",
            "meshName": "OrigensEndDotSphere",
            "entryId": "contato",
        },
        collection=collection,
    )
    built["refMilestoneContact"] = vn_refs.add_milestone(
        "Contact",
        location=(-21.90, 20.15, 6.48),
        entry_id="contato",
        props={
            "beat": "O3_destination",
            "title": "Vamos conversar",
            "meshName": "OrigensEndDotSphere",
        },
        collection=collection,
    )

    return built


# ------------------------------------------------------------------ 3. Beats O4 & O5 (Termite Steps + CRT 2005)


def build_beats_o4_o5(
    collection: bpy.types.Collection,
    stats: dict[str, Any],
) -> dict[str, Any]:
    """Build O4 (4 stepped cupinzeiros 0.6 m -> 1.2 m -> 1.8 m -> 2.4 m) and O5 (Marco 2005 Giant CRT Desk at (14, 22, 2.4))."""
    built: dict[str, Any] = {}

    # --- O4: 4 Stepped Termite Mounds leading up to the Northeast CRT Hill (`blender (10..16, 10..18, 0..2.4)`) ---
    # Each mound has a flat jumpable top at exact target height (0.6 m, 1.2 m, 1.8 m, 2.4 m)
    mound_specs = (
        ("OrigensTermiteStep1", (10.2, 10.5, 0.0), 0.60, 1.15),
        ("OrigensTermiteStep2", (11.6, 12.8, 0.0), 1.20, 1.20),
        ("OrigensTermiteStep3", (13.0, 15.1, 0.0), 1.80, 1.25),
        ("OrigensTermiteStep4", (14.2, 17.4, 0.0), 2.40, 1.30),
    )
    mound_visuals: list[bpy.types.Object] = []
    mound_colliders: list[bpy.types.Object] = []

    for idx, (m_name, (mx, my, mz), top_h, rad) in enumerate(mound_specs, start=1):
        m_vis = cerrado_kit.make_termite_mound(
            name=f"{m_name}Visual",
            hollow=False,
            location=(mx, my, mz),
            collection=collection,
        )
        # Scale mesh height so its flat stepping apex matches `top_h`
        bpy.context.view_layer.update()
        dims = m_vis.dimensions
        cur_h = max(0.2, float(dims.z))
        cur_r = max(0.2, float(max(dims.x, dims.y)) * 0.5)
        scale_xy = rad / cur_r
        scale_z = top_h / cur_h
        m_vis.data.transform(Matrix.Diagonal((scale_xy, scale_xy, scale_z, 1.0)))
        m_vis.data.update()
        vn_scene.set_custom_props(
            m_vis,
            {"beat": "O4", "stepIndex": idx, "topHeightM": top_h},
        )
        mound_visuals.append(m_vis)

        m_col = vn_collide.add_cylinder(
            name=f"tubeTermiteStep{idx}",
            radius=rad * 0.88,
            height=top_h,
            location=(mx, my, mz + top_h * 0.5),
            props={"beat": "O4", "stepIndex": idx, "topZ": top_h},
            collection=collection,
        )
        mound_colliders.append(m_col)
        stats["colliders"]["tube"] += 1

    built["termiteStepsRoot"] = _reparent_landmark_to_physical_fixed(
        root_name="origensTermiteStepsO4",
        visual_objs=mound_visuals,
        collider_objs=mound_colliders,
        collection=collection,
        friction=0.75,
        extra_props={"beat": "O4", "stepHeightsM": [0.6, 1.2, 1.8, 2.4]},
    )

    # --- O5: Marco 2005 ("Fiz o meu primeiro blog, Ponto Interativo") at `blender (14.0, 22.0, 2.4)` ---
    crt_parts = origens_crt_desk.make_crt_desk_landmark(
        location=(14.0, 22.0, 2.4),
        collection=collection,
        include_colliders=True,
    )
    crt_visuals = [
        crt_parts["OrigensCrtChair"],
        crt_parts["OrigensCrtDesk"],
        crt_parts["OrigensCrtKeyboard"],
        crt_parts["OrigensCrtPowerButton"],
        crt_parts["OrigensCrtMonitor"],
        crt_parts["screen"],
    ]
    crt_colliders = [
        obj for key, obj in crt_parts.items() if key.startswith("cuboid")
    ]
    built["crtDeskRoot"] = _reparent_landmark_to_physical_fixed(
        root_name="origensCrtDesk2005",
        visual_objs=crt_visuals,
        collider_objs=crt_colliders,
        collection=collection,
        friction=0.7,
        extra_props={"beat": "O5", "entryId": "e-2005-01", "landmark": "origens_crt_desk"},
    )
    stats["colliders"]["cuboid"] += len(crt_colliders)

    built["refMilestone2005"] = vn_refs.add_milestone(
        "2005",
        location=(14.0, 22.0, 2.4),
        entry_id="e-2005-01",
        props={
            "year": 2005,
            "title": "Fiz o meu primeiro blog, Ponto Interativo",
            "beat": "O5",
            "powerButtonWorld": [14.0, 21.6, 4.48],
            "screenMesh": "screen",
        },
        collection=collection,
    )

    return built


# ------------------------------------------------------------------ 4. Beats O6 & O7 (Pequi Orchard + Secret Cupinzeiro)


def build_beats_o6_o7(
    collection: bpy.types.Collection,
    stats: dict[str, Any],
) -> dict[str, Any]:
    """Build O6 (Pequi Orchard at (2.0, 28.0, 1.6) with 6 crates, kickable pequi fruits, bowling pins, ramp) and O7 (Secret Hollow Termite Mound at (-14.0, 32.0, 1.6))."""
    built: dict[str, Any] = {}

    # --- O6: Pomar de pequizeiros com caixotes de pequi at `blender (2.0, 28.0, 1.6)` ---
    # 1. Three Pequizeiro trees framing the orchard clearing + analytical trunk colliders
    pequi_tree_locs = (
        (-1.8, 30.5, 1.6),
        (5.6, 30.2, 1.6),
        (2.2, 33.8, 1.6),
    )
    tree_visuals: list[bpy.types.Object] = []
    tree_colliders: list[bpy.types.Object] = []
    for idx, tloc in enumerate(pequi_tree_locs, start=1):
        t_vis = cerrado_kit.make_pequizeiro(
            name=f"OrigensPequizeiro{idx}Visual",
            location=tloc,
            collection=collection,
        )
        tree_visuals.append(t_vis)
        t_col = vn_collide.add_cylinder(
            name=f"tubePequizeiroTrunk{idx}",
            radius=0.45,
            height=2.6,
            location=(tloc[0], tloc[1], tloc[2] + 1.3),
            collection=collection,
        )
        tree_colliders.append(t_col)
        stats["colliders"]["tube"] += 1

    # 2. Fun Playground Launch Ramp in O6 (`blender (-4.8, 28.5, 1.6)`, 25 deg rise westward toward O7 gap)
    bm_ramp = bmesh.new()
    ramp_w, ramp_len, ramp_h = 2.6, 3.2, 1.15
    rv = [
        (0.0, -ramp_w * 0.5, 0.0),
        (0.0, ramp_w * 0.5, 0.0),
        (-ramp_len, ramp_w * 0.5, 0.0),
        (-ramp_len, -ramp_w * 0.5, 0.0),
        (-ramp_len, -ramp_w * 0.5, ramp_h),
        (-ramp_len, ramp_w * 0.5, ramp_h),
    ]
    bverts = [bm_ramp.verts.new(co) for co in rv]
    rfaces = [
        bm_ramp.faces.new((bverts[0], bverts[3], bverts[2], bverts[1])),
        bm_ramp.faces.new((bverts[0], bverts[1], bverts[5], bverts[4])),
        bm_ramp.faces.new((bverts[3], bverts[4], bverts[5], bverts[2])),
        bm_ramp.faces.new((bverts[0], bverts[4], bverts[3])),
        bm_ramp.faces.new((bverts[1], bverts[2], bverts[5])),
    ]
    _assign_uv(bm_ramp, rfaces, "wood")
    _assign_uv(bm_ramp, [rfaces[1]], "laterite")
    ramp_vis = _finalize_bmesh(
        bm_ramp,
        name="OrigensPlaygroundRampVisual",
        location=(-3.8, 29.5, 1.6),
        collection=collection,
        bevel_width=0.015,
    )
    ramp_col = vn_collide.add_hull(
        name="hullPlaygroundRamp",
        mesh_or_obj=ramp_vis,
        compute_hull=True,
        strip_materials=True,
        collection=collection,
    )
    stats["colliders"]["hull"] += 1

    built["orchardStaticRoot"] = _reparent_landmark_to_physical_fixed(
        root_name="origensPequiOrchardO6",
        visual_objs=[*tree_visuals, ramp_vis],
        collider_objs=[*tree_colliders, ramp_col],
        collection=collection,
        friction=0.75,
        extra_props={"beat": "O6"},
    )

    # 3. Six dynamic pushable/breakable Pequi Crates (`crate4..9PhysicalDynamic`, `mass=1.2`) in O6 (`blender (2.0, 28.0, 1.6)`)
    o6_crate_positions = (
        (0.9, 27.6, 1.6),
        (2.0, 27.6, 1.6),
        (3.1, 27.6, 1.6),
        (1.45, 27.6, 2.44),
        (2.55, 27.6, 2.44),
        (2.0, 27.6, 3.28),
    )
    for offset_idx, pos in enumerate(o6_crate_positions, start=4):
        c_root = platform_kit.wrap_pequi_crate_physical(
            name=f"crate{offset_idx}",
            location=pos,
            collection=collection,
            mass=1.2,
            friction=0.5,
        )
        built[f"crate{offset_idx}"] = c_root
        stats["colliders"]["cuboid"] += 1
        stats["dynamic_toys"] += 1

    # 4. Kickable Physics Pequi Fruits (`ball*` colliders, `mass=0.4`) in O6
    pequi_fruit_positions = (
        (0.2, 26.2, 1.92),
        (1.6, 25.8, 1.92),
        (3.2, 26.3, 1.92),
        (4.1, 28.4, 1.92),
    )
    fruit_radius = 0.30
    for idx, fpos in enumerate(pequi_fruit_positions, start=1):
        bm_fruit = bmesh.new()
        bmesh.ops.create_icosphere(bm_fruit, subdivisions=2, radius=fruit_radius)
        _assign_uv(bm_fruit, bm_fruit.faces, "pequi" if idx % 2 == 1 else "ipeGold")
        f_vis = _finalize_bmesh(
            bm_fruit,
            name=f"pequiFruit{idx}Visual",
            location=(0.0, 0.0, 0.0),
            collection=collection,
            bevel_width=0.0,
        )
        f_col = vn_collide.add_ball(
            name=f"ballPequiFruit{idx}",
            radius=fruit_radius,
            location=(0.0, 0.0, 0.0),
            collection=collection,
        )
        f_root = vn_collide.wrap_physical_object(
            name=f"pequiFruit{idx}",
            visual_obj=f_vis,
            colliders=f_col,
            mass=0.4,
            friction=0.35,
            restitution=0.55,
            category="object",
            extra_props={"toyType": "pequi_fruit", "beat": "O6"},
            collection=collection,
            body_type="dynamic",
            location=fpos,
        )
        built[f"pequiFruit{idx}"] = f_root
        stats["colliders"]["ball"] += 1
        stats["dynamic_toys"] += 1

    # 5. Bowling Pin Stack (6 dynamic pins in a 3-2-1 triangle) in O6 (`blender (4.4, 29.0, 1.6)`)
    bowling_offsets = (
        (0.0, 0.0),
        (-0.32, 0.52),
        (0.32, 0.52),
        (-0.64, 1.04),
        (0.0, 1.04),
        (0.64, 1.04),
    )
    pin_h = 0.74
    pin_r = 0.16
    for idx, (ox, oy) in enumerate(bowling_offsets, start=1):
        bm_pin = bmesh.new()
        _add_cylinder_prism(
            bm_pin,
            radius_bottom=pin_r,
            radius_top=pin_r * 0.72,
            height=pin_h,
            segments=8,
            center=(0.0, 0.0, 0.0),
            swatch_name="paper",
            top_swatch="signal",
            side_swatch="paperWarm",
        )
        p_vis = _finalize_bmesh(
            bm_pin,
            name=f"bowlingPin{idx}Visual",
            location=(0.0, 0.0, 0.0),
            collection=collection,
            bevel_width=0.008,
        )
        p_col = vn_collide.add_cylinder(
            name=f"tubeBowlingPin{idx}",
            radius=pin_r,
            height=pin_h,
            location=(0.0, 0.0, 0.0),
            collection=collection,
        )
        p_root = vn_collide.wrap_physical_object(
            name=f"bowlingPin{idx}",
            visual_obj=p_vis,
            colliders=p_col,
            mass=0.35,
            friction=0.4,
            restitution=0.25,
            category="object",
            extra_props={"toyType": "bowling_pin", "beat": "O6"},
            collection=collection,
            body_type="dynamic",
            location=(4.2 + ox, 28.2 + oy, 1.6 + pin_h * 0.5),
        )
        built[f"bowlingPin{idx}"] = p_root
        stats["colliders"]["tube"] += 1
        stats["dynamic_toys"] += 1

    # --- O7: Segredo: cupinzeiro oco com cano escondido (`blender (-14.0, 32.0, 1.6)`) ---
    # Launch ledge on the west edge of O6 (`blender (-8.2, 31.2, 2.75)`) -> 4.5 m ribbon-glide gap ->
    # Secret rocky outcrop (`blender (-14.0, 32.0, 1.6)`) screened by 3 Buriti palms (`cerrado_kit.make_buriti`).
    bm_o7_ledge = bmesh.new()
    # Launch outcrop at X=-8.2, Y=31.2 (top at Z = 2.75 m, +1.15 m above 1.60 m plateau)
    _add_box(
        bm_o7_ledge,
        size=(2.4, 2.6, 1.15),
        center=(-8.2, 31.2, 2.175),
        swatch_name="rock",
        top_swatch="laterite",
        side_swatch="rockDark",
    )
    # Secret landing plinth around (-14.0, 32.0, 1.6)
    _add_cylinder_prism(
        bm_o7_ledge,
        radius_bottom=2.8,
        radius_top=2.5,
        height=0.30,
        segments=10,
        center=(-14.0, 32.0, 1.75),
        swatch_name="rockDark",
        top_swatch="lateriteDark",
        side_swatch="rock",
    )
    o7_ledge_vis = _finalize_bmesh(
        bm_o7_ledge,
        name="OrigensSecretOutcropVisual",
        location=(0.0, 0.0, 0.0),
        collection=collection,
        bevel_width=0.015,
    )

    secret_mound_vis = cerrado_kit.make_termite_mound(
        name="OrigensSecretTermiteHollowVisual",
        hollow=True,
        location=(-14.0, 32.0, 1.90),
        collection=collection,
    )
    # Scale hollow mound so it stands 1.45 m tall with a wide hollow chimney on top
    secret_mound_vis.data.transform(Matrix.Diagonal((1.45, 1.45, 1.35, 1.0)))
    secret_mound_vis.data.update()

    # Hidden Copper Pipe inside the hollow termite mound (`T2.20b`)
    hidden_pipe_vis = platform_kit.make_copper_pipe(
        name="OrigensSecretHiddenPipeVisual",
        location=(-14.0, 32.0, 1.90),
        collection=collection,
    )
    hidden_pipe_vis.scale = (0.72, 0.72, 0.85)

    # 3 Buriti palms screening the northwest secret (`atrás de buritis`)
    buriti_locs = (
        (-11.8, 29.8, 1.6),
        (-16.4, 30.6, 1.6),
        (-13.6, 35.0, 1.6),
    )
    buriti_visuals: list[bpy.types.Object] = []
    buriti_colliders: list[bpy.types.Object] = []
    for idx, bloc in enumerate(buriti_locs, start=1):
        b_vis = cerrado_kit.make_buriti(
            name=f"OrigensSecretBuriti{idx}Visual",
            location=bloc,
            collection=collection,
        )
        buriti_visuals.append(b_vis)
        b_col = vn_collide.add_cylinder(
            name=f"tubeSecretBuriti{idx}",
            radius=0.32,
            height=4.5,
            location=(bloc[0], bloc[1], bloc[2] + 2.25),
            collection=collection,
        )
        buriti_colliders.append(b_col)
        stats["colliders"]["tube"] += 1

    o7_colliders = [
        vn_collide.add_cuboid(
            "cuboidSecretGlideLaunch",
            size=(2.4, 2.6, 1.15),
            location=(-8.2, 31.2, 2.175),
            props={"beat": "O7", "role": "glide_launch_ledge", "gapToSecretM": 4.5},
            collection=collection,
        ),
        vn_collide.add_cylinder(
            "tubeSecretOutcropBase",
            radius=2.6,
            height=0.30,
            location=(-14.0, 32.0, 1.75),
            collection=collection,
        ),
        vn_collide.add_cylinder(
            "tubeSecretTermiteMound",
            radius=0.92,
            height=1.40,
            location=(-14.0, 32.0, 2.60),
            props={"beat": "O7", "interactive": "secret_termite_hollow"},
            collection=collection,
        ),
        *buriti_colliders,
    ]
    stats["colliders"]["cuboid"] += 1
    stats["colliders"]["tube"] += 2

    built["secretO7Root"] = _reparent_landmark_to_physical_fixed(
        root_name="origensSecretTermiteO7",
        visual_objs=[o7_ledge_vis, secret_mound_vis, hidden_pipe_vis, *buriti_visuals],
        collider_objs=o7_colliders,
        collection=collection,
        friction=0.75,
        extra_props={"beat": "O7", "gapM": 4.5},
    )

    # Breakable hollow termite top cap (`crateSecretCapPhysicalDynamic`, broken by Stamp after ribbon-gliding across the 4.5 m gap!)
    bm_cap = bmesh.new()
    _add_cylinder_prism(
        bm_cap,
        radius_bottom=0.68,
        radius_top=0.52,
        height=0.24,
        segments=8,
        center=(0.0, 0.0, 0.0),
        swatch_name="termite",
        top_swatch="laterite",
        side_swatch="lateriteDark",
    )
    cap_vis = _finalize_bmesh(
        bm_cap,
        name="crateSecretTermiteCapVisual",
        location=(0.0, 0.0, 0.0),
        collection=collection,
        bevel_width=0.012,
    )
    cap_col = vn_collide.add_cylinder(
        name="tubeSecretTermiteCap",
        radius=0.65,
        height=0.24,
        location=(0.0, 0.0, 0.0),
        collection=collection,
    )
    # Named `crateSecretTermiteCap` so `World.js` (`^crate\d` or breakables) and `T2.20b` can break it with Stamp
    built["crate10SecretCap"] = vn_collide.wrap_physical_object(
        name="crate10SecretCap",
        visual_obj=cap_vis,
        colliders=cap_col,
        mass=1.5,
        friction=0.8,
        category="object",
        extra_props={
            "breakable": True,
            "beat": "O7",
            "role": "secret_termite_breakable_cap",
        },
        collection=collection,
        body_type="dynamic",
        location=(-14.0, 32.0, 3.42),
    )
    stats["colliders"]["tube"] += 1
    stats["dynamic_toys"] += 1

    built["refSecretTermite"] = vn_refs.add_ref(
        "refSecretTermite",
        location=(-14.0, 32.0, 1.6),
        props={
            "beat": "O7",
            "interactive": "stamp_hollow_termite",
            "launchLedge": [-8.2, 31.2, 2.75],
            "glideGapM": 4.5,
            "capHeightZ": 3.42,
            "hiddenSignals": ["refSignal18", "refSignal19", "refSignal20"],
        },
        collection=collection,
    )

    return built


# ------------------------------------------------------------------ 5. Beats O8, O9, O10 (School 2011, Seriema Path, Bus Stop)


def build_beats_o8_o9_o10(
    collection: bpy.types.Collection,
    stats: dict[str, Any],
) -> dict[str, Any]:
    """Build O8 (Marco 2011 School at (-12.0, 18.0, 0.8)), O9 (Seriema waypoints), and O10 (Bus Stop at (0.0, 44.0, 1.6))."""
    built: dict[str, Any] = {}

    # --- O8: Marco 2011 ("Terminei o ensino médio") at `blender (-12.0, 18.0, 0.8)` ---
    school_data = origens_school.make_school_landmark(
        location=(-12.0, 18.0, 0.8),
        collection=collection,
        include_colliders=True,
    )
    built["schoolRoot"] = _reparent_landmark_to_physical_fixed(
        root_name="origensSchool2011",
        visual_objs=school_data["meshes"].values(),
        collider_objs=school_data["colliders"].values(),
        collection=collection,
        friction=0.75,
        extra_props={
            "beat": "O8",
            "entryId": "e-2011-12",
            "landmark": "origens_school",
            "capeloMesh": "OrigensCapelo",
        },
    )
    stats["colliders"]["cuboid"] += len(school_data["colliders"])

    built["refMilestone2011"] = vn_refs.add_milestone(
        "2011",
        location=(-12.0, 18.0, 0.8),
        entry_id="e-2011-12",
        props={
            "year": 2011,
            "title": "Terminei o ensino médio",
            "beat": "O8",
            "capeloMesh": "OrigensCapelo",
            "capeloWorld": [-12.0, 19.65, 4.50],
            "roofStepsLocalM": [0.9, 1.8, 3.1, 3.4, 3.7],
        },
        collection=collection,
    )

    # --- O9: Seriema Path (`refSeriema1..4` waypoints across North open cerrado `blender (-4..10, 34..40, 1.6)`) ---
    seriema_waypoints = (
        (1, (-4.0, 34.5, 1.6), "refSeriema2"),
        (2, (0.5, 36.8, 1.6), "refSeriema3"),
        (3, (5.5, 38.4, 1.6), "refSeriema4"),
        (4, (10.0, 39.8, 1.6), "refSeriema1"),
    )
    for idx, wloc, next_wp in seriema_waypoints:
        built[f"refSeriema{idx}"] = vn_refs.add_ref(
            f"refSeriema{idx}",
            location=wloc,
            props={
                "beat": "O9",
                "waypointIndex": idx,
                "nextWaypoint": next_wp,
                "achievement": "Corredor do cerrado",
            },
            collection=collection,
        )

    # Add low cerrado rocks & wildflower clusters along the O9 open cerrado path for visual rhythm
    o9_decor = [
        cerrado_kit.make_laterite_rock(
            name="OrigensCerradoRockO9_1",
            location=(-5.5, 37.2, 1.6),
            collection=collection,
        ),
        cerrado_kit.make_laterite_rock(
            name="OrigensCerradoRockO9_2",
            location=(8.2, 35.5, 1.6),
            collection=collection,
        ),
        cerrado_kit.make_cerrado_flowers(
            name="OrigensCerradoFlowersO9_1",
            location=(-1.5, 38.0, 1.6),
            collection=collection,
        ),
        cerrado_kit.make_cerrado_flowers(
            name="OrigensCerradoFlowersO9_2",
            location=(6.4, 39.6, 1.6),
            collection=collection,
        ),
        cerrado_kit.make_grass_clump(
            name="OrigensCerradoGrassO1_1",
            location=(3.2, 1.2, 0.0),
            collection=collection,
        ),
        cerrado_kit.make_grass_clump(
            name="OrigensCerradoGrassO4_1",
            location=(8.5, 9.0, 0.0),
            collection=collection,
        ),
    ]
    built["cerradoDecor"] = o9_decor

    # --- O10: Ponto de ônibus "Araguaína → Campinas" at North exit `blender (0.0, 44.0, 1.6)` ---
    bus_data = origens_bus_enddot.make_bus_stop(
        name_prefix="OrigensBusStop",
        location=(0.0, 44.0, 1.6),
        collection=collection,
        include_colliders=True,
    )
    built["busStopRoot"] = _reparent_landmark_to_physical_fixed(
        root_name="origensBusStopO10",
        visual_objs=[bus_data["shelter"], bus_data["totem"]],
        collider_objs=bus_data["colliders"],
        collection=collection,
        friction=0.75,
        extra_props={
            "beat": "O10",
            "route": "Araguaína → Campinas",
            "nextEra": "unicamp",
        },
    )
    stats["colliders"]["cuboid"] += len(bus_data["colliders"])

    built["refBusStopOrigens"] = vn_refs.add_ref(
        "refBusStopOrigens",
        location=(0.0, 44.0, 1.6),
        props={
            "beat": "O10",
            "label": "Araguaína → Campinas",
            "sliceStatus": "Em breve",
            "nextEra": "unicamp",
            "transitionDurationS": 4.0,
        },
        collection=collection,
    )

    return built


# ------------------------------------------------------------------ 6. Beat O11: A Linha (`OrigensLineRibbon` + `refLinePoint01..16` + JSON)


LINE_CONTROL_POINTS_BLENDER: tuple[tuple[float, float, float], ...] = (
    (3.92, 5.18, 0.12),   # 01: Doorstep threshold of O2 Casa Natal
    (6.20, 6.80, 0.25),   # 02: Sweeping out from O2 porch toward O4
    (9.40, 10.20, 0.65),  # 03: Alongside O4 first termite mound
    (11.80, 14.20, 1.45), # 04: Climbing O4 stepped termite mounds
    (13.60, 18.20, 2.45), # 05: Cresting O5 Northeast CRT Hill
    (11.20, 23.60, 2.50), # 06: Looping past O5 Giant CRT Desk toward steps
    (7.40, 25.50, 2.38),  # 07: Crossing west bridge steps cleanly above rim
    (2.50, 26.80, 1.75),  # 08: Sweeping through O6 Pequi Orchard
    (-3.20, 24.50, 1.45), # 09: Curving southwest from O6 toward O8 School
    (-8.20, 19.80, 0.95), # 10: Entering O8 School Courtyard
    (-11.40, 16.20, 0.95),# 11: Looping past O8 School Flagpole & Awning
    (-10.20, 22.40, 1.25),# 12: Heading north out of O8 School toward North Plateau
    (-5.60, 28.80, 1.75), # 13: Passing east of O7 glide launch & west of O6
    (-2.20, 34.50, 1.75), # 14: Crossing O9 Seriema open cerrado path
    (-0.50, 39.50, 1.75), # 15: Approaching O10 Bus Stop
    (0.00, 42.32, 1.75),  # 16: Terminating at O10 Bus Stop arrival medallion
)


def build_beat_o11_line(
    collection: bpy.types.Collection,
    spline_json_out: Path,
) -> dict[str, Any]:
    """Build O11 'a Linha' (`OrigensLineRibbon` + `refLinePoint01..16` + `refLinePoint1..16` + spline JSON)."""
    pts_b = [tuple(float(c) for c in pt) for pt in LINE_CONTROL_POINTS_BLENDER]

    # Sample uniform polyline to compute exact total arc length
    ctrl_vecs = [Vector(pt) for pt in pts_b]
    sampled_vecs, arc_s = vn_shapes._sample_spline_uniform(ctrl_vecs, step=0.25)
    total_arc_len = round(float(arc_s[-1]), 3)

    ribbon_obj = vn_shapes.make_ribbon(
        name="OrigensLineRibbon",
        points=pts_b,
        width=0.35,
        thickness=0.04,
        step=0.25,
        elevation=0.02,
        bevel_width=0.008,
        collection=collection,
        engine_coords=False,
    )
    vn_palette.assign(ribbon_obj, "signal")
    vn_scene.set_custom_props(
        ribbon_obj,
        {
            "beat": "O11",
            "isLineRibbon": True,
            "era": "origens",
            "length": total_arc_len,
            "pointCount": len(pts_b),
        },
    )

    line_refs: list[bpy.types.Object] = []
    control_points_json: list[dict[str, Any]] = []

    for idx, pt_b in enumerate(pts_b, start=1):
        pt_e = vn_scene.to_engine(*pt_b)
        props = {
            "index": idx,
            "beat": "O11",
            "era": "origens",
        }
        # Zero-padded canonical name required by T2.10 prompt: `refLinePoint01..16`
        ref_padded = vn_refs.add_ref(
            f"refLinePoint{idx:02d}",
            location=pt_b,
            props=props,
            collection=collection,
        )
        line_refs.append(ref_padded)

        # Also add unpadded `refLinePoint1..9` for 1-digit indices so both `refLinePoint01` and `refLinePoint1` resolve
        if idx < 10:
            vn_refs.add_line_point(
                idx,
                location=pt_b,
                props=props,
                collection=collection,
                engine_coords=False,
            )

        control_points_json.append(
            {
                "index": idx,
                "name": f"refLinePoint{idx:02d}",
                "blender": [round(pt_b[0], 4), round(pt_b[1], 4), round(pt_b[2], 4)],
                "engine": [round(pt_e[0], 4), round(pt_e[1], 4), round(pt_e[2], 4)],
            }
        )

    sampled_json = []
    for s_vec, s_dist in zip(sampled_vecs, arc_s):
        se = vn_scene.to_engine(s_vec.x, s_vec.y, s_vec.z)
        sampled_json.append(
            {
                "s": round(float(s_dist), 4),
                "blender": [round(float(s_vec.x), 4), round(float(s_vec.y), 4), round(float(s_vec.z), 4)],
                "engine": [round(se[0], 4), round(se[1], 4), round(se[2], 4)],
            }
        )

    spline_payload = {
        "era": "origens",
        "name": "OrigensLineRibbon",
        "width": 0.35,
        "thickness": 0.04,
        "step": 0.25,
        "length": total_arc_len,
        "controlPoints": control_points_json,
        "sampledPoints": sampled_json,
    }
    spline_json_out.parent.mkdir(parents=True, exist_ok=True)
    spline_json_out.write_text(json.dumps(spline_payload, indent=2), encoding="utf-8")

    return {
        "ribbon": ribbon_obj,
        "refs": line_refs,
        "length": total_arc_len,
        "spline_json_path": str(spline_json_out),
    }


# ------------------------------------------------------------------ 7. Navigation Graph (`refNav01..12`), Cameras (`refCamera1..5`), 20 Signals (`refSignal01..20`), Zones


def build_refs_nav_cameras_signals_zones(
    collection: bpy.types.Collection,
) -> dict[str, Any]:
    """Place `refNav01..12`, `refCamera1..5`, `refSignal01..20` (+ `refSignal1..20`), `refZoneBounding`, and `refZoneFrustum`."""
    refs: dict[str, Any] = {"nav": [], "cameras": [], "signals": [], "zones": []}

    # --- 1. Connected Navigation Graph (`refNav01..12` for `T2.NAV` Auto-Walk) ---
    # Walkable graph connecting `spawn` -> `milestone1994` -> `pipeContact` -> `milestone2005` -> `milestone2011` -> `busStop`
    nav_specs: tuple[dict[str, Any], ...] = (
        {
            "idx": 1,
            "nodeId": "nav01_spawn",
            "role": "spawn",
            "loc": (0.0, 0.0, 0.0),
            "neighbors": ["refNav02", "refNav03", "refNav04"],
            "targetMilestone": "spawn",
        },
        {
            "idx": 2,
            "nodeId": "nav02_milestone1994",
            "role": "milestone1994",
            "loc": (1.8, 3.6, 0.0),
            "neighbors": ["refNav01", "refNav04", "refNav05"],
            "targetMilestone": "e-1994-09",
        },
        {
            "idx": 3,
            "nodeId": "nav03_pipeContact",
            "role": "pipeContact",
            "loc": (-6.0, 1.5, 0.0),
            "neighbors": ["refNav01", "refNav09"],
            "targetMilestone": "contato",
        },
        {
            "idx": 4,
            "nodeId": "nav04_crossroadsSouth",
            "role": "hub_south",
            "loc": (0.5, 8.5, 0.0),
            "neighbors": ["refNav01", "refNav02", "refNav05", "refNav08", "refNav09"],
            "targetMilestone": "",
        },
        {
            "idx": 5,
            "nodeId": "nav05_termiteBaseO4",
            "role": "o4_approach",
            "loc": (8.5, 10.0, 0.0),
            "neighbors": ["refNav02", "refNav04", "refNav06", "refNav08"],
            "targetMilestone": "",
        },
        {
            "idx": 6,
            "nodeId": "nav06_crtHillApproach",
            "role": "o5_approach",
            "loc": (10.5, 22.0, 2.4),
            "neighbors": ["refNav05", "refNav07", "refNav08"],
            "targetMilestone": "",
        },
        {
            "idx": 7,
            "nodeId": "nav07_milestone2005",
            "role": "milestone2005",
            "loc": (14.0, 19.5, 2.4),
            "neighbors": ["refNav06", "refNav08"],
            "targetMilestone": "e-2005-01",
        },
        {
            "idx": 8,
            "nodeId": "nav08_pequiOrchardO6",
            "role": "o6_orchard",
            "loc": (2.0, 26.5, 1.6),
            "neighbors": ["refNav04", "refNav05", "refNav06", "refNav07", "refNav11"],
            "targetMilestone": "",
        },
        {
            "idx": 9,
            "nodeId": "nav09_schoolApproach",
            "role": "o8_approach",
            "loc": (-11.0, 9.5, 0.8),
            "neighbors": ["refNav03", "refNav04", "refNav10"],
            "targetMilestone": "",
        },
        {
            "idx": 10,
            "nodeId": "nav10_milestone2011",
            "role": "milestone2011",
            "loc": (-12.0, 15.0, 0.8),
            "neighbors": ["refNav09", "refNav11"],
            "targetMilestone": "e-2011-12",
        },
        {
            "idx": 11,
            "nodeId": "nav11_northCerradoO9",
            "role": "o9_cerrado",
            "loc": (-2.0, 34.5, 1.6),
            "neighbors": ["refNav08", "refNav10", "refNav12"],
            "targetMilestone": "",
        },
        {
            "idx": 12,
            "nodeId": "nav12_busStop",
            "role": "busStop",
            "loc": (0.0, 41.5, 1.6),
            "neighbors": ["refNav11"],
            "targetMilestone": "busStop",
        },
    )

    for spec in nav_specs:
        idx = spec["idx"]
        neighbors_list = spec["neighbors"]
        nav_props = {
            "index": idx,
            "nodeId": spec["nodeId"],
            "role": spec["role"],
            "neighbors": ",".join(neighbors_list),
            "links": neighbors_list,
            "targetMilestone": spec["targetMilestone"],
        }
        nav_obj = vn_refs.add_nav_node(
            f"{idx:02d}",
            location=spec["loc"],
            links=neighbors_list,
            props=nav_props,
            collection=collection,
        )
        refs["nav"].append(nav_obj)
        if idx < 10:
            vn_refs.add_nav_node(
                f"{idx}",
                location=spec["loc"],
                links=neighbors_list,
                props=nav_props,
                collection=collection,
            )

    # --- 2. Authored Camera Zones (`refCamera1..5`) ---
    # Note: `View.js` reads `lookAt` in engine coordinates `[x_e, y_e, z_e]` as well as `yaw`, `pitch`, `distance`, `radius`.
    camera_specs = (
        # Zone 1: Spawn / O1–O3 (South street, 1994 block, Contact Pipe)
        ("1", (0.0, -9.5, 6.2), 0.0, 28.0, 10.5, 16.0, (0.0, 1.0, -3.5), "O1_O3_Spawn"),
        # Zone 2: O4–O5 CRT Hill (Northeast)
        ("2", (18.5, 12.5, 8.2), -22.0, 28.0, 11.5, 15.0, (14.0, 3.4, -22.0), "O4_O5_CrtHill"),
        # Zone 3: O6 Pequi Orchard (North-center)
        ("3", (2.0, 18.0, 7.2), 0.0, 28.0, 10.5, 14.0, (2.0, 2.4, -28.0), "O6_PequiOrchard"),
        # Zone 4: O8 School 2011 (West)
        ("4", (-16.0, 8.0, 6.8), 18.0, 28.0, 11.0, 15.0, (-12.0, 2.2, -18.0), "O8_School2011"),
        # Zone 5: O10 Bus Stop (North Exit)
        ("5", (0.0, 33.5, 7.2), 0.0, 26.0, 10.5, 14.0, (0.0, 2.5, -44.0), "O10_BusStop"),
    )
    for cname, cloc_b, cyaw, cpitch, cdist, crad, look_at_e, zone_label in camera_specs:
        c_obj = vn_refs.add_camera(
            cname,
            location=cloc_b,
            yaw_deg=cyaw,
            pitch_deg=cpitch,
            distance=cdist,
            radius=crad,
            look_at=look_at_e,
            props={"zone": zone_label, "era": "origens"},
            collection=collection,
            engine_coords=False,
        )
        refs["cameras"].append(c_obj)

    # --- 3. All 20 Collectible Signals (`refSignal01..20` + `refSignal1..20` + visual tokens) ---
    # 17 visible along main routes (O1->O2->O4->O5->O6->O8->O10) + 3 hidden (`hidden=True`) at O7 secret!
    signal_specs: tuple[tuple[int, tuple[float, float, float], str, bool], ...] = (
        # O1 -> O2 -> O3 (3 signals)
        (1, (0.9, 1.8, 0.75), "O1_to_O2", False),
        (2, (3.2, 5.0, 0.85), "O2_porch", False),
        (3, (-3.4, 1.0, 0.75), "O1_to_O3", False),
        # O4 Termite Mound Jump Arc (3 signals: refSignal4..6)
        (4, (10.9, 11.6, 1.65), "O4_jump_arc_1", False),
        (5, (12.3, 14.0, 2.25), "O4_jump_arc_2", False),
        (6, (13.6, 16.3, 2.85), "O4_jump_arc_3", False),
        # O5 CRT Desk Climb (3 signals: refSignal7..9)
        (7, (12.35, 19.95, 3.65), "O5_crt_chair", False),
        (8, (13.82, 20.98, 4.55), "O5_crt_keyboard", False),
        (9, (14.00, 21.60, 4.95), "O5_crt_power", False),
        # O6 Pequi Orchard (3 signals: refSignal10..12)
        (10, (7.0, 25.5, 2.85), "O5_to_O6_bridge", False),
        (11, (2.0, 28.8, 2.45), "O6_orchard_center", False),
        (12, (-3.8, 29.5, 3.15), "O6_ramp_apex", False),
        # O8 School Rooftop Climb (3 signals: refSignal13..15)
        (13, (-14.6, 15.55, 2.05), "O8_school_step", False),
        (14, (-13.95, 17.20, 3.00), "O8_school_awning", False),
        (15, (-12.0, 19.65, 5.15), "O8_school_ridge", False),
        # O9 -> O10 North Exit (2 signals: refSignal16..17)
        (16, (-1.0, 36.5, 2.45), "O9_seriema_path", False),
        (17, (0.0, 42.2, 2.55), "O10_bus_stop", False),
        # O7 Secret Hollow Termite Mound (3 hidden signals: refSignal18..20, hidden=True)
        (18, (-14.0, 32.0, 2.25), "O7_secret_1", True),
        (19, (-14.6, 32.5, 2.25), "O7_secret_2", True),
        (20, (-13.4, 32.5, 2.45), "O7_secret_3", True),
    )

    sig_col = vn_scene.ensure_collection("OrigensSignals")
    for idx, sloc, sbeat, is_hidden in signal_specs:
        sprops = {
            "index": idx,
            "signalId": f"origens_sig_{idx:02d}",
            "beat": sbeat,
            "hidden": bool(is_hidden),
            "rare": bool(idx == 20),
        }
        ref_padded = vn_refs.add_signal(
            f"{idx:02d}",
            location=sloc,
            props=sprops,
            collection=collection,
        )
        refs["signals"].append(ref_padded)
        if idx < 10:
            vn_refs.add_signal(
                f"{idx}",
                location=sloc,
                props=sprops,
                collection=collection,
            )

    # Include one base signal token visual mesh (`OrigensSignalBaseVisual`) for instancing (`§5.3`)
    sig_base = platform_kit.make_signal_token(
        name="OrigensSignalBaseVisual",
        location=(0.9, 1.8, 0.35),
        collection=sig_col,
    )
    vn_scene.link_object(sig_base, collection)

    # --- 4. Zone Bounding & Frustum (`refZoneBounding`, `refZoneFrustum`) ---
    z_bound = vn_refs.add_zone_bounding(
        "",
        location=(0.0, 18.0, 0.0),
        radius=45.0,
        props={"era": "origens", "islandSizeM": [70.0, 55.0]},
        collection=collection,
    )
    z_frustum = vn_refs.add_ref(
        "refZoneFrustum",
        location=(0.0, 18.0, 0.0),
        scale=(70.0, 55.0, 20.0),
        props={"era": "origens", "width": 70.0, "depth": 55.0, "height": 20.0},
        collection=collection,
    )
    refs["zones"].extend([z_bound, z_frustum])

    return refs


# ------------------------------------------------------------------ Build Scene


def build_origens_blockout(
    mode: str = "blockout",
    spline_json_out: Path = DEFAULT_SPLINE_JSON_OUT,
) -> dict[str, Any]:
    """Assemble the complete Era 1 'Origens' blockout scene (O1–O11 + A Linha + refs + physics toys)."""
    vn_scene.reset_scene("OrigensBlockout")
    col = vn_scene.ensure_collection("Origens")

    stats: dict[str, Any] = {
        "mode": mode,
        "colliders": {"cuboid": 0, "tube": 0, "ball": 0, "hull": 0, "trimesh": 0},
        "dynamic_toys": 0,
    }

    build_diorama_terrain_and_water(col, stats)
    build_beats_o1_o2_o3(col, stats)
    build_beats_o4_o5(col, stats)
    build_beats_o6_o7(col, stats)
    build_beats_o8_o9_o10(col, stats)
    line_info = build_beat_o11_line(col, spline_json_out=spline_json_out)
    refs_info = build_refs_nav_cameras_signals_zones(col)

    # Support manual artist overrides in `game/blender/manual/origens.blend`
    vn_manual.apply_manual_overrides("origens", preserve_transform=True)

    stats["lineLengthM"] = line_info["length"]
    stats["splineJsonPath"] = line_info["spline_json_path"]
    stats["navCount"] = len(refs_info["nav"])
    stats["cameraCount"] = len(refs_info["cameras"])
    stats["signalCount"] = len(refs_info["signals"])
    return stats


# ------------------------------------------------------------------ Verify & Export


def verify_origens_glb(glb_path: Path, stats: dict[str, Any]) -> dict[str, Any]:
    """Verify the exported GLB contains all required O1–O11 refs, landmarks, colliders, and dynamic toys."""
    info = vn_export.inspect_glb(str(glb_path))
    gltf = info["gltf"]
    nodes = gltf.get("nodes", [])
    names = [n.get("name", "") for n in nodes]
    name_set = set(names)

    required_refs = [
        "refRespawnOrigens",
        "refRespawn",
        "refMilestone1994",
        "refHouse1994",
        "refMilestone2005",
        "refMilestone2011",
        "refMilestoneContact",
        "refPipeContact",
        "refEndDotIsland",
        "refEndDotSphere",
        "refSecretTermite",
        "refBusStopOrigens",
        "refZoneBounding",
        "refZoneFrustum",
        *[f"refSeriema{i}" for i in range(1, 5)],
        *[f"refLinePoint{i:02d}" for i in range(1, 17)],
        *[f"refNav{i:02d}" for i in range(1, 13)],
        *[f"refCamera{i}" for i in range(1, 6)],
        *[f"refSignal{i:02d}" for i in range(1, 21)],
    ]
    missing_refs = [r for r in required_refs if r not in name_set]
    if missing_refs:
        raise AssertionError(f"Missing required refs in GLB: {missing_refs}")

    required_meshes = [
        "OrigensLineRibbon",
        "OrigensEndDotSphere",
        "OrigensCapelo",
        "screen",
    ]
    missing_meshes = [m for m in required_meshes if m not in name_set]
    if missing_meshes:
        raise AssertionError(f"Missing required landmark meshes in GLB: {missing_meshes}")

    collider_counts = {"cuboid": 0, "tube": 0, "ball": 0, "hull": 0, "trimesh": 0}
    for n in names:
        ln = n.lower()
        for k in collider_counts:
            if ln.startswith(k):
                collider_counts[k] += 1

    dynamic_nodes = [
        n.get("name")
        for n in nodes
        if "physicaldynamic" in n.get("name", "").lower()
        and float(n.get("extras", {}).get("mass", 0.0)) > 0.0
    ]
    if len(dynamic_nodes) < 20:
        raise AssertionError(
            f"Expected >= 20 dynamic physics toys with mass > 0, found {len(dynamic_nodes)}"
        )

    with open(glb_path, "rb") as fh:
        sha16 = hashlib.sha256(fh.read()).hexdigest()[:16]

    report = {
        "filepath": str(glb_path),
        "bytes": info["bytes"],
        "sha256_16": sha16,
        "nodes": info["nodes"],
        "meshes": info["meshes"],
        "triangles": info["triangles"],
        "materials": [m.get("name") for m in gltf.get("materials", [])],
        "colliders": collider_counts,
        "dynamicToysCount": len(dynamic_nodes),
        "lineLengthM": stats["lineLengthM"],
        "splineJsonPath": stats["splineJsonPath"],
    }
    print("ORIGENS_BLOCKOUT_OK", json.dumps(report, indent=2))
    return report


# ------------------------------------------------------------------ Final Assembly (T2.14a / T2.14b / T2.14c)


INTERACTIVE_LANDMARK_MESHES = frozenset(
    {
        "OrigensHouseBody",
        "OrigensHousePorch",
        "OrigensHouseRoof",
        "OrigensIpeBloom",
        "screen",
        "OrigensCrtPowerButton",
        "OrigensCapelo",
        "OrigensEndDotSphere",
        "OrigensSignalBaseVisual",
    }
)

FOLIAGE_STATIC_PREFIXES = (
    "OrigensSecretBuriti",
    "OrigensPequizeiro",
    "OrigensIpeTrunk",
    "OrigensCerradoFlowers",
    "OrigensCerradoGrass",
)


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type)
    crc = zlib.crc32(data, crc) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def _encode_rgba_png(rgba_u8: np.ndarray) -> bytes:
    """Encode a `(height, width, 4)` uint8 array as a lossless 8-bit RGBA PNG."""
    arr = np.asarray(rgba_u8, dtype=np.uint8)
    if arr.ndim != 3 or arr.shape[2] != 4:
        raise ValueError(f"Expected (H, W, 4) uint8 array for RGBA PNG, got {arr.shape}")

    height, width, _ = arr.shape
    row_bytes = width * 4
    stride = row_bytes + 1

    raw_none = bytearray(stride * height)
    raw_up = bytearray(stride * height)
    flat_rows = arr.reshape(height, row_bytes)

    for y in range(height):
        off = y * stride
        row_b = flat_rows[y].tobytes()
        raw_none[off] = 0
        raw_none[off + 1 : off + stride] = row_b

        raw_up[off] = 2
        if y == 0:
            raw_up[off + 1 : off + stride] = row_b
        else:
            diff = (flat_rows[y].astype(np.int16) - flat_rows[y - 1].astype(np.int16)) & 0xFF
            raw_up[off + 1 : off + stride] = diff.astype(np.uint8).tobytes()

    comp_none = zlib.compress(bytes(raw_none), level=9)
    comp_up = zlib.compress(bytes(raw_up), level=9)
    idat_payload = comp_up if len(comp_up) <= len(comp_none) else comp_none

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        signature
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", idat_payload)
        + _png_chunk(b"IEND", b"")
    )


def _classify_swatch_uv(u: float, v: float, swatch_uvs: dict[str, tuple[float, float]]) -> str:
    """Return closest swatch name for a Blender `(u, v)` coordinate."""
    best_name = "other"
    best_d2 = 1e9
    for name, (su, sv) in swatch_uvs.items():
        d2 = (u - su) ** 2 + (v - sv) ** 2
        if d2 < best_d2:
            best_d2 = d2
            best_name = name
    return best_name


def bake_terrain_data_mask(
    terrain_obj: bpy.types.Object,
    water_obj: bpy.types.Object,
    bounds: tuple[float, float, float, float],
    resolution: int = 512,
    out_png_path: Path | None = None,
) -> dict[str, Any]:
    """Generate `origens_terrain.png` (lossless RGBA: R=laterite, G=grass, B=water, A=height)."""
    res = max(64, int(resolution))
    min_x, max_x, min_z, max_z = (float(b) for b in bounds)
    span_x = max(max_x - min_x, 1e-4)
    span_z = max(max_z - min_z, 1e-4)

    swatch_uvs = {
        "laterite": vn_palette.get_swatch_uv("laterite", gltf=False),
        "lateriteDark": vn_palette.get_swatch_uv("lateriteDark", gltf=False),
        "dryGrass": vn_palette.get_swatch_uv("dryGrass", gltf=False),
        "cerradoGreen": vn_palette.get_swatch_uv("cerradoGreen", gltf=False),
        "waterOrigens": vn_palette.get_swatch_uv("waterOrigens", gltf=False),
        "dataTeal": vn_palette.get_swatch_uv("dataTeal", gltf=False),
        "paperWarm": vn_palette.get_swatch_uv("paperWarm", gltf=False),
        "paper": vn_palette.get_swatch_uv("paper", gltf=False),
        "brick": vn_palette.get_swatch_uv("brick", gltf=False),
        "rock": vn_palette.get_swatch_uv("rock", gltf=False),
    }

    bm_world = bmesh.new()
    face_classes: list[int] = []  # 0=other, 1=laterite, 2=grass, 3=water
    try:
        for obj, is_water_obj in ((terrain_obj, False), (water_obj, True)):
            bm_part = bmesh.new()
            bm_part.from_mesh(obj.data)
            bm_part.transform(obj.matrix_world)
            uv_layer = bm_part.loops.layers.uv.active

            # Tag faces before triangulate using a custom int layer
            tag_layer = bm_part.faces.layers.int.new("mask_cls")
            for face in bm_part.faces:
                cls_id = 0
                if uv_layer is not None and len(face.loops) > 0:
                    uv = face.loops[0][uv_layer].uv
                    sw = _classify_swatch_uv(float(uv.x), float(uv.y), swatch_uvs)
                    if sw in ("waterOrigens", "dataTeal"):
                        cls_id = 3
                    elif sw in ("laterite", "lateriteDark", "paperWarm"):
                        cls_id = 1
                    elif sw in ("dryGrass", "cerradoGreen"):
                        cls_id = 2
                elif is_water_obj:
                    cls_id = 3
                face[tag_layer] = cls_id

            bmesh.ops.triangulate(bm_part, faces=bm_part.faces)
            vert_map = [bm_world.verts.new(v.co) for v in bm_part.verts]
            for face in bm_part.faces:
                try:
                    new_f = bm_world.faces.new([vert_map[v.index] for v in face.verts])
                    face_classes.append(face[tag_layer])
                    _ = new_f
                except ValueError:
                    pass
            bm_part.free()

        bm_world.normal_update()
        bvh = BVHTree.FromBMesh(bm_world)
    finally:
        bm_world.free()

    # Sample A Linha spline in Blender XY so the trail under the ribbon gets painted in R (laterite)
    ctrl_vecs = [Vector(tuple(float(c) for c in pt)) for pt in LINE_CONTROL_POINTS_BLENDER]
    spline_pts, _ = vn_shapes._sample_spline_uniform(ctrl_vecs, step=0.25)
    spline_xy = np.array([(p.x, p.y) for p in spline_pts], dtype=np.float32)

    rgba = np.zeros((res, res, 4), dtype=np.uint8)
    down = Vector((0.0, 0.0, -1.0))
    min_h, max_h = -0.6, 2.6
    inv_h_span = 1.0 / (max_h - min_h)

    for iz in range(res):
        v = (iz + 0.5) / res
        world_z = min_z + v * span_z
        bl_y = -world_z
        for ix in range(res):
            u = (ix + 0.5) / res
            world_x = min_x + u * span_x
            bl_x = world_x

            hit_loc, _hit_norm, hit_idx, _hit_dist = bvh.ray_cast(
                Vector((bl_x, bl_y, 6.0)), down, 12.0
            )
            if hit_loc is None or hit_idx is None:
                continue

            cls_id = face_classes[hit_idx] if hit_idx < len(face_classes) else 0
            h_norm = max(0.0, min(1.0, (float(hit_loc.z) - min_h) * inv_h_span))
            h_u8 = int(round(h_norm * 255.0))

            if cls_id == 3:
                rgba[iz, ix] = (0, 0, 255, h_u8)
            elif cls_id == 1:
                rgba[iz, ix] = (255, 0, 0, h_u8)
            elif cls_id == 2:
                rgba[iz, ix] = (0, 255, 0, h_u8)
            else:
                rgba[iz, ix] = (0, 0, 0, h_u8)

    # Paint A Linha trail (1.1 m half-width) onto non-water terrain pixels in R (laterite)
    xs = min_x + ((np.arange(res, dtype=np.float32) + 0.5) / res) * span_x
    zs = min_z + ((np.arange(res, dtype=np.float32) + 0.5) / res) * span_z
    grid_x, grid_z = np.meshgrid(xs, zs)
    grid_bl_y = -grid_z
    non_water = (rgba[:, :, 3] > 0) & (rgba[:, :, 2] == 0)
    trail_r2 = 1.10 ** 2
    for sx, sy in spline_xy[::2]:
        d2 = (grid_x - sx) ** 2 + (grid_bl_y - sy) ** 2
        mask = non_water & (d2 <= trail_r2)
        rgba[mask, 0] = 255
        rgba[mask, 1] = 0

    png_bytes = _encode_rgba_png(rgba)
    if out_png_path is not None:
        out_png_path.parent.mkdir(parents=True, exist_ok=True)
        out_png_path.write_bytes(png_bytes)

    return {
        "resolution": res,
        "bytes": len(png_bytes),
        "path": str(out_png_path) if out_png_path else None,
        "bounds": [min_x, max_x, min_z, max_z],
    }


def _is_collider_obj(obj: bpy.types.Object) -> bool:
    return obj.name.lower().startswith(vn_collide.COLLIDER_PREFIXES)


def _is_dynamic_or_kinematic_ancestor(obj: bpy.types.Object) -> bool:
    cur: bpy.types.Object | None = obj
    while cur is not None:
        ln = cur.name.lower()
        if "physicaldynamic" in ln or "physicalkinematic" in ln:
            return True
        cur = cur.parent
    return False


def _merge_objects_into_static_mesh(
    name: str,
    objs: list[bpy.types.Object],
    collection: bpy.types.Collection,
) -> bpy.types.Object | None:
    """Unparent, apply world transforms, and join `objs` into a single static mesh `name`."""
    meshes = [o for o in objs if o is not None and o.type == "MESH" and o.data is not None]
    if not meshes:
        return None

    view_layer = bpy.context.view_layer
    for obj in meshes:
        mw = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = mw
        if obj.hide_select:
            obj.hide_select = False
    view_layer.update()

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    if len(meshes) > 1:
        bpy.ops.object.join()

    merged = view_layer.objects.active
    merged.name = name
    if merged.data is not None:
        merged.data.name = name
        pal_mat = vn_palette.ensure_palette_material()
        merged.data.materials.clear()
        merged.data.materials.append(pal_mat)
        for poly in merged.data.polygons:
            poly.material_index = 0

    for col in list(merged.users_collection):
        col.objects.unlink(merged)
    collection.objects.link(merged)
    return merged


def _collect_subtree(root: bpy.types.Object, out: list[bpy.types.Object]) -> None:
    if root not in out:
        out.append(root)
    for child in root.children:
        _collect_subtree(child, out)


def assemble_and_export_final(
    out_dir: Path,
    stats: dict[str, Any],
) -> dict[str, Any]:
    """T2.14a–c: Merge static visuals into <= 6 meshes, bake AO + terrain/shadow PNGs, and split-export 4 GLBs."""
    out_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    bpy.context.view_layer.update()

    all_objs = [
        o
        for o in scene.objects
        if not any(c.name.startswith("_Preview") for c in o.users_collection)
    ]

    # 1. Compute shared engine XZ bounds across static terrain/water/landmarks before merging
    terrain_obj = bpy.data.objects.get("OrigensTerrainVisual")
    water_obj = bpy.data.objects.get("OrigensRioTocantinsWater")
    if terrain_obj is None or water_obj is None:
        raise RuntimeError("Missing OrigensTerrainVisual or OrigensRioTocantinsWater for terrain bake")

    # Classify scene objects
    ref_objs: list[bpy.types.Object] = []
    dynamic_roots: list[bpy.types.Object] = []
    fixed_physical_roots: list[bpy.types.Object] = []
    interactive_objs: list[bpy.types.Object] = []
    static_visuals: list[bpy.types.Object] = []

    for obj in all_objs:
        ln = obj.name.lower()
        if obj.name.startswith("ref"):
            ref_objs.append(obj)
            continue
        if obj.parent is None and ("physicaldynamic" in ln or "physicalkinematic" in ln):
            dynamic_roots.append(obj)
            continue
        if obj.parent is None and "physicalfixed" in ln:
            fixed_physical_roots.append(obj)
            continue

    for obj in all_objs:
        if obj.type != "MESH" or obj.data is None:
            continue
        if _is_collider_obj(obj) or _is_dynamic_or_kinematic_ancestor(obj):
            continue
        if obj.name in INTERACTIVE_LANDMARK_MESHES:
            interactive_objs.append(obj)
            continue
        static_visuals.append(obj)

    # Compute bounds from static visuals (matches final merged bounds)
    b_min_x, b_max_x, b_min_z, b_max_z, _, _ = vn_bake_shadow.compute_engine_xz_bounds(
        static_visuals, padding=2.0
    )
    shared_bounds = (b_min_x, b_max_x, b_min_z, b_max_z)

    # 2. T2.14b (part 1): Bake terrain height & RGBA data mask BEFORE merging terrain
    terrain_png_path = out_dir / "origens_terrain.png"
    terrain_mask_info = bake_terrain_data_mask(
        terrain_obj=terrain_obj,
        water_obj=water_obj,
        bounds=shared_bounds,
        resolution=512,
        out_png_path=terrain_png_path,
    )

    # 3. Unparent interactive landmark meshes preserving world transforms so they export cleanly in origensObjects.glb
    for obj in interactive_objs:
        mw = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = mw
    bpy.context.view_layer.update()

    # 4. T2.14a: Merge static visuals into <= 6 meshes
    visual_col = vn_scene.ensure_collection("OrigensVisualMerged")
    groups: dict[str, list[bpy.types.Object]] = {
        "OrigensPaperBorders": [],
        "OrigensWaterBase": [],
        "OrigensLineRibbon": [],
        "OrigensFoliageStatic": [],
        "OrigensOpaqueStatic": [],
    }
    for obj in static_visuals:
        if obj.name == "OrigensPaperBorders":
            groups["OrigensPaperBorders"].append(obj)
        elif obj.name == "OrigensRioTocantinsWater":
            groups["OrigensWaterBase"].append(obj)
        elif obj.name == "OrigensLineRibbon":
            groups["OrigensLineRibbon"].append(obj)
        elif obj.name.startswith(FOLIAGE_STATIC_PREFIXES):
            groups["OrigensFoliageStatic"].append(obj)
        else:
            groups["OrigensOpaqueStatic"].append(obj)

    merged_static_objs: list[bpy.types.Object] = []
    for gname, gobjs in groups.items():
        merged = _merge_objects_into_static_mesh(gname, gobjs, visual_col)
        if merged is not None:
            merged_static_objs.append(merged)

    if len(merged_static_objs) > 6:
        raise AssertionError(f"Expected <= 6 merged static meshes, got {len(merged_static_objs)}")

    # 5. T2.14a: Bake vertex AO (COLOR_0) on merged static meshes
    # Subdivide only large opaque terrain/architecture faces (min_area=4.0, max_cuts=2)
    # so contact creases are captured without blowing up the mobile triangle/byte budget.
    opaque_obj = next((o for o in merged_static_objs if o.name == "OrigensOpaqueStatic"), None)
    if opaque_obj is not None:
        vn_bake_ao.subdivide_large_faces(opaque_obj, min_area=8.0, max_cuts=2)
    ao_summary = vn_bake_ao.bake_vertex_ao(
        merged_static_objs,
        distance=0.6,
        samples=64,
        subdivide_area=0.0,
    )

    # 6. T2.14b (part 2): Bake top-down Q1 shadow map (1024x1024 R8 PNG + JSON)
    shadow_png_path = out_dir / "origens_shadow.png"
    shadow_meta_path = out_dir / "origens_shadow.json"
    shadow_info = vn_bake_shadow.bake_topdown_shadow(
        objects=merged_static_objs,
        resolution=1024,
        bounds=shared_bounds,
        out_png_path=str(shadow_png_path),
        out_meta_path=str(shadow_meta_path),
    )

    # 7. T2.14c: Split-export 4 GLBs
    # 7a. origensVisual.glb (export_vertex_color="ACTIVE" ensures COLOR_0 AO is written)
    vis_glb = out_dir / "origensVisual.glb"
    vn_export.export_glb(
        str(vis_glb),
        objects=merged_static_objs,
        export_vertex_color="ACTIVE",
    )

    # 7b. origensPhysical.glb (only *PhysicalFixed roots + their collider children)
    phys_export_objs: list[bpy.types.Object] = []
    for root in fixed_physical_roots:
        phys_export_objs.append(root)
        for child in root.children:
            if _is_collider_obj(child):
                phys_export_objs.append(child)
    phys_glb = out_dir / "origensPhysical.glb"
    vn_export.export_glb(str(phys_glb), objects=phys_export_objs)

    # 7c. origensObjects.glb (dynamic physicals + interactive landmark meshes)
    obj_export_objs: list[bpy.types.Object] = []
    for root in dynamic_roots:
        _collect_subtree(root, obj_export_objs)
    for io_obj in interactive_objs:
        if io_obj not in obj_export_objs:
            obj_export_objs.append(io_obj)
    objs_glb = out_dir / "origensObjects.glb"
    vn_export.export_glb(str(objs_glb), objects=obj_export_objs)

    # 7d. origensReferences.glb (all ref* empties)
    refs_glb = out_dir / "origensReferences.glb"
    vn_export.export_glb(str(refs_glb), objects=ref_objs)

    # 8. Inspect & verify all 4 GLBs
    vis_info = vn_export.inspect_glb(str(vis_glb))
    phys_info = vn_export.inspect_glb(str(phys_glb))
    objs_info = vn_export.inspect_glb(str(objs_glb))
    refs_info = vn_export.inspect_glb(str(refs_glb))

    if vis_info["meshes"] > 6:
        raise AssertionError(f"origensVisual.glb has {vis_info['meshes']} meshes (must be <= 6)")
    has_color0 = any(
        "COLOR_0" in prim.get("attributes", {})
        for mesh in vis_info["gltf"].get("meshes", [])
        for prim in mesh.get("primitives", [])
    )
    if not has_color0:
        raise AssertionError("origensVisual.glb is missing COLOR_0 vertex AO attribute")

    all_nodes = []
    for inf in (vis_info, phys_info, objs_info, refs_info):
        all_nodes.extend(inf["gltf"].get("nodes", []))
    all_names = {n.get("name", "") for n in all_nodes}

    required_refs = [
        "refRespawnOrigens",
        "refRespawn",
        "refMilestone1994",
        "refHouse1994",
        "refMilestone2005",
        "refMilestone2011",
        "refMilestoneContact",
        "refPipeContact",
        "refEndDotIsland",
        "refEndDotSphere",
        "refSecretTermite",
        "refBusStopOrigens",
        "refZoneBounding",
        "refZoneFrustum",
        *[f"refSeriema{i}" for i in range(1, 5)],
        *[f"refLinePoint{i:02d}" for i in range(1, 17)],
        *[f"refNav{i:02d}" for i in range(1, 13)],
        *[f"refCamera{i}" for i in range(1, 6)],
        *[f"refSignal{i:02d}" for i in range(1, 21)],
    ]
    missing_refs = [r for r in required_refs if r not in all_names]
    if missing_refs:
        raise AssertionError(f"Missing required refs across split GLBs: {missing_refs}")

    required_meshes = ["OrigensLineRibbon", "OrigensEndDotSphere", "OrigensCapelo", "screen"]
    missing_meshes = [m for m in required_meshes if m not in all_names]
    if missing_meshes:
        raise AssertionError(f"Missing required landmark meshes across split GLBs: {missing_meshes}")

    report = {
        "mode": "final",
        "outDir": str(out_dir),
        "visualMeshesCount": vis_info["meshes"],
        "visualMeshNames": [o.name for o in merged_static_objs],
        "ao": {
            "objects": ao_summary["objects"],
            "min": ao_summary["min_ao"],
            "mean": ao_summary["mean_ao"],
            "max": ao_summary["max_ao"],
        },
        "terrainMask": terrain_mask_info,
        "shadowMask": {
            "resolution": shadow_info["resolution"],
            "bytes": shadow_info["bytes"],
            "path": shadow_info["png_path"],
            "metaPath": shadow_info["meta_path"],
        },
        "glbs": {
            "origensVisual": {"bytes": vis_info["bytes"], "meshes": vis_info["meshes"], "triangles": vis_info["triangles"]},
            "origensPhysical": {"bytes": phys_info["bytes"], "nodes": phys_info["nodes"]},
            "origensObjects": {"bytes": objs_info["bytes"], "meshes": objs_info["meshes"], "nodes": objs_info["nodes"]},
            "origensReferences": {"bytes": refs_info["bytes"], "nodes": refs_info["nodes"]},
        },
        "lineLengthM": stats["lineLengthM"],
        "splineJsonPath": stats["splineJsonPath"],
    }
    print("ORIGENS_FINAL_OK", json.dumps(report, indent=2))
    return report


def main() -> None:
    cli = parse_cli_args()
    stats = build_origens_blockout(
        mode=cli["mode"],
        spline_json_out=cli["out_spline"],
    )

    if cli["mode"] == "final":
        assemble_and_export_final(cli["out_dir"], stats)
    else:
        vn_export.export_glb(str(cli["out_glb"]))
        verify_origens_glb(cli["out_glb"], stats)

    if cli["render_preview"]:
        vn_scene.render_3views(
            str(cli["out_preview"]),
            target=(0.0, 18.0, 1.5),
            radius=36.0,
            size=640,
            engine_coords=False,
        )


if __name__ == "__main__":
    main()
