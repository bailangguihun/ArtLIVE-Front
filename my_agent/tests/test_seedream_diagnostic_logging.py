from __future__ import annotations

import base64
import json
import logging
import socket
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import requests

from my_agent.backend.integrations.seedream_client import (
    ImageGroupResultError,
    ImageProviderError,
    SeedreamClient,
)
from my_agent.backend.services.generation_service import (
    IdempotencyConflictError,
    IdempotencyRegistry,
)
from my_agent.backend_api_client import BackendAPIClient
from my_agent.tests.helpers import FakeHTTPResponse, FakeHTTPSession, png_bytes, settings_for
from my_agent.tests.test_product_poster_group_integration import (
    CountingGroupSession,
    create_stack,
    group_payload,
    submit,
)


AUDIT_LOGGER_NAME = "advertising_backend.provider_audit"
LOCAL_REQUEST_ID = "34d4fe86-4139-4ebf-8f30-2dbfd1efbc61"
PRIVATE_PROMPT = "PRIVATE-PROMPT product-description marketing-copy"
_REAL_SOCKET_CONNECT = socket.socket.connect


def _local_only_socket_connect(sock, address):
    host = str(address[0]) if isinstance(address, tuple) and address else ""
    if host == "::1" or host.startswith("127."):
        return _REAL_SOCKET_CONNECT(sock, address)
    raise AssertionError("external socket transmission blocked")


class _RecordHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.INFO)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


class _FailingBodyResponse(FakeHTTPResponse):
    def iter_content(self, chunk_size: int = 64 * 1024):
        _ = chunk_size
        raise requests.ConnectionError("PRIVATE streamed-body failure")
        yield b""  # pragma: no cover - keeps this method a generator


def json_response(
    document: object,
    *,
    status_code: int = 200,
    headers: dict[str, str] | None = None,
) -> FakeHTTPResponse:
    return FakeHTTPResponse(
        json.dumps(document, separators=(",", ":")).encode("utf-8"),
        status_code=status_code,
        headers=headers,
    )


def b64_item(color: tuple[int, int, int, int], size: tuple[int, int] = (64, 96)) -> dict[str, str]:
    return {
        "b64_json": base64.b64encode(png_bytes(size=size, color=color)).decode("ascii")
    }


class SeedreamDiagnosticLoggingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.socket_guard = patch.object(
            socket.socket,
            "connect",
            new=_local_only_socket_connect,
        )
        self.socket_guard.start()
        self.logger = logging.getLogger(AUDIT_LOGGER_NAME)
        self.handler = _RecordHandler()
        self.previous_level = self.logger.level
        self.previous_propagate = self.logger.propagate
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False
        self.logger.addHandler(self.handler)

    def tearDown(self) -> None:
        self.logger.removeHandler(self.handler)
        self.logger.setLevel(self.previous_level)
        self.logger.propagate = self.previous_propagate
        self.socket_guard.stop()
        self.temporary.cleanup()

    @property
    def records(self) -> list[dict]:
        return [json.loads(message) for message in self.handler.messages]

    @property
    def rendered_logs(self) -> str:
        return "\n".join(self.handler.messages)

    def client(self, session: FakeHTTPSession) -> SeedreamClient:
        return SeedreamClient(
            settings_for(self.root, seedream_configured=True),
            session=session,
        )

    def group_call(self, session: FakeHTTPSession):
        return self.client(session).generate_product_poster_group(
            prompt=PRIVATE_PROMPT,
            product_reference=png_bytes(size=(32, 48), transparent_border=True),
            requested_count=3,
            sanitized_prompt_metadata={"character_count": len(PRIVATE_PROMPT)},
            local_request_id=LOCAL_REQUEST_ID,
        )

    def event(self, name: str) -> dict:
        matches = [record for record in self.records if record["event"] == name]
        self.assertTrue(matches, f"missing event {name}")
        return matches[-1]

    def test_success_path_emits_correlated_redacted_events(self) -> None:
        encoded = base64.b64encode(png_bytes(size=(64, 96), color=(1, 2, 3, 255))).decode("ascii")
        session = FakeHTTPSession(
            post_result=json_response(
                {
                    "request_id": "provider_req_123",
                    "data": [
                        b64_item((210, 20, 30, 255)),
                        b64_item((20, 210, 30, 255)),
                        b64_item((20, 30, 210, 255)),
                    ],
                },
                headers={"x-request-id": "provider_header_123"},
            )
        )
        result = self.group_call(session)

        self.assertEqual(3, len(result.images))
        self.assertEqual(1, session.post_calls)
        self.assertEqual(0, session.get_calls)
        started = self.event("seedream_post_started")
        self.assertEqual(LOCAL_REQUEST_ID, started["local_request_id"])
        self.assertEqual(3, started["requested_image_count"])
        completed = self.event("seedream_post_completed")
        self.assertEqual(200, completed["upstream_status"])
        self.assertEqual("2xx", completed["upstream_status_class"])
        parsed = self.event("seedream_response_parsed")
        self.assertEqual(3, parsed["returned_item_count"])
        self.assertEqual("provider_req_123", parsed["provider_request_id"])
        group = self.event("seedream_group_validation_completed")
        self.assertEqual(3, group["parsed_image_count"])
        self.assertEqual("passed", group["duplicate_validation_outcome"])
        self.assertEqual("passed", group["dimensions_validation_outcome"])
        self.assertTrue(all(record.get("timestamp", "").endswith("+00:00") for record in self.records))

        forbidden = [
            PRIVATE_PROMPT,
            "offline-test-key",
            "Authorization",
            "Bearer",
            "data:image",
            "base64",
            encoded,
            "https://",
            "product-description",
            "marketing-copy",
        ]
        for value in forbidden:
            self.assertNotIn(value, self.rendered_logs)

    def test_http_failures_record_status_allowlisted_code_and_original_category(self) -> None:
        cases = {
            400: "invalid_request",
            401: "unauthorized",
            403: "forbidden",
            429: "rate_limited",
            500: "server_error",
        }
        for status, expected_category in cases.items():
            with self.subTest(status=status):
                self.handler.messages.clear()
                session = FakeHTTPSession(
                    post_result=json_response(
                        {
                            "code": "InvalidParameter",
                            "request_id": "provider_req_safe",
                            "message": "PRIVATE raw provider body prompt product image",
                        },
                        status_code=status,
                    )
                )
                with self.assertRaises(ImageProviderError) as raised:
                    self.group_call(session)
                self.assertEqual(expected_category, raised.exception.category)
                self.assertEqual(status, raised.exception.upstream_status)
                self.assertEqual("InvalidParameter", raised.exception.provider_error_code)
                self.assertEqual("provider_req_safe", raised.exception.provider_request_id)
                completed = self.event("seedream_post_completed")
                self.assertEqual(status, completed["upstream_status"])
                self.assertEqual(expected_category, completed["internal_error_category"])
                self.assertEqual("InvalidParameter", completed["provider_error_code"])
                self.assertNotIn("PRIVATE raw provider body", self.rendered_logs)
                self.assertEqual(1, session.post_calls)

    def test_network_tls_and_timeout_failures_are_safely_categorized(self) -> None:
        cases = [
            (requests.ConnectionError("private URL"), "connection_error", "network_error"),
            (requests.exceptions.SSLError("private TLS detail"), "tls_error", "network_error"),
            (requests.Timeout("private timeout detail"), "timeout", "timeout"),
        ]
        for exception, audit_category, exception_category in cases:
            with self.subTest(audit_category=audit_category):
                self.handler.messages.clear()
                session = FakeHTTPSession(post_result=exception)
                with self.assertRaises(ImageProviderError) as raised:
                    self.group_call(session)
                self.assertEqual(exception_category, raised.exception.category)
                failed = self.event("seedream_post_failed")
                self.assertEqual(audit_category, failed["internal_error_category"])
                self.assertNotIn("private", self.rendered_logs.lower())
                self.assertEqual(1, session.post_calls)

    def test_url_download_events_include_indices_dimensions_and_no_url(self) -> None:
        urls = [f"https://signed.invalid/result-{index}.png?secret=query" for index in range(1, 4)]
        session = FakeHTTPSession(
            post_result=json_response({"data": [{"url": value} for value in urls]}),
            get_result=[
                FakeHTTPResponse(png_bytes(size=(64, 96), color=color))
                for color in ((200, 1, 1, 255), (1, 200, 1, 255), (1, 1, 200, 255))
            ],
        )
        self.group_call(session)
        started = [r for r in self.records if r["event"] == "seedream_result_download_started"]
        completed = [r for r in self.records if r["event"] == "seedream_result_download_completed"]
        self.assertEqual([1, 2, 3], [record["result_index"] for record in started])
        self.assertEqual([1, 2, 3], [record["result_index"] for record in completed])
        self.assertTrue(all(record["decoded_width"] == 64 for record in completed))
        self.assertTrue(all(record["decoded_height"] == 96 for record in completed))
        self.assertEqual(3, session.get_calls)
        self.assertNotIn("signed.invalid", self.rendered_logs)
        self.assertNotIn("secret=query", self.rendered_logs)

    def test_download_failure_records_only_safe_status_and_category(self) -> None:
        session = FakeHTTPSession(
            post_result=json_response(
                {"data": [{"url": f"https://signed.invalid/{index}?token=private"} for index in range(3)]}
            ),
            get_result=FakeHTTPResponse(b"PRIVATE response", status_code=403),
        )
        with self.assertRaises(ImageProviderError) as raised:
            self.group_call(session)
        self.assertEqual("forbidden", raised.exception.category)
        failed = self.event("seedream_result_download_failed")
        self.assertEqual(1, failed["result_index"])
        self.assertEqual(403, failed["upstream_status"])
        self.assertEqual("forbidden", failed["internal_error_category"])
        self.assertNotIn("signed.invalid", self.rendered_logs)
        self.assertNotIn("PRIVATE response", self.rendered_logs)
        self.assertEqual(1, session.get_calls)

    def test_group_count_failures_are_logged_without_fabrication_or_retry(self) -> None:
        for actual_count in (0, 1, 2, 4):
            with self.subTest(actual_count=actual_count):
                self.handler.messages.clear()
                session = FakeHTTPSession(
                    post_result=json_response({"data": [{} for _ in range(actual_count)]})
                )
                with self.assertRaises(ImageGroupResultError) as raised:
                    self.group_call(session)
                self.assertEqual(actual_count, raised.exception.actual_count)
                failed = self.event("seedream_group_validation_failed")
                self.assertEqual(3, failed["expected_image_count"])
                self.assertEqual(actual_count, failed["actual_item_count"])
                self.assertEqual(0, failed["parsed_image_count"])
                self.assertEqual(1, session.post_calls)
                self.assertEqual(0, session.get_calls)

    def test_duplicate_and_dimension_validation_categories_remain_distinct(self) -> None:
        duplicate = b64_item((8, 9, 10, 255))
        scenarios = [
            ([duplicate, duplicate, duplicate], "duplicate_group_image"),
            (
                [
                    b64_item((1, 2, 3, 255), (64, 96)),
                    b64_item((4, 5, 6, 255), (64, 96)),
                    b64_item((7, 8, 9, 255), (65, 96)),
                ],
                "inconsistent_group_dimensions",
            ),
        ]
        for items, category in scenarios:
            with self.subTest(category=category):
                self.handler.messages.clear()
                session = FakeHTTPSession(post_result=json_response({"data": items}))
                with self.assertRaises(ImageProviderError) as raised:
                    self.group_call(session)
                self.assertEqual(category, raised.exception.category)
                self.assertEqual(category, self.event("seedream_group_validation_failed")["internal_error_category"])
                self.assertEqual(1, session.post_calls)

    def test_malformed_provider_json_is_typed_and_never_logged_raw(self) -> None:
        session = FakeHTTPSession(post_result=FakeHTTPResponse(b"PRIVATE malformed response"))
        with self.assertRaises(ImageProviderError) as raised:
            self.group_call(session)
        self.assertEqual("invalid_response", raised.exception.category)
        self.assertEqual(
            "invalid_response",
            self.event("seedream_response_parse_failed")["internal_error_category"],
        )
        self.assertNotIn("PRIVATE malformed response", self.rendered_logs)

    def test_streamed_provider_and_image_body_failures_remain_typed(self) -> None:
        provider_session = FakeHTTPSession(post_result=_FailingBodyResponse(status_code=200))
        with self.assertRaises(ImageProviderError) as provider_error:
            self.group_call(provider_session)
        self.assertEqual("network_error", provider_error.exception.category)
        self.assertEqual(
            "network_error",
            self.event("seedream_response_parse_failed")["internal_error_category"],
        )

        self.handler.messages.clear()
        image_session = FakeHTTPSession(
            post_result=json_response(
                {"data": [{"url": f"https://signed.invalid/{index}"} for index in range(3)]}
            ),
            get_result=_FailingBodyResponse(status_code=200),
        )
        with self.assertRaises(ImageProviderError) as image_error:
            self.group_call(image_session)
        self.assertEqual("network_error", image_error.exception.category)
        failed = self.event("seedream_result_download_failed")
        self.assertEqual("network_error", failed["internal_error_category"])
        self.assertEqual(200, failed["upstream_status"])
        self.assertNotIn("PRIVATE streamed-body failure", self.rendered_logs)
        self.assertNotIn("signed.invalid", self.rendered_logs)

    def test_safe_provider_request_id_is_retained_and_unsafe_value_is_dropped(self) -> None:
        safe_session = FakeHTTPSession(
            post_result=json_response(
                {"code": "InvalidParameter", "request_id": "request_safe_123"},
                status_code=400,
            )
        )
        with self.assertRaises(ImageProviderError) as safe_error:
            self.group_call(safe_session)
        self.assertEqual("request_safe_123", safe_error.exception.provider_request_id)

        self.handler.messages.clear()
        unsafe_session = FakeHTTPSession(
            post_result=json_response(
                {
                    "code": "InvalidParameter",
                    "request_id": "https://unsafe.invalid/?token=secret",
                },
                status_code=400,
            )
        )
        with self.assertRaises(ImageProviderError) as unsafe_error:
            self.group_call(unsafe_session)
        self.assertIsNone(unsafe_error.exception.provider_request_id)
        self.assertNotIn("unsafe.invalid", self.rendered_logs)

    def test_idempotency_owner_replay_and_conflict_do_not_log_keys_or_fingerprints(self) -> None:
        registry = IdempotencyRegistry()
        calls = 0

        def callback():
            nonlocal calls
            calls += 1
            return "result"

        self.assertEqual(
            "result",
            registry.execute(
                "PRIVATE-idempotency-key",
                "PRIVATE-fingerprint",
                callback,
                local_request_id=LOCAL_REQUEST_ID,
                generation_mode="seedream_product_poster_group",
            ),
        )
        self.assertEqual(
            "result",
            registry.execute(
                "PRIVATE-idempotency-key",
                "PRIVATE-fingerprint",
                callback,
                local_request_id=LOCAL_REQUEST_ID,
                generation_mode="seedream_product_poster_group",
            ),
        )
        with self.assertRaises(IdempotencyConflictError):
            registry.execute(
                "PRIVATE-idempotency-key",
                "DIFFERENT-private-fingerprint",
                callback,
                local_request_id=LOCAL_REQUEST_ID,
                generation_mode="seedream_product_poster_group",
            )
        self.assertEqual(1, calls)
        self.assertEqual(
            ["idempotency_owner", "idempotency_replay", "idempotency_conflict"],
            [record["event"] for record in self.records],
        )
        self.assertNotIn("PRIVATE-idempotency-key", self.rendered_logs)
        self.assertNotIn("fingerprint", self.rendered_logs.lower())

    def test_api_error_response_and_client_retain_safe_local_request_id(self) -> None:
        session = CountingGroupSession(
            post_result=json_response(
                {"code": "InvalidParameter", "request_id": "provider_req_123"},
                status_code=400,
            )
        )
        stack = create_stack(self.root, session, enabled=True)
        response = submit(
            stack["client"],
            group_payload(),
            png_bytes(size=(48, 72), transparent_border=True),
            str(uuid.uuid4()),
        )
        self.assertEqual(502, response.status_code)
        detail = response.json()["error"]
        self.assertEqual("provider_invalid_request", detail["code"])
        safe_request_id = str(uuid.UUID(detail["request_id"]))
        handled = self.event("seedream_provider_error_handled")
        self.assertEqual(safe_request_id, handled["local_request_id"])
        self.assertEqual("invalid_request", handled["internal_error_category"])
        client_error = BackendAPIClient._safe_error(response)
        self.assertEqual(safe_request_id, client_error.request_id)
        self.assertNotIn("provider_req_123", response.text)
        stack["client"].close()

    def test_api_maps_safe_provider_categories_without_raw_provider_detail(self) -> None:
        cases = {
            401: (502, "provider_unauthorized"),
            403: (502, "provider_forbidden"),
            429: (503, "provider_rate_limited"),
            500: (502, "provider_server_error"),
        }
        for upstream_status, (local_status, local_code) in cases.items():
            with self.subTest(upstream_status=upstream_status):
                self.handler.messages.clear()
                case_root = self.root / str(upstream_status)
                case_root.mkdir(parents=True, exist_ok=True)
                session = CountingGroupSession(
                    post_result=json_response(
                        {
                            "code": "SafeProviderCode",
                            "message": "PRIVATE provider diagnostic body",
                        },
                        status_code=upstream_status,
                    )
                )
                stack = create_stack(case_root, session, enabled=True)
                response = submit(
                    stack["client"],
                    group_payload(),
                    png_bytes(size=(48, 72), transparent_border=True),
                    str(uuid.uuid4()),
                )
                self.assertEqual(local_status, response.status_code)
                self.assertEqual(local_code, response.json()["error"]["code"])
                handled = self.event("seedream_provider_error_handled")
                self.assertEqual(
                    self.event("seedream_post_completed")["internal_error_category"],
                    handled["internal_error_category"],
                )
                self.assertNotIn("PRIVATE provider diagnostic body", response.text)
                self.assertNotIn("PRIVATE provider diagnostic body", self.rendered_logs)
                self.assertEqual(1, session.post_calls)
                stack["client"].close()

    def test_client_rejects_unsafe_backend_request_id(self) -> None:
        response = FakeHTTPResponse(
            status_code=502,
            json_value={
                "error": {
                    "code": "provider_invalid_request",
                    "message": "Safe message",
                    "request_id": "https://unsafe.invalid/?token=private",
                }
            },
        )
        error = BackendAPIClient._safe_error(response)
        self.assertEqual("", error.request_id)
        self.assertNotIn("unsafe.invalid", repr(error))

    def test_streamlit_error_path_displays_only_the_safe_local_request_id(self) -> None:
        source = (Path(__file__).resolve().parents[1] / "app.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('st.caption(f"请求编号：{exc.request_id}")', source)
        self.assertNotIn("provider_request_id", source)
        self.assertNotIn("idempotency_key}", source)

    def test_feature_gate_still_blocks_before_provider_boundary(self) -> None:
        session = CountingGroupSession(post_result=AssertionError("provider must not run"))
        stack = create_stack(self.root, session, enabled=False)
        response = submit(
            stack["client"],
            group_payload(),
            png_bytes(size=(48, 72), transparent_border=True),
            str(uuid.uuid4()),
        )
        self.assertEqual(503, response.status_code)
        self.assertEqual("feature_disabled", response.json()["error"]["code"])
        self.assertEqual(0, session.post_calls)
        self.assertFalse(any(r["event"] == "seedream_post_started" for r in self.records))
        stack["client"].close()


if __name__ == "__main__":
    unittest.main()
