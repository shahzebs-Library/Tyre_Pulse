/**
 * Checklist Submission analytics - pure engine behind /checklists/submission/:id.
 *
 * Reads the sheet through the shared reader (checklistView.submissionSections
 * with includeUnanswered) so the line list here is exactly the paper form:
 * every line, answered or not. On top of that it computes:
 *
 *  - completion: lines answered vs lines on the form. A blank line on a signed
 *    sheet is a finding, so it is counted, never hidden;
 *  - findings: lines carrying a blocking mark (the marks that stop a close) and
 *    yes/no lines answered No;
 *  - evidence: photos and remarks recorded;
 *  - per-section completion, filters for the line register and export rows.
 * Rates over zero lines are null (N/A). No I/O.
 */
import { submissionSections } from './checklistView'

function isNo(v) {
  return v === false || v === 'false'
}

export function isFlagged(row) {
  return Boolean(row?.marks?.some((m) => m.blocking)) || (row?.type === 'boolean' && isNo(row.value))
}

/** Flat line register: every line of the form with its section. */
export function lineRegister(sub, { template = null, lang = 'en' } = {}) {
  if (!sub) return []
  return submissionSections(sub, { template, lang, includeUnanswered: true })
    .flatMap((s) => s.rows.map((r) => ({
      ...r,
      section: s.label,
      flagged: isFlagged(r),
      markText: (r.marks || []).map((m) => m.label || m.value).filter(Boolean).join(', '),
    })))
}

export function summarizeSubmission(lines = []) {
  const total = lines.length
  const answered = lines.filter((l) => l.answered).length
  const flagged = lines.filter((l) => l.flagged).length
  const blocking = lines.filter((l) => l.marks?.some((m) => m.blocking)).length
  const photos = lines.reduce((s, l) => s + (l.photos?.length || 0), 0)
  const remarks = lines.filter((l) => l.note).length
  const sections = new Map()
  for (const l of lines) {
    const s = sections.get(l.section) || { section: l.section, total: 0, answered: 0, flagged: 0 }
    s.total += 1
    if (l.answered) s.answered += 1
    if (l.flagged) s.flagged += 1
    sections.set(l.section, s)
  }
  return {
    total,
    answered,
    blank: total - answered,
    completionPct: total > 0 ? Math.round((answered / total) * 100) : null,
    flagged,
    blocking,
    photos,
    remarks,
    sections: [...sections.values()].map((s) => ({
      ...s,
      completionPct: s.total > 0 ? Math.round((s.answered / s.total) * 100) : null,
    })),
  }
}

export const LINE_FILTERS = [
  ['all', 'All lines'],
  ['answered', 'Answered'],
  ['blank', 'Left blank'],
  ['flagged', 'Findings'],
  ['evidence', 'With photo or remark'],
]

export function filterLines(lines = [], { search = '', show = 'all', section = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return lines.filter((l) => {
    if (section !== 'all' && l.section !== section) return false
    if (show === 'answered' && !l.answered) return false
    if (show === 'blank' && l.answered) return false
    if (show === 'flagged' && !l.flagged) return false
    if (show === 'evidence' && !(l.photos?.length || l.note)) return false
    if (q && ![l.label, l.text, l.note, l.section, l.markText].some((v) => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
}

export const LINE_EXPORT_COLUMNS = [
  { key: 'line', header: 'Line' },
  { key: 'section', header: 'Section' },
  { key: 'question', header: 'Question' },
  { key: 'answer', header: 'Answer' },
  { key: 'finding', header: 'Finding' },
  { key: 'remark', header: 'Remark' },
  { key: 'photos', header: 'Photos' },
]

export function lineExportRows(lines = []) {
  return lines.map((l) => ({
    line: l.line,
    section: l.section || '',
    question: l.label || '',
    answer: l.answered ? (l.text || l.markText || String(l.value ?? '')) : 'Not answered',
    finding: l.flagged ? (l.markText || 'No') : '',
    remark: l.note || '',
    photos: l.photos?.length || 0,
  }))
}
