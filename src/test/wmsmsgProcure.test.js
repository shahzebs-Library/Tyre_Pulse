import { describe, it, expect } from 'vitest'
import en from '../locales/en/wmsmsgprocure.json'
import ar from '../locales/ar/wmsmsgprocure.json'
import ur from '../locales/ur/wmsmsgprocure.json'
import { requisitionPoDraft, receiptPlan } from '../lib/procurementChain'
import { validateLimitForm, formatLimitAmount } from '../lib/procurement/purchaseLimits'
import { formatMoneyIn } from '../lib/procurement/procurementDepth'
import {
  validateEmergency, categoryLabel, impactText, estimateText, justificationFields, EMPTY_EMERGENCY,
} from '../lib/procurement/emergencyJustification'
import { NOT_SET_UP } from '../lib/api/procurementDepth'
import { entryErrors, suggestStockUnit } from '../lib/stockQuickEntry'
import { suggestReorderLevels } from '../lib/inventory/reorderLevels'
import { utilisationGap } from '../lib/stockLedger'

// A fake translator: returns the key so we can see the helper used `t`.
const t = (key, vars) => (vars ? `${key}|${Object.keys(vars).sort().join(',')}` : key)

const keysOf = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v, `${p}${k}.`) : [`${p}${k}`])).sort()

describe('wmsmsgprocure locale files', () => {
  it('en, ar and ur carry the same keys and no long dashes', () => {
    expect(keysOf(ar)).toEqual(keysOf(en))
    expect(keysOf(ur)).toEqual(keysOf(en))
    for (const f of [en, ar, ur]) expect(JSON.stringify(f)).not.toMatch(/[–—]/)
  })
})

describe('procurementChain text', () => {
  it('English by default, translated with t', () => {
    expect(requisitionPoDraft(null, {}).errors).toContain('No requisition.')
    expect(requisitionPoDraft(null, { t }).errors).toContain('wmsmsgprocure.chain.draft.noRequisition')
    const pl = [{ id: 'a', line_no: 3, qty_ordered: 2, item_id: 'i' }]
    expect(receiptPlan(pl, { a: { qty_received: 5 } }).errors[0]).toBe('Line 3: accepting 5 exceeds the 2 still outstanding.')
    expect(receiptPlan(pl, { a: { qty_received: 5 } }, t).errors[0]).toBe('wmsmsgprocure.chain.receipt.overOutstanding|label,outstanding,qty')
    expect(receiptPlan([], {}, t).errors).toEqual(['wmsmsgprocure.chain.receipt.nothingEntered'])
  })
})

describe('purchaseLimits / procurementDepth text', () => {
  it('English by default, translated with t', () => {
    expect(validateLimitForm({ role: 'X', currency: 'SAR' }, ['Manager'])).toBe('X cannot approve purchase orders.')
    expect(validateLimitForm({ role: 'X', currency: 'SAR' }, ['Manager'], t)).toBe('wmsmsgprocure.limits.roleCannotApprove|role')
    expect(formatLimitAmount(null)).toBe('N/A')
    expect(formatLimitAmount({ amount: null }, t)).toBe('wmsmsgprocure.limits.noUpperLimit')
    expect(formatMoneyIn(null, 'SAR', t)).toBe('wmsmsgprocure.common.noPrice')
    expect(formatMoneyIn(12, 'SAR', t)).toBe('SAR 12.00')
    expect(NOT_SET_UP).toBe('This part of procurement is not switched on yet. Ask an administrator to apply the procurement update.')
  })
})

describe('emergencyJustification text', () => {
  it('English by default, translated with ctx.t / t', () => {
    expect(validateEmergency(EMPTY_EMERGENCY, {}).errors.routeReason).toBe('Explain why the normal approval route could not be used (at least 30 characters).')
    expect(validateEmergency(EMPTY_EMERGENCY, { t }).errors.routeReason).toBe('wmsmsgprocure.emergency.err.routeReason|min')
    expect(validateEmergency({ ...EMPTY_EMERGENCY, estCurrency: 'AED' }, { currency: 'SAR', t }).errors.estCurrency).toBe('wmsmsgprocure.emergency.err.estCurrencyMismatch|currency')
    expect(categoryLabel('safety')).toBe('Safety')
    expect(categoryLabel('safety', t)).toBe('wmsmsgprocure.emergency.cat.safety')
    expect(categoryLabel(null)).toBe('N/A')
    expect(impactText({ emergency_downtime_hours: 4 })).toBe('4 h downtime')
    expect(impactText({ emergency_downtime_hours: 4 }, t)).toBe('wmsmsgprocure.emergency.downtime|hours')
    expect(estimateText({}, t)).toBe('wmsmsgprocure.emergency.noEstimate')
    expect(justificationFields({ emergency_category: 'other', emergency_category_note: 'flood' })[0]).toEqual(['Reason category', 'Other: flood'])
    expect(justificationFields({}, t)[8]).toEqual(['wmsmsgprocure.emergency.f.attachment', 'wmsmsgprocure.common.none'])
  })
})

describe('stock text', () => {
  it('quick entry errors and unit reasons use t', () => {
    const rows = [{ name: 'Valve', quantity: 'x', unit: '', kind: 'accessory', key: 'k', condition: 'New', bin: '' }]
    expect(entryErrors(rows, { site: 'NHC', country: 'KSA', mode: 'receipt', reference: 'R1' })).toContain('Valve: enter a whole positive receipt quantity.')
    expect(entryErrors(rows, { site: 'NHC', country: 'KSA', mode: 'count', reference: '', t })).toContain('wmsmsgprocure.stock.err.qtyCount|name')
    expect(suggestStockUnit({ name: 'TYRE 315/80R22.5' }).reason).toBe('Tyres are counted one by one.')
    expect(suggestStockUnit({ name: 'TYRE 315/80R22.5', t }).reason).toBe('wmsmsgprocure.stock.unit.tyre')
  })

  it('reorder explanation and ledger gap use t', () => {
    expect(suggestReorderLevels({}, null).explanation).toBe('No item code, so usage cannot be measured.')
    expect(suggestReorderLevels({}, { scope: 'site', avgPerMonth: 4 }, { t }).explanation).toBe('wmsmsgprocure.reorder.explanation|critical,lead,min,rate,reorder')
    expect(utilisationGap(1, 0).note).toBe('1 tyre were fitted in this period but only 0 were issued from stock. Fitments are not deducted automatically: record an Issue so balances fall when tyres are used.')
    expect(utilisationGap(3, 1, t).note).toBe('wmsmsgprocure.ledger.gap.note|fitted,issued')
  })
})
