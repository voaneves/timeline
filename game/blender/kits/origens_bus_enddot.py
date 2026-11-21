"""Origens Hero Landmarks (T2.13d): Ponto de Ônibus + Mini-Ilha Provisória do Ponto Final.

Models the two navigation and transition landmarks for the Origens vertical slice
(PLAN-3D.md §2.1, §2.2, §2.8, §4.1, §4.3 O3 & O10, §5.4, T2.13d, T2.20c):

  1. `make_bus_stop(name_prefix="OrigensBusStop", location=(0,0,0), collection=None)`:
     - O10 North Exit Landmark ("Ponto de ônibus Araguaína → Campinas").
     - Toy-diorama Brazilian town/highway covered bus shelter:
       * Step-up `laterite` / `concrete` / `paper` curb platform with `ink` edge banding and
         arrival terminal medallion for **a Linha** (`signal` #f50000).
       * Cantilevered / arched shelter frame (`ink`, `laterite`, `paper` plaster backdrop with
         woodcut vertical louver slats and warm `laterite` / `paper` ribbed canopy roof).
       * Chunky `wood` & `woodDark` waiting bench with `ink` cast-iron legs.
       * Tall cordel route totem post (`"Araguaína → Campinas"` in woodcut `ink`/`paper`/`signal`
         relief bars and directional chevron) + `"Em breve"` hanging plaque for the vertical slice.
       * Analytical `cuboid*` colliders for the curb platform, bench, shelter pillars/backwall,
         canopy roof, and totem post.

  2. `make_provisional_enddot_island(name_prefix="OrigensEndDot", location=(0,0,0), collection=None)`:
     - O3 Contact Pipe destination & horizon beacon ("Mini-ilha provisória do ponto final").
     - Pop-up book / paper-cut diorama mini-island (~11.2 m wide) with 3 stepped geological/paper
       terraces:
       * Layer 1 (base): `paper` / `paperWarm` / `paperShadow` cut-paper pop-up book base rim with
         `ink` contour trim.
       * Layer 2 (mid): `rock` / `rockDark` faceted cerrado sandstone bluff terrace.
       * Layer 3 (top): `laterite` / `lateriteDark` earth crown topped with `cerradoGreen` turf.
     - Arrival **Copper Pipe** (`platform_kit.make_copper_pipe`, D15 octagonal `copper` + `ink` +
       red `signal` ring) anchored on the lower landing terrace where the O3 `"Contato →"` shortcut
       pipe warps the player (`T2.20c`), paired with a cordel directional sign.
     - Spiral/ramp of **a Linha** (`signal` #f50000 continuous 3D ribbon) emerging from the landing
       terrace and wrapping up around the stepped hill to the summit pedestal.
     - **O Ponto Final (`OrigensEndDotSphere`)**: distinct mesh object named `OrigensEndDotSphere` —
       the iconic giant glowing red typographic period sphere (`signal` #f50000 + `signalEmissive`
       #ff2a2a equatorial/crown bands, diameter 4.0 m) resting on an `ink` + `paper` typographic
       nib/collar ring pedestal at the summit (`T2.20c` full-screen contact stamp trigger).
     - Analytical `cuboid*` / `cylinder*` (`tube*`) / `ball*` colliders for the 3 island terraces,
       summit pedestal, arrival copper pipe, and `OrigensEndDotSphere`.

Budget & Integrity (§5.4 Landmarks):
  - Total triangles across both landmarks in `[1,000, 6,000]`.
  - Single shared `"palette"` material (`vn_palette`).
  - Zero non-manifold edges, zero NaN/Inf vertices, zero degenerate zero-area faces.
  - Distinct `"OrigensEndDotSphere"` mesh object present and verified.
  - Supports `vn_manual.apply_manual_overrides("origens_bus_enddot")`.
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

from kits import platform_kit  # noqa: E402
from lib import (  # noqa: E402
    vn_bevel,
    vn_collide,
    vn_export,
    vn_manual,
    vn_palette,
    vn_scene,
    vn_shapes,
)

OUT_DIR = BLENDER_DIR / "out"
PREVIEWS_DIR = OUT_DIR / "previews"
GLB_OUT_PATH = OUT_DIR / "origens_bus_enddot.glb"
PREVIEW_OUT_PATH = PREVIEWS_DIR / "t213d_bus_enddot.png"

LANDMARK_TRI_MIN = 1000
LANDMARK_TRI_MAX = 6000
ENDDOT_SPHERE_NAME = "OrigensEndDotSphere"
ENDDOT_SPHERE_DIAMETER = 4.0


# ------------------------------------------------------------------ bmesh helpers


def _assign_uv(
    bm: bmesh.types.BMesh,
    faces: list[bmesh.types.BMFace],
    swatch_name: str,
) -> None:
    """Snap all loop UVs on `faces` to the exact center of `swatch_name`."""
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
) -> list[bmesh.types.BMFace]:
    """Add a closed box prism to `bm` and assign `swatch_name` UVs."""
    ret = bmesh.ops.create_cube(bm, size=1.0)
    verts = ret["verts"]
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
    _assign_uv(bm, faces, swatch_name)
    return faces


def _add_frustum(
    bm: bmesh.types.BMesh,
    radius_bottom: float,
    radius_top: float,
    height: float,
    segments: int,
    center: tuple[float, float, float],
    swatch_name: str,
    rotation_euler: tuple[float, float, float] | None = None,
    cap_ends: bool = True,
    side_swatch: str | None = None,
    top_swatch: str | None = None,
    bottom_swatch: str | None = None,
) -> list[bmesh.types.BMFace]:
    """Add a closed n-gon cylinder/frustum to `bm` with optional distinct top/side/bottom swatches."""
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=cap_ends,
        cap_tris=True,
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
    for f in faces:
        f.normal_update()

    if side_swatch is None and top_swatch is None and bottom_swatch is None:
        _assign_uv(bm, faces, swatch_name)
        return faces

    s_sw = side_swatch or swatch_name
    t_sw = top_swatch or swatch_name
    b_sw = bottom_swatch or swatch_name
    top_faces = [f for f in faces if f.normal.z > 0.65]
    bot_faces = [f for f in faces if f.normal.z < -0.65]
    side_faces = [f for f in faces if -0.65 <= f.normal.z <= 0.65]
    _assign_uv(bm, side_faces, s_sw)
    _assign_uv(bm, top_faces, t_sw)
    _assign_uv(bm, bot_faces, b_sw)
    return faces


def _add_stepped_island_layer(
    bm: bmesh.types.BMesh,
    radii_xy: list[tuple[float, float]],
    z_bottom: float,
    z_top: float,
    top_inward: float,
    side_swatch: str,
    top_swatch: str,
    bottom_swatch: str,
    alt_side_swatch: str | None = None,
    center_xy: tuple[float, float] = (0.0, 0.0),
) -> list[bmesh.types.BMFace]:
    """Create a closed manifold polygon prism with paper-cut faceted silhouette and triangulated caps."""
    n = len(radii_xy)
    if n < 3:
        raise ValueError("Stepped island layer requires at least 3 perimeter points")

    cx, cy = float(center_xy[0]), float(center_xy[1])
    zb, zt = float(z_bottom), float(z_top)
    scale_top = max(0.2, 1.0 - float(top_inward))

    bot_ring: list[bmesh.types.BMVert] = []
    top_ring: list[bmesh.types.BMVert] = []
    for x_off, y_off in radii_xy:
        bot_ring.append(bm.verts.new((cx + x_off, cy + y_off, zb)))
        top_ring.append(bm.verts.new((cx + x_off * scale_top, cy + y_off * scale_top, zt)))

    bot_center = bm.verts.new((cx, cy, zb))
    top_center = bm.verts.new((cx, cy, zt))

    created_faces: list[bmesh.types.BMFace] = []
    for i in range(n):
        nxt = (i + 1) % n
        # Side quad
        f_side = bm.faces.new((bot_ring[i], bot_ring[nxt], top_ring[nxt], top_ring[i]))
        sw = alt_side_swatch if (alt_side_swatch and i % 2 == 1) else side_swatch
        _assign_uv(bm, [f_side], sw)
        created_faces.append(f_side)

        # Top triangle fan
        f_top = bm.faces.new((top_center, top_ring[i], top_ring[nxt]))
        _assign_uv(bm, [f_top], top_swatch)
        created_faces.append(f_top)

        # Bottom triangle fan
        f_bot = bm.faces.new((bot_center, bot_ring[nxt], bot_ring[i]))
        _assign_uv(bm, [f_bot], bottom_swatch)
        created_faces.append(f_bot)

    return created_faces


def _finalize_bmesh_to_object(
    bm: bmesh.types.BMesh,
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection | str | None,
    bevel_width: float = 0.022,
    bevel_segments: int = 1,
    angle_deg: float = 35.0,
) -> bpy.types.Object:
    """Convert `bm` into a Blender mesh object with shared 'palette' material and toy bevels."""
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


# ----------------------------------------- 1. Ponto de Ônibus (O10 North Exit)


def make_bus_stop(
    name_prefix: str = "OrigensBusStop",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
    include_colliders: bool = True,
) -> dict[str, bpy.types.Object]:
    """Build the O10 Ponto de Ônibus 'Araguaína → Campinas' landmark (§4.3 O10, T2.13d).

    Returns a dictionary of created objects:
      - `shelter`: main bus shelter mesh (`{name_prefix}Shelter`) including laterite/concrete
        curb platform, Line arrival node, arched cantilever pillars, paper/brick backwall,
        laterite/paper canopy roof, and wooden waiting bench.
      - `totem`: route totem post + `"Araguaína → Campinas"` sign + `"Em breve"` hanging plaque
        (`{name_prefix}Totem`).
      - `colliders`: list of analytical `cuboid*` collider Empties parented to the visual meshes.
    """
    col = vn_scene.ensure_collection(collection) if isinstance(collection, str) else collection
    loc = Vector(tuple(float(v) for v in location))

    # --- A. Main Bus Shelter + Curb Platform + Wooden Bench + Line Arrival Node ---
    bm_shelter = bmesh.new()

    # 1. Paper-cut diorama base trim + laterite foundation + concrete waiting platform curb
    # Bottom paper cut rim (6.20 x 3.60 x 0.12 m)
    _add_box(
        bm_shelter,
        size=(6.20, 3.60, 0.12),
        center=(0.0, 0.0, 0.06),
        swatch_name="paperWarm",
    )
    # Laterite roadside curb base (5.90 x 3.30 x 0.18 m, z=0.12..0.30)
    _add_box(
        bm_shelter,
        size=(5.90, 3.30, 0.18),
        center=(0.0, 0.0, 0.21),
        swatch_name="laterite",
    )
    # Concrete sidewalk deck slab (5.60 x 3.00 x 0.10 m, z=0.30..0.40)
    _add_box(
        bm_shelter,
        size=(5.60, 3.00, 0.10),
        center=(0.0, 0.08, 0.35),
        swatch_name="concrete",
    )
    # Front tactile curb warning strip along roadside (-Y edge): paper curb band with ink edge accents
    _add_box(
        bm_shelter,
        size=(5.20, 0.24, 0.12),
        center=(0.0, -1.38, 0.36),
        swatch_name="paper",
    )
    for x_tile in (-1.80, 0.0, 1.80):
        _add_box(
            bm_shelter,
            size=(0.76, 0.26, 0.13),
            center=(x_tile, -1.38, 0.36),
            swatch_name="ink",
        )

    # 2. Arrival Node for the red Line ("a Linha" O11 -> O10 terminal pad on left/west side of curb)
    # Incoming red ribbon tail leading onto the platform
    _add_box(
        bm_shelter,
        size=(1.30, 0.36, 0.05),
        center=(-2.35, -0.55, 0.425),
        swatch_name="signal",
        rotation_euler=(0.0, 0.0, math.radians(12.0)),
    )
    # Ink & paper terminal ring collar + glowing red signal period disc at (-1.65, -0.42, 0.40)
    _add_frustum(
        bm_shelter,
        radius_bottom=0.44,
        radius_top=0.40,
        height=0.07,
        segments=8,
        center=(-1.65, -0.42, 0.435),
        swatch_name="ink",
    )
    _add_frustum(
        bm_shelter,
        radius_bottom=0.33,
        radius_top=0.31,
        height=0.09,
        segments=8,
        center=(-1.65, -0.42, 0.455),
        swatch_name="paper",
    )
    _add_frustum(
        bm_shelter,
        radius_bottom=0.22,
        radius_top=0.19,
        height=0.12,
        segments=8,
        center=(-1.65, -0.42, 0.48),
        swatch_name="signal",
    )

    # 3. Shelter Rear Wall (brick wainscot + paper upper wall + woodcut window frame)
    # Lower brick masonry wall (3.80 x 0.28 x 1.05 m, z=0.40..1.45)
    _add_box(
        bm_shelter,
        size=(3.80, 0.28, 1.05),
        center=(-0.20, 1.15, 0.925),
        swatch_name="brick",
    )
    # Brick dark base plinth & mid coping band
    _add_box(
        bm_shelter,
        size=(3.88, 0.34, 0.16),
        center=(-0.20, 1.15, 0.48),
        swatch_name="brickDark",
    )
    _add_box(
        bm_shelter,
        size=(3.86, 0.34, 0.12),
        center=(-0.20, 1.15, 1.46),
        swatch_name="paperWarm",
    )
    # Upper cream paper wall panels (left and right of central breeze window)
    for x_panel in (-1.45, 1.05):
        _add_box(
            bm_shelter,
            size=(1.26, 0.24, 1.32),
            center=(x_panel, 1.15, 2.18),
            swatch_name="paper",
        )
    # Central window upper lintel and vertical woodcut louver slats (`woodDark` & `ink`)
    _add_box(
        bm_shelter,
        size=(1.32, 0.26, 0.26),
        center=(-0.20, 1.15, 2.71),
        swatch_name="paper",
    )
    for x_frame in (-0.82, 0.42):
        _add_box(
            bm_shelter,
            size=(0.11, 0.30, 1.15),
            center=(x_frame, 1.15, 2.08),
            swatch_name="ink",
        )
    for x_louver in (-0.42, 0.02):
        _add_box(
            bm_shelter,
            size=(0.10, 0.18, 1.02),
            center=(x_louver, 1.15, 2.06),
            swatch_name="woodDark",
        )

    # Route poster map board mounted on the left inner paper panel
    _add_box(
        bm_shelter,
        size=(0.82, 0.08, 0.64),
        center=(-1.45, 1.01, 2.12),
        swatch_name="ink",
    )
    _add_box(
        bm_shelter,
        size=(0.70, 0.09, 0.50),
        center=(-1.45, 0.98, 2.12),
        swatch_name="paperWarm",
    )
    # Red route line & destination dot on poster map
    _add_box(
        bm_shelter,
        size=(0.48, 0.08, 0.10),
        center=(-1.48, 0.95, 2.12),
        swatch_name="signal",
        rotation_euler=(0.0, math.radians(-18.0), 0.0),
    )

    # 4. Cantilevered / Arched Structural Pillars (`ink` & `lateriteDark`)
    for x_col in (-2.05, 1.65):
        # Main rear column shaft (`ink`) anchored into curb platform
        _add_box(
            bm_shelter,
            size=(0.28, 0.30, 2.66),
            center=(x_col, 1.10, 1.72),
            swatch_name="ink",
        )
        # Angled forward cantilever Knee Brace supporting the roof (`ink`)
        _add_box(
            bm_shelter,
            size=(0.22, 1.85, 0.22),
            center=(x_col, 0.34, 2.66),
            swatch_name="ink",
            rotation_euler=(math.radians(22.0), 0.0, 0.0),
        )
        # Front support post near curb (`lateriteDark`)
        _add_box(
            bm_shelter,
            size=(0.22, 0.22, 2.75),
            center=(x_col, -0.52, 1.78),
            swatch_name="lateriteDark",
        )

    # 5. Arched / Pitched Brazilian Highway Canopy Roof (`laterite`, `paper`, `ink`)
    roof_tilt = (math.radians(-7.0), 0.0, 0.0)
    # Main canopy deck (`paperWarm` underside, `laterite` top)
    _add_box(
        bm_shelter,
        size=(4.60, 2.70, 0.18),
        center=(-0.20, 0.32, 3.08),
        swatch_name="paperWarm",
        rotation_euler=roof_tilt,
    )
    # Perimeter ink fascia band
    _add_box(
        bm_shelter,
        size=(4.72, 2.80, 0.11),
        center=(-0.20, 0.32, 3.16),
        swatch_name="ink",
        rotation_euler=roof_tilt,
    )
    # Arched / barrel-vaulted terracotta crown ribs on top of the canopy (`laterite` & `brick`)
    for idx, x_rib in enumerate((-1.65, -0.20, 1.25)):
        sw_rib = "laterite" if idx % 2 == 0 else "brick"
        _add_box(
            bm_shelter,
            size=(1.10, 2.56, 0.16),
            center=(x_rib, 0.32, 3.25),
            swatch_name=sw_rib,
            rotation_euler=roof_tilt,
        )
    # Central arched clerestory crest (`lateriteDark` & `paper`)
    _add_box(
        bm_shelter,
        size=(2.80, 1.25, 0.20),
        center=(-0.20, 0.34, 3.38),
        swatch_name="lateriteDark",
        rotation_euler=roof_tilt,
    )

    # Front header marquee board above the shelter entrance: "ARAGUAÍNA → CAMPINAS"
    _add_box(
        bm_shelter,
        size=(3.50, 0.16, 0.42),
        center=(-0.20, -0.96, 3.04),
        swatch_name="ink",
    )
    _add_box(
        bm_shelter,
        size=(3.34, 0.14, 0.30),
        center=(-0.20, -1.00, 3.04),
        swatch_name="paper",
    )
    # Woodcut route title bars + red signal arrow on front header
    for x_word, w_word in ((-1.15, 1.05), (0.55, 0.98)):
        _add_box(
            bm_shelter,
            size=(w_word, 0.10, 0.11),
            center=(x_word, -1.04, 3.04),
            swatch_name="ink",
        )
    _add_box(
        bm_shelter,
        size=(0.34, 0.10, 0.09),
        center=(-0.26, -1.05, 3.04),
        swatch_name="signal",
    )

    # 6. Chunky Wooden Waiting Bench (`wood`, `woodDark`, `ink`)
    bench_x = 0.05
    bench_y = 0.42
    # Two sturdy cast-iron `ink` legs
    for x_leg in (-0.98, 1.08):
        _add_box(
            bm_shelter,
            size=(0.16, 0.54, 0.46),
            center=(x_leg, bench_y, 0.63),
            swatch_name="ink",
        )
        # Backrest vertical bracket (`ink`)
        _add_box(
            bm_shelter,
            size=(0.14, 0.12, 0.54),
            center=(x_leg, bench_y + 0.24, 1.08),
            swatch_name="ink",
            rotation_euler=(math.radians(-10.0), 0.0, 0.0),
        )
    # Seat wooden slats (`wood` and `woodDark`)
    for s_idx, y_slat in enumerate((bench_y - 0.13, bench_y + 0.13)):
        _add_box(
            bm_shelter,
            size=(2.56, 0.22, 0.10),
            center=(bench_x, y_slat, 0.88),
            swatch_name="wood" if s_idx == 0 else "woodDark",
        )
    # Backrest wooden slats (`wood` and `woodDark`)
    for b_idx, z_slat in enumerate((1.10, 1.28)):
        _add_box(
            bm_shelter,
            size=(2.56, 0.09, 0.14),
            center=(bench_x, bench_y + 0.22, z_slat),
            swatch_name="wood" if b_idx == 0 else "woodDark",
            rotation_euler=(math.radians(-10.0), 0.0, 0.0),
        )

    shelter_obj = _finalize_bmesh_to_object(
        bm_shelter,
        name=f"{name_prefix}Shelter",
        location=(loc.x, loc.y, loc.z),
        collection=col,
        bevel_width=0.015,
        bevel_segments=1,
        angle_deg=72.0,
    )
    vn_scene.set_custom_props(
        shelter_obj,
        {
            "landmark": "origens_bus_stop",
            "beat": "O10",
            "route": "Araguaina -> Campinas",
            "statusPlaque": "Em breve",
        },
    )

    # --- B. Cordel Route Totem Post ("Araguaína → Campinas" + "Em breve" plaque) ---
    bm_totem = bmesh.new()
    tx, ty = 2.25, -0.35

    # Stepped laterite & ink base plinth on the right side of the platform (z=0.40..0.68)
    _add_box(
        bm_totem,
        size=(0.64, 0.64, 0.16),
        center=(tx, ty, 0.48),
        swatch_name="ink",
    )
    _add_box(
        bm_totem,
        size=(0.48, 0.48, 0.14),
        center=(tx, ty, 0.62),
        swatch_name="lateriteDark",
    )
    # Vertical timber/ink totem post (z=0.68..3.18)
    _add_box(
        bm_totem,
        size=(0.22, 0.22, 2.50),
        center=(tx, ty, 1.92),
        swatch_name="woodDark",
    )
    # Top circular bus-stop beacon disk (`ink` rim + `paper` face + `signal` center period dot)
    _add_frustum(
        bm_totem,
        radius_bottom=0.38,
        radius_top=0.38,
        height=0.14,
        segments=8,
        center=(tx, ty, 3.32),
        swatch_name="ink",
        rotation_euler=(math.pi * 0.5, 0.0, 0.0),
    )
    _add_frustum(
        bm_totem,
        radius_bottom=0.28,
        radius_top=0.28,
        height=0.18,
        segments=8,
        center=(tx, ty, 3.32),
        swatch_name="paper",
        rotation_euler=(math.pi * 0.5, 0.0, 0.0),
    )
    _add_frustum(
        bm_totem,
        radius_bottom=0.15,
        radius_top=0.15,
        height=0.22,
        segments=8,
        center=(tx, ty, 3.32),
        swatch_name="signal",
        rotation_euler=(math.pi * 0.5, 0.0, 0.0),
    )

    # Upper Cordel Route Signboard: "Araguaína → Campinas" (z=2.36)
    _add_box(
        bm_totem,
        size=(1.48, 0.14, 0.62),
        center=(tx + 0.14, ty - 0.10, 2.42),
        swatch_name="ink",
        rotation_euler=(0.0, math.radians(3.0), 0.0),
    )
    _add_box(
        bm_totem,
        size=(1.36, 0.12, 0.50),
        center=(tx + 0.14, ty - 0.13, 2.42),
        swatch_name="paper",
        rotation_euler=(0.0, math.radians(3.0), 0.0),
    )
    # Woodcut relief bars for "ARAGUAÍNA" (top line), red arrow, and "CAMPINAS" (bottom line)
    _add_box(
        bm_totem,
        size=(0.76, 0.08, 0.10),
        center=(tx - 0.06, ty - 0.17, 2.54),
        swatch_name="ink",
    )
    _add_box(
        bm_totem,
        size=(0.72, 0.08, 0.10),
        center=(tx - 0.08, ty - 0.17, 2.30),
        swatch_name="ink",
    )
    # Red signal directional arrow pointing right/north toward Era 2 UNICAMP
    _add_box(
        bm_totem,
        size=(0.28, 0.09, 0.10),
        center=(tx + 0.48, ty - 0.18, 2.42),
        swatch_name="signal",
    )
    _add_box(
        bm_totem,
        size=(0.20, 0.09, 0.20),
        center=(tx + 0.62, ty - 0.18, 2.42),
        swatch_name="signal",
        rotation_euler=(0.0, math.pi * 0.25, 0.0),
    )

    # Lower Hanging Plaque: "Em breve" (§4.3 O10 vertical slice notice, z=1.64)
    for x_chain in (tx - 0.22, tx + 0.46):
        _add_box(
            bm_totem,
            size=(0.08, 0.08, 0.24),
            center=(x_chain, ty - 0.12, 2.02),
            swatch_name="ink",
        )
    _add_box(
        bm_totem,
        size=(1.14, 0.14, 0.44),
        center=(tx + 0.12, ty - 0.12, 1.72),
        swatch_name="woodDark",
        rotation_euler=(0.0, math.radians(-2.5), 0.0),
    )
    _add_box(
        bm_totem,
        size=(1.02, 0.12, 0.34),
        center=(tx + 0.12, ty - 0.15, 1.72),
        swatch_name="paperWarm",
        rotation_euler=(0.0, math.radians(-2.5), 0.0),
    )
    # "EM BREVE" ink stamp bars + red signal period dot
    _add_box(
        bm_totem,
        size=(0.24, 0.08, 0.11),
        center=(tx - 0.18, ty - 0.19, 1.72),
        swatch_name="ink",
    )
    _add_box(
        bm_totem,
        size=(0.44, 0.08, 0.11),
        center=(tx + 0.22, ty - 0.19, 1.72),
        swatch_name="ink",
    )
    _add_box(
        bm_totem,
        size=(0.10, 0.09, 0.10),
        center=(tx + 0.52, ty - 0.19, 1.72),
        swatch_name="signal",
    )

    totem_obj = _finalize_bmesh_to_object(
        bm_totem,
        name=f"{name_prefix}Totem",
        location=(loc.x, loc.y, loc.z),
        collection=col,
        bevel_width=0.012,
        bevel_segments=1,
        angle_deg=72.0,
    )
    vn_scene.set_custom_props(
        totem_obj,
        {
            "landmark": "origens_bus_stop_totem",
            "beat": "O10",
            "signPrimary": "Araguaina -> Campinas",
            "signSecondary": "Em breve",
        },
    )

    colliders: list[bpy.types.Object] = []
    if include_colliders:
        # Curb platform collider
        colliders.append(
            vn_collide.add_cuboid(
                name=f"cuboid{name_prefix}Curb",
                size=(6.00, 3.40, 0.40),
                location=(0.0, 0.0, 0.20),
                parent=shelter_obj,
                collection=col,
            )
        )
        # Waiting bench collider
        colliders.append(
            vn_collide.add_cuboid(
                name=f"cuboid{name_prefix}Bench",
                size=(2.58, 0.62, 0.56),
                location=(0.05, 0.42, 0.68),
                parent=shelter_obj,
                collection=col,
            )
        )
        # Rear shelter wall collider
        colliders.append(
            vn_collide.add_cuboid(
                name=f"cuboid{name_prefix}BackWall",
                size=(3.90, 0.34, 2.55),
                location=(-0.20, 1.15, 1.68),
                parent=shelter_obj,
                collection=col,
            )
        )
        # Shelter pillars colliders (left & right)
        for side_tag, x_col in (("Left", -2.05), ("Right", 1.65)):
            colliders.append(
                vn_collide.add_cuboid(
                    name=f"cuboid{name_prefix}Pillar{side_tag}",
                    size=(0.34, 1.90, 2.75),
                    location=(x_col, 0.28, 1.78),
                    parent=shelter_obj,
                    collection=col,
                )
            )
        # Canopy roof collider (jumpable platform roof)
        colliders.append(
            vn_collide.add_cuboid(
                name=f"cuboid{name_prefix}Roof",
                size=(4.70, 2.80, 0.36),
                location=(-0.20, 0.32, 3.16),
                rotation=roof_tilt,
                parent=shelter_obj,
                collection=col,
            )
        )
        # Route totem post collider
        colliders.append(
            vn_collide.add_cuboid(
                name=f"cuboid{name_prefix}Totem",
                size=(1.48, 0.64, 3.45),
                location=(tx + 0.08, ty, 1.72),
                parent=totem_obj,
                collection=col,
            )
        )

    return {
        "shelter": shelter_obj,
        "totem": totem_obj,
        "colliders": colliders,
    }


# ------------------------ 2. Mini-Ilha Provisória do Ponto Final (O3 & Summit)


def _make_enddot_sphere(
    name: str,
    location: tuple[float, float, float],
    diameter: float = ENDDOT_SPHERE_DIAMETER,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Build the iconic giant glowing red period sphere (`OrigensEndDotSphere`, diameter 4.0 m).

    Uses a clean UV sphere with polar triangle fans and quad latitude bands (24x16) so it has
    zero non-manifold edges, zero degenerate faces, smooth weighted normals, and alternating
    `signal` (#f50000) / `signalEmissive` (#ff2a2a) glowing latitude bands with an `ink` base
    seating ring.
    """
    radius = float(diameter) * 0.5
    lon_segs = 20
    lat_rings = 12  # 12 interior latitude rings -> 13 bands between south and north poles

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.verify()

    # Sphere center sits at z = radius above the local object origin so the bottom pole rests
    # at local z = 0.0 (ground/pedestal socket pivot).
    z_center = radius

    south_pole = bm.verts.new((0.0, 0.0, 0.0))
    rings: list[list[bmesh.types.BMVert]] = []
    for r_idx in range(1, lat_rings + 1):
        phi = -math.pi * 0.5 + (math.pi * r_idx) / (lat_rings + 1)
        c_phi = math.cos(phi)
        s_phi = math.sin(phi)
        z_val = z_center + radius * s_phi
        xy_rad = radius * c_phi
        ring_verts: list[bmesh.types.BMVert] = []
        for s_idx in range(lon_segs):
            theta = (2.0 * math.pi * s_idx) / lon_segs
            ring_verts.append(
                bm.verts.new((xy_rad * math.cos(theta), xy_rad * math.sin(theta), z_val))
            )
        rings.append(ring_verts)
    north_pole = bm.verts.new((0.0, 0.0, z_center + radius))

    # Assign brand swatches by latitude band:
    # - bottom polar cap (band 0): 'ink' socket seating rim
    # - lower/upper hemispheres: 'signal' (#f50000)
    # - broad equatorial beacon belt + crown highlight ring: 'signalEmissive' (#ff2a2a)
    def _band_swatch(band_idx: int) -> str:
        if band_idx == 0:
            return "ink"
        if band_idx in (4, 5, 6, 7, 8, 10, 11):
            return "signalEmissive"
        return "signal"

    # South pole triangle fan (band 0)
    first_ring = rings[0]
    sw0 = _band_swatch(0)
    u0, v0 = vn_palette.get_swatch_uv(sw0, gltf=False)
    for s_idx in range(lon_segs):
        nxt = (s_idx + 1) % lon_segs
        f = bm.faces.new((south_pole, first_ring[nxt], first_ring[s_idx]))
        for loop in f.loops:
            loop[uv_layer].uv = (u0, v0)

    # Middle quad bands (bands 1 .. lat_rings - 1)
    for b_idx in range(lat_rings - 1):
        ring_low = rings[b_idx]
        ring_high = rings[b_idx + 1]
        sw = _band_swatch(b_idx + 1)
        u, v = vn_palette.get_swatch_uv(sw, gltf=False)
        for s_idx in range(lon_segs):
            nxt = (s_idx + 1) % lon_segs
            f = bm.faces.new((ring_low[s_idx], ring_low[nxt], ring_high[nxt], ring_high[s_idx]))
            for loop in f.loops:
                loop[uv_layer].uv = (u, v)

    # North pole triangle fan (top crown band)
    last_ring = rings[-1]
    swn = _band_swatch(lat_rings)
    un, vn = vn_palette.get_swatch_uv(swn, gltf=False)
    for s_idx in range(lon_segs):
        nxt = (s_idx + 1) % lon_segs
        f = bm.faces.new((north_pole, last_ring[s_idx], last_ring[nxt]))
        for loop in f.loops:
            loop[uv_layer].uv = (un, vn)

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
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

    vn_bevel.set_smooth_shading(obj, True)
    vn_bevel.apply_weighted_normals(
        obj,
        weight=50,
        keep_sharp=False,
        face_influence=False,
        apply=True,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "landmark": "ponto_final",
            "interactive": "contact_stamp_trigger",
            "diameter": float(diameter),
            "emissivePulse": True,
        },
    )
    return obj


