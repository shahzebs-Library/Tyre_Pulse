/**
 * handoverGating.js - pure rules for the Dispatch and Handover tab (mock M2).
 *
 * The vendor's "Sign and accept vehicle" button is DISABLED until every field
 * the mock marks with an asterisk is present. Which fields those are is owned
 * by accidentCaseVocab.RECEIPT_REQUIRED (one list for web + Flutter); this
 * module only decides what "present" means per field and reports the gaps by
 * key so the UI can point at the exact missing input rather than a vague
 * "form incomplete".
 *
 * No I/O, no Date.now() - everything is derived from the dispatch row handed in.
 */
import { RECEIPT_REQUIRED, DISPATCH_LIVE_STATES, DISPATCH_STEPPER } from './accidentCaseVocab'

/** Labels for the required receipt fields, as the mock prints them. */
export const RECEIPT_FIELD_LABELS = {
  arrived_at: 'Arrived date/time',
  received_by_name: 'Received by (name)',
  received_by_designation: 'Received by (designation)',
  receiving_photos: 'Receiving photos',
  handover_paper_ref: 'Signed handover paper',
  receiver_signature: 'Vendor receiver signature',
  custody_accepted: 'Custody acceptance',
}

function present(v) {
  if (v == null) return false
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'number') return Number.isFinite(v)
  return String(v).trim() !== ''
}

/**
 * Which RECEIPT_REQUIRED keys are still missing on a dispatch row (or a form
 * draft shaped like one). An absent row means everything is missing.
 * @param {object|null|undefined} dispatch
 * @returns {string[]} missing keys, in RECEIPT_REQUIRED order
 */
export function receiptMissing(dispatch) {
  const d = dispatch || {}
  return RECEIPT_REQUIRED.filter((k) => !present(d[k]))
}

/** True only when nothing required is missing. */
export function canSignAndAccept(dispatch) {
  return receiptMissing(dispatch).length === 0
}

/** Human list of what is still missing, e.g. "Arrived date/time, Receiving photos". */
export function receiptMissingLabels(dispatch) {
  return receiptMissing(dispatch).map((k) => RECEIPT_FIELD_LABELS[k] || k)
}

/** Label for a live_status token; 'Not set' for a blank/unknown one. */
export function liveStatusLabel(token) {
  if (!token) return 'Not set'
  return DISPATCH_LIVE_STATES.find((s) => s.key === token)?.label || 'Not set'
}

/**
 * Transit elapsed = departure_at to arrived_at, or to `now` while still in
 * transit. null when there is no departure on record (never 0).
 * @param {object|null} dispatch
 * @param {number} [now=Date.now()] epoch ms, injectable for tests
 * @returns {number|null} elapsed ms
 */
export function transitElapsedMs(dispatch, now = Date.now()) {
  const dep = dispatch?.departure_at ? new Date(dispatch.departure_at).getTime() : NaN
  if (!Number.isFinite(dep)) return null
  const arr = dispatch?.arrived_at ? new Date(dispatch.arrived_at).getTime() : NaN
  const end = Number.isFinite(arr) ? arr : now
  return Math.max(0, end - dep)
}

/**
 * Vendor repair SLA chip. The SLA does NOT start until custody is accepted
 * (the mock's warning banner is exactly this rule), so before acceptance the
 * answer is always "Not started" regardless of any timer row. After
 * acceptance the repair workstream's timer (accident_sla_instances) is read
 * when present; when absent the answer is still honest ("No timer").
 * @param {object|null} dispatch
 * @param {object[]} slaInstances rows from listSlaInstances
 * @param {number} [now=Date.now()]
 * @returns {{label:string, tone:'neutral'|'ok'|'warn'|'danger'}}
 */
export function vendorSlaChip(dispatch, slaInstances = [], now = Date.now()) {
  if (!dispatch?.custody_accepted) return { label: 'Not started', tone: 'neutral' }
  const rows = (slaInstances || []).filter((s) => s.workstream_key === 'repair')
  const inst = rows.find((s) => ['running', 'paused'].includes(s.state)) || rows[0] || null
  if (!inst) return { label: 'No timer', tone: 'neutral' }
  if (inst.state === 'met') return { label: 'Met', tone: 'ok' }
  if (inst.state === 'paused') return { label: 'Paused', tone: 'warn' }
  const due = inst.due_at ? new Date(inst.due_at).getTime() : NaN
  if (!Number.isFinite(due)) return { label: 'Running', tone: 'ok' }
  const left = due - now
  if (inst.state === 'breached' || left < 0) return { label: 'Overdue', tone: 'danger', remainingMs: left }
  return { label: 'Running', tone: left < 3600000 ? 'warn' : 'ok', remainingMs: left }
}

/** The stepper keys, exported here so tests can pin the mock order in one place. */
export const STEPPER_KEYS = DISPATCH_STEPPER.map((s) => s.key)
