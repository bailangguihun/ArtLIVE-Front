# coding: utf-8
"""Platform-aware ad copy generator (AI/111.docx AdCopyGenerator)."""

from __future__ import annotations

import re
from typing import Callable, List, Optional, Sequence

try:
    from my_agent.platform_catalog import (
        AD_LAW_CONSTRAINT,
        PLATFORM_COPY_SPECS,
        PLATFORM_LABELS,
        normalize_platform,
        normalize_visual_style,
        visual_style_prompt,
    )
except ImportError:
    from platform_catalog import (  # type: ignore
        AD_LAW_CONSTRAINT,
        PLATFORM_COPY_SPECS,
        PLATFORM_LABELS,
        normalize_platform,
        normalize_visual_style,
        visual_style_prompt,
    )

ChatFn = Callable[[str, str, float], str]


class AdCopyGenerator:
    """Generate platform-toned marketing copy via an LLM chat function."""

    SYSTEM_PROMPTS = {
        "xiaohongshu": (
            "你是一个小红书百万粉丝的种草博主。文案规范：\n"
            "1. 标题必须有吸引力，包含Emoji，如'防脱救星💦'、'OMG这个绝了！'。\n"
            "2. 采用第一人称'我/闺蜜'的视角分享真实体验。\n"
            "3. 排版多空行，每段不超过3句话，大量使用小红书常用Emoji（✨, 😭, 🔒, 💡）。\n"
            "4. 结尾必须带 #话题 标签，不少于3个。\n"
            "5. 正文字数控制在200-300字。\n"
            f"6. {AD_LAW_CONSTRAINT}"
        ),
        "douyin": (
            "你是一个短视频带货文案大师。文案规范：\n"
            "1. 黄金3秒起手：第一句必须是情绪强烈的质问或痛点（如'别再瞎买洗发水了！'）。\n"
            "2. 口语化，适合念出来，节奏快，无废话。\n"
            "3. 结尾有强烈的行动召唤（CTA），如'点击下方小黄车/链接抢购'。\n"
            "4. Emoji 少用，仅在重点处使用🔥/💥。\n"
            "5. 正文字数控制在50-100字。\n"
            f"6. {AD_LAW_CONSTRAINT}"
        ),
        "taobao": (
            "你是一个天猫旗舰店资深文案策划。文案规范：\n"
            "1. 标题采用'【主打功效】+ 产品名 + 辅助功效'格式。\n"
            "2. 正文使用结构化列表，每一条以【卖点】开头，用词要专业、严谨"
            "（如'专研配方'、'温和去屑'）。\n"
            "3. 突出售后保障（如'7天无理由'、'顺丰包邮'、'赠送体验装'）。\n"
            "4. 几乎不用 Emoji，可用【】与标点。\n"
            "5. 正文字数控制在120-180字。\n"
            f"6. {AD_LAW_CONSTRAINT}"
        ),
        "pinduoduo": (
            "你是一个拼多多爆款运营专家。文案规范：\n"
            "1. 字字见钱，极度强调高性价比（如'拼单立减'、'破盘价'、'工厂直销'），"
            "但不得使用违法极限词。\n"
            "2. 营造紧迫感，多用'❗'、'🔥'、'📢'等符号。\n"
            "3. 强调'假一赔十'、'退货包运费'、'全网低价感'等打消顾虑的词汇"
            "（避免「最」「第一」等违法表述）。\n"
            "4. 正文字数控制在60-100字。\n"
            f"5. {AD_LAW_CONSTRAINT}"
        ),
    }

    def __init__(self, chat: ChatFn):
        self._chat = chat

    @staticmethod
    def supported_platforms() -> List[str]:
        return list(AdCopyGenerator.SYSTEM_PROMPTS.keys())

    @staticmethod
    def split_features(product_info: str, creative_note: str = "") -> List[str]:
        text = f"{product_info}\n{creative_note}".strip()
        parts = [
            item.strip(" -\t")
            for item in re.split(r"[\n，,；;、|/]+", text)
            if item and item.strip(" -\t")
        ]
        # Keep meaningful chunks; drop ultra-short noise.
        features = [item for item in parts if len(item) >= 2][:8]
        return features or [text[:80] or "新品卖点"]

    def generate(
        self,
        platform: str,
        product_name: str,
        key_features: Sequence[str],
        extra_info: str = "",
        temperature: float = 0.7,
        visual_style: str = "vibrant",
    ) -> str:
        platform_id = normalize_platform(platform)
        if platform_id not in self.SYSTEM_PROMPTS:
            raise ValueError(f"Unsupported platform: {platform}")

        features = [str(item).strip() for item in key_features if str(item).strip()]
        if not features:
            features = ["核心卖点待补充"]

        style = visual_style_prompt(visual_style)
        style_id = normalize_visual_style(visual_style)
        spec = PLATFORM_COPY_SPECS.get(platform_id, {})
        label = PLATFORM_LABELS.get(platform_id, platform_id)
        system = (
            self.SYSTEM_PROMPTS[platform_id]
            + f"\n当前必须采用「{style.get('label') or style_id}」文案风格。\n"
            + str(style.get("body") or "")
        )
        user_content = (
            f"投放平台: {label}（{platform_id}）\n"
            f"文案风格: {style.get('label') or style_id}\n"
            f"商品名称: {product_name.strip() or '新品'}\n"
            f"核心卖点/特征: {', '.join(features)}\n"
            f"补充信息（优惠/规格等）: {extra_info.strip() or '无'}\n"
            f"字数要求: {spec.get('word_count', '适中')}\n"
            f"标题格式: {spec.get('title_format', '')}\n"
            f"正文结构: {spec.get('structure', '')}\n"
            f"常用关键词参考: {spec.get('keywords', '')}\n\n"
            "请根据上述信息，严格按照平台规范 + 指定文案风格生成完整文案"
            "（含标题与正文）。只输出文案本身，不要解释。"
        )
        return self._chat(system, user_content, temperature).strip()


