"""Manual override system (R1) for Blender procedural asset generation.

Allows hand-edited `.blend` files in `game/blender/manual/<asset>.blend` (or
`<object>.blend`) to override procedurally generated meshes by exact object name,
surviving full scene regenerations while preserving custom properties, parents,
and collection membership.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import bpy


DEFAULT_MANUAL_DIR = Path(__file__).resolve().parent.parent / "manual"

_TRACKED_STORES = (
    "objects",
    "meshes",
    "materials",
    "images",
    "textures",
    "node_groups",
    "collections",
    "actions",
    "armatures",
)


def _resolve_manual_dir(manual_dir: str | Path | None) -> Path:
    if manual_dir is None:
        return DEFAULT_MANUAL_DIR
    return Path(manual_dir).resolve()


def _blend_filename(name: str) -> str:
    return name if name.lower().endswith(".blend") else f"{name}.blend"


def _resolve_target_objects(
    objects: Iterable[bpy.types.Object | str] | bpy.types.Object | str | None,
) -> list[bpy.types.Object]:
    if objects is None:
        return [
            obj
            for obj in bpy.context.scene.objects
            if not any(c.name.startswith("_Preview") for c in obj.users_collection)
        ]

    if isinstance(objects, (bpy.types.Object, str)):
        items: list[bpy.types.Object | str] = [objects]
    else:
        items = list(objects)

    resolved: list[bpy.types.Object] = []
    for item in items:
        obj = bpy.data.objects.get(item) if isinstance(item, str) else item
        if obj is None:
            raise KeyError(f"Object not found in current scene: {item!r}")
        if obj not in resolved:
            resolved.append(obj)
    return resolved


def _snapshot_datablocks() -> dict[str, set[int]]:
    snap: dict[str, set[int]] = {}
    for attr in _TRACKED_STORES:
        store = getattr(bpy.data, attr, None)
        if store is not None:
            snap[attr] = {db.as_pointer() for db in store}
    return snap


def _cleanup_new_orphans(snapshot: dict[str, set[int]], extra_meshes: list[bpy.types.Mesh]) -> None:
    """Remove replaced meshes and any newly appended datablocks with zero users."""
    for mesh in extra_meshes:
        try:
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        except ReferenceError:
            pass

    for _ in range(5):
        removed_any = False
        for attr in _TRACKED_STORES:
            store = getattr(bpy.data, attr, None)
            if store is None:
                continue
            known = snapshot.get(attr, set())
            for db in list(store):
                try:
                    ptr = db.as_pointer()
                    users = db.users
                except ReferenceError:
                    continue
                if ptr not in known and users == 0:
                    try:
                        store.remove(db, do_unlink=True)
                    except TypeError:
                        store.remove(db)
                    except RuntimeError:
                        continue
                    removed_any = True
        if not removed_any:
            break


def _copy_transform(src: bpy.types.Object, dst: bpy.types.Object) -> None:
    dst.rotation_mode = src.rotation_mode
    dst.location = src.location.copy()
    dst.rotation_euler = src.rotation_euler.copy()
    dst.rotation_quaternion = src.rotation_quaternion.copy()
    dst.rotation_axis_angle = tuple(src.rotation_axis_angle)
    dst.scale = src.scale.copy()


def _copy_custom_prop_value(value):
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if hasattr(value, "to_list"):
        return value.to_list()
    return value


def _sync_custom_props(
    src: bpy.types.Object,
    dst: bpy.types.Object,
    preserve_custom_props: bool,
) -> None:
    if preserve_custom_props:
        # Keep every generated custom property intact; only bring in new keys
        # defined in the manual file that do not collide with generated ones.
        for key in list(src.keys()):
            if key.startswith("_") or key == "vn_manual_override":
                continue
            if key not in dst:
                dst[key] = _copy_custom_prop_value(src[key])
        return

    for key in list(dst.keys()):
        if not key.startswith("_"):
            del dst[key]
    for key in list(src.keys()):
        if key.startswith("_") or key == "vn_manual_override":
            continue
        dst[key] = _copy_custom_prop_value(src[key])


def _extract_manual_mesh(src_obj: bpy.types.Object) -> bpy.types.Mesh:
    """Return mesh datablock from `src_obj`, baking modifiers if present."""
    if len(src_obj.modifiers) == 0:
        return src_obj.data

    scene_col = bpy.context.scene.collection
    linked_temporarily = src_obj.name not in scene_col.objects
    if linked_temporarily:
        scene_col.objects.link(src_obj)
    try:
        depsgraph = bpy.context.evaluated_depsgraph_get()
        depsgraph.update()
        eval_obj = src_obj.evaluated_get(depsgraph)
        baked = bpy.data.meshes.new_from_object(
            eval_obj,
            preserve_all_data_layers=True,
            depsgraph=depsgraph,
        )
        return baked
    finally:
        if linked_temporarily and src_obj.name in scene_col.objects:
            scene_col.objects.unlink(src_obj)


def _apply_from_blend(
    blend_path: Path,
    target_map: dict[str, bpy.types.Object],
    *,
    preserve_transform: bool,
    preserve_custom_props: bool,
    preserve_parent: bool,
) -> tuple[list[str], list[str]]:
    snapshot = _snapshot_datablocks()
    requested_names: list[str] = []
    missing_names: list[str] = []

    with bpy.data.libraries.load(str(blend_path), link=False) as (data_from, data_to):
        all_names = list(data_from.objects)
        requested_names = [name for name in all_names if name in target_map]
        missing_names = [name for name in all_names if name not in target_map]
        data_to.objects = list(requested_names)

    appended_pairs: list[tuple[str, bpy.types.Object]] = [
        (orig_name, obj)
        for orig_name, obj in zip(requested_names, data_to.objects)
        if obj is not None
    ]

    applied: list[str] = []
    replaced_meshes: list[bpy.types.Mesh] = []

    try:
        for orig_name, src_obj in appended_pairs:
            dst_obj = target_map.get(orig_name)
            if dst_obj is None:
                continue
            if src_obj.type != "MESH" or dst_obj.type != "MESH" or src_obj.data is None:
                continue

            old_mesh = dst_obj.data
            old_mesh_name = old_mesh.name if old_mesh is not None else orig_name

            dst_obj.modifiers.clear()
            new_mesh = _extract_manual_mesh(src_obj)
            dst_obj.data = new_mesh

            # Replicate object-linked material slots if any were used in manual file.
            for idx, src_slot in enumerate(src_obj.material_slots):
                if idx < len(dst_obj.material_slots) and src_slot.link == "OBJECT":
                    dst_obj.material_slots[idx].link = "OBJECT"
                    dst_obj.material_slots[idx].material = src_slot.material

            if not preserve_parent:
                if src_obj.parent is not None:
                    parent_base = src_obj.parent.name.split(".")[0]
                    dst_obj.parent = target_map.get(src_obj.parent.name) or target_map.get(parent_base)
                else:
                    dst_obj.parent = None

            if not preserve_transform:
                _copy_transform(src_obj, dst_obj)

            _sync_custom_props(src_obj, dst_obj, preserve_custom_props=preserve_custom_props)
            dst_obj["vn_manual_override"] = str(blend_path.name)

            if old_mesh is not None and old_mesh != new_mesh:
                if old_mesh.users == 0:
                    bpy.data.meshes.remove(old_mesh)
                    new_mesh.name = old_mesh_name
                else:
                    replaced_meshes.append(old_mesh)

            applied.append(orig_name)
    finally:
        for _, src_obj in appended_pairs:
            try:
                bpy.data.objects.remove(src_obj, do_unlink=True)
            except ReferenceError:
                pass
        _cleanup_new_orphans(snapshot, replaced_meshes)
        bpy.context.view_layer.update()

    return applied, missing_names


def apply_manual_overrides(
    asset_name: str | None,
    objects: Iterable[bpy.types.Object | str] | bpy.types.Object | str | None = None,
    manual_dir: str | Path | None = None,
    preserve_transform: bool = False,
    preserve_custom_props: bool = True,
    preserve_parent: bool = True,
) -> dict:
    """Apply hand-edited mesh overrides from `<manual_dir>/<asset_name>.blend`.

    When `asset_name` is `None`, checks `<manual_dir>/<object_name>.blend` for each
    candidate object in `objects` (or the current scene).

    If no matching `.blend` file exists, returns `{"applied": [], "skipped": True}`
    without modifying the scene.
    """
    base_dir = _resolve_manual_dir(manual_dir)
    targets = _resolve_target_objects(objects)
    target_map = {obj.name: obj for obj in targets}

    if asset_name is not None:
        blend_path = base_dir / _blend_filename(asset_name)
        if not blend_path.is_file():
            print(f"[vn_manual] skip {asset_name!r} (no override at {blend_path})")
            return {
                "blend": str(blend_path),
                "applied": [],
                "missing": [],
                "skipped": True,
            }

        applied, missing = _apply_from_blend(
            blend_path,
            target_map,
            preserve_transform=preserve_transform,
            preserve_custom_props=preserve_custom_props,
            preserve_parent=preserve_parent,
        )
        print(
            f"[vn_manual] applied {len(applied)} override(s) from {blend_path.name}: "
            f"{applied} | missing={missing}"
        )
        return {
            "blend": str(blend_path),
            "applied": applied,
            "missing": missing,
            "skipped": False,
        }

    # Per-object override mode (`asset_name=None`): look for `<object_name>.blend`.
    applied_all: list[str] = []
    missing_all: list[str] = []
    used_blends: list[str] = []

    for obj in targets:
        blend_path = base_dir / _blend_filename(obj.name)
        if not blend_path.is_file():
            continue
        applied, missing = _apply_from_blend(
            blend_path,
            {obj.name: obj},
            preserve_transform=preserve_transform,
            preserve_custom_props=preserve_custom_props,
            preserve_parent=preserve_parent,
        )
        used_blends.append(str(blend_path))
        applied_all.extend(applied)
        missing_all.extend(missing)

    if not used_blends:
        print(f"[vn_manual] skip per-object lookup (no overrides in {base_dir})")
        return {
            "blend": None,
            "applied": [],
            "missing": [],
            "skipped": True,
        }

    print(
        f"[vn_manual] applied {len(applied_all)} per-object override(s) from "
        f"{len(used_blends)} file(s): {applied_all} | missing={missing_all}"
    )
    return {
        "blend": used_blends[0] if len(used_blends) == 1 else used_blends,
        "applied": applied_all,
        "missing": missing_all,
        "skipped": False,
    }


def export_for_manual_edit(
    asset_name: str,
    objects: Iterable[bpy.types.Object | str] | bpy.types.Object | str | None = None,
    manual_dir: str | Path | None = None,
) -> Path:
    """Save a starter `.blend` containing `objects` for hand-editing in Blender.

    Writes a clean metric scene containing the requested objects without altering
    the current scene or active `.blend` filepath.
    """
    base_dir = _resolve_manual_dir(manual_dir)
    base_dir.mkdir(parents=True, exist_ok=True)
    blend_path = base_dir / _blend_filename(asset_name)

    resolved = _resolve_target_objects(objects)
    stem = blend_path.stem

    tmp_scene = bpy.data.scenes.new(name=f"Manual_{stem}")
    tmp_scene.unit_settings.system = "METRIC"
    tmp_scene.unit_settings.scale_length = 1.0
    if hasattr(tmp_scene.unit_settings, "length_unit"):
        tmp_scene.unit_settings.length_unit = "METERS"

    try:
        for obj in resolved:
            if obj.name not in tmp_scene.collection.objects:
                tmp_scene.collection.objects.link(obj)
        bpy.data.libraries.write(str(blend_path), {tmp_scene}, compress=True)
    finally:
        if tmp_scene.name in bpy.data.scenes:
            bpy.data.scenes.remove(tmp_scene, do_unlink=True)

    size = blend_path.stat().st_size
    print(
        f"[vn_manual] exported starter {blend_path} | "
        f"{len(resolved)} obj(s) | {size} B"
    )
    return blend_path
