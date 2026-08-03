import { describe, it, expect } from 'vitest'
import {
  shapeQualityResults, qualitySummary, shapeReconciliation, reconSummary,
  nextStatuses, CASE_STATUSES, ROOT_CAUSE_CATEGORIES, pipelineSummary, severityRank,
} from '../lib/dataTrustOps'

describe('shapeQualityResults + qualitySummary', () => {
  it('keeps the latest per rule and summarizes', () => {
    const rows = [
      { rule_key: 'a', status: 'fail', severity: 'error', measured_value: 3, failure_count: 3, checked_at: '2026-08-03T10:00:00Z' },
      { rule_key: 'a', status: 'pass', severity: 'error', measured_value: 0, failure_count: 0, checked_at: '2026-08-02T10:00:00Z' },
      { rule_key: 'b', status: 'warn', severity: 'warning', measured_value: 5, failure_count: 5, checked_at: '2026-08-03T10:00:00Z' },
      { rule_key: 'c', status: 'pass', severity: 'info', measured_value: 0, failure_count: 0, checked_at: '2026-08-03T10:00:00Z' },
    ]
    const shaped = shapeQualityResults(rows)
    expect(shaped).toHaveLength(3)
    expect(shaped.find((r) => r.ruleKey === 'a').status).toBe('fail') // newest kept
    expect(shaped[0].status).toBe('fail') // worst first
    const s = qualitySummary(shaped)
    expect(s).toMatchObject({ total: 3, fail: 1, warn: 1, pass: 1, affected: 8 })
  })
  it('honest empty', () => {
    expect(shapeQualityResults(null)).toEqual([])
    expect(qualitySummary([])).toMatchObject({ total: 0, fail: 0 })
  })
})

describe('shapeReconciliation', () => {
  it('shapes latest per key with numeric diffs', () => {
    const shaped = shapeReconciliation([
      { recon_key: 'x', label: 'X', expected_value: '100', actual_value: '90', difference: '10', unit: 'SAR', status: 'variance', run_at: 't2' },
    ])
    expect(shaped[0]).toMatchObject({ reconKey: 'x', expected: 100, actual: 90, difference: 10, status: 'variance' })
    expect(reconSummary(shaped)).toMatchObject({ total: 1, variance: 1, balanced: 0 })
  })
})

describe('case workflow', () => {
  it('exposes the ordered status flow', () => {
    expect(CASE_STATUSES[0]).toBe('reported')
    expect(nextStatuses('reported')).toContain('investigating')
    expect(nextStatuses('closed')).toEqual([])
    expect(nextStatuses('approved')).toContain('applied')
  })
  it('root cause vocabulary covers the small-cause list', () => {
    expect(ROOT_CAUSE_CATEGORIES).toContain('Wrong currency')
    expect(ROOT_CAUSE_CATEGORIES).toContain('Duplicate upload')
    expect(ROOT_CAUSE_CATEGORIES).toContain('Many-to-many multiplication')
  })
})

describe('pipelineSummary + severityRank', () => {
  it('buckets run statuses', () => {
    const s = pipelineSummary([{ status: 'committed' }, { status: 'failed' }, { status: 'draft' }])
    expect(s).toMatchObject({ total: 3, ok: 1, failed: 1, other: 1 })
  })
  it('ranks severities worst-first', () => {
    expect(severityRank('critical')).toBeLessThan(severityRank('warning'))
    expect(severityRank('unknown')).toBe(9)
  })
})
