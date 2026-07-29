/**
 * Accident CASE analytics: honest KPIs, and the null-not-zero discipline.
 *
 * The point of this engine is restraint. It must not average an unmeasurable set
 * to 0, must not report an SLA rate when nothing carries an SLA, must count a
 * bottleneck per case rather than per row, and must flag a thin sample instead of
 * dressing it as authoritative. Most of these tests check exactly that.
 */
import { describe, it, expect } from 'vitest'
import {
  isGenuinelyClosed, isOpenCase,
  casesBasis, MIN_AUTHORITATIVE,
  caseStatusBreakdown,
  byWorkstreamBottleneck,
  avgTimeToClose,
  openByTeam,
  slaBreachRate,
  closureLevelBreakdown, CLOSURE_LEVEL_LABELS,
  reopenRate,
  buildCaseAnalytics,
} from '../lib/accidentCaseAnalytics'

// A small mixed set: two closed (one with clean dates, one missing a close date),
// several in different open workstreams, one cancelled, one reopened.
const cases = [
  { id: 'c1', case_status: 'closed', closure_level: 'fully_closed', created_at: '2026-07-01', closed_at: '2026-07-11' },
  { id: 'c2', case_status: 'closed', closure_level: 'fully_closed', created_at: '2026-07-01', incident_date: '2026-07-01' }, // no close stamp
  { id: 'c3', case_status: 'repair_in_progress', closure_level: 'financially_open', created_at: '2026-07-05' },
  { id: 'c4', case_status: 'awaiting_insurer_response', created_at: '2026-07-06' },
  { id: 'c5', case_status: 'financial_closure_pending', created_at: '2026-07-07' },
  { id: 'c6', case_status: 'cancelled_duplicate', created_at: '2026-07-08' },
  { id: 'c7', case_status: 'reopened', created_at: '2026-07-09' },
]

describe('isGenuinelyClosed / isOpenCase', () => {
  it('treats fully_closed and case_status closed as closed, cancelled as not open and not closed', () => {
    expect(isGenuinelyClosed({ case_status: 'closed' })).toBe(true)
    expect(isGenuinelyClosed({ closure_level: 'fully_closed' })).toBe(true)
    expect(isGenuinelyClosed({ case_status: 'cancelled_duplicate' })).toBe(false)
    // A cancelled duplicate is terminal, so it is not an OPEN case either.
    expect(isOpenCase({ case_status: 'cancelled_duplicate' })).toBe(false)
    expect(isOpenCase({ case_status: 'repair_in_progress' })).toBe(true)
    // A blank status still describes an open case (it exists, stage unknown).
    expect(isOpenCase({})).toBe(true)
  })
})

describe('casesBasis', () => {
  it('is empty and unauthoritative for no cases', () => {
    expect(casesBasis([])).toMatchObject({ total: 0, open: 0, closed: 0, authoritative: false })
    expect(casesBasis([]).note).toContain('No cases')
    expect(casesBasis(null).total).toBe(0)
  })

  it('flags a thin sample and stays silent on a healthy one', () => {
    const thin = casesBasis(cases) // 7 cases
    expect(thin.authoritative).toBe(false)
    expect(thin.note).toContain('7 cases')
    const big = Array.from({ length: MIN_AUTHORITATIVE }, (_, i) => ({ id: `x${i}`, case_status: 'closed', closure_level: 'fully_closed' }))
    const b = casesBasis(big)
    expect(b.authoritative).toBe(true)
    expect(b.note).toBe('') // no noise on a set large enough to trust
  })

  it('counts open and closed correctly', () => {
    const b = casesBasis(cases)
    expect(b.total).toBe(7)
    expect(b.closed).toBe(2)       // c1, c2
    expect(b.open).toBe(4)         // c3, c4, c5, c7 (c6 cancelled = neither)
  })
})

describe('caseStatusBreakdown', () => {
  it('groups by status, most common first, and never fabricates a bucket for blanks', () => {
    const set = [
      { case_status: 'repair_in_progress' },
      { case_status: 'repair_in_progress' },
      { case_status: 'closed' },
      { case_status: '' },
      { case_status: null },
    ]
    const r = caseStatusBreakdown(set)
    expect(r.total).toBe(5)
    expect(r.unrecorded).toBe(2)
    expect(r.top).toMatchObject({ token: 'repair_in_progress', value: 2 })
    expect(r.distinct).toBe(2)
    // labels + team come from the engine vocabulary, not re-declared here.
    expect(r.rows[0].label).toBe('Repair in progress')
    expect(r.rows[0].team).toBeTruthy()
  })

  it('is empty for no cases', () => {
    expect(caseStatusBreakdown([])).toMatchObject({ total: 0, distinct: 0, unrecorded: 0, top: null })
  })
})

