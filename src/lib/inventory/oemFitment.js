/**
 * OEM depth (pure, no I/O): fitment, alternatives, stock visibility and the
 * unmatched-manual-row worklist. Every rule here is an EXACT comparison that a
 * person can check by reading two values side by side. There is no fuzzy,
 * prefix or similarity matching anywhere in this file.
 *
 * 1. Fitment. A parts manual (oem_parts_manuals) names a manufacturer and a
 *    model. The fleet register (vehicle_fleet) names a make, a model (often
 *    blank) and a vehicle type. We report, per manual:
 *      - assets whose make equals the manual's manufacturer (case/space folded);
 *      - of those, how many even record a model;
 *      - assets whose model contains the manual's MODEL FAMILY as a whole token
 *        (the first code token of the manual model, e.g. "SY412C" from
 *        "SY412C-8/ST"), or whose normalised model equals the whole manual
 *        model exactly.
 *    This is information, never a claim that a part fits a machine: "the
 *    manual says SANY SY412C-8/ST; the fleet has N such assets". When the
 *    manual has no model we show the make count only and say so.
 *
 * 2. Alternatives. "A can replace B" is recorded on B as a reference of type
 *    'alternative' (or 'superseded' when B is replaced by A), through the
 *    governed inv_correction_request writer (action add_reference). A second
 *    person approves it in Corrections (inv_correction_decide refuses the
 *    requester approving their own request). Nothing is linked here.
 *
 * 3. Stock. Catalogue item -> material_canonical_items -> ERP item ->
 *    v_inv_balances, summed per site. An approved OEM link points straight at
 *    the ERP item.
 *
 * 4. Unmatched manual rows. Rows with no proposal from the cross-reference
 *    engine. Candidates are offered by two exact rules only:
 *      - 'part_number': the manual part number equals (after normalisation) a
 *        reference of ANY type, a variant part number, or a part-number token in
 *        a catalogue description;
 *      - 'words': EVERY significant word of the manual description appears as a
 *        whole word in the catalogue description. Candidates are ordered by how
 *        few extra words the catalogue description carries (most specific
 *        first). When too many items qualify the row is marked 'broad' and no
 *        list is offered, because a list of 400 "NUT" items helps nobody.
 */
import { normalizePartNo, descriptionTokens, isPartNumberToken } from './oemCrossRef'
import { textFn } from '../wmsText'

/** Uppercase, collapse inner spaces, trim. */
export function normalizeMake(v) {
  return String(v ?? '').toUpperCase().replace(/\s+/g, ' ').trim()
}

/** Code-like tokens in a model string, normalised (letters + digits only). */
export function modelTokens(model) {
  if (!model) return []
  const out = []
  for (const raw of String(model).split(/[\s,;()[\]/\\-]+/)) {
    const k = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (k) out.push(k)
  }
  return out
}

/**
 * The model family: the first token of the manual model that carries both a
 * letter and a digit and is at least 4 characters ("SY412C", "SYL956H5").
 * Null when the manual names no such token.
 */
export function modelFamily(model) {
  for (const k of modelTokens(model)) {
    if (k.length >= 4 && /[A-Z]/.test(k) && /[0-9]/.test(k)) return k
  }
  return null
}

const fullModelKey = (m) => String(m ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1 }

/**
 * Fitment evidence per manual.
 * @returns {Array<{ manual, make, model, family, makeAssets, modelRecorded, modelMatches, byType, byCountry, matchedAssets, basis }>}
 */
export function buildManualFitment({ manuals = [], fleet = [] } = {}) {
  return manuals.map((manual) => {
    const make = normalizeMake(manual?.manufacturer)
    const family = modelFamily(manual?.model)
    const full = fullModelKey(manual?.model)
    const res = {
      manual, make, model: manual?.model || null, family,
      makeAssets: 0, modelRecorded: 0, modelMatches: 0,
      byType: {}, byCountry: {}, matchedAssets: [],
      basis: !make ? 'no_make' : !manual?.model ? 'no_model' : !family ? 'no_family' : 'model',
    }
    if (!make) return res
    for (const a of fleet) {
      if (normalizeMake(a?.make) !== make) continue
      res.makeAssets += 1
      bump(res.byType, a?.vehicle_type ? String(a.vehicle_type) : 'Not recorded')
      bump(res.byCountry, a?.country || 'Not recorded')
      const m = String(a?.model ?? '').trim()
      if (!m) continue
      res.modelRecorded += 1
      const toks = modelTokens(m)
      const hit = (family && toks.includes(family)) || (full && fullModelKey(m) === full)
      if (hit) {
        res.modelMatches += 1
        res.matchedAssets.push(a)
      }
    }
    return res
  })
}

