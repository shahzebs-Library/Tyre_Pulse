/// Riverpod wiring for the read-only tyre Alerts feed.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/alerts/data/alerts_repository.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';

final Provider<AlertsRepository> alertsRepositoryProvider =
    Provider<AlertsRepository>(
  (ref) => SupabaseAlertsRepository(ref.watch(supabaseClientProvider)),
);

final FutureProvider<List<TyreAlert>> tyreAlertsProvider =
    FutureProvider<List<TyreAlert>>((ref) {
  return ref.watch(alertsRepositoryProvider).listActiveRiskAlerts(
        country: ref.watch(activeCountryProvider),
      );
});
