// Writes review screenshots of the field-hardware screens (360x800, English
// and Arabic). Not a golden: nothing is compared. Runs only when asked,
// because it needs real fonts from the host:
//
//   TP_DEVICES_SCREENSHOTS=1 TP_SHOTS_DIR=/abs/out flutter test \
//     test/features/devices/devices_screenshots_test.dart
//
// Fonts: Material Icons from the Flutter SDK and a host font with Latin and
// Arabic glyphs (macOS "Arial Unicode", or TP_SCREENSHOT_FONT=/path/font.ttf),
// registered as Roboto.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/known_device_profiles.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';
import 'package:tyre_pulse/core/devices/label_pdf.dart';
import 'package:tyre_pulse/core/devices/paired_device_store.dart';
import 'package:tyre_pulse/core/devices/simulator_device_adapter.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/devices/presentation/devices_screen.dart';
import 'package:tyre_pulse/features/devices/presentation/gauge_read_flow.dart';
import 'package:tyre_pulse/features/devices/presentation/label_print_action.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_editor_sheet.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_lookup.dart';
import 'package:tyre_pulse/features/scanning/presentation/camera_access.dart';
import 'package:tyre_pulse/features/scanning/presentation/scanner_controller.dart';
import 'package:tyre_pulse/features/scanning/presentation/scanner_screen.dart';

import '../scanning/fake_scan_lookup_source.dart';
import 'devices_test_support.dart';

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

const List<PairedDevice> _paired = <PairedDevice>[
  PairedDevice(
    id: simulatorGaugeId,
    name: 'Tread & pressure probe',
    kind: DeviceKind.combinedGauge,
    transport: DeviceTransport.simulator,
  ),
  PairedDevice(
    id: 'hid-scanner',
    name: 'Rugged handheld (trigger)',
    kind: DeviceKind.scanner,
    transport: DeviceTransport.hid,
  ),
  PairedDevice(
    id: 'uhf-reader',
    name: 'UHF RFID reader',
    kind: DeviceKind.rfidReader,
    transport: DeviceTransport.ble,
  ),
  PairedDevice(
    id: simulatorPrinterId,
    name: 'Store label printer',
    kind: DeviceKind.labelPrinter,
    transport: DeviceTransport.simulator,
    profile: DeviceProfile(printerLanguage: PrinterLanguage.zpl),
  ),
];

