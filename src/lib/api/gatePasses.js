/**
 * Gate-pass service — daily vehicle exit clearance (gate_passes) plus the
 * Phase-3 safety gate. A vehicle must NOT be released while critical safety
 * defects are open; clearing is refused (server-informed via gate_pass_blockers)
 * when open blockers exist. Explicit column lists; null-safe country scoping.
 */
import { supabase, unwrap, applyCountry, ServiceError } from './_client'

const COLS =
  'id,asset_no,site,country,pass_date,status,inspection_id,cleared_by,cleared_at,denial_reason,notes,created_at,organisation_id'

const CLEARED_STATUSES = new Set(['Cleared', 'cleared'])

/** List gate passes, newest first. Country-scoped (null-safe) + optional filters. */
export async function listGatePasses({ country, assetNo, site, status, passDate, limit = 100 } = {}) {
  let q = supabase.from('gate_passes').select(COLS).order('created_at', { ascending: false }).limit(limit)
  q = applyCountry(q, country)
  if (assetNo) q = q.eq('asset_no', assetNo)
  if (site) q = q.eq('site', site)
  if (status) q = q.eq('status', status)
  if (passDate) q = q.eq('pass_date', passDate)
  return unwrap(await q)
}

/**
 * Open critical safety blockers for an asset via the SECURITY DEFINER RPC.
 * Returns { asset_no, country, total, blocked, corrective_actions[], tyres[], inspections[] }.
 */
export async function listGatePassBlockers({ assetNo, country } = {}) {
  if (!assetNo || !String(assetNo).trim()) throw new ServiceError('assetNo is required', '22004')
  const { data, error } = await supabase.rpc('gate_pass_blockers', {
    p_asset_no: String(assetNo).trim(),
    p_country: country && country !== 'All' ? country : null,
  })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data || { asset_no: String(assetNo).trim(), country: null, total: 0, blocked: false, corrective_actions: [], tyres: [], inspections: [] }
}

/** Throw a ServiceError carrying the blockers payload when releasing is unsafe. */
function assertNotBlocked(blockers) {
  const err = new ServiceError(`Release blocked: ${blockers.total} open critical safety item(s) for ${blockers.asset_no}.`, 'BLOCKED')
  err.blockers = blockers
  throw err
}

/**
 * Create a gate pass. A "Cleared" status runs the safety gate first and REFUSES
 * with a BLOCKED ServiceError (carrying .blockers) when open critical defects
 * exist. Denied / Pending passes are never blocked. Returns { pass, blockers }.
 */
export async function createGatePass(values) {
  let blockers = null
  if (CLEARED_STATUSES.has(values?.status)) {
    blockers = await listGatePassBlockers({ assetNo: values.asset_no, country: values.country })
    if (blockers.blocked) assertNotBlocked(blockers)
  }
  const pass = unwrap(await supabase.from('gate_passes').insert(values).select(COLS).single())
  return { pass, blockers }
}

/**
 * Clear (release) an existing gate pass by id. Runs the safety gate and REFUSES
 * to set status='Cleared' when blockers exist. Returns { pass, blockers }.
 */
export async function clearGatePass(id, { clearedBy, notes } = {}) {
  if (!id) throw new ServiceError('id is required', '22004')
  const current = unwrap(await supabase.from('gate_passes').select(COLS).eq('id', id).maybeSingle())
  if (!current) throw new ServiceError('Gate pass not found', 'P0002')
  const blockers = await listGatePassBlockers({ assetNo: current.asset_no, country: current.country })
  if (blockers.blocked) assertNotBlocked(blockers)
  const pass = unwrap(
    await supabase.from('gate_passes').update({
      status: 'Cleared', cleared_by: clearedBy ?? null, cleared_at: new Date().toISOString(),
      ...(notes !== undefined ? { notes } : {}),
    }).eq('id', id).select(COLS).single(),
  )
  return { pass, blockers }
}
