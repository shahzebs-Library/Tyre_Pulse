"""Reusable statistical primitives: linear fit, Holt's trend, z-scores, IQR.

Mirrors the frontend math in src/lib/analyticsEngine.js (linearRegression,
forecastMonthly) so both stacks agree on results.
"""

from dataclasses import dataclass
from itertools import product
from math import sqrt
from typing import Sequence

import numpy as np
from sklearn.linear_model import LinearRegression

#: Minimum observations required to fit a statistical model. Below this,
#: callers must fall back to a clearly-flagged heuristic (never an error).
MIN_MODEL_POINTS = 5

#: 95% two-sided normal quantile, used for confidence bands.
Z_95 = 1.959964


@dataclass(frozen=True, slots=True)
class LinearFit:
    slope: float
    intercept: float
    r_squared: float

    def predict(self, x: float) -> float:
        return self.slope * x + self.intercept


def fit_linear(x: Sequence[float], y: Sequence[float]) -> LinearFit:
    """Ordinary least squares y = slope*x + intercept via scikit-learn."""
    if len(x) != len(y) or len(x) < 2:
        raise ValueError("fit_linear requires two equal-length series of >= 2 points")
    xs = np.asarray(x, dtype=np.float64).reshape(-1, 1)
    ys = np.asarray(y, dtype=np.float64)
    model = LinearRegression()
    model.fit(xs, ys)
    ss_tot = float(np.sum((ys - ys.mean()) ** 2))
    r2 = 1.0 if ss_tot == 0.0 else max(0.0, float(model.score(xs, ys)))
    return LinearFit(slope=float(model.coef_[0]), intercept=float(model.intercept_), r_squared=r2)


def z_scores(values: Sequence[float]) -> list[float]:
    """Standard scores; all zeros when the sample deviation is zero."""
    arr = np.asarray(values, dtype=np.float64)
    if arr.size < 2:
        return [0.0] * arr.size
    sd = float(arr.std(ddof=1))
    if sd == 0.0:
        return [0.0] * arr.size
    mean = float(arr.mean())
    return [float((v - mean) / sd) for v in arr]


def iqr_bounds(values: Sequence[float], k: float = 1.5) -> tuple[float, float]:
    """Tukey fences: (Q1 - k*IQR, Q3 + k*IQR)."""
    arr = np.asarray(values, dtype=np.float64)
    if arr.size == 0:
        raise ValueError("iqr_bounds requires a non-empty sample")
    q1, q3 = np.percentile(arr, [25, 75])
    iqr = float(q3 - q1)
    return float(q1) - k * iqr, float(q3) + k * iqr


@dataclass(frozen=True, slots=True)
class HoltForecast:
    """Holt's linear (double exponential smoothing) fit + h-step forecast."""

    forecast: list[float]
    residual_std: float
    alpha: float
    beta: float

    def band(self, step: int) -> float:
        """Half-width of the 95% band at forecast step (1-based)."""
        return Z_95 * self.residual_std * sqrt(step)


def _holt_sse(series: np.ndarray, alpha: float, beta: float) -> tuple[float, float, float]:
    """One Holt pass. Returns (sse, final_level, final_trend)."""
    level = float(series[0])
    trend = float(series[1] - series[0])
    sse = 0.0
    for t in range(1, series.size):
        predicted = level + trend
        error = float(series[t]) - predicted
        sse += error * error
        new_level = alpha * float(series[t]) + (1 - alpha) * (level + trend)
        trend = beta * (new_level - level) + (1 - beta) * trend
        level = new_level
    return sse, level, trend


def holt_linear_forecast(
    series: Sequence[float],
    horizon: int,
    alpha: float | None = None,
    beta: float | None = None,
) -> HoltForecast:
    """Holt's linear trend forecast with grid-searched smoothing when
    alpha/beta are not supplied. Requires >= MIN_MODEL_POINTS observations."""
    if len(series) < MIN_MODEL_POINTS:
        raise ValueError(f"holt_linear_forecast requires >= {MIN_MODEL_POINTS} points")
    if horizon < 1:
        raise ValueError("horizon must be >= 1")

    arr = np.asarray(series, dtype=np.float64)
    grid = [0.1, 0.3, 0.5, 0.7, 0.9]
    alphas = [alpha] if alpha is not None else grid
    betas = [beta] if beta is not None else grid

    best: tuple[float, float, float, float, float] | None = None
    for a, b in product(alphas, betas):
        sse, level, trend = _holt_sse(arr, a, b)
        if best is None or sse < best[0]:
            best = (sse, a, b, level, trend)

    assert best is not None  # grid is never empty
    sse, a, b, level, trend = best
    residual_std = sqrt(sse / (arr.size - 1))
    forecast = [level + h * trend for h in range(1, horizon + 1)]
    return HoltForecast(forecast=forecast, residual_std=residual_std, alpha=a, beta=b)


def add_months(month: str, delta: int) -> str:
    """'YYYY-MM' arithmetic: add_months('2026-11', 3) == '2027-02'."""
    year, mon = int(month[:4]), int(month[5:7])
    total = year * 12 + (mon - 1) + delta
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def month_range(first: str, last: str) -> list[str]:
    """Inclusive list of consecutive 'YYYY-MM' keys from first to last."""
    if first > last:
        raise ValueError("first month must not be after last month")
    months = [first]
    while months[-1] < last:
        months.append(add_months(months[-1], 1))
    return months
