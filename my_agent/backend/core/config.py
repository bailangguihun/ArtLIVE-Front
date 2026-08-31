from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Mapping


OFFICIAL_SEEDREAM_API_ENDPOINT = (
    "https://ark.cn-beijing.volces.com/api/v3/images/generations"
)
DEFAULT_SEEDREAM_MODEL_ID = "doubao-seedream-5-0-pro-260628"
DEFAULT_SEEDREAM_IMAGE_SIZE = "1024x1536"
DEFAULT_SEEDREAM_WATERMARK = False

# Resolve production configuration from source location, never from process cwd.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROJECT_DOTENV_PATH = PROJECT_ROOT / ".env"

DEFAULT_CORS_ORIGINS = [
    "http://localhost:8501",
    "http://127.0.0.1:8501",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

_DOTENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_IMAGE_SIZE = re.compile(r"^([1-9][0-9]{2,4})x([1-9][0-9]{2,4})$")
_EDGE_PROXY_TOKEN = re.compile(r"^[\x21-\x7E]+$")
_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}


class ConfigurationError(ValueError):
    """Safe configuration failure that never contains a configuration value."""


def _available(value: object) -> str:
    return str(value or "").strip()


def _first_available(*values: object, default: str = "") -> str:
    for value in values:
        cleaned = _available(value)
        if cleaned:
            return cleaned
    return default


def _read_dotenv(path: Path) -> dict[str, str]:
    """Read one explicit dotenv file without searching or mutating os.environ."""
    if not path.is_file():
        return {}
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except (OSError, UnicodeError) as exc:
        raise ConfigurationError("Unable to read the project dotenv configuration.") from exc

    values: dict[str, str] = {}
    for line_number, original in enumerate(lines, start=1):
        line = original.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ConfigurationError(
                f"Invalid project dotenv syntax at line {line_number}."
            )
        key, raw_value = line.split("=", 1)
        key = key.strip()
        if not _DOTENV_KEY.fullmatch(key):
            raise ConfigurationError(
                f"Invalid project dotenv key at line {line_number}."
            )
        value = raw_value.strip()
        if value[:1] in {"'", '"'}:
            quote = value[0]
            if len(value) < 2 or value[-1] != quote:
                raise ConfigurationError(
                    f"Invalid quoted dotenv value at line {line_number}."
                )
            value = value[1:-1]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        values[key] = value
    return values


def _source_value(
    name: str,
    environment: Mapping[str, str],
    dotenv: Mapping[str, str],
    default: str = "",
) -> str:
    return _first_available(environment.get(name), dotenv.get(name), default=default)


def _exact_source_value(
    name: str,
    environment: Mapping[str, str],
    dotenv: Mapping[str, str],
) -> str:
    """Return an exact value while preserving an explicit empty OS override."""
    raw = environment[name] if name in environment else dotenv.get(name, "")
    return "" if raw is None else str(raw)


def _positive_int(raw: str, default: int) -> int:
    try:
        value = int(_available(raw))
    except ValueError:
        return default
    return value if value > 0 else default


def _positive_float(raw: str, default: float) -> float:
    try:
        value = float(_available(raw))
    except ValueError:
        return default
    return value if value > 0 else default


def _boolean(raw: str, default: bool, name: str) -> bool:
    cleaned = _available(raw).lower()
    if not cleaned:
        return default
    if cleaned in _TRUE_VALUES:
        return True
    if cleaned in _FALSE_VALUES:
        return False
    raise ConfigurationError(f"{name} must be true or false.")


def validate_seedream_image_size(value: str, max_pixels: int = 40_000_000) -> str:
    cleaned = _available(value)
    match = _IMAGE_SIZE.fullmatch(cleaned)
    if not match:
        raise ConfigurationError(
            "SEEDREAM_IMAGE_SIZE must use a WIDTHxHEIGHT pixel format."
        )
    width, height = (int(match.group(1)), int(match.group(2)))
    if width < 512 or height < 512 or width * height > max_pixels:
        raise ConfigurationError("SEEDREAM_IMAGE_SIZE is outside the allowed range.")
    return f"{width}x{height}"


