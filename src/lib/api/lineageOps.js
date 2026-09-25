/**
 * lineageOps service (V475) - Data Trust Phase 3: lineage graph + downstream
 * impact, trust alerts (from quality/reconciliation breaches) and releases.
 * Pass-throughs over the security-definer RPCs + org/global tables. Read paths
 * are honest: [] only when a relation is not provisioned (by code); a real
 * failure throws so the page shows an error. Action paths surface errors.
 */
import { supabase, unwrap, fetchAllPages, isNotProvisioned, ServiceError } from './_client'
import { toUserMessage } from '../safeError'

const c = (country) => (country && country !== 'All' ? country : null)

/** Ceiling for the paged reads below (data_assets / release_impacts). */
export const LINEAGE_READ_MAX = 20000

/** [] only when the relation is genuinely not provisioned; otherwise throw. */
function readRows(res) {
  if (res?.error && isNotProvisioned(res.error)) return []
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

/** Same contract for a paged read ({data, error, truncated}). */
function readPaged(res) {
  if (res?.error) {
    if (isNotProvisioned(res.error)) return []
    throw new ServiceError(toUserMessage(res.error), res.error.code, res.error)
  }
  return Array.isArray(res?.data) ? res.data : []
}

/**
 * A json RPC read. A failed call THROWS; a payload the server itself marks
 * `ok:false` also throws with its reason, because shaping it would render an
 * empty graph that reads as "this asset has no lineage".
 */
function readJson(res, what) {
  const data = unwrap(res)
  if (!data) throw new ServiceError(`${what} returned nothing.`, 'EMPTY', null)
  if (data.ok === false) {
    throw new ServiceError(data.message || data.reason ? `${what}: ${data.message || data.reason}` : `${what} could not be produced.`, data.reason || 'NOT_OK', data)
  }
  return data
}

// ── Lineage ──────────────────────────────────────────────────────────────────
/**
 * Every registered data asset, paged past the 1,000-row cap (kind, name, then
 * asset_id as the unique tiebreak). Throws on a real failure.
 */
export async function listDataAssets({ kind = null } = {}) {
  const res = await fetchAllPages((from, to) => {
    let q = supabase.from('data_assets').select('*')
    if (kind) q = q.eq('kind', kind)
    return q.order('kind').order('name').order('asset_id').range(from, to)
  }, { max: LINEAGE_READ_MAX })
  return readPaged(res)
}
export async function getLineageGraph(assetId, { direction = 'both', depth = 4 } = {}) {
  return readJson(
    await supabase.rpc('get_lineage_graph', { p_asset: assetId, p_direction: direction, p_depth: depth }),
    'Lineage graph',
  )
}
export async function getDownstreamImpact(assetId) {
  return readJson(await supabase.rpc('get_downstream_impact', { p_asset: assetId }), 'Downstream impact')
}

// ── Trust alerts ─────────────────────────────────────────────────────────────
/** Newest-first window of trust alerts; under the 1,000 cap in one request. */
export const TRUST_ALERTS_WINDOW = 300

export async function scanDataTrust(country = null) {
  return unwrap(await supabase.rpc('scan_data_trust', { p_country: c(country) }))
}
/** Most recent trust alerts. Throws on a real failure. */
export async function listTrustAlerts({ status = null } = {}) {
  let q = supabase.from('trust_alerts').select('*').order('created_at', { ascending: false }).limit(TRUST_ALERTS_WINDOW)
  if (status && status !== 'all') q = q.eq('status', status)
  return readRows(await q)
}
export async function ackTrustAlert(id, status = 'resolved') {
  return unwrap(await supabase.rpc('ack_trust_alert', { p_id: id, p_status: status }))
}

// ── Releases ─────────────────────────────────────────────────────────────────
/**
 * The 200 most recent releases plus ALL their impacts (impacts paged past the
 * 1,000-row cap, `id` tiebreak). A failed read of either THROWS - releases
 * shown with no impacts would claim a release changed nothing.
 */
export async function listReleases() {
  const [relsRes, impactsRes] = await Promise.all([
    supabase.from('releases').select('*').order('released_at', { ascending: false }).limit(200),
    fetchAllPages(
      (from, to) => supabase.from('release_impacts').select('*')
        .order('created_at', { ascending: false }).order('id').range(from, to),
      { max: LINEAGE_READ_MAX },
    ),
  ])
  return { releases: readRows(relsRes), impacts: readPaged(impactsRes) }
}
export async function recordRelease(version, notes = null) {
  return unwrap(await supabase.rpc('record_release', { p_version: version, p_notes: notes }))
}
export async function addReleaseImpact(releaseId, { asset = null, metric = null, impact = null, note = null } = {}) {
  return unwrap(await supabase.rpc('add_release_impact', { p_release: releaseId, p_asset: asset, p_metric: metric, p_impact: impact, p_note: note }))
}
