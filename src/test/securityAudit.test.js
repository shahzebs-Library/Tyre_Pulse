import { describe, it, expect } from 'vitest'
import { shapePosture, postureSummary, sortChecks, scanTrend, needsAttention } from '../lib/securityAudit'

const raw = {
  generated_at: '2026-09-24T08:00:00Z',
  score: 91,
  activity: { console_logins_7d: 3 },
  checks: [
    { id: 'a', title: 'Passing', category: 'Identity', severity: 'high', status: 'pass', count: 0, items: [] },
    { id: 'b', title: 'Warn low', category: 'Code', severity: 'low', status: 'warn', count: 2, items: ['vector', 'pg_net'] },
    { id: 'c', title: 'Fail crit', category: 'Data', severity: 'critical', status: 'fail', count: 1, items: ['t'] },
    { id: 'd', title: 'Manual', category: 'Identity', severity: 'medium', status: 'manual', count: null },
    { id: 'e', title: 'Unknown sev', status: 'info', severity: 'bogus' },
  ],
}

describe('securityAudit engine', () => {
  it('shapes, keeps null counts as null and folds unknown severity to low', () => {
    const p = shapePosture(raw)
    expect(p.score).toBe(91)
    expect(p.checks.find((c) => c.id === 'd').count).toBeNull()
    expect(p.checks.find((c) => c.id === 'e').severity).toBe('low')
  })
  it('sorts failing first, then by severity', () => {
    const ids = sortChecks(shapePosture(raw).checks).map((c) => c.id)
    expect(ids[0]).toBe('c')
    expect(ids[ids.length - 1]).toBe('a')
  })
  it('summarises open findings by severity; manual is not counted as open', () => {
    const s = postureSummary(shapePosture(raw))
    expect(s.open).toBe(2)
    expect(s.bySeverity).toEqual({ critical: 1, high: 0, medium: 0, low: 1 })
    expect(s.manual).toBe(1)
    expect(s.passing).toBe(1)
  })
  it('needsAttention covers fail, warn and manual only', () => {
    expect(['fail', 'warn', 'manual', 'pass', 'info'].map((status) => needsAttention({ status })))
      .toEqual([true, true, true, false, false])
  })
  it('returns null for an empty payload rather than a fake zero score', () => {
    expect(shapePosture(null)).toBeNull()
    expect(postureSummary(null).total).toBe(0)
  })
  it('builds an oldest-first trend and keeps missing scores as gaps', () => {
    const t = scanTrend([
      { ran_at: '2026-09-20T00:00:00Z', score: 90 },
      { ran_at: '2026-09-13T00:00:00Z', score: null },
    ])
    expect(t.scores).toEqual([null, 90])
  })
})
