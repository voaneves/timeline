"""T2.A2 — Victor Character Art Direction: Colored Turnaround Sheet (Gate GA-2).

Builds the full-color reference turnaround sheet of the chosen canonical silhouette:
  - Option A ("Clássico 2.6 cabeças — D3 Padrão"):
      * Exact total height: 1.200 m, head+hair height ~0.4615 m (2.60 heads).
      * Medium build, no glasses, no beard.
      * Skin: `#c98d6a` (`skin`) with `#a86e4e` (`skinShadow`) on ears, neck, under-chin.
      * Hair: black (`hair` `#141418` / `ink` `#0a0a0a`) with signature forward-swept
        quiff (`topete para frente`).
      * Face: large oval eyes (`ink` pupils + `paper` sclera highlight), expressive
        eyebrows (`hair`), warm/neutral smile mouth (`ink`).
      * Outfit: open signal-red jacket (`signal` `#f50000`) over cream-paper t-shirt
        (`paper` `#f4ead4`) with an ink period dot (`ink` `#0a0a0a`) on the chest,
        ink/dark-denim trousers (`ink` `#0a0a0a` / `denimDark` `#1b1f2a`), cream-paper
        sneakers (`shoeWhite` / `paper` `#f4ead4`) with red laces (`signal` `#f50000`),
        and a compact ink backpack (`ink` `#0a0a0a` with `paper` `#f4ead4` zipper/tag).
      * Ribbon-scarf (`cachecol-fita`): trailing red paper ribbon-scarf (`signal` `#f50000`
        with `paper` `#f4ead4` edge/tip accent) — a piece of the Line.
      * Zero Nintendo trade dress: NO cap, NO overalls, NO mustache, NO white gloves.
      * Budget: <= 6,000 triangles across the entire character.

Directly reuses Option A's 1.200 m / 2.60-head base silhouette geometry from `silhouettes.py`
and layers flush surface detail meshes so `T2.5a` silhouette overlap deviation is naturally <= 5%.

Outputs:
  - `game/blender/out/previews/t2a2_turnaround.png` (2048x768, 4 orthographic views:
    1. FRENTE 0°, 2. 3/4 35°, 3. PERFIL 90°, 4. COSTAS 180°)
  - `game/blender/out/t2a2_turnaround.glb`
  - `game/blender/out/t2a2_turnaround.blend`
"""

from __future__ import annotations

import math
import os
import sys
import tempfile
from typing import Sequence

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
from lib import vn_bevel, vn_export, vn_palette, vn_scene, vn_shapes


# ------------------------------------------------------------------ constants

TARGET_HEIGHT_M = 1.200
TARGET_HEADS_RATIO = 2.60

BACKDROP_HEX = "#e5dec9"
PANEL_BG_HEX = "#eee7d3"
HEADER_BG_HEX = "#dfd5bc"
INK_HEX = "#0a0a0a"
PAPER_HEX = "#f4ead4"
SIGNAL_HEX = "#f50000"
GUIDE_HEX = "#7d725d"
HEAD_TICK_HEX = "#b84a39"


# -------------------------------------------- low-poly detail primitive helper


