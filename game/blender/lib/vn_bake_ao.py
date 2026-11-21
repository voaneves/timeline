"""Vertex Ambient Occlusion (COLOR_0) baker for Blender 5.x (PLAN-3D §5.5 / T2.3a).

Pipeline:
  1. `subdivide_large_faces(obj, min_area=1.0, max_cuts=3)` locally subdivides large or
     elongated faces so vertex colors have sufficient vertex density to capture contact
     occlusion at corners, steps, ramps, and object-floor intersections.
  2. `ensure_color_attribute(obj, name="COLOR_0", default=(1.0, 1.0, 1.0, 1.0))` creates
     or activates the `COLOR_0` loop-corner (`CORNER`) float color attribute and marks it
     as the active render color target.
  3. `bake_vertex_ao(objects, distance=0.6, samples=64, ...)` bakes contact AO into
     `COLOR_0` using headless Cycles (`bake(type='AO', target='VERTEX_COLORS')`) combined
     with a deterministic world-space `BVHTree` hemisphere + contact-crease raycast so
     concave corners and object-floor contacts always receive crisp occlusion while open
     surfaces remain at `1.0`.
"""

from __future__ import annotations

import math
import time
from typing import Iterable

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

try:
    from . import vn_collide
except ImportError:  # pragma: no cover - direct sys.path execution
    import vn_collide


COLLIDER_PREFIXES = getattr(
    vn_collide,
    "COLLIDER_PREFIXES",
    ("cuboid", "trimesh", "hull", "tube", "cylinder", "ball"),
)


def _is_collider_object(obj: bpy.types.Object) -> bool:
    return obj.name.lower().startswith(COLLIDER_PREFIXES)


def _is_preview_object(obj: bpy.types.Object) -> bool:
    return any(col.name.startswith("_Preview") for col in obj.users_collection)


def _resolve_target_meshes(
    objects: bpy.types.Object | Iterable[bpy.types.Object | str] | None,
) -> list[bpy.types.Object]:
    """Return deduplicated visual mesh objects to bake."""
    if objects is None:
        return [
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and obj.data is not None
            and not obj.hide_render
            and not _is_collider_object(obj)
            and not _is_preview_object(obj)
        ]

    if isinstance(objects, (bpy.types.Object, str)):
        raw_items = [objects]
    else:
        raw_items = list(objects)

    resolved: list[bpy.types.Object] = []
    for item in raw_items:
        obj = bpy.data.objects.get(item) if isinstance(item, str) else item
        if obj is None:
            raise KeyError(f"Object not found for AO bake: {item!r}")
        if obj.type != "MESH" or obj.data is None or _is_collider_object(obj):
            continue
        if obj not in resolved:
            resolved.append(obj)
    return resolved


# ------------------------------------------------------------ mesh subdivision


