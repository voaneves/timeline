"""Central Hub, 6 m Ponto Final Sphere, Arrival Copper Pipes & Backstage Credits Room (Phase 3 - T3.H1/T3.H3a).

Builds the centerpiece of the 5-era ring:
  - ~12 m tall layered paper-cut mountain (`HubHillVisual`) with walkable spiral ramp
  - 6 m diameter glowing red Ponto Final sphere (`HubEndDotSphere`) on summit plinth
  - 5 arrival copper pipes with red collars from all 5 eras
  - Recessed Sala de Bastidores (Backstage Credits Room) with 3D diorama pipeline map
    and MIT attribution / engine credits plinths

All coordinates are Blender space (+Z up, +Y forward). Analytical `cuboid*` colliders
are attached under `<Name>PhysicalFixed` parents via `vn_collide`.
"""

from __future__ import annotations

import math
from typing import Iterable

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from lib import vn_bevel, vn_collide, vn_palette, vn_scene


# ------------------------------------------------------------------ BMesh helpers


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
    swatch: str,
    rot_euler: tuple[float, float, float] | None = None,
) -> list[bmesh.types.BMFace]:
    sx, sy, sz = size
    mat = Matrix.Translation(Vector(center))
    if rot_euler is not None:
        mat = mat @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
    mat = mat @ Matrix.Diagonal((sx, sy, sz, 1.0))
    ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
    vset = set(ret["verts"])
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    _assign_uv(bm, faces, swatch)
    return faces


def _add_prism(
    bm: bmesh.types.BMesh,
    radius: float,
    height: float,
    center: tuple[float, float, float],
    segments: int,
    swatch: str,
    rot_euler: tuple[float, float, float] | None = None,
    taper_top: float = 1.0,
) -> list[bmesh.types.BMFace]:
    mat = Matrix.Translation(Vector(center))
    if rot_euler is not None:
        mat = mat @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=max(3, int(segments)),
        radius1=float(radius),
        radius2=float(radius) * float(taper_top),
        depth=float(height),
        matrix=mat,
    )
    vset = set(ret["verts"])
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    _assign_uv(bm, faces, swatch)
    return faces


def _finalize_bmesh(
    name: str,
    bm: bmesh.types.BMesh,
    collection: bpy.types.Collection,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rot_z_deg: float = 0.0,
    parent: bpy.types.Object | None = None,
    bevel_width: float = 0.0,
) -> bpy.types.Object:
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    if abs(rot_z_deg) > 1e-5:
        obj.rotation_euler = (0.0, 0.0, math.radians(rot_z_deg))
    pal_mat = vn_palette.ensure_palette_material()
    mesh.materials.clear()
    mesh.materials.append(pal_mat)
    vn_scene.link_object(obj, collection)
    if parent is not None:
        obj.parent = parent
    if bevel_width > 0.0:
        vn_bevel.apply_bevel(obj, width=bevel_width, segments=2)
    return obj


# ------------------------------------------------------------------ Central Hill & Spiral Ramp


SPIRAL_STEPS = 24
SPIRAL_START_ANGLE = -math.pi * 0.65  # South-west base entry
SPIRAL_TOTAL_ANGLE = math.pi * 2.65   # ~1.32 turns up to summit
SPIRAL_START_RADIUS = 16.8
SPIRAL_END_RADIUS = 5.4
HILL_SUMMIT_Z = 11.8


def spiral_ramp_point(t: float) -> tuple[float, float, float, float]:
    """Return `(x, y, z, angle_rad)` along the Hub spiral ramp for `t in [0, 1]`."""
    ang = SPIRAL_START_ANGLE + t * SPIRAL_TOTAL_ANGLE
    rad = SPIRAL_START_RADIUS + t * (SPIRAL_END_RADIUS - SPIRAL_START_RADIUS)
    z = t * HILL_SUMMIT_Z
    return (rad * math.cos(ang), rad * math.sin(ang), z, ang)


