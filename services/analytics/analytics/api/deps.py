"""Request-scoped dependencies."""

from typing import Annotated

from fastapi import Depends, Request

from analytics.db.repository import AnalyticsRepository
from analytics.problems import ProblemError


def get_repository(request: Request) -> AnalyticsRepository:
    """The repository is attached to app.state at startup (or by tests)."""
    repo: AnalyticsRepository | None = getattr(request.app.state, "repository", None)
    if repo is None:
        raise ProblemError(
            status=503,
            title="Service Unavailable",
            detail="Database connection is not available. Try again shortly.",
            type_="https://tyrepulse.app/problems/database-unavailable",
        )
    return repo


Repository = Annotated[AnalyticsRepository, Depends(get_repository)]
