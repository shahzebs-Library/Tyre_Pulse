"""Unit tests for predictive tyre life."""

from datetime import date, timedelta

import pytest

from analytics.core.tyre_life import (
    DEFAULT_WEAR_RATE_MM_PER_DAY,
    METHOD_DEFAULT_RATE,
    METHOD_FLEET_MEDIAN,
    METHOD_REGRESSION,
    predict_tyre_life,
)
from tests.conftest import make_tread_series

AS_OF = date(2026, 6, 1)


class TestRegressionPath:
    def test_linear_wear_predicts_expected_remaining_life(self) -> None:
        # 0.35 mm/week = 0.05 mm/day; 10 readings, last tread = 14 - 0.35*9 = 10.85
        readings = make_tread_series("SER-1")
        result = predict_tyre_life(readings, removal_threshold_mm=3.0, avg_daily_km=200.0, as_of=AS_OF)

        assert len(result.predictions) == 1
        p = result.predictions[0]
        assert p.method == METHOD_REGRESSION
        assert p.confidence == "high"
        assert p.wear_rate_mm_per_day == pytest.approx(0.05, rel=0.01)
        expected_days = int((10.85 - 3.0) / 0.05)
        assert p.remaining_days == pytest.approx(expected_days, abs=2)
        assert p.remaining_km == pytest.approx(p.remaining_days * 200.0)
        assert p.predicted_removal_date == AS_OF + timedelta(days=p.remaining_days)
        assert p.r_squared == pytest.approx(1.0)

    def test_worn_out_tyre_reports_zero_remaining(self) -> None:
        readings = make_tread_series("SER-2", start_tread=5.0, wear_per_week=0.5, weeks=6)
        result = predict_tyre_life(readings, removal_threshold_mm=3.0, as_of=AS_OF)
        assert result.predictions[0].remaining_days == 0
        assert result.predictions[0].predicted_removal_date == AS_OF

    def test_same_day_duplicate_readings_are_averaged(self) -> None:
        readings = make_tread_series("SER-3")
        readings += [readings[0], readings[1]]  # duplicates must not distort the fit
        result = predict_tyre_life(readings, as_of=AS_OF)
        assert result.predictions[0].wear_rate_mm_per_day == pytest.approx(0.05, rel=0.01)


class TestHeuristicFallbacks:
    def test_sparse_tyre_uses_fleet_median(self) -> None:
        rich = make_tread_series("SER-RICH")
        sparse = make_tread_series("SER-SPARSE", weeks=3, asset_no="TRK-002")
        result = predict_tyre_life(rich + sparse, as_of=AS_OF)

        by_key = {p.tyre_key: p for p in result.predictions}
        assert by_key["SER-RICH"].method == METHOD_REGRESSION
        sparse_pred = by_key["SER-SPARSE"]
        assert sparse_pred.method == METHOD_FLEET_MEDIAN
        assert sparse_pred.confidence == "low"
        assert sparse_pred.wear_rate_mm_per_day == pytest.approx(0.05, rel=0.01)
        assert any("reading" in n for n in sparse_pred.notes)

    def test_no_modellable_tyres_uses_default_rate(self) -> None:
        sparse = make_tread_series("SER-ONLY", weeks=2)
        result = predict_tyre_life(sparse, as_of=AS_OF)
        p = result.predictions[0]
        assert p.method == METHOD_DEFAULT_RATE
        assert p.wear_rate_mm_per_day == pytest.approx(DEFAULT_WEAR_RATE_MM_PER_DAY)

    def test_increasing_tread_falls_back_and_flags(self) -> None:
        # Tread going up over time is physically impossible - bad data.
        rising = make_tread_series("SER-BAD", start_tread=8.0, wear_per_week=-0.3)
        good = make_tread_series("SER-GOOD")
        result = predict_tyre_life(rising + good, as_of=AS_OF)
        bad = next(p for p in result.predictions if p.tyre_key == "SER-BAD")
        assert bad.method == METHOD_FLEET_MEDIAN
        assert any("not decreasing" in n for n in bad.notes)

    def test_negative_readings_ignored(self) -> None:
        readings = make_tread_series("SER-N")
        bad = readings[0].__class__(
            tyre_key="SER-N",
            observed_at=readings[-1].observed_at + timedelta(days=1),
            tread_depth_mm=-4.0,
        )
        result = predict_tyre_life([*readings, bad], as_of=AS_OF)
        assert result.predictions[0].readings_used == len(readings)


class TestFleetAggregate:
    def test_counts_and_due_buckets(self) -> None:
        soon = make_tread_series("SER-SOON", start_tread=3.5, wear_per_week=0.35)  # nearly worn
        later = make_tread_series("SER-LATER", start_tread=14.0)
        result = predict_tyre_life(soon + later, as_of=AS_OF)

        assert result.fleet.tyre_count == 2
        assert result.fleet.modelled_count == 2
        assert result.fleet.heuristic_count == 0
        assert result.fleet.due_within_30_days == 1
        assert result.fleet.median_wear_rate_mm_per_day == pytest.approx(0.05, rel=0.01)
        # Sorted most-urgent first.
        assert result.predictions[0].tyre_key == "SER-SOON"

    def test_empty_input_returns_empty_result(self) -> None:
        result = predict_tyre_life([], as_of=AS_OF)
        assert result.predictions == []
        assert result.fleet.tyre_count == 0
        assert result.fleet.avg_remaining_days is None
