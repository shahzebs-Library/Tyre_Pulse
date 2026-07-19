/**
 * ConsoleSystemHealth - super-admin System Health console (Admin Control Module 1).
 *
 * A pure console page (navy + orange theme, useConsoleAuth for the admin gate;
 * no ConsoleAuthBridge needed). Surfaces one plain-English operating picture:
 *   1. TyrePulse Health Score 0 to 100 (band colour + contributing factors)
 *   2. Status cards (Supabase / last sync / last AI call / last report / backup)
 *   3. Subsystem tiles (Database / Tables / Storage / Edge / Auth) from live probes
 *   4. Error log table (filter + per row Resolve + Resolve all)
 *   5. Error trend chart (last 14 days)
 *   6. Realtime auto refresh (system_logs channel) + manual + 60s fallback
 *
 * Every technical term carries a small (i) plain-English tooltip so a
 * non-technical owner can read the board without a glossary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, RefreshCw, ShieldAlert, CheckCircle2, AlertTriangle, XCircle,
  HelpCircle, Info, Database, HardDrive, Zap, KeyRound, Table2, Server,
  Clock, Cpu, FileText, Archive,
} from 'lucide-react'
import {
  Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip as ChartTooltip,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
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

ChartJS.register(BarElement, CategoryScale, LinearScale, ChartTooltip)

const REFRESH_MS = 60_000
const LOG_LIMIT = 200

// ── Small building blocks ─────────────────────────────────────────────────────

/** Plain-English tooltip marker sitting next to a technical term. */
function InfoDot({ text }) {
  return (
    <span className="inline-flex align-middle ml-1 text-gray-600 hover:text-gray-300 cursor-help" title={text}>
      <Info size={11} />
    </span>
  )
}

/**
 * Map a health band / score to a colour family. Defensive to band being an
 * object ({ tone }) from adminHealth.HEALTH_BANDS, a plain string, or absent.
 */
function bandColor(band, score) {
  const tone = band && typeof band === 'object' ? band.tone : band
  const b = String(tone ?? '').toLowerCase()
  if (/(crit|down|red|bad|poor)/.test(b)) return 'red'
  if (/(warn|degrad|amber|yellow|fair)/.test(b)) return 'amber'
  if (/(good|ok|green|healthy|excellent)/.test(b)) return 'green'
  if (typeof score === 'number' && Number.isFinite(score)) {
    if (score >= 80) return 'green'
    if (score >= 50) return 'amber'
    return 'red'
  }
  return 'gray'
}

const COLOR_TEXT = {
  green: 'text-emerald-400', amber: 'text-amber-400', red: 'text-red-400', gray: 'text-gray-400',
}
const COLOR_DOT = {
  green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', gray: 'bg-gray-500',
}
const COLOR_RING = {
  green: 'border-emerald-500/30 bg-emerald-500/5',
  amber: 'border-amber-500/30 bg-amber-500/5',
  red: 'border-red-500/30 bg-red-500/5',
  gray: 'border-gray-700 bg-gray-900/50',
}

/** Reachability check status -> colour family (matches systemHealth STATUS). */
function checkColor(status) {
  if (status === 'ok') return 'green'
  if (status === 'degraded' || status === 'unknown') return 'amber'
  if (status === 'down') return 'red'
  return 'gray'
}

