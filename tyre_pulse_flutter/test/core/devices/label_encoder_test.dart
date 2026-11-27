import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';
import 'package:tyre_pulse/core/devices/label_pdf.dart';

const LabelData _label =
    LabelData(code: 'TM-514', name: 'Sany transit mixer', caption: 'NHC');

void main() {
  group('ZPL', () {
    test('50x25 at 203 dpi, QR carries the bare code', () {
      final String z = ascii.decode(encodeZpl(_label));
      expect(z, startsWith('^XA'));
      expect(z, endsWith('^XZ'));
      expect(z, contains('^PW400'));
      expect(z, contains('^LL200'));
      expect(z, contains('^BQN,2,4^FDQA,TM-514^FS'));
      expect(z, contains('Sany transit mixer'));
      expect(z, contains('NHC'));
      expect(z, contains('^PQ1'));
    });

    test('50x30 is 240 dots tall', () {
      expect(
        ascii.decode(encodeZpl(_label, size: LabelSize.mm50x30)),
        contains('^LL240'),
      );
    });

    test('command characters in data cannot inject commands', () {
      final String z = ascii.decode(
        encodeZpl(const LabelData(code: 'A^XZ~B', name: 'x^FS')),
      );
      expect('^XZ'.allMatches(z).length, 1);
      expect(z, isNot(contains('~')));
    });

    test('non-Latin text becomes ? and is flagged for the PDF route', () {
      const LabelData arabic = LabelData(code: 'TM-1', name: 'خلاطة');
      expect(labelNeedsUnicodeFont(arabic), isTrue);
      expect(labelNeedsUnicodeFont(_label), isFalse);
      expect(ascii.decode(encodeZpl(arabic)), contains('?????'));
    });
  });

  group('ESC/POS', () {
    test('initialises, stores and prints a model 2 QR', () {
      final List<int> b = encodeEscPos(_label);
      expect(b.sublist(0, 2), <int>[0x1B, 0x40]);
      // store-data command: GS ( k pL pH 49 80 48 + data
      const int len = 'TM-514'.length + 3;
      final List<int> store = <int>[0x1D, 0x28, 0x6B, len, 0, 0x31, 0x50, 0x30];
      final String hex = b.map((int v) => v.toRadixString(16)).join(',');
      expect(
        hex,
        contains(store.map((int v) => v.toRadixString(16)).join(',')),
      );
      // print-symbol command
      expect(
        hex,
        contains(
          <int>[0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x51, 0x30]
              .map((int v) => v.toRadixString(16))
              .join(','),
        ),
      );
      expect(latin1.decode(b), contains('Sany transit mixer'));
    });

    test('copies repeat the whole label', () {
      final List<int> one = encodeEscPos(_label);
      expect(encodeEscPos(_label, copies: 2).length, one.length * 2);
    });
  });

  group('TSPL', () {
    test('size, QR and print commands', () {
      final String t = ascii.decode(encodeTspl(_label, copies: 3));
      expect(t, startsWith('SIZE 50 mm,25 mm\r\n'));
      expect(t, contains('QRCODE 16,16,M,4,A,0,"TM-514"'));
      expect(t, contains('PRINT 3,1'));
    });

    test('a double quote cannot end the string early', () {
      final String t =
          ascii.decode(encodeTspl(const LabelData(code: 'A"B', name: 'n')));
      expect(t, contains('"A\'B"'));
    });
  });

  test('encodeLabel routes by language', () {
    expect(
      ascii.decode(encodeLabel(_label, PrinterLanguage.zpl)),
      startsWith('^XA'),
    );
    expect(
      ascii.decode(encodeLabel(_label, PrinterLanguage.tspl)),
      startsWith('SIZE'),
    );
  });

  test('the PDF fallback renders a 50x25 page', () async {
    final List<int> pdf = await buildLabelPdf(_label);
    expect(ascii.decode(pdf.sublist(0, 5)), '%PDF-');
  });
}
