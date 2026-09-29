import { describe, it, expect } from 'vitest'
import {
  statusMeta, conditionMeta, recordLifeKm, currentKmFor, lifeKmFor, cpkOf, averageLife,
  distinctOptions, activeFilterCount, buildFleetMap, fleetFor, latestInspectionByAsset,
  lifeUsage, matchRunningRow, kmTrend, costRows, currencyOf,
} from '../lib/tyreRecordsView'

describe('tyreRecordsView', () => {
  it('maps the three stored statuses and never invents one', () => {
    expect(statusMeta('Active').label).toBe('In use')
    expect(statusMeta('scrapped').tone).toBe('bad')
    expect(statusMeta('Mystery').label).toBe('Mystery')
    expect(statusMeta('').label).toBe('Not recorded')
    expect(conditionMeta(null)).toBeNull()
    expect(conditionMeta('Low')).toEqual({ label: 'Low', tone: 'good' })
  })

  it('reads recorded life, falling back to the odometer span, else null', () => {
    expect(recordLifeKm({ total_km: 42000 })).toBe(42000)
    expect(recordLifeKm({ total_km: 0, km_at_fitment: 1000, km_at_removal: 5000 })).toBe(4000)
    expect(recordLifeKm({ km_at_fitment: 5000, km_at_removal: 1000 })).toBeNull()
    expect(recordLifeKm({})).toBeNull()
  })

  it('reads the vehicle odometer for an active tyre and the removal odometer otherwise', () => {
    const fleet = { current_km: 30000 }
    expect(currentKmFor({ status: 'Active' }, fleet)).toEqual({ value: 30000, basis: 'vehicle' })
    expect(currentKmFor({ status: 'Active' }, null)).toEqual({ value: null, basis: null })
    expect(currentKmFor({ status: 'Removed', km_at_removal: 21000 }, fleet)).toEqual({ value: 21000, basis: 'removal' })
    expect(lifeKmFor({ status: 'Active', km_at_fitment: 10000 }, fleet)).toBe(20000)
    expect(lifeKmFor({ status: 'Removed', total_km: 5 }, fleet)).toBe(5)
  })

  it('computes cost per km only when both sides exist', () => {
    expect(cpkOf({ cost_per_tyre: 1000, total_km: 50000 })).toBeCloseTo(0.02)
    expect(cpkOf({ cost_per_tyre: null, total_km: 50000 })).toBeNull()
    expect(cpkOf({ cost_per_tyre: 1000 })).toBeNull()
  })

  it('averages positive lives only and reports its sample', () => {
    expect(averageLife([10, 20, 0, null, 'x'])).toEqual({ avg: 15, n: 2 })
    expect(averageLife([])).toEqual({ avg: null, n: 0 })
  })

  it('keeps option values raw (padded values still match) and drops blanks', () => {
    expect(distinctOptions([{ s: 'LHF1 ' }, { s: 'LHF1 ' }, { s: '' }, { s: '  ' }, { s: 'A1' }], 's')).toEqual(['A1', 'LHF1 '])
    expect(activeFilterCount({ siteFilter: 'NHC', statusFilter: '', sizeFilter: 'x' })).toBe(2)
  })

  it('matches a vehicle on asset and country, never across countries', () => {
    const map = buildFleetMap([{ asset_no: 'GN103', country: 'KSA', make: 'CAT' }, { asset_no: 'GN103', country: 'UAE', make: 'Sany' }])
    expect(fleetFor(map, { asset_no: 'gn103', country: 'UAE' }).make).toBe('Sany')
    expect(fleetFor(map, { asset_no: 'GN103', country: 'Egypt' })).toBeNull()
    expect(fleetFor(map, { asset_no: 'GN103' }).make).toBe('CAT')
  })

  it('takes the newest inspection per asset', () => {
    const m = latestInspectionByAsset([
      { asset_no: 'TM1', inspection_date: '2026-01-02' },
      { asset_no: 'tm1', completed_date: '2026-03-04T10:00:00Z' },
    ])
    expect(m.get('TM1')).toBe('2026-03-04')
  })

  it('reads usage from the running-life row, and a finished tyre has no remaining', () => {
    const run = { currentKm: 30000, kmRun: 20000, expectedLifeKm: 60000, lifeUsedPct: 120, remainingKm: 0 }
    expect(lifeUsage({ status: 'Active' }, run)).toMatchObject({ usedPct: 100, remainingKm: 0, basis: 'running' })
    expect(lifeUsage({ status: 'Removed', total_km: 40000, km_at_removal: 90000 }, null))
      .toMatchObject({ runKm: 40000, remainingKm: null, usedPct: null, basis: 'finished' })
    expect(matchRunningRow([{ serial: 'ab1', position: 'X' }, { serial: '', position: 'LHF1' }], { serial_no: 'AB1' }).serial).toBe('ab1')
    expect(matchRunningRow([{ serial: '', position: 'LHF1' }], { position: 'lhf1' }).position).toBe('LHF1')
  })

  it('builds a monthly km trend since fitment from the highest reading per month', () => {
    const t = kmTrend([
      { reading_date: '2026-01-05', odometer_km: 11000 },
      { reading_date: '2026-01-20', odometer_km: 12000 },
      { reading_date: '2026-02-10', odometer_km: 15000 },
      { reading_date: '2026-02-11', odometer_km: null },
    ], 10000)
    expect(t).toEqual([{ month: '2026-01', km: 2000 }, { month: '2026-02', km: 5000 }])
  })

  it('lists cost lines per record in the record country currency and never totals them', () => {
    const rows = costRows({ events: [{ id: 1, date: '2026-01-01', cost: 900, asset_no: 'TM1' }, { id: 2, cost: null }], serviceEvents: [], retreadClaims: [] }, [{ id: 1, country: 'UAE' }])
    expect(rows).toHaveLength(1)
    expect(currencyOf(rows[0].country)).toBe('AED')
    expect(currencyOf('Mars')).toBeNull()
  })
})
