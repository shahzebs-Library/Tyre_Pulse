import AsyncStorage from '@react-native-async-storage/async-storage'
import { OfflineInspection, InspectionPayload } from './types'
import { supabase } from './supabase'

const QUEUE_KEY = 'tp_inspection_queue_v1'

export async function getQueue(): Promise<OfflineInspection[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function saveQueue(queue: OfflineInspection[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export async function enqueueInspection(payload: InspectionPayload): Promise<string> {
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
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
      const { error } = await supabase.from('inspections').insert(item.payload)
      if (error) throw error
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
