import { describe, expect, it } from 'vitest'
import {
  optimizeFleet, enrichRotationAssets, filterRotationAssets, rotationPageKpis, flattenSwaps,
  mostImbalanced, rotationExportRows, rotationSiteOptions, activeRotationFilterCount,
  EMPTY_ROTATION_FILTERS,
} from '../lib/rotationOptimizer'

const rows = [
  { id: 1, asset_no: 'TRK-1', serial_no: 'A1', position: 'LHF1', tread_depth: 3, size: '315', site: 'RUH' },
  { id: 2, asset_no: 'TRK-1', serial_no: 'A2', position: 'RHR1', tread_depth: 12, size: '315', site: 'RUH' },
  { id: 3, asset_no: 'TRK-1', serial_no: 'A3', position: 'LHR1', tread_depth: 10, size: '315', site: 'JED' },
  { id: 4, asset_no: 'TRK-2', serial_no: 'B1', position: 'LHR1', tread_depth: 8, size: '315', site: 'JED' },
  { id: 5, asset_no: 'TRK-2', serial_no: 'B2', position: 'RHR1', tread_depth: 8.5, size: '315', site: 'JED' },
  { id: 6, asset_no: 'TRK-3', serial_no: 'C1', position: 'LHR1', tread_depth: 1.2, size: '315', site: 'DMM' },
  { id: 7, asset_no: 'TRK-3', serial_no: 'C2', position: 'RHR1', tread_depth: 1.4, size: '315', site: 'DMM' },
]

const build = () => {
  const { assets } = optimizeFleet(rows)
  return enrichRotationAssets(assets, rows)
}

describe('rotationOptimizer page shaping', () => {
  it('attaches the dominant site and the fitted tyres, most worn first', () => {
    const e = build()
    const t1 = e.find((a) => a.asset_no === 'TRK-1')
    expect(t1.site).toBe('RUH')
    expect(t1.tyres.map((t) => t.serial_no)).toEqual(['A1', 'A3', 'A2'])
    expect(t1._benefitKm).toBeGreaterThan(0)
    expect(e.find((a) => a.asset_no === 'TRK-2')._benefitKm).toBeNull()
    expect(rotationSiteOptions(e)).toEqual(['DMM', 'JED', 'RUH'])
  })

  it('filters by priority, status, site and serial search', () => {
    const e = build()
    expect(filterRotationAssets(e, { ...EMPTY_ROTATION_FILTERS, priority: 'needs' }).map((a) => a.asset_no)).toEqual(['TRK-1'])
    expect(filterRotationAssets(e, { ...EMPTY_ROTATION_FILTERS, status: 'critical' }).map((a) => a.asset_no)).toContain('TRK-3')
    expect(filterRotationAssets(e, { ...EMPTY_ROTATION_FILTERS, site: 'JED' }).map((a) => a.asset_no)).toEqual(['TRK-2'])
    expect(filterRotationAssets(e, { ...EMPTY_ROTATION_FILTERS, search: 'b2' }).map((a) => a.asset_no)).toEqual(['TRK-2'])
    expect(activeRotationFilterCount({ ...EMPTY_ROTATION_FILTERS, site: 'JED', status: 'good' })).toBe(2)
  })

  it('computes page KPIs and keeps unmeasurable figures null', () => {
    const k = rotationPageKpis(build())
    expect(k.assets).toBe(3)
    expect(k.needing).toBe(1)
    expect(k.belowLegal).toBe(2)
    expect(k.swaps).toBeGreaterThan(0)
    expect(k.benefitKm).toBeGreaterThan(0)
    const empty = rotationPageKpis([])
    expect(empty.benefitKm).toBeNull()
    expect(empty.avgWearBalance).toBeNull()
  })

  it('flattens swaps, ranks imbalance and exports every asset', () => {
    const e = build()
    const swaps = flattenSwaps(e)
    expect(swaps.length).toBeGreaterThan(0)
    expect(swaps.every((s) => s.asset_no === 'TRK-1')).toBe(true)
    expect(mostImbalanced(e)[0].asset_no).toBe('TRK-1')
    const out = rotationExportRows(e)
    expect(out.filter((r) => r.asset_no === 'TRK-2')).toHaveLength(1)
    expect(out.find((r) => r.asset_no === 'TRK-2').from).toBe('')
  })
})
