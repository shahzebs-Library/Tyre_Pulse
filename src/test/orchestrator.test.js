import { describe, it, expect, vi } from 'vitest'
import { classifyQueryMulti, classifyQuery, AGENT_TYPES } from '../lib/aiRouter'

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
