# 102 - Physical inventory registration and identification (operational guide)

Status 2026-11-21: **code merged, database DRAFT NOT APPLIED.** The screens are live in the web
Inventory Control Center (`/stock?section=physical`) and in the Flutter app (Stock > Physical
inventory), but every call answers "Not set up yet" until the owner applies
`supabase/pending_migrations/20261122100000_inv_physical_inventory_master.sql`.

## 1. What it is (one paragraph)

Store people walk the three existing stores, scan or type whatever is on a label (company barcode,
company SKU, ERP SKU, OEM number, aftermarket number) or describe the item, enter quantity,
condition and ownership, take photos and press **Save and next**. Each save is a **capture**:
evidence of what was found, where, by whom and when. A capture **never changes official stock**.
Identified captures become an **opening-balance batch** that a different person approves through
the existing governed workflow (Controls > Opening balances); only that approval posts through the
immutable ledger. Unidentified items get a temporary reference (`UNK-yymmdd-xxxxxxxx`), stay
non-issuable and go to engineering / master-data review.

## 2. What was reused (nothing duplicated)

| Need | Reused object |
|---|---|
| Item master per country / ERP SKU | `material_master` (unchanged rows; linked, never rewritten) |
| References (OEM, aftermarket, barcode, superseded, company SKU) | `material_aliases`, extended additively (canonical / variant target, verification, evidence, historical state) |
| Engineering compatibility | `oem_part_references`, `equipment_fitments` (search reads approved fitments) |
| Stores and bins | `sites` + `inventory_locations` (no new location tree; 0 locations exist in production today) |
| Official stock | `stock_records` / `stock_movements` through `inv_opening_batch_create` -> submit -> approve |
| Idempotency | `inventory_rpc_requests` via `_inv_req_begin/_end`; captures and photos also keyed on `client_uuid` |
| Photo storage | private bucket `tyre-photos`, path `physical_inventory/<org>/...` (live policies: upload by active users, read only inside the uploader's company) |
| RLS | `_inv_secure_table` (RESTRICTIVE org isolation, country / site SELECT scope, client writes revoked) |
| Blind counts | unchanged; a session can carry `audit_id` for reference, counts still go through `inv_count_submit` |

New tables (all org-isolated): `material_canonical` (company-wide material = replacement group /
company SKU; **no stock, cost or country**), `material_variants` (manufacturer + part number +
genuine / OES / aftermarket / unknown), `material_canonical_items` (country ERP SKU -> material /
variant), `physical_inventory_sessions`, `physical_inventory_captures`, `physical_inventory_photos`,
`material_correction_requests` + append-only `material_correction_events`,
`inventory_transfer_requests`. View `v_inv_pi_captures`.

## 3. Rules enforced in the database (not the screen)

1. **Company-wide identification, no leaks.** Materials and variants are visible to every approved
   user of the same company and to nobody else. ERP SKU links keep the country scope; stock
   availability in search is read with the caller's own RLS (security invoker), so a UAE user sees
   the material but not KSA stock or KSA ERP numbers.
2. **Duplicates are checked against every company record** (company SKU, every reference, variant
   part numbers, ERP SKU / barcode in any country, similar descriptions). Approving a proposal that
   has candidates requires a written `not_duplicate_reason`. Nothing is merged automatically.
3. **Genuine is never assumed.** Variants default to `unknown`. An active genuine / OES variant must
   carry evidence (CHECK constraint); an OEM number printed on packaging is not evidence.
4. **Separation of duties.** Proposer != approver (materials, variants, corrections, transfer
   requests); the person who counted a capture cannot identify it (CHECK + RPC).
5. **Evidence is immutable.** A capture's quantity, person, time, store, condition and ownership
   cannot change, and captures / photos cannot be deleted (trigger, also against the table owner).
   Photo links are permanent; identification photos are copied to the material when mapped.
6. **No double counting.** `inv_pi_to_opening_batch` marks a line `needs_review` when the item already
   holds a balance at that location or the store still has unmapped legacy balances. Missing prices
   stay unvalued (`missing_cost`), for Finance.
7. **No silent ERP SKU pick.** A material picked without its variant, when several ERP SKUs of the
   country could stand for it, is saved with `item_id` empty and the flag `ambiguous_erp_sku`; it stays
   out of the opening balance until a person chooses the variant / ERP SKU.
8. **Ownership is never guessed.** Only captures recorded as company-owned reach the opening balance;
   customer, supplier, consignment and unknown ownership are skipped as `ownership_needs_decision`
   (handled through Supply: supplier agreements / consignment receipt).
9. **Replays.** A capture replay with the same `client_uuid` returns the stored row even if the retried
   body differs; the web screen also freezes the payload of an unconfirmed save and resends it exactly.
10. **Corrections never touch history or money.** They change only identification data
   (material / variant / references); an old company SKU or part number stays findable as a
   historical reference; a duplicate is marked obsolete with `superseded_by`, never deleted; country
   ERP item fields go through the existing master review. A stale request (record changed after it
   was raised) is refused (`PT409`).

## 4. RPCs (all `p_payload jsonb`)

`inv_pi_session_start`, `inv_pi_session_close`, `inv_pi_capture` (idempotent on `client_uuid`),
`inv_pi_photo_attach` (idempotent on `client_uuid`, deduplicated by SHA-256 per record),
`inv_pi_capture_map` (map_existing | create_new | reject), `inv_material_canonical_propose / _decide`,
`inv_material_variant_propose / _decide`, `inv_material_link_item`, `inv_correction_request /
_decide` (approve | reject | cancel), `inv_material_search` (invoker), `inv_transfer_request /
_decide`, `inv_pi_to_opening_batch`, `inv_pi_dashboard` (invoker).

Permissions: capture = `stock:count` or `stock:receive` or an elevated role; review / approvals =
`stock:engineering_approve` or an elevated role; transfer decision = `stock:transfer` at the sending
store.

## 5. How to run a physical inventory (store team)

1. Inventory manager: create each store's warehouse / rack / shelf / bin under **Locations** (print
   the `TP:LOC:` labels). The three stores already exist as sites; nothing new is created for them.
