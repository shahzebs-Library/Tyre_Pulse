import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: chainable, thenable query builder that records
// the table queried and the modifiers applied, and resolves to a configurable
// { data, error }. Mirrors src/test/alertThresholds.api.test.js, plus limit()/rpc().
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: [] }
  function from(table) {
    const calls = { order: [], limit: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      order(col, opts) { calls.order.push([col, opts]); return b },
      limit(n) { calls.limit.push(n); return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  function rpc(fn, args) {
    state.rpc.push([fn, args])
    return Promise.resolve(state.rpcResult || { data: null, error: null })
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const {
  severityRank,
  normalizeSeverity,
  sortBySeverity,
  filterUnread,
  countUnread,
  groupByDay,
  alertRowToNotification,
  fetchLatestAlerts,
  markNotificationRead,
  ALERT_FEED_LIMIT,
} = await import('../lib/notifications')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.rpcResult = undefined
  h.state.last = null
  h.state.rpc = []
})

// ─────────────────────────────────────────────────────────────────────────────
// severityRank / normalizeSeverity - must mirror Alerts.jsx SEV_SORT_ORDER
// ─────────────────────────────────────────────────────────────────────────────
describe('severityRank', () => {
  it('ranks Critical < High < Medium < Low', () => {
    expect(severityRank('Critical')).toBe(0)
    expect(severityRank('High')).toBe(1)
    expect(severityRank('Medium')).toBe(2)
    expect(severityRank('Low')).toBe(3)
  })

  it('treats unknown severities as least severe', () => {
    expect(severityRank('Bogus')).toBe(3)
    expect(severityRank(undefined)).toBe(3)
    expect(severityRank(null)).toBe(3)
  })
})

describe('normalizeSeverity', () => {
  it('maps lowercase DB enums to display severities', () => {
    expect(normalizeSeverity('critical')).toBe('Critical')
    expect(normalizeSeverity('high')).toBe('High')
    expect(normalizeSeverity('medium')).toBe('Medium')
    expect(normalizeSeverity('low')).toBe('Low')
    expect(normalizeSeverity('info')).toBe('Low')
  })

  it('is case-insensitive and defaults unknowns to Medium', () => {
    expect(normalizeSeverity('CRITICAL')).toBe('Critical')
    expect(normalizeSeverity('weird')).toBe('Medium')
    expect(normalizeSeverity(null)).toBe('Medium')
  })
})

describe('sortBySeverity', () => {
  it('orders most severe first, newest first within a tier, without mutating input', () => {
    const input = [
      { id: 'a', severity: 'Low',      timestamp: '2026-07-07T10:00:00Z' },
      { id: 'b', severity: 'Critical', timestamp: '2026-07-06T10:00:00Z' },
      { id: 'c', severity: 'Critical', timestamp: '2026-07-07T09:00:00Z' },
      { id: 'd', severity: 'High',     timestamp: '2026-07-07T08:00:00Z' },
    ]
    const snapshot = [...input]
    expect(sortBySeverity(input).map(n => n.id)).toEqual(['c', 'b', 'd', 'a'])
    expect(input).toEqual(snapshot)
  })

  it('handles empty and nullish input', () => {
    expect(sortBySeverity([])).toEqual([])
    expect(sortBySeverity(null)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Unread filtering
// ─────────────────────────────────────────────────────────────────────────────
describe('filterUnread / countUnread', () => {
  const list = [
    { id: 1, read: false },
    { id: 2, read: true },
    { id: 3 },              // missing flag counts as unread
  ]

  it('filters to unread only', () => {
    expect(filterUnread(list).map(n => n.id)).toEqual([1, 3])
  })

  it('counts unread', () => {
    expect(countUnread(list)).toBe(2)
    expect(countUnread([])).toBe(0)
    expect(countUnread(null)).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// groupByDay
// ─────────────────────────────────────────────────────────────────────────────
describe('groupByDay', () => {
  // Fixed "now" at local noon so day boundaries are unambiguous.
  const now = new Date(2026, 6, 7, 12, 0, 0) // 7 Jul 2026 local

  it('groups into Today / Yesterday / dated buckets, newest day first', () => {
    const list = [
      { id: 'old',   timestamp: new Date(2026, 6, 1, 9, 0).toISOString() },
      { id: 'today', timestamp: new Date(2026, 6, 7, 8, 0).toISOString() },
      { id: 'yday',  timestamp: new Date(2026, 6, 6, 23, 0).toISOString() },
    ]
    const groups = groupByDay(list, now)
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', groups[2].label])
    expect(groups[0].items.map(n => n.id)).toEqual(['today'])
    expect(groups[1].items.map(n => n.id)).toEqual(['yday'])
    expect(groups[2].key).toBe('2026-07-01')
    expect(groups[2].items.map(n => n.id)).toEqual(['old'])
  })

  it('keeps newest-first order inside each group', () => {
    const list = [
      { id: 'earlier', timestamp: new Date(2026, 6, 7, 7, 0).toISOString() },
      { id: 'later',   timestamp: new Date(2026, 6, 7, 11, 0).toISOString() },
    ]
    const groups = groupByDay(list, now)
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map(n => n.id)).toEqual(['later', 'earlier'])
  })

  it('buckets invalid timestamps under Earlier and tolerates empty input', () => {
    const groups = groupByDay([{ id: 'x', timestamp: 'not-a-date' }], now)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Earlier')
    expect(groupByDay([], now)).toEqual([])
    expect(groupByDay(null, now)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// alertRowToNotification
// ─────────────────────────────────────────────────────────────────────────────
describe('alertRowToNotification', () => {
  it('maps a full alerts row', () => {
    const n = alertRowToNotification({
      id: 42,
      asset_no: 'TRK-001',
      alert_type: 'tyre_risk',
      severity: 'critical',
      message: 'Tread below 2mm',
      created_at: '2026-07-07T05:00:00Z',
    })
    expect(n).toEqual({
      id: 'alert-42',
      type: 'tyre_risk',
      title: 'Tyre Risk - TRK-001',
      message: 'Tread below 2mm',
      severity: 'Critical',
      assetNo: 'TRK-001',
      timestamp: '2026-07-07T05:00:00Z',
      read: false,
    })
  })

  it('humanizes unknown alert types and tolerates missing fields', () => {
    const n = alertRowToNotification({ id: 'x1', alert_type: 'brake_wear_check', severity: 'nope' })
    expect(n.title).toBe('Brake Wear Check')
    expect(n.severity).toBe('Medium')
    expect(n.assetNo).toBeNull()
    expect(n.message).toBe('')
    expect(typeof n.timestamp).toBe('string')
  })

  it('falls back to Fleet Alert when alert_type is missing', () => {
    const n = alertRowToNotification({ id: 1, asset_no: 'V-9' })
    expect(n.title).toBe('Fleet Alert - V-9')
    expect(n.type).toBe('alert')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Supabase wrappers
// ─────────────────────────────────────────────────────────────────────────────
describe('fetchLatestAlerts', () => {
  it('queries alerts newest-first with the default limit and maps rows', async () => {
    h.state.result = {
      data: [{ id: 1, alert_type: 'tyre_risk', severity: 'high', asset_no: 'A1', message: 'm', created_at: '2026-07-07T00:00:00Z' }],
      error: null,
    }
    const rows = await fetchLatestAlerts()
    expect(h.state.last._table).toBe('alerts')
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(h.state.last._calls.limit).toContainEqual(ALERT_FEED_LIMIT)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'alert-1', severity: 'High', assetNo: 'A1' })
  })

  it('respects a custom limit', async () => {
    await fetchLatestAlerts({ limit: 5 })
    expect(h.state.last._calls.limit).toContainEqual(5)
  })

  it('throws on Supabase error so callers can show an error state', async () => {
    h.state.result = { data: null, error: new Error('boom') }
    await expect(fetchLatestAlerts()).rejects.toThrow('boom')
  })

  it('returns [] when data is null without error', async () => {
    h.state.result = { data: null, error: null }
    expect(await fetchLatestAlerts()).toEqual([])
  })
})

describe('markNotificationRead', () => {
  it('calls the mark_notification_read RPC with p_id', async () => {
    await markNotificationRead('abc-123')
    expect(h.state.rpc).toContainEqual(['mark_notification_read', { p_id: 'abc-123' }])
  })

  it('never rejects, even if the RPC throws', async () => {
    h.supabase.rpc = () => Promise.reject(new Error('offline'))
    const res = await markNotificationRead('abc-123', { client: h.supabase })
    expect(res.error).toBeInstanceOf(Error)
    // restore
    h.supabase.rpc = (fn, args) => { h.state.rpc.push([fn, args]); return Promise.resolve({ data: null, error: null }) }
  })
})
