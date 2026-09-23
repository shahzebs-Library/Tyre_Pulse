/**
 * responsibilityDocs.js - pure shaping for the M3 "Responsibility documents"
 * table: accident_evidence rows (workstream 'liability') keyed on
 * requirement_key -> one row per RESPONSIBILITY_DOCS entry with status,
 * uploader, time and verification, plus the "N of M required documents"
 * counter and the list of required documents still missing.
 *
 * No I/O. Vocabulary comes from accidentCaseVocab.RESPONSIBILITY_DOCS so the
 * web table and the Flutter screen cannot drift. A document that is not
 * attached is reported as missing; nothing is inferred.
 */
import { RESPONSIBILITY_DOCS } from './accidentCaseVocab'

export const DOC_STATUS = Object.freeze({ ATTACHED: 'attached', MISSING: 'missing' })

/** accident_evidence.verification_status -> the 3-state label the mock prints. */
export function docVerificationFor(evidenceRow) {
  if (!evidenceRow) return 'missing'
  const v = String(evidenceRow.verification_status || '').toLowerCase()
  if (v === 'verified') return 'verified'
  if (v === 'rejected') return 'rejected'
  return 'pending'
}

export const VERIFICATION_LABEL = Object.freeze({
  verified: 'Verified', pending: 'Pending', missing: 'Missing', rejected: 'Rejected',
})

function newestFirst(a, b) {
  const ta = new Date(a?.uploaded_at || a?.created_at || 0).getTime() || 0
  const tb = new Date(b?.uploaded_at || b?.created_at || 0).getTime() || 0
  return tb - ta
}

/**
 * Resolve an uploader to a display name. `profilesById` maps profile id ->
 * {full_name, username}. Falls back to any uploader name already on the row,
 * then 'Not set' - never an invented name.
 */
export function uploaderNameFor(evidenceRow, profilesById) {
  if (!evidenceRow) return 'Not set'
  const id = evidenceRow.uploaded_by || evidenceRow.created_by || null
  const p = id && profilesById ? (profilesById.get ? profilesById.get(id) : profilesById[id]) : null
  const name = p?.full_name || p?.username || evidenceRow.uploaded_by_name || evidenceRow.uploader_name || ''
  return name ? String(name) : 'Not set'
}

/**
 * @param {object[]} evidenceRows accident_evidence rows (any workstream; only
 *   rows whose requirement_key matches a RESPONSIBILITY_DOCS key are used)
 * @param {{profilesById?: Map|object, docs?: object[]}} [opts]
 * @returns {{rows: object[], requiredTotal:number, requiredDone:number,
 *   counterLabel:string, missingRequired:string[], allRequiredAttached:boolean}}
 */
export function summarizeResponsibilityDocs(evidenceRows, { profilesById, docs = RESPONSIBILITY_DOCS } = {}) {
  const list = Array.isArray(evidenceRows) ? evidenceRows.filter(Boolean) : []
  const byKey = new Map()
  for (const r of list) {
    const k = r.requirement_key
    if (!k) continue
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(r)
  }
  const rows = docs.map((d) => {
    const matches = (byKey.get(d.key) || []).slice().sort(newestFirst)
    const latest = matches[0] || null
    const attachedAt = latest ? (latest.uploaded_at || latest.created_at || null) : null
    return {
      key: d.key,
      label: d.label,
      required: d.required !== false,
      status: latest ? DOC_STATUS.ATTACHED : DOC_STATUS.MISSING,
      count: matches.length,
      uploader: latest ? uploaderNameFor(latest, profilesById) : 'Not set',
      time: attachedAt,
      verification: docVerificationFor(latest),
      evidence: latest,
    }
  })
  const required = rows.filter((r) => r.required)
  const requiredDone = required.filter((r) => r.status === DOC_STATUS.ATTACHED).length
  const missingRequired = required.filter((r) => r.status === DOC_STATUS.MISSING).map((r) => r.label)
  return {
    rows,
    requiredTotal: required.length,
    requiredDone,
    counterLabel: `${requiredDone} of ${required.length} required documents`,
    missingRequired,
    allRequiredAttached: requiredDone === required.length,
  }
}

/** True when the Taqdeer assessment document is not attached. */
export function taqdeerDocMissing(summary) {
  const row = summary?.rows?.find((r) => r.key === 'taqdeer_assessment')
  return !row || row.status === DOC_STATUS.MISSING
}

/** The warning the mock prints when Taqdeer is required but not yet attached. */
export const TAQDEER_WARNING =
  'Insurance claim can be drafted, but payer confirmation waits for Taqdeer assessment.'

export function showTaqdeerWarning(taqdeerRequired, summary) {
  return taqdeerRequired === true && taqdeerDocMissing(summary)
}
