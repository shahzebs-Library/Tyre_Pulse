"""API endpoints: health probe + authenticated v1 analytics routes."""

import logging
from dataclasses import asdict

from fastapi import APIRouter, Depends, Request

from analytics import __version__
from analytics.api.deps import Repository
from analytics.core.anomalies import TreadMeta, detect_anomalies
from analytics.core.cost_forecast import forecast_monthly_cost
from analytics.core.demand import forecast_demand
from analytics.core.stats import MIN_MODEL_POINTS, fit_linear
from analytics.core.tyre_life import predict_tyre_life
from analytics.core.types import TreadReading
from analytics.schemas import (
    AnomalyDetectRequest,
    AnomalyDetectResponse,
    CostForecastRequest,
    CostForecastResponse,
    DemandForecastRequest,
    DemandForecastResponse,
    HealthResponse,
    TyreLifeRequest,
    TyreLifeResponse,
)
from analytics.security import require_service_key

logger = logging.getLogger(__name__)

health_router = APIRouter()
v1_router = APIRouter(prefix="/v1", dependencies=[Depends(require_service_key)])


@health_router.get("/health", response_model=HealthResponse, tags=["health"])
async def health(request: Request) -> HealthResponse:
    """Liveness + DB reachability. Unauthenticated so platform probes work."""
    repo = getattr(request.app.state, "repository", None)
    db_status = "unavailable"
    if repo is not None:
        try:
            if await repo.ping():
                db_status = "ok"
        except Exception:  # noqa: BLE001 - a failing probe must never 500
            logger.warning("health check database ping failed", exc_info=True)
    status = "ok" if db_status == "ok" else "degraded"
    return HealthResponse(status=status, version=__version__, database=db_status)


@v1_router.post("/predict/tyre-life", response_model=TyreLifeResponse, tags=["predictions"])
async def predict_tyre_life_endpoint(
    body: TyreLifeRequest, repo: Repository
) -> TyreLifeResponse:
    """Per-tyre remaining life (km/days) via linear regression over tread history."""
    readings = await repo.fetch_tread_history(
        body.organisation_id,
        site=body.site,
        brand=body.brand,
        position=body.position,
        lookback_days=body.lookback_days,
    )
    result = predict_tyre_life(
        readings,
        removal_threshold_mm=body.removal_threshold_mm,
        avg_daily_km=body.avg_daily_km,
    )
    return TyreLifeResponse(
        organisation_id=body.organisation_id,
        predictions=[
            {**asdict(p), "notes": list(p.notes)} for p in result.predictions
        ],
        fleet=asdict(result.fleet),
    )


@v1_router.post("/forecast/cost", response_model=CostForecastResponse, tags=["forecasts"])
async def forecast_cost_endpoint(
    body: CostForecastRequest, repo: Repository
) -> CostForecastResponse:
    """Monthly tyre-spend forecast with a 95% confidence band."""
    history = await repo.fetch_monthly_costs(
        body.organisation_id, site=body.site, brand=body.brand
    )
    result = forecast_monthly_cost(history, body.months_ahead)
    return CostForecastResponse(
        organisation_id=body.organisation_id,
        history=[asdict(m) for m in result.history],
        forecast=[asdict(p) for p in result.forecast],
        method=result.method,
        residual_std=result.residual_std,
        notes=list(result.notes),
    )


def _wear_rates_from_readings(
    readings: list[TreadReading],
) -> tuple[dict[str, float], dict[str, TreadMeta]]:
    """Fit per-tyre wear rates (mm/day) for tyres with enough history."""
    by_tyre: dict[str, list[TreadReading]] = {}
    for r in readings:
        by_tyre.setdefault(r.tyre_key, []).append(r)

    rates: dict[str, float] = {}
    meta: dict[str, TreadMeta] = {}
    for key, tyre_readings in by_tyre.items():
        distinct_days = sorted({r.observed_at for r in tyre_readings})
        if len(distinct_days) < MIN_MODEL_POINTS:
            continue
        ordered = sorted(tyre_readings, key=lambda r: r.observed_at)
        origin = ordered[0].observed_at
        xs = [float((r.observed_at - origin).days) for r in ordered]
        ys = [r.tread_depth_mm for r in ordered]
        rates[key] = -fit_linear(xs, ys).slope
        meta[key] = TreadMeta(asset_no=ordered[-1].asset_no, site=ordered[-1].site)
    return rates, meta


@v1_router.post("/detect/anomalies", response_model=AnomalyDetectResponse, tags=["anomalies"])
async def detect_anomalies_endpoint(
    body: AnomalyDetectRequest, repo: Repository
) -> AnomalyDetectResponse:
    """Wear-rate, pressure, cost and duplicate-serial anomalies with severity."""
    tyre_rows = await repo.fetch_tyre_rows(
        body.organisation_id,
        site=body.site,
        brand=body.brand,
        position=body.position,
        lookback_days=body.lookback_days,
    )
    pressures = await repo.fetch_pressure_readings(
        body.organisation_id, site=body.site, lookback_days=body.lookback_days
    )
    readings = await repo.fetch_tread_history(
        body.organisation_id,
        site=body.site,
        brand=body.brand,
        position=body.position,
        lookback_days=body.lookback_days,
    )
    wear_rates, meta = _wear_rates_from_readings(readings)

    anomalies, summary = detect_anomalies(
        tyre_rows,
        pressures,
        wear_rates,
        meta,
        z_warn=body.z_warn,
        z_high=body.z_high,
        iqr_k=body.iqr_multiplier,
    )
    return AnomalyDetectResponse(
        organisation_id=body.organisation_id,
        anomalies=[
            {
                "type": a.type.value,
                "severity": a.severity.value,
                "message": a.message,
                "asset_no": a.asset_no,
                "serial_no": a.serial_no,
                "site": a.site,
                "record_ids": list(a.record_ids),
                "metrics": dict(a.metrics),
            }
            for a in anomalies
        ],
        summary={
            "total": summary.total,
            "by_severity": dict(summary.by_severity),
            "by_type": dict(summary.by_type),
        },
    )


@v1_router.post("/forecast/demand", response_model=DemandForecastResponse, tags=["forecasts"])
async def forecast_demand_endpoint(
    body: DemandForecastRequest, repo: Repository
) -> DemandForecastResponse:
    """Projected tyre replacements per month for procurement planning."""
    readings = await repo.fetch_tread_history(
        body.organisation_id,
        site=body.site,
        brand=body.brand,
        position=body.position,
        lookback_days=body.lookback_days,
    )
    life = predict_tyre_life(
        readings,
        removal_threshold_mm=body.removal_threshold_mm,
        avg_daily_km=body.avg_daily_km,
    )
    monthly_units = await repo.fetch_monthly_replacement_units(
        body.organisation_id, site=body.site, brand=body.brand
    )
    fleet_count = await repo.fetch_active_tyre_count(
        body.organisation_id, site=body.site, brand=body.brand
    )
    avg_cost = await repo.fetch_avg_tyre_cost(
        body.organisation_id, site=body.site, brand=body.brand
    )
    result = forecast_demand(
        life.predictions,
        monthly_units,
        months_ahead=body.months_ahead,
        fleet_tyre_count=fleet_count,
        avg_unit_cost=avg_cost,
    )
    return DemandForecastResponse(
        organisation_id=body.organisation_id,
        forecast=[asdict(p) for p in result.forecast],
        method=result.method,
        modelled_coverage=result.modelled_coverage,
        baseline_monthly_units=result.baseline_monthly_units,
        avg_unit_cost=result.avg_unit_cost,
        notes=list(result.notes),
    )
