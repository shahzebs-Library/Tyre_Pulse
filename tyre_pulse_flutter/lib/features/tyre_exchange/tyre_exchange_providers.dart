/// Riverpod wiring for the tyre replacement feature.
///
/// Small providers, mirroring `features/washing/washing_providers.dart` and
/// `features/meter_logs/meter_logs_providers.dart`'s own minimal shape.
///
/// # `QueuedCommandRepository` is declared here, not shared
///
/// Same reasoning as those two files' own library comments: there is no
/// shared, cross-feature provider for [QueuedCommandRepository] anywhere in
/// this codebase yet, it is a thin wrapper over [AppDatabase.queueDao], and
/// declaring it per-feature costs nothing beyond one object construction. A
/// later phase that gives it a shared home can do so without changing what
/// this feature depends on.
///
/// # `VehicleFleetRepository` is NOT re-declared here
///
/// Asset lookup for auto-fill reuses `features/assets`'s own
/// `vehicleFleetRepositoryProvider`
/// (`features/assets/presentation/vehicle_fleet_providers.dart`) directly -
/// mirroring exactly how `washing_screen.dart` and `meter_log_screen.dart`
/// already consume that provider from their own top-level features. See
/// this feature's presentation screen for the import.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/features/tyre_exchange/data/tyre_replacement_photo_capture.dart';
import 'package:tyre_pulse/features/tyre_exchange/data/tyre_replacement_repository.dart';

/// See the library comment on why this is declared in this feature's own
/// provider file rather than a cross-feature one.
final Provider<QueuedCommandRepository>
    tyreReplacementQueuedCommandRepositoryProvider =
    Provider<QueuedCommandRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return QueuedCommandRepository(db.queueDao);
});

final Provider<TyreReplacementRepository> tyreReplacementRepositoryProvider =
    Provider<TyreReplacementRepository>(
  (ref) => DefaultTyreReplacementRepository(
    ref.watch(tyreReplacementQueuedCommandRepositoryProvider),
  ),
);

/// Real by default - `image_picker`/`path_provider` resolve the same way on
/// every real device, matching `washPhotoCaptureProvider`'s own note.
final Provider<TyreReplacementPhotoCapture>
    tyreReplacementPhotoCaptureProvider = Provider<TyreReplacementPhotoCapture>(
  (ref) => TyreReplacementPhotoCapture(),
);
