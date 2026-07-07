"""Monthly tyre-spend forecasting with Holt's linear trend + 95% band.

With fewer than MIN_MODEL_POINTS observed months the forecast degrades to a
clearly-flagged mean heuristic instead of erroring.
"""

from dataclasses import dataclass
from statistics import fmean, pstdev
from typing import Sequence

from analytics.core.stats import MIN_MODEL_POINTS, Z_95, add_months, holt_linear_forecast, month_range
from analytics.core.types import MonthlyValue

METHOD_HOLT = "holt_linear"
METHOD_MEAN = "mean_heuristic"


@dataclass(frozen=True, slots=True)
class ForecastPoint:
    month: str
    expected: float
    lower: float
    upper: float


@dataclass(frozen=True, slots=True)
class CostForecastResult:
    history: list[MonthlyValue]
    forecast: list[ForecastPoint]
    method: str
    residual_std: float | None
    notes: tuple[str, ...] = ()


def _fill_month_gaps(history: Sequence[MonthlyValue]) -> list[MonthlyValue]:
    """Dense monthly series; months without spend count as zero spend."""
    by_month = {h.month: h.value for h in history}
    months = sorted(by_month)
    return [MonthlyValue(m, by_month.get(m, 0.0)) for m in month_range(months[0], months[-1])]


def forecast_monthly_cost(
    history: Sequence[MonthlyValue],
    months_ahead: int,
) -> CostForecastResult:
    """Forecast tyre spend months_ahead months past the last observed month."""
    if months_ahead < 1:
        raise ValueError("months_ahead must be >= 1")
    if not history:
        return CostForecastResult(
            history=[],
            forecast=[],
            method=METHOD_MEAN,
            residual_std=None,
            notes=("no historical spend found for the given filters",),
        )

    dense = _fill_month_gaps(history)
    last_month = dense[-1].month
    future_months = [add_months(last_month, h) for h in range(1, months_ahead + 1)]

    if len(dense) >= MIN_MODEL_POINTS:
        holt = holt_linear_forecast([m.value for m in dense], months_ahead)
        points = [
            ForecastPoint(
                month=month,
                expected=round(max(0.0, holt.forecast[h - 1]), 2),
                lower=round(max(0.0, holt.forecast[h - 1] - holt.band(h)), 2),
                upper=round(max(0.0, holt.forecast[h - 1] + holt.band(h)), 2),
            )
            for h, month in enumerate(future_months, start=1)
        ]
        return CostForecastResult(
            history=dense,
            forecast=points,
            method=METHOD_HOLT,
            residual_std=round(holt.residual_std, 2),
        )

    # Heuristic: flat mean with a dispersion-based band, clearly flagged.
    values = [m.value for m in dense]
    expected = fmean(values)
    spread = pstdev(values) if len(values) > 1 else expected * 0.5
    half_band = Z_95 * spread
    points = [
        ForecastPoint(
            month=month,
            expected=round(max(0.0, expected), 2),
            lower=round(max(0.0, expected - half_band), 2),
            upper=round(max(0.0, expected + half_band), 2),
        )
        for month in future_months
    ]
    return CostForecastResult(
        history=dense,
        forecast=points,
        method=METHOD_MEAN,
        residual_std=None,
        notes=(
            f"only {len(dense)} month(s) of history; "
            f"{MIN_MODEL_POINTS} needed for trend modelling - returning mean estimate",
        ),
    )
