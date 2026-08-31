from __future__ import annotations

import asyncio
import hashlib
import json
import socket
import tempfile
import unittest
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import httpx

from my_agent.backend.api.routes import _fingerprint
from my_agent.backend.api.schemas import (
    GenerationRequest,
    MarketingAdviceRequest,
    MarketingAdviceResponse,
)
from my_agent.backend.main import create_app
from my_agent.backend.services.generation_service import GenerationService
from my_agent.backend.services.image_generation_service import ImageGenerationService
from my_agent.backend.services.marketing_advice_service import (
    MarketingAdviceService,
    canonical_json,
    normalize_marketing_advice_request,
)
from my_agent.backend.storage.artifact_store import ArtifactStore
from my_agent.backend.integrations.marketing_advice_classifier import (
    classify_product_category_smart,
)
from my_agent.marketing_strategy_catalog import classify_product_category
from my_agent.tests.helpers import OfflineASGIClient, settings_for


ENDPOINT = "/api/v1/marketing-advice"
BASELINE_OPENAPI_PATH_HASHES = {
    "/api/v1/capabilities": "c39762cede1f940c2e03884943f0d5a9663f27e665c8efd0265d94775eb4d257",
    "/api/v1/generations": "9cc687a76ffd3cce4213bab303cf62d73e6fa0b68744c4691720fb154973afae",
    "/api/v1/generations/{generation_id}": "c69ca40105883288a70137693d2361dd2f147999b7225307793ae08046c95d94",
    "/api/v1/generations/{generation_id}/download": "a862c54d099c24a239baaf9ab36c77532afbf5d63c18f64eb50fd1819bb880d0",
    "/api/v1/generations/{generation_id}/posters/{poster_id}": "879351a9bbc2134dab6ccd588d5269eacf80a40cc75da091855c1c6ea222d105",
    "/api/v1/generations/{generation_id}/posters/{poster_id}/download": "06cf2b88d063a1cccd8225ab6706021c26a6c144e5db8d19c6c86d0cae65f3b1",
    "/api/v1/health": "03667ea883378deee51244d598f5f5b9ae81eaccc1812de7fa62a866da9544bb",
    "/api/v1/tools/cutout": "78ca97a601accef1063608393862ad7df39cc2d0fef756870514524db7a79f40",
}
BASELINE_OPENAPI_SCHEMA_HASHES = {
    "Body_create_generation_api_v1_generations_post": "3826db082475b6fc6a997dd830b00398e80f2d259216f804e8c13bbf8ae5bc9f",
    "Body_cutout_product_image_api_v1_tools_cutout_post": "143d281b1dc1092848cee82505b483d5c214d96c0bbf2105ec280c78a6b8add6",
    "CapabilitiesResponse": "a71561c7084c758b31e8a6132d2190161d4ad739098240c0e4506e849a0b7dba",
    "CapabilityOption": "b23d3b7a32f2d2e3a3ada038e3b90f1becbc8570f59eefc5f66ef3fc476b93df",
    "GenerationMode": "774e6cd08c1a403574ec5d6fabf16f769a4290aedf534609155490e92697250c",
    "GenerationModeCapability": "9dd642737881ad12a84a896de14e06a225b43e40906ed81d2acdd7aef207d1b6",
    "GenerationResponse": "d0169ddeaa8d8cfa65003bbfe1344c96cef8d82324fa6bf2630a5cc1581ac069",
    "HTTPValidationError": "7373c21f1389312367e27e440140ba11d587693c56d8aa27249b36d3f58c10c6",
    "HealthResponse": "6cfa27e7794fb2247cc64d565a0b0b89f0e1bfb713871fd1009d018c962aac23",
    "MarketingCopyResponse": "c91a522c16085bcc98f8d684125dbaa987520d52a9e30f915ccdd391bdaa9789",
    "PosterResponse": "f6acdd5c5d33aee2cafa08c9832f2d908236a15bcec2b0140d76b4c128d352d9",
    "ValidationError": "ca285d0c0e64c42844efd2e860edb239e77cc49d87f065c5ccb7d2f55331b862",
}


