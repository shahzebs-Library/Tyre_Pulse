import { describe, it, expect } from 'vitest'
import { summarizeDispatch, loadStatusMeta, LOAD_STATUSES } from '../lib/dispatch'

describe('summarizeDispatch', () => {
  it('counts loads by status', () => {
    const s = summarizeDispatch([
      { status: 'planned' },
      { status: 'planned' },
      { status: 'dispatched' },
      { status: 'in_transit' },
      { status: 'delivered' },
      { status: 'cancelled' },
    ])
    expect(s.byStatus).toEqual({
      planned: 2, dispatched: 1, in_transit: 1, delivered: 1, cancelled: 1,
    })
    expect(s.total).toBe(6)
  })

  it('derives in-transit, delivered and active pipeline counts', () => {
    const s = summarizeDispatch([
      { status: 'planned' },
      { status: 'dispatched' },
      { status: 'in_transit' },
      { status: 'in_transit' },
      { status: 'delivered' },
      { status: 'cancelled' },
    ])
    expect(s.inTransit).toBe(2)
    expect(s.delivered).toBe(1)
    // active = planned + dispatched + in_transit (terminal states excluded)
    expect(s.active).toBe(4)
  })

  it('totals payload weight in kg and tonnes, coercing string values', () => {
    const s = summarizeDispatch([
      { status: 'planned', weight_kg: 1500 },
      { status: 'in_transit', weight_kg: '2 500' },
      { status: 'delivered', weight_kg: '1,000 kg' },
      { status: 'planned', weight_kg: null },
    ])
    expect(s.totalWeightKg).toBe(5000)
    expect(s.totalWeightTonnes).toBe(5)
  })

  it('ignores unknown statuses and non-array input safely', () => {
    const s = summarizeDispatch([{ status: 'bogus' }, {}, null])
    expect(s.total).toBe(3)
    expect(s.byStatus.planned).toBe(0)
    expect(s.active).toBe(0)

    const empty = summarizeDispatch()
    expect(empty.total).toBe(0)
    expect(empty.totalWeightKg).toBe(0)
    expect(empty.totalWeightTonnes).toBe(0)
    expect(summarizeDispatch(undefined).byStatus.delivered).toBe(0)
  })

  it('exposes status metadata + lifecycle for every status', () => {
    for (const st of LOAD_STATUSES) {
      expect(loadStatusMeta[st]).toBeTruthy()
      expect(typeof loadStatusMeta[st].label).toBe('string')
      expect(typeof loadStatusMeta[st].cls).toBe('string')
    }
    expect(LOAD_STATUSES).toContain('in_transit')
  })
})
