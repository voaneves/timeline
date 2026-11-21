"""Batch Blender build orchestrator for Timeline 3D production assets.

Usage:
    blender.exe -b -P game/blender/build_all.py -- --only origens
    blender.exe -b -P game/blender/build_all.py -- --only origens --no-preview
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME_DIR = HERE.parent
ERAS_DIR = HERE / "eras"
RAW_ORIGENS_DIR = HERE / "out" / "eras" / "origens"
STATIC_ORIGENS_DIR = GAME_DIR / "static" / "eras" / "origens"
COMPRESS_SCRIPT = GAME_DIR / "scripts" / "compress.mjs"

if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


def parse_args() -> dict[str, object]:
    only: set[str] | None = None
    render_preview = True

    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1 :]
        i = 0
        while i < len(args):
            arg = args[i]
            if arg == "--only" and i + 1 < len(args):
                only = {part.strip().lower() for part in args[i + 1].split(",") if part.strip()}
                i += 2
            elif arg == "--no-preview":
                render_preview = False
                i += 1
            else:
                i += 1

    return {"only": only, "render_preview": render_preview}


def build_origens(render_preview: bool = True) -> None:
    """Build production Era 1 'Origens' (--mode final), compress GLBs/PNGs, and stage into static/eras/origens."""
    from eras import origens
    from lib import vn_scene

    RAW_ORIGENS_DIR.mkdir(parents=True, exist_ok=True)
    STATIC_ORIGENS_DIR.mkdir(parents=True, exist_ok=True)

    spline_out = RAW_ORIGENS_DIR / "origens_line_spline.json"
    stats = origens.build_origens_blockout(mode="final", spline_json_out=spline_out)
    origens.assemble_and_export_final(RAW_ORIGENS_DIR, stats)

    if render_preview:
        vn_scene.render_3views(
            str(origens.DEFAULT_FINAL_PREVIEW_OUT),
            target=(0.0, 18.0, 1.5),
            radius=36.0,
            size=640,
            engine_coords=False,
        )

    # Compress all 4 GLBs + 2 PNGs into game/static/eras/origens/
    cmd = [
        "node",
        str(COMPRESS_SCRIPT),
        "--in",
        str(RAW_ORIGENS_DIR),
        "--out",
        str(STATIC_ORIGENS_DIR),
    ]
    res = subprocess.run(cmd, cwd=str(GAME_DIR), check=True, text=True, capture_output=True)
    print(res.stdout.strip())
    if res.stderr:
        print(res.stderr.strip())

    # Copy metadata JSONs alongside compressed GLBs/PNGs
    for json_name in ("origens_shadow.json", "origens_line_spline.json"):
        src = RAW_ORIGENS_DIR / json_name
        if src.exists():
            shutil.copy2(src, STATIC_ORIGENS_DIR / json_name)

    # Verify strict byte budgets (measured in gzip bytes, matching budgets.json / check-size.mjs)
    import gzip

    glb_names = (
        "origensVisual.glb",
        "origensPhysical.glb",
        "origensObjects.glb",
        "origensReferences.glb",
    )
    png_names = ("origens_terrain.png", "origens_shadow.png")

    def _gz_size(path: Path) -> int:
        return len(gzip.compress(path.read_bytes(), compresslevel=9))

    glb_raw = sum((STATIC_ORIGENS_DIR / n).stat().st_size for n in glb_names)
    glb_gz = sum(_gz_size(STATIC_ORIGENS_DIR / n) for n in glb_names)
    png_raw = sum((STATIC_ORIGENS_DIR / n).stat().st_size for n in png_names)
    png_gz = sum(_gz_size(STATIC_ORIGENS_DIR / n) for n in png_names)
    all_files = [f for f in STATIC_ORIGENS_DIR.iterdir() if f.is_file()]
    total_raw = sum(f.stat().st_size for f in all_files)
    total_gz = sum(_gz_size(f) for f in all_files)

    print(
        f"[build_all] origens staged: "
        f"GLBs={glb_gz} B gz ({glb_raw} B raw, <= 614400), "
        f"PNGs={png_gz} B gz ({png_raw} B raw, <= 256000), "
        f"Total={total_gz} B gz ({total_raw} B raw, <= 870400)"
    )
    if glb_gz > 600 * 1024:
        raise AssertionError(f"Origens GLBs exceed 600 KB gz: {glb_gz} B")
    if png_raw > 250 * 1024:
        raise AssertionError(f"Origens PNGs exceed 250 KB: {png_raw} B")
    if total_gz > 850 * 1024:
        raise AssertionError(f"Origens total exceeds 850 KB gz: {total_gz} B")


def main() -> None:
    opts = parse_args()
    only = opts["only"]
    render_preview = bool(opts["render_preview"])

    targets = only if only is not None else {"origens"}
    if "origens" in targets:
        build_origens(render_preview=render_preview)


if __name__ == "__main__":
    main()
