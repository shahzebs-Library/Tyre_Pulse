/**
 * Warehouse data-quality reads (READ ONLY).
 *
 *   loadUnmatchedReview(scope)  - unlinked stock lines + proposed matches
 *   loadStockReconcile(scope)   - ledger vs balance and the other checks
 *
 * Nothing here writes. The stock line's `item_id` has no safe server writer
 * today (stock_records refuses direct writes from signed-in users, and none of
 * inv_material_link_item / stock_entry_resolve / save_stock_entry sets it), so
 * confirming a match is a database change proposed in
 * docs/warehouse/07_UNMATCHED_LINK_DB_CHANGES.md and not applied.
 *
 * Every read is bounded: full reads page with an `id` tiebreak and a `max`
 * ceiling and report `truncated`; lookups are chunked `.in()` lists or carry a
 * `.limit()` under the PostgREST cap. Row security decides what each user sees.
 */
import { supabase, toServiceError, fetchAllPages, applyCountry, isNotProvisioned } from './_client'
import { mapSettled, settledValue } from '../concurrency'
import {
  buildUnmatchedReview, reconcileStock, foldLedger, stockLineCode, parseTyreSize, sizeSearchPattern,
} from '../inventory/stockReconcile'

const STOCK_COLS = 'id, organisation_id, country, site, description, brand, tyre_size, item_id, qty_on_hand, stock_qty, qty_reserved, valued_qty, unvalued_qty, custom_data'
const READ_MAX = 20000
const CHUNK = 200
/** Chunked reads in flight at once; results are always folded in chunk order. */
const CHUNK_CONCURRENCY = 4

