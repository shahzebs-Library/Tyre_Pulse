import { describe, expect, it } from 'vitest'
import { normalizeReservationLines } from '../lib/api/stockReservations'

describe('work-order stock reservation contract', () => {
  it('merges duplicate stock lines before the atomic RPC', () => {
    expect(normalizeReservationLines([{ stock_id: 'a', qty: 2 }, { stock_id: 'a', qty: 3 }]))
      .toEqual([{ stock_id: 'a', qty: 5 }])
  })
  it('rejects missing items and unsafe quantities', () => {
    expect(() => normalizeReservationLines([])).toThrow()
    expect(() => normalizeReservationLines([{ stock_id: 'a', qty: 0 }])).toThrow()
    expect(() => normalizeReservationLines([{ stock_id: '', qty: 1 }])).toThrow()
  })
})
