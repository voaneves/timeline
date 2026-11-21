"""Core procedural geometry builders for the paper-and-toy diorama art language.

Primitives:
  - `make_rounded_box`: chunky beveled box with ground pivot and weighted normals.
  - `make_blob`: multi-lobe metaball -> voxel remesh -> smooth -> decimate organic form.
  - `make_tube`: hollow lipped pipe/tube with chunky walls (>= 0.08 m) and clean bevels.
  - `make_ribbon`: continuous beveled 3D spline ribbon with length-aligned UVs ("a Linha").
  - `make_boolean_relief`: clean exact-solver boolean relief helper (dots, recesses).
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import vn_bevel, vn_scene


# ------------------------------------------------------------------ uv helpers


def _assign_box_uvs(bm: bmesh.types.BMesh, scale: float = 1.0) -> None:
    """Assign simple triplanar box UVs onto all face loops in `bm`."""
    uv_layer = bm.loops.layers.uv.verify()
    inv_scale = 1.0 / max(scale, 1e-6)
    for face in bm.faces:
        n = face.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in face.loops:
            co = loop.vert.co
            if az >= ax and az >= ay:
                u, v = co.x * inv_scale, co.y * inv_scale
            elif ax >= ay and ax >= az:
                u, v = co.y * inv_scale, co.z * inv_scale
            else:
                u, v = co.x * inv_scale, co.z * inv_scale
            loop[uv_layer].uv = (u, v)


def _ensure_mesh_uvs(obj: bpy.types.Object) -> None:
    """Ensure `obj.data` has a valid UV map, creating box-projected UVs if missing."""
    mesh = obj.data
    if mesh.uv_layers and len(mesh.uv_layers) > 0:
        return
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        for f in bm.faces:
            f.normal_update()
        _assign_box_uvs(bm, scale=1.0)
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.update()


# --------------------------------------------------------------- rounded box


def make_rounded_box(
    name: str,
    size: tuple[float, float, float] | float = (1.0, 1.0, 1.0),
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel_width: float | None = None,
    bevel_ratio: float = 0.12,
    segments: int = 3,
    pivot: str = "BOTTOM",
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a beveled toy-style box with weighted normals.

    Args:
        name: Object and mesh name.
        size: `(sx, sy, sz)` in meters, or a single float for a cube.
        location: World position `(x, y, z)` in Blender coordinates.
        bevel_width: Explicit bevel width in meters, or None to use `bevel_ratio * min_dim`.
        bevel_ratio: Automatic bevel ratio (default 0.12, within 8-15% art guideline).
        segments: Number of bevel segments (default 3).
        pivot: `'BOTTOM'` (ground pivot at z=0), `'CENTER'`, or `'TOP'`.
        collection: Target collection name or Collection datablock.
    """
    if isinstance(size, (int, float)):
        sx = sy = sz = max(1e-3, float(size))
    else:
        sx, sy, sz = (max(1e-3, float(v)) for v in size)

    pivot_upper = pivot.upper()
    if pivot_upper == "BOTTOM":
        z_offset = sz * 0.5
    elif pivot_upper == "CENTER":
        z_offset = 0.0
    elif pivot_upper == "TOP":
        z_offset = -sz * 0.5
    else:
        raise ValueError(f"Unsupported pivot {pivot!r}; expected 'BOTTOM', 'CENTER', or 'TOP'")

    bm = bmesh.new()
    try:
        bmesh.ops.create_cube(bm, size=1.0)
        scale_mat = Matrix.Diagonal((sx, sy, sz, 1.0))
        bmesh.ops.transform(bm, matrix=scale_mat, verts=bm.verts)
        if abs(z_offset) > 1e-8:
            bmesh.ops.translate(bm, vec=Vector((0.0, 0.0, z_offset)), verts=bm.verts)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            f.normal_update()
        _assign_box_uvs(bm, scale=max(sx, sy, sz))

        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(float(v) for v in location)
    vn_scene.link_object(obj, collection)

    vn_bevel.finalize_toy_mesh(
        obj,
        bevel_width=bevel_width,
        bevel_ratio=bevel_ratio,
        bevel_segments=segments,
        apply=True,
    )
    return obj


# ---------------------------------------------------------------------- blob


