"""Greybox test level (plan T1.1, refactored in T2.1c onto blender/lib).

Run (headless, deterministic, re-runnable):
    blender.exe -b -P blender/eras/greybox.py
    blender.exe -b -P blender/eras/greybox.py -- --out blender/out/greybox_t21c.glb

Conventions (docs/PLAN-3D.md 5.3, Objects.getFromModel):
  - 1 unit = 1 m, +Y up in the glTF, pivot on the ground (dynamic bodies are centred).
  - Layout is authored in engine (+Y up, -Z forward) coordinates and converted via
    `vn_scene` / `vn_collide` / `vn_refs` (`engine_coords=True`).
  - One root node per physical object: `<name>Physical<Fixed|Dynamic|KinematicPositionBased>`
    containing `<name>Visual` plus collider children (`cuboid*`, `tube*`, `hull*`).
  - Empties `ref<Name><n>` are reference points (`refRespawn`, `refCamera1/2`,
    `refPlatformPath1/2`, `refLinePoint1..9`).
  - Grey materials only.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.abspath(os.path.join(HERE, ".."))  # game/blender/
ROOT = os.path.abspath(os.path.join(BLENDER_DIR, ".."))  # game/
if BLENDER_DIR not in sys.path:
    sys.path.insert(0, BLENDER_DIR)

from lib import vn_collide, vn_export, vn_refs, vn_scene  # noqa: E402

OUT = os.path.join(ROOT, "static", "eras", "greybox", "greybox.glb")
if "--" in sys.argv:
    args = sys.argv[sys.argv.index("--") + 1 :]
    if "--out" in args:
        OUT = os.path.abspath(args[args.index("--out") + 1])

# ---------------------------------------------------------------- helpers


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def grey(name: str, hexgrey: int) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    v = srgb_to_linear(hexgrey / 255.0)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (v, v, v, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
    mat.diffuse_color = (v, v, v, 1.0)
    return mat


def mesh_obj(name, verts_e, faces, mat, parent=None, smooth=False) -> bpy.types.Object:
    """Mesh from engine-space vertices (local to the parent node)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([vn_scene.to_blender_vec(v) for v in verts_e], [], faces)
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
    vn_scene.link_object(o)
    if parent is not None:
        o.parent = parent
    return o


BOX_FACES = [
    (0, 3, 2, 1),
    (4, 5, 6, 7),
    (0, 1, 5, 4),
    (2, 3, 7, 6),
    (1, 2, 6, 5),
    (0, 4, 7, 3),
]


def box_verts(center, size):
    cx, cy, cz = center
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    return [
        (cx - hx, cy - hy, cz - hz),
        (cx + hx, cy - hy, cz - hz),
        (cx + hx, cy - hy, cz + hz),
        (cx - hx, cy - hy, cz + hz),
        (cx - hx, cy + hy, cz - hz),
        (cx + hx, cy + hy, cz - hz),
        (cx + hx, cy + hy, cz + hz),
        (cx - hx, cy + hy, cz + hz),
    ]


def merge(parts):
    """parts: list of (verts, faces) -> one (verts, faces)."""
    verts, faces = [], []
    for v, f in parts:
        base = len(verts)
        verts += v
        faces += [tuple(i + base for i in face) for face in f]
    return verts, faces


def boxes_mesh(name, boxes, mat, parent=None) -> bpy.types.Object:
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


# ---------------------------------------------------------------- build


