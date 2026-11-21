# 05 - Mobile inventory and identification audit (Phase 1, read-only)

Scope: Flutter field app (`tyre_pulse_flutter/`, the target), Expo `mobile/` (retired, reference only),
web QR labels, RFID registry, AI serial recognition (draft branch). Evidence is file paths read on branch
`claude/inventory-upgrade-7rxp2t`, 2026-11-19. No live DB queries were possible this session (Supabase MCP
did not connect), so every database statement below is from migration files, not from production.

## 1. What an inventory counter can do on the phone today

| Capability | Status | Evidence |
|---|---|---|
| Open "Stock Count" | Manager + Inspector role defaults only (+ admin, + per-user `mobile:stock` grant) | `lib/core/permissions/module_registry.dart` (ModuleKey.stock) |
| List stock rows | One unpaged read, `.limit(1000)`, ordered by site, country-scoped (`country.eq.X,country.is.null`) | `lib/features/stock_count/data/stock_count_repository.dart:89` |
| Set an absolute count | Online: `set_stock_count(p_stock_id,p_count,p_reason)` RPC (row lock, writes a `stocktake` movement). Offline: queued `STOCK_ADJUST` | same file, `setCount` |
| +/- adjust | Online: `post_stock_movement` (`adjustment_up/down`). Offline: absolute `STOCK_ADJUST` from last-known qty | `adjust` |
| Add a stock row | Online only; size prefixed into `description` (no size column) | `create` |
| Scan a code | `mobile_scanner` 7.4, `DetectionSpeed.noDuplicates`, manual entry fallback. Resolves ASSET (exact, ilike, fleet number) or TYRE serial only | `lib/features/scanning/domain/scan_lookup.dart`, `scan_payload.dart`, `scan_route_resolver.dart` |
| Serial search | Tyre by serial, case-insensitive | `lib/features/search/*`, ModuleKey.serial |
| l10n | en/ar/ur via one packed `stockCountCopyCatalog` ARB string (present in all 3 ARBs) | `stock_count_copy.dart`, `lib/l10n/app_*.arb` |

What the scanner CANNOT resolve: a stock item, a bin/location, a stock-take session, an RFID tag id.
Stock Count has no scan entry point at all; the counter scrolls a list.

## 2. Findings (severity / confidence)

1. **P1 - Store Keeper cannot use the Flutter stock module.** `Store Keeper` is in
   `knownUnmappedDatabaseRoles` (`lib/core/permissions/roles.dart:191`), so it resolves to
   `UserRole.unknown` and is denied everything. The web granted it `stock:create` (2026-10-12) and Expo
   reached it through a `reporter` fallback. A dedicated `storeKeeper` RoleId plus module defaults is
   ordinary code (roles.dart, module_registry.dart are NOT reserved). High confidence.
2. **P1 - Offline `STOCK_ADJUST` bypasses the movement ledger and is last-write-wins.** The queued
   command is a plain `UPDATE stock_records SET stock_qty=<absolute>` matched by id
   (`command_registry.dart:531`), with `requiresOptimisticStatusMatch=false`. When it replays: no
   `stock_movements` row, no reason, no row lock, and it silently overwrites any receipt/issue/transfer
   posted by someone else while the phone was offline. The `stock_status` it sends is client-computed
   (now re-derived by the V-20261112113000 trigger, so that part is safe). High confidence.
3. **P1 - Counts are not blind.** `StockItem.quantity` (system qty) is shown on every card and pre-fills
   the count dialog; there is no session, no expected-vs-counted variance, no recount, no approval.
4. **P2 - Unpaged 1000-row read.** Same row-cap class fixed elsewhere (rowCapGuard covers web only).
   Count of `stock_records` live is unknown this session; flag it before it crosses 1000.
5. **P2 - Local SQLite is NOT encrypted.** `openTyrePulseDatabase()` = `driftDatabase(name:...)`
   (`lib/core/database/app_database.dart:38`); queued payloads and cached assets/tyres sit in plain SQLite.
   Only the session/keys use `flutter_secure_storage` (`lib/core/storage/secure_key_value_store.dart`).
   Low sensitivity data today, but a count session with user ids should be considered. Medium confidence.
