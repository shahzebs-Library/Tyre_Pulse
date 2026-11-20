# Inventory - patch for the reserved wiring files (HUMAN to apply)

Lane: client integration, Inventory Control & Audit
(`docs/inventory/07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md`, server contract in
`docs/inventory/10_DB_IMPLEMENTATION.md`). Per `tyre_pulse_flutter/AGENTS.md` no agent may edit the
seven reserved files, so this is an **exact, apply-ready patch** for a human. **Nothing below has been
applied to the repository.**

## How to apply (from the repository root)

```bash
git apply --check tyre_pulse_flutter/docs/inventory_reserved.patch   # must print nothing
git apply tyre_pulse_flutter/docs/inventory_reserved.patch
cd tyre_pulse_flutter
flutter analyze lib test
flutter test test/core/sync test/app/router test/features/inventory test/features/stock_count test/app/localization
```

`tyre_pulse_flutter/docs/inventory_reserved.patch` is byte-identical to the diff at the end of this
document (the separate file exists because `git apply` cannot read a diff out of a Markdown fence).

## What was proven, and how

* `git apply --check` of `inventory_reserved.patch` against branch `claude/inventory-upgrade-7rxp2t`
  at commit `706b0e91` and again after merging the DB lane's `01788fa1`: clean, all 23 files.
* The patch was built and exercised in a SCRATCH copy of `tyre_pulse_flutter` (never in the repo):
  `flutter analyze lib test` -> no issues; `flutter test test/core/sync test/app/router
  test/features/inventory test/features/stock_count test/app/localization` -> **365 passed, 0 failed**
  (Flutter 3.47.2, Linux). Whole suite in that copy: 3,735 passed, 20 failed; the 20 are 18
  golden image comparisons (Linux renderer vs Windows-made goldens, none on an inventory screen)
  and 2 drift tests that read `mobile/`, which the scratch copy does not contain. None of the 20
  touches a patched file.
* Formatter churn was removed from the reserved files: the only lines the patch touches in them are
  the ones the feature needs.
* NOT proven: on a device. No build was made (standing owner rule: no mobile builds unless asked).

## What the patch does

| # | Change | Reserved files | Normal files in the same patch |
|---|---|---|---|
| 1 | Deep links `/stock/counts`, `/stock/counts/<audit uuid>`, `/stock/transfers` (nested under `/stock`, literal segments before the `:auditId` child; a non-uuid id falls back to the audit list; all three `ModuleGuarded(RouteModule.stock)`) | `routes.dart`, `app_router.dart`, `route_access.dart` | `stock_count_screen_registrations.dart`, `test/app/router/inventory_routes_test.dart` |
| 2 | Background sync of blind count lines: new `CommandOperation.rpc`, command `INVENTORY_COUNT_LINE` -> `inv_count_submit(p_payload {audit_id, device_id, lines})`, idempotency key = the line's `client_uuid`. The engine reads the RPC answer: `accepted` or `duplicates` -> synced; `rejected` -> **conflict with the server's reason, never retried**; an answer that does not name the line -> validation failure (never counted as stored). | `command_registry.dart`, `sync_engine.dart` | `supabase_command_pusher.dart` (RPC branch), `supabase_tables.dart` (`inventory_count_lines`), `count_line_queue.dart`, `inventory_providers.dart`, `blind_count_screen.dart` (queue on "no signal"), ARB + generated l10n (`manualSendNote` updated, `submitQueued` added), `test/core/sync/inventory_count_line_sync_test.dart`, `test/core/sync/command_registry_test.dart` |
| 3 | Retire last-write-wins `STOCK_ADJUST`: the enum value stays (old queued rows must decode) but its spec carries `retiredMessage`, so a queued row is failed with "This offline stock change was made before counts were audited and was not sent. Count the item again." and **never reaches the server**. Stock Count stops enqueueing it (an offline +/- or count now reports a failure). | `command_registry.dart`, `sync_engine.dart` | `stock_count_repository.dart`, `stock_count_providers.dart` |

`queued_command_repository.dart` and `shell_tabs.dart`: **no change needed.**

Decisions recorded in the patch:

* **Photos are not replayed from the queue.** Only lines without a local photo are queued; a line
  that still holds a local photo stays in the encrypted draft until the counter presses Send (which
  uploads the photo first). This keeps the media-before-row problem (PROJECT_MEMORY F-H-01/02) out of
  this change.
* The draft remains the source of truth for the screen; the queue is only a delivery path. A line
  queued and also sent by hand is stored once (idempotent on `client_uuid`).
* `counted_at` is the counting moment carried in the payload, never the replay time (tested), so the
  server's cutoff rule (`counted_at <= counting_completed_at`) decides a late line correctly.

## Until the patch lands (what ships today)

