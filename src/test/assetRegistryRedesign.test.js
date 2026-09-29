import { describe, it, expect } from 'vitest'
import {
  conditionBand, isAtRisk, averageHealth, completenessPct, utilizationIndex, utilizationFor,
  utilizationBand, healthRow, healthUtilGrid, inGridCell, compositionSegments, complianceStatus,
  inspectionStatus, latestInspectionIndex, latestInspectionFor,
} from '../lib/assetManagementAnalytics'

const NOW = new Date('2026-09-28T00:00:00Z')

describe('conditionBand', () => {
  it('bands the health score and keeps unknown unknown', () => {
    expect(conditionBand(80)).toBe('good')
    expect(conditionBand(79)).toBe('monitor')
    expect(conditionBand(50)).toBe('monitor')
    expect(conditionBand(49)).toBe('critical')
    expect(conditionBand(0)).toBe('critical')
    expect(conditionBand(null)).toBe('none')
    expect(conditionBand('')).toBe('none')
  })
})

describe('isAtRisk / averageHealth / completenessPct', () => {
  it('flags low health or a High/Critical tyre', () => {
    expect(isAtRisk({ _healthScore: 49 })).toBe(true)
    expect(isAtRisk({ _healthScore: 90, _worstRisk: 'High' })).toBe(true)
    expect(isAtRisk({ _healthScore: 90, _worstRisk: 'Medium' })).toBe(false)
    expect(isAtRisk({ _healthScore: null, _worstRisk: null })).toBe(false)
  })
  it('averages only scored assets, null when none', () => {
    expect(averageHealth([{ _healthScore: 80 }, { _healthScore: 60 }, { _healthScore: null }])).toBe(70)
    expect(averageHealth([{ _healthScore: null }])).toBeNull()
  })
  it('counts assets with make, model, site and type all recorded', () => {
    expect(completenessPct([{ make: 'a', model: 'b', site: 'c', vehicle_type: 'd' }, { make: 'a' }])).toBe(50)
    expect(completenessPct([])).toBeNull()
  })
})

describe('utilisation', () => {
  const idx = utilizationIndex([
    { asset_no: 'tm1', country: 'KSA', utilization_pct: 40, captured_at: '2026-08-01' },
    { asset_no: 'TM1', country: 'KSA', utilization_pct: 70, captured_at: '2026-09-01' },
    { asset_no: 'TM1', country: 'UAE', utilization_pct: 10, captured_at: '2026-09-01' },
    { asset_no: 'PL1', country: null, utilization_pct: 25, captured_at: '2026-09-01' },
    { asset_no: 'X', country: 'KSA', utilization_pct: null },
  ])
  it('takes the latest reading per asset and country', () => {
    expect(utilizationFor(idx, { asset_no: 'TM1', country: 'KSA' })).toBe(70)
    expect(utilizationFor(idx, { asset_no: 'TM1', country: 'UAE' })).toBe(10)
  })
  it('never lends one country\'s reading to another; a country-less reading matches on code', () => {
    expect(utilizationFor(idx, { asset_no: 'TM1', country: 'Egypt' })).toBeNull()
    expect(utilizationFor(idx, { asset_no: 'PL1', country: 'KSA' })).toBe(25)
    expect(utilizationFor(idx, { asset_no: 'X', country: 'KSA' })).toBeNull()
  })
  it('bands utilisation on the 30/70 scale', () => {
    expect(utilizationBand(30)).toBe('low')
    expect(utilizationBand(31)).toBe('medium')
    expect(utilizationBand(70)).toBe('medium')
    expect(utilizationBand(71)).toBe('high')
    expect(utilizationBand(null)).toBeNull()
  })
})

describe('healthUtilGrid', () => {
  const util = { A: 20, B: 90, C: null, D: 50 }
  const utilOf = (a) => util[a.asset_no] ?? null
  const assets = [
    { asset_no: 'A', _healthScore: 90 },
    { asset_no: 'B', _healthScore: 30 },
    { asset_no: 'C', _healthScore: 60 },
    { asset_no: 'D', _healthScore: null },
  ]
  it('places only assets that have both measures and counts the rest', () => {
    const g = healthUtilGrid(assets, utilOf)
    expect(g.cells['high:low']).toBe(1)
    expect(g.cells['low:high']).toBe(1)
    expect(g.placed).toBe(2)
    expect(g.unplaced).toBe(2)
    expect(g.noHealth).toBe(1)
    expect(g.noUtil).toBe(1)
  })
  it('filters by cell', () => {
    expect(inGridCell(assets[0], 'high:low', utilOf)).toBe(true)
    expect(inGridCell(assets[2], 'medium:low', utilOf)).toBe(false)
    expect(inGridCell(assets[2], '', utilOf)).toBe(true)
    expect(healthRow(null)).toBeNull()
  })
})

describe('compositionSegments', () => {
  it('keeps the largest categories and folds the rest into Other', () => {
    const list = [...Array(5).fill('A'), ...Array(4).fill('B'), ...Array(3).fill('C'), 'D', 'Other']
    const segs = compositionSegments(list.map((c) => ({ c })), (a) => a.c, { max: 3 })
    expect(segs.map((s) => s.label)).toEqual(['A', 'B', 'Other'])
    expect(segs[2].count).toBe(5)
    expect(segs[2].members).toEqual(['Other', 'C', 'D'])
  })
})

describe('complianceStatus', () => {
  it('reads the recorded expiry dates', () => {
    expect(complianceStatus({}, NOW)).toBe('none')
    expect(complianceStatus({ insurance_expiry: '2026-09-01' }, NOW)).toBe('expired')
    expect(complianceStatus({ insurance_expiry: '2026-10-10', mvip_expiry: '2027-05-01' }, NOW)).toBe('expiring')
    expect(complianceStatus({ operating_card_expiry: '2027-05-01' }, NOW)).toBe('compliant')
    expect(complianceStatus({ insurance_expiry: 'not a date' }, NOW)).toBe('none')
  })
})

describe('inspections', () => {
  it('status is overdue past 30 days, null when never', () => {
    expect(inspectionStatus('2026-09-20', NOW)).toBe('on_schedule')
    expect(inspectionStatus('2026-08-01', NOW)).toBe('overdue')
    expect(inspectionStatus(null, NOW)).toBeNull()
  })
  it('indexes the latest date per asset and country', () => {
    const idx = latestInspectionIndex([
      { asset_no: 'tm1', country: 'KSA', inspection_date: '2026-09-01' },
      { asset_no: 'TM1', country: 'KSA', inspection_date: '2026-09-10' },
      { asset_no: 'TM1', country: 'UAE', inspection_date: '2026-09-20' },
      { asset_no: 'PL1', country: null, inspection_date: '2026-09-05' },
    ])
    expect(latestInspectionFor(idx, { asset_no: 'TM1', country: 'KSA' })).toBe('2026-09-10')
    expect(latestInspectionFor(idx, { asset_no: 'TM1', country: 'Egypt' })).toBeNull()
    expect(latestInspectionFor(idx, { asset_no: 'PL1', country: 'KSA' })).toBe('2026-09-05')
  })
})