6. **P2 - No location model.** `stock_records.site` is the only place; there is no bin/aisle/rack, so
   "location scanning" has nothing to resolve to.
7. **P2 - No serialized stock.** Tyres in stock are a quantity row per size+site; a serialised tyre is
   only a `tyre_records` row once fitted. Bulk vs serialized counting cannot be distinguished today.
8. **P3 - Bluetooth HID (keyboard-wedge) scanners.** Flutter has no `HardwareKeyboard`/`KeyEvent`
   handling in `lib/features/scanning`; a wedge scanner works only by typing into the focused manual
   entry `TextField` and pressing Enter. Web RFID registry already supports keyboard wedge.
9. **P3 - Glove-friendly UI.** +/- are standard `IconButton`s (48dp) on a card; no large steppers, no
   numeric keypad sheet, no haptic confirm, no "scan next" loop.
10. **Note - good server pieces already exist and should be reused, not rebuilt:**
    `save_stock_entry(p_request_id, ...)` (`supabase/migrations/20261018120550_stock_quick_entry.sql`)
    is request-id idempotent and does per-line optimistic concurrency on `expected_qty` +
    `expected_updated_at` (now raises PT409 per 20261111100000). That is exactly the conflict primitive a
    mobile count needs. The web uses it (`src/lib/api/stockQuickEntry.js`); Flutter does not.

## 3. Identification surfaces (web + data)

- **QR labels** (`src/pages/QrLabels.jsx`, `qrLabelLayout.js`, `qrBulkMatch.js`): tyres, vehicles,
  equipment only. Payload is the bare serial or asset code (scan_payload.dart unwraps bare / URL / JSON).
  No stock-item, bin or count-session label type. Layout engine (A4 grid, sizes sm/md/lg/custom,
  wrap-never-truncate, logo) is solid and reusable.
- **RFID** (`rfid_tags`, V132, `rfid_tag_events` 20260929121000): tag_id unique per org, links to
  `tyre_serial` / `asset_no`, status active/unassigned/retired. No link to stock rows or bins. No Flutter
  NFC/UHF reader integration (no nfc package in pubspec).
- **AI serial recognition** (branch `origin/claude/ai-serial-recognition-7rxp2t`, draft migration
  `20261117130000_ai_tyre_serial_recognition.sql`, NOT applied): append-only
  `ai_tyre_serial_readings` + review events, `ai_tyre_serial_record` service-role only,
  `ai_tyre_serial_outcome` mirrors JS `compareSerial`. Interface for inventory = a READ of a
  reviewer-accepted serial. Keep separate; inventory should consume an accepted reading, never call the
  model itself.

## 4. Classification

| Item | Class | Paths |
|---|---|---|
| Scanner payload unwrap + lookup chain | RETAIN, UPGRADE (add stock/bin/session kinds) | `lib/features/scanning/domain/*` |
| mobile_scanner camera + manual fallback | RETAIN, UPGRADE (torch, format filter, continuous mode, HID focus) | `scanner_screen.dart`, `asset_camera_scanner_dialog.dart` |
| Stock Count screen | UPGRADE (blind session mode, paging, big steppers) | `lib/features/stock_count/presentation/stock_count_screen.dart` |
| StockCountRepository.list | REPAIR (page past 1000, id tiebreak) | `stock_count_repository.dart:89` |
| Offline STOCK_ADJUST | REPAIR (route through ledgered, idempotent RPC) - **needs reserved files** | `command_registry.dart`, `sync_engine.dart` |
| Store Keeper role | ADD | `lib/core/permissions/roles.dart`, `module_registry.dart` |
| Count sessions / lines / variance / recount | ADD (DB + Flutter + web review) | new |
| Bin/location master + labels | ADD | new tables, QrLabels new type |
| RFID to stock/bin link | ADD (later) | `rfid_tags` |
| QR label engine | RETAIN, UPGRADE (new label types) | `src/lib/qrLabelLayout.js`, `QrLabels.jsx` |
| `save_stock_entry` request-id + expected-qty | CONSOLIDATE (one count write path for web + mobile) | `20261018120550_stock_quick_entry.sql`, `stockQuickEntry.js` |
| Local DB encryption | UPGRADE (decision) | `app_database.dart` |
| Expo stock screen | retired reference only | `mobile/app/(app)/stock.tsx` |

