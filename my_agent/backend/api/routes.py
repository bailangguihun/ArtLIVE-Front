from __future__ import annotations

import hashlib
import io
import json
import logging
import re
from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Form,
    Header,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from my_agent.backend import API_VERSION
from my_agent.backend.prompts.poster_style_templates import (
    poster_style_template_id_openapi_schema,
)
from my_agent.backend.api.errors import APIError
from my_agent.backend.api.schemas import (
    CapabilitiesResponse,
    CapabilityOption,
    GenerationModeCapability,
    GenerationRequest,
    GenerationResponse,
    MarketingAdvice,
    HealthResponse,
    MarketingAdviceRequest,
    MarketingAdviceResponse,
)
from my_agent.backend.core.config import Settings
from my_agent.backend.core.logging_config import provider_audit_event
from my_agent.backend.domain.models import GenerationCommand
from my_agent.backend.services.generation_service import (
    BACKGROUND_MODE_LABELS,
    OUTPUT_SIZES,
    PRODUCT_TYPE_LABELS,
    VISUAL_STYLE_LABELS,
    GenerationService,
    GenerationServiceError,
    IdempotencyConflictError,
)
from my_agent.backend.integrations.seedream_client import ImageProviderError
from my_agent.backend.services.image_generation_service import BackgroundGenerationError
from my_agent.backend.services.marketing_advice_service import (
    MarketingAdviceService,
    normalize_marketing_advice_request,
)
from my_agent.backend.storage.artifact_store import ArtifactNotFoundError, ArtifactStore
from my_agent.platform_catalog import platform_capability_options


ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_IMAGE_FORMATS = {"PNG", "JPEG", "WEBP"}
IDEMPOTENCY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_AUDIT_LOGGER = logging.getLogger("advertising_backend.provider_audit")


async def _read_upload_limited(upload: UploadFile, maximum: int) -> bytes:
    content = bytearray()
    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > maximum:
            raise APIError("upload_too_large", "上传图片超过大小限制。", 413)
    return bytes(content)


def _validate_image_upload(
    data: bytes,
    content_type: Optional[str],
    settings: Settings,
) -> None:
    if (content_type or "").lower() not in ALLOWED_CONTENT_TYPES:
        raise APIError("unsupported_image_type", "仅支持 PNG、JPEG 或 WebP 图片。", 415)
    try:
        with Image.open(io.BytesIO(data)) as image:
            image_format = str(image.format or "").upper()
            width, height = image.size
            if image_format not in ALLOWED_IMAGE_FORMATS:
                raise APIError("unsupported_image_type", "仅支持 PNG、JPEG 或 WebP 图片。", 415)
            if width <= 0 or height <= 0 or width * height > settings.max_image_pixels:
                raise APIError("invalid_image", "上传图片尺寸无效。", 422)
            image.verify()
    except APIError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise APIError("invalid_image", "上传内容不是有效图片。", 422) from exc


