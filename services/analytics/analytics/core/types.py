"""Typed row shapes exchanged between the DB layer and the core math.

These mirror the Supabase schema (tyre_records, inspections) but are plain
dataclasses so the core stays testable with synthetic fixtures.
"""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True, slots=True)
class TreadReading:
    """One tread-depth observation for one tyre (from inspections)."""

    tyre_key: str
    observed_at: date
    tread_depth_mm: float
    asset_no: str | None = None
    position: str | None = None
    brand: str | None = None
    site: str | None = None


@dataclass(frozen=True, slots=True)
class PressureReading:
    """One pressure observation (from inspections.pressure_reading)."""

    record_id: str
    observed_at: date
    pressure: float
    asset_no: str | None = None
    tyre_serial: str | None = None
    position: str | None = None
    site: str | None = None


@dataclass(frozen=True, slots=True)
class TyreRecordRow:
    """One tyre purchase/installation row (from tyre_records)."""

    record_id: str
    asset_no: str | None = None
    serial_no: str | None = None
    brand: str | None = None
    site: str | None = None
    position: str | None = None
    issue_date: date | None = None
    cost_per_tyre: float | None = None
    qty: int = 1
    km_at_fitment: float | None = None
    km_at_removal: float | None = None


@dataclass(frozen=True, slots=True)
class MonthlyValue:
    """Aggregated value for one calendar month ('YYYY-MM')."""

    month: str
    value: float
