"""Animation clip authoring, NLA track management, and subset glTF export for Blender 5.x."""

from __future__ import annotations

import math
from typing import Iterable

import bpy
from mathutils import Euler, Vector

from . import vn_export, vn_rig


def get_action_fcurves(action: bpy.types.Action, slot=None):
    """Return the FCurves collection for a Blender 5.x layered action (or legacy action)."""
    if hasattr(action, "fcurves"):
        return action.fcurves
    if getattr(action, "layers", None):
        for layer in action.layers:
            for strip in getattr(layer, "strips", ()):
                if hasattr(strip, "channelbag") and slot is not None:
                    cb = strip.channelbag(slot)
                    if cb is not None and hasattr(cb, "fcurves"):
                        return cb.fcurves
                if hasattr(strip, "channelbags"):
                    for cb in strip.channelbags:
                        if hasattr(cb, "fcurves"):
                            return cb.fcurves
    return ()


def _remove_existing_clip(armature: bpy.types.Object, name: str) -> None:
    """Remove any pre-existing NLA track and Action with the given clip name."""
    if armature.animation_data is not None:
        tracks = armature.animation_data.nla_tracks
        for track in list(tracks):
            if track.name == name:
                tracks.remove(track)
    old_act = bpy.data.actions.get(name)
    if old_act is not None and old_act.users == 0:
        bpy.data.actions.remove(old_act)


