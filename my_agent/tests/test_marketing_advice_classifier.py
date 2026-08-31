from __future__ import annotations

import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from my_agent.backend.integrations.marketing_advice_classifier import (
    AiMarketingAdviceClassifier,
    classify_product_category_smart,
    _CLASSIFICATION_CACHE,
)
from my_agent.marketing_strategy_catalog import classify_product_category
from my_agent.tests.helpers import settings_for


class MarketingAdviceClassifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.settings = settings_for(Path(self.temporary.name))
        self.offline_service = classify_product_category_smart

    def test_smart_classifier_falls_back_without_api_key(self) -> None:
        result = self.offline_service(
            settings=self.settings,
            product_info="quasar object 947",
        )
        expected = classify_product_category(product_info="quasar object 947")
        self.assertEqual(expected, result)

    def test_smart_classifier_uses_ai_when_configured(self) -> None:
        configured = replace(self.settings, deepseek_api_key="test-key")
        classifier = AiMarketingAdviceClassifier(configured)
        with patch.object(
            classifier,
            "_chat",
            return_value=(
                '{"product_form":"大牌木质调香水","market_tier":"luxury",'
                '"purchase_pattern":"低频次礼品决策","category_id":"luxury",'
                '"confidence":"high","reason":"强调礼盒与品牌溢价",'
                '"matched_signals":["香水","礼盒","木质调"]}'
            ),
        ):
            result = classifier.classify(product_info="木质调香水礼盒")
        self.assertEqual("luxury", result["category_id"])
        self.assertEqual("high", result["confidence"])
        self.assertEqual(["香水", "礼盒", "木质调"], result["matched_keywords"])
        self.assertIn("AI 智能识别", result["reason"])
        self.assertIn("奢侈/大牌", result["reason"])

    def test_smart_classifier_falls_back_when_ai_response_invalid(self) -> None:
        configured = replace(self.settings, deepseek_api_key="test-key")
        classifier = AiMarketingAdviceClassifier(configured)
        with patch.object(classifier, "_chat", return_value='{"category_id":"unknown"}'):
            result = classify_product_category_smart(
                settings=configured,
                product_info="洗衣液",
            )
        self.assertEqual("fmcg", result["category_id"])

    def test_smart_classifier_caches_identical_input(self) -> None:
        _CLASSIFICATION_CACHE.clear()
        configured = replace(self.settings, deepseek_api_key="test-key")
        with patch.object(
            AiMarketingAdviceClassifier,
            "_chat",
            return_value=(
                '{"product_form":"大牌木质调香水","market_tier":"luxury",'
                '"purchase_pattern":"低频次礼品决策","category_id":"luxury",'
                '"confidence":"high","reason":"礼盒","matched_signals":["香水"]}'
            ),
        ) as chat:
            first = classify_product_category_smart(
                settings=configured,
                product_info="木质调香水礼盒",
            )
            second = classify_product_category_smart(
                settings=configured,
                product_info="木质调香水礼盒",
            )
        self.assertEqual(first, second)
        chat.assert_called_once()
        configured = replace(self.settings, deepseek_api_key="test-key")
        classifier = AiMarketingAdviceClassifier(configured)
        with patch.object(
            classifier,
            "_chat",
            return_value=(
                '{"product_form":"便携小风扇","market_tier":"mass",'
                '"purchase_pattern":"中低频耐用品决策","category_id":"durable",'
                '"confidence":"medium","reason":"属于小家电耐用品",'
                '"matched_signals":["风扇","降温"]}'
            ),
        ):
            result = classifier.classify(
                product_info="夏日露营用的便携降温设备，静音、续航长"
            )
        self.assertEqual("durable", result["category_id"])
        self.assertEqual("medium", result["confidence"])


if __name__ == "__main__":
    unittest.main()
