/**
 * OpsIntelligence (route /ops-intelligence) — the Operations Intelligence Center.
 *
 * Two layers, both driven entirely by REAL data (no mock rows):
 *  1. Fleet Health Pulse (restored from tyre_saas): a fleet-wide health score,
 *     a live Pulse KPI grid, a severity-sorted anomaly feed, a partial-but-honest
 *     financial panel and an executive headline strip.
 *  2. Exception Command Center: the existing cross-cutting scan of tyre_records +
 *     work_orders, surfacing every issue that needs action now, ranked by severity.
 *
 * All intelligence is derived by the pure, unit-tested `src/lib/opsIntelligence.js`.
 * Where a source signal is absent in this schema (no alerts table, no axle /
 * retread / TPMS data, no retread-savings / claims / emergency-premium columns),
 * the UI says so honestly instead of fabricating a number. The heavy read lives
 * behind `src/lib/api/opsIntelligence.js`; absent optional tables degrade to
 * empty. Auto-refreshes every 30s (cleared on unmount) with a manual refresh too.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Siren, Activity, HeartPulse, Gauge, AlertTriangle, AlertOctagon, ShieldAlert,
  Info, Search, X, Filter, FileSpreadsheet, FileText, ArrowUpRight, CheckCircle2,
  Building2, Layers, TrendingUp, DollarSign, Truck, Wrench, ClipboardCheck, Zap,
  Package, Boxes, Wind, CalendarClock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmailPdfButton from '../components/EmailPdfButton'
import { useSettings } from '../contexts/SettingsContext'
import { loadOpsData } from '../lib/api/opsIntelligence'
import { loadPmDashboard } from '../lib/api/pmPrograms'
import { summarizePmCompliance } from '../lib/pmSchedule'
import {
  buildExceptions, summarizeExceptions, buildFleetPulse, buildAnomalyFeed,
  buildFinancials, buildExecutiveSummary,
  SEVERITY_META, CATEGORY_META, CATEGORIES,
} from '../lib/opsIntelligence'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const REFRESH_MS = 30000

// ── Severity styling (dark-card palette, WCAG-safe) ─────────────────────────────
const SEVERITY_STYLES = {
  high: 'bg-red-900/40 text-red-300 border border-red-700/50',
  medium: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  low: 'bg-slate-800/60 text-slate-300 border border-slate-600/50',
}
const SEVERITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#64748b' }
const CATEGORY_COLOR = {
  aged_tyre: '#ef4444',
  low_tread: '#f97316',
  high_cpk: '#8b5cf6',
  recent_failure: '#ec4899',
  open_work_order: '#3b82f6',
}

// Health status → colour tokens.
const HEALTH_TONE = {
  critical: { ring: '#ef4444', text: 'text-red-400', label: 'Critical' },
  warning: { ring: '#f59e0b', text: 'text-amber-400', label: 'Warning' },
  good: { ring: '#22c55e', text: 'text-green-400', label: 'Healthy' },
}
const RISK_TONE = { high: 'text-red-400', medium: 'text-amber-400', low: 'text-green-400' }
const BUDGET_TONE = {
  critical: { bar: 'bg-red-500', text: 'text-red-400' },
  warning: { bar: 'bg-amber-500', text: 'text-amber-400' },
  on_track: { bar: 'bg-green-500', text: 'text-green-400' },
  unknown: { bar: 'bg-slate-500', text: 'text-[var(--text-muted)]' },
}
const ANOMALY_LABEL = {
  low_pressure: 'Low pressure',
  pressure_imbalance: 'Pressure imbalance',
  cost_outlier: 'Cost outlier',
  inspection_gap: 'Inspection gap',
  pm_overdue: 'PM overdue',
  pm_due_soon: 'PM due soon',
}

const fmtMoney = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }))

export default function OpsIntelligence() {
  const { activeCountry, activeCurrency } = useSettings()
  const navigate = useNavigate()
  const currency = activeCurrency || 'SAR'

  const [data, setData] = useState(null) // { tyres, workOrders, inspections, budgets, activeVehicles } | null
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const timerRef = useRef(null)

  const [severityFilter, setSeverityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  // Preventive-maintenance signal — loaded INDEPENDENTLY of the ops scan so a
  // missing pm_programs table never affects the rest of the page. Tri-state:
  // null = loading, an object = loaded (plans may be empty), and a load failure
  // degrades to an empty bundle (honest: nothing extra surfaces when no plans).
  const [pmData, setPmData] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const res = await loadOpsData({ country: activeCountry })
      setData(res)
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load fleet data.'))
      setData({ tyres: [], workOrders: [], inspections: [], budgets: [], activeVehicles: null })
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // 30s auto-refresh — interval cleared on unmount / country change.
  useEffect(() => {
    timerRef.current = setInterval(() => { load() }, REFRESH_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [load])

  // Independent PM load with a cancel guard so a country switch / unmount cannot
  // land a stale result. Never throws to the page (empty bundle on failure).
  useEffect(() => {
    let cancelled = false
    setPmData(null)
    loadPmDashboard({ country: activeCountry })
      .then((res) => { if (!cancelled) setPmData(res) })
      .catch(() => { if (!cancelled) setPmData({ plans: [], kmByAsset: {}, hoursByAsset: {} }) })
    return () => { cancelled = true }
  }, [activeCountry])

  // ── Derived intelligence (pure lib, live clock) ─────────────────────────────
  const exceptions = useMemo(() => (data ? buildExceptions(data, { now }) : []), [data, now])
  const summary = useMemo(() => summarizeExceptions(exceptions), [exceptions])

  const pulse = useMemo(() => (data ? buildFleetPulse(data, { now }) : null), [data, now])
  const anomalies = useMemo(() => (data ? buildAnomalyFeed(data, { now }) : []), [data, now])
  const financials = useMemo(() => (data ? buildFinancials(data, { now }) : null), [data, now])
  const executive = useMemo(
    () => (pulse ? buildExecutiveSummary({ pulse, anomalies, financials }, { currency }) : null),
    [pulse, anomalies, financials, currency],
  )

  // ── Preventive-maintenance compliance (independent, pure engine) ────────────
  const pmCompliance = useMemo(
    () => (pmData
      ? summarizePmCompliance(pmData.plans, { now, kmByAsset: pmData.kmByAsset, hoursByAsset: pmData.hoursByAsset })
      : null),
    [pmData, now],
  )

  // PM-derived attention items, shaped like the anomaly feed rows and linked to
  // the PM Programs module. Only emitted when plans are actually overdue / due
  // soon, so a fleet with no PM plans shows nothing extra (honest empty state).
  const pmAnomalies = useMemo(() => {
    if (!pmCompliance) return []
    const items = []
    if (pmCompliance.overdue > 0) {
      items.push({
        type: 'pm_overdue',
        severity: 'critical',
        title: `${pmCompliance.overdue} preventive maintenance ${pmCompliance.overdue === 1 ? 'plan' : 'plans'} overdue`,
        detail: 'Overdue preventive maintenance raises breakdown and safety risk. Review and schedule service now.',
        action: 'Open PM Programs',
        link: '/pm-programs',
      })
    }
    if (pmCompliance.dueSoon > 0) {
      items.push({
        type: 'pm_due_soon',
        severity: 'warning',
        title: `${pmCompliance.dueSoon} preventive maintenance ${pmCompliance.dueSoon === 1 ? 'plan' : 'plans'} due soon`,
        detail: 'These plans reach their service window shortly. Plan workshop capacity ahead of time.',
        action: 'Open PM Programs',
        link: '/pm-programs',
      })
    }
    return items
  }, [pmCompliance])

  // Rendered feed = PM attention items first, then the tyre / pressure / cost /
  // inspection anomalies. `anomalies` stays untouched for the executive strip.
  const feedItems = useMemo(() => [...pmAnomalies, ...anomalies], [pmAnomalies, anomalies])
  const feedTotal = feedItems.length
  const feedCritical = useMemo(() => feedItems.filter((a) => a.severity === 'critical').length, [feedItems])

  const siteOptions = useMemo(
    () => [...new Set(exceptions.map((e) => e.site).filter(Boolean))].sort(),
    [exceptions],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return exceptions.filter((e) => {
      if (severityFilter !== 'all' && e.severity !== severityFilter) return false
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false
      if (siteFilter && e.site !== siteFilter) return false
      if (q) {
        const hay = `${e.title} ${e.asset_no || ''} ${e.serial || ''} ${e.site || ''} ${e.detail}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [exceptions, severityFilter, categoryFilter, siteFilter, search])

  // ── Charts ────────────────────────────────────────────────────────────────
  const chartText = typeof document !== 'undefined'
    ? (getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af')
    : '#9ca3af'

  const severityData = {
    labels: ['High', 'Medium', 'Low'],
    datasets: [{
      data: [summary.bySeverity.high, summary.bySeverity.medium, summary.bySeverity.low],
      backgroundColor: [SEVERITY_COLOR.high, SEVERITY_COLOR.medium, SEVERITY_COLOR.low],
      borderWidth: 0,
    }],
  }
  const activeCats = CATEGORIES.filter((c) => summary.byCategory[c] > 0)
  const categoryData = {
    labels: activeCats.map((c) => CATEGORY_META[c].label),
    datasets: [{
      label: 'Exceptions',
      data: activeCats.map((c) => summary.byCategory[c]),
      backgroundColor: activeCats.map((c) => CATEGORY_COLOR[c]),
      borderRadius: 4,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: chartText, precision: 0 }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
      y: { ticks: { color: chartText }, grid: { display: false } },
    },
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['severity', 'category', 'title', 'asset_no', 'serial', 'site', 'detail']
  const EXPORT_HEADERS = ['Severity', 'Category', 'Title', 'Asset', 'Serial', 'Site', 'Detail']
  const exportRows = filtered.map((e) => ({
    severity: SEVERITY_META[e.severity]?.label || e.severity,
    category: CATEGORY_META[e.category]?.label || e.category,
    title: e.title,
    asset_no: e.asset_no || '',
    serial: e.serial || '',
    site: e.site || '',
    detail: e.detail,
  }))

  const clearFilters = () => { setSeverityFilter('all'); setCategoryFilter('all'); setSiteFilter(''); setSearch('') }
  const hasFilters = severityFilter !== 'all' || categoryFilter !== 'all' || siteFilter || search
  const loading = data === null

  const tone = HEALTH_TONE[pulse?.status] || HEALTH_TONE.good
  const c = pulse?.counts || {}
  const budgetTone = BUDGET_TONE[financials?.budgetStatus] || BUDGET_TONE.unknown

  const pulseKpis = [
    { label: 'Active vehicles', value: c.activeVehicles, icon: Truck, tone: 'text-blue-400' },
    { label: 'Installed tyres', value: c.installed, icon: Boxes, tone: 'text-[var(--text-primary)]' },
    { label: 'In stock', value: c.inStock, icon: Package, tone: 'text-[var(--text-primary)]' },
    { label: 'Low pressure', value: c.lowPressure, icon: Wind, tone: c.lowPressure > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Low tread', value: c.lowTread, icon: Gauge, tone: c.lowTread > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Overdue inspection', value: c.overdueInspection, icon: ClipboardCheck, tone: c.overdueInspection > 0 ? 'text-amber-400' : 'text-green-400' },
    { label: 'Urgent WOs', value: c.urgentWorkOrders, icon: Zap, tone: c.urgentWorkOrders > 0 ? 'text-amber-400' : 'text-green-400' },
    { label: 'Open WOs', value: c.openWorkOrders, icon: Wrench, tone: 'text-[var(--text-primary)]' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ops Intelligence"
        subtitle="Operations Intelligence Center — a live Fleet Health Pulse, anomaly feed, financial view and executive strip, above a cross-cutting exception scan of every tyre and work-order issue that needs action now."
        icon={Activity}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] px-2.5 py-1 rounded-lg bg-gray-800/40 border border-white/5">
              <Activity size={12} className="opacity-70" /> Auto-refresh 30s
            </span>
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'ops_intelligence_exceptions')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Ops Intelligence — Exception Command Center', 'ops_intelligence_exceptions', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <EmailPdfButton
              disabled={!filtered.length}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              getPdf={async () => ({
                base64: await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Ops Intelligence — Exception Command Center', 'ops_intelligence_exceptions', 'landscape', '', { returnBase64: true }),
                filename: 'ops_intelligence_exceptions.pdf',
                subject: 'Ops Intelligence',
                bodyHtml: '<p>Attached is the Ops Intelligence report.</p>',
              })}
            />
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load fleet data.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* ── Fleet Health Pulse hero ─────────────────────────────────────────── */}
      <div className="card">
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          {/* Score ring */}
          <div className="flex items-center gap-4 shrink-0">
            <ScoreRing score={pulse?.score} color={tone.ring} loading={loading} />
            <div>
              <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <HeartPulse size={13} className={tone.text} /> Fleet Health
              </p>
              <p className={`text-4xl font-bold leading-tight ${tone.text}`}>
                {loading || pulse == null ? '—' : pulse.score}
                <span className="text-lg text-[var(--text-muted)] font-medium">/100</span>
              </p>
              <span className={`inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded ${SEVERITY_STYLES[pulse?.status === 'critical' ? 'high' : pulse?.status === 'warning' ? 'medium' : 'low']}`}>
                {tone.label}
              </span>
            </div>
          </div>

          {/* Banner + compliance */}
          <div className="flex-1 min-w-0 space-y-3">
            {pulse?.requiresImmediateAction && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/30 border border-red-700/50">
                <AlertOctagon size={18} className="text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm font-semibold text-red-300">
                  Immediate action required — high-severity exceptions or unsafe tread detected.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat label="High-severity" value={pulse?.openCritical} tone={pulse?.openCritical > 0 ? 'text-red-400' : 'text-green-400'} loading={loading} />
              <MiniStat label="Low pressure" value={c.lowPressure} tone={c.lowPressure > 0 ? 'text-red-400' : 'text-green-400'} loading={loading} />
              <MiniStat label="Low tread" value={c.lowTread} tone={c.lowTread > 0 ? 'text-red-400' : 'text-green-400'} loading={loading} />
              <MiniStat label="Compliance risk" value={pulse ? (pulse.complianceRisk || 'low') : null} tone={RISK_TONE[pulse?.complianceRisk] || 'text-green-400'} loading={loading} capitalize />
            </div>
            <p className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" />
              No standalone alerts table in this schema — the critical-risk term uses the count of HIGH-severity exceptions from the scan below.
            </p>
            {pmCompliance && pmCompliance.active > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--input-bg)]/50 border border-[var(--input-border)]">
                <CalendarClock size={18} className={`shrink-0 ${pmCompliance.overdue > 0 ? 'text-red-400' : pmCompliance.dueSoon > 0 ? 'text-amber-400' : 'text-green-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">Preventive maintenance</p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {pmCompliance.compliantPct == null ? 'No active plans' : `${pmCompliance.compliantPct}% compliant`}
                    {' | '}{pmCompliance.overdue} overdue{' | '}{pmCompliance.dueSoon} due soon{' | '}{pmCompliance.active} active
                  </p>
                </div>
                <button
                  onClick={() => navigate('/pm-programs')}
                  className="btn-secondary text-xs inline-flex items-center gap-1 px-2.5 py-1 shrink-0"
                  title="Open PM Programs"
                >
                  Open <ArrowUpRight size={13} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Pulse KPI grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {pulseKpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card !p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-[var(--text-muted)] leading-tight">{k.label}</p>
                <Icon size={14} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>
                {loading ? '—' : (k.value == null ? '—' : k.value)}
              </p>
            </div>
          )
        })}
      </div>

      {/* ── Anomaly feed + Financial panel ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Anomaly feed */}
        <div className="card !p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <Activity size={15} className="text-amber-400" /> Anomaly feed
            </h3>
            <div className="flex items-center gap-2">
              {feedCritical > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/50">{feedCritical} critical</span>
              )}
              <span className="text-[11px] text-[var(--text-muted)]">{feedTotal} total</span>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-[var(--input-border)]/60">
            {loading ? (
              [0, 1, 2].map((i) => <div key={i} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></div>)
            ) : feedItems.length === 0 ? (
              <div className="px-4 py-12 text-center text-[var(--text-muted)] text-sm">
                <CheckCircle2 size={24} className="mx-auto mb-2 text-green-400 opacity-80" />
                No anomalies detected — pressure, cost, inspection cadence and preventive maintenance all within range.
              </div>
            ) : (
              feedItems.slice(0, 40).map((a, i) => (
                <div
                  key={`${a.type}:${a.asset_no || a.serial || i}`}
                  className={`px-4 py-3 ${a.severity === 'critical' ? 'bg-red-900/15' : ''} ${a.link ? 'cursor-pointer hover:bg-[var(--input-bg)]/40' : ''}`}
                  onClick={a.link ? () => navigate(a.link) : undefined}
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={15} className={`mt-0.5 shrink-0 ${a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{a.title}</p>
                        <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] shrink-0">{ANOMALY_LABEL[a.type] || a.type}</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{a.detail}</p>
                      {a.action && <p className="text-xs text-blue-400 mt-0.5">→ {a.action}</p>}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <p className="px-4 py-2 text-[11px] text-[var(--text-muted)] border-t border-[var(--input-border)] flex items-start gap-1.5">
            <Info size={12} className="mt-0.5 shrink-0" />
            Retread-on-front, tread-leak and telemetry-gap detectors require axle / retread / TPMS data not captured in this schema.
          </p>
        </div>

        {/* Financial panel */}
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <DollarSign size={15} className="text-green-400" /> Financial intelligence
            {financials && <span className="ml-auto text-[11px] text-[var(--text-muted)] font-normal">FY {financials.year}</span>}
          </h3>
          {loading || !financials ? (
            <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-6 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : (
            <div className="space-y-3">
              {/* Budget consumption bar */}
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-[var(--text-secondary)] font-medium">Budget consumption (tyre spend)</span>
                  <span className={`font-bold ${budgetTone.text}`}>
                    {financials.budgetConsumptionPct == null ? 'No budget set' : `${financials.budgetConsumptionPct}%`}
                  </span>
                </div>
                <div className="h-2.5 bg-[var(--input-bg)] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${budgetTone.bar}`} style={{ width: `${Math.min(financials.budgetConsumptionPct || 0, 100)}%` }} />
                </div>
              </div>
              {[
                ['YTD tyre spend', `${currency} ${fmtMoney(financials.ytdTyreSpend)}`],
                ['Annual budget', financials.annualBudget > 0 ? `${currency} ${fmtMoney(financials.annualBudget)}` : 'Not set'],
                ['Remaining', financials.remainingBudget == null ? '—' : `${currency} ${fmtMoney(financials.remainingBudget)}`],
                ['Avg CPK', financials.avgCpk != null ? `${currency} ${financials.avgCpk}/km` : '—', financials.avgCpk != null ? (financials.cpkmStatus === 'good' ? 'text-green-400' : financials.cpkmStatus === 'average' ? 'text-amber-400' : 'text-red-400') : ''],
                ['CPK data points', financials.cpkDataPoints],
              ].map(([l, v, t]) => (
                <div key={l} className="flex justify-between text-sm py-1.5 border-b border-[var(--input-border)]/60 last:border-0">
                  <span className="text-[var(--text-muted)]">{l}</span>
                  <span className={`font-semibold ${t || 'text-[var(--text-primary)]'}`}>{v}</span>
                </div>
              ))}
              <div className="pt-1 space-y-1.5">
                {['Retread savings', 'Claim recoveries', 'Emergency premium'].map((l) => (
                  <div key={l} className="flex justify-between text-xs">
                    <span className="text-[var(--text-muted)]">{l}</span>
                    <span className="text-[var(--text-muted)] italic">Not captured</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5 pt-1">
                <Info size={12} className="mt-0.5 shrink-0" />
                Retread savings, claim recoveries and emergency-purchase premium have no source column in this schema and are not fabricated.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Executive summary strip ─────────────────────────────────────────── */}
      {executive && !loading && (
        <div className="card border border-[var(--input-border)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <TrendingUp size={15} className="text-blue-400" /> Executive summary
            </h3>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${SEVERITY_STYLES[executive.fleetHealthStatus === 'critical' ? 'high' : executive.fleetHealthStatus === 'warning' ? 'medium' : 'low']}`}>
              Health {executive.fleetHealthScore ?? '—'}/100
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {[
              ['Safety', executive.headlines.safety, ShieldAlert, 'text-red-400'],
              ['Operations', executive.headlines.operations, Wrench, 'text-amber-400'],
              ['Financial', executive.headlines.financial, DollarSign, 'text-green-400'],
              ['CPK', executive.headlines.cpk, Gauge, 'text-blue-400'],
            ].map(([l, v, Icon, iconTone]) => (
              <div key={l} className="rounded-lg bg-[var(--input-bg)]/50 border border-[var(--input-border)] p-3">
                <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                  <Icon size={12} className={iconTone} /> {l}
                </p>
                <p className="text-sm font-medium text-[var(--text-secondary)] mt-1">{v}</p>
              </div>
            ))}
          </div>
          {executive.actionRequired && (
            <div className="mt-3 p-3 rounded-lg bg-red-900/25 border border-red-700/50">
              <p className="text-sm font-semibold text-red-300 flex items-center gap-1.5">
                <AlertOctagon size={15} /> Action required — review critical issues immediately.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Exception Command Center (existing) ─────────────────────────────── */}
      <div className="flex items-center gap-2 pt-2">
        <Siren size={18} className="text-red-400" />
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Exception Command Center</h2>
        <span className="text-xs text-[var(--text-muted)]">{summary.total} open</span>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Open exceptions', value: summary.total, icon: Siren, tone: 'text-[var(--text-primary)]' },
          { label: 'High severity', value: summary.bySeverity.high, icon: AlertOctagon, tone: 'text-red-400' },
          { label: 'Medium severity', value: summary.bySeverity.medium, icon: AlertTriangle, tone: 'text-amber-400' },
          { label: 'Assets affected', value: summary.affectedAssets, icon: Building2, tone: 'text-blue-400' },
        ].map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{loading ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><ShieldAlert size={15} className="text-red-400" /> By severity</h3>
          <div className="h-64">{!loading && summary.total ? <Doughnut data={severityData} options={donutOpts} /> : <EmptyChart loading={loading} empty="No open exceptions." />}</div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Layers size={15} className="text-blue-400" /> By category</h3>
          <div className="h-64">{!loading && activeCats.length ? <Bar data={categoryData} options={barOpts} /> : <EmptyChart loading={loading} empty="No open exceptions." />}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search title, asset, serial, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="all">All severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {CATEGORIES.map((cat) => <option key={cat} value={cat}>{CATEGORY_META[cat].label}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Severity', 'Category', 'Exception', 'Asset', 'Site', 'Detail', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[var(--text-muted)]">
                  {summary.total === 0 ? (
                    <><CheckCircle2 size={26} className="mx-auto mb-2 text-green-400 opacity-80" />All clear — no open exceptions across the fleet.</>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No exceptions match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((e) => (
                  <tr key={e.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${SEVERITY_STYLES[e.severity]}`}>{SEVERITY_META[e.severity]?.label}</span></td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CATEGORY_COLOR[e.category] }} />
                        {CATEGORY_META[e.category]?.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium max-w-[260px] truncate" title={e.title}>{e.title}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{e.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{e.site || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs max-w-[340px]">{e.detail}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right">
                      <button onClick={() => navigate(e.link)} className="btn-secondary text-xs inline-flex items-center gap-1 px-2.5 py-1" title={`Open in ${CATEGORY_META[e.category]?.module}`}>
                        Open <ArrowUpRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)] flex items-center gap-1.5"><Info size={12} /> Showing first 500 — refine filters or export for the full set.</p>}
      </div>
    </div>
  )
}

// ── Presentational helpers ────────────────────────────────────────────────────
function ScoreRing({ score, color, loading }) {
  const pct = loading || score == null ? 0 : Math.max(0, Math.min(100, score))
  const r = 34
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div className="relative w-[84px] h-[84px] shrink-0">
      <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="7" />
        <circle
          cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold" style={{ color }}>{loading || score == null ? '—' : score}</span>
      </div>
    </div>
  )
}

function MiniStat({ label, value, tone, loading, capitalize }) {
  return (
    <div className="rounded-lg bg-[var(--input-bg)]/50 border border-[var(--input-border)] px-3 py-2">
      <p className="text-[11px] text-[var(--text-muted)] leading-tight">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${tone} ${capitalize ? 'capitalize' : ''}`}>
        {loading ? '—' : (value == null ? '—' : value)}
      </p>
    </div>
  )
}

function EmptyChart({ loading, empty = 'No data.' }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
      {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : empty}
    </div>
  )
}
