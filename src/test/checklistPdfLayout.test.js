import { describe, expect, it } from 'vitest'
import { renderChecklistPdf } from '../lib/checklistPdf'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMwBgMGCAUAEMoCZQo+SLsAAAAASUVORK5CYII='
const meta = [
  ['date', 'Date', '2026-08-24', 'date'],
  ['asset', 'Asset / GCC code', 'TEST-01'],
  ['location', 'Location', 'Test site'],
  ['registration', 'Registration / fleet No', 'TEST 123'],
  ['km', 'Km reading', 219820, 'number'],
  ['hours', 'Hour meter reading', 19321, 'number'],
]
const template = {
  name: 'Workshop Daily Checklist',
  option_sets: { legend: { options: ['OK', 'Not OK', 'Not applicable', 'Changed'] } },
  fields: [
    ...meta.map(([id, label, , type]) => ({ id, label, type: type || 'text' })),
    { id: 'checks', label: 'Checks', type: 'section' },
    ...Array.from({ length: 31 }, (_, i) => ({ id: `check${i}`, label: `Test check ${i + 1}`, type: 'select', options_ref: 'legend' })),
    { id: 'signoff', label: 'Sign off', type: 'section' },
    { id: 'mechanic', label: 'Mechanic name', type: 'text' },
    { id: 'mechanicSignature', label: 'Mechanic signature', type: 'signature' },
    { id: 'electrician', label: 'Auto electrician name', type: 'text' },
    { id: 'electricianSignature', label: 'Auto electrician signature', type: 'signature' },
    { id: 'inspector', label: 'Inspected by (W.S. Engr / Sr. Sup / Sup / Foreman)', type: 'text' },
    { id: 'inspectorSignature', label: 'Inspector signature', type: 'signature' },
    { id: 'fitness', label: 'Certifies that machine is fit for operation', type: 'boolean' },
  ],
}
const submission = {
  asset_no: 'TEST-01', document_no: 'WDC-TEST-2026-0001', site: 'Test site', country: 'KSA',
  submitted_at: '2026-09-12T08:59:15Z',
  answers: {
    ...Object.fromEntries(meta.map(([id, , value]) => [id, value])),
    ...Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`check${i}`, i < 4 ? 'Not OK' : i === 4 ? 'Changed' : i < 7 ? 'Not applicable' : 'OK'])),
    mechanic: 'Test mechanic', inspector: 'Test inspector', fitness: true,
  },
  photos: { check0: [image] },
}
const render = (sub = submission) => renderChecklistPdf({ submission: sub, template, branding: { logo_url: image }, save: false })
const textOf = (doc) => [...doc.output().matchAll(/\((.*?)\)\s*Tj/g)].map(m => m[1]).join('\n')

describe('checklist PDF layout', () => {
  it('keeps an unsigned workshop sheet with five exceptions and one photograph on one page', async () => {
    const { doc, filename } = await render()
    expect(doc.internal.getNumberOfPages()).toBe(1)
    const text = textOf(doc)
    expect(text.match(/Not signed/g)).toHaveLength(3)
    expect(text).toContain('Fitness certification conflicts')
    expect(text).toContain('24 OK, 2 not applicable, 5 needing attention')
    expect(text).toContain('Test inspector')
    expect(filename).toBe('Workshop Daily Checklist WDC-TEST-2026-0001 2026-08-24.pdf')
  })

  it('retains full signature boxes and their images when a signature exists', async () => {
    const { doc } = await render({ ...submission, signatures: { mechanicSignature: image } })
    expect(doc.internal.getNumberOfPages()).toBe(2)
    expect(textOf(doc).match(/Not signed/g)).toHaveLength(2)
    expect(doc.internal.pages[2].join('\n')).toMatch(/\/I\d+ Do/)
  })

  it('falls back to the received date when the sheet has no recorded date', async () => {
    const { filename } = await render({ ...submission, answers: { ...submission.answers, date: '' } })
    expect(filename).toContain('2026-09-12.pdf')
  })
})
