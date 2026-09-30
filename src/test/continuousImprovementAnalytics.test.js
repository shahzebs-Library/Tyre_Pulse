import { describe, it, expect } from 'vitest'
import {
  daysOpen, lifeKmOf, avgCpkOf, failureRateOf, meanLifeKm, replacementsPerYearOf, filterByPeriod,
  computeMetrics, improvementScore, buildOpportunities, cpkTrend, kpiScorecard, actionStats,
  filterActions, roiSummary, actionExportRows,
} from '../lib/continuousImprovementAnalytics'

const NOW = new Date(2026, 8, 20)

const tyre = (o) => ({ cost_per_tyre: 1000, km_at_fitment: 1000, km_at_removal: 51000, issue_date: '2026-08-01', ...o })

describe('continuousImprovementAnalytics basics', () => {
  it('returns null (not 0) for unmeasurable values', () => {
    expect(daysOpen(null, NOW)).toBeNull()
    expect(daysOpen('2026-09-10', NOW)).toBe(10)
    expect(lifeKmOf({ km_at_fitment: 100, km_at_removal: 50 })).toBeNull()
    expect(avgCpkOf([])).toBeNull()
    expect(failureRateOf([])).toBeNull()
    expect(meanLifeKm([{}])).toBeNull()
    expect(replacementsPerYearOf([tyre()])).toBeNull()
    const m = computeMetrics([], [], [])
    expect(m).toMatchObject({ avgCpk: null, avgCostPerTyre: null, failureRate: null, inspectionCompliance: null, closeRate: null })
  })

  it('filters by period against an injected now', () => {
    const rows = [tyre({ issue_date: '2026-07-01' }), tyre({ issue_date: '2025-01-01' })]
    expect(filterByPeriod(rows, '3mo', NOW)).toHaveLength(1)
  })

  it('computes metrics from measured rows only', () => {
    const m = computeMetrics(
      [tyre(), tyre({ risk_level: 'High', km_at_removal: 26000 }), tyre({ cost_per_tyre: 0 })],
      [{ status: 'Completed' }, { status: 'Scheduled' }],
      [{ status: 'Closed' }, { status: 'Open' }],
    )
    expect(m.avgCpk).toBeCloseTo((0.02 + 0.04) / 2)
    expect(m.avgCostPerTyre).toBe(1000)
    expect(m.inspectionCompliance).toBe(50)
    expect(m.closeRate).toBe(50)
  })

  it('scores only measured components and is null with no data', () => {
    expect(improvementScore([], computeMetrics([], [], []), NOW).total).toBeNull()
    const s = improvementScore([], { inspectionCompliance: 100, closeRate: 50 }, NOW)
    expect(s.measured).toBe(2)
    expect(s.total).toBe(75)
    expect(s.costPts).toBeNull()
  })
})

describe('continuousImprovementAnalytics opportunities', () => {
  it('prices a brand switch from measured life, never an assumed mileage', () => {
    const records = [
      ...Array(3).fill(0).map((_, i) => tyre({ brand: 'Cheap', cost_per_tyre: 1000, issue_date: `2026-0${i + 1}-01` })),
      ...Array(3).fill(0).map((_, i) => tyre({ brand: 'Dear', cost_per_tyre: 2000, issue_date: `2026-0${i + 4}-01` })),
    ]
    const out = buildOpportunities({ records, now: NOW })
    const sw = out.cost.find((o) => o.key === 'brand-switch')
    expect(sw.title).toContain('Dear to Cheap')
    expect(sw.saving).toBeGreaterThan(0)
  })

  it('leaves the saving null when tyre life cannot be measured', () => {
    const records = [
      ...Array(3).fill(0).map(() => tyre({ brand: 'A', cost_per_tyre: 1000 })),
      ...Array(3).fill(0).map(() => tyre({ brand: 'B', cost_per_tyre: 3000 })),
    ] // all on one date -> replacement rate unmeasurable
    const sw = buildOpportunities({ records, now: NOW }).cost.find((o) => o.key === 'brand-switch')
    expect(sw.saving).toBeNull()
  })

  it('does not flag inspection compliance when there are no inspections', () => {
    const out = buildOpportunities({ records: [tyre()], now: NOW })
    expect(out.inspection.find((o) => o.key === 'fleet-inspection-compliance')).toBeUndefined()
  })
})

