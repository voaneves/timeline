"""Top-down static shadow map baker for Q1 (PLAN-3D §5.1, §5.5, §6.3 / T2.3b).

On mobile tier Q1 (`quality.level === 1`), real-time directional shadow maps are replaced
for static world geometry by a lossless 8-bit grayscale (R8) top-down shadow texture
projected in engine world XZ (`world_x = blender_x`, `world_z = -blender_y`,
`world_y = blender_z`).

Pipeline:
  1. Compute engine-space XZ bounding box `(min_x, max_x, min_z, max_z)` across static
     visual meshes (excluding colliders, preview rigs, and dynamic/kinematic rigid bodies),
     expanded by `padding` meters.
  2. Build a world-space `BVHTree` of all static shadow-casting visual meshes (plus an
     optional Cycles orthographic top-down shadow pass).
  3. For each texel `(ix, iz)` in the `resolution x resolution` grid:
       - `u = (ix + 0.5) / resolution` -> `world_x = min_x + u * (max_x - min_x)`
       - `v_row = (iz + 0.5) / resolution` -> `world_z = min_z + v_row * (max_z - min_z)`
     Cast a downward probe in Blender (+Z up) at `(blender_x = world_x, blender_y = -world_z)`
     to find the static receiver surface height (or ground plane `y = 0`), then cast a
     9-sample soft penumbra kernel toward the era sun direction (`sun_direction` in engine
     +Y-up coordinates, default matching `Lighting.js` day preset `(-0.3712, 0.7289, 0.5752)`).
  4. Encode a lossless 8-bit grayscale (`color_type = 0`, R8) PNG using pure Python
     `zlib`/`struct` (`0 = full shadow, 255 = full sun`) and write bounds metadata JSON
     `{"minX", "maxX", "minZ", "maxZ", "sunDir", "resolution", "bytes", ...}`.
"""

from __future__ import annotations

import json
import math
import os
import struct
import time
import zlib
from typing import Iterable

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

try:
    from . import vn_collide, vn_scene
except ImportError:  # pragma: no cover - direct sys.path execution
    import vn_collide
    import vn_scene


COLLIDER_PREFIXES = getattr(
    vn_collide,
    "COLLIDER_PREFIXES",
    ("cuboid", "trimesh", "hull", "tube", "cylinder", "ball"),
)

# Default sun direction in engine (+Y up) coordinates, matching `Lighting.js` at
# `DayCycles` default progress = 0.05 (`phi=0.63, theta=0.72, phiAmp=0.62, thetaAmp=1.25`).
DEFAULT_ENGINE_SUN_DIRECTION = (-0.09585, 0.875845, -0.472979)


def _is_collider_object(obj: bpy.types.Object) -> bool:
    return obj.name.lower().startswith(COLLIDER_PREFIXES)


def _is_preview_object(obj: bpy.types.Object) -> bool:
    return any(col.name.startswith("_Preview") for col in obj.users_collection)


def _is_dynamic_or_kinematic(obj: bpy.types.Object) -> bool:
    """Return True if `obj` or any ancestor is a dynamic or kinematic rigid body."""
    cur: bpy.types.Object | None = obj
    while cur is not None:
        lower = cur.name.lower()
        if "physicaldynamic" in lower or "physicalkinematic" in lower:
            return True
        if lower.startswith(("crate", "movingplatform")):
            return True
        cur = cur.parent
    return False


def _resolve_static_meshes(
    objects: bpy.types.Object | Iterable[bpy.types.Object | str] | None,
    include_dynamic: bool = False,
) -> list[bpy.types.Object]:
    """Return deduplicated static visual mesh objects to include in the shadow bake."""
    if objects is None:
        candidates = [
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and obj.data is not None
            and not obj.hide_render
            and not _is_collider_object(obj)
            and not _is_preview_object(obj)
        ]
    else:
        if isinstance(objects, (bpy.types.Object, str)):
            raw_items = [objects]
        else:
            raw_items = list(objects)

        candidates = []
        for item in raw_items:
            obj = bpy.data.objects.get(item) if isinstance(item, str) else item
            if obj is None:
                raise KeyError(f"Object not found for top-down shadow bake: {item!r}")
            if obj.type != "MESH" or obj.data is None or _is_collider_object(obj):
                continue
            if obj not in candidates:
                candidates.append(obj)

    if include_dynamic:
        return candidates
    return [obj for obj in candidates if not _is_dynamic_or_kinematic(obj)]


