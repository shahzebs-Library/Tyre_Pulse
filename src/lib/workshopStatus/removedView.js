/**
 * Workshop Status -> Released / Closed view engine (Loop 11). Pure: no I/O.
 *
 * A vehicle that leaves the daily Excel report is RELEASED from the workshop
 * (owner rule). Its record stays: current_active = false, with the upload that
 * removed it and why. From here a person records the final disposition,
 * restores it (it was omitted by mistake), archives it, or deletes a wrong /
 * duplicate entry. The server (workshop_status_record_action, migration
 * 20261007130000) decides every action; this module only shapes the list and
 * offers the actions the caller's permissions allow.
 */

/**
 * Final dispositions, in display order. MIRROR of the SQL check on
 * workshop_status_records.final_disposition and the list inside
 * workshop_status_record_action. CHANGE ALL THREE TOGETHER (a test parses the
 * migration).
 */
export const DISPOSITIONS = Object.freeze([
  'repair_completed', 'returned_to_operation', 'transferred_site', 'sent_external_workshop',
  'vehicle_sold', 'vehicle_scrapped', 'wrong_entry', 'duplicate_entry', 'other',
])
export const DISPOSITION_OTHER = 'other'

/** Why the upload took the vehicle off the report (removed_reason). */
export const REMOVAL_REASONS = Object.freeze(['missing_from_upload', 'listed_as_closed'])

/** Row status on this screen. */
export const REMOVED_STATUS = Object.freeze({
  RELEASED: 'released',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
})
export const STATUS_ORDER = Object.freeze([REMOVED_STATUS.RELEASED, REMOVED_STATUS.ARCHIVED, REMOVED_STATUS.DELETED])

/** Minimum reason length, same as the server. */
export const MIN_REASON = 5

/** Every action and the permission it needs (mirror of the SQL map). */
export const ACTION_PERMISSION = Object.freeze({
  disposition: 'disposition',
  restore: 'restore',
  archive: 'archive',
  unarchive: 'archive',
  soft_delete: 'soft_delete',
  undelete: 'soft_delete',
  permanent_delete: 'permanent_delete',
})

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

export function removedStatus(r) {
  if (!r) return null
  if (!blank(r.deleted_at)) return REMOVED_STATUS.DELETED
  if (!blank(r.archived_at)) return REMOVED_STATUS.ARCHIVED
  return REMOVED_STATUS.RELEASED
}

/** A reason the server will accept (null-safe, trimmed). */
export function reasonValid(text) {
  return typeof text === 'string' && text.trim().length >= MIN_REASON
}

/** True when the action needs a typed reason (everything but disposition). */
export function needsReason(action) {
  return action !== 'disposition'
}

/**
 * Actions offered for a row, in display order. Mirrors the server's state
 * rules exactly so a button is never offered that the server would refuse
 * for state; the permission is also checked server-side regardless.
 */
export function availableActions(r, permissions) {
  if (!r || r.current_active) return []
  const can = (a) => permissions?.[ACTION_PERMISSION[a]] === true
  const status = removedStatus(r)
  const out = []
  if (status === REMOVED_STATUS.DELETED) {
    if (can('undelete')) out.push('undelete')
    if (can('permanent_delete')) out.push('permanent_delete')
    return out
  }
  if (can('disposition')) out.push('disposition')
  if (status === REMOVED_STATUS.RELEASED) {
    if (can('restore')) out.push('restore')
    if (can('archive')) out.push('archive')
  } else if (can('unarchive')) {
    out.push('unarchive')
  }
  if (can('soft_delete')) out.push('soft_delete')
  return out
}

export function emptyRemovedFilters() {
  return { search: '', status: '', disposition: '', site: '' }
}

export function activeRemovedFilterCount(f) {
  return ['status', 'disposition', 'site'].filter((k) => !blank(f?.[k])).length
}

/**
 * Filter rows. `disposition` may be a value from DISPOSITIONS or 'none'
 * (no disposition recorded yet).
 */
export function filterRemoved(rows, f = {}) {
  const q = blank(f.search) ? '' : f.search.trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (!blank(f.status) && removedStatus(r) !== f.status) return false
    if (!blank(f.disposition)) {
      if (f.disposition === 'none') { if (!blank(r.final_disposition)) return false } else if (r.final_disposition !== f.disposition) return false
    }
    if (!blank(f.site) && String(r.site || '').toUpperCase() !== String(f.site).toUpperCase()) return false
    if (q) {
      const hay = [r.asset_no, r.reg_no, r.site, r.complaint, r.previous_current_stage, r.previous_delay_reason,
        r.previous_responsible_name, r.final_disposition_remarks]
        .filter((v) => !blank(v)).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Newest removal first; rows with no removal date last; asset_no tiebreak. */
export function sortRemoved(rows) {
  return [...(rows || [])].sort((a, b) => {
    const ta = blank(a.removed_at) ? -Infinity : Date.parse(a.removed_at)
    const tb = blank(b.removed_at) ? -Infinity : Date.parse(b.removed_at)
    if (ta !== tb) return tb - ta
    return String(a.asset_no || '').localeCompare(String(b.asset_no || ''))
  })
}

/** Distinct sites in the list, sorted. */
export function removedSites(rows) {
  return [...new Set((rows || []).map((r) => r.site).filter((s) => !blank(s)))].sort()
}

/** Counts for the summary tiles. */
export function summarizeRemoved(rows) {
  const out = { total: 0, released: 0, archived: 0, deleted: 0, awaitingDisposition: 0, withDisposition: 0 }
  for (const r of rows || []) {
    out.total += 1
    const s = removedStatus(r)
    out[s] += 1
    if (s === REMOVED_STATUS.DELETED) continue
    if (blank(r.final_disposition)) out.awaitingDisposition += 1
    else out.withDisposition += 1
  }
  return out
}
