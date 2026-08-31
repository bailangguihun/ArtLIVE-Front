from __future__ import annotations

import unittest

from pydantic import ValidationError

from my_agent.backend.api.routes import _fingerprint
from my_agent.backend.api.schemas import GenerationRequest
from my_agent.backend.prompts.poster_style_templates import (
    PAPER_DOODLE_GRID,
    SOFT_FLORAL_FLATLAY,
    WARM_COLLECTIBLE_POSTER,
    resolve_poster_style_template,
)
from my_agent.backend.prompts.product_poster_sequence_prompt import (
    build_product_poster_sequence_prompts,
)


def sequence_payload(**changes: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "product_info": "Reference product packaging",
        "product_short_name": "Reference product",
        "creative_note": "Refined playful campaign",
        "visual_style": "premium",
        "target_platform": "xiaohongshu",
        "generate_poster": True,
        "generation_mode": "seedream_product_poster_sequence",
        "send_product_to_provider": True,
        "requested_poster_count": 3,
        "text_rendering_mode": "local",
        "output_size": "1024x1536",
    }
    payload.update(changes)
    return payload


def prompts(
    style_template_id: str | None = None,
    sequence_typography_mode: str | None = None,
) -> list[str]:
    return build_product_poster_sequence_prompts(
        product_info="Reference product packaging",
        product_short_name="Reference product",
        creative_note="Refined playful campaign",
        visual_style="premium",
        generated_marketing_copy="Current campaign copy",
        exact_poster_title="Current title",
        exact_headline="Current headline",
        exact_subline="Current subline",
        marketing_advice_context="Show product fidelity first.",
        output_aspect_ratio="2:3",
        style_template_id=style_template_id,
        sequence_typography_mode=sequence_typography_mode,
    )


