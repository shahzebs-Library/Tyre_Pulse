/**
 * THE RULES THAT DECIDE WHETHER SOMEBODY STAYS SIGNED IN.
 *
 * Pure, no imports, so every rule below is unit-testable without a device.
 *
 * WHY THIS EXISTS. The people using this app are tyre men, mechanics and
 * drivers whose accounts were created FOR them by an admin. A large share of
 * them do not know their own username, and none of them know their password. So
 * an unintended sign-out is not an inconvenience - it is a person who cannot get
 * back into the app at all, and whose queued offline inspections are stranded
 * behind a login screen they cannot pass.
 *
 * The rule that follows from that, and that every function here encodes:
 *
 *   ONLY A DEFINITIVE SERVER ANSWER MAY END A SESSION.
 *
 * A dead network, an aborted request, a 5xx, a stalled Keystore or an unreadable
 * chunk are all TRANSIENT and must leave the session exactly where it was. When
 * we cannot tell the difference, we keep the user signed in: RLS is still the
 * real boundary on every read, so the cost of guessing "stay" is nothing, and
 * the cost of guessing "leave" is a worker who cannot work.
 *
 * What still ends a session, unchanged:
 *   - the user taps Sign out
 *   - the server says the account is locked or not approved
 *   - the refresh token is definitively rejected by the server
 */

/* ------------------------------------------------------------------ *
 * Token refresh across background / foreground
 * ------------------------------------------------------------------ */

/**
 * supabase-js keeps its access token fresh with a `setInterval` ticker. React
 * Native suspends JS timers once the OS backgrounds or freezes the process, so
 * a phone left in a pocket overnight comes back with a ticker that has not run
 * for hours and an access token that expired long ago. Until the next tick
 * fires - up to a full tick period later - every request goes out with a dead
 * JWT, which is what turns "I opened the app in the morning" into 401s and, for
 * an offline queue flushing at that exact moment, failed uploads.
 *
 * Driving `startAutoRefresh()` / `stopAutoRefresh()` off AppState is the
 * documented React Native fix. `startAutoRefresh()` also runs one tick
 * IMMEDIATELY, so the token is renewed as the app comes forward rather than
 * whenever the interval next happens to land.
 *
 * 'active' is the only foreground state. 'inactive' is the iOS transitional
 * state (app switcher, incoming call) and is treated as background: stopping a
 * ticker we are about to restart costs nothing, whereas firing a refresh into a
 * process that is being suspended is exactly how a half-completed refresh
 * happens.
 */
export function shouldRunAutoRefresh(appState: string | null | undefined): boolean {
  return appState === 'active'
}

/* ------------------------------------------------------------------ *
 * Boot: signed out, or just unable to read?
 * ------------------------------------------------------------------ */

export type RestoreOutcome = 'signed-in' | 'signed-out' | 'restore-failed'

/**
 * Decide what an empty session at boot actually means.
 *
 * supabase-js reads the stored session through our chunked SecureStore adapter,
 * and that adapter can only answer `string | null`. A Keystore call that refuses
 * therefore arrives at supabase-js as "there is no session", which it faithfully
 * reports as a signed-out user - and we would drop a field worker onto a login
 * screen while their session was sitting on the device the whole time.
 *
 * So an empty session is only believed when the storage layer also reports that
 * it read everything it was asked for. If a read failed during the restore, the
 * honest answer is `restore-failed`: show a retry, never a login screen.
 *
 * `restore-failed` grants NOTHING. No user is set, no protected route renders,
 * every read still needs a live JWT and still passes RLS. It changes only which
 * screen the person is looking at.
 */
export function classifyRestore(args: {
  hasSession: boolean
  /** True when a SecureStore read ended `unreadable` or `torn` while the
   *  session was being restored. */
  storageReadFailed: boolean
}): RestoreOutcome {
  if (args.hasSession) return 'signed-in'
  return args.storageReadFailed ? 'restore-failed' : 'signed-out'
}

/* ------------------------------------------------------------------ *
 * Classifying a failure
 * ------------------------------------------------------------------ */

/** Postgres/PostgREST codes that mean "the server answered, and the answer was
 *  no" as opposed to "we never reached the server". */
const DEFINITIVE_CODES = new Set([
  'PGRST301', // JWT expired / invalid - the server rejected the credential
  '42501',    // insufficient privilege
])

