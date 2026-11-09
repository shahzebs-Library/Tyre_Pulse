# Tyre lifecycle events (Phase 3)

One chronological, auditable event history per PHYSICAL tyre. Read-only: derived from
what is already stored; nothing is written and no existing figure changes.

| Layer | Object |
|---|---|
| SQL view | `public.v_tyre_lifecycle_events` (migration `20261110100000`, security invoker) |
| SQL RPCs | `get_tyre_lifecycle_events(serial, country)`, `get_tyre_lifecycle_event_counts(country)` |
| JS engine (mirror) | `src/lib/tyreLifecycleEvents.js` `buildLifecycleEvents()` |
| JS service | `src/lib/api/tyreLifecycleEvents.js` |
| Screen | Tyre Passport, tab "Fitment & Movement History", section "Lifecycle events" |
| Tests | `src/test/tyreLifecycleEvents.test.js` (engine + SQL mirror), `tyreLifecycleEventsApi.test.js` |

The SQL view and the JS engine are mirrors: change both together.

## Physical tyre

The same key as Phase 1 (`v_tyre_lifetime_fitments.tyre_key`): `country|SERIAL` for a real
serial (rule T6), otherwise the fitment row is its own tyre. Fitments are ordered by
`coalesce(issue_date, fitment_date)` (nulls first), then id.

## Event types

| Event | Source | Rule |
|---|---|---|
| FIT | tyre_records | First fitment of the tyre. `is_purchase` when the tyre carries a price on any of its rows. |
| REFIT_SAME_VEHICLE | tyre_records | Later fitment, same vehicle, same position. |
| ROTATION | tyre_records, tyre_service_events | Later fitment, same vehicle, another position; or a rotation service event. |
| TRANSFER | tyre_records | Later fitment on another vehicle. |
| REMOVAL | tyre_records | A fitment that ended (removal date or removal km). Carries that stint's km by rule T7. A removal closed by the system reconcile names the `tyre_replacement_log` entry. |
| RETURN_TO_STORE | tyre_records | Inferred: removed and fitted again only after a gap of one day or more. Dated the removal day; the note gives the days off a vehicle. A tyre removed and never refitted is NOT shown as in store (no evidence). |
| RETREAD | retread_jobs, tyre_service_events | Returned (or sent) retread job; retread service event. |
| WARRANTY_REPLACEMENT | warranty_claims | Claim Approved, Credit Issued or Closed, with no rejection reason. |
| SCRAP | tyre_status_marks, tyre_records | A scrap mark (dated when the mark was made); or a Scrapped fitment row for a tyre with no mark (dated its removal). |
| DISPOSAL | tyre_disposals | A disposal with a `disposed_on` date. |
| AMBIGUOUS | tyre_records | A later fitment that cannot be told apart. The reason is stated; nothing is resolved. |

**A rotation, transfer or refit is never a purchase.** `is_purchase` is true only on the FIT
of a priced tyre (rule T1, one tyre one price). Live: 6,632 purchases = the 6,632 priced tyres
in `v_tyre_lifetime`, and 0 purchases on a non-FIT event. On 245 tyres the price sits on a
later fitment row; their FIT says so in its note and the later row stays a movement.

### Ambiguity reasons (checked in this order)

| Reason | Meaning |
|---|---|
| same_day_double_entry | Same fitment date as the previous fitment. |
| earlier_fitment_still_open | The previous fitment is still active (an unclosed rotation). |
| overlaps_earlier_fitment | Starts before the previous fitment ended. Its km is already excluded from life (Phase 1). |
| no_fitment_date | The fitment has no date. |
| vehicle_not_recorded | Either fitment has no vehicle. |
| position_not_recorded | Same vehicle but a position is missing. |

The 20 protected ambiguous old/new pairs (20261109120000/130000) and serial K507B403860 are
only READ here; the view proposes nothing and changes nothing.

## Measured live (dry run 2026-11-09)

| Event | KSA | UAE | Egypt |
|---|---:|---:|---:|
| FIT | 7,835 | 2,133 | 507 |
| REFIT_SAME_VEHICLE | 109 | 115 | 1 |
| ROTATION | 13 | 6 | 0 |
| TRANSFER | 81 | 22 | 11 |
| REMOVAL | 5,382 | 1,084 | 172 |
| RETURN_TO_STORE | 34 | 10 | 1 |
| SCRAP | 839 | 0 | 0 |
| AMBIGUOUS | 326 | 179 | 72 |
| RETREAD / WARRANTY_REPLACEMENT / DISPOSAL | 0 | 0 | 0 |

- 10,475 physical tyres; 337 have at least one refit, rotation or transfer.
- AMBIGUOUS by reason: KSA overlaps 192, same day 106, still open 28; UAE same day 146,
  overlaps 19, still open 14; Egypt same day 68, overlaps 2, still open 2. No fitment was
  ambiguous for a missing date, vehicle or position.
- SCRAP: 720 from scrap marks + 119 Scrapped rows without a mark (all KSA).
- 56 removals were closed by the system reconcile (`tyre_replacement_log`).
- 38 later fitments follow a fitment with no removal date; 64 removals have km but no date.
- retread_jobs, tyre_service_events, warranty_claims and tyre_disposals hold no rows today,
  so those event types are wired but empty.
- `get_tyre_lifecycle_events` answers one tyre in about 1.4 s (it computes the view, then
  filters); a KSA-only Manager sees KSA events only (security invoker over existing RLS).

## Known limits

- A scrap mark is dated when the mark was created, which can be later than the physical
  scrap. The Scrapped fitment row's removal date is shown when there is no mark.
- RETURN_TO_STORE is an inference from a refit gap; there is no store-movement record.
- The Tyre Passport builds the events in the browser from the passport bundle (records,
  scrap marks, service events, warranty claims) with the same engine; retread jobs and
  disposals are not part of that bundle (both tables are empty today).
