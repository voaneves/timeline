"""Scene initialization, collections, custom properties, and 3-view previews.

Conventions:
  - Metric units: 1 Blender unit = 1 m (system='METRIC', scale_length=1.0).
  - Blender uses +Z up; glTF export converts to +Y up (`export_yup=True`).
  - Ground pivot convention: static/prop origins sit on ground height (z=0 in Blender,
    y=0 in engine), while dynamic rigid-body roots are centered on the body origin.
"""

from __future__ import annotations

import math
import os
import tempfile
from typing import Iterable

import bpy
import numpy as np
from mathutils import Vector


# ------------------------------------------------------------------ coordinates


def to_blender(x: float, y: float, z: float) -> tuple[float, float, float]:
    """Convert engine (+Y up, -Z forward) coordinates to Blender (+Z up, +Y forward)."""
    return (float(x), -float(z), float(y))


def to_blender_vec(v: Iterable[float]) -> tuple[float, float, float]:
    x, y, z = v
    return to_blender(x, y, z)


def to_engine(x: float, y: float, z: float) -> tuple[float, float, float]:
    """Convert Blender (+Z up) coordinates to engine (+Y up, -Z forward)."""
    return (float(x), float(z), -float(y))


def to_engine_vec(v: Iterable[float]) -> tuple[float, float, float]:
    x, y, z = v
    return to_engine(x, y, z)


# ------------------------------------------------------------------ scene reset


def _clear_datablocks() -> None:
    """Remove all non-scene data blocks and purge orphans cleanly (Blender 5.x)."""
    active_scene = bpy.context.scene
    for scene in list(bpy.data.scenes):
        if scene != active_scene:
            bpy.data.scenes.remove(scene, do_unlink=True)

    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)

    collections_to_clear = (
        "meshes",
        "materials",
        "cameras",
        "lights",
        "actions",
        "images",
        "armatures",
        "curves",
        "metaballs",
        "lattices",
        "worlds",
        "node_groups",
        "textures",
        "lightprobes",
    )
    for attr in collections_to_clear:
        store = getattr(bpy.data, attr, None)
        if store is None:
            continue
        for datablock in list(store):
            try:
                store.remove(datablock, do_unlink=True)
            except TypeError:
                store.remove(datablock)
            except RuntimeError:
                pass

    if hasattr(bpy.data, "orphans_purge"):
        try:
            bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
        except TypeError:
            bpy.data.orphans_purge(do_recursive=True)
    else:
        try:
            bpy.ops.outliner.orphans_purge(
                do_local_ids=True, do_linked_ids=True, do_recursive=True
            )
        except Exception:
            pass


