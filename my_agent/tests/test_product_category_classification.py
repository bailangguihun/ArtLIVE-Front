# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from my_agent.marketing_strategy_catalog import classify_product_category


class ProductCategoryClassificationTests(unittest.TestCase):
    def test_common_products_map_to_expected_categories(self) -> None:
        cases = {
            "丝绒质感哑光口红": "fmcg",
            "iPhone 15 Pro 手机": "durable",
            "智能扫地机器人": "durable",
            "无线蓝牙耳机降噪": "durable",
            "真皮沙发家具": "durable",
            "保洁上门服务": "service",
            "医美咨询体验课": "service",
            "在线AI绘画API工具": "digital",
            "SaaS会员订阅软件": "digital",
            "高端珠宝项链礼盒": "luxury",
            "茅台酒礼盒": "luxury",
            "企业ERP管理系统": "b2b",
            "服务器算力集群租赁": "b2b",
            "体检套餐年卡": "health",
            "儿童益生菌粉": "health",
            "维生素C泡腾片": "health",
            "夏天必备冰感小风扇": "durable",
            "最近偏爱一支木质调的香，前调是柑橘": "luxury",
            "淡香水 雪松": "luxury",
            "平价入门身体喷雾 9.9": "fmcg",
            "Chanel 五号淡香水 高端礼盒": "luxury",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                result = classify_product_category(text)
                self.assertEqual(expected, result["category_id"], result)
                self.assertGreater(result["score"], 0)
                self.assertIn(result["confidence"], ("medium", "high"))

    def test_unknown_text_stays_low_confidence_fallback(self) -> None:
        result = classify_product_category("quasar object 947")
        self.assertEqual("fmcg", result["category_id"])
        self.assertEqual("未明确品类", result["category_name"])
        self.assertEqual("通用参考", result["strategy"]["name"])
        self.assertEqual("low", result["confidence"])
        self.assertEqual(0, result["score"])
        self.assertIn("未识别到明确品类关键词", result["reason"])
        self.assertNotIn("默认按快消品", result["reason"])


if __name__ == "__main__":
    unittest.main()
