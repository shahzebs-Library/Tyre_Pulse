/// "Read from gauge", handheld scanner routing and "Print label": the admin
/// path works end to end with the simulator, and a non-admin role sees none
/// of it and keeps the old behaviour.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';
import 'package:tyre_pulse/core/devices/paired_device_store.dart';
import 'package:tyre_pulse/core/devices/simulator_device_adapter.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/devices/presentation/gauge_read_flow.dart';
import 'package:tyre_pulse/features/devices/presentation/hid_scan_listener.dart';
import 'package:tyre_pulse/features/devices/presentation/label_print_action.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_editor_sheet.dart';

import 'devices_test_support.dart';

const List<PairedDevice> _gauges = <PairedDevice>[
  PairedDevice(
    id: simulatorGaugeId,
    name: 'Sim gauge',
    kind: DeviceKind.combinedGauge,
    transport: DeviceTransport.simulator,
  ),
];

Future<MemoryPairedDeviceStore> _storeWithGauge() async {
  final MemoryPairedDeviceStore store = MemoryPairedDeviceStore();
  await store.save(testUserId, _gauges);
  return store;
}

Future<void> _pumpSheet(
  WidgetTester tester, {
  required RoleId role,
  required MemoryPairedDeviceStore store,
  required ValueChanged<TyrePositionReading> onChanged,
  TyrePositionReading? reading,
}) async {
  tester.view.physicalSize = const Size(420, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    deviceApp(
      overrides: deviceOverrides(
        role: role,
        store: store,
        simulator: SimulatorDeviceAdapter(delay: Duration.zero),
      ),
      home: Scaffold(
        body: TyrePositionEditorSheet(
          reading: reading ?? TyrePositionReading.seed('F1L'),
          positionLabel: 'LHF1',
          onChanged: onChanged,
          onCapturePhoto: (PhotoCaptureSource _) {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('Read from gauge (admin)', () {
    testWidgets('fills pressure only after the person confirms',
        (WidgetTester tester) async {
      TyrePositionReading? emitted;
      await _pumpSheet(
        tester,
        role: RoleId.admin,
        store: await _storeWithGauge(),
        onChanged: (TyrePositionReading r) => emitted = r,
      );

      await tester.tap(find.byKey(GaugeReadKeys.readPressure));
      await tester.pumpAndSettle();
      expect(find.text('Use this reading?'), findsOneWidget);
      expect(
        find.textContaining(
          RegExp('Sim gauge measured .*110.5 psi.* on LHF1'),
        ),
        findsOne,
      );
      expect(emitted, isNull, reason: 'nothing is written before confirm');

      await tester.tap(find.byKey(GaugeReadKeys.useReading));
      await tester.pumpAndSettle();
      expect(emitted?.pressurePsi, 110.5);
      expect(find.widgetWithText(TextField, '110.5'), findsOneWidget);
    });

    testWidgets('names the value it would replace, and Cancel keeps it',
        (WidgetTester tester) async {
      TyrePositionReading? emitted;
      await _pumpSheet(
        tester,
        role: RoleId.admin,
        store: await _storeWithGauge(),
        reading: const TyrePositionReading(position: 'F1L', treadDepthMm: 9),
        onChanged: (TyrePositionReading r) => emitted = r,
      );

      await tester.tap(find.byKey(GaugeReadKeys.readTread));
      await tester.pumpAndSettle();
      expect(
        find.textContaining(
          RegExp('This replaces the value already entered .*9.0 mm'),
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(emitted, isNull);
      expect(find.widgetWithText(TextField, '9'), findsOneWidget);
    });

    testWidgets('no gauge set up says so and changes nothing',
        (WidgetTester tester) async {
      TyrePositionReading? emitted;
      await _pumpSheet(
        tester,
        role: RoleId.admin,
        store: MemoryPairedDeviceStore(),
        onChanged: (TyrePositionReading r) => emitted = r,
      );
      await tester.tap(find.byKey(GaugeReadKeys.readPressure));
      await tester.pumpAndSettle();
      expect(find.textContaining('No gauge is set up'), findsOneWidget);
      expect(emitted, isNull);
    });
  });

  group('non-admin roles see no device features', () {
    for (final RoleId role in <RoleId>[
      RoleId.inspector,
      RoleId.tyreMan,
      RoleId.manager,
      RoleId.director,
    ]) {
      testWidgets('${role.name}: no gauge buttons, no print, no HID routing',
          (WidgetTester tester) async {
        await _pumpSheet(
          tester,
          role: role,
          store: await _storeWithGauge(),
          onChanged: (_) {},
        );
        expect(find.byKey(GaugeReadKeys.readPressure), findsNothing);
        expect(find.byKey(GaugeReadKeys.readTread), findsNothing);
        // The ordinary fields are still there and untouched.
        expect(find.text('Flat'), findsOneWidget);

        final List<String> scans = <String>[];
        await tester.pumpWidget(
          deviceApp(
            overrides: deviceOverrides(
              role: role,
              store: MemoryPairedDeviceStore(),
              simulator: SimulatorDeviceAdapter(),
            ),
            home: Scaffold(
              appBar: AppBar(
                actions: const <Widget>[
                  LabelPrintButton(
                    label: LabelData(code: 'TM-1', name: 'Mixer'),
                  ),
                ],
              ),
              body: HidScanListener(
                onScan: scans.add,
                clock: () => Duration.zero,
                child: const SizedBox.expand(),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(LabelPrintKeys.button), findsNothing);
        await _typeBurst(tester, 'TM514');
        expect(scans, isEmpty);
      });
    }
  });

  testWidgets('admin: a handheld burst is routed as a scan, Print is offered',
      (WidgetTester tester) async {
    final List<String> scans = <String>[];
    await tester.pumpWidget(
      deviceApp(
        overrides: deviceOverrides(
          role: RoleId.admin,
          store: MemoryPairedDeviceStore(),
          simulator: SimulatorDeviceAdapter(),
        ),
        home: Scaffold(
          appBar: AppBar(
            actions: const <Widget>[
              LabelPrintButton(label: LabelData(code: 'TM-1', name: 'Mixer')),
            ],
          ),
          body: HidScanListener(
            onScan: scans.add,
            clock: () => Duration.zero,
            child: const SizedBox.expand(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(LabelPrintKeys.button), findsOneWidget);
    await _typeBurst(tester, 'TM514');
    expect(scans, <String>['TM514']);

    await tester.tap(find.byKey(LabelPrintKeys.button));
    await tester.pumpAndSettle();
    expect(find.byKey(LabelPrintKeys.pdfOption), findsOneWidget);
  });
}

Future<void> _typeBurst(WidgetTester tester, String code) async {
  for (final String c in code.split('')) {
    final LogicalKeyboardKey key =
        c.codeUnitAt(0) >= 0x30 && c.codeUnitAt(0) <= 0x39
            ? LogicalKeyboardKey(0x30 + c.codeUnitAt(0) - 0x30)
            : LogicalKeyboardKey(c.toLowerCase().codeUnitAt(0));
    await tester.sendKeyDownEvent(key, character: c);
    await tester.sendKeyUpEvent(key);
  }
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pump();
}
