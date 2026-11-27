import { describe, it, expect } from 'vitest'
import { canVerifyWash, nextWashDueOf, verificationLine } from '../lib/washVerification'

const pending = { id: 'w1', created_by: 'driver-1', verification_status: 'pending', wash_date: '2026-11-27' }

describe('wash verification rules', () => {
  it('a supervisor may verify a driver wash', () => {
    expect(canVerifyWash(pending, { id: 'sup-1', role: 'Fleet Supervisor' })).toBe(true)
    expect(canVerifyWash(pending, { id: 'm-1', role: 'Workshop Supervisor' })).toBe(true)
  })
  it('the person who logged it never may', () => {
    expect(canVerifyWash(pending, { id: 'driver-1', role: 'Fleet Supervisor' })).toBe(false)
    expect(canVerifyWash(pending, { id: 'driver-1', role: 'Admin' }, true)).toBe(false)
  })
  it('a driver or other role may not', () => {
    expect(canVerifyWash(pending, { id: 'd-2', role: 'Driver' })).toBe(false)
    expect(canVerifyWash(pending, { id: 't-2', role: 'Tyre Man' })).toBe(false)
  })
  it('only pending records can be verified', () => {
    for (const s of ['verified', 'not_required', undefined]) {
      expect(canVerifyWash({ ...pending, verification_status: s }, { id: 'sup-1', role: 'Manager' })).toBe(false)
    }
  })
  it('next wash is due one week after the wash', () => {
    expect(nextWashDueOf(pending)).toBe('2026-12-04')
    expect(nextWashDueOf({ wash_date: '2026-12-28' })).toBe('2027-01-04')
    expect(nextWashDueOf({ wash_date: '2026-11-27', next_wash_due: '2026-12-04' })).toBe('2026-12-04')
    expect(nextWashDueOf({})).toBeNull()
  })
  it('status lines', () => {
    expect(verificationLine(pending)).toMatch(/Waiting/)
    expect(verificationLine({ verification_status: 'not_required' })).toMatch(/supervisor/)
    expect(verificationLine({ verification_status: 'verified', verified_at: '2026-11-27T08:00:00Z' }, 'Ali')).toBe('Verified by Ali on 2026-11-27 08:00')
    expect(verificationLine({})).toMatch(/Not set up/)
  })
})
