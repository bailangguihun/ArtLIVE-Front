from __future__ import annotations

import ast
import base64
import io
import json
import logging
import sys
import tempfile
import types
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

import requests
from PIL import Image
from pydantic import ValidationError

from my_agent.backend.api.schemas import GenerationRequest
from my_agent.backend.domain.models import MarketingCopy, ProductPosterGroupCommand
from my_agent.backend.integrations.image_reference import encode_product_reference
from my_agent.backend.integrations.seedream_client import (
    ImageGroupResultError,
    ImageProviderError,
    SeedreamClient,
)
from my_agent.backend.main import create_app
from my_agent.backend.prompts.product_poster_group_prompt import (
    build_product_poster_group_prompt,
)
from my_agent.backend.services.generation_service import GenerationService
from my_agent.backend.services.image_generation_service import ImageGenerationService
from my_agent.backend.services.product_poster_group_service import (
    ProductPosterGroupService,
    provider_size_aspect_ratio,
)
from my_agent.backend.storage.artifact_store import ArtifactStore
from my_agent.tests.helpers import (
    FakeCopyClient,
    FakeHTTPResponse,
    FakeHTTPSession,
    FakeSeedreamProvider,
    FakeStockProvider,
    OfflineASGIClient,
    png_bytes,
    settings_for,
)


APP_ROOT = Path(__file__).resolve().parents[1]


class CountingFakeHTTPSession(FakeHTTPSession):
    total_post_calls = 0

    def post(self, url: str, **kwargs):
        type(self).total_post_calls += 1
        return super().post(url, **kwargs)


def json_response(document: object, status_code: int = 200) -> FakeHTTPResponse:
    body = json.dumps(document).encode("utf-8")
    return FakeHTTPResponse(body, status_code=status_code)


def b64_item(
    color: tuple[int, int, int, int], size: tuple[int, int] = (64, 80)
) -> dict[str, str]:
    return {"b64_json": base64.b64encode(png_bytes(size=size, color=color)).decode("ascii")}


def representative_prompt() -> str:
    return build_product_poster_group_prompt(
        product_info=(
            "Tiffany & Co. 蒂芙尼Schlumberger高级珠宝系列"
            "Rainbow Bird on a Rock“石上鸟”胸针"
        ),
        product_short_name="世界上具有代表性的珠宝作品之一",
        creative_note="生成那种很大牌的风格，素材但是高级",
        visual_style="premium",
        generated_marketing_copy="传奇设计与珍罕宝石交相辉映。",
        exact_poster_title="传奇石上鸟",
        exact_headline="跃然璀璨之巅",
        exact_subline="经典珠宝艺术，凝聚非凡光彩",
        output_aspect_ratio="2:3",
        requested_poster_count=3,
    )


def group_command(product_image: bytes | None = None, **overrides) -> ProductPosterGroupCommand:
    values = {
        "product_info": "Synthetic premium product",
        "product_short_name": "Reference product",
        "creative_note": "A precise premium campaign with sculptural light",
        "visual_style": "premium",
        "marketing_copy": MarketingCopy(
            body="Deterministic local campaign copy.",
            title="Exact Title",
            headline="Exact Headline",
            subline="Exact Subline",
        ),
        "product_image": product_image if product_image is not None else png_bytes(),
        "send_product_to_provider": True,
        "requested_poster_count": 3,
        "text_rendering_mode": "provider",
        "generation_mode": "seedream_product_poster_group",
    }
    values.update(overrides)
    return ProductPosterGroupCommand(**values)


class ProductPosterGroupContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.http_block = patch(
            "requests.sessions.Session.request",
            side_effect=AssertionError("external HTTP is blocked"),
        )
        self.http_block.start()

    def tearDown(self) -> None:
        self.http_block.stop()

    @staticmethod
    def valid_schema_payload(**overrides) -> dict:
        payload = {
            "product_info": "Synthetic product",
            "generate_poster": True,
            "generation_mode": "seedream_product_poster_group",
            "send_product_to_provider": True,
            "requested_poster_count": 3,
            "text_rendering_mode": "provider",
        }
        payload.update(overrides)
        return payload

    def test_new_mode_requires_product_image_at_http_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings = settings_for(Path(temporary))
            store = ArtifactStore(settings.artifact_root)
            service = GenerationService(
                FakeCopyClient(),
                ImageGenerationService(
                    FakeSeedreamProvider(configured=False),
                    FakeStockProvider(configured=False),
                ),
                store,
            )
            client = OfflineASGIClient(
                create_app(settings, service, store),
                raise_server_exceptions=False,
            )
            response = client.post(
                "/api/v1/generations",
                data={"payload": json.dumps(self.valid_schema_payload())},
            )
            client.close()
        self.assertEqual(422, response.status_code)
        self.assertEqual("missing_product_image", response.json()["error"]["code"])

    def test_new_mode_requires_explicit_provider_consent(self) -> None:
        request = GenerationRequest.model_validate(
            self.valid_schema_payload(send_product_to_provider=False)
        )
        self.assertFalse(request.send_product_to_provider)

    def test_new_mode_requires_exactly_three_posters(self) -> None:
        for count in (1, 2):
            with self.subTest(count=count):
                request = GenerationRequest.model_validate(
                    self.valid_schema_payload(requested_poster_count=count)
                )
                self.assertNotEqual(3, request.requested_poster_count)
        with self.assertRaises(ValidationError):
            GenerationRequest.model_validate(
                self.valid_schema_payload(requested_poster_count=4)
            )

    def test_new_mode_requires_provider_text_rendering(self) -> None:
        request = GenerationRequest.model_validate(
            self.valid_schema_payload(text_rendering_mode="local")
        )
        self.assertEqual("local", request.text_rendering_mode.value)

    def test_legacy_request_defaults_remain_backward_compatible(self) -> None:
        request = GenerationRequest.model_validate({"product_info": "Legacy product"})
        self.assertEqual("legacy_background_composite", request.generation_mode.value)
        self.assertFalse(request.send_product_to_provider)
        self.assertEqual(3, request.requested_poster_count)
        self.assertEqual("local", request.text_rendering_mode.value)

    def test_product_category_is_not_required_by_group_command_or_prompt(self) -> None:
        request = GenerationRequest.model_validate(self.valid_schema_payload())
        command_fields = ProductPosterGroupCommand.__dataclass_fields__
        prompt_parameters = build_product_poster_group_prompt.__annotations__
        self.assertEqual("bag_heavy", request.product_type.value)
        self.assertNotIn("product_type", command_fields)
        self.assertNotIn("product_category", command_fields)
        self.assertNotIn("product_type", prompt_parameters)
        self.assertNotIn("product_category", prompt_parameters)

    def test_unknown_schema_fields_remain_forbidden(self) -> None:
        with self.assertRaises(ValidationError):
            GenerationRequest.model_validate(
                self.valid_schema_payload(unknown_generation_setting="forbidden")
            )


class ProductPosterGroupPromptTests(unittest.TestCase):
    def test_prompt_contains_complete_three_poster_contract(self) -> None:
        prompt = representative_prompt()
        lowered = prompt.lower()
        self.assertIn("exactly three separate complete vertical advertising poster images", lowered)
        self.assertIn("poster 1 — centered hero composition", lowered)
        self.assertIn("poster 2 — dramatic editorial close-up", lowered)
        self.assertIn("poster 3 — minimal brand-campaign composition", lowered)
        self.assertIn("luxury editorial advertising", lowered)
        self.assertIn("生成那种很大牌的风格，素材但是高级", prompt)
        self.assertIn("Tiffany & Co.", prompt)
        self.assertIn("Title (render exactly and legibly): 传奇石上鸟", prompt)
        self.assertIn("Headline (render exactly and legibly): 跃然璀璨之巅", prompt)
        self.assertIn("Subline (render exactly and legibly): 经典珠宝艺术，凝聚非凡光彩", prompt)
        self.assertNotIn("background only", lowered)
        self.assertNotIn("do not generate any product", lowered)
        self.assertNotIn("warm sunroom", lowered)
        self.assertNotIn("wood tabletop", lowered)
        self.assertNotIn("linen curtains", lowered)
        self.assertNotIn("cotton fluff", lowered)
        self.assertNotIn("green leaves", lowered)
        self.assertNotIn("beige household", lowered)
        self.assertNotIn("category key", lowered)
        self.assertIn("do not combine all three designs into one contact sheet", lowered)
        self.assertIn("do not create a three-panel collage", lowered)
        self.assertIn("do not place three posters inside one generated image", lowered)

    def test_vibrant_style_mapping_is_explicit_and_category_free(self) -> None:
        prompt = build_product_poster_group_prompt(
            product_info="Synthetic product",
            product_short_name="",
            creative_note="High energy launch",
            visual_style="vibrant",
            generated_marketing_copy="Campaign context",
            exact_poster_title="Title",
            exact_headline="Headline",
            exact_subline="Subline",
            output_aspect_ratio="2:3",
            requested_poster_count=3,
        )
        self.assertIn("Bold high-impact advertising", prompt)
        self.assertIn("vivid color contrast", prompt)
        self.assertNotIn("category", prompt.lower())

    def test_prompt_rejects_non_three_count(self) -> None:
        with self.assertRaisesRegex(ValueError, "exactly three"):
            build_product_poster_group_prompt(
                product_info="Synthetic product",
                product_short_name="",
                creative_note="",
                visual_style="premium",
                generated_marketing_copy="Copy",
                exact_poster_title="Title",
                exact_headline="Headline",
                exact_subline="Subline",
                output_aspect_ratio="2:3",
                requested_poster_count=2,
            )


