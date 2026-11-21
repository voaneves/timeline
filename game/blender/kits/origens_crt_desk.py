"""Origens O5 Hero Landmark procedural generator: Giant CRT + Desk, Chair & Keyboard (T2.13b).

Models the Era 1 "Origens" O5 milestone landmark (Marco 2005: "Fiz o meu primeiro blog,
Ponto Interativo") as a readable 3-step platforming climb with a separate `screen` mesh:
  - Step 1 — `OrigensCrtChair` (seat top ~0.95 m, backrest ~1.50 m): chunky wooden & iron
    office/study chair (`woodDark`, `wood`, `ink`, `laterite` cushion) positioned to the
    front-left of the desk so Victor (jump apex 2.0 m) easily hops onto the chair seat and
    up onto the desk surface.
  - Step 2 — `OrigensCrtDesk` (desk surface ~1.65 m) + `OrigensCrtKeyboard` (top ~1.85 m):
    sturdy wooden computer desk (`wood` #9a6840, `woodDark` #734a2b, `ink` hardware,
    `paper` notepad & coaster) supporting an oversized retro beige mechanical keyboard
    (`crtBeige` #ded6c3 chassis, `paper` / `paperShadow` keycap banks, `ink` spacebar,
    bold red `signal` #f50000 Enter & Esc keycaps) and a chunky 2-button retro mouse that
    act as broad platforming surfaces in front of the monitor.
  - Step 3 — `OrigensCrtMonitor` (~3.0 m tall housing above desk, total height ~4.65 m) +
    `OrigensCrtPowerButton` (stampable power button on lower-front bezel pedestal ledge,
    top ~2.08 m): classic deep-backed 2005 CRT monitor (`crtBeige` body, `paperShadow`
    vented rear flyback humps, `ink` screen bezel recess, green LED indicator) with a
    prominent red-ringed `signal` + `paper`/`ink` power button positioned right behind the
    keyboard so Victor can jump and Stamp (`Carimbar`) the button (`T2.19b`).
  - MANDATORY Separate Mesh `screen` (`T2.13b` acceptance criterion): a distinct mesh
    object named exact `"screen"` (mesh datablock `"screen"`) covering the 4:3 CRT glass
    face, binding the shared `"palette"` material (default swatch `crtScreen` #1e2b24 on
    its rear perimeter border and clean planar `[0..1] x [0..1]` UVs across the front 4:3
    glass grid) so `T2.19b` can swap or bind the 256x192 pixelated "Ponto Interativo" blog
    texture onto `screen` at runtime when the power button is stamped.

All visual meshes share the single `"palette"` material, stay within the §5.4 landmark
budget (`1,500 <= tris <= 6,000`), include walkable `cuboid*` colliders via `vn_collide`,
support `vn_manual.apply_manual_overrides("origens_crt_desk")`, export to
`game/blender/out/origens_crt_desk.glb`, and render 3 verification views to
`game/blender/out/previews/t213b_crt_desk.png`.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

BLENDER_DIR = Path(__file__).resolve().parent.parent
if str(BLENDER_DIR) not in sys.path:
    sys.path.insert(0, str(BLENDER_DIR))

from lib import (  # noqa: E402
    vn_bevel,
    vn_collide,
    vn_export,
    vn_manual,
    vn_palette,
    vn_scene,
)

OUT_DIR = BLENDER_DIR / "out"
PREVIEWS_DIR = OUT_DIR / "previews"
GLB_OUT_PATH = OUT_DIR / "origens_crt_desk.glb"
PREVIEW_OUT_PATH = PREVIEWS_DIR / "t213b_crt_desk.png"

LANDMARK_TRI_MIN = 1500
LANDMARK_TRI_MAX = 6000

# Key platforming heights in meters above landmark base (z=0.0)
CHAIR_SEAT_TOP_Z = 0.95
CHAIR_BACK_TOP_Z = 1.52
DESK_TOP_Z = 1.65
KEYBOARD_TOP_Z = 1.85
POWER_BUTTON_TOP_Z = 2.08
MONITOR_TOP_Z = 4.65


# ------------------------------------------------------------------ bmesh helpers


def _assign_uv_to_faces(
    bm: bmesh.types.BMesh,
    faces: list[bmesh.types.BMFace],
    swatch_name: str,
) -> None:
    """Assign exact center UVs of `swatch_name` to every loop of `faces`."""
    uv_layer = bm.loops.layers.uv.verify()
    u, v = vn_palette.get_swatch_uv(swatch_name, gltf=False)
    for face in faces:
        for loop in face.loops:
            loop[uv_layer].uv = (u, v)


def _add_prism_to_bmesh(
    bm: bmesh.types.BMesh,
    size: tuple[float, float, float],
    center: tuple[float, float, float],
    swatch_name: str,
    rotation_euler: tuple[float, float, float] | None = None,
    subdiv_cuts: int = 0,
) -> list[bmesh.types.BMFace]:
    """Create a box in `bm`, optionally subdivide, transform, and tag its faces with `swatch_name`."""
    ret = bmesh.ops.create_cube(bm, size=1.0)
    verts = ret["verts"]
    vert_set = set(verts)

    if subdiv_cuts > 0:
        edges = [e for e in bm.edges if all(v in vert_set for v in e.verts)]
        sub_ret = bmesh.ops.subdivide_edges(
            bm,
            edges=edges,
            cuts=int(subdiv_cuts),
            use_grid_fill=True,
        )
        for item in sub_ret.get("geom", []):
            if isinstance(item, bmesh.types.BMVert):
                vert_set.add(item)

    sx, sy, sz = (float(v) for v in size)
    mat = Matrix.Diagonal((sx, sy, sz, 1.0))
    if rotation_euler is not None:
        rot_mat = Euler(tuple(float(a) for a in rotation_euler), "XYZ").to_matrix().to_4x4()
        mat = rot_mat @ mat

    bmesh.ops.transform(bm, matrix=mat, verts=list(vert_set))
    bmesh.ops.translate(
        bm,
        vec=Vector(tuple(float(c) for c in center)),
        verts=list(vert_set),
    )

    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
    _assign_uv_to_faces(bm, faces, swatch_name)
    return faces


def _add_ngon_cylinder_to_bmesh(
    bm: bmesh.types.BMesh,
    radius_bottom: float,
    radius_top: float,
    height: float,
    segments: int,
    center: tuple[float, float, float],
    swatch_name: str,
    rotation_euler: tuple[float, float, float] | None = None,
    cap_ends: bool = True,
) -> list[bmesh.types.BMFace]:
    """Create a closed polygonal prism/frustum in `bm` and assign `swatch_name` UVs."""
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=cap_ends,
        cap_tris=False,
        segments=int(segments),
        radius1=float(radius_bottom),
        radius2=float(radius_top),
        depth=float(height),
    )
    verts = ret["verts"]
    vert_set = set(verts)

    if rotation_euler is not None:
        rot_mat = Euler(tuple(float(a) for a in rotation_euler), "XYZ").to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=rot_mat, verts=verts)

    bmesh.ops.translate(
        bm,
        vec=Vector(tuple(float(c) for c in center)),
        verts=verts,
    )

    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
    _assign_uv_to_faces(bm, faces, swatch_name)
    return faces


def _add_lofted_sections_to_bmesh(
    bm: bmesh.types.BMesh,
    sections: list[tuple[float, float, float, float, float]],
    section_swatches: list[str],
    cap_front_swatch: str | None = "crtBeige",
    cap_back_swatch: str | None = "paperShadow",
) -> list[bmesh.types.BMFace]:
    """Loft a series of rectangular cross-sections `(y, cx, cz, width_x, height_z)` along Y."""
    uv_layer = bm.loops.layers.uv.verify()
    rings: list[tuple[bmesh.types.BMVert, ...]] = []
    for y_pos, cx, cz, wx, hz in sections:
        hx = wx * 0.5
        hz_half = hz * 0.5
        bl = bm.verts.new((cx - hx, y_pos, cz - hz_half))
        br = bm.verts.new((cx + hx, y_pos, cz - hz_half))
        tr = bm.verts.new((cx + hx, y_pos, cz + hz_half))
        tl = bm.verts.new((cx - hx, y_pos, cz + hz_half))
        rings.append((bl, br, tr, tl))

    created_faces: list[bmesh.types.BMFace] = []
    for idx in range(len(rings) - 1):
        bl0, br0, tr0, tl0 = rings[idx]
        bl1, br1, tr1, tl1 = rings[idx + 1]
        sw = section_swatches[min(idx, len(section_swatches) - 1)]
        u, v = vn_palette.get_swatch_uv(sw, gltf=False)

        side_quads = (
            (bl0, bl1, br1, br0),  # bottom
            (br0, br1, tr1, tr0),  # right (+X)
            (tr0, tr1, tl1, tl0),  # top
            (tl0, tl1, bl1, bl0),  # left (-X)
        )
        for quad in side_quads:
            f = bm.faces.new(quad)
            for loop in f.loops:
                loop[uv_layer].uv = (u, v)
            created_faces.append(f)

    if cap_front_swatch is not None:
        bl0, br0, tr0, tl0 = rings[0]
        f_front = bm.faces.new((bl0, br0, tr0, tl0))
        u, v = vn_palette.get_swatch_uv(cap_front_swatch, gltf=False)
        for loop in f_front.loops:
            loop[uv_layer].uv = (u, v)
        created_faces.append(f_front)

    if cap_back_swatch is not None:
        bln, brn, trn, tln = rings[-1]
        f_back = bm.faces.new((tln, trn, brn, bln))
        u, v = vn_palette.get_swatch_uv(cap_back_swatch, gltf=False)
        for loop in f_back.loops:
            loop[uv_layer].uv = (u, v)
        created_faces.append(f_back)

    return created_faces


def _finalize_bmesh_object(
    bm: bmesh.types.BMesh,
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection | str | None,
    bevel_width: float = 0.02,
    bevel_segments: int = 1,
    angle_deg: float = 35.0,
) -> bpy.types.Object:
    """Convert `bm` to a mesh object, bind the shared palette material, and apply toy bevels."""
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

    if bevel_segments > 0 and bevel_width > 0.0:
        vn_bevel.apply_bevel(
            obj,
            width=bevel_width,
            segments=bevel_segments,
            limit_method="ANGLE",
            angle_deg=angle_deg,
            clamp_overlap=True,
            apply=True,
        )
    vn_bevel.apply_weighted_normals(
        obj,
        weight=50,
        keep_sharp=True,
        face_influence=True,
        apply=True,
    )
    return obj


# ------------------------------------------------ Step 1: Climbable Chair


def make_crt_chair(
    name: str = "OrigensCrtChair",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the climbable Step 1 Chair (`OrigensCrtChair`, seat top = 0.95 m).

    Positioned in front-left of the desk (`x=-1.65, y=-2.05`) and angled slightly
    toward the desk so Victor can jump from ground (z=0.0) -> chair seat (z=0.95 m) ->
    desk surface (z=1.65 m).
    """
    bm = bmesh.new()

    cx, cy = -1.65, -2.05
    yaw = math.radians(16.0)
    cos_y, sin_y = math.cos(yaw), math.sin(yaw)

    def _chair_pt(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
        rx = lx * cos_y - ly * sin_y
        ry = lx * sin_y + ly * cos_y
        return (cx + rx, cy + ry, lz)

    # 1. Four sturdy wooden legs (`woodDark`) with `ink` rubber feet and cross-stretchers
    leg_offsets = (
        (-0.52, -0.50),
        (0.52, -0.50),
        (-0.52, 0.50),
        (0.52, 0.50),
    )
    for lx, ly in leg_offsets:
        # Rubber foot pad (`ink`, z=0.0..0.08)
        _add_prism_to_bmesh(
            bm,
            size=(0.17, 0.17, 0.08),
            center=_chair_pt(lx, ly, 0.04),
            swatch_name="ink",
            rotation_euler=(0.0, 0.0, yaw),
        )
        # Main wooden leg (`woodDark`, z=0.08..0.80)
        _add_prism_to_bmesh(
            bm,
            size=(0.14, 0.14, 0.72),
            center=_chair_pt(lx, ly, 0.44),
            swatch_name="woodDark",
            rotation_euler=(0.0, 0.0, yaw),
        )

    # Lower horizontal H-stretchers (`woodDark` & `ink` dowels)
    for ly in (-0.50, 0.50):
        _add_prism_to_bmesh(
            bm,
            size=(0.94, 0.09, 0.09),
            center=_chair_pt(0.0, ly, 0.28),
            swatch_name="woodDark",
            rotation_euler=(0.0, 0.0, yaw),
        )
    for lx in (-0.52, 0.52):
        _add_prism_to_bmesh(
            bm,
            size=(0.09, 0.90, 0.09),
            center=_chair_pt(lx, 0.0, 0.36),
            swatch_name="wood",
            rotation_euler=(0.0, 0.0, yaw),
        )

    # 2. Seat apron frame (`wood`, z=0.76..0.87) and chunky padded seat cushion
    # (`laterite` / `brick`, top surface at exact z=0.95 m for Step 1 platforming!)
    _add_prism_to_bmesh(
        bm,
        size=(1.24, 1.20, 0.11),
        center=_chair_pt(0.0, 0.0, 0.815),
        swatch_name="wood",
        rotation_euler=(0.0, 0.0, yaw),
    )
    _add_prism_to_bmesh(
        bm,
        size=(1.18, 1.14, 0.08),
        center=_chair_pt(0.0, 0.0, 0.91),
        swatch_name="laterite",
        rotation_euler=(0.0, 0.0, yaw),
    )
    # Front cushion Piping / seam band (`paperWarm`) for clear visual step edge reading
    _add_prism_to_bmesh(
        bm,
        size=(1.12, 0.10, 0.045),
        center=_chair_pt(0.0, 0.54, 0.925),
        swatch_name="paperWarm",
        rotation_euler=(0.0, 0.0, yaw),
    )

    # 3. Backrest uprights (`woodDark`) and curved/slatted backrest (`wood` + `laterite` pad)
    # placed at the outer (-Y local) edge of the chair so the path toward the desk (+Y) is open.
    for lx in (-0.48, 0.48):
        _add_prism_to_bmesh(
            bm,
            size=(0.12, 0.12, 0.62),
            center=_chair_pt(lx, -0.52, 1.21),
            swatch_name="woodDark",
            rotation_euler=(0.0, 0.0, yaw),
        )
    # Lower and upper wooden backrest rails (`wood`)
    _add_prism_to_bmesh(
        bm,
        size=(1.14, 0.10, 0.12),
        center=_chair_pt(0.0, -0.52, 1.16),
        swatch_name="wood",
        rotation_euler=(0.0, 0.0, yaw),
    )
    _add_prism_to_bmesh(
        bm,
        size=(1.18, 0.13, 0.18),
        center=_chair_pt(0.0, -0.52, 1.43),
        swatch_name="wood",
        rotation_euler=(0.0, 0.0, yaw),
    )
    # Upholstered backrest pad (`laterite`) and `ink` bracket rivets
    _add_prism_to_bmesh(
        bm,
        size=(0.88, 0.08, 0.24),
        center=_chair_pt(0.0, -0.47, 1.32),
        swatch_name="laterite",
        rotation_euler=(0.0, 0.0, yaw),
    )
    for lx in (-0.48, 0.48):
        _add_prism_to_bmesh(
            bm,
            size=(0.06, 0.15, 0.06),
            center=_chair_pt(lx, -0.52, 1.43),
            swatch_name="ink",
            rotation_euler=(0.0, 0.0, yaw),
        )

    obj = _finalize_bmesh_object(
        bm,
        name=name,
        location=location,
        collection=collection,
        bevel_width=0.016,
        bevel_segments=1,
        angle_deg=35.0,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "landmarkPart": "chair_step1",
            "stepHeight": CHAIR_SEAT_TOP_Z,
        },
    )
    return obj


