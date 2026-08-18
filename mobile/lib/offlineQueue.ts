import { OfflineInspection, InspectionPayload } from './types'
import { supabase } from './supabase'
import { uploadAllPositionPhotos } from './photoUpload'
import { secureStorage, readItem } from './secureStorage'
import { notifySyncSuccess, notifySyncFailure } from './notifications'
import { clientId } from './ids'

const QUEUE_KEY = 'tp_inspection_queue_v1'

export async function getQueue(): Promise<OfflineInspection[]> {
  try {
    const raw = await secureStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * THE ONE RULE FOR EVERY READ-MODIFY-WRITE ON THIS QUEUE.
 *
 * `getQueue()` answers `[]` for BOTH "there is nothing queued" and "the Keystore
 * refused to answer", because it can only return an array. That is harmless for
 * a caller that just wants to draw a badge, and catastrophic for a caller that
 * then SAVES what it read: a torn read plus a save overwrites a field worker's
 * unsynced inspections with an empty list, and those inspections are the only
 * copy that exists. Nobody would ever see an error - the app would simply come
 * back with an empty queue.
 *
 * So a mutator must use THIS, which distinguishes the two and refuses rather
 * than guessing. The trade is deliberate: when the store is unreadable we risk
 * failing to save ONE new item, instead of silently destroying ALL of them.
 */
export class QueueUnreadableError extends Error {
  readonly status: string
  constructor(status: string) {
    super('The offline store could not be read, so nothing was changed.')
    this.name = 'QueueUnreadableError'
    this.status = status
  }
}

async function loadQueueForWrite(): Promise<OfflineInspection[]> {
  const read = await readItem(QUEUE_KEY)
  // 'absent' is a real, trustworthy answer: there is genuinely nothing queued.
  if (read.status === 'unreadable' || read.status === 'torn') throw new QueueUnreadableError(read.status)
  if (!read.value) return []
  try {
    const parsed = JSON.parse(read.value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Readable but not valid JSON. Overwriting is no worse than what is there,
    // and refusing forever would strand the device.
    return []
  }
}

async function saveQueue(queue: OfflineInspection[]): Promise<void> {
  await secureStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export async function enqueueInspection(payload: InspectionPayload, clientUuid?: string): Promise<string> {
  // Reuse a client id shared with the online attempt (if any) so a lost response
  // can't create a duplicate — the queued retry upserts on the same key.
  const id = clientUuid ?? clientId()
  const item: OfflineInspection = {
    id,
    payload,
    sync_status: 'pending',
    created_at: new Date().toISOString(),
    synced_at: null,
    error: null,
  }
  const queue = await loadQueueForWrite()
  queue.unshift(item)
  await saveQueue(queue)
  return id
}

/**
 * Count of queued inspections that are NOT yet in the database: 'pending' AND
 * 'failed'. A failed item is still unsent field work the user must be told
 * about. Counting only 'pending' made every indicator (tab-bar badge, Home
 * pending tile, Profile "Pending", SyncBanner) read 0 the moment an inspection
 * failed, so the banner - and with it the in-context "Sync now" that calls
 * retryFailed() first - disappeared and the technician was shown "all synced"
 * while an inspection sat unsent. The row was never lost (retryFailed + the
 * Profile "Sync now" button still recover it), but it was invisible.
 * Mirrors getPendingRecordCount() in recordQueue.ts, which already counts
 * everything that is not 'synced'.
 */
export async function getPendingCount(): Promise<number> {
  const queue = await loadQueueForWrite()
  return queue.filter(i => i.sync_status !== 'synced').length
}

// Global in-flight guard — a manual sync overlapping the 10s poll / pull-to-refresh
// would otherwise loop the same pending items twice and double-insert.
let syncInFlight: Promise<{ synced: number; failed: number }> | null = null

export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  if (syncInFlight) return syncInFlight
  syncInFlight = doSyncQueue().finally(() => { syncInFlight = null })
  return syncInFlight
}

async function doSyncQueue(): Promise<{ synced: number; failed: number }> {
  const queue = await loadQueueForWrite()
  let synced = 0
  let failed = 0

  for (const item of queue) {
    if (item.sync_status !== 'pending') continue

    try {
      // ── Phase 1: upload any local photos to Supabase Storage ────────────────
      // tyre_conditions is Record<string, TyrePositionData>; we need to deep-copy
      // it before mutation so a failed insert doesn't corrupt the queued payload.
      const conditionsCopy = JSON.parse(JSON.stringify(item.payload.tyre_conditions ?? {}))

      const hasLocalPhotos = Object.values(conditionsCopy).some(
        (pos: any) => pos.photo_uri && !pos.photo_url
      )

      if (hasLocalPhotos) {
        await uploadAllPositionPhotos(conditionsCopy, item.id)
      }

      // Build the final payload - replace tyre_conditions with photo-resolved copy
      const resolvedPayload: InspectionPayload = {
        ...item.payload,
        tyre_conditions: conditionsCopy,
      }

      // ── Phase 2: upsert the inspection record ────────────────────────────────
      // Upsert on the stable client id so a replay (crash / lost response /
      // overlapping sync) is ignored instead of inserting a duplicate.
      // Heal items queued by older builds whose tokens violate the DB CHECKs
      // (ck_inspection_approval_status / inspections_status_check) - otherwise
      // they would retry-fail forever and pin the pending badge.
      if (resolvedPayload.approval_status === 'pending') resolvedPayload.approval_status = 'pending_approval'
      if (resolvedPayload.approval_status === 'returned') resolvedPayload.approval_status = 'rejected'
      if (resolvedPayload.status === 'Pending approval') resolvedPayload.status = 'In Progress'
      if (resolvedPayload.status === 'Approved' || resolvedPayload.status === 'Returned') resolvedPayload.status = 'Done'
      const { error } = await supabase.from('inspections')
        .upsert({ ...resolvedPayload, client_uuid: item.id }, { onConflict: 'client_uuid', ignoreDuplicates: true })
      if (error) throw error

      // Persist the resolved photo URLs back into the queued item so the local
      // record is consistent if re-read (e.g. history screen) before the queue
      // is cleared.
      item.payload.tyre_conditions = conditionsCopy
      item.sync_status = 'synced'
      item.synced_at = new Date().toISOString()
      synced++
    } catch (err: any) {
      item.sync_status = 'failed'
      item.error = err?.message ?? 'Unknown error'
      failed++
    }
    // Persist after EACH item so a crash mid-loop can't lose a 'synced' marking.
    await saveQueue(queue)
  }

  await saveQueue(queue)

  // Fire local notifications so the user knows sync outcome even if the app
  // is backgrounded when SyncBanner triggers an auto-sync on reconnect.
  await Promise.all([
    notifySyncSuccess(synced),
    notifySyncFailure(failed),
  ])

  return { synced, failed }
}

export async function retryFailed(): Promise<void> {
  const queue = await loadQueueForWrite()
  for (const item of queue) {
    if (item.sync_status === 'failed') {
      item.sync_status = 'pending'
      item.error = null
    }
  }
  await saveQueue(queue)
}

export async function clearSynced(): Promise<void> {
  const queue = await loadQueueForWrite()
  const filtered = queue.filter(i => i.sync_status !== 'synced')
  await saveQueue(filtered)
}

/**
 * Wipe the ENTIRE inspection queue (pending included). Used on logout so a
 * different account on a shared device cannot inherit this user's queued work.
 */
export async function clearQueue(): Promise<void> {
  await secureStorage.removeItem(QUEUE_KEY)
}
