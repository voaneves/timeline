"""Procedural industrial kit for Era 3 'Indústria' (2017–2019).

Builds modular, palette-calibrated industrial architecture and props:
  - `make_factory_hall`: Brick & steel factory hall with sawtooth skylight roof,
    loading bay, copper venting pipes, and zero third-party logos/trade dress.
  - `make_conveyor_frame`: Static conveyor trestle with safety-yellow side rails.
  - `make_conveyor_belt_platform`: Kinematic moving conveyor belt platform
    (`*PhysicalKinematicPositionBased`) with `cuboid*` collider and `start`/`end`/`speed`/`pause`.
  - `make_generic_bottle`: Generic faceted glass/paper bottle (`mass=0.35`, kickable)
    with ZERO third-party brand logos or contour-bottle trade dress.
  - `make_catwalk_tower`: Stepped industrial Trainee Tower with walkable stairs/catwalk
    and safety-yellow handrails.
  - `make_pier_deck`: Canal-side timber & steel pier for the Paper Airship dock.
  - `make_gear_wheel`: Beveled industrial gear wheel for the Secret Vault and accents.
"""

from __future__ import annotations

import math
from typing import Iterable

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from lib import vn_collide, vn_palette, vn_scene, vn_shapes


def _assign_uv(
    bm: bmesh.types.BMesh,
    faces: Iterable[bmesh.types.BMFace],
    swatch_name: str,
) -> None:
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
    top_swatch: str | None = None,
) -> list[bmesh.types.BMFace]:
    ret = bmesh.ops.create_cube(bm, size=1.0)
    verts = list(ret["verts"])
    vert_set = set(verts)

    sx, sy, sz = (float(v) for v in size)
    for v in verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz

    if rotation_euler is not None:
        rot = Euler(rotation_euler, "XYZ").to_matrix()
        for v in verts:
            v.co = rot @ v.co

    cx, cy, cz = (float(v) for v in center)
    offset = Vector((cx, cy, cz))
    for v in verts:
        v.co += offset

    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
    bm.normal_update()
    _assign_uv(bm, faces, swatch_name)
    if top_swatch is not None:
        top_faces = [f for f in faces if f.normal.z > 0.65]
        if top_faces:
            _assign_uv(bm, top_faces, top_swatch)
    return faces


def _add_prism(
    bm: bmesh.types.BMesh,
    radius: float,
    height: float,
    segments: int,
    center: tuple[float, float, float],
    swatch_name: str,
    rotation_euler: tuple[float, float, float] | None = None,
) -> list[bmesh.types.BMFace]:
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=max(3, int(segments)),
        radius1=float(radius),
        radius2=float(radius),
        depth=float(height),
    )
    verts = list(ret["verts"])
    vert_set = set(verts)
    if rotation_euler is not None:
        rot = Euler(rotation_euler, "XYZ").to_matrix()
        for v in verts:
            v.co = rot @ v.co
    offset = Vector(tuple(float(c) for c in center))
    for v in verts:
        v.co += offset
    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
    _assign_uv(bm, faces, swatch_name)
    return faces


