/**
 * assetUtilization — the single Supabase seam for the Fleet Utilization surface.
 *
 * Reads the `asset_utilization` table (V406): per-asset telematics snapshots
 * (working / driving / idle time, distance, utilization %, max speed, latest
 * odometer) loaded from the country telematics exports (ksa_kms / uae_kms). RLS
 * enforces org isolation + country scope; this layer keeps an explicit
 * least-privilege column list and null-safe country scoping.
 *
 * Each row's authoritative `current_km` is merged from `vehicle_fleet` (advanced
 * by the odometer pipe) so the page shows the same current km as Fleet Master /
 * Asset Detail. Before the migration is applied every read degrades to [] so the
 * page can surface an honest "not provisioned yet" empty state instead of
 * throwing. All pure analytics live in `src/lib/fleetUtilization.js`.
 */
import { supabase, unwrap, applyCountry, fetchAllPages, isMissingRelation } from './_client'

export const COLS =
  'id,organisation_id,country,asset_no,make,model,captured_at,' +
  'working_seconds,driving_seconds,idle_seconds,idle_pct,distance_km,' +
  'max_speed,utilization_pct,odo_end,linked_to_fleet,source,created_at'

/**
 * List every utilization row (country scoped), each enriched with the fleet's
 * authoritative `current_km`. Returns [] when the table is not deployed.
 * @param {{ country?: string }} [opts]
 */
export async function listAssetUtilization({ country } = {}) {
  let rows
  try {
    const { data, error } = await fetchAllPages((from, to) =>
      applyCountry(supabase.from('asset_utilization').select(COLS), country)
        .order('utilization_pct', { ascending: false, nullsFirst: false })
        .order('asset_no', { ascending: true })
        .range(from, to),
    )
    if (error) throw error
    rows = data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
  if (!rows.length) return []

  // Merge authoritative current_km from the fleet register (by asset_no + country).
  let fleet = []
  try {
    const { data, error } = await fetchAllPages((from, to) =>
      applyCountry(supabase.from('vehicle_fleet').select('asset_no,country,current_km'), country)
        .order('asset_no', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
    if (error) throw error
    fleet = data || []
  } catch (err) {
    if (!isMissingRelation(err)) throw err
  }
  const kmByKey = new Map()
  for (const f of fleet) {
    if (f?.asset_no == null) continue
    kmByKey.set(`${String(f.asset_no).trim().toUpperCase()}|${f.country || ''}`, f.current_km)
  }
  return rows.map((r) => ({
    ...r,
    current_km:
      kmByKey.get(`${String(r.asset_no || '').trim().toUpperCase()}|${r.country || ''}`) ?? r.odo_end ?? null,
  }))
}

/**
 * The utilization snapshot for a single asset (Asset Detail panel). Country
 * optional; returns the most recent capture or null.
 */
export async function getAssetUtilization(assetNo, { country } = {}) {
  if (!assetNo) return null
  try {
    let q = supabase
      .from('asset_utilization')
      .select(COLS)
      .eq('asset_no', String(assetNo).trim().toUpperCase())
    if (country && country !== 'All') q = q.eq('country', country)
    const data = unwrap(await q.order('captured_at', { ascending: false, nullsFirst: false }).limit(1))
    return data?.[0] || null
  } catch (err) {
    if (isMissingRelation(err)) return null
    throw err
  }
}
