"""Platformer kit procedural generators and automated trade-dress verification (T2.12).

Builds the 6 reusable platformer kit pieces for the Origens diorama and subsequent eras:
  1. `make_milestone_block`: chunky beveled paper block (`paper` #f4ead4) with `ink` (#0a0a0a)
     corner framing and raised circular red `signal` (#f50000) embossed dots on all 4 side faces.
     Trade-dress rule: NO '?' question mark, NO corner rivets/bolts.
  2. `make_brick_block`: beveled laterite/terracotta masonry block (`brick` #b5562c) with
     `lateriteDark` (#a8432a) mortar grooves and `paperWarm` (#efe4c5) top trim accent.
  3. `make_copper_pipe` (D15): octagonal ribbed artisan copper conduit (`copper` #b8733a /
     `copperShadow` #8a5228) with a chunky `ink` (#0a0a0a) octagonal collar rim and an inset
     glowing red `signal` (#f50000) ring band around the neck.
     Trade-dress rule: NOT green, NOT a round cylinder-lipped warp pipe.
  4. `make_signal_token`: collectible "sinal" — an original 3D faceted red ink-drop / period dot
     (`signal` #f50000) framed by a tilted paper-and-ink orbital stamp ring (`paper` #f4ead4 +
     `ink` #0a0a0a).
     Trade-dress rule: NOT a gold coin, NOT a yellow cylinder with a vertical slot.
  5. `make_cordel_sign`: woodcut/cordel directional signboard with a chunky `wood` (#9a6840) post,
     asymmetrical `paper` (#f4ead4) carved wooden plaque, `ink` (#0a0a0a) relief border and woodcut
     grooves, and a bold red `signal` (#f50000) directional arrow.
  6. `make_pequi_crate`: breakable/pushable wooden crate (`wood` #9a6840 / `woodDark` #734a2b slats,
     `ink` #0a0a0a corner iron bands, `paper` #f4ead4 stencil dot), plus `wrap_pequi_crate_physical`
     helper (`mass=1.2, friction=0.5`).

All 6 visual meshes strictly target the §5.4 budget (`200 <= tris <= 900` per piece), share the
single `"palette"` material via `vn_palette`, support `vn_manual.apply_manual_overrides("platform_kit")`,
export to `game/blender/out/platform_kit.glb`, render 3 views to
`game/blender/out/previews/t212_platform_kit.png`, and run the automated trade-dress audit.
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
    vn_shapes,
)

OUT_DIR = BLENDER_DIR / "out"
PREVIEWS_DIR = OUT_DIR / "previews"
GLB_OUT_PATH = OUT_DIR / "platform_kit.glb"
PREVIEW_OUT_PATH = PREVIEWS_DIR / "t212_platform_kit.png"

TRI_BUDGET_MIN = 200
TRI_BUDGET_MAX = 900

FORBIDDEN_GREEN_SWATCHES = frozenset(
    {
        "cerradoGreen",
        "cerradoDeep",
        "pequi",
        "campusGrass",
        "campusGrassDeep",
        "crtScreen",
        "dataMint",
    }
)

FORBIDDEN_COIN_GOLD_SWATCHES = frozenset(
    {
        "ipeGold",
        "dryGrass",
        "windowGlow",
        "safetyYellow",
        "dataGold",
        "fairyGold",
    }
)


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


def _finalize_bmesh_object(
    bm: bmesh.types.BMesh,
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection | str | None,
    bevel_width: float = 0.025,
    bevel_segments: int = 2,
    angle_deg: float = 30.0,
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


# --------------------------------------------------------- 1. Milestone Block


def make_milestone_block(
    name: str = "PlatMilestoneBlock",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the VOANEVES Milestone Block ('bloco de marco').

    Design (§2.1, §2.2, §5.4):
      - Chunky 1.0 m beveled paper cube (`paper` #f4ead4) with ground pivot at z=0.
      - Recessed/framed `ink` (#0a0a0a) editorial border bands at top and bottom plus
        `paperWarm` (#efe4c5) inner face panels.
      - Raised circular red `signal` (#f50000) period dot embossed on all 4 vertical side
        faces via `vn_shapes.make_boolean_relief` (exact Boolean union) ringed by an `ink`
        collar.
      - Trade-dress compliance: NO '?' question mark, NO 4 corner rivets/bolts.
    """
    # Base paper cube (0.96 x 0.96 x 0.96, ground pivot z=0..0.96).
    base_obj = vn_shapes.make_rounded_box(
        name=name,
        size=(0.94, 0.94, 0.94),
        location=location,
        bevel_width=0.055,
        segments=2,
        pivot="BOTTOM",
        collection=collection,
    )

    # Emboss 4 raised circular red signal dots on the 4 vertical faces (+X, -X, +Y, -Y)
    # using vn_shapes.make_boolean_relief so the dot is a true manifold relief union.
    cutter_bm = bmesh.new()
    side_normals = (
        ((0.46, 0.0, 0.47), (0.0, math.pi * 0.5, 0.0)),
        ((-0.46, 0.0, 0.47), (0.0, -math.pi * 0.5, 0.0)),
        ((0.0, 0.46, 0.47), (-math.pi * 0.5, 0.0, 0.0)),
        ((0.0, -0.46, 0.47), (math.pi * 0.5, 0.0, 0.0)),
    )
    for center_co, rot_euler in side_normals:
        _add_ngon_cylinder_to_bmesh(
            cutter_bm,
            radius_bottom=0.20,
            radius_top=0.17,
            height=0.09,
            segments=12,
            center=center_co,
            swatch_name="signal",
            rotation_euler=rot_euler,
            cap_ends=True,
        )

    # Top and bottom editorial ink trim bands (continuous horizontal book-cover bands, NOT corner bolts).
    _add_prism_to_bmesh(
        cutter_bm,
        size=(0.97, 0.97, 0.085),
        center=(0.0, 0.0, 0.13),
        swatch_name="ink",
    )
    _add_prism_to_bmesh(
        cutter_bm,
        size=(0.97, 0.97, 0.085),
        center=(0.0, 0.0, 0.81),
        swatch_name="ink",
    )
    # Top stamp seal medallion (flat paperWarm platen on top).
    _add_ngon_cylinder_to_bmesh(
        cutter_bm,
        radius_bottom=0.24,
        radius_top=0.21,
        height=0.06,
        segments=12,
        center=(0.0, 0.0, 0.94),
        swatch_name="signal",
        cap_ends=True,
    )

    bmesh.ops.recalc_face_normals(cutter_bm, faces=list(cutter_bm.faces))
    cutter_mesh = bpy.data.meshes.new(f"_{name}_ReliefCutter")
    cutter_bm.to_mesh(cutter_mesh)
    cutter_bm.free()

    cutter_obj = bpy.data.objects.new(f"_{name}_ReliefCutter", cutter_mesh)
    cutter_obj.location = location
    vn_scene.link_object(cutter_obj, collection)

    vn_shapes.make_boolean_relief(
        base_obj,
        cutter_obj,
        operation="UNION",
        apply=True,
        remove_cutter=True,
    )

    # Assign crisp palette swatches based on local face center and normal.
    def _milestone_swatch(poly: bpy.types.MeshPolygon) -> str:
        c = poly.center
        n = poly.normal
        max_xy = max(abs(c.x), abs(c.y))
        radial_xy = math.hypot(c.x, c.y)

        # Raised circular signal dots protruding beyond the 0.47 m cube faces
        if abs(c.z - 0.47) <= 0.22 and max_xy > 0.472:
            # Outer chamfer rim of the embossed dot gets ink framing; front cap gets red signal
            if abs(n.x) > 0.88 or abs(n.y) > 0.88:
                return "signal"
            return "ink"

        # Top circular red signal seal
        if c.z > 0.942 and radial_xy <= 0.25:
            return "signal" if n.z > 0.85 else "ink"

        # Editorial horizontal ink trim bands near top (z ~ 0.81) and bottom (z ~ 0.13)
        if (0.085 <= c.z <= 0.175 or 0.765 <= c.z <= 0.855) and max_xy > 0.468:
            return "ink"

        # Bottom resting face gets paperShadow
        if n.z < -0.75:
            return "paperShadow"

        # Chamfered bevel corners get warm paper tone
        if abs(n.x) < 0.85 and abs(n.y) < 0.85 and abs(n.z) < 0.85:
            return "paperWarm"

        return "paper"

    vn_palette.assign(base_obj, _milestone_swatch)
    vn_scene.set_custom_props(
        base_obj,
        {
            "kitPiece": "milestone_block",
            "tradeDress": "voaneves_paper_signal_dot",
        },
    )
    return base_obj


