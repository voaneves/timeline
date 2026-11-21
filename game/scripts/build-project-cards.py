"""Generate 6 original 1200x675 WebP project preview cards (<= 60 KB each) for Era 5.

Reads project metadata from `game/sources/data/content.json`, renders crisp
editorial/diagrammatic artwork for each of the 6 showcase projects with Pillow,
and encodes them via `ffmpeg` (`libwebp`) into `game/static/eras/transformacao/projects/`.

Run:
    python game/scripts/build-project-cards.py
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

ROOT_DIR = Path(__file__).resolve().parents[2]
CONTENT_JSON = ROOT_DIR / "game" / "sources" / "data" / "content.json"
OUT_DIR = ROOT_DIR / "game" / "static" / "eras" / "transformacao" / "projects"

WIDTH = 1200
HEIGHT = 675
MAX_BYTES = 60 * 1024

# Brand & Era 5 palette
INK = (10, 10, 10)
PAPER = (244, 234, 212)
PAPER_WARM = (239, 228, 197)
PAPER_SHADOW = (223, 209, 178)
SIGNAL = (245, 0, 0)
CORAL = (255, 138, 92)
PLUM = (59, 42, 107)
PLUM_DEEP = (34, 23, 66)
FAIRY_GOLD = (255, 215, 90)
DUSK_ROSE = (201, 138, 160)
TEAL = (43, 111, 143)
MINT = (159, 217, 210)
CHARCOAL = (36, 35, 34)
WHITE = (255, 255, 255)


def _load_font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates: list[str] = []
    if mono:
        candidates = [
            "C:/Windows/Fonts/consolab.ttf" if bold else "C:/Windows/Fonts/consola.ttf",
            "C:/Windows/Fonts/lucon.ttf",
        ]
    else:
        candidates = [
            "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                pass
    return ImageFont.load_default()


FONT_TITLE = _load_font(44, bold=True)
FONT_SUB = _load_font(22, bold=False)
FONT_LABEL = _load_font(20, bold=True)
FONT_MONO = _load_font(18, bold=True, mono=True)
FONT_SMALL = _load_font(16, bold=False)
FONT_BIG_NUM = _load_font(52, bold=True)


def _draw_header_footer(
    draw: ImageDraw.ImageDraw,
    title: str,
    subtitle: str,
    stack: list[str],
    dark: bool = False,
    accent: tuple[int, int, int] = SIGNAL,
) -> None:
    fg = PAPER if dark else INK
    sub_fg = (205, 195, 220) if dark else (71, 69, 66)
    pill_bg = (52, 38, 94) if dark else PAPER_WARM
    pill_border = accent

    # Top accent bar
    draw.rectangle([0, 0, WIDTH, 10], fill=accent)

    # Corner registration mark + title
    draw.ellipse([48, 42, 70, 64], fill=accent)
    draw.text((86, 30), title, font=FONT_TITLE, fill=fg)
    draw.text((86, 86), subtitle[:88], font=FONT_SUB, fill=sub_fg)

    # Stack pills at bottom
    x = 48
    y = HEIGHT - 64
    for tag in stack[:5]:
        bbox = draw.textbbox((0, 0), tag, font=FONT_MONO)
        tw = bbox[2] - bbox[0]
        pw = tw + 28
        draw.rounded_rectangle([x, y, x + pw, y + 36], radius=18, fill=pill_bg, outline=pill_border, width=2)
        draw.text((x + 14, y + 7), tag, font=FONT_MONO, fill=fg)
        x += pw + 12

    # Right footer brand tag
    brand_txt = "VOANEVES // ERA 5"
    bb = draw.textbbox((0, 0), brand_txt, font=FONT_MONO)
    draw.text((WIDTH - 48 - (bb[2] - bb[0]), HEIGHT - 56), brand_txt, font=FONT_MONO, fill=sub_fg)


def render_dtcg_contrast(proj: dict[str, Any]) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    draw = ImageDraw.Draw(img)
    _draw_header_footer(draw, proj["title"], proj["summary"], proj["stack"], dark=False, accent=SIGNAL)

    # Contrast matrix cards
    pairs = [
        ("ink / paper", INK, PAPER, "17.4:1", "AAA", "Lc 102"),
        ("plum / paper", PLUM, PAPER, "9.8:1", "AAA", "Lc 88"),
        ("paper / plum", PAPER, PLUM, "9.8:1", "AAA", "Lc 89"),
        ("ink / fairyGold", INK, FAIRY_GOLD, "13.9:1", "AAA", "Lc 94"),
        ("ink / coral", INK, CORAL, "7.8:1", "AAA", "Lc 68"),
        ("signal / paper", SIGNAL, PAPER, "4.6:1", "AA", "Lc 58"),
    ]
    start_x, start_y = 48, 145
    cw, ch = 352, 200
    gap = 24
    for idx, (label, fg_c, bg_c, ratio, grade, apca) in enumerate(pairs):
        col = idx % 3
        row = idx // 3
        x0 = start_x + col * (cw + gap)
        y0 = start_y + row * (ch + gap)
        draw.rounded_rectangle([x0, y0, x0 + cw, y0 + ch], radius=16, fill=bg_c, outline=INK, width=3)
        draw.text((x0 + 22, y0 + 20), label, font=FONT_MONO, fill=fg_c)
        draw.text((x0 + 22, y0 + 62), ratio, font=FONT_BIG_NUM, fill=fg_c)
        # Badge
        draw.rounded_rectangle([x0 + 22, y0 + 136, x0 + 110, y0 + 174], radius=10, fill=fg_c)
        draw.text((x0 + 38, y0 + 143), grade, font=FONT_LABEL, fill=bg_c)
        draw.text((x0 + 126, y0 + 144), apca, font=FONT_MONO, fill=fg_c)
    return img


def render_xbox_sales(proj: dict[str, Any]) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), (22, 28, 36))
    draw = ImageDraw.Draw(img)
    _draw_header_footer(draw, proj["title"], proj["summary"], proj["stack"], dark=True, accent=(93, 214, 98))

    # KPI tiles
    kpis = [("RECEITA TOTAL", "$ 4.82M", "+18.4%"), ("UNIDADES", "142.8K", "+12.1%"), ("TICKET MEDIO", "$ 33.75", "+5.6%")]
    for i, (k, v, d) in enumerate(kpis):
        x0 = 48 + i * 376
        draw.rounded_rectangle([x0, 140, x0 + 352, 255], radius=14, fill=(33, 42, 54), outline=(72, 92, 112), width=2)
        draw.text((x0 + 22, 156), k, font=FONT_SMALL, fill=(160, 180, 200))
        draw.text((x0 + 22, 186), v, font=FONT_TITLE, fill=WHITE)
        draw.text((x0 + 240, 198), d, font=FONT_LABEL, fill=(93, 214, 98))

    # Bar chart panel
    draw.rounded_rectangle([48, 280, 760, 585], radius=14, fill=(33, 42, 54), outline=(72, 92, 112), width=2)
    draw.text((74, 298), "VENDAS POR TRIMESTRE (Q1-Q8)", font=FONT_LABEL, fill=PAPER)
    bars = [0.42, 0.56, 0.50, 0.72, 0.65, 0.84, 0.78, 0.95]
    for i, frac in enumerate(bars):
        bx = 82 + i * 80
        bh = int(190 * frac)
        by = 540 - bh
        color = (93, 214, 98) if i % 2 == 0 else (64, 168, 208)
        draw.rounded_rectangle([bx, by, bx + 52, 540], radius=6, fill=color)
        draw.text((bx + 12, 548), f"Q{i+1}", font=FONT_SMALL, fill=(180, 196, 212))

    # Right summary panel
    draw.rounded_rectangle([784, 280, 1152, 585], radius=14, fill=(33, 42, 54), outline=(72, 92, 112), width=2)
    draw.text((810, 298), "MIX DE PLATAFORMA", font=FONT_LABEL, fill=PAPER)
    shares = [("Series X|S", 0.48, (93, 214, 98)), ("Game Pass", 0.32, (64, 168, 208)), ("PC / Cloud", 0.20, FAIRY_GOLD)]
    for i, (name, frac, col) in enumerate(shares):
        yy = 360 + i * 70
        draw.text((810, yy), f"{name}  {int(frac*100)}%", font=FONT_MONO, fill=WHITE)
        draw.rounded_rectangle([810, yy + 28, 1120, yy + 48], radius=8, fill=(22, 28, 36))
        draw.rounded_rectangle([810, yy + 28, 810 + int(310 * frac), yy + 48], radius=8, fill=col)
    return img


def render_snake_arena(proj: dict[str, Any]) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), PLUM_DEEP)
    draw = ImageDraw.Draw(img)
    _draw_header_footer(draw, proj["title"], proj["summary"], proj["stack"], dark=True, accent=CORAL)

    # Retro grid arena
    gx0, gy0, cell = 64, 145, 36
    cols, rows = 18, 12
    draw.rounded_rectangle([gx0 - 10, gy0 - 10, gx0 + cols * cell + 10, gy0 + rows * cell + 10], radius=12, fill=(18, 14, 38), outline=CORAL, width=3)
    for r in range(rows + 1):
        y = gy0 + r * cell
        draw.line([gx0, y, gx0 + cols * cell, y], fill=(48, 36, 86), width=1)
    for c in range(cols + 1):
        x = gx0 + c * cell
        draw.line([x, gy0, x, gy0 + rows * cell], fill=(48, 36, 86), width=1)

    # Snake body
    snake_cells = [(3, 7), (4, 7), (5, 7), (6, 7), (6, 6), (6, 5), (7, 5), (8, 5), (9, 5), (10, 5), (10, 6), (11, 6), (12, 6)]
    for i, (cx, cy) in enumerate(snake_cells):
        x0 = gx0 + cx * cell + 4
        y0 = gy0 + cy * cell + 4
        col = FAIRY_GOLD if i == len(snake_cells) - 1 else MINT
        draw.rounded_rectangle([x0, y0, x0 + cell - 8, y0 + cell - 8], radius=6, fill=col)
    # Food
    fx, fy = gx0 + 14 * cell + 5, gy0 + 4 * cell + 5
    draw.ellipse([fx, fy, fx + cell - 10, fy + cell - 10], fill=SIGNAL)

    # Reward curve card
    rx0, ry0 = 755, 145
    draw.rounded_rectangle([rx0, ry0, 1152, 577], radius=14, fill=(24, 18, 52), outline=MINT, width=2)
    draw.text((rx0 + 24, ry0 + 20), "DQN REWARD CURVE", font=FONT_LABEL, fill=PAPER)
    pts = []
    for i in range(16):
        px = rx0 + 32 + i * 22
        py = ry0 + 360 - int(240 * (1.0 - math.exp(-i / 5.0)) + 14 * math.sin(i * 1.1))
        pts.append((px, py))
    draw.line(pts, fill=FAIRY_GOLD, width=5)
    for px, py in pts[::3]:
        draw.ellipse([px - 5, py - 5, px + 5, py + 5], fill=CORAL)
    draw.text((rx0 + 24, ry0 + 382), "EPISODES: 5,000  |  AVG: +42.8", font=FONT_MONO, fill=MINT)
    return img


def render_meu_poupig(proj: dict[str, Any]) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), PAPER_WARM)
    draw = ImageDraw.Draw(img)
    _draw_header_footer(draw, proj["title"], proj["summary"], proj["stack"], dark=False, accent=DUSK_ROSE)

    # Piggy bank illustration card on left
    draw.rounded_rectangle([48, 145, 560, 580], radius=20, fill=PAPER, outline=INK, width=3)
    cx, cy = 304, 365
    # Body
    draw.ellipse([cx - 130, cy - 95, cx + 130, cy + 95], fill=DUSK_ROSE, outline=INK, width=4)
    # Ear
    draw.polygon([(cx - 70, cy - 82), (cx - 40, cy - 135), (cx - 10, cy - 88)], fill=DUSK_ROSE, outline=INK)
    # Snout
    draw.ellipse([cx + 98, cy - 34, cx + 154, cy + 34], fill=(228, 165, 186), outline=INK, width=3)
    draw.ellipse([cx + 118, cy - 12, cx + 128, cy + 2], fill=INK)
    draw.ellipse([cx + 136, cy - 12, cx + 146, cy + 2], fill=INK)
    # Eye
    draw.ellipse([cx + 42, cy - 38, cx + 60, cy - 20], fill=INK)
    # Coin slot & falling gold coins
    draw.rectangle([cx - 32, cy - 98, cx + 32, cy - 86], fill=INK)
    for dy in (-145, -195):
        draw.ellipse([cx - 22, cy + dy - 22, cx + 22, cy + dy + 22], fill=FAIRY_GOLD, outline=INK, width=3)
        draw.text((cx - 7, cy + dy - 12), "$", font=FONT_LABEL, fill=INK)

    # Savings progress cards on right
    goals = [
        ("RESERVA DE EMERGENCIA", 0.85, "R$ 8.500 / 10.000", MINT),
        ("PRIMEIRO INVESTIMENTO", 0.65, "R$ 3.250 / 5.000", FAIRY_GOLD),
        ("META LIVRE DE DIVIDAS", 1.00, "CONCLUIDA!", CORAL),
    ]
    for i, (label, frac, val, col) in enumerate(goals):
        y0 = 145 + i * 150
        draw.rounded_rectangle([590, y0, 1152, y0 + 130], radius=16, fill=PAPER, outline=INK, width=3)
        draw.text((616, y0 + 18), label, font=FONT_LABEL, fill=INK)
        draw.text((616, y0 + 48), val, font=FONT_MONO, fill=(71, 69, 66))
        draw.rounded_rectangle([616, y0 + 84, 1120, y0 + 108], radius=12, fill=PAPER_SHADOW, outline=INK, width=2)
        draw.rounded_rectangle([616, y0 + 84, 616 + int(504 * frac), y0 + 108], radius=12, fill=col, outline=INK, width=2)
    return img


def render_js_games(proj: dict[str, Any]) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), CHARCOAL)
    draw = ImageDraw.Draw(img)
    _draw_header_footer(draw, proj["title"], proj["summary"], proj["stack"], dark=True, accent=FAIRY_GOLD)

    # 2x2 arcade mosaic
    tiles = [
        ("JOGO DA VELHA", CORAL, "tic"),
        ("PEDRA PAPEL TESOURA", MINT, "rps"),
        ("SNAKE CLASSIC", FAIRY_GOLD, "snake"),
        ("CAMPO MINADO", DUSK_ROSE, "mine"),
    ]
    tw, th = 536, 206
    for idx, (name, col, kind) in enumerate(tiles):
        c = idx % 2
        r = idx // 2
        x0 = 48 + c * (tw + 32)
        y0 = 145 + r * (th + 24)
        draw.rounded_rectangle([x0, y0, x0 + tw, y0 + th], radius=16, fill=(48, 46, 52), outline=col, width=3)
        draw.text((x0 + 24, y0 + 20), name, font=FONT_LABEL, fill=col)

        if kind == "tic":
            gx, gy = x0 + 330, y0 + 36
            for k in (42, 84):
                draw.line([gx + k, gy, gx + k, gy + 126], fill=PAPER, width=3)
                draw.line([gx, gy + k, gx + 126, gy + k], fill=PAPER, width=3)
            draw.ellipse([gx + 8, gy + 8, gx + 34, gy + 34], outline=CORAL, width=4)
            draw.line([gx + 52, gy + 52, gx + 76, gy + 76], fill=MINT, width=4)
            draw.line([gx + 76, gy + 52, gx + 52, gy + 76], fill=MINT, width=4)
        elif kind == "rps":
            for j, lbl in enumerate(("R", "P", "S")):
                bx = x0 + 280 + j * 76
                draw.rounded_rectangle([bx, y0 + 68, bx + 60, y0 + 136], radius=12, fill=col)
                draw.text((bx + 21, y0 + 88), lbl, font=FONT_LABEL, fill=INK)
        elif kind == "snake":
            for j in range(6):
                draw.rounded_rectangle([x0 + 260 + j * 34, y0 + 96, x0 + 290 + j * 34, y0 + 126], radius=6, fill=col)
            draw.ellipse([x0 + 480, y0 + 98, x0 + 506, y0 + 124], fill=SIGNAL)
        elif kind == "mine":
            for mr in range(3):
                for mc in range(4):
                    mx = x0 + 310 + mc * 42
                    my = y0 + 48 + mr * 42
                    draw.rounded_rectangle([mx, my, mx + 36, my + 36], radius=5, fill=(75, 72, 82))
            draw.ellipse([x0 + 358, y0 + 96, x0 + 382, y0 + 120], fill=SIGNAL)
        draw.text((x0 + 24, y0 + 150), "PWA OFFLINE  |  VANILLA JS", font=FONT_MONO, fill=PAPER_SHADOW)
    return img


def render_financial_sample(proj: dict[str, Any]) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    draw = ImageDraw.Draw(img)
    _draw_header_footer(draw, proj["title"], proj["summary"], proj["stack"], dark=False, accent=TEAL)

    # Top KPI strip
    metrics = [("GROSS SALES", "$ 127.9M"), ("PROFIT", "$ 16.9M"), ("MARGIN", "13.2%"), ("UNITS SOLD", "1.12M")]
    for i, (m, val) in enumerate(metrics):
        x0 = 48 + i * 282
        draw.rounded_rectangle([x0, 145, x0 + 258, 248], radius=14, fill=PAPER_WARM, outline=TEAL, width=3)
        draw.text((x0 + 20, 160), m, font=FONT_SMALL, fill=TEAL)
        draw.text((x0 + 20, 188), val, font=FONT_TITLE, fill=INK)

    # Pie / Donut chart on left
    draw.rounded_rectangle([48, 272, 460, 582], radius=16, fill=PAPER_WARM, outline=INK, width=2)
    draw.text((74, 290), "PROFIT BY SEGMENT", font=FONT_LABEL, fill=INK)
    bbox = [110, 340, 310, 540]
    draw.pieslice(bbox, 0, 150, fill=TEAL, outline=PAPER, width=3)
    draw.pieslice(bbox, 150, 260, fill=CORAL, outline=PAPER, width=3)
    draw.pieslice(bbox, 260, 360, fill=FAIRY_GOLD, outline=PAPER, width=3)
    draw.ellipse([162, 392, 258, 488], fill=PAPER_WARM)

    # Trend area/line chart on right
    draw.rounded_rectangle([488, 272, 1152, 582], radius=16, fill=PAPER_WARM, outline=INK, width=2)
    draw.text((514, 290), "MONTHLY PROFIT TREND", font=FONT_LABEL, fill=INK)
    pts = [(524 + i * 54, 520 - int(36 + 18 * i * 0.6 + 24 * math.sin(i * 0.9))) for i in range(12)]
    draw.line(pts, fill=TEAL, width=6)
    for px, py in pts:
        draw.ellipse([px - 6, py - 6, px + 6, py + 6], fill=SIGNAL)
    return img


RENDERERS = {
    "p-dtcg-contrast": ("dtcg-contrast.webp", render_dtcg_contrast),
    "p-xbox-sales": ("xbox-sales.webp", render_xbox_sales),
    "p-snake-arena": ("snake-arena.webp", render_snake_arena),
    "p-meupoupig": ("meu-poupig.webp", render_meu_poupig),
    "p-js-games": ("js-games.webp", render_js_games),
    "p-financial_sample_analysis": ("financial-sample-analysis.webp", render_financial_sample),
}


def encode_webp_under_cap(img: Image.Image, out_path: Path, max_bytes: int = MAX_BYTES) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_png = Path(tmpdir) / "card.png"
        img.save(tmp_png, format="PNG")
        for quality in (84, 76, 68, 58, 48):
            cmd = [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(tmp_png),
                "-c:v",
                "libwebp",
                "-quality",
                str(quality),
                "-compression_level",
                "6",
                str(out_path),
            ]
            subprocess.run(cmd, check=True)
            size = out_path.stat().st_size
            if size <= max_bytes:
                return size
    raise RuntimeError(f"{out_path.name} exceeded {max_bytes} bytes even at lowest quality")


def main() -> None:
    content = json.loads(CONTENT_JSON.read_text(encoding="utf-8"))
    projects = {p["id"]: p for p in content["projects"]}
    results = []
    for pid, (filename, fn) in RENDERERS.items():
        proj = projects[pid]
        img = fn(proj)
        assert img.size == (WIDTH, HEIGHT), f"{filename} size {img.size} != {(WIDTH, HEIGHT)}"
        out_path = OUT_DIR / filename
        nbytes = encode_webp_under_cap(img, out_path)
        results.append({"file": filename, "width": WIDTH, "height": HEIGHT, "bytes": nbytes})
    print("PROJECT_CARDS_OK", json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
