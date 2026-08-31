from __future__ import annotations

import base64
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from PIL import Image

from my_agent.backend.domain.models import GenerationCommand
from my_agent.backend.integrations.seedream_client import (
    ImageProviderError,
    SeedreamClient,
)
from my_agent.backend.services.generation_service import GenerationService
from my_agent.backend.services.image_generation_service import ImageGenerationService
from my_agent.backend.storage.artifact_store import ArtifactStore
from my_agent.tests.helpers import (
    FakeCopyClient,
    FakeHTTPResponse,
    FakeHTTPSession,
    FakeStockProvider,
    png_bytes,
    settings_for,
)


def json_response(value: object, status_code: int = 200) -> FakeHTTPResponse:
    data = json.dumps(value).encode("utf-8")
    return FakeHTTPResponse(data, status_code=status_code)


class SeedreamClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def client(self, session: FakeHTTPSession, configured: bool = True) -> SeedreamClient:
        return SeedreamClient(
            settings_for(self.root, seedream_configured=configured), session=session
        )

    def assert_category(self, expected: str, callback) -> ImageProviderError:
        with self.assertRaises(ImageProviderError) as captured:
            callback()
        self.assertEqual(expected, captured.exception.category)
        self.assertNotIn("offline-test-key", str(captured.exception))
        self.assertNotIn("https://", str(captured.exception))
        return captured.exception

    def test_missing_configuration_makes_zero_http_calls(self) -> None:
        session = FakeHTTPSession()
        self.assert_category(
            "not_configured",
            lambda: self.client(session, configured=False).generate_background("prompt"),
        )
        self.assertEqual(0, session.post_calls)
        self.assertEqual(0, session.get_calls)

    def test_text_generation_accepts_https_url_and_returns_rgba(self) -> None:
        session = FakeHTTPSession(
            post_result=json_response(
                {"data": [{"url": "https://result.invalid/generated.png"}]}
            ),
            get_result=FakeHTTPResponse(png_bytes(size=(72, 96))),
        )
        result = self.client(session).generate_background("background only")
        self.assertEqual("RGBA", result.image.mode)
        self.assertEqual((72, 96), result.image.size)
        self.assertEqual(1, session.post_calls)
        self.assertEqual(1, session.get_calls)
        payload = json.loads(session.last_post["data"].decode("utf-8"))
        self.assertEqual("1024x1536", payload["size"])
        self.assertEqual("url", payload["response_format"])
        self.assertEqual("png", payload["output_format"])
        self.assertFalse(payload["watermark"])
        self.assertNotIn("image", payload)
        self.assertFalse(session.last_post["allow_redirects"])
        self.assertTrue(
            {"sequential_image_generation", "sequential_image_generation_options", "stream"}.isdisjoint(payload)
        )

    def test_reference_generation_sends_only_explicit_reference(self) -> None:
        reference = png_bytes(size=(30, 40), color=(10, 90, 160, 255))
        session = FakeHTTPSession(
            post_result=json_response(
                {"data": [{"url": "https://result.invalid/reference.png"}]}
            ),
            get_result=FakeHTTPResponse(png_bytes()),
        )
        self.client(session).generate_background("background only", reference)
        payload = json.loads(session.last_post["data"].decode("utf-8"))
        self.assertEqual(
            {"model", "prompt", "size", "response_format", "output_format", "watermark", "image"},
            set(payload),
        )
        self.assertTrue(payload["image"].startswith("data:image/png;base64,"))
        self.assertNotIn("product_image", payload)

    def test_b64_json_response_is_supported(self) -> None:
        encoded = base64.b64encode(png_bytes(size=(64, 80))).decode("ascii")
        session = FakeHTTPSession(
            post_result=json_response({"data": [{"b64_json": encoded}]})
        )
        result = self.client(session).generate_background("background only")
        self.assertEqual((64, 80), result.image.size)
        self.assertEqual(1, session.post_calls)
        self.assertEqual(0, session.get_calls)

    def test_timeout_is_safe_and_not_retried(self) -> None:
        session = FakeHTTPSession(post_result=requests.Timeout("private detail"))
        self.assert_category(
            "timeout", lambda: self.client(session).generate_background("prompt")
        )
        self.assertEqual(1, session.post_calls)

    def test_http_statuses_map_to_safe_categories_without_retry(self) -> None:
        cases = {
            401: "unauthorized",
            403: "forbidden",
            429: "rate_limited",
            500: "server_error",
        }
        for status_code, category in cases.items():
            with self.subTest(status_code=status_code):
                session = FakeHTTPSession(
                    post_result=FakeHTTPResponse(b"private body", status_code=status_code)
                )
                self.assert_category(
                    category,
                    lambda session=session: self.client(session).generate_background(
                        "prompt"
                    ),
                )
                self.assertEqual(1, session.post_calls)

    def test_malformed_json_is_rejected(self) -> None:
        session = FakeHTTPSession(post_result=FakeHTTPResponse(b"not-json"))
        self.assert_category(
            "invalid_response",
            lambda: self.client(session).generate_background("prompt"),
        )

    def test_missing_data_field_is_rejected(self) -> None:
        session = FakeHTTPSession(post_result=json_response({"data": []}))
        self.assert_category(
            "invalid_response",
            lambda: self.client(session).generate_background("prompt"),
        )

    def test_invalid_base64_is_rejected(self) -> None:
        session = FakeHTTPSession(
            post_result=json_response({"data": [{"b64_json": "not-valid-%%%"}]})
        )
        self.assert_category(
            "invalid_response",
            lambda: self.client(session).generate_background("prompt"),
        )

    def test_invalid_image_bytes_are_rejected(self) -> None:
        encoded = base64.b64encode(b"not-an-image").decode("ascii")
        session = FakeHTTPSession(
            post_result=json_response({"data": [{"b64_json": encoded}]})
        )
        self.assert_category(
            "invalid_image",
            lambda: self.client(session).generate_background("prompt"),
        )

    def test_non_https_result_url_is_rejected_without_download(self) -> None:
        session = FakeHTTPSession(
            post_result=json_response(
                {"data": [{"url": "http://result.invalid/generated.png"}]}
            )
        )
        self.assert_category(
            "invalid_response",
            lambda: self.client(session).generate_background("prompt"),
        )
        self.assertEqual(0, session.get_calls)

    def test_oversized_image_download_is_rejected(self) -> None:
        session = FakeHTTPSession(
            post_result=json_response(
                {"data": [{"url": "https://result.invalid/generated.png"}]}
            ),
            get_result=FakeHTTPResponse(
                b"x",
                headers={"content-length": str(3 * 1024 * 1024)},
            ),
        )
        self.assert_category(
            "invalid_response",
            lambda: self.client(session).generate_background("prompt"),
        )

    def test_network_error_is_safe_and_not_retried(self) -> None:
        session = FakeHTTPSession(
            post_result=requests.ConnectionError("private network detail")
        )
        self.assert_category(
            "network_error",
            lambda: self.client(session).generate_background("prompt"),
        )
        self.assertEqual(1, session.post_calls)

    def test_repr_redacts_configuration(self) -> None:
        client = self.client(FakeHTTPSession())
        rendered = repr(client)
        self.assertIn("configured=True", rendered)
        self.assertNotIn("offline-test-key", rendered)
        self.assertNotIn("offline-test-model", rendered)

    def test_default_requests_session_has_retries_disabled(self) -> None:
        client = SeedreamClient(settings_for(self.root, seedream_configured=True))
        adapter = client._session.get_adapter(
            "https://ark.cn-beijing.volces.com/api/v3/images/generations"
        )
        self.assertEqual(0, adapter.max_retries.total)

    def test_active_business_flow_posts_once_and_keeps_product_local(self) -> None:
        generated_background = png_bytes(
            size=(96, 144), color=(30, 80, 150, 255)
        )
        session = FakeHTTPSession(
            post_result=json_response(
                {
                    "data": [
                        {
                            "b64_json": base64.b64encode(
                                generated_background
                            ).decode("ascii")
                        }
                    ]
                }
            )
        )
        provider = self.client(session)
        store = ArtifactStore(self.root / "flow-artifacts")
        service = GenerationService(
            FakeCopyClient(),
            ImageGenerationService(
                provider, FakeStockProvider(image=None, configured=False)
            ),
            store,
        )
        product = png_bytes(
            size=(48, 72), color=(220, 30, 50, 255), transparent_border=True
        )
        reference = png_bytes(
            size=(48, 72), color=(20, 160, 210, 255)
        )
        command = GenerationCommand(
            product_info="Synthetic offline product",
            product_short_name="Synthetic",
            creative_note="Clean background",
            visual_style="vibrant",
            generate_poster=True,
            background_mode="seedream_reference",
            output_size="512x768",
            product_type="flat_small",
            product_image=product,
            background_reference=reference,
        )
        with patch.dict(
            "my_agent.backend.services.generation_service.OUTPUT_SIZES",
            {"512x768": (144, 216)},
            clear=False,
        ):
            result = service.generate(command, "offline-request")

        self.assertEqual(1, session.post_calls)
        self.assertEqual(0, session.get_calls)
        self.assertEqual(3, len(result.posters))
        payload = json.loads(session.last_post["data"].decode("utf-8"))
        self.assertEqual("1024x1536", payload["size"])
        self.assertFalse(payload["watermark"])
        self.assertEqual("png", payload["output_format"])
        self.assertEqual("url", payload["response_format"])
        self.assertTrue(
            {
                "sequential_image_generation",
                "sequential_image_generation_options",
                "stream",
                "product_image",
            }.isdisjoint(payload)
        )
        reference_data = base64.b64decode(payload["image"].split(",", 1)[1])
        with Image.open(io.BytesIO(reference_data)) as decoded_reference:
            decoded_reference.load()
            self.assertEqual((20, 160, 210), decoded_reference.convert("RGB").getpixel((24, 36)))
        manifest = store.read_manifest(result.generation_id)
        self.assertTrue(
            all(item["final_local_product_paste"] for item in manifest["posters"])
        )
        self.assertTrue(
            all(item["local_text_rendering"] for item in manifest["posters"])
        )
        self.assertFalse(
            any(item["product_sent_to_provider"] for item in manifest["posters"])
        )
        serialized = json.dumps(result.to_dict())
        self.assertNotIn("base64", serialized.lower())
        self.assertNotIn("authorization", serialized.lower())
        self.assertNotIn(str(self.root.resolve()), serialized)


if __name__ == "__main__":
    unittest.main()
