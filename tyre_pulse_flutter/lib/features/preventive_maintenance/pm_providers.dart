library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/preventive_maintenance/data/pm_repository.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

final Provider<PmRepository> pmRepositoryProvider = Provider<PmRepository>(
  (Ref ref) => SupabasePmRepository(ref.watch(supabaseClientProvider)),
);

final FutureProvider<List<PmPlan>> activePmPlansProvider =
    FutureProvider<List<PmPlan>>((Ref ref) {
  return ref.watch(pmRepositoryProvider).listActive(
        country: ref.watch(activeCountryProvider),
      );
});
