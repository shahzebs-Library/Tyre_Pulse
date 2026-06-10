/**
 * offlineQueue.js — IndexedDB-backed offline inspection queue with Background Sync.
 *
 * When the user saves a checklist offline the payload is persisted to IndexedDB.
 * The service worker Background Sync tag 'inspection-sync' is registered so the
 * browser retries when connectivity is restored. The Layout/Inspections components
 * call syncPendingInspections() on mount and on navigator.onLine events.
 */

const DB_NAME    = 'tyrepulse-offline'
const DB_VERSION = 1
const STORE      = 'inspection_queue'
export const SYNC_TAG = 'inspection-sync'

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
 * Add an inspection payload to the offline queue.
 * Returns the auto-incremented queue ID.
 */
export async function enqueueInspection(payload) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const entry = {
      ...payload,
      queued_at:  new Date().toISOString(),
      status:     'pending',
    }
    const req = store.add(entry)
    req.onsuccess = () => {
      // Request Background Sync so SW retries when online
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready
          .then(sw => sw.sync.register(SYNC_TAG))
          .catch(() => { /* Background Sync not permitted — will sync on next open */ })
      }
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Retrieve all pending (unsynced) items from the queue.
 */
export async function getPendingInspections() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).index('status').getAll('pending')
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

/**
 * Mark a queued item as synced (keep for audit history).
 */
export async function markInspectionSynced(queueId) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const get   = store.get(queueId)
    get.onsuccess = () => {
      if (!get.result) { resolve(); return }
      const put = store.put({
        ...get.result,
        status:    'synced',
        synced_at: new Date().toISOString(),
      })
      put.onsuccess = () => resolve()
      put.onerror   = () => reject(put.error)
    }
    get.onerror = () => reject(get.error)
  })
}

/**
 * Flush all pending items to Supabase. Returns array of { queueId, success, error? }.
 * Safe to call multiple times — synced items are skipped automatically.
 */
export async function syncPendingInspections(supabase) {
  let pending
  try {
    pending = await getPendingInspections()
  } catch {
    return []
  }
  if (!pending.length) return []

  const results = []
  for (const item of pending) {
    const { _queueId, status, queued_at, synced_at, ...payload } = item
    try {
      const { error } = await supabase.from('inspections').insert(payload)
      if (error) throw error
      await markInspectionSynced(_queueId)
      results.push({ queueId: _queueId, success: true })
    } catch (err) {
      results.push({ queueId: _queueId, success: false, error: err?.message ?? 'Unknown error' })
    }
  }
  return results
}

/**
 * Count pending items — used for the offline badge/indicator.
 */
export async function getPendingCount() {
  try {
    const items = await getPendingInspections()
    return items.length
  } catch {
    return 0
  }
}

/**
 * Delete synced items older than retainDays (default 7) to prevent unbounded growth.
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