def build() -> dict:
    vn_scene.reset_scene("Greybox")
    mats = {
        "ground": grey("greyGround", 104),
        "mid": grey("greyMid", 150),
        "light": grey("greyLight", 200),
        "dark": grey("greyDark", 74),
    }
    stats = {"colliders": {"cuboid": 0, "hull": 0, "tube": 0}}

    def col(kind: str, n: int = 1) -> None:
        stats["colliders"][kind] += n

    # --- Run (straight, 8 m wide, 30 m long, top at y=0, z from +5 to -25), spawn at origin
    run_vis = boxes_mesh("runVisual", [((0, -0.25, 0), (8, 0.5, 30))], mats["ground"])
    run_col = vn_collide.add_cuboid("Run", (8, 0.5, 30), location=(0, -0.25, 0), engine_coords=True)
    vn_collide.wrap_physical_object(
        "run", run_vis, [run_col], friction=0.7, location=(0, 0, -10), engine_coords=True
    )
    col("cuboid")

    # --- Steps: 6 x 0.3 m risers, 0.6 m treads, 2.4 m wide, rising toward -Z (top 1.8 m)
    sboxes = []
    for i in range(1, 7):
        h = 0.3 * i
        sboxes.append(((0, h / 2, -0.3 - 0.6 * (i - 1)), (2.4, h, 0.6)))
    steps_vis = boxes_mesh("stepsVisual", sboxes, mats["mid"])
    step_cols = [
        vn_collide.add_cuboid(f"Step{i}", s, location=c, engine_coords=True)
        for i, (c, s) in enumerate(sboxes, 1)
    ]
    vn_collide.wrap_physical_object(
        "steps", steps_vis, step_cols, friction=0.7, location=(-2.5, 0, -2), engine_coords=True
    )
    col("cuboid", len(step_cols))

    # --- Ramp: exactly 30 deg, 4 m of run -> 2.309 m of rise, 2.4 m wide (convex hull collider)
    rise = 4.0 * math.tan(math.radians(30))
    rv = [
        (-1.2, 0, 0),
        (1.2, 0, 0),
        (1.2, 0, -4),
        (-1.2, 0, -4),
        (-1.2, rise, -4),
        (1.2, rise, -4),
    ]
    rf = [(0, 1, 2, 3), (0, 3, 4), (1, 5, 2), (0, 4, 5, 1), (3, 2, 5, 4)]
    ramp_vis = mesh_obj("rampVisual", rv, rf, mats["light"])
    ramp_col = vn_collide.add_hull("Ramp", ramp_vis)
    vn_collide.wrap_physical_object(
        "ramp", ramp_vis, [ramp_col], friction=0.7, location=(2.5, 0, -2), engine_coords=True
    )
    col("hull")

    # --- 3 blocks, underside at 3.2 m, 1 m cubes, 2.5 m apart
    for n, z in enumerate((-8, -10.5, -13), 1):
        blk_vis = boxes_mesh(f"block{n}Visual", [((0, 3.7, 0), (1, 1, 1))], mats["dark"])
        blk_col = vn_collide.add_cuboid(
            f"Block{n}", (1, 1, 1), location=(0, 3.7, 0), engine_coords=True
        )
        vn_collide.wrap_physical_object(
            f"block{n}", blk_vis, [blk_col], friction=0.5, location=(0, 0, z), engine_coords=True
        )
        col("cuboid")

    # --- Pipe 1: upright, 1.2 m diameter, 1.4 m tall
    p1_vis = mesh_obj("pipe1Visual", *cylinder_parts(0.6, 1.4, (0, 0.7, 0)), mats["mid"])
    p1_col = vn_collide.add_cylinder(
        "Pipe1", radius=0.6, height=1.4, location=(0, 0.7, 0), engine_coords=True
    )
    vn_collide.wrap_physical_object(
        "pipe1", p1_vis, [p1_col], friction=0.5, location=(3, 0, -8), engine_coords=True
    )
    col("tube")

    # --- Pipe 2: lying along X, 1 m diameter, 3 m long (collider rotated +90 deg about engine Z)
    p2_vis = mesh_obj("pipe2Visual", *cylinder_parts(0.5, 3.0, (0, 0.5, 0), axis="x"), mats["mid"])
    p2_col = vn_collide.add_cylinder(
        "Pipe2",
        radius=0.5,
        height=3.0,
        location=(0, 0.5, 0),
        rotation=(0.0, 0.0, math.pi / 2),
        engine_coords=True,
    )
    vn_collide.wrap_physical_object(
        "pipe2", p2_vis, [p2_col], friction=0.5, location=(-3, 0, -14), engine_coords=True
    )
    col("tube")

    # --- 4 dynamic crates (1 m cubes, 6 kg): node origin = body origin = centre
    crate_positions = ((-1.2, 0.5, -18), (0, 0.5, -18), (1.2, 0.5, -18), (0, 1.5, -18))
    for n, pos in enumerate(crate_positions, 1):
        c_vis = boxes_mesh(f"crate{n}Visual", [((0, 0, 0), (1, 1, 1))], mats["light"])
        c_col = vn_collide.add_cuboid(
            f"Crate{n}", (1, 1, 1), location=(0, 0, 0), engine_coords=True
        )
        vn_collide.wrap_physical_object(
            f"crate{n}",
            c_vis,
            [c_col],
            mass=6.0,
            friction=0.6,
            restitution=0.1,
            location=pos,
            engine_coords=True,
        )
        col("cuboid")

    # --- 4 m gap: run ends at z=-25, landing starts at z=-29
    landing_vis = boxes_mesh("landingVisual", [((0, -0.25, 0), (8, 0.5, 10))], mats["ground"])
    landing_col = vn_collide.add_cuboid(
        "Landing", (8, 0.5, 10), location=(0, -0.25, 0), engine_coords=True
    )
    vn_collide.wrap_physical_object(
        "landing", landing_vis, [landing_col], friction=0.7, location=(0, 0, -34), engine_coords=True
    )
    col("cuboid")

    # --- Moving platform: kinematic, shuttles between refPlatformPath1 and refPlatformPath2
    plat_vis = boxes_mesh("movingPlatformVisual", [((0, -0.2, 0), (3, 0.4, 3))], mats["light"])
    plat_col = vn_collide.add_cuboid(
        "MovingPlatform", (3, 0.4, 3), location=(0, -0.2, 0), engine_coords=True
    )
    vn_collide.wrap_physical_object(
        "movingPlatform",
        plat_vis,
        [plat_col],
        body_type="kinematicPositionBased",
        friction=1.0,
        extra_props={"speed": 2.0, "pause": 0.6},
        location=(0, 0, -40.6),
        engine_coords=True,
    )
    col("cuboid")
    vn_refs.add_ref("PlatformPath1", location=(0, 0, -40.6), engine_coords=True)
    vn_refs.add_ref("PlatformPath2", location=(0, 0, -47.4), engine_coords=True)

    # --- End slab (z from -49 to -75) under the ribbon
    end_vis = boxes_mesh("endVisual", [((0, -0.25, 0), (8, 0.5, 26))], mats["ground"])
    end_col = vn_collide.add_cuboid(
        "End", (8, 0.5, 26), location=(0, -0.25, 0), engine_coords=True
    )
    vn_collide.wrap_physical_object(
        "end", end_vis, [end_col], friction=0.7, location=(0, 0, -62), engine_coords=True
    )
    col("cuboid")

    # --- Ribbon: flat strip 0.35 x 0.04 m, 20.0 m arc length, 1.6 m above end slab (visual only)
    amp, y0, z0, count = 1.8, 1.6, -52.0, 41

    def pts(length_z: float):
        return [
            (
                amp * math.sin(2 * math.pi * 1.5 * i / (count - 1)),
                y0,
                z0 - length_z * i / (count - 1),
            )
            for i in range(count)
        ]

    def arc(p) -> float:
        return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))

    lo, hi = 10.0, 20.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if arc(pts(mid)) < 20.0:
            lo = mid
        else:
            hi = mid
    path = pts((lo + hi) / 2)

    rv_rib, rf_rib = [], []
    for i, p in enumerate(path):
        a, b = path[max(i - 1, 0)], path[min(i + 1, count - 1)]
        tx, tz = b[0] - a[0], b[2] - a[2]
        norm = math.hypot(tx, tz)
        px, pz = -tz / norm * 0.175, tx / norm * 0.175  # half width, perpendicular in XZ
        rv_rib += [
            (p[0] - px, p[1] + 0.02, p[2] - pz),
            (p[0] + px, p[1] + 0.02, p[2] + pz),
            (p[0] + px, p[1] - 0.02, p[2] + pz),
            (p[0] - px, p[1] - 0.02, p[2] - pz),
        ]
    for i in range(count - 1):
        o, q = i * 4, (i + 1) * 4
        for k in range(4):
            k2 = (k + 1) % 4
            rf_rib.append((o + k, o + k2, q + k2, q + k))
    rf_rib.append((3, 2, 1, 0))
    rf_rib.append(
        (4 * (count - 1), 4 * (count - 1) + 1, 4 * (count - 1) + 2, 4 * (count - 1) + 3)
    )

    ribbon = bpy.data.objects.new("ribbon", None)
    ribbon.empty_display_type = "PLAIN_AXES"
    ribbon.empty_display_size = 0.4
    ribbon.location = vn_scene.to_blender(0, 0, 0)
    vn_scene.set_custom_props(ribbon, {"length": round(arc(path), 3)})
    vn_scene.link_object(ribbon)
    mesh_obj("ribbonVisual", rv_rib, rf_rib, mats["dark"], ribbon)
    for k, i in enumerate(range(0, count, 5), 1):  # 9 control points
        vn_refs.add_line_point(k, path[i], engine_coords=True)

    # --- Reference points
    vn_refs.add_respawn("", (0, 0, 0), yaw_deg=0.0, engine_coords=True)
    vn_refs.add_camera(
        "1",
        (9, 7, 8),
        yaw_deg=None,
        pitch_deg=None,
        distance=None,
        look_at=[0.0, 1.0, -8.0],
        engine_coords=True,
    )
    vn_refs.add_camera(
        "2",
        (-10, 8, -24),
        yaw_deg=None,
        pitch_deg=None,
        distance=None,
        look_at=[0.0, 0.0, -45.0],
        engine_coords=True,
    )

    stats["ribbonLength"] = round(arc(path), 3)
    stats["rampRise"] = round(rise, 4)
    return stats


