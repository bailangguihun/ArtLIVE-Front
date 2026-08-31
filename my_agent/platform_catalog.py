# coding: utf-8
"""Four-platform ad copy & visual presets from AI/111.docx."""

from __future__ import annotations

from typing import Any, Dict, List


PLATFORM_IDS: List[str] = [
    "xiaohongshu",
    "douyin",
    "taobao",
    "pinduoduo",
]

PLATFORM_LABELS: Dict[str, str] = {
    "xiaohongshu": "小红书",
    "douyin": "抖音",
    "taobao": "淘宝",
    "pinduoduo": "拼多多",
}

# Quantitative matrix from 111.docx (for prompts / UI captions).
PLATFORM_COPY_SPECS: Dict[str, Dict[str, str]] = {
    "xiaohongshu": {
        "word_count": "200-300字中长文",
        "title_format": "感叹句/反问句 + 2个以上Emoji",
        "structure": "场景痛点 -> 个人体验 -> 成分分析 -> 总结呼吁",
        "emoji": "极高（每句 1-2 个相关表情）",
        "keywords": "救命、本命、吹爆、锁死、尊嘟假嘟",
    },
    "douyin": {
        "word_count": "50-100字短文",
        "title_format": "痛点质问/黄金3秒吸睛句",
        "structure": "冲突起手 -> 解决痛点 -> 行动召唤 (CTA)",
        "emoji": "低（仅重点处用🔥/💥）",
        "keywords": "别再买错了、听我劝、不看亏大发",
    },
    "taobao": {
        "word_count": "120-180字结构化",
        "title_format": "【核心卖点】+ 流量词",
        "structure": "核心卖点1/2/3 -> 规格/赠品 -> 售后保障",
        "emoji": "极低（多用标点或【】）",
        "keywords": "专研、正品保障、买即赠、支持检质",
    },
    "pinduoduo": {
        "word_count": "60-100字短爆文",
        "title_format": "【价格敏感词】+ 强力保障承诺",
        "structure": "降价降维打击 -> 囤货建议 -> 购买直通车",
        "emoji": "中等（多用🔥、📢、👇）",
        "keywords": "拼单立减、抢光为止、假一赔十、退货包邮",
    },
}

AD_LAW_CONSTRAINT = (
    "严禁使用「最」「第一」「顶级」「国家级」「全网最低」「绝对」「保证治愈」"
    "等违反《广告法》的极限词或绝对化用语；淘宝/拼多多文案尤须严格遵守。"
)

# Copy / poster visual style (step 2). Keep premium vs vibrant clearly distinct.
VISUAL_STYLE_LABELS: Dict[str, str] = {
    "premium": "高级质感",
    "vibrant": "爆款吸睛",
}

VISUAL_STYLE_PROMPTS: Dict[str, Dict[str, str]] = {
    "premium": {
        "label": "高级质感",
        "body": (
            "文案风格必须是「高级质感」，并与「爆款吸睛」明显区分：\n"
            "- 语气克制、细腻，像杂志种草/品牌故事，不要喊麦式促销；\n"
            "- 少用夸张感叹号与密集 emoji（小红书也最多点缀，勿每句堆表情）；\n"
            "- 重点写质地、工艺、气味层次、长期使用感受、精致生活氛围；\n"
            "- 禁止「冲冲冲」「闭眼入」「手慢无」「绝绝子」「救命神器本器」等爆款口号。"
        ),
        "shorts": (
            "海报短句也要高级克制：少感叹号、最多1个轻量emoji；"
            "卖点写质感/氛围/工艺利益，不要夸张口号。"
        ),
    },
    "vibrant": {
        "label": "爆款吸睛",
        "body": (
            "文案风格必须是「爆款吸睛」，并与「高级质感」明显区分：\n"
            "- 开头强冲突/痛点或反差，节奏快、口语感强；\n"
            "- 可用适量 emoji 与感叹，强调立刻可见的效果、跟风种草；\n"
            "- 利益点直给，少写慢热散文和空泛「氛围感」抒情；\n"
            "- 禁止写成冷静杂志风长文，禁止过度文艺、寡淡。"
        ),
        "shorts": (
            "海报短句要抓眼球：利益点直给，可带1个emoji；"
            "禁止把故事开头整句截断当卖点。"
        ),
    },
}

