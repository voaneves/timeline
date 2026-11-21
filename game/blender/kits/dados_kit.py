"""Procedural data-world kit for Era 4 'Dados' (2019–2021).

Builds modular, palette-calibrated architecture and props for the blue-twilight
data diorama:
  - `make_tocantins_shore_deck`: riverside paper/wood jetty & laterite bank
    rhyming visually with Era 1 Rio Tocantins.
  - `make_bar_chart_axes`: static L-shaped chart axis frame & tick marks for the
    Living Bar Chart staircase.
  - `make_live_bar`: climbable `DadosLiveBar01..06` kinematic bar-chart step
    with `cuboid*` collider and `minHeight`/`maxHeight`/`barIndex` custom props.
  - `make_data_cube`: kickable `PhysicalDynamic` data cube (`mass=0.45`) with
    `ink` corner trim and `dataMint`/`dataGold`/`paper` faces.
  - `make_twilight_pylon`: stylized twilight data-beacon / buriti-lantern post.
"""

from __future__ import annotations

import math
from typing import Iterable

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from lib import vn_collide, vn_palette, vn_scene


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
    offset = Vector(center)
    for v in verts:
        v.co += offset
    faces = [f for f in bm.faces if all(v in vert_set for v in f.verts)]
    bm.normal_update()
    _assign_uv(bm, faces, swatch_name)
    return faces


def _add_octahedron(
    bm: bmesh.types.BMesh,
    radius: float,
    center: tuple[float, float, float],
    swatch_name: str,
) -> list[bmesh.types.BMFace]:
    r = float(radius)
    cx, cy, cz = (float(v) for v in center)
    pts = [
        (cx, cy, cz + r * 1.15),
        (cx, cy, cz - r * 1.15),
        (cx + r, cy, cz),
        (cx, cy + r, cz),
        (cx - r, cy, cz),
        (cx, cy - r, cz),
    ]
    vs = [bm.verts.new(p) for p in pts]
    tris = [
        (vs[0], vs[2], vs[3]),
        (vs[0], vs[3], vs[4]),
        (vs[0], vs[4], vs[5]),
        (vs[0], vs[5], vs[2]),
        (vs[1], vs[3], vs[2]),
        (vs[1], vs[4], vs[3]),
        (vs[1], vs[5], vs[4]),
        (vs[1], vs[2], vs[5]),
    ]
    faces = [bm.faces.new(tri) for tri in tris]
    bm.normal_update()
    _assign_uv(bm, faces, swatch_name)
    return faces


