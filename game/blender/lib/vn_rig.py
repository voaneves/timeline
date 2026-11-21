"""T2.6 — Deterministic 24-bone (+L/R symmetry) character armature and skinning utilities.

Builds Victor's canonical skeleton matching the `bone_group` tags in
`character/victor_model.py`, computes exact joint pivots from the normalized
1.200 m mesh geometry, applies deterministic vertex weights (preserving 100%
lockstep weighting on every `0.015 m` inverted-hull outline mesh so outlines
never tear or separate), and provides pose/reset helpers for verification and
animation authoring (`T2.7a`..`T2.8d`).
"""

from __future__ import annotations

import math
from typing import Iterable

import bpy
from mathutils import Euler, Vector

from . import vn_scene


# Canonical bone list matching `victor_model.CANONICAL_24_BONES` (24-bone spec + L/R symmetry = 26 bones)
CANONICAL_BONES: tuple[str, ...] = (
    "hips",
    "spine",
    "spine.001",
    "neck",
    "head",
    "brow.L",
    "brow.R",
    "shoulder.L",
    "arm.L",
    "forearm.L",
    "hand.L",
    "shoulder.R",
    "arm.R",
    "forearm.R",
    "hand.R",
    "thigh.L",
    "shin.L",
    "foot.L",
    "toe.L",
    "thigh.R",
    "shin.R",
    "foot.R",
    "toe.R",
    "scarf.01",
    "scarf.02",
    "scarf.03",
)

# (parent_bone, use_connect)
BONE_HIERARCHY: dict[str, tuple[str | None, bool]] = {
    "hips": (None, False),
    "spine": ("hips", True),
    "spine.001": ("spine", True),
    "neck": ("spine.001", True),
    "head": ("neck", True),
    "brow.L": ("head", False),
    "brow.R": ("head", False),
    "shoulder.L": ("spine.001", False),
    "arm.L": ("shoulder.L", True),
    "forearm.L": ("arm.L", True),
    "hand.L": ("forearm.L", True),
    "shoulder.R": ("spine.001", False),
    "arm.R": ("shoulder.R", True),
    "forearm.R": ("arm.R", True),
    "hand.R": ("forearm.R", True),
    "thigh.L": ("hips", False),
    "shin.L": ("thigh.L", True),
    "foot.L": ("shin.L", True),
    "toe.L": ("foot.L", True),
    "thigh.R": ("hips", False),
    "shin.R": ("thigh.R", True),
    "foot.R": ("shin.R", True),
    "toe.R": ("foot.R", True),
    "scarf.01": ("spine.001", False),
    "scarf.02": ("scarf.01", True),
    "scarf.03": ("scarf.02", True),
}


def _world_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector, Vector]:
    """Return `(mins, maxs, center)` in world space for a mesh object."""
    verts = obj.data.vertices
    if len(verts) == 0:
        loc = obj.matrix_world.translation.copy()
        return loc, loc, loc
    mw = obj.matrix_world
    pts = [mw @ v.co for v in verts]
    mins = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    maxs = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mins, maxs, (mins + maxs) * 0.5


