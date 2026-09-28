/// Riverpod wiring owned by the Profile screen.
///
/// # Why Profile has its own pending-sync provider
///
/// Profile used to read `homePendingSyncCountProvider`, a one-shot
/// [FutureProvider] that nothing invalidates. Profile is an anchored branch
/// that stays mounted, so its "Pending sync" count and the unsynced-work line
/// under Sign out went stale the moment a sync finished (or a new item was
/// queued) while the screen was open - exactly the line a person reads before
/// deciding whether it is safe to sign out.
///
/// [profilePendingSyncCountProvider] WATCHES the queue instead, through
/// [QueueDao.watchPendingCount] (a Drift watch query over
/// `pending_commands`), so it re-emits on every enqueue, sync and prune.
///
/// This file MUST NOT import `core/sync/command_registry.dart`,
/// `core/sync/queued_command_repository.dart` or `core/sync/sync_engine.dart`:
/// Profile only ever reads a count through `QueueDao`.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';

/// Every queued command not yet `synced` for the active workspace, live.
///
/// Emits 0 when there is no active [WorkspaceContext] - with nobody signed
/// into a workspace nothing is queued for this screen to report. A database
/// read failure stays an [AsyncError] so the screen renders `-`, never 0.
final StreamProvider<int> profilePendingSyncCountProvider =
    StreamProvider<int>((ref) {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  if (workspace == null) return Stream<int>.value(0);
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return db.queueDao.watchPendingCount(
    workspaceId: workspaceIdFor(workspace),
  );
});
