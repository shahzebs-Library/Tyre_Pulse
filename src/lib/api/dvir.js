/**
 * DVIR service (V155) — Driver Vehicle Inspection Reports. Drivers log daily
 * pre/post-trip vehicle inspections: asset, driver, date, defects found,
 * safe-to-operate, and a status lifecycle (open -> resolved -> closed). RLS
 * enforces org isolation; any authenticated member may read and maintain
 * records. This layer keeps an explicit column list (least-privilege select)
 * and null-safe country scoping, mirroring batteries.js / support.js.
 *
 * When the table has not been migrated yet, the lister degrades to [] so the
 * page can surface an "apply MIGRATIONS_V155_DVIR_REPORTS.sql" hint instead of
 * throwing.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,asset_no,driver_name,inspection_type,inspection_date,' +
  'defects_found,defect_notes,safe_to_operate,site,status,created_by,created_at,updated_at'

export const DVIR_INSPECTION_TYPES = ['pre_trip', 'post_trip']
export const DVIR_STATUS_VALUES = ['open', 'resolved', 'closed']

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/** Coerce a value to a plain boolean. */
function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

/**
 * List DVIR reports (newest inspection first). Optional country / status
 * filters. Returns [] when the table is missing so the UI can prompt for the
 * migration rather than error.
 */
export async function listDvirReports({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('dvir_reports').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('inspection_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getDvirReport(id) {
  return unwrap(await supabase.from('dvir_reports').select(COLS).eq('id', id).maybeSingle())
}

/** Create a DVIR report. Requires an asset number. */
export async function createDvirReport(values = {}) {
  const assetNo = String(values.asset_no || '').trim()
  if (!assetNo) throw new Error('An asset number is required.')
  const inspectionType = DVIR_INSPECTION_TYPES.includes(values.inspection_type)
    ? values.inspection_type
    : 'pre_trip'
  const status = DVIR_STATUS_VALUES.includes(values.status) ? values.status : 'open'
  const payload = {
    asset_no: assetNo.slice(0, 120),
    driver_name: values.driver_name ? String(values.driver_name).slice(0, 160) : null,
    inspection_type: inspectionType,
    inspection_date: values.inspection_date || null,
    defects_found: bool(values.defects_found),
    defect_notes: values.defect_notes ? String(values.defect_notes).slice(0, 4000) : null,
    safe_to_operate: values.safe_to_operate == null ? true : bool(values.safe_to_operate),
    site: values.site ? String(values.site).slice(0, 120) : null,
    status,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('dvir_reports').insert(payload).select(COLS).single())
}

/** Patch a DVIR report. Immutable columns are stripped before update. */
export async function updateDvirReport(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.created_by
  delete clean.organisation_id
  delete clean.updated_at
  if (clean.inspection_type != null && !DVIR_INSPECTION_TYPES.includes(clean.inspection_type)) {
    delete clean.inspection_type
  }
  if (clean.status != null && !DVIR_STATUS_VALUES.includes(clean.status)) delete clean.status
  if (clean.asset_no != null) {
    const a = String(clean.asset_no).trim()
    if (!a) throw new Error('An asset number is required.')
    clean.asset_no = a.slice(0, 120)
  }
  if (clean.driver_name != null) clean.driver_name = String(clean.driver_name).slice(0, 160) || null
  if (clean.defect_notes != null) clean.defect_notes = String(clean.defect_notes).slice(0, 4000) || null
  if (clean.site != null) clean.site = String(clean.site).slice(0, 120) || null
  if (clean.defects_found != null) clean.defects_found = bool(clean.defects_found)
  if (clean.safe_to_operate != null) clean.safe_to_operate = bool(clean.safe_to_operate)
  return unwrap(await supabase.from('dvir_reports').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteDvirReport(id) {
  return unwrap(await supabase.from('dvir_reports').delete().eq('id', id))
}
