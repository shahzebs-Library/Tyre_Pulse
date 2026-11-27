library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_recorder.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_repository.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_history_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';

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

/// The stock ledger reader / receipt poster for the store history screens.
final Provider<StockHistoryRepository> stockHistoryRepositoryProvider =
    Provider<StockHistoryRepository>(
  (Ref ref) => DefaultStockHistoryRepository(ref.watch(supabaseClientProvider)),
);

/// In / out / net totals for one history filter.
final stockHistorySummaryProvider =
    FutureProvider.autoDispose.family<MovementSummary, StockHistoryQuery>(
  (Ref ref, StockHistoryQuery query) =>
      ref.watch(stockHistoryRepositoryProvider).summary(query),
);

/// Whether the signed-in person may POST a count difference (+/- on a stock
/// line). Mirrors the server: since the 2026-11-24 owner decision (WP5,
/// migration 20261124091000) `post_stock_movement` adjustment_up/down is
/// refused unless `app_is_org_admin()` (super admin or the Admin role). Anyone
/// else records a physical count instead (Matches / Doesn't match). The
/// server stays the boundary; this only stops showing buttons that always
/// refuse.
final Provider<bool> canPostCountDifferenceProvider = Provider<bool>((Ref ref) {
  final AccessState access = ref.watch(accessStateProvider);
  return access.isSuperAdmin || access.role.isAdministrator;
});

/// Stock lines counted from THIS phone today (stock id -> when). A count is
/// evidence and never changes `stock_records.updated_at`, so without this a
/// line the Store Keeper just counted would still read "not counted today".
/// Kept for the app session only; tomorrow it is empty again by date.
final NotifierProvider<CountedTodayNotifier, Map<String, DateTime>>
    stockCountedTodayProvider =
    NotifierProvider<CountedTodayNotifier, Map<String, DateTime>>(
  CountedTodayNotifier.new,
);

final class CountedTodayNotifier extends Notifier<Map<String, DateTime>> {
  @override
  Map<String, DateTime> build() => const <String, DateTime>{};

  void mark(String stockId, DateTime at) {
    state = <String, DateTime>{...state, stockId: at};
  }
}

/// A line counts as counted today when the register says so or this phone
/// recorded a count for it today.
bool stockLineCountedToday(
  StockItem item,
  DateTime now,
  Map<String, DateTime> local,
) {
  if (item.countedToday(now)) return true;
  final DateTime? at = local[item.id]?.toLocal();
  return at != null &&
      at.year == now.year &&
      at.month == now.month &&
      at.day == now.day;
}
