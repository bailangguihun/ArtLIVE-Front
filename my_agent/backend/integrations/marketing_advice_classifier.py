from __future__ import annotations

import json
import re
from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Dict, List, Optional

import requests

from my_agent.backend.core.config import Settings
from my_agent.marketing_strategy_catalog import (
    CATEGORY_ORDER,
    STRATEGY_CATALOG,
    classify_product_category,
)

_CONFIDENCE_SCORES = {"high": 10, "medium": 6, "low": 2}
_MARKET_TIERS = frozenset({"luxury", "premium", "mass", "unknown"})
_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", flags=re.I | re.M)
_CLASSIFICATION_CACHE: Dict[str, Dict[str, Any]] = {}


def _normalized_advice_input(
    *,
    product_info: str,
    product_short_name: str = "",
    creative_note: str = "",
) -> Dict[str, str]:
    return {
        "product_info": str(product_info or "").strip(),
        "product_short_name": str(product_short_name or "").strip(),
        "creative_note": str(creative_note or "").strip(),
    }


def _classification_cache_key(normalized: Dict[str, str]) -> str:
    payload = json.dumps(
        normalized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return sha256(payload.encode("utf-8")).hexdigest()

_MARKET_TIER_LABELS = {
    "luxury": "奢侈/大牌",
    "premium": "高端",
    "mass": "大众/平价",
    "unknown": "未明确价位",
}

_DISAMBIGUATION_RULES = """
常见易混品类，请结合「商品形态 + 市场定位」判断，不要只看产品名词：

1. 香水 / 香氛 / 调香
   - luxury：大牌、奢侈品牌、高端礼盒、限量、千元以上定位、送礼场景强调品牌价值
   - fmcg：平价、入门、身体喷雾、香体喷雾、快消渠道走量、无品牌溢价
   - 仅描述香调（木质调、前调、后调）但无价位信息 → 默认 premium，倾向 luxury 或 fmcg 需看是否强调礼盒/大牌/送礼

2. 美妆（口红、护肤、彩妆）
   - 大众平价、高频复购 → fmcg
   - 奢侈品牌、高端礼盒、高客单 → luxury

3. 箱包 / 配饰
   - 奢侈品牌、设计师款、限量 → luxury
   - 平价双肩包、学生款、走量 → fmcg

4. 手表 / 珠宝
   - 奢侈腕表、珠宝礼盒 → luxury
   - 智能手表、运动手环 → durable

5. 酒水
   - 茅台、香槟、高端礼盒 → luxury
   - 普通饮料、啤酒 → fmcg

6. 小家电 / 3C
   - 手机、耳机、风扇、厨电 → durable（不是 fmcg）

7. 软件 / 会员 / API → digital；上门服务 / 培训 → service；企业采购 → b2b；药品体检 → health
""".strip()


@dataclass(eq=False)
class MarketingAdviceClassifierError(Exception):
    category: str
    safe_message: str

    def __str__(self) -> str:
        return self.safe_message

    def __repr__(self) -> str:
        return f"MarketingAdviceClassifierError(category={self.category!r})"


def _build_category_guide() -> str:
    lines: List[str] = []
    for category_id in CATEGORY_ORDER:
        item = STRATEGY_CATALOG[category_id]
        lines.append(
            f"- {category_id}: {item['name']} — {item['one_liner']}（例：{item['examples']}）"
        )
    return "\n".join(lines)


def _parse_classifier_response(text: str) -> Dict[str, Any]:
    cleaned = _JSON_FENCE_RE.sub("", str(text or "").strip()).strip()
    parsed = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError("classifier response must be a JSON object")
    return parsed


def _normalize_confidence(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"high", "medium", "low"}:
        return normalized
    if normalized in {"高", "较高"}:
        return "high"
    if normalized in {"中", "中等"}:
        return "medium"
    return "low"


def _normalize_market_tier(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in _MARKET_TIERS:
        return normalized
    if normalized in {"奢侈", "大牌", "高端奢侈"}:
        return "luxury"
    if normalized in {"高端", "中高"}:
        return "premium"
    if normalized in {"大众", "平价", "入门", "快消"}:
        return "mass"
    return "unknown"


def _compose_reason(
    *,
    product_form: str,
    market_tier: str,
    detail: str,
    category_name: str,
) -> str:
    form = product_form.strip() or "商品"
    tier_label = _MARKET_TIER_LABELS.get(market_tier, "未明确价位")
    detail = detail.strip()
    prefix = f"AI 智能识别：{form}，{tier_label}定位，适用「{category_name}」营销策略。"
    if not detail:
        return prefix
    if detail.startswith("AI 智能识别"):
        return detail
    return f"{prefix}{detail}"


def _build_ai_payload(
    *,
    category_id: str,
    confidence: str,
    reason: str,
    matched_signals: List[str],
    product_form: str = "",
    market_tier: str = "unknown",
) -> Dict[str, Any]:
    strategy = dict(STRATEGY_CATALOG[category_id])
    matched = [str(item).strip() for item in matched_signals if str(item).strip()]
    return {
        "category_id": category_id,
        "category_name": strategy["name"],
        "confidence": confidence,
        "matched_keywords": matched,
        "reason": reason.strip() or f"AI 智能识别为「{strategy['name']}」。",
        "score": _CONFIDENCE_SCORES[confidence],
        "strategy": strategy,
        "source": "desktop_ai_different_product_marketing_strategies",
    }


class AiMarketingAdviceClassifier:
    """Two-step LLM classification: understand product profile, then map strategy."""

    def __init__(
        self,
        settings: Settings,
        session: Optional[requests.Session] = None,
    ):
        self._settings = settings
        self._session = session or requests.Session()

    @property
    def configured(self) -> bool:
        return self._settings.copy_provider_configured

    def _chat(self, system: str, user: str) -> str:
        if not self.configured:
            raise MarketingAdviceClassifierError(
                "not_configured", "营销建议识别服务当前未配置。"
            )
        payload = {
            "model": self._settings.chat_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
        }
        try:
            response = self._session.post(
                f"{self._settings.deepseek_api_base.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._settings.deepseek_api_key}",
                    "Content-Type": "application/json; charset=utf-8",
                    "Accept": "application/json",
                },
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                timeout=(10.0, 60.0),
            )
        except requests.Timeout as exc:
            raise MarketingAdviceClassifierError(
                "timeout", "营销建议识别服务请求超时。"
            ) from exc
        except requests.RequestException as exc:
            raise MarketingAdviceClassifierError(
                "network_error", "无法连接营销建议识别服务。"
            ) from exc
        try:
            if response.status_code >= 400:
                category = (
                    "unauthorized"
                    if response.status_code in (401, 403)
                    else "provider_error"
                )
                raise MarketingAdviceClassifierError(
                    category, "营销建议识别服务请求未成功。"
                )
            try:
                document = response.json()
                value = document["choices"][0]["message"]["content"]
            except (ValueError, TypeError, KeyError, IndexError) as exc:
                raise MarketingAdviceClassifierError(
                    "invalid_response", "营销建议识别服务返回格式无效。"
                ) from exc
        finally:
            response.close()
        return str(value).strip()

    def classify(
        self,
        *,
        product_info: str,
        product_short_name: str = "",
        creative_note: str = "",
    ) -> Dict[str, Any]:
        _ = creative_note
        user_prompt = (
            "请分两步完成商品营销品类识别，并只返回一个 JSON 对象。\n\n"
            "【第一步：理解商品】\n"
            "从输入中推断：\n"
            "- product_form：商品形态/品类名词（如「大牌香水」「便携风扇」「SaaS 工具」）\n"
            "- market_tier：luxury | premium | mass | unknown\n"
            "  · luxury=奢侈大牌/高溢价礼品；premium=高端但非顶奢；mass=平价走量；unknown=信息不足\n"
            "- purchase_pattern：一句话描述购买频率/决策特点（如「低频次礼品决策」）\n\n"
            "【第二步：映射营销策略】\n"
            "在以下 7 类中选最匹配的一类（category_id 必须从中选一个）：\n"
            f"{_build_category_guide()}\n\n"
            "【边界规则】\n"
            f"{_DISAMBIGUATION_RULES}\n\n"
            "【输出要求】\n"
            "1. 先完成第一步理解，再给出 category_id；不要只看单个名词就下结论。\n"
            "2. matched_signals：1~5 个支持你判断的中文关键词或短语。\n"
            "3. reason：一句补充说明（不要重复 product_form 与 market_tier 全文）。\n"
            "4. confidence：high / medium / low。\n"
            '5. 只返回 JSON：{"product_form":"...","market_tier":"luxury|premium|mass|unknown",'
            '"purchase_pattern":"...","category_id":"...","confidence":"high|medium|low",'
            '"reason":"...","matched_signals":["..."]}\n\n'
            f"产品信息：{product_info.strip() or '（无）'}\n"
            f"产品短名：{product_short_name.strip() or '（无）'}"
        )
        raw = self._chat(
            (
                "你是资深电商营销策略分析师。"
                "你必须先理解商品形态与市场定位，再映射到固定策略类别。"
                "只返回合法 JSON 对象，不要输出其它文字。"
            ),
            user_prompt,
        )
        parsed = _parse_classifier_response(raw)
        category_id = str(parsed.get("category_id") or "").strip().lower()
        if category_id not in STRATEGY_CATALOG:
            raise MarketingAdviceClassifierError(
                "invalid_response", "营销建议识别结果不在支持的品类范围内。"
            )
        confidence = _normalize_confidence(parsed.get("confidence"))
        market_tier = _normalize_market_tier(parsed.get("market_tier"))
        product_form = str(parsed.get("product_form") or "").strip()
        matched_raw = parsed.get("matched_signals") or []
        if not isinstance(matched_raw, list):
            matched_raw = []
        detail = str(parsed.get("reason") or "").strip()
        strategy_name = STRATEGY_CATALOG[category_id]["name"]
        reason = _compose_reason(
            product_form=product_form,
            market_tier=market_tier,
            detail=detail,
            category_name=strategy_name,
        )
        return _build_ai_payload(
            category_id=category_id,
            confidence=confidence,
            reason=reason,
            matched_signals=matched_raw,
            product_form=product_form,
            market_tier=market_tier,
        )


def classify_product_category_smart(
    *,
    product_info: str,
    product_short_name: str = "",
    creative_note: str = "",
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """Prefer two-step LLM classification; fall back to keyword rules."""
    normalized = _normalized_advice_input(
        product_info=product_info,
        product_short_name=product_short_name,
        creative_note=creative_note,
    )
    cache_key = _classification_cache_key(normalized)
    cached = _CLASSIFICATION_CACHE.get(cache_key)
    if cached is not None:
        return deepcopy(cached)

    active_settings = settings or Settings.from_env()
    classifier = AiMarketingAdviceClassifier(active_settings)
    if classifier.configured:
        try:
            result = classifier.classify(
                product_info=normalized["product_info"],
                product_short_name=normalized["product_short_name"],
                creative_note=normalized["creative_note"],
            )
            _CLASSIFICATION_CACHE[cache_key] = deepcopy(result)
            return result
        except (MarketingAdviceClassifierError, ValueError, TypeError):
            pass
    result = classify_product_category(
        product_info=normalized["product_info"],
        product_short_name=normalized["product_short_name"],
        creative_note=normalized["creative_note"],
    )
    _CLASSIFICATION_CACHE[cache_key] = deepcopy(result)
    return result
