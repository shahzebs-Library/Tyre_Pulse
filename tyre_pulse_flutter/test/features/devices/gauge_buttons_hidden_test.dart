import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/devices/device_providers.dart';
import 'package:tyre_pulse/core/devices/paired_device_store.dart';
import 'package:tyre_pulse/core/devices/simulator_device_adapter.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/devices/presentation/gauge_read_flow.dart';

import 'devices_test_support.dart';

void main() {
  test('gauge reading is switched off by default', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(gaugeReadingEnabledProvider), isFalse);
  });

  testWidgets('admin sees no gauge buttons while gauge reading is off',
      (tester) async {
    await tester.pumpWidget(
      deviceApp(
        overrides: deviceOverrides(
          role: RoleId.admin,
          store: MemoryPairedDeviceStore(),
          simulator: SimulatorDeviceAdapter(delay: Duration.zero),
          gaugeReading: false,
        ),
        home: Scaffold(
          body: GaugeReadButtons(onReadPressure: () {}, onReadTread: () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(GaugeReadKeys.readPressure), findsNothing);
    expect(find.byKey(GaugeReadKeys.readTread), findsNothing);
  });
}
