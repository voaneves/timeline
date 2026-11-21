"""Origens Hero Landmark O8 — Escola + Mastro + Capelo (Marco 2011: 'Terminei o ensino médio').

Task T2.13c (Phase 2D — PLAN-3D §2.8, §4.3 O8, §5.4, T2.19c):
  Models the O8 school landmark for Era 1 'Origens' (Araguaína/TO) with a playful,
  readable rooftop platforming progression ('Subir pelos telhados') and a distinct
  graduation mortarboard mesh (`OrigensCapelo`) perched at the roof peak ready to
  detach and fly onto Victor's `head` bone in T2.19c:

  1. `OrigensSchoolCourtyard` (step height ~0.90 m):
       Paved courtyard slab (`concrete` / `paperWarm`) with a low stepped planter-bench
       ledge (`brick` / `paperWarm` / `cerradoGreen` shrubs) at z = 0.90 m.
  2. `OrigensSchoolFlagpole`:
       Civic flagpole (`titanium` shaft, `ink` stepped octagonal base, `ipeGold` finial)
       flying a stylized green-gold-paper pennant (`cerradoGreen`, `ipeGold`, `paper`).
  3. `OrigensSchoolAwning` (walkable roof height ~1.80 m):
       Covered breezeway canopy (`paperWarm` fascia, `ink` structural steel columns,
       `dataTeal` / `cerradoGreen` trim, ribbed `brick` / `lateriteDark` roof deck)
       connecting the courtyard step to the main classroom wing — reachable in 1 jump
       (+0.90 m from the 0.90 m courtyard step).
  4. `OrigensSchoolWing` (eave roof ~3.10 m, flat ridge walkway ~3.40 m, pedestal top ~3.70 m):
       Brazilian high-school classroom wing with cream `paper` (#f4ead4) walls,
       rhythms of recessed awning windows (`ink` frames, `windowGlow` warm panes,
       `dataTeal` and `cerradoGreen` sill/lintel accents), pitched terracotta tiled roof
       (`brick` #b5562c / `lateriteDark` #a8432a), flat `paperWarm` ridge walkway at
       z = 3.40 m (+1.60 m from awning), and the central graduation podium/pedestal
       topping out at z = 3.70 m.
  5. `OrigensCapelo` (resting at z = 3.70 m):
       Distinct mesh object named `OrigensCapelo` — classic square academic mortarboard
       cap in `ink` (#0a0a0a) with a skullcap crown, center button, and red `signal`
       (#f50000) graduation tassel hanging over the board edge.
  6. Walkable `cuboid*` colliders (`vn_collide.add_cuboid`) for the courtyard slab,
     courtyard planter step (0.90 m), breezeway awning roof (1.80 m), main wing walls,
     main wing roof deck (3.10 m), ridge walkway (3.40 m), graduation pedestal (3.70 m),
     and flagpole base.

All visual meshes share the single `"palette"` material via `vn_palette`, keep total
triangle count strictly inside the §5.4 Architecture/Landmarks budget (1,200–6,000 tris),
have zero non-manifold/NaN/degenerate faces, and support
`vn_manual.apply_manual_overrides("origens_school")`.

Run standalone:
    blender.exe -b -P game/blender/kits/origens_school.py
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

ASSET_NAME = "origens_school"
OUT_DIR = BLENDER_DIR / "out"
PREVIEWS_DIR = OUT_DIR / "previews"
GLB_OUT_PATH = OUT_DIR / "origens_school.glb"
PREVIEW_OUT_PATH = PREVIEWS_DIR / "t213c_school.png"

TRI_BUDGET_MIN = 1200
TRI_BUDGET_MAX = 6000

# Canonical platform progression heights (meters above landmark base z=0.0):
STEP_HEIGHTS = {
    "courtyard_paving": 0.14,
    "courtyard_step": 0.90,
    "awning_roof": 1.80,
    "wing_eave_roof": 3.10,
    "wing_ridge_walkway": 3.40,
    "graduation_pedestal": 3.70,
}
JUMP_APEX_M = 2.00


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


def _add_box_to_bmesh(
    bm: bmesh.types.BMesh,
    size: tuple[float, float, float],
    center: tuple[float, float, float],
    swatch_name: str,
    rotation_euler: tuple[float, float, float] | None = None,
    face_swatches: dict[str, str] | None = None,
) -> list[bmesh.types.BMFace]:
    """Create an axis-aligned or rotated box in `bm` and tag its faces with palette swatches.

    `face_swatches` can override individual local face directions by key:
    `'+Z'`, `'-Z'`, `'+X'`, `'-X'`, `'+Y'`, `'-Y'`.
    """
    ret = bmesh.ops.create_cube(bm, size=1.0)
    verts = ret["verts"]
    vert_set = set(verts)
    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]

    # Tag local face directions before rotating/translating if per-face overrides are given.
    for f in faces:
        f.normal_update()
        sw = swatch_name
        if face_swatches:
            n = f.normal
            if n.z > 0.7 and "+Z" in face_swatches:
                sw = face_swatches["+Z"]
            elif n.z < -0.7 and "-Z" in face_swatches:
                sw = face_swatches["-Z"]
            elif n.x > 0.7 and "+X" in face_swatches:
                sw = face_swatches["+X"]
            elif n.x < -0.7 and "-X" in face_swatches:
                sw = face_swatches["-X"]
            elif n.y > 0.7 and "+Y" in face_swatches:
                sw = face_swatches["+Y"]
            elif n.y < -0.7 and "-Y" in face_swatches:
                sw = face_swatches["-Y"]
        _assign_uv_to_faces(bm, [f], sw)

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
    return faces


def _add_frustum_to_bmesh(
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


def _add_gabled_roof_prism_to_bmesh(
    bm: bmesh.types.BMesh,
    span_x: float,
    span_y: float,
    z_eave: float,
    z_ridge: float,
    ridge_flat_y: float,
    center_xy: tuple[float, float],
    slope_swatch: str = "brick",
    ridge_swatch: str = "paperWarm",
    gable_swatch: str = "paper",
    soffit_swatch: str = "paperShadow",
) -> list[bmesh.types.BMFace]:
    """Create a closed trapezoidal hipped/gabled roof volume with a flat top ridge deck.

    Cross-section in (y, z) extruded along X:
      - Bottom rectangle at `z = z_eave`, `y in [cy - span_y/2, cy + span_y/2]`
      - Top flat ridge deck at `z = z_ridge`, `y in [cy - ridge_flat_y/2, cy + ridge_flat_y/2]`
    """
    cx, cy = float(center_xy[0]), float(center_xy[1])
    hx = float(span_x) * 0.5
    hy_bot = float(span_y) * 0.5
    hy_top = float(ridge_flat_y) * 0.5

    profile_yz = [
        (cy - hy_bot, float(z_eave)),  # 0: front-bottom eave (-Y)
        (cy + hy_bot, float(z_eave)),  # 1: back-bottom eave (+Y)
        (cy + hy_top, float(z_ridge)),  # 2: back-top ridge (+Y)
        (cy - hy_top, float(z_ridge)),  # 3: front-top ridge (-Y)
    ]

    v_left = [bm.verts.new((cx - hx, y, z)) for y, z in profile_yz]
    v_right = [bm.verts.new((cx + hx, y, z)) for y, z in profile_yz]

    f_bottom = bm.faces.new((v_left[0], v_right[0], v_right[1], v_left[1]))
    f_back_slope = bm.faces.new((v_left[1], v_right[1], v_right[2], v_left[2]))
    f_top_ridge = bm.faces.new((v_left[2], v_right[2], v_right[3], v_left[3]))
    f_front_slope = bm.faces.new((v_left[3], v_right[3], v_right[0], v_left[0]))
    f_left_gable = bm.faces.new((v_left[0], v_left[1], v_left[2], v_left[3]))
    f_right_gable = bm.faces.new((v_right[3], v_right[2], v_right[1], v_right[0]))

    _assign_uv_to_faces(bm, [f_bottom], soffit_swatch)
    _assign_uv_to_faces(bm, [f_front_slope, f_back_slope], slope_swatch)
    _assign_uv_to_faces(bm, [f_top_ridge], ridge_swatch)
    _assign_uv_to_faces(bm, [f_left_gable, f_right_gable], gable_swatch)

    return [
        f_bottom,
        f_back_slope,
        f_top_ridge,
        f_front_slope,
        f_left_gable,
        f_right_gable,
    ]


def _finalize_bmesh_object(
    bm: bmesh.types.BMesh,
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection | str | None,
    bevel_width: float = 0.015,
    bevel_segments: int = 1,
    angle_deg: float = 35.0,
) -> bpy.types.Object:
    """Convert `bm` to a mesh object, bind the shared `'palette'` material, and apply toy bevels."""
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


# -------------------------------------------- 1. Pátio (OrigensSchoolCourtyard)


def make_school_courtyard(
    name: str = "OrigensSchoolCourtyard",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Build the paved school courtyard edge and climbable planter/bench step (~0.90 m).

    Layout (local to landmark origin):
      - Courtyard paved apron (`concrete` / `concreteShadow` / `paperWarm` court lines)
        spanning X in [-4.5, 4.5], Y in [-4.2, -0.8], top at z = 0.14 m.
      - Climbable courtyard bench & brick planter step on the left-front courtyard
        (X in [-3.9, -1.3], Y in [-3.4, -1.6]), topping out at z = 0.90 m so Victor
        can jump from ground -> 0.90 m planter step -> 1.80 m breezeway awning roof.
      - Low seating step shelf at z = 0.48 m in front of the planter for an easy
        visual invitation to climb.
    """
    bm = bmesh.new()

    # 1. Main paved courtyard slab (z = 0.00..0.14 m)
    _add_box_to_bmesh(
        bm,
        size=(9.00, 3.60, 0.14),
        center=(0.00, -2.50, 0.07),
        swatch_name="concrete",
        face_swatches={"+Z": "concrete", "-Z": "concreteShadow"},
    )

    # Courtyard perimeter curb border (`paperWarm` + `laterite` outer trim)
    _add_box_to_bmesh(
        bm,
        size=(9.16, 0.22, 0.18),
        center=(0.00, -4.25, 0.09),
        swatch_name="paperWarm",
        face_swatches={"-Y": "laterite"},
    )
    for sx in (-1.0, 1.0):
        _add_box_to_bmesh(
            bm,
            size=(0.22, 3.68, 0.18),
            center=(sx * 4.48, -2.50, 0.09),
            swatch_name="paperWarm",
        )

    # Decorative warm-paper & teal courtyard hopscotch / court stripe inlays (z = 0.14..0.18 m)
    stripe_specs = (
        ((-0.30, -2.55, 0.16), (3.40, 0.16, 0.045), "paperWarm"),
        ((-0.30, -3.35, 0.16), (3.40, 0.16, 0.045), "dataTeal"),
        ((-1.95, -2.95, 0.16), (0.16, 0.92, 0.045), "paperWarm"),
        ((1.35, -2.95, 0.16), (0.16, 0.92, 0.045), "paperWarm"),
    )
    for center_co, sz, sw in stripe_specs:
        _add_box_to_bmesh(bm, size=sz, center=center_co, swatch_name=sw)

    # 2. Low invitation bench step (z = 0.14..0.48 m) on the front face of the planter
    _add_box_to_bmesh(
        bm,
        size=(2.50, 0.56, 0.34),
        center=(-2.60, -3.55, 0.31),
        swatch_name="wood",
        face_swatches={"+Z": "wood", "-Y": "woodDark", "-Z": "ink"},
    )
    for bx in (-3.55, -2.60, -1.65):
        _add_box_to_bmesh(
            bm,
            size=(0.14, 0.44, 0.28),
            center=(bx, -3.55, 0.24),
            swatch_name="ink",
        )

    # 3. Climbable courtyard planter/bench step (top at exact z = 0.90 m!)
    # Brick masonry body (z = 0.14..0.80 m) + broad walkable paperWarm coping deck (z = 0.80..0.90 m)
    _add_box_to_bmesh(
        bm,
        size=(2.56, 1.56, 0.66),
        center=(-2.60, -2.45, 0.47),
        swatch_name="brick",
        face_swatches={"+X": "brickDark", "-X": "brickDark"},
    )
    _add_box_to_bmesh(
        bm,
        size=(2.72, 1.72, 0.10),
        center=(-2.60, -2.45, 0.85),
        swatch_name="paperWarm",
        face_swatches={"+Z": "paperWarm", "-Y": "paper", "+Y": "paper"},
    )
    # Editorial ink base band around the planter step
    _add_box_to_bmesh(
        bm,
        size=(2.62, 1.62, 0.08),
        center=(-2.60, -2.45, 0.18),
        swatch_name="ink",
    )
    # Recessed soil band + low trimmed hedge edge at the back of the planter (leaving front 1.2 m clear for landing)
    _add_box_to_bmesh(
        bm,
        size=(2.20, 0.34, 0.08),
        center=(-2.60, -1.85, 0.92),
        swatch_name="cerradoGreen",
        face_swatches={"+Z": "cerradoGreen", "-Y": "cerradoDeep"},
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
            "landmarkPart": "courtyard",
            "stepHeight": STEP_HEIGHTS["courtyard_step"],
        },
    )
    return obj


