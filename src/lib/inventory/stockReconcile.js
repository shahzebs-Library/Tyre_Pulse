/**
 * Warehouse data-quality engine (pure, no I/O).
 *
 * Two jobs:
 *
 *   1. UNMATCHED STOCK ITEMS. A stock line whose `item_id` is empty cannot reach
 *      Material Master, consumption or cost. For each such line we PROPOSE a
 *      match and never apply one:
 *        - a line that carries an item code (quick entry keeps it in
 *          custom_data.stock_item.code) is matched EXACTLY on country + code;
 *        - a line with no code but a tyre size in its description gets
 *          SUGGESTIONS from the catalogue filtered by the same tyre size and
 *          ranked by brand alias tokens. These are suggestions only: the owner
 *          rule is that no fuzzy match is ever written to production
 *          automatically. A person must confirm.
 *
 *   2. STOCK RECONCILIATION. Ledger (sum of stock_movements.qty_change) against
 *      the balance (qty_on_hand), the legacy stock_qty column against
 *      qty_on_hand, quantity with no ledger, reserved quantity against the
 *      reservation ledger, negative stock, unvalued quantity and unlinked lines.
 *      Each check returns its count and the rows behind it.
 *
 * Every function takes plain arrays so it can be tested without a database.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const num0 = (v) => num(v) ?? 0
const clean = (s) => String(s ?? '').trim()
const upper = (s) => clean(s).toUpperCase()
/** Letters and digits only, upper case: "Double coin" and "DOUBLECOIN" compare equal. */
export const compact = (s) => upper(s).replace(/[^A-Z0-9]/g, '')

/* ------------------------------------------------------------------ */
/* Tyre size                                                           */
/* ------------------------------------------------------------------ */

/**
 * Pull a normalised tyre size out of free text. Returns null when the text
 * names no recognisable size, so a non-tyre line is never matched by size.
 *
 *   "315/80 R22.5", "315/80R22.5", "315-80R22.5"  -> "315/80R22.5"
 *   "23.5 R25", "23.5.R.25"                         -> "23.5R25"
 *   "195R15", "11R22.5", "7.00 R16", "9.00R20"     -> "195R15" ...
 *   "10-16.5"                                       -> "10-16.5"
 */
export function parseTyreSize(text) {
  const s = upper(text)
  if (!s) return null
  let m = s.match(/(?<![0-9.])(\d{3})\s*[/-]\s*(\d{2})\s*(?:Z?R|-)?\s*-?\s*(\d{2}(?:\.\d)?)(?![0-9])/)
  if (m) return `${m[1]}/${m[2]}R${m[3]}`
  m = s.match(/(?<![0-9.])(\d{1,2}\.\d{1,2})\s*\.?\s*R\s*\.?\s*(\d{2}(?:\.\d)?)(?![0-9])/)
  if (m) return `${m[1]}R${m[2]}`
  m = s.match(/(?<![0-9./])(\d{2,3})\s*R\s*(\d{2}(?:\.\d)?)(?![0-9])/)
  if (m) return `${m[1]}R${m[2]}`
  m = s.match(/(?<![0-9./])(\d{1,2})-(\d{2}\.\d)(?![0-9])/)
  if (m) return `${m[1]}-${m[2]}`
  return null
}

/**
 * The catalogue search pattern for a size: every number in order, joined by
 * `%`, so "315/80 R22.5" and "315-80R22.5" in the catalogue are both found.
 * The caller still filters the results through parseTyreSize, so the loose
 * pattern can only widen the candidate list, never decide a match.
 */
export function sizeSearchPattern(size) {
  const parts = String(size || '').match(/\d+(?:\.\d+)?/g)
  if (!parts || !parts.length) return null
  return `%${parts.join('%')}%`
}

/* ------------------------------------------------------------------ */
/* Brand aliases                                                       */
/* ------------------------------------------------------------------ */

/**
 * Brand spellings seen in this fleet's data, folded to one canonical name.
 * Compared after compact(), so spacing, hyphens and case never matter.
 * Deliberately short: an alias that is too loose ("HANK") would suggest the
 * wrong brand, and a wrong suggestion costs more than a missing one.
 */
