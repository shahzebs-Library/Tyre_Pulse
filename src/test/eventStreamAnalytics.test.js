import { describe, it, expect } from 'vitest'
import {
  statusCounts, sampleCoverage, eventsByType, volumeByHour, volumeByDay,
  throughput, lastEventAgeMs, formatAge, consumerHealth, eventStreamKpis, eventExportRows,
} from '../lib/eventStreamAnalytics'

const NOW = new Date('2026-09-26T12:00:00Z')
const at = (h) => new Date(NOW.getTime() - h * 3600000).toISOString()
const ev = (id, type, status, h, extra = {}) => ({ id, event_type: type, status, created_at: at(h), attempts: 1, ...extra })

const EVENTS = [
  ev(5, 'tyre.installed', 'processed', 0.5),
  ev(4, 'tyre.installed', 'failed', 2, { last_error: 'boom' }),
  ev(3, 'workorder.created', 'pending', 5),
  ev(2, 'workorder.created', 'processed', 30),
  ev(1, 'inspection.done', 'weird', 50),
]

describe('eventStreamAnalytics', () => {
  it('counts statuses and buckets unknowns', () => {
    expect(statusCounts(EVENTS)).toEqual({ pending: 1, processed: 2, failed: 1, unknown: 1 })
    expect(statusCounts(null)).toEqual({ pending: 0, processed: 0, failed: 0, unknown: 0 })
  })

  it('reports sample coverage and truncation', () => {
    const c = sampleCoverage(EVENTS, { limit: 5 })
    expect(c.size).toBe(5)
    expect(c.truncated).toBe(true)
    expect(c.newestMs).toBe(new Date(at(0.5)).getTime())
    expect(sampleCoverage([], { limit: 5 })).toMatchObject({ size: 0, oldestMs: null, truncated: false })
  })

  it('groups events per type busiest first with failure rate', () => {
    const t = eventsByType(EVENTS)
    expect(t[0].type).toBe('tyre.installed')
    expect(t[0]).toMatchObject({ count: 2, failed: 1, failureRate: 0.5 })
    expect(t.find((r) => r.type === 'workorder.created').pending).toBe(1)
    expect(eventsByType([])).toEqual([])
  })

  it('buckets hourly and daily volume ending at now', () => {
    const h = volumeByHour(EVENTS, { now: NOW, hours: 24, limit: 0 })
    expect(h).toHaveLength(24)
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(3)
    expect(h[23].count).toBe(1)
    const d = volumeByDay(EVENTS, { now: NOW, days: 7, limit: 0 })
    expect(d.reduce((s, b) => s + b.count, 0)).toBe(5)
    expect(d.every((b) => b.complete)).toBe(true)
  })

  it('marks buckets older than a truncated sample as incomplete', () => {
    const d = volumeByDay(EVENTS, { now: NOW, days: 7, limit: 5 })
    expect(d[0].complete).toBe(false)
    expect(d[6].complete).toBe(true)
  })

  it('throughput is a lower bound when the sample does not reach the window start', () => {
    const full = throughput(EVENTS, { now: NOW, hours: 24, limit: 0 })
    expect(full).toMatchObject({ count: 3, perHour: 3 / 24, complete: true })
    const recent = [ev(1, 'a', 'processed', 1), ev(2, 'a', 'processed', 2)]
    expect(throughput(recent, { now: NOW, hours: 24, limit: 2 }).complete).toBe(false)
  })

  it('last event age is null when there is nothing', () => {
    expect(lastEventAgeMs(EVENTS, { now: NOW })).toBe(1800000)
    expect(lastEventAgeMs([], { now: NOW })).toBeNull()
    expect(formatAge(null)).toBe('N/A')
    expect(formatAge(1800000)).toBe('30 min')
    expect(formatAge(2 * 86400000)).toBe('2 days')
  })

  it('classifies consumer health', () => {
    const h = consumerHealth([
      { consumer: 'webhooks', event_types: ['tyre.installed'], enabled: true },
      { consumer: 'rules', event_types: ['inspection.done'], enabled: true },
      { consumer: 'off', event_types: [], enabled: false },
      { consumer: 'all', event_types: [], enabled: true },
    ], EVENTS)
    expect(h.map((c) => c.state)).toEqual(['attention', 'healthy', 'disabled', 'attention'])
    expect(h[3]).toMatchObject({ subscribesAll: true, matched: 5, failed: 1, pending: 1 })
  })

  it('KPIs keep unread counts null and never fabricate a failure rate', () => {
    const k = eventStreamKpis({ events: EVENTS, totals: { all: 100, failed: 4, pending: null }, consumers: null, now: NOW, limit: 0 })
    expect(k.total).toBe(100)
    expect(k.failureRate).toBeCloseTo(0.04)
    expect(k.pending).toBeNull()
    expect(k.consumers).toBeNull()
    expect(k.eventsLast24h).toBe(3)
    const empty = eventStreamKpis({ events: [], totals: { all: 0, failed: 0 }, consumers: [], now: NOW })
    expect(empty.failureRate).toBeNull()
    expect(empty.lastEventAgeMs).toBeNull()
    expect(empty.consumers).toBe(0)
  })

  it('export rows are ASCII with N/A for blanks', () => {
    const rows = eventExportRows([{ event_type: 'x', status: 'failed', entity_type: 'tyre', entity_id: '9' }, {}])
    expect(rows[0]).toMatchObject({ entity: 'tyre #9', status: 'Failed', attempts: 'N/A', last_error: 'N/A' })
    expect(rows[1].event_type).toBe('N/A')
    expect(JSON.stringify(rows)).not.toMatch(/[–—]/)
  })
})