def make_provisional_enddot_island(
    name_prefix: str = "OrigensEndDot",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
    include_colliders: bool = True,
) -> dict[str, bpy.types.Object]:
    """Build the Mini-Ilha Provisória do Ponto Final landmark (§4.1, §4.3 O3, T2.13d, T2.20c).

    Returns a dictionary of created objects:
      - `island`: 3-layer paper-cut diorama island + summit typographic `ink`/`paper` pedestal
        (`{name_prefix}Island`).
      - `sphere`: distinct `OrigensEndDotSphere` mesh (4.0 m red period sphere in `signal` /
        `signalEmissive` resting on the summit pedestal).
      - `pipe`: arrival D15 Copper Pipe (`{name_prefix}ArrivalPipe`) at the landing terrace.
      - `sign`: cordel directional sign (`{name_prefix}CordelSign`) guiding from the arrival
        pipe up the spiral Line to the Ponto Final.
      - `line_spiral`: spiral ribbon of **a Linha** (`{name_prefix}LineSpiral`, `signal` #f50000)
        wrapping from the arrival pipe landing up to the summit pedestal.
      - `colliders`: list of analytical `cuboid*`, `tube*` (`cylinder*`), and `ball*` colliders.
    """
    col = vn_scene.ensure_collection(collection) if isinstance(collection, str) else collection
    loc = Vector(tuple(float(v) for v in location))

    # --- A. 3-Layer Paper-Cut Diorama Mini-Island + Summit Typographic Pedestal ---
    bm_island = bmesh.new()

    # Layer 1 (Base, z=0.00..0.42): Pop-up book cut-paper base ~11.2 m x 10.4 m
    # Asymmetric 12-gon paper-cut contour with a protruding front-left landing terrace
    # for the arrival copper pipe.
    base_contour: list[tuple[float, float]] = [
        (0.0, -5.20),
        (2.85, -4.70),
        (4.85, -2.85),
        (5.60, 0.00),
        (4.75, 2.90),
        (2.60, 4.75),
        (-0.20, 5.15),
        (-3.00, 4.55),
        (-5.05, 2.65),
        (-5.65, -0.35),
        (-5.15, -3.45),
        (-2.85, -4.95),
    ]
    # Dark ink paper-cut shadow under-rim (z=0.00..0.08)
    _add_stepped_island_layer(
        bm_island,
        radii_xy=[(x * 1.015, y * 1.015) for x, y in base_contour],
        z_bottom=0.00,
        z_top=0.08,
        top_inward=0.005,
        side_swatch="ink",
        top_swatch="paperShadow",
        bottom_swatch="ink",
    )
    # Thick cut-paper pop-up sheet layer (z=0.08..0.44)
    _add_stepped_island_layer(
        bm_island,
        radii_xy=base_contour,
        z_bottom=0.08,
        z_top=0.44,
        top_inward=0.03,
        side_swatch="paper",
        alt_side_swatch="paperWarm",
        top_swatch="paper",
        bottom_swatch="paperShadow",
    )

    # Layer 2 (Middle Geological Stratum, z=0.44..1.24): Faceted Cerrado Rock Bluff (~8.6 m wide)
    rock_contour: list[tuple[float, float]] = [
        (0.10, -4.15),
        (2.35, -3.70),
        (3.95, -2.15),
        (4.45, 0.10),
        (3.80, 2.35),
        (2.05, 3.85),
        (-0.15, 4.15),
        (-2.35, 3.65),
        (-3.95, 2.05),
        (-4.35, -0.25),
        (-4.15, -2.75),
        (-2.30, -3.95),
    ]
    _add_stepped_island_layer(
        bm_island,
        radii_xy=rock_contour,
        z_bottom=0.44,
        z_top=1.24,
        top_inward=0.06,
        side_swatch="rock",
        alt_side_swatch="rockDark",
        top_swatch="rock",
        bottom_swatch="rockDark",
    )

    # Protruding Arrival Landing Terrace Pad on the SW/front-left flank (z=0.44..1.26)
    # so the arrival Copper Pipe sits on a generous flat stage
    _add_frustum(
        bm_island,
        radius_bottom=1.85,
        radius_top=1.72,
        height=0.82,
        segments=10,
        center=(-3.15, -2.35, 0.85),
        swatch_name="rock",
        side_swatch="rockDark",
        top_swatch="paperWarm",
        bottom_swatch="rockDark",
    )
    # Stepping stone slabs connecting the arrival pipe terrace to the spiral ramp
    step_specs = (
        ((-1.45, -3.15, 1.28), (1.15, 0.90, 0.16), math.radians(14.0), "paper"),
        ((0.05, -3.25, 1.48), (1.15, 0.90, 0.20), math.radians(2.0), "paperWarm"),
        ((1.55, -2.75, 1.68), (1.15, 0.90, 0.22), math.radians(-22.0), "paper"),
    )
    for s_center, s_size, s_rot_z, s_sw in step_specs:
        _add_box(
            bm_island,
            size=s_size,
            center=s_center,
            swatch_name=s_sw,
            rotation_euler=(0.0, 0.0, s_rot_z),
        )

    # Layer 3 (Upper Laterite & Cerrado Green Crown Terrace, z=1.24..2.12, ~6.4 m wide)
    laterite_contour: list[tuple[float, float]] = [
        (0.15, -2.95),
        (1.80, -2.60),
        (2.95, -1.45),
        (3.25, 0.15),
        (2.75, 1.85),
        (1.45, 2.95),
        (-0.10, 3.15),
        (-1.75, 2.70),
        (-2.85, 1.45),
        (-3.05, -0.20),
        (-2.60, -1.85),
        (-1.40, -2.75),
    ]
    _add_stepped_island_layer(
        bm_island,
        radii_xy=laterite_contour,
        z_bottom=1.24,
        z_top=1.96,
        top_inward=0.08,
        side_swatch="laterite",
        alt_side_swatch="lateriteDark",
        top_swatch="laterite",
        bottom_swatch="lateriteDark",
    )
    # Cerrado green turf cap on the upper terrace (z=1.96..2.12)
    _add_stepped_island_layer(
        bm_island,
        radii_xy=[(x * 0.90, y * 0.90) for x, y in laterite_contour],
        z_bottom=1.96,
        z_top=2.12,
        top_inward=0.04,
        side_swatch="cerradoDeep",
        alt_side_swatch="cerradoGreen",
        top_swatch="cerradoGreen",
        bottom_swatch="lateriteDark",
    )

    # Summit Typographic Ring Pedestal (z=2.12..2.58) supporting `OrigensEndDotSphere`
    # Outer `ink` typographic seal base
    _add_frustum(
        bm_island,
        radius_bottom=2.10,
        radius_top=1.92,
        height=0.22,
        segments=10,
        center=(0.10, 0.15, 2.23),
        swatch_name="ink",
    )
    # Middle `paper` editorial collar ring
    _add_frustum(
        bm_island,
        radius_bottom=1.78,
        radius_top=1.64,
        height=0.16,
        segments=10,
        center=(0.10, 0.15, 2.42),
        swatch_name="paper",
    )
    # Upper `ink` socket cradle ring + `signal` accent rim (top at z=2.58)
    _add_frustum(
        bm_island,
        radius_bottom=1.48,
        radius_top=1.32,
        height=0.10,
        segments=10,
        center=(0.10, 0.15, 2.53),
        swatch_name="ink",
        side_swatch="signal",
        top_swatch="ink",
        bottom_swatch="ink",
    )

    island_obj = _finalize_bmesh_to_object(
        bm_island,
        name=f"{name_prefix}Island",
        location=(loc.x, loc.y, loc.z),
        collection=col,
        bevel_width=0.018,
        bevel_segments=1,
        angle_deg=85.0,
    )
    vn_scene.set_custom_props(
        island_obj,
        {
            "landmark": "origens_enddot_island",
            "beat": "O3_destination",
            "layers": 3,
        },
    )

    # --- B. Distinct `OrigensEndDotSphere` Mesh (O Ponto Final, diameter 4.0 m) ---
    # Seated directly on the summit typographic ring pedestal at local (0.10, 0.15, 2.48)
    sphere_world_loc = (loc.x + 0.10, loc.y + 0.15, loc.z + 2.48)
    sphere_obj = _make_enddot_sphere(
        name=ENDDOT_SPHERE_NAME,
        location=sphere_world_loc,
        diameter=ENDDOT_SPHERE_DIAMETER,
        collection=col,
    )

    # --- C. Arrival Copper Pipe (D15) + Cordel Sign on the Landing Terrace ---
    pipe_world_loc = (loc.x - 3.15, loc.y - 2.35, loc.z + 1.25)
    pipe_obj = platform_kit.make_copper_pipe(
        name=f"{name_prefix}ArrivalPipe",
        location=pipe_world_loc,
        collection=col,
    )
    vn_scene.set_custom_props(
        pipe_obj,
        {
            "landmark": "origens_enddot_arrival_pipe",
            "warpFrom": "O3_contact_pipe",
            "d15Variant": "copper_ink_red_ring",
        },
    )

    sign_world_loc = (loc.x - 2.05, loc.y - 1.45, loc.z + 1.25)
    sign_obj = platform_kit.make_cordel_sign(
        name=f"{name_prefix}CordelSign",
        location=sign_world_loc,
        collection=col,
    )
    sign_obj.rotation_euler = (0.0, 0.0, math.radians(-28.0))
    vn_scene.set_custom_props(
        sign_obj,
        {
            "landmark": "origens_enddot_sign",
            "label": "Ponto Final ->",
        },
    )

    # --- D. Spiral Ribbon of "a Linha" Wrapping Up to the Summit Pedestal ---
    # Starts at the arrival pipe terrace, spirals ~300 degrees around the stepped terraces,
    # and terminates into the summit typographic pedestal below `OrigensEndDotSphere`.
    spiral_local_pts: list[tuple[float, float, float]] = [
        (-2.40, -2.55, 1.28),
        (-1.35, -3.15, 1.38),
        (0.15, -3.25, 1.58),
        (1.75, -2.65, 1.78),
        (2.85, -1.25, 1.96),
        (2.95, 0.55, 2.08),
        (2.15, 2.15, 2.16),
        (0.55, 2.75, 2.22),
        (-1.15, 2.25, 2.28),
        (-2.05, 0.95, 2.34),
        (-1.65, -0.55, 2.40),
        (-0.65, -0.95, 2.46),
        (0.10, -0.45, 2.52),
    ]
    spiral_world_pts = [(loc.x + px, loc.y + py, loc.z + pz) for px, py, pz in spiral_local_pts]
    line_obj = vn_shapes.make_ribbon(
        name=f"{name_prefix}LineSpiral",
        points=spiral_world_pts,
        width=0.38,
        thickness=0.05,
        step=1.15,
        elevation=0.02,
        bevel_width=0.0,
        collection=col,
    )
    vn_palette.assign(line_obj, "signal")
    vn_scene.set_custom_props(
        line_obj,
        {
            "landmark": "origens_enddot_line_spiral",
            "isLineRibbon": True,
        },
    )

    # --- E. Analytical Colliders (`cuboid*`, `tube*` / `cylinder*`, `ball*`) ---
    colliders: list[bpy.types.Object] = []
    if include_colliders:
        # Island Layer 1 (base paper terrace cylinder collider)
        colliders.append(
            vn_collide.add_cylinder(
                name=f"tube{name_prefix}BaseLayer",
                radius=5.30,
                height=0.44,
                location=(0.0, 0.0, 0.22),
                parent=island_obj,
                collection=col,
            )
        )
        # Island Layer 2 (middle rock terrace cylinder collider)
        colliders.append(
            vn_collide.add_cylinder(
                name=f"tube{name_prefix}RockLayer",
                radius=4.15,
                height=0.80,
                location=(0.0, 0.0, 0.84),
                parent=island_obj,
                collection=col,
            )
        )
        # Arrival landing terrace pad collider
        colliders.append(
            vn_collide.add_cylinder(
                name=f"tube{name_prefix}LandingPad",
                radius=1.78,
                height=0.82,
                location=(-3.15, -2.35, 0.85),
                parent=island_obj,
                collection=col,
            )
        )
        # Stepping stone cuboid colliders
        for idx, (s_center, s_size, s_rot_z, _) in enumerate(step_specs, start=1):
            colliders.append(
                vn_collide.add_cuboid(
                    name=f"cuboid{name_prefix}Step{idx}",
                    size=s_size,
                    location=s_center,
                    rotation=(0.0, 0.0, s_rot_z),
                    parent=island_obj,
                    collection=col,
                )
            )
        # Island Layer 3 (upper laterite + cerradoGreen terrace cylinder collider)
        colliders.append(
            vn_collide.add_cylinder(
                name=f"tube{name_prefix}TopLayer",
                radius=2.95,
                height=0.88,
                location=(0.0, 0.0, 1.68),
                parent=island_obj,
                collection=col,
            )
        )
        # Summit typographic ring pedestal collider
        colliders.append(
            vn_collide.add_cylinder(
                name=f"tube{name_prefix}Pedestal",
                radius=1.95,
                height=0.46,
                location=(0.10, 0.15, 2.35),
                parent=island_obj,
                collection=col,
            )
        )
        # Arrival Copper Pipe collider
        colliders.append(
            vn_collide.add_cylinder(
                name=f"tube{name_prefix}ArrivalPipe",
                radius=0.60,
                height=1.24,
                location=(0.0, 0.0, 0.62),
                parent=pipe_obj,
                collection=col,
            )
        )
        # Cordel Sign collider
        colliders.append(
            vn_collide.add_cuboid(
                name=f"cuboid{name_prefix}CordelSign",
                size=(1.12, 0.34, 1.44),
                location=(0.0, 0.0, 0.72),
                parent=sign_obj,
                collection=col,
            )
        )
        # O Ponto Final (`OrigensEndDotSphere`) analytical sphere collider (radius 2.0 m)
        colliders.append(
            vn_collide.add_ball(
                name="ballOrigensEndDotSphere",
                radius=ENDDOT_SPHERE_DIAMETER * 0.5,
                location=(0.0, 0.0, ENDDOT_SPHERE_DIAMETER * 0.5),
                parent=sphere_obj,
                props={"interactive": "contact_stamp_trigger"},
                collection=col,
            )
        )

    return {
        "island": island_obj,
        "sphere": sphere_obj,
        "pipe": pipe_obj,
        "sign": sign_obj,
        "line_spiral": line_obj,
        "colliders": colliders,
    }


