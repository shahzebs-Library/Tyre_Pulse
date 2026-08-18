/**
 * THE RULES THAT KEEP A FIELD WORKER SIGNED IN.
 *
 * The people using this app did not choose their own credentials - an admin
 * created the account for them. Most do not know their username; none know their
 * password. So every unintended sign-out is a person who cannot get back into
 * the app at all, and whose queued offline inspections are stranded behind a
 * login screen they cannot pass.
 *
 * The invariant every test here defends: ONLY A DEFINITIVE SERVER ANSWER MAY END
 * A SESSION. A dead network, an aborted request, a 5xx, a stalled Keystore or an
 * unreadable chunk are all transient and must leave the session where it was.
 *
 * These are the pure rules, so they can be pinned without a device. What they
 * CANNOT prove is the field behaviour they encode - see shouldRunAutoRefresh
 * below, whose real subject is a phone left in a pocket overnight.
 */

import {
  shouldRunAutoRefresh,
  classifyRestore,
  isTransientAuthFailure,
  isCachedProfileUsable,
  shouldRevalidateOnForeground,
  PROFILE_CACHE_MAX_AGE_MS,
  FOREGROUND_REVALIDATE_MIN_INTERVAL_MS,
} from '../lib/authLifecycle'

const DAY = 24 * 60 * 60 * 1000

describe('token refresh follows the app in and out of the foreground', () => {
  it('runs the refresh ticker only while the app is genuinely in front', () => {
    expect(shouldRunAutoRefresh('active')).toBe(true)
  })

  it('stops it while backgrounded, and while iOS is mid-transition', () => {
    // 'inactive' is the app switcher / incoming call. Stopping a ticker we are
    // about to restart costs nothing; firing a refresh into a process that is
    // being suspended is how a half-completed refresh happens.
    expect(shouldRunAutoRefresh('background')).toBe(false)
    expect(shouldRunAutoRefresh('inactive')).toBe(false)
  })

  it('treats an unknown or missing state as not-foreground', () => {
    expect(shouldRunAutoRefresh('unknown')).toBe(false)
    expect(shouldRunAutoRefresh(null)).toBe(false)
    expect(shouldRunAutoRefresh(undefined)).toBe(false)
  })
})

describe('an empty session is only believed when the read actually worked', () => {
  it('signs in when a session came back', () => {
    expect(classifyRestore({ hasSession: true, storageReadFailed: false })).toBe('signed-in')
  })

  it('signs out only when nothing was stored AND nothing failed', () => {
    // A real first launch must still reach the login screen.
    expect(classifyRestore({ hasSession: false, storageReadFailed: false })).toBe('signed-out')
  })

  it('reports restore-failed rather than signed-out when a read failed', () => {
    // THE BUG THIS EXISTS FOR. A refused Keystore call reaches supabase-js as
    // "there is no session", and the user - who cannot type their own password -
    // was dropped onto the login screen with their session still on the device.
    expect(classifyRestore({ hasSession: false, storageReadFailed: true })).toBe('restore-failed')
  })

  it('trusts a session that came back even if some other read failed', () => {
    // The session is the authority. An unrelated failed read (a queue slot, say)
    // must not downgrade a perfectly good restore into a retry screen.
    expect(classifyRestore({ hasSession: true, storageReadFailed: true })).toBe('signed-in')
  })
})

describe('a failure is transient unless the server actually answered', () => {
  it('keeps the session through every shape of network failure', () => {
    expect(isTransientAuthFailure(new TypeError('Network request failed'))).toBe(true)
    expect(isTransientAuthFailure({ name: 'AbortError', message: 'Aborted' })).toBe(true)
    expect(isTransientAuthFailure({ name: 'AuthRetryableFetchError' })).toBe(true)
    expect(isTransientAuthFailure({ message: 'connection timed out' })).toBe(true)
    expect(isTransientAuthFailure({ status: 503 })).toBe(true)
    expect(isTransientAuthFailure({ status: 500 })).toBe(true)
  })

  it('treats a rejected credential as definitive', () => {
    expect(isTransientAuthFailure({ status: 401 })).toBe(false)
    expect(isTransientAuthFailure({ status: 403 })).toBe(false)
    expect(isTransientAuthFailure({ code: 'PGRST301' })).toBe(false)
  })

  it('leans towards keeping the user signed in when it cannot tell', () => {
    // Deliberate bias. Guessing "stay" costs nothing - RLS is still the real
    // boundary on every read. Guessing "leave" costs a worker their shift.
    expect(isTransientAuthFailure(undefined)).toBe(true)
    expect(isTransientAuthFailure('something odd')).toBe(true)
    expect(isTransientAuthFailure({ message: 'unrecognised' })).toBe(true)
  })
})

describe('the offline profile cache', () => {
  const now = 1_700_000_000_000
  const base = {
    cachedForUserId: 'user-1',
    wantUserId: 'user-1',
    cachedAt: now - DAY,
    now,
    locked: false,
    approved: true,
  }

  it('opens the app on a recently verified profile', () => {
    expect(isCachedProfileUsable(base)).toBe(true)
  })

  it('survives a month offline, which the old 14 day bound did not', () => {
    // THE REGRESSION THIS FIXES. A worker on leave or on a long rotation came
    // back to an app that refused to open - including refusing them their own
    // queued inspections, the one thing they most needed to reach.
    expect(isCachedProfileUsable({ ...base, cachedAt: now - 30 * DAY })).toBe(true)
    expect(isCachedProfileUsable({ ...base, cachedAt: now - 80 * DAY })).toBe(true)
  })

  it('is still bounded, so a phone dark for a whole quarter fails closed', () => {
    expect(PROFILE_CACHE_MAX_AGE_MS).toBe(90 * DAY)
    expect(isCachedProfileUsable({ ...base, cachedAt: now - 91 * DAY })).toBe(false)
  })

  it('never serves the profile of one account to another', () => {
    expect(isCachedProfileUsable({ ...base, cachedForUserId: 'user-2' })).toBe(false)
    expect(isCachedProfileUsable({ ...base, cachedForUserId: null })).toBe(false)
  })

  it('never resurrects a locked or unapproved account', () => {
    // Defence in depth: the cache is only ever written from a healthy account,
    // which is exactly why this is worth asserting.
    expect(isCachedProfileUsable({ ...base, locked: true })).toBe(false)
    expect(isCachedProfileUsable({ ...base, approved: false })).toBe(false)
  })

  it('refuses a cache entry with no usable timestamp', () => {
    expect(isCachedProfileUsable({ ...base, cachedAt: null })).toBe(false)
    expect(isCachedProfileUsable({ ...base, cachedAt: NaN })).toBe(false)
  })
})

describe('re-checking the account when the app comes forward', () => {
  const now = 1_700_000_000_000

  it('always checks the first time the app is brought forward', () => {
    expect(shouldRevalidateOnForeground({ lastCheckedAt: null, now })).toBe(true)
  })

  it('re-checks once the interval has passed, so a lock takes effect promptly', () => {
    expect(shouldRevalidateOnForeground({
      lastCheckedAt: now - FOREGROUND_REVALIDATE_MIN_INTERVAL_MS, now,
    })).toBe(true)
  })

  it('does not turn app switching into a request storm', () => {
    expect(shouldRevalidateOnForeground({ lastCheckedAt: now - 1000, now })).toBe(false)
  })
})
