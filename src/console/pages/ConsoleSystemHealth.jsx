/**
 * ConsoleSystemHealth - super-admin System Health console (Admin Control Module 1).
 *
 * A pure console page (useConsoleAuth for the admin gate; no ConsoleAuthBridge
 * needed). Surfaces one plain-English operating picture:
 *   1. TyrePulse Health Score 0 to 100 (ring + contributing factors)
 *   2. Status tiles (Supabase / last sync / last AI call / last report / backup)
 *   3. Subsystem tiles (Database / Tables / Storage / Edge / Auth) from live probes
 *   4. Errors per day by severity + totals by severity (last 14 days)
 *   5. Error log table (filter + per row Resolve + Resolve all)
 *   6. Realtime auto refresh (system_logs channel) + manual + 60s fallback
 *
 * Every technical term carries a small (i) plain-English tooltip so a
 * non-technical owner can read the board without a glossary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, RefreshCw, ShieldAlert, CheckCircle2, Info, Database, HardDrive,
  Zap, KeyRound, Table2, Server, Clock, Cpu, FileText, Archive, BarChart3, ListChecks,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listSystemLogs, resolveSystemLog, resolveAllSystemLogs, getHealthMetrics,
} from '../../lib/api/systemLogs'
import {
  computeHealthScore, freshnessScore, errorRateScore, reachabilityScore,
} from '../../lib/adminHealth'
import { runAllChecks } from '../../lib/systemHealth'
import { toUserMessage } from '../../lib/safeError'
import { fetchAllPages } from '../../lib/fetchAll'
import { dailySeries } from '../../lib/consoleCharts'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { TrendChart, BarsChart, ScoreRing, STATUS, useChartTheme } from '../components/ui/charts'

const REFRESH_MS = 60_000
const LOG_LIMIT = 200
const TREND_DAYS = 14
const TREND_MAX_ROWS = 20000

// ── Small building blocks ─────────────────────────────────────────────────────

/** Plain-English tooltip marker sitting next to a technical term. */
function InfoDot({ text }) {
  return (
    <span tabIndex={0} role="img" aria-label={text} title={text}
      className="inline-flex align-middle ml-1 rounded text-gray-500 hover:text-gray-300 cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
      <Info size={11} aria-hidden="true" />
    </span>
  )
}

/** A 0 to 100 value mapped to a StatTile tone. */
function scoreTone(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'muted'
  if (value >= 80) return 'good'
  if (value >= 50) return 'warning'
  return 'danger'
}

/** Reachability check status -> tone (matches systemHealth STATUS). */
function checkTone(status) {
  if (status === 'ok') return 'good'
  if (status === 'degraded' || status === 'unknown') return 'warning'
  if (status === 'down') return 'danger'
  return 'quiet'
}

/** StatTile tone name for a Badge-style tone. */
const TILE_FROM_BADGE = { good: 'good', warning: 'warning', danger: 'danger', quiet: 'muted' }

// Severity vocabulary: badge tone + chart colour key + readable label.
const SEVERITIES = [
  { key: 'critical', label: 'Critical', tone: 'danger', color: 'critical' },
  { key: 'error', label: 'Error', tone: 'accent', color: 'high' },
  { key: 'warning', label: 'Warning', tone: 'warning', color: 'medium' },
  { key: 'info', label: 'Info', tone: 'info', color: 'low' },
]
const SEV_BY_KEY = Object.fromEntries(SEVERITIES.map((s) => [s.key, s]))

/** Fold severity spellings onto the four canonical keys. */
function canonSeverity(v) {
  const s = String(v ?? 'info').toLowerCase()
  if (s === 'warn') return 'warning'
  return SEV_BY_KEY[s] ? s : 'info'
}

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString()
}

function fmtRelative(v) {
  if (!v) return 'N/A'
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return 'N/A'
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.floor(hrs / 24)
  return `${days} d ago`
}

/** Freshest ISO date across a { stream: isoDate } map. */
function freshestOf(latestByStream) {
  if (!latestByStream || typeof latestByStream !== 'object') return null
  let best = null
  for (const v of Object.values(latestByStream)) {
    if (!v) continue
    const t = new Date(v).getTime()
    if (Number.isNaN(t)) continue
    if (best == null || t > new Date(best).getTime()) best = v
  }
  return best
}

