"""Signature landmarks for Era 2 'UNICAMP' (2012-2016).

Landmarks:
  1. Portão do Campus (`build_campus_gate`) — brick & concrete entrance arch
  2. Rua das ONGs (`build_ong_house`) — paper-and-brick houses with glowing web-page windows
  3. Floresta de Nanotubos de Titânio (`build_nanotube_forest`) — static + oscillating piano-key pillars
  4. Sala da Empresa Júnior MTE (`build_mte_meeting_room`) — open-air room with climbable giant table & chairs
  5. Laboratório Secreto no Subsolo (`build_secret_lab`) — recessed basement lab + Stamp-opened hatch
"""

from __future__ import annotations

import math
from typing import Any

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from kits import unicamp_kit
from lib import vn_collide, vn_palette, vn_refs, vn_scene


def _assign_uv(bm: bmesh.types.BMesh, faces, swatch: str) -> None:
    uv_layer = bm.loops.layers.uv.verify()
    u, v = vn_palette.get_swatch_uv(swatch, gltf=False)
    for f in faces:
        for loop in f.loops:
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
    rb: float,
    rt: float,
    h: float,
    segs: int,
    center: tuple[float, float, float],
    swatch: str,
) -> list[bmesh.types.BMFace]:
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=max(5, int(segs)),
        radius1=float(rb),
        radius2=float(rt),
        depth=float(h),
    )
    verts = list(ret["verts"])
    vset = set(verts)
    bmesh.ops.translate(bm, vec=Vector(tuple(float(c) for c in center)), verts=verts)
    faces = [f for f in bm.faces if all(v in vset for v in f.verts)]
    _assign_uv(bm, faces, swatch)
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


# ------------------------------------------------------------------ 1. Portão do Campus