export const BRAND_ALIASES = {
  DOUBLECOIN: 'DOUBLE COIN',
  DOUBLECOINRR: 'DOUBLE COIN',
  ERACLE: 'ERACLE',
  TECHKING: 'TECHKING',
  BRIDGESTONE: 'BRIDGESTONE',
  HANKOOK: 'HANKOOK',
  MICHELIN: 'MICHELIN',
  TRIANGLE: 'TRIANGLE',
  LINGLONG: 'LING LONG',
  PIRELLI: 'PIRELLI',
  TEGRYS: 'TEGRYS',
  SAILUN: 'SAILUN',
  ROADX: 'ROADX',
  LONGMARCH: 'LONGMARCH',
  CONTINENTAL: 'CONTINENTAL',
  GOODYEAR: 'GOODYEAR',
  YOKOHAMA: 'YOKOHAMA',
  DUNLOP: 'DUNLOP',
  INFINITY: 'INFINITY',
  ALLIANCE: 'ALLIANCE',
}

/** Canonical brands named anywhere in the given texts (description, brand field). */
export function brandTokens(...texts) {
  const hay = texts.map(compact).join('|')
  const out = new Set()
  if (!hay) return []
  for (const [alias, canonical] of Object.entries(BRAND_ALIASES)) {
    if (hay.includes(alias)) out.add(canonical)
  }
  return [...out]
}

/* ------------------------------------------------------------------ */
/* Unmatched stock items                                               */
/* ------------------------------------------------------------------ */

/** The item code a quick-entry stock line carries, or ''. */
export function stockLineCode(row) {
  const cd = row?.custom_data
  const code = cd && typeof cd === 'object' ? cd.stock_item?.code : null
  return upper(code)
}

/** Demo / test data is reported separately so it is never confused with real stock. */
export function isDemoLine(row) {
  return /\bDEMO\b/.test([row?.site, row?.brand, row?.description].map(upper).join(' '))
}

export const UNMATCHED_KINDS = {
  code_exact: 'Exact code match found',
  code_missing: 'Code not found in Material Master',
  code_ambiguous: 'Code matches more than one item',
  no_code_suggest: 'No code: suggestions by tyre size and brand',
  no_code_none: 'No code and no usable size',
}

/**
 * Exact-code proposal. `items` are material_master rows ({id, item_code,
 * item_name, country, organisation_id, brand}). Only the same country and the
 * same organisation count: the same code in another country is usually a
 * different item.
 */
export function exactCodeProposal(row, items) {
  const code = stockLineCode(row)
  if (!code) return { kind: null, candidates: [] }
  const hits = (items || []).filter((m) => upper(m.item_code) === code
    && (!row.country || !m.country || m.country === row.country)
    && (!row.organisation_id || !m.organisation_id || m.organisation_id === row.organisation_id))
  if (!hits.length) return { kind: 'code_missing', candidates: [] }
  return {
    kind: hits.length === 1 ? 'code_exact' : 'code_ambiguous',
    candidates: hits.map((m) => ({ ...m, source: 'material_master', score: 100, reasons: ['Same item code and country'] })),
  }
}

/**
 * Size + brand suggestions for a line with no code. `candidates` are catalogue
 * rows from material_master ({item_code, item_name, brand}) and
 * material_canonical ({company_sku, description, brand}); both shapes are
 * accepted. A candidate must name the SAME tyre size; brand only ranks.
 */
