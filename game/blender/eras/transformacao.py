"""Era 5 'Transformação Digital + Praça de Projetos' generator (Phase 3 - T3.T1..T3.T4).

Builds the 56 x 48 m dusk-to-warm-night diorama island for Era 5 (2022-hoje):
  - Arrival terrace (`refRespawnTransformacao`, `refRespawn`)
  - 3 Milestone blocks (`2022-01`, `2022-09-ali`, `2022-09-casamento`)
  - Praça de Projetos: 6 giant Project Cartridges + Console-Pedestals + Projection Screens
    (`Cartridge01..06`, `ProjectScreen01..06`, `refProject01..06`)
  - SEBRAE small-business storefronts & advisory counter
  - Wedding fairy-light arch under a blooming golden Ipê (`TransformacaoWeddingArch`)
  - Backstage Room trapdoor (`BackstageTrapdoorHatch`, `refSecretBackstage`)
  - Copper shortcut pipe (`refPipeContact`)
  - Continuous spline of 'a Linha' (`TransformacaoLineRibbon` + `refLinePoint01..16` +
    `transformacao_line_spline.json`)
  - Navigation graph (`refNav01..12`), 20 signals (`refSignal01..20`), 4 cameras (`refCamera1..4`),
    bounding/frustum zones (`refZoneBounding`, `refZoneFrustum`)

Run standalone:
    blender.exe -b -P game/blender/eras/transformacao.py -- --mode final
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

from kits import platform_kit, transformacao_kit as tk, transformacao_landmarks as tl  # noqa: E402
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
DEFAULT_FINAL_OUT_DIR = OUT_DIR / "eras" / "transformacao"
DEFAULT_PREVIEW_OUT = PREVIEWS_DIR / "t3_transformacao_final.png"

INTERACTIVE_LANDMARK_MESHES: frozenset[str] = frozenset(
    {
        "TransformacaoMilestone2022_01",
        "TransformacaoMilestone2022_09_ali",
        "TransformacaoMilestone2022_09_casamento",
        "BackstageTrapdoorHatch",
        *(f"Cartridge{i:02d}" for i in range(1, 7)),
        *(f"ProjectScreen{i:02d}" for i in range(1, 7)),
    }
)

# 16 control points of A Linha winding through Era 5
LINE_CONTROL_POINTS_BLENDER: tuple[tuple[float, float, float], ...] = (
    (-14.0, -14.0, 0.38),
    (-12.2, -11.0, 0.06),
    (-10.0, -7.5, 0.04),
    (-11.5, -2.0, 0.04),
    (-12.5, 4.5, 0.04),
    (-12.5, 8.5, 0.04),
    (-8.5, 6.0, 0.04),
    (-5.5, 2.5, 0.04),
    (-2.0, 0.0, 0.04),
    (2.0, 0.0, 0.04),
    (5.5, 2.5, 0.04),
    (8.5, 6.0, 0.04),
    (12.5, 9.5, 0.04),
    (14.5, 13.5, 0.28),
    (15.5, 4.0, 0.04),
    (15.5, -5.0, 0.04),
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
        "out_spline": resolved_out_dir / "transformacao_line_spline.json",
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
    """Generate `transformacao_terrain.png` (RGBA: R=plaza/trail, G=grass/border, B=water, A=height)."""
    res = max(64, int(resolution))
    min_x, max_x, min_z, max_z = (float(v) for v in bounds)
    span_x = max(1e-4, max_x - min_x)
    span_z = max(1e-4, max_z - min_z)

    deps = bpy.context.evaluated_depsgraph_get()
    bvh_terr = BVHTree.FromObject(terrain_obj, deps)
    bvh_water = BVHTree.FromObject(water_obj, deps)

    swatch_uvs = {
        name: vn_palette.get_swatch_uv(name, gltf=False)
        for name in ("nightPlum", "paperWarm", "concreteShadow", "duskRose", "waterOrigens")
    }

    def _face_swatch(mesh: bpy.types.Mesh, face_idx: int) -> str:
        if not mesh.uv_layers.active:
            return "other"
        uv_data = mesh.uv_layers.active.data
        poly = mesh.polygons[face_idx]
        u = sum(uv_data[li].uv[0] for li in poly.loop_indices) / len(poly.loop_indices)
        v = sum(uv_data[li].uv[1] for li in poly.loop_indices) / len(poly.loop_indices)
        return _classify_swatch_uv(u, v, swatch_uvs)

    rgba = np.zeros((res, res, 4), dtype=np.uint8)
    terr_mesh = terrain_obj.data
    down = Vector((0.0, 0.0, -1.0))

    for row in range(res):
        vz = min_z + ((row + 0.5) / res) * span_z
        bl_y = -vz
        for col in range(res):
            vx = min_x + ((col + 0.5) / res) * span_x
            origin = Vector((vx, bl_y, 20.0))
            hit_t, _, f_idx_t, _ = bvh_terr.ray_cast(origin, down, 40.0)
            hit_w, _, _, _ = bvh_water.ray_cast(origin, down, 40.0)

            if hit_t is not None:
                z_b = hit_t.z
                sw = _face_swatch(terr_mesh, f_idx_t)
                if sw in ("paperWarm", "concreteShadow"):
                    r, g, b = 255, 0, 0
                else:
                    r, g, b = 0, 255, 0
                a = int(np.clip((z_b + 0.5) / 4.5, 0.0, 1.0) * 255.0)
                rgba[row, col] = (r, g, b, max(1, a))
            elif hit_w is not None:
                rgba[row, col] = (0, 0, 255, 1)

    ctrl = [Vector(pt) for pt in LINE_CONTROL_POINTS_BLENDER]
    spline_pts, _ = vn_shapes._sample_spline_uniform(ctrl, step=0.25)
    xs = min_x + ((np.arange(res, dtype=np.float32) + 0.5) / res) * span_x
    zs = min_z + ((np.arange(res, dtype=np.float32) + 0.5) / res) * span_z
    grid_x, grid_z = np.meshgrid(xs, zs)
    grid_bl_y = -grid_z
    non_water = (rgba[:, :, 3] > 0) & (rgba[:, :, 2] == 0)
    trail_r2 = 1.05 ** 2
    for pt in spline_pts[::2]:
        d2 = (grid_x - pt.x) ** 2 + (grid_bl_y - pt.y) ** 2
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
    """Build the 56 x 48 m dusk plaza island, central Praça de Projetos disc, paper border & moat."""
    bm_terr = bmesh.new()
    # Main island base
    tk._add_box(bm_terr, (50.0, 42.0, 0.50), (0.0, 0.0, -0.25), "nightPlum")
    # Central Praça de Projetos stone circle
    tk._add_prism(bm_terr, 13.5, 0.06, (0.0, 2.0, 0.01), 28, "paperWarm")
    tk._add_prism(bm_terr, 5.2, 0.08, (0.0, 2.0, 0.02), 20, "concreteShadow")
    # SEBRAE west promenade
    tk._add_box(bm_terr, (13.0, 14.0, 0.06), (-14.5, 9.5, 0.01), "concreteShadow")
    # Wedding east promenade
    tk._add_box(bm_terr, (11.0, 11.0, 0.06), (13.5, 11.5, 0.01), "paperWarm")
    tk._finalize_bmesh("TransformacaoTerrainVisual", bm_terr, collection)

    bm_border = bmesh.new()
    tk._add_box(bm_border, (51.0, 43.0, 1.30), (0.0, 0.0, -0.60), "paper")
    tk._finalize_bmesh("TransformacaoPaperBorders", bm_border, collection)

    bm_water = bmesh.new()
    tk._add_box(bm_water, (70.0, 62.0, 0.16), (0.0, 0.0, -0.45), "waterOrigens")
    tk._finalize_bmesh("TransformacaoWaterBase", bm_water, collection)

    terr_phys = tk._make_physical_root("TransformacaoTerrain", "fixed", (0.0, 0.0, 0.0), collection)
    vn_collide.add_cuboid(
        "TransformacaoGround",
        (50.0, 42.0, 0.60),
        location=(0.0, 0.0, -0.30),
        parent=terr_phys,
        collection=collection,
        engine_coords=False,
    )


def build_milestones(collection: bpy.types.Collection) -> None:
    """Build the 3 Era 5 milestone blocks (`2022-01`, `2022-09-ali`, `2022-09-casamento`)."""
    specs = (
        ("TransformacaoMilestone2022_01", "2022_01", "e-2022-01", (-10.0, -7.5, 0.0)),
        ("TransformacaoMilestone2022_09_ali", "2022_09_ali", "e-2022-09-a", (-12.5, 8.5, 0.0)),
        ("TransformacaoMilestone2022_09_casamento", "2022_09_casamento", "e-2022-09-b", (12.5, 9.5, 0.0)),
    )
    for mesh_name, ref_suffix, entry_id, loc in specs:
        platform_kit.make_milestone_block(mesh_name, location=loc, collection=collection)
        phys = tk._make_physical_root(mesh_name, "fixed", loc, collection)
        vn_collide.add_cuboid(
            f"cuboidMilestone{ref_suffix}",
            (0.98, 0.98, 1.0),
            location=(0.0, 0.0, 0.5),
            parent=phys,
            collection=collection,
            engine_coords=False,
        )
        vn_refs.add_milestone(
            ref_suffix,
            location=(loc[0], loc[1], loc[2] + 0.5),
            entry_id=entry_id,
            props={"era": "transformacao"},
            collection=collection,
        )


def build_project_plaza(collection: bpy.types.Collection) -> None:
    """Arrange the 6 giant Project Cartridges + Pedestals + Projection Screens in a semicircle."""
    cx, cy = 0.0, 2.0
    radius = 9.8
    # Arc from left-south (-155 deg) around north (+90 deg) to right-south (-25 deg)
    angles_deg = (160.0, 128.0, 96.0, 64.0, 32.0, 0.0)
    for idx, (spec, ang_deg) in enumerate(zip(tl.PROJECT_SPECS, angles_deg), start=1):
        rad = math.radians(ang_deg)
        px = cx + radius * math.cos(rad)
        py = cy + radius * math.sin(rad)
        # Face inward toward plaza center (cx, cy); local front of station is -Y
        rot_z_deg = ang_deg + 90.0
        tl.build_project_station(idx, spec, (px, py, 0.0), rot_z_deg, collection)
        vn_refs.add_ref(
            f"refProject{idx:02d}",
            location=(px, py, 0.5),
            props={
                "era": "transformacao",
                "projectId": spec["id"],
                "projectIndex": idx,
                "title": spec["title"],
                "screenImage": f"projects/{spec['id']}.webp",
                "interactive": "project_cartridge",
            },
            collection=collection,
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
        name="TransformacaoLineRibbon",
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
        vn_refs.add_line_point(idx, location=pt_b, props={"era": "transformacao"}, collection=collection)
        ex, ey, ez = vn_scene.to_engine_vec(pt_b)
        ctrl_json.append([round(ex, 4), round(ey, 4), round(ez, 4)])

    samples_json = []
    for vec_b, s_val in zip(sampled_vecs, arc_s):
        ex, ey, ez = vn_scene.to_engine_vec(vec_b)
        samples_json.append({"x": round(ex, 4), "y": round(ey, 4), "z": round(ez, 4), "s": round(float(s_val), 4)})

    spline_payload = {
        "era": "transformacao",
        "totalLengthM": total_len,
        "controlPointCount": len(ctrl_json),
        "controlPoints": ctrl_json,
        "samples": samples_json,
    }
    spline_json_out.parent.mkdir(parents=True, exist_ok=True)
    spline_json_out.write_text(json.dumps(spline_payload, separators=(",", ":")), encoding="utf-8")
    return {"length": total_len, "spline_json_path": str(spline_json_out)}


def build_refs(collection: bpy.types.Collection) -> None:
    """Author spawn, pipes, secret backstage, nav graph (12), signals (20), cameras (4) & zones."""
    vn_refs.add_respawn("Transformacao", location=(-14.0, -14.0, 0.36), yaw_deg=-25.0, props={"era": "transformacao"}, collection=collection)
    vn_refs.add_respawn("", location=(-14.0, -14.0, 0.36), yaw_deg=-25.0, props={"era": "transformacao"}, collection=collection)

    vn_refs.add_ref(
        "refPipeContact",
        location=(-17.5, -13.5, 0.7),
        props={"era": "transformacao", "interactive": "shortcut_pipe", "destinationRef": "refHubArrivalTransformacao"},
        collection=collection,
    )
    vn_refs.add_ref(
        "refSecretBackstage",
        location=(15.5, -9.0, 0.3),
        props={"era": "transformacao", "interactive": "secret_backstage", "destination": "backstage"},
        collection=collection,
    )

    # 12 Navigation nodes
    nav_specs = [
        (1, "nav01_spawn", "spawn", (-14.0, -14.0, 0.36), ["refNav02"], "spawn"),
        (2, "nav02_m2022_01", "milestone2022_01", (-10.0, -7.5, 0.0), ["refNav01", "refNav03"], "e-2022-01"),
        (3, "nav03_sebrae_south", "sebrae", (-12.5, 2.0, 0.0), ["refNav02", "refNav04", "refNav05"], ""),
        (4, "nav04_m2022_09_ali", "milestone2022_09_ali", (-12.5, 8.5, 0.0), ["refNav03", "refNav05"], "e-2022-09-a"),
        (5, "nav05_plaza_west", "plaza", (-7.0, 4.0, 0.0), ["refNav03", "refNav04", "refNav06"], ""),
        (6, "nav06_plaza_center", "plaza", (0.0, 2.0, 0.0), ["refNav05", "refNav07", "refNav08"], ""),
        (7, "nav07_plaza_north", "plaza", (0.0, 9.0, 0.0), ["refNav06", "refNav08"], ""),
        (8, "nav08_plaza_east", "plaza", (7.0, 4.0, 0.0), ["refNav06", "refNav07", "refNav09"], ""),
        (9, "nav09_m2022_09_casamento", "milestone2022_09_casamento", (12.5, 9.5, 0.0), ["refNav08", "refNav10"], "e-2022-09-b"),
        (10, "nav10_wedding_arch", "wedding", (14.5, 13.5, 0.24), ["refNav09", "refNav11"], ""),
        (11, "nav11_backstage", "backstage", (15.5, -9.0, 0.3), ["refNav08", "refNav12"], ""),
        (12, "nav12_pipe", "pipeContact", (-17.5, -13.5, 0.0), ["refNav01", "refNav11"], "contato"),
    ]
    for idx, nid, role, pos, neigh, tm in nav_specs:
        vn_refs.add_nav_node(
            f"{idx:02d}",
            location=pos,
            links=neigh,
            props={"index": idx, "nodeId": nid, "role": role, "targetMilestone": tm},
            collection=collection,
        )

    # 20 collectible signals along the Praça & landmarks
    sig_pts = [
        (-13.0, -12.0, 0.9), (-11.2, -9.5, 0.9), (-11.0, -4.5, 0.9), (-12.0, 1.5, 0.9),
        (-13.8, 10.5, 0.9), (-10.0, 7.2, 0.9), (-8.5, 4.5, 0.9), (-5.2, 8.2, 0.9),
        (-2.2, 10.2, 0.9), (1.8, 10.2, 0.9), (5.2, 8.2, 0.9), (8.2, 4.5, 0.9),
        (-3.0, -1.5, 0.9), (0.0, -2.5, 0.9), (3.0, -1.5, 0.9), (11.0, 7.0, 0.9),
        (14.5, 13.5, 1.1), (15.0, 5.0, 0.9), (15.5, -4.0, 0.9), (-16.0, -13.8, 0.9),
    ]
    for idx, pos in enumerate(sig_pts, start=1):
        vn_refs.add_signal(f"{idx:02d}", location=pos, props={"era": "transformacao"}, collection=collection)

    # 4 Cameras & zones
    vn_refs.add_camera("1", location=(-12.0, -20.0, 9.5), yaw_deg=-22.0, pitch_deg=26.0, collection=collection)
    vn_refs.add_camera("2", location=(0.0, -13.0, 11.0), yaw_deg=0.0, pitch_deg=28.0, collection=collection)
    vn_refs.add_camera("3", location=(-14.0, 2.0, 10.0), yaw_deg=-35.0, pitch_deg=26.0, collection=collection)
    vn_refs.add_camera("4", location=(16.0, -4.0, 10.5), yaw_deg=35.0, pitch_deg=28.0, collection=collection)
    vn_refs.add_zone_bounding("", location=(0.0, 0.0, 0.0), radius=38.0, props={"era": "transformacao"}, collection=collection)
    vn_refs.add_ref("refZoneFrustum", location=(0.0, 0.0, 0.0), scale=(34.0, 26.0, 16.0), collection=collection)


def build_transformacao(spline_json_out: Path) -> dict[str, Any]:
    vn_scene.reset_scene("Transformacao")
    col = vn_scene.ensure_collection("TransformacaoEra")

    build_terrain_and_water(col)
    tk.build_arrival_pad("TransformacaoArrivalPad", (-14.0, -14.0, 0.0), col, rot_z_deg=-25.0)
    tk.build_shortcut_pipe("TransformacaoShortcutPipe", (-17.5, -13.5, 0.0), col)

    # SEBRAE small-business storefronts & advisory counter (west/northwest)
    tk.build_sebrae_storefront("TransformacaoSebraeShop01", (-17.5, 13.5, 0.0), col, rot_z_deg=-20.0, accent="duskCoral")
    tk.build_sebrae_storefront("TransformacaoSebraeShop02", (-11.5, 15.2, 0.0), col, rot_z_deg=8.0, accent="dataTeal")
    tk.build_sebrae_counter("TransformacaoSebraeCounter", (-15.0, 8.5, 0.0), col, rot_z_deg=-30.0)

    # Praça de Projetos: 6 Project Cartridges + Pedestals + Projection Screens
    build_project_plaza(col)

    # Wedding Fairy-Light Arch under blooming Ipê (east/northeast)
    tl.build_wedding_arch("TransformacaoWeddingArch", (14.5, 13.5, 0.0), col, rot_z_deg=35.0)

    # Backstage Room trapdoor (southeast)
    tl.build_backstage_trapdoor("TransformacaoBackstageTrapdoor", (15.5, -9.0, 0.0), col, rot_z_deg=0.0)

    # 3 Milestone blocks
    build_milestones(col)

    # Dusk plaza furniture & trees
    pole_locs = [
        (-8.5, -12.0, 0.0),
        (-16.5, 2.5, 0.0),
        (8.5, -10.5, 0.0),
        (17.5, 3.0, 0.0),
        (0.0, -6.5, 0.0),
    ]
    for idx, ploc in enumerate(pole_locs, start=1):
        tk.build_fairy_light_pole(f"TransformacaoPole{idx:02d}", ploc, col, height=3.6)

    tk.build_plaza_bench("TransformacaoBench01", (-4.5, -4.5, 0.0), col, rot_z_deg=30.0)
    tk.build_plaza_bench("TransformacaoBench02", (4.5, -4.5, 0.0), col, rot_z_deg=-30.0)

    tree_locs = [
        (-21.5, -6.0, 0.0, 5.2, "duskRose"),
        (-21.5, 16.5, 0.0, 5.6, "ipeGold"),
        (-4.0, 17.2, 0.0, 5.0, "duskRose"),
        (7.5, 17.0, 0.0, 5.4, "duskCoral"),
        (21.5, 16.0, 0.0, 5.5, "ipeGold"),
        (21.5, -13.5, 0.0, 5.1, "duskRose"),
        (4.0, -16.5, 0.0, 4.9, "duskCoral"),
        (-21.0, -16.5, 0.0, 5.0, "duskRose"),
    ]
    for idx, (tx, ty, tz, th, sw) in enumerate(tree_locs, start=1):
        tk.build_dusk_tree(f"TransformacaoTree{idx:02d}", (tx, ty, tz), col, height=th, crown_swatch=sw)

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
    terrain_obj = bpy.data.objects.get("TransformacaoTerrainVisual")
    water_obj = bpy.data.objects.get("TransformacaoWaterBase")
    if terrain_obj is None or water_obj is None:
        raise RuntimeError("Missing TransformacaoTerrainVisual or TransformacaoWaterBase")

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
        water_obj=water_obj,
        bounds=shared_bounds,
        resolution=512,
        out_png_path=out_dir / "transformacao_terrain.png",
    )

    vis_col = vn_scene.ensure_collection("TransformacaoVisualMerged")
    groups: dict[str, list[bpy.types.Object]] = {
        "TransformacaoPaperBorders": [],
        "TransformacaoWaterBase": [],
        "TransformacaoLineRibbon": [],
        "TransformacaoFoliageStatic": [],
        "TransformacaoOpaqueStatic": [],
    }
    for obj in static_visuals:
        if obj.name == "TransformacaoPaperBorders":
            groups["TransformacaoPaperBorders"].append(obj)
        elif obj.name == "TransformacaoWaterBase":
            groups["TransformacaoWaterBase"].append(obj)
        elif obj.name == "TransformacaoLineRibbon":
            groups["TransformacaoLineRibbon"].append(obj)
        elif obj.name.startswith("TransformacaoTree") or obj.name == "TransformacaoWeddingIpe":
            groups["TransformacaoFoliageStatic"].append(obj)
        else:
            groups["TransformacaoOpaqueStatic"].append(obj)

    merged_static: list[bpy.types.Object] = []
    for gname, gobjs in groups.items():
        m = _merge_objects_into_static_mesh(gname, gobjs, vis_col)
        if m is not None:
            merged_static.append(m)

    if len(merged_static) > 6:
        raise AssertionError(f"Expected <= 6 visual meshes, got {len(merged_static)}")

    opaque_obj = next((o for o in merged_static if o.name == "TransformacaoOpaqueStatic"), None)
    if opaque_obj is not None:
        vn_bake_ao.subdivide_large_faces(opaque_obj, min_area=10.0, max_cuts=2)
    ao_summary = vn_bake_ao.bake_vertex_ao(merged_static, distance=0.6, samples=64, subdivide_area=0.0)

    shadow_info = vn_bake_shadow.bake_topdown_shadow(
        objects=merged_static,
        resolution=1024,
        bounds=shared_bounds,
        out_png_path=str(out_dir / "transformacao_shadow.png"),
        out_meta_path=str(out_dir / "transformacao_shadow.json"),
    )

    vis_glb = out_dir / "transformacaoVisual.glb"
    vn_export.export_glb(str(vis_glb), objects=merged_static, export_vertex_color="ACTIVE")

    phys_objs: list[bpy.types.Object] = []
    for root in fixed_roots:
        phys_objs.append(root)
        for child in root.children:
            if _is_collider_obj(child):
                phys_objs.append(child)
    phys_glb = out_dir / "transformacaoPhysical.glb"
    vn_export.export_glb(str(phys_glb), objects=phys_objs)

    obj_export: list[bpy.types.Object] = []
    for root in dynamic_roots:
        _collect_subtree(root, obj_export)
    for io_obj in interactive_objs:
        mw = io_obj.matrix_world.copy()
        io_obj.parent = None
        io_obj.matrix_world = mw
        if io_obj not in obj_export:
            obj_export.append(io_obj)
    objs_glb = out_dir / "transformacaoObjects.glb"
    vn_export.export_glb(str(objs_glb), objects=obj_export)

    refs_glb = out_dir / "transformacaoReferences.glb"
    vn_export.export_glb(str(refs_glb), objects=ref_objs)

    vis_info = vn_export.inspect_glb(str(vis_glb))
    phys_info = vn_export.inspect_glb(str(phys_glb))
    objs_info = vn_export.inspect_glb(str(objs_glb))
    refs_info = vn_export.inspect_glb(str(refs_glb))

    if vis_info["meshes"] > 6:
        raise AssertionError(f"transformacaoVisual.glb has {vis_info['meshes']} meshes (must be <= 6)")
    has_color0 = any(
        "COLOR_0" in prim.get("attributes", {})
        for mesh in vis_info["gltf"].get("meshes", [])
        for prim in mesh.get("primitives", [])
    )
    if not has_color0:
        raise AssertionError("transformacaoVisual.glb missing COLOR_0 vertex AO")

    report = {
        "mode": "final",
        "visualMeshesCount": vis_info["meshes"],
        "visualMeshNames": [o.name for o in merged_static],
        "interactiveObjectsCount": len(interactive_objs),
        "ao": {"min": ao_summary["min_ao"], "mean": ao_summary["mean_ao"], "max": ao_summary["max_ao"]},
        "terrainMask": terrain_mask_info,
        "shadowMask": {"bytes": shadow_info["bytes"], "resolution": shadow_info["resolution"]},
        "glbs": {
            "transformacaoVisual": {"bytes": vis_info["bytes"], "meshes": vis_info["meshes"], "triangles": vis_info["triangles"]},
            "transformacaoPhysical": {"bytes": phys_info["bytes"], "nodes": phys_info["nodes"]},
            "transformacaoObjects": {"bytes": objs_info["bytes"], "meshes": objs_info["meshes"], "nodes": objs_info["nodes"]},
            "transformacaoReferences": {"bytes": refs_info["bytes"], "nodes": refs_info["nodes"]},
        },
        "refCount": len(ref_objs),
        "lineLengthM": stats["lineLengthM"],
    }
    print("TRANSFORMACAO_FINAL_OK", json.dumps(report, indent=2))
    return report


def main() -> None:
    cli = parse_cli_args()
    stats = build_transformacao(cli["out_spline"])
    assemble_and_export_final(cli["out_dir"], stats)
    if cli["render_preview"]:
        vn_scene.render_3views(
            str(cli["out_preview"]),
            target=(0.0, 2.0, 2.0),
            radius=36.0,
            size=640,
            engine_coords=False,
        )


if __name__ == "__main__":
    main()
