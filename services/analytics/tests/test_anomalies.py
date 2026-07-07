"""Unit tests for anomaly detection."""

from datetime import date

from analytics.core.anomalies import (
    AnomalyType,
    Severity,
    TreadMeta,
    detect_anomalies,
    detect_cost_anomalies,
    detect_duplicate_serial_anomalies,
    detect_pressure_anomalies,
    detect_wear_rate_anomalies,
)
from tests.conftest import make_pressure, make_tyre_row


class TestCostAnomalies:
    def test_extreme_cost_flagged_high(self) -> None:
        rows = [make_tyre_row(f"r{i}", cost=1200.0 + i * 10) for i in range(20)]
        rows.append(make_tyre_row("spike", cost=9_000.0))
        anomalies = detect_cost_anomalies(rows)
        assert len(anomalies) == 1
        a = anomalies[0]
        assert a.type is AnomalyType.COST_OUTLIER
        assert a.severity is Severity.HIGH
        assert a.record_ids == ("spike",)
        assert a.metrics["z_score"] > 3.0

    def test_uniform_costs_produce_no_anomalies(self) -> None:
        rows = [make_tyre_row(f"r{i}", cost=1200.0) for i in range(10)]
        assert detect_cost_anomalies(rows) == []

    def test_small_sample_skipped(self) -> None:
        rows = [make_tyre_row("a", cost=100.0), make_tyre_row("b", cost=99_999.0)]
        assert detect_cost_anomalies(rows) == []

    def test_zero_and_null_costs_ignored(self) -> None:
        rows = [make_tyre_row(f"r{i}", cost=1200.0) for i in range(10)]
        rows += [make_tyre_row("free", cost=0.0), make_tyre_row("nul", cost=None)]
        assert detect_cost_anomalies(rows) == []


class TestPressureAnomalies:
    def test_invalid_reading_flagged_high(self) -> None:
        readings = [make_pressure(f"p{i}", 110.0) for i in range(6)]
        readings.append(make_pressure("bad", -5.0))
        anomalies = detect_pressure_anomalies(readings)
        invalid = [a for a in anomalies if a.type is AnomalyType.PRESSURE_INVALID]
        assert len(invalid) == 1
        assert invalid[0].severity is Severity.HIGH
        assert invalid[0].record_ids == ("bad",)

    def test_iqr_outlier_detected(self) -> None:
        readings = [make_pressure(f"p{i}", 105.0 + i) for i in range(12)]
        readings.append(make_pressure("low", 40.0))
        anomalies = detect_pressure_anomalies(readings)
        outliers = [a for a in anomalies if a.type is AnomalyType.PRESSURE_OUTLIER]
        assert len(outliers) == 1
        assert outliers[0].record_ids == ("low",)
        assert "low" in outliers[0].message

    def test_normal_spread_no_outliers(self) -> None:
        readings = [make_pressure(f"p{i}", 100.0 + (i % 5)) for i in range(20)]
        assert detect_pressure_anomalies(readings) == []


class TestDuplicateSerials:
    def test_exact_duplicate_entry(self) -> None:
        rows = [
            make_tyre_row("d1", serial_no="SN-77", issue=date(2026, 3, 1)),
            make_tyre_row("d2", serial_no="SN-77", issue=date(2026, 3, 1)),
        ]
        anomalies = detect_duplicate_serial_anomalies(rows)
        dupes = [a for a in anomalies if a.type is AnomalyType.DUPLICATE_ENTRY]
        assert len(dupes) == 1
        assert set(dupes[0].record_ids) == {"d1", "d2"}
        assert dupes[0].severity is Severity.HIGH

    def test_serial_reuse_across_assets(self) -> None:
        rows = [
            make_tyre_row("s1", serial_no="SN-88", asset_no="TRK-001", issue=date(2026, 1, 1)),
            make_tyre_row("s2", serial_no="SN-88", asset_no="TRK-002", issue=date(2026, 2, 1)),
        ]
        anomalies = detect_duplicate_serial_anomalies(rows)
        reuse = [a for a in anomalies if a.type is AnomalyType.SERIAL_REUSE]
        assert len(reuse) == 1
        assert reuse[0].metrics["asset_count"] == 2.0
        assert "TRK-001" in reuse[0].message and "TRK-002" in reuse[0].message

    def test_blank_serials_never_flagged(self) -> None:
        rows = [
            make_tyre_row("b1", serial_no="", issue=date(2026, 1, 1)),
            make_tyre_row("b2", serial_no=None, issue=date(2026, 1, 1)),
            make_tyre_row("b3", serial_no="  ", asset_no="TRK-002", issue=date(2026, 1, 1)),
        ]
        assert detect_duplicate_serial_anomalies(rows) == []


class TestWearRateAnomalies:
    def test_fast_wearing_outlier(self) -> None:
        rates = {f"t{i}": 0.05 for i in range(10)} | {"hot": 0.40}
        meta = {"hot": TreadMeta(asset_no="TRK-009", site="Jeddah")}
        anomalies = detect_wear_rate_anomalies(rates, meta)
        outliers = [a for a in anomalies if a.type is AnomalyType.WEAR_RATE_OUTLIER]
        assert len(outliers) == 1
        assert outliers[0].asset_no == "TRK-009"
        assert "fast" in outliers[0].message

    def test_non_positive_rate_flagged_invalid(self) -> None:
        rates = {"grower": -0.02, "ok": 0.05}
        anomalies = detect_wear_rate_anomalies(rates)
        invalid = [a for a in anomalies if a.type is AnomalyType.WEAR_RATE_INVALID]
        assert len(invalid) == 1
        assert invalid[0].severity is Severity.HIGH


class TestCombinedDetection:
    def test_sorted_by_severity_and_summarised(self) -> None:
        rows = [make_tyre_row(f"r{i}", cost=1200.0 + i) for i in range(20)]
        rows.append(make_tyre_row("mild", cost=1200.0 + 2.5 * 6))  # ~medium z
        rows += [
            make_tyre_row("d1", serial_no="SN-1", issue=date(2026, 3, 1)),
            make_tyre_row("d2", serial_no="SN-1", issue=date(2026, 3, 1)),
        ]
        pressures = [make_pressure(f"p{i}", 110.0) for i in range(6)]
        pressures.append(make_pressure("bad", 0.0))

        anomalies, summary = detect_anomalies(rows, pressures, wear_rates={})
        assert summary.total == len(anomalies) > 0
        severities = [a.severity for a in anomalies]
        assert severities == sorted(severities, key=[Severity.HIGH, Severity.MEDIUM, Severity.LOW].index)
        assert sum(summary.by_severity.values()) == summary.total
        assert sum(summary.by_type.values()) == summary.total
        assert summary.by_type.get("DUPLICATE_ENTRY") == 1
        assert summary.by_type.get("PRESSURE_INVALID") == 1
