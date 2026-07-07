"""Org-scoped loaders over Supabase Postgres.

Every query filters by organisation_id as its first parameter - multi-tenant
isolation is enforced here in addition to the API contract. Loaders return
the plain dataclasses from analytics.core.types so the math layer never sees
asyncpg records.
"""

from datetime import date, datetime, timedelta
from typing import Any, Protocol
from uuid import UUID

import asyncpg

from analytics.core.types import MonthlyValue, PressureReading, TreadReading, TyreRecordRow


class AnalyticsRepository(Protocol):
    """Contract the API layer depends on; tests substitute an in-memory fake."""

    async def ping(self) -> bool: ...

    async def fetch_tread_history(
        self,
        organisation_id: UUID,
        *,
        site: str | None,
        brand: str | None,
        position: str | None,
        lookback_days: int,
    ) -> list[TreadReading]: ...

    async def fetch_monthly_costs(
        self, organisation_id: UUID, *, site: str | None, brand: str | None
    ) -> list[MonthlyValue]: ...

    async def fetch_monthly_replacement_units(
        self, organisation_id: UUID, *, site: str | None, brand: str | None
    ) -> list[MonthlyValue]: ...

    async def fetch_tyre_rows(
        self,
        organisation_id: UUID,
        *,
        site: str | None,
        brand: str | None,
        position: str | None,
        lookback_days: int,
    ) -> list[TyreRecordRow]: ...

    async def fetch_pressure_readings(
        self, organisation_id: UUID, *, site: str | None, lookback_days: int
    ) -> list[PressureReading]: ...

    async def fetch_active_tyre_count(
        self, organisation_id: UUID, *, site: str | None, brand: str | None
    ) -> int: ...

    async def fetch_avg_tyre_cost(
        self, organisation_id: UUID, *, site: str | None, brand: str | None
    ) -> float | None: ...


def _as_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raise TypeError(f"expected date/datetime, got {type(value).__name__}")


