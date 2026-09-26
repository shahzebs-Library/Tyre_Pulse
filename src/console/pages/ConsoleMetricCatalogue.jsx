/**
 * ConsoleMetricCatalogue.jsx - the governed metric registry.
 *
 * Every KPI in the product has exactly one definition here: one owner, one
 * source table, one versioned formula. Dashboards reference these rows rather
 * than each re-deriving a number, which is how two screens stop disagreeing
 * about "cost per km". This page is the read-only window onto that registry:
 * find a metric, see its full definition, and read its formula history.
 *
 * Navy/orange console kit only (gray-* / orange-* class families) so it stays
 * dark for light-mode users. ASCII only. Honest empty/error states - a metric
 * with no versions is not the same as a registry we could not read.
 *
 * Layout: header, KPI tiles, tabs (?tab=registry|coverage). A metric opens in
 * a modal (?metric=<id> deep-links straight to it) with links to its lineage.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Ruler, ChevronRight, Database, GitBranch, Users, LayoutDashboard, BarChart3 } from 'lucide-react'
import {
  Panel, PanelHeader, Note, Badge, Btn, Table, THead, Th, Tr, Td, StatTile, Select, Segmented, Modal,
  SearchInput, Toolbar, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { BarsChart } from '../components/ui/charts'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList } from './dataTrust/kit'
import { listMetrics, getMetric } from '../../lib/api/metricRegistry'
import { fmtList } from '../../lib/metricExplain'
import { toUserMessage } from '../../lib/safeError'

const na = (v) => (v === null || v === undefined || v === '' ? 'N/A' : String(v))

/* A registry row exposes snake_case columns; read them tolerantly so a schema
   tweak does not blank the whole table. */
const field = (row, ...keys) => {
  for (const k of keys) {
    const val = row?.[k]
    if (val !== null && val !== undefined && val !== '') return val
  }
  return null
}

const dashCount = (row) => {
  const d = field(row, 'dashboards')
  return Array.isArray(d) ? d.length : (d ? 1 : 0)
}

