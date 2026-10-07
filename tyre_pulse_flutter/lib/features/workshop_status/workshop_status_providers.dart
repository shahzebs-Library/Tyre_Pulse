/// Riverpod wiring for Daily Ops -> Workshop Status.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/workshop_status/data/workshop_status_repository.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_record.dart';

/// The clock days-down and "updated today" are judged against. Overridden in
/// tests so the day is fixed.
final Provider<DateTime Function()> workshopStatusClockProvider =
    Provider<DateTime Function()>((Ref ref) => DateTime.now);

final Provider<WorkshopStatusRepository> workshopStatusRepositoryProvider =
    Provider<WorkshopStatusRepository>(
  (Ref ref) =>
      SupabaseWorkshopStatusRepository(ref.watch(supabaseClientProvider)),
);

/// The caller's server-side permission flags. The server decides; this only
/// avoids offering an action it would refuse.
final FutureProvider<WorkshopStatusPermissions>
    workshopStatusPermissionsProvider =
    FutureProvider<WorkshopStatusPermissions>(
  (Ref ref) => ref.watch(workshopStatusRepositoryProvider).myPermissions(),
);

/// Active vehicles in the report for the active country.
final FutureProvider<WorkshopStatusList> workshopStatusActiveProvider =
    FutureProvider<WorkshopStatusList>((Ref ref) {
  return ref.watch(workshopStatusRepositoryProvider).listActive(
        country: ref.watch(activeCountryProvider),
      );
});

/// The signed-in user's id, used for "Mine" and "Assign to me". Empty when
/// nobody is signed into a workspace.
final Provider<String> workshopStatusUserIdProvider = Provider<String>(
  (Ref ref) {
    final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
    return workspace?.userId.trim() ?? '';
  },
);