def _fingerprint(
    payload: GenerationRequest,
    product_image: Optional[bytes],
    background_reference: Optional[bytes],
) -> str:
    digest = hashlib.sha256()
    fingerprint_payload = payload.model_dump(mode="json")
    # An omitted optional reference must preserve the legacy generation
    # fingerprint byte-for-byte. A present reference is intentionally included.
    if fingerprint_payload.get("marketing_advice_ref") is None:
        fingerprint_payload.pop("marketing_advice_ref", None)
    if fingerprint_payload.get("v2_poster_copy_source") is None:
        fingerprint_payload.pop("v2_poster_copy_source", None)
    if fingerprint_payload.get("style_template_id") is None:
        fingerprint_payload.pop("style_template_id", None)
    if fingerprint_payload.get("sequence_typography_mode") is None:
        fingerprint_payload.pop("sequence_typography_mode", None)
    canonical = json.dumps(
        fingerprint_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    digest.update(canonical)
    digest.update(hashlib.sha256(product_image or b"").digest())
    digest.update(hashlib.sha256(background_reference or b"").digest())
    return digest.hexdigest()


def _validated_marketing_advice_for_copy(
    parsed: GenerationRequest,
    marketing_advice_service: MarketingAdviceService,
) -> Optional[MarketingAdvice]:
    """Recompute the catalogue result before any mutable generation work."""
    reference = parsed.marketing_advice_ref
    if reference is None:
        return None
    is_copy = (
        parsed.generation_mode.value == "legacy_background_composite"
        and not parsed.generate_poster
    )
    is_v2_sequence_poster = (
        parsed.generation_mode.value == "seedream_product_poster_sequence"
        and parsed.generate_poster
        and parsed.v2_poster_copy_source is not None
    )
    if not is_copy and not is_v2_sequence_poster:
        raise APIError(
            "marketing_advice_ref_not_allowed",
            "营销建议引用仅可用于当前宣传文案生成。",
            422,
        )
    try:
        normalized_input = normalize_marketing_advice_request(
            MarketingAdviceRequest(
                product_info=parsed.product_info,
                product_short_name=parsed.product_short_name,
                creative_note=parsed.creative_note,
            )
        )
        recomputed = marketing_advice_service.create(
            MarketingAdviceRequest(**normalized_input)
        )
    except ValidationError as exc:
        raise APIError(
            "invalid_marketing_advice_input",
            "商品信息不符合营销建议生成要求。",
            422,
        ) from exc
    if (
        reference.advice_version != recomputed.advice_version
        or reference.input_signature_sha256 != recomputed.input_signature_sha256
    ):
        raise APIError(
            "invalid_marketing_advice_reference",
            "营销建议引用与商品信息不匹配。",
            422,
        )
    # AI classification may vary in prose while the product input is stable.
    # Bind copy generation to the validated input signature, not a stale output hash.
    return recomputed.advice


def _validate_v2_poster_copy_source(parsed: GenerationRequest) -> None:
    """Reject ambiguous source payloads before file reads or mutable work."""
    source = parsed.v2_poster_copy_source
    if source is None:
        return
    if (
        parsed.generation_mode.value != "seedream_product_poster_sequence"
        or not parsed.generate_poster
    ):
        raise APIError(
            "v2_poster_copy_source_not_allowed",
            "海报文案来源仅可用于顺序海报生成。",
            422,
        )
    if source.mode == "poster_owned":
        if any((
            parsed.prefilled_copy_body,
            parsed.prefilled_copy_title,
            parsed.prefilled_copy_headline,
            parsed.prefilled_copy_subline,
        )):
            raise APIError(
                "v2_poster_copy_source_mixed",
                "海报自有文案不能包含预填宣传文案。",
                422,
            )
        return
    frozen = source.frozen_copy
    reference = source.copy_ref
    if frozen is None or reference is None:
        raise APIError("v2_poster_copy_source_invalid", "海报文案来源无效。", 422)
    advice_reference = parsed.marketing_advice_ref
    if (
        frozen.platform.value != parsed.target_platform.value
        or frozen.style.value != parsed.visual_style.value
        or frozen.body != parsed.prefilled_copy_body
        or frozen.title != parsed.prefilled_copy_title
        or frozen.headline != parsed.prefilled_copy_headline
        or frozen.subline != parsed.prefilled_copy_subline
        or advice_reference is None
        or reference.advice_owner.input_signature_sha256
        != advice_reference.input_signature_sha256
        or reference.advice_owner.advice_signature_sha256
        != advice_reference.advice_signature_sha256
    ):
        raise APIError(
            "v2_poster_copy_source_mismatch",
            "海报文案快照与本轮创作依据不一致。",
            422,
        )


def create_router(
    service: GenerationService,
    store: ArtifactStore,
    settings: Settings,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1")
    marketing_advice_service = MarketingAdviceService(settings)

    @router.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", api_version=API_VERSION)

    @router.get("/capabilities", response_model=CapabilitiesResponse)
    def capabilities() -> CapabilitiesResponse:
        return CapabilitiesResponse(
            api_version=API_VERSION,
            visual_styles=[
                CapabilityOption(id=key, label=value)
                for key, value in VISUAL_STYLE_LABELS.items()
            ],
            platforms=[
                CapabilityOption(id=item["id"], label=item["label"])
                for item in platform_capability_options()
            ],
            background_modes=[
                CapabilityOption(id=key, label=value)
                for key, value in BACKGROUND_MODE_LABELS.items()
            ],
            output_sizes=[
                CapabilityOption(id=key, label=f"{value[0]}×{value[1]}")
                for key, value in OUTPUT_SIZES.items()
            ],
            product_types=[
                CapabilityOption(id=key, label=value)
                for key, value in PRODUCT_TYPE_LABELS.items()
            ],
            seedream_configured=service.seedream_configured,
            stock_fallback_configured=service.stock_configured,
            generation_modes=[
                GenerationModeCapability(
                    mode="seedream_product_poster_group",
                    implemented=service.product_poster_group_implemented,
                    enabled=False,
                    provider_verified=service.product_poster_group_provider_verified,
                    requested_poster_count=3,
                    provider_request_count=1,
                    maximum_provider_request_count=1,
                    execution="deprecated_group_request",
                    deprecated=True,
                    product_reference_required=True,
                    product_sent_to_provider=True,
                    local_product_compositing=False,
                    local_text_rendering=False,
                    provider_size=service.product_poster_group_provider_size,
                    aspect_ratio=service.product_poster_group_aspect_ratio,
                ),
                GenerationModeCapability(
                    mode="seedream_product_poster_sequence",
                    implemented=service.product_poster_sequence_implemented,
                    enabled=service.product_poster_sequence_enabled,
                    provider_verified=service.product_poster_sequence_provider_verified,
                    requested_poster_count=3,
                    provider_request_count=0,
                    maximum_provider_request_count=3,
                    execution="strictly_serial",
                    product_reference_required=True,
                    product_sent_to_provider=True,
                    local_product_compositing=False,
                    local_text_rendering=True,
                    provider_size=service.product_poster_sequence_provider_size,
                    aspect_ratio=service.product_poster_sequence_aspect_ratio,
                )
            ],
        )

    @router.post("/marketing-advice", response_model=MarketingAdviceResponse)
    def marketing_advice(payload: MarketingAdviceRequest) -> MarketingAdviceResponse:
        return marketing_advice_service.create(payload)

    @router.post("/generations", response_model=GenerationResponse)
    async def create_generation(
        request: Request,
        background_tasks: BackgroundTasks,
        response: Response,
        payload: str = Form(
            ...,
            description="JSON-serialized GenerationRequest validated by the server.",
            json_schema_extra={
                "contentMediaType": "application/json",
                "contentSchema": {
                    "type": "object",
                    "properties": {
                        "style_template_id": poster_style_template_id_openapi_schema(),
                    },
                },
            },
        ),
        product_image: Optional[UploadFile] = File(default=None),
        background_reference: Optional[UploadFile] = File(default=None),
        x_idempotency_key: Optional[str] = Header(default=None, alias="X-Idempotency-Key"),
    ) -> GenerationResponse:
        try:
            parsed = GenerationRequest.model_validate_json(payload)
        except ValidationError as exc:
            details = []
            for item in exc.errors()[:3]:
                loc = ".".join(str(part) for part in item.get("loc") or [])
                msg = str(item.get("msg") or "invalid")
                details.append(f"{loc}: {msg}" if loc else msg)
            message = "请求字段无效。"
            if details:
                message = "请求字段无效：" + "；".join(details)
            raise APIError("invalid_payload", message, 422) from exc

        # Validate V2 Poster source and deterministic Advice before upload
        # reads, idempotency registration, artifacts, or provider work.
        _validate_v2_poster_copy_source(parsed)
        if (
            parsed.style_template_id is not None
            and parsed.generation_mode.value != "seedream_product_poster_sequence"
        ):
            raise APIError(
                "style_template_not_allowed",
                "海报风格模板仅可用于当前海报顺序生成模式。",
                422,
            )
        if (
            parsed.v2_poster_copy_source is not None
            and parsed.marketing_advice_ref is None
        ):
            raise APIError(
                "marketing_advice_ref_required",
                "当前海报创作需要可验证的营销建议。",
                422,
            )
        validated_marketing_advice = _validated_marketing_advice_for_copy(
            parsed,
            marketing_advice_service,
        )
        if x_idempotency_key and not IDEMPOTENCY_PATTERN.fullmatch(x_idempotency_key):
            raise APIError("invalid_idempotency_key", "幂等键格式无效。", 422)
        if parsed.generate_poster and product_image is None:
            raise APIError("missing_product_image", "生成海报时必须上传商品原图。", 422)
        if (
            parsed.generate_poster
            and parsed.generation_mode.value == "legacy_background_composite"
            and parsed.background_mode.value == "seedream_reference"
            and background_reference is None
        ):
            raise APIError("missing_background_reference", "参考图创作模式必须上传背景参考图。", 422)

        if (
            parsed.generation_mode.value in {
                "seedream_product_poster_group",
                "seedream_product_poster_sequence",
            }
            and background_reference is not None
        ):
            raise APIError(
                "background_reference_not_allowed",
                "完整海报组图模式只接受一张商品参考图。",
                422,
            )

        product_bytes: Optional[bytes] = None
        reference_bytes: Optional[bytes] = None
        try:
            if parsed.generate_poster and product_image is not None:
                product_bytes = await _read_upload_limited(product_image, settings.max_upload_bytes)
                _validate_image_upload(product_bytes, product_image.content_type, settings)
            if parsed.generate_poster and background_reference is not None:
                reference_bytes = await _read_upload_limited(
                    background_reference, settings.max_upload_bytes
                )
                _validate_image_upload(
                    reference_bytes, background_reference.content_type, settings
                )
        finally:
            if product_image is not None:
                await product_image.close()
            if background_reference is not None:
                await background_reference.close()

        command = GenerationCommand(
            product_info=parsed.product_info.strip(),
            product_short_name=parsed.product_short_name.strip(),
            creative_note=parsed.creative_note.strip(),
            visual_style=parsed.visual_style.value,
            target_platform=parsed.target_platform.value,
            generate_poster=parsed.generate_poster,
            background_mode=parsed.background_mode.value,
            output_size=parsed.output_size.value,
            product_type=parsed.product_type.value,
            product_image=product_bytes,
            background_reference=reference_bytes,
            generation_mode=parsed.generation_mode.value,
            send_product_to_provider=parsed.send_product_to_provider,
            requested_poster_count=parsed.requested_poster_count,
            text_rendering_mode=parsed.text_rendering_mode.value,
            prefilled_copy_body=parsed.prefilled_copy_body.strip(),
            prefilled_copy_title=parsed.prefilled_copy_title.strip(),
            prefilled_copy_headline=parsed.prefilled_copy_headline.strip(),
            prefilled_copy_subline=parsed.prefilled_copy_subline.strip(),
            copy_variant_count=parsed.copy_variant_count,
            marketing_advice=(
                validated_marketing_advice.model_dump(mode="json")
                if validated_marketing_advice is not None
                else None
            ),
            poster_copy_source=(
                parsed.v2_poster_copy_source.model_dump(mode="json")
                if parsed.v2_poster_copy_source is not None
                else None
            ),
            style_template_id=parsed.style_template_id,
            sequence_typography_mode=parsed.sequence_typography_mode,
        )
        request_id = str(request.state.request_id)
        try:
            fingerprint = _fingerprint(parsed, product_bytes, reference_bytes)
            if command.generation_mode == "seedream_product_poster_sequence":
                result, owner = await run_in_threadpool(
                    service.create_sequence_idempotent,
                    command,
                    request_id,
                    x_idempotency_key,
                    fingerprint,
                )
                if owner:
                    background_tasks.add_task(
                        service.run_sequence_task, result.generation_id, command
                    )
                response.status_code = 202
            else:
                result = await run_in_threadpool(
                    service.generate_idempotent,
                    command,
                    request_id,
                    x_idempotency_key,
                    fingerprint,
                )
        except IdempotencyConflictError as exc:
            raise APIError(
                "idempotency_conflict",
                "该幂等键已用于不同请求。",
                409,
            ) from exc
        except GenerationServiceError as exc:
            raise APIError(exc.code, exc.safe_message, exc.status_code) from exc
        except ImageProviderError as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_provider_error_handled",
                request_id,
                provider="seedream",
                operation=(
                    "product_poster_single"
                    if command.generation_mode == "seedream_product_poster_sequence"
                    else "product_poster_group"
                ),
                generation_mode=command.generation_mode,
                upstream_status=exc.upstream_status,
                provider_error_code=exc.provider_error_code,
                provider_request_id=exc.provider_request_id,
                internal_error_category=exc.category,
                outcome="failed",
            )
            category_map = {
                "not_configured": ("seedream_not_configured", 503),
                "timeout": ("provider_timeout", 504),
                "unauthorized": ("provider_unauthorized", 502),
                "forbidden": ("provider_forbidden", 502),
                "rate_limited": ("provider_rate_limited", 503),
                "invalid_request": ("provider_invalid_request", 502),
                "server_error": ("provider_server_error", 502),
                "network_error": ("provider_network_error", 502),
                "invalid_response": ("provider_invalid_response", 502),
                "invalid_image": ("provider_invalid_image", 502),
                "provider_result_error": ("incomplete_group", 502),
                "incomplete_group": ("incomplete_group", 502),
                "unexpected_group_size": ("unexpected_group_size", 502),
                "duplicate_group_image": ("duplicate_group_image", 502),
                "inconsistent_group_dimensions": (
                    "inconsistent_group_dimensions",
                    502,
                ),
                "invalid_reference_image": ("unsafe_reference_image", 422),
            }
            code, status_code = category_map.get(
                exc.category, ("provider_rejected_request", 502)
            )
            messages = {
                "seedream_not_configured": "Seedream 当前未配置。",
                "provider_timeout": "Seedream 请求超时，未自动重试。",
                "incomplete_group": "模型返回少于三张海报，未自动付费重试，也未保存不完整结果。",
                "unexpected_group_size": "模型返回的海报数量超出预期，未保存该组结果。",
                "duplicate_group_image": "模型返回了重复海报，未保存该组结果。",
                "inconsistent_group_dimensions": "模型返回的海报尺寸不一致，未保存该组结果。",
                "unsafe_reference_image": "商品参考图无法安全处理。",
                "provider_rejected_request": "Seedream 未能完成完整海报组图请求，未自动重试。",
            }
            messages.update(
                {
                    "provider_unauthorized": "Seedream 凭据验证失败，未自动重试。",
                    "provider_forbidden": "Seedream 模型访问被拒绝，未自动重试。",
                    "provider_rate_limited": "Seedream 当前限流，未自动重试。",
                    "provider_invalid_request": "Seedream 拒绝了组图请求，未自动重试。",
                    "provider_server_error": "Seedream 服务暂时异常，未自动重试。",
                    "provider_network_error": "Seedream 网络连接失败，未自动重试。",
                    "provider_invalid_response": "Seedream 返回了无效结果，未自动重试。",
                    "provider_invalid_image": "Seedream 返回的图像无法安全解码。",
                }
            )
            raise APIError(code, messages[code], status_code) from exc
        except BackgroundGenerationError as exc:
            category = exc.category if exc.category in {
                "not_configured",
                "timeout",
                "unauthorized",
                "forbidden",
                "rate_limited",
                "server_error",
                "invalid_response",
                "invalid_image",
                "network_error",
            } else "provider_error"
            status_code = 504 if category == "timeout" else 503
            raise APIError(
                f"seedream_{category}",
                "Seedream 背景生成失败，请检查配置或稍后重试。",
                status_code,
            ) from exc
        except ValueError as exc:
            raise APIError("generation_input_invalid", "生成输入无效。", 422) from exc
        return GenerationResponse.model_validate(result.to_dict())

    @router.get("/generations/{generation_id}", response_model=GenerationResponse)
    def get_generation(generation_id: str) -> GenerationResponse:
        try:
            result = service.get_result(generation_id)
        except ArtifactNotFoundError as exc:
            raise APIError("generation_not_found", "未找到该生成记录。", 404) from exc
        return GenerationResponse.model_validate(result.to_dict())

    @router.get("/generations/{generation_id}/posters/{poster_id}")
    def preview_poster(generation_id: str, poster_id: str) -> FileResponse:
        try:
            path = store.resolve_poster(generation_id, poster_id)
        except ArtifactNotFoundError as exc:
            raise APIError("poster_not_found", "未找到该海报。", 404) from exc
        return FileResponse(path, media_type="image/png")

    @router.get("/generations/{generation_id}/posters/{poster_id}/download")
    def download_poster(generation_id: str, poster_id: str) -> FileResponse:
        try:
            path = store.resolve_poster(generation_id, poster_id)
        except ArtifactNotFoundError as exc:
            raise APIError("poster_not_found", "未找到该海报。", 404) from exc
        return FileResponse(
            path,
            media_type="image/png",
            filename=f"poster-{poster_id}.png",
        )

    @router.get("/generations/{generation_id}/download")
    def download_generation(generation_id: str) -> FileResponse:
        try:
            path = store.resolve_zip(generation_id)
        except ArtifactNotFoundError as exc:
            raise APIError("archive_not_found", "未找到该海报压缩包。", 404) from exc
        return FileResponse(
            path,
            media_type="application/zip",
            filename=f"posters-{generation_id}.zip",
        )

    @router.post("/tools/cutout")
    async def cutout_product_image(
        product_image: UploadFile = File(...),
    ) -> Response:
        """Remove product background locally (rembg); returns PNG with alpha."""
        data = await _read_upload_limited(product_image, settings.max_upload_bytes)
        _validate_image_upload(data, product_image.content_type, settings)

        def _run() -> bytes:
            from my_agent.poster_generator import cutout_bytes

            image = cutout_bytes(data)
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return buffer.getvalue()

        try:
            png = await run_in_threadpool(_run)
        except ValueError as exc:
            raise APIError("invalid_image", str(exc) or "图片无效。", 422) from exc
        except RuntimeError as exc:
            raise APIError("cutout_failed", str(exc) or "去除背景失败。", 500) from exc
        except Exception as exc:
            raise APIError("cutout_failed", "去除背景失败。", 500) from exc
        return Response(content=png, media_type="image/png")

    return router
