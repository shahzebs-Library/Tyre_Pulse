# 20 - Inventory valuation rules

Engine: `src/lib/inventory/valuation.js` (pure, no I/O). Tests: `src/test/inventoryValuation.test.js`.
Binding contract: `07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md`. This file is the specification the SQL
posting function `_inv_post` (20261120100000), its cost-reconciliation hook `_inv_cost_rec_track`
(20261120104000) and `inv_cost_reconcile` (20261120108000) mirror: change all of them together.

> **Owner decision 2026-11-20 (binding).** This replaces the earlier "unpriced units leave first" rule.
> Serialised tyres are valued at their own purchase cost; batch / receipt-tracked items at the recorded
> receipt cost where available; ordinary stock at the weighted average of **properly valued quantity
> only**. Unknown cost is never treated as zero, unpriced units are never consumed first, no proportional
> cost is invented, and nothing becomes valued without an approved cost reconciliation.

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
  (`tyreStockValuation`, `tyre_items.purchase_cost`). The one-price-per-tyre rule on `tyre_records` is
  reused, not re-derived, and `tyre_records` is never written.
- **Batch / receipt-tracked items**: the receipt line's recorded unit cost is what enters the balance;
  it is blended into the average of that balance only as valued quantity.
- **No FIFO/LIFO layers, no standard cost** (overkill for this operation, approved decision 3).

## 3. Unvalued stock (never 0, never consumed first)

A balance holds two buckets: `valuedQty`/`valuedValue` (the average) and `unvaluedQty` (units with no
known cost). A receipt, opening line or adjustment without cost goes to `unvaluedQty`.

- Status per balance: `valued | partially_valued | unvalued | empty`.
- **Outbound policy: VALUED units leave first** at the weighted average of the valued bucket. Only the
  quantity the valued bucket cannot cover leaves as **unvalued**. Nothing is invented for that part:
  the movement records `valued_qty` (moved at known cost), `unvalued_qty` (moved at unknown cost) and
  `value_change` for the valued part only (`null` when nothing valued moved, never 0). Status is
  `valued`, `partially_valued` or `unvalued`.
- Example: 5 at 10 + 3 unpriced, issue 7 -> 5 leave at 10 (`value_change` -50), 2 leave unvalued,
  1 unpriced unit stays on the shelf. The 2 are a consumed reconciliation; the 1 stays an open one.
- **Every unvalued unit has exactly one open record in `inventory_cost_reconciliations`**:
  | Event | Record |
  |---|---|
  | Unpriced receipt / opening / adjustment / return | new, `kind unpriced_inbound`, not consumed |
  | Legacy balance already unvalued at go-live | new, `kind legacy` (seeded once by 104000) |
  | Transfer | the `transfer_out` leg does nothing; the paired `transfer_in` leg MOVES the open records with the units (split when partial). Never a second record. |
  | Issue, scrap, adjustment down, supplier return | the balance's open records become `consumed` (split when partial); a remainder with no record gets a new consumed one |
  | Reversal of such an issue | the consumed record re-opens on the shelf (`kind reversal_return`) |
  | Reversal that takes unvalued units back out | the record is `cancelled` (source `reversal`) |
  | Approved opening batch with a line cost | units it prices are `resolved` (source `opening_batch`, that batch had its own approval); units it removes are `cancelled` |
- **Resolving a record** (`inv_cost_reconcile`, mirror `reconcileCost`): needs an APPROVED
  `cost_reconciliation` approval (`inv_request_approval` carries the proposal `{resolution, unit_cost}`
  plus evidence; `inv_approval_decide` approves it), and capability `stock:financial_post`.
  The resolver can never be the record's creator (the poster of the movement), and no approver can be
  the creator or the preparer (database CHECK + RPC). Outcomes:
  - `resolved`, units still on the shelf: a `cost_assignment` values min(qty, balance unvalued qty);
    anything no longer there is `not_applied_qty`.
  - `resolved`, units already consumed: the consumption value becomes known (`resolved_value`);
    the shelf does not change because the units are gone.
  - `written_off`: the cost is accepted as unknowable; the units stay unvalued, no value is invented.
- `cost_assignment` cannot be posted directly any more (`inv_post_movement` refuses it): it only
  exists as the posting step of an approved reconciliation.
- Owned value headline is only a measurement when every owned line is valued; otherwise
  `value = null`, reason `unvalued_stock_present`, with `valuedValue` and `pricedPct` shown beside it.
  The finance view `v_inv_valuation` returns `valued_qty`, `unvalued_qty`, `valued_amount` (the valued
  PART, money NULL without `stock:view_value`), `currency`, `valuation_complete` and
  `open_reconciliations`. **A partial value is never labelled a total.** The engine mirror is
  `summarizeValuation().byCurrency[c].owned.{valuedAmount, valuationComplete}`.

## 4. Movement types and their effect on value

| Type | Qty | Value effect | Notes |
|---|---|---|---|
| `opening` | + | at line cost; no cost -> unvalued | Only from an approved opening-balance batch (owner rule 2) |
| `receipt` | + | `qty x unit_cost`, blends WAC | Unpriced receipt -> unvalued |
| `issue` | - | valued units first at the current avg; remainder unvalued -> reconciliation | Consignment issue also returns an informational consumption record (section 6) |
| `issue_return` | + | at the cost it was issued at; else current avg; else unvalued | |
| `transfer_out` / `transfer_in` | -/+ | source average travels with the units | `transfer()` does both legs; unvalued units stay unvalued; refused across currencies |
| `supplier_return` | - | out at current avg | `creditUnitCost` gives a **purchase price variance** reported separately, never added to stock |
| `supplier_credit` | 0 | reduces valued value | Cannot make value negative; excess = variance `supplier_credit_exceeds_stock_value` |
| `landed_cost` | 0 | adds to valued value (raises avg) | If no valued units remain, the amount is a variance against consumed stock, not stock value |
| `cost_assignment` | 0 | values N unvalued units | Only from an approved cost reconciliation; refused above the unvalued qty |
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

## 8. Decided and open points

- **Decided 2026-11-20 (owner):** outbound takes valued units first; unpriced units are never consumed
  first; no proportional cost is ever invented; unknown cost becomes known only through an approved
  reconciliation. The earlier "unvalued first" policy and its alternative "proportional" are both
  withdrawn.
- Open: opening balance valuation basis (e.g. grid median per item, doc 04 section 4.6) stays a batch
  decision with approval; the engine only values what the approved batch states.
- Open: which approval policy routes `inventory_cost_reconciliation` (finance roles). Until one is
  published, the safe default applies (an elevated approver who is not the creator or preparer).
