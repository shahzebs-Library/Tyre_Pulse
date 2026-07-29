import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * loadAccidentCaseBoard — the org-wide accident case board read.
 *
 * Covers the two contract-critical behaviours:
 *  1. HAPPY PATH: cases + workstreams + open tasks assemble into { ok: true },
 *     and open tasks are reshaped into the inbox with case_no enriched from the
 *     parent case.
 *  2. []-DEGRADE (ship-before-migrate): when the V417 case column is absent the
 *     accidents read fails with a missing-relation error and the whole board
 *     comes back { cases: [], ok: false } instead of throwing, and when only a
 *     workstream/task table is absent the cases still load with empty extras.
 */

// A supabase builder whose terminal steps either resolve to `result` (thenable +
// .range) so it drives BOTH the paged accidents read (ends at .range) and the
// awaited workstream/task reads (ends at .limit, awaited directly).
function makeBuilder(result) {
  const b = {
    select: () => b,
    eq: () => b,
    order: () => b,
    limit: () => b,
    not: () => b,
    or: () => b,
    range: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  }
  return b
}

const { tables, rpcs } = vi.hoisted(() => ({
  tables: { current: {} },
  rpcs: { current: {} },
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => makeBuilder(tables.current[table] ?? { data: [], error: null }),
    // Default: the RPC is not provisioned (missing function) so the fast path
    // degrades to { server:false } unless a test seeds a payload.
    rpc: (name) => Promise.resolve(
      rpcs.current[name] ?? { data: null, error: { code: '42883', message: `function ${name} does not exist` } },
    ),
  },
}))

const { loadAccidentCaseBoard, loadAccidentCaseAnalytics } =
  await import('../lib/api/accidentCaseBoard')

beforeEach(() => { tables.current = {}; rpcs.current = {} })

const CASE = {
  id: 'a1', reference_no: 'REF-1', case_no: 'ACC-2026-001', asset_no: 'MP-1042',
  site: 'S1', country: 'KSA', incident_date: '2026-05-01', created_at: '2026-05-01T08:00:00Z',
  severity: 'Major', status: 'under_review', workflow_stage: 'insurance_claim',
  case_status: 'insurance_claim', closure_status: 'open', closure_level: 'financially_open',
  reopened_flag: false, sla_due_at: null, responsible_owner_id: null, release_date: null,
}

describe('loadAccidentCaseBoard', () => {
  it('assembles cases + workstreams + inbox on the happy path', async () => {
    tables.current = {
      accidents: { data: [CASE], error: null },
      accident_case_workstreams: {
        data: [{ id: 'w1', accident_id: 'a1', workstream_key: 'insurance', status: 'in_progress', team: 'Insurance' }],
        error: null,
      },
      accident_case_tasks: {
        data: [{
          id: 't1', accident_id: 'a1', workstream_key: 'insurance', status: 'in_progress',
          due_at: '2020-01-01T00:00:00Z', team: 'Insurance', assignee_role: 'Insurance Officer',
          site: 'S1', country: 'KSA',
        }],
        error: null,
      },
    }

    const out = await loadAccidentCaseBoard({ country: 'KSA' })
    expect(out.ok).toBe(true)
    expect(out.cases).toHaveLength(1)
    expect(out.workstreams).toHaveLength(1)
    expect(out.inbox).toHaveLength(1)
    // inbox row is reshaped for CaseTeamInbox with case_no enriched + owner_role mapped
    expect(out.inbox[0]).toMatchObject({
      accident_id: 'a1',
      workstream_key: 'insurance',
      case_no: 'ACC-2026-001',
      owner_role: 'Insurance Officer',
      due_at: '2020-01-01T00:00:00Z',
    })
  })

  it('degrades to { cases: [], ok: false } when the case columns are absent (pre-V417)', async () => {
    tables.current = {
      accidents: { data: null, error: { code: '42703', message: 'column accidents.case_status does not exist' } },
    }
    const out = await loadAccidentCaseBoard({ country: 'KSA' })
    expect(out).toEqual({ cases: [], workstreams: [], inbox: [], ok: false })
  })

  it('keeps cases but empties extras when the workstream/task tables are absent', async () => {
    tables.current = {
      accidents: { data: [CASE], error: null },
      accident_case_workstreams: { data: null, error: { code: '42P01', message: 'relation "accident_case_workstreams" does not exist' } },
      accident_case_tasks: { data: null, error: { code: '42P01', message: 'relation "accident_case_tasks" does not exist' } },
    }
    const out = await loadAccidentCaseBoard()
    expect(out.ok).toBe(true)
    expect(out.cases).toHaveLength(1)
    expect(out.workstreams).toEqual([])
    expect(out.inbox).toEqual([])
  })
})

