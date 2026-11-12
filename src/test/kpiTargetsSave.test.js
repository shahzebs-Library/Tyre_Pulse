import { describe, it, expect, vi, beforeEach } from 'vitest'

// A small in-memory kpi_targets table behind the Supabase query-builder shape,
// carrying the two rules of the LIVE table that the old upsert tripped over:
//   1. the unique rule that treats a blank month / site as a value
//      (kpi_targets_scope_uidx), so a duplicate insert is refused with 23505;
//   2. row security: an update by a role the policy does not admit changes zero
//      rows and raises NOTHING.
const h = vi.hoisted(() => {
  const db = { rows: [], canWrite: true, seq: 0, ops: [] }
  const scopeKey = (r) => [r.metric, r.year, r.month ?? 0, r.site ?? '', String(r.country ?? 'KSA').toLowerCase()].join('|')
  function from(table) {
    const q = { table, op: 'select', filters: [], payload: null, returning: false }
    const run = () => {
      db.ops.push({ op: q.op, payload: q.payload })
      const match = (r) => q.filters.every(([c, v]) => r[c] === v)
      if (q.op === 'select') return { data: db.rows.filter(match).map((r) => ({ ...r })), error: null }
      if (q.op === 'insert') {
        if (!db.canWrite) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }
        const row = { id: `k${++db.seq}`, month: null, site: null, country: 'KSA', ...q.payload }
        if (db.rows.some((r) => scopeKey(r) === scopeKey(row))) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "kpi_targets_scope_uidx"' } }
        }
        db.rows.push(row)
        return { data: q.returning ? [{ ...row }] : null, error: null }
      }
      if (q.op === 'update') {
        const hit = db.canWrite ? db.rows.filter(match) : []
        hit.forEach((r) => Object.assign(r, q.payload))
        return { data: q.returning ? hit.map((r) => ({ id: r.id })) : null, error: null }
      }
      if (q.op === 'upsert') throw new Error('the KPI target save must not upsert')
      return { data: null, error: null }
    }
    const b = {
      select() { if (q.op !== 'select') q.returning = true; return b },
      eq(c, v) { q.filters.push([c, v]); return b },
      insert(v) { q.op = 'insert'; q.payload = v; return b },
      update(v) { q.op = 'update'; q.payload = v; return b },
      upsert(v) { q.op = 'upsert'; q.payload = v; return b },
      then(onF, onR) { return Promise.resolve().then(run).then(onF, onR) },
    }
    return b
  }
  return { db, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { saveKpiTargets, sameTargetScope } = await import('../lib/api/kpiTargets')
const settings = await import('../lib/api/settings')
const { toUserMessage } = await import('../lib/safeError')

beforeEach(() => {
  h.db.rows = []
  h.db.canWrite = true
  h.db.seq = 0
  h.db.ops = []
})

const target = (metric, value, extra = {}) => ({ metric, target_value: value, year: 2026, created_by: 'u1', ...extra })

describe('KPI targets can be saved more than once (MODC-03)', () => {
  it('first save inserts, second save updates the same row in place', async () => {
    const first = await saveKpiTargets([target('cpk', 0.03), target('tyre_life_km', 60000)])
    expect(first.error).toBeNull()
    expect(first.data).toEqual({ updated: 0, inserted: 2 })
    expect(h.db.rows).toHaveLength(2)

    // This is the save that failed in production with "A record with these
    // details already exists": month and site are blank, so the old upsert
    // conflict target could not match and the insert hit the scope index.
    const second = await saveKpiTargets([target('cpk', 0.025), target('tyre_life_km', 65000)])
    expect(second.error).toBeNull()
    expect(second.data).toEqual({ updated: 2, inserted: 0 })
    expect(h.db.rows).toHaveLength(2)
    expect(h.db.rows.find((r) => r.metric === 'cpk').target_value).toBe(0.025)
  })

  it('the Settings screen saves through the same writer and can also save twice', async () => {
    const row = { metric: 'annual_budget', target_value: 5, year: 2026, month: null, site: null, region: 'Global', created_by: 'u1' }
    expect((await settings.upsertKpiTargets([row])).error).toBeNull()
    expect((await settings.upsertKpiTargets([{ ...row, target_value: 9 }])).error).toBeNull()
    expect(h.db.rows).toHaveLength(1)
    expect(h.db.rows[0].target_value).toBe(9)
  })

  it('an update keeps who created the target and never moves its metric or year', async () => {
    await saveKpiTargets([target('cpk', 0.03)])
    await saveKpiTargets([target('cpk', 0.02, { created_by: 'someone-else' })])
    expect(h.db.rows[0].created_by).toBe('u1')
    const update = h.db.ops.find((o) => o.op === 'update')
    expect(update.payload).not.toHaveProperty('created_by')
    expect(update.payload).not.toHaveProperty('metric')
  })

  it('a monthly or site target is a different scope from the yearly one', async () => {
    await saveKpiTargets([target('cpk', 0.03)])
    const res = await saveKpiTargets([target('cpk', 0.04, { month: 3 }), target('cpk', 0.05, { site: 'NHC' })])
    expect(res.data).toEqual({ updated: 0, inserted: 2 })
    expect(h.db.rows).toHaveLength(3)
    expect(sameTargetScope({ metric: 'cpk', year: 2026, month: null, site: '' }, { metric: 'cpk', year: 2026 })).toBe(true)
    expect(sameTargetScope({ metric: 'cpk', year: 2026, month: 3 }, { metric: 'cpk', year: 2026 })).toBe(false)
    expect(sameTargetScope({ metric: 'cpk', year: 2026, country: 'UAE' }, { metric: 'cpk', year: 2026, country: 'KSA' })).toBe(false)
  })

  it('a refused update is reported, not counted as saved', async () => {
    await saveKpiTargets([target('cpk', 0.03)])
    h.db.canWrite = false
    const res = await saveKpiTargets([target('cpk', 0.01)])
    expect(res.error).toBeTruthy()
    expect(res.error.refused).toBe(true)
    expect(res.data).toEqual({ updated: 0, inserted: 0 })
    expect(h.db.rows[0].target_value).toBe(0.03)
    // The message reaches the user as written (no database wording, no code).
    expect(toUserMessage(res.error, 'fallback')).toMatch(/Only a Manager or an Admin/)
  })

  it('a refused insert comes back as the permission message', async () => {
    h.db.canWrite = false
    const res = await saveKpiTargets([target('cpk', 0.03)])
    expect(toUserMessage(res.error, 'fallback')).toBe('You do not have permission to do that.')
    expect(h.db.rows).toHaveLength(0)
  })
})
