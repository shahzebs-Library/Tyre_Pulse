"""Unit tests for the demand (replacement) forecast."""

from datetime import date

import pytest

from analytics.core.demand import (
    METHOD_BASELINE,
    METHOD_INSUFFICIENT,
    METHOD_MODEL_BLEND,
    forecast_demand,
)
from analytics.core.tyre_life import predict_tyre_life
from analytics.core.types import MonthlyValue
from tests.conftest import make_tread_series

AS_OF = date(2026, 6, 1)


def _predictions(specs: list[tuple[str, float]]):
    """Build real predictions from synthetic series (start tread controls urgency)."""
    readings = []
    for key, start_tread in specs:
        readings += make_tread_series(key, start_tread=start_tread, asset_no=f"TRK-{key}")
    return predict_tyre_life(readings, as_of=AS_OF).predictions


class TestModelBlend:
    def test_removals_bucketed_into_months(self) -> None:
        # start 6.5mm -> ~10.85-adjusted... choose spreads: 4.5mm worn soon, 14mm much later
        preds = _predictions([("SOON", 5.0), ("LATER", 14.0)])
        result = forecast_demand(
            preds,
            monthly_replacements=[],
            months_ahead=12,
            fleet_tyre_count=2,
            avg_unit_cost=1200.0,
            as_of=AS_OF,
        )
        assert result.method == METHOD_MODEL_BLEND
        assert result.modelled_coverage == pytest.approx(1.0)
        assert sum(p.model_units for p in result.forecast) >= 1
        assert len(result.forecast) == 12
        assert result.forecast[0].month == "2026-07"
        for p in result.forecast:
            if p.projected_units:
                assert p.estimated_cost == pytest.approx(p.projected_units * 1200.0)

    def test_partial_coverage_blends_baseline(self) -> None:
        preds = _predictions([("ONLY", 14.0)])
        history = [MonthlyValue(f"2025-{m:02d}", 10.0) for m in range(1, 13)]
        result = forecast_demand(
            preds,
            monthly_replacements=history,
            months_ahead=3,
            fleet_tyre_count=10,  # 1 of 10 tyres modelled
            avg_unit_cost=None,
            as_of=AS_OF,
        )
        assert result.modelled_coverage == pytest.approx(0.1)
        assert result.baseline_monthly_units == pytest.approx(10.0)
        # Unmodelled 90% of fleet contributes 9 units/month from the run rate.
        for p in result.forecast:
            assert p.baseline_units == pytest.approx(9.0)
            assert p.projected_units >= 9
            assert p.estimated_cost is None


class TestFallbacks:
    def test_no_predictions_uses_baseline_run_rate(self) -> None:
        history = [MonthlyValue(f"2025-{m:02d}", 8.0) for m in range(1, 13)]
        result = forecast_demand(
            [], history, months_ahead=2, fleet_tyre_count=50, as_of=AS_OF
        )
        assert result.method == METHOD_BASELINE
        assert all(p.projected_units == 8 for p in result.forecast)
        assert any("run rate" in n for n in result.notes)

    def test_nothing_available_is_flagged(self) -> None:
        result = forecast_demand([], [], months_ahead=3, as_of=AS_OF)
        assert result.method == METHOD_INSUFFICIENT
        assert result.forecast == []
        assert result.notes

    def test_short_history_flagged(self) -> None:
        history = [MonthlyValue("2026-04", 5.0), MonthlyValue("2026-05", 7.0)]
        result = forecast_demand([], history, months_ahead=1, as_of=AS_OF)
        assert any("only 2 month(s)" in n for n in result.notes)

    def test_overdue_tyres_noted(self) -> None:
        preds = _predictions([("WORN", 3.2)])  # essentially at threshold now
        result = forecast_demand(preds, [], months_ahead=3, as_of=AS_OF)
        assert any("already at/past" in n for n in result.notes)

    def test_invalid_horizon_raises(self) -> None:
        with pytest.raises(ValueError):
            forecast_demand([], [], months_ahead=0, as_of=AS_OF)
