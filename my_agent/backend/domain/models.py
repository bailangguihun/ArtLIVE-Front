from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image


@dataclass(frozen=True)
class MarketingCopy:
    body: str
    title: str
    headline: str
    subline: str = ""

    def to_dict(self) -> Dict[str, str]:
        return {
            "body": self.body,
            "title": self.title,
            "headline": self.headline,
            "subline": self.subline,
        }


@dataclass
class GeneratedImage:
    image: Image.Image
    source: str
    provider: str
    model_id: str


@dataclass(frozen=True)
class ProductReferenceMetadata:
    original_mime_type: str
    normalized_mime_type: str
    decoded_width: int
    decoded_height: int
    normalized_width: int
    normalized_height: int
    original_byte_length: int
    normalized_byte_length: int
    normalized_sha256: str
    reference_image_count: int = 1


@dataclass(frozen=True)
class ProductPosterGroupCommand:
    product_info: str
    product_short_name: str
    creative_note: str
    visual_style: str
    marketing_copy: MarketingCopy
    product_image: bytes
    send_product_to_provider: bool
    requested_poster_count: int = 3
    text_rendering_mode: str = "provider"
    generation_mode: str = "seedream_product_poster_group"


@dataclass
class CompleteProductPosterGroupResult:
    images: List[GeneratedImage]
    model: str
    provider_size: str
    provider_aspect_ratio: str
    returned_dimensions: List[Tuple[int, int]]
    dimensions_match_requested: bool
    reference_metadata: ProductReferenceMetadata
    sanitized_prompt_metadata: Dict[str, Any]
    provider_generation_request_count: int = 1
    provider_result_download_count: int = 0
    generation_type: str = "complete_product_poster_group"
    provider: str = "seedream"
    requested_image_count: int = 3
    actual_image_count: int = 3
    product_sent_to_provider: bool = True
    reference_image_count: int = 1
    local_product_compositing: bool = False
    local_text_rendering: bool = False
    group_generation_requested: bool = True
    group_generation_mode: str = "auto"
    fallback_used: bool = False
    output_format: str = "png"


@dataclass(frozen=True)
class ProductPosterSequenceCommand:
    product_info: str
    product_short_name: str
    creative_note: str
    visual_style: str
    marketing_copy: MarketingCopy
    product_image: bytes
    send_product_to_provider: bool
    requested_poster_count: int = 3
    text_rendering_mode: str = "local"
    generation_mode: str = "seedream_product_poster_sequence"
    marketing_advice_context: str = ""
    style_template_id: Optional[str] = None
    sequence_typography_mode: Optional[str] = None


@dataclass
class CompleteProductPosterResult:
    image: GeneratedImage
    model: str
    provider_size: str
    provider_aspect_ratio: str
    returned_dimensions: Tuple[int, int]
    reference_metadata: ProductReferenceMetadata
    sanitized_prompt_metadata: Dict[str, Any]
    provider_generation_request_count: int = 1
    provider_result_download_count: int = 0
    generation_type: str = "complete_product_poster"
    provider: str = "seedream"
    requested_image_count: int = 1
    actual_image_count: int = 1
    product_sent_to_provider: bool = True
    reference_image_count: int = 1
    local_product_compositing: bool = False
    local_text_rendering: bool = False
    fallback_used: bool = False


@dataclass(frozen=True)
class GenerationCommand:
    product_info: str
    product_short_name: str
    creative_note: str
    visual_style: str
    generate_poster: bool
    background_mode: str
    output_size: str
    product_type: str
    product_image: Optional[bytes] = None
    background_reference: Optional[bytes] = None
    generation_mode: str = "legacy_background_composite"
    send_product_to_provider: bool = False
    requested_poster_count: int = 3
    text_rendering_mode: str = "local"
    target_platform: str = "xiaohongshu"
    prefilled_copy_body: str = ""
    prefilled_copy_title: str = ""
    prefilled_copy_headline: str = ""
    prefilled_copy_subline: str = ""
    copy_variant_count: int = 1
    marketing_advice: Optional[Dict[str, Any]] = None
    poster_copy_source: Optional[Dict[str, Any]] = None
    style_template_id: Optional[str] = None
    sequence_typography_mode: Optional[str] = None


@dataclass
class PosterArtifact:
    poster_id: str
    variant_index: int
    width: int
    height: int
    background_source: str
    fallback_used: bool
    preview_url: str
    download_url: str
    poster_source: str = ""
    product_sent_to_provider: bool = False
    local_product_compositing: bool = True
    local_text_rendering: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "poster_id": self.poster_id,
            "variant_index": self.variant_index,
            "width": self.width,
            "height": self.height,
            "background_source": self.background_source,
            "fallback_used": self.fallback_used,
            "preview_url": self.preview_url,
            "download_url": self.download_url,
            "poster_source": self.poster_source or self.background_source,
            "product_sent_to_provider": self.product_sent_to_provider,
            "local_product_compositing": self.local_product_compositing,
            "local_text_rendering": self.local_text_rendering,
        }


