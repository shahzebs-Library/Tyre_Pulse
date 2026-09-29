import { describe, it, expect } from 'vitest'
import {
  siteKey, indexSites, matchGroupSites, regionForGroup, membersFor, latestUtilByAsset,
  utilizationFor, issuesFor, issueHeadline, hierarchyOrder, compositionSegments,
  lastMonths, monthlyUtilization, tyresByAsset,
} from '../lib/fleetGroupsView'

const sites = [
  { name: 'NORTH YARD', site_code: 'NY', region: 'Central' },
  { name: 'City Plant', site_code: 'CP', region: 'Central' },
  { name: 'HARBOUR', site_code: null, region: 'Western' },
]
const groups = [
  { id: 1, group_name: 'Northern Ops', group_code: 'G-N', parent_group: null, asset_count: 5 },
  { id: 2, group_name: 'North Yard', group_code: 'X', parent_group: 'Northern Ops', asset_count: 40 },
  { id: 3, group_name: 'Plant group', group_code: 'cp', parent_group: 'Northern Ops', asset_count: 20 },
  { id: 4, group_name: 'Rental', group_code: 'R', parent_group: null, asset_count: null },
  { id: 5, group_name: 'Harbour-ST', group_code: null, parent_group: null, asset_count: 0 },
]

describe('fleetGroupsView', () => {
  it('siteKey normalises case, spaces and a store suffix', () => {
    expect(siteKey('  north   yard ')).toBe('NORTH YARD')
    expect(siteKey('Harbour-ST')).toBe('HARBOUR')
    expect(siteKey(null)).toBe('')
  })

  it('matches groups to sites by name or code and rolls sites up to parents', () => {
    const m = matchGroupSites(groups, sites)
    expect(m.get(2)).toEqual(['NORTH YARD'])
    expect(m.get(3)).toEqual(['CITY PLANT'])
    expect(m.get(1)).toEqual(['CITY PLANT', 'NORTH YARD'])
    expect(m.get(4)).toEqual([])
    expect(m.get(5)).toEqual(['HARBOUR'])
    expect(indexSites(sites).get('NY')).toBe('NORTH YARD')
  })

  it('prefers the recorded region and otherwise derives one only when unambiguous', () => {
    const map = new Map([['NORTH YARD', 'Central'], ['HARBOUR', 'Western']])
    expect(regionForGroup({ region: 'East' }, ['NORTH YARD'], map)).toEqual({ region: 'East', derived: false })
    expect(regionForGroup({}, ['NORTH YARD'], map)).toEqual({ region: 'Central', derived: true })
    expect(regionForGroup({}, ['NORTH YARD', 'HARBOUR'], map)).toEqual({ region: 'Multiple', derived: true })
    expect(regionForGroup({}, [], map)).toEqual({ region: '', derived: false })
  })

  it('members are fleet rows at the matched sites, same country when known', () => {
    const fleet = [
      { asset_no: 'A1', site: 'North Yard', country: 'KSA' },
      { asset_no: 'A2', site: 'NORTH YARD', country: 'UAE' },
      { asset_no: 'A3', site: 'Other', country: 'KSA' },
    ]
    expect(membersFor(['NORTH YARD'], fleet).map((a) => a.asset_no)).toEqual(['A1', 'A2'])
    expect(membersFor(['NORTH YARD'], fleet, 'KSA').map((a) => a.asset_no)).toEqual(['A1'])
    expect(membersFor([], fleet)).toEqual([])
  })

  it('utilisation uses the latest snapshot per asset and is null when none is measured', () => {
    const latest = latestUtilByAsset([
      { asset_no: 'A1', utilization_pct: 50, captured_at: '2026-01-01' },
      { asset_no: 'A1', utilization_pct: 80, captured_at: '2026-02-01' },
      { asset_no: 'A2', utilization_pct: 60, captured_at: '2026-02-01' },
      { asset_no: 'A3', utilization_pct: null, captured_at: '2026-02-01' },
    ])
    expect(utilizationFor([{ asset_no: 'a1' }, { asset_no: 'A2' }, { asset_no: 'A3' }], latest)).toEqual({ value: 70, measured: 2, total: 3 })
    expect(utilizationFor([{ asset_no: 'A3' }], latest).value).toBeNull()
  })

  it('issues count real signals and stay null when a source is unreadable', () => {
    const assets = [{ asset_no: 'A1' }, { asset_no: 'A2' }]
    const iss = issuesFor(assets, {
      actions: [{ asset_no: 'A1' }, { asset_no: 'ZZ' }],
      criticalTyres: [{ asset_no: 'A2' }, { asset_no: 'A2' }],
      overduePm: [],
    })
    expect(iss).toMatchObject({ actions: 1, tyres: 2, pm: 0, total: 3, complete: true })
    expect(issueHeadline(iss)).toBe('2 critical tyres')
    const partial = issuesFor(assets, { actions: null, criticalTyres: null, overduePm: null })
    expect(partial.total).toBeNull()
    expect(issueHeadline({ actions: 0, tyres: 0, pm: 0 })).toBe('')
  })

  it('orders the register parent first with depth', () => {
    const order = hierarchyOrder(groups).map((x) => [x.row.id, x.depth])
    expect(order[0]).toEqual([1, 0])
    expect(order).toContainEqual([2, 1])
    expect(order).toContainEqual([3, 1])
    expect(order).toHaveLength(groups.length)
  })

  it('composition uses own counts, skips unrecorded, and folds the tail into Others', () => {
    const seg = compositionSegments(groups, ['#1', '#2'], 2)
    expect(seg.map((s) => [s.label, s.count])).toEqual([['North Yard', 40], ['Plant group', 20], ['Others', 5]])
  })

  it('monthly utilisation leaves a month with no snapshot as a gap', () => {
    const months = lastMonths(3, new Date(2026, 8, 15))
    expect(months).toEqual(['2026-07', '2026-08', '2026-09'])
    const s = monthlyUtilization([{ asset_no: 'A1' }], [
      { asset_no: 'A1', utilization_pct: 40, captured_at: '2026-07-02' },
      { asset_no: 'A1', utilization_pct: 60, captured_at: '2026-07-20' },
      { asset_no: 'B9', utilization_pct: 99, captured_at: '2026-08-02' },
    ], months)
    expect(s.map((x) => x.value)).toEqual([50, null, null])
  })

  it('counts fitted tyres per asset', () => {
    const m = tyresByAsset([{ asset_no: 'A1' }, { asset_no: 'a1' }, { asset_no: 'B' }])
    expect(m.get('A1')).toBe(2)
    expect(m.get('B')).toBe(1)
  })
})
