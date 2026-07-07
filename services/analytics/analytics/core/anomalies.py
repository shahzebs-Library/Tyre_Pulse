"""Typed anomaly detection over tyre and inspection data.

Detectors (thresholds mirror src/lib/anomalyEngine.js where applicable):
- WEAR_RATE_OUTLIER  z-score outliers across fitted per-tyre wear rates
- WEAR_RATE_INVALID  tread increasing over time (impossible; data issue)
- PRESSURE_OUTLIER   Tukey-fence outliers over pressure readings
- PRESSURE_INVALID   physically impossible pressure values
- COST_OUTLIER       cost_per_tyre z-score outliers (warn >=2, high >=3 sigma)
- DUPLICATE_ENTRY    same asset + serial + issue_date recorded more than once
- SERIAL_REUSE       same serial fitted to multiple different assets
"""

from collections import defaultdict
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Mapping, Sequence

from analytics.core.stats import iqr_bounds, z_scores
from analytics.core.types import PressureReading, TyreRecordRow

#: Same defaults as the frontend anomaly engine.
COST_Z_WARN = 2.0
COST_Z_HIGH = 3.0
WEAR_Z_WARN = 2.0
WEAR_Z_HIGH = 3.0

#: Sanity range covering both PSI and kPa conventions is impossible, so we
#: only reject values no unit system can produce for truck tyres.
PRESSURE_MIN_VALID = 1.0
PRESSURE_MAX_VALID = 1000.0

#: Minimum sample for distribution-based detectors (z-score / IQR).
MIN_SAMPLE = 5


class AnomalyType(StrEnum):
    WEAR_RATE_OUTLIER = "WEAR_RATE_OUTLIER"
    WEAR_RATE_INVALID = "WEAR_RATE_INVALID"
    PRESSURE_OUTLIER = "PRESSURE_OUTLIER"
    PRESSURE_INVALID = "PRESSURE_INVALID"
    COST_OUTLIER = "COST_OUTLIER"
    DUPLICATE_ENTRY = "DUPLICATE_ENTRY"
    SERIAL_REUSE = "SERIAL_REUSE"