## 5. Reserved-wiring dependencies (HUMAN must make these changes)

Per `tyre_pulse_flutter/AGENTS.md`, no agent may edit:
`lib/app/router/routes.dart`, `app_router.dart`, `route_access.dart`, `shell_tabs.dart`,
`lib/core/sync/command_registry.dart`, `queued_command_repository.dart`, `sync_engine.dart`.

| Need | Reserved file(s) | Why |
|---|---|---|
| New offline command `STOCK_COUNT_LINE` (insert into count-line table, `client_uuid` idempotent) | `command_registry.dart` (enum, wireName, CommandSpec) | every queued command lives there |
| Change `STOCK_ADJUST` to a ledgered RPC push or add `requiresOptimisticStatusMatch`-style expected-qty check | `command_registry.dart`, `sync_engine.dart` (RPC push path does not exist; engine only does table insert/update) | engine supports insert/update only |
| New routes: count session list, session counting, bin scan | `routes.dart`, `app_router.dart`, `route_access.dart` | routes/guards |
| Stock in tab bar for Store Keeper | `shell_tabs.dart` | tab wiring |

Workaround that avoids reserved files for the FIRST slice: an online-only blind count screen pushed with
`Navigator` (precedent: checklist submission detail), writing through a DEFINER RPC, and keeping offline
drafts in the existing `drafts_dao` (not the command queue). Offline replay still needs the human change.

## 6. Proposed mobile inventory + audit workflow (spec)

Server (separate migration, `database-migration-safety` gate):
- `stock_locations` (org, country, site, code, name, type bin/rack/yard, label payload `TP:LOC:<id>`).
- `stock_count_sessions` (org, country, site, scope locations[], mode blind|guided, status
  draft/counting/submitted/approved/rejected, created_by, assigned_to[], frozen_at).
- `stock_count_lines` (session_id, stock_id or serial, location_id, counted_qty, counted_by,
  counted_at, device, photo, `client_uuid` unique, recount_of). Expected qty is NOT readable by the
  counter role in blind mode (server-side view / RLS column exclusion).
- RPCs: `count_session_start`, `count_line_record(client_uuid,...)` (idempotent),
  `count_session_submit`, `count_session_review` (variance, recount request, approve posts ONE
  `stocktake` movement per item through the existing ledger, reusing `save_stock_entry` style
  expected-qty concurrency; PT409 on drift, never 40001).

Phone flow:
1. Store Keeper opens My Counts -> session assigned to their site.
2. Scan location label (`TP:LOC:`) -> list of items expected at that bin, quantities hidden.
3. Per item: scan item/serial label OR pick; bulk = large numeric keypad sheet (min 64dp keys,
   +1/+10 steppers); serialized = each scan adds one serial line, duplicates rejected locally.
4. Unknown code -> "found, not expected" line (never dropped).
5. Offline: lines saved as drafts, later queued `STOCK_COUNT_LINE` (human reserved-file change).
6. Submit -> supervisor reviews variance on web (or phone), requests recount of selected lines
   (different counter by default), approves -> ledger postings.
7. Conflicts: server compares against balance at `frozen_at` plus movements since; movements posted
   after freeze are applied on top, never overwritten.

UI rules: HID scanner = hidden autofocused `TextField` that submits on Enter plus a `KeyboardListener`
for burst input; camera continuous mode with torch toggle; haptic + sound on accept/reject; full
RTL; every state (offline-cached, denied, not-configured) distinct per AGENTS.md.

## 7. Label templates (proposed)

| Label | Payload | Human text | Size |
|---|---|---|---|
| Bin / location | `TP:LOC:<uuid>` (QR) + Code128 of location code | site, code, name | md 50x30mm |
| Stock item (bulk) | `TP:STK:<stock_id>` | size, description, site, min/critical | md |
| Serialized tyre (in store) | bare serial (Code128 + QR) | serial, size, brand, DOT | sm 38x25mm, wrap not truncate |
| Count session sheet | `TP:CNT:<session_id>` | site, scope, assignee, date | A4 header |

`TP:` prefixes must be added to `scan_payload.dart` key unwrap (not reserved) so existing asset/serial
resolution is unchanged for bare codes.