# --------------------------------------------------------------- pure R8 PNG I/O


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type)
    crc = zlib.crc32(data, crc) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def encode_r8_png(rows_u8: np.ndarray) -> bytes:
    """Encode a 2D `uint8` array `(height, width)` as a lossless 8-bit grayscale PNG."""
    arr = np.asarray(rows_u8, dtype=np.uint8)
    if arr.ndim != 2:
        raise ValueError(f"Expected 2D uint8 array for encode_r8_png, got shape {arr.shape}")

    height, width = arr.shape
    # Filter type 1 (Sub) or 0 (None): test both and pick smaller compressed stream
    raw_none = bytearray((width + 1) * height)
    stride = width + 1
    for y in range(height):
        off = y * stride
        raw_none[off] = 0
        raw_none[off + 1 : off + stride] = arr[y].tobytes()

    # Also build Paeth / Up filtered stream for high compression on axis-aligned shadows
    raw_up = bytearray((width + 1) * height)
    for y in range(height):
        off = y * stride
        raw_up[off] = 2  # Up filter
        if y == 0:
            raw_up[off + 1 : off + stride] = arr[y].tobytes()
        else:
            diff = (arr[y].astype(np.int16) - arr[y - 1].astype(np.int16)) & 0xFF
            raw_up[off + 1 : off + stride] = diff.astype(np.uint8).tobytes()

    comp_none = zlib.compress(bytes(raw_none), level=9)
    comp_up = zlib.compress(bytes(raw_up), level=9)
    idat_payload = comp_up if len(comp_up) <= len(comp_none) else comp_none

    signature = b"\x89PNG\r\n\x1a\n"
    # color_type = 0 (grayscale), bit_depth = 8
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return (
        signature
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", idat_payload)
        + _png_chunk(b"IEND", b"")
    )


# --------------------------------------------------------------- bounds & BVH


def compute_engine_xz_bounds(
    objects: list[bpy.types.Object],
    padding: float = 2.0,
) -> tuple[float, float, float, float, float, float]:
    """Return `(min_x, max_x, min_z, max_z, min_y, max_y)` in engine (+Y up) coordinates."""
    min_x = math.inf
    max_x = -math.inf
    min_z = math.inf
    max_z = -math.inf
    min_y = math.inf
    max_y = -math.inf

    for obj in objects:
        for corner in obj.bound_box:
            world_b = obj.matrix_world @ Vector(corner)
            ex, ey, ez = vn_scene.to_engine(world_b.x, world_b.y, world_b.z)
            min_x = min(min_x, ex)
            max_x = max(max_x, ex)
            min_y = min(min_y, ey)
            max_y = max(max_y, ey)
            min_z = min(min_z, ez)
            max_z = max(max_z, ez)

    if not math.isfinite(min_x):
        return (-10.0, 10.0, -10.0, 10.0, 0.0, 5.0)

    pad = max(0.0, float(padding))
    return (
        round(min_x - pad, 4),
        round(max_x + pad, 4),
        round(min_z - pad, 4),
        round(max_z + pad, 4),
        round(min_y, 4),
        round(max_y, 4),
    )


def _build_world_bvh(objects: list[bpy.types.Object]) -> BVHTree:
    """Build a single Blender-world-space BVHTree across all target static meshes."""
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


def _normalize_engine_sun_direction(
    sun_direction: Iterable[float] | None,
) -> tuple[Vector, Vector]:
    """Return `(engine_sun_dir, blender_sun_dir)` unit vectors pointing TOWARD the sun.

    Accepts engine-space `(x, y, z)` (+Y up). If `y < 0` (a light-ray propagation vector
    pointing downward from sun to ground), it is negated so the vector always points
    upward toward the sun (`engine_y > 0`, `blender_z > 0`).
    """
    raw = tuple(float(c) for c in (sun_direction or DEFAULT_ENGINE_SUN_DIRECTION))
    if len(raw) != 3:
        raise ValueError(f"Expected 3-tuple for sun_direction, got {raw!r}")

    ex, ey, ez = raw
    if abs(ey) < 1e-4 and abs(ez) > 1e-4:
        # Caller passed a Blender-space tuple where Z is up and Y is negative:
        # convert or lift Y so sun is above the horizon.
        ey = abs(ez)

    eng = Vector((ex, ey, ez))
    if eng.length < 1e-6:
        eng = Vector(DEFAULT_ENGINE_SUN_DIRECTION)
    eng.normalize()
    if eng.y < 0.0:
        eng = -eng

    # Ensure the sun elevation is at least ~15 degrees above horizon so top-down
    # shadows remain bounded within the diorama footprint.
    if eng.y < 0.25:
        eng.y = 0.25
        eng.normalize()

    bx, by, bz = vn_scene.to_blender(eng.x, eng.y, eng.z)
    bl = Vector((bx, by, bz)).normalized()
    return eng, bl


