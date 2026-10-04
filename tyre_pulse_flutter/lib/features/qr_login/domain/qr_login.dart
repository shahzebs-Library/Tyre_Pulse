/// "Scan to sign in on the web" - the pure vocabulary.
///
/// The web sign-in page asks `qr_login_start` for a one-time code and shows it
/// as a QR whose payload is `tyrepulse://qr-login?id=<uuid>&s=<hex secret>`. A
/// SIGNED-IN phone approves (or denies) it through `qr_login_approve`; the
/// browser then redeems the approval through the `qr-login` edge function.
/// Server side: `supabase/migrations/20261004121000_login_showcase_and_qr_login.sql`,
/// hardened by `20261004150000_qr_login_hardening.sql`: the phone first calls
/// `qr_login_peek` to see WHICH browser is asking (user agent, IP, age) plus
/// three 2-digit options, and approving must send the number the computer
/// shows (`p_match`). A wrong number cancels the code; administrator accounts
/// are refused (`reason:'admin'`).
///
/// No I/O here, so the parser and the reply decoding are unit-testable.
library;

import 'package:flutter/foundation.dart';

/// The scheme and host every QR sign-in payload carries.
const String qrLoginScheme = 'tyrepulse';
const String qrLoginHost = 'qr-login';

/// A request id is a Postgres uuid (`gen_random_uuid()`).
final RegExp _uuidPattern = RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
);

/// The server mints 24 random bytes as hex (48 chars). Accepting 32..128 hex
/// characters leaves room for a longer secret later without accepting junk.
final RegExp _secretPattern = RegExp(r'^[0-9a-fA-F]{32,128}$');

/// True when [raw] at least LOOKS like a QR sign-in payload (right scheme and
/// host), whether or not its id and secret are valid. The scanner uses this
/// to route such a code to the sign-in flow instead of treating it as an
/// asset code - a malformed sign-in code must not be searched as a tyre.
bool looksLikeQrLoginPayload(String raw) {
  final Uri? uri = Uri.tryParse(raw.trim());
  if (uri == null) return false;
  return uri.scheme.toLowerCase() == qrLoginScheme &&
      uri.host.toLowerCase() == qrLoginHost;
}

/// Parses a QR sign-in payload into its request id and secret.
///
/// Returns null for anything that is not exactly a `tyrepulse://qr-login`
/// link with a uuid-shaped `id` and a 32..128 character hex `s`. Never
/// throws. The values are returned as written (trimmed); the server compares
/// the secret's sha256, so its case must not be changed here.
({String id, String secret})? parseQrLoginPayload(String raw) {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty || trimmed.length > 512) return null;
  final Uri? uri = Uri.tryParse(trimmed);
  if (uri == null) return null;
  if (uri.scheme.toLowerCase() != qrLoginScheme) return null;
  if (uri.host.toLowerCase() != qrLoginHost) return null;
  final String id = (uri.queryParameters['id'] ?? '').trim();
  final String secret = (uri.queryParameters['s'] ?? '').trim();
  if (!_uuidPattern.hasMatch(id)) return null;
  if (!_secretPattern.hasMatch(secret)) return null;
  return (id: id, secret: secret);
}

/// The RPC parameters, keyed exactly as `qr_login_approve(p_id uuid,
/// p_secret text, p_approve boolean default true, p_match text default null)`
/// declares them. [match] (the number the computer shows) is sent only when
/// approving; a decline needs none.
Map<String, Object?> qrLoginApproveParams({
  required String id,
  required String secret,
  required bool approve,
  String? match,
}) {
  final String trimmedMatch = (match ?? '').trim();
  return <String, Object?>{
    'p_id': id,
    'p_secret': secret,
    'p_approve': approve,
    if (approve && trimmedMatch.isNotEmpty) 'p_match': trimmedMatch,
  };
}

/// The RPC parameters for `qr_login_peek(p_id uuid, p_secret text)`.
Map<String, Object?> qrLoginPeekParams({
  required String id,
  required String secret,
}) {
  return <String, Object?>{'p_id': id, 'p_secret': secret};
}

/// A 2-digit number option, as `qr_login_start` / `qr_login_peek` mint them.
final RegExp _matchOptionPattern = RegExp(r'^[0-9]{2}$');

/// Why a decision did not go through.
enum QrLoginFailure {
  /// The code does not match any request (wrong or tampered secret).
  invalid,

  /// The two minutes ran out before the decision.
  expired,

  /// The browser already used this code to sign in.
  consumed,

  /// Somebody already approved this code.
  alreadyApproved,

  /// Somebody already declined this code.
  alreadyDenied,

  /// The phone user is not approved or is locked (SQLSTATE 42501).
  notAllowed,

  /// No session on the phone.
  signedOut,

  /// No signal.
  needsSignal,

  /// The RPC is not available on this server.
  unavailable,

  /// The number tapped did not match the computer. The server has cancelled
  /// the code, so it cannot be retried with another guess.
  mismatch,

  /// The phone user is an Admin or super admin: QR sign-in is not offered to
  /// administrator accounts.
  admin,

  /// Anything else.
  failed,
}

/// The outcome of one approve-or-decline call.
@immutable
sealed class QrLoginOutcome {
  const QrLoginOutcome();
}

/// The server recorded the decision. [approved] is false for a decline.
final class QrLoginDecided extends QrLoginOutcome {
  const QrLoginDecided({required this.approved});

  final bool approved;
}

final class QrLoginRefused extends QrLoginOutcome {
  const QrLoginRefused(this.reason);

  final QrLoginFailure reason;
}

