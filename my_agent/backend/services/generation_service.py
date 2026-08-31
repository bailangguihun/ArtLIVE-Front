from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from my_agent.backend import API_VERSION
from my_agent.backend.core.logging_config import provider_audit_event
from my_agent.backend.domain.models import (
    GenerationCommand,
    GenerationResult,
    MarketingCopy,
    PosterArtifact,
    PosterSlotArtifact,
    ProductPosterGroupCommand,
    ProductPosterSequenceCommand,
)
from my_agent.backend.integrations.copy_client import (
    CopyProviderError,
    DeepSeekCopyClient,
    LocalCopyFallback,
)
from my_agent.backend.services.image_generation_service import ImageGenerationService
from my_agent.backend.services.product_poster_group_service import (
    ProductPosterGroupService,
)
from my_agent.backend.services.product_poster_sequence_service import (
    ProductPosterSequenceService,
)
from my_agent.backend.prompts.poster_style_templates import (
    resolve_poster_style_template,
)
from my_agent.backend.prompts.product_poster_sequence_prompt import SEQUENCE_CONCEPTS
from my_agent.backend.integrations.seedream_client import ImageProviderError
from my_agent.backend.storage.artifact_store import (
    ArtifactStore,
    ArtifactValidationError,
)


OUTPUT_SIZES: Dict[str, Tuple[int, int]] = {
    "768x1024": (768, 1024),
    "512x768": (512, 768),
}

VISUAL_STYLE_LABELS = {
    "premium": "高级质感",
    "vibrant": "爆款吸睛",
}

BACKGROUND_MODE_LABELS = {
    "seedream_text": "AI 创意背景（Seedream）",
    "seedream_reference": "参考图创作（Seedream）",
    "stock": "素材库背景",
    "procedural": "程序背景",
}

PRODUCT_TYPE_LABELS = {
    "bag_heavy": "袋装/重物",
    "bottle_upright": "瓶装/立式",
    "flat_small": "扁平/小物",
}

_AUDIT_LOGGER = logging.getLogger("advertising_backend.provider_audit")


def _bounded_advice_text(value: Any, maximum: int = 240) -> str:
    return str(value or "").strip().replace("\x00", "")[:maximum]


def _marketing_advice_prompt_context(
    advice: Optional[Dict[str, Any]],
) -> str:
    """Render only server-validated catalogue content in a bounded order."""
    if not advice:
        return ""
    strategy = advice.get("strategy")
    strategy = strategy if isinstance(strategy, dict) else {}
    keywords = advice.get("matched_keywords")
    traits = strategy.get("traits")
    tactics = strategy.get("tactics")
    keyword_text = "、".join(_bounded_advice_text(item, 60) for item in list(keywords or [])[:8])
    trait_text = "、".join(_bounded_advice_text(item, 80) for item in list(traits or [])[:8])
    tactic_text = "、".join(_bounded_advice_text(item, 100) for item in list(tactics or [])[:8])
    return "\n".join(
        (
            "已验证营销建议（必须作为文案方向，勿输出该段原文）：",
            f"商品类别：{_bounded_advice_text(advice.get('category_name'))}",
            f"匹配置信度：{_bounded_advice_text(advice.get('confidence'), 20)}",
            f"识别依据：{_bounded_advice_text(advice.get('reason'))}",
            f"匹配关键词：{keyword_text}",
            f"推荐策略：{_bounded_advice_text(strategy.get('name'))}",
            f"策略特点：{trait_text}",
            f"执行建议：{tactic_text}",
            f"参考方向：{_bounded_advice_text(strategy.get('examples'))}",
            f"策略一句话：{_bounded_advice_text(strategy.get('one_liner'))}",
        )
    )


def _marketing_strategy_for_command(
    command: GenerationCommand,
    settings: Any,
) -> Dict[str, Any]:
    """Use server-validated advice when present; otherwise classify locally."""
    advice = getattr(command, "marketing_advice", None)
    if advice:
        return dict(advice)
    from my_agent.backend.integrations.marketing_advice_classifier import (
        classify_product_category_smart,
    )

    return classify_product_category_smart(
        settings=settings,
        product_info=command.product_info,
        product_short_name=command.product_short_name,
        creative_note=command.creative_note,
    )


class IdempotencyConflictError(RuntimeError):
    pass


class GenerationServiceError(ValueError):
    def __init__(self, code: str, safe_message: str, status_code: int = 422):
        super().__init__(safe_message)
        self.code = code
        self.safe_message = safe_message
        self.status_code = status_code

    def __repr__(self) -> str:
        return f"GenerationServiceError(code={self.code!r}, status_code={self.status_code})"


@dataclass
class _IdempotencyEntry:
    fingerprint: str
    completed: threading.Event = field(default_factory=threading.Event)
    result: Optional[GenerationResult] = None
    error: Optional[BaseException] = None