const SEVERITY_STYLE = {
  critical: 'text-red-300 bg-red-900/40 border-red-700/40',
  error: 'text-orange-300 bg-orange-900/30 border-orange-700/40',
  warning: 'text-amber-300 bg-amber-900/30 border-amber-700/40',
  warn: 'text-amber-300 bg-amber-900/30 border-amber-700/40',
  info: 'text-blue-300 bg-blue-900/30 border-blue-700/40',
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsoleSystemHealth() {
  const { admin } = useConsoleAuth()

  const [metrics, setMetrics]   = useState(null)
  const [health, setHealth]     = useState(null)   // { score, band, factors }
  const [report, setReport]     = useState(null)   // runAllChecks output
  const [logs, setLogs]         = useState([])
  const [moduleOptions, setModuleOptions] = useState([])

  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]       = useState(null)
  const [logsError, setLogsError] = useState(null)
  const [resolvingId, setResolvingId] = useState(null)
  const [resolvingAll, setResolvingAll] = useState(false)

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

  // Load metrics + health score + subsystem probes + module options.
  const loadCore = useCallback(async () => {
    setError(null)
    const [metricsRes, checksRes, optionsRes] = await Promise.allSettled([
      getHealthMetrics(),
      runAllChecks(),
      listSystemLogs({ limit: 500 }),
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

    // Compose the health score from the three real factors (anomaly detection
    // is Module 2, not built yet -> honest null).
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
    try {
      await resolveSystemLog(id)
      await loadLogs()
      await loadCore()
    } catch {
      // best effort; a failed resolve leaves the row as-is
    } finally {
      if (mountedRef.current) setResolvingId(null)
    }
  }

  async function handleResolveAll() {
    setResolvingAll(true)
    try {
      const args = {}
      if (fModule !== 'all') args.module = fModule
      if (fSeverity !== 'all') args.severity = fSeverity
      await resolveAllSystemLogs(args)
      await loadLogs()
      await loadCore()
    } catch {
      // best effort
    } finally {
      if (mountedRef.current) setResolvingAll(false)
    }
  }

  // ── Derived presentation ──
  const score = health?.score
  const band = health?.band
  const scoreColor = bandColor(band, score)
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

  const trend = useMemo(() => buildTrendData(metrics?.logsByDay), [metrics])

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16 rounded-xl border border-red-800/40 bg-red-950/20 p-8 text-center">
        <ShieldAlert size={22} className="text-red-400 mx-auto mb-3" />
        <h1 className="text-lg font-bold text-white">Restricted</h1>
        <p className="text-sm text-gray-400 mt-1">System Health is reserved for system administrators.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity size={18} className="text-orange-400" /> System Health
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Live operating status of the whole platform
            {report?.checkedAt && <span className="text-gray-600"> | checked {fmtRelative(report.checkedAt)}</span>}
          </p>
        </div>
        <button onClick={refreshAll} disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ── 1. Health score ── */}
      <div className={`rounded-2xl border p-6 ${COLOR_RING[scoreColor]}`}>
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex items-center gap-5">
            <div className="relative flex-shrink-0">
              <div className={`w-28 h-28 rounded-full border-4 flex flex-col items-center justify-center ${COLOR_RING[scoreColor]} ${scoreColor === 'gray' ? 'border-gray-700' : ''}`}
                style={{ borderColor: 'currentColor' }}>
                <span className={`text-4xl font-black leading-none ${COLOR_TEXT[scoreColor]}`}>
                  {typeof score === 'number' && Number.isFinite(score) ? Math.round(score) : 'N/A'}
                </span>
                <span className="text-[10px] text-gray-500 mt-1">out of 100</span>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500">
                TyrePulse Health Score
                <InfoDot text="A single 0 to 100 grade for the whole platform. Higher is healthier. It blends how fresh the data is, how many unresolved errors exist, and whether every subsystem is reachable." />
              </p>
              <p className={`text-2xl font-bold mt-1 ${COLOR_TEXT[scoreColor]}`}>
                {band?.label ? band.label : (typeof score === 'number' ? 'Scored' : 'Not available')}
              </p>
              <p className="text-xs text-gray-500 mt-1 max-w-xs">
                {scoreColor === 'green' && 'Everything looks healthy.'}
                {scoreColor === 'amber' && 'Some things need attention.'}
                {scoreColor === 'red' && 'Urgent problems detected.'}
                {scoreColor === 'gray' && 'Not enough data to grade yet.'}
              </p>
            </div>
          </div>

          {/* Contributing factors */}
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {factors.map(f => (
              <div key={f.key} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 flex items-center">
                  {f.label}
                  {f.hint && <InfoDot text={f.hint} />}
                </p>
                <p className={`text-lg font-bold mt-1 ${f.value == null ? 'text-gray-500' : COLOR_TEXT[bandColor(null, f.value)]}`}>
                  {f.value == null ? 'N/A' : Math.round(f.value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 2. Status cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatusCard
          icon={Server} label="Supabase"
          tip="The cloud database and backend that powers TyrePulse. Green means the app can reach and read from it."
          color={dbCheck ? checkColor(dbCheck.status) : 'gray'}
          value={dbCheck ? statusWord(dbCheck.status) : 'N/A'}
          sub={dbCheck?.latencyMs != null ? `${dbCheck.latencyMs} ms response` : 'Connection'}
        />
        <StatusCard
          icon={Clock} label="Last sync"
          tip="Sync means the newest piece of data recorded anywhere in the system. A recent time means data is flowing in."
          color={lastSync ? freshnessBadge(lastSync) : 'gray'}
          value={lastSync ? fmtRelative(lastSync) : 'N/A'}
          sub={lastSync ? fmtDateTime(lastSync) : 'No recent activity'}
        />
        <StatusCard
          icon={Cpu} label="Last AI call"
          tip="The most recent time the AI assistant was used. Helps confirm the AI features are working."
          color={lastAiCall ? freshnessBadge(lastAiCall) : 'gray'}
          value={lastAiCall ? fmtRelative(lastAiCall) : 'N/A'}
          sub={metrics?.ai ? `${metrics.ai.total ?? 0} calls, ${metrics.ai.errors ?? 0} failed` : 'No AI activity'}
        />
        <StatusCard
          icon={FileText} label="Last report"
          tip="The most recent scheduled report email that was sent to users."
          color={lastReport ? freshnessBadge(lastReport) : 'gray'}
          value={lastReport ? fmtRelative(lastReport) : 'N/A'}
          sub={metrics?.reports ? `${metrics.reports.total ?? 0} sent, ${metrics.reports.failed ?? 0} failed` : 'No reports sent'}
        />
        <StatusCard
          icon={Archive} label="Last backup"
          tip="Automated database backups. This is planned for a later module and is not configured yet."
          color="gray"
          value="Not configured yet"
          sub="Backups module pending"
        />
      </div>

      {/* ── 3. Subsystem tiles ── */}
      <section>
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center">
          Subsystems
          <InfoDot text="A subsystem is one moving part of the platform: the database, the file storage, the background functions, and the login service. Each is pinged to confirm it responds." />
        </h2>
        {grouped.length === 0 ? (
          <p className="text-xs text-gray-600">Running subsystem checks...</p>
        ) : (
          <div className="space-y-4">
            {grouped.map(g => {
              const worst = g.checks.some(c => c.status === 'down') ? 'red'
                : g.checks.some(c => c.status === 'degraded' || c.status === 'unknown') ? 'amber' : 'green'
              const Icon = g.Icon
              return (
                <div key={g.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={13} className="text-gray-500" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{g.label}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${COLOR_DOT[worst]}`} />
                    <span className="text-[10px] text-gray-600 ml-auto">
                      {g.checks.filter(c => c.status === 'ok').length}/{g.checks.length} healthy
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {g.checks.map(c => {
                      const col = checkColor(c.status)
                      return (
                        <div key={c.id} className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${COLOR_DOT[col]} ${c.status !== 'ok' ? 'animate-pulse' : ''}`} />
                            <span className="text-xs font-medium text-gray-200 truncate" title={c.label}>{c.label}</span>
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-[10px] text-gray-600 truncate" title={c.detail}>{c.detail || statusWord(c.status)}</span>
                            <span className={`text-[10px] font-medium ${COLOR_TEXT[col]}`}>
                              {c.latencyMs != null ? `${c.latencyMs} ms` : ''}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── 5. Error trend chart ── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center">
          Error trend
          <InfoDot text="How many errors were logged each day over the last two weeks. A rising bar chart means problems are increasing." />
          <span className="text-[10px] text-gray-600 ml-2 font-normal">last 14 days</span>
        </h3>
        {trend.total === 0 ? (
          <p className="text-xs text-gray-600 py-6 text-center">No errors logged in the last 14 days. The system is quiet.</p>
        ) : (
          <div style={{ height: 200 }}>
            <Bar data={trend.data} options={trend.options} />
          </div>
        )}
      </div>

      {/* ── 4. Error log table ── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white flex items-center">
            Error log
            <InfoDot text="A running list of problems the app has recorded, newest first. Resolve marks a problem as handled so it drops off the open list." />
          </h3>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <FilterSelect value={fSeverity} onChange={setFSeverity} title="Severity: how serious the problem is"
              options={[['all', 'All severities'], ['critical', 'Critical'], ['error', 'Error'], ['warning', 'Warning'], ['info', 'Info']]} />
            <FilterSelect value={fModule} onChange={setFModule} title="Module: which part of the app the problem came from"
              options={[['all', 'All modules'], ...moduleOptions.map(m => [m, m])]} />
            <FilterSelect value={fResolved} onChange={setFResolved} title="Show open (unhandled) or resolved (handled) problems"
              options={[['open', 'Open only'], ['resolved', 'Resolved only'], ['all', 'All']]} />
            <FilterSelect value={fSince} onChange={setFSince} title="Time window to look back over"
              options={[['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days'], ['all', 'All time']]} />
            <button onClick={handleResolveAll} disabled={resolvingAll || logs.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-orange-600/20 text-orange-300 hover:bg-orange-600/30 text-xs border border-orange-700/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Mark every problem matching the current module and severity filters as handled">
              {resolvingAll ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Resolve all
            </button>
          </div>
        </div>

        {logsError ? (
          <div className="p-6 text-center">
            <p className="text-sm text-red-300 mb-2">{logsError}</p>
            <button onClick={loadLogs} className="text-xs text-orange-400 hover:text-orange-300">Try again</button>
          </div>
        ) : loading ? (
          <p className="p-6 text-xs text-gray-600 text-center">Loading error log...</p>
        ) : logs.length === 0 ? (
          <p className="p-8 text-sm text-gray-500 text-center">No errors logged - the system is quiet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="px-4 py-2 font-semibold">Time</th>
                  <th className="px-4 py-2 font-semibold">Severity</th>
                  <th className="px-4 py-2 font-semibold">Module</th>
                  <th className="px-4 py-2 font-semibold">Message</th>
                  <th className="px-4 py-2 font-semibold text-center">Status</th>
                  <th className="px-4 py-2 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(row => {
                  const sev = String(row.severity ?? 'info').toLowerCase()
                  const sevStyle = SEVERITY_STYLE[sev] ?? SEVERITY_STYLE.info
                  const isResolved = row.resolved === true || row.resolved_at != null
                  return (
                    <tr key={row.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                      <td className="px-4 py-2.5 text-[11px] text-gray-500 whitespace-nowrap" title={fmtDateTime(row.created_at)}>
                        {fmtRelative(row.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold capitalize ${sevStyle}`}>{sev}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">{row.module_id || row.source || 'app'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-300 max-w-md">
                        <span className="line-clamp-2" title={row.message || ''}>{row.message || '(no message)'}</span>
                        {row.reference_id && <span className="block text-[10px] text-gray-600 font-mono mt-0.5">{row.reference_id}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isResolved
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300 border border-emerald-700/40">Resolved</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">Open</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {!isResolved && (
                          <button onClick={() => handleResolve(row.id)} disabled={resolvingId === row.id}
                            className="text-[11px] text-orange-400 hover:text-orange-300 disabled:opacity-40">
                            {resolvingId === row.id ? 'Resolving...' : 'Resolve'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-600">
        This board refreshes automatically when a new error is recorded, and every 60 seconds as a fallback.
        Subsystem checks are reachability pings only and never trigger AI calls or emails.
      </p>
    </div>
  )
}

// ── Sub components + helpers ───────────────────────────────────────────────────

function StatusCard({ icon: Icon, label, tip, color, value, sub }) {
  return (
    <div className={`rounded-xl border p-4 ${COLOR_RING[color] ?? COLOR_RING.gray}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} className="text-gray-400" />
        <span className={`w-2 h-2 rounded-full ${COLOR_DOT[color] ?? COLOR_DOT.gray}`} />
      </div>
      <p className={`text-sm font-bold ${COLOR_TEXT[color] ?? COLOR_TEXT.gray}`}>{value}</p>
      <p className="text-[11px] font-semibold text-gray-300 mt-0.5 flex items-center">
        {label}<InfoDot text={tip} />
      </p>
      {sub && <p className="text-[10px] text-gray-600 mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  )
}

function FilterSelect({ value, onChange, options, title }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} title={title}
      className="px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:border-gray-600 focus:outline-none focus:border-orange-600">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

function statusWord(status) {
  if (status === 'ok') return 'Operational'
  if (status === 'degraded') return 'Slow'
  if (status === 'down') return 'Down'
  return 'Unknown'
}

/** A freshness colour just from a timestamp: recent green, stale amber, old red. */
function freshnessBadge(iso) {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'gray'
  const hrs = (Date.now() - t) / 3600000
  if (hrs <= 24) return 'green'
  if (hrs <= 24 * 7) return 'amber'
  return 'red'
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
    anomaly: 'Automatic anomaly detection. Planned for a later module, so shown as not available.',
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

/** Build a 14-day bar chart dataset from logsByDay [{day,count}]. */
function buildTrendData(logsByDay) {
  const rows = Array.isArray(logsByDay) ? logsByDay.slice(-14) : []
  const total = rows.reduce((s, r) => s + (Number(r?.count) || 0), 0)
  const labels = rows.map(r => String(r?.day ?? '').slice(5))
  const values = rows.map(r => Number(r?.count) || 0)
  return {
    total,
    data: {
      labels,
      datasets: [{
        label: 'Errors',
        data: values,
        backgroundColor: 'rgba(249,115,22,0.55)',
        borderColor: 'rgba(249,115,22,0.9)',
        borderWidth: 1,
        borderRadius: 4,
        maxBarThickness: 26,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { size: 10 } } },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(148,163,184,0.12)' },
          ticks: { color: '#9ca3af', font: { size: 10 }, precision: 0 },
        },
      },
    },
  }
}
