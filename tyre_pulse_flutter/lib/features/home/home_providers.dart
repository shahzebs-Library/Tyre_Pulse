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
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/permissions/inspection_signers.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/home/data/home_repository.dart';
import 'package:tyre_pulse/features/home/domain/home_work.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';

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

/// Home's server reads (exact approvals count, recent inspected assets).
final Provider<HomeRemoteRepository> homeRemoteRepositoryProvider =
    Provider<HomeRemoteRepository>(
  (ref) => SupabaseHomeRemoteRepository(ref.watch(supabaseClientProvider)),
);

/// Whether the signed-in role would pass `decide_inspection_approval`'s own
/// role gate (V606) - see `core/permissions/inspection_signers.dart`. Reaching
/// the approvals module is not enough: a Manager can read the queue but the
/// server refuses their signature, so Home must not count sheets as
/// "awaiting" them.
final Provider<bool> homeCanSignInspectionApprovalsProvider = Provider<bool>(
  (ref) => canSignInspectionApprovals(ref.watch(accessStateProvider)),
);

/// Pending inspection sign-offs for Home's "Awaiting signature" row.
///
/// An EXACT server count (PostgREST `count=exact`), never the length of a
/// bounded page. The screen watches this only for a role that can both reach
/// approvals and sign. Errors stay as [AsyncError] so Home renders "Could not
/// check" instead of inventing a zero.
final FutureProvider<HomePendingApprovals>
    homePendingInspectionApprovalsProvider =
    FutureProvider<HomePendingApprovals>((ref) {
  return ref.watch(homeRemoteRepositoryProvider).pendingInspectionApprovals(
        country: ref.watch(activeCountryProvider),
      );
});

/// The newest unfinished inspection draft for the signed-in user in the
/// active workspace and country, or null - as a LIVE stream.
///
/// Home stays mounted underneath the wizard, so a one-shot read went stale
/// the moment a draft was submitted or discarded. This watches the draft
/// store instead ([HomeDraftSource.watchLatest]), filtered by user, by the
/// workspace the draft was saved under ([homeDraftWorkspaceIds]) and by the
/// active country, and counts a draft only when it has real content
/// (progress, a photo or a signature) - the wizard's own `hasContent` test.
///
/// Emits null when nobody is signed into a workspace: with no user there is
/// genuinely no draft to show, not an unknown value.
final StreamProvider<InspectionDraftSummary?>
    homeLatestInspectionDraftProvider =
    StreamProvider<InspectionDraftSummary?>((ref) {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  final String userId = workspace?.userId.trim() ?? '';
  if (workspace == null || userId.isEmpty) {
    return Stream<InspectionDraftSummary?>.value(null);
  }
  return HomeDraftSource(ref.watch(appDatabaseProvider)).watchLatest(
    userId: userId,
    workspaceIds: homeDraftWorkspaceIds(workspace),
    activeCountry: ref.watch(activeCountryProvider),
  );
});

/// The assets the signed-in user inspected most recently, newest first,
/// each with the worst tyre condition that inspection recorded.
///
/// Empty when nobody is signed in. Errors stay as [AsyncError].
final FutureProvider<List<HomeRecentAsset>> homeRecentAssetsProvider =
    FutureProvider<List<HomeRecentAsset>>((ref) async {
  final String userId =
      ref.watch(workspaceContextProvider)?.userId.trim() ?? '';
  if (userId.isEmpty) return const <HomeRecentAsset>[];
  return ref.watch(homeRemoteRepositoryProvider).recentInspectedAssets(
        userId: userId,
        country: ref.watch(activeCountryProvider),
      );
});