# ------------------------------------------------ Step 2A: Wooden Desk


def make_crt_desk(
    name: str = "OrigensCrtDesk",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the sturdy 2000s wooden computer desk (`OrigensCrtDesk`, top = 1.65 m).

    Features:
      - Broad 4.80 m x 3.20 m wooden tabletop (`wood` #9a6840 with `woodDark` #734a2b
        edge banding) whose top sits at exact `z = 1.65 m`.
      - Four thick timber legs (`woodDark`) with `ink` leveling feet, side stretchers,
        and a right-hand drawer pedestal (`wood` drawers, `paper` label cards, `ink` pulls).
      - Era-authentic 2005 desk props on the left wing (coaster + copper mug + paper
        "Ponto Interativo" draft notebook with red `signal` bookmark ribbon) leaving the
        front-left climb zone and center keyboard platform completely unobstructed.
    """
    bm = bmesh.new()

    # 1. Main tabletop slab (`wood`, z=1.49..1.65 -> top surface at exact z=1.65 m)
    _add_prism_to_bmesh(
        bm,
        size=(4.80, 3.20, 0.16),
        center=(0.0, 0.0, 1.57),
        swatch_name="wood",
    )
    # Dark wood under-apron frame (`woodDark`, z=1.34..1.49)
    _add_prism_to_bmesh(
        bm,
        size=(4.52, 2.92, 0.15),
        center=(0.0, 0.0, 1.415),
        swatch_name="woodDark",
    )
    # Front edge inlay trim strip (`woodDark`) for crisp visual height reading
    _add_prism_to_bmesh(
        bm,
        size=(4.82, 0.06, 0.06),
        center=(0.0, -1.59, 1.57),
        swatch_name="woodDark",
    )

    # 2. Four heavy timber legs (`woodDark`, z=0.08..1.49) + `ink` floor glides (z=0.0..0.08)
    leg_positions = (
        (-2.12, -1.34),
        (2.12, -1.34),
        (-2.12, 1.34),
        (2.12, 1.34),
    )
    for lx, ly in leg_positions:
        _add_prism_to_bmesh(
            bm,
            size=(0.30, 0.30, 0.08),
            center=(lx, ly, 0.04),
            swatch_name="ink",
        )
        _add_prism_to_bmesh(
            bm,
            size=(0.24, 0.24, 1.41),
            center=(lx, ly, 0.785),
            swatch_name="woodDark",
        )

    # Left side & rear structural stretchers (`woodDark`)
    _add_prism_to_bmesh(
        bm,
        size=(0.14, 2.46, 0.14),
        center=(-2.12, 0.0, 0.34),
        swatch_name="woodDark",
    )
    _add_prism_to_bmesh(
        bm,
        size=(4.04, 0.14, 0.18),
        center=(0.0, 1.34, 0.42),
        swatch_name="woodDark",
    )
    # Modesty panel at back of knee-hole (`wood`)
    _add_prism_to_bmesh(
        bm,
        size=(2.60, 0.10, 0.72),
        center=(-0.65, 1.26, 1.04),
        swatch_name="wood",
    )

    # 3. Right-hand 3-drawer cabinet pedestal (x = 0.85..2.05, z = 0.28..1.38)
    _add_prism_to_bmesh(
        bm,
        size=(1.18, 2.46, 1.10),
        center=(1.44, 0.0, 0.83),
        swatch_name="woodDark",
    )
    drawer_z_centers = (0.48, 0.83, 1.16)
    for dz in drawer_z_centers:
        # Drawer front face (`wood`)
        _add_prism_to_bmesh(
            bm,
            size=(1.06, 0.08, 0.27),
            center=(1.44, -1.24, dz),
            swatch_name="wood",
        )
        # Drawer handle pull (`ink`)
        _add_prism_to_bmesh(
            bm,
            size=(0.32, 0.07, 0.06),
            center=(1.44, -1.29, dz - 0.02),
            swatch_name="ink",
        )
        # Small index label holder (`paper`)
        _add_prism_to_bmesh(
            bm,
            size=(0.22, 0.05, 0.06),
            center=(1.44, -1.28, dz + 0.06),
            swatch_name="paper",
        )

    # 4. Left-rear desk details: "Ponto Interativo" blog sketchpad (`paper` + `ink` + `signal`)
    # placed at x=-1.78, y=-0.15 so the front-left corner (`x=-1.65, y=-1.35`) is wide open for climbing.
    pad_yaw = math.radians(-14.0)
    _add_prism_to_bmesh(
        bm,
        size=(0.64, 0.82, 0.06),
        center=(-1.78, -0.10, 1.68),
        swatch_name="ink",
        rotation_euler=(0.0, 0.0, pad_yaw),
    )
    _add_prism_to_bmesh(
        bm,
        size=(0.58, 0.76, 0.06),
        center=(-1.76, -0.10, 1.72),
        swatch_name="paper",
        rotation_euler=(0.0, 0.0, pad_yaw),
    )
    # Red `signal` bookmark ribbon tail sticking out of the notebook
    _add_prism_to_bmesh(
        bm,
        size=(0.10, 0.24, 0.055),
        center=(-1.72, -0.52, 1.685),
        swatch_name="signal",
        rotation_euler=(0.0, 0.0, pad_yaw),
    )

    obj = _finalize_bmesh_object(
        bm,
        name=name,
        location=location,
        collection=collection,
        bevel_width=0.014,
        bevel_segments=1,
        angle_deg=35.0,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "landmarkPart": "desk_step2a",
            "stepHeight": DESK_TOP_Z,
        },
    )
    return obj


# ----------------------------------------- Step 2B: Giant Mechanical Keyboard


def make_crt_keyboard(
    name: str = "OrigensCrtKeyboard",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the oversized retro mechanical keyboard & mouse (`OrigensCrtKeyboard`, top ~1.85 m).

    Acts as the broad Step 2B platform on the front-center of the desk (`y = -1.48..-0.52`,
    `z = 1.65..1.86 m`) directly in front of the CRT Power Button so Victor can stand on
    the keycaps and jump/Stamp onto the Power Button (`z = 2.08 m`).
    """
    bm = bmesh.new()

    kb_cx = -0.18
    kb_cy = -1.02

    # 1. Chunky retro beige keyboard chassis (`crtBeige` #ded6c3, z=1.65..1.79)
    _add_prism_to_bmesh(
        bm,
        size=(2.24, 0.96, 0.14),
        center=(kb_cx, kb_cy, 1.72),
        swatch_name="crtBeige",
    )
    # Front wrist-rest bevel lip (`paperShadow`)
    _add_prism_to_bmesh(
        bm,
        size=(2.20, 0.16, 0.09),
        center=(kb_cx, kb_cy - 0.44, 1.695),
        swatch_name="paperShadow",
    )
    # Recessed dark key-well plate (`ink`, z=1.78..1.805)
    _add_prism_to_bmesh(
        bm,
        size=(2.06, 0.72, 0.03),
        center=(kb_cx, kb_cy + 0.03, 1.795),
        swatch_name="ink",
    )

    # 2. Chunky raised mechanical keycap islands (top at z = 1.85..1.86 m)
    # Top row: Esc key (`signal` red!) + 3 function key banks (`paper` & `paperShadow`)
    _add_prism_to_bmesh(
        bm,
        size=(0.18, 0.12, 0.065),
        center=(kb_cx - 0.90, kb_cy + 0.28, 1.825),
        swatch_name="signal",
    )
    func_banks = (
        (kb_cx - 0.52, 0.42, "paper"),
        (kb_cx - 0.02, 0.42, "paperShadow"),
        (kb_cx + 0.46, 0.38, "paper"),
    )
    for fx, fw, fsw in func_banks:
        _add_prism_to_bmesh(
            bm,
            size=(fw, 0.12, 0.06),
            center=(fx, kb_cy + 0.28, 1.822),
            swatch_name=fsw,
        )

    # Status LEDs in top-right corner (`signal` & `ipeGold` & `ink`)
    _add_prism_to_bmesh(
        bm,
        size=(0.24, 0.09, 0.025),
        center=(kb_cx + 0.86, kb_cy + 0.29, 1.80),
        swatch_name="ink",
    )
    _add_prism_to_bmesh(
        bm,
        size=(0.05, 0.04, 0.035),
        center=(kb_cx + 0.80, kb_cy + 0.29, 1.805),
        swatch_name="ipeGold",
    )
    _add_prism_to_bmesh(
        bm,
        size=(0.05, 0.04, 0.035),
        center=(kb_cx + 0.90, kb_cy + 0.29, 1.805),
        swatch_name="signal",
    )

    # Main alphanumeric key rows (3 chunky tactile rows of keycap blocks)
    row_specs = (
        (kb_cy + 0.11, 1.18, "paper"),
        (kb_cy - 0.04, 1.16, "paperWarm"),
        (kb_cy - 0.18, 1.14, "paper"),
    )
    for ry, rw, rsw in row_specs:
        # Left modifier key (`paperShadow`)
        _add_prism_to_bmesh(
            bm,
            size=(0.20, 0.12, 0.06),
            center=(kb_cx - 0.89, ry, 1.825),
            swatch_name="paperShadow",
        )
        # Main typing block (`paper` / `paperWarm`)
        _add_prism_to_bmesh(
            bm,
            size=(rw, 0.12, 0.06),
            center=(kb_cx - 0.18, ry, 1.825),
            swatch_name=rsw,
        )

    # Iconic oversized ISO Enter key in bold red `signal` (#f50000)
    _add_prism_to_bmesh(
        bm,
        size=(0.22, 0.27, 0.07),
        center=(kb_cx + 0.54, kb_cy + 0.035, 1.83),
        swatch_name="signal",
    )
    # Right Shift key (`paperShadow`)
    _add_prism_to_bmesh(
        bm,
        size=(0.22, 0.12, 0.06),
        center=(kb_cx + 0.54, kb_cy - 0.18, 1.825),
        swatch_name="paperShadow",
    )

    # Bottom row: Ctrl/Alt keys (`paperShadow`) + long chunky Spacebar (`paperWarm` / `ink` accent)
    for mod_x in (kb_cx - 0.87, kb_cx - 0.64, kb_cx + 0.34, kb_cx + 0.56):
        _add_prism_to_bmesh(
            bm,
            size=(0.19, 0.12, 0.06),
            center=(mod_x, kb_cy - 0.31, 1.825),
            swatch_name="paperShadow",
        )
    # Spacebar (raised to z=1.86 m)
    _add_prism_to_bmesh(
        bm,
        size=(0.72, 0.13, 0.068),
        center=(kb_cx - 0.15, kb_cy - 0.31, 1.828),
        swatch_name="paperWarm",
    )

    # Right-side navigation / numpad cluster (`paper` & `paperShadow`)
    _add_prism_to_bmesh(
        bm,
        size=(0.28, 0.55, 0.06),
        center=(kb_cx + 0.84, kb_cy - 0.03, 1.825),
        swatch_name="paper",
    )
    _add_prism_to_bmesh(
        bm,
        size=(0.09, 0.24, 0.068),
        center=(kb_cx + 0.94, kb_cy - 0.12, 1.828),
        swatch_name="signal",
    )

    # 3. Retro 2-button ball mouse + mousepad on the right side (`x=1.42, y=-0.98`)
    # Dark cloth mousepad (`ink` with `signal` corner dot)
    _add_prism_to_bmesh(
        bm,
        size=(0.74, 0.68, 0.025),
        center=(1.42, -0.98, 1.662),
        swatch_name="ink",
    )
    # Chunky beige mouse body (`crtBeige`, top at z=1.80 m)
    _add_prism_to_bmesh(
        bm,
        size=(0.34, 0.48, 0.12),
        center=(1.42, -0.98, 1.73),
        swatch_name="crtBeige",
    )
    # Left & Right mouse buttons (`paper`) and red `signal` scroll wheel
    for btn_dx in (-0.08, 0.08):
        _add_prism_to_bmesh(
            bm,
            size=(0.13, 0.18, 0.035),
            center=(1.42 + btn_dx, -0.86, 1.795),
            swatch_name="paper",
        )
    _add_prism_to_bmesh(
        bm,
        size=(0.04, 0.10, 0.05),
        center=(1.42, -0.85, 1.805),
        swatch_name="signal",
    )

    # Coiled dark keyboard & mouse cords running back toward the CRT (`ink`)
    _add_prism_to_bmesh(
        bm,
        size=(0.06, 0.48, 0.04),
        center=(kb_cx - 0.10, -0.32, 1.67),
        swatch_name="ink",
    )
    _add_prism_to_bmesh(
        bm,
        size=(0.05, 0.56, 0.035),
        center=(1.42, -0.46, 1.67),
        swatch_name="ink",
    )

    obj = _finalize_bmesh_object(
        bm,
        name=name,
        location=location,
        collection=collection,
        bevel_width=0.012,
        bevel_segments=1,
        angle_deg=35.0,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "landmarkPart": "keyboard_step2b",
            "stepHeight": KEYBOARD_TOP_Z,
        },
    )
    return obj


