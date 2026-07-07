"""Unit tests for the monthly cost forecast."""

import pytest

from analytics.core.cost_forecast import (
    METHOD_HOLT,
    METHOD_MEAN,
    forecast_monthly_cost,
)
from analytics.core.types import MonthlyValue


class TestHoltPath:
    def test_upward_trend_is_continued(self, trending_monthly_costs) -> None:
        result = forecast_monthly_cost(trending_monthly_costs, months_ahead=3)
        assert result.method == METHOD_HOLT
        assert [p.month for p in result.forecast] == ["2026-01", "2026-02", "2026-03"]
        # History ends at 15.5k rising 500/month.
        assert result.forecast[0].expected == pytest.approx(16_000.0, rel=0.05)
        assert result.forecast[2].expected == pytest.approx(17_000.0, rel=0.05)

    def test_band_ordering_and_non_negative(self, trending_monthly_costs) -> None:
        noisy = [
            MonthlyValue(m.month, m.value + (800.0 if i % 2 else -800.0))
            for i, m in enumerate(trending_monthly_costs)
        ]
        result = forecast_monthly_cost(noisy, months_ahead=6)
        for point in result.forecast:
            assert 0.0 <= point.lower <= point.expected <= point.upper

    def test_gap_months_filled_with_zero_spend(self) -> None:
        history = [
            MonthlyValue("2025-01", 5_000.0),
            MonthlyValue("2025-02", 5_200.0),
            MonthlyValue("2025-04", 5_500.0),  # 2025-03 missing
            MonthlyValue("2025-05", 5_600.0),
            MonthlyValue("2025-06", 5_800.0),
        ]
        result = forecast_monthly_cost(history, months_ahead=1)
        months = [h.month for h in result.history]
        assert months == ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06"]
        assert result.history[2].value == 0.0


class TestHeuristicPath:
    def test_short_history_uses_flagged_mean(self) -> None:
        history = [MonthlyValue("2026-01", 9_000.0), MonthlyValue("2026-02", 11_000.0)]
        result = forecast_monthly_cost(history, months_ahead=2)
        assert result.method == METHOD_MEAN
        assert result.notes  # clearly flagged
        for point in result.forecast:
            assert point.expected == pytest.approx(10_000.0)
            assert point.lower <= point.expected <= point.upper

    def test_empty_history(self) -> None:
        result = forecast_monthly_cost([], months_ahead=3)
        assert result.forecast == []
        assert result.method == METHOD_MEAN
        assert result.notes

    def test_invalid_horizon_raises(self) -> None:
        with pytest.raises(ValueError):
            forecast_monthly_cost([MonthlyValue("2026-01", 1.0)], months_ahead=0)