class IdempotencyRegistry:
    """Single-process registry; intentionally does not claim cross-process durability."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: Dict[str, _IdempotencyEntry] = {}

    def execute(
        self,
        key: str,
        fingerprint: str,
        callback,
        *,
        local_request_id: str = "unbound",
        generation_mode: str = "unknown",
    ) -> GenerationResult:
        result, _ = self.execute_with_role(
            key,
            fingerprint,
            callback,
            local_request_id=local_request_id,
            generation_mode=generation_mode,
        )
        return result

    def execute_with_role(
        self,
        key: str,
        fingerprint: str,
        callback,
        *,
        local_request_id: str = "unbound",
        generation_mode: str = "unknown",
    ) -> Tuple[GenerationResult, bool]:
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry.fingerprint != fingerprint:
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "idempotency_conflict",
                    local_request_id,
                    generation_mode=generation_mode,
                    idempotency_role="conflict",
                    outcome="rejected",
                )
                raise IdempotencyConflictError("idempotency key already used")
            if entry is None:
                entry = _IdempotencyEntry(fingerprint=fingerprint)
                self._entries[key] = entry
                owner = True
            else:
                owner = False

        provider_audit_event(
            _AUDIT_LOGGER,
            "idempotency_owner" if owner else "idempotency_replay",
            local_request_id,
            generation_mode=generation_mode,
            idempotency_role="owner" if owner else "replay",
            outcome="accepted",
        )

        if owner:
            try:
                entry.result = callback()
            except BaseException as exc:
                entry.error = exc
            finally:
                entry.completed.set()
        else:
            entry.completed.wait()

        if entry.error is not None:
            raise entry.error
        if entry.result is None:
            raise RuntimeError("generation did not produce a result")
        return entry.result, owner


class GenerationService:
    def __init__(
        self,
        copy_client: DeepSeekCopyClient,
        image_service: ImageGenerationService,
        artifact_store: ArtifactStore,
        idempotency: Optional[IdempotencyRegistry] = None,
        product_poster_group_service: Optional[ProductPosterGroupService] = None,
        enable_product_poster_group: bool = False,
        product_poster_group_provider_verified: bool = False,
        product_poster_sequence_service: Optional[ProductPosterSequenceService] = None,
        enable_product_poster_sequence: bool = False,
        product_poster_sequence_provider_verified: bool = False,
        settings: Optional[Settings] = None,
    ):
        from my_agent.backend.core.config import Settings as ActiveSettings

        self.copy_client = copy_client
        self.image_service = image_service
        self.artifact_store = artifact_store
        self._settings = settings or getattr(copy_client, "settings", None) or ActiveSettings.from_env()
        self.idempotency = idempotency or IdempotencyRegistry()
        self.product_poster_group_service = product_poster_group_service
        self.enable_product_poster_group = bool(enable_product_poster_group)
        self.product_poster_group_provider_verified = bool(
            product_poster_group_provider_verified
        )
        self.product_poster_sequence_service = product_poster_sequence_service
        self.enable_product_poster_sequence = bool(enable_product_poster_sequence)
        self.product_poster_sequence_provider_verified = bool(
            product_poster_sequence_provider_verified
        )
        self._sequence_jobs_lock = threading.Lock()
        self._active_sequence_jobs: set[str] = set()

    @property
    def seedream_configured(self) -> bool:
        return self.image_service.seedream_configured

    @property
    def stock_configured(self) -> bool:
        return self.image_service.stock_configured

    @property
    def product_poster_group_implemented(self) -> bool:
        return True

    @property
    def product_poster_group_enabled(self) -> bool:
        return bool(
            self.enable_product_poster_group
            and self.product_poster_group_service is not None
        )

    @property
    def product_poster_group_provider_size(self) -> str:
        if self.product_poster_group_service is None:
            return "1024x1536"
        return self.product_poster_group_service.provider_size

    @property
    def product_poster_group_aspect_ratio(self) -> str:
        if self.product_poster_group_service is None:
            return "2:3"
        return self.product_poster_group_service.provider_aspect_ratio

    @property
    def product_poster_sequence_implemented(self) -> bool:
        return True

    @property
    def product_poster_sequence_enabled(self) -> bool:
        return bool(
            self.enable_product_poster_sequence
            and self.product_poster_sequence_service is not None
        )

    @property
    def product_poster_sequence_provider_size(self) -> str:
        if self.product_poster_sequence_service is None:
            return "1024x1536"
        return self.product_poster_sequence_service.provider_size

    @property
    def product_poster_sequence_aspect_ratio(self) -> str:
        if self.product_poster_sequence_service is None:
            return "2:3"
        return self.product_poster_sequence_service.provider_aspect_ratio

    def _create_marketing_copies(
        self, command: GenerationCommand
    ) -> Tuple[List[MarketingCopy], List[str]]:
        prefilled_body = str(
            getattr(command, "prefilled_copy_body", "") or ""
        ).strip()
        if prefilled_body:
            title = str(getattr(command, "prefilled_copy_title", "") or "").strip()
            headline = str(
                getattr(command, "prefilled_copy_headline", "") or ""
            ).strip()
            subline = str(getattr(command, "prefilled_copy_subline", "") or "").strip()
            if not title:
                title = (command.product_short_name or command.product_info or "新品")[
                    :12
                ]
            return (
                [
                    MarketingCopy(
                        body=prefilled_body,
                        title=title[:18],
                        headline=(headline or "焕新日常体验")[:22],
                        subline=subline[:28],
                    )
                ],
                [],
            )

        platform = getattr(command, "target_platform", None) or "xiaohongshu"
        count = max(1, min(3, int(getattr(command, "copy_variant_count", 1) or 1)))
        advice_context = _marketing_advice_prompt_context(
            getattr(command, "marketing_advice", None)
        )
        try:
            if count == 1:
                # Preserve the established one-copy client contract exactly
                # when Advice is omitted. The optional context is supplied
                # only to the narrow Advice-aware copy path.
                single_arguments = {}
                if advice_context:
                    single_arguments["marketing_advice_context"] = advice_context
                return [self.copy_client.generate_marketing_copy(
                    command.product_info,
                    command.product_short_name,
                    command.visual_style,
                    command.creative_note,
                    **single_arguments,
                )], []
            arguments = {
                "target_platform": platform,
                "count": count,
            }
            # No optional argument is sent on legacy requests: existing client
            # call shape and prompt construction remain byte-for-byte intact.
            if advice_context:
                arguments["marketing_advice_context"] = advice_context
            values = self.copy_client.generate_marketing_copy_variants(
                command.product_info,
                command.product_short_name,
                command.visual_style,
                command.creative_note,
                **arguments,
            )
            return values, []
        except CopyProviderError:
            fallback = LocalCopyFallback.generate_marketing_copy_variants(
                command.product_info,
                command.product_short_name,
                command.visual_style,
                command.creative_note,
                target_platform=platform,
                count=count,
            )
            return fallback, ["营销文案服务不可用，已使用本地基础文案。"]

    def _create_marketing_copy(
        self, command: GenerationCommand
    ) -> Tuple[MarketingCopy, List[str]]:
        copies, warnings = self._create_marketing_copies(command)
        return copies[0], warnings

    def _validate_command(self, command: GenerationCommand) -> None:
        """Enforce business invariants independently of FastAPI/Pydantic."""
        if not command.product_info.strip() or len(command.product_info) > 2000:
            raise GenerationServiceError(
                "invalid_product_info", "请输入有效的产品信息。"
            )
        if len(command.product_short_name) > 80 or len(command.creative_note) > 500:
            raise GenerationServiceError(
                "invalid_generation_text", "输入文字超过允许长度。"
            )
        if command.visual_style not in VISUAL_STYLE_LABELS:
            raise GenerationServiceError(
                "unsupported_visual_style", "不支持所选视觉风格。"
            )

        if command.generation_mode == "seedream_product_poster_sequence":
            if not self.product_poster_sequence_enabled:
                raise GenerationServiceError(
                    "feature_disabled",
                    "Seedream 三张完整海报顺序生成功能当前未启用。",
                    status_code=503,
                )
            if not command.generate_poster:
                raise GenerationServiceError(
                    "invalid_generation_mode", "顺序生成模式必须生成海报。"
                )
            if not command.product_image:
                raise GenerationServiceError(
                    "missing_product_image", "请上传商品参考图。"
                )
            if not command.send_product_to_provider:
                raise GenerationServiceError(
                    "missing_provider_consent", "请先确认商品参考图发送授权。"
                )
            if command.requested_poster_count != 3:
                raise GenerationServiceError(
                    "invalid_poster_count", "顺序生成模式固定生成三张海报。"
                )
            if command.text_rendering_mode != "local":
                raise GenerationServiceError(
                    "invalid_text_rendering_mode",
                    "顺序生成模式现为无字底图，文字须本地编辑渲染。",
                )
            if command.output_size != self.product_poster_sequence_provider_size:
                raise GenerationServiceError(
                    "invalid_output_size", "顺序生成模式固定使用 1024×1536（2:3）。"
                )
            if (
                self.product_poster_sequence_service is None
                or not self.product_poster_sequence_service.configured
            ):
                raise GenerationServiceError(
                    "seedream_not_configured",
                    "Seedream 当前未配置，无法开始顺序生成。",
                    status_code=503,
                )
            return

        if command.generation_mode == "seedream_product_poster_group":
            if not self.product_poster_group_enabled:
                raise GenerationServiceError(
                    "feature_disabled",
                    "Seedream 完整海报组图功能当前未启用。",
                    status_code=503,
                )
            if not command.generate_poster:
                raise GenerationServiceError(
                    "invalid_generation_mode", "完整海报组图模式必须生成海报。"
                )
            if not command.product_image:
                raise GenerationServiceError(
                    "missing_product_image", "请上传商品参考图。"
                )
            if not command.send_product_to_provider:
                raise GenerationServiceError(
                    "missing_provider_consent", "请先确认商品参考图发送授权。"
                )
            if command.requested_poster_count != 3:
                raise GenerationServiceError(
                    "invalid_poster_count", "完整海报组图固定生成三张海报。"
                )
            if command.text_rendering_mode != "provider":
                raise GenerationServiceError(
                    "invalid_text_rendering_mode", "完整海报组图必须由模型渲染文字。"
                )
            if command.output_size != self.product_poster_group_provider_size:
                raise GenerationServiceError(
                    "invalid_output_size", "完整海报组图固定使用 1024×1536（2:3）。"
                )
            if (
                self.product_poster_group_service is None
                or not self.product_poster_group_service.configured
            ):
                raise GenerationServiceError(
                    "seedream_not_configured",
                    "Seedream 当前未配置，无法生成完整海报组图。",
                    status_code=503,
                )
            return

        if command.generation_mode != "legacy_background_composite":
            raise GenerationServiceError(
                "unsupported_generation_mode", "不支持所选生成模式。"
            )
        if command.background_mode not in BACKGROUND_MODE_LABELS:
            raise GenerationServiceError(
                "unsupported_background_mode", "不支持所选背景模式。"
            )
        if command.output_size not in OUTPUT_SIZES:
            raise GenerationServiceError(
                "unsupported_output_size", "不支持所选输出尺寸。"
            )
        if command.product_type not in PRODUCT_TYPE_LABELS:
            raise GenerationServiceError(
                "unsupported_product_type", "不支持所选商品物理形态。"
            )
        if command.generate_poster and not command.product_image:
            raise GenerationServiceError(
                "missing_product_image", "生成海报时必须上传商品图片。"
            )
        if (
            command.generate_poster
            and command.background_mode == "seedream_reference"
            and not command.background_reference
        ):
            raise GenerationServiceError(
                "missing_background_reference", "参考图模式必须上传背景参考图。"
            )

    @staticmethod
    def _category_key(product_info: str) -> str:
        from my_agent.design_guidelines import list_category_keys

        keys = list_category_keys()
        text = product_info.lower()
        keyword_groups = [
            (("宠物", "猫", "狗", "pet"), "宠物"),
            (("酒", "葡萄酒", "whisky", "wine"), "酒"),
            (("耳机", "音箱", "audio"), "音"),
            (("护肤", "精华", "面霜", "cosmetic"), "护肤"),
            (("饮料", "水", "茶", "beverage"), "饮"),
        ]
        for terms, key_fragment in keyword_groups:
            if any(term in text for term in terms):
                for key in keys:
                    if key_fragment in key:
                        return key
        for preferred in ("快消品_日用品", "快消品_日化"):
            if preferred in keys:
                return preferred
        return keys[0] if keys else ""

    @staticmethod
    def _background_prompt(command: GenerationCommand, size: Tuple[int, int]) -> str:
        from my_agent.design_guidelines import build_background_scene_prompt

        ratio = "3:4" if size == (768, 1024) else "2:3"
        return build_background_scene_prompt(
            GenerationService._category_key(command.product_info),
            dominant_color="",
            user_prompt=command.creative_note,
            output_ratio=ratio,
            product_type=command.product_type,
        )

    @staticmethod
    def _public_result(manifest: Dict[str, Any]) -> GenerationResult:
        generation_id = str(manifest["generation_id"])
        generation_mode = str(
            manifest.get("generation_mode") or "legacy_background_composite"
        )
        if generation_mode == "seedream_product_poster_sequence":
            slots: List[PosterSlotArtifact] = []
            for item in list(manifest.get("poster_slots") or []):
                poster_id = str(item.get("poster_id") or "") or None
                ready = item.get("status") == "ready" and poster_id is not None
                index = int(item["index"])
                slots.append(
                    PosterSlotArtifact(
                        index=index,
                        concept=str(item["concept"]),
                        status=str(item["status"]),
                        provider_attempt_count=int(
                            item.get("provider_attempt_count", 0)
                        ),
                        poster_id=poster_id,
                        variant_index=index - 1,
                        width=(int(item["width"]) if item.get("width") else None),
                        height=(int(item["height"]) if item.get("height") else None),
                        preview_url=(
                            f"/api/v1/generations/{generation_id}/posters/{poster_id}"
                            if ready
                            else None
                        ),
                        download_url=(
                            f"/api/v1/generations/{generation_id}/posters/"
                            f"{poster_id}/download"
                            if ready
                            else None
                        ),
                        started_at=(
                            str(item["started_at"])
                            if item.get("started_at")
                            else None
                        ),
                        completed_at=(
                            str(item["completed_at"])
                            if item.get("completed_at")
                            else None
                        ),
                        safe_error_code=(
                            str(item["safe_error_code"])
                            if item.get("safe_error_code")
                            else None
                        ),
                    )
                )
            copy = dict(manifest.get("marketing_copy") or {})
            completed = int(manifest.get("completed_poster_count", 0))
            return GenerationResult(
                api_version=API_VERSION,
                request_id=str(manifest["request_id"]),
                generation_id=generation_id,
                status=str(manifest["status"]),
                marketing_copy=MarketingCopy(
                    body=str(copy.get("body") or ""),
                    title=str(copy.get("title") or ""),
                    headline=str(copy.get("headline") or ""),
                    subline=str(copy.get("subline") or ""),
                ),
                posters=slots,
                zip_download_url=(
                    f"/api/v1/generations/{generation_id}/download"
                    if manifest.get("zip_file_name")
                    else None
                ),
                warnings=[str(item) for item in manifest.get("warnings") or []],
                qa=dict(manifest.get("qa") or {}),
                marketing_strategy=dict(manifest.get("marketing_strategy") or {}),
                generation_mode=generation_mode,
                generation_type="complete_product_poster_sequence",
                provider="seedream",
                model=(str(manifest["model"]) if manifest.get("model") else None),
                requested_poster_count=3,
                actual_poster_count=completed,
                provider_generation_request_count=int(
                    manifest.get("actual_provider_request_count", 0)
                ),
                provider_result_download_count=int(
                    manifest.get("provider_result_download_count", 0)
                ),
                product_sent_to_provider=True,
                local_product_compositing=False,
                local_text_rendering=False,
                group_generation_requested=False,
                group_generation_mode=None,
                provider_size=str(manifest.get("provider_size") or "1024x1536"),
                aspect_ratio=str(manifest.get("aspect_ratio") or "2:3"),
                fallback_used=False,
                provider_verified=bool(manifest.get("provider_verified", False)),
                completed_poster_count=completed,
                current_poster_index=(
                    int(manifest["current_poster_index"])
                    if manifest.get("current_poster_index") is not None
                    else None
                ),
                maximum_provider_request_count=3,
                actual_provider_request_count=int(
                    manifest.get("actual_provider_request_count", 0)
                ),
                automatic_retry_count=0,
                execution="strictly_serial",
                poll_url=f"/api/v1/generations/{generation_id}",
                target_platform=str(
                    manifest.get("target_platform") or "xiaohongshu"
                ),
            )
        poster_data = list(manifest.get("posters") or [])
        posters = [
            PosterArtifact(
                poster_id=str(item["poster_id"]),
                variant_index=int(item["variant_index"]),
                width=int(item["width"]),
                height=int(item["height"]),
                background_source=str(item["background_source"]),
                fallback_used=bool(item["fallback_used"]),
                preview_url=(
                    f"/api/v1/generations/{generation_id}/posters/{item['poster_id']}"
                ),
                download_url=(
                    f"/api/v1/generations/{generation_id}/posters/"
                    f"{item['poster_id']}/download"
                ),
                poster_source=str(
                    item.get("poster_source") or item.get("background_source") or ""
                ),
                product_sent_to_provider=bool(
                    item.get("product_sent_to_provider", False)
                ),
                local_product_compositing=bool(
                    item.get(
                        "local_product_compositing",
                        item.get("final_local_product_paste", True),
                    )
                ),
                local_text_rendering=bool(
                    item.get("local_text_rendering", True)
                ),
            )
            for item in poster_data
        ]
        copy = manifest["marketing_copy"]
        variant_items = list(manifest.get("marketing_copy_variants") or [])
        variants = [
            MarketingCopy(
                body=str(item.get("body") or ""),
                title=str(item.get("title") or ""),
                headline=str(item.get("headline") or ""),
                subline=str(item.get("subline") or ""),
            )
            for item in variant_items
            if isinstance(item, dict) and str(item.get("body") or "").strip()
        ]
        return GenerationResult(
            api_version=API_VERSION,
            request_id=str(manifest["request_id"]),
            generation_id=generation_id,
            status=str(manifest["status"]),
            marketing_copy=MarketingCopy(
                body=str(copy["body"]),
                title=str(copy["title"]),
                headline=str(copy["headline"]),
                subline=str(copy.get("subline") or ""),
            ),
            marketing_copy_variants=variants,
            posters=posters,
            zip_download_url=(
                f"/api/v1/generations/{generation_id}/download"
                if manifest.get("zip_file_name")
                else None
            ),
            warnings=[str(item) for item in manifest.get("warnings") or []],
            qa=dict(manifest.get("qa") or {}),
            marketing_strategy=dict(manifest.get("marketing_strategy") or {}),
            generation_mode=generation_mode,
            generation_type=str(
                manifest.get("generation_type")
                or ("local_composite" if posters else "copy_only")
            ),
            provider=(
                str(manifest["provider"]) if manifest.get("provider") else None
            ),
            model=str(manifest["model"]) if manifest.get("model") else None,
            requested_poster_count=int(
                manifest.get("requested_poster_count", len(posters))
            ),
            actual_poster_count=int(
                manifest.get("actual_poster_count", len(posters))
            ),
            provider_generation_request_count=int(
                manifest.get("provider_generation_request_count", 0)
            ),
            provider_result_download_count=int(
                manifest.get("provider_result_download_count", 0)
            ),
            product_sent_to_provider=bool(
                manifest.get("product_sent_to_provider", False)
            ),
            local_product_compositing=bool(
                manifest.get("local_product_compositing", bool(posters))
            ),
            local_text_rendering=bool(
                manifest.get("local_text_rendering", bool(posters))
            ),
            group_generation_requested=bool(
                manifest.get("group_generation_requested", False)
            ),
            group_generation_mode=(
                str(manifest["group_generation_mode"])
                if manifest.get("group_generation_mode")
                else None
            ),
            provider_size=(
                str(manifest["provider_size"])
                if manifest.get("provider_size")
                else None
            ),
            aspect_ratio=(
                str(manifest["aspect_ratio"])
                if manifest.get("aspect_ratio")
                else None
            ),
            fallback_used=bool(manifest.get("fallback_used", False)),
            provider_verified=bool(manifest.get("provider_verified", False)),
            completed_poster_count=int(
                manifest.get("completed_poster_count", len(posters))
            ),
            current_poster_index=(
                int(manifest["current_poster_index"])
                if manifest.get("current_poster_index") is not None
                else None
            ),
            maximum_provider_request_count=int(
                manifest.get("maximum_provider_request_count", 0)
            ),
            actual_provider_request_count=int(
                manifest.get(
                    "actual_provider_request_count",
                    manifest.get("provider_generation_request_count", 0),
                )
            ),
            automatic_retry_count=int(manifest.get("automatic_retry_count", 0)),
            execution=(
                str(manifest["execution"]) if manifest.get("execution") else None
            ),
            poll_url=(
                str(manifest["poll_url"]) if manifest.get("poll_url") else None
            ),
            target_platform=str(
                manifest.get("target_platform") or "xiaohongshu"
            ),
        )

    def get_result(self, generation_id: str) -> GenerationResult:
        return self._public_result(self.artifact_store.read_manifest(generation_id))

    def generate_idempotent(
        self,
        command: GenerationCommand,
        request_id: str,
        idempotency_key: Optional[str],
        fingerprint: str,
    ) -> GenerationResult:
        callback = lambda: self.generate(command, request_id)
        if not idempotency_key:
            provider_audit_event(
                _AUDIT_LOGGER,
                "idempotency_owner",
                request_id,
                generation_mode=command.generation_mode,
                idempotency_role="owner",
                outcome="unkeyed",
            )
            return callback()
        return self.idempotency.execute(
            idempotency_key,
            fingerprint,
            callback,
            local_request_id=request_id,
            generation_mode=command.generation_mode,
        )

    @staticmethod
    def _utc_now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _create_sequence_task(
        self, command: GenerationCommand, request_id: str
    ) -> GenerationResult:
        generation_id = self.artifact_store.create_generation()
        now = self._utc_now()
        service = self.product_poster_sequence_service
        manifest = {
            "api_version": API_VERSION,
            "request_id": request_id,
            "generation_id": generation_id,
            "generation_mode": "seedream_product_poster_sequence",
            "generation_type": "complete_product_poster_sequence",
            "status": "queued",
            "created_at": now,
            "updated_at": now,
            "provider": "seedream",
            "model": service.model_id if service is not None else None,
            "marketing_copy": {"body": "", "title": "", "headline": "", "subline": ""},
            "posters": [],
            "poster_slots": [
                {
                    "index": index,
                    "concept": concept,
                    "status": "waiting",
                    "provider_attempt_count": 0,
                    "started_at": None,
                    "completed_at": None,
                    "poster_id": None,
                    "width": None,
                    "height": None,
                    "safe_error_code": None,
                }
                for index, concept in enumerate(SEQUENCE_CONCEPTS, start=1)
            ],
            "requested_poster_count": 3,
            "actual_poster_count": 0,
            "completed_poster_count": 0,
            "current_poster_index": None,
            "maximum_provider_request_count": 3,
            "actual_provider_request_count": 0,
            "provider_generation_request_count": 0,
            "provider_result_download_count": 0,
            "automatic_retry_count": 0,
            "execution": "strictly_serial",
            "product_sent_to_provider": True,
            "reference_image_count": 1,
            "local_product_compositing": False,
            "local_text_rendering": True,
            "group_generation_requested": False,
            "group_generation_mode": None,
            "provider_size": self.product_poster_sequence_provider_size,
            "aspect_ratio": self.product_poster_sequence_aspect_ratio,
            "fallback_used": False,
            "provider_verified": self.product_poster_sequence_provider_verified,
            "zip_file_name": None,
            "warnings": [],
            "qa": {},
            "marketing_strategy": {},
            "target_platform": getattr(command, "target_platform", None)
            or "xiaohongshu",
            "prompt_metadata": [],
            "returned_image_dimensions": [],
        }
        try:
            self.artifact_store.write_manifest(generation_id, manifest)
        except Exception as exc:
            raise GenerationServiceError(
                "artifact_write_failed",
                "无法创建顺序生成任务记录。",
                status_code=500,
            ) from exc
        provider_audit_event(
            _AUDIT_LOGGER,
            "sequence_task_created",
            request_id,
            generation_mode="seedream_product_poster_sequence",
            generation_id=generation_id,
            completed_poster_count=0,
            outcome="queued",
        )
        return self._public_result(manifest)

    def create_sequence_idempotent(
        self,
        command: GenerationCommand,
        request_id: str,
        idempotency_key: Optional[str],
        fingerprint: str,
    ) -> Tuple[GenerationResult, bool]:
        self._validate_command(command)
        if command.generation_mode != "seedream_product_poster_sequence":
            raise GenerationServiceError(
                "unsupported_generation_mode", "不支持所选生成模式。"
            )
        callback = lambda: self._create_sequence_task(command, request_id)
        if not idempotency_key:
            provider_audit_event(
                _AUDIT_LOGGER,
                "idempotency_owner",
                request_id,
                generation_mode=command.generation_mode,
                idempotency_role="owner",
                outcome="unkeyed",
            )
            return callback(), True
        result, owner = self.idempotency.execute_with_role(
            idempotency_key,
            fingerprint,
            callback,
            local_request_id=request_id,
            generation_mode=command.generation_mode,
        )
        return (result if owner else self.get_result(result.generation_id)), owner

    @staticmethod
    def _sequence_error_code(exc: BaseException) -> str:
        if isinstance(exc, ImageProviderError):
            return exc.category
        if isinstance(exc, ArtifactValidationError):
            if "duplicate" in str(exc) or "distinct" in str(exc):
                return "duplicate_poster_image"
            return "artifact_write_failed"
        if isinstance(exc, GenerationServiceError):
            return exc.code
        return "sequence_internal_error"

    def _fail_sequence_task(
        self,
        generation_id: str,
        request_id: str,
        poster_index: Optional[int],
        exc: BaseException,
        started_at: Optional[float] = None,
    ) -> None:
        logging.getLogger("advertising_backend").error(
            "sequence_task_exception generation_id=%s request_id=%s poster_index=%s error_type=%s error=%s",
            generation_id,
            request_id,
            poster_index,
            type(exc).__name__,
            exc,
            exc_info=exc,
        )
        manifest = self.artifact_store.read_manifest(generation_id)
        error_code = self._sequence_error_code(exc)
        now = self._utc_now()
        completed = int(manifest.get("completed_poster_count", 0))
        # Early failures (copy / setup) pass poster_index=None. Mark the first
        # unfinished slot as failed so the UI shows the real error instead of
        # "previous_poster_failed" on every slot including poster 1.
        failed_index = poster_index
        if failed_index is None:
            for slot in manifest.get("poster_slots") or []:
                if slot.get("status") in {"waiting", "generating"}:
                    failed_index = int(slot["index"])
                    break
        if failed_index is not None:
            slot = manifest["poster_slots"][failed_index - 1]
            slot["status"] = "failed"
            slot["completed_at"] = now
            slot["safe_error_code"] = error_code
            provider_audit_event(
                _AUDIT_LOGGER,
                "sequence_poster_failed",
                request_id,
                generation_mode="seedream_product_poster_sequence",
                generation_id=generation_id,
                poster_index=failed_index,
                concept=slot["concept"],
                provider_attempt_count=int(slot.get("provider_attempt_count", 0)),
                completed_poster_count=completed,
                elapsed_ms=(
                    max(0, int(round((time.perf_counter() - started_at) * 1000)))
                    if started_at is not None and poster_index is not None
                    else None
                ),
                internal_error_category=error_code,
                provider_error_code=(
                    exc.provider_error_code
                    if isinstance(exc, ImageProviderError)
                    else None
                ),
                outcome="failed",
            )
        for slot in manifest.get("poster_slots") or []:
            if slot.get("status") in {"waiting", "generating"}:
                slot["status"] = "blocked"
                slot["safe_error_code"] = "previous_poster_failed"
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "sequence_poster_blocked",
                    request_id,
                    generation_mode="seedream_product_poster_sequence",
                    generation_id=generation_id,
                    poster_index=int(slot["index"]),
                    concept=slot["concept"],
                    completed_poster_count=completed,
                    outcome="blocked",
                )
        manifest["status"] = "partial_failed" if completed else "failed"
        manifest["current_poster_index"] = None
        manifest["updated_at"] = now
        manifest["zip_file_name"] = None
        manifest["qa"] = {
            "terminal": True,
            "safe_error_code": error_code,
            "completed_poster_count": completed,
        }
        self.artifact_store.write_manifest(generation_id, manifest)
        provider_audit_event(
            _AUDIT_LOGGER,
            "sequence_task_partial_failed" if completed else "sequence_task_failed",
            request_id,
            generation_mode="seedream_product_poster_sequence",
            generation_id=generation_id,
            completed_poster_count=completed,
            internal_error_category=error_code,
            outcome=manifest["status"],
        )

    def run_sequence_task(
        self, generation_id: str, command: GenerationCommand
    ) -> None:
        with self._sequence_jobs_lock:
            if generation_id in self._active_sequence_jobs:
                return
            self._active_sequence_jobs.add(generation_id)
        failure_request_id = "unbound"
        try:
            manifest = self.artifact_store.read_manifest(generation_id)
            if manifest.get("status") != "queued":
                return
            request_id = str(manifest["request_id"])
            failure_request_id = request_id
            manifest["status"] = "running"
            manifest["updated_at"] = self._utc_now()
            self.artifact_store.write_manifest(generation_id, manifest)
            provider_audit_event(
                _AUDIT_LOGGER,
                "sequence_task_started",
                request_id,
                generation_mode="seedream_product_poster_sequence",
                generation_id=generation_id,
                completed_poster_count=0,
                outcome="running",
            )

            try:
                marketing_copy, warnings = self._create_marketing_copy(command)
                strategy = _marketing_strategy_for_command(command, self._settings)
                manifest = self.artifact_store.read_manifest(generation_id)
                manifest["marketing_copy"] = marketing_copy.to_dict()
                manifest["marketing_strategy"] = strategy
                manifest["warnings"] = warnings
                template = resolve_poster_style_template(command.style_template_id)
                if template is not None:
                    manifest["style_template"] = {
                        "id": template.id,
                        "version": template.version,
                    }
                manifest["updated_at"] = self._utc_now()
                self.artifact_store.write_manifest(generation_id, manifest)
            except BaseException as exc:
                self._fail_sequence_task(generation_id, request_id, None, exc)
                return

            service = self.product_poster_sequence_service
            if service is None:
                self._fail_sequence_task(
                    generation_id,
                    request_id,
                    None,
                    GenerationServiceError("feature_disabled", "功能未启用。", 503),
                )
                return
            sequence_command = ProductPosterSequenceCommand(
                product_info=command.product_info,
                product_short_name=command.product_short_name,
                creative_note=command.creative_note,
                visual_style=command.visual_style,
                marketing_copy=marketing_copy,
                product_image=command.product_image or b"",
                send_product_to_provider=command.send_product_to_provider,
                requested_poster_count=command.requested_poster_count,
                text_rendering_mode=command.text_rendering_mode,
                generation_mode=command.generation_mode,
                marketing_advice_context=_marketing_advice_prompt_context(
                    command.marketing_advice
                ),
                style_template_id=command.style_template_id,
                sequence_typography_mode=command.sequence_typography_mode,
            )

            for poster_index in (1, 2, 3):
                manifest = self.artifact_store.read_manifest(generation_id)
                slot = manifest["poster_slots"][poster_index - 1]
                if slot.get("status") != "waiting":
                    self._fail_sequence_task(
                        generation_id,
                        request_id,
                        poster_index,
                        GenerationServiceError(
                            "invalid_sequence_state", "顺序任务状态无效。", 500
                        ),
                    )
                    return
                slot["status"] = "generating"
                slot["provider_attempt_count"] = 1
                slot["started_at"] = self._utc_now()
                manifest["current_poster_index"] = poster_index
                manifest["actual_provider_request_count"] = poster_index
                manifest["provider_generation_request_count"] = poster_index
                manifest["updated_at"] = self._utc_now()
                self.artifact_store.write_manifest(generation_id, manifest)
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "sequence_poster_started",
                    request_id,
                    generation_mode="seedream_product_poster_sequence",
                    generation_id=generation_id,
                    poster_index=poster_index,
                    concept=slot["concept"],
                    provider_attempt_count=1,
                    completed_poster_count=poster_index - 1,
                    outcome="generating",
                )
                started_at = time.perf_counter()
                try:
                    result = service.generate_poster(
                        sequence_command,
                        poster_index=poster_index,
                        local_request_id=request_id,
                        generation_id=generation_id,
                        provider_attempt_count=1,
                    )
                    poster_record = self.artifact_store.save_sequence_poster(
                        generation_id,
                        result.image.image,
                        poster_index,
                        existing_posters=manifest.get("posters") or [],
                    )
                    completed_at = self._utc_now()
                    slot.update(
                        {
                            "status": "ready",
                            "completed_at": completed_at,
                            "poster_id": poster_record["poster_id"],
                            "width": poster_record["width"],
                            "height": poster_record["height"],
                            "safe_error_code": None,
                        }
                    )
                    manifest["posters"].append(poster_record)
                    manifest["completed_poster_count"] = poster_index
                    manifest["actual_poster_count"] = poster_index
                    manifest["current_poster_index"] = None
                    manifest["provider_result_download_count"] = int(
                        manifest.get("provider_result_download_count", 0)
                    ) + result.provider_result_download_count
                    manifest["prompt_metadata"].append(
                        dict(result.sanitized_prompt_metadata)
                    )
                    manifest["returned_image_dimensions"].append(
                        [int(result.image.image.width), int(result.image.image.height)]
                    )
                    if "product_reference_metadata" not in manifest:
                        reference = result.reference_metadata
                        manifest["product_reference_metadata"] = {
                            "normalized_sha256": reference.normalized_sha256,
                            "normalized_mime_type": reference.normalized_mime_type,
                            "normalized_dimensions": [
                                reference.normalized_width,
                                reference.normalized_height,
                            ],
                            "reference_image_count": 1,
                        }
                    manifest["updated_at"] = completed_at
                    self.artifact_store.write_manifest(generation_id, manifest)
                    provider_audit_event(
                        _AUDIT_LOGGER,
                        "sequence_poster_ready",
                        request_id,
                        generation_mode="seedream_product_poster_sequence",
                        generation_id=generation_id,
                        poster_index=poster_index,
                        concept=slot["concept"],
                        provider_attempt_count=1,
                        completed_poster_count=poster_index,
                        elapsed_ms=max(
                            0,
                            int(round((time.perf_counter() - started_at) * 1000)),
                        ),
                        outcome="ready",
                    )
                except BaseException as exc:
                    self._fail_sequence_task(
                        generation_id, request_id, poster_index, exc, started_at
                    )
                    return

            try:
                manifest = self.artifact_store.read_manifest(generation_id)
                zip_file_name = self.artifact_store.create_zip(
                    generation_id, manifest["posters"]
                )
                qa = self.artifact_store.validate_sequence_artifacts(
                    generation_id, manifest["posters"], zip_file_name
                )
                manifest["zip_file_name"] = zip_file_name
                manifest["qa"] = qa
                manifest["status"] = "completed"
                manifest["current_poster_index"] = None
                manifest["updated_at"] = self._utc_now()
                self.artifact_store.write_manifest(generation_id, manifest)
            except BaseException as exc:
                self._fail_sequence_task(generation_id, request_id, None, exc)
                return
            provider_audit_event(
                _AUDIT_LOGGER,
                "sequence_task_completed",
                request_id,
                generation_mode="seedream_product_poster_sequence",
                generation_id=generation_id,
                provider_attempt_count=3,
                completed_poster_count=3,
                outcome="completed",
            )
        except BaseException as exc:
            try:
                manifest = self.artifact_store.read_manifest(generation_id)
                if manifest.get("status") in {"queued", "running"}:
                    current = manifest.get("current_poster_index")
                    self._fail_sequence_task(
                        generation_id,
                        failure_request_id,
                        int(current) if current is not None else None,
                        exc,
                    )
            except BaseException:
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "sequence_task_failed",
                    failure_request_id,
                    generation_mode="seedream_product_poster_sequence",
                    generation_id=generation_id,
                    internal_error_category="manifest_write_failed",
                    outcome="failed",
                )
        finally:
            with self._sequence_jobs_lock:
                self._active_sequence_jobs.discard(generation_id)

    def reconcile_interrupted_sequence_tasks(self) -> int:
        interrupted_count = 0
        for manifest in self.artifact_store.iter_manifests():
            if (
                manifest.get("generation_mode")
                != "seedream_product_poster_sequence"
                or manifest.get("status") not in {"queued", "running"}
            ):
                continue
            generation_id = str(manifest["generation_id"])
            request_id = str(manifest.get("request_id") or "unbound")
            for slot in manifest.get("poster_slots") or []:
                if slot.get("status") == "generating":
                    slot["status"] = "failed"
                    slot["safe_error_code"] = "task_interrupted"
                    slot["completed_at"] = self._utc_now()
                elif slot.get("status") == "waiting":
                    slot["status"] = "blocked"
                    slot["safe_error_code"] = "task_interrupted"
            manifest["status"] = "interrupted"
            manifest["current_poster_index"] = None
            manifest["updated_at"] = self._utc_now()
            manifest["zip_file_name"] = None
            self.artifact_store.write_manifest(generation_id, manifest)
            interrupted_count += 1
            provider_audit_event(
                _AUDIT_LOGGER,
                "sequence_task_interrupted",
                request_id,
                generation_mode="seedream_product_poster_sequence",
                generation_id=generation_id,
                completed_poster_count=int(
                    manifest.get("completed_poster_count", 0)
                ),
                internal_error_category="task_interrupted",
                outcome="interrupted",
            )
        return interrupted_count

    def _generate_product_poster_group(
        self,
        command: GenerationCommand,
        request_id: str,
        marketing_copy: MarketingCopy,
        warnings: List[str],
    ) -> GenerationResult:
        service = self.product_poster_group_service
        if service is None:
            raise GenerationServiceError(
                "feature_disabled",
                "Seedream 完整海报组图功能当前未启用。",
                status_code=503,
            )
        group_result = service.generate(
            ProductPosterGroupCommand(
                product_info=command.product_info,
                product_short_name=command.product_short_name,
                creative_note=command.creative_note,
                visual_style=command.visual_style,
                marketing_copy=marketing_copy,
                product_image=command.product_image or b"",
                send_product_to_provider=command.send_product_to_provider,
                requested_poster_count=command.requested_poster_count,
                text_rendering_mode=command.text_rendering_mode,
                generation_mode=command.generation_mode,
            ),
            local_request_id=request_id,
        )
        if len(group_result.images) != 3:
            too_few = len(group_result.images) < 3
            raise GenerationServiceError(
                "incomplete_group" if too_few else "unexpected_group_size",
                (
                    "模型返回的完整海报少于三张，未自动重试，也未保存不完整结果。"
                    if too_few
                    else "模型返回的海报数量超出预期，未保存该组结果。"
                ),
                status_code=502,
            )
        expected_dimensions = tuple(
            int(value) for value in group_result.provider_size.lower().split("x")
        )
        if (
            not group_result.dimensions_match_requested
            or any(
                item.image.size != expected_dimensions
                for item in group_result.images
            )
        ):
            raise GenerationServiceError(
                "inconsistent_group_dimensions",
                "模型返回的海报尺寸与 1024×1536 合同不一致。",
                status_code=502,
            )

        generation_id = self.artifact_store.create_generation()
        try:
            poster_records = self.artifact_store.save_complete_poster_group(
                generation_id,
                [item.image for item in group_result.images],
                poster_source="seedream_complete_poster",
            )
            zip_file_name = self.artifact_store.create_zip(
                generation_id, poster_records
            )
            structural_facts = self.artifact_store.validate_complete_poster_group(
                generation_id, poster_records, zip_file_name
            )
            from my_agent.qa_check import run_complete_poster_group_qa

            qa = run_complete_poster_group_qa(
                {
                    **structural_facts,
                    "poster_source": "seedream_complete_poster",
                    "local_product_compositing": False,
                    "local_text_rendering": False,
                }
            )
            reference = group_result.reference_metadata
            manifest = {
                "api_version": API_VERSION,
                "request_id": request_id,
                "generation_id": generation_id,
                "status": "completed",
                "generation_mode": "seedream_product_poster_group",
                "generation_type": "complete_product_poster_group",
                "provider": "seedream",
                "model": group_result.model,
                "marketing_copy": marketing_copy.to_dict(),
                "posters": poster_records,
                "zip_file_name": zip_file_name,
                "warnings": warnings,
                "qa": qa,
                "requested_poster_count": 3,
                "actual_poster_count": 3,
                "provider_generation_request_count": (
                    group_result.provider_generation_request_count
                ),
                "provider_result_download_count": (
                    group_result.provider_result_download_count
                ),
                "product_sent_to_provider": True,
                "reference_image_count": 1,
                "local_product_compositing": False,
                "local_text_rendering": False,
                "group_generation_requested": True,
                "group_generation_mode": "auto",
                "provider_size": group_result.provider_size,
                "aspect_ratio": group_result.provider_aspect_ratio,
                "fallback_used": False,
                "provider_verified": self.product_poster_group_provider_verified,
                "prompt_metadata": dict(group_result.sanitized_prompt_metadata),
                "product_reference_metadata": {
                    "normalized_sha256": reference.normalized_sha256,
                    "normalized_mime_type": reference.normalized_mime_type,
                    "normalized_dimensions": [
                        reference.normalized_width,
                        reference.normalized_height,
                    ],
                    "reference_image_count": reference.reference_image_count,
                },
                "returned_image_dimensions": [
                    [int(width), int(height)]
                    for width, height in group_result.returned_dimensions
                ],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            self.artifact_store.write_manifest(generation_id, manifest)
        except Exception as exc:
            try:
                self.artifact_store.discard_generation(generation_id)
            except Exception:
                pass
            if isinstance(exc, GenerationServiceError):
                raise
            if isinstance(exc, ArtifactValidationError):
                code = str(exc)
                if "duplicate" in code or "distinct" in code:
                    raise GenerationServiceError(
                        "duplicate_group_image",
                        "模型返回了重复海报，未保存该组结果。",
                        status_code=502,
                    ) from exc
                if "dimension" in code:
                    raise GenerationServiceError(
                        "inconsistent_group_dimensions",
                        "模型返回的海报尺寸不一致，未保存该组结果。",
                        status_code=502,
                    ) from exc
            raise GenerationServiceError(
                "artifact_write_failed",
                "完整海报文件保存失败，未写入完成记录。",
                status_code=500,
            ) from exc
        return self._public_result(manifest)

    def generate(self, command: GenerationCommand, request_id: str) -> GenerationResult:
        self._validate_command(command)
        if command.generation_mode == "seedream_product_poster_sequence":
            raise GenerationServiceError(
                "asynchronous_mode_required",
                "顺序生成模式必须通过异步任务入口启动。",
                status_code=409,
            )
        copies, warnings = self._create_marketing_copies(command)
        marketing_copy = copies[0]
        marketing_strategy = _marketing_strategy_for_command(command, self._settings)
        if command.generation_mode == "seedream_product_poster_group":
            return self._generate_product_poster_group(
                command, request_id, marketing_copy, warnings
            )
        rendered_images = []
        render_metadata: List[Dict[str, Any]] = []
        background_source: Optional[str] = None
        fallback_used = False

        if command.generate_poster:
            from my_agent.poster_generator import cutout_bytes, render_poster_variant

            size = OUTPUT_SIZES[command.output_size]
            product = cutout_bytes(command.product_image)
            prompt = self._background_prompt(command, size)
            background_result = self.image_service.acquire(
                mode=command.background_mode,
                prompt=prompt,
                stock_query=(
                    command.creative_note
                    or command.product_short_name
                    or command.product_info
                )[:200],
                size=size,
                visual_style=command.visual_style,
                creative_note=command.creative_note,
                reference_image=command.background_reference,
            )
            background_source = background_result.source
            fallback_used = background_result.fallback_used
            if background_result.diagnostic:
                warnings.append(background_result.diagnostic)

            for variant in range(3):
                rendered, metadata = render_poster_variant(
                    background_result.image.copy(),
                    product,
                    marketing_copy.title,
                    marketing_copy.headline,
                    marketing_copy.subline,
                    command.visual_style,
                    command.product_type,
                    variant,
                )
                rendered_images.append(rendered)
                metadata.update(
                    {
                        "background_source": background_source,
                        "fallback_used": fallback_used,
                    }
                )
                render_metadata.append(metadata)

        from my_agent.qa_check import run_generation_qa

        qa = run_generation_qa(
            {
                "generate_poster": command.generate_poster,
                "texts": {
                    "title": marketing_copy.title,
                    "headline": marketing_copy.headline,
                    "subline": marketing_copy.subline,
                },
                "ad_copy": marketing_copy.body,
                "posters": render_metadata,
                "background_source": background_source,
                "fallback_used": fallback_used,
            }
        )

        generation_id = self.artifact_store.create_generation()
        try:
            poster_records: List[Dict[str, Any]] = []
            for variant, image in enumerate(rendered_images):
                record = self.artifact_store.save_poster(
                    generation_id,
                    image,
                    variant,
                    background_source or "procedural",
                    fallback_used,
                )
                record.update(
                    {
                        "final_local_product_paste": True,
                        "local_product_compositing": True,
                        "local_text_rendering": True,
                        "product_sent_to_provider": False,
                        "poster_source": background_source or "procedural",
                    }
                )
                poster_records.append(record)
            zip_file_name = (
                self.artifact_store.create_zip(generation_id, poster_records)
                if poster_records
                else None
            )
            manifest = {
                "api_version": API_VERSION,
                "request_id": request_id,
                "generation_id": generation_id,
                "status": "completed",
                "generation_mode": "legacy_background_composite",
                "generation_type": (
                    "local_composite" if poster_records else "copy_only"
                ),
                "marketing_copy": marketing_copy.to_dict(),
                "marketing_copy_variants": [item.to_dict() for item in copies],
                "marketing_strategy": marketing_strategy,
                "target_platform": getattr(command, "target_platform", None)
                or "xiaohongshu",
                "posters": poster_records,
                "zip_file_name": zip_file_name,
                "warnings": warnings,
                "qa": qa,
                "requested_poster_count": 3 if command.generate_poster else 0,
                "actual_poster_count": len(poster_records),
                "provider_generation_request_count": 0,
                "provider_result_download_count": 0,
                "product_sent_to_provider": False,
                "local_product_compositing": bool(poster_records),
                "local_text_rendering": bool(poster_records),
                "group_generation_requested": False,
                "group_generation_mode": None,
                "provider_size": None,
                "aspect_ratio": None,
                "fallback_used": fallback_used,
                "provider_verified": False,
            }
            self.artifact_store.write_manifest(generation_id, manifest)
        except Exception:
            self.artifact_store.discard_generation(generation_id)
            raise
        return self._public_result(manifest)
