/**
 * Reads + reviewer decisions for the DRAFT AI serial reading (pending migration 20261117130000).
 * Until that migration is applied the tables do not exist: reads return [] (provisioned:false)
 * and the review screen shows nothing extra. Decisions go through the definer RPC only; this
 * module never writes tyre records.
 */
import { supabase, isNotProvisioned, toServiceError } from './_client'

const READING_COLS = 'id,job_id,inspection_id,tyre_position,raw,normalized,source,confidence,status,issues,position_status,canonical_position,registered_serials,outcome,reason,needs_review,created_at'
const EVENT_COLS = 'id,reading_id,decision,confirmed_serial,note,reviewer_id,created_at'

export async function listSerialReadings(inspectionIds) {
  const ids = Array.from(new Set((inspectionIds || []).filter(Boolean))).slice(0, 100)
  if (!ids.length) return { readings: [], events: [], provisioned: true }
  const { data, error } = await supabase.from('ai_tyre_serial_readings').select(READING_COLS)
    .in('inspection_id', ids).order('created_at', { ascending: true }).order('id').limit(1000)
  if (error) {
    if (isNotProvisioned(error)) return { readings: [], events: [], provisioned: false }
    throw toServiceError(error, 'Could not load serial readings')
  }
  const readings = data || []
  if (!readings.length) return { readings, events: [], provisioned: true }
  const { data: ev, error: evError } = await supabase.from('ai_tyre_serial_review_events').select(EVENT_COLS)
    .in('reading_id', readings.map((r) => r.id)).order('created_at', { ascending: true }).order('id').limit(1000)
  if (evError && !isNotProvisioned(evError)) throw toServiceError(evError, 'Could not load serial decisions')
  return { readings, events: ev || [], provisioned: true }
}

export async function reviewSerialReading(readingId, decision, confirmedSerial, note) {
  const { data, error } = await supabase.rpc('ai_tyre_serial_review', {
    p_reading: readingId, p_decision: decision, p_serial: confirmedSerial || null, p_note: note,
  })
  if (error) throw toServiceError(error, 'Could not save the serial decision')
  return data
}
