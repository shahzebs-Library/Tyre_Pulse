/// Providers and the sync coordinator for offline assignment updates.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show SupabaseClient;
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_cache.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_view.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_sync_engine.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_transition_queue.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_transition_remote.dart';

final Provider<WorkforceAssignmentCache> workforceAssignmentCacheProvider =
    Provider<WorkforceAssignmentCache>((Ref ref) {
  return WorkforceAssignmentCache(ref.watch(secureStoreProvider));
});

/// Typed as the source interface so tests can substitute a fake. Reads use the
/// identity-scoped, expiring, sign-out-cleared encrypted cache.
final Provider<WorkforceAssignmentsSource>
    workforceAssignmentsRepositoryProvider =
    Provider<WorkforceAssignmentsSource>((Ref ref) {
  return WorkforceAssignmentsRepository(
    ref.watch(supabaseClientProvider),
    ref.watch(workforceAssignmentCacheProvider),
  );
});

final workforceAssignmentsProvider =
    FutureProvider.autoDispose<WorkforceAssignmentSnapshot>(
  (Ref ref) async {
    return ref.read(workforceAssignmentsRepositoryProvider).listMine();
  },
  // A failed read shows an honest error with an explicit Retry button instead
  // of silently re-querying in the background.
  retry: (int retryCount, Object error) => null,
);

final Provider<WorkforceTransitionQueue> workforceTransitionQueueProvider =
    Provider<WorkforceTransitionQueue>((Ref ref) {
  return FileWorkforceTransitionQueue();
});

final Provider<WorkforceTransitionRemote> workforceTransitionRemoteProvider =
    Provider<WorkforceTransitionRemote>((Ref ref) {
  return SupabaseWorkforceTransitionRemote(ref.watch(supabaseClientProvider));
});

final Provider<WorkforceTransitionEngine> workforceTransitionEngineProvider =
    Provider<WorkforceTransitionEngine>((Ref ref) {
  final SupabaseClient client = ref.watch(supabaseClientProvider);
  return WorkforceTransitionEngine(
    queue: ref.watch(workforceTransitionQueueProvider),
    remote: ref.watch(workforceTransitionRemoteProvider),
    sessionUserId: () => client.auth.currentUser?.id,
  );
});

/// The signed-in user's id, or null while signed out / restoring.
final Provider<String?> workforceUserIdProvider = Provider<String?>((Ref ref) {
  final AuthState auth = ref.watch(authControllerProvider);
  return auth.sessionPhase == AuthSessionPhase.authenticated
      ? auth.userId
      : null;
});

/// This user's unsent / refused updates. Invalidate after any queue change.
final workforceQueuedProvider =
    FutureProvider.autoDispose<List<QueuedWorkforceTransition>>((
  Ref ref,
) async {
  final String? userId = ref.watch(workforceUserIdProvider);
  if (userId == null) return const <QueuedWorkforceTransition>[];
  return ref.read(workforceTransitionEngineProvider).list(userId);
});

/// Server assignments with this device's queue applied. Refreshes whenever
/// either input does. Offline, the cached assignments are shown with the
/// pending updates on top.
final workforceAssignmentViewsProvider =
    FutureProvider.autoDispose<WorkforceAssignmentViewState>((Ref ref) async {
  final WorkforceAssignmentSnapshot snapshot =
      await ref.watch(workforceAssignmentsProvider.future);
  final List<QueuedWorkforceTransition> queued =
      await ref.watch(workforceQueuedProvider.future);
  return WorkforceAssignmentViewState(
    views: buildWorkforceViews(snapshot.items, queued),
    offline: snapshot.offline,
  );
});

final class WorkforceAssignmentViewState {
  const WorkforceAssignmentViewState({
    required this.views,
    required this.offline,
  });

  final List<WorkforceAssignmentView> views;
  final bool offline;
}

/// Decides WHEN to deliver. The engine decides how. Plain Dart so the triggers
/// (sign-in, app resume, connectivity regained, a tap) are testable without a
/// widget tree; the binding widget only forwards platform events here.
final class WorkforceSyncCoordinator {
  WorkforceSyncCoordinator({
    required WorkforceTransitionEngine engine,
    required void Function() onSettled,
  })  : _engine = engine,
        _onSettled = onSettled;

  final WorkforceTransitionEngine _engine;
  final void Function() _onSettled;
  String? _userId;

  String? get userId => _userId;

  Future<WorkforceFlushSummary> signedIn(String userId) {
    _userId = userId;
    return _flush();
  }

  void signedOut() {
    _userId = null;
  }

  Future<WorkforceFlushSummary> resumed() => _flush();

  Future<WorkforceFlushSummary> connectivityChanged({required bool online}) {
    if (!online) {
      return Future<WorkforceFlushSummary>.value(const WorkforceFlushSummary());
    }
    return _flush();
  }

  Future<WorkforceFlushSummary> _flush() async {
    final String? userId = _userId;
    if (userId == null) return const WorkforceFlushSummary();
    final WorkforceFlushSummary summary = await _engine.flush(userId);
    if (summary.changedServerState) _onSettled();
    return summary;
  }
}
