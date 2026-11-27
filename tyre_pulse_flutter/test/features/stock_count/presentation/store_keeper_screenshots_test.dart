// Review screenshots of the Store Keeper screens (Stock Count offline,
// Home pending sync, the Store item card, the Add part number sheet) at
// 360x800, English light and Arabic dark. Not a golden: nothing is compared.
// Runs only when asked, because it needs real host fonts:
//
//   TP_STORE_SHOTS=/abs/out/dir flutter test \
//     test/features/stock_count/presentation/store_keeper_screenshots_test.dart
//
// Text font: macOS "Arial Unicode" (Latin + Arabic) or TP_SCREENSHOT_FONT,
// registered as Roboto; Material Icons from the Flutter SDK.
import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/auth/auth_providers.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/alerts/alerts_providers.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';
import 'package:tyre_pulse/features/home/domain/home_work.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/home/presentation/home_screen.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_item.dart';
import 'package:tyre_pulse/features/my_work/my_work_providers.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_history_repository.dart';
import 'package:tyre_pulse/features/stock_count/data/store_item_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';
import 'package:tyre_pulse/features/stock_count/domain/store_item_card.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_count_screen.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_providers.dart';
import 'package:tyre_pulse/features/stock_count/store_item_providers.dart';

import '../../../core/database/database_test_support.dart';

const AccessState _keeper =
    AccessState(role: UserRole.known(RoleId.storeKeeper));

const WorkspaceContext _ws = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.storeKeeper),
  effectivePermissions: _keeper,
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  companyId: 'org-1',
  tenantId: 'org-1',
  activeCountry: 'KSA',
  legacySite: 'DEMO YARD',
  fullName: 'Store Keeper',
);

const StockItem _filter = StockItem(
  id: 'line-a',
  site: 'DEMO YARD',
  description: 'Oil filter element',
  quantity: 6,
  minimum: 2,
  country: 'KSA',
  itemId: 'item-1',
  locationCode: 'A-01',
  itemCode: 'GC-OF-1',
  uom: 'EA',
  condition: 'new',
  ownership: 'owned',
);
const StockItem _valve = StockItem(
  id: 'line-b',
  site: 'DEMO YARD',
  description: 'Tyre valve cap',
  quantity: 1,
  minimum: 5,
  country: 'KSA',
  itemId: 'item-2',
  locationCode: 'B-07',
  itemCode: 'GC-VC-2',
  uom: 'EA',
  condition: 'new',
  ownership: 'owned',
);
const StockItem _tyre = StockItem(
  id: 'line-c',
  site: 'DEMO YARD',
  description: '315/80R22.5 drive tyre',
  quantity: 14,
  minimum: 4,
  country: 'KSA',
  itemId: 'item-3',
  locationCode: 'T-02',
  itemCode: 'GC-TY-3',
  uom: 'EA',
  condition: 'new',
  ownership: 'owned',
);
const List<StockItem> _rows = <StockItem>[_filter, _valve, _tyre];

const String _photoRef =
    'tp-storage://tyre-photos/physical_inventory/org-1/material/p1.jpg';
const String _photoRef2 =
    'tp-storage://tyre-photos/physical_inventory/org-1/material/p2.jpg';

const StoreItemCard _card = StoreItemCard(
  stockId: 'line-a',
  name: 'Oil filter element',
  itemId: 'item-1',
  itemCode: 'GC-OF-1',
  uom: 'EA',
  catalogue: StoreCatalogueEntry(
    id: 'can-1',
    description: 'Oil filter element',
    status: 'active',
    companySku: 'GC-OF-1',
    brand: 'Mann',
    category: 'Filters',
  ),
  bins: <StoreItemBin>[
    StoreItemBin(
      stockId: 'line-a',
      quantity: 6,
      reserved: 1,
      site: 'DEMO YARD',
      locationCode: 'A-01',
      condition: 'new',
    ),
    StoreItemBin(
      stockId: 'line-d',
      quantity: 4,
      site: 'DEMO YARD',
      locationCode: 'B-07',
      condition: 'new',
    ),
  ],
  partNumbers: <StorePartNumber>[
    StorePartNumber(
      id: 'v1',
      status: 'active',
      brand: 'Mann',
      manufacturer: 'Mann+Hummel',
      partNumber: 'W 950/26',
    ),
    StorePartNumber(
      id: 'v2',
      status: 'proposed',
      brand: 'Bosch',
      partNumber: '0 451 103 336',
    ),
  ],
  references: <StoreItemReference>[
    StoreItemReference(type: 'barcode', value: '6291041500213', verified: true),
    StoreItemReference(type: 'oem', value: '60265434'),
  ],
  photos: <String>[_photoRef, _photoRef2],
);

