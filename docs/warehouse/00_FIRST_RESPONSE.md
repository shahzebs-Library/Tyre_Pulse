# Tyre Pulse warehouse: first response (audit before any code change)

Measured on the live database (project jhssdmeruxtrlqnwfksc) and on `origin/main` at `33d813f0`, 2026-11-23.
Nothing was written to production. Every number below is a query result, not an estimate.

---

## 1. Architecture actually found on main

Web: one hub, `/stock?section=…` (`src/components/inventory/InventoryHub.jsx`), with sections for Overview, the Stock
Register (still the original `src/pages/StockManagement.jsx`), Material Master, Physical inventory, Locations,
Movements, Approvals, Valuation, Discrepancies, Audits, Reports, plus separate pages for Procurement, Requisitions,
Goods Receipt, Store Material Issue, Suppliers, Contracts, Parts Catalog and Parts Requests.

Database (rows today):

| Area | Table | Rows | State |
|---|---|---:|---|
| Stock on hand | `stock_records` (read through view `v_inv_balances`) | 5,583 | Live. Loaded from Book2 |
| Stock ledger | `stock_movements` | 5,619 | 5,533 are `opening`; only 1 consumption movement |
| ERP item master | `material_master` | 23,274 | KSA 10,555 / UAE 9,321 / Egypt 3,398. Cost classification |
| Governed catalogue | `material_canonical` | 3,508 | All active. One row per company SKU from Book2 |
| Catalogue to ERP link | `material_canonical_items` | **0** | **Empty** |
| Variants (brand / genuine) | `material_variants` | 1,335 | 1,313 `unknown`, 20 genuine, 2 aftermarket |
| Aliases | `material_aliases` | 5,198 | 3,508 ERP SKU + 1,690 OEM numbers |
| OEM manuals | `oem_parts_entries` | 1,652 | Parsed manual rows; `oem_part_references` = 0 |
| Locations | `inventory_locations` | 221 | |
| ERP issues (real consumption) | `parts_consumption` | 218,776 | 88,948 KSA lines carry a catalogue code |
| Procurement | `suppliers`, `requisitions`, `purchase_orders`, `supplier_invoices` | 0 each | Built, never used |
| Receiving / issue / transfer | `goods_receipts` 1, `material_issues` 0, `stock_transfers` 1, `stock_reservations` 0 | | Built, barely used |
| Counting | `physical_inventory_sessions` 1, `inventory_count_lines` 0 | | |
| Dead legacy | `stock`, `materials`, `parts_catalog` | 0 each | Not read by the hub |

## 2. Mismatches and disconnected modules (with evidence)

1. **Two item masters, not joined.** `stock_records.item_id` points to `material_master` (5,540 of 5,583 rows). The
   Material Master page reads `material_canonical`. The table meant to join them, `material_canonical_items`, holds
   0 rows. The two only meet by text: `item_code = company_sku`, which matches 3,507 of 3,508.
2. **The register does not show Material Master details.** It shows the free-text `description`. Brand is filled on
   only 209 of 5,583 rows, although the catalogue knows it through the company SKU on 5,532 rows.
3. **Speed of use, days left and action show "None recorded" / N/A on every row.** They are computed from
   `stock_movements`, which holds 1 consumption movement. The real issues are the 218,776 ERP lines in
   `parts_consumption`, which the register never reads.
4. **Reorder status is meaningless:** 5,568 of 5,583 rows have min and critical level 0. Management action is empty
   on all 5,583.
5. **43 stock rows have no item code** (e.g. RIY-MET, QIDDIYA-LOWER PLATEAU, DIRIYAH), so they cannot link to
   anything.
6. **The same tyre is spelt several ways**: "385/65R22.5 Doublecoin", "385/65R22.5 Double coin",
   "TIRE 315/80 R22.5 - RR99 DOUBLECOIN". With no code, the register cannot group them.
7. **Genuine / local / aftermarket is mostly unknown:** 1,313 of 1,335 variants. Brand is missing on 3,115 of 3,508
   catalogue items.
8. **OEM manuals are not cross-referenced:** 1,652 manual rows, 0 `oem_part_references`.
9. **Procurement is a shell.** Suppliers, requisitions, POs and invoices have 0 rows, so receiving cannot trace back
   to an order.

## 3. Why Material Master and warehouse stock differ

- The data agrees: 3,507 of 3,508 catalogue items have stock, and your account reads it. Tested as you: 25
  materials returned 39 positive stock rows.