class Severity(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


_SEVERITY_ORDER = {Severity.HIGH: 0, Severity.MEDIUM: 1, Severity.LOW: 2}


@dataclass(frozen=True, slots=True)
class Anomaly:
    type: AnomalyType
    severity: Severity
    message: str
    asset_no: str | None = None
    serial_no: str | None = None
    site: str | None = None
    record_ids: tuple[str, ...] = ()
    metrics: Mapping[str, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TreadMeta:
    """Display metadata for a tyre_key used in wear-rate anomaly messages."""

    asset_no: str | None = None
    site: str | None = None


def detect_wear_rate_anomalies(
    wear_rates: Mapping[str, float],
    tyre_meta: Mapping[str, TreadMeta] | None = None,
    *,
    z_warn: float = WEAR_Z_WARN,
    z_high: float = WEAR_Z_HIGH,
) -> list[Anomaly]:
    """Flag tyres wearing abnormally fast/slow vs the fleet, plus impossible
    (non-positive) fitted rates. wear_rates maps tyre_key -> mm/day."""
    meta = tyre_meta or {}
    anomalies: list[Anomaly] = []

    invalid = {k: r for k, r in wear_rates.items() if r <= 0}
    for key, rate in invalid.items():
        m = meta.get(key)
        anomalies.append(
            Anomaly(
                type=AnomalyType.WEAR_RATE_INVALID,
                severity=Severity.HIGH,
                message=(
                    f"Tyre {key}: fitted wear rate {rate:.4f} mm/day - tread depth "
                    "appears to increase over time (inconsistent readings)"
                ),
                asset_no=m.asset_no if m else None,
                site=m.site if m else None,
                metrics={"wear_rate_mm_per_day": rate},
            )
        )

    valid = {k: r for k, r in wear_rates.items() if r > 0}
    if len(valid) >= MIN_SAMPLE:
        keys = list(valid)
        for key, z in zip(keys, z_scores([valid[k] for k in keys])):
            if abs(z) < z_warn:
                continue
            m = meta.get(key)
            direction = "fast" if z > 0 else "slow"
            anomalies.append(
                Anomaly(
                    type=AnomalyType.WEAR_RATE_OUTLIER,
                    severity=Severity.HIGH if abs(z) >= z_high else Severity.MEDIUM,
                    message=(
                        f"Tyre {key}: wearing abnormally {direction} "
                        f"({valid[key]:.4f} mm/day, z={z:.2f})"
                    ),
                    asset_no=m.asset_no if m else None,
                    site=m.site if m else None,
                    metrics={"wear_rate_mm_per_day": valid[key], "z_score": round(z, 3)},
                )
            )
    return anomalies


def detect_pressure_anomalies(
    readings: Sequence[PressureReading],
    *,
    iqr_k: float = 1.5,
) -> list[Anomaly]:
    """Invalid values first, then Tukey-fence outliers over the valid sample."""
    anomalies: list[Anomaly] = []
    valid: list[PressureReading] = []
    for r in readings:
        if PRESSURE_MIN_VALID <= r.pressure <= PRESSURE_MAX_VALID:
            valid.append(r)
        else:
            anomalies.append(
                Anomaly(
                    type=AnomalyType.PRESSURE_INVALID,
                    severity=Severity.HIGH,
                    message=(
                        f"Impossible pressure reading {r.pressure:g} on asset "
                        f"{r.asset_no or '?'} ({r.observed_at.isoformat()})"
                    ),
                    asset_no=r.asset_no,
                    serial_no=r.tyre_serial,
                    site=r.site,
                    record_ids=(r.record_id,),
                    metrics={"pressure": r.pressure},
                )
            )

    if len(valid) >= MIN_SAMPLE:
        lower, upper = iqr_bounds([r.pressure for r in valid], k=iqr_k)
        extreme_lower, extreme_upper = iqr_bounds([r.pressure for r in valid], k=iqr_k * 2)
        for r in valid:
            if lower <= r.pressure <= upper:
                continue
            extreme = r.pressure < extreme_lower or r.pressure > extreme_upper
            side = "low" if r.pressure < lower else "high"
            anomalies.append(
                Anomaly(
                    type=AnomalyType.PRESSURE_OUTLIER,
                    severity=Severity.HIGH if extreme else Severity.MEDIUM,
                    message=(
                        f"Pressure {r.pressure:g} on asset {r.asset_no or '?'} is an unusually "
                        f"{side} reading (typical range {lower:.1f}-{upper:.1f})"
                    ),
                    asset_no=r.asset_no,
                    serial_no=r.tyre_serial,
                    site=r.site,
                    record_ids=(r.record_id,),
                    metrics={"pressure": r.pressure, "lower": round(lower, 1), "upper": round(upper, 1)},
                )
            )
    return anomalies


def detect_cost_anomalies(
    rows: Sequence[TyreRecordRow],
    *,
    z_warn: float = COST_Z_WARN,
    z_high: float = COST_Z_HIGH,
) -> list[Anomaly]:
    """Z-score outliers over cost_per_tyre (mirrors the frontend cost spike rule)."""
    priced = [r for r in rows if r.cost_per_tyre is not None and r.cost_per_tyre > 0]
    if len(priced) < MIN_SAMPLE:
        return []
    costs = [float(r.cost_per_tyre or 0.0) for r in priced]
    mean_cost = sum(costs) / len(costs)
    anomalies: list[Anomaly] = []
    for row, z in zip(priced, z_scores(costs)):
        if abs(z) < z_warn:
            continue
        anomalies.append(
            Anomaly(
                type=AnomalyType.COST_OUTLIER,
                severity=Severity.HIGH if abs(z) >= z_high else Severity.MEDIUM,
                message=(
                    f"Unusual tyre cost {row.cost_per_tyre:g} for {row.brand or 'unknown brand'} "
                    f"on asset {row.asset_no or '?'} (fleet avg {mean_cost:.0f}, z={z:.2f})"
                ),
                asset_no=row.asset_no,
                serial_no=row.serial_no,
                site=row.site,
                record_ids=(row.record_id,),
                metrics={"cost_per_tyre": float(row.cost_per_tyre or 0.0), "z_score": round(z, 3)},
            )
        )
    return anomalies


def detect_duplicate_serial_anomalies(rows: Sequence[TyreRecordRow]) -> list[Anomaly]:
    """Exact duplicates (asset+serial+date) and serial reuse across assets."""
    anomalies: list[Anomaly] = []

    exact: dict[tuple[str, str, str], list[TyreRecordRow]] = defaultdict(list)
    by_serial: dict[str, list[TyreRecordRow]] = defaultdict(list)
    for r in rows:
        serial = (r.serial_no or "").strip()
        if not serial:
            continue
        by_serial[serial].append(r)
        if r.asset_no and r.issue_date:
            exact[(r.asset_no, serial, r.issue_date.isoformat())].append(r)

    for (asset, serial, day), recs in exact.items():
        if len(recs) < 2:
            continue
        anomalies.append(
            Anomaly(
                type=AnomalyType.DUPLICATE_ENTRY,
                severity=Severity.HIGH,
                message=(
                    f"Exact duplicate: asset {asset} serial {serial} on {day} "
                    f"({len(recs)} entries)"
                ),
                asset_no=asset,
                serial_no=serial,
                site=recs[0].site,
                record_ids=tuple(r.record_id for r in recs),
                metrics={"entries": float(len(recs))},
            )
        )

    for serial, recs in by_serial.items():
        assets = sorted({r.asset_no for r in recs if r.asset_no})
        if len(assets) < 2:
            continue
        anomalies.append(
            Anomaly(
                type=AnomalyType.SERIAL_REUSE,
                severity=Severity.HIGH,
                message=(
                    f"Serial {serial} appears on {len(assets)} different assets: "
                    f"{', '.join(assets)} - possible data entry error or unlogged transfer"
                ),
                serial_no=serial,
                site=recs[0].site,
                record_ids=tuple(r.record_id for r in recs),
                metrics={"asset_count": float(len(assets))},
            )
        )
    return anomalies


@dataclass(frozen=True, slots=True)
class AnomalySummary:
    total: int
    by_severity: Mapping[str, int]
    by_type: Mapping[str, int]


def detect_anomalies(
    tyre_rows: Sequence[TyreRecordRow],
    pressure_readings: Sequence[PressureReading],
    wear_rates: Mapping[str, float],
    tyre_meta: Mapping[str, TreadMeta] | None = None,
    *,
    z_warn: float = COST_Z_WARN,
    z_high: float = COST_Z_HIGH,
    iqr_k: float = 1.5,
) -> tuple[list[Anomaly], AnomalySummary]:
    """Run every detector and return anomalies sorted high -> low severity."""
    anomalies = [
        *detect_wear_rate_anomalies(wear_rates, tyre_meta, z_warn=z_warn, z_high=z_high),
        *detect_pressure_anomalies(pressure_readings, iqr_k=iqr_k),
        *detect_cost_anomalies(tyre_rows, z_warn=z_warn, z_high=z_high),
        *detect_duplicate_serial_anomalies(tyre_rows),
    ]
    anomalies.sort(key=lambda a: (_SEVERITY_ORDER[a.severity], a.type, a.asset_no or ""))

    by_severity: dict[str, int] = defaultdict(int)
    by_type: dict[str, int] = defaultdict(int)
    for a in anomalies:
        by_severity[a.severity.value] += 1
        by_type[a.type.value] += 1
    summary = AnomalySummary(
        total=len(anomalies), by_severity=dict(by_severity), by_type=dict(by_type)
    )
    return anomalies, summary
