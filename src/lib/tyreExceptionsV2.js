/**
 * tyreExceptionsV2.js - pure shaping of public.get_tyre_exceptions_v2().
 *
 * Every outstanding tyre data problem as one reviewable exception. The
 * database decides WHAT is an exception (migration 20261110113000); this file
 * only labels, groups and shapes it for the page and the Excel export. Nothing
 * here changes data, and every proposed correction is text for a person.
 *
 * Exception key: kind|... built from record ids or the (country, serial) a
 * group is about. MIRROR of the SQL in _tyre_exception_rows / get_tyre_exceptions_v2
 * (see exceptionKey below) - change both.
 */

/** Kinds in the order the page lists them, with the rule each one enforces. */
export const EXCEPTION_KINDS = Object.freeze([
  { kind: 'invalid_serial', label: 'Invalid physical serial', group: 'Identity', rule: 'T6: an active fitment must carry a real serial (no blank, placeholder, size, month code or remark in the cell).' },
  { kind: 'duplicate_active', label: 'Duplicate active tyre', group: 'Identity', rule: 'T3/T5: one real serial is active on one wheel only.' },
  { kind: 'uncertain_previous_tyre', label: 'Uncertain previous tyre', group: 'Identity', rule: 'Same serial recorded as both the tyre removed and the tyre fitted at the same change.' },
  { kind: 'rotation_not_closed', label: 'Rotation not closed', group: 'Identity', rule: 'A tyre moved to another wheel of the same vehicle but its earlier wheel is still open (rotation closer, dry run only).' },
  { kind: 'overlapping_fitment', label: 'Overlapping fitment', group: 'Identity', rule: 'T18: a fitment starts before an earlier fitment of the same tyre ended; its km is not counted.' },
  { kind: 'missing_readings', label: 'Missing fitment or removal reading', group: 'Readings', rule: 'A fitment needs an odometer or hour reading; a removal needs one too.' },
  { kind: 'invalid_reading', label: 'Invalid km or hour reading', group: 'Readings', rule: 'T7: placeholder 1, life over the class limit, removal below fitment, or a meter reset.' },
  { kind: 'conflicting_dates', label: 'Conflicting replacement dates', group: 'Readings', rule: 'Removal before fitment, a future date, or removal after the next tyre was fitted on the same wheel.' },
  { kind: 'missing_site', label: 'Missing historical site', group: 'Readings', rule: 'Every fitment needs the site it happened at for site reporting.' },
  { kind: 'price_missing', label: 'Missing purchase price', group: 'Cost', rule: 'T17: a physical tyre with no priced fitment has MISSING cost.' },
  { kind: 'price_incorrect', label: 'Price far from usual', group: 'Cost', rule: 'A price more than 3 times above or below the usual price for that size and country.' },
  { kind: 'price_assigned_twice', label: 'Price assigned more than once', group: 'Cost', rule: 'T1/T2: one physical tyre is bought once.' },
  { kind: 'unlinked_repair_retread', label: 'Unlinked repair or retread cost', group: 'Cost', rule: 'A tyre repair or retread expense line carries no serial, so no tyre carries the cost.' },
  { kind: 'duplicate_expense', label: 'Duplicate expense event', group: 'Cost', rule: 'T11: the same tyre expense line recorded more than once.' },
])

export const KIND_BY_ID = Object.freeze(Object.fromEntries(EXCEPTION_KINDS.map((k) => [k.kind, k])))

export const REVIEW_STATUSES = Object.freeze(['open', 'accepted', 'rejected', 'deferred'])
export const REVIEW_STATUS_LABEL = Object.freeze({
  open: 'Open', accepted: 'Accepted', rejected: 'Rejected', deferred: 'Deferred',
})

/** Roles allowed to record a review (the server re-checks; this only hides buttons). */
export const REVIEW_ROLES = Object.freeze(['Admin', 'Manager', 'Director'])

export function kindLabel(kind) {
  return KIND_BY_ID[kind]?.label || 'Other'
}

/** A number, or null when the value is missing. Number(null) is 0 - never let that through. */
export function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const norm = (v) => String(v ?? '').trim().toUpperCase()
const asset = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase()

/**
 * Stable exception key. MIRROR of the SQL - change both.
 *   record kinds:   kind|<record id>   (invalid_reading meter resets: invalid_reading|reset|<id>)
 *   serial groups:  kind|<COUNTRY>|<SERIAL>
 *   pairs:          uncertain_previous_tyre|<old id>|<new id>
 *   rotations:      rotation_not_closed|<COUNTRY>|<ASSET>|<SERIAL>|<FROM POSITION>
 *   expense copies: duplicate_expense|<first id>|<copies>
 */