describe('byWorkstreamBottleneck', () => {
  it('returns an unmeasured empty shape when there are no workstream rows', () => {
    expect(byWorkstreamBottleneck([])).toMatchObject({ measured: false, stalledCases: 0, top: null })
    expect(byWorkstreamBottleneck(null).rows).toEqual([])
  })

  it('counts stalled cases per workstream and ignores satisfied rows', () => {
    const ws = [
      { accident_id: 'c1', workstream_key: 'repair', status: 'in_progress' },
      { accident_id: 'c2', workstream_key: 'repair', status: 'waiting_parts' }, // any non-satisfying token
      { accident_id: 'c3', workstream_key: 'insurance', status: 'waiting_external' },
      { accident_id: 'c4', workstream_key: 'repair', status: 'completed' },      // satisfied -> ignored
      { accident_id: 'c5', workstream_key: 'finance', status: 'not_required' },  // satisfied -> ignored
    ]
    const r = byWorkstreamBottleneck(ws)
    expect(r.measured).toBe(true)
    expect(r.top).toMatchObject({ key: 'repair', cases: 2 })
    expect(r.stalledCases).toBe(3) // c1, c2, c3
    expect(r.rows.find((x) => x.key === 'insurance')).toMatchObject({ cases: 1 })
    // engine vocabulary supplies the name.
    expect(r.top.name).toBe('Repair')
  })

  it('dedupes multiple blocking rows for the same case+workstream into one stall', () => {
    const ws = [
      { accident_id: 'c1', workstream_key: 'repair', status: 'in_progress' },
      { accident_id: 'c1', workstream_key: 'repair', status: 'on_hold' },
    ]
    const r = byWorkstreamBottleneck(ws)
    expect(r.top).toMatchObject({ key: 'repair', cases: 1 })
    expect(r.stalledCases).toBe(1)
  })
})

describe('avgTimeToClose', () => {
  it('measures only genuinely closed cases with valid dates, and reports the gap', () => {
    const r = avgTimeToClose(cases)
    expect(r.closedTotal).toBe(2)  // c1, c2
    expect(r.measured).toBe(1)     // only c1 has a close stamp
    expect(r.avgDays).toBe(10)
    expect(r.medianDays).toBe(10)
    expect(r.longestDays).toBe(10)
  })

  it('returns null (not 0) when nothing can be measured', () => {
    const r = avgTimeToClose([{ case_status: 'closed' }]) // closed but no dates
    expect(r.closedTotal).toBe(1)
    expect(r.measured).toBe(0)
    expect(r.avgDays).toBeNull()
    expect(r.medianDays).toBeNull()
    expect(r.longestDays).toBeNull()
  })

  it('ignores a negative span (close before open)', () => {
    const r = avgTimeToClose([
      { case_status: 'closed', created_at: '2026-07-10', closed_at: '2026-07-01' },
    ])
    expect(r.measured).toBe(0)
    expect(r.avgDays).toBeNull()
  })

  it('computes a median over an even count', () => {
    const r = avgTimeToClose([
      { case_status: 'closed', created_at: '2026-07-01', closed_at: '2026-07-03' }, // 2
      { case_status: 'closed', created_at: '2026-07-01', closed_at: '2026-07-09' }, // 8
    ])
    expect(r.measured).toBe(2)
    expect(r.avgDays).toBe(5)
    expect(r.medianDays).toBe(5)
    expect(r.longestDays).toBe(8)
  })

  it('is empty for no cases', () => {
    expect(avgTimeToClose([])).toMatchObject({ measured: 0, closedTotal: 0, avgDays: null })
  })
})

describe('openByTeam', () => {
  it('groups open cases by owning team and excludes closed/cancelled', () => {
    const r = openByTeam(cases)
    expect(r.openTotal).toBe(4) // c3, c4, c5, c7
    // every returned team has at least one case, closed cases contribute none.
    expect(r.rows.reduce((a, x) => a + x.value, 0)).toBe(4)
    expect(r.top.value).toBeGreaterThanOrEqual(1)
  })

  it('buckets a team-less open case as Unassigned rather than dropping it', () => {
    const r = openByTeam([{ case_status: '' }, { case_status: null }])
    expect(r.openTotal).toBe(2)
    expect(r.rows).toEqual([{ team: 'Unassigned', value: 2 }])
  })

  it('is empty for no cases', () => {
    expect(openByTeam([])).toMatchObject({ openTotal: 0, top: null })
  })
})

