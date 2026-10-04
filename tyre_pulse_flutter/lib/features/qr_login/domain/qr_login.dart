/// "Scan to sign in on the web" - the pure vocabulary.
///
/// The web sign-in page asks `qr_login_start` for a one-time code and shows it
/// as a QR whose payload is `tyrepulse://qr-login?id=<uuid>&s=<hex secret>`. A
/// SIGNED-IN phone approves (or denies) it through `qr_login_approve`; the
/// browser then redeems the approval through the `qr-login` edge function.
/// Server side: `supabase/migrations/20261004121000_login_showcase_and_qr_login.sql`.
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
/// p_secret text, p_approve boolean default true)` declares them.
Map<String, Object?> qrLoginApproveParams({
  required String id,
  required String secret,
  required bool approve,
}) {
  return <String, Object?>{
    'p_id': id,
    'p_secret': secret,
    'p_approve': approve,
  };
}

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
    _ => QrLoginFailure.failed,
  };
  return QrLoginRefused(reason);
}
