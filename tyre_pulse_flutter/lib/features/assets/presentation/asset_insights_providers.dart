/// Riverpod wiring for the Vehicle 360 timeline and cost screens.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart';
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';

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

/// One asset's recorded history since a date.
final FutureProviderFamily<AssetTimelineData, AssetTimelineRequest>
    assetTimelineProvider =
    FutureProvider.autoDispose.family<AssetTimelineData, AssetTimelineRequest>(
  (ref, AssetTimelineRequest request) => ref
      .watch(assetInsightsRepositoryProvider)
      .loadTimeline(request.scope, request.from),
);
