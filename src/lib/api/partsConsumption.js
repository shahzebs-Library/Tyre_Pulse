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
// Chunks in flight at once. This path is latency-bound, so this is the single
// biggest lever on upload time. Kept deliberately low: each row fires the
// classification trigger, so concurrency multiplies peak database write load by
// the same factor. Raise only with a measurement, and check that a 429 is
// classified transient before doing so.
const INSERT_CONCURRENCY = 4
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
      // Only wait if another attempt follows. Sleeping after the LAST one adds
      // 8 seconds of dead time per exhausted chunk before the deferred sweep
      // that was going to run anyway.
      if (attempt < attempts) {
        await sleep(Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS) + Math.random() * 300)
      }
    }
    return { ok: false, error: lastErr }
  }

  // Send chunks through a small worker pool rather than one at a time. The
  // sequential loop this replaces paid a full round trip per chunk, so a 50,000
  // row grid was ~250 round trips end to end - latency-bound, not server-bound,
  // which is exactly the case concurrency fixes.
  //
  // Order does not matter here: parts_consumption's only unique index is on
  // (organisation_id, import_uid), and import_uid is derived from the row's own
  // content, so idempotency does not depend on insertion order.
  //
  // Four, not more: every row runs the classification trigger, so concurrency
  // multiplies peak write load by the same factor.
  const chunks = []
  for (let i = 0; i < clean.length; i += INSERT_CHUNK) chunks.push(clean.slice(i, i + INSERT_CHUNK))

  let cursor = 0
  let fatal = null
  await Promise.all(Array.from({ length: Math.min(INSERT_CONCURRENCY, chunks.length) }, async () => {
    for (;;) {
      const idx = cursor
      cursor += 1
      if (idx >= chunks.length || fatal) return
      try {
        const res = await tryChunk(chunks[idx], MAX_ATTEMPTS)
        if (res.ok) inserted += chunks[idx].length
        else deferred.push(chunks[idx])
      } catch (err) {
        // Hold the first fatal error and let the pool drain. Throwing from
        // inside a worker would leave the others in flight and make the
        // reported count meaningless.
        fatal = fatal || err
        return
      }
      if (onProgress) onProgress(inserted, clean.length)
    }
  }))
  if (fatal) { fatal.inserted = inserted; throw fatal }

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
/**
 * Raw expense rows for download - the REAL lines behind every total, scoped to
 * country + date window. Paged with an id tiebreak (never a bare select) and
 * bounded: 100k rows max, with a truncated flag so the caller can say so.
 */
export async function listExpenseRows({ country, from, to, max = 100000 } = {}) {
  const { fetchAllPages } = await import('../fetchAll')
  const build = (fromIdx, toIdx) => {
    let q = supabase
      .from('parts_consumption')
      .select('event_date, work_order_no, item_code, item_description, qty, unit_cost, line_cost, tyre_cost, oil_cost, site, store_code, currency, country')
      .order('event_date', { ascending: true })
      .order('id', { ascending: true })
      .range(fromIdx, toIdx)
    if (country && country !== 'All') q = q.eq('country', country)
    if (from) q = q.gte('event_date', from)
    if (to) q = q.lte('event_date', to)
    return q
  }
  // fetchAllPages resolves { data, error, truncated } - NOT { rows }. This read
  // the wrong key, so `rows` was always undefined and the export wrote an empty
  // workbook over a table holding 208,375 lines, with no error to show for it.
  const { data, truncated, error } = await fetchAllPages(build, { max })
  if (error) throw error
  return { rows: data || [], truncated: Boolean(truncated) }
}

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
 * Everything the Expenses and CPK page needs, in one call: spend split, cost per
 * kilometre with its coverage, the previous period and the same period a year
 * earlier, a 36-month series, and the per-dimension movements behind the change.
 *
 * Degrades to { ok:false } when the backend is not provisioned, so the page shows
 * an honest empty state rather than an error.
 * @param {{ country?:string, site?:string, from?:string, to?:string }} [opts]
 */
export async function getCostCpkOverview({ country, site, from, to } = {}) {
  const { data, error } = await supabase.rpc('get_cost_cpk_overview', {
    p_country: country || null, p_site: site || null, p_from: from || null, p_to: to || null,
  })
  if (error) {
    const m = String(error.message || error.code || '').toLowerCase()
    if (m.includes('does not exist') || m.includes('could not find')
      || m.includes('schema cache') || m === 'pgrst202') {
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
