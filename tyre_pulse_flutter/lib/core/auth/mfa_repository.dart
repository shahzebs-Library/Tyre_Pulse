/// The second sign-in step: is a multi-factor challenge owed, and verifying it.
///
/// # Why this exists
///
/// The database treats a super admin who has a verified MFA factor as a super
/// admin ONLY inside an MFA-completed session (JWT `aal` = `aal2`). A password
/// sign-in produces an `aal1` session, so without this step such a user would
/// sign in on the phone and quietly lack the rights they hold on the web.
///
/// # The rule, mirrored from the web app
///
/// `src/lib/authAssurance.js` `hasUnmetMfa`: a challenge is owed exactly when
/// the session's current level is `aal1` and its next level is `aal2` (a
/// verified factor exists). Anything else - no factor, already `aal2`, or the
/// check itself failing - is NOT owed. The check FAILS OPEN on purpose: a
/// user with no factor must never be locked out by a broken assurance read,
/// and row-level security remains the server-side boundary either way.
///
/// Enrolment is deliberately absent. Factors are enrolled on the web.
///
/// Kept apart from `AuthRepository` so the many fakes of that interface do not
/// have to grow, and so the SDK's MFA types stay confined to this file.
library;

import 'package:supabase_flutter/supabase_flutter.dart';

/// Whether the current session still owes a second factor.
enum MfaAssurance {
  /// Nothing owed: no verified factor, already verified, or unreadable.
  satisfied,

  /// A verified factor exists and this session has not passed it yet.
  challengeRequired,
}

/// The result of one verification attempt. Never thrown, always a value.
sealed class MfaVerifyOutcome {
  const MfaVerifyOutcome();
}

/// The code was accepted. The session is now `aal2`.
final class MfaVerified extends MfaVerifyOutcome {
  const MfaVerified();
}

/// The server refused the code (wrong, expired, or already used).
final class MfaCodeRejected extends MfaVerifyOutcome {
  const MfaCodeRejected();
}

/// The attempt could not be completed: offline, a server fault, or no usable
/// factor could be found. Says nothing about whether the code was right.
final class MfaVerifyUnavailable extends MfaVerifyOutcome {
  const MfaVerifyUnavailable();
}

/// Pure form of the assurance rule, exposed for tests. [current] and [next]
/// are the level names (`aal1`, `aal2`) or null.
MfaAssurance mfaAssuranceFor({String? current, String? next}) =>
    current == 'aal1' && next == 'aal2'
        ? MfaAssurance.challengeRequired
        : MfaAssurance.satisfied;

/// The narrow MFA surface `AuthController` needs.
abstract interface class MfaRepository {
  /// Reads the assurance of the session RIGHT NOW. Synchronous: the SDK
  /// derives it from the stored access token and user, with no network call,
  /// so it also answers on an offline cold start. Never throws.
  MfaAssurance currentAssurance();

  /// Challenges the user's verified authenticator factor and verifies [code]
  /// against it. Never throws.
  Future<MfaVerifyOutcome> verify(String code);
}

/// The real implementation, over a live [SupabaseClient].
final class SupabaseMfaRepository implements MfaRepository {
  SupabaseMfaRepository(this._client);

  final SupabaseClient _client;

  @override
  MfaAssurance currentAssurance() {
    try {
      final AuthMFAGetAuthenticatorAssuranceLevelResponse levels =
          _client.auth.mfa.getAuthenticatorAssuranceLevel();
      return mfaAssuranceFor(
        current: levels.currentLevel?.name,
        next: levels.nextLevel?.name,
      );
    } on Object {
      // Fail open. See the library comment.
      return MfaAssurance.satisfied;
    }
  }

  @override
  Future<MfaVerifyOutcome> verify(String code) async {
    try {
      final String? factorId = await _verifiedTotpFactorId();
      if (factorId == null) {
        return const MfaVerifyUnavailable();
      }
      await _client.auth.mfa.challengeAndVerify(
        factorId: factorId,
        code: code,
      );
      return const MfaVerified();
    } on AuthRetryableFetchException {
      return const MfaVerifyUnavailable();
    } on AuthApiException catch (error) {
      final int? status = int.tryParse(error.statusCode ?? '');
      if (status != null && status >= 500) {
        return const MfaVerifyUnavailable();
      }
      return const MfaCodeRejected();
    } on Object {
      return const MfaVerifyUnavailable();
    }
  }

  /// The verified authenticator-app factor to challenge. Read from the session
  /// user first (no network); the server list is the fallback.
  Future<String?> _verifiedTotpFactorId() async {
    final List<Factor> local =
        _client.auth.currentUser?.factors ?? const <Factor>[];
    for (final Factor factor in local) {
      if (factor.factorType == FactorType.totp &&
          factor.status == FactorStatus.verified) {
        return factor.id;
      }
    }
    final AuthMFAListFactorsResponse listed =
        await _client.auth.mfa.listFactors();
    return listed.totp.isEmpty ? null : listed.totp.first.id;
  }
}
