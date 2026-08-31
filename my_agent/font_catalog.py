# coding: utf-8
"""Poster editor font catalog: ~2/3 Chinese, ~1/3 English (commercial-safe sources)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

_ROOT = Path(__file__).resolve().parent
_BUNDLE = _ROOT / "fonts"
_WIN = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"


@dataclass(frozen=True)
class FontEntry:
    id: str
    label: str
    language: str  # "zh" | "en"
    paths: tuple  # candidate file paths, first existing wins


def _candidates(*parts: str) -> tuple:
    items = []
    for part in parts:
        p = Path(part)
        if not p.is_absolute():
            items.append(_BUNDLE / part)
        else:
            items.append(p)
    return tuple(items)


# 18 Chinese + 9 English = 27
FONT_CATALOG: List[FontEntry] = [
    # —— Chinese (~2/3) ——
    FontEntry("noto_sans_sc", "思源黑体 / Noto Sans SC", "zh", _candidates("NotoSansSC-Regular.otf", "NotoSansSC-Regular.ttf")),
    FontEntry("noto_serif_sc", "思源宋体 / Noto Serif SC", "zh", _candidates("NotoSerifSC-Regular.otf", "NotoSerifSC-Regular.ttf")),
    FontEntry("lxgw_wenkai", "霞鹜文楷", "zh", _candidates("LXGWWenKai-Regular.ttf")),
    FontEntry("zcool_xiaowei", "站酷小薇", "zh", _candidates("ZCOOLXiaoWei-Regular.ttf")),
    FontEntry("zcool_qingke", "站酷庆科黄油体", "zh", _candidates("ZCOOLQingKeHuangYou-Regular.ttf")),
    FontEntry("ma_shan_zheng", "马善政毛笔楷书", "zh", _candidates("MaShanZheng-Regular.ttf")),
    FontEntry("zhi_mang_xing", "志莽行书", "zh", _candidates("ZhiMangXing-Regular.ttf")),
    FontEntry("long_cang", "龙藏体", "zh", _candidates("LongCang-Regular.ttf")),
    FontEntry("msyh", "微软雅黑", "zh", _candidates(str(_WIN / "msyh.ttc"), str(_WIN / "msyh.ttf"))),
    FontEntry("msyhbd", "微软雅黑 Bold", "zh", _candidates(str(_WIN / "msyhbd.ttc"), str(_WIN / "msyhbd.ttf"))),
    FontEntry("simhei", "黑体", "zh", _candidates(str(_WIN / "simhei.ttf"))),
    FontEntry("simsun", "宋体", "zh", _candidates(str(_WIN / "simsun.ttc"), str(_WIN / "simsun.ttf"))),
    FontEntry("simkai", "楷体", "zh", _candidates(str(_WIN / "simkai.ttf"))),
    FontEntry("simfang", "仿宋", "zh", _candidates(str(_WIN / "simfang.ttf"))),
    FontEntry("dengxian", "等线", "zh", _candidates(str(_WIN / "Deng.ttf"), str(_WIN / "deng.ttf"))),
    FontEntry("stzhongs", "华文中宋", "zh", _candidates(str(_WIN / "STZHONGS.TTF"))),
    FontEntry("stkaiti", "华文楷体", "zh", _candidates(str(_WIN / "STKAITI.TTF"))),
    FontEntry("stxingkai", "华文行楷", "zh", _candidates(str(_WIN / "STXINGKA.TTF"))),
    # —— English (~1/3) ——
    # Only list a Windows fallback when the branded file is missing AND the
    # fallback is unique; duplicate Arial aliases are filtered in list_available_fonts.
    FontEntry("inter", "Inter", "en", _candidates("Inter-Regular.ttf", "Inter.ttf")),
    FontEntry("roboto", "Roboto", "en", _candidates("Roboto-Regular.ttf")),
    FontEntry("open_sans", "Open Sans", "en", _candidates("OpenSans-Regular.ttf")),
    FontEntry("montserrat", "Montserrat", "en", _candidates("Montserrat-Regular.ttf")),
    FontEntry("lora", "Lora", "en", _candidates("Lora-Regular.ttf", str(_WIN / "georgia.ttf"))),
    FontEntry("playfair", "Playfair Display", "en", _candidates("PlayfairDisplay-Regular.ttf")),
    FontEntry("oswald", "Oswald", "en", _candidates("Oswald-Regular.ttf")),
    FontEntry("raleway", "Raleway", "en", _candidates("Raleway-Regular.ttf")),
    FontEntry("merriweather", "Merriweather", "en", _candidates("Merriweather-Regular.ttf")),
    FontEntry("arial", "Arial", "en", _candidates(str(_WIN / "arial.ttf"))),
    FontEntry("georgia", "Georgia", "en", _candidates(str(_WIN / "georgia.ttf"))),
    FontEntry("verdana", "Verdana", "en", _candidates(str(_WIN / "verdana.ttf"))),
]


def resolve_font_path(font_id: str) -> Optional[Path]:
    for entry in FONT_CATALOG:
        if entry.id != font_id:
            continue
        for path in entry.paths:
            if path.is_file():
                return path
        return None
    return None


def _is_bundled(path: Path) -> bool:
    try:
        return _BUNDLE in path.resolve().parents or path.resolve().parent == _BUNDLE
    except OSError:
        return False


def list_available_fonts() -> List[Dict[str, str]]:
    """Only fonts whose files exist on this machine."""
    out: List[Dict[str, str]] = []
    seen_paths = set()
    for entry in FONT_CATALOG:
        path = resolve_font_path(entry.id)
        if path is None:
            continue
        resolved = str(path.resolve()).lower()
        # Skip catalog aliases that resolve to the same already-listed file
        # (e.g. Inter/Roboto both falling back to Arial).
        if resolved in seen_paths and not _is_bundled(path):
            continue
        seen_paths.add(resolved)
        label = entry.label
        if not _is_bundled(path) and path.name.lower() not in {
            f"{entry.id}.ttf",
            f"{entry.id}.otf",
            f"{entry.id}.ttc",
        }:
            # Clarify Windows / fallback files so the UI matches reality.
            label = f"{entry.label}（{path.name}）"
        out.append(
            {
                "id": entry.id,
                "label": label,
                "language": entry.language,
                "path": str(path),
            }
        )
    return out


def default_font_id() -> str:
    available = list_available_fonts()
    for prefer in ("zcool_xiaowei", "msyh", "simhei", "lxgw_wenkai", "noto_sans_sc", "inter"):
        if any(item["id"] == prefer for item in available):
            return prefer
    return available[0]["id"] if available else ""


_BROWSER_LOCAL_FAMILY = {
    "msyh": "Microsoft YaHei",
    "msyhbd": "Microsoft YaHei",
    "simhei": "SimHei",
    "simsun": "SimSun",
    "simkai": "KaiTi",
    "simfang": "FangSong",
    "dengxian": "DengXian",
    "stzhongs": "STZhongsong",
    "stkaiti": "STKaiti",
    "stxingkai": "STXingkai",
}


def browser_font_face(font_id: str) -> Dict[str, str]:
    """CSS font payload for the drag preview (export still uses Pillow)."""
    path = resolve_font_path(font_id)
    family = f"PosterEditor-{font_id or 'default'}"
    local_name = _BROWSER_LOCAL_FAMILY.get(font_id or "", "")
    payload: Dict[str, str] = {
        "family": family,
        "local_name": local_name,
        "data_url": "",
        "format": "",
        "source_name": path.name if path is not None else "",
    }
    if path is None:
        return payload
    suffix = path.suffix.lower()
    # Browsers generally cannot @font-face load .ttc collections.
    if suffix in {".ttf", ".otf", ".woff", ".woff2"}:
        import base64

        raw = path.read_bytes()
        # Keep component messages small-ish; skip huge faces and rely on export preview.
        if len(raw) <= 12_000_000:
            mime = {
                ".ttf": "font/ttf",
                ".otf": "font/otf",
                ".woff": "font/woff",
                ".woff2": "font/woff2",
            }[suffix]
            fmt = {
                ".ttf": "truetype",
                ".otf": "opentype",
                ".woff": "woff",
                ".woff2": "woff2",
            }[suffix]
            payload["data_url"] = (
                f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")
            )
            payload["format"] = fmt
    return payload
