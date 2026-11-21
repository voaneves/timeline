"""Era 3b 'Alemanha' (Bavarian Half-Timbered Island) generator (Phase 3 - T3.A1, T3.A3a, T3.A4).

Builds the 56 x 44 m cool-afternoon diorama island for Era 3b 'Alemanha':
  - Airship landing pad (`refRespawnAlemanha`, `refRespawn`, `refAirshipReturn`)
  - Half-timbered workshop & clocktower (`refMilestoneAlemanha`)
  - Framing half-timbered cottages, cobblestone square, fountain, Bavarian pines,
    and copper shortcut pipe (`refPipeContact`)
  - Continuous spline of 'a Linha' (`AlemanhaLineRibbon` + `refLinePoint01..10` +
    `alemanha_line_spline.json`)
  - Navigation graph (`refNav01..08`), 10 signals (`refSignal01..10`), 3 cameras
    (`refCamera1..3`), bounding/frustum zones (`refZoneBounding`, `refZoneFrustum`)
  - Dynamic wooden crates (`CrateAlemanha01..02PhysicalDynamic`)

Run standalone:
    blender.exe -b -P game/blender/eras/alemanha.py -- --mode final
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

from kits import alemanha_kit  # noqa: E402
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
DEFAULT_FINAL_OUT_DIR = OUT_DIR / "eras" / "alemanha"
DEFAULT_PREVIEW_OUT = PREVIEWS_DIR / "t3_alemanha_final.png"

LINE_CONTROL_POINTS_BLENDER: tuple[tuple[float, float, float], ...] = (
    (-14.0, -8.0, 1.52),
    (-11.8, -10.5, 0.85),
    (-9.6, -12.8, 0.04),
    (-5.5, -10.0, 0.04),
    (-2.5, -4.0, 0.04),
    (0.8, 1.8, 0.04),
    (3.8, 4.6, 0.04),
    (8.5, 4.2, 0.04),
    (13.0, 0.5, 0.04),
    (16.8, -4.5, 0.04),
)


# ------------------------------------------------------------------ CLI


def parse_cli_args() -> dict[str, Any]:
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
        "out_spline": resolved_out_dir / "alemanha_line_spline.json",
        "out_preview": out_preview or DEFAULT_PREVIEW_OUT,
        "render_preview": render_preview,
    }


# ------------------------------------------------------------------ PNG & mask helpers


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def _encode_rgba_png(rgba_u8: np.ndarray) -> bytes:
    h, w, c = rgba_u8.shape
    assert c == 4
    rows = [b"\x00" + rgba_u8[y].tobytes() for y in range(h)]
    compressed = zlib.compress(b"".join(rows), level=9)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", compressed)
        + _png_chunk(b"IEND", b"")
    )


def _classify_swatch_uv(u: float, v: float, swatch_uvs: dict[str, tuple[float, float]]) -> str:
    best_name = "other"
    best_d2 = 1e9
    for name, (su, sv) in swatch_uvs.items():
        d2 = (u - su) ** 2 + (v - sv) ** 2
        if d2 < best_d2:
            best_d2 = d2
            best_name = name
    return best_name if best_d2 < (1.0 / 32.0) ** 2 else "other"


def bake_terrain_data_mask(
    terrain_obj: bpy.types.Object,
    water_obj: bpy.types.Object,
    bounds: tuple[float, float, float, float],
    resolution: int = 512,
    out_png_path: Path | None = None,
) -> dict[str, Any]:
    """Generate `alemanha_terrain.png` (RGBA: R=cobble/trail, G=grass, B=water, A=height)."""
    res = max(64, int(resolution))
    min_x, max_x, min_z, max_z = (float(b) for b in bounds)
    span_x = max(max_x - min_x, 1e-4)
    span_z = max(max_z - min_z, 1e-4)

    swatch_uvs = {
        "grayLight": vn_palette.get_swatch_uv("grayLight", gltf=False),
        "paperWarm": vn_palette.get_swatch_uv("paperWarm", gltf=False),
        "campusGrass": vn_palette.get_swatch_uv("campusGrass", gltf=False),
        "campusGrassDeep": vn_palette.get_swatch_uv("campusGrassDeep", gltf=False),
        "waterOrigens": vn_palette.get_swatch_uv("waterOrigens", gltf=False),
    }

    bm_world = bmesh.new()
    face_classes: list[int] = []  # 0=other, 1=cobble/trail, 2=grass, 3=water
    try:
        for obj, is_water in ((terrain_obj, False), (water_obj, True)):
            bm_part = bmesh.new()
            bm_part.from_mesh(obj.data)
            bm_part.transform(obj.matrix_world)
            uv_layer = bm_part.loops.layers.uv.active
            tag_layer = bm_part.faces.layers.int.new("mask_cls")
            for face in bm_part.faces:
                cls_id = 0
                if uv_layer is not None and len(face.loops) > 0:
                    uv = face.loops[0][uv_layer].uv
                    sw = _classify_swatch_uv(float(uv.x), float(uv.y), swatch_uvs)
                    if sw == "waterOrigens" or is_water:
                        cls_id = 3
                    elif sw in ("grayLight", "paperWarm"):
                        cls_id = 1
                    elif sw in ("campusGrass", "campusGrassDeep"):
                        cls_id = 2
                elif is_water:
                    cls_id = 3
                face[tag_layer] = cls_id

            bmesh.ops.triangulate(bm_part, faces=bm_part.faces)
            vmap = [bm_world.verts.new(v.co) for v in bm_part.verts]
            for face in bm_part.faces:
                try:
                    bm_world.faces.new([vmap[v.index] for v in face.verts])
                    face_classes.append(face[tag_layer])
                except ValueError:
                    pass
            bm_part.free()
        bm_world.normal_update()
        bvh = BVHTree.FromBMesh(bm_world)
    finally:
        bm_world.free()

    ctrl_vecs = [Vector(pt) for pt in LINE_CONTROL_POINTS_BLENDER]
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
            hit_loc, _n, hit_idx, _d = bvh.ray_cast(Vector((world_x, bl_y, 6.0)), down, 12.0)
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

    return {
        "resolution": res,
        "bytes": len(png_bytes),
        "path": str(out_png_path) if out_png_path else None,
        "bounds": [min_x, max_x, min_z, max_z],
    }


# ------------------------------------------------------------------ Scene builders


def build_terrain_and_water(collection: bpy.types.Collection) -> None:
    """Build the 50 x 38 m island terrain, cobblestone square, paper-cut skirt, and moat."""
    bm_terr = bmesh.new()
    # Base meadow island (50 x 38 m, top at z=0.0)
    alemanha_kit._add_box(bm_terr, (48.0, 36.0, 0.50), (0.0, 0.0, -0.25), "campusGrass")
    # Cobblestone central square (24 x 18 m, slightly raised 0.02 m)
    alemanha_kit._add_box(bm_terr, (24.0, 18.0, 0.06), (0.0, 0.5, 0.01), "grayLight")
    # East scenic overlook terrace
    alemanha_kit._add_box(bm_terr, (10.0, 10.0, 0.14), (16.5, -4.5, 0.03), "paperWarm")
    alemanha_kit._finalize_bmesh("AlemanhaTerrainVisual", bm_terr, collection)

    # Paper-cut border skirt around the island
    bm_border = bmesh.new()
    alemanha_kit._add_box(bm_border, (49.2, 0.65, 1.35), (0.0, -18.3, -0.58), "paper")
    alemanha_kit._add_box(bm_border, (49.2, 0.65, 1.35), (0.0, 18.3, -0.58), "paper")
    alemanha_kit._add_box(bm_border, (0.65, 36.6, 1.35), (-24.3, 0.0, -0.58), "paper")
    alemanha_kit._add_box(bm_border, (0.65, 36.6, 1.35), (24.3, 0.0, -0.58), "paper")
    alemanha_kit._finalize_bmesh("AlemanhaPaperBorders", bm_border, collection)

    # Surrounding cool afternoon river moat
    bm_water = bmesh.new()
    alemanha_kit._add_box(bm_water, (60.0, 48.0, 0.16), (0.0, 0.0, -0.45), "waterOrigens")
    alemanha_kit._finalize_bmesh("AlemanhaWaterBase", bm_water, collection)

    # Ground physical collider
    terr_phys = alemanha_kit._make_physical_root("AlemanhaTerrain", "fixed", (0.0, 0.0, 0.0), collection)
    vn_collide.add_cuboid(
        "AlemanhaGround",
        (48.0, 36.0, 0.60),
        location=(0.0, 0.0, -0.30),
        parent=terr_phys,
        collection=collection,
        engine_coords=False,
    )


def build_line_and_spline(
    collection: bpy.types.Collection,
    spline_json_out: Path,
) -> dict[str, Any]:
    pts_b = [tuple(float(c) for c in pt) for pt in LINE_CONTROL_POINTS_BLENDER]
    ctrl_vecs = [Vector(pt) for pt in pts_b]
    sampled_vecs, arc_s = vn_shapes._sample_spline_uniform(ctrl_vecs, step=0.25)
    total_len = round(float(arc_s[-1]), 3)

    ribbon_obj = vn_shapes.make_ribbon(
        name="AlemanhaLineRibbon",
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

    ctrl_json = []
    for idx, pt_b in enumerate(pts_b, start=1):
        pt_e = vn_scene.to_engine(*pt_b)
        props = {"index": idx, "era": "alemanha"}
        vn_refs.add_ref(f"refLinePoint{idx:02d}", location=pt_b, props=props, collection=collection)
        if idx < 10:
            vn_refs.add_line_point(idx, location=pt_b, props=props, collection=collection, engine_coords=False)
        ctrl_json.append(
            {
                "index": idx,
                "name": f"refLinePoint{idx:02d}",
                "blender": [round(pt_b[0], 4), round(pt_b[1], 4), round(pt_b[2], 4)],
                "engine": [round(pt_e[0], 4), round(pt_e[1], 4), round(pt_e[2], 4)],
            }
        )

    sampled_json = []
    for sv, sd in zip(sampled_vecs, arc_s):
        se = vn_scene.to_engine(sv.x, sv.y, sv.z)
        sampled_json.append(
            {
                "s": round(float(sd), 4),
                "blender": [round(float(sv.x), 4), round(float(sv.y), 4), round(float(sv.z), 4)],
                "engine": [round(se[0], 4), round(se[1], 4), round(se[2], 4)],
            }
        )

    payload = {
        "era": "alemanha",
        "name": "AlemanhaLineRibbon",
        "width": 0.35,
        "thickness": 0.04,
        "step": 0.25,
        "length": total_len,
        "controlPoints": ctrl_json,
        "sampledPoints": sampled_json,
    }
    spline_json_out.parent.mkdir(parents=True, exist_ok=True)
    spline_json_out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {"ribbon": ribbon_obj, "length": total_len, "spline_json_path": str(spline_json_out)}


def build_dynamic_crates(collection: bpy.types.Collection) -> None:
    """Create 2 dynamic wooden crates so alemanhaObjects.glb has tactile Rapier props."""
    for idx, loc in enumerate(((9.5, 6.2, 0.45), (10.6, 5.8, 0.45)), start=1):
        root = vn_collide.wrap_physical_object(
            f"CrateAlemanha{idx:02d}",
            None,
            None,
            mass=8.0,
            friction=0.6,
            restitution=0.15,
            body_type="dynamic",
            location=loc,
            collection=collection,
            engine_coords=False,
        )
        bm = bmesh.new()
        alemanha_kit._add_box(bm, (0.82, 0.82, 0.82), (0.0, 0.0, 0.0), "wood")
        alemanha_kit._add_box(bm, (0.86, 0.12, 0.86), (0.0, 0.0, 0.0), "timber")
        alemanha_kit._finalize_bmesh(
            f"CrateAlemanha{idx:02d}Visual", bm, collection, parent=root, bevel_width=0.01
        )
        vn_collide.add_cuboid(
            f"CrateAlemanha{idx:02d}Box",
            (0.84, 0.84, 0.84),
            location=(0.0, 0.0, 0.0),
            parent=root,
            collection=collection,
            engine_coords=False,
        )


def build_refs(collection: bpy.types.Collection) -> None:
    # Respawn & airship return
    vn_refs.add_respawn(
        "Alemanha", location=(-14.0, -8.0, 1.55), yaw_deg=-25.0, props={"era": "alemanha"}, collection=collection
    )
    vn_refs.add_respawn(
        "", location=(-14.0, -8.0, 1.55), yaw_deg=-25.0, props={"era": "alemanha"}, collection=collection
    )
    vn_refs.add_ref(
        "refAirshipReturn",
        location=(-16.5, -6.5, 1.55),
        props={"era": "alemanha", "targetEra": "industria"},
        collection=collection,
    )

    # Milestone & shortcut pipe
    vn_refs.add_milestone(
        "Alemanha",
        location=(3.8, 4.6, 0.05),
        entry_id="2018-07",
        props={"beat": "A2", "era": "alemanha"},
        collection=collection,
    )
    vn_refs.add_ref(
        "refPipeContact",
        location=(-8.5, -11.5, 1.30),
        props={"target": "hub", "era": "alemanha"},
        collection=collection,
    )

    # Nav graph (8 nodes from landing pad to workshop & overlook)
    nav_pts = [
        (-14.0, -8.0, 1.55, [2]),
        (-11.8, -10.5, 0.85, [1, 3]),
        (-9.6, -12.8, 0.05, [2, 4]),
        (-5.5, -10.0, 0.05, [3, 5]),
        (-2.5, -4.0, 0.05, [4, 6]),
        (0.8, 1.8, 0.05, [5, 7]),
        (3.8, 4.6, 0.05, [6, 8]),
        (13.0, 0.5, 0.05, [7]),
    ]
    for idx, (nx, ny, nz, links) in enumerate(nav_pts, start=1):
        vn_refs.add_nav_node(
            f"{idx:02d}",
            location=(nx, ny, nz),
            links=[f"refNav{l:02d}" for l in links],
            collection=collection,
        )

    # 10 collectible signals
    sig_pts = [
        (-13.5, -9.2, 1.9),
        (-10.5, -11.6, 1.1),
        (-6.2, -9.8, 0.7),
        (-3.2, -4.2, 0.7),
        (-2.5, 1.5, 2.2),
        (1.2, 2.5, 0.7),
        (4.0, 4.6, 0.7),
        (9.5, 4.5, 0.7),
        (14.0, -1.0, 0.7),
        (16.8, -4.5, 0.9),
    ]
    for idx, pos in enumerate(sig_pts, start=1):
        vn_refs.add_signal(f"{idx:02d}", location=pos, props={"era": "alemanha"}, collection=collection)

    # Cameras & zones
    vn_refs.add_camera("1", location=(-10.0, -16.0, 9.0), yaw_deg=-25.0, pitch_deg=28.0, collection=collection)
    vn_refs.add_camera("2", location=(3.0, -10.0, 11.0), yaw_deg=0.0, pitch_deg=26.0, collection=collection)
    vn_refs.add_camera("3", location=(14.0, -12.0, 12.0), yaw_deg=35.0, pitch_deg=30.0, collection=collection)
    vn_refs.add_zone_bounding("", location=(0.0, 0.0, 0.0), radius=36.0, props={"era": "alemanha"}, collection=collection)
    vn_refs.add_ref("refZoneFrustum", location=(0.0, 0.0, 0.0), scale=(32.0, 24.0, 16.0), collection=collection)


def build_alemanha(spline_json_out: Path) -> dict[str, Any]:
    vn_scene.reset_scene("Alemanha")
    col = vn_scene.ensure_collection("AlemanhaEra")

    build_terrain_and_water(col)
    alemanha_kit.build_airship_landing_pad("AlemanhaLandingPad", (-14.0, -8.0, 0.0), col, rot_z_deg=-25.0)
    alemanha_kit.build_half_timbered_workshop_clocktower("AlemanhaWorkshop", (4.0, 9.0, 0.0), col, rot_z_deg=0.0)
    alemanha_kit.build_half_timbered_cottage("AlemanhaCottageWest", (-13.5, 10.5, 0.0), col, rot_z_deg=-35.0, scale=0.95)
    alemanha_kit.build_half_timbered_cottage("AlemanhaCottageEast", (15.5, 4.0, 0.0), col, rot_z_deg=55.0, scale=0.90)
    alemanha_kit.build_bavarian_fountain("AlemanhaFountain", (-2.5, 1.5, 0.0), col)
    alemanha_kit.build_shortcut_pipe("AlemanhaShortcutPipe", (-8.5, -11.5, 0.0), col)

    pine_locs = [
        (-20.5, 13.0, 0.0, 5.8),
        (-18.0, 15.0, 0.0, 4.9),
        (-6.0, 15.2, 0.0, 5.5),
        (13.5, 14.5, 0.0, 6.0),
        (20.5, 11.0, 0.0, 5.2),
        (21.0, -10.5, 0.0, 5.4),
        (12.0, -14.5, 0.0, 4.8),
        (-21.0, -13.0, 0.0, 5.1),
    ]
    for idx, (px, py, pz, ph) in enumerate(pine_locs, start=1):
        alemanha_kit.build_bavarian_pine(f"AlemanhaTree{idx:02d}", (px, py, pz), col, height=ph)

    build_dynamic_crates(col)
    line_info = build_line_and_spline(col, spline_json_out)
    build_refs(col)
    return {"lineLengthM": line_info["length"], "splineJsonPath": line_info["spline_json_path"]}


# ------------------------------------------------------------------ Final assembly & split export


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
    name: str, objs: list[bpy.types.Object], collection: bpy.types.Collection
) -> bpy.types.Object | None:
    meshes = [o for o in objs if o is not None and o.type == "MESH" and o.data is not None]
    if not meshes:
        return None
    vl = bpy.context.view_layer
    for obj in meshes:
        mw = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = mw
        if obj.hide_select:
            obj.hide_select = False
    vl.update()

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    vl.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()

    merged = vl.objects.active
    merged.name = name
    if merged.data is not None:
        merged.data.name = name
        pal_mat = vn_palette.ensure_palette_material()
        merged.data.materials.clear()
        merged.data.materials.append(pal_mat)
        for poly in merged.data.polygons:
            poly.material_index = 0
    for c in list(merged.users_collection):
        c.objects.unlink(merged)
    collection.objects.link(merged)
    return merged


def _collect_subtree(root: bpy.types.Object, out: list[bpy.types.Object]) -> None:
    if root not in out:
        out.append(root)
    for child in root.children:
        _collect_subtree(child, out)


def assemble_and_export_final(out_dir: Path, stats: dict[str, Any]) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    bpy.context.view_layer.update()

    all_objs = [o for o in scene.objects if not any(c.name.startswith("_Preview") for c in o.users_collection)]
    terrain_obj = bpy.data.objects.get("AlemanhaTerrainVisual")
    water_obj = bpy.data.objects.get("AlemanhaWaterBase")
    if terrain_obj is None or water_obj is None:
        raise RuntimeError("Missing AlemanhaTerrainVisual or AlemanhaWaterBase")

    ref_objs: list[bpy.types.Object] = []
    dynamic_roots: list[bpy.types.Object] = []
    fixed_roots: list[bpy.types.Object] = []
    static_visuals: list[bpy.types.Object] = []

    for obj in all_objs:
        ln = obj.name.lower()
        if obj.name.startswith("ref"):
            ref_objs.append(obj)
        elif obj.parent is None and ("physicaldynamic" in ln or "physicalkinematic" in ln):
            dynamic_roots.append(obj)
        elif obj.parent is None and "physicalfixed" in ln:
            fixed_roots.append(obj)

    for obj in all_objs:
        if obj.type != "MESH" or obj.data is None:
            continue
        if _is_collider_obj(obj) or _is_dynamic_or_kinematic_ancestor(obj):
            continue
        static_visuals.append(obj)

    b_min_x, b_max_x, b_min_z, b_max_z, _, _ = vn_bake_shadow.compute_engine_xz_bounds(static_visuals, padding=2.0)
    shared_bounds = (b_min_x, b_max_x, b_min_z, b_max_z)

    terrain_mask_info = bake_terrain_data_mask(
        terrain_obj=terrain_obj,
        water_obj=water_obj,
        bounds=shared_bounds,
        resolution=512,
        out_png_path=out_dir / "alemanha_terrain.png",
    )

    vis_col = vn_scene.ensure_collection("AlemanhaVisualMerged")
    groups: dict[str, list[bpy.types.Object]] = {
        "AlemanhaPaperBorders": [],
        "AlemanhaWaterBase": [],
        "AlemanhaLineRibbon": [],
        "AlemanhaFoliageStatic": [],
        "AlemanhaOpaqueStatic": [],
    }
    for obj in static_visuals:
        if obj.name == "AlemanhaPaperBorders":
            groups["AlemanhaPaperBorders"].append(obj)
        elif obj.name == "AlemanhaWaterBase":
            groups["AlemanhaWaterBase"].append(obj)
        elif obj.name == "AlemanhaLineRibbon":
            groups["AlemanhaLineRibbon"].append(obj)
        elif obj.name.startswith("AlemanhaTree"):
            groups["AlemanhaFoliageStatic"].append(obj)
        else:
            groups["AlemanhaOpaqueStatic"].append(obj)

    merged_static: list[bpy.types.Object] = []
    for gname, gobjs in groups.items():
        m = _merge_objects_into_static_mesh(gname, gobjs, vis_col)
        if m is not None:
            merged_static.append(m)

    if len(merged_static) > 6:
        raise AssertionError(f"Expected <= 6 visual meshes, got {len(merged_static)}")

    opaque_obj = next((o for o in merged_static if o.name == "AlemanhaOpaqueStatic"), None)
    if opaque_obj is not None:
        vn_bake_ao.subdivide_large_faces(opaque_obj, min_area=8.0, max_cuts=2)
    ao_summary = vn_bake_ao.bake_vertex_ao(merged_static, distance=0.6, samples=64, subdivide_area=0.0)

    shadow_info = vn_bake_shadow.bake_topdown_shadow(
        objects=merged_static,
        resolution=1024,
        bounds=shared_bounds,
        out_png_path=str(out_dir / "alemanha_shadow.png"),
        out_meta_path=str(out_dir / "alemanha_shadow.json"),
    )

    vis_glb = out_dir / "alemanhaVisual.glb"
    vn_export.export_glb(str(vis_glb), objects=merged_static, export_vertex_color="ACTIVE")

    phys_objs: list[bpy.types.Object] = []
    for root in fixed_roots:
        phys_objs.append(root)
        for child in root.children:
            if _is_collider_obj(child):
                phys_objs.append(child)
    phys_glb = out_dir / "alemanhaPhysical.glb"
    vn_export.export_glb(str(phys_glb), objects=phys_objs)

    obj_export: list[bpy.types.Object] = []
    for root in dynamic_roots:
        _collect_subtree(root, obj_export)
    objs_glb = out_dir / "alemanhaObjects.glb"
    vn_export.export_glb(str(objs_glb), objects=obj_export)

    refs_glb = out_dir / "alemanhaReferences.glb"
    vn_export.export_glb(str(refs_glb), objects=ref_objs)

    vis_info = vn_export.inspect_glb(str(vis_glb))
    phys_info = vn_export.inspect_glb(str(phys_glb))
    objs_info = vn_export.inspect_glb(str(objs_glb))
    refs_info = vn_export.inspect_glb(str(refs_glb))

    if vis_info["meshes"] > 6:
        raise AssertionError(f"alemanhaVisual.glb has {vis_info['meshes']} meshes (must be <= 6)")
    has_color0 = any(
        "COLOR_0" in prim.get("attributes", {})
        for mesh in vis_info["gltf"].get("meshes", [])
        for prim in mesh.get("primitives", [])
    )
    if not has_color0:
        raise AssertionError("alemanhaVisual.glb missing COLOR_0 vertex AO")

    report = {
        "mode": "final",
        "visualMeshesCount": vis_info["meshes"],
        "visualMeshNames": [o.name for o in merged_static],
        "ao": {"min": ao_summary["min_ao"], "mean": ao_summary["mean_ao"], "max": ao_summary["max_ao"]},
        "terrainMask": terrain_mask_info,
        "shadowMask": {"bytes": shadow_info["bytes"], "resolution": shadow_info["resolution"]},
        "glbs": {
            "alemanhaVisual": {"bytes": vis_info["bytes"], "meshes": vis_info["meshes"], "triangles": vis_info["triangles"]},
            "alemanhaPhysical": {"bytes": phys_info["bytes"], "nodes": phys_info["nodes"]},
            "alemanhaObjects": {"bytes": objs_info["bytes"], "meshes": objs_info["meshes"], "nodes": objs_info["nodes"]},
            "alemanhaReferences": {"bytes": refs_info["bytes"], "nodes": refs_info["nodes"]},
        },
        "refCount": len(ref_objs),
        "lineLengthM": stats["lineLengthM"],
    }
    print("ALEMANHA_FINAL_OK", json.dumps(report, indent=2))
    return report


def main() -> None:
    cli = parse_cli_args()
    stats = build_alemanha(cli["out_spline"])
    assemble_and_export_final(cli["out_dir"], stats)
    if cli["render_preview"]:
        vn_scene.render_3views(
            str(cli["out_preview"]),
            target=(0.0, 0.0, 2.0),
            radius=34.0,
            size=640,
            engine_coords=False,
        )


if __name__ == "__main__":
    main()
