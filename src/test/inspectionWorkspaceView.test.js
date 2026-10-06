import { describe, it, expect } from 'vitest'
import {
  positionGroup, inspectionItems, inspectionSections, inspectionProgress, workspaceKpis,
  listTabCounts, matchesListTab, searchInspections, sortNewest, recentFindings,
  defectCategories, inspectionTrend, inspectionStage, assetHistory,
} from '../lib/inspectionWorkspaceView'

const NOW = new Date(2026, 9, 6, 12)
const tc = {
  LHF1: { condition: 'Good', pressure: 110 },
  RHF1: { condition: 'Worn', tread: 3 },
  LHRO: { condition: 'Damaged', notes: 'cut' },
  SPARE: {},
}
const rows = [
  { id: 'a', asset_no: 'TM1', site: 'NHC', status: 'Done', inspection_date: '2026-10-06', tyre_conditions: tc },
  { id: 'b', asset_no: 'TM2', site: 'JED', status: 'Overdue', scheduled_date: '2026-10-01' },
  { id: 'c', asset_no: 'TM1', site: 'NHC', status: 'In Progress', inspection_date: '2026-10-05', severity: 'High' },
  { id: 'd', asset_no: 'TM3', status: 'Cancelled', inspection_date: '2026-10-06' },
]

describe('inspectionWorkspaceView', () => {
  it('places wheel codes on axles and leaves unknown codes as other', () => {
    expect(positionGroup('LHF1')).toBe('steer')
    expect(positionGroup('RHCI')).toBe('drive')
    expect(positionGroup('LHRO')).toBe('rear')
    expect(positionGroup('SPARE')).toBe('spare')
    expect(positionGroup('')).toBe('other')
    expect(positionGroup('XYZ')).toBe('other')
  })

  it('bands items and treats an empty reading as not checked', () => {
    const items = inspectionItems(rows[0])
    const by = Object.fromEntries(items.map((i) => [i.position, i]))
    expect(by.LHF1.status).toBe('ok')
    expect(by.RHF1.status).toBe('minor')
    expect(by.LHRO.status).toBe('issue')
    expect(by.SPARE.status).toBe('none')
    expect(by.SPARE.recorded).toBe(false)
    expect(by.LHF1.remarks).toBe('110 PSI')
  })

  it('groups sections in drive order with recorded counts', () => {
    const s = inspectionSections(rows[0])
    expect(s.map((x) => x.key)).toEqual(['steer', 'rear', 'spare'])
    expect(s[0]).toMatchObject({ total: 2, done: 2, issues: 1 })
    expect(s[2]).toMatchObject({ total: 1, done: 0 })
  })

  it('progress is null for an inspection with no tyre readings', () => {
    expect(inspectionProgress(rows[1])).toEqual({ done: null, total: null, pct: null })
    expect(inspectionProgress(rows[0])).toEqual({ done: 3, total: 4, pct: 75 })
  })

  it('kpis exclude cancelled and give null rates on an empty set', () => {
    const k = workspaceKpis(rows)
    expect(k).toMatchObject({ total: 3, completed: 1, overdue: 1, pending: 1, critical: 2, vehicles: 2 })
    expect(workspaceKpis([]).completedPct).toBeNull()
  })

  it('list tabs count today, pending and overdue', () => {
    expect(listTabCounts(rows, NOW)).toEqual({ all: 4, today: 2, pending: 1, overdue: 1 })
    expect(matchesListTab(rows[1], 'overdue', NOW)).toBe(true)
  })

  it('searches and sorts newest first', () => {
    expect(searchInspections(rows, 'jed').map((r) => r.id)).toEqual(['b'])
    expect(sortNewest(rows).map((r) => r.id)).toEqual(['d', 'a', 'c', 'b'])
    expect(assetHistory(rows, rows[0]).map((r) => r.id)).toEqual(['c'])
  })

  it('findings and defect mix count only non-Good tyres', () => {
    const f = recentFindings(rows)
    expect(f.map((x) => x.position).sort()).toEqual(['LHRO', 'RHF1'])
    const d = defectCategories(rows)
    expect(d.total).toBe(2)
    expect(d.segments.map((x) => x.label).sort()).toEqual(['Damaged', 'Worn'])
    expect(defectCategories([]).segments).toEqual([])
  })

  it('trend buckets by day and skips cancelled', () => {
    const t = inspectionTrend(rows, NOW, 7)
    expect(t.labels).toHaveLength(7)
    expect(t.labels[6]).toBe('2026-10-06')
    expect(t.completed[6]).toBe(1)
    expect(t.pending[5]).toBe(1)
    expect(t.overdue[1]).toBe(1)
    expect(t.any).toBe(true)
  })

  it('a rejected sign-off is not pending work and says so', () => {
    const rej = { id: 'z', status: 'In Progress', approval_status: 'rejected', inspection_date: '2026-10-06' }
    expect(inspectionStage(rej)).toMatchObject({ key: 'rejected', label: 'Rejected' })
    expect(matchesListTab(rej, 'pending', NOW)).toBe(false)
    expect(workspaceKpis([rej]).pending).toBe(0)
    expect(inspectionTrend([rej], NOW, 3).pending).toEqual([0, 0, 0])
  })

  it('stage reads approval before status', () => {
    expect(inspectionStage({ status: 'In Progress', approval_status: 'approved' }).label).toBe('Approved')
    expect(inspectionStage({ status: 'In Progress', approval_status: 'pending_approval' }).key).toBe('approval')
    expect(inspectionStage(null).label).toBe('N/A')
  })
})
