# coding: utf-8
"""免费可商用素材检索：优先 Pexels，其次 Pixabay / Unsplash。

申请：
- Pexels（推荐，可商用）: https://www.pexels.com/api/  → export PEXELS_API_KEY=...
- Pixabay（备用）: https://pixabay.com/api/docs/     → export PIXABAY_API_KEY=...
- Unsplash（备用）: https://unsplash.com/developers → export UNSPLASH_ACCESS_KEY=...
"""

from __future__ import annotations

import hashlib
import os
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

import requests

PEXELS_API_KEY = os.environ.get("PEXELS_API_KEY", "").strip()
PIXABAY_API_KEY = os.environ.get("PIXABAY_API_KEY", "").strip()
UNSPLASH_ACCESS_KEY = os.environ.get("UNSPLASH_ACCESS_KEY", "").strip()

_CACHE_DIR = os.path.join("temp", "stock_cache")
_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "poster-agent/1.1"})

# 全局限速：Pixabay 免费配额紧，搜索/下载都要拉开间隔
_LAST_REQ_AT: Dict[str, float] = {"pexels": 0.0, "pixabay": 0.0, "unsplash": 0.0, "cdn": 0.0}
_MIN_GAP = {
    "pexels": 0.25,
    "pixabay": 1.0,  # 约 60 次/分钟以内更稳
    "unsplash": 0.6,
    "cdn": 0.55,
}


def stock_configured() -> bool:
    return bool(PEXELS_API_KEY or PIXABAY_API_KEY or UNSPLASH_ACCESS_KEY)


def stock_provider_status() -> str:
    names = []
    if PEXELS_API_KEY:
        names.append("Pexels")
    if PIXABAY_API_KEY:
        names.append("Pixabay")
    if UNSPLASH_ACCESS_KEY:
        names.append("Unsplash")
    return "+".join(names) if names else "未配置"


def _throttle(kind: str) -> None:
    gap = float(_MIN_GAP.get(kind, 0.4))
    last = _LAST_REQ_AT.get(kind, 0.0)
    wait = gap - (time.time() - last)
    if wait > 0:
        time.sleep(wait)
    _LAST_REQ_AT[kind] = time.time()


def _safe_url_label(url: str) -> str:
    """Return scheme/host/path only; query strings and fragments are always discarded."""
    try:
        parsed = urlsplit(str(url))
    except ValueError:
        return "remote-resource"
    if not parsed.scheme or not parsed.netloc:
        return "remote-resource"
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


def _request_get(
    url: str,
    *,
    kind: str = "cdn",
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 45,
    max_retries: int = 4,
) -> requests.Response:
    """带限速 + 429/5xx 指数退避的 GET。"""
    last_err: Optional[Exception] = None
    for attempt in range(max_retries):
        _throttle(kind)
        try:
            resp = _SESSION.get(url, headers=headers, params=params, timeout=timeout)
            if resp.status_code == 429 or resp.status_code >= 500:
                retry_after = resp.headers.get("Retry-After")
                try:
                    sleep_s = float(retry_after) if retry_after else (1.2 * (2**attempt))
                except ValueError:
                    sleep_s = 1.2 * (2**attempt)
                sleep_s = min(max(sleep_s, 1.0), 20.0)
                print(f"[stock] {kind} HTTP {resp.status_code}, wait {sleep_s:.1f}s (try {attempt+1})")
                time.sleep(sleep_s)
                last_err = requests.HTTPError(
                    f"{resp.status_code} for {_safe_url_label(url)}", response=resp
                )
                continue
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            last_err = e
            sleep_s = min(1.0 * (2**attempt), 12.0)
            print(
                f"[stock] {kind} request error: {type(e).__name__}; "
                f"wait {sleep_s:.1f}s"
            )
            time.sleep(sleep_s)
    if last_err:
        raise RuntimeError(f"stock request failed: {_safe_url_label(url)}") from None
    raise RuntimeError(f"stock request failed: {_safe_url_label(url)}")


def _cache_path(url: str) -> str:
    os.makedirs(_CACHE_DIR, exist_ok=True)
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()
    ext = ".jpg"
    low = url.lower().split("?")[0]
    if low.endswith(".png"):
        ext = ".png"
    elif low.endswith(".webp"):
        ext = ".webp"
    return os.path.join(_CACHE_DIR, f"{digest}{ext}")


