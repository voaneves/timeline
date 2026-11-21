"""Reference Empty (`ref*`) builders matching the engine and PLAN-3D §5.3 conventions.

Engine parsing rules (`game/sources/Game/World/World.js`, `View.js`):
  - Root Empties whose name starts with `ref` (case-insensitive) are collected into
    `world.references` with `{ position, quaternion, userData }`.
  - Standard typed prefixes (PLAN-3D §5.3):
      `refRespawn*`      spawn/respawn point (yaw read from quaternion around +Y)
      `refCamera*`       authored camera anchor (`yaw`/`pitch`/`distance`/`radius` or `lookAt`)
      `refMilestone*`    biographical milestone marker (`entryId`)
      `refSignal*`       collectible signal anchor
      `refLinePoint<n>`  spline control point along the Line (`index`)
      `refNav*`          navigation graph node (`links`)
      `refZoneBounding*` zone bounding sphere (`scale.x == radius`, `userData.radius`)

Coordinate convention:
  - Functions default to Blender space (+Z up, +Y forward), matching `vn_scene.py`.
  - Pass `engine_coords=True` to supply positions/rotations/scales in engine glTF space
    (+Y up, -Z forward).
"""

from __future__ import annotations

import math
from typing import Iterable

import bpy
from mathutils import Euler, Quaternion

try:
    from . import vn_scene
except ImportError:  # pragma: no cover - direct sys.path usage
    import vn_scene


# ---------------------------------------------------------------------- helpers


def _ensure_ref_prefix(name: str, kind: str = "") -> str:
    """Build a canonical `ref<Kind><Name>` identifier without duplicate prefixes."""
    raw = str(name)
    if not kind:
        if raw.lower().startswith("ref"):
            return raw
        if not raw:
            return "ref"
        return f"ref{raw[0].upper()}{raw[1:]}"

    full_prefix = f"ref{kind}"
    if raw.lower().startswith(full_prefix.lower()):
        return raw
    if raw.lower().startswith(kind.lower()):
        return f"ref{raw[0].upper()}{raw[1:]}"
    if not raw:
        return full_prefix
    return f"{full_prefix}{raw[0].upper()}{raw[1:]}"


def _convert_location(
    location: Iterable[float], engine_coords: bool
) -> tuple[float, float, float]:
    if engine_coords:
        return vn_scene.to_blender_vec(location)
    x, y, z = location
    return (float(x), float(y), float(z))


def _convert_scale(
    scale: Iterable[float], engine_coords: bool
) -> tuple[float, float, float]:
    sx, sy, sz = (float(v) for v in scale)
    if engine_coords:
        return (sx, sz, sy)
    return (sx, sy, sz)


def _apply_rotation(
    obj: bpy.types.Object,
    rotation: Iterable[float] | Quaternion | Euler | None,
    engine_coords: bool,
) -> None:
    if rotation is None:
        return

    if isinstance(rotation, Quaternion):
        q = rotation.copy()
        if engine_coords:
            q = Quaternion((q.w, q.x, -q.z, q.y))
        if abs(q.angle) > 1e-7:
            obj.rotation_mode = "QUATERNION"
            obj.rotation_quaternion = q
        return

    rx, ry, rz = (float(v) for v in rotation)
    if abs(rx) <= 1e-7 and abs(ry) <= 1e-7 and abs(rz) <= 1e-7:
        return

    if engine_coords:
        q_e = Euler((rx, ry, rz), "XYZ").to_quaternion()
        q_b = Quaternion((q_e.w, q_e.x, -q_e.z, q_e.y))
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = q_b
    else:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = (rx, ry, rz)


# --------------------------------------------------------------- generic helper


