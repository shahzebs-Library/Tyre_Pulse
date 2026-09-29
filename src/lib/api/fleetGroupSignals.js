/**
 * fleetGroupSignals - the reads behind the Fleet Groups page's per-group
 * figures (members, utilisation, issues, tyres). Group rows themselves still
 * come from ./fleetGroups.js; this file only reads the registers a group is
 * linked to through the site register (see src/lib/fleetGroupsView.js for the
 * membership rule).
 *
 * Every read is scoped to the member assets (or matched sites) only, chunked so
 * an `.in()` list stays short, and paged past the 1,000 row response cap. Each
 * signal fails on its own: a signal that could not be read comes back null so
 * the page can say "could not check" instead of showing a false zero.
 */
import { supabase, applyCountry, fetchAllPages, isMissingRelation, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { listSites } from './sites'
import { isActionClosed } from './correctiveActions'

const CHUNK = 150
const MAX_ROWS = 20000

const chunks = (arr, n = CHUNK) => {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/** Run one paged read per chunk of `values` and concatenate the rows. */
async function pagedIn(values, readChunk) {
  const out = []
  for (const part of chunks(values)) {
    const { data, error } = await readChunk(part)
    if (error) throw new ServiceError(toUserMessage(error), error.code, error)
    out.push(...(data || []))
  }
  return out
}

/** Site register rows for the scope (used to match groups to sites and read regions). */
export async function loadGroupSites({ country } = {}) {
  try {
    return await listSites({ country })
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export const MEMBER_COLS = 'id,asset_no,fleet_number,make,model,vehicle_type,site,country,status,ops_status'

/** Fleet register rows registered at any of the matched sites. */
export async function loadMemberFleet(siteNames = [], { country } = {}) {
  const names = [...new Set(siteNames.filter(Boolean))]
  if (!names.length) return []
  return pagedIn(names, (part) => fetchAllPages((from, to) =>
    applyCountry(supabase.from('vehicle_fleet').select(MEMBER_COLS), country)
      .in('site', part).order('asset_no', { ascending: true }).order('id', { ascending: true }).range(from, to), { max: MAX_ROWS }))
}

async function safe(fn) {
  try { return await fn() } catch { return null }
}

/**
 * Per-asset signals for the member assets. Each key is an array, or null when
 * that source could not be read.
 * @returns {Promise<{util, tyres, criticalTyres, actions, overduePm}>}
 */
export async function loadMemberSignals(assetNos = [], { country, today = new Date().toISOString().slice(0, 10) } = {}) {
  const assets = [...new Set(assetNos.filter(Boolean))]
  if (!assets.length) return { util: [], tyres: [], criticalTyres: [], actions: [], overduePm: [] }

  const [util, tyres, actions, pm] = await Promise.all([
    safe(() => pagedIn(assets, (part) => fetchAllPages((from, to) =>
      applyCountry(supabase.from('asset_utilization').select('id,asset_no,country,utilization_pct,captured_at'), country)
        .in('asset_no', part).order('id', { ascending: true }).range(from, to), { max: MAX_ROWS }))),
    safe(() => pagedIn(assets, (part) => fetchAllPages((from, to) =>
      applyCountry(supabase.from('tyre_records').select('id,asset_no,country,status,risk_level'), country)
        .in('asset_no', part).eq('status', 'Active').order('id', { ascending: true }).range(from, to), { max: MAX_ROWS }))),
    safe(() => pagedIn(assets, (part) => fetchAllPages((from, to) =>
      applyCountry(supabase.from('corrective_actions').select('id,asset_no,country,status'), country)
        .in('asset_no', part).order('id', { ascending: true }).range(from, to), { max: MAX_ROWS }))),
    safe(() => pagedIn(assets, (part) => fetchAllPages((from, to) =>
      applyCountry(supabase.from('pm_programs').select('id,asset_no,country,status,next_due'), country)
        .in('asset_no', part).eq('status', 'active').order('id', { ascending: true }).range(from, to), { max: MAX_ROWS }))),
  ])

  return {
    util,
    tyres,
    criticalTyres: tyres == null ? null : tyres.filter((t) => String(t?.risk_level ?? '').toLowerCase() === 'critical'),
    actions: actions == null ? null : actions.filter((a) => !isActionClosed(a?.status)),
    overduePm: pm == null ? null : pm.filter((p) => p?.next_due && String(p.next_due).slice(0, 10) < today),
  }
}

