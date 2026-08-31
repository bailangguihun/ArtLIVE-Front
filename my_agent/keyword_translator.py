# coding: utf-8
"""素材检索专用翻译器：只做中→英，禁止扩写/脑补。

优先级：
1) 本地词表（确定、离线）
2) MyMemory 机器翻译（非生成式 AI）
3) DeepSeek 仅翻译模式（temperature=0，禁止加词）——可选兜底
"""

from __future__ import annotations

import os
import re
from typing import List, Optional, Tuple

import requests

# 与 design_guidelines 词表对齐的精简版：命中则不走网络，避免漂移
_LOCAL_MAP = [
    (("蓝天草地",), "blue sky green grass"),
    (("蓝天白云",), "blue sky white clouds"),
    (("蓝天",), "blue sky"),
    (("白云",), "white clouds"),
    (("草地", "草坪", "绿草", "草甸"), "green grass"),
    (("天空",), "blue sky"),
    (("米色", "米白"), "beige"),
    (("奶油",), "cream"),
    (("燕麦",), "oatmeal"),
    (("卡其",), "khaki"),
    (("浅色系", "浅色", "淡色"), "light colors"),
    (("暖光",), "warm light"),
    (("柔光",), "soft light"),
    (("暖柔光",), "warm soft light"),
    (("温暖", "暖色", "温馨"), "warm"),
    (("山茶花", "山茶", "茶花"), "camellia flowers"),
    (("玫瑰花", "玫瑰"), "rose flowers"),
    (("花瓣",), "flower petals"),
    (("花朵", "鲜花"), "flowers"),
    (("花海",), "many flowers"),
    (("丝绸", "真丝", "丝缎", "缎面"), "silk"),
    (("狗", "狗狗", "犬"), "dog"),
    (("猫", "猫咪"), "cat"),
    (("宠物",), "pet"),
    (("冰块", "冰"), "ice"),
    (("薄荷", "薄荷叶"), "mint"),
]


def split_user_keywords(text: str) -> List[str]:
    """按用户输入分隔符拆词，保持顺序。"""
    parts = [p.strip() for p in re.split(r"[,，、;；|/]+", text or "") if p.strip()]
    return parts if parts else ([text.strip()] if (text or "").strip() else [])


def _local_translate(phrase: str) -> Optional[str]:
    text = (phrase or "").strip()
    if not text:
        return None
    # 已是纯英文则原样
    if re.fullmatch(r"[A-Za-z0-9\s\-']+", text):
        return " ".join(text.split())
    for keys, en in _LOCAL_MAP:
        if text in keys or any(k == text for k in keys):
            return en
    # 长句里贪心匹配已知词
    ranked = sorted(
        ((len(k), k, en) for keys, en in _LOCAL_MAP for k in keys),
        key=lambda x: -x[0],
    )
    remaining = text
    parts = []
    for _, k, en in ranked:
        if k and k in remaining:
            parts.append(en)
            remaining = remaining.replace(k, " ", 1)
    remaining = remaining.strip()
    if parts and not remaining:
        return " ".join(parts)
    if parts and remaining and re.fullmatch(r"[\s\W]*", remaining):
        return " ".join(parts)
    return None


def _mymemory_translate(phrase: str) -> Optional[str]:
    """免费机器翻译，非 LLM。"""
    q = (phrase or "").strip()
    if not q:
        return None
    try:
        resp = requests.get(
            "https://api.mymemory.translated.net/get",
            params={"q": q[:450], "langpair": "zh-CN|en-GB"},
            timeout=12,
        )
        resp.raise_for_status()
        data = resp.json()
        translated = (
            ((data.get("responseData") or {}).get("translatedText") or "").strip()
        )
        if not translated:
            return None
        # 拒回明显无效结果
        if translated.lower() == q.lower():
            return translated if re.search(r"[A-Za-z]", translated) else None
        # 清洗：只留检索友好英文
        cleaned = re.sub(r"[^\w\s\-]", " ", translated)
        cleaned = " ".join(cleaned.split())
        return cleaned[:90] if cleaned else None
    except Exception as e:
        print(f"[keyword_translator] MyMemory failed: {e}")
        return None


def _deepseek_translate_only(phrase: str) -> Optional[str]:
    """仅作兜底：强制只翻译，禁止加词。"""
    api_key = (
        os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    ).strip()
    if not api_key:
        return None
    base = os.environ.get("OPENAI_API_BASE", "https://api.deepseek.com").rstrip("/")
    model = os.environ.get("CHAT_MODEL", "deepseek-chat")
    system = (
        "You are a literal translator for stock-photo search keywords. "
        "Translate Chinese to English ONLY. "
        "Rules: keep the same meaning; do NOT add objects; do NOT invent style words; "
        "do NOT explain; output plain English words only."
    )
    try:
        resp = requests.post(
            f"{base}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": phrase},
                ],
            },
            timeout=30,
        )
        resp.raise_for_status()
        out = resp.json()["choices"][0]["message"]["content"].strip()
        out = out.strip('"\'`').split("\n")[0]
        out = re.sub(r"[^\w\s\-]", " ", out)
        out = " ".join(out.split())
        return out[:90] if out else None
    except Exception as e:
        print(f"[keyword_translator] DeepSeek translate failed: {e}")
        return None


def translate_one_keyword(phrase: str) -> Tuple[str, str]:
    """
    单段关键词 → 英文。
    返回 (english, source)  source: local|mymemory|deepseek|raw
    """
    raw = (phrase or "").strip()
    if not raw:
        return "", "empty"

    local = _local_translate(raw)
    if local:
        return local, "local"

    mm = _mymemory_translate(raw)
    if mm:
        return mm, "mymemory"

    ds = _deepseek_translate_only(raw)
    if ds:
        return ds, "deepseek"

    # 最后：若含中文则无法搜，返回拼音式原样英文片段
    if re.search(r"[\u4e00-\u9fff]", raw):
        return raw, "raw_zh"
    return " ".join(raw.split())[:90], "raw"


def translate_user_prompt_to_search_queries(user_prompt: str) -> dict:
    """
    用户整段提示 → 按输入顺序得到检索英文列表。
    不做任何主题重排，不注入目录词。
    """
    phrases = split_user_keywords(user_prompt)
    items = []
    queries: List[str] = []
    for ph in phrases:
        en, src = translate_one_keyword(ph)
        items.append({"zh": ph, "en": en, "source": src})
        if en and en.lower() not in {q.lower() for q in queries}:
            queries.append(en)
    return {
        "phrases": phrases,
        "items": items,
        "queries": queries,
        "lead": ", ".join(queries)[:160],
    }