# ---------------------------------------------------------------- export + verify


def export(path: str) -> dict:
    return vn_export.export_glb(
        path,
        export_texcoords=False,
        export_vertex_color="NONE",
        export_image_format="NONE",
    )


def verify(path: str, stats: dict) -> None:
    info = vn_export.inspect_glb(path)
    gltf = info["gltf"]
    size = info["bytes"]
    nodes = gltf["nodes"]
    names = [n.get("name", "") for n in nodes]
    kinds = {"cuboid": 0, "hull": 0, "tube": 0, "trimesh": 0, "ball": 0}
    for n in names:
        for k in kinds:
            if n.lower().startswith(k):
                kinds[k] += 1
    meshes = [n for n in nodes if "mesh" in n]
    mats = [m["name"] for m in gltf["materials"]]
    refs = sorted(n for n in names if n.startswith("ref"))
    physicals = sorted(n for n in names if "Physical" in n)
    assert all(x.startswith("grey") for x in mats), mats
    assert kinds["cuboid"] == stats["colliders"]["cuboid"], (kinds, stats)
    assert kinds["tube"] == 2 and kinds["hull"] == 1, kinds
    for needed in ("refRespawn", "refCamera1", "refCamera2"):
        assert needed in names, needed
    assert len(set(names)) == len(names), "duplicate node names"
    with open(path, "rb") as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()[:16]
    print(
        "GREYBOX_OK",
        json.dumps(
            {
                "file": path,
                "bytes": size,
                "sha256_16": sha,
                "nodes": len(nodes),
                "meshNodes": len(meshes),
                "tris": info["triangles"],
                "materials": mats,
                "colliders": kinds,
                "physicalNodes": physicals,
                "refs": refs,
                "ribbonLength": stats["ribbonLength"],
                "rampRiseM": stats["rampRise"],
                "extensionsUsed": gltf.get("extensionsUsed", []),
            },
            indent=1,
        ),
    )


if __name__ == "__main__":
    st = build()
    export(OUT)
    verify(OUT, st)