def subdivide_large_faces(
    obj: bpy.types.Object,
    min_area: float = 1.0,
    max_cuts: int = 3,
) -> dict:
    """Locally subdivide faces on `obj` with world area >= `min_area` (m²).

    Also splits long edges on large/elongated faces so vertex spacing along both axes of
    rectangular slabs (e.g. an 8 m x 30 m floor or 2.4 m x 0.6 m step tread) is fine
    enough to resolve contact AO within the 0.6 m occlusion radius.
    """
    if obj is None or obj.type != "MESH" or obj.data is None:
        raise TypeError(f"Expected a MESH object for subdivide_large_faces, got {obj!r}")

    mesh = obj.data
    before_faces = len(mesh.polygons)
    before_verts = len(mesh.vertices)

    area_limit = float(min_area)
    cuts_budget = int(max_cuts)
    if area_limit <= 0.0 or cuts_budget <= 0:
        return {
            "object": obj.name,
            "before_faces": before_faces,
            "after_faces": before_faces,
            "before_verts": before_verts,
            "after_verts": before_verts,
            "passes": 0,
        }

    # Target maximum edge length in meters so both square and elongated faces have
    # vertices within the contact AO falloff zone.
    max_edge_len = max(0.35, min(math.sqrt(area_limit) * 0.5, 0.65))
    max_passes = max(cuts_budget * 2, 1)

    sx, sy, sz = (abs(float(s)) for s in obj.matrix_world.to_scale())
    scale_vec = Vector((max(sx, 1e-6), max(sy, 1e-6), max(sz, 1e-6)))
    area_scale = max((sx * sy + sy * sz + sx * sz) / 3.0, 1e-6)

    def _edge_world_length(edge: bmesh.types.BMEdge) -> float:
        delta = edge.verts[1].co - edge.verts[0].co
        return Vector(
            (delta.x * scale_vec.x, delta.y * scale_vec.y, delta.z * scale_vec.z)
        ).length

    def _face_world_area(face: bmesh.types.BMFace) -> float:
        return face.calc_area() * area_scale

    bm = bmesh.new()
    bm.from_mesh(mesh)
    passes_run = 0

    try:
        for _ in range(max_passes):
            candidate_faces = [
                f
                for f in bm.faces
                if _face_world_area(f) >= area_limit
                or (
                    _face_world_area(f) >= area_limit * 0.25
                    and max((_edge_world_length(e) for e in f.edges), default=0.0)
                    > max_edge_len
                )
            ]
            if not candidate_faces:
                break

            edges_to_split = list(
                {
                    e
                    for f in candidate_faces
                    for e in f.edges
                    if _edge_world_length(e) > max_edge_len
                }
            )
            if not edges_to_split:
                edges_to_split = list({e for f in candidate_faces for e in f.edges})
            if not edges_to_split:
                break

            bmesh.ops.subdivide_edges(
                bm,
                edges=edges_to_split,
                cuts=1,
                use_grid_fill=True,
            )
            passes_run += 1

        # Triangulate any N-gons created along T-junction boundaries between big and small faces.
        ngons = [f for f in bm.faces if len(f.verts) > 4]
        if ngons:
            bmesh.ops.triangulate(bm, faces=ngons)

        bm.normal_update()
        bm.to_mesh(mesh)
    finally:
        bm.free()

    mesh.update()
    return {
        "object": obj.name,
        "before_faces": before_faces,
        "after_faces": len(mesh.polygons),
        "before_verts": before_verts,
        "after_verts": len(mesh.vertices),
        "passes": passes_run,
    }


# ------------------------------------------------------------ color attributes


def ensure_color_attribute(
    obj: bpy.types.Object,
    name: str = "COLOR_0",
    default: tuple[float, float, float, float] = (1.0, 1.0, 1.0, 1.0),
    domain: str = "CORNER",
    data_type: str = "FLOAT_COLOR",
    reset: bool = True,
) -> bpy.types.Attribute:
    """Create or activate vertex/corner color attribute `name` (`COLOR_0` by default)."""
    if obj is None or obj.type != "MESH" or obj.data is None:
        raise TypeError(f"Expected a MESH object for ensure_color_attribute, got {obj!r}")

    mesh = obj.data
    color_attrs = mesh.color_attributes
    attr = color_attrs.get(name)

    if attr is not None and (attr.domain != domain or attr.data_type != data_type):
        color_attrs.remove(attr)
        attr = None

    created = False
    if attr is None:
        attr = color_attrs.new(name=name, type=data_type, domain=domain)
        created = True

    color_attrs.active_color = attr
    for idx, candidate in enumerate(color_attrs):
        if candidate.name == name:
            color_attrs.render_color_index = idx
            color_attrs.active_color_index = idx
            break

    if created or reset:
        rgba = tuple(float(c) for c in default)
        count = len(attr.data)
        if count > 0:
            flat = list(rgba) * count
            attr.data.foreach_set("color", flat)

    return attr


# --------------------------------------------------------- raycast AO fallback


def _fibonacci_hemisphere_dirs(samples: int) -> list[tuple[Vector, float]]:
    """Build deterministic local hemisphere directions (+Z up) with grazing-boosted weights."""
    count = max(int(samples), 8)
    golden_angle = math.pi * (3.0 - math.sqrt(5.0))
    dirs: list[tuple[Vector, float]] = []

    for i in range(count):
        # Sample z = sin(elevation) from 0.12 (~7 deg above tangent plane) to 0.995
        t = (i + 0.5) / count
        z = 0.12 + 0.875 * t
        r = math.sqrt(max(0.0, 1.0 - z * z))
        phi = golden_angle * i
        local_dir = Vector((r * math.cos(phi), r * math.sin(phi), z)).normalized()
        # Boost low-to-mid elevation angles so nearby vertical walls/steps produce strong
        # floor contact occlusion while open flat faces remain at 1.0.
        weight = 1.35 - 0.55 * z
        dirs.append((local_dir, weight))

    return dirs


