"""Application factory: middleware, error handling, lifecycle."""

import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator, Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from analytics import __version__
from analytics.api.routes import health_router, v1_router
from analytics.config import get_settings
from analytics.db.pool import close_pool, create_pool
from analytics.db.repository import PostgresAnalyticsRepository
from analytics.logging_setup import configure_logging
from analytics.problems import ProblemError, problem_response

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level, settings.service_name)
    app.state.pool = None
    app.state.repository = None
    try:
        app.state.pool = await create_pool(settings)
        app.state.repository = PostgresAnalyticsRepository(app.state.pool, settings.max_rows)
    except Exception:  # noqa: BLE001 - start degraded; /health reports it
        logger.error("failed to create database pool at startup", exc_info=True)
    yield
    if app.state.pool is not None:
        await close_pool(app.state.pool)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Tyre Pulse Analytics",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST"],
            allow_headers=["content-type", "x-service-key", "x-request-id"],
            max_age=600,
        )

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """Request id propagation + timing + structured access log."""
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:  # noqa: BLE001 - last-resort guard; details stay server-side
            logger.error(
                "unhandled exception",
                exc_info=True,
                extra={"request_id": request_id, "path": request.url.path},
            )
            response = problem_response(
                status=500,
                title="Internal Server Error",
                detail="An unexpected error occurred. The incident has been logged.",
                type_="https://tyrepulse.app/problems/internal-error",
                instance=request.url.path,
            )
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        response.headers["x-request-id"] = request_id
        response.headers["x-response-time-ms"] = str(elapsed_ms)
        logger.info(
            "request completed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": elapsed_ms,
            },
        )
        return response

    @app.exception_handler(ProblemError)
    async def problem_error_handler(request: Request, exc: ProblemError) -> Response:
        return problem_response(
            status=exc.status,
            title=exc.title,
            detail=exc.detail,
            type_=exc.type,
            instance=request.url.path,
            extras=exc.extras,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> Response:
        errors = [
            {"loc": ".".join(str(part) for part in e["loc"]), "message": e["msg"]}
            for e in exc.errors()
        ]
        return problem_response(
            status=422,
            title="Validation Error",
            detail="Request body failed validation.",
            type_="https://tyrepulse.app/problems/validation-error",
            instance=request.url.path,
            extras={"errors": errors},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> Response:
        return problem_response(
            status=exc.status_code,
            title=exc.detail if isinstance(exc.detail, str) else "HTTP Error",
            detail=exc.detail if isinstance(exc.detail, str) else "Request failed.",
            instance=request.url.path,
        )

    app.include_router(health_router)
    app.include_router(v1_router)
    return app


app = create_app()
