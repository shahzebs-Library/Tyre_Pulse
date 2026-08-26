/// Riverpod wiring for the inspections feature.
///
/// [appDatabaseProvider] now lives at `core/database/app_database_
/// provider.dart` - see that file's library comment for why it moved out of
/// here the moment a second feature (checklists) needed the same local
/// database. This file re-exports nothing; it imports the canonical provider
/// like any other consumer.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_gps_source.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_uploader.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_sync_engine.dart';

final Provider<InspectionDraftRepository> inspectionDraftRepositoryProvider =
    Provider<InspectionDraftRepository>((ref) {
      final AppDatabase db = ref.watch(appDatabaseProvider);
      return DriftInspectionDraftRepository(db.draftsDao, db.mediaDao);
    });

final Provider<InspectionRemoteRepository> inspectionRemoteRepositoryProvider =
    Provider<InspectionRemoteRepository>(
      (ref) =>
          SupabaseInspectionRemoteRepository(ref.watch(supabaseClientProvider)),
    );

final Provider<InspectionPhotoUploader> inspectionPhotoUploaderProvider =
    Provider<InspectionPhotoUploader>(
      (ref) =>
          SupabaseInspectionPhotoUploader(ref.watch(supabaseClientProvider)),
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
final FutureProvider<int> inspectionPendingCountProvider = FutureProvider<int>(
  (ref) => ref.watch(inspectionSubmissionQueueProvider).pendingCount(),
);