def create_clip(
    armature: bpy.types.Object,
    name: str,
    fps: int = 24,
    frame_count: int = 12,
    loop: bool = True,
    keyframes: dict[int, dict[str, dict | tuple[float, float, float]]] | None = None,
    crisp_frames: Iterable[int] | None = None,
) -> dict:
    """Author a named Bezier-interpolated Action + NLA track on `armature`.

    `keyframes` maps `{frame: {bone_name: {"loc": (x,y,z), "rot": (rx,ry,rz)} | (rx,ry,rz)}}`
    where rotations are XYZ Euler degrees in bone-local space.
    """
    if armature is None or armature.type != "ARMATURE":
        raise TypeError(f"Expected ARMATURE object, got {armature!r}")

    bpy.context.scene.render.fps = int(fps)
    armature.animation_data_create()
    _remove_existing_clip(armature, name)

    kf_map: dict[int, dict[str, dict | tuple[float, float, float]]] = {
        int(f): dict(poses) for f, poses in (keyframes or {}).items()
    }
    if loop and 0 in kf_map and int(frame_count) not in kf_map:
        kf_map[int(frame_count)] = dict(kf_map[0])

    action = bpy.data.actions.new(name=name)
    armature.animation_data.action = action
    vn_rig.reset_pose(armature)

    for pbone in armature.pose.bones:
        pbone.rotation_mode = "XYZ"

    for frame in sorted(kf_map.keys()):
        bone_poses = kf_map[frame]
        for bone_name, spec in bone_poses.items():
            pbone = armature.pose.bones.get(bone_name)
            if pbone is None:
                raise KeyError(f"Clip {name!r}: pose bone {bone_name!r} not found")
            pbone.rotation_mode = "XYZ"
            if isinstance(spec, dict):
                if "rot" in spec:
                    rx, ry, rz = spec["rot"]
                    pbone.rotation_euler = Euler(
                        (math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ"
                    )
                    pbone.keyframe_insert(data_path="rotation_euler", frame=frame)
                if "loc" in spec:
                    pbone.location = Vector(spec["loc"])
                    pbone.keyframe_insert(data_path="location", frame=frame)
            else:
                rx, ry, rz = spec
                pbone.rotation_euler = Euler(
                    (math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ"
                )
                pbone.keyframe_insert(data_path="rotation_euler", frame=frame)

    slot = getattr(armature.animation_data, "action_slot", None)
    crisp_set = {int(f) for f in (crisp_frames or ())}
    for fcurve in get_action_fcurves(action, slot):
        for kp in fcurve.keyframe_points:
            kp.interpolation = "BEZIER"
            frame_idx = int(round(kp.co.x))
            if frame_idx in crisp_set:
                kp.handle_left_type = "VECTOR"
                kp.handle_right_type = "VECTOR"
            else:
                kp.handle_left_type = "AUTO_CLAMPED"
                kp.handle_right_type = "AUTO_CLAMPED"
        fcurve.update()

    action.use_frame_range = True
    action.frame_start = 0.0
    action.frame_end = float(frame_count)

    # Clear active action and push onto its own named NLA track for glTF export
    armature.animation_data.action = None
    track = armature.animation_data.nla_tracks.new()
    track.name = name
    track.mute = False
    strip = track.strips.new(name=name, start=0, action=action)
    strip.action_frame_start = 0.0
    strip.action_frame_end = float(frame_count)
    strip.frame_start = 0.0
    strip.frame_end = float(frame_count)

    vn_rig.reset_pose(armature)
    return {
        "name": name,
        "action": action,
        "track": track,
        "fps": int(fps),
        "frame_count": int(frame_count),
        "duration": float(frame_count) / float(fps),
        "loop": bool(loop),
    }


def list_nla_clips(armature: bpy.types.Object) -> list[str]:
    """Return ordered NLA track names on `armature`."""
    if armature.animation_data is None:
        return []
    return [t.name for t in armature.animation_data.nla_tracks]


def export_nla_subset(
    armature: bpy.types.Object,
    clip_names: Iterable[str] | None,
    filepath: str,
    collections: Iterable[bpy.types.Collection | str] | None = None,
    objects: Iterable[bpy.types.Object | str] | None = None,
    fps: int = 24,
    mute_palette_textures: bool = True,
) -> dict:
    """Export a GLB containing only the requested NLA tracks (or all if `clip_names` is None)."""
    if armature.animation_data is None:
        raise RuntimeError("Armature has no animation_data")

    bpy.context.scene.render.fps = int(fps)
    tracks = armature.animation_data.nla_tracks
    saved_tracks: list[tuple[str, bpy.types.Action, float, float, float, float, bool]] = []
    for t in tracks:
        if not t.strips:
            continue
        s = t.strips[0]
        saved_tracks.append(
            (
                t.name,
                s.action,
                s.frame_start,
                s.frame_end,
                s.action_frame_start,
                s.action_frame_end,
                t.mute,
            )
        )

    wanted = list(clip_names) if clip_names is not None else [item[0] for item in saved_tracks]
    by_name = {item[0]: item for item in saved_tracks}
    missing = [name for name in wanted if name not in by_name]
    if missing:
        raise KeyError(f"Requested NLA clips not found on armature: {missing}")

    try:
        vn_rig.reset_pose(armature)
        armature.animation_data.action = None
        for t in list(tracks):
            tracks.remove(t)

        for name in wanted:
            _, act, fs, fe, afs, afe, _ = by_name[name]
            t = tracks.new()
            t.name = name
            t.mute = False
            s = t.strips.new(name=name, start=int(round(fs)), action=act)
            s.action_frame_start = afs
            s.action_frame_end = afe
            s.frame_start = fs
            s.frame_end = fe

        vn_export.export_glb(
            filepath=filepath,
            collections=collections,
            objects=objects,
            apply_modifiers=False,
            export_extras=True,
            export_materials="EXPORT",
            export_animations=True,
            mute_palette_textures=mute_palette_textures,
            export_animation_mode="NLA_TRACKS",
            export_nla_strips=True,
            export_anim_slide_to_zero=True,
            export_optimize_animation_size=True,
            export_bake_animation=True,
        )
    finally:
        for t in list(tracks):
            tracks.remove(t)
        for name, act, fs, fe, afs, afe, prev_mute in saved_tracks:
            t = tracks.new()
            t.name = name
            t.mute = prev_mute
            s = t.strips.new(name=name, start=int(round(fs)), action=act)
            s.action_frame_start = afs
            s.action_frame_end = afe
            s.frame_start = fs
            s.frame_end = fe
        vn_rig.reset_pose(armature)

    return vn_export.inspect_glb(filepath)
