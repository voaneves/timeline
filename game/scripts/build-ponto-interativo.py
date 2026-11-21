"""
Generates the original 256x192 pixel-art texture for the 2005 "Ponto Interativo"
CRT blog screen in Era 1 (Origens). Pure-Python lossless PNG (no external deps).

Output: game/static/eras/origens/ponto_interativo.png (<= 15 KB)
"""

from pathlib import Path
import struct
import zlib

WIDTH = 256
HEIGHT = 192

# Warm palette matching Origens palette.png
PALETTE = {
    "bg_desk": (0x2B, 0x2B, 0x38),       # deep slate frame
    "chrome": (0xD9, 0xC7, 0xA0),        # warm retro window grey-beige
    "chrome_hi": (0xF4, 0xEA, 0xD5),     # highlight bevel
    "chrome_lo": (0x7A, 0x5A, 0x3A),     # shadow bevel
    "title_bar": (0x3B, 0x6E, 0xA8),     # classic 2005 window title blue
    "title_bar2": (0x5F, 0xA8, 0xB5),    # gradient end
    "paper": (0xF4, 0xEA, 0xD5),         # warm cream page background
    "card": (0xFF, 0xF7, 0xE8),          # post card surface
    "sidebar": (0xE9, 0xD9, 0xB8),       # sidebar parchment
    "header_bg": (0xE8, 0x73, 0x4A),     # warm terracotta/orange banner
    "header_sub": (0xF2, 0xB8, 0x4B),    # golden accent strip
    "accent": (0xC2, 0x41, 0x2D),        # terracotta red
    "green": (0x4F, 0x8A, 0x5B),         # cerrado green
    "teal": (0x2F, 0x5D, 0x50),          # CRT dark green
    "gold": (0xF2, 0xB8, 0x4B),          # ipe yellow
    "ink": (0x1E, 0x22, 0x2E),           # dark ink text
    "muted": (0x6B, 0x5B, 0x4B),         # muted brown text
    "link": (0x3B, 0x6E, 0xA8),          # classic hyperlink blue
    "white": (0xFF, 0xFC, 0xF2),         # crisp white
    "lcd_bg": (0x1E, 0x2B, 0x24),        # counter LCD dark
    "lcd_fg": (0x8F, 0xB8, 0x6A),        # counter LCD green
}

# Compact 3x5 pixel bitmap font (each glyph is 5 rows of 3 bits)
FONT_3X5 = {
    "A": [0b010, 0b101, 0b111, 0b101, 0b101],
    "B": [0b110, 0b101, 0b110, 0b101, 0b110],
    "C": [0b011, 0b100, 0b100, 0b100, 0b011],
    "D": [0b110, 0b101, 0b101, 0b101, 0b110],
    "E": [0b111, 0b100, 0b110, 0b100, 0b111],
    "F": [0b111, 0b100, 0b110, 0b100, 0b100],
    "G": [0b011, 0b100, 0b101, 0b101, 0b011],
    "H": [0b101, 0b101, 0b111, 0b101, 0b101],
    "I": [0b111, 0b010, 0b010, 0b010, 0b111],
    "J": [0b001, 0b001, 0b001, 0b101, 0b010],
    "K": [0b101, 0b101, 0b110, 0b101, 0b101],
    "L": [0b100, 0b100, 0b100, 0b100, 0b111],
    "M": [0b101, 0b111, 0b111, 0b101, 0b101],
    "N": [0b101, 0b111, 0b111, 0b111, 0b101],
    "O": [0b010, 0b101, 0b101, 0b101, 0b010],
    "P": [0b110, 0b101, 0b110, 0b100, 0b100],
    "Q": [0b010, 0b101, 0b101, 0b011, 0b001],
    "R": [0b110, 0b101, 0b110, 0b101, 0b101],
    "S": [0b011, 0b100, 0b010, 0b001, 0b110],
    "T": [0b111, 0b010, 0b010, 0b010, 0b010],
    "U": [0b101, 0b101, 0b101, 0b101, 0b111],
    "V": [0b101, 0b101, 0b101, 0b101, 0b010],
    "W": [0b101, 0b101, 0b111, 0b111, 0b101],
    "X": [0b101, 0b101, 0b010, 0b101, 0b101],
    "Y": [0b101, 0b101, 0b010, 0b010, 0b010],
    "Z": [0b111, 0b001, 0b010, 0b100, 0b111],
    "0": [0b111, 0b101, 0b101, 0b101, 0b111],
    "1": [0b010, 0b110, 0b010, 0b010, 0b111],
    "2": [0b110, 0b001, 0b010, 0b100, 0b111],
    "3": [0b110, 0b001, 0b010, 0b001, 0b110],
    "4": [0b101, 0b101, 0b111, 0b001, 0b001],
    "5": [0b111, 0b100, 0b110, 0b001, 0b110],
    "6": [0b011, 0b100, 0b111, 0b101, 0b111],
    "7": [0b111, 0b001, 0b010, 0b010, 0b010],
    "8": [0b111, 0b101, 0b111, 0b101, 0b111],
    "9": [0b111, 0b101, 0b111, 0b001, 0b110],
    ":": [0b000, 0b010, 0b000, 0b010, 0b000],
    ".": [0b000, 0b000, 0b000, 0b000, 0b010],
    ",": [0b000, 0b000, 0b000, 0b010, 0b100],
    "!": [0b010, 0b010, 0b010, 0b000, 0b010],
    "-": [0b000, 0b000, 0b111, 0b000, 0b000],
    "/": [0b001, 0b001, 0b010, 0b100, 0b100],
    "(": [0b001, 0b010, 0b010, 0b010, 0b001],
    ")": [0b100, 0b010, 0b010, 0b010, 0b100],
    "·": [0b000, 0b000, 0b010, 0b000, 0b000],
    ">": [0b100, 0b010, 0b001, 0b010, 0b100],
    " ": [0b000, 0b000, 0b000, 0b000, 0b000],
}


