import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock — chainable, thenable query builder recording
// the table queried and modifiers applied. Mirrors src/test/notifications.test.js.
const h = vi.hoisted(() => {
  const state = { results: {}, defaultResult: { data: [], error: null }, queries: [] }
  function from(table) {
    const calls = { order: [], limit: [], gte: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      order(col, opts) { calls.order.push([col, opts]); return b },
      limit(n) { calls.limit.push(n); return b },
      gte(col, val) { calls.gte.push([col, val]); return b },
      then(onF, onR) {
        const result = state.results[table] ?? state.defaultResult
        return Promise.resolve(result).then(onF, onR)
      },
    }
    state.queries.push(b)
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const {
  zeroFillDays,
  pctChange,
  topN,
  toDayKey,
  humanizeTableName,
  mapTableToModule,
  buildModuleAdoption,
  estimateAiCost,
  shapeUserStats,
  shapeActivityStats,
  shapeAiUsage,
  fetchDataGrowth,
  runTenantReport,
  GROWTH_TABLES,
  WINDOW_DAYS,
} = await import('../lib/tenantHealth')

beforeEach(() => {
  h.state.results = {}
  h.state.defaultResult = { data: [], error: null }
  h.state.queries = []
})

// Fixed "now" at local noon so day boundaries are unambiguous.
const NOW = new Date(2026, 6, 7, 12, 0, 0) // 7 Jul 2026 local

// ─────────────────────────────────────────────────────────────────────────────
// zeroFillDays
// ─────────────────────────────────────────────────────────────────────────────
describe('zeroFillDays', () => {
  it('produces one entry per day, oldest first, zero-filling gaps', () => {
    const rows = [
      { date: '2026-07-07', events: 5 },
      { date: '2026-07-05', events: 2 },
    ]
    const out = zeroFillDays(rows, 4, NOW)
    expect(out.map(d => d.date)).toEqual(['2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07'])
    expect(out.map(d => d.events)).toEqual([0, 2, 0, 5])
  })

  it('drops rows outside the window and preserves multiple numeric fields', () => {
    const rows = [
      { date: '2026-06-01', cost: 9, calls: 9 },   // outside 3-day window
      { date: '2026-07-06', cost: 1.5, calls: 3 },
    ]
    const out = zeroFillDays(rows, 3, NOW)
    expect(out).toHaveLength(3)
    expect(out.find(d => d.date === '2026-07-06')).toEqual({ date: '2026-07-06', cost: 1.5, calls: 3 })
    expect(out.find(d => d.date === '2026-07-05')).toEqual({ date: '2026-07-05', cost: 0, calls: 0 })
    expect(out.some(d => d.date === '2026-06-01')).toBe(false)
  })

  it('tolerates empty/nullish input and clamps days to at least 1', () => {
    expect(zeroFillDays([], 2, NOW)).toHaveLength(2)
    expect(zeroFillDays(null, 2, NOW)).toHaveLength(2)
    expect(zeroFillDays([], 0, NOW)).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// pctChange
// ─────────────────────────────────────────────────────────────────────────────
describe('pctChange', () => {
  it('computes rounded percent change', () => {
    expect(pctChange(150, 100)).toBe(50)
    expect(pctChange(75, 100)).toBe(-25)
    expect(pctChange(101, 300)).toBe(-66.3)
  })

  it('handles zero baseline: 0→0 is 0, 0→n is null (undefined growth)', () => {
    expect(pctChange(0, 0)).toBe(0)
    expect(pctChange(10, 0)).toBeNull()
  })

  it('returns null for non-finite input', () => {
    expect(pctChange('abc', 10)).toBeNull()
    expect(pctChange(10, undefined)).toBeNull()
    expect(pctChange(NaN, 5)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// topN
// ─────────────────────────────────────────────────────────────────────────────
describe('topN', () => {
  it('sorts by count desc then key asc, and limits to n', () => {
    const out = topN({ UPDATE: 5, DELETE: 2, INSERT: 5, UPLOAD: 1 }, 3)
    expect(out).toEqual([
      { key: 'INSERT', count: 5 },
      { key: 'UPDATE', count: 5 },
      { key: 'DELETE', count: 2 },
    ])
  })

  it('accepts a Map, skips non-numeric values, tolerates nullish input', () => {
    const out = topN(new Map([['a', 3], ['b', 'x'], ['c', 1]]), 5)
    expect(out).toEqual([{ key: 'a', count: 3 }, { key: 'c', count: 1 }])
    expect(topN(null)).toEqual([])
    expect(topN({}, 0)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Module mapping / adoption
// ─────────────────────────────────────────────────────────────────────────────
describe('mapTableToModule / humanizeTableName', () => {
  it('maps known tables to module labels', () => {
    expect(mapTableToModule('tyre_records')).toBe('Tyre Records')
    expect(mapTableToModule('vehicle_fleet')).toBe('Fleet Management')
    expect(mapTableToModule('import_batches')).toBe('Data Intake')
    expect(mapTableToModule('upload_history')).toBe('Data Intake')
  })

  it('humanizes unknown tables and defaults missing names to Other', () => {
    expect(mapTableToModule('gate_pass_logs')).toBe('Gate Pass Logs')
    expect(mapTableToModule(null)).toBe('Other')
    expect(mapTableToModule('')).toBe('Other')
    expect(humanizeTableName('scheduled_reports')).toBe('Scheduled Reports')
  })
})

describe('buildModuleAdoption', () => {
  it('aggregates events per module with share percentages, sorted desc', () => {
    const rows = [
      { table_name: 'tyre_records' },
      { table_name: 'tyre_records' },
      { table_name: 'import_batches' },
      { table_name: 'upload_history' },  // merges into Data Intake
      { table_name: null },              // Other
    ]
    const out = buildModuleAdoption(rows)
    expect(out[0]).toEqual({ module: 'Data Intake', events: 2, share: 40 })
    expect(out[1]).toEqual({ module: 'Tyre Records', events: 2, share: 40 })
    expect(out[2]).toEqual({ module: 'Other', events: 1, share: 20 })
  })

  it('returns [] for empty/nullish input', () => {
    expect(buildModuleAdoption([])).toEqual([])
    expect(buildModuleAdoption(null)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// estimateAiCost — must mirror AiCostMonitor.estimateCost
// ─────────────────────────────────────────────────────────────────────────────
describe('estimateAiCost', () => {
  it('prefers a stored cost_usd', () => {
    expect(estimateAiCost({ cost_usd: '0.42', prompt_tokens: 999999 })).toBe(0.42)
  })

  it('falls back to per-model token rates, then default rates', () => {
    // haiku: (1000*0.00025 + 1000*0.00125)/1000 = 0.0015
    expect(estimateAiCost({ model: 'claude-haiku-4-5', prompt_tokens: 1000, completion_tokens: 1000 }))
      .toBeCloseTo(0.0015)
    // default: (1000*0.003 + 0)/1000 = 0.003
    expect(estimateAiCost({ model: 'mystery-model', prompt_tokens: 1000, completion_tokens: 0 }))
      .toBeCloseTo(0.003)
  })

  it('treats missing token counts as zero', () => {
    expect(estimateAiCost({ model: 'mystery-model' })).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// shapeUserStats
// ─────────────────────────────────────────────────────────────────────────────
describe('shapeUserStats', () => {
  it('computes totals, role split, approval, lock, and 30-day signups', () => {
    const rows = [
      { id: 1, full_name: 'A', role: 'Admin',   approved: true,  locked: false, created_at: '2026-07-01T00:00:00Z' },
      { id: 2, full_name: 'B', role: 'Manager', approved: false, locked: false, created_at: '2026-01-01T00:00:00Z' },
      { id: 3, username: 'c', role: null,       approved: true,  locked: true,  created_at: '2026-06-20T00:00:00Z' },
    ]
    const s = shapeUserStats(rows, NOW)
    expect(s.total).toBe(3)
    expect(s.byRole).toEqual({ Admin: 1, Manager: 1, Unassigned: 1 })
    expect(s.approved).toBe(2)
    expect(s.pending).toBe(1)
    expect(s.pendingUsers).toEqual([{ id: 2, name: 'B', role: 'Manager', createdAt: '2026-01-01T00:00:00Z' }])
    expect(s.locked).toBe(1)
    expect(s.newLast30).toBe(2) // 1 Jul and 20 Jun are within 30 days of 7 Jul
  })

  it('handles empty input', () => {
    const s = shapeUserStats([], NOW)
    expect(s).toMatchObject({ total: 0, approved: 0, pending: 0, locked: 0, newLast30: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// shapeActivityStats
// ─────────────────────────────────────────────────────────────────────────────
describe('shapeActivityStats', () => {
  it('builds zero-filled per-day series with distinct active users per day', () => {
    const rows = [
      { user_id: 'u1', action: 'UPDATE', table_name: 'tyre_records', created_at: '2026-07-07T08:00:00Z' },
      { user_id: 'u1', action: 'UPDATE', table_name: 'tyre_records', created_at: '2026-07-07T09:00:00Z' },
      { user_id: 'u2', action: 'UPLOAD', table_name: 'import_batches', created_at: '2026-07-06T10:00:00Z' },
    ]
    const s = shapeActivityStats(rows, 3, NOW)
    expect(s.totalEvents).toBe(3)
    expect(s.activeUsers).toBe(2)
    expect(s.eventsPerDay.map(d => d.date)).toEqual(['2026-07-05', '2026-07-06', '2026-07-07'])
    expect(s.eventsPerDay.map(d => d.events)).toEqual([0, 1, 2])
    expect(s.eventsPerDay.map(d => d.activeUsers)).toEqual([0, 1, 1]) // u1 deduped on 07-07
    expect(s.topActions[0]).toEqual({ key: 'UPDATE', count: 2 })
    expect(s.topTables[0]).toEqual({ key: 'tyre_records', count: 2 })
  })

  it('tolerates rows with missing fields and empty input', () => {
    const s = shapeActivityStats([{ created_at: '2026-07-07T00:00:00Z' }, {}], 2, NOW)
    expect(s.totalEvents).toBe(2)
    expect(s.activeUsers).toBe(0)
    expect(s.topActions).toEqual([])
    expect(shapeActivityStats([], 2, NOW).eventsPerDay).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// shapeAiUsage
// ─────────────────────────────────────────────────────────────────────────────
describe('shapeAiUsage', () => {
  it('totals cost/tokens and groups by day and feature', () => {
    const rows = [
      { cost_usd: 0.5, prompt_tokens: 100, completion_tokens: 50, feature: 'chat',   created_at: '2026-07-07T01:00:00Z' },
      { cost_usd: 0.25, prompt_tokens: 10, completion_tokens: 10, feature: 'chat',   created_at: '2026-07-06T01:00:00Z' },
      { cost_usd: 1.0, prompt_tokens: 0,   completion_tokens: 0,  feature: 'report', created_at: '2026-07-07T02:00:00Z' },
    ]
    const s = shapeAiUsage(rows, 3, NOW)
    expect(s.totalCost).toBeCloseTo(1.75)
    expect(s.totalTokens).toBe(170)
    expect(s.totalCalls).toBe(3)
    expect(s.costPerDay.map(d => d.date)).toEqual(['2026-07-05', '2026-07-06', '2026-07-07'])
    expect(s.costPerDay[2].cost).toBeCloseTo(1.5)
    expect(s.byFeature[0].feature).toBe('report') // highest cost first
    expect(s.byFeature.find(f => f.feature === 'chat')).toMatchObject({ calls: 2, tokens: 170 })
  })

  it('treats an empty log table as a valid zero state and defaults missing feature to other', () => {
    const empty = shapeAiUsage([], 2, NOW)
    expect(empty).toMatchObject({ totalCost: 0, totalTokens: 0, totalCalls: 0, byFeature: [] })
    expect(empty.costPerDay).toHaveLength(2)
    const s = shapeAiUsage([{ cost_usd: 0.1, created_at: '2026-07-07T00:00:00Z' }], 2, NOW)
    expect(s.byFeature[0].feature).toBe('other')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fetchDataGrowth — head-count queries with per-table isolation
// ─────────────────────────────────────────────────────────────────────────────
describe('fetchDataGrowth', () => {
  it('issues head-count queries and isolates a per-table failure', async () => {
    for (const { table } of GROWTH_TABLES) {
      h.state.results[table] = { count: 7, error: null }
    }
    h.state.results.accidents = { count: null, error: new Error('relation "accidents" does not exist') }

    const { tables, totalRecords } = await fetchDataGrowth()
    expect(tables).toHaveLength(GROWTH_TABLES.length)

    const fleet = tables.find(t => t.table === 'vehicle_fleet')
    expect(fleet).toMatchObject({ count: 7, error: null })

    const accidents = tables.find(t => t.table === 'accidents')
    expect(accidents.count).toBeNull()
    expect(accidents.error).toMatch(/does not exist/)

    // 7 healthy tables x 7 rows; failed table contributes 0
    expect(totalRecords).toBe(7 * (GROWTH_TABLES.length - 1))

    // Verify the queries were true head-counts.
    const q = h.state.queries.find(b => b._table === 'vehicle_fleet')
    expect(q._calls.select).toBe('id')
    expect(q._calls.selectOpts).toEqual({ count: 'exact', head: true })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runTenantReport — per-slice isolation
// ─────────────────────────────────────────────────────────────────────────────
describe('runTenantReport', () => {
  it('returns every slice with status ok on the happy path', async () => {
    h.state.defaultResult = { data: [], error: null, count: 0 }
    const report = await runTenantReport()
    for (const key of ['users', 'activity', 'ai', 'growth', 'adoption']) {
      expect(report[key].status).toBe('ok')
      expect(report[key].error).toBeNull()
    }
    expect(report.windowDays).toBe(WINDOW_DAYS)
    expect(typeof report.generatedAt).toBe('string')
  })

  it('isolates a failing slice without breaking the others', async () => {
    h.state.defaultResult = { data: [], error: null, count: 0 }
    h.state.results.ai_token_logs = { data: null, error: new Error('permission denied') }
    const report = await runTenantReport()
    expect(report.ai.status).toBe('error')
    expect(report.ai.error).toMatch(/permission denied/)
    expect(report.users.status).toBe('ok')
    expect(report.activity.status).toBe('ok')
    expect(report.growth.status).toBe('ok')
    expect(report.adoption.status).toBe('ok')
  })
})
