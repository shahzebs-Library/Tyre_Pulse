/**
 * Brand and part-type PROPOSALS for Material Master items. Pure, no I/O.
 *
 * Nothing here decides anything. Each proposal is shown to a person with the text
 * that triggered it; only an accepted proposal is sent to the server, and it goes
 * through the existing two-person writers (a correction request or a variant
 * proposal), which a second person still has to approve.
 *
 * OWNER RULES (2026-11-23), encoded and tested in src/test/variantClassify.test.js:
 *  - "ORIGINAL", "ORG", "ORG." or "(ORIGINAL)" in the description = genuine (OEM).
 *  - The "-O" suffix on the company SKU is NOT evidence of anything. It is on 3,484
 *    of 3,508 items. This engine never reads the SKU for classification.
 *  - "OEM#:" / "OEM NO" is a part-number LABEL, not a claim the part is genuine.
 *  - LOCAL / CHINA / TAIWAN count only when the word is written. No word = 'not stated'.
 *  - Brand comes only from an explicit brand word in the description, matched against
 *    catalogues that already exist (never a list invented here):
 *      1. brand_aliases (DB table)       alias -> canonical spelling (tyre brands)
 *      2. brands already recorded on Material Master items (the company's own data)
 *      3. the tyre brand catalogue, TYRE_BRANDS in classificationBrain.js (mirror of
 *         the SQL brain_tokens('tyre_brand')), counted ONLY next to a tyre size or the
 *         word tyre/tire, exactly as the expense classifier does. Words such as
 *         "advance", "century" or "formula" are common in part descriptions.
 *  - Spelling variants collapse to one brand: "Doublecoin" and "Double coin" share the
 *    key "doublecoin".
 */
import { TYRE_BRANDS, hasTyreSize } from '../classificationBrain'

/** Part types the review can propose. 'local' cannot be stored yet (see LOCAL_STORABLE). */
export const PART_TYPES = Object.freeze(['genuine', 'oes', 'aftermarket', 'local'])

/** material_variants.part_classification CHECK allows genuine/oes/aftermarket/unknown only. */
export const LOCAL_STORABLE = false

export const RULES = Object.freeze({
  original: 'original',       // ORIGINAL / ORG -> genuine
  oes: 'oes',                 // the word OES -> oes
  local: 'local',             // LOCAL -> local
  origin_country: 'origin_country', // CHINA / CHINESE / TAIWAN -> aftermarket + country
  aftermarket_word: 'aftermarket_word', // AFTERMARKET / AFTER MARKET -> aftermarket
  brand_alias: 'brand_alias',
  brand_recorded: 'brand_recorded',
  brand_tyre: 'brand_tyre',
  conflict: 'conflict',
})

