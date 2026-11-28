import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';

Uint8List _ascii(String s) => Uint8List.fromList(s.codeUnits);

void main() {
  group('ASCII payloads', () {
    test('psi with unit', () {
      final GaugeReading? r = parseGaugePayload(
        _ascii('110.5 psi\r\n'),
        GaugeParseRule.asciiPressure,
      );
      expect(r?.quantity, GaugeQuantity.pressure);
      expect(r?.rounded, 110.5);
    });

    test('bar converts to psi', () {
      final GaugeReading? r =
          parseGaugePayload(_ascii('8.00bar'), GaugeParseRule.asciiPressure);
      expect(r?.rounded, 116.0);
      expect(r?.sourceUnit, GaugeUnit.bar);
    });

    test('a decimal comma is read', () {
      final GaugeReading? r =
          parseGaugePayload(_ascii('12,4 mm'), GaugeParseRule.asciiTread);
      expect(r?.quantity, GaugeQuantity.tread);
      expect(r?.rounded, 12.4);
    });

    test('32nds convert to mm', () {
      final GaugeReading? r =
          parseGaugePayload(_ascii('16/32'), GaugeParseRule.asciiTread);
      expect(r?.rounded, 12.7);
    });

    test('no unit falls back to the rule unit', () {
      expect(
        parseGaugePayload(_ascii('9.5'), GaugeParseRule.asciiTread)?.quantity,
        GaugeQuantity.tread,
      );
    });

    test('the text unit wins over the rule (a mm reading is never psi)', () {
      final GaugeReading? r =
          parseGaugePayload(_ascii('9.5mm'), GaugeParseRule.asciiPressure);
      expect(r?.quantity, GaugeQuantity.tread);
    });

    test('garbage and empty are refused', () {
      expect(
        parseGaugePayload(_ascii(''), GaugeParseRule.asciiPressure),
        isNull,
      );
      expect(
        parseGaugePayload(_ascii('ERR'), GaugeParseRule.asciiPressure),
        isNull,
      );
    });
  });

  group('binary payloads', () {
    test('uint16 little-endian tenths after a flags byte', () {
      const GaugeParseRule rule = GaugeParseRule(
        format: GaugePayloadFormat.uint16le,
        unit: GaugeUnit.psi,
        divisor: 10,
        byteOffset: 1,
      );
      // 1105 = 0x0451 -> 110.5 psi
      final GaugeReading? r =
          parseGaugePayload(Uint8List.fromList(<int>[0x01, 0x51, 0x04]), rule);
      expect(r?.rounded, 110.5);
    });

    test('uint16 big-endian hundredths of mm', () {
      const GaugeParseRule rule = GaugeParseRule(
        format: GaugePayloadFormat.uint16be,
        unit: GaugeUnit.mm,
        divisor: 100,
      );
      final GaugeReading? r =
          parseGaugePayload(Uint8List.fromList(<int>[0x04, 0xD8]), rule);
      expect(r?.rounded, 12.4);
    });

    test('float32 kPa', () {
      final ByteData b = ByteData(4)..setFloat32(0, 760, Endian.little);
      const GaugeParseRule rule = GaugeParseRule(
        format: GaugePayloadFormat.float32le,
        unit: GaugeUnit.kpa,
      );
      expect(
        parseGaugePayload(b.buffer.asUint8List(), rule)?.rounded,
        110.2,
      );
    });

    test('a payload too short is refused, not padded', () {
      const GaugeParseRule rule = GaugeParseRule(
        format: GaugePayloadFormat.uint16le,
        unit: GaugeUnit.psi,
      );
      expect(parseGaugePayload(Uint8List.fromList(<int>[0x01]), rule), isNull);
    });
  });

  group('plausibility', () {
    test('out-of-range values are refused, never clamped', () {
      expect(normaliseGaugeValue(400, GaugeUnit.psi), isNull);
      expect(normaliseGaugeValue(55, GaugeUnit.mm), isNull);
      expect(normaliseGaugeValue(-1, GaugeUnit.psi), isNull);
      expect(normaliseGaugeValue(double.nan, GaugeUnit.psi), isNull);
    });
  });

  test('battery level', () {
    expect(parseBatteryLevel(Uint8List.fromList(<int>[87])), 87);
    expect(parseBatteryLevel(Uint8List.fromList(<int>[200])), isNull);
    expect(parseBatteryLevel(Uint8List(0)), isNull);
  });

  test('a rule survives a JSON round trip', () {
    const GaugeParseRule rule = GaugeParseRule(
      format: GaugePayloadFormat.int16le,
      unit: GaugeUnit.bar,
      divisor: 100,
      byteOffset: 2,
    );
    final GaugeParseRule back = GaugeParseRule.fromJson(rule.toJson());
    expect(back.format, rule.format);
    expect(back.unit, rule.unit);
    expect(back.divisor, 100);
    expect(back.byteOffset, 2);
  });
}
