// One definition of "how a person who signed something is named on a document".
//
// The defect this closes: the inspection PDF (and the on-screen sign-off) printed
// a raw LOGIN EMAIL (ws123na@gmail.com) or a raw user UUID for the inspector /
// approver, because the fallback chain reached `approver_email` or `approved_by`
// when no resolved name was present. A login email is a credential, not an
// identity, and a UUID is noise. The owner wants the signer shown as
// "Full Name (EMP-ID)" everywhere, so there is exactly one function that decides
// it and every signer render goes through it.
//
// RULES (pinned by signerDisplay.test.js):
//   - name + employee id  -> "Full Name (EMP-ID)"
//   - name only           -> "Full Name"
//   - username only       -> "username"      (+ employee id when present)
//   - email is NEVER the primary identity, and a raw email is never shown
//   - a UUID is NEVER shown (not as a name, not as a fallback)
//   - nothing usable      -> the fallback ("Not recorded" by default)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A deliberately loose UUID guard too, so a value like "11111111-2222-4333-8444-555555555555"
// (8 hex, then any hex/hyphen run) can never slip through as a "name".
const UUID_LOOSE_RE = /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clean(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function isUuid(v) {
  const s = clean(v)
  return s !== '' && (UUID_RE.test(s) || UUID_LOOSE_RE.test(s))
}

function isEmail(v) {
  return EMAIL_RE.test(clean(v))
}

/** A value is a usable display name only if it is not blank, not an email and not a UUID. */
function usableName(v) {
  const s = clean(v)
  if (!s) return ''
  if (isEmail(s) || isUuid(s)) return ''
  return s
}

/**
 * Render a signer as "Full Name (EMP-ID)".
 *
 * @param {object} p            a profile-shaped object. Any of: full_name, name,
 *                              employee_id, username, email, id. `name` is the
 *                              free-text signer column (inspections.inspector,
 *                              checklist approver_name); `email`/`id` are accepted
 *                              so a caller can pass the whole row, and are never
 *                              rendered.
 * @param {object} [opts]
 * @param {string|null} [opts.fallback='Not recorded']  returned when nothing is
 *                              usable. Pass null when the caller renders its own
 *                              placeholder (e.g. a signature box that says
 *                              "Pending").
 * @returns {string|null}
 */
export function signerDisplay(p, { fallback = 'Not recorded' } = {}) {
  const src = p && typeof p === 'object' ? p : {}
  const empid = clean(src.employee_id)
  // Prefer a real full name, then a non-email/non-uuid free-text name.
  const named = usableName(src.full_name) || usableName(src.name)
  if (named) return empid ? `${named} (${empid})` : named
  // A username is an acceptable, non-sensitive last identity. It must not be an
  // email or a uuid either.
  const uname = usableName(src.username)
  if (uname) return empid ? `${uname} (${empid})` : uname
  // Deliberately NOT src.email and NOT src.id - a login email is a credential and
  // a uuid is not a person.
  return fallback
}

export default signerDisplay
