from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional


_AUDIT_FIELDS = frozenset(
    {
        "actual_image_count",
        "actual_item_count",
        "decoded_byte_length",
        "decoded_height",
        "decoded_width",
        "dimensions_validation_outcome",
        "duplicate_validation_outcome",
        "elapsed_ms",
        "expected_image_count",
        "generation_mode",
        "generation_id",
        "idempotency_role",
        "internal_error_category",
        "operation",
        "outcome",
        "parsed_image_count",
        "poster_index",
        "concept",
        "provider_attempt_count",
        "completed_poster_count",
        "provider",
        "provider_error_code",
        "provider_request_id",
        "requested_image_count",
        "response_format",
        "result_index",
        "result_source_type",
        "returned_item_count",
        "upstream_status",
        "upstream_status_class",
    }
)
_MACHINE_VALUE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_FORBIDDEN_VALUE_MARKERS = (
    "authorization",
    "bearer",
    "base64",
    "data:image",
    "http://",
    "https://",
)


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def safe_log_context(request_id: str, event: str, **fields: object) -> str:
    allowed = {key: value for key, value in fields.items() if key in {
        "operation", "status", "category", "elapsed_ms", "background_source"
    }}
    suffix = " ".join(f"{key}={value}" for key, value in sorted(allowed.items()))
    return f"request_id={request_id} event={event}" + (f" {suffix}" if suffix else "")


def sanitize_audit_value(value: object, *, maximum_length: int = 128) -> Optional[str]:
    """Return a short machine value, never free-form provider or user content."""

    if value is None or isinstance(value, bool):
        return None
    rendered = str(value).strip()
    if not rendered or len(rendered) > min(maximum_length, 128):
        return None
    lowered = rendered.lower()
    if any(marker in lowered for marker in _FORBIDDEN_VALUE_MARKERS):
        return None
    if not _MACHINE_VALUE.fullmatch(rendered):
        return None
    return rendered


def provider_audit_event(
    logger: logging.Logger,
    event: str,
    local_request_id: str,
    **fields: object,
) -> Dict[str, Any]:
    """Emit one JSON audit event containing only explicitly allowlisted scalars."""

    safe_event = sanitize_audit_value(event) or "invalid_audit_event"
    safe_request_id = sanitize_audit_value(local_request_id) or "unbound"
    record: Dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": safe_event,
        "local_request_id": safe_request_id,
    }
    for key, value in fields.items():
        if key not in _AUDIT_FIELDS or value is None:
            continue
        if isinstance(value, bool):
            record[key] = value
        elif isinstance(value, int):
            record[key] = value
        elif isinstance(value, float):
            record[key] = round(value, 3)
        else:
            safe_value = sanitize_audit_value(value)
            if safe_value is not None:
                record[key] = safe_value
    logger.info(json.dumps(record, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    return record
