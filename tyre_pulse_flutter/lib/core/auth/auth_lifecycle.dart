/// The rules that decide whether somebody stays signed in, and the timeouts
/// that bound every wait in this layer.
///
/// Pure Dart. No Flutter, no Supabase, no clock read directly - every function
/// here takes `now` as a parameter, so the rules are testable without a real
/// timer ever running.
///
/// # Why this file exists
///
/// Ported from `mobile/lib/authLifecycle.ts`, which is the verified, shipped
/// business logic behind the production Expo app's `AuthContext`. AGENTS.md
/// ranks "working React Native production behaviour" and "verified business
/// logic" above a fresh implementation, and this file is exactly that: the
/// rules are transcribed, not reinvented, because the reasoning behind each one
/// is the record of a real incident.
///
/// The people using this app are tyre men, mechanics and drivers whose
/// accounts were created FOR them by an admin. A large share of them do not
/// know their own username, and none of them know their password. So an
/// unintended sign-out is not an inconvenience - it is a person who cannot get
/// back into the app at all, and whose queued offline inspections are stranded
/// behind a login screen they cannot pass.
///
/// The rule that follows from that, and that this file encodes:
///
///   ONLY A DEFINITIVE SERVER ANSWER MAY END A SESSION.
///
/// A dead network, an aborted request, a 5xx, a stalled Keystore read, or an
/// unreadable storage chunk are all TRANSIENT and must leave the session
/// exactly where it was. What still ends a session:
/// - the user taps Sign out;
/// - the server says the account is locked or not approved;
/// - the refresh token is definitively rejected by the server.
library;

/// How long the app waits for the stored Supabase session to come back before
/// giving up and offering a retry, rather than spinning forever.
///
/// Ported VERBATIM from `SESSION_RESTORE_TIMEOUT_MS = 8000` in
/// `mobile/contexts/AuthContext.tsx`. That file's own comment records why 8
/// seconds: "Generous enough that a merely slow device still restores
/// silently, short enough that a stalled one never traps the user behind an
/// endless spinner." The underlying cause - reading a session out of the
/// Android Keystore is a binder IPC, and a Supabase session is larger than one
/// secure-storage slot so a cold start makes several round trips - is
/// documented at length in `staged_secure_store.dart`; this constant is the
/// bound placed on the READER of that store, not on the store itself.
///
/// Artifact 03 section 1.1 requires [TpSessionPhase.timedOut] to exist for
/// exactly this reason.
const Duration sessionRestoreTimeout = Duration(seconds: 8);

/// How long the app waits for the `profiles` row to come back before treating
/// the fetch as failed.
///
/// This bound has NO direct React Native precedent - the production
/// `fetchProfile` relies on the underlying network stack's own timeout, which
/// is unbounded on some platforms and connection types. Without an explicit
/// bound here, a profile fetch that never resolves would leave
/// `TpSession.isResolving` true forever: the exact "permanent spinner" defect
/// [sessionRestoreTimeout] exists to prevent, reproduced one layer further in.
/// 20 seconds is generous for one PostgREST row over a weak field connection,
/// and short enough that a genuinely dead link surfaces as a retryable error
/// (via `classifySupabaseError`'s `TimeoutException` handling) rather than a
/// screen that never changes.
const Duration profileLoadTimeout = Duration(seconds: 20);

/// How long the app waits for the `system_config` minimum-version read.
///
/// The version gate FAILS OPEN on any read failure (see `app_version.dart`),
/// so this bound only decides how quickly an unreachable server is treated as
/// "could not check" rather than how long the app is willing to be blocked -
/// nothing here can ever refuse a sign-in on its own. Kept short because the
/// gate is a courtesy check, not a security boundary.
const Duration versionGateReadTimeout = Duration(seconds: 10);

