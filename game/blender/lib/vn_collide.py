"""Collider and physical-object builders matching the engine's glTF conventions.

Engine parsing rules (`game/sources/Game/Objects.js` -> `getFromModel`, `World.js`):
  - Physical root node name contains `Physical` plus optional body type suffix:
      `...PhysicalFixed` (default), `...PhysicalDynamic`, `...PhysicalKinematicPositionBased`.
  - Root custom properties (`extras` -> Three.js `userData`):
      `mass` (dynamic bodies), `friction`, `restitution`, `category`, plus arbitrary props.
  - Collider children of a physical root (removed from visual hierarchy on load):
      `cuboid*`   -> Empty, glTF scale = full dimensions `(x, y, z)` -> Rapier half-extents `scale * 0.5`.
      `tube*`     -> Empty, glTF scale = `(diameter, height, diameter)` -> Rapier `cylinder(scale.y * 0.5, scale.x * 0.5)`.
      `ball*`     -> Empty, glTF scale = `(diameter, diameter, diameter)` -> Rapier `ball(scale.y * 0.5)`.
      `trimesh*`  -> Mesh with scale applied (1, 1, 1) -> Rapier `trimesh(positions, indices)`.
      `hull*`     -> Mesh with scale applied (1, 1, 1) -> Rapier `convexHull(positions)`.

Coordinate convention:
  - Functions default to Blender space (+Z up, +Y forward), matching `vn_scene.py`.
  - Pass `engine_coords=True` to supply locations, sizes, and rotations in engine glTF space
    (+Y up, -Z forward); conversions to Blender space are applied automatically.
"""

from __future__ import annotations

import math
from typing import Iterable

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

try:
    from . import vn_scene
except ImportError:  # pragma: no cover - direct sys.path usage
    import vn_scene


COLLIDER_PREFIXES = ("cuboid", "trimesh", "hull", "tube", "cylinder", "ball")

_BODY_TYPE_SUFFIX = {
    "fixed": "PhysicalFixed",
    "dynamic": "PhysicalDynamic",
    "kinematic": "PhysicalKinematicPositionBased",
    "kinematicpositionbased": "PhysicalKinematicPositionBased",
}


# ---------------------------------------------------------------------- helpers


def _ensure_prefix(name: str, prefix: str) -> str:
    """Prefix `name` with `prefix` in camelCase unless already prefixed."""
    if name.lower().startswith(prefix.lower()):
        return name
    if not name:
        return prefix
    return f"{prefix}{name[0].upper()}{name[1:]}"


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
        # Engine local axes (X, Y_up, Z) correspond to Blender local axes (X, Z_up, Y).
        return (sx, sz, sy)
    return (sx, sy, sz)


def _apply_rotation(
    obj: bpy.types.Object,
    rotation: Iterable[float] | Quaternion | Euler | None,
    engine_coords: bool,
) -> None:
    """Apply an Euler (radians) or Quaternion rotation in Blender or engine space."""
    if rotation is None:
        return

    if isinstance(rotation, Quaternion):
        q = rotation.copy()
        if engine_coords:
            # Proper coordinate rotation B(x, y, z) = (x, -z, y) maps rotation axis identically.
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


def _finalize_object(
    obj: bpy.types.Object,
    parent: bpy.types.Object | None,
    props: dict | None,
    collection: bpy.types.Collection | str | None,
) -> bpy.types.Object:
    vn_scene.set_custom_props(obj, props)
    vn_scene.link_object(obj, collection)
    if parent is not None:
        obj.parent = parent
    return obj


def _duplicate_collider_mesh(
    name: str,
    mesh_or_obj: bpy.types.Mesh | bpy.types.Object,
    *,
    compute_hull: bool = False,
    strip_materials: bool = False,
) -> tuple[bpy.types.Mesh, tuple[float, float, float], Quaternion | Euler | None]:
    """Copy mesh geometry with scale baked into vertices (required by `Objects.js`)."""
    loc = (0.0, 0.0, 0.0)
    rot: Quaternion | Euler | None = None

    if isinstance(mesh_or_obj, bpy.types.Object):
        if mesh_or_obj.type != "MESH" or mesh_or_obj.data is None:
            raise TypeError(f"Expected a MESH object for collider {name!r}, got {mesh_or_obj.type}")
        src_mesh = mesh_or_obj.data
        mesh_copy = src_mesh.copy()
        sx, sy, sz = mesh_or_obj.scale
        if abs(sx - 1.0) > 1e-6 or abs(sy - 1.0) > 1e-6 or abs(sz - 1.0) > 1e-6:
            mesh_copy.transform(Matrix.Diagonal((sx, sy, sz, 1.0)))
            if sx * sy * sz < 0.0:
                bm = bmesh.new()
                bm.from_mesh(mesh_copy)
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
                bm.to_mesh(mesh_copy)
                bm.free()
        loc = tuple(float(v) for v in mesh_or_obj.location)
        if mesh_or_obj.rotation_mode == "QUATERNION":
            rot = mesh_or_obj.rotation_quaternion.copy()
        else:
            rot = mesh_or_obj.rotation_euler.copy()
    elif isinstance(mesh_or_obj, bpy.types.Mesh):
        mesh_copy = mesh_or_obj.copy()
    else:
        raise TypeError(
            f"Expected bpy.types.Mesh or bpy.types.Object for collider {name!r}, "
            f"got {type(mesh_or_obj).__name__}"
        )

    mesh_copy.name = name

    if compute_hull:
        bm = bmesh.new()
        bm.from_mesh(mesh_copy)
        if len(bm.verts) >= 4:
            result = bmesh.ops.convex_hull(bm, input=list(bm.verts))
            hull_geom = set(result.get("geom", []))
            for face in list(bm.faces):
                if face not in hull_geom:
                    bm.faces.remove(face)
            for edge in list(bm.edges):
                if edge not in hull_geom and not edge.link_faces:
                    bm.edges.remove(edge)
            for vert in list(bm.verts):
                if vert not in hull_geom and not vert.link_edges:
                    bm.verts.remove(vert)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(mesh_copy)
        bm.free()

    if strip_materials:
        mesh_copy.materials.clear()

    mesh_copy.update()
    return mesh_copy, loc, rot


