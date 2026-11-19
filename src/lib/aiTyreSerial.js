/**
 * Display rules for the DRAFT AI serial-number reading (docs/features/AI_SERIAL_RECOGNITION.md).
 * Pure: no I/O. The comparison itself happens server-side; this only explains a stored result.
 */
export const SERIAL_OUTCOME_LABEL = Object.freeze({
  match: 'Matches the registered tyre',
  mismatch: 'Differs from the registered tyre',
  ambiguous: 'Could not be confirmed',
  unreadable: 'Serial not readable in the photo',
  no_serial_on_record: 'No tyre registered on this wheel',
  weak_serial_on_record: 'Registered serial is a placeholder or size',
})
export const SERIAL_SOURCE_LABEL = Object.freeze({ label: 'Printed label', moulded: 'Moulded in sidewall', none: 'None visible' })
export const SERIAL_DECISIONS = Object.freeze([
  ['record_correct', 'Register is correct (photo misread or other tyre)'],
  ['photo_shows_other_tyre', 'Photo shows a different tyre (check the register)'],
  ['unreadable_confirmed', 'Serial genuinely not readable'],
  ['dismissed', 'Not a serial question'],
])
export const SERIAL_REVIEW_OUTCOMES = Object.freeze(['mismatch', 'ambiguous', 'unreadable'])

/** { pending, decided, latest } for one reading and its append-only decision events. */
export function serialReviewState(reading, events = []) {
  if (!reading) return { pending: false, decided: false, latest: null }
  const mine = (events || []).filter((e) => e && e.reading_id === reading.id)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const latest = mine.length ? mine[mine.length - 1] : null
  const needs = reading.needs_review === true || SERIAL_REVIEW_OUTCOMES.includes(reading.outcome)
  return { pending: needs && !latest, decided: !!latest, latest }
}

/** One-line plain text; never shows a value the model did not read ('?' stays '?'). */
export function serialSummary(reading) {
  if (!reading) return ''
  const seen = reading.normalized ? reading.normalized : 'nothing readable'
  const source = SERIAL_SOURCE_LABEL[reading.source] || 'Unknown source'
  return `Read: ${seen} (${source}, ${reading.confidence || 'low'} confidence, ${reading.status || 'unreadable'})`
}

export const decisionNeedsSerial = (decision) => decision === 'photo_shows_other_tyre'
