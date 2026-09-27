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
  Activity, ShieldAlert, CheckCircle2, Info, Database, HardDrive,
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
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, Toolbar, SearchInput, Segmented,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import {
  PageHeader as OpsPageHeader, Pager, usePaged, PAGE_SIZE, Drawer, AttentionList, ConsoleLink, useUrlTab,
} from './shared/pageKit'
import { TrendChart, BarsChart, ScoreRing, STATUS, useChartTheme } from '../components/ui/charts'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'

const REFRESH_MS = 60_000
const LOG_LIMIT = 200
const TREND_DAYS = 14

const LOG_EXPORT_COLUMNS = [
  { key: 'created_at', header: 'Time' },
  { key: 'severity', header: 'Severity' },
  { key: 'module', header: 'Module', value: r => r.module_id || r.source || 'app' },
  { key: 'message', header: 'Message' },
  { key: 'reference_id', header: 'Reference' },
  { key: 'status', header: 'Status', value: r => (r.resolved === true || r.resolved_at != null ? 'Resolved' : 'Open') },
]
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
  const [refreshedAt, setRefreshedAt] = useState(null)
  const [sampleLogs, setSampleLogs] = useState([])   // null = the broad sample could not be read
  const [drawerRow, setDrawerRow] = useState(null)
  const [tab, setTab] = useUrlTab(['errors', 'score', 'subsystems'], 'errors')

  // Filters
  const [fSeverity, setFSeverity] = useState('all')
  const [fModule, setFModule]     = useState('all')
  const [fResolved, setFResolved] = useState('open')
  const [fSince, setFSince]       = useState('7')   // days, or 'all'
  const [logQuery, setLogQuery]   = useState('')
  const { sort: logSort, onSort: onLogSort } = useTableSort({ key: 'created_at', dir: 'desc' })

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
    if (mountedRef.current) setSampleLogs(optionsRes.status === 'fulfilled' && Array.isArray(optionsRes.value) ? optionsRes.value : null)
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
    if (mountedRef.current) { setRefreshing(false); setLoading(false); setRefreshedAt(new Date().toISOString()) }
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

  // The log table shows the server page narrowed by free-text search and sorted
  // client-side; exports use exactly this view.
  const visibleLogs = useMemo(() => {
    const found = searchRows(logs, logQuery, ['message', 'module_id', 'source', 'reference_id', 'severity'])
    return sortRows(found, logSort, {
      severity: r => SEVERITIES.findIndex(x => x.key === canonSeverity(r.severity)),
      module: r => r.module_id || r.source || 'app',
      status: r => (r.resolved === true || r.resolved_at != null ? 1 : 0),
    })
  }, [logs, logQuery, logSort])

  const severityBars = useMemo(
    () => trend.totals.map(s => ({ label: s.label, value: s.total, color: s.color })),
    [trend],
  )

  // Noisiest modules across the broad (unfiltered) sample of recent logs: the
  // quickest answer to "where are the problems coming from".
  const noisyModules = useMemo(() => {
    const open = (sampleLogs || []).filter(r => !(r?.resolved === true || r?.resolved_at != null))
    const counts = new Map()
    for (const r of open) {
      const k = r?.module_id || r?.source || 'app'
      counts.set(k, (counts.get(k) || 0) + 1)
    }
    return [...counts.entries()].map(([module, count]) => ({ module, count }))
      .sort((a, b) => b.count - a.count).slice(0, 5)
  }, [sampleLogs])

  const paged = usePaged(visibleLogs, PAGE_SIZE, `${logQuery}|${fSeverity}|${fModule}|${fResolved}|${fSince}|${logSort?.key}${logSort?.dir}`)

  const unresolvedCritical = metrics?.errors ? Number(metrics.errors.unresolvedCritical) || 0 : null
  const unresolvedError = metrics?.errors ? Number(metrics.errors.unresolvedError) || 0 : null
  const unresolvedTotal = unresolvedCritical == null ? null : unresolvedCritical + (unresolvedError || 0)
  const subsystemsBad = (report?.checks ?? []).filter(c => c.status === 'down' || c.status === 'degraded')

  const attention = useMemo(() => {
    const out = []
    if (unresolvedCritical > 0) out.push({
      key: 'crit', tone: 'danger',
      text: `${unresolvedCritical} critical ${unresolvedCritical === 1 ? 'problem is' : 'problems are'} still open.`,
      action: { label: 'Show critical', onClick: () => { setFSeverity('critical'); setFResolved('open'); setTab('errors') } },
    })
    if (subsystemsBad.length) out.push({
      key: 'sub', tone: subsystemsBad.some(c => c.status === 'down') ? 'danger' : 'warning',
      text: `${subsystemsBad.length} ${subsystemsBad.length === 1 ? 'subsystem is' : 'subsystems are'} slow or down: ${subsystemsBad.slice(0, 3).map(c => c.label).join(', ')}.`,
      action: { label: 'Open subsystems', onClick: () => setTab('subsystems') },
    })
    if (lastSync && freshnessTone(lastSync) === 'danger') out.push({
      key: 'sync', tone: 'warning', text: `No new data has arrived for ${fmtRelative(lastSync).replace(' ago', '')}.`,
      action: { label: 'Daily coverage', to: '/console/import-history' },
    })
    if (metrics?.ai && Number(metrics.ai.errors) > 0) out.push({
      key: 'ai', tone: 'warning', text: `${metrics.ai.errors} AI ${Number(metrics.ai.errors) === 1 ? 'call' : 'calls'} failed recently.`,
      action: { label: 'AI usage', to: '/console/ai-usage' },
    })
    if (metrics?.reports && Number(metrics.reports.failed) > 0) out.push({
      key: 'rep', tone: 'warning', text: `${metrics.reports.failed} scheduled report ${Number(metrics.reports.failed) === 1 ? 'email' : 'emails'} failed.`,
      action: { label: 'Delivery', to: '/console/delivery' },
    })
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolvedCritical, subsystemsBad.length, lastSync, metrics])

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

  const TABS = [
    { key: 'errors', label: 'Errors', count: unresolvedTotal ?? undefined },
    { key: 'score', label: 'Health score' },
    { key: 'subsystems', label: 'Subsystems', count: report?.checks?.length || undefined },
  ]

  const drawerSev = drawerRow ? SEV_BY_KEY[canonSeverity(drawerRow.severity)] : null
  const drawerResolved = drawerRow ? (drawerRow.resolved === true || drawerRow.resolved_at != null) : false

  return (
    <div className="space-y-4 max-w-7xl">
      <OpsPageHeader
        icon={Activity}
        title="System Health"
        purpose={`Live operating status of the whole platform${report?.checkedAt ? ` | probes ran ${fmtRelative(report.checkedAt)}` : ''}`}
        refreshedAt={refreshedAt}
        onRefresh={refreshAll}
        busy={refreshing}
      />

      <ErrorState message={error} onRetry={refreshAll} />
      <ErrorState message={actionError} />

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div title="A single 0 to 100 grade for the whole platform. It blends data freshness, unresolved errors and subsystem reachability.">
          <StatTile icon={Activity} label="Health score" value={score == null ? 'N/A' : score}
            sub={score == null ? (loading ? 'Scoring...' : 'Not measured') : 'out of 100'}
            tone={scoreTone(score)} onClick={() => setTab('score')} active={tab === 'score'} />
        </div>
        <StatusTile
          icon={Server} label="Supabase"
          tip="The cloud database and backend that powers TyrePulse. Green means the app can reach and read from it."
          tone={dbCheck ? checkTone(dbCheck.status) : 'quiet'}
          value={dbCheck ? statusWord(dbCheck.status) : 'N/A'}
          sub={dbCheck?.latencyMs != null ? `${dbCheck.latencyMs} ms response` : 'Connection'}
          onClick={() => setTab('subsystems')} active={tab === 'subsystems'}
        />
        <div title="Unresolved critical and error level problems. Opens the error log filtered to open problems.">
          <StatTile icon={ShieldAlert} label="Open errors"
            value={unresolvedTotal == null ? 'N/A' : unresolvedTotal}
            sub={unresolvedCritical == null ? 'Could not be read' : `${unresolvedCritical} critical`}
            tone={unresolvedTotal == null ? 'muted' : unresolvedCritical > 0 ? 'danger' : unresolvedTotal > 0 ? 'warning' : 'good'}
            onClick={() => { setFResolved('open'); setTab('errors') }} active={tab === 'errors'} />
        </div>
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
      </div>

      {!loading && (
        <AttentionList items={attention}
          clear={error ? 'Some health readings could not be taken, so this list may be incomplete.' : 'Nothing needs attention: no open critical problems, every probed subsystem responded and data is flowing.'} />
      )}

      <Segmented options={TABS} value={tab} onChange={setTab} ariaLabel="System health views" />

      {tab === 'errors' && (
        <div className="space-y-4" role="tabpanel" aria-label="Errors">
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
              <div className="mt-4 pt-3 border-t border-gray-800">
                <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Noisiest modules (open)</p>
                {sampleLogs === null ? (
                  <p className="text-xs text-gray-500">The recent log sample could not be read.</p>
                ) : noisyModules.length === 0 ? (
                  <p className="text-xs text-gray-500">No open problems in the most recent 500 log rows.</p>
                ) : (
                  <ul className="space-y-1">
                    {noisyModules.map(m => (
                      <li key={m.module}>
                        <button type="button" onClick={() => { setFModule(m.module); setFResolved('open') }}
                          title={`Filter the log to ${m.module}`}
                          className="w-full flex items-center justify-between gap-2 text-xs rounded px-1.5 py-1 text-gray-300 hover:bg-gray-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                          <span className="truncate">{m.module}</span>
                          <span className="tabular-nums text-gray-400">{m.count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelHeader
              icon={ListChecks}
              title={<span className="inline-flex items-center">Error log
                <InfoDot text="A running list of problems the app has recorded, newest first. Resolve marks a problem as handled so it drops off the open list." />
              </span>}
              subtitle={`Newest first, up to ${LOG_LIMIT} rows for the chosen filters. Select a row for its full detail.`}
              actions={(<>
                <ExportButtons rows={visibleLogs} title="System Error Log"
                  columns={LOG_EXPORT_COLUMNS} />
                <Btn variant="primary" icon={CheckCircle2} busy={resolvingAll} disabled={logs.length === 0}
                  onClick={() => setConfirmAll(true)}
                  title="Mark every problem matching the current module and severity filters as handled">
                  Resolve all
                </Btn>
              </>)}
            />
            <Toolbar className="mb-3">
              <SearchInput value={logQuery} onChange={setLogQuery} className="w-full sm:w-64"
                placeholder="Search message, module or reference" ariaLabel="Search the error log" />
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
              <span className="text-[11px] text-gray-500 ml-auto tabular-nums">
                {visibleLogs.length === logs.length ? `${logs.length} loaded` : `${visibleLogs.length} of ${logs.length} match`}
              </span>
            </Toolbar>

            {logsError ? (
              <ErrorState message={logsError} onRetry={loadLogs} />
            ) : loading ? (
              <LoadingState label="Loading error log" />
            ) : logs.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="No problems match these filters"
                reason="Nothing was logged for this severity, module and time window. The system is quiet here." />
            ) : visibleLogs.length === 0 ? (
              <EmptyState icon={ListChecks} title="No problems match this search"
                reason="Clear or change the search text to see the loaded rows again."
                action={<Btn onClick={() => setLogQuery('')}>Clear search</Btn>} />
            ) : (
              <>
                <Table>
                  <THead>
                    <Th sortKey="created_at" sort={logSort} onSort={onLogSort}>Time</Th>
                    <Th sortKey="severity" sort={logSort} onSort={onLogSort}>Severity</Th>
                    <Th sortKey="module" sort={logSort} onSort={onLogSort}>Module</Th>
                    <Th sortKey="message" sort={logSort} onSort={onLogSort}>Message</Th>
                    <Th align="center" sortKey="status" sort={logSort} onSort={onLogSort}>Status</Th>
                    <Th align="right">Action</Th>
                  </THead>
                  <tbody>
                    {paged.slice.map(row => {
                      const sev = SEV_BY_KEY[canonSeverity(row.severity)]
                      const isResolved = row.resolved === true || row.resolved_at != null
                      return (
                        <Tr key={row.id} onClick={() => setDrawerRow(row)} ariaLabel={`Open detail for ${sev.label} problem`}>
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
                              <Btn size="xs" variant="ghost" busy={resolvingId === row.id}
                                onClick={(e) => { e.stopPropagation(); handleResolve(row.id) }}>
                                Resolve
                              </Btn>
                            )}
                          </Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
                <Pager {...paged} label="problems" />
              </>
            )}
          </Panel>
        </div>
      )}

      {tab === 'score' && (
        <div className="space-y-4" role="tabpanel" aria-label="Health score">
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
          <Note icon={Archive}>
            <span className="font-medium text-gray-300">Last backup:</span> automated database backups are managed on the Backups page. This board does not read backup runs.{' '}
            <ConsoleLink to="/console/backups" plain>Open Backups</ConsoleLink>
          </Note>
        </div>
      )}

      {tab === 'subsystems' && (
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
      )}

      <p className="text-[11px] text-gray-500">
        This board refreshes automatically when a new error is recorded, and every 60 seconds as a fallback.
        Subsystem checks are reachability pings only and never trigger AI calls or emails.
      </p>

      <Drawer
        open={!!drawerRow}
        title={drawerRow ? (drawerRow.message || 'No message') : ''}
        subtitle={drawerRow ? `${drawerSev?.label} | ${drawerRow.module_id || drawerRow.source || 'app'}` : null}
        onClose={() => setDrawerRow(null)}
        footer={drawerRow && !drawerResolved ? (
          <Btn variant="primary" icon={CheckCircle2} busy={resolvingId === drawerRow.id}
            onClick={async () => { await handleResolve(drawerRow.id); setDrawerRow(null) }}>Mark resolved</Btn>
        ) : null}
      >
        {drawerRow && (
          <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
            <dt className="text-gray-500">Status</dt>
            <dd className="col-span-2">{drawerResolved ? <Badge tone="good">Resolved</Badge> : <Badge>Open</Badge>}</dd>
            <dt className="text-gray-500">Severity</dt>
            <dd className="col-span-2"><Badge tone={drawerSev?.tone}>{drawerSev?.label}</Badge></dd>
            <dt className="text-gray-500">Logged</dt>
            <dd className="col-span-2 text-gray-300">{fmtDateTime(drawerRow.created_at)} ({fmtRelative(drawerRow.created_at)})</dd>
            {drawerRow.resolved_at && (<>
              <dt className="text-gray-500">Resolved</dt>
              <dd className="col-span-2 text-gray-300">{fmtDateTime(drawerRow.resolved_at)}</dd>
            </>)}
            <dt className="text-gray-500">Module</dt>
            <dd className="col-span-2 text-gray-300">{drawerRow.module_id || drawerRow.source || 'app'}</dd>
            <dt className="text-gray-500">Reference</dt>
            <dd className="col-span-2 font-mono text-gray-300 break-all">{drawerRow.reference_id || 'None'}</dd>
            <dt className="text-gray-500">Message</dt>
            <dd className="col-span-2 text-gray-200 whitespace-pre-wrap break-words">{drawerRow.message || 'No message'}</dd>
          </dl>
        )}
      </Drawer>

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

function StatusTile({ icon, label, tip, tone, value, sub, onClick, active }) {
  return (
    <div title={tip}>
      <StatTile icon={icon} label={label} value={value} sub={sub} tone={TILE_FROM_BADGE[tone] || 'muted'} onClick={onClick} active={active} />
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
