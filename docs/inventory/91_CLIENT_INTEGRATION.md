# 91 - Client integration: web, reports and Flutter against the DB contract

Lane: client integration, Inventory Control & Audit. Server contract:
`docs/inventory/10_DB_IMPLEMENTATION.md` (DB lane, aligned with commits `01788fa1` and `b381cdcf`).
Branch `claude/inventory-upgrade-7rxp2t`. **Nothing here was applied to any database,
deployed, or merged to main.** Every migration is still in `supabase/pending_migrations/`,
so in production the web screens show the honest "not set up yet" state until the owner
applies them.

## 1. Section -> view / RPC map (web, `src/components/inventory/`, service `src/lib/api/inventory.js`)

| Hub section | Reads | Writes (all `p_payload` jsonb + `idempotency_key`) |
|---|---|---|
| Overview | `v_inv_balances`, `inventory_audits`, `v_inv_discrepancies`, `v_inv_adjustments` (`proposed`), `v_inv_custody_conflicts`, `v_inv_opening_batches` (`submitted`) | none |
| Register | `v_inv_balances` | none |
| Locations | `inventory_locations` | `inv_location_upsert` |
| Movements > Ledger | `v_inv_movements` | `inv_reverse_movement` |
| Movements > Transfers | `stock_transfers` + `stock_transfer_lines(*, itm:material_master(item_code, item_name))`, ordered by `dispatched_at` | `inv_transfer_dispatch`, `inv_transfer_receive` |
| Receiving & issue | `material_master` (item search), `v_inv_balances` (stock search) | `inv_receive_goods`, `inv_reserve`, `inv_issue` |
| Audits | `inventory_audits`, `inv_audit_counter_view` (blind), `inventory_audit_snapshot_lines` + `inventory_count_lines` (FK embeds for codes) | `inv_audit_create/schedule/start/close`, `inv_count_submit`, `inv_audit_reconcile`, `inv_request_approval(recount_assignment)`, `inv_recount_assign` |
| Discrepancies | `v_inv_discrepancies`, `v_inv_adjustments`, `inventory_approval_requests` (status line) | `inv_discrepancy_update`, `inv_request_approval(stock_adjustment)`, `inv_adjustment_approve` (approve / reject / hold), `inv_request_approval(recount_assignment)`, `inv_recount_assign` |
| Controls > Approvals | `v_inv_pending_approvals` (`can_decide`, `blocked_reason`, `stage_name`, `proposal`) | `inv_approval_decide` (approve / reject; reject needs a note) |
| Controls > Opening balances | `v_inv_opening_batches`, `v_inv_opening_lines`, `inventory_approval_requests` | `inv_opening_batch_create/submit`, `inv_request_approval(opening_balance_batch)`, `inv_opening_batch_approve` |
| Controls > Master reviews | `v_inv_master_reviews` (pending = `submitted`) | `inv_master_review_decide` |
| Valuation > Value | `v_inv_valuation` incl. `pending_allocation_qty`, `pending_allocation_out_qty`, `pending_allocation_in_qty`, `open_allocations` (fallback `v_inv_balances` when the view is absent) | none |
| Valuation > Cost reconciliation | `v_inv_cost_reconciliations` (statuses `open / resolved / written_off / cancelled`; kind `issue_allocation` with `allocation_qty`, `snapshot`, `holder_stock_id`, `proposed/resolved_valued_qty`, `resolved_unvalued_qty`) | `inv_request_approval(cost_reconciliation, proposal {resolution, unit_cost})` or, for an issue allocation, `proposal {valued_qty}`; then `inv_cost_reconcile {reconciliation_id, note, evidence}` |
| Valuation > ERP reconciliation | `v_inv_erp_reconciliation` (read-only, Excel export) | none |
| Tyres | `v_inv_tyre_items`, `v_inv_custody_conflicts` | `inv_tyre_conflict_decide` |
| Supply | `v_inv_supplier_agreements`, `v_inv_po_lines`, `v_inv_grn_lines` | none from this lane |
| Reports (6) | `v_inv_balances`, `v_inv_movements`, `inventory_audits`, `v_inv_discrepancies`, `v_inv_tyre_items`, `v_inv_custody_conflicts` | none |

KPI tiles with **Explain this number** (`ExplainedKpi`, ids exist in `20261120110000_inv_metric_catalogue.sql`):
`inv_stock_value`, `inv_unvalued_stock`, `inv_discrepancies`, `inv_accuracy_exact_line`.

## 2. Rules the client applies (and leaves to the server)

