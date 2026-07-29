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

const { tables } = vi.hoisted(() => ({ tables: { current: {} } }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => makeBuilder(tables.current[table] ?? { data: [], error: null }),
  },
}))

const { loadAccidentCaseBoard } = await import('../lib/api/accidentCaseBoard')

beforeEach(() => { tables.current = {} })

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