/**
 * Plain sentence for one manual's fitment, never claiming a fit. Optional `t`
 * translates it; without one the English text is returned.
 */
export function fitmentSentence(f, t) {
  const tx = textFn(t)
  const name = [f.manual?.manufacturer, f.model].filter(Boolean).join(' ') || tx('wmsmsgparts.fitment.thisManual')
  if (f.basis === 'no_make') return tx('wmsmsgparts.fitment.noMake')
  const makeLine = tx(f.makeAssets === 1 ? 'wmsmsgparts.fitment.makeLineOne' : 'wmsmsgparts.fitment.makeLineMany', { n: f.makeAssets, make: f.make })
  if (f.basis !== 'model') return tx('wmsmsgparts.fitment.noModel', { makeLine })
  return tx('wmsmsgparts.fitment.full', { name, makeLine, recorded: f.modelRecorded, matches: f.modelMatches, family: f.family })
}

const EVIDENCE_FIELDS = new Set([
  'variant', 'description', 'words',
  'reference_oem', 'reference_alternative', 'reference_superseded', 'reference_barcode', 'reference_erp_legacy',
  'reference_aftermarket', 'reference_company_sku', 'reference_erp_sku', 'reference_other',
])

/**
 * Display name of a candidate evidence field ('reference_oem' -> "reference oem").
 * Optional `t` translates it; an unknown field keeps its plain English form.
 */
export function evidenceFieldLabel(field, t) {
  const f = String(field || '')
  if (typeof t === 'function' && EVIDENCE_FIELDS.has(f)) return t(`wmsmsgparts.evidence.${f}`)
  return f.replace(/_/g, ' ')
}

/** Distinct manuals behind a set of manual rows (for an item's fitment). */
export function manualIdsForEntries(entries) {
  return [...new Set((entries || []).map((e) => e?.manual_id).filter(Boolean))]
}

/* ── Stock ─────────────────────────────────────────────────────────────── */

/** item_id -> [{ site, country, qty }] with qty > 0, sorted by site. */
export function stockBySite(balances) {
  const byItem = new Map()
  for (const b of balances || []) {
    if (!b?.item_id) continue
    const k = `${b.item_id}|${b.site || ''}|${b.country || ''}`
    const m = byItem.get(b.item_id) || new Map()
    const prev = m.get(k) || { site: b.site || 'No site', country: b.country || null, qty: 0, uom: b.uom || null }
    prev.qty += Number(b.qty_on_hand) || 0
    m.set(k, prev)
    byItem.set(b.item_id, m)
  }
  const out = new Map()
  for (const [id, m] of byItem) {
    out.set(id, [...m.values()].filter((x) => x.qty > 0).sort((a, b) => String(a.site).localeCompare(String(b.site))))
  }
  return out
}

/** canonical_id -> [item_id] from material_canonical_items. */
export function itemsByCanonical(links) {
  const out = new Map()
  for (const l of links || []) {
    if (!l?.canonical_id || !l?.item_id) continue
    const list = out.get(l.canonical_id) || []
    if (!list.includes(l.item_id)) list.push(l.item_id)
    out.set(l.canonical_id, list)
  }
  return out
}

/**
 * Stock rows for catalogue items that carry OEM numbers.
 * @returns {Array<{ canonical, oemNumbers:string[], itemIds:string[], sites:[], total:number, linked:boolean }>}
 */
export function catalogueStockRows({ canonicals = [], oemAliases = [], links = [], balances = [] } = {}) {
  const oemByCanon = new Map()
  for (const a of oemAliases) {
    if (!a?.canonical_id || (a.alias_type && a.alias_type !== 'oem')) continue
    const list = oemByCanon.get(a.canonical_id) || []
    if (a.value && !list.includes(a.value)) list.push(a.value)
    oemByCanon.set(a.canonical_id, list)
  }
  const items = itemsByCanonical(links)
  const stock = stockBySite(balances)
  const rows = []
  for (const c of canonicals) {
    const oemNumbers = oemByCanon.get(c?.id)
    if (!oemNumbers?.length) continue
    const itemIds = items.get(c.id) || []
    const sites = itemIds.flatMap((id) => stock.get(id) || [])
    rows.push({ canonical: c, oemNumbers, itemIds, sites, total: sites.reduce((s, x) => s + x.qty, 0), linked: itemIds.length > 0 })
  }
  return rows.sort((a, b) => b.total - a.total || String(a.canonical.company_sku || '').localeCompare(String(b.canonical.company_sku || '')))
}

