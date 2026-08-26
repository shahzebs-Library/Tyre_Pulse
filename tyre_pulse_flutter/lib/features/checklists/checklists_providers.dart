/// Riverpod wiring for the checklists feature.
///
/// [appDatabaseProvider] is the canonical, cross-feature database handle
/// (`core/database/app_database_provider.dart`) - this file imports it like
/// any other consumer rather than redeclaring it.
///
/// # `QueuedCommandRepository` is declared HERE
///
/// There is no shared, cross-feature provider for
/// `lib/core/sync/queued_command_repository.dart`'s
/// [QueuedCommandRepository] anywhere in this codebase yet - verified by
/// grep before writing this file. It is a thin wrapper over
/// `AppDatabase.queueDao`, so declaring it here costs nothing beyond a
/// single object construction; a later phase that gives it a shared,
/// feature-independent home can do so without changing what this feature
/// depends on, since the underlying Drift tables are the same either way.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_history_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_photo_capture.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_submission_repository.dart';

final Provider<ChecklistRemoteRepository> checklistRemoteRepositoryProvider =
    Provider<ChecklistRemoteRepository>(
  (ref) => SupabaseChecklistRemoteRepository(ref.watch(supabaseClientProvider)),
);

final Provider<ChecklistDraftRepository> checklistDraftRepositoryProvider =
    Provider<ChecklistDraftRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return DriftChecklistDraftRepository(db.draftsDao, db.mediaDao);
});

/// See the library comment on why this is declared in this feature's own
/// provider file rather than a cross-feature one.
final Provider<QueuedCommandRepository> checklistQueuedCommandRepositoryProvider =
    Provider<QueuedCommandRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return QueuedCommandRepository(db.queueDao);
});

final Provider<ChecklistSubmissionRepository>
    checklistSubmissionRepositoryProvider =
    Provider<ChecklistSubmissionRepository>(
  (ref) => DefaultChecklistSubmissionRepository(
    commandRepository: ref.watch(checklistQueuedCommandRepositoryProvider),
    draftRepository: ref.watch(checklistDraftRepositoryProvider),
  ),
);

final Provider<ChecklistHistoryRepository> checklistHistoryRepositoryProvider =
    Provider<ChecklistHistoryRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return DefaultChecklistHistoryRepository(
    queueDao: db.queueDao,
    loadCompleted: (String submittedBy) => ref
        .read(checklistRemoteRepositoryProvider)
        .myHistory(submittedBy: submittedBy),
  );
});

/// Real by default - `image_picker`/`path_provider` resolve the same way on
/// every real device, matching `inspectionPhotoCaptureProvider`'s own note.
final Provider<ChecklistPhotoCapture> checklistPhotoCaptureProvider =
    Provider<ChecklistPhotoCapture>((ref) => ChecklistPhotoCapture());
