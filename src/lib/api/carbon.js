/**
 * Carbon Tracker service — reads the operational fuel-usage signal the fleet
 * already has and normalises it for the pure carbon maths in `src/lib/carbon.js`.
 *
 * There is deliberately NO dedicated emissions table. Fuel burned is derived
 * from the SAME source `FuelEfficiency` uses — the `tyre_records` table — where
 * each record's fitment→removal odometer gives a real distance travelled while
 * that tyre was fitted. The service returns lightweight, country-scoped rows;
 * litres and CO2 are computed downstream (single source of truth).
 *
 * Country-scoped (null-safe) and fully paginated so large fleets are never
 * silently truncated. A missing relation (fresh/partial schema) degrades to an
 * empty list rather than throwing — the page shows an honest empty state.
 */
import { supabase, applyCountry, fetchAllPages, unwrap, ServiceError } from './_client'

// Least-privilege select: only the columns carbon aggregation needs. Mirrors
// the fuel-relevant subset of FuelEfficiency's tyre_records query.
const COLS = 'id,asset_no,site,country,km_at_fitment,km_at_removal,issue_date'

// Lifecycle ESG model needs the class-join + qty/category/pressure/status signals.
const LIFECYCLE_TYRE_COLS =
  'id,asset_no,site,country,brand,category,status,qty,pressure_reading,' +
  'reason_for_removal,removal_reason,remarks,issue_date,fitment_date,removal_date'

const LIFECYCLE_VEHICLE_COLS =
  'id,asset_no,make,model,vehicle_type,site,country,status,is_active,current_km'

// Persisted, org-isolated ESG stores (V210). Explicit least-privilege selects.
const OFFSET_COLS =
  'id,provider,project,tonnes,aed_cost,trees_equivalent,purchased_at,notes,' +
  'created_by,country,created_at,updated_at'

const INITIATIVE_COLS =
  'id,name,description,claimed_savings_kg,owner,status,created_by,country,' +
  'created_at,updated_at'

const MISSING_RELATION = '42P01'

function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  if (code === MISSING_RELATION || code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table|schema cache/i.test(err?.message || '')
}

const asText = (v, max = 500) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asNumber = (v, field) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  if (!Number.isFinite(n)) throw new ServiceError(`${field} must be a number.`, 'VALIDATION')
  return n
}

/** Map a tyre record to a normalised fuel-usage row. */
function normalize(r) {
  const fit = Number(r?.km_at_fitment)
  const rem = Number(r?.km_at_removal)
  const distance_km =
    Number.isFinite(fit) && Number.isFinite(rem) && rem > fit ? rem - fit : null
  return {
    id: r?.id,
    vehicle: r?.asset_no || null,
    site: r?.site || null,
    date: r?.issue_date || null,
    distance_km,
  }
}

/**
 * Fetch normalised fuel-usage rows for the active country.
 * @param {{ country?: string }} [opts]
 * @returns {Promise<Array<{id:any, vehicle:string|null, site:string|null, date:string|null, distance_km:number|null}>>}
 */
export async function listFuelUsage({ country } = {}) {
  try {
    const { data, error } = await fetchAllPages((from, to) => {
      const q = supabase
        .from('tyre_records')
        .select(COLS)
        .order('issue_date', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, to)
      return applyCountry(q, country)
    })
    if (error) {
      if (isMissingRelation(error)) return []
      throw new ServiceError(error.message, error.code, error)
    }
    return (data ?? []).map(normalize)
  } catch (err) {
    if (isMissingRelation(err)) return []
    if (err instanceof ServiceError) throw err
    throw new ServiceError(err?.message || 'Failed to load fuel usage', err?.code, err)
  }
}

// ── Tyre-lifecycle ESG data (join tyre_records → vehicle_fleet) ───────────────