def local_platform_copy(
    platform: str,
    product_name: str,
    key_features: Optional[Sequence[str]] = None,
    extra_info: str = "",
    visual_style: str = "vibrant",
) -> str:
    """Deterministic fallback when LLM is unavailable."""
    platform_id = normalize_platform(platform)
    style_id = normalize_visual_style(visual_style)
    name = (product_name or "新品").strip()[:20]
    features = [str(item).strip() for item in (key_features or []) if str(item).strip()]
    feature_text = "、".join(features[:3]) if features else "日常好用"
    note = f"；{extra_info.strip()}" if extra_info.strip() else ""

    if style_id == "premium":
        if platform_id == "douyin":
            return (
                f"{name}，把细节做到安静好看。\n"
                f"{feature_text}，用过就懂那种克制的高级感{note}。\n"
                "想要更利落的日常，点下方链接看看。"
            )
        if platform_id == "taobao":
            return (
                f"【质感甄选】{name}\n"
                f"【卖点】{feature_text}\n"
                "【保障】正品保障·支持售后\n"
                f"适合追求细腻体验的你{note}。"
            )
        if platform_id == "pinduoduo":
            return (
                f"{name}｜质感之选\n"
                f"{feature_text}，工厂直供也讲工艺{note}。\n"
                "假一赔十·退货包运费。"
            )
        return (
            f"{name}｜一点点更讲究的日常\n\n"
            f"试过之后才发现，{feature_text}，是那种不吵闹却很耐看的感觉。\n\n"
            f"把体验留给自己就好{note}\n\n"
            f"#质感生活 #{name} #好物分享"
        )

    if platform_id == "douyin":
        return (
            f"别再买错了！{name}听我劝👉\n"
            f"{feature_text}，用过就懂{note}。\n"
            "点击下方链接抢购，错过真的亏。"
        )
    if platform_id == "taobao":
        return (
            f"【专研配方】{name} 日常优选\n"
            f"【卖点】{feature_text}\n"
            "【保障】正品保障·支持售后·买即赠体验装\n"
            f"规格与优惠详见详情页{note}。"
        )
    if platform_id == "pinduoduo":
        return (
            f"🔥拼单立减｜{name}\n"
            f"{feature_text}，工厂直供更省心{note}。\n"
            "📢假一赔十·退货包运费·抢光为止👇"
        )
    return (
        f"OMG这个绝了✨｜{name}真的锁死了🔒\n\n"
        f"之前一直在找合适的，试了才发现{feature_text}，体验直接吹爆😭\n\n"
        f"真实感受分享给姐妹们💡{note}\n\n"
        f"#种草 #{name} #好物推荐"
    )
