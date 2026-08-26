/// Riverpod wiring for the Work Orders feature.
///
/// Mirrors `features/washing/washing_providers.dart`'s own minimal shape -
/// see that file's library comment for why [QueuedCommandRepository] is
/// declared per-feature here rather than shared.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_repository.dart';

final workOrderQueuedCommandRepositoryProvider =
    Provider<QueuedCommandRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return QueuedCommandRepository(db.queueDao);
});

final Provider<WorkOrderRepository> workOrderRepositoryProvider =
    Provider<WorkOrderRepository>(
  (ref) => SupabaseWorkOrderRepository(
    ref.watch(supabaseClientProvider),
    ref.watch(workOrderQueuedCommandRepositoryProvider),
  ),
);