def download_image(url: str) -> bytes:
    """下载素材图：本地缓存 + CDN 限速 + 429 重试。"""
    if not url:
        raise ValueError("empty image url")
    path = _cache_path(url)
    if os.path.isfile(path) and os.path.getsize(path) > 1024:
        with open(path, "rb") as f:
            return f.read()

    kind = "pixabay" if "pixabay" in url.lower() else "cdn"
    resp = _request_get(url, kind=kind, timeout=60, max_retries=5)
    data = resp.content
    if len(data) < 500:
        raise RuntimeError(f"downloaded image too small: {_safe_url_label(url)}")
    try:
        with open(path, "wb") as f:
            f.write(data)
    except Exception as e:
        print(f"[stock] cache write failed: {e}")
    return data


def _search_pexels(
    query: str, orientation: str = "portrait", per_page: int = 6, page: int = 1
) -> List[Dict[str, Any]]:
    if not PEXELS_API_KEY:
        return []
    headers = {"Authorization": PEXELS_API_KEY}
    params = {
        "query": query,
        "per_page": max(1, min(per_page, 15)),
        "page": max(1, min(int(page), 10)),
        "orientation": orientation if orientation in ("landscape", "portrait", "square") else "portrait",
    }
    resp = _request_get(
        "https://api.pexels.com/v1/search",
        kind="pexels",
        headers=headers,
        params=params,
        timeout=30,
    )
    out = []
    for item in resp.json().get("photos") or []:
        src = item.get("src") or {}
        out.append(
            {
                "id": f"pexels_{item.get('id')}",
                "source": "pexels",
                "description": (item.get("alt") or query)[:120],
                "thumb": src.get("tiny") or src.get("small"),
                "regular": src.get("large") or src.get("medium"),
                "full": src.get("original") or src.get("large2x") or src.get("large"),
                "photographer": item.get("photographer") or "",
                "link": item.get("url") or "",
                "query_used": query,
            }
        )
    return out


def _search_pixabay(
    query: str, orientation: str = "vertical", per_page: int = 6, page: int = 1
) -> List[Dict[str, Any]]:
    if not PIXABAY_API_KEY:
        return []
    orient = "vertical" if orientation in ("portrait", "vertical") else "horizontal"
    params = {
        "key": PIXABAY_API_KEY,
        "q": query.replace(",", " "),
        "image_type": "photo",
        "orientation": orient,
        "safesearch": "true",
        "per_page": max(3, min(per_page, 20)),
        "page": max(1, min(int(page), 10)),
    }
    resp = _request_get(
        "https://pixabay.com/api/",
        kind="pixabay",
        params=params,
        timeout=30,
    )
    out = []
    for item in resp.json().get("hits") or []:
        mid = item.get("webformatURL") or item.get("largeImageURL")
        out.append(
            {
                "id": f"pixabay_{item.get('id')}",
                "source": "pixabay",
                "description": (item.get("tags") or query)[:120],
                "tags": item.get("tags") or "",
                "thumb": item.get("previewURL"),
                "regular": mid,
                "full": mid,
                "photographer": item.get("user") or "",
                "link": item.get("pageURL") or "",
                "query_used": query,
            }
        )
    return out


def _search_unsplash(
    query: str, orientation: str = "portrait", per_page: int = 6, page: int = 1
) -> List[Dict[str, Any]]:
    if not UNSPLASH_ACCESS_KEY:
        return []
    headers = {
        "Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}",
        "Accept-Version": "v1",
    }
    params = {
        "query": query,
        "orientation": orientation if orientation in ("landscape", "portrait", "squarish") else "portrait",
        "per_page": max(1, min(per_page, 10)),
        "page": max(1, min(int(page), 10)),
        "content_filter": "high",
    }
    resp = _request_get(
        "https://api.unsplash.com/search/photos",
        kind="unsplash",
        headers=headers,
        params=params,
        timeout=30,
    )
    out = []
    for item in resp.json().get("results") or []:
        urls = item.get("urls") or {}
        user = item.get("user") or {}
        out.append(
            {
                "id": f"unsplash_{item.get('id')}",
                "source": "unsplash",
                "description": (item.get("description") or item.get("alt_description") or query)[:120],
                "thumb": urls.get("thumb") or urls.get("small"),
                "regular": urls.get("regular") or urls.get("small"),
                "full": urls.get("regular") or urls.get("full"),
                "photographer": user.get("name") or "",
                "link": (item.get("links") or {}).get("html") or "",
                "query_used": query,
            }
        )
    return out


