/// Riverpod wiring for the handover feature.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/handover/data/handover_draft_store.dart';
import 'package:tyre_pulse/features/handover/data/handover_photo_capture.dart';
import 'package:tyre_pulse/features/handover/data/handover_photo_uploader.dart';
import 'package:tyre_pulse/features/handover/data/handover_remote_repository.dart';
import 'package:tyre_pulse/features/handover/data/handover_submission_queue.dart';
import 'package:tyre_pulse/features/handover/data/handover_sync_engine.dart';
import 'package:tyre_pulse/features/handover/domain/handover_record.dart';

final Provider<HandoverRemoteRepository> handoverRemoteRepositoryProvider =
    Provider<HandoverRemoteRepository>(
  (ref) => SupabaseHandoverRemoteRepository(ref.watch(supabaseClientProvider)),
);

final Provider<HandoverPhotoUploader> handoverPhotoUploaderProvider =
    Provider<HandoverPhotoUploader>(
  (ref) => SupabaseHandoverPhotoUploader(ref.watch(supabaseClientProvider)),
);

final Provider<HandoverPhotoCapture> handoverPhotoCaptureProvider =
    Provider<HandoverPhotoCapture>((ref) => HandoverPhotoCapture());

final Provider<HandoverDraftStore> handoverDraftStoreProvider =
    Provider<HandoverDraftStore>((ref) => FileHandoverDraftStore());

/// Real by default - `path_provider` resolves the app documents directory the
/// same way on every real device, so no override is needed to use it for real.
final Provider<HandoverSubmissionQueue> handoverSubmissionQueueProvider =
    Provider<HandoverSubmissionQueue>(
  (ref) => FileHandoverSubmissionQueue(),
);

final Provider<HandoverSyncEngine> handoverSyncEngineProvider =
    Provider<HandoverSyncEngine>(
  (ref) => HandoverSyncEngine(
    queue: ref.watch(handoverSubmissionQueueProvider),
    remote: ref.watch(handoverRemoteRepositoryProvider),
    photoUploader: ref.watch(handoverPhotoUploaderProvider),
  ),
);

/// Live count of not-yet-synced queued handovers, for a badge. Refreshed by
/// whoever calls [ref.invalidate] after a queue mutation - the same
/// polling-over-watching choice the inspection queue count makes.
final FutureProvider<int> handoverPendingCountProvider = FutureProvider<int>(
  (ref) => ref.watch(handoverSubmissionQueueProvider).pendingCount(),
);

/// The signed-in person's own submitted handovers.
///
/// Returns an EMPTY list - not an error - when there is no session yet, so the
/// history screen shows "nothing yet" during sign-in rather than a failure.
final FutureProvider<List<HandoverRecord>> myHandoversProvider =
    FutureProvider<List<HandoverRecord>>((ref) async {
  final WorkspaceContext? context = ref.watch(workspaceContextProvider);
  final String userId = context?.userId ?? '';
  if (userId.isEmpty) return const <HandoverRecord>[];
  return ref
      .watch(handoverRemoteRepositoryProvider)
      .myHandovers(createdBy: userId);
});

/// Handovers awaiting a sign-off, for the signer queue.
final FutureProvider<List<HandoverRecord>> pendingHandoversProvider =
    FutureProvider<List<HandoverRecord>>((ref) async {
  final WorkspaceContext? context = ref.watch(workspaceContextProvider);
  if (context == null) return const <HandoverRecord>[];
  return ref
      .watch(handoverRemoteRepositoryProvider)
      .pendingHandovers(country: context.activeCountry);
});
