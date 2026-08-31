# coding: utf-8
"""Frontend-independent structural QA for copy and generated poster artifacts."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


def check_garbled_text(text: str, label: str) -> List[Dict[str, str]]:
    value = str(text or "")
    issues: List[Dict[str, str]] = []
    if "�" in value or "锟" in value:
        issues.append(
            {
                "level": "fail",
                "code": "garbled_text",
                "msg": f"{label}疑似包含乱码。",
            }
        )
    if re.search(r"\{\{[^}]+\}\}|<[^>]{2,40}>|\b(?:null|undefined|nan)\b", value, re.I):
        issues.append(
            {
                "level": "fail",
                "code": "placeholder_text",
                "msg": f"{label}疑似包含占位符或内部参数。",
            }
        )
    return issues


def check_copy_bundle(
    texts: Optional[Dict[str, str]] = None,
    ad_copy: str = "",
) -> Dict[str, Any]:
    texts = texts or {}
    issues: List[Dict[str, str]] = []
    for key, label in (
        ("title", "标题"),
        ("headline", "金句"),
        ("subline", "补充句"),
    ):
        issues.extend(check_garbled_text(texts.get(key, ""), label))
    issues.extend(check_garbled_text(ad_copy[:1000], "营销文案"))
    title = str(texts.get("title") or "").strip()
    if not title:
        issues.append({"level": "fail", "code": "missing_title", "msg": "海报标题为空。"})
    elif len(title) > 18:
        issues.append(
            {"level": "warn", "code": "title_too_long", "msg": "海报标题可能过长。"}
        )
    if not issues:
        issues.append(
            {"level": "pass", "code": "copy_ok", "msg": "文案字段完整且未见乱码。"}
        )
    failures = sum(item["level"] == "fail" for item in issues)
    warnings = sum(item["level"] == "warn" for item in issues)
    return {
        "name": "文案完整性",
        "score": max(0, 100 - failures * 40 - warnings * 10),
        "issues": issues,
    }


def check_generation_integrity(ctx: Dict[str, Any]) -> Dict[str, Any]:
    issues: List[Dict[str, str]] = []
    posters = list(ctx.get("posters") or [])
    if not posters:
        if ctx.get("generate_poster"):
            issues.append(
                {"level": "fail", "code": "missing_posters", "msg": "未生成海报文件。"}
            )
        else:
            issues.append(
                {"level": "pass", "code": "copy_only", "msg": "本次为仅文案请求。"}
            )
    for index, poster in enumerate(posters, start=1):
        source = str(poster.get("background_source") or "")
        if source not in {"seedream", "stock", "procedural"}:
            issues.append(
                {
                    "level": "fail",
                    "code": "unknown_background_source",
                    "msg": f"第{index}张海报缺少真实背景来源。",
                }
            )
        if not poster.get("final_local_product_paste"):
            issues.append(
                {
                    "level": "fail",
                    "code": "product_not_final",
                    "msg": f"第{index}张海报未确认最终本地商品覆盖。",
                }
            )
        if not poster.get("local_text_rendering"):
            issues.append(
                {
                    "level": "fail",
                    "code": "text_not_local",
                    "msg": f"第{index}张海报未确认本地文字渲染。",
                }
            )
        if poster.get("product_sent_to_provider"):
            issues.append(
                {
                    "level": "fail",
                    "code": "product_provider_leak",
                    "msg": f"第{index}张海报违反商品图隔离规则。",
                }
            )
    if ctx.get("fallback_used"):
        issues.append(
            {
                "level": "warn",
                "code": "background_fallback",
                "msg": f"背景已回退为 {ctx.get('background_source') or 'local'}。",
            }
        )
    if not issues:
        issues.append(
            {
                "level": "pass",
                "code": "generation_integrity_ok",
                "msg": "背景来源、商品保护和本地文字状态完整。",
            }
        )
    failures = sum(item["level"] == "fail" for item in issues)
    warnings = sum(item["level"] == "warn" for item in issues)
    return {
        "name": "生成完整性",
        "score": max(0, 100 - failures * 45 - warnings * 8),
        "issues": issues,
        "background_source": ctx.get("background_source"),
        "fallback_used": bool(ctx.get("fallback_used")),
        "final_local_product_paste": all(
            bool(item.get("final_local_product_paste")) for item in posters
        ) if posters else not bool(ctx.get("generate_poster")),
        "local_text_rendering": all(
            bool(item.get("local_text_rendering")) for item in posters
        ) if posters else not bool(ctx.get("generate_poster")),
    }


def run_generation_qa(ctx: Dict[str, Any]) -> Dict[str, Any]:
    sections = [
        check_copy_bundle(ctx.get("texts") or {}, ctx.get("ad_copy") or ""),
        check_generation_integrity(ctx),
    ]
    score = int(round(sum(section["score"] for section in sections) / len(sections)))
    failures = sum(
        item["level"] == "fail" for section in sections for item in section["issues"]
    )
    warnings = sum(
        item["level"] == "warn" for section in sections for item in section["issues"]
    )
    if failures:
        verdict, level = "未通过", "fail"
    elif warnings:
        verdict, level = "有回退或风险", "warn"
    else:
        verdict, level = "通过", "pass"
    return {
        "overall_score": score,
        "verdict": verdict,
        "verdict_level": level,
        "sections": sections,
        "fail_count": failures,
        "warn_count": warnings,
        "background_source": ctx.get("background_source"),
        "fallback_used": bool(ctx.get("fallback_used")),
        "final_local_product_paste": sections[1]["final_local_product_paste"],
        "local_text_rendering": sections[1]["local_text_rendering"],
    }


def run_complete_poster_group_qa(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Structural QA for provider-rendered posters; no visual claims are inferred."""
    checks = {
        "exactly_three_files": int(ctx.get("poster_count") or 0) == 3,
        "dimensions_consistent": bool(ctx.get("dimensions_consistent")),
        "files_distinct": bool(ctx.get("files_distinct")),
        "paths_contained": bool(ctx.get("paths_contained")),
        "zip_contains_three_expected_files": (
            int(ctx.get("zip_entry_count") or 0) == 3
            and bool(ctx.get("zip_entries_expected"))
        ),
        "provider_source_recorded": ctx.get("poster_source")
        == "seedream_complete_poster",
        "local_product_compositing_disabled": not bool(
            ctx.get("local_product_compositing")
        ),
        "local_text_rendering_disabled": not bool(ctx.get("local_text_rendering")),
    }
    failed = [name for name, passed in checks.items() if not passed]
    return {
        "qa_type": "complete_provider_poster_structural",
        "verdict": "pass" if not failed else "fail",
        "verdict_level": "pass" if not failed else "fail",
        "checks": checks,
        "failed_checks": failed,
        "not_automatically_verified": [
            "product_fidelity",
            "text_spelling_accuracy",
            "aesthetic_quality",
            "legal_compliance",
            "brand_representation",
        ],
        "product_sent_to_provider": True,
        "final_local_product_paste": False,
        "local_product_compositing": False,
        "local_text_rendering": False,
    }
