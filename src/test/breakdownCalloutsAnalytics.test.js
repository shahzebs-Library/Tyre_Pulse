import { describe, it, expect } from 'vitest'
import {
  filterCallouts, calloutKpis, costByCurrency, calloutsByType, providerPerformance,
  fmtMinutes, calloutExportRows, calloutTableRows, activeCalloutFilterCount,
  EMPTY_CALLOUT_FILTERS, countryOptions, isCalloutOpen,
} from '../lib/breakdownCalloutsAnalytics'

const ROWS = [
  { id: 1, callout_no: 'C1', asset_no: 'TRK-1', country: 'KSA', breakdown_type: 'tyre', severity: 'critical', status: 'reported', reported_at: '2026-09-01T08:00:00Z', dispatched_at: '2026-09-01T08:30:00Z', provider: 'RoadCare', cost: 800, currency: 'SAR' },
  { id: 2, callout_no: 'C2', asset_no: 'TRK-2', country: 'UAE', breakdown_type: 'engine', severity: 'medium', status: 'resolved', reported_at: '2026-09-02T08:00:00Z', dispatched_at: '2026-09-02T10:00:00Z', resolved_at: '2026-09-02T12:00:00Z', provider: 'RoadCare', cost: 500, currency: 'AED' },
  { id: 3, callout_no: 'C3', asset_no: 'TRK-3', country: 'KSA', breakdown_type: 'tyre', severity: 'low', status: 'cancelled', provider: 'FixIt' },
  { id: 4, callout_no: 'C4', asset_no: 'TRK-4', country: 'KSA', status: 'dispatched', cost: 200, currency: 'SAR' },
]

describe('breakdownCalloutsAnalytics', () => {
  it('never blends currencies into one cost total', () => {
    const costs = costByCurrency(ROWS)
    expect(costs).toEqual([{ currency: 'SAR', total: 1000 }, { currency: 'AED', total: 500 }])
    const k = calloutKpis(ROWS)
    expect(k.mixedCurrency).toBe(true)
    expect(k.singleCurrencyCost).toBeNull()
    const ksa = calloutKpis(ROWS.filter((r) => r.country === 'KSA'))
    expect(ksa.singleCurrencyCost).toEqual({ currency: 'SAR', total: 1000 })
    expect(calloutKpis([]).costs).toEqual([])
  })

  it('computes open counts, response SLA share and averages with honest nulls', () => {
    const k = calloutKpis(ROWS)
    expect(k.openCount).toBe(2)
    expect(k.criticalOpenCount).toBe(1)
    expect(k.responseMeasured).toBe(2)
    expect(k.responseSlaPct).toBe(50)
    expect(k.resolvedCount).toBe(1)
    expect(calloutKpis([]).responseSlaPct).toBeNull()
    expect(calloutKpis([]).avgResponseMinutes).toBeNull()
  })

  it('filters by country, status, severity, type, open-only and search', () => {
    expect(filterCallouts(ROWS, { country: 'UAE' }).map((r) => r.id)).toEqual([2])
    expect(filterCallouts(ROWS, { type: 'tyre' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterCallouts(ROWS, { openOnly: true }).map((r) => r.id)).toEqual([1, 4])
    expect(filterCallouts(ROWS, { search: 'fixit' }).map((r) => r.id)).toEqual([3])
    expect(filterCallouts(ROWS, { severity: 'medium', status: 'resolved' }).map((r) => r.id)).toEqual([2])
    expect(filterCallouts(ROWS, EMPTY_CALLOUT_FILTERS)).toHaveLength(4)
  })

  it('groups by type with per-currency cost and ranks providers slowest first', () => {
    const types = calloutsByType(ROWS)
    expect(types[0]).toMatchObject({ type: 'tyre', count: 2, open: 1 })
    expect(types.find((t) => t.type === 'other').count).toBe(1)
    const prov = providerPerformance(ROWS)
    expect(prov[0]).toMatchObject({ provider: 'RoadCare', callouts: 2, avgResponseMinutes: 75 })
    expect(prov[1]).toMatchObject({ provider: 'FixIt', avgResponseMinutes: null })
  })

  it('formats minutes and keeps unknowns N/A', () => {
    expect(fmtMinutes(null)).toBe('N/A')
    expect(fmtMinutes(45)).toBe('45 min')
    expect(fmtMinutes(125)).toBe('2h 5m')
    expect(fmtMinutes(120)).toBe('2h')
    expect(fmtMinutes(60 * 72)).toBe('3 days')
  })

  it('shapes table and export rows without fabricating costs or times', () => {
    const t = calloutTableRows(ROWS)
    expect(t[0]).toMatchObject({ _response: 30, _cost: 800, _open: true })
    expect(t[2]).toMatchObject({ _response: null, _cost: null, _open: false })
    const out = calloutExportRows(ROWS)
    expect(out[2]).toMatchObject({ cost: '', response_minutes: '', breakdown_type: 'Tyre', status: 'Cancelled' })
    expect(out[3].breakdown_type).toBe('')
  })

  it('counts filters, lists countries and recognises open callouts', () => {
    expect(activeCalloutFilterCount(EMPTY_CALLOUT_FILTERS)).toBe(0)
    expect(activeCalloutFilterCount({ search: 'a', type: 'tyre', openOnly: true })).toBe(3)
    expect(countryOptions(ROWS)).toEqual(['KSA', 'UAE'])
    expect(isCalloutOpen({ status: 'on_site' })).toBe(true)
    expect(isCalloutOpen({ status: 'Resolved' })).toBe(false)
  })
})
