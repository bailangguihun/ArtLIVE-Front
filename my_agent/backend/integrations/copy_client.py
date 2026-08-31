from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional

import requests

from my_agent.backend.core.config import Settings
from my_agent.backend.domain.models import MarketingCopy
from my_agent.backend.integrations.ad_copy_generator import (
    AdCopyGenerator,
    local_platform_copy,
)
from my_agent.platform_catalog import (
    POSTER_SHORTS_RULES,
    normalize_platform,
    normalize_visual_style,
    visual_style_prompt,
)


@dataclass(eq=False)
class CopyProviderError(Exception):
    category: str
    safe_message: str

    def __str__(self) -> str:
        return self.safe_message

    def __repr__(self) -> str:
        return f"CopyProviderError(category={self.category!r})"


_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F9FF"
    "\U00002600-\U000027BF"
    "\U0001FA00-\U0001FAFF"
    "]+",
    flags=re.UNICODE,
)
_STORY_HOOK_RE = re.compile(
    r"^(最近|姐妹|你们懂|别再|天呐|天啊|我真的|我宣布|闺蜜|OMG|救命|"
    r"你们有没有|谁懂|听我劝)",
    re.I,
)


class DeepSeekCopyClient:
    def __init__(self, settings: Settings, session: Optional[requests.Session] = None):
        self._settings = settings
        self._api_key = settings.deepseek_api_key
        self._base_url = settings.deepseek_api_base
        self._model = settings.chat_model
        self._session = session or requests.Session()
        self._generator = AdCopyGenerator(self._chat)

    @property
    def settings(self) -> Settings:
        return self._settings

    def __repr__(self) -> str:
        return f"DeepSeekCopyClient(configured={self.configured})"

    @property
    def configured(self) -> bool:
        return bool(self._api_key.strip())

    def _chat(self, system: str, user: str, temperature: float) -> str:
        if not self.configured:
            raise CopyProviderError("not_configured", "营销文案服务当前未配置。")
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
        }
        try:
            response = self._session.post(
                f"{self._base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json; charset=utf-8",
                    "Accept": "application/json",
                },
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                timeout=(10.0, 120.0),
            )
        except requests.Timeout as exc:
            raise CopyProviderError("timeout", "营销文案服务请求超时。") from exc
        except requests.RequestException as exc:
            raise CopyProviderError("network_error", "无法连接营销文案服务。") from exc
        try:
            if response.status_code >= 400:
                category = (
                    "unauthorized"
                    if response.status_code in (401, 403)
                    else "provider_error"
                )
                raise CopyProviderError(category, "营销文案服务请求未成功。")
            try:
                document = response.json()
                value = document["choices"][0]["message"]["content"]
            except (ValueError, TypeError, KeyError, IndexError) as exc:
                raise CopyProviderError(
                    "invalid_response", "营销文案服务返回格式无效。"
                ) from exc
        finally:
            response.close()
        return str(value).strip()

    @staticmethod
    def _plain_len(text: str) -> int:
        return len(_EMOJI_RE.sub("", str(text or "")).strip())

    @classmethod
    def _looks_like_story_hook(cls, text: str) -> bool:
        value = str(text or "").strip()
        if not value:
            return True
        if _STORY_HOOK_RE.search(value):
            return True
        if cls._plain_len(value) > 16:
            return True
        if re.search(r"[。！？!?…]", value) and cls._plain_len(value) > 10:
            return True
        # Truncated mid-sentence leftovers like "…… 出"
        if re.search(r"[，,、]\s*$", value) or value.endswith("出"):
            return True
        return False

    @classmethod
    def _fallback_texts(
        cls,
        product_info: str,
        short_name: str,
        body: str,
        creative_note: str = "",
    ) -> MarketingCopy:
        title = (short_name or product_info or "新品").strip()[:10]
        features = AdCopyGenerator.split_features(product_info, creative_note)
        title_key = title[:8]
        sellable = [
            item.strip()
            for item in features
            if item.strip()
            and item.strip()[:8] != title_key
            and not cls._looks_like_story_hook(item)
        ]
        if not sellable:
            sellable = [
                item.strip()
                for item in features
                if item.strip() and item.strip()[:8] != title_key
            ]
        headline = (sellable[0] if sellable else "焕新日常体验").strip()[:14]
        subline = (sellable[1] if len(sellable) > 1 else "").strip()[:12]
        return MarketingCopy(
            body=body,
            title=title or "新品",
            headline=headline or "焕新日常体验",
            subline=subline,
        )

    @classmethod
    def _sanitize_shorts(
        cls,
        *,
        product_info: str,
        short_name: str,
        body: str,
        title: str,
        headline: str,
        subline: str,
        creative_note: str = "",
    ) -> MarketingCopy:
        fallback = cls._fallback_texts(
            product_info, short_name, body, creative_note=creative_note
        )
        clean_title = str(title or "").strip()
        clean_headline = str(headline or "").strip()
        clean_subline = str(subline or "").strip()

        if (
            not clean_title
            or cls._plain_len(clean_title) > 10
            or cls._looks_like_story_hook(clean_title)
        ):
            clean_title = fallback.title

        if not clean_headline or cls._looks_like_story_hook(clean_headline):
            clean_headline = fallback.headline

        if cls._looks_like_story_hook(clean_subline) or cls._plain_len(clean_subline) > 14:
            clean_subline = fallback.subline

        # Avoid duplicate fields.
        if clean_headline and clean_headline == clean_title:
            clean_headline = fallback.headline
        if clean_subline and clean_subline in {clean_title, clean_headline}:
            clean_subline = ""

        return MarketingCopy(
            body=body,
            title=clean_title[:18],
            headline=clean_headline[:22],
            subline=clean_subline[:28],
        )

    def _extract_shorts(
        self,
        *,
        product_info: str,
        short_name: str,
        platform: str,
        body: str,
        visual_style: str = "vibrant",
        creative_note: str = "",
    ) -> MarketingCopy:
        style = visual_style_prompt(visual_style)
        try:
            extracted = self._chat(
                "只返回合法 JSON 对象。不要使用广告法极限词。",
                (
                    f"{POSTER_SHORTS_RULES}\n"
                    f"风格要求：{style.get('shorts') or ''}\n"
                    '只返回 JSON：{"title":"...","headline":"...","subline":"..."}\n'
                    f"投放平台：{platform}\n"
                    f"产品短名：{short_name or '无'}\n"
                    f"产品信息：{product_info}\n"
                    f"文案：{body}"
                ),
                0.2,
            )
            cleaned = re.sub(
                r"^```(?:json)?\s*|\s*```$", "", extracted, flags=re.I | re.M
            ).strip()
            parsed = json.loads(cleaned)
            return self._sanitize_shorts(
                product_info=product_info,
                short_name=short_name,
                body=body,
                title=str(parsed.get("title") or ""),
                headline=str(parsed.get("headline") or ""),
                subline=str(parsed.get("subline") or ""),
                creative_note=creative_note,
            )
        except (CopyProviderError, ValueError, TypeError, AttributeError):
            return self._fallback_texts(
                product_info, short_name, body, creative_note=creative_note
            )

    def generate_marketing_copy(
        self,
        product_info: str,
        short_name: str,
        visual_style: str,
        creative_note: str,
        target_platform: str = "xiaohongshu",
        marketing_advice_context: str = "",
    ) -> MarketingCopy:
        variants = self.generate_marketing_copy_variants(
            product_info,
            short_name,
            visual_style,
            creative_note,
            target_platform=target_platform,
            count=1,
            marketing_advice_context=marketing_advice_context,
        )
        return variants[0]

    def generate_marketing_copy_variants(
        self,
        product_info: str,
        short_name: str,
        visual_style: str,
        creative_note: str,
        target_platform: str = "xiaohongshu",
        count: int = 3,
        marketing_advice_context: str = "",
    ) -> list[MarketingCopy]:
        platform = normalize_platform(target_platform)
        style_id = normalize_visual_style(visual_style)
        style = visual_style_prompt(style_id)
        product_name = (short_name or product_info or "新品").strip()[:40]
        features = AdCopyGenerator.split_features(product_info, creative_note)
        count = max(1, min(3, int(count)))
        style_note = (
            f"{style.get('body') or ''}\n"
            f"创意补充：{creative_note or '无'}"
        )
        if marketing_advice_context:
            style_note = f"{style_note}\n{marketing_advice_context}"
        shorts_hint = (
            f"{POSTER_SHORTS_RULES}\n风格短句要求：{style.get('shorts') or ''}"
        )
        if count == 1:
            body = self._generator.generate(
                platform=platform,
                product_name=product_name,
                key_features=features,
                extra_info=style_note,
                temperature=0.7,
                visual_style=style_id,
            )
            return [
                self._extract_shorts(
                    product_info=product_info,
                    short_name=short_name,
                    platform=platform,
                    body=body,
                    visual_style=style_id,
                    creative_note=creative_note,
                )
            ]

        system = (
            self._generator.SYSTEM_PROMPTS[platform]
            + f"\n当前必须采用「{style.get('label') or style_id}」文案风格。\n"
            + (style.get("body") or "")
            + f"\n请一次生成 {count} 个互不相同的完整文案版本，角度、开头、措辞都要有明显差异。"
            "只返回合法 JSON："
            '{"variants":[{"body":"...","title":"...","headline":"...","subline":"..."}]}'
            f"\n其中 title/headline/subline 必须遵守：\n{shorts_hint}"
        )
        user = (
            f"商品名称: {product_name}\n"
            f"核心卖点/特征: {', '.join(features)}\n"
            f"创意补充：{creative_note or '无'}\n"
            f"请严格按平台规范 + 「{style.get('label')}」风格输出 {count} 版文案。"
        )
        if marketing_advice_context:
            user = f"{user}\n{marketing_advice_context}"
        raw = self._chat(system, user, 0.85)
        cleaned = re.sub(
            r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.I | re.M
        ).strip()
        try:
            parsed = json.loads(cleaned)
            items = list(parsed.get("variants") or [])
        except (ValueError, TypeError, AttributeError):
            items = []

        variants: list[MarketingCopy] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            body = str(item.get("body") or "").strip()
            if not body:
                continue
            variants.append(
                self._sanitize_shorts(
                    product_info=product_info,
                    short_name=short_name,
                    body=body,
                    title=str(item.get("title") or ""),
                    headline=str(item.get("headline") or ""),
                    subline=str(item.get("subline") or ""),
                    creative_note=creative_note,
                )
            )
            if len(variants) >= count:
                break

        # Fill missing slots with extra single generations.
        while len(variants) < count:
            body = self._generator.generate(
                platform=platform,
                product_name=product_name,
                key_features=features,
                extra_info=f"{style_note}；请给出第{len(variants)+1}个不同版本",
                temperature=0.9,
                visual_style=style_id,
            )
            variants.append(
                self._extract_shorts(
                    product_info=product_info,
                    short_name=short_name,
                    platform=platform,
                    body=body,
                    visual_style=style_id,
                    creative_note=creative_note,
                )
            )
        return variants[:count]


