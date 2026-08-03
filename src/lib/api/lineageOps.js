/**
 * lineageOps service (V475) - Data Trust Phase 3: lineage graph + downstream
 * impact, trust alerts (from quality/reconciliation breaches) and releases.
 * Pass-throughs over the security-definer RPCs + org/global tables. Read paths
 * never throw; action paths surface errors.
 */
import { supabase, unwrap } from './_client'

const c = (country) => (country && country !== 'All' ? country : null)

// ── Lineage ──────────────────────────────────────────────────────────────────
export async function listDataAssets({ kind = null } = {}) {
  try {
    let q = supabase.from('data_assets').select('*').order('kind').order('name').limit(1000)
    if (kind) q = q.eq('kind', kind)
    const { data, error } = await q
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}
export async function getLineageGraph(assetId, { direction = 'both', depth = 4 } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_lineage_graph', { p_asset: assetId, p_direction: direction, p_depth: depth })
    if (error || !data) return { ok: false }
    return data
  } catch { return { ok: false } }
}
export async function getDownstreamImpact(assetId) {
  try {
    const { data, error } = await supabase.rpc('get_downstream_impact', { p_asset: assetId })
    if (error || !data) return { ok: false }
    return data
  } catch { return { ok: false } }
}

// ── Trust alerts ─────────────────────────────────────────────────────────────
export async function scanDataTrust(country = null) {
  return unwrap(await supabase.rpc('scan_data_trust', { p_country: c(country) }))
}
export async function listTrustAlerts({ status = null } = {}) {
  try {
    let q = supabase.from('trust_alerts').select('*').order('created_at', { ascending: false }).limit(300)
    if (status && status !== 'all') q = q.eq('status', status)
    const { data, error } = await q
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}
export async function ackTrustAlert(id, status = 'resolved') {
  return unwrap(await supabase.rpc('ack_trust_alert', { p_id: id, p_status: status }))
}

// ── Releases ─────────────────────────────────────────────────────────────────
export async function listReleases() {
  try {
    const [{ data: rels }, { data: impacts }] = await Promise.all([
      supabase.from('releases').select('*').order('released_at', { ascending: false }).limit(200),
      supabase.from('release_impacts').select('*').order('created_at', { ascending: false }).limit(1000),
    ])
    return { releases: Array.isArray(rels) ? rels : [], impacts: Array.isArray(impacts) ? impacts : [] }
  } catch { return { releases: [], impacts: [] } }
}
export async function recordRelease(version, notes = null) {
  return unwrap(await supabase.rpc('record_release', { p_version: version, p_notes: notes }))
}
export async function addReleaseImpact(releaseId, { asset = null, metric = null, impact = null, note = null } = {}) {
  return unwrap(await supabase.rpc('add_release_impact', { p_release: releaseId, p_asset: asset, p_metric: metric, p_impact: impact, p_note: note }))
}
