library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_history_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';

/// Pages the stock ledger for one [StockHistoryQuery]: first page on
/// [refresh], the next on [loadMore], stopping at a short page. A newer
/// query (filters changed while a page was in flight) discards the older
/// answer so a slow response can never paint stale rows under new filters.
final class StockMovementPager extends ChangeNotifier {
  StockMovementPager({required this.repository, this.pageSize = 30});

  final StockHistoryRepository repository;
  final int pageSize;

  StockHistoryQuery? _query;
  final List<StockMovement> _rows = <StockMovement>[];
  bool _loading = false;
  bool _hasMore = true;
  Object? _error;
  int _generation = 0;

  List<StockMovement> get rows => List<StockMovement>.unmodifiable(_rows);
  bool get loading => _loading;
  bool get hasMore => _hasMore;
  Object? get error => _error;
  bool get loadedOnce => _query != null && (!_loading || _rows.isNotEmpty);
  StockHistoryQuery? get query => _query;

  Future<void> refresh(StockHistoryQuery query) async {
    _query = query;
    _rows.clear();
    _hasMore = true;
    _error = null;
    await _load(++_generation);
  }

  Future<void> loadMore() async {
    if (_loading || !_hasMore || _query == null) return;
    await _load(_generation);
  }

  Future<void> _load(int generation) async {
    final StockHistoryQuery query = _query!;
    _loading = true;
    notifyListeners();
    try {
      final List<StockMovement> page = await repository.page(
        query,
        offset: _rows.length,
        limit: pageSize,
      );
      if (generation != _generation) return;
      final Set<String> seen = <String>{
        for (final StockMovement m in _rows) m.id,
      };
      _rows.addAll(page.where((StockMovement m) => seen.add(m.id)));
      _hasMore = page.length >= pageSize;
      _error = null;
    } on Object catch (e) {
      if (generation != _generation) return;
      _error = e;
    } finally {
      if (generation == _generation) {
        _loading = false;
        notifyListeners();
      }
    }
  }
}
