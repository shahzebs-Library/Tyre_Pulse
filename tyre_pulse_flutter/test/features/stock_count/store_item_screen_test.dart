// The Store item card as a Store Keeper uses it: photo, bins, part numbers,
// barcodes, and the additions that go to approval through the shared
// proposal RPCs (never a direct master-data write).
import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_history_repository.dart';
import 'package:tyre_pulse/features/stock_count/data/store_item_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';
import 'package:tyre_pulse/features/stock_count/domain/store_item_card.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_item_screen.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_providers.dart';
import 'package:tyre_pulse/features/stock_count/store_item_providers.dart';

const SupabaseFailure _offline = SupabaseFailure(
  error: AppError(
    kind: AppErrorKind.network,
    message: 'No connection.',
    isRetryable: true,
  ),
  cause: SupabaseFailureCause.offline,
);

const SupabaseFailure _refused = SupabaseFailure(
  error: AppError(
    kind: AppErrorKind.validation,
    message: 'Canonical material not found in your company.',
  ),
  cause: SupabaseFailureCause.unknown,
);

const StockItem _line = StockItem(
  id: 'line-a',
  site: 'DEMO YARD',
  description: 'DEMO Oil filter',
  quantity: 6,
  country: 'KSA',
  itemId: 'item-1',
  locationCode: 'A-01',
  itemCode: 'DEMO-F-001',
  uom: 'EA',
);

const StoreItemCard _linked = StoreItemCard(
  stockId: 'line-a',
  name: 'DEMO Oil filter',
  itemId: 'item-1',
  itemCode: 'DEMO-F-001',
  catalogue: StoreCatalogueEntry(
    id: 'can-1',
    description: 'Oil filter',
    status: 'active',
    companySku: 'GC-OF-1',
    brand: 'Mann',
    category: 'Filters',
  ),
  bins: <StoreItemBin>[
    StoreItemBin(
      stockId: 'line-a',
      quantity: 6,
      site: 'DEMO YARD',
      locationCode: 'A-01',
      reserved: 1,
    ),
    StoreItemBin(
      stockId: 'line-b',
      quantity: 4,
      site: 'DEMO YARD',
      locationCode: 'B-07',
    ),
  ],
  partNumbers: <StorePartNumber>[
    StorePartNumber(
      id: 'v1',
      status: 'active',
      brand: 'Mann',
      partNumber: 'W 950',
    ),
    StorePartNumber(
      id: 'v2',
      status: 'proposed',
      brand: 'Bosch',
      partNumber: '0451',
    ),
  ],
  references: <StoreItemReference>[
    StoreItemReference(type: 'barcode', value: '6291000', verified: true),
  ],
);

const StoreItemCard _unlinked = StoreItemCard(
  stockId: 'line-a',
  name: 'DEMO Oil filter',
  itemId: 'item-1',
  itemCode: 'DEMO-F-001',
  bins: <StoreItemBin>[StoreItemBin(stockId: 'line-a', quantity: 6)],
);

final class _Repo implements StoreItemRepository {
  _Repo(this.result, {this.readError});
  StoreItemCard result;
  Exception? readError;
  Exception? writeError;
  final List<Map<String, Object?>> calls = <Map<String, Object?>>[];

  Future<void> _write(String name, Map<String, Object?> args) async {
    calls.add(<String, Object?>{'call': name, ...args});
    if (writeError != null) throw writeError!;
  }

  @override
  Future<StoreItemCard> card(StockItem item) async {
    if (readError != null) throw readError!;
    return result;
  }

  @override
  Future<List<String>> brands() async => <String>['Bosch', 'Mann', 'Sakura'];

  @override
  Future<StoreItemPermissions> permissions() async =>
      const StoreItemPermissions(canPropose: true);

  @override
  Future<Map<String, StockItemFace>> faces(List<String> itemIds) async =>
      const <String, StockItemFace>{};

  @override
  Future<void> addPartNumber({
    required String canonicalId,
    required String brand,
    required String partNumber,
    required String idempotencyKey,
    String? manufacturer,
  }) =>
      _write('addPartNumber', <String, Object?>{
        'canonicalId': canonicalId,
        'brand': brand,
        'partNumber': partNumber,
        'manufacturer': manufacturer,
      });

