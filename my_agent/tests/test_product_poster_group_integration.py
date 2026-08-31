from __future__ import annotations

import hashlib
import inspect
import io
import json
import logging
import socket
import tempfile
import threading
import unittest
import uuid
import zipfile
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

import requests
from PIL import Image

from my_agent.backend.core.config import ConfigurationError, Settings
from my_agent.backend.integrations.seedream_client import SeedreamClient
from my_agent.backend.main import create_app
from my_agent.backend.services.generation_service import GenerationService
from my_agent.backend.services.product_poster_group_service import (
    ProductPosterGroupService,
)
from my_agent.backend.storage.artifact_store import ArtifactStore
from my_agent.backend_api_client import (
    PRODUCT_POSTER_GROUP_MODE,
    BackendAPIClient,
    BackendAPIError,
    BackendUnavailable,
    build_legacy_generation_payload,
    build_product_poster_group_payload,
)
from my_agent.tests.helpers import (
    FakeCopyClient,
    FakeHTTPResponse,
    FakeHTTPSession,
    OfflineASGIClient,
    png_bytes,
    settings_for,
)


APP_ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "doubao-seedream-5-0-pro-260628"
PROVIDER_SIZE = "1024x1536"
PROVIDER_COLORS = [
    (212, 31, 45, 255),
    (38, 177, 85, 255),
    (36, 81, 204, 255),
]
MOCK_GENERATION_POST_BOUNDARY_INVOCATIONS = 0
_REAL_SOCKET_CONNECT = socket.socket.connect


def local_only_socket_connect(sock, address):
    host = str(address[0]) if isinstance(address, tuple) and address else ""
    if host == "::1" or host.startswith("127."):
        return _REAL_SOCKET_CONNECT(sock, address)
    raise AssertionError("external socket transmission is blocked")


class CountingGroupSession(FakeHTTPSession):
    def post(self, url: str, **kwargs):
        global MOCK_GENERATION_POST_BOUNDARY_INVOCATIONS
        MOCK_GENERATION_POST_BOUNDARY_INVOCATIONS += 1
        return super().post(url, **kwargs)


class LegacyImageServiceSpy:
    seedream_configured = True
    stock_configured = False

    def __init__(self) -> None:
        self.acquire_calls = 0

    def acquire(self, *args, **kwargs):
        _ = (args, kwargs)
        self.acquire_calls += 1
        raise AssertionError("legacy background acquisition must not run")


class FailingGroupArtifactStore(ArtifactStore):
    def save_complete_poster_group(self, *args, **kwargs):
        _ = (args, kwargs)
        raise OSError("synthetic artifact failure")


class LocalResponse:
    status_code = 200
    content = b""

    def __init__(self, document: dict | None = None) -> None:
        self._document = document or {"status": "completed"}

    def json(self):
        return self._document


class LocalClientSession:
    def __init__(self, error: BaseException | None = None) -> None:
        self.error = error
        self.post_calls = 0
        self.last_files = None

    def post(self, _url: str, **kwargs):
        self.post_calls += 1
        self.last_files = kwargs.get("files")
        if self.error:
            raise self.error
        return LocalResponse()


def provider_json_response(items: list[dict[str, str]]) -> FakeHTTPResponse:
    body = json.dumps({"data": items}, separators=(",", ":")).encode("utf-8")
    return FakeHTTPResponse(body=body, status_code=200)


def success_session(
    *,
    colors: list[tuple[int, int, int, int]] | None = None,
    sizes: list[tuple[int, int]] | None = None,
) -> CountingGroupSession:
    selected_colors = colors or PROVIDER_COLORS
    selected_sizes = sizes or [(1024, 1536)] * 3
    urls = [f"https://provider-result.invalid/poster-{index}.png" for index in range(1, 4)]
    return CountingGroupSession(
        post_result=provider_json_response([{"url": url} for url in urls]),
        get_result=[
            FakeHTTPResponse(png_bytes(size=size, color=color))
            for size, color in zip(selected_sizes, selected_colors)
        ],
    )