def _parse_lobes(lobes: Sequence, radius: float) -> list[tuple[Vector, float, float]]:
    """Normalize lobe descriptors into `(Vector(x, y, z), radius, stiffness)` tuples."""
    parsed: list[tuple[Vector, float, float]] = []
    for item in lobes:
        if isinstance(item, dict):
            co = Vector(tuple(float(v) for v in item["co"]))
            rad = max(0.04, float(item.get("radius", radius)))
            stiff = float(item.get("stiffness", 2.0))
            parsed.append((co, rad, stiff))
        elif len(item) == 2 and hasattr(item[0], "__len__"):
            co = Vector(tuple(float(v) for v in item[0]))
            rad = max(0.04, float(item[1]))
            parsed.append((co, rad, 2.0))
        elif len(item) == 3 and hasattr(item[0], "__len__"):
            co = Vector(tuple(float(v) for v in item[0]))
            rad = max(0.04, float(item[1]))
            stiff = float(item[2])
            parsed.append((co, rad, stiff))
        elif len(item) == 4:
            co = Vector((float(item[0]), float(item[1]), float(item[2])))
            rad = max(0.04, float(item[3]))
            parsed.append((co, rad, 2.0))
        else:
            raise ValueError(f"Unsupported lobe format: {item!r}")
    return parsed


