import { describe, it, expect } from 'vitest'
import {
  candidateStatus, candidateWarnings, isSafeCandidate, filterCandidates, summarizeCandidates,
  buildErpLinkPayload, buildStockLinkPayload, healthRows, buildOemPartDetail, buildRequisitionDrafts,
} from '../lib/oem/materialLinks'

const base = {
  item_id: 'i1', country: 'UAE', item_code: '450115-O', item_name: 'COMPRESSOR OIL 68',
  canonical_id: 'c1', company_sku: '450115-O', canonical_description: 'COMPRESSOR OIL 68',
  basis: 'exact_code', same_description: true, matched_value: '450115-O', alias_verified: null,
  candidate_count: 1, canonical_taken: false, proposal_id: null, proposal_status: null, proposed_by: null,
}

describe('candidate status and warnings', () => {
  it('is open when nothing is proposed', () => {
    expect(candidateStatus(base, 'u1')).toBe('open')
    expect(isSafeCandidate(base)).toBe(true)
  })
  it('separates my proposal from someone else\'s', () => {
    const p = { ...base, proposal_id: 'p', proposal_status: 'proposed', proposed_by: 'u1' }
    expect(candidateStatus(p, 'u1')).toBe('mine')
    expect(candidateStatus(p, 'u2')).toBe('awaiting')
  })
  it('warns when the same code carries a different description', () => {
    const r = { ...base, same_description: false }
    expect(candidateWarnings(r)[0]).toMatch(/different description/)
    expect(isSafeCandidate(r)).toBe(false)
  })
  it('warns on several catalogue candidates and on an unverified OEM alias', () => {
    const r = { ...base, basis: 'normalized_oem', alias_verified: false, candidate_count: 2 }
    const w = candidateWarnings(r)
    expect(w).toHaveLength(2)
  })
  it('marks a SKU already linked in the country', () => {
    expect(candidateStatus({ ...base, canonical_taken: true }, 'u1')).toBe('taken')
  })
})

describe('filter and summary', () => {
  const rows = [
    base,
    { ...base, item_id: 'i2', same_description: false },
    { ...base, item_id: 'i3', basis: 'normalized_oem', proposal_status: 'proposed', proposed_by: 'u2', proposal_id: 'p3' },
  ]
  it('filters safe, warning, awaiting and search', () => {
    expect(filterCandidates(rows, { view: 'safe' }, 'u1').map((r) => r.item_id)).toEqual(['i1'])
    expect(filterCandidates(rows, { view: 'warning' }, 'u1').map((r) => r.item_id)).toEqual(['i2'])
    expect(filterCandidates(rows, { view: 'awaiting' }, 'u1').map((r) => r.item_id)).toEqual(['i3'])
    expect(filterCandidates(rows, { basis: 'normalized_oem' }, 'u1')).toHaveLength(1)
    expect(filterCandidates(rows, { search: 'compressor' }, 'u1')).toHaveLength(3)
  })
  it('summarises the page', () => {
    const s = summarizeCandidates(rows, 'u1')
    expect(s).toMatchObject({ total: 3, items: 3, exact: 2, oem: 1, warnings: 1, open: 2, awaiting: 1 })
  })
})

describe('payloads', () => {
  it('builds an ERP to catalogue proposal with evidence', () => {
    const p = buildErpLinkPayload(base)
    expect(p).toMatchObject({ kind: 'erp_to_catalogue', basis: 'exact_code', item_id: 'i1', canonical_id: 'c1' })
    expect(p.evidence[0].same_description).toBe(true)
  })
  it('refuses a fuzzy basis', () => {
    expect(() => buildErpLinkPayload({ ...base, basis: 'similar' })).toThrow()
  })
  it('stock link: exact code needs no note, a suggestion does', () => {
    const cand = { id: 'm1', source: 'material_master', code: 'X1', reasons: ['Same item code and country'] }
    expect(buildStockLinkPayload({ id: 's1', kind: 'code_exact', code: 'X1' }, cand)).toMatchObject({ basis: 'exact_code', item_id: 'm1', stock_id: 's1' })
    expect(() => buildStockLinkPayload({ id: 's2', kind: 'no_code_suggest' }, cand, '')).toThrow(/why/)
    expect(buildStockLinkPayload({ id: 's2', kind: 'no_code_suggest' }, cand, 'checked on shelf').basis).toBe('confirmed_suggestion')
  })
  it('stock link: a catalogue-only suggestion cannot be proposed', () => {
    expect(() => buildStockLinkPayload({ id: 's2', kind: 'no_code_suggest' }, { id: 'c', source: 'material_canonical' }, 'x')).toThrow(/ERP item/)
  })
})

