/**
 * OEM cross-reference proposals (pure, no I/O).
 *
 * Proposes links between parsed OEM parts-manual rows (oem_parts_entries) and
 * company catalogue items (material_canonical). NOTHING here links anything:
 * a proposal only becomes a stored link when a person submits it through the
 * governed inv_compat_propose RPC, and it only becomes an APPROVED link when a
 * second person approves it through inv_compat_decide (the database refuses a
 * proposer approving their own record).
 *
 * The matching rule is deliberately narrow and explainable:
 *  - normalise both sides the same way: uppercase, strip spaces, dashes, dots
 *    and slashes, keep leading zeros;
 *  - a HIGH match is an exact equal against a recorded OEM alias
 *    (material_aliases, alias_type 'oem') or a variant part number
 *    (material_variants.part_number);
 *  - a MEDIUM match is an exact equal against a part-number-looking token
 *    (at least 5 characters and at least one digit) found in the catalogue's
 *    description as imported (specs.original_description);
 *  - one OEM part number matching SEVERAL catalogue items is a CONFLICT and is
 *    never resolved by picking one: it goes to a person;
 *  - there is no fuzzy, prefix or similarity matching of any kind.
 *
 * The link table (oem_part_references.item_id) points at the ERP item
 * (material_master), not at the catalogue item, so every proposal is also
 * resolved to exactly one ERP item in the OEM row's country by item code =
 * company SKU. Zero or several ERP items means the link cannot be proposed yet
 * and the proposal says why.
 */

/** Uppercase; strip spaces, dashes, dots and slashes; keep leading zeros. */
export function normalizePartNo(v) {
  if (v === null || v === undefined) return ''
  return String(v).toUpperCase().replace(/[\s\-./]+/g, '')
}

/** A token that can be a part number: 5+ characters with at least one digit. */
export function isPartNumberToken(key) {
  return typeof key === 'string' && key.length >= 5 && /[0-9]/.test(key)
}

/**
 * Part-number-looking tokens in a free-text description. Each whitespace /
 * punctuation separated word counts whole AND split at its dashes, so both
 * "4110-000-123" and the "60211864" in "LIGHT REAR LH -60211864-SANY" are found.
 * An "OEM#:" / "OEM:" prefix is dropped first.
 */
