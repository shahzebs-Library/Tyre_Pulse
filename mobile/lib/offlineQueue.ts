import { OfflineInspection, InspectionPayload } from './types'
import { supabase } from './supabase'
import { uploadAllPositionPhotos } from './photoUpload'
import { secureStorage } from './secureStorage'

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

export async function enqueueInspection(payload: InspectionPayload): Promise<string> {
  const id = `local_${crypto.randomUUID()}`
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

export async function syncQueue(): Promise<{ synced: number; failed: number }> {
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

      // Build the final payload — replace tyre_conditions with photo-resolved copy
      const resolvedPayload: InspectionPayload = {
        ...item.payload,
        tyre_conditions: conditionsCopy,
      }

      // ── Phase 2: insert the inspection record ────────────────────────────────
      const { error } = await supabase.from('inspections').insert(resolvedPayload)
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
  }

  await saveQueue(queue)
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
