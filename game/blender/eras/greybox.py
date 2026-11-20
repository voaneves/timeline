"""Greybox test level (plan T1.1): every shape the controller (T1.2+) must be tuned against.

Run (headless, deterministic, re-runnable):
    blender.exe -b -P blender/eras/greybox.py
    blender.exe -b -P blender/eras/greybox.py -- --out static/eras/greybox/greybox.glb

Conventions (docs/PLAN-3D.md 5.3, docs/ENGINE-INVENTORY.md, Objects.getFromModel):
  - 1 unit = 1 m, +Y up in the glTF, pivot on the ground (dynamic bodies are centred: the node origin is the body origin).
  - Layout below is written in ENGINE (glTF, Y-up) coordinates; `B()` converts to Blender (Z-up) before building.
    Forward is -Z in the engine, the run goes from z=+5 to z=-75.
  - One root node per physical object, named `<name>Physical<Fixed|Dynamic|KinematicPositionBased>`.
    Its children are the visual mesh (`<name>Visual`, never starting with a collider prefix) and the colliders:
      cuboid*  -> empty, scale = full size          tube* -> empty, scale (diameter, length, diameter), axis = Y
      hull*    -> mesh with transforms applied      (trimesh*/ball* are supported by the engine, not needed here)
    Custom props become glTF extras -> three userData (mass, friction, restitution, speed, ...).
  - Empties `ref<Name><n>` are reference points (refRespawn, refCamera1/2, refPlatformPath1/2, refLinePoint1..9).
  - Grey materials only.
"""
import hashlib
import json
import math
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))  # game/
OUT = os.path.join(ROOT, "static", "eras", "greybox", "greybox.glb")
if "--" in sys.argv:
    args = sys.argv[sys.argv.index("--") + 1:]
    if "--out" in args:
        OUT = os.path.abspath(args[args.index("--out") + 1])

# ---------------------------------------------------------------- helpers


def B(x, y, z):
    """Engine (glTF, Y-up) -> Blender (Z-up). A proper rotation, so face winding is preserved."""
    return (x, -z, y)


