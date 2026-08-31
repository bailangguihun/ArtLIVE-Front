from __future__ import annotations

import json
import secrets
import tempfile
import unittest
import uuid
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from my_agent.backend.main import EDGE_PROXY_HEADER, create_app
from my_agent.backend.services.generation_service import GenerationService
from my_agent.backend.services.image_generation_service import ImageGenerationService
from my_agent.backend.storage.artifact_store import ArtifactStore
from my_agent.tests.helpers import (
    FakeCopyClient,
    FakeSeedreamProvider,
    FakeStockProvider,
    OfflineASGIClient,
    png_bytes,
    settings_for,
)

SYNTHETIC_EDGE_TOKEN = "synthetic-edge-token-for-tests"


def base_payload(**changes) -> dict:
    payload = {
        "product_info": "Offline product information",
        "product_short_name": "Product",
        "creative_note": "Clean local test",
        "visual_style": "vibrant",
        "generate_poster": False,
        "background_mode": "procedural",
        "output_size": "512x768",
        "product_type": "bag_heavy",
    }
    payload.update(changes)
    return payload


class APIContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.settings = settings_for(root)
        self.store = ArtifactStore(self.settings.artifact_root)
        self.copy = FakeCopyClient()
        self.provider = FakeSeedreamProvider(configured=False)
        self.stock = FakeStockProvider(image=None, configured=False)
        image_service = ImageGenerationService(self.provider, self.stock)
        self.service = GenerationService(
            self.copy,
            image_service,
            self.store,
            settings=self.settings,
        )
        self.app = create_app(self.settings, self.service, self.store)
        self.client = OfflineASGIClient(self.app, raise_server_exceptions=False)
        self.http_block = patch(
            "requests.sessions.Session.request",
            side_effect=AssertionError("external HTTP is blocked"),
        )
        self.http_block.start()

    def tearDown(self) -> None:
        self.http_block.stop()
        self.client.close()
        self.temporary.cleanup()

    def post(
        self,
        payload: dict,
        files=None,
        key: str | None = None,
        *,
        client: OfflineASGIClient | None = None,
        edge_token: str | None = None,
    ):
        headers = {"X-Idempotency-Key": key or str(uuid.uuid4())}
        if edge_token is not None:
            headers[EDGE_PROXY_HEADER] = edge_token
        return (client or self.client).post(
            "/api/v1/generations",
            data={"payload": json.dumps(payload)},
            files=files,
            headers=headers,
        )

    def protected_client(self) -> OfflineASGIClient:
        protected_settings = replace(
            self.settings,
            require_edge_proxy=True,
            edge_proxy_token=SYNTHETIC_EDGE_TOKEN,
        )
        return OfflineASGIClient(
            create_app(protected_settings, self.service, self.store),
            raise_server_exceptions=False,
        )

    def test_health_returns_only_safe_fields(self) -> None:
        response = self.client.get("/api/v1/health")
        self.assertEqual(200, response.status_code)
        self.assertEqual({"status": "ok", "api_version": "v1"}, response.json())

    def test_protected_app_keeps_only_get_health_public(self) -> None:
        client = self.protected_client()
        try:
            response = client.get("/api/v1/health")
            non_get = client.post("/api/v1/health")
        finally:
            client.close()
        self.assertEqual(200, response.status_code)
        self.assertEqual({"status": "ok", "api_version": "v1"}, response.json())
        self.assertEqual(403, non_get.status_code)
        rendered = response.text + json.dumps(dict(response.headers))
        self.assertNotIn("configuration", rendered.lower())
        self.assertNotIn("provider", rendered.lower())
        self.assertNotIn("token", rendered.lower())
        self.assertNotIn(SYNTHETIC_EDGE_TOKEN, rendered)

    def test_protected_app_rejects_missing_and_wrong_tokens_indistinguishably(self) -> None:
        client = self.protected_client()
        fixed_request_id = uuid.UUID("00000000-0000-4000-8000-000000000001")
        try:
            with patch("my_agent.backend.main.uuid.uuid4", return_value=fixed_request_id):
                missing = client.get("/api/v1/capabilities")
                wrong = client.get(
                    "/api/v1/capabilities",
                    headers={EDGE_PROXY_HEADER: "synthetic-wrong-token"},
                )
        finally:
            client.close()
        self.assertEqual(403, missing.status_code)
        self.assertEqual(missing.status_code, wrong.status_code)
        self.assertEqual(missing.json(), wrong.json())
        self.assertEqual({"error"}, set(missing.json()))
        self.assertEqual(
            {"code", "message", "request_id"}, set(missing.json()["error"])
        )
        self.assertEqual("forbidden", missing.json()["error"]["code"])
        self.assertNotIn("location", missing.headers)
        rendered = missing.text + wrong.text + json.dumps(dict(wrong.headers))
        self.assertNotIn(SYNTHETIC_EDGE_TOKEN, rendered)
        self.assertNotIn("synthetic-wrong-token", rendered)

    def test_only_the_internal_edge_header_is_an_accepted_token_channel(self) -> None:
        client = self.protected_client()
        rejected = (
            (f"/api/v1/capabilities?{EDGE_PROXY_HEADER}={SYNTHETIC_EDGE_TOKEN}", {}),
            ("/api/v1/capabilities", {"Cookie": f"edge={SYNTHETIC_EDGE_TOKEN}"}),
            (
                "/api/v1/capabilities",
                {"Authorization": f"Bearer {SYNTHETIC_EDGE_TOKEN}"},
            ),
            (
                "/api/v1/capabilities",
                {"X-AD-Proxy-Token": SYNTHETIC_EDGE_TOKEN},
            ),
        )
        try:
            for url, headers in rejected:
                with self.subTest(url=url, headers=tuple(headers)):
                    response = client.get(url, headers=headers)
                    self.assertEqual(403, response.status_code)
            duplicate = client.get(
                "/api/v1/capabilities",
                headers=[
                    (EDGE_PROXY_HEADER, SYNTHETIC_EDGE_TOKEN),
                    (EDGE_PROXY_HEADER, SYNTHETIC_EDGE_TOKEN),
                ],
            )
            request_body = client.post(
                "/api/v1/marketing-advice",
                json={
                    "product_info": "Synthetic local product",
                    "product_short_name": "Product",
                    "creative_note": "Offline",
                    "edge_proxy_token": SYNTHETIC_EDGE_TOKEN,
                },
            )
        finally:
            client.close()
        self.assertEqual(403, duplicate.status_code)
        self.assertEqual(403, request_body.status_code)

    def test_correct_edge_token_uses_constant_time_comparison(self) -> None:
        client = self.protected_client()
        try:
            with patch(
                "my_agent.backend.main.secrets.compare_digest",
                wraps=secrets.compare_digest,
            ) as compared:
                response = client.get(
                    "/api/v1/capabilities",
                    headers={EDGE_PROXY_HEADER: SYNTHETIC_EDGE_TOKEN},
                )
        finally:
            client.close()
        self.assertEqual(200, response.status_code)
        compared.assert_called_once()
        rendered = response.text + json.dumps(dict(response.headers))
        self.assertNotIn(SYNTHETIC_EDGE_TOKEN, rendered)

    def test_failed_edge_authentication_does_not_invoke_generation(self) -> None:
        client = self.protected_client()
        try:
            with patch.object(self.service, "generate_idempotent") as generate:
                response = self.post(base_payload(), client=client)
        finally:
            client.close()
        self.assertEqual(403, response.status_code)
        generate.assert_not_called()
        self.assertEqual(0, self.copy.calls)
        self.assertEqual(0, self.provider.calls)
        self.assertEqual(0, self.stock.calls)
        self.assertEqual([], list(self.store.root.glob("*")))

    def test_authenticated_json_request_preserves_marketing_advice_behavior(self) -> None:
        client = self.protected_client()
        try:
            response = client.post(
                "/api/v1/marketing-advice",
                json={
                    "product_info": "Synthetic offline reusable bottle",
                    "product_short_name": "Bottle",
                    "creative_note": "Deterministic local contract",
                },
                headers={EDGE_PROXY_HEADER: SYNTHETIC_EDGE_TOKEN},
            )
        finally:
            client.close()
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual("present", response.json()["status"])
        self.assertNotIn(SYNTHETIC_EDGE_TOKEN, response.text)

    def test_authenticated_multipart_poll_preview_and_download_contracts(self) -> None:
        client = self.protected_client()
        headers = {EDGE_PROXY_HEADER: SYNTHETIC_EDGE_TOKEN}
        files = {
            "product_image": (
                "synthetic-product.png",
                png_bytes(transparent_border=True),
                "image/png",
            )
        }
        try:
            with patch.dict(
                "my_agent.backend.services.generation_service.OUTPUT_SIZES",
                {"512x768": (144, 192)},
                clear=False,
            ):
                created = self.post(
                    base_payload(generate_poster=True, background_mode="procedural"),
                    files=files,
                    client=client,
                    edge_token=SYNTHETIC_EDGE_TOKEN,
                )
            self.assertEqual(200, created.status_code, created.text)
            document = created.json()
            polled = client.get(
                f"/api/v1/generations/{document['generation_id']}", headers=headers
            )
            poster = document["posters"][0]
            preview = client.get(poster["preview_url"], headers=headers)
            download = client.get(poster["download_url"], headers=headers)
            archive = client.get(document["zip_download_url"], headers=headers)
        finally:
            client.close()
        self.assertEqual(200, polled.status_code)
        self.assertEqual(document["generation_id"], polled.json()["generation_id"])
        self.assertEqual(200, preview.status_code)
        self.assertEqual("image/png", preview.headers["content-type"])
        self.assertEqual(preview.content, download.content)
        self.assertEqual("image/png", download.headers["content-type"])
        self.assertIn("attachment", download.headers["content-disposition"])
        self.assertEqual(200, archive.status_code)
        self.assertEqual("application/zip", archive.headers["content-type"])
        self.assertIn("attachment", archive.headers["content-disposition"])

    def test_cors_preflight_remains_safe_without_exposing_the_internal_header(self) -> None:
        client = self.protected_client()
        origin = "http://127.0.0.1:8501"
        common_headers = {
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
        }
        try:
            accepted = client.request(
                "OPTIONS",
                "/api/v1/generations",
                headers={
                    **common_headers,
                    "Access-Control-Request-Headers": "content-type,x-idempotency-key",
                },
            )
            internal_header = client.request(
                "OPTIONS",
                "/api/v1/generations",
                headers={
                    **common_headers,
                    "Access-Control-Request-Headers": EDGE_PROXY_HEADER,
                },
            )
            actual = client.get(
                "/api/v1/capabilities", headers={"Origin": origin}
            )
        finally:
            client.close()
        self.assertEqual(200, accepted.status_code)
        self.assertEqual(origin, accepted.headers["access-control-allow-origin"])
        self.assertNotIn(EDGE_PROXY_HEADER.lower(), accepted.text.lower())
        self.assertEqual(400, internal_header.status_code)
        self.assertEqual(403, actual.status_code)
        self.assertEqual(origin, actual.headers["access-control-allow-origin"])
        self.assertEqual(0, self.copy.calls)
        self.assertEqual(0, self.provider.calls)

    def test_local_and_protected_app_instances_do_not_leak_configuration(self) -> None:
        protected = self.protected_client()
        try:
            denied = protected.get("/api/v1/capabilities")
            local = self.client.get("/api/v1/capabilities")
            allowed = protected.get(
                "/api/v1/capabilities",
                headers={EDGE_PROXY_HEADER: SYNTHETIC_EDGE_TOKEN},
            )
        finally:
            protected.close()
        self.assertEqual(403, denied.status_code)
        self.assertEqual(200, local.status_code)
        self.assertEqual(200, allowed.status_code)

    def test_capabilities_are_safe_and_complete(self) -> None:
        response = self.client.get("/api/v1/capabilities")
        self.assertEqual(200, response.status_code)
        document = response.json()
        self.assertFalse(document["seedream_configured"])
        self.assertFalse(document["stock_fallback_configured"])
        self.assertEqual(
            {"seedream_text", "seedream_reference", "stock", "procedural"},
            {item["id"] for item in document["background_modes"]},
        )
        rendered = json.dumps(document)
        self.assertNotIn("endpoint", rendered.lower())
        self.assertNotIn("api_key", rendered.lower())

    def test_copy_only_succeeds_without_images_or_image_service(self) -> None:
        response = self.post(base_payload())
        self.assertEqual(200, response.status_code, response.text)
        document = response.json()
        self.assertEqual([], document["posters"])
        self.assertIsNone(document["zip_download_url"])
        self.assertEqual(0, self.provider.calls)
        self.assertEqual(0, self.stock.calls)

    def test_poster_request_rejects_missing_product_image(self) -> None:
        response = self.post(base_payload(generate_poster=True))
        self.assertEqual(422, response.status_code)
        self.assertEqual("missing_product_image", response.json()["error"]["code"])

    def test_reference_mode_rejects_missing_background_reference(self) -> None:
        response = self.post(
            base_payload(generate_poster=True, background_mode="seedream_reference"),
            files={"product_image": ("ignored.png", png_bytes(), "image/png")},
        )
        self.assertEqual(422, response.status_code)
        self.assertEqual(
            "missing_background_reference", response.json()["error"]["code"]
        )

    def test_unsupported_enum_is_rejected(self) -> None:
        response = self.post(base_payload(visual_style="unknown-style"))
        self.assertEqual(422, response.status_code)
        self.assertEqual("invalid_payload", response.json()["error"]["code"])

    def test_unsupported_upload_content_type_is_rejected(self) -> None:
        response = self.post(
            base_payload(generate_poster=True),
            files={"product_image": ("ignored.gif", png_bytes(), "image/gif")},
        )
        self.assertEqual(415, response.status_code)
        self.assertEqual("unsupported_image_type", response.json()["error"]["code"])

    def test_invalid_image_bytes_are_rejected(self) -> None:
        response = self.post(
            base_payload(generate_poster=True),
            files={"product_image": ("ignored.png", b"not-an-image", "image/png")},
        )
        self.assertEqual(422, response.status_code)
        self.assertEqual("invalid_image", response.json()["error"]["code"])

    def test_oversized_upload_is_rejected_without_unbounded_read(self) -> None:
        tiny_settings = settings_for(Path(self.temporary.name), max_upload_bytes=80)
        tiny_store = ArtifactStore(tiny_settings.artifact_root)
        service = GenerationService(
            FakeCopyClient(),
            ImageGenerationService(
                FakeSeedreamProvider(configured=False),
                FakeStockProvider(configured=False),
            ),
            tiny_store,
            settings=tiny_settings,
        )
        client = OfflineASGIClient(
            create_app(tiny_settings, service, tiny_store),
            raise_server_exceptions=False,
        )
        try:
            response = client.post(
                "/api/v1/generations",
                data={"payload": json.dumps(base_payload(generate_poster=True))},
                files={
                    "product_image": (
                        "ignored.png",
                        png_bytes(size=(80, 80)),
                        "image/png",
                    )
                },
            )
        finally:
            client.close()
        self.assertEqual(413, response.status_code)
        self.assertEqual("upload_too_large", response.json()["error"]["code"])

    def test_mocked_local_poster_generation_and_download_contract(self) -> None:
        payload = base_payload(generate_poster=True, background_mode="procedural")
        files = {
            "product_image": (
                "../../untrusted-name.png",
                png_bytes(transparent_border=True),
                "image/png",
            )
        }
        with patch.dict(
            "my_agent.backend.services.generation_service.OUTPUT_SIZES",
            {"512x768": (144, 192)},
            clear=False,
        ):
            response = self.post(payload, files=files)
        self.assertEqual(200, response.status_code, response.text)
        document = response.json()
        self.assertEqual(3, len(document["posters"]))
        self.assertTrue(document["zip_download_url"].startswith("/api/v1/"))
        serialized = json.dumps(document)
        self.assertNotIn(str(Path(self.temporary.name)), serialized)
        self.assertNotIn("seedream.invalid", serialized)
        self.assertNotIn("offline-test-key", serialized)
        for poster in document["posters"]:
            self.assertEqual([144, 192], [poster["width"], poster["height"]])
            preview = self.client.get(poster["preview_url"])
            download = self.client.get(poster["download_url"])
            self.assertEqual("image/png", preview.headers["content-type"])
            self.assertEqual(200, download.status_code)
        archive = self.client.get(document["zip_download_url"])
        self.assertEqual(200, archive.status_code)
        self.assertEqual("application/zip", archive.headers["content-type"])
        generation_dir = self.store.root / document["generation_id"]
        stored_names = {path.name for path in generation_dir.iterdir()}
        self.assertFalse(any("untrusted" in name for name in stored_names))
        self.assertEqual(5, len(stored_names))

    def test_generation_manifest_can_be_retrieved(self) -> None:
        created = self.post(base_payload()).json()
        response = self.client.get(
            f"/api/v1/generations/{created['generation_id']}"
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual(created["generation_id"], response.json()["generation_id"])

    def test_download_routes_reject_arbitrary_and_traversal_ids(self) -> None:
        arbitrary = self.client.get(
            "/api/v1/generations/not-a-uuid/posters/not-a-uuid"
        )
        traversal = self.client.get(
            "/api/v1/generations/%2E%2E/posters/%2E%2E/download"
        )
        self.assertIn(arbitrary.status_code, {404, 422})
        self.assertIn(traversal.status_code, {404, 422})

    def test_error_response_never_contains_traceback(self) -> None:
        response = self.post(base_payload(product_info=""))
        self.assertEqual(422, response.status_code)
        document = response.json()
        self.assertEqual({"error"}, set(document))
        self.assertEqual({"code", "message", "request_id"}, set(document["error"]))
        self.assertNotIn("traceback", response.text.lower())

    def test_openapi_schema_is_serializable(self) -> None:
        schema = self.app.openapi()
        json.dumps(schema)
        self.assertIn("/api/v1/generations", schema["paths"])


if __name__ == "__main__":
    unittest.main()
