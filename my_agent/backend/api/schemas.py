from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from my_agent.backend.prompts.poster_style_templates import PosterStyleTemplateId


class VisualStyle(str, Enum):
    premium = "premium"
    vibrant = "vibrant"


class BackgroundMode(str, Enum):
    seedream_text = "seedream_text"
    seedream_reference = "seedream_reference"
    stock = "stock"
    procedural = "procedural"


class OutputSize(str, Enum):
    poster_768x1024 = "768x1024"
    poster_512x768 = "512x768"
    complete_poster_1024x1536 = "1024x1536"


class ProductType(str, Enum):
    bag_heavy = "bag_heavy"
    bottle_upright = "bottle_upright"
    flat_small = "flat_small"


class GenerationMode(str, Enum):
    legacy_background_composite = "legacy_background_composite"
    seedream_product_poster_group = "seedream_product_poster_group"
    seedream_product_poster_sequence = "seedream_product_poster_sequence"


class TextRenderingMode(str, Enum):
    local = "local"
    provider = "provider"


class TargetPlatform(str, Enum):
    xiaohongshu = "xiaohongshu"
    douyin = "douyin"
    taobao = "taobao"
    pinduoduo = "pinduoduo"


class MarketingAdviceReference(BaseModel):
    """Opaque, server-verifiable reference to the deterministic advice result."""

    model_config = ConfigDict(extra="forbid")

    advice_version: Literal["catalog-v1"]
    input_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    advice_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class PosterCopyBasicOwnerReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    settings_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class PosterCopyAdviceOwnerReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["present"]
    authority_version: Literal["workflow-v2-advice-authority-v1"]
    advice_version: Literal["catalog-v1"]
    input_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    advice_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    owner_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class PosterCopyReference(BaseModel):
    """Exact immutable V2 CopyRef; never a pointer to mutable live Copy."""

    model_config = ConfigDict(extra="forbid")

    version: Literal["workflow-v2-copy-ref-v1"]
    copy_authority_version: Literal["workflow-v2-confirmed-copy-v1"]
    revision: int = Field(ge=1)
    basic_owner: PosterCopyBasicOwnerReference
    advice_owner: PosterCopyAdviceOwnerReference
    input_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    output_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class FrozenPosterCopy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=5000)
    title: str = Field(max_length=80)
    headline: str = Field(max_length=80)
    subline: str = Field(max_length=80)
    platform: TargetPlatform
    style: VisualStyle
    source_copy_ref: PosterCopyReference


