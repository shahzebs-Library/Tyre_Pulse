library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/data/accident_report_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_repository.dart';

final accidentRemoteSourceProvider = Provider<AccidentRemoteSource>(
  (ref) => SupabaseAccidentRemoteSource(ref.watch(supabaseClientProvider)),
);

final accidentRepositoryProvider = Provider<AccidentRepository>(
  (ref) => SupabaseAccidentRepository(ref.watch(accidentRemoteSourceProvider)),
);

final accidentPhotoCaptureProvider = Provider<AccidentPhotoCapture>(
  (ref) => AccidentPhotoCapture(),
);

final accidentQueuedCommandRepositoryProvider =
    Provider<QueuedCommandRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return QueuedCommandRepository(db.queueDao);
});

final accidentReportRepositoryProvider = Provider<AccidentReportRepository>(
  (ref) => OfflineAccidentReportRepository(
    ref.watch(accidentQueuedCommandRepositoryProvider),
  ),
);

/// One short-lived display URL for one private accident-evidence reference.
///
/// Keeping this auto-disposed prevents a signed URL from being retained after
/// its evidence tile leaves the widget tree. Resolution stays behind the
/// authenticated storage resolver; presentation code never calls Supabase.
final accidentEvidenceUrlProvider =
    FutureProvider.autoDispose.family<String, String>(
  (ref, reference) =>
      ref.watch(privateStorageReferenceResolverProvider).resolve(reference),
  // A denied or malformed reference needs an honest error state and an
  // explicit user retry, rather than Riverpod repeatedly re-signing it.
  retry: (int retryCount, Object error) => null,
);
