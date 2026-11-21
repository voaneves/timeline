"""Era 3 'Indústria' (2017–2019) procedural layout, landmarks, and final split-export.

Builds the 64 x 56 m diorama island for Era 3 'Indústria':
  1. Fábrica + Esteiras Móveis + Marco `2017-01` (`refMilestone2017_01`, reachable < 15 s)
     with kinematic conveyor belt platforms and 12 kickable generic domino bottles (mass=0.35).
  2. Píer do Dirigível de Papel + Marco `2018-07` (`refMilestone2018_07`)
     with stylized folded-paper airship (`IndustriaPaperAirship`) moored at `refAirshipDock`.
  3. Torre de Trainee + Marco `2019-01` (`refMilestone2019_01`)
     with stepped industrial catwalk & control console (`IndustriaTraineeConsole`).
  4. Segredo (`refSecretVault`) gear-vault chamber opened by Stamp (`IndustriaSecretVaultHatch`).
  5. Contact copper pipe (`refPipeContact`), continuous Line (`IndustriaLineRibbon` +
     `refLinePoint01..16` + `industria_line_spline.json`), `refNav01..12`, `refSignal01..20`,
     `refCamera1..4`, `refZoneBounding`, `refZoneFrustum`.

Run standalone:
    blender.exe -b -P game/blender/eras/industria.py -- --mode final
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
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
BLENDER_DIR = HERE.parent
if str(BLENDER_DIR) not in sys.path:
    sys.path.insert(0, str(BLENDER_DIR))

from kits import industria_kit, industria_landmarks, platform_kit  # noqa: E402
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
DEFAULT_GLB_OUT = OUT_DIR / "industria_blockout.glb"
DEFAULT_FINAL_OUT_DIR = OUT_DIR / "eras" / "industria"
DEFAULT_SPLINE_JSON_OUT = OUT_DIR / "industria_line_spline.json"
DEFAULT_PREVIEW_OUT = PREVIEWS_DIR / "t3_industria_blockout.png"
DEFAULT_FINAL_PREVIEW_OUT = PREVIEWS_DIR / "t3_industria_final.png"

LINE_CONTROL_POINTS_BLENDER: list[tuple[float, float, float]] = [
    (0.0, -3.5, 0.22),
    (0.0, 0.0, 0.22),
    (-4.0, 3.0, 0.22),
    (-9.5, 6.0, 0.22),
    (-12.0, 10.0, 0.22),
    (-6.0, 13.0, 0.22),
    (1.0, 14.5, 0.22),
    (8.0, 16.5, 0.22),
    (12.0, 21.5, 0.22),
    (13.5, 27.0, 0.22),
    (9.0, 29.0, 0.22),
    (2.5, 28.0, 0.22),
    (-10.0, 28.0, 0.22),
    (-2.0, 28.0, 3.05),
    (4.0, 18.0, 0.22),
    (8.0, 4.0, 0.22),
]

INTERACTIVE_LANDMARK_MESHES = {
    "IndustriaPaperAirship",
    "IndustriaSecretVaultHatch",
    "IndustriaTraineeConsole",
    "IndustriaPipeContact",
}


def parse_cli_args() -> dict[str, Any]:
    mode = "final"
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
        resolved_spline = out_spline or (resolved_out_dir / "industria_line_spline.json")
        resolved_preview = out_preview or DEFAULT_FINAL_PREVIEW_OUT
        resolved_out_glb = out_glb or (resolved_out_dir / "industriaVisual.glb")
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


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def _write_rgba_png(path: Path, rgba: np.ndarray) -> int:
    h, w, c = rgba.shape
    assert c == 4 and rgba.dtype == np.uint8
    raw_rows = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))
    compressed = zlib.compress(raw_rows, level=9)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", compressed)
        + _png_chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png_bytes)
    return len(png_bytes)


def _is_collider_obj(obj: bpy.types.Object) -> bool:
    return obj.name.lower().startswith(vn_collide.COLLIDER_PREFIXES)


def _is_dynamic_or_kinematic_ancestor(obj: bpy.types.Object) -> bool:
    cur: bpy.types.Object | None = obj
    while cur is not None:
        if "PhysicalDynamic" in cur.name or "PhysicalKinematic" in cur.name:
            return True
        cur = cur.parent
    return False


def _collect_subtree(root: bpy.types.Object, out: list[bpy.types.Object]) -> None:
    if root not in out:
        out.append(root)
    for child in root.children:
        _collect_subtree(child, out)


def _merge_objects_into_static_mesh(
    name: str,
    objs: list[bpy.types.Object],
    collection: bpy.types.Collection,
) -> bpy.types.Object | None:
    mesh_objs = [o for o in objs if o.type == "MESH" and o.data is not None]
    if not mesh_objs:
        return None

    bm = bmesh.new()
    try:
        uv_layer_dst = bm.loops.layers.uv.verify()
        for obj in mesh_objs:
            bm_part = bmesh.new()
            bm_part.from_mesh(obj.data)
            bm_part.transform(obj.matrix_world)
            uv_src = bm_part.loops.layers.uv.active
            vert_map = [bm.verts.new(v.co) for v in bm_part.verts]
            for f in bm_part.faces:
                try:
                    nf = bm.faces.new([vert_map[v.index] for v in f.verts])
                    if uv_src is not None:
                        for l_src, l_dst in zip(f.loops, nf.loops):
                            l_dst[uv_layer_dst].uv = l_src[uv_src].uv
                except ValueError:
                    pass
            bm_part.free()
        bm.normal_update()
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    merged_obj = bpy.data.objects.new(name, mesh)
    merged_obj.data.materials.append(vn_palette.ensure_palette_material())
    vn_scene.link_object(merged_obj, collection)
    return merged_obj


def _make_fixed_physical_root(name: str, collection: bpy.types.Collection) -> bpy.types.Object:
    obj = bpy.data.objects.new(f"{name}PhysicalFixed", None)
    vn_scene.link_object(obj, collection)
    return obj


# ------------------------------------------------------------------ Island Base & Canal


def _build_terrain_and_water(col: bpy.types.Collection) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    """Build concrete/brick industrial courtyard, canal water basin, and paper perimeter."""
    bm = bmesh.new()
    # Main industrial yard slab (X in [-28, 28], Y in [-8, 30], top at z=0.20)
    industria_kit._add_box(bm, (56.0, 38.0, 0.80), (0.0, 11.0, -0.20), "concreteShadow", top_swatch="concrete")
    # West factory apron pad (brick trim)
    industria_kit._add_box(bm, (22.0, 22.0, 0.24), (-14.0, 12.0, 0.12), "brickDark", top_swatch="concreteShadow")
    # East secret-vault courtyard pad
    industria_kit._add_box(bm, (12.0, 12.0, 0.24), (18.0, 8.0, 0.12), "steelDark", top_swatch="concreteShadow")
    # North-west Trainee Tower plaza
    industria_kit._add_box(bm, (18.0, 16.0, 0.24), (-4.0, 28.0, 0.12), "concreteShadow", top_swatch="concrete")

    terrain_obj = industria_kit._finalize_bm(bm, name="IndustriaTerrain", collection=col)

    # Canal water basin along north-east (Y in [26, 46], X in [4, 28])
    bm_w = bmesh.new()
    industria_kit._add_box(bm_w, (26.0, 20.0, 0.35), (16.0, 36.0, -0.35), "dataTeal")
    water_obj = industria_kit._finalize_bm(bm_w, name="IndustriaCanalWater", collection=col)

    # Paper-cut diorama border rim
    bm_p = bmesh.new()
    for size, center in (
        ((58.0, 1.2, 0.9), (0.0, -8.6, -0.15)),
        ((58.0, 1.2, 0.9), (0.0, 46.6, -0.15)),
        ((1.2, 56.4, 0.9), (-28.6, 19.0, -0.15)),
        ((1.2, 56.4, 0.9), (28.6, 19.0, -0.15)),
    ):
        industria_kit._add_box(bm_p, size, center, "paperWarm", top_swatch="paper")
    paper_obj = industria_kit._finalize_bm(bm_p, name="IndustriaPaperBorders", collection=col)

    # Fixed ground colliders
    ground_phys = _make_fixed_physical_root("IndustriaGround", col)
    vn_collide.add_cuboid("cuboidYard", (56.0, 38.0, 0.80), (0.0, 11.0, -0.20), parent=ground_phys, collection=col)
    vn_collide.add_cuboid("cuboidCanalBed", (26.0, 20.0, 0.40), (16.0, 36.0, -0.70), parent=ground_phys, collection=col)

    return terrain_obj, water_obj, paper_obj


# ------------------------------------------------------------------ A Linha


def _build_line_and_refs(
    col: bpy.types.Collection,
    ref_col: bpy.types.Collection,
    spline_json_out: Path,
) -> dict[str, Any]:
    ribbon_obj = vn_shapes.make_ribbon(
        name="IndustriaLineRibbon",
        points=LINE_CONTROL_POINTS_BLENDER,
        width=0.56,
        thickness=0.05,
        step=0.45,
        collection=col,
    )
    vn_palette.assign(ribbon_obj, "signal")

    ctrl_vecs = [Vector(p) for p in LINE_CONTROL_POINTS_BLENDER]
    samples, arc_lengths = vn_shapes._sample_spline_uniform(ctrl_vecs, step=0.25)
    total_len = float(arc_lengths[-1]) if arc_lengths else 0.0

    for idx, pt in enumerate(LINE_CONTROL_POINTS_BLENDER, start=1):
        vn_refs.add_ref(
            f"refLinePoint{idx:02d}",
            location=pt,
            props={"index": idx},
            collection=ref_col,
        )

    spline_data = {
        "era": "industria",
        "lengthMeters": round(total_len, 4),
        "controlPoints": [list(vn_scene.to_engine_vec(p)) for p in LINE_CONTROL_POINTS_BLENDER],
        "samples": [list(vn_scene.to_engine_vec((p.x, p.y, p.z))) for p in samples],
    }
    spline_json_out.parent.mkdir(parents=True, exist_ok=True)
    spline_json_out.write_text(json.dumps(spline_data, indent=2), encoding="utf-8")
    return {"ribbon": ribbon_obj, "lengthMeters": total_len, "splineJsonPath": str(spline_json_out)}


# ------------------------------------------------------------------ Terrain Data Mask


def bake_terrain_data_mask(
    terrain_obj: bpy.types.Object,
    water_obj: bpy.types.Object,
    bounds: tuple[float, float, float, float],
    resolution: int,
    out_png_path: Path,
) -> dict[str, Any]:
    """Generate `industria_terrain.png` (512x512 RGBA: R=trail, G=concrete/brick, B=water, A=height)."""
    res = max(64, int(resolution))
    min_x, max_x, min_z, max_z = (float(b) for b in bounds)
    span_x = max(max_x - min_x, 1e-4)
    span_z = max(max_z - min_z, 1e-4)

    bm_world = bmesh.new()
    face_is_water: list[bool] = []
    try:
        for obj, is_water in ((terrain_obj, False), (water_obj, True)):
            bm_part = bmesh.new()
            bm_part.from_mesh(obj.data)
            bm_part.transform(obj.matrix_world)
            bmesh.ops.triangulate(bm_part, faces=bm_part.faces)
            vert_map = [bm_world.verts.new(v.co) for v in bm_part.verts]
            for f in bm_part.faces:
                try:
                    bm_world.faces.new([vert_map[v.index] for v in f.verts])
                    face_is_water.append(is_water)
                except ValueError:
                    pass
            bm_part.free()
        bm_world.normal_update()
        bvh = BVHTree.FromBMesh(bm_world)
    finally:
        bm_world.free()

    ctrl_vecs = [Vector(p) for p in LINE_CONTROL_POINTS_BLENDER]
    spline_pts, _ = vn_shapes._sample_spline_uniform(ctrl_vecs, step=0.35)
    spline_xy = np.array([(p.x, p.y) for p in spline_pts], dtype=np.float32)

    rgba = np.zeros((res, res, 4), dtype=np.uint8)
    down = Vector((0.0, 0.0, -1.0))
    min_h, max_h = -0.6, 3.6

    for py in range(res):
        eng_z = min_z + ((py + 0.5) / res) * span_z
        bl_y = -eng_z
        for px in range(res):
            eng_x = min_x + ((px + 0.5) / res) * span_x
            bl_x = eng_x
            hit, _, face_idx, _ = bvh.ray_cast(Vector((bl_x, bl_y, 20.0)), down, 40.0)
            if hit is not None:
                is_w = face_is_water[face_idx] if 0 <= face_idx < len(face_is_water) else False
                h_norm = int(np.clip((hit.z - min_h) / (max_h - min_h), 0.0, 1.0) * 255.0)
                if is_w:
                    rgba[py, px] = (0, 0, 255, h_norm)
                else:
                    dists = np.hypot(spline_xy[:, 0] - bl_x, spline_xy[:, 1] - bl_y)
                    near_line = 255 if float(dists.min()) < 1.25 else 0
                    rgba[py, px] = (near_line, 255 - near_line, 0, h_norm)

    byte_count = _write_rgba_png(out_png_path, rgba)
    return {"resolution": res, "bytes": byte_count, "path": str(out_png_path)}


# ------------------------------------------------------------------ Scene Assembly


def build_industria_scene(spline_json_out: Path) -> dict[str, Any]:
    vn_scene.reset_scene("IndustriaScene")
    vn_palette.ensure_palette_material()

    static_col = vn_scene.ensure_collection("IndustriaStatic")
    dyn_col = vn_scene.ensure_collection("IndustriaDynamic")
    ref_col = vn_scene.ensure_collection("IndustriaReferences")

    terrain_obj, water_obj, paper_obj = _build_terrain_and_water(static_col)

    # 1. Factory Hall + Conveyors + Marco 2017-01
    factory_obj = industria_kit.make_factory_hall(
        name="IndustriaFactoryHall",
        location=(-16.0, 15.0, 0.24),
        collection=static_col,
    )
    factory_phys = _make_fixed_physical_root("IndustriaFactoryHall", static_col)
    vn_collide.add_cuboid("cuboidFactoryMain", (16.0, 10.0, 5.2), (-16.0, 15.0, 2.84), parent=factory_phys, collection=static_col)

    # Conveyor frames & kinematic belts
    industria_kit.make_conveyor_frame("IndustriaConveyorFrameA", length=9.0, location=(-6.0, 10.5, 0.20), collection=static_col)
    industria_kit.make_conveyor_frame("IndustriaConveyorFrameB", length=9.0, location=(2.0, 15.0, 0.20), collection=static_col)

    belt_a = industria_kit.make_conveyor_belt_platform(
        name="IndustriaConveyorBeltA",
        size=(2.8, 1.5, 0.22),
        start_blender=(-9.0, 10.5, 0.86),
        end_blender=(-3.0, 10.5, 0.86),
        speed=2.1,
        pause=0.35,
        collection=dyn_col,
    )
    belt_b = industria_kit.make_conveyor_belt_platform(
        name="IndustriaConveyorBeltB",
        size=(2.8, 1.5, 0.22),
        start_blender=(-1.0, 15.0, 0.86),
        end_blender=(5.0, 15.0, 0.86),
        speed=2.4,
        pause=0.35,
        collection=dyn_col,
    )

    # 12 generic kickable domino bottles (mass=0.35, zero brand logos)
    bottles: list[bpy.types.Object] = []
    bottle_styles = ("glass", "amber", "paper")
    for idx in range(12):
        bx = -13.5 + (idx % 6) * 0.75
        by = 6.5 + (idx // 6) * 1.15
        bottles.append(
            industria_kit.make_generic_bottle(
                name=f"IndustriaBottle{idx + 1:02d}",
                location=(bx, by, 0.24),
                style=bottle_styles[idx % 3],
                mass=0.35,
                collection=dyn_col,
            )
        )

    # Marco 2017-01 (reachable < 15 s from respawn)
    m_2017 = platform_kit.make_milestone_block("IndustriaMilestone2017_01", location=(-10.0, 6.0, 0.24), collection=dyn_col)
    vn_scene.set_custom_props(m_2017, {"entryId": "e-2017-01", "datetime": "2017-01"})

    # 2. Píer do Dirigível de Papel + Marco 2018-07
    pier_obj = industria_kit.make_pier_deck("IndustriaAirshipPier", size=(5.6, 13.0, 0.36), location=(13.5, 29.0, 0.05), collection=static_col)
    pier_phys = _make_fixed_physical_root("IndustriaAirshipPier", static_col)
    vn_collide.add_cuboid("cuboidPier", (5.6, 13.0, 0.36), (13.5, 29.0, 0.05), parent=pier_phys, collection=static_col)

    airship_obj = industria_landmarks.make_paper_airship(
        name="IndustriaPaperAirship",
        location=(15.5, 37.5, 1.20),
        rotation_euler=(0.0, 0.0, math.radians(-18.0)),
        collection=dyn_col,
    )
    m_2018 = platform_kit.make_milestone_block("IndustriaMilestone2018_07", location=(12.0, 22.0, 0.20), collection=dyn_col)
    vn_scene.set_custom_props(m_2018, {"entryId": "e-2018-07", "datetime": "2018-07"})

    # 3. Torre de Trainee + Marco 2019-01
    tower_obj, tower_colliders = industria_kit.make_catwalk_tower(
        name="IndustriaTraineeTower",
        location=(-2.0, 28.0, 0.24),
        collection=static_col,
    )
    tower_phys = _make_fixed_physical_root("IndustriaTraineeTower", static_col)
    for idx, (csize, cpos) in enumerate(tower_colliders):
        vn_collide.add_cuboid(
            f"cuboidTower{idx:02d}",
            csize,
            (-2.0 + cpos[0], 28.0 + cpos[1], 0.24 + cpos[2]),
            parent=tower_phys,
            collection=static_col,
        )

    console_obj = industria_landmarks.make_control_console(
        name="IndustriaTraineeConsole",
        location=(-1.0, 29.0, 3.24),
        collection=dyn_col,
    )
    m_2019 = platform_kit.make_milestone_block("IndustriaMilestone2019_01", location=(-3.2, 27.6, 3.24), collection=dyn_col)
    vn_scene.set_custom_props(m_2019, {"entryId": "e-2019-01", "datetime": "2019-01"})

    # 4. Segredo (Gear Vault)
    vault_chamber, vault_hatch = industria_landmarks.make_secret_gear_vault(
        name="IndustriaSecretVault",
        location=(18.0, 8.0, 0.24),
        collection=static_col,
    )
    # Move interactive hatch to dyn_col
    for c in list(vault_hatch.users_collection):
        c.objects.unlink(vault_hatch)
    dyn_col.objects.link(vault_hatch)

    gear1 = industria_kit.make_gear_wheel("IndustriaGearA", radius=0.95, teeth=12, swatch="copper", location=(17.2, 7.6, 0.65), collection=static_col)
    gear2 = industria_kit.make_gear_wheel("IndustriaGearB", radius=0.72, teeth=10, swatch="steel", location=(18.7, 8.4, 0.65), collection=static_col)
    gear_wall = industria_kit.make_gear_wheel("IndustriaFactoryGearAccent", radius=1.40, teeth=14, swatch="copper", location=(-8.1, 15.0, 3.2), rotation_euler=(0.0, math.radians(90.0), 0.0), collection=static_col)

    # 5. Contact Copper Pipe
    pipe_obj = platform_kit.make_copper_pipe("IndustriaPipeContact", location=(8.0, 4.0, 0.20), collection=dyn_col)

    # 6. A Linha + line points
    line_info = _build_line_and_refs(static_col, ref_col, spline_json_out)

    # 7. All References (`ref*`)
    vn_refs.add_respawn("refRespawnIndustria", location=(0.0, -2.5, 0.25), collection=ref_col)
    vn_refs.add_respawn("refRespawn", location=(0.0, -2.5, 0.25), collection=ref_col)
    vn_refs.add_milestone("refMilestone2017_01", entry_id="e-2017-01", location=(-10.0, 6.0, 0.24), collection=ref_col)
    vn_refs.add_milestone("refMilestone2018_07", entry_id="e-2018-07", location=(12.0, 22.0, 0.20), collection=ref_col)
    vn_refs.add_milestone("refMilestone2019_01", entry_id="e-2019-01", location=(-3.2, 27.6, 3.24), collection=ref_col)
    vn_refs.add_ref("refPipeContact", location=(8.0, 4.0, 0.20), props={"role": "contactPipe"}, collection=ref_col)
    vn_refs.add_ref("refAirshipDock", location=(15.5, 37.5, 1.20), props={"role": "airshipDock", "destination": "alemanha"}, collection=ref_col)
    vn_refs.add_ref("refSecretVault", location=(18.0, 8.0, 1.46), props={"role": "secretVault", "trigger": "stamp"}, collection=ref_col)

    # 12 connected Nav nodes
    nav_specs = [
        ("refNav01", (0.0, -2.0, 0.22), ["refNav02", "refNav12"]),
        ("refNav02", (-5.0, 3.0, 0.22), ["refNav01", "refNav03"]),
        ("refNav03", (-10.0, 6.0, 0.24), ["refNav02", "refNav04"]),
        ("refNav04", (-9.0, 10.5, 0.24), ["refNav03", "refNav05"]),
        ("refNav05", (-1.0, 15.0, 0.24), ["refNav04", "refNav06", "refNav09"]),
        ("refNav06", (8.0, 17.5, 0.22), ["refNav05", "refNav07", "refNav11"]),
        ("refNav07", (12.0, 22.0, 0.22), ["refNav06", "refNav08"]),
        ("refNav08", (13.5, 32.0, 0.25), ["refNav07"]),
        ("refNav09", (-10.0, 28.0, 0.24), ["refNav05", "refNav10"]),
        ("refNav10", (-2.0, 28.0, 3.24), ["refNav09"]),
        ("refNav11", (14.0, 8.0, 0.24), ["refNav06", "refNav12"]),
        ("refNav12", (8.0, 4.0, 0.22), ["refNav01", "refNav11"]),
    ]
    for nname, nloc, neighbors in nav_specs:
        vn_refs.add_nav_node(nname, location=nloc, links=neighbors, collection=ref_col)

    # 20 Signals (17 visible + 3 inside Secret Vault)
    visible_signals = [
        (-2.0, 0.0, 0.8), (-6.0, 4.0, 0.8), (-10.5, 8.0, 0.8), (-6.0, 10.5, 1.5),
        (-3.0, 10.5, 1.5), (1.0, 15.0, 1.5), (4.5, 15.0, 1.5), (9.0, 18.0, 0.8),
        (12.5, 24.5, 0.8), (13.5, 29.5, 0.8), (13.5, 34.0, 0.8), (-7.5, 28.0, 1.2),
        (-5.5, 28.0, 2.2), (-3.8, 28.0, 3.1), (-1.0, 27.0, 3.9), (4.0, 10.0, 0.8),
        (7.5, 6.0, 0.8),
    ]
    for idx, sloc in enumerate(visible_signals, start=1):
        vn_refs.add_signal(f"refSignal{idx:02d}", location=sloc, props={"index": idx}, collection=ref_col)
    for idx, sloc in enumerate(((17.2, 7.6, 0.9), (18.0, 8.0, 0.9), (18.7, 8.4, 0.9)), start=18):
        vn_refs.add_signal(f"refSignal{idx:02d}", location=sloc, props={"index": idx, "hidden": True}, collection=ref_col)

    # 4 Camera anchors
    vn_refs.add_camera("refCamera1", location=(-10.0, 10.0, 6.0), yaw_deg=22.0, pitch_deg=-25.0, distance=18.0, collection=ref_col)
    vn_refs.add_camera("refCamera2", location=(13.5, 28.0, 6.5), yaw_deg=-18.0, pitch_deg=-24.0, distance=18.0, collection=ref_col)
    vn_refs.add_camera("refCamera3", location=(-2.0, 28.0, 8.0), yaw_deg=12.0, pitch_deg=-28.0, distance=16.0, collection=ref_col)
    vn_refs.add_camera("refCamera4", location=(18.0, 8.0, 5.5), yaw_deg=-28.0, pitch_deg=-28.0, distance=14.0, collection=ref_col)

    # Zone bounds & frustum
    vn_refs.add_zone_bounding("refZoneBounding", radius=42.0, location=(0.0, 18.0, 0.0), collection=ref_col)
    vn_refs.add_ref("refZoneFrustum", location=(0.0, 18.0, 0.0), scale=(32.0, 30.0, 14.0), collection=ref_col)

    return {
        "terrain_obj": terrain_obj,
        "water_obj": water_obj,
        "paper_obj": paper_obj,
        "static_col": static_col,
        "dyn_col": dyn_col,
        "ref_col": ref_col,
        "line_info": line_info,
        "gear_objs": [gear1, gear2, gear_wall],
    }


def assemble_and_export_final(out_dir: Path, ctx: dict[str, Any]) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    static_col: bpy.types.Collection = ctx["static_col"]
    dyn_col: bpy.types.Collection = ctx["dyn_col"]
    ref_col: bpy.types.Collection = ctx["ref_col"]

    static_visuals: list[bpy.types.Object] = []
    fixed_physical_roots: list[bpy.types.Object] = []
    for obj in list(static_col.objects):
        if "PhysicalFixed" in obj.name:
            fixed_physical_roots.append(obj)
            continue
        if _is_collider_obj(obj) or _is_dynamic_or_kinematic_ancestor(obj):
            continue
        static_visuals.append(obj)

    b_min_x, b_max_x, b_min_z, b_max_z, _, _ = vn_bake_shadow.compute_engine_xz_bounds(static_visuals, padding=2.0)
    shared_bounds = (b_min_x, b_max_x, b_min_z, b_max_z)

    terrain_png_path = out_dir / "industria_terrain.png"
    terrain_info = bake_terrain_data_mask(
        terrain_obj=ctx["terrain_obj"],
        water_obj=ctx["water_obj"],
        bounds=shared_bounds,
        resolution=512,
        out_png_path=terrain_png_path,
    )

    merged_col = vn_scene.ensure_collection("IndustriaVisualMerged")
    groups: dict[str, list[bpy.types.Object]] = {
        "IndustriaPaperBorders": [],
        "IndustriaCanalWater": [],
        "IndustriaLineRibbon": [],
        "IndustriaGearsStatic": [],
        "IndustriaOpaqueStatic": [],
    }
    gear_set = set(ctx["gear_objs"])
    for obj in static_visuals:
        if obj.name == "IndustriaPaperBorders":
            groups["IndustriaPaperBorders"].append(obj)
        elif obj.name == "IndustriaCanalWater":
            groups["IndustriaCanalWater"].append(obj)
        elif obj.name == "IndustriaLineRibbon":
            groups["IndustriaLineRibbon"].append(obj)
        elif obj in gear_set:
            groups["IndustriaGearsStatic"].append(obj)
        else:
            groups["IndustriaOpaqueStatic"].append(obj)

    merged_static_objs: list[bpy.types.Object] = []
    for gname, gobjs in groups.items():
        m = _merge_objects_into_static_mesh(gname, gobjs, merged_col)
        if m is not None:
            merged_static_objs.append(m)

    assert len(merged_static_objs) <= 6, f"Expected <= 6 visual meshes, got {len(merged_static_objs)}"

    opaque_obj = next((o for o in merged_static_objs if o.name == "IndustriaOpaqueStatic"), None)
    if opaque_obj is not None:
        vn_bake_ao.subdivide_large_faces(opaque_obj, min_area=8.0, max_cuts=2)
    ao_summary = vn_bake_ao.bake_vertex_ao(merged_static_objs, distance=0.6, samples=64, subdivide_area=0.0)

    shadow_png_path = out_dir / "industria_shadow.png"
    shadow_meta_path = out_dir / "industria_shadow.json"
    shadow_info = vn_bake_shadow.bake_topdown_shadow(
        objects=merged_static_objs,
        resolution=1024,
        bounds=shared_bounds,
        out_png_path=str(shadow_png_path),
        out_meta_path=str(shadow_meta_path),
    )

    vis_glb = out_dir / "industriaVisual.glb"
    vn_export.export_glb(str(vis_glb), objects=merged_static_objs, export_vertex_color="ACTIVE")

    phys_export_objs: list[bpy.types.Object] = []
    for root in fixed_physical_roots:
        phys_export_objs.append(root)
        for child in root.children:
            if _is_collider_obj(child):
                phys_export_objs.append(child)
    phys_glb = out_dir / "industriaPhysical.glb"
    vn_export.export_glb(str(phys_glb), objects=phys_export_objs)

    obj_export_objs: list[bpy.types.Object] = []
    for obj in list(dyn_col.objects):
        _collect_subtree(obj, obj_export_objs)
    objs_glb = out_dir / "industriaObjects.glb"
    vn_export.export_glb(str(objs_glb), objects=obj_export_objs)

    refs_glb = out_dir / "industriaReferences.glb"
    vn_export.export_glb(str(refs_glb), objects=list(ref_col.objects))

    vis_info = vn_export.inspect_glb(str(vis_glb))
    phys_info = vn_export.inspect_glb(str(phys_glb))
    objs_info = vn_export.inspect_glb(str(objs_glb))
    refs_info = vn_export.inspect_glb(str(refs_glb))

    assert vis_info["meshes"] <= 6, f"industriaVisual.glb has {vis_info['meshes']} meshes (> 6)"
    report = {
        "mode": "final",
        "outDir": str(out_dir),
        "visualMeshes": vis_info["meshes"],
        "visualMeshNames": [o.name for o in merged_static_objs],
        "ao": {"min": ao_summary["min_ao"], "mean": ao_summary["mean_ao"], "max": ao_summary["max_ao"]},
        "terrainMask": terrain_info,
        "shadowMask": {"bytes": shadow_info["bytes"], "path": shadow_info["png_path"]},
        "glbs": {
            "industriaVisual": {"bytes": vis_info["bytes"], "meshes": vis_info["meshes"], "triangles": vis_info["triangles"]},
            "industriaPhysical": {"bytes": phys_info["bytes"], "nodes": phys_info["nodes"]},
            "industriaObjects": {"bytes": objs_info["bytes"], "meshes": objs_info["meshes"], "nodes": objs_info["nodes"]},
            "industriaReferences": {"bytes": refs_info["bytes"], "nodes": refs_info["nodes"]},
        },
        "lineLengthM": ctx["line_info"]["lengthMeters"],
    }
    print("INDUSTRIA_FINAL_OK", json.dumps(report, indent=2))
    return report


def main() -> None:
    cli = parse_cli_args()
    ctx = build_industria_scene(spline_json_out=cli["out_spline"])

    if cli["mode"] == "final":
        assemble_and_export_final(cli["out_dir"], ctx)
    else:
        vn_export.export_glb(str(cli["out_glb"]))

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
