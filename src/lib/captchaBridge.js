/**
 * Pure helpers for the public /captcha-bridge page, which lets the installed Expo app
 * (no in-app web view) pass a Cloudflare Turnstile check in the phone's own browser.
 *
 * Security rules:
 * - The return link is FIXED to the app's own scheme and path. Nothing in the page URL
 *   can change where the token is sent, so the page is not an open redirect.
 * - `state` is a random value the app generated; the page only echoes it back. It must
 *   look like a random token (16-128 URL-safe characters) or the page refuses.
 * - A Turnstile token is single use and expires after about 5 minutes; the app checks
 *   the state, the age and single use on its side.
 */
export const APP_RETURN_BASE = 'tyrepulse-inspector://captcha'

const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/
const TOKEN_RE = /^[A-Za-z0-9._-]{10,4096}$/

export function readBridgeParams(search) {
  const q = new URLSearchParams(search || '')
  const state = q.get('state') || ''
  const lang = q.get('lang') === 'ar' ? 'ar' : 'en'
  return { state: STATE_RE.test(state) ? state : null, lang }
}

/** The only link the page ever produces. Null when either part is not acceptable. */
export function buildReturnLink(state, token) {
  if (!STATE_RE.test(state || '') || !TOKEN_RE.test(token || '')) return null
  return `${APP_RETURN_BASE}?state=${encodeURIComponent(state)}&token=${encodeURIComponent(token)}`
}

export const BRIDGE_TEXT = {
  en: {
    title: 'Security check',
    lead: 'Complete the check below, then tap the button to go back to the Tyre Pulse app.',
    back: 'Return to Tyre Pulse',
    invalid: 'This link is not valid. Go back to the Tyre Pulse app and tap Sign in again.',
    off: 'The security check is not switched on. Go back to the app and sign in normally.',
    expired: 'The check expired. Complete it again.',
    loading: 'Loading the security check...',
  },
  ar: {
    title: 'التحقق الأمني',
    lead: 'أكمل التحقق أدناه، ثم اضغط الزر للعودة إلى تطبيق Tyre Pulse.',
    back: 'العودة إلى Tyre Pulse',
    invalid: 'هذا الرابط غير صالح. ارجع إلى تطبيق Tyre Pulse واضغط تسجيل الدخول مرة أخرى.',
    off: 'التحقق الأمني غير مفعّل. ارجع إلى التطبيق وسجّل الدخول بشكل عادي.',
    expired: 'انتهت صلاحية التحقق. أكمله مرة أخرى.',
    loading: 'جارٍ تحميل التحقق الأمني...',
  },
}
