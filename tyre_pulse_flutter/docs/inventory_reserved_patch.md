# Inventory - patch for the reserved wiring files (HUMAN to apply)

Lane: FLUTTER, Inventory Control & Audit (`docs/inventory/07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md`).
Per `tyre_pulse_flutter/AGENTS.md`, no agent may edit these seven files. This document is the exact change
the inventory feature needs in them. **Nothing below has been applied.** Everything else (screens,
repositories, encrypted drafts, Store Keeper mapping, l10n) is already in normal application code.

What works WITHOUT this patch (already shipped in the lane):

- Store Keeper reaches Stock Count (`RoleId.storeKeeper`, `flutterRoleDefaultExtensions[stock]`).
- Stock list pages past 1000 rows (`fetchStockPages`, id tiebreak, throws at the 50k ceiling).
- My counts / Blind count / Transfers screens, pushed with `Navigator` from the Stock Count app bar
  (same `stock` module gate, because Stock Count itself is guarded by `ModuleGuarded(RouteModule.stock)`).
- Offline: every count line is saved to the encrypted per-user draft store
  (`lib/features/inventory/data/count_draft_store.dart`) on every change and sent when the counter
  presses Send (idempotent on `client_uuid`, late lines carry `counted_at`).

What this patch adds: (1) deep-linkable routes, (2) background replay of count lines from the sync
queue so a counter does not have to reopen the audit, (3) retiring the last-write-wins `STOCK_ADJUST`.

---

## 1. Routes (`routes.dart`, `app_router.dart`, `route_access.dart`)

### routes.dart

```dart
// TpRouteId
static const String inventoryAudits = 'inventoryAudits';
static const String inventoryCount = 'inventoryCount';
static const String inventoryTransfers = 'inventoryTransfers';

// TpRoutePaths
static const String inventoryAudits = '/stock/counts';
static const String inventoryCount = '/stock/counts/:auditId';
static const String inventoryTransfers = '/stock/transfers';

final class InventoryAuditsRoute extends TpRoute {
  const InventoryAuditsRoute();
  @override
  String get routeId => TpRouteId.inventoryAudits;
  @override
  String get location => TpRoutePaths.inventoryAudits;
}

final class InventoryCountRoute extends TpRoute {
  const InventoryCountRoute(this.auditId);
  final String auditId;
  @override
  String get routeId => TpRouteId.inventoryCount;
  @override
  String get location => '/stock/counts/${Uri.encodeComponent(auditId)}';

  /// Refuses an empty or non-uuid id: a route must never start a count for
  /// an audit the server cannot name.
  static TpRoute parse(TpRouteParameters p) {
    final String id = p.path['auditId']?.trim() ?? '';
    final bool uuid = RegExp(
      r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
    ).hasMatch(id);
    return uuid ? InventoryCountRoute(id) : const InventoryAuditsRoute();
  }
}

final class InventoryTransfersRoute extends TpRoute {
  const InventoryTransfersRoute();
  @override
  String get routeId => TpRouteId.inventoryTransfers;
  @override
  String get location => TpRoutePaths.inventoryTransfers;
}
```

### app_router.dart (next to the existing `TpRoutePaths.stockCount` entry)

```dart
_route(
  TpRoutePaths.inventoryAudits,
  TpRouteId.inventoryAudits,
  (TpRouteParameters _) => const InventoryAuditsRoute(),
),
_route(
  TpRoutePaths.inventoryCount,
  TpRouteId.inventoryCount,
  InventoryCountRoute.parse,
),
_route(
  TpRoutePaths.inventoryTransfers,
  TpRouteId.inventoryTransfers,
  (TpRouteParameters _) => const InventoryTransfersRoute(),
),
```

Declare `/stock/counts` and `/stock/transfers` BEFORE any `/stock/:something` pattern if one is
ever added, so the literal segments win.

### route_access.dart

```dart
TpRouteId.inventoryAudits: ModuleGuarded(RouteModule.stock),
TpRouteId.inventoryCount: ModuleGuarded(RouteModule.stock),
TpRouteId.inventoryTransfers: ModuleGuarded(RouteModule.stock),
```

### Screen registrations (normal code, apply together with the routes)

`lib/features/stock_count/stock_count_screen_registrations.dart`:

```dart
TpRouteId.inventoryAudits: (c, r) =>
    r is InventoryAuditsRoute ? const MyAuditsScreen() : TpScreenNotAvailable(route: r),
TpRouteId.inventoryCount: (c, r) =>
    r is InventoryCountRoute ? BlindCountScreen(auditId: r.auditId) : TpScreenNotAvailable(route: r),
TpRouteId.inventoryTransfers: (c, r) =>
    r is InventoryTransfersRoute ? const TransfersScreen() : TpScreenNotAvailable(route: r),
```

