/**
 * Video Telematics / Dashcam Events service — the single seam between the Video
 * Telematics page (/video-telematics) and Supabase (table `dashcam_events`,
 * V168). Keeps an explicit column list (least-privilege selects), null-safe
 * country scoping, and input validation. RLS enforces org isolation; this layer
 * never trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `dashcam_events` relation (org has not run
 * the migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../dashcamEvents'

export const COLS =
  'id,organisation_id,country,asset_no,driver_name,event_type,severity,event_at,' +
  'location,speed_kmh,video_url,reviewed,review_notes,notes,created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('dashcam_events'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * List dashcam events (newest first by event_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listDashcamEvents({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('dashcam_events').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('event_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getDashcamEvent(id) {
  return unwrap(await supabase.from('dashcam_events').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Log a dashcam event. Requires an asset number (which vehicle). Speed, when
 * provided, must be non-negative. Event time defaults to now when omitted.
 */
export async function createDashcamEvent(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  let speed_kmh = null
  if (values.speed_kmh !== undefined && values.speed_kmh !== '' && values.speed_kmh != null) {
    speed_kmh = toFiniteNumber(values.speed_kmh)
    if (speed_kmh == null) throw new Error('Speed must be a number.')
    if (speed_kmh < 0) throw new Error('Speed cannot be negative.')
  }

  const payload = {
    asset_no,
    driver_name: asText(values.driver_name, 200),
    event_type: asText(values.event_type, 40),
    severity: asText(values.severity, 40),
    event_at: asDate(values.event_at) || new Date().toISOString(),
    location: asText(values.location, 300),
    speed_kmh,
    video_url: asText(values.video_url, 2000),
    reviewed: values.reviewed === true || values.reviewed === 'true',
    review_notes: values.review_notes ? String(values.review_notes).slice(0, 8000) : null,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('dashcam_events').insert(payload).select(COLS).single())
}

/**
 * Patch a dashcam event. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateDashcamEvent(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.event_type !== undefined) clean.event_type = asText(patch.event_type, 40)
  if (patch.severity !== undefined) clean.severity = asText(patch.severity, 40)
  if (patch.event_at !== undefined) clean.event_at = asDate(patch.event_at)
  if (patch.location !== undefined) clean.location = asText(patch.location, 300)
  if (patch.speed_kmh !== undefined) {
    if (patch.speed_kmh === '' || patch.speed_kmh == null) {
      clean.speed_kmh = null
    } else {
      const speed_kmh = toFiniteNumber(patch.speed_kmh)
      if (speed_kmh == null) throw new Error('Speed must be a number.')
      if (speed_kmh < 0) throw new Error('Speed cannot be negative.')
      clean.speed_kmh = speed_kmh
    }
  }
  if (patch.video_url !== undefined) clean.video_url = asText(patch.video_url, 2000)
  if (patch.reviewed !== undefined) clean.reviewed = patch.reviewed === true || patch.reviewed === 'true'
  if (patch.review_notes !== undefined) clean.review_notes = patch.review_notes ? String(patch.review_notes).slice(0, 8000) : null
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('dashcam_events').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteDashcamEvent(id) {
  return unwrap(await supabase.from('dashcam_events').delete().eq('id', id))
}
