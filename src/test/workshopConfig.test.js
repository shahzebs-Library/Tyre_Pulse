import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted Supabase mock (mirrors src/lib/api/pmPrograms.test.js): a chainable,
// awaitable query builder. Awaiting a builder resolves to state.tables[table].
const h = vi.hoisted(() => {
  const state = { tables: {}, calls: [] }
  const METHODS = [
    'select', 'eq', 'in', 'order', 'limit', 'or', 'range', 'neq',
    'maybeSingle', 'single', 'insert', 'update', 'delete', 'upsert',
  ]
  function makeBuilder(table) {
    const rec = { table, ops: [] }
    state.calls.push(rec)
    const builder = {}
    for (const m of METHODS) {
      builder[m] = (...args) => { rec.ops.push([m, args]); return builder }
    }
    builder.then = (resolve, reject) =>
      Promise.resolve(state.tables[table] || { data: null, error: null }).then(resolve, reject)
    return builder
  }
  return {
    state,
    supabase: { from: (t) => makeBuilder(t) },
  }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const cfgApi = await import('../lib/api/workshopConfig')

const lastCall = (table) => [...h.state.calls].reverse().find((c) => c.table === table)

beforeEach(() => {
  h.state.tables = {}
  h.state.calls = []
})

describe('loadWorkshopConfig', () => {
  it('returns the defaults when the table is empty', async () => {
    h.state.tables.workshop_config = { data: [], error: null }
    const cfg = await cfgApi.loadWorkshopConfig()
    expect(cfg).toEqual({
      thresholds: {
        unassignedMin: 30, noActivityMin: 45, overSafeOvertimeMin: 120,
        vorSlaHours: 48, blockedPendingMin: 60,
      },
      targetUtilization: 0.75,
      labourRate: 120,
      shiftDefault: { start: '08:00', end: '17:00' },
      overtimeSafeMin: 60,
    })
  })

  it('merges DB rows over defaults (partial thresholds keep the other defaults)', async () => {
    h.state.tables.workshop_config = {
      data: [
        { key: 'thresholds', value: { unassignedMin: 15, vorSlaHours: 24 } },
        { key: 'labour_rate', value: 200 },
        { key: 'target_utilization', value: 0.9 },
        { key: 'shift_default', value: { start: '7:30', end: '19:00' } },
        { key: 'overtime_safe_min', value: 90 },
      ],
      error: null,
    }
    const cfg = await cfgApi.loadWorkshopConfig()
    expect(cfg.thresholds).toEqual({
      unassignedMin: 15,        // overridden
      noActivityMin: 45,        // default kept
      overSafeOvertimeMin: 120, // default kept
      vorSlaHours: 24,          // overridden
      blockedPendingMin: 60,    // default kept
    })
    expect(cfg.labourRate).toBe(200)
    expect(cfg.targetUtilization).toBe(0.9)
    expect(cfg.shiftDefault).toEqual({ start: '07:30', end: '19:00' }) // normalised
    expect(cfg.overtimeSafeMin).toBe(90)
  })

  it('clamps out-of-range stored values on read', async () => {
    h.state.tables.workshop_config = {
      data: [
        { key: 'labour_rate', value: -50 },          // -> 0
        { key: 'target_utilization', value: 5 },      // -> 1
        { key: 'thresholds', value: { unassignedMin: 0 } }, // -> 1
      ],
      error: null,
    }
    const cfg = await cfgApi.loadWorkshopConfig()
    expect(cfg.labourRate).toBe(0)
    expect(cfg.targetUtilization).toBe(1)
    expect(cfg.thresholds.unassignedMin).toBe(1)
  })

  it('degrades to defaults on a query error (never throws)', async () => {
    h.state.tables.workshop_config = {
      data: null,
      error: { message: 'relation "workshop_config" does not exist', code: '42P01' },
    }
    const cfg = await cfgApi.loadWorkshopConfig()
    expect(cfg).toEqual(cfgApi.WORKSHOP_CONFIG_DEFAULTS)
    // frozen defaults are not mutated
    expect(cfg).not.toBe(cfgApi.WORKSHOP_CONFIG_DEFAULTS)
  })
})

describe('saveWorkshopConfig', () => {
  it('upserts one row per provided key with clamped values', async () => {
    h.state.tables.workshop_config = { data: null, error: null }
    const keys = await cfgApi.saveWorkshopConfig({
      labourRate: '99999999',                         // clamped to 100000
      targetUtilization: 1.4,                          // clamped to 1
      thresholds: { blockedPendingMin: 90, noActivityMin: -3 }, // -3 -> 1, rest default
      shiftDefault: { start: '06:00', end: '15:30' },
      overtimeSafeMin: 5000,                           // clamped to 1440
    })
    expect(keys.sort()).toEqual(
      ['labour_rate', 'overtime_safe_min', 'shift_default', 'target_utilization', 'thresholds'].sort(),
    )

    const rec = lastCall('workshop_config')
    const upsertOp = rec.ops.find((o) => o[0] === 'upsert')
    expect(upsertOp).toBeDefined()
    const [rows, opts] = upsertOp[1]
    expect(opts).toEqual({ onConflict: 'organisation_id,key' })

    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(byKey.labour_rate).toBe(100000)
    expect(byKey.target_utilization).toBe(1)
    expect(byKey.overtime_safe_min).toBe(1440)
    expect(byKey.shift_default).toEqual({ start: '06:00', end: '15:30' })
    expect(byKey.thresholds).toEqual({
      unassignedMin: 30, noActivityMin: 1, overSafeOvertimeMin: 120,
      vorSlaHours: 48, blockedPendingMin: 90,
    })
  })

  it('only writes the keys present on the patch', async () => {
    h.state.tables.workshop_config = { data: null, error: null }
    const keys = await cfgApi.saveWorkshopConfig({ labourRate: 150 })
    expect(keys).toEqual(['labour_rate'])
    const rec = lastCall('workshop_config')
    const upsertOp = rec.ops.find((o) => o[0] === 'upsert')
    expect(upsertOp[1][0]).toEqual([{ key: 'labour_rate', value: 150 }])
  })

  it('no-ops (no DB call) for an empty patch', async () => {
    const keys = await cfgApi.saveWorkshopConfig({})
    expect(keys).toEqual([])
    expect(lastCall('workshop_config')).toBeUndefined()
  })

  it('throws when the upsert returns an error', async () => {
    h.state.tables.workshop_config = { data: null, error: { message: 'denied', code: '42501' } }
    await expect(cfgApi.saveWorkshopConfig({ labourRate: 150 })).rejects.toBeTruthy()
  })
})