* **Approvals first.** Adjustment posting, opening-batch approval, recount assignment and cost
  reconciliation each show the approval status next to the posting button
  (`inventory_approval_requests`, best effort). The posting button is still offered; when no
  approval exists the server refuses and its sentence is shown as written.
* **Who may decide is the server's answer.** The queue shows Decide only when
  `can_decide = true`; otherwise it shows `blocked_reason` verbatim. The client never re-implements
  the conflict set.
* **Recount**: request approval with `proposal.counter_id`, then assign the same person
  (`inv_recount_assign`). `recount` is not an `inv_adjustment_approve` decision.
* **Unknown cost** is never zero and never invented: a blank cost is never sent; a cost
  resolution needs evidence or a reason; `inv_cost_reconcile` carries no cost of its own (it
  applies the approved proposal); a direct `cost_assignment` is not offered anywhere.
* **Valuation**: owned stock only, per currency, never summed across currencies. Valued,
  unvalued and **split undecided** (pending allocation) are three separate figures (tiles and
  table columns); undecided units are never counted as valued or as zero. Any pending allocation
  (`pending_allocation_qty`, else out + in) or `open_allocations > 0` marks the line incomplete,
  whatever `valuation_complete` says, and the headline then reads "valued part only", never a total.
* **Undecided split (issue_allocation)**: the drawer shows the balance split before the movement,
  asks how many of the undecided units were at known cost (0 to the undecided quantity) with
  evidence or a reason, offers no write-off, and sends `proposal {valued_qty}`. Posting is the same
  `inv_cost_reconcile` call; the server applies the approved split.
* **Posting answers**: `valued_qty_moved`, `unvalued_qty_moved` and `pending_allocation_qty` are
  shown after receive / issue ("Moved at known cost / at unknown cost / split undecided").
* **Plain-word refusals** (`PLAIN_REFUSALS` in `src/lib/api/inventory.js`): pricing in-stock units
  or posting an opening correction while a split is pending; a serial / lot tracked item on a mixed
  balance with no source receipt; a split that no longer fits the balance; a write-off of a split;
  a split without evidence; reversing a transfer that carried an undecided split; posting without
  an approved request; a missing stock permission. Any other sentence that names a snake_case
  identifier is not shown verbatim.
* **Refusals**: a server sentence with code 22023 / 42501 / P0001 / 23514 / PT409 / 55000 that
  carries no database internals is shown as written (`inventoryRefusalText`, code `INV_REFUSED`);
  anything else goes through `safeError`.
* **Paging**: every paged read has a total order. Views without `id` page on their own key
  (`v_inv_erp_reconciliation`: month, country, site, item_code, currency; `v_inv_valuation`:
  stock_id; `v_inv_report_snapshot`: country, site, currency).

## 3. Scheduled report

* `src/lib/api/scheduledReports.js`: report type `inventory` -> `v_inv_report_snapshot`
  (current-state; columns `balances, qty_on_hand, qty_reserved, owned_valued_qty,
  owned_unvalued_qty, owned_valued_amount, valuation_complete, critical_lines, low_lines,
  open_exceptions, open_discrepancies, open_cost_reconciliations, pending_approvals`). "Generate
  now" (PDF / Excel) works once the view exists.
* **The emailed digest is pending deploy approval.** The `send-scheduled-reports` edge function
  has **no** `inventory` branch on this branch (removed on the coordinator's instruction; an edge
  deploy is a separate owner approval). Until it is built and deployed, an `inventory` schedule
  emails the generic fallback.
* `report_schedules.report_type` accepting `inventory` comes from DB migration `20261120111000`.

## 4. Flutter

* Shipped in the app code (not reserved files): `inv_count_submit` sends one
  `p_payload {audit_id, device_id, lines}`; transfers order by `dispatched_at` and read item codes
  through the `itm` embed; the count screen says **sending is manual for now** (no copy claims
  automatic sync).
* Reserved wiring (routes, background queue for count lines, retirement of `STOCK_ADJUST`) is an
  exact patch for a human: `tyre_pulse_flutter/docs/inventory_reserved.patch`, explained in
  `tyre_pulse_flutter/docs/inventory_reserved_patch.md`. Not applied.

## 5. What was proven