  @override
  Future<void> addReference({
    required String canonicalId,
    required String aliasType,
    required String value,
    required String reason,
    required String idempotencyKey,
  }) =>
      _write('addReference', <String, Object?>{
        'canonicalId': canonicalId,
        'aliasType': aliasType,
        'value': value,
      });

  @override
  Future<void> correctBrand({
    required String targetKind,
    required String targetId,
    required String brand,
    required String reason,
    required String idempotencyKey,
  }) =>
      _write('correctBrand', <String, Object?>{
        'targetKind': targetKind,
        'targetId': targetId,
        'brand': brand,
        'reason': reason,
      });

  @override
  Future<void> addPhoto({
    required String orgId,
    required String canonicalId,
    required Uint8List bytes,
    required String clientUuid,
    String? variantId,
  }) =>
      _write('addPhoto', <String, Object?>{
        'orgId': orgId,
        'canonicalId': canonicalId,
        'bytes': bytes.length,
      });

  @override
  Future<void> proposeCatalogueEntry({
    required StockItem item,
    required String description,
    required String idempotencyKey,
    String? brand,
    String? partNumber,
    String? barcode,
  }) =>
      _write('propose', <String, Object?>{
        'stock': item.id,
        'description': description,
        'brand': brand,
        'partNumber': partNumber,
      });
}

final class _History implements StockHistoryRepository {
  _History({this.error});
  final Exception? error;

