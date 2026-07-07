/**
 * offlineQueue.js - IndexedDB-backed offline inspection queue with Background
 * Sync, bounded retry/back-off, dead-lettering and idempotent conflict-safe
 * flushing.
 *
 * When the user saves a checklist offline the payload is persisted to IndexedDB
 * with a stable `client_uuid`. The service worker Background Sync tag
 * 'inspection-sync' is registered so the browser retries when connectivity
 * returns; Layout/Inspections also call syncPendingInspections() on mount and on
 * navigator.onLine.
 *
 * Reliability model:
 *  - Idempotency / conflict resolution: every queued item carries a
 *    `client_uuid`; the server has a UNIQUE index (ux_inspections_client_uuid),
 *    so a retry after a partially-applied sync hits a 23505 conflict which we
 *    treat as SUCCESS (the row already landed) instead of creating a duplicate.
 *  - Bounded retry with exponential back-off: a failing item records an
 *    attempt count + `next_attempt_at`; sync skips items not yet due.
 *  - Dead-letter: after MAX_ATTEMPTS an item moves to `failed` (not retried
 *    forever) and is surfaced for manual retry/discard.
 *
 * The pure helpers (backoffMs / isConflictError / planAfterFailure / isDue) are
 * unit-tested in src/test/offlineQueue.test.js.
 */

const DB_NAME    = 'tyrepulse-offline'
const DB_VERSION = 1
const STORE      = 'inspection_queue'
export const SYNC_TAG = 'inspection-sync'

/** Give up (dead-letter) after this many failed sync attempts. */
export const MAX_ATTEMPTS = 5

// ── Pure, testable policy helpers ─────────────────────────────────────────────

/** Exponential back-off (30s, 60s, 120s, …) capped at 1 hour. */
export function backoffMs(attempts) {
  const n = Math.max(1, attempts | 0)
  return Math.min(2 ** n * 15_000, 3_600_000)
}

/** A unique-constraint hit means the row already synced — resolve as success. */
export function isConflictError(error) {
  if (!error) return false
  const code = error.code
  const msg = String(error.message || '').toLowerCase()
  return code === '23505' || msg.includes('duplicate key') || msg.includes('already exists')
}

/**
 * Next state for a queued item after a failed attempt: dead-letter once it would
 * exceed MAX_ATTEMPTS, otherwise stay pending with a back-off window.
 */
export function planAfterFailure(attempts, now = Date.now()) {
  const next = (attempts | 0) + 1
  if (next >= MAX_ATTEMPTS) return { status: 'failed', attempts: next, next_attempt_at: null }
  return { status: 'pending', attempts: next, next_attempt_at: new Date(now + backoffMs(next)).toISOString() }
}

/** Is a pending item due to be retried yet? */
export function isDue(item, now = Date.now()) {
  const at = item?.next_attempt_at
  if (!at) return true
  const t = new Date(at).getTime()
  return !Number.isFinite(t) || t <= now
}

function newUuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return 'off-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

// Fields that are queue bookkeeping only — never sent to the server.
const QUEUE_META = ['_queueId', 'status', 'queued_at', 'synced_at', 'attempts', 'last_error', 'next_attempt_at']

function stripMeta(item) {
  const out = {}
  for (const k of Object.keys(item)) if (!QUEUE_META.includes(k)) out[k] = item[k]
  return out
}

// ── IndexedDB plumbing ────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: '_queueId', autoIncrement: true })
        store.createIndex('queued_at', 'queued_at', { unique: false })
        store.createIndex('status',    'status',    { unique: false })
      }
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = () => reject(req.error)
  })
}

/**
 * Add an inspection payload to the offline queue. Stamps a stable client_uuid
 * (used for idempotent server-side dedup) and resets retry bookkeeping.
 * Returns the auto-incremented queue ID.
 */