def compute_victor_bone_specs(
    mesh_objs: Iterable[bpy.types.Object],
) -> dict[str, tuple[Vector, Vector]]:
    """Derive exact `(head, tail)` bone positions from normalized `victor_model` meshes."""
    by_name = {o.name: o for o in mesh_objs if o.type == "MESH" and o.data is not None}

    def _bounds(name: str, fallback_c: Vector) -> tuple[Vector, Vector, Vector]:
        obj = by_name.get(name)
        if obj is None:
            return fallback_c.copy(), fallback_c.copy(), fallback_c.copy()
        return _world_bounds(obj)

    pelvis_min, pelvis_max, pelvis_c = _bounds("Victor_Pelvis", Vector((0.0, 0.004, 0.375)))
    torso_min, torso_max, torso_c = _bounds("Victor_TorsoTee", Vector((0.0, 0.001, 0.530)))
    neck_min, neck_max, neck_c = _bounds("Victor_Neck", Vector((0.0, -0.006, 0.725)))
    cran_min, cran_max, cran_c = _bounds("Victor_HeadCranium", Vector((0.0, -0.008, 0.912)))

    # Normalize scale factor relative to canonical 1.200 m height
    scale = max(cran_max.z, 1.0) / 1.077 if "Victor_HeadCranium" in by_name else 1.0

    hips_head = Vector((pelvis_c.x, pelvis_c.y, pelvis_c.z))
    hips_tail = Vector((torso_c.x, torso_c.y, max(torso_min.z + 0.02 * scale, pelvis_c.z + 0.04 * scale)))
    spine_tail = Vector((torso_c.x, torso_c.y, (hips_tail.z + torso_max.z) * 0.5))
    spine01_tail = Vector((neck_c.x, neck_c.y, neck_min.z + 0.01 * scale))
    neck_tail = Vector((neck_c.x, neck_c.y, neck_max.z - 0.005 * scale))
    head_tail = Vector((cran_c.x, cran_c.y, cran_max.z))

    specs: dict[str, tuple[Vector, Vector]] = {
        "hips": (hips_head, hips_tail),
        "spine": (hips_tail.copy(), spine_tail),
        "spine.001": (spine_tail.copy(), spine01_tail),
        "neck": (spine01_tail.copy(), neck_tail),
        "head": (neck_tail.copy(), head_tail),
    }

    # Eyebrows
    for side in ("L", "R"):
        _, _, brow_c = _bounds(f"Victor_Eyebrow_{side}", Vector(((-0.055 if side == "L" else 0.055), -0.155, 0.955)))
        specs[f"brow.{side}"] = (
            brow_c + Vector((0.0, 0.025 * scale, 0.0)),
            brow_c + Vector((0.0, -0.035 * scale, 0.0)),
        )

    # Arms (shoulder -> arm -> forearm -> hand)
    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        _, _, sh_c = _bounds(f"Victor_Shoulder_{side}", Vector((s_sign * 0.136, 0.004, 0.648)))
        ua_min, ua_max, _ = _bounds(f"Victor_UpperArm_{side}", Vector((s_sign * 0.178, 0.010, 0.582)))
        fa_min, fa_max, _ = _bounds(f"Victor_Forearm_{side}", Vector((s_sign * 0.231, -0.006, 0.455)))
        ha_min, ha_max, ha_c = _bounds(f"Victor_Hand_{side}", Vector((s_sign * 0.250, -0.036, 0.362)))

        sh_head = Vector((s_sign * 0.055 * scale, sh_c.y, sh_c.z))
        # Shoulder pivot at top-inner of upper arm
        sh_pivot = Vector((s_sign * 0.142 * scale, 0.004 * scale, 0.648 * scale))
        if f"Victor_UpperArm_{side}" in by_name:
            # Blend from bounds so it tracks exact normalized scale
            sh_pivot = Vector((
                (ua_max.x if s_sign < 0 else ua_min.x) - s_sign * 0.035 * scale,
                sh_c.y,
                ua_max.z - 0.035 * scale,
            ))
        elbow_pivot = Vector((
            (ua_min.x if s_sign < 0 else ua_max.x) + s_sign * 0.035 * scale,
            (ua_max.y + fa_max.y) * 0.5 - 0.015 * scale,
            (ua_min.z + fa_max.z) * 0.5,
        ))
        wrist_pivot = Vector((
            ha_c.x,
            ha_c.y + 0.008 * scale,
            ha_max.z - 0.010 * scale,
        ))
        hand_tip = Vector((ha_c.x, ha_c.y, ha_min.z))

        specs[f"shoulder.{side}"] = (sh_head, sh_pivot)
        specs[f"arm.{side}"] = (sh_pivot.copy(), elbow_pivot)
        specs[f"forearm.{side}"] = (elbow_pivot.copy(), wrist_pivot)
        specs[f"hand.{side}"] = (wrist_pivot.copy(), hand_tip)

    # Legs (thigh -> shin -> foot -> toe)
    for side, s_sign in (("L", -1.0), ("R", 1.0)):
        th_min, th_max, th_c = _bounds(f"Victor_Thigh_{side}", Vector((s_sign * 0.075, 0.0, 0.300)))
        sh_min, sh_max, sh_c = _bounds(f"Victor_Shin_{side}", Vector((s_sign * 0.083, 0.0, 0.160)))
        fu_min, fu_max, fu_c = _bounds(f"Victor_ShoeUpper_{side}", Vector((s_sign * 0.088, -0.024, 0.048)))
        so_min, so_max, so_c = _bounds(f"Victor_ShoeSole_{side}", Vector((s_sign * 0.088, -0.028, 0.016)))

        hip_pivot = Vector((th_c.x, th_c.y, th_max.z - 0.020 * scale))
        knee_pivot = Vector((sh_c.x, sh_c.y, (th_min.z + sh_max.z) * 0.5))
        ankle_pivot = Vector((fu_c.x, sh_c.y, sh_min.z + 0.010 * scale))
        ball_pivot = Vector((so_c.x, so_c.y - 0.030 * scale, so_min.z + 0.020 * scale))
        toe_tip = Vector((so_c.x, so_min.y, so_min.z + 0.012 * scale))

        specs[f"thigh.{side}"] = (hip_pivot, knee_pivot)
        specs[f"shin.{side}"] = (knee_pivot.copy(), ankle_pivot)
        specs[f"foot.{side}"] = (ankle_pivot.copy(), ball_pivot)
        specs[f"toe.{side}"] = (ball_pivot.copy(), toe_tip)

    # Scarf chain (scarf.01 -> scarf.02 -> scarf.03)
    sc1_min, sc1_max, sc1_c = _bounds("Victor_ScarfCollar", Vector((0.0, -0.004, 0.698)))
    sc2_min, sc2_max, sc2_c = _bounds("Victor_ScarfMid", Vector((0.13, 0.17, 0.65)))
    sc3_min, sc3_max, sc3_c = _bounds("Victor_ScarfTail", Vector((0.28, 0.32, 0.62)))

    sc1_head = Vector((0.02 * scale, sc1_max.y - 0.02 * scale, sc1_c.z))
    sc1_tail = Vector((sc2_c.x, sc2_c.y, sc2_c.z))
    sc2_tail = Vector((sc3_min.x + 0.02 * scale, sc3_min.y + 0.02 * scale, sc3_c.z))
    sc3_tail = Vector((sc3_max.x, sc3_max.y, sc3_c.z))

    specs["scarf.01"] = (sc1_head, sc1_tail)
    specs["scarf.02"] = (sc1_tail.copy(), sc2_tail)
    specs["scarf.03"] = (sc2_tail.copy(), sc3_tail)

    return specs


