/**
 * How a completed checklist is read on screen - one definition, used by both the
 * full page and the quick viewer.
 *
 * This logic was inside ChecklistSubmission.jsx. It moved here the moment a second
 * surface needed it: two copies of "which points do we show, and what does this
 * answer say" would drift, and the drift would be invisible - the page and the
 * drawer would quietly disagree about what an inspector recorded.
 *
 * A submission stores `answers` keyed by field id and does NOT embed its template,
 * so the readable list is reconstructed from whatever the row carries. Answers are
 * the source of truth for what was captured; the template only supplies labels and
 * order.
 */

import { isLayoutField } from './checklist/fieldTypes'
import { fieldLabel, optionLabel, templateName } from './checklist/checklistI18n'

/**
 * True when a field is page furniture and carries no answer of its own.
 *
 * Delegates to the field-type registry rather than keeping a second list:
 * 'section' is the only layout type the builder can produce, and a local list
 * would silently start disagreeing with the builder the day a type is added.
 */
export function isLayoutType(type) {
  return isLayoutField(type)
}

/**
 * Render one answer as text.
 * A boolean is Yes/No rather than true/false, an empty list reads as nothing
 * recorded, and `0` must survive - it is a reading, not a blank.
 */
export function displayValue(value) {
  if (value === 0) return '0'
  if (value == null || value === '') return null
  if (Array.isArray(value)) return value.length ? value.join(', ') : null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  const s = String(value).trim()
  return s === '' ? null : s
}

/**
 * Build the ordered, labelled list of points to show.
 *
 * Only points that were actually answered (or carry a photo) appear. That drops
 * the long tail of inapplicable rows without ever hiding something an inspector
 * recorded - which is why `hasContent` treats a boolean false and a zero as
 * content: "brakes OK: No" is an answer, and dropping it would turn a reported
 * fault into a blank line.
 *
 * Rows carry their section, their remark and their line number, because the
 * printed sheet needs all three and a second reader that computed them would
 * drift from this one.
 *
 * @param {object} sub a submission row from getSubmission()
 * @param {object} [opts] { template, lang, includeUnanswered }
 * @returns {Array<{id,type,label,value,text,photos,note,section,line}>}
 */
export function submissionRows(sub, opts = {}) {
  if (!sub) return []
  return submissionRowsFor(sub, opts)
}

