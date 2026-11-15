/**
 * Sign-in identifier rules shared by the login and invitation pages.
 *
 * A person signs in with an email, a username, an employee id, or - for a
 * company other than the original one - "<company code>/<username>". The
 * server does the real resolution (public._resolve_sign_in_profile behind
 * get_email_by_identifier and resolve_sign_in_user): a bare name is looked up
 * first, so today's users keep signing in exactly as before, and only then is
 * the text split on the first slash. This module only tidies what the person
 * typed so the same account is always asked for in the same spelling (the
 * lockout counter is keyed on that text). It never decides who someone is.
 *
 * MIRRORS public._split_sign_in_identifier: a backslash counts as a slash, the
 * code is the part before the FIRST slash, both parts are trimmed, and a slash
 * at the very start does not make a code.
 */

/** Domain of the made-up sign-in addresses (never a real mailbox). */
export const SIGN_IN_EMAIL_DOMAIN = 'users.tyrepulse.app'

/** Same shape the database accepts for a company code (admin_set_org_sign_in_code). */
const COMPANY_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,23}$/

/**
 * Tidy a typed identifier. Emails pass through trimmed. Otherwise a backslash
 * becomes a slash and spaces around the first slash are removed, so
 * "ACME \ ali" and "ACME/ali" ask for the same account.
 */
export function normalizeSignInIdentifier(raw) {
  const v = String(raw ?? '').trim()
  if (!v || v.includes('@')) return v
  const s = v.replace(/\\/g, '/')
  const at = s.indexOf('/')
  if (at <= 0) return s
  const code = s.slice(0, at).trim()
  const name = s.slice(at + 1).trim()
  if (!code) return name
  return name ? `${code}/${name}` : `${code}/`
}

/**
 * Split an identifier into { companyCode, name }. companyCode is null when the
 * text names no company (no slash, a leading slash, or an email).
 */
export function splitSignInIdentifier(raw) {
  const v = String(raw ?? '').trim()
  if (!v) return { companyCode: null, name: null }
  if (v.includes('@')) return { companyCode: null, name: v }
  const s = v.replace(/\\/g, '/')
  const at = s.indexOf('/')
  if (at <= 0) return { companyCode: null, name: s.replace(/^\/+/, '').trim() || null }
  const code = s.slice(0, at).trim() || null
  const name = s.slice(at + 1).trim() || null
  return { companyCode: code, name }
}

/** True when the identifier carries a company code ("code/name"). */
export function hasCompanyCode(raw) {
  const { companyCode, name } = splitSignInIdentifier(raw)
  return Boolean(companyCode && name)
}

/** True when the text is a valid company code shape. */
export function isValidCompanyCode(code) {
  return COMPANY_CODE_RE.test(String(code ?? '').trim())
}

/** Lower-case, dot-separated slug used in a made-up address. */
export function signInSlug(value, fallback = 'user') {
  const s = String(value ?? '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/(^\.+|\.+$)/g, '')
  return s || fallback
}

/**
 * The made-up sign-in address for a new account. Today's sign-up keeps
 * "<username>@users.tyrepulse.app". A person joining through an invitation to
 * a company with a code gets "<username>+<code>@users.tyrepulse.app", so two
 * companies can later hold the same username without the address colliding.
 * The person never sees or types this address.
 */
export function syntheticSignInEmail(username, companyCode = null) {
  const user = signInSlug(username)
  const code = companyCode ? signInSlug(companyCode, '') : ''
  return code ? `${user}+${code}@${SIGN_IN_EMAIL_DOMAIN}` : `${user}@${SIGN_IN_EMAIL_DOMAIN}`
}
