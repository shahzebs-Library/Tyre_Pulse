/// Riverpod wiring for field hardware, and the one service screens call.
///
/// Access: every device surface asks [devicesAccessProvider], which is the
/// shared module resolver for [ModuleKey.devices] - admin-only by default and
/// opened per person from the web Access Manager (`mobile:devices`). A screen
/// never decides device access on its own.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/devices/ble_device_adapter.dart';
import 'package:tyre_pulse/core/devices/device_adapters.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';
import 'package:tyre_pulse/core/devices/network_printer.dart';
import 'package:tyre_pulse/core/devices/paired_device_store.dart';
import 'package:tyre_pulse/core/devices/simulator_device_adapter.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';

/// Whether the signed-in person may use any device feature.
///
/// Fails CLOSED: if the access state cannot be read (signed out, not yet
/// loaded, or a surface built without the composition root) no device button
/// is shown and the screen behaves exactly as it did before devices existed.
final Provider<bool> devicesAccessProvider = Provider<bool>((ref) {
  try {
    return ref.watch(canAccessModuleProvider(ModuleKey.devices));
  } on Object {
    return false;
  }
});

final Provider<PairedDeviceStore> pairedDeviceStoreProvider =
    Provider<PairedDeviceStore>((ref) => PrefsPairedDeviceStore());

final Provider<DeviceRadio> deviceRadioProvider =
    Provider<DeviceRadio>((ref) => const BleDeviceRadio());

final Provider<BleGaugeAdapter> bleAdapterProvider =
    Provider<BleGaugeAdapter>((ref) => BleGaugeAdapter());

final Provider<PrinterAdapter> networkPrinterProvider =
    Provider<PrinterAdapter>((ref) => const NetworkPrinterAdapter());

/// Debug/test only. Null in release so nothing can reach it.
final Provider<SimulatorDeviceAdapter?> simulatorAdapterProvider =
    Provider<SimulatorDeviceAdapter?>(
  (ref) => simulatorDevicesAvailable ? SimulatorDeviceAdapter() : null,
);

/// The device list is per user; null when nobody is signed in.
final Provider<String?> deviceOwnerIdProvider = Provider<String?>(
  (ref) => ref.watch(workspaceContextProvider)?.userId,
);

final class PairedDevicesController extends AsyncNotifier<List<PairedDevice>> {
  @override
  Future<List<PairedDevice>> build() async {
    final String? owner = ref.watch(deviceOwnerIdProvider);
    if (owner == null) return const <PairedDevice>[];
    return ref.read(pairedDeviceStoreProvider).load(owner);
  }

  Future<void> _write(List<PairedDevice> next) async {
    final String? owner = ref.read(deviceOwnerIdProvider);
    if (owner == null) return;
    await ref.read(pairedDeviceStoreProvider).save(owner, next);
    state =
        AsyncData<List<PairedDevice>>(List<PairedDevice>.unmodifiable(next));
  }

  /// Adds [device], replacing an earlier entry with the same id and kind.
  Future<void> add(PairedDevice device) async {
    final List<PairedDevice> current =
        List<PairedDevice>.of(state.asData?.value ?? const <PairedDevice>[]);
    current
      ..removeWhere((PairedDevice d) => d == device)
      ..add(device);
    await _write(current);
  }

  Future<void> forget(PairedDevice device) async {
    final List<PairedDevice> current =
        List<PairedDevice>.of(state.asData?.value ?? const <PairedDevice>[])
          ..removeWhere((PairedDevice d) => d == device);
    if (device.transport == DeviceTransport.ble) {
      unawaited(ref.read(bleAdapterProvider).disconnect(device));
    }
    await _write(current);
  }
}

final AsyncNotifierProvider<PairedDevicesController, List<PairedDevice>>
    pairedDevicesProvider =
    AsyncNotifierProvider<PairedDevicesController, List<PairedDevice>>(
  PairedDevicesController.new,
);

/// Gauges that can measure [GaugeQuantity].
List<PairedDevice> gaugesFor(List<PairedDevice> all, GaugeQuantity quantity) =>
    all
        .where(
          (PairedDevice d) => quantity == GaugeQuantity.pressure
              ? d.kind.readsPressure
              : d.kind.readsTread,
        )
        .toList(growable: false);

List<PairedDevice> printersIn(List<PairedDevice> all) => all
    .where((PairedDevice d) => d.kind == DeviceKind.labelPrinter)
    .toList(growable: false);

/// Routes each operation to the adapter for the device's transport.
final class DeviceService {
  DeviceService(this._ref);

  final Ref _ref;

  GaugeAdapter _gauge(PairedDevice device) => switch (device.transport) {
        DeviceTransport.ble => _ref.read(bleAdapterProvider),
        DeviceTransport.simulator => _simulator(),
        // A keyboard-mode gauge types into the focused field; the screen
        // captures it (see `gauge_read_flow.dart`), there is nothing to poll.
        DeviceTransport.hid ||
        DeviceTransport.network =>
          throw const DeviceFailure(DeviceFailureReason.unsupported),
      };

  SimulatorDeviceAdapter _simulator() {
    final SimulatorDeviceAdapter? sim = _ref.read(simulatorAdapterProvider);
    if (sim == null) {
      throw const DeviceFailure(DeviceFailureReason.unsupported);
    }
    return sim;
  }

  Future<GaugeReading> readGauge(PairedDevice device, GaugeQuantity quantity) =>
      _gauge(device).readOnce(device, quantity);

  Future<int?> batteryLevel(PairedDevice device) async {
    if (device.transport != DeviceTransport.ble &&
        device.transport != DeviceTransport.simulator) {
      return null;
    }
    return _gauge(device).batteryLevel(device);
  }

  /// Prints [label] on [printer] in its configured language and size.
  Future<void> printLabel(
    PairedDevice printer,
    LabelData label, {
    int copies = 1,
  }) async {
    final PrinterLanguage language =
        printer.profile.printerLanguage ?? PrinterLanguage.zpl;
    final PrinterAdapter adapter = switch (printer.transport) {
      DeviceTransport.ble => _ref.read(bleAdapterProvider),
      DeviceTransport.network => _ref.read(networkPrinterProvider),
      DeviceTransport.simulator => _simulator(),
      DeviceTransport.hid =>
        throw const DeviceFailure(DeviceFailureReason.unsupported),
    };
    await adapter.send(
      printer,
      encodeLabel(
        label,
        language,
        size: printer.profile.labelSize,
        copies: copies,
      ),
    );
  }
}

final Provider<DeviceService> deviceServiceProvider =
    Provider<DeviceService>(DeviceService.new);
