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
    FutureProvider<List<StockItem>>(
  (Ref ref) async {
    final String? country = ref.watch(activeCountryProvider);
    final List<StockItem> rows =
        await ref.watch(stockCountRepositoryProvider).list(country: country);
    ref.read(lastStockItemsProvider.notifier).remember(country, rows);
    return rows;
    // No automatic retry: offline the screen keeps the last list with an
    // "Offline" banner; a retry loop would only turn that into an endless
    // "Refreshing". Pull to refresh (or the next visit) reads again.
  },
  retry: (int retryCount, Object error) => null,
);

/// The last stock list that loaded, per country, for this app session. When
/// a reload fails (offline) or is still running, Stock Count keeps showing
/// this list with a banner instead of a full screen spinner or error: a Store
/// Keeper counting offline must still see the shelf they are counting.
final NotifierProvider<LastStockItemsNotifier, Map<String, List<StockItem>>>
    lastStockItemsProvider =
    NotifierProvider<LastStockItemsNotifier, Map<String, List<StockItem>>>(
  LastStockItemsNotifier.new,
);

final class LastStockItemsNotifier
    extends Notifier<Map<String, List<StockItem>>> {
  @override
  Map<String, List<StockItem>> build() => const <String, List<StockItem>>{};

  static String keyFor(String? country) => (country ?? '').trim();

  void remember(String? country, List<StockItem> rows) {
    state = <String, List<StockItem>>{...state, keyFor(country): rows};
  }
}

/// The Stock Count filters. Home's store tiles open the screen on one.
enum StockCountFilter { all, low, stale }

/// A filter asked for by whoever opens Stock Count next (Home's "Need
/// reorder" / "Not counted" / "Items" tiles). The screen applies it once and
/// clears it. A provider rather than a route parameter because the route
/// files are reserved wiring.
final NotifierProvider<RequestedStockFilterNotifier, StockCountFilter?>
    stockCountRequestedFilterProvider =
    NotifierProvider<RequestedStockFilterNotifier, StockCountFilter?>(
  RequestedStockFilterNotifier.new,
);

final class RequestedStockFilterNotifier extends Notifier<StockCountFilter?> {
  @override
  StockCountFilter? build() => null;

  void request(StockCountFilter filter) => state = filter;

  /// Returns the requested filter (if any) and clears it.
  StockCountFilter? take() {
    final StockCountFilter? f = state;
    if (f != null) state = null;
    return f;
  }
}

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

  /// Puts back what was there before a count that was undone.
  void restore(String stockId, DateTime? previous) {
    final Map<String, DateTime> next = <String, DateTime>{...state};
    if (previous == null) {
      next.remove(stockId);
    } else {
      next[stockId] = previous;
    }
    state = next;
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
