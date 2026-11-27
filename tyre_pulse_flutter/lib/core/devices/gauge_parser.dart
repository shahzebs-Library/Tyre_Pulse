/// Turns the bytes a gauge sends into a pressure (psi) or tread (mm) reading.
///
/// Gauges disagree about everything: some send ASCII text ("32.5 psi",
/// "2.40bar", "8.6mm"), most send a little-endian integer in tenths, a few a
/// float. A [GaugeParseRule] states the shape for one brand so a new gauge is
/// configuration, not code. Output is always normalised to the units the
/// inspection form stores - psi and millimetres - and an implausible value is
/// REFUSED, never clamped: a reading the gauge did not take must not reach a
/// tyre record.
library;

import 'dart:convert';
import 'package:flutter/foundation.dart';

/// What was measured.
enum GaugeQuantity { pressure, tread }

/// The unit the gauge reports in.
enum GaugeUnit {
  psi(GaugeQuantity.pressure),
  bar(GaugeQuantity.pressure),
  kpa(GaugeQuantity.pressure),
  mm(GaugeQuantity.tread),
  inch32(GaugeQuantity.tread);

  const GaugeUnit(this.quantity);
  final GaugeQuantity quantity;
}

/// How the payload is encoded.
enum GaugePayloadFormat {
  ascii,
  uint8,
  uint16le,
  uint16be,
  int16le,
  uint32le,
  float32le,
}

/// Plausible ranges after normalisation. Outside these the payload is not a
/// tyre reading (a stuck sensor, a battery byte, a different characteristic).
const double maxPlausiblePsi = 250;
const double maxPlausibleTreadMm = 40;

@immutable
final class GaugeParseRule {
  const GaugeParseRule({
    required this.format,
    required this.unit,
    this.divisor = 1,
    this.byteOffset = 0,
  });

  factory GaugeParseRule.fromJson(Map<String, dynamic> json) => GaugeParseRule(
        format: GaugePayloadFormat.values.firstWhere(
          (GaugePayloadFormat f) => f.name == json['format'],
          orElse: () => GaugePayloadFormat.ascii,
        ),
        unit: GaugeUnit.values.firstWhere(
          (GaugeUnit u) => u.name == json['unit'],
          orElse: () => GaugeUnit.psi,
        ),
        divisor: json['divisor'] is num && (json['divisor'] as num) > 0
            ? (json['divisor'] as num).toDouble()
            : 1,
        byteOffset: json['offset'] is int ? json['offset'] as int : 0,
      );

  /// ASCII text, unit read from the text, psi if it names none.
  static const GaugeParseRule asciiPressure =
      GaugeParseRule(format: GaugePayloadFormat.ascii, unit: GaugeUnit.psi);

  /// ASCII text, unit read from the text, mm if it names none.
  static const GaugeParseRule asciiTread =
      GaugeParseRule(format: GaugePayloadFormat.ascii, unit: GaugeUnit.mm);

  final GaugePayloadFormat format;

  /// The unit of the decoded number (ASCII text may override it).
  final GaugeUnit unit;

  /// Raw value / divisor = value in [unit]. Tenths are `10`.
  final double divisor;

  /// Where the number starts in the payload (a flags byte often comes first).
  final int byteOffset;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'format': format.name,
        'unit': unit.name,
        'divisor': divisor,
        'offset': byteOffset,
      };
}

@immutable
final class GaugeReading {
  const GaugeReading({
    required this.quantity,
    required this.value,
    required this.sourceUnit,
  });

  final GaugeQuantity quantity;

  /// psi for pressure, millimetres for tread.
  final double value;

  /// What the gauge actually sent, for the confirmation line.
  final GaugeUnit sourceUnit;

  /// Rounded the way the form shows it (one decimal).
  double get rounded => (value * 10).roundToDouble() / 10;

  @override
  bool operator ==(Object other) =>
      other is GaugeReading &&
      other.quantity == quantity &&
      other.rounded == rounded;

  @override
  int get hashCode => Object.hash(quantity, rounded);

