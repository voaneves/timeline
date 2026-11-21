"""T2.3b verification script: build the greybox level, bake the 1024x1024 lossless R8
top-down static shadow map (`game/blender/out/greybox_shadow.png`) + bounds metadata
(`game/blender/out/greybox_shadow.json`), verify in Python that shadow pixels (< 128)
exist where blocks, steps, ramp, and pipes cast shadows while open ground remains lit
(255), and check that the PNG size is <= 50 KB.

Run:
    blender.exe -b -P game/blender/test_t23b.py
"""

from __future__ import annotations

import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from eras import greybox  # noqa: E402
from lib import vn_bake_shadow  # noqa: E402

OUT_DIR = os.path.join(HERE, "out")
OUT_PNG = os.path.join(OUT_DIR, "greybox_shadow.png")
OUT_META = os.path.join(OUT_DIR, "greybox_shadow.json")


def _sample_world_xz(pixels: np.ndarray, meta: dict, wx: float, wz: float, radius: int = 1) -> float:
    res = int(meta["resolution"])
    u = (wx - meta["minX"]) / meta["spanX"]
    v = (wz - meta["minZ"]) / meta["spanZ"]
    cx = max(0, min(res - 1, int(round(u * (res - 1)))))
    cz = max(0, min(res - 1, int(round(v * (res - 1)))))
    y0 = max(0, cz - radius)
    y1 = min(res, cz + radius + 1)
    x0 = max(0, cx - radius)
    x1 = min(res, cx + radius + 1)
    return float(pixels[y0:y1, x0:x1].mean())


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    greybox.build()

    result = vn_bake_shadow.bake_topdown_shadow(
        sun_direction=vn_bake_shadow.DEFAULT_ENGINE_SUN_DIRECTION,
        resolution=1024,
        padding=2.0,
        softness=1.5,
        samples=9,
        out_png_path=OUT_PNG,
        out_meta_path=OUT_META,
    )

    pixels = result["pixels"]
    png_bytes = result["bytes"]
    assert os.path.isfile(OUT_PNG), f"Missing {OUT_PNG}"
    assert os.path.isfile(OUT_META), f"Missing {OUT_META}"
    assert png_bytes <= 50 * 1024, f"Expected R8 PNG <= 50 KB, got {png_bytes} B"

    # Verify PNG header is 1024x1024, bit_depth=8, color_type=0 (R8 grayscale)
    with open(OUT_PNG, "rb") as fh:
        raw = fh.read()
    assert raw[:8] == b"\x89PNG\r\n\x1a\n", "Invalid PNG signature"
    w, h, bit_depth, color_type = struct.unpack(">IIBB", raw[16:26])
    assert (w, h, bit_depth, color_type) == (1024, 1024, 8, 0), (w, h, bit_depth, color_type)

    # Sun direction in engine space is (-0.09585, 0.875845, -0.472979), so a point at height h
    # casts its shadow onto the floor at offset:
    #   dx = -h * (-0.09585  / 0.875845) = +0.10944 * h
    #   dz = -h * (-0.472979 / 0.875845) = +0.54003 * h
    probes = {
        # Ramp (x=1.3..3.7, z=-2..-6, rise=2.31 m at z=-6) casts shadow onto floor at (+X, +Z from back wall):
        "rampShadowFloor": _sample_world_xz(pixels, result, 3.78, -5.2),
        # Steps (x=-3.7..-1.3, z=-2..-5.6, h=0.3..1.8 m) cast shadow onto floor at (+X, +Z):
        "stepsShadowFloor": _sample_world_xz(pixels, result, -1.22, -4.8),
        # Block 1 (center x=0, y=3.7, z=-8) casts shadow onto floor around (x=+0.40, z=-6.00):
        "block1ShadowFloor": _sample_world_xz(pixels, result, 0.40, -6.00),
        # Block 2 (center x=0, y=3.7, z=-10.5) casts shadow onto floor around (x=+0.40, z=-8.50):
        "block2ShadowFloor": _sample_world_xz(pixels, result, 0.40, -8.50),
        # Pipe 1 (center x=3.0, y=0.7, z=-8) casts shadow onto floor around (x=3.10, z=-7.25):
        "pipe1ShadowFloor": _sample_world_xz(pixels, result, 3.10, -7.25),
        # Pipe 2 (center x=-3.0, y=0.5, z=-14) casts shadow onto floor around (x=-2.9, z=-13.35):
        "pipe2ShadowFloor": _sample_world_xz(pixels, result, -2.9, -13.35),
        # Open spawn ground (x=0, z=0) and open runway (x=0, z=-2.0):
        "openSpawnFloor": _sample_world_xz(pixels, result, 0.0, 0.0),
        "openRunwayFloor": _sample_world_xz(pixels, result, 0.0, -2.0),
    }

    for shadow_key in (
        "rampShadowFloor",
        "stepsShadowFloor",
        "block1ShadowFloor",
        "block2ShadowFloor",
        "pipe1ShadowFloor",
        "pipe2ShadowFloor",
    ):
        val = probes[shadow_key]
        assert val < 64.0, f"Expected shadow probe {shadow_key} < 64, got {val:.2f} (probes={probes})"

    for lit_key in ("openSpawnFloor", "openRunwayFloor"):
        val = probes[lit_key]
        assert val >= 250.0, f"Expected lit probe {lit_key} >= 250, got {val:.2f} (probes={probes})"

    with open(OUT_META, "r", encoding="utf-8") as fh:
        meta_disk = json.load(fh)
    meta_disk["probes"] = {k: round(v, 2) for k, v in probes.items()}
    with open(OUT_META, "w", encoding="utf-8") as fh:
        json.dump(meta_disk, fh, indent=2)

    print(
        "T23B_SHADOW_BLENDER_OK",
        json.dumps(
            {
                "png": OUT_PNG,
                "meta": OUT_META,
                "bytes": png_bytes,
                "resolution": result["resolution"],
                "bounds": [result["minX"], result["maxX"], result["minZ"], result["maxZ"]],
                "shadowedPixels": result["stats"]["shadowedPixels"],
                "litPixels": result["stats"]["litPixels"],
                "probes": meta_disk["probes"],
            }
        ),
    )


if __name__ == "__main__":
    main()
