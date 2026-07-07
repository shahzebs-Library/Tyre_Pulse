"""RFC 7807 problem+json helpers."""

from typing import Any

from fastapi.responses import JSONResponse

PROBLEM_CONTENT_TYPE = "application/problem+json"


class ProblemError(Exception):
    """Raise anywhere in a request handler to produce an RFC 7807 response."""

    def __init__(
        self,
        status: int,
        title: str,
        detail: str,
        type_: str = "about:blank",
        extras: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(detail)
        self.status = status
        self.title = title
        self.detail = detail
        self.type = type_
        self.extras = extras or {}


def problem_response(
    status: int,
    title: str,
    detail: str,
    type_: str = "about:blank",
    instance: str | None = None,
    extras: dict[str, Any] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {"type": type_, "title": title, "status": status, "detail": detail}
    if instance:
        body["instance"] = instance
    if extras:
        body.update(extras)
    return JSONResponse(status_code=status, content=body, media_type=PROBLEM_CONTENT_TYPE)
