"""Pydantic v2 request/response contracts for the public API."""

from datetime import date
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

FilterStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]


class OrgScopedRequest(BaseModel):
    """Base for every analytics request: organisation_id is mandatory and
    every DB query is filtered by it (multi-tenant isolation)."""

    model_config = ConfigDict(extra="forbid")

    organisation_id: UUID
    site: FilterStr | None = None
    brand: FilterStr | None = None


# ── Requests ────────────────────────────────────────────────────────────────


class TyreLifeRequest(OrgScopedRequest):
    position: FilterStr | None = None
    removal_threshold_mm: float = Field(default=3.0, ge=0.5, le=10.0)
    avg_daily_km: float = Field(default=200.0, gt=0, le=2000.0)
    lookback_days: int = Field(default=365, ge=30, le=1825)


class CostForecastRequest(OrgScopedRequest):
    months_ahead: int = Field(default=6, ge=1, le=24)


class AnomalyDetectRequest(OrgScopedRequest):
    position: FilterStr | None = None
    lookback_days: int = Field(default=365, ge=30, le=1825)
    z_warn: float = Field(default=2.0, ge=1.5, le=5.0)
    z_high: float = Field(default=3.0, ge=2.0, le=6.0)
    iqr_multiplier: float = Field(default=1.5, ge=1.0, le=3.0)


class DemandForecastRequest(OrgScopedRequest):
    position: FilterStr | None = None
    months_ahead: int = Field(default=6, ge=1, le=24)
    removal_threshold_mm: float = Field(default=3.0, ge=0.5, le=10.0)
    avg_daily_km: float = Field(default=200.0, gt=0, le=2000.0)
    lookback_days: int = Field(default=365, ge=30, le=1825)


# ── Responses ───────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str
    version: str
    database: str


class TyreLifePredictionModel(BaseModel):
    tyre_key: str
    asset_no: str | None
    position: str | None
    brand: str | None
    site: str | None
    current_tread_mm: float
    wear_rate_mm_per_day: float
    remaining_days: int
    remaining_km: float
    predicted_removal_date: date
    readings_used: int
    method: str
    confidence: str
    r_squared: float | None
    notes: list[str]


class FleetAggregateModel(BaseModel):
    tyre_count: int
    modelled_count: int
    heuristic_count: int
    median_wear_rate_mm_per_day: float | None
    avg_remaining_days: float | None
    due_within_30_days: int
    due_within_60_days: int
    due_within_90_days: int


class TyreLifeResponse(BaseModel):
    organisation_id: UUID
    predictions: list[TyreLifePredictionModel]
    fleet: FleetAggregateModel


class MonthlyValueModel(BaseModel):
    month: str
    value: float


class ForecastPointModel(BaseModel):
    month: str
    expected: float
    lower: float
    upper: float


class CostForecastResponse(BaseModel):
    organisation_id: UUID
    history: list[MonthlyValueModel]
    forecast: list[ForecastPointModel]
    method: str
    residual_std: float | None
    notes: list[str]


class AnomalyModel(BaseModel):
    type: str
    severity: str
    message: str
    asset_no: str | None
    serial_no: str | None
    site: str | None
    record_ids: list[str]
    metrics: dict[str, float]


class AnomalySummaryModel(BaseModel):
    total: int
    by_severity: dict[str, int]
    by_type: dict[str, int]


class AnomalyDetectResponse(BaseModel):
    organisation_id: UUID
    anomalies: list[AnomalyModel]
    summary: AnomalySummaryModel


class DemandPointModel(BaseModel):
    month: str
    model_units: int
    baseline_units: float
    projected_units: int
    estimated_cost: float | None


class DemandForecastResponse(BaseModel):
    organisation_id: UUID
    forecast: list[DemandPointModel]
    method: str
    modelled_coverage: float
    baseline_monthly_units: float | None
    avg_unit_cost: float | None
    notes: list[str]
