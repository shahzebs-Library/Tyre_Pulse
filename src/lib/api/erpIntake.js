/**
 * ERP intake service - loads the mapped rows from src/lib/erpIntake.js into their
 * destination tables. Same-period re-imports MERGE rather than duplicate: rows whose
 * natural key already exists are skipped (tyre_records by serial+job card, work_orders
 * by work order number). The open-job-card list is a snapshot: it is REPLACED on each
 * import. Cost is never written here (cost comes only from the parts_consumption grid).
 *
 * @module api/erpIntake
 */
import { supabase } from './_client'

const CHUNK = 200
const MAX_ATTEMPTS = 6
const BASE_BACKOFF_MS = 700
const MAX_BACKOFF_MS = 8000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Fatal (won't-fix-itself) vs transient. Transient chunk failures are deferred and
 * retried in a final sweep so a network blip never aborts a big load. */
function isFatalInsertError(error) {
  const m = String(error?.message || '').toLowerCase()
  const code = String(error?.code || '').toLowerCase()
  return (
    m.includes('permission') || m.includes('policy') || m.includes('violates') ||
    m.includes('duplicate key') || m.includes('invalid input') || m.includes('check constraint') ||
    code === '42501' || code === '23505' || code === '22p02' || code === '23514'
  )
}

/** Resilient chunked insert: small chunks, jittered backoff, defer-and-retry sweep.
 * Returns { inserted, failed } - rows that still fail after the sweep are never lost. */
async function insertChunked(table, rows, onProgress) {
  let inserted = 0
  const deferred = []
  const tryChunk = async (chunk) => {
    let lastErr = null
    for (let a = 1; a <= MAX_ATTEMPTS; a += 1) {
      const res = await supabase.from(table).insert(chunk)
      if (!res.error) return { ok: true }
      lastErr = res.error
      if (isFatalInsertError(res.error)) throw res.error
      await sleep(Math.min(BASE_BACKOFF_MS * 2 ** (a - 1), MAX_BACKOFF_MS) + Math.random() * 300)
    }
    return { ok: false, error: lastErr }
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const res = await tryChunk(chunk)
    if (res.ok) { inserted += chunk.length } else { deferred.push(chunk) }
    if (onProgress) onProgress(inserted, rows.length)
  }
  let failed = 0
  if (deferred.length) {
    await sleep(2500)
    for (const chunk of deferred) {
      const res = await tryChunk(chunk)
      if (res.ok) { inserted += chunk.length } else { failed += chunk.length }
      if (onProgress) onProgress(inserted, rows.length)
    }
  }
  return { inserted, failed }
}

/** Existing values of a column (paged) as a lowercase Set, for merge dedup. When a
 * country is given, only rows of THAT country are considered, so the same asset/WO
 * number can exist independently in different countries. */
async function existingKeys(table, column, country) {
  const keys = new Set()
  let from = 0
  const size = 1000
  for (let guard = 0; guard < 500; guard += 1) {
    let q = supabase.from(table).select(column).not(column, 'is', null)
    if (country) q = q.eq('country', country)
    const { data, error } = await q.range(from, from + size - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data) { const v = r[column]; if (v != null) keys.add(String(v).trim().toLowerCase()) }
    if (data.length < size) break
    from += size
  }
  return keys
}

/** Tyre lifecycle rows -> tyre_records. Skips serials already stored in this country (merge). */
export async function insertTyreRecords(rows = [], { onProgress, country } = {}) {
  const seen = await existingKeys('tyre_records', 'serial_no', country).catch(() => new Set())
  const fresh = rows.filter((r) => r.serial_no && !seen.has(String(r.serial_no).trim().toLowerCase()))
  const skipped = rows.length - fresh.length
  const res = fresh.length ? await insertChunked('tyre_records', fresh, onProgress) : { inserted: 0, failed: 0 }
  return { inserted: res.inserted, failed: res.failed || 0, skipped }
}

/** Complaints/repair rows -> work_orders. Skips work_order_no already stored (merge). */
export async function insertWorkOrders(rows = [], { onProgress, country } = {}) {
  const seen = await existingKeys('work_orders', 'work_order_no', country).catch(() => new Set())
  const fresh = rows.filter((r) => r.work_order_no && !seen.has(String(r.work_order_no).trim().toLowerCase()))
  const skipped = rows.length - fresh.length
  const res = fresh.length ? await insertChunked('work_orders', fresh, onProgress) : { inserted: 0, failed: 0 }
  return { inserted: res.inserted, failed: res.failed || 0, skipped }
}

/** Open-job-card snapshot -> open_work_orders. REPLACES this country's list only (so
 * other countries' open lists are untouched). */
export async function replaceOpenWorkOrders(rows = [], { onProgress, country } = {}) {
  let del = supabase.from('open_work_orders').delete()
  del = country ? del.eq('country', country) : del.not('id', 'is', null)
  const { error } = await del
  if (error) throw error
  const res = rows.length ? await insertChunked('open_work_orders', rows, onProgress) : { inserted: 0, failed: 0 }
  return { inserted: res.inserted, failed: res.failed || 0, skipped: 0 }
}

/** Asset master rows -> vehicle_fleet. Inserts assets not already stored (merge by
 * asset_no); existing assets are left untouched so curated fleet data is preserved. */
export async function insertVehicleFleet(rows = [], { onProgress, country } = {}) {
  const seen = await existingKeys('vehicle_fleet', 'asset_no', country).catch(() => new Set())
  const fresh = rows.filter((r) => r.asset_no && !seen.has(String(r.asset_no).trim().toLowerCase()))
  const skipped = rows.length - fresh.length
  const res = fresh.length ? await insertChunked('vehicle_fleet', fresh, onProgress) : { inserted: 0, failed: 0 }
  return { inserted: res.inserted, failed: res.failed || 0, skipped }
}

/** Route a mapped intake result to the right loader. */
export async function loadIntake(target, rows, opts = {}) {
  if (target === 'tyre_records') return insertTyreRecords(rows, opts)
  if (target === 'work_orders') return insertWorkOrders(rows, opts)
  if (target === 'open_work_orders') return replaceOpenWorkOrders(rows, opts)
  if (target === 'vehicle_fleet') return insertVehicleFleet(rows, opts)
  throw new Error(`Unknown intake target: ${target}`)
}
