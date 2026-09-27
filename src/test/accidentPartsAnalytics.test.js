import { describe, it, expect } from 'vitest'
import { summarizeAccidentParts, filterAccidentParts, partStatus } from '../lib/accidentPartsAnalytics'

const parts = [
  { part_name: 'Front bumper', part_number: 'FB-1', supplier: 'Sany', status: 'needed', total_cost: 1200 },
  { part_name: 'Headlamp', status: 'ordered', total_cost: null },
  { part_name: 'Mirror', status: 'fitted', total_cost: '300.5' },
  { part_name: 'Odd', status: 'lost', total_cost: 0 },
]

describe('accidentPartsAnalytics', () => {
  it('summarises parts with honest totals', () => {
    const s = summarizeAccidentParts(parts)
    expect(s).toMatchObject({ count: 4, total: 1500.5, uncosted: 1, outstanding: 2, outstandingValue: 1200, fittedPct: 25 })
    expect(s.byStatus).toEqual({ needed: 1, ordered: 1, received: 0, fitted: 1, other: 1 })
  })

  it('returns null money when nothing is costed', () => {
    const s = summarizeAccidentParts([{ status: 'needed', total_cost: '' }])
    expect(s.total).toBeNull()
    expect(s.outstandingValue).toBeNull()
    expect(summarizeAccidentParts([]).fittedPct).toBeNull()
  })

  it('filters by search and status', () => {
    expect(filterAccidentParts(parts, { search: 'sany' })).toHaveLength(1)
    expect(filterAccidentParts(parts, { status: 'fitted' }).map((p) => p.part_name)).toEqual(['Mirror'])
    expect(partStatus({ status: 'LOST' })).toBe('other')
  })
})