def reset_scene(name: str = "Scene") -> bpy.types.Scene:
    """Reset Blender to a clean, idempotent metric scene (1 unit = 1 m).

    Clears all objects, meshes, materials, collections, cameras, lights, actions,
    images, armatures, and orphan data blocks.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _clear_datablocks()

    scene = bpy.context.scene
    scene.name = name
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    if hasattr(scene.unit_settings, "length_unit"):
        scene.unit_settings.length_unit = "METERS"

    scene.render.fps = 24
    return scene


# ------------------------------------------------------------------ collections


def ensure_collection(
    name: str, parent: bpy.types.Collection | str | None = None
) -> bpy.types.Collection:
    """Return existing collection `name` or create it, linked under `parent`."""
    if isinstance(parent, str):
        parent_col = ensure_collection(parent)
    elif parent is None:
        parent_col = bpy.context.scene.collection
    else:
        parent_col = parent

    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)

    if col.name not in parent_col.children:
        parent_col.children.link(col)
    return col


def link_object(
    obj: bpy.types.Object,
    collection: bpy.types.Collection | str | None = None,
    exclusive: bool = True,
) -> bpy.types.Object:
    """Link `obj` to `collection` (name or Collection, defaults to scene root)."""
    if isinstance(collection, str):
        target_col = ensure_collection(collection)
    elif collection is None:
        target_col = bpy.context.scene.collection
    else:
        target_col = collection

    if obj.name not in target_col.objects:
        target_col.objects.link(obj)

    if exclusive:
        for existing in list(obj.users_collection):
            if existing != target_col:
                existing.objects.unlink(obj)
    return obj


# ------------------------------------------------------------ custom properties


def _coerce_prop_value(value):
    """Convert Python values into Blender IDProperty-compatible types."""
    if isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, tuple):
        return [_coerce_prop_value(item) for item in value]
    if isinstance(value, list):
        return [_coerce_prop_value(item) for item in value]
    if isinstance(value, dict):
        return {str(k): _coerce_prop_value(v) for k, v in value.items() if v is not None}
    return str(value)


def set_custom_props(obj: bpy.types.ID, props: dict | None) -> bpy.types.ID:
    """Write custom properties onto a Blender object for glTF extras -> Three userData.

    Keys with value `None` remove an existing custom property if present.
    """
    if not props:
        return obj
    for key, value in props.items():
        prop_name = str(key)
        if value is None:
            if prop_name in obj:
                del obj[prop_name]
            continue
        obj[prop_name] = _coerce_prop_value(value)
    return obj


# --------------------------------------------------------------- scene metrics


def scene_stats(objects: Iterable[bpy.types.Object] | None = None) -> dict:
    """Compute triangle, mesh, object, and unique material counts."""
    objs = list(bpy.context.scene.objects) if objects is None else list(objects)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()

    total_tris = 0
    mesh_count = 0
    materials: set[str] = set()

    for obj in objs:
        if obj.type != "MESH" or obj.data is None:
            continue
        mesh_count += 1
        for slot in obj.material_slots:
            if slot.material is not None:
                materials.add(slot.material.name)

        obj_eval = obj.evaluated_get(depsgraph)
        mesh_eval = obj_eval.to_mesh()
        try:
            mesh_eval.calc_loop_triangles()
            total_tris += len(mesh_eval.loop_triangles)
        finally:
            obj_eval.to_mesh_clear()

    return {
        "objects": len(objs),
        "meshes": mesh_count,
        "triangles": total_tris,
        "materials": len(materials),
        "materialNames": sorted(materials),
    }


# -------------------------------------------------------------- preview & eevee


def detect_eevee_engine(scene: bpy.types.Scene | None = None) -> str:
    """Return the available Eevee render engine identifier on Blender 5.x."""
    scn = scene or bpy.context.scene
    prop = scn.render.bl_rna.properties["engine"]
    available = [item.identifier for item in prop.enum_items]
    for preferred in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if preferred in available:
            return preferred
    return available[0]


def _look_at(obj: bpy.types.Object, target: Vector) -> None:
    """Orient a camera or light at `obj.location` to point toward `target`."""
    direction = target - obj.location
    if direction.length < 1e-6:
        return
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("-Z", "Y")


def _compute_mesh_bounds(
    exclude_collection: str | None = None,
) -> tuple[Vector, float]:
    """Estimate center and bounding radius of visible scene meshes."""
    mins = Vector((math.inf, math.inf, math.inf))
    maxs = Vector((-math.inf, -math.inf, -math.inf))
    found = False

    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        if exclude_collection and any(c.name == exclude_collection for c in obj.users_collection):
            continue
        for corner in obj.bound_box:
            world_pt = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, world_pt.x)
            mins.y = min(mins.y, world_pt.y)
            mins.z = min(mins.z, world_pt.z)
            maxs.x = max(maxs.x, world_pt.x)
            maxs.y = max(maxs.y, world_pt.y)
            maxs.z = max(maxs.z, world_pt.z)
            found = True

    if not found:
        return Vector((0.0, 0.0, 0.5)), 1.5

    center = (mins + maxs) * 0.5
    radius = max((maxs - mins).length * 0.5, 0.5)
    return center, radius


def add_preview_rig(
    target: tuple[float, float, float] = (0.0, 0.5, 0.0),
    radius: float = 2.0,
    collection_name: str = "_PreviewRig",
    engine_coords: bool = False,
) -> dict:
    """Create a 3-point Eevee preview lighting + camera rig in its own collection.

    Returns a dict with keys: `collection`, `camera`, `lights`, `world`, `target`, `radius`.
    """
    col = ensure_collection(collection_name)
    tgt_tuple = to_blender_vec(target) if engine_coords else tuple(float(v) for v in target)
    tgt = Vector(tgt_tuple)
    rad = max(float(radius), 0.25)

    # Neutral paper-tinted world background so silhouettes and bevels read cleanly.
    world = bpy.data.worlds.new(f"{collection_name}_World")
    if world.node_tree is None and hasattr(world, "use_nodes"):
        world.use_nodes = True
    if world.node_tree is not None:
        bg = world.node_tree.nodes.get("Background")
        if bg is not None:
            bg.inputs["Color"].default_value = (0.86, 0.82, 0.74, 1.0)
            bg.inputs["Strength"].default_value = 0.55

    # Camera positioned at 3/4 view initially.
    cam_data = bpy.data.cameras.new(f"{collection_name}_Camera")
    cam_data.lens = 50.0
    cam_data.clip_start = 0.05
    cam_data.clip_end = max(200.0, rad * 40.0)
    cam_obj = bpy.data.objects.new(f"{collection_name}_Camera", cam_data)
    dist = rad * 2.8
    cam_obj.location = tgt + Vector((dist * 0.65, -dist * 0.75, dist * 0.48))
    _look_at(cam_obj, tgt)
    link_object(cam_obj, col)

    # Three-point studio rig (key, fill, rim).
    lights = []
    light_specs = (
        ("Key", "SUN", 3.2, (1.0, 0.96, 0.9), (rad * 2.0, -rad * 2.2, rad * 3.0)),
        ("Fill", "AREA", 45.0 * (rad ** 2), (0.82, 0.9, 1.0), (-rad * 2.5, -rad * 1.5, rad * 1.6)),
        ("Rim", "AREA", 35.0 * (rad ** 2), (1.0, 0.92, 0.82), (rad * 0.6, rad * 2.6, rad * 2.2)),
    )
    for suffix, ltype, energy, color, offset in light_specs:
        ldata = bpy.data.lights.new(f"{collection_name}_{suffix}", type=ltype)
        ldata.energy = energy
        ldata.color = color
        if ltype == "AREA":
            ldata.size = rad * 1.5
        elif ltype == "SUN":
            ldata.angle = math.radians(8.0)
        lobj = bpy.data.objects.new(f"{collection_name}_{suffix}", ldata)
        lobj.location = tgt + Vector(offset)
        _look_at(lobj, tgt)
        link_object(lobj, col)
        lights.append(lobj)

    scene = bpy.context.scene
    scene.camera = cam_obj
    scene.world = world

    return {
        "collection": col,
        "camera": cam_obj,
        "lights": lights,
        "world": world,
        "target": tgt,
        "radius": rad,
    }


def _remove_preview_rig(rig: dict) -> None:
    """Cleanly remove objects, collection, and world created by `add_preview_rig`."""
    col = rig.get("collection")
    if col is not None:
        for obj in list(col.objects):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if data is not None and data.users == 0:
                if isinstance(data, bpy.types.Camera):
                    bpy.data.cameras.remove(data)
                elif isinstance(data, bpy.types.Light):
                    bpy.data.lights.remove(data)
        if col.name in bpy.data.collections:
            bpy.data.collections.remove(col)

    world = rig.get("world")
    if world is not None and world.name in bpy.data.worlds:
        bpy.data.worlds.remove(world)


def render_3views(
    out_path: str,
    target: tuple[float, float, float] | None = None,
    radius: float | None = None,
    size: int = 512,
    engine_coords: bool = False,
    cleanup: bool = True,
) -> dict:
    """Render a 3-view Eevee contact sheet (front, 3/4, top) at `size x size` per tile.

    Saves a `(3 * size) x size` PNG to `out_path` and prints triangle/material stats.
    Restores scene render settings and removes the temporary preview rig when `cleanup=True`.
    """
    scene = bpy.context.scene
    prev_camera = scene.camera
    prev_world = scene.world
    prev_engine = scene.render.engine
    prev_res_x = scene.render.resolution_x
    prev_res_y = scene.render.resolution_y
    prev_res_pct = scene.render.resolution_percentage
    prev_format = scene.render.image_settings.file_format
    prev_filepath = scene.render.filepath

    auto_center, auto_radius = _compute_mesh_bounds(exclude_collection="_PreviewRig")
    if target is None:
        tgt_arg = (auto_center.x, auto_center.y, auto_center.z)
        use_engine_coords = False
    else:
        tgt_arg = target
        use_engine_coords = engine_coords
    rad_arg = auto_radius if radius is None else float(radius)

    stats = scene_stats(
        o for o in scene.objects if not any(c.name == "_PreviewRig" for c in o.users_collection)
    )

    rig = add_preview_rig(
        target=tgt_arg,
        radius=rad_arg,
        collection_name="_PreviewRig",
        engine_coords=use_engine_coords,
    )
    cam = rig["camera"]
    tgt = rig["target"]
    dist = rig["radius"] * 2.8

    views = (
        ("front", tgt + Vector((0.0, -dist, 0.0))),
        ("three_quarter", tgt + Vector((dist * 0.62, -dist * 0.72, dist * 0.46))),
        ("top", tgt + Vector((0.0, -0.001, dist))),
    )

    abs_out = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(abs_out), exist_ok=True)

    try:
        scene.render.engine = detect_eevee_engine(scene)
        scene.render.resolution_x = int(size)
        scene.render.resolution_y = int(size)
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"

        tiles = []
        with tempfile.TemporaryDirectory(prefix="vn_preview_") as tmpdir:
            for name, cam_pos in views:
                cam.location = cam_pos
                _look_at(cam, tgt)
                tile_path = os.path.join(tmpdir, f"{name}.png")
                scene.render.filepath = tile_path
                bpy.ops.render.render(write_still=True)

                img = bpy.data.images.load(tile_path, check_existing=False)
                try:
                    w, h = img.size[0], img.size[1]
                    buf = np.empty(w * h * 4, dtype=np.float32)
                    img.pixels.foreach_get(buf)
                    tiles.append(buf.reshape((h, w, 4)))
                finally:
                    bpy.data.images.remove(img)

        sheet_arr = np.concatenate(tiles, axis=1)  # (H, 3*W, 4)
        sheet_h, sheet_w, _ = sheet_arr.shape
        sheet_img = bpy.data.images.new(
            "_vn_contact_sheet", width=sheet_w, height=sheet_h, alpha=True
        )
        try:
            sheet_img.pixels.foreach_set(sheet_arr.ravel())
            sheet_img.filepath_raw = abs_out
            sheet_img.file_format = "PNG"
            sheet_img.save()
        finally:
            bpy.data.images.remove(sheet_img)
    finally:
        scene.camera = prev_camera
        scene.world = prev_world
        scene.render.engine = prev_engine
        scene.render.resolution_x = prev_res_x
        scene.render.resolution_y = prev_res_y
        scene.render.resolution_percentage = prev_res_pct
        scene.render.image_settings.file_format = prev_format
        scene.render.filepath = prev_filepath
        if cleanup:
            _remove_preview_rig(rig)

    print(
        f"[vn_scene] preview {abs_out} | {sheet_w}x{sheet_h} | "
        f"{stats['meshes']} meshes | {stats['triangles']} tris | {stats['materials']} mats"
    )
    return {"filepath": abs_out, "width": sheet_w, "height": sheet_h, **stats}
