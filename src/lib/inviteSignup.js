/**
 * Pure rules for signing up through a company invitation (/invite/:token).
 *
 * The server does the trust work: _signup_context (inside handle_new_user)
 * re-reads the invitation by the token's hash, checks it is unused, unexpired,
 * for this email (when it names one) and for an active company, and only then
 * places the account in that company, approved, with the invited role. This
 * module only shapes the request; it cannot grant anything.
 */
import { syntheticSignInEmail, isValidCompanyCode } from './signInIdentifier'

export const USERNAME_RE = /^[a-zA-Z0-9._-]+$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Minimum password length: the configured value, never below the old 6 floor. */
export function minPasswordLength(cfg) {
  return Math.max(6, parseInt(cfg?.password_min_length, 10) || 8)
}

/**
 * Check the form. Returns null when it is fine, else the i18n key (under
 * auth.invite) of the first problem, plus any interpolation values.
 */
export function validateInviteForm(form, { emailRequired = false, minLen = 8 } = {}) {
  const username = String(form?.username ?? '').trim()
  if (username.length < 3 || !USERNAME_RE.test(username)) return { key: 'errUsername' }
  if (emailRequired && !EMAIL_RE.test(String(form?.email ?? '').trim())) return { key: 'errEmail' }
  const pw = String(form?.password ?? '')
  if (pw.length < minLen) return { key: 'errPassword', vars: { min: minLen } }
  if (pw !== String(form?.confirm ?? '')) return { key: 'errMismatch' }
  return null
}

/** The company code from a preview, only when it is a usable code. */
export function previewCompanyCode(preview) {
  const code = String(preview?.company_code ?? '').trim()
  return code && isValidCompanyCode(code) ? code : null
}

/**
 * What the person will type to sign in afterwards. With a company code that is
 * "<code>/<username>", which always resolves inside the right company; a bare
 * username also keeps working while usernames are unique across companies.
 */
export function signInIdFor(username, preview) {
  const name = String(username ?? '').trim()
  const code = previewCompanyCode(preview)
  return code ? `${code}/${name}` : name
}

/**
 * Build the supabase.auth.signUp argument. An invitation that names an email
 * must be accepted by that exact address (the server compares it), so the
 * real email is used; otherwise a made-up address that carries the company
 * code, so a later username shared by two companies never collides.
 */
export function buildInviteSignUp({ token, preview, form, captchaToken = null }) {
  const username = String(form?.username ?? '').trim()
  const code = previewCompanyCode(preview)
  const email = preview?.email_required
    ? String(form?.email ?? '').trim().toLowerCase()
    : syntheticSignInEmail(username, code)
  const data = {
    username,
    full_name: String(form?.fullName ?? '').trim() || null,
    employee_id: String(form?.employeeId ?? '').trim() || null,
    invite_token: String(token ?? '').trim(),
  }
  if (code) data.company_code = code
  return {
    email,
    password: String(form?.password ?? ''),
    options: { data, ...(captchaToken ? { captchaToken } : {}) },
  }
}

/**
 * Did the sign-up actually land in the invited company?
 *
 * Production's _signup_context (before TEN-9e) does not abort a sign-up whose
 * invitation no longer holds: it creates the account with no company and no
 * approval, so a plain "success" from GoTrue proves nothing. Two signals, best
 * first:
 *   profile      - the new account's own row (only readable when signUp
 *                  returned a session): joined = company set AND approved.
 *   previewAfter - get_invitation_preview read again after the sign-up: an
 *                  invitation this person just used reads 'used'; one that
 *                  still reads ok (or cancelled / expired) was not applied.
 * Returns true, false, or null when neither signal could be read (the page then
 * trusts the sign-up; the login screen still refuses an unapproved account).
 */
export function inviteJoined({ profile = undefined, previewAfter = undefined } = {}) {
  if (profile && typeof profile === 'object') return Boolean(profile.org_id && profile.approved === true)
  if (previewAfter && typeof previewAfter === 'object') {
    if (previewAfter.ok === true) return false
    if (previewAfter.reason === 'used') return true
    if (['invalid', 'revoked', 'expired', 'unavailable'].includes(previewAfter.reason)) return false
  }
  return null
}

/**
 * After a REFUSED sign-up (TEN-9e aborts it, GoTrue answers "Database error
 * saving new user"), say why from a fresh preview instead of guessing "the
 * username is taken". Returns { preview } to show the invalid-link screen, or
 * { key } for an inline error.
 */
export function explainSignUpRefusal(err, previewAfter, { emailRequired = false } = {}) {
  if (previewAfter && previewAfter.ok === false && previewAfter.reason && previewAfter.reason !== 'error') {
    return { preview: previewAfter }
  }
  const key = inviteSignUpErrorKey(err)
  if (key === 'errTaken' && emailRequired && previewAfter?.ok === true
      && /database error/i.test(String(err?.message || ''))) {
    return { key: 'errTakenOrEmail' }
  }
  return { key }
}

/** Map a sign-up error to an i18n key under auth.invite. */
export function inviteSignUpErrorKey(err) {
  const msg = String(err?.message || '')
  if (err?.code === 'weak_password' || /weak|pwned|leaked|easy to guess|compromised/i.test(msg)) return 'errWeak'
  if (err?.status === 429 || err?.code === 'over_request_rate_limit') return 'errRateLimited'
  if (/already registered|already been registered|duplicate|already exists|database error/i.test(msg)) return 'errTaken'
  return 'errFailed'
}
