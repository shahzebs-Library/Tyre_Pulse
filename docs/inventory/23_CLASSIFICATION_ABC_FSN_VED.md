# 23 - ABC / FSN / VED classification

Engine: `src/lib/inventory/classification.js`. Tests: `src/test/inventoryClassification.test.js`.

## ABC (value) - `classifyAbc(items, { config, scopeBy })`

- Ranks 12-month consumption value per (scope, currency). Ranking across currencies is never done.
- Default cut: A while cumulative share before the item < 80%, B < 95%, else C (the item that crosses the
  line is included in the higher class).
- `scopeBy`: `company` (default), `category`, `location_id`, or a function.
- Unknown value or currency -> `unclassified` with a reason (never C). Zero consumption -> C with reason
  `no_consumption_in_period`.

## FSN (movement) - `classifyFsn(items, { now, ledgerStartAt, config })`

- Counts months in the window (default 12) with at least one issue.
- F: >= `fastMonths` (default 6); S: >= 1; N: 0 issues over the full window.
- No issues but item younger than the window -> `unclassified` (`item_younger_than_window`); ledger shorter
  than the window -> `unclassified` (`ledger_shorter_than_window`). Never N by default.

## VED (criticality) - `classifyVed(item)`

- From recorded `material_master.criticality` only: vital/critical/safety-critical -> V,
  essential/high/important -> E, desirable/low/normal -> D.
- Not recorded -> `unassessed` (never D). Unknown wording -> `unassessed` (`criticality_not_recognised`).

## Thresholds per company / category / location

`thresholdsFor(item, config)`; most specific wins: location > category > company > default > built-in.
`config = { default, byCompany: {org}, byCategory: {category lower-case}, byLocation: {location_id} }`,
each `{ abc: { a, b }, fsn: { fastMonths, windowMonths } }`. `validateThresholds` checks 0 < a < b <= 1 and
1 <= fastMonths <= windowMonths. Persisted per company by the WEB/DB lanes (configuration, not code).

## Disposition - `stockDisposition({ fsn, ved })`

| FSN | VED V | VED E / D / unassessed |
|---|---|---|
| N | `critical_insurance_spare` (keep; never written off as dead) | `dead_stock_candidate` (review, never auto write-off) |
| S | `critical_slow_mover` | `slow_mover` |
| F | `active` | `active` |
| unclassified | `insufficient_history` | `insufficient_history` |

`classifyItems` returns all three axes + disposition per item; `classificationMatrix` gives counts and the
ABC x VED matrix for the summary tile. Cycle-count frequency (doc 06: A monthly, B quarterly, C twice a
year, serial tyres quarterly) reads the ABC result.
