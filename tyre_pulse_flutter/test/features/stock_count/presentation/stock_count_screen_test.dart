// Stock Count as a Store Keeper uses it: Matches / Doesn't match on each line,
// a genuine mark, and the count dialog that used to crash on Save
// (framework.dart `_dependents.isEmpty`) because its controllers were
// disposed while the dialog was still animating out.
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_recorder.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_history_repository.dart';
import 'package:tyre_pulse/features/stock_count/data/store_item_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';
import 'package:tyre_pulse/features/stock_count/domain/store_item_card.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_count_screen.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_providers.dart';
import 'package:tyre_pulse/features/stock_count/store_item_providers.dart';

final class _Store extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    final String? v = values[key];
    return v == null ? const SecureRead.absent() : SecureRead.ok(v);
  }

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

final class _Repo implements PhysicalInventoryRepository {
  final List<Map<String, Object?>> captures = <Map<String, Object?>>[];

  @override
  Future<List<PhysicalSession>> openSessions() async => const <PhysicalSession>[
        PhysicalSession(
          id: 'session-1',
          reference: 'PI-1',
          site: 'DEMO YARD',
          status: 'open',
          country: 'KSA',
        ),
      ];

  @override
  Future<PhysicalSession> startSession({
    required String idempotencyKey,
    required String country,
    required String site,
    String? locationId,
  }) async =>
      throw StateError('a session is already open');

  @override
  Future<Map<String, Object?>> capture(Map<String, Object?> payload) async {
    captures.add(payload);
    return <String, Object?>{'id': 'srv-${payload['client_uuid']}'};
  }

  @override
  Future<List<InventoryPlace>> stores() async => const <InventoryPlace>[];

  @override
  Future<InventoryPlace?> placeById(String id) async => null;

  @override
  Future<List<MaterialPick>> search(String query) async =>
      const <MaterialPick>[];

  @override
  Future<void> upload(String path, Uint8List bytes) async {}

  @override
  Future<void> attachPhoto(Map<String, Object?> payload) async {}
}

final class _NoHistory implements StockHistoryRepository {
  @override
  Future<List<StockMovement>> page(
    StockHistoryQuery query, {
    required int offset,
    required int limit,
  }) async =>
      const <StockMovement>[];

  @override
  Future<MovementSummary> summary(StockHistoryQuery query) async =>
      summarizeMovements(const <StockMovement>[]);

  @override
  Future<StockPostResult> post({
    required StockItem item,
    required StockPostType type,
    required int quantity,
    String? reference,
    String? reason,
  }) async =>
      StockPostResult(after: item.quantity);
}

/// Opens a line's item card, where the count actions are.
Future<void> _openLine(WidgetTester tester, String id) async {
  await tester.ensureVisible(find.byKey(Key('stock.item.$id')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key('stock.item.$id')));
  await tester.pumpAndSettle();
}

const StockItem _binA = StockItem(
  id: 'line-a',
  site: 'DEMO YARD',
  description: 'DEMO Valve cap (quantity item)',
  quantity: 17,
  minimum: 2,
  country: 'KSA',
  itemId: 'item-1',
  condition: 'new',
  ownership: 'owned',
  uom: 'EA',
  locationCode: 'DEMO-WH-A',
  itemCode: 'DEMO-Q-001',
);

const StockItem _binB = StockItem(
  id: 'line-b',
  site: 'DEMO YARD',
  description: 'DEMO Valve cap (quantity item)',
  quantity: 8,
  minimum: 2,
  country: 'KSA',
  itemId: 'item-1',
  condition: 'new',
  ownership: 'owned',
  uom: 'EA',
  locationCode: 'DEMO-WH-B',
  itemCode: 'DEMO-Q-001',
);

