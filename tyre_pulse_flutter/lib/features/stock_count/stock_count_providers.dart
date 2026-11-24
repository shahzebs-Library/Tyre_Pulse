library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_recorder.dart';
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

/// Records a count as physical count evidence (never a stock change).
final Provider<StockCountRecorder> stockCountRecorderProvider =
    Provider<StockCountRecorder>(
  (Ref ref) => StockCountRecorder(
    repository: ref.watch(physicalInventoryRepositoryProvider),
    outbox: ref.watch(physicalCaptureOutboxProvider),
    store: ref.watch(secureStoreProvider),
    newId: ref.watch(inventoryIdFactoryProvider),
  ),
);
