"""Era 2 'UNICAMP' (2012-2016) procedural layout, landmarks, and final export pipeline.

Builds the 70 x 55 m UNICAMP campus diorama island covering:
  1. Portão do Campus + Marco 2012-01 (`refMilestone2012_01`, ~6 m from `refRespawnUnicamp`)
     + copper contact shortcut pipe (`refPipeContact`)
  2. Rua das ONGs + Marco 2012-07 (`refMilestone2012_07`)
  3. Floresta de Nanotubos de Titânio + Marco 2012-12 (`refMilestone2012_12`)
  4. Sala da Empresa Júnior MTE + Marco 2014-07 (`refMilestone2014_07`)
  5. Segredo (`refSecretLab` + Stamp-opened `UnicampSecretLabHatch`)
  6. A Linha (`UnicampLineRibbon` + `refLinePoint01..16` + `unicamp_line_spline.json`)
  7. Connected nav graph (`refNav01..12`), 4 cameras (`refCamera1..4`), 20 signals (`refSignal01..20`),
     and zone bounds (`refZoneBounding`, `refZoneFrustum`).

Run:
    blender.exe -b -P game/blender/eras/unicamp.py -- --mode final
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys
import zlib
from pathlib import Path
from typing import Any, Iterable

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
BLENDER_DIR = HERE.parent
if str(BLENDER_DIR) not in sys.path:
    sys.path.insert(0, str(BLENDER_DIR))

from kits import platform_kit, unicamp_kit, unicamp_landmarks  # noqa: E402
from lib import (  # noqa: E402
    vn_bake_ao,
    vn_bake_shadow,
    vn_collide,
    vn_export,
    vn_palette,
    vn_refs,
    vn_scene,
    vn_shapes,
)

OUT_DIR = BLENDER_DIR / "out"
PREVIEWS_DIR = OUT_DIR / "previews"
DEFAULT_FINAL_OUT_DIR = OUT_DIR / "eras" / "unicamp"
DEFAULT_FINAL_PREVIEW_OUT = PREVIEWS_DIR / "t3_unicamp_final.png"


def parse_cli_args() -> dict[str, Any]:
    """Parse arguments after `--` on the Blender command line."""
    mode = "final"
    out_dir: Path | None = None
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
            elif arg == "--out-dir" and i + 1 < len(args):
                out_dir = Path(os.path.abspath(args[i + 1]))
                i += 2
            elif arg == "--preview-out" and i + 1 < len(args):
                out_preview = Path(os.path.abspath(args[i + 1]))
                i += 2
            elif arg == "--no-preview":
                render_preview = False
                i += 1
            else:
                i += 1

    resolved_out_dir = out_dir or DEFAULT_FINAL_OUT_DIR
    return {
        "mode": mode,
        "out_dir": resolved_out_dir,
        "out_spline": resolved_out_dir / "unicamp_line_spline.json",
        "out_preview": out_preview or DEFAULT_FINAL_PREVIEW_OUT,
        "render_preview": render_preview,
    }


# ------------------------------------------------------------------ BMesh helpers


def _assign_uv(bm: bmesh.types.BMesh, faces: Iterable[bmesh.types.BMFace], swatch: str) -> None:
    uv_layer = bm.loops.layers.uv.verify()
    u, v = vn_palette.get_swatch_uv(swatch, gltf=False)
    for face in faces:
        for loop in face.loops:
            loop[uv_layer].uv = (u, v)


def _add_box(
    bm: bmesh.types.BMesh,
    size: tuple[float, float, float],
    center: tuple[float, float, float],
    swatch: str,
    top_swatch: str | None = None,
    side_swatch: str | None = None,
) -> list[bmesh.types.BMFace]:
    ret = bmesh.ops.create_cube(bm, size=1.0)
    verts = list(ret["verts"])
    vset = set(verts)
    mat = Matrix.Diagonal((float(size[0]), float(size[1]), float(size[2]), 1.0))
    bmesh.ops.transform(bm, matrix=mat, verts=verts)
    bmesh.ops.translate(bm, vec=Vector(tuple(float(c) for c in center)), verts=verts)
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    for f in faces:
        f.normal_update()
        if top_swatch and f.normal.z > 0.55:
            _assign_uv(bm, [f], top_swatch)
        elif side_swatch and abs(f.normal.z) <= 0.55:
            _assign_uv(bm, [f], side_swatch)
        else:
            _assign_uv(bm, [f], swatch)
    return faces


def _finalize_bm(
    bm: bmesh.types.BMesh,
    name: str,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(float(c) for c in location)
    vn_palette.ensure_palette_material()
    mat = bpy.data.materials.get("palette")
    if mat is not None:
        obj.data.materials.append(mat)
    if collection is not None:
        vn_scene.link_object(obj, collection)
    return obj


# ------------------------------------------------------------------ 1. Terrain, Fountain, Borders


def build_terrain_and_water(collection: bpy.types.Collection) -> dict[str, Any]:
    """Build stepped UNICAMP campus terrain, concrete walkways, reflecting pool, and paper borders."""
    bm = bmesh.new()

    # Main campus lawn base (48 x 58 m, top at Z=0.0)
    _add_box(bm, (48.0, 58.0, 1.4), (0.0, 19.0, -0.7), "campusGrassDeep", top_swatch="campusGrass")

    # Stepped concrete walkways & plazas:
    # Entry promenade (Z=0.0, slight 0.02 m proud concrete surface for crisp path mask)
    _add_box(bm, (7.0, 16.0, 0.12), (0.0, 2.5, -0.05), "concreteShadow", top_swatch="concrete")
    # Pipe contact side pad
    _add_box(bm, (4.2, 4.2, 0.12), (-5.5, 1.5, -0.05), "concreteShadow", top_swatch="concrete")
    # East Rua das ONGs terrace (Z=0.4)
    _add_box(bm, (13.0, 15.0, 0.44), (13.0, 14.0, 0.18), "concreteShadow", top_swatch="concrete")
    # Ramp/steps up to Rua das ONGs
    _add_box(bm, (3.2, 3.0, 0.24), (5.2, 11.5, 0.10), "concreteShadow", top_swatch="concrete")
    # Central plaza & nanotube grove pad (Z=0.4)
    _add_box(bm, (15.0, 16.0, 0.44), (3.5, 25.5, 0.18), "concreteShadow", top_swatch="concrete")
    # West MTE Empresa Júnior terrace (Z=0.8)
    _add_box(bm, (12.0, 14.0, 0.84), (-12.0, 20.5, 0.38), "concreteShadow", top_swatch="concrete")
    # Steps from central plaza to MTE terrace
    _add_box(bm, (3.0, 3.2, 0.62), (-4.8, 19.0, 0.29), "concreteShadow", top_swatch="concrete")
    # Secret lab alcove pad (Z=0.4)
    _add_box(bm, (6.5, 7.5, 0.44), (-13.5, 34.0, 0.18), "concreteShadow", top_swatch="campusGrass")
    # North campus exit plaza (Z=1.2)
    _add_box(bm, (10.0, 10.0, 1.24), (0.0, 41.0, 0.58), "concreteShadow", top_swatch="concrete")
    # Steps from nanotube terrace to north exit
    _add_box(bm, (4.2, 3.5, 0.85), (0.0, 34.5, 0.40), "concreteShadow", top_swatch="concrete")

    terrain_obj = _finalize_bm(bm, "UnicampTerrainVisual", (0.0, 0.0, 0.0), collection)

    # Terrain trimesh collider
    phys_root = bpy.data.objects.new("UnicampTerrainPhysicalFixed", None)
    vn_scene.link_object(phys_root, collection)
    vn_collide.add_trimesh("trimeshUnicampTerrain", terrain_obj, parent=phys_root, collection=collection)

    # Central Campus Reflecting Pool / Fountain Water
    wbm = bmesh.new()
    _add_box(wbm, (7.2, 5.2, 0.18), (0.0, 16.5, -0.06), "waterOrigens")
    water_obj = _finalize_bm(wbm, "UnicampFountainWater", (0.0, 0.0, 0.0), collection)

    # Fountain concrete rim
    fbm = bmesh.new()
    _add_box(fbm, (7.8, 0.4, 0.32), (0.0, 19.2, 0.12), "concrete")
    _add_box(fbm, (7.8, 0.4, 0.32), (0.0, 13.8, 0.12), "concrete")
    _add_box(fbm, (0.4, 5.8, 0.32), (-3.7, 16.5, 0.12), "concrete")
    _add_box(fbm, (0.4, 5.8, 0.32), (3.7, 16.5, 0.12), "concrete")
    _finalize_bm(fbm, "UnicampFountainRim", (0.0, 0.0, 0.0), collection)

    # Paper editorial diorama borders around the island
    pbm = bmesh.new()
    _add_box(pbm, (48.6, 0.45, 0.55), (0.0, -10.1, -0.15), "paper", side_swatch="ink")
    _add_box(pbm, (48.6, 0.45, 0.55), (0.0, 48.1, -0.15), "paper", side_swatch="ink")
    _add_box(pbm, (0.45, 58.6, 0.55), (-24.1, 19.0, -0.15), "paper", side_swatch="ink")
    _add_box(pbm, (0.45, 58.6, 0.55), (24.1, 19.0, -0.15), "paper", side_swatch="ink")
    borders_obj = _finalize_bm(pbm, "UnicampPaperBorders", (0.0, 0.0, 0.0), collection)

    return {"terrain": terrain_obj, "water": water_obj, "borders": borders_obj}


# ------------------------------------------------------------------ 2. A Linha (16 points)


LINE_CONTROL_POINTS_BLENDER: tuple[tuple[float, float, float], ...] = (
    (0.0, 0.6, 0.04),
    (0.0, 3.6, 0.04),
    (1.4, 6.2, 0.04),
    (3.8, 9.2, 0.14),
    (7.6, 12.0, 0.44),
    (10.2, 14.5, 0.44),
    (9.2, 18.5, 0.44),
    (6.0, 21.8, 0.44),
    (3.5, 25.0, 0.44),
    (5.2, 28.8, 0.44),
    (1.2, 29.8, 0.44),
    (-4.5, 24.5, 0.65),
    (-8.8, 21.0, 0.84),
    (-6.5, 28.5, 0.65),
    (-1.8, 35.5, 0.95),
    (0.0, 41.5, 1.24),
)


def build_line_spline(collection: bpy.types.Collection, spline_json_out: Path) -> dict[str, Any]:
    """Build UnicampLineRibbon + refLinePoint01..16 + unicamp_line_spline.json."""
    pts_b = [tuple(float(c) for c in pt) for pt in LINE_CONTROL_POINTS_BLENDER]
    ctrl_vecs = [Vector(pt) for pt in pts_b]
    sampled_vecs, arc_s = vn_shapes._sample_spline_uniform(ctrl_vecs, step=0.25)
    total_arc_len = round(float(arc_s[-1]), 3)

    ribbon = vn_shapes.make_ribbon(
        name="UnicampLineRibbon",
        points=pts_b,
        width=0.35,
        thickness=0.04,
        step=0.25,
        elevation=0.02,
        bevel_width=0.008,
        collection=collection,
        engine_coords=False,
    )
    vn_palette.assign(ribbon, "signal")
    vn_scene.set_custom_props(
        ribbon,
        {"era": "unicamp", "isLineRibbon": True, "length": total_arc_len, "pointCount": len(pts_b)},
    )

    control_points_json: list[dict[str, Any]] = []
    for idx, pt_b in enumerate(pts_b, start=1):
        pt_e = vn_scene.to_engine(*pt_b)
        props = {"index": idx, "era": "unicamp"}
        vn_refs.add_ref(f"refLinePoint{idx:02d}", location=pt_b, props=props, collection=collection)
        if idx < 10:
            vn_refs.add_line_point(idx, location=pt_b, props=props, collection=collection, engine_coords=False)
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

    payload = {
        "era": "unicamp",
        "name": "UnicampLineRibbon",
        "width": 0.35,
        "thickness": 0.04,
        "step": 0.25,
        "length": total_arc_len,
        "controlPoints": control_points_json,
        "sampledPoints": sampled_json,
    }
    spline_json_out.parent.mkdir(parents=True, exist_ok=True)
    spline_json_out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {"ribbon": ribbon, "length": total_arc_len, "spline_json_path": str(spline_json_out)}


# ------------------------------------------------------------------ 3. Landmarks, Milestones, Props, Refs


def build_unicamp_scene(spline_json_out: Path) -> dict[str, Any]:
    """Construct the complete UNICAMP Blender scene."""
    vn_scene.reset_scene("UnicampScene")
    vn_palette.ensure_palette_material()

    col_env = vn_scene.ensure_collection("UnicampEnvironment")
    col_land = vn_scene.ensure_collection("UnicampLandmarks")
    col_obj = vn_scene.ensure_collection("UnicampObjects")
    col_refs = vn_scene.ensure_collection("UnicampReferences")

    # 1. Terrain, fountain, borders
    build_terrain_and_water(col_env)

    # 2. Respawn + Contact Pipe
    vn_refs.add_respawn(
        "Unicamp",
        location=(0.0, 0.0, 0.0),
        yaw_deg=0.0,
        props={"era": "unicamp"},
        collection=col_refs,
    )
    pipe = platform_kit.make_copper_pipe(
        name="UnicampContactPipe",
        location=(-5.5, 1.5, 0.0),
        collection=col_land,
    )
    _ = pipe
    pipe_phys = bpy.data.objects.new("UnicampContactPipePhysicalFixed", None)
    pipe_phys.location = (-5.5, 1.5, 0.0)
    vn_scene.link_object(pipe_phys, col_land)
    vn_collide.add_cylinder("cylinderContactPipe", radius=0.62, height=1.24, location=(0.0, 0.0, 0.62), parent=pipe_phys, collection=col_land)
    vn_refs.add_ref(
        "refPipeContact",
        location=(-5.5, 1.5, 1.25),
        props={"era": "unicamp", "target": "contato"},
        collection=col_refs,
    )

    # 3. Landmark 1: Portão do Campus + Marco 2012-01
    unicamp_landmarks.build_campus_gate(location=(0.0, 4.2, 0.0), collection=col_land)
    platform_kit.make_milestone_block("UnicampMilestone2012_01", location=(1.8, 6.0, 0.0), collection=col_obj)
    m1_phys = bpy.data.objects.new("UnicampMilestone2012_01PhysicalFixed", None)
    m1_phys.location = (1.8, 6.0, 0.0)
    vn_scene.link_object(m1_phys, col_obj)
    vn_collide.add_cuboid("cuboidMilestone2012_01", size=(0.98, 0.98, 1.0), location=(0.0, 0.0, 0.5), parent=m1_phys, collection=col_obj)
    vn_refs.add_milestone("2012_01", (1.8, 6.0, 0.5), "e-2012-01", {"era": "unicamp"}, collection=col_refs)

    # 4. Landmark 2: Rua das ONGs + Marco 2012-07
    ong_specs = (
        ("UnicampOngHouse01", (14.2, 9.8, 0.4), 0.0, "paper", "brick"),
        ("UnicampOngHouse02", (14.5, 13.2, 0.4), 0.05, "paperWarm", "brickDark"),
        ("UnicampOngHouse03", (14.2, 16.6, 0.4), -0.04, "paper", "copper"),
        ("UnicampOngHouse04", (11.2, 18.8, 0.4), -math.pi * 0.5, "paperWarm", "brick"),
    )
    for hname, hloc, hrot, hwall, hroof in ong_specs:
        unicamp_landmarks.build_ong_house(
            name=hname,
            location=hloc,
            rotation_z=hrot,
            wall_swatch=hwall,
            roof_swatch=hroof,
            collection=col_land,
        )
    platform_kit.make_milestone_block("UnicampMilestone2012_07", location=(9.5, 14.0, 0.4), collection=col_obj)
    m2_phys = bpy.data.objects.new("UnicampMilestone2012_07PhysicalFixed", None)
    m2_phys.location = (9.5, 14.0, 0.4)
    vn_scene.link_object(m2_phys, col_obj)
    vn_collide.add_cuboid("cuboidMilestone2012_07", size=(0.98, 0.98, 1.0), location=(0.0, 0.0, 0.5), parent=m2_phys, collection=col_obj)
    vn_refs.add_milestone("2012_07", (9.5, 14.0, 0.9), "e-2012-07", {"era": "unicamp"}, collection=col_refs)

    # 5. Landmark 3: Floresta de Nanotubos de Titânio + Marco 2012-12
    unicamp_landmarks.build_nanotube_forest(collection=col_land)
    platform_kit.make_milestone_block("UnicampMilestone2012_12", location=(5.5, 29.0, 0.4), collection=col_obj)
    m3_phys = bpy.data.objects.new("UnicampMilestone2012_12PhysicalFixed", None)
    m3_phys.location = (5.5, 29.0, 0.4)
    vn_scene.link_object(m3_phys, col_obj)
    vn_collide.add_cuboid("cuboidMilestone2012_12", size=(0.98, 0.98, 1.0), location=(0.0, 0.0, 0.5), parent=m3_phys, collection=col_obj)
    vn_refs.add_milestone("2012_12", (5.5, 29.0, 0.9), "e-2012-12", {"era": "unicamp"}, collection=col_refs)

    # 6. Landmark 4: Sala da Empresa Júnior MTE + Marco 2014-07
    unicamp_landmarks.build_mte_meeting_room(location=(-12.0, 20.5, 0.8), collection=col_land)
    platform_kit.make_milestone_block("UnicampMilestone2014_07", location=(-12.0, 20.5, 2.0), collection=col_obj)
    m4_phys = bpy.data.objects.new("UnicampMilestone2014_07PhysicalFixed", None)
    m4_phys.location = (-12.0, 20.5, 2.0)
    vn_scene.link_object(m4_phys, col_obj)
    vn_collide.add_cuboid("cuboidMilestone2014_07", size=(0.98, 0.98, 1.0), location=(0.0, 0.0, 0.5), parent=m4_phys, collection=col_obj)
    vn_refs.add_milestone("2014_07", (-12.0, 20.5, 2.5), "e-2014-07", {"era": "unicamp"}, collection=col_refs)

    # 7. Landmark 5: Segredo (Laboratório no Subsolo)
    secret_res = unicamp_landmarks.build_secret_lab(location=(-13.5, 34.0, 0.4), collection=col_land)
    vn_scene.link_object(secret_res["ref"], col_refs)

    # 8. Campus foliage, lamps, benches
    tree_specs = (
        ("UnicampTree01", (-9.5, 3.0, 0.0), 3.8, "campusGrass"),
        ("UnicampTree02", (8.5, 3.5, 0.0), 3.5, "campusGrassDeep"),
        ("UnicampTree03", (-16.5, 10.5, 0.0), 4.0, "ipeGold"),
        ("UnicampTree04", (18.5, 22.0, 0.0), 3.9, "campusGrass"),
        ("UnicampTree05", (-18.5, 30.5, 0.0), 4.1, "campusGrassDeep"),
        ("UnicampTree06", (-8.5, 34.5, 0.4), 3.4, "campusGrass"),
        ("UnicampTree07", (9.5, 36.5, 0.0), 3.9, "ipeGold"),
        ("UnicampTree08", (-6.5, 42.0, 0.0), 3.6, "campusGrass"),
        ("UnicampTree09", (7.0, 42.0, 0.0), 3.7, "campusGrassDeep"),
    )
    for tname, tloc, th, tc in tree_specs:
        unicamp_kit.make_campus_tree(tname, tloc, height=th, crown_swatch=tc, collection=col_env)

    for idx, sloc in enumerate(
        ((-3.5, 9.0, 0.0), (5.5, 8.0, 0.0), (-6.5, 15.0, 0.0), (7.0, 19.0, 0.4), (-7.0, 29.0, 0.0)),
        start=1,
    ):
        unicamp_kit.make_campus_shrub(f"UnicampShrub{idx:02d}", sloc, scale=1.1, collection=col_env)

    for idx, lloc in enumerate(
        ((-2.6, 1.2, 0.0), (2.6, 8.2, 0.0), (8.0, 12.2, 0.4), (-6.8, 17.5, 0.0), (2.5, 38.0, 1.2)),
        start=1,
    ):
        unicamp_kit.make_campus_lamp(f"UnicampLamp{idx:02d}", lloc, collection=col_env)

    unicamp_kit.make_campus_bench("UnicampBench01", (-2.2, 11.8, 0.0), rotation_z=0.0, collection=col_env)
    unicamp_kit.make_campus_bench("UnicampBench02", (2.2, 11.8, 0.0), rotation_z=0.0, collection=col_env)

    # 9. Dynamic physics campus books/crates
    book_specs = (
        ("UnicampBookCrate01", (-2.4, 2.2, 0.0), "brick"),
        ("UnicampBookCrate02", (-2.3, 2.2, 0.38), "dataTeal"),
        ("UnicampBookCrate03", (-1.8, 2.6, 0.0), "copper"),
        ("UnicampBookCrate04", (-9.8, 17.6, 0.8), "brick"),
        ("UnicampBookCrate05", (8.2, 15.4, 0.4), "dataTeal"),
    )
    for bname, bloc, bcol in book_specs:
        unicamp_kit.make_book_crate_physical(bname, bloc, cover_swatch=bcol, collection=col_obj)

    # 10. A Linha spline + refLinePoint01..16
    line_res = build_line_spline(col_refs, spline_json_out)

    # 11. Navigation graph (refNav01..12)
    nav_specs = (
        (1, "nav01_spawn", "spawn", (0.0, 0.0, 0.0), ["refNav02", "refNav03", "refNav04"], "spawn"),
        (2, "nav02_milestone2012_01", "milestone2012_01", (1.8, 5.2, 0.0), ["refNav01", "refNav04"], "e-2012-01"),
        (3, "nav03_pipeContact", "pipeContact", (-5.5, 1.5, 0.0), ["refNav01", "refNav09"], "contato"),
        (4, "nav04_crossroads", "hub_south", (0.5, 10.5, 0.0), ["refNav01", "refNav02", "refNav05", "refNav09"], ""),
        (5, "nav05_ongsApproach", "ongs_approach", (6.5, 12.5, 0.4), ["refNav04", "refNav06"], ""),
        (6, "nav06_milestone2012_07", "milestone2012_07", (9.5, 14.0, 0.4), ["refNav05", "refNav07"], "e-2012-07"),
        (7, "nav07_nanotubeBase", "nanotube_base", (4.5, 22.0, 0.4), ["refNav06", "refNav08", "refNav10"], ""),
        (8, "nav08_milestone2012_12", "milestone2012_12", (5.5, 29.0, 0.4), ["refNav07", "refNav12"], "e-2012-12"),
        (9, "nav09_mteApproach", "mte_approach", (-6.0, 18.5, 0.4), ["refNav03", "refNav04", "refNav10"], ""),
        (10, "nav10_milestone2014_07", "milestone2014_07", (-10.5, 20.5, 0.8), ["refNav07", "refNav09", "refNav11"], "e-2014-07"),
        (11, "nav11_secretApproach", "secret_approach", (-11.0, 31.0, 0.4), ["refNav10", "refNav12"], ""),
        (12, "nav12_northExit", "northExit", (0.0, 41.5, 1.2), ["refNav08", "refNav11"], "northExit"),
    )
    for idx, nid, role, loc, neigh, tm in nav_specs:
        nprops = {"index": idx, "nodeId": nid, "role": role, "neighbors": ",".join(neigh), "links": neigh, "targetMilestone": tm}
        vn_refs.add_nav_node(f"{idx:02d}", location=loc, links=neigh, props=nprops, collection=col_refs)
        if idx < 10:
            vn_refs.add_nav_node(f"{idx}", location=loc, links=neigh, props=nprops, collection=col_refs)

    # 12. 4 Camera zones (`refCamera1..4`)
    camera_specs = (
        ("1", (0.0, -7.5, 6.2), 0.0, 28.0, 11.0, 15.0, (0.0, 1.0, -4.5), "U1_Gate_Spawn"),
        ("2", (15.5, 6.5, 7.6), -24.0, 28.0, 11.5, 15.0, (12.0, 1.6, -14.0), "U2_RuaDasONGs"),
        ("3", (4.0, 18.0, 8.2), 0.0, 30.0, 12.0, 15.0, (3.5, 2.2, -26.5), "U3_Nanotubes"),
        ("4", (-16.0, 13.0, 7.8), 22.0, 28.0, 12.0, 16.0, (-12.0, 2.2, -21.0), "U4_MTE_North"),
    )
    for cname, cloc, cyaw, cpitch, cdist, crad, look_at_e, zlabel in camera_specs:
        vn_refs.add_camera(
            cname,
            location=cloc,
            yaw_deg=cyaw,
            pitch_deg=cpitch,
            distance=cdist,
            radius=crad,
            look_at=look_at_e,
            props={"zone": zlabel, "era": "unicamp"},
            collection=col_refs,
            engine_coords=False,
        )

    # 13. 20 Signals (`refSignal01..20`, 17 visible + 3 hidden at refSecretLab)
    signal_specs = (
        (1, (0.0, 2.2, 0.75), "U1_gate_entry", False),
        (2, (1.8, 7.4, 0.75), "U1_post_gate", False),
        (3, (-3.6, 1.5, 0.75), "U1_to_pipe", False),
        (4, (6.0, 11.5, 1.05), "U2_ongs_ramp", False),
        (5, (11.8, 11.5, 1.15), "U2_ongs_1", False),
        (6, (11.8, 15.2, 1.15), "U2_ongs_2", False),
        (7, (9.5, 18.0, 1.15), "U2_ongs_3", False),
        (8, (1.8, 23.6, 2.25), "U3_nanotube_key1", False),
        (9, (3.3, 24.4, 2.45), "U3_nanotube_key2", False),
        (10, (4.8, 25.2, 2.65), "U3_nanotube_key3", False),
        (11, (3.9, 27.2, 3.00), "U3_nanotube_key5", False),
        (12, (6.4, 30.8, 3.55), "U3_nanotube_crown", False),
        (13, (-10.9, 18.95, 2.05), "U4_mte_chair", False),
        (14, (-12.0, 20.5, 2.75), "U4_mte_table", False),
        (15, (-13.1, 22.05, 2.05), "U4_mte_chair_n", False),
        (16, (-1.8, 35.5, 1.75), "U_north_path", False),
        (17, (0.0, 42.2, 2.05), "U_north_exit", False),
        (18, (-14.1, 34.4, 1.15), "U5_secret_1", True),
        (19, (-13.5, 34.8, 1.15), "U5_secret_2", True),
        (20, (-12.9, 34.4, 1.35), "U5_secret_3", True),
    )
    for idx, sloc, sbeat, is_hidden in signal_specs:
        sprops = {"index": idx, "signalId": f"unicamp_sig_{idx:02d}", "beat": sbeat, "hidden": bool(is_hidden)}
        vn_refs.add_signal(f"{idx:02d}", location=sloc, props=sprops, collection=col_refs)
        if idx < 10:
            vn_refs.add_signal(f"{idx}", location=sloc, props=sprops, collection=col_refs)

    # Signal base visual mesh for instancing
    platform_kit.make_signal_token(name="UnicampSignalBaseVisual", location=(0.0, 2.2, 0.35), collection=col_obj)

    # 14. Zone Bounding & Frustum
    vn_refs.add_zone_bounding(
        "",
        location=(0.0, 19.0, 0.0),
        radius=45.0,
        props={"era": "unicamp", "islandSizeM": [70.0, 55.0]},
        collection=col_refs,
    )
    vn_refs.add_ref(
        "refZoneFrustum",
        location=(0.0, 19.0, 0.0),
        scale=(70.0, 55.0, 20.0),
        props={"era": "unicamp", "width": 70.0, "depth": 55.0, "height": 20.0},
        collection=col_refs,
    )

    return {"lineLengthM": line_res["length"], "splineJsonPath": line_res["spline_json_path"]}


# ------------------------------------------------------------------ 4. Terrain Mask & Final Split Export


INTERACTIVE_OBJECT_MESHES = frozenset(
    {
        "UnicampMilestone2012_01",
        "UnicampMilestone2012_07",
        "UnicampMilestone2012_12",
        "UnicampMilestone2014_07",
        "UnicampSecretLabHatch",
        "UnicampSignalBaseVisual",
    }
)

FOLIAGE_PREFIXES = ("UnicampTree", "UnicampShrub")


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def _encode_rgba_png(rgba_u8: np.ndarray) -> bytes:
    h, w, c = rgba_u8.shape
    assert c == 4
    raw_rows = b"".join(b"\x00" + rgba_u8[y].tobytes() for y in range(h))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw_rows, level=9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", idat)
        + _png_chunk(b"IEND", b"")
    )


def _classify_swatch_uv(u: float, v: float, swatch_uvs: dict[str, tuple[float, float]]) -> str:
    best_name = ""
    best_d2 = 1e9
    for sname, (su, sv) in swatch_uvs.items():
        d2 = (u - su) ** 2 + (v - sv) ** 2
        if d2 < best_d2:
            best_d2 = d2
            best_name = sname
    return best_name if best_d2 < (0.04 ** 2) else ""


def bake_terrain_data_mask(
    terrain_obj: bpy.types.Object,
    water_obj: bpy.types.Object,
    bounds: tuple[float, float, float, float],
    resolution: int = 512,
    out_png_path: Path | None = None,
) -> dict[str, Any]:
    """Generate `unicamp_terrain.png` (512x512 RGBA: R=concrete path, G=campus grass, B=fountain/water, A=height)."""
    res = max(64, int(resolution))
    min_x, max_x, min_z, max_z = (float(b) for b in bounds)
    span_x = max(max_x - min_x, 1e-4)
    span_z = max(max_z - min_z, 1e-4)

    swatch_uvs = {
        "concrete": vn_palette.get_swatch_uv("concrete", gltf=False),
        "concreteShadow": vn_palette.get_swatch_uv("concreteShadow", gltf=False),
        "campusGrass": vn_palette.get_swatch_uv("campusGrass", gltf=False),
        "campusGrassDeep": vn_palette.get_swatch_uv("campusGrassDeep", gltf=False),
        "waterOrigens": vn_palette.get_swatch_uv("waterOrigens", gltf=False),
        "dataTeal": vn_palette.get_swatch_uv("dataTeal", gltf=False),
    }

    bm_world = bmesh.new()
    face_classes: list[int] = []  # 1=concrete, 2=grass, 3=water
    try:
        for obj, is_water in ((terrain_obj, False), (water_obj, True)):
            bm_part = bmesh.new()
            bm_part.from_mesh(obj.data)
            bm_part.transform(obj.matrix_world)
            uv_layer = bm_part.loops.layers.uv.active
            tag_layer = bm_part.faces.layers.int.new("mask_cls")
            for face in bm_part.faces:
                cls_id = 0
                if is_water:
                    cls_id = 3
                elif uv_layer is not None and len(face.loops) > 0:
                    uv = face.loops[0][uv_layer].uv
                    sw = _classify_swatch_uv(float(uv.x), float(uv.y), swatch_uvs)
                    if sw in ("waterOrigens", "dataTeal"):
                        cls_id = 3
                    elif sw in ("concrete", "concreteShadow"):
                        cls_id = 1
                    elif sw in ("campusGrass", "campusGrassDeep"):
                        cls_id = 2
                face[tag_layer] = cls_id
            bmesh.ops.triangulate(bm_part, faces=bm_part.faces)
            vert_map = [bm_world.verts.new(v.co) for v in bm_part.verts]
            for face in bm_part.faces:
                try:
                    bm_world.faces.new([vert_map[v.index] for v in face.verts])
                    face_classes.append(face[tag_layer])
                except ValueError:
                    pass
            bm_part.free()
        bm_world.normal_update()
        bvh = BVHTree.FromBMesh(bm_world)
    finally:
        bm_world.free()

    ctrl_vecs = [Vector(tuple(float(c) for c in pt)) for pt in LINE_CONTROL_POINTS_BLENDER]
    spline_pts, _ = vn_shapes._sample_spline_uniform(ctrl_vecs, step=0.25)
    spline_xy = np.array([(p.x, p.y) for p in spline_pts], dtype=np.float32)

    rgba = np.zeros((res, res, 4), dtype=np.uint8)
    down = Vector((0.0, 0.0, -1.0))
    min_h, max_h = -0.6, 2.2
    inv_h_span = 1.0 / (max_h - min_h)

    for iz in range(res):
        world_z = min_z + ((iz + 0.5) / res) * span_z
        bl_y = -world_z
        for ix in range(res):
            world_x = min_x + ((ix + 0.5) / res) * span_x
            hit_loc, _norm, hit_idx, _dist = bvh.ray_cast(Vector((world_x, bl_y, 6.0)), down, 12.0)
            if hit_loc is None or hit_idx is None:
                continue
            cls_id = face_classes[hit_idx] if hit_idx < len(face_classes) else 0
            h_u8 = int(round(max(0.0, min(1.0, (float(hit_loc.z) - min_h) * inv_h_span)) * 255.0))
            if cls_id == 3:
                rgba[iz, ix] = (0, 0, 255, h_u8)
            elif cls_id == 1:
                rgba[iz, ix] = (255, 0, 0, h_u8)
            elif cls_id == 2:
                rgba[iz, ix] = (0, 255, 0, h_u8)
            else:
                rgba[iz, ix] = (0, 0, 0, h_u8)

    # Paint A Linha trail onto non-water pixels in R (concrete path)
    xs = min_x + ((np.arange(res, dtype=np.float32) + 0.5) / res) * span_x
    zs = min_z + ((np.arange(res, dtype=np.float32) + 0.5) / res) * span_z
    grid_x, grid_z = np.meshgrid(xs, zs)
    grid_bl_y = -grid_z
    non_water = (rgba[:, :, 3] > 0) & (rgba[:, :, 2] == 0)
    trail_r2 = 1.05 ** 2
    for sx, sy in spline_xy[::2]:
        d2 = (grid_x - sx) ** 2 + (grid_bl_y - sy) ** 2
        mask = non_water & (d2 <= trail_r2)
        rgba[mask, 0] = 255
        rgba[mask, 1] = 0

    png_bytes = _encode_rgba_png(rgba)
    if out_png_path is not None:
        out_png_path.parent.mkdir(parents=True, exist_ok=True)
        out_png_path.write_bytes(png_bytes)

    return {"resolution": res, "bytes": len(png_bytes), "path": str(out_png_path) if out_png_path else None}


def _is_collider_obj(obj: bpy.types.Object) -> bool:
    return obj.name.startswith(("cuboid", "trimesh", "hull", "cylinder", "tube", "ball"))


def _is_dynamic_or_kinematic_ancestor(obj: bpy.types.Object) -> bool:
    cur = obj.parent
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
    if not objs:
        return None
    bm = bmesh.new()
    for obj in objs:
        if obj.type != "MESH" or obj.data is None or len(obj.data.polygons) == 0:
            continue
        tmp = bmesh.new()
        tmp.from_mesh(obj.data)
        tmp.transform(obj.matrix_world)
        uv_src = tmp.loops.layers.uv.active
        uv_dst = bm.loops.layers.uv.verify()
        vert_map = [bm.verts.new(v.co) for v in tmp.verts]
        for face in tmp.faces:
            try:
                nf = bm.faces.new([vert_map[v.index] for v in face.verts])
                if uv_src is not None:
                    for sl, dl in zip(face.loops, nf.loops):
                        dl[uv_dst].uv = sl[uv_src].uv
            except ValueError:
                pass
        tmp.free()

    if len(bm.faces) == 0:
        bm.free()
        return None
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    out_obj = bpy.data.objects.new(name, mesh)
    vn_palette.ensure_palette_material()
    mat = bpy.data.materials.get("palette")
    if mat is not None:
        out_obj.data.materials.append(mat)
    vn_scene.link_object(out_obj, collection)
    return out_obj


def _collect_subtree(root: bpy.types.Object, out: list[bpy.types.Object]) -> None:
    if root not in out:
        out.append(root)
    for child in root.children:
        _collect_subtree(child, out)


def assemble_and_export_final(out_dir: Path, stats: dict[str, Any]) -> dict[str, Any]:
    """Merge static visuals into <= 6 meshes, bake AO + terrain/shadow PNGs, and split-export 4 GLBs."""
    out_dir.mkdir(parents=True, exist_ok=True)
    bpy.context.view_layer.update()

    all_objs = [
        o for o in bpy.context.scene.objects if not any(c.name.startswith("_Preview") for c in o.users_collection)
    ]
    terrain_obj = bpy.data.objects.get("UnicampTerrainVisual")
    water_obj = bpy.data.objects.get("UnicampFountainWater")
    if terrain_obj is None or water_obj is None:
        raise RuntimeError("Missing UnicampTerrainVisual or UnicampFountainWater")

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
        if obj.name in INTERACTIVE_OBJECT_MESHES:
            interactive_objs.append(obj)
            continue
        static_visuals.append(obj)

    b_min_x, b_max_x, b_min_z, b_max_z, _, _ = vn_bake_shadow.compute_engine_xz_bounds(static_visuals, padding=2.0)
    shared_bounds = (b_min_x, b_max_x, b_min_z, b_max_z)

    terrain_png_path = out_dir / "unicamp_terrain.png"
    terrain_info = bake_terrain_data_mask(terrain_obj, water_obj, shared_bounds, 512, terrain_png_path)

    for obj in interactive_objs:
        mw = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = mw
    bpy.context.view_layer.update()

    visual_col = vn_scene.ensure_collection("UnicampVisualMerged")
    groups: dict[str, list[bpy.types.Object]] = {
        "UnicampPaperBorders": [],
        "UnicampWaterBase": [],
        "UnicampLineRibbon": [],
        "UnicampFoliageStatic": [],
        "UnicampOpaqueStatic": [],
    }
    for obj in static_visuals:
        if obj.name == "UnicampPaperBorders":
            groups["UnicampPaperBorders"].append(obj)
        elif obj.name == "UnicampFountainWater":
            groups["UnicampWaterBase"].append(obj)
        elif obj.name == "UnicampLineRibbon":
            groups["UnicampLineRibbon"].append(obj)
        elif obj.name.startswith(FOLIAGE_PREFIXES):
            groups["UnicampFoliageStatic"].append(obj)
        else:
            groups["UnicampOpaqueStatic"].append(obj)

    merged_static_objs: list[bpy.types.Object] = []
    for gname, gobjs in groups.items():
        merged = _merge_objects_into_static_mesh(gname, gobjs, visual_col)
        if merged is not None:
            merged_static_objs.append(merged)

    if len(merged_static_objs) > 6:
        raise AssertionError(f"Expected <= 6 merged static meshes, got {len(merged_static_objs)}")

    opaque_obj = next((o for o in merged_static_objs if o.name == "UnicampOpaqueStatic"), None)
    if opaque_obj is not None:
        vn_bake_ao.subdivide_large_faces(opaque_obj, min_area=8.0, max_cuts=2)
    ao_summary = vn_bake_ao.bake_vertex_ao(merged_static_objs, distance=0.6, samples=64, subdivide_area=0.0)

    shadow_png_path = out_dir / "unicamp_shadow.png"
    shadow_meta_path = out_dir / "unicamp_shadow.json"
    shadow_info = vn_bake_shadow.bake_topdown_shadow(
        objects=merged_static_objs,
        resolution=1024,
        bounds=shared_bounds,
        out_png_path=str(shadow_png_path),
        out_meta_path=str(shadow_meta_path),
    )

    vis_glb = out_dir / "unicampVisual.glb"
    vn_export.export_glb(str(vis_glb), objects=merged_static_objs, export_vertex_color="ACTIVE")

    phys_export_objs: list[bpy.types.Object] = []
    for root in fixed_physical_roots:
        phys_export_objs.append(root)
        for child in root.children:
            if _is_collider_obj(child):
                phys_export_objs.append(child)
    phys_glb = out_dir / "unicampPhysical.glb"
    vn_export.export_glb(str(phys_glb), objects=phys_export_objs)

    obj_export_objs: list[bpy.types.Object] = []
    for root in dynamic_roots:
        _collect_subtree(root, obj_export_objs)
    for io_obj in interactive_objs:
        if io_obj not in obj_export_objs:
            obj_export_objs.append(io_obj)
    objs_glb = out_dir / "unicampObjects.glb"
    vn_export.export_glb(str(objs_glb), objects=obj_export_objs)

    refs_glb = out_dir / "unicampReferences.glb"
    vn_export.export_glb(str(refs_glb), objects=ref_objs)

    vis_info = vn_export.inspect_glb(str(vis_glb))
    phys_info = vn_export.inspect_glb(str(phys_glb))
    objs_info = vn_export.inspect_glb(str(objs_glb))
    refs_info = vn_export.inspect_glb(str(refs_glb))

    if vis_info["meshes"] > 6:
        raise AssertionError(f"unicampVisual.glb has {vis_info['meshes']} meshes (must be <= 6)")

    report = {
        "mode": "final",
        "outDir": str(out_dir),
        "visualMeshesCount": vis_info["meshes"],
        "visualMeshNames": [o.name for o in merged_static_objs],
        "ao": {"objects": ao_summary["objects"], "mean": ao_summary["mean_ao"]},
        "terrainMask": terrain_info,
        "shadowMask": {"bytes": shadow_info["bytes"], "resolution": shadow_info["resolution"]},
        "glbs": {
            "unicampVisual": {"bytes": vis_info["bytes"], "meshes": vis_info["meshes"], "triangles": vis_info["triangles"]},
            "unicampPhysical": {"bytes": phys_info["bytes"], "nodes": phys_info["nodes"]},
            "unicampObjects": {"bytes": objs_info["bytes"], "meshes": objs_info["meshes"], "nodes": objs_info["nodes"]},
            "unicampReferences": {"bytes": refs_info["bytes"], "nodes": refs_info["nodes"]},
        },
        "lineLengthM": stats["lineLengthM"],
    }
    print("UNICAMP_FINAL_OK", json.dumps(report, indent=2))
    return report


def main() -> None:
    cli = parse_cli_args()
    stats = build_unicamp_scene(spline_json_out=cli["out_spline"])
    assemble_and_export_final(cli["out_dir"], stats)
    if cli["render_preview"]:
        vn_scene.render_3views(
            str(cli["out_preview"]),
            target=(0.0, 19.0, 1.5),
            radius=36.0,
            size=640,
            engine_coords=False,
        )


if __name__ == "__main__":
    main()
