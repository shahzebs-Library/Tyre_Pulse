import { describe, it, expect } from 'vitest'
import en from '../locales/en/workforce.json'
import ar from '../locales/ar/workforce.json'
import { ServiceError } from '../lib/api/_client'
import { NOT_INSTALLED } from '../lib/api/workforceAssignments'
import { workforceErrorText, dayWarningText, qualificationReason, ERROR_KEYS, QUALIFICATION_CODES } from '../lib/workforceErrorText'

const translator = dict => (key, vars) => {
  const val = key.split('.').slice(1).reduce((o, p) => (o == null ? undefined : o[p]), dict)
  if (typeof val !== 'string') return key
  return vars ? val.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : val
}
const tAr = translator(ar)
const tEn = translator(en)

describe('workforceErrorText', () => {
  it('every mapped service message has an English and Arabic text', () => {
    for (const k of new Set(Object.values(ERROR_KEYS))) {
      expect(typeof en.errors[k], k).toBe('string')
      expect(typeof ar.errors[k], k).toBe('string')
    }
    for (const c of Object.keys(QUALIFICATION_CODES)) expect(typeof ar.qualification[c], c).toBe('string')
  })

  it('translates a refusal by its code', () => {
    const e = new ServiceError('Attach evidence before submitting.', 'evidence_required')
    expect(workforceErrorText(e, tAr)).toBe(ar.refusal.evidence_required)
  })

  it('translates known service messages, including not-installed', () => {
    expect(workforceErrorText(new ServiceError(NOT_INSTALLED), tAr)).toBe(ar.errors.notInstalled)
    expect(workforceErrorText(new ServiceError('Designation is required'), tAr)).toBe(ar.errors.designationRequired)
  })

  it('translates qualification refusals including each listed reason', () => {
    const e = new ServiceError('Not qualified for this safety-critical work: required skill level not recorded, no valid certificate')
    const out = workforceErrorText(e, tAr)
    expect(out).toContain(ar.qualification.skill_missing)
    expect(out).toContain(ar.qualification.certification_invalid)
    expect(out).not.toMatch(/[{}]/)
  })

  it('falls back to the safe message for anything unknown, never a key path', () => {
    const out = workforceErrorText(new ServiceError('Something unusual'), tAr, 'fallback')
    expect(out).not.toMatch(/^workforce\./)
  })

  it('English output reads naturally', () => {
    expect(workforceErrorText(new ServiceError('Task type is required'), tEn)).toBe('Task type is required.')
  })
})

describe('dayWarningText and qualificationReason', () => {
  it('fills minutes into warnings', () => {
    expect(dayWarningText({ type: 'not_recorded', minutes: 42, message: 'x' }, tEn)).toBe('42 min of the shift has no recorded activity (unknown, not idle).')
    expect(dayWarningText({ type: 'overlap', minutes: 5, message: 'x' }, tAr)).toContain('5')
  })
  it('keeps an unknown warning type as its own message', () => {
    expect(dayWarningText({ type: 'brand_new', message: 'Raw' }, tAr)).toBe('Raw')
  })
  it('accepts a reason code or its English text', () => {
    expect(qualificationReason('site_not_assigned', tAr)).toBe(ar.qualification.site_not_assigned)
    expect(qualificationReason('not assigned to this site', tAr)).toBe(ar.qualification.site_not_assigned)
    expect(qualificationReason('site_not_assigned')).toBe('not assigned to this site')
  })
})
