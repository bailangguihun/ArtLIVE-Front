from __future__ import annotations

import logging
import secrets
import uuid
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from my_agent.backend import API_VERSION
from my_agent.backend.api.errors import APIError
from my_agent.backend.api.routes import create_router
from my_agent.backend.core.config import Settings
from my_agent.backend.core.logging_config import configure_logging, safe_log_context
from my_agent.backend.integrations.copy_client import DeepSeekCopyClient
from my_agent.backend.integrations.seedream_client import SeedreamClient
from my_agent.backend.services.generation_service import GenerationService
from my_agent.backend.services.image_generation_service import ImageGenerationService
from my_agent.backend.services.product_poster_group_service import (
    ProductPosterGroupService,
)
from my_agent.backend.services.product_poster_sequence_service import (
    ProductPosterSequenceService,
)
from my_agent.backend.storage.artifact_store import ArtifactStore

LOGGER = logging.getLogger("advertising_backend")
EDGE_PROXY_HEADER = "X-AD-Edge-Proxy-Token"


def _request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "unknown"))


def create_app(
    settings: Optional[Settings] = None,
    generation_service: Optional[GenerationService] = None,
    artifact_store: Optional[ArtifactStore] = None,
) -> FastAPI:
    configure_logging()
    active_settings = settings or Settings.from_env()
    store = artifact_store or ArtifactStore(
        active_settings.artifact_root,
        max_image_pixels=active_settings.max_image_pixels,
    )
    service = generation_service
    if service is None:
        seedream = SeedreamClient(active_settings)
        image_service = ImageGenerationService(seedream)
        service = GenerationService(
            copy_client=DeepSeekCopyClient(active_settings),
            image_service=image_service,
            artifact_store=store,
            product_poster_group_service=ProductPosterGroupService(seedream),
            enable_product_poster_group=False,
            product_poster_group_provider_verified=False,
            product_poster_sequence_service=ProductPosterSequenceService(seedream),
            enable_product_poster_sequence=(
                active_settings.enable_seedream_product_poster_sequence
            ),
            product_poster_sequence_provider_verified=False,
        )

    app = FastAPI(
        title="Advertising Poster Backend",
        version=API_VERSION,
        docs_url="/docs",
        redoc_url=None,
    )
    app.state.settings = active_settings
    app.state.artifact_store = store
    app.state.generation_service = service
    app.router.add_event_handler(
        "startup", service.reconcile_interrupted_sequence_tasks
    )

    @app.middleware("http")
    async def require_edge_proxy(request: Request, call_next):
        is_protected_api = request.url.path.startswith("/api/v1/")
        is_public_health = (
            request.method == "GET" and request.url.path == "/api/v1/health"
        )
        if (
            active_settings.edge_proxy_validation_enabled
            and is_protected_api
            and not is_public_health
        ):
            supplied_values = request.headers.getlist(EDGE_PROXY_HEADER)
            supplied = supplied_values[0] if len(supplied_values) == 1 else ""
            matches = secrets.compare_digest(
                supplied.encode("utf-8"),
                active_settings.edge_proxy_token.encode("ascii"),
            )
            if len(supplied_values) != 1 or not matches:
                return JSONResponse(
                    status_code=403,
                    content={
                        "error": {
                            "code": "forbidden",
                            "message": "请求未获授权。",
                            "request_id": _request_id(request),
                        }
                    },
                )
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=active_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Idempotency-Key"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = str(uuid.uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.exception_handler(APIError)
    async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "request_id": _request_id(request),
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        _ = exc
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "invalid_request",
                    "message": "请求格式无效。",
                    "request_id": _request_id(request),
                }
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        LOGGER.error(
            safe_log_context(_request_id(request), "unhandled_error", category=type(exc).__name__)
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "服务暂时无法完成请求。",
                    "request_id": _request_id(request),
                }
            },
        )

    app.include_router(create_router(service, store, active_settings))
    return app


app = create_app()
