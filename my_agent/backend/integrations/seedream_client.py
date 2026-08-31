from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import math
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

import requests
from PIL import Image, UnidentifiedImageError
from requests.adapters import HTTPAdapter

from my_agent.backend.core.config import (
    ConfigurationError,
    OFFICIAL_SEEDREAM_API_ENDPOINT,
    Settings,
    validate_seedream_image_size,
)
from my_agent.backend.core.logging_config import (
    provider_audit_event,
    sanitize_audit_value,
)
from my_agent.backend.domain.models import (
    CompleteProductPosterResult,
    CompleteProductPosterGroupResult,
    GeneratedImage,
)
from my_agent.backend.integrations.image_reference import (
    ProductReferenceError,
    encode_product_reference,
)


_AUDIT_LOGGER = logging.getLogger("advertising_backend.provider_audit")


@dataclass(eq=False)
class ImageProviderError(Exception):
    category: str
    safe_message: str
    upstream_status: Optional[int] = None
    provider_error_code: Optional[str] = None
    provider_request_id: Optional[str] = None

    def __str__(self) -> str:
        return self.safe_message

    def __repr__(self) -> str:
        return (
            "ImageProviderError("
            f"category={self.category!r}, upstream_status={self.upstream_status!r})"
        )


class ImageGroupResultError(ImageProviderError):
    def __init__(self, actual_count: int):
        if actual_count == 0:
            category = "provider_result_error"
            safe_message = "Seedream returned no poster images."
        elif actual_count < 3:
            category = "incomplete_group"
            safe_message = "Seedream returned an incomplete poster group."
        else:
            category = "unexpected_group_size"
            safe_message = "Seedream returned an unexpected poster-group size."
        super().__init__(category=category, safe_message=safe_message)
        self.expected_count = 3
        self.actual_count = actual_count
        self.provider = "seedream"
        self.request_mode = "seedream_product_poster_group"

    def __repr__(self) -> str:
        return (
            "ImageGroupResultError("
            f"expected_count={self.expected_count}, "
            f"actual_count={self.actual_count}, "
            f"provider={self.provider!r}, request_mode={self.request_mode!r})"
        )


class SingleImageResultError(ImageProviderError):
    def __init__(self, actual_count: int):
        category = (
            "provider_result_error"
            if actual_count == 0
            else "unexpected_single_result_count"
        )
        message = (
            "Seedream returned no poster image."
            if actual_count == 0
            else "Seedream returned an unexpected number of poster images."
        )
        super().__init__(category=category, safe_message=message)
        self.expected_count = 1
        self.actual_count = actual_count
        self.provider = "seedream"
        self.request_mode = "seedream_product_poster_sequence"

    def __repr__(self) -> str:
        return (
            "SingleImageResultError("
            f"expected_count={self.expected_count}, actual_count={self.actual_count}, "
            f"provider={self.provider!r}, request_mode={self.request_mode!r})"
        )