# 广告空镜通用禁止：建筑/风景大场面（任意品类都可能误出桥、塔、城市、河岸）
_STOCK_SCENE_BAN = [
    "bridge", "suspension", "viaduct", "overpass", "tower", "building", "architecture",
    "city", "cityscape", "skyline", "skyscraper", "highway", "road", "street view", "alley",
    "pier", "dock", "harbor", "harbour", "boat", "ship", "train", "railway",
    "church", "temple", "castle", "monument", "statue", "landmark",
    "landscape", "scenery", "scenic", "countryside", "riverbank", "cliff", "canyon",
    "valley", "waterfall", "mountain range", "national park", "hiking", "camping",
    "forest path", "travel destination", "tourist", "outdoor scenery", "panorama",
    "aerial view", "drone", "horizon sky", "ski resort",
]

# 未在用户提示中出现时，禁止检索词夹带这些「脑补」词
_QUERY_HALLUCINATION_BAN = [
    "tub", "bathtub", "bath tub", "plastic tub", "basin",
    "clutter", "messy", "group of dogs", "pack of dogs", "multiple dogs",
    "dog face", "closeup face", "headshot",
]


def clean_stock_query(query: str, user_raw: str = "") -> str:
    """清洗检索词：去掉目录脑补词；用户未提澡盆/水体等则剔除。

    注意：不要追加 `-human -people`。Pexels/Pixabay 把减号当普通字符，
    会严重污染检索；人像靠后置过滤剔除即可。
    """
    q = " ".join(str(query or "").split())
    allow_water = any(
        k in (user_raw or "") for k in ("水", "澡", "盆", "浴", "tub", "bath", "pool", "水体")
    )
    out = q
    water_bans = {"tub", "bathtub", "bath tub", "plastic tub", "basin"}
    for ban in _QUERY_HALLUCINATION_BAN:
        if ban in water_bans and allow_water:
            continue
        out = out.replace(ban, " ")
    # 去掉历史残留的布尔排除写法
    out = out.replace("-human", " ").replace("-people", " ").replace("-person", " ")
    return " ".join(out.split())[:100]


def _reject_stock_hit(
    hit: Dict[str, Any],
    cool_theme: bool = False,
    allow_floral: bool = True,
    allow_glassware: bool = False,
    pet_fullbody_only: bool = False,
    allow_nature_bg: bool = False,
    light_warm: bool = False,
) -> bool:
    """过滤人像/建筑；用户要蓝天草地时放行自然户外（仍禁桥/城）。

    只用 description/tags 判拒，绝不把 query_used 拼进 blob——
    否则检索词里的 landscape/road 会把自己的结果全杀掉。
    """
    blob = " ".join(
        str(hit.get(k) or "") for k in ("description", "tags")
    ).lower()
    human = [
        "woman", "man", "girl", "boy", "people", "person", "human",
        "dress", "wedding", "couple", "child", "baby", "selfie", "model posing",
    ]
    if any(b in blob for b in human):
        return True
    # 仅当明确是人像摄影时拒；勿因单词 portrait（竖构图）误杀
    if "portrait of" in blob or "portrait photography" in blob:
        if not any(a in blob for a in ("dog", "cat", "pet", "animal", "puppy", "kitten")):
            return True

    # 建筑类始终禁
    arch_ban = [
        "bridge", "suspension", "viaduct", "overpass", "tower", "building", "architecture",
        "city", "cityscape", "skyline", "skyscraper", "highway", "street view",
        "pier", "dock", "church", "temple", "castle", "monument", "landmark",
    ]
    if any(b in blob for b in arch_ban):
        return True

    # 用户未要自然户外时，才禁 landscape 大场面
    if not allow_nature_bg:
        nature_ban = [
            "landscape", "scenery", "scenic", "countryside", "riverbank", "cliff",
            "canyon", "valley", "waterfall", "mountain range", "national park",
            "hiking", "camping", "forest path", "panorama", "aerial view", "drone",
        ]
        if any(b in blob for b in nature_ban):
            return True
        scenic_extra = [
            "sunset landscape", "sunrise landscape", "ocean view", "beach panorama",
            "city night", "downtown",
        ]
        if any(b in blob for b in scenic_extra):
            return True
    else:
        # 自然背景下仍禁明显无关大场面
        if any(b in blob for b in ("ocean view", "beach panorama", "ski resort", "downtown")):
            return True

    # 自然底常见 tags 带 flower——用户要蓝天草地时不要因附带花词整张否决
    if not allow_floral and not allow_nature_bg:
        floral = [
            "flower", "floral", "blossom", "petal", "bouquet", "rose", "tulip",
            "lily", "camellia", "orchid", "peony", "daisy", "sunflower",
        ]
        if any(b in blob for b in floral):
            return True
    if not allow_glassware:
        glass_bad = [
            "wine", "wineglass", "wine glass", "champagne", "cocktail", "whiskey",
            "whisky", "liquor", "alcohol", "beer glass", "goblet", "decanter",
            "bar counter", "barware", "vodka", "brandy", "cognac",
        ]
        if any(b in blob for b in glass_bad):
            return True
    if pet_fullbody_only:
        head_bad = [
            "close-up face", "closeup face", "headshot", "dog face closeup",
            "cat face closeup", "head only", "macro muzzle",
        ]
        multi_bad = [
            "two dogs", "two cats", "three dogs", "pack of", "group of dogs",
            "group of cats", "multiple dogs", "litter of", "mother and puppies",
        ]
        if any(b in blob for b in head_bad) or any(b in blob for b in multi_bad):
            return True
        is_close = any(k in blob for k in ("close-up", "closeup", "close up", "headshot"))
        full_ok = any(
            k in blob
            for k in ("full body", "fullbody", "whole body", "sitting", "standing", "running", "walking", "grass")
        )
        if is_close and not full_ok:
            return True
    # 用户要米色浅色暖光：拒暗调/深色实底/高饱和红绿大特写
    if light_warm:
        dark_bad = [
            "dark navy", "navy blue", "black background", "moody dark", "night",
            "gothic", "underexposed", "deep crimson", "blood red", "dark red flower",
            "lavender field", "purple haze", "violet flower field",
            "teal background", "turquoise background", "solid blue background",
            "dark green", "forest dark", "low key", "dramatic dark",
            "crimson", "scarlet", "burgundy", "maroon flower",
        ]
        if any(b in blob for b in dark_bad):
            return True
        # 无浅/暖线索且带暗/深色词 → 拒
        light_ok = any(
            k in blob
            for k in (
                "beige", "cream", "pastel", "ivory", "soft light", "morning",
                "airy", "bright", "warm white", "silk", "satin", "pale",
            )
        )
        darkish = any(
            k in blob
            for k in ("dark", "black", "navy", "teal", "crimson", "moody", "night")
        )
        if darkish and not light_ok:
            return True
        if any(b in blob for b in ("cat face", "dog face", "kitten close", "puppy close", "pet fur")):
            if not any(k in blob for k in ("flower", "petal", "camellia", "blossom")):
                return True
    if cool_theme:
        warm_bad = [
            "red rose", "valentine", "lipstick", "wine glass heart", "polka",
            "autumn leaves landscape", "orange leaf forest",
        ]
        if any(b in blob for b in warm_bad):
            return True
    return False


