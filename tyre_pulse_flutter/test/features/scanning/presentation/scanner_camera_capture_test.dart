import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:tyre_pulse/features/scanning/presentation/scanner_screen.dart';

void main() {
  test('firstScannedCode skips empty barcode payloads', () {
    const BarcodeCapture capture = BarcodeCapture(
      barcodes: <Barcode>[
        Barcode(rawValue: '   '),
        Barcode(rawValue: ' TM-514 '),
        Barcode(rawValue: 'ignored'),
      ],
    );

    expect(firstScannedCode(capture), 'TM-514');
  });

  test('firstScannedCode returns null when no payload is usable', () {
    const BarcodeCapture capture = BarcodeCapture(
      barcodes: <Barcode>[Barcode(), Barcode(rawValue: '')],
    );

    expect(firstScannedCode(capture), isNull);
  });
}