# ------------------------- Step 3A: Stampable CRT Power Button


def make_crt_power_button(
    name: str = "OrigensCrtPowerButton",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the stampable CRT Power Button (`OrigensCrtPowerButton`, top ~2.08 m).

    Mounted on a prominent protruding pedestal housing at the lower-front center of
    the CRT bezel (`x=0.0, y=-0.42, z=1.80..2.08 m`), right behind the keyboard so
    Victor can jump from the keyboard (`z=1.85 m`) and Stamp (`Carimbar`) the button
    to turn on the "Ponto Interativo" blog screen (`T2.19b`).
    """
    bm = bmesh.new()

    bx, by = 0.0, -0.40

    # 1. Protruding lower-bezel switch console housing (`crtBeige` & `paperShadow`, z=1.74..1.94)
    _add_prism_to_bmesh(
        bm,
        size=(0.76, 0.48, 0.20),
        center=(bx, by, 1.84),
        swatch_name="crtBeige",
    )
    # Dark recessed switch bezel collar (`ink`, z=1.93..1.97)
    _add_ngon_cylinder_to_bmesh(
        bm,
        radius_bottom=0.25,
        radius_top=0.23,
        height=0.05,
        segments=12,
        center=(bx, by - 0.02, 1.955),
        swatch_name="ink",
        cap_ends=True,
    )
    # Glowing red `signal` (#f50000) outer power ring (z=1.97..2.03)
    _add_ngon_cylinder_to_bmesh(
        bm,
        radius_bottom=0.21,
        radius_top=0.19,
        height=0.06,
        segments=12,
        center=(bx, by - 0.02, 2.00),
        swatch_name="signal",
        cap_ends=True,
    )
    # Tactile plunger cap (`paper` with `signal` power symbol bar in center, top at z=2.08 m)
    _add_ngon_cylinder_to_bmesh(
        bm,
        radius_bottom=0.15,
        radius_top=0.135,
        height=0.055,
        segments=12,
        center=(bx, by - 0.02, 2.048),
        swatch_name="paper",
        cap_ends=True,
    )
    # Raised red `signal` power-toggle line symbol embossed on top of the button cap
    _add_prism_to_bmesh(
        bm,
        size=(0.045, 0.14, 0.025),
        center=(bx, by - 0.02, 2.08),
        swatch_name="signal",
    )

    obj = _finalize_bmesh_object(
        bm,
        name=name,
        location=location,
        collection=collection,
        bevel_width=0.010,
        bevel_segments=1,
        angle_deg=35.0,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "landmarkPart": "power_button_step3",
            "interactive": "stamp_power_button",
            "milestoneId": "2005_ponto_interativo",
            "stepHeight": POWER_BUTTON_TOP_Z,
        },
    )
    return obj


# ------------------------- Step 3B: Giant 3.0 m CRT Monitor Housing


def make_crt_monitor(
    name: str = "OrigensCrtMonitor",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the giant 3.0 m tall 2000s CRT Monitor housing (`OrigensCrtMonitor`).

    Spans from `z = 1.65 m` (desk surface) to `z = 4.65 m` (3.00 m tall above the desk):
      - Heavy swivel pedestal base (`crtBeige` + `paperShadow` + `ink` shadow ring).
      - Chunky 4:3 front bezel (`crtBeige` #ded6c3, 2.86 m wide x 2.50 m tall) with a
        deep recessed `ink` (#0a0a0a) inner aperture framing the separate `screen` mesh.
      - Classic deep-backed 2005 cathode-ray tube rear shell (`crtBeige` tapering to
        `paperShadow` #dfd1b2 at `y = +1.52 m`) with horizontal cooling vent louvers,
        brightness/contrast adjustment thumbwheels, and a retro badge plate.
    """
    bm = bmesh.new()

    # 1. Swivel pedestal base resting on the desk (`z = 1.65..2.12 m`)
    _add_prism_to_bmesh(
        bm,
        size=(1.96, 1.36, 0.12),
        center=(0.0, 0.34, 1.71),
        swatch_name="paperShadow",
    )
    _add_ngon_cylinder_to_bmesh(
        bm,
        radius_bottom=0.78,
        radius_top=0.66,
        height=0.22,
        segments=12,
        center=(0.0, 0.34, 1.86),
        swatch_name="ink",
        cap_ends=True,
    )
    _add_prism_to_bmesh(
        bm,
        size=(1.68, 1.08, 0.22),
        center=(0.0, 0.30, 2.04),
        swatch_name="crtBeige",
    )

    # 2. Front CRT Bezel Frame built from 4 thick border beams around the 4:3 screen aperture
    # Outer bezel bounds: x in [-1.43, +1.43] (2.86 m wide), z in [2.12, 4.65] (2.53 m tall),
    # y in [-0.28, +0.16].
    # Screen aperture opening: x in [-1.10, +1.10] (2.20 m wide), z in [2.56, 4.21] (1.65 m tall -> exact 4:3!).
    # Lower bezel chin bar (z = 2.12..2.56)
    _add_prism_to_bmesh(
        bm,
        size=(2.86, 0.44, 0.44),
        center=(0.0, -0.06, 2.34),
        swatch_name="crtBeige",
    )
    # Upper bezel brow bar (z = 4.21..4.65 -> top at exact z = 4.65 m, 3.00 m above desk!)
    _add_prism_to_bmesh(
        bm,
        size=(2.86, 0.44, 0.44),
        center=(0.0, -0.06, 4.43),
        swatch_name="crtBeige",
    )
    # Left and Right vertical bezel pillars (x = -1.43..-1.10 and +1.10..+1.43, z = 2.56..4.21)
    for sx in (-1.0, 1.0):
        _add_prism_to_bmesh(
            bm,
            size=(0.33, 0.44, 1.65),
            center=(sx * 1.265, -0.06, 3.385),
            swatch_name="crtBeige",
        )

    # 3. Deep recessed `ink` inner bezel liner framing the 4:3 screen glass
    # Bottom & Top inner `ink` bevel strips
    _add_prism_to_bmesh(
        bm,
        size=(2.26, 0.26, 0.08),
        center=(0.0, -0.10, 2.58),
        swatch_name="ink",
    )
    _add_prism_to_bmesh(
        bm,
        size=(2.26, 0.26, 0.08),
        center=(0.0, -0.10, 4.19),
        swatch_name="ink",
    )
    # Left & Right inner `ink` bevel strips
    for sx in (-1.0, 1.0):
        _add_prism_to_bmesh(
            bm,
            size=(0.08, 0.26, 1.69),
            center=(sx * 1.11, -0.10, 3.385),
            swatch_name="ink",
        )
    # Solid dark back-wall behind the screen aperture (`ink` at y = -0.02)
    _add_prism_to_bmesh(
        bm,
        size=(2.32, 0.12, 1.76),
        center=(0.0, 0.02, 3.385),
        swatch_name="ink",
    )

    # 4. Tapered deep-backed 2005 CRT cathode-ray tube rear housing (`y = 0.14..1.52 m`)
    crt_back_sections = [
        (0.14, 0.0, 3.385, 2.74, 2.42),
        (0.58, 0.0, 3.36, 2.38, 2.12),
        (1.08, 0.0, 3.32, 1.72, 1.56),
        (1.52, 0.0, 3.28, 1.12, 1.04),
    ]
    _add_lofted_sections_to_bmesh(
        bm,
        sections=crt_back_sections,
        section_swatches=["crtBeige", "crtBeige", "paperShadow"],
        cap_front_swatch="crtBeige",
        cap_back_swatch="paperShadow",
    )

    # 5. Side & top cooling vent louvers (`ink` slots along the CRT rear housing)
    vent_y_positions = (0.34, 0.48, 0.62, 0.76)
    for vy in vent_y_positions:
        # Top vent ribs (`ink`)
        _add_prism_to_bmesh(
            bm,
            size=(1.44, 0.06, 0.05),
            center=(0.0, vy, 4.46 - (vy - 0.34) * 0.32),
            swatch_name="ink",
        )
        # Left & right side vent slots (`ink`)
        for sx in (-1.0, 1.0):
            _add_prism_to_bmesh(
                bm,
                size=(0.06, 0.06, 0.68),
                center=(sx * (1.28 - (vy - 0.34) * 0.38), vy, 3.38),
                swatch_name="ink",
            )

    # 6. Lower-bezel front details: retro brand badge (`paper` + `signal` dot),
    # contrast/brightness thumbwheels (`ink`), and status LED (`pequi` / `signal`)
    # Left badge plaque (`paper` + `ink` + `signal`)
    _add_prism_to_bmesh(
        bm,
        size=(0.42, 0.05, 0.12),
        center=(-0.86, -0.28, 2.34),
        swatch_name="paper",
    )
    _add_prism_to_bmesh(
        bm,
        size=(0.08, 0.06, 0.08),
        center=(-1.00, -0.285, 2.34),
        swatch_name="signal",
    )
    # Right adjustment dials (`ink` & `paperShadow`) and power LED indicator (`pequi`)
    for dial_x in (0.62, 0.80, 0.98):
        _add_ngon_cylinder_to_bmesh(
            bm,
            radius_bottom=0.055,
            radius_top=0.055,
            height=0.05,
            segments=8,
            center=(dial_x, -0.28, 2.34),
            swatch_name="ink",
            rotation_euler=(math.pi * 0.5, 0.0, 0.0),
            cap_ends=True,
        )
    _add_prism_to_bmesh(
        bm,
        size=(0.07, 0.05, 0.07),
        center=(0.42, -0.28, 2.34),
        swatch_name="pequi",
    )

    obj = _finalize_bmesh_object(
        bm,
        name=name,
        location=location,
        collection=collection,
        bevel_width=0.018,
        bevel_segments=1,
        angle_deg=35.0,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "landmarkPart": "crt_monitor_housing",
            "heightAboveDesk": round(MONITOR_TOP_Z - DESK_TOP_Z, 3),
            "topZ": MONITOR_TOP_Z,
        },
    )
    return obj


