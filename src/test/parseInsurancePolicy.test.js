import { describe, it, expect } from 'vitest'
import { parseInsurancePolicySchedule } from '../lib/import/parseInsurancePolicy'

/**
 * Fixture reproducing the GGCI (Gulf General) policy-schedule quirks:
 *  - split digits ("1 ,164 , 910 . 72", "186 920 953 . 11")
 *  - Arabic text interleaved on the same visual line
 *  - DD/MM/YYYY dates
 *  - a "constructed total loss ... exceeds 60%" line
 *  - numbered Condition(s) clauses
 */
const motorLines = [
  'Gulf General Insurance Company شركة الخليج العامة للتأمين',
  'Policy Schedule جدول الوثيقة',
  'Policy No. 210-AIC-2026-11949342-000',
  'Insured Name : Green concrete Co المؤمن له',
  'Policy Period From : 16/04/2026 To : 15/04/2027 مدة الوثيقة',
  'Premium (SAR) 1 ,164 , 910 . 72',
  'Sum Insured : 186 920 953 . 11 (SAR)',
  'Limit of Liability : SAR 10,000,000',
  'Cover : Auto Risk Comprehensive تغطية شاملة',
  'Deductible(s) : 1% of claim amount, min SAR 1,000',
  'Condition(s) 1. Repairs at authorized workshop only. 2. In the event of a constructed total loss if the final repair cost exceeds 60% of agreed insured value the vehicle is a total loss. 3. Immediate notification within 48 hours.',
]

const plantLines = [
  'Gulf General Insurance Company',
  'Policy Schedule',
  'Policy No. 310-PLT-2026-22001',
  'Insured Name : Green concrete Co',
  'Policy Period From : 01/01/2026 To : 31/12/2026',
  'Premium (SAR) 250,000.00',
  'Sum Insured : 50,000,000 (SAR)',
  'Cover : Contractors Plant and Machinery Equipment',
  'Deductible(s) : SAR 5,000 each and every loss',
  'Condition(s) 1. Total loss @ 65% of agreed value.',
]

const tplLines = [
  'Policy Schedule',
  'Policy No. 400-TPL-2026-9001',
  'Insured Name : Green concrete Co',
  'Policy Period From : 10/05/2026 To : 09/05/2027',
  'Premium (SAR) 12,500.00',
  'Cover : Motor Third Party Liability TPL only',
  'Condition(s) 1. Bodily injury cover as per law.',
]

describe('parseInsurancePolicySchedule', () => {
  it('extracts core fields from a GGCI motor schedule with split digits + Arabic', () => {
    const r = parseInsurancePolicySchedule(motorLines)
    expect(r).toBeTruthy()
    expect(r.policy_no).toBe('210-AIC-2026-11949342-000')
    expect(r.insured_name).toBe('Green concrete Co')
    expect(r.premium).toBe(1164910.72)
    expect(typeof r.premium).toBe('number')
    expect(r.sum_insured).toBe(186920953.11)
    expect(r.limit_of_liability).toBe(10000000)
    expect(r.currency).toBe('SAR')
  })

  it('parses DD/MM/YYYY dates to ISO', () => {
    const r = parseInsurancePolicySchedule(motorLines)
    expect(r.period_from).toBe('2026-04-16')
    expect(r.period_to).toBe('2027-04-15')
  })

  it('reads the total-loss threshold from an "exceeds 60%" line', () => {
    const r = parseInsurancePolicySchedule(motorLines)
    expect(r.total_loss_threshold_pct).toBe(60)
  })

  it('reads the total-loss threshold from a "Total loss @ 65%" line', () => {
    const r = parseInsurancePolicySchedule(plantLines)
    expect(r.total_loss_threshold_pct).toBe(65)
  })

  it('captures numbered Condition(s) clauses', () => {
    const r = parseInsurancePolicySchedule(motorLines)
    expect(r.conditions.length).toBe(3)
    expect(r.conditions[0]).toEqual({ seq: 1, clause_text: 'Repairs at authorized workshop only.' })
    expect(r.conditions[1].seq).toBe(2)
    expect(r.conditions[1].clause_text).toMatch(/constructed total loss/i)
    expect(r.conditions[2].clause_text).toMatch(/48 hours/)
  })

  it('captures the deductible line text', () => {
    const r = parseInsurancePolicySchedule(motorLines)
    expect(r.deductible_text).toMatch(/1% of claim amount/i)
    expect(r.deductible_text).not.toMatch(/Condition/i)
  })

  it('infers motor_comprehensive from Auto Risk / Comprehensive', () => {
    expect(parseInsurancePolicySchedule(motorLines).policy_type).toBe('motor_comprehensive')
  })

  it('infers plant_equipment from Plant / Machinery / Equipment', () => {
    expect(parseInsurancePolicySchedule(plantLines).policy_type).toBe('plant_equipment')
  })

  it('infers motor_tpl from Third Party / TPL', () => {
    expect(parseInsurancePolicySchedule(tplLines).policy_type).toBe('motor_tpl')
  })

  it('accepts a raw text blob as well as lines[]', () => {
    const r = parseInsurancePolicySchedule(motorLines.join('\n'))
    expect(r.policy_no).toBe('210-AIC-2026-11949342-000')
    expect(r.premium).toBe(1164910.72)
  })

  it('returns null for empty input', () => {
    expect(parseInsurancePolicySchedule('')).toBeNull()
    expect(parseInsurancePolicySchedule([])).toBeNull()
  })

  it('returns null when the text is not a policy schedule', () => {
    expect(parseInsurancePolicySchedule(['Just a random invoice', 'Total: 500'])).toBeNull()
  })

  it('does not throw on odd / malformed input', () => {
    expect(() => parseInsurancePolicySchedule([null, undefined, 123, {}])).not.toThrow()
    expect(parseInsurancePolicySchedule([null, undefined, 123])).toBeNull()
  })

  it('leaves absent money fields null', () => {
    const r = parseInsurancePolicySchedule(tplLines)
    expect(r.sum_insured).toBeNull()
    expect(r.limit_of_liability).toBeNull()
    expect(r.premium).toBe(12500)
  })
})
