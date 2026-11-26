/// Shared helpers for building printable documents from the JSON specs in
/// `docs/document-specs/` (bundled as `assets/document_specs/`).
///
/// The web renderers (`src/lib/driverChargePdf.js`,
/// `src/lib/vehicleHandoverPdf.js`) read the same spec files. These helpers
/// reproduce the JavaScript value rules the web relies on (`String(x)`,
/// truthiness, `Number(x)`, `toFixed`) so the Dart document model prints the
/// exact same text. `test/core/documents/*` compares both against a fixture
/// dumped from the web builders by `scripts/dump-document-models.mjs`.
library;

import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;

/// Asset paths of the bundled spec copies. A test asserts they are byte
/// identical to `docs/document-specs/`, so they cannot drift.
abstract final class DocumentSpecAssets {
  static const String driverChargeNotice =
      'assets/document_specs/driver-charge-notice.json';
  static const String handoverAuthorization =
      'assets/document_specs/handover-authorization.json';
}

/// Loads and decodes one bundled spec.
Future<Map<String, Object?>> loadDocumentSpec(String asset) async {
  final String raw = await rootBundle.loadString(asset);
  return Map<String, Object?>.from(jsonDecode(raw) as Map);
}

/// `a.b.c` lookup through nested maps; null when any step is missing.
Object? specPath(Object? source, String? path) {
  if (path == null || path.isEmpty) return null;
  Object? cursor = source;
  for (final String key in path.split('.')) {
    if (cursor is Map) {
      cursor = cursor[key];
    } else {
      return null;
    }
  }
  return cursor;
}

/// JavaScript `String(x)` for the JSON value types the RPCs return.
String jsString(Object? value) {
  if (value == null) return 'null';
  if (value is double) {
    if (value.isFinite && value == value.truncateToDouble()) {
      return value.toInt().toString();
    }
    return value.toString();
  }
  if (value is Map) return '[object Object]';
  if (value is List) return value.map(jsString).join(',');
  return value.toString();
}

/// JavaScript truthiness for JSON values.
bool jsTruthy(Object? value) {
  if (value == null || value == false) return false;
  if (value is String) return value.isNotEmpty;
  if (value is num) return value != 0 && !value.isNaN;
  return true;
}

/// JavaScript `Number(x)` for JSON values; NaN when not numeric.
double jsNumber(Object? value) {
  if (value == null) return 0;
  if (value is num) return value.toDouble();
  if (value is bool) return value ? 1 : 0;
  if (value is String) {
    final String trimmed = value.trim();
    if (trimmed.isEmpty) return 0;
    return double.tryParse(trimmed) ?? double.nan;
  }
  return double.nan;
}

/// Parses a timestamp the way `new Date(value)` does for ISO strings: a bare
/// `YYYY-MM-DD` is UTC midnight, a string without a zone is local time.
DateTime? parseSpecDate(Object? value) {
  if (value is DateTime) return value;
  if (value is! String || value.trim().isEmpty) return null;
  final String s = value.trim();
  if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) {
    return DateTime.tryParse('${s}T00:00:00Z');
  }
  return DateTime.tryParse(s);
}

/// Converts [instant] to the wall clock of [utcOffset], or the device zone
/// when [utcOffset] is null. Returns the shifted time (as a UTC-flagged value
/// holding local wall-clock fields) and the offset used.
(DateTime, Duration) specWallClock(DateTime instant, Duration? utcOffset) {
  if (utcOffset == null) {
    final DateTime local = instant.toLocal();
    return (local, local.timeZoneOffset);
  }
  return (instant.toUtc().add(utcOffset), utcOffset);
}

String twoDigits(int value) => value.toString().padLeft(2, '0');

/// `x.toFixed(digits)` with JavaScript rounding of the decimal string.
String jsToFixed(double value, int digits) => value.toStringAsFixed(digits);

/// `n.toLocaleString('en-US')`: thousands separators, at most three fraction
/// digits.
String enUsNumber(double value) {
  final bool negative = value < 0;
  String fixed = value.abs().toStringAsFixed(3);
  fixed = fixed.contains('.')
      ? fixed.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '')
      : fixed;
  final List<String> parts = fixed.split('.');
  final String whole = parts.first;
  final StringBuffer grouped = StringBuffer();
  for (int i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 == 0) grouped.write(',');
    grouped.write(whole[i]);
  }
  final String body =
      parts.length > 1 ? '${grouped.toString()}.${parts[1]}' : '$grouped';
  return negative && body != '0' ? '-$body' : body;
}
