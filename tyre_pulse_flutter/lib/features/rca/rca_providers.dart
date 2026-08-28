library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/rca/data/rca_photo_capture.dart';
import 'package:tyre_pulse/features/rca/data/rca_repository.dart';
import 'package:tyre_pulse/features/rca/domain/rca_record.dart';

final Provider<RcaRepository> rcaRepositoryProvider = Provider<RcaRepository>(
  (Ref ref) {
    final AppDatabase db = ref.watch(appDatabaseProvider);
    return DefaultRcaRepository(
      ref.watch(supabaseClientProvider),
      QueuedCommandRepository(db.queueDao),
    );
  },
);

final FutureProvider<List<RcaRecord>> rcaRecordsProvider =
    FutureProvider<List<RcaRecord>>((Ref ref) {
  return ref.watch(rcaRepositoryProvider).listRecent(
        country: ref.watch(activeCountryProvider),
      );
});

final Provider<RcaPhotoCapture> rcaPhotoCaptureProvider =
    Provider<RcaPhotoCapture>((Ref ref) => RcaPhotoCapture());