def create_victor_armature(
    name: str = "VictorArmature",
    bone_specs: dict[str, tuple[Vector, Vector]] | None = None,
    collection: bpy.types.Collection | str | None = None,
) -> bpy.types.Object:
    """Create Victor's canonical 26-bone armature (24-bone spec + L/R symmetry)."""
    if bone_specs is None:
        bone_specs = {b: (Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.1))) for b in CANONICAL_BONES}

    arm_data = bpy.data.armatures.new(name)
    arm_data.display_type = "OCTAHEDRAL"
    arm_obj = bpy.data.objects.new(name, arm_data)
    vn_scene.link_object(arm_obj, collection)

    view_layer = bpy.context.view_layer
    prev_active = view_layer.objects.active
    view_layer.objects.active = arm_obj
    arm_obj.select_set(True)

    try:
        bpy.ops.object.mode_set(mode="EDIT")
        edit_bones = arm_data.edit_bones
        created: dict[str, bpy.types.EditBone] = {}

        for b_name in CANONICAL_BONES:
            head_pt, tail_pt = bone_specs[b_name]
            eb = edit_bones.new(b_name)
            eb.head = head_pt
            if (tail_pt - head_pt).length < 1e-4:
                tail_pt = head_pt + Vector((0.0, 0.0, 0.05))
            eb.tail = tail_pt
            eb.use_deform = True
            created[b_name] = eb

        for b_name in CANONICAL_BONES:
            parent_name, use_connect = BONE_HIERARCHY[b_name]
            if parent_name is not None:
                created[b_name].parent = created[parent_name]
                created[b_name].use_connect = use_connect

        # Align bone rolls consistently so local X = pitch (forward/back), local Y = twist, local Z = yaw
        bpy.ops.armature.select_all(action="SELECT")
        bpy.ops.armature.calculate_roll(type="GLOBAL_POS_Y")
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")
        view_layer.objects.active = prev_active

    for pbone in arm_obj.pose.bones:
        pbone.rotation_mode = "XYZ"

    return arm_obj


