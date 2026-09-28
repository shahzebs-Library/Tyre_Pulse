/// Riverpod wiring for the three extras screens.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/extras/data/fleet_ai_repository.dart';
import 'package:tyre_pulse/features/extras/data/repair_request_repository.dart';
import 'package:tyre_pulse/features/extras/data/self_registration_repository.dart';

final Provider<FleetAiRepository> fleetAiRepositoryProvider =
    Provider<FleetAiRepository>(
  (ref) => SupabaseFleetAiRepository(ref.watch(supabaseClientProvider)),
);

final Provider<RepairRequestRepository> repairRequestRepositoryProvider =
    Provider<RepairRequestRepository>(
  (ref) => SupabaseRepairRequestRepository(ref.watch(supabaseClientProvider)),
);

final Provider<SelfRegistrationRepository> selfRegistrationRepositoryProvider =
    Provider<SelfRegistrationRepository>(
  (ref) =>
      SupabaseSelfRegistrationRepository(ref.watch(supabaseClientProvider)),
);
