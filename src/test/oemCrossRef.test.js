import { describe, it, expect } from 'vitest'
import {
  normalizePartNo, isPartNumberToken, descriptionTokens, buildMatchIndex, proposeCrossReferences,
  proposalStatus, filterProposals, summarizeProposals, buildProposePayload, resolveErpItem,
} from '../lib/inventory/oemCrossRef'

const entry = (id, part_no, extra = {}) => ({ id, part_no, country: 'KSA', manual_id: 'm1', source_pdf_page: 4, description: 'Bolt', manual: { manufacturer: 'SANY', model: 'SY5' }, ...extra })
const canon = (id, company_sku, extra = {}) => ({ id, company_sku, description: `Item ${company_sku}`, status: 'active', original_description: null, ...extra })
const erp = (id, item_code, country = 'KSA') => ({ id, item_code, country })

describe('normalizePartNo', () => {
  it('uppercases and strips spaces, dashes, dots and slashes but keeps leading zeros', () => {
    expect(normalizePartNo(' 00-12.34/ab c ')).toBe('001234ABC')
    expect(normalizePartNo('0000101285')).toBe('0000101285')
    expect(normalizePartNo(null)).toBe('')
  })
})

describe('descriptionTokens', () => {
  it('finds part numbers in a description, whole and dash-split, and drops words', () => {
    expect(descriptionTokens('LIGHT REAR LH -60211864-SANY')).toContain('60211864')
    expect(descriptionTokens('WHEEL HUB FRONT-A0003500935')).toContain('A0003500935')
    expect(descriptionTokens('PUMP 4110-000-123')).toContain('4110000123')
    expect(descriptionTokens('OEM#:XK-77881 GASKET')).toContain('XK77881')
    expect(descriptionTokens('GASKET RUBBER BOLT')).toEqual([])
  })
  it('only treats 5+ characters with a digit as a part number', () => {
    expect(isPartNumberToken('A123')).toBe(false)
    expect(isPartNumberToken('ABCDE')).toBe(false)
    expect(isPartNumberToken('AB123')).toBe(true)
  })
})

