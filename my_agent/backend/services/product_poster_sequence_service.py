from __future__ import annotations

import hashlib
from typing import List

from my_agent.backend.domain.models import (
    CompleteProductPosterResult,
    ProductPosterSequenceCommand,
)
from my_agent.backend.integrations.seedream_client import SeedreamClient
from my_agent.backend.prompts.product_poster_sequence_prompt import (
    SEQUENCE_CONCEPTS,
    build_product_poster_sequence_prompts,
)
from my_agent.backend.prompts.poster_style_templates import (
    resolve_poster_style_template,
)
from my_agent.backend.services.product_poster_group_service import (
    provider_size_aspect_ratio,
)


class ProductPosterSequenceService:
    """Category-free, single-image provider operation used by the serial worker."""

    def __init__(self, seedream_client: SeedreamClient):
        self._seedream_client = seedream_client

    @property
    def configured(self) -> bool:
        return self._seedream_client.configured

    @property
    def provider_size(self) -> str:
        return self._seedream_client.provider_image_size

    @property
    def model_id(self) -> str:
        return self._seedream_client.model_id

    @property
    def provider_aspect_ratio(self) -> str:
        return provider_size_aspect_ratio(self.provider_size)

    @staticmethod
    def _validate(command: ProductPosterSequenceCommand) -> None:
        if command.generation_mode != "seedream_product_poster_sequence":
            raise ValueError("unsupported generation mode")
        if not command.product_image:
            raise ValueError("product image is required")
        if not command.send_product_to_provider:
            raise ValueError("product-provider consent is required")
        if command.requested_poster_count != 3:
            raise ValueError("exactly three posters are required")
        # Text is edited locally after Seedream returns textless bases.
        if command.text_rendering_mode != "local":
            raise ValueError("local text rendering is required")

    def build_prompts(self, command: ProductPosterSequenceCommand) -> List[str]:
        self._validate(command)
        return build_product_poster_sequence_prompts(
            product_info=command.product_info,
            product_short_name=command.product_short_name,
            creative_note=command.creative_note,
            visual_style=command.visual_style,
            generated_marketing_copy=command.marketing_copy.body,
            exact_poster_title=command.marketing_copy.title,
            exact_headline=command.marketing_copy.headline,
            exact_subline=command.marketing_copy.subline,
            marketing_advice_context=command.marketing_advice_context,
            output_aspect_ratio=self.provider_aspect_ratio,
            style_template_id=command.style_template_id,
            sequence_typography_mode=command.sequence_typography_mode,
        )

    def generate_poster(
        self,
        command: ProductPosterSequenceCommand,
        *,
        poster_index: int,
        local_request_id: str,
        generation_id: str,
        provider_attempt_count: int,
    ) -> CompleteProductPosterResult:
        prompts = self.build_prompts(command)
        if poster_index not in (1, 2, 3):
            raise ValueError("poster index is invalid")
        prompt = prompts[poster_index - 1]
        template = resolve_poster_style_template(command.style_template_id)
        prompt_metadata = {
            "character_count": len(prompt),
            "line_count": len(prompt.splitlines()),
            "poster_index": poster_index,
            "concept": SEQUENCE_CONCEPTS[poster_index - 1],
            "visual_style": command.visual_style,
            "provider_aspect_ratio": self.provider_aspect_ratio,
            "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        }
        if template is not None:
            prompt_metadata.update(
                {
                    "style_template_id": template.id,
                    "style_template_version": template.version,
                }
            )
        return self._seedream_client.generate_single_product_poster(
            prompt=prompt,
            product_reference=command.product_image,
            sanitized_prompt_metadata=prompt_metadata,
            local_request_id=local_request_id,
            generation_id=generation_id,
            poster_index=poster_index,
            provider_attempt_count=provider_attempt_count,
        )