- **"Stock not showing" on Material Master is a stale browser build, not a data fault.** In the last 24 hours the
  server received no stock request from that page. The only stock requests came from the register, about once a
  minute. #606, which added the stock column, is merged and live. A full reload (close every tab, or accept the
  "new version" prompt) fixes it. I will confirm this in a browser.
- The structural difference is item 2.1: stock is keyed to the ERP code, the catalogue to the company SKU. Today
  they coincide by text. The first code that differs will silently drop out of Material Master.

## 4. Proposed canonical material and OEM cross-reference design

- **One canonical item = `material_canonical`** (company SKU). It owns brand, category and specs.
- **`material_canonical_items`** links each canonical item to its ERP code per country (`material_master` row).
  Stock, consumption and cost reach Material Master through this link, never by text matching.
- **`material_variants`** = brand / manufacturer / genuine-local-aftermarket per canonical item. The `-O` suffix is
  not evidence of OEM. Only "Original" / "ORG" in the description, or a verified OEM number, counts as genuine.
- **`material_aliases`** = every other identifier (OEM part number, supplier code, old code), each with a source and
  a verified flag.
- **`oem_part_references`** links a parsed manual row (`oem_parts_entries`) to a canonical item. These links are
  proposed by matching, and they apply only after a person accepts them. No automatic fuzzy match writes to
  production (your rule).

## 5. WMS module and process map

Requisition → approval → purchase order → goods receipt (against PO, to a location) → put-away → stock on hand →
reservation (work order) → material issue (to job card / asset) → return / transfer → cycle count → discrepancy →
adjustment (approved) → valuation.

Every step has a table already. Only "stock on hand" and "opening balance" hold real data. Consumption arrives from
the ERP (`parts_consumption`), not from in-app issues.

## 6. Existing functions to keep, not rebuild

- The inventory hub and its sections.
- The opening-balance pipeline, including the owner override (`inv_owner_override_post`).
- `material_canonical`, `material_variants` and `material_aliases`, with the propose → approve flow.
- `v_inv_balances` / `v_inv_valuation`.
- Physical inventory sessions and photos, locations with bulk setup, and the movement ledger with its triggers.
- The approval tables (`inventory_approval_*`).
- `parts_consumption` and its classifier, which stays the cost source.
- The OEM manual parser (`oem_parts_entries`).

## 7. Schema and migration changes needed

1. **Data:** populate `material_canonical_items` from the 3,507 exact code matches. Additive, reversible by batch
   id. This is a production write.
2. **Read-only view:** `v_inv_register` = balances + canonical item (brand, category, genuine class, OEM number) +
   12-month issue rate from `parts_consumption`. No write.
3. **Data:** brand normalisation through aliases (e.g. Doublecoin = Double Coin), stored as an alias, never by
   rewriting descriptions.
4. Later: reorder levels (computed suggestion, set by a person), `oem_part_references` review queue, and supplier /
   PO seeding.

## 8. Safest development order

- **WP0, no production writes.**
  - Register shows Material Master details (code, brand, category, genuine class, OEM number) by reading the
    catalogue client-side through the code match.
  - Speed of use and days left come from `parts_consumption`.
  - Rows with no code are flagged.
  - Verify the Material Master stock column in a browser.
- **WP1.** Populate the canonical link (needs your OK), then switch both screens to the link.
- **WP2.** Material Master reconciliation and OEM cross-reference (your recommended first package). This includes
  the brand / genuine review queue and the OEM manual matching queue.
- **WP3.** Reorder levels from real consumption, approved by a person.
- **WP4.** Procurement chain: suppliers, requisition, PO, receipt against PO.
- **WP5.** Issues, returns, transfers and counts wired to the ledger, with Store Keeper site scope enforced in RLS.

## 9. What can be done without production writes

- All of WP0.
- A read-only `v_inv_register` view. It is DDL, so it still needs your OK, but it changes no data.
- The OEM matching proposals, computed and shown for review without saving.
- Every report and filter change.

## 10. Decisions that need your approval

1. Make `material_canonical` the single item master, linked to the ERP codes. Recommended.
2. Write the 3,507 exact-match links into `material_canonical_items`. Production write, reversible.
3. Reorder levels: computed from 12 months of issues and approved per item, or entered by you?
4. Brand spelling merges (Doublecoin / Double coin, and others): approve as aliases?
5. The 43 stock rows with no item code: you supply the codes, or I propose matches for you to accept?
6. Where should genuine / local / aftermarket come from for the 1,313 unknown variants (supplier invoices, OEM
   number, manual review)?
7. Store Keeper site scope: confirm each keeper's sites before it is enforced in the database.

No merge, deploy or production write will happen without your word on the item concerned.
