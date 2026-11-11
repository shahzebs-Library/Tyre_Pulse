import { describe, it, expect } from 'vitest'
import { computeVendorPerformance, computeWorkshopPerformance } from '../lib/kpiEngine'

/**
 * F-E-11: an unmeasurable CPK must read N/A, never a flattering 0. A vendor or site
 * with no priced, measurable tyre used to come back avgCpk 0 (cpkBlock.avgCpk ?? 0),
 * which ranked an unpriced brand as the cheapest per km. It now stays null; the
 * composite score is unchanged because `avgCpk > 0` is false for null exactly as for 0.
 */
const unpriced = (o = {}) => ({
  serial_no: 'U1', asset_no: 'TM900', brand: 'NoPriceBrand', site: 'NHC',
  size: '315/80R22.5', issue_date: '2026-03-01', cost_per_tyre: null,
  km_at_fitment: null, km_at_removal: null, total_km: null, ...o,
})

describe('unmeasurable CPK is null, never a flattering 0', () => {
  it('computeVendorPerformance: an unpriced brand has avgCpk null and no cost score', () => {
    const [v] = computeVendorPerformance([unpriced()])
    expect(v.avgCpk).toBe(null)
    expect(v.brand).toBe('NoPriceBrand')
    // score contribution from CPK is 0 (null > 0 is false), never 1/0 = Infinity
    expect(Number.isFinite(v.score)).toBe(true)
  })

  it('computeWorkshopPerformance: an unpriced site has avgCpk null', () => {
    const { bySite } = computeWorkshopPerformance([unpriced()], [])
    const site = bySite.find((s) => s.site === 'NHC')
    expect(site.avgCpk).toBe(null)
    expect(Number.isFinite(site.score)).toBe(true)
  })
})
