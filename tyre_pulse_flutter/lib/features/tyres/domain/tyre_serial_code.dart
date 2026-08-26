/// Turns whatever a person typed, pasted or scanned into the code actually
/// stored on `tyre_records.serial_no`.
///
/// Ported from `mobile/lib/tyreLookup.ts` (`sanitizeSerial`) and the payload
/// half of `mobile/lib/assetLookup.ts` (`extractScanCode`), which the
/// production serial-search screen deliberately reuses rather than owning a
/// second copy: "A field user types or pastes a tyre serial (bare, or
/// wrapped in a scanned URL/QR/JSON payload)". Kept here, local to this
/// feature, rather than imported from a scanning package: no shared
/// scan-payload utility exists yet in this Flutter port to depend on.
library;

import 'dart:convert';

/// The characters `.or()` filters cannot carry inside a value - they are the
/// PostgREST filter grammar's own syntax, so a serial containing one would
/// otherwise be read as two filter clauses. Ported verbatim from
/// `sanitizeSerial`.
final RegExp _unsafeFilterChars = RegExp('[(),]');

/// The longest serial this app will attempt to look up. Matches the
/// production limit, which exists to keep a pasted essay from becoming a
/// pointless query rather than to reject any real serial.
const int maxSerialLength = 64;

/// Strips `.or()`-breaking characters and caps length at [maxSerialLength].
///
/// Idempotent: sanitising an already-sanitised code is a no-op, so callers
/// that sanitise defensively on top of an already-clean value never change
/// it further.
String sanitizeSerial(String code) {
  final String stripped = code.trim().replaceAll(_unsafeFilterChars, '');
  return stripped.length > maxSerialLength
      ? stripped.substring(0, maxSerialLength)
      : stripped;
}

/// JSON object keys a scanned payload might use to carry the code. Covers
/// both the current tyre column name and the aliases production QR payloads
/// have been seen to use for the same value.
const List<String> _jsonCodeKeys = <String>[
  'serial_no',
  'serialNo',
  'serial_number',
  'serialNumber',
  'serial',
  'asset_no',
  'assetNo',
  'asset',
  'fleet_number',
  'fleetNumber',
  'code',
  'id',
];

/// Query parameter names a scanned URL payload might carry the code under.
const List<String> _queryCodeKeys = <String>[
  'serial',
  'tyreSerial',
  'asset',
  'asset_no',
  'code',
];

/// Pulls the most likely serial or code out of a raw scan payload.
///
/// Handles a JSON object (preferring the keys in [_jsonCodeKeys], in order)
/// and a URL wrapper (a recognised query parameter, else the last non-empty
/// path segment), falling back to the trimmed raw text when neither shape
/// matches. Never throws: a payload this cannot parse is returned sanitised,
/// as-is, rather than rejected - a serial that merely looks unusual is still
/// worth searching for.
String extractScanCode(String raw) {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty) return '';

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    final String? fromJson = _fromJsonPayload(trimmed);
    if (fromJson != null && fromJson.isNotEmpty) {
      return sanitizeSerial(fromJson);
    }
  }

  final bool looksLikeUrl =
      RegExp(r'^https?://', caseSensitive: false).hasMatch(trimmed) ||
      trimmed.contains('?');
  if (looksLikeUrl) {
    final String? fromUrl = _fromUrlPayload(trimmed);
    if (fromUrl != null && fromUrl.isNotEmpty) {
      return sanitizeSerial(fromUrl);
    }
  }

  return sanitizeSerial(trimmed);
}

String? _fromJsonPayload(String source) {
  final Object? decoded;
  try {
    decoded = jsonDecode(source);
  } on FormatException {
    return null;
  }
  if (decoded is! Map) return null;

  for (final String key in _jsonCodeKeys) {
    final Object? value = decoded[key];
    if (value == null) continue;
    final String text = value.toString().trim();
    if (text.isNotEmpty) return text;
  }
  return null;
}

String? _fromUrlPayload(String source) {
  final String withScheme = source.contains('://')
      ? source
      : 'https://x/$source';
  final Uri? uri = Uri.tryParse(withScheme);
  if (uri == null) return null;

  for (final String key in _queryCodeKeys) {
    final String? value = uri.queryParameters[key];
    if (value != null && value.trim().isNotEmpty) {
      return value.trim();
    }
  }

  final List<String> segments = uri.pathSegments
      .where((String segment) => segment.isNotEmpty)
      .toList();
  if (segments.isEmpty) return null;

  final String lastSegment = segments.last;
  // `Uri.pathSegments` already percent-decodes each segment, so decoding
  // again is normally a no-op - but a segment that legitimately contains a
  // bare `%` (not part of valid percent-encoding) would make a second
  // decode throw a FormatException. Falling back to the segment as given
  // keeps this function's "never throws" contract regardless of which
  // decoding state the segment is actually in.
  try {
    return Uri.decodeComponent(lastSegment);
  } on FormatException {
    return lastSegment;
  }
}
