"""Procedural reusable kit pieces for Era 2 'UNICAMP' (2012-2016).

Provides:
  - Campus trees & manicured shrubs (`make_campus_tree`, `make_campus_shrub`)
  - Titanium nanotube hexagonal pillars (`make_nanotube_pillar`, `make_nanotube_key_physical`)
  - Campus street lamps & concrete benches (`make_campus_lamp`, `make_campus_bench`)
  - Dynamic physics campus props (`make_book_stack_physical`, `make_lab_crate_physical`)
"""

from __future__ import annotations

import math
from typing import Iterable

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from lib import vn_collide, vn_palette, vn_scene, vn_shapes


def _assign_uv(bm: bmesh.types.BMesh, faces: Iterable[bmesh.types.BMFace], swatch: str) -> None:
    uv_layer = bm.loops.layers.uv.verify()
    u, v = vn_palette.get_swatch_uv(swatch, gltf=False)
    for face in faces:
        for loop in face.loops:
            loop[uv_layer].uv = (u, v)


def _add_box(
    bm: bmesh.types.BMesh,
    size: tuple[float, float, float],
    center: tuple[float, float, float],
    swatch: str,
    rotation_euler: tuple[float, float, float] | None = None,
    top_swatch: str | None = None,
) -> list[bmesh.types.BMFace]:
    ret = bmesh.ops.create_cube(bm, size=1.0)
    verts = list(ret["verts"])
    vset = set(verts)
    mat = Matrix.Diagonal((float(size[0]), float(size[1]), float(size[2]), 1.0))
    if rotation_euler is not None:
        mat = Euler(tuple(float(a) for a in rotation_euler), "XYZ").to_matrix().to_4x4() @ mat
    bmesh.ops.transform(bm, matrix=mat, verts=verts)
    bmesh.ops.translate(bm, vec=Vector(tuple(float(c) for c in center)), verts=verts)
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    for f in faces:
        f.normal_update()
        if top_swatch and f.normal.z > 0.55:
            _assign_uv(bm, [f], top_swatch)
        else:
            _assign_uv(bm, [f], swatch)
    return faces


def _add_prism(
    bm: bmesh.types.BMesh,
    radius_bottom: float,
    radius_top: float,
    height: float,
    segments: int,
    center: tuple[float, float, float],
    swatch: str,
    top_swatch: str | None = None,
) -> list[bmesh.types.BMFace]:
    segs = max(5, int(segments))
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segs,
        radius1=float(radius_bottom),
        radius2=float(radius_top),
        depth=float(height),
    )
    verts = list(ret["verts"])
    vset = set(verts)
    bmesh.ops.translate(bm, vec=Vector(tuple(float(c) for c in center)), verts=verts)
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    for f in faces:
        f.normal_update()
        if top_swatch and f.normal.z > 0.55:
            _assign_uv(bm, [f], top_swatch)
        else:
            _assign_uv(bm, [f], swatch)
    return faces


