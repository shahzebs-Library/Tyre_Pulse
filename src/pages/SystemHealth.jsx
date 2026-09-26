/**
 * SystemHealth — internal admin-only health monitoring board (roadmap #23).
 * Designed for route /system-health (route wiring lives in App.jsx).
 *
 * One screen showing every subsystem green/amber/red:
 *   Database (core query latency) / Tables / Storage buckets /
 *   Edge Functions (OPTIONS reachability ping — zero AI/email cost) / Auth.
 *
 * - Admin-only guard inside the page (friendly denied state for other roles).
 * - Auto-refresh every 60s + manual refresh; per-check failure isolation is
 *   handled in src/lib/systemHealth.js so one outage can't blank the page.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Activity, Database, Table2, HardDrive, Zap, KeyRound,
  ShieldAlert, CheckCircle2, AlertTriangle, XCircle, HelpCircle,
  Download, FileText, Gauge, Timer, History, Search,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  buildHealthRows, healthKpis, filterHealthRows, appendRun, historyStats,
  flappingChecks, runFreshness, healthExportRows, HEALTH_STATUS_LABEL, HEALTH_GROUP_LABEL,
} from '../lib/systemHealthAnalytics'
import { useAuth } from '../contexts/AuthContext'
import { cn } from '../lib/cn'
import { toUserMessage } from '../lib/safeError'
import PageHeader from '../components/ui/PageHeader'
import { Skeleton } from '../components/ui/Skeleton'
import { runAllChecks, STATUS } from '../lib/systemHealth'

const REFRESH_MS = 60_000

// ── Status + group presentation maps ──────────────────────────────────────────

const STATUS_STYLE = {
  [STATUS.OK]: {
    label: 'Operational', Icon: CheckCircle2,
    dot: 'bg-emerald-500', text: 'text-emerald-400',
    pill: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  },
  [STATUS.DEGRADED]: {
    label: 'Degraded', Icon: AlertTriangle,
    dot: 'bg-amber-500', text: 'text-amber-400',
    pill: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  },
  [STATUS.DOWN]: {
    label: 'Down', Icon: XCircle,
    dot: 'bg-red-500', text: 'text-red-400',
    pill: 'bg-red-500/10 text-red-300 border-red-500/20',
  },
  [STATUS.UNKNOWN]: {
    label: 'Unknown', Icon: HelpCircle,
    dot: 'bg-gray-500', text: 'text-gray-400',
    pill: 'bg-gray-500/10 text-gray-300 border-gray-500/20',
  },
}

const GROUPS = [
  { key: 'database', label: 'Database',       Icon: Database },
  { key: 'tables',   label: 'Tables',         Icon: Table2 },
  { key: 'storage',  label: 'Storage',        Icon: HardDrive },
  { key: 'edge',     label: 'Edge Functions', Icon: Zap },
  { key: 'auth',     label: 'Auth',           Icon: KeyRound },
  { key: 'general',  label: 'Other',          Icon: Activity },
]

const OVERALL_BANNER = {
  [STATUS.OK]: {
    text: 'All systems operational',
    cls: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    Icon: CheckCircle2,
  },
  [STATUS.DEGRADED]: {
    text: 'Degraded performance, some subsystems need attention',
    cls: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    Icon: AlertTriangle,
  },
  [STATUS.DOWN]: {
    text: 'Outage detected, one or more subsystems are down',
    cls: 'border-red-500/25 bg-red-500/10 text-red-300',
    Icon: XCircle,
  },
  [STATUS.UNKNOWN]: {
    text: 'Health status unknown',
    cls: 'border-gray-500/25 bg-gray-500/10 text-gray-300',
    Icon: HelpCircle,
  },
}

function formatLatency(ms) {
  if (ms == null) return 'N/A'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

// ── Tiles ─────────────────────────────────────────────────────────────────────

function CheckTile({ check }) {
  const s = STATUS_STYLE[check.status] ?? STATUS_STYLE[STATUS.UNKNOWN]
  return (
    <div className="card p-4 flex flex-col gap-2 min-w-0" role="listitem" aria-label={`${check.label}: ${s.label}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', s.dot, check.status !== STATUS.OK && 'animate-pulse')} />
          <p className="text-sm font-semibold truncate" title={check.label}>{check.label}</p>
        </div>
        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap', s.pill)}>
          {s.label}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate" title={check.detail}>{check.detail || 'N/A'}</span>
        <span className={cn('tabular-nums whitespace-nowrap font-medium', s.text)}>{formatLatency(check.latencyMs)}</span>
      </div>
    </div>
  )
}

function GroupSection({ group, checks }) {
  if (checks.length === 0) return null
  const { Icon } = group
  const worst = checks.some((c) => c.status === STATUS.DOWN)
    ? STATUS.DOWN
    : checks.some((c) => c.status === STATUS.DEGRADED || c.status === STATUS.UNKNOWN)
      ? STATUS.DEGRADED
      : STATUS.OK
  const ws = STATUS_STYLE[worst]
  return (
    <section aria-label={group.label}>
      <div className="flex items-center gap-2 mb-2.5">
        <Icon size={15} className="text-muted" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">{group.label}</h2>
        <span className={cn('w-1.5 h-1.5 rounded-full', ws.dot)} aria-hidden="true" />
        <span className="text-[10px] text-muted ml-auto tabular-nums">
          {checks.filter((c) => c.status === STATUS.OK).length}/{checks.length} healthy
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" role="list">
        {checks.map((c) => <CheckTile key={c.id} check={c} />)}
      </div>
    </section>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Running health checks">
      <Skeleton className="h-12 w-full rounded-xl" />
      {[4, 8, 3].map((count, gi) => (
        <div key={gi}>
          <Skeleton className="h-3 w-32 mb-3" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: count }).map((_, i) => (
              <Skeleton key={i} className="h-[74px] rounded-2xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function AccessDenied() {
  return (
    <div className="card max-w-md mx-auto mt-16 p-8 text-center flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <ShieldAlert size={22} className="text-red-400" />
      </div>
      <h1 className="text-lg font-bold">Admin access required</h1>
      <p className="text-sm text-muted">
        System health monitoring is restricted to administrators. If you believe
        you need access, ask an admin to update your role.
      </p>
    </div>
  )
}

// ── KPI tile ─────────────────────────────────────────────────────────────────

function Kpi({ icon: Icon, label, value, hint, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Icon size={14} /> <span className="truncate">{label}</span>
      </div>
      <p className={cn('mt-1.5 text-xl font-bold tabular-nums', tone)}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted truncate" title={hint}>{hint}</p>}
    </div>
  )
}

const EXPORT_COLS = ['group', 'label', 'id', 'status', 'latency', 'detail']
const EXPORT_HEADERS = ['Group', 'Check', 'Identifier', 'Status', 'Latency', 'Detail']

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SystemHealth() {
  const { profile, loading: authLoading } = useAuth()
  const isAdmin = profile?.role === 'Admin'

  const [report, setReport]       = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [runError, setRunError]   = useState(null)
  const [history, setHistory]     = useState([])
  const [now, setNow]             = useState(() => Date.now())
  const [view, setView]           = useState('tiles')
  const [statusFilter, setStatusFilter] = useState('all')
  const [groupFilter, setGroupFilter]   = useState('all')
  const [search, setSearch]       = useState('')
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setRunError(null)
    try {
      const next = await runAllChecks()
      if (mountedRef.current) {
        setReport(next)
        setHistory((h) => appendRun(h, next))
      }
    } catch (err) {
      // runAllChecks isolates per-check failures; this only fires on a bug.
      if (mountedRef.current) setRunError(toUserMessage(err, 'Health run failed'))
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (!isAdmin) return undefined
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    const tick = setInterval(() => setNow(Date.now()), 15_000)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
      clearInterval(tick)
    }
  }, [isAdmin, refresh])

  const rows = useMemo(() => buildHealthRows(report?.checks ?? []), [report])
  const kpis = useMemo(() => healthKpis(report?.checks ?? []), [report])
  const hist = useMemo(() => historyStats(history), [history])
  const flapping = useMemo(() => flappingChecks(history), [history])
  const freshness = runFreshness(report?.checkedAt, now, REFRESH_MS)
  const filteredRows = useMemo(
    () => filterHealthRows(rows, { status: statusFilter, group: groupFilter, search }),
    [rows, statusFilter, groupFilter, search],
  )
  const filteredIds = useMemo(() => new Set(filteredRows.map((r) => r.id)), [filteredRows])

  const grouped = useMemo(() => {
    const checks = (report?.checks ?? []).filter((c) => filteredIds.has(String(c.id)))
    return GROUPS.map((g) => ({ group: g, checks: checks.filter((c) => c.group === g.key) }))
  }, [report, filteredIds])

  const columns = useMemo(() => [
    { id: 'groupLabel', header: 'Group', accessorFn: (r) => r.groupLabel, size: 120 },
    {
      id: 'label', header: 'Check', accessorFn: (r) => r.label, size: 200,
      cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r.statusLabel, size: 110,
      cell: ({ row }) => {
        const st = STATUS_STYLE[row.original.status] ?? STATUS_STYLE[STATUS.UNKNOWN]
        return <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap', st.pill)}>{st.label}</span>
      },
    },
    {
      id: 'latencyMs', header: 'Latency', accessorFn: (r) => r.latencyMs ?? -1, size: 90, meta: { align: 'right', exportValue: (r) => formatLatency(r.latencyMs) },
      cell: ({ row }) => <span className="tabular-nums">{formatLatency(row.original.latencyMs)}</span>,
    },
    { id: 'detail', header: 'Detail', accessorFn: (r) => r.detail || 'N/A', size: 280 },
  ], [])

  const reportTitle = 'System Health'
  const exportRows = healthExportRows(filteredRows)
  const doExcel = () => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'system_health')
  const doPdf = () => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), reportTitle, 'system_health', 'landscape')

  if (authLoading) return <LoadingSkeleton />
  if (!isAdmin)    return <AccessDenied />

  const overall = report?.summary?.overall ?? STATUS.UNKNOWN
  const banner  = OVERALL_BANNER[overall] ?? OVERALL_BANNER[STATUS.UNKNOWN]
  const summary = report?.summary
  const filtersActive = statusFilter !== 'all' || groupFilter !== 'all' || search.trim() !== ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Health"
        subtitle="Read access, storage, remote authentication and function preflight checks; business workflows are not exercised"
        icon={Activity}
        onRefresh={refresh}
        refreshing={refreshing}
        updatedAt={report?.checkedAt}
        actions={(
          <div className="flex items-center gap-2">
            <button type="button" onClick={doExcel} disabled={!exportRows.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-40">
              <Download size={14} /> Excel
            </button>
            <button type="button" onClick={doPdf} disabled={!exportRows.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-40">
              <FileText size={14} /> PDF
            </button>
          </div>
        )}
      />

      {runError && (
        <div className="card border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300 flex items-center justify-between gap-3" role="alert">
          <span>Health run failed: {runError}</span>
          <button type="button" onClick={refresh} className="btn-secondary text-xs">Retry</button>
        </div>
      )}

      {!report ? (
        <LoadingSkeleton />
      ) : (
        <>
          {/* Overall banner */}
          <div className={cn('rounded-2xl border px-5 py-4 flex items-center gap-3', banner.cls)} role="status">
            <banner.Icon size={20} className="flex-shrink-0" />
            <p className="text-sm font-semibold flex-1">{banner.text}</p>
            {summary && (
              <div className="flex items-center gap-3 text-xs tabular-nums">
                <span className="text-emerald-300">{summary.ok} ok</span>
                <span className="text-amber-300">{summary.degraded} degraded</span>
                <span className="text-red-300">{summary.down} down</span>
                {summary.unknown > 0 && <span className="text-gray-300">{summary.unknown} unknown</span>}
              </div>
            )}
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi icon={Gauge} label="Healthy checks" value={kpis.availabilityPct == null ? 'N/A' : `${kpis.availabilityPct}%`}
              hint={`${kpis.ok} of ${kpis.total} operational`}
              tone={kpis.down ? 'text-red-400' : kpis.degraded || kpis.unknown ? 'text-amber-400' : 'text-emerald-400'} />
            <Kpi icon={Timer} label="Average latency" value={formatLatency(kpis.avgLatencyMs)}
              hint={`${kpis.measuredLatencyCount} of ${kpis.total} checks timed`} />
            <Kpi icon={Timer} label="Latency p95" value={formatLatency(kpis.p95LatencyMs)} hint="Slowest 5% of timed checks" />
            <Kpi icon={AlertTriangle} label="Slowest check" value={kpis.slowest ? formatLatency(kpis.slowest.latencyMs) : 'N/A'}
              hint={kpis.slowest?.label ?? 'No timed checks'} />
            <Kpi icon={History} label="Healthy runs (this session)" value={hist.healthyRunPct == null ? 'N/A' : `${hist.healthyRunPct}%`}
              hint={`${hist.healthyRuns} of ${hist.runs} runs since this page opened`} />
            <Kpi icon={Activity} label="Last run" value={freshness.label}
              hint={freshness.stale ? 'Older than two refresh cycles' : 'Refreshes every 60 seconds'}
              tone={freshness.stale ? 'text-amber-400' : 'text-[var(--text-primary)]'} />
          </div>

          {(hist.lastIncidentAt || flapping.length > 0) && (
            <div className="card p-4 text-xs text-muted space-y-1">
              {hist.lastIncidentAt && (
                <p>
                  Last {HEALTH_STATUS_LABEL[hist.lastIncidentStatus]?.toLowerCase() ?? 'incident'} run this session: {' '}
                  <span className="text-[var(--text-primary)]">{new Date(hist.lastIncidentAt).toLocaleTimeString('en-GB')}</span>
                </p>
              )}
              {flapping.length > 0 && (
                <p>
                  Unstable checks (status changed repeatedly): {' '}
                  <span className="text-amber-300">{flapping.map((f) => `${f.id} (${f.changes}x)`).join(', ')}</span>
                </p>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="card p-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search checks or detail"
                aria-label="Search checks"
                className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] pl-8 pr-3 py-1.5 text-sm" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status"
              className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-sm">
              <option value="all">All statuses</option>
              {Object.entries(HEALTH_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Filter by group"
              className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-sm">
              <option value="all">All groups</option>
              {Object.entries(HEALTH_GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {filtersActive && (
              <button type="button" className="btn-ghost text-xs"
                onClick={() => { setStatusFilter('all'); setGroupFilter('all'); setSearch('') }}>Clear</button>
            )}
            <div className="ml-auto flex rounded-lg border border-[var(--input-border)] overflow-hidden text-xs">
              {['tiles', 'table'].map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                  className={cn('px-3 py-1.5', view === v ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-muted')}>
                  {v === 'tiles' ? 'Tiles' : 'Table'}
                </button>
              ))}
            </div>
            <span className="w-full text-[11px] text-muted">{filteredRows.length} of {rows.length} checks shown</span>
          </div>

          {view === 'tiles' ? (
            filteredRows.length === 0 ? (
              <div className="card p-8 text-center text-sm text-muted">No checks match the current filters.</div>
            ) : (
              grouped.map(({ group, checks }) => (
                <GroupSection key={group.key} group={group} checks={checks} />
              ))
            )
          ) : (
            <EnterpriseTable
              columns={columns}
              data={filteredRows}
              getRowId={(r) => r.id}
              enableGlobalFilter={false}
              enableExport={false}
              initialPageSize={25}
              emptyMessage="No checks match the current filters"
            />
          )}

          <p className="text-[11px] text-muted">
            Checks run automatically every 60 seconds. Edge functions are probed
            with a reachability ping only. No AI calls or emails are sent. Run
            history is kept only while this page is open; there is no stored
            uptime record, so session figures are not long-term availability.
          </p>
        </>
      )}
    </div>
  )
}
