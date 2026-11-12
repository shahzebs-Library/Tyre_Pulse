/**
 * ERP intake service - loads the mapped rows from src/lib/erpIntake.js into their
 * destination tables. NOTHING GENUINELY NEW IS EVER DROPPED. A re-import of an ERP
 * export MERGES by the row's natural key:
 *   - a brand-new key            -> INSERTED
 *   - a key already stored, but  -> the existing row is UPDATED with the changed /
 *     the row carries new details    newly-provided fields (never blanking a value the
 *                                    file leaves empty, so curated data is preserved)
 *   - a key already stored, and  -> UNCHANGED (an exact duplicate, nothing to do)
 *     every field is identical
 * This is why the expense grid (content-addressed on the ERP line number) always
 * loaded in full while the other reports appeared to "skip" - they used to drop any
 * row whose key already existed, discarding the newer details. Now every report loads
 * everything, and only exact duplicates are left alone. work_orders.work_order_no and
 * vehicle_fleet (org,country,asset_no) are UNIQUE, so a same-key row can only be a
 * refresh, never a second physical row; tyre_records has no such key, so a genuine
 * exact duplicate is simply not re-added (clean historical ones in Duplicate Control).
 * The open-job-card list is a snapshot: REPLACED on each import. Cost is never written
 * here (cost comes only from the parts_consumption grid).
 *
 * @module api/erpIntake
 */
import { supabase, toServiceError, isNotProvisioned } from './_client'
import { chainFitmentsPerWheel, summariseReconcile } from '../tyreReplacement'

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
  const m = String(error?.cause?.message ?? error?.message ?? '').toLowerCase()
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
      if (isFatalInsertError(res.error)) throw toServiceError(res.error)
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

/**
 * Build a paged existence Set, FAILING FAST on a read error.
 *
 * WHY FAIL FAST. These Sets are the ONLY thing that recognises a row already in
 * the system. If a read quietly returned an empty Set on a transient failure,
 * EVERY row would be treated as new and re-inserted - a 23505 on a global unique
 * (e.g. work_orders.work_order_no) aborts the whole non-grid batch at zero rows.
 * So a per-page read retries a few times (a network blip) and then THROWS; the
 * loader must abort BEFORE any insert. The ONLY degrade allowed is a genuinely
 * missing relation (a migration not applied yet): there is nothing to compare
 * against, so an empty Set is correct and every row loads as new.
 *
 * @param {(from:number, size:number) => PromiseLike<{data:any[]|null, error:any}>} buildPageQuery
 * @param {(set:Set<string>, row:object) => void} addRow
 */
async function pagedExistenceSet(buildPageQuery, addRow) {
  const keys = new Set()
  let from = 0
  // Keyset cursor: the id of the last row of the previous page. Paging by OFFSET
  // made the server walk and sort every earlier row again for each page (measured
  // on work_orders: 15,452 buffers plus a temp spill per 1,000-row page at offset
  // 50,000, against 1,470 for the same page by `id > cursor`), so the whole read
  // grew with the square of the table.
  let after = null
  const size = 1000
  for (let guard = 0; guard < 500; guard += 1) {
    let data = null
    let lastErr = null
    for (let a = 1; a <= 3; a += 1) {
      const res = await buildPageQuery(from, size, after)
      if (!res.error) { data = res.data; lastErr = null; break }
      lastErr = res.error
      // A genuinely undeployed table is the only read error we degrade: no rows
      // to compare against, so everything is new. Never retry it - it will not
      // start existing between attempts.
      if (isNotProvisioned(res.error)) return keys
      if (a < 3) await sleep(Math.min(BASE_BACKOFF_MS * 2 ** (a - 1), MAX_BACKOFF_MS) + Math.random() * 300)
    }
    // Still failing after retries: THROW so the caller aborts before inserting.
    if (lastErr) throw toServiceError(lastErr)
    if (!data || data.length === 0) break
    for (const r of data) addRow(keys, r)
    if (data.length < size) break
    const lastId = data[data.length - 1]?.id
    if (lastId != null) {
      after = lastId      // next page starts after this row; offset stays 0
    } else {
      after = null        // no id in the projection: fall back to offset paging
      from += size
    }
  }
  return keys
}

/** Existing values of a column (paged) as a lowercase Set, for merge dedup. When a
 * country is given, only rows of THAT country are considered, so the same asset/WO
 * number can exist independently in different countries. Fails fast (see
 * pagedExistenceSet): a transient read error THROWS; a missing table returns []. */