def _make_detail_box(
    name: str,
    size: tuple[float, float, float],
    location: tuple[float, float, float],
    rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel_width: float = 0.0,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a lightweight oriented detail box (12 tris when unbeveled)."""
    sx, sy, sz = float(size[0]), float(size[1]), float(size[2])
    bm = bmesh.new()
    try:
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.transform(bm, matrix=Matrix.Diagonal((sx, sy, sz, 1.0)), verts=bm.verts)
        rot = Euler(
            (
                math.radians(rotation_deg[0]),
                math.radians(rotation_deg[1]),
                math.radians(rotation_deg[2]),
            ),
            "XYZ",
        ).to_matrix().to_4x4()
        trans = Matrix.Translation(Vector(location))
        bmesh.ops.transform(bm, matrix=trans @ rot, verts=bm.verts)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    obj = bpy.data.objects.new(name, mesh)
    vn_scene.link_object(obj, collection)
    vn_shapes._ensure_mesh_uvs(obj)
    return obj


def _make_detail_disc(
    name: str,
    radii: tuple[float, float, float],
    location: tuple[float, float, float],
    rotation_deg: tuple[float, float, float] = (0.0, 0.0, 0.0),
    u_segments: int = 8,
    v_segments: int = 4,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a lightweight double-sided disc/dome (2 * u_segments tris)."""
    n_seg = max(6, int(u_segments))
    rx, ry, rz = float(radii[0]), float(radii[1]), float(radii[2])
    bm = bmesh.new()
    try:
        v_front = bm.verts.new((0.0, -ry, 0.0))
        v_back = bm.verts.new((0.0, ry * 0.25, 0.0))
        ring = []
        for i in range(n_seg):
            ang = (2.0 * math.pi * i) / n_seg
            ring.append(bm.verts.new((rx * math.cos(ang), 0.0, rz * math.sin(ang))))
        for i in range(n_seg):
            inext = (i + 1) % n_seg
            bm.faces.new((v_front, ring[i], ring[inext]))
            bm.faces.new((v_back, ring[inext], ring[i]))
        rot = Euler(
            (
                math.radians(rotation_deg[0]),
                math.radians(rotation_deg[1]),
                math.radians(rotation_deg[2]),
            ),
            "XYZ",
        ).to_matrix().to_4x4()
        trans = Matrix.Translation(Vector(location))
        bmesh.ops.transform(bm, matrix=trans @ rot, verts=bm.verts)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    obj = bpy.data.objects.new(name, mesh)
    vn_scene.link_object(obj, collection)
    vn_shapes._ensure_mesh_uvs(obj)
    return obj


def _make_curved_smile(
    name: str,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a clean 1-piece curved smile mouth strip protruding cleanly in front of the face."""
    pts = [
        (-0.028, -0.146, 0.854),
        (-0.015, -0.151, 0.848),
        (0.000, -0.153, 0.846),
        (0.015, -0.151, 0.848),
        (0.028, -0.146, 0.854),
    ]
    bm = bmesh.new()
    try:
        rx = 0.0045
        rz = 0.0040
        ry = 0.0065
        profile = [
            (0.0, -ry, rz),
            (0.0, ry, rz),
            (0.0, ry, -rz),
            (0.0, -ry, -rz),
        ]
        rings = []
        for idx, (px, py, pz) in enumerate(pts):
            t = abs(idx - 2) / 2.0
            scale_z = 1.0 - 0.25 * t
            ring = []
            for _, dy, dz in profile:
                ring.append(bm.verts.new((px, py + dy, pz + dz * scale_z)))
            rings.append(ring)

        for i in range(len(rings) - 1):
            ra, rb = rings[i], rings[i + 1]
            for k in range(4):
                kn = (k + 1) % 4
                bm.faces.new((ra[k], rb[k], rb[kn], ra[kn]))
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
    return obj


def _add_turnaround_details(collection: bpy.types.Collection) -> list[bpy.types.Object]:
    """Add flush color/facial/outfit details onto Option A's 1.20 m normalized geometry.

    All details sit inside Option A's outer silhouette envelope so the silhouette
    overlap against T2.A1 Option A and T2.5a stays within <= 1% pixel deviation,
    while keeping total character triangle count well below 6,000 tris.
    """
    detail_objs: list[bpy.types.Object] = []

    # 1. Face details: Large oval eyes (ink pupil + paper sclera & catchlight), eyebrows, smile mouth
    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        eye_x = s_sign * 0.054
        sclera = _make_detail_disc(
            f"OptA_EyeSclera_{side}",
            radii=(0.025, 0.012, 0.035),
            location=(eye_x, -0.157, 0.922),
            rotation_deg=(4.0, s_sign * 14.0, s_sign * -10.0),
            u_segments=8,
            v_segments=4,
            collection=collection,
        )
        pupil = _make_detail_disc(
            f"OptA_EyePupil_{side}",
            radii=(0.019, 0.011, 0.029),
            location=(eye_x * 0.97, -0.162, 0.922),
            rotation_deg=(4.0, s_sign * 14.0, s_sign * -10.0),
            u_segments=8,
            v_segments=4,
            collection=collection,
        )
        highlight = _make_detail_disc(
            f"OptA_EyeHighlight_{side}",
            radii=(0.0065, 0.006, 0.0085),
            location=(eye_x + s_sign * 0.005, -0.169, 0.934),
            rotation_deg=(0.0, 0.0, 0.0),
            u_segments=6,
            v_segments=3,
            collection=collection,
        )
        brow = _make_detail_box(
            f"OptA_Eyebrow_{side}",
            size=(0.050, 0.016, 0.013),
            location=(eye_x * 1.03, -0.158, 0.968),
            rotation_deg=(6.0, s_sign * -7.0, s_sign * -12.0),
            bevel_width=0.002,
            collection=collection,
        )
        detail_objs.extend([sclera, pupil, highlight, brow])

    # Single continuous warm smile mouth arc on lower face
    mouth = _make_curved_smile("OptA_MouthSmile", collection=collection)
    detail_objs.append(mouth)

    # 2. Chest period dot ("ponto de tinta no peito") on paper t-shirt + collar trim
    chest_dot = _make_detail_disc(
        "OptA_ChestInkDot",
        radii=(0.026, 0.012, 0.026),
        location=(0.0, -0.083, 0.565),
        rotation_deg=(4.0, 0.0, 0.0),
        u_segments=10,
        v_segments=4,
        collection=collection,
    )
    tee_collar = _make_detail_disc(
        "OptA_TeeCollarTrim",
        radii=(0.064, 0.056, 0.016),
        location=(0.0, -0.032, 0.656),
        rotation_deg=(14.0, 0.0, 0.0),
        u_segments=8,
        v_segments=4,
        collection=collection,
    )
    detail_objs.extend([chest_dot, tee_collar])

    # 3. Bold red sneaker laces ("cadarço vermelho") clearly protruding above the white shoe upper
    for side, sx in (("L", -0.088), ("R", 0.088)):
        yaw = -7.0 if side == "L" else 7.0
        dx_step = -0.0025 if side == "L" else 0.0025
        for l_idx, (ly, lz, lw) in enumerate(
            (
                (-0.038, 0.086, 0.058),
                (-0.062, 0.077, 0.054),
                (-0.085, 0.066, 0.050),
            )
        ):
            lace = _make_detail_box(
                f"OptA_ShoeLace_{side}_{l_idx}",
                size=(lw, 0.016, 0.015),
                location=(sx + dx_step * (l_idx + 1), ly, lz),
                rotation_deg=(20.0, 0.0, yaw),
                bevel_width=0.002,
                collection=collection,
            )
            detail_objs.append(lace)

        # Red tongue knot loop at top of laces
        lace_bow = _make_detail_box(
            f"OptA_ShoeLaceBow_{side}",
            size=(0.062, 0.020, 0.016),
            location=(sx, -0.020, 0.094),
            rotation_deg=(12.0, 0.0, yaw),
            bevel_width=0.002,
            collection=collection,
        )
        # Back heel accent tab
        heel_tab = _make_detail_box(
            f"OptA_ShoeHeelTab_{side}",
            size=(0.036, 0.018, 0.030),
            location=(sx, 0.054, 0.068),
            rotation_deg=(-6.0, 0.0, yaw),
            bevel_width=0.002,
            collection=collection,
        )
        detail_objs.extend([lace_bow, heel_tab])

    # 4. Compact ink backpack straps, paper zipper strip, and brand tag
    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        strap_back = _make_detail_box(
            f"OptA_BackpackStrapBack_{side}",
            size=(0.026, 0.018, 0.215),
            location=(s_sign * 0.084, 0.088, 0.545),
            rotation_deg=(-6.0, 0.0, s_sign * -4.0),
            bevel_width=0.002,
            collection=collection,
        )
        strap_top = _make_detail_box(
            f"OptA_BackpackStrapTop_{side}",
            size=(0.026, 0.110, 0.016),
            location=(s_sign * 0.092, 0.042, 0.660),
            rotation_deg=(-12.0, 0.0, s_sign * -8.0),
            bevel_width=0.002,
            collection=collection,
        )
        detail_objs.extend([strap_back, strap_top])

    pack_zipper = _make_detail_box(
        "OptA_BackpackZipper",
        size=(0.148, 0.012, 0.014),
        location=(0.0, 0.226, 0.548),
        rotation_deg=(-6.0, 0.0, 0.0),
        bevel_width=0.002,
        collection=collection,
    )
    pack_tag = _make_detail_box(
        "OptA_BackpackPaperTag",
        size=(0.036, 0.010, 0.022),
        location=(0.052, 0.204, 0.618),
        rotation_deg=(-6.0, 0.0, 0.0),
        bevel_width=0.002,
        collection=collection,
    )
    pack_handle = _make_detail_box(
        "OptA_BackpackHandle",
        size=(0.068, 0.024, 0.018),
        location=(0.0, 0.132, 0.676),
        rotation_deg=(-6.0, 0.0, 0.0),
        bevel_width=0.002,
        collection=collection,
    )
    detail_objs.extend([pack_zipper, pack_tag, pack_handle])

    return detail_objs


def assign_victor_palette(
    objs: Sequence[bpy.types.Object],
    pal_mat: bpy.types.Material,
) -> dict[str, list[str]]:
    """Assign exact `palette.json` swatches to every object and face of Victor Option A."""
    swatch_usage: dict[str, set[str]] = {}

    def _record(swatch: str, obj_name: str) -> str:
        swatch_usage.setdefault(swatch, set()).add(obj_name)
        return swatch

    for obj in objs:
        if obj.type != "MESH" or obj.data is None:
            continue
        name = obj.name

        # --- Head & Skin ---
        if name == "OptA_HeadCranium":
            def _cranium_sel(poly: bpy.types.MeshPolygon) -> str:
                c = poly.center
                if c.z > 0.985 or (c.y > 0.045 and c.z > 0.855):
                    return _record("hair", name)
                if c.z < 0.805:
                    return _record("skinShadow", name)
                return _record("skin", name)
            vn_palette.assign(obj, _cranium_sel, material=pal_mat)

        elif name == "OptA_HeadJaw":
            def _jaw_sel(poly: bpy.types.MeshPolygon) -> str:
                # Under-chin contact shadow gets skinShadow
                if poly.normal.z < -0.58 and poly.center.z < 0.798:
                    return _record("skinShadow", name)
                return _record("skin", name)
            vn_palette.assign(obj, _jaw_sel, material=pal_mat)

        elif name == "OptA_Nose":
            vn_palette.assign(obj, _record("skin", name), material=pal_mat)

        elif name.startswith("OptA_Ear_"):
            def _ear_sel(poly: bpy.types.MeshPolygon) -> str:
                if poly.normal.z < -0.35 or poly.normal.y < -0.55:
                    return _record("skinShadow", name)
                return _record("skin", name)
            vn_palette.assign(obj, _ear_sel, material=pal_mat)

        elif name == "OptA_Neck":
            vn_palette.assign(obj, _record("skinShadow", name), material=pal_mat)

        # --- Hair & Quiff ---
        elif name in ("OptA_HairCap", "OptA_HairNape", "OptA_HairQuiffSideCrest"):
            vn_palette.assign(obj, _record("hair", name), material=pal_mat)

        elif name == "OptA_HairQuiffMain":
            def _quiff_sel(poly: bpy.types.MeshPolygon) -> str:
                if poly.normal.z < -0.35:
                    return _record("ink", name)
                return _record("hair", name)
            vn_palette.assign(obj, _quiff_sel, material=pal_mat)

        # --- Face Details ---
        elif name.startswith("OptA_EyeSclera_") or name.startswith("OptA_EyeHighlight_"):
            vn_palette.assign(obj, _record("paper", name), material=pal_mat)

        elif name.startswith("OptA_EyePupil_"):
            vn_palette.assign(obj, _record("ink", name), material=pal_mat)

        elif name.startswith("OptA_Eyebrow_"):
            vn_palette.assign(obj, _record("hair", name), material=pal_mat)

        elif name.startswith("OptA_Mouth"):
            vn_palette.assign(obj, _record("ink", name), material=pal_mat)

        # --- Torso, T-Shirt, Chest Ink Dot, Jacket & Arms ---
        elif name == "OptA_TorsoTee":
            def _tee_sel(poly: bpy.types.MeshPolygon) -> str:
                if poly.center.z < 0.425:
                    return _record("paperWarm", name)
                return _record("paper", name)
            vn_palette.assign(obj, _tee_sel, material=pal_mat)

        elif name == "OptA_TeeCollarTrim":
            vn_palette.assign(obj, _record("paperWarm", name), material=pal_mat)

        elif name == "OptA_ChestInkDot":
            vn_palette.assign(obj, _record("ink", name), material=pal_mat)

        elif name == "OptA_Jacket":
            vn_palette.assign(obj, _record("signal", name), material=pal_mat)

        elif name.startswith("OptA_UpperArm_") or name.startswith("OptA_Forearm_"):
            vn_palette.assign(obj, _record("signal", name), material=pal_mat)

        elif name.startswith("OptA_SleeveCuff_"):
            vn_palette.assign(obj, _record("paperWarm", name), material=pal_mat)

        elif name.startswith("OptA_Hand_") or name.startswith("OptA_Thumb_"):
            def _hand_sel(poly: bpy.types.MeshPolygon) -> str:
                if poly.normal.z < -0.45:
                    return _record("skinShadow", name)
                return _record("skin", name)
            vn_palette.assign(obj, _hand_sel, material=pal_mat)

        # --- Ribbon-Scarf ("Cachecol-Fita" — signal red with paper tip/edge accent) ---
        elif name == "OptA_ScarfCollar":
            vn_palette.assign(obj, _record("signal", name), material=pal_mat)

        elif name == "OptA_ScarfTail":
            def _scarf_tail_sel(poly: bpy.types.MeshPolygon) -> str:
                c = poly.center
                if c.y > 0.345 or c.x > 0.308:
                    return _record("paper", name)
                return _record("signal", name)
            vn_palette.assign(obj, _scarf_tail_sel, material=pal_mat)

        # --- Compact Ink Backpack with Paper Zipper/Tag ---
        elif name in ("OptA_BackpackMain", "OptA_BackpackPocket", "OptA_BackpackHandle") or name.startswith("OptA_BackpackStrap"):
            vn_palette.assign(obj, _record("ink", name), material=pal_mat)

        elif name in ("OptA_BackpackZipper", "OptA_BackpackPaperTag"):
            vn_palette.assign(obj, _record("paper", name), material=pal_mat)

        # --- Trousers (Ink with DenimDark crease/cuff accent) ---
        elif name == "OptA_Pelvis" or name.startswith("OptA_Thigh_"):
            vn_palette.assign(obj, _record("ink", name), material=pal_mat)

        elif name.startswith("OptA_Shin_"):
            def _shin_sel(poly: bpy.types.MeshPolygon) -> str:
                if poly.center.z < 0.118:
                    return _record("denimDark", name)
                return _record("ink", name)
            vn_palette.assign(obj, _shin_sel, material=pal_mat)

        # --- Sneakers (Paper / ShoeWhite with Signal Red Laces & Ink Sole Tread) ---
        elif name.startswith("OptA_ShoeUpper_"):
            vn_palette.assign(obj, _record("shoeWhite", name), material=pal_mat)

        elif name.startswith("OptA_ShoeCuff_"):
            vn_palette.assign(obj, _record("paperWarm", name), material=pal_mat)

        elif name.startswith("OptA_ShoeSole_"):
            def _sole_sel(poly: bpy.types.MeshPolygon) -> str:
                if poly.center.z < 0.012:
                    return _record("ink", name)
                return _record("paper", name)
            vn_palette.assign(obj, _sole_sel, material=pal_mat)

        elif name.startswith("OptA_ShoeLace") or name.startswith("OptA_ShoeHeelTab_"):
            vn_palette.assign(obj, _record("signal", name), material=pal_mat)

        else:
            vn_palette.assign(obj, _record("paper", name), material=pal_mat)

    return {k: sorted(v) for k, v in sorted(swatch_usage.items())}


# ----------------------------------------- studio lighting & 4-view turnaround


def _create_turnaround_studio_rig(collection_name: str = "_TurnaroundStudioRig") -> dict:
    """Create balanced 360-degree diorama studio lighting + orthographic camera.

    Illuminates Front (0°), 3/4 (35°), Profile (90°), and Back (180°) evenly
    with Standard sRGB view transform so palette swatches read faithfully
    while bevels and forms stay dimensional.
    """
    col = vn_scene.ensure_collection(collection_name)

    world = bpy.data.worlds.new(f"{collection_name}_World")
    if world.node_tree is None and hasattr(world, "use_nodes"):
        world.use_nodes = True
    if world.node_tree is not None:
        bg = world.node_tree.nodes.get("Background")
        if bg is not None:
            bg.inputs["Color"].default_value = (0.94, 0.91, 0.85, 1.0)
            bg.inputs["Strength"].default_value = 0.72

    cam_data = bpy.data.cameras.new(f"{collection_name}_OrthoCam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.05
    cam_data.clip_end = 50.0
    cam_obj = bpy.data.objects.new(f"{collection_name}_OrthoCam", cam_data)
    vn_scene.link_object(cam_obj, col)

    tgt = Vector((0.0, 0.05, 0.60))
    light_specs = (
        ("FrontKey", "SUN", 2.05, (1.00, 0.98, 0.94), (-1.8, -2.6, 2.8)),
        ("RightSideKey", "SUN", 1.55, (1.00, 0.97, 0.93), (2.8, -0.6, 2.4)),
        ("BackKey", "SUN", 1.75, (0.97, 0.98, 1.00), (0.8, 2.8, 2.5)),
        ("LeftFill", "SUN", 1.15, (0.94, 0.96, 1.00), (-2.6, 1.2, 2.0)),
    )
    lights: list[bpy.types.Object] = []
    for suffix, ltype, energy, color, offset in light_specs:
        ldata = bpy.data.lights.new(f"{collection_name}_{suffix}", type=ltype)
        ldata.energy = energy
        ldata.color = color
        if hasattr(ldata, "angle"):
            ldata.angle = math.radians(15.0)
        lobj = bpy.data.objects.new(f"{collection_name}_{suffix}", ldata)
        lobj.location = tgt + Vector(offset)
        vn_scene._look_at(lobj, tgt)
        vn_scene.link_object(lobj, col)
        lights.append(lobj)

    scene = bpy.context.scene
    scene.camera = cam_obj
    scene.world = world

    return {
        "collection": col,
        "camera": cam_obj,
        "lights": lights,
        "world": world,
    }


def render_turnaround_sheet(
    out_path: str,
    metrics: dict,
    swatches_used: dict[str, list[str]],
    tile_w: int = 512,
    tile_h: int = 636,
    ortho_height_m: float = 1.46,
    z_center_m: float = 0.61,
) -> dict:
    """Render the 2048x768 4-view orthographic turnaround sheet:
      1. FRENTE (0°)
      2. 3/4 (35°)
      3. PERFIL (90°)
      4. COSTAS (180°)
    """
    scene = bpy.context.scene
    scene.render.engine = vn_scene.detect_eevee_engine(scene)
    scene.render.resolution_x = int(tile_w)
    scene.render.resolution_y = int(tile_h)
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    if hasattr(scene, "view_settings"):
        try:
            scene.view_settings.view_transform = "Standard"
            scene.view_settings.look = "None"
            scene.view_settings.exposure = 0.0
            scene.view_settings.gamma = 1.0
        except Exception:
            pass

    rig = _create_turnaround_studio_rig("_TurnaroundStudioRig")
    cam_obj = rig["camera"]
    cam_obj.data.ortho_scale = float(ortho_height_m)

    sheet_w = tile_w * 4  # 2048
    sheet_h = 768
    tile_y0 = 58  # bottom footer margin

    backdrop_srgb = (*sil._hex_to_srgb_tuple(BACKDROP_HEX), 1.0)
    panel_srgb = (*sil._hex_to_srgb_tuple(PANEL_BG_HEX), 1.0)
    header_srgb = (*sil._hex_to_srgb_tuple(HEADER_BG_HEX), 1.0)
    ink_srgb = (*sil._hex_to_srgb_tuple(INK_HEX), 1.0)
    guide_srgb = (*sil._hex_to_srgb_tuple(GUIDE_HEX), 1.0)
    head_tick_srgb = (*sil._hex_to_srgb_tuple(HEAD_TICK_HEX), 1.0)

    canvas = np.empty((sheet_h, sheet_w, 4), dtype=np.float32)
    canvas[:, :] = backdrop_srgb

    # Header bar & footer bar
    sil._draw_rect(canvas, 0, sheet_h - 74, sheet_w, sheet_h, header_srgb)
    sil._draw_rect(canvas, 0, sheet_h - 76, sheet_w, sheet_h - 74, ink_srgb)
    sil._draw_rect(canvas, 0, 0, sheet_w, tile_y0 - 2, header_srgb)
    sil._draw_rect(canvas, 0, tile_y0 - 2, sheet_w, tile_y0, ink_srgb)

    # Panel inner backgrounds
    for p_idx in range(4):
        px0 = p_idx * tile_w + 10
        px1 = (p_idx + 1) * tile_w - 10
        sil._draw_rect(canvas, px0, tile_y0 + 6, px1, tile_y0 + tile_h - 6, panel_srgb)

    # World Z -> canvas Y pixel converter inside [tile_y0, tile_y0 + tile_h]
    z_min_vis = z_center_m - ortho_height_m * 0.5

    def _z_to_y(z_val: float) -> int:
        norm = (z_val - z_min_vis) / ortho_height_m
        return int(round(tile_y0 + norm * tile_h))

    y_ground = _z_to_y(0.0)
    y_top_120 = _z_to_y(TARGET_HEIGHT_M)
    head_h = metrics["head_height_m"]
    y_head_1 = _z_to_y(TARGET_HEIGHT_M - head_h)          # 1.0 head down (chin: ~0.7385 m)
    y_head_2 = _z_to_y(TARGET_HEIGHT_M - 2.0 * head_h)    # 2.0 heads down (~0.2769 m)

    # Horizontal measurement guide lines across all 4 panels (drawn BEFORE character composite)
    sil._draw_rect(canvas, 16, y_ground - 1, sheet_w - 16, y_ground + 1, guide_srgb)
    sil._draw_dashed_hline(canvas, y_top_120, 16, sheet_w - 16, guide_srgb, dash=10, gap=6, thickness=2)
    sil._draw_dashed_hline(canvas, y_head_1, 16, sheet_w - 16, head_tick_srgb, dash=6, gap=6, thickness=1)
    sil._draw_dashed_hline(canvas, y_head_2, 16, sheet_w - 16, head_tick_srgb, dash=4, gap=8, thickness=1)

    # Title & specification banner in top header
    sil._draw_text(
        canvas,
        "T2.A2 - VICTOR COLORED TURNAROUND SHEET (OPCAO A - CLASSICO 2.6 CABECAS / 1.200 M)",
        24,
        sheet_h - 14,
        ink_srgb,
        scale=3,
    )
    sub_header = (
        f"HEIGHT:{metrics['total_height_m']:.3f}M  "
        f"HEAD:{metrics['head_height_m']:.4f}M ({metrics['head_to_body_ratio']:.2f}H)  "
        f"NO GLASSES / NO BEARD / ZERO TRADE DRESS"
    )
    sil._draw_text(
        canvas,
        sub_header,
        24,
        sheet_h - 46,
        guide_srgb,
        scale=2,
    )

    # Palette swatch key chips in top-right header
    swatch_badges = (
        ("SKIN", "skin"),
        ("HAIR", "hair"),
        ("SIGNAL", "signal"),
        ("PAPER", "paper"),
        ("INK", "ink"),
        ("DENIM", "denimDark"),
    )
    badge_x = sheet_w - 640
    for b_label, sw_name in swatch_badges:
        sw_hex = vn_palette.get_swatch(sw_name)["hex"]
        sw_rgba = (*sil._hex_to_srgb_tuple(sw_hex), 1.0)
        sil._draw_rect(canvas, badge_x, sheet_h - 62, badge_x + 22, sheet_h - 40, ink_srgb)
        sil._draw_rect(canvas, badge_x + 2, sheet_h - 60, badge_x + 20, sheet_h - 42, sw_rgba)
        sil._draw_text(canvas, b_label, badge_x + 26, sheet_h - 44, ink_srgb, scale=2)
        badge_x += 104

    # 4 orthographic camera views around Victor (facing -Y at 0 deg)
    dist = 3.5
    ang_34 = math.radians(35.0)
    views = (
        (
            "1. FRENTE (0 DEG)",
            Vector((0.0, 0.0, z_center_m)) + Vector((0.0, -dist, 0.0)),
            Vector((0.0, 0.0, z_center_m)),
        ),
        (
            "2. 3/4 (35 DEG)",
            Vector((0.02, 0.05, z_center_m)) + Vector((dist * math.sin(ang_34), -dist * math.cos(ang_34), 0.0)),
            Vector((0.02, 0.05, z_center_m)),
        ),
        (
            "3. PERFIL (90 DEG)",
            Vector((0.0, 0.06, z_center_m)) + Vector((dist, 0.0, 0.0)),
            Vector((0.0, 0.06, z_center_m)),
        ),
        (
            "4. COSTAS (180 DEG)",
            Vector((0.0, 0.0, z_center_m)) + Vector((0.0, dist, 0.0)),
            Vector((0.0, 0.0, z_center_m)),
        ),
    )

    try:
        with tempfile.TemporaryDirectory(prefix="vn_t2a2_") as tmpdir:
            for v_idx, (v_label, cam_pos, v_tgt) in enumerate(views):
                cam_obj.location = cam_pos
                vn_scene._look_at(cam_obj, v_tgt)

                tile_path = os.path.join(tmpdir, f"view_{v_idx}.png")
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

                tx0 = v_idx * tile_w
                tx1 = tx0 + tile_w
                ty0 = tile_y0
                ty1 = ty0 + tile_h

                # Alpha-composite rendered character over panel background
                alpha = np.clip(tile_rgba[:, :, 3:4], 0.0, 1.0)
                fg_rgb = tile_rgba[:, :, :3]
                bg_region = canvas[ty0:ty1, tx0:tx1, :3]
                canvas[ty0:ty1, tx0:tx1, :3] = bg_region * (1.0 - alpha) + fg_rgb * alpha
                canvas[ty0:ty1, tx0:tx1, 3] = 1.0

                # Panel separator line
                if v_idx > 0:
                    sil._draw_rect(canvas, tx0 - 1, tile_y0, tx0 + 1, sheet_h - 76, guide_srgb)

                # View title in bottom footer
                label_w = len(v_label) * 12
                lx = tx0 + (tile_w - label_w) // 2
                sil._draw_text(canvas, v_label, lx, 38, ink_srgb, scale=2)

                # Left-side ruler labels in each panel
                sil._draw_text(canvas, "1.20M", tx0 + 16, y_top_120 + 18, guide_srgb, scale=2)
                sil._draw_text(canvas, "1.0H", tx0 + 16, y_head_1 + 18, head_tick_srgb, scale=2)
                sil._draw_text(canvas, "2.0H", tx0 + 16, y_head_2 + 18, head_tick_srgb, scale=2)
                sil._draw_text(canvas, "0.00M", tx0 + 16, y_ground + 18, guide_srgb, scale=2)
    finally:
        vn_scene._remove_preview_rig(rig)

    abs_out = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(abs_out), exist_ok=True)

    out_img = bpy.data.images.new("_t2a2_turnaround_sheet", width=sheet_w, height=sheet_h, alpha=True)
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
    vn_scene.reset_scene("T2A2_VictorTurnaround")

    col_victor = vn_scene.ensure_collection("Victor_Turnaround_OptionA_2_6H")

    # Build canonical Option A (1.200 m, 2.60 heads) centered at world origin (0, 0, 0)
    base_objs, base_metrics = sil.build_option_a(col_victor, x_offset=0.0)
    detail_objs = _add_turnaround_details(col_victor)
    all_objs = base_objs + detail_objs

    # Bind master palette material (`palette.png` / `palette.json`) across all meshes
    pal_mat = vn_palette.ensure_palette_material(name="palette", roughness=0.85)
    swatches_used = assign_victor_palette(all_objs, pal_mat)

    # Verify exact height & head ratio after adding flush details
    final_mins, final_maxs = sil.compute_collection_bounds(all_objs)
    total_h = float(final_maxs.z - final_mins.z)
    metrics = {
        **base_metrics,
        "total_height_m": total_h,
        "min_z_m": float(final_mins.z),
        "max_z_m": float(final_maxs.z),
        "width_x_m": float(final_maxs.x - final_mins.x),
        "depth_y_m": float(final_maxs.y - final_mins.y),
    }

    stats = vn_scene.scene_stats(all_objs)

    out_dir = os.path.join(BLENDER_ROOT, "out")
    previews_dir = os.path.join(out_dir, "previews")
    os.makedirs(previews_dir, exist_ok=True)

    preview_path = os.path.join(previews_dir, "t2a2_turnaround.png")
    glb_path = os.path.join(out_dir, "t2a2_turnaround.glb")
    blend_path = os.path.join(out_dir, "t2a2_turnaround.blend")

    sheet_info = render_turnaround_sheet(
        out_path=preview_path,
        metrics=metrics,
        swatches_used=swatches_used,
    )

    glb_stats = vn_export.export_glb(
        filepath=glb_path,
        collections=[col_victor],
        apply_modifiers=True,
        export_extras=True,
        mute_palette_textures=True,
    )
    saved_blend = vn_export.save_blend(blend_path, pack=True)

    assert abs(metrics["total_height_m"] - TARGET_HEIGHT_M) <= 0.005, (
        f"Total height out of 1.200 m tolerance: {metrics['total_height_m']:.4f} m"
    )
    assert abs(metrics["head_to_body_ratio"] - TARGET_HEADS_RATIO) <= 0.02, (
        f"Head ratio out of 2.60 tolerance: {metrics['head_to_body_ratio']:.3f}"
    )
    assert stats["triangles"] <= 6000, (
        f"Triangle count exceeds 6000 budget: {stats['triangles']}"
    )

    print("=" * 80)
    print("[T2.A2] Victor Colored Turnaround Sheet Report (Option A — 2.6H / D3 Padrao)")
    print("-" * 80)
    print(
        f"  Height      : {metrics['total_height_m']:.4f} m "
        f"(z: {metrics['min_z_m']:.4f} -> {metrics['max_z_m']:.4f} m)"
    )
    print(
        f"  Head+Hair   : {metrics['head_height_m']:.4f} m "
        f"(chin z={metrics['chin_z_m']:.4f} m -> crown z={metrics['crown_z_m']:.4f} m)"
    )
    print(f"  Head Ratio  : {metrics['head_to_body_ratio']:.2f} heads")
    print(f"  Dimensions  : W={metrics['width_x_m']:.4f} m x D={metrics['depth_y_m']:.4f} m x H={metrics['total_height_m']:.4f} m")
    print(f"  Mesh Stats  : {stats['meshes']} meshes | {stats['triangles']} tris | {stats['materials']} material ({stats['materialNames']})")
    print(f"  Swatches    : {len(swatches_used)} palette swatches -> {', '.join(sorted(swatches_used.keys()))}")
    for sw_name, obj_list in swatches_used.items():
        sw_meta = vn_palette.get_swatch(sw_name)
        print(f"    - {sw_name:12s} ({sw_meta['hex']}): {len(obj_list)} mesh(es)")
    print("-" * 80)
    print(f"  Preview PNG : {sheet_info['filepath']} ({sheet_info['width']}x{sheet_info['height']})")
    print(f"  Exported GLB: {glb_stats['filepath']} ({glb_stats['bytes']} B, {glb_stats['triangles']} tris)")
    print(f"  Saved BLEND : {saved_blend}")
    print("=" * 80)

    return {
        "preview": sheet_info,
        "glb": glb_stats,
        "blend": saved_blend,
        "metrics": metrics,
        "stats": stats,
        "swatches": swatches_used,
    }


if __name__ == "__main__":
    build_all()
