# coding: utf-8
"""Unsplash 检索（爆款背景素材）。需要环境变量 UNSPLASH_ACCESS_KEY。"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import requests

UNSPLASH_ACCESS_KEY = os.environ.get("UNSPLASH_ACCESS_KEY", "").strip()
UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos"


def unsplash_configured() -> bool:
    return bool(UNSPLASH_ACCESS_KEY)


def search_unsplash_photos(
    query: str,
    orientation: str = "portrait",
    per_page: int = 5,
) -> List[Dict[str, Any]]:
    """
    返回精简结果列表：
    [{id, description, thumb, regular, full, photographer, link}]
    """
    if not UNSPLASH_ACCESS_KEY:
        raise RuntimeError(
            "未设置 UNSPLASH_ACCESS_KEY。请到 https://unsplash.com/developers 申请后 export。"
        )

    headers = {
        "Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}",
        "Accept-Version": "v1",
    }
    params = {
        "query": query,
        "orientation": orientation if orientation in ("landscape", "portrait", "squarish") else "portrait",
        "per_page": max(1, min(int(per_page), 10)),
        "content_filter": "high",
    }
    resp = requests.get(UNSPLASH_SEARCH_URL, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    raw = resp.json().get("results") or []
    out: List[Dict[str, Any]] = []
    for item in raw:
        urls = item.get("urls") or {}
        user = item.get("user") or {}
        # 过滤过小图
        w = int(item.get("width") or 0)
        h = int(item.get("height") or 0)
        if w and h and min(w, h) < 600:
            continue
        out.append(
            {
                "id": item.get("id"),
                "description": (item.get("description") or item.get("alt_description") or "")[:120],
                "thumb": urls.get("thumb") or urls.get("small"),
                "regular": urls.get("regular") or urls.get("small"),
                "full": urls.get("full") or urls.get("regular"),
                "photographer": user.get("name") or "",
                "link": (item.get("links") or {}).get("html") or "",
                "width": w,
                "height": h,
            }
        )
    return out


def search_many_usable(
    queries: List[str],
    orientation: str = "portrait",
    need: int = 3,
    per_page: int = 5,
) -> List[Dict[str, Any]]:
    """尽量凑齐 need 张不同素材。"""
    collected: List[Dict[str, Any]] = []
    seen = set()
    for q in queries:
        try:
            hits = search_unsplash_photos(q, orientation=orientation, per_page=per_page)
            for hit in hits:
                hid = hit.get("id") or hit.get("regular")
                if hid in seen:
                    continue
                seen.add(hid)
                hit = dict(hit)
                hit["query_used"] = q
                collected.append(hit)
                if len(collected) >= need:
                    return collected
        except Exception as e:
            print(f"Unsplash 检索失败 [{q}]: {e}")
    return collected


def download_image(url: str) -> bytes:
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.content
