# 24 - Tyre custody engine

Engine: `src/lib/inventory/tyreCustody.js`. Tests: `src/test/inventoryTyreCustody.test.js`.
JS mirror of what `inv_tyre_item_sync` (DB lane) derives into `tyre_items`. Change both together.

## Principles (owner rule 4)

- One authoritative custody state per physical tyre: strong serial (`isStrongSerial`, mirror of SQL
  `tyre_serial_is_strong`) per country, keyed on `upper(serial)` with spaces removed.
- Derived by **reading** `tyre_records`, `tyre_status_marks` (scrap), store holdings and recorded
  dispositions. Never edits tyre history; carries no money; never feeds CPK. `fitmentCpk`,
  `withOnePricePerTyre`, `tyreKm` and all cost/m3/expense maths are unchanged.
- Conflicting evidence gives state `unknown` + the evidence. Nothing is auto-corrected; the 7 known
  scrapped-yet-active tyres are presented for authorised reconciliation.
- Weak serials (placeholders, DOT codes, sizes, Excel-mangled) are not items; they are returned as
  `weakSerialRows` + a sample, a data-quality backlog.

## State derivation (`deriveCustody`)

| Evidence | State | basis |
|---|---|---|
| Any conflict (below) | `unknown` | `conflict` |
| Active row with no removal date | `fitted` (asset + position of the latest active row) | `active_fitment` |
| Scrap mark, or a row with status Scrapped | `scrapped` | `scrap_mark` / `scrapped_status` |
| Store holding in a store state | that state (`new_stock`, `reserved`, `in_transit`, `reusable`, `quarantine`, `under_repair`, `warranty`) | `store_holding` |
| Removed, recorded disposition dated after the removal | the disposition (`reusable`, `under_repair`, `warranty`, `quarantine`, `scrapped`, `returned_supplier`) | `recorded_disposition` |
| Removed, no decision | `removed_pending` (never assumed reusable) | `removed_no_decision` |

## Conflicts

| type | Rule | Evidence returned |
|---|---|---|
| `scrapped_but_active` | scrap mark or Scrapped row AND an Active unremoved row | marks (date, reason), active rows (id, asset, position, issue/created dates, `createdAfterScrapMark`) |
| `fitted_and_in_stock` | Active unremoved row AND a store holding | active rows, holdings |
| `serial_on_two_assets` | Active unremoved rows on more than one asset | assets, rows |

`custodySummary` counts by state and conflict type for the Tyre inventory section.

## Reuse is not a purchase

- `classifyFitments(records)`: per serial, the earliest fitment is `first_fit` (a purchase); later rows are
  `refit` (reuse); weak serials are `untracked`. `refitCarriesPrice` flags a refit row still holding a price
  while an earlier row is priced (the 30 live candidates in doc 03) - evidence only; CPK's own one-price
  rule is not changed.
- `newTyreDemand(records, { from, to })`: counts first fits only; refits and untracked rows are reported
  separately. Use it for demand forecasts and simulation demand inputs.

## Holding period is not running life

`custodyTimeline(events, { now })` builds segments with `days`, `countsAsRunningLife` (only `fitted`) and
`isStoreHolding`. `fittedDays` and `holdingDays` are reported separately; holding time is never added to
tyre km, running life or CPK.