def group_payload(**overrides) -> dict:
    payload = build_product_poster_group_payload(
        product_info="Synthetic premium product",
        product_short_name="Synthetic product",
        creative_note="Sculptural premium light and precise commercial typography",
        visual_style="premium",
        consent=True,
    )
    payload.update(overrides)
    return payload


def create_stack(
    root: Path,
    session: FakeHTTPSession,
    *,
    enabled: bool,
    configured: bool = True,
) -> dict:
    settings = replace(
        settings_for(root, seedream_configured=configured),
        seedream_model_id=MODEL_ID if configured else "",
        seedream_image_size=PROVIDER_SIZE,
        seedream_watermark=False,
        enable_seedream_product_poster_group=enabled,
    )
    store = ArtifactStore(settings.artifact_root, settings.max_image_pixels)
    seedream = SeedreamClient(settings, session=session)
    group_service = ProductPosterGroupService(seedream)
    copy_client = FakeCopyClient()
    legacy_image_service = LegacyImageServiceSpy()
    generation_service = GenerationService(
        copy_client=copy_client,
        image_service=legacy_image_service,
        artifact_store=store,
        product_poster_group_service=group_service,
        enable_product_poster_group=enabled,
        product_poster_group_provider_verified=False,
    )
    app = create_app(settings, generation_service, store)
    return {
        "settings": settings,
        "store": store,
        "session": session,
        "copy": copy_client,
        "legacy": legacy_image_service,
        "service": generation_service,
        "client": OfflineASGIClient(app, raise_server_exceptions=False),
    }


def submit(client: OfflineASGIClient, payload: dict, product: bytes, key: str):
    return client.post(
        "/api/v1/generations",
        data={"payload": json.dumps(payload, ensure_ascii=False)},
        files={"product_image": ("synthetic.png", product, "image/png")},
        headers={"X-Idempotency-Key": key},
    )


class ConfigurationClientAndUISafetyTests(unittest.TestCase):
    def test_feature_gate_defaults_false_and_parses_synthetic_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            missing_dotenv = root / "does-not-exist.env"
            default_settings = Settings.from_env(
                root, dotenv_path=missing_dotenv, environment={}
            )
            enabled_settings = Settings.from_env(
                root,
                dotenv_path=missing_dotenv,
                environment={"ENABLE_SEEDREAM_PRODUCT_POSTER_GROUP": "yes"},
            )
            self.assertFalse(default_settings.enable_seedream_product_poster_group)
            self.assertTrue(enabled_settings.enable_seedream_product_poster_group)
            with self.assertRaises(ConfigurationError):
                Settings.from_env(
                    root,
                    dotenv_path=missing_dotenv,
                    environment={"ENABLE_SEEDREAM_PRODUCT_POSTER_GROUP": "maybe"},
                )

    def test_new_client_payload_has_only_complete_group_business_fields(self) -> None:
        payload = group_payload()
        self.assertEqual(PRODUCT_POSTER_GROUP_MODE, payload["generation_mode"])
        self.assertTrue(payload["send_product_to_provider"])
        self.assertEqual(3, payload["requested_poster_count"])
        self.assertEqual("provider", payload["text_rendering_mode"])
        self.assertEqual(PROVIDER_SIZE, payload["output_size"])
        self.assertTrue(
            {
                "product_type",
                "background_mode",
                "background_reference",
                "category_key",
                "text_layout",
                "placement",
            }.isdisjoint(payload)
        )
        with self.assertRaises(BackendAPIError) as raised:
            build_product_poster_group_payload(
                product_info="Product",
                product_short_name="",
                creative_note="",
                visual_style="premium",
                consent=False,
            )
        self.assertEqual("missing_provider_consent", raised.exception.code)

    def test_legacy_client_payload_remains_separate(self) -> None:
        payload = build_legacy_generation_payload(
            product_info="Legacy product",
            product_short_name="Legacy",
            creative_note="",
            visual_style="vibrant",
            generate_poster=True,
            background_mode="procedural",
            output_size="768x1024",
            product_type="flat_small",
        )
        self.assertEqual("legacy_background_composite", payload["generation_mode"])
        self.assertEqual("flat_small", payload["product_type"])
        self.assertEqual("procedural", payload["background_mode"])
        self.assertFalse(payload["send_product_to_provider"])

    def test_backend_client_generation_post_is_one_shot(self) -> None:
        session = LocalClientSession(error=requests.ConnectionError("offline"))
        client = BackendAPIClient(base_url="http://127.0.0.1:8000", session=session)
        with self.assertRaises(BackendUnavailable):
            client.create_generation(
                group_payload(),
                idempotency_key=str(uuid.uuid4()),
                product_image=(png_bytes(), "image/png"),
            )
        self.assertEqual(1, session.post_calls)
        self.assertIn("product_image", session.last_files)
        self.assertNotIn("background_reference", session.last_files)

    def test_streamlit_source_has_gate_consent_and_truthful_group_labels(self) -> None:
        source = (APP_ROOT / "app.py").read_text(encoding="utf-8")
        self.assertIn("group_enabled", source)
        self.assertIn("Seedream 完整海报组图（实验模式）", source)
        self.assertIn("上传的商品参考图将发送至火山引擎方舟 Seedream", source)
        self.assertIn("Seedream 商品参考图完整海报组图", source)
        self.assertIn("pending_idempotency_key", source)
        self.assertNotIn("uuid.uuid4())\n            with st.spinner", source)