class PosterStyleTemplateTests(unittest.TestCase):
    def test_schema_allows_only_absent_null_or_the_approved_id(self) -> None:
        self.assertIsNone(
            GenerationRequest.model_validate(sequence_payload()).style_template_id
        )
        self.assertIsNone(
            GenerationRequest.model_validate(
                sequence_payload(style_template_id=None)
            ).style_template_id
        )
        self.assertEqual(
            "paper_doodle_grid",
            GenerationRequest.model_validate(
                sequence_payload(style_template_id="paper_doodle_grid")
            ).style_template_id,
        )
        self.assertEqual(
            "warm_collectible_poster",
            GenerationRequest.model_validate(
                sequence_payload(style_template_id="warm_collectible_poster")
            ).style_template_id,
        )
        self.assertEqual(
            "soft_floral_flatlay",
            GenerationRequest.model_validate(
                sequence_payload(style_template_id="soft_floral_flatlay")
            ).style_template_id,
        )
        with self.assertRaises(ValidationError):
            GenerationRequest.model_validate(
                sequence_payload(style_template_id="unknown_template")
            )

    def test_default_fingerprint_is_preserved_and_template_fingerprint_is_distinct(
        self,
    ) -> None:
        absent = GenerationRequest.model_validate(sequence_payload())
        explicit_null = GenerationRequest.model_validate(
            sequence_payload(style_template_id=None)
        )
        paper = GenerationRequest.model_validate(
            sequence_payload(style_template_id="paper_doodle_grid")
        )
        absent_fingerprint = _fingerprint(absent, b"product", None)
        self.assertEqual(
            absent_fingerprint,
            _fingerprint(explicit_null, b"product", None),
        )
        self.assertNotEqual(
            absent_fingerprint,
            _fingerprint(paper, b"product", None),
        )
        self.assertEqual(
            _fingerprint(paper, b"product", None),
            _fingerprint(paper, b"product", None),
        )

    def test_openapi_documents_only_the_authorized_embedded_template_id(self) -> None:
        from my_agent.backend.main import app

        payload_schema = app.openapi()["components"]["schemas"][
            "Body_create_generation_api_v1_generations_post"
        ]["properties"]["payload"]
        self.assertEqual(payload_schema["contentMediaType"], "application/json")
        template_schema = payload_schema["contentSchema"]["properties"][
            "style_template_id"
        ]
        template_consts = {
            option["const"]
            for option in template_schema["anyOf"]
            if option.get("type") == "string"
        }
        self.assertEqual(
            {
                "paper_doodle_grid",
                "warm_collectible_poster",
                "soft_floral_flatlay",
            },
            template_consts,
        )

    def test_default_prompt_contract_remains_textless_and_single_frame(self) -> None:
        for prompt in prompts():
            self.assertIn("TEXTLESS visual base", prompt)
            self.assertIn("Do not add typography", prompt)
            self.assertIn("Do not duplicate the product", prompt)
            self.assertIn("Do not create multiple poster frames or a multi-panel layout", prompt)
            self.assertNotIn("Selected fixed poster style template", prompt)

    def test_paper_doodle_grid_controls_each_of_the_three_prompts(self) -> None:
        template_prompts = prompts("paper_doodle_grid", "with_text")
        self.assertEqual(3, len(template_prompts))
        self.assertEqual("纸上奇想四格", PAPER_DOODLE_GRID.alias)
        self.assertEqual(1, PAPER_DOODLE_GRID.version)
        self.assertTrue(PAPER_DOODLE_GRID.allow_multi_panel)
        self.assertTrue(PAPER_DOODLE_GRID.allow_repeated_product)
        self.assertEqual("provider_generated", PAPER_DOODLE_GRID.typography_mode)

        for prompt in template_prompts:
            self.assertIn("Selected fixed poster style template: paper_doodle_grid v1", prompt)
            self.assertIn("暖白纸张背景", prompt)
            self.assertIn("2×2四宫格结构", prompt)
            self.assertIn("黑色精致手绘涂鸦", prompt)
            self.assertIn("真实产品包装或产品本体", prompt)
            self.assertIn("第一格让产品成为飞行装置", prompt)
            self.assertIn("允许少量克制的中英文品牌文案", prompt)
            self.assertIn("不要电商主图感", prompt)
            self.assertIn("Current poster-copy context", prompt)
            self.assertIn("Preserve the recognizable product silhouette", prompt)
            self.assertNotIn("TEXTLESS visual base", prompt)
            self.assertNotIn("Do not add typography of any kind", prompt)
            self.assertNotIn("Do not duplicate the product", prompt)
            self.assertNotIn("Do not create multiple poster frames or a multi-panel layout", prompt)

    def test_paper_doodle_grid_textless_template_stays_textless(self) -> None:
        for prompt in prompts("paper_doodle_grid", "textless"):
            self.assertIn("TEXTLESS visual base", prompt)
            self.assertIn("Selected fixed poster style template: paper_doodle_grid v1", prompt)
            self.assertNotIn("provider-rendered CN/EN brand typography", prompt)

    def test_warm_collectible_poster_uses_the_collectible_single_frame_contract(self) -> None:
        template_prompts = prompts("warm_collectible_poster", "with_text")
        self.assertEqual(3, len(template_prompts))
        self.assertEqual("收藏级暖白海报", WARM_COLLECTIBLE_POSTER.alias)
        self.assertFalse(WARM_COLLECTIBLE_POSTER.allow_multi_panel)
        self.assertFalse(WARM_COLLECTIBLE_POSTER.allow_repeated_product)
        for prompt in template_prompts:
            self.assertIn(
                "Selected fixed poster style template: warm_collectible_poster v1",
                prompt,
            )
            self.assertIn("收藏级品牌广告海报", prompt)
            self.assertIn("单一完整海报画面", prompt)
            self.assertIn("不要多宫格", prompt)
            self.assertIn("根据品牌自动识别最具代表性的产品包装或产品形态", prompt)
            self.assertIn("single-frame collectible brand poster", prompt)
            self.assertNotIn("2×2四宫格结构", prompt)
            self.assertNotIn("Keep the 2×2 grid rigorously intact", prompt)

    def test_soft_floral_flatlay_uses_the_floral_flatlay_contract(self) -> None:
        template_prompts = prompts("soft_floral_flatlay", "with_text")
        self.assertEqual(3, len(template_prompts))
        self.assertEqual("柔光粉白花漾", SOFT_FLORAL_FLATLAY.alias)
        self.assertFalse(SOFT_FLORAL_FLATLAY.allow_multi_panel)
        for prompt in template_prompts:
            self.assertIn(
                "Selected fixed poster style template: soft_floral_flatlay v1",
                prompt,
            )
            self.assertIn("粉白柔光美学", prompt)
            self.assertIn("精致粉白色花朵环绕点缀", prompt)
            self.assertIn("平铺于白色纸张", prompt)
            self.assertIn("floral", prompt.lower())
            self.assertIn("single-frame collectible brand poster", prompt)
            self.assertNotIn("2×2四宫格结构", prompt)

    def test_registry_fails_closed_for_unknown_ids(self) -> None:
        self.assertIsNone(resolve_poster_style_template(None))
        self.assertIs(resolve_poster_style_template("paper_doodle_grid"), PAPER_DOODLE_GRID)
        self.assertIs(
            resolve_poster_style_template("warm_collectible_poster"),
            WARM_COLLECTIBLE_POSTER,
        )
        self.assertIs(
            resolve_poster_style_template("soft_floral_flatlay"),
            SOFT_FLORAL_FLATLAY,
        )
        with self.assertRaisesRegex(ValueError, "unsupported poster style template"):
            resolve_poster_style_template("unknown_template")


if __name__ == "__main__":
    unittest.main()
