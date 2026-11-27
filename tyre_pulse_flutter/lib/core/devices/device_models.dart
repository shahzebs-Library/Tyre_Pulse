/// The field-hardware vocabulary: what kind of device it is, how the phone
/// talks to it, and how a paired device is remembered.
///
/// Pure Dart. Screens never see a Bluetooth plugin type; they see these.
/// A new brand plugs in by adding a [DeviceProfile] (for a generic BLE gauge,
/// usually just a service, a characteristic and a [GaugeParseRule]) or, for a
/// device with its own protocol, a new adapter behind the interfaces in
/// `device_adapters.dart`.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';

/// What the device does.
enum DeviceKind {
  /// A probe gauge that reports tread depth.
  treadGauge,

  /// A digital chuck that reports tyre pressure.
  pressureGauge,

  /// A combined tool that reports both (one reading at a time).
  combinedGauge,

  /// A barcode/QR handheld or an RFID reader that types like a keyboard.
  scanner,

  /// A UHF RFID reader that needs its vendor SDK (see `rfid_reader.dart`).
  rfidReader,

  /// A thermal label printer.
  labelPrinter;

  bool get readsPressure => this == pressureGauge || this == combinedGauge;
  bool get readsTread => this == treadGauge || this == combinedGauge;
  bool get isGauge => readsPressure || readsTread;
}

/// How the phone reaches the device.
enum DeviceTransport {
  /// Bluetooth Low Energy GATT.
  ble,

  /// The device pairs as a Bluetooth/USB keyboard and types its value. The
  /// phone needs no driver at all; the value lands in the focused field.
  hid,

  /// Raw TCP (port 9100) to a printer on the site network.
  network,

  /// Development and tests only. Never offered in a release build.
  simulator,
}

/// Printer command language.
enum PrinterLanguage {
  /// Zebra ZPL II.
  zpl,

  /// ESC/POS (most generic receipt/label printers).
  escPos,

  /// TSC TSPL (many generic label printers).
  tspl,
}

/// Per-device configuration. Everything a generic adapter needs to talk to
/// one brand, with no code change.
@immutable
final class DeviceProfile {
  const DeviceProfile({
    this.serviceUuid,
    this.characteristicUuid,
    this.parseRule,
    this.printerLanguage,
    this.labelSize = LabelSize.mm50x25,
    this.host,
    this.port = 9100,
  });

  factory DeviceProfile.fromJson(Map<String, dynamic> json) => DeviceProfile(
        serviceUuid: _string(json['service']),
        characteristicUuid: _string(json['characteristic']),
        parseRule: json['parse'] is Map<String, dynamic>
            ? GaugeParseRule.fromJson(json['parse'] as Map<String, dynamic>)
            : null,
        printerLanguage: _enumByName(
          PrinterLanguage.values,
          json['printer_language'],
        ),
        labelSize: _enumByName(LabelSize.values, json['label_size']) ??
            LabelSize.mm50x25,
        host: _string(json['host']),
        port: json['port'] is int ? json['port'] as int : 9100,
      );

  /// GATT service carrying the measurement (BLE gauges and printers).
  final String? serviceUuid;

  /// GATT characteristic to read/subscribe (gauge) or write (printer).
  final String? characteristicUuid;

  /// How to turn the characteristic's bytes into a reading.
  final GaugeParseRule? parseRule;

  final PrinterLanguage? printerLanguage;
  final LabelSize labelSize;

  /// Network printer address.
  final String? host;
  final int port;

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (serviceUuid != null) 'service': serviceUuid,
        if (characteristicUuid != null) 'characteristic': characteristicUuid,
        if (parseRule != null) 'parse': parseRule!.toJson(),
        if (printerLanguage != null) 'printer_language': printerLanguage!.name,
        'label_size': labelSize.name,
        if (host != null) 'host': host,
        'port': port,
      };

  DeviceProfile copyWith({
    String? serviceUuid,
    String? characteristicUuid,
    GaugeParseRule? parseRule,
    PrinterLanguage? printerLanguage,
    LabelSize? labelSize,
    String? host,
    int? port,
  }) =>
      DeviceProfile(
        serviceUuid: serviceUuid ?? this.serviceUuid,
        characteristicUuid: characteristicUuid ?? this.characteristicUuid,
        parseRule: parseRule ?? this.parseRule,
        printerLanguage: printerLanguage ?? this.printerLanguage,
        labelSize: labelSize ?? this.labelSize,
        host: host ?? this.host,
        port: port ?? this.port,
      );
}

