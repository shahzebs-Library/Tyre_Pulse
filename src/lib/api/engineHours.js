/**
 * Engine hours service — the single seam between the Engine Hours Tracker page
 * (/engine-hours) and Supabase (table `engine_hours_logs`, V161). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping, and
 * input validation. RLS enforces org isolation; this layer never trusts client
 * input blindly.
 *
 * Mirrors equipment.js / support.js. A missing `engine_hours_logs` relation
 * (org has not run the migration) degrades listing to an empty array so the page
 * can render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toNumber } from '../engineHours'

export const COLS =
  'id,organisation_id,country,asset_no,engine_hours,reading_date,source,site,notes,' +
  'created_by,created_at,updated_at'

export const ENGINE_HOURS_SOURCES = ['manual', 'telematics', 'obd', 'estimated', 'import']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('engine_hours_logs'))
  )
}

/** Normalise a form value to a trimmed string (or null) with a max length. */
function str(v, max) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return max ? s.slice(0, max) : s
}

/**
 * List engine-hour readings (newest first). Optional `asset_no` and `country`
 * filters. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, asset_no?:string, limit?:number }} [opts]
 */
export async function listEngineHours({ country, asset_no, limit = 1000 } = {}) {
  try {
    let q = supabase.from('engine_hours_logs').select(COLS)
    if (asset_no) q = q.eq('asset_no', asset_no)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('reading_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getEngineHours(id) {
  return unwrap(await supabase.from('engine_hours_logs').select(COLS).eq('id', id).maybeSingle())
}

/** Build a clean, typed insert payload from raw form values. */
function toPayload(values = {}) {
  return {
    asset_no: str(values.asset_no, 120),
    engine_hours: toNumber(values.engine_hours),
    reading_date: values.reading_date ? String(values.reading_date).slice(0, 10) : null,
    source: str(values.source, 60),
    site: str(values.site, 200),
    notes: str(values.notes, 4000),
    country: values.country ?? null,
  }
}

/** Log a reading. Requires an asset number and a numeric engine-hours value. */
export async function createEngineHours(values = {}) {
  const asset_no = str(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')
  const engine_hours = toNumber(values.engine_hours)
  if (engine_hours === null) throw new Error('A numeric engine-hours reading is required.')
  if (engine_hours < 0) throw new Error('Engine hours cannot be negative.')
  const payload = toPayload({ ...values, asset_no, engine_hours })
  return unwrap(await supabase.from('engine_hours_logs').insert(payload).select(COLS).single())
}

/** Patch a reading. Re-validates supplied fields; strips immutable columns. */
export async function updateEngineHours(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = str(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.engine_hours !== undefined) {
    const engine_hours = toNumber(patch.engine_hours)
    if (engine_hours === null) throw new Error('A numeric engine-hours reading is required.')
    if (engine_hours < 0) throw new Error('Engine hours cannot be negative.')
    clean.engine_hours = engine_hours
  }
  if (patch.reading_date !== undefined) clean.reading_date = patch.reading_date ? String(patch.reading_date).slice(0, 10) : null
  if (patch.source !== undefined) clean.source = str(patch.source, 60)
  if (patch.site !== undefined) clean.site = str(patch.site, 200)
  if (patch.notes !== undefined) clean.notes = str(patch.notes, 4000)
  if (patch.country !== undefined) clean.country = patch.country ?? null
  return unwrap(await supabase.from('engine_hours_logs').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteEngineHours(id) {
  return unwrap(await supabase.from('engine_hours_logs').delete().eq('id', id))
}