# -------------------------------------------- 2. Mastro (OrigensSchoolFlagpole)


def make_school_flagpole(
    name: str = "OrigensSchoolFlagpole",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Build the school courtyard flagpole (`mastro`) with stepped base and stylized pennant.

    Positioned on the right side of the courtyard (`x = +2.85, y = -2.65`):
      - Stepped octagonal civic plinth (`paperWarm`, `ink`, `dataTeal` accent plaque).
      - Tall tapered `titanium` / `steel` mast rising to z = 4.65 m with `ink` collar rings
        and a golden `ipeGold` finial orb.
      - Stylized paper-and-green-gold civic school pennant waving toward +X.
    """
    bm = bmesh.new()
    px, py = 2.85, -2.65

    # 1. Stepped octagonal base pedestal (z = 0.14..0.78 m)
    _add_frustum_to_bmesh(
        bm,
        radius_bottom=0.58,
        radius_top=0.52,
        height=0.22,
        segments=8,
        center=(px, py, 0.25),
        swatch_name="paperWarm",
    )
    _add_frustum_to_bmesh(
        bm,
        radius_bottom=0.40,
        radius_top=0.34,
        height=0.26,
        segments=8,
        center=(px, py, 0.49),
        swatch_name="ink",
    )
    _add_frustum_to_bmesh(
        bm,
        radius_bottom=0.24,
        radius_top=0.18,
        height=0.16,
        segments=8,
        center=(px, py, 0.70),
        swatch_name="copper",
    )

    # Front commemorative school plaque on the flagpole plinth
    _add_box_to_bmesh(
        bm,
        size=(0.34, 0.06, 0.16),
        center=(px, py - 0.37, 0.49),
        swatch_name="paper",
        face_swatches={"-Y": "dataTeal"},
    )

    # 2. Tall tapered flagpole mast (`titanium`, z = 0.78..4.52 m)
    _add_frustum_to_bmesh(
        bm,
        radius_bottom=0.075,
        radius_top=0.045,
        height=3.74,
        segments=8,
        center=(px, py, 2.65),
        swatch_name="titanium",
    )

    # Ink halyard collar rings & cleat along the mast
    for ring_z in (1.35, 3.55, 4.38):
        _add_frustum_to_bmesh(
            bm,
            radius_bottom=0.088,
            radius_top=0.088,
            height=0.06,
            segments=8,
            center=(px, py, ring_z),
            swatch_name="ink",
        )
    # Halyard cleat
    _add_box_to_bmesh(
        bm,
        size=(0.06, 0.14, 0.22),
        center=(px - 0.08, py, 1.35),
        swatch_name="ink",
    )

    # Golden finial cap at top of mast (z = 4.52..4.70 m)
    _add_frustum_to_bmesh(
        bm,
        radius_bottom=0.09,
        radius_top=0.03,
        height=0.18,
        segments=8,
        center=(px, py, 4.61),
        swatch_name="ipeGold",
    )

    # 3. Stylized wavy 3-segment paper / green-gold school pennant (z = 3.60..4.34 m)
    # Segment A (hoist panel: cerradoGreen outer frame)
    _add_box_to_bmesh(
        bm,
        size=(0.46, 0.07, 0.70),
        center=(px + 0.28, py + 0.02, 3.97),
        swatch_name="cerradoGreen",
        rotation_euler=(0.0, 0.0, math.radians(6.0)),
    )
    # Central golden diamond/chevron emblem on the hoist panel
    _add_box_to_bmesh(
        bm,
        size=(0.26, 0.085, 0.26),
        center=(px + 0.30, py + 0.02, 3.97),
        swatch_name="ipeGold",
        rotation_euler=(0.0, math.pi * 0.25, math.radians(6.0)),
    )
    # Segment B (mid wave: warm paper + teal stripe)
    _add_box_to_bmesh(
        bm,
        size=(0.44, 0.065, 0.56),
        center=(px + 0.70, py - 0.03, 3.95),
        swatch_name="paper",
        rotation_euler=(0.0, 0.0, math.radians(-8.0)),
        face_swatches={"+Z": "dataTeal", "-Z": "dataTeal"},
    )
    # Segment C (fly tip pennant: ipeGold swallowtail tip)
    _add_box_to_bmesh(
        bm,
        size=(0.36, 0.055, 0.40),
        center=(px + 1.06, py + 0.02, 3.93),
        swatch_name="ipeGold",
        rotation_euler=(0.0, 0.0, math.radians(10.0)),
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
            "landmarkPart": "flagpole",
        },
    )
    return obj


# ------------------------------------ 3. Marquise Baixa (OrigensSchoolAwning)


def make_school_awning(
    name: str = "OrigensSchoolAwning",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Build the covered breezeway awning (`toldo / marquise baixa`, walkable height ~1.80 m).

    Connects the courtyard step (z = 0.90 m) to the main classroom wing roof (z = 3.10 m):
      - Positioned across the front-left of the classroom wing (X in [-3.80, -0.10],
        Y in [-1.85, 0.25]), right behind the 0.90 m courtyard step.
      - Supported by 3 sturdy `ink` & `concrete` colonnade pillars.
      - Flat walkable roof deck at z = 1.80 m (`brick` / `lateriteDark` ribbed awning tiles
        bordered by a `paperWarm` fascia and `dataTeal` drip trim).
      - Height delta from courtyard step: 1.80 - 0.90 = +0.90 m (easily cleared in 1 jump).
    """
    bm = bmesh.new()

    # 1. Three breezeway support columns (`ink` steel shaft + `paperWarm` base/capital)
    col_x_positions = (-3.45, -1.95, -0.45)
    col_y = -1.55
    for cx in col_x_positions:
        # Plinth base (z = 0.14..0.38 m)
        _add_box_to_bmesh(
            bm,
            size=(0.28, 0.28, 0.24),
            center=(cx, col_y, 0.26),
            swatch_name="paperWarm",
        )
        # Column shaft (z = 0.38..1.56 m)
        _add_box_to_bmesh(
            bm,
            size=(0.18, 0.18, 1.18),
            center=(cx, col_y, 0.97),
            swatch_name="ink",
        )
        # Column capital bracket (z = 1.56..1.64 m)
        _add_box_to_bmesh(
            bm,
            size=(0.26, 0.32, 0.08),
            center=(cx, col_y, 1.60),
            swatch_name="dataTeal",
        )

    # 2. Longitudinal `ink` girder beam under the awning soffit (z = 1.56..1.64 m)
    _add_box_to_bmesh(
        bm,
        size=(3.56, 0.16, 0.08),
        center=(-1.95, col_y, 1.60),
        swatch_name="ink",
    )

    # 3. Main awning slab & fascia (z = 1.64..1.76 m)
    _add_box_to_bmesh(
        bm,
        size=(3.76, 2.10, 0.12),
        center=(-1.95, -0.80, 1.70),
        swatch_name="paperWarm",
        face_swatches={
            "+Z": "brick",
            "-Z": "paperShadow",
            "-Y": "paperWarm",
            "-X": "paperWarm",
            "+X": "paperWarm",
        },
    )
    # Front and side `dataTeal` school fascia stripe (z = 1.65..1.71 m)
    _add_box_to_bmesh(
        bm,
        size=(3.80, 0.06, 0.05),
        center=(-1.95, -1.85, 1.68),
        swatch_name="dataTeal",
    )

    # 4. Walkable terracotta-ribbed awning deck (top at exact z = 1.80 m!)
    _add_box_to_bmesh(
        bm,
        size=(3.64, 1.98, 0.06),
        center=(-1.95, -0.80, 1.77),
        swatch_name="brick",
        face_swatches={"+Z": "brick", "-Y": "lateriteDark", "+Y": "lateriteDark"},
    )
    # 5 low profile terracotta seam ribs across the awning roof (top at z = 1.82 m)
    for r_idx in range(5):
        rx = -3.35 + r_idx * 0.70
        _add_box_to_bmesh(
            bm,
            size=(0.14, 1.92, 0.05),
            center=(rx, -0.80, 1.795),
            swatch_name="lateriteDark" if (r_idx % 2 == 0) else "brickDark",
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
            "landmarkPart": "awning",
            "stepHeight": STEP_HEIGHTS["awning_roof"],
        },
    )
    return obj


