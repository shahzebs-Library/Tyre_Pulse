import { describe, it, expect } from 'vitest'
import { summarizeCheckInOut } from '../lib/vehicleCheckInOut'

describe('summarizeCheckInOut', () => {
  it('returns zeroed counters for empty / invalid input', () => {
    const empty = { total: 0, out: 0, in: 0, currentlyOut: 0, returned: 0, assets: 0 }
    expect(summarizeCheckInOut([])).toEqual(empty)
    expect(summarizeCheckInOut(undefined)).toEqual(empty)
    expect(summarizeCheckInOut(null)).toEqual(empty)
    expect(summarizeCheckInOut('nope')).toEqual(empty)
  })

  it('counts by direction and defaults unknown direction to out', () => {
    const s = summarizeCheckInOut([
      { direction: 'out', asset_no: 'A1', status: 'open' },
      { direction: 'in', asset_no: 'A1', status: 'closed' },
      { direction: 'weird', asset_no: 'A2', status: 'open' },
    ])
    expect(s.total).toBe(3)
    expect(s.out).toBe(2) // 'out' + unknown -> out
    expect(s.in).toBe(1)
    expect(s.returned).toBe(1)
  })

  it('currentlyOut counts only open check-OUT events', () => {
    const s = summarizeCheckInOut([
      { direction: 'out', asset_no: 'A1', status: 'open' },   // out now
      { direction: 'out', asset_no: 'A2', status: 'closed' }, // returned already
      { direction: 'out', asset_no: 'A3' },                   // no status -> open
      { direction: 'in', asset_no: 'A4', status: 'open' },    // inbound, never "out"
    ])
    expect(s.currentlyOut).toBe(2)
  })

  it('counts distinct assets case-insensitively, ignoring blanks', () => {
    const s = summarizeCheckInOut([
      { direction: 'out', asset_no: 'TRK-01' },
      { direction: 'in', asset_no: 'trk-01' },
      { direction: 'out', asset_no: '  TRK-02 ' },
      { direction: 'out', asset_no: '' },
      { direction: 'out' },
    ])
    expect(s.assets).toBe(2)
  })

  it('skips null/non-object rows without throwing', () => {
    const s = summarizeCheckInOut([null, undefined, 5, { direction: 'out', asset_no: 'A1' }])
    expect(s.total).toBe(4)
    expect(s.out).toBe(1)
    expect(s.assets).toBe(1)
  })
})