def _build_sun_cone_rays(
    blender_sun_dir: Vector,
    softness_deg: float = 1.5,
    samples: int = 9,
) -> list[tuple[Vector, float]]:
    """Build deterministic multi-sample sun rays around `blender_sun_dir` for soft penumbra."""
    s_dir = blender_sun_dir.normalized()
    count = max(1, int(samples))
    if count == 1 or softness_deg <= 0.0:
        return [(s_dir, 1.0)]

    up = Vector((0.0, 0.0, 1.0)) if abs(s_dir.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    t_vec = s_dir.cross(up).normalized()
    b_vec = s_dir.cross(t_vec).normalized()
    spread = math.tan(math.radians(max(0.1, float(softness_deg))))

    rays: list[tuple[Vector, float]] = [(s_dir, 1.5)]
    ring_count = count - 1
    golden_angle = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(ring_count):
        r = spread * math.sqrt((i + 0.5) / ring_count)
        theta = i * golden_angle
        offset = t_vec * (r * math.cos(theta)) + b_vec * (r * math.sin(theta))
        ray = (s_dir + offset).normalized()
        if ray.z > 0.05:
            rays.append((ray, 1.0))
    return rays


# --------------------------------------------------------------- main baker


def bake_topdown_shadow(
    objects: bpy.types.Object | Iterable[bpy.types.Object | str] | None = None,
    sun_direction: Iterable[float] | None = DEFAULT_ENGINE_SUN_DIRECTION,
    resolution: int = 1024,
    bounds: tuple[float, float, float, float] | None = None,
    padding: float = 2.0,
    softness: float = 1.5,
    samples: int = 9,
    receiver_max_height: float = 2.6,
    out_png_path: str | None = None,
    out_meta_path: str | None = None,
) -> dict:
    """Bake a top-down static shadow map (lossless 8-bit R8 PNG + bounds metadata JSON).

    Coordinate mapping (matches Three.js `positionWorld.xz` with `texture.flipY = false`):
      - `u = (world_x - minX) / (maxX - minX)` -> image column `ix = int(u * resolution)`
      - `v = (world_z - minZ) / (maxZ - minZ)` -> image row `iz = int(v * resolution)`
      - In Blender (+Z up): `blender_x = world_x`, `blender_y = -world_z`, `blender_z = world_y`.

    At each `(world_x, world_z)` column:
      1. We find the static ground/receiver height `h_recv` (clamped to `<= receiver_max_height`
         so high overhead blocks at `y >= 3.2 m` cast their shadow onto the floor below them
         rather than sampling their own roof!).
      2. We cast `samples` sun rays from `(world_x, h_recv + eps, world_z)` toward
         `sun_direction` against the static scene `BVHTree`.
      3. We apply a small separable 3x3 binomial smoothing pass for clean anti-aliased
         penumbra edges (`0 = full shadow, 255 = full sun`).
    """
    t0 = time.time()
    res = max(16, int(resolution))
    static_meshes = _resolve_static_meshes(objects, include_dynamic=False)
    if not static_meshes:
        raise RuntimeError("No static visual meshes found for bake_topdown_shadow")

    bpy.context.view_layer.update()

    auto_min_x, auto_max_x, auto_min_z, auto_max_z, min_y, max_y = compute_engine_xz_bounds(
        static_meshes, padding=padding
    )
    if bounds is not None:
        min_x, max_x, min_z, max_z = (float(b) for b in bounds)
    else:
        min_x, max_x, min_z, max_z = auto_min_x, auto_max_x, auto_min_z, auto_max_z

    span_x = max(max_x - min_x, 1e-4)
    span_z = max(max_z - min_z, 1e-4)

    eng_sun, bl_sun = _normalize_engine_sun_direction(sun_direction)
    sun_rays = _build_sun_cone_rays(bl_sun, softness_deg=float(softness), samples=int(samples))
    total_weight = sum(w for _, w in sun_rays)

    bvh = _build_world_bvh(static_meshes)
    down_dir = Vector((0.0, 0.0, -1.0))
    probe_top_z = min(float(receiver_max_height), max_y + 1.0)
    ray_max_dist = max(span_x, span_z, max_y - min_y) * 2.5
    eps = 0.015

    grid = np.full((res, res), 1.0, dtype=np.float32)

    for iz in range(res):
        v = (iz + 0.5) / res
        world_z = min_z + v * span_z
        bl_y = -world_z

        for ix in range(res):
            u = (ix + 0.5) / res
            world_x = min_x + u * span_x
            bl_x = world_x

            # Find static receiver height below `probe_top_z` (excludes high floating blocks
            # at y >= 3.2 m and high ribbon geometry if probe_top_z < their height, or falls
            # back to y = 0 ground plane).
            probe_origin = Vector((bl_x, bl_y, probe_top_z))
            hit_loc, hit_norm, _hit_idx, _hit_dist = bvh.ray_cast(
                probe_origin, down_dir, probe_top_z - min_y + 2.0
            )
            if hit_loc is not None:
                recv_z = float(hit_loc.z)
                n_offset = (
                    hit_norm.normalized() * eps
                    if (hit_norm is not None and hit_norm.z > 0.1)
                    else Vector((0.0, 0.0, eps))
                )
                recv_origin = Vector((bl_x, bl_y, recv_z)) + n_offset
            else:
                recv_z = 0.0
                recv_origin = Vector((bl_x, bl_y, eps))

            floor_origin = Vector((bl_x, bl_y, eps))
            check_floor_separately = recv_z > 0.08

            lit_acc = 0.0
            for ray_dir, weight in sun_rays:
                s_loc, _s_norm, _s_idx, _s_dist = bvh.ray_cast(
                    recv_origin, ray_dir, ray_max_dist
                )
                is_lit = s_loc is None
                if is_lit and check_floor_separately:
                    f_loc, _f_norm, _f_idx, _f_dist = bvh.ray_cast(
                        floor_origin, ray_dir, ray_max_dist
                    )
                    if f_loc is not None:
                        is_lit = False
                if is_lit:
                    lit_acc += weight

            grid[iz, ix] = lit_acc / total_weight

    # Gentle 3x3 separable [1, 2, 1] / 4 penumbra smoothing so 1024^2 texel steps look soft
    if softness > 0.0 and res >= 64:
        padded = np.pad(grid, 1, mode="edge")
        horiz = 0.25 * padded[:, :-2] + 0.5 * padded[:, 1:-1] + 0.25 * padded[:, 2:]
        grid = 0.25 * horiz[:-2, :] + 0.5 * horiz[1:-1, :] + 0.25 * horiz[2:, :]

    rows_u8 = np.clip(np.rint(grid * 255.0), 0, 255).astype(np.uint8)
    png_bytes = encode_r8_png(rows_u8)

    if out_png_path:
        abs_png = os.path.abspath(out_png_path)
        os.makedirs(os.path.dirname(abs_png), exist_ok=True)
        with open(abs_png, "wb") as fh:
            fh.write(png_bytes)
    else:
        abs_png = None

    shadowed_pixels = int(np.count_nonzero(rows_u8 < 128))
    penumbra_pixels = int(np.count_nonzero((rows_u8 >= 32) & (rows_u8 <= 224)))
    lit_pixels = int(np.count_nonzero(rows_u8 == 255))
    total_pixels = int(res * res)

    elapsed = round(time.time() - t0, 3)
    meta = {
        "minX": round(min_x, 4),
        "maxX": round(max_x, 4),
        "minZ": round(min_z, 4),
        "maxZ": round(max_z, 4),
        "spanX": round(span_x, 4),
        "spanZ": round(span_z, 4),
        "sunDir": [round(float(eng_sun.x), 6), round(float(eng_sun.y), 6), round(float(eng_sun.z), 6)],
        "resolution": res,
        "bytes": len(png_bytes),
        "colorType": 0,
        "bitDepth": 8,
        "flipY": False,
        "meshes": [obj.name for obj in static_meshes],
        "stats": {
            "shadowedPixels": shadowed_pixels,
            "penumbraPixels": penumbra_pixels,
            "litPixels": lit_pixels,
            "totalPixels": total_pixels,
            "shadowFraction": round(shadowed_pixels / max(total_pixels, 1), 6),
            "minByte": int(rows_u8.min()),
            "maxByte": int(rows_u8.max()),
            "meanByte": round(float(rows_u8.mean()), 2),
        },
        "elapsed_s": elapsed,
    }

    if out_meta_path:
        abs_meta = os.path.abspath(out_meta_path)
        os.makedirs(os.path.dirname(abs_meta), exist_ok=True)
        with open(abs_meta, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=2)

    print(
        f"[vn_bake_shadow] {res}x{res} R8 PNG ({len(png_bytes)} B) in {elapsed}s | "
        f"bounds XZ=[{min_x:.2f}..{max_x:.2f}, {min_z:.2f}..{max_z:.2f}] | "
        f"shadowed={shadowed_pixels} ({meta['stats']['shadowFraction']*100:.2f}%)"
    )
    return {
        **meta,
        "png_path": abs_png,
        "meta_path": os.path.abspath(out_meta_path) if out_meta_path else None,
        "pixels": rows_u8,
    }
