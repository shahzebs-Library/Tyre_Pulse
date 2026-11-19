# 20 - Inventory valuation rules

Engine: `src/lib/inventory/valuation.js` (pure, no I/O). Tests: `src/test/inventoryValuation.test.js`.
Binding contract: `07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md`. This file is the specification the SQL
posting function `inv_post_movement` must mirror (DB lane): change both together.

## 1. Two ledgers, never summed

| Ledger | Question it answers | Readers |
|---|---|---|
| `parts_consumption` (ERP expense grid) | What did maintenance cost? (P&L, CPK, cost per m3) | `governedCost`, `costSummary`, every CPK RPC. Unchanged. |
| `stock_movements.value_change` + balances | What is the stock on the shelf worth? (balance sheet) | Inventory Control Center only |

- Inventory never writes to `parts_consumption` and never creates accounting postings or liabilities
  (owner rule 6). Financial postings stay in the ERP.
- Guard: `inventoryValuation.test.js` "separation guards" fails if any cost reader / CPK file imports
  `lib/inventory`, or if an inventory engine imports supabase or the service layer.

## 2. Method

- **Perpetual weighted average cost (WAC)** per balance key
  `(org, country, location, item, condition, ownership, owner_supplier_id)`, in the balance's own currency.
  Receipt blend: `avg = (valued_value + qty_in * unit_cost) / (valued_qty + qty_in)` (kept as running value
  totals, so no rounding drift; unit cost to 4 dp, money to 2 dp).
- **Specific identification for serial-tracked tyres**: each tyre carries its own purchase price
  (`tyreStockValuation`). The one-price-per-tyre rule on `tyre_records` is reused, not re-derived.
- **No FIFO/LIFO layers, no standard cost** (overkill for this operation, approved decision 3).

## 3. Unvalued stock (never 0)

A balance holds two buckets: `valuedQty`/`valuedValue` (the average) and `unvaluedQty` (units with no
known cost). A receipt or opening line without cost goes to `unvaluedQty`.

- Status per balance: `valued | partially_valued | unvalued | empty`.
- **Outbound policy: unvalued units leave first**, then valued units at the average. The remaining
  stock therefore keeps the cost basis that is actually known. An issue that consumed only unvalued
  units has `value_change = null` (not 0) and status `unvalued`; a mix is `partially_valued`.
- `cost_assignment` later gives a known cost to unvalued units (e.g. invoice arrives).
- Owned value headline is only a measurement when every owned line is valued; otherwise
  `value = null`, reason `unvalued_stock_present`, with `valuedValue` and `pricedPct` shown beside it.

## 4. Movement types and their effect on value

| Type | Qty | Value effect | Notes |
|---|---|---|---|
| `opening` | + | at line cost; no cost -> unvalued | Only from an approved opening-balance batch (owner rule 2) |
| `receipt` | + | `qty x unit_cost`, blends WAC | Unpriced receipt -> unvalued |
| `issue` | - | `qty x current avg` (unvalued first) | Consignment issue also returns an informational consumption record (section 6) |
| `issue_return` | + | at the cost it was issued at; else current avg; else unvalued | |
| `transfer_out` / `transfer_in` | -/+ | source average travels with the units | `transfer()` does both legs; unvalued units stay unvalued; refused across currencies |
| `supplier_return` | - | out at current avg | `creditUnitCost` gives a **purchase price variance** reported separately, never added to stock |
| `supplier_credit` | 0 | reduces valued value | Cannot make value negative; excess = variance `supplier_credit_exceeds_stock_value` |
| `landed_cost` | 0 | adds to valued value (raises avg) | If no valued units remain, the amount is a variance against consumed stock, not stock value |
| `cost_assignment` | 0 | values N unvalued units | Refused above the unvalued qty |
| `adjustment_up` | + | at current avg (or explicit cost); no avg -> unvalued | Approved count adjustment only; a count variance, never "cost" |
| `adjustment_down` | - | at current avg | |
| `scrap` | - | at current avg | Write-off value is reported, never posted |
| `reversal` | -orig | exact negation of the original (qty, value, unvalued qty) | Refused if units already left (no negative stock). Residual value on an emptied balance or negative value -> variance `reversal_residual` / `reversal_negative_value` |

Landed cost allocation (`allocateLandedCost`): basis `value` (default), `qty` or `weight`; shares exact to
the cent with the remainder on the largest line; lines with no basis are listed in `excluded`.

## 5. Refusals (balance returned unchanged)

- `insufficient_stock` - would go below zero. **No negative physical stock, no override** (owner rule 1).
  The shortage quantity is returned so the caller raises a `stock_exceptions` row instead.
- `currency_mismatch`, `cross_currency_transfer` - currencies are never blended; conversion needs an
  approved FX rate and a named policy (V380), outside this engine.
- `unknown_movement_type`, `invalid_quantity`, `invalid_value`, `invalid_unit_cost`,
  `exceeds_unvalued_qty`, `missing_original_movement`.

## 6. Ownership

| Ownership | Quantity | Value |
|---|---|---|
| `owned` | counted | WAC, included in inventory value |
| `consignment` | counted | shown separately at the agreed unit price; **excluded** from owned value |
| `supplier` (custody) | counted | quantity only |

A consignment issue returns `consignmentConsumption` (supplier, qty, agreed price) for supplier-invoice
matching. It is explicitly not a posting and not a liability record.

## 7. Reports built on the engine

- `summarizeValuation(rows)` - per currency: owned (valued/unvalued/partial lines, value, pricedPct),
  consignment at agreed price, supplier custody qty. `mixedCurrency` flag; rows with no currency counted
  apart.
- `adjustmentValue(movements)` - gross gain, gross loss, net, absolute per currency; unvalued adjustments
  counted, not zeroed.
- `ageingBuckets(rows, { now, basis })` - 0-90 / 91-180 / 181-365 / over 365 days by last receipt (or last
  issue); no date -> `unknown`, never the newest bucket.
- `exposure(rows, { now, ledgerStartAt })` - dead (no issue 365 d), slow (180-364 d), obsolete (item status
  obsolete), excess (above `max_qty`). Item younger than 180 d -> `too_new`; open reservation -> active;
  no issue on record is dead only when the ledger covers the window, otherwise `slow`/`unknown`.
- `tyreStockValuation(items)` - stock tyres (new, reserved, in transit, quarantine) at own cost. Used tyres
  (reusable, removed pending, repair, warranty) are listed at original cost but **not** stock value by
  default: their purchase is already consumed into CPK, counting them again would double count.

## 8. Open points for the owner

- Unvalued-first outbound is a policy choice (keeps the known basis). Alternative: proportional. Change
  here and in `inv_post_movement` together.
- Opening balance valuation basis (e.g. grid median per item, doc 04 section 4.6) is a batch decision with
  approval; the engine only values what the approved batch states.
