import { describe, it, expect } from 'vitest'
import { agentLabel, summarizeByAgent, summarizeByOrg } from '../lib/api/aiOps'

const PRICING = { 'claude-haiku-4-5': { input: 1, output: 5 } }

describe('aiOps.agentLabel', () => {
  it('keeps the agent verbatim and labels blanks unknown', () => {
    expect(agentLabel('orchestrator:analyst')).toBe('orchestrator:analyst')
    expect(agentLabel('  ')).toBe('unknown')
    expect(agentLabel(null)).toBe('unknown')
  })
})

describe('aiOps.summarizeByAgent', () => {
  it('groups by agent, sums calls/tokens/cost and sorts by cost', () => {
    const out = summarizeByAgent([
      { agent: 'orchestrator:auto', input_tokens: 100, output_tokens: 50, total_tokens: 150, cost_usd: 0.01 },
      { agent: 'orchestrator:auto', input_tokens: 10, output_tokens: 5, cost_usd: 0.02 },
      { agent: 'chat:tyre', total_tokens: 1000, cost_usd: 0.5 },
      { agent: null, total_tokens: 1, cost_usd: 0 },
    ])
    expect(out.map((a) => a.agent)).toEqual(['chat:tyre', 'orchestrator:auto', 'unknown'])
    const orch = out.find((a) => a.agent === 'orchestrator:auto')
    expect(orch.calls).toBe(2)
    expect(orch.tokens).toBe(165) // total_tokens when present, else input + output
    expect(orch.cost).toBeCloseTo(0.03, 9)
  })
  it('returns [] for no rows', () => {
    expect(summarizeByAgent([])).toEqual([])
    expect(summarizeByAgent()).toEqual([])
  })
})

describe('aiOps.summarizeByOrg', () => {
  const names = { 'org-a': 'Company A' }
  const rows = [
    { organisation_id: 'org-a', status: 'success', model: 'claude-haiku-4-5', prompt_tokens: 1000, completion_tokens: 200, cost_usd: null, latency_ms: 1000 },
    { organisation_id: 'org-a', status: 'success', model: 'claude-haiku-4-5', prompt_tokens: 0, completion_tokens: 0, cost_usd: 0.05, latency_ms: 3000 },
    { organisation_id: 'org-a', status: 'error', cost_usd: null, latency_ms: null },          // cost unknown
    { organisation_id: 'org-a', status: 'error', cost_usd: 0.01 },                             // known partial cost
    { organisation_id: 'org-a', status: 'blocked', cost_usd: 0 },
    { organisation_id: 'org-b', status: 'success', cost_usd: 0.001 },
    { organisation_id: null, status: 'success', cost_usd: 0.2 },
  ]
  const out = summarizeByOrg(rows, PRICING, names)

  it('groups by organisation with display names and a "No organisation" bucket', () => {
    expect(out.map((o) => o.name)).toEqual(['No organisation', 'Company A', 'Unknown organisation'])
  })
  it('prices successes from pricing when cost is null, counts failures and cost-unknown failures', () => {
    const a = out.find((o) => o.organisationId === 'org-a')
    expect(a.calls).toBe(2)
    expect(a.failures).toBe(3)
    expect(a.unknownCostFailures).toBe(1)
    // 0.002 (priced) + 0.05 (stored) + 0.01 (known failed cost) + 0 (blocked)
    expect(a.cost).toBeCloseTo(0.062, 9)
    expect(a.tokens).toBe(1200)
    expect(a.avgLatencyMs).toBe(2000)
  })
  it('reports N/A latency as null, never 0', () => {
    expect(out.find((o) => o.organisationId === 'org-b').avgLatencyMs).toBeNull()
  })
  it('does not leak internal accumulator fields', () => {
    for (const o of out) {
      expect(o).not.toHaveProperty('latencySum')
      expect(o).not.toHaveProperty('latencyCount')
    }
  })
})