/** Stock rows for stored OEM links (approved first). */
export function linkStockRows({ references = [], erpItems = [], balances = [] } = {}) {
  const erp = new Map((erpItems || []).map((i) => [i.id, i]))
  const stock = stockBySite(balances)
  return (references || [])
    .filter((r) => r?.status === 'approved' || r?.status === 'proposed')
    .map((r) => {
      const sites = stock.get(r.item_id) || []
      return { reference: r, item: erp.get(r.item_id) || null, sites, total: sites.reduce((s, x) => s + x.qty, 0) }
    })
    .sort((a, b) => (a.reference.status === b.reference.status ? 0 : a.reference.status === 'approved' ? -1 : 1)
      || String(a.reference.oem_part_no || '').localeCompare(String(b.reference.oem_part_no || '')))
}

export function summarizeStockRows(rows) {
  const s = { items: 0, linked: 0, inStock: 0, sites: new Set() }
  for (const r of rows || []) {
    s.items += 1
    if (r.linked !== false) s.linked += 1
    if (r.total > 0) s.inStock += 1
    for (const x of r.sites) s.sites.add(x.site)
  }
  return { items: s.items, linked: s.linked, inStock: s.inStock, sites: s.sites.size }
}

/* ── Alternatives ──────────────────────────────────────────────────────── */

export const ALT_RELATIONS = ['alternative', 'superseded']

/** Existing alternative / superseded references, grouped per catalogue item. */
export function existingAlternatives(aliases) {
  const out = new Map()
  for (const a of aliases || []) {
    if (!ALT_RELATIONS.includes(a?.alias_type) || !a?.canonical_id) continue
    const list = out.get(a.canonical_id) || []
    list.push(a)
    out.set(a.canonical_id, list)
  }
  return out
}

/**
 * The payload inv_correction_request stores for "replacement can replace
 * target". The reference is recorded ON the target (B); its value is the
 * replacement's part number (or company SKU when A is a catalogue item).
 * @throws when the request is incomplete or names the same item twice.
 */
export function buildAlternativeRequest({ target, replacement, relation = 'alternative', reason, oemEntry = null } = {}) {
  if (!target?.id) throw new Error('Choose the item that can be replaced (B).')
  if (!ALT_RELATIONS.includes(relation)) throw new Error('Relation must be alternative or superseded.')
  const value = String(replacement?.value || '').trim()
  if (!value) throw new Error('Give the part number or company SKU of the replacement (A).')
  if (value.length > 200) throw new Error('A reference can be at most 200 characters.')
  if (replacement?.canonicalId && replacement.canonicalId === target.id) throw new Error('An item cannot replace itself.')
  if (normalizePartNo(value) && normalizePartNo(value) === normalizePartNo(target.company_sku)) throw new Error('An item cannot replace itself.')
  const why = String(reason || '').trim()
  if (!why) throw new Error('Give a reason, for example the manual page or the supplier notice.')
  const evidence = [{ type: 'alternative_proposal', relation, replacement_value: value, replacement_canonical_id: replacement?.canonicalId || null, replacement_sku: replacement?.sku || null }]
  if (oemEntry?.id) {
    evidence.push({ type: 'oem_manual_entry', entry_id: oemEntry.id, manual_id: oemEntry.manual_id || null, pdf_page: oemEntry.source_pdf_page ?? null, part_no: oemEntry.part_no, description: oemEntry.description || null })
  }
  return {
    target_kind: 'canonical',
    target_id: target.id,
    action: 'add_reference',
    topic: 'reference',
    new_value: { alias_type: relation, value, manufacturer: replacement?.manufacturer || null, brand: replacement?.brand || null },
    evidence,
    reason: why,
  }
}

/* ── Unmatched manual rows ─────────────────────────────────────────────── */

const STOP = new Set(['THE', 'AND', 'FOR', 'WITH', 'OF', 'ASSY', 'ASSEMBLY', 'PART', 'PARTS', 'COMPONENTS', 'COMPONENT', 'SET', 'KIT'])

/** Significant whole words: 3+ letters, no digits, not a filler word. */
export function significantWords(text) {
  const out = new Set()
  for (const raw of String(text || '').toUpperCase().split(/[^A-Z0-9]+/)) {
    if (raw.length < 3 || /[0-9]/.test(raw) || STOP.has(raw)) continue
    out.add(raw)
  }
  return [...out]
}

/** Every word in a description (for containment checks). */
function wordSet(text) {
  return new Set(String(text || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean))
}

export const BROAD_LIMIT = 25
export const MAX_CANDIDATES = 5

/**
 * Exact-rule candidate index over the catalogue.
 * partIndex: normalised part number -> [{ canonicalId, field, value }]
 * wordIndex: word -> Set(canonicalId)
 */
