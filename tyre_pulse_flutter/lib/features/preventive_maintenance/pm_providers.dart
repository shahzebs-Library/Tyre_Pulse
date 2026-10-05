library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/preventive_maintenance/data/maintenance_work_order_repository.dart';
import 'package:tyre_pulse/features/preventive_maintenance/data/pm_repository.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/maintenance_work_order.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

/// The clock the maintenance screen judges "due" and "overdue" against.
/// Injectable so a test can freeze the day; the app always reads the real time.
final Provider<DateTime Function()> pmClockProvider =
    Provider<DateTime Function()>((Ref ref) => DateTime.now);

final Provider<PmRepository> pmRepositoryProvider = Provider<PmRepository>(
  (Ref ref) => SupabasePmRepository(ref.watch(supabaseClientProvider)),
);

final FutureProvider<List<PmPlan>> activePmPlansProvider =
    FutureProvider<List<PmPlan>>((Ref ref) {
  return ref.watch(pmRepositoryProvider).listActive(
        country: ref.watch(activeCountryProvider),
      );
});

final Provider<MaintenanceWorkOrderRepository>
    maintenanceWorkOrderRepositoryProvider =
    Provider<MaintenanceWorkOrderRepository>(
  (Ref ref) => SupabaseMaintenanceWorkOrderRepository(
    ref.watch(supabaseClientProvider),
  ),
);

/// Exact count of open breakdowns. Each KPI source is its own provider so
/// one failed count shows "-" and retries alone, never a false 0.
final FutureProvider<int> openBreakdownsCountProvider =
    FutureProvider<int>((Ref ref) {
  return ref.watch(maintenanceWorkOrderRepositoryProvider).countOpenBreakdowns(
        country: ref.watch(activeCountryProvider),
      );
});

/// Exact count of work orders that are not finished.
final FutureProvider<int> activeWorkOrdersCountProvider =
    FutureProvider<int>((Ref ref) {
  return ref
      .watch(maintenanceWorkOrderRepositoryProvider)
      .countActiveWorkOrders(country: ref.watch(activeCountryProvider));
});

/// Open work orders for the priority queue preview.
final FutureProvider<List<MaintenanceWorkOrder>>
    maintenanceQueueWorkOrdersProvider =
    FutureProvider<List<MaintenanceWorkOrder>>((Ref ref) {
  return ref
      .watch(maintenanceWorkOrderRepositoryProvider)
      .listOpenForQueue(country: ref.watch(activeCountryProvider));
});
