/// Riverpod wiring for the Home hub screen.
///
/// # Why the pending-sync count is declared here, not shared
///
/// Same reasoning as `features/meter_logs/meter_logs_providers.dart`'s own
/// library comment (which this mirrors almost exactly): there is no shared,
/// cross-feature provider for reading the offline queue from a UI anywhere in
/// this codebase yet, it is a thin read over `AppDatabase.queueDao`, and
/// declaring it per-feature costs nothing beyond one small provider. A later
/// phase that gives it a shared home can do so without changing what Home
/// depends on.
///
/// This file MUST NOT import anything from `core/sync/command_registry.dart`,
/// `core/sync/queued_command_repository.dart` or `core/sync/sync_engine.dart`
/// - those three are forbidden to edit and, more to the point, this screen
/// has no business enqueuing or replaying commands. It only ever reads a
/// count through `QueueDao`, the same DAO those files themselves read from.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';

/// The number Home's sync indicator shows: every queued command not yet
/// marked `synced` for the active workspace, [QueueDao.pendingCount]'s own
/// documentation. That documentation records why this counts more than the
/// literal `pending` status: counting only `pending` made every badge read 0
/// the moment an item failed, silently hiding exactly the items a person most
/// needs to see.
///
/// Resolves to 0, never to an error, when there is no active
/// [WorkspaceContext] - with nobody signed into a workspace there is
/// genuinely nothing queued for this screen to report, not an unknown value.
final FutureProvider<int> homePendingSyncCountProvider = FutureProvider<int>((
  ref,
) async {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  if (workspace == null) return 0;
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return db.queueDao.pendingCount(workspaceId: workspaceIdFor(workspace));
});