# ----------------------------- 4. Ala de Salas + Telhado (OrigensSchoolWing)


def make_school_wing(
    name: str = "OrigensSchoolWing",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Build the main Brazilian school classroom wing, terracotta roof, ridge walkway, and graduation pedestal.

    Architectural features & step progression:
      - Cream paper walls (`paper` #f4ead4) with a `laterite` / `brickDark` masonry baseboard,
        `paperWarm` structural pilasters, and a `cerradoGreen` + `dataTeal` school frieze band.
      - Entry double doors on the right bay (`woodDark`, `windowGlow` transom, `dataTeal` portal frame)
        plus a painted school signboard plaque above the entrance.
      - Rhythms of recessed classroom windows along both the front (-Y) and back (+Y) facades
        (`ink` frames, warm `windowGlow` glass panes, `dataTeal` sills, `cerradoGreen` sunshades).
      - Terracotta tiled roof (`brick` #b5562c / `lateriteDark` #a8432a) with walkable eave ledge
        at z = 3.10 m (+1.30 m jump from the 1.80 m awning), flat `paperWarm` ridge walkway at
        z = 3.40 m, and the central graduation podium/pedestal topping out at z = 3.70 m where
        `OrigensCapelo` rests.
    """
    bm = bmesh.new()
    wing_y = 1.65

    # 1. Masonry foundation plinth (z = 0.00..0.34 m)
    _add_box_to_bmesh(
        bm,
        size=(8.50, 3.50, 0.34),
        center=(0.00, wing_y, 0.17),
        swatch_name="lateriteDark",
        face_swatches={"-Y": "brickDark", "+Y": "brickDark", "+Z": "paperWarm"},
    )

    # 2. Main cream `paper` classroom wing walls (z = 0.34..2.96 m)
    _add_box_to_bmesh(
        bm,
        size=(8.30, 3.30, 2.62),
        center=(0.00, wing_y, 1.65),
        swatch_name="paper",
        face_swatches={
            "-Y": "paper",
            "+Y": "paper",
            "-X": "paperWarm",
            "+X": "paperWarm",
            "+Z": "paperShadow",
        },
    )

    # 3. Structural pilasters dividing the facade into 4 classroom bays (X = -4.05, -1.95, 0.15, 2.15, 4.05)
    pilaster_xs = (-4.05, -1.95, 0.15, 2.15, 4.05)
    for px in pilaster_xs:
        _add_box_to_bmesh(
            bm,
            size=(0.24, 3.44, 2.68),
            center=(px, wing_y, 1.66),
            swatch_name="paperWarm",
        )

    # Horizontal school stripe bands along front and back walls (`cerradoGreen` lower dado + `dataTeal` upper frieze)
    _add_box_to_bmesh(
        bm,
        size=(8.38, 3.38, 0.14),
        center=(0.00, wing_y, 0.88),
        swatch_name="cerradoGreen",
    )
    _add_box_to_bmesh(
        bm,
        size=(8.42, 3.42, 0.18),
        center=(0.00, wing_y, 2.84),
        swatch_name="dataTeal",
    )

    # 4. Rhythm of classroom windows on Front (-Y) and Back (+Y) walls
    # Front windows: 3 double-pane classroom windows at X = -3.00, -0.90, +1.15 (at Z = 2.22 m, well above the 1.80 m awning!)
    front_win_xs = (-3.00, -0.90, 1.15)
    front_y = wing_y - 1.65  # y = 0.00
    for wx in front_win_xs:
        # Outer ink window casing
        _add_box_to_bmesh(
            bm,
            size=(1.36, 0.10, 0.78),
            center=(wx, front_y - 0.02, 2.24),
            swatch_name="ink",
        )
        # Left & right glowing panes (`windowGlow`) separated by central `ink` mullion
        for pane_dx in (-0.31, 0.31):
            _add_box_to_bmesh(
                bm,
                size=(0.54, 0.08, 0.60),
                center=(wx + pane_dx, front_y - 0.04, 2.24),
                swatch_name="windowGlow",
            )
        # Bottom `dataTeal` window sill
        _add_box_to_bmesh(
            bm,
            size=(1.48, 0.16, 0.08),
            center=(wx, front_y - 0.05, 1.83),
            swatch_name="dataTeal",
        )
        # Top `cerradoGreen` brise-soleil lintel hood
        _add_box_to_bmesh(
            bm,
            size=(1.50, 0.22, 0.08),
            center=(wx, front_y - 0.08, 2.66),
            swatch_name="cerradoGreen",
        )

    # Back facade windows (+Y wall, 3 bays at X = -3.00, 0.15, +3.10)
    back_win_xs = (-3.00, 0.15, 3.10)
    back_y = wing_y + 1.65  # y = 3.30
    for wx in back_win_xs:
        _add_box_to_bmesh(
            bm,
            size=(1.32, 0.10, 0.88),
            center=(wx, back_y + 0.02, 1.85),
            swatch_name="ink",
        )
        _add_box_to_bmesh(
            bm,
            size=(1.12, 0.08, 0.70),
            center=(wx, back_y + 0.04, 1.85),
            swatch_name="windowGlow",
        )
        _add_box_to_bmesh(
            bm,
            size=(1.44, 0.16, 0.08),
            center=(wx, back_y + 0.05, 1.38),
            swatch_name="dataTeal",
        )

    # Side gable high windows (-X and +X walls)
    for sx in (-1.0, 1.0):
        side_x = sx * 4.15
        _add_box_to_bmesh(
            bm,
            size=(0.10, 1.30, 0.78),
            center=(side_x + sx * 0.02, wing_y, 1.95),
            swatch_name="ink",
        )
        _add_box_to_bmesh(
            bm,
            size=(0.08, 1.10, 0.58),
            center=(side_x + sx * 0.04, wing_y, 1.95),
            swatch_name="windowGlow",
        )
        _add_box_to_bmesh(
            bm,
            size=(0.16, 1.44, 0.08),
            center=(side_x + sx * 0.05, wing_y, 1.52),
            swatch_name="dataTeal",
        )

    # 5. Main school entrance double doors + school sign plaque in the right bay (X = +3.10)
    door_x = 3.10
    # Entrance step stoop (z = 0.14..0.34 m)
    _add_box_to_bmesh(
        bm,
        size=(1.68, 0.62, 0.20),
        center=(door_x, front_y - 0.30, 0.24),
        swatch_name="concrete",
        face_swatches={"+Z": "paperWarm"},
    )
    # Portal frame (`ink` & `dataTeal`)
    _add_box_to_bmesh(
        bm,
        size=(1.42, 0.14, 2.12),
        center=(door_x, front_y - 0.03, 1.40),
        swatch_name="ink",
    )
    # Double wooden doors (`woodDark` + `wood` panels + `windowGlow` upper transom)
    for leaf_dx in (-0.30, 0.30):
        _add_box_to_bmesh(
            bm,
            size=(0.54, 0.10, 1.54),
            center=(door_x + leaf_dx, front_y - 0.06, 1.12),
            swatch_name="wood",
            face_swatches={"-Y": "woodDark"},
        )
    # Transom window above double doors
    _add_box_to_bmesh(
        bm,
        size=(1.16, 0.10, 0.34),
        center=(door_x, front_y - 0.06, 2.16),
        swatch_name="windowGlow",
    )
    # School facade signboard above door (`paperWarm` board with `ink` border and `signal` emblem dot)
    _add_box_to_bmesh(
        bm,
        size=(1.64, 0.12, 0.34),
        center=(door_x, front_y - 0.07, 2.62),
        swatch_name="ink",
        face_swatches={"-Y": "paperWarm"},
    )
    _add_box_to_bmesh(
        bm,
        size=(0.18, 0.08, 0.18),
        center=(door_x - 0.58, front_y - 0.11, 2.62),
        swatch_name="signal",
    )
    _add_box_to_bmesh(
        bm,
        size=(0.88, 0.08, 0.12),
        center=(door_x + 0.12, front_y - 0.11, 2.62),
        swatch_name="dataTeal",
    )

    # 6. Terracotta tiled roof + walkable eave deck (z = 2.96..3.10 m) & flat ridge walkway (z = 3.40 m)
    # Eave cornice ledge (walkable outer roof shelf at z = 3.10 m, overhanging the walls)
    _add_box_to_bmesh(
        bm,
        size=(8.96, 3.96, 0.14),
        center=(0.00, wing_y, 3.03),
        swatch_name="paperWarm",
        face_swatches={
            "+Z": "brick",
            "-Z": "paperShadow",
            "-Y": "paperWarm",
            "+Y": "paperWarm",
        },
    )

    # Sloped terracotta roof volume rising from eave z = 3.10 m to flat ridge walkway z = 3.40 m
    _add_gabled_roof_prism_to_bmesh(
        bm,
        span_x=8.76,
        span_y=3.66,
        z_eave=3.10,
        z_ridge=3.36,
        ridge_flat_y=1.34,
        center_xy=(0.00, wing_y),
        slope_swatch="brick",
        ridge_swatch="paperWarm",
        gable_swatch="paper",
        soffit_swatch="paperShadow",
    )

    # Terracotta barrel-tile ribs along both front and back roof slopes for rich Brazilian roof texture
    n_tile_ribs = 6
    for t_idx in range(n_tile_ribs):
        tx = -3.85 + t_idx * 1.54
        rib_swatch = "lateriteDark" if (t_idx % 2 == 0) else "brickDark"
        # Front roof slope rib (-Y side)
        _add_box_to_bmesh(
            bm,
            size=(0.22, 1.18, 0.06),
            center=(tx, wing_y - 1.22, 3.24),
            swatch_name=rib_swatch,
            rotation_euler=(math.radians(12.5), 0.0, 0.0),
        )
        # Back roof slope rib (+Y side)
        _add_box_to_bmesh(
            bm,
            size=(0.22, 1.18, 0.06),
            center=(tx, wing_y + 1.22, 3.24),
            swatch_name=rib_swatch,
            rotation_euler=(math.radians(-12.5), 0.0, 0.0),
        )

    # Flat ridge walkway deck along the roof spine (top at exact z = 3.40 m!)
    _add_box_to_bmesh(
        bm,
        size=(8.60, 1.28, 0.08),
        center=(0.00, wing_y, 3.36),
        swatch_name="paperWarm",
        face_swatches={
            "+Z": "paperWarm",
            "-Y": "lateriteDark",
            "+Y": "lateriteDark",
        },
    )

    # 7. Central Graduation Pedestal / Podium at the roof peak (z = 3.40..3.70 m)
    # Lower pedestal step (`ink` + `dataTeal`, z = 3.40..3.56 m)
    _add_box_to_bmesh(
        bm,
        size=(1.44, 1.16, 0.16),
        center=(0.00, wing_y, 3.48),
        swatch_name="ink",
        face_swatches={"+Z": "dataTeal"},
    )
    # Upper graduation cushion/plinth (`paper` + `ipeGold` trim, z = 3.56..3.70 m -> top at z = 3.70 m!)
    _add_box_to_bmesh(
        bm,
        size=(1.04, 0.92, 0.14),
        center=(0.00, wing_y, 3.63),
        swatch_name="paper",
        face_swatches={
            "+Z": "paperWarm",
            "-Y": "ipeGold",
            "+Y": "ipeGold",
            "-X": "ipeGold",
            "+X": "ipeGold",
        },
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
            "landmarkPart": "classroom_wing",
            "eaveRoofHeight": STEP_HEIGHTS["wing_eave_roof"],
            "ridgeWalkwayHeight": STEP_HEIGHTS["wing_ridge_walkway"],
            "pedestalHeight": STEP_HEIGHTS["graduation_pedestal"],
        },
    )
    return obj


# ---------------------------------------------- 5. Capelo (OrigensCapelo)


def make_origens_capelo(
    name: str = "OrigensCapelo",
    location: tuple[float, float, float] = (0.0, 1.65, 3.70),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Build the graduation mortarboard cap (`OrigensCapelo`) as a distinct mesh object.

    Design (§2.8, §4.3 O8, T2.13c, T2.19c):
      - Local pivot at the bottom of the skullcap (z_local = 0.0) so that placing the
        object at `(0.0, 1.65, 3.70)` seats it directly on the 3.70 m roof-peak pedestal
        AND allows T2.19c to attach/animate `OrigensCapelo` directly onto Victor's `head`
        bone in runtime!
      - Octagonal academic skullcap (`ink` #0a0a0a) with a warm `paper` / `ipeGold` inner
        headband trim.
      - Classic diamond-oriented square mortarboard top (`ink` #0a0a0a) tilted slightly
        for a lively silhouette.
      - Raised red `signal` (#f50000) center button, draped red `signal` tassel cord, and
        a hanging red `signal` tassel fringe drop with an `ipeGold` year-band ring (2011).
    """
    bm = bmesh.new()

    # 1. Headband base ring (z_local = 0.00..0.04 m) + octagonal skullcap crown (z_local = 0.04..0.22 m)
    _add_frustum_to_bmesh(
        bm,
        radius_bottom=0.28,
        radius_top=0.29,
        height=0.04,
        segments=8,
        center=(0.0, 0.0, 0.02),
        swatch_name="ipeGold",
    )
    _add_frustum_to_bmesh(
        bm,
        radius_bottom=0.29,
        radius_top=0.33,
        height=0.18,
        segments=8,
        center=(0.0, 0.0, 0.13),
        swatch_name="ink",
    )

    # 2. Classic square academic mortarboard top (`ink`), rotated 45 deg into a diamond
    board_yaw = math.radians(40.0)
    _add_box_to_bmesh(
        bm,
        size=(0.76, 0.76, 0.055),
        center=(0.0, 0.0, 0.24),
        swatch_name="ink",
        rotation_euler=(0.0, 0.0, board_yaw),
        face_swatches={"-Z": "charcoal"},
    )
    # Subtle inner recessed board border (`charcoal` / `ink`)
    _add_box_to_bmesh(
        bm,
        size=(0.64, 0.64, 0.036),
        center=(0.0, 0.0, 0.264),
        swatch_name="charcoal",
        rotation_euler=(0.0, 0.0, board_yaw),
    )

    # 3. Red `signal` (#f50000) center crown button (z_local = 0.27..0.32 m)
    _add_frustum_to_bmesh(
        bm,
        radius_bottom=0.075,
        radius_top=0.055,
        height=0.045,
        segments=8,
        center=(0.0, 0.0, 0.295),
        swatch_name="signal",
    )

    # 4. Red `signal` tassel cord draping from the center button toward the front-right edge (+X, -Y)
    # Cord segment 1: across the top of the mortarboard
    _add_box_to_bmesh(
        bm,
        size=(0.30, 0.045, 0.032),
        center=(0.13, -0.11, 0.285),
        swatch_name="signal",
        rotation_euler=(0.0, 0.0, math.radians(-38.0)),
    )
    # Cord segment 2: curving over the mortarboard edge
    _add_box_to_bmesh(
        bm,
        size=(0.12, 0.045, 0.045),
        center=(0.27, -0.22, 0.255),
        swatch_name="signal",
        rotation_euler=(0.0, math.radians(35.0), math.radians(-38.0)),
    )
    # Golden `ipeGold` 2011 signet band around the hanging tassel neck
    _add_frustum_to_bmesh(
        bm,
        radius_bottom=0.042,
        radius_top=0.048,
        height=0.04,
        segments=8,
        center=(0.30, -0.25, 0.20),
        swatch_name="ipeGold",
    )
    # Hanging red `signal` tassel fringe bell (z_local = 0.03..0.18 m)
    _add_frustum_to_bmesh(
        bm,
        radius_bottom=0.072,
        radius_top=0.038,
        height=0.15,
        segments=8,
        center=(0.30, -0.25, 0.105),
        swatch_name="signal",
    )

    obj = _finalize_bmesh_object(
        bm,
        name=name,
        location=location,
        collection=collection,
        bevel_width=0.008,
        bevel_segments=1,
        angle_deg=32.0,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "landmarkPart": "capelo",
            "milestoneId": "2011",
            "attachBone": "head",
            "detachableAccessory": True,
        },
    )
    return obj


# --------------------------------------------------- Complete Landmark Builder


def make_school_landmark(
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
    include_colliders: bool = True,
) -> dict[str, Any]:
    """Build the O8 Era 1 'Origens' School Landmark (Marco 2011: 'Terminei o ensino médio').

    Creates:
      - `OrigensSchoolCourtyard`: paved courtyard + climbable 0.90 m planter/bench step.
      - `OrigensSchoolFlagpole`: tall flagpole (`mastro`) + waving pennant in the courtyard.
      - `OrigensSchoolAwning`: low breezeway awning (`toldo`, walkable roof at 1.80 m).
      - `OrigensSchoolWing`: classroom wing (`paper` walls, recessed windows, terracotta roof
        at 3.10 m, flat ridge walkway at 3.40 m, graduation pedestal at 3.70 m).
      - `OrigensCapelo`: distinct mesh object perched at `(0.0, 1.65, 3.70)` ready to detach
        and fly onto Victor's head (`T2.19c`).
      - Walkable `cuboid*` colliders via `vn_collide`.
    """
    col = vn_scene.ensure_collection("OrigensSchool") if collection is None else vn_scene.ensure_collection(collection) if isinstance(collection, str) else collection
    ox, oy, oz = (float(v) for v in location)

    courtyard = make_school_courtyard(
        name="OrigensSchoolCourtyard",
        location=(ox, oy, oz),
        collection=col,
    )
    flagpole = make_school_flagpole(
        name="OrigensSchoolFlagpole",
        location=(ox, oy, oz),
        collection=col,
    )
    awning = make_school_awning(
        name="OrigensSchoolAwning",
        location=(ox, oy, oz),
        collection=col,
    )
    wing = make_school_wing(
        name="OrigensSchoolWing",
        location=(ox, oy, oz),
        collection=col,
    )
    capelo = make_origens_capelo(
        name="OrigensCapelo",
        location=(ox + 0.00, oy + 1.65, oz + STEP_HEIGHTS["graduation_pedestal"]),
        collection=col,
    )

    meshes: dict[str, bpy.types.Object] = {
        "OrigensSchoolCourtyard": courtyard,
        "OrigensSchoolFlagpole": flagpole,
        "OrigensSchoolAwning": awning,
        "OrigensSchoolWing": wing,
        "OrigensCapelo": capelo,
    }

    # Apply manual overrides if game/blender/manual/origens_school.blend exists
    vn_manual.apply_manual_overrides(
        ASSET_NAME,
        objects=list(meshes.values()),
        preserve_transform=True,
    )

    colliders: dict[str, bpy.types.Object] = {}
    if include_colliders:
        # 1. Courtyard paving slab (top at z = 0.14 m)
        colliders["cuboidSchoolCourtyardSlab"] = vn_collide.add_cuboid(
            name="cuboidSchoolCourtyardSlab",
            size=(9.10, 3.70, 0.14),
            location=(ox + 0.00, oy - 2.50, oz + 0.07),
            parent=courtyard,
            props={"surface": "concrete", "stepOrder": 0},
            collection=col,
        )
        # 2. Low invitation bench step (top at z = 0.48 m)
        colliders["cuboidSchoolBenchLow"] = vn_collide.add_cuboid(
            name="cuboidSchoolBenchLow",
            size=(2.50, 0.56, 0.48),
            location=(ox - 2.60, oy - 3.55, oz + 0.24),
            parent=courtyard,
            props={"surface": "wood", "stepOrder": 1, "topZ": 0.48},
            collection=col,
        )
        # 3. Climbable courtyard planter/bench step (top at z = 0.90 m)
        colliders["cuboidSchoolCourtyardStep"] = vn_collide.add_cuboid(
            name="cuboidSchoolCourtyardStep",
            size=(2.72, 1.72, 0.90),
            location=(ox - 2.60, oy - 2.45, oz + 0.45),
            parent=courtyard,
            props={"surface": "brick", "stepOrder": 2, "topZ": STEP_HEIGHTS["courtyard_step"]},
            collection=col,
        )
        # 4. Flagpole plinth collider
        colliders["cuboidSchoolFlagpoleBase"] = vn_collide.add_cuboid(
            name="cuboidSchoolFlagpoleBase",
            size=(1.10, 1.10, 0.78),
            location=(ox + 2.85, oy - 2.65, oz + 0.39),
            parent=flagpole,
            props={"surface": "stone"},
            collection=col,
        )
        # 5. Walkable breezeway awning roof collider (top at z = 1.80 m)
        colliders["cuboidSchoolAwningRoof"] = vn_collide.add_cuboid(
            name="cuboidSchoolAwningRoof",
            size=(3.76, 2.10, 0.22),
            location=(ox - 1.95, oy - 0.80, oz + 1.69),
            parent=awning,
            props={"surface": "tile", "stepOrder": 3, "topZ": STEP_HEIGHTS["awning_roof"]},
            collection=col,
        )
        # 6. Main classroom wing walls blocker (z = 0.00..2.96 m)
        colliders["cuboidSchoolWingWalls"] = vn_collide.add_cuboid(
            name="cuboidSchoolWingWalls",
            size=(8.42, 3.42, 2.96),
            location=(ox + 0.00, oy + 1.65, oz + 1.48),
            parent=wing,
            props={"surface": "wall"},
            collection=col,
        )
        # 7. Walkable classroom wing eave roof deck (top at z = 3.10 m)
        colliders["cuboidSchoolWingRoof"] = vn_collide.add_cuboid(
            name="cuboidSchoolWingRoof",
            size=(8.96, 3.96, 0.20),
            location=(ox + 0.00, oy + 1.65, oz + 3.00),
            parent=wing,
            props={"surface": "tile", "stepOrder": 4, "topZ": STEP_HEIGHTS["wing_eave_roof"]},
            collection=col,
        )
        # 8. Walkable roof ridge walkway (top at z = 3.40 m)
        colliders["cuboidSchoolRidgeWalkway"] = vn_collide.add_cuboid(
            name="cuboidSchoolRidgeWalkway",
            size=(8.60, 1.32, 0.30),
            location=(ox + 0.00, oy + 1.65, oz + 3.25),
            parent=wing,
            props={"surface": "tile", "stepOrder": 5, "topZ": STEP_HEIGHTS["wing_ridge_walkway"]},
            collection=col,
        )
        # 9. Graduation pedestal collider at roof peak (top at z = 3.70 m)
        colliders["cuboidSchoolGraduationPedestal"] = vn_collide.add_cuboid(
            name="cuboidSchoolGraduationPedestal",
            size=(1.44, 1.16, 0.30),
            location=(ox + 0.00, oy + 1.65, oz + 3.55),
            parent=wing,
            props={"surface": "stone", "stepOrder": 6, "topZ": STEP_HEIGHTS["graduation_pedestal"]},
            collection=col,
        )

    return {
        "collection": col,
        "meshes": meshes,
        "colliders": colliders,
        "step_heights": dict(STEP_HEIGHTS),
    }


# -------------------------------------------- Verification & Budget Audit


def _build_uv_to_swatch_lookup() -> dict[str, tuple[float, float]]:
    return {
        name: vn_palette.get_swatch_uv(name, gltf=False)
        for name in vn_palette.list_swatches()
    }


def inspect_object_swatches(obj: bpy.types.Object, tol: float = 0.015) -> dict[str, int]:
    """Return a histogram `{swatch_name: polygon_count}` for all faces on `obj`."""
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        raise AssertionError(f"{obj.name} has no active UV layer")

    lookup = _build_uv_to_swatch_lookup()
    counts: dict[str, int] = {}

    for poly in mesh.polygons:
        if not poly.loop_indices:
            continue
        u = sum(uv_layer.data[idx].uv[0] for idx in poly.loop_indices) / len(poly.loop_indices)
        v = sum(uv_layer.data[idx].uv[1] for idx in poly.loop_indices) / len(poly.loop_indices)

        matched = None
        best_dist = math.inf
        for sw_name, (su, sv) in lookup.items():
            dist = math.hypot(u - su, v - sv)
            if dist < best_dist:
                best_dist = dist
                matched = sw_name

        if matched is None or best_dist > tol:
            raise AssertionError(
                f"{obj.name} face {poly.index} UV ({u:.4f}, {v:.4f}) does not snap to any palette swatch "
                f"(nearest={matched} dist={best_dist:.4f})"
            )
        counts[matched] = counts.get(matched, 0) + 1

    return counts


def inspect_mesh_integrity(obj: bpy.types.Object) -> dict[str, Any]:
    """Evaluate triangle count, world Z bounds, manifold status, NaN/Inf coords, and degenerate faces."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    eval_obj = obj.evaluated_get(depsgraph)
    mesh_eval = eval_obj.to_mesh()

    try:
        mesh_eval.calc_loop_triangles()
        tris = len(mesh_eval.loop_triangles)

        nan_verts = 0
        min_z = math.inf
        max_z = -math.inf
        for v in mesh_eval.vertices:
            if not (math.isfinite(v.co.x) and math.isfinite(v.co.y) and math.isfinite(v.co.z)):
                nan_verts += 1
            world_pt = obj.matrix_world @ v.co
            min_z = min(min_z, float(world_pt.z))
            max_z = max(max_z, float(world_pt.z))

        bm = bmesh.new()
        bm.from_mesh(mesh_eval)
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.faces.ensure_lookup_table()

        non_manifold_edges = sum(1 for e in bm.edges if not e.is_manifold)
        zero_area_faces = sum(1 for f in bm.faces if f.calc_area() < 1e-8)
        bm.free()
    finally:
        eval_obj.to_mesh_clear()

    mat_names = [s.material.name for s in obj.material_slots if s.material is not None]
    return {
        "name": obj.name,
        "triangles": tris,
        "min_z": min_z,
        "max_z": max_z,
        "nan_verts": nan_verts,
        "non_manifold_edges": non_manifold_edges,
        "zero_area_faces": zero_area_faces,
        "materials": mat_names,
    }


def verify_school_landmark(result: dict[str, Any]) -> dict[str, Any]:
    """Verify §5.4 triangle budget, `OrigensCapelo` distinct mesh node, colliders, and step heights."""
    meshes: dict[str, bpy.types.Object] = result["meshes"]
    colliders: dict[str, bpy.types.Object] = result["colliders"]

    required_meshes = (
        "OrigensSchoolCourtyard",
        "OrigensSchoolFlagpole",
        "OrigensSchoolAwning",
        "OrigensSchoolWing",
        "OrigensCapelo",
    )
    for req in required_meshes:
        if req not in meshes:
            raise AssertionError(f"Missing required landmark mesh: {req}")

    # Assert OrigensCapelo is a distinct MESH object in bpy.data.objects
    capelo_obj = bpy.data.objects.get("OrigensCapelo")
    if capelo_obj is None or capelo_obj.type != "MESH" or capelo_obj.data is None:
        raise AssertionError("OrigensCapelo must exist as a distinct MESH object")

    total_tris = 0
    per_mesh_report: dict[str, Any] = {}

    for name, obj in meshes.items():
        integrity = inspect_mesh_integrity(obj)
        swatches = inspect_object_swatches(obj)
        total_tris += integrity["triangles"]
        per_mesh_report[name] = {
            **integrity,
            "swatches": swatches,
        }

        if integrity["materials"] != ["palette"]:
            raise AssertionError(
                f"{name} must use single ['palette'] material, got {integrity['materials']}"
            )
        if integrity["nan_verts"] != 0:
            raise AssertionError(f"{name} has {integrity['nan_verts']} NaN/Inf vertices")
        if integrity["non_manifold_edges"] != 0:
            raise AssertionError(
                f"{name} has {integrity['non_manifold_edges']} non-manifold edges"
            )
        if integrity["zero_area_faces"] != 0:
            raise AssertionError(
                f"{name} has {integrity['zero_area_faces']} degenerate zero-area faces"
            )

    if not (TRI_BUDGET_MIN <= total_tris <= TRI_BUDGET_MAX):
        raise AssertionError(
            f"Origens school landmark total triangles {total_tris} outside §5.4 budget "
            f"[{TRI_BUDGET_MIN}, {TRI_BUDGET_MAX}]"
        )

    # Verify OrigensCapelo swatches (ink mortarboard + red signal tassel/button) and roof-peak elevation
    capelo_info = per_mesh_report["OrigensCapelo"]
    for req_sw in ("ink", "signal"):
        if capelo_info["swatches"].get(req_sw, 0) <= 0:
            raise AssertionError(
                f"OrigensCapelo must include swatch {req_sw!r}, got {capelo_info['swatches']}"
            )
    if abs(capelo_info["min_z"] - STEP_HEIGHTS["graduation_pedestal"]) > 0.05:
        raise AssertionError(
            f"OrigensCapelo base min_z ({capelo_info['min_z']:.3f} m) must rest on graduation pedestal "
            f"({STEP_HEIGHTS['graduation_pedestal']:.2f} m)"
        )

    # Verify rooftop platforming step heights are strictly ascending and each jump is < 2.0 m jump apex
    ordered_steps = [
        ("ground", 0.00),
        ("courtyard_paving", STEP_HEIGHTS["courtyard_paving"]),
        ("courtyard_step", STEP_HEIGHTS["courtyard_step"]),
        ("awning_roof", STEP_HEIGHTS["awning_roof"]),
        ("wing_eave_roof", STEP_HEIGHTS["wing_eave_roof"]),
        ("wing_ridge_walkway", STEP_HEIGHTS["wing_ridge_walkway"]),
        ("graduation_pedestal", STEP_HEIGHTS["graduation_pedestal"]),
    ]
    step_deltas: list[tuple[str, str, float, float]] = []
    for idx in range(len(ordered_steps) - 1):
        from_name, z0 = ordered_steps[idx]
        to_name, z1 = ordered_steps[idx + 1]
        dz = z1 - z0
        if dz <= 0.0 or dz > JUMP_APEX_M * 0.85:
            raise AssertionError(
                f"Invalid platform step progression {from_name} ({z0:.2f} m) -> {to_name} ({z1:.2f} m): "
                f"delta={dz:.2f} m (must be in (0, {JUMP_APEX_M * 0.85:.2f}])"
            )
        step_deltas.append((from_name, to_name, z1, dz))

    if len(colliders) < 6:
        raise AssertionError(f"Expected >= 6 cuboid* colliders, found {len(colliders)}")

    print("==================================================================")
    print("ORIGENS_SCHOOL_LANDMARK_PASS | T2.13c Escola + Mastro + Capelo")
    print("==================================================================")
    for name in required_meshes:
        info = per_mesh_report[name]
        print(
            f"  [PASS] {name:<23} | {info['triangles']:>4} tris | "
            f"z=[{info['min_z']:.2f}..{info['max_z']:.2f}] m | "
            f"non_manifold={info['non_manifold_edges']} | swatches={info['swatches']}"
        )
    print(
        f"  [PASS] Total Triangles: {total_tris} tris "
        f"(§5.4 budget {TRI_BUDGET_MIN}..{TRI_BUDGET_MAX}) | Materials: ['palette']"
    )
    print("  [PASS] Rooftop Jump Progression ('Subir pelos telhados', jump apex 2.00 m):")
    for from_name, to_name, z1, dz in step_deltas:
        print(f"         {from_name:<19} -> {to_name:<20} : top z={z1:.2f} m (jump +{dz:.2f} m)")
    print(
        f"  [PASS] OrigensCapelo verified as distinct MESH at z={capelo_obj.location.z:.2f} m "
        f"(attachBone={capelo_obj.get('attachBone')!r})"
    )
    print(f"  [PASS] Colliders: {len(colliders)} ({sorted(colliders.keys())})")
    print("==================================================================")

    return {
        "total_triangles": total_tris,
        "meshes": per_mesh_report,
        "step_deltas": step_deltas,
        "colliders": sorted(colliders.keys()),
    }


def main() -> None:
    vn_scene.reset_scene(name="OrigensSchoolScene")
    result = make_school_landmark(
        location=(0.0, 0.0, 0.0),
        collection="OrigensSchool",
        include_colliders=True,
    )
    verify_school_landmark(result)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)

    glb_stats = vn_export.export_glb(
        str(GLB_OUT_PATH),
        collections=["OrigensSchool"],
    )

    # Verify OrigensCapelo exists as a distinct node/mesh inside the exported GLB
    glb_info = vn_export.inspect_glb(str(GLB_OUT_PATH))
    gltf_node_names = {n.get("name") for n in glb_info["gltf"].get("nodes", [])}
    if "OrigensCapelo" not in gltf_node_names:
        raise AssertionError(
            f"'OrigensCapelo' missing from exported GLB nodes: {sorted(gltf_node_names)}"
        )
    print(
        f"[origens_school] GLB verified: 'OrigensCapelo' present in {glb_stats['nodes']} nodes "
        f"({glb_stats['triangles']} tris, {glb_stats['materials']} mat)"
    )

    vn_scene.render_3views(
        str(PREVIEW_OUT_PATH),
        size=512,
    )


if __name__ == "__main__":
    main()