Then switch the two Stock Count app-bar buttons from `Navigator.push(...route())` to
`context.go(const InventoryAuditsRoute().location)` / `InventoryTransfersRoute`.

`shell_tabs.dart`: **no change needed.** Store Keeper reaches Stock Count through the Home hub module
list; adding a tab would change the tab bar for every role that has `stock`.

---

## 2. Offline queue: `INVENTORY_COUNT_LINE` (`command_registry.dart`, `sync_engine.dart`)

Today the sync engine can only `insert` into a table or `update` by id. Count lines are written ONLY by
the `inv_count_submit` RPC (docs/inventory/07: writes only through SECURITY DEFINER RPCs), so the queue
needs an **RPC operation**. This is the one genuinely new engine capability.

### command_registry.dart

```dart
enum CommandOperation {
  insert,
  update,

  /// Calls a SECURITY DEFINER RPC with the allow-listed payload as its
  /// arguments. The RPC must be idempotent on the command's idempotency key
  /// (it is passed as `p_client_uuid`); a replay answers "already stored".
  rpc,
}

// CommandType
inventoryCountLine,
// wireName
case CommandType.inventoryCountLine:
  return 'INVENTORY_COUNT_LINE';

// CommandSpec gains:  final String? rpc;   (required when operation == rpc)

CommandType.inventoryCountLine: CommandSpec(
  type: CommandType.inventoryCountLine,
  table: SupabaseTables.inventoryCountLines, // add 'inventory_count_lines' to SupabaseTables
  operation: CommandOperation.rpc,
  rpc: 'inv_count_submit',
  requiresMediaReady: true, // photos uploaded before the line is sent
  fieldAllowList: <String>{
    'p_audit_id',
    'p_device_id',
    'p_lines', // a ONE-element list built from CountLine.toSubmitJson()
  },
),
```

### sync_engine.dart (inside the push branch, after the allow-list is applied)

```dart
if (spec.operation == CommandOperation.rpc) {
  try {
    final Object? answer = await _pusher.rpc(spec.rpc!, setPayload);
    final CountSubmitResult r = CountSubmitResult.fromJson(answer);
    final String uuid = command.idempotencyKey;
    if (r.accepted.contains(uuid)) {
      await _markCommandSynced(command, spec: spec, now: now);
      return _CommandOutcome.synced;
    }
    final String? reason = r.rejected[uuid];
    // A refusal (audit closed, outside scope) is NOT retried: retrying a
    // deterministic refusal forever is the PostgREST 40001 loop recorded in
    // PROJECT_MEMORY. It is surfaced to the counter instead.
    await _fail(command, now: now,
        message: reason ?? 'This count was not accepted by the server.',
        errorClass: SyncErrorClass.conflict);
    return _CommandOutcome.conflicted;
  } on SupabaseFailure catch (f) {
    // connectivity -> retryable; schemaMismatch -> backendUnavailable (do not
    // burn retries while the inv_* migrations are not applied)
    ...existing classification...
  }
}
```

`_pusher.rpc` is a new method on the pusher (`client.rpc<Object?>(name, params: payload)`), mirrored
in the test fake.

### Feature side after the patch (normal code, NOT applied now)

`CountSubmitter` keeps its online path; when the submit returns `SubmitStatus.offline`, it enqueues one
`INVENTORY_COUNT_LINE` per pending line with `idempotencyKey = line.clientUuid` and the line's photos
registered as command media. The draft store remains the source of truth for the screen; the queue is
only the delivery mechanism.

### Integration tests to add with the patch

`test/core/sync/inventory_count_line_sync_test.dart` (fake pusher, in-memory drift):

1. **Replay is idempotent** - enqueue one line, pusher answers `{accepted:[uuid]}`, then re-run the
   same command: pusher answers `{duplicates:[uuid]}` -> command `synced`, no failure recorded.
2. **Refusal is not retried** - pusher answers `{rejected:[{client_uuid, reason:'Audit is closed'}]}`
   -> command `failed` with `SyncErrorClass.conflict`, `retryCount` unchanged on the next tick.
3. **Not provisioned** - pusher throws `SupabaseFailure(schemaMismatch)` -> command stays queued as
   backend-unavailable; retry counter not exhausted.
4. **Photos first** - with `requiresMediaReady`, a line whose photo is `pending` is returned to pending
   (`_CommandOutcome.mediaPending`); after the media row becomes `uploaded`, the RPC payload carries
   the `tp-storage://` reference, never a local path.
