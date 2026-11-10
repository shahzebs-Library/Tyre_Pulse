import { describe, expect, it, vi } from 'vitest'
import {
  ALL_AGENTS, AGENT_PROFILES, WEAR_RULES, agentsForRole, resolveAgents, toolsForAgents,
  buildSystemPrompt, classifyQuery, classifyQueryMulti,
} from '../../supabase/functions/_shared/aiAgents.ts'
import { TOOL_POLICY, authorizeTool } from '../../supabase/functions/ai-orchestrator/policy.ts'
import { TOOL_DEFS, runTool, cleanCountry, cleanDate, packResult, coverageFrom, MAX_TOOL_OUTPUT } from '../../supabase/functions/ai-orchestrator/tools.ts'
import * as aiRouter from '../lib/aiRouter'
import { coverageLines, groundingNotice } from '../lib/aiCoverage'

describe('shared agent registry', () => {
  it('has seven agents, each with registered read-only tools', () => {
    expect(ALL_AGENTS).toHaveLength(7)
    for (const a of ALL_AGENTS) {
      expect(AGENT_PROFILES[a].tools.length).toBeGreaterThan(0)
      for (const t of AGENT_PROFILES[a].tools) {
        expect(TOOL_POLICY[t], `${a} -> ${t}`).toBeDefined()
        expect(TOOL_POLICY[t].risk).toBe('read')
      }
    }
  })

  it('every policy tool has a model-visible definition and vice versa', () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual(Object.keys(TOOL_POLICY).sort())
  })

  it('client router uses the same classifier as the server', () => {
    expect(aiRouter.classifyQuery).toBe(classifyQuery)
    expect(aiRouter.classifyQueryMulti).toBe(classifyQueryMulti)
  })

  it('routes engineering, QA and cross-domain questions', () => {
    expect(classifyQuery('why is shoulder wear abnormal on TM514')).toBe('tyre_engineer')
    expect(classifyQuery('find overlapping fitments and missing serials')).toBe('qa_data')
    expect(classifyQueryMulti('why did cost rise and when should I replace these tyres')).toEqual(
      expect.arrayContaining(['planner', 'analyst']),
    )
  })
})

describe('engineering guidance is correct', () => {
  const find = (s) => WEAR_RULES.find((r) => r.pattern.toLowerCase().includes(s))
  it('under-inflation points to shoulder wear, over-inflation to centre wear', () => {
    expect(find('both shoulders').indicates).toContain('Under-inflation')
    expect(find('concentrated in the centre').indicates.join()).toMatch(/Over-inflation/)
    expect(find('concentrated in the centre').indicates.join()).not.toMatch(/Under-inflation/)
    expect(find('one shoulder').indicates.join()).toMatch(/misalignment/i)
  })
  it('every rule demands evidence before a cause is confirmed', () => {
    for (const r of WEAR_RULES) expect(r.requiredEvidence.length).toBeGreaterThan(0)
    const p = buildSystemPrompt(['tyre_engineer'])
    expect(p).toMatch(/INDICATORS, not proof/)
    expect(p).toMatch(/Missing evidence/)
    expect(p).toMatch(/Missing data is NOT zero/)
  })
})

describe('role access is deny-by-default and narrows agents', () => {
  it('maps real profile roles', () => {
    expect(agentsForRole('Manager')).toHaveLength(7)
    expect(agentsForRole('Tyre Data Collector')).toEqual(['tyre_engineer', 'qa_data'])
    expect(agentsForRole('Tyre Man')).not.toContain('procurement')
    expect(agentsForRole('Welder')).toEqual([])
    expect(agentsForRole('Reporter')).toEqual([])
    expect(agentsForRole('Welder', true)).toHaveLength(7)
  })
  it('an explicit request for a forbidden agent is refused, auto falls back', () => {
    const allowed = agentsForRole('Tyre Man')
    expect(resolveAgents('procurement', 'best brand to buy', allowed)).toEqual({ agents: [], denied: ['procurement'] })
    const auto = resolveAgents('auto', 'best brand to buy', allowed)
    expect(auto.agents).toEqual([allowed[0]])
    expect(auto.denied).toContain('procurement')
  })
  it('a model asking for a tool outside the active agents is refused', () => {
    const tools = toolsForAgents(['qa_data'])
    expect(authorizeTool('get_brand_size_cpk', [], 'x', tools).allowed).toBe(false)
    expect(authorizeTool('get_tyre_exceptions', [], 'x', tools).allowed).toBe(true)
    expect(authorizeTool('delete_vehicle', [], 'x', tools).allowed).toBe(false)
  })
})

