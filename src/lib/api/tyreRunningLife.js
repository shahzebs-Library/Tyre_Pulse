/**
 * tyreRunningLife service - loads the V488 get_tyre_running_life aggregate
 * (per active tyre: km/hours run vs current meters + projected remaining km).
 * Degrades to { ok: false } so the section renders an honest error state.
 */
import { supabase } from './_client'

export async function getTyreRunningLife({ country } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_tyre_running_life', {
      p_country: country && country !== 'All' ? country : null,
    })
    if (error) return { ok: false }
    return data && data.ok ? data : { ok: false }
  } catch {
    return { ok: false }
  }
}

const TARGET_COLS = 'id, country, size, vehicle_type, target_km, note, updated_at'

/** List the org's manual tyre life targets ([] on any failure). */
export async function listTyreLifeTargets() {
  try {
    const { data, error } = await supabase.from('tyre_life_targets')
      .select(TARGET_COLS).order('size').order('vehicle_type')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

/** Create or update a manual target (unique per country+size+vehicle_type). */
export async function saveTyreLifeTarget({ id, country, size, vehicle_type, target_km, note }) {
  const row = {
    country: country && country !== 'All' ? country : null,
    size: String(size || '').trim(),
    vehicle_type: vehicle_type ? String(vehicle_type).trim() : null,
    target_km: Number(target_km),
    note: note || null,
  }
  if (!row.size || !Number.isFinite(row.target_km)) throw new Error('A size and a target km are required.')
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
