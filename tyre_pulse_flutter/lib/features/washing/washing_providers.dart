/// Riverpod wiring for the vehicle washing feature.
///
/// Mirrors `features/meter_logs/meter_logs_providers.dart`'s own minimal
/// shape - see that file's library comment for why [QueuedCommandRepository]
/// is declared per-feature here rather than shared.
library;

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_gps_source.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';
import 'package:tyre_pulse/features/washing/data/wash_photo_capture.dart';
import 'package:tyre_pulse/features/washing/data/wash_repository.dart';

final Provider<QueuedCommandRepository> washQueuedCommandRepositoryProvider =
    Provider<QueuedCommandRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return QueuedCommandRepository(db.queueDao);
});

final Provider<WashRepository> washRepositoryProvider =
    Provider<WashRepository>(
  (ref) => SupabaseWashRepository(
    ref.watch(supabaseClientProvider),
    ref.watch(washQueuedCommandRepositoryProvider),
  ),
);

/// Real by default, matching `meterLogPhotoCaptureProvider`'s own note.
final Provider<WashPhotoCapture> washPhotoCaptureProvider =
    Provider<WashPhotoCapture>((ref) => WashPhotoCapture());

/// Whether the device reports any network, read once after a wash is saved
/// so the confirmation can say "uploading now" or "saved offline". Null when
/// the platform cannot tell (no plugin in tests, unsupported platform) - the
/// screen then falls back to the neutral "saved on this device" wording.
/// Overridden in tests.
final Provider<Future<bool?> Function()> washOnlineCheckProvider =
    Provider<Future<bool?> Function()>(
  (Ref ref) => () async {
    try {
      final List<ConnectivityResult> results =
          await Connectivity().checkConnectivity();
      return results
          .any((ConnectivityResult r) => r != ConnectivityResult.none);
    } on Object {
      return null;
    }
  },
);

/// One best-effort GPS fix for a wash photo stamp, reusing the inspection
/// GPS source (bounded wait, never throws). Null when location is off,
/// denied or too slow; the photo is still kept and its stamp says "No GPS".
/// Overridden in tests.
final Provider<Future<InspectionGpsFix?> Function()> washLocateProvider =
    Provider<Future<InspectionGpsFix?> Function()>(
  (Ref ref) => () async => (await InspectionGpsSource().captureFix()).fix,
);