/** Human-readable status. */
export function prettyStatus(s) {
  return String(s || 'submitted').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * A short headline for the viewer: how many points were recorded and how many
 * carry a photo. Returns nulls for a missing submission rather than zeros - "we
 * have not loaded it" and "it recorded nothing" are different statements.
 */
export function submissionSummary(sub) {
  if (!sub) return { points: null, withPhotos: null, score: null, passed: null }
  const rows = submissionRows(sub)
  const score = Number.isFinite(Number(sub.score_pct)) ? Number(sub.score_pct) : null
  return {
    points: rows.length,
    withPhotos: rows.filter((r) => r.photos.length).length,
    score,
    passed: typeof sub.score_passed === 'boolean' ? sub.score_passed : null,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The paper sheet: sections, remarks, signatures.
 *
 * The Green Concrete forms are not a flat list of answers. They are sections of
 * numbered checks, each with a status, a photograph and its own REMARK, then a
 * block of signatures - a mechanic, an auto electrician and the engineer who
 * certifies the machine fit for operation. Everything below reconstructs that
 * shape from a submission so the screen and the printed PDF read it the same way.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The field definitions to read a submission with, or null when none are known. */
export function templateFieldsOf(sub, template) {
  if (template && Array.isArray(template.fields) && template.fields.length) return template.fields
  if (Array.isArray(sub?.template_fields) && sub.template_fields.length) return sub.template_fields
  if (Array.isArray(sub?.fields) && sub.fields.length) return sub.fields
  return null
}

/** The per-line remarks map. Always an object, never null. */
export function submissionNotes(sub) {
  return sub?.notes && typeof sub.notes === 'object' && !Array.isArray(sub.notes) ? sub.notes : {}
}

/** The per-field signatures map. Always an object, never null. */
export function submissionSignatureMap(sub) {
  return sub?.signatures && typeof sub.signatures === 'object' && !Array.isArray(sub.signatures)
    ? sub.signatures
    : {}
}

function photosOf(sub) {
  return sub?.photos && typeof sub.photos === 'object' && !Array.isArray(sub.photos) ? sub.photos : {}
}

function answersOf(sub) {
  return sub?.answers && typeof sub.answers === 'object' && !Array.isArray(sub.answers) ? sub.answers : {}
}

/**
 * True when the field carries something a reader must see.
 *
 * A boolean `false` and a numeric `0` are ANSWERS. "Brakes OK: No" is a reported
 * fault and "0 bar" is a reading; collapsing either into a blank turns a finding
 * into an empty line. A remark or a photograph counts too - an inspector who
 * wrote a note recorded something even if the status box is empty.
 */
function fieldHasContent(field, answers, photos, notes) {
  const id = field?.id
  if (id == null) return false
  if (Array.isArray(photos[id]) && photos[id].length) return true
  const note = notes[id]
  if (typeof note === 'string' && note.trim() !== '') return true
  const v = answers[id]
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  return v != null && String(v).trim() !== ''
}

/**
 * The answer as printable text, translated when the field carries an option set.
 *
 * The STORED answer is always the English option - the translation is display
 * only, so an Arabic printout and an English one describe the same record.
 */
export function answerText(field, value, { template = null, lang = 'en' } = {}) {
  if (field && (field.type === 'select' || field.type === 'multiselect') && lang && lang !== 'en') {
    const one = (v) => {
      const t = optionLabel(field, template, v, lang)
      return t == null || t === '' ? displayValue(v) : String(t)
    }
    if (Array.isArray(value)) return value.length ? value.map(one).filter(Boolean).join(', ') : null
    if (value != null && String(value).trim() !== '') return one(value)
  }
  return displayValue(value)
}

/** The field label in the requested language, falling back to English, never blank. */
export function labelOf(field, lang = 'en') {
  const t = lang && lang !== 'en' ? fieldLabel(field, lang) : null
  const s = t == null ? '' : String(t).trim()
  if (s) return s
  return String(field?.label || field?.id || '').trim() || String(field?.id || '')
}

/**
 * The submission as the paper sheet reads: an ordered list of sections, each
 * holding its lines.
 *
 * `includeUnanswered` is the difference between the two readers. On screen we
 * show what was recorded; on the printed sheet every line of the form is present
 * so a reader can see that line 14 was left blank - a blank line on a signed form
 * is itself a finding, and hiding it would flatter the record.
 */
export function submissionSections(sub, {
  template = null, lang = 'en', includeUnanswered = false,
} = {}) {
  const answers = answersOf(sub)
  const photos = photosOf(sub)
  const notes = submissionNotes(sub)
  const fields = templateFieldsOf(sub, template)

  const mkRow = (field, index) => ({
    id: field.id,
    type: field.type || null,
    label: labelOf(field, lang),
    englishLabel: String(field.label || field.id || ''),
    value: answers[field.id],
    text: answerText(field, answers[field.id], { template, lang }),
    photos: Array.isArray(photos[field.id]) ? photos[field.id] : [],
    note: typeof notes[field.id] === 'string' && notes[field.id].trim() ? notes[field.id].trim() : null,
    answered: fieldHasContent(field, answers, photos, notes),
    line: index,
  })

  if (!fields) {
    // No template to hand. Fall back to the keys the submission itself carries:
    // the label is then the field id, which is ugly but true.
    const keys = Array.from(new Set([...Object.keys(answers), ...Object.keys(photos), ...Object.keys(notes)]))
    const rows = keys.map((k, i) => mkRow({ id: k, type: null, label: k }, i + 1))
    const kept = includeUnanswered ? rows : rows.filter((r) => r.answered)
    return kept.length ? [{ id: '__all', label: 'Responses', rows: kept }] : []
  }

  const sections = []
  let current = { id: '__top', label: 'Responses', translatedFromTemplate: false, rows: [] }
  let line = 0
  for (const f of fields) {
    if (!f || !f.id) continue
    if (isLayoutType(f.type)) {
      if (current.rows.length) sections.push(current)
      current = { id: f.id, label: labelOf(f, lang), rows: [] }
      continue
    }
    if (f.type === 'signature') continue // signatures render in their own block
    line += 1
    const row = mkRow(f, line)
    if (includeUnanswered || row.answered) current.rows.push(row)
  }
  if (current.rows.length) sections.push(current)
  return sections
}

/**
 * Build the ordered, labelled list of points to show, flattened across sections.
 * Backwards compatible: called with one argument it behaves exactly as before.
 */
export function submissionRowsFor(sub, opts = {}) {
  return submissionSections(sub, opts).flatMap((s) => s.rows.map((r) => ({ ...r, section: s.label })))
}

/**
 * Every signature on the record, not just the primary one.
 *
 * The workshop sheet is signed three times and the fleet sheet twice. Printing
 * only `signature_data` would show one of them and silently drop the rest, which
 * is exactly how an approval nobody gave starts to look like one that was given.
 *
 * The printed name is read from the nearest preceding text field, which is how
 * both paper forms are laid out ("Driver name" immediately above "Driver
 * signature"). When there is no such field the name is left null rather than
 * guessed at - an unattributed signature says so.
 */
export function submissionSignatures(sub, { template = null, lang = 'en' } = {}) {
  const answers = answersOf(sub)
  const map = submissionSignatureMap(sub)
  const fields = templateFieldsOf(sub, template) || []
  const out = []

  let lastText = null
  for (const f of fields) {
    if (!f || !f.id) continue
    if (f.type === 'text' && answers[f.id] != null && String(answers[f.id]).trim() !== '') {
      lastText = String(answers[f.id]).trim()
    }
    if (f.type !== 'signature') continue
    const data = map[f.id]
    out.push({
      id: f.id,
      label: labelOf(f, lang),
      data: typeof data === 'string' && data ? data : null,
      printedName: lastText,
      signed: typeof data === 'string' && !!data,
    })
    lastText = null
  }

  // The primary sign-off lives in its own column and predates the per-field map.
  // It is appended only when no signature field already carries the same image,
  // so a record is never shown as signed twice by one person.
  const primary = typeof sub?.signature_data === 'string' && sub.signature_data ? sub.signature_data : null
  if (primary && !out.some((s) => s.data === primary)) {
    out.unshift({
      id: '__primary',
      label: 'Signed by',
      data: primary,
      printedName: sub?.printed_name ? String(sub.printed_name) : null,
      signed: true,
    })
  }
  return out
}

/**
 * The status legend printed under the sheet, in the requested language.
 * Read from the template's own shared option set so the legend and the answer
 * boxes can never disagree about what the six statuses are.
 */
export function legendOptions(template, lang = 'en') {
  const sets = template?.option_sets && typeof template.option_sets === 'object' ? template.option_sets : {}
  const fields = Array.isArray(template?.fields) ? template.fields : []
  const refField = fields.find((f) => f && f.options_ref && sets[f.options_ref])
  const key = refField?.options_ref || (sets.legend ? 'legend' : null)
  if (!key || !sets[key]) return []
  const english = Array.isArray(sets[key].options) ? sets[key].options : []
  const probe = refField || { options_ref: key, options: english, type: 'select' }
  return english.map((v) => ({
    value: v,
    label: lang && lang !== 'en' ? (optionLabel(probe, template, v, lang) || v) : v,
  }))
}

/** The template's title in the requested language, English when untranslated. */
export function templateTitle(template, sub, lang = 'en') {
  if (template) {
    const t = templateName(template, lang)
    if (t) return String(t)
  }
  return String(sub?.template_name || template?.name || 'Checklist')
}

/**
 * The template a submission carries with it.
 *
 * getSubmission() attaches the field list and the template's translations rather
 * than the whole row, so a reader can render a stored (English) answer in the
 * reader's own language without a second fetch. This assembles those parts back
 * into the shape the i18n helpers and the PDF expect. Returns null when the
 * submission carries nothing to work with.
 */
export function templateFromSubmission(sub) {
  const fields = templateFieldsOf(sub, null)
  const i18n = sub?.template_i18n && typeof sub.template_i18n === 'object' ? sub.template_i18n : {}
  if (!fields && !Object.keys(i18n).length) return null
  return {
    id: sub?.template_id ?? null,
    name: sub?.template_name ?? null,
    fields: fields || [],
    option_sets: i18n.option_sets || {},
    name_i18n: i18n.name_i18n || {},
    description_i18n: i18n.description_i18n || {},
  }
}
