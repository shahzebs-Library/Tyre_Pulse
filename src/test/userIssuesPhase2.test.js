import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = { eq: [], rpc: [] }
let tableResult = { data: [], error: null }
let rpcResult = { data: null, error: null }

vi.mock('../lib/api/_client', () => {
  const builder = {
    select() { return builder },
    eq(col, val) { calls.eq.push([col, val]); return builder },
    order() { return builder },
    limit() { return Promise.resolve(tableResult) },
  }
  return {
    supabase: {
      from: () => builder,
      rpc: (name, args) => { calls.rpc.push([name, args]); return Promise.resolve(rpcResult) },
    },
  }
})

import {
  describeIssueEvent, myIssueCounts, shapeIssueSummary, formatHours, SAFE_SERVER_MESSAGES,
} from '../lib/problemReport'
import { listMyIssues, getUserIssueSummary } from '../lib/api/userIssues'
import { isChecklistPathAllowed } from '../lib/checklistAccess'

beforeEach(() => {
  calls.eq = []
  calls.rpc = []
  tableResult = { data: [], error: null }
  rpcResult = { data: null, error: null }
})

describe('describeIssueEvent', () => {
  it('writes plain English and never shows ids', () => {
    expect(describeIssueEvent({ event_type: 'created' })).toBe('Report sent')
    expect(describeIssueEvent({ event_type: 'status', from_value: 'new', to_value: 'in_progress' }))
      .toBe('Status changed from New to In progress')
    const assign = describeIssueEvent({ event_type: 'assign', to_value: '5d9edcb1-4924-48b6-ad19-481438440839' })
    expect(assign).toBe('An owner was assigned')
    expect(assign).not.toMatch(/5d9edcb1/)
    expect(describeIssueEvent({ event_type: 'sla_breach' })).toMatch(/Past its target time/)
    expect(describeIssueEvent({ event_type: 'fixed_version', to_value: '2.1.1' })).toBe('Fix planned for version 2.1.1')
    expect(describeIssueEvent(null)).toBe('N/A')
  })

  it('does not leak an internal note body to the reporter', () => {
    expect(describeIssueEvent({ event_type: 'comment', note: 'internal: check tenant X' }))
      .toBe('Note added by the support team')
  })
})

describe('myIssueCounts', () => {
  it('counts open, fixed and open-past-target', () => {
    const now = Date.parse('2026-09-30T12:00:00Z')
    const rows = [
      { status: 'new', sla_due_at: '2026-09-30T08:00:00Z' },
      { status: 'in_progress', sla_due_at: '2026-10-02T08:00:00Z' },
      { status: 'fixed', sla_due_at: '2026-09-29T08:00:00Z', resolved_at: '2026-09-29T07:00:00Z' },
      { status: 'closed' },
    ]
    expect(myIssueCounts(rows, now)).toEqual({ total: 4, open: 2, fixed: 1, late: 1 })
    expect(myIssueCounts(null)).toEqual({ total: 0, open: 0, fixed: 0, late: 0 })
  })
})

describe('shapeIssueSummary', () => {
  it('keeps medians null when nothing was measured (never 0)', () => {
    const s = shapeIssueSummary({ total: 2, median_first_response_hours: 0, first_response_measured: 0, median_fix_hours: null, fix_measured: 0 })
    expect(s.medianFirstResponseHours).toBeNull()
    expect(s.medianFixHours).toBeNull()
    expect(s.total).toBe(2)
  })

  it('reads measured medians and count maps, tolerating junk', () => {
    const s = shapeIssueSummary({
      total: '5', open: 3, by_status: { new: 2, fixed: '1' }, by_severity: { high: 'x' },
      by_platform: [], median_first_response_hours: '1.5', first_response_measured: 4,
      median_fix_hours: 30, fix_measured: 1, breaches_7d: 2, breach_alerts_7d: 1, open_past_target: -3,
    })
    expect(s.total).toBe(5)
    expect(s.byStatus).toEqual({ new: 2, fixed: 1 })
    expect(s.bySeverity).toEqual({ high: 0 })
    expect(s.byPlatform).toEqual({})
    expect(s.medianFirstResponseHours).toBe(1.5)
    expect(s.medianFixHours).toBe(30)
    expect(s.breaches7d).toBe(2)
    expect(s.openPastTarget).toBe(0)
    expect(shapeIssueSummary(null).total).toBe(0)
  })
})

describe('formatHours', () => {
  it('formats or says N/A', () => {
    expect(formatHours(null)).toBe('N/A')
    expect(formatHours(0.25)).toBe('15 min')
    expect(formatHours(3.25)).toBe('3.3 h')
    expect(formatHours(72)).toBe('3 days')
  })
})

describe('service', () => {
  it('listMyIssues filters on the caller as reporter', async () => {
    tableResult = { data: [{ id: 'a' }], error: null }
    const rows = await listMyIssues('u-1')
    expect(rows).toEqual([{ id: 'a' }])
    expect(calls.eq).toContainEqual(['reporter_id', 'u-1'])
  })

  it('listMyIssues returns [] without a user and throws a safe message on error', async () => {
    expect(await listMyIssues(null)).toEqual([])
    tableResult = { data: null, error: { code: '42P01', message: 'relation "user_issues" does not exist' } }
    await expect(listMyIssues('u-1')).rejects.toThrow(/could not|not/i)
    await expect(listMyIssues('u-1')).rejects.not.toThrow(/relation/)
  })

  it('getUserIssueSummary calls the RPC and shapes the result', async () => {
    rpcResult = { data: { total: 1, fix_measured: 0, median_fix_hours: 0 }, error: null }
    const s = await getUserIssueSummary()
    expect(calls.rpc[0][0]).toBe('get_user_issue_summary')
    expect(s.total).toBe(1)
    expect(s.medianFixHours).toBeNull()
  })

  it('surfaces the server refusal for a non super admin as written', async () => {
    expect(SAFE_SERVER_MESSAGES.has('Only a super admin can read the problem summary')).toBe(true)
    rpcResult = { data: null, error: { code: '42501', message: 'Only a super admin can read the problem summary' } }
    await expect(getUserIssueSummary()).rejects.toThrow('Only a super admin can read the problem summary')
  })
})

describe('routing', () => {
  it('checklist-only roles can reach their own reports', () => {
    expect(isChecklistPathAllowed('/my-problems')).toBe(true)
  })
})
