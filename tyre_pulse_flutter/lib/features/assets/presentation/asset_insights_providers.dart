/// Riverpod wiring for the Vehicle 360 timeline and cost screens.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/assets/data/asset_360_repository.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart';
import 'package:tyre_pulse/features/assets/domain/asset_360_facts.dart';
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';
import 'package:tyre_pulse/features/assets/domain/asset_timeline.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

final Provider<AssetInsightsSource> assetInsightsSourceProvider =
    Provider<AssetInsightsSource>(
  (ref) => SupabaseAssetInsightsSource(ref.watch(supabaseClientProvider)),
);

final Provider<AssetInsightsRepository> assetInsightsRepositoryProvider =
    Provider<AssetInsightsRepository>(
  (ref) => AssetInsightsRepository(ref.watch(assetInsightsSourceProvider)),
);

/// Key for [assetFinancialsProvider]: which asset, and which period.
typedef AssetFinancialRequest = ({AssetScope scope, AssetCostPeriod period});

/// Key for [assetTimelineProvider]: which asset, and since when.
typedef AssetTimelineRequest = ({AssetScope scope, DateTime from});

/// One asset's costs for one period (plus the comparison year). autoDispose
/// so re-opening the screen reads fresh figures.
final FutureProviderFamily<AssetFinancialData, AssetFinancialRequest>
    assetFinancialsProvider = FutureProvider.autoDispose
        .family<AssetFinancialData, AssetFinancialRequest>(
  (ref, AssetFinancialRequest request) => ref
      .watch(assetInsightsRepositoryProvider)
      .loadFinancials(request.scope, request.period),
);

/// The module that governs whether a person may SEE a timeline source.
///
/// The same keys gate tap-through to the record, so a source is either fully
/// visible (read, listed, openable) or never read at all. Tyres map to
/// [ModuleKey.vehicles]: the timeline only renders inside Vehicle 360, whose
/// own Tyres tab already shows this asset's tyre records to the same person.
ModuleKey assetTimelineSourceModule(AssetTimelineFilter source) =>
    switch (source) {
      AssetTimelineFilter.workOrders => ModuleKey.workorders,
      AssetTimelineFilter.inspections => ModuleKey.inspect,
      AssetTimelineFilter.washes => ModuleKey.washing,
      AssetTimelineFilter.tyres => ModuleKey.vehicles,
      AssetTimelineFilter.accidents => ModuleKey.accidents,
      AssetTimelineFilter.all => ModuleKey.vehicles,
    };

/// The timeline sources the signed-in person may see. Only these are read.
final Provider<Set<AssetTimelineFilter>> assetTimelineSourcesProvider =
    Provider<Set<AssetTimelineFilter>>(
  (ref) => <AssetTimelineFilter>{
    for (final AssetTimelineFilter source
        in AssetInsightsRepository.timelineSources)
      if (ref.watch(canAccessModuleProvider(assetTimelineSourceModule(source))))
        source,
  },
);

/// One asset's recorded history since a date, limited to the sources the
/// person may see (the access check runs BEFORE any query).
final FutureProviderFamily<AssetTimelineData, AssetTimelineRequest>
    assetTimelineProvider =
    FutureProvider.autoDispose.family<AssetTimelineData, AssetTimelineRequest>(
  (ref, AssetTimelineRequest request) =>
      ref.watch(assetInsightsRepositoryProvider).loadTimeline(
            request.scope,
            request.from,
            sources: ref.watch(assetTimelineSourcesProvider),
          ),
);

// --- Vehicle 360 header facts -------------------------------------------

final Provider<Asset360Source> asset360SourceProvider =
    Provider<Asset360Source>(
  (ref) => SupabaseAsset360Source(ref.watch(supabaseClientProvider)),
);

/// The latest engine-hour reading for the asset, or null when none exists or
/// the read fails. `engine_hours_logs` is the live meter source (the one the
/// tyre running-life RPC reads); `vehicle_fleet.current_hours` is a one-off
/// import value and is only the fallback, applied by the header.
final FutureProviderFamily<double?, AssetScope> assetEngineHoursProvider =
    FutureProvider.autoDispose.family<double?, AssetScope>(
  (ref, AssetScope scope) async {
    try {
      final Map<String, dynamic>? row =
          await ref.watch(asset360SourceProvider).latestEngineHours(scope);
      final Object? raw = row?['engine_hours'];
      final double? value = raw is num
          ? raw.toDouble()
          : (raw is String ? double.tryParse(raw.trim()) : null);
      return value != null && value > 0 ? value : null;
    } on Object {
      return null;
    }
  },
);

/// Key for [assetServiceDueProvider]: the asset plus the meters the plan is
/// measured against.
typedef AssetServiceDueRequest = ({
  AssetScope scope,
  int? currentKm,
  double? engineHours,
});

/// The next preventive-maintenance service, or null when the person may not
/// see maintenance plans (the plans are never read then), when there is no
/// measurable plan, or when the read fails.
final FutureProviderFamily<AssetServiceDue?, AssetServiceDueRequest>
    assetServiceDueProvider =
    FutureProvider.autoDispose.family<AssetServiceDue?, AssetServiceDueRequest>(
  (ref, AssetServiceDueRequest request) async {
    if (!ref.watch(canAccessModuleProvider(ModuleKey.pm))) return null;
    try {
      final List<Map<String, dynamic>> rows =
          await ref.watch(asset360SourceProvider).pmPlans(request.scope);
      return resolveAssetServiceDue(
        rows.map(pmPlanFromRow).whereType<PmPlan>(),
        currentKm: request.currentKm,
        engineHours: request.engineHours,
        now: DateTime.now(),
      );
    } on Object {
      return null;
    }
  },
);

/// Open tyre actions for the asset, or null when the person may not see
/// corrective actions (never read then), when the read fails, or when the
/// read reached its cap (a capped count would understate).
final FutureProviderFamily<int?, AssetScope> assetTyreActionsProvider =
    FutureProvider.autoDispose.family<int?, AssetScope>(
  (ref, AssetScope scope) async {
    if (!ref.watch(canAccessModuleProvider(ModuleKey.tasks))) return null;
    try {
      final List<Map<String, dynamic>> rows =
          await ref.watch(asset360SourceProvider).tyreActions(scope);
      if (rows.length >= assetTyreActionLimit) return null;
      return countOpenTyreActions(rows);
    } on Object {
      return null;
    }
  },
);

/// The permit columns of one `vehicle_fleet` row, keyed by the row id. An
/// error is surfaced (the Documents tab shows an error state with Retry),
/// because that tab has nothing else to show.
final FutureProviderFamily<Map<String, dynamic>?, String>
    assetDocumentsRowProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>?, String>(
  (ref, String fleetRowId) async {
    try {
      return await ref.watch(asset360SourceProvider).documents(fleetRowId);
    } on SupabaseFailure catch (failure) {
      throw failure.error;
    }
  },
);
