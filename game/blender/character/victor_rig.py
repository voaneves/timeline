"""T2.6 — Victor 24-bone (+L/R symmetry) Rig, Skinning & Extreme Pose Verification.

Builds `victor_model.py`, attaches the canonical `vn_rig.py` armature with
deterministic weights (preserving 100% lockstep weights on all `0.015 m`
inverted-hull outline meshes), renders 3 extreme test poses side-by-side to
`game/blender/out/previews/t26_extreme_poses.png` (1536x512), resets to rest
pose, and exports `game/blender/out/victor_rigged.glb` + `victor_rigged.blend`.
"""

from __future__ import annotations

import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Vector

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
BLENDER_ROOT = os.path.dirname(THIS_DIR)
if BLENDER_ROOT not in sys.path:
    sys.path.insert(0, BLENDER_ROOT)
if THIS_DIR not in sys.path:
    sys.path.insert(0, THIS_DIR)

import victor_model as vm
from lib import vn_export, vn_rig, vn_scene


OUT_DIR = os.path.join(BLENDER_ROOT, "out")
PREVIEW_DIR = os.path.join(OUT_DIR, "previews")
EXTREME_POSE_PNG = os.path.join(PREVIEW_DIR, "t26_extreme_poses.png")
RIGGED_GLB = os.path.join(OUT_DIR, "victor_rigged.glb")
RIGGED_BLEND = os.path.join(OUT_DIR, "victor_rigged.blend")


# 3 Extreme Verification Poses (Euler XYZ in degrees in bone local space)
EXTREME_POSES: list[tuple[str, dict[str, tuple[float, float, float]], tuple[float, float, float]]] = [
    (
        "pose1_high_jump",
        {
            "hips": (10.0, 0.0, 0.0),
            "spine": (8.0, 0.0, 0.0),
            "spine.001": (10.0, 0.0, 0.0),
            "neck": (10.0, 0.0, 0.0),
            "head": (25.0, 0.0, 0.0),
            "brow.L": (-12.0, 0.0, 0.0),
            "brow.R": (-12.0, 0.0, 0.0),
            "shoulder.L": (0.0, 0.0, 18.0),
            "arm.L": (135.0, 0.0, 25.0),
            "forearm.L": (20.0, 0.0, 0.0),
            "hand.L": (15.0, 0.0, 0.0),
            "shoulder.R": (0.0, 0.0, -18.0),
            "arm.R": (135.0, 0.0, -25.0),
            "forearm.R": (20.0, 0.0, 0.0),
            "hand.R": (15.0, 0.0, 0.0),
            "thigh.L": (70.0, 0.0, 8.0),
            "shin.L": (-20.0, 0.0, 0.0),
            "foot.L": (-25.0, 0.0, 0.0),
            "thigh.R": (-60.0, 0.0, -8.0),
            "shin.R": (-75.0, 0.0, 0.0),
            "foot.R": (-30.0, 0.0, 0.0),
            "scarf.01": (25.0, 0.0, -12.0),
            "scarf.02": (35.0, 0.0, -18.0),
            "scarf.03": (30.0, 0.0, -22.0),
        },
        (0.0, 0.14, 0.0),
    ),
    (
        "pose2_deep_crouch",
        {
            "hips": (-10.0, 0.0, 0.0),
            "spine": (-18.0, 0.0, 0.0),
            "spine.001": (-35.0, 0.0, 0.0),
            "neck": (15.0, 0.0, 0.0),
            "head": (25.0, 0.0, 0.0),
            "brow.L": (18.0, 0.0, -14.0),
            "brow.R": (18.0, 0.0, 14.0),
            "shoulder.L": (0.0, 0.0, -15.0),
            "arm.L": (-55.0, 0.0, -20.0),
            "forearm.L": (45.0, 0.0, 0.0),
            "shoulder.R": (0.0, 0.0, 15.0),
            "arm.R": (-55.0, 0.0, 20.0),
            "forearm.R": (45.0, 0.0, 0.0),
            "thigh.L": (80.0, 0.0, 14.0),
            "shin.L": (-110.0, 0.0, 0.0),
            "foot.L": (30.0, 0.0, 0.0),
            "toe.L": (25.0, 0.0, 0.0),
            "thigh.R": (80.0, 0.0, -14.0),
            "shin.R": (-110.0, 0.0, 0.0),
            "foot.R": (30.0, 0.0, 0.0),
            "toe.R": (25.0, 0.0, 0.0),
            "scarf.01": (20.0, 0.0, 10.0),
            "scarf.02": (30.0, 0.0, 15.0),
            "scarf.03": (25.0, 0.0, 20.0),
        },
        (0.0, -0.28, 0.0),
    ),
    (
        "pose3_hard_skid_twist",
        {
            "hips": (-8.0, -15.0, 0.0),
            "spine": (-10.0, 35.0, 0.0),
            "spine.001": (-10.0, 35.0, 0.0),
            "neck": (5.0, -25.0, 0.0),
            "head": (10.0, -25.0, 0.0),
            "brow.L": (10.0, 0.0, -8.0),
            "brow.R": (10.0, 0.0, 8.0),
            "shoulder.L": (0.0, 0.0, -15.0),
            "arm.L": (-65.0, 0.0, -45.0),
            "forearm.L": (40.0, 0.0, 0.0),
            "shoulder.R": (0.0, 0.0, 15.0),
            "arm.R": (60.0, 0.0, 35.0),
            "forearm.R": (65.0, 0.0, 0.0),
            "thigh.L": (45.0, 0.0, 14.0),
            "shin.L": (-45.0, 0.0, 0.0),
            "foot.L": (-20.0, 0.0, 0.0),
            "toe.L": (40.0, 0.0, 0.0),
            "thigh.R": (-35.0, 0.0, -14.0),
            "shin.R": (-35.0, 0.0, 0.0),
            "foot.R": (-15.0, 0.0, 0.0),
            "toe.R": (40.0, 0.0, 0.0),
            "scarf.01": (0.0, 45.0, 30.0),
            "scarf.02": (15.0, 50.0, 40.0),
            "scarf.03": (25.0, 45.0, 45.0),
        },
        (0.0, -0.06, 0.0),
    ),
]


