/// Riverpod wiring for the inspection-approvals data layer.
///
/// Mirrors `features/inspections/inspections_providers.dart`'s own shape -
/// a plain [Provider] over the `SupabaseClient` this app already exposes at
/// `core/network/supabase_client_provider.dart`, with no state of its own.
/// The two screens in `presentation/` hold their own local state (loading,
/// the loaded item, an in-progress decision) exactly as
/// `ChecklistHistoryScreen` and `InspectionDetailScreen` already do for a
/// comparably-sized "load, show, maybe act" screen - this feature's
/// decision flow does not warrant a separate `Notifier` on top of a
/// straightforward repository call.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';

final inspectionApprovalRepositoryProvider =
    Provider<InspectionApprovalRepository>(
  (ref) => SupabaseInspectionApprovalRepository(
    ref.watch(supabaseClientProvider),
  ),
);