# ------------------------------------------------ Scene Assembly & Verification


def build_origens_bus_enddot(
    collection_name: str = "OrigensBusEndDot",
    include_colliders: bool = True,
) -> dict[str, Any]:
    """Build both T2.13d landmarks side by side and apply manual overrides if present."""
    col = vn_scene.ensure_collection(collection_name)

    bus_stop = make_bus_stop(
        name_prefix="OrigensBusStop",
        location=(-6.2, 0.0, 0.0),
        collection=col,
        include_colliders=include_colliders,
    )
    enddot = make_provisional_enddot_island(
        name_prefix="OrigensEndDot",
        location=(4.6, 0.0, 0.0),
        collection=col,
        include_colliders=include_colliders,
    )

    visual_meshes: dict[str, bpy.types.Object] = {
        bus_stop["shelter"].name: bus_stop["shelter"],
        bus_stop["totem"].name: bus_stop["totem"],
        enddot["island"].name: enddot["island"],
        enddot["sphere"].name: enddot["sphere"],
        enddot["pipe"].name: enddot["pipe"],
        enddot["sign"].name: enddot["sign"],
        enddot["line_spiral"].name: enddot["line_spiral"],
    }

    # Support manual artist overrides in game/blender/manual/origens_bus_enddot.blend
    vn_manual.apply_manual_overrides(
        "origens_bus_enddot",
        objects=list(visual_meshes.values()),
    )

    return {
        "collection": col,
        "bus_stop": bus_stop,
        "enddot": enddot,
        "visual_meshes": visual_meshes,
    }