def render_extreme_poses_sheet(
    armature_obj: bpy.types.Object,
    out_path: str,
    tile_size: int = 512,
) -> dict:
    """Render all 3 extreme poses side-by-side (`1536x512`) and reset back to rest pose."""
    scene = bpy.context.scene
    prev_camera = scene.camera
    prev_world = scene.world
    prev_engine = scene.render.engine
    prev_res_x = scene.render.resolution_x
    prev_res_y = scene.render.resolution_y
    prev_res_pct = scene.render.resolution_percentage
    prev_format = scene.render.image_settings.file_format
    prev_filepath = scene.render.filepath

    rig = vn_scene.add_preview_rig(
        target=(0.0, 0.0, 0.60),
        radius=0.82,
        collection_name="_PreviewRig",
        engine_coords=False,
    )
    cam = rig["camera"]
    tgt = Vector((0.0, 0.0, 0.58))
    dist = 2.45
    cam.location = tgt + Vector((dist * 0.42, -dist * 0.88, dist * 0.22))
    vn_scene._look_at(cam, tgt)

    abs_out = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(abs_out), exist_ok=True)
    tiles = []

    try:
        scene.render.engine = vn_scene.detect_eevee_engine(scene)
        scene.render.resolution_x = int(tile_size)
        scene.render.resolution_y = int(tile_size)
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"

        with tempfile.TemporaryDirectory(prefix="vn_t26_") as tmpdir:
            for pose_name, pose_deg, hips_offset in EXTREME_POSES:
                vn_rig.apply_pose_deg(armature_obj, pose_deg, hips_offset=hips_offset)
                tile_path = os.path.join(tmpdir, f"{pose_name}.png")
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
    finally:
        vn_rig.reset_pose(armature_obj)
        scene.camera = prev_camera
        scene.world = prev_world
        scene.render.engine = prev_engine
        scene.render.resolution_x = prev_res_x
        scene.render.resolution_y = prev_res_y
        scene.render.resolution_percentage = prev_res_pct
        scene.render.image_settings.file_format = prev_format
        scene.render.filepath = prev_filepath
        vn_scene._remove_preview_rig(rig)

    sheet_arr = np.concatenate(tiles, axis=1)
    sheet_h, sheet_w, _ = sheet_arr.shape
    sheet_img = bpy.data.images.new(
        "_t26_extreme_poses", width=sheet_w, height=sheet_h, alpha=True
    )
    try:
        sheet_img.pixels.foreach_set(sheet_arr.ravel())
        sheet_img.filepath_raw = abs_out
        sheet_img.file_format = "PNG"
        sheet_img.save()
    finally:
        bpy.data.images.remove(sheet_img)

    return {"filepath": abs_out, "width": sheet_w, "height": sheet_h}


def build_rigged_victor() -> dict:
    """Build Victor's model, rig, deterministic skinning, extreme pose check, and exports."""
    vn_scene.reset_scene("Victor_Rigged")
    col = vn_scene.ensure_collection("Victor_Rig")

    all_objs, _head_objs, model_metrics, _swatches = vm.build_victor_model(
        collection=col,
        x_offset=0.0,
    )
    bone_specs = vn_rig.compute_victor_bone_specs(all_objs)
    armature = vn_rig.create_victor_armature(
        name="VictorArmature",
        bone_specs=bone_specs,
        collection=col,
    )
    skin_info = vn_rig.apply_clean_skinning(
        armature_obj=armature,
        mesh_objs=all_objs,
        join_palette_meshes=True,
        collection=col,
    )

    pose_sheet = render_extreme_poses_sheet(armature, EXTREME_POSE_PNG, tile_size=512)

    # Ensure rest pose before export
    vn_rig.reset_pose(armature)

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(RIGGED_BLEND))

    vn_export.export_glb(
        filepath=RIGGED_GLB,
        collections=[col],
        apply_modifiers=False,  # preserve Armature skinning modifier
        export_extras=True,
        export_materials="EXPORT",
        export_animations=False,
        mute_palette_textures=True,
    )
    glb_info = vn_export.inspect_glb(RIGGED_GLB)

    print(
        f"[T2.6] Victor Rigged | bones={skin_info['bone_count']} | "
        f"meshes={skin_info['mesh_names']} | "
        f"verts={skin_info['total_vertices']} (unweighted={skin_info['unweighted_vertices']}, "
        f"max_err={skin_info['max_weight_error']:.6f}) | "
        f"glb_tris={glb_info['triangles']} | glb_mats={glb_info['materials']} | "
        f"glb_bytes={glb_info['bytes']} | preview={pose_sheet['filepath']}"
    )
    return {
        "model_metrics": model_metrics,
        "skin_info": skin_info,
        "pose_sheet": pose_sheet,
        "glb_info": glb_info,
    }


if __name__ == "__main__":
    build_rigged_victor()
