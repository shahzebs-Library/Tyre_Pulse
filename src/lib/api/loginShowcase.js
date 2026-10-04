/**
 * Pre-auth sign-in page data + QR sign-in. Shared by the user login (/login)
 * and the System Console login (/console/login) so both read one source.
 *
 *  - getLoginShowcase(): real aggregate counts for the sign-in hero
 *    (get_login_showcase, anon, counts only). Never throws; null on failure so
 *    the page shows N/A instead of an invented number.
 *  - signInOptions(cfg): which extra sign-in buttons are switched on, from the
 *    get_public_config map. Google / Microsoft / QR are hidden until an admin
 *    turns them on, so the page never shows a button that cannot work.
 *  - startQrLogin / pollQrLogin / redeemQrLogin: the browser half of QR sign-in
 *    (qr_login_start + qr_login_status RPCs, then the qr-login edge function,
 *    then supabase.auth.verifyOtp for the session).
 */
import { supabase } from './_client'

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null)

/** Pure: shape the showcase payload. Anything unreadable stays null. */
export function shapeShowcase(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    vehicles: num(raw.vehicles),
    activeVehicles: num(raw.active_vehicles),
    inWorkshop: num(raw.in_workshop),
    sites: num(raw.sites),
    users: num(raw.users),
    countries: Array.isArray(raw.countries) ? raw.countries.filter(Boolean).map(String) : [],
  }
}

export async function getLoginShowcase() {
  try {
    const { data, error } = await supabase.rpc('get_login_showcase')
    if (error) return null
    return shapeShowcase(data)
  } catch {
    return null
  }
}

const truthy = (v) => v === true || v === 'true' || v === '"true"'

/** Pure: which optional sign-in methods are switched on. */
export function signInOptions(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {}
  return {
    google: truthy(c.auth_google_enabled),
    microsoft: truthy(c.auth_microsoft_enabled),
    qr: truthy(c.qr_login_enabled),
  }
}

/** Starts an OAuth sign-in. provider: 'google' | 'azure'. */
export async function signInWithProvider(provider, redirectTo) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectTo || `${window.location.origin}/` },
  })
  if (error) throw error
}

/** Payload encoded into the QR. The phone app parses this prefix. */
export const QR_PREFIX = 'tyrepulse://qr-login'
export function qrPayload(id, secret) {
  return `${QR_PREFIX}?id=${encodeURIComponent(id)}&s=${encodeURIComponent(secret)}`
}

/**
 * -> { ok:true, id, secret, browserSecret, matchCode, expiresAt } | { ok:false, reason }
 * `secret` (scan secret) goes in the QR for the phone. `browserSecret` stays in
 * this page only: status polling and redeem require it, so a photographed QR
 * cannot be redeemed by someone else. `matchCode` is shown for number matching.
 */
export async function startQrLogin() {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null
    const { data, error } = await supabase.rpc('qr_login_start', { p_user_agent: ua })
    if (error || !data) return { ok: false, reason: 'unavailable' }
    if (!data.ok) return { ok: false, reason: data.reason || 'unavailable' }
    if (!data.browser_secret) return { ok: false, reason: 'unavailable' }
    return { ok: true, id: data.id, secret: data.secret, browserSecret: data.browser_secret, matchCode: data.match_code, expiresAt: data.expires_at }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** -> 'pending' | 'approved' | 'denied' | 'expired' | 'consumed' | 'invalid' | 'error' */
export async function pollQrLogin(id, secret) {
  try {
    const { data, error } = await supabase.rpc('qr_login_status', { p_id: id, p_secret: secret })
    if (error || !data) return 'error'
    return data.status || 'error'
  } catch {
    return 'error'
  }
}

/** Exchanges an approved code for a session. Throws a plain-English Error. */
export async function redeemQrLogin(id, secret) {
  const { data, error } = await supabase.functions.invoke('qr-login', { body: { id, secret } })
  if (error || !data?.ok || !data.token_hash) {
    throw new Error('This code could not be used. Generate a new one and scan again.')
  }
  const { error: otpErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' })
  if (otpErr) throw new Error('Sign-in did not complete. Generate a new code and try again.')
}