async function existingKeys(table, column, country) {
  return pagedExistenceSet(
    (from, size, after) => {
      let q = supabase.from(table).select(column === 'id' ? 'id' : `${column},id`).not(column, 'is', null)
      if (country) q = q.eq('country', country)
      if (after != null) q = q.gt('id', after)
      // Stable order on the primary key: PostgREST does NOT guarantee row order
      // across .range() pages without an ORDER BY, so a row can be dropped or
      // repeated at a page boundary. A dropped existing key is not recognised as
      // a duplicate, gets re-inserted, and aborts the whole batch on 23505.
      return q.order('id', { ascending: true }).range(from, from + size - 1)
    },
    (keys, r) => { const v = r[column]; if (v != null) keys.add(String(v).trim().toLowerCase()) },
  )
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

/** Existing tyre lifecycle keys for this country, paged. Fails fast (see
 * pagedExistenceSet): a transient read error THROWS; a missing table returns []. */
async function existingTyreKeys(country) {
  return pagedExistenceSet(
    (from, size, after) => {
      let q = supabase.from('tyre_records').select('serial_no,asset_no,position,issue_date,id')
      if (country) q = q.eq('country', country)
      if (after != null) q = q.gt('id', after)
      // Stable order on the primary key so paging never drops/repeats a row at a
      // page boundary (PostgREST does not guarantee order across .range() pages
      // without an ORDER BY). A missed key otherwise re-inserts and aborts the batch.
      return q.order('id', { ascending: true }).range(from, from + size - 1)
    },
    (keys, r) => keys.add(tyreLifecycleKey(r)),
  )
}

/** Lower-cased, trimmed key value for case/whitespace-insensitive matching. */
const NORM = (v) => String(v ?? '').trim().toLowerCase()

/**
 * Fetch the FULL existing rows for a set of key values, so an incoming row that
 * shares a key can be compared field-by-field and refreshed. Only the OVERLAP
 * (rows whose key is already known) is fetched, keyed on the ORIGINAL values so
 * the server-side match is case-exact; the caller indexes results by normalised
 * key. Chunked to keep the .in() list short; country-scoped when given.
 */
async function fetchRowsByIn(table, column, values, { country } = {}) {
  const uniq = [...new Set((values || []).filter((v) => v != null && String(v).trim() !== ''))]
  const out = []
  for (let i = 0; i < uniq.length; i += 200) {
    const chunk = uniq.slice(i, i + 200)
    let q = supabase.from(table).select('*').in(column, chunk)
    if (country) q = q.eq('country', country)
    const { data, error } = await q
    if (error) throw toServiceError(error)
    if (data) out.push(...data)
  }
  return out
}

// Columns never compared for "did anything change" and never overwritten on a
// refresh: identity, tenancy, timestamps, generated, provenance blobs.
const COMPARE_SKIP = new Set([
  'id', 'organisation_id', 'organization_id', 'org_id', 'created_at', 'updated_at',
  'country', 'client_uuid', 'fitment_date', 'extra_fields', 'custom_data', 'asset_extra',
])

/** Compare value: trimmed + lower-cased; a date-time collapses to its day so a
 *  time part or timezone suffix is not read as a change. */
const normCmp = (v) => {
  if (v == null) return ''
  const s = String(v).trim().toLowerCase()
  return /^\d{4}-\d{2}-\d{2}[t ]/.test(s) ? s.slice(0, 10) : s
}

/** The fields an incoming row would CHANGE on an existing row: only fields the
 *  file actually provides (non-blank) whose value differs. Empty incoming fields
 *  are ignored so a sparse re-export never blanks a curated value. Empty object
 *  means the incoming row is an exact duplicate (nothing to refresh). */
function changedFields(incoming, existing) {
  const patch = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (COMPARE_SKIP.has(k)) continue
    if (v == null || String(v).trim() === '') continue
    if (normCmp(v) !== normCmp(existing[k])) patch[k] = v
  }
  return patch
}

/** Resilient chunked UPDATE-by-id (worker pool + backoff). A row that keeps
 *  failing is counted, never lost silently. */
async function updateById(table, updates, onProgress, base = 0, total = 0) {
  let done = 0
  let failed = 0
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const idx = cursor
      cursor += 1
      if (idx >= updates.length) return
      const u = updates[idx]
      let ok = false
      for (let a = 1; a <= MAX_ATTEMPTS; a += 1) {
        const res = await supabase.from(table).update(u.patch).eq('id', u.id)
        if (!res.error) { ok = true; break }
        if (isFatalInsertError(res.error)) break
        if (a < MAX_ATTEMPTS) {
          await sleep(Math.min(BASE_BACKOFF_MS * 2 ** (a - 1), MAX_BACKOFF_MS) + Math.random() * 300)
        }
      }
      if (!ok) failed += 1
      done += 1
      if (onProgress) onProgress(base + done, total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, updates.length) }, worker))
  return { updated: updates.length - failed, failed }
}

