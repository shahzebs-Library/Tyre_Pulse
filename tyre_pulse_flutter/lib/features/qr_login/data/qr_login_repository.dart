/// Approves or declines a web sign-in code through `qr_login_approve`.
///
/// VERIFIED against `supabase/migrations/20261004121000_login_showcase_and_qr_login.sql`:
/// `qr_login_approve(p_id uuid, p_secret text, p_approve boolean default true)`
/// is SECURITY DEFINER, granted to `authenticated` only (anon revoked), returns
/// jsonb `{ok:true,status:'approved'|'denied'}` or
/// `{ok:false,reason:'invalid'|'expired'|'consumed'|'approved'|'denied'}`, and
/// raises SQLSTATE 42501 when the phone user is not approved or is locked.
///
/// ONLINE ONLY, deliberately. The code expires after two minutes and the
/// decision depends on the request's CURRENT server state (spec section 14:
/// decisions that depend on server state are never blindly queued). A
/// queued approval replayed later would always arrive expired, or - worse -
/// sign a browser in long after the person stopped looking at it.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/qr_login/domain/qr_login.dart';

abstract interface class QrLoginRepository {
  /// Records [approve] (true = sign the computer in, false = decline) for the
  /// code ([id], [secret]). Never throws: every failure comes back as
  /// [QrLoginRefused].
  Future<QrLoginOutcome> decide({
    required String id,
    required String secret,
    required bool approve,
  });
}

/// How one RPC call is made. Injectable so tests need no live client.
typedef QrLoginRpc = Future<Object?> Function(
  String name,
  Map<String, Object?> params,
);

/// Maps a classified failure to what the person is told. Reads the SQLSTATE
/// and the mapper's own cause, never the message text.
QrLoginFailure qrLoginFailureFor(SupabaseFailure failure) {
  if (failure.isConnectivity || failure.error.kind == AppErrorKind.network) {
    return QrLoginFailure.needsSignal;
  }
  if (failure.isSchemaMismatch) return QrLoginFailure.unavailable;
  if (failure.code == '42501') return QrLoginFailure.notAllowed;
  if (failure.error.kind == AppErrorKind.authentication) {
    return QrLoginFailure.signedOut;
  }
  if (failure.isPermissionDenied) return QrLoginFailure.notAllowed;
  return QrLoginFailure.failed;
}

final class SupabaseQrLoginRepository
    with SupabaseGateway
    implements QrLoginRepository {
  SupabaseQrLoginRepository({
    required QrLoginRpc rpc,
    required bool Function() hasSession,
  })  : _rpc = rpc,
        _hasSession = hasSession;

  factory SupabaseQrLoginRepository.fromClient(SupabaseClient client) {
    return SupabaseQrLoginRepository(
      rpc: (String name, Map<String, Object?> params) =>
          client.rpc<Object?>(name, params: params),
      hasSession: () => client.auth.currentUser != null,
    );
  }

  final QrLoginRpc _rpc;
  final bool Function() _hasSession;

  @override
  Future<QrLoginOutcome> decide({
    required String id,
    required String secret,
    required bool approve,
  }) async {
    if (!_hasSession()) return const QrLoginRefused(QrLoginFailure.signedOut);
    try {
      final Object? reply = await guard<Object?>(
        () => _rpc(
          SupabaseRpcs.qrLoginApprove,
          qrLoginApproveParams(id: id, secret: secret, approve: approve),
        ),
      );
      return qrLoginOutcomeFromReply(reply, approve: approve);
    } on SupabaseFailure catch (failure) {
      return QrLoginRefused(qrLoginFailureFor(failure));
    } on Object {
      return const QrLoginRefused(QrLoginFailure.failed);
    }
  }
}
