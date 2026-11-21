"""Self-test for T2.1a (vn_scene + vn_export).

Run:
    blender.exe -b -P game/blender/test_t21a.py
"""

from __future__ import annotations

import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from lib import (
    ensure_collection,
    export_glb,
    inspect_glb,
    link_object,
    render_3views,
    reset_scene,
    save_blend,
    set_custom_props,
)


def main() -> None:
    scene = reset_scene("T21aProbe")
    assert scene.unit_settings.system == "METRIC"
    assert scene.unit_settings.scale_length == 1.0

    col_visual = ensure_collection("Visual")
    col_refs = ensure_collection("References")

    # 1 m cube sitting on ground (z = 0.5 in Blender -> y = 0.5 in engine)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.5))
    cube = bpy.context.active_object
    cube.name = "probeCubeVisual"
    link_object(cube, col_visual)

    # Palette material with an image texture node to verify mute/restore on export.
    mat = bpy.data.materials.new("palette")
    if mat.node_tree is None and hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    tex_node = nodes.new("ShaderNodeTexImage")
    tex_node.name = "PaletteTex"
    img = bpy.data.images.new("palette_probe", width=2, height=2)
    img.pixels = [0.95, 0.92, 0.83, 1.0] * 4
    tex_node.image = img
    if bsdf is not None:
        mat.node_tree.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    cube.data.materials.append(mat)

    # Empty with custom props -> glTF node.extras -> Three.js userData.
    ref_crate = bpy.data.objects.new("refCrate1", None)
    ref_crate.empty_display_type = "PLAIN_AXES"
    ref_crate.empty_display_size = 0.5
    ref_crate.location = (1.5, 0.0, 0.5)
    set_custom_props(
        ref_crate,
        {"mass": 2, "friction": 0.4, "category": "object"},
    )
    link_object(ref_crate, col_refs)

    out_dir = os.path.join(HERE, "out")
    glb_path = os.path.join(out_dir, "t21a_probe.glb")
    blend_path = os.path.join(out_dir, "t21a_probe.blend")
    preview_path = os.path.join(out_dir, "previews", "t21a_probe.png")

    # Verify preview utility (3-view Eevee render) cleans up after itself.
    preview_info = render_3views(preview_path, target=(0.0, 0.0, 0.5), radius=1.2, size=256)
    assert os.path.isfile(preview_path) and os.path.getsize(preview_path) > 0
    assert preview_info["width"] == 768 and preview_info["height"] == 256
    assert "_PreviewRig" not in bpy.data.collections

    # Export GLB and verify palette texture mute was restored afterwards.
    stats = export_glb(glb_path, collections=[col_visual, col_refs])
    assert tex_node.mute is False, "Palette image node mute state was not restored"
    assert stats["triangles"] == 12, f"Expected 12 tris for cube, got {stats['triangles']}"

    # Verify GLB node extras and muted palette texture directly as well.
    info = inspect_glb(glb_path)
    assert not info["gltf"].get("images"), f"Expected palette image muted, got {info['gltf'].get('images')}"
    nodes_by_name = {n.get("name"): n for n in info["gltf"].get("nodes", [])}
    assert "refCrate1" in nodes_by_name, f"Missing refCrate1 in {list(nodes_by_name)}"
    extras = nodes_by_name["refCrate1"].get("extras", {})
    assert extras.get("mass") == 2, extras
    assert abs(float(extras.get("friction", 0)) - 0.4) < 1e-6, extras
    assert extras.get("category") == "object", extras

    # Verify .blend saving works cleanly.
    save_blend(blend_path)
    assert os.path.isfile(blend_path) and os.path.getsize(blend_path) > 0

    print("TEST_T21A_BLENDER_OK", {"glb": glb_path, "extras": extras, "stats": stats})


if __name__ == "__main__":
    main()
