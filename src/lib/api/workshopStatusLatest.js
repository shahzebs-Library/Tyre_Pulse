/**
 * Workshop Status - read the newest manual update of each record (for printed
 * and exported reports). Read-only, through RLS. Best effort: a failed read
 * returns an empty Map so the export still runs, just without the column text.
 */
import { supabase, fetchAllPages } from './_client'
import { latestManualUpdateByRecord } from '../workshopStatus/latestUpdate'

const CHUNK = 150

/** @returns {Promise<Map<string, object>>} record id -> newest manual_update event */
export async function loadLatestManualUpdates(recordIds) {
  const ids = [...new Set((recordIds || []).filter(Boolean).map(String))]
  const events = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK)
    const { data, error } = await fetchAllPages((from, to) => supabase
      .from('workshop_status_events')
      .select('id,record_id,event_type,actor_name,created_at,details')
      .eq('event_type', 'manual_update')
      .in('record_id', part)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to), { max: 20000 })
    if (error) return new Map()
    events.push(...(data || []))
  }
  return latestManualUpdateByRecord(events)
}