def _finalize_bm(
    bm: bmesh.types.BMesh,
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(float(c) for c in location)
    vn_palette.ensure_palette_material()
    mat = bpy.data.materials.get("palette")
    if mat is not None:
        obj.data.materials.append(mat)
    if collection is not None:
        vn_scene.link_object(obj, collection)
    return obj


def make_campus_tree(
    name: str = "UnicampCampusTree",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    height: float = 3.6,
    crown_swatch: str = "campusGrass",
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a stylized manicured UNICAMP campus tree with concrete planter ring."""
    bm = bmesh.new()
    h = float(height)
    # Concrete planter collar at base
    _add_prism(bm, 0.55, 0.52, 0.24, 8, (0.0, 0.0, 0.12), "concrete", top_swatch="concreteShadow")
    # Trunk
    trunk_h = h * 0.48
    _add_prism(bm, 0.16, 0.11, trunk_h, 7, (0.0, 0.0, 0.20 + trunk_h * 0.5), "bark")
    # Layered leafy canopy (3 stepped rounded clusters)
    _add_prism(bm, 0.95, 0.80, h * 0.28, 9, (0.0, 0.0, trunk_h + h * 0.24), crown_swatch)
    _add_prism(bm, 0.78, 0.52, h * 0.24, 9, (0.12, -0.08, trunk_h + h * 0.42), "campusGrassDeep")
    _add_prism(bm, 0.55, 0.18, h * 0.20, 8, (-0.06, 0.06, trunk_h + h * 0.56), crown_swatch)
    return _finalize_bm(bm, name, location, collection)


def make_campus_shrub(
    name: str = "UnicampCampusShrub",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    scale: float = 1.0,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a low trimmed campus hedge/shrub cluster."""
    bm = bmesh.new()
    s = float(scale)
    _add_prism(bm, 0.52 * s, 0.42 * s, 0.48 * s, 8, (0.0, 0.0, 0.24 * s), "campusGrass")
    _add_prism(bm, 0.36 * s, 0.26 * s, 0.38 * s, 7, (0.28 * s, 0.10 * s, 0.19 * s), "campusGrassDeep")
    return _finalize_bm(bm, name, location, collection)


def make_nanotube_pillar(
    name: str = "UnicampNanotubePillar",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    height: float = 1.6,
    radius: float = 0.62,
    accent_swatch: str = "signal",
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a hexagonal titanium nanotube pillar with ink collar & signal cap ring."""
    bm = bmesh.new()
    h = max(0.5, float(height))
    r = max(0.35, float(radius))
    # Heavy ink base collar
    _add_prism(bm, r * 1.12, r * 1.06, 0.16, 6, (0.0, 0.0, 0.08), "ink")
    # Main hexagonal titanium shaft
    shaft_h = max(0.25, h - 0.28)
    _add_prism(bm, r, r * 0.96, shaft_h, 6, (0.0, 0.0, 0.16 + shaft_h * 0.5), "titanium")
    # Accent ring near top
    _add_prism(bm, r * 1.01, r * 1.01, 0.07, 6, (0.0, 0.0, h - 0.10), accent_swatch)
    # Walkable titanium/paper cap
    _add_prism(bm, r * 0.96, r * 0.92, 0.07, 6, (0.0, 0.0, h - 0.035), "titanium", top_swatch="paper")
    return _finalize_bm(bm, name, location, collection)


def make_nanotube_key_physical(
    name: str,
    location: tuple[float, float, float],
    height: float = 1.4,
    radius: float = 0.64,
    phase: float = 0.0,
    amplitude: float = 0.38,
    speed: float = 1.8,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a kinematic oscillating hexagonal nanotube piano key (`PhysicalKinematic`)."""
    vis = make_nanotube_pillar(
        name=f"{name}Visual",
        location=(0.0, 0.0, 0.0),
        height=height,
        radius=radius,
        accent_swatch="signal",
        collection=collection,
    )
    col = vn_collide.add_cylinder(
        f"cylinder{name}",
        radius=radius,
        height=height,
        location=(0.0, 0.0, height * 0.5),
        collection=collection,
    )
    phys_root = vn_collide.wrap_physical_object(
        name=f"{name}PhysicalKinematic",
        visual_obj=vis,
        colliders=col,
        mass=0.0,
        body_type="kinematicPositionBased",
        extra_props={
            "nanotubeKey": True,
            "oscillateAmplitude": float(amplitude),
            "oscillateSpeed": float(speed),
            "oscillatePhase": float(phase),
            "baseHeight": float(height),
        },
        location=location,
        collection=collection,
    )
    return phys_root


def make_campus_lamp(
    name: str = "UnicampLamp",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create an ink-and-paper modern campus walkway lamp post."""
    bm = bmesh.new()
    _add_prism(bm, 0.22, 0.16, 0.22, 6, (0.0, 0.0, 0.11), "concreteShadow")
    _add_prism(bm, 0.07, 0.05, 2.75, 6, (0.0, 0.0, 1.55), "ink")
    _add_box(bm, (0.55, 0.14, 0.08), (0.20, 0.0, 2.92), "ink")
    _add_box(bm, (0.32, 0.18, 0.09), (0.34, 0.0, 2.86), "windowGlow")
    return _finalize_bm(bm, name, location, collection)


def make_campus_bench(
    name: str = "UnicampBench",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_z: float = 0.0,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a concrete-and-wood campus courtyard bench."""
    bm = bmesh.new()
    _add_box(bm, (0.22, 0.48, 0.38), (-0.65, 0.0, 0.19), "concreteShadow")
    _add_box(bm, (0.22, 0.48, 0.38), (0.65, 0.0, 0.19), "concreteShadow")
    _add_box(bm, (1.68, 0.54, 0.10), (0.0, 0.0, 0.43), "wood", top_swatch="woodDark")
    _add_box(bm, (1.68, 0.08, 0.34), (0.0, -0.23, 0.65), "wood")
    obj = _finalize_bm(bm, name, location, collection)
    obj.rotation_euler = (0.0, 0.0, float(rotation_z))
    return obj


def make_book_crate_physical(
    name: str,
    location: tuple[float, float, float],
    size: tuple[float, float, float] = (0.58, 0.46, 0.36),
    cover_swatch: str = "brick",
    mass: float = 1.4,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a dynamic physics textbook/crate prop (`PhysicalDynamic`) for campus playgrounds."""
    sx, sy, sz = (float(v) for v in size)
    bm = bmesh.new()
    # Paper page block
    _add_box(bm, (sx * 0.94, sy * 0.92, sz * 0.80), (0.0, 0.0, sz * 0.5), "paperWarm")
    # Colored book covers (top & bottom) + spine
    _add_box(bm, (sx, sy, sz * 0.12), (0.0, 0.0, sz * 0.06), cover_swatch)
    _add_box(bm, (sx, sy, sz * 0.12), (0.0, 0.0, sz * 0.94), cover_swatch)
    _add_box(bm, (sx * 0.12, sy, sz), (-sx * 0.45, 0.0, sz * 0.5), cover_swatch)
    _add_box(bm, (sx * 0.45, sy * 0.35, 0.02), (0.05, 0.0, sz + 0.01), "paper")
    vis = _finalize_bm(bm, f"{name}Visual", (0.0, 0.0, 0.0), collection)
    col = vn_collide.add_cuboid(
        f"cuboid{name}",
        size=(sx, sy, sz),
        location=(0.0, 0.0, sz * 0.5),
        collection=collection,
    )
    phys = vn_collide.wrap_physical_object(
        name=f"{name}PhysicalDynamic",
        visual_obj=vis,
        colliders=col,
        mass=mass,
        friction=0.65,
        restitution=0.15,
        extra_props={"campusBook": True, "interactable": True},
        location=location,
        collection=collection,
    )
    return phys