def _smooth_torso_weights(obj: bpy.types.Object) -> None:
    """Blend `Victor_TorsoTee` smoothly between `hips`/`spine` and `spine.001` along Z."""
    verts = obj.data.vertices
    if not verts:
        return
    obj.vertex_groups.clear()
    vg_hips = obj.vertex_groups.new(name="hips")
    vg_spine = obj.vertex_groups.new(name="spine")
    vg_sp01 = obj.vertex_groups.new(name="spine.001")

    zs = [v.co.z for v in verts]
    z_min, z_max = min(zs), max(zs)
    span = max(z_max - z_min, 1e-4)

    for v in verts:
        t = (v.co.z - z_min) / span
        if t < 0.20:
            w_hips = 0.5 * (1.0 - t / 0.20)
            w_spine = 1.0 - w_hips
            vg_hips.add([v.index], w_hips, "REPLACE")
            vg_spine.add([v.index], w_spine, "REPLACE")
        elif t < 0.70:
            u = (t - 0.20) / 0.50
            vg_spine.add([v.index], 1.0 - u, "REPLACE")
            vg_sp01.add([v.index], u, "REPLACE")
        else:
            vg_sp01.add([v.index], 1.0, "REPLACE")


def _smooth_neck_weights(obj: bpy.types.Object) -> None:
    """Blend `Victor_Neck` smoothly between `spine.001`, `neck`, and `head` along Z."""
    verts = obj.data.vertices
    if not verts:
        return
    obj.vertex_groups.clear()
    vg_sp01 = obj.vertex_groups.new(name="spine.001")
    vg_neck = obj.vertex_groups.new(name="neck")
    vg_head = obj.vertex_groups.new(name="head")

    zs = [v.co.z for v in verts]
    z_min, z_max = min(zs), max(zs)
    span = max(z_max - z_min, 1e-4)

    for v in verts:
        t = (v.co.z - z_min) / span
        if t < 0.35:
            u = t / 0.35
            vg_sp01.add([v.index], 1.0 - u, "REPLACE")
            vg_neck.add([v.index], u, "REPLACE")
        elif t < 0.75:
            vg_neck.add([v.index], 1.0, "REPLACE")
        else:
            u = (t - 0.75) / 0.25
            vg_neck.add([v.index], 1.0 - u, "REPLACE")
            vg_head.add([v.index], u, "REPLACE")


def _enforce_rigid_bone_group_weights(obj: bpy.types.Object) -> None:
    """Ensure 100% weight on `obj['bone_group']` (essential for outline hulls and rigid parts)."""
    bone_group = str(obj.get("bone_group", ""))
    if bone_group not in CANONICAL_BONES:
        raise ValueError(f"Object {obj.name!r} has invalid bone_group={bone_group!r}")
    obj.vertex_groups.clear()
    vg = obj.vertex_groups.new(name=bone_group)
    verts = obj.data.vertices
    if len(verts) > 0:
        vg.add(list(range(len(verts))), 1.0, "REPLACE")