class Canvas:
    def __init__(self, width, height, fill):
        self.w = width
        self.h = height
        self.buf = bytearray(width * height * 3)
        r, g, b = fill
        row = bytes([r, g, b]) * width
        for y in range(height):
            self.buf[y * width * 3 : (y + 1) * width * 3] = row

    def px(self, x, y, color):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.buf[i] = color[0]
            self.buf[i + 1] = color[1]
            self.buf[i + 2] = color[2]

    def rect(self, x, y, w, h, color):
        x0 = max(0, x)
        y0 = max(0, y)
        x1 = min(self.w, x + w)
        y1 = min(self.h, y + h)
        if x1 <= x0 or y1 <= y0:
            return
        span = bytes(color) * (x1 - x0)
        for yy in range(y0, y1):
            start = (yy * self.w + x0) * 3
            self.buf[start : start + len(span)] = span

    def border(self, x, y, w, h, color):
        self.rect(x, y, w, 1, color)
        self.rect(x, y + h - 1, w, 1, color)
        self.rect(x, y, 1, h, color)
        self.rect(x + w - 1, y, 1, h, color)

    def bevel_box(self, x, y, w, h, fill, hi, lo):
        self.rect(x, y, w, h, fill)
        self.rect(x, y, w, 1, hi)
        self.rect(x, y, 1, h, hi)
        self.rect(x, y + h - 1, w, 1, lo)
        self.rect(x + w - 1, y, 1, h, lo)

    def text(self, x, y, txt, color, scale=1):
        cx = x
        for ch in txt.upper():
            glyph = FONT_3X5.get(ch, FONT_3X5[" "])
            for row_idx, bits in enumerate(glyph):
                for col_idx in range(3):
                    if bits & (1 << (2 - col_idx)):
                        self.rect(
                            cx + col_idx * scale,
                            y + row_idx * scale,
                            scale,
                            scale,
                            color,
                        )
            cx += 4 * scale


