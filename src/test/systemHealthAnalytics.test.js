import { describe, it, expect } from 'vitest'
import {
  percentile, buildHealthRows, healthKpis, groupBreakdown, filterHealthRows,
  appendRun, historyStats, flappingChecks, runFreshness, healthExportRows,
} from '../lib/systemHealthAnalytics'

const CHECKS = [
  { id: 'database', group: 'database', label: 'Database', status: 'ok', latencyMs: 120, detail: '' },
  { id: 'table:tyre_records', group: 'tables', label: 'tyre_records', status: 'degraded', latencyMs: 2500, detail: 'slow' },
  { id: 'edge:chat-ai', group: 'edge', label: 'chat-ai', status: 'down', latencyMs: null, detail: 'timeout' },
  { id: 'auth', group: 'auth', label: 'Auth', status: 'weird', latencyMs: 80 },
]

describe('systemHealthAnalytics', () => {
  it('percentile is null on empty and nearest-rank otherwise', () => {
    expect(percentile([], 95)).toBeNull()
    expect(percentile([10, 20, 30, 40], 50)).toBe(20)
    expect(percentile([10, 20, 30, 40], 95)).toBe(40)
  })

  it('normalises unknown statuses and labels groups', () => {
    const rows = buildHealthRows(CHECKS)
    expect(rows[3].status).toBe('unknown')
    expect(rows[2].groupLabel).toBe('Edge Functions')
  })

  it('computes KPIs without faking latency', () => {
    const k = healthKpis(CHECKS)
    expect(k).toMatchObject({ total: 4, ok: 1, degraded: 1, down: 1, unknown: 1, measuredLatencyCount: 3 })
    expect(k.availabilityPct).toBe(25)
    expect(k.slowest.id).toBe('table:tyre_records')
    expect(healthKpis([]).availabilityPct).toBeNull()
    expect(healthKpis([]).avgLatencyMs).toBeNull()
  })

  it('breaks down per group with a worst status', () => {
    const g = groupBreakdown(CHECKS)
    expect(g.map((x) => x.group)).toEqual(['database', 'tables', 'storage', 'edge', 'auth'].filter((x) => g.some((y) => y.group === x)))
    expect(g.find((x) => x.group === 'edge').worst).toBe('down')
    expect(g.find((x) => x.group === 'auth').worst).toBe('degraded')
  })

  it('filters and sorts worst first', () => {
    const rows = buildHealthRows(CHECKS)
    expect(filterHealthRows(rows)[0].status).toBe('down')
    expect(filterHealthRows(rows, { group: 'tables' })).toHaveLength(1)
    expect(filterHealthRows(rows, { search: 'timeout' })[0].id).toBe('edge:chat-ai')
    expect(filterHealthRows(rows, { status: 'ok' })).toHaveLength(1)
  })

  it('keeps a bounded run history and detects flapping', () => {
    let h = []
    const run = (s, at) => ({ checkedAt: at, checks: [{ id: 'a', group: 'tables', status: s, latencyMs: 5 }] })
    h = appendRun(h, run('ok', '2026-01-01T00:00:00Z'))
    h = appendRun(h, run('down', '2026-01-01T00:01:00Z'))
    h = appendRun(h, run('ok', '2026-01-01T00:02:00Z'), 2)
    expect(h).toHaveLength(2)
    const s = historyStats(h)
    expect(s.runs).toBe(2)
    expect(s.healthyRunPct).toBe(50)
    expect(s.lastIncidentAt).toBe('2026-01-01T00:01:00Z')
    expect(flappingChecks(h, 1)).toEqual([{ id: 'a', changes: 1 }])
    expect(historyStats([]).healthyRunPct).toBeNull()
    expect(appendRun(h, null)).toHaveLength(2)
  })

  it('reports freshness against an injected clock', () => {
    const now = Date.parse('2026-01-01T00:05:00Z')
    expect(runFreshness('2026-01-01T00:04:30Z', now).label).toBe('30 s ago')
    expect(runFreshness('2026-01-01T00:00:00Z', now, 60000).stale).toBe(true)
    expect(runFreshness(null, now).label).toBe('N/A')
  })

  it('exports N/A for unmeasured latency', () => {
    const e = healthExportRows(buildHealthRows(CHECKS))
    expect(e[2].latency).toBe('N/A')
    expect(e[0].latency).toBe('120 ms')
  })
})
