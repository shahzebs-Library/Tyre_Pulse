/// The seams every device brand plugs into. Screens and controllers depend on
/// these interfaces only; `ble_device_adapter.dart`, `network_printer.dart`
/// and `simulator_device_adapter.dart` implement them.
///
/// Adding a brand:
/// - a BLE gauge that exposes its value on one characteristic: no code, add a
///   [DeviceProfile] (service, characteristic, parse rule) - see
///   `known_device_profiles.dart`;
/// - a gauge or reader with its own protocol or SDK: implement
///   [GaugeAdapter] / [RfidReaderAdapter] and register it in
///   `device_providers.dart` for that profile.
library;

import 'dart:typed_data';

import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';

/// Finds and manages radios: availability, permission, scanning.
abstract interface class DeviceRadio {
  Future<RadioState> state();

  /// Asks the OS for Bluetooth permission. Returns the resulting state.
  Future<RadioState> requestPermission();

  /// Scans for [duration]; each new device is emitted once.
  Stream<DiscoveredDevice> scan({Duration duration});

  Future<void> stopScan();
}

/// Reads one value from a gauge.
abstract interface class GaugeAdapter {
  /// Connects if needed, waits for one plausible reading of [quantity], then
  /// returns it. Throws [DeviceFailure] with a reason the screen can explain.
  Future<GaugeReading> readOnce(
    PairedDevice device,
    GaugeQuantity quantity, {
    Duration timeout,
  });

  /// Battery Service level 0-100, or null when the device does not report it.
  Future<int?> batteryLevel(PairedDevice device);

  Future<void> disconnect(PairedDevice device);
}

/// Sends raw print bytes to a printer.
abstract interface class PrinterAdapter {
  Future<void> send(PairedDevice printer, Uint8List bytes);
}

/// A UHF RFID reader that streams tag reads (EPC hex).
///
/// No generic implementation exists: UHF readers (Zebra RFD40, Chainway,
/// Translogik) each need their vendor SDK through a platform channel. Until
/// one is integrated, readers are used in keyboard (HID) mode, which already
/// works through the scanner. See `rfid_reader.dart`.
abstract interface class RfidReaderAdapter {
  Stream<String> tagReads(PairedDevice reader);
  Future<void> startInventory(PairedDevice reader);
  Future<void> stopInventory(PairedDevice reader);
}