const clean = (v) => {
  const s = String(v ?? '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s || null
}

/** One key per brand regardless of spacing, case, hyphens or dots: "Double coin" = "DOUBLECOIN". */
export function brandKey(v) {
  const s = String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return s || null
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-phrase regex: words may be joined by space, hyphen or nothing ("double coin" = "doublecoin" = "double-coin"). */
function phraseRegex(surface) {
  const words = String(surface).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (!words.length) return null
  return new RegExp(`(^|[^a-z0-9])(${words.map(escapeRe).join('[\\s\\-.]*')})(?=[^a-z0-9]|$)`, 'i')
}

/** The description to classify: the raw ERP text when the import kept it, else the catalogue description. */
export function descriptionOf(item) {
  const specs = item?.specs && typeof item.specs === 'object' ? item.specs : {}
  return clean(specs.original_description) || clean(item?.description)
}

// Short brand words are initialisms (BKT, TVS, MRF), so they stay upper case.
const titleCase = (s) => s.replace(/\S+/g, (w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))

/**
 * Build the brand catalogue from existing sources.
 * aliases: [{ alias, canonical }] (brand_aliases). Aliases shorter than 4 letters are
 *   ignored as match words ("bs", "gy", "ll", "tri") because they also appear inside
 *   part numbers and abbreviations; their canonical spelling still counts.
 * recordedBrands: brand values already on Material Master items.
 * tyreBrands: tyre brand words (defaults to TYRE_BRANDS).
 * Returns { entries: [{ key, display, source, tyreOnly, surfaces, regexes }] }.
 */
export function buildBrandCatalogue({ aliases = [], recordedBrands = [], tyreBrands = TYRE_BRANDS } = {}) {
  const byKey = new Map()
  const add = (surface, display, source, tyreOnly) => {
    const key = brandKey(display)
    const sKey = brandKey(surface)
    if (!key || !sKey || sKey.length < 3) return
    let e = byKey.get(key)
    if (!e) {
      e = { key, display, source, tyreOnly, surfaces: new Set() }
      byKey.set(key, e)
    } else if (!tyreOnly) {
      // A non-tyre source is stronger evidence than a tyre-only word list.
      e.tyreOnly = false
    }
    e.surfaces.add(String(surface).toLowerCase())
  }
  for (const a of aliases) {
    const canonical = clean(a?.canonical)
    const alias = clean(a?.alias)
    if (!canonical) continue
    // brand_aliases holds TYRE brands ("advance", "warrior", "toyo"); like the tyre list, a
    // match counts only in a tyre description unless the company also records the brand on parts.
    add(canonical, canonical, RULES.brand_alias, true)
    if (alias && brandKey(alias).length >= 4) add(alias, canonical, RULES.brand_alias, true)
  }
  // Recorded brands: keep the most common spelling as the display.
  const counts = new Map()
  for (const b of recordedBrands) {
    const v = clean(b)
    if (!v || brandKey(v).length < 3) continue
    const k = brandKey(v)
    const m = counts.get(k) || new Map()
    m.set(v, (m.get(v) || 0) + 1)
    counts.set(k, m)
  }
  for (const [, spellings] of counts) {
    const best = [...spellings.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0]
    if (byKey.has(brandKey(best))) { add(best, byKey.get(brandKey(best)).display, RULES.brand_alias, false); continue }
    for (const s of spellings.keys()) add(s, best, RULES.brand_recorded, false)
  }
  // Tyre brands: prefer the spaced spelling ("double coin") as the display.
  const tyreGroups = new Map()
  for (const t of tyreBrands) {
    const k = brandKey(t)
    if (!k) continue
    const list = tyreGroups.get(k) || []
    list.push(t)
    tyreGroups.set(k, list)
  }
  for (const [k, list] of tyreGroups) {
    const existing = byKey.get(k)
    const display = existing ? existing.display : titleCase(list.find((x) => /\s/.test(x)) || list[0])
    for (const s of list) add(s, display, existing ? existing.source : RULES.brand_tyre, true)
  }
  const entries = [...byKey.values()].map((e) => ({
    ...e,
    surfaces: [...e.surfaces],
    regexes: [...e.surfaces].map(phraseRegex).filter(Boolean),
  }))
  // Longest surface first, so "double coin" wins over a shorter overlapping word.
  entries.sort((a, b) => Math.max(...b.surfaces.map((s) => s.length)) - Math.max(...a.surfaces.map((s) => s.length)) || a.key.localeCompare(b.key))
  return { entries }
}

const TYRE_WORD = /(^|[^a-z])(tyre|tire|tyres|tires)([^a-z]|$)/i
const isTyreContext = (d) => TYRE_WORD.test(d) || hasTyreSize(d)

/**
 * Explicit brand in a description, or null.
 * Returns { value, key, evidence, rule, matches } where matches lists every brand found;
 * two different brands in one description = ambiguous, reported, not proposed.
 */
export function detectBrand(description, catalogue) {
  const d = clean(description)
  if (!d || !catalogue?.entries?.length) return null
  const tyre = isTyreContext(d)
  const found = new Map()
  for (const e of catalogue.entries) {
    if (e.tyreOnly && !tyre) continue
    for (const re of e.regexes) {
      const m = d.match(re)
      if (m) {
        if (!found.has(e.key)) found.set(e.key, { value: e.display, key: e.key, evidence: m[2], rule: e.tyreOnly ? RULES.brand_tyre : e.source })
        break
      }
    }
  }
  if (!found.size) return null
  // Drop a brand whose matched text sits inside another brand's match ("star" inside "double star").
  const list = [...found.values()]
  const kept = list.filter((x) => !list.some((y) => y !== x && y.evidence.length > x.evidence.length && y.evidence.toLowerCase().includes(x.evidence.toLowerCase())))
  if (kept.length > 1) return { value: null, key: null, evidence: kept.map((k) => k.evidence).join(', '), rule: RULES.conflict, matches: kept.map((k) => k.value) }
  return { ...kept[0], matches: [kept[0].value] }
}

const PATTERNS = [
  // ORIGINAL / ORG / ORG. / (ORIGINAL) / (ORG.)  ->  genuine
  { rule: RULES.original, type: 'genuine', re: /(^|[^a-z])(original|org)(\.|[^a-z]|$)/i },
  // the word OES (never OEM#, which labels a part number)
  { rule: RULES.oes, type: 'oes', re: /(^|[^a-z])(oes)([^a-z]|$)/i },
  { rule: RULES.local, type: 'local', re: /(^|[^a-z])(local|locally made)([^a-z]|$)/i },
  { rule: RULES.origin_country, type: 'aftermarket', re: /(^|[^a-z])(china|chinese|taiwan|taiwanese)([^a-z]|$)/i },
  { rule: RULES.aftermarket_word, type: 'aftermarket', re: /(^|[^a-z])(aftermarket|after[\s-]market)([^a-z]|$)/i },
]

const COUNTRY = { china: 'China', chinese: 'China', taiwan: 'Taiwan', taiwanese: 'Taiwan' }

/**
 * Part type stated in a description, or null when nothing is written.
 * Returns { value, rule, evidence, country } ; value null + rule 'conflict' when the
 * text claims two different types (e.g. ORIGINAL and CHINA).
 */
export function detectPartType(description) {
  const d = clean(description)
  if (!d) return null
  const hits = []
  for (const p of PATTERNS) {
    const m = d.match(p.re)
    if (m) hits.push({ value: p.type, rule: p.rule, evidence: m[2], country: COUNTRY[m[2].toLowerCase()] || null })
  }
  if (!hits.length) return null
  const types = [...new Set(hits.map((h) => h.value))]
  if (types.length > 1) return { value: null, rule: RULES.conflict, evidence: hits.map((h) => h.evidence).join(', '), country: null, matches: types }
  const country = hits.find((h) => h.country)?.country || null
  return { ...hits[0], country, evidence: hits.map((h) => h.evidence).join(', '), matches: types }
}

/** Confidence per rule. Only ORIGINAL is 'high' (it is the owner's stated rule). */
export function confidenceOf(rule) {
  if (rule === RULES.original) return 'high'
  if (rule === RULES.conflict) return 'none'
  if (rule === RULES.brand_tyre) return 'medium'
  return 'medium'
}

/**
 * The proposal for one canonical item.
 * item: material_canonical row; variant: its material_variants row (or null);
 * pending: Set of target ids that already have a submitted correction.
 * Returns null when there is nothing to propose.
 */
export function proposeForItem(item, { variant = null, catalogue, pending = new Set() } = {}) {
  if (!item?.id) return null
  const description = descriptionOf(item)
  if (!description) return null
  const out = {
    canonicalId: item.id,
    sku: item.company_sku || null,
    description,
    currentBrand: clean(item.brand),
    variantId: variant?.id || null,
    variantStatus: variant?.status || null,
    currentType: variant?.part_classification || null,
    brand: null,
    partType: null,
  }
  if (!out.currentBrand) {
    const b = detectBrand(description, catalogue)
    if (b) {
      const blocked = b.rule === RULES.conflict ? 'conflict' : pending.has(item.id) ? 'pending' : null
      out.brand = { ...b, confidence: confidenceOf(b.rule), blocked, writer: 'correction_canonical' }
    }
  }
  const knownType = out.currentType && out.currentType !== 'unknown'
  if (!knownType) {
    const p = detectPartType(description)
    if (p) {
      let blocked = null
      if (p.rule === RULES.conflict) blocked = 'conflict'
      else if (p.value === 'local' && !LOCAL_STORABLE) blocked = 'local_not_storable'
      else if (variant?.id && pending.has(variant.id)) blocked = 'pending'
      out.partType = { ...p, confidence: confidenceOf(p.rule), blocked, writer: variant?.id ? 'correction_variant' : 'propose_variant' }
    }
  }
  if (!out.brand && !out.partType) return null
  return out
}

/** All proposals plus per-rule counts. variants: rows from material_variants (one per canonical today). */
export function buildProposals(items = [], { variants = [], catalogue, pending = new Set() } = {}) {
  const byCanon = new Map()
  for (const v of variants) {
    if (!v?.canonical_id) continue
    const prev = byCanon.get(v.canonical_id)
    // Prefer an unknown, still-open variant: that is the record the review would correct.
    if (!prev || (prev.part_classification !== 'unknown' && v.part_classification === 'unknown')) byCanon.set(v.canonical_id, v)
  }
  const rows = []
  for (const it of items) {
    const p = proposeForItem(it, { variant: byCanon.get(it.id) || null, catalogue, pending })
    if (p) rows.push(p)
  }
  return { rows, counts: countByRule(rows) }
}

export function countByRule(rows = []) {
  const c = { brand: {}, partType: {}, total: rows.length, highConfidence: 0 }
  for (const r of rows) {
    if (r.brand) c.brand[r.brand.rule] = (c.brand[r.brand.rule] || 0) + 1
    if (r.partType) c.partType[r.partType.rule] = (c.partType[r.partType.rule] || 0) + 1
    if (isBulkEligible(r)) c.highConfidence += 1
  }
  return c
}

/** The bulk-approve group: an ORIGINAL proposal that can be written today. */
export function isBulkEligible(row) {
  return !!(row?.partType && row.partType.rule === RULES.original && !row.partType.blocked)
}

/** Evidence entry stored with the request, so the approver sees why. */
export function evidenceFor(field, row) {
  const p = field === 'brand' ? row.brand : row.partType
  return [{
    type: 'erp_description',
    text: `ERP description: ${row.description}`,
    matched: p?.evidence || null,
    rule: p?.rule || null,
    source: 'variant review queue',
  }]
}

/**
 * The server call for an accepted proposal. field: 'brand' | 'partType'.
 * Returns { writer, payload } for physicalInventory.requestCorrection / proposeVariant,
 * or null when it cannot be written (blocked).
 */
export function writePlan(row, field) {
  const p = field === 'brand' ? row?.brand : row?.partType
  if (!p || p.blocked || !p.value) return null
  const evidence = evidenceFor(field, row)
  if (field === 'brand') {
    return {
      writer: 'correction',
      payload: {
        target_kind: 'canonical', target_id: row.canonicalId, action: 'field_update', topic: 'brand',
        new_value: { brand: p.value }, evidence,
        reason: `Brand "${p.value}" is written in the description ("${p.evidence}").`,
      },
    }
  }
  const newValue = { part_classification: p.value }
  if (p.country) newValue.country_of_manufacture = p.country
  const reason = `Description says "${p.evidence}" (${p.rule === RULES.original ? 'ORIGINAL/ORG = genuine OEM, owner rule' : 'explicit word'}).`
  if (p.writer === 'correction_variant') {
    return {
      writer: 'correction',
      payload: {
        target_kind: 'variant', target_id: row.variantId, action: 'field_update', topic: 'classification',
        new_value: newValue, evidence, reason,
      },
    }
  }
  return {
    writer: 'propose_variant',
    payload: {
      canonical_id: row.canonicalId, part_classification: p.value,
      country_of_manufacture: p.country || null, brand: row.brand && !row.brand.blocked ? row.brand.value : null,
      evidence,
    },
  }
}

/** Filter rows for the screen. */
export function filterProposals(rows = [], { field = 'all', rule = 'all', confidence = 'all', search = '', hidden = new Set() } = {}) {
  const term = String(search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (hidden.has(r.canonicalId)) return false
    if (field === 'brand' && !r.brand) return false
    if (field === 'partType' && !r.partType) return false
    if (rule !== 'all' && r.brand?.rule !== rule && r.partType?.rule !== rule) return false
    if (confidence !== 'all') {
      const cs = [r.brand?.confidence, r.partType?.confidence]
      if (!cs.includes(confidence)) return false
    }
    if (term && !`${r.sku || ''} ${r.description || ''} ${r.brand?.value || ''}`.toLowerCase().includes(term)) return false
    return true
  })
}
