/**
 * AccidentCases (route /accident-cases) — Accident & Insurance module.
 *
 * The org-wide command view of the accident CASE model: every case grouped by
 * status, the workstream that stalls the most cases, how long cases take to close,
 * the SLA breach rate over open tasks, the reopen rate, and a team inbox of open
 * work sorted overdue-first. Every figure comes from the pure engine
 * src/lib/accidentCaseAnalytics.js, so this page renders and never computes.
 *
 * Distinct from /accidents (the incident owner register) and /claims-summary
 * (insurance-claim analytics). This is the multi-workstream case spine one layer
 * up. SHIP-BEFORE-MIGRATE: the case model (V417) is authored, not yet applied, so
 * when the board reports ok=false the page shows an honest "not yet activated"
 * note rather than an error.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  FolderKanban, RefreshCw, AlertTriangle, CheckCircle2, ShieldAlert,
  Timer, RotateCcw, Layers, GitBranch, Users, Gauge, ClipboardList,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { loadAccidentCaseBoard, loadAccidentCaseAnalytics } from '../lib/api/accidentCaseBoard'
import {
  buildCaseAnalytics, slaBreachRate,
} from '../lib/accidentCaseAnalytics'
import CaseTeamInbox from '../components/accidents/CaseTeamInbox'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend,
)

// ── Chart theme (matches the app's other chart.js pages) ──────────────────────
const AXIS = { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'rgba(148,163,184,0.12)' } }
const BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, titleColor: '#f8fafc', bodyColor: '#e2e8f0' },
  },
  scales: { x: AXIS, y: { ...AXIS, beginAtZero: true, ticks: { ...AXIS.ticks, precision: 0 } } },
}
const HORIZONTAL = { ...BASE, indexAxis: 'y' }
const DOUGHNUT = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: {
    legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12, padding: 12, font: { size: 11 } } },
    tooltip: BASE.plugins.tooltip,
  },
}

// ── formatting helpers ────────────────────────────────────────────────────────
const pct = (rate) => (rate == null ? 'N/A' : `${Math.round(rate * 100)}%`)
const days = (n) => (n == null ? 'N/A' : `${n} ${n === 1 ? 'day' : 'days'}`)

function KpiTile({ icon: Icon, label, value, sub, tone = 'neutral' }) {
  const TONE = {
    neutral: 'text-[var(--text-primary)]',
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    risk: 'text-red-400',
  }
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-[var(--text-muted)]">
        {Icon && <Icon size={15} className="shrink-0" />}
        <span className="text-xs">{label}</span>
      </div>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${TONE[tone] || TONE.neutral}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[var(--text-dim)]">{sub}</p>}
    </div>
  )
}

function ChartCard({ icon: Icon, title, note, empty, emptyReason, children }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={15} className="text-orange-400 shrink-0" />}
        <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
        {note && <span className="ml-auto text-[11px] text-[var(--text-dim)]">{note}</span>}
      </div>
      {empty ? (
        <p className="text-xs text-[var(--text-muted)] py-6 text-center">{emptyReason || 'Nothing to show yet.'}</p>
      ) : (
        <div className="h-56">{children}</div>
      )}
    </div>
  )
}

export default function AccidentCases() {
  const { activeCountry } = useSettings() || {}
  const [board, setBoard] = useState(null) // { cases, workstreams, inbox, ok }
  // Server-side aggregate fast path: { server:true, ... } over the FULL dataset,
  // or null when the RPCs are not provisioned (then the client path is used).
  const [server, setServer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await loadAccidentCaseBoard({ country: activeCountry })
      setBoard(data)
      // Attempt the server-side aggregates (full dataset, not just the paged
      // client rows). loadAccidentCaseAnalytics NEVER throws: it returns
      // { server:false } when the 17_REPORTING_RPCS are absent, in which case we
      // keep the client-side buildCaseAnalytics path exactly as before.
      if (data?.ok) {
        const agg = await loadAccidentCaseAnalytics({ country: activeCountry })
        setServer(agg?.server ? agg : null)
      } else {
        setServer(null)
      }
    } catch (err) {
      setError(toUserMessage(err))
      setBoard(null)
      setServer(null)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const analytics = useMemo(() => {
    if (!board?.ok) return null
    const client = buildCaseAnalytics(board.cases, board.workstreams, { now: Date.now() })
    // When the server fast path is available, PREFER its figures for the panels it
    // covers (basis KPIs, status breakdown, workstream bottleneck, time-to-close,
    // reopen) - they span the FULL dataset rather than the paged client slice.
    // openByTeam + closureLevel are not computed server-side, so the client values
    // are kept. Absent the server path, this is the unchanged client analytics.
    if (!server?.server) return client
    return {
      ...client,
      basis: { ...client.basis, ...server.basis },
      status: server.status,
      bottleneck: server.bottleneck,
      timeToClose: server.timeToClose,
      reopen: server.reopen,
    }
  }, [board, server])

  // SLA breach rate. With the server fast path it is measured over every in-scope
  // case's SLA instances (full dataset). Otherwise it is measured over the OPEN
  // tasks (they carry the due dates) - real when there is task data, honestly null
  // when there is none.
  const sla = useMemo(() => {
    if (!board?.ok) return { tracked: 0, breached: 0, rate: null }
    if (server?.server) return server.sla
    return slaBreachRate(board.inbox, { now: Date.now() })
  }, [board, server])

  const statusChart = useMemo(() => {
    const rows = analytics?.status?.rows || []
    return {
      labels: rows.map((r) => r.label),
      datasets: [{ data: rows.map((r) => r.value), backgroundColor: categorical(rows.length), borderWidth: 0 }],
    }
  }, [analytics])

  const bottleneckChart = useMemo(() => {
    const rows = analytics?.bottleneck?.rows || []
    return {
      labels: rows.map((r) => r.name),
      datasets: [{ label: 'Cases held', data: rows.map((r) => r.cases), backgroundColor: withAlpha(colorAt(3), 0.85), borderWidth: 0 }],
    }
  }, [analytics])

  const teamChart = useMemo(() => {
    const rows = analytics?.openByTeam?.rows || []
    return {
      labels: rows.map((r) => r.team),
      datasets: [{ label: 'Open cases', data: rows.map((r) => r.value), backgroundColor: withAlpha(colorAt(0), 0.85), borderWidth: 0 }],
    }
  }, [analytics])

  const closureChart = useMemo(() => {
    const rows = analytics?.closureLevel?.rows || []
    const labels = [...rows.map((r) => r.label), 'Open']
    const values = [...rows.map((r) => r.value), analytics?.closureLevel?.open ?? 0]
    return {
      labels,
      datasets: [{ data: values, backgroundColor: categorical(labels.length), borderWidth: 0 }],
    }
  }, [analytics])

  const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'

  // ── tri-state chrome ────────────────────────────────────────────────────────
  const header = (
    <PageHeader
      title="Accident Cases"
      subtitle={`Case workflow board across every workstream. ${scope}`}
      icon={FolderKanban}
      onRefresh={load}
      refreshing={loading}
    />
  )

  if (loading && !board) {
    return (
      <div className="space-y-4">
        {header}
        <div className="card p-8 text-center text-sm text-[var(--text-muted)]" aria-busy="true">
          <RefreshCw size={20} className="mx-auto mb-2 animate-spin text-[var(--text-dim)]" />
          Loading accident cases...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        {header}
        <div className="card p-6 space-y-3 text-center">
          <p className="text-sm text-red-300 flex items-center justify-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            {error}
          </p>
          <button type="button" onClick={load} className="btn-primary inline-flex items-center gap-2">
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      </div>
    )
  }

  // Not provisioned yet (pre-V417 migration): honest not-enabled state.
  if (board && board.ok === false) {
    return (
      <div className="space-y-4">
        {header}
        <div className="card p-8 space-y-2 text-center">
          <ShieldAlert size={22} className="mx-auto text-[var(--text-dim)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Accident case workflow is not yet activated
          </p>
          <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
            The multi-workstream case model has not been provisioned for this
            environment yet. Cases, team routing and closure tracking appear here
            once the accident case migration is applied.
          </p>
        </div>
      </div>
    )
  }

  const basis = analytics?.basis || { total: 0, open: 0, closed: 0, note: '' }

  // Provisioned but no cases in scope.
  if (basis.total === 0) {
    return (
      <div className="space-y-4">
        {header}
        <div className="card p-8 space-y-2 text-center">
          <CheckCircle2 size={22} className="mx-auto text-emerald-400" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">No accident cases in scope</p>
          <p className="text-xs text-[var(--text-muted)]">
            There are no case records for {scope}. New cases appear here as incidents are filed.
          </p>
        </div>
      </div>
    )
  }

  const tt = analytics.timeToClose
  const reopen = analytics.reopen
  const bottleneck = analytics.bottleneck

  return (
    <div className="space-y-4">
      {header}

      {basis.note && (
        <p className="text-[11px] text-amber-300/80 flex items-center gap-1.5">
          <AlertTriangle size={12} className="shrink-0" /> {basis.note}
        </p>
      )}

      {server?.server && (
        <p className="text-[11px] text-[var(--text-dim)] flex items-center gap-1.5">
          <Gauge size={12} className="shrink-0" /> Server-computed across the full dataset.
        </p>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiTile icon={Layers} label="Total cases" value={basis.total} />
        <KpiTile icon={FolderKanban} label="Open" value={basis.open} tone={basis.open > 0 ? 'warn' : 'good'} />
        <KpiTile icon={CheckCircle2} label="Closed" value={basis.closed} tone="good" />
        <KpiTile
          icon={Timer}
          label="Avg time to close"
          value={days(tt.avgDays)}
          sub={tt.measured ? `from ${tt.measured} of ${tt.closedTotal} closed` : 'no timed closures yet'}
        />
        <KpiTile
          icon={Gauge}
          label="SLA breach rate"
          value={pct(sla.rate)}
          sub={sla.tracked ? `${sla.breached} of ${sla.tracked} tracked` : 'no SLA-tracked tasks'}
          tone={sla.rate == null ? 'neutral' : sla.rate > 0.2 ? 'risk' : sla.rate > 0 ? 'warn' : 'good'}
        />
        <KpiTile
          icon={RotateCcw}
          label="Reopen rate"
          value={pct(reopen.rate)}
          sub={reopen.total ? `${reopen.reopened} of ${reopen.total} cases` : ''}
          tone={reopen.rate == null ? 'neutral' : reopen.rate > 0.1 ? 'warn' : 'good'}
        />
      </div>

      {/* charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          icon={ClipboardList}
          title="Cases by status"
          note={analytics.status.unrecorded ? `${analytics.status.unrecorded} unrecorded` : undefined}
          empty={analytics.status.rows.length === 0}
          emptyReason="No case statuses recorded yet."
        >
          <Doughnut data={statusChart} options={DOUGHNUT} />
        </ChartCard>

        <ChartCard
          icon={GitBranch}
          title="Workstream bottlenecks"
          note={bottleneck.measured ? `${bottleneck.stalledCases} cases stalled` : undefined}
          empty={!bottleneck.measured || bottleneck.rows.length === 0}
          emptyReason={
            bottleneck.measured
              ? 'No workstream is currently holding a case up.'
              : 'No workstream data available yet.'
          }
        >
          <Bar data={bottleneckChart} options={HORIZONTAL} />
        </ChartCard>

        <ChartCard
          icon={Users}
          title="Open cases by team"
          empty={analytics.openByTeam.rows.length === 0}
          emptyReason="No open cases to attribute to a team."
        >
          <Bar data={teamChart} options={HORIZONTAL} />
        </ChartCard>

        <ChartCard
          icon={Layers}
          title="Closure level"
          empty={basis.total === 0}
          emptyReason="No cases to break down."
        >
          <Doughnut data={closureChart} options={DOUGHNUT} />
        </ChartCard>
      </div>

      {/* team inbox — overdue-first handled inside the component */}
      <CaseTeamInbox items={board.inbox} />
    </div>
  )
}
