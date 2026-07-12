import { describe, it, expect } from 'vitest'
import { toFiniteNumber, summarisePods, byStatus, byDriver, POD_STATUSES } from '../lib/podRecords'

const sample = [
  { id: 1, status: 'delivered', customer_name: 'Acme', driver_name: 'Sam' },
  { id: 2, status: 'delivered', customer_name: 'acme', driver_name: 'Sam' },
  { id: 3, status: 'failed', customer_name: 'Globex', driver_name: 'Sam' },
  { id: 4, status: 'pending', customer_name: 'Initech', driver_name: 'Alex' },
  { id: 5, status: 'delivered', customer_name: 'Initech', driver_name: 'Alex' },
  { id: 6, status: 'returned', customer_name: '', driver_name: '' },
]

describe('podRecords — toFiniteNumber', () => {
  it('parses numeric strings and numbers', () => {
    expect(toFiniteNumber('12')).toBe(12)
    expect(toFiniteNumber(7)).toBe(7)
    expect(toFiniteNumber('3.5')).toBe(3.5)
    expect(toFiniteNumber('1,024')).toBe(1024)
  })

  it('returns null for empty / non-numeric / nullish input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('podRecords — summarisePods', () => {
  it('returns zeroed summary for empty / non-array input', () => {
    expect(summarisePods([])).toEqual({
      totalPods: 0, deliveredCount: 0, failedCount: 0, pendingCount: 0,
      deliveryRate: 0, distinctCustomers: 0,
    })
    expect(summarisePods()).toEqual({
      totalPods: 0, deliveredCount: 0, failedCount: 0, pendingCount: 0,
      deliveryRate: 0, distinctCustomers: 0,
    })
    expect(summarisePods(null).totalPods).toBe(0)
  })

  it('counts statuses and totals correctly', () => {
    const s = summarisePods(sample)
    expect(s.totalPods).toBe(6)
    expect(s.deliveredCount).toBe(3)
    expect(s.failedCount).toBe(1)
    expect(s.pendingCount).toBe(1)
  })

  it('computes deliveryRate as delivered/total in 0..100', () => {
    // 3 delivered of 6 = 50
    expect(summarisePods(sample).deliveryRate).toBe(50)
    // 1 delivered of 1 = 100
    expect(summarisePods([{ status: 'delivered', customer_name: 'X' }]).deliveryRate).toBe(100)
    // rounds to nearest integer: 1 of 3 ≈ 33
    expect(summarisePods([
      { status: 'delivered', customer_name: 'X' },
      { status: 'failed', customer_name: 'Y' },
      { status: 'pending', customer_name: 'Z' },
    ]).deliveryRate).toBe(33)
  })

  it('counts distinct customers case-insensitively, ignoring blanks', () => {
    // Acme/acme collapse to one; Globex, Initech; blank ignored → 3
    expect(summarisePods(sample).distinctCustomers).toBe(3)
  })
})

describe('podRecords — byStatus', () => {
  it('returns a count for every canonical status, zero when absent', () => {
    const counts = byStatus([])
    for (const s of POD_STATUSES) expect(counts[s]).toBe(0)
    expect(Object.keys(counts).sort()).toEqual([...POD_STATUSES].sort())
  })

  it('tallies statuses and ignores unknown/missing', () => {
    const counts = byStatus([
      ...sample,
      { status: 'bogus' },
      { status: null },
      {},
    ])
    expect(counts.delivered).toBe(3)
    expect(counts.failed).toBe(1)
    expect(counts.pending).toBe(1)
    expect(counts.returned).toBe(1)
    expect(counts.partial).toBe(0)
  })

  it('is case-insensitive on status', () => {
    const counts = byStatus([{ status: 'DELIVERED' }, { status: 'Delivered' }])
    expect(counts.delivered).toBe(2)
  })
})

describe('podRecords — byDriver', () => {
  it('returns [] for empty / non-array input', () => {
    expect(byDriver([])).toEqual([])
    expect(byDriver()).toEqual([])
    expect(byDriver(null)).toEqual([])
  })

  it('aggregates deliveries and failures per driver, ignoring blank drivers', () => {
    const result = byDriver(sample)
    const sam = result.find((d) => d.driver_name === 'Sam')
    const alex = result.find((d) => d.driver_name === 'Alex')
    expect(sam).toEqual({ driver_name: 'Sam', deliveries: 2, failed: 1 })
    expect(alex).toEqual({ driver_name: 'Alex', deliveries: 1, failed: 0 })
    // blank-driver returned row is ignored
    expect(result).toHaveLength(2)
  })

  it('sorts by deliveries desc, then driver_name asc', () => {
    const result = byDriver(sample)
    expect(result.map((d) => d.driver_name)).toEqual(['Sam', 'Alex'])

    // tie on deliveries → alphabetical
    const tied = byDriver([
      { status: 'delivered', driver_name: 'Zoe' },
      { status: 'delivered', driver_name: 'Ana' },
    ])
    expect(tied.map((d) => d.driver_name)).toEqual(['Ana', 'Zoe'])
  })
})
