/**
 * The month grid - the Fleet Transit Mixer sheet as it is actually used.
 *
 * The paper form is one sheet per machine per MONTH: the checks run down the
 * left, the days of the month run across, and the driver ticks a box each day.
 * The app records one SUBMISSION PER DAY, because that is how the check is
 * performed. So the month view is not a different capture surface, it is a
 * REPORT that assembles the days that were filled in.
 *
 * The whole value of the grid is the empty column. A day with no submission is
 * MISSING - it is not blank and it is certainly not OK. That distinction is what
 * shows a manager which days nobody checked the machine, and it is why this
 * module never fills a gap with a default.
 *
 * Pure module: no React, no network, no clock of its own (pass `today`).
 */

import { isLayoutType, labelOf, answerText, submissionNotes } from './checklistView'

/** Days in a calendar month. `month` is 1-12. */
export function daysInMonth(year, month) {
  const y = Number(year); const m = Number(month)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 0
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** An ISO date string as { year, month, day }, or null when unreadable. */
function parseIsoDay(value) {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/**
 * Which day of the month a submission belongs to.
 *
 * The sheet's own Date field is the operational truth - a driver who fills
 * Monday's sheet on Tuesday morning is recording Monday. The submission
 * timestamp is only the fallback for a record that carries no date field, and
 * `dateBasis` says which one was used so a reader is never left guessing.
 */
export function submissionDay(sub, fields, { year, month } = {}) {
  const list = Array.isArray(fields) ? fields : []
  const answers = sub?.answers && typeof sub.answers === 'object' ? sub.answers : {}
  let basis = 'submitted'
  let parsed = null
  const dateField = list.find((f) => f && f.type === 'date' && answers[f.id])
  if (dateField) { parsed = parseIsoDay(answers[dateField.id]); if (parsed) basis = 'sheet_date' }
  if (!parsed) parsed = parseIsoDay(sub?.submitted_at || sub?.created_at)
  if (!parsed) return { day: null, basis: 'unknown' }
  if (year != null && month != null && (parsed.year !== Number(year) || parsed.month !== Number(month))) {
    return { day: null, basis, outOfMonth: true }
  }
  return { day: parsed.day, basis }
}

/**
 * The lines that make up the grid.
 *
 * A check is a line whose options come from the template's shared status set -
 * that is what makes it a tick box rather than an identification field. When no
 * field declares a shared set (an older template), every choice field is treated
 * as a check, which is wider but never silently drops a real line.
 */
export function gridFields(fields) {
  const list = (Array.isArray(fields) ? fields : []).filter(
    (f) => f && f.id && !isLayoutType(f.type) && f.type !== 'signature',
  )
  const referenced = list.filter((f) => f.options_ref)
  if (referenced.length) return referenced
  return list.filter((f) => f.type === 'select' || f.type === 'multiselect' || f.type === 'boolean')
}

/**
 * Assemble a month.
 *
 * @param {Array}  submissions rows for ONE asset, any order
 * @param {object} template    the checklist template (fields + option sets)
 * @param {object} opts        { year, month, lang, today }
 * @returns {{
 *   year, month, days, rows, submittedDays, missingDays, pendingDays,
 *   duplicateDays, remarks, signedBy, dateBasis
 * }}
 */
export function monthlyGrid(submissions, template, {
  year, month, lang = 'en', today = null,
} = {}) {
  const y = Number(year); const m = Number(month)
  const total = daysInMonth(y, m)
  const days = Array.from({ length: total }, (_, i) => i + 1)
  const fields = Array.isArray(template?.fields) ? template.fields : []
  const checks = gridFields(fields)

  const rows = checks.map((f) => ({
    id: f.id,
    field: f,
    label: labelOf(f, lang),
    byDay: {},
  }))
  const rowById = new Map(rows.map((r) => [r.id, r]))

  const byDay = new Map()
  const duplicateDays = []
  const basisUsed = new Set()

  for (const sub of Array.isArray(submissions) ? submissions : []) {
    const { day, basis } = submissionDay(sub, fields, { year: y, month: m })
    if (!day || day < 1 || day > total) continue
    basisUsed.add(basis)
    const prev = byDay.get(day)
    if (prev) {
      if (!duplicateDays.includes(day)) duplicateDays.push(day)
      // Two records for one day means the sheet was filled twice. The LATER one
      // is the correction, so it wins - but the day is reported as duplicated
      // rather than the earlier record being deleted from the reader's view.
      const prevAt = String(prev.submitted_at || prev.created_at || '')
      const thisAt = String(sub.submitted_at || sub.created_at || '')
      if (thisAt < prevAt) continue
    }
    byDay.set(day, sub)
  }

  const remarks = []
  const signedBy = []

  for (const [day, sub] of Array.from(byDay.entries()).sort((a, b) => a[0] - b[0])) {
    const answers = sub?.answers && typeof sub.answers === 'object' ? sub.answers : {}
    const notes = submissionNotes(sub)
    for (const f of checks) {
      const row = rowById.get(f.id)
      if (!row) continue
      const text = answerText(f, answers[f.id], { template, lang })
      row.byDay[day] = {
        value: answers[f.id] ?? null,
        text: text ?? null,
        english: answers[f.id] == null ? null : String(answers[f.id]),
      }
    }
    for (const [fid, note] of Object.entries(notes)) {
      if (typeof note !== 'string' || !note.trim()) continue
      const f = fields.find((x) => x && x.id === fid)
      remarks.push({ day, id: fid, label: f ? labelOf(f, lang) : fid, note: note.trim() })
    }
    const sigs = sub?.signatures && typeof sub.signatures === 'object' ? sub.signatures : {}
    for (const f of fields) {
      if (!f || f.type !== 'signature') continue
      if (!sigs[f.id] && !(f.id === '__primary')) continue
      signedBy.push({ day, id: f.id, label: labelOf(f, lang) })
    }
    if (sub?.signature_data && !fields.some((f) => f && f.type === 'signature' && sigs[f.id])) {
      signedBy.push({ day, id: '__primary', label: 'Signed by', name: sub.printed_name || null })
    }
  }

  const submittedDays = Array.from(byDay.keys()).sort((a, b) => a - b)
  const submitted = new Set(submittedDays)

  // A day that has not happened yet cannot be missing. Counting it as missed
  // would report every month in progress as mostly neglected.
  const cutoff = elapsedDays(y, m, today)
  const missingDays = days.filter((d) => d <= cutoff && !submitted.has(d))
  const pendingDays = days.filter((d) => d > cutoff)

  return {
    year: y,
    month: m,
    days,
    rows,
    submittedDays,
    missingDays,
    pendingDays,
    duplicateDays,
    remarks,
    signedBy,
    dateBasis: basisUsed.size === 1 ? Array.from(basisUsed)[0] : (basisUsed.size ? 'mixed' : null),
  }
}

/**
 * How many days of this month have already happened, as of `today`.
 * A past month is fully elapsed; a future month has not started at all.
 */
export function elapsedDays(year, month, today = null) {
  const total = daysInMonth(year, month)
  if (!total) return 0
  const now = parseIsoDay(today) || (() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
  })()
  if (now.year > Number(year)) return total
  if (now.year < Number(year)) return 0
  if (now.month > Number(month)) return total
  if (now.month < Number(month)) return 0
  return Math.min(total, now.day)
}

/**
 * The headline for a month.
 *
 * `coveragePct` is NULL for a month that has not started - zero percent would
 * read as a fleet nobody is checking, when in fact nothing was due yet.
 */
export function monthlySummary(grid, { today = null } = {}) {
  if (!grid || !Array.isArray(grid.days)) {
    return {
      daysInMonth: 0, elapsed: 0, submitted: 0, missed: 0, pending: 0,
      notOk: 0, checksRecorded: 0, coveragePct: null, duplicateDays: 0,
    }
  }
  const elapsed = elapsedDays(grid.year, grid.month, today)
  const submitted = grid.submittedDays.length
  let notOk = 0
  let checksRecorded = 0
  for (const row of grid.rows) {
    for (const cell of Object.values(row.byDay || {})) {
      if (!cell || cell.english == null || cell.english === '') continue
      checksRecorded += 1
      if (isNotOk(cell.english)) notOk += 1
    }
  }
  return {
    daysInMonth: grid.days.length,
    elapsed,
    submitted,
    missed: grid.missingDays.length,
    pending: grid.pendingDays.length,
    notOk,
    checksRecorded,
    duplicateDays: grid.duplicateDays.length,
    coveragePct: elapsed > 0 ? Math.round((submitted / elapsed) * 100) : null,
  }
}

/**
 * A line that was reported as a fault.
 *
 * Matched on the ENGLISH stored answer, never the translated label: the
 * translation is display only, so an Arabic printout must count exactly the same
 * faults as an English one.
 */
export function isNotOk(englishValue) {
  const s = String(englishValue == null ? '' : englishValue).trim().toLowerCase()
  if (!s) return false
  if (s === 'false' || s === 'no') return true
  return s === 'not ok' || s === 'notok' || s === 'not-ok'
}

/**
 * A line that was checked and found correct.
 *
 * Matched on the ENGLISH stored answer for the same reason as isNotOk: the
 * translation is display only.
 */
export function isOk(englishValue) {
  return String(englishValue == null ? '' : englishValue).trim().toLowerCase() === 'ok'
}

/** A line this machine does not have. Not a pass and not a fault - it does not apply. */
export function isNotApplicable(englishValue) {
  const s = String(englishValue == null ? '' : englishValue).trim().toLowerCase()
  return s === 'not applicable' || s === 'n/a' || s === 'na' || s === 'not-applicable'
}

/**
 * Did this line need somebody to do something, or to know about it?
 *
 * TRUE for every recorded answer that is neither OK nor Not applicable: a fault
 * (Not OK) and a completed action (Changed, Repaired, Added / Top-Up, Adjusted,
 * Lubricated) are BOTH worth reading, because the second kind is work that was
 * carried out and has to be traceable. FALSE for an unanswered line, which is a
 * gap rather than a finding and is counted separately - reporting an unrecorded
 * check as a finding would invent one, and reporting it as OK would be worse.
 */
export function needsAttention(englishValue) {
  const s = String(englishValue == null ? '' : englishValue).trim()
  if (!s) return false
  return !isOk(s) && !isNotApplicable(s)
}

/** Short cell text for the grid. An unrecorded day stays empty, never "OK". */
export function cellText(cell) {
  if (!cell || cell.english == null || cell.english === '') return ''
  const s = String(cell.english)
  if (s === 'OK') return 'OK'
  if (isNotOk(s)) return 'X'
  if (/^not applicable$/i.test(s)) return 'NA'
  if (/^changed$/i.test(s)) return 'C'
  if (/^repaired$/i.test(s)) return 'R'
  if (/^added/i.test(s)) return 'A'
  return s.slice(0, 3)
}

/** The grid as rows of cells for Excel: line label, then one column per day. */
export function monthlyExportRows(grid) {
  if (!grid || !Array.isArray(grid.rows)) return []
  return grid.rows.map((row) => {
    const out = { line: row.label }
    for (const d of grid.days) out[`d${d}`] = cellText(row.byDay[d])
    return out
  })
}

export default {
  daysInMonth, elapsedDays, submissionDay, gridFields,
  monthlyGrid, monthlySummary, monthlyExportRows, isNotOk, isOk, isNotApplicable, needsAttention, cellText,
}