function mockDb({ rpcData = {}, rpcError = null } = {}) {
  const calls = []
  const q = { calls: [], select: vi.fn(() => q), eq: vi.fn(() => q), gte: vi.fn(() => q), order: vi.fn(() => q), limit: vi.fn(() => q),
    then: (res) => res({ data: [{ id: 1 }], count: 7, error: null }) }
  return {
    calls,
    q,
    rpc: vi.fn(async (fn, args) => { calls.push({ fn, args }); return { data: rpcData, error: rpcError } }),
    from: vi.fn(() => q),
  }
}
const NOW = () => new Date('2026-11-10T08:00:00Z')

describe('data tools', () => {
  it('sanitises country and dates', () => {
    expect(cleanCountry('ksa')).toBe('KSA')
    expect(cleanCountry('All')).toBeNull()
    expect(cleanCountry("KSA' or 1=1")).toBeNull()
    expect(cleanDate('2026-02-30')).toBeNull()
    expect(cleanDate('2026-02-28')).toBe('2026-02-28')
  })

  it('calls the authoritative RPC with scoped params and provenance', async () => {
    const db = mockDb({ rpcData: { per_vehicle: [{ a: 1 }, { a: 2 }] } })
    const r = await runTool(db, { orgId: 'o', now: NOW }, 'get_fleet_cpk', { country: 'uae', from: '2026-01-01', to: '2026-06-30' })
    expect(db.calls[0]).toEqual({ fn: 'get_fleet_cpk', args: { p_country: 'UAE', p_from: '2026-01-01', p_to: '2026-06-30', p_site: null } })
    expect(r.ok).toBe(true)
    expect(r.provenance).toMatchObject({ source: 'get_fleet_cpk', rows: 2, truncated: false, generated_at: '2026-11-10T08:00:00.000Z' })
  })

  it('refuses a reversed date window and reports a bad country', async () => {
    const db = mockDb()
    expect((await runTool(db, { orgId: 'o' }, 'get_fleet_cpk', { from: '2026-06-01', to: '2026-01-01' })).ok).toBe(false)
    const r = await runTool(db, { orgId: 'o', now: NOW }, 'get_tyre_exceptions', { country: 'Narnia' })
    expect(JSON.parse(r.output)._provenance.notes.join()).toMatch(/Unknown country/)
  })

  it('never leaks raw database errors to the model', async () => {
    const db = mockDb({ rpcError: { message: 'permission denied for function get_fleet_cpk (42501)' } })
    const r = await runTool(db, { orgId: 'o' }, 'get_fleet_cpk', {})
    expect(r.ok).toBe(false)
    expect(r.output).toBe('get_fleet_cpk unavailable: not permitted for this user')
  })

  it('treats an RPC refusal payload as unavailable, not as data', async () => {
    const r = await runTool(mockDb({ rpcData: { ok: false, reason: 'forbidden' } }), { orgId: 'o' }, 'get_cost_cpk_overview', { country: 'Egypt' })
    expect(r.ok).toBe(false)
  })

  it('caps running-life rows and defaults to due-only', async () => {
    const db = mockDb({ rpcData: { rows: [] } })
    await runTool(db, { orgId: 'o' }, 'get_tyre_running_life', { limit: 9999 })
    expect(db.calls[0].args).toMatchObject({ p_limit: 50, p_due_only: true })
  })

  it('counts on the caller client with a business-date filter', async () => {
    const db = mockDb()
    const r = await runTool(db, { orgId: 'o', now: NOW }, 'count_records', { resource: 'accidents', since: '2026-01-01' })
    expect(db.from).toHaveBeenCalledWith('accidents')
    expect(db.q.gte).toHaveBeenCalledWith('incident_date', '2026-01-01')
    expect(JSON.parse(r.output).data).toEqual({ count: 7 })
  })

  it('knowledge search without embeddings is honestly unavailable', async () => {
    const r = await runTool(mockDb(), { orgId: 'o' }, 'search_knowledge_base', { query: 'pressure SOP' })
    expect(r.ok).toBe(false)
  })

  it('flags truncation instead of silently cutting data', () => {
    const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, pad: 'x'.repeat(20) })) }
    const r = packResult('t', 's', {}, big, NOW())
    expect(r.output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT)
    expect(r.provenance.truncated).toBe(true)
  })
})

