# 20 - Inventory valuation rules

Engine: `src/lib/inventory/valuation.js` (pure, no I/O). Tests: `src/test/inventoryValuation.test.js`.
Binding contract: `07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md`. This file is the specification the SQL
posting function `_inv_post` (20261120100000), its cost-reconciliation hook `_inv_cost_rec_track`
(20261120104000) and `inv_cost_reconcile` (20261120108000) mirror: change all of them together.

> **Owner decision 2026-11-20 (binding).** This replaces the earlier "unpriced units leave first" rule.
> Serialised tyres are valued at their own purchase cost; batch / receipt-tracked items at the recorded
> receipt cost where available; ordinary stock at the weighted average of **properly valued quantity
> only**. Unknown cost is never treated as zero, no proportional cost is invented, and nothing becomes
> valued without an approved cost reconciliation. In the owner's words: *"Require cost reconciliation
> rather than inventing a price or silently choosing which units leave first."* **No order is assumed**
> when a balance holds both valued and unvalued units - not priced-first, not unpriced-first, not
> proportional (section 3).

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
  it is blended into the average of that balance only as valued quantity. An outbound movement of a
  `serial_tracked` or `lot_tracked` item names the receipt it comes from (`source_receipt_movement_id`)
  and leaves at that receipt's actual cost (or unvalued if that receipt was unpriced), so it is never
  ambiguous. On a mixed balance without a named receipt it is refused.
- **No FIFO/LIFO layers, no standard cost** (overkill for this operation, approved decision 3).

## 3. Unvalued stock (never 0) and no assumed order

A balance holds two buckets: `valuedQty`/`valuedValue` (the average) and `unvaluedQty` (units with no
known cost). A receipt, opening line or adjustment without cost goes to `unvaluedQty`.

- Status per balance: `pending_allocation | valued | partially_valued | unvalued | empty`.
- **Outbound policy (owner decision 2026-11-20): nothing is assumed about which units left.** For an
  issue, transfer out, scrap, adjustment down or supplier return of `q` from a balance:
  - `maxValued = min(onHand, valuedQty + pendingInQty)`, `maxUnvalued = min(onHand, unvaluedQty + pendingInQty)`
    (the most units of each kind that can be on the shelf);
  - `certainValued = max(0, q - maxUnvalued)` leaves at the weighted average (`value_change`);
  - `certainUnvalued = max(0, q - maxValued)` leaves unvalued with a cost reconciliation;
  - `ambiguous = q - certainValued - certainUnvalued` posts **no value change**.
  This is the coordinator's `ambiguous = min(q, unvalued on hand)` /
  `certain valued = max(0, q - unvalued on hand)`, refined only where it can be proved: when `q` is more
  than the valued units on hand the excess is certainly unvalued, so issuing a whole mixed balance is
  never ambiguous.
- A balance holding **only** valued or **only** unvalued units (and nothing undecided) is never ambiguous.
- The ambiguous part is carried as **pending allocation**: the quantity drops at once (never negative),
  but `valuedQty`/`valuedValue`/`unvaluedQty` keep those units and `pendingOutQty`
  (`stock_records.pending_allocation_out_qty`) counts them. A transfer destination receives them as
  `pendingInQty` (`pending_allocation_in_qty`), in neither bucket.
  Invariant: `qty_on_hand + pending_out - pending_in = valued_qty + unvalued_qty`.
- One record of kind **`issue_allocation`** in `inventory_cost_reconciliations` holds the ambiguous
  quantity (`unvalued_qty` column, shown as `allocation_qty`), the movement, the balance split before it
  (`snapshot`) and, for a transfer, where the units now sit (`holder_stock_id`).
- **Deciding it** (`inv_cost_reconcile`, mirror `resolveAllocation`): `inv_request_approval` carries
  `proposal {valued_qty}` (how many of the undecided units were valued) plus evidence (batch, receipt,
  GRN) or a reason; same approval rule and separation of duties as every cost reconciliation (the issuer
  can never decide it; approvers are never the issuer or the proposer). Never written off: the split has
  to be decided. The split must fit the buckets still holding the units (`valued_qty <= balance valued`,
  `undecided - valued_qty <= balance unvalued`); a split needing units that arrived undecided waits for
  that upstream allocation. Only then a linked **`cost_allocation`** movement posts the value on the
  source balance (and, for a transfer, a second one at the holder); the ledger stays append-only. The
  undecided-unvalued part becomes ordinary consumed (issue) or moved (transfer) reconciliations.
- While a balance has pending allocation, an in-stock cost reconciliation and an opening correction are
  refused (they could value or remove a unit that already left).
- Examples: 5 at 10 + 3 unpriced, issue 4 -> 1 certainly valued (`value_change` -10), 3 undecided
  (pending allocation, no value). Issue 7 -> 4 valued (-40), 2 unvalued (consumed reconciliation),
  1 undecided. Issue 8 -> 5 valued (-50), 3 unvalued, nothing undecided.