class PostgresAnalyticsRepository:
    """asyncpg implementation of AnalyticsRepository."""

    def __init__(self, pool: asyncpg.Pool, max_rows: int) -> None:
        self._pool = pool
        self._max_rows = max_rows

    async def ping(self) -> bool:
        row = await self._pool.fetchval("SELECT 1")
        return row == 1

    async def fetch_tread_history(
        self,
        organisation_id: UUID,
        *,
        site: str | None,
        brand: str | None,
        position: str | None,
        lookback_days: int,
    ) -> list[TreadReading]:
        since = date.today() - timedelta(days=lookback_days)
        rows = await self._pool.fetch(
            """
            SELECT
              COALESCE(NULLIF(TRIM(i.tyre_serial), ''),
                       i.asset_no || '::' || COALESCE(i.position, '?')) AS tyre_key,
              i.asset_no, i.position, i.site,
              i.created_at::date AS observed_at,
              i.tread_depth::float8 AS tread_depth_mm,
              b.brand
            FROM public.inspections i
            LEFT JOIN LATERAL (
              SELECT tr.brand
              FROM public.tyre_records tr
              WHERE tr.organisation_id = i.organisation_id
                AND tr.serial_no = i.tyre_serial
                AND tr.brand IS NOT NULL
              ORDER BY tr.issue_date DESC NULLS LAST
              LIMIT 1
            ) b ON TRUE
            WHERE i.organisation_id = $1
              AND i.tread_depth IS NOT NULL
              AND i.asset_no IS NOT NULL
              AND i.created_at >= $2
              AND ($3::text IS NULL OR i.site = $3)
              AND ($4::text IS NULL OR b.brand = $4)
              AND ($5::text IS NULL OR i.position = $5)
            ORDER BY tyre_key, observed_at
            LIMIT $6
            """,
            organisation_id,
            since,
            site,
            brand,
            position,
            self._max_rows,
        )
        return [
            TreadReading(
                tyre_key=r["tyre_key"],
                observed_at=_as_date(r["observed_at"]),
                tread_depth_mm=float(r["tread_depth_mm"]),
                asset_no=r["asset_no"],
                position=r["position"],
                brand=r["brand"],
                site=r["site"],
            )
            for r in rows
        ]

    async def fetch_monthly_costs(
        self, organisation_id: UUID, *, site: str | None, brand: str | None
    ) -> list[MonthlyValue]:
        rows = await self._pool.fetch(
            """
            SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS month,
                   SUM(COALESCE(cost_per_tyre, 0) * COALESCE(qty, 1))::float8 AS total
            FROM public.tyre_records
            WHERE organisation_id = $1
              AND issue_date IS NOT NULL
              AND ($2::text IS NULL OR site = $2)
              AND ($3::text IS NULL OR brand = $3)
            GROUP BY 1
            ORDER BY 1
            LIMIT $4
            """,
            organisation_id,
            site,
            brand,
            self._max_rows,
        )
        return [MonthlyValue(month=r["month"], value=float(r["total"])) for r in rows]

    async def fetch_monthly_replacement_units(
        self, organisation_id: UUID, *, site: str | None, brand: str | None
    ) -> list[MonthlyValue]:
        rows = await self._pool.fetch(
            """
            SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS month,
                   SUM(COALESCE(qty, 1))::float8 AS units
            FROM public.tyre_records
            WHERE organisation_id = $1
              AND issue_date IS NOT NULL
              AND ($2::text IS NULL OR site = $2)
              AND ($3::text IS NULL OR brand = $3)
            GROUP BY 1
            ORDER BY 1
            LIMIT $4
            """,
            organisation_id,
            site,
            brand,
            self._max_rows,
        )
        return [MonthlyValue(month=r["month"], value=float(r["units"])) for r in rows]

    async def fetch_tyre_rows(
        self,
        organisation_id: UUID,
        *,
        site: str | None,
        brand: str | None,
        position: str | None,
        lookback_days: int,
    ) -> list[TyreRecordRow]:
        since = date.today() - timedelta(days=lookback_days)
        rows = await self._pool.fetch(
            """
            SELECT id, asset_no, serial_no, brand, site, position, issue_date,
                   cost_per_tyre::float8 AS cost_per_tyre,
                   COALESCE(qty, 1) AS qty,
                   km_at_fitment::float8 AS km_at_fitment,
                   km_at_removal::float8 AS km_at_removal
            FROM public.tyre_records
            WHERE organisation_id = $1
              AND (issue_date IS NULL OR issue_date >= $2)
              AND ($3::text IS NULL OR site = $3)
              AND ($4::text IS NULL OR brand = $4)
              AND ($5::text IS NULL OR position = $5)
            ORDER BY issue_date NULLS LAST
            LIMIT $6
            """,
            organisation_id,
            since,
            site,
            brand,
            position,
            self._max_rows,
        )
        return [
            TyreRecordRow(
                record_id=str(r["id"]),
                asset_no=r["asset_no"],
                serial_no=r["serial_no"],
                brand=r["brand"],
                site=r["site"],
                position=r["position"],
                issue_date=r["issue_date"],
                cost_per_tyre=float(r["cost_per_tyre"]) if r["cost_per_tyre"] is not None else None,
                qty=int(r["qty"]),
                km_at_fitment=float(r["km_at_fitment"]) if r["km_at_fitment"] is not None else None,
                km_at_removal=float(r["km_at_removal"]) if r["km_at_removal"] is not None else None,
            )
            for r in rows
        ]

    async def fetch_pressure_readings(
        self, organisation_id: UUID, *, site: str | None, lookback_days: int
    ) -> list[PressureReading]:
        since = date.today() - timedelta(days=lookback_days)
        rows = await self._pool.fetch(
            """
            SELECT id, asset_no, tyre_serial, position, site,
                   created_at::date AS observed_at,
                   pressure_reading::float8 AS pressure
            FROM public.inspections
            WHERE organisation_id = $1
              AND pressure_reading IS NOT NULL
              AND created_at >= $2
              AND ($3::text IS NULL OR site = $3)
            ORDER BY created_at
            LIMIT $4
            """,
            organisation_id,
            since,
            site,
            self._max_rows,
        )
        return [
            PressureReading(
                record_id=str(r["id"]),
                observed_at=_as_date(r["observed_at"]),
                pressure=float(r["pressure"]),
                asset_no=r["asset_no"],
                tyre_serial=r["tyre_serial"],
                position=r["position"],
                site=r["site"],
            )
            for r in rows
        ]

    async def fetch_active_tyre_count(
        self, organisation_id: UUID, *, site: str | None, brand: str | None
    ) -> int:
        value = await self._pool.fetchval(
            """
            SELECT COUNT(*)
            FROM public.tyre_records
            WHERE organisation_id = $1
              AND km_at_removal IS NULL
              AND ($2::text IS NULL OR site = $2)
              AND ($3::text IS NULL OR brand = $3)
            """,
            organisation_id,
            site,
            brand,
        )
        return int(value or 0)

    async def fetch_avg_tyre_cost(
        self, organisation_id: UUID, *, site: str | None, brand: str | None
    ) -> float | None:
        value = await self._pool.fetchval(
            """
            SELECT AVG(cost_per_tyre)::float8
            FROM public.tyre_records
            WHERE organisation_id = $1
              AND cost_per_tyre > 0
              AND ($2::text IS NULL OR site = $2)
              AND ($3::text IS NULL OR brand = $3)
            """,
            organisation_id,
            site,
            brand,
        )
        return float(value) if value is not None else None