describe('slaBreachRate', () => {
  const now = '2026-07-15T00:00:00Z'

  it('returns rate null when NOTHING carries an SLA (unmeasurable, not 0%)', () => {
    const r = slaBreachRate([{ status: 'in_progress' }, {}], { now })
    expect(r.tracked).toBe(0)
    expect(r.breached).toBe(0)
    expect(r.rate).toBeNull()
  })

  it('counts only SLA-tracked items and flags the overdue unsatisfied ones', () => {
    const items = [
      { sla_due_at: '2026-07-10', status: 'in_progress' },          // overdue, open -> breach
      { due_at: '2026-07-20', status: 'in_progress' },              // not due yet -> ok
      { sla_due_at: '2026-07-01', status: 'completed' },            // overdue but satisfied -> ok
      { sla_due_at: '2026-07-01', completed_at: '2026-07-01' },     // satisfied by timestamp -> ok
      { status: 'in_progress' },                                    // no SLA -> not tracked
    ]
    const r = slaBreachRate(items, { now })
    expect(r.tracked).toBe(4)
    expect(r.breached).toBe(1)
    expect(r.rate).toBeCloseTo(0.25)
  })

  it('measures 0% honestly when every SLA is met', () => {
    const r = slaBreachRate([{ sla_due_at: '2026-07-20', status: 'in_progress' }], { now })
    expect(r.tracked).toBe(1)
    expect(r.breached).toBe(0)
    expect(r.rate).toBe(0)
  })
})

describe('closureLevelBreakdown', () => {
  it('always lists every level, counts open, and folds a stamp-less closed case into fully_closed', () => {
    const r = closureLevelBreakdown(cases)
    expect(r.total).toBe(7)
    // c1 + c2 both fully closed (c2 has no explicit level but is genuinely closed).
    expect(r.fullyClosed).toBe(2)
    // c3 financially_open; c4, c5, c6, c7 have no level -> open.
    expect(r.rows.find((x) => x.level === 'financially_open').value).toBe(1)
    expect(r.open).toBe(4)
    // all three known levels are always present as rows.
    expect(r.rows.map((x) => x.level)).toEqual(['financially_open', 'operationally_completed', 'fully_closed'])
    expect(r.rows[1].label).toBe(CLOSURE_LEVEL_LABELS.operationally_completed)
  })

  it('is empty for no cases', () => {
    expect(closureLevelBreakdown([])).toMatchObject({ total: 0, open: 0, fullyClosed: 0 })
  })
})

describe('reopenRate', () => {
  it('counts reopened cases and returns a share', () => {
    const r = reopenRate(cases)
    expect(r.total).toBe(7)
    expect(r.reopened).toBe(1) // c7
    expect(r.rate).toBeCloseTo(1 / 7)
  })

  it('recognises multiple reopen signals', () => {
    const r = reopenRate([
      { reopened_flag: true },
      { reopened: 'yes' },
      { reopen_count: 2 },
      { case_status: 'reopened' },
      { case_status: 'closed' },
    ])
    expect(r.reopened).toBe(4)
    expect(r.total).toBe(5)
  })

  it('returns rate null (not 0) for no cases', () => {
    expect(reopenRate([])).toMatchObject({ reopened: 0, total: 0, rate: null })
  })
})

describe('buildCaseAnalytics', () => {
  it('assembles every section into one object', () => {
    const ws = [{ accident_id: 'c3', workstream_key: 'repair', status: 'in_progress', sla_due_at: '2026-07-01' }]
    const r = buildCaseAnalytics(cases, ws, { now: '2026-07-15T00:00:00Z' })
    expect(r.basis.total).toBe(7)
    expect(r.status.top.token).toBeTruthy()
    expect(r.bottleneck.top).toMatchObject({ key: 'repair' })
    expect(r.timeToClose.measured).toBe(1)
    expect(r.openByTeam.openTotal).toBe(4)
    expect(r.sla.rate).toBeCloseTo(1)      // the single tracked ws is overdue + open
    expect(r.closureLevel.fullyClosed).toBe(2)
    expect(r.reopen.reopened).toBe(1)
  })

  it('degrades cleanly with no data', () => {
    const r = buildCaseAnalytics([], [], {})
    expect(r.basis.total).toBe(0)
    expect(r.bottleneck.measured).toBe(false)
    expect(r.timeToClose.avgDays).toBeNull()
    expect(r.sla.rate).toBeNull()
    expect(r.reopen.rate).toBeNull()
  })
})
