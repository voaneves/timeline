"""Hero Landmark T2.13a: Casa Natal + Ipê Pop-up for Era 1 'Origens' (Araguaína/TO).

Builds the O1/O2/O11 hero landmark set piece (PLAN-3D §2.7, §2.8, §4.3, §5.4):
  - `Casa Natal` (pop-up diorama style): warm Brazilian northern town house with beveled
    paper walls (`paper` #f4ead4 / `paperWarm` #efe4c5), pop-up paper-fold base trim
    (`paper` + `ink`), pitched ceramic tile roof (`brick` #b5562c / `lateriteDark` #a8432a /
    `brickDark` #8b3d1e with layered tile courses), shady front porch (`varanda`) with
    wooden posts (`wood` #9a6840), recessed shuttered windows (`ink` + `wood` + `windowGlow`),
    front door (`woodDark` + `ink` frame), low laterite curb (`meio-fio` in `laterite` /
    `paperShadow`), and the origin ribbon threshold (`a Linha` in `signal` #f50000) emerging
    from the front doorstep.
  - Paired two-state Ipê-Amarelo tree (`OrigensIpeTrunk` + `OrigensIpeBloom`), reusing
    `cerrado_kit` flora helpers (`_append_swept_tube`, `_append_icosphere_lobe`,
    `_append_transformed_bmesh`, `vn_shapes.make_blob`) so the O2 pop-up reveal (`T2.19a`)
    can animate the house unfolding and the ipê exploding into golden-yellow blossoms
    (`ipeGold` #f7c531).
  - Clean named sub-meshes (`OrigensHouseBody`, `OrigensHouseRoof`, `OrigensHousePorch`,
    `OrigensIpeTrunk`, `OrigensIpeBloom`) + analytical `cuboid*` colliders (`vn_collide`) for
    house body, porch steps, curb, and tree trunk.

Run standalone:
    blender.exe -b -P game/blender/kits/origens_house_ipe.py
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

HERE = Path(__file__).resolve().parent
BLENDER_DIR = HERE.parent
if str(BLENDER_DIR) not in sys.path:
    sys.path.insert(0, str(BLENDER_DIR))

from kits import cerrado_kit  # noqa: E402
from lib import (  # noqa: E402
    vn_bevel,
    vn_collide,
    vn_export,
    vn_manual,
    vn_palette,
    vn_scene,
    vn_shapes,
)

ASSET_NAME = "origens_house_ipe"
OUT_DIR = BLENDER_DIR / "out"
PREVIEWS_DIR = OUT_DIR / "previews"
GLB_OUT_PATH = OUT_DIR / "origens_house_ipe.glb"
PREVIEW_OUT_PATH = PREVIEWS_DIR / "t213a_house_ipe.png"

LANDMARK_TRI_BUDGET: tuple[int, int] = (1000, 6000)

IPE_OFFSET_LOCAL: tuple[float, float, float] = (3.45, -0.55, 0.0)


# ------------------------------------------------------------------ bmesh primitives


def _tag_faces(
    bm: bmesh.types.BMesh,
    faces: Iterable[bmesh.types.BMFace],
    swatch: str,
) -> None:
    cerrado_kit._tag_faces_swatch(bm, faces, swatch)


def _add_box(
    bm: bmesh.types.BMesh,
    size: tuple[float, float, float],
    center: tuple[float, float, float],
    swatch: str,
    rotation_euler: tuple[float, float, float] | None = None,
    bevel_width: float = 0.0,
) -> list[bmesh.types.BMFace]:
    """Append an oriented box to `bm` (optionally single-segment beveled) and assign `swatch` UVs."""
    ret = bmesh.ops.create_cube(bm, size=1.0)
    verts = list(ret["verts"])
    vert_set = set(verts)

    sx, sy, sz = (float(v) for v in size)
    scale_mat = Matrix.Diagonal((sx, sy, sz, 1.0))
    bmesh.ops.transform(bm, matrix=scale_mat, verts=verts)

    if bevel_width > 1e-4:
        edges = [e for e in bm.edges if all(v in vert_set for v in e.verts)]
        bev = bmesh.ops.bevel(
            bm,
            geom=edges,
            offset=float(bevel_width),
            offset_type="OFFSET",
            segments=1,
            profile=0.5,
            affect="EDGES",
            clamp_overlap=True,
        )
        vert_set = {v for v in vert_set if v.is_valid}
        for v in bev.get("verts", []):
            if v.is_valid:
                vert_set.add(v)
        verts = list(vert_set)

    if rotation_euler is not None:
        rot_mat = Euler(tuple(float(a) for a in rotation_euler), "XYZ").to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=rot_mat, verts=verts)

    bmesh.ops.translate(bm, vec=Vector(tuple(float(c) for c in center)), verts=verts)

    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
    _tag_faces(bm, faces, swatch)
    return faces


def _add_prism_extruded_x(
    bm: bmesh.types.BMesh,
    x_min: float,
    x_max: float,
    yz_poly: Sequence[tuple[float, float]],
    swatch: str,
    front_back_swatch: str | None = None,
) -> list[bmesh.types.BMFace]:
    """Extrude a 2D (y, z) polygon along X from `x_min` to `x_max` (CCW in YZ viewed from +X)."""
    n = len(yz_poly)
    if n < 3:
        raise ValueError("_add_prism_extruded_x requires at least 3 YZ vertices")

    v_left = [bm.verts.new((float(x_min), float(y), float(z))) for y, z in yz_poly]
    v_right = [bm.verts.new((float(x_max), float(y), float(z))) for y, z in yz_poly]

    side_faces: list[bmesh.types.BMFace] = []
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((v_left[i], v_right[i], v_right[j], v_left[j]))
        side_faces.append(f)

    f_left = bm.faces.new(tuple(reversed(v_left)))
    f_right = bm.faces.new(tuple(v_right))

    all_faces = side_faces + [f_left, f_right]
    bmesh.ops.recalc_face_normals(bm, faces=all_faces)

    _tag_faces(bm, side_faces, swatch)
    end_sw = front_back_swatch if front_back_swatch is not None else swatch
    _tag_faces(bm, [f_left, f_right], end_sw)
    return all_faces


def _add_prism_extruded_y(
    bm: bmesh.types.BMesh,
    y_min: float,
    y_max: float,
    xz_poly: Sequence[tuple[float, float]],
    swatch: str,
    end_swatch: str | None = None,
) -> list[bmesh.types.BMFace]:
    """Extrude a 2D (x, z) polygon along Y from `y_min` to `y_max`."""
    n = len(xz_poly)
    if n < 3:
        raise ValueError("_add_prism_extruded_y requires at least 3 XZ vertices")

    v_front = [bm.verts.new((float(x), float(y_min), float(z))) for x, z in xz_poly]
    v_back = [bm.verts.new((float(x), float(y_max), float(z))) for x, z in xz_poly]

    side_faces: list[bmesh.types.BMFace] = []
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((v_front[i], v_front[j], v_back[j], v_back[i]))
        side_faces.append(f)

    f_front = bm.faces.new(tuple(reversed(v_front)))
    f_back = bm.faces.new(tuple(v_back))

    all_faces = side_faces + [f_front, f_back]
    bmesh.ops.recalc_face_normals(bm, faces=all_faces)

    _tag_faces(bm, side_faces, swatch)
    cap_sw = end_swatch if end_swatch is not None else swatch
    _tag_faces(bm, [f_front, f_back], cap_sw)
    return all_faces


def _add_shuttered_window(
    bm: bmesh.types.BMesh,
    center: tuple[float, float, float],
    facing: str,
    width: float = 0.78,
    height: float = 0.88,
) -> None:
    """Build a chunky recessed northern-town shuttered window (`ink` + `wood` + `windowGlow`).

    `facing` is one of `'-Y'` (front facade), `'-X'` (left wall), or `'+X'` (right wall).
    Every element has thickness >= 0.08 m for crisp diorama reading.
    """
    cx, cy, cz = (float(v) for v in center)

    if facing == "-Y":
        # Sill (`paperShadow` / `woodDark`)
        _add_box(bm, (width + 0.24, 0.14, 0.09), (cx, cy - 0.04, cz - height * 0.5 - 0.04), "woodDark")
        # Outer ink frame box
        _add_box(bm, (width + 0.14, 0.09, height + 0.12), (cx, cy - 0.01, cz), "ink")
        # Warm glowing window pane (`windowGlow`)
        _add_box(bm, (width - 0.04, 0.09, height - 0.04), (cx, cy - 0.025, cz), "windowGlow")
        # Mullion crossbars (`ink`, thickness >= 0.08 m)
        _add_box(bm, (0.08, 0.10, height - 0.02), (cx, cy - 0.035, cz), "ink")
        _add_box(bm, (width - 0.02, 0.10, 0.08), (cx, cy - 0.035, cz + 0.04), "ink")
        # Left & right open wooden shutters (`wood` with `woodDark` louver band)
        shutter_w = 0.26
        for side in (-1.0, 1.0):
            sx = cx + side * (width * 0.5 + shutter_w * 0.5 + 0.04)
            yaw = side * math.radians(-14.0)
            _add_box(
                bm,
                (shutter_w, 0.085, height + 0.02),
                (sx, cy - 0.04, cz),
                "wood",
                rotation_euler=(0.0, 0.0, yaw),
            )
            _add_box(
                bm,
                (shutter_w - 0.06, 0.095, 0.12),
                (sx, cy - 0.045, cz + 0.16),
                "woodDark",
                rotation_euler=(0.0, 0.0, yaw),
            )
            _add_box(
                bm,
                (shutter_w - 0.06, 0.095, 0.12),
                (sx, cy - 0.045, cz - 0.16),
                "woodDark",
                rotation_euler=(0.0, 0.0, yaw),
            )
    elif facing in ("-X", "+X"):
        sign = -1.0 if facing == "-X" else 1.0
        _add_box(bm, (0.14, width + 0.24, 0.09), (cx + sign * 0.04, cy, cz - height * 0.5 - 0.04), "woodDark")
        _add_box(bm, (0.09, width + 0.14, height + 0.12), (cx + sign * 0.01, cy, cz), "ink")
        _add_box(bm, (0.09, width - 0.04, height - 0.04), (cx + sign * 0.025, cy, cz), "windowGlow")
        _add_box(bm, (0.10, 0.08, height - 0.02), (cx + sign * 0.035, cy, cz), "ink")
        _add_box(bm, (0.10, width - 0.02, 0.08), (cx + sign * 0.035, cy, cz + 0.04), "ink")
        shutter_w = 0.26
        for side in (-1.0, 1.0):
            sy = cy + side * (width * 0.5 + shutter_w * 0.5 + 0.04)
            yaw = -sign * side * math.radians(14.0)
            _add_box(
                bm,
                (0.085, shutter_w, height + 0.02),
                (cx + sign * 0.04, sy, cz),
                "wood",
                rotation_euler=(0.0, 0.0, yaw),
            )
            _add_box(
                bm,
                (0.095, shutter_w - 0.06, 0.12),
                (cx + sign * 0.045, sy, cz + 0.15),
                "woodDark",
                rotation_euler=(0.0, 0.0, yaw),
            )
            _add_box(
                bm,
                (0.095, shutter_w - 0.06, 0.12),
                (cx + sign * 0.045, sy, cz - 0.15),
                "woodDark",
                rotation_euler=(0.0, 0.0, yaw),
            )
    else:
        raise ValueError(f"Unsupported window facing: {facing!r}")


def _finalize_part_mesh(
    name: str,
    bm: bmesh.types.BMesh,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
    bevel_width: float = 0.015,
    bevel_segments: int = 1,
    angle_deg: float = 35.0,
) -> bpy.types.Object:
    """Convert `bm` into a finished Blender mesh object with shared `'palette'` material."""
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.normal_update()

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(float(v) for v in location)
    vn_scene.link_object(obj, collection)

    # Bind single shared 'palette' material while preserving exact per-face UVs.
    vn_palette.assign(obj, lambda _poly: None)

    if bevel_width > 0.0 and bevel_segments > 0:
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
        keep_sharp=False,
        face_influence=False,
        apply=True,
    )
    return obj


# ------------------------------------------------ 1. OrigensHouseBody (Casa Natal body)


def _make_house_body(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection | str | None,
) -> bpy.types.Object:
    """Build `OrigensHouseBody`: pop-up paper walls, gable attic, front door, and shuttered windows.

    Features:
      - Pop-up diorama paper-fold base card (`paper` #f4ead4 + `ink` #0a0a0a border + corner fold tabs).
      - Laterite Masonry Plinth (`lateriteDark` / `brick`) & cream paper walls (`paper` / `paperWarm`)
        with corner pilasters (`paperShadow`).
      - Pitched gable wall triangle (`paperWarm` with `ink` ridge vent collar).
      - Front door (`woodDark` #734a2b panels, `wood` stiles, `ink` #0a0a0a frame, `windowGlow`
        transom fanlight, and `ipeGold` handle) centered on the front porch wall.
      - Recessed shuttered windows (`ink` + `wood` + `windowGlow`) on front (-Y) and side (-X/+X) walls.
      - Milestone "1994" paper number plaque (`paper` + `ink` + `signal` dot) next to the front door.
    """
    bm = bmesh.new()
    try:
        # 1. Pop-up paper-fold diorama base trim (`paper` card + `ink` fold border + accordion tabs)
        # Sits on z = 0.0 .. 0.14 m so the entire house looks like a pop-up craft unfolding from paper.
        _add_box(bm, (5.20, 4.40, 0.08), (0.0, -0.10, 0.04), "ink", bevel_width=0.015)
        _add_box(bm, (5.04, 4.24, 0.08), (0.0, -0.10, 0.08), "paper", bevel_width=0.015)

        # Four pop-up paper hinge tabs on left/right/back edges (angled crease tabs in `paperWarm` + `ink`)
        for sx in (-1.0, 1.0):
            for y_tab in (-0.85, 0.85):
                _add_box(
                    bm,
                    (0.46, 0.54, 0.08),
                    (sx * 2.58, y_tab, 0.08),
                    "paperWarm",
                    rotation_euler=(0.0, sx * math.radians(12.0), 0.0),
                )
                _add_box(
                    bm,
                    (0.10, 0.56, 0.09),
                    (sx * 2.38, y_tab, 0.09),
                    "ink",
                )

        # 2. Foundation plinth (`lateriteDark` + `paperShadow` water-table molding, z = 0.10..0.34 m)
        _add_box(bm, (4.36, 3.36, 0.24), (0.0, 0.15, 0.22), "lateriteDark", bevel_width=0.025)
        _add_box(bm, (4.44, 3.44, 0.09), (0.0, 0.15, 0.34), "paperShadow", bevel_width=0.015)

        # 3. Main house walls (`paper` #f4ead4 main block + `paperWarm` #efe4c5 lower Wainscot band)
        # Main volume: X in [-2.12, +2.12] (4.24 m wide), Y in [-1.45, +1.75] (3.20 m deep), Z in [0.34, 2.58]
        _add_box(bm, (4.24, 3.20, 0.68), (0.0, 0.15, 0.72), "paperWarm", bevel_width=0.035)
        _add_box(bm, (4.24, 3.20, 1.54), (0.0, 0.15, 1.81), "paper", bevel_width=0.035)

        # Four corner pilasters (`paperShadow` vertical columns + `ink` graphic fold lines)
        for sx in (-1.0, 1.0):
            for sy, y_pos in ((-1.0, -1.43), (1.0, 1.73)):
                _add_box(bm, (0.20, 0.20, 2.26), (sx * 2.08, y_pos, 1.46), "paperShadow")
                _add_box(bm, (0.08, 0.08, 2.28), (sx * 2.16, y_pos + sy * 0.06, 1.46), "ink")

        # Upper frieze beam under eaves (`woodDark` + `paperShadow`)
        _add_box(bm, (4.34, 3.30, 0.12), (0.0, 0.15, 2.56), "woodDark")

        # 4. Gable attic prism (ridge runs along X from -2.14 to +2.14, apex at Y=0.15, Z=3.48 m)
        gable_yz = [
            (-1.46, 2.58),
            (1.76, 2.58),
            (0.15, 3.48),
        ]
        _add_prism_extruded_x(
            bm,
            x_min=-2.14,
            x_max=2.14,
            yz_poly=gable_yz,
            swatch="paperWarm",
            front_back_swatch="paperWarm",
        )

        # Left and right gable attic circular/octagonal louver vents (`ink` rim + `wood` slats)
        for sx in (-1.0, 1.0):
            _add_box(bm, (0.10, 0.42, 0.42), (sx * 2.15, 0.15, 2.94), "ink")
            _add_box(bm, (0.12, 0.30, 0.30), (sx * 2.16, 0.15, 2.94), "wood")
            _add_box(bm, (0.13, 0.32, 0.08), (sx * 2.17, 0.15, 2.94), "woodDark")

        # 5. Front Door (`woodDark` + `ink` frame + `windowGlow` transom + `ipeGold` handle)
        # Positioned slightly left-of-center on front wall (x = -0.58, y = -1.45)
        door_x = -0.58
        door_y = -1.45
        # Outer ink door frame
        _add_box(bm, (1.06, 0.12, 1.84), (door_x, door_y - 0.02, 1.26), "ink")
        # Door leaf (`woodDark`)
        _add_box(bm, (0.88, 0.11, 1.52), (door_x, door_y - 0.035, 1.12), "woodDark")
        # Raised upper and lower colonial door panels (`wood`)
        _add_box(bm, (0.64, 0.10, 0.54), (door_x, door_y - 0.055, 1.50), "wood")
        _add_box(bm, (0.64, 0.10, 0.52), (door_x, door_y - 0.055, 0.78), "wood")
        # Warm glowing transom window above door (`windowGlow` with `ink` bars)
        _add_box(bm, (0.88, 0.11, 0.22), (door_x, door_y - 0.035, 2.00), "windowGlow")
        _add_box(bm, (0.08, 0.12, 0.24), (door_x, door_y - 0.04, 2.00), "ink")
        # Door handle (`ipeGold`)
        _add_box(bm, (0.09, 0.12, 0.14), (door_x + 0.32, door_y - 0.07, 1.10), "ipeGold")
        # House number / milestone 1994 plaque beside front door (`paper` + `ink` + `signal` dot)
        _add_box(bm, (0.34, 0.09, 0.24), (door_x + 0.76, door_y - 0.03, 1.58), "ink")
        _add_box(bm, (0.28, 0.10, 0.18), (door_x + 0.76, door_y - 0.04, 1.58), "paper")
        _add_box(bm, (0.10, 0.11, 0.10), (door_x + 0.76, door_y - 0.05, 1.58), "signal")

        # 6. Recessed Shuttered Windows (`ink` + `wood` + `windowGlow`)
        # Front facade right window
        _add_shuttered_window(bm, center=(0.98, -1.45, 1.46), facing="-Y", width=0.82, height=0.88)
        # Left wall (-X) window
        _add_shuttered_window(bm, center=(-2.12, 0.15, 1.46), facing="-X", width=0.80, height=0.86)
        # Right wall (+X) window
        _add_shuttered_window(bm, center=(2.12, 0.15, 1.46), facing="+X", width=0.80, height=0.86)

        obj = _finalize_part_mesh(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            bevel_segments=0,
        )
        vn_scene.set_custom_props(
            obj,
            {
                "landmarkPart": "house_body",
                "popupRole": "unfold_walls",
            },
        )
        return obj
    finally:
        bm.free()


# ------------------------------------------------ 2. OrigensHouseRoof (Ceramic tile roof)


def _make_house_roof(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection | str | None,
) -> bpy.types.Object:
    """Build `OrigensHouseRoof`: pitched Brazilian ceramic tile roof + varanda awning roof.

    Features:
      - Pitched gable roof Deck (`woodDark` eaves soffit + `ink` fascia trim).
      - Layered horizontal tile courses alternating `brick` (#b5562c), `lateriteDark` (#a8432a),
        and `brickDark` (#8b3d1e) + longitudinal coloniale ridge caps (`cumeeira` in `laterite`).
      - Lower pitched front porch (`varanda`) roof shading the front veranda with layered tile courses.
    """
    bm = bmesh.new()
    try:
        # Main roof geometry parameters:
        # Ridge at Y = 0.15, Z = 3.55 m; eaves at Y_front = -1.72, Y_back = +2.02, Z_eave = 2.48 m.
        # Span X from -2.42 to +2.42 (4.84 m wide with generous Brazilian overhang).
        y_center = 0.15
        half_span_y = 1.88
        z_eave = 2.46
        z_ridge = 3.56
        dz = z_ridge - z_eave
        slope_angle = math.atan2(dz, half_span_y)  # ~30.3 deg
        slope_len = math.hypot(half_span_y, dz)

        # 1. Under-roof wooden deck + exposed rafter tails (`woodDark` / `wood`)
        for side_y in (-1.0, 1.0):
            mid_y = y_center + side_y * (half_span_y * 0.5)
            mid_z = (z_eave + z_ridge) * 0.5 - 0.03
            pitch = -side_y * slope_angle
            _add_box(
                bm,
                (4.84, slope_len + 0.12, 0.10),
                (0.0, mid_y, mid_z),
                "woodDark",
                rotation_euler=(pitch, 0.0, 0.0),
            )

        # Gable bargeboards / ink trim lines along left & right eaves
        for sx in (-1.0, 1.0):
            for side_y in (-1.0, 1.0):
                mid_y = y_center + side_y * (half_span_y * 0.5)
                mid_z = (z_eave + z_ridge) * 0.5
                pitch = -side_y * slope_angle
                _add_box(
                    bm,
                    (0.11, slope_len + 0.16, 0.14),
                    (sx * 2.40, mid_y, mid_z),
                    "ink",
                    rotation_euler=(pitch, 0.0, 0.0),
                )

        # 2. Layered horizontal ceramic tile courses (5 stepped courses per slope)
        n_courses = 5
        course_swatches = ("brick", "lateriteDark", "brick", "brickDark", "lateriteDark")
        for side_y in (-1.0, 1.0):
            pitch = -side_y * (slope_angle * 0.92)
            for c_idx in range(n_courses):
                t0 = c_idx / n_courses
                t1 = (c_idx + 1.08) / n_courses
                tm = (t0 + t1) * 0.5
                c_len = slope_len * (t1 - t0)
                y_pos = y_center + side_y * half_span_y * (1.0 - tm)
                z_pos = z_eave + dz * tm + 0.065 + (c_idx % 2) * 0.012
                sw = course_swatches[c_idx % len(course_swatches)]
                _add_box(
                    bm,
                    (4.78, c_len, 0.095),
                    (0.0, y_pos, z_pos),
                    sw,
                    rotation_euler=(pitch, 0.0, 0.0),
                )

            # Vertical barrel-tile ribs (`capas de telha colonial`, 7 ribs across width)
            rib_pitch = -side_y * slope_angle
            mid_y = y_center + side_y * (half_span_y * 0.52)
            mid_z = (z_eave + z_ridge) * 0.5 + 0.10
            for r_idx in range(7):
                rx = -2.04 + r_idx * 0.68
                r_sw = "laterite" if (r_idx % 2 == 0) else "brick"
                _add_box(
                    bm,
                    (0.16, slope_len * 0.94, 0.09),
                    (rx, mid_y, mid_z),
                    r_sw,
                    rotation_euler=(rib_pitch, 0.0, 0.0),
                )

        # 3. Main Roof Ridge Cap (`cumeeira` in `laterite` + `paperWarm` mortar edge)
        _add_box(bm, (4.88, 0.28, 0.14), (0.0, y_center, z_ridge + 0.08), "paperWarm")
        _add_box(bm, (4.92, 0.22, 0.14), (0.0, y_center, z_ridge + 0.15), "laterite")

        # 4. Lower Front Porch (`Varanda`) Awning Roof:
        # Attached below the front eaves: Y from -1.42 to -2.78 (depth 1.36 m), Z from 2.28 down to 1.86 m
        v_y0 = -1.42
        v_y1 = -2.78
        v_z0 = 2.28
        v_z1 = 1.86
        v_dy = abs(v_y1 - v_y0)
        v_dz = v_z0 - v_z1
        v_angle = math.atan2(v_dz, v_dy)
        v_len = math.hypot(v_dy, v_dz)
        v_mid_y = (v_y0 + v_y1) * 0.5
        v_mid_z = (v_z0 + v_z1) * 0.5

        # Varanda roof wooden deck & ink fascia border
        _add_box(
            bm,
            (4.56, v_len + 0.08, 0.09),
            (0.0, v_mid_y, v_mid_z - 0.02),
            "woodDark",
            rotation_euler=(v_angle, 0.0, 0.0),
        )
        _add_box(
            bm,
            (4.62, 0.10, 0.11),
            (0.0, v_y1, v_z1 - 0.01),
            "ink",
        )

        # 3 stepped ceramic tile courses on the varanda roof
        v_courses = ("lateriteDark", "brick", "laterite")
        for vc_idx, vc_sw in enumerate(v_courses):
            t0 = vc_idx / 3.0
            t1 = (vc_idx + 1.08) / 3.0
            tm = (t0 + t1) * 0.5
            cy = v_y0 + (v_y1 - v_y0) * tm
            cz = v_z0 + (v_z1 - v_z0) * tm + 0.055
            _add_box(
                bm,
                (4.52, v_len * (t1 - t0), 0.085),
                (0.0, cy, cz),
                vc_sw,
                rotation_euler=(v_angle * 0.92, 0.0, 0.0),
            )

        # Varanda barrel tile ribs (7 ribs matching main roof)
        for r_idx in range(7):
            rx = -1.92 + r_idx * 0.64
            _add_box(
                bm,
                (0.14, v_len * 0.92, 0.085),
                (rx, v_mid_y, v_mid_z + 0.08),
                "brick" if (r_idx % 2 == 0) else "lateriteDark",
                rotation_euler=(v_angle, 0.0, 0.0),
            )

        obj = _finalize_part_mesh(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            bevel_segments=0,
        )
        vn_scene.set_custom_props(
            obj,
            {
                "landmarkPart": "house_roof",
                "popupRole": "unfold_roof",
            },
        )
        return obj
    finally:
        bm.free()


# ------------------------------------ 3. OrigensHousePorch (Varanda + Meio-Fio + A Linha)


def _make_house_porch(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection | str | None,
) -> bpy.types.Object:
    """Build `OrigensHousePorch`: shady varanda, wooden posts, low laterite curb (`meio-fio`), and `a Linha` threshold.

    Features:
      - Shady front porch (`varanda`) deck in warm terracotta tile (`brick` / `lateriteDark`) with
        `paperShadow` edge coping and two welcoming entry steps aligned with the front door.
      - Wooden porch posts (`wood` #9a6840 with `woodDark` bases/capitals and `ink` brackets) +
        wooden porch balustrade rails.
      - Low laterite curb (`meio-fio` in alternating `laterite` #c4532d and whitewashed `paperShadow`
        #dfd1b2 curbstones) running along the street edge in front of the house & Ipê (O1 spawn vibe).
      - Origin ribbon threshold (`a Linha` in `signal` #f50000 with `paper` / `ink` doorstep origin seal):
        born right at the front doorstep (`x = -0.58`), cascading down the porch steps and across the
        curb toward the milestone journey (PLAN-3D §2.7 +8–10 s, §4.3 O2/O11).
    """
    bm = bmesh.new()
    try:
        # 1. Varanda Raised Deck (Y from -1.45 to -2.65, X from -2.18 to +2.18, Z from 0.10 to 0.34 m)
        _add_box(bm, (4.36, 1.24, 0.22), (0.0, -2.05, 0.21), "lateriteDark", bevel_width=0.02)
        _add_box(bm, (4.42, 1.28, 0.08), (0.0, -2.05, 0.32), "brick", bevel_width=0.015)
        _add_box(bm, (4.46, 0.12, 0.09), (0.0, -2.65, 0.32), "paperShadow")

        # 2. Entry Steps aligned with front door (`x = -0.58`, Y from -2.65 to -3.22)
        door_x = -0.58
        # Upper step
        _add_box(bm, (1.42, 0.34, 0.22), (door_x, -2.80, 0.16), "laterite", bevel_width=0.015)
        _add_box(bm, (1.46, 0.36, 0.08), (door_x, -2.80, 0.24), "paperShadow")
        # Lower step
        _add_box(bm, (1.54, 0.34, 0.14), (door_x, -3.10, 0.11), "lateriteDark", bevel_width=0.015)
        _add_box(bm, (1.58, 0.36, 0.08), (door_x, -3.10, 0.15), "paperShadow")

        # 3. Four Wooden Varanda Posts (`wood` #9a6840 + `woodDark` plinths + `ink` collars)
        # Posts sit at Y = -2.54, X in (-2.04, -1.24, 0.10, 2.04), leaving clear opening at door_x = -0.58
        post_xs = (-2.04, -1.24, 0.10, 2.04)
        post_y = -2.54
        for px in post_xs:
            # Base plinth (`woodDark` + `ink`)
            _add_box(bm, (0.22, 0.22, 0.16), (px, post_y, 0.42), "woodDark")
            _add_box(bm, (0.24, 0.24, 0.08), (px, post_y, 0.36), "ink")
            # Main timber shaft (`wood`, 0.16 x 0.16 m, z = 0.48..1.84 m)
            _add_box(bm, (0.16, 0.16, 1.38), (px, post_y, 1.16), "wood")
            # Capital corbel (`woodDark`)
            _add_box(bm, (0.26, 0.22, 0.12), (px, post_y, 1.84), "woodDark")

        # Top Varanda Header Beam tying all 4 posts (`woodDark`)
        _add_box(bm, (4.42, 0.18, 0.14), (0.0, post_y, 1.92), "woodDark")

        # Front & Side Wooden Balustrade Rails (`wood` + `woodDark`) on right bay and side edges
        # Right front bay (between x=0.10 and x=2.04)
        _add_box(bm, (1.86, 0.10, 0.09), (1.07, post_y, 0.88), "wood")
        _add_box(bm, (1.86, 0.09, 0.08), (1.07, post_y, 0.56), "woodDark")
        for bx in (0.48, 0.87, 1.27, 1.66):
            _add_box(bm, (0.085, 0.085, 0.36), (bx, post_y, 0.72), "wood")

        # Left front mini-bay (between x=-2.04 and x=-1.24)
        _add_box(bm, (0.72, 0.10, 0.09), (-1.64, post_y, 0.88), "wood")
        _add_box(bm, (0.72, 0.09, 0.08), (-1.64, post_y, 0.56), "woodDark")
        _add_box(bm, (0.085, 0.085, 0.36), (-1.64, post_y, 0.72), "wood")

        # Left and right side porch rails (Y from -1.48 to -2.54)
        for sx in (-1.0, 1.0):
            _add_box(bm, (0.10, 1.04, 0.09), (sx * 2.04, -1.98, 0.88), "wood")
            _add_box(bm, (0.09, 1.04, 0.08), (sx * 2.04, -1.98, 0.56), "woodDark")
            for by in (-1.75, -2.18):
                _add_box(bm, (0.085, 0.085, 0.36), (sx * 2.04, by, 0.72), "wood")

        # 4. Low Laterite Curb (`Meio-Fio` in `laterite` / `paperShadow` / `lateriteDark`, O1/O2 street edge)
        # Extends from X = -2.65 across the house front and under the Ipê tree to X = +4.65 (7.30 m total)
        curb_y = -3.62
        # Continuous dark laterite gutter bed
        _add_box(bm, (7.40, 0.44, 0.10), (1.00, curb_y, 0.05), "lateriteDark")
        # 10 alternating curbstones (`laterite` and whitewashed `paperShadow`, classic Brazilian interior town curb)
        n_stones = 10
        stone_span = 7.20 / n_stones
        for s_idx in range(n_stones):
            sx_center = -2.60 + (s_idx + 0.5) * stone_span
            sw = "paperShadow" if (s_idx % 2 == 0) else "laterite"
            _add_box(
                bm,
                (stone_span - 0.04, 0.32, 0.18),
                (sx_center, curb_y + 0.02, 0.13),
                sw,
            )

        # Low decorative front yard boundary wall / planter curb on the right uniting house and Ipê tree
        _add_box(bm, (1.45, 0.24, 0.26), (2.75, -2.05, 0.17), "laterite")
        _add_box(bm, (1.50, 0.28, 0.08), (2.75, -2.05, 0.31), "paperShadow")

        # 5. Origin Ribbon Threshold (`A Linha` in `signal` #f50000 born at the front doorstep, PLAN-3D §2.7, §4.3 O11)
        # Doorstep origin medallion (`ink` outer ring + `paper` inner stamp + raised `signal` birth dot)
        _add_box(bm, (0.76, 0.52, 0.08), (door_x, -1.68, 0.36), "ink")
        _add_box(bm, (0.64, 0.42, 0.085), (door_x, -1.68, 0.375), "paper")
        _add_box(bm, (0.38, 0.28, 0.095), (door_x, -1.68, 0.39), "signal")

        # Continuous red ribbon (`signal` #f50000, width 0.36 m, thickness >= 0.08 m) emerging from the front door,
        # flowing across the varanda, down the porch steps, over the meio-fio curb, and curving toward NE (O2/O5)!
        ribbon_points = [
            (door_x, -1.52, 0.35),
            (door_x, -2.08, 0.35),
            (door_x, -2.58, 0.35),
            (door_x, -2.84, 0.26),
            (door_x, -3.14, 0.17),
            (door_x + 0.05, -3.58, 0.21),
            (door_x + 0.32, -4.08, 0.10),
            (door_x + 0.85, -4.45, 0.08),
        ]
        tmp_ribbon = vn_shapes.make_ribbon(
            f"_{name}_OriginLineRibbon",
            points=ribbon_points,
            width=0.36,
            thickness=0.08,
            step=0.28,
            elevation=0.0,
            bevel_width=0.0,
        )
        try:
            cerrado_kit._append_transformed_bmesh(bm, tmp_ribbon, swatch="signal")
        finally:
            cerrado_kit._remove_temp_obj(tmp_ribbon)

        # Paper-and-ink ribbon edge guide ticks at the curb crossing
        for side_x in (-1.0, 1.0):
            _add_box(
                bm,
                (0.09, 0.36, 0.10),
                (door_x + 0.04 + side_x * 0.24, curb_y + 0.02, 0.22),
                "ink",
            )

        obj = _finalize_part_mesh(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            bevel_segments=0,
        )
        vn_scene.set_custom_props(
            obj,
            {
                "landmarkPart": "house_porch",
                "popupRole": "base_porch_curb_line",
                "lineOriginThreshold": True,
            },
        )
        return obj
    finally:
        bm.free()


# ------------------------------------ 4. OrigensIpeTrunk (Ipê-Amarelo trunk + budding state)


def _make_ipe_trunk_and_buds(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection | str | None,
) -> bpy.types.Object:
    """Build `OrigensIpeTrunk`: Ipê-Amarelo trunk, primary/secondary branches, and `ipe_budding` buds.

    Reuses `cerrado_kit._append_swept_tube` and `cerrado_kit._append_icosphere_lobe` with a root
    planter collar so the tree stands right beside Casa Natal ready for the O2 pop-up bloom.
    """
    bm = bmesh.new()
    try:
        # 1. Laterite & stone tree base ring (`lateriteDark` / `rock` / `dryGrass` root tuft)
        cerrado_kit._append_icosphere_lobe(
            bm,
            center=(0.0, 0.0, 0.10),
            scale_xyz=(0.56, 0.54, 0.14),
            subdivisions=1,
            swatch="lateriteDark",
        )
        cerrado_kit._append_icosphere_lobe(
            bm,
            center=(0.05, -0.04, 0.15),
            scale_xyz=(0.44, 0.42, 0.12),
            subdivisions=1,
            swatch="dryGrass",
        )

        # 2. Main sculpted Ipê trunk (`bark` #6e4b32, 0 -> 2.80 m) via cerrado_kit._append_swept_tube
        trunk_stations = [
            ((0.0, 0.0, 0.0), 0.36),
            ((0.05, -0.02, 0.68), 0.28),
            ((0.11, 0.03, 1.48), 0.24),
            ((0.07, 0.06, 2.28), 0.19),
            ((0.02, 0.04, 2.80), 0.15),
        ]
        cerrado_kit._append_swept_tube(
            bm,
            trunk_stations,
            sides=7,
            swatch="bark",
            cap_bottom=True,
            cap_top=True,
        )

        # 3. Five primary ascending branches (`bark`) + four secondary twigs (`wood`)
        branch_specs = [
            # Branch 1 (NE)
            (
                [
                    ((0.06, 0.05, 2.18), 0.16),
                    ((0.55, 0.42, 2.78), 0.13),
                    ((1.15, 0.82, 3.38), 0.10),
                    ((1.55, 1.05, 3.74), 0.07),
                ],
                6,
            ),
            # Branch 2 (NW — arching slightly toward house roof)
            (
                [
                    ((0.04, 0.04, 2.28), 0.15),
                    ((-0.48, 0.46, 2.88), 0.12),
                    ((-1.05, 0.84, 3.48), 0.09),
                    ((-1.38, 1.08, 3.84), 0.07),
                ],
                6,
            ),
            # Branch 3 (SE — toward street / front view)
            (
                [
                    ((0.07, 0.02, 2.08), 0.15),
                    ((0.58, -0.46, 2.70), 0.12),
                    ((1.18, -0.92, 3.28), 0.09),
                    ((1.52, -1.16, 3.60), 0.07),
                ],
                6,
            ),
            # Branch 4 (SW)
            (
                [
                    ((0.03, 0.02, 2.38), 0.14),
                    ((-0.46, -0.48, 2.98), 0.11),
                    ((-0.94, -0.92, 3.58), 0.09),
                    ((-1.22, -1.18, 3.90), 0.06),
                ],
                6,
            ),
            # Center high leader branch
            (
                [
                    ((0.02, 0.04, 2.68), 0.13),
                    ((0.12, -0.08, 3.42), 0.10),
                    ((0.18, -0.12, 4.12), 0.07),
                ],
                6,
            ),
        ]
        for stations, sides in branch_specs:
            cerrado_kit._append_swept_tube(
                bm,
                stations,
                sides=sides,
                swatch="bark",
                cap_bottom=True,
                cap_top=True,
            )

        # Secondary budding twigs (`wood`)
        for twig in (
            [((1.15, 0.82, 3.38), 0.08), ((0.85, 1.32, 3.80), 0.05)],
            [((-1.05, 0.84, 3.48), 0.08), ((-0.78, 1.35, 3.90), 0.05)],
            [((1.18, -0.92, 3.28), 0.08), ((1.48, -0.52, 3.70), 0.05)],
            [((-0.94, -0.92, 3.58), 0.08), ((-1.30, -0.55, 3.94), 0.05)],
        ):
            cerrado_kit._append_swept_tube(
                bm,
                twig,
                sides=5,
                swatch="wood",
                cap_bottom=True,
                cap_top=True,
            )

        # 4. Pre-bloom budding pods (`ipe_budding` state: `cerradoGreen`, `dryGrass`, and tight `ipeGold` buds)
        budding_pods = [
            ((1.55, 1.05, 3.78), (0.34, 0.30, 0.24), "cerradoGreen"),
            ((-1.38, 1.08, 3.88), (0.34, 0.30, 0.24), "cerradoGreen"),
            ((1.52, -1.16, 3.64), (0.32, 0.30, 0.22), "dryGrass"),
            ((-1.22, -1.18, 3.94), (0.34, 0.30, 0.24), "cerradoGreen"),
            ((0.18, -0.12, 4.18), (0.38, 0.35, 0.26), "cerradoDeep"),
            ((0.85, 1.32, 3.84), (0.22, 0.20, 0.20), "ipeGold"),
            ((-0.78, 1.35, 3.94), (0.22, 0.20, 0.20), "ipeGold"),
            ((1.48, -0.52, 3.74), (0.20, 0.20, 0.18), "ipeGold"),
            ((-1.30, -0.55, 3.98), (0.20, 0.20, 0.18), "ipeGold"),
        ]
        for idx, (center, scale_xyz, sw) in enumerate(budding_pods):
            cerrado_kit._append_icosphere_lobe(
                bm,
                center=center,
                scale_xyz=scale_xyz,
                subdivisions=1,
                swatch=sw,
                noise_amp=0.06,
                seed=idx + 5,
            )

        obj = cerrado_kit._finalize_kit_object(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            ground_pivot=True,
        )
        vn_scene.set_custom_props(
            obj,
            {
                "landmarkPart": "ipe_trunk",
                "ipeState": "ipe_budding",
                "popupRole": "trunk_and_buds",
            },
        )
        return obj
    finally:
        bm.free()


# ------------------------------------ 5. OrigensIpeBloom (Exploding golden blossoms O2)


def _make_ipe_bloom_clusters(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection | str | None,
) -> bpy.types.Object:
    """Build `OrigensIpeBloom`: exploding golden-yellow (`ipeGold`) multi-lobe blossom canopy (`ipe_blooming`).

    Separate mesh so the O2 milestone pop-up reveal (`T2.19a`) can scale/burst `OrigensIpeBloom`
    from 0 -> 1 over the branches of `OrigensIpeTrunk`, plus fallen golden petal clusters on the ground.
    """
    bm = bmesh.new()
    try:
        # 1. Five multi-lobe sculpted golden blossom clouds (`vn_shapes.make_blob` in `ipeGold` #f7c531)
        crown_blob_specs = [
            # Central high golden dome
            (
                "ipeGold",
                [
                    ((0.15, -0.10, 4.28), 0.86),
                    ((0.72, 0.35, 4.08), 0.68),
                    ((-0.56, 0.38, 4.12), 0.66),
                    ((0.05, -0.72, 4.00), 0.62),
                ],
                0.24,
                0.22,
            ),
            # NE blossom cluster
            (
                "ipeGold",
                [
                    ((1.45, 0.98, 3.80), 0.74),
                    ((1.88, 0.65, 3.60), 0.58),
                    ((1.10, 1.35, 3.64), 0.56),
                ],
                0.24,
                0.22,
            ),
            # NW blossom cluster
            (
                "ipeGold",
                [
                    ((-1.32, 1.02, 3.88), 0.72),
                    ((-1.72, 0.68, 3.68), 0.56),
                    ((-0.98, 1.40, 3.70), 0.54),
                ],
                0.24,
                0.22,
            ),
            # SE lower golden blossom cluster
            (
                "ipeGold",
                [
                    ((1.42, -1.08, 3.64), 0.72),
                    ((1.02, -1.42, 3.50), 0.56),
                ],
                0.24,
                0.24,
            ),
            # SW lower golden blossom cluster
            (
                "ipeGold",
                [
                    ((-1.18, -1.12, 3.92), 0.70),
                    ((-1.56, -0.80, 3.72), 0.56),
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
                cerrado_kit._append_transformed_bmesh(bm, tmp_blob, swatch=sw)
            finally:
                cerrado_kit._remove_temp_obj(tmp_blob)

        # 2. Sunlight crown highlight puffs (`fairyGold` / `ipeGold` / `cerradoGreen` calyx accents)
        accent_puffs = [
            ((0.18, 0.05, 4.92), (0.54, 0.50, 0.36), "fairyGold"),
            ((1.62, 1.10, 4.22), (0.44, 0.42, 0.32), "fairyGold"),
            ((-1.46, 1.12, 4.26), (0.44, 0.42, 0.32), "fairyGold"),
            ((1.35, -1.05, 4.08), (0.42, 0.40, 0.30), "ipeGold"),
            ((-1.15, -1.08, 4.30), (0.40, 0.38, 0.28), "fairyGold"),
            ((0.75, -0.55, 3.45), (0.34, 0.32, 0.25), "cerradoGreen"),
            ((-0.65, 0.52, 3.48), (0.34, 0.32, 0.25), "cerradoGreen"),
        ]
        for idx, (center, scale_xyz, sw) in enumerate(accent_puffs):
            cerrado_kit._append_icosphere_lobe(
                bm,
                center=center,
                scale_xyz=scale_xyz,
                subdivisions=1,
                swatch=sw,
                noise_amp=0.06,
                seed=idx + 11,
            )

        # 3. Fallen golden ipê blossom carpet cushions around the trunk base (`ipeGold` / `fairyGold`)
        fallen_petals = [
            ((0.68, -0.45, 0.08), (0.34, 0.28, 0.09), "ipeGold"),
            ((-0.58, -0.52, 0.08), (0.30, 0.26, 0.08), "fairyGold"),
            ((0.42, 0.58, 0.08), (0.28, 0.25, 0.08), "ipeGold"),
        ]
        for idx, (center, scale_xyz, sw) in enumerate(fallen_petals):
            cerrado_kit._append_icosphere_lobe(
                bm,
                center=center,
                scale_xyz=scale_xyz,
                subdivisions=1,
                swatch=sw,
                noise_amp=0.04,
                seed=idx + 21,
            )

        obj = cerrado_kit._finalize_kit_object(
            name=name,
            bm=bm,
            location=location,
            collection=collection,
            bevel_width=0.0,
            ground_pivot=False,
        )
        vn_scene.set_custom_props(
            obj,
            {
                "landmarkPart": "ipe_bloom",
                "ipeState": "ipe_blooming",
                "popupRole": "explode_yellow_flowers",
            },
        )
        return obj
    finally:
        bm.free()


# ------------------------------------ Public Generator: make_birthplace_house_ipe


def make_birthplace_house_ipe(
    name_prefix: str = "OrigensHouse",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> dict[str, Any]:
    """Build the Era 1 'Origens' Casa Natal + Ipê Pop-up Hero Landmark (T2.13a).

    Creates 5 named visual sub-meshes ready for the O2 pop-up reveal (`T2.19a`):
      - `<BodyPrefix>Body`   (default `OrigensHouseBody`)
      - `<BodyPrefix>Roof`   (default `OrigensHouseRoof`)
      - `<BodyPrefix>Porch`  (default `OrigensHousePorch`)
      - `<IpePrefix>Trunk`   (default `OrigensIpeTrunk`)
      - `<IpePrefix>Bloom`   (default `OrigensIpeBloom`)
    plus analytical `cuboid*` colliders (`vn_collide`) for house body, porch steps, curb, and tree trunk.

    Returns a dictionary containing `meshes`, `colliders`, and `all_objects`.
    """
    col = vn_scene.ensure_collection(collection) if isinstance(collection, str) else collection
    lx, ly, lz = (float(v) for v in location)

    if name_prefix == "OrigensHouse":
        house_prefix = "OrigensHouse"
        ipe_prefix = "OrigensIpe"
    else:
        house_prefix = name_prefix
        ipe_prefix = f"{name_prefix}Ipe"

    ipe_loc = (
        lx + IPE_OFFSET_LOCAL[0],
        ly + IPE_OFFSET_LOCAL[1],
        lz + IPE_OFFSET_LOCAL[2],
    )

    body_obj = _make_house_body(
        name=f"{house_prefix}Body",
        location=(lx, ly, lz),
        collection=col,
    )
    roof_obj = _make_house_roof(
        name=f"{house_prefix}Roof",
        location=(lx, ly, lz),
        collection=col,
    )
    porch_obj = _make_house_porch(
        name=f"{house_prefix}Porch",
        location=(lx, ly, lz),
        collection=col,
    )
    ipe_trunk_obj = _make_ipe_trunk_and_buds(
        name=f"{ipe_prefix}Trunk",
        location=ipe_loc,
        collection=col,
    )
    ipe_bloom_obj = _make_ipe_bloom_clusters(
        name=f"{ipe_prefix}Bloom",
        location=ipe_loc,
        collection=col,
    )

    meshes: dict[str, bpy.types.Object] = {
        body_obj.name: body_obj,
        roof_obj.name: roof_obj,
        porch_obj.name: porch_obj,
        ipe_trunk_obj.name: ipe_trunk_obj,
        ipe_bloom_obj.name: ipe_bloom_obj,
    }

    # Apply manual artist overrides from `game/blender/manual/origens_house_ipe.blend` if present (R1).
    vn_manual.apply_manual_overrides(
        ASSET_NAME,
        objects=list(meshes.values()),
        preserve_transform=True,
    )

    # Analytical cuboid colliders (`vn_collide.add_cuboid`) for house body, porch & steps, curb, and ipê trunk.
    colliders: dict[str, bpy.types.Object] = {
        "cuboidHouseBody": vn_collide.add_cuboid(
            name="cuboidHouseBody",
            size=(4.36, 3.36, 3.45),
            location=(0.0, 0.15, 1.725),
            parent=body_obj,
            collection=col,
        ),
        "cuboidPorchDeck": vn_collide.add_cuboid(
            name="cuboidPorchDeck",
            size=(4.42, 1.28, 0.36),
            location=(0.0, -2.05, 0.18),
            parent=porch_obj,
            collection=col,
        ),
        "cuboidPorchSteps": vn_collide.add_cuboid(
            name="cuboidPorchSteps",
            size=(1.58, 0.68, 0.28),
            location=(-0.58, -2.96, 0.14),
            parent=porch_obj,
            collection=col,
        ),
        "cuboidCurb": vn_collide.add_cuboid(
            name="cuboidCurb",
            size=(7.40, 0.44, 0.22),
            location=(1.00, -3.62, 0.11),
            parent=porch_obj,
            collection=col,
        ),
        "cuboidIpeTrunk": vn_collide.add_cuboid(
            name="cuboidIpeTrunk",
            size=(0.72, 0.72, 2.80),
            location=(0.04, 0.02, 1.40),
            parent=ipe_trunk_obj,
            collection=col,
        ),
    }

    return {
        "meshes": meshes,
        "colliders": colliders,
        "all_objects": [*meshes.values(), *colliders.values()],
    }


# ------------------------------------ Verification & Budget Audit


def _build_uv_lookup() -> dict[str, tuple[float, float]]:
    return {
        sw: vn_palette.get_swatch_uv(sw, gltf=False)
        for sw in vn_palette.list_swatches()
    }


def inspect_mesh_swatches(obj: bpy.types.Object, tol: float = 0.015) -> dict[str, int]:
    """Return `{swatch_name: face_count}` and assert every polygon maps to a valid palette swatch."""
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    assert uv_layer is not None, f"{obj.name}: missing active UV layer"

    lookup = _build_uv_lookup()
    counts: dict[str, int] = {}
    for poly in mesh.polygons:
        u = sum(uv_layer.data[i].uv[0] for i in poly.loop_indices) / len(poly.loop_indices)
        v = sum(uv_layer.data[i].uv[1] for i in poly.loop_indices) / len(poly.loop_indices)
        best_sw = None
        best_d = math.inf
        for sw, (su, sv) in lookup.items():
            d = math.hypot(u - su, v - sv)
            if d < best_d:
                best_d = d
                best_sw = sw
        assert best_sw is not None and best_d <= tol, (
            f"{obj.name} poly {poly.index}: UV ({u:.4f}, {v:.4f}) off palette swatch "
            f"(nearest={best_sw}, dist={best_d:.4f})"
        )
        counts[best_sw] = counts.get(best_sw, 0) + 1
    return counts


def verify_submesh_integrity(obj: bpy.types.Object) -> dict[str, Any]:
    """Verify single `'palette'` material, zero NaN/non-manifold/degenerate faces, and return mesh stats."""
    mesh = obj.data
    assert mesh is not None and len(mesh.vertices) > 0, f"{obj.name}: empty mesh"
    assert len(mesh.polygons) > 0, f"{obj.name}: zero polygons"

    mat_names = [s.material.name for s in obj.material_slots if s.material is not None]
    assert mat_names == ["palette"], f"{obj.name}: expected ['palette'], got {mat_names}"

    coords = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", coords)
    assert np.all(np.isfinite(coords)), f"{obj.name}: NaN/Inf vertex coordinates"

    uv_layer = mesh.uv_layers.active
    assert uv_layer is not None, f"{obj.name}: missing active UV layer"
    uv_buf = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    uv_layer.data.foreach_get("uv", uv_buf)
    assert np.all(np.isfinite(uv_buf)), f"{obj.name}: NaN/Inf UV coordinates"
    assert float(uv_buf.min()) >= 0.0 and float(uv_buf.max()) <= 1.0, (
        f"{obj.name}: UVs outside [0, 1]"
    )

    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.faces.ensure_lookup_table()

        non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
        zero_area = sum(1 for f in bm.faces if not math.isfinite(f.calc_area()) or f.calc_area() <= 1e-8)

        orig_normals = []
        bad_normal = 0
        for f in bm.faces:
            f.normal_update()
            if not math.isfinite(f.normal.length) or f.normal.length < 0.99:
                bad_normal += 1
            orig_normals.append(f.normal.copy())

        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        inverted = sum(
            1 for f, orig_n in zip(bm.faces, orig_normals) if f.normal.dot(orig_n) < 0.0
        )
    finally:
        bm.free()

    assert non_manifold == 0, f"{obj.name}: {non_manifold} non-manifold edges"
    assert zero_area == 0, f"{obj.name}: {zero_area} zero-area faces"
    assert bad_normal == 0, f"{obj.name}: {bad_normal} bad face normals"
    assert inverted == 0, f"{obj.name}: {inverted} inverted face normals"

    mesh.calc_loop_triangles()
    tris = len(mesh.loop_triangles)
    swatches = inspect_mesh_swatches(obj)

    return {
        "name": obj.name,
        "tris": tris,
        "verts": len(mesh.vertices),
        "faces": len(mesh.polygons),
        "materials": mat_names,
        "non_manifold": non_manifold,
        "swatches": swatches,
    }


def verify_landmark(result: dict[str, Any]) -> dict[str, Any]:
    """Run all T2.13a acceptance assertions on `make_birthplace_house_ipe()` output."""
    meshes: dict[str, bpy.types.Object] = result["meshes"]
    colliders: dict[str, bpy.types.Object] = result["colliders"]

    expected_meshes = (
        "OrigensHouseBody",
        "OrigensHouseRoof",
        "OrigensHousePorch",
        "OrigensIpeTrunk",
        "OrigensIpeBloom",
    )
    for req in expected_meshes:
        assert req in meshes, f"Missing required sub-mesh {req!r}"

    expected_colliders = (
        "cuboidHouseBody",
        "cuboidPorchDeck",
        "cuboidPorchSteps",
        "cuboidCurb",
        "cuboidIpeTrunk",
    )
    for req_col in expected_colliders:
        assert req_col in colliders, f"Missing required analytical collider {req_col!r}"
        col_obj = colliders[req_col]
        assert col_obj.type == "EMPTY" and col_obj.name.startswith("cuboid"), (
            f"Collider {req_col!r} must be a cuboid* Empty"
        )

    total_tris = 0
    combined_swatches: dict[str, int] = {}
    submesh_reports: dict[str, dict[str, Any]] = {}

    for name in expected_meshes:
        info = verify_submesh_integrity(meshes[name])
        submesh_reports[name] = info
        total_tris += info["tris"]
        for sw, cnt in info["swatches"].items():
            combined_swatches[sw] = combined_swatches.get(sw, 0) + cnt

    lo, hi = LANDMARK_TRI_BUDGET
    assert lo <= total_tris <= hi, (
        f"Total landmark triangles {total_tris} outside §5.4 budget [{lo}, {hi}]"
    )

    # Verify required architectural & flora swatches per specification
    required_swatches_per_part = {
        "OrigensHouseBody": ("paper", "paperWarm", "ink", "wood", "woodDark", "windowGlow", "signal"),
        "OrigensHouseRoof": ("brick", "lateriteDark", "laterite", "woodDark", "ink"),
        "OrigensHousePorch": ("wood", "woodDark", "laterite", "paperShadow", "signal", "paper", "ink"),
        "OrigensIpeTrunk": ("bark", "wood", "cerradoGreen", "ipeGold"),
        "OrigensIpeBloom": ("ipeGold", "fairyGold", "cerradoGreen"),
    }
    for part_name, req_sws in required_swatches_per_part.items():
        part_sws = submesh_reports[part_name]["swatches"]
        for sw in req_sws:
            assert part_sws.get(sw, 0) > 0, (
                f"{part_name} missing required swatch {sw!r} (found {part_sws})"
            )

    scene_info = vn_scene.scene_stats(list(meshes.values()))
    assert scene_info["materials"] == 1 and scene_info["materialNames"] == ["palette"], (
        f"Expected single shared 'palette' material, got {scene_info['materialNames']}"
    )

    print("==================================================================")
    print("T2.13a HERO LANDMARK AUDIT PASS | Casa Natal + Ipê Pop-up")
    print("==================================================================")
    for name in expected_meshes:
        info = submesh_reports[name]
        print(
            f"  [PASS] {name:<18} | {info['tris']:>4} tris | {info['verts']:>4} verts | "
            f"non_manifold={info['non_manifold']} | swatches={info['swatches']}"
        )
    for col_name, col_obj in colliders.items():
        dims = tuple(round(float(v), 2) for v in col_obj.scale)
        print(f"  [PASS] Collider {col_name:<17} | parent={col_obj.parent.name if col_obj.parent else None} | size={dims}")
    print(
        f"  [PASS] TOTAL TRIANGLES: {total_tris} tris (budget {lo}..{hi}) | "
        f"materials={scene_info['materialNames']}"
    )
    print("==================================================================")

    return {
        "total_tris": total_tris,
        "budget": LANDMARK_TRI_BUDGET,
        "submeshes": submesh_reports,
        "colliders": list(colliders.keys()),
        "swatches": combined_swatches,
    }


def main() -> None:
    vn_scene.reset_scene("T213a_OrigensHouseIpe")
    col = vn_scene.ensure_collection("OrigensHouseIpe")

    result = make_birthplace_house_ipe(
        name_prefix="OrigensHouse",
        location=(0.0, 0.0, 0.0),
        collection=col,
    )
    report = verify_landmark(result)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)

    render_info = vn_scene.render_3views(
        str(PREVIEW_OUT_PATH),
        size=640,
    )
    assert os.path.isfile(render_info["filepath"]), "Preview PNG was not written"

    glb_info = vn_export.export_glb(
        str(GLB_OUT_PATH),
        collections=[col],
    )
    assert os.path.isfile(glb_info["filepath"]), "GLB file was not written"
    assert glb_info["triangles"] == report["total_tris"], (
        f"GLB triangle count mismatch: expected {report['total_tris']}, got {glb_info['triangles']}"
    )
    assert glb_info["materials"] == 1, f"Expected 1 material in GLB, got {glb_info['materials']}"

    print(
        f"[origens_house_ipe] ALL CHECKS PASSED | preview={render_info['filepath']} "
        f"({render_info['width']}x{render_info['height']}) | "
        f"glb={glb_info['filepath']} ({glb_info['bytes']} B, {glb_info['triangles']} tris)"
    )


if __name__ == "__main__":
    main()