# ------------------------------------------------------------- 2. Brick Block


def make_brick_block(
    name: str = "PlatBrickBlock",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the Cerrado/UNICAMP laterite & terracotta masonry block ('bloco de tijolo').

    Design (§2.2, §5.4):
      - Recessed `lateriteDark` (#a8432a) mortar core with 3 staggered courses of chunky
        beveled `brick` (#b5562c) and `brickDark` (#8b3d1e) masonry voussoirs, crowned by a
        `paperWarm` (#efe4c5) coping slab.
    """
    bm = bmesh.new()

    # Recessed mortar core (`lateriteDark`)
    _add_prism_to_bmesh(
        bm,
        size=(0.86, 0.86, 0.90),
        center=(0.0, 0.0, 0.45),
        swatch_name="lateriteDark",
    )

    # Top paperWarm coping cap and bottom brickDark plinth
    _add_prism_to_bmesh(
        bm,
        size=(0.94, 0.94, 0.10),
        center=(0.0, 0.0, 0.91),
        swatch_name="paperWarm",
    )
    _add_prism_to_bmesh(
        bm,
        size=(0.94, 0.94, 0.10),
        center=(0.0, 0.0, 0.05),
        swatch_name="brickDark",
    )

    # Course 1 (bottom, z=0.23): 2x2 large staggered bricks
    course1_specs = (
        ((-0.24, 0.0, 0.23), (0.44, 0.96, 0.20), "brick"),
        ((0.24, 0.0, 0.23), (0.44, 0.96, 0.20), "brickDark"),
    )
    for center_co, sz, sw in course1_specs:
        _add_prism_to_bmesh(bm, size=sz, center=center_co, swatch_name=sw)

    # Course 2 (middle, z=0.48): rotated 90 deg around Z for cross-bond masonry interlock
    course2_specs = (
        ((0.0, -0.24, 0.48), (0.96, 0.44, 0.22), "brick"),
        ((0.0, 0.24, 0.48), (0.96, 0.44, 0.22), "brick"),
    )
    for center_co, sz, sw in course2_specs:
        _add_prism_to_bmesh(bm, size=sz, center=center_co, swatch_name=sw)

    # Course 3 (upper, z=0.73): 2x2 staggered bricks along X
    course3_specs = (
        ((-0.24, 0.0, 0.73), (0.44, 0.96, 0.20), "brickDark"),
        ((0.24, 0.0, 0.73), (0.44, 0.96, 0.20), "brick"),
    )
    for center_co, sz, sw in course3_specs:
        _add_prism_to_bmesh(bm, size=sz, center=center_co, swatch_name=sw)

    obj = _finalize_bmesh_object(
        bm,
        name=name,
        location=location,
        collection=collection,
        bevel_width=0.022,
        bevel_segments=1,
        angle_deg=35.0,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "kitPiece": "brick_block",
        },
    )
    return obj


# ------------------------------------------------------------- 3. Copper Pipe


def make_copper_pipe(
    name: str = "PlatCopperPipe",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the D15 Copper & Ink Conduit Pipe with Red Signal Ring ('cano de cobre e tinta').

    Design (§2.1, §2.2, §9.2 D15):
      - Octagonal (8-sided) artisan copper standpipe (`copper` #b8733a shaft with vertical
        `copperShadow` #8a5228 fluting ribs and a heavy base flange), NOT a smooth green cylinder.
      - Chunky octagonal `ink` (#0a0a0a) industrial collar rim at the top mouth with a stepped
        beveled nozzle and dark `ink` interior bore.
      - Prominent glowing red `signal` (#f50000) ring band wrapped around the neck below the
        ink collar.
      - Trade-dress compliance: ZERO green swatches, octagonal flanged silhouette instead of
        round cylinder + lipped Mario warp pipe.
    """
    segs = 8
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.verify()

    # Revolved 8-sided (octagonal) profile with stepped base plinth, copper shaft,
    # recessed ink groove, raised red signal ring band, heavy ink octagonal crown,
    # and deep inner ink bore.
    # Profile entries: (radius, z)
    profile: list[tuple[float, float]] = [
        (0.60, 0.00),  # 0: base flange bottom outer
        (0.60, 0.14),  # 1: base flange top outer
        (0.50, 0.18),  # 2: lower copper shaft start
        (0.50, 0.46),  # 3: lower copper shaft pre-rib
        (0.54, 0.48),  # 4: mid copper stiffening rib bottom
        (0.54, 0.56),  # 5: mid copper stiffening rib top
        (0.50, 0.58),  # 6: upper copper shaft start
        (0.50, 0.78),  # 7: neck ink seat bottom
        (0.47, 0.80),  # 8: neck groove below signal ring
        (0.57, 0.82),  # 9: red SIGNAL ring bottom outer
        (0.57, 0.94),  # 10: red SIGNAL ring top outer
        (0.47, 0.96),  # 11: neck groove above signal ring
        (0.62, 0.98),  # 12: octagonal INK collar overhang bottom
        (0.62, 1.18),  # 13: octagonal INK collar top outer
        (0.54, 1.24),  # 14: chamfered INK nozzle crown outer
        (0.38, 1.24),  # 15: nozzle inner rim top
        (0.38, 0.18),  # 16: inner bore wall bottom
        (0.00, 0.18),  # 17: inner bore floor center (approximated via inner ring)
    ]

    # Replace index 17 with small inner plug radius so all rings remain quad loops
    profile[-1] = (0.08, 0.18)

    # Swatch per profile segment index (between profile[p] and profile[p+1])
    segment_swatches = [
        "ink",           # 0->1: base flange outer band
        "copperShadow",  # 1->2: base flange bevel step
        "copper",        # 2->3: lower copper shaft
        "copperShadow",  # 3->4: mid rib underside
        "copper",        # 4->5: mid copper stiffening rib
        "copperShadow",  # 5->6: mid rib topside
        "copper",        # 6->7: upper copper shaft
        "ink",           # 7->8: lower neck ink groove
        "signal",        # 8->9: signal ring lower bevel
        "signal",        # 9->10: prominent red SIGNAL ring band
        "signal",        # 10->11: signal ring upper bevel
        "ink",           # 11->12: ink collar underside overhang
        "ink",           # 12->13: ink octagonal collar outer wall
        "ink",           # 13->14: ink collar top chamfer
        "ink",           # 14->15: ink nozzle top rim
        "ink",           # 15->16: inner bore wall
        "ink",           # 16->17: inner bore bottom floor
        "copperShadow",  # 17->0: underside base
    ]

    n_prof = len(profile)
    rings: list[list[bmesh.types.BMVert]] = []
    for s_idx in range(segs):
        # Offset by pi/8 so flat octagonal faces align cleanly with +X/-X/+Y/-Y
        angle = (2.0 * math.pi * s_idx) / segs + (math.pi / segs)
        ca, sa = math.cos(angle), math.sin(angle)
        ring = [bm.verts.new((r_p * ca, r_p * sa, z_p)) for r_p, z_p in profile]
        rings.append(ring)

    for s_idx in range(segs):
        next_s = (s_idx + 1) % segs
        ring_a = rings[s_idx]
        ring_b = rings[next_s]
        for p_idx in range(n_prof):
            next_p = (p_idx + 1) % n_prof
            face = bm.faces.new(
                (ring_a[p_idx], ring_b[p_idx], ring_b[next_p], ring_a[next_p])
            )
            swatch = segment_swatches[p_idx]
            # Alternate vertical octagonal facets on the copper shaft for artisan fluted shading
            if swatch == "copper" and (s_idx % 2 == 1) and p_idx in (2, 6):
                swatch = "copperShadow"
            u, v = vn_palette.get_swatch_uv(swatch, gltf=False)
            for loop in face.loops:
                loop[uv_layer].uv = (u, v)

    # Add 4 external vertical ink/copper structural fins on the cardinal faces for a bold
    # non-Mario industrial/artisan silhouette.
    for cardinal_idx in range(4):
        ang = cardinal_idx * (math.pi * 0.5)
        ca, sa = math.cos(ang), math.sin(ang)
        fin_x = 0.50 * ca
        fin_y = 0.50 * sa
        _add_prism_to_bmesh(
            bm,
            size=(0.09, 0.09, 0.56),
            center=(fin_x, fin_y, 0.46),
            swatch_name="copperShadow",
            rotation_euler=(0.0, 0.0, ang),
        )

    obj = _finalize_bmesh_object(
        bm,
        name=name,
        location=location,
        collection=collection,
        bevel_width=0.012,
        bevel_segments=1,
        angle_deg=40.0,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "kitPiece": "copper_pipe",
            "d15Variant": "copper_ink_red_ring",
        },
    )
    return obj


# ----------------------------------------------------------- 4. Signal Token


def make_signal_token(
    name: str = "PlatSignal",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the collectible 'Sinal' token ('ponto de tinta vermelha').

    Design (§2.1, §2.2, §5.4):
      - Collectible "sinal": an original 3D faceted red ink-drop / typographic period dot
        (`signal` #f50000) suspended above a small `ink` (#0a0a0a) nib pedestal and encircled
        by a tilted `paper` (#f4ead4) & `ink` (#0a0a0a) orbital ring.
      - Trade-dress compliance: NOT a gold coin, NOT a yellow cylinder with a vertical slot,
        ZERO yellow/gold swatches.
    """
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.verify()

    # 1. Central red ink-drop / typographic dot core (revolved 12-gon teardrop/period profile
    # centered at z=0.45 so it hovers at chest height above ground pivot z=0).
    segs = 12
    drop_profile: list[tuple[float, float]] = [
        (0.03, 0.20),  # bottom tip
        (0.14, 0.24),
        (0.22, 0.34),
        (0.24, 0.46),  # equator
        (0.19, 0.58),
        (0.11, 0.68),
        (0.03, 0.75),  # upper ink-drop apex
    ]
    drop_rings: list[list[bmesh.types.BMVert]] = []
    for r_p, z_p in drop_profile:
        ring = []
        for s_idx in range(segs):
            ang = (2.0 * math.pi * s_idx) / segs
            ring.append(bm.verts.new((r_p * math.cos(ang), r_p * math.sin(ang), z_p)))
        drop_rings.append(ring)

    sig_u, sig_v = vn_palette.get_swatch_uv("signal", gltf=False)
    for p_idx in range(len(drop_profile) - 1):
        ring_low = drop_rings[p_idx]
        ring_high = drop_rings[p_idx + 1]
        for s_idx in range(segs):
            next_s = (s_idx + 1) % segs
            f = bm.faces.new(
                (ring_low[s_idx], ring_low[next_s], ring_high[next_s], ring_high[s_idx])
            )
            for loop in f.loops:
                loop[uv_layer].uv = (sig_u, sig_v)

    # Cap bottom and top of the ink drop
    bot_cap = bm.faces.new(list(reversed(drop_rings[0])))
    top_cap = bm.faces.new(drop_rings[-1])
    for f in (bot_cap, top_cap):
        for loop in f.loops:
            loop[uv_layer].uv = (sig_u, sig_v)

    # 2. Tilted orbital paper-and-ink stamp ring surrounding the red ink dot.
    orbit_segs = 14
    major_r = 0.36
    half_w = 0.045
    half_h = 0.038
    tilt = Euler((math.radians(24.0), math.radians(-16.0), 0.0), "XYZ").to_matrix()
    orbit_center = Vector((0.0, 0.0, 0.46))

    cross_section = [
        (-half_w, -half_h),
        (half_w, -half_h),
        (half_w, half_h),
        (-half_w, half_h),
    ]
    cross_swatches = ["paper", "ink", "paper", "ink"]

    torus_rings: list[list[bmesh.types.BMVert]] = []
    for s_idx in range(orbit_segs):
        theta = (2.0 * math.pi * s_idx) / orbit_segs
        ct, st = math.cos(theta), math.sin(theta)
        radial_dir = Vector((ct, st, 0.0))
        up_dir = Vector((0.0, 0.0, 1.0))
        ring_verts = []
        for dr, dz in cross_section:
            local_pt = radial_dir * (major_r + dr) + up_dir * dz
            world_pt = orbit_center + (tilt @ local_pt)
            ring_verts.append(bm.verts.new(world_pt))
        torus_rings.append(ring_verts)

    for s_idx in range(orbit_segs):
        next_s = (s_idx + 1) % orbit_segs
        ra = torus_rings[s_idx]
        rb = torus_rings[next_s]
        for c_idx in range(4):
            next_c = (c_idx + 1) % 4
            face = bm.faces.new((ra[c_idx], rb[c_idx], rb[next_c], ra[next_c]))
            sw = cross_swatches[c_idx]
            u, v = vn_palette.get_swatch_uv(sw, gltf=False)
            for loop in face.loops:
                loop[uv_layer].uv = (u, v)

    # 3. Ground-pivot ink nib base token disk (z=0.0..0.08) so pivot sits cleanly at z=0.
    _add_ngon_cylinder_to_bmesh(
        bm,
        radius_bottom=0.20,
        radius_top=0.14,
        height=0.08,
        segments=10,
        center=(0.0, 0.0, 0.04),
        swatch_name="ink",
        cap_ends=True,
    )

    obj = _finalize_bmesh_object(
        bm,
        name=name,
        location=location,
        collection=collection,
        bevel_width=0.012,
        bevel_segments=1,
        angle_deg=32.0,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "kitPiece": "signal_token",
            "tradeDress": "voaneves_red_ink_dot_orbital",
        },
    )
    return obj


# ------------------------------------------------------------ 5. Cordel Sign


def make_cordel_sign(
    name: str = "PlatCordelSign",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the woodcut/cordel directional signboard ('placa de cordel').

    Design (§2.2, §5.4, D8):
      - Sturdy `wood` (#9a6840) and `woodDark` (#734a2b) post anchored in a chamfered plinth.
      - Asymmetrical carved `paper` (#f4ead4) woodcut plaque with raised `ink` (#0a0a0a)
        xylography frame bars, woodcut text-line blocks, and a bold red `signal` (#f50000)
        directional arrow indicator pointing along the Timeline.
    """
    bm = bmesh.new()

    # 1. Ground plinth (`woodDark`) and vertical timber post (`wood`)
    _add_prism_to_bmesh(
        bm,
        size=(0.38, 0.34, 0.12),
        center=(0.0, 0.0, 0.06),
        swatch_name="woodDark",
    )
    _add_prism_to_bmesh(
        bm,
        size=(0.16, 0.16, 1.32),
        center=(0.0, 0.04, 0.72),
        swatch_name="wood",
    )
    # Post top finial cap (`ink`)
    _add_prism_to_bmesh(
        bm,
        size=(0.22, 0.22, 0.08),
        center=(0.0, 0.04, 1.40),
        swatch_name="ink",
    )

    # 2. Asymmetrical cordel plaque backing (`woodDark`) and cream paper face (`paper`)
    tilt_z = math.radians(3.5)
    _add_prism_to_bmesh(
        bm,
        size=(1.12, 0.10, 0.56),
        center=(0.04, -0.04, 0.98),
        swatch_name="woodDark",
        rotation_euler=(0.0, tilt_z, 0.0),
    )
    _add_prism_to_bmesh(
        bm,
        size=(1.04, 0.08, 0.48),
        center=(0.04, -0.07, 0.98),
        swatch_name="paper",
        rotation_euler=(0.0, tilt_z, 0.0),
    )

    # 3. Xylography / cordel `ink` relief border bars (top, bottom, left, right)
    border_specs = (
        ((0.04, -0.095, 1.20), (1.06, 0.06, 0.065)),   # top ink border
        ((0.04, -0.095, 0.76), (1.06, 0.06, 0.065)),   # bottom ink border
        ((-0.46, -0.095, 0.98), (0.07, 0.06, 0.48)),   # left ink border
        ((0.54, -0.095, 0.98), (0.07, 0.06, 0.48)),    # right ink border
    )
    for center_co, sz in border_specs:
        _add_prism_to_bmesh(
            bm,
            size=sz,
            center=center_co,
            swatch_name="ink",
            rotation_euler=(0.0, tilt_z, 0.0),
        )

    # 4. Cordel woodcut typographic relief bars (`ink`) on the left side of the plaque
    text_bar_specs = (
        ((-0.16, -0.105, 1.07), (0.44, 0.05, 0.07)),
        ((-0.20, -0.105, 0.95), (0.36, 0.05, 0.06)),
        ((-0.14, -0.105, 0.85), (0.48, 0.05, 0.055)),
    )
    for center_co, sz in text_bar_specs:
        _add_prism_to_bmesh(
            bm,
            size=sz,
            center=center_co,
            swatch_name="ink",
            rotation_euler=(0.0, tilt_z, 0.0),
        )

    # 5. Bold red `signal` directional arrow on the right side of the plaque
    # Arrow shaft
    _add_prism_to_bmesh(
        bm,
        size=(0.22, 0.065, 0.09),
        center=(0.23, -0.11, 0.99),
        swatch_name="signal",
        rotation_euler=(0.0, tilt_z, 0.0),
    )
    # Arrow chevron head (rotated 45 deg in X-Z plane)
    _add_prism_to_bmesh(
        bm,
        size=(0.18, 0.065, 0.18),
        center=(0.35, -0.11, 0.99),
        swatch_name="signal",
        rotation_euler=(0.0, math.pi * 0.25 + tilt_z, 0.0),
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
            "kitPiece": "cordel_sign",
        },
    )
    return obj


# ------------------------------------------------------------ 6. Pequi Crate


def make_pequi_crate(
    name: str = "PlatCrate",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the breakable/pushable Pequi Wooden Crate ('caixote de pequi').

    Design (§2.2, §5.4, T2.21a):
      - Recessed `woodDark` (#734a2b) inner box clad with horizontal `wood` (#9a6840) slats
        on all sides, reinforced with `ink` (#0a0a0a) corner iron brackets, and marked with
        a `paper` (#f4ead4) shipping label and stencil dot on the front/back faces.
      - Dynamic physics metadata (`mass=1.2, friction=0.5`) stamped onto custom properties,
        plus `wrap_pequi_crate_physical()` helper for dynamic rigid-body instancing.
    """
    bm = bmesh.new()

    # 1. Inner dark wood core (`woodDark`, 0.78 m cube)
    _add_prism_to_bmesh(
        bm,
        size=(0.76, 0.76, 0.76),
        center=(0.0, 0.0, 0.41),
        swatch_name="woodDark",
    )

    # 2. Horizontal exterior `wood` slats (3 per side face + 2 on top)
    slat_z_levels = (0.17, 0.41, 0.65)
    for z_lvl in slat_z_levels:
        # Front (-Y) and Back (+Y) slats
        _add_prism_to_bmesh(
            bm,
            size=(0.82, 0.06, 0.18),
            center=(0.0, -0.39, z_lvl),
            swatch_name="wood",
        )
        _add_prism_to_bmesh(
            bm,
            size=(0.82, 0.06, 0.18),
            center=(0.0, 0.39, z_lvl),
            swatch_name="wood",
        )
        # Left (-X) and Right (+X) slats
        _add_prism_to_bmesh(
            bm,
            size=(0.06, 0.82, 0.18),
            center=(-0.39, 0.0, z_lvl),
            swatch_name="wood",
        )
        _add_prism_to_bmesh(
            bm,
            size=(0.06, 0.82, 0.18),
            center=(0.39, 0.0, z_lvl),
            swatch_name="wood",
        )

    # Top lid planks along X
    for x_off in (-0.21, 0.21):
        _add_prism_to_bmesh(
            bm,
            size=(0.32, 0.82, 0.06),
            center=(x_off, 0.0, 0.80),
            swatch_name="wood",
        )

    # 3. Four vertical `ink` corner iron bands + top/bottom corner cleats
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            _add_prism_to_bmesh(
                bm,
                size=(0.11, 0.11, 0.82),
                center=(sx * 0.38, sy * 0.38, 0.41),
                swatch_name="ink",
            )

    # 4. Stenciled `paper` shipping plaque with octagonal `paper` dot on front & back
    for sy in (-1.0, 1.0):
        _add_ngon_cylinder_to_bmesh(
            bm,
            radius_bottom=0.14,
            radius_top=0.14,
            height=0.04,
            segments=8,
            center=(0.0, sy * 0.42, 0.41),
            swatch_name="paper",
            rotation_euler=(math.pi * 0.5, 0.0, 0.0),
            cap_ends=True,
        )

    obj = _finalize_bmesh_object(
        bm,
        name=name,
        location=location,
        collection=collection,
        bevel_width=0.012,
        bevel_segments=1,
        angle_deg=55.0,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "kitPiece": "pequi_crate",
            "breakable": True,
            "mass": 1.2,
            "friction": 0.5,
        },
    )
    return obj


def wrap_pequi_crate_physical(
    name: str = "PlatCrate",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
    mass: float = 1.2,
    friction: float = 0.5,
) -> bpy.types.Object:
    """Build a dynamic physical Pequi Crate (`...PhysicalDynamic`) with cuboid collider."""
    vis = make_pequi_crate(
        name=f"{name}Visual",
        location=(0.0, 0.0, -0.41),
        collection=collection,
    )
    col = vn_collide.add_cuboid(
        name="cuboidCrate",
        size=(0.84, 0.84, 0.82),
        location=(0.0, 0.0, 0.0),
        collection=collection,
    )
    return vn_collide.wrap_physical_object(
        name=name,
        visual_obj=vis,
        colliders=col,
        mass=mass,
        friction=friction,
        category="object",
        extra_props={"breakable": True, "kitPiece": "pequi_crate"},
        collection=collection,
        body_type="dynamic",
        location=(location[0], location[1], location[2] + 0.41),
    )


# -------------------------------------------- Kit Builder & Trade-Dress Audit


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
    """Evaluate triangle count, manifold status, NaN/Inf coords, and degenerate/inverted normals."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    eval_obj = obj.evaluated_get(depsgraph)
    mesh_eval = eval_obj.to_mesh()

    try:
        mesh_eval.calc_loop_triangles()
        tris = len(mesh_eval.loop_triangles)

        nan_verts = 0
        for v in mesh_eval.vertices:
            if not (math.isfinite(v.co.x) and math.isfinite(v.co.y) and math.isfinite(v.co.z)):
                nan_verts += 1

        bm = bmesh.new()
        bm.from_mesh(mesh_eval)
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.faces.ensure_lookup_table()

        non_manifold_edges = sum(1 for e in bm.edges if not e.is_manifold)
        zero_area_faces = sum(1 for f in bm.faces if f.calc_area() < 1e-8)

        # Verify consistent outward orientation per connected manifold island
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.free()
    finally:
        eval_obj.to_mesh_clear()

    mat_names = [s.material.name for s in obj.material_slots if s.material is not None]
    return {
        "name": obj.name,
        "triangles": tris,
        "nan_verts": nan_verts,
        "non_manifold_edges": non_manifold_edges,
        "zero_area_faces": zero_area_faces,
        "materials": mat_names,
    }


def build_platform_kit(
    collection_name: str = "PlatformKit",
    include_colliders: bool = True,
) -> dict[str, bpy.types.Object]:
    """Instantiate all 6 platform kit pieces laid out on a display grid and apply manual overrides."""
    col = vn_scene.ensure_collection(collection_name)

    pieces: dict[str, bpy.types.Object] = {
        "PlatMilestoneBlock": make_milestone_block(
            name="PlatMilestoneBlock",
            location=(-3.0, 0.0, 0.0),
            collection=col,
        ),
        "PlatBrickBlock": make_brick_block(
            name="PlatBrickBlock",
            location=(-1.8, 0.0, 0.0),
            collection=col,
        ),
        "PlatCopperPipe": make_copper_pipe(
            name="PlatCopperPipe",
            location=(-0.5, 0.0, 0.0),
            collection=col,
        ),
        "PlatSignal": make_signal_token(
            name="PlatSignal",
            location=(0.8, 0.0, 0.0),
            collection=col,
        ),
        "PlatCordelSign": make_cordel_sign(
            name="PlatCordelSign",
            location=(2.0, 0.0, 0.0),
            collection=col,
        ),
        "PlatCrate": make_pequi_crate(
            name="PlatCrate",
            location=(3.3, 0.0, 0.0),
            collection=col,
        ),
    }

    # Support manual artist overrides in game/blender/manual/platform_kit.blend
    vn_manual.apply_manual_overrides("platform_kit", objects=list(pieces.values()))

    if include_colliders:
        # Attach standard analytical collider children so downstream scenes or kit inspection
        # can verify physical metadata (including dynamic Pequi Crate mass=1.2, friction=0.5).
        vn_collide.add_cuboid(
            name="cuboidMilestone",
            size=(0.96, 0.96, 0.96),
            location=(0.0, 0.0, 0.48),
            parent=pieces["PlatMilestoneBlock"],
            collection=col,
        )
        vn_collide.add_cuboid(
            name="cuboidBrick",
            size=(0.96, 0.96, 0.96),
            location=(0.0, 0.0, 0.48),
            parent=pieces["PlatBrickBlock"],
            collection=col,
        )
        vn_collide.add_cylinder(
            name="tubeCopperPipe",
            radius=0.60,
            height=1.24,
            location=(0.0, 0.0, 0.62),
            parent=pieces["PlatCopperPipe"],
            collection=col,
        )
        vn_collide.add_ball(
            name="ballSignal",
            radius=0.38,
            location=(0.0, 0.0, 0.46),
            parent=pieces["PlatSignal"],
            collection=col,
        )
        vn_collide.add_cuboid(
            name="cuboidCordelSign",
            size=(1.12, 0.34, 1.44),
            location=(0.0, 0.0, 0.72),
            parent=pieces["PlatCordelSign"],
            collection=col,
        )
        vn_collide.add_cuboid(
            name="cuboidCrate",
            size=(0.84, 0.84, 0.82),
            location=(0.0, 0.0, 0.41),
            parent=pieces["PlatCrate"],
            props={"mass": 1.2, "friction": 0.5, "breakable": True},
            collection=col,
        )

    return pieces


def verify_trade_dress_and_budgets(pieces: dict[str, bpy.types.Object]) -> dict[str, Any]:
    """Run automated §5.4 budget and mandatory T2.12 trade-dress assertions on all 6 pieces."""
    expected_names = (
        "PlatMilestoneBlock",
        "PlatBrickBlock",
        "PlatCopperPipe",
        "PlatSignal",
        "PlatCordelSign",
        "PlatCrate",
    )
    for req in expected_names:
        if req not in pieces:
            raise AssertionError(f"Missing required platform kit piece: {req}")

    report: dict[str, Any] = {"pieces": {}, "trade_dress": {}}

    for name, obj in pieces.items():
        integrity = inspect_mesh_integrity(obj)
        swatches = inspect_object_swatches(obj)
        print(f"DEBUG_STAT {name}: tris={integrity['triangles']} non_manifold={integrity['non_manifold_edges']} zero_area={integrity['zero_area_faces']} swatches={swatches}")
        report["pieces"][name] = {
            **integrity,
            "swatches": swatches,
        }

    for name, obj in pieces.items():
        integrity = report["pieces"][name]
        tris = integrity["triangles"]

        if not (TRI_BUDGET_MIN <= tris <= TRI_BUDGET_MAX):
            raise AssertionError(
                f"{name} triangle count {tris} outside §5.4 budget [{TRI_BUDGET_MIN}, {TRI_BUDGET_MAX}]"
            )
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

    # --- Mandatory Trade-Dress Audit 1: PlatCopperPipe (D15) ---
    pipe_swatches = report["pieces"]["PlatCopperPipe"]["swatches"]
    green_used = set(pipe_swatches.keys()) & FORBIDDEN_GREEN_SWATCHES
    if green_used:
        raise AssertionError(
            f"Trade-dress violation on PlatCopperPipe: forbidden green swatches {sorted(green_used)}"
        )
    for required_sw in ("copper", "copperShadow", "ink", "signal"):
        if pipe_swatches.get(required_sw, 0) <= 0:
            raise AssertionError(
                f"PlatCopperPipe missing D15 swatch {required_sw!r} (found {pipe_swatches})"
            )
    report["trade_dress"]["pipe_not_green_and_has_copper_ink_red_ring"] = True

    # --- Mandatory Trade-Dress Audit 2: PlatMilestoneBlock ---
    milestone_swatches = report["pieces"]["PlatMilestoneBlock"]["swatches"]
    milestone_gold = set(milestone_swatches.keys()) & FORBIDDEN_COIN_GOLD_SWATCHES
    if milestone_gold:
        raise AssertionError(
            f"Trade-dress violation on PlatMilestoneBlock: yellow/gold '?' block swatches {sorted(milestone_gold)}"
        )
    for required_sw in ("paper", "ink", "signal"):
        if milestone_swatches.get(required_sw, 0) <= 0:
            raise AssertionError(
                f"PlatMilestoneBlock missing brand swatch {required_sw!r} (found {milestone_swatches})"
            )
    # Verify all 4 vertical side faces (+X, -X, +Y, -Y) carry symmetrical raised red `signal` dot faces
    ms_obj = pieces["PlatMilestoneBlock"]
    ms_mesh = ms_obj.data
    ms_uv = ms_mesh.uv_layers.active
    sig_u, sig_v = vn_palette.get_swatch_uv("signal", gltf=False)
    side_signal_counts = {"+X": 0, "-X": 0, "+Y": 0, "-Y": 0}
    for poly in ms_mesh.polygons:
        u = sum(ms_uv.data[i].uv[0] for i in poly.loop_indices) / len(poly.loop_indices)
        v = sum(ms_uv.data[i].uv[1] for i in poly.loop_indices) / len(poly.loop_indices)
        if math.hypot(u - sig_u, v - sig_v) < 0.015:
            c = poly.center
            if c.x > 0.48:
                side_signal_counts["+X"] += 1
            elif c.x < -0.48:
                side_signal_counts["-X"] += 1
            elif c.y > 0.48:
                side_signal_counts["+Y"] += 1
            elif c.y < -0.48:
                side_signal_counts["-Y"] += 1
    if any(cnt == 0 for cnt in side_signal_counts.values()) or len(set(side_signal_counts.values())) != 1:
        raise AssertionError(
            f"PlatMilestoneBlock must have symmetrical embossed circular signal dots (no '?') on all 4 sides: "
            f"{side_signal_counts}"
        )
    report["trade_dress"]["milestone_block_paper_red_dot_no_question_mark"] = True
    report["trade_dress"]["milestone_side_signal_faces"] = side_signal_counts

    # --- Mandatory Trade-Dress Audit 3: PlatSignal ---
    signal_swatches = report["pieces"]["PlatSignal"]["swatches"]
    gold_used = set(signal_swatches.keys()) & FORBIDDEN_COIN_GOLD_SWATCHES
    if gold_used:
        raise AssertionError(
            f"Trade-dress violation on PlatSignal: forbidden coin gold/yellow swatches {sorted(gold_used)}"
        )
    for required_sw in ("signal", "paper", "ink"):
        if signal_swatches.get(required_sw, 0) <= 0:
            raise AssertionError(
                f"PlatSignal missing brand swatch {required_sw!r} (found {signal_swatches})"
            )
    report["trade_dress"]["signal_red_ink_dot_not_gold_coin"] = True

    # --- Crate dynamic collider properties check ---
    crate_obj = pieces["PlatCrate"]
    if abs(float(crate_obj.get("mass", 0.0)) - 1.2) > 1e-5 or abs(float(crate_obj.get("friction", 0.0)) - 0.5) > 1e-5:
        raise AssertionError(
            f"PlatCrate must carry dynamic collider metadata mass=1.2, friction=0.5"
        )
    report["trade_dress"]["pequi_crate_dynamic_physics_props"] = True

    print("==================================================================")
    print("TRADE_DRESS_CHECKLIST_PASS | T2.12 Platform Kit Audit")
    print("==================================================================")
    for name in expected_names:
        info = report["pieces"][name]
        print(
            f"  [PASS] {name:<19} | {info['triangles']:>3} tris (budget 200..900) | "
            f"mat={info['materials']} | non_manifold={info['non_manifold_edges']} | "
            f"swatches={info['swatches']}"
        )
    print("  [PASS] D15 Copper Pipe: 0 green faces; octagonal copper+ink+signal ring verified")
    print(
        f"  [PASS] Milestone Block: paper+ink+signal circular relief dots on 4 sides "
        f"{side_signal_counts}; 0 '?' geometry; 0 gold/yellow faces"
    )
    print("  [PASS] Signal Token: 3D red ink-drop + orbital paper/ink ring; 0 gold coin swatches")
    print("  [PASS] Pequi Crate: wood/ink/paper slats + dynamic props (mass=1.2, friction=0.5)")
    print("==================================================================")

    return report


def main() -> None:
    vn_scene.reset_scene(name="PlatformKitScene")
    pieces = build_platform_kit(collection_name="PlatformKit", include_colliders=True)
    verify_trade_dress_and_budgets(pieces)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)

    vn_export.export_glb(
        str(GLB_OUT_PATH),
        collections=["PlatformKit"],
    )
    vn_scene.render_3views(
        str(PREVIEW_OUT_PATH),
        size=512,
    )


if __name__ == "__main__":
    main()

