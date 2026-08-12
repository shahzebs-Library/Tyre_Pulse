import { describe, it, expect } from 'vitest'
import {
  isLayoutType, displayValue, submissionRows, prettyStatus, submissionSummary,
} from '../lib/checklistView'

describe('displayValue', () => {
  it('keeps a zero, because zero is a reading and not a blank', () => {
    expect(displayValue(0)).toBe('0')
  })

  it('renders a boolean as Yes / No', () => {
    expect(displayValue(true)).toBe('Yes')
    expect(displayValue(false)).toBe('No')
  })

  it('treats absent, empty and whitespace-only as nothing recorded', () => {
    expect(displayValue(null)).toBeNull()
    expect(displayValue(undefined)).toBeNull()
    expect(displayValue('')).toBeNull()
    expect(displayValue('   ')).toBeNull()
    expect(displayValue([])).toBeNull()
  })

  it('joins a multi-select', () => {
    expect(displayValue(['Front', 'Rear'])).toBe('Front, Rear')
  })
})

describe('isLayoutType', () => {
  // Deliberately matches the builder's own registry rather than a second list.
  it('recognises a section, and nothing else', () => {
    expect(isLayoutType('section')).toBe(true)
    expect(isLayoutType('number')).toBe(false)
    expect(isLayoutType('boolean')).toBe(false)
    expect(isLayoutType(undefined)).toBe(false)
  })
})

describe('submissionRows', () => {
  const template = [
    { id: 'a', type: 'section', label: 'Brakes' },
    { id: 'b', type: 'boolean', label: 'Brakes OK' },
    { id: 'c', type: 'number', label: 'Tread depth' },
    { id: 'd', type: 'text', label: 'Notes' },
    { id: 'e', type: 'text', label: 'Never answered' },
  ]

  it('shows a recorded "No" - dropping it would hide a reported fault', () => {
    const rows = submissionRows({ template_fields: template, answers: { b: false } })
    expect(rows.map((r) => r.id)).toEqual(['b'])
    expect(rows[0].text).toBe('No')
  })

  it('shows a zero reading and drops the unanswered point', () => {
    const rows = submissionRows({ template_fields: template, answers: { c: 0 } })
    expect(rows.map((r) => r.id)).toEqual(['c'])
    expect(rows[0].text).toBe('0')
  })

  it('never shows layout fields', () => {
    const rows = submissionRows({
      template_fields: template,
      answers: { a: 'anything', d: 'ok' },
    })
    expect(rows.map((r) => r.id)).toEqual(['d'])
  })

  it('keeps a point that carries only a photo', () => {
    const rows = submissionRows({
      template_fields: template,
      answers: {},
      photos: { e: ['tp-storage://tyre-photos/x.jpg'] },
    })
    expect(rows.map((r) => r.id)).toEqual(['e'])
    expect(rows[0].text).toBeNull()
    expect(rows[0].photos).toHaveLength(1)
  })

  it('falls back to the answer keys when no template travelled with the row', () => {
    const rows = submissionRows({ answers: { field_9: 'Yes' } })
    expect(rows).toHaveLength(1)
    // The label is the field id, which is ugly but true - better than inventing
    // a friendly name for a field nobody can look up.
    expect(rows[0]).toMatchObject({
      id: 'field_9', type: null, label: 'field_9', value: 'Yes', text: 'Yes', photos: [], note: null,
    })
  })

  it('survives a submission with nothing on it', () => {
    expect(submissionRows({})).toEqual([])
    expect(submissionRows(null)).toEqual([])
  })
})

describe('submissionSummary', () => {
  it('returns nulls for a missing submission - not loaded is not the same as empty', () => {
    expect(submissionSummary(null)).toEqual({
      points: null, withPhotos: null, score: null, passed: null,
    })
  })

  it('counts points and photos, and reports an absent score as null', () => {
    const s = submissionSummary({
      template_fields: [
        { id: 'a', type: 'text', label: 'A' },
        { id: 'b', type: 'text', label: 'B' },
      ],
      answers: { a: 'yes', b: 'no' },
      photos: { a: ['u1', 'u2'] },
    })
    expect(s.points).toBe(2)
    expect(s.withPhotos).toBe(1)
    expect(s.score).toBeNull()
  })

  it('reads a real score', () => {
    expect(submissionSummary({ answers: {}, score_pct: 82 }).score).toBe(82)
  })
})

describe('prettyStatus', () => {
  it('reads back as words', () => {
    expect(prettyStatus('pending_approval')).toBe('Pending Approval')
    expect(prettyStatus(null)).toBe('Submitted')
  })
})
