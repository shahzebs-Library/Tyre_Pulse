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
// Chunks in flight at once. This path is latency-bound - a 50,000 row load was
// ~250 sequential round trips - so this is the biggest lever on upload time.
// Kept low because concurrency multiplies peak database write load.
const CONCURRENCY = 4
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
      // Only wait if another attempt follows. Sleeping after the LAST one adds
      // 8 seconds of dead time per exhausted chunk before the deferred sweep
      // that was going to run anyway.
      if (a < MAX_ATTEMPTS) {
        await sleep(Math.min(BASE_BACKOFF_MS * 2 ** (a - 1), MAX_BACKOFF_MS) + Math.random() * 300)
      }
    }
    return { ok: false, error: lastErr }
  }
  // Worker pool rather than one chunk at a time. Insert order is irrelevant
  // here: the merge guards de-duplicate on the row's own natural key, not on
  // the order rows arrive in.
  const chunks = []
  for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK))
  let cursor = 0
  let fatal = null
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
    for (;;) {
      const idx = cursor
      cursor += 1
      if (idx >= chunks.length || fatal) return
      try {
        const res = await tryChunk(chunks[idx])
        if (res.ok) inserted += chunks[idx].length
        else deferred.push(chunks[idx])
      } catch (err) {
        // Hold the first fatal error and let the pool drain, so the reported
        // count is not a lie about work still in flight.
        fatal = fatal || err
        return
      }
      if (onProgress) onProgress(inserted, rows.length)
    }
  }))
  if (fatal) { fatal.inserted = inserted; throw fatal }
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
    // Stable order on the primary key: PostgREST does NOT guarantee row order
    // across .range() pages without an ORDER BY, so a row can be dropped or
    // repeated at a page boundary. A dropped existing key is not recognised as
    // a duplicate, gets re-inserted, and aborts the whole batch on 23505.
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + size - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data) { const v = r[column]; if (v != null) keys.add(String(v).trim().toLowerCase()) }
    if (data.length < size) break
    from += size
  }
  return keys
}

/**
 * Natural key of ONE tyre lifecycle event.
 *
 * A tyre is NOT one row: the same serial is fitted, removed and refitted, so it
 * legitimately appears many times across assets and positions over its life
 * (the reconciliation RPCs treat "serial on multiple assets" as normal tyre
 * movement, not a duplicate). Deduping on serial alone therefore discarded
 * every lifecycle row after the first for any serial already in the table, so
 * incremental re-imports silently lost fitment history.
 *
 * A fitment event is uniquely identified by serial + asset + position + fix
 * date. Rows carrying an asset but no serial are still keyed (and imported) -
 * the mapper deliberately emits them, and the old serial-only filter dropped
 * them on the floor.
 */
function tyreLifecycleKey(row) {
  const norm = (v) => String(v ?? '').trim().toLowerCase()
  const day = (v) => norm(v).slice(0, 10)
  return [norm(row.serial_no), norm(row.asset_no), norm(row.position), day(row.issue_date)].join('|')
}

/** Existing tyre lifecycle keys for this country, paged. */
async function existingTyreKeys(country) {
  const keys = new Set()
  let from = 0
  const size = 1000
  for (let guard = 0; guard < 500; guard += 1) {
    let q = supabase.from('tyre_records').select('serial_no,asset_no,position,issue_date')
    if (country) q = q.eq('country', country)
    // Stable order on the primary key so paging never drops/repeats a row at a
    // page boundary (PostgREST does not guarantee order across .range() pages
    // without an ORDER BY). A missed key otherwise re-inserts and aborts the batch.
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + size - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data) keys.add(tyreLifecycleKey(r))
    if (data.length < size) break
    from += size
  }
  return keys
}

/**
 * Tyre lifecycle rows -> tyre_records. Merge on the full fitment key, so a
 * re-uploaded file adds only genuinely new lifecycle events and never
 * duplicates one, while later fitments of an already-known serial still load.
 */
export async function insertTyreRecords(rows = [], { onProgress, country } = {}) {
  const seen = await existingTyreKeys(country).catch(() => new Set())
  const batch = new Set()
  const fresh = rows.filter((r) => {
    if (!r.serial_no && !r.asset_no) return false
    const k = tyreLifecycleKey(r)
    if (seen.has(k) || batch.has(k)) return false
    batch.add(k)
    return true
  })
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

/** The natural-key column used to merge/dedup each target on re-import. */
const KEY_COL = {
  tyre_records: 'serial_no',
  work_orders: 'work_order_no',
  vehicle_fleet: 'asset_no',
}

/**
 * Preview-time duplicate check: given mapped rows for a target, count how many
 * already exist in this country (by the target's natural key) and how many are new.
 * Lets the Data Intake screen FLAG duplicates before importing rather than silently
 * merging. open_work_orders is a replaceable snapshot (no per-row dup concept).
 * @returns {Promise<{ total:number, existing:number, fresh:number, keyed:boolean }>}
 */
export async function countExistingRows(target, rows = [], { country } = {}) {
  const col = KEY_COL[target]
  const total = rows.length
  if (!col) return { total, existing: 0, fresh: total, keyed: false }
  const seen = await existingKeys(target, col, country).catch(() => new Set())
  let existing = 0
  const inFile = new Set()
  for (const r of rows) {
    const v = r[col]
    if (v == null || v === '') continue
    const k = String(v).trim().toLowerCase()
    if (seen.has(k) || inFile.has(k)) existing += 1
    else inFile.add(k)
  }
  return { total, existing, fresh: total - existing, keyed: true }
}

/** Route a mapped intake result to the right loader. */
export async function loadIntake(target, rows, opts = {}) {
  if (target === 'tyre_records') return insertTyreRecords(rows, opts)
  if (target === 'work_orders') return insertWorkOrders(rows, opts)
  if (target === 'open_work_orders') return replaceOpenWorkOrders(rows, opts)
  if (target === 'vehicle_fleet') return insertVehicleFleet(rows, opts)
  throw new Error(`Unknown intake target: ${target}`)
}