/// How long a device may open the app on the last profile it verified from the
/// server, with no connectivity since.
///
/// Ported verbatim from `PROFILE_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000`
/// in `mobile/lib/authLifecycle.ts`. That file's own comment records why 90
/// days and not the 14 it replaced: a worker on leave, on a long rotation, or
/// simply out of coverage past a fortnight came back to an app that refused to
/// open - including refusing them their own queued inspections, which is the
/// one thing they most needed to reach.
///
/// WHY EXTENDING THIS IS SAFE, restated here because it is the whole argument
/// for the cache existing at all: it unlocks the LOCAL shell and this user's
/// own queued work. It grants NO data access - every read still needs a live
/// session and still passes RLS server-side, so a revoked account reaches
/// nothing no matter how long the cache lives. It is written only from a
/// successful server fetch of a non-locked, approved account, bound to one
/// user id, and re-checked against the server the moment there is signal.
const Duration profileCacheMaxAge = Duration(days: 90);

/// Do not re-read the profile more often than this when the app is brought to
/// the foreground, so switching between apps does not turn into a request
/// storm.
///
/// Ported verbatim from `FOREGROUND_REVALIDATE_MIN_INTERVAL_MS = 60 * 1000` in
/// `mobile/lib/authLifecycle.ts`.
const Duration foregroundRevalidateMinInterval = Duration(minutes: 1);

/// What an empty session at boot actually means.
enum RestoreOutcome {
  /// A session was found.
  signedIn,

  /// No session, and every read that would have found one succeeded. This is
  /// the ONLY outcome that may be acted on as "sign in required".
  signedOut,

  /// A storage read failed while the session was being restored. Grants
  /// NOTHING - no user, no protected route - but must not be reported as
  /// [signedOut]: that would drop a field worker onto a login screen while
  /// their session sat untouched on the device.
  restoreFailed,
}

/// Decide what an empty session at boot actually means.
///
/// A key-value store that can only answer `String?` conflates "there is
/// nothing here" with "the read failed". `StagedSecureStore` (this project's
/// secure-storage layer) does not have that problem - it reports
/// [SecureReadStatus.unreadable]/[SecureReadStatus.torn] distinctly - but the
/// Supabase client's OWN session-storage interface still only exchanges
/// `String?` with whatever backs it. So an empty session is only believed when
/// the storage layer ALSO reports that nothing it was asked for failed.
///
/// [restoreFailed] grants nothing. No user is set, no protected route renders,
/// every read still needs a live session and still passes RLS. It changes only
/// which screen a person is looking at.
RestoreOutcome classifyRestore({
  required bool hasSession,
  required bool storageReadFailed,
}) {
  if (hasSession) {
    return RestoreOutcome.signedIn;
  }
  return storageReadFailed
      ? RestoreOutcome.restoreFailed
      : RestoreOutcome.signedOut;
}

/// May the app open on this cached profile row?
///
/// Fails closed on anything missing or stale, and never resurrects an account
/// that was locked or unapproved when it was last cached - defence in depth,
/// since the cache is only ever written from a healthy account in the first
/// place (see [profileCacheMaxAge]'s library comment).
bool isCachedProfileUsable({
  required String? cachedForUserId,
  required String wantUserId,
  required DateTime? cachedAt,
  required DateTime now,
  bool? locked,
  bool? approved,
}) {
  if (cachedForUserId == null || cachedForUserId != wantUserId) {
    return false;
  }
  if (cachedAt == null) {
    return false;
  }
  if (now.difference(cachedAt) > profileCacheMaxAge) {
    return false;
  }
  if (locked == true) {
    return false;
  }
  if (approved == false) {
    return false;
  }
  return true;
}

/// Should the app re-read the profile now that it has come to the foreground?
///
/// An account can be locked while the phone sleeps. Re-reading the profile as
/// the app comes forward is what makes that lock take effect promptly rather
/// than whenever the app next happens to trigger a fetch, so this tightens
/// security at the same time as it keeps sessions alive.
bool shouldRevalidateOnForeground({
  required DateTime? lastCheckedAt,
  required DateTime now,
}) {
  final DateTime? last = lastCheckedAt;
  if (last == null) {
    return true;
  }
  return now.difference(last) >= foregroundRevalidateMinInterval;
}
