from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from my_agent.backend.api.schemas import GenerationRequest, MarketingAdviceRequest
from my_agent.backend.core.config import Settings
from my_agent.backend.main import create_app
from my_agent.backend.domain.models import MarketingCopy
from my_agent.backend.services.generation_service import GenerationService
from my_agent.backend.services.image_generation_service import ImageGenerationService
from my_agent.backend.services.marketing_advice_service import MarketingAdviceService
from my_agent.backend.storage.artifact_store import ArtifactStore
from my_agent.tests.helpers import (
    FakeSeedreamProvider,
    FakeStockProvider,
    OfflineASGIClient,
    settings_for,
)


def _tree(root: Path) -> tuple[tuple[str, str, str], ...]:
    return tuple(
        (
            "directory" if path.is_dir() else "file",
            path.relative_to(root).as_posix(),
            "" if path.is_dir() else hashlib.sha256(path.read_bytes()).hexdigest(),
        )
        for path in sorted(root.rglob("*"), key=lambda item: item.as_posix())
    )


class CapturingCopyClient:
    """Provider seam that fails closed if a test reaches an unexpected call."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings
        self.calls: list[dict[str, object]] = []

    def generate_marketing_copy_variants(
        self,
        product_info: str,
        short_name: str,
        visual_style: str,
        creative_note: str,
        *,
        target_platform: str,
        count: int,
        marketing_advice_context: str | None = None,
    ) -> list[MarketingCopy]:
        self.calls.append(
            {
                "product_info": product_info,
                "short_name": short_name,
                "visual_style": visual_style,
                "creative_note": creative_note,
                "target_platform": target_platform,
                "count": count,
                "marketing_advice_context": marketing_advice_context,
            }
        )
        return [
            MarketingCopy(
                body="验证用宣传文案",
                title="验证标题",
                headline="验证主标题",
                subline="验证副标题",
            )
        ]


def copy_payload(**changes: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "product_info": "丝绒质感哑光口红",
        "product_short_name": "丝绒口红",
        "creative_note": "黑金氛围",
        "visual_style": "premium",
        "target_platform": "xiaohongshu",
        "generate_poster": False,
        "background_mode": "procedural",
        "output_size": "512x768",
        "product_type": "bag_heavy",
        "generation_mode": "legacy_background_composite",
        "copy_variant_count": 3,
    }
    payload.update(changes)
    return payload


class GenerationMarketingAdviceReferenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.settings = settings_for(self.root)
        self.store = ArtifactStore(self.settings.artifact_root)
        self.copy = CapturingCopyClient(self.settings)
        self.seedream = FakeSeedreamProvider(configured=False)
        self.stock = FakeStockProvider(image=None, configured=False)
        self.service = GenerationService(
            self.copy,
            ImageGenerationService(self.seedream, self.stock),
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

    def _reference(self) -> dict[str, str]:
        advice = MarketingAdviceService(self.settings).create(
            MarketingAdviceRequest(
                product_info="丝绒质感哑光口红",
                product_short_name="丝绒口红",
                creative_note="黑金氛围",
            )
        )
        return {
            "advice_version": advice.advice_version,
            "input_signature_sha256": advice.input_signature_sha256,
            "advice_signature_sha256": advice.advice_signature_sha256,
        }

    def _post(self, payload: dict[str, object]):
        return self.client.post(
            "/api/v1/generations",
            data={"payload": json.dumps(payload)},
            headers={"X-Idempotency-Key": str(uuid.uuid4())},
        )

    def test_reference_schema_is_strict_and_optional(self) -> None:
        request = GenerationRequest.model_validate(copy_payload())
        self.assertIsNone(request.marketing_advice_ref)
        invalid = copy_payload(
            marketing_advice_ref={
                **self._reference(),
                "unexpected": "not allowed",
            }
        )
        with self.assertRaises(ValidationError):
            GenerationRequest.model_validate(invalid)

    def test_valid_reference_is_recomputed_and_only_validated_advice_reaches_copy_seam(self) -> None:
        reference = self._reference()
        response = self._post(copy_payload(marketing_advice_ref=reference))

        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(1, len(self.copy.calls))
        context = self.copy.calls[0]["marketing_advice_context"]
        self.assertIsInstance(context, str)
        self.assertIn("推荐策略", context)
        self.assertIn("匹配关键词", context)
        self.assertIn("置信度", context)
        self.assertNotIn(reference["input_signature_sha256"], context)
        self.assertNotIn(reference["advice_signature_sha256"], context)
        self.assertEqual(0, self.seedream.calls)
        self.assertEqual(0, self.stock.calls)
        self.assertEqual(1, len(self.service.idempotency._entries))

    def test_invalid_reference_has_no_copy_provider_artifact_or_idempotency_side_effect(self) -> None:
        cases = (
            ("input", {**self._reference(), "input_signature_sha256": "0" * 64}),
            ("version", {**self._reference(), "advice_version": "catalog-v0"}),
        )
        for label, reference in cases:
            with self.subTest(label=label):
                before_tree = _tree(self.settings.artifact_root)
                before_entries = len(self.service.idempotency._entries)
                response = self._post(copy_payload(marketing_advice_ref=reference))
                self.assertEqual(422, response.status_code, response.text)
                self.assertEqual(before_tree, _tree(self.settings.artifact_root))
                self.assertEqual(before_entries, len(self.service.idempotency._entries))
                self.assertEqual(0, len(self.copy.calls))
                self.assertEqual(0, self.seedream.calls)
                self.assertEqual(0, self.stock.calls)

    def test_stale_advice_output_signature_still_allows_copy_when_input_matches(self) -> None:
        reference = self._reference()
        reference["advice_signature_sha256"] = "1" * 64
        response = self._post(copy_payload(marketing_advice_ref=reference))
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(1, len(self.copy.calls))

    def test_reference_is_rejected_on_poster_modes_before_image_or_provider_work(self) -> None:
        response = self._post(
            copy_payload(
                generation_mode="seedream_product_poster_sequence",
                generate_poster=True,
                marketing_advice_ref=self._reference(),
            )
        )
        self.assertEqual(422, response.status_code, response.text)
        self.assertEqual("marketing_advice_ref_not_allowed", response.json()["error"]["code"])
        self.assertEqual([], self.copy.calls)
        self.assertEqual(0, self.seedream.calls)
        self.assertEqual(0, self.stock.calls)
        self.assertEqual({}, self.service.idempotency._entries)

    def test_omitted_reference_uses_the_legacy_copy_client_call_shape(self) -> None:
        response = self._post(copy_payload())
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(1, len(self.copy.calls))
        self.assertIsNone(self.copy.calls[0]["marketing_advice_context"])

    def test_openapi_keeps_existing_advice_endpoint_contract(self) -> None:
        document = self.app.openapi()
        advice = document["paths"]["/api/v1/marketing-advice"]["post"]
        self.assertEqual(
            {"$ref": "#/components/schemas/MarketingAdviceRequest"},
            advice["requestBody"]["content"]["application/json"]["schema"],
        )
        self.assertEqual(
            {"$ref": "#/components/schemas/MarketingAdviceResponse"},
            advice["responses"]["200"]["content"]["application/json"]["schema"],
        )


if __name__ == "__main__":
    unittest.main()