export function tyreSuggestions(row, candidates, { limit = 5 } = {}) {
  const size = parseTyreSize(row?.tyre_size) || parseTyreSize(row?.description)
  if (!size) return { size: null, brands: [], suggestions: [] }
  const brands = brandTokens(row?.description, row?.brand)
  const seen = new Set()
  const out = []
  for (const c of candidates || []) {
    const code = upper(c.item_code ?? c.company_sku)
    const name = clean(c.item_name ?? c.description)
    if (c.country && row.country && c.country !== row.country) continue
    if (c.organisation_id && row.organisation_id && c.organisation_id !== row.organisation_id) continue
    if (parseTyreSize(name) !== size) continue
    const key = `${c.source || (c.company_sku ? 'material_canonical' : 'material_master')}|${code}`
    if (seen.has(key)) continue
    seen.add(key)
    const cBrands = brandTokens(name, c.brand)
    const shared = brands.filter((b) => cBrands.includes(b))
    const reasons = [`Same tyre size ${size}`]
    let score = 50
    if (shared.length) { score += 40; reasons.push(`Same brand ${shared.join(', ')}`) } else if (brands.length && cBrands.length) {
      score -= 30; reasons.push(`Different brand (${cBrands.join(', ')})`)
    } else if (!brands.length) reasons.push('Brand not stated on the stock line')
    else reasons.push('Brand not stated on the catalogue item')
    out.push({
      id: c.id, code, name, brand: c.brand || cBrands[0] || null, country: c.country || null,
      source: c.source || (c.company_sku !== undefined ? 'material_canonical' : 'material_master'),
      linked: c.linked ?? null, score, reasons,
    })
  }
  out.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
  return { size, brands, suggestions: out.slice(0, limit) }
}

/**
 * Build the review list for unlinked stock lines (item_id empty).
 * `mmByCode`: material_master rows found for the lines' codes.
 * `tyreCandidates`: catalogue rows found by size pattern.
 */
export function buildUnmatchedReview(stockRows, { mmByCode = [], tyreCandidates = [] } = {}) {
  const rows = (stockRows || []).filter((r) => !r.item_id).map((r) => {
    const code = stockLineCode(r)
    const demo = isDemoLine(r)
    if (code) {
      const p = exactCodeProposal(r, mmByCode)
      return { ...r, code, demo, kind: p.kind, size: parseTyreSize(r.tyre_size) || parseTyreSize(r.description), candidates: p.candidates }
    }
    const t = tyreSuggestions(r, tyreCandidates)
    return { ...r, code: '', demo, kind: t.suggestions.length ? 'no_code_suggest' : 'no_code_none', size: t.size, brands: t.brands, candidates: t.suggestions }
  })
  rows.sort((a, b) => Number(a.demo) - Number(b.demo) || String(a.kind).localeCompare(String(b.kind))
    || clean(a.site).localeCompare(clean(b.site)) || clean(a.description).localeCompare(clean(b.description)))
  const summary = { total: rows.length, real: 0, demo: 0, withCode: 0, noCode: 0 }
  for (const k of Object.keys(UNMATCHED_KINDS)) summary[k] = 0
  for (const r of rows) {
    if (r.demo) summary.demo += 1; else summary.real += 1
    if (r.code) summary.withCode += 1; else summary.noCode += 1
    if (r.kind) summary[r.kind] += 1
  }
  return { rows, summary }
}

/** Excel rows for the review list: one row per stock line, best proposal only. */
export function unmatchedExportRows(rows) {
  return (rows || []).map((r) => {
    const best = r.candidates?.[0]
    return {
      stock_id: r.id, country: r.country || '', site: r.site || '', description: r.description || '',
      code: r.code || '', size: r.size || '', qty_on_hand: num(r.qty_on_hand),
      data: r.demo ? 'Demo' : 'Real', finding: UNMATCHED_KINDS[r.kind] || '',
      proposed_code: best?.code || '', proposed_name: best?.name || best?.item_name || '',
      proposed_source: best?.source || '', basis: (best?.reasons || []).join('; '),
      status: 'Proposal only, not applied',
    }
  })
}

/* ------------------------------------------------------------------ */
/* Stock reconciliation                                                */
/* ------------------------------------------------------------------ */

export const RECONCILE_CHECKS = [
  { key: 'ledger_drift', label: 'Ledger differs from balance', tone: 'bad',
    help: 'The sum of posted movements is not equal to the quantity on hand.' },
  { key: 'stock_qty_diff', label: 'Old stock quantity differs', tone: 'warning',
    help: 'The legacy stock quantity column is not equal to the quantity on hand.' },
  { key: 'qty_no_ledger', label: 'Quantity with no movements', tone: 'bad',
    help: 'The line holds quantity but no movement was ever posted for it.' },
  { key: 'reserved_mismatch', label: 'Reserved quantity differs', tone: 'warning',
    help: 'Reserved quantity is not equal to the sum of reservation movements, or exceeds the quantity on hand.' },
  { key: 'negative', label: 'Negative stock', tone: 'bad',
    help: 'Quantity on hand is below zero.' },
  { key: 'unvalued', label: 'Quantity without a value', tone: 'warning',
    help: 'Part or all of the quantity on hand carries no cost.' },
  { key: 'unlinked', label: 'Not linked to Material Master', tone: 'warning',
    help: 'The line has no Material Master item.' },
  { key: 'not_in_catalogue', label: 'Item not in the governed catalogue', tone: 'muted',
    help: 'The Material Master item has no catalogue link.' },
]

