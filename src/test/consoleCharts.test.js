import { describe, it, expect } from 'vitest'
import { dailySeries, topShare } from '../lib/consoleCharts'

describe('consoleCharts', () => {
  const now = new Date('2026-09-24T12:00:00Z')
  it('zero-fills every day in the window, ending today', () => {
    const s = dailySeries([{ d: '2026-09-24T01:00:00Z' }, { d: '2026-09-24T09:00:00Z' }, { d: '2026-09-22T09:00:00Z' }], (r) => r.d, 3, undefined, now)
    expect(s.keys).toEqual(['2026-09-22', '2026-09-23', '2026-09-24'])
    expect(s.values).toEqual([1, 0, 2])
    expect(s.total).toBe(3)
  })
  it('ignores rows outside the window and unparseable dates', () => {
    const s = dailySeries([{ d: '2020-01-01' }, { d: 'nope' }], (r) => r.d, 7, undefined, now)
    expect(s.total).toBe(0)
  })
  it('sums a value instead of counting when asked', () => {
    const s = dailySeries([{ d: '2026-09-24', v: 2.5 }, { d: '2026-09-24', v: '1' }], (r) => r.d, 1, (r) => r.v, now)
    expect(s.values).toEqual([3.5])
  })
  it('keeps the top n and groups the rest as Other', () => {
    const rows = ['a', 'a', 'a', 'b', 'b', 'c', 'd', null].map((role) => ({ role }))
    expect(topShare(rows, (r) => r.role, 2)).toEqual([
      { label: 'a', value: 3 }, { label: 'b', value: 2 }, { label: 'Other', value: 3 },
    ])
  })
})
