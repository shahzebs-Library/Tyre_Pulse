# Warehouse acceptance test, live database, all rolled back (2026-11-24)

Every scenario ran inside one transaction that was rolled back, as real users (owner super admin, a KSA Store
Keeper, a Manager, a Driver), through the same database functions the web app calls. No data changed. Table
counts before and after were identical (suppliers 0, requisitions 0, purchase_orders 0, goods_receipts 1,
stock_movements 5,619, material_issues 0, stock_transfers 1, stock_records 5,583; total qty on hand 129,673.55).
Side effect: sequences do not roll back, so `po_seq` advanced 1 -> 4 and the next PO number skips a few.

## What works (pass)

- Purchasing: requisition by Store Keeper; Manager without procure right cannot approve; PO with a real line;
  partial receipt (20 -> 24, PO Partial Delivery) and full receipt (PO Delivered); idempotent replay; over-receipt
  on a PO line refused; receipt to a location at another site refused; ledger equals balance after every step.
- Issue / reserve: reserve, release, over-release refused, issue against a reservation consumes it and records the
  job card, shortage refused (no negative stock), negative qty refused, Driver refused, Store Keeper adjustment refused.
- Transfers: dispatch, over-receive refused, partial receive, return remaining, receive after completion refused.
- Store Keeper site scope is enforced by the server (narrowed to NHC: dispatch to RIY-MET refused, issue at NHC allowed).

## Defects found

| # | Defect | Fix owner |
|---|---|---|
| D1 | Receipt against a Draft PO is accepted and moves it Draft -> Partial Delivery | WP4 migration |
| D2 | A receipt line with a PO but no PO line skips the ordered-qty check (over-receipt on a Delivered PO); a zero-line PO becomes Delivered | WP4 migration |
| D3 | `inv_post_movement` accepts a bare `receipt` from a Store Keeper (stock with no GRN/PO) | WP5 migration |
| D4 | `issue_return` is unbounded (+50 against a job card issued 3) | WP5 migration |
| D5 | The same person can raise and approve a requisition, and create and approve a PO | WP4 migration |
| D6 | Retrying a successful issue made against a reservation fails with "idempotency key already used" | WP5 migration |
| D7 | Material issue slip lines accept unknown item codes and any quantity | WP5 migration |

Minor: approvals refused by row security update 0 rows with no message; "rejected > received" shows a raw
constraint error; a return on a mixed valued/unvalued line was valued at average cost with no cost supplied
(check against the valuation rules).

Known gaps confirmed: receipt against Draft PO; site-scoped Store Keeper cannot dispatch across sites; a material
issue slip does not move stock.

Pre-existing data: 7 demo-org stock lines hold quantity with no ledger rows; 33 lines have `stock_qty` different
from `qty_on_hand`.