class ProductReferenceEncodingTests(unittest.TestCase):
    def test_encoder_normalizes_to_one_rgb_png_data_uri_with_safe_metadata(self) -> None:
        original = png_bytes(size=(40, 60), transparent_border=True)
        encoded = encode_product_reference(
            original, max_input_bytes=1_000_000, max_pixels=1_000_000
        )
        self.assertTrue(encoded.data_uri.startswith("data:image/png;base64,"))
        self.assertNotIn(encoded.data_uri, repr(encoded))
        decoded = base64.b64decode(encoded.data_uri.split(",", 1)[1], validate=True)
        with Image.open(io.BytesIO(decoded)) as image:
            self.assertEqual("PNG", image.format)
            self.assertEqual("RGB", image.mode)
            self.assertEqual((40, 60), image.size)
        self.assertEqual("image/png", encoded.metadata.normalized_mime_type)
        self.assertEqual(1, encoded.metadata.reference_image_count)
        self.assertEqual(len(original), encoded.metadata.original_byte_length)
        self.assertEqual(len(decoded), encoded.metadata.normalized_byte_length)
        self.assertEqual(64, len(encoded.metadata.normalized_sha256))

    def test_encoder_applies_exif_orientation(self) -> None:
        source = Image.new("RGB", (20, 40), (120, 40, 200))
        exif = Image.Exif()
        exif[274] = 6
        buffer = io.BytesIO()
        source.save(buffer, format="JPEG", exif=exif)
        encoded = encode_product_reference(
            buffer.getvalue(), max_input_bytes=1_000_000, max_pixels=1_000_000
        )
        self.assertEqual((40, 20), (encoded.metadata.normalized_width, encoded.metadata.normalized_height))
        self.assertEqual("image/jpeg", encoded.metadata.original_mime_type)


class ProductPosterGroupSeedreamClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.http_block = patch(
            "requests.sessions.Session.request",
            side_effect=AssertionError("external HTTP is blocked"),
        )
        self.http_block.start()

    def tearDown(self) -> None:
        self.http_block.stop()
        self.temporary.cleanup()

    def client(
        self, session: FakeHTTPSession, *, provider_size: str = "1024x1536"
    ) -> SeedreamClient:
        settings = replace(
            settings_for(self.root, seedream_configured=True),
            seedream_model_id="doubao-seedream-5-0-pro-260628",
            seedream_image_size=provider_size,
        )
        return SeedreamClient(settings, session=session)

    @staticmethod
    def success_items(size: tuple[int, int] = (64, 80)) -> list[dict[str, str]]:
        return [
            b64_item((220, 30, 40, 255), size),
            b64_item((30, 220, 40, 255), size),
            b64_item((30, 40, 220, 255), size),
        ]

    def generate(self, session: FakeHTTPSession, **kwargs):
        return self.client(session, provider_size=kwargs.pop("provider_size", "1024x1536")).generate_product_poster_group(
            prompt=representative_prompt(),
            product_reference=png_bytes(size=(48, 72)),
            requested_count=3,
            sanitized_prompt_metadata={"test": "safe"},
        )

    def test_payload_uses_one_post_one_image_array_and_group_fields(self) -> None:
        session = CountingFakeHTTPSession(
            post_result=json_response({"data": self.success_items()})
        )
        result = self.generate(session)
        payload = json.loads(session.last_post["data"].decode("utf-8"))
        self.assertEqual(1, session.post_calls)
        self.assertEqual(0, session.get_calls)
        self.assertEqual("doubao-seedream-5-0-pro-260628", payload["model"])
        self.assertEqual("1024x1536", payload["size"])
        self.assertIsInstance(payload["image"], list)
        self.assertEqual(1, len(payload["image"]))
        self.assertTrue(payload["image"][0].startswith("data:image/png;base64,"))
        self.assertEqual("auto", payload["sequential_image_generation"])
        self.assertEqual(
            {"max_images": 3}, payload["sequential_image_generation_options"]
        )
        self.assertEqual("url", payload["response_format"])
        self.assertEqual("png", payload["output_format"])
        self.assertFalse(payload["watermark"])
        self.assertTrue(
            {
                "stream",
                "guidance_scale",
                "optimize_prompt_options",
                "seed",
                "tools",
            }.isdisjoint(payload)
        )
        self.assertFalse(session.last_post["allow_redirects"])
        self.assertEqual(3, result.actual_image_count)
        self.assertTrue(result.product_sent_to_provider)
        self.assertFalse(result.local_product_compositing)
        self.assertFalse(result.local_text_rendering)
        self.assertFalse(result.fallback_used)
        self.assertEqual(1, result.reference_image_count)
        self.assertEqual("auto", result.group_generation_mode)

    def test_three_url_results_are_downloaded_and_parsed_in_order(self) -> None:
        urls = [
            "https://images.example.invalid/poster-1.png",
            "https://images.example.invalid/poster-2.png",
            "https://images.example.invalid/poster-3.png",
        ]
        colors = [(210, 20, 30, 255), (20, 210, 30, 255), (20, 30, 210, 255)]
        session = CountingFakeHTTPSession(
            post_result=json_response({"data": [{"url": url} for url in urls]}),
            get_result=[
                FakeHTTPResponse(png_bytes(color=color)) for color in colors
            ],
        )
        result = self.generate(session)
        self.assertEqual(1, session.post_calls)
        self.assertEqual(3, session.get_calls)
        self.assertEqual(3, result.provider_result_download_count)
        self.assertEqual(colors, [image.image.getpixel((0, 0)) for image in result.images])

    def test_three_b64_results_are_parsed_in_order(self) -> None:
        session = CountingFakeHTTPSession(
            post_result=json_response({"data": self.success_items()})
        )
        result = self.generate(session)
        self.assertEqual(0, result.provider_result_download_count)
        pixels = [image.image.getpixel((0, 0)) for image in result.images]
        self.assertEqual(
            [(220, 30, 40, 255), (30, 220, 40, 255), (30, 40, 220, 255)],
            pixels,
        )
        self.assertEqual(3, len({id(image.image) for image in result.images}))

    def test_duplicate_provider_images_are_rejected_not_replicated(self) -> None:
        repeated = b64_item((20, 30, 40, 255))
        session = CountingFakeHTTPSession(
            post_result=json_response({"data": [repeated, repeated, repeated]})
        )
        with self.assertRaises(ImageProviderError) as raised:
            self.generate(session)
        self.assertEqual("duplicate_group_image", raised.exception.category)

    def test_zero_results_raises_typed_provider_result_error(self) -> None:
        session = CountingFakeHTTPSession(post_result=json_response({"data": []}))
        with self.assertRaises(ImageGroupResultError) as raised:
            self.generate(session)
        self.assertEqual("provider_result_error", raised.exception.category)
        self.assertEqual((3, 0), (raised.exception.expected_count, raised.exception.actual_count))

    def test_one_result_raises_incomplete_group_error(self) -> None:
        session = CountingFakeHTTPSession(
            post_result=json_response({"data": [b64_item((1, 2, 3, 255))]})
        )
        with self.assertRaises(ImageGroupResultError) as raised:
            self.generate(session)
        self.assertEqual("incomplete_group", raised.exception.category)
        self.assertEqual(1, raised.exception.actual_count)

    def test_two_results_raise_incomplete_group_without_duplication(self) -> None:
        session = CountingFakeHTTPSession(
            post_result=json_response({"data": self.success_items()[:2]})
        )
        with self.assertRaises(ImageGroupResultError) as raised:
            self.generate(session)
        self.assertEqual("incomplete_group", raised.exception.category)
        self.assertEqual(2, raised.exception.actual_count)
        self.assertEqual(0, session.get_calls)

    def test_more_than_three_results_raise_unexpected_group_size(self) -> None:
        items = self.success_items() + [b64_item((90, 90, 90, 255))]
        session = CountingFakeHTTPSession(post_result=json_response({"data": items}))
        with self.assertRaises(ImageGroupResultError) as raised:
            self.generate(session)
        self.assertEqual("unexpected_group_size", raised.exception.category)
        self.assertEqual(4, raised.exception.actual_count)

    def test_returned_group_dimensions_must_match_each_other(self) -> None:
        items = self.success_items()
        items[2] = b64_item((30, 40, 220, 255), (65, 80))
        session = CountingFakeHTTPSession(post_result=json_response({"data": items}))
        with self.assertRaises(ImageProviderError) as raised:
            self.generate(session)
        self.assertEqual("inconsistent_group_dimensions", raised.exception.category)

    def test_requested_size_match_is_reported_without_cropping(self) -> None:
        session = CountingFakeHTTPSession(
            post_result=json_response(
                {"data": self.success_items(size=(1024, 1536))}
            )
        )
        result = self.generate(session)
        self.assertTrue(result.dimensions_match_requested)
        self.assertEqual([(1024, 1536)] * 3, result.returned_dimensions)
        self.assertEqual("2:3", result.provider_aspect_ratio)

    def test_size_mismatch_is_reported_without_destructive_crop(self) -> None:
        session = CountingFakeHTTPSession(
            post_result=json_response({"data": self.success_items(size=(64, 80))})
        )
        result = self.generate(session)
        self.assertFalse(result.dimensions_match_requested)
        self.assertEqual([(64, 80)] * 3, result.returned_dimensions)
        self.assertEqual((64, 80), result.images[0].image.size)

    def test_timeout_is_not_retried(self) -> None:
        session = CountingFakeHTTPSession(post_result=requests.Timeout("private"))
        with self.assertRaises(ImageProviderError) as raised:
            self.generate(session)
        self.assertEqual("timeout", raised.exception.category)
        self.assertEqual(1, session.post_calls)

    def test_logs_and_group_count_errors_redact_key_base64_and_urls(self) -> None:
        sensitive_url = "https://images.example.invalid/private-result.png?redacted=true"
        session = CountingFakeHTTPSession(
            post_result=json_response(
                {"data": [{"url": sensitive_url}, {"url": sensitive_url}]}
            )
        )
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        root_logger = logging.getLogger()
        root_logger.addHandler(handler)
        try:
            with self.assertRaises(ImageGroupResultError) as raised:
                self.generate(session)
        finally:
            root_logger.removeHandler(handler)
        captured = stream.getvalue()
        combined_error = f"{raised.exception!s} {raised.exception!r}"
        self.assertNotIn("offline-test-key", captured)
        self.assertNotIn("data:image/png;base64,", captured)
        self.assertNotIn(sensitive_url, captured)
        self.assertNotIn(sensitive_url, combined_error)
        self.assertNotIn("Authorization", captured)

    def test_default_transport_retry_count_remains_zero(self) -> None:
        client = SeedreamClient(
            replace(
                settings_for(self.root, seedream_configured=True),
                seedream_model_id="doubao-seedream-5-0-pro-260628",
            )
        )
        adapter = client._session.get_adapter("https://")
        self.assertEqual(0, adapter.max_retries.total)

    def test_tests_need_no_project_dotenv_and_create_no_persistent_poster(self) -> None:
        session = CountingFakeHTTPSession(
            post_result=json_response({"data": self.success_items()})
        )
        result = self.generate(session)
        self.assertEqual(3, len(result.images))
        self.assertFalse(any(self.root.rglob("*.png")))


class ProductPosterGroupIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.http_block = patch(
            "requests.sessions.Session.request",
            side_effect=AssertionError("external HTTP is blocked"),
        )
        self.http_block.start()

    def tearDown(self) -> None:
        self.http_block.stop()
        self.temporary.cleanup()

    def test_group_service_invokes_no_category_or_local_composition_functions(self) -> None:
        session = CountingFakeHTTPSession(
            post_result=json_response(
                {
                    "data": [
                        b64_item((180, 10, 20, 255)),
                        b64_item((10, 180, 20, 255)),
                        b64_item((10, 20, 180, 255)),
                    ]
                }
            )
        )
        client = SeedreamClient(
            replace(
                settings_for(self.root, seedream_configured=True),
                seedream_model_id="doubao-seedream-5-0-pro-260628",
            ),
            session=session,
        )
        category_key = Mock(name="_category_key")
        category_prompt = Mock(name="build_background_scene_prompt")
        cutout = Mock(name="cutout_bytes")
        render = Mock(name="render_poster_variant")
        local_text = Mock(name="local_text_rendering")
        fake_design = types.ModuleType("my_agent.design_guidelines")
        fake_design.build_background_scene_prompt = category_prompt
        fake_poster = types.ModuleType("my_agent.poster_generator")
        fake_poster.cutout_bytes = cutout
        fake_poster.render_poster_variant = render
        fake_text = types.ModuleType("my_agent.text_layouts")
        fake_text.render_text = local_text
        with (
            patch.object(GenerationService, "_category_key", category_key),
            patch.dict(
                sys.modules,
                {
                    "my_agent.design_guidelines": fake_design,
                    "my_agent.poster_generator": fake_poster,
                    "my_agent.text_layouts": fake_text,
                },
            ),
        ):
            result = ProductPosterGroupService(client).generate(group_command())
        self.assertEqual(3, len(result.images))
        self.assertEqual(0, category_key.call_count)
        self.assertEqual(0, category_prompt.call_count)
        self.assertEqual(0, cutout.call_count)
        self.assertEqual(0, render.call_count)
        self.assertEqual(0, local_text.call_count)

    def test_group_service_source_has_no_legacy_routing_or_compositor_imports(self) -> None:
        path = APP_ROOT / "backend" / "services" / "product_poster_group_service.py"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        imported_modules = {
            node.module
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module
        }
        source = path.read_text(encoding="utf-8")
        forbidden_modules = {
            "my_agent.design_guidelines",
            "my_agent.poster_generator",
            "my_agent.layout_engine",
            "my_agent.text_layouts",
        }
        self.assertTrue(forbidden_modules.isdisjoint(imported_modules))
        for symbol in (
            "_category_key",
            "build_background_scene_prompt",
            "catalog_brief_for_llm",
            "cutout_bytes",
            "calculate_product_plan",
            "render_poster_variant",
            "ImageOps.fit",
        ):
            self.assertNotIn(symbol, source)

    def test_group_service_business_contract_validation(self) -> None:
        client = Mock(provider_image_size="1024x1536")
        service = ProductPosterGroupService(client)
        invalid_commands = [
            group_command(product_image=b""),
            group_command(send_product_to_provider=False),
            group_command(requested_poster_count=2),
            group_command(text_rendering_mode="local"),
            group_command(generation_mode="legacy_background_composite"),
        ]
        for command in invalid_commands:
            with self.subTest(command=command), self.assertRaises(ValueError):
                service.generate(command)
        self.assertEqual(0, client.generate_product_poster_group.call_count)

    def test_provider_size_ratio_abstraction(self) -> None:
        self.assertEqual("2:3", provider_size_aspect_ratio("1024x1536"))
        self.assertEqual("3:4", provider_size_aspect_ratio("768x1024"))
        with self.assertRaises(ValueError):
            provider_size_aspect_ratio("unsupported")

    def test_active_streamlit_path_exposes_new_mode_only_behind_capability_gate(self) -> None:
        app_source = (APP_ROOT / "app.py").read_text(encoding="utf-8")
        client_source = (APP_ROOT / "backend_api_client.py").read_text(encoding="utf-8")
        self.assertIn("PRODUCT_POSTER_GROUP_MODE", app_source)
        self.assertIn("group_enabled", app_source)
        self.assertIn("seedream_product_poster_group", client_source)


if __name__ == "__main__":
    unittest.main()
