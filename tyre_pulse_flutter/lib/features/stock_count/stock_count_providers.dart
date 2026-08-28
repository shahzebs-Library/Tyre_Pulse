library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';

final Provider<StockCountRepository> stockCountRepositoryProvider =
    Provider<StockCountRepository>((Ref ref) {
  final AppDatabase database = ref.watch(appDatabaseProvider);
  return DefaultStockCountRepository(
    ref.watch(supabaseClientProvider),
    QueuedCommandRepository(database.queueDao),
  );
});

final FutureProvider<List<StockItem>> stockItemsProvider =
    FutureProvider<List<StockItem>>((Ref ref) {
  return ref.watch(stockCountRepositoryProvider).list(
        country: ref.watch(activeCountryProvider),
      );
});
