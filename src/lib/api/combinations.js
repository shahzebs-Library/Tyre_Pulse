/**
 * Combinations service — Asset Combination Manager (V141). Links a prime-mover
 * asset to one or more trailer assets under a named, status-tracked combination.
 * RLS enforces org isolation; this layer keeps an explicit column list, null-safe
 * country scoping, and validates/normalises input, mirroring support.js.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'
import { parseTrailerList } from '../combinations'

/** True when a Supabase error is a missing-relation (un-migrated table). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || '')
  return code === '42P01' || /relation .* does not exist|could not find the table/i.test(msg)
}

// Least-privilege column lists for the combined-unit intelligence reads.
const VEHICLE_COLS = 'asset_no,vehicle_type,make,model,status,is_active,site,country'
const TYRE_COLS =
  'id,asset_no,site,country,status,category,brand,size,position,cost_per_tyre,qty,' +
  'km_at_fitment,km_at_removal,total_km,tread_depth'

const COLS =
  'id,organisation_id,country,name,prime_mover_no,trailer_nos,site,status,notes,' +
  'created_by,created_at,updated_at'

export const COMBINATION_STATUSES = ['active', 'inactive']

/**
 * List combinations (newest first). Optional status/country filters. If the
 * backing table hasn't been migrated yet, resolve to [] rather than throwing so
 * the page can render its "apply migration" empty state.
 */
export async function listCombinations({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('asset_combinations').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    // Missing relation (table not migrated) → empty set, not a hard error.
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Create a combination. Requires a prime mover; coerces trailers to text[]. */
export async function createCombination(values = {}) {
  const primeMover = String(values.prime_mover_no || '').trim()
  if (!primeMover) throw new Error('A prime mover number is required.')
  const status = COMBINATION_STATUSES.includes(values.status) ? values.status : 'active'
  const payload = {
    name: values.name ? String(values.name).trim().slice(0, 200) : null,
    prime_mover_no: primeMover.slice(0, 100),
    trailer_nos: parseTrailerList(values.trailer_nos).slice(0, 50),
    site: values.site ? String(values.site).trim().slice(0, 200) : null,
    status,
    notes: values.notes ? String(values.notes).slice(0, 2000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('asset_combinations').insert(payload).select(COLS).single())
}

/** Patch a combination. Re-normalises trailer_nos when present. */
export async function updateCombination(id, patch = {}) {
  if (!id) throw new Error('A combination id is required.')
  const clean = { ...patch }
  delete clean.id; delete clean.created_at; delete clean.organisation_id; delete clean.created_by
  if ('prime_mover_no' in clean) {
    const pm = String(clean.prime_mover_no || '').trim()
    if (!pm) throw new Error('A prime mover number is required.')
    clean.prime_mover_no = pm.slice(0, 100)
  }
  if ('trailer_nos' in clean) clean.trailer_nos = parseTrailerList(clean.trailer_nos).slice(0, 50)
  if ('name' in clean) clean.name = clean.name ? String(clean.name).trim().slice(0, 200) : null
  if ('site' in clean) clean.site = clean.site ? String(clean.site).trim().slice(0, 200) : null
  if ('notes' in clean) clean.notes = clean.notes ? String(clean.notes).slice(0, 2000) : null
  if ('status' in clean && !COMBINATION_STATUSES.includes(clean.status)) delete clean.status
  return unwrap(await supabase.from('asset_combinations').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteCombination(id) {
  if (!id) throw new Error('A combination id is required.')
  return unwrap(await supabase.from('asset_combinations').delete().eq('id', id))
}

// ── Combined-unit intelligence reads ─────────────────────────────────────────

/**
 * Fleet-master rows for a specific set of member asset numbers (prime mover +
 * trailers), used to resolve a combination's members. Chunked `in()` queries so
 * a wide combination never overruns URL limits; country-scoped (null-safe).
 * Un-migrated `vehicle_fleet` → [] rather than a hard error.
 *
 * @param {string[]} assetNos
 * @param {{country?:string}} [opts]
 */
export async function listMemberVehicles(assetNos = [], { country } = {}) {
  const ids = [...new Set((Array.isArray(assetNos) ? assetNos : []).map((a) => String(a || '').trim()).filter(Boolean))]
  if (!ids.length) return []
  const CHUNK = 100
  try {
    const out = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK)
      let q = supabase.from('vehicle_fleet').select(VEHICLE_COLS).in('asset_no', slice)
      q = applyCountry(q, country)
      const rows = unwrap(await q)
      if (Array.isArray(rows)) out.push(...rows)
    }
    return out
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Every tyre record for a set of member asset numbers, fully paginated and
 * country-scoped. Powers the blended combined-unit rollup (spend, CPK, scrap,
 * position breakdown). Un-migrated `tyre_records` → [].
 *
 * @param {string[]} assetNos
 * @param {{country?:string}} [opts]
 */
export async function listMemberTyreRecords(assetNos = [], { country } = {}) {
  const ids = [...new Set((Array.isArray(assetNos) ? assetNos : []).map((a) => String(a || '').trim()).filter(Boolean))]
  if (!ids.length) return []
  const CHUNK = 100
  try {
    const out = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK)
      const rows = await fetchAllPages((from, to) => {
        const q = supabase.from('tyre_records').select(TYRE_COLS)
          .in('asset_no', slice)
          .order('asset_no', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, to)
        return applyCountry(q, country)
      })
      if (Array.isArray(rows)) out.push(...rows)
    }
    return out
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Convenience loader for the Unit-intelligence tab: given a combination row,
 * resolve its member asset numbers and fetch both the fleet-master rows and the
 * tyre records for those members in parallel. The page passes these into the
 * pure `computeCombinationRollup` for the actual maths.
 *
 * @param {{prime_mover_no?:string, trailer_nos?:string|string[]}} combo
 * @param {{country?:string}} [opts]
 * @returns {Promise<{vehicles:Array, tyres:Array}>}
 */
export async function getCombinationIntelligence(combo, { country } = {}) {
  const prime = String(combo?.prime_mover_no ?? '').trim()
  const trailers = parseTrailerList(combo?.trailer_nos)
  const assetNos = [...(prime ? [prime] : []), ...trailers]
  if (!assetNos.length) return { vehicles: [], tyres: [] }
  const [vehicles, tyres] = await Promise.all([
    listMemberVehicles(assetNos, { country }),
    listMemberTyreRecords(assetNos, { country }),
  ])
  return { vehicles: Array.isArray(vehicles) ? vehicles : [], tyres: Array.isArray(tyres) ? tyres : [] }
}
