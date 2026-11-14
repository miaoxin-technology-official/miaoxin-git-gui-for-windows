#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Generate Miaoxin Git GUI application icons from a single geometric definition.

Outputs (all paths relative to the repository root):
  build/icon.png        1024x1024 master PNG (transparent outside the rounded tile)
  build/icon.ico        16/24/32/48/64/128/256 px multi-size ICO
  assets/logo.svg       vector version of the same mark
  assets/mark-32.png    32x32 mark for in-app / README usage

Design (1024x1024 design space, warm charcoal + copper):
  - rounded tile #141210, corner radius 200, 1px inner stroke rgba(233,228,217,0.12)
  - mark: one vertical trunk, one branch stroke, three commit nodes
    (trunk/branch #C4763F, the branch node #E9E4D9), stroke width 52, round caps
  - no text, no gradients, no glow. Small ICO sizes are rendered separately with
    a heavier stroke so the mark stays readable at 16/24/32 px.

Run:  python scripts/make-icon.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ASSETS = ROOT / "assets"

# --- design space -----------------------------------------------------------
SIZE = 1024
RADIUS = 200
BG = "#141210"
COPPER = "#C4763F"
LIGHT = "#E9E4D9"
RING = (233, 228, 217, 31)  # rgba(233,228,217,0.12) over 255

TRUNK_X = 376
TRUNK_TOP = 300
TRUNK_BOTTOM = 724
BRANCH_NODE = (648, 424)  # branch tip, light-coloured node
BRANCH_ATTACH = (376, 560)
STROKE = 52
NODE_R = 78

ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)

# Per-size optical compensation: (stroke, node radius) in design units.
# 16 px would turn a 52-unit stroke into 0.8 device px, so small frames use a
# heavier variant. From 48 px up the spec geometry is used unchanged.
OPTICAL = {
    16: (92, 120),
    24: (82, 108),
    32: (70, 96),
}


def rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def render(
    size: int,
    *,
    stroke: int = STROKE,
    node_r: int = NODE_R,
    supersample: int = 4,
) -> Image.Image:
    """Render the icon at `size` px, with `supersample`x supersampling."""
    canvas = size * supersample
    k = canvas / SIZE  # design units -> canvas pixels
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    sw = max(1, round(stroke * k))
    nr = round(node_r * k)

    # tile + 1px inner stroke
    ring_w = max(1, round(k))  # 1 design px inner stroke, at least 1 device px
    inset = ring_w / 2
    tile = (inset, inset, canvas - 1 - inset, canvas - 1 - inset)
    d.rounded_rectangle(tile, radius=round(RADIUS * k), fill=rgb(BG) + (255,))

    # mark geometry (device pixels)
    tx = round(TRUNK_X * k)
    ty0 = round(TRUNK_TOP * k)
    ty1 = round(TRUNK_BOTTOM * k)
    bx, by = (round(BRANCH_NODE[0] * k), round(BRANCH_NODE[1] * k))
    ax, ay = (round(BRANCH_ATTACH[0] * k), round(BRANCH_ATTACH[1] * k))
    copper = rgb(COPPER) + (255,)

    # trunk + branch, round caps
    d.line([(tx, ty0), (tx, ty1)], fill=copper, width=sw)
    d.line([(tx, ay), (bx, by)], fill=copper, width=sw)
    cap = sw / 2
    for cx, cy in ((tx, ty0), (tx, ty1), (tx, ay)):
        d.ellipse((cx - cap, cy - cap, cx + cap, cy + cap), fill=copper)

    # commit nodes on top
    def node(cx: int, cy: int, color: tuple[int, int, int, int]) -> None:
        d.ellipse((cx - nr, cy - nr, cx + nr, cy + nr), fill=color)

    node(tx, ty0, copper)
    node(tx, ty1, copper)
    node(bx, by, rgb(LIGHT) + (255,))

    # inner 1px ring, drawn last so it stays crisp on the tile edge
    d.rounded_rectangle(
        tile,
        radius=round(RADIUS * k),
        outline=RING,
        width=ring_w,
    )

    if supersample > 1:
        img = img.resize((size, size), Image.Resampling.LANCZOS)
    return img


def logo_svg() -> str:
    """Vector twin of the raster mark, same coordinate space."""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}" role="img" aria-label="Miaoxin Git GUI">
  <title>Miaoxin Git GUI</title>
  <rect x="0.5" y="0.5" width="{SIZE - 1}" height="{SIZE - 1}" rx="{RADIUS - 0.5}" fill="{BG}" stroke="#E9E4D9" stroke-opacity="0.12"/>
  <g fill="none" stroke="{COPPER}" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M{TRUNK_X} {TRUNK_TOP}V{TRUNK_BOTTOM}"/>
    <path d="M{TRUNK_X} {BRANCH_ATTACH[1]}L{BRANCH_NODE[0]} {BRANCH_NODE[1]}"/>
  </g>
  <circle cx="{TRUNK_X}" cy="{TRUNK_TOP}" r="{NODE_R}" fill="{COPPER}"/>
  <circle cx="{TRUNK_X}" cy="{TRUNK_BOTTOM}" r="{NODE_R}" fill="{COPPER}"/>
  <circle cx="{BRANCH_NODE[0]}" cy="{BRANCH_NODE[1]}" r="{NODE_R}" fill="{LIGHT}"/>
</svg>
"""


def verify_ico(path: Path) -> list[tuple[int, int]]:
    """Read the ICO back and return the embedded frame sizes."""
    with Image.open(path) as ico:
        declared = sorted(ico.info.get("sizes", set()))
        # force-decode every frame: catches truncated/corrupt entries
        for w, h in declared:
            ico.size = (w, h)
            ico.load()
        actual = sorted(ico.info.get("sizes", set()))
    if declared != actual:
        raise RuntimeError(f"ICO frame list changed while reading: {declared} -> {actual}")
    return actual


def main() -> int:
    BUILD.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    master = render(SIZE, supersample=4)
    master.save(BUILD / "icon.png", "PNG", optimize=True)

    frames = []
    for s in ICO_SIZES:
        if s == 256:
            frames.append(master.resize((256, 256), Image.Resampling.LANCZOS))
        else:
            stroke, node_r = OPTICAL.get(s, (STROKE, NODE_R))
            frames.append(render(s, stroke=stroke, node_r=node_r, supersample=4))

    master.save(
        BUILD / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=frames,
    )

    (ASSETS / "logo.svg").write_text(logo_svg(), encoding="utf-8")
    master.resize((32, 32), Image.Resampling.LANCZOS).save(
        ASSETS / "mark-32.png", "PNG", optimize=True
    )

    sizes = verify_ico(BUILD / "icon.ico")
    expected = sorted((s, s) for s in ICO_SIZES)
    if sizes != expected:
        raise RuntimeError(f"ICO sizes mismatch: {sizes} != {expected}")

    print("generated:")
    for p in (BUILD / "icon.png", BUILD / "icon.ico", ASSETS / "logo.svg", ASSETS / "mark-32.png"):
        print(f"  {p.relative_to(ROOT)}  {p.stat().st_size:,} bytes")
    print(f"ico frames ({len(sizes)}): {', '.join(f'{w}x{h}' for w, h in sizes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
