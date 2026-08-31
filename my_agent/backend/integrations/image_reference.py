from __future__ import annotations

import base64
import hashlib
import io
from dataclasses import dataclass, field

from PIL import Image, ImageOps, UnidentifiedImageError

from my_agent.backend.domain.models import ProductReferenceMetadata


@dataclass(frozen=True)
class EncodedProductReference:
    data_uri: str = field(repr=False)
    metadata: ProductReferenceMetadata

    def __repr__(self) -> str:
        return f"EncodedProductReference(metadata={self.metadata!r})"


class ProductReferenceError(ValueError):
    """Sanitized validation failure for an uploaded product reference."""


def encode_product_reference(
    image_bytes: bytes,
    *,
    max_input_bytes: int,
    max_pixels: int,
) -> EncodedProductReference:
    if not image_bytes or len(image_bytes) > max_input_bytes:
        raise ProductReferenceError("product reference size is invalid")
    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            source_format = str(source.format or "").upper()
            source.load()
            oriented = ImageOps.exif_transpose(source)
            decoded_width, decoded_height = oriented.size
            if (
                source_format not in {"PNG", "JPEG", "WEBP"}
                or decoded_width <= 0
                or decoded_height <= 0
                or decoded_width * decoded_height > max_pixels
            ):
                raise ProductReferenceError("product reference dimensions are invalid")
            normalized = oriented.convert("RGB")
    except ProductReferenceError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ProductReferenceError("product reference is not a valid image") from exc

    output = io.BytesIO()
    normalized.save(output, format="PNG")
    normalized_bytes = output.getvalue()
    encoded = base64.b64encode(normalized_bytes).decode("ascii")
    mime_types = {
        "PNG": "image/png",
        "JPEG": "image/jpeg",
        "WEBP": "image/webp",
    }
    metadata = ProductReferenceMetadata(
        original_mime_type=mime_types[source_format],
        normalized_mime_type="image/png",
        decoded_width=decoded_width,
        decoded_height=decoded_height,
        normalized_width=normalized.width,
        normalized_height=normalized.height,
        original_byte_length=len(image_bytes),
        normalized_byte_length=len(normalized_bytes),
        normalized_sha256=hashlib.sha256(normalized_bytes).hexdigest(),
        reference_image_count=1,
    )
    return EncodedProductReference(
        data_uri=f"data:image/png;base64,{encoded}",
        metadata=metadata,
    )