class SeedreamClient:
    """The only production module that knows the Seedream HTTP wire contract."""

    def __init__(self, settings: Settings, session: Optional[requests.Session] = None):
        self._api_key = settings.seedream_api_key
        self._model_id = settings.seedream_model_id
        self._endpoint = settings.seedream_api_endpoint
        self._image_size = settings.seedream_image_size
        self._watermark = settings.seedream_watermark
        self._timeout = settings.seedream_timeout_seconds
        self._max_image_bytes = settings.max_provider_image_bytes
        self._max_reference_bytes = settings.max_upload_bytes
        self._max_json_bytes = 2 * 1024 * 1024
        self._max_pixels = settings.max_image_pixels
        self._session = session or self._session_without_retries()

    @staticmethod
    def _session_without_retries() -> requests.Session:
        session = requests.Session()
        adapter = HTTPAdapter(max_retries=0)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session

    def __repr__(self) -> str:
        return f"SeedreamClient(configured={self.configured})"

    @property
    def configured(self) -> bool:
        return bool(self._api_key.strip() and self._model_id.strip())

    @property
    def provider_image_size(self) -> str:
        return self._image_size

    @property
    def model_id(self) -> str:
        return self._model_id

    @staticmethod
    def _read_limited(response: requests.Response, limit: int) -> bytes:
        declared = response.headers.get("content-length")
        if declared:
            try:
                if int(declared) > limit:
                    raise ImageProviderError(
                        "invalid_response", "The remote image response is too large."
                    )
            except ValueError:
                pass
        chunks = bytearray()
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            chunks.extend(chunk)
            if len(chunks) > limit:
                raise ImageProviderError(
                    "invalid_response", "The remote image response is too large."
                )
        return bytes(chunks)

    def _validated_image(self, data: bytes) -> Image.Image:
        if not data or len(data) > self._max_image_bytes:
            raise ImageProviderError(
                "invalid_image", "Seedream did not return a usable image."
            )
        try:
            with Image.open(io.BytesIO(data)) as probe:
                width, height = probe.size
                if width <= 0 or height <= 0 or width * height > self._max_pixels:
                    raise ImageProviderError(
                        "invalid_image", "The returned image dimensions are invalid."
                    )
                probe.verify()
            with Image.open(io.BytesIO(data)) as decoded:
                decoded.load()
                return decoded.convert("RGBA")
        except ImageProviderError:
            raise
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise ImageProviderError(
                "invalid_image", "Seedream did not return a usable image."
            ) from exc

    def _reference_data_uri(self, reference_image: bytes) -> str:
        image = self._validated_image(reference_image)
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="PNG")
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/png;base64,{encoded}"

    @staticmethod
    def _elapsed_ms(started_at: float) -> int:
        return max(0, int(round((time.perf_counter() - started_at) * 1000)))

    @staticmethod
    def _status_class(status_code: int) -> str:
        return f"{status_code // 100}xx" if 100 <= status_code <= 599 else "unknown"

    @staticmethod
    def _safe_provider_metadata(
        document: Any,
        headers: Any,
    ) -> tuple[Optional[str], Optional[str]]:
        error_code_candidates: List[Any] = []
        request_id_candidates: List[Any] = []
        if isinstance(document, dict):
            error_code_candidates.append(document.get("code"))
            request_id_candidates.append(document.get("request_id"))
            nested_error = document.get("error")
            if isinstance(nested_error, dict):
                error_code_candidates.extend(
                    [nested_error.get("code"), nested_error.get("type")]
                )
                request_id_candidates.append(nested_error.get("request_id"))
        try:
            normalized_headers = {
                str(key).lower(): value for key, value in (headers or {}).items()
            }
        except (AttributeError, TypeError, ValueError):
            normalized_headers = {}
        request_id_candidates.extend(
            normalized_headers.get(key)
            for key in ("x-request-id", "x-tt-logid", "request-id")
        )

        provider_error_code = next(
            (
                safe
                for candidate in error_code_candidates
                if (safe := sanitize_audit_value(candidate)) is not None
            ),
            None,
        )
        provider_request_id = next(
            (
                safe
                for candidate in request_id_candidates
                if (safe := sanitize_audit_value(candidate)) is not None
            ),
            None,
        )
        return provider_error_code, provider_request_id

    @staticmethod
    def _status_error(
        status_code: int,
        *,
        provider_error_code: Optional[str] = None,
        provider_request_id: Optional[str] = None,
    ) -> ImageProviderError:
        if status_code == 401:
            return ImageProviderError(
                "unauthorized",
                "Seedream authentication failed.",
                status_code,
                provider_error_code,
                provider_request_id,
            )
        if status_code == 403:
            return ImageProviderError(
                "forbidden",
                "Seedream model access was denied.",
                status_code,
                provider_error_code,
                provider_request_id,
            )
        if status_code == 429:
            return ImageProviderError(
                "rate_limited",
                "Seedream is currently rate limited.",
                status_code,
                provider_error_code,
                provider_request_id,
            )
        if status_code == 408:
            return ImageProviderError(
                "timeout",
                "The Seedream request timed out.",
                status_code,
                provider_error_code,
                provider_request_id,
            )
        if status_code >= 500:
            return ImageProviderError(
                "server_error",
                "Seedream is temporarily unavailable.",
                status_code,
                provider_error_code,
                provider_request_id,
            )
        if status_code in {400, 404, 409, 422}:
            return ImageProviderError(
                "invalid_request",
                "Seedream rejected the request.",
                status_code,
                provider_error_code,
                provider_request_id,
            )
        return ImageProviderError(
            "invalid_response",
            "The Seedream request failed.",
            status_code,
            provider_error_code,
            provider_request_id,
        )

    def _validated_request_policy(self) -> str:
        if self._endpoint != OFFICIAL_SEEDREAM_API_ENDPOINT:
            raise ImageProviderError(
                "not_configured", "Seedream endpoint configuration is invalid."
            )
        if not isinstance(self._watermark, bool):
            raise ImageProviderError(
                "not_configured", "Seedream watermark configuration is invalid."
            )
        try:
            return validate_seedream_image_size(
                self._image_size, max_pixels=self._max_pixels
            )
        except ConfigurationError as exc:
            raise ImageProviderError(
                "not_configured", "Seedream image-size configuration is invalid."
            ) from exc

    def _post_generation(
        self,
        payload: Dict[str, Any],
        *,
        local_request_id: str = "unbound",
        generation_mode: str = "legacy_background_composite",
        operation: str = "background",
        generation_id: Optional[str] = None,
        poster_index: Optional[int] = None,
        provider_attempt_count: Optional[int] = None,
    ) -> List[Any]:
        started_at = time.perf_counter()
        provider_audit_event(
            _AUDIT_LOGGER,
            "seedream_post_started",
            local_request_id,
            provider="seedream",
            operation=operation,
            generation_mode=generation_mode,
            requested_image_count=(
                3 if generation_mode == "seedream_product_poster_group" else 1
            ),
            generation_id=generation_id,
            poster_index=poster_index,
            provider_attempt_count=provider_attempt_count,
            outcome="started",
        )
        try:
            response = self._session.post(
                self._endpoint,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                timeout=(10.0, self._timeout),
                stream=True,
                allow_redirects=False,
            )
        except requests.Timeout as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_post_failed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                elapsed_ms=self._elapsed_ms(started_at),
                internal_error_category="timeout",
                outcome="failed",
            )
            raise ImageProviderError("timeout", "The Seedream request timed out.") from exc
        except requests.exceptions.SSLError as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_post_failed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                elapsed_ms=self._elapsed_ms(started_at),
                internal_error_category="tls_error",
                outcome="failed",
            )
            raise ImageProviderError(
                "network_error", "Unable to establish a secure Seedream connection."
            ) from exc
        except requests.ConnectionError as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_post_failed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                elapsed_ms=self._elapsed_ms(started_at),
                internal_error_category="connection_error",
                outcome="failed",
            )
            raise ImageProviderError(
                "network_error", "Unable to connect to Seedream."
            ) from exc
        except requests.RequestException as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_post_failed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                elapsed_ms=self._elapsed_ms(started_at),
                internal_error_category="network_error",
                outcome="failed",
            )
            raise ImageProviderError(
                "network_error", "Unable to connect to Seedream."
            ) from exc

        if response.status_code >= 300:
            document: Any = None
            try:
                response_bytes = self._read_limited(
                    response, min(self._max_json_bytes, 64 * 1024)
                )
                document = json.loads(response_bytes.decode("utf-8"))
            except (
                ImageProviderError,
                requests.RequestException,
                UnicodeDecodeError,
                ValueError,
                TypeError,
            ):
                document = None
            finally:
                response.close()
            provider_error_code, provider_request_id = self._safe_provider_metadata(
                document, getattr(response, "headers", None)
            )
            provider_error = self._status_error(
                response.status_code,
                provider_error_code=provider_error_code,
                provider_request_id=provider_request_id,
            )
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_post_completed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                elapsed_ms=self._elapsed_ms(started_at),
                upstream_status=response.status_code,
                upstream_status_class=self._status_class(response.status_code),
                provider_error_code=provider_error_code,
                provider_request_id=provider_request_id,
                internal_error_category=provider_error.category,
                outcome="failed",
            )
            raise provider_error

        _, header_request_id = self._safe_provider_metadata(
            None, getattr(response, "headers", None)
        )
        provider_audit_event(
            _AUDIT_LOGGER,
            "seedream_post_completed",
            local_request_id,
            provider="seedream",
            operation=operation,
            generation_mode=generation_mode,
            elapsed_ms=self._elapsed_ms(started_at),
            upstream_status=response.status_code,
            upstream_status_class=self._status_class(response.status_code),
            provider_request_id=header_request_id,
            outcome="succeeded",
        )

        try:
            response_bytes = self._read_limited(response, self._max_json_bytes)
            document = json.loads(response_bytes.decode("utf-8"))
        except requests.Timeout as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_response_parse_failed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                internal_error_category="timeout",
                outcome="failed",
            )
            raise ImageProviderError(
                "timeout", "The Seedream response timed out."
            ) from exc
        except requests.RequestException as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_response_parse_failed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                internal_error_category="network_error",
                outcome="failed",
            )
            raise ImageProviderError(
                "network_error", "Unable to read the Seedream response."
            ) from exc
        except ImageProviderError as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_response_parse_failed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                internal_error_category=exc.category,
                outcome="failed",
            )
            raise
        except (UnicodeDecodeError, ValueError, TypeError) as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_response_parse_failed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                internal_error_category="invalid_response",
                outcome="failed",
            )
            raise ImageProviderError(
                "invalid_response", "Seedream returned an invalid response."
            ) from exc
        finally:
            response.close()

        data_items = document.get("data") if isinstance(document, dict) else None
        _, provider_request_id = self._safe_provider_metadata(
            document, getattr(response, "headers", None)
        )
        if not isinstance(data_items, list):
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_response_parse_failed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                provider_request_id=provider_request_id,
                internal_error_category="invalid_response",
                outcome="failed",
            )
            raise ImageProviderError(
                "invalid_response", "Seedream returned no image data."
            )
        provider_audit_event(
            _AUDIT_LOGGER,
            "seedream_response_parsed",
            local_request_id,
            provider="seedream",
            operation=operation,
            generation_mode=generation_mode,
            returned_item_count=len(data_items),
            response_format=payload.get("response_format"),
            provider_request_id=provider_request_id,
            outcome="succeeded",
        )
        return data_items

    def _generated_image_from_item(
        self,
        item: Any,
        *,
        local_request_id: str = "unbound",
        generation_mode: str = "legacy_background_composite",
        operation: str = "background",
        result_index: int = 0,
    ) -> GeneratedImage:
        if not isinstance(item, dict):
            raise ImageProviderError(
                "invalid_response", "Seedream returned invalid image data."
            )

        image_bytes: bytes
        decoded_image: Image.Image
        if item.get("b64_json"):
            try:
                image_bytes = base64.b64decode(str(item["b64_json"]), validate=True)
                decoded_image = self._validated_image(image_bytes)
            except (ValueError, TypeError) as exc:
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "seedream_result_decode_failed",
                    local_request_id,
                    provider="seedream",
                    operation=operation,
                    generation_mode=generation_mode,
                    result_index=result_index,
                    result_source_type="b64_json",
                    internal_error_category="invalid_response",
                    outcome="failed",
                )
                raise ImageProviderError(
                    "invalid_response", "Seedream returned invalid image encoding."
                ) from exc
            except ImageProviderError as exc:
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "seedream_result_decode_failed",
                    local_request_id,
                    provider="seedream",
                    operation=operation,
                    generation_mode=generation_mode,
                    result_index=result_index,
                    result_source_type="b64_json",
                    internal_error_category=exc.category,
                    outcome="failed",
                )
                raise
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_result_decoded",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                result_index=result_index,
                result_source_type="b64_json",
                decoded_byte_length=len(image_bytes),
                decoded_width=decoded_image.width,
                decoded_height=decoded_image.height,
                outcome="succeeded",
            )
        elif item.get("url"):
            result_url = str(item["url"])
            parsed = urlsplit(result_url)
            if parsed.scheme.lower() != "https" or not parsed.netloc:
                raise ImageProviderError(
                    "invalid_response", "Seedream returned an invalid image URL."
                )
            download_started_at = time.perf_counter()
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_result_download_started",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                result_index=result_index,
                result_source_type="url",
                outcome="started",
            )
            try:
                image_response = self._session.get(
                    result_url,
                    timeout=(10.0, self._timeout),
                    stream=True,
                    allow_redirects=False,
                )
            except requests.Timeout as exc:
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "seedream_result_download_failed",
                    local_request_id,
                    provider="seedream",
                    operation=operation,
                    generation_mode=generation_mode,
                    result_index=result_index,
                    result_source_type="url",
                    elapsed_ms=self._elapsed_ms(download_started_at),
                    internal_error_category="timeout",
                    outcome="failed",
                )
                raise ImageProviderError(
                    "timeout", "The Seedream image download timed out."
                ) from exc
            except requests.RequestException as exc:
                failure_category = (
                    "tls_error"
                    if isinstance(exc, requests.exceptions.SSLError)
                    else "connection_error"
                    if isinstance(exc, requests.ConnectionError)
                    else "network_error"
                )
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "seedream_result_download_failed",
                    local_request_id,
                    provider="seedream",
                    operation=operation,
                    generation_mode=generation_mode,
                    result_index=result_index,
                    result_source_type="url",
                    elapsed_ms=self._elapsed_ms(download_started_at),
                    internal_error_category=failure_category,
                    outcome="failed",
                )
                raise ImageProviderError(
                    "network_error", "Unable to download the Seedream image."
                ) from exc
            try:
                if image_response.status_code >= 300:
                    raise self._status_error(image_response.status_code)
                final_url = str(getattr(image_response, "url", result_url) or "")
                final_parsed = urlsplit(final_url)
                if final_parsed.scheme.lower() != "https" or not final_parsed.netloc:
                    raise ImageProviderError(
                        "invalid_response", "Seedream returned an invalid image URL."
                    )
                image_bytes = self._read_limited(
                    image_response, self._max_image_bytes
                )
                decoded_image = self._validated_image(image_bytes)
            except requests.Timeout as exc:
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "seedream_result_download_failed",
                    local_request_id,
                    provider="seedream",
                    operation=operation,
                    generation_mode=generation_mode,
                    result_index=result_index,
                    result_source_type="url",
                    upstream_status=getattr(image_response, "status_code", None),
                    elapsed_ms=self._elapsed_ms(download_started_at),
                    internal_error_category="timeout",
                    outcome="failed",
                )
                raise ImageProviderError(
                    "timeout", "The Seedream image download timed out."
                ) from exc
            except requests.RequestException as exc:
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "seedream_result_download_failed",
                    local_request_id,
                    provider="seedream",
                    operation=operation,
                    generation_mode=generation_mode,
                    result_index=result_index,
                    result_source_type="url",
                    upstream_status=getattr(image_response, "status_code", None),
                    elapsed_ms=self._elapsed_ms(download_started_at),
                    internal_error_category="network_error",
                    outcome="failed",
                )
                raise ImageProviderError(
                    "network_error", "Unable to read the Seedream image."
                ) from exc
            except ImageProviderError as exc:
                provider_audit_event(
                    _AUDIT_LOGGER,
                    "seedream_result_download_failed",
                    local_request_id,
                    provider="seedream",
                    operation=operation,
                    generation_mode=generation_mode,
                    result_index=result_index,
                    result_source_type="url",
                    upstream_status=getattr(image_response, "status_code", None),
                    elapsed_ms=self._elapsed_ms(download_started_at),
                    internal_error_category=exc.category,
                    outcome="failed",
                )
                raise
            finally:
                image_response.close()
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_result_download_completed",
                local_request_id,
                provider="seedream",
                operation=operation,
                generation_mode=generation_mode,
                result_index=result_index,
                result_source_type="url",
                upstream_status=image_response.status_code,
                elapsed_ms=self._elapsed_ms(download_started_at),
                decoded_width=decoded_image.width,
                decoded_height=decoded_image.height,
                outcome="succeeded",
            )
        else:
            raise ImageProviderError(
                "invalid_response", "Seedream returned no image data."
            )

        return GeneratedImage(
            image=decoded_image,
            source="seedream",
            provider="seedream",
            model_id=self._model_id,
        )

    def generate_background(
        self,
        prompt: str,
        reference_image: Optional[bytes] = None,
    ) -> GeneratedImage:
        if not self.configured:
            raise ImageProviderError(
                "not_configured",
                "Seedream is not configured. Set ARK_API_KEY in my_agent/.env.",
            )
        image_size = self._validated_request_policy()
        payload = {
            "model": self._model_id,
            "prompt": prompt,
            "size": image_size,
            "response_format": "url",
            "output_format": "png",
            "watermark": self._watermark,
        }
        if reference_image is not None:
            payload["image"] = self._reference_data_uri(reference_image)
        data_items = self._post_generation(payload)
        if not data_items or not isinstance(data_items[0], dict):
            raise ImageProviderError(
                "invalid_response", "Seedream returned no image data."
            )
        return self._generated_image_from_item(data_items[0])

    def generate_single_product_poster(
        self,
        *,
        prompt: str,
        product_reference: bytes,
        sanitized_prompt_metadata: Optional[Dict[str, Any]] = None,
        local_request_id: str = "unbound",
        generation_id: Optional[str] = None,
        poster_index: Optional[int] = None,
        provider_attempt_count: Optional[int] = None,
    ) -> CompleteProductPosterResult:
        """Generate exactly one complete poster with one product reference."""

        if not self.configured:
            raise ImageProviderError(
                "not_configured",
                "Seedream is not configured. Set ARK_API_KEY in my_agent/.env.",
            )
        if not prompt.strip():
            raise ImageProviderError(
                "invalid_request", "A complete-poster prompt is required."
            )
        image_size = self._validated_request_policy()
        try:
            encoded_reference = encode_product_reference(
                product_reference,
                max_input_bytes=self._max_reference_bytes,
                max_pixels=self._max_pixels,
            )
        except ProductReferenceError as exc:
            raise ImageProviderError(
                "invalid_reference_image", "The product reference image is invalid."
            ) from exc

        payload = {
            "model": self._model_id,
            "prompt": prompt,
            "image": [encoded_reference.data_uri],
            "size": image_size,
            "response_format": "url",
            "watermark": self._watermark,
        }
        data_items = self._post_generation(
            payload,
            local_request_id=local_request_id,
            generation_mode="seedream_product_poster_sequence",
            operation="product_poster_single",
            generation_id=generation_id,
            poster_index=poster_index,
            provider_attempt_count=provider_attempt_count,
        )
        actual_count = len(data_items)
        if actual_count != 1:
            error = SingleImageResultError(actual_count)
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_single_validation_failed",
                local_request_id,
                provider="seedream",
                operation="product_poster_single",
                generation_mode="seedream_product_poster_sequence",
                generation_id=generation_id,
                poster_index=poster_index,
                provider_attempt_count=provider_attempt_count,
                expected_image_count=1,
                actual_item_count=actual_count,
                internal_error_category=error.category,
                outcome="failed",
            )
            raise error
        try:
            generated = self._generated_image_from_item(
                data_items[0],
                local_request_id=local_request_id,
                generation_mode="seedream_product_poster_sequence",
                operation="product_poster_single",
                result_index=1,
            )
        except ImageProviderError as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_single_validation_failed",
                local_request_id,
                provider="seedream",
                operation="product_poster_single",
                generation_mode="seedream_product_poster_sequence",
                generation_id=generation_id,
                poster_index=poster_index,
                provider_attempt_count=provider_attempt_count,
                expected_image_count=1,
                actual_item_count=actual_count,
                parsed_image_count=0,
                internal_error_category=exc.category,
                outcome="failed",
            )
            raise

        provider_audit_event(
            _AUDIT_LOGGER,
            "seedream_single_validation_completed",
            local_request_id,
            provider="seedream",
            operation="product_poster_single",
            generation_mode="seedream_product_poster_sequence",
            generation_id=generation_id,
            poster_index=poster_index,
            provider_attempt_count=provider_attempt_count,
            expected_image_count=1,
            actual_item_count=1,
            parsed_image_count=1,
            outcome="succeeded",
        )
        requested_width, requested_height = (
            int(value) for value in image_size.lower().split("x")
        )
        divisor = math.gcd(requested_width, requested_height)
        return CompleteProductPosterResult(
            image=generated,
            model=self._model_id,
            provider_size=image_size,
            provider_aspect_ratio=(
                f"{requested_width // divisor}:{requested_height // divisor}"
            ),
            returned_dimensions=generated.image.size,
            reference_metadata=encoded_reference.metadata,
            sanitized_prompt_metadata=dict(sanitized_prompt_metadata or {}),
            provider_generation_request_count=1,
            provider_result_download_count=(
                1 if isinstance(data_items[0], dict) and data_items[0].get("url") else 0
            ),
        )

    def generate_product_poster_group(
        self,
        *,
        prompt: str,
        product_reference: bytes,
        requested_count: int,
        sanitized_prompt_metadata: Optional[Dict[str, Any]] = None,
        local_request_id: str = "unbound",
    ) -> CompleteProductPosterGroupResult:
        if not self.configured:
            raise ImageProviderError(
                "not_configured",
                "Seedream is not configured. Set ARK_API_KEY in my_agent/.env.",
            )
        if requested_count != 3:
            raise ImageProviderError(
                "invalid_request", "Complete-poster group mode requires three images."
            )
        if not prompt.strip():
            raise ImageProviderError(
                "invalid_request", "Complete-poster group prompt is required."
            )

        image_size = self._validated_request_policy()
        try:
            encoded_reference = encode_product_reference(
                product_reference,
                max_input_bytes=self._max_reference_bytes,
                max_pixels=self._max_pixels,
            )
        except ProductReferenceError as exc:
            raise ImageProviderError(
                "invalid_reference_image", "The product reference image is invalid."
            ) from exc

        payload = {
            "model": self._model_id,
            "prompt": prompt,
            "image": [encoded_reference.data_uri],
            "size": image_size,
            "sequential_image_generation": "auto",
            "sequential_image_generation_options": {"max_images": 3},
            "response_format": "url",
            "output_format": "png",
            "watermark": self._watermark,
        }
        data_items = self._post_generation(
            payload,
            local_request_id=local_request_id,
            generation_mode="seedream_product_poster_group",
            operation="product_poster_group",
        )
        actual_count = len(data_items)
        provider_audit_event(
            _AUDIT_LOGGER,
            "seedream_group_validation_started",
            local_request_id,
            provider="seedream",
            operation="product_poster_group",
            generation_mode="seedream_product_poster_group",
            expected_image_count=3,
            actual_item_count=actual_count,
            parsed_image_count=0,
            outcome="started",
        )
        if actual_count != 3:
            category = ImageGroupResultError(actual_count).category
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_group_validation_failed",
                local_request_id,
                provider="seedream",
                operation="product_poster_group",
                generation_mode="seedream_product_poster_group",
                internal_error_category=category,
                expected_image_count=3,
                actual_item_count=actual_count,
                actual_image_count=actual_count,
                parsed_image_count=0,
                outcome="failed",
            )
            raise ImageGroupResultError(actual_count)
        generated_images: List[GeneratedImage] = []
        try:
            for index, item in enumerate(data_items, start=1):
                generated_images.append(
                    self._generated_image_from_item(
                        item,
                        local_request_id=local_request_id,
                        generation_mode="seedream_product_poster_group",
                        operation="product_poster_group",
                        result_index=index,
                    )
                )
        except ImageProviderError as exc:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_group_validation_failed",
                local_request_id,
                provider="seedream",
                operation="product_poster_group",
                generation_mode="seedream_product_poster_group",
                internal_error_category=exc.category,
                expected_image_count=3,
                actual_item_count=actual_count,
                actual_image_count=len(generated_images),
                parsed_image_count=len(generated_images),
                outcome="failed",
            )
            raise
        returned_dimensions = [image.image.size for image in generated_images]
        if len(set(returned_dimensions)) != 1:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_group_validation_failed",
                local_request_id,
                provider="seedream",
                operation="product_poster_group",
                generation_mode="seedream_product_poster_group",
                internal_error_category="inconsistent_group_dimensions",
                expected_image_count=3,
                actual_item_count=actual_count,
                actual_image_count=len(generated_images),
                parsed_image_count=len(generated_images),
                dimensions_validation_outcome="failed",
                outcome="failed",
            )
            raise ImageProviderError(
                "inconsistent_group_dimensions",
                "Seedream returned poster images with inconsistent dimensions.",
            )
        image_fingerprints = {
            hashlib.sha256(image.image.tobytes()).digest()
            for image in generated_images
        }
        if len(image_fingerprints) != 3:
            provider_audit_event(
                _AUDIT_LOGGER,
                "seedream_group_validation_failed",
                local_request_id,
                provider="seedream",
                operation="product_poster_group",
                generation_mode="seedream_product_poster_group",
                internal_error_category="duplicate_group_image",
                expected_image_count=3,
                actual_item_count=actual_count,
                actual_image_count=len(generated_images),
                parsed_image_count=len(generated_images),
                dimensions_validation_outcome="passed",
                duplicate_validation_outcome="failed",
                outcome="failed",
            )
            raise ImageProviderError(
                "duplicate_group_image",
                "Seedream returned duplicate poster images.",
            )
        provider_audit_event(
            _AUDIT_LOGGER,
            "seedream_group_validation_completed",
            local_request_id,
            provider="seedream",
            operation="product_poster_group",
            generation_mode="seedream_product_poster_group",
            expected_image_count=3,
            actual_item_count=actual_count,
            actual_image_count=len(generated_images),
            parsed_image_count=len(generated_images),
            dimensions_validation_outcome="passed",
            duplicate_validation_outcome="passed",
            outcome="succeeded",
        )

        requested_width, requested_height = (
            int(value) for value in image_size.lower().split("x")
        )
        divisor = math.gcd(requested_width, requested_height)
        aspect_ratio = (
            f"{requested_width // divisor}:{requested_height // divisor}"
        )
        return CompleteProductPosterGroupResult(
            images=generated_images,
            model=self._model_id,
            provider_size=image_size,
            provider_aspect_ratio=aspect_ratio,
            returned_dimensions=returned_dimensions,
            dimensions_match_requested=all(
                dimensions == (requested_width, requested_height)
                for dimensions in returned_dimensions
            ),
            reference_metadata=encoded_reference.metadata,
            sanitized_prompt_metadata=dict(sanitized_prompt_metadata or {}),
            provider_generation_request_count=1,
            provider_result_download_count=sum(
                1 for item in data_items if isinstance(item.get("url"), str)
            ),
        )
