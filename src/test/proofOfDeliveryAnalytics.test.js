import { describe, it, expect } from 'vitest'
import {
  evidenceOf, summarizePodRegister, driverReliability, filterPods,
} from '../lib/proofOfDeliveryAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z').getTime()

const rows = [
  { id: 1, status: 'delivered', driver_name: 'Ali', customer_name: 'A', signature_url: 'https://x/s', photo_url: 'https://x/p', items_count: 4, delivered_at: '2026-09-20T08:00:00Z' },
  { id: 2, status: 'failed', driver_name: 'Ali', customer_name: 'B', delivered_at: '2026-07-01T08:00:00Z' },
  { id: 3, status: 'pending', driver_name: 'Omar', customer_name: 'b', signature_url: 'https://x/s2' },
  { id: 4, status: 'partial', driver_name: 'Omar', customer_name: 'C', photo_url: 'https://x/p2', items_count: '2', delivered_at: '2026-09-25T08:00:00Z' },
]

describe('evidenceOf', () => {
  it('classifies the evidence captured', () => {
    expect(evidenceOf(rows[0])).toBe('both')
    expect(evidenceOf(rows[1])).toBe('none')
    expect(evidenceOf(rows[2])).toBe('signature')
    expect(evidenceOf(rows[3])).toBe('photo')
    expect(evidenceOf({ signature_url: '   ' })).toBe('none')
  })
})

describe('summarizePodRegister', () => {
  it('computes rates over decided deliveries only', () => {
    const s = summarizePodRegister(rows, NOW)
    expect(s.totalPods).toBe(4)
    expect(s.deliveryRate).toBeCloseTo(33.3, 1) // 1 delivered of 3 decided
    expect(s.exceptions).toBe(2)
    expect(s.exceptionRate).toBeCloseTo(66.7, 1)
    expect(s.evidenceRate).toBe(75)
    expect(s.noEvidence).toBe(1)
    expect(s.itemsTotal).toBe(6)
    expect(s.last30).toBe(2)
    expect(s.distinctCustomers).toBe(3)
  })
  it('returns N/A (null) rather than 0% when nothing is measured', () => {
    const s = summarizePodRegister([], NOW)
    expect(s.deliveryRate).toBeNull()
    expect(s.exceptionRate).toBeNull()
    expect(s.evidenceRate).toBeNull()
    expect(s.itemsTotal).toBeNull()
    const pendingOnly = summarizePodRegister([{ status: 'pending' }], NOW)
    expect(pendingOnly.deliveryRate).toBeNull()
  })
})

describe('driverReliability', () => {
  it('adds a success rate, null when a driver has no outcome', () => {
    const d = driverReliability(rows)
    const ali = d.find(x => x.driver_name === 'Ali')
    const omar = d.find(x => x.driver_name === 'Omar')
    expect(ali.successRate).toBe(50)
    expect(omar.successRate).toBeNull()
  })
})

describe('filterPods', () => {
  it('filters by status, driver, evidence, date and search', () => {
    expect(filterPods(rows, { status: 'failed' }).map(r => r.id)).toEqual([2])
    expect(filterPods(rows, { driver: 'Omar' }).map(r => r.id)).toEqual([3, 4])
    expect(filterPods(rows, { evidence: 'none' }).map(r => r.id)).toEqual([2])
    expect(filterPods(rows, { from: '2026-09-01', to: '2026-09-30' }).map(r => r.id)).toEqual([1, 4])
    expect(filterPods(rows, { search: 'c' }).map(r => r.id)).toEqual([4])
  })
})
