import { describe, it, expect } from 'vitest'
import { classifyQuery, classifyQueryMulti, AGENT_TYPES, AGENT_LABELS, AGENT_DESCRIPTIONS } from '../lib/aiRouter'

describe('aiRouter - new agents', () => {
  it('registers Safety and Procurement with labels + descriptions', () => {
    for (const t of [AGENT_TYPES.SAFETY, AGENT_TYPES.PROCUREMENT]) {
      expect(AGENT_LABELS[t]).toBeTruthy()
      expect(AGENT_DESCRIPTIONS[t]).toBeTruthy()
    }
  })

  it('routes safety/HSE questions to the Safety agent', () => {
    expect(classifyQuery('Review the fleet accident and injury risk this month')).toBe(AGENT_TYPES.SAFETY)
    expect(classifyQuery('Which sites have overdue inspection compliance?')).toBe(AGENT_TYPES.SAFETY)
  })

  it('routes procurement/brand-value questions to the Procurement agent', () => {
    expect(classifyQuery('Which tyre brand is the best value to buy next?')).toBe(AGENT_TYPES.PROCUREMENT)
    expect(classifyQuery('Rank suppliers and build a procurement order plan')).toBe(AGENT_TYPES.PROCUREMENT)
  })

  it('still routes the original domains correctly', () => {
    expect(classifyQuery('What is the fleet CPK trend and cost breakdown?')).toBe(AGENT_TYPES.ANALYST)
    expect(classifyQuery('Why did this tyre fail with shoulder wear?')).toBe(AGENT_TYPES.TYRE_ENGINEER)
    expect(classifyQuery('Find duplicate serials and bad data')).toBe(AGENT_TYPES.QA_DATA)
    expect(classifyQuery('Forecast replacements for next quarter')).toBe(AGENT_TYPES.PLANNER)
  })

  it('multi-classify picks several agents for a cross-domain question', () => {
    const agents = classifyQueryMulti('Why did accidents rise and which brand should we buy to cut cost?')
    expect(agents).toContain(AGENT_TYPES.SAFETY)
    expect(agents).toContain(AGENT_TYPES.PROCUREMENT)
  })
})
