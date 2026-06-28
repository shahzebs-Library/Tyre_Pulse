/**
 * recordQueue
 *
 * Generic offline queue for simple table inserts (Report Issue, Tyre Change,
 * Work Orders, RCA). Mirrors the inspection queue: a submit tries the insert
 * immediately and, if it fails (offline or transient), the record is stored
 * locally and flushed automatically when connectivity returns.
 *
 * Photos are uploaded before queuing (when online) so we only ever persist
 * permanent public URLs; an offline submit keeps the local photo URLs and
 * they upload on the next successful sync attempt by the screen itself.
 */
import { supabase } from './supabase'
import { secureStorage } from './secureStorage'

const KEY = 'tp_record_queue_v1'

export type QueueStatus = 'pending' | 'synced' | 'failed'

export interface QueuedRecord {
  id: string
  table: string
  payload: Record<string, any>
  sync_status: QueueStatus
  created_at: string
  synced_at: string | null
  error: string | null
}

export async function getRecordQueue(): Promise<QueuedRecord[]> {
  try {
    const raw = await secureStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function save(queue: QueuedRecord[]): Promise<void> {
  await secureStorage.setItem(KEY, JSON.stringify(queue))
}

export async function enqueueRecord(table: string, payload: Record<string, any>): Promise<string> {
  const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const queue = await getRecordQueue()
  queue.unshift({
    id, table, payload,
    sync_status: 'pending',
    created_at: new Date().toISOString(),
    synced_at: null,
    error: null,
  })
  await save(queue)
  return id
}

export async function getPendingRecordCount(): Promise<number> {
  const queue = await getRecordQueue()
  return queue.filter(i => i.sync_status !== 'synced').length
}

/**
 * Try to insert immediately; on any failure, store offline so the data is
 * never lost. Returns whether the write hit the network or was queued.
 */
export async function saveRecord(
  table: string,
  payload: Record<string, any>,
): Promise<{ ok: boolean; offline: boolean; error?: string }> {
  try {
    const { error } = await supabase.from(table).insert(payload)
    if (error) throw error
    return { ok: true, offline: false }
  } catch (e: any) {
    await enqueueRecord(table, payload)
    return { ok: true, offline: true, error: e?.message }
  }
}

export async function syncRecordQueue(): Promise<{ synced: number; failed: number }> {
  const queue = await getRecordQueue()
  let synced = 0, failed = 0
  for (const item of queue) {
    if (item.sync_status === 'synced') continue
    try {
      const { error } = await supabase.from(item.table).insert(item.payload)
      if (error) throw error
      item.sync_status = 'synced'
      item.synced_at = new Date().toISOString()
      item.error = null
      synced++
    } catch (err: any) {
      item.sync_status = 'failed'
      item.error = err?.message ?? 'Unknown error'
      failed++
    }
  }
  await save(queue)
  return { synced, failed }
}

export async function retryFailedRecords(): Promise<void> {
  const queue = await getRecordQueue()
  for (const i of queue) if (i.sync_status === 'failed') { i.sync_status = 'pending'; i.error = null }
  await save(queue)
}

export async function clearSyncedRecords(): Promise<void> {
  const queue = await getRecordQueue()
  await save(queue.filter(i => i.sync_status !== 'synced'))
}
