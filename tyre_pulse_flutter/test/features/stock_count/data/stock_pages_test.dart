import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_repository.dart';

/// docs/inventory/05 finding 4: the stock list was one `.limit(1000)` read,
/// which PostgREST caps at 1000 rows whatever the limit says.
void main() {
  List<Map<String, dynamic>> rows(int n) => <Map<String, dynamic>>[
        for (int i = 0; i < n; i++) <String, dynamic>{'id': '$i'},
      ];

  test('reads past 1000 rows until a short page', () async {
    final List<(int, int)> asked = <(int, int)>[];
    final List<Map<String, dynamic>> all = await fetchStockPages(
      (int from, int to) async {
        asked.add((from, to));
        const int total = 2350;
        final int end = to + 1 > total ? total : to + 1;
        return from >= total ? <Map<String, dynamic>>[] : rows(end - from);
      },
    );
    expect(all, hasLength(2350));
    expect(asked, <(int, int)>[(0, 999), (1000, 1999), (2000, 2999)]);
  });

  test('an exact multiple of the page size ends on the empty page', () async {
    int calls = 0;
    final List<Map<String, dynamic>> all = await fetchStockPages(
      (int from, int to) async {
        calls++;
        return from >= 2000 ? <Map<String, dynamic>>[] : rows(1000);
      },
    );
    expect(all, hasLength(2000));
    expect(calls, 3);
  });

  test('hitting the safety ceiling throws instead of truncating', () async {
    await expectLater(
      fetchStockPages(
        (int from, int to) async => rows(10),
        pageSize: 10,
        maxRows: 30,
      ),
      throwsStateError,
    );
  });
}