class ProductPosterGroupEndToEndTests(unittest.TestCase):
    def setUp(self) -> None:
        self.http_guard = patch(
            "requests.sessions.Session.request",
            side_effect=AssertionError("external HTTP is blocked"),
        )
        self.socket_guard = patch(
            "socket.socket.connect", new=local_only_socket_connect
        )
        self.http_guard.start()
        self.socket_guard.start()

    def tearDown(self) -> None:
        self.socket_guard.stop()
        self.http_guard.stop()

    def test_disabled_capability_and_execution_stop_before_provider(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            stack = create_stack(Path(temporary), success_session(), enabled=False)
            client = stack["client"]
            capabilities = client.get("/api/v1/capabilities")
            mode = capabilities.json()["generation_modes"][0]
            self.assertEqual(200, capabilities.status_code)
            self.assertTrue(mode["implemented"])
            self.assertFalse(mode["enabled"])
            self.assertFalse(mode["provider_verified"])
            self.assertEqual(3, mode["requested_poster_count"])
            self.assertEqual(1, mode["provider_request_count"])
            self.assertEqual(PROVIDER_SIZE, mode["provider_size"])
            self.assertEqual("2:3", mode["aspect_ratio"])
            response = submit(
                client,
                group_payload(),
                png_bytes(size=(48, 72), transparent_border=True),
                str(uuid.uuid4()),
            )
            self.assertEqual(503, response.status_code)
            self.assertEqual("feature_disabled", response.json()["error"]["code"])
            self.assertEqual(0, stack["session"].post_calls)
            self.assertEqual(0, stack["copy"].calls)
            self.assertEqual([], list(stack["settings"].artifact_root.iterdir()))
            client.close()

    def test_new_mode_validation_errors_are_safe_and_precede_provider_calls(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            session = success_session()
            stack = create_stack(Path(temporary), session, enabled=True)
            client = stack["client"]
            product = png_bytes(size=(48, 72), transparent_border=True)
            cases = [
                (group_payload(send_product_to_provider=False), "missing_provider_consent"),
                (group_payload(requested_poster_count=2), "invalid_poster_count"),
                (group_payload(text_rendering_mode="local"), "invalid_text_rendering_mode"),
                (group_payload(output_size="768x1024"), "invalid_output_size"),
            ]
            for payload, expected_code in cases:
                response = submit(client, payload, product, str(uuid.uuid4()))
                self.assertEqual(422, response.status_code, response.text)
                self.assertEqual(expected_code, response.json()["error"]["code"])
            missing_product = client.post(
                "/api/v1/generations",
                data={"payload": json.dumps(group_payload())},
                headers={"X-Idempotency-Key": str(uuid.uuid4())},
            )
            self.assertEqual(422, missing_product.status_code)
            self.assertEqual(
                "missing_product_image", missing_product.json()["error"]["code"]
            )
            disallowed_reference = client.post(
                "/api/v1/generations",
                data={"payload": json.dumps(group_payload())},
                files={
                    "product_image": ("product.png", product, "image/png"),
                    "background_reference": (
                        "reference.png",
                        png_bytes(),
                        "image/png",
                    ),
                },
                headers={"X-Idempotency-Key": str(uuid.uuid4())},
            )
            self.assertEqual(422, disallowed_reference.status_code)
            self.assertEqual(
                "background_reference_not_allowed",
                disallowed_reference.json()["error"]["code"],
            )
            self.assertEqual(0, session.post_calls)
            self.assertEqual(0, stack["copy"].calls)
            client.close()

        with tempfile.TemporaryDirectory() as temporary:
            session = success_session()
            stack = create_stack(
                Path(temporary), session, enabled=True, configured=False
            )
            response = submit(
                stack["client"],
                group_payload(),
                png_bytes(size=(48, 72), transparent_border=True),
                str(uuid.uuid4()),
            )
            self.assertEqual(503, response.status_code)
            self.assertEqual("seedream_not_configured", response.json()["error"]["code"])
            self.assertEqual(0, session.post_calls)
            self.assertEqual(0, stack["copy"].calls)
            stack["client"].close()

    def test_complete_mocked_fastapi_flow_artifacts_manifest_and_downloads(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            session = success_session()
            stack = create_stack(root, session, enabled=True)
            client = stack["client"]
            product = png_bytes(size=(48, 72), transparent_border=True)
            category_spy = Mock(side_effect=AssertionError("category routing called"))
            with patch.object(GenerationService, "_category_key", category_spy), patch(
                "PIL.ImageOps.fit", side_effect=AssertionError("center crop called")
            ):
                response = submit(
                    client, group_payload(), product, str(uuid.uuid4())
                )
            self.assertEqual(200, response.status_code, response.text)
            document = response.json()
            self.assertEqual(PRODUCT_POSTER_GROUP_MODE, document["generation_mode"])
            self.assertEqual("complete_product_poster_group", document["generation_type"])
            self.assertEqual("seedream", document["provider"])
            self.assertEqual(MODEL_ID, document["model"])
            self.assertEqual((3, 3), (
                document["requested_poster_count"],
                document["actual_poster_count"],
            ))
            self.assertTrue(document["product_sent_to_provider"])
            self.assertFalse(document["local_product_compositing"])
            self.assertFalse(document["local_text_rendering"])
            self.assertFalse(document["fallback_used"])
            self.assertEqual(PROVIDER_SIZE, document["provider_size"])
            self.assertEqual("2:3", document["aspect_ratio"])
            self.assertFalse(document["provider_verified"])
            self.assertEqual(1, document["provider_generation_request_count"])
            self.assertEqual(3, document["provider_result_download_count"])
            self.assertEqual(3, len(document["posters"]))
            self.assertEqual(0, category_spy.call_count)
            self.assertEqual(0, stack["legacy"].acquire_calls)
            self.assertEqual(1, session.post_calls)
            self.assertEqual(3, session.get_calls)

            provider_payload = json.loads(session.last_post["data"].decode("utf-8"))
            self.assertEqual(MODEL_ID, provider_payload["model"])
            self.assertEqual(PROVIDER_SIZE, provider_payload["size"])
            self.assertEqual("auto", provider_payload["sequential_image_generation"])
            self.assertEqual(
                {"max_images": 3},
                provider_payload["sequential_image_generation_options"],
            )
            self.assertEqual(1, len(provider_payload["image"]))
            self.assertTrue(provider_payload["image"][0].startswith("data:image/png;base64,"))
            self.assertTrue(
                {
                    "stream",
                    "guidance_scale",
                    "optimize_prompt_options",
                    "seed",
                    "tools",
                }.isdisjoint(provider_payload)
            )
            self.assertNotIn("product_type", provider_payload["prompt"])
            self.assertNotIn("background only", provider_payload["prompt"].lower())
            self.assertNotIn("do not generate any product", provider_payload["prompt"].lower())

            generation_id = document["generation_id"]
            manifest = stack["store"].read_manifest(generation_id)
            serialized_manifest = json.dumps(manifest, ensure_ascii=False)
            self.assertEqual("complete_product_poster_group", manifest["generation_type"])
            self.assertEqual("seedream_complete_poster", manifest["posters"][0]["poster_source"])
            self.assertTrue(manifest["product_sent_to_provider"])
            self.assertFalse(manifest["local_product_compositing"])
            self.assertFalse(manifest["local_text_rendering"])
            self.assertEqual(3, manifest["actual_poster_count"])
            self.assertEqual(64, len(manifest["prompt_metadata"]["prompt_sha256"]))
            self.assertEqual(64, len(manifest["product_reference_metadata"]["normalized_sha256"]))
            self.assertNotIn("base64", serialized_manifest.lower())
            self.assertNotIn("data:image", serialized_manifest.lower())
            self.assertNotIn("provider-result.invalid", serialized_manifest)
            self.assertNotIn("offline-test-key", serialized_manifest)
            self.assertNotIn(str(root.resolve()), serialized_manifest)
            self.assertEqual("pass", manifest["qa"]["verdict"])
            self.assertIn("product_fidelity", manifest["qa"]["not_automatically_verified"])

            hashes = []
            for expected_index, (poster, color) in enumerate(
                zip(document["posters"], PROVIDER_COLORS)
            ):
                self.assertEqual(expected_index, poster["variant_index"])
                self.assertEqual((1024, 1536), (poster["width"], poster["height"]))
                self.assertEqual("seedream_complete_poster", poster["poster_source"])
                self.assertTrue(poster["product_sent_to_provider"])
                self.assertFalse(poster["local_product_compositing"])
                self.assertFalse(poster["local_text_rendering"])
                preview = client.get(poster["preview_url"])
                download = client.get(poster["download_url"])
                self.assertEqual((200, 200), (preview.status_code, download.status_code))
                self.assertEqual(preview.content, download.content)
                with Image.open(io.BytesIO(download.content)) as image:
                    image.load()
                    self.assertEqual((1024, 1536), image.size)
                    self.assertEqual(color, image.convert("RGBA").getpixel((0, 0)))
                hashes.append(hashlib.sha256(download.content).hexdigest())
            self.assertEqual(3, len(set(hashes)))

            archive_response = client.get(document["zip_download_url"])
            self.assertEqual(200, archive_response.status_code)
            with zipfile.ZipFile(io.BytesIO(archive_response.content), mode="r") as archive:
                self.assertEqual(
                    ["poster-01.png", "poster-02.png", "poster-03.png"],
                    archive.namelist(),
                )
                for name in archive.namelist():
                    with Image.open(io.BytesIO(archive.read(name))) as image:
                        image.load()
                        self.assertEqual((1024, 1536), image.size)
            self.assertEqual([], list((root / "artifacts" / generation_id).glob(".pending-*")))
            result_response = client.get(f"/api/v1/generations/{generation_id}")
            self.assertEqual(200, result_response.status_code)
            self.assertEqual(document, result_response.json())
            client.close()

    def test_incomplete_unexpected_duplicate_and_inconsistent_groups_never_complete(self) -> None:
        scenarios = [
            (
                "incomplete_group",
                CountingGroupSession(
                    post_result=provider_json_response(
                        [{"url": "https://provider-result.invalid/one.png"}]
                    )
                ),
                0,
            ),
            (
                "unexpected_group_size",
                CountingGroupSession(
                    post_result=provider_json_response(
                        [
                            {"url": f"https://provider-result.invalid/{index}.png"}
                            for index in range(4)
                        ]
                    )
                ),
                0,
            ),
            (
                "duplicate_group_image",
                success_session(colors=[PROVIDER_COLORS[0]] * 3),
                3,
            ),
            (
                "inconsistent_group_dimensions",
                success_session(
                    sizes=[(1024, 1536), (1024, 1536), (1024, 1535)]
                ),
                3,
            ),
        ]
        for expected_code, session, expected_gets in scenarios:
            with self.subTest(expected_code=expected_code), tempfile.TemporaryDirectory() as temporary:
                stack = create_stack(Path(temporary), session, enabled=True)
                response = submit(
                    stack["client"],
                    group_payload(),
                    png_bytes(size=(48, 72), transparent_border=True),
                    str(uuid.uuid4()),
                )
                self.assertEqual(502, response.status_code, response.text)
                self.assertEqual(expected_code, response.json()["error"]["code"])
                self.assertEqual(1, session.post_calls)
                self.assertEqual(expected_gets, session.get_calls)
                self.assertEqual([], list(stack["settings"].artifact_root.iterdir()))
                stack["client"].close()

    def test_timeout_is_not_retried_and_creates_no_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            session = CountingGroupSession(post_result=requests.Timeout("offline timeout"))
            stack = create_stack(Path(temporary), session, enabled=True)
            response = submit(
                stack["client"],
                group_payload(),
                png_bytes(size=(48, 72), transparent_border=True),
                str(uuid.uuid4()),
            )
            self.assertEqual(504, response.status_code)
            self.assertEqual("provider_timeout", response.json()["error"]["code"])
            self.assertEqual(1, session.post_calls)
            self.assertEqual(0, session.get_calls)
            self.assertEqual([], list(stack["settings"].artifact_root.iterdir()))
            stack["client"].close()

    def test_provider_rejection_and_artifact_failure_are_safely_mapped(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            session = CountingGroupSession(
                post_result=FakeHTTPResponse(body=b"{}", status_code=400)
            )
            stack = create_stack(Path(temporary), session, enabled=True)
            response = submit(
                stack["client"],
                group_payload(),
                png_bytes(size=(48, 72), transparent_border=True),
                str(uuid.uuid4()),
            )
            self.assertEqual(502, response.status_code)
            self.assertEqual(
                "provider_invalid_request", response.json()["error"]["code"]
            )
            self.assertEqual(1, session.post_calls)
            stack["client"].close()

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            session = success_session()
            settings = replace(
                settings_for(root, seedream_configured=True),
                seedream_model_id=MODEL_ID,
                seedream_image_size=PROVIDER_SIZE,
                enable_seedream_product_poster_group=True,
            )
            store = FailingGroupArtifactStore(
                settings.artifact_root, settings.max_image_pixels
            )
            seedream = SeedreamClient(settings, session=session)
            service = GenerationService(
                copy_client=FakeCopyClient(),
                image_service=LegacyImageServiceSpy(),
                artifact_store=store,
                product_poster_group_service=ProductPosterGroupService(seedream),
                enable_product_poster_group=True,
            )
            client = OfflineASGIClient(
                create_app(settings, service, store), raise_server_exceptions=False
            )
            response = submit(
                client,
                group_payload(),
                png_bytes(size=(48, 72), transparent_border=True),
                str(uuid.uuid4()),
            )
            self.assertEqual(500, response.status_code)
            self.assertEqual("artifact_write_failed", response.json()["error"]["code"])
            self.assertEqual([], list(settings.artifact_root.iterdir()))
            self.assertEqual(1, session.post_calls)
            client.close()

    def test_idempotency_reuses_success_and_conflicts_on_all_result_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            session = success_session()
            stack = create_stack(Path(temporary), session, enabled=True)
            client = stack["client"]
            key = str(uuid.uuid4())
            product = png_bytes(size=(48, 72), transparent_border=True)
            original = group_payload()
            first = submit(client, original, product, key)
            repeated = submit(client, original, product, key)
            self.assertEqual((200, 200), (first.status_code, repeated.status_code))
            self.assertEqual(first.json()["generation_id"], repeated.json()["generation_id"])
            self.assertEqual(1, session.post_calls)

            changed_requests = [
                (group_payload(creative_note="Changed creative note"), product),
                (group_payload(visual_style="vibrant"), product),
                (group_payload(requested_poster_count=2), product),
                (group_payload(text_rendering_mode="local"), product),
                (
                    group_payload(generation_mode="legacy_background_composite"),
                    product,
                ),
                (original, png_bytes(size=(49, 72), color=(1, 2, 3, 255))),
            ]
            for changed_payload, changed_product in changed_requests:
                conflict = submit(client, changed_payload, changed_product, key)
                self.assertEqual(409, conflict.status_code, conflict.text)
                self.assertEqual("idempotency_conflict", conflict.json()["error"]["code"])
            self.assertEqual(1, session.post_calls)
            client.close()

    def test_concurrent_same_key_executes_group_provider_once(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            session = success_session()
            stack = create_stack(Path(temporary), session, enabled=True)
            key = str(uuid.uuid4())
            product = png_bytes(size=(48, 72), transparent_border=True)
            responses = []
            failures = []

            def worker() -> None:
                try:
                    local_client = OfflineASGIClient(
                        stack["client"].app, raise_server_exceptions=False
                    )
                    responses.append(submit(local_client, group_payload(), product, key))
                    local_client.close()
                except BaseException as exc:  # pragma: no cover - diagnostic capture
                    failures.append(exc)

            threads = [threading.Thread(target=worker) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=30)
            self.assertEqual([], failures)
            self.assertEqual([200, 200], sorted(item.status_code for item in responses))
            self.assertEqual(
                1, len({item.json()["generation_id"] for item in responses})
            )
            self.assertEqual(1, session.post_calls)
            stack["client"].close()

    def test_new_mode_source_isolation_and_safe_logging(self) -> None:
        source = inspect.getsource(GenerationService._generate_product_poster_group)
        forbidden = {
            "_category_key",
            "build_background_scene_prompt",
            "cutout_bytes",
            "calculate_product_plan",
            "render_poster_variant",
            "ImageOps.fit",
            "text_layout",
            "background only",
            "do not generate any product",
        }
        self.assertTrue(
            all(fragment not in source for fragment in forbidden),
            source,
        )

        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        root_logger = logging.getLogger()
        root_logger.addHandler(handler)
        try:
            with tempfile.TemporaryDirectory() as temporary:
                session = CountingGroupSession(
                    post_result=provider_json_response(
                        [{"url": "https://provider-result.invalid/only.png"}]
                    )
                )
                stack = create_stack(Path(temporary), session, enabled=True)
                response = submit(
                    stack["client"],
                    group_payload(),
                    png_bytes(size=(48, 72), transparent_border=True),
                    str(uuid.uuid4()),
                )
                self.assertEqual(502, response.status_code)
                stack["client"].close()
        finally:
            root_logger.removeHandler(handler)
        captured = stream.getvalue()
        self.assertNotIn("offline-test-key", captured)
        self.assertNotIn("Authorization", captured)
        self.assertNotIn("data:image/png;base64,", captured)
        self.assertNotIn("provider-result.invalid", captured)


if __name__ == "__main__":
    unittest.main()