class LocalCopyFallback:
    @staticmethod
    def generate_marketing_copy(
        product_info: str,
        short_name: str,
        visual_style: str,
        creative_note: str,
        target_platform: str = "xiaohongshu",
    ) -> MarketingCopy:
        return LocalCopyFallback.generate_marketing_copy_variants(
            product_info,
            short_name,
            visual_style,
            creative_note,
            target_platform=target_platform,
            count=1,
        )[0]

    @staticmethod
    def generate_marketing_copy_variants(
        product_info: str,
        short_name: str,
        visual_style: str,
        creative_note: str,
        target_platform: str = "xiaohongshu",
        count: int = 3,
    ) -> list[MarketingCopy]:
        platform = normalize_platform(target_platform)
        style_id = normalize_visual_style(visual_style)
        product_name = (short_name or product_info or "新品").strip()[:40]
        features = AdCopyGenerator.split_features(product_info, creative_note)
        count = max(1, min(3, int(count)))
        suffixes = ["", "｜版本B侧重点不同", "｜版本C换个表达"]
        variants: list[MarketingCopy] = []
        for index in range(count):
            body = local_platform_copy(
                platform=platform,
                product_name=product_name,
                key_features=features,
                extra_info=(creative_note or "") + suffixes[index],
                visual_style=style_id,
            )
            variants.append(
                DeepSeekCopyClient._sanitize_shorts(
                    product_info=product_info,
                    short_name=short_name,
                    body=body,
                    title=product_name[:10],
                    headline=(features[0] if features else "焕新日常体验")[:14],
                    subline=(features[1] if len(features) > 1 else "")[:12],
                    creative_note=creative_note,
                )
            )
        return variants