@dataclass
class PosterSlotArtifact:
    index: int
    concept: str
    status: str
    provider_attempt_count: int = 0
    poster_id: Optional[str] = None
    variant_index: int = 0
    width: Optional[int] = None
    height: Optional[int] = None
    preview_url: Optional[str] = None
    download_url: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    safe_error_code: Optional[str] = None
    background_source: str = "seedream_complete_poster"
    poster_source: str = "seedream_complete_poster"
    fallback_used: bool = False
    product_sent_to_provider: bool = True
    local_product_compositing: bool = False
    local_text_rendering: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "index": self.index,
            "concept": self.concept,
            "status": self.status,
            "provider_attempt_count": self.provider_attempt_count,
            "poster_id": self.poster_id,
            "variant_index": self.variant_index,
            "width": self.width,
            "height": self.height,
            "preview_url": self.preview_url,
            "download_url": self.download_url,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "safe_error_code": self.safe_error_code,
            "background_source": self.background_source,
            "poster_source": self.poster_source,
            "fallback_used": self.fallback_used,
            "product_sent_to_provider": self.product_sent_to_provider,
            "local_product_compositing": self.local_product_compositing,
            "local_text_rendering": self.local_text_rendering,
        }


@dataclass
class GenerationResult:
    api_version: str
    request_id: str
    generation_id: str
    status: str
    marketing_copy: MarketingCopy
    posters: List[PosterArtifact | PosterSlotArtifact] = field(default_factory=list)
    zip_download_url: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    qa: Dict[str, Any] = field(default_factory=dict)
    generation_mode: str = "legacy_background_composite"
    generation_type: str = "local_composite"
    provider: Optional[str] = None
    model: Optional[str] = None
    requested_poster_count: int = 0
    actual_poster_count: int = 0
    provider_generation_request_count: int = 0
    provider_result_download_count: int = 0
    product_sent_to_provider: bool = False
    local_product_compositing: bool = True
    local_text_rendering: bool = True
    group_generation_requested: bool = False
    group_generation_mode: Optional[str] = None
    provider_size: Optional[str] = None
    aspect_ratio: Optional[str] = None
    fallback_used: bool = False
    provider_verified: bool = False
    completed_poster_count: int = 0
    current_poster_index: Optional[int] = None
    maximum_provider_request_count: int = 0
    actual_provider_request_count: int = 0
    automatic_retry_count: int = 0
    execution: Optional[str] = None
    poll_url: Optional[str] = None
    marketing_strategy: Dict[str, Any] = field(default_factory=dict)
    target_platform: str = "xiaohongshu"
    marketing_copy_variants: List[MarketingCopy] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "api_version": self.api_version,
            "request_id": self.request_id,
            "generation_id": self.generation_id,
            "status": self.status,
            "marketing_copy": self.marketing_copy.to_dict(),
            "marketing_copy_variants": [
                item.to_dict() for item in self.marketing_copy_variants
            ],
            "posters": [poster.to_dict() for poster in self.posters],
            "zip_download_url": self.zip_download_url,
            "warnings": list(self.warnings),
            "target_platform": self.target_platform,
            "generation_mode": self.generation_mode,
            "generation_type": self.generation_type,
            "provider": self.provider,
            "model": self.model,
            "requested_poster_count": self.requested_poster_count,
            "actual_poster_count": self.actual_poster_count,
            "provider_generation_request_count": self.provider_generation_request_count,
            "provider_result_download_count": self.provider_result_download_count,
            "product_sent_to_provider": self.product_sent_to_provider,
            "local_product_compositing": self.local_product_compositing,
            "local_text_rendering": self.local_text_rendering,
            "group_generation_requested": self.group_generation_requested,
            "group_generation_mode": self.group_generation_mode,
            "provider_size": self.provider_size,
            "aspect_ratio": self.aspect_ratio,
            "fallback_used": self.fallback_used,
            "provider_verified": self.provider_verified,
            "completed_poster_count": self.completed_poster_count,
            "current_poster_index": self.current_poster_index,
            "maximum_provider_request_count": self.maximum_provider_request_count,
            "actual_provider_request_count": self.actual_provider_request_count,
            "automatic_retry_count": self.automatic_retry_count,
            "execution": self.execution,
            "poll_url": self.poll_url,
            "qa": dict(self.qa),
            "marketing_strategy": dict(self.marketing_strategy or {}),
        }