def _tangent_frame(normal: Vector) -> tuple[Vector, Vector, Vector]:
    n = normal.normalized()
    if n.length < 1e-6:
        n = Vector((0.0, 0.0, 1.0))
    up = Vector((0.0, 0.0, 1.0)) if abs(n.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    tangent = n.cross(up).normalized()
    bitangent = n.cross(tangent).normalized()
    return tangent, bitangent, n


def _build_world_bvh(objects: list[bpy.types.Object]) -> BVHTree:
    """Build a single world-space BVHTree across all target visual meshes."""
    bm_world = bmesh.new()
    try:
        for obj in objects:
            bm_part = bmesh.new()
            bm_part.from_mesh(obj.data)
            bm_part.transform(obj.matrix_world)
            bmesh.ops.triangulate(bm_part, faces=bm_part.faces)

            vert_map = [bm_world.verts.new(v.co) for v in bm_part.verts]
            for face in bm_part.faces:
                try:
                    bm_world.faces.new([vert_map[v.index] for v in face.verts])
                except ValueError:
                    pass
            bm_part.free()

        bm_world.normal_update()
        return BVHTree.FromBMesh(bm_world)
    finally:
        bm_world.free()


def _compute_raycast_ao(
    objects: list[bpy.types.Object],
    distance: float,
    samples: int,
) -> dict[str, list[float]]:
    """Compute per-loop-corner AO in [0, 1] using a world-space BVHTree hemisphere raycast."""
    bvh = _build_world_bvh(objects)
    local_dirs = _fibonacci_hemisphere_dirs(samples)
    max_dist = max(float(distance), 1e-3)
    eps = min(1.5e-3, max_dist * 0.005)

    results: dict[str, list[float]] = {}

    for obj in objects:
        mesh = obj.data
        mat_w: Matrix = obj.matrix_world
        rot_w = mat_w.to_3x3().inverted_safe().transposed()

        world_verts = [mat_w @ v.co for v in mesh.vertices]
        loop_ao = [1.0] * len(mesh.loops)
        cache: dict[tuple[int, int, int, int], float] = {}

        for poly in mesh.polygons:
            poly_n = (rot_w @ poly.normal).normalized()
            if poly_n.length < 1e-6:
                poly_n = Vector((0.0, 0.0, 1.0))

            # Skip downward bottom caps buried flush on the ground plane (z <= 0)
            n_key = (
                int(round(poly_n.x * 50)),
                int(round(poly_n.y * 50)),
                int(round(poly_n.z * 50)),
            )

            for li in poly.loop_indices:
                vi = mesh.loops[li].vertex_index
                cache_key = (vi, n_key[0], n_key[1], n_key[2])
                cached = cache.get(cache_key)
                if cached is not None:
                    loop_ao[li] = cached
                    continue

                pos_w = world_verts[vi]
                t_vec, b_vec, n_vec = _tangent_frame(poly_n)
                origin = pos_w + n_vec * eps

                occ_sum = 0.0
                weight_sum = 0.0
                for ldir, weight in local_dirs:
                    ray_dir = (
                        t_vec * ldir.x + b_vec * ldir.y + n_vec * ldir.z
                    ).normalized()
                    hit_loc, hit_norm, _hit_idx, hit_dist = bvh.ray_cast(
                        origin, ray_dir, max_dist
                    )
                    weight_sum += weight
                    if hit_loc is not None and hit_dist is not None:
                        # Ignore coplanar self-hits on the same plane
                        if (
                            hit_norm is not None
                            and hit_norm.dot(n_vec) > 0.98
                            and abs((hit_loc - pos_w).dot(n_vec)) < 5e-3
                        ):
                            continue
                        falloff = max(0.0, 1.0 - (hit_dist / max_dist))
                        occ_sum += weight * (falloff ** 0.75)

                ao_val = max(0.0, min(1.0, 1.0 - (occ_sum / max(weight_sum, 1e-6))))
                cache[cache_key] = ao_val
                loop_ao[li] = ao_val

        results[obj.name] = loop_ao

    return results


# --------------------------------------------------------------- Cycles AO bake


def _run_cycles_vertex_ao(
    objects: list[bpy.types.Object],
    distance: float,
    samples: int,
) -> bool:
    """Configure headless Cycles and bake AO directly into active `VERTEX_COLORS`."""
    scene = bpy.context.scene
    view_layer = bpy.context.view_layer

    prev_engine = scene.render.engine
    prev_world = scene.world
    prev_selected = [o for o in scene.objects if o.select_get()]
    prev_active = view_layer.objects.active
    prev_bake_target = getattr(scene.render.bake, "target", "IMAGE_TEXTURES")
    prev_cycles_device = getattr(scene.cycles, "device", "CPU") if hasattr(scene, "cycles") else "CPU"
    prev_cycles_samples = getattr(scene.cycles, "samples", 64) if hasattr(scene, "cycles") else 64

    prev_hide_render: list[tuple[bpy.types.Object, bool]] = []
    prev_hide_select: list[tuple[bpy.types.Object, bool]] = []
    temp_world = None

    try:
        # Hide collider meshes from Cycles raytracing so colliders never occlude visuals.
        for obj in scene.objects:
            if obj.type == "MESH" and (_is_collider_object(obj) or _is_preview_object(obj)):
                if not obj.hide_render:
                    prev_hide_render.append((obj, False))
                    obj.hide_render = True

        scene.render.engine = "CYCLES"
        if hasattr(scene, "cycles"):
            scene.cycles.device = "CPU"
            scene.cycles.samples = max(int(samples), 1)

        if scene.world is None:
            temp_world = bpy.data.worlds.new("_vn_ao_bake_world")
            scene.world = temp_world

        prev_ao_dist = getattr(scene.world.light_settings, "distance", 1.0)
        prev_ao_factor = getattr(scene.world.light_settings, "ao_factor", 1.0)
        scene.world.light_settings.distance = float(distance)
        scene.world.light_settings.ao_factor = 1.0

        scene.render.bake.target = "VERTEX_COLORS"

        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            if obj.hide_select:
                prev_hide_select.append((obj, True))
                obj.hide_select = False
            if obj.hide_render:
                prev_hide_render.append((obj, True))
                obj.hide_render = False
            obj.select_set(True)

        view_layer.objects.active = objects[0]
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")

        if temp_world is None and scene.world is not None:
            scene.world.light_settings.distance = prev_ao_dist
            scene.world.light_settings.ao_factor = prev_ao_factor
        return True
    finally:
        scene.render.engine = prev_engine
        if hasattr(scene, "cycles"):
            scene.cycles.device = prev_cycles_device
            scene.cycles.samples = prev_cycles_samples
        scene.render.bake.target = prev_bake_target
        scene.world = prev_world
        if temp_world is not None and temp_world.name in bpy.data.worlds:
            bpy.data.worlds.remove(temp_world)

        for obj, prev_hr in prev_hide_render:
            try:
                obj.hide_render = prev_hr
            except ReferenceError:
                pass
        for obj, prev_hs in prev_hide_select:
            try:
                obj.hide_select = prev_hs
            except ReferenceError:
                pass

        bpy.ops.object.select_all(action="DESELECT")
        for obj in prev_selected:
            try:
                obj.select_set(True)
            except ReferenceError:
                pass
        try:
            view_layer.objects.active = prev_active
        except ReferenceError:
            pass


# ------------------------------------------------------------------ main entry


def bake_vertex_ao(
    objects: bpy.types.Object | Iterable[bpy.types.Object | str] | None = None,
    distance: float = 0.6,
    samples: int = 64,
    subdivide_area: float = 1.0,
    max_cuts: int = 3,
    attribute_name: str = "COLOR_0",
    strength: float = 1.0,
    min_ao: float = 0.25,
    mode: str = "CYCLES_OR_RAYCAST",
) -> dict:
    """Bake contact Ambient Occlusion into vertex color attribute `attribute_name` (`COLOR_0`).

    Steps:
      1. Subdivide large faces (`area >= subdivide_area`) on each target visual mesh.
      2. Ensure `COLOR_0` loop-corner float color attribute is present and active.
      3. Run Cycles vertex-color AO bake (`distance`, `samples`) and/or `BVHTree`
         hemisphere raycast AO (`mode='CYCLES_OR_RAYCAST'` combines both so concave corners
         and object-floor contacts always have crisp, deterministic contact occlusion).
      4. Remap raw AO `[0, 1]` with `strength` and `min_ao` into `(ao, ao, ao, 1.0)`.
    """
    t0 = time.time()
    target_objs = _resolve_target_meshes(objects)
    if not target_objs:
        return {
            "objects": 0,
            "attribute": attribute_name,
            "distance": float(distance),
            "samples": int(samples),
            "min_ao": 1.0,
            "max_ao": 1.0,
            "mean_ao": 1.0,
            "per_object": {},
            "elapsed_s": 0.0,
        }

    subdiv_stats = []
    if subdivide_area is not None and float(subdivide_area) > 0.0 and int(max_cuts) > 0:
        for obj in target_objs:
            subdiv_stats.append(
                subdivide_large_faces(
                    obj, min_area=float(subdivide_area), max_cuts=int(max_cuts)
                )
            )

    for obj in target_objs:
        ensure_color_attribute(
            obj,
            name=attribute_name,
            default=(1.0, 1.0, 1.0, 1.0),
            domain="CORNER",
            data_type="FLOAT_COLOR",
            reset=True,
        )

    bpy.context.view_layer.update()

    mode_upper = (mode or "CYCLES_OR_RAYCAST").upper()
    use_cycles = mode_upper in ("CYCLES", "CYCLES_OR_RAYCAST", "HYBRID")
    use_raycast = mode_upper in ("RAYCAST", "CYCLES_OR_RAYCAST", "HYBRID")

    cycles_ok = False
    if use_cycles:
        cycles_ok = _run_cycles_vertex_ao(
            target_objs, distance=float(distance), samples=int(samples)
        )

    raycast_map: dict[str, list[float]] = {}
    if use_raycast or not cycles_ok:
        raycast_map = _compute_raycast_ao(
            target_objs, distance=float(distance), samples=min(int(samples), 64)
        )

    floor_val = max(0.0, min(1.0, float(min_ao)))
    power = max(0.1, float(strength))

    global_min = 1.0
    global_max = 0.0
    global_sum = 0.0
    global_count = 0
    per_object: dict[str, dict] = {}

    for obj in target_objs:
        attr = obj.data.color_attributes[attribute_name]
        n_items = len(attr.data)
        if n_items == 0:
            continue

        buf = [1.0] * (n_items * 4)
        if cycles_ok:
            attr.data.foreach_get("color", buf)

        rc_list = raycast_map.get(obj.name)
        obj_min = 1.0
        obj_max = 0.0
        obj_sum = 0.0

        for idx in range(n_items):
            raw_cycles = buf[idx * 4] if cycles_ok else 1.0
            raw_ray = rc_list[idx] if (rc_list is not None and idx < len(rc_list)) else 1.0

            if cycles_ok and rc_list is not None:
                raw = min(raw_cycles, raw_ray)
            elif cycles_ok:
                raw = raw_cycles
            else:
                raw = raw_ray

            raw = max(0.0, min(1.0, raw))
            shaped = raw ** power
            ao = floor_val + (1.0 - floor_val) * shaped
            ao = max(floor_val, min(1.0, ao))

            base = idx * 4
            buf[base] = ao
            buf[base + 1] = ao
            buf[base + 2] = ao
            buf[base + 3] = 1.0

            if ao < obj_min:
                obj_min = ao
            if ao > obj_max:
                obj_max = ao
            obj_sum += ao

        attr.data.foreach_set("color", buf)
        obj.data.update()

        global_min = min(global_min, obj_min)
        global_max = max(global_max, obj_max)
        global_sum += obj_sum
        global_count += n_items

        per_object[obj.name] = {
            "corners": n_items,
            "vertices": len(obj.data.vertices),
            "faces": len(obj.data.polygons),
            "min": round(obj_min, 4),
            "max": round(obj_max, 4),
            "mean": round(obj_sum / n_items, 4),
        }

    elapsed = round(time.time() - t0, 3)
    mean_ao = round(global_sum / max(global_count, 1), 4)
    summary = {
        "objects": len(target_objs),
        "attribute": attribute_name,
        "distance": float(distance),
        "samples": int(samples),
        "mode": mode_upper,
        "cycles_baked": cycles_ok,
        "raycast_baked": bool(raycast_map),
        "min_ao": round(global_min, 4),
        "max_ao": round(global_max, 4),
        "mean_ao": mean_ao,
        "corners": global_count,
        "subdivision": subdiv_stats,
        "per_object": per_object,
        "elapsed_s": elapsed,
    }
    print(
        f"[vn_bake_ao] baked {len(target_objs)} meshes ({global_count} corners) in {elapsed}s | "
        f"min={summary['min_ao']:.4f} mean={summary['mean_ao']:.4f} max={summary['max_ao']:.4f}"
    )
    return summary
