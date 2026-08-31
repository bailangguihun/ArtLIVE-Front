from __future__ import annotations

import ast
import base64
import io
import json
import logging
import tempfile
import threading
import unittest
import uuid
import zipfile
from dataclasses import replace
from pathlib import Path

from PIL import Image

from my_agent.backend.api.routes import _fingerprint
from my_agent.backend.api.schemas import GenerationRequest
from my_agent.backend.core.config import ConfigurationError, Settings
from my_agent.backend.domain.models import (
    CompleteProductPosterResult,
    GeneratedImage,
    GenerationCommand,
    MarketingCopy,
    ProductPosterSequenceCommand,
    ProductReferenceMetadata,
)
from my_agent.backend.integrations.seedream_client import (
    ImageProviderError,
    SeedreamClient,
    SingleImageResultError,
)
from my_agent.backend.main import create_app
from my_agent.backend.prompts.product_poster_sequence_prompt import (
    SEQUENCE_CONCEPTS,
    build_product_poster_sequence_prompts,
)
from my_agent.backend.services.generation_service import (
    GenerationService,
    IdempotencyConflictError,
)
from my_agent.backend.services.product_poster_sequence_service import (
    ProductPosterSequenceService,
)
from my_agent.backend.storage.artifact_store import ArtifactStore
from my_agent.backend_api_client import (
    PRODUCT_POSTER_SEQUENCE_MODE,
    build_product_poster_sequence_payload,
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


def png_data(size: tuple[int, int], color: tuple[int, int, int, int]) -> bytes:
    output = io.BytesIO()
    Image.new("RGBA", size, color).save(output, format="PNG")
    return output.getvalue()


def provider_response(url: str) -> FakeHTTPResponse:
    body = json.dumps({"data": [{"url": url}]}).encode("utf-8")
    return FakeHTTPResponse(body, status_code=200)


def b64_provider_response(items: list[bytes]) -> FakeHTTPResponse:
    body = json.dumps(
        {
            "data": [
                {"b64_json": base64.b64encode(value).decode("ascii")}
                for value in items
            ]
        }
    ).encode("utf-8")
    return FakeHTTPResponse(body, status_code=200)


class LegacyImageServiceSpy:
    seedream_configured = True
    stock_configured = False

    def __init__(self) -> None:
        self.acquire_calls = 0

    def acquire(self, **kwargs):
        _ = kwargs
        self.acquire_calls += 1
        raise AssertionError("legacy background acquisition is forbidden")


class ObservedHTTPSession(FakeHTTPSession):
    def __init__(self, post_result, get_result, observer=None) -> None:
        super().__init__(post_result=post_result, get_result=get_result)
        self.observer = observer
        self.post_payloads: list[dict[str, object]] = []
        self.maximum_in_flight = 0
        self._in_flight = 0

    def post(self, url: str, **kwargs):
        self.post_calls += 1
        self.last_post = {"url": url, **kwargs}
        self.post_payloads.append(json.loads(kwargs["data"].decode("utf-8")))
        self._in_flight += 1
        self.maximum_in_flight = max(self.maximum_in_flight, self._in_flight)
        try:
            if self.observer is not None:
                self.observer(self.post_calls)
            result = self._resolve(self.post_result)
            if result is None:
                raise AssertionError("unexpected HTTP POST")
            return result
        finally:
            self._in_flight -= 1


def active_settings(root: Path, *, enabled: bool = True) -> Settings:
    return replace(
        settings_for(root, seedream_configured=True),
        seedream_api_key="synthetic-test-key",
        seedream_model_id=MODEL_ID,
        seedream_image_size=PROVIDER_SIZE,
        enable_seedream_product_poster_group=False,
        enable_seedream_product_poster_sequence=enabled,
    )


def sequence_payload(**changes: object) -> dict[str, object]:
    payload = build_product_poster_sequence_payload(
        product_info="Synthetic jewelry",
        product_short_name="Synthetic",
        creative_note="Use precise cool highlights",
        visual_style="premium",
        consent=True,
    )
    payload.update(changes)
    return payload


def sequence_command(product: bytes | None = None, **changes: object) -> GenerationCommand:
    values: dict[str, object] = {
        "product_info": "Synthetic jewelry",
        "product_short_name": "Synthetic",
        "creative_note": "Use precise cool highlights",
        "visual_style": "premium",
        "generate_poster": True,
        "background_mode": "seedream_text",
        "output_size": PROVIDER_SIZE,
        "product_type": "flat_small",
        "product_image": product or png_bytes((32, 48), transparent_border=True),
        "background_reference": None,
        "generation_mode": PRODUCT_POSTER_SEQUENCE_MODE,
        "send_product_to_provider": True,
        "requested_poster_count": 3,
        "text_rendering_mode": "local",
    }
    values.update(changes)
    return GenerationCommand(**values)  # type: ignore[arg-type]


def multipart(payload: dict[str, object], product: bytes) -> dict[str, tuple]:
    return {
        "payload": (
            None,
            json.dumps(payload, ensure_ascii=False),
            "application/json",
        ),
        "product_image": ("synthetic.png", product, "image/png"),
    }


def real_sequence_stack(root: Path, session: FakeHTTPSession, *, enabled: bool = True):
    settings = active_settings(root, enabled=enabled)
    store = ArtifactStore(settings.artifact_root, settings.max_image_pixels)
    seedream = SeedreamClient(settings, session=session)
    legacy = LegacyImageServiceSpy()
    sequence = ProductPosterSequenceService(seedream)
    service = GenerationService(
        copy_client=FakeCopyClient(),
        image_service=legacy,
        artifact_store=store,
        product_poster_sequence_service=sequence,
        enable_product_poster_sequence=enabled,
    )
    client = OfflineASGIClient(create_app(settings, service, store))
    return settings, store, service, legacy, client


def reference_metadata() -> ProductReferenceMetadata:
    return ProductReferenceMetadata(
        original_mime_type="image/png",
        normalized_mime_type="image/png",
        decoded_width=32,
        decoded_height=48,
        normalized_width=32,
        normalized_height=48,
        original_byte_length=100,
        normalized_byte_length=100,
        normalized_sha256="0" * 64,
    )


class ControlledSequenceService:
    configured = True
    provider_size = PROVIDER_SIZE
    provider_aspect_ratio = "2:3"
    model_id = MODEL_ID

    def __init__(self, *, fail_index: int | None = None, block_index: int | None = None):
        self.fail_index = fail_index
        self.block_index = block_index
        self.calls: list[int] = []
        self.snapshots: list[dict[str, object]] = []
        self.started = threading.Event()
        self.release = threading.Event()
        self.active = 0
        self.maximum_active = 0
        self.store: ArtifactStore | None = None
        self.generation_id = ""

    def generate_poster(self, command, *, poster_index, local_request_id, generation_id, provider_attempt_count):
        _ = (command, local_request_id, provider_attempt_count)
        self.calls.append(poster_index)
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        try:
            if self.store is not None:
                self.snapshots.append(self.store.read_manifest(generation_id))
            if poster_index == self.block_index:
                self.started.set()
                if not self.release.wait(timeout=5):
                    raise RuntimeError("offline test release timeout")
            if poster_index == self.fail_index:
                raise ImageProviderError("invalid_request", "safe synthetic failure")
            color = (poster_index * 50, 30, 180, 255)
            image = Image.new("RGBA", (120, 180), color)
            return CompleteProductPosterResult(
                image=GeneratedImage(image, "seedream", "seedream", MODEL_ID),
                model=MODEL_ID,
                provider_size=PROVIDER_SIZE,
                provider_aspect_ratio="2:3",
                returned_dimensions=image.size,
                reference_metadata=reference_metadata(),
                sanitized_prompt_metadata={
                    "poster_index": poster_index,
                    "concept": SEQUENCE_CONCEPTS[poster_index - 1],
                    "prompt_sha256": str(poster_index) * 64,
                },
                provider_result_download_count=1,
            )
        finally:
            self.active -= 1


def controlled_stack(root: Path, controlled: ControlledSequenceService):
    settings = active_settings(root)
    store = ArtifactStore(settings.artifact_root, settings.max_image_pixels)
    legacy = LegacyImageServiceSpy()
    service = GenerationService(
        copy_client=FakeCopyClient(),
        image_service=legacy,
        artifact_store=store,
        product_poster_sequence_service=controlled,  # type: ignore[arg-type]
        enable_product_poster_sequence=True,
    )
    controlled.store = store
    return settings, store, service, legacy


class SequencePromptAndClientTests(unittest.TestCase):
    def test_three_category_free_single_prompts(self) -> None:
        prompts = build_product_poster_sequence_prompts(
            product_info="Synthetic jewelry",
            product_short_name="Synthetic",
            creative_note="Use cool highlights",
            visual_style="premium",
            generated_marketing_copy="Synthetic copy",
            exact_poster_title="TITLE",
            exact_headline="HEADLINE",
            exact_subline="SUBLINE",
            output_aspect_ratio="2:3",
        )
        self.assertEqual(3, len(prompts))
        for prompt in prompts:
            lowered = prompt.lower()
            self.assertIn("exactly one complete vertical advertising poster", lowered)
            self.assertIn("luxury editorial advertising", lowered)
            self.assertIn("use cool highlights", lowered)
            self.assertIn("synthetic jewelry", lowered)
            self.assertIn("textless", lowered)
            self.assertNotIn("title (render exactly", lowered)
            self.assertNotIn("headline (render exactly", lowered)
            for forbidden in (
                "collage",
                "triptych",
                "contact sheet",
                "three images",
                "product category",
                "wood tabletop",
                "linen curtains",
                "green leaves",
                "local compositing",
            ):
                self.assertNotIn(forbidden, lowered)
        self.assertIn("centered_hero", prompts[0])
        self.assertIn("editorial_closeup", prompts[1])
        self.assertIn("minimal_brand", prompts[2])

    def client(self, session: FakeHTTPSession) -> SeedreamClient:
        with tempfile.TemporaryDirectory() as temporary:
            settings = active_settings(Path(temporary))
        return SeedreamClient(settings, session=session)

    def test_single_payload_and_sanitized_audit_contract(self) -> None:
        response = b64_provider_response([png_data((80, 120), (20, 40, 60, 255))])
        session = FakeHTTPSession(post_result=response)
        client = self.client(session)
        with self.assertLogs("advertising_backend.provider_audit", level="INFO") as logs:
            result = client.generate_single_product_poster(
                prompt="Synthetic one-poster prompt",
                product_reference=png_bytes((32, 48)),
                local_request_id=str(uuid.uuid4()),
                generation_id=str(uuid.uuid4()),
                poster_index=1,
                provider_attempt_count=1,
            )
        payload = json.loads(session.last_post["data"].decode("utf-8"))
        self.assertEqual(
            {"model", "prompt", "image", "size", "response_format", "watermark"},
            set(payload),
        )
        self.assertEqual(MODEL_ID, payload["model"])
        self.assertEqual(PROVIDER_SIZE, payload["size"])
        self.assertEqual("url", payload["response_format"])
        self.assertFalse(payload["watermark"])
        self.assertIsInstance(payload["image"], list)
        self.assertEqual(1, len(payload["image"]))
        self.assertTrue(payload["image"][0].startswith("data:image/png;base64,"))
        self.assertEqual((80, 120), result.returned_dimensions)
        rendered_logs = "\n".join(logs.output)
        for forbidden in (
            "Synthetic one-poster prompt",
            "data:image",
            "synthetic-test-key",
            "Authorization",
            payload["image"][0],
        ):
            self.assertNotIn(forbidden, rendered_logs)
        self.assertIn("seedream_post_started", rendered_logs)
        self.assertIn('"poster_index":1', rendered_logs)
        self.assertEqual(1, session.post_calls)
        self.assertEqual(0, session.get_calls)

    def test_single_result_count_and_decode_failures_never_retry(self) -> None:
        cases = (
            (FakeHTTPResponse(b'{"data":[]}'), "provider_result_error"),
            (
                b64_provider_response(
                    [png_data((8, 12), (1, 2, 3, 255)), png_data((8, 12), (4, 5, 6, 255))]
                ),
                "unexpected_single_result_count",
            ),
            (FakeHTTPResponse(b'{"data":[{"b64_json":"%%%"}]}'), "invalid_response"),
        )
        for response, category in cases:
            with self.subTest(category=category):
                session = FakeHTTPSession(post_result=response)
                with self.assertRaises(ImageProviderError) as raised:
                    self.client(session).generate_single_product_poster(
                        prompt="Synthetic",
                        product_reference=png_bytes((16, 24)),
                    )
                self.assertEqual(category, raised.exception.category)
                self.assertEqual(1, session.post_calls)
        self.assertTrue(issubclass(SingleImageResultError, ImageProviderError))

    def test_fake_url_download_failure_is_typed_and_one_shot(self) -> None:
        session = FakeHTTPSession(
            post_result=provider_response("https://images.invalid/result.png"),
            get_result=FakeHTTPResponse(b"", status_code=500),
        )
        with self.assertRaises(ImageProviderError) as raised:
            self.client(session).generate_single_product_poster(
                prompt="Synthetic", product_reference=png_bytes((16, 24))
            )
        self.assertEqual("server_error", raised.exception.category)
        self.assertEqual(1, session.post_calls)
        self.assertEqual(1, session.get_calls)


class SequenceTaskAndAPITests(unittest.TestCase):
    def test_feature_gate_precedence_and_capabilities(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dotenv = root / "missing.env"
            default = Settings.from_env(root, dotenv_path=dotenv, environment={})
            fallback = Settings.from_env(
                root,
                dotenv_path=dotenv,
                environment={"ENABLE_SEEDREAM_PRODUCT_POSTER_GROUP": "true"},
            )
            precedence = Settings.from_env(
                root,
                dotenv_path=dotenv,
                environment={
                    "ENABLE_SEEDREAM_PRODUCT_POSTER_GROUP": "true",
                    "ENABLE_SEEDREAM_PRODUCT_POSTER_SEQUENCE": "false",
                },
            )
            self.assertFalse(default.enable_seedream_product_poster_sequence)
            self.assertTrue(fallback.enable_seedream_product_poster_sequence)
            self.assertFalse(precedence.enable_seedream_product_poster_sequence)
            self.assertFalse(precedence.enable_seedream_product_poster_group)
            with self.assertRaises(ConfigurationError):
                Settings.from_env(
                    root,
                    dotenv_path=dotenv,
                    environment={"ENABLE_SEEDREAM_PRODUCT_POSTER_SEQUENCE": "maybe"},
                )

            controlled = ControlledSequenceService()
            settings, store, service, _ = controlled_stack(root, controlled)
            api = OfflineASGIClient(create_app(settings, service, store))
            response = api.get("/api/v1/capabilities")
            modes = {item["mode"]: item for item in response.json()["generation_modes"]}
            sequence = modes[PRODUCT_POSTER_SEQUENCE_MODE]
            group = modes["seedream_product_poster_group"]
            self.assertTrue(sequence["implemented"])
            self.assertTrue(sequence["enabled"])
            self.assertFalse(sequence["provider_verified"])
            self.assertEqual(3, sequence["maximum_provider_request_count"])
            self.assertEqual("strictly_serial", sequence["execution"])
            self.assertFalse(group["enabled"])
            self.assertTrue(group["deprecated"])

    def test_disabled_gate_stops_before_task_and_provider(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            session = FakeHTTPSession()
            settings, store, _, _, api = real_sequence_stack(root, session, enabled=False)
            response = api.post(
                "/api/v1/generations",
                files=multipart(sequence_payload(), png_bytes((32, 48))),
                headers={"X-Idempotency-Key": str(uuid.uuid4())},
            )
            self.assertEqual(503, response.status_code)
            self.assertEqual("feature_disabled", response.json()["error"]["code"])
            self.assertEqual(0, session.post_calls)
            self.assertEqual([], list(settings.artifact_root.iterdir()))

    def test_http_202_real_mock_client_strict_serial_artifacts_and_downloads(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            observations: list[tuple[int, int, list[str], list[bool]]] = []
            store_holder: dict[str, ArtifactStore] = {}

            def observe(call_number: int) -> None:
                store = store_holder["store"]
                manifests = list(store.iter_manifests())
                self.assertEqual(1, len(manifests))
                manifest = manifests[0]
                observations.append(
                    (
                        call_number,
                        int(manifest["completed_poster_count"]),
                        [slot["status"] for slot in manifest["poster_slots"]],
                        [
                            (store.root / manifest["generation_id"] / f"poster-{index:02d}.png").is_file()
                            for index in (1, 2, 3)
                        ],
                    )
                )

            session = ObservedHTTPSession(
                post_result=[
                    provider_response(f"https://images.invalid/{index}.png")
                    for index in (1, 2, 3)
                ],
                get_result=[
                    FakeHTTPResponse(
                        png_data((1024, 1536), (index * 50, 20, 180, 255)),
                        status_code=200,
                    )
                    for index in (1, 2, 3)
                ],
                observer=observe,
            )
            _, store, service, legacy, api = real_sequence_stack(root, session)
            store_holder["store"] = store
            key = str(uuid.uuid4())
            response = api.post(
                "/api/v1/generations",
                files=multipart(sequence_payload(), png_bytes((32, 48))),
                headers={"X-Idempotency-Key": key},
            )
            self.assertEqual(202, response.status_code)
            self.assertEqual("queued", response.json()["status"])
            generation_id = response.json()["generation_id"]
            manifest = store.read_manifest(generation_id)
            self.assertEqual("completed", manifest["status"])
            self.assertEqual(3, manifest["completed_poster_count"])
            self.assertEqual(3, manifest["actual_provider_request_count"])
            self.assertEqual(0, manifest["automatic_retry_count"])
            self.assertEqual([1, 2, 3], [item[0] for item in observations])
            self.assertEqual(0, observations[0][1])
            self.assertEqual((1, True), (observations[1][1], observations[1][3][0]))
            self.assertEqual((2, True), (observations[2][1], observations[2][3][1]))
            self.assertEqual(1, session.maximum_in_flight)
            self.assertEqual(3, session.post_calls)
            self.assertEqual(3, session.get_calls)
            self.assertEqual(0, legacy.acquire_calls)
            for payload in session.post_payloads:
                self.assertEqual(
                    {"model", "prompt", "image", "size", "response_format", "watermark"},
                    set(payload),
                )
                self.assertEqual(1, len(payload["image"]))
            self.assertEqual(
                ["poster-01.png", "poster-02.png", "poster-03.png"],
                [item["file_name"] for item in manifest["posters"]],
            )
            status = api.get(f"/api/v1/generations/{generation_id}")
            self.assertEqual(200, status.status_code)
            document = status.json()
            self.assertEqual(3, len(document["posters"]))
            self.assertEqual([1, 2, 3], [item["index"] for item in document["posters"]])
            for poster in document["posters"]:
                preview = api.get(poster["preview_url"])
                download = api.get(poster["download_url"])
                self.assertEqual(200, preview.status_code)
                self.assertEqual(preview.content, download.content)
                with Image.open(io.BytesIO(download.content)) as decoded:
                    self.assertEqual((1024, 1536), decoded.size)
            archive = api.get(document["zip_download_url"])
            with zipfile.ZipFile(io.BytesIO(archive.content)) as zipped:
                self.assertEqual(
                    ["poster-01.png", "poster-02.png", "poster-03.png"],
                    zipped.namelist(),
                )

            replay = api.post(
                "/api/v1/generations",
                files=multipart(sequence_payload(), png_bytes((32, 48))),
                headers={"X-Idempotency-Key": key},
            )
            self.assertEqual(202, replay.status_code)
            self.assertEqual(generation_id, replay.json()["generation_id"])
            self.assertEqual(3, session.post_calls)
            conflict = api.post(
                "/api/v1/generations",
                files=multipart(sequence_payload(creative_note="changed"), png_bytes((32, 48))),
                headers={"X-Idempotency-Key": key},
            )
            self.assertEqual(409, conflict.status_code)
            self.assertEqual(3, session.post_calls)

    def test_progressive_ready_visibility_and_strict_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            controlled = ControlledSequenceService(block_index=2)
            settings, store, service, _ = controlled_stack(root, controlled)
            command = sequence_command()
            initial, owner = service.create_sequence_idempotent(
                command, str(uuid.uuid4()), str(uuid.uuid4()), "same"
            )
            self.assertTrue(owner)
            self.assertEqual("queued", initial.status)
            self.assertEqual(["waiting"] * 3, [slot.status for slot in initial.posters])
            worker = threading.Thread(
                target=service.run_sequence_task,
                args=(initial.generation_id, command),
            )
            worker.start()
            self.assertTrue(controlled.started.wait(timeout=3))
            current = service.get_result(initial.generation_id)
            self.assertEqual("running", current.status)
            self.assertEqual(1, current.completed_poster_count)
            self.assertEqual(2, current.current_poster_index)
            self.assertEqual(["ready", "generating", "waiting"], [slot.status for slot in current.posters])
            ready = current.posters[0]
            self.assertIsNotNone(ready.preview_url)
            api = OfflineASGIClient(create_app(settings, service, store))
            self.assertEqual(200, api.get(str(ready.preview_url)).status_code)
            self.assertEqual(404, api.get(f"/api/v1/generations/{initial.generation_id}/download").status_code)
            controlled.release.set()
            worker.join(timeout=5)
            self.assertFalse(worker.is_alive())
            completed = service.get_result(initial.generation_id)
            self.assertEqual("completed", completed.status)
            self.assertEqual([1, 2, 3], controlled.calls)
            self.assertEqual(1, controlled.maximum_active)
            snapshots = controlled.snapshots
            self.assertEqual(0, snapshots[0]["completed_poster_count"])
            self.assertEqual(1, snapshots[1]["completed_poster_count"])
            self.assertEqual(2, snapshots[2]["completed_poster_count"])

    def test_failure_at_each_slot_stops_and_preserves_ready_posters(self) -> None:
        expectations = {
            1: ("failed", 0, ["failed", "blocked", "blocked"]),
            2: ("partial_failed", 1, ["ready", "failed", "blocked"]),
            3: ("partial_failed", 2, ["ready", "ready", "failed"]),
        }
        for fail_index, expected in expectations.items():
            with self.subTest(fail_index=fail_index), tempfile.TemporaryDirectory() as temporary:
                controlled = ControlledSequenceService(fail_index=fail_index)
                _, store, service, _ = controlled_stack(Path(temporary), controlled)
                command = sequence_command()
                initial, _ = service.create_sequence_idempotent(
                    command, str(uuid.uuid4()), str(uuid.uuid4()), "fingerprint"
                )
                service.run_sequence_task(initial.generation_id, command)
                result = service.get_result(initial.generation_id)
                status, completed, slots = expected
                self.assertEqual(status, result.status)
                self.assertEqual(completed, result.completed_poster_count)
                self.assertEqual(slots, [slot.status for slot in result.posters])
                self.assertEqual(list(range(1, fail_index + 1)), controlled.calls)
                self.assertEqual(fail_index, result.actual_provider_request_count)
                self.assertEqual(0, result.automatic_retry_count)
                self.assertIsNone(result.zip_download_url)
                manifest = store.read_manifest(initial.generation_id)
                self.assertEqual(completed, len(manifest["posters"]))

    def test_idempotent_task_creation_and_conflict(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            controlled = ControlledSequenceService()
            _, store, service, _ = controlled_stack(Path(temporary), controlled)
            command = sequence_command()
            key = str(uuid.uuid4())
            first, first_owner = service.create_sequence_idempotent(
                command, str(uuid.uuid4()), key, "same"
            )
            second, second_owner = service.create_sequence_idempotent(
                command, str(uuid.uuid4()), key, "same"
            )
            self.assertTrue(first_owner)
            self.assertFalse(second_owner)
            self.assertEqual(first.generation_id, second.generation_id)
            self.assertEqual(1, len(list(store.iter_manifests())))
            with self.assertRaises(IdempotencyConflictError):
                service.create_sequence_idempotent(
                    sequence_command(product=png_bytes((40, 60))),
                    str(uuid.uuid4()),
                    key,
                    "changed",
                )
            self.assertEqual([], controlled.calls)

    def test_restart_reconciliation_preserves_ready_and_never_resumes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            controlled = ControlledSequenceService()
            _, store, service, _ = controlled_stack(Path(temporary), controlled)
            command = sequence_command()
            queued, _ = service.create_sequence_idempotent(
                command, str(uuid.uuid4()), str(uuid.uuid4()), "queued"
            )
            running, _ = service.create_sequence_idempotent(
                command, str(uuid.uuid4()), str(uuid.uuid4()), "running"
            )
            manifest = store.read_manifest(running.generation_id)
            record = store.save_sequence_poster(
                running.generation_id,
                Image.new("RGB", (120, 180), (1, 2, 3)),
                1,
            )
            manifest["posters"] = [record]
            manifest["completed_poster_count"] = 1
            manifest["actual_poster_count"] = 1
            manifest["status"] = "running"
            manifest["poster_slots"][0].update(
                {"status": "ready", "poster_id": record["poster_id"], "width": 120, "height": 180}
            )
            manifest["poster_slots"][1]["status"] = "generating"
            manifest["current_poster_index"] = 2
            store.write_manifest(running.generation_id, manifest)
            self.assertEqual(2, service.reconcile_interrupted_sequence_tasks())
            self.assertEqual("interrupted", service.get_result(queued.generation_id).status)
            recovered = service.get_result(running.generation_id)
            self.assertEqual("interrupted", recovered.status)
            self.assertEqual("ready", recovered.posters[0].status)
            self.assertEqual("failed", recovered.posters[1].status)
            self.assertEqual("blocked", recovered.posters[2].status)
            self.assertEqual([], controlled.calls)
            self.assertTrue(store.resolve_poster(running.generation_id, str(recovered.posters[0].poster_id)).is_file())

    def test_schema_fingerprint_and_mode_validation_are_result_sensitive(self) -> None:
        base = GenerationRequest.model_validate(sequence_payload())
        base_product = png_bytes((32, 48))
        original = _fingerprint(base, base_product, None)
        changed = (
            sequence_payload(creative_note="different"),
            sequence_payload(visual_style="vibrant"),
            sequence_payload(text_rendering_mode="provider"),
            sequence_payload(requested_poster_count=2),
        )
        for payload in changed:
            self.assertNotEqual(
                original,
                _fingerprint(GenerationRequest.model_validate(payload), base_product, None),
            )
        self.assertNotEqual(original, _fingerprint(base, png_bytes((40, 60)), None))


class StreamlitSequenceSourceTests(unittest.TestCase):
    def test_ui_uses_sequence_submit_once_and_get_only_polling(self) -> None:
        source = (APP_ROOT / "app.py").read_text(encoding="utf-8")
        client_source = (APP_ROOT / "backend_api_client.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        self.assertIn("Seedream 三张完整海报顺序生成（实验模式）", source)
        self.assertIn("等待前一张海报完成", source)
        self.assertIn("因前一张生成失败，本张未开始", source)
        self.assertIn("@st.fragment(run_every=2.0)", source)
        self.assertIn("PRODUCT_POSTER_SEQUENCE_MODE", source)
        self.assertNotIn(
            "[PRODUCT_POSTER_GROUP_MODE, \"legacy_background_composite\"]", source
        )
        self.assertEqual(0, source.count("build_product_poster_group_payload("))
        self.assertEqual(1, source.count("client.create_generation("))
        poll_start = source.index("def _poll_active_sequence")
        poll_end = source.index("result = st.session_state", poll_start)
        poll_source = source[poll_start:poll_end]
        self.assertIn("client.get_generation", poll_source)
        self.assertNotIn("create_generation", poll_source)
        self.assertIn("pending_idempotency_key", source)
        self.assertIn("get_generation", client_source)
        self.assertEqual(
            1,
            len(
                [
                    node
                    for node in ast.walk(tree)
                    if isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "form_submit_button"
                ]
            ),
        )

    def test_sequence_payload_excludes_category_and_background_fields(self) -> None:
        payload = sequence_payload()
        self.assertEqual(PRODUCT_POSTER_SEQUENCE_MODE, payload["generation_mode"])
        self.assertTrue(payload["send_product_to_provider"])
        self.assertEqual(3, payload["requested_poster_count"])
        self.assertEqual("local", payload["text_rendering_mode"])
        self.assertEqual(PROVIDER_SIZE, payload["output_size"])
        for field in (
            "product_type",
            "background_mode",
            "background_reference",
            "category_key",
            "text_layout",
            "placement",
        ):
            self.assertNotIn(field, payload)

    def test_production_sequence_sources_exclude_local_composition(self) -> None:
        service_source = (
            APP_ROOT / "backend" / "services" / "product_poster_sequence_service.py"
        ).read_text(encoding="utf-8")
        worker_source = ast.get_source_segment(
            (APP_ROOT / "backend" / "services" / "generation_service.py").read_text(encoding="utf-8"),
            next(
                node
                for node in ast.walk(
                    ast.parse(
                        (APP_ROOT / "backend" / "services" / "generation_service.py").read_text(encoding="utf-8")
                    )
                )
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                and node.name == "run_sequence_task"
            ),
        ) or ""
        combined = service_source + worker_source
        for forbidden in (
            "_category_key(",
            "build_background_scene_prompt(",
            "cutout_bytes(",
            "calculate_product_plan(",
            "render_poster_variant(",
            "ImageOps.fit(",
        ):
            self.assertNotIn(forbidden, combined)


if __name__ == "__main__":
    unittest.main()
