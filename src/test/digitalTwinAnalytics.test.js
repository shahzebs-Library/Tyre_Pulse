import { describe, it, expect } from 'vitest'
import { enrichTwin, riskFor, layoutHint, filterPositions, sortPositions } from '../lib/digitalTwinAnalytics'

const twin = {
  asset_no: 'TM500',
  positions: [
    { id: 1, position: 'LHF1', serial: 'S1', health: 90 },
    { id: 2, position: 'RHF1', serial: 'S2', health: 40 },
    { id: 3, position: 'ZZ99', serial: 'S3', health: null },
  ],
}
const life = [
  { serial: 'S1', position: 'LHF1', vehicleType: 'TR-MIXER', unit: 'km', remainingKm: 0, lifeUsedPct: 110, expectedLifeKm: 80000, remainingDays: -5 },
  { serial: 'S2', position: 'RHF1', vehicleType: 'TR-MIXER', unit: 'km', remainingKm: 50000, lifeUsedPct: 30, expectedLifeKm: 80000, remainingDays: 200 },
]

describe('digitalTwinAnalytics', () => {
  it('prefers the vehicle type over the asset code as the layout hint', () => {
    expect(layoutHint('TR-MIXER', 'TM1')).toBe('TR-MIXER')
    expect(layoutHint('', 'TM1')).toBe('TM1')
  })

  it('maps life band to risk, falling back to health', () => {
    expect(riskFor('overdue', 99)).toBe('Critical')
    expect(riskFor(null, 90)).toBe('Low')
    expect(riskFor(null, null)).toBeNull()
  })

  it('joins running life, places tyres on the layout and counts the unplaced honestly', () => {
    const r = enrichTwin({ twin, lifeRows: life, assetNo: 'TM500' })
    expect(r.layoutKnown).toBe(true)
    expect(r.diagram).toEqual([{ position: 'F1L', risk_level: 'Critical' }, { position: 'F1R', risk_level: 'Low' }])
    expect(r.unplaced).toBe(1)
    expect(r.bandCounts.overdue).toBe(1)
    expect(r.bandCounts.healthy).toBe(1)
    expect(r.bandCounts.unknown).toBe(1)
    expect(r.dueCount).toBe(1)
    expect(r.measured).toBe(2)
    expect(r.lifeCoveragePct).toBe(67)
    expect(r.nextDue).toEqual({ position: 'LHF1', days: -5 })
  })

  it('draws no diagram for an unknown vehicle type', () => {
    const r = enrichTwin({ twin, lifeRows: [], assetNo: 'QQ1', vehicleType: 'MYSTERY RIG' })
    expect(r.layoutKnown).toBe(false)
    expect(r.diagram).toHaveLength(0)
    expect(r.unplaced).toBe(3)
    expect(r.positions.every((p) => p.band === 'unknown')).toBe(true)
  })

  it('filters and sorts positions with nulls last', () => {
    const r = enrichTwin({ twin, lifeRows: life, assetNo: 'TM500' })
    expect(filterPositions(r.positions, { band: 'overdue' })).toHaveLength(1)
    expect(filterPositions(r.positions, { search: 's2' })).toHaveLength(1)
    const byRem = sortPositions(r.positions, 'remaining', 'desc')
    expect(byRem[0].serial).toBe('S2')
    expect(byRem[2].remaining).toBeNull()
    expect(sortPositions(r.positions, 'band', 'asc')[0].band).toBe('overdue')
  })
})