def _finalize_bm(
    bm: bmesh.types.BMesh,
    name: str,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_euler: tuple[float, float, float] | None = None,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    bm.normal_update()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(float(c) for c in location)
    if rotation_euler is not None:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = tuple(float(a) for a in rotation_euler)

    mat = vn_palette.ensure_palette_material()
    mesh.materials.append(mat)
    vn_scene.link_object(obj, collection)
    return obj


# ------------------------------------------------------------------ 1. Factory Hall


def make_factory_hall(
    name: str = "IndustriaFactoryHall",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_euler: tuple[float, float, float] | None = None,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the brick & steel factory hall with sawtooth skylight roof and copper stacks.

    Footprint: 16.0 x 10.0 m, height ~ 7.5 m, ground pivot at z=0.
    Zero third-party logos or brand signage.
    """
    bm = bmesh.new()

    # Concrete plinth
    _add_box(bm, (16.4, 10.4, 0.40), (0.0, 0.0, 0.20), "concreteShadow", top_swatch="concrete")

    # Main brick walls (left, right, back, and front facade flanking a 4.4 m loading bay)
    _add_box(bm, (0.60, 9.80, 4.40), (-7.70, 0.0, 2.60), "brick", top_swatch="brickDark")
    _add_box(bm, (0.60, 9.80, 4.40), (7.70, 0.0, 2.60), "brick", top_swatch="brickDark")
    _add_box(bm, (15.80, 0.60, 4.40), (0.0, 4.70, 2.60), "brick", top_swatch="brickDark")

    # Front wall segments around central loading bay (x in [-2.2, 2.2], z in [0.4, 3.4])
    _add_box(bm, (5.50, 0.60, 4.40), (-5.05, -4.70, 2.60), "brick", top_swatch="brickDark")
    _add_box(bm, (5.50, 0.60, 4.40), (5.05, -4.70, 2.60), "brick", top_swatch="brickDark")
    _add_box(bm, (4.60, 0.65, 1.40), (0.0, -4.70, 4.10), "steelDark")

    # Safety-yellow loading bay frame & hazard bumper
    _add_box(bm, (0.28, 0.72, 3.00), (-2.30, -4.70, 1.90), "safetyYellow")
    _add_box(bm, (0.28, 0.72, 3.00), (2.30, -4.70, 1.90), "safetyYellow")
    _add_box(bm, (4.88, 0.78, 0.24), (0.0, -4.70, 3.45), "safetyYellow")
    _add_box(bm, (4.80, 1.40, 0.22), (0.0, -5.50, 0.11), "steelDark", top_swatch="conveyor")

    # Steel pilasters & cornice band
    for px in (-7.7, -3.8, 3.8, 7.7):
        _add_box(bm, (0.76, 0.76, 4.50), (px, -4.75, 2.65), "steelDark")
    _add_box(bm, (16.30, 10.30, 0.34), (0.0, 0.0, 4.95), "steel", top_swatch="steelDark")

    # Sawtooth industrial skylight roof (3 bays along Y)
    bay_ys = (-3.1, 0.0, 3.1)
    for by in bay_ys:
        # Sloped steel roof deck
        _add_box(
            bm,
            (15.60, 2.85, 0.26),
            (0.0, by + 0.15, 5.75),
            "steel",
            rotation_euler=(math.radians(24.0), 0.0, 0.0),
            top_swatch="steelDark",
        )
        # Vertical skylight window strip facing -Y
        _add_box(bm, (14.80, 0.18, 1.15), (0.0, by - 1.10, 5.65), "paperWarm")
        # Steel mullions
        for mx in (-5.0, 0.0, 5.0):
            _add_box(bm, (0.22, 0.28, 1.25), (mx, by - 1.10, 5.65), "ink")

    # Twin copper & steel smokestacks / venting pipes at rear corner
    for idx, (sx, sy, h) in enumerate(((-5.8, 3.2, 4.2), (-4.3, 3.4, 3.4))):
        _add_prism(bm, 0.42, h, 8, (sx, sy, 5.10 + h * 0.5), "copper")
        _add_prism(bm, 0.52, 0.22, 8, (sx, sy, 5.10 + h + 0.10), "ink")
        _add_prism(bm, 0.48, 0.20, 8, (sx, sy, 5.10 + h * 0.55), "safetyYellow")

    # Side industrial windows (pure geometric frames, no text/logos)
    for wy in (-2.0, 0.0, 2.0):
        _add_box(bm, (0.70, 1.35, 1.45), (-7.72, wy, 2.85), "paperWarm")
        _add_box(bm, (0.76, 1.45, 0.14), (-7.72, wy, 2.10), "steelDark")
        _add_box(bm, (0.70, 1.35, 1.45), (7.72, wy, 2.85), "paperWarm")
        _add_box(bm, (0.76, 1.45, 0.14), (7.72, wy, 2.10), "steelDark")

    return _finalize_bm(
        bm,
        name=name,
        location=location,
        rotation_euler=rotation_euler,
        collection=collection,
    )


# ------------------------------------------------------------------ 2. Conveyor Frame & Kinematic Belt


def make_conveyor_frame(
    name: str = "IndustriaConveyorFrame",
    length: float = 8.0,
    width: float = 1.9,
    height: float = 0.62,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_euler: tuple[float, float, float] | None = None,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Static industrial conveyor trestle & guide rails."""
    bm = bmesh.new()
    half_l = length * 0.5
    half_w = width * 0.5

    # Side rails
    _add_box(bm, (length, 0.14, 0.22), (0.0, -half_w + 0.07, height), "safetyYellow")
    _add_box(bm, (length, 0.14, 0.22), (0.0, half_w - 0.07, height), "safetyYellow")
    # Under-bed steel beam
    _add_box(bm, (length - 0.2, width - 0.28, 0.14), (0.0, 0.0, height - 0.12), "steelDark")

    # Support legs along length
    num_legs = max(2, int(round(length / 3.0)) + 1)
    for i in range(num_legs):
        t = -half_l + 0.4 + (length - 0.8) * (i / max(1, num_legs - 1))
        for ly in (-half_w + 0.16, half_w - 0.16):
            _add_box(bm, (0.18, 0.18, height - 0.1), (t, ly, (height - 0.1) * 0.5), "steel")
        _add_box(bm, (0.14, width - 0.25, 0.10), (t, 0.0, 0.18), "steelDark")

    return _finalize_bm(
        bm,
        name=name,
        location=location,
        rotation_euler=rotation_euler,
        collection=collection,
    )


def make_conveyor_belt_platform(
    name: str = "IndustriaConveyorBelt",
    size: tuple[float, float, float] = (2.8, 1.6, 0.24),
    start_blender: tuple[float, float, float] = (0.0, 0.0, 0.65),
    end_blender: tuple[float, float, float] = (4.0, 0.0, 0.65),
    speed: float = 2.0,
    pause: float = 0.4,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a kinematic conveyor belt platform (`*PhysicalKinematicPositionBased`).

    Exports `start` / `end` in engine glTF space (+Y up, -Z forward) plus `speed` and `pause`
    in custom properties so `MovingPlatform.js` drives it deterministically on `fixedTick`.
    """
    sx, sy, sz = (float(v) for v in size)
    bm = bmesh.new()

    # Main rubberized conveyor belt slab
    _add_box(bm, (sx, sy, sz * 0.72), (0.0, 0.0, 0.0), "conveyor")
    # Safety yellow edge trim
    _add_box(bm, (sx * 0.98, 0.10, sz * 0.85), (0.0, -sy * 0.5 + 0.05, 0.01), "safetyYellow")
    _add_box(bm, (sx * 0.98, 0.10, sz * 0.85), (0.0, sy * 0.5 - 0.05, 0.01), "safetyYellow")

    # Raised grip slats across the belt top
    slat_count = max(3, int(sx / 0.55))
    for i in range(slat_count):
        lx = -sx * 0.42 + (sx * 0.84) * (i / max(1, slat_count - 1))
        _add_box(bm, (0.09, sy * 0.78, 0.05), (lx, 0.0, sz * 0.36 + 0.025), "steelDark")

    phys_name = f"{name}PhysicalKinematicPositionBased"
    obj = _finalize_bm(
        bm,
        name=phys_name,
        location=start_blender,
        collection=collection,
    )

    start_eng = vn_scene.to_engine_vec(start_blender)
    end_eng = vn_scene.to_engine_vec(end_blender)
    vn_scene.set_custom_props(
        obj,
        {
            "category": "conveyor",
            "speed": float(speed),
            "pause": float(pause),
            "startX": float(start_eng[0]),
            "startY": float(start_eng[1]),
            "startZ": float(start_eng[2]),
            "endX": float(end_eng[0]),
            "endY": float(end_eng[1]),
            "endZ": float(end_eng[2]),
        },
    )

    vn_collide.add_cuboid(
        name=f"cuboid{name}",
        size=(sx, sy, sz),
        location=(0.0, 0.0, 0.0),
        parent=obj,
        collection=collection,
    )
    return obj


# ------------------------------------------------------------------ 3. Generic Physics Bottle


def make_generic_bottle(
    name: str = "IndustriaBottle",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    style: str = "glass",
    mass: float = 0.35,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a generic stylized faceted bottle (`*PhysicalDynamic`, mass=0.35).

    Zero brand logos, zero contour-bottle trade dress: simple 6-sided straight prism body,
    short conical shoulder, cylindrical neck, and steel cap. Ground pivot at z=0.
    """
    body_swatch = {
        "glass": "dataMint",
        "amber": "copper",
        "paper": "paperWarm",
    }.get(style, "dataMint")

    bm = bmesh.new()
    # Hexagonal lower body (z=0..0.38)
    _add_prism(bm, 0.13, 0.38, 6, (0.0, 0.0, 0.19), body_swatch)
    # Neutral paper band (unlabeled)
    _add_prism(bm, 0.136, 0.12, 6, (0.0, 0.0, 0.21), "paper")
    # Tapered shoulder (z=0.38..0.50)
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=6,
        radius1=0.13,
        radius2=0.055,
        depth=0.12,
    )
    vset = set(ret["verts"])
    for v in ret["verts"]:
        v.co.z += 0.44
    _assign_uv(bm, [f for f in bm.faces if all(v in vset for v in f.verts)], body_swatch)
    # Neck & cap (z=0.50..0.66)
    _add_prism(bm, 0.055, 0.12, 6, (0.0, 0.0, 0.56), body_swatch)
    _add_prism(bm, 0.062, 0.05, 6, (0.0, 0.0, 0.64), "steel")

    phys_name = f"{name}PhysicalDynamic"
    obj = _finalize_bm(
        bm,
        name=phys_name,
        location=location,
        collection=collection,
    )
    vn_scene.set_custom_props(
        obj,
        {
            "mass": float(mass),
            "friction": 0.4,
            "restitution": 0.25,
            "category": "bottle",
        },
    )
    vn_collide.add_cylinder(
        name=f"tube{name}",
        radius=0.135,
        height=0.66,
        location=(0.0, 0.0, 0.33),
        parent=obj,
        collection=collection,
    )
    return obj


# ------------------------------------------------------------------ 4. Trainee Catwalk Tower


def make_catwalk_tower(
    name: str = "IndustriaTraineeTower",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> tuple[bpy.types.Object, list[tuple[tuple[float, float, float], tuple[float, float, float]]]]:
    """Create the stepped 'Torre de Trainee' industrial catwalk & observation deck.

    Returns `(tower_obj, collider_boxes)` where `collider_boxes` is a list of
    `(size_blender, center_local_blender)` for `cuboid*` colliders.
    Rises smoothly from z=0 to z=3.0 via 10 walkable steps (0.30 m rise each)
    along -X -> +X, onto a 5.0 x 4.4 m upper deck at z=3.0.
    """
    bm = bmesh.new()
    colliders: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = []

    # Upper observation deck (5.0 x 4.4 m, top at z=3.00)
    _add_box(bm, (5.0, 4.4, 0.32), (0.0, 0.0, 2.84), "steelDark", top_swatch="steel")
    colliders.append(((5.0, 4.4, 0.32), (0.0, 0.0, 2.84)))

    # 4 corner support columns
    for sx in (-2.25, 2.25):
        for sy in (-1.95, 1.95):
            _add_box(bm, (0.34, 0.34, 2.80), (sx, sy, 1.40), "steelDark")
            colliders.append(((0.34, 0.34, 2.80), (sx, sy, 1.40)))

    # Cross-bracing & copper riser pipe
    _add_box(bm, (4.5, 0.16, 0.18), (0.0, 1.95, 1.40), "steel")
    _add_prism(bm, 0.16, 2.90, 8, (2.45, 1.60, 1.45), "copper")

    # Safety-yellow handrails around upper deck (leaving stair entry open on -X side)
    # Back (+Y), Right (+X), Front (-Y)
    _add_box(bm, (5.0, 0.12, 0.95), (0.0, 2.14, 3.47), "safetyYellow")
    _add_box(bm, (0.12, 4.4, 0.95), (2.44, 0.0, 3.47), "safetyYellow")
    _add_box(bm, (5.0, 0.12, 0.95), (0.0, -2.14, 3.47), "safetyYellow")
    colliders.append(((5.0, 0.14, 0.95), (0.0, 2.14, 3.47)))
    colliders.append(((0.14, 4.4, 0.95), (2.44, 0.0, 3.47)))
    colliders.append(((5.0, 0.14, 0.95), (0.0, -2.14, 3.47)))

    # Walkable stepped catwalk stairs on -X side (10 steps, rise=0.30 m, run=0.62 m)
    steps = 10
    step_rise = 0.30
    step_run = 0.62
    stair_w = 2.40
    for i in range(steps):
        sz_top = (i + 1) * step_rise
        cx = -2.50 - (steps - 1 - i) * step_run - step_run * 0.5
        _add_box(bm, (step_run + 0.04, stair_w, 0.24), (cx, 0.0, sz_top - 0.12), "steel")
        colliders.append(((step_run + 0.04, stair_w, 0.24), (cx, 0.0, sz_top - 0.12)))
        # Support post every 3 steps
        if i % 3 == 0:
            _add_box(bm, (0.20, stair_w - 0.2, sz_top - 0.2), (cx, 0.0, (sz_top - 0.2) * 0.5), "steelDark")

    # Stair handrails
    stair_len = steps * step_run
    stair_mid_x = -2.50 - stair_len * 0.5
    slope_angle = math.atan2(3.0, stair_len)
    for hy in (-stair_w * 0.5 + 0.06, stair_w * 0.5 - 0.06):
        _add_box(
            bm,
            (stair_len + 0.4, 0.10, 0.12),
            (stair_mid_x, hy, 1.50 + 0.85),
            "safetyYellow",
            rotation_euler=(0.0, -slope_angle, 0.0),
        )

    obj = _finalize_bm(bm, name=name, location=location, collection=collection)
    return obj, colliders


# ------------------------------------------------------------------ 5. Airship Pier Deck


def make_pier_deck(
    name: str = "IndustriaAirshipPier",
    size: tuple[float, float, float] = (5.4, 12.0, 0.36),
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a canal-side industrial timber & steel pier deck."""
    sx, sy, sz = (float(v) for v in size)
    bm = bmesh.new()

    # Main deck
    _add_box(bm, (sx, sy, sz), (0.0, 0.0, 0.0), "woodDark", top_swatch="wood")
    # Safety yellow edge curbs
    _add_box(bm, (0.18, sy, 0.14), (-sx * 0.5 + 0.09, 0.0, sz * 0.5 + 0.07), "safetyYellow")
    _add_box(bm, (0.18, sy, 0.14), (sx * 0.5 - 0.09, 0.0, sz * 0.5 + 0.07), "safetyYellow")

    # Pilings into canal water
    for py in (-sy * 0.42, 0.0, sy * 0.42):
        for px in (-sx * 0.42, sx * 0.42):
            _add_prism(bm, 0.22, 1.80, 8, (px, py, -0.90), "steelDark")

    # Copper mooring bollards at pier tip
    for px in (-sx * 0.35, sx * 0.35):
        _add_prism(bm, 0.16, 0.48, 8, (px, sy * 0.45, sz * 0.5 + 0.24), "copper")
        _add_prism(bm, 0.22, 0.10, 8, (px, sy * 0.45, sz * 0.5 + 0.48), "ink")

    return _finalize_bm(bm, name=name, location=location, collection=collection)


# ------------------------------------------------------------------ 6. Gear Wheel


def make_gear_wheel(
    name: str = "IndustriaGear",
    radius: float = 0.85,
    thickness: float = 0.22,
    teeth: int = 12,
    swatch: str = "copper",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_euler: tuple[float, float, float] | None = None,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a stylized industrial gear wheel."""
    bm = bmesh.new()
    _add_prism(bm, radius * 0.82, thickness, max(12, teeth), (0.0, 0.0, 0.0), swatch)
    _add_prism(bm, radius * 0.28, thickness * 1.25, 8, (0.0, 0.0, 0.0), "ink")

    tooth_w = (2.0 * math.pi * radius / max(6, teeth)) * 0.44
    tooth_d = radius * 0.22
    for i in range(teeth):
        ang = (2.0 * math.pi * i) / teeth
        tx = math.cos(ang) * (radius * 0.86)
        ty = math.sin(ang) * (radius * 0.86)
        _add_box(
            bm,
            (tooth_d, tooth_w, thickness * 0.92),
            (tx, ty, 0.0),
            swatch,
            rotation_euler=(0.0, 0.0, ang),
        )

    return _finalize_bm(
        bm,
        name=name,
        location=location,
        rotation_euler=rotation_euler,
        collection=collection,
    )
