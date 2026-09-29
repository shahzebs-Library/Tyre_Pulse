import { describe, it, expect } from 'vitest'
import {
  passportCurrency, ageMonths, kmInfo, cpkSeries, inspectionRowsForTyre, latestPressure,
  movementRows, lifecycleSteps, warrantySummary, treadInfo, healthCoverage, statusTone,
} from '../lib/tyrePassportView'

describe('tyrePassportView', () => {
  it('passportCurrency never blends countries', () => {
    expect(passportCurrency([{ country: 'UAE' }, { country: 'UAE' }], 'SAR')).toMatchObject({ currency: 'AED', mixed: false })
    expect(passportCurrency([{ country: 'KSA' }, { country: 'Egypt' }], 'SAR')).toMatchObject({ currency: null, mixed: true })
    expect(passportCurrency([{}], 'SAR')).toMatchObject({ currency: 'SAR', mixed: false })
  })

  it('ageMonths and kmInfo stay null when unmeasured', () => {
    expect(ageMonths(null)).toBeNull()
    expect(ageMonths(61)).toBe(2)
    expect(kmInfo({ totals: { km: 0 } })).toEqual({ km: null, estLife: null, pct: null })
    expect(kmInfo({ totals: { km: 1000 }, predictions: {} })).toEqual({ km: 1000, estLife: null, pct: null })
    expect(kmInfo({ totals: { km: 1000 }, predictions: { projectedRemainingKm: 3000 } })).toEqual({ km: 1000, estLife: 4000, pct: 25 })
  })

  it('cpkSeries needs two stints with a CPK', () => {
    expect(cpkSeries([{ cpk: 0.1, fitted: '2026-01-01' }])).toEqual([])
    expect(cpkSeries([{ cpk: 0.2, fitted: '2026-02-01' }, { cpk: 0.1, fitted: '2026-01-01' }, { cpk: null }])).toEqual([0.1, 0.2])
  })

  it('treadInfo flags an assumed new tread', () => {
    expect(treadInfo({ wear: {} }).current).toBeNull()
    expect(treadInfo({ wear: { currentTread: 10, initialTread: 16, treadRemainingPct: 54 }, treadSeries: [{ tread: 10 }] }).assumed).toBe(true)
    expect(treadInfo({ wear: { currentTread: 10, initialTread: 15, treadRemainingPct: 58 }, treadSeries: [{ tread: 15 }, { tread: 10 }] }).assumed).toBe(false)
  })

  it('inspectionRowsForTyre keeps only readings tied to this tyre', () => {
    const journey = [{ asset_no: 'TM-1', position: 'LHRO', fitted: '2026-01-01', removed: '2026-03-01' }]
    const rows = inspectionRowsForTyre({
      serial: 'SN-1',
      journey,
      now: new Date('2026-06-01'),
      inspections: [
        { id: 'a', asset_no: 'TM-1', inspection_date: '2026-02-01', tyre_conditions: { LHRO: { condition: 'Good', tread_depth: 12, pressure_psi: 110 } } },
        { id: 'b', asset_no: 'TM-1', inspection_date: '2026-04-01', tyre_conditions: { LHRO: { condition: 'Worn' } } },
        { id: 'c', asset_no: 'TM-9', inspection_date: '2026-05-01', tyre_serial: 'sn-1', pressure_reading: 100 },
        { id: 'd', asset_no: 'TM-1', inspection_date: '2026-02-02', tyre_conditions: { RHRO: { condition: 'Good' } } },
      ],
    })
    expect(rows.map((r) => r.id)).toEqual(['c', 'a'])
    expect(rows[1]).toMatchObject({ basis: 'position', tread: 12, pressure: 110, condition: 'Good' })
    expect(rows[0]).toMatchObject({ basis: 'serial', pressure: 100 })
  })

  it('latestPressure picks the newest reading from any source', () => {
    const p = { events: [{ pressure: 100, date: '2026-01-01' }], serviceEvents: [{ pressure: 105, date: '2026-02-01' }] }
    expect(latestPressure(p, [{ pressure: 110, date: '2026-03-01' }])).toMatchObject({ value: 110, source: 'Inspection' })
    expect(latestPressure({ events: [] }, [])).toMatchObject({ value: null })
  })

  it('movementRows labels fitted, rotated, moved and removed, newest first', () => {
    const rows = movementRows([
      { id: 1, asset_no: 'A', position: 'L1', fitment_date: '2026-01-01', removal_date: '2026-02-01', km_at_fitment: 0, km_at_removal: 100 },
      { id: 2, asset_no: 'A', position: 'R1', fitment_date: '2026-02-01', removal_date: '2026-03-01' },
      { id: 3, asset_no: 'B', position: 'R1', fitment_date: '2026-03-02' },
    ])
    expect(rows[0]).toMatchObject({ action: 'Moved', current: true })
    expect(rows.filter((r) => r.action === 'Removed').length).toBe(2)
    expect(rows.find((r) => r.action === 'Rotated')).toBeTruthy()
  })

  it('lifecycleSteps adds an estimate only when computable', () => {
    const base = { events: [{ km_at_fitment: 0 }], journey: [{}], firstFittedDate: '2026-01-01', totals: { km: 500 }, predictions: {} }
    expect(lifecycleSteps(base).map((s) => s.key)).toEqual(['fitted', 'service'])
    const est = lifecycleSteps({ ...base, predictions: { projectedRemainingKm: 1000, projectedReplacementDate: '2027-01-01' } })
    expect(est.at(-1)).toMatchObject({ key: 'limit', estimate: true })
    expect(lifecycleSteps({ ...base, scrapped: true, scrapReason: 'Worn' }).at(-1)).toMatchObject({ key: 'removed', sub: 'Worn' })
  })

  it('warranty, coverage and tone helpers', () => {
    expect(warrantySummary({ warranty: [] })).toEqual({ count: 0, latest: null })
    expect(warrantySummary({ warranty: [{ claim_no: 'A', credit_date: '2026-01-01' }, { claim_no: 'B', credit_date: '2026-05-01' }] }).latest.claim_no).toBe('B')
    expect(healthCoverage({ components: { a: { hasData: true }, b: { hasData: false } } })).toEqual({ measured: 1, total: 2 })
    expect(statusTone('Scrapped')).toBe('bad')
    expect(statusTone('in_service')).toBe('good')
  })
})
