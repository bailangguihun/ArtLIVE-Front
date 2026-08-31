from __future__ import annotations

import io
import json
import logging
import os
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

from my_agent.backend.core.config import (
    DEFAULT_SEEDREAM_IMAGE_SIZE,
    DEFAULT_SEEDREAM_MODEL_ID,
    OFFICIAL_SEEDREAM_API_ENDPOINT,
    ConfigurationError,
    Settings,
)
from my_agent.backend.integrations.seedream_client import (
    ImageProviderError,
    SeedreamClient,
)
from my_agent.tests.helpers import FakeHTTPSession
from my_agent.tests.helpers import OfflineASGIClient


@contextmanager
def changed_directory(path: Path):
    original = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(original)


class ConfigurationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.dotenv = self.root / ".env"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_dotenv(self, values: dict[str, str]) -> None:
        self.dotenv.write_text(
            "".join(f"{key}={value}\n" for key, value in values.items()),
            encoding="utf-8",
        )

    def settings(self, environment: dict[str, str] | None = None) -> Settings:
        return Settings.from_env(
            project_root=self.root,
            dotenv_path=self.dotenv,
            environment=environment or {},
        )

    def test_production_dotenv_path_is_source_based_and_cwd_independent(self) -> None:
        app_root = Path(__file__).resolve().parents[1]
        expected = app_root / ".env"
        locations = [app_root.parent, app_root, app_root / "backend"]
        for location in locations:
            with self.subTest(location=location), changed_directory(location):
                self.assertEqual(expected.resolve(), Settings.production_dotenv_path())

    def test_safe_template_and_ignore_rules_cover_production_dotenv(self) -> None:
        app_root = Path(__file__).resolve().parents[1]
        example = (app_root / ".env.example").read_text(encoding="utf-8")
        ignore = (app_root / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("ARK_API_KEY=\n", example)
        self.assertIn("SEEDREAM_API_KEY=\n", example)
        self.assertIn("deprecated", example.lower())
        self.assertIn("SEEDREAM_IMAGE_SIZE=1024x1536", example)
        self.assertIn("SEEDREAM_WATERMARK=false", example)
        self.assertIn("AD_REQUIRE_EDGE_PROXY=false", example)
        self.assertRegex(example, r"(?m)^AD_EDGE_PROXY_TOKEN=$")
        self.assertRegex(ignore, r"(?m)^\.env$")
        self.assertRegex(ignore, r"(?m)^\.env\.\*$")
        self.assertRegex(ignore, r"(?m)^!\.env\.example$")

    def test_edge_proxy_defaults_preserve_unauthenticated_local_mode(self) -> None:
        settings = self.settings()
        self.assertFalse(settings.require_edge_proxy)
        self.assertEqual("", settings.edge_proxy_token)
        self.assertFalse(settings.edge_proxy_validation_enabled)

    def test_edge_proxy_enforcement_accepts_a_synthetic_header_value(self) -> None:
        synthetic_token = "synthetic-edge-token-for-tests"
        settings = self.settings(
            {
                "AD_REQUIRE_EDGE_PROXY": "true",
                "AD_EDGE_PROXY_TOKEN": synthetic_token,
            }
        )
        self.assertTrue(settings.require_edge_proxy)
        self.assertTrue(settings.edge_proxy_validation_enabled)
        self.assertEqual(synthetic_token, settings.edge_proxy_token)
        self.assertNotIn(synthetic_token, repr(settings))
        self.assertNotIn(synthetic_token, json.dumps(settings.to_safe_dict()))

    def test_edge_proxy_enforcement_fails_closed_without_a_token(self) -> None:
        for token in (None, "", " ", "\t"):
            environment = {"AD_REQUIRE_EDGE_PROXY": "true"}
            if token is not None:
                environment["AD_EDGE_PROXY_TOKEN"] = token
            with self.subTest(token_kind=repr(token)), self.assertRaises(
                ConfigurationError
            ) as captured:
                self.settings(environment)
            self.assertNotIn(repr(token), str(captured.exception))

    def test_edge_proxy_rejects_values_unsafe_for_an_http_header(self) -> None:
        invalid_values = (
            " leading-space",
            "trailing-space ",
            "contains space",
            "line\rbreak",
            "line\nbreak",
            "nul\x00byte",
            "delete\x7fbyte",
            "non-ascii-密码",
        )
        for invalid in invalid_values:
            with self.subTest(invalid=ascii(invalid)), self.assertRaises(
                ConfigurationError
            ) as captured:
                self.settings(
                    {
                        "AD_REQUIRE_EDGE_PROXY": "true",
                        "AD_EDGE_PROXY_TOKEN": invalid,
                    }
                )
            self.assertNotIn(invalid, str(captured.exception))

    def test_configured_edge_token_enables_validation_even_when_flag_is_false(self) -> None:
        settings = self.settings(
            {
                "AD_REQUIRE_EDGE_PROXY": "false",
                "AD_EDGE_PROXY_TOKEN": "synthetic-deliberate-token",
            }
        )
        self.assertFalse(settings.require_edge_proxy)
        self.assertTrue(settings.edge_proxy_validation_enabled)

    def test_invalid_deliberate_token_is_rejected_even_when_flag_is_false(self) -> None:
        with self.assertRaises(ConfigurationError):
            self.settings(
                {
                    "AD_REQUIRE_EDGE_PROXY": "false",
                    "AD_EDGE_PROXY_TOKEN": "unsafe token",
                }
            )

    def test_explicit_empty_environment_token_does_not_fall_back_to_dotenv(self) -> None:
        self.write_dotenv(
            {
                "AD_REQUIRE_EDGE_PROXY": "true",
                "AD_EDGE_PROXY_TOKEN": "synthetic-dotenv-edge-token",
            }
        )
        with self.assertRaises(ConfigurationError):
            self.settings(
                {
                    "AD_REQUIRE_EDGE_PROXY": "true",
                    "AD_EDGE_PROXY_TOKEN": "",
                }
            )

    def test_edge_proxy_environment_isolation_is_deterministic(self) -> None:
        protected = self.settings(
            {
                "AD_REQUIRE_EDGE_PROXY": "true",
                "AD_EDGE_PROXY_TOKEN": "synthetic-isolated-edge-token",
            }
        )
        local = self.settings({})
        self.assertTrue(protected.edge_proxy_validation_enabled)
        self.assertFalse(local.edge_proxy_validation_enabled)
        self.assertEqual("", local.edge_proxy_token)

    def test_synthetic_ark_key_loads_from_explicit_dotenv(self) -> None:
        self.write_dotenv({"ARK_API_KEY": "synthetic-dotenv-ark"})
        self.assertEqual("synthetic-dotenv-ark", self.settings().seedream_api_key)

    def test_operating_system_ark_overrides_all_other_sources(self) -> None:
        self.write_dotenv(
            {
                "ARK_API_KEY": "synthetic-dotenv-ark",
                "SEEDREAM_API_KEY": "synthetic-dotenv-legacy",
            }
        )
        settings = self.settings(
            {
                "ARK_API_KEY": "synthetic-os-ark",
                "SEEDREAM_API_KEY": "synthetic-os-legacy",
            }
        )
        self.assertEqual("synthetic-os-ark", settings.seedream_api_key)

    def test_operating_system_legacy_overrides_dotenv_ark(self) -> None:
        self.write_dotenv({"ARK_API_KEY": "synthetic-dotenv-ark"})
        settings = self.settings(
            {"SEEDREAM_API_KEY": "synthetic-os-legacy"}
        )
        self.assertEqual("synthetic-os-legacy", settings.seedream_api_key)

    def test_dotenv_ark_wins_over_dotenv_legacy(self) -> None:
        self.write_dotenv(
            {
                "ARK_API_KEY": "synthetic-dotenv-ark",
                "SEEDREAM_API_KEY": "synthetic-dotenv-legacy",
            }
        )
        self.assertEqual("synthetic-dotenv-ark", self.settings().seedream_api_key)

    def test_dotenv_legacy_remains_a_compatibility_fallback(self) -> None:
        self.write_dotenv({"SEEDREAM_API_KEY": "synthetic-dotenv-legacy"})
        self.assertEqual(
            "synthetic-dotenv-legacy", self.settings().seedream_api_key
        )

    def test_empty_and_whitespace_credentials_are_missing(self) -> None:
        self.write_dotenv(
            {"ARK_API_KEY": "   ", "SEEDREAM_API_KEY": ""}
        )
        settings = self.settings(
            {"ARK_API_KEY": " ", "SEEDREAM_API_KEY": "\t"}
        )
        self.assertEqual("", settings.seedream_api_key)
        self.assertFalse(settings.seedream_configured)

    def test_dotenv_local_is_never_loaded(self) -> None:
        (self.root / ".env.local").write_text(
            "ARK_API_KEY=synthetic-local-key\n", encoding="utf-8"
        )
        settings = Settings.from_env(project_root=self.root, environment={})
        self.assertEqual("", settings.seedream_api_key)

    def test_defaults_match_production_policy(self) -> None:
        settings = self.settings()
        self.assertEqual(OFFICIAL_SEEDREAM_API_ENDPOINT, settings.seedream_api_endpoint)
        self.assertEqual(DEFAULT_SEEDREAM_MODEL_ID, settings.seedream_model_id)
        self.assertEqual(DEFAULT_SEEDREAM_IMAGE_SIZE, settings.seedream_image_size)
        self.assertFalse(settings.seedream_watermark)

    def test_invalid_watermark_is_rejected_without_echoing_value(self) -> None:
        invalid = "synthetic-invalid-boolean"
        self.write_dotenv({"SEEDREAM_WATERMARK": invalid})
        with self.assertRaises(ConfigurationError) as captured:
            self.settings()
        self.assertNotIn(invalid, str(captured.exception))

    def test_invalid_image_size_is_rejected_without_echoing_value(self) -> None:
        invalid = "synthetic-invalid-size"
        self.write_dotenv({"SEEDREAM_IMAGE_SIZE": invalid})
        with self.assertRaises(ConfigurationError) as captured:
            self.settings()
        self.assertNotIn(invalid, str(captured.exception))

    def test_unallowlisted_endpoint_is_rejected_without_echoing_value(self) -> None:
        invalid = "https://synthetic.invalid/provider"
        self.write_dotenv({"SEEDREAM_API_ENDPOINT": invalid})
        with self.assertRaises(ConfigurationError) as captured:
            self.settings()
        self.assertNotIn(invalid, str(captured.exception))

    def test_missing_configuration_error_and_serialization_are_safe(self) -> None:
        synthetic_secret = "synthetic-secret-must-not-escape"
        self.write_dotenv({"ARK_API_KEY": synthetic_secret})
        configured = self.settings()
        serialized = json.dumps(configured.to_safe_dict(), sort_keys=True)
        self.assertNotIn(synthetic_secret, repr(configured))
        self.assertNotIn(synthetic_secret, serialized)

        missing = Settings.from_env(
            project_root=self.root,
            dotenv_path=self.root / "missing.env",
            environment={},
        )
        session = FakeHTTPSession()
        client = SeedreamClient(missing, session=session)
        log_output = io.StringIO()
        handler = logging.StreamHandler(log_output)
        logger = logging.getLogger("advertising_backend")
        logger.addHandler(handler)
        try:
            with self.assertRaises(ImageProviderError) as captured:
                client.generate_background("synthetic background only")
        finally:
            logger.removeHandler(handler)
        self.assertEqual("not_configured", captured.exception.category)
        rendered = f"{captured.exception!s} {captured.exception!r} {log_output.getvalue()}"
        self.assertNotIn(synthetic_secret, rendered)
        self.assertNotIn(str(self.root.resolve()), rendered)
        self.assertEqual(0, session.post_calls)

        from my_agent.backend.main import create_app

        api_client = OfflineASGIClient(create_app(settings=configured))
        try:
            response = api_client.get("/api/v1/capabilities")
        finally:
            api_client.close()
        self.assertEqual(200, response.status_code)
        self.assertNotIn(synthetic_secret, response.text)
        self.assertNotIn("api_key", response.text.lower())
        self.assertNotIn(str(self.root.resolve()), response.text)


if __name__ == "__main__":
    unittest.main()