def _iter_objects(
    item: bpy.types.Object | Iterable[bpy.types.Object] | None,
) -> list[bpy.types.Object]:
    if item is None:
        return []
    if isinstance(item, bpy.types.Object):
        return [item]
    return [obj for obj in item if obj is not None]


# ------------------------------------------------------------ collider builders


def add_cuboid(
    name: str,
    size: Iterable[float],
    location: Iterable[float] = (0.0, 0.0, 0.0),
    rotation: Iterable[float] | Quaternion | Euler = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
    props: dict | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a `cuboid*` collider Empty whose scale equals the full box size."""
    col_name = _ensure_prefix(name, "cuboid")
    obj = bpy.data.objects.new(col_name, None)
    obj.empty_display_type = "CUBE"
    obj.empty_display_size = 0.5
    obj.location = _convert_location(location, engine_coords)
    obj.scale = _convert_scale(size, engine_coords)
    _apply_rotation(obj, rotation, engine_coords)
    return _finalize_object(obj, parent, props, collection)


def add_trimesh(
    name: str,
    mesh_or_obj: bpy.types.Mesh | bpy.types.Object,
    parent: bpy.types.Object | None = None,
    props: dict | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    strip_materials: bool = False,
) -> bpy.types.Object:
    """Create a `trimesh*` collider Mesh with scale baked into vertex coordinates."""
    col_name = _ensure_prefix(name, "trimesh")
    mesh_copy, loc, rot = _duplicate_collider_mesh(
        col_name, mesh_or_obj, compute_hull=False, strip_materials=strip_materials
    )
    obj = bpy.data.objects.new(col_name, mesh_copy)
    obj.location = loc
    _apply_rotation(obj, rot, engine_coords=False)
    obj.scale = (1.0, 1.0, 1.0)
    return _finalize_object(obj, parent, props, collection)


def add_hull(
    name: str,
    mesh_or_obj: bpy.types.Mesh | bpy.types.Object,
    parent: bpy.types.Object | None = None,
    props: dict | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    compute_hull: bool = False,
    strip_materials: bool = False,
) -> bpy.types.Object:
    """Create a `hull*` convex-hull collider Mesh with scale baked into vertices.

    Set `compute_hull=True` to replace concave input geometry with its Blender convex hull.
    """
    col_name = _ensure_prefix(name, "hull")
    mesh_copy, loc, rot = _duplicate_collider_mesh(
        col_name, mesh_or_obj, compute_hull=compute_hull, strip_materials=strip_materials
    )
    obj = bpy.data.objects.new(col_name, mesh_copy)
    obj.location = loc
    _apply_rotation(obj, rot, engine_coords=False)
    obj.scale = (1.0, 1.0, 1.0)
    return _finalize_object(obj, parent, props, collection)


def add_cylinder(
    name: str,
    radius: float,
    height: float,
    location: Iterable[float] = (0.0, 0.0, 0.0),
    rotation: Iterable[float] | Quaternion | Euler = (0.0, 0.0, 0.0),
    segments: int = 16,
    parent: bpy.types.Object | None = None,
    props: dict | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    prefix: str = "tube",
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create an analytical cylinder collider Empty for Rapier (`Objects.js` `^tube`).

    `Objects.js` parses `^tube` children as Rapier `cylinder(scale.y * 0.5, scale.x * 0.5)`.
    In Blender (+Z up), scale `(2 * radius, 2 * radius, height)` exports under `export_yup=True`
    as glTF scale `(2 * radius, height, 2 * radius)`.

    `segments` is retained for signature compatibility (the engine uses an analytical cylinder
    collider rather than a polygonal mesh). Pass `prefix="cylinder"` to override the default
    `tube` prefix when needed.
    """
    _ = segments  # Analytical collider in Rapier; kept for API compatibility.
    if name.lower().startswith(("tube", "cylinder")):
        col_name = name
    else:
        col_name = _ensure_prefix(name, prefix)

    diameter = 2.0 * float(radius)
    length = float(height)

    obj = bpy.data.objects.new(col_name, None)
    obj.empty_display_type = "CUBE"
    obj.empty_display_size = 0.5
    obj.location = _convert_location(location, engine_coords)
    # In Blender +Z is the vertical axis, which exports to +Y (cylinder axis) in glTF.
    obj.scale = (diameter, diameter, length)
    _apply_rotation(obj, rotation, engine_coords)
    return _finalize_object(obj, parent, props, collection)


add_tube = add_cylinder


def add_ball(
    name: str,
    radius: float,
    location: Iterable[float] = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
    props: dict | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a `ball*` spherical collider Empty (`Objects.js` radius = `scale.y * 0.5`)."""
    col_name = _ensure_prefix(name, "ball")
    diameter = 2.0 * float(radius)

    obj = bpy.data.objects.new(col_name, None)
    obj.empty_display_type = "SPHERE"
    obj.empty_display_size = 0.5
    obj.location = _convert_location(location, engine_coords)
    obj.scale = (diameter, diameter, diameter)
    return _finalize_object(obj, parent, props, collection)


# ------------------------------------------------------- physical object wrapper


def _resolve_physical_name(name: str, mass: float | None, body_type: str | None) -> str:
    if "physical" in name.lower():
        return name
    if body_type is not None:
        key = body_type.strip().lower()
        if key not in _BODY_TYPE_SUFFIX:
            raise ValueError(
                f"Unknown body_type {body_type!r}; expected one of {sorted(_BODY_TYPE_SUFFIX)}"
            )
        suffix = _BODY_TYPE_SUFFIX[key]
    elif mass is not None and float(mass) > 0.0:
        suffix = _BODY_TYPE_SUFFIX["dynamic"]
    else:
        suffix = _BODY_TYPE_SUFFIX["fixed"]
    return f"{name}{suffix}"


def wrap_physical_object(
    name: str,
    visual_obj: bpy.types.Object | Iterable[bpy.types.Object] | None,
    colliders: bpy.types.Object | Iterable[bpy.types.Object] | None,
    mass: float | None = 0.0,
    friction: float | None = 0.5,
    restitution: float | None = None,
    category: str | None = None,
    extra_props: dict | None = None,
    collection: bpy.types.Collection | str | None = None,
    *,
    body_type: str | None = None,
    location: Iterable[float] = (0.0, 0.0, 0.0),
    rotation: Iterable[float] | Quaternion | Euler = (0.0, 0.0, 0.0),
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a physical container Empty with visual and collider children plus custom props.

    Root naming follows `Objects.js`:
      - If `name` already contains `Physical` (case-insensitive), it is preserved verbatim.
      - Otherwise appends `PhysicalDynamic` (when `mass > 0` or `body_type='dynamic'`),
        `PhysicalKinematicPositionBased` (`body_type='kinematicPositionBased'`), or
        `PhysicalFixed` (default).

    Custom properties written to glTF `extras` (-> Three.js `userData`):
      - `mass` (written when `mass > 0`)
      - `friction` (written when not `None`)
      - `restitution` (written when not `None`; omit to keep engine default 0.15)
      - `category` (written when not `None`, e.g. `'floor'`, `'object'`, `'bumper'`)
      - any keys in `extra_props` (e.g. `speed`, `pause` for kinematic platforms)
    """
    root_name = _resolve_physical_name(name, mass, body_type)
    root = bpy.data.objects.new(root_name, None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.4
    root.location = _convert_location(location, engine_coords)
    _apply_rotation(root, rotation, engine_coords)

    props: dict = {}
    if mass is not None and float(mass) > 0.0:
        props["mass"] = float(mass)
    if friction is not None:
        props["friction"] = float(friction)
    if restitution is not None:
        props["restitution"] = float(restitution)
    if category is not None:
        props["category"] = str(category)
    if extra_props:
        props.update(extra_props)

    vn_scene.set_custom_props(root, props)
    vn_scene.link_object(root, collection)

    visuals = _iter_objects(visual_obj)
    cols = _iter_objects(colliders)

    for vis in visuals:
        if vis.name.lower().startswith(COLLIDER_PREFIXES):
            raise ValueError(
                f"Visual child {vis.name!r} starts with a collider prefix and would be "
                "stripped by Objects.js"
            )
        if collection is not None:
            vn_scene.link_object(vis, collection)
        vis.parent = root

    for col in cols:
        if collection is not None:
            vn_scene.link_object(col, collection)
        col.parent = root

    return root
