"""Self-test for T2.1d (R1 Manual Override system: vn_manual.py).

Verifies that a hand-edited cube saved in a manual override `.blend` survives
a full scene regeneration from scratch, preserving custom properties, parent
hierarchy, and collection membership.

Run:
    blender.exe -b -P game/blender/test_t21d.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from lib import vn_export, vn_manual, vn_scene


def _make_standard_cube(name: str = "HeroBox") -> bpy.types.Object:
    """Create a 1x1x1 m cube with ground pivot at z=0 (verts in z=[0, 1])."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0.0, 0.0, 0.5))
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = (0.0, 0.0, 0.0)
    vn_scene.link_object(obj, "Visual")
    return obj


def _mesh_tri_count(obj: bpy.types.Object) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    eval_obj = obj.evaluated_get(depsgraph)
    eval_mesh = eval_obj.to_mesh()
    try:
        eval_mesh.calc_loop_triangles()
        return len(eval_mesh.loop_triangles)
    finally:
        eval_obj.to_mesh_clear()


def _world_bbox_max_z(obj: bpy.types.Object) -> float:
    bpy.context.view_layer.update()
    return max((obj.matrix_world @ Vector(corner)).z for corner in obj.bound_box)


def _sculpt_hand_edited_shape(obj: bpy.types.Object, target_max_z: float = 2.5) -> None:
    """Simulate a human edit: subdivide cube and extrude a stepped tower to target_max_z."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)

    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    bm.faces.ensure_lookup_table()

    top_faces = [f for f in bm.faces if f.normal.z > 0.9 and f.calc_center_median().z > 0.99]
    assert top_faces, "Expected top faces after subdivision"

    # Extrude the center top face upward so max Z reaches target_max_z (2.5 m).
    center_top = min(
        top_faces,
        key=lambda f: f.calc_center_median().x ** 2 + f.calc_center_median().y ** 2,
    )
    res = bmesh.ops.extrude_face_region(bm, geom=[center_top])
    extruded_verts = [ele for ele in res["geom"] if isinstance(ele, bmesh.types.BMVert)]
    dz = target_max_z - 1.0
    bmesh.ops.translate(bm, verts=extruded_verts, vec=(0.0, 0.0, dz))

    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def main() -> None:
    out_dir = HERE / "out"
    tmp_manual_dir = out_dir / "t21d_manual"
    glb_path = out_dir / "t21d_result.glb"

    # ------------------------------------------------------------------ Pass 1
    vn_scene.reset_scene("T21dPass1")
    hero_p1 = _make_standard_cube("HeroBox")
    assert len(hero_p1.data.vertices) == 8, f"Expected 8 verts, got {len(hero_p1.data.vertices)}"
    assert _mesh_tri_count(hero_p1) == 12, f"Expected 12 tris, got {_mesh_tri_count(hero_p1)}"
    assert abs(_world_bbox_max_z(hero_p1) - 1.0) < 1e-4

    # Verify clean no-op when no override exists yet.
    noop = vn_manual.apply_manual_overrides("nonexistent_t21d_asset", manual_dir=tmp_manual_dir)
    assert noop["skipped"] is True and noop["applied"] == [], f"Unexpected no-op report: {noop}"

    # Simulate hand-editing the cube and saving it into the manual folder.
    _sculpt_hand_edited_shape(hero_p1, target_max_z=2.5)
    edited_tris = _mesh_tri_count(hero_p1)
    edited_max_z = _world_bbox_max_z(hero_p1)
    assert edited_tris > 24, f"Expected edited tris > 24, got {edited_tris}"
    assert abs(edited_max_z - 2.5) < 1e-4, f"Expected edited max Z == 2.5, got {edited_max_z}"

    manual_blend = vn_manual.export_for_manual_edit(
        "t21d_asset", [hero_p1], manual_dir=tmp_manual_dir
    )
    assert manual_blend.is_file() and manual_blend.stat().st_size > 0

    # ------------------------------------------------------------------ Pass 2
    # Full regeneration from scratch!
    vn_scene.reset_scene("T21dPass2Regen")
    col_visual = vn_scene.ensure_collection("Visual")

    root = bpy.data.objects.new("AssetRoot", None)
    vn_scene.link_object(root, col_visual)

    hero_p2 = _make_standard_cube("HeroBox")
    hero_p2.parent = root
    vn_scene.set_custom_props(hero_p2, {"mass": 3, "category": "prop"})

    assert _mesh_tri_count(hero_p2) == 12
    assert abs(_world_bbox_max_z(hero_p2) - 1.0) < 1e-4

    # Apply manual override on top of regenerated scene.
    report = vn_manual.apply_manual_overrides("t21d_asset", manual_dir=tmp_manual_dir)
    assert report["skipped"] is False, report
    assert report["applied"] == ["HeroBox"], report
    assert report["missing"] == [], report

    # Verify override geometry survived full regeneration.
    regen_tris = _mesh_tri_count(hero_p2)
    regen_max_z = _world_bbox_max_z(hero_p2)
    assert regen_tris == edited_tris and regen_tris > 24, (
        f"Manual geometry lost: expected {edited_tris} tris (>24), got {regen_tris}"
    )
    assert abs(regen_max_z - 2.5) < 1e-4, (
        f"Manual height lost: expected max Z ~ 2.5 m, got {regen_max_z}"
    )

    # Verify custom properties, marker tag, parent, collection, and clean orphan removal.
    assert hero_p2.get("mass") == 3, f"Custom prop mass lost: {dict(hero_p2.items())}"
    assert hero_p2.get("category") == "prop", f"Custom prop category lost: {dict(hero_p2.items())}"
    assert hero_p2.get("vn_manual_override") == "t21d_asset.blend", (
        f"Override tag mismatch: {hero_p2.get('vn_manual_override')!r}"
    )
    assert hero_p2.parent is root, "Parent relationship was not preserved"
    assert any(c.name == "Visual" for c in hero_p2.users_collection), "Collection membership lost"
    assert sorted(o.name for o in bpy.data.objects) == ["AssetRoot", "HeroBox"], (
        f"Unexpected leftover objects: {[o.name for o in bpy.data.objects]}"
    )

    # Export GLB and verify exported mesh geometry and extras.
    export_stats = vn_export.export_glb(str(glb_path), collections=[col_visual])
    assert os.path.isfile(glb_path) and os.path.getsize(glb_path) > 0
    assert export_stats["triangles"] == edited_tris and export_stats["triangles"] > 24

    glb_info = vn_export.inspect_glb(str(glb_path))
    gltf = glb_info["gltf"]
    nodes_by_name = {n.get("name"): n for n in gltf.get("nodes", [])}
    assert "HeroBox" in nodes_by_name, f"Missing HeroBox in GLB nodes: {list(nodes_by_name)}"

    hero_node = nodes_by_name["HeroBox"]
    extras = hero_node.get("extras", {})
    assert extras.get("mass") == 3, f"GLB extras missing mass=3: {extras}"
    assert extras.get("vn_manual_override") == "t21d_asset.blend", (
        f"GLB extras missing override marker: {extras}"
    )

    mesh_idx = hero_node["mesh"]
    pos_accessor_idx = gltf["meshes"][mesh_idx]["primitives"][0]["attributes"]["POSITION"]
    pos_max = gltf["accessors"][pos_accessor_idx]["max"]
    # glTF uses +Y up (`export_yup=True`), so Blender +Z (2.5 m) maps to glTF +Y.
    assert abs(float(pos_max[1]) - 2.5) < 1e-4, f"Expected GLB max Y ~ 2.5, got {pos_max}"

    # ------------------------------------------------------------------ Pass 3
    # Verify preserve_transform=True and per-object lookup (asset_name=None).
    vn_scene.reset_scene("T21dPass3Options")
    hero_p3 = _make_standard_cube("HeroBox")
    hero_p3.location = (3.0, -1.0, 0.0)
    report_keep_xform = vn_manual.apply_manual_overrides(
        "t21d_asset",
        manual_dir=tmp_manual_dir,
        preserve_transform=True,
    )
    assert report_keep_xform["applied"] == ["HeroBox"]
    assert _mesh_tri_count(hero_p3) == edited_tris
    assert abs(hero_p3.location.x - 3.0) < 1e-4 and abs(hero_p3.location.y - (-1.0)) < 1e-4

    # Per-object `<object_name>.blend` mode when asset_name is None.
    solo = _make_standard_cube("SoloBox")
    _sculpt_hand_edited_shape(solo, target_max_z=2.5)
    vn_manual.export_for_manual_edit("SoloBox", [solo], manual_dir=tmp_manual_dir)

    vn_scene.reset_scene("T21dPass3PerObject")
    solo_regen = _make_standard_cube("SoloBox")
    per_obj_report = vn_manual.apply_manual_overrides(None, manual_dir=tmp_manual_dir)
    assert per_obj_report["skipped"] is False
    assert per_obj_report["applied"] == ["SoloBox"]
    assert _mesh_tri_count(solo_regen) > 24
    assert abs(_world_bbox_max_z(solo_regen) - 2.5) < 1e-4
    assert solo_regen.get("vn_manual_override") == "SoloBox.blend"

    print(
        "T21D_OVERRIDE_PASS",
        {
            "blend": str(manual_blend),
            "glb": str(glb_path),
            "tris": regen_tris,
            "max_z": round(regen_max_z, 4),
            "glb_max_y": round(float(pos_max[1]), 4),
            "mass": extras.get("mass"),
            "override_tag": extras.get("vn_manual_override"),
        },
    )


if __name__ == "__main__":
    main()
