/// What a scanned or typed code means to an inventory count.
///
/// Labels printed for inventory carry a `TP:` prefix
/// (docs/inventory/07: location `label_code` is `TP:LOC:<id>`;
/// docs/inventory/05 section 7 proposes `TP:STK:<stock_id>`). Anything else is
/// a bare code: an item code, a barcode, or a tyre serial. The phone never
/// decides which of those a bare code is; the server resolves it at submit.
///
/// Bluetooth HID (keyboard-wedge) scanners type the code and then a CR or LF,
/// and some add a leading/trailing control character. Those are stripped here,
/// once, so every input path (camera, wedge, manual) normalises identically.
library;

import 'package:flutter/foundation.dart';

enum InventoryScanKind {
  /// A bin/location label (`TP:LOC:<id>`).
  location,

  /// A stock-row label (`TP:STK:<id>`).
  stockRow,

  /// Anything else: item code, barcode or serial, resolved by the server.
  code,
}

@immutable
final class InventoryScan {
  const InventoryScan(this.kind, this.value);

  final InventoryScanKind kind;

  /// The id for [InventoryScanKind.location] / [InventoryScanKind.stockRow],
  /// otherwise the normalised code.
  final String value;

  @override
  bool operator ==(Object other) =>
      other is InventoryScan && other.kind == kind && other.value == value;

  @override
  int get hashCode => Object.hash(kind, value);

  @override
  String toString() => 'InventoryScan(${kind.name}, $value)';
}

final RegExp _controlChars = RegExp(r'[\x00-\x1F\x7F]');

/// Strips control characters and surrounding whitespace a wedge scanner or a
/// QR payload may carry.
String normaliseScannedText(String raw) =>
    raw.replaceAll(_controlChars, '').trim();

/// Parses a scan. Returns null for an empty or prefix-only payload, which the
/// caller ignores (an accidental trigger press is not an error).
InventoryScan? parseInventoryScan(String raw) {
  final String text = normaliseScannedText(raw);
  if (text.isEmpty) return null;
  final String upper = text.toUpperCase();
  if (upper.startsWith('TP:LOC:')) {
    final String id = text.substring(7).trim();
    return id.isEmpty ? null : InventoryScan(InventoryScanKind.location, id);
  }
  if (upper.startsWith('TP:STK:')) {
    final String id = text.substring(7).trim();
    return id.isEmpty ? null : InventoryScan(InventoryScanKind.stockRow, id);
  }
  return InventoryScan(InventoryScanKind.code, text);
}

/// The key two codes are compared by when checking for a duplicate scan:
/// case and inner whitespace are not significant to a serial or item code.
String scanIdentityKey(String code) =>
    normaliseScannedText(code).toUpperCase().replaceAll(RegExp(r'\s+'), '');