def _verify_vertex_weights(mesh_objs: Iterable[bpy.types.Object]) -> dict:
    """Verify every vertex across all rigged meshes has normalized weight sum == 1.0."""
    total_verts = 0
    unweighted_verts = 0
    max_weight_err = 0.0

    for obj in mesh_objs:
        if obj.type != "MESH" or obj.data is None:
            continue
        vg_names = {vg.index: vg.name for vg in obj.vertex_groups}
        for v in obj.data.vertices:
            total_verts += 1
            w_sum = sum(g.weight for g in v.groups if vg_names.get(g.group) in CANONICAL_BONES)
            if w_sum <= 1e-5:
                unweighted_verts += 1
            max_weight_err = max(max_weight_err, abs(w_sum - 1.0))

    if unweighted_verts > 0 or max_weight_err > 1e-3:
        raise RuntimeError(
            f"Skinning weight validation failed: unweighted={unweighted_verts}, max_err={max_weight_err:.5f}"
        )
    return {
        "total_vertices": total_verts,
        "unweighted_vertices": unweighted_verts,
        "max_weight_error": max_weight_err,
    }


def apply_clean_skinning(
    armature_obj: bpy.types.Object,
    mesh_objs: Iterable[bpy.types.Object],
    join_palette_meshes: bool = True,
    collection: bpy.types.Collection | str | None = None,
) -> dict:
    """Assign deterministic weights, bind meshes to `armature_obj`, and optionally join palette parts."""
    meshes = [o for o in mesh_objs if o.type == "MESH" and o.data is not None]
    for obj in meshes:
        if obj.name == "Victor_TorsoTee":
            _smooth_torso_weights(obj)
        elif obj.name == "Victor_Neck":
            _smooth_neck_weights(obj)
        else:
            _enforce_rigid_bone_group_weights(obj)

    face_names = {"VictorEye.L", "VictorEye.R", "VictorMouth"}
    final_meshes: list[bpy.types.Object] = []

    if join_palette_meshes:
        palette_parts = [o for o in meshes if o.name not in face_names]
        face_parts = [o for o in meshes if o.name in face_names]

        if palette_parts:
            view_layer = bpy.context.view_layer
            bpy.ops.object.select_all(action="DESELECT")
            for o in palette_parts:
                o.select_set(True)
            view_layer.objects.active = palette_parts[0]
            bpy.ops.object.join()
            body_obj = view_layer.objects.active
            body_obj.name = "Victor_Body"
            if body_obj.data is not None:
                body_obj.data.name = "Victor_Body"
            if collection is not None:
                vn_scene.link_object(body_obj, collection)
            final_meshes.append(body_obj)

        final_meshes.extend(face_parts)
    else:
        final_meshes = meshes

    for obj in final_meshes:
        obj.parent = armature_obj
        obj.matrix_parent_inverse.identity()
        mod = obj.modifiers.get("Armature") or obj.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = armature_obj
        mod.use_vertex_groups = True
        mod.use_deform_preserve_volume = True

    weight_stats = _verify_vertex_weights(final_meshes)
    return {
        "meshes": final_meshes,
        "mesh_names": [o.name for o in final_meshes],
        "bone_count": len(armature_obj.data.bones),
        **weight_stats,
    }


def reset_pose(armature_obj: bpy.types.Object) -> None:
    """Reset all pose bones to rest transform."""
    for pbone in armature_obj.pose.bones:
        pbone.location = (0.0, 0.0, 0.0)
        pbone.rotation_mode = "XYZ"
        pbone.rotation_euler = (0.0, 0.0, 0.0)
        pbone.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()


def apply_pose_deg(
    armature_obj: bpy.types.Object,
    pose_deg: dict[str, tuple[float, float, float]],
    hips_offset: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> None:
    """Reset to rest, then apply Euler XYZ rotations (in degrees) per bone and hips offset."""
    reset_pose(armature_obj)
    for b_name, rot_deg in pose_deg.items():
        pbone = armature_obj.pose.bones.get(b_name)
        if pbone is None:
            raise KeyError(f"Pose bone not found: {b_name!r}")
        pbone.rotation_mode = "XYZ"
        pbone.rotation_euler = Euler(
            (math.radians(rot_deg[0]), math.radians(rot_deg[1]), math.radians(rot_deg[2])),
            "XYZ",
        )
    hips_bone = armature_obj.pose.bones.get("hips")
    if hips_bone is not None:
        hips_bone.location = Vector(hips_offset)
    bpy.context.view_layer.update()
