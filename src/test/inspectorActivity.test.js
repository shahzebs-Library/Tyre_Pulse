import { describe, it, expect } from 'vitest'
import {
  inspectorActivity, activityTotals, coverageRows, filterCoverage, coverageTotals,
} from '../lib/inspectorActivity'

// 2026-03-10T00:00:00Z, so "days since" is arithmetic, not a moving target.
const NOW = Date.parse('2026-03-10T00:00:00Z')

const INSP = [
  { asset_no: 'TM001', site: 'JED', inspector: 'Ali', completed_date: '2026-03-09', status: 'Done', findings: 'ok' },
  { asset_no: 'TM002', site: 'JED', inspector: 'Ali', scheduled_date: '2026-03-01', status: 'In Progress', findings: '' },
  { asset_no: 'TM003', site: 'RIY', inspector: 'Omar', completed_date: '2026-01-01', status: 'Done', findings: 'wear' },
  { asset_no: 'TM001', site: 'JED', inspector: 'Omar', completed_date: '2026-02-01', status: 'Done', findings: '' },
  { asset_no: 'TM004', site: 'JED', inspector: '   ', completed_date: '2026-03-08', status: 'Done' },
]

const FLEET = [
  { asset_no: 'TM001', site: 'JED' },
  { asset_no: 'TM002', site: 'JED' },
  { asset_no: 'TM003', site: 'RIY' },
  { asset_no: 'TM999', site: 'RIY' }, // never inspected
]

describe('inspectorActivity', () => {
  it('groups by inspector and keeps the most recent day', () => {
    const rows = inspectorActivity(INSP, { now: NOW })
    const ali = rows.find(r => r.inspector === 'Ali')
    expect(ali.total).toBe(2)
    expect(ali.completed).toBe(1)
    expect(ali.open).toBe(1)
    expect(ali.lastActive).toBe('2026-03-09')
    expect(ali.daysSinceActive).toBe(1)
    expect(ali.vehicles).toBe(2)
    expect(ali.sites).toEqual(['JED'])
  })

  it('skips a blank inspector rather than inventing one', () => {
    const rows = inspectorActivity(INSP, { now: NOW })
    expect(rows.map(r => r.inspector)).toEqual(['Ali', 'Omar'])
  })

  it('returns null rates, never 0, when there is nothing to rate', () => {
    const [row] = inspectorActivity([{ inspector: 'X', status: 'Done', completed_date: '2026-03-01' }], { now: NOW })
    expect(row.completionPct).toBe(100)
    expect(inspectorActivity([], { now: NOW })).toEqual([])
    expect(activityTotals([]).completionPct).toBeNull()
  })

  it('totals count open work as open, not as failure', () => {
    const t = activityTotals(inspectorActivity(INSP, { now: NOW }))
    expect(t.inspectors).toBe(2)
    expect(t.inspections).toBe(4)
    expect(t.completed).toBe(3)
    expect(t.open).toBe(1)
    expect(t.activeThisWeek).toBe(1)
  })
})

describe('coverageRows', () => {
  it('marks a vehicle done only inside the stale window', () => {
    const rows = coverageRows(FLEET, INSP, { now: NOW })
    const byAsset = Object.fromEntries(rows.map(r => [r.asset_no, r]))
    expect(byAsset.TM001.done).toBe(true)      // inspected yesterday
    expect(byAsset.TM002.done).toBe(false)     // 9 days
    expect(byAsset.TM003.severity).toBe('critical')
  })

  it('keeps "never inspected" distinct from "inspected long ago"', () => {
    const rows = coverageRows(FLEET, INSP, { now: NOW })
    const never = rows.find(r => r.asset_no === 'TM999')
    expect(never.lastInspectionDate).toBeNull()
    expect(never.daysSince).toBeNull()
    expect(never.severity).toBe('never')
  })

  it('reads the latest inspection whatever order the rows arrive in', () => {
    const rows = coverageRows([{ asset_no: 'TM001' }], [...INSP].reverse(), { now: NOW })
    expect(rows[0].lastInspectionDate).toBe('2026-03-09')
    expect(rows[0].inspector).toBe('Ali')
  })

  it('sorts not-done first, worst first', () => {
    const rows = coverageRows(FLEET, INSP, { now: NOW })
    expect(rows[rows.length - 1].asset_no).toBe('TM001')
    expect(rows[0].asset_no).toBe('TM999')
  })

  it('degrades on junk input instead of throwing', () => {
    expect(coverageRows(null, null)).toEqual([])
    expect(coverageRows([{ site: 'JED' }], [])).toEqual([])
  })
})

describe('filterCoverage / coverageTotals', () => {
  const rows = coverageRows(FLEET, INSP, { now: NOW })

  it('filters by site, status and free text', () => {
    expect(filterCoverage(rows, { site: 'RIY' }).map(r => r.asset_no).sort()).toEqual(['TM003', 'TM999'])
    expect(filterCoverage(rows, { status: 'done' }).map(r => r.asset_no)).toEqual(['TM001'])
    expect(filterCoverage(rows, { status: 'not_done' })).toHaveLength(3)
    expect(filterCoverage(rows, { search: 'ali' }).map(r => r.asset_no).sort()).toEqual(['TM001', 'TM002'])
  })

  it('totals the coverage honestly', () => {
    const t = coverageTotals(rows)
    expect(t).toMatchObject({ vehicles: 4, done: 1, notDone: 3, never: 1 })
    expect(t.coveragePct).toBe(25)
    expect(coverageTotals([]).coveragePct).toBeNull()
  })
})
