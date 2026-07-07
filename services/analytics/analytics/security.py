"""Service-to-service authentication via the x-service-key header."""

import hmac
from typing import Annotated

from fastapi import Depends, Header

from analytics.config import Settings, get_settings
from analytics.problems import ProblemError


def require_service_key(
    x_service_key: Annotated[str | None, Header()] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,  # type: ignore[assignment]
) -> None:
    """Constant-time comparison against ANALYTICS_SERVICE_KEY. 401 on mismatch."""
    expected = settings.analytics_service_key.get_secret_value().encode()
    provided = (x_service_key or "").encode()
    if not hmac.compare_digest(provided, expected):
        raise ProblemError(
            status=401,
            title="Unauthorized",
            detail="Missing or invalid x-service-key header.",
            type_="https://tyrepulse.app/problems/unauthorized",
        )