/**
 * Is this failure transient (keep the session) or definitive (the server has
 * spoken)?
 *
 * Deliberately biased towards transient: anything we do not positively
 * recognise as a server verdict is treated as a network problem. The default
 * when in doubt is to keep somebody signed in.
 *
 * NOTE this is a signal for the UI, not an authorisation decision. Nothing here
 * grants access; a definitive verdict from the server still arrives through the
 * profile row and the refresh token, both of which are enforced elsewhere.
 */
export function isTransientAuthFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return true

  const e = err as { code?: unknown; status?: unknown; name?: unknown; message?: unknown }

  const code = typeof e.code === 'string' ? e.code : ''
  if (code && DEFINITIVE_CODES.has(code)) return false

  // supabase-js marks anything it considers worth retrying with this name, and
  // it already covers offline fetches and 5xx.
  if (e.name === 'AuthRetryableFetchError') return true
  // An abort is our own request timeout firing on a half-dead link.
  if (e.name === 'AbortError') return true

  const status = typeof e.status === 'number' ? e.status : 0
  if (status >= 500) return true
  // 401/403 from PostgREST on a route the user legitimately holds means the JWT
  // was rejected. That IS the server answering.
  if (status === 401 || status === 403) return false

  const message = typeof e.message === 'string' ? e.message.toLowerCase() : ''
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('aborted') ||
    message.includes('failed to fetch')
  ) return true

  return true
}

/* ------------------------------------------------------------------ *
 * The offline profile cache
 * ------------------------------------------------------------------ */

/**
 * How long a device may open the app on the last profile we ourselves verified
 * from the server, with no connectivity since.
 *
 * THIS WAS 14 DAYS AND THAT WAS TOO SHORT. A worker on leave, on a long rotation
 * or simply out of coverage past a fortnight came back to an app that refused to
 * open - including refusing them their own queued inspections, which is the one
 * thing they most needed to reach. That is the exact lockout this whole change
 * exists to remove.
 *
 * WHY EXTENDING IT IS SAFE. The cache unlocks the LOCAL shell and this user's
 * own queued work. It grants no data access whatsoever: every read still needs a
 * live JWT and still passes RLS server-side, so a revoked account reaches
 * nothing no matter how long the cache lives. It is written only from a
 * successful server fetch of a non-locked, approved account, is bound to one
 * user id, and is re-checked against the server the moment there is signal - the
 * realtime profile listener and the next fetch both sign out an account that has
 * since been locked or unapproved. A deleted account's refresh token is rejected
 * outright and the session dies regardless of this value.
 *
 * It is still BOUNDED rather than infinite, so a phone that has been dark for a
 * whole quarter fails closed and has to talk to the server again.
 */
export const PROFILE_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

/**
 * May we open the app on this cached profile? Fails closed on anything missing
 * or stale, and never resurrects an account that was locked or unapproved when
 * we last saw it.
 */
export function isCachedProfileUsable(args: {
  cachedForUserId?: string | null
  wantUserId: string
  cachedAt?: number | null
  now: number
  locked?: boolean | null
  approved?: boolean | null
}): boolean {
  if (!args.cachedForUserId || args.cachedForUserId !== args.wantUserId) return false
  if (!args.cachedAt || !Number.isFinite(args.cachedAt)) return false
  if (args.now - args.cachedAt > PROFILE_CACHE_MAX_AGE_MS) return false
  // Defence in depth: the cache is only ever written from a healthy account, so
  // this should be unreachable - which is exactly why it is worth asserting.
  if (args.locked === true) return false
  if (args.approved === false) return false
  return true
}

/* ------------------------------------------------------------------ *
 * Re-checking the account when the app comes forward
 * ------------------------------------------------------------------ */

/** Do not re-read the profile more often than this when the app is brought
 *  forward, so flicking between apps does not turn into a request storm. */
export const FOREGROUND_REVALIDATE_MIN_INTERVAL_MS = 60 * 1000

/**
 * An account can be locked while the phone sleeps. Re-reading the profile as the
 * app comes forward is what makes that lock take effect promptly rather than
 * whenever the user next happens to trigger a fetch, so this tightens security
 * at the same time as it keeps sessions alive.
 */
export function shouldRevalidateOnForeground(args: {
  lastCheckedAt: number | null
  now: number
}): boolean {
  if (args.lastCheckedAt == null) return true
  return args.now - args.lastCheckedAt >= FOREGROUND_REVALIDATE_MIN_INTERVAL_MS
}
