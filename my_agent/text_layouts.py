# coding: utf-8
"""Local Pillow typography with product-aware safe regions."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont


TEXT_LAYOUT_OPTIONS = [
    {"id": 0, "name": "顶部左对齐", "desc": "标题与卖点顶部左对齐"},
    {"id": 1, "name": "顶部居中", "desc": "标题与卖点顶部居中"},
    {"id": 2, "name": "顶部右对齐", "desc": "标题与卖点顶部右对齐"},
    {"id": 3, "name": "底部左对齐", "desc": "商品在上方时使用底部安全区"},
    {"id": 4, "name": "底部居中", "desc": "商品在上方时使用底部安全区"},
    {"id": 5, "name": "安全区强调", "desc": "高对比安全区文字"},
]


def list_text_layouts() -> List[dict]:
    return list(TEXT_LAYOUT_OPTIONS)


def _font_candidates(bold: bool) -> Iterable[Path]:
    base = Path(__file__).resolve().parent
    local = [
        base / "fonts" / ("NotoSansSC-Bold.otf" if bold else "NotoSansSC-Regular.otf"),
        base / "fonts" / "SourceHanSansSC-Bold.otf",
        base / "fonts" / "wqy-microhei.ttc",
    ]
    windows = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    ]
    return [*local, *windows]


def _load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    for candidate in _font_candidates(bold):
        if candidate.is_file():
            try:
                return ImageFont.truetype(str(candidate), size=max(10, int(size)))
            except OSError:
                continue
    return ImageFont.load_default()


def _fit_font(
    draw: ImageDraw.ImageDraw,
    text: str,
    maximum_width: int,
    starting_size: int,
    bold: bool,
) -> ImageFont.ImageFont:
    size = max(16, starting_size)
    while size > 16:
        font = _load_font(size, bold=bold)
        box = draw.textbbox((0, 0), text or " ", font=font)
        if box[2] - box[0] <= maximum_width:
            return font
        size -= 2
    return _load_font(16, bold=bold)


def _choose_safe_zone(
    size: Tuple[int, int],
    safe_zones: Optional[Iterable[Tuple[int, int, int, int]]],
    layout_id: int,
) -> Tuple[int, int, int, int]:
    zones = [tuple(map(int, zone)) for zone in (safe_zones or []) if len(zone) == 4]
    width, height = size
    if not zones:
        zones = [(int(width * 0.05), int(height * 0.04), int(width * 0.95), int(height * 0.23))]
    wants_bottom = int(layout_id) % 6 in (3, 4)
    ordered = sorted(zones, key=lambda zone: zone[1], reverse=wants_bottom)
    return ordered[0]


def render_text_on_image(
    base_image: Image.Image,
    title: str,
    headline: str,
    subline: str = "",
    visual_style: str = "vibrant",
    layout_id: int = 0,
    protected_bbox: Optional[Tuple[int, int, int, int]] = None,
    safe_zones: Optional[Iterable[Tuple[int, int, int, int]]] = None,
) -> Image.Image:
    """Render exact supplied copy inside a zone that does not cover the product."""
    base = base_image.convert("RGBA")
    width, height = base.size
    zone = _choose_safe_zone(base.size, safe_zones, layout_id)
    x0, y0, x1, y1 = zone
    x0 = max(0, min(x0, width - 1))
    y0 = max(0, min(y0, height - 1))
    x1 = max(x0 + 1, min(x1, width))
    y1 = max(y0 + 1, min(y1, height))

    if protected_bbox is not None:
        px0, py0, px1, py1 = protected_bbox
        overlap = not (x1 <= px0 or x0 >= px1 or y1 <= py0 or y0 >= py1)
        if overlap:
            alternate = (
                int(width * 0.05),
                int(height * 0.77),
                int(width * 0.95),
                int(height * 0.96),
            )
            if not (
                alternate[2] <= px0
                or alternate[0] >= px1
                or alternate[3] <= py0
                or alternate[1] >= py1
            ):
                alternate = (
                    int(width * 0.05),
                    int(height * 0.04),
                    int(width * 0.95),
                    int(height * 0.22),
                )
            x0, y0, x1, y1 = alternate

    title = (title or "").strip()[:18]
    headline = (headline or "").strip()[:22]
    subline = (subline or "").strip()[:28]
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    panel_alpha = 82 if visual_style == "vibrant" else 58
    draw.rounded_rectangle(
        (x0, y0, x1, y1),
        radius=max(10, width // 45),
        fill=(10, 14, 20, panel_alpha),
    )

    margin_x = max(12, int((x1 - x0) * 0.035))
    margin_y = max(8, int((y1 - y0) * 0.08))
    available_width = max(20, x1 - x0 - margin_x * 2)
    title_font = _fit_font(
        draw,
        title,
        available_width,
        starting_size=max(32, int(height * 0.075)),
        bold=True,
    )
    headline_font = _fit_font(
        draw,
        headline,
        available_width,
        starting_size=max(22, int(height * 0.035)),
        bold=False,
    )
    subline_font = _fit_font(
        draw,
        subline,
        available_width,
        starting_size=max(16, int(height * 0.024)),
        bold=False,
    )

    alignment = int(layout_id) % 3

    def text_x(text: str, font: ImageFont.ImageFont) -> float:
        box = draw.textbbox((0, 0), text or " ", font=font)
        text_width = box[2] - box[0]
        if alignment == 1:
            return x0 + (x1 - x0 - text_width) / 2
        if alignment == 2:
            return x1 - margin_x - text_width
        return x0 + margin_x

    current_y = y0 + margin_y
    draw.text(
        (text_x(title, title_font), current_y),
        title,
        font=title_font,
        fill=(255, 255, 255, 255),
        stroke_width=1,
        stroke_fill=(0, 0, 0, 120),
    )
    title_box = draw.textbbox((0, 0), title or " ", font=title_font)
    current_y += title_box[3] - title_box[1] + max(5, height // 120)
    draw.text(
        (text_x(headline, headline_font), current_y),
        headline,
        font=headline_font,
        fill=(255, 233, 183, 255) if visual_style == "premium" else (255, 239, 218, 255),
    )
    headline_box = draw.textbbox((0, 0), headline or " ", font=headline_font)
    current_y += headline_box[3] - headline_box[1] + max(3, height // 180)
    if subline and current_y < y1 - 10:
        draw.text(
            (text_x(subline, subline_font), current_y),
            subline,
            font=subline_font,
            fill=(235, 238, 242, 245),
        )
    return Image.alpha_composite(base, overlay)


def overlay_poster_text(
    base_image: Image.Image,
    title: str,
    headline: str,
    subline: str = "",
    style_preference: str = "",
    product_info: str = "",
    layout_id: int = 0,
    output_directory: Optional[Path] = None,
) -> str:
    """Compatibility file-output helper using collision-resistant filenames."""
    _ = product_info
    visual_style = "premium" if "高端" in style_preference else "vibrant"
    rendered = render_text_on_image(
        base_image,
        title,
        headline,
        subline,
        visual_style=visual_style,
        layout_id=layout_id,
    )
    directory = (output_directory or Path(__file__).resolve().parent / "static" / "posters").resolve()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"poster-{uuid.uuid4()}.png"
    rendered.convert("RGB").save(target, format="PNG", optimize=True)
    return str(target)

