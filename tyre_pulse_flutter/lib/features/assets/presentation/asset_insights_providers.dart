/// Riverpod wiring for the Vehicle 360 timeline and cost screens.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart';
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';
import 'package:tyre_pulse/features/assets/domain/asset_timeline.dart';

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
