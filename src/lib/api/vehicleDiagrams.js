/**
 * Vehicle Diagram configs service - the single Supabase boundary for
 * `vehicle_diagram_configs` (V268): per-org custom vehicle diagram layouts
 * designed in the super-admin Vehicle Designer (/console/vehicle-designer).
 *
 * RLS: every authenticated user can SELECT; only super-admin can write. This
 * layer never re-implements that gate. `vehicle_type` is stored UPPER/trimmed
 * to match the V245 vehicle_type canonicalisation, and the table is UNIQUE on
 * (organisation_id, vehicle_type), so upsert is an explicit lookup-then-write.
 *
 * `getCustomLayoutMap()` is the READ path the app's tyre diagrams consume:
 * one fetch per session (cached promise), returning { VEHICLE_TYPE: layout }
 * built via the pure engine for ACTIVE rows only. It never throws - a missing
 * table or any error degrades to {} so built-in layouts always remain the
 * fallback. Call `invalidateCustomLayouts()` after a designer save/delete.
 */
import { supabase, unwrap, ServiceError } from './_client'
import { normalizeDiagramConfig, positionsFromConfig } from '../vehicleDiagram'

const TABLE = 'vehicle_diagram_configs'
const COLS = 'id,organisation_id,vehicle_type,label,config,active,created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = String(err?.code || '')
  const msg = String(err?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache')
  )
}

/** Canonical storage form of a vehicle type key (matches V245: upper + trim). */
export function canonVehicleTypeKey(vt) {
  return String(vt ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * List every diagram config for the caller's org (RLS-scoped), A-Z by
 * vehicle type. Missing relation degrades to [].
 *
 * @returns {Promise<Array<object>>}
 */
export async function listVehicleDiagramConfigs() {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLS)
    .order('vehicle_type', { ascending: true })
  if (error) {
    if (isMissingRelation(error)) return []
    throw new ServiceError(error.message, error.code, error)
  }
  return data ?? []
}

/**
 * Create or update the config for a vehicle type (UNIQUE per org). The config
 * is normalized through the pure engine before persisting so the stored jsonb
 * is always valid and versioned. Returns the saved row.
 *
 * @param {{vehicle_type:string, label?:string, config:object, active?:boolean}} input
 * @returns {Promise<object>}
 */
export async function upsertVehicleDiagramConfig({ vehicle_type, label = '', config, active = true }) {
  const vt = canonVehicleTypeKey(vehicle_type)
  if (!vt) throw new ServiceError('Vehicle type is required.', 'invalid_vehicle_type')
  const payload = {
    vehicle_type: vt,
    label: String(label ?? '').trim() || null,
    config: normalizeDiagramConfig(config),
    active: active !== false,
    updated_at: new Date().toISOString(),
  }

  const existing = unwrap(
    await supabase.from(TABLE).select('id').eq('vehicle_type', vt).maybeSingle(),
  )
  if (existing?.id) {
    return unwrap(
      await supabase.from(TABLE).update(payload).eq('id', existing.id).select(COLS).single(),
    )
  }
  return unwrap(
    await supabase.from(TABLE).insert(payload).select(COLS).single(),
  )
}

/** Delete a diagram config by id. */
export async function deleteVehicleDiagramConfig(id) {
  if (!id) throw new ServiceError('Config id is required.', 'invalid_id')
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw new ServiceError(error.message, error.code, error)
  return { ok: true }
}

// ── Cached layout map for diagram consumption ──────────────────────────────────
let layoutMapPromise = null

/**
 * One-fetch-per-session map of ACTIVE custom layouts keyed by canonical
 * vehicle type: { 'TR-MIXER': layout, ... } where each layout is a
 * positionsFromConfig() result (same shape as a built-in LAYOUTS entry).
 * NEVER throws and never rejects - any failure resolves to {} so the tyre
 * diagram silently falls back to its built-in layouts.
 *
 * @returns {Promise<Record<string, object>>}
 */
export function getCustomLayoutMap() {
  if (!layoutMapPromise) {
    layoutMapPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from(TABLE)
          .select('vehicle_type,label,config,active')
          .eq('active', true)
        if (error || !Array.isArray(data)) return {}
        const map = {}
        for (const row of data) {
          const key = canonVehicleTypeKey(row.vehicle_type)
          if (!key) continue
          const layout = positionsFromConfig(row.config)
          layout.label = row.label || null
          map[key] = layout
        }
        return map
      } catch {
        return {}
      }
    })()
  }
  return layoutMapPromise
}

/** Drop the session cache so the next getCustomLayoutMap() refetches. */
export function invalidateCustomLayouts() {
  layoutMapPromise = null
}
