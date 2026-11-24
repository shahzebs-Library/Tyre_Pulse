/**
 * Material Master reconciliation and OEM part detail (pure, no I/O).
 *
 * Two things live here:
 *
 * 1. The link review queue. The server (inv_material_link_candidates) offers a
 *    candidate only by an EXACT rule: the ERP item code equals the company SKU
 *    ('exact_code'), or a part-number token on the ERP item equals, after
 *    normalisation, an OEM alias recorded on the catalogue item
 *    ('normalized_oem'). Nothing is applied: a person proposes, a SECOND person
 *    approves (inv_material_link_decide refuses the proposer). An item code
 *    means a different item per country, so an exact-code match whose
 *    description differs is shown as a warning, never as a safe match.
 *
 * 2. The OEM part detail. An approved oem_part_references row points at one ERP
 *    item. Everything the detail shows is read, never estimated: when a figure
 *    is missing (no purchase order, no lead time) the detail says "not
 *    recorded". Money stays in its own currency; nothing is converted.
 */

export const BASIS_LABEL = {
  exact_code: 'Same item code',
  normalized_oem: 'Same OEM number',
  confirmed_suggestion: 'Confirmed by a person',
}

export const CANDIDATE_STATUS_LABEL = {
  open: 'Not proposed',
  mine: 'Proposed by you',
  awaiting: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  taken: 'SKU already linked',
}

export const CANDIDATE_STATUS_TONE = {
  open: 'info', mine: 'warn', awaiting: 'warn', approved: 'good', rejected: 'muted', withdrawn: 'muted', taken: 'bad',
}

/** Where one candidate row stands for the signed-in user. */
export function candidateStatus(row, userId) {
  if (!row) return 'open'
  if (row.proposal_status === 'proposed') return userId && row.proposed_by === userId ? 'mine' : 'awaiting'
  if (row.proposal_status === 'approved') return 'approved'
  if (row.canonical_taken) return 'taken'
  if (row.proposal_status === 'rejected') return 'rejected'
  if (row.proposal_status === 'withdrawn') return 'withdrawn'
  return 'open'
}

/** Plain-English warnings an approver must see before deciding. */
export function candidateWarnings(row) {
  const out = []
  if (!row) return out
  if (row.basis === 'exact_code' && row.same_description === false) {
    out.push('Same code, different description. A code can mean a different item in another country.')
  }
  if (row.basis === 'normalized_oem' && row.alias_verified === false) {
    out.push('The OEM number on the catalogue item is not verified.')
  }
  if (Number(row.candidate_count) > 1) {
    out.push(`This ERP item matches ${row.candidate_count} catalogue items. Pick one; none is chosen for you.`)
  }
  if (row.canonical_taken) out.push('This catalogue item is already linked to another ERP item in this country.')
  return out
}

export const CANDIDATE_FILTERS = ['all', 'safe', 'warning', 'open', 'awaiting', 'approved']

/** A candidate is "safe" when the basis is exact and nothing above warns. */
export function isSafeCandidate(row) {
  return candidateWarnings(row).length === 0
}

export function filterCandidates(rows, { view = 'all', basis = 'all', search = '' } = {}, userId) {
  const q = String(search || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (basis !== 'all' && r.basis !== basis) return false
    const s = candidateStatus(r, userId)
    if (view === 'safe' && !(isSafeCandidate(r) && s === 'open')) return false
    if (view === 'warning' && isSafeCandidate(r)) return false
    if (view === 'open' && s !== 'open') return false
    if (view === 'awaiting' && !(s === 'awaiting' || s === 'mine')) return false
    if (view === 'approved' && s !== 'approved') return false
    if (!q) return true
    return [r.item_code, r.item_name, r.company_sku, r.canonical_description, r.matched_value]
      .some((v) => String(v || '').toLowerCase().includes(q))
  })
}

export function summarizeCandidates(rows, userId) {
  const s = { total: 0, items: 0, exact: 0, oem: 0, sameDescription: 0, warnings: 0, open: 0, awaiting: 0, approved: 0 }
  const items = new Set()
  for (const r of rows || []) {
    s.total += 1
    items.add(r.item_id)
    if (r.basis === 'exact_code') s.exact += 1
    if (r.basis === 'normalized_oem') s.oem += 1
    if (r.same_description) s.sameDescription += 1
    if (!isSafeCandidate(r)) s.warnings += 1
    const st = candidateStatus(r, userId)
    if (st === 'open') s.open += 1
    if (st === 'awaiting' || st === 'mine') s.awaiting += 1
    if (st === 'approved') s.approved += 1
  }
  s.items = items.size
  return s
}

