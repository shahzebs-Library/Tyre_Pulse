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

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter_riverpod/flutter_riverpod.dart';
// `FutureProviderFamily` is deliberately not exported by the main
// flutter_riverpod barrel in Riverpod 3.x (same `@publicInMisc` class as
// `Override` - see auth_providers.dart's note) - `misc.dart` is the
// sanctioned escape hatch for naming it explicitly, which the family
// provider's declared type below does.
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/database/dao/cache_dao.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
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
/// Read-only over the local drafts store - the asset screen never writes a
/// draft. This is what lets the asset hero show a real "N of M checked"
/// readiness ring: the numbers are the wizard's own progress counters for a
/// draft that genuinely exists on this device, never a derived or invented
/// score. With no draft (or no signed-in user) there is honestly nothing to
/// show, so the ring is simply absent rather than rendered as 0%.
///
/// Scoped to the ACTIVE WORKSPACE, not only the user. The drafts table stores
/// the workspace each draft was captured under, and one person can hold
/// several: a draft started under another company, or under another country
/// (the same asset code in another country is a different machine - V376),
/// must not light up this asset's ring. A draft whose country was recorded is
/// only shown when it matches the active country; one captured before a
/// country existed is kept, since nothing contradicts it.
///
/// "Real work" is the inspection wizard's own resume-list rule
/// (`InspectionDraftRepository.hasContent`: progress, a photo or a
/// signature), so the asset screen and the wizard never disagree about
/// whether a draft exists. The ring itself still needs a total to divide by,
/// so a draft with `total == 0` is not returned.
///
/// autoDispose so re-opening the screen after working in the wizard reads
/// the draft afresh instead of a stale cached count.
final FutureProviderFamily<InspectionDraftSummary?, String>
    vehicleInspectionDraftProvider = FutureProvider.autoDispose
        .family<InspectionDraftSummary?, String>((ref, assetNo) async {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  final String userId = workspace?.userId.trim() ?? '';
  final String wanted = assetNo.trim().toUpperCase();
  if (workspace == null || userId.isEmpty || wanted.isEmpty) return null;

  final Set<String> workspaceIds = draftWorkspaceIdsFor(workspace);
  final String? activeCountry = _normalisedCountry(workspace.activeCountry);

  final AppDatabase db = ref.watch(appDatabaseProvider);
  final InspectionDraftRepository drafts =
      ref.watch(inspectionDraftRepositoryProvider);
  final List<InspectionDraft> rows =
      await db.draftsDao.inspectionDraftsForUser(userId);
  for (final InspectionDraft row in rows) {
    if (row.assetNo.trim().toUpperCase() != wanted) continue;
    if (!workspaceIds.contains(row.workspaceId)) continue;
    final String? draftCountry = _normalisedCountry(row.country);
    if (activeCountry != null &&
        draftCountry != null &&
        draftCountry != activeCountry) {
      continue;
    }
    if (row.total <= 0) continue;
    if (!await drafts.hasContent(row.draftKey)) continue;
    return InspectionDraftSummary(
      draftKey: row.draftKey,
      assetNo: row.assetNo,
      site: row.site,
      vehicleType: row.vehicleType,
      filled: row.filled,
      total: row.total,
      updatedAt: row.updatedAt,
    );
  }
  return null;
});

/// The workspace id values a draft of [workspace] may carry.
///
/// [workspaceIdFor] is the canonical resolver (company, then tenant, blanks
/// treated as absent). The inspection wizard stamps
/// `companyId ?? tenantId ?? ''` without trimming, which differs only when a
/// value is blank, so both spellings are accepted - never anything wider. An
/// unresolvable workspace contributes nothing from [workspaceIdFor] rather
/// than throwing out of a read-only screen.
@visibleForTesting
Set<String> draftWorkspaceIdsFor(WorkspaceContext workspace) {
  final Set<String> ids = <String>{
    workspace.companyId ?? workspace.tenantId ?? '',
  };
  try {
    ids.add(workspaceIdFor(workspace));
  } on ArgumentError {
    // No organisation on the profile: only the wizard's own '' spelling
    // above can match, which is exactly what it would have written.
  }
  return ids;
}

String? _normalisedCountry(String? value) {
  final String trimmed = value?.trim().toUpperCase() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}
