import { describe, expect, it } from 'vitest'
import { buildInstalmentPlan, capAmountFor, validateIssue, validateResponse, outstandingByCurrency, enumLabel, CATEGORIES, ACTION_LABELS, CHARGE_SPEC } from '../lib/driverCharges'
import { buildChargeDocument, getPath, formatValue } from '../lib/driverChargePdf'

const detail = {
  access: 'manager', actions: ['charge_notify'],
  charge: { id: 'c1', charge_no: 'DC-2026-00001', version: 4, category: 'missing_item', source_type: 'none', source_summary: {}, amount: 250, currency: 'SAR', status: 'notified', basis: 'Fire extinguisher missing at handover.', created_at: '2026-01-05T10:00:00Z', deducted_amount: 0, issued_by_name: 'Supervisor', site: 'JEDDAH', country: 'KSA' },
  driver: { driver_name: 'Driver A', driver_id: 'EMP1' },
  evidence: [{ kind: 'document', label: 'Handover checklist', ref: 'checklist/1', created_at: '2026-01-05T10:00:00Z' }],
  signatures: [{ kind: 'driver_acceptance', signer_name: 'Driver A', statement_text: 'I accept', statement_version: 'deduction-consent-v1', signed_at: '2026-01-06T10:00:00Z', charge_version: 2, signature: 'data:image/png;base64,AAA' }],
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

describe('driver charge notice model', () => {
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