export function descriptionTokens(text) {
  if (!text) return []
  const out = new Set()
  for (const raw of String(text).split(/[\s,;()[\]]+/)) {
    const word = raw.replace(/^OEM\s*#?\s*:?/i, '')
    if (!word) continue
    for (const part of [word, ...word.split('-')]) {
      const k = normalizePartNo(part)
      if (isPartNumberToken(k)) out.add(k)
    }
  }
  return [...out]
}

export const BANDS = ['high', 'medium']
export const FIELD_BAND = { alias: 'high', variant: 'high', description: 'medium' }

/** key -> [{ canonicalId, field, value, sourceId }] from aliases, variants and catalogue descriptions. */
export function buildMatchIndex({ aliases = [], variants = [], canonicals = [] } = {}) {
  const index = new Map()
  const add = (key, ev) => {
    if (!key || !ev.canonicalId) return
    const list = index.get(key) || []
    if (!list.some((x) => x.canonicalId === ev.canonicalId && x.field === ev.field && x.value === ev.value)) list.push(ev)
    index.set(key, list)
  }
  for (const a of aliases) {
    if (a?.alias_type && a.alias_type !== 'oem') continue
    add(normalizePartNo(a?.value), { canonicalId: a?.canonical_id, field: 'alias', value: a?.value, sourceId: a?.id, verified: a?.verified === true })
  }
  for (const v of variants) {
    add(normalizePartNo(v?.part_number), { canonicalId: v?.canonical_id, field: 'variant', value: v?.part_number, sourceId: v?.id, brand: v?.brand || null })
  }
  for (const c of canonicals) {
    if (c?.status && c.status !== 'active') continue
    for (const k of descriptionTokens(c?.original_description)) {
      add(k, { canonicalId: c?.id, field: 'description', value: c.original_description, sourceId: c?.id })
    }
  }
  return index
}

const keyOf = (country, partKey, itemId) => `${String(country || '').toLowerCase()}|${partKey}|${itemId}`

/** ERP items keyed by normalised item code + lowercase country. */
function erpIndex(erpItems) {
  const m = new Map()
  for (const it of erpItems || []) {
    const k = `${normalizePartNo(it?.item_code)}|${String(it?.country || '').toLowerCase()}`
    const list = m.get(k) || []
    list.push(it)
    m.set(k, list)
  }
  return m
}

/**
 * Resolve a catalogue item to ONE ERP item in the given country.
 * @returns {{ state: 'ok'|'missing'|'ambiguous'|'no_country', item: object|null, count: number }}
 */
export function resolveErpItem(canonical, country, erpByKey) {
  if (!country) return { state: 'no_country', item: null, count: 0 }
  const list = erpByKey.get(`${normalizePartNo(canonical?.company_sku)}|${String(country).toLowerCase()}`) || []
  if (list.length === 1) return { state: 'ok', item: list[0], count: 1 }
  return { state: list.length ? 'ambiguous' : 'missing', item: null, count: list.length }
}

/**
 * Build one proposal per OEM part number (normalised, per country). Manual
 * rows that repeat the same number are grouped under it.
 *
 * Proposal shape:
 *  { key, partKey, partNo, country, entries:[...], kind:'match'|'conflict', band:'high'|'medium'|null,
 *    candidates:[{ canonical, band, evidence:[...], erp:{state,item,count}, reference }] }
 */
export function proposeCrossReferences({ entries = [], aliases = [], variants = [], canonicals = [], erpItems = [], references = [] } = {}) {
  const index = buildMatchIndex({ aliases, variants, canonicals })
  const canonById = new Map(canonicals.map((c) => [c.id, c]))
  const erpByKey = erpIndex(erpItems)
  const refByKey = new Map()
  for (const r of references || []) {
    const k = keyOf(r?.country, normalizePartNo(r?.oem_part_no), r?.item_id)
    const prev = refByKey.get(k)
    // A live link (proposed / approved) outranks a closed one; then the newest.
    const live = (x) => x && (x.status === 'proposed' || x.status === 'approved')
    if (!prev || (live(r) && !live(prev)) || (live(r) === live(prev) && String(r.proposed_at || '') > String(prev.proposed_at || ''))) refByKey.set(k, r)
  }

  const groups = new Map()
  for (const e of entries) {
    const partKey = normalizePartNo(e?.part_no)
    if (!partKey) continue
    const gk = `${String(e.country || '').toLowerCase()}|${partKey}`
    const g = groups.get(gk) || { key: gk, partKey, partNo: e.part_no, country: e.country || null, entries: [] }
    g.entries.push(e)
    groups.set(gk, g)
  }

  const out = []
  for (const g of groups.values()) {
    const hits = index.get(g.partKey)
    if (!hits?.length) continue
    const byCanon = new Map()
    for (const h of hits) {
      const canonical = canonById.get(h.canonicalId)
      if (!canonical) continue
      const list = byCanon.get(h.canonicalId) || []
      list.push(h)
      byCanon.set(h.canonicalId, list)
    }
    if (!byCanon.size) continue
    const candidates = [...byCanon.entries()].map(([id, evidence]) => {
      const canonical = canonById.get(id)
      const band = evidence.some((x) => FIELD_BAND[x.field] === 'high') ? 'high' : 'medium'
      const erp = resolveErpItem(canonical, g.country, erpByKey)
      const reference = erp.item ? refByKey.get(keyOf(g.country, g.partKey, erp.item.id)) || null : null
      return { canonical, band, evidence, erp, reference }
    }).sort((a, b) => String(a.canonical.company_sku || '').localeCompare(String(b.canonical.company_sku || '')))
    const conflict = candidates.length > 1
    out.push({
      ...g,
      kind: conflict ? 'conflict' : 'match',
      band: conflict ? null : candidates[0].band,
      candidates,
    })
  }
  return out.sort((a, b) => a.partKey.localeCompare(b.partKey) || String(a.country || '').localeCompare(String(b.country || '')))
}

/** Where a proposal stands, for filtering and the status pill. */
export function proposalStatus(p) {
  if (p.kind === 'conflict') return 'conflict'
  const c = p.candidates[0]
  if (c.reference?.status === 'approved') return 'approved'
  if (c.reference?.status === 'proposed') return 'awaiting'
  if (c.reference?.status === 'rejected') return 'rejected'
  if (c.erp.state !== 'ok') return 'no_erp'
  return 'open'
}

export const STATUS_FILTERS = ['all', 'open', 'awaiting', 'approved', 'rejected', 'conflict', 'no_erp']
export const BAND_FILTERS = ['all', 'high', 'medium']

export function filterProposals(list, { band = 'all', status = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  const qKey = normalizePartNo(search)
  return (list || []).filter((p) => {
    if (band !== 'all' && p.band !== band) return false
    if (status !== 'all' && proposalStatus(p) !== status) return false
    if (!q) return true
    if (qKey && p.partKey.includes(qKey)) return true
    const hay = [
      ...p.entries.map((e) => `${e.description || ''} ${e.assembly_heading || ''}`),
      ...p.candidates.map((c) => `${c.canonical.company_sku || ''} ${c.canonical.description || ''} ${c.canonical.brand || ''}`),
    ].join(' ').toLowerCase()
    return hay.includes(q)
  })
}

export function summarizeProposals(list) {
  const s = { total: 0, high: 0, medium: 0, conflict: 0, open: 0, awaiting: 0, approved: 0, rejected: 0, no_erp: 0, manualRows: 0 }
  for (const p of list || []) {
    s.total += 1
    s.manualRows += p.entries.length
    if (p.kind === 'conflict') { s.conflict += 1; continue }
    s[p.band] += 1
    s[proposalStatus(p)] += 1
  }
  return s
}

/**
 * The payload inv_compat_propose stores. Evidence names the manual rows and the
 * catalogue field that matched, so an approver can check it without re-running
 * the match.
 */
export function buildProposePayload(p, candidate = p.candidates[0]) {
  if (!candidate?.erp?.item) throw new Error('This proposal has no single ERP item to link to.')
  const first = p.entries[0] || {}
  return {
    kind: 'oem',
    item_id: candidate.erp.item.id,
    oem_part_no: String(p.partNo || '').trim(),
    manufacturer: first.manual?.manufacturer || null,
    country: p.country || null,
    oem_entry_id: first.id || null,
    source: 'oem_crossref_review',
    evidence: [
      ...p.entries.map((e) => ({
        type: 'oem_manual_entry', entry_id: e.id, manual_id: e.manual_id || null, pdf_page: e.source_pdf_page ?? null,
        part_no: e.part_no, description: e.description || null,
      })),
      ...candidate.evidence.map((x) => ({
        type: `catalogue_${x.field}`, canonical_id: candidate.canonical.id, company_sku: candidate.canonical.company_sku || null,
        matched_value: x.value || null, band: FIELD_BAND[x.field],
      })),
    ],
  }
}
