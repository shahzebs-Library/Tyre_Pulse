// Both papers render to a real PDF from the fixture models, signatures and
// all, without a network font.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/documents/charge_document.dart';
import 'package:tyre_pulse/core/documents/document_pdf.dart';
import 'package:tyre_pulse/core/documents/handover_document.dart';

Map<String, Object?> _json(String path) =>
    Map<String, Object?>.from(jsonDecode(File(path).readAsStringSync()) as Map);

const String _png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

void main() {
  final Map<String, Object?> fixture =
      _json('test/fixtures/document_models.json');

  test('driver charge notice renders', () async {
    final Map<String, Object?> detail = Map<String, Object?>.from(
      (fixture['charge']! as Map)['input']! as Map,
    );
    final List<Object?> signatures =
        List<Object?>.from(detail['signatures']! as List);
    signatures[0] = <String, Object?>{
      ...Map<String, Object?>.from(signatures[0]! as Map),
      'signature': _png,
    };
    detail['signatures'] = signatures;
    final Uint8List bytes = await renderChargeNoticePdf(
      buildChargeDocument(
        _json('assets/document_specs/driver-charge-notice.json'),
        detail,
        generatedAt: '2026-01-07T10:00:00Z',
      ),
    );
    expect(String.fromCharCodes(bytes.take(4)), '%PDF');
  });

  test('handover authorization renders', () async {
    final Map<String, Object?> row = Map<String, Object?>.from(
      ((fixture['handover']! as List).first! as Map)['input']! as Map,
    )
      ..['from_signature'] = _png
      ..['to_signature'] = _png;
    final Uint8List bytes = await renderHandoverPdf(
      buildHandoverDocument(
        _json('assets/document_specs/handover-authorization.json'),
        row,
        generatedAt: '2026-01-07T10:00:00Z',
        photoCount: 2,
        damageRows: const <List<String>>[
          <String>['1', 'Left', 'Dent', 'Minor', '', ''],
        ],
      ),
      verifyOrigin: 'https://example.test',
    );
    expect(String.fromCharCodes(bytes.take(4)), '%PDF');
  });
}