| Check | Result |
|---|---|
| ESLint on every changed web file | 0 errors (2 pre-existing warnings in `LocationsSection.jsx`) |
| Vitest `src/test/inventory*` | 189 passed (section 7) |
| Ratchet guards (rowCapGuard, migrationTimestampsUnique, webI18nKeyCoverage, commandSearchCoverage, designSystemRatchet) | green (section 7) |
| `vite build` | exit 0 |
| en / ar inventory locale key parity | equal key sets |
| Flutter (worktree, shipped code): `flutter analyze` | no issues |
| Flutter (worktree): `test/features/inventory`, `test/features/stock_count`, localization | 56 + 46 passed |
| Reserved patch: `git apply --check` on this branch | clean, 23 files |
| Reserved patch applied in a SCRATCH copy: `flutter analyze lib test` | no issues |
| Scratch copy, targeted (`test/core/sync`, `app/router`, `features/inventory`, `stock_count`, `app/localization`) | 365 passed, 0 failed |
| Scratch copy, whole suite | 3,735 passed, 20 failed: 18 golden image comparisons (Linux renderer vs the Windows-made goldens; none in an inventory screen) and 2 drift tests that read `mobile/`, which the scratch copy does not contain. None touch the patched files. |
| UI proof (real components, fake Supabase, Playwright) | section 6 |

## 6. UI proof (harness)

The real hub components were driven in a browser (Vite dev server with the Supabase client and the
auth / settings contexts swapped for fakes; every RPC recorded). Screenshots:
`scratchpad/inventory_screens_v2/` (session scratchpad, not committed). The step list and results
are in section 7.

What the harness cannot prove: RLS, the DB gates and segregation of duties themselves (the fake
answers are scripted), real data volumes, or the Excel file contents.

## 7. Results of this round

* Vitest `src/test/inventory*`: **189 passed, 0 failed** (10 files).
* Vitest inventory + `scheduledReports` + ratchet guards (rowCapGuard, migrationTimestampsUnique,
  webI18nKeyCoverage, commandSearchCoverage, designSystemRatchet): **239 passed, 0 failed** (19 files).
* `vite build`: exit 0.
* UI proof: **55 checks passed, 0 failed** (40 behaviour checks + 15 layout checks: no horizontal
  overflow and no page error at 1440 / 390, dark / light, English / Arabic, plus the not-set-up
  state). Behaviour proven, each by the RPC the screen actually sent:
  * audit create with counter, reviewer and key; blind count shows no expected figure though the
    fake server sent one; count submit with a `client_uuid` per line;
  * reconcile; recount approval names the recounter, then the assignment uses the same person;
  * discrepancy: approval request (`stock_adjustment`), status line beside the post button, server
    segregation refusal shown as written, recount never sent as an approval decision;
  * receive with a blank cost sent as null, moved-at-known/unknown note; reserve then issue
    against the reservation; refused shortage reported with nothing claimed posted;
  * transfer dispatch (from != to) and receipt of the outstanding quantity;
  * opening batch: approval request (`opening_balance_batch`), then approve;
  * approvals queue: blocked row shows the server reason and no Decide; Decide only where
    `can_decide`; reject disabled until a reason is written; decide sends `inv_approval_decide`;
  * valuation: incomplete flag, "valued part only" label, split-undecided figure and note;
  * cost reconciliation: blank cost cannot be proposed, cost without evidence refused before any
    call, step 1 sends the proposal, step 3 sends no cost, unapproved post refused in plain words;
  * issue allocation: no write-off offered, proposal `{valued_qty}`;
  * ERP reconciliation: differences only by default with the view's statuses; Excel export button.
* Screenshots (30): `01`..`13` flows and states, `20-*` layout sweep, in
  `scratchpad/inventory_screens_v2/` (session scratchpad).

## 8. Not run

* No database apply, no edge-function deploy, no Flutter build, no device test.
* No end-to-end run against a database with the DB-lane migrations applied (the DB lane's
  PGlite suites cover the server side; this lane only drove the UI against a fake).
* `deno check` of the edge function (the inventory branch was removed, so it is unchanged here).

## 9. Assumptions and mismatches with the DB lane

* `pending_allocation_qty` is taken as the undecided total when present; when only the out / in
  fields are present their sum is used. If the DB lane defines the total differently (for example
  out only), the client figure follows the view's own total.
* A serial / lot tracked issue on a mixed balance is refused by the server until a
  `source_receipt_movement_id` is given. The web issue form does not yet offer a receipt picker, so
  such an issue shows the plain refusal and cannot be completed from the web. Follow-up.
* `inventory_approval_requests` is read directly for the per-record status line. If its RLS does
  not let a requester read their own request, the line simply does not show (no error).
* `can_decide` absent (older view) renders as "cannot decide" with no button: the client fails
  closed.
* `onNavigate(section, tab)`: the hub ignores the tab argument today, so "Open evidence" lands on
  the section's default tab.
* The Approval Policies editor limit noted in doc 10 section 6.2 (inventory stages can only name
  Admin or a named person) is a DB / owner decision; the web shows whatever stage the server
  routes.
