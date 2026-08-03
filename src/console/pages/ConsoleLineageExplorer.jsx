/**
 * ConsoleLineageExplorer.jsx - trace where a number comes from and what it feeds.
 *
 * Pick any table, metric or dashboard on the left; the right side traces it
 * UPSTREAM to its sources and DOWNSTREAM to everything a change to it would
 * affect. Two questions a data owner always has and could never answer before:
 *   1. Where does this figure come from?   upstream sources
 *   2. What breaks if I change it?         downstream impact
 *
 * Honest by construction: an asset with no recorded lineage says so rather than
 * looking broken, and nothing is inferred that the graph does not carry.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GitBranch, ArrowUp, ArrowDown, ArrowRight, Database, BarChart3,
  LayoutDashboard, RefreshCw, AlertTriangle,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, SearchInput,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Toolbar,
} from '../components/ui'
import { listDataAssets, getLineageGraph, getDownstreamImpact } from '../../lib/api/lineageOps'
import {
  shapeGraph, shapeImpact, assetKindLabel, assetShortName, ASSET_KIND_TONE,
} from '../../lib/lineageOps'
import EChart from '../../components/charts/EChart'
import { toUserMessage } from '../../lib/safeError'

const nf = new Intl.NumberFormat('en-US')

const KIND_ICON = { table: Database, metric: BarChart3, dashboard: LayoutDashboard }
function kindIcon(kind) { return KIND_ICON[kind] || Database }

/** Node colour by kind, on the dark console surface. */
const NODE_COLOR = { table: '#38bdf8', metric: '#f59e0b', dashboard: '#34d399' }
const CENTER_COLOR = '#fb923c'
const GRAPH_CAP = 16 // per side, to keep the diagram legible

/**
 * Build an ECharts node-link option from the shaped lineage graph: upstream in
 * the left column, the selected asset in the centre, downstream on the right,
 * arrows pointing the way a change propagates. Positions are fixed (layout
 * 'none') so the three columns read left-to-right; the user can pan/zoom.
 */
function buildLineageOption(asset, graph, impact) {
  const upstream = (graph?.upstream || []).slice(0, GRAPH_CAP)
  const downSource = impact?.impacted?.length ? impact.impacted : (graph?.downstream || [])
  const downstream = downSource.slice(0, GRAPH_CAP)
  const centerId = asset.asset_id
  const centerName = asset.name || assetShortName(asset.asset_id)

  const colGap = 340
  const rowGap = 58
  const nodes = []
  const seen = new Set()
  const add = (id, name, kind, col, idx, count, isCenter) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    nodes.push({
      id,
      name: name || assetShortName(id),
      x: col * colGap,
      y: (idx - (count - 1) / 2) * rowGap,
      symbolSize: isCenter ? 46 : 28,
      itemStyle: { color: isCenter ? CENTER_COLOR : (NODE_COLOR[kind] || '#94a3b8') },
      label: { color: '#e5e7eb', fontSize: isCenter ? 12 : 10 },
      value: assetKindLabel(kind),
    })
  }
  upstream.forEach((n, i) => add(n.assetId, n.name, n.kind, 0, i, upstream.length || 1, false))
  add(centerId, centerName, asset.kind, 1, 0, 1, true)
  downstream.forEach((n, i) => add(n.assetId, n.name, n.kind, 2, i, downstream.length || 1, false))

  const drawn = new Set(nodes.map((n) => n.id))
  const links = []
  const linkSeen = new Set()
  const link = (from, to) => {
    if (!drawn.has(from) || !drawn.has(to)) return
    const k = `${from}->${to}`
    if (linkSeen.has(k)) return
    linkSeen.add(k)
    links.push({ source: from, target: to })
  }
  for (const e of (graph?.edges || [])) link(e.from, e.to)
  // Guarantee the centre is connected even when an edge row is absent.
  upstream.forEach((n) => link(n.assetId, centerId))
  downstream.forEach((n) => link(centerId, n.assetId))

  return {
    backgroundColor: 'transparent',
    animationDuration: 300,
    tooltip: { trigger: 'item', formatter: (p) => (p.dataType === 'node' ? `${p.name}<br/>${p.value || ''}` : '') },
    series: [{
      type: 'graph',
      layout: 'none',
      roam: true,
      draggable: true,
      edgeSymbol: ['none', 'arrow'],
      edgeSymbolSize: 9,
      label: { show: true, position: 'bottom', formatter: '{b}' },
      lineStyle: { color: '#475569', width: 1.4, curveness: 0.06, opacity: 0.85 },
      emphasis: { focus: 'adjacency', lineStyle: { width: 2.6, color: '#fb923c' } },
      data: nodes,
      links,
    }],
  }
}

/** The engine's ASSET_KIND_TONE vocabulary already lines up with the kit's
 *  Badge tones (quiet/accent/good/info/warning); fall back to quiet. */
function kindTone(kind) { return ASSET_KIND_TONE[kind] || 'quiet' }

