import { describe, it, expect } from 'vitest'
import {
  documentNo, rowMarks, submissionRows, submissionAnswers, templateFromSubmission,
} from '../lib/checklistView'

/**
 * The V595 legend gave every mark an icon, a tone and a meaning, and named the
 * one that blocks a close. A reader that prints the bare word throws all of it
 * away - including the fact that the sheet cannot be signed off.
 */
const LEGEND = {
  options: ['OK', 'Not OK', 'Not applicable'],
  meta: [
    { value: 'OK', icon: 'ok', tone: 'good', meaning: 'Checked and correct. Nothing needed.' },
    { value: 'Not OK', icon: 'fault', tone: 'bad', meaning: 'A fault is present and has NOT been put right.' },
    { value: 'Not applicable', icon: 'na', tone: 'muted', meaning: 'This machine does not have this item.' },
  ],
  blocking: ['Not OK'],
  require_note: ['Not OK'],
}

const TEMPLATE = {
  option_sets: { legend: LEGEND },
  fields: [
    { id: 'f1', type: 'select', label: 'Brakes', options_ref: 'legend' },
    { id: 'f2', type: 'select', label: 'Lights', options_ref: 'legend' },
    { id: 'f3', type: 'number', label: 'Kilometres' },
  ],
}

describe('documentNo', () => {
  it('reads the sheet reference', () => {
    expect(documentNo({ document_no: 'WDC-TM514-2026-0001' })).toBe('WDC-TM514-2026-0001')
  })

  it('returns null when the template mints none, so nothing is invented on screen', () => {
    // A blank reference drawn on screen is worse than an absent one: somebody
    // quotes it.
    expect(documentNo({ document_no: null })).toBeNull()
    expect(documentNo({ document_no: '   ' })).toBeNull()
    expect(documentNo(null)).toBeNull()
  })
})

describe('rowMarks', () => {
  it('carries the icon, tone and meaning the legend defines', () => {
    const [m] = rowMarks(TEMPLATE.fields[0], 'Not OK', TEMPLATE)
    expect(m.icon).toBe('fault')
    expect(m.tone).toBe('bad')
    expect(m.meaning).toMatch(/fault is present/i)
  })

  it('flags the mark that stops the sheet being closed', () => {
    expect(rowMarks(TEMPLATE.fields[0], 'Not OK', TEMPLATE)[0].blocking).toBe(true)
    expect(rowMarks(TEMPLATE.fields[0], 'OK', TEMPLATE)[0].blocking).toBe(false)
  })

  it('returns one entry per selected value, so a caller never guesses the shape', () => {
    expect(rowMarks(TEMPLATE.fields[0], ['OK', 'Not OK'], TEMPLATE)).toHaveLength(2)
  })

  it('gives a line that answers no legend no marks at all', () => {
    // A meter reading is a number, not a mark, and must render as plain text.
    expect(rowMarks(TEMPLATE.fields[2], 1200, TEMPLATE)).toEqual([])
  })

  it('still describes a value the legend never declared, rather than dropping the row', () => {
    const [m] = rowMarks(TEMPLATE.fields[0], 'Some old word', TEMPLATE)
    expect(m.value).toBe('Some old word')
    expect(m.known).toBe(false)
    expect(m.blocking).toBe(false)
  })

  it('leaves an ordinary dropdown as plain text - a choice list is not a legend', () => {
    // Stamping an icon and a tone on every select would assert a meaning the
    // template never gave, and would change how every existing checklist reads.
    const plain = {
      option_sets: {},
      fields: [{ id: 'p1', type: 'select', label: 'Shift', options: ['Day', 'Night'] }],
    }
    expect(rowMarks(plain.fields[0], 'Day', plain)).toEqual([])
  })

  it('treats a blank answer as no mark, not as an unknown one', () => {
    expect(rowMarks(TEMPLATE.fields[0], '', TEMPLATE)).toEqual([])
    expect(rowMarks(TEMPLATE.fields[0], null, TEMPLATE)).toEqual([])
  })
})

describe('submissionRows carries the marks', () => {
  const SUB = {
    template_fields: TEMPLATE.fields,
    template_i18n: { option_sets: { legend: LEGEND } },
    answers: { f1: 'Not OK', f3: 0 },
    notes: { f1: 'Pads worn through' },
  }

  it('resolves a mark through the SHARED legend the field points at', () => {
    // Without the template the shared option set cannot be found, and the answer
    // silently prints as a bare word with no icon and no blocking flag.
    const rows = submissionRows(SUB, { template: templateFromSubmission(SUB) })
    const brakes = rows.find((r) => r.id === 'f1')
    expect(brakes.marks[0].blocking).toBe(true)
    expect(brakes.note).toBe('Pads worn through')
  })

  it('keeps a zero reading as a reading and gives it no mark', () => {
    const rows = submissionRows(SUB, { template: templateFromSubmission(SUB) })
    const km = rows.find((r) => r.id === 'f3')
    expect(km.text).toBe('0')
    expect(km.marks).toEqual([])
  })
})

describe('templateFromSubmission', () => {
  it('carries the approval rules, so a two-stage sheet is recognisable', () => {
    const t = templateFromSubmission({
      template_fields: TEMPLATE.fields,
      template_settings: { require_area_manager: true, doc_prefix: 'WDC', min_interval_days: 10 },
    })
    expect(t.require_area_manager).toBe(true)
    expect(t.doc_prefix).toBe('WDC')
    expect(t.min_interval_days).toBe(10)
  })

  it('defaults to single-stage when the settings never travelled', () => {
    // Every template built before V594 genuinely is single-stage, so absent
    // settings must never read as "needs a second signature".
    const t = templateFromSubmission({ template_fields: TEMPLATE.fields })
    expect(t.require_area_manager).toBe(false)
    expect(t.doc_prefix).toBeNull()
  })
})

describe('submissionAnswers', () => {
  it('is always an object, so a caller never guards for null', () => {
    expect(submissionAnswers(null)).toEqual({})
    expect(submissionAnswers({ answers: ['not', 'a', 'map'] })).toEqual({})
    expect(submissionAnswers({ answers: { a: 1 } })).toEqual({ a: 1 })
  })
})