def _canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _artifact_tree(root: Path) -> tuple[tuple[object, ...], ...]:
    entries = []
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        relative = path.relative_to(root).as_posix()
        if path.is_dir():
            entries.append(("directory", relative))
        else:
            entries.append(
                (
                    "file",
                    relative,
                    path.stat().st_size,
                    hashlib.sha256(path.read_bytes()).hexdigest(),
                )
            )
    return tuple(entries)


class ForbiddenCopyClient:
    def __init__(self) -> None:
        self.calls = 0

    def generate_marketing_copy(self, *args, **kwargs):
        _ = (args, kwargs)
        self.calls += 1
        raise AssertionError("DeepSeek/copy generation must not be called")

    def generate_marketing_copy_variants(self, *args, **kwargs):
        _ = (args, kwargs)
        self.calls += 1
        raise AssertionError("DeepSeek/copy generation must not be called")


class ForbiddenSeedreamProvider:
    def __init__(self) -> None:
        self.calls = 0

    @property
    def configured(self) -> bool:
        return False

    def generate_background(self, *args, **kwargs):
        _ = (args, kwargs)
        self.calls += 1
        raise AssertionError("Seedream must not be called")


class ForbiddenStockProvider:
    def __init__(self) -> None:
        self.calls = 0

    @property
    def configured(self) -> bool:
        return False

    def fetch(self, *args, **kwargs):
        _ = (args, kwargs)
        self.calls += 1
        raise AssertionError("stock providers must not be called")


class MarketingAdviceServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.settings = settings_for(Path(self.temporary.name))
        self.service = MarketingAdviceService(self.settings)

    @staticmethod
    def request(**changes: str) -> MarketingAdviceRequest:
        values = {
            "product_info": "API productivity suite",
            "product_short_name": "Cloud Kit",
            "creative_note": "For small teams",
        }
        values.update(changes)
        return MarketingAdviceRequest.model_validate(values)

    def test_service_normalizes_and_calls_existing_classifier_exactly_once(self) -> None:
        request = self.request(
            product_info="  API productivity suite  ",
            product_short_name="\tCloud Kit\n",
            creative_note="\r\nFor small teams\t",
        )
        with patch(
            "my_agent.backend.services.marketing_advice_service.classify_product_category_smart",
            wraps=classify_product_category_smart,
        ) as classifier:
            response = self.service.create(request)

        classifier.assert_called_once_with(
            settings=self.settings,
            product_info="API productivity suite",
            product_short_name="Cloud Kit",
            creative_note="For small teams",
        )
        self.assertEqual("digital", response.advice.category_id)
        self.assertEqual("present", response.status)

    def test_repeated_and_concurrent_identical_service_calls_are_equal(self) -> None:
        request = self.request()
        expected = self.service.create(request).model_dump(mode="json")
        repeated = self.service.create(request).model_dump(mode="json")
        self.assertEqual(expected, repeated)

        with ThreadPoolExecutor(max_workers=8) as executor:
            concurrent = list(
                executor.map(
                    lambda _: self.service.create(request).model_dump(mode="json"),
                    range(32),
                )
            )
        self.assertTrue(all(item == expected for item in concurrent))

    def test_changing_each_consumed_field_changes_the_input_signature(self) -> None:
        base = self.service.create(self.request()).input_signature_sha256
        variants = {
            "product_info": self.request(product_info="API productivity suite plus"),
            "product_short_name": self.request(product_short_name="Cloud Kit Plus"),
            "creative_note": self.request(creative_note="For growing teams"),
        }
        for field, request in variants.items():
            with self.subTest(field=field):
                self.assertNotEqual(
                    base, self.service.create(request).input_signature_sha256
                )

    def test_known_classifier_keywords_keep_the_catalogue_categories(self) -> None:
        cases = {
            "\u6d17\u8863\u6db2": "fmcg",
            "\u51b0\u7bb1": "durable",
            "\u4fdd\u6d01": "service",
            "API": "digital",
            "\u73e0\u5b9d": "luxury",
            "ERP": "b2b",
            "\u4f53\u68c0": "health",
        }
        for keyword, expected in cases.items():
            with self.subTest(keyword=keyword):
                response = self.service.create(
                    MarketingAdviceRequest(product_info=keyword)
                )
                self.assertEqual(expected, response.advice.category_id)

    def test_unknown_text_keeps_successful_low_confidence_fmcg_fallback(self) -> None:
        response = self.service.create(
            MarketingAdviceRequest(product_info="quasar object 947")
        )
        self.assertEqual("present", response.status)
        self.assertEqual("fmcg", response.advice.category_id)
        self.assertEqual("未明确品类", response.advice.category_name)
        self.assertEqual("low", response.advice.confidence)
        self.assertEqual(0, response.advice.score)
        self.assertEqual([], response.advice.matched_keywords)
        self.assertIn("未识别到明确品类关键词", response.advice.reason)

    def test_unicode_golden_signature_and_no_unicode_composition_change(self) -> None:
        request = MarketingAdviceRequest(
            product_info=(
                "\u3000\u5c71\u8336\u82b1\u6d17\u8863\u6db2\uff0c"
                "\u5b88\u62a4\u67d4\u8f6f\U0001f455\u3000"
            ),
            product_short_name="\u00a0\u67d4\u62a4\u8863\u00a0",
            creative_note="  \u8f7b\u76c8\u9999\u6c1b \u00b7 \u590f\u65e5\u9650\u5b9a  ",
        )
        response = self.service.create(request)
        self.assertEqual(
            "1f263ed9cb0d06b73bf4d1e12382406f0483682630a2ee470ca0ac4948decbc3",
            response.input_signature_sha256,
        )
        self.assertEqual(
            "7e6e4edeb65d1735380720188544aace7ee9b0e321f3c50ac2f42034053244d6",
            response.advice_signature_sha256,
        )
        self.assertEqual(
            ["\u6d17\u8863\u6db2", "\u67d4\u62a4\u8863"],
            response.advice.matched_keywords,
        )

        composed = self.service.create(self.request(product_info="Caf\u00e9 API"))
        decomposed = self.service.create(self.request(product_info="Cafe\u0301 API"))
        self.assertNotEqual(
            composed.input_signature_sha256, decomposed.input_signature_sha256
        )

    def test_whitespace_and_line_break_golden_vectors(self) -> None:
        crlf_request = MarketingAdviceRequest(
            product_info="\t  API \u5de5\u5177\r\n\u4e13\u4e1a\u7248  \n",
            product_short_name="  \u4e91\u7aef\u5957\u4ef6  ",
            creative_note="\r\n\u9996\u884c\r\n  \u6b21\u884c\t ",
        )
        normalized = normalize_marketing_advice_request(crlf_request)
        self.assertEqual(
            {
                "product_info": "API \u5de5\u5177\r\n\u4e13\u4e1a\u7248",
                "product_short_name": "\u4e91\u7aef\u5957\u4ef6",
                "creative_note": "\u9996\u884c\r\n  \u6b21\u884c",
            },
            normalized,
        )
        crlf = self.service.create(crlf_request)
        self.assertEqual(
            "26769b8f29c3d147476cb86d7e180df4717c4cde46f60235fef0ba117f46a849",
            crlf.input_signature_sha256,
        )
        self.assertEqual(
            "a30e19473cbf0a6266b23d59df7be79a399b64e5214c17ef3eaab8df676aad6c",
            crlf.advice_signature_sha256,
        )

        lf = self.service.create(
            MarketingAdviceRequest(
                product_info="API \u5de5\u5177\n\u4e13\u4e1a\u7248",
                product_short_name="\u4e91\u7aef\u5957\u4ef6",
                creative_note="\u9996\u884c\n  \u6b21\u884c",
            )
        )
        self.assertEqual(
            "bc6dbb26520803da8f98e1f70a2746caf9668e260471c3f916af0483176a1d14",
            lf.input_signature_sha256,
        )
        self.assertNotEqual(crlf.input_signature_sha256, lf.input_signature_sha256)
        self.assertEqual(crlf.advice_signature_sha256, lf.advice_signature_sha256)

    def test_edge_whitespace_is_normalized_but_interior_whitespace_is_preserved(self) -> None:
        plain = self.service.create(self.request(product_info="API suite"))
        edge_padded = self.service.create(
            self.request(product_info="\u3000\tAPI suite\r\n")
        )
        interior_changed = self.service.create(
            self.request(product_info="API  suite")
        )
        self.assertEqual(
            plain.input_signature_sha256, edge_padded.input_signature_sha256
        )
        self.assertNotEqual(
            plain.input_signature_sha256, interior_changed.input_signature_sha256
        )

    def test_canonical_json_rejects_non_finite_numbers(self) -> None:
        with self.assertRaises(ValueError):
            canonical_json({"not_finite": float("nan")})


class MarketingAdviceAPIContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.settings = settings_for(root)
        self.store = ArtifactStore(self.settings.artifact_root)
        self.copy = ForbiddenCopyClient()
        self.seedream = ForbiddenSeedreamProvider()
        self.stock = ForbiddenStockProvider()
        image_service = ImageGenerationService(self.seedream, self.stock)
        self.generation_service = GenerationService(
            self.copy, image_service, self.store
        )
        self.app = create_app(
            self.settings, self.generation_service, self.store
        )
        self.client = OfflineASGIClient(self.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

        self.external_guards = self._start_guards(
            {
                "requests": "requests.sessions.Session.request",
                "urllib": "urllib.request.urlopen",
                "socket_create_connection": "socket.create_connection",
                "httpx_sync_transport": "httpx.HTTPTransport.handle_request",
                "httpx_async_transport": "httpx.AsyncHTTPTransport.handle_async_request",
                "deepseek_single": "my_agent.backend.integrations.copy_client.DeepSeekCopyClient.generate_marketing_copy",
                "deepseek_variants": "my_agent.backend.integrations.copy_client.DeepSeekCopyClient.generate_marketing_copy_variants",
                "seedream_background": "my_agent.backend.integrations.seedream_client.SeedreamClient.generate_background",
                "seedream_single": "my_agent.backend.integrations.seedream_client.SeedreamClient.generate_single_product_poster",
                "seedream_group": "my_agent.backend.integrations.seedream_client.SeedreamClient.generate_product_poster_group",
                "stock_configured": "my_agent.stock_client.stock_configured",
                "stock_search": "my_agent.stock_client.search_stock_photos",
                "stock_search_first": "my_agent.stock_client.search_first_stock",
                "stock_search_many": "my_agent.stock_client.search_many_stock",
                "stock_download": "my_agent.stock_client.download_image",
                "unsplash_search": "my_agent.unsplash_client.search_unsplash_photos",
                "unsplash_search_many": "my_agent.unsplash_client.search_many_usable",
                "unsplash_download": "my_agent.unsplash_client.download_image",
            },
            "provider or external transport call is forbidden",
        )
        self.generation_guards = self._start_object_guards(
            self.generation_service,
            (
                "generate",
                "generate_idempotent",
                "create_sequence_idempotent",
                "get_result",
                "run_sequence_task",
            ),
            "GenerationService must not be invoked",
        )
        self.artifact_write_guards = self._start_object_guards(
            self.store,
            (
                "create_generation",
                "discard_generation",
                "save_poster",
                "save_complete_poster_group",
                "save_sequence_poster",
                "create_zip",
                "write_manifest",
            ),
            "ArtifactStore write must not be invoked",
        )

    def _start_guards(self, targets: dict[str, str], message: str) -> dict[str, object]:
        guards = {}
        for name, target in targets.items():
            patcher = patch(target, side_effect=AssertionError(message))
            guards[name] = patcher.start()
            self.addCleanup(patcher.stop)
        return guards

    def _start_object_guards(
        self, target: object, methods: tuple[str, ...], message: str
    ) -> dict[str, object]:
        guards = {}
        for method in methods:
            patcher = patch.object(target, method, side_effect=AssertionError(message))
            guards[method] = patcher.start()
            self.addCleanup(patcher.stop)
        return guards

    @staticmethod
    def payload(**changes: str) -> dict[str, str]:
        value = {
            "product_info": "\u624b\u673a Professional model for creators",
            "product_short_name": "Creator Phone",
            "creative_note": "Highlight camera quality",
        }
        value.update(changes)
        return value

    def test_valid_request_returns_complete_200_response_schema(self) -> None:
        response = self.client.post(ENDPOINT, json=self.payload())
        self.assertEqual(200, response.status_code, response.text)
        document = response.json()
        parsed = MarketingAdviceResponse.model_validate(document)
        self.assertEqual("v1", parsed.api_version)
        self.assertEqual("catalog-v1", parsed.advice_version)
        self.assertEqual("present", parsed.status)
        self.assertEqual("durable", parsed.advice.category_id)
        self.assertEqual(
            {
                "api_version",
                "advice_version",
                "status",
                "input_signature_sha256",
                "advice_signature_sha256",
                "advice",
            },
            set(document),
        )
        self.assertEqual(
            {
                "category_id",
                "category_name",
                "confidence",
                "matched_keywords",
                "reason",
                "score",
                "strategy",
                "source",
            },
            set(document["advice"]),
        )
        self.assertEqual(
            {"id", "name", "examples", "traits", "tactics", "one_liner"},
            set(document["advice"]["strategy"]),
        )

    def test_repeated_and_concurrent_http_response_bodies_are_byte_equivalent(self) -> None:
        payload = self.payload()
        first = self.client.post(ENDPOINT, json=payload)
        second = self.client.post(ENDPOINT, json=payload)
        self.assertEqual(200, first.status_code)
        self.assertEqual(first.content, second.content)

        async def send_concurrently():
            transport = httpx.ASGITransport(
                app=self.app, raise_app_exceptions=False
            )
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                return await asyncio.gather(
                    *(client.post(ENDPOINT, json=payload) for _ in range(16))
                )

        concurrent = asyncio.run(send_concurrently())
        self.assertTrue(all(item.status_code == 200 for item in concurrent))
        self.assertTrue(all(item.content == first.content for item in concurrent))

    def test_validation_failures_are_422_and_never_failed_200(self) -> None:
        cases = {
            "missing_product_info": {
                "product_short_name": "Name",
                "creative_note": "Note",
            },
            "empty_product_info": self.payload(product_info=""),
            "blank_product_info": self.payload(product_info=" \t\r\n"),
            "product_info_over_limit": self.payload(product_info="x" * 2001),
            "short_name_over_limit": self.payload(product_short_name="x" * 81),
            "creative_note_over_limit": self.payload(creative_note="x" * 501),
            "unknown_field": {**self.payload(), "platform": "xiaohongshu"},
        }
        for name, payload in cases.items():
            with self.subTest(name=name):
                response = self.client.post(ENDPOINT, json=payload)
                self.assertEqual(422, response.status_code, response.text)
                self.assertEqual("invalid_request", response.json()["error"]["code"])
                self.assertNotEqual("failed", response.json().get("status"))

    def test_classifier_exception_is_non_2xx(self) -> None:
        with patch(
            "my_agent.backend.services.marketing_advice_service.classify_product_category_smart",
            side_effect=RuntimeError("synthetic classifier failure"),
        ):
            response = self.client.post(ENDPOINT, json=self.payload())
        self.assertEqual(500, response.status_code)
        self.assertEqual("internal_error", response.json()["error"]["code"])
        self.assertNotIn("status", response.json())

    def test_endpoint_has_zero_providers_network_artifacts_or_generation_state(self) -> None:
        tree_before = _artifact_tree(self.store.root)
        records_before = sum(1 for item in self.store.root.iterdir() if item.is_dir())
        idempotency_before = dict(self.generation_service.idempotency._entries)

        response = self.client.post(
            ENDPOINT,
            json=self.payload(),
            headers={"X-Idempotency-Key": "must-remain-unused"},
        )

        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(tree_before, _artifact_tree(self.store.root))
        self.assertEqual(
            records_before,
            sum(1 for item in self.store.root.iterdir() if item.is_dir()),
        )
        self.assertEqual(
            idempotency_before, self.generation_service.idempotency._entries
        )
        self.assertEqual(0, self.copy.calls)
        self.assertEqual(0, self.seedream.calls)
        self.assertEqual(0, self.stock.calls)
        for group in (
            self.external_guards,
            self.generation_guards,
            self.artifact_write_guards,
        ):
            for name, guard in group.items():
                with self.subTest(guard=name):
                    self.assertEqual(0, guard.call_count)

    def test_health_and_capabilities_response_contracts_are_unchanged(self) -> None:
        health = self.client.get("/api/v1/health")
        self.assertEqual(200, health.status_code)
        self.assertEqual({"status": "ok", "api_version": "v1"}, health.json())

        capabilities = self.client.get("/api/v1/capabilities")
        self.assertEqual(200, capabilities.status_code)
        document = capabilities.json()
        self.assertEqual(
            {
                "api_version",
                "visual_styles",
                "platforms",
                "background_modes",
                "output_sizes",
                "product_types",
                "seedream_configured",
                "stock_fallback_configured",
                "generation_modes",
            },
            set(document),
        )
        self.assertEqual("v1", document["api_version"])
        self.assertFalse(document["seedream_configured"])
        self.assertFalse(document["stock_fallback_configured"])

    def test_openapi_delta_is_only_the_new_route_and_four_schemas(self) -> None:
        document = self.app.openapi()
        expected_paths = set(BASELINE_OPENAPI_PATH_HASHES) | {ENDPOINT}
        self.assertEqual(expected_paths, set(document["paths"]))
        for path, expected_hash in BASELINE_OPENAPI_PATH_HASHES.items():
            with self.subTest(path=path):
                self.assertEqual(
                    expected_hash, _canonical_sha256(document["paths"][path])
                )

        schemas = document["components"]["schemas"]
        self.assertEqual(
            {
                "MarketingAdvice",
                "MarketingAdviceRequest",
                "MarketingAdviceResponse",
                "MarketingAdviceStrategy",
            },
            set(schemas) - set(BASELINE_OPENAPI_SCHEMA_HASHES),
        )
        for name, expected_hash in BASELINE_OPENAPI_SCHEMA_HASHES.items():
            with self.subTest(schema=name):
                self.assertEqual(expected_hash, _canonical_sha256(schemas[name]))

        post = document["paths"][ENDPOINT]["post"]
        self.assertEqual(
            {"product_info", "product_short_name", "creative_note"},
            set(schemas["MarketingAdviceRequest"]["properties"]),
        )
        self.assertEqual(
            {"$ref": "#/components/schemas/MarketingAdviceRequest"},
            post["requestBody"]["content"]["application/json"]["schema"],
        )
        self.assertEqual(
            {"$ref": "#/components/schemas/MarketingAdviceResponse"},
            post["responses"]["200"]["content"]["application/json"]["schema"],
        )

    def test_generation_request_advice_reference_is_additive_and_legacy_fingerprint_is_unchanged(self) -> None:
        request = GenerationRequest.model_validate(
            {
                "product_info": "Fingerprint product",
                "product_short_name": "FP",
                "creative_note": "Line one\nLine two",
                "generate_poster": False,
            }
        )
        self.assertEqual(
            "238fe6f56e10cfa0c49b8c120082934a4a462446fcce1df46ba5c66f25a72432",
            _canonical_sha256(GenerationRequest.model_json_schema()),
        )
        self.assertIn(
            "marketing_advice_ref",
            GenerationRequest.model_json_schema()["properties"],
        )
        template_schema = GenerationRequest.model_json_schema()["properties"][
            "style_template_id"
        ]
        template_ids: set[str] = set()
        for option in template_schema["anyOf"]:
            if option.get("type") != "string":
                continue
            if "const" in option:
                template_ids.add(option["const"])
            if "enum" in option:
                template_ids.update(option["enum"])
        self.assertEqual(
            {
                "paper_doodle_grid",
                "warm_collectible_poster",
                "soft_floral_flatlay",
            },
            template_ids,
        )
        self.assertEqual(
            "17fe7609d366ba7478cbfe2576835f486d8716f01dda067849f0367bff32958d",
            _fingerprint(request, b"product-image", b"background-reference"),
        )
        self.assertEqual(
            "ff85af4e6d008ad5f78668e29fa6e23a39402175c0fb296238f7f589058fbbcf",
            _fingerprint(request, None, None),
        )


if __name__ == "__main__":
    unittest.main()
