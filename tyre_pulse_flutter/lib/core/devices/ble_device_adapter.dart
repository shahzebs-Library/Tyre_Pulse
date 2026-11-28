/// The real Bluetooth LE implementation, over `universal_ble` (BSD-3, Android
/// + iOS). The only file in the app that imports the plugin.
///
/// Connections are opened on demand and kept while the app uses them, so a
/// fitter reading twelve wheels does not reconnect twelve times. A dropped
/// link is reconnected once, transparently, before an operation fails.
library;

import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:tyre_pulse/core/devices/device_adapters.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';
import 'package:tyre_pulse/core/devices/known_device_profiles.dart';
import 'package:universal_ble/universal_ble.dart';

const Duration _connectTimeout = Duration(seconds: 15);

RadioState _radioState(AvailabilityState state) => switch (state) {
      AvailabilityState.poweredOn => RadioState.ready,
      AvailabilityState.poweredOff => RadioState.off,
      AvailabilityState.unauthorized => RadioState.unauthorized,
      AvailabilityState.unsupported => RadioState.unsupported,
      AvailabilityState.resetting ||
      AvailabilityState.unknown =>
        RadioState.unknown,
    };

final class BleDeviceRadio implements DeviceRadio {
  const BleDeviceRadio();

  @override
  Future<RadioState> state() async {
    try {
      final bool permitted = await UniversalBle.hasPermissions();
      if (!permitted) return RadioState.unauthorized;
      return _radioState(await UniversalBle.getBluetoothAvailabilityState());
    } on Object {
      return RadioState.unknown;
    }
  }

  @override
  Future<RadioState> requestPermission() async {
    try {
      // Scanning is declared neverForLocation, so no location prompt.
      await UniversalBle.requestPermissions();
    } on Object {
      return RadioState.unauthorized;
    }
    return state();
  }

  @override
  Stream<DiscoveredDevice> scan({
    Duration duration = const Duration(seconds: 12),
  }) {
    late final StreamController<DiscoveredDevice> controller;
    StreamSubscription<BleDevice>? sub;
    Timer? timer;
    final Set<String> seen = <String>{};

    Future<void> finish() async {
      timer?.cancel();
      await sub?.cancel();
      try {
        await UniversalBle.stopScan();
      } on Object {
        // Already stopped.
      }
      if (!controller.isClosed) await controller.close();
    }

    controller = StreamController<DiscoveredDevice>(
      onListen: () async {
        sub = UniversalBle.scanStream.listen((BleDevice d) {
          if (!seen.add(d.deviceId)) return;
          controller.add(
            DiscoveredDevice(
              id: d.deviceId,
              name: d.name,
              rssi: d.rssi,
              transport: DeviceTransport.ble,
              services: d.services,
            ),
          );
        });
        try {
          await UniversalBle.startScan(skipDuplicates: true);
        } on Object catch (error) {
          controller.addError(
            DeviceFailure(DeviceFailureReason.bluetoothOff, '$error'),
          );
          await finish();
          return;
        }
        timer = Timer(duration, () => unawaited(finish()));
      },
      onCancel: finish,
    );
    return controller.stream;
  }

  @override
  Future<void> stopScan() async {
    try {
      await UniversalBle.stopScan();
    } on Object {
      // Not scanning.
    }
  }
}

final class BleGaugeAdapter implements GaugeAdapter, PrinterAdapter {
  BleGaugeAdapter();

  final Set<String> _connected = <String>{};

  Future<void> _ensureConnected(String id) async {
    if (_connected.contains(id)) {
      try {
        final BleConnectionState s = await UniversalBle.getConnectionState(id);
        if (s == BleConnectionState.connected) return;
      } on Object {
        // Fall through to reconnect.
      }
      _connected.remove(id);
    }
    Future<void> attempt() async {
      await UniversalBle.connect(id, timeout: _connectTimeout);
      await UniversalBle.discoverServices(id);
    }

    try {
      await attempt();
    } on Object {
      // One transparent retry: BLE links drop when a gauge sleeps.
      try {
        await attempt();
      } on Object catch (error) {
        throw DeviceFailure(DeviceFailureReason.notConnected, '$error');
      }
    }
    _connected.add(id);
  }

