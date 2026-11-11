# Server CPK repoint to the T7 km rule - before / after (2026-11-10)

Findings F-E-01 (fleet CPK km denominator) and F-E-02 (brand/size CPK). Two migrations, applied by the lead:

- `supabase/migrations/20261110142000_fleet_tyre_km_rule_t7.sql` - `fleet_tyre_km_by_asset` sums
  `tyre_km_life(fit, rem, total, CLASS)` (placeholder "1" and above-class-cap lives excluded) instead of raw
  `sum(total_km)`. `CLASS` = the tyre row's own `vehicle_type`, else the fleet register's type (F-E-04).
  `get_fleet_cpk` and `get_cpk_drivers` read `km_run` by name and inherit the corrected denominator with no edit.
- `supabase/migrations/20261110143000_brand_size_cpk_lifetime.sql` - `get_brand_size_cpk` is the weighted
  lifetime CPK (`sum(purchase_cost*qty) / sum(km_known*qty)`) from `v_tyre_lifetime`, one price per physical
  tyre, grouped by the tyre's latest brand/size. Was `avg(cost_per_tyre) / avg(total_km)` per fitment row.

## F-E-01 - fleet km denominator, per country

Window = the RPC default (`coalesce(removal_date, issue_date)` in the last 365 days), org
`00000000-0000-0000-0000-000000000001`, data as of 2026-11-10. "Raw" is the old `sum(total_km) where
total_km > 0`; "Rule" is the new `sum(tyre_km_life(... coalesce(row type, fleet type)))`.

| Country | Rows in window (total_km>0) | Raw km (before) | Rule km (after) | Ratio | Placeholder rows | Rows excluded (placeholder/over-cap) |
|---|---:|---:|---:|---:|---:|---:|
| KSA   | 5,169 | 478,592,287 | 161,624,551 | 2.96x | 454 | 764 |
| UAE   | 1,041 |  40,391,746 |  25,795,072 | 1.57x |  82 | 157 |
| Egypt |   116 |   5,499,885 |   1,993,658 | 2.76x |  21 |  37 |

Effect: with the denominator ~3x smaller in KSA, `get_fleet_cpk` `cpk_tyre` / `cpk_total` roughly TRIPLE in KSA
(the fleet reads ~3x more expensive per km, which is the owner's own T7 rule). The fleet-type fallback (F-E-04)
lowers the KSA rule sum from 166,685,224 (row type only) to 161,624,551 by applying the real class cap to the
3,796 blank-type KSA rows (more over-cap rows correctly excluded). Egypt is unaffected by the fallback (the 55
Egypt rows with a fleet type stay under cap).

### Acceptance (identity)
`sum(km_run)` from the new RPC == `sum(tyre_km_life(...))` for the same rows, by construction (the body IS that
sum). KSA last-365 ~ 161,624,551 (was raw 478,592,287). No asset `km_run` exceeds `fitments x class cap`
(every fitment capped by `tyre_km_life`). The register's noted target was 161,569,546; the 55,005 km (0.03%)
difference is the fleet-type lateral match (this build normalises asset_no, which is canonical in both tables).

## F-E-02 - brand/size CPK (KSA 315/80R22.5, weighted, all-time, lifetime layer)

Was per-fitment-row `avg(cost)/avg(total_km)` (ERICLE 0.0002 SAR/km on a 4,295,772 km raw avg life). Now
`sum(purchase_cost*qty)/sum(km_known*qty)` over priced + measurable physical tyres. Ordering ascending by cpk
matches `kpiEngine.computeCpkByBrand` over the same rows (the parity target). Sample (SAR/km):

| Brand | Tyres | Measurable | avg price | avg life km | Weighted CPK (new) |
|---|---:|---:|---:|---:|---:|
| WEST LAKE | 12  | 3   | 1,125.00 | 55,943 | 0.02040 |
| TRIANGLE  | 1,086 | 218 | 1,024.58 | 49,430 | 0.02089 |
| TECHKING  | 820 | 80  |   844.17 | 43,687 | 0.02280 |
| PIRELLI   | 315 | 104 | 1,022.84 | 41,489 | 0.02364 |
| ERACLE    | 1,047 | 318 | 1,074.59 | 37,919 | 0.02820 |
| TEGRYS    | 1,984 | 422 | 1,106.32 | 34,143 | 0.03045 |
| ERICLE    | 207 | 59  | 1,042.01 | 29,338 | 0.03662 |
| DOUBLECOIN| 399 | 20  | 2,406.26 | (priced subset short) | 0.20046 |

Acceptance: ERICLE ~0.037, TRIANGLE ~0.021 (register target ERICLE ~0.038, TRIANGLE ~0.022). `tyres` is now
physical tyres, not fitment rows (TEGRYS 1,984 tyres vs 2,078 rows before). DOUBLECOIN's weighted figure is high
and correct: its 20 priced + measurable tyres are expensive and short-lived; the register's quick reference
0.0578 was an avg_price/avg_rule_life estimate, not the T8 weighted value the canonical JS engine uses.

## Owner gate D (raw total_km)
`get_fleet_cpk` / `get_cpk_drivers` do NOT expose a separate raw-km column (their output `all_km` is derived from
`km_run`), so there is nothing to preserve as a raw column; the repoint keeps `fleet_tyre_km_by_asset`'s
signature unchanged (a pure CREATE OR REPLACE, no DROP, no consumer edit). The raw total stays available by a
one-line probe (`sum(total_km)` with the same window) and is recorded in the table above. Adding a persistent raw
column would require a signature change (DROP + recreate) and was deliberately avoided to keep the change safe.