# ------------------------- MANDATORY Separate Mesh: `screen`


def make_crt_screen_mesh(
    name: str = "screen",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the MANDATORY separate mesh named exact `"screen"` (`T2.13b` & `T2.19b`).

    Design & Runtime Contract:
      - Exact object name `"screen"` and mesh name `"screen"`.
      - Covers the 4:3 CRT glass opening (`width = 2.16 m`, `height = 1.62 m`, exact 4:3
        aspect ratio matching the 256x192 "Ponto Interativo" blog texture in `T2.19b`)
        with a subtle convex CRT glass curvature protruding forward (`y = -0.15..-0.22 m`).
      - Binds the single shared `"palette"` material so the landmark keeps `materials == 1`
        (`["palette"]`).
      - Front glass grid faces carry clean planar `[0..1] x [0..1]` UVs (`u` from 0.0 left
        to 1.0 right, `v` from 0.0 bottom to 1.0 top) while the perimeter glass rim faces
        snap to the `crtScreen` (`#1e2b24`) palette swatch center UV. When `T2.19b` swaps
        the runtime material/texture on `screen` to the 256x192 "Ponto Interativo" blog
        texture, the 4:3 screen maps 1:1 without distortion!
    """
    cols = 12
    rows = 9
    width = 2.16
    height = 1.62  # 2.16 / 1.62 = 4:3 exact aspect ratio
    cx = 0.0
    cz = 3.385
    y_edge = -0.145
    y_back = -0.095
    bulge_depth = 0.065  # Gentle 2000s CRT curved glass bulge toward -Y (front)

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.verify()
    uv1_layer = bm.loops.layers.uv.new("UVMapScreen")
    crt_u, crt_v = vn_palette.get_swatch_uv("crtScreen", gltf=False)
    # 16x16 palette cell half-span around `crtScreen` center (col=12, row=2) so
    # TEXCOORD_0 stays 100% inside the dark-green `crtScreen` (#1e2b24) pixel when
    # bound to `palette.png`, AND spans a clean planar 4:3 rectangle that can be
    # normalized or read directly via TEXCOORD_1 (`UVMapScreen`, exact [0..1]x[0..1]).
    cell_half = 0.012  # well inside 1/(2*16) = 0.03125

    # 1. Build front 12x9 curved 4:3 CRT glass vertex grid
    front_grid: list[list[bmesh.types.BMVert]] = []
    for r_idx in range(rows + 1):
        v_norm = r_idx / rows
        ny = v_norm * 2.0 - 1.0  # [-1, +1]
        z_pos = cz + (v_norm - 0.5) * height
        row_verts: list[bmesh.types.BMVert] = []
        for c_idx in range(cols + 1):
            u_norm = c_idx / cols
            nx = u_norm * 2.0 - 1.0  # [-1, +1]
            x_pos = cx + (u_norm - 0.5) * width
            # Smooth biquadratic CRT glass dome curvature (max at center, 0 at corners)
            dome = max(0.0, (1.0 - 0.65 * (nx * nx)) * (1.0 - 0.65 * (ny * ny)))
            y_pos = y_edge - bulge_depth * dome
            row_verts.append(bm.verts.new((x_pos, y_pos, z_pos)))
        front_grid.append(row_verts)

    for r_idx in range(rows):
        v0 = r_idx / rows
        v1 = (r_idx + 1) / rows
        for c_idx in range(cols):
            u0 = c_idx / cols
            u1 = (c_idx + 1) / cols
            v_bl = front_grid[r_idx][c_idx]
            v_br = front_grid[r_idx][c_idx + 1]
            v_tr = front_grid[r_idx + 1][c_idx + 1]
            v_tl = front_grid[r_idx + 1][c_idx]
            # Winding order so front face normal points toward -Y (viewer in front of desk)
            face = bm.faces.new((v_bl, v_tl, v_tr, v_br))
            planar_uvs = ((u0, v0), (u0, v1), (u1, v1), (u1, v0))
            for loop, (pu, pv) in zip(face.loops, planar_uvs):
                loop[uv_layer].uv = (
                    crt_u + (pu - 0.5) * 2.0 * cell_half,
                    crt_v + (pv - 0.5) * 2.0 * cell_half,
                )
                loop[uv1_layer].uv = (pu, pv)

    # 2. Close the glass slab into a watertight manifold mesh with `crtScreen` (#1e2b24)
    # perimeter rim and back plate so `screen` is 100% manifold.

    # Extract boundary loop around the front grid in counter-clockwise order (looking from -Y)
    boundary_front: list[bmesh.types.BMVert] = []
    # Bottom edge: left -> right
    for c_idx in range(cols):
        boundary_front.append(front_grid[0][c_idx])
    # Right edge: bottom -> top
    for r_idx in range(rows):
        boundary_front.append(front_grid[r_idx][cols])
    # Top edge: right -> left
    for c_idx in range(cols, 0, -1):
        boundary_front.append(front_grid[rows][c_idx])
    # Left edge: top -> bottom
    for r_idx in range(rows, 0, -1):
        boundary_front.append(front_grid[r_idx][0])

    boundary_back: list[bmesh.types.BMVert] = [
        bm.verts.new((v.co.x, y_back, v.co.z)) for v in boundary_front
    ]

    n_bound = len(boundary_front)
    for b_idx in range(n_bound):
        next_b = (b_idx + 1) % n_bound
        f_rim = bm.faces.new(
            (
                boundary_front[b_idx],
                boundary_front[next_b],
                boundary_back[next_b],
                boundary_back[b_idx],
            )
        )
        for loop in f_rim.loops:
            loop[uv_layer].uv = (crt_u, crt_v)
            loop[uv1_layer].uv = (0.0, 0.0)

    # Close back face with a central hub vertex so all back faces are clean triangles
    back_center = bm.verts.new((cx, y_back, cz))
    for b_idx in range(n_bound):
        next_b = (b_idx + 1) % n_bound
        f_back = bm.faces.new((boundary_back[b_idx], boundary_back[next_b], back_center))
        for loop in f_back.loops:
            loop[uv_layer].uv = (crt_u, crt_v)
            loop[uv1_layer].uv = (0.0, 0.0)

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

    vn_bevel.apply_weighted_normals(
        obj,
        weight=50,
        keep_sharp=True,
        face_influence=True,
        apply=True,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "landmarkPart": "crt_screen",
            "defaultSwatch": "crtScreen",
            "defaultHex": "#1e2b24",
            "aspectRatio": "4:3",
            "textureTarget": "pontoInterativo256x192",
            "uvSpace": "planar_0_1",
        },
    )
    return obj


# ----------------------------------------- Landmark Assembly & Colliders


def make_crt_desk_landmark(
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
    include_colliders: bool = True,
) -> dict[str, bpy.types.Object]:
    """Build the complete Origens O5 Hero Landmark (Giant CRT + Desk, Chair, Keyboard & `screen`).

    Returns a dict of created objects keyed by name:
      - `"OrigensCrtChair"` (Step 1 visual mesh, seat top ~0.95 m)
      - `"OrigensCrtDesk"` (Step 2A visual mesh, tabletop ~1.65 m)
      - `"OrigensCrtKeyboard"` (Step 2B visual mesh, keycap top ~1.85 m)
      - `"OrigensCrtPowerButton"` (Step 3A stampable power button visual mesh, top ~2.08 m)
      - `"OrigensCrtMonitor"` (Step 3B 3.0 m tall CRT housing visual mesh, top ~4.65 m)
      - `"screen"` (MANDATORY separate 4:3 CRT glass mesh with `[0,1]x[0,1]` planar UVs)
      - plus walkable `cuboid*` collider Empties when `include_colliders=True`.
    """
    col = (
        vn_scene.ensure_collection("OrigensCrtDesk")
        if collection is None
        else vn_scene.ensure_collection(collection)
        if isinstance(collection, str)
        else collection
    )

    loc = tuple(float(v) for v in location)

    visual_parts: dict[str, bpy.types.Object] = {
        "OrigensCrtChair": make_crt_chair(
            name="OrigensCrtChair",
            location=loc,
            collection=col,
        ),
        "OrigensCrtDesk": make_crt_desk(
            name="OrigensCrtDesk",
            location=loc,
            collection=col,
        ),
        "OrigensCrtKeyboard": make_crt_keyboard(
            name="OrigensCrtKeyboard",
            location=loc,
            collection=col,
        ),
        "OrigensCrtPowerButton": make_crt_power_button(
            name="OrigensCrtPowerButton",
            location=loc,
            collection=col,
        ),
        "OrigensCrtMonitor": make_crt_monitor(
            name="OrigensCrtMonitor",
            location=loc,
            collection=col,
        ),
        "screen": make_crt_screen_mesh(
            name="screen",
            location=loc,
            collection=col,
        ),
    }

    # Support manual overrides in game/blender/manual/origens_crt_desk.blend
    vn_manual.apply_manual_overrides("origens_crt_desk", objects=list(visual_parts.values()))

    all_objects = dict(visual_parts)

    if include_colliders:
        chair_yaw = math.radians(16.0)
        # Step 1 collider: Chair seat (top at z = 0.475 + 0.95/2 = 0.95 m)
        all_objects["cuboidCrtChairSeat"] = vn_collide.add_cuboid(
            name="cuboidCrtChairSeat",
            size=(1.22, 1.18, 0.95),
            location=(-1.65, -2.05, 0.475),
            rotation=(0.0, 0.0, chair_yaw),
            parent=visual_parts["OrigensCrtChair"],
            props={"step": 1, "surface": "wood", "topZ": CHAIR_SEAT_TOP_Z},
            collection=col,
        )
        # Chair backrest collider (top at z = 1.52 m)
        all_objects["cuboidCrtChairBack"] = vn_collide.add_cuboid(
            name="cuboidCrtChairBack",
            size=(1.18, 0.16, 0.57),
            location=(-1.65 + 0.52 * math.sin(chair_yaw), -2.05 - 0.52 * math.cos(chair_yaw), 1.235),
            rotation=(0.0, 0.0, chair_yaw),
            parent=visual_parts["OrigensCrtChair"],
            props={"step": 1, "surface": "wood", "topZ": CHAIR_BACK_TOP_Z},
            collection=col,
        )

        # Step 2A collider: Desk tabletop (top at z = 1.50 + 0.30/2 = 1.65 m)
        all_objects["cuboidCrtDeskTop"] = vn_collide.add_cuboid(
            name="cuboidCrtDeskTop",
            size=(4.80, 3.20, 0.30),
            location=(0.0, 0.0, 1.50),
            parent=visual_parts["OrigensCrtDesk"],
            props={"step": 2, "surface": "wood", "topZ": DESK_TOP_Z},
            collection=col,
        )
        # Desk right drawer pedestal collider (z = 0.0..1.38 m)
        all_objects["cuboidCrtDeskPedestal"] = vn_collide.add_cuboid(
            name="cuboidCrtDeskPedestal",
            size=(1.22, 2.54, 1.38),
            location=(1.44, 0.0, 0.69),
            parent=visual_parts["OrigensCrtDesk"],
            props={"surface": "wood"},
            collection=col,
        )

        # Step 2B collider: Giant mechanical keyboard platform (top at z = 1.75 + 0.20/2 = 1.85 m)
        all_objects["cuboidCrtKeyboard"] = vn_collide.add_cuboid(
            name="cuboidCrtKeyboard",
            size=(2.24, 0.96, 0.20),
            location=(-0.18, -1.02, 1.75),
            parent=visual_parts["OrigensCrtKeyboard"],
            props={"step": 2, "surface": "plastic", "topZ": KEYBOARD_TOP_Z},
            collection=col,
        )
        # Retro mouse collider (top at z = 1.725 + 0.15/2 = 1.80 m)
        all_objects["cuboidCrtMouse"] = vn_collide.add_cuboid(
            name="cuboidCrtMouse",
            size=(0.36, 0.50, 0.15),
            location=(1.42, -0.98, 1.725),
            parent=visual_parts["OrigensCrtKeyboard"],
            props={"step": 2, "surface": "plastic", "topZ": 1.80},
            collection=col,
        )

        # Step 3A collider: Stampable CRT Power Button trigger ledge (top at z = 1.865 + 0.43/2 = 2.08 m)
        all_objects["cuboidCrtPowerButton"] = vn_collide.add_cuboid(
            name="cuboidCrtPowerButton",
            size=(0.76, 0.48, 0.43),
            location=(0.0, -0.40, 1.865),
            parent=visual_parts["OrigensCrtPowerButton"],
            props={
                "step": 3,
                "interactive": "stamp_power_button",
                "milestoneId": "2005_ponto_interativo",
                "topZ": POWER_BUTTON_TOP_Z,
            },
            collection=col,
        )

        # Step 3B collider: Giant 3.0 m CRT Monitor housing (top at z = 3.15 + 3.00/2 = 4.65 m)
        all_objects["cuboidCrtMonitor"] = vn_collide.add_cuboid(
            name="cuboidCrtMonitor",
            size=(2.86, 1.80, 3.00),
            location=(0.0, 0.62, 3.15),
            parent=visual_parts["OrigensCrtMonitor"],
            props={"step": 3, "surface": "plastic", "topZ": MONITOR_TOP_Z},
            collection=col,
        )

    return all_objects


# ------------------------------------------------ Verification & Self-Test


def verify_crt_desk_landmark(
    parts: dict[str, bpy.types.Object],
    glb_path: Path | None = None,
) -> dict[str, Any]:
    """Verify T2.13b acceptance criteria: `screen` mesh existence, planar UVs, budgets, colliders."""
    # 1. Verify mandatory separate `screen` mesh object in Blender scene
    if "screen" not in bpy.data.objects:
        raise AssertionError("T2.13b FAIL: separate object named 'screen' not found in bpy.data.objects")
    screen_obj = bpy.data.objects["screen"]
    if screen_obj.type != "MESH" or screen_obj.data is None:
        raise AssertionError(f"T2.13b FAIL: 'screen' must be a MESH object, got {screen_obj.type}")

    # Verify `screen` UVs:
    # - Active `UVMap` (`TEXCOORD_0`) stays within the `crtScreen` (#1e2b24) palette cell
    #   with a proportional 4:3 planar span so `palette.png` renders solid `crtScreen`.
    # - Secondary `UVMapScreen` (`TEXCOORD_1`) spans exact planar `[0, 1] x [0, 1]` for the
    #   256x192 "Ponto Interativo" blog texture swap in `T2.19b`.
    screen_mesh = screen_obj.data
    uv_layer = screen_mesh.uv_layers.active
    if uv_layer is None:
        raise AssertionError("T2.13b FAIL: 'screen' mesh has no active UV layer")
    uv1_layer = screen_mesh.uv_layers.get("UVMapScreen")
    if uv1_layer is None:
        raise AssertionError("T2.13b FAIL: 'screen' mesh missing 'UVMapScreen' [0..1] planar UV layer")

    crt_u, crt_v = vn_palette.get_swatch_uv("crtScreen", gltf=False)
    u0_vals = [uv_layer.data[i].uv[0] for poly in screen_mesh.polygons for i in poly.loop_indices]
    v0_vals = [uv_layer.data[i].uv[1] for poly in screen_mesh.polygons for i in poly.loop_indices]
    for u0, v0 in zip(u0_vals, v0_vals):
        if abs(u0 - crt_u) > 0.025 or abs(v0 - crt_v) > 0.025:
            raise AssertionError(
                f"T2.13b FAIL: 'screen' TEXCOORD_0 ({u0:.4f}, {v0:.4f}) outside 'crtScreen' swatch cell ({crt_u:.4f}, {crt_v:.4f})"
            )

    u_vals = [uv1_layer.data[i].uv[0] for poly in screen_mesh.polygons for i in poly.loop_indices]
    v_vals = [uv1_layer.data[i].uv[1] for poly in screen_mesh.polygons for i in poly.loop_indices]
    u_min, u_max = min(u_vals), max(u_vals)
    v_min, v_max = min(v_vals), max(v_vals)
    if u_min < -1e-4 or u_max > 1.0001 or v_min < -1e-4 or v_max > 1.0001:
        raise AssertionError(
            f"T2.13b FAIL: 'screen' planar UVs out of [0, 1] bounds: u=[{u_min:.4f}, {u_max:.4f}], v=[{v_min:.4f}, {v_max:.4f}]"
        )
    if (u_max - u_min) < 0.99 or (v_max - v_min) < 0.99:
        raise AssertionError(
            f"T2.13b FAIL: 'screen' planar UVs do not span full [0, 1]x[0, 1] range: "
            f"u=[{u_min:.4f}, {u_max:.4f}], v=[{v_min:.4f}, {v_max:.4f}]"
        )

    # 2. Evaluate triangle counts, manifold status, and material count across all visual meshes
    visual_names = (
        "OrigensCrtChair",
        "OrigensCrtDesk",
        "OrigensCrtKeyboard",
        "OrigensCrtPowerButton",
        "OrigensCrtMonitor",
        "screen",
    )
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()

    per_mesh_report: dict[str, dict[str, Any]] = {}
    total_tris = 0
    all_materials: set[str] = set()

    for vname in visual_names:
        if vname not in parts:
            raise AssertionError(f"Missing required landmark mesh {vname!r}")
        obj = parts[vname]
        eval_obj = obj.evaluated_get(depsgraph)
        mesh_eval = eval_obj.to_mesh()
        try:
            mesh_eval.calc_loop_triangles()
            tris = len(mesh_eval.loop_triangles)
            bm = bmesh.new()
            bm.from_mesh(mesh_eval)
            non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
            zero_area = sum(1 for f in bm.faces if f.calc_area() < 1e-8)
            bm.free()
        finally:
            eval_obj.to_mesh_clear()

        mats = [s.material.name for s in obj.material_slots if s.material is not None]
        if mats != ["palette"]:
            raise AssertionError(f"{vname} must bind single ['palette'] material, got {mats}")
        if non_manifold != 0:
            raise AssertionError(f"{vname} has {non_manifold} non-manifold edges")
        if zero_area != 0:
            raise AssertionError(f"{vname} has {zero_area} zero-area faces")

        all_materials.update(mats)
        total_tris += tris
        per_mesh_report[vname] = {
            "triangles": tris,
            "non_manifold_edges": non_manifold,
            "zero_area_faces": zero_area,
            "materials": mats,
        }

    if not (LANDMARK_TRI_MIN <= total_tris <= LANDMARK_TRI_MAX):
        raise AssertionError(
            f"Landmark total triangles {total_tris} outside §5.4 budget [{LANDMARK_TRI_MIN}, {LANDMARK_TRI_MAX}]"
        )

    # 3. Verify walkable platforming progression collider step heights (Victor jump apex = 2.0 m)
    required_colliders = (
        ("cuboidCrtChairSeat", CHAIR_SEAT_TOP_Z),
        ("cuboidCrtDeskTop", DESK_TOP_Z),
        ("cuboidCrtKeyboard", KEYBOARD_TOP_Z),
        ("cuboidCrtPowerButton", POWER_BUTTON_TOP_Z),
        ("cuboidCrtMonitor", MONITOR_TOP_Z),
    )
    collider_tops: dict[str, float] = {}
    prev_z = 0.0
    for col_name, expected_top in required_colliders:
        if col_name not in parts:
            raise AssertionError(f"Missing required collider {col_name!r}")
        col_obj = parts[col_name]
        actual_top = float(col_obj.location.z) + float(col_obj.scale.z) * 0.5
        if abs(actual_top - expected_top) > 0.02:
            raise AssertionError(
                f"{col_name} top height {actual_top:.3f} m does not match expected {expected_top:.3f} m"
            )
        step_delta = actual_top - prev_z
        # Every platform step up to the stampable power button must be comfortably below Victor's 2.0 m jump apex
        if col_name != "cuboidCrtMonitor" and not (0.15 <= step_delta <= 1.25):
            raise AssertionError(
                f"Invalid platforming step delta {step_delta:.3f} m onto {col_name} (Victor jump apex = 2.0 m)"
            )
        collider_tops[col_name] = round(actual_top, 3)
        prev_z = actual_top

    # 4. If GLB was exported, verify node named `"screen"` exists in exported glTF JSON
    glb_screen_found = False
    if glb_path is not None and glb_path.is_file():
        glb_info = vn_export.inspect_glb(str(glb_path))
        gltf_nodes = glb_info["gltf"].get("nodes", [])
        node_names = [n.get("name", "") for n in gltf_nodes]
        if "screen" not in node_names:
            raise AssertionError(
                f"T2.13b FAIL: node 'screen' missing from exported GLB nodes: {node_names}"
            )
        glb_screen_found = True

    print("==================================================================")
    print("T2.13b CRT DESK LANDMARK AUDIT_PASS | Era 1 Origens (O5 Marco 2005)")
    print("==================================================================")
    for vname in visual_names:
        info = per_mesh_report[vname]
        print(
            f"  [PASS] {vname:<22} | {info['triangles']:>4} tris | "
            f"mat={info['materials']} | non_manifold={info['non_manifold_edges']}"
        )
    print(
        f"  [PASS] Total Landmark Triangles: {total_tris} tris "
        f"(§5.4 budget {LANDMARK_TRI_MIN}..{LANDMARK_TRI_MAX}) | materials={sorted(all_materials)}"
    )
    print(
        f"  [PASS] Separate mesh 'screen': present in bpy.data.objects & GLB={glb_screen_found} | "
        f"UV range u=[{u_min:.3f}, {u_max:.3f}], v=[{v_min:.3f}, {v_max:.3f}] (4:3 planar)"
    )
    print(f"  [PASS] Platforming Step Heights (m): {collider_tops}")
    print("==================================================================")

    return {
        "total_triangles": total_tris,
        "materials": sorted(all_materials),
        "meshes": per_mesh_report,
        "screen_uv_bounds": {"u": (u_min, u_max), "v": (v_min, v_max)},
        "collider_tops": collider_tops,
        "glb_screen_node": glb_screen_found,
    }


def main() -> None:
    vn_scene.reset_scene(name="OrigensCrtDeskScene")
    parts = make_crt_desk_landmark(
        location=(0.0, 0.0, 0.0),
        collection="OrigensCrtDesk",
        include_colliders=True,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)

    vn_export.export_glb(
        str(GLB_OUT_PATH),
        collections=["OrigensCrtDesk"],
    )
    verify_crt_desk_landmark(parts, glb_path=GLB_OUT_PATH)

    vn_scene.render_3views(
        str(PREVIEW_OUT_PATH),
        size=512,
    )


if __name__ == "__main__":
    main()
