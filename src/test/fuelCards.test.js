import { describe, it, expect } from 'vitest'
import {
  maskCardNumber,
  cardExpiryStatus,
  summarizeFuelCards,
  isCardAssigned,
} from '../lib/fuelCards'

describe('fuelCards pure lib - maskCardNumber', () => {
  it('shows only the last 4 digits of a full card number', () => {
    expect(maskCardNumber('4321123456789012')).toBe('•••• 9012')
  })

  it('ignores spaces/dashes when extracting the tail', () => {
    expect(maskCardNumber('4321 1234 5678 9012')).toBe('•••• 9012')
    expect(maskCardNumber('4321-1234-5678-9012')).toBe('•••• 9012')
  })

  it('accepts numeric input', () => {
    expect(maskCardNumber(4321123456789012)).toBe('•••• 9012')
  })

  it('returns short values (≤4 digits) unmasked', () => {
    expect(maskCardNumber('12')).toBe('12')
    expect(maskCardNumber('9012')).toBe('9012')
  })

  it('degrades gracefully on empty/nullish input', () => {
    expect(maskCardNumber('')).toBe('—')
    expect(maskCardNumber(null)).toBe('—')
    expect(maskCardNumber(undefined)).toBe('—')
  })
})

describe('fuelCards pure lib - cardExpiryStatus', () => {
  const now = new Date('2026-07-12T00:00:00Z')

  it('bands a card that expired in the past', () => {
    const res = cardExpiryStatus({ expiry_date: '2026-01-01' }, now)
    expect(res.band).toBe('expired')
    expect(res.days).toBeLessThan(0)
  })

  it('bands a card within the 30-day soon window as expiring', () => {
    const res = cardExpiryStatus({ expiry_date: '2026-07-30' }, now)
    expect(res.band).toBe('expiring')
    expect(res.days).toBe(18)
  })

  it('bands a card well in the future as valid', () => {
    const res = cardExpiryStatus({ expiry_date: '2027-07-12' }, now)
    expect(res.band).toBe('valid')
    expect(res.days).toBeGreaterThan(30)
  })

  it('returns unknown when there is no expiry date', () => {
    expect(cardExpiryStatus({}, now)).toEqual({ band: 'unknown', days: null })
    expect(cardExpiryStatus({ expiry_date: null }, now)).toEqual({ band: 'unknown', days: null })
  })

  it('returns unknown on an unparseable expiry date', () => {
    expect(cardExpiryStatus({ expiry_date: 'not-a-date' }, now)).toEqual({ band: 'unknown', days: null })
  })

  it('accepts a millisecond timestamp for now', () => {
    const res = cardExpiryStatus({ expiry_date: '2026-07-30' }, now.getTime())
    expect(res.band).toBe('expiring')
  })
})

describe('fuelCards pure lib - isCardAssigned', () => {
  it('is assigned when an asset is present', () => {
    expect(isCardAssigned({ asset_no: 'TRK-01' })).toBe(true)
  })
  it('is assigned when a driver is present', () => {
    expect(isCardAssigned({ driver_name: 'A. Khan' })).toBe(true)
  })
  it('is unassigned when neither is present', () => {
    expect(isCardAssigned({ asset_no: '', driver_name: '  ' })).toBe(false)
    expect(isCardAssigned({})).toBe(false)
  })
})

describe('fuelCards pure lib - summarizeFuelCards', () => {
  const rows = [
    { status: 'active', asset_no: 'TRK-01', monthly_limit: 1000 },
    { status: 'active', driver_name: 'A. Khan', monthly_limit: 500 },
    { status: 'blocked', asset_no: '', driver_name: '', monthly_limit: 250 },
    { status: 'expired', asset_no: 'TRK-09', monthly_limit: '750' },
    { status: 'unassigned', monthly_limit: null },
  ]

  it('counts by status', () => {
    const s = summarizeFuelCards(rows)
    expect(s.total).toBe(5)
    expect(s.byStatus).toEqual({ active: 2, blocked: 1, expired: 1, unassigned: 1 })
    expect(s.active).toBe(2)
  })

  it('splits assigned vs unassigned by asset/driver presence', () => {
    const s = summarizeFuelCards(rows)
    expect(s.assigned).toBe(3)
    expect(s.unassigned).toBe(2)
  })

  it('totals the monthly limit, coercing numeric strings and ignoring nulls', () => {
    const s = summarizeFuelCards(rows)
    expect(s.totalMonthlyLimit).toBe(2500)
  })

  it('handles empty / non-array input safely', () => {
    expect(summarizeFuelCards([])).toEqual({
      total: 0,
      byStatus: { active: 0, blocked: 0, expired: 0, unassigned: 0 },
      active: 0,
      assigned: 0,
      unassigned: 0,
      totalMonthlyLimit: 0,
    })
    expect(summarizeFuelCards(undefined).total).toBe(0)
  })
})
