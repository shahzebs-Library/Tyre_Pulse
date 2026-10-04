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
 *
 * Governance controls (Admin / super admin, enforced by the registry RLS):
 * create a metric, edit its definition, add a formula version, set its status
 * (certified / draft / deprecated, the metric_registry CHECK) and retire or
 * restore it (active flag; retiring needs a typed word and a reason). Every
 * write lands in the console audit log. Retired metrics stay readable under
 * the "Retired" filter, so nothing disappears.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Ruler, ChevronRight, Database, GitBranch, Users, LayoutDashboard, BarChart3, Plus, Pencil, BadgeCheck,
  Archive, RotateCcw, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, Badge, Btn, Table, THead, Th, Tr, Td, StatTile, Select, Segmented, Modal,
  SearchInput, Toolbar, LoadingState, EmptyState, ErrorState, ConfirmImpactDialog,
} from '../components/ui'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import { BarsChart } from '../components/ui/charts'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList } from './shared/pageKit'
import { listAllMetrics, getMetric, patchMetric } from '../../lib/api/metricRegistry'
import { statusOf, completeness, STATUS_LABEL, STATUS_TONE, METRIC_STATUSES } from '../../lib/metricGovernance'
import { MetricEditor, VersionEditor } from './metricCatalogue/MetricEditors'
import { useConsoleAuth } from '../ConsoleAuthContext'
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
  { key: 'status', header: 'Status', value: (r) => (r.active === false ? 'Retired' : STATUS_LABEL[statusOf(r)]) },
  { key: 'complete', header: 'Completeness', value: (r) => `${completeness(r).score}%` },
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

