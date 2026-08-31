# coding: utf-8
"""Compose editable poster typography onto a textless Seedream base."""

from __future__ import annotations

import io
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

try:
    from my_agent.font_catalog import default_font_id, resolve_font_path
except ImportError:  # Streamlit runs with my_agent as cwd
    from font_catalog import default_font_id, resolve_font_path


LAYOUT_PRESETS = [
    {"id": "top_center", "name": "顶部居中"},
    {"id": "top_left", "name": "顶部左对齐"},
    {"id": "bottom_center", "name": "底部居中"},
    {"id": "bottom_left", "name": "底部左对齐"},
]

_BOX_ROLES = ("title", "headline", "subline")
_ROLE_LABELS = {
    "title": "标题",
    "headline": "主卖点",
    "subline": "补充句",
}
_SHAPE_TYPES = ("line", "rect", "ellipse", "star", "diamond")
_SHAPE_LABELS = {
    "line": "直线",
    "rect": "矩形",
    "ellipse": "椭圆",
    "star": "五角星",
    "diamond": "菱形",
}
# Editor UI sizes are authored against a 1024px-wide stage; compose scales by image width.
_REF_WIDTH = 1024.0


def _scale_px(value: float, width: int, *, minimum: int = 0) -> int:
    """Map editor reference sizes (@1024px wide) onto the real image width."""
    scaled = int(round(float(value) * (float(width) / _REF_WIDTH)))
    return max(minimum, scaled)


def shape_label(shape_type: str) -> str:
    return _SHAPE_LABELS.get(shape_type, shape_type)


