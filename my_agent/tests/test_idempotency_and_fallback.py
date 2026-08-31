from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from my_agent.backend.domain.models import GenerationCommand
from my_agent.backend.main import create_app
from my_agent.backend.services.generation_service import (
    GenerationService,
    IdempotencyRegistry,
)
from my_agent.backend.services.image_generation_service import (
    BackgroundGenerationError,
    ImageGenerationService,
)
from my_agent.backend.storage.artifact_store import ArtifactStore
from my_agent.tests.helpers import (
    FakeCopyClient,
    FakeSeedreamProvider,
    FakeStockProvider,
    OfflineASGIClient,
    png_bytes,
    settings_for,
)


def poster_payload(product_info: str = "Product") -> dict:
    return {
        "product_info": product_info,
        "product_short_name": "Product",
        "creative_note": "Clean vertical advertising background",
        "visual_style": "vibrant",
        "generate_poster": True,
        "background_mode": "seedream_text",
        "output_size": "512x768",
        "product_type": "bag_heavy",
    }


class IdempotencyAndFallbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.settings = settings_for(self.root, seedream_configured=True)
        self.store = ArtifactStore(self.settings.artifact_root)
        self.provider = FakeSeedreamProvider(configured=True)
        self.stock = FakeStockProvider(
            image=Image.new("RGBA", (90, 120), (40, 160, 90, 255))
        )
        self.image_service = ImageGenerationService(self.provider, self.stock)
        self.service = GenerationService(
            FakeCopyClient(), self.image_service, self.store
        )
        self.client = OfflineASGIClient(
            create_app(self.settings, self.service, self.store),
            raise_server_exceptions=False,
        )
        self.http_block = patch(
            "requests.sessions.Session.request",
            side_effect=AssertionError("external HTTP is blocked"),
        )
        self.http_block.start()

    def tearDown(self) -> None:
        self.http_block.stop()
        self.client.close()
        self.temporary.cleanup()

    def _post(self, key: str, payload: dict, product: bytes | None = None):
        files = None
        if product is not None:
            files = {"product_image": ("ignored.png", product, "image/png")}
        return self.client.post(
            "/api/v1/generations",
            data={"payload": json.dumps(payload)},
            files=files,
            headers={"X-Idempotency-Key": key},
        )

    def test_same_key_and_request_calls_seedream_once(self) -> None:
        key = str(uuid.uuid4())
        product = png_bytes(transparent_border=True)
        with patch.dict(
            "my_agent.backend.services.generation_service.OUTPUT_SIZES",
            {"512x768": (132, 176)},
            clear=False,
        ):
            first = self._post(key, poster_payload(), product)
            second = self._post(key, poster_payload(), product)
        self.assertEqual(200, first.status_code, first.text)
        self.assertEqual(200, second.status_code, second.text)
        self.assertEqual(first.json()["generation_id"], second.json()["generation_id"])
        self.assertEqual(1, self.provider.calls)

    def test_same_key_with_different_request_returns_conflict(self) -> None:
        key = str(uuid.uuid4())
        first = self._post(
            key,
            {**poster_payload("First"), "generate_poster": False},
        )
        second = self._post(
            key,
            {**poster_payload("Different"), "generate_poster": False},
        )
        self.assertEqual(200, first.status_code)
        self.assertEqual(409, second.status_code)
        self.assertEqual("idempotency_conflict", second.json()["error"]["code"])

    def test_simultaneous_same_key_executes_callback_once(self) -> None:
        registry = IdempotencyRegistry()
        callback_count = 0
        count_lock = threading.Lock()
        results = []

        def callback():
            nonlocal callback_count
            with count_lock:
                callback_count += 1
            time.sleep(0.05)
            return "same-result"

        def worker():
            results.append(registry.execute("same-key", "same-fingerprint", callback))

        threads = [threading.Thread(target=worker) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2)
        self.assertEqual(1, callback_count)
        self.assertEqual(["same-result"] * 4, results)

    def test_seedream_failure_categories_are_terminal_without_fallback(self) -> None:
        for category in (
            "not_configured",
            "timeout",
            "unauthorized",
            "forbidden",
            "rate_limited",
            "server_error",
            "invalid_response",
            "invalid_image",
            "network_error",
        ):
            with self.subTest(category=category):
                provider = FakeSeedreamProvider(error_category=category)
                stock = FakeStockProvider(Image.new("RGBA", (60, 80), "green"))
                with self.assertRaises(BackgroundGenerationError) as captured:
                    ImageGenerationService(provider, stock).acquire(
                        "seedream_text",
                        "background only",
                        "stock query",
                        (120, 160),
                        "vibrant",
                        "",
                    )
                self.assertEqual(category, captured.exception.category)
                self.assertEqual(1, provider.calls)
                self.assertEqual(0, stock.calls)

    def test_seedream_reference_failure_does_not_use_reference_or_stock_fallback(self) -> None:
        provider = FakeSeedreamProvider(error_category="rate_limited")
        stock = FakeStockProvider(Image.new("RGBA", (60, 80), "green"))
        reference = png_bytes(size=(48, 64), color=(20, 30, 180, 255))
        with self.assertRaises(BackgroundGenerationError) as captured:
            ImageGenerationService(provider, stock).acquire(
                "seedream_reference",
                "background only",
                "stock query",
                (120, 160),
                "vibrant",
                "",
                reference_image=reference,
            )
        self.assertEqual("rate_limited", captured.exception.category)
        self.assertEqual(0, stock.calls)
        self.assertEqual(reference, provider.references[0])

    def test_seedream_timeout_returns_safe_api_error_without_fallback(self) -> None:
        provider = FakeSeedreamProvider(error_category="timeout")
        stock = FakeStockProvider(Image.new("RGBA", (60, 80), "green"))
        store = ArtifactStore(self.root / "terminal-failure-artifacts")
        service = GenerationService(
            FakeCopyClient(), ImageGenerationService(provider, stock), store
        )
        client = OfflineASGIClient(
            create_app(self.settings, service, store),
            raise_server_exceptions=False,
        )
        try:
            response = client.post(
                "/api/v1/generations",
                data={"payload": json.dumps(poster_payload())},
                files={
                    "product_image": (
                        "ignored.png",
                        png_bytes(transparent_border=True),
                        "image/png",
                    )
                },
                headers={"X-Idempotency-Key": str(uuid.uuid4())},
            )
        finally:
            client.close()
        self.assertEqual(504, response.status_code)
        self.assertEqual("seedream_timeout", response.json()["error"]["code"])
        self.assertEqual(1, provider.calls)
        self.assertEqual(0, stock.calls)

    def test_stock_mode_makes_zero_seedream_calls(self) -> None:
        result = self.image_service.acquire(
            "stock", "unused", "query", (120, 160), "vibrant", ""
        )
        self.assertEqual("stock", result.source)
        self.assertEqual(0, self.provider.calls)

    def test_procedural_mode_makes_zero_remote_calls(self) -> None:
        result = self.image_service.acquire(
            "procedural", "unused", "unused", (120, 160), "premium", ""
        )
        self.assertEqual("procedural", result.source)
        self.assertEqual(0, self.provider.calls)
        self.assertEqual(0, self.stock.calls)

    def test_copy_only_makes_zero_image_service_calls(self) -> None:
        command = GenerationCommand(
            product_info="Copy only",
            product_short_name="Copy",
            creative_note="",
            visual_style="premium",
            generate_poster=False,
            background_mode="seedream_text",
            output_size="768x1024",
            product_type="bag_heavy",
        )
        result = self.service.generate(command, "offline-request")
        self.assertEqual([], result.posters)
        self.assertEqual(0, self.provider.calls)
        self.assertEqual(0, self.stock.calls)

    def test_service_validates_business_enums_without_fastapi(self) -> None:
        command = GenerationCommand(
            product_info="Invalid mode",
            product_short_name="Invalid",
            creative_note="",
            visual_style="vibrant",
            generate_poster=False,
            background_mode="unsupported",
            output_size="768x1024",
            product_type="bag_heavy",
        )
        with self.assertRaises(ValueError):
            self.service.generate(command, "offline-request")
        self.assertEqual(0, self.provider.calls)
        self.assertEqual(0, self.stock.calls)


if __name__ == "__main__":
    unittest.main()
