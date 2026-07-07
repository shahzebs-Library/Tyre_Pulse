"""Predictive tyre life: per-tyre linear regression over tread-depth history.

Wear model: tread depth declines approximately linearly with usage. For each
tyre with enough inspection history we fit OLS (days since first reading vs
tread mm); the negated slope is the wear rate in mm/day. Remaining life is the
time for the current tread to reach the removal threshold (legal limit is
3 mm for steer/drive, 2 mm otherwise - see tread_depth_legal_mm in app
settings; 3.0 mm is the safe default).

Tyres with sparse history (< MIN_MODEL_POINTS readings) get a clearly-flagged
heuristic estimate from the fleet median wear rate instead of an error.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import median
from typing import Sequence

from analytics.core.stats import MIN_MODEL_POINTS, fit_linear
from analytics.core.types import TreadReading

#: Fallback wear rate when no tyre in the fleet has enough history to model.
#: Basis: ~17 mm usable tread (20 mm new - 3 mm legal) over ~400 days.
DEFAULT_WEAR_RATE_MM_PER_DAY = 0.0425

#: Ignore fitted rates outside this range as physically implausible.
MAX_PLAUSIBLE_WEAR_MM_PER_DAY = 1.0

#: Cap projections so a barely-worn tyre never reports absurd horizons.
MAX_REMAINING_DAYS = 3650

METHOD_REGRESSION = "regression"
METHOD_FLEET_MEDIAN = "fleet_median_heuristic"
METHOD_DEFAULT_RATE = "default_rate_heuristic"


@dataclass(frozen=True, slots=True)
class TyreLifePrediction:
    tyre_key: str
    asset_no: str | None
    position: str | None
    brand: str | None
    site: str | None
    current_tread_mm: float
    wear_rate_mm_per_day: float
    remaining_days: int
    remaining_km: float
    predicted_removal_date: date
    readings_used: int
    method: str
    confidence: str
    r_squared: float | None = None
    notes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class FleetAggregate:
    tyre_count: int
    modelled_count: int
    heuristic_count: int
    median_wear_rate_mm_per_day: float | None
    avg_remaining_days: float | None
    due_within_30_days: int
    due_within_60_days: int
    due_within_90_days: int


@dataclass(frozen=True, slots=True)
class TyreLifeResult:
    predictions: list[TyreLifePrediction]
    fleet: FleetAggregate


@dataclass(frozen=True, slots=True)
class _Series:
    tyre_key: str
    days: list[float]
    treads: list[float]
    last: TreadReading
    notes: list[str] = field(default_factory=list)


def _build_series(readings: Sequence[TreadReading]) -> list[_Series]:
    """Group readings per tyre, averaging same-day duplicates, sorted by date."""
    grouped: dict[str, dict[date, list[float]]] = defaultdict(lambda: defaultdict(list))
    latest: dict[str, TreadReading] = {}
    for r in readings:
        if r.tread_depth_mm < 0:
            continue  # invalid sensor/entry value; anomaly detection reports these
        grouped[r.tyre_key][r.observed_at].append(r.tread_depth_mm)
        prev = latest.get(r.tyre_key)
        if prev is None or r.observed_at >= prev.observed_at:
            latest[r.tyre_key] = r

    series: list[_Series] = []
    for tyre_key, by_day in grouped.items():
        days_sorted = sorted(by_day)
        origin = days_sorted[0]
        xs = [float((d - origin).days) for d in days_sorted]
        ys = [sum(by_day[d]) / len(by_day[d]) for d in days_sorted]
        series.append(_Series(tyre_key=tyre_key, days=xs, treads=ys, last=latest[tyre_key]))
    return series


def _confidence(method: str, r_squared: float | None) -> str:
    if method != METHOD_REGRESSION or r_squared is None:
        return "low"
    if r_squared >= 0.8:
        return "high"
    if r_squared >= 0.5:
        return "medium"
    return "low"


def predict_tyre_life(
    readings: Sequence[TreadReading],
    *,
    removal_threshold_mm: float = 3.0,
    avg_daily_km: float = 200.0,
    as_of: date | None = None,
) -> TyreLifeResult:
    """Predict remaining life for every tyre present in the readings.

    remaining_km is derived from remaining_days via avg_daily_km (inspections
    carry no odometer), so it inherits that assumption - callers control it.
    """
    today = as_of or date.today()
    series = _build_series(readings)

    fits: dict[str, tuple[float, float]] = {}  # tyre_key -> (wear_rate, r2)
    notes_by_tyre: dict[str, list[str]] = defaultdict(list)

    for s in series:
        if len(s.days) < MIN_MODEL_POINTS:
            notes_by_tyre[s.tyre_key].append(
                f"only {len(s.days)} reading(s); {MIN_MODEL_POINTS} needed for regression"
            )
            continue
        fit = fit_linear(s.days, s.treads)
        rate = -fit.slope
        if rate <= 0:
            notes_by_tyre[s.tyre_key].append(
                "tread depth not decreasing over time; readings look inconsistent"
            )
            continue
        if rate > MAX_PLAUSIBLE_WEAR_MM_PER_DAY:
            notes_by_tyre[s.tyre_key].append(
                f"fitted wear rate {rate:.3f} mm/day is implausibly high; ignored"
            )
            continue
        fits[s.tyre_key] = (rate, fit.r_squared)

    modelled_rates = [rate for rate, _ in fits.values()]
    fleet_median_rate = median(modelled_rates) if modelled_rates else None

    predictions: list[TyreLifePrediction] = []
    for s in series:
        if s.tyre_key in fits:
            rate, r2 = fits[s.tyre_key]
            method = METHOD_REGRESSION
        elif fleet_median_rate is not None:
            rate, r2 = fleet_median_rate, None
            method = METHOD_FLEET_MEDIAN
        else:
            rate, r2 = DEFAULT_WEAR_RATE_MM_PER_DAY, None
            method = METHOD_DEFAULT_RATE

        current = s.treads[-1]
        usable = max(0.0, current - removal_threshold_mm)
        remaining_days = min(MAX_REMAINING_DAYS, int(usable / rate))
        predictions.append(
            TyreLifePrediction(
                tyre_key=s.tyre_key,
                asset_no=s.last.asset_no,
                position=s.last.position,
                brand=s.last.brand,
                site=s.last.site,
                current_tread_mm=round(current, 2),
                wear_rate_mm_per_day=round(rate, 5),
                remaining_days=remaining_days,
                remaining_km=round(remaining_days * avg_daily_km, 1),
                predicted_removal_date=today + timedelta(days=remaining_days),
                readings_used=len(s.days),
                method=method,
                confidence=_confidence(method, r2),
                r_squared=round(r2, 4) if r2 is not None else None,
                notes=tuple(notes_by_tyre.get(s.tyre_key, ())),
            )
        )

    predictions.sort(key=lambda p: p.remaining_days)
    remaining = [p.remaining_days for p in predictions]
    fleet = FleetAggregate(
        tyre_count=len(predictions),
        modelled_count=sum(1 for p in predictions if p.method == METHOD_REGRESSION),
        heuristic_count=sum(1 for p in predictions if p.method != METHOD_REGRESSION),
        median_wear_rate_mm_per_day=(
            round(fleet_median_rate, 5) if fleet_median_rate is not None else None
        ),
        avg_remaining_days=(round(sum(remaining) / len(remaining), 1) if remaining else None),
        due_within_30_days=sum(1 for d in remaining if d <= 30),
        due_within_60_days=sum(1 for d in remaining if d <= 60),
        due_within_90_days=sum(1 for d in remaining if d <= 90),
    )
    return TyreLifeResult(predictions=predictions, fleet=fleet)
