# Historical site attribution (Phase 3)

`vehicle_fleet.site` is where an asset is TODAY. A report that groups past cost or tyre
life by that column moves an asset's whole history to its current site. This phase builds
the evidence for "the site at the time" without rewriting anything.

| Layer | Object |
|---|---|
| SQL view | `public.v_asset_site_history` (migration `20261110101000`, security invoker) |
| SQL helper | `public.asset_site_at(asset, country, date)` -> site, provisional, evidence |
| JS engine (mirror) | `src/lib/assetSiteHistory.js` `buildSiteHistory()`, `siteAtDate()` |
| JS service | `src/lib/api/tyreLifecycleEvents.js` `getAssetSiteAt()` |
| Tests | `src/test/assetSiteHistory.test.js` (engine + SQL mirror) |

## Operational attribution is not accounting

- **Operational reporting attribution** (this view): where an asset most likely worked on a
  date, so tyre and maintenance reports can be read by the branch that ran the asset. It is
  an estimate from job cards and is labelled `confirmed` or `provisional`.
- **Official accounting records** (the expense grid, cost centres, store issues): untouched.
  An expense line keeps the site / store / cost centre it was booked to. Nothing in this
  phase moves money between sites, and `parts_consumption.site` (the issuing store) is not
  an operating site.

No report uses the history yet. A report may opt in later; that is a separate decision.

## Evidence measured (live, 2026-11-09)

| Source | What it says | Coverage / agreement | Used |
|---|---|---|---|
| `work_orders.site` by `opened_at` | Site the asset belongs to on the job card | 96,554 cards, 1 without a site. Latest card site = register site for 559 of 991 KSA assets; Egypt 135 of 135; UAE 437 of 437 before placeholders were removed | Yes, primary |
| `vehicle_fleet.site` | Register today | Current only | Yes, closes the history |
| `tyre_records.site` | Site on a fitment row | 7,604 of 11,410 rows have one; agrees with the register on 3,510 | No: blank on a third, store vocabulary |
| `audit_log_v2` vehicle_fleet site changes | Register corrections | 578 changes, all bulk corrections on 27 Jul, 28 Jul, 1 Aug, 6 Aug, 11 Aug and 13 Aug 2026 | No: the date we learned, not the date the asset moved |
| `production_logs` site per date | Batching plant per delivery | 212,365 rows, 632 trucks, 3.2 sites per truck, 281 trucks match the register | No: a delivery plant, not the home site |
| `asset_breakdowns` | Breakdown site | 30 rows | No: too few |

Job-card site placeholders: 5,855 of 14,976 UAE cards say `UAE` and 34 KSA cards say `KSA`.
A country typed as the site is not a site and is ignored.

## Method

Per asset (organisation, country, asset number): the majority job-card site of each calendar
month; consecutive months with the same site make one period. `valid_from` is the period's
first job card; `valid_to` is the day before the next period starts (open for the last one).

- `confirmed`: 3 or more job cards over 2 or more months, every month at least 80% that site,
  no tie.
- `provisional`: anything thinner, a month with a tie, or a latest period that disagrees with
  the register.
- Latest period disagrees with the register: it closes at its last job card and a
  `register_current` period (provisional) starts the next day.
- Asset with no usable job card: one `register_current_only` period (provisional).
- `asset_site_at` before the first period returns the earliest site as provisional with
  evidence `before_first_evidence`; no evidence at all returns no row (show N/A).

## Result (dry run)

| Country | Assets | Confirmed periods | Provisional periods | Register-only assets | Assets fully confirmed |
|---|---:|---:|---:|---:|---:|
| KSA | about 1,040 | 841 | 1,025 job card + 413 register_current | 45 | 279 |
| UAE | 437 | 162 | 31 | 244 | 162 |
| Egypt | 135 | 117 | 18 | 0 | 117 |

- 721 KSA assets have more than one period; no periods overlap.
- KSA: for 413 assets the latest job-card site differs from the register; part of that is
  vocabulary (job cards were raised under store or branch names such as DIRIYAH or
  QIDDIYA while the register names gates such as DIRIYAH-G1), part is real movement.
- Helper speed: about 0.3 s per asset when warm (first call about 3 s).

## Decision

The KSA evidence is not clean enough to switch a report over: under a third of KSA assets
are fully confirmed and two in five disagree with the register at the end. The work stops
at the view and the helper. Before any report opts in, the owner should decide:

1. Whether job-card store or branch names map to register gates (a site alias list for job
   cards would raise the confirmed share).
2. Whether UAE job cards should carry a real site (5,855 say only `UAE`).
3. Which report, if any, should show "site at the time", and that provisional rows are shown
   as provisional.
