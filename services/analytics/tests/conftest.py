"""Shared fixtures. Environment is set before any analytics import so the
settings cache resolves against test values - no live database is needed."""

import os

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("ANALYTICS_SERVICE_KEY", "test-service-key-0123456789")
os.environ.setdefault("ALLOWED_ORIGINS", "")
os.environ.setdefault("LOG_LEVEL", "WARNING")

from datetime import date, timedelta
from uuid import UUID

import pytest

from analytics.core.types import MonthlyValue, PressureReading, TreadReading, TyreRecordRow

TEST_ORG = UUID("00000000-0000-4000-8000-000000000001")
SERVICE_KEY = os.environ["ANALYTICS_SERVICE_KEY"]


def make_tread_series(
    tyre_key: str,
    *,
    start_tread: float = 14.0,
    wear_per_week: float = 0.35,
    weeks: int = 10,
    start: date = date(2026, 1, 5),
    asset_no: str = "TRK-001",
    position: str | None = "Drive-1",
    brand: str | None = "Michelin",
    site: str | None = "Riyadh",
) -> list[TreadReading]:
    """Perfectly linear synthetic wear history (weekly inspections)."""
    return [
        TreadReading(
            tyre_key=tyre_key,
            observed_at=start + timedelta(weeks=w),
            tread_depth_mm=start_tread - wear_per_week * w,
            asset_no=asset_no,
            position=position,
            brand=brand,
            site=site,
        )
        for w in range(weeks)
    ]


def make_tyre_row(
    record_id: str,
    *,
    asset_no: str = "TRK-001",
    serial_no: str | None = None,
    cost: float | None = 1200.0,
    issue: date | None = date(2026, 3, 1),
    brand: str = "Michelin",
    site: str = "Riyadh",
) -> TyreRecordRow:
    return TyreRecordRow(
        record_id=record_id,
        asset_no=asset_no,
        serial_no=serial_no,
        brand=brand,
        site=site,
        position="Drive-1",
        issue_date=issue,
        cost_per_tyre=cost,
        qty=1,
    )


def make_pressure(
    record_id: str, pressure: float, *, asset_no: str = "TRK-001"
) -> PressureReading:
    return PressureReading(
        record_id=record_id,
        observed_at=date(2026, 5, 1),
        pressure=pressure,
        asset_no=asset_no,
        site="Riyadh",
    )


@pytest.fixture
def trending_monthly_costs() -> list[MonthlyValue]:
    """12 months of upward-trending spend: 10k + 500/month."""
    return [
        MonthlyValue(month=f"2025-{m:02d}", value=10_000.0 + 500.0 * (m - 1))
        for m in range(1, 13)
    ]