/** The payload inv_material_link_propose stores for an ERP item -> catalogue link. */
export function buildErpLinkPayload(row) {
  if (!row?.item_id || !row?.canonical_id) throw new Error('Choose a candidate first.')
  if (row.basis !== 'exact_code' && row.basis !== 'normalized_oem') throw new Error('Only an exact code or OEM number match can be proposed here.')
  return {
    kind: 'erp_to_catalogue',
    basis: row.basis,
    item_id: row.item_id,
    canonical_id: row.canonical_id,
    evidence: [{
      type: row.basis,
      item_code: row.item_code || null,
      item_name: row.item_name || null,
      company_sku: row.company_sku || null,
      catalogue_description: row.canonical_description || null,
      matched_value: row.matched_value || null,
      same_description: row.same_description ?? null,
      alias_verified: row.alias_verified ?? null,
    }],
  }
}

/**
 * The payload for a stock line -> ERP item link. An exact code is checked by
 * the server; a suggestion needs a note in the person's own words.
 */
export function buildStockLinkPayload(line, candidate, note = '') {
  if (!line?.id) throw new Error('Choose a stock line first.')
  const itemId = candidate?.item_id || (candidate?.source === 'material_master' ? candidate?.id : null)
  if (!itemId) throw new Error('This proposal is not an ERP item. Link the catalogue item to an ERP item first.')
  const exact = line.kind === 'code_exact'
  const text = String(note || '').trim()
  if (!exact && !text) throw new Error('Say why this item is right for the stock line.')
  return {
    kind: 'stock_to_item',
    basis: exact ? 'exact_code' : 'confirmed_suggestion',
    stock_id: line.id,
    item_id: itemId,
    note: text || null,
    evidence: [{
      type: exact ? 'exact_code' : 'suggestion',
      description: line.description || null,
      code_on_line: line.code || null,
      site: line.site || null,
      proposed_code: candidate?.code || candidate?.item_code || null,
      reasons: candidate?.reasons || [],
    }],
  }
}

/** Health card rows from inv_material_link_health(). A problem count above zero is red. */
export function healthRows(h) {
  if (!h) return []
  const n = (v) => (v === null || v === undefined ? null : Number(v))
  const unlinked = h.erp_unlinked_by_country || {}
  const refs = h.oem_refs_by_status || {}
  return [
    { key: 'item_linked_twice', label: 'ERP items linked to two catalogue items', value: n(h.item_linked_twice), problem: true },
    { key: 'sku_linked_twice', label: 'Catalogue items linked twice in one country', value: n(h.sku_linked_twice_in_country), problem: true },
    { key: 'cross_country', label: 'Links whose country differs from the item', value: n(h.cross_country_links), problem: true },
    { key: 'oem_cross_country', label: 'OEM links in another country than the item', value: n(h.oem_cross_country), problem: true },
    { key: 'oem_duplicates', label: 'Duplicate live OEM links', value: n(h.oem_live_duplicates), problem: true },
    { key: 'links', label: 'Catalogue to ERP links', value: n(h.links), problem: false },
    ...Object.keys(unlinked).sort().map((c) => ({ key: `unlinked_${c}`, label: `ERP items not linked (${c})`, value: n(unlinked[c]), problem: false })),
    { key: 'stock_no_item', label: 'Stock lines with no item', value: n(h.stock_without_item), problem: false },
    { key: 'stock_no_item_code', label: 'of which carry an item code', value: n(h.stock_without_item_with_code), problem: false },
    { key: 'stock_no_catalogue', label: 'Stock lines whose item has no catalogue link', value: n(h.stock_item_without_catalogue), problem: false },
    { key: 'oem_approved', label: 'Approved OEM links', value: n(refs.approved ?? 0), problem: false },
    { key: 'oem_proposed', label: 'OEM links awaiting approval', value: n(refs.proposed ?? 0), problem: false },
    { key: 'proposals_open', label: 'Link proposals awaiting approval', value: n(h.proposals_open), problem: false },
  ]
}

const sumBy = (rows, fn) => rows.reduce((a, r) => a + (Number(fn(r)) || 0), 0)

/** Purchase order line statuses that no longer expect goods. */
const CLOSED_PO = /^(closed|cancel|cancelled|canceled|received|complete|completed|rejected)$/i

/**
 * Shape everything the OEM part detail shows. Inputs are raw rows; the output
 * keeps money per currency and says "not recorded" through nulls.
 */