/// Reads the RPC's `{ok:true,status}` / `{ok:false,reason}` reply.
QrLoginOutcome qrLoginOutcomeFromReply(Object? reply, {required bool approve}) {
  if (reply is! Map) return const QrLoginRefused(QrLoginFailure.failed);
  if (reply['ok'] == true) {
    final Object? status = reply['status'];
    if (status == 'approved') return const QrLoginDecided(approved: true);
    if (status == 'denied') return const QrLoginDecided(approved: false);
    return QrLoginDecided(approved: approve);
  }
  final QrLoginFailure reason = switch (reply['reason']) {
    'invalid' => QrLoginFailure.invalid,
    'expired' => QrLoginFailure.expired,
    'consumed' => QrLoginFailure.consumed,
    'approved' => QrLoginFailure.alreadyApproved,
    'denied' => QrLoginFailure.alreadyDenied,
    'mismatch' => QrLoginFailure.mismatch,
    'admin' => QrLoginFailure.admin,
    _ => QrLoginFailure.failed,
  };
  return QrLoginRefused(reason);
}

/// What the phone is about to approve, read from `qr_login_peek`.
@immutable
final class QrLoginRequestInfo {
  const QrLoginRequestInfo({
    required this.options,
    this.userAgent,
    this.ip,
    this.ageSeconds,
  });

  /// The browser's user agent as the computer reported it, or null.
  final String? userAgent;

  /// The address the request came from, or null when the server saw none.
  final String? ip;

  /// How long ago the computer asked, or null when not reported.
  final int? ageSeconds;

  /// The 2-digit numbers to choose from; exactly one is on the computer.
  final List<String> options;
}

/// The outcome of one peek.
@immutable
sealed class QrLoginPeekResult {
  const QrLoginPeekResult();
}

final class QrLoginPeekReady extends QrLoginPeekResult {
  const QrLoginPeekReady(this.info);

  final QrLoginRequestInfo info;
}

final class QrLoginPeekRefused extends QrLoginPeekResult {
  const QrLoginPeekRefused(this.reason);

  final QrLoginFailure reason;
}

/// Reads the peek RPC's `{ok:true, user_agent, ip, age_seconds, options}` /
/// `{ok:false, reason}` reply. A reply without at least two valid 2-digit
/// options is a failure: the person must never be asked to approve without
/// a number to match.
QrLoginPeekResult qrLoginPeekFromReply(Object? reply) {
  if (reply is! Map) return const QrLoginPeekRefused(QrLoginFailure.failed);
  if (reply['ok'] != true) {
    final QrLoginOutcome outcome =
        qrLoginOutcomeFromReply(reply, approve: true);
    return QrLoginPeekRefused(
      outcome is QrLoginRefused ? outcome.reason : QrLoginFailure.failed,
    );
  }
  final Object? rawOptions = reply['options'];
  final List<String> options = <String>[];
  if (rawOptions is List) {
    for (final Object? option in rawOptions) {
      final String value = (option?.toString() ?? '').trim();
      if (_matchOptionPattern.hasMatch(value) && !options.contains(value)) {
        options.add(value);
      }
    }
  }
  if (options.length < 2) {
    return const QrLoginPeekRefused(QrLoginFailure.failed);
  }
  String? text(Object? v) {
    final String t = (v?.toString() ?? '').trim();
    return t.isEmpty ? null : t;
  }

  final Object? age = reply['age_seconds'];
  final int? ageSeconds = switch (age) {
    final int n => n < 0 ? 0 : n,
    final num n => n < 0 ? 0 : n.round(),
    final String s => int.tryParse(s.trim()),
    _ => null,
  };
  return QrLoginPeekReady(
    QrLoginRequestInfo(
      userAgent: text(reply['user_agent']),
      ip: text(reply['ip']),
      ageSeconds: ageSeconds,
      options: List<String>.unmodifiable(options),
    ),
  );
}

/// The browser and operating system named by a user agent, in the vendors'
/// own product names (proper nouns, not translated). Either is null when the
/// user agent does not say; the sheet then shows "Unknown browser" rather
/// than guessing.
({String? browser, String? os}) describeUserAgent(String? userAgent) {
  final String ua = (userAgent ?? '').trim();
  if (ua.isEmpty) return (browser: null, os: null);
  bool has(String token) => ua.contains(token);

  // Order matters: Edge, Opera and Samsung Internet also say "Chrome", and
  // Chrome also says "Safari".
  final String? browser = has('Edg/') || has('EdgA/') || has('EdgiOS/')
      ? 'Edge'
      : has('OPR/') || has('OPiOS/') || has('Opera')
          ? 'Opera'
          : has('SamsungBrowser/')
              ? 'Samsung Internet'
              : has('Firefox/') || has('FxiOS/')
                  ? 'Firefox'
                  : has('Chrome/') || has('CriOS/') || has('Chromium/')
                      ? 'Chrome'
                      : has('Safari/') && has('Version/')
                          ? 'Safari'
                          : null;

  // Android before Linux (Android says Linux); iPhone/iPad before Mac (iPad
  // can say "like Mac OS X").
  final String? os = has('Windows')
      ? 'Windows'
      : has('Android')
          ? 'Android'
          : has('iPhone') || has('iPad') || has('iPod')
              ? 'iOS'
              : has('CrOS')
                  ? 'ChromeOS'
                  : has('Mac OS X') || has('Macintosh')
                      ? 'macOS'
                      : has('Linux')
                          ? 'Linux'
                          : null;
  return (browser: browser, os: os);
}