const ACCESSORS = {
  name: (r) => field(r, 'name'),
  id: (r) => field(r, 'metric_id', 'id'),
  owner: (r) => field(r, 'business_owner', 'owner'),
  unit: (r) => field(r, 'unit'),
  source: (r) => field(r, 'source_table'),
  sla: (r) => field(r, 'refresh_sla'),
  dashboards: (r) => dashCount(r),
}
const EXPORT_COLUMNS = [
  { key: 'name', header: 'Metric', value: (r) => na(ACCESSORS.name(r)) },
  { key: 'id', header: 'ID', value: (r) => na(ACCESSORS.id(r)) },
  { key: 'owner', header: 'Owner', value: (r) => na(ACCESSORS.owner(r)) },
  { key: 'unit', header: 'Unit', value: (r) => na(ACCESSORS.unit(r)) },
  { key: 'source', header: 'Source table', value: (r) => na(ACCESSORS.source(r)) },
  { key: 'sla', header: 'Refresh SLA', value: (r) => na(ACCESSORS.sla(r)) },
  { key: 'dashboards', header: 'Dashboards', value: dashCount },
]
const TABS = ['registry', 'coverage']
function countBy(rows, fn, cap = 10) {
  const m = new Map()
  for (const r of rows) { const k = fn(r) || 'Not set'; m.set(k, (m.get(k) || 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map(([label, value]) => ({ label, value }))
}

/* One labelled fact in the detail panel. */
function Detail({ label, value, mono = false, full = false }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <dt className="text-[11px] uppercase tracking-wide text-gray-500 mb-0.5">{label}</dt>
      <dd className={`text-sm text-gray-200 break-words ${mono ? 'font-mono text-xs' : ''}`}>
        {na(value)}
      </dd>
    </div>
  )
}

export default function ConsoleMetricCatalogue() {
  const [state, setState] = useState({ loading: true, error: null, rows: [], at: null })
  const [query, setQuery] = useState('')
  const [owner, setOwner] = useState('')
  const [unusedOnly, setUnusedOnly] = useState(false)
  const [gapOnly, setGapOnly] = useState(false)
  const [tab, setTab] = useUrlTab(TABS, 'registry')
  const [params, setParams] = useSearchParams()
  const selected = params.get('metric') || null
  const [detail, setDetail] = useState({ loading: false, error: null, data: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const rows = await listMetrics()
      setState({ loading: false, error: null, rows: Array.isArray(rows) ? rows : [], at: new Date() })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), rows: [], at: null })
    }
  }, [])

  useEffect(() => { load() }, [load])

  const setSelected = useCallback((id) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (id) p.set('metric', id); else p.delete('metric')
      return p
    }, { replace: true })
  }, [setParams])

  const fetchDetail = useCallback(async (id) => {
    if (!id) return
    setDetail({ loading: true, error: null, data: null })
    try {
      const data = await getMetric(id)
      setDetail({ loading: false, error: null, data })
    } catch (e) {
      setDetail({ loading: false, error: toUserMessage(e), data: null })
    }
  }, [])
  // The URL is the source of truth for which metric is open, so a deep link works.
  useEffect(() => { if (selected) fetchDetail(selected) }, [selected, fetchDetail])
  const openDetail = useCallback((id) => { if (id) setSelected(id) }, [setSelected])
  const closeDetail = () => { setSelected(null); setDetail({ loading: false, error: null, data: null }) }

  const hasGap = (r) => !field(r, 'business_owner', 'owner') || !field(r, 'source_table') || !field(r, 'refresh_sla')

  const filtered = useMemo(() => {
    const rows = state.rows.filter((r) => {
      if (owner && field(r, 'business_owner', 'owner') !== owner) return false
      if (unusedOnly && dashCount(r) > 0) return false
      if (gapOnly && !hasGap(r)) return false
      return true
    })
    return searchRows(rows, query, [
      (r) => field(r, 'name'), (r) => field(r, 'metric_id', 'id'), (r) => field(r, 'business_owner', 'owner'),
      (r) => field(r, 'source_table'), (r) => field(r, 'source_module'), (r) => field(r, 'unit'),
    ])
  }, [state.rows, query, owner, unusedOnly, gapOnly])

  const { sort, onSort } = useTableSort({ key: 'name', dir: 'asc' })
  const sorted = useMemo(() => sortRows(filtered, sort, ACCESSORS), [filtered, sort])
  const paged = usePaged(sorted, 25)

  const stats = useMemo(() => {
    const owners = new Set(); const sources = new Set(); let unused = 0; let gaps = 0
    for (const r of state.rows) {
      const o = field(r, 'business_owner', 'owner'); if (o) owners.add(o)
      const t = field(r, 'source_table'); if (t) sources.add(t)
      if (dashCount(r) === 0) unused += 1
      if (hasGap(r)) gaps += 1
    }
    return { owners: [...owners].sort(), sources: sources.size, unused, gaps }
  }, [state.rows])

  const attention = useMemo(() => {
    const out = []
    if (stats.gaps) out.push({ key: 'gaps', tone: 'warning', title: `${stats.gaps} metric${stats.gaps === 1 ? '' : 's'} missing an owner, source table or refresh SLA`,
      detail: 'A governed number needs all three to be traceable.', action: { label: 'Show them', onClick: () => { setGapOnly(true); setUnusedOnly(false); setTab('registry') } } })
    if (stats.unused) out.push({ key: 'unused', tone: 'info', title: `${stats.unused} metric${stats.unused === 1 ? '' : 's'} not on any dashboard`,
      detail: 'Either surface them or retire the definition.', action: { label: 'Show them', onClick: () => { setUnusedOnly(true); setGapOnly(false); setTab('registry') } } })
    return out
  }, [stats, setTab])

  const byOwner = useMemo(() => countBy(state.rows, (r) => field(r, 'business_owner', 'owner')), [state.rows])
  const bySource = useMemo(() => countBy(state.rows, (r) => field(r, 'source_table')), [state.rows])
  const byDash = useMemo(() => [...state.rows]
    .map((r) => ({ label: na(field(r, 'name')), value: dashCount(r) }))
    .filter((b) => b.value > 0).sort((a, b) => b.value - a.value).slice(0, 10), [state.rows])

  const metric = detail.data?.metric || null
  const versions = Array.isArray(detail.data?.versions) ? detail.data.versions : []
  const detailId = metric ? field(metric, 'metric_id', 'id') : selected

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Ruler}
        title="Metric Catalogue"
        purpose="Every KPI has one governed, versioned definition. All dashboards reference these."
        refreshedAt={state.at}
        onRefresh={load}
        refreshing={state.loading}
      />

      {!state.loading && !state.error && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Governed metrics" value={state.rows.length.toLocaleString()} icon={Ruler}
            onClick={() => { setUnusedOnly(false); setGapOnly(false); setOwner(''); setTab('registry') }}
            active={!unusedOnly && !gapOnly && !owner && tab === 'registry'} />
          <StatTile label="Business owners" value={stats.owners.length.toLocaleString()} icon={Users}
            onClick={() => setTab('coverage')} active={tab === 'coverage'} />
          <StatTile label="Incomplete definitions" value={stats.gaps.toLocaleString()} icon={Database}
            tone={stats.gaps ? 'warning' : 'default'} sub={`${stats.sources.toLocaleString()} source tables`}
            onClick={stats.gaps ? () => { setGapOnly((v) => !v); setTab('registry') } : undefined} active={gapOnly} />
          <StatTile label="Not on any dashboard" value={stats.unused.toLocaleString()} icon={LayoutDashboard}
            tone={stats.unused ? 'warning' : 'default'}
            onClick={stats.unused ? () => { setUnusedOnly((v) => !v); setTab('registry') } : undefined} active={unusedOnly} />
        </div>
      )}

      {!state.loading && !state.error && state.rows.length > 0 && <AttentionList items={attention} />}

      <Segmented ariaLabel="Metric catalogue views" value={tab} onChange={setTab} options={[
        { key: 'registry', label: 'Registry', count: state.loading || state.error ? undefined : state.rows.length },
        { key: 'coverage', label: 'Coverage' },
      ]} />

      {tab === 'registry' && (
        <Panel>
          <PanelHeader
            icon={Ruler}
            title="Registry"
            subtitle={!state.loading && !state.error ? `${filtered.length} of ${state.rows.length} metrics shown. Click a metric to read its definition.` : 'Click a metric to read its definition.'}
            actions={<ExportButtons rows={sorted} columns={EXPORT_COLUMNS} title="TyrePulse Metric Catalogue" />}
          />

          <div className="space-y-3">
            <Toolbar>
              <SearchInput value={query} onChange={setQuery} placeholder="Search by name, id, owner or source table" className="w-full sm:w-96" />
              <Select ariaLabel="Filter by owner" value={owner} onChange={setOwner} placeholder="All owners" className="w-44"
                options={stats.owners.map((o) => ({ value: o, label: o }))} />
              {(query || owner || unusedOnly || gapOnly) && (
                <Btn variant="quiet" onClick={() => { setQuery(''); setOwner(''); setUnusedOnly(false); setGapOnly(false) }}>Clear filters</Btn>
              )}
            </Toolbar>

            {state.loading && <LoadingState label="Reading the metric registry" rows={6} />}
            {!state.loading && state.error && <ErrorState message={state.error} onRetry={load} />}

            {!state.loading && !state.error && (
              state.rows.length === 0 ? (
                <EmptyState icon={Ruler} title="No metrics registered yet"
                  reason="The governed metric registry is empty, or this database does not carry it yet." />
              ) : filtered.length === 0 ? (
                <EmptyState icon={Ruler} title="No metrics match these filters"
                  reason="No metric name, id, owner or source table matches. Clear the search and filters to see every metric." />
              ) : (
                <>
                  <Table>
                    <THead>
                      <Th sortKey="name" sort={sort} onSort={onSort}>Metric</Th>
                      <Th sortKey="id" sort={sort} onSort={onSort}>ID</Th>
                      <Th sortKey="owner" sort={sort} onSort={onSort}>Owner</Th>
                      <Th sortKey="unit" sort={sort} onSort={onSort}>Unit</Th>
                      <Th sortKey="source" sort={sort} onSort={onSort}>Source table</Th>
                      <Th sortKey="sla" sort={sort} onSort={onSort}>Refresh SLA</Th>
                      <Th sortKey="dashboards" sort={sort} onSort={onSort} align="right">Dashboards</Th>
                      <Th align="right"><span className="sr-only">Open</span></Th>
                    </THead>
                    <tbody>
                      {paged.pageRows.map((r) => {
                        const id = field(r, 'metric_id', 'id')
                        const on = id === selected
                        return (
                          <Tr key={id || field(r, 'name')} onClick={() => openDetail(id)} className={on ? 'bg-orange-950/20' : ''}>
                            <Td><button type="button" aria-pressed={on} onClick={(e) => { e.stopPropagation(); openDetail(id) }} className="text-left font-medium text-gray-100 hover:text-orange-300 break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">{na(field(r, 'name'))}</button></Td>
                            <Td nowrap><span className="font-mono text-[11px] text-gray-400">{na(id)}</span></Td>
                            <Td>{na(field(r, 'business_owner', 'owner'))}</Td>
                            <Td>{na(field(r, 'unit'))}</Td>
                            <Td nowrap><span className="font-mono text-[11px] text-gray-400">{na(field(r, 'source_table'))}</span></Td>
                            <Td>{na(field(r, 'refresh_sla'))}</Td>
                            <Td align="right"><span className="tabular-nums text-gray-300">{dashCount(r)}</span></Td>
                            <Td align="right"><ChevronRight size={14} className="text-gray-500 inline" aria-hidden="true" /></Td>
                          </Tr>
                        )
                      })}
                    </tbody>
                  </Table>
                  <Pager {...paged} label="metrics" />
                </>
              )
            )}
          </div>
        </Panel>
      )}

      {tab === 'coverage' && (
        state.loading ? <LoadingState label="Reading the metric registry" rows={3} />
          : state.error ? <ErrorState message={state.error} onRetry={load} />
            : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Panel>
                  <PanelHeader icon={Users} title="Metrics per owner" subtitle="Who answers for how many numbers." />
                  <BarsChart bars={byOwner} emptyText="No metrics registered yet." />
                </Panel>
                <Panel>
                  <PanelHeader icon={Database} title="Metrics per source table" subtitle="A table many metrics read from is a table whose quality matters most." />
                  <BarsChart bars={bySource} emptyText="No metrics registered yet." />
                </Panel>
                <Panel className="lg:col-span-2">
                  <PanelHeader icon={BarChart3} title="Most-used metrics" subtitle="Dashboards referencing each metric. A change to the top of this list reaches the most screens." />
                  <BarsChart bars={byDash} emptyText="No metric is referenced by a dashboard yet." />
                </Panel>
              </div>
            )
      )}

      {/* ── detail ────────────────────────────────────────────────────────── */}
      <Modal
        open={!!selected}
        onClose={closeDetail}
        width="max-w-3xl"
        title={metric ? na(field(metric, 'name')) : 'Metric definition'}
        subtitle={metric ? na(field(metric, 'metric_id', 'id')) : selected}
        footer={<>
          {detailId && (
            <Link to={`/console/lineage?asset=${encodeURIComponent(`metric:${detailId}`)}`}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-800 text-gray-300 hover:bg-gray-800/60 inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              <GitBranch size={13} aria-hidden="true" /> Trace lineage
            </Link>
          )}
          <Btn onClick={closeDetail}>Close</Btn>
        </>}
      >
        <div className="space-y-4">
          {detail.loading && <LoadingState label="Reading the metric definition" rows={4} />}
          {!detail.loading && detail.error && <ErrorState message={detail.error} onRetry={() => fetchDetail(selected)} />}

          {!detail.loading && !detail.error && metric && (
            <>
              {field(metric, 'description') && <Note>{field(metric, 'description')}</Note>}

              <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                <h4 className="text-xs font-semibold text-gray-300 mb-2.5">Definition and source</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                  <Detail label="Business owner" value={field(metric, 'business_owner', 'owner')} />
                  <Detail label="Unit" value={field(metric, 'unit')} />
                  <Detail label="Source module" value={field(metric, 'source_module')} />
                  <Detail label="Source table" value={field(metric, 'source_table')} mono />
                  <Detail label="Source columns" value={fmtList(field(metric, 'source_columns'))} mono full />
                  <Detail label="Date field" value={field(metric, 'date_field')} mono />
                  <Detail label="Date logic" value={field(metric, 'date_logic')} />
                  <Detail label="Currency handling" value={field(metric, 'currency_handling')} full />
                  <Detail label="Null handling" value={field(metric, 'null_handling')} full />
                  <Detail label="Duplicate handling" value={field(metric, 'duplicate_handling')} full />
                  <Detail label="Included statuses" value={fmtList(field(metric, 'included_statuses'))} full />
                  <Detail label="Excluded statuses" value={fmtList(field(metric, 'excluded_statuses'))} full />
                  <Detail label="Joins" value={field(metric, 'joins')} full />
                  <Detail label="Transformations" value={field(metric, 'transformations')} full />
                  <Detail label="Refresh SLA" value={field(metric, 'refresh_sla')} />
                  <Detail label="Calc reference" value={field(metric, 'calc_ref')} mono />
                  <Detail label="Dashboards" value={fmtList(field(metric, 'dashboards'))} full />
                </dl>
              </div>

              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-300 mb-2">
                  <GitBranch size={13} className="text-orange-400" aria-hidden="true" />
                  Formula history
                </h4>
                {versions.length === 0 ? (
                  <EmptyState icon={GitBranch} title="No formula versions recorded"
                    reason="This metric has a definition but no approved formula version yet." />
                ) : (
                  <Table>
                    <THead>
                      <Th align="right">Ver</Th>
                      <Th>Formula</Th>
                      <Th>Effective from</Th>
                      <Th>Owner</Th>
                      <Th>Approver</Th>
                      <Th>Change note</Th>
                    </THead>
                    <tbody>
                      {versions.map((v, i) => (
                        <Tr key={field(v, 'version', 'id') ?? i}>
                          <Td align="right"><span className="tabular-nums text-gray-300">{na(field(v, 'version'))}</span></Td>
                          <Td><span className="font-mono text-[11px] text-gray-300">{na(field(v, 'formula'))}</span></Td>
                          <Td nowrap>{na(field(v, 'effective_from'))}</Td>
                          <Td>{na(field(v, 'owner'))}</Td>
                          <Td>
                            {field(v, 'approver')
                              ? <Badge tone="good">{field(v, 'approver')}</Badge>
                              : <span className="text-gray-400">N/A</span>}
                          </Td>
                          <Td>{na(field(v, 'change_note'))}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            </>
          )}

          {!detail.loading && !detail.error && !metric && (
            <EmptyState icon={Ruler} title="No definition found"
              reason="This metric id returned no governed definition. It may have been removed from the registry." />
          )}
        </div>
      </Modal>
    </div>
  )
}
