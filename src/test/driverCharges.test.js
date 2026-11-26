import { describe, expect, it } from 'vitest'
import { buildInstalmentPlan, capAmountFor, validateIssue, validateResponse, outstandingByCurrency, enumLabel, CATEGORIES, ACTION_LABELS, CHARGE_SPEC,
  chargeCountryRule, chargeCountryKey, chargeBucket, chargeNeedsPhoto, scheduleCapFor, ksaMonthlyLimits, workingDeadline, statementText, defaultStatementLanguage, scheduleBlockFor } from '../lib/driverCharges'
import { buildChargeDocument, getPath, formatValue, noticeLanguage, hasArabicScript } from '../lib/driverChargePdf'

const detail = {
  access: 'manager', actions: ['charge_notify'],
  charge: { id: 'c1', charge_no: 'DC-2026-00001', version: 4, category: 'missing_item', source_type: 'none', source_summary: {}, amount: 250, currency: 'SAR', status: 'notified', basis: 'Fire extinguisher missing at handover.', created_at: '2026-01-05T10:00:00Z', deducted_amount: 0, issued_by_name: 'Supervisor', site: 'JEDDAH', country: 'KSA' },
  driver: { driver_name: 'Driver A', driver_id: 'EMP1' },
  evidence: [{ kind: 'document', label: 'Handover checklist', ref: 'checklist/1', created_at: '2026-01-05T10:00:00Z' }],
  signatures: [{ kind: 'driver_acceptance', signer_name: 'Driver A', statement_text: 'I accept', statement_version: 'deduction-consent-v2', statement_language: 'ar', signed_at: '2026-01-06T10:00:00Z', charge_version: 2, signature: 'data:image/png;base64,AAA' }],
  decisions: [], appeal: null,
  instalments: [{ seq: 1, due_month: '2026-02-01', amount: 200, currency: 'SAR', status: 'scheduled' }],
  events: [{ created_at: '2026-01-05T10:00:00Z', actor_name: 'Supervisor', action: 'charge_issue', details: { reason: 'Issued' } }],
}

describe('driver charge helpers', () => {
  it('caps every instalment and keeps the exact total in cents', () => {
    expect(capAmountFor(1000, 20)).toBe(200)
    const plan = buildInstalmentPlan(250.5, 200, '2026-11-01')
    expect(plan).toEqual([{ due_month: '2026-11-01', amount: 200 }, { due_month: '2026-12-01', amount: 50.5 }])
    expect(buildInstalmentPlan(250, 0, '2026-11-01')).toEqual([])
    expect(buildInstalmentPlan(250, 200, '2026-11')).toEqual([])
    expect(buildInstalmentPlan(10000, 100, '2026-11-01')).toEqual([])
  })
  it('requires basis, evidence or source, and a traffic fine link', () => {
    const ok = { category: 'missing_item', source_type: 'none', basis: 'Written basis here', amount: 10, currency: 'sar', evidence: [{ kind: 'document', ref: 'r', label: 'l' }] }
    expect(validateIssue(ok)).toBeNull()
    expect(validateIssue({ ...ok, evidence: [] })).toMatch(/evidence/)
    expect(validateIssue({ ...ok, category: 'traffic_fine' })).toMatch(/traffic fine/)
    expect(validateIssue({ ...ok, basis: 'short' })).toMatch(/basis/)
  })
  it('needs signature and explanation for a dispute', () => {
    expect(validateResponse({ response: 'dispute', explanation: 'no', acknowledged: true, signature: 'x' })).toMatch(/dispute/)
    expect(validateResponse({ response: 'accept', acknowledged: true })).toMatch(/Sign/)
    expect(validateResponse({ response: 'accept', acknowledged: true, signature: 'x' })).toBeNull()
  })
  it('never adds different currencies together', () => {
    expect(outstandingByCurrency([{ currency: 'SAR', amount: 100, deducted_amount: 20, status: 'scheduled' }, { currency: 'AED', amount: 50, status: 'notified' }, { currency: 'SAR', amount: 70, status: 'waived' }]))
      .toEqual([{ currency: 'SAR', outstanding: 80 }, { currency: 'AED', outstanding: 50 }])
  })
  it('labels come from the shared spec and contain no dash punctuation', () => {
    expect(enumLabel('category', 'tyre_damage')).toBe('Tyre damage')
    expect(CATEGORIES).toContain('handover_damage')
    const text = JSON.stringify(CHARGE_SPEC) + JSON.stringify(ACTION_LABELS)
    expect(/[–—]/.test(text)).toBe(false)
    for (const action of Object.keys(ACTION_LABELS)) expect(CHARGE_SPEC.enums.action[action]).toBeTruthy()
  })
})