export function exceptionKey(kind, parts = {}) {
  switch (kind) {
    case 'duplicate_active':
    case 'price_assigned_twice':
    case 'price_missing':
      return `${kind}|${norm(parts.country)}|${norm(parts.serial)}`
    case 'uncertain_previous_tyre':
      return `${kind}|${parts.oldId}|${parts.newId}`
    case 'rotation_not_closed':
      return `${kind}|${norm(parts.country)}|${asset(parts.asset)}|${norm(parts.serial)}|${String(parts.fromPosition ?? '')}`
    case 'duplicate_expense':
      return `${kind}|${parts.firstId}|${parts.copies}`
    case 'invalid_reading':
      return parts.reset ? `${kind}|reset|${parts.id}` : `${kind}|${parts.id}`
    default:
      return `${kind}|${parts.id}`
  }
}

/** The kind a key belongs to (its first segment); '' for anything else. */
export function kindOfKey(key) {
  const k = String(key ?? '').split('|')[0]
  return KIND_BY_ID[k] ? k : ''
}

/**
 * Counts per kind across countries. Missing kinds are listed with 0 because
 * the server enumerates every kind it checked; `null` only when the payload
 * itself is missing (we could not look).
 */
export function shapeCounts(counts) {
  if (!Array.isArray(counts)) return null
  const out = {}
  for (const k of EXCEPTION_KINDS) {
    out[k.kind] = { kind: k.kind, label: k.label, group: k.group, total: 0, open: 0, accepted: 0, rejected: 0, deferred: 0, protected: 0, byCountry: {} }
  }
  for (const c of counts) {
    const slot = out[c?.kind]
    if (!slot) continue
    const n = num(c.n) ?? 0
    slot.total += n
    for (const s of ['open', 'accepted', 'rejected', 'deferred', 'protected']) slot[s] += num(c[s]) ?? 0
    const country = c.country || 'Unknown'
    slot.byCountry[country] = (slot.byCountry[country] ?? 0) + n
  }
  return out
}

/** Grand totals of a shaped count map. */
export function countTotals(shaped) {
  if (!shaped) return null
  const t = { total: 0, open: 0, accepted: 0, rejected: 0, deferred: 0, protected: 0 }
  for (const s of Object.values(shaped)) for (const k of Object.keys(t)) t[k] += s[k]
  return t
}

/** Normalise one server row for display. */
export function shapeRow(r) {
  if (!r || typeof r !== 'object') return null
  const status = REVIEW_STATUSES.includes(r.status) ? r.status : 'open'
  return {
    key: String(r.exception_key ?? ''),
    kind: r.kind,
    kindLabel: kindLabel(r.kind),
    country: r.country || '',
    currency: r.currency || '',
    recordIds: Array.isArray(r.record_ids) ? r.record_ids : [],
    serial: r.serial || '',
    asset: r.asset || '',
    position: r.tyre_position || '',
    reason: r.reason || '',
    proposed: r.proposed || '',
    impactKm: num(r.impact_km),
    impactCost: num(r.impact_cost),
    detail: r.detail && typeof r.detail === 'object' ? r.detail : {},
    status,
    statusLabel: REVIEW_STATUS_LABEL[status],
    note: r.note || '',
    reviewedBy: r.reviewed_by_name || '',
    reviewedAt: r.reviewed_at || null,
    protected: r.protected === true,
  }
}

export function shapeRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(shapeRow).filter(Boolean)
}

/** "1,234 km" / "766 SAR" / "N/A". Currency is the row's own; never blended. */
export function impactLabel(row) {
  const parts = []
  if (row?.impactKm != null) parts.push(`${Math.round(row.impactKm).toLocaleString('en-US')} km`)
  if (row?.impactCost != null) {
    const v = row.impactCost.toLocaleString('en-US', { maximumFractionDigits: 2 })
    parts.push(row.currency ? `${v} ${row.currency}` : v)
  }
  return parts.length ? parts.join(' / ') : 'N/A'
}

/** May this user record a review? Super admin or an elevated role. */
export function canReviewExceptions({ role, isSuperAdmin } = {}) {
  if (isSuperAdmin) return true
  return REVIEW_ROLES.includes(String(role || ''))
}

/** Can THIS row be reviewed (protected rows stay open until the owner decides)? */
export function rowReviewable(row, user) {
  return Boolean(row && !row.protected && canReviewExceptions(user))
}

/** Rows for Excel. Values stay as values (km and cost numbers, null as blank). */
export const EXPORT_COLUMNS = Object.freeze([
  ['kindLabel', 'Exception'], ['country', 'Country'], ['asset', 'Asset'], ['serial', 'Serial'], ['position', 'Position'],
  ['reason', 'Reason'], ['proposed', 'Proposed correction (not applied)'], ['impactKm', 'Impact km'],
  ['impactCost', 'Impact cost'], ['currency', 'Currency'], ['statusLabel', 'Review status'], ['note', 'Review note'],
  ['reviewedBy', 'Reviewed by'], ['reviewedAt', 'Reviewed at'], ['protectedLabel', 'Protected'], ['records', 'Record ids'], ['key', 'Exception key'],
])

export function exportRows(rows) {
  return (rows || []).map((r) => ({
    ...r,
    protectedLabel: r.protected ? 'Yes, owner decision needed' : '',
    records: (r.recordIds || []).join(' '),
    impactKm: r.impactKm ?? '',
    impactCost: r.impactCost ?? '',
    reviewedAt: r.reviewedAt || '',
  }))
}
