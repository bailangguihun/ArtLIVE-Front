from __future__ import annotations

import hashlib
import json
from typing import Any, Dict

from my_agent.backend import API_VERSION
from my_agent.backend.api.schemas import (
    MarketingAdvice,
    MarketingAdviceRequest,
    MarketingAdviceResponse,
)
from my_agent.backend.core.config import Settings
from my_agent.backend.integrations.marketing_advice_classifier import (
    classify_product_category_smart,
)


ADVICE_VERSION = "catalog-v1"
INPUT_SIGNATURE_DOMAIN = "marketing-advice-input-v1|"
ADVICE_SIGNATURE_DOMAIN = "marketing-advice-output-v1|"
_INPUT_FIELDS = ("product_info", "product_short_name", "creative_note")


def canonical_json(value: Any) -> str:
    """Return the exact canonical JSON representation used by both signatures."""
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def normalize_marketing_advice_request(
    request: MarketingAdviceRequest,
) -> Dict[str, str]:
    """Strip edge Unicode whitespace while preserving interior text verbatim.

    Python ``str.strip`` removes leading and trailing spaces, tabs, and line-break
    characters (including Unicode whitespace). Interior whitespace, CR/LF form,
    array order, and Unicode code-point composition are not changed.
    """
    return {field: getattr(request, field).strip() for field in _INPUT_FIELDS}


def _signature(domain: str, value: Any) -> str:
    payload = (domain + canonical_json(value)).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


class MarketingAdviceService:
    """Resolve marketing advice via AI classification with keyword fallback."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or Settings.from_env()

    def create(self, request: MarketingAdviceRequest) -> MarketingAdviceResponse:
        normalized_request = normalize_marketing_advice_request(request)
        classified = classify_product_category_smart(
            settings=self._settings,
            **normalized_request,
        )
        advice = MarketingAdvice.model_validate(classified)
        advice_document = advice.model_dump(mode="json")

        return MarketingAdviceResponse(
            api_version=API_VERSION,
            advice_version=ADVICE_VERSION,
            status="present",
            input_signature_sha256=_signature(
                INPUT_SIGNATURE_DOMAIN, normalized_request
            ),
            advice_signature_sha256=_signature(
                ADVICE_SIGNATURE_DOMAIN, advice_document
            ),
            advice=advice,
        )
