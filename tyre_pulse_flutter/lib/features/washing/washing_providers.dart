/// Riverpod wiring for the vehicle washing feature.
///
/// Mirrors `features/meter_logs/meter_logs_providers.dart`'s own minimal
/// shape - see that file's library comment for why [QueuedCommandRepository]
/// is declared per-feature here rather than shared.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
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
