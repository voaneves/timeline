"""Verification script for Task T2.1b (`vn_bevel.py` & `vn_shapes.py`).

Builds a 4-shape showcase (`rounded_box`, `blob`, `tube`, `ribbon`), verifies
`make_boolean_relief` and BMesh integrity (zero NaNs, zero degenerate faces,
manifold outward normals, valid UVs), renders a 3-view contact sheet to
`game/blender/out/previews/t21b_shapes.png`, and exports `game/blender/out/t21b_shapes.glb`.
"""

from __future__ import annotations

import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import bmesh
import bpy
import numpy as np

from lib import vn_bevel, vn_export, vn_scene, vn_shapes


def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _make_preview_material(
    name: str,
    hex_rgb: str,
    roughness: float = 0.55,
    metallic: float = 0.0,
) -> bpy.types.Material:
    """Create a clean matte toy-diorama preview material from an sRGB hex color."""
    hex_clean = hex_rgb.lstrip("#")
    r = _srgb_to_linear(int(hex_clean[0:2], 16) / 255.0)
    g = _srgb_to_linear(int(hex_clean[2:4], 16) / 255.0)
    b = _srgb_to_linear(int(hex_clean[4:6], 16) / 255.0)

    mat = bpy.data.materials.new(name=name)
    if mat.node_tree is None and hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Roughness"].default_value = float(roughness)
        bsdf.inputs["Metallic"].default_value = float(metallic)
    return mat