- **Every unvalued unit has exactly one open record in `inventory_cost_reconciliations`**:
  | Event | Record |
  |---|---|
  | Unpriced receipt / opening / adjustment / return | new, `kind unpriced_inbound`, not consumed |
  | Legacy balance already unvalued at go-live | new, `kind legacy` (seeded once by 104000) |
  | Transfer | the `transfer_out` leg does nothing; the paired `transfer_in` leg MOVES the open records with the units (split when partial). Never a second record. |
  | Issue, scrap, adjustment down, supplier return | the balance's open records become `consumed` (split when partial); a remainder with no record gets a new consumed one |
  | Reversal of such an issue | the consumed record re-opens on the shelf (`kind reversal_return`) |
  | Undecided part of an outbound | one `issue_allocation` record (not an unvalued-unit record) |
  | Reversal of a movement with an open allocation | the allocation is `cancelled`; a decided one is reversed together with its `cost_allocation` |
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
- Owned value headline is only a measurement when every owned line is valued and nothing is undecided;
  otherwise `value = null`, reason `pending_allocation_present` or `unvalued_stock_present`, with
  `valuedValue` and `pricedPct` shown beside it. The finance view `v_inv_valuation` returns `valued_qty`,
  `unvalued_qty`, `pending_allocation_qty` (+ `_out_qty`, `_in_qty`), `valued_amount` (the valued PART,
  money NULL without `stock:view_value`), `currency`, `valuation_complete` (false while anything is
  unvalued OR undecided), `open_reconciliations`, `open_allocations`. **A partial value is never labelled
  a total.** The engine mirror is
  `summarizeValuation().byCurrency[c].owned.{valuedAmount, valuationComplete, pendingAllocationQty}`.

## 4. Movement types and their effect on value

| Type | Qty | Value effect | Notes |
|---|---|---|---|
| `opening` | + | at line cost; no cost -> unvalued | Only from an approved opening-balance batch (owner rule 2) |
| `receipt` | + | `qty x unit_cost`, blends WAC | Unpriced receipt -> unvalued |
| `issue` | - | certainly valued part at the current avg; certainly unvalued part -> reconciliation; undecided part -> pending allocation, no value | Consignment issue also returns an informational consumption record (section 6) |
| `issue_return` | + | at the cost it was issued at; else current avg; else unvalued | |
| `transfer_out` / `transfer_in` | -/+ | certainly valued value travels with the units | `transfer()` does both legs; unvalued units stay unvalued; undecided units arrive as pending allocation; refused across currencies |
| `supplier_return` | - | out at current avg | `creditUnitCost` gives a **purchase price variance** reported separately, never added to stock |
| `supplier_credit` | 0 | reduces valued value | Cannot make value negative; excess = variance `supplier_credit_exceeds_stock_value` |
| `landed_cost` | 0 | adds to valued value (raises avg) | If no valued units remain, the amount is a variance against consumed stock, not stock value |
| `cost_assignment` | 0 | values N unvalued units | Only from an approved cost reconciliation; refused above the unvalued qty and while a split is pending |
| `cost_allocation` | 0 | value of the units decided valued (source -, holder +) | Only from an approved issue allocation; linked to the movement it decides (`source_doc_id`) |
| `adjustment_up` | + | at current avg (or explicit cost); no avg -> unvalued | Approved count adjustment only; a count variance, never "cost" |
| `adjustment_down` | - | at current avg | |
| `scrap` | - | at current avg | Write-off value is reported, never posted |
| `reversal` | -orig | exact negation of the original (qty, value, unvalued qty, pending allocation; plus its decided `cost_allocation`) | Refused if units already left (no negative stock). Residual value on an emptied balance or negative value -> variance `reversal_residual` / `reversal_negative_value` |

Landed cost allocation (`allocateLandedCost`): basis `value` (default), `qty` or `weight`; shares exact to
the cent with the remainder on the largest line; lines with no basis are listed in `excluded`.

## 5. Refusals (balance returned unchanged)

- `insufficient_stock` - would go below zero. **No negative physical stock, no override** (owner rule 1).
  The shortage quantity is returned so the caller raises a `stock_exceptions` row instead.
- `currency_mismatch`, `cross_currency_transfer` - currencies are never blended; conversion needs an
  approved FX rate and a named policy (V380), outside this engine.
- `unknown_movement_type`, `invalid_quantity`, `invalid_value`, `invalid_unit_cost`,
  `exceeds_unvalued_qty`, `missing_original_movement`, `source_receipt_required` (tracked item on a mixed
  balance), `allocation_pending` (in-stock cost while a split is undecided), `split_not_possible` /
  `upstream_allocation_open` (a decided split that does not fit the buckets).

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

- **Decided 2026-11-20 (owner):** no order is assumed on a mixed balance (not priced-first, not
  unpriced-first, not proportional); only what arithmetic proves posts, the rest is an issue allocation a
  person decides with evidence; unknown cost becomes known only through an approved reconciliation.
  The earlier "unvalued first" and the interim "valued first" rules are withdrawn.
- Open: opening balance valuation basis (e.g. grid median per item, doc 04 section 4.6) stays a batch
  decision with approval; the engine only values what the approved batch states.
- Open: which approval policy routes `inventory_cost_reconciliation` (finance roles). Until one is
  published, the safe default applies (an elevated approver who is not the creator or preparer).
