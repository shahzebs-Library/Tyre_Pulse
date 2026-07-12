import { describe, it, expect } from 'vitest'
import { summarizeCustomers, isValidEmail } from '../lib/customers'

describe('summarizeCustomers', () => {
  it('returns zeroed counts for empty / invalid input', () => {
    expect(summarizeCustomers([])).toEqual({ active: 0, inactive: 0, prospect: 0, total: 0, types: 0 })
    expect(summarizeCustomers()).toEqual({ active: 0, inactive: 0, prospect: 0, total: 0, types: 0 })
    expect(summarizeCustomers(null)).toEqual({ active: 0, inactive: 0, prospect: 0, total: 0, types: 0 })
  })

  it('counts customers by status and totals the set', () => {
    const rows = [
      { status: 'active', customer_type: 'Fleet' },
      { status: 'active', customer_type: 'Workshop' },
      { status: 'inactive', customer_type: 'Fleet' },
      { status: 'prospect', customer_type: 'Partner' },
    ]
    const s = summarizeCustomers(rows)
    expect(s.active).toBe(2)
    expect(s.inactive).toBe(1)
    expect(s.prospect).toBe(1)
    expect(s.total).toBe(4)
    expect(s.types).toBe(3) // Fleet, Workshop, Partner
  })

  it('is case-insensitive on status and type, and total includes unknowns', () => {
    const rows = [
      { status: 'Active', customer_type: 'Fleet' },
      { status: 'ACTIVE', customer_type: 'fleet' }, // same type, different case
      { status: 'weird' }, // unknown status: counted in total only
      { customer_type: '  ' }, // blank type ignored
    ]
    const s = summarizeCustomers(rows)
    expect(s.active).toBe(2)
    expect(s.total).toBe(4)
    expect(s.types).toBe(1) // "fleet" collapsed
  })
})

describe('isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('ops@fleet.co')).toBe(true)
    expect(isValidEmail(' user@example.com ')).toBe(true)
  })

  it('rejects malformed or empty input', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('no-at-sign')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('a b@c.com')).toBe(false)
    expect(isValidEmail(null)).toBe(false)
    expect(isValidEmail(123)).toBe(false)
  })
})
