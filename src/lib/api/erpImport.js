/**
 * ERP Data Import service - the seam between the ErpImport page and the review
 * (staging) tables (V277: erp_asset_import / erp_tyre_change_import /
 * erp_tyre_expense_import). Rows are SAVED here for cross-checking BEFORE any
 * promotion into the master tables; promotion is a deliberate, separate step
 * (the server pipeline), never a side effect of the upload.
 *
 * RLS enforces org isolation (read for any active member; write for
 * Admin/Manager/Director) plus country + site scoping. This layer keeps an
 * explicit least-privilege column list per dataset and degrades to [] when a
 * table is missing so the page can prompt for the migration rather than throw.
 *
 * Production m3 is NOT handled here - it loads into the live production_logs
 * table via src/lib/api/production.js (createProduction), reused by the page.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'
import { DATASETS } from '../erpImport'

/** Dataset key -> staging table name (production is intentionally excluded). */
const TABLE = {
  asset: 'erp_asset_import',
  change: 'erp_tyre_change_import',
  expense: 'erp_tyre_expense_import',
}

/** Column keys persisted per dataset (excludes generated id/created_at). */
const WRITE_COLS = {
  asset: DATASETS.asset.columns.map((c) => c.key),
  change: DATASETS.change.columns.map((c) => c.key),
  expense: DATASETS.expense.columns.map((c) => c.key),
}

/** Full column projection per dataset (for reads). */
const SELECT_COLS = {
  asset: `id,organisation_id,country,batch_id,source_row,${WRITE_COLS.asset.join(',')},created_by,created_at`,
  change: `id,organisation_id,country,batch_id,source_row,${WRITE_COLS.change.join(',')},created_by,created_at`,
  expense: `id,organisation_id,country,batch_id,source_row,${WRITE_COLS.expense.join(',')},created_by,created_at`,
}

const MAX_SAVE_ROWS = 20000
const INSERT_CHUNK = 1000

function tableFor(dataset) {
  const t = TABLE[dataset]
  if (!t) throw new Error('Unknown import dataset.')
  return t
}

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const m = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
    m.includes('does not exist') ||
    m.includes('could not find the table') ||
    m.includes('schema cache') ||
    m.includes('relation')
  )
}

/**
 * List saved import batches for a dataset (newest first). Groups the staging
 * rows by batch_id and returns { batch_id, created_at, count, country }.
 * Degrades to [] when the table is missing.
 * @param {'asset'|'change'|'expense'} dataset
 * @param {{ country?:string }} [opts]
 */
export async function listImportBatches(dataset, { country } = {}) {
  const table = tableFor(dataset)
  const pageFn = (pFrom, pTo) => {
    let q = supabase.from(table).select('batch_id,created_at,country')
    q = applyCountry(q, country)
    return q.order('created_at', { ascending: false }).range(pFrom, pTo)
  }
  try {
    const { data, error } = await fetchAllPages(pageFn, { pageSize: 1000, max: 100000 })
    if (error) throw error
    const byBatch = new Map()
    for (const r of data || []) {
      const id = r?.batch_id
      if (!id) continue
      const cur = byBatch.get(id)
      if (cur) { cur.count += 1 }
      else byBatch.set(id, { batch_id: id, created_at: r.created_at, country: r.country || null, count: 1 })
    }
    return [...byBatch.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * List the saved rows of one batch (or the most recent rows when no batch_id).
 * Degrades to [] when the table is missing.
 * @param {'asset'|'change'|'expense'} dataset
 * @param {{ batch_id?:string, country?:string, limit?:number }} [opts]
 */
export async function listImportRows(dataset, { batch_id, country, limit = 20000 } = {}) {
  const table = tableFor(dataset)
  const pageFn = (pFrom, pTo) => {
    let q = supabase.from(table).select(SELECT_COLS[dataset])
    q = applyCountry(q, country)
    if (batch_id) q = q.eq('batch_id', batch_id)
    return q.order('source_row', { ascending: true }).range(pFrom, pTo)
  }
  try {
    const { data, error } = await fetchAllPages(pageFn, { pageSize: 1000, max: limit })
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Save mapped rows into the dataset's staging table under one batch_id. Rows
 * are whitelisted to the dataset columns + source_row + country + batch_id
 * (organisation_id / created_by / id / created_at come from DB defaults). Rows
 * above MAX_SAVE_ROWS are dropped and reported so nothing is silently truncated.
 *
 * @param {'asset'|'change'|'expense'} dataset
 * @param {Array<Record<string,*>>} rows  mapped rows (mapSheetToRows output)
 * @param {string} batch_id  uuid for this upload
 * @param {{ country?:string }} [opts]
 * @returns {Promise<{ saved:number, requested:number, capped:number, batch_id:string }>}
 */
export async function saveImportRows(dataset, rows, batch_id, { country } = {}) {
  const table = tableFor(dataset)
  if (!batch_id) throw new Error('A batch id is required.')
  const src = Array.isArray(rows) ? rows : []
  const requested = src.length
  const capped = Math.max(0, requested - MAX_SAVE_ROWS)
  const kept = src.slice(0, MAX_SAVE_ROWS)
  const cols = WRITE_COLS[dataset]
  const scopedCountry = country && country !== 'All' ? country : null

  const payload = kept.map((r, i) => {
    const out = {
      batch_id,
      source_row: Number.isFinite(Number(r?.source_row)) ? Number(r.source_row) : i + 1,
      country: scopedCountry,
    }
    for (const k of cols) out[k] = r?.[k] ?? null
    return out
  })

  let saved = 0
  for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
    const chunk = payload.slice(i, i + INSERT_CHUNK)
    unwrap(await supabase.from(table).insert(chunk))
    saved += chunk.length
  }
  return { saved, requested, capped, batch_id }
}

/**
 * Delete every row of one batch (revert a bad upload).
 * @param {'asset'|'change'|'expense'} dataset
 * @param {string} batch_id
 */
export async function deleteImportBatch(dataset, batch_id) {
  const table = tableFor(dataset)
  if (!batch_id) throw new Error('A batch id is required.')
  return unwrap(await supabase.from(table).delete().eq('batch_id', batch_id))
}
