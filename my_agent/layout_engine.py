# coding: utf-8
"""Local product placement for the three supported physical product types."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from PIL import Image, ImageDraw, ImageFilter

PRODUCT_TYPES = ("bag_heavy", "bottle_upright", "flat_small")

PRODUCT_TYPE_LABELS = {
    "bag_heavy": "袋装/重物",
    "bottle_upright": "瓶装/立式",
    "flat_small": "扁平/小物",
}


def _trim(image: Image.Image, padding: int = 4) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if not bbox:
        return rgba
    left, top, right, bottom = bbox
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(rgba.width, right + padding)
    bottom = min(rgba.height, bottom + padding)
    return rgba.crop((left, top, right, bottom))


def _scale_to_max(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    result = image.copy()
    result.thumbnail((max(1, max_width), max(1, max_height)), Image.Resampling.LANCZOS)
    return result


def _paste(canvas: Image.Image, layer: Image.Image, xy: Tuple[int, int]) -> Image.Image:
    base = canvas.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    overlay.paste(layer, xy, layer)
    return Image.alpha_composite(base, overlay)


def _draw_gravity_shadow(
    canvas: Image.Image,
    xy: Tuple[int, int],
    size: Tuple[int, int],
    strength: int,
) -> Image.Image:
    x, y = xy
    width, height = size
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    center_y = y + height + 2
    draw.ellipse(
        [
            x + int(width * 0.18),
            center_y - 8,
            x + int(width * 0.82),
            center_y + 10,
        ],
        fill=(0, 0, 0, strength),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=7))
    return Image.alpha_composite(canvas.convert("RGBA"), shadow)


def _draw_pedestal(
    canvas: Image.Image,
    product_xy: Tuple[int, int],
    product_size: Tuple[int, int],
) -> Image.Image:
    x, y = product_xy
    product_width, product_height = product_size
    base = canvas.convert("RGBA")
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    center_x = x + product_width // 2
    center_y = y + product_height + 2
    radius_x = int(product_width * 0.58)
    radius_y = max(12, int(product_width * 0.13))

    sample_box = (
        max(0, center_x - radius_x),
        max(0, center_y - radius_y * 2),
        min(base.width, center_x + radius_x),
        min(base.height, center_y + radius_y * 3),
    )
    sample = base.crop(sample_box).convert("RGB").resize((24, 16), Image.Resampling.BILINEAR)
    pixels = list(sample.get_flattened_data())
    if pixels:
        average = tuple(int(sum(pixel[index] for pixel in pixels) / len(pixels)) for index in range(3))
    else:
        average = (220, 210, 195)
    surface = tuple(min(255, value + 28) for value in average)
    highlight = tuple(min(255, value + 18) for value in surface)

    draw.ellipse(
        [center_x - radius_x, center_y + 2, center_x + radius_x, center_y + radius_y + 12],
        fill=(0, 0, 0, 42),
    )
    draw.ellipse(
        [center_x - radius_x, center_y - radius_y, center_x + radius_x, center_y + radius_y],
        fill=(*surface, 110),
    )
    draw.ellipse(
        [
            center_x - int(radius_x * 0.82),
            center_y - int(radius_y * 0.55),
            center_x + int(radius_x * 0.82),
            center_y + int(radius_y * 0.35),
        ],
        fill=(*highlight, 70),
    )
    return Image.alpha_composite(base, layer.filter(ImageFilter.GaussianBlur(radius=2.2)))


def _safe_zones(
    canvas_size: Tuple[int, int], product_bbox: Tuple[int, int, int, int]
) -> Dict[str, List[Tuple[int, int, int, int]]]:
    width, height = canvas_size
    margin_x = int(width * 0.05)
    candidates = [
        (margin_x, int(height * 0.035), width - margin_x, int(height * 0.23)),
        (margin_x, int(height * 0.76), width - margin_x, int(height * 0.96)),
    ]

    def intersects(first: Tuple[int, int, int, int], second: Tuple[int, int, int, int]) -> bool:
        return not (
            first[2] <= second[0]
            or first[0] >= second[2]
            or first[3] <= second[1]
            or first[1] >= second[3]
        )

    padding = int(min(width, height) * 0.035)
    protected = (
        max(0, product_bbox[0] - padding),
        max(0, product_bbox[1] - padding),
        min(width, product_bbox[2] + padding),
        min(height, product_bbox[3] + padding),
    )
    text_zones = [zone for zone in candidates if not intersects(zone, protected)]
    if not text_zones:
        text_zones = [candidates[0] if product_bbox[1] > height // 2 else candidates[1]]
    decoration_zones = [
        (0, int(height * 0.25), int(width * 0.22), int(height * 0.72)),
        (int(width * 0.78), int(height * 0.25), width, int(height * 0.72)),
    ]
    return {
        "text_safe_zones": text_zones,
        "decoration_safe_zones": decoration_zones,
    }


def _metadata(
    canvas: Image.Image,
    product: Image.Image,
    xy: Tuple[int, int],
    product_type: str,
    rotation_degrees: float = 0.0,
    layout_note: str = "",
) -> Dict[str, Any]:
    x, y = xy
    bbox = (x, y, x + product.width, y + product.height)
    zones = _safe_zones(canvas.size, bbox)
    return {
        "product_xy": xy,
        "product_size": product.size,
        "product_bbox": bbox,
        "scaled_product": product,
        "product_type": product_type,
        "rotation_degrees": rotation_degrees,
        "layout_note": layout_note,
        **zones,
    }


def apply_bag_heavy_layout(
    canvas: Image.Image,
    product_layer: Image.Image,
    variant: int = 0,
) -> Tuple[Image.Image, Dict[str, Any]]:
    width, height = canvas.size
    product = _scale_to_max(_trim(product_layer), int(width * 0.62), int(height * 0.74))
    x = (width - product.width) // 2 + (
        int(width * 0.05) if variant % 2 else -int(width * 0.04)
    )
    x = max(int(width * 0.06), min(x, width - product.width - int(width * 0.04)))
    y = max(int(height * 0.22), int(height * 0.94) - product.height)
    output = canvas.convert("RGBA")
    output = _draw_gravity_shadow(output, (x, y), product.size, strength=120)
    output = _paste(output, product, (x, y))
    return output, _metadata(
        output,
        product,
        (x, y),
        "bag_heavy",
        layout_note="bag_heavy: large grounded placement",
    )


def apply_bottle_upright_layout(
    canvas: Image.Image,
    product_layer: Image.Image,
    variant: int = 0,
) -> Tuple[Image.Image, Dict[str, Any]]:
    width, height = canvas.size
    product = _scale_to_max(_trim(product_layer), int(width * 0.38), int(height * 0.62))
    x = (width - product.width) // 2
    y = max(int(height * 0.18), height - product.height - int(height * 0.16))
    output = _draw_pedestal(canvas.convert("RGBA"), (x, y), product.size)
    output = _draw_gravity_shadow(output, (x, y), product.size, strength=28)
    output = _paste(output, product, (x, y))
    return output, _metadata(
        output,
        product,
        (x, y),
        "bottle_upright",
        layout_note="bottle_upright: slim placement with local pedestal",
    )


def apply_flat_small_layout(
    canvas: Image.Image,
    product_layer: Image.Image,
    variant: int = 0,
) -> Tuple[Image.Image, Dict[str, Any]]:
    width, height = canvas.size
    product = _scale_to_max(_trim(product_layer), int(width * 0.68), int(height * 0.40))
    angle = [-22, 16, -12, 20][int(variant) % 4]
    rotated = product.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    x = (width - rotated.width) // 2 + (variant % 3 - 1) * int(width * 0.03)
    y = int(height * 0.22) + (variant % 3) * 10
    y = max(int(height * 0.14), min(y, height - rotated.height - int(height * 0.28)))
    output = canvas.convert("RGBA")
    shadow = Image.new("RGBA", output.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    draw.ellipse(
        [x + 8, y + rotated.height - 6, x + rotated.width - 8, y + rotated.height + 10],
        fill=(0, 0, 0, 22),
    )
    output = Image.alpha_composite(output, shadow.filter(ImageFilter.GaussianBlur(radius=6)))
    output = _paste(output, rotated, (x, y))
    return output, _metadata(
        output,
        rotated,
        (x, y),
        "flat_small",
        rotation_degrees=angle,
        layout_note=f"flat_small: rotated local product {angle} degrees",
    )


def apply_layout_by_product_type(
    canvas: Image.Image,
    product_layer: Image.Image,
    product_type: str = "bag_heavy",
    variant: int = 0,
) -> Tuple[Image.Image, Dict[str, Any]]:
    selected = product_type if product_type in PRODUCT_TYPES else "bag_heavy"
    if selected == "bottle_upright":
        return apply_bottle_upright_layout(canvas, product_layer, variant)
    if selected == "flat_small":
        return apply_flat_small_layout(canvas, product_layer, variant)
    return apply_bag_heavy_layout(canvas, product_layer, variant)


def infer_product_type_hint(width: int, height: int, user_tags: str = "") -> str:
    text = (user_tags or "").lower()
    if any(term in text for term in ("袋", "粮", "bag", "pouch")):
        return "bag_heavy"
    if any(term in text for term in ("瓶", "香水", "bottle", "perfume")):
        return "bottle_upright"
    if any(term in text for term in ("盒", "珠宝", "耳机", "flat", "jewelry")):
        return "flat_small"
    if height > 0 and width / max(height, 1) > 1.15:
        return "flat_small"
    if height > 0 and height / max(width, 1) > 1.6:
        return "bottle_upright"
    return "bag_heavy"
