from __future__ import annotations

import unittest

from pydantic import ValidationError

from my_agent.backend.api.routes import (
    _validate_v2_poster_copy_source,
    _validated_marketing_advice_for_copy,
)
from my_agent.backend.api.schemas import GenerationRequest, MarketingAdviceRequest
from my_agent.backend.services.marketing_advice_service import MarketingAdviceService


class V2PosterCopySourceTests(unittest.TestCase):
    def _reference(self) -> dict[str, str]:
        result = MarketingAdviceService().create(
            MarketingAdviceRequest(
                product_info="丝绒哑光口红",
                product_short_name="丝绒口红",
                creative_note="黑金氛围",
            )
        )
        return {
            "advice_version": result.advice_version,
            "input_signature_sha256": result.input_signature_sha256,
            "advice_signature_sha256": result.advice_signature_sha256,
        }

    def _payload(self, *, mode: str = "poster_owned") -> dict[str, object]:
        reference = self._reference()
        payload: dict[str, object] = {
            "product_info": "丝绒哑光口红",
            "product_short_name": "丝绒口红",
            "creative_note": "黑金氛围",
            "visual_style": "premium",
            "target_platform": "xiaohongshu",
            "generate_poster": True,
            "generation_mode": "seedream_product_poster_sequence",
            "send_product_to_provider": True,
            "requested_poster_count": 3,
            "text_rendering_mode": "local",
            "output_size": "1024x1536",
            "marketing_advice_ref": reference,
            "v2_poster_copy_source": {"mode": mode},
        }
        if mode == "confirmed_copy":
            ref = {
                "version": "workflow-v2-copy-ref-v1",
                "copy_authority_version": "workflow-v2-confirmed-copy-v1",
                "revision": 1,
                "basic_owner": {
                    "text_signature_sha256": "1" * 64,
                    "settings_signature_sha256": "2" * 64,
                },
                "advice_owner": {
                    "kind": "present",
                    "authority_version": "workflow-v2-advice-authority-v1",
                    "advice_version": "catalog-v1",
                    "input_signature_sha256": reference["input_signature_sha256"],
                    "advice_signature_sha256": reference["advice_signature_sha256"],
                    "owner_signature_sha256": "3" * 64,
                },
                "input_signature_sha256": "4" * 64,
                "output_signature_sha256": "5" * 64,
            }
            frozen = {
                "body": "冻结文案",
                "title": "标题",
                "headline": "主标题",
                "subline": "副标题",
                "platform": "xiaohongshu",
                "style": "premium",
                "source_copy_ref": ref,
            }
            payload.update(
                {
                    "prefilled_copy_body": frozen["body"],
                    "prefilled_copy_title": frozen["title"],
                    "prefilled_copy_headline": frozen["headline"],
                    "prefilled_copy_subline": frozen["subline"],
                    "v2_poster_copy_source": {
                        "mode": mode,
                        "copy_ref": ref,
                        "frozen_copy": frozen,
                    },
                }
            )
        return payload

    def test_poster_owned_source_has_no_prefilled_copy_and_validates_advice(self) -> None:
        parsed = GenerationRequest.model_validate(self._payload())
        self.assertEqual("poster_owned", parsed.v2_poster_copy_source.mode)
        _validate_v2_poster_copy_source(parsed)
        advice = _validated_marketing_advice_for_copy(parsed, MarketingAdviceService())
        self.assertIsNotNone(advice)
        self.assertEqual("", parsed.prefilled_copy_body)

    def test_confirmed_copy_source_freezes_exact_reference(self) -> None:
        parsed = GenerationRequest.model_validate(self._payload(mode="confirmed_copy"))
        _validate_v2_poster_copy_source(parsed)
        self.assertEqual(
            parsed.prefilled_copy_body,
            parsed.v2_poster_copy_source.frozen_copy.body,
        )

    def test_mixed_or_unknown_source_is_rejected_strictly(self) -> None:
        mixed = self._payload()
        mixed["prefilled_copy_body"] = "not allowed"
        parsed = GenerationRequest.model_validate(mixed)
        with self.assertRaisesRegex(Exception, "不能包含预填"):
            _validate_v2_poster_copy_source(parsed)
        unknown = self._payload()
        unknown["v2_poster_copy_source"] = {"mode": "poster_owned", "unknown": True}
        with self.assertRaises(ValidationError):
            GenerationRequest.model_validate(unknown)


if __name__ == "__main__":
    unittest.main()
