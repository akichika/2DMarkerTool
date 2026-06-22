#!/usr/bin/env python3
"""2DMarkerTool icon generator.
Dark rounded tile + green frame + white square + black ArUco-style marker.
Rendered at 4x then downscaled for crisp anti-aliasing.
The same 6x6 marker pattern is mirrored in index.html (#i-app SVG).
"""
from PIL import Image, ImageDraw

DARK = (15, 18, 22, 255)
GREEN = (45, 211, 111, 255)
WHITE = (255, 255, 255, 255)
BLACK = (17, 20, 26, 255)

# 6x6 marker grid (True = black). Border is black; interior is a fixed pattern.
INNER = [
    [1, 0, 0, 1],
    [0, 1, 1, 0],
    [0, 1, 0, 1],
    [1, 0, 1, 0],
]
def marker_grid():
    g = [[True] * 6 for _ in range(6)]
    for r in range(6):
        for c in range(6):
            if 1 <= r <= 4 and 1 <= c <= 4:
                g[r][c] = bool(INNER[r - 1][c - 1])
            else:
                g[r][c] = True  # border
    return g
GRID = marker_grid()


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def render(size, maskable=False):
    S = 4  # supersample
    W = size * S
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # safe area: maskable icons need ~10% padding all around
    pad = int(W * 0.10) if maskable else 0
    a = pad
    b = W - pad
    span = b - a
    # tile
    rounded(d, [a, b - span, a + span, b], int(span * 0.22), DARK) if False else None
    rounded(d, [a, a, b, b], int(span * 0.22), DARK)
    # green frame
    g0 = a + int(span * 0.085)
    rounded(d, [g0, g0, b - (g0 - a), b - (g0 - a)], int(span * 0.165), GREEN)
    # white square
    w0 = a + int(span * 0.155)
    rounded(d, [w0, w0, b - (w0 - a), b - (w0 - a)], int(span * 0.085), WHITE)
    # marker 6x6
    m0 = a + int(span * 0.215)
    m1 = b - (m0 - a)
    cell = (m1 - m0) / 6.0
    for r in range(6):
        for c in range(6):
            if GRID[r][c]:
                x0 = m0 + c * cell
                y0 = m0 + r * cell
                d.rectangle([x0, y0, x0 + cell + 0.6, y0 + cell + 0.6], fill=BLACK)
    return img.resize((size, size), Image.LANCZOS)


for name, size, mask in [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-maskable-512.png", 512, True),
    ("favicon-64.png", 64, False),
]:
    render(size, mask).save(name)
    print("wrote", name)
