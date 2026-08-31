from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urljoin, urlsplit

import requests


PRODUCT_POSTER_GROUP_MODE = "seedream_product_poster_group"
PRODUCT_POSTER_GROUP_SIZE = "1024x1536"
PRODUCT_POSTER_SEQUENCE_MODE = "seedream_product_poster_sequence"
PRODUCT_POSTER_SEQUENCE_SIZE = "1024x1536"


def build_copy_only_payload(
    *,
    product_info: str,
    product_short_name: str,
    creative_note: str,
    visual_style: str,
    target_platform: str = "xiaohongshu",
    copy_variant_count: int = 3,
) -> Dict[str, Any]:
    return {
        "product_info": product_info,
        "product_short_name": product_short_name,
        "creative_note": creative_note,
        "visual_style": visual_style,
        "target_platform": target_platform,
        "generate_poster": False,
        "background_mode": "procedural",
        "output_size": "768x1024",
        "product_type": "bag_heavy",
        "generation_mode": "legacy_background_composite",
        "send_product_to_provider": False,
        "requested_poster_count": 1,
        "text_rendering_mode": "local",
        "copy_variant_count": max(1, min(3, int(copy_variant_count))),
    }


def build_product_poster_sequence_payload(
    *,
    product_info: str,
    product_short_name: str,
    creative_note: str,
    visual_style: str,
    consent: bool,
    target_platform: str = "xiaohongshu",
    prefilled_copy: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    if not consent:
        raise BackendAPIError(
            "missing_provider_consent", "请先确认商品参考图发送授权。"
        )
    copy = prefilled_copy or {}
    return {
        "product_info": product_info,
        "product_short_name": product_short_name,
        "creative_note": creative_note,
        "visual_style": visual_style,
        "target_platform": target_platform,
        "generate_poster": True,
        "generation_mode": PRODUCT_POSTER_SEQUENCE_MODE,
        "send_product_to_provider": True,
        "requested_poster_count": 3,
        "text_rendering_mode": "local",
        "output_size": PRODUCT_POSTER_SEQUENCE_SIZE,
        "prefilled_copy_body": str(copy.get("body") or ""),
        "prefilled_copy_title": str(copy.get("title") or ""),
        "prefilled_copy_headline": str(copy.get("headline") or ""),
        "prefilled_copy_subline": str(copy.get("subline") or ""),
    }


def build_product_poster_group_payload(
    *,
    product_info: str,
    product_short_name: str,
    creative_note: str,
    visual_style: str,
    consent: bool,
    target_platform: str = "xiaohongshu",
) -> Dict[str, Any]:
    if not consent:
        raise BackendAPIError(
            "missing_provider_consent", "请先确认商品参考图发送授权。"
        )
    return {
        "product_info": product_info,
        "product_short_name": product_short_name,
        "creative_note": creative_note,
        "visual_style": visual_style,
        "target_platform": target_platform,
        "generate_poster": True,
        "generation_mode": PRODUCT_POSTER_GROUP_MODE,
        "send_product_to_provider": True,
        "requested_poster_count": 3,
        "text_rendering_mode": "provider",
        "output_size": PRODUCT_POSTER_GROUP_SIZE,
    }


def build_legacy_generation_payload(
    *,
    product_info: str,
    product_short_name: str,
    creative_note: str,
    visual_style: str,
    generate_poster: bool,
    background_mode: str,
    output_size: str,
    product_type: str,
    target_platform: str = "xiaohongshu",
    prefilled_copy: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    copy = prefilled_copy or {}
    return {
        "product_info": product_info,
        "product_short_name": product_short_name,
        "creative_note": creative_note,
        "visual_style": visual_style,
        "target_platform": target_platform,
        "generate_poster": generate_poster,
        "background_mode": background_mode,
        "output_size": output_size,
        "product_type": product_type,
        "generation_mode": "legacy_background_composite",
        "send_product_to_provider": False,
        "requested_poster_count": 3 if generate_poster else 1,
        "text_rendering_mode": "local",
        "prefilled_copy_body": str(copy.get("body") or ""),
        "prefilled_copy_title": str(copy.get("title") or ""),
        "prefilled_copy_headline": str(copy.get("headline") or ""),
        "prefilled_copy_subline": str(copy.get("subline") or ""),
    }


class BackendUnavailable(RuntimeError):
    pass


@dataclass(eq=False)
class BackendAPIError(RuntimeError):
    code: str
    safe_message: str
    request_id: str = ""

    def __str__(self) -> str:
        return self.safe_message

    def __repr__(self) -> str:
        return f"BackendAPIError(code={self.code!r}, request_id={self.request_id!r})"


class BackendAPIClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        session: Optional[requests.Session] = None,
    ):
        self.base_url = (
            base_url or os.environ.get("AD_API_BASE_URL") or "http://127.0.0.1:8000"
        ).rstrip("/")
        self._session = session or requests.Session()

    def _url(self, path: str) -> str:
        if not path.startswith("/api/v1/"):
            raise BackendAPIError("invalid_backend_url", "后端返回了无效资源地址。")
        return urljoin(f"{self.base_url}/", path.lstrip("/"))

    @staticmethod
    def _safe_error(response: requests.Response) -> BackendAPIError:
        request_id = ""
        try:
            document = response.json()
            detail = document.get("error") if isinstance(document, dict) else None
            code = str((detail or {}).get("code") or "backend_error")
            candidate_request_id = str((detail or {}).get("request_id") or "")
            try:
                request_id = str(uuid.UUID(candidate_request_id))
            except (ValueError, TypeError, AttributeError):
                request_id = ""
            message = str((detail or {}).get("message") or "后端未能完成请求。")
        except (ValueError, TypeError, AttributeError):
            code, message = "backend_error", "后端未能完成请求。"
        return BackendAPIError(code, message, request_id)

    def health(self) -> Dict[str, Any]:
        try:
            response = self._session.get(f"{self.base_url}/api/v1/health", timeout=(2, 4))
        except requests.RequestException as exc:
            raise BackendUnavailable("后端服务未启动，请先启动本地 API 服务。") from exc
        if response.status_code >= 400:
            raise BackendUnavailable("后端服务未启动，请先启动本地 API 服务。")
        return response.json()

    def capabilities(self) -> Dict[str, Any]:
        try:
            response = self._session.get(
                f"{self.base_url}/api/v1/capabilities", timeout=(2, 6)
            )
        except requests.RequestException as exc:
            raise BackendUnavailable("后端服务未启动，请先启动本地 API 服务。") from exc
        if response.status_code >= 400:
            raise self._safe_error(response)
        return response.json()

    def create_generation(
        self,
        payload: Dict[str, Any],
        idempotency_key: str,
        product_image: Optional[Tuple[bytes, str]] = None,
        background_reference: Optional[Tuple[bytes, str]] = None,
    ) -> Dict[str, Any]:
        files: Dict[str, Tuple[Any, ...]] = {
            "payload": (None, json.dumps(payload, ensure_ascii=False), "application/json")
        }
        if product_image is not None:
            files["product_image"] = (
                "product-upload",
                product_image[0],
                product_image[1],
            )
        if background_reference is not None:
            files["background_reference"] = (
                "background-reference",
                background_reference[0],
                background_reference[1],
            )

        # Generation POSTs are one-shot; backend idempotency is not a retry policy.
        try:
            response = self._session.post(
                f"{self.base_url}/api/v1/generations",
                files=files,
                headers={"X-Idempotency-Key": idempotency_key},
                timeout=(5, 900),
            )
        except requests.ConnectionError as exc:
            raise BackendUnavailable("后端服务未启动，请先启动本地 API 服务。") from exc
        except requests.Timeout as exc:
            raise BackendAPIError(
                "backend_timeout",
                "后端处理超时，未自动重试；请勿重复提交并检查生成记录。",
            ) from exc
        if response.status_code >= 400:
            raise self._safe_error(response)
        return response.json()

    def get_generation(self, generation_id: str) -> Dict[str, Any]:
        try:
            normalized = str(uuid.UUID(str(generation_id)))
        except (ValueError, TypeError, AttributeError) as exc:
            raise BackendAPIError("invalid_generation_id", "生成任务编号无效。") from exc
        try:
            response = self._session.get(
                f"{self.base_url}/api/v1/generations/{normalized}",
                timeout=(2, 8),
            )
        except requests.RequestException as exc:
            raise BackendUnavailable("无法读取本地生成任务状态。") from exc
        if response.status_code >= 400:
            raise self._safe_error(response)
        return response.json()

    def get_poster_preview(self, resource_path: str) -> bytes:
        return self.get_binary(resource_path)

    def get_poster_download(self, resource_path: str) -> bytes:
        return self.get_binary(resource_path)

    def get_zip_download(self, resource_path: str) -> bytes:
        return self.get_binary(resource_path)

    def get_binary(self, resource_path: str) -> bytes:
        parsed = urlsplit(resource_path)
        if parsed.scheme or parsed.netloc:
            raise BackendAPIError("invalid_backend_url", "后端返回了无效资源地址。")
        try:
            response = self._session.get(self._url(resource_path), timeout=(3, 120))
        except requests.RequestException as exc:
            raise BackendUnavailable("无法从后端读取生成文件。") from exc
        if response.status_code >= 400:
            raise self._safe_error(response)
        return response.content

    def cutout_product(
        self,
        image_bytes: bytes,
        content_type: str = "image/png",
    ) -> bytes:
        """Call backend rembg cutout; returns PNG bytes with alpha."""
        files = {
            "product_image": ("product.png", image_bytes, content_type or "image/png")
        }
        try:
            response = self._session.post(
                f"{self.base_url}/api/v1/tools/cutout",
                files=files,
                timeout=(5, 180),
            )
        except requests.ConnectionError as exc:
            raise BackendUnavailable("后端服务未启动，请先启动本地 API 服务。") from exc
        except requests.Timeout as exc:
            raise BackendAPIError("backend_timeout", "去除背景超时，请稍后重试。") from exc
        if response.status_code >= 400:
            raise self._safe_error(response)
        return response.content
