import { describe, it, expect } from 'vitest'
import { assessClaim } from '../lib/insuranceKnowledge'
import {
  buildCorrespondence, documentToText, documentMailto,
  CORRESPONDENCE_TYPES, documentKindLabel,
} from '../lib/insuranceCorrespondence'

const POLICY = {
  policy_no: '210-AIC-2026-11949342-000',
  insurer: 'AICC',
  insured_name: 'Green Concrete Company',
  currency: 'SAR',
  sum_insured: 10000000,
  total_loss_threshold_pct: 60,
}
const CONDITIONS = [
  { seq: 1, category: 'claim_process', clause_text: 'Repair must be approved before work begins.', causes_rejection: true, policy_no: POLICY.policy_no },
  { seq: 3, category: 'deductible', clause_text: 'Deductible on convicted share pending NAJM.', causes_delay: true, policy_no: POLICY.policy_no },
]
const CASE = { reference: 'CLM-2026-001', assetNo: 'TM634', plateNo: 'ABC-123', senderName: 'Ali' }

describe('buildCorrespondence', () => {
  it('produces one document per catalog type', () => {
    const { documents } = buildCorrespondence({ policy: POLICY, findings: [], ctx: {}, caseInfo: CASE })
    expect(documents).toHaveLength(CORRESPONDENCE_TYPES.length)
    expect(documents.map((d) => d.key).sort()).toEqual(CORRESPONDENCE_TYPES.map((t) => t.key).sort())
  })

  it('suggests claim submission and checklist by default and approval when not yet repaired', () => {
    const { recommendedKeys } = buildCorrespondence({ policy: POLICY, findings: [], ctx: { repairedBeforeApproval: false }, caseInfo: CASE })
    expect(recommendedKeys).toEqual(expect.arrayContaining(['claim_submission', 'document_checklist', 'approval_request']))
  })

  it('suggests a rejection notice when a reject finding exists and cites the clause', () => {
    const findings = assessClaim(CONDITIONS, { repairedBeforeApproval: true })
    const { documents, recommendedKeys } = buildCorrespondence({ policy: POLICY, findings, ctx: { repairedBeforeApproval: true }, caseInfo: CASE })
    expect(recommendedKeys).toContain('rejection_notice')
    const rej = documents.find((d) => d.key === 'rejection_notice')
    const text = documentToText(rej)
    expect(text).toContain(POLICY.policy_no)
    expect(text).toContain('clause 1')
  })

  it('suggests delay notice + follow-up when a delay finding exists', () => {
    const findings = assessClaim(CONDITIONS, { thirdPartyFaultPct: 50 })
    const { recommendedKeys } = buildCorrespondence({ policy: POLICY, findings, ctx: { thirdPartyFaultPct: 50 }, caseInfo: CASE })
    expect(recommendedKeys).toEqual(expect.arrayContaining(['delay_notice', 'followup']))
  })

  it('adds theft-specific items to the document checklist', () => {
    const { documents } = buildCorrespondence({ policy: POLICY, findings: [], ctx: { stolen: true }, caseInfo: CASE })
    const list = documents.find((d) => d.key === 'document_checklist')
    const text = documentToText(list)
    expect(text.toLowerCase()).toContain('keys')
    expect(text.toLowerCase()).toContain('theft')
  })

  it('recommends total-loss advice when repair exceeds the threshold', () => {
    const { recommendedKeys, documents } = buildCorrespondence({
      policy: POLICY, findings: [], ctx: {}, caseInfo: CASE,
      repairCost: 7000000, insuredValue: 10000000,
    })
    expect(recommendedKeys).toContain('total_loss_advice')
    const tl = documents.find((d) => d.key === 'total_loss_advice')
    expect(documentToText(tl)).toContain('SAR')
  })

  it('renders currency amounts in the policy currency, never blended', () => {
    const { documents } = buildCorrespondence({ policy: { ...POLICY, currency: 'AED' }, findings: [], ctx: {}, caseInfo: CASE, repairCost: 5000 })
    const sub = documents.find((d) => d.key === 'claim_submission')
    expect(documentToText(sub)).toContain('AED 5,000')
  })

  it('is ASCII only (no em/en dashes or arrows)', () => {
    const { documents } = buildCorrespondence({ policy: POLICY, findings: assessClaim(CONDITIONS, { repairedBeforeApproval: true }), ctx: { repairedBeforeApproval: true }, caseInfo: CASE })
    for (const d of documents) {
      // eslint-disable-next-line no-control-regex
      expect(/[^\x00-\x7F]/.test(documentToText(d))).toBe(false)
    }
  })

  it('missing case fields render a neutral placeholder, never fabricated data', () => {
    const { documents } = buildCorrespondence({ policy: POLICY, findings: [], ctx: {}, caseInfo: {} })
    const sub = documents.find((d) => d.key === 'claim_submission')
    expect(documentToText(sub)).toContain('[to be completed]')
  })
})

describe('documentMailto', () => {
  it('builds a mailto for email documents and empty for others', () => {
    const { documents } = buildCorrespondence({ policy: POLICY, findings: [], ctx: {}, caseInfo: CASE })
    const email = documents.find((d) => d.kind === 'email')
    const letter = documents.find((d) => d.kind === 'letter')
    expect(documentMailto(email).startsWith('mailto:')).toBe(true)
    expect(documentMailto(email)).toContain('subject=')
    expect(documentMailto(letter)).toBe('')
  })
})

describe('documentKindLabel', () => {
  it('labels each kind', () => {
    expect(documentKindLabel('email')).toBe('Email')
    expect(documentKindLabel('letter')).toBe('Letter')
    expect(documentKindLabel('checklist')).toBe('Checklist')
    expect(documentKindLabel('x')).toBe('Document')
  })
})
