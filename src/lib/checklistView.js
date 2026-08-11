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
 * @param {object} sub a submission row from getSubmission()
 * @returns {Array<{id,type,label,value,text,photos}>}
 */
export function submissionRows(sub) {
  const answers = sub?.answers && typeof sub.answers === 'object' ? sub.answers : {}
  const photos = sub?.photos && typeof sub.photos === 'object' ? sub.photos : {}

  const photosFor = (key) => (Array.isArray(photos?.[key]) ? photos[key] : [])

  const embedded = Array.isArray(sub?.template_fields)
    ? sub.template_fields
    : Array.isArray(sub?.fields)
      ? sub.fields
      : null

  if (embedded && embedded.length) {
    const hasContent = (f) => {
      const v = answers?.[f.id]
      if (photosFor(f.id).length) return true
      if (Array.isArray(v)) return v.length > 0
      if (typeof v === 'boolean') return true
      if (typeof v === 'number') return true
      return v != null && String(v).trim() !== ''
    }
    return embedded
      .filter((f) => f && !isLayoutType(f.type) && hasContent(f))
      .map((f) => ({
        id: f.id,
        type: f.type || null,
        label: f.label || f.id,
        value: answers?.[f.id],
        text: displayValue(answers?.[f.id]),
        photos: photosFor(f.id),
      }))
  }

  // No template to hand: fall back to the keys the submission itself carries. The
  // label is then the field id, which is ugly but true - better than inventing a
  // friendly name for a field nobody can look up.
  const keys = new Set([...Object.keys(answers), ...Object.keys(photos)])
  return Array.from(keys).map((k) => ({
    id: k,
    type: null,
    label: k,
    value: answers?.[k],
    text: displayValue(answers?.[k]),
    photos: photosFor(k),
  }))
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
