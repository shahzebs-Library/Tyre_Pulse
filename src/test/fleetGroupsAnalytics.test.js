import { describe, it, expect } from 'vitest'
import {
  filterGroups, groupRegisterRows, budgetByCurrency, orphanGroups, duplicateNames,
  typeBreakdown, buildGroupKpis, buildGroupInsights, groupExportRows, groupTypeLabel,
} from '../lib/fleetGroupsAnalytics'

const ROWS = [
  { id: 1, group_name: 'Holding', group_type: 'holding', asset_count: 10, budget: 1000, currency: 'SAR' },
  { id: 2, group_name: 'Div A', group_type: 'division', parent_group: 'Holding', asset_count: 5, budget: 500, currency: 'SAR', manager: 'Ali' },
  { id: 3, group_name: 'Depot 1', group_type: 'depot', parent_group: 'Div A', asset_count: 3, active: false },
  { id: 4, group_name: 'Lost', group_type: 'depot', parent_group: 'Ghost' },
]

describe('fleetGroupsAnalytics', () => {
  it('filters by type, active state and search', () => {
    expect(filterGroups(ROWS, { type: 'depot' }).map((r) => r.id)).toEqual([3, 4])
    expect(filterGroups(ROWS, { active: 'inactive' }).map((r) => r.id)).toEqual([3])
    expect(filterGroups(ROWS, { search: 'ali' }).map((r) => r.id)).toEqual([2])
  })

  it('rolls up assets and depth against the full set even when filtered', () => {
    const reg = groupRegisterRows([ROWS[1]], ROWS)
    expect(reg[0].rolledAssets).toBe(8)
    expect(reg[0].depth).toBe(1)
    expect(reg[0].ownAssets).toBe(5)
  })

  it('never blends budget currencies', () => {
    const single = budgetByCurrency(ROWS, 'SAR')
    expect(single.total).toBe(1500)
    const mixed = budgetByCurrency([...ROWS, { group_name: 'X', budget: 200, currency: 'AED' }], 'SAR')
    expect(mixed.mixed).toBe(true)
    expect(mixed.total).toBeNull()
    expect(mixed.totals).toHaveLength(2)
  })

  it('reports an unmeasured fleet size as null, not 0', () => {
    const k = buildGroupKpis([{ group_name: 'A' }, { group_name: 'B' }], 'SAR')
    expect(k.totalAssets).toBeNull()
    expect(k.budget.total).toBeNull()
    expect(k.total).toBe(2)
  })

  it('finds orphans and duplicate names', () => {
    expect(orphanGroups(ROWS).map((r) => r.id)).toEqual([4])
    expect(duplicateNames([{ group_name: 'A' }, { group_name: 'A ' }])).toEqual([{ name: 'A', count: 2 }])
  })

  it('builds KPIs, type breakdown and insights', () => {
    const k = buildGroupKpis(ROWS, 'SAR')
    expect(k).toMatchObject({ total: 4, active: 3, inactive: 1, roots: 2, maxDepth: 2, totalAssets: 18, orphans: 1 })
    expect(typeBreakdown(ROWS)[0]).toMatchObject({ type: 'depot', count: 2 })
    const ins = buildGroupInsights(ROWS, 'SAR')
    expect(ins.some((s) => s.includes('Lost'))).toBe(true)
    expect(buildGroupInsights([], 'SAR')).toEqual([])
  })

  it('exports blanks rather than zeros for unknown values', () => {
    const rows = groupExportRows(ROWS, ROWS, 'SAR')
    const lost = rows.find((r) => r.group_name === 'Lost')
    expect(lost.own_assets).toBe('')
    expect(lost.budget).toBe('')
    expect(lost.currency).toBe('')
    expect(groupTypeLabel('cost_center')).toBe('Cost Center')
    expect(groupTypeLabel('')).toBe('Unclassified')
  })
})
