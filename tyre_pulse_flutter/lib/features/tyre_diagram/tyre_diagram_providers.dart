/// Riverpod wiring for `features/tyre_diagram`'s own write path - the
/// "Report a defect" action reachable from the Take Action screen.
///
/// Mirrors `features/tyre_exchange/tyre_exchange_providers.dart`'s own
/// minimal shape exactly, including its own reasoning for why
/// [QueuedCommandRepository] is declared per-feature rather than shared.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/features/tyre_diagram/data/tyre_defect_report_repository.dart';

final Provider<QueuedCommandRepository>
    tyreDiagramQueuedCommandRepositoryProvider =
    Provider<QueuedCommandRepository>((ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return QueuedCommandRepository(db.queueDao);
});

final Provider<TyreDefectReportRepository> tyreDefectReportRepositoryProvider =
    Provider<TyreDefectReportRepository>(
  (ref) => DefaultTyreDefectReportRepository(
    ref.watch(tyreDiagramQueuedCommandRepositoryProvider),
  ),
);