describe('country deduction rules (mirror of the server)', () => {
  it('KSA follows the Saudi Labour Law, other countries need legal confirmation', () => {
    expect(chargeCountryRule('KSA').statutory).toBe(true)
    expect(chargeCountryRule('Saudi Arabia').rule).toBe('ksa_labour_law')
    expect(chargeCountryKey('k.s.a.')).toBe('KSA'); expect(chargeCountryKey('United Arab Emirates')).toBe('UAE'); expect(chargeCountryRule('saudi').statutory).toBe(true)
    expect(chargeCountryRule('UAE')).toMatchObject({ statutory: false, needs_legal_confirmation: true })
    expect(chargeBucket('missing_item')).toBe('damage'); expect(chargeBucket('traffic_fine')).toBe('consent'); expect(chargeBucket('other')).toBe('consent')
    expect(chargeNeedsPhoto('tyre_damage')).toBe(true); expect(chargeNeedsPhoto('missing_item')).toBe(false)
  })
  it('caps one charge per month like the server', () => {
    expect(scheduleCapFor({ country: 'KSA', category: 'accident_damage', monthlyWage: 3000, capPct: 20 })).toBe(500)
    // A traffic fine is an Art 92 deduction: with consent, only the half-wage total applies.
    expect(scheduleCapFor({ country: 'KSA', category: 'traffic_fine', monthlyWage: 3000, capPct: 20 })).toBe(1500)
    expect(scheduleCapFor({ country: 'KSA', category: 'other', monthlyWage: 3000, capPct: 20 })).toBe(1500)
    expect(scheduleCapFor({ country: 'UAE', category: 'accident_damage', monthlyWage: 3000, capPct: 20 })).toBe(600)
    expect(scheduleCapFor({ country: 'KSA', category: 'other', monthlyWage: 0 })).toBeNull()
    expect(ksaMonthlyLimits(1000)).toEqual({ damage: 166.67, total: 500 })
  })
  it('counts 15 working days Sunday to Thursday in Riyadh', () => {
    expect(workingDeadline('2026-11-26T09:00:00+03:00', 15)).toBe('2026-12-17T21:00:00.000Z')
    expect(workingDeadline('2026-11-27T23:30:00+03:00', 1)).toBe('2026-11-29T21:00:00.000Z')
    expect(workingDeadline('bad', 15)).toBeNull()
  })
  it('signs only server text and defaults to a signable language', () => {
    const d = { statements: { 'deduction-consent-v2': { en: 'E', ar: 'A' } } }
    expect(statementText(d, 'deduction-consent-v2', 'ar')).toBe('A')
    expect(statementText(d, 'deduction-consent-v2', 'ur')).toBeNull()
    expect(defaultStatementLanguage('ar')).toBe('ar'); expect(defaultStatementLanguage('fr')).toBe('en')
    expect(validateResponse({ response: 'accept', language: 'fr', acknowledged: true, signature: 'x' })).toMatch(/Urdu/)
  })
  it('never offers a schedule the server would refuse, and says why with the article', () => {
    const base = { charge: { status: 'finance_approved', country: 'KSA', category: 'other', driver_response: 'disputed' }, settings: { country_rule: { statutory: true } }, appeal: null }
    expect(scheduleBlockFor(base)).toMatchObject({ code: 'consent_required', article: '92' })
    const fine = { ...base, charge: { ...base.charge, category: 'traffic_fine' } }
    expect(scheduleBlockFor(fine).article).toBe('92')
    const dmg = { ...base, charge: { ...base.charge, category: 'tyre_damage', fault_finding: 'driver_fault' }, settings: { country_rule: { statutory: true }, objection_deadline: '2026-12-17T21:00:00Z', objection_last_day: '2026-12-17' } }
    expect(scheduleBlockFor(dmg, new Date('2026-12-10T00:00:00Z'))).toMatchObject({ code: 'window_open', article: '91', until: '2026-12-17' })
    expect(scheduleBlockFor(dmg, new Date('2026-12-18T00:00:00Z'))).toBeNull()
    expect(scheduleBlockFor({ ...dmg, appeal: { outcome: null } }, new Date('2026-12-18T00:00:00Z')).code).toBe('open_objection')
    const uae = { charge: { status: 'finance_approved', country: 'UAE', category: 'other', driver_response: 'refused' }, settings: { country_rule: { statutory: false }, objection_deadline: '2026-12-01T00:00:00Z' }, appeal: null }
    expect(scheduleBlockFor(uae, new Date('2026-12-02T00:00:00Z'))).toBeNull()
    expect(scheduleBlockFor({ ...uae, charge: { ...uae.charge, driver_response: 'accepted' } })).toBeNull()
    expect(scheduleBlockFor({ ...base, settings: { schedule_block: { code: 'x', message: 'Server says no' } } }).message).toBe('Server says no')
    expect(scheduleBlockFor({ ...base, settings: { schedule_block: null } })).toBeNull()
  })
  it('a damage charge needs a photo before it is issued', () => {
    const base = { category: 'tyre_damage', source_type: 'none', basis: 'Sidewall cut found at yard exit', amount: 10, currency: 'SAR', evidence: [{ kind: 'document', ref: 'r', label: 'l' }] }
    expect(validateIssue(base)).toMatch(/photo/)
    expect(validateIssue({ ...base, evidence: [...base.evidence, { kind: 'photo', ref: 'tp-storage://tyre-photos/x.jpg', label: 'Cut' }] })).toBeNull()
  })
})

