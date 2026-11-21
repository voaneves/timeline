"""Toy-diorama bevel, smooth shading, and weighted-normal utilities (Blender 5.x).

Implements the shared surface-finish rules for the paper-and-toy art language:
  - Bevel widths default to 8-15% of the smallest positive mesh dimension.
  - 2-3 bevel segments with overlap clamping and affected face-strength marking.
  - Smooth shading + outside normals + Weighted Normal (Blender 4.1+/5.x native,
    without deprecated `use_auto_smooth`).
"""

from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix


def _ensure_mesh_object(obj: bpy.types.Object) -> bpy.types.Mesh:
    if obj is None or obj.type != "MESH" or obj.data is None:
        raise TypeError(f"Expected a MESH object with valid mesh data, got {obj!r}")
    return obj.data


def _mesh_dimensions(obj: bpy.types.Object) -> tuple[float, float, float]:
    """Compute exact object dimensions in meters directly from vertex coordinates."""
    mesh = _ensure_mesh_object(obj)
    n_verts = len(mesh.vertices)
    if n_verts == 0:
        return (0.0, 0.0, 0.0)

    coords = np.empty(n_verts * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", coords)
    pts = coords.reshape((n_verts, 3))
    extents = pts.max(axis=0) - pts.min(axis=0)
    sx, sy, sz = (abs(float(obj.scale[i])) for i in range(3))
    return (
        float(extents[0]) * sx,
        float(extents[1]) * sy,
        float(extents[2]) * sz,
    )


def _apply_modifier(obj: bpy.types.Object, mod_name: str) -> None:
    """Apply a named modifier on `obj` while preserving selection and active state."""
    view_layer = bpy.context.view_layer
    scene = bpy.context.scene

    prev_active = view_layer.objects.active
    prev_mode = prev_active.mode if prev_active is not None else "OBJECT"
    prev_selected = [o for o in scene.objects if o.select_get()]

    temp_linked = False
    if obj.name not in view_layer.objects:
        scene.collection.objects.link(obj)
        temp_linked = True

    prev_hide_vp = obj.hide_viewport
    prev_hide_sel = obj.hide_select

    try:
        if prev_active is not None and prev_mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")

        obj.hide_viewport = False
        obj.hide_select = False
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod_name)
    finally:
        obj.hide_viewport = prev_hide_vp
        obj.hide_select = prev_hide_sel
        if temp_linked and obj.name in scene.collection.objects:
            scene.collection.objects.unlink(obj)

        bpy.ops.object.select_all(action="DESELECT")
        for item in prev_selected:
            try:
                item.select_set(True)
            except ReferenceError:
                pass
        try:
            view_layer.objects.active = prev_active
            if prev_active is not None and prev_mode != "OBJECT":
                bpy.ops.object.mode_set(mode=prev_mode)
        except (ReferenceError, RuntimeError):
            pass


def apply_scale(obj: bpy.types.Object) -> bpy.types.Object:
    """Bake object scale into mesh vertices and reset scale to (1, 1, 1)."""
    mesh = _ensure_mesh_object(obj)
    sx, sy, sz = float(obj.scale.x), float(obj.scale.y), float(obj.scale.z)
    if (
        abs(sx - 1.0) < 1e-6
        and abs(sy - 1.0) < 1e-6
        and abs(sz - 1.0) < 1e-6
    ):
        return obj

    scale_mat = Matrix.Diagonal((sx, sy, sz, 1.0))
    mesh.transform(scale_mat)
    obj.scale = (1.0, 1.0, 1.0)

    if sx * sy * sz < 0.0:
        mesh.flip_normals()
    mesh.update()
    return obj


def set_smooth_shading(obj: bpy.types.Object, smooth: bool = True) -> bpy.types.Object:
    """Enable or disable smooth polygon shading using Blender 5.x native mesh API."""
    mesh = _ensure_mesh_object(obj)
    n_polys = len(mesh.polygons)
    if n_polys > 0:
        mesh.polygons.foreach_set("use_smooth", [bool(smooth)] * n_polys)
        mesh.update()
    return obj


