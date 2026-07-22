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

const CHUNK = 400
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function insertChunked(table, rows, onProgress) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    let err = null
    for (let a = 1; a <= 4; a += 1) {
      const res = await supabase.from(table).insert(chunk)
      if (!res.error) { err = null; break }
      err = res.error
      const m = String(err.message || '').toLowerCase()
      if (m.includes('permission') || m.includes('policy') || m.includes('violates')) break
      await sleep(600 * a)
    }
    if (err) throw err
    inserted += chunk.length
    if (onProgress) onProgress(inserted, rows.length)
  }
  return inserted
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
  const inserted = fresh.length ? await insertChunked('tyre_records', fresh, onProgress) : 0
  return { inserted, skipped }
}

/** Complaints/repair rows -> work_orders. Skips work_order_no already stored (merge). */
export async function insertWorkOrders(rows = [], { onProgress, country } = {}) {
  const seen = await existingKeys('work_orders', 'work_order_no', country).catch(() => new Set())
  const fresh = rows.filter((r) => r.work_order_no && !seen.has(String(r.work_order_no).trim().toLowerCase()))
  const skipped = rows.length - fresh.length
  const inserted = fresh.length ? await insertChunked('work_orders', fresh, onProgress) : 0
  return { inserted, skipped }
}

/** Open-job-card snapshot -> open_work_orders. REPLACES this country's list only (so
 * other countries' open lists are untouched). */
export async function replaceOpenWorkOrders(rows = [], { onProgress, country } = {}) {
  let del = supabase.from('open_work_orders').delete()
  del = country ? del.eq('country', country) : del.not('id', 'is', null)
  const { error } = await del
  if (error) throw error
  const inserted = rows.length ? await insertChunked('open_work_orders', rows, onProgress) : 0
  return { inserted, skipped: 0 }
}

/** Asset master rows -> vehicle_fleet. Inserts assets not already stored (merge by
 * asset_no); existing assets are left untouched so curated fleet data is preserved. */
export async function insertVehicleFleet(rows = [], { onProgress, country } = {}) {
  const seen = await existingKeys('vehicle_fleet', 'asset_no', country).catch(() => new Set())
  const fresh = rows.filter((r) => r.asset_no && !seen.has(String(r.asset_no).trim().toLowerCase()))
  const skipped = rows.length - fresh.length
  const inserted = fresh.length ? await insertChunked('vehicle_fleet', fresh, onProgress) : 0
  return { inserted, skipped }
}

/** Route a mapped intake result to the right loader. */
export async function loadIntake(target, rows, opts = {}) {
  if (target === 'tyre_records') return insertTyreRecords(rows, opts)
  if (target === 'work_orders') return insertWorkOrders(rows, opts)
  if (target === 'open_work_orders') return replaceOpenWorkOrders(rows, opts)
  if (target === 'vehicle_fleet') return insertVehicleFleet(rows, opts)
  throw new Error(`Unknown intake target: ${target}`)
}
