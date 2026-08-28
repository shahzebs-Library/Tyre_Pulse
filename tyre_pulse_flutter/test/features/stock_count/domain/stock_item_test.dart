library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';

void main() {
  test('stock status follows critical then minimum thresholds', () {
    expect(stockStatus(2, 5, 3), 'Critical');
    expect(stockStatus(4, 5, 3), 'Low');
    expect(stockStatus(6, 5, 3), 'OK');
  });

  test('countedToday compares the local calendar day', () {
    final DateTime now = DateTime(2026, 8, 28, 20);
    expect(
      StockItem(id: 'a', updatedAt: DateTime(2026, 8, 28, 1)).countedToday(now),
      isTrue,
    );
    expect(
      StockItem(id: 'b', updatedAt: DateTime(2026, 8, 27, 23))
          .countedToday(now),
      isFalse,
    );
  });
}