def recalc_outside_normals(obj: bpy.types.Object) -> bpy.types.Object:
    """Recalculate consistent outward-pointing face normals via BMesh."""
    mesh = _ensure_mesh_object(obj)
    if len(mesh.polygons) == 0:
        return obj

    # Preserve polygon face_strength attribute if written by a prior Bevel modifier.
    saved_face_strength = None
    fs_attr = mesh.attributes.get("face_strength")
    if fs_attr is not None and fs_attr.domain == "FACE" and len(fs_attr.data) == len(mesh.polygons):
        saved_face_strength = np.empty(len(mesh.polygons), dtype=np.int32)
        fs_attr.data.foreach_get("value", saved_face_strength)

    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
    finally:
        bm.free()

    if saved_face_strength is not None and len(mesh.polygons) == len(saved_face_strength):
        fs_attr_after = mesh.attributes.get("face_strength")
        if fs_attr_after is None:
            fs_attr_after = mesh.attributes.new(
                name="face_strength", type="INT", domain="FACE"
            )
        fs_attr_after.data.foreach_set("value", saved_face_strength)

    mesh.update()
    return obj


def apply_bevel(
    obj: bpy.types.Object,
    width: float | None = None,
    ratio: float = 0.10,
    segments: int = 3,
    limit_method: str = "ANGLE",
    angle_deg: float = 30.0,
    clamp_overlap: bool = True,
    apply: bool = True,
) -> bpy.types.Object:
    """Add (and optionally apply) a clean Bevel modifier sized to the mesh.

    When `width` is None, computes `ratio * min_positive_dimension` automatically.
    Marks affected face strengths (`FSTR_AFFECTED`) so a subsequent Weighted Normal
    modifier keeps planar faces crisp and free of shading pillowing.
    """
    _ensure_mesh_object(obj)

    if width is None:
        dims = _mesh_dimensions(obj)
        pos_dims = [d for d in dims if d > 1e-6]
        min_dim = min(pos_dims) if pos_dims else 0.1
        bevel_width = max(1e-4, float(ratio) * min_dim)
    else:
        bevel_width = float(width)

    seg_count = int(segments)
    if bevel_width <= 0.0 or seg_count <= 0:
        return obj

    mod = obj.modifiers.new(name="VN_Bevel", type="BEVEL")
    mod.offset_type = "OFFSET"
    mod.width = bevel_width
    mod.segments = seg_count
    mod.limit_method = limit_method
    if limit_method == "ANGLE":
        mod.angle_limit = math.radians(float(angle_deg))
    mod.use_clamp_overlap = bool(clamp_overlap)
    if hasattr(mod, "harden_normals"):
        mod.harden_normals = False
    if hasattr(mod, "face_strength_mode"):
        mod.face_strength_mode = "FSTR_AFFECTED"

    if apply:
        _apply_modifier(obj, mod.name)
    return obj


def apply_weighted_normals(
    obj: bpy.types.Object,
    weight: int = 50,
    keep_sharp: bool = True,
    face_influence: bool = True,
    apply: bool = True,
) -> bpy.types.Object:
    """Recalculate outside normals, enable smooth shading, and apply Weighted Normal.

    Uses Blender 5.x native polygon smooth shading + `WEIGHTED_NORMAL` modifier
    (no deprecated `use_auto_smooth`).
    """
    _ensure_mesh_object(obj)
    recalc_outside_normals(obj)
    set_smooth_shading(obj, True)

    mod = obj.modifiers.new(name="VN_WeightedNormal", type="WEIGHTED_NORMAL")
    mod.mode = "FACE_AREA"
    mod.weight = max(1, min(100, int(weight)))
    mod.keep_sharp = bool(keep_sharp)
    if hasattr(mod, "use_face_influence"):
        mod.use_face_influence = bool(face_influence)

    if apply:
        _apply_modifier(obj, mod.name)
    return obj


def finalize_toy_mesh(
    obj: bpy.types.Object,
    bevel_width: float | None = None,
    bevel_ratio: float = 0.10,
    bevel_segments: int = 3,
    apply: bool = True,
) -> bpy.types.Object:
    """Run the complete toy-diorama mesh finish pipeline on `obj`.

    Steps:
      1. Bake object scale into mesh geometry (`apply_scale`).
      2. Recalculate consistent outside normals (`recalc_outside_normals`).
      3. Apply angle-limited bevel (`apply_bevel`) when segments > 0 and width > 0.
      4. Apply smooth shading and area-weighted normals (`apply_weighted_normals`).
    """
    _ensure_mesh_object(obj)
    apply_scale(obj)
    recalc_outside_normals(obj)

    if int(bevel_segments) > 0 and (bevel_width is None or float(bevel_width) > 0.0):
        apply_bevel(
            obj,
            width=bevel_width,
            ratio=bevel_ratio,
            segments=bevel_segments,
            limit_method="ANGLE",
            angle_deg=30.0,
            clamp_overlap=True,
            apply=apply,
        )

    apply_weighted_normals(
        obj,
        weight=50,
        keep_sharp=True,
        face_influence=True,
        apply=apply,
    )
    return obj
