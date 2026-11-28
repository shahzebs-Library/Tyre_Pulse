/// A pretend gauge and printer so the device screens can be built and tested
/// with no hardware. Only reachable in debug builds and tests
/// ([simulatorDevicesAvailable]); a release build never lists it, so it can
/// never put a made-up reading on a real tyre.
library;

import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/devices/device_adapters.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';

/// True in debug builds and widget tests, false in profile/release.
bool get simulatorDevicesAvailable => kDebugMode;

const String simulatorGaugeId = 'simulator-gauge';
const String simulatorPrinterId = 'simulator-printer';

final class SimulatorDeviceAdapter
    implements DeviceRadio, GaugeAdapter, PrinterAdapter {
  SimulatorDeviceAdapter({
    this.pressurePayload = '110.5 psi',
    this.treadPayload = '12.4 mm',
    this.delay = const Duration(milliseconds: 150),
  });

  /// What the pretend gauge sends, run through the real parser.
  String pressurePayload;
  String treadPayload;
  final Duration delay;

  /// Every byte block "printed", for tests.
  final List<Uint8List> printed = <Uint8List>[];

  @override
  Future<RadioState> state() async => RadioState.ready;

  @override
  Future<RadioState> requestPermission() async => RadioState.ready;

  @override
  Stream<DiscoveredDevice> scan({Duration duration = Duration.zero}) =>
      Stream<DiscoveredDevice>.fromIterable(const <DiscoveredDevice>[
        DiscoveredDevice(
          id: simulatorGaugeId,
          name: 'Simulator gauge',
          transport: DeviceTransport.simulator,
        ),
        DiscoveredDevice(
          id: simulatorPrinterId,
          name: 'Simulator printer',
          transport: DeviceTransport.simulator,
        ),
      ]);

  @override
  Future<void> stopScan() async {}

  @override
  Future<GaugeReading> readOnce(
    PairedDevice device,
    GaugeQuantity quantity, {
    Duration timeout = const Duration(seconds: 5),
  }) async {
    await Future<void>.delayed(delay);
    final String payload =
        quantity == GaugeQuantity.pressure ? pressurePayload : treadPayload;
    final GaugeReading? reading = parseGaugePayload(
      Uint8List.fromList(payload.codeUnits),
      quantity == GaugeQuantity.pressure
          ? GaugeParseRule.asciiPressure
          : GaugeParseRule.asciiTread,
    );
    if (reading == null || reading.quantity != quantity) {
      throw const DeviceFailure(DeviceFailureReason.unreadablePayload);
    }
    return reading;
  }

  @override
  Future<int?> batteryLevel(PairedDevice device) async => 87;

  @override
  Future<void> disconnect(PairedDevice device) async {}

  @override
  Future<void> send(PairedDevice printer, Uint8List bytes) async {
    await Future<void>.delayed(delay);
    printed.add(bytes);
  }
}
