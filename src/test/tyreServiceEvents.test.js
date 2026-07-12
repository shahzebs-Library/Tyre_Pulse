import { describe, it, expect } from 'vitest'
import { summarizeServiceEvents, EVENT_TYPES } from '../lib/tyreServiceEvents'

describe('summarizeServiceEvents', () => {
  it('returns an empty summary for no rows', () => {
    const s = summarizeServiceEvents([])
    expect(s.total).toBe(0)
    expect(s.totalCost).toBe(0)
    expect(s.tyresServiced).toBe(0)
    expect(s.mostCommonType).toBeNull()
    EVENT_TYPES.forEach((t) => expect(s.byType[t]).toBe(0))
  })

  it('is defensive against non-array / null input', () => {
    expect(summarizeServiceEvents(null).total).toBe(0)
    expect(summarizeServiceEvents(undefined).total).toBe(0)
    expect(summarizeServiceEvents('nope').total).toBe(0)
  })

  it('counts events by type and totals the count', () => {
    const rows = [
      { event_type: 'rotation' },
      { event_type: 'rotation' },
      { event_type: 'repair' },
      { event_type: 'inspection' },
    ]
    const s = summarizeServiceEvents(rows)
    expect(s.total).toBe(4)
    expect(s.byType.rotation).toBe(2)
    expect(s.byType.repair).toBe(1)
    expect(s.byType.inspection).toBe(1)
    expect(s.mostCommonType).toBe('rotation')
  })

  it('sums cost across numeric and string values and rounds to cents', () => {
    const rows = [
      { event_type: 'repair', cost: 100 },
      { event_type: 'repair', cost: '49.50' },
      { event_type: 'inflation', cost: null },
      { event_type: 'other', cost: 'abc' },
    ]
    const s = summarizeServiceEvents(rows)
    expect(s.totalCost).toBe(149.5)
  })

  it('counts distinct tyres serviced by serial, ignoring blanks', () => {
    const rows = [
      { event_type: 'inspection', tyre_serial: 'T-1' },
      { event_type: 'rotation', tyre_serial: 'T-1' },
      { event_type: 'repair', tyre_serial: 'T-2' },
      { event_type: 'inflation', tyre_serial: '  ' },
      { event_type: 'other', asset_no: 'A-9' },
    ]
    const s = summarizeServiceEvents(rows)
    expect(s.tyresServiced).toBe(2)
  })

  it('maps unknown event types to "other"', () => {
    const s = summarizeServiceEvents([{ event_type: 'flux' }, { event_type: null }])
    expect(s.byType.other).toBe(2)
    expect(s.mostCommonType).toBe('other')
  })

  it('skips malformed rows without throwing', () => {
    const s = summarizeServiceEvents([null, 42, { event_type: 'repair', cost: 10 }])
    expect(s.total).toBe(3)
    expect(s.byType.repair).toBe(1)
    expect(s.totalCost).toBe(10)
  })
})
