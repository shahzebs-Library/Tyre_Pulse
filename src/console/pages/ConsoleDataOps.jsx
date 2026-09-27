import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, ListTree, CopyX, Brain,
  DollarSign, TrendingUp, Boxes, Archive, Table2, Activity,
  UploadCloud, History, Wand2, Layers,
  Database, AlertTriangle, BarChart3,
  LayoutList, Scale, ClipboardList, GitBranch, BellRing, Rocket, Sparkles, ArrowRight,
} from 'lucide-react'
import {
  getControlCenterSummary, openIssueCount, rankIssues, ISSUE_ROUTE, ISSUE_SEVERITY_TONE,
} from '../../lib/api/controlCenter'
import { openConsoleRoute, isConsoleRoute } from '../lib/openRoute'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, StatTile, Btn, Badge, Note, SearchInput, Segmented, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { BarsChart } from '../components/ui/charts'
import { searchRows, sortRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, TabBar, useUrlTab, usePager, Pager, AttentionList } from './shared/pageKit'

/**
 * Data Operations hub.
 *
 * One launchpad for every data-management surface a super-admin reaches from
 * scattered places today: trust and quality, cost and production, imports and
 * masters. Each card links to an EXISTING route (verified against App.jsx) - it
 * adds no new capability, it only makes the set findable in one screen.
 *
 * The headline strip is a best-effort read of the diagnostics summary; if it
 * cannot load, the link cards still render (they are the point of the page).
 */

const GROUPS = [
  {
    key: 'trust',
    title: 'Trust and quality',
    subtitle: 'Find and fix data-quality problems before they reach a report.',
    icon: ShieldCheck,
    cards: [
      { icon: ShieldCheck, title: 'Data Trust & Control', route: '/console/control-center',
        desc: 'Trust scores, figure lineage and one-call diagnostics for every KPI.' },
      { icon: ListTree, title: 'Data Reconciliation', route: '/data-reconciliation',
        desc: 'Orphan assets, duplicate tyres and serial conflicts, with safe fixes.' },
      { icon: CopyX, title: 'Duplicate Control', route: '/console/duplicates',
        desc: 'Detect and remove re-inserted rows, with a full undo archive.' },
      { icon: Brain, title: 'Teach the Classifier', route: '/console/classification-learning',
        desc: 'Review corrections so the expense classifier learns from your edits.' },
    ],
  },
  {
    key: 'lineage',
    title: 'Data trust and lineage',
    subtitle: 'Governed metric definitions, quality checks and where every number comes from.',
    icon: ShieldCheck,
    cards: [
      { icon: Sparkles, title: 'Data Learning', route: '/console/data-learning',
        desc: 'Confirm a fact once and fix current plus future data across the fleet.' },
      { icon: LayoutList, title: 'Metric Catalogue', route: '/console/metric-catalogue',
        desc: 'Every governed KPI: formula, owner, source and Explain This Number.' },
      { icon: ShieldCheck, title: 'Data Quality', route: '/console/data-quality',
        desc: 'Run the registered checks and see failing rows worst-first.' },
      { icon: Scale, title: 'Reconciliation', route: '/console/reconciliation',
        desc: 'Expected vs actual across cost, fleet and production, with the gap.' },
      { icon: Activity, title: 'Pipeline Monitor', route: '/console/pipeline-monitor',
        desc: 'Import jobs and integration events: what ran and what failed.' },
      { icon: ClipboardList, title: 'Correction Center', route: '/console/correction-center',
        desc: 'Governed correction cases from reported through to reconciled.' },
      { icon: GitBranch, title: 'Lineage Explorer', route: '/console/lineage',
        desc: 'Visualize where a number comes from and what a change would affect.' },
      { icon: BellRing, title: 'Trust Alerts', route: '/console/trust-alerts',
        desc: 'Quality and reconciliation breaches raised for acknowledgement.' },
      { icon: Rocket, title: 'Releases', route: '/console/releases',
        desc: 'Recorded releases and the data assets each one impacts.' },
    ],
  },
  {
    key: 'cost',
    title: 'Cost and production',
    subtitle: 'Operating cost per unit and the production data behind it.',
    icon: DollarSign,
    cards: [
      { icon: DollarSign, title: 'Cost per M3', route: '/cost-per-m3',
        desc: 'Internal plus SCO plus SANY cost over approved production, by region.' },
      { icon: TrendingUp, title: 'CPK Intelligence', route: '/cpk-intelligence',
        desc: 'Cost per km and per engine-hour, split movable versus non-movable.' },
      { icon: Boxes, title: 'Production M3', route: '/production-m3',
        desc: 'Approved and rejected concrete production by site and period.' },
      { icon: Archive, title: 'SCO Costs', route: '/sco-costs',
        desc: 'Sub-contracted operating cost ledger feeding the cost per M3.' },
      { icon: Table2, title: 'SANY Invoices', route: '/sany-invoices',
        desc: 'SANY summary and parts-detail invoices, linked by quotation number.' },
      { icon: Activity, title: 'Expenses & CPK', route: '/expense-report',
        desc: 'Real expense grid with cost per km trends and what moved.' },
    ],
  },
  {
    key: 'imports',
    title: 'Imports and masters',
    subtitle: 'Load data and keep the reference masters clean.',
    icon: UploadCloud,
    cards: [
      { icon: UploadCloud, title: 'Data Intake', route: '/data-intake',
        desc: 'Upload ERP, production, SCO and SANY files through the intake wizard.' },
      { icon: History, title: 'Import History', route: '/console/import-history',
        desc: 'Every upload, its rows, duplicates and errors, plus repeat-file flags.' },
      { icon: Wand2, title: 'Smart Import', route: '/console/smart-import',
        desc: 'Drop any Excel or CSV and it auto-detects the module and maps columns.' },
      { icon: Layers, title: 'Material Master', route: '/console/material-master',
        desc: 'Review and confirm item categories that drive expense classification.' },
    ],
  },
]