/** Collapse incoming rows to one row per natural key (later non-blank values win),
 *  so a file that repeats a key does not try to insert it twice under a unique
 *  constraint. Rows with no usable key are counted (noKey), never dropped silently. */
function collapseByKey(rows, keyFn) {
  const collapsed = new Map()
  let noKey = 0
  for (const r of rows) {
    const k = keyFn(r)
    if (!k) { noKey += 1; continue }
    const prev = collapsed.get(k)
    if (!prev) { collapsed.set(k, { ...r }); continue }
    const merged = { ...prev }
    for (const [kk, vv] of Object.entries(r)) {
      if (vv != null && String(vv).trim() !== '') merged[kk] = vv
    }
    collapsed.set(k, merged)
  }
  return { collapsed, noKey }
}

/**
 * Merge a set of incoming rows into a target: INSERT genuinely-new keys, UPDATE
 * an existing key's row with any changed/newly-provided fields, leave exact
 * duplicates alone. Nothing genuinely new is dropped.
 *
 * @param {string} table
 * @param {Map} collapsed key -> merged incoming row (from collapseByKey)
 * @param {Set} seen normalised keys already stored (existence set, paged)
 * @param {(overlapRows:object[]) => Promise<Map>} loadExisting fetch full existing
 *   rows for the overlap and return Map(normKey -> row)
 * @returns {Promise<{inserted,updated,unchanged,failed}>}
 */
async function mergeRows(table, collapsed, seen, loadExisting, onProgress) {
  const toInsert = []
  const overlap = []
  for (const [k, r] of collapsed) {
    if (seen.has(k)) overlap.push({ key: k, row: r })
    else toInsert.push(r)
  }
  const exMap = overlap.length ? await loadExisting(overlap.map((o) => o.row)).catch(() => new Map()) : new Map()
  const toUpdate = []
  let unchanged = 0
  for (const { key, row } of overlap) {
    const ex = exMap.get(key)
    // Existence-set said present but the row was not fetched (a race, or a soft
    // key that no longer resolves): treat as unchanged rather than risk a
    // duplicate-key insert. Nothing new is added, nothing is lost.
    if (!ex) { unchanged += 1; continue }
    const patch = changedFields(row, ex)
    if (Object.keys(patch).length) toUpdate.push({ id: ex.id, patch })
    else unchanged += 1
  }
  const total = toInsert.length + toUpdate.length
  const insRes = toInsert.length
    ? await insertChunked(table, toInsert, (d) => onProgress && onProgress(Math.min(d, total), total))
    : { inserted: 0, failed: 0 }
  const updRes = toUpdate.length
    ? await updateById(table, toUpdate, onProgress, toInsert.length, total)
    : { updated: 0, failed: 0 }
  return {
    inserted: insRes.inserted,
    updated: updRes.updated,
    unchanged,
    failed: (insRes.failed || 0) + (updRes.failed || 0),
  }
}

/**
 * Tyre lifecycle rows -> tyre_records. Merge on the full fitment key: a new
 * fitment is inserted, an already-stored fitment is REFRESHED with any new
 * details (e.g. a removal date/km added on a later export), and an exact
 * duplicate is left alone. Later fitments of an already-known serial still load.
 */