def make_blob(
    name: str,
    lobes: Sequence | None = None,
    radius: float = 0.6,
    resolution: float = 0.08,
    decimate_ratio: float = 0.45,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    smooth_iterations: int = 2,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create an organic multi-lobe sculpted blob from metaballs.

    Pipeline: Metaball (3-5 chunky lobes) -> evaluated mesh -> Voxel Remesh ->
    Smooth -> Collapse Decimate -> outside normals & smooth shading.
    """
    r = max(0.08, float(radius))
    use_default_ground_pivot = lobes is None

    if lobes is None:
        raw_lobes = [
            ((0.0, 0.0, r * 0.78), r * 0.82),
            ((r * 0.68, r * 0.14, r * 0.50), r * 0.60),
            ((-r * 0.65, -r * 0.12, r * 0.52), r * 0.58),
            ((r * 0.14, -r * 0.58, r * 0.48), r * 0.54),
            ((-r * 0.16, r * 0.54, r * 0.56), r * 0.56),
        ]
    else:
        raw_lobes = lobes

    parsed_lobes = _parse_lobes(raw_lobes, r)
    if not parsed_lobes:
        raise ValueError("make_blob requires at least one lobe")

    res = max(0.02, float(resolution))
    threshold = 0.45
    mball = bpy.data.metaballs.new(f"_{name}_MBall")
    mball.resolution = res
    mball.render_resolution = res
    mball.threshold = threshold

    for co, lobe_r, stiff in parsed_lobes:
        # Compensate for metaball iso-surface falloff so `lobe_r` matches visual radius.
        iso_factor = math.sqrt(max(0.05, 1.0 - (threshold ** (1.0 / max(stiff, 0.5)))))
        el = mball.elements.new(type="BALL")
        el.co = co
        el.radius = lobe_r / iso_factor
        el.stiffness = stiff

    mb_obj = bpy.data.objects.new(f"_{name}_MBallObj", mball)
    bpy.context.scene.collection.objects.link(mb_obj)

    try:
        depsgraph = bpy.context.evaluated_depsgraph_get()
        depsgraph.update()
        mb_eval = mb_obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(mb_eval)
        mesh.name = name
    finally:
        bpy.data.objects.remove(mb_obj, do_unlink=True)
        bpy.data.metaballs.remove(mball)

    if len(mesh.vertices) == 0:
        bpy.data.meshes.remove(mesh)
        raise RuntimeError(f"Metaball {name!r} evaluated to an empty mesh; increase radius or lower resolution")

    # Ground-pivot default blobs so their base rests cleanly on z=0.
    if use_default_ground_pivot:
        coords = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
        mesh.vertices.foreach_get("co", coords)
        min_z = float(coords.reshape((-1, 3))[:, 2].min())
        if abs(min_z) > 1e-6:
            mesh.transform(Matrix.Translation((0.0, 0.0, -min_z)))
            mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(float(v) for v in location)
    vn_scene.link_object(obj, collection)

    # 1. Voxel remesh for uniform watertight manifold quads.
    remesh = obj.modifiers.new(name="VN_BlobRemesh", type="REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = max(0.02, res * 0.9)
    if hasattr(remesh, "use_smooth_shade"):
        remesh.use_smooth_shade = True
    vn_bevel._apply_modifier(obj, remesh.name)

    # 2. Gentle Laplacian smoothing to remove voxel stair-stepping.
    if int(smooth_iterations) > 0:
        smooth = obj.modifiers.new(name="VN_BlobSmooth", type="SMOOTH")
        smooth.factor = 0.5
        smooth.iterations = int(smooth_iterations)
        vn_bevel._apply_modifier(obj, smooth.name)

    # 3. Decimate to hit clean real-time triangle budgets while keeping silhouette soft.
    dec_ratio = float(decimate_ratio)
    if 0.0 < dec_ratio < 0.999:
        dec = obj.modifiers.new(name="VN_BlobDecimate", type="DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = max(0.05, dec_ratio)
        vn_bevel._apply_modifier(obj, dec.name)

    # Re-ground after remesh/smooth if using default ground pivot.
    if use_default_ground_pivot and len(obj.data.vertices) > 0:
        coords = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
        obj.data.vertices.foreach_get("co", coords)
        min_z = float(coords.reshape((-1, 3))[:, 2].min())
        if abs(min_z) > 1e-6:
            obj.data.transform(Matrix.Translation((0.0, 0.0, -min_z)))
            obj.data.update()

    _ensure_mesh_uvs(obj)
    vn_bevel.apply_weighted_normals(
        obj,
        weight=50,
        keep_sharp=False,
        face_influence=False,
        apply=True,
    )
    return obj


# ---------------------------------------------------------------------- tube


def make_tube(
    name: str,
    radius: float = 0.5,
    height: float = 1.2,
    wall_thickness: float = 0.10,
    lip_height: float = 0.22,
    lip_outset: float = 0.10,
    segments: int = 24,
    bevel_width: float = 0.025,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create a chunky hollow lipped pipe/tube with ground pivot and beveled rims."""
    segs = max(8, int(segments))
    r_outer = max(0.08, float(radius))
    wall = max(0.04, min(float(wall_thickness), r_outer * 0.85))
    r_inner = max(0.02, r_outer - wall)
    h = max(0.08, float(height))
    lip_h = max(0.0, min(float(lip_height), h * 0.75))
    lip_out = max(0.0, float(lip_outset))

    # Closed 2D cross-section profile (r, z) revolved around Z.
    if lip_h > 1e-4 and lip_out > 1e-4:
        profile: list[tuple[float, float]] = [
            (r_outer, 0.0),
            (r_outer, h - lip_h),
            (r_outer + lip_out, h - lip_h),
            (r_outer + lip_out, h),
            (r_inner, h),
            (r_inner, 0.0),
        ]
    else:
        profile = [
            (r_outer, 0.0),
            (r_outer, h),
            (r_inner, h),
            (r_inner, 0.0),
        ]

    # Cumulative arc lengths along profile for clean V coordinates.
    arc_lengths = [0.0]
    n_prof = len(profile)
    for i in range(n_prof):
        r0, z0 = profile[i]
        r1, z1 = profile[(i + 1) % n_prof]
        arc_lengths.append(arc_lengths[-1] + math.hypot(r1 - r0, z1 - z0))
    total_arc = max(arc_lengths[-1], 1e-6)

    bm = bmesh.new()
    try:
        rings: list[list[bmesh.types.BMVert]] = []
        for s_idx in range(segs):
            angle = (2.0 * math.pi * s_idx) / segs
            ca, sa = math.cos(angle), math.sin(angle)
            ring = [bm.verts.new((r_p * ca, r_p * sa, z_p)) for r_p, z_p in profile]
            rings.append(ring)

        uv_layer = bm.loops.layers.uv.verify()
        for s_idx in range(segs):
            next_s = (s_idx + 1) % segs
            u0 = s_idx / segs
            u1 = (s_idx + 1) / segs
            ring_a = rings[s_idx]
            ring_b = rings[next_s]

            for p_idx in range(n_prof):
                next_p = (p_idx + 1) % n_prof
                v0 = arc_lengths[p_idx] / total_arc
                v1 = arc_lengths[p_idx + 1] / total_arc
                face = bm.faces.new(
                    (ring_a[p_idx], ring_b[p_idx], ring_b[next_p], ring_a[next_p])
                )
                uvs = ((u0, v0), (u1, v0), (u1, v1), (u0, v1))
                for loop, uv in zip(face.loops, uvs):
                    loop[uv_layer].uv = uv

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(float(v) for v in location)
    vn_scene.link_object(obj, collection)

    # Cap bevel width safely below half the smallest wall/lip span.
    min_feature = min(wall, h)
    if lip_h > 1e-4 and lip_out > 1e-4:
        min_feature = min(min_feature, lip_h, lip_out)
    eff_bevel = min(float(bevel_width), min_feature * 0.42) if bevel_width > 0.0 else 0.0

    vn_bevel.finalize_toy_mesh(
        obj,
        bevel_width=eff_bevel,
        bevel_segments=3,
        apply=True,
    )
    return obj


# -------------------------------------------------------------------- ribbon


def _catmull_rom_centripetal(
    p0: Vector, p1: Vector, p2: Vector, p3: Vector, t: float, alpha: float = 0.5
) -> Vector:
    """Evaluate a centripetal Catmull-Rom segment between `p1` and `p2` at `t` in [0, 1]."""

    def _knot(ti: float, a: Vector, b: Vector) -> float:
        dist = max((b - a).length, 1e-6)
        return ti + (dist ** alpha)

    t0 = 0.0
    t1 = _knot(t0, p0, p1)
    t2 = _knot(t1, p1, p2)
    t3 = _knot(t2, p2, p3)
    u = t1 + (t2 - t1) * t

    a1 = ((t1 - u) / (t1 - t0)) * p0 + ((u - t0) / (t1 - t0)) * p1
    a2 = ((t2 - u) / (t2 - t1)) * p1 + ((u - t1) / (t2 - t1)) * p2
    a3 = ((t3 - u) / (t3 - t2)) * p2 + ((u - t2) / (t3 - t2)) * p3

    b1 = ((t2 - u) / (t2 - t0)) * a1 + ((u - t0) / (t2 - t0)) * a2
    b2 = ((t3 - u) / (t3 - t1)) * a2 + ((u - t1) / (t3 - t1)) * a3

    return ((t2 - u) / (t2 - t1)) * b1 + ((u - t1) / (t2 - t1)) * b2


def _sample_spline_uniform(
    ctrl_pts: list[Vector], step: float, max_turn_deg: float = 10.0
) -> tuple[list[Vector], list[float]]:
    """Sample a 3D control-point spline at uniform `step`, refining tight bends smoothly."""
    dense: list[Vector] = []
    n = len(ctrl_pts)
    safe_step = max(step, 1e-3)

    if n == 2:
        seg_len = (ctrl_pts[1] - ctrl_pts[0]).length
        count = max(2, int(math.ceil(seg_len / safe_step)) + 1)
        pts = [ctrl_pts[0].lerp(ctrl_pts[1], i / (count - 1)) for i in range(count)]
        s_vals = [seg_len * (i / (count - 1)) for i in range(count)]
        return pts, s_vals

    # Reflect phantom endpoints so start/end tangents follow the opening/closing direction.
    padded = (
        [ctrl_pts[0] * 2.0 - ctrl_pts[1]]
        + ctrl_pts
        + [ctrl_pts[-1] * 2.0 - ctrl_pts[-2]]
    )

    for i in range(n - 1):
        p0, p1, p2, p3 = padded[i], padded[i + 1], padded[i + 2], padded[i + 3]
        chord = (p2 - p1).length
        subdivs = max(16, int(math.ceil((chord / safe_step) * 8.0)))
        start_k = 0 if i == 0 else 1
        for k in range(start_k, subdivs + 1):
            dense.append(_catmull_rom_centripetal(p0, p1, p2, p3, k / subdivs))

    # Build cumulative arc length and tangent turn angles along dense polyline.
    cum_s = [0.0]
    for i in range(1, len(dense)):
        cum_s.append(cum_s[-1] + (dense[i] - dense[i - 1]).length)
    total_len = cum_s[-1]
    if total_len < 1e-6:
        raise ValueError("Ribbon control points have zero total length")

    max_turn_rad = math.radians(max(2.0, float(max_turn_deg)))
    min_step = safe_step * 0.22

    sampled: list[Vector] = [dense[0]]
    sampled_s: list[float] = [0.0]
    last_s = 0.0
    last_dir = (dense[1] - dense[0]).normalized()

    for idx in range(1, len(dense) - 1):
        seg_vec = dense[idx + 1] - dense[idx]
        if seg_vec.length < 1e-8:
            continue
        cur_dir = seg_vec.normalized()
        ds = cum_s[idx] - last_s
        turn = math.acos(max(-1.0, min(1.0, float(last_dir.dot(cur_dir)))))

        if ds >= safe_step or (ds >= min_step and turn >= max_turn_rad):
            # Avoid leaving a tiny sliver right before the endpoint.
            if total_len - cum_s[idx] >= min_step:
                sampled.append(dense[idx])
                sampled_s.append(cum_s[idx])
                last_s = cum_s[idx]
                last_dir = cur_dir

    sampled.append(dense[-1])
    sampled_s.append(total_len)
    return sampled, sampled_s


def make_ribbon(
    name: str,
    points: Iterable[Sequence[float]],
    width: float = 0.35,
    thickness: float = 0.04,
    step: float = 0.25,
    elevation: float = 0.02,
    bevel_width: float = 0.008,
    collection: bpy.types.Collection | str | None = None,
    engine_coords: bool = False,
) -> bpy.types.Object:
    """Create a continuous beveled 3D ribbon extruded along a spline ("a Linha").

    Generates clean UVs with `u` in `[0, 1]` across the ribbon width and `v` in
    `[0, 1]` monotonically along the ribbon length, plus outward weighted normals.
    """
    raw_pts = [
        Vector(vn_scene.to_blender_vec(p) if engine_coords else tuple(float(c) for c in p))
        for p in points
    ]
    # Remove duplicate consecutive points.
    ctrl_pts: list[Vector] = []
    for pt in raw_pts:
        if not ctrl_pts or (pt - ctrl_pts[-1]).length > 1e-5:
            ctrl_pts.append(pt)
    if len(ctrl_pts) < 2:
        raise ValueError("make_ribbon requires at least 2 distinct 3D points")

    w = max(0.02, float(width))
    th = max(0.004, float(thickness))
    hw = w * 0.5
    elev = Vector((0.0, 0.0, float(elevation)))

    centers, arc_s = _sample_spline_uniform(ctrl_pts, step=max(0.02, float(step)))
    total_len = max(arc_s[-1], 1e-6)
    n_stations = len(centers)

    world_up = Vector((0.0, 0.0, 1.0))
    fallback_up = Vector((0.0, 1.0, 0.0))

    bm = bmesh.new()
    try:
        rings: list[tuple[bmesh.types.BMVert, ...]] = []
        prev_right = Vector((1.0, 0.0, 0.0))

        for i in range(n_stations):
            if i == 0:
                tangent = centers[1] - centers[0]
            elif i == n_stations - 1:
                tangent = centers[-1] - centers[-2]
            else:
                tangent = centers[i + 1] - centers[i - 1]
            tangent = tangent.normalized()

            ref_up = world_up if abs(tangent.dot(world_up)) < 0.98 else fallback_up
            right = tangent.cross(ref_up)
            if right.length < 1e-6:
                right = prev_right
            else:
                right.normalize()
            if i > 0 and right.dot(prev_right) < 0.0:
                right = -right
            prev_right = right

            up = right.cross(tangent).normalized()
            base = centers[i] + elev

            bl = bm.verts.new(base - right * hw)
            br = bm.verts.new(base + right * hw)
            tr = bm.verts.new(base + right * hw + up * th)
            tl = bm.verts.new(base - right * hw + up * th)
            rings.append((bl, br, tr, tl))

        uv_layer = bm.loops.layers.uv.verify()

        # Quad strip faces along length:
        #   top:    (tl0, tr0, tr1, tl1) -> u in [0, 1] left-to-right, v along length
        #   right:  (br0, br1, tr1, tr0) -> u = 1.0
        #   bottom: (bl0, bl1, br1, br0) -> u in [0, 1] left-to-right
        #   left:   (tl0, tl1, bl1, bl0) -> u = 0.0
        for i in range(n_stations - 1):
            bl0, br0, tr0, tl0 = rings[i]
            bl1, br1, tr1, tl1 = rings[i + 1]
            v0 = arc_s[i] / total_len
            v1 = arc_s[i + 1] / total_len

            quad_specs = (
                ((tl0, tr0, tr1, tl1), ((0.0, v0), (1.0, v0), (1.0, v1), (0.0, v1))),
                ((tr0, br0, br1, tr1), ((1.0, v0), (1.0, v0), (1.0, v1), (1.0, v1))),
                ((br0, bl0, bl1, br1), ((1.0, v0), (0.0, v0), (0.0, v1), (1.0, v1))),
                ((bl0, tl0, tl1, bl1), ((0.0, v0), (0.0, v0), (0.0, v1), (0.0, v1))),
            )
            for verts, uvs in quad_specs:
                face = bm.faces.new(verts)
                for loop, uv in zip(face.loops, uvs):
                    loop[uv_layer].uv = uv

        # Cap start (v=0) and end (v=1).
        bl0, br0, tr0, tl0 = rings[0]
        start_cap = bm.faces.new((bl0, br0, tr0, tl0))
        for loop, uv in zip(start_cap.loops, ((0.0, 0.0), (1.0, 0.0), (1.0, 0.0), (0.0, 0.0))):
            loop[uv_layer].uv = uv

        bln, brn, trn, tln = rings[-1]
        end_cap = bm.faces.new((tln, trn, brn, bln))
        for loop, uv in zip(end_cap.loops, ((0.0, 1.0), (1.0, 1.0), (1.0, 1.0), (0.0, 1.0))):
            loop[uv_layer].uv = uv

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    obj = bpy.data.objects.new(name, mesh)
    vn_scene.link_object(obj, collection)

    eff_bevel = min(float(bevel_width), min(w, th) * 0.42) if bevel_width > 0.0 else 0.0
    vn_bevel.finalize_toy_mesh(
        obj,
        bevel_width=eff_bevel,
        bevel_segments=2,
        apply=True,
    )
    return obj


# ------------------------------------------------------------ boolean relief


def make_boolean_relief(
    target: bpy.types.Object,
    cutter: bpy.types.Object,
    operation: str = "UNION",
    apply: bool = True,
    remove_cutter: bool = False,
) -> bpy.types.Object:
    """Apply a clean exact-solver Boolean relief (e.g. raised dots or window recesses).

    Args:
        target: Mesh object to modify.
        cutter: Mesh object used as the boolean operand.
        operation: `'UNION'`, `'DIFFERENCE'`, or `'INTERSECT'`.
        apply: Apply the modifier immediately and refresh outside/weighted normals.
        remove_cutter: Optionally remove `cutter` (and its unused mesh) after applying.
    """
    vn_bevel._ensure_mesh_object(target)
    vn_bevel._ensure_mesh_object(cutter)

    op = operation.upper()
    if op not in {"UNION", "DIFFERENCE", "INTERSECT"}:
        raise ValueError(f"Unsupported boolean operation {operation!r}")

    mod = target.modifiers.new(name=f"VN_Bool_{op}", type="BOOLEAN")
    mod.operation = op
    if hasattr(mod, "operand_type"):
        mod.operand_type = "OBJECT"
    mod.object = cutter

    if hasattr(mod, "solver"):
        valid_solvers = {
            item.identifier for item in mod.bl_rna.properties["solver"].enum_items
        }
        for preferred in ("EXACT", "MANIFOLD", "FLOAT"):
            if preferred in valid_solvers:
                mod.solver = preferred
                break

    if apply:
        vn_bevel._apply_modifier(target, mod.name)
        vn_bevel.apply_weighted_normals(
            target,
            weight=50,
            keep_sharp=True,
            face_influence=True,
            apply=True,
        )
        if remove_cutter:
            cutter_mesh = cutter.data
            bpy.data.objects.remove(cutter, do_unlink=True)
            if cutter_mesh is not None and cutter_mesh.users == 0:
                bpy.data.meshes.remove(cutter_mesh)

    return target