2. Counter (web or phone): **Physical inventory > Start physical inventory** > choose the store
   (and bin if known) > Start.
3. For each item: scan / type the code > pick the material (genuine and aftermarket are listed
   separately) or open "Not found? Describe the item" > quantity, unit, condition, ownership,
   location note, photos > **Save and next**.
4. Close the session. A different person reviews **Identification review** (map, create, reject),
   approves **Company materials** and links ERP SKUs per country.
5. **Prepare opening balance** on the closed session. Then Controls > Opening balances: map any
   `needs_review` lines, submit, and a different person approves (this is the only step that posts
   stock).
6. **Dashboard** shows items collected / identified / missing SKU / OEM / aftermarket, duplicates,
   pending corrections, genuine vs aftermarket, condition, valuation completeness, approval status and
   progress by employee and location, with Excel and PDF export.

## 6. Flutter offline behaviour

Captures and photos go to an encrypted per-user outbox (`inventory_pi_outbox_v1:<user>` in the
secure store) and are sent when the screen opens, after every save, when connectivity returns and
when the app returns to the foreground. Photos are resized by the picker (1280 px, quality 60),
copied to app storage, uploaded once (a retry after an upload skips straight to attach) and hashed
(SHA-256) so the server stores the same bytes once. A server refusal is kept with its reason;
nothing is dropped. A photo file that cannot be read right now stays pending and is retried; a file
the OS deleted is flagged (never treated as uploaded) and the capture stays listed until the person
dismisses it. Local files are deleted only after the server confirmed the photo. On the web, photos
that fail to upload are kept and offered for retry on the same capture; the company folder comes from
`app_current_org()` (the signed-in profile does not carry it). Another user on the same phone never sees these captures.

**When the app is closed:** the background worker (`lib/core/sync/background_sync.dart`, periodic
15 min and the connectivity one-off) flushes the outbox after its queue pass, through
`lib/features/inventory/data/physical_outbox_runner.dart`. It flushes only the outbox of the user
who is signed in now, and only when that user is the cached workspace's user; another person on the
phone is never read or sent. A failure there is contained and everything stays for the next run.
While the app is open, `PhysicalOutboxSyncBinding` (mounted in `main.dart`) flushes on sign-in,
on return to the foreground and when the network comes back, on any screen. No reserved file was
changed: the outbox is not a sync-engine command. The screen is still pushed with Navigator from the
stock screen; a named route needs `lib/app/router/*` (reserved).

**Capture screen:** the store is picked from the existing stores (active `warehouse` locations in
`inventory_locations`); the phone never creates or types a store. Scanning a `TP:LOC:<id>` label
picks its store on the start view and selects the bin on the capture view (a bin from another store
is refused; offline the label is kept and checked by the server). Quantity has a large -10/-1/+1/+10
stepper beside the field; Save and next sits in the bottom bar.

## 7. What the owner must do next

1. Approve and apply `supabase/pending_migrations/20261122100000_inv_physical_inventory_master.sql`
   (own transaction, after the Supabase backup; staging first). Rollback file next to it. Verify block
   in its header. Then move it to `supabase/migrations/` and note it in doc 96.
2. Grant `stock:count` to the store keepers who will count and `stock:engineering_approve` to the
   engineer / master-data person who identifies (Console > Access Control).
3. Create the bin locations of the three stores.
4. Release a Flutter build when convenient (the phone screen needs a build; no Play upload was done).

## 8. Tests

* `supabase/tests/inventory_physical_master.test.mjs` (PGlite over the live-shaped inventory harness):
  three stores, duplicate proposals across stores, separation of duties, genuine needs evidence,
  ERP SKU per country, company-wide search with genuine / aftermarket separated and per-store
  availability, UAE user sees identification but not KSA stock, offline replay, temporary reference,
  immutable evidence, photo dedupe and company path, mapping keeps count and photos, correction
  approval + history + stale guard, opening batch without stock change and with the no-double-count
  flag, two-company isolation, transfer request, rollback refusal + clean rollback + re-apply.
* `src/test/physicalInventory.test.js` (rules, vocabulary mirror, locale families).
* `tyre_pulse_flutter/test/features/inventory/data/physical_capture_outbox_test.dart` (offline save,
  replay, upload-once, refusal kept, per-user isolation, unreadable store refuses).