/** Paginated, country-scoped tyre_records for the lifecycle class model. */
async function listLifecycleTyres({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase
      .from('tyre_records')
      .select(LIFECYCLE_TYRE_COLS)
      .order('asset_no', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
  if (error) {
    if (isMissingRelation(error)) return []
    throw new ServiceError(error.message, error.code, error)
  }
  return data ?? []
}

/** Paginated, country-scoped vehicle_fleet rows (for vehicle_type → class join). */
async function listLifecycleVehicles({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase
      .from('vehicle_fleet')
      .select(LIFECYCLE_VEHICLE_COLS)
      .order('asset_no', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
  if (error) {
    if (isMissingRelation(error)) return []
    throw new ServiceError(error.message, error.code, error)
  }
  return data ?? []
}

/**
 * Load both datasets the lifecycle ESG roll-up needs. Vehicle master data is
 * best-effort: an error/empty there never blocks the tyre-based model (assets
 * without a fleet match fall back to the 'default' class downstream).
 * @param {{ country?: string }} [opts]
 * @returns {Promise<{ tyres: Array, vehicles: Array }>}
 */
export async function getLifecycleCarbonData({ country } = {}) {
  const [tyres, vehicles] = await Promise.all([
    listLifecycleTyres({ country }),
    listLifecycleVehicles({ country }).catch(() => []),
  ])
  return {
    tyres: Array.isArray(tyres) ? tyres : [],
    vehicles: Array.isArray(vehicles) ? vehicles : [],
  }
}

// ── Carbon offsets ledger (V210 carbon_offsets — real, org-isolated) ──────────

/**
 * List carbon offset purchases (newest first). Returns [] pre-migration.
 * @param {{ country?: string, limit?: number }} [opts]
 */
export async function listOffsets({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('carbon_offsets').select(OFFSET_COLS)
    q = applyCountry(q, country)
    return unwrap(await q.order('purchased_at', { ascending: false, nullsFirst: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Record a carbon offset purchase. Requires tonnes > 0. trees_equivalent is
 * derived (1 tonne ≈ 45 trees/yr) unless caller supplies one. RLS enforces
 * org isolation and elevated-role writes.
 */
export async function createOffset(values = {}) {
  const tonnes = asNumber(values.tonnes, 'Tonnes')
  if (tonnes == null || tonnes <= 0) throw new ServiceError('Tonnes must be greater than zero.', 'VALIDATION')
  const aedCost = asNumber(values.aed_cost, 'AED cost')
  const treesEq = asNumber(values.trees_equivalent, 'Trees equivalent')
  const payload = {
    provider: asText(values.provider, 200) || 'Verra Registry',
    project: asText(values.project, 200) || 'UAE Mangrove Restoration',
    tonnes: Math.round(tonnes * 100) / 100,
    aed_cost: aedCost != null ? Math.round(aedCost) : Math.round(tonnes * 90),
    trees_equivalent: treesEq != null ? Math.round(treesEq) : Math.round(tonnes * 45),
    notes: asText(values.notes, 2000),
    country: asText(values.country, 120),
  }
  return unwrap(await supabase.from('carbon_offsets').insert(payload).select(OFFSET_COLS).single())
}

export async function deleteOffset(id) {
  return unwrap(await supabase.from('carbon_offsets').delete().eq('id', id))
}

// ── Reduction initiatives register (V210 carbon_initiatives — real store) ─────

/**
 * List reduction initiatives (newest first). Returns [] pre-migration.
 * @param {{ country?: string, limit?: number }} [opts]
 */
export async function listInitiatives({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('carbon_initiatives').select(INITIATIVE_COLS)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Create a reduction initiative. Requires a name; status defaults to 'active'. */
export async function createInitiative(values = {}) {
  const name = asText(values.name, 200)
  if (!name) throw new ServiceError('An initiative name is required.', 'VALIDATION')
  const savings = asNumber(values.claimed_savings_kg, 'Claimed savings')
  const payload = {
    name,
    description: asText(values.description, 2000),
    claimed_savings_kg: savings != null ? Math.round(savings) : null,
    owner: asText(values.owner, 160),
    status: asText(values.status, 40) || 'active',
    country: asText(values.country, 120),
  }
  return unwrap(await supabase.from('carbon_initiatives').insert(payload).select(INITIATIVE_COLS).single())
}

export async function deleteInitiative(id) {
  return unwrap(await supabase.from('carbon_initiatives').delete().eq('id', id))
}