* Counting is offline-safe through the encrypted per-user draft; **sending is manual** and the screen
  says so ("Sending is manual for now ... Automatic background sending comes with a later app
  update."). No copy claims automatic sync.
* `inv_count_submit` is already called with the single `p_payload` (repository + test shipped).
* The transfers list orders by `dispatched_at` (`stock_transfers` has no `created_at`; ordering on it
  failed the whole read) and reads item codes through `itm:material_master(item_code, item_name)`.

## Server contract the phone uses (matches docs/inventory/10)

| RPC / read | Arguments | Answer |
|---|---|---|
| `inv_audit_counter_view` | `p_audit_id uuid` (NULL = my audits) | `{audits:[...]}` or `{audit, locations, items, submitted}`; never an expected quantity, serial expectation or cost (the phone also strips such keys) |
| `inv_count_submit` | `p_payload {audit_id, device_id, lines:[{client_uuid, location_id, item_id, serial_no, scanned_code, counted_qty, confirmed_zero, condition, photos[], remarks, unexpected, counted_at, round}]}` (outer `idempotency_key` optional for this call) | `{accepted:[uuid], duplicates:[uuid], rejected:[{client_uuid, reason}]}` |
| `inv_transfer_dispatch` | `p_payload {idempotency_key, from_location_id, to_location_id, remarks, lines:[{scanned_code or stock_id, qty}]}` | `{transfer_id, status, replayed?}` |
| `inv_transfer_receive` | `p_payload {idempotency_key, transfer_id, lines:[{line_id, received_qty, condition, remarks}]}` | posting result |
| `stock_transfers` read | `select('*, stock_transfer_lines(*, itm:material_master(item_code, item_name))')`, `order('dispatched_at', desc)` | RLS scoped |

## The patch

````diff
diff --git a/tyre_pulse_flutter/lib/app/router/app_router.dart b/tyre_pulse_flutter/lib/app/router/app_router.dart
index 6d4b25e..0b2b257 100644
--- a/tyre_pulse_flutter/lib/app/router/app_router.dart
+++ b/tyre_pulse_flutter/lib/app/router/app_router.dart
@@ -340,6 +340,25 @@ List<RouteBase> _buildRoutes() => <RouteBase>[
                 TpRoutePaths.stockCount,
                 TpRouteId.stockCount,
                 (TpRouteParameters _) => const StockCountRoute(),
+                routes: <RouteBase>[
+                  // Literal segments first, so `counts` is never read as an
+                  // audit id.
+                  _route(
+                    TpRoutePaths.inventoryAudits,
+                    TpRouteId.inventoryAudits,
+                    (TpRouteParameters _) => const InventoryAuditsRoute(),
+                  ),
+                  _route(
+                    TpRoutePaths.inventoryTransfers,
+                    TpRouteId.inventoryTransfers,
+                    (TpRouteParameters _) => const InventoryTransfersRoute(),
+                  ),
+                  _route(
+                    TpRoutePaths.inventoryCount,
+                    TpRouteId.inventoryCount,
+                    InventoryCountRoute.parse,
+                  ),
+                ],
               ),
               _route(
                 TpRoutePaths.tasks,
diff --git a/tyre_pulse_flutter/lib/app/router/route_access.dart b/tyre_pulse_flutter/lib/app/router/route_access.dart
index f1608df..6320b67 100644
--- a/tyre_pulse_flutter/lib/app/router/route_access.dart
+++ b/tyre_pulse_flutter/lib/app/router/route_access.dart
@@ -228,6 +228,9 @@ abstract final class TpRouteGuards {
     TpRouteId.tasks: ModuleGuarded(RouteModule.tasks),
     TpRouteId.rca: ModuleGuarded(RouteModule.rca),
     TpRouteId.stockCount: ModuleGuarded(RouteModule.stock),
+    TpRouteId.inventoryAudits: ModuleGuarded(RouteModule.stock),
+    TpRouteId.inventoryCount: ModuleGuarded(RouteModule.stock),
+    TpRouteId.inventoryTransfers: ModuleGuarded(RouteModule.stock),
 
     // Management.
     TpRouteId.overview: ModuleGuarded(RouteModule.overview),
diff --git a/tyre_pulse_flutter/lib/app/router/routes.dart b/tyre_pulse_flutter/lib/app/router/routes.dart
index dfb4787..84d7379 100644
--- a/tyre_pulse_flutter/lib/app/router/routes.dart
+++ b/tyre_pulse_flutter/lib/app/router/routes.dart
@@ -194,6 +194,9 @@ abstract final class TpRouteId {
   static const String repairRequest = 'repairRequest';
   static const String rca = 'rca';
   static const String stockCount = 'stockCount';
+  static const String inventoryAudits = 'inventoryAudits';
+  static const String inventoryCount = 'inventoryCount';
+  static const String inventoryTransfers = 'inventoryTransfers';
   static const String tasks = 'tasks';
   static const String preventiveMaintenance = 'preventiveMaintenance';
   static const String workOrders = 'workOrders';
@@ -274,6 +277,13 @@ abstract final class TpRoutePaths {
   static const String repairRequest = '/repair-request';
   static const String rca = '/rca';
   static const String stockCount = '/stock';
+
+  /// Children of [stockCount] (nested so Back from a count returns to the
+  /// stock list). Literal segments, declared before any `:param` sibling.
+  static const String inventoryAudits = 'counts';
+  static const String inventoryCount = 'counts/:auditId';
+  static const String inventoryTransfers = 'transfers';
+  static const String pAuditId = 'auditId';
   static const String tasks = '/tasks';
   static const String preventiveMaintenance = '/maintenance';
   static const String workOrders = '/work-orders';
@@ -805,6 +815,57 @@ final class StockCountRoute extends TpRoute {
   String get location => TpRoutePaths.stockCount;
 }
 
+/// Audits assigned to me (blind counting). Child of [StockCountRoute].
+final class InventoryAuditsRoute extends TpRoute {
+  const InventoryAuditsRoute();
+
+  @override
+  String get routeId => TpRouteId.inventoryAudits;
+
+  @override
+  String get location =>
+      '${TpRoutePaths.stockCount}/${TpRoutePaths.inventoryAudits}';
+}
+
+/// The blind count of one audit.
+final class InventoryCountRoute extends TpRoute {
+  const InventoryCountRoute(this.auditId);
+
+  static final RegExp _uuid = RegExp(
+    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
+  );
+
+  /// A non-uuid id falls back to the audit list: a route must never start a
+  /// count for an audit the server cannot name.
+  static TpRoute parse(TpRouteParameters p) {
+    final String id = (p.path[TpRoutePaths.pAuditId] ?? '').trim();
+    return _uuid.hasMatch(id)
+        ? InventoryCountRoute(id)
+        : const InventoryAuditsRoute();
+  }
+
+  final String auditId;
+
+  @override
+  String get routeId => TpRouteId.inventoryCount;
+
+  @override
+  String get location => '${TpRoutePaths.stockCount}/'
+      '${TpRoutePaths.inventoryAudits}/${_segment(auditId)}';
+}
+
+/// Stock transfers between locations. Child of [StockCountRoute].
+final class InventoryTransfersRoute extends TpRoute {
+  const InventoryTransfersRoute();
+
+  @override
+  String get routeId => TpRouteId.inventoryTransfers;
+
+  @override
+  String get location =>
+      '${TpRoutePaths.stockCount}/${TpRoutePaths.inventoryTransfers}';
+}
+
 final class TasksRoute extends TpRoute {
   const TasksRoute();
 
diff --git a/tyre_pulse_flutter/lib/core/network/supabase_tables.dart b/tyre_pulse_flutter/lib/core/network/supabase_tables.dart
index 2ccfc81..26a77f1 100644
--- a/tyre_pulse_flutter/lib/core/network/supabase_tables.dart
+++ b/tyre_pulse_flutter/lib/core/network/supabase_tables.dart
@@ -101,6 +101,10 @@ abstract final class SupabaseTables {
   static const String techActivityEvents = 'tech_activity_events';
 
   static const String stockRecords = 'stock_records';
+
+  /// Blind count lines. Written ONLY by the `inv_count_submit` RPC
+  /// (supabase/pending_migrations/20261120102000_inv_physical_audits.sql).
+  static const String inventoryCountLines = 'inventory_count_lines';
   static const String pmPrograms = 'pm_programs';
   static const String pendingUploads = 'pending_uploads';
   static const String odometerLogs = 'odometer_logs';
@@ -219,6 +223,7 @@ abstract final class SupabaseTables {
     workOrders,
     techActivityEvents,
     stockRecords,
+    inventoryCountLines,
     pmPrograms,
     pendingUploads,
     odometerLogs,
diff --git a/tyre_pulse_flutter/lib/core/sync/command_registry.dart b/tyre_pulse_flutter/lib/core/sync/command_registry.dart
index 5a983b7..3ad7f63 100644
--- a/tyre_pulse_flutter/lib/core/sync/command_registry.dart
+++ b/tyre_pulse_flutter/lib/core/sync/command_registry.dart
@@ -123,6 +123,11 @@ enum CommandType {
   /// one row) but still upserted on `client_uuid` since V292, so it is
   /// idempotent exactly like every other command here.
   workshopEvent,
+
+  /// One blind count line, sent through the `inv_count_submit` RPC (count
+  /// lines have no client write grant). Idempotent on the line's
+  /// `client_uuid`, which is also the command's idempotency key.
+  inventoryCountLine,
 }
 
 /// `pending_commands.commandType` values.
@@ -161,6 +166,8 @@ extension CommandTypeWireName on CommandType {
         return 'WASH_RECORD';
       case CommandType.workshopEvent:
         return 'WORKSHOP_EVENT';
+      case CommandType.inventoryCountLine:
+        return 'INVENTORY_COUNT_LINE';
     }
   }
 }
@@ -169,6 +176,11 @@ extension CommandTypeWireName on CommandType {
 enum CommandOperation {
   insert,
   update,
+
+  /// Calls [CommandSpec.rpc] with the allow-listed payload as `p_payload`.
+  /// The RPC answers which lines it accepted, so a refusal is classified by
+  /// the engine, never retried blindly.
+  rpc,
 }
 
 /// One command's shape: which table, which operation, which fields survive
@@ -183,8 +195,18 @@ final class CommandSpec {
     this.matchColumn,
     this.requiresMediaReady = false,
     this.requiresOptimisticStatusMatch = false,
+    this.rpc,
+    this.retiredMessage,
   });
 
+  /// Required when [operation] is [CommandOperation.rpc]: the RPC name.
+  final String? rpc;
+
+  /// Non-null for a command this build no longer replays. A queued row of
+  /// this type is failed with this message (validation, never retried) and
+  /// never reaches the server. The enum value stays so old rows decode.
+  final String? retiredMessage;
+
   final CommandType type;
 
   /// One of [SupabaseTables]'s constants. Never a raw string literal - if the
@@ -533,6 +555,11 @@ abstract final class CommandRegistry {
       table: SupabaseTables.stockRecords,
       operation: CommandOperation.update,
       matchColumn: 'id',
+      // Retired (docs/inventory/05 finding 2): a replayed absolute quantity
+      // bypasses the movement ledger and overwrites receipts posted while
+      // the phone was offline. Count the item again as a blind count line.
+      retiredMessage: 'This offline stock change was made before counts were '
+          'audited and was not sent. Count the item again.',
       fieldAllowList: <String>{
         'id',
         'stock_qty',
@@ -541,6 +568,17 @@ abstract final class CommandRegistry {
         'updated_at',
       },
     ),
+    // ---- RPC commands ----
+    CommandType.inventoryCountLine: CommandSpec(
+      type: CommandType.inventoryCountLine,
+      table: SupabaseTables.inventoryCountLines,
+      operation: CommandOperation.rpc,
+      rpc: 'inv_count_submit',
+      // Photos are NOT replayed from the queue: a line is queued only once
+      // its photos are uploaded (or it has none); a line with local photos
+      // stays in the encrypted draft for the manual Send.
+      fieldAllowList: <String>{'audit_id', 'device_id', 'lines'},
+    ),
     CommandType.workOrderStatus: CommandSpec(
       type: CommandType.workOrderStatus,
       table: SupabaseTables.workOrders,
diff --git a/tyre_pulse_flutter/lib/core/sync/supabase_command_pusher.dart b/tyre_pulse_flutter/lib/core/sync/supabase_command_pusher.dart
index b0609e4..aeff6fc 100644
--- a/tyre_pulse_flutter/lib/core/sync/supabase_command_pusher.dart
+++ b/tyre_pulse_flutter/lib/core/sync/supabase_command_pusher.dart
@@ -43,6 +43,22 @@ final class SupabaseCommandPusher extends SupabaseGateway
     String? expectedPriorStatus,
   }) {
     return guard(() async {
+      if (spec.operation == CommandOperation.rpc) {
+        final String? fn = spec.rpc;
+        if (fn == null) {
+          throw StateError(
+            'An RPC command needs CommandSpec.rpc (table: ${spec.table}).',
+          );
+        }
+        // The answer is handed back as a one-row list; SyncEngine reads it.
+        final Object? answer = await _client.rpc<Object?>(
+          fn,
+          params: <String, Object?>{'p_payload': payload},
+        );
+        return <Map<String, Object?>>[
+          if (answer is Map) Map<String, Object?>.from(answer),
+        ];
+      }
       if (spec.operation == CommandOperation.insert) {
         // A plain insert, never `.upsert()`. See `sync_engine.dart`'s
         // library comment for why: several of the idempotent tables use a
diff --git a/tyre_pulse_flutter/lib/core/sync/sync_engine.dart b/tyre_pulse_flutter/lib/core/sync/sync_engine.dart
index d1df323..c2cda15 100644
--- a/tyre_pulse_flutter/lib/core/sync/sync_engine.dart
+++ b/tyre_pulse_flutter/lib/core/sync/sync_engine.dart
@@ -374,6 +374,19 @@ final class SyncEngine {
     }
     final CommandSpec spec = CommandRegistry.specFor(type);
 
+    final String? retired = spec.retiredMessage;
+    if (retired != null) {
+      // A retired command never reaches the server: replaying it is exactly
+      // the behaviour that was removed.
+      await _fail(
+        command,
+        now: now,
+        message: retired,
+        errorClass: SyncErrorClass.validation,
+      );
+      return _CommandOutcome.failed;
+    }
+
     if (spec.requiresMediaReady) {
       final bool ready = await _mediaDao.commandMediaReady(command.id);
       if (!ready) {
@@ -455,6 +468,15 @@ final class SyncEngine {
         expectedPriorStatus: expectedPriorStatus,
       );
 
+      if (spec.operation == CommandOperation.rpc) {
+        return await _settleRpcAnswer(
+          command,
+          spec: spec,
+          answer: rows.isEmpty ? null : rows.first,
+          now: now,
+        );
+      }
+
       if (spec.requiresOptimisticStatusMatch && rows.isEmpty) {
         await _fail(
           command,
@@ -493,6 +515,47 @@ final class SyncEngine {
     }
   }
 
+  /// Reads an RPC command's answer `{accepted, duplicates, rejected}`.
+  /// Accepted or duplicate (an idempotent replay) is synced. A refusal is a
+  /// CONFLICT and is not retried: retrying a deterministic refusal forever is
+  /// the PostgREST retry-loop class recorded in PROJECT_MEMORY.
+  Future<_CommandOutcome> _settleRpcAnswer(
+    PendingCommand command, {
+    required CommandSpec spec,
+    required Map<String, Object?>? answer,
+    required DateTime now,
+  }) async {
+    final String key = command.idempotencyKey;
+    bool listed(String field) {
+      final Object? v = answer?[field];
+      return v is List && v.any((Object? x) => x == key);
+    }
+
+    if (listed('accepted') || listed('duplicates')) {
+      await _markCommandSynced(command, spec: spec, now: now);
+      return _CommandOutcome.synced;
+    }
+    String? reason;
+    final Object? rejected = answer?['rejected'];
+    if (rejected is List) {
+      for (final Object? r in rejected) {
+        if (r is Map && r['client_uuid'] == key) {
+          final Object? why = r['reason'];
+          reason = why is String && why.trim().isNotEmpty ? why.trim() : null;
+          reason ??= 'This count was not accepted by the server.';
+        }
+      }
+    }
+    await _fail(
+      command,
+      now: now,
+      message: reason ?? 'The server did not confirm this count was stored.',
+      errorClass:
+          reason != null ? SyncErrorClass.conflict : SyncErrorClass.validation,
+    );
+    return reason != null ? _CommandOutcome.conflicted : _CommandOutcome.failed;
+  }
+
   Future<void> _markCommandSynced(
     PendingCommand command, {
     required CommandSpec spec,
diff --git a/tyre_pulse_flutter/lib/features/inventory/data/count_line_queue.dart b/tyre_pulse_flutter/lib/features/inventory/data/count_line_queue.dart
new file mode 100644
index 0000000..6f39fac
--- /dev/null
+++ b/tyre_pulse_flutter/lib/features/inventory/data/count_line_queue.dart
@@ -0,0 +1,40 @@
+/// Queues blind count lines for background delivery (INVENTORY_COUNT_LINE).
+///
+/// Only lines with NO local photo are queued: photos are not replayed from
+/// the queue, so a line still holding a local photo stays in the encrypted
+/// draft for the manual Send. Each line is idempotent on its client_uuid,
+/// which is also the command's idempotency key, so a line queued twice (or
+/// queued and then sent by hand) is stored once.
+library;
+
+import 'package:tyre_pulse/core/sync/command_registry.dart';
+import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
+import 'package:tyre_pulse/core/workspace/workspace_context.dart';
+import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
+
+Future<int> queueCountLines({
+  required QueuedCommandRepository commands,
+  required String auditId,
+  required String deviceId,
+  required List<CountLine> lines,
+  required WorkspaceContext workspace,
+  required DateTime now,
+}) async {
+  var queued = 0;
+  for (final CountLine line in lines) {
+    if (line.photoPaths.isNotEmpty) continue;
+    await commands.enqueue(
+      type: CommandType.inventoryCountLine,
+      idempotencyKey: line.clientUuid,
+      payload: <String, Object?>{
+        'audit_id': auditId,
+        'device_id': deviceId,
+        'lines': <Map<String, Object?>>[line.toSubmitJson()],
+      },
+      workspace: workspace,
+      now: now,
+    );
+    queued++;
+  }
+  return queued;
+}
diff --git a/tyre_pulse_flutter/lib/features/inventory/inventory_providers.dart b/tyre_pulse_flutter/lib/features/inventory/inventory_providers.dart
index 7370dc9..c07286c 100644
--- a/tyre_pulse_flutter/lib/features/inventory/inventory_providers.dart
+++ b/tyre_pulse_flutter/lib/features/inventory/inventory_providers.dart
@@ -2,9 +2,12 @@ library;
 
 import 'package:flutter_riverpod/flutter_riverpod.dart';
 import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
+import 'package:tyre_pulse/core/database/app_database.dart';
+import 'package:tyre_pulse/core/database/app_database_provider.dart';
 import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
 import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
 import 'package:tyre_pulse/core/storage/storage_providers.dart';
+import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
 import 'package:tyre_pulse/features/inventory/data/count_draft_store.dart';
 import 'package:tyre_pulse/features/inventory/data/count_photo_capture.dart';
 import 'package:tyre_pulse/features/inventory/data/count_submitter.dart';
@@ -14,6 +17,14 @@ import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
 import 'package:tyre_pulse/features/inventory/domain/transfer_models.dart';
 import 'package:uuid/uuid.dart';
 
+/// The offline queue for INVENTORY_COUNT_LINE (per feature, like washing).
+final Provider<QueuedCommandRepository>
+    inventoryQueuedCommandRepositoryProvider =
+    Provider<QueuedCommandRepository>((Ref ref) {
+  final AppDatabase db = ref.watch(appDatabaseProvider);
+  return QueuedCommandRepository(db.queueDao);
+});
+
 final Provider<InventoryAuditRepository> inventoryAuditRepositoryProvider =
     Provider<InventoryAuditRepository>(
   (Ref ref) => SupabaseInventoryAuditRepository(
diff --git a/tyre_pulse_flutter/lib/features/inventory/presentation/blind_count_screen.dart b/tyre_pulse_flutter/lib/features/inventory/presentation/blind_count_screen.dart
index 87396d9..f1b8d79 100644
--- a/tyre_pulse_flutter/lib/features/inventory/presentation/blind_count_screen.dart
+++ b/tyre_pulse_flutter/lib/features/inventory/presentation/blind_count_screen.dart
@@ -18,6 +18,7 @@ import 'package:flutter_riverpod/flutter_riverpod.dart';
 import 'package:tyre_pulse/app/theme/tp_spacing.dart';
 import 'package:tyre_pulse/core/design_system/design_system.dart';
 import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
+import 'package:tyre_pulse/features/inventory/data/count_line_queue.dart';
 import 'package:tyre_pulse/features/inventory/data/count_submitter.dart';
 import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
 import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
@@ -160,10 +161,27 @@ class _BlindCountScreenState extends ConsumerState<BlindCountScreen> {
           .submit(session, deviceId: deviceId);
       if (!mounted) return;
       setState(() => _session = outcome.session);
+      var queued = 0;
+      final workspace = ref.read(workspaceContextProvider);
+      if (outcome.status == SubmitStatus.offline && workspace != null) {
+        // No signal: hand the photo-free lines to the background queue. The
+        // draft keeps every line until the server confirms it.
+        queued = await queueCountLines(
+          commands: ref.read(inventoryQueuedCommandRepositoryProvider),
+          auditId: widget.auditId,
+          deviceId: deviceId,
+          lines: outcome.session.submittable,
+          workspace: workspace,
+          now: DateTime.now(),
+        );
+        if (!mounted) return;
+      }
       _snack(
         switch (outcome.status) {
           SubmitStatus.done => copy.count('submitDone', outcome.accepted),
           SubmitStatus.nothingToSend => copy('submitNothing'),
+          SubmitStatus.offline when queued > 0 =>
+            copy.count('submitQueued', queued),
           SubmitStatus.offline => copy('submitOffline'),
           SubmitStatus.notProvisioned => copy('notProvisionedBody'),
           SubmitStatus.partial => copy('submitPartial'),
diff --git a/tyre_pulse_flutter/lib/features/stock_count/data/stock_count_repository.dart b/tyre_pulse_flutter/lib/features/stock_count/data/stock_count_repository.dart
index a03d4f4..2dc7ab1 100644
--- a/tyre_pulse_flutter/lib/features/stock_count/data/stock_count_repository.dart
+++ b/tyre_pulse_flutter/lib/features/stock_count/data/stock_count_repository.dart
@@ -1,11 +1,8 @@
 library;
 
 import 'package:supabase_flutter/supabase_flutter.dart';
-import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
 import 'package:tyre_pulse/core/network/supabase_gateway.dart';
 import 'package:tyre_pulse/core/network/supabase_tables.dart';
-import 'package:tyre_pulse/core/sync/command_registry.dart';
-import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
 import 'package:tyre_pulse/core/workspace/workspace_context.dart';
 import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
 
@@ -52,8 +49,9 @@ abstract interface class StockCountRepository {
   /// Quick +/- adjustment by a signed [delta] (Expo `adjustStock`,
   /// `mobile/lib/stock.ts`): the audited `post_stock_movement` RPC
   /// (`adjustment_up` / `adjustment_down`) when online, an absolute
-  /// `STOCK_ADJUST` from the last-known quantity when the network is down.
-  /// Returns true when the change was queued offline.
+  /// Online only since STOCK_ADJUST was retired: a lost connection is
+  /// thrown for the screen to report (count it as a blind count instead).
+  /// Returns false (nothing is queued).
   Future<bool> adjust({
     required StockItem item,
     required int delta,
@@ -99,10 +97,9 @@ String stockStatusFor(int quantity, int? minimum, int? critical) {
 final class DefaultStockCountRepository
     with SupabaseGateway
     implements StockCountRepository {
-  DefaultStockCountRepository(this._client, this._commands);
+  DefaultStockCountRepository(this._client);
 
   final SupabaseClient _client;
-  final QueuedCommandRepository _commands;
 
   @override
   Future<List<StockItem>> list({String? country}) {
@@ -137,38 +134,20 @@ final class DefaultStockCountRepository
     required WorkspaceContext workspace,
   }) async {
     final num whole = count.floor();
-    try {
-      await guard<Object?>(
-        () => _client.rpc<Object?>(
-          SupabaseRpcs.setStockCount,
-          params: <String, Object?>{
-            'p_stock_id': item.id,
-            'p_count': whole,
-            'p_reason': _text(reason),
-          },
-        ),
-      );
-      return false;
-    } on SupabaseFailure catch (failure) {
-      if (!failure.isConnectivity) rethrow;
-    }
-
-    final DateTime now = DateTime.now();
-    await _commands.enqueue(
-      type: CommandType.stockAdjust,
-      entityId: item.id,
-      payload: <String, Object?>{
-        'id': item.id,
-        'stock_qty': whole,
-        'stock_status': stockStatus(whole, item.minimum, item.critical),
-        'updated_by': workspace.userId,
-        'updated_at': now.toUtc().toIso8601String(),
-      },
-      workspace: workspace,
-      now: now,
-      country: workspace.activeCountry,
+    await guard<Object?>(
+      () => _client.rpc<Object?>(
+        SupabaseRpcs.setStockCount,
+        params: <String, Object?>{
+          'p_stock_id': item.id,
+          'p_count': whole,
+          'p_reason': _text(reason),
+        },
+      ),
     );
-    return true;
+    // STOCK_ADJUST is retired: nothing is queued offline (an absolute
+    // quantity replayed later would bypass the movement ledger). A lost
+    // connection is thrown for the screen to report.
+    return false;
   }
 
   @override
@@ -178,42 +157,22 @@ final class DefaultStockCountRepository
     required WorkspaceContext workspace,
   }) async {
     if (delta == 0) return false;
-    try {
-      await guard<Object?>(
-        () => _client.rpc<Object?>(
-          SupabaseRpcs.postStockMovement,
-          params: <String, Object?>{
-            'p_stock_id': item.id,
-            'p_type': delta > 0 ? 'adjustment_up' : 'adjustment_down',
-            'p_qty': delta.abs(),
-            'p_reason': null,
-            'p_reference': null,
-          },
-        ),
-      );
-      return false;
-    } on SupabaseFailure catch (failure) {
-      if (!failure.isConnectivity) rethrow;
-    }
-
-    final int next =
-        (item.quantity.floor() + delta) < 0 ? 0 : item.quantity.floor() + delta;
-    final DateTime now = DateTime.now();
-    await _commands.enqueue(
-      type: CommandType.stockAdjust,
-      entityId: item.id,
-      payload: <String, Object?>{
-        'id': item.id,
-        'stock_qty': next,
-        'stock_status': stockStatus(next, item.minimum, item.critical),
-        'updated_by': workspace.userId,
-        'updated_at': now.toUtc().toIso8601String(),
-      },
-      workspace: workspace,
-      now: now,
-      country: workspace.activeCountry,
+    await guard<Object?>(
+      () => _client.rpc<Object?>(
+        SupabaseRpcs.postStockMovement,
+        params: <String, Object?>{
+          'p_stock_id': item.id,
+          'p_type': delta > 0 ? 'adjustment_up' : 'adjustment_down',
+          'p_qty': delta.abs(),
+          'p_reason': null,
+          'p_reference': null,
+        },
+      ),
     );
-    return true;
+    // STOCK_ADJUST is retired: nothing is queued offline (an absolute
+    // quantity replayed later would bypass the movement ledger). A lost
+    // connection is thrown for the screen to report.
+    return false;
   }
 
   @override
diff --git a/tyre_pulse_flutter/lib/features/stock_count/stock_count_providers.dart b/tyre_pulse_flutter/lib/features/stock_count/stock_count_providers.dart
index 9d09739..d4bfbf0 100644
--- a/tyre_pulse_flutter/lib/features/stock_count/stock_count_providers.dart
+++ b/tyre_pulse_flutter/lib/features/stock_count/stock_count_providers.dart
@@ -1,22 +1,15 @@
 library;
 
 import 'package:flutter_riverpod/flutter_riverpod.dart';
-import 'package:tyre_pulse/core/database/app_database.dart';
-import 'package:tyre_pulse/core/database/app_database_provider.dart';
 import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
-import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
 import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
 import 'package:tyre_pulse/features/stock_count/data/stock_count_repository.dart';
 import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
 
 final Provider<StockCountRepository> stockCountRepositoryProvider =
-    Provider<StockCountRepository>((Ref ref) {
-  final AppDatabase database = ref.watch(appDatabaseProvider);
-  return DefaultStockCountRepository(
-    ref.watch(supabaseClientProvider),
-    QueuedCommandRepository(database.queueDao),
-  );
-});
+    Provider<StockCountRepository>(
+  (Ref ref) => DefaultStockCountRepository(ref.watch(supabaseClientProvider)),
+);
 
 final FutureProvider<List<StockItem>> stockItemsProvider =
     FutureProvider<List<StockItem>>((Ref ref) {
diff --git a/tyre_pulse_flutter/lib/features/stock_count/stock_count_screen_registrations.dart b/tyre_pulse_flutter/lib/features/stock_count/stock_count_screen_registrations.dart
index c2039d2..ee28a65 100644
--- a/tyre_pulse_flutter/lib/features/stock_count/stock_count_screen_registrations.dart
+++ b/tyre_pulse_flutter/lib/features/stock_count/stock_count_screen_registrations.dart
@@ -3,6 +3,9 @@ library;
 import 'package:flutter/widgets.dart';
 import 'package:tyre_pulse/app/router/routes.dart';
 import 'package:tyre_pulse/app/router/screen_registry.dart';
+import 'package:tyre_pulse/features/inventory/presentation/blind_count_screen.dart';
+import 'package:tyre_pulse/features/inventory/presentation/my_audits_screen.dart';
+import 'package:tyre_pulse/features/inventory/presentation/transfers_screen.dart';
 import 'package:tyre_pulse/features/stock_count/presentation/stock_count_screen.dart';
 
 final Map<String, TpScreenBuilder> stockCountScreenRegistrations =
@@ -11,4 +14,16 @@ final Map<String, TpScreenBuilder> stockCountScreenRegistrations =
       route is StockCountRoute
           ? StockCountScreen(route: route)
           : TpScreenNotAvailable(route: route),
+  TpRouteId.inventoryAudits: (BuildContext context, TpRoute route) =>
+      route is InventoryAuditsRoute
+          ? const MyAuditsScreen()
+          : TpScreenNotAvailable(route: route),
+  TpRouteId.inventoryCount: (BuildContext context, TpRoute route) =>
+      route is InventoryCountRoute
+          ? BlindCountScreen(auditId: route.auditId)
+          : TpScreenNotAvailable(route: route),
+  TpRouteId.inventoryTransfers: (BuildContext context, TpRoute route) =>
+      route is InventoryTransfersRoute
+          ? const TransfersScreen()
+          : TpScreenNotAvailable(route: route),
 };
diff --git a/tyre_pulse_flutter/lib/l10n/app_ar.arb b/tyre_pulse_flutter/lib/l10n/app_ar.arb
index 0b51af1..2d239b6 100644
--- a/tyre_pulse_flutter/lib/l10n/app_ar.arb
+++ b/tyre_pulse_flutter/lib/l10n/app_ar.arb
@@ -3516,5 +3516,5 @@
   "teamMessageAcknowledge": "إقرار بالاستلام",
   "teamMessageReplyLabel": "الرد على الفريق",
   "teamMessageSend": "إرسال الرد",
-  "inventoryCopyCatalog": "myAuditsTitle=عمليات الجرد الخاصة بي~audit=جرد المخزون~noAudits=لا توجد عمليات جرد مسندة~noAuditsBody=لا توجد عملية جرد مسندة إليك حاليا.~draftsUnreadable=تعذرت قراءة عمليات الجرد المحفوظة على هذا الهاتف الآن. لم يتغير شيء. حاول مرة أخرى.~unsyncedLines=%n سطر جرد محفوظة على هذا الهاتف ولم ترسل بعد. اضغط للفتح.~pendingN=%n غير مرسلة~overdue=متأخر~due=الاستحقاق~notCounting=هذه العملية غير مفتوحة للجرد.~notProvisionedTitle=عمليات جرد المخزون غير مهيأة بعد~notProvisionedBody=لم يفعل الخادم جرد المخزون بعد. يجب على المسؤول إكمال إعداد المخزون.~loadFailed=تعذر التحميل.~countTitle=جرد أعمى~resumed=تم الاستئناف: %n سطر من جلستك السابقة.~noLocations=لا توجد مواقع في هذه العملية.~progress=المواقع المجرودة: %a من %b~linesDone=%n سطر مجرود~unexpectedN=%n غير متوقع~scanLocation=امسح ملصق الموقع أولا~scanItem=امسح صنفا أو رقما تسلسليا أو باركود~scanCamera=المسح بالكاميرا~locations=المواقع~atLocation=الجرد في~scanningSerialsOf=مسح الأرقام التسلسلية لـ~stopSerials=إيقاف~serialTracked=متتبع بالرقم التسلسلي~linesN=%n سطر~myLines=جردي هنا~noLinesHere=لم يجرد شيء في هذا الموقع بعد.~confirmedZero=صفر (مؤكد)~notCountedYet=لم يجرد بعد~unexpected=صنف غير متوقع~unexpectedHint=ليس في قائمة هذا الموقع. ستتم مراجعته.~photosN=%n صور~submitN=إرسال %n سطر مجرود~submitDone=تم إرسال %n سطر.~submitNothing=أكمل سطرا قبل الإرسال.~submitOffline=لا يوجد اتصال. جردك محفوظ على هذا الهاتف؛ أرسله مرة أخرى عند توفر الإشارة.~submitPartial=لم تقبل بعض السطور أو تعذر رفع صورها. راجع السطور المعلمة.~submitFailed=تعذر إرسال الجرد. لا يزال محفوظا على هذا الهاتف.~draftSaveFailed=تعذر على الهاتف حفظ الجرد الآن. لا تغلق التطبيق؛ حاول مرة أخرى.~serialCounted=تم جرد الرقم التسلسلي.~scan_locationSelected=تم اختيار الموقع.~scan_serialItemSelected=الآن امسح الرقم التسلسلي لكل وحدة.~scan_locationOutOfScope=هذا الموقع ليس ضمن هذه العملية.~scan_duplicateSerial=هذا الرقم التسلسلي مجرود بالفعل في هذه العملية.~scan_needsLocation=امسح ملصق الموقع قبل جرد الأصناف.~countedQty=الكمية المجرودة~confirmZero=لم يوجد شيء هنا~confirmZeroHint=ضع علامة فقط بعد التحقق: الخانة الفارغة ليست جردا بصفر.~serialOne=وحدة واحدة برقم تسلسلي.~condition=الحالة~condition_good=جيد~condition_damaged=تالف~condition_repairable=قابل للإصلاح~condition_quarantine=حجر~condition_scrap=خردة~remarks=ملاحظات (اختياري)~photo=صورة~addPhoto=إضافة صورة~photoFailed=تعذر التقاط الصورة.~removeLine=إزالة~saveLine=حفظ~enterQty=أدخل الكمية المجرودة أو ضع علامة لم يوجد شيء هنا.~invalidQty=لا يمكن أن تكون الكميات سالبة.~confirmZeroFirst=للصفر، ضع علامة لم يوجد شيء هنا.~state_draft=على الهاتف~state_submitted=مرسل~state_rejected=غير مقبول~status_draft=مسودة~status_scheduled=مجدول~status_assigned=مسند~status_in_progress=قيد التنفيذ~status_counting_completed=اكتمل الجرد~status_reconciliation=مطابقة~status_recount=إعادة جرد~status_investigation=تحقيق~status_approval=بانتظار الموافقة~status_adjustment_posted=تم ترحيل التسوية~status_closed=مغلق~status_cancelled=ملغى~status_rejected=مرفوض~status_unknown=الحالة غير مسجلة~type_full=جرد كامل~type_partial=جرد جزئي~type_cycle=جرد دوري~type_category=جرد فئة~type_high_value=جرد عالي القيمة~type_surprise=جرد مفاجئ~type_bin=جرد رف~type_tyre_serial=جرد أرقام الإطارات~type_vehicle_tyre=جرد إطارات المركبات~transfersTitle=تحويلات المخزون~transfer=تحويل~noTransfers=لا توجد تحويلات~noTransfersBody=لا توجد تحويلات مخزون مرئية لك.~tstatus_dispatched=مرسل~tstatus_in_transit=في الطريق~tstatus_partially_received=مستلم جزئيا~tstatus_completed=مكتمل~tstatus_cancelled=ملغى~tstatus_unknown=الحالة غير مسجلة~dispatchTitle=إرسال مخزون~scanFrom=امسح ملصق موقع المصدر~scanTo=امسح ملصق موقع الوجهة~from=من~to=إلى~items=الأصناف~noItemsScanned=لم يتم مسح أي صنف بعد.~needFrom=امسح الموقع الذي يخرج منه المخزون.~needTo=امسح الموقع الذي يذهب إليه المخزون.~sameLocation=يجب أن يكون المصدر والوجهة موقعين مختلفين.~needLines=أضف سطرا واحدا على الأقل.~dispatchSend=إرسال~dispatchDone=تم إرسال التحويل.~transferOffline=لا يوجد اتصال. لم يرسل شيء؛ حاول مرة أخرى عند توفر الإشارة.~transferFailed=تعذر حفظ التحويل.~receiveTitle=استلام تحويل~noLines=لا يحتوي هذا التحويل على سطور.~outstanding=متبقي للوصول~outstandingUnknown=الكمية المرسلة غير مسجلة~receiveSend=تأكيد الاستلام~receiveDone=تم تسجيل الاستلام.~manualSendNote=الإرسال يدوي حاليا: تبقى أعدادك على هذا الهاتف حتى تضغط إرسال. سيأتي الإرسال التلقائي في الخلفية مع تحديث لاحق للتطبيق."
+  "inventoryCopyCatalog": "myAuditsTitle=عمليات الجرد الخاصة بي~audit=جرد المخزون~noAudits=لا توجد عمليات جرد مسندة~noAuditsBody=لا توجد عملية جرد مسندة إليك حاليا.~draftsUnreadable=تعذرت قراءة عمليات الجرد المحفوظة على هذا الهاتف الآن. لم يتغير شيء. حاول مرة أخرى.~unsyncedLines=%n سطر جرد محفوظة على هذا الهاتف ولم ترسل بعد. اضغط للفتح.~pendingN=%n غير مرسلة~overdue=متأخر~due=الاستحقاق~notCounting=هذه العملية غير مفتوحة للجرد.~notProvisionedTitle=عمليات جرد المخزون غير مهيأة بعد~notProvisionedBody=لم يفعل الخادم جرد المخزون بعد. يجب على المسؤول إكمال إعداد المخزون.~loadFailed=تعذر التحميل.~countTitle=جرد أعمى~resumed=تم الاستئناف: %n سطر من جلستك السابقة.~noLocations=لا توجد مواقع في هذه العملية.~progress=المواقع المجرودة: %a من %b~linesDone=%n سطر مجرود~unexpectedN=%n غير متوقع~scanLocation=امسح ملصق الموقع أولا~scanItem=امسح صنفا أو رقما تسلسليا أو باركود~scanCamera=المسح بالكاميرا~locations=المواقع~atLocation=الجرد في~scanningSerialsOf=مسح الأرقام التسلسلية لـ~stopSerials=إيقاف~serialTracked=متتبع بالرقم التسلسلي~linesN=%n سطر~myLines=جردي هنا~noLinesHere=لم يجرد شيء في هذا الموقع بعد.~confirmedZero=صفر (مؤكد)~notCountedYet=لم يجرد بعد~unexpected=صنف غير متوقع~unexpectedHint=ليس في قائمة هذا الموقع. ستتم مراجعته.~photosN=%n صور~submitN=إرسال %n سطر مجرود~submitDone=تم إرسال %n سطر.~submitNothing=أكمل سطرا قبل الإرسال.~submitOffline=لا يوجد اتصال. جردك محفوظ على هذا الهاتف؛ أرسله مرة أخرى عند توفر الإشارة.~submitPartial=لم تقبل بعض السطور أو تعذر رفع صورها. راجع السطور المعلمة.~submitFailed=تعذر إرسال الجرد. لا يزال محفوظا على هذا الهاتف.~draftSaveFailed=تعذر على الهاتف حفظ الجرد الآن. لا تغلق التطبيق؛ حاول مرة أخرى.~serialCounted=تم جرد الرقم التسلسلي.~scan_locationSelected=تم اختيار الموقع.~scan_serialItemSelected=الآن امسح الرقم التسلسلي لكل وحدة.~scan_locationOutOfScope=هذا الموقع ليس ضمن هذه العملية.~scan_duplicateSerial=هذا الرقم التسلسلي مجرود بالفعل في هذه العملية.~scan_needsLocation=امسح ملصق الموقع قبل جرد الأصناف.~countedQty=الكمية المجرودة~confirmZero=لم يوجد شيء هنا~confirmZeroHint=ضع علامة فقط بعد التحقق: الخانة الفارغة ليست جردا بصفر.~serialOne=وحدة واحدة برقم تسلسلي.~condition=الحالة~condition_good=جيد~condition_damaged=تالف~condition_repairable=قابل للإصلاح~condition_quarantine=حجر~condition_scrap=خردة~remarks=ملاحظات (اختياري)~photo=صورة~addPhoto=إضافة صورة~photoFailed=تعذر التقاط الصورة.~removeLine=إزالة~saveLine=حفظ~enterQty=أدخل الكمية المجرودة أو ضع علامة لم يوجد شيء هنا.~invalidQty=لا يمكن أن تكون الكميات سالبة.~confirmZeroFirst=للصفر، ضع علامة لم يوجد شيء هنا.~state_draft=على الهاتف~state_submitted=مرسل~state_rejected=غير مقبول~status_draft=مسودة~status_scheduled=مجدول~status_assigned=مسند~status_in_progress=قيد التنفيذ~status_counting_completed=اكتمل الجرد~status_reconciliation=مطابقة~status_recount=إعادة جرد~status_investigation=تحقيق~status_approval=بانتظار الموافقة~status_adjustment_posted=تم ترحيل التسوية~status_closed=مغلق~status_cancelled=ملغى~status_rejected=مرفوض~status_unknown=الحالة غير مسجلة~type_full=جرد كامل~type_partial=جرد جزئي~type_cycle=جرد دوري~type_category=جرد فئة~type_high_value=جرد عالي القيمة~type_surprise=جرد مفاجئ~type_bin=جرد رف~type_tyre_serial=جرد أرقام الإطارات~type_vehicle_tyre=جرد إطارات المركبات~transfersTitle=تحويلات المخزون~transfer=تحويل~noTransfers=لا توجد تحويلات~noTransfersBody=لا توجد تحويلات مخزون مرئية لك.~tstatus_dispatched=مرسل~tstatus_in_transit=في الطريق~tstatus_partially_received=مستلم جزئيا~tstatus_completed=مكتمل~tstatus_cancelled=ملغى~tstatus_unknown=الحالة غير مسجلة~dispatchTitle=إرسال مخزون~scanFrom=امسح ملصق موقع المصدر~scanTo=امسح ملصق موقع الوجهة~from=من~to=إلى~items=الأصناف~noItemsScanned=لم يتم مسح أي صنف بعد.~needFrom=امسح الموقع الذي يخرج منه المخزون.~needTo=امسح الموقع الذي يذهب إليه المخزون.~sameLocation=يجب أن يكون المصدر والوجهة موقعين مختلفين.~needLines=أضف سطرا واحدا على الأقل.~dispatchSend=إرسال~dispatchDone=تم إرسال التحويل.~transferOffline=لا يوجد اتصال. لم يرسل شيء؛ حاول مرة أخرى عند توفر الإشارة.~transferFailed=تعذر حفظ التحويل.~receiveTitle=استلام تحويل~noLines=لا يحتوي هذا التحويل على سطور.~outstanding=متبقي للوصول~outstandingUnknown=الكمية المرسلة غير مسجلة~receiveSend=تأكيد الاستلام~receiveDone=تم تسجيل الاستلام.~manualSendNote=تبقى أعدادك على هذا الهاتف حتى يؤكدها الخادم. عند انقطاع الاتصال ترسل البنود التي بلا صور تلقائيا عند عودة الاتصال، وتنتظر البنود التي فيها صور الضغط على إرسال.~submitQueued=لا يوجد اتصال. سترسل %n من البنود المعدودة تلقائيا عند عودة الاتصال."
 }
diff --git a/tyre_pulse_flutter/lib/l10n/app_en.arb b/tyre_pulse_flutter/lib/l10n/app_en.arb
index c3c73d6..f4046eb 100644
--- a/tyre_pulse_flutter/lib/l10n/app_en.arb
+++ b/tyre_pulse_flutter/lib/l10n/app_en.arb
@@ -8882,7 +8882,7 @@
   "teamMessageAcknowledge": "Acknowledge",
   "teamMessageReplyLabel": "Reply to team",
   "teamMessageSend": "Send reply",
-  "inventoryCopyCatalog": "myAuditsTitle=My counts~audit=Inventory audit~noAudits=No counts assigned~noAuditsBody=No inventory count is assigned to you right now.~draftsUnreadable=Counts saved on this phone could not be read just now. Nothing was changed. Try again.~unsyncedLines=%n counted lines are saved on this phone and not yet sent. Tap to open.~pendingN=%n not sent~overdue=Overdue~due=Due~notCounting=This audit is not open for counting.~notProvisionedTitle=Inventory counts are not set up yet~notProvisionedBody=The server does not have inventory counting switched on yet. Your administrator needs to finish the inventory setup.~loadFailed=This could not be loaded.~countTitle=Blind count~resumed=Resumed: %n lines from your earlier session.~noLocations=No locations are in this audit.~progress=Locations counted: %a of %b~linesDone=%n lines counted~unexpectedN=%n unexpected~scanLocation=Scan the location label first~scanItem=Scan an item, serial or barcode~scanCamera=Scan with camera~locations=Locations~atLocation=Counting at~scanningSerialsOf=Scanning serials of~stopSerials=Stop~serialTracked=Serial tracked~linesN=%n lines~myLines=My counts here~noLinesHere=Nothing counted at this location yet.~confirmedZero=Zero (confirmed)~notCountedYet=Not counted yet~unexpected=Unexpected item~unexpectedHint=Not in this location's list. It will be reviewed.~photosN=%n photos~submitN=Send %n counted lines~submitDone=%n lines sent.~submitNothing=Finish a line before sending.~submitOffline=No connection. Your counts are safe on this phone; send again when you have signal.~submitPartial=Some lines were not accepted or their photos could not be uploaded. Check the lines marked.~submitFailed=The counts could not be sent. They are still saved on this phone.~draftSaveFailed=This phone could not save the count just now. Do not close the app; try again.~serialCounted=Serial counted.~scan_locationSelected=Location selected.~scan_serialItemSelected=Now scan each unit's serial.~scan_locationOutOfScope=That location is not part of this audit.~scan_duplicateSerial=That serial is already counted in this audit.~scan_needsLocation=Scan the location label before counting items.~countedQty=Counted quantity~confirmZero=None found here~confirmZeroHint=Tick only after looking: an empty box is not a count of zero.~serialOne=One serialised unit.~condition=Condition~condition_good=Good~condition_damaged=Damaged~condition_repairable=Repairable~condition_quarantine=Quarantine~condition_scrap=Scrap~remarks=Remarks (optional)~photo=Photo~addPhoto=Add photo~photoFailed=The photo could not be taken.~removeLine=Remove~saveLine=Save~enterQty=Enter the counted quantity, or tick None found here.~invalidQty=Quantities cannot be negative.~confirmZeroFirst=For zero, tick None found here.~state_draft=On phone~state_submitted=Sent~state_rejected=Not accepted~status_draft=Draft~status_scheduled=Scheduled~status_assigned=Assigned~status_in_progress=In progress~status_counting_completed=Counting completed~status_reconciliation=Reconciliation~status_recount=Recount~status_investigation=Investigation~status_approval=Awaiting approval~status_adjustment_posted=Adjustment posted~status_closed=Closed~status_cancelled=Cancelled~status_rejected=Rejected~status_unknown=Status not recorded~type_full=Full count~type_partial=Partial count~type_cycle=Cycle count~type_category=Category count~type_high_value=High-value count~type_surprise=Surprise count~type_bin=Bin count~type_tyre_serial=Tyre serial count~type_vehicle_tyre=Vehicle tyre count~transfersTitle=Stock transfers~transfer=Transfer~noTransfers=No transfers~noTransfersBody=No stock transfers are visible to you.~tstatus_dispatched=Dispatched~tstatus_in_transit=In transit~tstatus_partially_received=Partly received~tstatus_completed=Completed~tstatus_cancelled=Cancelled~tstatus_unknown=Status not recorded~dispatchTitle=Dispatch stock~scanFrom=Scan the FROM location label~scanTo=Scan the TO location label~from=From~to=To~items=Items~noItemsScanned=No items scanned yet.~needFrom=Scan the location the stock leaves from.~needTo=Scan the location the stock goes to.~sameLocation=From and To must be different locations.~needLines=Add at least one line.~dispatchSend=Dispatch~dispatchDone=Transfer dispatched.~transferOffline=No connection. Nothing was sent; try again when you have signal.~transferFailed=The transfer could not be saved.~receiveTitle=Receive transfer~noLines=This transfer has no lines.~outstanding=Still to arrive~outstandingUnknown=Quantity sent not recorded~receiveSend=Confirm receipt~receiveDone=Receipt recorded.~manualSendNote=Sending is manual for now: your counts stay on this phone until you tap Send. Automatic background sending comes with a later app update.",
+  "inventoryCopyCatalog": "myAuditsTitle=My counts~audit=Inventory audit~noAudits=No counts assigned~noAuditsBody=No inventory count is assigned to you right now.~draftsUnreadable=Counts saved on this phone could not be read just now. Nothing was changed. Try again.~unsyncedLines=%n counted lines are saved on this phone and not yet sent. Tap to open.~pendingN=%n not sent~overdue=Overdue~due=Due~notCounting=This audit is not open for counting.~notProvisionedTitle=Inventory counts are not set up yet~notProvisionedBody=The server does not have inventory counting switched on yet. Your administrator needs to finish the inventory setup.~loadFailed=This could not be loaded.~countTitle=Blind count~resumed=Resumed: %n lines from your earlier session.~noLocations=No locations are in this audit.~progress=Locations counted: %a of %b~linesDone=%n lines counted~unexpectedN=%n unexpected~scanLocation=Scan the location label first~scanItem=Scan an item, serial or barcode~scanCamera=Scan with camera~locations=Locations~atLocation=Counting at~scanningSerialsOf=Scanning serials of~stopSerials=Stop~serialTracked=Serial tracked~linesN=%n lines~myLines=My counts here~noLinesHere=Nothing counted at this location yet.~confirmedZero=Zero (confirmed)~notCountedYet=Not counted yet~unexpected=Unexpected item~unexpectedHint=Not in this location's list. It will be reviewed.~photosN=%n photos~submitN=Send %n counted lines~submitDone=%n lines sent.~submitNothing=Finish a line before sending.~submitOffline=No connection. Your counts are safe on this phone; send again when you have signal.~submitPartial=Some lines were not accepted or their photos could not be uploaded. Check the lines marked.~submitFailed=The counts could not be sent. They are still saved on this phone.~draftSaveFailed=This phone could not save the count just now. Do not close the app; try again.~serialCounted=Serial counted.~scan_locationSelected=Location selected.~scan_serialItemSelected=Now scan each unit's serial.~scan_locationOutOfScope=That location is not part of this audit.~scan_duplicateSerial=That serial is already counted in this audit.~scan_needsLocation=Scan the location label before counting items.~countedQty=Counted quantity~confirmZero=None found here~confirmZeroHint=Tick only after looking: an empty box is not a count of zero.~serialOne=One serialised unit.~condition=Condition~condition_good=Good~condition_damaged=Damaged~condition_repairable=Repairable~condition_quarantine=Quarantine~condition_scrap=Scrap~remarks=Remarks (optional)~photo=Photo~addPhoto=Add photo~photoFailed=The photo could not be taken.~removeLine=Remove~saveLine=Save~enterQty=Enter the counted quantity, or tick None found here.~invalidQty=Quantities cannot be negative.~confirmZeroFirst=For zero, tick None found here.~state_draft=On phone~state_submitted=Sent~state_rejected=Not accepted~status_draft=Draft~status_scheduled=Scheduled~status_assigned=Assigned~status_in_progress=In progress~status_counting_completed=Counting completed~status_reconciliation=Reconciliation~status_recount=Recount~status_investigation=Investigation~status_approval=Awaiting approval~status_adjustment_posted=Adjustment posted~status_closed=Closed~status_cancelled=Cancelled~status_rejected=Rejected~status_unknown=Status not recorded~type_full=Full count~type_partial=Partial count~type_cycle=Cycle count~type_category=Category count~type_high_value=High-value count~type_surprise=Surprise count~type_bin=Bin count~type_tyre_serial=Tyre serial count~type_vehicle_tyre=Vehicle tyre count~transfersTitle=Stock transfers~transfer=Transfer~noTransfers=No transfers~noTransfersBody=No stock transfers are visible to you.~tstatus_dispatched=Dispatched~tstatus_in_transit=In transit~tstatus_partially_received=Partly received~tstatus_completed=Completed~tstatus_cancelled=Cancelled~tstatus_unknown=Status not recorded~dispatchTitle=Dispatch stock~scanFrom=Scan the FROM location label~scanTo=Scan the TO location label~from=From~to=To~items=Items~noItemsScanned=No items scanned yet.~needFrom=Scan the location the stock leaves from.~needTo=Scan the location the stock goes to.~sameLocation=From and To must be different locations.~needLines=Add at least one line.~dispatchSend=Dispatch~dispatchDone=Transfer dispatched.~transferOffline=No connection. Nothing was sent; try again when you have signal.~transferFailed=The transfer could not be saved.~receiveTitle=Receive transfer~noLines=This transfer has no lines.~outstanding=Still to arrive~outstandingUnknown=Quantity sent not recorded~receiveSend=Confirm receipt~receiveDone=Receipt recorded.~manualSendNote=Your counts stay on this phone until the server confirms them. Without signal, lines without photos are sent automatically when the connection returns; lines with photos wait for Send.~submitQueued=No connection. %n counted lines will be sent automatically when the connection returns.",
   "@inventoryCopyCatalog": {
     "description": "Packed key=value~key=value copy for the inventory count and transfer screens (InventoryCopy)."
   }
diff --git a/tyre_pulse_flutter/lib/l10n/app_ur.arb b/tyre_pulse_flutter/lib/l10n/app_ur.arb
index 78d3675..bfcbf84 100644
--- a/tyre_pulse_flutter/lib/l10n/app_ur.arb
+++ b/tyre_pulse_flutter/lib/l10n/app_ur.arb
@@ -3516,5 +3516,5 @@
   "teamMessageAcknowledge": "تصدیق کریں",
   "teamMessageReplyLabel": "ٹیم کو جواب",
   "teamMessageSend": "جواب بھیجیں",
-  "inventoryCopyCatalog": "myAuditsTitle=میری گنتیاں~audit=انوینٹری آڈٹ~noAudits=کوئی گنتی تفویض نہیں~noAuditsBody=اس وقت آپ کو کوئی انوینٹری گنتی تفویض نہیں ہے۔~draftsUnreadable=اس فون پر محفوظ گنتیاں ابھی پڑھی نہیں جا سکیں۔ کچھ تبدیل نہیں ہوا۔ دوبارہ کوشش کریں۔~unsyncedLines=%n گنی گئی لائنیں اس فون پر محفوظ ہیں اور ابھی بھیجی نہیں گئیں۔ کھولنے کے لیے دبائیں۔~pendingN=%n نہیں بھیجی گئیں~overdue=تاخیر شدہ~due=آخری تاریخ~notCounting=یہ آڈٹ گنتی کے لیے کھلا نہیں ہے۔~notProvisionedTitle=انوینٹری گنتی ابھی ترتیب نہیں دی گئی~notProvisionedBody=سرور پر ابھی انوینٹری گنتی فعال نہیں ہے۔ آپ کے منتظم کو انوینٹری سیٹ اپ مکمل کرنا ہوگا۔~loadFailed=یہ لوڈ نہیں ہو سکا۔~countTitle=بلائنڈ گنتی~resumed=دوبارہ شروع: آپ کے پچھلے سیشن کی %n لائنیں۔~noLocations=اس آڈٹ میں کوئی مقام نہیں ہے۔~progress=گنے گئے مقامات: %b میں سے %a~linesDone=%n لائنیں گنی گئیں~unexpectedN=%n غیر متوقع~scanLocation=پہلے مقام کا لیبل اسکین کریں~scanItem=آئٹم، سیریل یا بارکوڈ اسکین کریں~scanCamera=کیمرے سے اسکین کریں~locations=مقامات~atLocation=گنتی کا مقام~scanningSerialsOf=سیریل اسکین ہو رہے ہیں~stopSerials=روکیں~serialTracked=سیریل سے ٹریک~linesN=%n لائنیں~myLines=یہاں میری گنتیاں~noLinesHere=اس مقام پر ابھی کچھ نہیں گنا گیا۔~confirmedZero=صفر (تصدیق شدہ)~notCountedYet=ابھی نہیں گنا~unexpected=غیر متوقع آئٹم~unexpectedHint=اس مقام کی فہرست میں نہیں۔ اس کا جائزہ لیا جائے گا۔~photosN=%n تصاویر~submitN=%n گنی گئی لائنیں بھیجیں~submitDone=%n لائنیں بھیج دی گئیں۔~submitNothing=بھیجنے سے پہلے ایک لائن مکمل کریں۔~submitOffline=کنکشن نہیں۔ آپ کی گنتیاں اس فون پر محفوظ ہیں؛ سگنل آنے پر دوبارہ بھیجیں۔~submitPartial=کچھ لائنیں قبول نہیں ہوئیں یا ان کی تصاویر اپ لوڈ نہیں ہو سکیں۔ نشان زدہ لائنیں دیکھیں۔~submitFailed=گنتیاں بھیجی نہیں جا سکیں۔ یہ اب بھی اس فون پر محفوظ ہیں۔~draftSaveFailed=یہ فون ابھی گنتی محفوظ نہیں کر سکا۔ ایپ بند نہ کریں؛ دوبارہ کوشش کریں۔~serialCounted=سیریل گن لیا گیا۔~scan_locationSelected=مقام منتخب ہو گیا۔~scan_serialItemSelected=اب ہر یونٹ کا سیریل اسکین کریں۔~scan_locationOutOfScope=یہ مقام اس آڈٹ کا حصہ نہیں ہے۔~scan_duplicateSerial=یہ سیریل اس آڈٹ میں پہلے ہی گنا جا چکا ہے۔~scan_needsLocation=آئٹم گننے سے پہلے مقام کا لیبل اسکین کریں۔~countedQty=گنی گئی مقدار~confirmZero=یہاں کچھ نہیں ملا~confirmZeroHint=دیکھنے کے بعد ہی نشان لگائیں: خالی خانہ صفر کی گنتی نہیں ہے۔~serialOne=ایک سیریل والا یونٹ۔~condition=حالت~condition_good=اچھی~condition_damaged=خراب~condition_repairable=مرمت کے قابل~condition_quarantine=قرنطینہ~condition_scrap=اسکریپ~remarks=ریمارکس (اختیاری)~photo=تصویر~addPhoto=تصویر شامل کریں~photoFailed=تصویر نہیں لی جا سکی۔~removeLine=ہٹائیں~saveLine=محفوظ کریں~enterQty=گنی گئی مقدار درج کریں، یا یہاں کچھ نہیں ملا پر نشان لگائیں۔~invalidQty=مقدار منفی نہیں ہو سکتی۔~confirmZeroFirst=صفر کے لیے یہاں کچھ نہیں ملا پر نشان لگائیں۔~state_draft=فون پر~state_submitted=بھیج دیا~state_rejected=قبول نہیں~status_draft=مسودہ~status_scheduled=شیڈول~status_assigned=تفویض شدہ~status_in_progress=جاری~status_counting_completed=گنتی مکمل~status_reconciliation=مطابقت~status_recount=دوبارہ گنتی~status_investigation=تحقیقات~status_approval=منظوری کا انتظار~status_adjustment_posted=ایڈجسٹمنٹ درج~status_closed=بند~status_cancelled=منسوخ~status_rejected=مسترد~status_unknown=حالت درج نہیں~type_full=مکمل گنتی~type_partial=جزوی گنتی~type_cycle=سائیکل گنتی~type_category=زمرہ گنتی~type_high_value=زیادہ قیمت گنتی~type_surprise=اچانک گنتی~type_bin=بن گنتی~type_tyre_serial=ٹائر سیریل گنتی~type_vehicle_tyre=گاڑی ٹائر گنتی~transfersTitle=اسٹاک منتقلیاں~transfer=منتقلی~noTransfers=کوئی منتقلی نہیں~noTransfersBody=آپ کو کوئی اسٹاک منتقلی نظر نہیں آ رہی۔~tstatus_dispatched=روانہ~tstatus_in_transit=راستے میں~tstatus_partially_received=جزوی وصول~tstatus_completed=مکمل~tstatus_cancelled=منسوخ~tstatus_unknown=حالت درج نہیں~dispatchTitle=اسٹاک روانہ کریں~scanFrom=روانگی کے مقام کا لیبل اسکین کریں~scanTo=منزل کے مقام کا لیبل اسکین کریں~from=سے~to=تک~items=اشیاء~noItemsScanned=ابھی کوئی آئٹم اسکین نہیں ہوا۔~needFrom=وہ مقام اسکین کریں جہاں سے اسٹاک نکلتا ہے۔~needTo=وہ مقام اسکین کریں جہاں اسٹاک جاتا ہے۔~sameLocation=روانگی اور منزل الگ مقام ہونے چاہئیں۔~needLines=کم از کم ایک لائن شامل کریں۔~dispatchSend=روانہ کریں~dispatchDone=منتقلی روانہ ہو گئی۔~transferOffline=کنکشن نہیں۔ کچھ نہیں بھیجا گیا؛ سگنل آنے پر دوبارہ کوشش کریں۔~transferFailed=منتقلی محفوظ نہیں ہو سکی۔~receiveTitle=منتقلی وصول کریں~noLines=اس منتقلی میں کوئی لائن نہیں۔~outstanding=ابھی آنا باقی~outstandingUnknown=بھیجی گئی مقدار درج نہیں~receiveSend=وصولی کی تصدیق کریں~receiveDone=وصولی درج ہو گئی۔~manualSendNote=فی الحال بھیجنا دستی ہے: آپ کی گنتی اس فون پر رہتی ہے جب تک آپ بھیجیں نہ دبائیں۔ خودکار پس منظر ترسیل بعد کی ایپ اپ ڈیٹ کے ساتھ آئے گی۔"
+  "inventoryCopyCatalog": "myAuditsTitle=میری گنتیاں~audit=انوینٹری آڈٹ~noAudits=کوئی گنتی تفویض نہیں~noAuditsBody=اس وقت آپ کو کوئی انوینٹری گنتی تفویض نہیں ہے۔~draftsUnreadable=اس فون پر محفوظ گنتیاں ابھی پڑھی نہیں جا سکیں۔ کچھ تبدیل نہیں ہوا۔ دوبارہ کوشش کریں۔~unsyncedLines=%n گنی گئی لائنیں اس فون پر محفوظ ہیں اور ابھی بھیجی نہیں گئیں۔ کھولنے کے لیے دبائیں۔~pendingN=%n نہیں بھیجی گئیں~overdue=تاخیر شدہ~due=آخری تاریخ~notCounting=یہ آڈٹ گنتی کے لیے کھلا نہیں ہے۔~notProvisionedTitle=انوینٹری گنتی ابھی ترتیب نہیں دی گئی~notProvisionedBody=سرور پر ابھی انوینٹری گنتی فعال نہیں ہے۔ آپ کے منتظم کو انوینٹری سیٹ اپ مکمل کرنا ہوگا۔~loadFailed=یہ لوڈ نہیں ہو سکا۔~countTitle=بلائنڈ گنتی~resumed=دوبارہ شروع: آپ کے پچھلے سیشن کی %n لائنیں۔~noLocations=اس آڈٹ میں کوئی مقام نہیں ہے۔~progress=گنے گئے مقامات: %b میں سے %a~linesDone=%n لائنیں گنی گئیں~unexpectedN=%n غیر متوقع~scanLocation=پہلے مقام کا لیبل اسکین کریں~scanItem=آئٹم، سیریل یا بارکوڈ اسکین کریں~scanCamera=کیمرے سے اسکین کریں~locations=مقامات~atLocation=گنتی کا مقام~scanningSerialsOf=سیریل اسکین ہو رہے ہیں~stopSerials=روکیں~serialTracked=سیریل سے ٹریک~linesN=%n لائنیں~myLines=یہاں میری گنتیاں~noLinesHere=اس مقام پر ابھی کچھ نہیں گنا گیا۔~confirmedZero=صفر (تصدیق شدہ)~notCountedYet=ابھی نہیں گنا~unexpected=غیر متوقع آئٹم~unexpectedHint=اس مقام کی فہرست میں نہیں۔ اس کا جائزہ لیا جائے گا۔~photosN=%n تصاویر~submitN=%n گنی گئی لائنیں بھیجیں~submitDone=%n لائنیں بھیج دی گئیں۔~submitNothing=بھیجنے سے پہلے ایک لائن مکمل کریں۔~submitOffline=کنکشن نہیں۔ آپ کی گنتیاں اس فون پر محفوظ ہیں؛ سگنل آنے پر دوبارہ بھیجیں۔~submitPartial=کچھ لائنیں قبول نہیں ہوئیں یا ان کی تصاویر اپ لوڈ نہیں ہو سکیں۔ نشان زدہ لائنیں دیکھیں۔~submitFailed=گنتیاں بھیجی نہیں جا سکیں۔ یہ اب بھی اس فون پر محفوظ ہیں۔~draftSaveFailed=یہ فون ابھی گنتی محفوظ نہیں کر سکا۔ ایپ بند نہ کریں؛ دوبارہ کوشش کریں۔~serialCounted=سیریل گن لیا گیا۔~scan_locationSelected=مقام منتخب ہو گیا۔~scan_serialItemSelected=اب ہر یونٹ کا سیریل اسکین کریں۔~scan_locationOutOfScope=یہ مقام اس آڈٹ کا حصہ نہیں ہے۔~scan_duplicateSerial=یہ سیریل اس آڈٹ میں پہلے ہی گنا جا چکا ہے۔~scan_needsLocation=آئٹم گننے سے پہلے مقام کا لیبل اسکین کریں۔~countedQty=گنی گئی مقدار~confirmZero=یہاں کچھ نہیں ملا~confirmZeroHint=دیکھنے کے بعد ہی نشان لگائیں: خالی خانہ صفر کی گنتی نہیں ہے۔~serialOne=ایک سیریل والا یونٹ۔~condition=حالت~condition_good=اچھی~condition_damaged=خراب~condition_repairable=مرمت کے قابل~condition_quarantine=قرنطینہ~condition_scrap=اسکریپ~remarks=ریمارکس (اختیاری)~photo=تصویر~addPhoto=تصویر شامل کریں~photoFailed=تصویر نہیں لی جا سکی۔~removeLine=ہٹائیں~saveLine=محفوظ کریں~enterQty=گنی گئی مقدار درج کریں، یا یہاں کچھ نہیں ملا پر نشان لگائیں۔~invalidQty=مقدار منفی نہیں ہو سکتی۔~confirmZeroFirst=صفر کے لیے یہاں کچھ نہیں ملا پر نشان لگائیں۔~state_draft=فون پر~state_submitted=بھیج دیا~state_rejected=قبول نہیں~status_draft=مسودہ~status_scheduled=شیڈول~status_assigned=تفویض شدہ~status_in_progress=جاری~status_counting_completed=گنتی مکمل~status_reconciliation=مطابقت~status_recount=دوبارہ گنتی~status_investigation=تحقیقات~status_approval=منظوری کا انتظار~status_adjustment_posted=ایڈجسٹمنٹ درج~status_closed=بند~status_cancelled=منسوخ~status_rejected=مسترد~status_unknown=حالت درج نہیں~type_full=مکمل گنتی~type_partial=جزوی گنتی~type_cycle=سائیکل گنتی~type_category=زمرہ گنتی~type_high_value=زیادہ قیمت گنتی~type_surprise=اچانک گنتی~type_bin=بن گنتی~type_tyre_serial=ٹائر سیریل گنتی~type_vehicle_tyre=گاڑی ٹائر گنتی~transfersTitle=اسٹاک منتقلیاں~transfer=منتقلی~noTransfers=کوئی منتقلی نہیں~noTransfersBody=آپ کو کوئی اسٹاک منتقلی نظر نہیں آ رہی۔~tstatus_dispatched=روانہ~tstatus_in_transit=راستے میں~tstatus_partially_received=جزوی وصول~tstatus_completed=مکمل~tstatus_cancelled=منسوخ~tstatus_unknown=حالت درج نہیں~dispatchTitle=اسٹاک روانہ کریں~scanFrom=روانگی کے مقام کا لیبل اسکین کریں~scanTo=منزل کے مقام کا لیبل اسکین کریں~from=سے~to=تک~items=اشیاء~noItemsScanned=ابھی کوئی آئٹم اسکین نہیں ہوا۔~needFrom=وہ مقام اسکین کریں جہاں سے اسٹاک نکلتا ہے۔~needTo=وہ مقام اسکین کریں جہاں اسٹاک جاتا ہے۔~sameLocation=روانگی اور منزل الگ مقام ہونے چاہئیں۔~needLines=کم از کم ایک لائن شامل کریں۔~dispatchSend=روانہ کریں~dispatchDone=منتقلی روانہ ہو گئی۔~transferOffline=کنکشن نہیں۔ کچھ نہیں بھیجا گیا؛ سگنل آنے پر دوبارہ کوشش کریں۔~transferFailed=منتقلی محفوظ نہیں ہو سکی۔~receiveTitle=منتقلی وصول کریں~noLines=اس منتقلی میں کوئی لائن نہیں۔~outstanding=ابھی آنا باقی~outstandingUnknown=بھیجی گئی مقدار درج نہیں~receiveSend=وصولی کی تصدیق کریں~receiveDone=وصولی درج ہو گئی۔~manualSendNote=آپ کی گنتی اس فون پر رہتی ہے جب تک سرور تصدیق نہ کرے۔ سگنل نہ ہونے پر بغیر تصاویر والی لائنیں کنکشن واپس آنے پر خود بخود بھیجی جاتی ہیں؛ تصاویر والی لائنیں بھیجیں کا انتظار کرتی ہیں۔~submitQueued=کنکشن نہیں ہے۔ %n گنی ہوئی لائنیں کنکشن واپس آنے پر خود بخود بھیجی جائیں گی۔"
 }
diff --git a/tyre_pulse_flutter/lib/l10n/generated/app_localizations.dart b/tyre_pulse_flutter/lib/l10n/generated/app_localizations.dart
index 44a0360..6aee874 100644
--- a/tyre_pulse_flutter/lib/l10n/generated/app_localizations.dart
+++ b/tyre_pulse_flutter/lib/l10n/generated/app_localizations.dart
@@ -15188,7 +15188,7 @@ abstract class AppLocalizations {
   /// Packed key=value~key=value copy for the inventory count and transfer screens (InventoryCopy).
   ///
   /// In en, this message translates to:
-  /// **'myAuditsTitle=My counts~audit=Inventory audit~noAudits=No counts assigned~noAuditsBody=No inventory count is assigned to you right now.~draftsUnreadable=Counts saved on this phone could not be read just now. Nothing was changed. Try again.~unsyncedLines=%n counted lines are saved on this phone and not yet sent. Tap to open.~pendingN=%n not sent~overdue=Overdue~due=Due~notCounting=This audit is not open for counting.~notProvisionedTitle=Inventory counts are not set up yet~notProvisionedBody=The server does not have inventory counting switched on yet. Your administrator needs to finish the inventory setup.~loadFailed=This could not be loaded.~countTitle=Blind count~resumed=Resumed: %n lines from your earlier session.~noLocations=No locations are in this audit.~progress=Locations counted: %a of %b~linesDone=%n lines counted~unexpectedN=%n unexpected~scanLocation=Scan the location label first~scanItem=Scan an item, serial or barcode~scanCamera=Scan with camera~locations=Locations~atLocation=Counting at~scanningSerialsOf=Scanning serials of~stopSerials=Stop~serialTracked=Serial tracked~linesN=%n lines~myLines=My counts here~noLinesHere=Nothing counted at this location yet.~confirmedZero=Zero (confirmed)~notCountedYet=Not counted yet~unexpected=Unexpected item~unexpectedHint=Not in this location\'s list. It will be reviewed.~photosN=%n photos~submitN=Send %n counted lines~submitDone=%n lines sent.~submitNothing=Finish a line before sending.~submitOffline=No connection. Your counts are safe on this phone; send again when you have signal.~submitPartial=Some lines were not accepted or their photos could not be uploaded. Check the lines marked.~submitFailed=The counts could not be sent. They are still saved on this phone.~draftSaveFailed=This phone could not save the count just now. Do not close the app; try again.~serialCounted=Serial counted.~scan_locationSelected=Location selected.~scan_serialItemSelected=Now scan each unit\'s serial.~scan_locationOutOfScope=That location is not part of this audit.~scan_duplicateSerial=That serial is already counted in this audit.~scan_needsLocation=Scan the location label before counting items.~countedQty=Counted quantity~confirmZero=None found here~confirmZeroHint=Tick only after looking: an empty box is not a count of zero.~serialOne=One serialised unit.~condition=Condition~condition_good=Good~condition_damaged=Damaged~condition_repairable=Repairable~condition_quarantine=Quarantine~condition_scrap=Scrap~remarks=Remarks (optional)~photo=Photo~addPhoto=Add photo~photoFailed=The photo could not be taken.~removeLine=Remove~saveLine=Save~enterQty=Enter the counted quantity, or tick None found here.~invalidQty=Quantities cannot be negative.~confirmZeroFirst=For zero, tick None found here.~state_draft=On phone~state_submitted=Sent~state_rejected=Not accepted~status_draft=Draft~status_scheduled=Scheduled~status_assigned=Assigned~status_in_progress=In progress~status_counting_completed=Counting completed~status_reconciliation=Reconciliation~status_recount=Recount~status_investigation=Investigation~status_approval=Awaiting approval~status_adjustment_posted=Adjustment posted~status_closed=Closed~status_cancelled=Cancelled~status_rejected=Rejected~status_unknown=Status not recorded~type_full=Full count~type_partial=Partial count~type_cycle=Cycle count~type_category=Category count~type_high_value=High-value count~type_surprise=Surprise count~type_bin=Bin count~type_tyre_serial=Tyre serial count~type_vehicle_tyre=Vehicle tyre count~transfersTitle=Stock transfers~transfer=Transfer~noTransfers=No transfers~noTransfersBody=No stock transfers are visible to you.~tstatus_dispatched=Dispatched~tstatus_in_transit=In transit~tstatus_partially_received=Partly received~tstatus_completed=Completed~tstatus_cancelled=Cancelled~tstatus_unknown=Status not recorded~dispatchTitle=Dispatch stock~scanFrom=Scan the FROM location label~scanTo=Scan the TO location label~from=From~to=To~items=Items~noItemsScanned=No items scanned yet.~needFrom=Scan the location the stock leaves from.~needTo=Scan the location the stock goes to.~sameLocation=From and To must be different locations.~needLines=Add at least one line.~dispatchSend=Dispatch~dispatchDone=Transfer dispatched.~transferOffline=No connection. Nothing was sent; try again when you have signal.~transferFailed=The transfer could not be saved.~receiveTitle=Receive transfer~noLines=This transfer has no lines.~outstanding=Still to arrive~outstandingUnknown=Quantity sent not recorded~receiveSend=Confirm receipt~receiveDone=Receipt recorded.~manualSendNote=Sending is manual for now: your counts stay on this phone until you tap Send. Automatic background sending comes with a later app update.'**
+  /// **'myAuditsTitle=My counts~audit=Inventory audit~noAudits=No counts assigned~noAuditsBody=No inventory count is assigned to you right now.~draftsUnreadable=Counts saved on this phone could not be read just now. Nothing was changed. Try again.~unsyncedLines=%n counted lines are saved on this phone and not yet sent. Tap to open.~pendingN=%n not sent~overdue=Overdue~due=Due~notCounting=This audit is not open for counting.~notProvisionedTitle=Inventory counts are not set up yet~notProvisionedBody=The server does not have inventory counting switched on yet. Your administrator needs to finish the inventory setup.~loadFailed=This could not be loaded.~countTitle=Blind count~resumed=Resumed: %n lines from your earlier session.~noLocations=No locations are in this audit.~progress=Locations counted: %a of %b~linesDone=%n lines counted~unexpectedN=%n unexpected~scanLocation=Scan the location label first~scanItem=Scan an item, serial or barcode~scanCamera=Scan with camera~locations=Locations~atLocation=Counting at~scanningSerialsOf=Scanning serials of~stopSerials=Stop~serialTracked=Serial tracked~linesN=%n lines~myLines=My counts here~noLinesHere=Nothing counted at this location yet.~confirmedZero=Zero (confirmed)~notCountedYet=Not counted yet~unexpected=Unexpected item~unexpectedHint=Not in this location\'s list. It will be reviewed.~photosN=%n photos~submitN=Send %n counted lines~submitDone=%n lines sent.~submitNothing=Finish a line before sending.~submitOffline=No connection. Your counts are safe on this phone; send again when you have signal.~submitPartial=Some lines were not accepted or their photos could not be uploaded. Check the lines marked.~submitFailed=The counts could not be sent. They are still saved on this phone.~draftSaveFailed=This phone could not save the count just now. Do not close the app; try again.~serialCounted=Serial counted.~scan_locationSelected=Location selected.~scan_serialItemSelected=Now scan each unit\'s serial.~scan_locationOutOfScope=That location is not part of this audit.~scan_duplicateSerial=That serial is already counted in this audit.~scan_needsLocation=Scan the location label before counting items.~countedQty=Counted quantity~confirmZero=None found here~confirmZeroHint=Tick only after looking: an empty box is not a count of zero.~serialOne=One serialised unit.~condition=Condition~condition_good=Good~condition_damaged=Damaged~condition_repairable=Repairable~condition_quarantine=Quarantine~condition_scrap=Scrap~remarks=Remarks (optional)~photo=Photo~addPhoto=Add photo~photoFailed=The photo could not be taken.~removeLine=Remove~saveLine=Save~enterQty=Enter the counted quantity, or tick None found here.~invalidQty=Quantities cannot be negative.~confirmZeroFirst=For zero, tick None found here.~state_draft=On phone~state_submitted=Sent~state_rejected=Not accepted~status_draft=Draft~status_scheduled=Scheduled~status_assigned=Assigned~status_in_progress=In progress~status_counting_completed=Counting completed~status_reconciliation=Reconciliation~status_recount=Recount~status_investigation=Investigation~status_approval=Awaiting approval~status_adjustment_posted=Adjustment posted~status_closed=Closed~status_cancelled=Cancelled~status_rejected=Rejected~status_unknown=Status not recorded~type_full=Full count~type_partial=Partial count~type_cycle=Cycle count~type_category=Category count~type_high_value=High-value count~type_surprise=Surprise count~type_bin=Bin count~type_tyre_serial=Tyre serial count~type_vehicle_tyre=Vehicle tyre count~transfersTitle=Stock transfers~transfer=Transfer~noTransfers=No transfers~noTransfersBody=No stock transfers are visible to you.~tstatus_dispatched=Dispatched~tstatus_in_transit=In transit~tstatus_partially_received=Partly received~tstatus_completed=Completed~tstatus_cancelled=Cancelled~tstatus_unknown=Status not recorded~dispatchTitle=Dispatch stock~scanFrom=Scan the FROM location label~scanTo=Scan the TO location label~from=From~to=To~items=Items~noItemsScanned=No items scanned yet.~needFrom=Scan the location the stock leaves from.~needTo=Scan the location the stock goes to.~sameLocation=From and To must be different locations.~needLines=Add at least one line.~dispatchSend=Dispatch~dispatchDone=Transfer dispatched.~transferOffline=No connection. Nothing was sent; try again when you have signal.~transferFailed=The transfer could not be saved.~receiveTitle=Receive transfer~noLines=This transfer has no lines.~outstanding=Still to arrive~outstandingUnknown=Quantity sent not recorded~receiveSend=Confirm receipt~receiveDone=Receipt recorded.~manualSendNote=Your counts stay on this phone until the server confirms them. Without signal, lines without photos are sent automatically when the connection returns; lines with photos wait for Send.~submitQueued=No connection. %n counted lines will be sent automatically when the connection returns.'**
   String get inventoryCopyCatalog;
 }
 
diff --git a/tyre_pulse_flutter/lib/l10n/generated/app_localizations_ar.dart b/tyre_pulse_flutter/lib/l10n/generated/app_localizations_ar.dart
index 5cf349a..b50aaaa 100644
--- a/tyre_pulse_flutter/lib/l10n/generated/app_localizations_ar.dart
+++ b/tyre_pulse_flutter/lib/l10n/generated/app_localizations_ar.dart
@@ -8687,5 +8687,5 @@ class AppLocalizationsAr extends AppLocalizations {
 
   @override
   String get inventoryCopyCatalog =>
-      'myAuditsTitle=عمليات الجرد الخاصة بي~audit=جرد المخزون~noAudits=لا توجد عمليات جرد مسندة~noAuditsBody=لا توجد عملية جرد مسندة إليك حاليا.~draftsUnreadable=تعذرت قراءة عمليات الجرد المحفوظة على هذا الهاتف الآن. لم يتغير شيء. حاول مرة أخرى.~unsyncedLines=%n سطر جرد محفوظة على هذا الهاتف ولم ترسل بعد. اضغط للفتح.~pendingN=%n غير مرسلة~overdue=متأخر~due=الاستحقاق~notCounting=هذه العملية غير مفتوحة للجرد.~notProvisionedTitle=عمليات جرد المخزون غير مهيأة بعد~notProvisionedBody=لم يفعل الخادم جرد المخزون بعد. يجب على المسؤول إكمال إعداد المخزون.~loadFailed=تعذر التحميل.~countTitle=جرد أعمى~resumed=تم الاستئناف: %n سطر من جلستك السابقة.~noLocations=لا توجد مواقع في هذه العملية.~progress=المواقع المجرودة: %a من %b~linesDone=%n سطر مجرود~unexpectedN=%n غير متوقع~scanLocation=امسح ملصق الموقع أولا~scanItem=امسح صنفا أو رقما تسلسليا أو باركود~scanCamera=المسح بالكاميرا~locations=المواقع~atLocation=الجرد في~scanningSerialsOf=مسح الأرقام التسلسلية لـ~stopSerials=إيقاف~serialTracked=متتبع بالرقم التسلسلي~linesN=%n سطر~myLines=جردي هنا~noLinesHere=لم يجرد شيء في هذا الموقع بعد.~confirmedZero=صفر (مؤكد)~notCountedYet=لم يجرد بعد~unexpected=صنف غير متوقع~unexpectedHint=ليس في قائمة هذا الموقع. ستتم مراجعته.~photosN=%n صور~submitN=إرسال %n سطر مجرود~submitDone=تم إرسال %n سطر.~submitNothing=أكمل سطرا قبل الإرسال.~submitOffline=لا يوجد اتصال. جردك محفوظ على هذا الهاتف؛ أرسله مرة أخرى عند توفر الإشارة.~submitPartial=لم تقبل بعض السطور أو تعذر رفع صورها. راجع السطور المعلمة.~submitFailed=تعذر إرسال الجرد. لا يزال محفوظا على هذا الهاتف.~draftSaveFailed=تعذر على الهاتف حفظ الجرد الآن. لا تغلق التطبيق؛ حاول مرة أخرى.~serialCounted=تم جرد الرقم التسلسلي.~scan_locationSelected=تم اختيار الموقع.~scan_serialItemSelected=الآن امسح الرقم التسلسلي لكل وحدة.~scan_locationOutOfScope=هذا الموقع ليس ضمن هذه العملية.~scan_duplicateSerial=هذا الرقم التسلسلي مجرود بالفعل في هذه العملية.~scan_needsLocation=امسح ملصق الموقع قبل جرد الأصناف.~countedQty=الكمية المجرودة~confirmZero=لم يوجد شيء هنا~confirmZeroHint=ضع علامة فقط بعد التحقق: الخانة الفارغة ليست جردا بصفر.~serialOne=وحدة واحدة برقم تسلسلي.~condition=الحالة~condition_good=جيد~condition_damaged=تالف~condition_repairable=قابل للإصلاح~condition_quarantine=حجر~condition_scrap=خردة~remarks=ملاحظات (اختياري)~photo=صورة~addPhoto=إضافة صورة~photoFailed=تعذر التقاط الصورة.~removeLine=إزالة~saveLine=حفظ~enterQty=أدخل الكمية المجرودة أو ضع علامة لم يوجد شيء هنا.~invalidQty=لا يمكن أن تكون الكميات سالبة.~confirmZeroFirst=للصفر، ضع علامة لم يوجد شيء هنا.~state_draft=على الهاتف~state_submitted=مرسل~state_rejected=غير مقبول~status_draft=مسودة~status_scheduled=مجدول~status_assigned=مسند~status_in_progress=قيد التنفيذ~status_counting_completed=اكتمل الجرد~status_reconciliation=مطابقة~status_recount=إعادة جرد~status_investigation=تحقيق~status_approval=بانتظار الموافقة~status_adjustment_posted=تم ترحيل التسوية~status_closed=مغلق~status_cancelled=ملغى~status_rejected=مرفوض~status_unknown=الحالة غير مسجلة~type_full=جرد كامل~type_partial=جرد جزئي~type_cycle=جرد دوري~type_category=جرد فئة~type_high_value=جرد عالي القيمة~type_surprise=جرد مفاجئ~type_bin=جرد رف~type_tyre_serial=جرد أرقام الإطارات~type_vehicle_tyre=جرد إطارات المركبات~transfersTitle=تحويلات المخزون~transfer=تحويل~noTransfers=لا توجد تحويلات~noTransfersBody=لا توجد تحويلات مخزون مرئية لك.~tstatus_dispatched=مرسل~tstatus_in_transit=في الطريق~tstatus_partially_received=مستلم جزئيا~tstatus_completed=مكتمل~tstatus_cancelled=ملغى~tstatus_unknown=الحالة غير مسجلة~dispatchTitle=إرسال مخزون~scanFrom=امسح ملصق موقع المصدر~scanTo=امسح ملصق موقع الوجهة~from=من~to=إلى~items=الأصناف~noItemsScanned=لم يتم مسح أي صنف بعد.~needFrom=امسح الموقع الذي يخرج منه المخزون.~needTo=امسح الموقع الذي يذهب إليه المخزون.~sameLocation=يجب أن يكون المصدر والوجهة موقعين مختلفين.~needLines=أضف سطرا واحدا على الأقل.~dispatchSend=إرسال~dispatchDone=تم إرسال التحويل.~transferOffline=لا يوجد اتصال. لم يرسل شيء؛ حاول مرة أخرى عند توفر الإشارة.~transferFailed=تعذر حفظ التحويل.~receiveTitle=استلام تحويل~noLines=لا يحتوي هذا التحويل على سطور.~outstanding=متبقي للوصول~outstandingUnknown=الكمية المرسلة غير مسجلة~receiveSend=تأكيد الاستلام~receiveDone=تم تسجيل الاستلام.~manualSendNote=الإرسال يدوي حاليا: تبقى أعدادك على هذا الهاتف حتى تضغط إرسال. سيأتي الإرسال التلقائي في الخلفية مع تحديث لاحق للتطبيق.';
+      'myAuditsTitle=عمليات الجرد الخاصة بي~audit=جرد المخزون~noAudits=لا توجد عمليات جرد مسندة~noAuditsBody=لا توجد عملية جرد مسندة إليك حاليا.~draftsUnreadable=تعذرت قراءة عمليات الجرد المحفوظة على هذا الهاتف الآن. لم يتغير شيء. حاول مرة أخرى.~unsyncedLines=%n سطر جرد محفوظة على هذا الهاتف ولم ترسل بعد. اضغط للفتح.~pendingN=%n غير مرسلة~overdue=متأخر~due=الاستحقاق~notCounting=هذه العملية غير مفتوحة للجرد.~notProvisionedTitle=عمليات جرد المخزون غير مهيأة بعد~notProvisionedBody=لم يفعل الخادم جرد المخزون بعد. يجب على المسؤول إكمال إعداد المخزون.~loadFailed=تعذر التحميل.~countTitle=جرد أعمى~resumed=تم الاستئناف: %n سطر من جلستك السابقة.~noLocations=لا توجد مواقع في هذه العملية.~progress=المواقع المجرودة: %a من %b~linesDone=%n سطر مجرود~unexpectedN=%n غير متوقع~scanLocation=امسح ملصق الموقع أولا~scanItem=امسح صنفا أو رقما تسلسليا أو باركود~scanCamera=المسح بالكاميرا~locations=المواقع~atLocation=الجرد في~scanningSerialsOf=مسح الأرقام التسلسلية لـ~stopSerials=إيقاف~serialTracked=متتبع بالرقم التسلسلي~linesN=%n سطر~myLines=جردي هنا~noLinesHere=لم يجرد شيء في هذا الموقع بعد.~confirmedZero=صفر (مؤكد)~notCountedYet=لم يجرد بعد~unexpected=صنف غير متوقع~unexpectedHint=ليس في قائمة هذا الموقع. ستتم مراجعته.~photosN=%n صور~submitN=إرسال %n سطر مجرود~submitDone=تم إرسال %n سطر.~submitNothing=أكمل سطرا قبل الإرسال.~submitOffline=لا يوجد اتصال. جردك محفوظ على هذا الهاتف؛ أرسله مرة أخرى عند توفر الإشارة.~submitPartial=لم تقبل بعض السطور أو تعذر رفع صورها. راجع السطور المعلمة.~submitFailed=تعذر إرسال الجرد. لا يزال محفوظا على هذا الهاتف.~draftSaveFailed=تعذر على الهاتف حفظ الجرد الآن. لا تغلق التطبيق؛ حاول مرة أخرى.~serialCounted=تم جرد الرقم التسلسلي.~scan_locationSelected=تم اختيار الموقع.~scan_serialItemSelected=الآن امسح الرقم التسلسلي لكل وحدة.~scan_locationOutOfScope=هذا الموقع ليس ضمن هذه العملية.~scan_duplicateSerial=هذا الرقم التسلسلي مجرود بالفعل في هذه العملية.~scan_needsLocation=امسح ملصق الموقع قبل جرد الأصناف.~countedQty=الكمية المجرودة~confirmZero=لم يوجد شيء هنا~confirmZeroHint=ضع علامة فقط بعد التحقق: الخانة الفارغة ليست جردا بصفر.~serialOne=وحدة واحدة برقم تسلسلي.~condition=الحالة~condition_good=جيد~condition_damaged=تالف~condition_repairable=قابل للإصلاح~condition_quarantine=حجر~condition_scrap=خردة~remarks=ملاحظات (اختياري)~photo=صورة~addPhoto=إضافة صورة~photoFailed=تعذر التقاط الصورة.~removeLine=إزالة~saveLine=حفظ~enterQty=أدخل الكمية المجرودة أو ضع علامة لم يوجد شيء هنا.~invalidQty=لا يمكن أن تكون الكميات سالبة.~confirmZeroFirst=للصفر، ضع علامة لم يوجد شيء هنا.~state_draft=على الهاتف~state_submitted=مرسل~state_rejected=غير مقبول~status_draft=مسودة~status_scheduled=مجدول~status_assigned=مسند~status_in_progress=قيد التنفيذ~status_counting_completed=اكتمل الجرد~status_reconciliation=مطابقة~status_recount=إعادة جرد~status_investigation=تحقيق~status_approval=بانتظار الموافقة~status_adjustment_posted=تم ترحيل التسوية~status_closed=مغلق~status_cancelled=ملغى~status_rejected=مرفوض~status_unknown=الحالة غير مسجلة~type_full=جرد كامل~type_partial=جرد جزئي~type_cycle=جرد دوري~type_category=جرد فئة~type_high_value=جرد عالي القيمة~type_surprise=جرد مفاجئ~type_bin=جرد رف~type_tyre_serial=جرد أرقام الإطارات~type_vehicle_tyre=جرد إطارات المركبات~transfersTitle=تحويلات المخزون~transfer=تحويل~noTransfers=لا توجد تحويلات~noTransfersBody=لا توجد تحويلات مخزون مرئية لك.~tstatus_dispatched=مرسل~tstatus_in_transit=في الطريق~tstatus_partially_received=مستلم جزئيا~tstatus_completed=مكتمل~tstatus_cancelled=ملغى~tstatus_unknown=الحالة غير مسجلة~dispatchTitle=إرسال مخزون~scanFrom=امسح ملصق موقع المصدر~scanTo=امسح ملصق موقع الوجهة~from=من~to=إلى~items=الأصناف~noItemsScanned=لم يتم مسح أي صنف بعد.~needFrom=امسح الموقع الذي يخرج منه المخزون.~needTo=امسح الموقع الذي يذهب إليه المخزون.~sameLocation=يجب أن يكون المصدر والوجهة موقعين مختلفين.~needLines=أضف سطرا واحدا على الأقل.~dispatchSend=إرسال~dispatchDone=تم إرسال التحويل.~transferOffline=لا يوجد اتصال. لم يرسل شيء؛ حاول مرة أخرى عند توفر الإشارة.~transferFailed=تعذر حفظ التحويل.~receiveTitle=استلام تحويل~noLines=لا يحتوي هذا التحويل على سطور.~outstanding=متبقي للوصول~outstandingUnknown=الكمية المرسلة غير مسجلة~receiveSend=تأكيد الاستلام~receiveDone=تم تسجيل الاستلام.~manualSendNote=تبقى أعدادك على هذا الهاتف حتى يؤكدها الخادم. عند انقطاع الاتصال ترسل البنود التي بلا صور تلقائيا عند عودة الاتصال، وتنتظر البنود التي فيها صور الضغط على إرسال.~submitQueued=لا يوجد اتصال. سترسل %n من البنود المعدودة تلقائيا عند عودة الاتصال.';
 }
diff --git a/tyre_pulse_flutter/lib/l10n/generated/app_localizations_en.dart b/tyre_pulse_flutter/lib/l10n/generated/app_localizations_en.dart
index 291cc7e..2ffbb8d 100644
--- a/tyre_pulse_flutter/lib/l10n/generated/app_localizations_en.dart
+++ b/tyre_pulse_flutter/lib/l10n/generated/app_localizations_en.dart
@@ -8678,5 +8678,5 @@ class AppLocalizationsEn extends AppLocalizations {
 
   @override
   String get inventoryCopyCatalog =>
-      'myAuditsTitle=My counts~audit=Inventory audit~noAudits=No counts assigned~noAuditsBody=No inventory count is assigned to you right now.~draftsUnreadable=Counts saved on this phone could not be read just now. Nothing was changed. Try again.~unsyncedLines=%n counted lines are saved on this phone and not yet sent. Tap to open.~pendingN=%n not sent~overdue=Overdue~due=Due~notCounting=This audit is not open for counting.~notProvisionedTitle=Inventory counts are not set up yet~notProvisionedBody=The server does not have inventory counting switched on yet. Your administrator needs to finish the inventory setup.~loadFailed=This could not be loaded.~countTitle=Blind count~resumed=Resumed: %n lines from your earlier session.~noLocations=No locations are in this audit.~progress=Locations counted: %a of %b~linesDone=%n lines counted~unexpectedN=%n unexpected~scanLocation=Scan the location label first~scanItem=Scan an item, serial or barcode~scanCamera=Scan with camera~locations=Locations~atLocation=Counting at~scanningSerialsOf=Scanning serials of~stopSerials=Stop~serialTracked=Serial tracked~linesN=%n lines~myLines=My counts here~noLinesHere=Nothing counted at this location yet.~confirmedZero=Zero (confirmed)~notCountedYet=Not counted yet~unexpected=Unexpected item~unexpectedHint=Not in this location\'s list. It will be reviewed.~photosN=%n photos~submitN=Send %n counted lines~submitDone=%n lines sent.~submitNothing=Finish a line before sending.~submitOffline=No connection. Your counts are safe on this phone; send again when you have signal.~submitPartial=Some lines were not accepted or their photos could not be uploaded. Check the lines marked.~submitFailed=The counts could not be sent. They are still saved on this phone.~draftSaveFailed=This phone could not save the count just now. Do not close the app; try again.~serialCounted=Serial counted.~scan_locationSelected=Location selected.~scan_serialItemSelected=Now scan each unit\'s serial.~scan_locationOutOfScope=That location is not part of this audit.~scan_duplicateSerial=That serial is already counted in this audit.~scan_needsLocation=Scan the location label before counting items.~countedQty=Counted quantity~confirmZero=None found here~confirmZeroHint=Tick only after looking: an empty box is not a count of zero.~serialOne=One serialised unit.~condition=Condition~condition_good=Good~condition_damaged=Damaged~condition_repairable=Repairable~condition_quarantine=Quarantine~condition_scrap=Scrap~remarks=Remarks (optional)~photo=Photo~addPhoto=Add photo~photoFailed=The photo could not be taken.~removeLine=Remove~saveLine=Save~enterQty=Enter the counted quantity, or tick None found here.~invalidQty=Quantities cannot be negative.~confirmZeroFirst=For zero, tick None found here.~state_draft=On phone~state_submitted=Sent~state_rejected=Not accepted~status_draft=Draft~status_scheduled=Scheduled~status_assigned=Assigned~status_in_progress=In progress~status_counting_completed=Counting completed~status_reconciliation=Reconciliation~status_recount=Recount~status_investigation=Investigation~status_approval=Awaiting approval~status_adjustment_posted=Adjustment posted~status_closed=Closed~status_cancelled=Cancelled~status_rejected=Rejected~status_unknown=Status not recorded~type_full=Full count~type_partial=Partial count~type_cycle=Cycle count~type_category=Category count~type_high_value=High-value count~type_surprise=Surprise count~type_bin=Bin count~type_tyre_serial=Tyre serial count~type_vehicle_tyre=Vehicle tyre count~transfersTitle=Stock transfers~transfer=Transfer~noTransfers=No transfers~noTransfersBody=No stock transfers are visible to you.~tstatus_dispatched=Dispatched~tstatus_in_transit=In transit~tstatus_partially_received=Partly received~tstatus_completed=Completed~tstatus_cancelled=Cancelled~tstatus_unknown=Status not recorded~dispatchTitle=Dispatch stock~scanFrom=Scan the FROM location label~scanTo=Scan the TO location label~from=From~to=To~items=Items~noItemsScanned=No items scanned yet.~needFrom=Scan the location the stock leaves from.~needTo=Scan the location the stock goes to.~sameLocation=From and To must be different locations.~needLines=Add at least one line.~dispatchSend=Dispatch~dispatchDone=Transfer dispatched.~transferOffline=No connection. Nothing was sent; try again when you have signal.~transferFailed=The transfer could not be saved.~receiveTitle=Receive transfer~noLines=This transfer has no lines.~outstanding=Still to arrive~outstandingUnknown=Quantity sent not recorded~receiveSend=Confirm receipt~receiveDone=Receipt recorded.~manualSendNote=Sending is manual for now: your counts stay on this phone until you tap Send. Automatic background sending comes with a later app update.';
+      'myAuditsTitle=My counts~audit=Inventory audit~noAudits=No counts assigned~noAuditsBody=No inventory count is assigned to you right now.~draftsUnreadable=Counts saved on this phone could not be read just now. Nothing was changed. Try again.~unsyncedLines=%n counted lines are saved on this phone and not yet sent. Tap to open.~pendingN=%n not sent~overdue=Overdue~due=Due~notCounting=This audit is not open for counting.~notProvisionedTitle=Inventory counts are not set up yet~notProvisionedBody=The server does not have inventory counting switched on yet. Your administrator needs to finish the inventory setup.~loadFailed=This could not be loaded.~countTitle=Blind count~resumed=Resumed: %n lines from your earlier session.~noLocations=No locations are in this audit.~progress=Locations counted: %a of %b~linesDone=%n lines counted~unexpectedN=%n unexpected~scanLocation=Scan the location label first~scanItem=Scan an item, serial or barcode~scanCamera=Scan with camera~locations=Locations~atLocation=Counting at~scanningSerialsOf=Scanning serials of~stopSerials=Stop~serialTracked=Serial tracked~linesN=%n lines~myLines=My counts here~noLinesHere=Nothing counted at this location yet.~confirmedZero=Zero (confirmed)~notCountedYet=Not counted yet~unexpected=Unexpected item~unexpectedHint=Not in this location\'s list. It will be reviewed.~photosN=%n photos~submitN=Send %n counted lines~submitDone=%n lines sent.~submitNothing=Finish a line before sending.~submitOffline=No connection. Your counts are safe on this phone; send again when you have signal.~submitPartial=Some lines were not accepted or their photos could not be uploaded. Check the lines marked.~submitFailed=The counts could not be sent. They are still saved on this phone.~draftSaveFailed=This phone could not save the count just now. Do not close the app; try again.~serialCounted=Serial counted.~scan_locationSelected=Location selected.~scan_serialItemSelected=Now scan each unit\'s serial.~scan_locationOutOfScope=That location is not part of this audit.~scan_duplicateSerial=That serial is already counted in this audit.~scan_needsLocation=Scan the location label before counting items.~countedQty=Counted quantity~confirmZero=None found here~confirmZeroHint=Tick only after looking: an empty box is not a count of zero.~serialOne=One serialised unit.~condition=Condition~condition_good=Good~condition_damaged=Damaged~condition_repairable=Repairable~condition_quarantine=Quarantine~condition_scrap=Scrap~remarks=Remarks (optional)~photo=Photo~addPhoto=Add photo~photoFailed=The photo could not be taken.~removeLine=Remove~saveLine=Save~enterQty=Enter the counted quantity, or tick None found here.~invalidQty=Quantities cannot be negative.~confirmZeroFirst=For zero, tick None found here.~state_draft=On phone~state_submitted=Sent~state_rejected=Not accepted~status_draft=Draft~status_scheduled=Scheduled~status_assigned=Assigned~status_in_progress=In progress~status_counting_completed=Counting completed~status_reconciliation=Reconciliation~status_recount=Recount~status_investigation=Investigation~status_approval=Awaiting approval~status_adjustment_posted=Adjustment posted~status_closed=Closed~status_cancelled=Cancelled~status_rejected=Rejected~status_unknown=Status not recorded~type_full=Full count~type_partial=Partial count~type_cycle=Cycle count~type_category=Category count~type_high_value=High-value count~type_surprise=Surprise count~type_bin=Bin count~type_tyre_serial=Tyre serial count~type_vehicle_tyre=Vehicle tyre count~transfersTitle=Stock transfers~transfer=Transfer~noTransfers=No transfers~noTransfersBody=No stock transfers are visible to you.~tstatus_dispatched=Dispatched~tstatus_in_transit=In transit~tstatus_partially_received=Partly received~tstatus_completed=Completed~tstatus_cancelled=Cancelled~tstatus_unknown=Status not recorded~dispatchTitle=Dispatch stock~scanFrom=Scan the FROM location label~scanTo=Scan the TO location label~from=From~to=To~items=Items~noItemsScanned=No items scanned yet.~needFrom=Scan the location the stock leaves from.~needTo=Scan the location the stock goes to.~sameLocation=From and To must be different locations.~needLines=Add at least one line.~dispatchSend=Dispatch~dispatchDone=Transfer dispatched.~transferOffline=No connection. Nothing was sent; try again when you have signal.~transferFailed=The transfer could not be saved.~receiveTitle=Receive transfer~noLines=This transfer has no lines.~outstanding=Still to arrive~outstandingUnknown=Quantity sent not recorded~receiveSend=Confirm receipt~receiveDone=Receipt recorded.~manualSendNote=Your counts stay on this phone until the server confirms them. Without signal, lines without photos are sent automatically when the connection returns; lines with photos wait for Send.~submitQueued=No connection. %n counted lines will be sent automatically when the connection returns.';
 }
diff --git a/tyre_pulse_flutter/lib/l10n/generated/app_localizations_ur.dart b/tyre_pulse_flutter/lib/l10n/generated/app_localizations_ur.dart
index 965d155..4db0135 100644
--- a/tyre_pulse_flutter/lib/l10n/generated/app_localizations_ur.dart
+++ b/tyre_pulse_flutter/lib/l10n/generated/app_localizations_ur.dart
@@ -8694,5 +8694,5 @@ class AppLocalizationsUr extends AppLocalizations {
 
   @override
   String get inventoryCopyCatalog =>
-      'myAuditsTitle=میری گنتیاں~audit=انوینٹری آڈٹ~noAudits=کوئی گنتی تفویض نہیں~noAuditsBody=اس وقت آپ کو کوئی انوینٹری گنتی تفویض نہیں ہے۔~draftsUnreadable=اس فون پر محفوظ گنتیاں ابھی پڑھی نہیں جا سکیں۔ کچھ تبدیل نہیں ہوا۔ دوبارہ کوشش کریں۔~unsyncedLines=%n گنی گئی لائنیں اس فون پر محفوظ ہیں اور ابھی بھیجی نہیں گئیں۔ کھولنے کے لیے دبائیں۔~pendingN=%n نہیں بھیجی گئیں~overdue=تاخیر شدہ~due=آخری تاریخ~notCounting=یہ آڈٹ گنتی کے لیے کھلا نہیں ہے۔~notProvisionedTitle=انوینٹری گنتی ابھی ترتیب نہیں دی گئی~notProvisionedBody=سرور پر ابھی انوینٹری گنتی فعال نہیں ہے۔ آپ کے منتظم کو انوینٹری سیٹ اپ مکمل کرنا ہوگا۔~loadFailed=یہ لوڈ نہیں ہو سکا۔~countTitle=بلائنڈ گنتی~resumed=دوبارہ شروع: آپ کے پچھلے سیشن کی %n لائنیں۔~noLocations=اس آڈٹ میں کوئی مقام نہیں ہے۔~progress=گنے گئے مقامات: %b میں سے %a~linesDone=%n لائنیں گنی گئیں~unexpectedN=%n غیر متوقع~scanLocation=پہلے مقام کا لیبل اسکین کریں~scanItem=آئٹم، سیریل یا بارکوڈ اسکین کریں~scanCamera=کیمرے سے اسکین کریں~locations=مقامات~atLocation=گنتی کا مقام~scanningSerialsOf=سیریل اسکین ہو رہے ہیں~stopSerials=روکیں~serialTracked=سیریل سے ٹریک~linesN=%n لائنیں~myLines=یہاں میری گنتیاں~noLinesHere=اس مقام پر ابھی کچھ نہیں گنا گیا۔~confirmedZero=صفر (تصدیق شدہ)~notCountedYet=ابھی نہیں گنا~unexpected=غیر متوقع آئٹم~unexpectedHint=اس مقام کی فہرست میں نہیں۔ اس کا جائزہ لیا جائے گا۔~photosN=%n تصاویر~submitN=%n گنی گئی لائنیں بھیجیں~submitDone=%n لائنیں بھیج دی گئیں۔~submitNothing=بھیجنے سے پہلے ایک لائن مکمل کریں۔~submitOffline=کنکشن نہیں۔ آپ کی گنتیاں اس فون پر محفوظ ہیں؛ سگنل آنے پر دوبارہ بھیجیں۔~submitPartial=کچھ لائنیں قبول نہیں ہوئیں یا ان کی تصاویر اپ لوڈ نہیں ہو سکیں۔ نشان زدہ لائنیں دیکھیں۔~submitFailed=گنتیاں بھیجی نہیں جا سکیں۔ یہ اب بھی اس فون پر محفوظ ہیں۔~draftSaveFailed=یہ فون ابھی گنتی محفوظ نہیں کر سکا۔ ایپ بند نہ کریں؛ دوبارہ کوشش کریں۔~serialCounted=سیریل گن لیا گیا۔~scan_locationSelected=مقام منتخب ہو گیا۔~scan_serialItemSelected=اب ہر یونٹ کا سیریل اسکین کریں۔~scan_locationOutOfScope=یہ مقام اس آڈٹ کا حصہ نہیں ہے۔~scan_duplicateSerial=یہ سیریل اس آڈٹ میں پہلے ہی گنا جا چکا ہے۔~scan_needsLocation=آئٹم گننے سے پہلے مقام کا لیبل اسکین کریں۔~countedQty=گنی گئی مقدار~confirmZero=یہاں کچھ نہیں ملا~confirmZeroHint=دیکھنے کے بعد ہی نشان لگائیں: خالی خانہ صفر کی گنتی نہیں ہے۔~serialOne=ایک سیریل والا یونٹ۔~condition=حالت~condition_good=اچھی~condition_damaged=خراب~condition_repairable=مرمت کے قابل~condition_quarantine=قرنطینہ~condition_scrap=اسکریپ~remarks=ریمارکس (اختیاری)~photo=تصویر~addPhoto=تصویر شامل کریں~photoFailed=تصویر نہیں لی جا سکی۔~removeLine=ہٹائیں~saveLine=محفوظ کریں~enterQty=گنی گئی مقدار درج کریں، یا یہاں کچھ نہیں ملا پر نشان لگائیں۔~invalidQty=مقدار منفی نہیں ہو سکتی۔~confirmZeroFirst=صفر کے لیے یہاں کچھ نہیں ملا پر نشان لگائیں۔~state_draft=فون پر~state_submitted=بھیج دیا~state_rejected=قبول نہیں~status_draft=مسودہ~status_scheduled=شیڈول~status_assigned=تفویض شدہ~status_in_progress=جاری~status_counting_completed=گنتی مکمل~status_reconciliation=مطابقت~status_recount=دوبارہ گنتی~status_investigation=تحقیقات~status_approval=منظوری کا انتظار~status_adjustment_posted=ایڈجسٹمنٹ درج~status_closed=بند~status_cancelled=منسوخ~status_rejected=مسترد~status_unknown=حالت درج نہیں~type_full=مکمل گنتی~type_partial=جزوی گنتی~type_cycle=سائیکل گنتی~type_category=زمرہ گنتی~type_high_value=زیادہ قیمت گنتی~type_surprise=اچانک گنتی~type_bin=بن گنتی~type_tyre_serial=ٹائر سیریل گنتی~type_vehicle_tyre=گاڑی ٹائر گنتی~transfersTitle=اسٹاک منتقلیاں~transfer=منتقلی~noTransfers=کوئی منتقلی نہیں~noTransfersBody=آپ کو کوئی اسٹاک منتقلی نظر نہیں آ رہی۔~tstatus_dispatched=روانہ~tstatus_in_transit=راستے میں~tstatus_partially_received=جزوی وصول~tstatus_completed=مکمل~tstatus_cancelled=منسوخ~tstatus_unknown=حالت درج نہیں~dispatchTitle=اسٹاک روانہ کریں~scanFrom=روانگی کے مقام کا لیبل اسکین کریں~scanTo=منزل کے مقام کا لیبل اسکین کریں~from=سے~to=تک~items=اشیاء~noItemsScanned=ابھی کوئی آئٹم اسکین نہیں ہوا۔~needFrom=وہ مقام اسکین کریں جہاں سے اسٹاک نکلتا ہے۔~needTo=وہ مقام اسکین کریں جہاں اسٹاک جاتا ہے۔~sameLocation=روانگی اور منزل الگ مقام ہونے چاہئیں۔~needLines=کم از کم ایک لائن شامل کریں۔~dispatchSend=روانہ کریں~dispatchDone=منتقلی روانہ ہو گئی۔~transferOffline=کنکشن نہیں۔ کچھ نہیں بھیجا گیا؛ سگنل آنے پر دوبارہ کوشش کریں۔~transferFailed=منتقلی محفوظ نہیں ہو سکی۔~receiveTitle=منتقلی وصول کریں~noLines=اس منتقلی میں کوئی لائن نہیں۔~outstanding=ابھی آنا باقی~outstandingUnknown=بھیجی گئی مقدار درج نہیں~receiveSend=وصولی کی تصدیق کریں~receiveDone=وصولی درج ہو گئی۔~manualSendNote=فی الحال بھیجنا دستی ہے: آپ کی گنتی اس فون پر رہتی ہے جب تک آپ بھیجیں نہ دبائیں۔ خودکار پس منظر ترسیل بعد کی ایپ اپ ڈیٹ کے ساتھ آئے گی۔';
+      'myAuditsTitle=میری گنتیاں~audit=انوینٹری آڈٹ~noAudits=کوئی گنتی تفویض نہیں~noAuditsBody=اس وقت آپ کو کوئی انوینٹری گنتی تفویض نہیں ہے۔~draftsUnreadable=اس فون پر محفوظ گنتیاں ابھی پڑھی نہیں جا سکیں۔ کچھ تبدیل نہیں ہوا۔ دوبارہ کوشش کریں۔~unsyncedLines=%n گنی گئی لائنیں اس فون پر محفوظ ہیں اور ابھی بھیجی نہیں گئیں۔ کھولنے کے لیے دبائیں۔~pendingN=%n نہیں بھیجی گئیں~overdue=تاخیر شدہ~due=آخری تاریخ~notCounting=یہ آڈٹ گنتی کے لیے کھلا نہیں ہے۔~notProvisionedTitle=انوینٹری گنتی ابھی ترتیب نہیں دی گئی~notProvisionedBody=سرور پر ابھی انوینٹری گنتی فعال نہیں ہے۔ آپ کے منتظم کو انوینٹری سیٹ اپ مکمل کرنا ہوگا۔~loadFailed=یہ لوڈ نہیں ہو سکا۔~countTitle=بلائنڈ گنتی~resumed=دوبارہ شروع: آپ کے پچھلے سیشن کی %n لائنیں۔~noLocations=اس آڈٹ میں کوئی مقام نہیں ہے۔~progress=گنے گئے مقامات: %b میں سے %a~linesDone=%n لائنیں گنی گئیں~unexpectedN=%n غیر متوقع~scanLocation=پہلے مقام کا لیبل اسکین کریں~scanItem=آئٹم، سیریل یا بارکوڈ اسکین کریں~scanCamera=کیمرے سے اسکین کریں~locations=مقامات~atLocation=گنتی کا مقام~scanningSerialsOf=سیریل اسکین ہو رہے ہیں~stopSerials=روکیں~serialTracked=سیریل سے ٹریک~linesN=%n لائنیں~myLines=یہاں میری گنتیاں~noLinesHere=اس مقام پر ابھی کچھ نہیں گنا گیا۔~confirmedZero=صفر (تصدیق شدہ)~notCountedYet=ابھی نہیں گنا~unexpected=غیر متوقع آئٹم~unexpectedHint=اس مقام کی فہرست میں نہیں۔ اس کا جائزہ لیا جائے گا۔~photosN=%n تصاویر~submitN=%n گنی گئی لائنیں بھیجیں~submitDone=%n لائنیں بھیج دی گئیں۔~submitNothing=بھیجنے سے پہلے ایک لائن مکمل کریں۔~submitOffline=کنکشن نہیں۔ آپ کی گنتیاں اس فون پر محفوظ ہیں؛ سگنل آنے پر دوبارہ بھیجیں۔~submitPartial=کچھ لائنیں قبول نہیں ہوئیں یا ان کی تصاویر اپ لوڈ نہیں ہو سکیں۔ نشان زدہ لائنیں دیکھیں۔~submitFailed=گنتیاں بھیجی نہیں جا سکیں۔ یہ اب بھی اس فون پر محفوظ ہیں۔~draftSaveFailed=یہ فون ابھی گنتی محفوظ نہیں کر سکا۔ ایپ بند نہ کریں؛ دوبارہ کوشش کریں۔~serialCounted=سیریل گن لیا گیا۔~scan_locationSelected=مقام منتخب ہو گیا۔~scan_serialItemSelected=اب ہر یونٹ کا سیریل اسکین کریں۔~scan_locationOutOfScope=یہ مقام اس آڈٹ کا حصہ نہیں ہے۔~scan_duplicateSerial=یہ سیریل اس آڈٹ میں پہلے ہی گنا جا چکا ہے۔~scan_needsLocation=آئٹم گننے سے پہلے مقام کا لیبل اسکین کریں۔~countedQty=گنی گئی مقدار~confirmZero=یہاں کچھ نہیں ملا~confirmZeroHint=دیکھنے کے بعد ہی نشان لگائیں: خالی خانہ صفر کی گنتی نہیں ہے۔~serialOne=ایک سیریل والا یونٹ۔~condition=حالت~condition_good=اچھی~condition_damaged=خراب~condition_repairable=مرمت کے قابل~condition_quarantine=قرنطینہ~condition_scrap=اسکریپ~remarks=ریمارکس (اختیاری)~photo=تصویر~addPhoto=تصویر شامل کریں~photoFailed=تصویر نہیں لی جا سکی۔~removeLine=ہٹائیں~saveLine=محفوظ کریں~enterQty=گنی گئی مقدار درج کریں، یا یہاں کچھ نہیں ملا پر نشان لگائیں۔~invalidQty=مقدار منفی نہیں ہو سکتی۔~confirmZeroFirst=صفر کے لیے یہاں کچھ نہیں ملا پر نشان لگائیں۔~state_draft=فون پر~state_submitted=بھیج دیا~state_rejected=قبول نہیں~status_draft=مسودہ~status_scheduled=شیڈول~status_assigned=تفویض شدہ~status_in_progress=جاری~status_counting_completed=گنتی مکمل~status_reconciliation=مطابقت~status_recount=دوبارہ گنتی~status_investigation=تحقیقات~status_approval=منظوری کا انتظار~status_adjustment_posted=ایڈجسٹمنٹ درج~status_closed=بند~status_cancelled=منسوخ~status_rejected=مسترد~status_unknown=حالت درج نہیں~type_full=مکمل گنتی~type_partial=جزوی گنتی~type_cycle=سائیکل گنتی~type_category=زمرہ گنتی~type_high_value=زیادہ قیمت گنتی~type_surprise=اچانک گنتی~type_bin=بن گنتی~type_tyre_serial=ٹائر سیریل گنتی~type_vehicle_tyre=گاڑی ٹائر گنتی~transfersTitle=اسٹاک منتقلیاں~transfer=منتقلی~noTransfers=کوئی منتقلی نہیں~noTransfersBody=آپ کو کوئی اسٹاک منتقلی نظر نہیں آ رہی۔~tstatus_dispatched=روانہ~tstatus_in_transit=راستے میں~tstatus_partially_received=جزوی وصول~tstatus_completed=مکمل~tstatus_cancelled=منسوخ~tstatus_unknown=حالت درج نہیں~dispatchTitle=اسٹاک روانہ کریں~scanFrom=روانگی کے مقام کا لیبل اسکین کریں~scanTo=منزل کے مقام کا لیبل اسکین کریں~from=سے~to=تک~items=اشیاء~noItemsScanned=ابھی کوئی آئٹم اسکین نہیں ہوا۔~needFrom=وہ مقام اسکین کریں جہاں سے اسٹاک نکلتا ہے۔~needTo=وہ مقام اسکین کریں جہاں اسٹاک جاتا ہے۔~sameLocation=روانگی اور منزل الگ مقام ہونے چاہئیں۔~needLines=کم از کم ایک لائن شامل کریں۔~dispatchSend=روانہ کریں~dispatchDone=منتقلی روانہ ہو گئی۔~transferOffline=کنکشن نہیں۔ کچھ نہیں بھیجا گیا؛ سگنل آنے پر دوبارہ کوشش کریں۔~transferFailed=منتقلی محفوظ نہیں ہو سکی۔~receiveTitle=منتقلی وصول کریں~noLines=اس منتقلی میں کوئی لائن نہیں۔~outstanding=ابھی آنا باقی~outstandingUnknown=بھیجی گئی مقدار درج نہیں~receiveSend=وصولی کی تصدیق کریں~receiveDone=وصولی درج ہو گئی۔~manualSendNote=آپ کی گنتی اس فون پر رہتی ہے جب تک سرور تصدیق نہ کرے۔ سگنل نہ ہونے پر بغیر تصاویر والی لائنیں کنکشن واپس آنے پر خود بخود بھیجی جاتی ہیں؛ تصاویر والی لائنیں بھیجیں کا انتظار کرتی ہیں۔~submitQueued=کنکشن نہیں ہے۔ %n گنی ہوئی لائنیں کنکشن واپس آنے پر خود بخود بھیجی جائیں گی۔';
 }
diff --git a/tyre_pulse_flutter/test/app/router/inventory_routes_test.dart b/tyre_pulse_flutter/test/app/router/inventory_routes_test.dart
new file mode 100644
index 0000000..1df8631
--- /dev/null
+++ b/tyre_pulse_flutter/test/app/router/inventory_routes_test.dart
@@ -0,0 +1,52 @@
+// Inventory deep links (docs/inventory_reserved_patch.md section 1).
+import 'package:flutter_test/flutter_test.dart';
+import 'package:tyre_pulse/app/router/route_access.dart';
+import 'package:tyre_pulse/app/router/routes.dart';
+
+void main() {
+  const String id = '0b8a4c1e-2f3d-4a5b-9c6d-7e8f9a0b1c2d';
+
+  test('a uuid audit id parses to the blind count of that audit', () {
+    final TpRoute r = InventoryCountRoute.parse(
+      const TpRouteParameters(path: <String, String>{'auditId': id}),
+    );
+    expect(r, isA<InventoryCountRoute>());
+    expect((r as InventoryCountRoute).auditId, id);
+    expect(r.location, '/stock/counts/$id');
+  });
+
+  test('anything else falls back to the audit list, never a count', () {
+    for (final String bad in <String>[
+      '',
+      'not-a-uuid',
+      'counts',
+      "1' or 1=1",
+    ]) {
+      final TpRoute r = InventoryCountRoute.parse(
+        TpRouteParameters(path: <String, String>{'auditId': bad}),
+      );
+      expect(r, isA<InventoryAuditsRoute>(), reason: bad);
+    }
+    expect(
+      InventoryCountRoute.parse(const TpRouteParameters()),
+      isA<InventoryAuditsRoute>(),
+    );
+  });
+
+  test('the routes nest under /stock', () {
+    expect(const InventoryAuditsRoute().location, '/stock/counts');
+    expect(const InventoryTransfersRoute().location, '/stock/transfers');
+  });
+
+  test('all three are guarded by the stock module, like Stock Count', () {
+    for (final String routeId in <String>[
+      TpRouteId.inventoryAudits,
+      TpRouteId.inventoryCount,
+      TpRouteId.inventoryTransfers,
+    ]) {
+      final RouteGuard guard = TpRouteGuards.forRouteId(routeId);
+      expect(guard, isA<ModuleGuarded>(), reason: routeId);
+      expect((guard as ModuleGuarded).module, RouteModule.stock);
+    }
+  });
+}
diff --git a/tyre_pulse_flutter/test/core/sync/command_registry_test.dart b/tyre_pulse_flutter/test/core/sync/command_registry_test.dart
index b648b05..ac4e142 100644
--- a/tyre_pulse_flutter/test/core/sync/command_registry_test.dart
+++ b/tyre_pulse_flutter/test/core/sync/command_registry_test.dart
@@ -15,8 +15,10 @@ void main() {
       }
     });
 
-    test('there are exactly 14 commands - 16 minus the two excluded', () {
-      expect(CommandType.values, hasLength(14));
+    test(
+        'there are exactly 15 commands - 16 minus the two excluded, plus '
+        'INVENTORY_COUNT_LINE', () {
+      expect(CommandType.values, hasLength(15));
     });
 
     test('CHECKLIST_APPROVAL and REPAIR_REQUEST cannot be expressed', () {
@@ -49,6 +51,7 @@ void main() {
         CommandType.reportAccident: 'REPORT_ACCIDENT',
         CommandType.washRecord: 'WASH_RECORD',
         CommandType.workshopEvent: 'WORKSHOP_EVENT',
+        CommandType.inventoryCountLine: 'INVENTORY_COUNT_LINE',
       };
 
       expect(expected, hasLength(CommandType.values.length));
@@ -87,6 +90,7 @@ void main() {
         CommandType.reportAccident: SupabaseTables.accidents,
         CommandType.washRecord: SupabaseTables.washRecords,
         CommandType.workshopEvent: SupabaseTables.techActivityEvents,
+        CommandType.inventoryCountLine: SupabaseTables.inventoryCountLines,
       };
 
       for (final MapEntry<CommandType, String> entry in expected.entries) {
@@ -118,7 +122,8 @@ void main() {
 
     test('every other command is an insert with no match column', () {
       for (final CommandType type in CommandType.values) {
-        if (updateTypes.contains(type)) {
+        if (updateTypes.contains(type) ||
+            type == CommandType.inventoryCountLine) {
           continue;
         }
         final CommandSpec spec = CommandRegistry.specFor(type);
@@ -247,4 +252,34 @@ void main() {
       }
     });
   });
+
+  group('inventory (docs/inventory_reserved_patch.md)', () {
+    test('INVENTORY_COUNT_LINE is the one RPC command, on inv_count_submit',
+        () {
+      final CommandSpec spec =
+          CommandRegistry.specFor(CommandType.inventoryCountLine);
+      expect(spec.operation, CommandOperation.rpc);
+      expect(spec.rpc, 'inv_count_submit');
+      expect(spec.matchColumn, isNull);
+      expect(spec.fieldAllowList, <String>{'audit_id', 'device_id', 'lines'});
+      for (final CommandType t in CommandType.values) {
+        if (t == CommandType.inventoryCountLine) continue;
+        expect(
+          CommandRegistry.specFor(t).operation,
+          isNot(CommandOperation.rpc),
+          reason: '$t',
+        );
+      }
+    });
+
+    test('STOCK_ADJUST is retired and is the only retired command', () {
+      for (final CommandType t in CommandType.values) {
+        expect(
+          CommandRegistry.specFor(t).retiredMessage != null,
+          t == CommandType.stockAdjust,
+          reason: '$t',
+        );
+      }
+    });
+  });
 }
diff --git a/tyre_pulse_flutter/test/core/sync/inventory_count_line_sync_test.dart b/tyre_pulse_flutter/test/core/sync/inventory_count_line_sync_test.dart
new file mode 100644
index 0000000..9298aea
--- /dev/null
+++ b/tyre_pulse_flutter/test/core/sync/inventory_count_line_sync_test.dart
@@ -0,0 +1,177 @@
+// INVENTORY_COUNT_LINE replay and STOCK_ADJUST retirement through the real
+// SyncEngine and an in-memory database (docs/inventory_reserved_patch.md).
+import 'dart:convert';
+
+import 'package:flutter_test/flutter_test.dart';
+import 'package:tyre_pulse/core/database/app_database.dart';
+import 'package:tyre_pulse/core/database/database_constants.dart';
+import 'package:tyre_pulse/core/sync/command_registry.dart';
+import 'package:tyre_pulse/core/sync/sync_engine.dart';
+import 'package:tyre_pulse/core/sync/sync_outcome.dart';
+
+import '../database/database_test_support.dart';
+
+/// Answers every RPC call with a scripted `{accepted, duplicates, rejected}`.
+final class _RpcPusher implements CommandPusher {
+  _RpcPusher(this.answer);
+
+  final Map<String, Object?> answer;
+  final List<Map<String, Object?>> calls = <Map<String, Object?>>[];
+  final List<CommandSpec> specs = <CommandSpec>[];
+
+  @override
+  Future<List<Map<String, Object?>>> push({
+    required CommandSpec spec,
+    required Map<String, Object?> payload,
+    String? matchValue,
+    String? expectedPriorStatus,
+  }) async {
+    calls.add(payload);
+    specs.add(spec);
+    return <Map<String, Object?>>[answer];
+  }
+}
+
+final class _NoUploads implements MediaUploader {
+  @override
+  Future<MediaUploadResult> upload({
+    required String bucket,
+    required String localPath,
+    required String fileName,
+  }) =>
+      throw StateError('no media in these tests');
+}
+
+const String _uuid = '11111111-1111-1111-1111-111111111111';
+
+Map<String, Object?> _line({String? countedAt}) => <String, Object?>{
+      'client_uuid': _uuid,
+      'location_id': 'loc-1',
+      'item_id': 'item-1',
+      'counted_qty': 3,
+      'counted_at': countedAt ?? '2026-11-20T08:00:00.000Z',
+    };
+
+void main() {
+  late AppDatabase db;
+
+  setUp(() => db = newMemoryDatabase());
+  tearDown(() async => db.close());
+
+  Future<void> enqueueLine({Map<String, Object?>? extra}) =>
+      db.queueDao.enqueue(
+        id: 'cmd-line',
+        commandType: 'INVENTORY_COUNT_LINE',
+        entityType: 'inventory_count_lines',
+        payloadJson: jsonEncode(<String, Object?>{
+          'audit_id': 'audit-1',
+          'device_id': 'device-1',
+          'lines': <Object?>[_line()],
+          ...?extra,
+        }),
+        createdBy: testUser,
+        workspaceId: workspaceA,
+        now: testNow,
+        idempotencyKey: _uuid,
+      );
+
+  SyncEngine engine(CommandPusher pusher) => SyncEngine(
+        queueDao: db.queueDao,
+        mediaDao: db.mediaDao,
+        pusher: pusher,
+        uploader: _NoUploads(),
+        holderId: 'engine-under-test',
+      );
+
+  test('an accepted line is synced; the call carries only the allow-list',
+      () async {
+    await enqueueLine(extra: <String, Object?>{'expected_qty': 99});
+    final _RpcPusher pusher = _RpcPusher(<String, Object?>{
+      'accepted': <String>[_uuid],
+    });
+    final SyncRunSummary s =
+        await engine(pusher).runOnce(workspaceId: workspaceA, now: testNow);
+    expect(s.synced, 1);
+    expect(pusher.specs.single.operation, CommandOperation.rpc);
+    expect(pusher.specs.single.rpc, 'inv_count_submit');
+    expect(
+      pusher.calls.single.keys.toSet(),
+      <String>{'audit_id', 'device_id', 'lines'},
+      reason: 'expected_qty must never reach the server from the phone',
+    );
+  });
+
+  test('a replay answered as a duplicate is synced, not failed', () async {
+    await enqueueLine();
+    final _RpcPusher pusher = _RpcPusher(<String, Object?>{
+      'accepted': <String>[],
+      'duplicates': <String>[_uuid],
+    });
+    final SyncRunSummary s =
+        await engine(pusher).runOnce(workspaceId: workspaceA, now: testNow);
+    expect(s.synced, 1);
+    expect(s.failed, 0);
+  });
+
+  test('a refusal is a conflict carrying the server reason', () async {
+    await enqueueLine();
+    final _RpcPusher pusher = _RpcPusher(<String, Object?>{
+      'rejected': <Object?>[
+        <String, Object?>{'client_uuid': _uuid, 'reason': 'Audit is closed'},
+      ],
+    });
+    final SyncRunSummary s =
+        await engine(pusher).runOnce(workspaceId: workspaceA, now: testNow);
+    expect(s.conflicted, 1);
+    final PendingCommand? stored = await db.queueDao.commandById('cmd-line');
+    expect(stored!.lastError, 'Audit is closed');
+  });
+
+  test('an answer that does not name the line is not counted as stored',
+      () async {
+    await enqueueLine();
+    final SyncRunSummary s = await engine(_RpcPusher(<String, Object?>{}))
+        .runOnce(workspaceId: workspaceA, now: testNow);
+    expect(s.synced, 0);
+    expect(s.failed, 1);
+  });
+
+  test('a late line keeps its counting time, not the replay time', () async {
+    await enqueueLine();
+    final _RpcPusher pusher = _RpcPusher(<String, Object?>{
+      'accepted': <String>[_uuid],
+    });
+    await engine(pusher).runOnce(
+      workspaceId: workspaceA,
+      now: testNow.add(const Duration(days: 2)),
+    );
+    final List<Object?> lines = pusher.calls.single['lines']! as List<Object?>;
+    expect(
+      (lines.single! as Map<String, Object?>)['counted_at'],
+      '2026-11-20T08:00:00.000Z',
+    );
+  });
+
+  test('a queued STOCK_ADJUST is failed and never reaches the server',
+      () async {
+    await db.queueDao.enqueue(
+      id: 'cmd-old',
+      commandType: 'STOCK_ADJUST',
+      entityType: 'stock_records',
+      payloadJson: jsonEncode(<String, Object?>{'id': 's1', 'stock_qty': 4}),
+      createdBy: testUser,
+      workspaceId: workspaceA,
+      now: testNow,
+      idempotencyKey: 'idem-old',
+      entityId: 's1',
+    );
+    final _RpcPusher pusher = _RpcPusher(<String, Object?>{});
+    final SyncRunSummary s =
+        await engine(pusher).runOnce(workspaceId: workspaceA, now: testNow);
+    expect(s.failed, 1);
+    expect(pusher.calls, isEmpty);
+    final PendingCommand? stored = await db.queueDao.commandById('cmd-old');
+    expect(stored!.lastError, contains('Count the item again'));
+    expect(stored.status, isNot(CommandStatus.synced));
+  });
+}
````