def _make_physical_root(
    name: str,
    body_type: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    return vn_collide.wrap_physical_object(
        name,
        None,
        None,
        mass=0.0 if body_type == "fixed" else 8.0,
        body_type=body_type,
        location=location,
        collection=collection,
        engine_coords=False,
    )


def build_central_hill_and_ramp(
    collection: bpy.types.Collection,
) -> dict[str, object]:
    """Build the ~12 m layered paper-cut mountain and walkable spiral ramp + colliders."""
    phys_root = _make_physical_root("HubCentralHill", "fixed", (0.0, 0.0, 0.0), collection)

    bm = bmesh.new()

    # 6 stacked paper-cut topographic tiers (each 2.0 m tall up to 11.8 m)
    tiers = [
        (14.8, 2.00, 1.00, "cerradoGreen"),
        (12.6, 2.00, 3.00, "paperWarm"),
        (10.5, 2.00, 5.00, "paper"),
        (8.4,  2.00, 7.00, "paperShadow"),
        (6.4,  2.00, 9.00, "paperWarm"),
        (4.8,  1.80, 10.90, "paper"),
    ]
    for rad, h, cz, sw in tiers:
        _add_prism(bm, rad, h, (0.0, 0.0, cz), 20, sw, taper_top=0.92)
        # Paper-cut rim trim
        _add_prism(bm, rad * 0.96, 0.14, (0.0, 0.0, cz + h * 0.5 + 0.05), 20, "ipeGold")
        # Analytical collider cylinder approximated by 2 crossed cuboids for fast Rapier
        box_w = rad * 1.42
        vn_collide.add_cuboid(
            f"HubHillTier{int(cz)}",
            (box_w, box_w, h),
            location=(0.0, 0.0, cz),
            parent=phys_root,
            collection=collection,
            engine_coords=False,
        )

    # Summit ceremonial plinth (`z = 11.8` to `12.6`)
    _add_prism(bm, 3.8, 0.55, (0.0, 0.0, 12.05), 16, "copper")
    _add_prism(bm, 3.2, 0.30, (0.0, 0.0, 12.45), 16, "ipeGold")
    vn_collide.add_cuboid(
        "HubSummitPlateau",
        (6.8, 6.8, 0.60),
        location=(0.0, 0.0, 11.65),
        parent=phys_root,
        collection=collection,
        engine_coords=False,
    )

    # Spiral ramp deck segments + colliders
    ramp_w = 2.8
    for i in range(SPIRAL_STEPS):
        t0 = i / SPIRAL_STEPS
        t1 = (i + 1) / SPIRAL_STEPS
        x0, y0, z0, _ = spiral_ramp_point(t0)
        x1, y1, z1, _ = spiral_ramp_point(t1)
        mx, my, mz = (x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5
        dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
        horiz = math.hypot(dx, dy)
        seg_len = math.hypot(horiz, dz) + 0.35
        yaw = math.atan2(dy, dx)
        pitch = -math.atan2(dz, horiz)

        # Ramp deck (`paper` top + `copperShadow` under-beam)
        _add_box(
            bm,
            (seg_len, ramp_w, 0.36),
            (mx, my, mz - 0.18),
            "paper",
            rot_euler=(0.0, pitch, yaw),
        )
        _add_box(
            bm,
            (seg_len, ramp_w * 0.82, 0.24),
            (mx, my, mz - 0.44),
            "copperShadow",
            rot_euler=(0.0, pitch, yaw),
        )
        # Outer safety curb (`ipeGold`)
        nx, ny = -dy / max(horiz, 1e-4), dx / max(horiz, 1e-4)
        _add_box(
            bm,
            (seg_len, 0.16, 0.28),
            (mx - nx * (ramp_w * 0.48), my - ny * (ramp_w * 0.48), mz + 0.14),
            "ipeGold",
            rot_euler=(0.0, pitch, yaw),
        )

        vn_collide.add_cuboid(
            f"HubSpiralRamp{i:02d}",
            (seg_len, ramp_w, 0.38),
            location=(mx, my, mz - 0.19),
            rotation=(0.0, pitch, yaw),
            parent=phys_root,
            collection=collection,
            engine_coords=False,
        )

    vis = _finalize_bmesh("HubCentralHillVisual", bm, collection, parent=phys_root, bevel_width=0.015)
    return {"root": phys_root, "visual": vis}


# ------------------------------------------------------------------ 6 m Ponto Final Sphere


def build_end_dot_sphere(collection: bpy.types.Collection) -> bpy.types.Object:
    """Build the 6.0 m diameter (radius 3.0 m) glowing red Ponto Final sphere at the summit."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(
        bm,
        u_segments=24,
        v_segments=16,
        radius=3.0,
        matrix=Matrix.Translation(Vector((0.0, 0.0, 0.0))),
    )
    _assign_uv(bm, bm.faces, "signalEmissive")
    sphere_obj = _finalize_bmesh(
        "HubEndDotSphere",
        bm,
        collection,
        location=(0.0, 0.0, 15.6),
    )
    for poly in sphere_obj.data.polygons:
        poly.use_smooth = True
    vn_scene.set_custom_props(
        sphere_obj,
        {"isEndDot": True, "diameterM": 6.0, "era": "hub"},
    )
    return sphere_obj


# ------------------------------------------------------------------ 5 Arrival Copper Pipes


def build_arrival_pipes(collection: bpy.types.Collection) -> list[dict[str, object]]:
    """Build 5 arrival copper pipes (from Origens, UNICAMP, Indústria, Dados, Transformação)."""
    eras = [
        ("Origens", -140.0),
        ("Unicamp", -105.0),
        ("Industria", -70.0),
        ("Dados", -35.0),
        ("Transformacao", 0.0),
    ]
    pipes: list[dict[str, object]] = []
    radius = 20.5
    for era_name, ang_deg in eras:
        rad = math.radians(ang_deg)
        px = radius * math.cos(rad)
        py = radius * math.sin(rad)
        name = f"HubArrivalPipe{era_name}"
        phys_root = _make_physical_root(name, "fixed", (px, py, 0.0), collection)
        bm = bmesh.new()
        _add_prism(bm, 0.90, 1.25, (0.0, 0.0, 0.625), 16, "copper")
        _add_prism(bm, 1.04, 0.30, (0.0, 0.0, 1.22), 16, "signal")
        _add_prism(bm, 0.70, 0.12, (0.0, 0.0, 1.35), 16, "ink")
        # Small pedestal ring
        _add_prism(bm, 1.35, 0.16, (0.0, 0.0, 0.08), 16, "paperShadow")
        vis = _finalize_bmesh(f"{name}Visual", bm, collection, parent=phys_root, bevel_width=0.01)
        vn_collide.add_cuboid(
            f"{name}Body",
            (1.9, 1.9, 1.4),
            location=(0.0, 0.0, 0.7),
            parent=phys_root,
            collection=collection,
            engine_coords=False,
        )
        pipes.append({"era": era_name, "pos": (px, py, 0.0), "root": phys_root, "visual": vis})
    return pipes


# ------------------------------------------------------------------ Recessed Sala de Bastidores


def build_backstage_room(
    collection: bpy.types.Collection,
    location: tuple[float, float, float] = (0.0, 16.5, 0.0),
) -> dict[str, object]:
    """Build the recessed Backstage Credits Room (`refBackstage`) with pipeline map & MIT credits."""
    phys_root = _make_physical_root("HubBackstageRoom", "fixed", location, collection)

    bm = bmesh.new()
    # Recessed gallery chamber (9.0 m wide x 7.5 m deep x 3.6 m high)
    # Floor slab (slightly recessed at z=-0.10, top at z=0.02)
    _add_box(bm, (9.4, 7.8, 0.24), (0.0, 0.0, -0.10), "charcoal")
    # Left & Right walls (`paperShadow`)
    _add_box(bm, (0.45, 7.6, 3.6), (-4.5, 0.0, 1.8), "paperShadow")
    _add_box(bm, (0.45, 7.6, 3.6), (4.5, 0.0, 1.8), "paperShadow")
    # Back wall (`paper`)
    _add_box(bm, (9.4, 0.45, 3.6), (0.0, 3.7, 1.8), "paper")
    # Roof slab (`timber` + `copper` fascia)
    _add_box(bm, (9.6, 8.0, 0.35), (0.0, 0.0, 3.72), "timber")
    _add_box(bm, (9.8, 0.30, 0.28), (0.0, -3.95, 3.72), "copper")

    # Front portal archway (-Y entrance)
    _add_box(bm, (2.2, 0.55, 3.6), (-3.5, -3.7, 1.8), "timber")
    _add_box(bm, (2.2, 0.55, 3.6), (3.5, -3.7, 1.8), "timber")
    _add_box(bm, (5.2, 0.55, 0.8), (0.0, -3.7, 3.2), "timber")
    # Warm gallery sconces (`windowGlow`)
    for sx in (-2.6, 2.6):
        _add_box(bm, (0.35, 0.25, 0.55), (sx, -3.98, 2.2), "windowGlow")
        _add_box(bm, (0.35, 0.25, 0.55), (sx, 3.40, 2.5), "windowGlow")

    # Diorama Pipeline Map relief on the back wall (5-era ring + Blender->glTF->Meshopt blocks)
    _add_box(bm, (5.2, 0.16, 2.1), (0.0, 3.42, 1.95), "ink")
    _add_box(bm, (4.9, 0.12, 1.85), (0.0, 3.38, 1.95), "paperWarm")
    # 5 era nodes in a ring on the map
    for i in range(5):
        a = -math.pi * 0.5 + (2 * math.pi * i) / 5.0
        mx = -1.2 + 0.65 * math.cos(a)
        mz = 1.95 + 0.58 * math.sin(a)
        _add_prism(bm, 0.14, 0.12, (mx, 3.30, mz), 10, "signal", rot_euler=(math.pi * 0.5, 0.0, 0.0))
    _add_prism(bm, 0.18, 0.14, (-1.2, 3.30, 1.95), 12, "ipeGold", rot_euler=(math.pi * 0.5, 0.0, 0.0))
    # Pipeline steps on right half of map (Blender -> glTF -> Meshopt)
    for idx, sw in enumerate(("copper", "ipeGold", "dataTeal")):
        _add_box(bm, (0.55, 0.12, 0.35), (0.55 + idx * 0.72, 3.30, 1.95), sw)

    # MIT Attribution & Credits Plinths (2 pedestals inside the room)
    for px, sw in ((-2.4, "copper"), (2.4, "ipeGold")):
        _add_box(bm, (1.2, 0.9, 0.95), (px, 1.4, 0.475), "paperShadow")
        _add_box(bm, (1.0, 0.7, 0.12), (px, 1.4, 1.01), sw)
        _add_box(bm, (0.85, 0.55, 0.06), (px, 1.4, 1.10), "ink")

    vis = _finalize_bmesh("HubBackstageVisual", bm, collection, parent=phys_root, bevel_width=0.012)

    # Colliders (floor + 3 walls so player can walk inside cleanly)
    vn_collide.add_cuboid(
        "HubBackstageFloor", (9.4, 7.8, 0.24), location=(0.0, 0.0, -0.10),
        parent=phys_root, collection=collection, engine_coords=False
    )
    vn_collide.add_cuboid(
        "HubBackstageWallL", (0.5, 7.6, 3.6), location=(-4.5, 0.0, 1.8),
        parent=phys_root, collection=collection, engine_coords=False
    )
    vn_collide.add_cuboid(
        "HubBackstageWallR", (0.5, 7.6, 3.6), location=(4.5, 0.0, 1.8),
        parent=phys_root, collection=collection, engine_coords=False
    )
    vn_collide.add_cuboid(
        "HubBackstageWallBack", (9.4, 0.5, 3.6), location=(0.0, 3.7, 1.8),
        parent=phys_root, collection=collection, engine_coords=False
    )
    return {"root": phys_root, "visual": vis}


def build_hub_tree(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    foliage_swatch: str = "ipeGold",
    height: float = 4.5,
) -> bpy.types.Object:
    """Build a stylized paper-cut Hub tree (`HubTree*` for foliage merge)."""
    bm = bmesh.new()
    h = float(height)
    _add_prism(bm, 0.22, h * 0.42, (0.0, 0.0, h * 0.21), 8, "bark")
    _add_prism(bm, h * 0.34, h * 0.34, (0.0, 0.0, h * 0.56), 10, foliage_swatch, taper_top=0.45)
    _add_prism(bm, h * 0.24, h * 0.28, (0.0, 0.0, h * 0.78), 10, foliage_swatch, taper_top=0.15)
    return _finalize_bmesh(name, bm, collection, location=location)