export async function insertTyreRecords(rows = [], { onProgress, country } = {}) {
  const usable = rows.filter((r) => String(r.serial_no ?? '').trim() || String(r.asset_no ?? '').trim())
  // Abort BEFORE any insert if the existence read failed: a silently-empty set
  // treats every row as new and aborts the whole batch on a duplicate-key insert.
  const seen = await existingTyreKeys(country)
  const { collapsed } = collapseByKey(usable, tyreLifecycleKey)

  // Replacement: a new fitment replaces the tyre already on that wheel. Earlier
  // same-wheel fitments in this file end when the next one went on; the latest
  // one per wheel goes to the database check, which closes the old tyre when the
  // evidence is clear (one active tyre, earlier or same day, no later history)
  // and reports anything else for review. Without this the guard refuses the
  // new tyre (23505) and the old one stays on the wheel forever.
  const newKeys = [...collapsed.keys()].filter((k) => !seen.has(k))
  const { rows: chainedRows, chained, latest } = chainFitmentsPerWheel(newKeys.map((k) => collapsed.get(k)))
  newKeys.forEach((k, i) => collapsed.set(k, chainedRows[i]))
  let replacement = { chained, total: 0, closed: 0, emptyWheel: 0, review: 0, moved: 0, reviewRows: [] }
  // Without a country the database check cannot run, and a current fitment
  // must never reach tyre_records without it: that is how a replacement
  // bypassed reconciliation. Refuse instead of loading unchecked.
  if (latest.length && !country) {
    throw new Error('Choose a country before importing tyre fitments: the replacement check needs it.')
  }
  if (latest.length) {
    const payload = latest.map((r) => ({
      asset_no: r.asset_no, position: r.tyre_position ?? r.position, serial_no: r.serial_no,
      issue_date: r.issue_date ? String(r.issue_date).slice(0, 10) : null,
      km_at_fitment: r.km_at_fitment ?? null, hrs_at_fitment: r.hrs_at_fitment ?? null,
      job_card: r.job_card ?? null, vehicle_type: r.vehicle_type ?? null, size: r.size ?? null, brand: r.brand ?? null,
    }))
    const { data, error } = await supabase.rpc('tyre_import_reconcile', {
      p_rows: payload, p_country: country, p_dry_run: false,
    })
    if (error) throw toServiceError(error)
    if (data && data.ok === false) throw new Error(`Tyre replacement check refused: ${data.reason}`)
    replacement = { chained, ...summariseReconcile(data), reviewRows: data?.review || [], reviewTotal: data?.review_total ?? (data?.held || data?.review || []).length }
    // A row held for review would be refused by the one-tyre-per-wheel guard and
    // abort its whole chunk, so it is not inserted here; it is listed instead.
    if (replacement.review) {
      // `held` is the full list; `review` is capped at 200 for display only.
      const held = new Set((data.held || data.review || []).map((r) => `${String(r.asset_no ?? '').trim().toUpperCase().replace(/\s+/g, '')}|${String(r.position ?? '').trim().toUpperCase()}|${String(r.serial_no ?? '').trim().toUpperCase()}`))
      for (const k of newKeys) {
        const r = collapsed.get(k)
        const hk = `${String(r.asset_no ?? '').trim().toUpperCase().replace(/\s+/g, '')}|${String(r.tyre_position ?? r.position ?? '').trim().toUpperCase()}|${String(r.serial_no ?? '').trim().toUpperCase()}`
        if (!r.removal_date && held.has(hk)) collapsed.delete(k)
      }
    }
  }
  const loadExisting = async (overlapRows) => {
    const serials = overlapRows.map((r) => r.serial_no)
    const assets = overlapRows.map((r) => r.asset_no)
    const found = []
    if (serials.some((v) => String(v ?? '').trim())) {
      found.push(...await fetchRowsByIn('tyre_records', 'serial_no', serials, { country }))
    }
    if (assets.some((v) => String(v ?? '').trim())) {
      found.push(...await fetchRowsByIn('tyre_records', 'asset_no', assets, { country }))
    }
    const map = new Map()
    for (const er of found) { const k = tyreLifecycleKey(er); if (!map.has(k)) map.set(k, er) }
    return map
  }
  const res = await mergeRows('tyre_records', collapsed, seen, loadExisting, onProgress)
  return {
    ...res,
    noKey: rows.length - usable.length,
    skipped: rows.length - res.inserted - res.updated,
    replacement,
  }
}

/**
 * Complaints/repair rows -> work_orders. Skips a work_order_no already stored (merge).
 * Dedupe is GLOBAL, not country-scoped: work_orders.work_order_no is globally unique
 * (the number's prefix encodes the country 1:1 — AFKR/GCKR=KSA, RM=UAE, EG=Egypt — so a
 * number can never legitimately belong to two countries). A country-scoped check let a
 * number already stored under another country slip through and abort the whole batch on
 * the global unique (23505). `country` is still accepted for signature compatibility.
 */
export async function insertWorkOrders(rows = [], { onProgress, country } = {}) {
  // Fail fast if the existence read fails (see existingKeys): proceeding with an
  // empty set would re-insert every work order and abort on the global unique.
  const seen = await existingKeys('work_orders', 'work_order_no')
  const { collapsed, noKey } = collapseByKey(rows, (r) => (r.work_order_no ? NORM(r.work_order_no) : ''))
  const loadExisting = async (overlapRows) => {
    const found = await fetchRowsByIn('work_orders', 'work_order_no', overlapRows.map((r) => r.work_order_no))
    const map = new Map()
    for (const er of found) map.set(NORM(er.work_order_no), er)
    return map
  }
  const res = await mergeRows('work_orders', collapsed, seen, loadExisting, onProgress)
  return { ...res, noKey, skipped: rows.length - res.inserted - res.updated }
}