def _assign_material(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def check_mesh_integrity(obj: bpy.types.Object, require_manifold: bool = True) -> dict:
    """Inspect a mesh object via BMesh + evaluated normals and assert clean geometry."""
    mesh = obj.data
    assert mesh is not None and len(mesh.vertices) > 0, f"{obj.name}: empty mesh"
    assert len(mesh.polygons) > 0, f"{obj.name}: zero polygons"

    # 1. Zero NaN / Inf vertex coordinates.
    coords = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", coords)
    nan_verts = int(np.count_nonzero(~np.isfinite(coords)))
    assert nan_verts == 0, f"{obj.name}: found {nan_verts} NaN/Inf vertex coordinates"

    # 2. BMesh topology, degenerate faces, manifold edges, and signed volume check.
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.faces.ensure_lookup_table()

        zero_area_faces = 0
        bad_normal_faces = 0
        for face in bm.faces:
            area = face.calc_area()
            if not math.isfinite(area) or area <= 1e-8:
                zero_area_faces += 1
            face.normal_update()
            n_len = face.normal.length
            if not math.isfinite(n_len) or n_len < 0.99:
                bad_normal_faces += 1

        non_manifold_edges = sum(1 for e in bm.edges if not e.is_manifold)
        signed_volume = float(bm.calc_volume(signed=True))

        # Check consistent outward orientation by confirming no inverted winding
        # after a hypothetical recalc_face_normals comparison.
        orig_normals = [f.normal.copy() for f in bm.faces]
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        inverted_faces = sum(
            1
            for f, orig_n in zip(bm.faces, orig_normals)
            if f.normal.dot(orig_n) < 0.0
        )
    finally:
        bm.free()

    # 3. Triangle count & finite evaluated loop normals.
    mesh.calc_loop_triangles()
    tri_count = len(mesh.loop_triangles)

    corner_normals = np.empty(len(mesh.loops) * 3, dtype=np.float32)
    mesh.corner_normals.foreach_get("vector", corner_normals)
    cn = corner_normals.reshape((-1, 3))
    nan_normals = int(np.count_nonzero(~np.isfinite(cn)))
    cn_lens = np.linalg.norm(cn, axis=1)
    zero_normals = int(np.count_nonzero(cn_lens < 0.95))

    assert zero_area_faces == 0, f"{obj.name}: {zero_area_faces} zero-area faces"
    assert bad_normal_faces == 0, f"{obj.name}: {bad_normal_faces} invalid face normals"
    assert inverted_faces == 0, f"{obj.name}: {inverted_faces} inverted face normals"
    assert signed_volume > 0.0, f"{obj.name}: non-positive signed volume ({signed_volume:.6f})"
    assert nan_normals == 0, f"{obj.name}: {nan_normals} NaN corner normals"
    assert zero_normals == 0, f"{obj.name}: {zero_normals} degenerate corner normals"
    if require_manifold:
        assert non_manifold_edges == 0, f"{obj.name}: {non_manifold_edges} non-manifold edges"

    return {
        "name": obj.name,
        "verts": len(mesh.vertices),
        "faces": len(mesh.polygons),
        "tris": tri_count,
        "non_manifold_edges": non_manifold_edges,
        "signed_volume": signed_volume,
        "zero_area_faces": zero_area_faces,
        "inverted_faces": inverted_faces,
    }


def verify_boolean_relief() -> None:
    """Unit-check `make_boolean_relief` for UNION and DIFFERENCE operations."""
    vn_scene.reset_scene("T21b_BoolCheck")

    block = vn_shapes.make_rounded_box(
        "bool_block", size=(1.0, 1.0, 1.0), location=(0.0, 0.0, 0.0), bevel_ratio=0.10
    )
    dot_cutter = vn_shapes.make_rounded_box(
        "bool_dot", size=(0.24, 0.24, 0.24), location=(0.0, -0.48, 0.50), pivot="CENTER", bevel_ratio=0.15
    )
    vn_shapes.make_boolean_relief(block, dot_cutter, operation="UNION", apply=True, remove_cutter=True)
    union_stats = check_mesh_integrity(block, require_manifold=True)

    recess_cutter = vn_shapes.make_rounded_box(
        "bool_recess", size=(0.30, 0.24, 0.30), location=(0.0, 0.48, 0.50), pivot="CENTER", bevel_ratio=0.12
    )
    vn_shapes.make_boolean_relief(block, recess_cutter, operation="DIFFERENCE", apply=True, remove_cutter=True)
    diff_stats = check_mesh_integrity(block, require_manifold=True)

    print(
        f"[t21b] boolean_relief PASS | after UNION: {union_stats['tris']} tris "
        f"(vol={union_stats['signed_volume']:.4f}) | after DIFFERENCE: {diff_stats['tris']} tris "
        f"(vol={diff_stats['signed_volume']:.4f})"
    )


def main() -> None:
    # Step 1: Verify boolean relief helper cleanly before building the 4-shape showcase.
    verify_boolean_relief()

    # Step 2: Reset scene and create the 4-shape art-foundation showcase.
    vn_scene.reset_scene("T21b_ShapesShowcase")
    col = vn_scene.ensure_collection("T21b_Shapes")

    mat_paper = _make_preview_material("Paper_Cream", "#f4ead4", roughness=0.52)
    mat_cerrado = _make_preview_material("Cerrado_Green", "#9aa84a", roughness=0.58)
    mat_copper = _make_preview_material("Pipe_Copper", "#b8733a", roughness=0.38, metallic=0.18)
    mat_signal = _make_preview_material("Signal_Red", "#f50000", roughness=0.45)

    # 1. Rounded Box (bevel 12% of smallest dim, 3 segments, ground pivot).
    box = vn_shapes.make_rounded_box(
        "rounded_box",
        size=(1.10, 1.10, 1.10),
        location=(-2.85, 0.0, 0.0),
        bevel_ratio=0.12,
        segments=3,
        pivot="BOTTOM",
        collection=col,
    )
    _assign_material(box, mat_paper)

    # 2. Organic multi-lobe Blob (5 default lobes, voxel remesh + smooth + decimate).
    blob = vn_shapes.make_blob(
        "blob",
        radius=0.58,
        resolution=0.08,
        decimate_ratio=0.45,
        location=(-0.95, 0.0, 0.0),
        smooth_iterations=2,
        collection=col,
    )
    _assign_material(blob, mat_cerrado)

    # 3. Hollow lipped Tube (chunky 0.10 m walls, ground pivot, beveled rims).
    tube = vn_shapes.make_tube(
        "tube",
        radius=0.50,
        height=1.20,
        wall_thickness=0.10,
        lip_height=0.22,
        lip_outset=0.10,
        segments=24,
        bevel_width=0.025,
        location=(0.95, 0.0, 0.0),
        collection=col,
    )
    _assign_material(tube, mat_copper)

    # 4. Continuous beveled 3D Ribbon ("a Linha") with clean length-aligned UVs.
    ribbon_pts = [
        (2.35, -1.25, 0.00),
        (2.85, -0.45, 0.30),
        (2.45, 0.45, 0.65),
        (2.95, 1.25, 0.25),
    ]
    ribbon = vn_shapes.make_ribbon(
        "ribbon",
        points=ribbon_pts,
        width=0.35,
        thickness=0.05,
        step=0.20,
        elevation=0.02,
        bevel_width=0.010,
        collection=col,
    )
    _assign_material(ribbon, mat_signal)

    # Verify ribbon UVs cover u in [0, 1] and v in [0, 1].
    uv_layer = ribbon.data.uv_layers.active
    assert uv_layer is not None, "ribbon: missing active UV layer"
    uv_buf = np.empty(len(ribbon.data.loops) * 2, dtype=np.float32)
    uv_layer.data.foreach_get("uv", uv_buf)
    uvs = uv_buf.reshape((-1, 2))
    assert np.all(np.isfinite(uvs)), "ribbon: NaN/Inf UVs"
    u_min, u_max = float(uvs[:, 0].min()), float(uvs[:, 0].max())
    v_min, v_max = float(uvs[:, 1].min()), float(uvs[:, 1].max())
    assert u_min <= 0.01 and u_max >= 0.99, f"ribbon: unexpected U range [{u_min}, {u_max}]"
    assert v_min <= 0.01 and v_max >= 0.99, f"ribbon: unexpected V range [{v_min}, {v_max}]"

    # Step 3: Mesh integrity & tri counts for all 4 showcase objects.
    showcase_objs = (box, blob, tube, ribbon)
    total_tris = 0
    print("[t21b] --- Mesh Integrity & Tri Counts ---")
    for obj in showcase_objs:
        info = check_mesh_integrity(obj, require_manifold=True)
        total_tris += info["tris"]
        print(
            f"[t21b] {info['name']:12s} | {info['tris']:5d} tris | "
            f"{info['verts']:5d} verts | vol={info['signed_volume']:.4f} | "
            f"non_manifold={info['non_manifold_edges']} | "
            f"zero_area={info['zero_area_faces']} | inverted={info['inverted_faces']}"
        )
    print(f"[t21b] TOTAL        | {total_tris:5d} tris | ribbon UV u=[{u_min:.2f},{u_max:.2f}] v=[{v_min:.2f},{v_max:.2f}]")

    # Step 4: Render 3-view preview contact sheet.
    preview_path = os.path.join(SCRIPT_DIR, "out", "previews", "t21b_shapes.png")
    render_info = vn_scene.render_3views(
        preview_path,
        size=640,
    )
    assert os.path.isfile(render_info["filepath"]), "Preview PNG was not written"

    # Step 5: Export GLB and verify exported triangle count.
    glb_path = os.path.join(SCRIPT_DIR, "out", "t21b_shapes.glb")
    glb_info = vn_export.export_glb(glb_path, collections=[col])
    assert os.path.isfile(glb_info["filepath"]), "GLB file was not written"
    assert glb_info["triangles"] == total_tris, (
        f"GLB tri mismatch: expected {total_tris}, got {glb_info['triangles']}"
    )
    print(f"[t21b] ALL CHECKS PASSED | preview={render_info['filepath']} | glb={glb_info['filepath']}")


if __name__ == "__main__":
    main()
