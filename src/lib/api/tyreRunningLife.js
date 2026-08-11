/**
 * tyreRunningLife service - loads the V488 get_tyre_running_life aggregate
 * (per active tyre: km/hours run vs current meters + projected remaining km).
 * Degrades to { ok: false } so the section renders an honest error state.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

/**
 * In-flight and recent results, keyed by country.
 *
 * This RPC is expensive: measured live, get_tyre_running_life('KSA') takes
 * 832 ms of server time and returns 3,612 rows / 2.2 MB. The Inspections page
 * asks for it on mount to build its tyre-due flags, and then asked for the WHOLE
 * payload again on every single row PDF export just to filter it to one asset.
 *
 * Deduping the in-flight promise is always correct - it is the same request,
 * already on its way. The short result cache is opt-in per caller, because a
 * screen with its own refresh control must be able to insist on a fresh read.
 */
const _cache = new Map()

/** Drop cached running-life payloads (after a change that would alter them). */
export function clearTyreRunningLifeCache() { _cache.clear() }

/**
 * @param {{country?:string, maxAgeMs?:number}} [opts] `maxAgeMs` lets a caller
 *   reuse a recent payload; omit it to always hit the server (the default, so
 *   no existing caller's freshness changes).
 */
export async function getTyreRunningLife({ country, maxAgeMs = 0 } = {}) {
  const key = country && country !== 'All' ? country : '__all__'
  const hit = _cache.get(key)
  if (hit) {
    // A request already on the wire is shared regardless of maxAgeMs: waiting
    // for it is strictly better than starting a second identical 832 ms read.
    if (hit.promise) return hit.promise
    if (maxAgeMs > 0 && Date.now() - hit.at < maxAgeMs) return hit.value
  }

  // Every failure used to collapse to a bare { ok: false }, so the page rendered
  // an empty table whether the read was denied, the network dropped, or there
  // genuinely are no tyres. "We could not look" and "there is nothing" are
  // opposite statements; the reason is carried so the page can say which.
  const promise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_tyre_running_life', {
        p_country: country && country !== 'All' ? country : null,
      })
      if (error) return { ok: false, reason: toUserMessage(error) }
      if (!data) return { ok: false, reason: 'The running-life service returned nothing.' }
      if (data.ok === false) return { ok: false, reason: data.reason || 'The running-life service could not build this view.' }
      return data
    } catch (e) {
      return { ok: false, reason: toUserMessage(e) }
    }
  })()

  _cache.set(key, { promise })
  const value = await promise
  // A failure is never cached - the next attempt must be allowed to succeed.
  if (value && value.ok !== false) _cache.set(key, { value, at: Date.now() })
  else _cache.delete(key)
  return value
}

const TARGET_COLS = 'id, country, size, vehicle_type, target_km, target_hours, note, updated_at'

/** List the org's manual tyre life targets ([] on any failure). */
export async function listTyreLifeTargets() {
  try {
    const { data, error } = await supabase.from('tyre_life_targets')
      .select(TARGET_COLS).order('size').order('vehicle_type')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

/**
 * Create or update a manual target (unique per country+size+vehicle_type).
 * A target may pin a size, a vehicle type, or BOTH - the most specific match
 * wins on every tyre (size+type > type only > size only).
 */
export async function saveTyreLifeTarget({ id, country, size, vehicle_type, target_km, target_hours, note }) {
  const km = target_km === '' || target_km == null ? null : Number(target_km)
  const hrs = target_hours === '' || target_hours == null ? null : Number(target_hours)
  const row = {
    country: country && country !== 'All' ? country : null,
    size: String(size || '').trim() || null,
    vehicle_type: vehicle_type ? String(vehicle_type).trim() : null,
    target_km: Number.isFinite(km) ? km : null,
    target_hours: Number.isFinite(hrs) ? hrs : null,
    note: note || null,
  }
  if (!row.size && !row.vehicle_type) throw new Error('Pick a tyre size or a vehicle type (or both).')
  if (row.target_km == null && row.target_hours == null) throw new Error('Set a target in km, in hours, or both.')
  if (id) {
    const { data, error } = await supabase.from('tyre_life_targets')
      .update({ ...row, updated_at: new Date().toISOString() }).eq('id', id).select(TARGET_COLS).single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('tyre_life_targets')
    .insert([row]).select(TARGET_COLS).single()
  if (error) throw error
  return data
}

export async function deleteTyreLifeTarget(id) {
  const { error } = await supabase.from('tyre_life_targets').delete().eq('id', id)
  if (error) throw error
}