/// A device the person has added, remembered on this phone for this user.
@immutable
final class PairedDevice {
  const PairedDevice({
    required this.id,
    required this.name,
    required this.kind,
    required this.transport,
    this.profile = const DeviceProfile(),
    this.addedAt,
  });

  factory PairedDevice.fromJson(Map<String, dynamic> json) {
    final DeviceKind? kind = _enumByName(DeviceKind.values, json['kind']);
    final DeviceTransport? transport =
        _enumByName(DeviceTransport.values, json['transport']);
    final String? id = _string(json['id']);
    if (kind == null || transport == null || id == null) {
      throw const FormatException('Unreadable paired device entry.');
    }
    return PairedDevice(
      id: id,
      name: _string(json['name']) ?? id,
      kind: kind,
      transport: transport,
      profile: json['profile'] is Map<String, dynamic>
          ? DeviceProfile.fromJson(json['profile'] as Map<String, dynamic>)
          : const DeviceProfile(),
      addedAt: DateTime.tryParse(_string(json['added_at']) ?? ''),
    );
  }

  /// BLE device id (MAC on Android, UUID on iOS), `host:port` for a network
  /// printer, or a generated id for a keyboard-mode device.
  final String id;
  final String name;
  final DeviceKind kind;
  final DeviceTransport transport;
  final DeviceProfile profile;
  final DateTime? addedAt;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'name': name,
        'kind': kind.name,
        'transport': transport.name,
        'profile': profile.toJson(),
        if (addedAt != null) 'added_at': addedAt!.toUtc().toIso8601String(),
      };

  PairedDevice copyWith({String? name, DeviceProfile? profile}) => PairedDevice(
        id: id,
        name: name ?? this.name,
        kind: kind,
        transport: transport,
        profile: profile ?? this.profile,
        addedAt: addedAt,
      );

  @override
  bool operator ==(Object other) =>
      other is PairedDevice &&
      other.id == id &&
      other.kind == kind &&
      other.transport == transport;

  @override
  int get hashCode => Object.hash(id, kind, transport);
}

/// A device seen during a scan, not yet added.
@immutable
final class DiscoveredDevice {
  const DiscoveredDevice({
    required this.id,
    required this.transport,
    this.name,
    this.rssi,
    this.services = const <String>[],
  });

  final String id;
  final String? name;
  final int? rssi;
  final DeviceTransport transport;
  final List<String> services;
}

/// Whether the phone can use Bluetooth right now.
enum RadioState {
  ready,
  off,
  unauthorized,
  unsupported,
  unknown,
}

/// A device operation that failed, with the reason the screen must explain.
final class DeviceFailure implements Exception {
  const DeviceFailure(this.reason, [this.detail]);

  final DeviceFailureReason reason;

  /// Diagnostic text for logs. Never shown to a person.
  final String? detail;

  @override
  String toString() =>
      'DeviceFailure($reason${detail == null ? '' : ': $detail'})';
}

enum DeviceFailureReason {
  bluetoothOff,
  permissionDenied,
  unsupported,
  notConnected,
  timeout,
  noReading,
  unreadablePayload,
  notConfigured,
  printFailed,
  needsVendorSdk,
}

String? _string(Object? value) {
  if (value is! String) return null;
  final String trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

T? _enumByName<T extends Enum>(List<T> values, Object? name) {
  if (name is! String) return null;
  for (final T value in values) {
    if (value.name == name) return value;
  }
  return null;
}
