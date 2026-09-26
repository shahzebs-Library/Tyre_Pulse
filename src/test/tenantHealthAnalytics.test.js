import { describe, it, expect } from 'vitest'
import {
  seriesTrend, tenantKpis, healthSignals, registerRows, searchRows, exportRowsFor,
  REGISTER_SECTIONS, STALE_MINUTES,
} from '../lib/tenantHealthAnalytics'

const NOW = new Date('2026-09-26T12:00:00Z')
const days = (vals) => vals.map((v, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, events: v }))

function report(over = {}) {
  return {
    generatedAt: '2026-09-26T11:30:00Z',
    users: { status: 'ok', data: {
      total: 10, approved: 8, pending: 2, locked: 1, newLast30: 3,
      byRole: { Admin: 2, Manager: 8 },
      pendingUsers: [{ id: 'u1', name: 'A', role: 'Reporter', createdAt: '2026-09-20T12:00:00Z' }, { id: 'u2', name: 'B', role: 'Reporter', createdAt: null }],
    } },
    activity: { status: 'ok', data: { totalEvents: 40, activeUsers: 4, eventsPerDay: days([5, 5, 5, 5, 5, 5, 5, 5, 0, 0]), topActions: [], topTables: [] } },
    ai: { status: 'ok', data: { totalCost: 2, totalTokens: 1000, totalCalls: 4, costPerDay: [], byFeature: [{ feature: 'chat', calls: 4, tokens: 1000, cost: 2 }] } },
    growth: { status: 'ok', data: { complete: true, totalRecords: 55, tables: [{ table: 'a', label: 'A', count: 55, error: null }, { table: 'b', label: 'B', count: null, error: 'x' }] } },
    adoption: { status: 'ok', data: [{ module: 'Workshop', events: 30, share: 75 }] },
    ...over,
  }
}

describe('seriesTrend', () => {
  it('returns nulls for an empty series', () => {
    const t = seriesTrend([])
    expect(t.change).toBeNull()
    expect(t.activeDays).toBeNull()
  })
  it('compares halves and finds the peak', () => {
    const t = seriesTrend(days([1, 1, 4, 0]))
    expect(t.firstHalf).toBe(2)
    expect(t.secondHalf).toBe(4)
    expect(t.change).toBe(100)
    expect(t.direction).toBe('up')
    expect(t.peak).toEqual({ date: '2026-09-03', value: 4 })
    expect(t.activeDays).toBe(3)
  })
  it('never divides by a zero first half', () => {
    const t = seriesTrend(days([0, 0, 3, 3]))
    expect(t.change).toBeNull()
    expect(t.direction).toBe('up')
  })
})

describe('tenantKpis', () => {
  it('computes ratios from real slices', () => {
    const k = tenantKpis(report())
    expect(k.approvalRate).toBe(0.8)
    expect(k.activationRate).toBe(0.5)
    expect(k.eventsPerActiveUser).toBe(10)
    expect(k.aiCostPerCall).toBe(0.5)
    expect(k.totalRecords).toBe(55)
    expect(k.modulesInUse).toBe(1)
  })
  it('reports null, not zero, for failed slices and empty denominators', () => {
    const k = tenantKpis(report({
      users: { status: 'error', error: 'x' },
      ai: { status: 'ok', data: { totalCost: 0, totalTokens: 0, totalCalls: 0, costPerDay: [], byFeature: [] } },
      growth: { status: 'ok', data: { complete: false, totalRecords: null, tables: [] } },
    }))
    expect(k.totalUsers).toBeNull()
    expect(k.activationRate).toBeNull()
    expect(k.aiCostPerCall).toBeNull()
    expect(k.totalRecords).toBeNull()
  })
})

describe('healthSignals', () => {
  it('flags pending, locked, a quiet week and failed slices', () => {
    const r = report({ activity: { status: 'ok', data: { totalEvents: 5, activeUsers: 1, eventsPerDay: days([5, 0, 0, 0, 0, 0, 0, 0]) } }, ai: { status: 'error', error: 'x' } })
    const keys = healthSignals(r, { now: NOW }).map((s) => s.key)
    expect(keys[0]).toBe('quiet-week')
    expect(keys).toEqual(expect.arrayContaining(['pending', 'locked', 'failed-slices', 'low-activation']))
  })
  it('flags a stale report using the injected clock', () => {
    const later = new Date(NOW.getTime() + (STALE_MINUTES + 1) * 60000)
    expect(healthSignals(report(), { now: later }).map((s) => s.key)).toContain('stale')
    expect(healthSignals(report(), { now: NOW }).map((s) => s.key)).not.toContain('stale')
  })
  it('returns nothing for a missing report', () => {
    expect(healthSignals(null)).toEqual([])
  })
})

describe('registerRows', () => {
  it('shapes every section and marks unavailable slices', () => {
    expect(registerRows(report(), 'roles').rows[0]).toMatchObject({ role: 'Manager', users: 8, share: 80 })
    const t = registerRows(report(), 'tables').rows
    expect(t[1]).toMatchObject({ count: null, state: 'Unavailable' })
    expect(registerRows(report(), 'features').rows[0].costPerCall).toBe(0.5)
    const p = registerRows(report(), 'pending', { now: NOW }).rows
    expect(p[0]).toMatchObject({ id: 'u1', waitingDays: 6 })
    expect(p[1].waitingDays).toBeNull()
    expect(registerRows(report({ adoption: { status: 'error' } }), 'modules').available).toBe(false)
    expect(registerRows(report(), 'nope')).toEqual({ available: false, rows: [] })
  })
})

describe('search and export', () => {
  it('searches case-insensitively', () => {
    const rows = registerRows(report(), 'roles').rows
    expect(searchRows(rows, 'manag')).toHaveLength(1)
    expect(searchRows(rows, '')).toHaveLength(2)
  })
  it('exports N/A for unmeasured values', () => {
    const rows = registerRows(report(), 'tables').rows
    const out = exportRowsFor('tables', rows)
    expect(out[1].count).toBe('N/A')
    expect(Object.keys(out[0])).toEqual(REGISTER_SECTIONS.tables.cols)
    expect(exportRowsFor('nope', rows)).toEqual([])
  })
})
