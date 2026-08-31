from __future__ import annotations

import asyncio
import io
import json
from pathlib import Path
from typing import Optional

import httpx
from PIL import Image

from my_agent.backend.core.config import OFFICIAL_SEEDREAM_API_ENDPOINT, Settings
from my_agent.backend.domain.models import GeneratedImage, MarketingCopy
from my_agent.backend.integrations.seedream_client import ImageProviderError


class OfflineASGIClient:
    """Small synchronous test facade over httpx's supported ASGI transport."""

    def __init__(self, app, *, raise_server_exceptions: bool = True) -> None:
        self.app = app
        self.raise_server_exceptions = raise_server_exceptions

    def request(self, method: str, url: str, **kwargs):
        async def send():
            transport = httpx.ASGITransport(
                app=self.app,
                raise_app_exceptions=self.raise_server_exceptions,
            )
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                return await client.request(method, url, **kwargs)

        return asyncio.run(send())

    def get(self, url: str, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs):
        return self.request("POST", url, **kwargs)

    def close(self) -> None:
        return None


def png_bytes(
    size: tuple[int, int] = (32, 40),
    color: tuple[int, int, int, int] = (215, 30, 40, 255),
    transparent_border: bool = False,
) -> bytes:
    image = Image.new("RGBA", size, (0, 0, 0, 0) if transparent_border else color)
    if transparent_border:
        inset = max(2, min(size) // 6)
        inner = Image.new(
            "RGBA",
            (size[0] - inset * 2, size[1] - inset * 2),
            color,
        )
        image.paste(inner, (inset, inset), inner)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def settings_for(
    root: Path,
    *,
    seedream_configured: bool = False,
    max_upload_bytes: int = 10 * 1024 * 1024,
    max_provider_image_bytes: int = 2 * 1024 * 1024,
) -> Settings:
    return Settings(
        project_root=root,
        artifact_root=root / "artifacts",
        max_upload_bytes=max_upload_bytes,
        max_image_pixels=2_000_000,
        max_provider_image_bytes=max_provider_image_bytes,
        seedream_api_key="offline-test-key" if seedream_configured else "",
        seedream_model_id="offline-test-model" if seedream_configured else "",
        seedream_api_endpoint=OFFICIAL_SEEDREAM_API_ENDPOINT,
        seedream_timeout_seconds=3.0,
        deepseek_api_key="",
        cors_origins=["http://127.0.0.1:8501"],
    )


class FakeCopyClient:
    def __init__(self) -> None:
        self.calls = 0

    def generate_marketing_copy(
        self,
        product_info: str,
        short_name: str,
        visual_style: str,
        creative_note: str,
    ) -> MarketingCopy:
        _ = (product_info, visual_style, creative_note)
        self.calls += 1
        return MarketingCopy(
            body="Offline marketing copy.",
            title=(short_name or "Product")[:12],
            headline="Local headline",
            subline="Local subline",
        )


class FakeSeedreamProvider:
    def __init__(
        self,
        *,
        configured: bool = True,
        image: Optional[Image.Image] = None,
        error_category: Optional[str] = None,
    ) -> None:
        self._configured = configured
        self.image = image or Image.new("RGBA", (96, 128), (80, 120, 180, 255))
        self.error_category = error_category
        self.calls = 0
        self.references: list[Optional[bytes]] = []
        self.prompts: list[str] = []

    @property
    def configured(self) -> bool:
        return self._configured

    def generate_background(
        self, prompt: str, reference_image: Optional[bytes] = None
    ) -> GeneratedImage:
        self.calls += 1
        self.prompts.append(prompt)
        self.references.append(reference_image)
        if self.error_category:
            raise ImageProviderError(self.error_category, "Safe offline provider failure.")
        if not self.configured:
            raise ImageProviderError("not_configured", "Seedream is not configured.")
        return GeneratedImage(
            image=self.image.copy(),
            source="seedream",
            provider="seedream",
            model_id="offline-test-model",
        )


class FakeStockProvider:
    def __init__(
        self,
        image: Optional[Image.Image] = None,
        *,
        configured: bool = True,
        raises: bool = False,
    ) -> None:
        self.image = image
        self._configured = configured
        self.raises = raises
        self.calls = 0

    @property
    def configured(self) -> bool:
        return self._configured

    def fetch(self, query: str) -> Optional[Image.Image]:
        _ = query
        self.calls += 1
        if self.raises:
            raise RuntimeError("offline stock failure")
        return self.image.copy() if self.image is not None else None


class FakeHTTPResponse:
    def __init__(
        self,
        body: bytes = b"",
        *,
        status_code: int = 200,
        headers: Optional[dict[str, str]] = None,
        json_value: object = None,
    ) -> None:
        self.body = body
        self.status_code = status_code
        self.headers = headers or {"content-length": str(len(body))}
        self._json_value = json_value
        self.closed = False

    def iter_content(self, chunk_size: int = 64 * 1024):
        for index in range(0, len(self.body), chunk_size):
            yield self.body[index : index + chunk_size]

    def json(self):
        if self._json_value is not None:
            return self._json_value
        return json.loads(self.body.decode("utf-8"))

    def close(self) -> None:
        self.closed = True


class FakeHTTPSession:
    def __init__(self, post_result=None, get_result=None) -> None:
        self.post_result = post_result
        self.get_result = get_result
        self.post_calls = 0
        self.get_calls = 0
        self.last_post: Optional[dict] = None
        self.last_get: Optional[dict] = None

    @staticmethod
    def _resolve(value):
        if isinstance(value, BaseException):
            raise value
        if isinstance(value, list):
            if not value:
                raise AssertionError("unexpected extra HTTP call")
            item = value.pop(0)
            if isinstance(item, BaseException):
                raise item
            return item
        return value

    def post(self, url: str, **kwargs):
        self.post_calls += 1
        self.last_post = {"url": url, **kwargs}
        result = self._resolve(self.post_result)
        if result is None:
            raise AssertionError("unexpected HTTP POST")
        return result

    def get(self, url: str, **kwargs):
        self.get_calls += 1
        self.last_get = {"url": url, **kwargs}
        result = self._resolve(self.get_result)
        if result is None:
            raise AssertionError("unexpected HTTP GET")
        return result
