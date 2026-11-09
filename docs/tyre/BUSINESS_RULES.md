# Tyre Pulse - Business Rule Register (tyres, cost, imports)

Status as of 2026-11-09. Every rule names its owner decision, where it is enforced,
and how a change to it is reversed. A rule is changed only with a new owner decision;
record the decision here in the same change.

| ID | Rule | Decided | Enforced in (SQL / JS) | Reversal |
|---|---|---|---|---|
| T1 | **One tyre, one price.** A physical tyre (real serial, same country) is bought once. Its purchase price stays on its first priced fitment; a refit carries no new purchase. | Owner 2026-11-09 | SQL trigger `trg_zz_one_price_per_tyre` (INSERT); data fixes logged in `tyre_cost_corrections`. JS `toLifetimeTyres`, `withOnePricePerTyre` (src/lib/tyreLifetime.js) | `tyre_cost_correction_undo(batch)` (restores only rows unchanged since) |
| T2 | **Serial priced twice by two uploads: the LATEST UPLOADED row (created_at) keeps the price.** Two rows from the same batch on the same day cannot be decided this way. | Owner 2026-11-09 | Data fix only (`_bak.ksa_two_price_latest_wins_20261109`, 3 serials) | Restore cost_per_tyre from that backup |
| T3 | **One wheel, one active tyre.** A new fitment on a wheel closes the tyre already on it when the evidence is clear; otherwise the row is held for review. | 20261109090000 | `_tyre_close_replaced`, `guard_tyre_active_fitment` (skips when `auth.uid()` is null, so the staging pipe relies on T3 itself) | `tyre_replacement_undo(batch)` |
| T4 | **Same-day replacement: the latest upload wins, unless it is stale.** Held as `ambiguous_same_day_stale` when the incoming serial was already removed from that wheel, the replacement log says the current tyre replaced it, or its odometer / hour reading is below the current fitment's. | 20261109100000 + 20261109150000 | `_tyre_close_replaced` | Restore the function from `_bak.fn_defs_20261109d` |
| T5 | **One tyre, one vehicle.** A real serial fitted to a vehicle closes its active fitment on any other vehicle. | 20261109100000 | `_tyre_close_serial_elsewhere` | `tyre_replacement_undo(batch)` |
| T6 | **Real serial** = at least 6 chars, contains a digit, not DOT/NULL/N-A, not a size (incl. "195 R 15"), not Excel notation, not a month code (FEB-62), not two serials in one cell, not repeated digits or 123456-style sequences. A weak serial is its own tyre (quantity honoured). | 20261109120000 + 20261109150000 | SQL `tyre_serial_is_strong`; JS `isStrongSerial` - MIRROR, tested in `tyreLifecycleHardening.test.js` | `_bak.fn_defs_20261109d` |
| T7 | **Tyre km rule.** Fitment odometer "1" = placeholder (km unknown); fitment 0 = factory, real; a life above the class cap (mixer 80k, pump 56k, loader 15k, other 100k) is unknown, never guessed. | Owner 2026-11-04 | SQL `tyre_km_life`, `tyre_life_km_cap`; JS `src/lib/tyreKm.js` - MIRROR | migration 20261104110000 |
| T8 | **Tyre life and CPK per physical tyre:** km summed across every fitment; fleet CPK WEIGHTED = total purchase cost / total km of measurable tyres. | 20261109 (PR #470) | SQL `v_tyre_lifetime` + `get_tyre_lifetime_cpk` (20261109160000); JS `tyreLifetime.js` (MIRROR, parity verified on live Egypt data) + `kpiEngine.js`. Older server RPCs still per fitment row - see CALCULATION_SOURCE_MAP.md | drop the new objects (migration header) |
| T9 | **Tyre / fleet cost TOTALS come from the expense grid** (`parts_consumption`, item decides the bucket, amount = Values). Never sum `cost_per_tyre` for a total. | 2026-07-22/23 | `loadCostSplit`, `loadGovernedCostSplit`, `loadGridTyreByAsset` | n/a |
| T10 | **Currency is never blended.** Each country in its own currency; no combined total without an approved FX rate. | Standing | `governedCost.js`, `currencyRates.js` | n/a |
| T11 | **Expense duplicate = exact content match** (keep one, archive the rest). Re-import idempotent on `import_uid`; the `#` line-number column must be mapped. | Owner 2026-07-23 | `parts_import_uid`, `import_uid` unique index | `_bak.*` archives, `dup_resolve_archive` |
| T12 | **Fit/remove reversed in an ERP export** is corrected per axis (date, km, hours independently). | 2026-07-23 | `orderFitRemove` (erpIntake), staging trigger | n/a |
| T13 | **ERP intake cannot bypass reconciliation.** Current fitments need a country; every held row (no cap) is withheld from insert and listed for review. | 20261109150000 | `insertTyreRecords` (src/lib/api/erpIntake.js), `tyre_import_reconcile.held` | git revert |
| T14 | **Warranty claim procedure** Submitted > Under Review > Approved > Credit Issued > Closed (Rejected needs a reason); supplier wait > 30 days flagged. | Owner 2026-11-04 | `warranty_claim_guard`, `claimSaveProblem` | migration 20261104110000 |
| T15 | **Per-site operating cost is read through the asset**, never off the issuing store (`-ST` names are spare-parts stores). | Owner 2026-07-28 | `get_site_operating_cost` | n/a |
| T16 | **Nothing in business data is deleted or rewritten without a backup and a tested undo.** | Standing | `_bak.*`, undo RPCs | per item |
| T17 | **Purchase cost status** of a physical tyre: ACTUAL (paid price or own ERP job-card line), ESTIMATED (comparable-price backfill, also when a correction moved it - `tyre_price_provenance`), CONFIRMED_ZERO (warranty, evidenced), DISPUTED (a real serial priced on more than one fitment: the first price is used, a person decides), MISSING. Estimated cost is always reported beside any CPK that uses it. | Owner spec 2026-11-09 | SQL `v_tyre_lifetime.purchase_cost_status`; JS `toLifetimeTyres()._cost_status` (needs `price_source` on the row) | 20261109160000 / 170000 headers |
| T18 | **Overlapping fitments are not counted twice.** A fitment of a tyre that starts before an earlier fitment of the same tyre ended (unclosed rotation, double entry, identical duplicate rows) adds NO km and marks the tyre's km coverage partial. Live 2026-11-09: 560 such fitments, 183 of them identical-meter duplicates. | Owner spec 2026-11-09 ("non-overlapping") | SQL `v_tyre_lifetime_fitments.is_overlap`; JS `toLifetimeTyres()._overlapping_fitments` | 20261109160000 header |
| T19 | **Five different CPK measurements, never mixed or relabelled:** per-fitment tyre CPK; physical tyre lifetime CPK; fleet aggregate tyre CPK (weighted, per tyre-km); fleet expense per vehicle-km; cost per engine hour. Every screen names which one it shows. Lifetime CPK keeps FINAL (tyre no longer fitted) apart from PROVISIONAL (still fitted). | Owner spec 2026-11-09 | JS `CPK_KIND` / `CPK_KIND_LABEL` (tyreLifetime.js) | n/a |

## Protected - do not change without new evidence and owner authorisation
- **K507B403860** - priced on MP111 (950) and TM676 (766), same batch, same day; T2 cannot decide.
- **The 20 unclear tyre changes** (6 KSA + 14 UAE ambiguous old/new pairs from 20261109120000/130000).
- **SANY Apr-Jul generator invoice and plant-to-site mapping** (deferred, waiting on documents).

## Full lifetime CPK sources (T17)
Repairs (`tyre_service_events` repair, by serial), retreads (`retread_jobs` returned, by casing serial
or tyre record; else `tyre_service_events` retread), recoveries (`warranty_claims` credit issued, by
serial). All three tables were EMPTY on 2026-11-09, so full lifetime CPK equals purchase-only CPK
today. Tyre repair/retread lines in the expense grid carry no serial (KSA 18 lines / 7,200 SAR,
Egypt 33 / 148,339 EGP, all time) and are reported as unlinked, never guessed onto a tyre.

## Known tension
- T1 (JS) keeps the EARLIEST priced fitment's price; T2 (data) keeps the LATEST UPLOADED.
  After the 2026-11-09 corrections every real serial has one priced row except
  K507B403860, so the two agree on live data. A new double price is listed by
  `get_tyre_exceptions` (`serial_priced_twice`) for a person to decide.
