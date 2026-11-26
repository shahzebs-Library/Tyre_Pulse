import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_history_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';

StockMovement _m(
  String id,
  num change, {
  num? before,
  num? after,
  String type = 'receipt',
  String? source,
  DateTime? at,
}) =>
    StockMovement(
      id: id,
      type: type,
      change: change,
      before: before,
      after: after,
      sourceDocType: source,
      at: at,
    );

void main() {
  group('resolveBalances', () {
    test('the ledger qty_after wins', () {
      final List<num?> b = resolveBalances(
        <StockMovement>[_m('a', 2, after: 12), _m('b', -1, after: 10)],
        currentQuantity: 99,
      );
      expect(b, <num?>[12, 10]);
    });

    test('falls back to qty_before + change', () {
      expect(
        resolveBalances(<StockMovement>[_m('a', 3, before: 4)]),
        <num?>[7],
      );
    });

    test('walks back from the current quantity when nothing is recorded', () {
      // newest first: +5 then -2 then +10; on hand now 13.
      final List<num?> b = resolveBalances(
        <StockMovement>[_m('a', 5), _m('b', -2), _m('c', 10)],
        currentQuantity: 13,
      );
      expect(b, <num?>[13, 8, 10]);
    });

    test('mixes recorded and walked balances', () {
      final List<num?> b = resolveBalances(
        <StockMovement>[_m('a', 4, after: 20), _m('b', 1), _m('c', -3)],
      );
      expect(b, <num?>[20, 16, 15]);
    });

    test('stays blank rather than guessing', () {
      expect(
        resolveBalances(<StockMovement>[_m('a', 4), _m('b', 1)]),
        <num?>[null, null],
      );
    });
  });

  group('summarizeMovements', () {
    test('in, out and net with openings left out', () {
      final MovementSummary s = summarizeMovements(<StockMovement>[
        _m('a', 10, at: DateTime(2026, 11, 3)),
        _m('b', -4, type: 'issue', at: DateTime(2026, 11, 9)),
        _m('c', 50, type: 'opening', at: DateTime(2026, 10, 1)),
        _m('d', 2, type: 'return', at: DateTime(2026, 10, 20)),
        _m('e', -1, type: 'stocktake', source: 'erp_ledger'),
      ]);
      expect(s.total.stockIn, 12);
      expect(s.total.stockOut, 5);
      expect(s.total.net, 7);
      expect(s.total.openings, 1);
      expect(s.total.movements, 4);
      expect(s.byMonth.map((PeriodTotals p) => p.month), <DateTime>[
        DateTime(2026, 11),
        DateTime(2026, 10),
      ]);
      expect(s.byMonth.first.totals.net, 6);
      expect(s.byMonth.last.totals.stockIn, 2);
    });
  });

  test('categories follow the ledger type and source', () {
    expect(
      movementCategoryFor('receipt', 'goods_receipt'),
      MovementCategory.receipt,
    );
    expect(
      movementCategoryFor('stocktake', 'erp_ledger'),
      MovementCategory.erpLedger,
    );
    expect(
      movementCategoryFor('issue_return', null),
      MovementCategory.returned,
    );
    expect(
      movementCategoryFor('transfer_out', null),
      MovementCategory.transfer,
    );
    expect(movementCategoryFor('Initial', 'legacy'), MovementCategory.receipt);
    expect(movementCategoryFor('reserve', null), MovementCategory.other);
  });

  test('fromRow reads the reference and effective date', () {
    final StockMovement m = StockMovement.fromRow(const <String, dynamic>{
      'id': 'x',
      'movement_type': 'issue',
      'qty_change': '-3',
      'qty_after': 7,
      'source_doc_id': 'JC-12',
      'effective_at': '2026-11-20T08:00:00Z',
      'created_by': 'u1',
    });
    expect(m.change, -3);
    expect(m.after, 7);
    expect(m.reference, 'JC-12');
    expect(m.actorId, 'u1');
    expect(m.at, DateTime.utc(2026, 11, 20, 8));
  });

  test('a contiguous item run is only an unfiltered single item', () {
    expect(const StockHistoryQuery(stockId: 's').isContiguousItemRun, isTrue);
    expect(
      const StockHistoryQuery(stockId: 's', type: MovementTypeFilter.issue)
          .isContiguousItemRun,
      isFalse,
    );
    expect(const StockHistoryQuery().isContiguousItemRun, isFalse);
  });

  test('escapeLike neutralises wildcards', () {
    expect(escapeLike(r'50%_a\b'), r'50\%\_a\\b');
  });

  test('validateStockPost', () {
    expect(validateStockPost(quantity: '', reference: ''), 'qtyRequired');
    expect(validateStockPost(quantity: '0', reference: ''), 'qtyPositive');
    expect(validateStockPost(quantity: '2.5', reference: ''), 'qtyWhole');
    expect(validateStockPost(quantity: '4', reference: 'GRN-1'), isNull);
  });

  test('every fragment key is in each ARB catalog', () {
    for (final String lang in <String>['en', 'ar', 'ur']) {
      final Map<String, dynamic> fragment = jsonDecode(
        File('lib/l10n/fragments/store_history.$lang.json').readAsStringSync(),
      ) as Map<String, dynamic>;
      final Map<String, dynamic> arb = jsonDecode(
        File('lib/l10n/app_$lang.arb').readAsStringSync(),
      ) as Map<String, dynamic>;
      final String catalog = arb['storeHistoryCopyCatalog'] as String;
      for (final MapEntry<String, dynamic> e in fragment.entries) {
        expect(
          catalog,
          contains('${e.key}=${e.value}'),
          reason: '$lang ${e.key}',
        );
      }
    }
  });
}
