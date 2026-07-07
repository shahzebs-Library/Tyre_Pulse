"""Procurement demand forecast: projected tyre replacements per month.

Blends two signals:
- model units: tyres whose predicted removal date (from tyre-life regression)
  falls inside the month;
- baseline units: historical average monthly replacements, applied to the
  share of the fleet that could not be modelled (no inspection history).

blended = model_units + baseline * (1 - modelled_coverage), so a fleet with
full inspection coverage relies on the model and a fleet with none falls back
to its historical run rate - and the method is flagged accordingly.
"""

from dataclasses import dataclass
from datetime import date
from statistics import fmean
from typing import Sequence

from analytics.core.stats import MIN_MODEL_POINTS, add_months
from analytics.core.types import MonthlyValue
from analytics.core.tyre_life import TyreLifePrediction

METHOD_MODEL_BLEND = "model_baseline_blend"
METHOD_BASELINE = "baseline_run_rate"
METHOD_INSUFFICIENT = "insufficient_data"

#: Baseline uses at most this many trailing months of replacement history.
BASELINE_WINDOW_MONTHS = 12


@dataclass(frozen=True, slots=True)
class DemandPoint:
    month: str
    model_units: int
    baseline_units: float
    projected_units: int
    estimated_cost: float | None


@dataclass(frozen=True, slots=True)
class DemandForecastResult:
    forecast: list[DemandPoint]
    method: str
    modelled_coverage: float
    baseline_monthly_units: float | None
    avg_unit_cost: float | None
    notes: tuple[str, ...] = ()


def forecast_demand(
    predictions: Sequence[TyreLifePrediction],
    monthly_replacements: Sequence[MonthlyValue],
    *,
    months_ahead: int,
    fleet_tyre_count: int | None = None,
    avg_unit_cost: float | None = None,
    as_of: date | None = None,
) -> DemandForecastResult:
    """Project replacement units (and spend) per future month.

    fleet_tyre_count is the number of tyres currently in service; when omitted
    the count of predictions is used, i.e. coverage is assumed complete.
    """
    if months_ahead < 1:
        raise ValueError("months_ahead must be >= 1")
    today = as_of or date.today()
    start_month = f"{today.year:04d}-{today.month:02d}"
    future_months = [add_months(start_month, h) for h in range(1, months_ahead + 1)]

    trailing = sorted(monthly_replacements, key=lambda m: m.month)[-BASELINE_WINDOW_MONTHS:]
    baseline = fmean([m.value for m in trailing]) if trailing else None

    total_fleet = max(fleet_tyre_count or len(predictions), len(predictions))
    coverage = (len(predictions) / total_fleet) if total_fleet > 0 else 0.0

    notes: list[str] = []
    if not predictions and baseline is None:
        return DemandForecastResult(
            forecast=[],
            method=METHOD_INSUFFICIENT,
            modelled_coverage=0.0,
            baseline_monthly_units=None,
            avg_unit_cost=avg_unit_cost,
            notes=("no tyre-life predictions and no replacement history available",),
        )

    if trailing and len(trailing) < MIN_MODEL_POINTS:
        notes.append(
            f"baseline run rate computed from only {len(trailing)} month(s) of history"
        )
    if not predictions:
        notes.append("no per-tyre predictions; forecast is the historical run rate only")

    removals_by_month: dict[str, int] = {}
    for p in predictions:
        key = f"{p.predicted_removal_date.year:04d}-{p.predicted_removal_date.month:02d}"
        removals_by_month[key] = removals_by_month.get(key, 0) + 1

    unmodelled_share = max(0.0, 1.0 - coverage)
    points: list[DemandPoint] = []
    for month in future_months:
        model_units = removals_by_month.get(month, 0)
        baseline_units = (baseline or 0.0) * unmodelled_share
        projected = model_units + baseline_units
        projected_units = int(round(projected))
        points.append(
            DemandPoint(
                month=month,
                model_units=model_units,
                baseline_units=round(baseline_units, 2),
                projected_units=projected_units,
                estimated_cost=(
                    round(projected_units * avg_unit_cost, 2)
                    if avg_unit_cost is not None
                    else None
                ),
            )
        )

    overdue = sum(
        1
        for p in predictions
        if f"{p.predicted_removal_date.year:04d}-{p.predicted_removal_date.month:02d}"
        <= start_month
    )
    if overdue:
        notes.append(
            f"{overdue} tyre(s) already at/past removal threshold - immediate replacements "
            "not included in the monthly buckets"
        )

    return DemandForecastResult(
        forecast=points,
        method=METHOD_MODEL_BLEND if predictions else METHOD_BASELINE,
        modelled_coverage=round(coverage, 4),
        baseline_monthly_units=round(baseline, 2) if baseline is not None else None,
        avg_unit_cost=round(avg_unit_cost, 2) if avg_unit_cost is not None else None,
        notes=tuple(notes),
    )