  @override
  String toString() => 'GaugeReading($quantity, $rounded)';
}

final RegExp _numberWithUnit = RegExp(
  r'(-?\d+(?:[.,]\d+)?)\s*(psi|bar|kpa|mm|/32|32nds?)?',
  caseSensitive: false,
);

/// Parses [payload] with [rule]. Returns null when the bytes do not hold a
/// plausible reading. Never throws.
GaugeReading? parseGaugePayload(Uint8List payload, GaugeParseRule rule) {
  try {
    if (rule.format == GaugePayloadFormat.ascii) {
      return _parseAscii(payload, rule);
    }
    final double? raw = _decodeNumber(payload, rule);
    if (raw == null) return null;
    return normaliseGaugeValue(raw / rule.divisor, rule.unit);
  } on Object {
    return null;
  }
}

GaugeReading? _parseAscii(Uint8List payload, GaugeParseRule rule) {
  final String text = latin1.decode(payload, allowInvalid: true).trim();
  if (text.isEmpty) return null;
  final RegExpMatch? match = _numberWithUnit.firstMatch(text);
  if (match == null) return null;
  final double? number = double.tryParse(match.group(1)!.replaceAll(',', '.'));
  if (number == null) return null;
  final GaugeUnit unit = switch (match.group(2)?.toLowerCase()) {
    'psi' => GaugeUnit.psi,
    'bar' => GaugeUnit.bar,
    'kpa' => GaugeUnit.kpa,
    'mm' => GaugeUnit.mm,
    '/32' || '32nd' || '32nds' => GaugeUnit.inch32,
    _ => rule.unit,
  };
  return normaliseGaugeValue(number, unit);
}

double? _decodeNumber(Uint8List payload, GaugeParseRule rule) {
  final int width = switch (rule.format) {
    GaugePayloadFormat.uint8 => 1,
    GaugePayloadFormat.uint16le ||
    GaugePayloadFormat.uint16be ||
    GaugePayloadFormat.int16le =>
      2,
    GaugePayloadFormat.uint32le || GaugePayloadFormat.float32le => 4,
    GaugePayloadFormat.ascii => 0,
  };
  if (rule.byteOffset < 0 || payload.length < rule.byteOffset + width) {
    return null;
  }
  final ByteData data = ByteData.sublistView(payload);
  final int o = rule.byteOffset;
  return switch (rule.format) {
    GaugePayloadFormat.uint8 => data.getUint8(o).toDouble(),
    GaugePayloadFormat.uint16le => data.getUint16(o, Endian.little).toDouble(),
    GaugePayloadFormat.uint16be => data.getUint16(o).toDouble(),
    GaugePayloadFormat.int16le => data.getInt16(o, Endian.little).toDouble(),
    GaugePayloadFormat.uint32le => data.getUint32(o, Endian.little).toDouble(),
    GaugePayloadFormat.float32le => data.getFloat32(o, Endian.little),
    GaugePayloadFormat.ascii => null,
  };
}

/// Converts [value] in [unit] to psi or mm, refusing anything implausible.
GaugeReading? normaliseGaugeValue(double value, GaugeUnit unit) {
  if (value.isNaN || value.isInfinite || value < 0) return null;
  final double normalised = switch (unit) {
    GaugeUnit.psi => value,
    GaugeUnit.bar => value * 14.5037738,
    GaugeUnit.kpa => value * 0.145037738,
    GaugeUnit.mm => value,
    GaugeUnit.inch32 => value * 25.4 / 32,
  };
  final double max = unit.quantity == GaugeQuantity.pressure
      ? maxPlausiblePsi
      : maxPlausibleTreadMm;
  if (normalised > max) return null;
  return GaugeReading(
    quantity: unit.quantity,
    value: normalised,
    sourceUnit: unit,
  );
}

/// Battery Service level (0x2A19): one unsigned byte, 0-100. Null otherwise.
int? parseBatteryLevel(Uint8List payload) {
  if (payload.isEmpty) return null;
  final int level = payload.first;
  return level > 100 ? null : level;
}
