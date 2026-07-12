import { describe, it, expect, vi } from 'vitest'

// jsPDF's save() creates a Blob + triggers a browser download jsdom cannot do,
// so we subclass the real jsPDF and no-op save() — every drawing primitive the
// exporter uses (setFillColor/rect/text/addImage/splitTextToSize) works under
// jsdom unchanged. jspdf-autotable's ESM/CJS default resolves to a namespace
// object under vitest (it is a callable under Vite), so we stub it to a no-op;
// this test targets our grouping/formatting logic, not autotable's rendering.
vi.mock('jspdf', async () => {
  const actual = await vi.importActual('jspdf')
  const Real = actual.jsPDF
  // jsPDF assigns `save` as an instance-own property in its constructor, so a
  // prototype override is shadowed — replace it on the instance after super().
  class J extends Real {
    constructor(...args) { super(...args); this.save = () => this }
  }
  return { ...actual, default: J, jsPDF: J }
})
vi.mock('jspdf-autotable', () => ({ default: () => {}, applyPlugin: () => {} }))

import { exportChecklistSubmissionPdf } from '../lib/exportUtils'

const SAMPLE = {
  id: 'abcd1234-0000-0000-0000-000000000000',
  template_name: 'Pre-Trip Inspection',
  template_version: 3,
  title: 'Truck 42 Pre-Trip',
  asset_no: 'TRK-042',
  site: 'Riyadh Depot',
  country: 'SA',
  status: 'submitted',
  printed_name: 'A. Driver',
  signature_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  submitted_at: '2026-07-10T08:30:00Z',
  answers: {
    f_tyres: 'OK',
    f_pressure: 'true',
    f_rating: 4,
    f_defects: ['Nail', 'Cut'],
  },
  photos: { f_photo1: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] },
  fields: [
    { id: 'f_sec1', type: 'section', label: 'Tyres & Wheels' },
    { id: 'f_tyres', type: 'text', label: 'Tyre condition' },
    { id: 'f_pressure', type: 'boolean', label: 'Pressures correct' },
    { id: 'f_rating', type: 'rating', label: 'Overall condition' },
    { id: 'f_defects', type: 'multiselect', label: 'Defects found' },
    { id: 'f_photo1', type: 'photo', label: 'Damage photos' },
    { id: 'f_sig', type: 'signature', label: 'Signature' },
  ],
}

describe('exportChecklistSubmissionPdf', () => {
  it('is an async exported function', () => {
    expect(typeof exportChecklistSubmissionPdf).toBe('function')
    expect(exportChecklistSubmissionPdf.constructor.name).toBe('AsyncFunction')
  })

  it('resolves without throwing on a full sample submission', async () => {
    await expect(
      exportChecklistSubmissionPdf(SAMPLE, { company: 'Acme Fleet', branding: { primary_color: '#0EA5E9' } })
    ).resolves.toBeUndefined()
  })

  it('resolves on partial/empty data (no fields, no answers)', async () => {
    await expect(exportChecklistSubmissionPdf({ id: 'x' })).resolves.toBeUndefined()
    await expect(exportChecklistSubmissionPdf({})).resolves.toBeUndefined()
  })

  it('derives rows from answers when no field list is provided', async () => {
    await expect(
      exportChecklistSubmissionPdf(
        { id: 'y', answers: { a: 1, b: [1, 2], c: true }, photos: { d: ['u1'] } },
        { fields: null }
      )
    ).resolves.toBeUndefined()
  })

  it('prefers opts.fields over submission.fields', async () => {
    await expect(
      exportChecklistSubmissionPdf(
        { id: 'z', answers: { q1: 'answer' }, fields: [{ id: 'other', type: 'text', label: 'Ignored' }] },
        { fields: [{ id: 'q1', type: 'text', label: 'Question 1' }] }
      )
    ).resolves.toBeUndefined()
  })
})