describe('driver charge notice model', () => {
  it('prints photos and a box in the driver language', () => {
    const withPhoto = { ...detail, evidence: [...detail.evidence, { kind: 'photo', label: 'Mirror', ref: 'tp-storage://tyre-photos/m.jpg' }], settings: { country_rule: { statutory: true }, objection_last_day: '2026-12-17', appeal_window_days: 7 } }
    const model = buildChargeDocument(withPhoto, { generatedAt: '2026-01-07T10:00:00Z' })
    const photos = model.sections.find(s => s.id === 'photos')
    expect(photos.photos).toEqual([{ ref: 'tp-storage://tyre-photos/m.jpg', caption: 'Mirror' }])
    expect(model.language).toBe('ar')
    expect(model.driverNotice.dir).toBe('rtl')
    expect(model.driverNotice.lines.join(' ')).toMatch(/SAR 250\.00/)
    expect(model.driverNotice.lines.join(' ')).toMatch(/2026-12-17/)
    expect(hasArabicScript(model.driverNotice.title)).toBe(true)
    expect(noticeLanguage({ signatures: [] }, 'ur')).toBe('ur')
    expect(noticeLanguage({ signatures: [] }, 'fr')).toBe('en')
    const en = buildChargeDocument({ ...detail, signatures: [] }, { generatedAt: '2026-01-07T10:00:00Z' })
    expect(en.driverNotice.lines[2]).toMatch(/not set yet/)
    expect(en.sections.find(s => s.id === 'photos').empty).toBe('No photos attached.')
  })
  it('follows the spec order and formats', () => {
    const model = buildChargeDocument(detail, { generatedAt: '2026-01-07T10:00:00Z' })
    expect(model.documentNumber).toBe('DC-2026-00001-V4')
    expect(model.sections.map(s => s.id)).toEqual(CHARGE_SPEC.sections.map(s => s.id))
    const charge = model.sections.find(s => s.id === 'charge')
    expect(charge.rows.find(r => r[0] === 'Amount')[1]).toBe('SAR 250.00')
    expect(charge.rows.find(r => r[0] === 'Category')[1]).toBe('Missing item')
    expect(model.sections.find(s => s.id === 'appeal').text).toBe('No appeal filed.')
    expect(model.sections.find(s => s.id === 'instalments').body[0][1]).toBe('February 2026')
    expect(model.signatures[0].heading).toBe('Driver written consent to deduction')
    expect(model.headerLines[1]).toMatch(/Notified, waiting for driver/)
  })
  it('renders missing values honestly', () => {
    expect(formatValue(null)).toBe('Not recorded')
    expect(getPath({ a: { b: 1 } }, 'a.b')).toBe(1)
    expect(() => buildChargeDocument({})).toThrow()
  })
})

describe('review fixes', () => {
  it('validation messages go through the screen translation when given', async () => {
    const t = key => `T:${key}`
    expect(validateResponse({ response: 'accept', acknowledged: true }, t)).toBe('T:driverCharges.validate.signature')
    expect(validateIssue({ category: 'tyre_damage', evidence: [] }, t)).toBe('T:driverCharges.validate.photoRequired')
  })
  it('photos keep their shape in the PDF cell', async () => {
    const { fitImage } = await import('../lib/driverChargePdf')
    expect(fitImage(400, 800, 60, 45)).toEqual({ w: 22.5, h: 45, dx: 18.75, dy: 0 })
    expect(fitImage(1600, 400, 60, 45)).toEqual({ w: 60, h: 15, dx: 0, dy: 15 })
    expect(fitImage(0, 0, 60, 45)).toEqual({ w: 60, h: 45, dx: 0, dy: 0 })
  })
})

describe('Saudi Labour Law Art 91 fault finding', () => {
  it('a KSA damage charge needs a finding, and a third party or force majeure finding is never deducted', async () => {
    const { FAULT_FINDINGS, chargeNeedsFaultFinding } = await import('../lib/driverCharges')
    expect(FAULT_FINDINGS).toEqual(['driver_fault', 'instruction_violation', 'third_party', 'force_majeure'])
    expect(chargeNeedsFaultFinding('KSA', 'missing_item')).toBe(true)
    expect(chargeNeedsFaultFinding('KSA', 'traffic_fine')).toBe(false)
    expect(chargeNeedsFaultFinding('UAE', 'missing_item')).toBe(false)
    const issue = { category: 'missing_item', country: 'KSA', source_type: 'none', basis: 'Missing jack after the night shift.', amount: 50, currency: 'SAR', evidence: [{ kind: 'document', ref: 'd', label: 'x' }] }
    expect(validateIssue(issue)).toMatch(/fault finding/)
    expect(validateIssue({ ...issue, fault_finding: 'driver_fault' })).toBeNull()
    const accepted = { charge: { country: 'KSA', category: 'missing_item', driver_response: 'accepted', fault_finding: 'force_majeure' }, settings: {} }
    expect(scheduleBlockFor(accepted)).toMatchObject({ code: 'no_fault', article: '91' })
    expect(scheduleBlockFor({ ...accepted, charge: { ...accepted.charge, fault_finding: 'driver_fault' } })).toBeNull()
  })
})
