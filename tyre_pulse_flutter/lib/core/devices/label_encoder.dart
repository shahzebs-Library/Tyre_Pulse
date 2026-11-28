/// Builds the bytes a thermal label printer prints: a QR code carrying the
/// bare code (exactly what the scanner resolves - see `scan_payload.dart`),
/// the code in large type, and the item name.
///
/// Three command languages cover nearly every field printer: Zebra ZPL,
/// ESC/POS and TSC TSPL. Sizes are 50x25 mm and 50x30 mm at 203 dpi
/// (8 dots per mm), the common stock for tyre and bin labels. Pure Dart.
///
/// Printer fonts are Latin only. A name in Arabic or Urdu would print as
/// boxes, so non-ASCII characters are replaced with `?` on the thermal
/// paths and the caller offers the PDF route (which embeds a font) instead.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';

enum LabelSize {
  mm50x25(50, 25),
  mm50x30(50, 30);

  const LabelSize(this.widthMm, this.heightMm);
  final int widthMm;
  final int heightMm;

  /// 203 dpi printers address 8 dots per millimetre.
  int get widthDots => widthMm * 8;
  int get heightDots => heightMm * 8;
}

@immutable
final class LabelData {
  const LabelData({required this.code, required this.name, this.caption});

  /// The scannable code (asset number, tyre serial, stock item id).
  final String code;

  /// What it is (asset description, item name).
  final String name;

  /// An optional third line (site, size).
  final String? caption;
}

/// True when [text] has characters printer fonts cannot draw.
bool labelNeedsUnicodeFont(LabelData label) =>
    !_isAscii(label.code) ||
    !_isAscii(label.name) ||
    !_isAscii(label.caption ?? '');

bool _isAscii(String s) => s.codeUnits.every((int c) => c >= 0x20 && c < 0x7F);

/// Printable ASCII only; control characters dropped, anything else `?`.
String _ascii(String s) {
  final StringBuffer out = StringBuffer();
  for (final int c in s.runes) {
    if (c >= 0x20 && c < 0x7F) {
      out.writeCharCode(c);
    } else if (c >= 0x80) {
      out.write('?');
    }
  }
  return out.toString().trim();
}

String _fit(String s, int max) =>
    s.length <= max ? s : '${s.substring(0, max - 1)}.';

/// Encodes [label] for [language] at [size].
Uint8List encodeLabel(
  LabelData label,
  PrinterLanguage language, {
  LabelSize size = LabelSize.mm50x25,
  int copies = 1,
}) =>
    switch (language) {
      PrinterLanguage.zpl => encodeZpl(label, size: size, copies: copies),
      PrinterLanguage.escPos => encodeEscPos(label, copies: copies),
      PrinterLanguage.tspl => encodeTspl(label, size: size, copies: copies),
    };

/// Zebra ZPL II. `^`, `~` are command prefixes and are stripped from data.
Uint8List encodeZpl(
  LabelData label, {
  LabelSize size = LabelSize.mm50x25,
  int copies = 1,
}) {
  String clean(String s) => _ascii(s).replaceAll(RegExp('[\\^~]'), ' ');
  final String code = clean(label.code);
  final int qrMag = size == LabelSize.mm50x30 ? 5 : 4;
  final int textX = size == LabelSize.mm50x30 ? 176 : 160;
  final int textWidth = size.widthDots - textX - 12;
  final StringBuffer z = StringBuffer()
    ..write('^XA')
    ..write('^PW${size.widthDots}')
    ..write('^LL${size.heightDots}')
    ..write('^LH0,0')
    ..write('^FO16,16^BQN,2,$qrMag^FDQA,$code^FS')
    ..write('^FO$textX,20^A0N,30,30^FB$textWidth,1,0,L^FD${_fit(code, 18)}^FS')
    ..write(
      '^FO$textX,62^A0N,22,22^FB$textWidth,3,0,L'
      '^FD${_fit(clean(label.name), 54)}^FS',
    );
  final String? caption = label.caption;
  if (caption != null && caption.trim().isNotEmpty) {
    z.write(
      '^FO$textX,${size.heightDots - 36}^A0N,20,20^FB$textWidth,1,0,L'
      '^FD${_fit(clean(caption), 22)}^FS',
    );
  }
  z
    ..write('^PQ${copies.clamp(1, 99)}')
    ..write('^XZ');
  return Uint8List.fromList(ascii.encode(z.toString()));
}

/// ESC/POS with the native QR command (`GS ( k`, model 2).
Uint8List encodeEscPos(LabelData label, {int copies = 1}) {
  final List<int> code = ascii.encode(_ascii(label.code));
  final BytesBuilder b = BytesBuilder();
  for (int i = 0; i < copies.clamp(1, 99); i++) {
    b
      ..add(<int>[0x1B, 0x40]) // ESC @ initialise
      ..add(<int>[0x1B, 0x61, 0x01]) // centre
      // Model 2.
      ..add(<int>[0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
      // Module size 6.
      ..add(<int>[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06])
      // Error correction M.
      ..add(<int>[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]);
    final int len = code.length + 3;
    b
      ..add(<int>[0x1D, 0x28, 0x6B, len & 0xFF, (len >> 8) & 0xFF, 0x31, 0x50])
      ..addByte(0x30)
      ..add(code)
      // Print the stored symbol.
      ..add(<int>[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30])
      ..addByte(0x0A)
      ..add(<int>[0x1B, 0x45, 0x01]) // bold on
      ..add(ascii.encode(_fit(_ascii(label.code), 32)))
      ..add(<int>[0x1B, 0x45, 0x00, 0x0A]) // bold off, LF
      ..add(ascii.encode(_fit(_ascii(label.name), 64)))
      ..addByte(0x0A);
    final String? caption = label.caption;
    if (caption != null && caption.trim().isNotEmpty) {
      b
        ..add(ascii.encode(_fit(_ascii(caption), 32)))
        ..addByte(0x0A);
    }
    b.add(<int>[0x1B, 0x64, 0x03]); // feed 3 lines
  }
  return b.toBytes();
}

/// TSC TSPL. Double quotes end a string and are replaced.
Uint8List encodeTspl(
  LabelData label, {
  LabelSize size = LabelSize.mm50x25,
  int copies = 1,
}) {
  String clean(String s) => _ascii(s).replaceAll('"', "'");
  final int cell = size == LabelSize.mm50x30 ? 5 : 4;
  final int textX = size == LabelSize.mm50x30 ? 176 : 160;
  final StringBuffer t = StringBuffer()
    ..write('SIZE ${size.widthMm} mm,${size.heightMm} mm\r\n')
    ..write('GAP 2 mm,0 mm\r\n')
    ..write('DIRECTION 1\r\n')
    ..write('CLS\r\n')
    ..write('QRCODE 16,16,M,$cell,A,0,"${clean(label.code)}"\r\n')
    ..write('TEXT $textX,20,"3",0,1,1,"${_fit(clean(label.code), 14)}"\r\n')
    ..write('TEXT $textX,64,"2",0,1,1,"${_fit(clean(label.name), 18)}"\r\n');
  final String? caption = label.caption;
  if (caption != null && caption.trim().isNotEmpty) {
    t.write(
      'TEXT $textX,${size.heightDots - 36},"1",0,1,1,'
      '"${_fit(clean(caption), 22)}"\r\n',
    );
  }
  t.write('PRINT ${copies.clamp(1, 99)},1\r\n');
  return Uint8List.fromList(ascii.encode(t.toString()));
}