void main() {
  final String outDir = Platform.environment['TP_SHOTS_DIR'] ?? '';
  final bool enabled = Platform.environment['TP_DEVICES_SCREENSHOTS'] == '1' &&
      outDir.isNotEmpty &&
      _textFont() != null;

  setUpAll(() async {
    if (!enabled) return;
    final String root = Platform.environment['FLUTTER_ROOT'] ?? '';
    await _load('Roboto', _textFont()!);
    await _load(
      'MaterialIcons',
      '$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    );
  });

  Future<void> save(WidgetTester tester, String name) async {
    final RenderRepaintBoundary boundary =
        tester.renderObject<RenderRepaintBoundary>(
      find.byType(RepaintBoundary).first,
    );
    await tester.runAsync(() async {
      final ui.Image image = await boundary.toImage(pixelRatio: 2);
      final ByteData? png =
          await image.toByteData(format: ui.ImageByteFormat.png);
      Directory(outDir).createSync(recursive: true);
      File('$outDir/$name.png').writeAsBytesSync(png!.buffer.asUint8List());
    });
  }

  Future<MemoryPairedDeviceStore> store() async {
    final MemoryPairedDeviceStore s = MemoryPairedDeviceStore();
    await s.save(testUserId, _paired);
    return s;
  }

  Future<void> pump(
    WidgetTester tester,
    String lang,
    Widget home, {
    MemoryPairedDeviceStore? s,
  }) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      RepaintBoundary(
        child: deviceApp(
          overrides: deviceOverrides(
            role: RoleId.admin,
            store: s ?? await store(),
            simulator: SimulatorDeviceAdapter(delay: Duration.zero),
          ),
          locale: Locale(lang),
          home: home,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  for (final String lang in <String>['en', 'ar']) {
    testWidgets('devices list + test results $lang', skip: !enabled,
        (WidgetTester tester) async {
      await pump(tester, lang, const DevicesScreen());
      await tester.tap(find.byKey(DevicesScreenKeys.test(simulatorGaugeId)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(DevicesScreenKeys.test('uhf-reader')));
      await tester.pumpAndSettle();
      await save(tester, '01_devices_list_$lang');
      await tester.drag(find.byType(ListView), const Offset(0, -500));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(DevicesScreenKeys.test(simulatorPrinterId)));
      await tester.pumpAndSettle();
      await save(tester, '02_devices_list_printer_test_$lang');
    });

    testWidgets('pairing flow $lang', skip: !enabled,
        (WidgetTester tester) async {
      await pump(
        tester,
        lang,
        const DevicesScreen(),
        s: MemoryPairedDeviceStore(),
      );
      await save(tester, '03_devices_empty_$lang');
      await tester.tap(find.byKey(DevicesScreenKeys.add));
      await tester.pumpAndSettle();
      await save(tester, '04_pair_choose_kind_$lang');
      await tester
          .tap(find.byKey(DevicesScreenKeys.kind(DeviceKind.labelPrinter)));
      await tester.pumpAndSettle();
      await save(tester, '05_pair_choose_connection_$lang');
      await tester.tap(
        find.byKey(DevicesScreenKeys.transport(DeviceTransport.simulator)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(DevicesScreenKeys.found(simulatorPrinterId)));
      await tester.pumpAndSettle();
      await save(tester, '06_pair_scan_results_$lang');
    });

    testWidgets('network printer form $lang', skip: !enabled,
        (WidgetTester tester) async {
      await pump(
        tester,
        lang,
        const DevicesScreen(),
        s: MemoryPairedDeviceStore(),
      );
      await tester.tap(find.byKey(DevicesScreenKeys.add));
      await tester.pumpAndSettle();
      await tester
          .tap(find.byKey(DevicesScreenKeys.kind(DeviceKind.labelPrinter)));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(DevicesScreenKeys.transport(DeviceTransport.network)),
      );
      await tester.pumpAndSettle();
      await save(tester, '07_pair_network_printer_$lang');
    });

    testWidgets('keyboard (HID) scanner pairing $lang', skip: !enabled,
        (WidgetTester tester) async {
      await pump(
        tester,
        lang,
        const DevicesScreen(),
        s: MemoryPairedDeviceStore(),
      );
      await tester.tap(find.byKey(DevicesScreenKeys.add));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(DevicesScreenKeys.kind(DeviceKind.scanner)));
      await tester.pumpAndSettle();
      await tester
          .tap(find.byKey(DevicesScreenKeys.transport(DeviceTransport.hid)));
      await tester.pumpAndSettle();
      await save(tester, '08_pair_hid_scanner_$lang');
    });

    testWidgets('read from gauge $lang', skip: !enabled,
        (WidgetTester tester) async {
      await pump(
        tester,
        lang,
        Scaffold(
          body: SafeArea(
            child: TyrePositionEditorSheet(
              reading: const TyrePositionReading(
                position: 'F1L',
                pressurePsi: 104,
              ),
              positionLabel: 'LHF1',
              onChanged: (_) {},
              onCapturePhoto: (PhotoCaptureSource _) {},
            ),
          ),
        ),
      );
      await save(tester, '09_tyre_sheet_gauge_buttons_$lang');
      await tester.tap(find.byKey(GaugeReadKeys.readPressure));
      await tester.pumpAndSettle();
      // One gauge measures pressure, so it is used directly: confirm.
      await save(tester, '10_gauge_confirm_$lang');
    });

    testWidgets('keyboard gauge capture $lang', skip: !enabled,
        (WidgetTester tester) async {
      final MemoryPairedDeviceStore s = MemoryPairedDeviceStore();
      await s.save(testUserId, const <PairedDevice>[
        PairedDevice(
          id: 'hid-gauge',
          name: 'Keyboard tread gauge',
          kind: DeviceKind.treadGauge,
          transport: DeviceTransport.hid,
        ),
      ]);
      await pump(
        tester,
        lang,
        Scaffold(
          body: TyrePositionEditorSheet(
            reading: TyrePositionReading.seed('F1L'),
            positionLabel: 'LHF1',
            onChanged: (_) {},
            onCapturePhoto: (PhotoCaptureSource _) {},
          ),
        ),
        s: s,
      );
      await tester.tap(find.byKey(GaugeReadKeys.readTread));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(GaugeReadKeys.hidField), '11.6mm');
      await tester.pump();
      await save(tester, '12_gauge_keyboard_capture_$lang');
    });

    testWidgets('handheld trigger on the scanner $lang', skip: !enabled,
        (WidgetTester tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final FakeScanLookupSource fake = FakeScanLookupSource();
      fake.exactAssetByCode['TM514'] = const AssetLookupRecord(
        id: 'a1',
        assetNo: 'TM514',
        site: 'NHC',
        vehicleType: 'Tr-Mixer',
      );
      final GoRouter router = GoRouter(
        initialLocation: '/scan',
        routes: <RouteBase>[
          GoRoute(
            path: '/scan',
            builder: (BuildContext c, GoRouterState s) => const ScannerScreen(),
          ),
        ],
      );
      await tester.pumpWidget(
        RepaintBoundary(
          child: ProviderScope(
            overrides: <Override>[
              ...deviceOverrides(
                role: RoleId.admin,
                store: MemoryPairedDeviceStore(),
                simulator: SimulatorDeviceAdapter(delay: Duration.zero),
              ),
              scanLookupRepositoryProvider.overrideWithValue(fake),
              cameraAccessProvider
                  .overrideWithValue(const CameraUnavailableInThisBuild()),
            ],
            child: MaterialApp.router(
              debugShowCheckedModeBanner: false,
              theme: TpTheme.light,
              locale: Locale(lang),
              routerConfig: router,
              supportedLocales: TpLocalizations.supportedLocales,
              localizationsDelegates: TpLocalizations.delegates,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await save(tester, '16_scanner_handheld_ready_$lang');
      for (final String c in 'TM514'.split('')) {
        final LogicalKeyboardKey key =
            LogicalKeyboardKey(c.toLowerCase().codeUnitAt(0));
        await tester.sendKeyDownEvent(key, character: c);
        await tester.sendKeyUpEvent(key);
      }
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      await save(tester, '17_scanner_handheld_result_$lang');
    });

    testWidgets('print label sheet $lang', skip: !enabled,
        (WidgetTester tester) async {
      await pump(
        tester,
        lang,
        Scaffold(
          appBar: AppBar(
            title: const Text('TM-514'),
            actions: <Widget>[
              LabelPrintButton(
                label: LabelData(
                  code: 'TM-514',
                  name: lang == 'ar' ? 'خلاطة نقل ساني' : 'Sany transit mixer',
                  caption: 'NHC',
                ),
              ),
            ],
          ),
          body: const SizedBox.expand(),
        ),
      );
      await tester.tap(find.byKey(LabelPrintKeys.button));
      await tester.pumpAndSettle();
      await save(tester, '13_print_label_sheet_$lang');
    });
  }

  test('label PDF preview file', skip: !enabled, () async {
    final Uint8List pdf = await buildLabelPdf(
      const LabelData(
        code: 'TM-514',
        name: 'Sany transit mixer',
        caption: 'NHC',
      ),
    );
    File('$outDir/14_label_preview_50x25.pdf').writeAsBytesSync(pdf);
    final Uint8List pdf30 = await buildLabelPdf(
      const LabelData(
        code: 'STK-00931',
        name: 'Tyre 315/80R22.5',
        caption: 'Store 1',
      ),
      size: LabelSize.mm50x30,
    );
    File('$outDir/15_label_preview_50x30.pdf').writeAsBytesSync(pdf30);
    expect(genericPrinterServiceUuid, isNotEmpty);
  });
}
