/// Riverpod wiring for the fleet register.
///
/// Small providers, kept separate from the screens -
/// `permission_providers.dart` sets the precedent this file follows: a
/// widget watching one piece of this feature's state must not rebuild
/// because an unrelated part of it changed.
///
/// The fleet cache uses the same canonical [AppDatabase] connection as every
/// other offline feature. No feature opens a second SQLite connection.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
// `FutureProviderFamily` is deliberately not exported by the main
// flutter_riverpod barrel in Riverpod 3.x (same `@publicInMisc` class as
// `Override` - see auth_providers.dart's note) - `misc.dart` is the
// sanctioned escape hatch for naming it explicitly, which the family
// provider's declared type below does.
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/database/dao/cache_dao.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';

/// The remote source. Real by default - unlike the permission and workspace
/// dependency providers, there is nothing to override to make the app work:
/// this already talks to the live [SupabaseVehicleFleetSource].
final Provider<VehicleFleetSource> vehicleFleetSourceProvider =
    Provider<VehicleFleetSource>(
  (ref) => SupabaseVehicleFleetSource(ref.watch(supabaseClientProvider)),
);

/// The shared fleet cache. [appDatabaseProvider] is supplied once by main.
final Provider<CacheDao?> vehicleFleetCacheDaoProvider = Provider<CacheDao?>(
  (ref) => ref.watch(appDatabaseProvider).cacheDao,
);

/// The fleet register repository.
final Provider<VehicleFleetRepository> vehicleFleetRepositoryProvider =
    Provider<VehicleFleetRepository>(
  (ref) => VehicleFleetRepository(
    ref.watch(vehicleFleetSourceProvider),
    cacheDao: ref.watch(vehicleFleetCacheDaoProvider),
  ),
);

/// The whole fleet register, scoped to the active workspace's country.
///
/// A [FutureProvider] rather than a hand-rolled state notifier: every
/// transition Riverpod needs - loading, retry via `ref.invalidate`, holding
/// the last value while a retry runs - is already built in, and
/// [VehicleFleetRepository.loadAll] never throws, so `AsyncError` here is
/// reserved for a genuine bug in this file rather than an expected outcome
/// (a network failure, a permission refusal and a schema mismatch are all
/// [VehicleFleetListOutcome] VALUES, not exceptions).
///
/// Depends on [workspaceContextProvider] rather than reading it once, so a
/// workspace switch - a different country, a different signed-in user -
/// automatically invalidates the loaded fleet instead of silently going on
/// showing the previous workspace's rows.
final FutureProvider<VehicleFleetListOutcome> vehicleFleetListProvider =
    FutureProvider<VehicleFleetListOutcome>((ref) {
  final workspace = ref.watch(workspaceContextProvider);
  final repository = ref.watch(vehicleFleetRepositoryProvider);
  return repository.loadAll(
    scope: vehicleCacheScopeFor(workspace),
    country: workspace?.activeCountry,
  );
});

/// One vehicle, by its exact `asset_no`.
///
/// Keyed by the asset number itself (a business code, not the row's internal
/// id) - that is the only value the detail screen is ever navigated with,
/// per `VehicleAsset.hasNavigableAssetNo`'s own reasoning.
final FutureProviderFamily<VehicleDetailOutcome, String> vehicleDetailProvider =
    FutureProvider.family<VehicleDetailOutcome, String>((ref, assetNo) {
  final workspace = ref.watch(workspaceContextProvider);
  final repository = ref.watch(vehicleFleetRepositoryProvider);
  return repository.byAssetNo(
    scope: vehicleCacheScopeFor(workspace),
    assetNo: assetNo,
    country: workspace?.activeCountry,
  );
});

/// The signed-in user's own unfinished inspection draft for ONE asset, or
/// null when there is none.
///
/// Read-only over the inspections feature's `InspectionDraftRepository`
/// (`draftsForUser`, newest first) - the asset screen never writes a draft.
/// This is what lets the asset hero show a real "N of M checked" readiness
/// ring: the numbers are the wizard's own progress counters for a draft that
/// genuinely exists on this device, never a derived or invented score. With
/// no draft (or no signed-in user) there is honestly nothing to show, so the
/// ring is simply absent rather than rendered as 0%.
///
/// Only a draft with real progress counts, the same rule
/// `homeLatestInspectionDraftProvider` applies: a sheet that was merely
/// opened is not work in progress. The asset number is compared trimmed and
/// case-insensitively because `vehicle_fleet.asset_no` is normalised upper
/// case server-side while a draft keeps what the wizard was given.
final FutureProviderFamily<InspectionDraftSummary?, String>
    vehicleInspectionDraftProvider =
    FutureProvider.family<InspectionDraftSummary?, String>(
        (ref, assetNo) async {
  final workspace = ref.watch(workspaceContextProvider);
  final String userId = workspace?.userId.trim() ?? '';
  final String wanted = assetNo.trim().toUpperCase();
  if (userId.isEmpty || wanted.isEmpty) return null;
  final List<InspectionDraftSummary> drafts =
      await ref.watch(inspectionDraftRepositoryProvider).draftsForUser(userId);
  for (final InspectionDraftSummary draft in drafts) {
    if (draft.hasProgress &&
        draft.total > 0 &&
        draft.assetNo.trim().toUpperCase() == wanted) {
      return draft;
    }
  }
  return null;
});
