"""Generate the lossless 16x16 sRGB palette PNG from palette.json.

Pure Python standard library (zero external dependencies).

UV convention (shared across make_palette.py, vn_palette.py, and PaletteCalibration.js):
  - PNG pixel grid has column `col` in 0..15 (left -> right) and row `row` in 0..15 (top -> bottom).
  - glTF / Three.js (`texture.flipY = false`): u = (col + 0.5) / 16, v = (row + 0.5) / 16.
  - Blender UV space (bottom-left origin):     u = (col + 0.5) / 16, v = 1.0 - (row + 0.5) / 16.
"""

from __future__ import annotations

import argparse
import json
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_INPUT = HERE / "palette.json"
DEFAULT_OUTPUT = HERE.parent.parent / "static" / "palette.png"
MAX_PNG_BYTES = 2048


def parse_hex_rgb(value: str) -> tuple[int, int, int]:
    """Parse a `#RRGGBB` string into an `(r, g, b)` 0..255 tuple."""
    if not isinstance(value, str) or len(value) != 7 or not value.startswith("#"):
        raise ValueError(f"Expected #RRGGBB hex color, got {value!r}")
    return (
        int(value[1:3], 16),
        int(value[3:5], 16),
        int(value[5:7], 16),
    )


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type)
    crc = zlib.crc32(data, crc) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def encode_rgb_png(width: int, height: int, rgb_rows: list[bytes]) -> bytes:
    """Encode an 8-bit RGB lossless PNG with filter type 0 per scanline."""
    if len(rgb_rows) != height:
        raise ValueError(f"Expected {height} rows, got {len(rgb_rows)}")
    raw = bytearray()
    expected_len = width * 3
    for row_bytes in rgb_rows:
        if len(row_bytes) != expected_len:
            raise ValueError(f"Expected row length {expected_len}, got {len(row_bytes)}")
        raw.append(0)  # filter type 0 (None)
        raw.extend(row_bytes)

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(bytes(raw), level=9)
    return (
        signature
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", idat)
        + _png_chunk(b"IEND", b"")
    )


def build_palette(input_path: Path = DEFAULT_INPUT, output_path: Path = DEFAULT_OUTPUT) -> dict:
    """Read palette.json, validate swatches, and write lossless 16x16 palette.png."""
    data = json.loads(input_path.read_text(encoding="utf-8"))
    size = int(data.get("size", 16))
    if size != 16:
        raise ValueError(f"Palette grid size must be 16, got {size}")

    default_rgb = parse_hex_rgb(data.get("defaultHex", "#f4ead4"))
    swatches = data.get("swatches", {})
    if not isinstance(swatches, dict) or not swatches:
        raise ValueError("palette.json contains no swatches")

    grid: list[list[tuple[int, int, int]]] = [
        [default_rgb for _ in range(size)] for _ in range(size)
    ]
    occupied: dict[tuple[int, int], str] = {}

    for name, spec in swatches.items():
        col = int(spec["col"])
        row = int(spec["row"])
        if not (0 <= col < size and 0 <= row < size):
            raise ValueError(f"Swatch {name!r} index ({col}, {row}) out of 0..{size - 1}")
        key = (col, row)
        if key in occupied:
            raise ValueError(
                f"Duplicate cell ({col}, {row}) for swatches {occupied[key]!r} and {name!r}"
            )
        occupied[key] = name
        grid[row][col] = parse_hex_rgb(spec["hex"])

    rgb_rows = [
        bytes(channel for rgb in grid[row] for channel in rgb)
        for row in range(size)
    ]
    png_bytes = encode_rgb_png(size, size, rgb_rows)

    if len(png_bytes) > MAX_PNG_BYTES:
        raise RuntimeError(
            f"Generated palette.png is {len(png_bytes)} bytes, exceeding {MAX_PNG_BYTES}-byte cap"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(png_bytes)
    return {
        "input": str(input_path),
        "output": str(output_path),
        "size": size,
        "swatches": len(swatches),
        "bytes": len(png_bytes),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build 16x16 lossless palette.png from palette.json")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Path to palette.json")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output palette.png path")
    args = parser.parse_args()

    result = build_palette(args.input, args.output)
    print(
        f"[make_palette] wrote {result['output']} "
        f"({result['size']}x{result['size']}, {result['swatches']} named swatches, {result['bytes']} B)"
    )


if __name__ == "__main__":
    main()