describe('proposeCrossReferences', () => {
  const canonicals = [canon('c1', '224409-O'), canon('c2', '224444-O', { original_description: 'SHAFT ASSY 13010012' }), canon('c3', '500100-O')]
  const aliases = [{ id: 'a1', canonical_id: 'c1', alias_type: 'oem', value: '1279-0625' }]
  const variants = [{ id: 'v1', canonical_id: 'c3', part_number: 'A210 111 000 202' }]
  const erpItems = [erp('e1', '224409-O'), erp('e2', '224444-O'), erp('e3', '500100-O'), erp('e3b', '500100-O')]

  it('bands an alias match high and a description-token match medium', () => {
    const out = proposeCrossReferences({ entries: [entry('x1', '12790625'), entry('x2', '13010012')], aliases, canonicals, erpItems })
    const byPart = Object.fromEntries(out.map((p) => [p.partKey, p]))
    expect(byPart['12790625'].band).toBe('high')
    expect(byPart['12790625'].candidates[0].evidence[0].field).toBe('alias')
    expect(byPart['13010012'].band).toBe('medium')
    expect(byPart['13010012'].candidates[0].erp.item.id).toBe('e2')
  })

  it('never fuzzy matches: a prefix or near number is not a proposal', () => {
    const out = proposeCrossReferences({ entries: [entry('x1', '1279062'), entry('x2', '127906250')], aliases, canonicals, erpItems })
    expect(out).toEqual([])
  })

  it('reports one OEM number matching several items as a conflict and does not pick one', () => {
    const conflictAliases = [...aliases, { id: 'a2', canonical_id: 'c2', alias_type: 'oem', value: '12790625' }]
    const [p] = proposeCrossReferences({ entries: [entry('x1', '12790625')], aliases: conflictAliases, canonicals, erpItems })
    expect(p.kind).toBe('conflict')
    expect(p.band).toBeNull()
    expect(p.candidates.map((c) => c.canonical.id)).toEqual(['c1', 'c2'])
    expect(proposalStatus(p)).toBe('conflict')
  })

  it('groups repeated manual rows of one part number into one proposal', () => {
    const out = proposeCrossReferences({ entries: [entry('x1', 'A210111000202'), entry('x2', 'A210-111-000202')], variants, canonicals, erpItems })
    expect(out).toHaveLength(1)
    expect(out[0].entries.map((e) => e.id)).toEqual(['x1', 'x2'])
  })

  it('cannot propose when the ERP item is missing or ambiguous in that country', () => {
    const out = proposeCrossReferences({ entries: [entry('x1', 'A210111000202')], variants, canonicals, erpItems })
    expect(out[0].candidates[0].erp.state).toBe('ambiguous')
    expect(proposalStatus(out[0])).toBe('no_erp')
    const byKey = new Map([['224409O|ksa', [erp('e1', '224409-O')]]])
    expect(resolveErpItem(canon('c1', '224409-O'), 'UAE', byKey).state).toBe('missing')
    expect(resolveErpItem(canon('c1', '224409-O'), null, byKey).state).toBe('no_country')
  })

  it('reads an existing stored link back as its status, live links winning', () => {
    const references = [
      { id: 'r0', country: 'KSA', oem_part_no: '12790625', item_id: 'e1', status: 'rejected', proposed_at: '2026-11-20' },
      { id: 'r1', country: 'KSA', oem_part_no: '1279-0625', item_id: 'e1', status: 'proposed', proposed_by: 'u1', proposed_at: '2026-11-01' },
    ]
    const [p] = proposeCrossReferences({ entries: [entry('x1', '12790625')], aliases, canonicals, erpItems, references })
    expect(p.candidates[0].reference.id).toBe('r1')
    expect(proposalStatus(p)).toBe('awaiting')
  })

  it('ignores inactive catalogue items in the description index', () => {
    const idx = buildMatchIndex({ canonicals: [canon('c9', 'X', { status: 'retired', original_description: 'PART 98765' })] })
    expect(idx.size).toBe(0)
  })
})

describe('filters, summary and payload', () => {
  const canonicals = [canon('c1', '224409-O'), canon('c2', '224444-O', { original_description: 'SHAFT 13010012' })]
  const aliases = [{ id: 'a1', canonical_id: 'c1', alias_type: 'oem', value: '12790625' }]
  const list = proposeCrossReferences({
    entries: [entry('x1', '12790625', { description: 'Riding Wheel' }), entry('x2', '13010012')],
    aliases, canonicals, erpItems: [erp('e1', '224409-O'), erp('e2', '224444-O')],
  })

  it('filters by confidence, status and search', () => {
    expect(filterProposals(list, { band: 'high' }).map((p) => p.partKey)).toEqual(['12790625'])
    expect(filterProposals(list, { status: 'open' })).toHaveLength(2)
    expect(filterProposals(list, { search: 'riding' })).toHaveLength(1)
    expect(filterProposals(list, { search: '1301-0012' })).toHaveLength(1)
  })

  it('summarises without double counting', () => {
    const s = summarizeProposals(list)
    expect(s).toMatchObject({ total: 2, high: 1, medium: 1, conflict: 0, open: 2, manualRows: 2 })
  })

  it('builds the governed RPC payload with evidence and the ERP item id', () => {
    const p = list.find((x) => x.partKey === '12790625')
    const body = buildProposePayload(p)
    expect(body).toMatchObject({ kind: 'oem', item_id: 'e1', oem_part_no: '12790625', country: 'KSA', oem_entry_id: 'x1', manufacturer: 'SANY', source: 'oem_crossref_review' })
    expect(body.evidence.map((e) => e.type)).toEqual(['oem_manual_entry', 'catalogue_alias'])
    const noErp = { ...p, candidates: [{ ...p.candidates[0], erp: { state: 'missing', item: null, count: 0 } }] }
    expect(() => buildProposePayload(noErp)).toThrow()
  })
})
