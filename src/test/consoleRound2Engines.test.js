import { describe, it, expect } from 'vitest'
import { jobHealth, healthCounts, withinDays, fmtDuration } from '../lib/pipelineHealth'
import { responseTimes, fmtHours, allowedDecisions, decisionImpact } from '../lib/trustAlertOps'
import {
  completeness, nextVersion, validateMetricDraft, validateVersionDraft, draftToRow, statusOf, parseList,
} from '../lib/metricGovernance'

describe('pipelineHealth', () => {
  const runs = [
    { job_key: 'tyre', status: 'failed', started_at: '2026-10-04T10:00:00Z' },
    { job_key: 'tyre', status: 'error', started_at: '2026-10-03T10:00:00Z' },
    { job_key: 'tyre', status: 'committed', started_at: '2026-10-02T10:00:00Z', finished_at: '2026-10-02T10:00:30Z' },
    { job_key: 'fleet', status: 'committed', started_at: '2026-10-04T09:00:00Z', finished_at: '2026-10-04T09:00:02Z' },
    { job_key: 'fleet', status: 'failed', started_at: '2026-10-01T09:00:00Z' },
    { job_key: 'fleet', status: 'committed', started_at: '2026-09-30T09:00:00Z' },
    { job_key: null, status: 'staged', started_at: '2026-10-04T08:00:00Z' },
  ]
  it('ranks failing first and measures the streak', () => {
    const h = jobHealth(runs)
    expect(h[0].job).toBe('tyre')
    expect(h[0].health).toBe('failing')
    expect(h[0].failingStreak).toBe(2)
    expect(h[0].lastSuccess).toBe('2026-10-02T10:00:00Z')
    expect(h[0].avgDurationMs).toBe(30000)
    const fleet = h.find((x) => x.job === 'fleet')
    expect(fleet.health).toBe('flaky')
    expect(fleet.successRate).toBeCloseTo(2 / 3)
    const unnamed = h.find((x) => x.job === 'Unnamed job')
    expect(unnamed.health).toBe('unknown')
    expect(unnamed.successRate).toBeNull()
    expect(unnamed.avgDurationMs).toBeNull()
    expect(healthCounts(h)).toEqual({ failing: 1, flaky: 1, healthy: 0, unknown: 1 })
  })
  it('windows by date and formats durations', () => {
    const now = new Date('2026-10-04T12:00:00Z').getTime()
    expect(withinDays(runs, 1, now)).toHaveLength(3)
    expect(withinDays(runs, 0, now)).toHaveLength(runs.length)
    expect(fmtDuration(null)).toBe('N/A')
    expect(fmtDuration(850)).toBe('850 ms')
    expect(fmtDuration(185000)).toBe('3 min 5 s')
  })
})

describe('trustAlertOps', () => {
  it('measures medians only from rows that carry both times', () => {
    const t = responseTimes([
      { status: 'resolved', created_at: '2026-10-01T00:00:00Z', acked_at: '2026-10-01T01:00:00Z', resolved_at: '2026-10-01T04:00:00Z' },
      { status: 'ack', created_at: '2026-10-01T00:00:00Z', acked_at: '2026-10-01T03:00:00Z' },
      { status: 'open', created_at: '2026-10-01T00:00:00Z' },
    ])
    expect(t.mtta).toBe(2)
    expect(t.mttr).toBe(4)
    expect(t.resolveSample).toBe(1)
    expect(responseTimes([]).mtta).toBeNull()
    expect(fmtHours(null)).toBe('N/A')
    expect(fmtHours(0.5)).toBe('30 min')
    expect(fmtHours(72)).toBe('3.0 days')
  })
  it('allows only real transitions and explains each', () => {
    expect(allowedDecisions('open')).toEqual(['ack', 'resolved'])
    expect(allowedDecisions('resolved')).toEqual(['open'])
    expect(allowedDecisions('weird')).toEqual([])
    expect(decisionImpact('resolved', 3).what).toBe('Resolve these 3 alerts')
    expect(decisionImpact('open').undo).toMatch(/Yes/)
  })
})

describe('metricGovernance', () => {
  it('scores completeness and refuses an incomplete certification', () => {
    expect(completeness({ business_owner: 'Fleet' }).score).toBe(20)
    expect(validateMetricDraft({ name: 'X', status: 'certified' })).toMatch(/certified metric needs/)
    expect(validateMetricDraft({
      name: 'X', status: 'certified', business_owner: 'a', source_table: 'b', refresh_sla: 'c', unit: 'd', description: 'e',
    })).toBe('')
  })
  it('validates ids, versions and builds a clean row', () => {
    expect(validateMetricDraft({ metric_id: 'Bad Id', name: 'x' }, { isNew: true })).toMatch(/lower case/)
    expect(validateMetricDraft({ metric_id: 'fleet_cpk', name: 'x' }, { isNew: true, existingIds: ['fleet_cpk'] })).toMatch(/already exists/)
    expect(nextVersion([{ version: 1 }, { version: 3 }])).toBe(4)
    expect(nextVersion([])).toBe(1)
    expect(validateVersionDraft({ formula: 'a/b', change_note: 'ok' })).toMatch(/at least 3/)
    expect(validateVersionDraft({ formula: 'a/b', change_note: 'first cut' })).toBe('')
    const row = draftToRow({ metric_id: ' m ', name: ' N ', unit: '', dashboards: 'A, B', status: 'nonsense' })
    expect(row).toMatchObject({ metric_id: 'm', name: 'N', unit: null, dashboards: ['A', 'B'], status: null })
    expect(statusOf({ status: 'draft' })).toBe('draft')
    expect(statusOf({})).toBe('none')
    expect(parseList('')).toBeNull()
  })
})
