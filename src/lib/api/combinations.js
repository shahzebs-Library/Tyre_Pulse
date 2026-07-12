/**
 * Combinations service — Asset Combination Manager (V141). Links a prime-mover
 * asset to one or more trailer assets under a named, status-tracked combination.
 * RLS enforces org isolation; this layer keeps an explicit column list, null-safe
 * country scoping, and validates/normalises input, mirroring support.js.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { parseTrailerList } from '../combinations'

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
    const code = err?.code || err?.cause?.code
    const msg = String(err?.message || '')
    if (code === '42P01' || /relation .* does not exist|could not find the table/i.test(msg)) {
      return []
    }
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
