/**
 * captchaBridge - lets the installed 1.6.0 app sign in once Supabase CAPTCHA
 * protection is switched on, WITHOUT any native module the binary lacks.
 *
 * WHY A BROWSER. The 1.6.0 binary carries no WebView and no in-app browser
 * module, so Cloudflare Turnstile cannot run inside the app. An OTA can only
 * change JavaScript. So the app opens a fixed page on tyrepulse.app in the
 * phone's browser, the person solves the check there, and taps "Return to
 * Tyre Pulse", which opens:
 *
 *   tyrepulse-inspector://captcha?state=<state>&token=<turnstile token>
 *
 * The app then retries signInWithPassword with options.captchaToken.
 *
 * REACTIVE. Nothing here runs while CAPTCHA protection is off: sign-in tries
 * exactly as before, and only a refusal that Supabase marks as a captcha
 * failure starts the browser check.
 *
 * SAFETY RULES (each is pinned by __tests__/captchaBridge.test.ts):
 *   - `state` is at least 128 bits from a cryptographic source, or the check is
 *     refused. Math.random is NEVER used here.
 *   - A return link is accepted only when the host is `captcha`, the state is
 *     the pending one, it arrives within CHECK_TTL_MS, it carries exactly
 *     `state` + `token`, and only ONCE.
 *   - The password lives in this module's memory only, never in storage, and is
 *     cleared the moment it is used, expired or cancelled.
 *   - The page URL is a constant. The return link is fixed by that page and is
 *     never read from the URL, so there is no open redirect.
 *
 * This file is PURE (no React Native import) so it runs under the plain
 * Node/ts-jest suite. Linking and the network check are wired in the screen.
 */

export const APP_SCHEME = 'tyrepulse-inspector'
export const RETURN_HOST = 'captcha'
export const BRIDGE_URL = 'https://tyrepulse.app/captcha-bridge'
/** How long a started check stays valid. */
export const CHECK_TTL_MS = 5 * 60 * 1000

const STATE_RE = /^[0-9a-f]{32,128}$/
// Turnstile tokens are opaque; observed alphabet is base64url plus '.'.
const TOKEN_RE = /^[A-Za-z0-9._\-]{10,4096}$/

// ---------------------------------------------------------------------------
// Captcha refusal detection
// ---------------------------------------------------------------------------

/** True when Supabase Auth refused because the CAPTCHA token was missing or
 *  invalid (code `captcha_failed`, message mentions captcha). A refusal like
 *  this is NOT a wrong password and must never count toward a lockout. */
export function isCaptchaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; message?: unknown; error_code?: unknown }
  if (e.code === 'captcha_failed' || e.error_code === 'captcha_failed') return true
  return typeof e.message === 'string' && /captcha/i.test(e.message)
}

/** True for a transport failure (no connection), as opposed to a refusal. */
export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: unknown; status?: unknown; message?: unknown }
  // auth-js also uses AuthRetryableFetchError for 502/503/504; only a status of
  // 0 (or none) is a dropped connection.
  if (e.name === 'AuthRetryableFetchError') return e.status === 0 || e.status == null
  if (e.status === 0) return true
  return typeof e.message === 'string' && /network request failed|failed to fetch/i.test(e.message)
}

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

export type RandomSource = 'getRandomValues' | 'expo-uuidv4'

/**
 * Build a hex state of at least 128 random bits from a CRYPTOGRAPHIC source.
 *
 * 1. `crypto.getRandomValues` when the runtime has it (32 bytes = 256 bits).
 * 2. Otherwise expo-modules-core's native `globalThis.expo.uuidv4`, which is in
 *    the 1.6.0 binary (expo-modules-core 3.0.30) and is backed by
 *    java.util.UUID.randomUUID() = SecureRandom on Android. Two v4 UUIDs give
 *    2 x 122 = 244 random bits.
 * 3. Otherwise null: the caller refuses to start the check. Math.random is not
 *    acceptable for a value that guards a sign-in hand-off.
 *
 * `env` is injectable so the fallbacks can be tested.
 */
