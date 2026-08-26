/// Riverpod wiring for the daily meter log feature.
///
/// Small providers, mirroring `features/approvals/inspection_approvals_
/// providers.dart`'s own minimal shape.
///
/// # `QueuedCommandRepository` is declared here, not shared
///
/// Same reasoning as `features/checklists/checklists_providers.dart`'s own
/// library comment: there is no shared, cross-feature provider for
/// [QueuedCommandRepository] anywhere in this codebase yet, it is a thin
/// wrapper over [AppDatabase.queueDao], and declaring it per-feature costs
/// nothing beyond one object construction. A later phase that gives it a
/// shared home can do so without changing what this feature depends on.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/features/meter_logs/data/meter_log_photo_capture.dart';
import 'package:tyre_pulse/features/meter_logs/data/meter_log_repository.dart';

/// See the library comment on why this is declared in this feature's own
/// provider file rather than a cross-feature one.
final Provider<QueuedCommandRepository> meterLogQueuedCommandRepositoryProvider =
    Provider<QueuedCommandRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return QueuedCommandRepository(db.queueDao);
});

final Provider<MeterLogRepository> meterLogRepositoryProvider =
    Provider<MeterLogRepository>(
  (ref) => SupabaseMeterLogRepository(
    ref.watch(supabaseClientProvider),
    ref.watch(meterLogQueuedCommandRepositoryProvider),
  ),
);

/// Real by default - `image_picker`/`path_provider` resolve the same way on
/// every real device, matching `checklistPhotoCaptureProvider`'s own note.
final Provider<MeterLogPhotoCapture> meterLogPhotoCaptureProvider =
    Provider<MeterLogPhotoCapture>((ref) => MeterLogPhotoCapture());