def verify_origens_bus_enddot(built: dict[str, Any]) -> dict[str, Any]:
    """Assert §5.4 landmark budgets, single palette material, manifold integrity, and EndDot sphere."""
    visual_meshes: dict[str, bpy.types.Object] = built["visual_meshes"]

    if ENDDOT_SPHERE_NAME not in visual_meshes or bpy.data.objects.get(ENDDOT_SPHERE_NAME) is None:
        raise AssertionError(f"Required distinct mesh {ENDDOT_SPHERE_NAME!r} is missing from scene")

    report: dict[str, Any] = {
        "meshes": {},
        "total_triangles": 0,
        "materials": set(),
    }

    for name, obj in visual_meshes.items():
        integrity = platform_kit.inspect_mesh_integrity(obj)
        swatches = platform_kit.inspect_object_swatches(obj)
        report["meshes"][name] = {
            **integrity,
            "swatches": swatches,
        }
        report["total_triangles"] += integrity["triangles"]
        report["materials"].update(integrity["materials"])

        if integrity["materials"] != ["palette"]:
            raise AssertionError(
                f"{name} must bind single ['palette'] material, got {integrity['materials']}"
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

    total_tris = report["total_triangles"]
    if not (LANDMARK_TRI_MIN <= total_tris <= LANDMARK_TRI_MAX):
        raise AssertionError(
            f"Combined triangle count {total_tris} outside §5.4 landmark budget "
            f"[{LANDMARK_TRI_MIN}, {LANDMARK_TRI_MAX}]"
        )

    if sorted(report["materials"]) != ["palette"]:
        raise AssertionError(
            f"Scene must use only ['palette'] material, got {sorted(report['materials'])}"
        )

    # Verify Bus Stop palette swatches (paper, brick, laterite, wood, ink, signal)
    shelter_sw = report["meshes"]["OrigensBusStopShelter"]["swatches"]
    totem_sw = report["meshes"]["OrigensBusStopTotem"]["swatches"]
    combined_bus_sw = set(shelter_sw.keys()) | set(totem_sw.keys())
    for req_bus_sw in ("paper", "brick", "laterite", "wood", "ink", "signal"):
        if req_bus_sw not in combined_bus_sw:
            raise AssertionError(
                f"OrigensBusStop missing required swatch {req_bus_sw!r} (found {sorted(combined_bus_sw)})"
            )

    # Verify Island 3 geological/paper layers (paper, rock, laterite, cerradoGreen)
    island_sw = report["meshes"]["OrigensEndDotIsland"]["swatches"]
    for req_isl_sw in ("paper", "rock", "laterite", "cerradoGreen", "ink"):
        if island_sw.get(req_isl_sw, 0) <= 0:
            raise AssertionError(
                f"OrigensEndDotIsland missing required layer swatch {req_isl_sw!r} (found {island_sw})"
            )

    # Verify `OrigensEndDotSphere` diameter (~4.0 m) and glowing red signal swatches
    sphere_obj = visual_meshes[ENDDOT_SPHERE_NAME]
    sphere_sw = report["meshes"][ENDDOT_SPHERE_NAME]["swatches"]
    for req_sph_sw in ("signal", "signalEmissive"):
        if sphere_sw.get(req_sph_sw, 0) <= 0:
            raise AssertionError(
                f"{ENDDOT_SPHERE_NAME} missing required red period swatch {req_sph_sw!r} (found {sphere_sw})"
            )
    dims = vn_bevel._mesh_dimensions(sphere_obj)
    for axis_idx, axis_dim in enumerate(dims):
        if not (3.85 <= axis_dim <= 4.15):
            raise AssertionError(
                f"{ENDDOT_SPHERE_NAME} axis {axis_idx} dimension {axis_dim:.3f} m outside 4.0 m target"
            )

    # Verify D15 arrival Copper Pipe trade-dress compliance (0 green faces, copper+ink+signal)
    pipe_sw = report["meshes"]["OrigensEndDotArrivalPipe"]["swatches"]
    if set(pipe_sw.keys()) & platform_kit.FORBIDDEN_GREEN_SWATCHES:
        raise AssertionError(f"Arrival pipe uses forbidden green swatches: {pipe_sw}")
    for req_pipe_sw in ("copper", "copperShadow", "ink", "signal"):
        if pipe_sw.get(req_pipe_sw, 0) <= 0:
            raise AssertionError(f"Arrival pipe missing D15 swatch {req_pipe_sw!r}")

    # Verify analytical colliders exist for both landmarks
    bus_colliders = built["bus_stop"]["colliders"]
    enddot_colliders = built["enddot"]["colliders"]
    if len(bus_colliders) < 5:
        raise AssertionError(f"Expected >= 5 bus stop cuboid colliders, found {len(bus_colliders)}")
    if not any(c.name == "ballOrigensEndDotSphere" for c in enddot_colliders):
        raise AssertionError("Missing ballOrigensEndDotSphere collider on OrigensEndDotSphere")

    print("==================================================================")
    print("T2.13d LANDMARK AUDIT PASS | Ponto de Ônibus + Mini-Ilha Ponto Final")
    print("==================================================================")
    for name, info in report["meshes"].items():
        print(
            f"  [PASS] {name:<26} | {info['triangles']:>4} tris | "
            f"mat={info['materials']} | non_manifold={info['non_manifold_edges']} | "
            f"swatches={info['swatches']}"
        )
    print(
        f"  [PASS] Total Triangles: {total_tris} (budget {LANDMARK_TRI_MIN}..{LANDMARK_TRI_MAX}) | "
        f"Materials: {sorted(report['materials'])}"
    )
    print(
        f"  [PASS] {ENDDOT_SPHERE_NAME} dimensions: "
        f"{dims[0]:.2f} x {dims[1]:.2f} x {dims[2]:.2f} m | "
        f"colliders: bus={len(bus_colliders)}, enddot={len(enddot_colliders)}"
    )
    print("==================================================================")

    report["materials"] = sorted(report["materials"])
    return report


def main() -> None:
    vn_scene.reset_scene(name="OrigensBusEndDotScene")
    built = build_origens_bus_enddot(
        collection_name="OrigensBusEndDot",
        include_colliders=True,
    )
    verify_origens_bus_enddot(built)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)

    vn_export.export_glb(
        str(GLB_OUT_PATH),
        collections=["OrigensBusEndDot"],
    )
    vn_scene.render_3views(
        str(PREVIEW_OUT_PATH),
        size=512,
    )


if __name__ == "__main__":
    main()