export function makeState(env: any = globalThis): { state: string; source: RandomSource } | null {
  try {
    const c = env?.crypto
    if (c && typeof c.getRandomValues === 'function') {
      const bytes = new Uint8Array(32)
      c.getRandomValues(bytes)
      // Defend against a stub that returns without filling the array.
      if (bytes.some(b => b !== 0)) {
        return { state: toHex(bytes), source: 'getRandomValues' }
      }
    }
  } catch { /* fall through */ }
  try {
    const uuidv4 = env?.expo?.uuidv4
    if (typeof uuidv4 === 'function') {
      const a = String(uuidv4()).replace(/-/g, '').toLowerCase()
      const b = String(uuidv4()).replace(/-/g, '').toLowerCase()
      if (/^[0-9a-f]{32}$/.test(a) && /^[0-9a-f]{32}$/.test(b) && a !== b) {
        return { state: a + b, source: 'expo-uuidv4' }
      }
    }
  } catch { /* fall through */ }
  return null
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

// ---------------------------------------------------------------------------
// Link building / parsing
// ---------------------------------------------------------------------------

/** The fixed page the browser opens. Only `state` and `lang` vary. */
export function buildBridgeUrl(state: string, lang: string): string {
  const safeLang = ['en', 'ar', 'ur'].includes(lang) ? lang : 'en'
  return `${BRIDGE_URL}?state=${encodeURIComponent(state)}&lang=${safeLang}`
}

export type ParsedReturn = { state: string; token: string }

/**
 * Parse `tyrepulse-inspector://captcha?state=..&token=..`.
 * Returns null for ANY other link (wrong scheme, wrong host/path, missing or
 * malformed state/token, duplicated or unknown query parameters, fragments).
 * A null means "not ours, ignore it", never an error shown to the user.
 */
export function parseReturnUrl(url: unknown): ParsedReturn | null {
  if (typeof url !== 'string' || url.length > 8192) return null
  const prefix = `${APP_SCHEME}:`
  if (url.slice(0, prefix.length).toLowerCase() !== prefix) return null
  if (url.includes('#')) return null
  let rest = url.slice(prefix.length)
  rest = rest.replace(/^\/+/, '')
  const q = rest.indexOf('?')
  if (q < 0) return null
  const path = rest.slice(0, q).replace(/\/+$/, '')
  if (path.toLowerCase() !== RETURN_HOST) return null

  const params: Record<string, string> = {}
  const query = rest.slice(q + 1)
  if (!query) return null
  for (const part of query.split('&')) {
    const eq = part.indexOf('=')
    if (eq <= 0) return null
    const key = part.slice(0, eq)
    let value: string
    try {
      value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '))
    } catch {
      return null
    }
    if (key !== 'state' && key !== 'token') return null
    if (key in params) return null
    params[key] = value
  }
  const { state, token } = params
  if (!state || !token) return null
  if (!STATE_RE.test(state) || !TOKEN_RE.test(token)) return null
  return { state, token }
}

// ---------------------------------------------------------------------------
// Pending check (in memory only)
// ---------------------------------------------------------------------------

type Pending = {
  state: string
  createdAt: number
  identifier: string
  password: string
}

let pending: Pending | null = null
// States already accepted in this process. A second delivery of the same link
// (expo-router AND the Linking listener both see it) is a silent duplicate,
// not an "expired" notice and never a second sign-in.
const consumed: string[] = []

export type StartResult =
  | { ok: true; state: string; source: RandomSource }
  | { ok: false; reason: 'no_random' }

/** Begin a check. Replaces any earlier one (only the newest state is valid). */
export function startCheck(
  identifier: string,
  password: string,
  now: number = Date.now(),
  env: any = globalThis,
): StartResult {
  const made = makeState(env)
  if (!made) {
    pending = null
    return { ok: false, reason: 'no_random' }
  }
  pending = { state: made.state, createdAt: now, identifier, password }
  return { ok: true, state: made.state, source: made.source }
}

export function hasPendingCheck(now: number = Date.now()): boolean {
  if (!pending) return false
  if (now - pending.createdAt > CHECK_TTL_MS) {
    pending = null
    return false
  }
  return true
}

/** The state of the pending check, for re-opening the same page. */
export function pendingState(now: number = Date.now()): string | null {
  return hasPendingCheck(now) ? pending!.state : null
}

export function cancelCheck(): void {
  pending = null
}

export type AcceptResult =
  | { status: 'ignored' }                        // not a captcha return link
  | { status: 'duplicate' }                      // the same link delivered again
  | { status: 'expired' }                        // ours, but nothing valid is waiting
  | { status: 'mismatch' }                       // a state that is not the pending one
  | { status: 'accepted'; identifier: string; password: string; token: string }

/**
 * Hand an incoming URL to the bridge. On `accepted` the pending check is
 * consumed, so a second delivery of the same link (expo-router and the Linking
 * listener can both see it) is reported as `expired`, never accepted twice.
 */
export function acceptReturnUrl(url: unknown, now: number = Date.now()): AcceptResult {
  const parsed = parseReturnUrl(url)
  if (!parsed) return { status: 'ignored' }
  if (consumed.some(c => sameString(c, parsed.state))) return { status: 'duplicate' }
  if (!pending) return { status: 'expired' }
  if (now - pending.createdAt > CHECK_TTL_MS || now < pending.createdAt) {
    pending = null
    return { status: 'expired' }
  }
  if (!sameString(parsed.state, pending.state)) return { status: 'mismatch' }
  const { identifier, password } = pending
  pending = null
  consumed.push(parsed.state)
  if (consumed.length > 5) consumed.shift()
  return { status: 'accepted', identifier, password, token: parsed.token }
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---------------------------------------------------------------------------
// Hand-off to the sign-in screen
// ---------------------------------------------------------------------------
//
// The return link may arrive while the sign-in screen is mounted, or while the
// router has briefly replaced it with app/captcha.tsx. So an accepted return is
// parked here (memory only) and the screen picks it up whenever it is mounted.

export type Outcome =
  | { type: 'accepted'; identifier: string; password: string; token: string }
  | { type: 'rejected'; reason: 'expired' | 'mismatch' }

type Parked = { outcome: Outcome; at: number }

let parked: Parked | null = null
const listeners = new Set<() => void>()

/** Run an incoming URL through acceptReturnUrl and park the outcome for the
 *  screen. Returns true when the link was a captcha return (ours). */
export function deliverReturnUrl(url: unknown, now: number = Date.now()): boolean {
  const r = acceptReturnUrl(url, now)
  if (r.status === 'ignored') return false
  if (r.status === 'duplicate') return true
  if (r.status === 'accepted') {
    parked = { outcome: { type: 'accepted', identifier: r.identifier, password: r.password, token: r.token }, at: now }
  } else if (!(parked && parked.outcome.type === 'accepted')) {
    // A duplicate delivery after an accept must not overwrite the accept with
    // an "expired" notice.
    parked = { outcome: { type: 'rejected', reason: r.status }, at: now }
  }
  listeners.forEach(fn => { try { fn() } catch { /* a listener must not break delivery */ } })
  return true
}

/** Take the parked outcome once. An accepted outcome older than CHECK_TTL_MS
 *  is dropped (and its password with it). */
export function takeOutcome(now: number = Date.now()): Outcome | null {
  const p = parked
  parked = null
  if (!p) return null
  if (now - p.at > CHECK_TTL_MS) return null
  return p.outcome
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Forget the pending check AND any parked outcome (cancel / success). */
export function clearAll(): void {
  pending = null
  parked = null
}

/** Test-only reset. */
export function __resetForTests(): void {
  pending = null
  parked = null
  consumed.length = 0
  listeners.clear()
}

// ---------------------------------------------------------------------------
// Lockout decision (pure, so it can be tested without the screen)
// ---------------------------------------------------------------------------

/**
 * Should this sign-in failure count toward the server-side lockout?
 * A captcha refusal or a dropped connection says nothing about the password.
 */
export function shouldRecordFailure(result: { error: unknown; captchaRequired?: boolean; offline?: boolean }): boolean {
  if (!result.error) return false
  if (result.captchaRequired) return false
  if (result.offline) return false
  return true
}