describe('coverage shown to the user', () => {
  it('describes each source and its gaps', () => {
    const cov = coverageFrom([
      { tool: 'get_fleet_cpk', ok: true, provenance: { source: 'get_fleet_cpk', generated_at: '2026-11-10T08:00:00Z', rows: 3, truncated: true, notes: [] } },
      { tool: 'search_knowledge_base', ok: false, provenance: { error: 'knowledge search is not configured' } },
    ])
    const lines = coverageLines(cov)
    expect(lines[0].text).toMatch(/Weighted fleet CPK, 3 rows, read 2026-11-10 08:00 UTC, partial result/)
    expect(lines[0].tone).toBe('warn')
    expect(lines[1].text).toMatch(/not available/)
  })
  it('warns only when the server says nothing was retrieved', () => {
    expect(groundingNotice({ grounded: false })).toMatch(/unverified/)
    expect(groundingNotice({ grounded: true })).toBeNull()
    expect(groundingNotice({})).toBeNull()
  })
})

describe('knowledge tool returns approved documents with citations only', () => {
  it('drops non-approved rows and cites the rest', async () => {
    const db = mockDb({ rpcData: [
      { id: 11, document_id: 'd1', title: 'Pressure SOP', version: 2, page_from: 3, page_to: 4, status: 'approved', content: 'Check cold pressure.' },
      { id: 12, document_id: 'd2', title: 'Old SOP', version: 1, status: 'superseded', content: 'x' },
    ] })
    const r = await runTool(db, { orgId: 'o', embedQuery: async () => [0.1], now: NOW }, 'search_knowledge_base', { query: 'pressure' })
    const body = JSON.parse(r.output)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].cite).toBe('Pressure SOP v2, p.3-4 [doc d1]')
  })
  it('says no approved document matched instead of returning an empty list silently', async () => {
    const r = await runTool(mockDb({ rpcData: [] }), { orgId: 'o', embedQuery: async () => [0.1], now: NOW }, 'search_knowledge_base', { query: 'x' })
    expect(JSON.parse(r.output)._provenance.notes.join(' ')).toMatch(/Do NOT invent/)
  })
})

describe('tyre cost audit agent', () => {
  it('routes price questions to it and runs the scan as a dry run only', async () => {
    expect(classifyQuery('how many tyres have zero cost and can we recover the price')).toBe('cost_audit')
    expect(buildSystemPrompt(['cost_audit'])).toMatch(/NEVER invent, average or estimate a price/)
    const db = mockDb({ rpcData: { ok: true, checked: 10 } })
    await runTool(db, { orgId: 'o', now: NOW }, 'get_tyre_cost_audit', { country: 'KSA' })
    expect(db.calls[0]).toEqual({ fn: 'tyre_cost_audit_scan', args: { p_country: 'KSA', p_from: '2025-01-01', p_to: '2026-11-10', p_dry_run: true } })
  })
  it('field roles cannot use it', () => {
    expect(agentsForRole('Tyre Man')).not.toContain('cost_audit')
  })
})
