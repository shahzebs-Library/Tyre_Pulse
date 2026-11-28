/**
 * Fleet "Verify on site" - pure rules (no I/O).
 *
 * MIRRORS the SQL in supabase/migrations/20261127180000_fleet_onsite_verification.sql
 * (normalize_plate / plate_key / normalize_chassis / chassis_has_invalid_vin_chars
 * and the classification inside submit_fleet_verification) and the Flutter copy in
 * tyre_pulse_flutter/lib/features/fleet_verification/domain/fleet_verification_rules.dart.
 * Change all three together.
 *
 * The server is the authority: previewVerification() only tells the supervisor,
 * before they submit, what will be filled now and what will wait for a manager.
 */

export const OUTCOMES = ['present', 'not_found', 'other_country']

/** Roles (app_role() spelling) that may submit. Admin and super admin also may. */
export const VERIFIER_ROLES = ['admin', 'fleet_supervisor', 'fleet_incharge']
/** Roles that may approve or reject a pending verification. */
export const APPROVER_ROLES = ['admin', 'manager']

const CYRILLIC_FROM = 'АВЕКМНОРСТХУІЈ'
const LATIN_TO = 'ABEKMHOPCTXYIJ'

/** app_role(): lower case, spaces to underscores. */
export function roleKey(role) {
  return String(role ?? 'reporter').toLowerCase().replace(/ /g, '_')
}

export function canVerify({ role, isSuperAdmin } = {}) {
  return Boolean(isSuperAdmin) || VERIFIER_ROLES.includes(roleKey(role))
}

export function canApprove({ role, isSuperAdmin } = {}) {
  return Boolean(isSuperAdmin) || APPROVER_ROLES.includes(roleKey(role))
}

/** Plate for display: upper case, whitespace runs collapsed, trimmed; null when blank. */
export function normalizePlate(v) {
  const s = String(v ?? '').toUpperCase().replace(/\s+/g, ' ').trim()
  return s || null
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'
const ASCII_DIGITS = '01234567890123456789'

/** Plate for comparison: spaces removed, Arabic-Indic digits folded, never reordered. */
export function plateKey(v) {
  let s = ''
  for (const ch of String(v ?? '').toUpperCase().replace(/\s+/g, '')) {
    const i = ARABIC_INDIC.indexOf(ch)
    s += i >= 0 ? ASCII_DIGITS[i] : ch
  }
  return s || null
}

/** Flags that make a submission doubtful: nothing is filled, all of it waits. */
export const BLOCKING_FLAGS = ['asset_code_mismatch', 'chassis_invalid_chars', 'duplicate_plate', 'duplicate_chassis']

/** Chassis: upper, spaces/dashes/dots removed, Cyrillic lookalikes to Latin. */
export function normalizeChassis(v) {
  let s = String(v ?? '').toUpperCase().replace(/[\s\-.]+/g, '')
  let out = ''
  for (const ch of s) {
    const i = CYRILLIC_FROM.indexOf(ch)
    out += i >= 0 ? LATIN_TO[i] : ch
  }
  s = out
  return s || null
}

/** A real VIN never contains I, O or Q. A flag, never a refusal. */
export function chassisHasInvalidVinChars(v) {
  const s = normalizeChassis(v)
  return s ? /[IOQ]/.test(s) : false
}

/** Asset code for comparison: upper case, no whitespace. */
export function assetKey(v) {
  const s = String(v ?? '').toUpperCase().replace(/\s+/g, '')
  return s || null
}

/** One storage path segment: [A-Za-z0-9_-] only (same rule as vehicle360.pathSegment). */
function segment(v, fallback) {
  const s = String(v ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '')
  return s || fallback
}

/** `<org>/<COUNTRY>/<ASSET>/verify/<verificationId>.<ext>` - unique per verification. */
export function verificationPhotoPath({ orgId, country, assetNo, verificationId, ext = 'jpg' }) {
  return [
    segment(orgId, 'no-org').toLowerCase(),
    segment(country, 'NO-COUNTRY').toUpperCase(),
    segment(assetNo, 'NO-ASSET').toUpperCase(),
    'verify',
    `${segment(verificationId, 'no-id').toLowerCase()}.${segment(ext, 'jpg').toLowerCase()}`,
  ].join('/')
}

/**
 * What submit_fleet_verification will do with this input.
 * `others` = other machines in the same company and country ({id, registration_no, chassis_no}).
 * Returns { status, flags, applyNow } where applyNow lists the columns filled at once.
 */
export function previewVerification({ vehicle = {}, outcome, observedAssetNo, observedPlate, observedChassis, hasPhoto = false, others = [] } = {}) {
  if (!OUTCOMES.includes(outcome)) return { status: 'invalid', flags: ['unknown_outcome'], applyNow: [] }
  if (outcome !== 'present') return { status: 'pending', flags: [outcome], applyNow: [] }

  const flags = []
  const applyNow = []
  const plate = normalizePlate(observedPlate)
  const chassis = normalizeChassis(observedChassis)
  const obsAsset = assetKey(observedAssetNo)

  if (obsAsset && obsAsset !== assetKey(vehicle.asset_no)) flags.push('asset_code_mismatch')
  if (chassis && chassisHasInvalidVinChars(chassis)) flags.push('chassis_invalid_chars')

  const rest = others.filter((o) => o && o.id !== vehicle.id)
  const dupPlate = Boolean(plate) && rest.some((o) => plateKey(o.registration_no) === plateKey(plate))
  const dupChassis = Boolean(chassis) && rest.some((o) => normalizeChassis(o.chassis_no) === chassis)

  if (plate) {
    if (dupPlate) flags.push('duplicate_plate')
    const onFile = plateKey(vehicle.registration_no)
    if (onFile && onFile !== plateKey(plate)) flags.push('plate_changed')
  }
  if (chassis) {
    if (dupChassis) flags.push('duplicate_chassis')
    const onFile = normalizeChassis(vehicle.chassis_no)
    if (onFile && onFile !== chassis) flags.push('chassis_changed')
  }

  const status = flags.length === 0 ? 'auto_applied' : 'pending'
  if (flags.some((f) => BLOCKING_FLAGS.includes(f))) return { status, flags, applyNow }
  if (plate && !plateKey(vehicle.registration_no)) applyNow.push('registration_no')
  if (chassis && !normalizeChassis(vehicle.chassis_no)) applyNow.push('chassis_no')
  if (status === 'auto_applied' && hasPhoto) applyNow.push('image_path')
  return { status, flags, applyNow }
}

/** Progress over a register: { verified, total, pending, pct } (pct null when empty). */
export function verificationProgress(rows = []) {
  const total = rows.length
  let verified = 0
  let pending = 0
  for (const r of rows) {
    const s = r?.verification_status
    if (s === 'verified') verified += 1
    else if (s === 'pending') pending += 1
  }
  return { verified, pending, total, pct: total ? Math.round((verified / total) * 100) : null }
}

/** Badge tone + i18n key for a vehicle's verification state. */
export function verificationBadge(status) {
  switch (status) {
    case 'verified': return { tone: 'good', key: 'fleetVerification.status.verified' }
    case 'pending': return { tone: 'warning', key: 'fleetVerification.status.pending' }
    case 'not_found': return { tone: 'danger', key: 'fleetVerification.status.notFound' }
    case 'other_country': return { tone: 'info', key: 'fleetVerification.status.otherCountry' }
    case 'rejected': return { tone: 'danger', key: 'fleetVerification.status.rejected' }
    default: return { tone: 'quiet', key: 'fleetVerification.status.never' }
  }
}