  @override
  Future<List<StockMovement>> page(
    StockHistoryQuery query, {
    required int offset,
    required int limit,
  }) async {
    if (error != null) throw error!;
    return const <StockMovement>[];
  }

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

List<Override> _overrides(
  _Repo repo, {
  StoreItemPermissions perms = const StoreItemPermissions(
    canPropose: true,
    canTransfer: true,
  ),
  Exception? historyError,
}) {
  int n = 0;
  return <Override>[
    storeItemRepositoryProvider.overrideWithValue(repo),
    storeItemPermissionsProvider.overrideWith((Ref ref) async => perms),
    stockHistoryRepositoryProvider
        .overrideWithValue(_History(error: historyError)),
    inventoryIdFactoryProvider.overrideWithValue(() => 'id-${n++}'),
    storeItemPhotoPickerProvider.overrideWithValue(
      ({required bool camera}) async => Uint8List.fromList(<int>[1, 2, 3]),
    ),
    workspaceContextProvider.overrideWithValue(
      const WorkspaceContext(
        userId: 'user-1',
        role: UserRole.known(RoleId.storeKeeper),
        effectivePermissions:
            AccessState(role: UserRole.known(RoleId.storeKeeper)),
        countryScope: CountryScope.none,
        siteScope: SiteScope.none,
        tenantId: 'org-1',
        activeCountry: 'KSA',
      ),
    ),
  ];
}

Widget _app(List<Override> overrides) => ProviderScope(
      overrides: overrides,
      child: const MaterialApp(
        localizationsDelegates: TpLocalizations.delegates,
        supportedLocales: TpLocalizations.supportedLocales,
        home: StoreItemScreen(item: _line),
      ),
    );

Future<void> _tall(WidgetTester tester) async {
  tester.view
    ..devicePixelRatio = 1
    ..physicalSize = const Size(420, 2600);
  addTearDown(tester.view.reset);
}

Future<void> _tapVisible(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows a loading state first', (WidgetTester tester) async {
    final Completer<StoreItemCard> never = Completer<StoreItemCard>();
    final _Repo repo = _Repo(_linked);
    await _tall(tester);
    await tester.pumpWidget(
      _app(<Override>[
        ..._overrides(repo),
        storeItemCardProvider.overrideWith(
          (Ref ref, StockItem item) => never.future,
        ),
      ]),
    );
    await tester.pump();
    expect(find.byKey(const Key('storeItem.loading')), findsOneWidget);
  });

  testWidgets('a linked item shows photo placeholder, bins and part numbers',
      (WidgetTester tester) async {
    await _tall(tester);
    await tester.pumpWidget(_app(_overrides(_Repo(_linked))));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('storeItem.noPhoto')), findsOneWidget);
    expect(find.byKey(const Key('storeItem.addPhoto')), findsOneWidget);
    expect(find.text('GC-OF-1'), findsOneWidget);
    expect(find.text('A-01'), findsOneWidget);
    expect(find.text('B-07'), findsOneWidget);
    expect(find.text('Total: 10'), findsOneWidget);
    expect(find.text('Mann · W 950'), findsOneWidget);
    expect(find.text('Bosch · 0451'), findsOneWidget);
    expect(find.text('Pending approval'), findsWidgets);
    expect(find.text('6291000'), findsOneWidget);
    expect(find.byKey(const Key('storeItem.notLinked')), findsNothing);
    expect(find.byKey(const Key('storeItem.moveBin')), findsOneWidget);
  });

  testWidgets('an unlinked item offers to propose it to the catalogue',
      (WidgetTester tester) async {
    final _Repo repo = _Repo(_unlinked);
    await _tall(tester);
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('storeItem.notLinked')), findsOneWidget);
    expect(find.byKey(const Key('storeItem.addPartNumber')), findsNothing);
    expect(find.byKey(const Key('storeItem.addPhoto')), findsNothing);

    await _tapVisible(tester, find.byKey(const Key('storeItem.propose')));
    await tester.enterText(
      find.byKey(const Key('storeItem.field.partNumber')),
      'W 950',
    );
    await tester.tap(find.byKey(const Key('storeItem.brand.Mann')));
    await tester.pumpAndSettle();
    await _tapVisible(tester, find.byKey(const Key('storeItem.send')));

    expect(repo.calls.single['call'], 'propose');
    expect(repo.calls.single['brand'], 'Mann');
    expect(repo.calls.single['partNumber'], 'W 950');
    expect(repo.calls.single['description'], 'DEMO Oil filter');
    expect(find.textContaining('Sent for review'), findsOneWidget);
  });

  testWidgets('a failed read shows the error state',
      (WidgetTester tester) async {
    await _tall(tester);
    await tester
        .pumpWidget(_app(_overrides(_Repo(_linked, readError: _offline))));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('storeItem.error')), findsOneWidget);
  });

  testWidgets('movements offline show an offline state, not a spinner',
      (WidgetTester tester) async {
    await _tall(tester);
    await tester.pumpWidget(
      _app(_overrides(_Repo(_linked), historyError: _offline)),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('storeItem.movementsOffline')), findsOneWidget);
  });

  testWidgets('add part number with a NEW brand goes to approval',
      (WidgetTester tester) async {
    final _Repo repo = _Repo(_linked);
    await _tall(tester);
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();

    await _tapVisible(tester, find.byKey(const Key('storeItem.addPartNumber')));
    await tester.enterText(
      find.byKey(const Key('storeItem.field.brand')),
      'Hengst',
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('storeItem.newBrand')), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('storeItem.field.partNumber')),
      'E10H',
    );
    await _tapVisible(tester, find.byKey(const Key('storeItem.send')));

    expect(repo.calls.single, <String, Object?>{
      'call': 'addPartNumber',
      'canonicalId': 'can-1',
      'brand': 'Hengst',
      'partNumber': 'E10H',
      'manufacturer': '',
    });
    expect(find.textContaining('sent for approval'), findsOneWidget);
  });

  testWidgets('a part number needs a value before it is sent',
      (WidgetTester tester) async {
    final _Repo repo = _Repo(_linked);
    await _tall(tester);
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();

    await _tapVisible(tester, find.byKey(const Key('storeItem.addPartNumber')));
    await _tapVisible(tester, find.byKey(const Key('storeItem.send')));
    expect(find.byKey(const Key('storeItem.problem')), findsOneWidget);
    expect(repo.calls, isEmpty);
  });

  testWidgets('add barcode sends an add_reference correction',
      (WidgetTester tester) async {
    final _Repo repo = _Repo(_linked);
    await _tall(tester);
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();

    await _tapVisible(tester, find.byKey(const Key('storeItem.addBarcode')));
    await tester.enterText(
      find.byKey(const Key('storeItem.field.barcode')),
      '62910001',
    );
    await _tapVisible(tester, find.byKey(const Key('storeItem.send')));

    expect(repo.calls.single['call'], 'addReference');
    expect(repo.calls.single['aliasType'], 'barcode');
    expect(repo.calls.single['value'], '62910001');
  });

  testWidgets('correct brand needs a reason and sends a correction',
      (WidgetTester tester) async {
    final _Repo repo = _Repo(_linked);
    await _tall(tester);
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();

    await _tapVisible(tester, find.byKey(const Key('storeItem.setBrand')));
    await tester.tap(find.byKey(const Key('storeItem.brand.Bosch')));
    await tester.pumpAndSettle();
    await _tapVisible(tester, find.byKey(const Key('storeItem.send')));
    expect(repo.calls, isEmpty);
    await tester.enterText(
      find.byKey(const Key('storeItem.field.reason')),
      'Label says Bosch',
    );
    await _tapVisible(tester, find.byKey(const Key('storeItem.send')));

    expect(repo.calls.single['call'], 'correctBrand');
    expect(repo.calls.single['targetKind'], 'canonical');
    expect(repo.calls.single['targetId'], 'can-1');
    expect(repo.calls.single['brand'], 'Bosch');
  });

  testWidgets('add photo uploads under the company and says so',
      (WidgetTester tester) async {
    final _Repo repo = _Repo(_linked);
    await _tall(tester);
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();

    await _tapVisible(tester, find.byKey(const Key('storeItem.addPhoto')));
    await _tapVisible(tester, find.byKey(const Key('storeItem.photo.gallery')));

    expect(repo.calls.single['call'], 'addPhoto');
    expect(repo.calls.single['orgId'], 'org-1');
    expect(repo.calls.single['canonicalId'], 'can-1');
    expect(find.textContaining('Photo added'), findsOneWidget);
  });

  testWidgets('offline photo says it needs a connection, never saved',
      (WidgetTester tester) async {
    final _Repo repo = _Repo(_linked)..writeError = _offline;
    await _tall(tester);
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();

    await _tapVisible(tester, find.byKey(const Key('storeItem.addPhoto')));
    await _tapVisible(tester, find.byKey(const Key('storeItem.photo.camera')));

    expect(find.textContaining('Needs a connection'), findsOneWidget);
    expect(find.textContaining('Photo added'), findsNothing);
  });

  testWidgets('a server refusal is shown with its reason',
      (WidgetTester tester) async {
    final _Repo repo = _Repo(_linked)..writeError = _refused;
    await _tall(tester);
    await tester.pumpWidget(_app(_overrides(repo)));
    await tester.pumpAndSettle();

    await _tapVisible(tester, find.byKey(const Key('storeItem.addBarcode')));
    await tester.enterText(
      find.byKey(const Key('storeItem.field.barcode')),
      '1',
    );
    await _tapVisible(tester, find.byKey(const Key('storeItem.send')));
    expect(
      find.text('Not sent: Canonical material not found in your company.'),
      findsOneWidget,
    );
  });

  testWidgets('without the capability the actions are hidden',
      (WidgetTester tester) async {
    await _tall(tester);
    await tester.pumpWidget(
      _app(
        _overrides(
          _Repo(_linked),
          perms: const StoreItemPermissions(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    for (final String k in <String>[
      'storeItem.addPhoto',
      'storeItem.addPartNumber',
      'storeItem.addBarcode',
      'storeItem.setBrand',
      'storeItem.moveBin',
    ]) {
      expect(find.byKey(Key(k)), findsNothing, reason: k);
    }
    expect(find.text('Mann · W 950'), findsOneWidget);
  });

  testWidgets('fits a 320dp phone without overflow',
      (WidgetTester tester) async {
    tester.view
      ..devicePixelRatio = 1
      ..physicalSize = const Size(320, 2600);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_app(_overrides(_Repo(_linked))));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.byKey(const Key('storeItem.addBarcode')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