const chunks = (arr, n = CHUNK) => {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

const scoped = (q, scope) => {
  let query = applyCountry(q, scope?.country)
  if (scope?.site) query = query.eq('site', scope.site)
  return query
}

/** Lean stock lines in scope, paged with an id tiebreak. */
async function readStockLines(scope, { onlyUnlinked = false } = {}) {
  const { data, error, truncated } = await fetchAllPages((from, to) => {
    let q = supabase.from('stock_records').select(STOCK_COLS)
    if (onlyUnlinked) q = q.is('item_id', null)
    return scoped(q, scope).order('id').range(from, to)
  }, { max: READ_MAX })
  if (error) throw toServiceError(error, 'Could not read stock lines.')
  return { rows: data || [], truncated }
}

/**
 * Ledger totals per stock line: qty, reserved and movement count. One paged
 * read of the movements in scope (5,619 rows on 2026-11-24) with an id
 * tiebreak and a ceiling, instead of hundreds of per-line lookups.
 */
async function readLedger(scope) {
  const { data, error, truncated } = await fetchAllPages((from, to) => applyCountry(supabase
    .from('stock_movements')
    .select('id, stock_id, qty_change, reserved_change'), scope?.country)
    .order('id')
    .range(from, to), { max: 100000 })
  if (error) throw toServiceError(error, 'Could not read the stock ledger.')
  return { map: foldLedger(data || []), truncated }
}

/** Material Master ids that carry a catalogue link, for the given item ids. */
async function readCatalogueLinked(itemIds) {
  const set = new Set()
  // Read the chunks together, then apply the SAME rules in chunk order as the
  // old one-at-a-time loop: the first failing chunk decides (not provisioned
  // -> null, anything else -> error), so the outcome is unchanged.
  const results = await mapSettled(chunks(itemIds), CHUNK_CONCURRENCY, (ids) =>
    supabase.from('material_canonical_items').select('item_id').in('item_id', ids).limit(CHUNK))
  for (const entry of results) {
    const { data, error } = settledValue(entry)
    if (error) {
      if (isNotProvisioned(error)) return null
      throw toServiceError(error, 'Could not read catalogue links.')
    }
    for (const r of data || []) set.add(r.item_id)
  }
  return set
}

/** Every Material Master id with a catalogue link, in one paged read. */
async function readAllCatalogueLinked() {
  const { data, error } = await fetchAllPages((from, to) => supabase
    .from('material_canonical_items')
    .select('id, item_id')
    .order('id')
    .range(from, to), { max: 100000 })
  if (error) {
    if (isNotProvisioned(error)) return null
    throw toServiceError(error, 'Could not read catalogue links.')
  }
  return new Set((data || []).map((r) => r.item_id))
}

export async function loadStockReconcile(scope = {}) {
  const [{ rows, truncated }, ledger, catalogueItemIds] = await Promise.all([
    readStockLines(scope),
    readLedger(scope),
    // A failed catalogue read skips that one check; it never blocks the rest.
    readAllCatalogueLinked().catch(() => null),
  ])
  const result = reconcileStock(rows, { ledger: ledger.map, reservedKnown: true, catalogueItemIds })
  return { ...result, truncated: truncated || ledger.truncated, generatedAt: new Date().toISOString() }
}

/* ------------------------------------------------------------------ */

async function readItemsByCode(codes) {
  const out = []
  const variants = [...new Set(codes.flatMap((c) => [c, c.toLowerCase()]))]
  const results = await mapSettled(chunks(variants), CHUNK_CONCURRENCY, (part) =>
    supabase.from('material_master')
      .select('id, organisation_id, country, item_code, item_name, brand')
      .in('item_code', part)
      .limit(500))
  for (const entry of results) {
    const { data, error } = settledValue(entry)
    if (error) throw toServiceError(error, 'Could not read Material Master.')
    out.push(...(data || []))
  }
  return out
}

/** Catalogue rows that name a tyre size, from material_master and material_canonical. */
async function readTyreCandidates(sizes, countries) {
  const out = []
  for (const size of sizes) {
    const pattern = sizeSearchPattern(size)
    if (!pattern) continue
    let mm = supabase.from('material_master')
      .select('id, organisation_id, country, item_code, item_name, brand')
      .ilike('item_name', pattern)
    if (countries.length === 1) mm = mm.eq('country', countries[0])
    const [a, b] = await Promise.all([
      mm.limit(80),
      supabase.from('material_canonical')
        .select('id, organisation_id, company_sku, description, brand')
        .eq('status', 'active')
        .ilike('description', pattern)
        .limit(80),
    ])
    if (a.error) throw toServiceError(a.error, 'Could not read Material Master.')
    out.push(...(a.data || []).map((r) => ({ ...r, source: 'material_master' })))
    if (b.error && !isNotProvisioned(b.error)) throw toServiceError(b.error, 'Could not read the catalogue.')
    out.push(...(b.data || []).map((r) => ({ ...r, source: 'material_canonical' })))
  }
  return out
}

export async function loadUnmatchedReview(scope = {}) {
  const { rows, truncated } = await readStockLines(scope, { onlyUnlinked: true })
  const codes = [...new Set(rows.map(stockLineCode).filter(Boolean))]
  const noCode = rows.filter((r) => !stockLineCode(r))
  const sizes = [...new Set(noCode.map((r) => parseTyreSize(r.tyre_size) || parseTyreSize(r.description)).filter(Boolean))]
  const countries = [...new Set(rows.map((r) => r.country).filter(Boolean))]
  const [mmByCode, tyreCandidates] = await Promise.all([
    codes.length ? readItemsByCode(codes) : [],
    sizes.length ? readTyreCandidates(sizes, countries) : [],
  ])
  // Which proposed ERP items already have a catalogue link (shown, not required).
  const linked = await readCatalogueLinked([...new Set([...mmByCode, ...tyreCandidates]
    .filter((c) => c.source !== 'material_canonical' && c.id).map((c) => c.id))]).catch(() => null)
  const mark = (c) => ({ ...c, linked: linked ? linked.has(c.id) : null })
  const review = buildUnmatchedReview(rows, {
    mmByCode: mmByCode.map(mark),
    tyreCandidates: tyreCandidates.map((c) => (c.source === 'material_canonical' ? c : mark(c))),
  })
  return { ...review, truncated, writerAvailable: false, generatedAt: new Date().toISOString() }
}
