library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/management/data/management_repository.dart';

final Provider<ManagementRepository> managementRepositoryProvider =
    Provider<ManagementRepository>((Ref ref) {
  return SupabaseManagementRepository(ref.watch(supabaseClientProvider));
});
