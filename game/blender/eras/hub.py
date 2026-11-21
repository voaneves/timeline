"""Central Hub + 6 m Ponto Final + Backstage Credits Room generator (Phase 3 - T3.H1, T3.H3a, T3.H4).

Builds the Central Hub diorama island (~54 x 54 m):
  - ~12 m tall layered paper-cut mountain visible from all 5 eras
  - Walkable spiral ramp of 'a Linha' climbing from the plaza to the summit
    (`HubLineRibbon` + `refLinePoint01..16` + `hub_line_spline.json`)
  - 6.0 m glowing red Ponto Final sphere (`HubEndDotSphere`, `refEndDotSphere`, `refMilestoneEndDot`)
  - 5 arrival copper pipes from all 5 eras (`refHubArrival`, `refHubArrival<Era>`)
  - Recessed Sala de Bastidores (`refBackstage`) with 3D diorama pipeline map & MIT credits
  - Navigation graph (`refNav01..12`), 10 signals (`refSignal01..10`), 4 cameras (`refCamera1..4`),
    bounding/frustum zones (`refZoneBounding`, `refZoneFrustum`)

Run standalone:
    blender.exe -b -P game/blender/eras/hub.py -- --mode final
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
BLENDER_DIR = HERE.parent
if str(BLENDER_DIR) not in sys.path:
    sys.path.insert(0, str(BLENDER_DIR))

from kits import hub_landmarks  # noqa: E402
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
DEFAULT_FINAL_OUT_DIR = OUT_DIR / "eras" / "hub"
DEFAULT_PREVIEW_OUT = PREVIEWS_DIR / "t3_hub_final.png"

INTERACTIVE_LANDMARK_MESHES: set[str] = {"HubEndDotSphere"}

# 16 control points of A Linha spiraling up the central hill to the summit plinth
LINE_CONTROL_POINTS_BLENDER: tuple[tuple[float, float, float], ...] = tuple(
    (
        round(hub_landmarks.spiral_ramp_point(i / 15.0)[0], 3),
        round(hub_landmarks.spiral_ramp_point(i / 15.0)[1], 3),
        round(hub_landmarks.spiral_ramp_point(i / 15.0)[2] + 0.04, 3),
    )
    for i in range(16)
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
        "out_spline": resolved_out_dir / "hub_line_spline.json",
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
    hill_obj: bpy.types.Object,
    water_obj: bpy.types.Object,
    bounds: tuple[float, float, float, float],
    resolution: int = 512,
    out_png_path: Path | None = None,
) -> dict[str, Any]:
    """Generate `hub_terrain.png` (RGBA: R=plaza/ramp, G=grass, B=water, A=height 0..13 m)."""
    res = max(64, int(resolution))
    min_x, max_x, min_z, max_z = (float(b) for b in bounds)
    span_x = max(max_x - min_x, 1e-4)
    span_z = max(max_z - min_z, 1e-4)

    swatch_uvs = {
        "paper": vn_palette.get_swatch_uv("paper", gltf=False),
        "paperWarm": vn_palette.get_swatch_uv("paperWarm", gltf=False),
        "paperShadow": vn_palette.get_swatch_uv("paperShadow", gltf=False),
        "cerradoGreen": vn_palette.get_swatch_uv("cerradoGreen", gltf=False),
        "campusGrass": vn_palette.get_swatch_uv("campusGrass", gltf=False),
        "waterOrigens": vn_palette.get_swatch_uv("waterOrigens", gltf=False),
    }

    bm_world = bmesh.new()
    face_classes: list[int] = []  # 0=other, 1=plaza/ramp, 2=grass, 3=water
    try:
        for obj, is_water in ((terrain_obj, False), (hill_obj, False), (water_obj, True)):
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
                    elif sw in ("paper", "paperWarm", "paperShadow"):
                        cls_id = 1
                    elif sw in ("cerradoGreen", "campusGrass"):
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
    min_h, max_h = -0.6, 13.0
    inv_h_span = 1.0 / (max_h - min_h)

    for iz in range(res):
        world_z = min_z + ((iz + 0.5) / res) * span_z
        bl_y = -world_z
        for ix in range(res):
            world_x = min_x + ((ix + 0.5) / res) * span_x
            hit_loc, _n, hit_idx, _d = bvh.ray_cast(Vector((world_x, bl_y, 18.0)), down, 22.0)
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
    """Build the 50 x 50 m circular/octagonal Hub island plaza, paper border, and moat."""
    bm_terr = bmesh.new()
    hub_landmarks._add_prism(bm_terr, 25.0, 0.50, (0.0, 0.0, -0.25), 24, "cerradoGreen")
    hub_landmarks._add_prism(bm_terr, 22.0, 0.06, (0.0, 0.0, 0.01), 24, "paperWarm")
    hub_landmarks._finalize_bmesh("HubTerrainVisual", bm_terr, collection)

    # Paper-cut border ring around the circular island
    bm_border = bmesh.new()
    hub_landmarks._add_prism(bm_border, 25.5, 1.30, (0.0, 0.0, -0.60), 24, "paper")
    hub_landmarks._finalize_bmesh("HubPaperBorders", bm_border, collection)

    # Surrounding water ring
    bm_water = bmesh.new()
    hub_landmarks._add_box(bm_water, (64.0, 64.0, 0.16), (0.0, 0.0, -0.45), "waterOrigens")
    hub_landmarks._finalize_bmesh("HubWaterBase", bm_water, collection)

    # Ground physical collider
    terr_phys = hub_landmarks._make_physical_root("HubTerrain", "fixed", (0.0, 0.0, 0.0), collection)
    vn_collide.add_cuboid(
        "HubGround",
        (50.0, 50.0, 0.60),
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
        name="HubLineRibbon",
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
        props = {"index": idx, "era": "hub"}
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
        "era": "hub",
        "name": "HubLineRibbon",
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


def build_refs(
    collection: bpy.types.Collection,
    pipes: list[dict[str, object]],
) -> None:
    start_x, start_y, start_z, _ = hub_landmarks.spiral_ramp_point(0.0)
    vn_refs.add_respawn(
        "Hub", location=(start_x - 1.5, start_y - 2.0, 0.05), yaw_deg=25.0, props={"era": "hub"}, collection=collection
    )
    vn_refs.add_respawn(
        "", location=(start_x - 1.5, start_y - 2.0, 0.05), yaw_deg=25.0, props={"era": "hub"}, collection=collection
    )

    # End-Dot sphere & summit milestone
    vn_refs.add_ref(
        "refEndDotSphere",
        location=(0.0, 0.0, 15.6),
        props={"era": "hub", "diameterM": 6.0},
        collection=collection,
    )
    vn_refs.add_milestone(
        "EndDot",
        location=(0.0, -3.5, 11.85),
        entry_id="contato",
        props={"beat": "H_ENDDOT", "era": "hub"},
        collection=collection,
    )

    # Arrival copper pipes refs
    vn_refs.add_ref(
        "refHubArrival",
        location=pipes[0]["pos"],
        props={"era": "hub", "count": len(pipes)},
        collection=collection,
    )
    for p in pipes:
        px, py, pz = p["pos"]
        vn_refs.add_ref(
            f"refHubArrival{p['era']}",
            location=(px, py, pz + 1.4),
            props={"sourceEra": str(p["era"]).lower()},
            collection=collection,
        )

    # Backstage Credits Room ref
    vn_refs.add_ref(
        "refBackstage",
        location=(0.0, 16.5, 0.05),
        props={"beat": "H_BACKSTAGE", "era": "hub", "room": "credits"},
        collection=collection,
    )

    # Nav graph: 11 nodes climbing the spiral ramp + node 12 inside Backstage Room
    for idx in range(1, 12):
        t = (idx - 1) / 10.0
        nx, ny, nz, _ = hub_landmarks.spiral_ramp_point(t)
        links = []
        if idx > 1:
            links.append(f"refNav{idx - 1:02d}")
        if idx < 11:
            links.append(f"refNav{idx + 1:02d}")
        if idx == 1:
            links.append("refNav12")
        vn_refs.add_nav_node(
            f"{idx:02d}",
            location=(nx, ny, nz + 0.05),
            links=links,
            collection=collection,
        )
    vn_refs.add_nav_node(
        "12",
        location=(0.0, 14.5, 0.05),
        links=["refNav01"],
        collection=collection,
    )

    # 10 collectible signals along spiral + backstage
    for idx in range(1, 10):
        t = idx / 10.0
        sx, sy, sz, _ = hub_landmarks.spiral_ramp_point(t)
        vn_refs.add_signal(
            f"{idx:02d}", location=(sx, sy, sz + 0.7), props={"era": "hub"}, collection=collection
        )
    vn_refs.add_signal("10", location=(0.0, 17.5, 1.3), props={"era": "hub", "secret": True}, collection=collection)

    # Cameras & zones
    vn_refs.add_camera("1", location=(0.0, -28.0, 14.0), yaw_deg=0.0, pitch_deg=24.0, collection=collection)
    vn_refs.add_camera("2", location=(24.0, -18.0, 18.0), yaw_deg=45.0, pitch_deg=28.0, collection=collection)
    vn_refs.add_camera("3", location=(0.0, 26.0, 8.0), yaw_deg=180.0, pitch_deg=20.0, collection=collection)
    vn_refs.add_camera("4", location=(0.0, -36.0, 26.0), yaw_deg=0.0, pitch_deg=32.0, collection=collection)
    vn_refs.add_zone_bounding("", location=(0.0, 0.0, 6.0), radius=40.0, props={"era": "hub"}, collection=collection)
    vn_refs.add_ref("refZoneFrustum", location=(0.0, 0.0, 6.0), scale=(34.0, 34.0, 22.0), collection=collection)


def build_hub(spline_json_out: Path) -> dict[str, Any]:
    vn_scene.reset_scene("Hub")
    col = vn_scene.ensure_collection("HubEra")

    build_terrain_and_water(col)
    hub_landmarks.build_central_hill_and_ramp(col)
    hub_landmarks.build_end_dot_sphere(col)
    pipes = hub_landmarks.build_arrival_pipes(col)
    hub_landmarks.build_backstage_room(col, location=(0.0, 16.5, 0.0))

    tree_locs = [
        (-19.5, 12.0, 0.0, "ipeGold", 4.6),
        (19.5, 12.0, 0.0, "ipeGold", 4.8),
        (-16.0, 18.5, 0.0, "cerradoGreen", 4.2),
        (16.0, 18.5, 0.0, "cerradoGreen", 4.4),
        (-21.0, -14.0, 0.0, "cerradoGreen", 4.5),
        (21.0, -14.0, 0.0, "ipeGold", 4.3),
    ]
    for idx, (tx, ty, tz, sw, th) in enumerate(tree_locs, start=1):
        hub_landmarks.build_hub_tree(f"HubTree{idx:02d}", (tx, ty, tz), col, foliage_swatch=sw, height=th)

    line_info = build_line_and_spline(col, spline_json_out)
    build_refs(col, pipes)
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
    terrain_obj = bpy.data.objects.get("HubTerrainVisual")
    hill_obj = bpy.data.objects.get("HubCentralHillVisual")
    water_obj = bpy.data.objects.get("HubWaterBase")
    if terrain_obj is None or hill_obj is None or water_obj is None:
        raise RuntimeError("Missing HubTerrainVisual, HubCentralHillVisual, or HubWaterBase")

    ref_objs: list[bpy.types.Object] = []
    dynamic_roots: list[bpy.types.Object] = []
    fixed_roots: list[bpy.types.Object] = []
    interactive_objs: list[bpy.types.Object] = []
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
        if obj.name in INTERACTIVE_LANDMARK_MESHES:
            interactive_objs.append(obj)
            continue
        static_visuals.append(obj)

    b_min_x, b_max_x, b_min_z, b_max_z, _, _ = vn_bake_shadow.compute_engine_xz_bounds(static_visuals, padding=2.0)
    shared_bounds = (b_min_x, b_max_x, b_min_z, b_max_z)

    terrain_mask_info = bake_terrain_data_mask(
        terrain_obj=terrain_obj,
        hill_obj=hill_obj,
        water_obj=water_obj,
        bounds=shared_bounds,
        resolution=512,
        out_png_path=out_dir / "hub_terrain.png",
    )

    vis_col = vn_scene.ensure_collection("HubVisualMerged")
    groups: dict[str, list[bpy.types.Object]] = {
        "HubPaperBorders": [],
        "HubWaterBase": [],
        "HubLineRibbon": [],
        "HubFoliageStatic": [],
        "HubOpaqueStatic": [],
    }
    for obj in static_visuals:
        if obj.name == "HubPaperBorders":
            groups["HubPaperBorders"].append(obj)
        elif obj.name == "HubWaterBase":
            groups["HubWaterBase"].append(obj)
        elif obj.name == "HubLineRibbon":
            groups["HubLineRibbon"].append(obj)
        elif obj.name.startswith("HubTree"):
            groups["HubFoliageStatic"].append(obj)
        else:
            groups["HubOpaqueStatic"].append(obj)

    merged_static: list[bpy.types.Object] = []
    for gname, gobjs in groups.items():
        m = _merge_objects_into_static_mesh(gname, gobjs, vis_col)
        if m is not None:
            merged_static.append(m)

    if len(merged_static) > 6:
        raise AssertionError(f"Expected <= 6 visual meshes, got {len(merged_static)}")

    opaque_obj = next((o for o in merged_static if o.name == "HubOpaqueStatic"), None)
    if opaque_obj is not None:
        vn_bake_ao.subdivide_large_faces(opaque_obj, min_area=10.0, max_cuts=2)
    ao_summary = vn_bake_ao.bake_vertex_ao(merged_static, distance=0.6, samples=64, subdivide_area=0.0)

    shadow_info = vn_bake_shadow.bake_topdown_shadow(
        objects=merged_static,
        resolution=1024,
        bounds=shared_bounds,
        out_png_path=str(out_dir / "hub_shadow.png"),
        out_meta_path=str(out_dir / "hub_shadow.json"),
    )

    vis_glb = out_dir / "hubVisual.glb"
    vn_export.export_glb(str(vis_glb), objects=merged_static, export_vertex_color="ACTIVE")

    phys_objs: list[bpy.types.Object] = []
    for root in fixed_roots:
        phys_objs.append(root)
        for child in root.children:
            if _is_collider_obj(child):
                phys_objs.append(child)
    phys_glb = out_dir / "hubPhysical.glb"
    vn_export.export_glb(str(phys_glb), objects=phys_objs)

    obj_export: list[bpy.types.Object] = []
    for root in dynamic_roots:
        _collect_subtree(root, obj_export)
    for io_obj in interactive_objs:
        if io_obj not in obj_export:
            obj_export.append(io_obj)
    objs_glb = out_dir / "hubObjects.glb"
    vn_export.export_glb(str(objs_glb), objects=obj_export)

    refs_glb = out_dir / "hubReferences.glb"
    vn_export.export_glb(str(refs_glb), objects=ref_objs)

    vis_info = vn_export.inspect_glb(str(vis_glb))
    phys_info = vn_export.inspect_glb(str(phys_glb))
    objs_info = vn_export.inspect_glb(str(objs_glb))
    refs_info = vn_export.inspect_glb(str(refs_glb))

    if vis_info["meshes"] > 6:
        raise AssertionError(f"hubVisual.glb has {vis_info['meshes']} meshes (must be <= 6)")
    has_color0 = any(
        "COLOR_0" in prim.get("attributes", {})
        for mesh in vis_info["gltf"].get("meshes", [])
        for prim in mesh.get("primitives", [])
    )
    if not has_color0:
        raise AssertionError("hubVisual.glb missing COLOR_0 vertex AO")

    report = {
        "mode": "final",
        "visualMeshesCount": vis_info["meshes"],
        "visualMeshNames": [o.name for o in merged_static],
        "ao": {"min": ao_summary["min_ao"], "mean": ao_summary["mean_ao"], "max": ao_summary["max_ao"]},
        "terrainMask": terrain_mask_info,
        "shadowMask": {"bytes": shadow_info["bytes"], "resolution": shadow_info["resolution"]},
        "glbs": {
            "hubVisual": {"bytes": vis_info["bytes"], "meshes": vis_info["meshes"], "triangles": vis_info["triangles"]},
            "hubPhysical": {"bytes": phys_info["bytes"], "nodes": phys_info["nodes"]},
            "hubObjects": {"bytes": objs_info["bytes"], "meshes": objs_info["meshes"], "nodes": objs_info["nodes"]},
            "hubReferences": {"bytes": refs_info["bytes"], "nodes": refs_info["nodes"]},
        },
        "refCount": len(ref_objs),
        "lineLengthM": stats["lineLengthM"],
    }
    print("HUB_FINAL_OK", json.dumps(report, indent=2))
    return report


def main() -> None:
    cli = parse_cli_args()
    stats = build_hub(cli["out_spline"])
    assemble_and_export_final(cli["out_dir"], stats)
    if cli["render_preview"]:
        vn_scene.render_3views(
            str(cli["out_preview"]),
            target=(0.0, 0.0, 6.0),
            radius=40.0,
            size=640,
            engine_coords=False,
        )


if __name__ == "__main__":
    main()