export default function ConsoleMetricCatalogue({ tabParam = 'tab' } = {}) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], at: null })
  const [query, setQuery] = useState('')
  const [owner, setOwner] = useState('')
  const [unusedOnly, setUnusedOnly] = useState(false)
  const [gapOnly, setGapOnly] = useState(false)
  const [tab, setTab] = useUrlTab(TABS, 'registry', tabParam)
  const [params, setParams] = useSearchParams()
  const selected = params.get('metric') || null
  const [detail, setDetail] = useState({ loading: false, error: null, data: null })
  const { logAction } = useConsoleAuth()
  const [lifecycle, setLifecycle] = useState('active') // active | retired | all
  const [statusFilter, setStatusFilter] = useState('')
  const [editor, setEditor] = useState(null) // { row|null }
  const [versionOpen, setVersionOpen] = useState(false)
  const [lifeAction, setLifeAction] = useState(null) // { kind:'status'|'retire'|'restore', status? }
  const [actBusy, setActBusy] = useState(false)
  const [actErr, setActErr] = useState('')
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const rows = await listAllMetrics()
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
      if (lifecycle === 'active' && r.active === false) return false
      if (lifecycle === 'retired' && r.active !== false) return false
      if (statusFilter && statusOf(r) !== statusFilter) return false
      if (owner && field(r, 'business_owner', 'owner') !== owner) return false
      if (unusedOnly && dashCount(r) > 0) return false
      if (gapOnly && !hasGap(r)) return false
      return true
    })
    return searchRows(rows, query, [
      (r) => field(r, 'name'), (r) => field(r, 'metric_id', 'id'), (r) => field(r, 'business_owner', 'owner'),
      (r) => field(r, 'source_table'), (r) => field(r, 'source_module'), (r) => field(r, 'unit'),
    ])
  }, [state.rows, query, owner, unusedOnly, gapOnly, lifecycle, statusFilter])

  const { sort, onSort } = useTableSort({ key: 'name', dir: 'asc' })
  const sorted = useMemo(() => sortRows(filtered, sort, ACCESSORS), [filtered, sort])
  const paged = usePaged(sorted, 25)

  const stats = useMemo(() => {
    const owners = new Set(); const sources = new Set(); let unused = 0; let gaps = 0; let certified = 0; let retired = 0
    for (const r of state.rows) {
      if (r.active === false) { retired += 1; continue }
      if (statusOf(r) === 'certified') certified += 1
      const o = field(r, 'business_owner', 'owner'); if (o) owners.add(o)
      const t = field(r, 'source_table'); if (t) sources.add(t)
      if (dashCount(r) === 0) unused += 1
      if (hasGap(r)) gaps += 1
    }
    return { owners: [...owners].sort(), sources: sources.size, unused, gaps, certified, retired, active: state.rows.length - retired }
  }, [state.rows])

  const attention = useMemo(() => {
    const out = []
    if (stats.gaps) out.push({ key: 'gaps', tone: 'warning', title: `${stats.gaps} metric${stats.gaps === 1 ? '' : 's'} missing an owner, source table or refresh SLA`,
      detail: 'A governed number needs all three to be traceable.', action: { label: 'Show them', onClick: () => { setGapOnly(true); setUnusedOnly(false); setTab('registry') } } })
    if (stats.unused) out.push({ key: 'unused', tone: 'info', title: `${stats.unused} metric${stats.unused === 1 ? '' : 's'} not on any dashboard`,
      detail: 'Either surface them or retire the definition.', action: { label: 'Show them', onClick: () => { setUnusedOnly(true); setGapOnly(false); setTab('registry') } } })
    return out
  }, [stats, setTab])

  const activeRows = useMemo(() => state.rows.filter((r) => r.active !== false), [state.rows])
  const byOwner = useMemo(() => countBy(activeRows, (r) => field(r, 'business_owner', 'owner')), [activeRows])
  const bySource = useMemo(() => countBy(activeRows, (r) => field(r, 'source_table')), [activeRows])
  const byDash = useMemo(() => [...activeRows]
    .map((r) => ({ label: na(field(r, 'name')), value: dashCount(r) }))
    .filter((b) => b.value > 0).sort((a, b) => b.value - a.value).slice(0, 10), [activeRows])

  const metric = detail.data?.metric || null
  const versions = Array.isArray(detail.data?.versions) ? detail.data.versions : []
  const detailId = metric ? field(metric, 'metric_id', 'id') : selected

  const afterWrite = async (text, action, details) => {
    logAction?.(action, null, 'metric', details)
    setFlash({ tone: 'ok', text })
    await load()
    if (selected) fetchDetail(selected)
  }
  const runLifeAction = async ({ reason }) => {
    if (!metric || !lifeAction) return
    setActBusy(true); setActErr('')
    const id = field(metric, 'metric_id')
    try {
      if (lifeAction.kind === 'status') {
        await patchMetric(id, { status: lifeAction.status || null })
        await afterWrite(`${na(field(metric, 'name'))} is now ${STATUS_LABEL[lifeAction.status || 'none']}.`, 'metric_set_status', { metric_id: id, status: lifeAction.status || null, reason })
      } else if (lifeAction.kind === 'retire') {
        await patchMetric(id, { active: false, status: 'deprecated' })
        await afterWrite(`${na(field(metric, 'name'))} was retired. It stays readable under Retired.`, 'metric_retire', { metric_id: id, reason })
      } else {
        await patchMetric(id, { active: true })
        await afterWrite(`${na(field(metric, 'name'))} was restored.`, 'metric_restore', { metric_id: id, reason })
      }
      setLifeAction(null)
    } catch (e) {
      setActErr(toUserMessage(e, 'The change could not be saved.'))
    } finally { setActBusy(false) }
  }
  const metricDash = metric ? dashCount(metric) : 0
  const lifeImpact = !lifeAction || !metric ? undefined : lifeAction.kind === 'retire' ? {
    tone: 'danger', what: `Retire ${na(field(metric, 'name'))}`,
    change: 'The metric leaves the active catalogue and is marked Deprecated. Its definition and every formula version stay readable under Retired.',
    who: metricDash ? `${metricDash} dashboard${metricDash === 1 ? '' : 's'} still reference it and will point at a retired definition.` : 'No dashboard references it.',
    undo: 'Yes. Restore it from the Retired filter.',
    stats: [{ label: 'Dashboards', value: metricDash }, { label: 'Versions', value: versions.length }, { label: 'Status', value: STATUS_LABEL[statusOf(metric)] }],
  } : lifeAction.kind === 'restore' ? {
    tone: 'info', what: `Restore ${na(field(metric, 'name'))}`,
    change: 'The metric returns to the active catalogue with its current status.', who: 'Everyone reading the catalogue.', undo: 'Yes. Retire it again.',
  } : {
    tone: lifeAction.status === 'deprecated' ? 'warning' : 'info',
    what: `Mark ${na(field(metric, 'name'))} as ${STATUS_LABEL[lifeAction.status || 'none']}`,
    change: lifeAction.status === 'certified' ? 'The definition is marked as reviewed and trustworthy.' : lifeAction.status === 'deprecated' ? 'Readers are told to stop using this number; it stays in the catalogue.' : 'The definition is marked as a draft that is still being worked on.',
    who: metricDash ? `Readers of ${metricDash} dashboard${metricDash === 1 ? '' : 's'} see the new status in Explain This Number.` : 'Readers of the catalogue.',
    undo: 'Yes. Change the status again.',
  }
  const certifyBlocked = metric ? completeness(metric).missing : []

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Ruler}
        title="Metric Catalogue"
        purpose="Every KPI has one governed, versioned definition. All dashboards reference these."
        refreshedAt={state.at}
        onRefresh={load}
        refreshing={state.loading}
        meta={<span>Editing here changes the governed definition every dashboard explains itself with. Admin and super admin only; every change is audited.</span>}
        primary={<Btn icon={Plus} variant="primary" onClick={() => setEditor({ row: null })}>New metric</Btn>}
      />

      {flash && <Note icon={flash.tone === 'ok' ? CheckCircle2 : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>{flash.text}</Note>}

      {!state.loading && !state.error && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatTile label="Governed metrics" value={stats.active.toLocaleString()} icon={Ruler}
            onClick={() => { setUnusedOnly(false); setGapOnly(false); setOwner(''); setStatusFilter(''); setLifecycle('active'); setTab('registry') }}
            active={!unusedOnly && !gapOnly && !owner && !statusFilter && lifecycle === 'active' && tab === 'registry'} />
          <StatTile label="Certified" value={stats.certified.toLocaleString()} icon={BadgeCheck} tone={stats.certified ? 'good' : 'default'}
            sub={`${(stats.active - stats.certified).toLocaleString()} not certified`}
            onClick={() => { setStatusFilter('certified'); setLifecycle('active'); setTab('registry') }} active={statusFilter === 'certified'} />
          <StatTile label="Retired" value={stats.retired.toLocaleString()} icon={Archive}
            onClick={() => { setLifecycle('retired'); setStatusFilter(''); setTab('registry') }} active={lifecycle === 'retired'} />
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

      {!state.loading && !state.error && stats.active > 0 && stats.certified === 0 && (
        <Note icon={BadgeCheck}>No metric is certified yet. Open a metric, fill the missing fields and mark it Certified so readers know the definition was reviewed.</Note>
      )}
      {!state.loading && !state.error && state.rows.length > 0 && <AttentionList quiet items={attention} />}

      <Segmented ariaLabel="Metric catalogue views" value={tab} onChange={setTab} options={[
        { key: 'registry', label: 'Registry', count: state.loading || state.error ? undefined : stats.active },
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
              <Select ariaLabel="Filter by status" value={statusFilter} onChange={setStatusFilter} placeholder="Every status" className="w-40"
                options={[...METRIC_STATUSES, 'none'].map((st) => ({ value: st, label: STATUS_LABEL[st] }))} />
              <Select ariaLabel="Active or retired" value={lifecycle} onChange={setLifecycle} className="w-36"
                options={[{ value: 'active', label: 'Active' }, { value: 'retired', label: 'Retired' }, { value: 'all', label: 'Active and retired' }]} />
              {(query || owner || unusedOnly || gapOnly || statusFilter || lifecycle !== 'active') && (
                <Btn variant="quiet" onClick={() => { setQuery(''); setOwner(''); setUnusedOnly(false); setGapOnly(false); setStatusFilter(''); setLifecycle('active') }}>Clear filters</Btn>
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
                      <Th>Status</Th>
                      <Th align="right">Complete</Th>
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
                            <Td nowrap>{r.active === false ? <Badge tone="quiet" icon={Archive}>Retired</Badge> : <Badge tone={STATUS_TONE[statusOf(r)]}>{STATUS_LABEL[statusOf(r)]}</Badge>}</Td>
                            <Td align="right"><span className={`tabular-nums ${completeness(r).score < 100 ? 'text-amber-300' : 'text-gray-300'}`}>{completeness(r).score}%</span></Td>
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
          {metric && <Btn icon={Pencil} onClick={() => setEditor({ row: metric })}>Edit definition</Btn>}
          {metric && metric.active !== false && <Btn icon={GitBranch} onClick={() => setVersionOpen(true)}>New version</Btn>}
          <Btn onClick={closeDetail}>Close</Btn>
        </>}
      >
        <div className="space-y-4">
          {detail.loading && <LoadingState label="Reading the metric definition" rows={4} />}
          {!detail.loading && detail.error && <ErrorState message={detail.error} onRetry={() => fetchDetail(selected)} />}

          {!detail.loading && !detail.error && metric && (
            <>
              {field(metric, 'description') && <Note>{field(metric, 'description')}</Note>}

              <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-gray-300">Governance</span>
                  {metric.active === false ? <Badge tone="quiet" icon={Archive}>Retired</Badge> : <Badge tone={STATUS_TONE[statusOf(metric)]}>{STATUS_LABEL[statusOf(metric)]}</Badge>}
                  <Badge tone={completeness(metric).score < 100 ? 'warning' : 'good'}>{completeness(metric).score}% complete</Badge>
                </div>
                <p className="text-[11px] text-gray-400">Status tells every reader whether to trust this definition. Certifying needs an owner, source table, refresh SLA, unit and description.</p>
                <div className="flex flex-wrap gap-2">
                  {metric.active !== false && statusOf(metric) !== 'certified' && (
                    <Btn size="xs" icon={BadgeCheck} variant="good" disabled={certifyBlocked.length > 0}
                      title={certifyBlocked.length ? `Missing: ${certifyBlocked.join(', ')}` : 'Mark as reviewed'}
                      onClick={() => { setActErr(''); setLifeAction({ kind: 'status', status: 'certified' }) }}>Certify</Btn>
                  )}
                  {metric.active !== false && statusOf(metric) !== 'draft' && (
                    <Btn size="xs" onClick={() => { setActErr(''); setLifeAction({ kind: 'status', status: 'draft' }) }}>Mark draft</Btn>
                  )}
                  {metric.active !== false && statusOf(metric) !== 'deprecated' && (
                    <Btn size="xs" onClick={() => { setActErr(''); setLifeAction({ kind: 'status', status: 'deprecated' }) }}>Deprecate</Btn>
                  )}
                  {metric.active !== false
                    ? <Btn size="xs" variant="danger" icon={Archive} onClick={() => { setActErr(''); setLifeAction({ kind: 'retire' }) }}>Retire</Btn>
                    : <Btn size="xs" icon={RotateCcw} onClick={() => { setActErr(''); setLifeAction({ kind: 'restore' }) }}>Restore</Btn>}
                </div>
                {certifyBlocked.length > 0 && metric.active !== false && <p className="text-[11px] text-amber-300">To certify, fill: {certifyBlocked.join(', ')}.</p>}
              </div>

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

      <MetricEditor open={!!editor} row={editor?.row || null}
        existingIds={state.rows.map((r) => field(r, 'metric_id')).filter(Boolean)}
        onClose={() => setEditor(null)}
        onSaved={(saved, isNew) => {
          setEditor(null)
          afterWrite(isNew ? `Metric ${na(saved?.name)} was created.` : `${na(saved?.name)} was updated.`, isNew ? 'metric_create' : 'metric_update', { metric_id: saved?.metric_id || null })
          if (isNew && saved?.metric_id) setSelected(saved.metric_id)
        }} />
      <VersionEditor open={versionOpen} metric={metric} versions={versions}
        onClose={() => setVersionOpen(false)}
        onSaved={(saved) => {
          setVersionOpen(false)
          afterWrite(`Version ${saved?.version ?? ''} was added.`, 'metric_version_add', { metric_id: saved?.metric_id || null, version: saved?.version ?? null })
        }} />
      <ConfirmImpactDialog
        open={!!lifeAction && !!metric}
        title={lifeAction?.kind === 'retire' ? 'Retire metric' : lifeAction?.kind === 'restore' ? 'Restore metric' : 'Change metric status'}
        impact={lifeImpact}
        confirmLabel={lifeAction?.kind === 'retire' ? 'Retire' : lifeAction?.kind === 'restore' ? 'Restore' : 'Save status'}
        requireReason
        typedWord={lifeAction?.kind === 'retire' ? 'RETIRE' : undefined}
        danger={lifeAction?.kind === 'retire'}
        busy={actBusy}
        error={actErr}
        onCancel={() => setLifeAction(null)}
        onConfirm={runLifeAction}
      />
    </div>
  )
}
