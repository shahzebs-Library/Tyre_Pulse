library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';

final Provider<StockCountRepository> stockCountRepositoryProvider =
    Provider<StockCountRepository>(
  (Ref ref) => DefaultStockCountRepository(ref.watch(supabaseClientProvider)),
);

final FutureProvider<List<StockItem>> stockItemsProvider =
    FutureProvider<List<StockItem>>((Ref ref) {
  return ref.watch(stockCountRepositoryProvider).list(
        country: ref.watch(activeCountryProvider),
      );
});