/**
 * Open-job-card snapshot -> open_work_orders. REPLACES this country's list only.
 *
 * The delete and the insert are ONE transaction via the DEFINER RPC
 * `replace_open_work_orders` (country-scoped, elevated-gated, PT409 on conflict):
 * the client-side two-step below could delete the list and then fail mid-insert,
 * leaving the open list empty. The RPC is drafted but may not be applied yet, so
 * a NOT-PROVISIONED result falls back to the legacy two-step so the import keeps
 * working; any other RPC error is surfaced, never silently retried.
 */
export async function replaceOpenWorkOrders(rows = [], { onProgress, country } = {}) {
  if (onProgress) onProgress(0, rows.length)
  const { data, error } = await supabase.rpc('replace_open_work_orders', {
    p_country: country ?? null,
    p_rows: rows,
  })
  if (!error) {
    if (onProgress) onProgress(rows.length, rows.length)
    return { inserted: Number(data?.inserted) || 0, failed: 0, skipped: 0, updated: 0, unchanged: 0 }
  }
  if (!isNotProvisioned(error)) throw toServiceError(error)
  // RPC not deployed yet: legacy client-side delete-then-insert.
  let del = supabase.from('open_work_orders').delete()
  del = country ? del.eq('country', country) : del.not('id', 'is', null)
  const { error: delErr } = await del
  if (delErr) throw toServiceError(delErr)
  const res = rows.length ? await insertChunked('open_work_orders', rows, onProgress) : { inserted: 0, failed: 0 }
  return { inserted: res.inserted, failed: res.failed || 0, skipped: 0, updated: 0, unchanged: 0 }
}

/** Asset master rows -> vehicle_fleet. Inserts new assets and REFRESHES an already
 * stored asset with any changed/newly-provided fields (odometer, insurance dates,
 * etc.), but never blanks a curated value the file leaves empty. Merge key is
 * (org, country, asset_no) - the same asset code in another country is a different
 * machine, so the check is country-scoped. */
export async function insertVehicleFleet(rows = [], { onProgress, country } = {}) {
  // Fail fast if the existence read fails (see existingKeys): proceeding with an
  // empty set would re-insert every asset and abort on the (org, country, asset_no) unique.
  const seen = await existingKeys('vehicle_fleet', 'asset_no', country)
  const { collapsed, noKey } = collapseByKey(rows, (r) => (r.asset_no ? NORM(r.asset_no) : ''))
  const loadExisting = async (overlapRows) => {
    const found = await fetchRowsByIn('vehicle_fleet', 'asset_no', overlapRows.map((r) => r.asset_no), { country })
    const map = new Map()
    for (const er of found) map.set(NORM(er.asset_no), er)
    return map
  }
  const res = await mergeRows('vehicle_fleet', collapsed, seen, loadExisting, onProgress)
  return { ...res, noKey, skipped: rows.length - res.inserted - res.updated }
}

/** The natural-key column used to merge/dedup each target on re-import. */
const KEY_COL = {
  tyre_records: 'serial_no',
  work_orders: 'work_order_no',
  vehicle_fleet: 'asset_no',
}

/**
 * Preview-time merge check: given mapped rows for a target, count how many carry a
 * brand-new key (will be INSERTED) and how many share a key already stored (will be
 * REFRESHED with any new details, not dropped). Lets the Data Intake screen show the
 * split before importing. tyre_records is keyed on the full fitment key (serial alone
 * is not unique); the unique-keyed targets use their single natural key.
 * open_work_orders is a replaceable snapshot (no per-row merge concept).
 * @returns {Promise<{ total:number, existing:number, fresh:number, keyed:boolean }>}
 */
export async function countExistingRows(target, rows = [], { country } = {}) {
  const total = rows.length
  if (target === 'tyre_records') {
    // Let a read failure PROPAGATE so the page records dup: null ("could not
    // check") instead of a false all-new preview from a swallowed empty set.
    const seen = await existingTyreKeys(country)
    let existing = 0
    const inFile = new Set()
    for (const r of rows) {
      if (!String(r.serial_no ?? '').trim() && !String(r.asset_no ?? '').trim()) continue
      const k = tyreLifecycleKey(r)
      if (seen.has(k) || inFile.has(k)) existing += 1
      else inFile.add(k)
    }
    return { total, existing, fresh: total - existing, keyed: true }
  }
  const col = KEY_COL[target]
  if (!col) return { total, existing: 0, fresh: total, keyed: false }
  // Let a read failure PROPAGATE so the page records dup: null ("could not check").
  const seen = await existingKeys(target, col, country)
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
