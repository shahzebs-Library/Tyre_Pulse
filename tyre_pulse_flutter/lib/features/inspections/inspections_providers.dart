/// Riverpod wiring for the inspections feature.
///
/// Follows the precedent `features/assets/presentation/
/// vehicle_fleet_providers.dart` already set for a feature that needs the
/// local database before the composition root exposes a canonical
/// instance: [appDatabaseProvider] THROWS rather than silently
/// constructing a second connection to the on-device SQLite file, because
/// draft persistence is this feature's whole reason for existing (risk
/// R2) and a feature that quietly disabled it would be worse than one
/// that refuses to build until it is wired correctly. A LATER integration
/// pass overrides this at the composition root with the app's one real
/// `AppDatabase` instance - the same "later phase" `vehicle_fleet_
/// providers.dart`'s own comment and `background_sync.dart`'s `main.dart`
/// wiring are both already deferred to.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_gps_source.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_uploader.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_sync_engine.dart';

/// See the library comment. Override at the composition root.
final Provider<AppDatabase> appDatabaseProvider = Provider<AppDatabase>((
  ref,
) {
  throw UnimplementedError(
    'appDatabaseProvider has no value. Override it at the composition '
    'root with the app\'s one AppDatabase instance once core/database '
    'exposes a canonical provider for it.',
  );
});

final Provider<InspectionDraftRepository> inspectionDraftRepositoryProvider =
    Provider<InspectionDraftRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return DriftInspectionDraftRepository(db.draftsDao, db.mediaDao);
});

final Provider<InspectionRemoteRepository> inspectionRemoteRepositoryProvider =
    Provider<InspectionRemoteRepository>(
  (ref) => SupabaseInspectionRemoteRepository(
    ref.watch(supabaseClientProvider),
  ),
);

final Provider<InspectionPhotoUploader> inspectionPhotoUploaderProvider =
    Provider<InspectionPhotoUploader>(
  (ref) => SupabaseInspectionPhotoUploader(ref.watch(supabaseClientProvider)),
);

/// Real by default - unlike [appDatabaseProvider], this needs nothing
/// overridden to work: `path_provider` resolves the app's own documents
/// directory the same way on every real device.
final Provider<InspectionSubmissionQueue> inspectionSubmissionQueueProvider =
    Provider<InspectionSubmissionQueue>(
  (ref) => FileInspectionSubmissionQueue(),
);

final Provider<InspectionSyncEngine> inspectionSyncEngineProvider =
    Provider<InspectionSyncEngine>(
  (ref) => InspectionSyncEngine(
    draftRepository: ref.watch(inspectionDraftRepositoryProvider),
    queue: ref.watch(inspectionSubmissionQueueProvider),
    remote: ref.watch(inspectionRemoteRepositoryProvider),
    photoUploader: ref.watch(inspectionPhotoUploaderProvider),
  ),
);

final Provider<InspectionPhotoCapture> inspectionPhotoCaptureProvider =
    Provider<InspectionPhotoCapture>((ref) => InspectionPhotoCapture());

final Provider<InspectionGpsSource> inspectionGpsSourceProvider =
    Provider<InspectionGpsSource>((ref) => InspectionGpsSource());

/// Live count of not-yet-synced queued inspections, for a badge. Refreshed
/// by whoever calls [ref.invalidate] after a queue mutation - there is no
/// filesystem watcher wiring anything automatically, matching this
/// project's existing polling-over-watching choices elsewhere (spec
/// section 64: no dependency added to watch a folder for a count a screen
/// can simply re-ask for on its own lifecycle events).
final FutureProvider<int> inspectionPendingCountProvider =
    FutureProvider<int>(
  (ref) => ref.watch(inspectionSubmissionQueueProvider).pendingCount(),
);
