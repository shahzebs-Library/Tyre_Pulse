import { backoffMs, isConflictError, MAX_ATTEMPTS } from './offlineQueue'

const DB_NAME = 'tyrepulse-offline'
const DB_VERSION = 2
const STORE = 'operational_mutation_queue'
export const OPERATIONAL_SYNC_TAG = 'operational-action-sync'
const ALLOWED = new Set(['action.create', 'action.update', 'stock.reserve'])

export function validateOperationalMutation(input = {}) {
  const type = String(input.type || '')
  if (!ALLOWED.has(type)) throw new Error('Unsupported offline operation.')
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new Error('An operation payload is required.')
  const idempotencyKey = String(input.idempotencyKey || '').trim().slice(0, 180)
  if (!idempotencyKey) throw new Error('An idempotency key is required.')
  return { type, payload: input.payload, idempotencyKey }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains('inspection_queue')) {
        const inspections = db.createObjectStore('inspection_queue', { keyPath: '_queueId', autoIncrement: true })
        inspections.createIndex('queued_at', 'queued_at', { unique: false })
        inspections.createIndex('status', 'status', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: '_queueId', autoIncrement: true })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('idempotencyKey', 'idempotencyKey', { unique: true })
      }
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}

export async function enqueueOperationalMutation(input) {
  const value = validateOperationalMutation(input)
  const db = await openDB()
  const id = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).add({
      ...value, status: 'pending', attempts: 0, next_attempt_at: null,
      queued_at: new Date().toISOString(),
    })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => isConflictError(req.error) ? resolve(null) : reject(req.error)
  })
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(sw => sw.sync?.register(OPERATIONAL_SYNC_TAG)).catch(() => {})
  }
  return id
}

const all = (status) => openDB().then(db => new Promise((resolve, reject) => {
  const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('status').getAll(status)
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
}))

const put = (item) => openDB().then(db => new Promise((resolve, reject) => {
  const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(item)
  req.onsuccess = () => resolve()
  req.onerror = () => reject(req.error)
}))

/** Executor is injected by the authenticated UI; credentials are never stored in IndexedDB. */
export async function syncOperationalMutations(executor, now = Date.now()) {
  if (typeof executor !== 'function') throw new Error('A sync executor is required.')
  const pending = await all('pending').catch(() => [])
  const results = []
  for (const item of pending) {
    const due = !item.next_attempt_at || new Date(item.next_attempt_at).getTime() <= now
    if (!due) continue
    try {
      await executor({ type: item.type, payload: item.payload, idempotencyKey: item.idempotencyKey })
      await put({ ...item, status: 'synced', synced_at: new Date().toISOString(), last_error: null })
      results.push({ queueId: item._queueId, success: true })
    } catch (error) {
      if (isConflictError(error)) {
        await put({ ...item, status: 'synced', synced_at: new Date().toISOString(), last_error: null })
        results.push({ queueId: item._queueId, success: true, deduped: true })
        continue
      }
      const attempts = (item.attempts || 0) + 1
      const failed = attempts >= MAX_ATTEMPTS
      await put({ ...item, attempts, status: failed ? 'failed' : 'pending',
        next_attempt_at: failed ? null : new Date(now + backoffMs(attempts)).toISOString(),
        last_error: String(error?.message || 'Sync failed').slice(0, 500) })
      results.push({ queueId: item._queueId, success: false })
    }
  }
  return results
}

export const getPendingOperationalCount = async () => (await all('pending').catch(() => [])).length
export const getFailedOperationalMutations = () => all('failed').catch(() => [])