WorkspaceContext _workspace(RoleId role) => WorkspaceContext(
      userId: 'user-1',
      role: UserRole.known(role),
      effectivePermissions: AccessState(role: UserRole.known(role)),
      countryScope: CountryScope.none,
      siteScope: SiteScope.none,
      tenantId: 'org-1',
      activeCountry: 'KSA',
    );

List<Override> _overrides(
  _Repo repo, {
  RoleId role = RoleId.storeKeeper,
  Override? items,
  Map<String, StockItemFace> faces = const <String, StockItemFace>{},
}) {
  final _Store store = _Store();
  int n = 0;
  return <Override>[
    accessStateProvider
        .overrideWithValue(AccessState(role: UserRole.known(role))),
    workspaceContextProvider.overrideWithValue(_workspace(role)),
    activeCountryProvider.overrideWithValue('KSA'),
    items ??
        stockItemsProvider
            .overrideWith((Ref ref) async => const <StockItem>[_binA, _binB]),
    inventoryDeviceIdProvider.overrideWith((Ref ref) async => 'device-1'),
    // The item card a line opens (count actions sit on it).
    storeItemCardProvider.overrideWith(
      (Ref ref, StockItem item) async => StoreItemCard(
        stockId: item.id,
        name: item.description ?? '',
        bins: <StoreItemBin>[
          StoreItemBin(stockId: item.id, quantity: item.quantity),
        ],
      ),
    ),
    storeItemPermissionsProvider
        .overrideWith((Ref ref) async => const StoreItemPermissions()),
    stockItemFacesProvider.overrideWith(
      (Ref ref, String key) async => faces,
    ),
    stockHistoryRepositoryProvider.overrideWithValue(_NoHistory()),
    stockCountRecorderProvider.overrideWithValue(
      StockCountRecorder(
        repository: repo,
        outbox: PhysicalCaptureOutbox(
          store,
          readBytes: (String p) async => const PhotoMissing(),
        ),
        store: store,
        newId: () => 'id-${n++}',
      ),
    ),
  ];
}

Widget _app(List<Override> overrides) => ProviderScope(
      overrides: overrides,
      child: const MaterialApp(
        localizationsDelegates: TpLocalizations.delegates,
        supportedLocales: TpLocalizations.supportedLocales,
        home: StockCountScreen(route: StockCountRoute()),
      ),
    );