describe('health rows', () => {
  it('flags problem counts and keeps nulls as not recorded', () => {
    const rows = healthRows({ item_linked_twice: 0, cross_country_links: 2, erp_unlinked_by_country: { UAE: 9321, Egypt: 3398 }, links: null })
    expect(rows.find((r) => r.key === 'cross_country')).toMatchObject({ value: 2, problem: true })
    expect(rows.find((r) => r.key === 'links').value).toBeNull()
    expect(rows.find((r) => r.key === 'unlinked_UAE').value).toBe(9321)
  })
})

describe('OEM part detail', () => {
  it('sums stock per location, open PO qty, keeps currency and says not recorded', () => {
    const d = buildOemPartDetail({
      references: [{ id: 'r', oem_part_no: '60211864', status: 'approved' }],
      item: { id: 'i1', country: 'KSA', item_code: 'A1', item_name: 'LIGHT' },
      canonical: { id: 'c', company_sku: 'A1' },
      links: [{ item_id: 'i1', canonical_id: 'c' }, { item_id: 'i2', canonical_id: 'c' }],
      erpItems: [{ id: 'i1', country: 'KSA', item_code: 'A1' }, { id: 'i2', country: 'UAE', item_code: 'A1' }],
      aliases: [{ id: 'x', alias_type: 'alternative', value: 'B2', verified: true }, { id: 'y', alias_type: 'oem', value: 'Z' }],
      balances: [
        { item_id: 'i1', country: 'KSA', site: 'NHC', location_code: 'A-1', qty_on_hand: 4, qty_reserved: 1 },
        { item_id: 'i1', country: 'KSA', site: 'NHC', location_code: 'A-1', qty_on_hand: 2, qty_reserved: 0 },
      ],
      poLines: [{ id: 'l1', po_id: 'p1', qty_ordered: 10, qty_received: 3, unit_price: 12.5, currency: 'SAR' }],
      purchaseOrders: [{ id: 'p1', po_number: 'PO-1', supplier_name: 'Acme', order_date: '2026-11-01', status: 'approved' }],
    })
    expect(d.erpCodes.map((e) => e.country)).toEqual(['KSA', 'UAE'])
    expect(d.alternatives).toHaveLength(1)
    expect(d.stock).toEqual([expect.objectContaining({ onHand: 6, reserved: 1 })])
    expect(d.openPoQty).toBe(7)
    expect(d.lastPoPrice).toMatchObject({ amount: 12.5, currency: 'SAR' })
    expect(d.leadTime).toBeNull()
    expect(d.lastIssue).toBeNull()
    expect(d.suppliers).toEqual(['Acme'])
  })
  it('a closed PO is not open', () => {
    const d = buildOemPartDetail({
      poLines: [{ id: 'l1', po_id: 'p1', qty_ordered: 10, qty_received: 0 }],
      purchaseOrders: [{ id: 'p1', status: 'cancelled' }],
    })
    expect(d.openPoQty).toBe(0)
  })
})

describe('requisition drafts', () => {
  it('builds one draft per part with item_id and refuses a zero quantity', () => {
    const sel = [{ item_id: 'i1', item_code: 'A1', item_name: 'LIGHT', oem_part_no: '602', country: 'KSA' }]
    const out = buildRequisitionDrafts(sel, { quantity: '2', site: 'NHC' })
    expect(out[0]).toMatchObject({ item_id: 'i1', quantity: 2, status: 'draft', country: 'KSA', site: 'NHC' })
    expect(() => buildRequisitionDrafts(sel, { quantity: 0 })).toThrow(/quantity/)
  })
})
