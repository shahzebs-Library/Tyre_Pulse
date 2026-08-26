/// The result of one sign-in attempt.
///
/// A sealed hierarchy, not a boolean plus an error: a login screen needs to
/// tell "wrong password" apart from "locked out, try again in N minutes" apart
/// from "the server is unreachable", and each of those needs different words
/// and a different retry affordance. `mobile/app/(auth)/login.tsx` folds all
/// three into one string built ad hoc inside the screen; that logic belongs in
/// the domain layer so a login SCREEN - which nothing in this task builds - can
/// be a thin renderer over a typed answer, per AGENTS.md's layering rule: no
/// business rule inside UI code.
library;

import 'package:tyre_pulse/core/errors/app_error.dart';

/// The outcome of a sign-in attempt.
sealed class SignInOutcome {
  const SignInOutcome();
}

/// The credentials were accepted. A Supabase session now exists.
///
/// This does not itself say the app is usable - the profile still has to load,
/// the account might be locked or unapproved, and the build might be below the
/// minimum version. Those are session-phase and shell-gate concerns, resolved
/// separately once the session listener picks up the new session.
final class SignInSucceeded extends SignInOutcome {
  const SignInSucceeded();
}

/// This identifier is locked out after too many failed attempts.
///
/// Deliberately reported even when the credentials just supplied were correct:
/// the server's lock check runs BEFORE the sign-in attempt, matching
/// `mobile/app/(auth)/login.tsx`'s `lockStatus` pre-check, so a locked account
/// is refused without ever telling the caller whether the password was right -
/// account enumeration protection is a property of this ordering, not
/// something a caller can get right by being careful afterwards.
final class SignInLocked extends SignInOutcome {
  const SignInLocked(this.lockoutMinutes);

  /// Minutes until the lock clears, rounded up, never less than one. See
  /// `LoginLockStatus.lockoutMinutes`.
  final int lockoutMinutes;
}

/// The identifier or password was wrong.
///
/// Carries a single generic sentence deliberately - see [AppError.message] on
/// [error] - never "unknown username" versus "wrong password", which is
/// account enumeration.
final class SignInRejected extends SignInOutcome {
  const SignInRejected(this.error);

  final AppError error;
}

/// The attempt could not be completed at all: offline, a server error, or
/// anything else that says nothing about whether these credentials are valid.
/// Retryable by nature.
final class SignInFailed extends SignInOutcome {
  const SignInFailed(this.error);

  final AppError error;
}