def write_png(path, width, height, rgb_bytes):
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)  # filter type 0 (None)
        raw.extend(rgb_bytes[y * stride : (y + 1) * stride])

    def chunk(tag, data):
        return (
            struct.pack("!I", len(data))
            + tag
            + data
            + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack("!IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), level=9)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def draw_blog(c):
    # Outer CRT bezel / desktop border
    c.rect(0, 0, WIDTH, HEIGHT, PALETTE["bg_desk"])

    # Retro browser window (4px margin)
    wx, wy, ww, wh = 4, 4, WIDTH - 8, HEIGHT - 8
    c.bevel_box(wx, wy, ww, wh, PALETTE["chrome"], PALETTE["chrome_hi"], PALETTE["chrome_lo"])

    # Title bar with subtle horizontal step gradient
    tx, ty, tw, th = wx + 2, wy + 2, ww - 4, 13
    c.rect(tx, ty, tw // 2, th, PALETTE["title_bar"])
    c.rect(tx + tw // 2, ty, tw - tw // 2, th, PALETTE["title_bar2"])
    # Small favicon square
    c.rect(tx + 3, ty + 3, 7, 7, PALETTE["gold"])
    c.rect(tx + 5, ty + 5, 3, 3, PALETTE["accent"])
    c.text(tx + 13, ty + 4, "PONTO INTERATIVO - 2005", PALETTE["white"], scale=1)

    # Window control buttons (_, [], X)
    for idx, sym_color in enumerate([PALETTE["ink"], PALETTE["ink"], PALETTE["accent"]]):
        bx = tx + tw - 33 + idx * 11
        by = ty + 2
        c.bevel_box(bx, by, 9, 9, PALETTE["chrome"], PALETTE["chrome_hi"], PALETTE["chrome_lo"])
        if idx == 0:
            c.rect(bx + 2, by + 6, 5, 1, sym_color)
        elif idx == 1:
            c.border(bx + 2, by + 2, 5, 5, sym_color)
        else:
            for d in range(5):
                c.px(bx + 2 + d, by + 2 + d, sym_color)
                c.px(bx + 6 - d, by + 2 + d, sym_color)

    # Address bar
    ax, ay, aw, ah = wx + 2, ty + th + 2, ww - 4, 13
    c.rect(ax, ay, aw, ah, PALETTE["chrome"])
    c.text(ax + 3, ay + 4, "END:", PALETTE["muted"], scale=1)
    c.bevel_box(ax + 20, ay + 1, aw - 38, 11, PALETTE["white"], PALETTE["chrome_lo"], PALETTE["chrome_hi"])
    c.text(ax + 23, ay + 4, "HTTP://PONTOINTERATIVO.ZIP.NET", PALETTE["ink"], scale=1)
    c.bevel_box(ax + aw - 16, ay + 1, 14, 11, PALETTE["header_sub"], PALETTE["chrome_hi"], PALETTE["chrome_lo"])
    c.text(ax + aw - 13, ay + 4, "IR", PALETTE["ink"], scale=1)

    # Page viewport
    px, py, pw, ph = wx + 3, ay + ah + 3, ww - 6, wh - (ay + ah + 3 - wy) - 3
    c.bevel_box(px, py, pw, ph, PALETTE["paper"], PALETTE["chrome_lo"], PALETTE["chrome_hi"])

    # Blog header banner
    hx, hy, hw, hh = px + 3, py + 3, pw - 6, 26
    c.rect(hx, hy, hw, hh, PALETTE["header_bg"])
    c.rect(hx, hy + hh - 3, hw, 3, PALETTE["header_sub"])
    # Pixel dot emblem
    c.rect(hx + 5, hy + 5, 12, 12, PALETTE["paper"])
    c.rect(hx + 8, hy + 8, 6, 6, PALETTE["accent"])
    c.text(hx + 22, hy + 5, "PONTO INTERATIVO", PALETTE["white"], scale=1)
    c.text(hx + 22, hy + 13, "BLOG DO VICTOR (2005)", PALETTE["paper"], scale=1)

    # Content layout: Sidebar (left) + Post Card (right)
    cx = hx
    cy = hy + hh + 4
    sw = 62
    sh = ph - hh - 10

    # Sidebar
    c.rect(cx, cy, sw, sh, PALETTE["sidebar"])
    c.border(cx, cy, sw, sh, PALETTE["chrome_lo"])
    c.rect(cx + 1, cy + 1, sw - 2, 10, PALETTE["teal"])
    c.text(cx + 4, cy + 3, "MENU", PALETTE["white"], scale=1)

    links = ["INICIO", "SOBRE MIM", "LINKS", "FOTOS", "RECADOS"]
    for i, label in enumerate(links):
        ly = cy + 15 + i * 11
        c.text(cx + 4, ly, ">", PALETTE["accent"], scale=1)
        c.text(cx + 10, ly, label, PALETTE["link"], scale=1)
        c.rect(cx + 10, ly + 6, min(len(label) * 4 - 1, sw - 14), 1, PALETTE["link"])

    # Visitor counter box at bottom of sidebar
    vx, vy, vw, vh = cx + 3, cy + sh - 24, sw - 6, 21
    c.rect(vx, vy, vw, vh, PALETTE["lcd_bg"])
    c.border(vx, vy, vw, vh, PALETTE["chrome_lo"])
    c.text(vx + 4, vy + 3, "VISITANTES:", PALETTE["paper"], scale=1)
    c.text(vx + 10, vy + 11, "00042", PALETTE["lcd_fg"], scale=1)

    # Main Post Card
    mx = cx + sw + 4
    my = cy
    mw = hw - sw - 4
    mh = sh
    c.rect(mx, my, mw, mh, PALETTE["card"])
    c.border(mx, my, mw, mh, PALETTE["chrome_lo"])

    # Post header bar
    c.rect(mx + 2, my + 2, mw - 4, 11, PALETTE["gold"])
    c.text(mx + 5, my + 5, "MEU PRIMEIRO SITE NO AR!", PALETTE["ink"], scale=1)
    c.text(mx + 5, my + 16, "JAN/2005 · ARAGUAINA/TO", PALETTE["muted"], scale=1)

    # Pixel-art illustration inside post card (little CRT + ipe sun)
    ix, iy, iw, ih = mx + 5, my + 24, 48, 36
    c.rect(ix, iy, iw, ih, PALETTE["title_bar2"])
    c.border(ix, iy, iw, ih, PALETTE["ink"])
    # Sky sun + cerrado ground
    c.rect(ix + 1, iy + 25, iw - 2, 10, PALETTE["green"])
    c.rect(ix + 35, iy + 4, 8, 8, PALETTE["gold"])
    # Little retro PC on desk
    c.rect(ix + 8, iy + 11, 20, 14, PALETTE["chrome"])
    c.border(ix + 8, iy + 11, 20, 14, PALETTE["ink"])
    c.rect(ix + 11, iy + 13, 14, 9, PALETTE["lcd_bg"])
    c.rect(ix + 13, iy + 15, 6, 2, PALETTE["lcd_fg"])
    c.rect(ix + 13, iy + 18, 10, 1, PALETTE["gold"])
    c.rect(ix + 14, iy + 25, 8, 2, PALETTE["chrome_lo"])

    # Post text lines next to illustration
    tx2 = ix + iw + 5
    c.text(tx2, iy + 2, "OI PESSOAL!", PALETTE["accent"], scale=1)
    c.text(tx2, iy + 10, "CRIEI ESTE BLOG", PALETTE["ink"], scale=1)
    c.text(tx2, iy + 18, "COM HTML E MUITO", PALETTE["ink"], scale=1)
    c.text(tx2, iy + 26, "CAFE EM CASA!", PALETTE["ink"], scale=1)

    # Body lines below illustration
    by2 = iy + ih + 6
    c.text(mx + 5, by2, "AQUI VOU POSTAR DICAS,", PALETTE["ink"], scale=1)
    c.text(mx + 5, by2 + 8, "DESENHOS E NOVIDADES.", PALETTE["ink"], scale=1)
    c.text(mx + 5, by2 + 16, "DEIXE UM RECADO!", PALETTE["muted"], scale=1)

    # Bottom status/tags
    c.rect(mx + 4, my + mh - 14, mw - 8, 1, PALETTE["chrome"])
    c.text(mx + 5, my + mh - 10, "TAGS: HTML  BLOG  2005", PALETTE["link"], scale=1)


def main():
    out_path = (
        Path(__file__).resolve().parent.parent
        / "static"
        / "eras"
        / "origens"
        / "ponto_interativo.png"
    )
    canvas = Canvas(WIDTH, HEIGHT, PALETTE["bg_desk"])
    draw_blog(canvas)
    write_png(out_path, WIDTH, HEIGHT, bytes(canvas.buf))
    size_bytes = out_path.stat().st_size
    print(f"Generated {out_path} ({WIDTH}x{HEIGHT}, {size_bytes} bytes)")


if __name__ == "__main__":
    main()
