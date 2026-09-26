/// Riverpod wiring for the Workshop Live Control technician screen.
///
/// Mirrors `features/washing/washing_providers.dart`: the
/// [QueuedCommandRepository] is declared per feature, over the one shared
/// `pending_commands` queue.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';

final Provider<QueuedCommandRepository>
    workshopQueuedCommandRepositoryProvider =
    Provider<QueuedCommandRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return QueuedCommandRepository(db.queueDao);
});

final Provider<WorkshopRepository> workshopRepositoryProvider =
    Provider<WorkshopRepository>(
  (ref) => SupabaseWorkshopRepository(
    ref.watch(supabaseClientProvider),
    ref.watch(workshopQueuedCommandRepositoryProvider),
  ),
);
