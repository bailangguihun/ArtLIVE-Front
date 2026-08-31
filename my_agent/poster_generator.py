# coding: utf-8
"""Local-only product cutout, procedural background, layout, text, and composition."""

from __future__ import annotations

import hashlib
import io
import math
import os
import random
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageOps, UnidentifiedImageError


REMBG_MODEL_NAME = "u2net"
REMBG_MODEL_FILENAME = "u2net.onnx"
REMBG_MODEL_MD5 = "60024c5c889badc19c04ad937298a77b"
REMBG_MODEL_DIR = Path(__file__).resolve().parent / ".models" / "rembg"
_REMBG_SESSION: Any = None
_REMBG_SESSION_LOCK = threading.Lock()


def rembg_model_path() -> Path:
    """Return the one deterministic local model path used by product cutout."""
    return REMBG_MODEL_DIR / REMBG_MODEL_FILENAME


def _validate_rembg_model() -> Path:
    model_path = rembg_model_path()
    if not model_path.is_file():
        raise RuntimeError(
            "Local product cutout model is not provisioned. "
            "Run scripts/provision_rembg_model.ps1 first."
        )
    digest = hashlib.md5(usedforsecurity=False)
    with model_path.open("rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest().lower() != REMBG_MODEL_MD5:
        raise RuntimeError("Local product cutout model failed checksum validation.")
    return model_path


def _get_rembg_session() -> Any:
    """Load the checked local model once; never download during a user request."""
    global _REMBG_SESSION
    if _REMBG_SESSION is not None:
        return _REMBG_SESSION
    with _REMBG_SESSION_LOCK:
        if _REMBG_SESSION is not None:
            return _REMBG_SESSION
        model_path = _validate_rembg_model()
        if "MODEL_CHECKSUM_DISABLED" in os.environ:
            raise RuntimeError("Disabling rembg model checksum validation is not allowed.")
        os.environ["U2NET_HOME"] = str(REMBG_MODEL_DIR)
        try:
            import onnxruntime as ort
            from rembg.sessions.u2net import U2netSession
        except ImportError as exc:
            raise RuntimeError("Local product cutout dependency is unavailable.") from exc

        class LocalU2netSession(U2netSession):
            @classmethod
            def download_models(cls, *args, **kwargs):
                _ = (args, kwargs)
                return str(model_path)

        _REMBG_SESSION = LocalU2netSession(
            REMBG_MODEL_NAME,
            ort.SessionOptions(),
            providers=["CPUExecutionProvider"],
        )
        return _REMBG_SESSION


def trim_alpha(image: Image.Image, padding: int = 4) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if not bbox:
        return rgba
    left, top, right, bottom = bbox
    return rgba.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(rgba.width, right + padding),
            min(rgba.height, bottom + padding),
        )
    )


def _remove_near_white_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = []
    for red, green, blue, alpha in rgba.get_flattened_data():
        minimum = min(red, green, blue)
        if minimum >= 248:
            new_alpha = 0
        elif minimum >= 225:
            new_alpha = int(alpha * (248 - minimum) / 23)
        else:
            new_alpha = alpha
        pixels.append((red, green, blue, new_alpha))
    rgba.putdata(pixels)
    return rgba


