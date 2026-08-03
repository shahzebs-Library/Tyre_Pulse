import { describe, it, expect } from 'vitest'
import {
  buildAnalysisPrompt, parseAnalysisResponse, groundAnalysis,
  outcomeMeta, OUTCOME_META,
} from '../lib/insuranceEmailAnalysis'

const CONDITIONS = [
  { seq: 1, category: 'claim_process', clause_text: 'Repair must be approved by the insurer before work begins.', causes_rejection: true, policy_no: 'P1' },
  { seq: 2, category: 'driver', clause_text: 'Driver must hold a valid licence.', causes_rejection: true, policy_no: 'P1' },
  { seq: 3, category: 'coverage', clause_text: 'Own-damage cover applies to insured perils within KSA.', policy_no: 'P1' },
]

describe('buildAnalysisPrompt', () => {
  it('numbers the conditions and includes the message, ASCII only', () => {
    const { system, user } = buildAnalysisPrompt({ policy: { policy_no: 'P1', insurer: 'AICC' }, conditions: CONDITIONS, emailText: 'We reject the claim.' })
    expect(user).toContain('1. [claim_process')
    expect(user).toContain('We reject the claim.')
    expect(system).toContain('STRICT JSON')
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(system + user)).toBe(false)
  })
})

describe('parseAnalysisResponse', () => {
  it('parses clean JSON', () => {
    const p = parseAnalysisResponse('{"outcome":"rejected","reason_summary":"repaired first","quoted_text":"repaired without approval","matched_condition_seqs":[1],"approval_condition_seqs":[3],"confidence":"high"}')
    expect(p.outcome).toBe('rejected')
    expect(p.matched_condition_seqs).toEqual([1])
    expect(p.approval_condition_seqs).toEqual([3])
    expect(p.confidence).toBe('high')
  })

  it('tolerates code fences and surrounding prose', () => {
    const p = parseAnalysisResponse('Here is the result:\n```json\n{"outcome":"delayed","confidence":"medium","matched_condition_seqs":[2]}\n```')
    expect(p.outcome).toBe('delayed')
    expect(p.matched_condition_seqs).toEqual([2])
  })

  it('falls back to unclear/low for unknown values and returns null on garbage', () => {
    const p = parseAnalysisResponse('{"outcome":"maybe","confidence":"certain"}')
    expect(p.outcome).toBe('unclear')
    expect(p.confidence).toBe('low')
    expect(parseAnalysisResponse('not json at all')).toBeNull()
    expect(parseAnalysisResponse('')).toBeNull()
  })
})

describe('groundAnalysis', () => {
  it('renders OUR stored clause text and drops invented condition numbers', () => {
    const parsed = parseAnalysisResponse('{"outcome":"rejected","reason_summary":"x","matched_condition_seqs":[1,99],"approval_condition_seqs":[3],"confidence":"high"}')
    const g = groundAnalysis(parsed, CONDITIONS)
    expect(g.outcome).toBe('rejected')
    expect(g.outcomeLabel).toBe('Rejected')
    expect(g.matched).toHaveLength(1) // 99 is not a real clause -> dropped
    expect(g.matched[0].clause_text).toBe(CONDITIONS[0].clause_text)
    expect(g.approval[0].seq).toBe(3)
    expect(g.approval[0].clause_text).toBe(CONDITIONS[2].clause_text)
  })

  it('returns empty clause lists when nothing maps (honest, no fabrication)', () => {
    const parsed = parseAnalysisResponse('{"outcome":"unclear","matched_condition_seqs":[42],"approval_condition_seqs":[],"confidence":"low"}')
    const g = groundAnalysis(parsed, CONDITIONS)
    expect(g.matched).toEqual([])
    expect(g.approval).toEqual([])
  })

  it('returns null for null input', () => {
    expect(groundAnalysis(null, CONDITIONS)).toBeNull()
  })
})

describe('outcomeMeta', () => {
  it('maps every known outcome and falls back to unclear', () => {
    expect(outcomeMeta('rejected').label).toBe('Rejected')
    expect(outcomeMeta('approved').tone).toBe('ok')
    expect(outcomeMeta('nope')).toBe(OUTCOME_META.unclear)
  })
})
