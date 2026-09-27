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
 *
 * Layout: header, kind tiles, a paged asset picker and the lineage of the
 * selected asset split into views (diagram / upstream / downstream / edges).
 * The selected asset lives in ?asset=<asset_id> so another console page (the
 * Metric Catalogue) can deep-link straight to a trace. Clicking a source or an
 * affected asset re-centres the trace on it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  GitBranch, ArrowUp, ArrowDown, ArrowRight, Database, BarChart3,
  LayoutDashboard, AlertTriangle, Network,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Select, SearchInput, Segmented,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Toolbar,
} from '../components/ui'
import { useChartTheme } from '../components/ui/charts'
import { listDataAssets, getLineageGraph, getDownstreamImpact } from '../../lib/api/lineageOps'
import {
  shapeGraph, shapeImpact, assetKindLabel, assetShortName, ASSET_KIND_TONE,
} from '../../lib/lineageOps'
import EChart from '../../components/charts/EChart'
import { toUserMessage } from '../../lib/safeError'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, usePaged, Pager } from './shared/pageKit'

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
function buildLineageOption(asset, graph, impact, theme = 'dark') {
  // Labels and edges follow the console theme; a fixed near-white label is
  // unreadable on the light surface.
  const labelInk = theme === 'light' ? '#1f2937' : '#e5e7eb'
  const edgeInk = theme === 'light' ? '#9ca3af' : '#475569'
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
      label: { color: labelInk, fontSize: isCenter ? 12 : 10 },
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
      lineStyle: { color: edgeInk, width: 1.4, curveness: 0.06, opacity: 0.85 },
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

const LINEAGE_EXPORT = [
  { key: 'direction', header: 'Direction' },
  { key: 'name', header: 'Asset' },
  { key: 'kind', header: 'Kind', value: (r) => assetKindLabel(r.kind) },
  { key: 'module', header: 'Module', value: (r) => r.module || 'Not set' },
]

function AssetBadge({ kind }) {
  return (
    <Badge tone={kindTone(kind)} icon={kindIcon(kind)}>{assetKindLabel(kind)}</Badge>
  )
}

export default function ConsoleLineageExplorer() {
  const [assets, setAssets] = useState({ loading: true, error: null, rows: [], at: null })
  const [kind, setKind] = useState('')
  const [search, setSearch] = useState('')
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('asset') || null
  const [detail, setDetail] = useState(null)        // { graph, impact, loading, error }
  const [view, setView] = useState('diagram')

  const loadAssets = useCallback(async () => {
    setAssets((s) => ({ ...s, loading: true, error: null }))
    try {
      // Read every kind once and filter locally, so the per-kind tiles stay
      // true while one kind is selected.
      const rows = await listDataAssets({ kind: null })
      setAssets({ loading: false, error: null, rows: Array.isArray(rows) ? rows : [], at: new Date() })
    } catch (e) {
      setAssets({ loading: false, error: toUserMessage(e), rows: [], at: null })
    }
  }, [])

  useEffect(() => { loadAssets() }, [loadAssets])

  const kindCounts = useMemo(() => {
    const out = { table: 0, metric: 0, dashboard: 0 }
    for (const a of assets.rows || []) if (a.kind in out) out[a.kind] += 1
    return out
  }, [assets.rows])

  const filtered = useMemo(() => {
    const rows = (assets.rows || []).filter((a) => !kind || a.kind === kind)
    return searchRows(rows, search, ['name', 'module', 'asset_id'])
  }, [assets.rows, search, kind])
  const picker = usePaged(filtered, 20)

  // An asset named in the URL but not registered still traces: the graph RPC
  // is keyed on the id, so a deep link from another page is never a dead end.
  const selected = useMemo(() => {
    if (!selectedId) return null
    return (assets.rows || []).find((a) => a.asset_id === selectedId)
      || { asset_id: selectedId, kind: selectedId.split(':')[0] || null, name: assetShortName(selectedId), module: null }
  }, [selectedId, assets.rows])

  const loadDetail = useCallback(async (asset) => {
    if (!asset) return
    setDetail({ graph: null, impact: null, loading: true, error: null })
    try {
      const [graphJson, impactJson] = await Promise.all([
        getLineageGraph(asset.asset_id, { direction: 'both', depth: 4 }),
        getDownstreamImpact(asset.asset_id),
      ])
      setDetail({ graph: shapeGraph(graphJson), impact: shapeImpact(impactJson), loading: false, error: null })
    } catch (e) {
      setDetail({ graph: null, impact: null, loading: false, error: toUserMessage(e) })
    }
  }, [])

  useEffect(() => {
    if (selectedId) loadDetail({ asset_id: selectedId })
    else setDetail(null)
  }, [selectedId, loadDetail])

  const selectAsset = useCallback((assetOrId) => {
    const id = typeof assetOrId === 'string' ? assetOrId : assetOrId?.asset_id
    if (!id) return
    setView('diagram')
    setParams((prev) => { const p = new URLSearchParams(prev); p.set('asset', id); return p }, { replace: false })
  }, [setParams])

  return (
    <div className="space-y-4">
      <PageHeader
        icon={GitBranch}
        title="Data Lineage Explorer"
        purpose="Trace any table, metric or dashboard upstream to its sources and downstream to everything it affects."
        refreshedAt={assets.at}
        onRefresh={loadAssets}
        refreshing={assets.loading}
      />

      {!assets.loading && !assets.error && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Registered assets" value={nf.format((assets.rows || []).length)} icon={GitBranch}
            onClick={() => setKind('')} active={!kind} />
          <StatTile label="Tables" value={nf.format(kindCounts.table)} icon={Database}
            onClick={() => setKind((k) => (k === 'table' ? '' : 'table'))} active={kind === 'table'} />
          <StatTile label="Metrics" value={nf.format(kindCounts.metric)} icon={BarChart3}
            onClick={() => setKind((k) => (k === 'metric' ? '' : 'metric'))} active={kind === 'metric'} />
          <StatTile label="Dashboards" value={nf.format(kindCounts.dashboard)} icon={LayoutDashboard}
            onClick={() => setKind((k) => (k === 'dashboard' ? '' : 'dashboard'))} active={kind === 'dashboard'} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── asset picker ────────────────────────────────────────────────── */}
        <Panel className="lg:col-span-1">
          <PanelHeader icon={Database} title="Assets" subtitle="Pick one to trace its lineage." />
          <Toolbar className="mb-3">
            <Select ariaLabel="Asset kind" value={kind} onChange={setKind} options={KIND_FILTERS} className="w-40" />
            <SearchInput value={search} onChange={setSearch} placeholder="Search name or module" className="flex-1 min-w-[10rem]" />
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
            <>
              <div className="space-y-1">
                {picker.pageRows.map((a) => {
                  const on = selectedId === a.asset_id
                  return (
                    <button
                      key={a.asset_id}
                      type="button"
                      onClick={() => selectAsset(a)}
                      aria-pressed={on}
                      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                        on
                          ? 'border-orange-600/60 bg-orange-950/20'
                          : 'border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900'
                      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-100 truncate" title={a.name || a.asset_id}>{a.name || assetShortName(a.asset_id)}</span>
                        <AssetBadge kind={a.kind} />
                      </div>
                      {a.module && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{a.module}</p>}
                    </button>
                  )
                })}
              </div>
              <Pager {...picker} label="assets" />
            </>
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
              view={view}
              onView={setView}
              onSelect={selectAsset}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}

function NodeTable({ rows, label, onSelect, emptyNote, withModule = true }) {
  const { sort, onSort } = useTableSort({ key: 'name', dir: 'asc' })
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  const paged = usePaged(sorted, 15)
  if (!rows.length) return <Note>{emptyNote}</Note>
  return (
    <>
      <Table>
        <THead>
          <Th sortKey="name" sort={sort} onSort={onSort}>{label}</Th>
          <Th sortKey="kind" sort={sort} onSort={onSort}>Kind</Th>
          {withModule && <Th sortKey="module" sort={sort} onSort={onSort}>Module</Th>}
        </THead>
        <tbody>
          {paged.pageRows.map((n) => (
            <Tr key={n.assetId} onClick={() => onSelect(n.assetId)} ariaLabel={`Trace ${n.name}`}>
              <Td><span className="font-medium text-gray-100">{n.name}</span></Td>
              <Td><AssetBadge kind={n.kind} /></Td>
              {withModule && <Td>{n.module || 'Not set'}</Td>}
            </Tr>
          ))}
        </tbody>
      </Table>
      <Pager {...paged} label="assets" />
      <p className="text-[11px] text-gray-500 mt-1">Click an asset to re-centre the trace on it.</p>
    </>
  )
}

function LineageDetail({ asset, graph, impact, view, onView, onSelect }) {
  const upstream = useMemo(() => graph?.upstream || [], [graph])
  const downstream = useMemo(() => graph?.downstream || [], [graph])
  const impacted = useMemo(() => impact?.impacted || [], [impact])
  const edges = graph?.edges || []
  const impactTotal = impact?.total || 0
  const nameById = useMemo(() => {
    const m = new Map()
    for (const n of (graph?.nodes || [])) m.set(n.assetId, n.name)
    return m
  }, [graph])

  const nothing = upstream.length === 0 && downstream.length === 0 && impacted.length === 0
  const theme = useChartTheme()
  const lineageOption = useMemo(
    () => (nothing ? null : buildLineageOption(asset, graph, impact, theme)),
    [nothing, asset, graph, impact, theme],
  )
  const affected = useMemo(() => (impacted.length ? impacted : downstream), [impacted, downstream])
  const capped = upstream.length > GRAPH_CAP || affected.length > GRAPH_CAP

  const exportRows = useMemo(() => [
    ...upstream.map((n) => ({ ...n, direction: 'Upstream source' })),
    ...affected.map((n) => ({ ...n, direction: 'Downstream affected' })),
  ], [upstream, affected])

  return (
    <div className="space-y-4">
      <PanelHeader
        icon={kindIcon(asset.kind)}
        title={asset.name || assetShortName(asset.asset_id)}
        subtitle={asset.module || 'Selected asset'}
        actions={<>
          <AssetBadge kind={asset.kind} />
          <ExportButtons rows={exportRows} columns={LINEAGE_EXPORT} title={`TyrePulse Lineage ${asset.name || assetShortName(asset.asset_id)}`} />
        </>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Upstream sources"
          value={nf.format(upstream.length)}
          sub={upstream.length ? 'feed this asset' : 'no recorded sources'}
          icon={ArrowUp}
          tone={upstream.length ? 'accent' : 'muted'}
          onClick={upstream.length ? () => onView('upstream') : undefined}
          active={view === 'upstream'}
        />
        <StatTile
          label="Downstream affected"
          value={nf.format(impactTotal)}
          sub={impactTotal ? 'items a change would touch' : 'nothing depends on it'}
          icon={ArrowDown}
          tone={impactTotal ? 'warning' : 'muted'}
          onClick={affected.length ? () => onView('downstream') : undefined}
          active={view === 'downstream'}
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
          {impactTotal > 0 && (
            <Note icon={AlertTriangle} tone="warning">
              Changing this asset affects {nf.format(impactTotal)} item{impactTotal === 1 ? '' : 's'} downstream.
            </Note>
          )}
          <Segmented ariaLabel="Lineage views" value={view} onChange={onView} options={[
            { key: 'diagram', label: 'Diagram' },
            { key: 'upstream', label: 'Upstream', count: upstream.length },
            { key: 'downstream', label: 'Downstream', count: affected.length },
            ...(edges.length ? [{ key: 'edges', label: 'Edges', count: edges.length }] : []),
          ]} />

          {view === 'diagram' && (
            <div>
              <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-2">
                <EChart option={lineageOption} style={{ height: 360 }} ariaLabel="Lineage diagram" />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Sources on the left feed this asset; arrows point to what a change affects. Drag to pan, scroll to zoom.
                {capped ? ` Showing the first ${GRAPH_CAP} on each side; the Upstream and Downstream views list every one.` : ''}
              </p>
            </div>
          )}

          {view === 'upstream' && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ArrowUp size={14} className="text-orange-400" aria-hidden="true" />
                <h4 className="text-sm font-semibold text-gray-200">Upstream: where the data comes from</h4>
              </div>
              <NodeTable rows={upstream} label="Source" onSelect={onSelect}
                emptyNote="No upstream sources are recorded for this asset, so it is treated as an origin." />
            </div>
          )}

          {view === 'downstream' && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ArrowDown size={14} className="text-amber-400" aria-hidden="true" />
                <h4 className="text-sm font-semibold text-gray-200">Downstream: what a change to this affects</h4>
              </div>
              <NodeTable rows={affected} label="Affected asset" onSelect={onSelect} withModule={false}
                emptyNote="Nothing depends on this asset, so changing it affects no downstream metric or dashboard." />
            </div>
          )}

          {view === 'edges' && edges.length > 0 && (
            <EdgeTable edges={edges} nameById={nameById} />
          )}
        </>
      )}
    </div>
  )
}

function EdgeTable({ edges, nameById }) {
  const paged = usePaged(edges, 20)
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Network size={14} className="text-orange-400" aria-hidden="true" />
        <h4 className="text-sm font-semibold text-gray-200">Raw graph edges</h4>
      </div>
      <Table>
        <THead>
          <Th>From</Th>
          <Th>Relationship</Th>
          <Th>To</Th>
        </THead>
        <tbody>
          {paged.pageRows.map((e, i) => (
            <Tr key={`${e.from}:${e.to}:${i}`}>
              <Td nowrap>{nameById.get(e.from) || assetShortName(e.from)}</Td>
              <Td>
                <span className="inline-flex items-center gap-1 text-gray-400">
                  <ArrowRight size={12} aria-hidden="true" />
                  {e.type || 'feeds'}
                </span>
              </Td>
              <Td nowrap>{nameById.get(e.to) || assetShortName(e.to)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Pager {...paged} label="edges" />
    </div>
  )
}