describe('loadAccidentCaseAnalytics', () => {
  it('maps the three RPC payloads into the engine shape (server:true)', async () => {
    rpcs.current = {
      get_accident_case_status_breakdown: {
        data: {
          rows: [{ token: 'insurance_review', value: 5 }, { token: 'closed', value: 3 }],
          by_stage: [], total: 9, distinct: 2, unrecorded: 1,
          top: { token: 'insurance_review', value: 5 },
        },
        error: null,
      },
      get_accident_workstream_bottleneck: {
        data: {
          rows: [{ key: 'insurance', cases: 4 }],
          measured: true, stalled_cases: 4, top: { key: 'insurance', cases: 4 },
        },
        error: null,
      },
      get_accident_case_kpis: {
        data: {
          total: 9, open: 6, closed: 3, reopened: 1,
          avg_time_to_close: 12.5, median_time_to_close: 10, longest_time_to_close: 30,
          time_to_close_measured: 2,
          sla_tracked: 5, sla_breached: 1, sla_breach_rate: 0.2,
          reopen_rate: 0.1111,
        },
        error: null,
      },
    }

    const out = await loadAccidentCaseAnalytics({ country: 'KSA' })
    expect(out.server).toBe(true)

    // basis from the KPI RPC (full dataset); 9 < MIN_AUTHORITATIVE so flagged thin
    expect(out.basis).toMatchObject({ total: 9, open: 6, closed: 3, authoritative: false })
    expect(out.basis.note).toMatch(/9 cases/)

    // status rows enriched from the engine vocabulary (label/team/stage)
    expect(out.status.rows[0]).toEqual({
      token: 'insurance_review', label: 'Insurance review',
      team: 'Insurance', stage: 'insurance_claim', value: 5,
    })
    expect(out.status.unrecorded).toBe(1)

    // bottleneck rows enriched with the workstream display name/team
    expect(out.bottleneck).toMatchObject({ measured: true, stalledCases: 4 })
    expect(out.bottleneck.rows[0]).toEqual({
      key: 'insurance', name: 'Insurance & Claim',
      team: 'Insurance Claims Officer', cases: 4,
    })

    expect(out.timeToClose).toEqual({
      avgDays: 12.5, medianDays: 10, longestDays: 30, measured: 2, closedTotal: 3,
    })
    expect(out.reopen).toEqual({ reopened: 1, total: 9, rate: 0.1111 })
    expect(out.sla).toEqual({ tracked: 5, breached: 1, rate: 0.2 })
  })

  it('passes RPC nulls through as null (honest, never coerced to 0)', async () => {
    rpcs.current = {
      get_accident_case_status_breakdown: {
        data: { rows: [], by_stage: [], total: 0, distinct: 0, unrecorded: 0, top: null },
        error: null,
      },
      get_accident_workstream_bottleneck: {
        data: { rows: [], measured: false, stalled_cases: 0, top: null },
        error: null,
      },
      get_accident_case_kpis: {
        data: {
          total: 4, open: 4, closed: 0, reopened: 0,
          avg_time_to_close: null, median_time_to_close: null, longest_time_to_close: null,
          time_to_close_measured: 0,
          sla_tracked: 0, sla_breached: 0, sla_breach_rate: null,
          reopen_rate: 0,
        },
        error: null,
      },
    }

    const out = await loadAccidentCaseAnalytics({})
    expect(out.server).toBe(true)
    expect(out.timeToClose.avgDays).toBeNull()
    expect(out.timeToClose.medianDays).toBeNull()
    expect(out.timeToClose.longestDays).toBeNull()
    expect(out.sla.rate).toBeNull()
    // a real measured 0 stays 0 (not turned into null)
    expect(out.reopen.rate).toBe(0)
  })

  it('degrades to { server:false } when the RPCs are not provisioned', async () => {
    // rpcs.current left empty -> the mock returns a 42883 missing-function error
    const out = await loadAccidentCaseAnalytics({ country: 'KSA' })
    expect(out).toEqual({ server: false })
  })

  it('degrades to { server:false } if only one RPC is missing', async () => {
    rpcs.current = {
      get_accident_case_status_breakdown: {
        data: { rows: [], by_stage: [], total: 0, distinct: 0, unrecorded: 0, top: null },
        error: null,
      },
      get_accident_case_kpis: {
        data: { total: 0, open: 0, closed: 0, reopened: 0 },
        error: null,
      },
      // get_accident_workstream_bottleneck absent -> missing-function error
    }
    const out = await loadAccidentCaseAnalytics()
    expect(out).toEqual({ server: false })
  })
})
