/**
 * DTC Codes service — diagnostic trouble codes logged against fleet assets
 * (V160). Any authenticated member can list/log/edit/clear codes within their
 * organisation; RLS enforces org isolation and country scoping is applied
 * null-safe here, mirroring support.js / tyreAgeCompliance.js.
 *
 * `listDtcCodes` degrades gracefully to [] when the backing table has not been
 * migrated yet, so the page can surface an "apply migration" hint instead of
 * throwing.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,asset_no,code,description,system,severity,' +
  'detected_at,status,site,notes,created_by,created_at,updated_at'

export const DTC_SEVERITIES = ['info', 'warning', 'critical']
export const DTC_STATUSES = ['active', 'acknowledged', 'cleared']

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/**
 * List DTC codes (newest detected first). Optional status/severity filters and
 * null-safe country scoping. Returns [] when the table is not yet migrated.
 * @param {{ country?:string, status?:string, severity?:string, limit?:number }} [opts]
 */
export async function listDtcCodes({ country, status, severity, limit = 500 } = {}) {
  let q = supabase.from('dtc_codes').select(COLS)
  if (status) q = q.eq('status', status)
  if (severity) q = q.eq('severity', severity)
  q = applyCountry(q, country)
  try {
    return (
      unwrap(
        await q
          .order('detected_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(limit),
      ) || []
    )
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Log a new diagnostic trouble code. Requires an asset number. */
export async function createDtcCode(values = {}) {
  const asset_no = String(values.asset_no || '').trim()
  if (!asset_no) throw new Error('An asset number is required.')
  const severity = DTC_SEVERITIES.includes(values.severity) ? values.severity : 'warning'
  const status = DTC_STATUSES.includes(values.status) ? values.status : 'active'
  const payload = {
    asset_no: asset_no.slice(0, 120),
    code: values.code ? String(values.code).trim().slice(0, 60) : null,
    description: values.description ? String(values.description).slice(0, 2000) : null,
    system: values.system ? String(values.system).trim().slice(0, 120) : null,
    severity,
    status,
    detected_at: values.detected_at || null,
    site: values.site ? String(values.site).trim().slice(0, 200) : null,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('dtc_codes').insert(payload).select(COLS).single())
}

/** Patch a DTC code. Immutable identity/audit columns are stripped. */
export async function updateDtcCode(id, patch = {}) {
  if (!id) throw new Error('A code id is required.')
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.created_by
  delete clean.organisation_id
  if (clean.severity != null && !DTC_SEVERITIES.includes(clean.severity)) delete clean.severity
  if (clean.status != null && !DTC_STATUSES.includes(clean.status)) delete clean.status
  if (clean.asset_no != null) {
    const asset_no = String(clean.asset_no).trim()
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no.slice(0, 120)
  }
  return unwrap(await supabase.from('dtc_codes').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteDtcCode(id) {
  if (!id) throw new Error('A code id is required.')
  return unwrap(await supabase.from('dtc_codes').delete().eq('id', id))
}
