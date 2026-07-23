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

const INSERT_CHUNK = 200
const MAX_ATTEMPTS = 6
const BASE_BACKOFF_MS = 700
const MAX_BACKOFF_MS = 8000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A fatal (won't-fix-itself) error: permission / RLS / validation. Everything else
 * (network drop, timeout, 5xx, proxy reset) is transient and worth deferring + retrying. */
function isFatalInsertError(error) {
  const msg = String(error?.message || '').toLowerCase()
  const code = String(error?.code || '').toLowerCase()
  return (
    msg.includes('permission') || msg.includes('violates') || msg.includes('policy') ||
    msg.includes('duplicate key') || msg.includes('invalid input') || msg.includes('check constraint') ||
    code === '42501' || code === '23505' || code === '22p02' || code === '23514'
  )
}

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
 * Resilience: small chunks with jittered exponential backoff; a chunk that keeps
 * failing on a TRANSIENT error (network/timeout/5xx) is DEFERRED and retried in a
 * final sweep instead of aborting the whole load - so one weak-signal blip never
 * sinks a big import. A FATAL error (permission/validation) still aborts immediately.
 * Rows that still fail after the sweep are returned as `failed` (never silently lost).
 *
 * @param {Array<Object>} rows
 * @param {{ country?:string, onProgress?:(done:number,total:number)=>void }} [opts]
 * @returns {Promise<{ inserted:number, failed:number }>}
 */
export async function insertPartsConsumption(rows = [], { country = null, onProgress } = {}) {
  const clean = rows.map((r) => {
    const out = {}
    for (const f of PARTS_FIELDS) out[f] = r[f] === '' || r[f] == null ? null : r[f]
    out.country = r.country || country || null
    return out
  })

  let inserted = 0
  const deferred = [] // chunks that hit a transient error - retried after the main pass

  const tryChunk = async (chunk, attempts) => {
    let lastErr = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const { error } = await supabase.from('parts_consumption').insert(chunk)
      if (!error) return { ok: true }
      lastErr = error
      if (isFatalInsertError(error)) throw error // won't fix itself - abort
      await sleep(Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS) + Math.random() * 300)
    }
    return { ok: false, error: lastErr }
  }

  for (let i = 0; i < clean.length; i += INSERT_CHUNK) {
    const chunk = clean.slice(i, i + INSERT_CHUNK)
    const res = await tryChunk(chunk, MAX_ATTEMPTS)
    if (res.ok) { inserted += chunk.length } else { deferred.push(chunk) }
    if (onProgress) onProgress(inserted, clean.length)
  }

  // Final sweep: pause to let a flaky connection settle, then retry deferred chunks.
  let failed = 0
  if (deferred.length) {
    await sleep(2500)
    for (const chunk of deferred) {
      const res = await tryChunk(chunk, MAX_ATTEMPTS)
      if (res.ok) { inserted += chunk.length } else { failed += chunk.length }
      if (onProgress) onProgress(inserted, clean.length)
    }
  }
  return { inserted, failed }
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

/**
 * Per-country expense totals (each in its OWN currency, not blended). Used by the
 * "All countries" view so SAR / AED / EGP are shown side by side rather than summed.
 * @param {{ from?:string, to?:string }} [opts]
 * @returns {Promise<Array<{country:string, tyre:number, spare:number, oil:number, total:number, lines:number}>>}
 */
export async function getExpenseByCountry({ from, to } = {}) {
  const { data, error } = await supabase.rpc('get_expense_by_country', {
    p_from: from || null, p_to: to || null,
  })
  if (error) {
    const m = String(error.message || error.code || '').toLowerCase()
    if (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache') || m === 'pgrst202') {
      return []
    }
    throw error
  }
  return Array.isArray(data) ? data.map((r) => ({
    country: r.country,
    tyre: Number(r.tyre) || 0,
    spare: Number(r.spare) || 0,
    oil: Number(r.oil) || 0,
    total: Number(r.total) || 0,
    lines: Number(r.lines) || 0,
  })) : []
}
