// Proves the Dart document builders print exactly what the web builders
// print. The fixture is dumped from src/lib/driverChargePdf.js and
// src/lib/vehicleHandoverPdf.js by scripts/dump-document-models.mjs.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/documents/charge_document.dart';
import 'package:tyre_pulse/core/documents/handover_document.dart';

Map<String, Object?> _json(String path) =>
    Map<String, Object?>.from(jsonDecode(File(path).readAsStringSync()) as Map);

void main() {
  final Map<String, Object?> fixture =
      _json('test/fixtures/document_models.json');
  final Duration offset =
      Duration(minutes: (fixture['utcOffsetMinutes']! as num).toInt());
  final String generatedAt = fixture['generatedAt']! as String;

  test('driver charge notice model matches the web builder', () {
    final Map<String, Object?> spec =
        _json('assets/document_specs/driver-charge-notice.json');
    final Map<String, Object?> charge =
        Map<String, Object?>.from(fixture['charge']! as Map);
    final ChargeDocumentModel model = buildChargeDocument(
      spec,
      Map<String, Object?>.from(charge['input']! as Map),
      generatedAt: generatedAt,
      utcOffset: offset,
      language: '${charge['language'] ?? 'en'}',
    );
    expect(jsonEncode(model.toJson()), jsonEncode(charge['model']));
  });

  test('a charge with no details is refused', () {
    final Map<String, Object?> spec =
        _json('assets/document_specs/driver-charge-notice.json');
    expect(
      () => buildChargeDocument(spec, <String, Object?>{}, generatedAt: ''),
      throwsFormatException,
    );
  });

  test('handover authorization model matches the web builders', () {
    final Map<String, Object?> spec =
        _json('assets/document_specs/handover-authorization.json');
    for (final Object? raw in fixture['handover']! as List) {
      final Map<String, Object?> c = Map<String, Object?>.from(raw! as Map);
      final HandoverDocumentModel model = buildHandoverDocument(
        spec,
        Map<String, Object?>.from(c['input']! as Map),
        generatedAt: generatedAt,
        damageMarkCount: (c['damageMarkCount']! as num).toInt(),
        photoCount: (c['photoCount']! as num).toInt(),
        utcOffset: offset,
      );
      expect(jsonEncode(model.toParityJson()), jsonEncode(c['model']));
    }
  });
}