def _finalize_bm(
    bm: bmesh.types.BMesh,
    name: str,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_euler: tuple[float, float, float] | None = None,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = Vector(location)
    if rotation_euler is not None:
        obj.rotation_euler = Euler(rotation_euler, "XYZ")
    obj.data.materials.append(vn_palette.ensure_palette_material())
    vn_scene.link_object(obj, collection)
    return obj


def make_tocantins_shore_deck(
    name: str = "DadosTocantinsDeck",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the Rio Tocantins shoreline jetty (wood/paper + copper/dataTeal bollards)."""
    bm = bmesh.new()

    # Main riverside deck slab (5.4 x 4.2 m)
    _add_box(bm, (5.4, 4.2, 0.30), (0.0, 0.0, 0.15), "woodDark", top_swatch="wood")
    # Plank ribs
    for px in (-2.0, -1.0, 0.0, 1.0, 2.0):
        _add_box(bm, (0.85, 4.05, 0.04), (px, 0.0, 0.32), "paperWarm")
    # Support pilings into water
    for px in (-2.3, 2.3):
        for py in (-1.7, 1.7):
            _add_prism(bm, 0.18, 1.15, 8, (px, py, -0.25), "woodDark")
    # Mooring bollards with dataGold lantern caps
    for py in (-1.6, 1.6):
        _add_prism(bm, 0.14, 0.55, 8, (-2.35, py, 0.56), "ink")
        _add_prism(bm, 0.16, 0.12, 8, (-2.35, py, 0.86), "dataGold")

    return _finalize_bm(bm, name=name, location=location, collection=collection)


def make_bar_chart_axes(
    name: str = "DadosBarChartAxes",
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create the static L-frame axes and tick marks for the Living Bar Chart."""
    bm = bmesh.new()

    # Plinth base under the 6 bars (width 11.0, length 13.5)
    _add_box(bm, (10.6, 13.4, 0.22), (0.0, 0.0, 0.11), "dataSlate", top_swatch="paperShadow")
    # Left Y-axis vertical & horizontal baseline rails
    _add_box(bm, (0.28, 13.6, 0.26), (-5.1, 0.0, 0.28), "ink")
    _add_box(bm, (0.28, 0.28, 3.85), (-5.1, 6.65, 2.05), "ink")
    # Axis tick bars in dataMint & paper
    for idx in range(6):
        ty = -5.0 + idx * 2.0
        _add_box(bm, (0.65, 0.14, 0.12), (-4.75, ty, 0.26), "dataMint")
    for hz in (1.0, 2.0, 3.0):
        _add_box(bm, (0.55, 0.16, 0.12), (-4.85, 6.65, hz + 0.20), "paper")

    return _finalize_bm(bm, name=name, location=location, collection=collection)


def make_live_bar(
    name: str,
    index: int,
    size_xy: tuple[float, float],
    full_height: float,
    location: tuple[float, float, float],
    body_swatch: str,
    cap_swatch: str,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a climbable kinematic bar for the Living Bar Chart staircase.

    Origin is at the base center `(location[0], location[1], location[2])`.
    Includes a `PhysicalKinematicPositionBased` child with `cuboid*` collider
    and `barIndex`/`minHeight`/`maxHeight` extras for runtime growth.
    """
    sx, sy = (float(size_xy[0]), float(size_xy[1]))
    h = float(full_height)

    bm = bmesh.new()
    # Main bar column (base at z=0, top at z=h)
    _add_box(bm, (sx, sy, max(0.2, h - 0.16)), (0.0, 0.0, (h - 0.16) * 0.5), body_swatch)
    # Beveled top step cap
    _add_box(bm, (sx + 0.14, sy + 0.14, 0.16), (0.0, 0.0, h - 0.08), cap_swatch)
    # Ink trim band just below cap
    _add_box(bm, (sx + 0.06, sy + 0.06, 0.06), (0.0, 0.0, h - 0.19), "ink")

    bar_obj = _finalize_bm(bm, name=name, location=location, collection=collection)
    vn_scene.set_custom_props(
        bar_obj,
        {
            "category": "liveBar",
            "barIndex": int(index),
            "minHeight": 0.28,
            "maxHeight": round(h, 3),
            "growRadius": 6.5,
        },
    )

    phys_root = bpy.data.objects.new(f"{name}PhysicalKinematicPositionBased", None)
    phys_root.parent = bar_obj
    vn_scene.link_object(phys_root, collection)
    vn_collide.add_cuboid(
        f"cuboid{name}",
        (sx + 0.12, sy + 0.12, h),
        (0.0, 0.0, h * 0.5),
        parent=phys_root,
        collection=collection,
    )
    return bar_obj


def make_data_cube(
    name: str,
    location: tuple[float, float, float],
    face_swatch: str = "dataMint",
    size: float = 0.62,
    mass: float = 0.45,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a kickable dynamic data cube (`PhysicalDynamic`)."""
    s = float(size)
    bm = bmesh.new()
    _add_box(bm, (s, s, s), (0.0, 0.0, s * 0.5), face_swatch)
    # Recessed/raised ink frame bands
    _add_box(bm, (s + 0.04, s * 0.24, s + 0.04), (0.0, 0.0, s * 0.5), "ink")
    _add_box(bm, (s * 0.24, s + 0.04, s + 0.04), (0.0, 0.0, s * 0.5), "ink")
    # Glowing dataGold core pip on top
    _add_box(bm, (s * 0.30, s * 0.30, 0.06), (0.0, 0.0, s + 0.03), "dataGold")

    obj = _finalize_bm(bm, name=name, location=location, collection=collection)
    phys_root = bpy.data.objects.new(f"{name}PhysicalDynamic", None)
    phys_root.parent = obj
    vn_scene.link_object(phys_root, collection)
    vn_scene.set_custom_props(
        phys_root,
        {
            "mass": float(mass),
            "friction": 0.45,
            "restitution": 0.25,
            "category": "dataCube",
        },
    )
    vn_collide.add_cuboid(
        f"cuboid{name}",
        (s, s, s),
        (0.0, 0.0, s * 0.5),
        parent=phys_root,
        collection=collection,
    )
    return obj


def make_twilight_pylon(
    name: str,
    location: tuple[float, float, float],
    height: float = 2.6,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a stylized twilight data-beacon / buriti-lantern post."""
    h = float(height)
    bm = bmesh.new()
    _add_prism(bm, 0.28, 0.24, 8, (0.0, 0.0, 0.12), "dataSlate")
    _add_prism(bm, 0.11, h, 8, (0.0, 0.0, 0.24 + h * 0.5), "ink")
    _add_box(bm, (0.42, 0.42, 0.42), (0.0, 0.0, 0.24 + h + 0.18), "dataGold")
    _add_box(bm, (0.52, 0.52, 0.08), (0.0, 0.0, 0.24 + h + 0.42), "copper")
    return _finalize_bm(bm, name=name, location=location, collection=collection)
