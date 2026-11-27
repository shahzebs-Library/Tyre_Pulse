// The Flutter app bundles copies of docs/document-specs/*.json. They must be
// byte identical to the originals the web renders from, or the two PDFs drift.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final String name in <String>[
    'driver-charge-notice.json',
    'handover-authorization.json',
  ]) {
    test('$name asset copy is identical to docs/document-specs', () {
      final List<int> original =
          File('../docs/document-specs/$name').readAsBytesSync();
      final List<int> copy =
          File('assets/document_specs/$name').readAsBytesSync();
      expect(copy, original);
    });
  }
}
