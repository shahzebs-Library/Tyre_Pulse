import { describe, it, expect, vi } from 'vitest'

// The service module imports the Supabase client; the helpers under test are pure.
vi.mock('../lib/api/_client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  applyCountry: (q) => q,
  fetchAllPages: vi.fn(),
  ServiceError: class extends Error {},
}))

import {
  tyreRecordEditSchema, buildRecordPayload, recordToFormValues, POSITION_SUGGESTIONS,
} from '../lib/api/tyreRecords'

const baseForm = {
  sr: '', issue_date: '2026-01-10', description: '', brand: 'Michelin', serial_no: 'SN1',
  qty: '1', job_card: '', mis_number: '', asset_no: 'TM514', site: 'NHC', country: 'KSA',
  remarks: '', cost_per_tyre: '1450', risk_level: '', category: '',
  km_at_fitment: '', km_at_removal: '',
}

describe('Tyre record form: size and wheel position', () => {
  it('the form schema keeps size and position (z.object would strip unknown keys)', () => {
    const res = tyreRecordEditSchema.safeParse({ ...baseForm, size: '315/80R22.5', position: 'LHF1' })
    expect(res.success).toBe(true)
    expect(res.data.size).toBe('315/80R22.5')
    expect(res.data.position).toBe('LHF1')
  })

  it('the create/update payload includes size and the canonical position', () => {
    const p = buildRecordPayload({ ...baseForm, size: ' 315/80R22.5 ', position: 'lhr1o' }, { profile: { id: 'u1' } })
    expect(p.size).toBe('315/80R22.5')
    expect(p.position).toBe('LHR1-O')
    expect(p.uploaded_by).toBe('u1')
    expect(p.cost_per_tyre).toBe(1450)
  })

  it('blank size and position are stored as null, never an empty string', () => {
    const p = buildRecordPayload({ ...baseForm, size: '  ', position: '' })
    expect(p.size).toBeNull()
    expect(p.position).toBeNull()
  })

  it('an unrecognised position is kept as typed (trimmed)', () => {
    expect(buildRecordPayload({ ...baseForm, size: '', position: ' Spare ' }).position).toBe('Spare')
  })

  it('editing re-populates size and position, falling back to tyre_position', () => {
    expect(recordToFormValues({ size: '385/65R22.5', position: 'RHF1' })).toMatchObject({ size: '385/65R22.5', position: 'RHF1' })
    expect(recordToFormValues({ size: null, position: null, tyre_position: 'LHCO' })).toMatchObject({ size: '', position: 'LHCO' })
  })

  it('offers common position codes as suggestions', () => {
    expect(POSITION_SUGGESTIONS).toEqual(expect.arrayContaining(['LHF1', 'RHF1', 'LHR1-O']))
  })
})
