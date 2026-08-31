from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Optional, Protocol, Tuple

from PIL import Image, ImageOps

from my_agent.backend.domain.models import GeneratedImage
from my_agent.backend.integrations.seedream_client import ImageProviderError


@dataclass
class BackgroundResult:
    image: Image.Image
    source: str
    fallback_used: bool
    error_category: Optional[str] = None
    diagnostic: Optional[str] = None


@dataclass(eq=False)
class BackgroundGenerationError(Exception):
    """Safe terminal failure for a requested remote background."""

    category: str
    safe_message: str

    def __str__(self) -> str:
        return self.safe_message

    def __repr__(self) -> str:
        return f"BackgroundGenerationError(category={self.category!r})"


class BackgroundProvider(Protocol):
    @property
    def configured(self) -> bool: ...

    def generate_background(
        self, prompt: str, reference_image: Optional[bytes] = None
    ) -> GeneratedImage: ...


class StockBackgroundProvider:
    @property
    def configured(self) -> bool:
        from my_agent.stock_client import stock_configured

        return stock_configured()

    def fetch(self, query: str) -> Optional[Image.Image]:
        if not self.configured:
            return None
        from my_agent.stock_client import download_image, search_first_stock

        hit = search_first_stock(
            [query[:100]],
            orientation="portrait",
            allow_floral=True,
            allow_nature_bg=True,
            user_raw=query[:200],
        )
        if not hit:
            return None
        remote_location = hit.get("regular") or hit.get("full")
        if not remote_location:
            return None
        data = download_image(str(remote_location))
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            return image.convert("RGBA")


class ImageGenerationService:
    def __init__(
        self,
        provider: BackgroundProvider,
        stock_provider: Optional[StockBackgroundProvider] = None,
    ):
        self.provider = provider
        self.stock_provider = stock_provider or StockBackgroundProvider()

    @property
    def seedream_configured(self) -> bool:
        return bool(self.provider.configured)

    @property
    def stock_configured(self) -> bool:
        return bool(self.stock_provider.configured)

    @staticmethod
    def _fit(image: Image.Image, size: Tuple[int, int]) -> Image.Image:
        return ImageOps.fit(
            image.convert("RGBA"),
            size,
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.5),
        )

    @staticmethod
    def _procedural(
        size: Tuple[int, int], visual_style: str, creative_note: str, variant: int = 0
    ) -> Image.Image:
        from my_agent.poster_generator import create_procedural_background

        return create_procedural_background(
            width=size[0],
            height=size[1],
            visual_style=visual_style,
            creative_note=creative_note,
            variant=variant,
        )

    def _stock(self, query: str, size: Tuple[int, int]) -> Optional[Image.Image]:
        try:
            value = self.stock_provider.fetch(query)
        except Exception:
            return None
        return self._fit(value, size) if value is not None else None

    def acquire(
        self,
        mode: str,
        prompt: str,
        stock_query: str,
        size: Tuple[int, int],
        visual_style: str,
        creative_note: str,
        reference_image: Optional[bytes] = None,
    ) -> BackgroundResult:
        if mode not in {"seedream_text", "seedream_reference", "stock", "procedural"}:
            raise ValueError("unsupported background mode")
        if mode == "seedream_reference" and reference_image is None:
            raise ValueError("background reference required")
        if mode == "procedural":
            return BackgroundResult(
                image=self._procedural(size, visual_style, creative_note),
                source="procedural",
                fallback_used=False,
            )

        if mode == "stock":
            stock = self._stock(stock_query, size)
            if stock is not None:
                return BackgroundResult(stock, "stock", False)
            return BackgroundResult(
                image=self._procedural(size, visual_style, creative_note),
                source="procedural",
                fallback_used=True,
                error_category="stock_unavailable",
                diagnostic="素材库未返回可用背景。",
            )

        try:
            generated = self.provider.generate_background(
                prompt,
                reference_image=reference_image if mode == "seedream_reference" else None,
            )
            return BackgroundResult(
                image=self._fit(generated.image, size),
                source="seedream",
                fallback_used=False,
            )
        except ImageProviderError as exc:
            raise BackgroundGenerationError(
                category=exc.category,
                safe_message=exc.safe_message,
            ) from exc