void main() {
  testWidgets(
      "Doesn't match: a count and reason save once, with no framework "
      'assertion, and carry the genuine mark', (WidgetTester tester) async {
    final _Repo repo = _Repo();
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();
    await _openLine(tester, 'line-a');

    await tester.tap(find.byKey(const Key('stock.notMatch.line-a')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('stock.quantity')), '15');
    await tester.enterText(find.byKey(const Key('stock.reason')), 'two used');
    await tester.tap(find.byKey(const Key('stock.dialog.genuine.no')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('stock.genuineNote')),
      'copy part',
    );
    await tester.tap(find.byKey(const Key('stock.save')));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('stock.save')), findsNothing);
    expect(repo.captures, hasLength(1));
    final Map<String, Object?> sent = repo.captures.single;
    expect(sent['quantity'], 15);
    expect(sent['remarks'], 'two used');
    expect(sent['genuine'], false);
    expect(sent['genuine_note'], 'copy part');
    expect((sent['refs']! as Map)['stock_id'], 'line-a');
    expect(find.text('Count recorded for review.'), findsOneWidget);
    expect(
      find.byKey(const Key('stock.countedToday.line-a')),
      findsOneWidget,
    );
  });

  testWidgets('Matches records the system quantity in one tap',
      (WidgetTester tester) async {
    final _Repo repo = _Repo();
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();
    await _openLine(tester, 'line-b');

    await tester.ensureVisible(
      find.byKey(const Key('stock.genuine.line-b.yes')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stock.genuine.line-b.yes')));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('stock.matches.line-b')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stock.matches.line-b')));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(repo.captures, hasLength(1));
    expect(repo.captures.single['quantity'], 8);
    expect(repo.captures.single['genuine'], true);
    expect(repo.captures.single.containsKey('genuine_note'), isFalse);
    expect(
      find.text('Recorded: the shelf matches the system.'),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('stock.countedToday.line-b')),
      findsOneWidget,
    );
    // Back on the list, the line's dot no longer says "not counted".
    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await tester.pumpAndSettle();
    final BoxDecoration dot = tester
        .widget<Container>(find.byKey(const Key('stock.dot.line-b')))
        .decoration! as BoxDecoration;
    expect(dot.border, isNull);
  });

  testWidgets(
      'a Store Keeper gets Matches / Doesn\'t match, never +/- that the '
      'server always refuses', (WidgetTester tester) async {
    await tester.pumpWidget(_app(_overrides(_Repo())));
    await tester.pumpAndSettle();
    // The list itself carries no actions; the card does.
    expect(find.byKey(const Key('stock.matches.line-a')), findsNothing);
    await _openLine(tester, 'line-a');

    expect(find.byKey(const Key('stock.matches.line-a')), findsOneWidget);
    expect(find.byKey(const Key('stock.notMatch.line-a')), findsOneWidget);
    expect(find.byKey(const Key('stock.increase.line-a')), findsNothing);
    expect(find.byKey(const Key('stock.decrease.line-a')), findsNothing);
    // Issue to / return from a job card stays.
    expect(find.byKey(const Key('stock.issue.line-a')), findsOneWidget);
    expect(find.byKey(const Key('stock.return.line-a')), findsOneWidget);
  });

  testWidgets('an Admin keeps the +/- adjustment buttons and Count',
      (WidgetTester tester) async {
    await tester.pumpWidget(_app(_overrides(_Repo(), role: RoleId.admin)));
    await tester.pumpAndSettle();
    await _openLine(tester, 'line-a');

    expect(find.byKey(const Key('stock.increase.line-a')), findsOneWidget);
    expect(find.byKey(const Key('stock.decrease.line-a')), findsOneWidget);
    expect(find.byKey(const Key('stock.count.line-a')), findsOneWidget);
    expect(find.byKey(const Key('stock.matches.line-a')), findsNothing);
  });

  testWidgets(
      'lines with the same description say which bin and code they are, and '
      'the search does not open the keyboard on entry',
      (WidgetTester tester) async {
    await tester.pumpWidget(_app(_overrides(_Repo())));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('DEMO-WH-A', findRichText: true),
      findsOneWidget,
    );
    expect(
      find.textContaining('DEMO-WH-B', findRichText: true),
      findsOneWidget,
    );
    final EditableText search = tester.widget<EditableText>(
      find.descendant(
        of: find.byKey(const Key('stock.search')),
        matching: find.byType(EditableText),
      ),
    );
    expect(search.focusNode.hasFocus, isFalse);

    // Searching by the bin narrows to that line.
    await tester.enterText(find.byKey(const Key('stock.search')), 'wh-b');
    await tester.pump();
    expect(find.byKey(const Key('stock.item.line-b')), findsOneWidget);
    expect(find.byKey(const Key('stock.item.line-a')), findsNothing);
  });

  testWidgets('Add stock saves and closes without a framework assertion',
      (WidgetTester tester) async {
    final _Repo repo = _Repo();
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('stock.more')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stock.add')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('stock.add.size')), '12R22.5');
    await tester.enterText(
      find.byKey(const Key('stock.add.site')),
      'DEMO YARD',
    );
    await tester.enterText(find.byKey(const Key('stock.add.quantity')), '4');
    await tester.tap(find.byKey(const Key('stock.add.save')));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('stock.add.save')), findsNothing);
    expect(repo.captures, hasLength(1));
    expect(repo.captures.single['kind'], 'proposed_new');
  });

  testWidgets('each line is three short lines: name, part, where + genuine',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    const StockItem long = StockItem(
      id: 'line-long',
      site: 'DEMO YARD',
      description: 'DEMO Hydraulic return line filter element with gasket kit',
      quantity: 1234,
      minimum: 2,
      country: 'KSA',
      itemId: 'item-9',
      locationCode: 'DEMO-WH-RACK-12-BIN-04',
    );
    for (final double scale in <double>[1, 2]) {
      await tester.pumpWidget(
        MediaQuery(
          data: MediaQueryData(
            size: const Size(360, 800),
            textScaler: TextScaler.linear(scale),
          ),
          child: _app(
            _overrides(
              _Repo(),
              items: stockItemsProvider.overrideWith(
                (Ref ref) async => const <StockItem>[long, _binA],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final double h =
          tester.getSize(find.byKey(const Key('stock.item.line-a'))).height;
      expect(h, greaterThanOrEqualTo(48), reason: 'tap target');
      if (scale == 1) {
        // The test font draws every glyph full-width, so a name wraps sooner
        // than with real fonts (the 360dp screenshots measure ~96dp).
        expect(h, inInclusiveRange(76, 112), reason: 'compact, not tall');
      }
      // Part line falls back to the ERP code; where = bin and site.
      expect(
        tester.widget<Text>(find.byKey(const Key('stock.part.line-a'))).data,
        'DEMO-Q-001',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('stock.where.line-a'))).data,
        'Bin DEMO-WH-A · DEMO YARD',
      );
      expect(find.byKey(const Key('stock.genuineChip.line-a')), findsOne);
      final RenderParagraph name = tester.renderObject<RenderParagraph>(
        find.byKey(const Key('stock.name.line-long')),
      );
      final double lineHeight = name.getFullHeightForCaret(
        const TextPosition(offset: 0),
      );
      expect(
        name.size.height,
        lessThanOrEqualTo(lineHeight * 2 + 1),
        reason: 'never more than two lines at ${scale}x',
      );
      expect(name.didExceedMaxLines, isTrue, reason: 'long name is cut');
    }
  });

  testWidgets('long-press Matches records once; Undo takes it back',
      (WidgetTester tester) async {
    // Tall enough that the snackbar never covers a row.
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final _Repo repo = _Repo();
    await tester.pumpWidget(
      _app(
        _overrides(
          repo,
          faces: const <String, StockItemFace>{
            'item-1': StockItemFace(
              partNumber: 'P550148',
              partBrand: 'Donaldson',
              classification: 'genuine',
            ),
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('P550148 · Donaldson'), findsNWidgets(2));
    expect(find.text('Genuine'), findsNWidgets(2));

    // Recorded once, held for Undo: nothing reaches the server yet.
    await tester.longPress(find.byKey(const Key('stock.item.line-a')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Counted: DEMO Valve cap (quantity item)'), findsOne);
    expect(repo.captures, isEmpty);
    await tester.tap(find.byKey(const Key('stock.quick.undo')));
    await tester.pumpAndSettle();
    expect(find.text('Count removed. Nothing was sent.'), findsOneWidget);
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    expect(repo.captures, isEmpty, reason: 'undone: never sent');
    expect(
      (tester
              .widget<Container>(find.byKey(const Key('stock.dot.line-a')))
              .decoration! as BoxDecoration)
          .border,
      isNotNull,
      reason: 'back to "not counted today"',
    );

    // Without Undo it is sent once the snackbar closes, with the mark.
    await tester.longPress(find.byKey(const Key('stock.item.line-b')));
    await tester.pump();
    expect(find.text('Counted: DEMO Valve cap (quantity item)'), findsOne);
    for (int i = 0; i < 8; i++) {
      await tester.pump(const Duration(seconds: 1));
    }
    await tester.pumpAndSettle();
    expect(repo.captures, hasLength(1));
    expect(repo.captures.single['quantity'], 8);
    expect(repo.captures.single['genuine'], true);
    expect((repo.captures.single['refs']! as Map)['stock_id'], 'line-b');
  });

  testWidgets('long-press opens the card when genuine status is unchecked',
      (WidgetTester tester) async {
    final _Repo repo = _Repo();
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();
    expect(find.text('Unchecked'), findsNWidgets(2));
    await tester.longPress(find.byKey(const Key('stock.item.line-a')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stock.matches.line-a')), findsOneWidget);
    expect(repo.captures, isEmpty);
  });

  testWidgets('screen readers get a "Mark as matches" action on each line',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await tester.pumpWidget(_app(_overrides(_Repo())));
    await tester.pumpAndSettle();
    final SemanticsNode node = tester.getSemantics(
      find.byKey(const Key('stock.item.line-a')),
    );
    expect(
      node.getSemanticsData().customSemanticsActionIds,
      isNotEmpty,
    );
    handle.dispose();
  });

  testWidgets('the cards fit a small phone without overflow',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_app(_overrides(_Repo())));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'offline reload keeps the last loaded list on screen with a banner, '
      'never a full screen spinner', (WidgetTester tester) async {
    final _Repo repo = _Repo();
    int loads = 0;
    final List<Override> overrides = _overrides(
      repo,
      items: stockItemsProvider.overrideWith((Ref ref) async {
        loads++;
        if (loads == 1) {
          ref
              .read(lastStockItemsProvider.notifier)
              .remember('KSA', const <StockItem>[_binA, _binB]);
          return const <StockItem>[_binA, _binB];
        }
        throw const SupabaseFailure(
          error: AppError(
            kind: AppErrorKind.network,
            message: 'offline',
          ),
          cause: SupabaseFailureCause.offline,
        );
      }),
    );
    await tester.pumpWidget(_app(overrides));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stock.item.line-a')), findsOneWidget);

    ProviderScope.containerOf(
      tester.element(find.byType(StockCountScreen)),
    ).invalidate(stockItemsProvider);
    await tester.pump();
    expect(find.byKey(const Key('stock.item.line-a')), findsOneWidget);
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(const Key('stock.banner.offline')), findsOneWidget);
    expect(
      find.text('Offline - showing last loaded data'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('stock.item.line-a')), findsOneWidget);
    expect(find.byKey(const Key('stock.item.line-b')), findsOneWidget);
  });

  testWidgets("Home's Need reorder tile opens the list on low stock",
      (WidgetTester tester) async {
    final _Repo repo = _Repo();
    const StockItem plenty = StockItem(
      id: 'line-c',
      site: 'DEMO YARD',
      description: 'DEMO Plenty',
      quantity: 40,
      minimum: 2,
      country: 'KSA',
    );
    const StockItem low = StockItem(
      id: 'line-d',
      site: 'DEMO YARD',
      description: 'DEMO Low',
      quantity: 1,
      minimum: 2,
      country: 'KSA',
    );
    final ProviderContainer container = ProviderContainer(
      overrides: _overrides(
        repo,
        items: stockItemsProvider
            .overrideWith((Ref ref) async => const <StockItem>[plenty, low]),
      ),
    );
    addTearDown(container.dispose);
    container
        .read(stockCountRequestedFilterProvider.notifier)
        .request(StockCountFilter.low);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(
          localizationsDelegates: TpLocalizations.delegates,
          supportedLocales: TpLocalizations.supportedLocales,
          home: StockCountScreen(route: StockCountRoute()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<ChoiceChip>(find.byKey(const Key('stock.filter.low')))
          .selected,
      isTrue,
    );
    expect(
      find.byKey(const Key('stock.item.line-c'), skipOffstage: false),
      findsNothing,
    );
    await tester.scrollUntilVisible(
      find.byKey(const Key('stock.item.line-d')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.byKey(const Key('stock.item.line-d')), findsOneWidget);
    expect(
      container.read(stockCountRequestedFilterProvider),
      isNull,
      reason: 'the request is applied once, then cleared',
    );
  });
}