5. **Late submission** - a line counted before the audit cutoff but replayed after it is sent with its
   original `counted_at` (assert the payload value equals the enqueue-time timestamp, not `now`).
6. **Allow-list** - an extra key in the payload (e.g. `expected_qty`) is dropped before the call.

`test/app/router/inventory_routes_test.dart`:

1. `/stock/counts/<uuid>` parses to `InventoryCountRoute`; `/stock/counts/not-a-uuid` falls back to
   `InventoryAuditsRoute`.
2. All three routes are `ModuleGuarded(RouteModule.stock)`: a Store Keeper reaches them; a Driver is
   denied (renders the denied state, not a spinner - `deniedIsNotASpinner`).

---

## 3. Retire the last-write-wins `STOCK_ADJUST`

docs/inventory/05 finding 2: the queued `STOCK_ADJUST` is a plain `UPDATE stock_records SET stock_qty`,
so a replay bypasses the movement ledger and overwrites receipts posted while the phone was offline.
The contract makes `inv_post_movement` the ONLY balance writer and revokes direct table writes, so once
the DB lane applies its migrations this command will fail on replay anyway.

Patch:

```dart
// command_registry.dart - keep the enum value (old queued rows must still
// decode) but make replay refuse instead of writing:
CommandType.stockAdjust: CommandSpec(
  type: CommandType.stockAdjust,
  table: SupabaseTables.stockRecords,
  operation: CommandOperation.rpc,
  rpc: 'set_stock_count', // legacy wrapper; becomes a thin wrapper over inv_post_movement
  fieldAllowList: <String>{'p_stock_id', 'p_count', 'p_reason'},
),
```

and in `StockCountRepository.setCount/adjust` (normal code) stop enqueueing an absolute quantity:
an offline count becomes a blind count line (section 2) instead. Rows already queued on phones under
the old payload shape (`stock_qty`, `id`) must be failed with a visible message
("This offline stock change was made before counts were audited. Count the item again.") rather than
replayed, because replaying them is exactly the overwrite this section removes.

Test: an old-shape `STOCK_ADJUST` payload is failed with `SyncErrorClass.validation` and never reaches
the pusher.

---

## Server contract the phone expects (for the DB lane)

The contract fixes the RPC NAMES; the argument shapes below are what the Flutter lane sends. Every call
degrades to a "not set up yet" state on `42883`/`PGRST202`/`42P01` (`SupabaseFailure.isSchemaMismatch`).

| RPC | Arguments | Answer |
|---|---|---|
| `inv_audit_counter_view` | `p_audit_id uuid` (NULL = audits assigned to me) | NULL: `{audits:[{id, ref, audit_type, status, site, due_at, instructions, location_count}]}`. With id: `{audit:{...}, locations:[{id, code, name}], items:[{location_id, item_id, item_code, description, uom, serial_tracked}], submitted:[client_uuid]}`. **No expected qty / serials / cost** (the phone also strips any `expected*`, `*on_hand*`, `*unit_cost`, `variance`, `value*` key defensively). |
| `inv_count_submit` | `p_audit_id uuid, p_device_id text, p_lines jsonb` - each line `{client_uuid, location_id, item_id, serial_no, scanned_code, counted_qty, confirmed_zero, condition, photos[], remarks, unexpected, counted_at, round}` | `{accepted:[client_uuid], duplicates:[client_uuid], rejected:[{client_uuid, reason}]}`. A duplicate `client_uuid` is an idempotent replay. `counted_at` is the counting moment; the server decides against `cutoff_seq`. |
| `inv_transfer_dispatch` | `p_payload jsonb {idempotency_key, from_location_id, to_location_id, remarks, lines:[{scanned_code, qty}]}` | any; errors raised as P0001 sentences (shown verbatim when safe) |
| `inv_transfer_receive` | `p_payload jsonb {idempotency_key, transfer_id, lines:[{line_id, received_qty, condition, remarks}]}` | any |

Reads: `stock_transfers` `select('*, stock_transfer_lines(*)')` under RLS (requires the FK
`stock_transfer_lines.transfer_id -> stock_transfers.id`). Fields read defensively: `ref|transfer_no`,
`status`, `from_location_code|from_site|from_location_id`, `to_*`, `dispatched_at`, line `qty_dispatched|qty`,
`qty_received`, `item_code`, `description`, `serial_no`.

Conditions sent: `good | damaged | repairable | quarantine | scrap`.
Location labels scanned: `TP:LOC:<location id>`; stock labels `TP:STK:<stock_records.id>`.
Photos: uploaded to the existing private `tyre-photos` bucket under `inventory_count/<audit>/<line>/`,
sent as `tp-storage://tyre-photos/...` references.
