"""Blender smoke test: new scene, cube + bevel (applied), export glTF binary.
Run: blender -b -P smoke.py
"""
import os
import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=2)
cube = bpy.context.active_object
cube.name = "smokeCube"
mod = cube.modifiers.new("Bevel", "BEVEL")
mod.width = 0.1
mod.segments = 3
bpy.ops.object.modifier_apply(modifier=mod.name)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "smoke.glb")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB")
print("SMOKE_OK", out, len(cube.data.polygons), "polys")