class V2PosterCopySource(BaseModel):
    """Explicit serial-Poster copy source, additive to the legacy payload."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["confirmed_copy", "poster_owned"]
    copy_ref: Optional[PosterCopyReference] = None
    frozen_copy: Optional[FrozenPosterCopy] = None

    @model_validator(mode="after")
    def source_is_complete_and_unmixed(self) -> "V2PosterCopySource":
        if self.mode == "poster_owned":
            if self.copy_ref is not None or self.frozen_copy is not None:
                raise ValueError("poster_owned source may not include CopyRef or frozen copy")
            return self
        if self.copy_ref is None or self.frozen_copy is None:
            raise ValueError("confirmed_copy source requires CopyRef and frozen copy")
        if self.copy_ref.model_dump(mode="json") != self.frozen_copy.source_copy_ref.model_dump(mode="json"):
            raise ValueError("frozen copy must own the exact CopyRef")
        return self


class GenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_info: str = Field(min_length=1, max_length=2000)
    product_short_name: str = Field(default="", max_length=80)
    creative_note: str = Field(default="", max_length=500)
    visual_style: VisualStyle = VisualStyle.vibrant
    target_platform: TargetPlatform = TargetPlatform.xiaohongshu
    generate_poster: bool = True
    background_mode: BackgroundMode = BackgroundMode.seedream_text
    output_size: OutputSize = OutputSize.poster_768x1024
    product_type: ProductType = ProductType.bag_heavy
    generation_mode: GenerationMode = GenerationMode.legacy_background_composite
    send_product_to_provider: bool = False
    requested_poster_count: int = Field(default=3, ge=1, le=3)
    text_rendering_mode: TextRenderingMode = TextRenderingMode.local
    # Optional: reuse copy generated on the platform step (skip LLM on poster run).
    prefilled_copy_body: str = Field(default="", max_length=5000)
    prefilled_copy_title: str = Field(default="", max_length=80)
    prefilled_copy_headline: str = Field(default="", max_length=80)
    prefilled_copy_subline: str = Field(default="", max_length=80)
    copy_variant_count: int = Field(default=1, ge=1, le=3)
    marketing_advice_ref: Optional[MarketingAdviceReference] = None
    v2_poster_copy_source: Optional[V2PosterCopySource] = None
    style_template_id: Optional[PosterStyleTemplateId] = None
    sequence_typography_mode: Optional[Literal["textless", "with_text"]] = None

    # Generation-mode cross-field invariants are enforced by GenerationService.
    # Keeping them parseable here lets an already-used idempotency key reject a
    # changed consent/count/text-mode request as a conflict before any provider call.


class MarketingAdviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_info: str = Field(min_length=1, max_length=2000)
    product_short_name: str = Field(default="", max_length=80)
    creative_note: str = Field(default="", max_length=500)

    @field_validator("product_info")
    @classmethod
    def product_info_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("product_info must contain non-whitespace characters")
        return value


class MarketingAdviceStrategy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Literal["fmcg", "durable", "service", "digital", "luxury", "b2b", "health"]
    name: str
    examples: str
    traits: List[str]
    tactics: List[str]
    one_liner: str


class MarketingAdvice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: Literal[
        "fmcg", "durable", "service", "digital", "luxury", "b2b", "health"
    ]
    category_name: str
    confidence: Literal["low", "medium", "high"]
    matched_keywords: List[str]
    reason: str
    score: int = Field(ge=0)
    strategy: MarketingAdviceStrategy
    source: Literal["desktop_ai_different_product_marketing_strategies"]


class MarketingAdviceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_version: Literal["v1"]
    advice_version: Literal["catalog-v1"]
    status: Literal["present"]
    input_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    advice_signature_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    advice: MarketingAdvice


class HealthResponse(BaseModel):
    status: str
    api_version: str


class CapabilityOption(BaseModel):
    id: str
    label: str


class GenerationModeCapability(BaseModel):
    mode: GenerationMode
    implemented: bool
    enabled: bool
    provider_verified: bool
    requested_poster_count: int
    provider_request_count: int = 0
    maximum_provider_request_count: int = 0
    execution: Optional[str] = None
    deprecated: bool = False
    product_reference_required: bool
    product_sent_to_provider: bool
    local_product_compositing: bool
    local_text_rendering: bool
    provider_size: str
    aspect_ratio: str


class CapabilitiesResponse(BaseModel):
    api_version: str
    visual_styles: List[CapabilityOption]
    platforms: List[CapabilityOption] = Field(default_factory=list)
    background_modes: List[CapabilityOption]
    output_sizes: List[CapabilityOption]
    product_types: List[CapabilityOption]
    seedream_configured: bool
    stock_fallback_configured: bool
    generation_modes: List[GenerationModeCapability]


class MarketingCopyResponse(BaseModel):
    body: str
    title: str
    headline: str
    subline: str


class PosterResponse(BaseModel):
    poster_id: Optional[str] = None
    variant_index: int = 0
    index: Optional[int] = None
    concept: Optional[str] = None
    status: str = "ready"
    provider_attempt_count: int = 0
    width: Optional[int] = None
    height: Optional[int] = None
    background_source: str = ""
    fallback_used: bool = False
    preview_url: Optional[str] = None
    download_url: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    safe_error_code: Optional[str] = None
    poster_source: str = ""
    product_sent_to_provider: bool = False
    local_product_compositing: bool = True
    local_text_rendering: bool = True


class GenerationResponse(BaseModel):
    api_version: str
    request_id: str
    generation_id: str
    status: str
    marketing_copy: MarketingCopyResponse
    marketing_copy_variants: List[MarketingCopyResponse] = Field(default_factory=list)
    posters: List[PosterResponse]
    zip_download_url: Optional[str]
    warnings: List[str]
    target_platform: str = TargetPlatform.xiaohongshu.value
    generation_mode: str = GenerationMode.legacy_background_composite.value
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
    qa: Dict[str, Any] = Field(default_factory=dict)
    marketing_strategy: Dict[str, Any] = Field(default_factory=dict)


class ErrorDetail(BaseModel):
    code: str
    message: str
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
