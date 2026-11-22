# 21 - Inventory KPI catalogue

Engine: `src/lib/inventory/kpi.js` (`KPI_CATALOGUE`, `KPI_BY_ID` + one function per KPI).
Tests: `src/test/inventoryKpi.test.js`. Each catalogue row becomes a `metric_registry` row + `metric_versions`
v1 (WEB/DB lanes) and is mounted with `ExplainThisNumber`. Keep this table and `KPI_CATALOGUE` in sync.

## Common rules

- Result shape: `{ id, value, unit, reason, ...detail }`. `value: null` always carries a `reason`.
  A non-measurable KPI is never rendered as 0 or 100%.
- Zero denominator -> null. Mixed units of measure on a quantity sum -> null, reason `mixed_units`.
  Mixed currency -> headline null, reason `mixed_currency`, per-currency values in `byCurrency`.
- Missing cost -> value null (count of unvalued lines given); never priced at 0.
- Gross shortage and gross excess always separate; net and absolute are both given.
- Inventory value is balance-sheet only; no KPI here reads or feeds `parts_consumption`, CPK or cost per m3.
  Issue VALUE for turnover comes from the inventory ledger's own valued issues.

## Catalogue

| id | Function | Formula | Unit | Scope | Period | Source | Null when |
|---|---|---|---|---|---|---|---|
| inv_accuracy_exact_line | `countAccuracy().exactLine` | lines with abs(counted - expected) <= tolerance / lines counted (serial-tracked tolerance always 0) | % | audit / location | per approved count | count lines vs snapshot lines | no counted lines |
| inv_accuracy_quantity | `countAccuracy().quantity` | 1 - sum abs(counted - expected) / sum expected | % | audit | per count | count lines | expected total 0; mixed UoM |
| inv_accuracy_serial | `serialAccuracy()` | matched / (expected union found); missing and unexpected listed | % | serial audit | per count | serial count lines | nothing expected or found |
| inv_gross_shortage | `countAccuracy().grossShortage` | sum max(expected - counted, 0) qty, x unit cost per currency | qty + currency | audit | per count | count lines x WAC | qty: mixed UoM; value: any short line unvalued |
| inv_gross_excess | `countAccuracy().grossExcess` | sum max(counted - expected, 0) | qty + currency | audit | per count | count lines x WAC | as above |
| inv_count_completion | `countCompletion()` | lines counted or confirmed zero / lines in scope | % | audit | audit lifetime | snapshot vs count lines | no lines in scope |
| inv_stock_value | `inventoryValue().value` | sum valued value of owned stock | currency | org / country / site / location | as at | balances | any owned line unvalued; mixed currency |
| inv_unvalued_stock | `inventoryValue().unvalued` | owned lines (and qty) with unknown cost | lines | as above | as at | balances | never (0 is real) |
| inv_adjustment_value | `adjustmentValueKpi()` | gross gain, gross loss, net, absolute | currency | org / site | period | adjustment movements | no adjustments; any adjustment unvalued |
| inv_turnover | `turnoverAndDio().turnover` | issue value / average month-end stock value | times | org / country | 12 months | valued issues + month-end snapshots | < 3 complete snapshots; average 0; any issue unvalued; issue coverage < 80%; mixed currency |
| inv_dio | `turnoverAndDio().dio` | period days / turnover | days | as turnover | as turnover | turnover | turnover null or 0 |
| inv_dead_stock | `exposureKpis().dead` | owned stock with no issue in 365 d, no open reservation | currency + qty | owned | as at | balances + last issue | item too new / ledger too short -> line unknown, not dead; value null if unvalued qty |
| inv_slow_stock | `exposureKpis().slow` | no issue in 180-364 d | currency + qty | owned | as at | as dead | as dead |
| inv_excess_stock | `exposureKpis().excess` | qty above max_qty x WAC | currency + qty | owned | as at | balances + max_qty | lines without max_qty counted as unknown |
| inv_obsolescence_exposure | `exposureKpis().obsolescence` | value of owned stock whose item is obsolete | currency | owned | as at | balances + material status | unvalued qty present |
| inv_stockout_frequency | `stockoutFrequency()` | requests not met from stock at request time / requests with known outcome | % | site / item | period | requests / reservations | no request with a known outcome |
| inv_critical_availability | `criticalAvailability()` | vital items with available >= safety stock (> 0 if unset) / vital items | % | site | as at | balances + VED + safety stock | no vital items |
| inv_supplier_otif | `supplierDeliveryPerformance()` | lines on time AND in full / lines due (received, or past promised date) | % | supplier | period | PO lines + receipt lines | no line due |
| inv_lead_time_variance | `leadTimeVariance()` | mean(actual lead days - agreed lead days); std dev | days | supplier | period | PO ordered_at, receipt received_at, agreement | no received line with an agreed lead time |
| inv_discrepancies | `discrepancyKpis()` | count, open, by category, by status; shortage and excess value per currency | count + currency | audit / site | period | inventory_discrepancies | value: any impact unvalued |
| inv_outstanding_po_qty | `outstandingPoQty()` | sum max(ordered - received, 0) on open lines; value at PO price | qty + currency | item / supplier | as at | PO lines | qty: mixed UoM |
| inv_consignment_utilisation | `consignmentUtilisation()` | consigned qty issued / average consigned qty held; held / agreed max | times / % | supplier agreement | period | consignment movements + agreement | no consigned stock held |
| inv_emergency_purchase_rate | `emergencyPurchaseRate()` | emergency POs / POs; emergency value share per currency | % | org / site | period | POs (cancelled excluded) | no POs |
| inv_reserved_not_issued | `reservedNotIssued()` | open reserved qty not issued, older than N days (default 14) | qty + currency | site / work order | as at | reservations | value: any line unvalued |
| inv_purchase_avoidance | `purchaseAvoidance()` | requests met from stock or reusable stock / resolved requests; BOOK value of stock used | % + currency | org / site | period | requests and fulfilment | no resolved requests |

## Wording rules for surfaces

- Purchase avoidance value is labelled **"Book value of stock used instead of buying (not a saving)"**.
- Turnover / DIO show the reason when null (e.g. "Needs 3 complete month-end values").
- Dead stock shows `tooNewLines` and `unknownLines` beside the value so absence of history is visible.
- A vital (V) item that does not move is a critical insurance spare (doc 23), not dead stock; surfaces
  should show the classification next to the dead/slow figure.
