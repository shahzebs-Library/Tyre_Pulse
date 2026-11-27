import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/paired_device_store.dart';
import 'package:tyre_pulse/core/devices/simulator_device_adapter.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/devices/presentation/devices_screen.dart';

import 'devices_test_support.dart';

Future<void> _pump(
  WidgetTester tester, {
  required RoleId role,
  MemoryPairedDeviceStore? store,
  SimulatorDeviceAdapter? simulator,
  Size size = const Size(390, 844),
  Locale locale = const Locale('en'),
  double textScale = 1,
  ThemeData? theme,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    deviceApp(
      overrides: deviceOverrides(
        role: role,
        store: store ?? MemoryPairedDeviceStore(),
        simulator: simulator ?? SimulatorDeviceAdapter(delay: Duration.zero),
      ),
      home: const DevicesScreen(),
      locale: locale,
      textScale: textScale,
      theme: theme,
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('admin sees the empty state and the Add device action',
      (WidgetTester tester) async {
    await _pump(tester, role: RoleId.admin);
    expect(find.byKey(DevicesScreenKeys.empty), findsOneWidget);
    expect(find.byKey(DevicesScreenKeys.add), findsOneWidget);
    expect(find.byKey(DevicesScreenKeys.denied), findsNothing);
  });

  testWidgets('a field role is refused and gets no Add action',
      (WidgetTester tester) async {
    await _pump(tester, role: RoleId.inspector);
    expect(find.byKey(DevicesScreenKeys.denied), findsOneWidget);
    expect(find.byKey(DevicesScreenKeys.add), findsNothing);
  });

  testWidgets('add a simulator gauge, read once, then forget it',
      (WidgetTester tester) async {
    final MemoryPairedDeviceStore store = MemoryPairedDeviceStore();
    await _pump(tester, role: RoleId.admin, store: store);

    await tester.tap(find.byKey(DevicesScreenKeys.add));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(DevicesScreenKeys.kind(DeviceKind.pressureGauge)),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(DevicesScreenKeys.transport(DeviceTransport.simulator)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(DevicesScreenKeys.found(simulatorGaugeId)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(DevicesScreenKeys.save));
    await tester.pumpAndSettle();

    expect(find.byKey(DevicesScreenKeys.tile(simulatorGaugeId)), findsOne);
    expect(store.byUser[testUserId], hasLength(1));
    expect(store.byUser[testUserId]!.single.kind, DeviceKind.pressureGauge);

    await tester.tap(find.byKey(DevicesScreenKeys.test(simulatorGaugeId)));
    await tester.pumpAndSettle();
    expect(find.text('Read 110.5 psi'), findsOneWidget);
    expect(find.text('Battery 87%'), findsOneWidget);

    await tester.tap(find.byKey(DevicesScreenKeys.forget(simulatorGaugeId)));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Forget'));
    await tester.pumpAndSettle();
    expect(store.byUser[testUserId], isEmpty);
    expect(find.byKey(DevicesScreenKeys.empty), findsOneWidget);
  });

  testWidgets('an unreadable gauge payload is explained, not invented',
      (WidgetTester tester) async {
    final MemoryPairedDeviceStore store = MemoryPairedDeviceStore();
    await store.save(testUserId, const <PairedDevice>[
      PairedDevice(
        id: simulatorGaugeId,
        name: 'Probe',
        kind: DeviceKind.pressureGauge,
        transport: DeviceTransport.simulator,
      ),
    ]);
    await _pump(
      tester,
      role: RoleId.admin,
      store: store,
      simulator: SimulatorDeviceAdapter(
        delay: Duration.zero,
        pressurePayload: 'ERR',
      ),
    );
    await tester.tap(find.byKey(DevicesScreenKeys.test(simulatorGaugeId)));
    await tester.pumpAndSettle();
    expect(find.textContaining('cannot read'), findsOneWidget);
  });

  testWidgets('a printer test prints a real label',
      (WidgetTester tester) async {
    final MemoryPairedDeviceStore store = MemoryPairedDeviceStore();
    await store.save(testUserId, const <PairedDevice>[
      PairedDevice(
        id: simulatorPrinterId,
        name: 'Zebra',
        kind: DeviceKind.labelPrinter,
        transport: DeviceTransport.simulator,
        profile: DeviceProfile(printerLanguage: PrinterLanguage.zpl),
      ),
    ]);
    final SimulatorDeviceAdapter sim =
        SimulatorDeviceAdapter(delay: Duration.zero);
    await _pump(tester, role: RoleId.admin, store: store, simulator: sim);
    await tester.tap(find.byKey(DevicesScreenKeys.test(simulatorPrinterId)));
    await tester.pumpAndSettle();
    expect(sim.printed, hasLength(1));
    expect(String.fromCharCodes(sim.printed.single), startsWith('^XA'));
    expect(find.text('Test label sent to the printer.'), findsOneWidget);
  });

  for (final (String name, Locale locale, ThemeData theme) variant
      in <(String, Locale, ThemeData)>[
    ('light en', const Locale('en'), TpTheme.light),
    ('dark ar (RTL)', const Locale('ar'), TpTheme.dark),
    ('light ur (RTL)', const Locale('ur'), TpTheme.light),
  ]) {
    testWidgets('360dp, text scale 2.0, ${variant.$1}: no overflow',
        (WidgetTester tester) async {
      final MemoryPairedDeviceStore store = MemoryPairedDeviceStore();
      await store.save(testUserId, const <PairedDevice>[
        PairedDevice(
          id: simulatorGaugeId,
          name: 'A rather long gauge name for a small phone',
          kind: DeviceKind.combinedGauge,
          transport: DeviceTransport.simulator,
        ),
      ]);
      await _pump(
        tester,
        role: RoleId.admin,
        store: store,
        size: const Size(360, 740),
        locale: variant.$2,
        textScale: 2,
        theme: variant.$3,
      );
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(DevicesScreenKeys.test(simulatorGaugeId)));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(DevicesScreenKeys.add));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }
}