const TABS = [
  { key: 'overview', label: 'Overview', icon: AlertTriangle },
  ...GROUPS.map((g) => ({ key: g.key, label: g.title, icon: g.icon, count: g.cards.length })),
]
const TAB_KEYS = TABS.map((t) => t.key)
const ISSUE_COLUMNS = [
  { key: 'severity', header: 'Severity', value: (r) => r.severity || 'info' },
  { key: 'label', header: 'Issue', value: (r) => r.label || r.key },
  { key: 'count', header: 'Rows affected' },
  { key: 'route', header: 'Fix on', value: (r) => ISSUE_ROUTE[r.action] || '' },
]
const SEV_RANK = { critical: 0, warning: 1, info: 2 }
const ISSUE_ACCESSORS = { severity: (r) => SEV_RANK[r.severity] ?? 9, label: (r) => r.label || r.key, count: (r) => Number(r.count) || 0 }

export default function ConsoleDataOps() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [refreshedAt, setRefreshedAt] = useState(null)
  const [tab, setTab] = useUrlTab(TAB_KEYS, 'overview')
  const [issueQuery, setIssueQuery] = useState('')
  const [sevFilter, setSevFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await getControlCenterSummary()
      if (!data || data.ok === false) {
        setSummary(null)
        setError('The diagnostics summary is not available right now.')
      } else {
        setSummary(data)
        setRefreshedAt(Date.now())
      }
    } catch (e) {
      setSummary(null)
      setError(toUserMessage(e, 'Could not load the diagnostics summary.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // A search looks across every group, whatever tab is open: a tool you are
  // hunting for should not hide because it lives on another tab.
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    return GROUPS
      .map((g) => ({ ...g, cards: g.cards.filter((c) => `${c.title} ${c.desc} ${c.route}`.toLowerCase().includes(q)) }))
      .filter((g) => g.cards.length > 0)
  }, [search])

  const openIssues = summary ? openIssueCount(summary.issues) : 0
  const vol = useMemo(() => summary?.volumes || {}, [summary])
  const issues = useMemo(() => rankIssues(summary?.issues || []).filter((i) => Number(i.count) > 0), [summary])
  const sevCounts = useMemo(() => issues.reduce((a, i) => { const k = i.severity || 'info'; a[k] = (a[k] || 0) + 1; return a }, {}), [issues])
  const { sort, onSort } = useTableSort(null)
  const shownIssues = useMemo(() => {
    const base = searchRows(issues, issueQuery, ['label', 'key', 'severity'])
      .filter((i) => !sevFilter || (i.severity || 'info') === sevFilter)
    return sort ? sortRows(base, sort, ISSUE_ACCESSORS) : base
  }, [issues, issueQuery, sevFilter, sort])
  const pager = usePager(shownIssues, 25)
  const volumeBars = useMemo(() => [
    { label: 'Expense rows', value: Number(vol.expense_rows) },
    { label: 'Tyre rows', value: Number(vol.tyre_rows) },
    { label: 'Fleet rows', value: Number(vol.fleet_rows) },
    { label: 'Work orders', value: Number(vol.work_orders) },
  ].filter((b) => Number.isFinite(b.value)), [vol])

  const attention = useMemo(() => issues
    .filter((i) => i.severity === 'critical' && ISSUE_ROUTE[i.action])
    .slice(0, 4)
    .map((i) => ({
      key: i.key, tone: 'danger', title: i.label || i.key,
      detail: `${fmtInt(i.count)} rows affected.`,
      action: () => openConsoleRoute(ISSUE_ROUTE[i.action], navigate), actionLabel: 'Fix', actionIcon: ArrowRight,
    })), [issues, navigate])

  const group = GROUPS.find((g) => g.key === tab)

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={Layers} title="Data Operations"
        purpose="One launchpad for every data-management surface, with the open data-quality issues that need a fix."
        refreshedAt={refreshedAt} onRefresh={load} refreshing={loading}
        actions={<Btn variant="primary" icon={ShieldCheck} onClick={() => navigate('/console/control-center')}>Open Control Center</Btn>} />

      {/* ── KPI row ── */}
      {loading && !summary ? (
        <LoadingState label="Loading diagnostics" rows={1} />
      ) : error ? (
        <>
          <ErrorState message={error} onRetry={load} />
          <Note icon={AlertTriangle} tone="default">
            The launchpad below still works. Only the headline figures could not be read.
          </Note>
        </>
      ) : !summary ? (
        <EmptyState title="No diagnostics yet" reason="No summary was returned for the current data set." />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatTile label="Open issues" value={fmtInt(openIssues)} tone={openIssues > 0 ? 'warning' : 'good'}
            icon={AlertTriangle} onClick={() => { setSevFilter(''); setTab('overview') }} active={tab === 'overview' && !sevFilter}
            sub={sevCounts.critical ? `${fmtInt(sevCounts.critical)} critical` : 'tap to review'} />
          <StatTile label="Expense rows" value={fmtInt(vol.expense_rows)} icon={Database} />
          <StatTile label="Tyre rows" value={fmtInt(vol.tyre_rows)} icon={Database} />
          <StatTile label="Fleet rows" value={fmtInt(vol.fleet_rows)} icon={Database} />
          <StatTile label="Work orders" value={fmtInt(vol.work_orders)} icon={Database} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <TabBar ariaLabel="Data operations view" tabs={TABS.map((t) => (t.key === 'overview' ? { ...t, count: summary ? openIssues : undefined } : t))}
          value={tab} onChange={(k) => { setSearch(''); setTab(k) }} />
        <SearchInput value={search} onChange={setSearch} placeholder="Find a data tool" className="w-full sm:w-64 sm:ml-auto" />
      </div>

      {matches ? (
        <>
          <p className="text-xs text-gray-400" aria-live="polite">{matches.reduce((n, g) => n + g.cards.length, 0)} tools match &quot;{search.trim()}&quot; across every group</p>
          {matches.length === 0 && (
            <EmptyState title="No data tool matches that search" reason="Try a module name such as Import, Cost or Lineage." />
          )}
          {matches.map((g) => <ToolGroup key={g.key} group={g} navigate={navigate} />)}
        </>
      ) : tab === 'overview' ? (
        <div className="space-y-4">
          <AttentionList quiet items={attention} title="Critical issues with a fix" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel className="lg:col-span-2" flush>
              <div className="p-4 pb-2">
                <PanelHeader icon={AlertTriangle} title="Open data-quality issues"
                  subtitle="Worst first. Each fix opens the page that resolves it."
                  actions={<ExportButtons rows={shownIssues} columns={ISSUE_COLUMNS} title="TyrePulse Open Data Issues" disabled={!summary} />} />
                <Toolbar>
                  <SearchInput value={issueQuery} onChange={setIssueQuery} placeholder="Search issues" className="w-full sm:w-56" />
                  <Segmented role="group" ariaLabel="Severity" value={sevFilter} onChange={setSevFilter} options={[
                    { key: '', label: 'All', count: issues.length },
                    { key: 'critical', label: 'Critical', count: sevCounts.critical || 0 },
                    { key: 'warning', label: 'Warning', count: sevCounts.warning || 0 },
                    { key: 'info', label: 'Info', count: sevCounts.info || 0 },
                  ]} />
                </Toolbar>
              </div>
              <div className="px-4 pb-4">
                {loading && !summary ? <LoadingState label="Loading issues" rows={3} />
                  : error ? <p className="text-xs text-gray-400 py-4">Issues could not be read, so none are listed. Use Retry above.</p>
                    : shownIssues.length === 0 ? (
                      <EmptyState icon={ShieldCheck}
                        title={issues.length ? 'No issue matches these filters' : 'No open data-quality issues'}
                        reason={issues.length ? 'Clear the search or severity filter.' : 'Every diagnostic check returned zero affected rows.'} />
                    ) : (
                      <>
                        <Table>
                          <THead>
                            <Th sortKey="severity" sort={sort} onSort={onSort}>Severity</Th>
                            <Th sortKey="label" sort={sort} onSort={onSort}>Issue</Th>
                            <Th sortKey="count" sort={sort} onSort={onSort} align="right">Rows</Th>
                            <Th align="right">Action</Th>
                          </THead>
                          <tbody>
                            {pager.pageRows.map((issue) => {
                              const route = ISSUE_ROUTE[issue.action]
                              return (
                                <Tr key={issue.key}>
                                  <Td><Badge tone={ISSUE_SEVERITY_TONE[issue.severity] || 'info'}>{issue.severity || 'info'}</Badge></Td>
                                  <Td><span className="text-gray-300">{issue.label || issue.key}</span></Td>
                                  <Td align="right"><span className="tabular-nums text-gray-200">{fmtInt(issue.count)}</span></Td>
                                  <Td align="right">
                                    {route ? <Btn size="xs" icon={ArrowRight} onClick={() => openConsoleRoute(route, navigate)}>Fix</Btn>
                                      : <span className="text-gray-500">Review in Control Center</span>}
                                  </Td>
                                </Tr>
                              )
                            })}
                          </tbody>
                        </Table>
                        <Pager pager={pager} label="issues" />
                      </>
                    )}
              </div>
            </Panel>
            <Panel>
              <PanelHeader icon={BarChart3} title="Where the data lives" subtitle="Record volumes in the core tables." />
              {summary ? (
                <BarsChart bars={volumeBars} valueFormat={(v) => `${fmtInt(v)} rows`}
                  summary={volumeBars.map((b) => `${b.label}: ${b.value}`).join(', ')}
                  emptyText="No volumes were returned." />
              ) : <EmptyState title="Volumes not available" reason={error ? 'The diagnostics summary could not be read.' : 'Loading.'} />}
            </Panel>
          </div>
        </div>
      ) : group ? (
        <ToolGroup group={group} navigate={navigate} />
      ) : null}
    </div>
  )
}

function ToolGroup({ group, navigate }) {
  return (
    <Panel>
      <PanelHeader icon={group.icon} title={group.title} subtitle={group.subtitle} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {group.cards.map((c) => (
          <LinkCard key={c.route} card={c} onOpen={() => openConsoleRoute(c.route, navigate)} />
        ))}
      </div>
    </Panel>
  )
}

function LinkCard({ card, onOpen }) {
  const { icon: Icon, title, desc, route } = card
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left bg-gray-900/50 border border-gray-800 rounded-xl p-4 transition-colors hover:border-orange-700/50 hover:bg-gray-900 flex flex-col gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-800/40 flex items-center justify-center shrink-0">
          <Icon size={16} className="text-orange-400" aria-hidden="true" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-200 truncate">{title}</p>
          <p className="text-[11px] font-mono text-gray-400 truncate">{route}</p>
        </div>
      </div>
      <p className="text-xs text-gray-400 flex-1">{desc}</p>
      <span className="text-xs text-orange-400 font-medium mt-1">{isConsoleRoute(route) ? 'Open' : 'Open in new tab'}</span>
    </button>
  )
}

function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  return Math.round(Number(v)).toLocaleString('en-US')
}