def cutout_bytes(image_bytes: bytes) -> Image.Image:
    """Return a locally derived RGBA product layer; provider integrations are never involved."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            source.load()
            original = source.convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("invalid product image") from exc

    alpha_minimum, alpha_maximum = original.getchannel("A").getextrema()
    if alpha_minimum < 250 and alpha_maximum > 0:
        return trim_alpha(original)

    try:
        from rembg import remove

        removed = remove(image_bytes, session=_get_rembg_session())
        with Image.open(io.BytesIO(removed)) as decoded:
            decoded.load()
            return trim_alpha(decoded.convert("RGBA"))
    except ImportError as exc:
        raise RuntimeError("Local product cutout dependency is unavailable.") from exc
    except Exception as exc:
        if isinstance(exc, RuntimeError):
            raise
        raise RuntimeError("本地商品抠图失败。") from exc


def cutout_product(image_path: str) -> Image.Image:
    path = Path(image_path)
    if not path.is_file():
        raise ValueError("product image not found")
    return cutout_bytes(path.read_bytes())


def _vertical_gradient(
    width: int,
    height: int,
    top: Tuple[int, int, int],
    bottom: Tuple[int, int, int],
) -> Image.Image:
    image = Image.new("RGB", (width, height), top)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        ratio = y / max(height - 1, 1)
        color = tuple(int(top[index] * (1 - ratio) + bottom[index] * ratio) for index in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return image.convert("RGBA")


def _soft_shape(
    image: Image.Image,
    box: Tuple[int, int, int, int],
    color: Tuple[int, int, int, int],
    blur: int,
) -> Image.Image:
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(box, fill=color)
    return Image.alpha_composite(image.convert("RGBA"), layer.filter(ImageFilter.GaussianBlur(blur)))


def create_premium_background(width: int, height: int, variant: int = 0) -> Image.Image:
    palettes = [
        ((239, 231, 220), (188, 164, 137)),
        ((228, 231, 235), (154, 166, 181)),
        ((238, 232, 224), (180, 155, 136)),
    ]
    top, bottom = palettes[variant % len(palettes)]
    base = _vertical_gradient(width, height, top, bottom)
    base = _soft_shape(
        base,
        (-int(width * 0.2), -int(height * 0.1), int(width * 0.75), int(height * 0.8)),
        (255, 250, 238, 92),
        max(18, width // 18),
    )
    base = _soft_shape(
        base,
        (int(width * 0.55), int(height * 0.20), int(width * 1.25), int(height * 0.95)),
        (60, 42, 28, 35),
        max(24, width // 15),
    )
    return base


def create_microcement_background(width: int, height: int, variant: int = 0) -> Image.Image:
    palettes = [
        ((224, 222, 216), (186, 184, 178)),
        ((225, 229, 231), (179, 188, 193)),
        ((232, 224, 215), (194, 181, 169)),
    ]
    top, bottom = palettes[variant % len(palettes)]
    base = _vertical_gradient(width, height, top, bottom)
    randomizer = random.Random(700 + variant)
    noise = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(noise)
    for _ in range(max(100, width * height // 2200)):
        x = randomizer.randrange(width)
        y = randomizer.randrange(height)
        alpha = randomizer.randrange(3, 13)
        shade = randomizer.randrange(110, 220)
        draw.point((x, y), fill=(shade, shade, shade, alpha))
    base = Image.alpha_composite(base, noise.filter(ImageFilter.GaussianBlur(0.7)))
    horizon = int(height * 0.78)
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rectangle((0, horizon, width, height), fill=(70, 64, 58, 18))
    return Image.alpha_composite(base, overlay)


def create_sky_grass_background(width: int, height: int, variant: int = 0) -> Image.Image:
    base = _vertical_gradient(width, height, (184, 222, 243), (244, 238, 207))
    grass_y = int(height * 0.68)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rectangle((0, grass_y, width, height), fill=(107, 151, 86, 255))
    randomizer = random.Random(310 + variant)
    for _ in range(max(80, width // 2)):
        x = randomizer.randrange(width)
        length = randomizer.randrange(max(8, height // 80), max(14, height // 35))
        green = randomizer.randrange(80, 145)
        draw.line((x, grass_y + 6, x + randomizer.randrange(-5, 6), grass_y - length), fill=(55, green, 54, 110))
    return Image.alpha_composite(base, layer.filter(ImageFilter.GaussianBlur(0.8)))


def create_vibrant_background(
    width: int, height: int, creative_note: str = "", variant: int = 0
) -> Image.Image:
    palettes = [
        ((246, 178, 169), (113, 185, 203), (255, 222, 120, 120)),
        ((134, 203, 218), (250, 190, 143), (255, 112, 138, 95)),
        ((226, 169, 218), (126, 180, 220), (255, 224, 145, 105)),
    ]
    first, second, accent = palettes[variant % len(palettes)]
    base = _vertical_gradient(width, height, first, second)
    base = _soft_shape(
        base,
        (-int(width * 0.25), int(height * 0.2), int(width * 0.55), int(height * 0.9)),
        accent,
        max(20, width // 16),
    )
    base = _soft_shape(
        base,
        (int(width * 0.58), int(height * 0.1), int(width * 1.18), int(height * 0.72)),
        (255, 255, 255, 48),
        max(20, width // 18),
    )
    stage = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(stage)
    center_x = width // 2
    stage_y = int(height * 0.84)
    draw.ellipse(
        (int(width * 0.15), stage_y - int(height * 0.045), int(width * 0.85), stage_y + int(height * 0.045)),
        fill=(255, 255, 255, 52),
    )
    draw.ellipse(
        (int(width * 0.24), stage_y - int(height * 0.025), int(width * 0.76), stage_y + int(height * 0.025)),
        fill=(255, 255, 255, 75),
    )
    _ = (creative_note, center_x)
    return Image.alpha_composite(base, stage.filter(ImageFilter.GaussianBlur(3)))


def create_procedural_background(
    width: int,
    height: int,
    visual_style: str,
    creative_note: str = "",
    variant: int = 0,
) -> Image.Image:
    if visual_style == "premium":
        return create_premium_background(width, height, variant)
    note = (creative_note or "").lower()
    if any(term in note for term in ("自然", "草地", "户外", "sky", "grass", "nature")):
        return create_sky_grass_background(width, height, variant)
    if any(term in note for term in ("极简", "水泥", "minimal", "cement")):
        return create_microcement_background(width, height, variant)
    return create_vibrant_background(width, height, creative_note, variant)


def load_background_image(
    image_or_bytes: Image.Image | bytes,
    width: int,
    height: int,
) -> Image.Image:
    if isinstance(image_or_bytes, Image.Image):
        image = image_or_bytes.convert("RGBA")
    else:
        try:
            with Image.open(io.BytesIO(image_or_bytes)) as decoded:
                decoded.load()
                image = decoded.convert("RGBA")
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise ValueError("invalid background image") from exc
    return ImageOps.fit(
        image,
        (width, height),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )


def finalize_with_protected_product(
    canvas: Image.Image,
    product_rgba: Image.Image,
    layout_metadata: Dict[str, Any],
) -> Image.Image:
    """Paste the locally transformed product as the authoritative final visual layer."""
    transformed = layout_metadata.get("scaled_product")
    if not isinstance(transformed, Image.Image):
        requested_size = tuple(layout_metadata.get("product_size") or product_rgba.size)
        transformed = trim_alpha(product_rgba).resize(requested_size, Image.Resampling.LANCZOS)
    transformed = transformed.convert("RGBA")
    xy = tuple(layout_metadata.get("product_xy") or (0, 0))
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(transformed, xy, transformed)
    return Image.alpha_composite(canvas.convert("RGBA"), layer)


def render_poster_variant(
    background: Image.Image,
    product_rgba: Image.Image,
    title: str,
    headline: str,
    subline: str,
    visual_style: str,
    product_type: str,
    variant: int,
) -> Tuple[Image.Image, Dict[str, Any]]:
    """Render text locally, then make the local product the final composited layer."""
    from my_agent.layout_engine import apply_layout_by_product_type
    from my_agent.text_layouts import render_text_on_image

    base = background.convert("RGBA")
    _, plan = apply_layout_by_product_type(
        base, product_rgba, product_type=product_type, variant=variant
    )
    text_rendered = render_text_on_image(
        base,
        title=title,
        headline=headline,
        subline=subline,
        visual_style=visual_style,
        layout_id=variant,
        protected_bbox=tuple(plan["product_bbox"]),
        safe_zones=plan.get("text_safe_zones"),
    )
    composed, metadata = apply_layout_by_product_type(
        text_rendered,
        product_rgba,
        product_type=product_type,
        variant=variant,
    )
    final = finalize_with_protected_product(composed, product_rgba, metadata)
    metadata.update(
        {
            "final_local_product_paste": True,
            "local_text_rendering": True,
            "product_sent_to_provider": False,
        }
    )
    return final.convert("RGBA"), metadata


def composite_product_on_background(
    background: Image.Image,
    product_rgba: Image.Image,
    product_scale: float = 0.9,
    center: bool = True,
) -> Image.Image:
    base = background.convert("RGBA")
    product = trim_alpha(product_rgba)
    maximum = (int(base.width * product_scale), int(base.height * product_scale))
    product.thumbnail(maximum, Image.Resampling.LANCZOS)
    x = (base.width - product.width) // 2
    y = (base.height - product.height) // 2 if center else base.height - product.height
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(product, (x, y), product)
    return Image.alpha_composite(base, layer)
