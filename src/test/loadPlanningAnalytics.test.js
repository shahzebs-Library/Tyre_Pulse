import { describe, it, expect } from 'vitest'
import {
  loadBand, peakUtilPct, filterLoadPlans, hasLoadFilters, loadKpis, loadStatusBreakdown,
  loadRouteRollup, overloadWorklist, loadExportRows, loadTableRows, loadCountryOptions, LOAD_FILTERS, statusLabel,
} from '../lib/loadPlanningAnalytics'

const plans = [
  { id: 1, reference: 'LP-1', status: 'planned', country: 'KSA', origin: 'Riyadh', destination: 'Dammam', plan_date: '2026-09-01', cargo_weight_kg: 26000, max_payload_kg: 24000 },
  { id: 2, reference: 'LP-2', status: 'dispatched', country: 'UAE', origin: 'Riyadh', destination: 'Dammam', plan_date: '2026-09-10', cargo_weight_kg: 22000, max_payload_kg: 24000, volume_m3: 50, max_volume_m3: 76 },
  { id: 3, reference: 'LP-3', status: 'draft', country: 'KSA', plan_date: null, cargo_weight_kg: 1000 },
  { id: 4, reference: 'LP-4', status: 'weird', volume_m3: 40, max_volume_m3: 76 },
]

describe('loadPlanningAnalytics', () => {
  it('bands plans by their worst utilisation', () => {
    expect(loadBand(plans[0])).toBe('overloaded')
    expect(loadBand(plans[1])).toBe('near') // weight 91.7%
    expect(loadBand(plans[2])).toBe('unmeasured')
    expect(loadBand(plans[3])).toBe('ok')
    expect(peakUtilPct(plans[2])).toBeNull()
  })

  it('filters by status, country, band, date and text', () => {
    expect(filterLoadPlans(plans, { ...LOAD_FILTERS, band: 'overloaded' }).map((p) => p.id)).toEqual([1])
    expect(filterLoadPlans(plans, { ...LOAD_FILTERS, country: 'KSA' }).map((p) => p.id)).toEqual([1, 3])
    expect(filterLoadPlans(plans, { ...LOAD_FILTERS, from: '2026-09-05' }).map((p) => p.id)).toEqual([2])
    expect(filterLoadPlans(plans, { ...LOAD_FILTERS, search: 'dammam' })).toHaveLength(2)
    expect(hasLoadFilters(LOAD_FILTERS)).toBe(false)
    expect(hasLoadFilters({ ...LOAD_FILTERS, band: 'ok' })).toBe(true)
    expect(loadCountryOptions(plans)).toEqual(['KSA', 'UAE'])
  })

  it('reports null averages instead of zero when nothing is measurable', () => {
    const k = loadKpis(plans)
    expect(k).toMatchObject({ total: 4, overloaded: 1, dispatched: 1, totalWeightKg: 49000 })
    expect(k.bands).toEqual({ overloaded: 1, near: 1, ok: 1, unmeasured: 1 })
    expect(k.overloadRatePct).toBe(33.3)
    const unmeasured = loadKpis([plans[2]])
    expect(unmeasured.avgWeightUtilPct).toBeNull()
    expect(unmeasured.avgVolumeUtilPct).toBeNull()
    expect(unmeasured.overloadRatePct).toBeNull()
    expect(loadKpis([{ id: 9 }]).totalWeightKg).toBeNull()
  })

  it('breaks down status, routes and the overload worklist', () => {
    const s = loadStatusBreakdown(plans)
    expect(s.counts.planned).toBe(1)
    expect(s.other).toBe(1)
    const r = loadRouteRollup(plans)
    expect(r).toEqual([{ route: 'Riyadh to Dammam', plans: 2, overloaded: 1, weightKg: 48000 }])
    const w = overloadWorklist(plans)
    expect(w.map((p) => p.id)).toEqual([1])
    expect(w[0]._weightPct).toBeGreaterThan(100)
  })

  it('labels and exports with N/A for unmeasured utilisation', () => {
    const t = loadTableRows(plans)
    expect(t[0]._route).toBe('Riyadh to Dammam')
    expect(t[2]._route).toBeNull()
    const out = loadExportRows(plans)
    expect(out[2].weight_util).toBe('N/A')
    expect(out[0].band).toBe('Overloaded')
    expect(statusLabel('planned')).toBe('Planned')
    expect(statusLabel('')).toBe('N/A')
  })
})
