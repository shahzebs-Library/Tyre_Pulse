// Charge PDF sharing: photos load together under one time limit, and a paper
// with Arabic or Urdu text is refused when its font cannot be loaded.
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:tyre_pulse/core/documents/document_share.dart';

Map<String, Object?> _detail({String? signedLanguage, String? statement}) =>
    <String, Object?>{
      'charge': <String, Object?>{
        'id': 'c1',
        'charge_no': 'DC-2026-00001',
        'category': 'missing_item',
        'amount': 250,
        'currency': 'SAR',
        'status': 'accepted',
        'country': 'KSA',
      },
      'driver': <String, Object?>{'driver_name': 'Driver A'},
      'evidence': <Object?>[],
      'signatures': <Object?>[
        if (signedLanguage != null)
          <String, Object?>{
            'kind': 'driver_acceptance',
            'signer_name': 'Driver A',
            'statement_text': statement,
            'statement_version': 'deduction-consent-v3',
            'statement_language': signedLanguage,
            'signed_at': '2026-11-26T09:00:00Z',
          },
      ],
      'decisions': <Object?>[],
      'instalments': <Object?>[],
      'events': <Object?>[],
      'settings': <String, Object?>{},
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('photos load at the same time and a slow one does not hold the rest',
      () async {
    final DateTime start = DateTime.now();
    final Map<String, Uint8List> photos = await loadChargePhotos(
      <String>['a', 'b', 'slow'],
      (String ref) async {
        if (ref == 'slow') {
          await Future<void>.delayed(const Duration(seconds: 5));
        } else {
          await Future<void>.delayed(const Duration(milliseconds: 200));
        }
        return Uint8List.fromList(<int>[1, 2, 3]);
      },
      overall: const Duration(milliseconds: 600),
    );
    expect(photos.keys.toSet(), <String>{'a', 'b'});
    expect(DateTime.now().difference(start).inMilliseconds, lessThan(2000));
  });

  test('an Arabic signed statement without the Arabic font is refused',
      () async {
    await expectLater(
      buildChargeNoticePdf(
        _detail(signedLanguage: 'ar', statement: 'أوافق على هذه المطالبة'),
        fontLoader: () async => const <pw.Font>[],
      ),
      throwsA(isA<ChargePdfFontUnavailable>()),
    );
  });

  test('an English paper is still made without the Arabic font', () async {
    final Uint8List bytes = await buildChargeNoticePdf(
      _detail(signedLanguage: 'en', statement: 'I agree to this charge.'),
      fontLoader: () async => const <pw.Font>[],
    );
    expect(bytes.length, greaterThan(1000));
  });
}
