import { describe, it, expect } from 'vitest'
import {
  UPDATE_FIELDS, formFromRecord, diffPatch, validateUpdateForm, isValidDateInput, patchTouchesPeople, MAX_TEXT,
} from '../lib/workshopStatus/updateForm'

const record = {
  id: 'r1',
  current_stage: 'Waiting for Parts',
  delay_reason: 'Waiting for Spare Parts',
  detailed_reason: null,
  work_done: 'Opened gearbox',
  mr_number: 'MR-1',
  responsible_user_id: 'AAAAAAAA-0000-0000-0000-000000000001',
  expected_release_date: '2026-10-20',
  expected_part_date: null,
  complaint: 'Excel owned, never in the form',
  last_updated_by_name: 'Somebody',
}

describe('formFromRecord', () => {
  it('fills every editable field with a string and nothing else', () => {
    const f = formFromRecord(record)
    expect(Object.keys(f).sort()).toEqual([...UPDATE_FIELDS].sort())
    expect(f.current_stage).toBe('Waiting for Parts')
    expect(f.detailed_reason).toBe('')
    expect(f.expected_release_date).toBe('2026-10-20')
    expect(f.expected_part_date).toBe('')
    expect(f).not.toHaveProperty('complaint')
    expect(f).not.toHaveProperty('last_updated_by_name')
  })
  it('cuts a timestamp down to a date input value', () => {
    expect(formFromRecord({ expected_part_date: '2026-10-21T00:00:00+00:00' }).expected_part_date).toBe('2026-10-21')
  })
  it('handles a missing record', () => {
    expect(formFromRecord(null).remarks).toBe('')
  })
})

describe('diffPatch', () => {
  it('returns nothing when the form is unchanged', () => {
    expect(diffPatch(record, formFromRecord(record))).toEqual({})
  })
  it('ignores whitespace-only and case-only uuid differences', () => {
    const f = formFromRecord(record)
    f.work_done = '  Opened gearbox  '
    f.responsible_user_id = record.responsible_user_id.toLowerCase()
    f.blocker = '   '
    expect(diffPatch(record, f)).toEqual({})
  })
  it('returns only the changed fields, trimmed, with cleared values as null', () => {
    const f = formFromRecord(record)
    f.current_stage = 'Testing'
    f.mr_number = ''
    f.remarks = '  checked  '
    expect(diffPatch(record, f)).toEqual({ current_stage: 'Testing', mr_number: null, remarks: 'checked' })
  })
  it('never includes a field the form does not carry', () => {
    expect(diffPatch(record, { remarks: 'x', complaint: 'y' })).toEqual({ remarks: 'x' })
  })
})

describe('validateUpdateForm', () => {
  const ok = formFromRecord(record)
  it('accepts a normal form', () => {
    expect(validateUpdateForm(ok)).toEqual({ valid: true, errors: {} })
  })
  it('requires a detailed reason when the delay reason is Other', () => {
    expect(validateUpdateForm({ ...ok, delay_reason: 'Other', detailed_reason: '  ' }).errors.detailed_reason).toBe('detailRequired')
    expect(validateUpdateForm({ ...ok, delay_reason: 'Other', detailed_reason: 'Crane' }).valid).toBe(true)
  })
  it('refuses values outside the controlled lists, including Removed From Current Report', () => {
    const r = validateUpdateForm({ ...ok, current_stage: 'Removed From Current Report', delay_reason: 'x', parts_status: 'Lost' })
    expect(r.errors).toMatchObject({ current_stage: 'notInList', delay_reason: 'notInList', parts_status: 'notInList' })
  })
  it('checks dates are real and sensible', () => {
    expect(validateUpdateForm({ ...ok, expected_part_date: '2026-02-30' }).errors.expected_part_date).toBe('invalidDate')
    expect(validateUpdateForm({ ...ok, expected_part_date: '1990-01-01' }).errors.expected_part_date).toBe('dateRange')
    expect(validateUpdateForm({ ...ok, expected_part_date: '2026-10-25', expected_release_date: '2026-10-20' })
      .errors.expected_release_date).toBe('releaseBeforePart')
    expect(validateUpdateForm({ ...ok, expected_part_date: '2026-10-20', expected_release_date: '2026-10-20' }).valid).toBe(true)
  })
  it('limits text length', () => {
    expect(validateUpdateForm({ ...ok, remarks: 'x'.repeat(MAX_TEXT + 1) }).errors.remarks).toBe('tooLong')
    expect(validateUpdateForm({ ...ok, po_number: 'x'.repeat(101) }).errors.po_number).toBe('tooLong')
  })
})

describe('helpers', () => {
  it('isValidDateInput', () => {
    expect(isValidDateInput('2028-02-29')).toBe(true)
    expect(isValidDateInput('2027-02-29')).toBe(false)
    expect(isValidDateInput('20/10/2026')).toBe(false)
  })
  it('patchTouchesPeople', () => {
    expect(patchTouchesPeople({ responsible_user_id: null })).toBe(true)
    expect(patchTouchesPeople({ remarks: 'x' })).toBe(false)
  })
})