def Bv(v):
    return B(*v)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def grey(name, hexgrey):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    v = srgb_to_linear(hexgrey / 255.0)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (v, v, v, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
    mat.diffuse_color = (v, v, v, 1.0)
    return mat


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_empty(name, pos_e, parent=None, display="PLAIN_AXES", size=0.5, props=None, quat_e=None, scale_e=None):
    """Empty placed with engine coordinates (local to `parent` when given)."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = display
    e.empty_display_size = size
    e.location = Bv(pos_e)
    if quat_e is not None:
        e.rotation_mode = "QUATERNION"
        e.rotation_quaternion = quat_e
    if scale_e is not None:
        # engine local axes (x, y, z) == Blender local axes (x, z, y)
        e.scale = (scale_e[0], scale_e[2], scale_e[1])
    for k, v in (props or {}).items():
        e[k] = v
    link(e)
    if parent is not None:
        e.parent = parent
    return e


def quat_axis_angle_e(axis_e, deg):
    """Quaternion (Blender frame) of a rotation about an ENGINE axis."""
    return Quaternion(Vector(Bv(axis_e)), math.radians(deg))


def mesh_obj(name, verts_e, faces, mat, parent=None, smooth=False):
    """Mesh from engine-space vertices (local to the parent node)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([Bv(v) for v in verts_e], [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    link(o)
    if parent is not None:
        o.parent = parent
    return o


BOX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]


def box_verts(center, size):
    cx, cy, cz = center
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    return [(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz + hz), (cx - hx, cy - hy, cz + hz),
            (cx - hx, cy + hy, cz - hz), (cx + hx, cy + hy, cz - hz), (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]


def merge(parts):
    """parts: list of (verts, faces) -> one (verts, faces)."""
    verts, faces = [], []
    for v, f in parts:
        base = len(verts)
        verts += v
        faces += [tuple(i + base for i in face) for face in f]
    return verts, faces


def boxes_mesh(name, boxes, mat, parent):
    return mesh_obj(name, *merge([(box_verts(c, s), BOX_FACES) for c, s in boxes]), mat, parent)


def cylinder_parts(radius, length, center, axis="y", segments=24):
    """Closed cylinder (engine space) along an engine axis ('y' up, 'x' lying along X)."""
    verts, faces = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        verts.append((radius * math.cos(a), -length / 2, radius * math.sin(a)))
    for i in range(segments):
        a = 2 * math.pi * i / segments
        verts.append((radius * math.cos(a), length / 2, radius * math.sin(a)))
    bottom_c, top_c = len(verts), len(verts) + 1
    verts += [(0, -length / 2, 0), (0, length / 2, 0)]
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, segments + i, segments + j, j))  # side
        faces.append((bottom_c, j, i))
        faces.append((top_c, segments + i, segments + j))
    if axis == "x":  # rotate +90 deg about engine Z: Y -> -X
        verts = [(-y, x, z) for (x, y, z) in verts]
    return [(x + center[0], y + center[1], z + center[2]) for (x, y, z) in verts], faces


def node(name, pos_e, props=None):
    return make_empty(name, pos_e, display="PLAIN_AXES", size=0.4, props=props)


def cuboid(name, parent, center, size, quat_e=None):
    return make_empty(name, center, parent=parent, display="CUBE", size=0.5, scale_e=size, quat_e=quat_e)


# ---------------------------------------------------------------- build


def build():
    reset()
    mats = {
        "ground": grey("greyGround", 104),
        "mid": grey("greyMid", 150),
        "light": grey("greyLight", 200),
        "dark": grey("greyDark", 74),
    }
    stats = {"colliders": {"cuboid": 0, "hull": 0, "tube": 0}}

    def col(kind, n=1):
        stats["colliders"][kind] += n

    # --- Run (straight, 8 m wide, 30 m long, top at y=0, z from +5 to -25), spawn at the origin
    run = node("runPhysicalFixed", (0, 0, -10), {"friction": 0.7})
    boxes_mesh("runVisual", [((0, -0.25, 0), (8, 0.5, 30))], mats["ground"], run)
    cuboid("cuboidRun", run, (0, -0.25, 0), (8, 0.5, 30)); col("cuboid")

    # --- Steps: 6 x 0.3 m risers, 0.6 m treads, 2.4 m wide, rising toward -Z (top 1.8 m)
    steps = node("stepsPhysicalFixed", (-2.5, 0, -2), {"friction": 0.7})
    sboxes = []
    for i in range(1, 7):
        h = 0.3 * i
        sboxes.append(((0, h / 2, -0.3 - 0.6 * (i - 1)), (2.4, h, 0.6)))
    boxes_mesh("stepsVisual", sboxes, mats["mid"], steps)
    for i, (c, s) in enumerate(sboxes, 1):
        cuboid(f"cuboidStep{i}", steps, c, s); col("cuboid")

    # --- Ramp: exactly 30 deg, 4 m of run -> 2.309 m of rise, 2.4 m wide (convex hull collider)
    ramp = node("rampPhysicalFixed", (2.5, 0, -2), {"friction": 0.7})
    rise = 4.0 * math.tan(math.radians(30))
    rv = [(-1.2, 0, 0), (1.2, 0, 0), (1.2, 0, -4), (-1.2, 0, -4), (-1.2, rise, -4), (1.2, rise, -4)]
    rf = [(0, 1, 2, 3), (0, 3, 4), (1, 5, 2), (0, 4, 5, 1), (3, 2, 5, 4)]
    mesh_obj("rampVisual", rv, rf, mats["light"], ramp)
    mesh_obj("hullRamp", rv, rf, mats["light"], ramp); col("hull")

    # --- 3 blocks, underside at 3.2 m (a 2.0 m jump apex + 1.2 m body bumps them), 1 m cubes, 2.5 m apart
    for n, z in enumerate((-8, -10.5, -13), 1):
        blk = node(f"block{n}PhysicalFixed", (0, 0, z), {"friction": 0.5})
        boxes_mesh(f"block{n}Visual", [((0, 3.7, 0), (1, 1, 1))], mats["dark"], blk)
        cuboid(f"cuboidBlock{n}", blk, (0, 3.7, 0), (1, 1, 1)); col("cuboid")

    # --- Pipe 1: upright, 1.2 m diameter, 1.4 m tall
    p1 = node("pipe1PhysicalFixed", (3, 0, -8), {"friction": 0.5})
    mesh_obj("pipe1Visual", *cylinder_parts(0.6, 1.4, (0, 0.7, 0)), mats["mid"], p1)
    make_empty("tubePipe1", (0, 0.7, 0), parent=p1, display="CUBE", size=0.5, scale_e=(1.2, 1.4, 1.2)); col("tube")

    # --- Pipe 2: lying along X, 1 m diameter, 3 m long (collider axis rotated 90 deg about engine Z)
    p2 = node("pipe2PhysicalFixed", (-3, 0, -14), {"friction": 0.5})
    mesh_obj("pipe2Visual", *cylinder_parts(0.5, 3.0, (0, 0.5, 0), axis="x"), mats["mid"], p2)
    make_empty("tubePipe2", (0, 0.5, 0), parent=p2, display="CUBE", size=0.5, scale_e=(1.0, 3.0, 1.0),
               quat_e=quat_axis_angle_e((0, 0, 1), 90)); col("tube")

    # --- 4 dynamic crates (1 m cubes, 6 kg): three in a row and one on top. Node origin = body origin = centre.
    for n, pos in enumerate(((-1.2, 0.5, -18), (0, 0.5, -18), (1.2, 0.5, -18), (0, 1.5, -18)), 1):
        c = node(f"crate{n}PhysicalDynamic", pos, {"mass": 6.0, "friction": 0.6, "restitution": 0.1})
        boxes_mesh(f"crate{n}Visual", [((0, 0, 0), (1, 1, 1))], mats["light"], c)
        cuboid(f"cuboidCrate{n}", c, (0, 0, 0), (1, 1, 1)); col("cuboid")

    # --- 4 m gap: run ends at z=-25, landing starts at z=-29
    landing = node("landingPhysicalFixed", (0, 0, -34), {"friction": 0.7})
    boxes_mesh("landingVisual", [((0, -0.25, 0), (8, 0.5, 10))], mats["ground"], landing)
    cuboid("cuboidLanding", landing, (0, -0.25, 0), (8, 0.5, 10)); col("cuboid")

    # --- Moving platform: kinematic, shuttles between refPlatformPath1 and refPlatformPath2 (0.1 m clearance each end)
    plat = node("movingPlatformPhysicalKinematicPositionBased", (0, 0, -40.6),
                {"friction": 1.0, "speed": 2.0, "pause": 0.6})
    boxes_mesh("movingPlatformVisual", [((0, -0.2, 0), (3, 0.4, 3))], mats["light"], plat)
    cuboid("cuboidMovingPlatform", plat, (0, -0.2, 0), (3, 0.4, 3)); col("cuboid")
    make_empty("refPlatformPath1", (0, 0, -40.6))
    make_empty("refPlatformPath2", (0, 0, -47.4))

    # --- End slab (z from -49 to -75) under the ribbon
    end = node("endPhysicalFixed", (0, 0, -62), {"friction": 0.7})
    boxes_mesh("endVisual", [((0, -0.25, 0), (8, 0.5, 26))], mats["ground"], end)
    cuboid("cuboidEnd", end, (0, -0.25, 0), (8, 0.5, 26)); col("cuboid")

    # --- Ribbon: flat strip 0.35 x 0.04 m, 20.0 m of arc length, 1.6 m above the end slab, gentle S curve.
    #     Visual only (the future Line/grind reads refLinePoint*; no collider on purpose).
    A, y0, z0, N = 1.8, 1.6, -52.0, 41

    def pts(length_z):
        return [(A * math.sin(2 * math.pi * 1.5 * i / (N - 1)), y0, z0 - length_z * i / (N - 1)) for i in range(N)]

    def arc(p):
        return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))

    lo, hi = 10.0, 20.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if arc(pts(mid)) < 20.0:
            lo = mid
        else:
            hi = mid
    path = pts((lo + hi) / 2)
    rv, rf = [], []
    for i, p in enumerate(path):
        a, b = path[max(i - 1, 0)], path[min(i + 1, N - 1)]
        tx, tz = b[0] - a[0], b[2] - a[2]
        n = math.hypot(tx, tz)
        px, pz = -tz / n * 0.175, tx / n * 0.175  # half width, perpendicular in XZ
        rv += [(p[0] - px, p[1] + 0.02, p[2] - pz), (p[0] + px, p[1] + 0.02, p[2] + pz),
               (p[0] + px, p[1] - 0.02, p[2] + pz), (p[0] - px, p[1] - 0.02, p[2] - pz)]
    for i in range(N - 1):
        o, q = i * 4, (i + 1) * 4
        for k in range(4):
            k2 = (k + 1) % 4
            rf.append((o + k, o + k2, q + k2, q + k))
    rf.append((3, 2, 1, 0))
    rf.append((4 * (N - 1), 4 * (N - 1) + 1, 4 * (N - 1) + 2, 4 * (N - 1) + 3))
    ribbon = node("ribbon", (0, 0, 0), {"length": round(arc(path), 3)})
    mesh_obj("ribbonVisual", rv, rf, mats["dark"], ribbon)
    for k, i in enumerate(range(0, N, 5), 1):  # 9 control points
        make_empty(f"refLinePoint{k}", path[i], props={"index": k})

    # --- Reference points
    make_empty("refRespawn", (0, 0, 0), display="ARROWS", size=0.6)
    make_empty("refCamera1", (9, 7, 8), display="PLAIN_AXES", size=0.6, props={"lookAt": [0.0, 1.0, -8.0]})
    make_empty("refCamera2", (-10, 8, -24), display="PLAIN_AXES", size=0.6, props={"lookAt": [0.0, 0.0, -45.0]})

    stats["ribbonLength"] = round(arc(path), 3)
    stats["rampRise"] = round(rise, 4)
    return stats


