/**
 * lineageOps.js - PURE engine for Data Trust Phase 3 (no I/O).
 * Shapers for the lineage graph, downstream impact, trust alerts and releases.
 * ASCII only; honest empty; no fabricated values.
 */

export const ASSET_KIND_LABEL = {
  table: 'Table', column: 'Column', metric: 'Metric', dashboard: 'Dashboard',
  import: 'Import', api: 'API', report: 'Report',
}
export const ASSET_KIND_TONE = {
  table: 'quiet', column: 'quiet', metric: 'accent', dashboard: 'good',
  import: 'info', api: 'info', report: 'warning',
}
export function assetKindLabel(k) { return ASSET_KIND_LABEL[k] || (k || 'Asset') }

/** Strip the "kind:" prefix from an asset id for display. */
export function assetShortName(assetId) {
  const s = String(assetId || '')
  const i = s.indexOf(':')
  return i >= 0 ? s.slice(i + 1) : s
}

/** Shape get_lineage_graph into { nodes, edges, byKind } split into upstream/downstream of the root. */
export function shapeGraph(json) {
  if (!json || json.ok !== true) return { root: null, nodes: [], edges: [], upstream: [], downstream: [], byKind: {} }
  const root = json.root
  const nodes = (Array.isArray(json.nodes) ? json.nodes : []).map((n) => ({
    assetId: n.asset_id, kind: n.kind, name: n.name || assetShortName(n.asset_id), module: n.module || null,
  }))
  const edges = (Array.isArray(json.edges) ? json.edges : []).map((e) => ({ from: e.from, to: e.to, type: e.type }))
  // An edge from the root (or reachable from root) is downstream; an edge into the root is upstream.
  const downSet = new Set()
  const upSet = new Set()
  const outFrom = (a, seen) => {
    for (const e of edges) if (e.from === a && !seen.has(e.to)) { seen.add(e.to); downSet.add(e.to); outFrom(e.to, seen) }
  }
  const inTo = (a, seen) => {
    for (const e of edges) if (e.to === a && !seen.has(e.from)) { seen.add(e.from); upSet.add(e.from); inTo(e.from, seen) }
  }
  outFrom(root, new Set())
  inTo(root, new Set())
  const byId = new Map(nodes.map((n) => [n.assetId, n]))
  const upstream = [...upSet].map((id) => byId.get(id)).filter(Boolean)
  const downstream = [...downSet].map((id) => byId.get(id)).filter(Boolean)
  const byKind = {}
  for (const n of nodes) byKind[n.kind] = (byKind[n.kind] || 0) + 1
  return { root, nodes, edges, upstream, downstream, byKind }
}

/** Shape get_downstream_impact into { impacted, counts, total }. */
export function shapeImpact(json) {
  if (!json || json.ok !== true) return { asset: null, impacted: [], counts: {}, total: 0 }
  const impacted = (Array.isArray(json.impacted) ? json.impacted : []).map((n) => ({
    assetId: n.asset_id, kind: n.kind, name: n.name || assetShortName(n.asset_id),
  }))
  return { asset: json.asset, impacted, counts: json.counts || {}, total: impacted.length }
}

// ── Trust alerts ─────────────────────────────────────────────────────────────
export function alertSummary(rows) {
  const a = Array.isArray(rows) ? rows : []
  return {
    total: a.length,
    open: a.filter((r) => r.status === 'open').length,
    quality: a.filter((r) => r.source === 'quality' && r.status === 'open').length,
    reconciliation: a.filter((r) => r.source === 'reconciliation' && r.status === 'open').length,
  }
}
export const ALERT_STATUSES = ['open', 'ack', 'resolved']
export function alertTone(severity) {
  const s = String(severity || '').toLowerCase()
  if (s === 'critical' || s === 'error') return 'danger'
  if (s === 'warning' || s === 'warn') return 'warning'
  return 'quiet'
}
