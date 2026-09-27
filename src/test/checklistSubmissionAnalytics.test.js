import { describe, it, expect } from 'vitest'
import {
  lineRegister, summarizeSubmission, filterLines, lineExportRows, isFlagged,
} from '../lib/checklistSubmissionAnalytics'

const template = {
  option_sets: {
    legend: {
      options: ['OK', 'Not OK'],
      meta: [{ value: 'OK', meaning: 'Good' }, { value: 'Not OK', meaning: 'Fault' }],
      blocking: ['Not OK'],
    },
  },
  fields: [
    { id: 's1', type: 'section', label: 'Engine' },
    { id: 'oil', type: 'select', label: 'Oil level', options_ref: 'legend' },
    { id: 'belt', type: 'select', label: 'Fan belt', options_ref: 'legend' },
    { id: 's2', type: 'section', label: 'Brakes' },
    { id: 'brakes', type: 'boolean', label: 'Brakes OK' },
    { id: 'km', type: 'number', label: 'Odometer' },
    { id: 'sig', type: 'signature', label: 'Signature' },
  ],
}
const sub = {
  id: 'abc',
  answers: { oil: 'OK', belt: 'Not OK', brakes: false },
  notes: { belt: 'Cracked' },
  photos: { belt: ['p1.jpg', 'p2.jpg'] },
}

describe('checklistSubmissionAnalytics', () => {
  it('lists every line, answered or blank, with its section', () => {
    const lines = lineRegister(sub, { template })
    expect(lines.map((l) => l.id)).toEqual(['oil', 'belt', 'brakes', 'km'])
    expect(lines[0].section).toBe('Engine')
    expect(lines[3]).toMatchObject({ section: 'Brakes', answered: false })
    expect(lines[1].flagged).toBe(true)
    expect(lines[1].markText).toBe('Not OK')
    expect(lines[2].flagged).toBe(true)
    expect(lineRegister(null)).toEqual([])
  })

  it('summarises completion, findings and evidence', () => {
    const s = summarizeSubmission(lineRegister(sub, { template }))
    expect(s).toMatchObject({ total: 4, answered: 3, blank: 1, completionPct: 75, flagged: 2, blocking: 1, photos: 2, remarks: 1 })
    expect(s.sections).toEqual([
      { section: 'Engine', total: 2, answered: 2, flagged: 1, completionPct: 100 },
      { section: 'Brakes', total: 2, answered: 1, flagged: 1, completionPct: 50 },
    ])
    expect(summarizeSubmission([]).completionPct).toBeNull()
  })

  it('filters lines', () => {
    const lines = lineRegister(sub, { template })
    expect(filterLines(lines, { show: 'blank' }).map((l) => l.id)).toEqual(['km'])
    expect(filterLines(lines, { show: 'flagged' }).map((l) => l.id)).toEqual(['belt', 'brakes'])
    expect(filterLines(lines, { show: 'evidence' }).map((l) => l.id)).toEqual(['belt'])
    expect(filterLines(lines, { search: 'cracked' }).map((l) => l.id)).toEqual(['belt'])
    expect(filterLines(lines, { section: 'Brakes' })).toHaveLength(2)
  })

  it('exports with honest blanks', () => {
    const out = lineExportRows(lineRegister(sub, { template }))
    expect(out[3].answer).toBe('Not answered')
    expect(out[1]).toMatchObject({ finding: 'Not OK', remark: 'Cracked', photos: 2 })
    expect(isFlagged({ type: 'boolean', value: true })).toBe(false)
  })
})