export function buildOemPartDetail({
  references = [], item = null, canonical = null, links = [], erpItems = [], aliases = [],
  balances = [], poLines = [], purchaseOrders = [], lastIssue = null, fitment = null,
} = {}) {
  const erpById = new Map(erpItems.map((e) => [e.id, e]))
  const erpCodes = links
    .map((l) => erpById.get(l.item_id) || null)
    .filter(Boolean)
    .map((e) => ({ id: e.id, country: e.country || null, code: e.item_code || null, name: e.item_name || null }))
    .sort((a, b) => String(a.country).localeCompare(String(b.country)))
  if (item && !erpCodes.some((e) => e.id === item.id)) {
    erpCodes.unshift({ id: item.id, country: item.country || null, code: item.item_code || null, name: item.item_name || null })
  }

  const oemNumbers = references.map((r) => ({
    id: r.id, partNo: r.oem_part_no, manufacturer: r.manufacturer || null, status: r.status,
    approvedAt: r.approved_at || null, country: r.country || null,
  }))

  const alt = aliases.filter((a) => a.alias_type === 'alternative' || a.alias_type === 'superseded')
    .map((a) => ({
      id: a.id, type: a.alias_type, value: a.value, verified: a.verified === true,
      status: a.ref_status || null, source: a.source || null,
    }))

  const bySite = new Map()
  for (const b of balances) {
    const k = `${b.country || ''}|${b.site || ''}|${b.location_code || ''}`
    const prev = bySite.get(k) || { country: b.country || null, site: b.site || null, location: b.location_code || null, onHand: 0, reserved: 0, uom: b.uom || null }
    prev.onHand += Number(b.qty_on_hand) || 0
    prev.reserved += Number(b.qty_reserved) || 0
    bySite.set(k, prev)
  }
  const stock = [...bySite.values()].sort((a, b) => b.onHand - a.onHand)

  const poById = new Map(purchaseOrders.map((p) => [p.id, p]))
  const openLines = poLines.filter((l) => {
    const po = poById.get(l.po_id)
    if (CLOSED_PO.test(String(l.status || '')) || CLOSED_PO.test(String(po?.status || ''))) return false
    return (Number(l.qty_ordered) || 0) - (Number(l.qty_received) || 0) > 0
  })
  const openPo = openLines.map((l) => {
    const po = poById.get(l.po_id) || {}
    return {
      id: l.id, poNumber: po.po_number || null, supplier: po.supplier_name || po.vendor_name || null,
      open: (Number(l.qty_ordered) || 0) - (Number(l.qty_received) || 0),
      expected: po.expected_delivery || null,
    }
  })

  const priced = poLines
    .map((l) => ({ l, po: poById.get(l.po_id) || {} }))
    .filter(({ l }) => l.unit_price !== null && l.unit_price !== undefined && l.currency)
    .sort((a, b) => String(b.po.order_date || '').localeCompare(String(a.po.order_date || '')))
  const lastPoPrice = priced.length ? {
    amount: Number(priced[0].l.unit_price), currency: priced[0].l.currency,
    date: priced[0].po.order_date || null, poNumber: priced[0].po.po_number || null,
  } : null

  const leadDays = purchaseOrders
    .filter((p) => p.order_date && p.actual_delivery)
    .map((p) => Math.round((new Date(p.actual_delivery) - new Date(p.order_date)) / 86400000))
    .filter((d) => Number.isFinite(d) && d >= 0)
  const leadTime = leadDays.length ? { days: Math.round(leadDays.reduce((a, d) => a + d, 0) / leadDays.length), orders: leadDays.length } : null

  const suppliers = [...new Set(purchaseOrders.map((p) => p.supplier_name || p.vendor_name).filter(Boolean))].sort()

  return {
    item,
    canonical,
    oemNumbers,
    erpCodes,
    alternatives: alt,
    stock,
    totals: { onHand: sumBy(stock, (s) => s.onHand), reserved: sumBy(stock, (s) => s.reserved) },
    openPo,
    openPoQty: openPo.length ? sumBy(openPo, (p) => p.open) : 0,
    suppliers,
    lastPoPrice,
    lastIssue: lastIssue && lastIssue.unit_cost !== null && lastIssue.unit_cost !== undefined
      ? { amount: Number(lastIssue.unit_cost), currency: lastIssue.currency || null, date: lastIssue.event_date || null }
      : null,
    leadTime,
    fitment,
  }
}

/** One requisition per selected part. Quantity must be a positive number. */
export function buildRequisitionDrafts(selection, { quantity, neededBy, site, notes } = {}) {
  const out = []
  for (const s of selection || []) {
    const qty = Number(s.quantity ?? quantity)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Enter a quantity above zero for ${s.item_code || 'each part'}.`)
    if (!s.item_id) throw new Error('A selected part has no ERP item.')
    out.push({
      item_id: s.item_id,
      item: [s.item_code, s.item_name].filter(Boolean).join(' ').slice(0, 300) || s.oem_part_no,
      category: 'spare_parts',
      quantity: qty,
      needed_by: neededBy || null,
      site: site || null,
      country: s.country || null,
      status: 'draft',
      notes: [`OEM ${s.oem_part_no || ''}`.trim(), notes].filter(Boolean).join('. ') || null,
    })
  }
  return out
}