export async function enqueueInspection(payload) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const entry = {
      ...payload,
      client_uuid: payload?.client_uuid || newUuid(),
      queued_at:   new Date().toISOString(),
      status:      'pending',
      attempts:    0,
      next_attempt_at: null,
    }
    const req = store.add(entry)
    req.onsuccess = () => {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready
          .then(sw => sw.sync.register(SYNC_TAG))
          .catch(() => { /* Background Sync not permitted - will sync on next open */ })
      }
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

function getAllByStatus(status) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).index('status').getAll(status)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  }))
}

/** All pending (unsynced) items. */
export function getPendingInspections() {
  return getAllByStatus('pending')
}

/** Items that exhausted their retries and need manual attention. */
export function getFailedInspections() {
  return getAllByStatus('failed')
}

function updateItem(queueId, patch) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const get   = store.get(queueId)
    get.onsuccess = () => {
      if (!get.result) { resolve(); return }
      const put = store.put({ ...get.result, ...patch })
      put.onsuccess = () => resolve()
      put.onerror   = () => reject(put.error)
    }
    get.onerror = () => reject(get.error)
  }))
}

/** Mark a queued item as synced (kept for audit history until pruned). */
export function markInspectionSynced(queueId) {
  return updateItem(queueId, { status: 'synced', synced_at: new Date().toISOString(), last_error: null })
}

/** Record a failed attempt; dead-letters the item once MAX_ATTEMPTS is reached. */
export function markInspectionFailed(queueId, attempts, message) {
  return updateItem(queueId, { ...planAfterFailure(attempts), last_error: message ?? 'Sync failed' })
}

/** Requeue a dead-lettered item for another try. */
export function retryFailedInspection(queueId) {
  return updateItem(queueId, { status: 'pending', attempts: 0, next_attempt_at: null, last_error: null })
}

/** Permanently drop a queued item (used to discard a dead-lettered entry). */
export function deleteQueued(queueId) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).delete(queueId)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  }))
}

/**
 * Flush due pending items to Supabase. Idempotent + conflict-safe: a 23505
 * unique-violation on client_uuid is treated as an already-synced success.
 * Failures back off and eventually dead-letter. Returns per-item results.
 */
export async function syncPendingInspections(supabase) {
  let pending
  try {
    pending = await getPendingInspections()
  } catch {
    return []
  }
  if (!pending.length) return []

  const now = Date.now()
  const results = []
  for (const item of pending) {
    if (!isDue(item, now)) continue
    const payload = stripMeta(item)
    try {
      const { error } = await supabase.from('inspections').insert(payload)
      if (error && !isConflictError(error)) throw error
      await markInspectionSynced(item._queueId)
      results.push({ queueId: item._queueId, success: true, deduped: !!error })
    } catch (err) {
      const message = err?.message ?? 'Unknown error'
      await markInspectionFailed(item._queueId, item.attempts, message)
      results.push({ queueId: item._queueId, success: false, error: message })
    }
  }
  return results
}

/** Count pending items - used for the offline badge/indicator. */
export async function getPendingCount() {
  try {
    return (await getPendingInspections()).length
  } catch {
    return 0
  }
}

/** Count dead-lettered items needing attention. */
export async function getFailedCount() {
  try {
    return (await getFailedInspections()).length
  } catch {
    return 0
  }
}

/**
 * Delete synced items older than retainDays (default 7) to prevent unbounded
 * growth. Failed items are retained (they need manual review).
 */
export async function pruneQueue(retainDays = 7) {
  const db    = await openDB()
  const cutoff = new Date(Date.now() - retainDays * 86400_000).toISOString()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req   = store.openCursor()
    let deleted = 0
    req.onsuccess = e => {
      const cursor = e.target.result
      if (!cursor) { resolve(deleted); return }
      const { status, synced_at } = cursor.value
      if (status === 'synced' && synced_at && synced_at < cutoff) {
        cursor.delete()
        deleted++
      }
      cursor.continue()
    }
    req.onerror = () => reject(req.error)
  })
}