def _clamp_opacity(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(0.0, min(1.0, number))


def _color_with_opacity(color: str, opacity: float) -> Tuple[int, int, int, int]:
    return _hex_to_rgba(color, alpha=int(round(_clamp_opacity(opacity, 1.0) * 255)))


def default_shape(
    shape_type: str = "rect",
    *,
    shape_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a centered default shape for sidebar quick-add."""
    kind = shape_type if shape_type in _SHAPE_TYPES else "rect"
    if kind == "line":
        return {
            "id": shape_id or "shape-line",
            "type": "line",
            "x": 0.25,
            "y": 0.50,
            "w": 0.50,
            "h": 0.0,
            "rotation": 0,
            "fill": "#FFFFFF",
            "fill_opacity": 0.0,
            "stroke": "#111111",
            "stroke_width": 4,
            "stroke_opacity": 1.0,
        }
    return {
        "id": shape_id or f"shape-{kind}",
        "type": kind,
        "x": 0.30,
        "y": 0.40,
        "w": 0.40,
        "h": 0.18,
        "rotation": 0,
        "fill": "#FFFFFF",
        "fill_opacity": 0.35,
        "stroke": "#111111",
        "stroke_width": 3,
        "stroke_opacity": 1.0,
    }


def normalize_shape(shape: Optional[Dict[str, Any]], *, index: int = 0) -> Dict[str, Any]:
    source = dict(shape or {})
    kind = str(source.get("type") or "rect").strip().lower()
    if kind not in _SHAPE_TYPES:
        kind = "rect"
    fallback = default_shape(kind, shape_id=f"shape-{index + 1}")
    item = dict(fallback)
    item.update(source)
    item["id"] = str(item.get("id") or f"shape-{index + 1}")
    item["type"] = kind
    item["x"] = _clamp01(item.get("x"), fallback["x"])
    item["y"] = _clamp01(item.get("y"), fallback["y"])
    try:
        item["w"] = float(item.get("w"))
    except (TypeError, ValueError):
        item["w"] = float(fallback["w"])
    try:
        item["h"] = float(item.get("h"))
    except (TypeError, ValueError):
        item["h"] = float(fallback["h"])
    # Keep geometry on-canvas: endpoints for lines, box for rect/ellipse.
    if kind == "line":
        x2 = _clamp01(item["x"] + item["w"], item["x"])
        y2 = _clamp01(item["y"] + item["h"], item["y"])
        item["x"] = _clamp01(item["x"], fallback["x"])
        item["y"] = _clamp01(item["y"], fallback["y"])
        item["w"] = x2 - item["x"]
        item["h"] = y2 - item["y"]
    else:
        item["w"] = max(0.01, min(1.0, abs(float(item["w"]))))
        item["h"] = max(0.01, min(1.0, abs(float(item["h"]))))
        if item["x"] + item["w"] > 1.0:
            item["x"] = max(0.0, 1.0 - item["w"])
        if item["y"] + item["h"] > 1.0:
            item["y"] = max(0.0, 1.0 - item["h"])
    item["rotation"] = 0  # rotation reserved; not used in MVP
    item["fill"] = str(item.get("fill") or fallback["fill"])
    item["stroke"] = str(item.get("stroke") or fallback["stroke"])
    item["fill_opacity"] = _clamp_opacity(
        item.get("fill_opacity"), fallback["fill_opacity"]
    )
    item["stroke_opacity"] = _clamp_opacity(
        item.get("stroke_opacity"), fallback["stroke_opacity"]
    )
    try:
        item["stroke_width"] = max(1, min(64, int(item.get("stroke_width") or 3)))
    except (TypeError, ValueError):
        item["stroke_width"] = int(fallback["stroke_width"])
    if kind == "line":
        item["fill_opacity"] = 0.0
    return item


def normalize_shapes(shapes: Any) -> List[Dict[str, Any]]:
    if not isinstance(shapes, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for index, item in enumerate(shapes):
        if not isinstance(item, dict):
            continue
        normalized.append(normalize_shape(item, index=index))
    return normalized


def normalize_image_overlay(
    image: Optional[Dict[str, Any]], *, index: int = 0
) -> Dict[str, Any]:
    source = dict(image or {})
    item = {
        "id": str(source.get("id") or f"img-{index + 1}"),
        "x": _clamp01(source.get("x"), 0.1),
        "y": _clamp01(source.get("y"), 0.1),
        "w": max(0.04, min(1.0, abs(float(source.get("w") or 0.2)))),
        "h": max(0.04, min(1.0, abs(float(source.get("h") or 0.15)))),
        "image_b64": str(source.get("image_b64") or ""),
    }
    if item["x"] + item["w"] > 1.0:
        item["x"] = max(0.0, 1.0 - item["w"])
    if item["y"] + item["h"] > 1.0:
        item["y"] = max(0.0, 1.0 - item["h"])
    return item


def normalize_images(images: Any) -> List[Dict[str, Any]]:
    if not isinstance(images, list):
        return []
    out: List[Dict[str, Any]] = []
    for index, item in enumerate(images):
        if not isinstance(item, dict):
            continue
        normalized = normalize_image_overlay(item, index=index)
        if normalized.get("image_b64"):
            out.append(normalized)
    return out


def _star_polygon(
    cx: float, cy: float, rx: float, ry: float, points: int = 5
) -> List[Tuple[float, float]]:
    import math

    coords: List[Tuple[float, float]] = []
    for i in range(points * 2):
        angle = -math.pi / 2 + i * math.pi / points
        radius_x = rx if i % 2 == 0 else rx * 0.42
        radius_y = ry if i % 2 == 0 else ry * 0.42
        coords.append((cx + radius_x * math.cos(angle), cy + radius_y * math.sin(angle)))
    return coords


def _diamond_polygon(
    left: float, top: float, right: float, bottom: float
) -> List[Tuple[float, float]]:
    cx = (left + right) / 2
    cy = (top + bottom) / 2
    return [(cx, top), (right, cy), (cx, bottom), (left, cy)]


def _draw_shapes(
    draw: ImageDraw.ImageDraw,
    shapes: List[Dict[str, Any]],
    width: int,
    height: int,
) -> None:
    for shape in shapes:
        kind = str(shape.get("type") or "rect")
        x = float(shape.get("x") or 0.0) * width
        y = float(shape.get("y") or 0.0) * height
        w = float(shape.get("w") or 0.0) * width
        h = float(shape.get("h") or 0.0) * height
        stroke = _color_with_opacity(
            str(shape.get("stroke") or "#111111"),
            float(shape.get("stroke_opacity") or 1.0),
        )
        stroke_width = max(1, _scale_px(float(shape.get("stroke_width") or 3), width, minimum=1))
        if kind == "line":
            draw.line(
                (x, y, x + w, y + h),
                fill=stroke,
                width=stroke_width,
            )
            continue
        fill_opacity = float(shape.get("fill_opacity") or 0.0)
        fill = (
            _color_with_opacity(str(shape.get("fill") or "#FFFFFF"), fill_opacity)
            if fill_opacity > 0.001
            else None
        )
        left = min(x, x + w)
        top = min(y, y + h)
        right = max(x, x + w)
        bottom = max(y, y + h)
        bbox = (left, top, right, bottom)
        if kind == "ellipse":
            draw.ellipse(bbox, fill=fill, outline=stroke, width=stroke_width)
        elif kind == "star":
            cx = (left + right) / 2
            cy = (top + bottom) / 2
            pts = _star_polygon(cx, cy, (right - left) / 2, (bottom - top) / 2)
            draw.polygon(pts, fill=fill, outline=stroke)
        elif kind == "diamond":
            pts = _diamond_polygon(left, top, right, bottom)
            draw.polygon(pts, fill=fill, outline=stroke)
        else:
            draw.rectangle(bbox, fill=fill, outline=stroke, width=stroke_width)


def _draw_images(
    base: Image.Image,
    images: List[Dict[str, Any]],
) -> Image.Image:
    if not images:
        return base
    canvas = base.convert("RGBA")
    width, height = canvas.size
    for item in images:
        raw = str(item.get("image_b64") or "").strip()
        if not raw:
            continue
        if raw.startswith("data:") and "," in raw:
            raw = raw.split(",", 1)[1]
        try:
            import base64

            blob = base64.b64decode(raw)
            with Image.open(io.BytesIO(blob)) as src:
                src.load()
                overlay = src.convert("RGBA")
        except Exception:
            continue
        left = int(_clamp01(item.get("x"), 0.1) * width)
        top = int(_clamp01(item.get("y"), 0.1) * height)
        box_w = max(8, int(abs(float(item.get("w") or 0.2)) * width))
        box_h = max(8, int(abs(float(item.get("h") or 0.15)) * height))
        overlay = overlay.resize((box_w, box_h), Image.Resampling.LANCZOS)
        canvas.alpha_composite(overlay, (left, top))
    return canvas


def _hex_to_rgba(color: str, alpha: int = 255) -> Tuple[int, int, int, int]:
    raw = (color or "#FFFFFF").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        raw = "FFFFFF"
    r = int(raw[0:2], 16)
    g = int(raw[2:4], 16)
    b = int(raw[4:6], 16)
    return (r, g, b, max(0, min(255, int(alpha))))


def _load_font(font_id: str, size: int) -> ImageFont.ImageFont:
    path = resolve_font_path(font_id) or resolve_font_path(default_font_id())
    if path is not None:
        try:
            return ImageFont.truetype(str(path), size=max(10, int(size)))
        except OSError:
            pass
    return ImageFont.load_default()


def _clamp01(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(0.0, min(1.0, number))


def _preset_positions(layout_id: str) -> List[Tuple[float, float, str]]:
    lid = (layout_id or "top_center").strip()
    align = "left" if lid.endswith("left") else "center"
    x = 0.08 if align == "left" else 0.50
    if lid.startswith("bottom"):
        return [
            (x, 0.78, align),
            (x, 0.85, align),
            (x, 0.91, align),
        ]
    return [
        (x, 0.08, align),
        (x, 0.15, align),
        (x, 0.21, align),
    ]


def role_label(role: str) -> str:
    role = str(role or "")
    if role in _ROLE_LABELS:
        return _ROLE_LABELS[role]
    if role.startswith("custom-"):
        return f"自定义{role.split('-', 1)[-1]}"
    return role or "文字"


def default_text_boxes(
    copy: Optional[Dict[str, Any]] = None,
    platform: Optional[str] = None,
) -> List[Dict[str, Any]]:
    copy = copy or {}
    try:
        from platform_catalog import platform_visual_config
    except ImportError:
        from my_agent.platform_catalog import platform_visual_config  # type: ignore

    visual = platform_visual_config(platform) if platform else {}
    layout_id = str(visual.get("layout_id") or "top_center")
    positions = _preset_positions(layout_id)
    text_color = str(visual.get("text_color") or "#FFFFFF")
    accent = str(visual.get("accent_color") or "#FFE9B7")
    align_default = str(visual.get("text_align") or "center")
    show_panel = bool(visual.get("show_panel", False))
    specs = [
        (
            "title",
            str(copy.get("title") or ""),
            int(visual.get("title_size") or 72),
            text_color,
        ),
        (
            "headline",
            str(copy.get("headline") or ""),
            int(visual.get("headline_size") or 40),
            accent,
        ),
        (
            "subline",
            str(copy.get("subline") or ""),
            int(visual.get("subline_size") or 28),
            text_color if platform else "#F0F2F5",
        ),
    ]
    boxes: List[Dict[str, Any]] = []
    for index, ((role, text, size, color), (x, y, align)) in enumerate(
        zip(specs, positions)
    ):
        boxes.append(
            {
                "id": f"box-{role}",
                "role": role,
                "text": text,
                "font_size": size,
                "font_id": "",
                "color": color,
                "stroke_width": 0,
                "stroke_color": "#000000",
                "x": x,
                "y": y,
                "align": align_default if platform else align,
                "show_box": show_panel,
            }
        )
    return boxes


def default_custom_text_box(
    *,
    box_id: Optional[str] = None,
    index: int = 1,
) -> Dict[str, Any]:
    """Extra free-form text box beyond the default three roles."""
    return {
        "id": box_id or f"box-custom-{index}",
        "role": f"custom-{index}",
        "text": "",
        "font_size": 36,
        "font_id": "",
        "color": "#FFFFFF",
        "stroke_width": 0,
        "stroke_color": "#000000",
        "x": 0.5,
        "y": min(0.92, 0.28 + 0.08 * ((index - 1) % 6)),
        "align": "center",
        "show_box": False,
    }


def default_text_layout(
    copy: Optional[Dict[str, Any]] = None,
    platform: Optional[str] = None,
) -> Dict[str, Any]:
    try:
        from platform_catalog import platform_visual_config
    except ImportError:
        from my_agent.platform_catalog import platform_visual_config  # type: ignore

    visual = platform_visual_config(platform) if platform else {}
    boxes = default_text_boxes(copy, platform=platform)
    font_id = str(visual.get("preferred_font_id") or default_font_id())
    return {
        "font_id": font_id,
        "boxes": boxes,
        "shapes": [],
        "images": [],
        # Legacy flat fields kept in sync for older session state / fill buttons.
        "title": boxes[0]["text"],
        "headline": boxes[1]["text"],
        "subline": boxes[2]["text"],
        "title_size": boxes[0]["font_size"],
        "headline_size": boxes[1]["font_size"],
        "subline_size": boxes[2]["font_size"],
        "title_color": boxes[0]["color"],
        "headline_color": boxes[1]["color"],
        "subline_color": boxes[2]["color"],
        "layout_id": str(visual.get("layout_id") or "top_center"),
        "show_panel": bool(visual.get("show_panel", False)),
        "target_platform": platform or "",
    }


def _normalize_one_box(
    source: Optional[Dict[str, Any]],
    *,
    role: str,
    fallback: Dict[str, Any],
) -> Dict[str, Any]:
    item = dict(fallback)
    if isinstance(source, dict):
        item.update(source)
    item["id"] = str(item.get("id") or f"box-{role}")
    item["role"] = role
    item["text"] = str(item.get("text") or "")
    item["font_size"] = max(10, int(item.get("font_size") or fallback["font_size"]))
    item["font_id"] = str(item.get("font_id") or "")
    item["color"] = str(item.get("color") or fallback["color"])
    try:
        item["stroke_width"] = max(0, min(24, int(item.get("stroke_width") or 0)))
    except (TypeError, ValueError):
        item["stroke_width"] = 0
    item["stroke_color"] = str(
        item.get("stroke_color") or fallback.get("stroke_color") or "#000000"
    )
    item["x"] = _clamp01(item.get("x"), fallback["x"])
    item["y"] = _clamp01(item.get("y"), fallback["y"])
    align = str(item.get("align") or fallback["align"]).strip().lower()
    item["align"] = "left" if align == "left" else "center"
    item["show_box"] = bool(item.get("show_box", False))
    return item


def normalize_text_layout(layout: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Accept new box layouts or migrate legacy flat layouts."""
    base = default_text_layout()
    incoming = dict(layout or {})
    boxes = incoming.get("boxes")
    if isinstance(boxes, list) and boxes:
        by_role = {
            str(item.get("role")): item
            for item in boxes
            if isinstance(item, dict) and item.get("role")
        }
        normalized_boxes: List[Dict[str, Any]] = []
        for index, role in enumerate(_BOX_ROLES):
            source = by_role.get(role)
            if source is None and index < len(boxes) and isinstance(boxes[index], dict):
                candidate = boxes[index]
                cand_role = str(candidate.get("role") or "")
                if cand_role in _BOX_ROLES or not cand_role:
                    source = candidate
            normalized_boxes.append(
                _normalize_one_box(source, role=role, fallback=base["boxes"][index])
            )
        used_roles = set(_BOX_ROLES)
        custom_index = 1
        for item in boxes:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "")
            if role in _BOX_ROLES:
                continue
            if not role.startswith("custom-"):
                role = f"custom-{custom_index}"
            while role in used_roles:
                custom_index += 1
                role = f"custom-{custom_index}"
            used_roles.add(role)
            fallback = default_custom_text_box(index=custom_index)
            normalized_boxes.append(
                _normalize_one_box(item, role=role, fallback=fallback)
            )
            custom_index += 1
        incoming["boxes"] = normalized_boxes
    else:
        # Migrate legacy single-stack layout into free boxes.
        positions = _preset_positions(str(incoming.get("layout_id") or "top_center"))
        migrated = default_text_boxes(
            {
                "title": incoming.get("title"),
                "headline": incoming.get("headline"),
                "subline": incoming.get("subline"),
            }
        )
        sizes = [
            incoming.get("title_size"),
            incoming.get("headline_size"),
            incoming.get("subline_size"),
        ]
        colors = [
            incoming.get("title_color"),
            incoming.get("headline_color"),
            incoming.get("subline_color"),
        ]
        panel = bool(incoming.get("show_panel", False))
        for index, box in enumerate(migrated):
            box["x"], box["y"], box["align"] = positions[index]
            if sizes[index] is not None:
                box["font_size"] = max(10, int(sizes[index]))
            if colors[index]:
                box["color"] = str(colors[index])
            box["show_box"] = panel
        incoming["boxes"] = migrated

    incoming["font_id"] = str(incoming.get("font_id") or default_font_id())
    boxes = incoming["boxes"]
    by_role = {str(box.get("role")): box for box in boxes}
    for role in _BOX_ROLES:
        box = by_role[role]
        incoming[role] = box["text"]
        incoming[f"{role}_size"] = box["font_size"]
        incoming[f"{role}_color"] = box["color"]
    incoming["show_panel"] = any(bool(box.get("show_box")) for box in boxes)
    incoming["shapes"] = normalize_shapes(incoming.get("shapes"))
    incoming["images"] = normalize_images(incoming.get("images"))
    return incoming


def apply_layout_preset(layout: Dict[str, Any], layout_id: str) -> Dict[str, Any]:
    cfg = normalize_text_layout(layout)
    positions = _preset_positions(layout_id)
    role_boxes = [box for box in cfg["boxes"] if box.get("role") in _BOX_ROLES]
    for index, box in enumerate(role_boxes[: len(positions)]):
        box["x"], box["y"], box["align"] = positions[index]
    cfg["layout_id"] = layout_id
    return cfg


def compose_text_on_base(
    base_image: Image.Image,
    layout: Dict[str, Any],
) -> Image.Image:
    base = base_image.convert("RGBA")
    width, height = base.size
    cfg = normalize_text_layout(layout)
    default_font = str(cfg.get("font_id") or default_font_id())

    # Logo / trademark overlays sit under shapes and text.
    base = _draw_images(base, list(cfg.get("images") or []))

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Shapes under text so decorative fills do not cover copy.
    _draw_shapes(draw, list(cfg.get("shapes") or []), width, height)

    for box in cfg["boxes"]:
        text = str(box.get("text") or "").strip()
        if not text:
            continue
        box_font = str(box.get("font_id") or "").strip() or default_font
        font_px = _scale_px(float(box.get("font_size") or 40), width, minimum=8)
        font = _load_font(box_font, font_px)
        try:
            user_stroke = max(0, int(box.get("stroke_width") or 0))
        except (TypeError, ValueError):
            user_stroke = 0
        stroke_px = _scale_px(user_stroke, width, minimum=0) if user_stroke else 0
        stroke_fill = (
            _hex_to_rgba(str(box.get("stroke_color") or "#000000"))
            if stroke_px > 0
            else None
        )
        # Match editor: (x,y) is top edge; x is left edge or horizontal center.
        anchor_x = _clamp01(box.get("x"), 0.5) * width
        anchor_y = _clamp01(box.get("y"), 0.1) * height
        align = str(box.get("align") or "center")
        text_anchor = "lt" if align == "left" else "mt"
        stroke_kw = stroke_px if stroke_px > 0 else 0
        bbox = draw.textbbox(
            (anchor_x, anchor_y),
            text,
            font=font,
            anchor=text_anchor,
            stroke_width=stroke_kw,
        )
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        # Nudge wholly inside the frame while keeping the same anchor semantics.
        dx = 0.0
        dy = 0.0
        if bbox[0] < 4:
            dx = 4 - bbox[0]
        elif bbox[2] > width - 4:
            dx = (width - 4) - bbox[2]
        if bbox[1] < 4:
            dy = 4 - bbox[1]
        elif bbox[3] > height - 4:
            dy = (height - 4) - bbox[3]
        draw_x = anchor_x + dx
        draw_y = anchor_y + dy

        if bool(box.get("show_box")):
            pad_x = max(10, int(text_w * 0.06))
            pad_y = max(6, int(text_h * 0.25))
            draw.rounded_rectangle(
                (
                    bbox[0] + dx - pad_x,
                    bbox[1] + dy - pad_y,
                    bbox[2] + dx + pad_x,
                    bbox[3] + dy + pad_y,
                ),
                radius=max(8, width // 64),
                fill=(12, 16, 22, 72),
            )

        draw.text(
            (draw_x, draw_y),
            text,
            font=font,
            fill=_hex_to_rgba(str(box.get("color") or "#FFFFFF")),
            anchor=text_anchor,
            stroke_width=stroke_px,
            stroke_fill=stroke_fill,
            embedded_color=True,
        )

    return Image.alpha_composite(base, overlay)


def compose_text_on_bytes(base_png: bytes, layout: Dict[str, Any]) -> bytes:
    with Image.open(io.BytesIO(base_png)) as image:
        image.load()
        composed = compose_text_on_base(image, layout)
    buffer = io.BytesIO()
    composed.convert("RGB").save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
