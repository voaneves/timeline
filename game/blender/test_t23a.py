"""T2.3a verification script: bake vertex Ambient Occlusion (`COLOR_0`) onto the greybox
level, verify per-mesh and binary GLB `COLOR_0` accessor values, and export
`game/blender/out/greybox_ao.glb`.

Run:
    blender.exe -b -P game/blender/test_t23a.py
"""

from __future__ import annotations

import json
import os
import struct
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from eras import greybox  # noqa: E402
from lib import vn_bake_ao, vn_export  # noqa: E402

OUT_DIR = os.path.join(HERE, "out")
OUT_GLB = os.path.join(OUT_DIR, "greybox_ao.glb")
OUT_JSON = os.path.join(OUT_DIR, "t23a_ao_report.json")


def _read_glb_color0_minmax(filepath: str) -> dict:
    """Parse binary GLB accessors for `COLOR_0` across all mesh primitives."""
    with open(filepath, "rb") as fh:
        data = fh.read()

    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_len].decode("utf-8"))

    bin_offset = 20 + json_len
    if bin_offset % 4 != 0:
        bin_offset += 4 - (bin_offset % 4)
    bin_len = struct.unpack_from("<I", data, bin_offset)[0]
    bin_chunk = data[bin_offset + 8 : bin_offset + 8 + bin_len]

    accessors = gltf.get("accessors", [])
    buffer_views = gltf.get("bufferViews", [])
    meshes = gltf.get("meshes", [])

    prim_reports = []
    global_min = 1.0
    global_max = 0.0

    for mesh in meshes:
        mesh_name = mesh.get("name", "mesh")
        for prim in mesh.get("primitives", []):
            attrs = prim.get("attributes", {})
            if "COLOR_0" not in attrs:
                raise AssertionError(f"Mesh {mesh_name!r} primitive missing COLOR_0: {attrs}")

            acc = accessors[attrs["COLOR_0"]]
            bv = buffer_views[acc["bufferView"]]
            byte_offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            count = acc["count"]
            comp_type = acc["componentType"]
            acc_type = acc["type"]
            num_comp = 4 if acc_type == "VEC4" else 3
            byte_stride = bv.get("byteStride", 0)

            vals_r = []
            for i in range(count):
                if comp_type == 5126:  # FLOAT
                    step = byte_stride or (num_comp * 4)
                    off = byte_offset + i * step
                    comps = struct.unpack_from(f"<{num_comp}f", bin_chunk, off)
                    r = float(comps[0])
                elif comp_type == 5123:  # UNSIGNED_SHORT normalized
                    step = byte_stride or (num_comp * 2)
                    off = byte_offset + i * step
                    comps = struct.unpack_from(f"<{num_comp}H", bin_chunk, off)
                    r = float(comps[0]) / 65535.0
                elif comp_type == 5121:  # UNSIGNED_BYTE normalized
                    step = byte_stride or num_comp
                    off = byte_offset + i * step
                    comps = struct.unpack_from(f"<{num_comp}B", bin_chunk, off)
                    r = float(comps[0]) / 255.0
                else:
                    raise ValueError(f"Unsupported COLOR_0 componentType: {comp_type}")
                vals_r.append(r)

            p_min = min(vals_r)
            p_max = max(vals_r)
            p_mean = sum(vals_r) / max(len(vals_r), 1)
            global_min = min(global_min, p_min)
            global_max = max(global_max, p_max)
            prim_reports.append(
                {
                    "mesh": mesh_name,
                    "count": count,
                    "componentType": comp_type,
                    "type": acc_type,
                    "min": round(p_min, 4),
                    "max": round(p_max, 4),
                    "mean": round(p_mean, 4),
                }
            )

    return {
        "primitives_with_color0": len(prim_reports),
        "min_ao": round(global_min, 4),
        "max_ao": round(global_max, 4),
        "primitives": prim_reports,
    }


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    # 1. Build the greybox scene
    build_stats = greybox.build()

    # 2. Collect all visual meshes (excluding hullRamp / trimesh colliders)
    visual_meshes = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and obj.name.endswith("Visual")
    ]
    assert len(visual_meshes) >= 15, f"Expected >= 15 visual meshes, got {len(visual_meshes)}"

    # 3. Bake vertex AO into COLOR_0
    ao_summary = vn_bake_ao.bake_vertex_ao(
        visual_meshes,
        distance=0.6,
        samples=64,
        subdivide_area=1.0,
        max_cuts=3,
        attribute_name="COLOR_0",
        strength=1.15,
        min_ao=0.25,
        mode="CYCLES_OR_RAYCAST",
    )

    # Verify Python-side COLOR_0 existence and range
    for obj in visual_meshes:
        ca = obj.data.color_attributes.get("COLOR_0")
        assert ca is not None, f"Missing COLOR_0 on {obj.name}"

    assert ao_summary["min_ao"] < 0.80, f"Expected min AO < 0.80, got {ao_summary['min_ao']}"
    assert ao_summary["max_ao"] > 0.95, f"Expected max AO > 0.95, got {ao_summary['max_ao']}"

    # Verify key contact meshes have dark contact corners (< 0.80) and bright open areas (> 0.95)
    for contact_mesh in ("runVisual", "stepsVisual", "rampVisual", "pipe1Visual", "pipe2Visual"):
        m_stats = ao_summary["per_object"][contact_mesh]
        assert m_stats["min"] < 0.80, f"{contact_mesh} min AO too high: {m_stats}"
        assert m_stats["max"] > 0.95, f"{contact_mesh} max AO too low: {m_stats}"

    # 4. Export greybox_ao.glb with active COLOR_0 vertex colors
    export_stats = vn_export.export_glb(
        OUT_GLB,
        export_texcoords=False,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_image_format="NONE",
    )
    greybox.verify(OUT_GLB, build_stats)

    # 5. Inspect binary GLB accessors to confirm COLOR_0 is present and non-trivial in the GLB
    # Note: hullRamp is a collider mesh (not a visual mesh), so inspect visual meshes in GLB.
    info = vn_export.inspect_glb(OUT_GLB)
    gltf = info["gltf"]
    visual_mesh_indices = {
        node["mesh"]
        for node in gltf["nodes"]
        if "mesh" in node and node.get("name", "").endswith("Visual")
    }
    assert len(visual_mesh_indices) == len(visual_meshes)

    # Read binary COLOR_0 values on all visual meshes
    with open(OUT_GLB, "rb") as fh:
        data = fh.read()
    json_len = struct.unpack_from("<I", data, 12)[0]
    bin_offset = 20 + json_len
    if bin_offset % 4 != 0:
        bin_offset += 4 - (bin_offset % 4)
    bin_len = struct.unpack_from("<I", data, bin_offset)[0]
    bin_chunk = data[bin_offset + 8 : bin_offset + 8 + bin_len]

    accessors = gltf["accessors"]
    buffer_views = gltf["bufferViews"]
    glb_visual_prims = []
    glb_min = 1.0
    glb_max = 0.0

    for mi in sorted(visual_mesh_indices):
        mesh = gltf["meshes"][mi]
        for prim in mesh["primitives"]:
            attrs = prim["attributes"]
            assert "COLOR_0" in attrs, f"GLB visual mesh {mesh.get('name')} missing COLOR_0: {attrs}"
            acc = accessors[attrs["COLOR_0"]]
            bv = buffer_views[acc["bufferView"]]
            byte_offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            count = acc["count"]
            comp_type = acc["componentType"]
            num_comp = 4 if acc["type"] == "VEC4" else 3
            byte_stride = bv.get("byteStride", 0)

            vals = []
            for i in range(count):
                if comp_type == 5126:
                    step = byte_stride or (num_comp * 4)
                    r = struct.unpack_from(f"<{num_comp}f", bin_chunk, byte_offset + i * step)[0]
                elif comp_type == 5123:
                    step = byte_stride or (num_comp * 2)
                    r = (
                        struct.unpack_from(f"<{num_comp}H", bin_chunk, byte_offset + i * step)[0]
                        / 65535.0
                    )
                elif comp_type == 5121:
                    step = byte_stride or num_comp
                    r = (
                        struct.unpack_from(f"<{num_comp}B", bin_chunk, byte_offset + i * step)[0]
                        / 255.0
                    )
                else:
                    raise ValueError(f"Unexpected componentType {comp_type}")
                vals.append(float(r))

            p_min = min(vals)
            p_max = max(vals)
            glb_min = min(glb_min, p_min)
            glb_max = max(glb_max, p_max)
            glb_visual_prims.append(
                {
                    "mesh": mesh.get("name", f"mesh_{mi}"),
                    "count": count,
                    "componentType": comp_type,
                    "min": round(p_min, 4),
                    "max": round(p_max, 4),
                    "mean": round(sum(vals) / len(vals), 4),
                }
            )

    assert glb_min < 0.80, f"GLB COLOR_0 min too high: {glb_min}"
    assert glb_max > 0.95, f"GLB COLOR_0 max too low: {glb_max}"

    report = {
        "out_glb": OUT_GLB,
        "bytes": export_stats["bytes"],
        "triangles": export_stats["triangles"],
        "bake": ao_summary,
        "glb_color0": {
            "visual_primitives": len(glb_visual_prims),
            "min_ao": round(glb_min, 4),
            "max_ao": round(glb_max, 4),
            "primitives": glb_visual_prims,
        },
    }
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    print(
        "T23A_AO_BLENDER_OK",
        json.dumps(
            {
                "glb": OUT_GLB,
                "bytes": export_stats["bytes"],
                "triangles": export_stats["triangles"],
                "min_ao": report["glb_color0"]["min_ao"],
                "max_ao": report["glb_color0"]["max_ao"],
                "mean_ao": ao_summary["mean_ao"],
                "elapsed_s": ao_summary["elapsed_s"],
            }
        ),
    )


if __name__ == "__main__":
    main()