final class _Repo implements StoreItemRepository {
  @override
  Future<StoreItemCard> card(StockItem item) async => _card;
  @override
  Future<List<String>> brands() async =>
      <String>['Bosch', 'Donaldson', 'Fleetguard', 'Mann', 'Sakura'];
  @override
  Future<StoreItemPermissions> permissions() async =>
      const StoreItemPermissions(canPropose: true, canTransfer: true);
  @override
  Future<Map<String, StockItemFace>> faces(List<String> itemIds) async =>
      const <String, StockItemFace>{
        'item-1': StockItemFace(photo: _photoRef, brand: 'Mann'),
        'item-3': StockItemFace(brand: 'Triangle'),
      };
  @override
  dynamic noSuchMethod(Invocation invocation) => Future<void>.value();
}

final class _History implements StockHistoryRepository {
  @override
  Future<List<StockMovement>> page(
    StockHistoryQuery query, {
    required int offset,
    required int limit,
  }) async =>
      offset > 0
          ? const <StockMovement>[]
          : <StockMovement>[
              StockMovement(
                id: 'm1',
                type: 'issue',
                change: -2,
                before: 8,
                after: 6,
                reference: 'JC-4521',
                at: DateTime(2026, 11, 26, 14, 10),
                actorName: 'Store Keeper',
              ),
              StockMovement(
                id: 'm2',
                type: 'receipt',
                change: 10,
                before: -2 + 0,
                after: 8,
                reference: 'GRN-118',
                at: DateTime(2026, 11, 20, 9, 30),
                actorName: 'Store Keeper',
              ),
            ];
  @override
  Future<MovementSummary> summary(StockHistoryQuery query) async =>
      summarizeMovements(const <StockMovement>[]);
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

String? _textFont() {
  final String? env = Platform.environment['TP_SCREENSHOT_FONT'];
  if (env != null && File(env).existsSync()) return env;
  const String mac = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
  return File(mac).existsSync() ? mac : null;
}

Future<void> _load(String family, String path) async {
  final ByteData bytes =
      ByteData.view(Uint8List.fromList(File(path).readAsBytesSync()).buffer);
  await (FontLoader(family)..addFont(Future<ByteData>.value(bytes))).load();
}

/// A drawn "photo" of a cylindrical filter, served by a local HTTP server.
Future<Uint8List> _photo(Color body) async {
  final ui.PictureRecorder rec = ui.PictureRecorder();
  final Canvas c = Canvas(rec);
  const Size s = Size(640, 480);
  c.drawRect(Offset.zero & s, Paint()..color = const Color(0xFFE7E2D6));
  const Rect can = Rect.fromLTWH(230, 90, 180, 300);
  c.drawRRect(
    RRect.fromRectAndRadius(can, const Radius.circular(24)),
    Paint()..color = body,
  );
  c.drawRect(
    const Rect.fromLTWH(230, 200, 180, 70),
    Paint()..color = const Color(0xFFF4F1EA),
  );
  c.drawOval(
    const Rect.fromLTWH(230, 70, 180, 44),
    Paint()..color = const Color(0xFF3A3A3A),
  );
  final ui.Image img =
      await rec.endRecording().toImage(s.width.toInt(), s.height.toInt());
  final ByteData? png = await img.toByteData(format: ui.ImageByteFormat.png);
  return png!.buffer.asUint8List();
}

void main() {
  final String? out = Platform.environment['TP_STORE_SHOTS'];
  final bool enabled = out != null && out.isNotEmpty && _textFont() != null;
  HttpServer? server;
  final Map<String, Uint8List> images = <String, Uint8List>{};

  setUpAll(() async {
    if (!enabled) return;
    final TestDefaultBinaryMessenger messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger
      ..setMockMethodCallHandler(
        const MethodChannel('dev.fluttercommunity.plus/connectivity'),
        (MethodCall call) async => <String>['none'],
      )
      ..setMockMethodCallHandler(
        const MethodChannel('dev.fluttercommunity.plus/connectivity_status'),
        (MethodCall call) async => null,
      );
    final String root = Platform.environment['FLUTTER_ROOT'] ?? '';
    await _load('Roboto', _textFont()!);
    await _load(
      'MaterialIcons',
      '$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    );
  });

  tearDownAll(() async => server?.close(force: true));

  Future<String> serve(WidgetTester tester) async {
    await tester.runAsync(() async {
      if (server != null) return;
      images['p1'] = await _photo(const Color(0xFF2F6FB0));
      images['p2'] = await _photo(const Color(0xFFC8962A));
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      server!.listen((HttpRequest r) {
        final String key = r.uri.pathSegments.last;
        r.response.persistentConnection = false;
        r.response.headers.contentType = ContentType('image', 'png');
        r.response.add(images[key] ?? images['p1']!);
        r.response.close();
      });
    });
    return 'http://127.0.0.1:${server!.port}';
  }

  Future<void> save(WidgetTester tester, GlobalKey shot, String name) async {
    final RenderRepaintBoundary b =
        shot.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    await tester.runAsync(() async {
      final ui.Image image = await b.toImage(pixelRatio: 2);
      final ByteData? png =
          await image.toByteData(format: ui.ImageByteFormat.png);
      Directory(out!).createSync(recursive: true);
      File('$out/$name.png').writeAsBytesSync(png!.buffer.asUint8List());
    });
  }

  Future<void> settle(WidgetTester tester) async {
    for (int i = 0; i < 6; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 150)),
      );
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  List<Override> common(String base) => <Override>[
        accessStateProvider.overrideWithValue(_keeper),
        workspaceContextProvider.overrideWithValue(_ws),
        activeCountryProvider.overrideWithValue('KSA'),
        storeItemRepositoryProvider.overrideWithValue(_Repo()),
        storeItemPermissionsProvider.overrideWith(
          (Ref ref) async =>
              const StoreItemPermissions(canPropose: true, canTransfer: true),
        ),
        stockHistoryRepositoryProvider.overrideWithValue(_History()),
        inventoryDeviceIdProvider.overrideWith((Ref ref) async => 'device-1'),
        privateStorageImageUrlProvider.overrideWith(
          (Ref ref, String reference) async =>
              '$base/${reference.split('/').last.replaceAll('.jpg', '')}',
        ),
      ];

  final List<(String, Brightness, Locale)> variants =
      <(String, Brightness, Locale)>[
    ('en_light', Brightness.light, const Locale('en')),
    ('ar_dark', Brightness.dark, const Locale('ar')),
  ];

  Widget wrap(
    GlobalKey shot,
    ProviderContainer c,
    Brightness b,
    Locale l,
    Widget home,
  ) =>
      RepaintBoundary(
        key: shot,
        child: UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            locale: l,
            theme: b == Brightness.dark ? TpTheme.dark : TpTheme.light,
            localizationsDelegates: TpLocalizations.delegates,
            supportedLocales: TpLocalizations.supportedLocales,
            home: home,
          ),
        ),
      );

  void phone(WidgetTester tester) {
    // Real HTTP for the local photo server (the test binding mocks it).
    HttpOverrides.global = null;
    tester.view
      ..physicalSize = const Size(360, 800)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
  }

  for (final (String tag, Brightness b, Locale l) in variants) {
    testWidgets('stock count offline $tag', skip: !enabled,
        (WidgetTester tester) async {
      phone(tester);
      final String base = await serve(tester);
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          ...common(base),
          stockItemsProvider.overrideWith(
            (Ref ref) async => throw const SupabaseFailure(
              error: AppError(
                kind: AppErrorKind.network,
                message: 'No connection.',
              ),
              cause: SupabaseFailureCause.offline,
            ),
          ),
        ],
      );
      addTearDown(c.dispose);
      c.read(lastStockItemsProvider.notifier).remember('KSA', _rows);
      final GlobalKey shot = GlobalKey();
      await tester.pumpWidget(
        wrap(shot, c, b, l, const StockCountScreen(route: StockCountRoute())),
      );
      await settle(tester);
      expect(find.byKey(const Key('stock.banner.offline')), findsOneWidget);
      await save(tester, shot, '01_stock_count_offline_$tag');
      // The same list at 2x text: a line may wrap to two lines, never more.
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(
            size: Size(360, 800),
            textScaler: TextScaler.linear(2),
          ),
          child: wrap(
            shot,
            c,
            b,
            l,
            const StockCountScreen(route: StockCountRoute()),
          ),
        ),
      );
      await settle(tester);
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -700));
      await settle(tester);
      await save(tester, shot, '01b_stock_count_text2x_$tag');
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('home pending sync $tag', skip: !enabled,
        (WidgetTester tester) async {
      phone(tester);
      final db = newMemoryDatabase();
      addTearDown(db.close);
      final DateTime now = DateTime(2026, 11, 27, 9, 30);
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          ...common('http://127.0.0.1:1'),
          accessLoadFailedProvider.overrideWithValue(false),
          retryAccessLoadProvider.overrideWithValue(null),
          appDatabaseProvider.overrideWithValue(db),
          unreadNotificationsCountProvider
              .overrideWithValue(const AsyncData<int>(0)),
          homeHeaderClockProvider.overrideWithValue(() => now),
          // The real Home count: 0 queued commands + 2 counts in the outbox.
          physicalOutboxPendingCountProvider
              .overrideWith((Ref ref) => Stream<int>.value(2)),
          homeLatestInspectionDraftProvider.overrideWith(
            (Ref ref) => Stream<InspectionDraftSummary?>.value(null),
          ),
          tyreAlertsProvider
              .overrideWith((Ref ref) async => const <TyreAlert>[]),
          homePendingInspectionApprovalsProvider.overrideWith(
            (Ref ref) async => const HomePendingApprovals(count: 0),
          ),
          myWorkClockProvider.overrideWithValue(() => now),
          myWorkSnapshotProvider.overrideWith(
            (Ref ref) async =>
                MyWorkSnapshot(items: const <MyWorkItem>[], loadedAt: now),
          ),
          stockItemsProvider.overrideWith((Ref ref) async => _rows),
          homeRecentAssetsProvider
              .overrideWith((Ref ref) async => const <HomeRecentAsset>[]),
        ],
      );
      addTearDown(c.dispose);
      final GlobalKey shot = GlobalKey();
      await tester.pumpWidget(
        wrap(shot, c, b, l, const HomeScreen(route: HomeRoute())),
      );
      await settle(tester);
      expect(await c.read(homePendingSyncCountProvider.future), 2);
      final Finder sync = find.text(
        l.languageCode == 'en' ? 'Pending sync' : '__none__',
      );
      if (sync.evaluate().isNotEmpty) {
        await tester.ensureVisible(sync.first);
        await settle(tester);
      } else {
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -500));
        await settle(tester);
      }
      await save(tester, shot, '02_home_pending_sync_$tag');
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('store item $tag', skip: !enabled, (WidgetTester tester) async {
      phone(tester);
      final String base = await serve(tester);
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          ...common(base),
          stockItemsProvider.overrideWith((Ref ref) async => _rows),
        ],
      );
      addTearDown(c.dispose);
      final GlobalKey shot = GlobalKey();
      // Opened from the Stock Count list, so the count actions are on it.
      await tester.pumpWidget(
        wrap(shot, c, b, l, const StockCountScreen(route: StockCountRoute())),
      );
      await settle(tester);
      await tester.tap(find.byKey(const Key('stock.item.line-a')));
      await settle(tester);
      await save(tester, shot, '03a_store_item_top_$tag');
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -560));
      await settle(tester);
      await save(tester, shot, '03b_store_item_parts_$tag');
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -900));
      await settle(tester);
      await save(tester, shot, '03c_store_item_movements_$tag');

      await tester.ensureVisible(
        find.byKey(const Key('storeItem.addPartNumber')),
      );
      await settle(tester);
      await tester.tap(find.byKey(const Key('storeItem.addPartNumber')));
      await settle(tester);
      await save(tester, shot, '04a_add_part_number_$tag');
      await tester.enterText(
        find.byKey(const Key('storeItem.field.brand')),
        'Fle',
      );
      await settle(tester);
      await save(tester, shot, '04b_add_part_number_brand_search_$tag');
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 5));
    });
  }
}
