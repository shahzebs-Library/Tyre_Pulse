/// Turns a raw QR / barcode payload into the code the lookup chain should
/// resolve.
///
/// Ported from `mobile/lib/assetLookup.ts` (`extractScanCode`, `sanitize`),
/// byte-for-byte in behaviour. A printed label in this fleet is scanned or
/// typed in one of three shapes:
///
///   - a bare code           -> `"TRK-001"`
///   - a URL wrapper         -> `"https://app/asset/TRK-001"` or
///                              `"https://app?asset=TRK-001"`
///   - a JSON payload        -> `'{"asset_no":"TRK-001"}'`
///
/// and a value typed by hand may carry stray whitespace or punctuation a
/// printed code never would. This file only unwraps the payload down to a
/// short, clean code; it does no lookup and no network I/O, which is what
/// makes it directly unit-testable and shareable between the camera scanner
/// and manual entry - both must resolve through the exact same code, or a
/// scanned value and a typed value could silently mean different things.
///
/// # Why the case is left alone
///
/// Neither [extractScanCode] nor [sanitizeScanCode] changes letter case.
/// Casing variance (`" trk-001 "` vs the stored `"TRK-001"`) is a LOOKUP
/// concern - the case-insensitive step in the resolution chain handles it -
/// not a payload-shape concern. Mixing the two would make this file decide
/// something a repository owns.
library;

import 'dart:convert';

/// The characters a scanned or typed code must never carry into a PostgREST
/// filter: `,` and `(` break the `.or()` mini-DSL the tyre-serial lookup
/// uses, so they are stripped everywhere a code is cleaned, not only where
/// that filter happens to be built. Ported verbatim from
/// `mobile/lib/assetLookup.ts`'s `sanitize` (also duplicated byte-for-byte as
/// `sanitizeSerial` in `mobile/lib/tyreLookup.ts` - one implementation here
/// serves both call sites).
final RegExp _forbiddenChars = RegExp(r'[(),]');

/// The longest code this application will pass to a query. Printed labels
/// and real serials are far shorter; a long value is either a mis-scan or an
/// attempt to smuggle something odd into a filter, and capping it here means
/// no lookup method downstream has to guard against an unbounded string.
const int _maxScanCodeLength = 64;

/// Trims, strips [_forbiddenChars], and caps [code] at [_maxScanCodeLength].
///
/// Idempotent: sanitizing an already-sanitized value returns it unchanged.
/// That matters because [extractScanCode] and a repository method may both
/// call this on the same value without either needing to know whether the
/// other already has.
String sanitizeScanCode(String code) {
  final String stripped = code.trim().replaceAll(_forbiddenChars, '');
  return stripped.length > _maxScanCodeLength
      ? stripped.substring(0, _maxScanCodeLength)
      : stripped;
}

/// The JSON object keys checked, in priority order, when [raw] decodes to a
/// map. Mirrors `assetLookup.ts`'s `??` chain exactly: an asset field wins
/// over a fleet field, which wins over a serial field, which wins over a
/// bare `code`/`id`.
const List<String> _jsonCodeKeys = <String>[
  'asset_no',
  'assetNo',
  'asset',
  'fleet_number',
  'fleetNumber',
  'serial_number',
  'serial',
  'code',
  'id',
];

/// The URL query parameter names checked, in priority order, when [raw]
/// looks like a URL. Mirrors `assetLookup.ts`'s `??` chain.
const List<String> _urlQueryKeys = <String>[
  'asset',
  'asset_no',
  'code',
  'serial',
];

/// Recognises an explicit `http(s)://` prefix. A payload that instead merely
/// CONTAINS a `?` (no scheme) is also treated as URL-shaped - see
/// [extractScanCode] - because a query-string wrapper such as
/// `"asset?123"` is a shape real labels use without a full URL.
final RegExp _urlSchemePattern = RegExp(r'^https?://', caseSensitive: false);

/// Pulls the most likely asset or tyre code out of a raw scan payload.
///
/// Tries, in order: a JSON object's known keys, a URL's known query
/// parameters or its last path segment, then the raw text itself. Never
/// throws - a payload this cannot parse as JSON or as a URL simply falls
/// through to being treated as a bare code, exactly as the production
/// scanner does.
///
/// Returns `''` for an empty or whitespace-only [raw]. An empty return is a
/// clean "there is nothing here to look up", not a failure this function
/// itself reports; the caller decides what an empty code means.
String extractScanCode(String raw) {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty) {
    return '';
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    final String? fromJson = _codeFromJson(trimmed);
    if (fromJson != null) {
      return fromJson;
    }
  }

  final bool looksLikeUrl =
      _urlSchemePattern.hasMatch(trimmed) || trimmed.contains('?');
  if (looksLikeUrl) {
    final String? fromUrl = _codeFromUrl(trimmed);
    if (fromUrl != null) {
      return fromUrl;
    }
  }

  return sanitizeScanCode(trimmed);
}

/// Reads [_jsonCodeKeys] off a decoded JSON object. Returns null - meaning
/// "fall through to the next shape" - when [trimmed] is not valid JSON, does
/// not decode to an object, or none of the known keys carry a non-blank
/// value.
String? _codeFromJson(String trimmed) {
  final Object? decoded;
  try {
    decoded = jsonDecode(trimmed);
  } on FormatException {
    return null;
  }

  if (decoded is! Map<String, dynamic>) {
    return null;
  }

  for (final String key in _jsonCodeKeys) {
    final Object? value = decoded[key];
    if (value == null) {
      continue;
    }
    final String text = value.toString().trim();
    if (text.isNotEmpty) {
      return sanitizeScanCode(text);
    }
  }
  return null;
}

/// Reads a known query parameter, or the last path segment, off [trimmed]
/// parsed as a URL. A bare payload such as `"asset?123"` is given a scheme
/// and host first (mirroring `assetLookup.ts`'s `` `https://x/${s}` ``
/// fallback) so it still parses as a URL when it plainly looks like one.
///
/// Returns null - fall through to the bare-code path - when [trimmed] does
/// not parse as a URI, or parses but carries neither a known query parameter
/// nor any path segment.
String? _codeFromUrl(String trimmed) {
  final Uri uri;
  try {
    uri = Uri.parse(trimmed.contains('://') ? trimmed : 'https://x/$trimmed');
  } on FormatException {
    return null;
  }

  for (final String key in _urlQueryKeys) {
    final String? value = uri.queryParameters[key];
    if (value != null && value.trim().isNotEmpty) {
      return sanitizeScanCode(value);
    }
  }

  // Uri.pathSegments is already percent-decoded, unlike the raw path text -
  // the Dart equivalent of the reference's explicit decodeURIComponent call.
  final List<String> segments =
      uri.pathSegments.where((String segment) => segment.isNotEmpty).toList();
  if (segments.isNotEmpty) {
    return sanitizeScanCode(segments.last);
  }
  return null;
}
