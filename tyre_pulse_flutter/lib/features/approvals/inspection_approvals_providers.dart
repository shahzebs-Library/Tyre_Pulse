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
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';

final inspectionApprovalRepositoryProvider =
    Provider<InspectionApprovalRepository>(
  (ref) => SupabaseInspectionApprovalRepository(
    ref.watch(supabaseClientProvider),
  ),
);

/// One short-lived URL for one submitted private evidence reference.
///
/// Auto-dispose is deliberate: a signed URL must not remain cached by the app
/// after its TTL once the evidence tile leaves the widget tree.
final inspectionApprovalEvidenceUrlProvider =
    FutureProvider.autoDispose.family<String, String>(
  (ref, reference) =>
      ref.watch(privateStorageReferenceResolverProvider).resolve(reference),
  // Evidence errors need an explicit, honest UI state. Riverpod's default
  // automatic retry would keep this tile on "loading" while repeatedly
  // signing a reference that Storage RLS has definitively denied.
  retry: (int retryCount, Object error) => null,
);
