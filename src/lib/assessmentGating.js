/**
 * assessmentGating.js - the pure rules behind the Workshop Assessment tab
 * (mock M5 "Repair assessment report"). No I/O. Every consumer (the web panel,
 * its tests, a future Flutter mirror) reads the SAME rules from here so the
 * "Submit assessment and route" button can never disagree with the attachment
 * list it sits under.
 *
 *   attachmentStatus(evidenceRows)  -> one row per ASSESSMENT_ATTACHMENTS entry
 *   recommendedRoute(marks, draft)  -> 'external' | 'internal' (the engine's suggestion)
 *   canSubmit({route, evidenceRows, assessment}) -> { ok, reasons[] }
 *   totals({labourHours, labourCost, partsCost}) -> derived preliminary estimate
 *   partsAvailabilityLabel(available, specialOrder) -> "2 available · 1 special order"
 */
import { ASSESSMENT_ATTACHMENTS, REPAIR_ROUTE_TILES } from './accidentCaseVocab'

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Match one evidence row to a required-attachment key. A row explicitly
 * stamped with `requirement_key` wins; a legacy row (uploaded before the
 * requirement keys existed) is matched by kind for the photo bucket only,
 * because a bare document cannot honestly be called "the vendor quotation".
 */
export function attachmentKeyFor(row) {
  if (!row) return null
  const rk = String(row.requirement_key || '').trim()
  if (rk && ASSESSMENT_ATTACHMENTS.some((a) => a.key === rk)) return rk
  if (row.kind === 'photo') return 'damage_photos'
  return null
}

/**
 * @param {object[]} evidenceRows accident_evidence rows scoped to workstream 'assessment'
 * @returns {{key,label,required,gatesSubmit,countable,count,status:'attached'|'missing',rows}[]}
 */
export function attachmentStatus(evidenceRows) {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : []
  return ASSESSMENT_ATTACHMENTS.map((a) => {
    const mine = rows.filter((r) => attachmentKeyFor(r) === a.key && r.verification_status !== 'rejected')
    return {
      ...a,
      gatesSubmit: !!a.gatesSubmit,
      countable: !!a.countable,
      count: mine.length,
      status: mine.length > 0 ? 'attached' : 'missing',
      rows: mine,
    }
  })
}

/** The engine's route suggestion: external when any mark is severe or a total
 *  loss is possible, otherwise internal. Never 'on_site' by itself - that is a
 *  human call about access to the machine, not something damage marks reveal. */
export function recommendedRoute(marks, draft) {
  const areas = Array.isArray(marks) ? marks : []
  const severe = areas.some((m) => String(m?.severity || '').toLowerCase() === 'severe')
  if (severe || draft?.total_loss_possible === true) return 'external'
  return 'internal'
}

export const ROUTE_TILE_KEYS = REPAIR_ROUTE_TILES.map((t) => t.key)

/** Is this stored route one of the three mock tiles (vs a legacy "other route")? */
export const isTileRoute = (route) => ROUTE_TILE_KEYS.includes(route)

/**
 * Can the assessment be submitted and routed?
 * - an assessment row must exist (draft saved at least once)
 * - it must still be a draft
 * - a route must be chosen
 * - the external route requires the vendor quotation attachment (the mock's
 *   "Attach vendor quotation to enable submission to External Workshop")
 */
export function canSubmit({ route, evidenceRows, assessment } = {}) {
  const reasons = []
  if (!assessment?.id) reasons.push('Save the assessment first.')
  else if (assessment.assessment_status && assessment.assessment_status !== 'draft') reasons.push('This assessment has already been submitted.')
  if (!route) reasons.push('Choose a repair route.')
  if (route === 'external') {
    const quote = attachmentStatus(evidenceRows).find((a) => a.key === 'vendor_quotation')
    if (!quote || quote.status !== 'attached') reasons.push('Attach vendor quotation to enable submission to External Workshop.')
  }
  return { ok: reasons.length === 0, reasons }
}

/**
 * Derived preliminary total = labour cost + parts cost. Labour HOURS are
 * reported back untouched (no rate is invented to turn hours into money -
 * labour cost is its own entered figure). Total is null when NEITHER cost is
 * known, so a blank estimate never renders as 0.
 */
export function totals({ labourHours, labourCost, partsCost } = {}) {
  const hours = num(labourHours)
  const labour = num(labourCost)
  const parts = num(partsCost)
  const total = labour == null && parts == null ? null : (labour ?? 0) + (parts ?? 0)
  return { labourHours: hours, labourCost: labour, partsCost: parts, total }
}

/** "2 available · 1 special order"; "Not set" when neither counter is recorded. */
export function partsAvailabilityLabel(available, specialOrder) {
  const a = num(available)
  const s = num(specialOrder)
  if (a == null && s == null) return 'Not set'
  const parts = []
  if (a != null) parts.push(`${a} available`)
  if (s != null) parts.push(`${s} special order`)
  return parts.join(' · ')
}
