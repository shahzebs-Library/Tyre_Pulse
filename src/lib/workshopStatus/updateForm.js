/**
 * Vehicle Update Drawer form logic (pure, no I/O).
 *
 * formFromRecord  record -> editable form values (strings)
 * diffPatch       record + form -> ONLY the changed fields, normalised the way
 *                 the server normalises them (trimmed, blank -> null)
 * validateUpdateForm  inline validation that mirrors the server rules of
 *                 workshop_status_update_record (20261007120000). The server
 *                 stays the authority; this only saves a round trip.
 *
 * Who and when are never part of the form: the server stamps them.
 */
import {
  SELECTABLE_STAGES, DELAY_REASONS, PARTS_STATUSES, needsDetailedReason,
} from './vocab'

/** The TyrePulse-owned fields the drawer edits (same list the server accepts). */
export const UPDATE_FIELDS = Object.freeze([
  'current_stage', 'delay_reason', 'detailed_reason', 'work_done', 'action_taken',
  'next_action', 'parts_status', 'mr_number', 'po_number', 'responsible_user_id',
  'supporting_user_id', 'expected_part_date', 'expected_release_date', 'blocker', 'remarks',
])

export const DATE_FIELDS = Object.freeze(['expected_part_date', 'expected_release_date'])
export const PEOPLE_FIELDS = Object.freeze(['responsible_user_id', 'supporting_user_id'])
export const LONG_TEXT_FIELDS = Object.freeze(['detailed_reason', 'work_done', 'action_taken', 'next_action', 'blocker', 'remarks'])
export const REF_FIELDS = Object.freeze(['mr_number', 'po_number'])

export const MAX_TEXT = 4000
export const MAX_REF = 100

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** yyyy-mm-dd (or an ISO timestamp) -> yyyy-mm-dd, anything else -> ''. */
function toDateInput(v) {
  if (v == null) return ''
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

/** Trimmed text, blank -> null (the server's normalisation). */
function norm(field, v) {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '') return null
  if (DATE_FIELDS.includes(field)) return toDateInput(s) || s
  if (PEOPLE_FIELDS.includes(field)) return s.toLowerCase()
  return s
}

/** True when `s` is a real calendar date written yyyy-mm-dd. */
export function isValidDateInput(s) {
  const m = String(s || '').match(DATE_RE)
  if (!m) return false
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** Editable values for a record. Every field present, '' when empty. */
export function formFromRecord(record) {
  const r = record || {}
  const form = {}
  for (const f of UPDATE_FIELDS) {
    if (DATE_FIELDS.includes(f)) form[f] = toDateInput(r[f])
    else form[f] = r[f] == null ? '' : String(r[f])
  }
  return form
}

/**
 * Only the fields whose normalised value differs from the record. A cleared
 * field is sent as null. An empty object means there is nothing to save.
 */
export function diffPatch(record, form) {
  const r = record || {}
  const f = form || {}
  const patch = {}
  for (const field of UPDATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(f, field)) continue
    const next = norm(field, f[field])
    const prev = norm(field, r[field])
    if (next !== prev) patch[field] = next
  }
  return patch
}

/**
 * Inline validation. Returns { valid, errors } where errors maps a field to
 * an error code (the drawer turns codes into translated text):
 *   detailRequired   delay reason Other without a detailed reason
 *   notInList        value not in the controlled list
 *   invalidDate      not a real yyyy-mm-dd date
 *   dateRange        before 2000 or after 2100
 *   releaseBeforePart expected release earlier than the expected part date
 *   tooLong          over the length limit
 */
export function validateUpdateForm(form) {
  const f = form || {}
  const errors = {}
  const val = (k) => (f[k] == null ? '' : String(f[k]).trim())

  const lists = { current_stage: SELECTABLE_STAGES, delay_reason: DELAY_REASONS, parts_status: PARTS_STATUSES }
  for (const [k, list] of Object.entries(lists)) {
    if (val(k) && !list.includes(val(k))) errors[k] = 'notInList'
  }

  if (needsDetailedReason(val('delay_reason')) && !val('detailed_reason')) {
    errors.detailed_reason = 'detailRequired'
  }

  for (const k of DATE_FIELDS) {
    const v = val(k)
    if (!v) continue
    if (!isValidDateInput(v)) { errors[k] = 'invalidDate'; continue }
    const y = Number(v.slice(0, 4))
    if (y < 2000 || y > 2100) errors[k] = 'dateRange'
  }
  const part = val('expected_part_date')
  const release = val('expected_release_date')
  if (part && release && !errors.expected_part_date && !errors.expected_release_date && release < part) {
    errors.expected_release_date = 'releaseBeforePart'
  }

  for (const k of LONG_TEXT_FIELDS) {
    if (!errors[k] && val(k).length > MAX_TEXT) errors[k] = 'tooLong'
  }
  for (const k of REF_FIELDS) {
    if (val(k).length > MAX_REF) errors[k] = 'tooLong'
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

/** True when a patch changes the responsible or supporting person. */
export function patchTouchesPeople(patch) {
  return PEOPLE_FIELDS.some((k) => Object.prototype.hasOwnProperty.call(patch || {}, k))
}

/** Translation key segment for a vocabulary value ('QC / Inspection' -> 'qc_inspection'). */
export function vocabKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}