describe('continuousImprovementAnalytics actions, trends and targets', () => {
  const actions = [
    { id: 1, title: 'Fix NHC', status: 'Open', priority: 'High', created_at: '2026-08-01', site: 'NHC' },
    { id: 2, title: 'Audit', status: 'In Progress', priority: 'Low', created_at: '2026-09-18' },
    { id: 3, title: 'Done', status: 'Closed', priority: 'High', created_at: '2026-07-01' },
  ]

  it('builds action stats and filters them', () => {
    const st = actionStats(actions, NOW)
    expect(st.overdue.map((a) => a.id)).toEqual([1])
    expect(st.openTable.map((a) => a.id)).toEqual([1, 2])
    expect(filterActions(st.openTable, { priority: 'Low' }).map((a) => a.id)).toEqual([2])
    expect(filterActions(st.openTable, { overdueOnly: true }).map((a) => a.id)).toEqual([1])
    expect(filterActions(st.openTable, { search: 'nhc' })).toHaveLength(1)
    const roi = roiSummary(actions, st, { avgCostPerTyre: null }, { cost: [{ saving: null }] })
    expect(roi).toMatchObject({ costAvoidance: null, backlogRisk: null, totalSaving: null, unpricedOpportunities: 1 })
    expect(actionExportRows(st.all)[1]).toMatchObject({ site: 'N/A', overdue: 'No' })
  })

  it('reports target status and N/A when the metric is unmeasured', () => {
    const rows = kpiScorecard({ avgCpk: 0.05, failureRate: null }, [
      { metric: 'target_cpk', target_value: 0.04 },
      { metric: 'max_failure_rate', target_value: 10 },
    ])
    expect(rows.find((r) => r.metric === 'target_cpk').status).toBe('Off Track')
    expect(rows.find((r) => r.metric === 'max_failure_rate').status).toBe('No data')
  })

  it('builds a 12-month CPK series with null gaps', () => {
    const tr = cpkTrend([tyre({ issue_date: '2026-09-05' })], NOW)
    expect(tr.keys).toHaveLength(12)
    expect(tr.values[11]).toBeCloseTo(0.02)
    expect(tr.values[0]).toBeNull()
  })
})

describe('continuousImprovementAnalytics inspection + failure vocabulary (audit 2026-09-30)', () => {
  it('counts a Done inspection as complete (the CHECK has no "Completed" value)', () => {
    const m = computeMetrics([], [
      { status: 'Done' }, { status: 'Done' }, { status: 'In Progress' }, { status: 'Cancelled' },
    ], [])
    // Cancelled is neither done nor due: 2 of the 3 live inspections are done.
    expect(m.inspectionCompliance).toBeCloseTo((2 / 3) * 100, 5)
  })

  it('does not flag Done or Cancelled inspections as overdue', () => {
    const insp = [
      { status: 'Done', scheduled_date: '2026-01-01', site: 'NHC' },
      { status: 'Cancelled', scheduled_date: '2026-01-01', site: 'NHC' },
      { status: 'Scheduled', scheduled_date: '2026-01-01', site: 'NHC' },
    ]
    const opp = buildOpportunities({ records: [tyre({ site: 'NHC' })], inspections: insp, actions: [], metrics: computeMetrics([], insp, []), now: NOW })
    const overdue = opp.inspection.find((o) => o.key === 'overdue-inspections')
    expect(overdue?.title).toMatch(/^1 scheduled inspections are overdue/)
  })

  it('treats a Critical tyre as a failure, like the fleet-wide definition', () => {
    expect(failureRateOf([tyre({ risk_level: 'Critical' }), tyre()])).toBe(50)
  })
})
