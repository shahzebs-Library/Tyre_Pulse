/// Last-line redaction for everything the Sentry SDK sends from Dart.
///
/// [TelemetryService] already builds its own events from safe fields only.
/// This file is the backstop for what it does NOT build: SDK-generated
/// breadcrumbs (navigation, native, HTTP), exception text from an error that
/// escaped every typed path, and anything a future change forgets to
/// sanitise. It is wired as `beforeSend` and `beforeBreadcrumb`.
///
/// What must never leave the device (spec section 59 + inventory evidence
/// rules): passwords, OTP / verification codes, access and refresh tokens,
/// API keys, e-mail addresses, phone numbers, URL query strings (PostgREST
/// filters carry customer values) and references to inventory or inspection
/// evidence photos. Screenshots, view hierarchy and replay are switched off
/// separately in [TelemetryService.initialize]; this file handles text.
///
/// Native Android crashes are captured and sent by the native SDK and do
/// not pass through these Dart callbacks; they carry stack frames and device
/// facts only, and `sendDefaultPii` stays false so the native side omits
/// user identity too.
library;

import 'package:sentry_flutter/sentry_flutter.dart';

const String _redacted = '[redacted]';

/// A key naming a secret, its optional quotes and the `:` / `=` after it.
/// Group 1 is kept; only the value that follows is replaced.
const String _secretKey =
    r'''(["']?\b(?:password|passwd|pwd|otp|otp_code|verification_code|pin|token|access_token|refresh_token|id_token|secret|api_?key|apikey|authorization|session)\b["']?\s*[:=]\s*)''';

final List<(RegExp, String)> _textRules = <(RegExp, String)>[
  // JSON Web Tokens (Supabase access tokens).
  (
    RegExp(r'eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*'),
    '[redacted-token]',
  ),
  // Bearer / Basic authorization values.
  (
    RegExp(r'\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+', caseSensitive: false),
    r'$1 [redacted]',
  ),
  // Supabase keys.
  (RegExp(r'\bsb_(publishable|secret)_[A-Za-z0-9_-]+'), '[redacted-key]'),
  // "key": "value" / key='value' pairs whose key names a secret. A quoted
  // value is redacted through its closing quote, escaped quotes included, so
  // spaces and punctuation inside the secret never leak.
  (
    RegExp('$_secretKey"(?:[^"\\\\]|\\\\.)*"', caseSensitive: false),
    r'$1"[redacted]"',
  ),
  (
    RegExp("$_secretKey'(?:[^'\\\\]|\\\\.)*'", caseSensitive: false),
    r"$1'[redacted]'",
  ),
  // Unquoted key=value pairs: the value runs to whitespace or a separator;
  // `&` ends it only when another `name=` follows (a query string).
  (
    RegExp('$_secretKey((?:(?!&\\w+=)[^\\s"\',;})])+)', caseSensitive: false),
    r'$1[redacted]',
  ),
  // Query strings: PostgREST filters carry serials, names, asset codes.
  (RegExp(r'(https?://[^\s?#"]+)\?[^\s#"]*'), r'$1?[redacted-query]'),
  // Same for app route names ("/inventory?item=...").
  (RegExp(r'(^|\s)(/[^\s?#"]*)\?[^\s#"]*'), r'$1$2?[redacted-query]'),
  // Private storage references and local evidence photo paths.
  (RegExp(r'tp-storage://\S+'), '[redacted-media]'),
  (
    RegExp(
      r'''[^\s"']*\.(?:jpe?g|png|heic|heif|webp|mp4|pdf)\b''',
      caseSensitive: false,
    ),
    '[redacted-media]',
  ),
  // E-mail addresses.
  (
    RegExp(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'),
    '[redacted-email]',
  ),
  // Phone numbers, national ids and other long digit runs (9+ digits,
  // single spaces allowed). Dates and short codes are left readable.
  (RegExp(r'\+?\d(?: ?\d){8,}'), '[redacted-number]'),
];

/// Breadcrumb data keys whose values are never kept, whatever they hold.
final RegExp _droppedDataKey = RegExp(
  'argument|body|header|query|cookie|password|token|otp|secret|email|phone',
  caseSensitive: false,
);

/// Breadcrumb categories that are dropped outright: console output can hold
/// anything a developer ever printed.
const Set<String> _droppedCategories = <String>{'console', 'print'};

/// Redacts secrets and personal data from free text.
String scrubText(String input) {
  String output = input;
  for (final (RegExp pattern, String replacement) in _textRules) {
    output = output.replaceAllMapped(pattern, (Match match) {
      return replacement.replaceAllMapped(RegExp(r'\$(\d)'), (Match ref) {
        final int group = int.parse(ref.group(1)!);
        return group <= match.groupCount ? (match.group(group) ?? '') : '';
      });
    });
  }
  return output;
}

Object? _scrubValue(Object? value) {
  if (value is String) return scrubText(value);
  if (value is num || value is bool || value == null) return value;
  if (value is Map<Object?, Object?>) {
    final Map<String, Object?> out = <String, Object?>{};
    for (final MapEntry<Object?, Object?> entry in value.entries) {
      final String key = '${entry.key}';
      if (_droppedDataKey.hasMatch(key)) continue;
      out[key] = _scrubValue(entry.value);
    }
    return out;
  }
  if (value is Iterable<Object?>) {
    return value.map(_scrubValue).toList();
  }
  return _redacted;
}

/// `beforeBreadcrumb`: drops console breadcrumbs and scrubs the rest.
Breadcrumb? scrubBreadcrumb(Breadcrumb? breadcrumb, Hint hint) {
  if (breadcrumb == null) return null;
  final String category = (breadcrumb.category ?? '').toLowerCase();
  if (_droppedCategories.contains(category)) return null;
  final String? message = breadcrumb.message;
  if (message != null) breadcrumb.message = scrubText(message);
  final Map<String, dynamic>? data = breadcrumb.data;
  if (data != null) {
    final Object? scrubbed = _scrubValue(data);
    breadcrumb.data = scrubbed is Map<String, Object?>
        ? Map<String, dynamic>.of(scrubbed)
        : null;
  }
  return breadcrumb;
}

/// `beforeSend`: strips identity to an opaque id and scrubs all text.
SentryEvent? scrubEvent(SentryEvent event, Hint hint) {
  // A device name ("Ahmed's phone") is personal data.
  event.serverName = null;
  // The Flutter app never reports an HTTP request of its own; a request
  // block would only ever carry URLs, headers or bodies.
  event.request = null;

  final SentryUser? user = event.user;
  final String? userId = user?.id;
  event.user = userId == null || userId.isEmpty ? null : SentryUser(id: userId);

  final SentryMessage? message = event.message;
  if (message != null) {
    event.message = SentryMessage(scrubText(message.formatted));
  }

  final List<SentryException>? exceptions = event.exceptions;
  if (exceptions != null) {
    for (final SentryException exception in exceptions) {
      final String? value = exception.value;
      if (value != null) exception.value = scrubText(value);
    }
  }

  final Map<String, String>? tags = event.tags;
  if (tags != null) {
    event.tags = <String, String>{
      for (final MapEntry<String, String> entry in tags.entries)
        entry.key: scrubText(entry.value),
    };
  }

  final List<Breadcrumb>? breadcrumbs = event.breadcrumbs;
  if (breadcrumbs != null) {
    event.breadcrumbs = <Breadcrumb>[
      for (final Breadcrumb crumb in breadcrumbs)
        if (scrubBreadcrumb(crumb, hint) case final Breadcrumb kept) kept,
    ];
  }
  return event;
}
