import { OfflineInspection, InspectionPayload } from './types'
import { supabase } from './supabase'
import { uploadAllPositionPhotos } from './photoUpload'
import { secureStorage } from './secureStorage'
import { notifySyncSuccess, notifySyncFailure } from './notifications'

const QUEUE_KEY = 'tp_inspection_queue_v1'

export async function getQueue(): Promise<OfflineInspection[]> {
  try {
    const raw = await secureStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function saveQueue(queue: OfflineInspection[]): Promise<void> {
  await secureStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export async function enqueueInspection(payload: InspectionPayload, clientUuid?: string): Promise<string> {
  // Reuse a client id shared with the online attempt (if any) so a lost response
  // can't create a duplicate — the queued retry upserts on the same key.
  const id = clientUuid ?? `local_${crypto.randomUUID()}`
  const item: OfflineInspection = {
    id,
    payload,
    sync_status: 'pending',
    created_at: new Date().toISOString(),
    synced_at: null,
    error: null,
  }
  const queue = await getQueue()
  queue.unshift(item)
  await saveQueue(queue)
  return id
}

export async function getPendingCount(): Promise<number> {
  const queue = await getQueue()
  return queue.filter(i => i.sync_status === 'pending').length
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
  const queue = await getQueue()
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
  const queue = await getQueue()
  for (const item of queue) {
    if (item.sync_status === 'failed') {
      item.sync_status = 'pending'
      item.error = null
    }
  }
  await saveQueue(queue)
}

export async function clearSynced(): Promise<void> {
  const queue = await getQueue()
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
