#!/usr/bin/env python3
"""White-background cut-out for generated props (autonomous scheduler worker). Pillow only, no AI.

Usage: python scripts/prop_cutout.py <in.png|jpg> <out.png>

1. Flood fill from every border pixel through near-white pixels: only the background connected to the edge becomes
   transparent, so whites INSIDE the drawing (eye whites, teeth, highlights, a white bottle cap) stay opaque.
2. 2 px dark-mode defringe: on the two pixel rings next to the removed background, light (whitish) pixels fade out in
   proportion to how white they are, so no white halo shows on the dark video background. Dark ink stays solid.
3. Crop to the drawing with a 16 px margin and save a transparent PNG.
Exits non-zero when nothing is left (the image was all background), so the worker drops the prop instead.
"""
import sys
from collections import deque

from PIL import Image

WHITE_MIN = 232  # a background pixel: every channel at least this
FRINGE_FROM = 150  # an edge pixel lighter than this (min channel) fades; pure white fades fully


def cutout(img: Image.Image) -> Image.Image:
    im = img.convert("RGBA")
    w, h = im.size
    px = im.load()
    bg = bytearray(w * h)  # 1 = removed background
    q = deque()

    def near_white(x: int, y: int) -> bool:
        r, g, b, a = px[x, y]
        return a < 16 or min(r, g, b) >= WHITE_MIN

    for x in range(w):
        for y in (0, h - 1):
            if not bg[y * w + x] and near_white(x, y):
                bg[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not bg[y * w + x] and near_white(x, y):
                bg[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx] and near_white(nx, ny):
                bg[ny * w + nx] = 1
                q.append((nx, ny))
    for i in range(w * h):
        if bg[i]:
            x, y = i % w, i // w
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, 0)

    # 2 px defringe: ring 1 touches the background, ring 2 touches ring 1
    removed = bg
    for _ring in range(2):
        ring = bytearray(w * h)
        for y in range(h):
            row = y * w
            for x in range(w):
                if removed[row + x]:
                    continue
                if (x > 0 and removed[row + x - 1]) or (x < w - 1 and removed[row + x + 1]) or (y > 0 and removed[row - w + x]) or (y < h - 1 and removed[row + w + x]):
                    ring[row + x] = 1
        for i in range(w * h):
            if ring[i]:
                x, y = i % w, i // w
                r, g, b, a = px[x, y]
                light = max(0.0, min(1.0, (min(r, g, b) - FRINGE_FROM) / (255 - FRINGE_FROM)))
                px[x, y] = (r, g, b, int(round(a * (1.0 - light))))
        removed = bytearray(1 if (removed[i] or ring[i]) else 0 for i in range(w * h))

    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if not box:
        raise ValueError("nothing left after removing the background")
    m = 16
    return im.crop((max(0, box[0] - m), max(0, box[1] - m), min(w, box[2] + m), min(h, box[3] + m)))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: prop_cutout.py <in> <out.png>")
    try:
        out = cutout(Image.open(sys.argv[1]))
        out.save(sys.argv[2], "PNG", optimize=True)
        print(f"cut-out {out.size[0]}x{out.size[1]} → {sys.argv[2]}")
    except Exception as e:  # unreadable image, all background
        sys.exit(f"cut-out failed: {e}")