def build_campus_gate(
    location: tuple[float, float, float] = (0.0, 4.2, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> dict[str, Any]:
    """Build the brick & concrete UNICAMP campus entrance gate with fixed pillar colliders."""
    bm = bmesh.new()
    # Left & right brick gatehouse piers
    for side in (-1.0, 1.0):
        px = side * 2.95
        _add_box(bm, (1.25, 1.25, 0.35), (px, 0.0, 0.175), "concreteShadow")
        _add_box(bm, (1.05, 1.05, 2.75), (px, 0.0, 1.725), "brick", top_swatch="concrete")
        _add_box(bm, (1.18, 1.18, 0.22), (px, 0.0, 3.20), "concrete")
        # Low flanking campus brick walls
        _add_box(bm, (2.20, 0.48, 0.95), (px + side * 1.65, 0.0, 0.475), "brickDark", top_swatch="concrete")

    # Overhead concrete & paper lintel beam
    _add_box(bm, (7.40, 0.96, 0.62), (0.0, 0.0, 3.62), "concrete", top_swatch="concreteShadow")
    _add_box(bm, (5.20, 1.04, 0.42), (0.0, 0.0, 3.62), "paper")
    # Ink banner bar + red signal crest dot on front & back
    _add_box(bm, (3.80, 1.08, 0.12), (0.0, 0.0, 3.62), "ink")
    _add_prism(bm, 0.26, 0.26, 1.12, 12, (0.0, 0.0, 3.62), "signal")

    vis = _finalize_bm(bm, "UnicampCampusGate", location, collection)

    # Fixed colliders for the 2 gate piers & flanking walls
    lx, ly, lz = location
    phys_root = bpy.data.objects.new("UnicampCampusGatePhysicalFixed", None)
    phys_root.location = (lx, ly, lz)
    vn_scene.link_object(phys_root, collection)
    vn_collide.add_cuboid("cuboidGatePierL", (1.25, 1.25, 3.30), (-2.95, 0.0, 1.65), parent=phys_root, collection=collection)
    vn_collide.add_cuboid("cuboidGatePierR", (1.25, 1.25, 3.30), (2.95, 0.0, 1.65), parent=phys_root, collection=collection)
    vn_collide.add_cuboid("cuboidGateWallL", (2.20, 0.50, 0.95), (-4.60, 0.0, 0.475), parent=phys_root, collection=collection)
    vn_collide.add_cuboid("cuboidGateWallR", (2.20, 0.50, 0.95), (4.60, 0.0, 0.475), parent=phys_root, collection=collection)
    vn_collide.add_cuboid("cuboidGateBeam", (7.40, 0.96, 0.62), (0.0, 0.0, 3.62), parent=phys_root, collection=collection)

    return {"visual": vis, "physical": phys_root}


# ------------------------------------------------------------------ 2. Rua das ONGs


def build_ong_house(
    name: str,
    location: tuple[float, float, float],
    rotation_z: float = 0.0,
    wall_swatch: str = "paper",
    roof_swatch: str = "brick",
    width: float = 2.8,
    depth: float = 2.6,
    height: float = 2.2,
    collection: bpy.types.Collection | str | None = None,
) -> dict[str, Any]:
    """Build a cute paper-and-brick ONG house with glowing web-page windows."""
    bm = bmesh.new()
    w, d, h = float(width), float(depth), float(height)

    # Concrete plinth
    _add_box(bm, (w + 0.28, d + 0.28, 0.20), (0.0, 0.0, 0.10), "concreteShadow")
    # Main paper/brick walls
    _add_box(bm, (w, d, h), (0.0, 0.0, 0.20 + h * 0.5), wall_swatch)
    # Brick lower wainscot band
    _add_box(bm, (w + 0.04, d + 0.04, 0.45), (0.0, 0.0, 0.425), "brickDark")
    # Pitched roof (two angled slabs + ridge cap)
    pitch = 0.46
    slab_w = (w * 0.55) / math.cos(pitch) + 0.25
    _add_box(
        bm,
        (slab_w, d + 0.36, 0.14),
        (-w * 0.26, 0.0, 0.20 + h + 0.28),
        roof_swatch,
        rotation_euler=(0.0, -pitch, 0.0),
    )
    _add_box(
        bm,
        (slab_w, d + 0.36, 0.14),
        (w * 0.26, 0.0, 0.20 + h + 0.28),
        roof_swatch,
        rotation_euler=(0.0, pitch, 0.0),
    )
    _add_box(bm, (0.24, d + 0.40, 0.14), (0.0, 0.0, 0.20 + h + 0.56), "ink")

    # Front door facing -X (towards the street at X=9.5)
    _add_box(bm, (0.08, 0.72, 1.25), (-w * 0.5 - 0.02, -0.45, 0.825), "woodDark")

    # Glowing web-page windows on front (-X) and side (-Y/+Y) faces:
    # Browser header bar in `ink`, glowing viewport in `windowGlow`, and red `signal` tab dot!
    win_centers = (
        (-w * 0.5 - 0.02, 0.58, 1.38, (0.06, 0.86, 0.72), (-w * 0.5 - 0.04, 0.58, 1.68, (0.07, 0.88, 0.14))),
        (0.0, -d * 0.5 - 0.02, 1.38, (0.92, 0.06, 0.72), (0.0, -d * 0.5 - 0.04, 1.68, (0.94, 0.07, 0.14))),
    )
    for wx, wy, wz, wsize, (bx, by, bz, bsize) in win_centers:
        _add_box(bm, wsize, (wx, wy, wz), "windowGlow")
        _add_box(bm, bsize, (bx, by, bz), "ink")
        # Tiny signal browser button dot
        _add_box(bm, (0.09, 0.09, 0.09), (bx, by, bz), "signal")

    vis = _finalize_bm(bm, name, location, collection)
    vis.rotation_euler = (0.0, 0.0, float(rotation_z))

    phys_root = bpy.data.objects.new(f"{name}PhysicalFixed", None)
    phys_root.location = tuple(float(c) for c in location)
    phys_root.rotation_euler = (0.0, 0.0, float(rotation_z))
    vn_scene.link_object(phys_root, collection)
    vn_collide.add_cuboid(
        f"cuboid{name}",
        size=(w + 0.28, d + 0.28, h + 0.70),
        location=(0.0, 0.0, (h + 0.70) * 0.5),
        parent=phys_root,
        collection=collection,
    )
    return {"visual": vis, "physical": phys_root}


# ------------------------------------------------------------------ 3. Floresta de Nanotubos


def build_nanotube_forest(
    collection: bpy.types.Collection | str | None = None,
) -> dict[str, Any]:
    """Build the climbable hexagonal titanium nanotube forest (static + kinematic piano keys)."""
    static_pillars: list[bpy.types.Object] = []
    kinematic_keys: list[bpy.types.Object] = []

    # Static hexagonal titanium pillars forming outer grove & stepped landings
    static_specs = (
        ("UnicampNanotubeStatic01", (-2.2, 22.0, 0.4), 1.15, 0.62, "titanium"),
        ("UnicampNanotubeStatic02", (0.2, 22.8, 0.4), 1.45, 0.66, "signal"),
        ("UnicampNanotubeStatic03", (6.8, 22.6, 0.4), 1.55, 0.64, "titanium"),
        ("UnicampNanotubeStatic04", (8.8, 24.4, 0.4), 2.10, 0.70, "signal"),
        ("UnicampNanotubeStatic05", (-1.4, 27.6, 0.4), 2.25, 0.68, "titanium"),
        ("UnicampNanotubeStatic06", (8.2, 28.4, 0.4), 2.40, 0.70, "signal"),
        ("UnicampNanotubeStatic07", (2.6, 30.2, 0.4), 2.15, 0.66, "titanium"),
        ("UnicampNanotubeStatic08", (6.4, 30.8, 0.4), 2.55, 0.72, "signal"),
    )
    for pname, ploc, ph, pr, pacc in static_specs:
        p = unicamp_kit.make_nanotube_pillar(
            name=pname,
            location=ploc,
            height=ph,
            radius=pr,
            accent_swatch=pacc,
            collection=collection,
        )
        static_pillars.append(p)
        phys_p = bpy.data.objects.new(f"{pname}PhysicalFixed", None)
        phys_p.location = ploc
        vn_scene.link_object(phys_p, collection)
        vn_collide.add_cylinder(
            f"cylinder{pname}",
            radius=pr,
            height=ph,
            location=(0.0, 0.0, ph * 0.5),
            parent=phys_p,
            collection=collection,
        )

    # 6 kinematic oscillating nanotube piano keys arranged as a climbable bridge/staircase
    key_specs = (
        ("UnicampNanotubeKey01", (1.8, 23.6, 0.4), 1.25, 0.64, 0.00, 0.34, 1.7),
        ("UnicampNanotubeKey02", (3.3, 24.4, 0.4), 1.45, 0.64, 1.05, 0.36, 1.7),
        ("UnicampNanotubeKey03", (4.8, 25.2, 0.4), 1.65, 0.64, 2.10, 0.38, 1.7),
        ("UnicampNanotubeKey04", (2.2, 26.2, 0.4), 1.85, 0.64, 3.15, 0.36, 1.7),
        ("UnicampNanotubeKey05", (3.9, 27.2, 0.4), 2.00, 0.64, 4.20, 0.34, 1.7),
        ("UnicampNanotubeKey06", (5.5, 27.4, 0.4), 2.10, 0.64, 5.25, 0.30, 1.7),
    )
    for kname, kloc, kh, kr, kphase, kamp, kspd in key_specs:
        k_obj = unicamp_kit.make_nanotube_key_physical(
            name=kname,
            location=kloc,
            height=kh,
            radius=kr,
            phase=kphase,
            amplitude=kamp,
            speed=kspd,
            collection=collection,
        )
        kinematic_keys.append(k_obj)

    return {"static": static_pillars, "kinematic": kinematic_keys}


# ------------------------------------------------------------------ 4. Sala da Empresa Júnior MTE


def build_mte_meeting_room(
    location: tuple[float, float, float] = (-12.0, 20.5, 0.8),
    collection: bpy.types.Collection | str | None = None,
) -> dict[str, Any]:
    """Build open-air Empresa Júnior MTE room with climbable giant conference table & chairs."""
    bm = bmesh.new()
    # Tiled concrete floor pad
    _add_box(bm, (8.6, 8.2, 0.16), (0.0, 0.0, 0.08), "concrete", top_swatch="paperWarm")
    # Low open-air brick & paper perimeter walls (north & west)
    _add_box(bm, (8.6, 0.42, 1.35), (0.0, 3.9, 0.75), "brick", top_swatch="concrete")
    _add_box(bm, (0.42, 8.2, 1.35), (-4.1, 0.0, 0.75), "brick", top_swatch="concrete")
    # Kanban whiteboard on north wall
    _add_box(bm, (3.2, 0.16, 1.55), (0.0, 3.60, 1.35), "paper")
    _add_box(bm, (3.35, 0.12, 0.10), (0.0, 3.60, 2.15), "ink")
    _add_box(bm, (0.55, 0.20, 0.35), (-0.85, 3.58, 1.45), "signal")
    _add_box(bm, (0.55, 0.20, 0.35), (0.0, 3.58, 1.55), "windowGlow")
    _add_box(bm, (0.55, 0.20, 0.35), (0.85, 3.58, 1.30), "dataTeal")

    # Giant conference table (climbable platform top at local Z = 1.20 -> world Z = 2.00)
    _add_box(bm, (4.20, 2.20, 0.18), (0.0, 0.0, 1.11), "wood", top_swatch="paper")
    # Table legs
    for lx in (-1.65, 1.65):
        for ly in (-0.75, 0.75):
            _add_box(bm, (0.24, 0.24, 1.02), (lx, ly, 0.51), "ink")

    # 4 climbable giant chairs around the table (seat top at local Z = 0.58 -> world Z = 1.38)
    chair_offsets = (
        (-1.1, -1.55, 0.0),
        (1.1, -1.55, 0.0),
        (-1.1, 1.55, math.pi),
        (2.55, 0.0, math.pi * 0.5),
    )
    for cx, cy, crot in chair_offsets:
        _add_box(bm, (0.92, 0.92, 0.58), (cx, cy, 0.29), "titanium", rotation_euler=(0.0, 0.0, crot), top_swatch="brick")
        bx = cx - math.sin(crot) * 0.40
        by = cy - math.cos(crot) * 0.40
        _add_box(bm, (0.92, 0.16, 0.65), (bx, by, 0.88), "brick", rotation_euler=(0.0, 0.0, crot))

    vis = _finalize_bm(bm, "UnicampMteMeetingRoom", location, collection)

    # Fixed colliders for floor, walls, table, and chairs so player can jump onto chairs -> table
    phys_root = bpy.data.objects.new("UnicampMteRoomPhysicalFixed", None)
    phys_root.location = tuple(float(c) for c in location)
    vn_scene.link_object(phys_root, collection)
    vn_collide.add_cuboid("cuboidMteTableTop", (4.20, 2.20, 0.22), (0.0, 0.0, 1.09), parent=phys_root, collection=collection)
    vn_collide.add_cuboid("cuboidMteWallN", (8.60, 0.45, 1.40), (0.0, 3.9, 0.75), parent=phys_root, collection=collection)
    vn_collide.add_cuboid("cuboidMteWallW", (0.45, 8.20, 1.40), (-4.1, 0.0, 0.75), parent=phys_root, collection=collection)
    for idx, (cx, cy, _) in enumerate(chair_offsets, start=1):
        vn_collide.add_cuboid(f"cuboidMteChair{idx}", (0.94, 0.94, 0.60), (cx, cy, 0.30), parent=phys_root, collection=collection)

    return {"visual": vis, "physical": phys_root}


# ------------------------------------------------------------------ 5. Segredo: Laboratório no Subsolo


def build_secret_lab(
    location: tuple[float, float, float] = (-13.5, 34.0, 0.4),
    collection: bpy.types.Collection | str | None = None,
) -> dict[str, Any]:
    """Build the recessed basement secret lab alcove with Stamp-opened hatch (`UnicampSecretLabHatch`)."""
    # Static recessed surround & glowing lab console
    bm = bmesh.new()
    _add_box(bm, (4.4, 4.4, 0.24), (0.0, 0.0, -0.12), "concreteShadow")
    # Recessed concrete rim walls
    _add_box(bm, (4.4, 0.45, 0.75), (0.0, 2.0, 0.375), "concrete")
    _add_box(bm, (0.45, 4.4, 0.75), (-2.0, 0.0, 0.375), "concrete")
    _add_box(bm, (0.45, 4.4, 0.75), (2.0, 0.0, 0.375), "concrete")
    # Glowing lab console inside the secret alcove
    _add_box(bm, (1.5, 0.65, 0.85), (0.0, 1.35, 0.425), "titanium")
    _add_box(bm, (1.1, 0.12, 0.55), (0.0, 1.05, 0.95), "dataTeal")
    _add_box(bm, (0.85, 0.14, 0.36), (0.0, 1.03, 0.96), "windowGlow")
    surround = _finalize_bm(bm, "UnicampSecretLabAlcove", location, collection)

    # Stamp-openable hatch (`UnicampSecretLabHatch`) exported in unicampObjects.glb
    hbm = bmesh.new()
    _add_box(hbm, (2.2, 2.2, 0.14), (0.0, 0.0, 0.07), "titanium", top_swatch="ink")
    _add_prism(hbm, 0.36, 0.32, 0.10, 8, (0.0, 0.0, 0.16), "signal")
    hatch = _finalize_bm(hbm, "UnicampSecretLabHatch", (location[0], location[1] - 0.5, location[2] + 0.02), collection)
    vn_scene.set_custom_props(
        hatch,
        {
            "secretHatch": True,
            "openByStamp": True,
            "era": "unicamp",
            "beat": "U5_secret_lab",
        },
    )

    ref_secret = vn_refs.add_ref(
        "refSecretLab",
        location=(location[0], location[1], location[2] + 0.35),
        props={"era": "unicamp", "secret": True, "openByStamp": True},
        collection=collection,
    )

    return {"surround": surround, "hatch": hatch, "ref": ref_secret}
