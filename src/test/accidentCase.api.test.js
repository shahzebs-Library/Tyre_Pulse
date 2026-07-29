import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted supabase mock: per-table results, records the last builder per table.
const h = vi.hoisted(() => {
  const state = { results: {}, default: { data: [], error: null }, byTable: {} }
  function from(table) {
    const calls = {
      table, eq: [], select: null, order: null, limit: null, not: null, or: null,
      upsert: null, insert: null, update: null,
    }
    const result = () => (table in state.results ? state.results[table] : state.default)
    const b = {
      _table: table, _calls: calls,
      select(c) { calls.select = c; return b },
      order(c, o) { calls.order = [c, o]; return b },
      limit(n) { calls.limit = n; return b },
      not(c, op, v) { calls.not = [c, op, v]; return b },
      or(s) { calls.or = s; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      upsert(v, o) { calls.upsert = [v, o]; return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      maybeSingle() { return Promise.resolve(result()) },
      single() { return Promise.resolve(result()) },
      then(f, r) { return Promise.resolve(result()).then(f, r) },
    }
    state.byTable[table] = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const api = await import('../lib/api/accidentCase')
const engine = await import('../lib/accidentCase')

const MISSING = { data: null, error: { message: 'relation "x" does not exist', code: '42P01' } }

beforeEach(() => {
  h.state.results = {}
  h.state.default = { data: [], error: null }
  h.state.byTable = {}
})

describe('accidentCase service - loadCase', () => {
  it('assembles the accident row with its workstreams and reports casesModel:true', async () => {
    h.state.results = {
      accidents: { data: { id: 'a1', severity: 'minor', route_key: 'standard' }, error: null },
      accident_case_workstreams: {
        data: [
          { id: 'w1', accident_id: 'a1', workstream_key: 'incident_evidence', status: 'completed', not_applicable: false },
          { id: 'w2', accident_id: 'a1', workstream_key: 'repair', status: 'in_progress', not_applicable: false },
        ],
        error: null,
      },
      accident_case_tasks: { data: [], error: null },
      accident_case_approvals: { data: [], error: null },
      accident_closure_reviews: { data: [], error: null },
    }

    const c = await api.loadCase('a1')
    expect(c).toBeTruthy()
    expect(c.id).toBe('a1')
    expect(c.workstreams).toHaveLength(2)
    expect(c.workstreams.map((w) => w.workstream_key)).toEqual(['incident_evidence', 'repair'])
    expect(c.tasks).toEqual([])
    expect(c.pending_approvals).toEqual([])
    expect(c.capabilities).toEqual({ casesModel: true })
  })

  it('returns null when the incident does not exist', async () => {
    h.state.results = { accidents: { data: null, error: null } }
    await expect(api.loadCase('nope')).resolves.toBeNull()
  })

  it('hydrates an NA workstream into an envelope the engine can read', async () => {
    h.state.results = {
      accidents: { data: { id: 'a1' }, error: null },
      accident_case_workstreams: {
        data: [{
          id: 'w1', accident_id: 'a1', workstream_key: 'insurance', status: 'not_required',
          not_applicable: true, na_reason: 'no insurance', na_by: 'u1', na_at: '2026-07-28T00:00:00Z',
        }],
        error: null,
      },
    }
    const c = await api.loadCase('a1')
    expect(c.workstreams[0].na).toEqual({ reason: 'no insurance', by: 'u1', at: '2026-07-28T00:00:00Z' })
  })
})

describe('accidentCase service - ship-before-migrate degradation', () => {
  it('degrades to empty workstreams + casesModel:false when the V417 table is missing (never throws)', async () => {
    h.state.results = {
      accidents: { data: { id: 'a1', severity: 'minor' }, error: null },
      accident_case_workstreams: MISSING,
      accident_case_tasks: MISSING,
      accident_case_approvals: MISSING,
      accident_closure_reviews: MISSING,
    }

    const c = await api.loadCase('a1')
    expect(c.id).toBe('a1')
    expect(c.workstreams).toEqual([])
    expect(c.tasks).toEqual([])
    expect(c.capabilities.casesModel).toBe(false)
  })

  it('listWorkstreams degrades to [] when the table is not provisioned', async () => {
    h.state.results = { accident_case_workstreams: MISSING }
    await expect(api.listWorkstreams('a1')).resolves.toEqual([])
  })

  it('listRoutableProfiles degrades to [] when the config table is not provisioned', async () => {
    h.state.results = { accident_route_profiles: MISSING }
    await expect(api.listRoutableProfiles()).resolves.toEqual([])
  })

  it('surfaces a real (non-missing-relation) error rather than swallowing it', async () => {
    h.state.results = {
      accident_case_workstreams: { data: null, error: { message: 'permission denied', code: '42501' } },
    }
    await expect(api.listWorkstreams('a1')).rejects.toBeTruthy()
  })
})

describe('accidentCase service - setWorkstreamStatus validation', () => {
  it('rejects an unknown workstream key', async () => {
    await expect(api.setWorkstreamStatus('a1', 'not_a_key', { status: 'completed' }))
      .rejects.toThrow(/unknown workstream/i)
  })

  it('rejects an invalid status token', async () => {
    await expect(api.setWorkstreamStatus('a1', 'repair', { status: 'bogus' }))
      .rejects.toThrow(/invalid workstream status/i)
  })

  it('upserts a valid key + status on the (accident_id, workstream_key) conflict target', async () => {
    h.state.results = {
      accident_case_workstreams: {
        data: { id: 'w9', accident_id: 'a1', workstream_key: 'repair', status: 'in_progress' },
        error: null,
      },
    }
    const row = await api.setWorkstreamStatus('a1', 'repair', { status: 'in_progress' })
    const b = h.state.byTable.accident_case_workstreams
    expect(b._calls.upsert[0]).toMatchObject({ accident_id: 'a1', workstream_key: 'repair', status: 'in_progress' })
    expect(b._calls.upsert[1]).toEqual({ onConflict: 'accident_id,workstream_key' })
    expect(row.id).toBe('w9')
  })

  it('markWorkstreamNA requires a reason', async () => {
    await expect(api.markWorkstreamNA('a1', 'insurance', {})).rejects.toThrow(/reason is required/i)
  })
})

describe('accidentCase service - engine delegation', () => {
  const caseObj = {
    id: 'a1', route_key: 'standard', severity: 'minor', repair_type: 'internal',
    workstreams: [
      { workstream_key: 'incident_evidence', status: 'completed' },
      { workstream_key: 'fleet_validation', status: 'completed' },
      { workstream_key: 'liability', status: 'in_progress' },
      { workstream_key: 'assessment', status: 'completed' },
      { workstream_key: 'repair', status: 'in_progress' },
      { workstream_key: 'handover', status: 'not_started' },
      { workstream_key: 'finance', status: 'not_started' },
    ],
    tasks: [],
    approvals: [],
  }

  it('caseCompletion delegates to the pure engine completeness()', () => {
    const expected = engine.completeness(caseObj, caseObj.workstreams, caseObj.route_key)
    expect(api.caseCompletion(caseObj)).toEqual(expected)
    // and it is genuinely route-based, not a flat field count
    expect(expected).toHaveProperty('overall')
  })

  it('canClose delegates to the pure engine canFullyClose()', () => {
    const now = new Date('2026-07-28T00:00:00Z').getTime()
    const expected = engine.canFullyClose(caseObj, caseObj.workstreams, caseObj.route_key, { now })
    expect(api.canClose(caseObj, { now })).toEqual(expected)
    // an incomplete case cannot fully close
    expect(expected.ok).toBe(false)
    expect(expected.blockers.length).toBeGreaterThan(0)
  })

  it('caseCompletion tolerates a null/empty case object', () => {
    expect(() => api.caseCompletion(null)).not.toThrow()
  })
})
