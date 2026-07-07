import { describe, it, expect, vi } from 'vitest'
import { classifyQueryMulti, classifyQuery, AGENT_TYPES } from '../lib/aiRouter'
import { buildSynthesisPrompt, runOrchestration } from '../lib/agents/orchestrator'

describe('classifyQueryMulti', () => {
  it('returns a single agent for a focused question', () => {
    expect(classifyQueryMulti('show me the cost trend this month')).toEqual([AGENT_TYPES.ANALYST])
    expect(classifyQueryMulti('why did this tyre fail')).toEqual([AGENT_TYPES.TYRE_ENGINEER])
  })
  it('returns multiple agents for a cross-domain question, primary first', () => {
    const agents = classifyQueryMulti('why did cost rise and when should we replace these tyres')
    expect(agents.length).toBeGreaterThan(1)
    expect(agents[0]).toBe(AGENT_TYPES.PLANNER) // most specific match wins as primary
    expect(agents).toContain(AGENT_TYPES.ANALYST)
  })
  it('falls back to Analyst for an unmatched or empty query', () => {
    expect(classifyQueryMulti('')).toEqual([AGENT_TYPES.ANALYST])
    expect(classifyQueryMulti('hello there')).toEqual([AGENT_TYPES.ANALYST])
  })
  it('primary agrees with the single-agent classifier', () => {
    const q = 'duplicate serial numbers and when to reorder stock'
    expect(classifyQueryMulti(q)[0]).toBe(classifyQuery(q))
  })
})

describe('buildSynthesisPrompt', () => {
  it('includes the question and every contributing agent block', () => {
    const p = buildSynthesisPrompt('why costs up?', [
      { agentType: AGENT_TYPES.ANALYST, response: 'Costs rose 12%.' },
      { agentType: AGENT_TYPES.PLANNER, response: 'Replace 8 tyres next month.' },
    ])
    expect(p).toContain('why costs up?')
    expect(p).toContain('Analyst agent')
    expect(p).toContain('Costs rose 12%.')
    expect(p).toContain('Planner agent')
    expect(p).toContain('Replace 8 tyres next month.')
  })
  it('skips empty contributions', () => {
    const p = buildSynthesisPrompt('q', [{ agentType: AGENT_TYPES.ANALYST, response: '' }, null])
    expect(p).not.toContain('Analyst agent')
  })
})

describe('runOrchestration', () => {
  const runners = {
    [AGENT_TYPES.ANALYST]:  vi.fn(async () => ({ response: 'ANALYST', kpis: [1, 2] })),
    [AGENT_TYPES.PLANNER]:  vi.fn(async () => ({ response: 'PLANNER', planningData: { x: 1 } })),
    [AGENT_TYPES.QA_DATA]:  vi.fn(async () => ({ response: 'QA' })),
    [AGENT_TYPES.TYRE_ENGINEER]: vi.fn(async () => ({ response: 'ENGINEER' })),
  }

  it('single agent: returns its result, no synthesis call', async () => {
    const aiCaller = vi.fn()
    const r = await runOrchestration('show cost trend', {}, { runners, aiCaller })
    expect(r.agentType).toBe(AGENT_TYPES.ANALYST)
    expect(r.response).toBe('ANALYST')
    expect(r.kpis).toEqual([1, 2])
    expect(r.synthesized).toBe(false)
    expect(aiCaller).not.toHaveBeenCalled()
  })

  it('multi agent: fuses answers and preserves the primary agent panels', async () => {
    const aiCaller = vi.fn(async () => 'FUSED ANSWER')
    const r = await runOrchestration('why did cost rise and when should we replace tyres', {}, { runners, aiCaller })
    expect(r.agents.length).toBeGreaterThan(1)
    expect(r.agentType).toBe(AGENT_TYPES.PLANNER)
    expect(r.synthesized).toBe(true)
    expect(r.response).toBe('FUSED ANSWER')
    expect(r.planningData).toEqual({ x: 1 })       // primary (planner) panel preserved
    expect(r.contributions.length).toBe(r.agents.length)
    expect(aiCaller).toHaveBeenCalledOnce()
  })

  it('multi agent: falls back to the primary answer when synthesis is unavailable', async () => {
    const aiCaller = vi.fn(async () => 'AI unavailable: ANTHROPIC_API_KEY is not set')
    const r = await runOrchestration('why did cost rise and when should we replace tyres', {}, { runners, aiCaller })
    expect(r.synthesized).toBe(false)
    expect(r.response).toBe('PLANNER') // primary agent answer
  })

  it('one agent failing does not sink the run', async () => {
    const boom = {
      ...runners,
      [AGENT_TYPES.PLANNER]: vi.fn(async () => { throw new Error('planner down') }),
    }
    const aiCaller = vi.fn(async () => 'FUSED')
    const r = await runOrchestration('why did cost rise and when should we replace tyres', {}, { runners: boom, aiCaller })
    // Still returns a result; the failed agent contributes a graceful message.
    expect(r.contributions.some(c => /could not complete/i.test(c.response))).toBe(true)
    expect(r.response).toBe('FUSED')
  })
})
