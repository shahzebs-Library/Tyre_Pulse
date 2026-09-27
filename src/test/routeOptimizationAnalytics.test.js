import { describe, expect, it } from 'vitest'
import {
  enrichPlan, enrichPlans, filterPlans, routeKpis, monthlyDistance, assetOptions, driverOptions,
  activeRouteFilterCount, routeExportRows, statusLabel, EMPTY_ROUTE_FILTERS,
} from '../lib/routeOptimizationAnalytics'

const plans = [
  { id: 1, plan_name: 'North loop', asset_no: 'TRK-1', driver_name: 'Ali', plan_date: '2026-08-03', stops_count: 10, total_distance_km: 100, optimized_distance_km: 80, status: 'completed', savings_km: 999 },
  { id: 2, plan_name: 'South loop', asset_no: 'TRK-2', driver_name: 'Omar', plan_date: '2026-09-10', stops_count: 5, total_distance_km: 50, optimized_distance_km: 60, status: 'dispatched' },
  { id: 3, plan_name: 'Draft only', asset_no: 'TRK-1', plan_date: '', total_distance_km: null, optimized_distance_km: null },
]

describe('routeOptimizationAnalytics', () => {
  it('recomputes savings from entered distances and never invents a saving', () => {
    const [a, b, c] = enrichPlans(plans)
    expect(a._savedKm).toBe(20)
    expect(a._savedPct).toBe(20)
    expect(a._kmPerStop).toBe(8)
    expect(b._savedKm).toBe(0)
    expect(b._worse).toBe(true)
    expect(c._measurable).toBe(false)
    expect(c._savedKm).toBeNull()
    expect(c._statusLabel).toBe('Draft')
    expect(enrichPlan({ total_distance_km: 0, optimized_distance_km: 0 })._savedKm).toBeNull()
  })

  it('builds KPIs with null for unmeasurable averages', () => {
    const k = routeKpis(enrichPlans(plans))
    expect(k.total).toBe(3)
    expect(k.baselineKm).toBe(150)
    expect(k.plannedKm).toBe(140)
    expect(k.savedKm).toBe(20)
    expect(k.avgSavedPct).toBe(10)
    expect(k.measured).toBe(2)
    expect(k.worse).toBe(1)
    expect(k.totalStops).toBe(15)
    expect(k.byStatus).toMatchObject({ completed: 1, dispatched: 1, draft: 1 })
    const empty = routeKpis([])
    expect(empty.savedKm).toBeNull()
    expect(empty.avgSavedPct).toBeNull()
    expect(empty.baselineKm).toBeNull()
    expect(empty.avgKmPerStop).toBeNull()
  })

  it('filters by status, asset, driver, date range and search', () => {
    const e = enrichPlans(plans)
    expect(filterPlans(e, { ...EMPTY_ROUTE_FILTERS, status: 'draft' }).map((r) => r.id)).toEqual([3])
    expect(filterPlans(e, { ...EMPTY_ROUTE_FILTERS, asset: 'TRK-1' })).toHaveLength(2)
    expect(filterPlans(e, { ...EMPTY_ROUTE_FILTERS, driver: 'Omar' }).map((r) => r.id)).toEqual([2])
    expect(filterPlans(e, { ...EMPTY_ROUTE_FILTERS, from: '2026-09-01' }).map((r) => r.id)).toEqual([2])
    expect(filterPlans(e, { ...EMPTY_ROUTE_FILTERS, to: '2026-08-31' }).map((r) => r.id)).toEqual([1])
    expect(filterPlans(e, { ...EMPTY_ROUTE_FILTERS, search: 'south' }).map((r) => r.id)).toEqual([2])
    expect(activeRouteFilterCount({ ...EMPTY_ROUTE_FILTERS, from: '2026-01-01', asset: 'X' })).toBe(2)
  })

  it('groups measurable dated plans by month', () => {
    expect(monthlyDistance(enrichPlans(plans))).toEqual([
      { month: '2026-08', baseline: 100, planned: 80, saved: 20, plans: 1 },
      { month: '2026-09', baseline: 50, planned: 60, saved: 0, plans: 1 },
    ])
  })

  it('exposes options, labels and export rows', () => {
    expect(assetOptions(plans)).toEqual(['TRK-1', 'TRK-2'])
    expect(driverOptions(plans)).toEqual(['Ali', 'Omar'])
    expect(statusLabel('optimized')).toBe('Optimized')
    const out = routeExportRows(enrichPlans(plans))
    expect(out[0]).toMatchObject({ savings_km: 20, savings_pct: 20, km_per_stop: 8, status: 'Completed' })
    expect(out[2]).toMatchObject({ savings_km: 'N/A', savings_pct: 'N/A' })
  })
})
