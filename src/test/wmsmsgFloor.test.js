// Warehouse floor helper text (namespace wmsmsgfloor): the helpers use the
// caller's `t` when given and stay byte-identical English without one.
import { describe, it, expect } from 'vitest'
import en from '../locales/en/wmsmsgfloor.json'
import ar from '../locales/ar/wmsmsgfloor.json'
import ur from '../locales/ur/wmsmsgfloor.json'
import { floorText } from '../lib/inventory/floorText'
import { validatePutaway, pickIssueArgs, groupPickList, locationPath, summariseHandover } from '../lib/inventory/floorWorkflow'
import { postBlockers, heldReasonText, heldReasonShort, rejectReasonText } from '../lib/inventory/erpStoreLedger'
import { stockWarrantyDraft, scrapProposal, reconFinding } from '../lib/inventory/warehouseAssets'
import { tyreSuggestions, candidateReasons, reconcileCheckText, RECONCILE_CHECKS } from '../lib/inventory/stockReconcile'

// A fake translator that marks every key, so a test can see `t` was used.
const t = (key, vars) => `[${key}${vars ? ` ${JSON.stringify(vars)}` : ''}]`

const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
const leaf = (o, path) => path.split('.').reduce((x, k) => x?.[k], o)

describe('wmsmsgfloor dictionaries', () => {
  it('en, ar and ur carry the same keys and the same placeholders', () => {
    const k = keys(en).sort()
    expect(keys(ar).sort()).toEqual(k)
    expect(keys(ur).sort()).toEqual(k)
    const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join()
    for (const path of k) {
      expect(ph(leaf(ar, path))).toBe(ph(leaf(en, path)))
      expect(ph(leaf(ur, path))).toBe(ph(leaf(en, path)))
    }
  })
  it('has no em or en dashes', () => {
    expect(JSON.stringify([en, ar, ur])).not.toMatch(/[–—]/)
  })
})

describe('floorText', () => {
  it('falls back to English while the dictionary is still loading', () => {
    // LanguageContext answers with the humanized last key segment until the namespace lands.
    const loading = () => 'No Qty'
    expect(floorText(loading)('wmsmsgfloor.putaway.noQty')).toBe('Enter a quantity above zero.')
    expect(floorText((k) => k)('wmsmsgfloor.putaway.noQty')).toBe('Enter a quantity above zero.')
  })
})

describe('floor workflow messages', () => {
  const stock = { id: 's1', location_id: 'a', site: 'NHC', country: 'KSA', qty_on_hand: 5, qty_reserved: 3 }
  const target = { id: 'b', site: 'NHC', country: 'KSA' }
  it('English is unchanged without t', () => {
    expect(validatePutaway({ stock, target, qty: 4 }).error).toBe('Only 2 is free to move (the rest is reserved).')
    expect(pickIssueArgs({ line: { source: 'reservation', reservationId: 'r', qty: 1 }, qty: 3, jobCard: 'JC1' }).error)
      .toBe('Only 1 is reserved for this job card on this line.')
    expect(locationPath(null, new Map())).toBe('No location')
    expect(groupPickList([{ site: null, locationPath: 'X', qty: 1 }])[0].site).toBe('No site')
  })
  it('uses t when given', () => {
    expect(validatePutaway({ stock, target, qty: 4 }, t).error).toBe('[wmsmsgfloor.putaway.onlyFree {"free":2}]')
    expect(pickIssueArgs({ line: null }, t).error).toBe('[wmsmsgfloor.pick.noLine]')
    expect(locationPath(null, new Map(), '', t)).toBe('[wmsmsgfloor.location.none]')
    expect(summariseHandover([{ id: 'm', movement_type: 'issue', qty_change: -1 }], [], t).rows[0].givenBy).toBe('[wmsmsgfloor.handover.notRecorded]')
  })
})

describe('ERP ledger messages', () => {
  const parsed = { ok: true, warnings: ['several_warehouses'], meta: { reportId: 'X-1', warehouses: ['A', 'B'], to: '2026-01-01', currency: 'SAR' }, rejected: [], lines: [] }
  it('English is unchanged without t', () => {
    expect(postBlockers(parsed)).toEqual([
      'The report is X-1, not the Stores Ledger (CSOL-IMS-013-1).',
      'The file covers more than one store (A, B). Export one store per file.',
    ])
    expect(postBlockers({ ...parsed, meta: { ...parsed.meta, reportId: null } })[0]).toBe('The report is not named, not the Stores Ledger (CSOL-IMS-013-1).')
    expect(heldReasonText('no_item')).toBe('Item code not in the Material Master.')
    expect(heldReasonShort('negative_qty')).toBe('negative')
    expect(rejectReasonText('bad_qty')).toBe('Quantity is not a number')
    expect(rejectReasonText('other')).toBe('other')
  })
  it('uses t when given', () => {
    expect(postBlockers({ ok: false }, t)).toEqual(['[wmsmsgfloor.erp.notLedger]'])
    expect(heldReasonText('no_item', t)).toBe('[wmsmsgfloor.erp.held.no_item]')
  })
})

describe('warehouse assets messages', () => {
  const stock = { stock_id: 's1', qty_on_hand: 2 }
  it('English is unchanged without t', () => {
    expect(stockWarrantyDraft(stock, { failure_type: 'Other', qty: 3 }).error).toBe('The claim cannot cover more than the 2 on hand.')
    expect(scrapProposal(stock, { qty: 1, reason: 'no' }).error).toBe('Give the reason for scrapping (at least a few words).')
    expect(reconFinding({ erpLines: 1, invIssueQty: null })).toBe('Issued in the ERP, not recorded as an issue in the store.')
  })
  it('uses t when given', () => {
    expect(scrapProposal(stock, { qty: 9 }, t).error).toBe('[wmsmsgfloor.scrap.overOnHand {"onHand":2}]')
    expect(stockWarrantyDraft(null, {}, t).error).toBe('[wmsmsgfloor.warranty.noStock]')
    expect(reconFinding({ erpLines: 1, invIssueQty: 1, erpQty: 1 }, t)).toBe('[wmsmsgfloor.finance.finding.agree]')
  })
})

describe('stock reconcile messages', () => {
  const row = { description: 'TYRE 315/80R22.5 DOUBLE COIN' }
  const cands = [{ item_code: 'A1', item_name: '315/80R22.5 DOUBLE COIN RR', brand: 'Double Coin' }]
  it('keeps English reasons and translates them on request', () => {
    const s = tyreSuggestions(row, cands).suggestions[0]
    expect(s.reasons).toEqual(['Same tyre size 315/80R22.5', 'Same brand DOUBLE COIN'])
    expect(candidateReasons(s)).toEqual(s.reasons)
    expect(candidateReasons(s, t)[0]).toBe('[wmsmsgfloor.reconcile.reason.sameSize {"size":"315/80R22.5"}]')
    expect(candidateReasons({ reasons: ['x'] }, t)).toEqual(['x'])
  })
  it('check labels', () => {
    for (const ch of RECONCILE_CHECKS) {
      expect(reconcileCheckText(ch, 'label')).toBe(ch.label)
      expect(reconcileCheckText(ch, 'help')).toBe(ch.help)
    }
    const c = RECONCILE_CHECKS[0]
    expect(reconcileCheckText(c, 'help', t)).toBe(`[wmsmsgfloor.reconcile.check.${c.key}.help]`)
  })
})