POSTER_SHORTS_RULES = (
    "从完整广告文案中提取海报叠加短句，严格遵守：\n"
    "1) title：产品短名或品类名，2-8个汉字为宜，可带1个emoji；"
    "禁止完整句子，禁止痛点故事开头。\n"
    "2) headline：一条具体核心卖点/功效利益（成分、功效、场景利益），6-14字；"
    "必须是卖点，禁止把正文第一句故事钩子截断填入"
    "（如禁止「最近天气…」「姐妹们!!!」「你们懂那种…」这类开头）。\n"
    "3) subline：可选补充卖点或使用场景，0-12字，可空；不要与 title/headline 重复。\n"
    "4) 三个字段都要短、可上海报；不要把正文整句塞进去。\n"
    "正确示例：title=冰感小风扇，headline=一秒吹走闷热，subline=便携续航够用\n"
    "错误示例：headline=最近魔都的天气真的要把人蒸干了😭 出"
)


def normalize_visual_style(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    aliases = {
        "premium": "premium",
        "高端": "premium",
        "高端质感": "premium",
        "高端质感风": "premium",
        "高级": "premium",
        "高级质感": "premium",
        "高级质感风": "premium",
        "vibrant": "vibrant",
        "爆款": "vibrant",
        "爆款吸睛": "vibrant",
        "爆款吸睛风": "vibrant",
    }
    if value in VISUAL_STYLE_PROMPTS:
        return value
    return aliases.get(value, "vibrant")


def visual_style_prompt(style: str | None) -> Dict[str, str]:
    style_id = normalize_visual_style(style)
    return dict(VISUAL_STYLE_PROMPTS[style_id])


# Frontend / local text overlay defaults (mapped to font_catalog ids).
PLATFORM_VISUAL_CONFIGS: Dict[str, Dict[str, Any]] = {
    "xiaohongshu": {
        "preferred_font_id": "lxgw_wenkai",
        "text_align": "left",
        "text_color": "#333333",
        "accent_color": "#FF2442",
        "theme_color": "#FF2442",
        "layout_id": "top_left",
        "title_size": 64,
        "headline_size": 36,
        "subline_size": 28,
        "show_panel": False,
    },
    "douyin": {
        "preferred_font_id": "msyhbd",
        "text_align": "center",
        "text_color": "#FFFFFF",
        "accent_color": "#FE2C55",
        "theme_color": "#FE2C55",
        "layout_id": "bottom_center",
        "title_size": 70,
        "headline_size": 40,
        "subline_size": 30,
        "show_panel": False,
    },
    "taobao": {
        "preferred_font_id": "noto_sans_sc",
        "text_align": "left",
        "text_color": "#111111",
        "accent_color": "#FF5000",
        "theme_color": "#FF5000",
        "layout_id": "top_left",
        "title_size": 60,
        "headline_size": 36,
        "subline_size": 28,
        "show_panel": False,
    },
    "pinduoduo": {
        "preferred_font_id": "zcool_qingke",
        "text_align": "center",
        "text_color": "#E02E24",
        "accent_color": "#E02E24",
        "theme_color": "#E02E24",
        "layout_id": "top_center",
        "title_size": 72,
        "headline_size": 42,
        "subline_size": 30,
        "show_panel": False,
    },
}


def normalize_platform(platform: str | None) -> str:
    value = str(platform or "").strip().lower()
    if value in PLATFORM_LABELS:
        return value
    aliases = {
        "xhs": "xiaohongshu",
        "red": "xiaohongshu",
        "小红书": "xiaohongshu",
        "dy": "douyin",
        "抖音": "douyin",
        "tb": "taobao",
        "淘宝": "taobao",
        "pdd": "pinduoduo",
        "拼多多": "pinduoduo",
    }
    return aliases.get(value, "xiaohongshu")


def platform_capability_options() -> List[Dict[str, str]]:
    return [{"id": pid, "label": PLATFORM_LABELS[pid]} for pid in PLATFORM_IDS]


def platform_visual_config(platform: str | None) -> Dict[str, Any]:
    return dict(PLATFORM_VISUAL_CONFIGS[normalize_platform(platform)])