export function buildCandidateIndex({ canonicals = [], aliases = [], variants = [] } = {}) {
  const partIndex = new Map()
  const add = (k, ev) => {
    if (!k || !ev.canonicalId) return
    const list = partIndex.get(k) || []
    if (!list.some((x) => x.canonicalId === ev.canonicalId && x.field === ev.field)) list.push(ev)
    partIndex.set(k, list)
  }
  for (const a of aliases) add(normalizePartNo(a?.value), { canonicalId: a?.canonical_id, field: `reference_${a?.alias_type || 'other'}`, value: a?.value })
  for (const v of variants) add(normalizePartNo(v?.part_number), { canonicalId: v?.canonical_id, field: 'variant', value: v?.part_number })
  const wordIndex = new Map()
  const words = new Map()
  const byId = new Map()
  for (const c of canonicals) {
    if (!c?.id || (c.status && c.status !== 'active')) continue
    byId.set(c.id, c)
    const text = `${c.description || ''} ${c.original_description || ''}`
    for (const k of descriptionTokens(text)) add(k, { canonicalId: c.id, field: 'description', value: c.description })
    const ws = wordSet(text)
    words.set(c.id, ws)
    for (const w of ws) {
      const set = wordIndex.get(w) || new Set()
      set.add(c.id)
      wordIndex.set(w, set)
    }
  }
  return { partIndex, wordIndex, words, byId }
}

/**
 * Candidates for one manual row.
 * @returns {{ rule:'part_number'|'words'|'broad'|'none', words:string[], candidates:Array<{canonical, rule, evidence, extraWords}>, broadCount:number }}
 */
export function candidatesForEntry(entry, index) {
  const key = normalizePartNo(entry?.part_no)
  const words = significantWords(entry?.description)
  const partHits = isPartNumberToken(key) ? index.partIndex.get(key) || [] : []
  if (partHits.length) {
    const byCanon = new Map()
    for (const h of partHits) {
      const c = index.byId.get(h.canonicalId)
      if (!c) continue
      const prev = byCanon.get(c.id) || { canonical: c, rule: 'part_number', evidence: [], extraWords: 0 }
      prev.evidence.push(h)
      byCanon.set(c.id, prev)
    }
    if (byCanon.size) return { rule: 'part_number', words, candidates: [...byCanon.values()], broadCount: 0 }
  }
  if (!words.length) return { rule: 'none', words, candidates: [], broadCount: 0 }
  let ids = null
  for (const w of words) {
    const set = index.wordIndex.get(w)
    if (!set) { ids = new Set(); break }
    ids = ids === null ? new Set(set) : new Set([...ids].filter((id) => set.has(id)))
    if (!ids.size) break
  }
  if (!ids || !ids.size) return { rule: 'none', words, candidates: [], broadCount: 0 }
  if (ids.size > BROAD_LIMIT) return { rule: 'broad', words, candidates: [], broadCount: ids.size }
  const candidates = [...ids].map((id) => {
    const c = index.byId.get(id)
    const extra = [...(index.words.get(id) || [])].filter((w) => !words.includes(w) && !/^[0-9]+$/.test(w)).length
    return { canonical: c, rule: 'words', evidence: [{ field: 'words', value: words.join(' ') }], extraWords: extra }
  }).sort((a, b) => a.extraWords - b.extraWords || String(a.canonical.company_sku || '').localeCompare(String(b.canonical.company_sku || '')))
  return { rule: 'words', words, candidates: candidates.slice(0, MAX_CANDIDATES), broadCount: ids.size }
}

/**
 * Manual rows the cross-reference engine produced no proposal for, each with
 * its exact-rule candidates. `matchedKeys` is the set of `${country}|${partKey}`
 * keys that already have a proposal.
 */
export function buildUnmatchedRows({ entries = [], matchedKeys = new Set(), index }) {
  const out = []
  for (const e of entries) {
    const partKey = normalizePartNo(e?.part_no)
    if (!partKey) continue
    if (matchedKeys.has(`${String(e.country || '').toLowerCase()}|${partKey}`)) continue
    out.push({ entry: e, partKey, ...candidatesForEntry(e, index) })
  }
  const order = { part_number: 0, words: 1, broad: 2, none: 3 }
  return out.sort((a, b) => order[a.rule] - order[b.rule] || a.partKey.localeCompare(b.partKey))
}

export const UNMATCHED_FILTERS = ['all', 'part_number', 'words', 'broad', 'none']

export function filterUnmatched(rows, { rule = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  const qKey = normalizePartNo(search)
  return (rows || []).filter((r) => {
    if (rule !== 'all' && r.rule !== rule) return false
    if (!q) return true
    if (qKey && r.partKey.includes(qKey)) return true
    return `${r.entry.description || ''} ${r.entry.assembly_heading || ''}`.toLowerCase().includes(q)
  })
}

export function summarizeUnmatched(rows) {
  const s = { total: 0, part_number: 0, words: 0, broad: 0, none: 0 }
  for (const r of rows || []) { s.total += 1; s[r.rule] += 1 }
  return s
}
