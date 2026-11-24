import { describe, it, expect } from 'vitest'
import {
  shapeLimits, rolesWithoutLimit, validateLimitForm, limitPayload, formatLimitAmount, currencyCountry, countryCurrency,
} from '../lib/procurement/purchaseLimits'
import {
  validateEmergency, emergencyColumns, justificationFields, emergencyExportValues, impactText, EMPTY_EMERGENCY,
} from '../lib/procurement/emergencyJustification'

describe('purchase approval limits', () => {
  it('keeps one row per role and currency, separates removed rows, and reports the threshold', () => {
    const s = shapeLimits([
      { id: 1, approver_role: 'Manager', country: 'KSA', currency: 'SAR', max_value: '5000', active: true },
      { id: 2, approver_role: 'Manager', country: 'UAE', currency: null, max_value: 2000, active: true },
      { id: 3, approver_role: 'Director', country: 'KSA', currency: 'SAR', max_value: null, active: false },
    ])
    expect(s.active.map((r) => `${r.role}:${r.currency}:${r.amount}`)).toEqual(['Manager:AED:2000', 'Manager:SAR:5000'])
    expect(s.removed).toHaveLength(1)
    expect(s.thresholdOn).toBe(true)
    expect(shapeLimits([]).thresholdOn).toBe(false)
  })

  it('lists approver roles that have no active limit', () => {
    const { active } = shapeLimits([{ id: 1, approver_role: 'Manager', currency: 'SAR', max_value: 1 }])
    expect(rolesWithoutLimit(['Admin', 'Manager', 'Director'], active)).toEqual(['Admin', 'Director'])
  })

  it('validates the form and never treats a blank amount as zero', () => {
    const roles = ['Manager']
    expect(validateLimitForm({ role: '', currency: 'SAR', amount: 1 }, roles)).toMatch(/role/)
    expect(validateLimitForm({ role: 'Store Keeper', currency: 'SAR', amount: 1 }, roles)).toMatch(/cannot approve/)
    expect(validateLimitForm({ role: 'Manager', currency: 'USD', amount: 1 }, roles)).toMatch(/SAR, AED or EGP/)
    expect(validateLimitForm({ role: 'Manager', currency: 'SAR', amount: '' }, roles)).toMatch(/No upper limit/)
    expect(validateLimitForm({ role: 'Manager', currency: 'SAR', amount: 0 }, roles)).toMatch(/above zero/)
    expect(validateLimitForm({ role: 'Manager', currency: 'SAR', amount: '', noUpperLimit: true }, roles)).toBeNull()
    expect(validateLimitForm({ role: 'Manager', currency: 'EGP', amount: '250000' }, roles)).toBeNull()
  })

  it('builds the admin RPC payload with the currency tied to its country', () => {
    expect(limitPayload({ role: ' Manager ', currency: 'aed', amount: '2000' })).toEqual({
      entity_type: 'purchase_order', approver_role: 'Manager', country: 'UAE', site: null, currency: 'AED',
      max_value: 2000, max_qty: null, active: true,
    })
    expect(limitPayload({ role: 'Director', currency: 'SAR', noUpperLimit: true }, false)).toMatchObject({ max_value: null, active: false, country: 'KSA' })
    expect(currencyCountry('EGP')).toBe('Egypt')
    expect(countryCurrency('egypt')).toBe('EGP')
    expect(formatLimitAmount({ amount: null, currency: 'SAR' })).toBe('No upper limit')
    expect(formatLimitAmount({ amount: 5000, currency: 'SAR' })).toBe('SAR 5,000.00')
  })
})

describe('emergency justification', () => {
  const ctx = { currency: 'SAR', supplier: 'Al Test Supplier', country: 'KSA' }
  const good = {
    ...EMPTY_EMERGENCY, category: 'breakdown', jobCardNo: 'GCKR/JC/1324/0526', downtimeHours: '36',
    routeReason: 'Mixer TM514 is down on a live pour; the approver is travelling today.', estValue: '900',
  }

  it('accepts a complete justification', () => {
    expect(validateEmergency(good, ctx)).toMatchObject({ ok: true, first: null })
  })

  it('refuses every missing required part', () => {
    const e = validateEmergency({ ...EMPTY_EMERGENCY, routeReason: 'too short' }, { currency: 'SAR' }).errors
    expect(Object.keys(e).sort()).toEqual(['asset', 'category', 'country', 'estValue', 'impact', 'routeReason', 'supplier'])
    expect(validateEmergency({ ...good, category: 'other', categoryNote: 'short' }, ctx).errors.categoryNote).toBeTruthy()
    expect(validateEmergency({ ...good, downtimeHours: '', impact: 'bad' }, ctx).errors.impact).toBeTruthy()
    expect(validateEmergency({ ...good, downtimeHours: '', impact: 'Pour at Diriyah stops' }, ctx).ok).toBe(true)
    expect(validateEmergency({ ...good, estCurrency: 'AED' }, ctx).errors.estCurrency).toMatch(/not converted/)
    expect(validateEmergency({ ...good, estValue: '0' }, ctx).errors.estValue).toBeTruthy()
  })

  it('maps the form to purchase order columns without inventing values', () => {
    const c = emergencyColumns({ ...good, assetNo: ' tm 514 ', impact: '' }, ctx)
    expect(c).toMatchObject({
      is_emergency: true, emergency_category: 'breakdown', emergency_asset_no: 'TM514', emergency_job_card_no: 'GCKR/JC/1324/0526',
      emergency_downtime_hours: 36, emergency_impact: null, emergency_est_value: 900, emergency_est_currency: 'SAR',
      emergency_attachment_path: null,
    })
    expect(emergencyColumns({ ...good, downtimeHours: '' }, ctx).emergency_downtime_hours).toBeNull()
  })

  it('shows and exports the full justification, money as text with its currency', () => {
    const po = {
      is_emergency: true, emergency_category: 'other', emergency_category_note: 'Ministry inspection tomorrow',
      emergency_asset_no: 'TM514', emergency_downtime_hours: 4, emergency_impact: 'Truck idle',
      emergency_reason: 'x'.repeat(30), emergency_est_value: 900, emergency_est_currency: 'SAR', supplier_name: 'S1',
      emergency_requested_by_name: 'M1',
    }
    const f = Object.fromEntries(justificationFields(po))
    expect(f['Reason category']).toBe('Other: Ministry inspection tomorrow')
    expect(f['Estimated value']).toBe('SAR 900.00')
    expect(f['Job card']).toBe('N/A')
    expect(f['Attachment']).toBe('None')
    expect(impactText(po)).toBe('4 h downtime; Truck idle')
    const x = emergencyExportValues(po)
    expect(x).toMatchObject({ Emergency: 'Yes', 'Affected asset': 'TM514', 'Estimated value': 'SAR 900.00', 'Downtime hours': 4 })
    expect(emergencyExportValues({ is_emergency: false })).toEqual({ Emergency: 'No' })
  })
})