/** Pick a stream entry whose key contains one of the given hints. */
function pickStream(latestByStream, hints) {
  if (!latestByStream || typeof latestByStream !== 'object') return null
  const keys = Object.keys(latestByStream)
  for (const hint of hints) {
    const k = keys.find(x => x.toLowerCase().includes(hint))
    if (k && latestByStream[k]) return latestByStream[k]
  }
  return null
}

/**
 * Every system_logs row (created_at + severity) of the trend window, paged past
 * the 1000-row response cap so a busy fortnight is counted in full.
 */
async function loadTrendRows(sinceIso) {
  const { data, error, truncated } = await fetchAllPages(
    (from, to) => supabase.from('system_logs')
      .select('id,created_at,severity')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    { max: TREND_MAX_ROWS },
  )
  if (error) throw error
  return { rows: Array.isArray(data) ? data : [], truncated }
}

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * A failed subsystem check carries the raw driver/Postgres message as its
 * detail. Route it through the shared sanitiser so a table name, error code or
 * permission text never reaches the screen; our own plain wording passes.
 */
function checkDetail(c) {
  if (!c?.detail) return statusWord(c?.status)
  return c.status === 'ok' ? c.detail : toUserMessage(c.detail, statusWord(c.status))
}

export default function ConsoleSystemHealth() {
  const { admin } = useConsoleAuth()
  const theme = useChartTheme()

  const [metrics, setMetrics]   = useState(null)
  const [health, setHealth]     = useState(null)   // { score, band, factors }
  const [report, setReport]     = useState(null)   // runAllChecks output
  const [logs, setLogs]         = useState([])
  const [moduleOptions, setModuleOptions] = useState([])
  const [trendRows, setTrendRows] = useState(null)  // null = paged read failed, fall back
  const [trendTruncated, setTrendTruncated] = useState(false)

  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]       = useState(null)
  const [logsError, setLogsError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [resolvingId, setResolvingId] = useState(null)
  const [resolvingAll, setResolvingAll] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)

  // Filters
  const [fSeverity, setFSeverity] = useState('all')
  const [fModule, setFModule]     = useState('all')
  const [fResolved, setFResolved] = useState('open')
  const [fSince, setFSince]       = useState('7')   // days, or 'all'

  const mountedRef = useRef(true)

  const buildLogFilters = useCallback(() => {
    const filters = { limit: LOG_LIMIT }
    if (fSeverity !== 'all') filters.severity = fSeverity
    if (fModule !== 'all') filters.module = fModule
    if (fResolved === 'open') filters.resolved = false
    else if (fResolved === 'resolved') filters.resolved = true
    if (fSince !== 'all') {
      const days = Number(fSince)
      if (Number.isFinite(days) && days > 0) {
        filters.since = new Date(Date.now() - days * 86400000).toISOString()
      }
    }
    return filters
  }, [fSeverity, fModule, fResolved, fSince])

  // Load the error log table for the current filters.
  const loadLogs = useCallback(async () => {
    setLogsError(null)
    try {
      const rows = await listSystemLogs(buildLogFilters())
      if (mountedRef.current) setLogs(Array.isArray(rows) ? rows : [])
    } catch (err) {
      if (mountedRef.current) setLogsError(toUserMessage(err, 'Could not load the error log'))
    }
  }, [buildLogFilters])

  // Load metrics + health score + subsystem probes + module options + trend.
  const loadCore = useCallback(async () => {
    setError(null)
    const since = new Date(Date.now() - TREND_DAYS * 86400000).toISOString()
    const [metricsRes, checksRes, optionsRes, trendRes] = await Promise.allSettled([
      getHealthMetrics(),
      runAllChecks(),
      listSystemLogs({ limit: 500 }),
      loadTrendRows(since),
    ])

    let m = null
    if (metricsRes.status === 'fulfilled') m = metricsRes.value
    else setError(toUserMessage(metricsRes.reason, 'Could not load health metrics'))
    if (mountedRef.current) setMetrics(m)

    let rep = null
    if (checksRes.status === 'fulfilled') rep = checksRes.value
    if (mountedRef.current) setReport(rep)

    // Module dropdown options from a broad (unfiltered) log sample.
    if (optionsRes.status === 'fulfilled' && Array.isArray(optionsRes.value)) {
      const mods = Array.from(
        new Set(optionsRes.value.map(r => r?.module_id).filter(Boolean))
      ).sort()
      if (mountedRef.current) setModuleOptions(mods)
    }

    if (mountedRef.current) {
      if (trendRes.status === 'fulfilled') {
        setTrendRows(trendRes.value.rows)
        setTrendTruncated(trendRes.value.truncated === true)
      } else {
        setTrendRows(null)
        setTrendTruncated(false)
      }
    }

    // Compose the health score from the three real factors (anomaly detection
    // is not wired in yet -> honest null).
    try {
      const freshness = m?.latestByStream ? freshnessScore(m.latestByStream, Date.now()) : null
      const errRate = m?.errors
        ? errorRateScore({
            unresolvedCritical: m.errors.unresolvedCritical,
            unresolvedError: m.errors.unresolvedError,
          })
        : null
      const reach = rep?.summary ? reachabilityScore(rep.summary) : null
      const scored = computeHealthScore({
        freshness,
        errorRate: errRate,
        reachability: reach,
        anomaly: null,
      })
      if (mountedRef.current) setHealth(scored)
    } catch {
      if (mountedRef.current) setHealth(null)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadCore(), loadLogs()])
    if (mountedRef.current) { setRefreshing(false); setLoading(false) }
  }, [loadCore, loadLogs])

  // Initial + filter-driven log reload.
  useEffect(() => { loadLogs() }, [loadLogs])

  // Initial core load + realtime + 60s fallback.
  useEffect(() => {
    mountedRef.current = true
    refreshAll()

    const channel = supabase
      .channel('realtime:system_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_logs' }, () => {
        if (mountedRef.current) refreshAll()
      })
      .subscribe()

    const timer = setInterval(() => { if (mountedRef.current) refreshAll() }, REFRESH_MS)

    return () => {
      mountedRef.current = false
      clearInterval(timer)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleResolve(id) {
    if (!id) return
    setResolvingId(id)
    setActionError(null)
    try {
      await resolveSystemLog(id)
      await loadLogs()
      await loadCore()
    } catch (err) {
      // A failed resolve leaves the row as it was, and now says so.
      if (mountedRef.current) setActionError(toUserMessage(err, 'Could not resolve that problem. Please try again.'))
    } finally {
      if (mountedRef.current) setResolvingId(null)
    }
  }

  async function handleResolveAll() {
    setConfirmAll(false)
    setResolvingAll(true)
    setActionError(null)
    try {
      const args = {}
      if (fModule !== 'all') args.module = fModule
      if (fSeverity !== 'all') args.severity = fSeverity
      await resolveAllSystemLogs(args)
      await loadLogs()
      await loadCore()
    } catch (err) {
      if (mountedRef.current) setActionError(toUserMessage(err, 'Could not resolve these problems. Please try again.'))
    } finally {
      if (mountedRef.current) setResolvingAll(false)
    }
  }

  // ── Derived presentation ──
  const score = typeof health?.score === 'number' && Number.isFinite(health.score) ? Math.round(health.score) : null
  const factors = useMemo(() => normalizeFactors(health?.factors), [health])

  const dbCheck = useMemo(
    () => (report?.checks ?? []).find(c => c.id === 'database') ?? null,
    [report],
  )

  const latestByStream = metrics?.latestByStream
  const lastSync   = freshestOf(latestByStream)
  const lastAiCall = pickStream(latestByStream, ['ai_token', 'ai_usage', 'ai'])
  const lastReport = pickStream(latestByStream, ['report_send', 'report'])

  const grouped = useMemo(() => {
    const checks = report?.checks ?? []
    const groups = [
      { key: 'database', label: 'Database', Icon: Database },
      { key: 'tables', label: 'Tables', Icon: Table2 },
      { key: 'storage', label: 'Storage', Icon: HardDrive },
      { key: 'edge', label: 'Edge Functions', Icon: Zap },
      { key: 'auth', label: 'Auth', Icon: KeyRound },
      { key: 'general', label: 'Other', Icon: Activity },
    ]
    return groups
      .map(g => ({ ...g, checks: checks.filter(c => c.group === g.key) }))
      .filter(g => g.checks.length > 0)
  }, [report])

  // Errors per day by severity. Continuous 14-day axis: a quiet day is a 0,
  // never a missing bar. Falls back to the unsplit daily total if the paged
  // severity read failed.
  const trend = useMemo(() => {
    const colors = STATUS[theme]
    if (Array.isArray(trendRows)) {
      const series = SEVERITIES.map((s) => {
        const ds = dailySeries(trendRows.filter(r => canonSeverity(r?.severity) === s.key), r => r.created_at, TREND_DAYS)
        return { key: s.key, label: s.label, values: ds.values, total: ds.total, labels: ds.labels, color: colors[s.color] }
      })
      const active = series.filter(s => s.total > 0)
      const total = series.reduce((a, s) => a + s.total, 0)
      return {
        split: true,
        labels: series[0].labels,
        series: active,
        totals: series,
        total,
      }
    }
    const rows = Array.isArray(metrics?.logsByDay) ? metrics.logsByDay : []
    const ds = dailySeries(rows, r => `${r?.day}T12:00:00Z`, TREND_DAYS, r => Number(r?.count) || 0)
    return {
      split: false,
      labels: ds.labels,
      series: ds.total > 0 ? [{ key: 'all', label: 'All errors', values: ds.values, color: colors.high }] : [],
      totals: [],
      total: ds.total,
    }
  }, [trendRows, metrics, theme])

  const severityBars = useMemo(
    () => trend.totals.map(s => ({ label: s.label, value: s.total, color: s.color })),
    [trend],
  )

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Panel tone="danger">
          <EmptyState icon={ShieldAlert} title="Restricted" reason="System Health is reserved for system administrators." />
        </Panel>
      </div>
    )
  }

  const resolveAllScope = [
    fSeverity !== 'all' ? `severity ${fSeverity}` : 'every severity',
    fModule !== 'all' ? `module ${fModule}` : 'every module',
  ].join(' and ')

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2">
            <Activity size={18} className="text-orange-400" /> System Health
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Live operating status of the whole platform
            {report?.checkedAt && <span> | checked {fmtRelative(report.checkedAt)}</span>}
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={refreshAll} busy={refreshing}>Refresh</Btn>
      </header>

      <ErrorState message={error} onRetry={refreshAll} />
      <ErrorState message={actionError} />

      {/* ── 1. Health score ── */}
      <Panel>
        <PanelHeader
          icon={Activity}
          title={<span className="inline-flex items-center">TyrePulse Health Score
            <InfoDot text="A single 0 to 100 grade for the whole platform. Higher is healthier. It blends how fresh the data is, how many unresolved errors exist, and whether every subsystem is reachable." />
          </span>}
          subtitle="Blended from data freshness, unresolved errors and subsystem reachability."
        />
        {loading && !health ? (
          <LoadingState label="Scoring the platform" rows={2} />
        ) : (
          <div className="flex flex-col lg:flex-row lg:items-center gap-5">
            <ScoreRing score={score} label="Health score" />
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {factors.map(f => (
                <div key={f.key} title={f.hint || undefined}>
                  <StatTile
                    label={f.label}
                    value={f.value == null ? 'N/A' : Math.round(f.value)}
                    sub={f.value == null ? 'Not measured' : 'out of 100'}
                    tone={scoreTone(f.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* ── 2. Status tiles ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatusTile
          icon={Server} label="Supabase"
          tip="The cloud database and backend that powers TyrePulse. Green means the app can reach and read from it."
          tone={dbCheck ? checkTone(dbCheck.status) : 'quiet'}
          value={dbCheck ? statusWord(dbCheck.status) : 'N/A'}
          sub={dbCheck?.latencyMs != null ? `${dbCheck.latencyMs} ms response` : 'Connection'}
        />
        <StatusTile
          icon={Clock} label="Last sync"
          tip="Sync means the newest piece of data recorded anywhere in the system. A recent time means data is flowing in."
          tone={lastSync ? freshnessTone(lastSync) : 'quiet'}
          value={lastSync ? fmtRelative(lastSync) : 'N/A'}
          sub={lastSync ? fmtDateTime(lastSync) : 'No recent activity'}
        />
        <StatusTile
          icon={Cpu} label="Last AI call"
          tip="The most recent time the AI assistant was used. Helps confirm the AI features are working."
          tone={lastAiCall ? freshnessTone(lastAiCall) : 'quiet'}
          value={lastAiCall ? fmtRelative(lastAiCall) : 'N/A'}
          sub={metrics?.ai ? `${metrics.ai.total ?? 0} calls, ${metrics.ai.errors ?? 0} failed` : 'No AI activity'}
        />
        <StatusTile
          icon={FileText} label="Last report"
          tip="The most recent scheduled report email that was sent to users."
          tone={lastReport ? freshnessTone(lastReport) : 'quiet'}
          value={lastReport ? fmtRelative(lastReport) : 'N/A'}
          sub={metrics?.reports ? `${metrics.reports.total ?? 0} sent, ${metrics.reports.failed ?? 0} failed` : 'No reports sent'}
        />
        <StatusTile
          icon={Archive} label="Last backup"
          tip="Automated database backups are managed on the Backups page. This board does not read backup runs."
          tone="quiet"
          value="See Backups"
          sub="Not read on this board"
        />
      </div>

      {/* ── 3. Subsystem tiles ── */}
      <Panel>
        <PanelHeader
          icon={Server}
          title={<span className="inline-flex items-center">Subsystems
            <InfoDot text="A subsystem is one moving part of the platform: the database, the file storage, the background functions, and the login service. Each is pinged to confirm it responds." />
          </span>}
          subtitle="Reachability pings only. They never trigger AI calls or emails."
        />
        {grouped.length === 0 ? (
          loading
            ? <LoadingState label="Running subsystem checks" rows={2} />
            : <EmptyState icon={Server} title="No subsystem results" reason="The reachability checks returned nothing. Refresh to run them again." />
        ) : (
          <div className="space-y-4">
            {grouped.map(g => {
              const worst = g.checks.some(c => c.status === 'down') ? 'danger'
                : g.checks.some(c => c.status === 'degraded' || c.status === 'unknown') ? 'warning' : 'good'
              const okCount = g.checks.filter(c => c.status === 'ok').length
              const Icon = g.Icon
              return (
                <div key={g.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={13} className="text-gray-500" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g.label}</span>
                    <Badge tone={worst}>{okCount}/{g.checks.length} healthy</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {g.checks.map(c => (
                      <div key={c.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 min-w-0">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-xs font-medium text-gray-200 truncate" title={c.label}>{c.label}</span>
                          <Badge tone={checkTone(c.status)}>{statusWord(c.status)}</Badge>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1.5">
                          <span className="text-[10px] text-gray-500 truncate" title={checkDetail(c)}>{checkDetail(c)}</span>
                          <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                            {c.latencyMs != null ? `${c.latencyMs} ms` : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {/* ── 4. Error trend ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            icon={BarChart3}
            title={<span className="inline-flex items-center">Errors per day
              <InfoDot text="How many problems were logged each day over the last two weeks, one line per severity. A rising line means problems are increasing." />
            </span>}
            subtitle={trend.split ? `Last ${TREND_DAYS} days, by severity` : `Last ${TREND_DAYS} days, all severities`}
          />
          {loading && !metrics && trendRows === null ? (
            <LoadingState label="Loading the error trend" rows={3} />
          ) : (
            <TrendChart
              labels={trend.labels}
              series={trend.series}
              yLabel="Problems logged"
              summary={`${trend.total} problems logged in the last ${TREND_DAYS} days.`}
              emptyText={`No errors logged in the last ${TREND_DAYS} days. The system is quiet.`}
            />
          )}
          {trendTruncated && (
            <div className="mt-3">
              <Note icon={Info} tone="warning">
                More than {TREND_MAX_ROWS.toLocaleString()} problems were logged in this window, so the chart covers the oldest {TREND_MAX_ROWS.toLocaleString()} only.
              </Note>
            </div>
          )}
          {!trend.split && !loading && (
            <div className="mt-3">
              <Note icon={Info}>The severity split could not be read, so this shows the daily total only.</Note>
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHeader icon={ListChecks} title="By severity" subtitle={`Totals, last ${TREND_DAYS} days`} />
          {trend.split ? (
            <BarsChart
              bars={severityBars}
              summary={severityBars.map(b => `${b.label} ${b.value}`).join(', ')}
              emptyText="No problems logged in this window."
            />
          ) : (
            <EmptyState icon={ListChecks} title="Severity split not available" reason="The per-severity read failed. Refresh to try again." />
          )}
        </Panel>
      </div>

      {/* ── 5. Error log table ── */}
      <Panel>
        <PanelHeader
          icon={ListChecks}
          title={<span className="inline-flex items-center">Error log
            <InfoDot text="A running list of problems the app has recorded, newest first. Resolve marks a problem as handled so it drops off the open list." />
          </span>}
          subtitle={`Newest first, up to ${LOG_LIMIT} rows for the chosen filters.`}
          actions={(
            <Btn variant="primary" icon={CheckCircle2} busy={resolvingAll} disabled={logs.length === 0}
              onClick={() => setConfirmAll(true)}
              title="Mark every problem matching the current module and severity filters as handled">
              Resolve all
            </Btn>
          )}
        />
        <Toolbar className="mb-3">
          <Select value={fSeverity} onChange={setFSeverity} className="w-40" ariaLabel="Filter by severity"
            options={[{ value: 'all', label: 'All severities' }, ...SEVERITIES.map(s => ({ value: s.key, label: s.label }))]} />
          <Select value={fModule} onChange={setFModule} className="w-44" ariaLabel="Filter by module"
            options={[{ value: 'all', label: 'All modules' }, ...moduleOptions.map(m => ({ value: m, label: m }))]} />
          <Select value={fResolved} onChange={setFResolved} className="w-36" ariaLabel="Filter by status"
            options={[{ value: 'open', label: 'Open only' }, { value: 'resolved', label: 'Resolved only' }, { value: 'all', label: 'All' }]} />
          <Select value={fSince} onChange={setFSince} className="w-36" ariaLabel="Filter by time window"
            options={[
              { value: '1', label: 'Last 24 hours' }, { value: '7', label: 'Last 7 days' },
              { value: '14', label: 'Last 14 days' }, { value: '30', label: 'Last 30 days' }, { value: 'all', label: 'All time' },
            ]} />
          <span className="text-[11px] text-gray-500 ml-auto tabular-nums">{logs.length} shown</span>
        </Toolbar>

        {logsError ? (
          <ErrorState message={logsError} onRetry={loadLogs} />
        ) : loading ? (
          <LoadingState label="Loading error log" />
        ) : logs.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="No problems match these filters"
            reason="Nothing was logged for this severity, module and time window. The system is quiet here." />
        ) : (
          <Table>
            <THead>
              <Th>Time</Th>
              <Th>Severity</Th>
              <Th>Module</Th>
              <Th>Message</Th>
              <Th align="center">Status</Th>
              <Th align="right">Action</Th>
            </THead>
            <tbody>
              {logs.map(row => {
                const sev = SEV_BY_KEY[canonSeverity(row.severity)]
                const isResolved = row.resolved === true || row.resolved_at != null
                return (
                  <Tr key={row.id}>
                    <Td nowrap><span className="text-gray-500" title={fmtDateTime(row.created_at)}>{fmtRelative(row.created_at)}</span></Td>
                    <Td><Badge tone={sev.tone}>{sev.label}</Badge></Td>
                    <Td nowrap><span className="text-gray-400">{row.module_id || row.source || 'app'}</span></Td>
                    <Td className="max-w-md">
                      <span className="line-clamp-2 break-words text-gray-300" title={row.message || ''}>{row.message || 'No message'}</span>
                      {row.reference_id && <span className="block text-[10px] text-gray-500 font-mono mt-0.5 break-all">{row.reference_id}</span>}
                    </Td>
                    <Td align="center">
                      {isResolved ? <Badge tone="good">Resolved</Badge> : <Badge tone="default">Open</Badge>}
                    </Td>
                    <Td align="right">
                      {!isResolved && (
                        <Btn size="xs" variant="ghost" busy={resolvingId === row.id} onClick={() => handleResolve(row.id)}>
                          Resolve
                        </Btn>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <p className="text-[11px] text-gray-500">
        This board refreshes automatically when a new error is recorded, and every 60 seconds as a fallback.
        Subsystem checks are reachability pings only and never trigger AI calls or emails.
      </p>

      <Modal
        open={confirmAll}
        title="Resolve all matching problems?"
        subtitle="This marks them as handled. It does not delete anything."
        onClose={() => setConfirmAll(false)}
        width="max-w-md"
        footer={(
          <>
            <Btn onClick={() => setConfirmAll(false)} disabled={resolvingAll}>Cancel</Btn>
            <Btn variant="primary" icon={CheckCircle2} onClick={handleResolveAll} busy={resolvingAll}>Resolve all</Btn>
          </>
        )}
      >
        <p className="text-sm text-gray-300">
          Every open problem for {resolveAllScope} will be marked as resolved.
          The time window and open or resolved filters do not narrow this action.
        </p>
      </Modal>
    </div>
  )
}

// ── Sub components + helpers ───────────────────────────────────────────────────

function StatusTile({ icon, label, tip, tone, value, sub }) {
  return (
    <div title={tip}>
      <StatTile icon={icon} label={label} value={value} sub={sub} tone={TILE_FROM_BADGE[tone] || 'muted'} />
    </div>
  )
}

function statusWord(status) {
  if (status === 'ok') return 'Operational'
  if (status === 'degraded') return 'Slow'
  if (status === 'down') return 'Down'
  return 'Unknown'
}

/** A freshness tone just from a timestamp: recent good, stale warning, old danger. */
function freshnessTone(iso) {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'quiet'
  const hrs = (Date.now() - t) / 3600000
  if (hrs <= 24) return 'good'
  if (hrs <= 24 * 7) return 'warning'
  return 'danger'
}

/**
 * Normalize computeHealthScore().factors (array or object) into a stable list
 * of { key, label, value, hint }. Values may be null -> rendered as N/A.
 */
function normalizeFactors(factors) {
  const HINTS = {
    freshness: 'How recently data was recorded. Higher means data is flowing in.',
    errorRate: 'Fewer unresolved errors scores higher.',
    reachability: 'Whether every subsystem responded to its health ping.',
    anomaly: 'Automatic anomaly detection is not part of this score yet, so it is shown as not measured.',
  }
  const LABELS = {
    freshness: 'Data freshness', errorRate: 'Error rate',
    reachability: 'Reachability', anomaly: 'Anomaly scan',
  }
  const known = ['freshness', 'errorRate', 'reachability', 'anomaly']

  if (Array.isArray(factors)) {
    return factors.map((f, i) => {
      const key = f?.key ?? f?.name ?? `factor_${i}`
      return {
        key,
        label: f?.label ?? LABELS[key] ?? String(key),
        value: pickNum(f?.value ?? f?.score),
        hint: f?.hint ?? HINTS[key] ?? null,
      }
    })
  }
  if (factors && typeof factors === 'object') {
    return Object.keys(factors).map(k => ({
      key: k,
      label: LABELS[k] ?? k,
      value: pickNum(factors[k]?.value ?? factors[k]?.score ?? factors[k]),
      hint: HINTS[k] ?? null,
    }))
  }
  // No factors from the engine yet: show the four expected axes as N/A.
  return known.map(k => ({ key: k, label: LABELS[k], value: null, hint: HINTS[k] }))
}

function pickNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
