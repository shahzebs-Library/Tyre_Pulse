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
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { cn } from '../lib/cn'
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
    text: 'Degraded performance — some subsystems need attention',
    cls: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    Icon: AlertTriangle,
  },
  [STATUS.DOWN]: {
    text: 'Outage detected — one or more subsystems are down',
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
  if (ms == null) return '—'
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
        <span className="truncate" title={check.detail}>{check.detail || '—'}</span>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SystemHealth() {
  const { profile, loading: authLoading } = useAuth()
  const isAdmin = profile?.role === 'Admin'

  const [report, setReport]       = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [runError, setRunError]   = useState(null)
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setRunError(null)
    try {
      const next = await runAllChecks()
      if (mountedRef.current) setReport(next)
    } catch (err) {
      // runAllChecks isolates per-check failures; this only fires on a bug.
      if (mountedRef.current) setRunError(err?.message || 'Health run failed')
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (!isAdmin) return undefined
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
    }
  }, [isAdmin, refresh])

  const grouped = useMemo(() => {
    const checks = report?.checks ?? []
    return GROUPS.map((g) => ({ group: g, checks: checks.filter((c) => c.group === g.key) }))
  }, [report])

  if (authLoading) return <LoadingSkeleton />
  if (!isAdmin)    return <AccessDenied />

  const overall = report?.summary?.overall ?? STATUS.UNKNOWN
  const banner  = OVERALL_BANNER[overall] ?? OVERALL_BANNER[STATUS.UNKNOWN]
  const summary = report?.summary

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Health"
        subtitle="Live status of database, storage, edge functions and auth"
        icon={Activity}
        onRefresh={refresh}
        refreshing={refreshing}
        updatedAt={report?.checkedAt}
      />

      {runError && (
        <div className="card border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300" role="alert">
          Health run failed: {runError}
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

          {/* Grouped subsystem tiles */}
          {grouped.map(({ group, checks }) => (
            <GroupSection key={group.key} group={group} checks={checks} />
          ))}

          <p className="text-[11px] text-muted">
            Checks run automatically every 60 seconds. Edge functions are probed
            with a reachability ping only — no AI calls or emails are sent.
          </p>
        </>
      )}
    </div>
  )
}
