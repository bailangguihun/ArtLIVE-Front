from __future__ import annotations

import math
import hashlib

from my_agent.backend.domain.models import (
    CompleteProductPosterGroupResult,
    ProductPosterGroupCommand,
)
from my_agent.backend.integrations.seedream_client import SeedreamClient
from my_agent.backend.prompts.product_poster_group_prompt import (
    build_product_poster_group_prompt,
)


def provider_size_aspect_ratio(provider_size: str) -> str:
    parts = provider_size.lower().split("x")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        raise ValueError("provider size is invalid")
    width, height = (int(part) for part in parts)
    if width <= 0 or height <= 0:
        raise ValueError("provider size is invalid")
    divisor = math.gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


class ProductPosterGroupService:
    """Isolated category-free pathway; active orchestration switches in Round 2."""

    def __init__(self, seedream_client: SeedreamClient):
        self._seedream_client = seedream_client

    @property
    def configured(self) -> bool:
        return self._seedream_client.configured

    @property
    def provider_size(self) -> str:
        return self._seedream_client.provider_image_size

    @property
    def provider_aspect_ratio(self) -> str:
        return provider_size_aspect_ratio(self.provider_size)

    @staticmethod
    def _validate(command: ProductPosterGroupCommand) -> None:
        if command.generation_mode != "seedream_product_poster_group":
            raise ValueError("unsupported generation mode")
        if not command.product_image:
            raise ValueError("product image is required")
        if not command.send_product_to_provider:
            raise ValueError("product-provider consent is required")
        if command.requested_poster_count != 3:
            raise ValueError("exactly three posters are required")
        if command.text_rendering_mode != "provider":
            raise ValueError("provider text rendering is required")

    def generate(
        self,
        command: ProductPosterGroupCommand,
        *,
        local_request_id: str = "unbound",
    ) -> CompleteProductPosterGroupResult:
        self._validate(command)
        aspect_ratio = provider_size_aspect_ratio(
            self._seedream_client.provider_image_size
        )
        prompt = build_product_poster_group_prompt(
            product_info=command.product_info,
            product_short_name=command.product_short_name,
            creative_note=command.creative_note,
            visual_style=command.visual_style,
            generated_marketing_copy=command.marketing_copy.body,
            exact_poster_title=command.marketing_copy.title,
            exact_headline=command.marketing_copy.headline,
            exact_subline=command.marketing_copy.subline,
            output_aspect_ratio=aspect_ratio,
            requested_poster_count=command.requested_poster_count,
        )
        prompt_metadata = {
            "character_count": len(prompt),
            "line_count": len(prompt.splitlines()),
            "requested_poster_count": command.requested_poster_count,
            "visual_style": command.visual_style,
            "provider_aspect_ratio": aspect_ratio,
            "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        }
        return self._seedream_client.generate_product_poster_group(
            prompt=prompt,
            product_reference=command.product_image,
            requested_count=command.requested_poster_count,
            sanitized_prompt_metadata=prompt_metadata,
            local_request_id=local_request_id,
        )
