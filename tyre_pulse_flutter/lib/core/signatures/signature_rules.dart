/// The one signature shape the server accepts for legal signatures (driver
/// charges `driver_charge_valid_signature`, handovers
/// `handover_valid_signature`), and the encoder every phone pad uses so its
/// output passes.
///
/// Server rule (20261126170000_driver_charge_cases.sql): a PNG data URL that
/// starts with the PNG header and is at least 1400 characters (about 1 KB
/// decoded), or the static web SVG with at least 10 points (9 or more `L`).
/// A tap or a dot is not a signature. CHANGE BOTH TOGETHER.
library;

import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:signature/signature.dart';

/// Minimum length of an accepted PNG data URL.
const int minSignaturePngLength = 1400;

/// Minimum number of `L` segments in an accepted SVG (10 points).
const int minSignatureSvgSegments = 9;

final RegExp _png =
    RegExp(r'^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$');
final RegExp _svg = RegExp(
  r'^<svg xmlns="http://www\.w3\.org/2000/svg" width="[0-9]+" height="[0-9]+" '
  r'viewBox="[0-9 .]+">(<path d="[ML0-9 .-]+" fill="none" stroke="#[a-fA-F0-9]{6}" '
  r'stroke-width="[0-9.]+" stroke-linecap="round" stroke-linejoin="round"/>)+</svg>$',
);

/// True when [signature] passes the server rule.
bool isAcceptedSignature(String? signature) {
  final String s = signature ?? '';
  if (_png.hasMatch(s)) return s.length >= minSignaturePngLength;
  if (_svg.hasMatch(s)) {
    return 'L'.allMatches(s).length >= minSignatureSvgSegments;
  }
  return false;
}

/// The size every pad exports at. Exporting the cropped drawing made a short
/// scribble a few hundred bytes, which the server refuses; a fixed canvas
/// keeps the mark in proportion and the file above the minimum.
const int signatureExportWidth = 600;
const int signatureExportHeight = 200;

/// Encodes the pad's strokes as a PNG data URL, or null when empty.
Future<String?> encodeSignaturePng(SignatureController controller) async {
  if (controller.isEmpty) return null;
  final int width =
      math.max(controller.defaultWidth ?? 0, signatureExportWidth);
  final int height =
      math.max(controller.defaultHeight ?? 0, signatureExportHeight);
  final Uint8List? bytes =
      await controller.toPngBytes(width: width, height: height);
  if (bytes == null) return null;
  return 'data:image/png;base64,${base64Encode(bytes)}';
}
