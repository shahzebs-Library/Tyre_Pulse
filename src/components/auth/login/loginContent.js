/**
 * Helpers for the sign-in page: the marketing link, the live-figure
 * formatter and the remembered-identifier store.
 */
/** The public marketing site. Nav and contact links point here. */
export const MARKETING_URL = 'https://tyre-pulse-eezl.vercel.app'

/** Exact count with thousands separators, or null when not measured. */
export function formatCount(n, locale = 'en') {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(Number(n))
  } catch {
    return String(n)
  }
}

export const REMEMBER_KEY = 'tp_login_remember_id'

export function readRememberedId() {
  try { return localStorage.getItem(REMEMBER_KEY) || '' } catch { return '' }
}

export function writeRememberedId(value) {
  try {
    if (value) localStorage.setItem(REMEMBER_KEY, value)
    else localStorage.removeItem(REMEMBER_KEY)
  } catch { /* storage unavailable: remembering is a convenience only */ }
}