const KIND_FILTERS = [
  { value: '', label: 'All assets' },
  { value: 'table', label: 'Tables' },
  { value: 'metric', label: 'Metrics' },
  { value: 'dashboard', label: 'Dashboards' },
]

function AssetBadge({ kind }) {
  return (
    <Badge tone={kindTone(kind)} icon={kindIcon(kind)}>{assetKindLabel(kind)}</Badge>
  )
}

export default function ConsoleLineageExplorer() {
  const [assets, setAssets] = useState({ loading: true, error: null, rows: [] })
  const [kind, setKind] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)   // asset row
  const [detail, setDetail] = useState(null)        // { graph, impact, loading, error }
  const [showEdges, setShowEdges] = useState(false)

  const loadAssets = useCallback(async () => {
    setAssets((s) => ({ ...s, loading: true, error: null }))
    try {
      const rows = await listDataAssets({ kind: kind || null })
      setAssets({ loading: false, error: null, rows })
    } catch (e) {
      setAssets({ loading: false, error: toUserMessage(e), rows: [] })
    }
  }, [kind])

  useEffect(() => { loadAssets() }, [loadAssets])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = assets.rows || []
    if (!q) return rows
    return rows.filter((a) =>
      String(a.name || '').toLowerCase().includes(q)
      || String(a.module || '').toLowerCase().includes(q)
      || String(a.asset_id || '').toLowerCase().includes(q))
  }, [assets.rows, search])

  const loadDetail = useCallback(async (asset) => {
    if (!asset) return
    setDetail({ graph: null, impact: null, loading: true, error: null })
    setShowEdges(false)
    try {
      const [graphJson, impactJson] = await Promise.all([
        getLineageGraph(asset.asset_id, { direction: 'both', depth: 4 }),
        getDownstreamImpact(asset.asset_id),
      ])
      setDetail({
        graph: shapeGraph(graphJson),
        impact: shapeImpact(impactJson),
        loading: false,
        error: null,
      })
    } catch (e) {
      setDetail({ graph: null, impact: null, loading: false, error: toUserMessage(e) })
    }
  }, [])

  const selectAsset = (asset) => {
    setSelected(asset)
    loadDetail(asset)
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          icon={GitBranch}
          title="Data Lineage Explorer"
          subtitle="Trace any table, metric or dashboard upstream to its sources and downstream to everything it affects."
          actions={<Btn icon={RefreshCw} onClick={loadAssets}>Refresh</Btn>}
        />
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── asset picker ────────────────────────────────────────────────── */}
        <Panel className="lg:col-span-1">
          <PanelHeader icon={Database} title="Assets" subtitle="Pick one to trace its lineage." />
          <Toolbar className="mb-3">
            <Select
              value={kind}
              onChange={setKind}
              options={KIND_FILTERS}
              className="w-40"
            />
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search name or module"
              className="flex-1 min-w-[10rem]"
            />
          </Toolbar>

          {assets.loading ? (
            <LoadingState label="Loading assets" rows={6} />
          ) : assets.error ? (
            <ErrorState message={assets.error} onRetry={loadAssets} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Database}
              title="No assets found"
              reason={
                (assets.rows || []).length === 0
                  ? 'No data assets have been registered for lineage yet.'
                  : 'No asset matches your filter. Clear the search or change the kind.'
              }
            />
          ) : (
            <div className="max-h-[32rem] overflow-y-auto space-y-1 pr-1">
              {filtered.map((a) => {
                const on = selected?.asset_id === a.asset_id
                return (
                  <button
                    key={a.asset_id}
                    onClick={() => selectAsset(a)}
                    className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                      on
                        ? 'border-orange-600/60 bg-orange-950/20'
                        : 'border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-100 truncate">{a.name || assetShortName(a.asset_id)}</span>
                      <AssetBadge kind={a.kind} />
                    </div>
                    {a.module && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{a.module}</p>}
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        {/* ── lineage detail ──────────────────────────────────────────────── */}
        <Panel className="lg:col-span-2">
          {!selected ? (
            <EmptyState
              icon={GitBranch}
              title="Select an asset to trace its lineage"
              reason="Choose a table, metric or dashboard on the left to see where its data comes from and what it affects."
            />
          ) : detail?.loading ? (
            <LoadingState label="Tracing lineage" rows={5} />
          ) : detail?.error ? (
            <ErrorState message={detail.error} onRetry={() => loadDetail(selected)} />
          ) : (
            <LineageDetail
              asset={selected}
              graph={detail?.graph}
              impact={detail?.impact}
              showEdges={showEdges}
              onToggleEdges={() => setShowEdges((v) => !v)}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}

function LineageDetail({ asset, graph, impact, showEdges, onToggleEdges }) {
  const upstream = graph?.upstream || []
  const downstream = graph?.downstream || []
  const impacted = impact?.impacted || []
  const edges = graph?.edges || []
  const impactTotal = impact?.total || 0
  const nameById = useMemo(() => {
    const m = new Map()
    for (const n of (graph?.nodes || [])) m.set(n.assetId, n.name)
    return m
  }, [graph])

  const nothing = upstream.length === 0 && downstream.length === 0 && impacted.length === 0
  const lineageOption = useMemo(
    () => (nothing ? null : buildLineageOption(asset, graph, impact)),
    [nothing, asset, graph, impact],
  )
  const capped = upstream.length > GRAPH_CAP
    || (impacted.length ? impacted.length : downstream.length) > GRAPH_CAP

  return (
    <div className="space-y-4">
      <PanelHeader
        icon={kindIcon(asset.kind)}
        title={asset.name || assetShortName(asset.asset_id)}
        subtitle={asset.module || 'Selected asset'}
        actions={<AssetBadge kind={asset.kind} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Upstream sources"
          value={nf.format(upstream.length)}
          sub={upstream.length ? 'feed this asset' : 'no recorded sources'}
          icon={ArrowUp}
          tone={upstream.length ? 'accent' : 'muted'}
        />
        <StatTile
          label="Downstream affected"
          value={nf.format(impactTotal)}
          sub={impactTotal ? 'items a change would touch' : 'nothing depends on it'}
          icon={ArrowDown}
          tone={impactTotal ? 'warning' : 'muted'}
        />
        {impact?.counts?.metric != null && (
          <StatTile label="Metrics affected" value={nf.format(impact.counts.metric)} icon={BarChart3} />
        )}
        {impact?.counts?.dashboard != null && (
          <StatTile label="Dashboards affected" value={nf.format(impact.counts.dashboard)} icon={LayoutDashboard} tone="good" />
        )}
      </div>

      {nothing ? (
        <EmptyState
          icon={GitBranch}
          title="No lineage recorded yet"
          reason="This asset has no recorded upstream sources or downstream dependents. Lineage appears here once the graph carries an edge for it."
        />
      ) : (
        <>
          {/* visualization */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <GitBranch size={14} className="text-orange-400" />
              <h4 className="text-sm font-semibold text-gray-200">Visualization</h4>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-2">
              <EChart option={lineageOption} style={{ height: 360 }} ariaLabel="Lineage diagram" />
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Sources on the left feed this asset; arrows point to what a change affects. Drag to pan, scroll to zoom.
              {capped ? ` Showing the first ${GRAPH_CAP} on each side - the tables below list every one.` : ''}
            </p>
          </div>

          {/* upstream */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ArrowUp size={14} className="text-orange-400" />
              <h4 className="text-sm font-semibold text-gray-200">Upstream (where the data comes from)</h4>
            </div>
            {upstream.length === 0 ? (
              <Note>No upstream sources are recorded for this asset - it is treated as an origin.</Note>
            ) : (
              <Table>
                <THead>
                  <Th>Source</Th>
                  <Th>Kind</Th>
                  <Th>Module</Th>
                </THead>
                <tbody>
                  {upstream.map((n) => (
                    <Tr key={n.assetId}>
                      <Td><span className="font-medium text-gray-100">{n.name}</span></Td>
                      <Td><AssetBadge kind={n.kind} /></Td>
                      <Td>{n.module || 'Not set'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>

          {/* downstream */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ArrowDown size={14} className="text-amber-400" />
              <h4 className="text-sm font-semibold text-gray-200">Downstream (what this affects - impact of a change)</h4>
            </div>
            {impacted.length === 0 ? (
              <Note>Nothing depends on this asset - changing it affects no downstream metric or dashboard.</Note>
            ) : (
              <>
                <Table>
                  <THead>
                    <Th>Affected asset</Th>
                    <Th>Kind</Th>
                  </THead>
                  <tbody>
                    {impacted.map((n) => (
                      <Tr key={n.assetId}>
                        <Td><span className="font-medium text-gray-100">{n.name}</span></Td>
                        <Td><AssetBadge kind={n.kind} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <div className="mt-2">
                  <Note icon={AlertTriangle} tone="warning">
                    Changing this asset affects the {nf.format(impactTotal)} item{impactTotal === 1 ? '' : 's'} above.
                  </Note>
                </div>
              </>
            )}
          </div>

          {/* edges (raw graph) */}
          {edges.length > 0 && (
            <div>
              <Toolbar className="mb-2">
                <Btn icon={GitBranch} onClick={onToggleEdges}>
                  {showEdges ? 'Hide' : 'Show'} edges ({nf.format(edges.length)})
                </Btn>
              </Toolbar>
              {showEdges && (
                <Table>
                  <THead>
                    <Th>From</Th>
                    <Th>Relationship</Th>
                    <Th>To</Th>
                  </THead>
                  <tbody>
                    {edges.map((e, i) => (
                      <Tr key={`${e.from}:${e.to}:${i}`}>
                        <Td nowrap>{nameById.get(e.from) || assetShortName(e.from)}</Td>
                        <Td>
                          <span className="inline-flex items-center gap-1 text-gray-400">
                            <ArrowRight size={12} />
                            {e.type || 'feeds'}
                          </span>
                        </Td>
                        <Td nowrap>{nameById.get(e.to) || assetShortName(e.to)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
