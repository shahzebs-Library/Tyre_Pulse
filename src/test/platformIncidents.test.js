import { describe, it, expect } from 'vitest'
import {
  canTransition, allowedNext, durationMinutes, mttr, mtta, openBySeverity, countSince,
  platformStatus, weeklyCounts, shapeTimeline, formatDuration, sortIncidents, draftFromSignal, exportRows,
  NEXT_STATUS, STATUSES,
} from '../lib/platformIncidents'

const NOW = new Date('2026-09-24T12:00:00Z')
const inc = (o) => ({ id: Math.random().toString(36), title: 'X', severity: 'sev3', status: 'investigating',
  started_at: '2026-09-20T10:00:00Z', acknowledged_at: null, resolved_at: null, updates: [], ...o })

describe('status machine', () => {
  it('mirrors the SQL rules', () => {
    expect(canTransition('investigating', 'resolved')).toBe(true)
    expect(canTransition('resolved', 'monitoring')).toBe(false)
    expect(canTransition('resolved', 'investigating')).toBe(true)
    expect(canTransition('monitoring', 'monitoring')).toBe(true)
    expect(canTransition('bogus', 'resolved')).toBe(false)
    expect(allowedNext('resolved')).toEqual(['resolved', 'investigating'])
    for (const s of STATUSES) expect(NEXT_STATUS[s]).not.toContain(s)
  })
})

describe('durations and averages', () => {
  it('returns null, not 0, when unmeasurable', () => {
    expect(durationMinutes(null, NOW)).toBeNull()
    expect(durationMinutes('2026-09-24T12:00:00Z', '2026-09-24T11:00:00Z')).toBeNull()
    expect(durationMinutes('2026-09-24T11:00:00Z', '2026-09-24T12:00:00Z')).toBe(60)
    expect(mttr([inc({})], { now: NOW })).toBeNull()
    expect(mtta([inc({})], { now: NOW })).toBeNull()
    expect(mttr([], { now: NOW })).toBeNull()
  })

  it('averages resolved incidents only and respects the window', () => {
    const list = [
      inc({ status: 'resolved', started_at: '2026-09-20T10:00:00Z', resolved_at: '2026-09-20T12:00:00Z', acknowledged_at: '2026-09-20T10:10:00Z' }),
      inc({ status: 'resolved', started_at: '2026-09-21T10:00:00Z', resolved_at: '2026-09-21T14:00:00Z', acknowledged_at: '2026-09-21T10:30:00Z' }),
      inc({ status: 'resolved', started_at: '2025-01-01T10:00:00Z', resolved_at: '2025-01-05T10:00:00Z' }),
      inc({}),
    ]
    expect(mttr(list, { days: 90, now: NOW })).toBe(180)
    expect(mtta(list, { days: 90, now: NOW })).toBe(20)
    expect(countSince(list, 90, NOW)).toBe(3)
  })
})

describe('platform status', () => {
  it('derives operational, degraded and outage', () => {
    expect(platformStatus([]).level).toBe('operational')
    expect(platformStatus([inc({ severity: 'sev4' })]).level).toBe('operational')
    expect(platformStatus([inc({ severity: 'sev2' })]).level).toBe('degraded')
    expect(platformStatus([inc({ severity: 'sev1' }), inc({ severity: 'sev3' })]).level).toBe('outage')
    expect(platformStatus([inc({ severity: 'sev1', status: 'resolved', resolved_at: '2026-09-21T00:00:00Z' })]).level).toBe('operational')
    expect(openBySeverity([inc({ severity: 'sev1' }), inc({ severity: 'sev1' })]).sev1).toBe(2)
  })
})

describe('weekly counts', () => {
  it('zero-fills and buckets by Monday week', () => {
    const w = weeklyCounts([inc({ started_at: '2026-09-22T08:00:00Z' }), inc({ started_at: '2026-09-15T08:00:00Z' })], 4, NOW)
    expect(w.values).toEqual([0, 0, 1, 1])
    expect(w.labels).toHaveLength(4)
  })
})

describe('timeline', () => {
  it('orders updates and flags status changes', () => {
    const t = shapeTimeline({ updates: [
      { id: 'b', status: 'identified', message: 'b', created_at: '2026-09-20T11:00:00Z' },
      { id: 'a', status: 'investigating', message: 'a', created_at: '2026-09-20T10:00:00Z' },
      { id: 'c', status: 'identified', message: 'c', created_at: '2026-09-20T11:30:00Z' },
    ] })
    expect(t.map((u) => u.id)).toEqual(['a', 'b', 'c'])
    expect(t[0].opened).toBe(true)
    expect(t[0].sincePrevMin).toBeNull()
    expect(t[1].statusChanged).toBe(true)
    expect(t[2].statusChanged).toBe(false)
    expect(t[2].sincePrevMin).toBe(30)
    expect(shapeTimeline(null)).toEqual([])
  })
})

describe('helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(null)).toBe('N/A')
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(200)).toBe('3h 20m')
    expect(formatDuration(60 * 52)).toBe('2d 4h')
  })

  it('sorts open first then by severity', () => {
    const s = sortIncidents([
      inc({ id: 'r', severity: 'sev1', status: 'resolved', resolved_at: '2026-09-21T00:00:00Z' }),
      inc({ id: 'o3', severity: 'sev3' }),
      inc({ id: 'o1', severity: 'sev1' }),
    ])
    expect(s.map((i) => i.id)).toEqual(['o1', 'o3', 'r'])
  })

  it('drafts from signals', () => {
    const d = draftFromSignal('system_log', { id: 'L1', severity: 'critical', message: 'Boom', module_id: 'reports' })
    expect(d).toMatchObject({ title: 'Boom', severity: 'sev2', source_type: 'system_log', source_ref: 'L1', affected_modules: ['reports'] })
    expect(draftFromSignal('trust_alert', { id: 7, severity: 'low', message: 'Gap' })).toMatchObject({ severity: 'sev3', source_ref: '7' })
    expect(draftFromSignal('other').source_type).toBe('manual')
  })

  it('exports N/A for unmeasured times', () => {
    const [row] = exportRows([inc({})])
    expect(row.time_to_resolve).toBe('N/A')
    expect(row.time_to_ack).toBe('N/A')
  })
})
