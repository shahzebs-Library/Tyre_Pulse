/**
 * Pure per-step requirement helpers for the Universal Approval & Workflow
 * Engine. Normalizes a workflow step object's requirement flags and computes
 * which required captures a given act payload is missing.
 *
 * This mirrors the server-side enforcement in
 * MIGRATIONS_V117_WORKFLOW_ACTIONS.sql (`workflow_act`). The server is the
 * security boundary; these helpers drive the client UI (enable/disable the
 * Approve button, show which captures are still needed) and must stay in sync.
 *
 * No imports, no side effects — trivially unit-testable.
 */

/**
 * @typedef {Object} NormalizedRequirements
 * @property {boolean} requireSignature
 * @property {boolean} requirePhoto
 * @property {boolean} requireGps
 * @property {boolean} requireCommentOnReturn
 * @property {boolean} allowReturn   defaults true when unset
 * @property {boolean} optional
 */

/** Coerce a jsonb boolean-ish flag to a strict boolean. */
function bool(v, fallback = false) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true
  if (v === false || v === 'false' || v === 0 || v === '0') return false
  return fallback
}

/**
 * Normalize a step object's requirement flags into a stable, camelCase shape.
 * Unknown / missing flags default to false, except `allowReturn` which
 * defaults to true (matching the server default).
 * @param {object|null|undefined} step
 * @returns {NormalizedRequirements}
 */
export function stepRequirements(step) {
  const s = step && typeof step === 'object' ? step : {}
  return {
    requireSignature: bool(s.require_signature),
    requirePhoto: bool(s.require_photo),
    requireGps: bool(s.require_gps),
    requireCommentOnReturn: bool(s.require_comment_on_return),
    allowReturn: bool(s.allow_return, true),
    optional: bool(s.optional),
  }
}

/**
 * True when the payload has a non-empty signature data URL.
 * @param {object} payload
 */
function hasSignature(payload) {
  const sig = payload ? payload.signature ?? payload.signatureData : undefined
  return typeof sig === 'string' && sig.trim() !== ''
}

/** True when the payload has at least one photo URL. */
function hasPhoto(payload) {
  const photos = payload ? payload.photos ?? payload.photoUrls : undefined
  return Array.isArray(photos) && photos.length > 0
}

/** True when the payload carries a usable GPS fix ({lat, lng}). */
function hasGps(payload) {
  const gps = payload ? payload.gps : undefined
  return (
    !!gps &&
    typeof gps === 'object' &&
    gps.lat !== undefined &&
    gps.lat !== null &&
    gps.lng !== undefined &&
    gps.lng !== null
  )
}

/** True when the payload has a non-empty comment. */
function hasComment(payload) {
  const c = payload ? payload.comment : undefined
  return typeof c === 'string' && c.trim() !== ''
}

/**
 * Given a step and an act payload, return the list of required capture keys
 * that are still missing. Returns an empty array when the payload satisfies
 * every requirement for the given action.
 *
 * For `action === 'return'` the only requirement checked is a comment when the
 * step sets `require_comment_on_return` (or unconditionally — the server always
 * requires a comment to return; we surface that here too).
 *
 * @param {object|null|undefined} step
 * @param {object} [payload] { signature|signatureData, photos|photoUrls, gps, comment }
 * @param {'approve'|'reject'|'return'} [action='approve']
 * @returns {string[]} missing keys, e.g. ['signature','photo','gps','comment']
 */
export function missingRequirements(step, payload = {}, action = 'approve') {
  const req = stepRequirements(step)
  const missing = []

  if (action === 'return') {
    // The engine always requires a comment to return for correction.
    if (!hasComment(payload)) missing.push('comment')
    return missing
  }

  if (action === 'reject') {
    // Reject has no mandatory captures server-side.
    return missing
  }

  // approve
  if (req.requireSignature && !hasSignature(payload)) missing.push('signature')
  if (req.requirePhoto && !hasPhoto(payload)) missing.push('photo')
  if (req.requireGps && !hasGps(payload)) missing.push('gps')

  return missing
}

/**
 * Convenience: can the given payload satisfy an approve for this step?
 * @param {object} step
 * @param {object} payload
 * @param {'approve'|'reject'|'return'} [action]
 * @returns {boolean}
 */
export function canAct(step, payload, action = 'approve') {
  return missingRequirements(step, payload, action).length === 0
}