@dataclass(frozen=True)
class Settings:
    project_root: Path
    artifact_root: Path
    max_upload_bytes: int = 10 * 1024 * 1024
    max_image_pixels: int = 40_000_000
    max_provider_image_bytes: int = 25 * 1024 * 1024
    seedream_api_key: str = field(default="", repr=False)
    seedream_model_id: str = DEFAULT_SEEDREAM_MODEL_ID
    seedream_api_endpoint: str = OFFICIAL_SEEDREAM_API_ENDPOINT
    seedream_image_size: str = DEFAULT_SEEDREAM_IMAGE_SIZE
    seedream_watermark: bool = DEFAULT_SEEDREAM_WATERMARK
    seedream_timeout_seconds: float = 120.0
    enable_seedream_product_poster_group: bool = False
    enable_seedream_product_poster_sequence: bool = False
    deepseek_api_key: str = field(default="", repr=False)
    deepseek_api_base: str = "https://api.deepseek.com"
    chat_model: str = "deepseek-chat"
    cors_origins: List[str] = field(default_factory=lambda: list(DEFAULT_CORS_ORIGINS))
    require_edge_proxy: bool = False
    edge_proxy_token: str = field(default="", repr=False)

    def __post_init__(self) -> None:
        token = self.edge_proxy_token
        if not token or token.isspace():
            if self.require_edge_proxy:
                raise ConfigurationError(
                    "AD_EDGE_PROXY_TOKEN is required when AD_REQUIRE_EDGE_PROXY is true."
                )
            object.__setattr__(self, "edge_proxy_token", "")
            return
        if not _EDGE_PROXY_TOKEN.fullmatch(token):
            raise ConfigurationError(
                "AD_EDGE_PROXY_TOKEN must be a valid HTTP header value."
            )

    @property
    def edge_proxy_validation_enabled(self) -> bool:
        """Validate edge credentials when required or deliberately configured."""
        return self.require_edge_proxy or bool(self.edge_proxy_token)

    @property
    def seedream_configured(self) -> bool:
        return bool(self.seedream_api_key.strip() and self.seedream_model_id.strip())

    @property
    def copy_provider_configured(self) -> bool:
        return bool(self.deepseek_api_key.strip())

    @property
    def stock_configured(self) -> bool:
        return bool(
            os.environ.get("PEXELS_API_KEY")
            or os.environ.get("PIXABAY_API_KEY")
            or os.environ.get("UNSPLASH_ACCESS_KEY")
        )

    @staticmethod
    def production_dotenv_path() -> Path:
        return PROJECT_DOTENV_PATH

    def to_safe_dict(self) -> dict[str, object]:
        """Return the only supported settings serialization; secrets are booleans."""
        return {
            "seedream_configured": self.seedream_configured,
            "copy_provider_configured": self.copy_provider_configured,
            "stock_configured": self.stock_configured,
            "seedream_model_id": self.seedream_model_id,
            "seedream_image_size": self.seedream_image_size,
            "seedream_watermark": self.seedream_watermark,
            "seedream_timeout_seconds": self.seedream_timeout_seconds,
            "enable_seedream_product_poster_group": self.enable_seedream_product_poster_group,
            "enable_seedream_product_poster_sequence": self.enable_seedream_product_poster_sequence,
        }

    @classmethod
    def from_env(
        cls,
        project_root: Path | None = None,
        *,
        dotenv_path: Path | None = None,
        environment: Mapping[str, str] | None = None,
    ) -> "Settings":
        root = (project_root or PROJECT_ROOT).resolve()
        selected_dotenv = (dotenv_path or (root / ".env")).resolve()
        dotenv = _read_dotenv(selected_dotenv)
        source = os.environ if environment is None else environment

        def value(name: str, default: str = "") -> str:
            return _source_value(name, source, dotenv, default)

        max_image_pixels = _positive_int(
            value("AD_MAX_IMAGE_PIXELS"), 40_000_000
        )
        endpoint = value(
            "SEEDREAM_API_ENDPOINT", OFFICIAL_SEEDREAM_API_ENDPOINT
        )
        if endpoint != OFFICIAL_SEEDREAM_API_ENDPOINT:
            raise ConfigurationError("SEEDREAM_API_ENDPOINT is not allowlisted.")

        # Credential precedence is source-aware: OS always wins over dotenv, and
        # ARK_API_KEY is canonical within each source.
        seedream_api_key = _first_available(
            source.get("ARK_API_KEY"),
            source.get("SEEDREAM_API_KEY"),
            dotenv.get("ARK_API_KEY"),
            dotenv.get("SEEDREAM_API_KEY"),
        )

        artifact_value = value("AD_ARTIFACT_ROOT")
        artifact_root = (
            Path(artifact_value).expanduser() if artifact_value else root / "artifacts"
        )
        if not artifact_root.is_absolute():
            artifact_root = root / artifact_root
        cors_raw = value("AD_API_CORS_ORIGINS")
        cors = [item.strip() for item in cors_raw.split(",") if item.strip()]

        # The sequence gate supersedes the deprecated group gate. The old name is
        # consulted only when the new name has no non-empty value in either source.
        explicit_sequence_gate_raw = _first_available(
            source.get("ENABLE_SEEDREAM_PRODUCT_POSTER_SEQUENCE"),
            dotenv.get("ENABLE_SEEDREAM_PRODUCT_POSTER_SEQUENCE"),
        )
        sequence_gate_raw = (
            explicit_sequence_gate_raw
            or value("ENABLE_SEEDREAM_PRODUCT_POSTER_GROUP")
        )
        legacy_group_enabled = (
            False
            if explicit_sequence_gate_raw
            else _boolean(
                value("ENABLE_SEEDREAM_PRODUCT_POSTER_GROUP"),
                False,
                "ENABLE_SEEDREAM_PRODUCT_POSTER_GROUP",
            )
        )

        return cls(
            project_root=root,
            artifact_root=artifact_root.resolve(),
            max_upload_bytes=_positive_int(
                value("AD_MAX_UPLOAD_BYTES"), 10 * 1024 * 1024
            ),
            max_image_pixels=max_image_pixels,
            max_provider_image_bytes=_positive_int(
                value("AD_MAX_PROVIDER_IMAGE_BYTES"), 25 * 1024 * 1024
            ),
            seedream_api_key=seedream_api_key,
            seedream_model_id=value(
                "SEEDREAM_MODEL_ID", DEFAULT_SEEDREAM_MODEL_ID
            ),
            seedream_api_endpoint=endpoint,
            seedream_image_size=validate_seedream_image_size(
                value("SEEDREAM_IMAGE_SIZE", DEFAULT_SEEDREAM_IMAGE_SIZE),
                max_pixels=max_image_pixels,
            ),
            seedream_watermark=_boolean(
                value("SEEDREAM_WATERMARK"),
                DEFAULT_SEEDREAM_WATERMARK,
                "SEEDREAM_WATERMARK",
            ),
            seedream_timeout_seconds=_positive_float(
                value("SEEDREAM_TIMEOUT_SECONDS"), 120.0
            ),
            enable_seedream_product_poster_group=legacy_group_enabled,
            enable_seedream_product_poster_sequence=_boolean(
                sequence_gate_raw,
                False,
                "ENABLE_SEEDREAM_PRODUCT_POSTER_SEQUENCE",
            ),
            deepseek_api_key=_first_available(
                source.get("DEEPSEEK_API_KEY"),
                source.get("OPENAI_API_KEY"),
                dotenv.get("DEEPSEEK_API_KEY"),
                dotenv.get("OPENAI_API_KEY"),
            ),
            deepseek_api_base=value("OPENAI_API_BASE", "https://api.deepseek.com").rstrip(
                "/"
            ),
            chat_model=value("CHAT_MODEL", "deepseek-chat"),
            cors_origins=cors or list(DEFAULT_CORS_ORIGINS),
            require_edge_proxy=_boolean(
                value("AD_REQUIRE_EDGE_PROXY"),
                False,
                "AD_REQUIRE_EDGE_PROXY",
            ),
            edge_proxy_token=_exact_source_value(
                "AD_EDGE_PROXY_TOKEN", source, dotenv
            ),
        )
