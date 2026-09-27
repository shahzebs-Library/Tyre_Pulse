import { describe, it, expect } from 'vitest'
import {
  isOverdue, routeLabel, enrichLoads, filterLoads, optionList, dispatchKpis,
  statusShares, topRoutes, loadExport,
} from '../lib/dispatchAnalytics'

const NOW = new Date(2026, 8, 27, 12, 0, 0).getTime()
const rows = [
  { id: 1, load_no: 'L1', asset_no: 'TM1', status: 'planned', scheduled_at: new Date(2026, 8, 27, 8).toISOString(), origin: 'A', destination: 'B', weight_kg: '1000', site: 'NHC' },
  { id: 2, load_no: 'L2', asset_no: 'TM2', status: 'in_transit', scheduled_at: new Date(2026, 8, 26, 8).toISOString(), origin: 'A', destination: 'B' },
  { id: 3, load_no: 'L3', asset_no: 'TM1', status: 'delivered', scheduled_at: null, origin: 'C', destination: 'D', weight_kg: 500 },
  { id: 4, load_no: 'L4', asset_no: 'TM3', status: 'cancelled', scheduled_at: new Date(2026, 8, 28).toISOString() },
]

describe('dispatchAnalytics', () => {
  it('detects overdue departures only for planned/dispatched', () => {
    expect(isOverdue(rows[0], NOW)).toBe(true)
    expect(isOverdue(rows[1], NOW)).toBe(false)
    expect(isOverdue(rows[3], NOW)).toBe(false)
    expect(isOverdue({ status: 'planned' }, NOW)).toBe(false)
  })

  it('labels routes without dashes', () => {
    expect(routeLabel(rows[0])).toBe('A to B')
    expect(routeLabel({})).toBe('N/A')
  })

  it('filters by pseudo statuses, asset, site and search', () => {
    const e = enrichLoads(rows, NOW)
    expect(filterLoads(e, { status: 'overdue' }).map((r) => r.id)).toEqual([1])
    expect(filterLoads(e, { status: 'active' }).map((r) => r.id)).toEqual([2, 1])
    expect(filterLoads(e, { asset: 'TM1' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterLoads(e, { site: 'NHC' }).map((r) => r.id)).toEqual([1])
    expect(filterLoads(e, { search: 'l4' }).map((r) => r.id)).toEqual([4])
    expect(optionList(rows, 'asset_no')).toEqual(['TM1', 'TM2', 'TM3'])
  })

  it('computes honest KPIs', () => {
    const k = dispatchKpis(rows, NOW)
    expect(k).toMatchObject({ total: 4, active: 2, overdue: 1, delivered: 1, cancelled: 1, deliveryRatePct: 50, totalWeightTonnes: 1.5, weightCoveragePct: 50, scheduledToday: 1 })
    const empty = dispatchKpis([], NOW)
    expect(empty.deliveryRatePct).toBeNull()
    expect(empty.totalWeightTonnes).toBeNull()
    expect(empty.weightCoveragePct).toBeNull()
    expect(statusShares(empty)[0].pct).toBeNull()
  })

  it('ranks lanes and exports', () => {
    const r = topRoutes(enrichLoads(rows, NOW))
    expect(r[0]).toMatchObject({ route: 'A to B', loads: 2, weightTonnes: 1 })
    const x = loadExport(enrichLoads(rows, NOW))
    expect(x.rows[1].weight_kg).toBe('N/A')
    expect(x.rows[0].overdue).toBe('Yes')
  })
})