def _hit_matches_query(hit: Dict[str, Any], query: str) -> bool:
    """命中须与检索词有基本相关；花/叶查询必须能对上花词，避免猫毛/空墙误中。"""
    q = (query or "").lower().replace("-", " ").replace(",", " ")
    tokens = [t for t in q.split() if len(t) > 2]
    stop = {
        "photo", "background", "backdrop", "studio", "close", "empty", "product",
        "photography", "soft", "light", "center", "people", "still", "life",
        "tabletop", "macro", "object", "human", "single", "entire", "animal",
        "from", "head", "paws", "only", "view", "length", "green", "white", "sunny",
        "warm", "cream", "beige", "morning", "focus", "pastel",
    }
    tokens = [t for t in tokens if t not in stop]
    blob = " ".join(str(hit.get(k) or "") for k in ("description", "tags")).lower()
    if not blob.strip():
        # 无标签时：花类查询宁可不收，避免乱图
        floral_q = any(
            t in q for t in ("flower", "floral", "petal", "camellia", "blossom", "rose", "bloom")
        )
        return not floral_q

    floral_q = any(
        t in q for t in ("flower", "floral", "petal", "camellia", "blossom", "rose", "bloom")
    )
    if floral_q:
        floral_hit = any(
            k in blob
            for k in (
                "flower", "floral", "petal", "camellia", "blossom", "bloom",
                "rose", "peony", "lily", "orchid", "bouquet",
            )
        )
        animal_hit = any(
            k in blob
            for k in ("cat", "dog", "kitten", "puppy", "pet fur", "animal fur", "kitty")
        )
        # 草场/草坪：用户只搜花时不要当成花命中
        grass_only = any(k in blob for k in ("grass", "lawn", "meadow")) and not floral_hit
        if animal_hit and not floral_hit:
            return False
        if grass_only:
            return False
        if not floral_hit:
            return False
        return True

    if not tokens:
        return True
    if any(t in blob for t in tokens):
        return True
    nature_q = any(t in tokens for t in ("sky", "cloud", "clouds", "grass", "lawn", "field", "meadow"))
    if nature_q:
        nature_hit = any(
            k in blob
            for k in (
                "sky", "cloud", "grass", "lawn", "field", "meadow", "nature",
                "outdoor", "summer", "spring", "horizon", "blue",
            )
        )
        if nature_hit:
            return True
    return False


