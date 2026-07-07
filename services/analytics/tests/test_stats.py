"""Unit tests for the statistical primitives."""

import math

import pytest

from analytics.core.stats import (
    add_months,
    fit_linear,
    holt_linear_forecast,
    iqr_bounds,
    month_range,
    z_scores,
)


class TestFitLinear:
    def test_recovers_exact_line(self) -> None:
        xs = [0.0, 1.0, 2.0, 3.0, 4.0]
        ys = [10.0 - 0.5 * x for x in xs]
        fit = fit_linear(xs, ys)
        assert fit.slope == pytest.approx(-0.5)
        assert fit.intercept == pytest.approx(10.0)
        assert fit.r_squared == pytest.approx(1.0)
        assert fit.predict(10.0) == pytest.approx(5.0)

    def test_noisy_line_r2_below_one(self) -> None:
        xs = list(range(10))
        ys = [2.0 * x + (1.0 if x % 2 else -1.0) for x in xs]
        fit = fit_linear([float(x) for x in xs], ys)
        assert fit.slope == pytest.approx(2.0, abs=0.15)
        assert 0.9 < fit.r_squared < 1.0

    def test_constant_series_r2_is_one(self) -> None:
        fit = fit_linear([0.0, 1.0, 2.0], [5.0, 5.0, 5.0])
        assert fit.slope == pytest.approx(0.0)
        assert fit.r_squared == pytest.approx(1.0)

    def test_rejects_short_input(self) -> None:
        with pytest.raises(ValueError):
            fit_linear([1.0], [2.0])


class TestZScores:
    def test_symmetric_sample(self) -> None:
        zs = z_scores([10.0, 20.0, 30.0])
        assert zs[1] == pytest.approx(0.0)
        assert zs[0] == pytest.approx(-zs[2])

    def test_zero_variance_returns_zeros(self) -> None:
        assert z_scores([5.0, 5.0, 5.0]) == [0.0, 0.0, 0.0]

    def test_outlier_has_large_score(self) -> None:
        values = [100.0] * 20 + [1000.0]
        assert z_scores(values)[-1] > 3.0


class TestIqrBounds:
    def test_bounds_bracket_typical_values(self) -> None:
        values = [10.0, 11.0, 12.0, 13.0, 14.0, 15.0]
        lower, upper = iqr_bounds(values)
        assert lower < 10.0
        assert upper > 15.0

    def test_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            iqr_bounds([])


class TestHoltForecast:
    def test_recovers_linear_trend(self) -> None:
        series = [100.0 + 10.0 * t for t in range(12)]
        result = holt_linear_forecast(series, horizon=3)
        # Next values continue the +10/step trend.
        assert result.forecast[0] == pytest.approx(220.0, rel=0.05)
        assert result.forecast[2] == pytest.approx(240.0, rel=0.05)
        assert result.residual_std == pytest.approx(0.0, abs=1e-6)

    def test_band_widens_with_horizon(self) -> None:
        series = [100.0, 130.0, 90.0, 140.0, 110.0, 95.0, 135.0, 105.0]
        result = holt_linear_forecast(series, horizon=4)
        assert result.residual_std > 0
        assert result.band(4) > result.band(1)
        assert result.band(4) == pytest.approx(result.band(1) * math.sqrt(4))

    def test_too_few_points_raises(self) -> None:
        with pytest.raises(ValueError):
            holt_linear_forecast([1.0, 2.0, 3.0, 4.0], horizon=1)

    def test_bad_horizon_raises(self) -> None:
        with pytest.raises(ValueError):
            holt_linear_forecast([1.0] * 6, horizon=0)


class TestMonthArithmetic:
    def test_add_months_wraps_year(self) -> None:
        assert add_months("2026-11", 3) == "2027-02"
        assert add_months("2026-01", -1) == "2025-12"
        assert add_months("2026-06", 0) == "2026-06"

    def test_month_range_inclusive(self) -> None:
        assert month_range("2025-11", "2026-02") == [
            "2025-11",
            "2025-12",
            "2026-01",
            "2026-02",
        ]

    def test_month_range_rejects_inverted(self) -> None:
        with pytest.raises(ValueError):
            month_range("2026-02", "2026-01")
