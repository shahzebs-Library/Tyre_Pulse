// Writes review screenshots of the physical inventory capture screen (light
// and dark, English and Arabic) to docs/inventory/screenshots/flutter/.
//
// Not a golden: nothing is compared. It only runs when asked, because it
// needs real fonts from the host:
//
//   TP_INVENTORY_SCREENSHOTS=1 flutter test \
//     test/features/inventory/presentation/physical_inventory_screenshots_test.dart
//
// Fonts: Material Icons from the Flutter SDK, and a host font with Latin and
// Arabic glyphs (macOS "Arial Unicode", or TP_SCREENSHOT_FONT=/path/font.ttf),
// registered as Roboto, the family the test platform resolves text to.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/physical_inventory_screen.dart';

const String _outDir = '../docs/inventory/screenshots/flutter';

const InventoryPlace _store = InventoryPlace(
  id: 'wh-a',
  site: 'NHC',
  code: 'WH-A',
  name: 'Store 1 · Warehouse A',
  locationType: 'warehouse',
  country: 'KSA',
);

final class _Repo implements PhysicalInventoryRepository {
  @override
  Future<List<InventoryPlace>> stores() async => const <InventoryPlace>[_store];

  @override
  Future<InventoryPlace?> placeById(String id) async => id == 'bin-4'
      ? const InventoryPlace(
          id: 'bin-4',
          site: 'NHC',
          code: 'R03-B04',
          name: 'Rack 03 · Bin 04',
          locationType: 'bin',
          country: 'KSA',
        )
      : null;

  @override
  Future<PhysicalSession> startSession({
    required String idempotencyKey,
    required String country,
    required String site,
    String? locationId,
  }) async =>
      PhysicalSession(
        id: 's1',
        reference: 'PI-2026-0001',
        site: site,
        status: 'open',
        country: country,
        locationId: locationId,
      );

  @override
  Future<List<PhysicalSession>> openSessions() async =>
      const <PhysicalSession>[];

  @override
  Future<List<MaterialPick>> search(String query) async => const <MaterialPick>[
        MaterialPick(
          canonicalId: 'c1',
          variantId: 'v1',
          label: 'Air filter element / Sany 60265434',
          classification: 'genuine',
        ),
      ];

  @override
  Future<Map<String, Object?>> capture(Map<String, Object?> payload) =>
      throw UnimplementedError();

  @override
  Future<void> upload(String path, Uint8List bytes) =>
      throw UnimplementedError();

  @override
  Future<void> attachPhoto(Map<String, Object?> payload) =>
      throw UnimplementedError();
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

void main() {
  final bool enabled =
      Platform.environment['TP_INVENTORY_SCREENSHOTS'] == '1' &&
          _textFont() != null;

  setUpAll(() async {
    if (!enabled) return;
    // No connectivity plugin in a widget test: answer as "online on wifi".
    final TestDefaultBinaryMessenger messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger
      ..setMockMethodCallHandler(
        const MethodChannel('dev.fluttercommunity.plus/connectivity'),
        (MethodCall call) async => <String>['wifi'],
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

  for (final Brightness b in Brightness.values) {
    for (final String lang in <String>['en', 'ar']) {
      testWidgets('screenshot ${b.name} $lang', skip: !enabled,
          (WidgetTester tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final GlobalKey shot = GlobalKey();
        await tester.pumpWidget(
          RepaintBoundary(
            key: shot,
            child: ProviderScope(
              overrides: <Override>[
                workspaceContextProvider
                    .overrideWithValue(null as WorkspaceContext?),
                physicalInventoryRepositoryProvider.overrideWithValue(_Repo()),
                openPhysicalSessionsProvider
                    .overrideWith((Ref ref) async => const <PhysicalSession>[]),
              ],
              child: MaterialApp(
                debugShowCheckedModeBanner: false,
                locale: Locale(lang),
                theme: b == Brightness.dark ? TpTheme.dark : TpTheme.light,
                localizationsDelegates: TpLocalizations.delegates,
                supportedLocales: TpLocalizations.supportedLocales,
                home: const PhysicalInventoryScreen(),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pi.store.wh-a')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pi.start')));
        await tester.pumpAndSettle();

        // Scan a bin label, then find and pick an item, then count 4.
        final Finder scan = find.byKey(const Key('inventory.scan.field')).first;
        await tester.enterText(scan, 'TP:LOC:bin-4');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        await tester.enterText(scan, '60265434');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        await tester.tap(find.textContaining('Air filter'));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pi.qty')), '4');
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();

        Future<void> save(String name) async {
          final RenderRepaintBoundary boundary =
              shot.currentContext!.findRenderObject()! as RenderRepaintBoundary;
          await tester.runAsync(() async {
            final ui.Image image = await boundary.toImage(pixelRatio: 2);
            final ByteData? png =
                await image.toByteData(format: ui.ImageByteFormat.png);
            Directory(_outDir).createSync(recursive: true);
            File('$_outDir/$name.png')
                .writeAsBytesSync(png!.buffer.asUint8List());
          });
        }

        await save('capture_${b.name}_${lang}_top');
        await tester.drag(find.byType(ListView), const Offset(0, -640));
        await tester.pumpAndSettle();
        await save('capture_${b.name}_${lang}_bottom');
      });
    }
  }
}
