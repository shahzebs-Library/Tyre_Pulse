/**
 * Parts Consumption (maintenance/parts expense) service - reads/writes for the in-app
 * Expense Import (src/pages/ExpenseImport.jsx) and Expense Report (src/pages/ExpenseReport.jsx).
 *
 * Rows land in public.parts_consumption; the DB trigger classify_parts_consumption()
 * derives line_cost + cost_category + tyre/spare/oil split authoritatively, so the
 * client only ever sends the raw grid columns. Inserts are chunked with in-line retry
 * (weak-signal / proxy friendly, mirrors erpImport.saveImportRows).
 *
 * @module api/partsConsumption
 */
import { supabase } from './_client'
import { PARTS_FIELDS } from '../partsExpense'

const INSERT_CHUNK = 400
const MAX_ATTEMPTS = 5
const BASE_BACKOFF_MS = 800

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Count of rows currently stored (org-scoped by RLS). */
export async function countPartsConsumption() {
  const { count, error } = await supabase
    .from('parts_consumption').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

/** Delete every row in this org's parts_consumption (used before a clean re-import). */
export async function clearPartsConsumption() {
  const { error } = await supabase
    .from('parts_consumption').delete().not('id', 'is', null)
  if (error) throw error
  return true
}

/**
 * Insert parsed grid rows in resilient chunks. Each row is projected to the raw
 * PARTS_FIELDS (+ country); unknown keys are dropped. The trigger classifies on insert.
 * @param {Array<Object>} rows
 * @param {{ country?:string, onProgress?:(done:number,total:number)=>void }} [opts]
 * @returns {Promise<{ inserted:number }>}
 */
export async function insertPartsConsumption(rows = [], { country = null, onProgress } = {}) {
  const clean = rows.map((r) => {
    const out = {}
    for (const f of PARTS_FIELDS) out[f] = r[f] === '' || r[f] == null ? null : r[f]
    out.country = r.country || country || null
    return out
  })

  let inserted = 0
  for (let i = 0; i < clean.length; i += INSERT_CHUNK) {
    const chunk = clean.slice(i, i + INSERT_CHUNK)
    let lastErr = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const { error } = await supabase.from('parts_consumption').insert(chunk)
      if (!error) { lastErr = null; break }
      lastErr = error
      // A permission / validation error will not fix itself - fail fast.
      const msg = String(error.message || '').toLowerCase()
      if (msg.includes('permission') || msg.includes('violates') || msg.includes('policy')) break
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 250)
    }
    if (lastErr) throw lastErr
    inserted += chunk.length
    if (onProgress) onProgress(inserted, clean.length)
  }
  return { inserted }
}

/**
 * Authoritative expense snapshot from parts_consumption (tyre/spare/oil, by asset,
 * store and month) via the get_parts_expense_snapshot RPC. Returns { ok:false } when
 * the backend is not provisioned so the report degrades to an honest empty state.
 * @param {{ site?:string, country?:string, from?:string, to?:string }} [opts]
 */
export async function getPartsExpenseSnapshot({ site, country, from, to } = {}) {
  const { data, error } = await supabase.rpc('get_parts_expense_snapshot', {
    p_site: site || null, p_country: country || null, p_from: from || null, p_to: to || null,
  })
  if (error) {
    const m = String(error.message || error.code || '').toLowerCase()
    if (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache') || m === 'pgrst202') {
      return { ok: false }
    }
    throw error
  }
  return data && data.ok ? data : { ok: false }
}