def add_ref(
    name: str,
    location: Iterable[float] = (0.0, 0.0, 0.0),
    rotation: Iterable[float] | Quaternion | Euler = (0.0, 0.0, 0.0),
    scale: Iterable[float] = (1.0, 1.0, 1.0),
    props: dict | None = None,
    parent: bpy.types.Object | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    display: str = "PLAIN_AXES",
    display_size: float = 0.5,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a generic `ref*` Empty with optional transform and custom properties."""
    ref_name = _ensure_ref_prefix(name)
    obj = bpy.data.objects.new(ref_name, None)
    obj.empty_display_type = display
    obj.empty_display_size = float(display_size)
    obj.location = _convert_location(location, engine_coords)
    obj.scale = _convert_scale(scale, engine_coords)
    _apply_rotation(obj, rotation, engine_coords)
    vn_scene.set_custom_props(obj, props)
    vn_scene.link_object(obj, collection)
    if parent is not None:
        obj.parent = parent
    return obj


# ---------------------------------------------------------------- typed helpers


def add_respawn(
    name: str = "",
    location: Iterable[float] = (0.0, 0.0, 0.0),
    yaw_deg: float = 0.0,
    props: dict | None = None,
    parent: bpy.types.Object | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a `refRespawn*` Empty oriented to `yaw_deg` around engine +Y (Blender +Z)."""
    ref_name = _ensure_ref_prefix(name, "Respawn")
    yaw_rad = math.radians(float(yaw_deg))
    # Yaw around engine +Y equals yaw around Blender +Z.
    rot = (0.0, yaw_rad, 0.0) if engine_coords else (0.0, 0.0, yaw_rad)
    return add_ref(
        ref_name,
        location=location,
        rotation=rot,
        props=props,
        parent=parent,
        collection=collection,
        display="ARROWS",
        display_size=0.6,
        engine_coords=engine_coords,
    )


def add_camera(
    name: str,
    location: Iterable[float],
    yaw_deg: float | None = None,
    pitch_deg: float | None = 28.0,
    distance: float | None = 10.5,
    radius: float | None = None,
    look_at: Iterable[float] | None = None,
    props: dict | None = None,
    parent: bpy.types.Object | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a `refCamera*` Empty with authored framing parameters and/or `lookAt` target."""
    ref_name = _ensure_ref_prefix(name, "Camera")
    cam_props: dict = {}

    if yaw_deg is not None:
        cam_props["yaw"] = float(yaw_deg)
    if pitch_deg is not None:
        cam_props["pitch"] = float(pitch_deg)
    if distance is not None:
        cam_props["distance"] = float(distance)
    if radius is not None:
        cam_props["radius"] = float(radius)
    if look_at is not None:
        cam_props["lookAt"] = [float(v) for v in look_at]
    if props:
        cam_props.update(props)

    yaw_rad = math.radians(float(yaw_deg)) if yaw_deg is not None else 0.0
    rot = (0.0, yaw_rad, 0.0) if engine_coords else (0.0, 0.0, yaw_rad)

    return add_ref(
        ref_name,
        location=location,
        rotation=rot,
        props=cam_props or None,
        parent=parent,
        collection=collection,
        display="PLAIN_AXES",
        display_size=0.6,
        engine_coords=engine_coords,
    )


def add_milestone(
    name: str,
    location: Iterable[float],
    entry_id: str,
    props: dict | None = None,
    parent: bpy.types.Object | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a `refMilestone*` Empty bound to a `content.json` `entryId`."""
    ref_name = _ensure_ref_prefix(name, "Milestone")
    merged = {"entryId": str(entry_id)}
    if props:
        merged.update(props)
    return add_ref(
        ref_name,
        location=location,
        props=merged,
        parent=parent,
        collection=collection,
        display="SINGLE_ARROW",
        display_size=0.6,
        engine_coords=engine_coords,
    )


def add_signal(
    name: str | int,
    location: Iterable[float],
    props: dict | None = None,
    parent: bpy.types.Object | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a `refSignal*` Empty for a collectible signal pickup."""
    ref_name = _ensure_ref_prefix(str(name), "Signal")
    return add_ref(
        ref_name,
        location=location,
        props=props,
        parent=parent,
        collection=collection,
        display="SPHERE",
        display_size=0.35,
        engine_coords=engine_coords,
    )


def add_line_point(
    index: int,
    location: Iterable[float],
    props: dict | None = None,
    parent: bpy.types.Object | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a `refLinePoint<index>` Empty marking a control point along the Line."""
    idx = int(index)
    merged = {"index": idx}
    if props:
        merged.update(props)
    return add_ref(
        f"refLinePoint{idx}",
        location=location,
        props=merged,
        parent=parent,
        collection=collection,
        display="PLAIN_AXES",
        display_size=0.5,
        engine_coords=engine_coords,
    )


def add_nav_node(
    name: str | int,
    location: Iterable[float],
    links: Iterable[str] | None = None,
    props: dict | None = None,
    parent: bpy.types.Object | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a `refNav*` Empty for accessible click-to-walk / auto-walk navigation."""
    ref_name = _ensure_ref_prefix(str(name), "Nav")
    merged: dict = {}
    if links is not None:
        merged["links"] = [str(link) for link in links]
    if props:
        merged.update(props)
    return add_ref(
        ref_name,
        location=location,
        props=merged or None,
        parent=parent,
        collection=collection,
        display="CIRCLE",
        display_size=0.4,
        engine_coords=engine_coords,
    )


def add_zone_bounding(
    name: str,
    location: Iterable[float],
    radius: float,
    props: dict | None = None,
    parent: bpy.types.Object | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a `refZoneBounding*` Empty with `scale.x == radius` (PLAN-3D §5.3)."""
    ref_name = _ensure_ref_prefix(str(name), "ZoneBounding")
    r = float(radius)
    merged = {"radius": r}
    if props:
        merged.update(props)
    return add_ref(
        ref_name,
        location=location,
        scale=(r, r, r),
        props=merged,
        parent=parent,
        collection=collection,
        display="SPHERE",
        display_size=1.0,
        engine_coords=engine_coords,
    )