# ---------------------------------------------------------------- export + verify


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_vertex_color="NONE",
    )


def read_glb(path):
    data = open(path, "rb").read()
    length = struct.unpack_from("<I", data, 8)[0]
    jlen = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + jlen]), length


def verify(path, stats):
    gltf, size = read_glb(path)
    nodes = gltf["nodes"]
    names = [n.get("name", "") for n in nodes]
    kinds = {"cuboid": 0, "hull": 0, "tube": 0, "trimesh": 0, "ball": 0}
    for n in names:
        for k in kinds:
            if n.lower().startswith(k):
                kinds[k] += 1
    meshes = [n for n in nodes if "mesh" in n]
    tris = 0
    for m in gltf["meshes"]:
        for prim in m["primitives"]:
            tris += gltf["accessors"][prim["indices"]]["count"] // 3
    mats = [m["name"] for m in gltf["materials"]]
    refs = sorted(n for n in names if n.startswith("ref"))
    physicals = sorted(n for n in names if "Physical" in n)
    assert all(x.startswith("grey") for x in mats), mats
    assert kinds["cuboid"] == stats["colliders"]["cuboid"], (kinds, stats)
    assert kinds["tube"] == 2 and kinds["hull"] == 1, kinds
    for needed in ("refRespawn", "refCamera1", "refCamera2"):
        assert needed in names, needed
    assert len(set(names)) == len(names), "duplicate node names"
    sha = hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]
    print("GREYBOX_OK", json.dumps({
        "file": path, "bytes": size, "sha256_16": sha, "nodes": len(nodes), "meshNodes": len(meshes), "tris": tris,
        "materials": mats, "colliders": kinds, "physicalNodes": physicals, "refs": refs,
        "ribbonLength": stats["ribbonLength"], "rampRiseM": stats["rampRise"],
        "extensionsUsed": gltf.get("extensionsUsed", []),
    }, indent=1))


if __name__ == "__main__":
    st = build()
    export(OUT)
    verify(OUT, st)
