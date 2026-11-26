import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_history_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_item_detail_screen.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_movement_pager.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_history_screen.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_providers.dart';

final class _FakeRepo implements StockHistoryRepository {
  _FakeRepo(this.rows);
  final List<StockMovement> rows;
  final List<StockHistoryQuery> queries = <StockHistoryQuery>[];
  final List<int> posted = <int>[];

  @override
  Future<List<StockMovement>> page(
    StockHistoryQuery query, {
    required int offset,
    required int limit,
  }) async {
    queries.add(query);
    final Iterable<StockMovement> matching = rows.where(
      (StockMovement m) =>
          query.type == MovementTypeFilter.all ||
          (movementTypesFor(query.type) ?? const <String>[]).contains(m.type),
    );
    return matching.skip(offset).take(limit).toList();
  }

  @override
  Future<MovementSummary> summary(StockHistoryQuery query) async =>
      summarizeMovements(rows);

  @override
  Future<StockPostResult> post({
    required StockItem item,
    required StockPostType type,
    required int quantity,
    String? reference,
    String? reason,
  }) async {
    posted.add(quantity);
    return StockPostResult(after: item.quantity + quantity);
  }
}

const StockItem _item = StockItem(
  id: 's1',
  site: 'NHC',
  description: '315/80R22.5 TRIANGLE',
  quantity: 13,
  minimum: 4,
  critical: 2,
);

List<StockMovement> _rows() => <StockMovement>[
      StockMovement(
        id: 'm1',
        stockId: 's1',
        type: 'receipt',
        change: 5,
        reference: 'GRN-9',
        actorName: 'Wasim',
        at: DateTime(2026, 11, 20),
      ),
      StockMovement(
        id: 'm2',
        stockId: 's1',
        type: 'issue',
        change: -2,
        reference: 'JC-4',
        at: DateTime(2026, 11, 10),
      ),
      StockMovement(
        id: 'm3',
        stockId: 's1',
        type: 'opening',
        change: 10,
        after: 10,
        at: DateTime(2026, 11, 1),
      ),
    ];

Widget _app(Widget child, List<Override> overrides, {double scale = 1}) =>
    ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        localizationsDelegates: TpLocalizations.delegates,
        supportedLocales: TpLocalizations.supportedLocales,
        builder: (BuildContext context, Widget? c) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(scale)),
          child: c!,
        ),
        home: child,
      ),
    );

List<Override> _overrides(_FakeRepo repo) => <Override>[
      stockHistoryRepositoryProvider.overrideWithValue(repo),
      activeCountryProvider.overrideWithValue(null),
      stockItemsProvider
          .overrideWith((Ref ref) async => const <StockItem>[_item]),
    ];

void main() {
  testWidgets('item detail shows levels, movements and running balances',
      (WidgetTester tester) async {
    final _FakeRepo repo = _FakeRepo(_rows());
    await tester.pumpWidget(
      _app(const StockItemDetailScreen(item: _item), _overrides(repo)),
    );
    await tester.pumpAndSettle();
    expect(find.text('315/80R22.5 TRIANGLE'), findsOneWidget);
    expect(find.byKey(const Key('stock.item.fact.min')), findsOneWidget);
    expect(find.byKey(const Key('stock.movement.m1')), findsOneWidget);
    // Walked back from on hand 13: after m1 = 13, after m2 = 8, m3 own 10.
    expect(
      tester
          .widget<Text>(find.byKey(const Key('stock.movement.balance.m1')))
          .data,
      'Balance 13',
    );
    expect(
      tester
          .widget<Text>(find.byKey(const Key('stock.movement.balance.m2')))
          .data,
      'Balance 8',
    );
    expect(
      tester
          .widget<Text>(find.byKey(const Key('stock.movement.change.m2')))
          .data,
      '-2',
    );
    expect(find.textContaining('GRN-9'), findsOneWidget);
    expect(find.textContaining('Wasim'), findsOneWidget);
  });

  testWidgets('receive stock validates, posts and shows the new balance',
      (WidgetTester tester) async {
    final _FakeRepo repo = _FakeRepo(_rows());
    await tester.pumpWidget(
      _app(const StockItemDetailScreen(item: _item), _overrides(repo)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stock.item.receive')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stock.receive.post')));
    await tester.pumpAndSettle();
    expect(find.text('Enter a quantity'), findsOneWidget);
    expect(repo.posted, isEmpty);
    await tester.enterText(find.byKey(const Key('stock.receive.qty')), '4');
    await tester.tap(find.byKey(const Key('stock.receive.post')));
    await tester.pumpAndSettle();
    expect(repo.posted, <int>[4]);
    expect(find.text('New balance: 17'), findsOneWidget);
  });

  testWidgets('store history totals and type filter',
      (WidgetTester tester) async {
    final _FakeRepo repo = _FakeRepo(_rows());
    await tester.pumpWidget(_app(const StoreHistoryScreen(), _overrides(repo)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stock.totals.in')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('stock.totals.net')),
        matching: find.text('+3'),
      ),
      findsOneWidget,
    );
    expect(
      find.text('Opening balances are not counted as stock in.'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('stock.movement.m2')), findsOneWidget);

    await tester.tap(find.byKey(const Key('stock.history.type')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Issue').last);
    await tester.pumpAndSettle();
    expect(repo.queries.last.type, MovementTypeFilter.issue);
    expect(find.byKey(const Key('stock.movement.m1')), findsNothing);
    expect(find.byKey(const Key('stock.movement.m2')), findsOneWidget);
  });

  testWidgets('empty history says so', (WidgetTester tester) async {
    final _FakeRepo repo = _FakeRepo(<StockMovement>[]);
    await tester.pumpWidget(_app(const StoreHistoryScreen(), _overrides(repo)));
    await tester.pumpAndSettle();
    expect(find.text('No movements yet'), findsOneWidget);
  });

  testWidgets('fits a 360dp phone at text scale 2 and in Arabic',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(360, 780);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final _FakeRepo repo = _FakeRepo(_rows());
    await tester.pumpWidget(
      _app(
        const StockItemDetailScreen(item: _item),
        _overrides(repo),
        scale: 2,
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(repo),
        child: const MaterialApp(
          locale: Locale('ar'),
          localizationsDelegates: TpLocalizations.delegates,
          supportedLocales: TpLocalizations.supportedLocales,
          home: StoreHistoryScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('سجل المخزن'), findsOneWidget);
  });

  test('pager pages until a short page without repeats', () async {
    final _FakeRepo repo = _FakeRepo(<StockMovement>[
      for (int i = 0; i < 5; i++)
        StockMovement(id: 'r$i', type: 'issue', change: -1),
    ]);
    final StockMovementPager pager =
        StockMovementPager(repository: repo, pageSize: 2);
    await pager.refresh(const StockHistoryQuery());
    expect(pager.rows.length, 2);
    expect(pager.hasMore, isTrue);
    await pager.loadMore();
    await pager.loadMore();
    expect(
      pager.rows.map((StockMovement m) => m.id),
      <String>['r0', 'r1', 'r2', 'r3', 'r4'],
    );
    expect(pager.hasMore, isFalse);
  });
}