def search_stock_photos(
    query: str,
    orientation: str = "portrait",
    per_page: int = 6,
    cool_theme: bool = False,
    allow_floral: bool = True,
    allow_glassware: bool = False,
    pet_fullbody_only: bool = False,
    allow_nature_bg: bool = False,
    user_raw: str = "",
    light_warm: bool = False,
    page: int = 1,
) -> List[Dict[str, Any]]:
    """按优先级：Pexels → Pixabay → Unsplash。"""
    query = clean_stock_query(query, user_raw=user_raw)
    page = max(1, min(int(page or 1), 8))
    errors = []
    for fn in (_search_pexels, _search_pixabay, _search_unsplash):
        try:
            hits = fn(query, orientation=orientation, per_page=per_page, page=page)
            filtered = []
            for h in hits:
                if _reject_stock_hit(
                    h,
                    cool_theme=cool_theme,
                    allow_floral=allow_floral,
                    allow_glassware=allow_glassware,
                    pet_fullbody_only=pet_fullbody_only,
                    allow_nature_bg=allow_nature_bg,
                    light_warm=light_warm,
                ):
                    continue
                blob = " ".join(str(h.get(k) or "") for k in ("description", "tags")).lower()
                if any(
                    x in blob
                    for x in ("human", "people", "group of dogs", "messy", "plastic tub", "clutter")
                ):
                    continue
                if not _hit_matches_query(h, query):
                    continue
                filtered.append(h)
            if filtered:
                return filtered
        except Exception as e:
            errors.append(f"{fn.__name__}: {e}")
            print(f"素材检索失败 {fn.__name__} [{query}]: {e}")
    if errors and not stock_configured():
        raise RuntimeError(
            "未配置素材库 Key。请申请 Pexels（推荐）: https://www.pexels.com/api/ 后 "
            "export PEXELS_API_KEY=..."
        )
    return []


def search_first_stock(
    queries: List[str],
    orientation: str = "portrait",
    cool_theme: bool = False,
    allow_floral: bool = True,
    allow_glassware: bool = False,
    pet_fullbody_only: bool = False,
    allow_nature_bg: bool = False,
    user_raw: str = "",
    light_warm: bool = False,
) -> Optional[Dict[str, Any]]:
    for q in queries:
        q = (q or "").strip()
        if not q:
            continue
        hits = search_stock_photos(
            q,
            orientation=orientation,
            per_page=8,
            cool_theme=cool_theme,
            allow_floral=allow_floral,
            allow_glassware=allow_glassware,
            pet_fullbody_only=pet_fullbody_only,
            allow_nature_bg=allow_nature_bg,
            user_raw=user_raw,
            light_warm=light_warm,
        )
        if hits:
            return hits[0]
    return None


def search_many_stock(
    queries: List[str],
    need: int = 3,
    orientation: str = "portrait",
    per_page: int = 8,
    cool_theme: bool = False,
    allow_floral: bool = True,
    allow_glassware: bool = False,
    pet_fullbody_only: bool = False,
    allow_nature_bg: bool = False,
    user_raw: str = "",
    light_warm: bool = False,
    page: int = 1,
    shuffle_seed: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """多取再打乱：避免每次都锁死同一张首图。"""
    import random

    collected: List[Dict[str, Any]] = []
    seen = set()
    page = max(1, min(int(page or 1), 8))
    # 多取一些，后面再 shuffle 截断；用户词必须全部参与检索，禁止只搜前 6 条
    want = max(need * 3, 9)
    q_limit = max(16, len(queries or []))
    for q in (queries or [])[:q_limit]:
        q = (q or "").strip()
        if not q:
            continue
        try:
            for hit in search_stock_photos(
                q,
                orientation=orientation,
                per_page=max(per_page, 10),
                cool_theme=cool_theme,
                allow_floral=allow_floral,
                allow_glassware=allow_glassware,
                pet_fullbody_only=pet_fullbody_only,
                allow_nature_bg=allow_nature_bg,
                user_raw=user_raw,
                light_warm=light_warm,
                page=page,
            ):
                hid = hit.get("id") or hit.get("regular")
                if hid in seen:
                    continue
                seen.add(hid)
                collected.append(hit)
                if len(collected) >= want:
                    break
        except Exception as e:
            print(f"search_many_stock [{q}]: {e}")
        if len(collected) >= want:
            break

    if shuffle_seed is not None and len(collected) > 1:
        rnd = random.Random(int(shuffle_seed))
        rnd.shuffle(collected)
    return collected[:need]