/**
 * Run every check.
 *   stockRows: stock_records lean rows
 *   ledger:    Map(stock_id -> { qty, count, reserved }) built from the ledger.
 *              A stock id absent from the map has NO movements at all.
 *   reservedKnown: whether `reserved` in the ledger map is trustworthy.
 *   catalogueItemIds: Set of material_master ids that have a catalogue link,
 *              or null when it could not be read (the check is then skipped).
 */
export function reconcileStock(stockRows, { ledger = new Map(), reservedKnown = true, catalogueItemIds = null } = {}) {
  const buckets = Object.fromEntries(RECONCILE_CHECKS.map((c) => [c.key, []]))
  for (const r of stockRows || []) {
    const onHand = num0(r.qty_on_hand)
    const l = ledger.get(r.id)
    const ledgerQty = l ? num0(l.qty) : 0
    const base = { ...r, ledger_qty: ledgerQty, movement_count: l ? l.count : 0 }
    if (Math.abs(ledgerQty - onHand) > 1e-9) buckets.ledger_drift.push({ ...base, difference: onHand - ledgerQty })
    const legacy = num(r.stock_qty)
    if ((legacy ?? 0) !== onHand) buckets.stock_qty_diff.push({ ...base, difference: onHand - (legacy ?? 0) })
    if (onHand !== 0 && !l) buckets.qty_no_ledger.push(base)
    const reserved = num0(r.qty_reserved)
    const ledgerReserved = l ? num0(l.reserved) : 0
    if ((reservedKnown && Math.abs(reserved - ledgerReserved) > 1e-9) || (reserved > 0 && reserved > onHand)) {
      buckets.reserved_mismatch.push({ ...base, ledger_reserved: reservedKnown ? ledgerReserved : null, difference: reserved - ledgerReserved })
    }
    if (onHand < 0) buckets.negative.push(base)
    if (num0(r.unvalued_qty) > 0) buckets.unvalued.push(base)
    if (!r.item_id) buckets.unlinked.push(base)
    else if (catalogueItemIds && !catalogueItemIds.has(r.item_id)) buckets.not_in_catalogue.push(base)
  }
  return {
    total: (stockRows || []).length,
    checks: RECONCILE_CHECKS.map((c) => ({
      ...c,
      skipped: c.key === 'not_in_catalogue' && !catalogueItemIds,
      count: buckets[c.key].length,
      rows: buckets[c.key],
    })),
  }
}

/** Fold ledger rows ({stock_id, qty_change, reserved_change}) into the ledger map. */
export function foldLedger(movements, map = new Map()) {
  for (const m of movements || []) {
    if (!m?.stock_id) continue
    const cur = map.get(m.stock_id) || { qty: 0, count: 0, reserved: 0 }
    cur.qty += num0(m.qty_change)
    cur.reserved += num0(m.reserved_change)
    cur.count += num0(m.movement_count ?? 1)
    map.set(m.stock_id, cur)
  }
  return map
}

/** Excel rows for one check's drill-down. */
export function reconcileExportRows(check) {
  return (check?.rows || []).map((r) => ({
    check: check.label, stock_id: r.id, country: r.country || '', site: r.site || '', description: r.description || '',
    qty_on_hand: num(r.qty_on_hand), ledger_qty: num(r.ledger_qty), stock_qty: num(r.stock_qty),
    qty_reserved: num(r.qty_reserved), ledger_reserved: num(r.ledger_reserved), unvalued_qty: num(r.unvalued_qty),
    movements: num(r.movement_count), difference: num(r.difference), demo: isDemoLine(r) ? 'Demo' : 'Real',
  }))
}