  @override
  Future<GaugeReading> readOnce(
    PairedDevice device,
    GaugeQuantity quantity, {
    Duration timeout = const Duration(seconds: 20),
  }) async {
    final String? service = device.profile.serviceUuid;
    final String? characteristic = device.profile.characteristicUuid;
    final GaugeParseRule? rule = device.profile.parseRule;
    if (service == null || characteristic == null || rule == null) {
      throw const DeviceFailure(DeviceFailureReason.notConfigured);
    }
    await _ensureConnected(device.id);

    final Completer<GaugeReading> done = Completer<GaugeReading>();
    bool sawPayload = false;
    final StreamSubscription<Uint8List> sub =
        UniversalBle.characteristicValueStream(device.id, characteristic)
            .listen((Uint8List bytes) {
      sawPayload = true;
      final GaugeReading? reading = parseGaugePayload(bytes, rule);
      if (reading != null &&
          reading.quantity == quantity &&
          !done.isCompleted) {
        done.complete(reading);
      }
    });
    try {
      try {
        await UniversalBle.subscribeNotifications(
          device.id,
          service,
          characteristic,
        );
      } on Object {
        // Not notifiable: try a plain read below.
        try {
          final Uint8List bytes =
              await UniversalBle.read(device.id, service, characteristic);
          sawPayload = true;
          final GaugeReading? reading = parseGaugePayload(bytes, rule);
          if (reading != null && reading.quantity == quantity) return reading;
        } on Object catch (error) {
          throw DeviceFailure(DeviceFailureReason.notConfigured, '$error');
        }
      }
      return await done.future.timeout(timeout);
    } on TimeoutException {
      throw DeviceFailure(
        sawPayload
            ? DeviceFailureReason.unreadablePayload
            : DeviceFailureReason.noReading,
      );
    } finally {
      await sub.cancel();
      try {
        await UniversalBle.unsubscribe(device.id, service, characteristic);
      } on Object {
        // Link may already be gone.
      }
    }
  }

  @override
  Future<int?> batteryLevel(PairedDevice device) async {
    try {
      await _ensureConnected(device.id);
      final Uint8List bytes = await UniversalBle.read(
        device.id,
        batteryServiceUuid,
        batteryLevelCharacteristicUuid,
      );
      return parseBatteryLevel(bytes);
    } on Object {
      return null;
    }
  }

  @override
  Future<void> send(PairedDevice printer, Uint8List bytes) async {
    final String? service = printer.profile.serviceUuid;
    final String? characteristic = printer.profile.characteristicUuid;
    if (service == null || characteristic == null) {
      throw const DeviceFailure(DeviceFailureReason.notConfigured);
    }
    await _ensureConnected(printer.id);
    int chunk = 20;
    try {
      final int mtu = await UniversalBle.requestMtu(printer.id, 185);
      chunk = math.max(20, math.min(180, mtu - 3));
    } on Object {
      // Default ATT MTU: 20-byte writes.
    }
    try {
      for (int i = 0; i < bytes.length; i += chunk) {
        await UniversalBle.write(
          printer.id,
          service,
          characteristic,
          Uint8List.sublistView(bytes, i, math.min(i + chunk, bytes.length)),
        );
      }
    } on Object catch (error) {
      _connected.remove(printer.id);
      throw DeviceFailure(DeviceFailureReason.printFailed, '$error');
    }
  }

  @override
  Future<void> disconnect(PairedDevice device) async {
    _connected.remove(device.id);
    try {
      await UniversalBle.disconnect(device.id);
    } on Object {
      // Already disconnected.
    }
  }
}
