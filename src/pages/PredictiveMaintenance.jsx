import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { formatDate, formatMonthYear } from '../lib/formatters'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import {
  CalendarClock, Download, FileText, AlertTriangle, CheckCircle,
  Clock, TrendingUp, DollarSign, Truck, ChevronDown, ChevronUp,
  Info, Filter, ShieldAlert, Activity, Gauge, Sigma, Percent, Target,
  TrendingDown, Search, X, Wrench, CalendarCheck, Coins, RefreshCw,
} from 'lucide-react'
import { PageHero, Kpi, Tabs } from '../components/commandCenter/kit'
import {
  RiskScoredAssets, MaintenanceForecast, DueSoon, TyreHealthTrend, RiskDistribution,
  FailureTypes, Recommendations,
} from '../components/predictive/PredictiveOverview'
import {
  buildAssetRisk, riskDistribution, overviewKpis, maintenanceForecast, dueSoon,
  removalTrend, failureTypes, buildRecommendations, PREDICTED_FAILURE_DAYS, DUE_SOON_DAYS,
} from '../lib/predictiveOverview'
import { listPmPrograms } from '../lib/api/pmPrograms'
import { listOpenJobAssets } from '../lib/api/predictiveOverview'
import { createJob } from '../lib/api/workshopLive'
import { useAuth } from '../contexts/AuthContext'
import './PredictiveMaintenance.css'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import Modal from '../components/ui/Modal'
import {
  buildPredictions, buildFailureRiskRows, buildCohortModels, computeFleetStats,
  LEGAL_MIN_TREAD_MM, REPLACE_TARGET_MM, PRESSURE_TARGET_PSI, MAX_AGE_YEARS,
  DEFAULT_NEW_TREAD_MM, LIMITING_FACTORS,
} from '../lib/predictiveMaintenance'
import {
  HORIZONS, forecastBase as buildForecastBase, filterPredictions, filterRisk,
  forecastKpis, buildMonthlyBudget, quarterlyForecast, buildSiteBreakdown,
  urgentVehicles as buildUrgentVehicles, riskKpis as buildRiskKpis, cohortRows as buildCohortRows,
  monthlyFleetBudget, uniqueSorted, URGENT_DAYS, SOON_DAYS,
} from '../lib/predictiveMaintenanceAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ──────────────────────────────────────────────────────────────────
// Engine constants live in the pure libs (src/lib/predictiveMaintenance.js and
// src/lib/predictiveMaintenanceAnalytics.js); the page keeps presentation only.
const URGENT_TREAD_MM = REPLACE_TARGET_MM
const SOON_TREAD_MM = 5

// Theme tokens: chartVarPlugin resolves var(--*) per theme at draw time, so the
// same options read on the dark app and on html.light.
const CHART_TEXT = 'var(--text-muted)'
const CHART_GRID = 'var(--panel-2)'

// Semantic status colours (the colour carries meaning, so it stays fixed).
const SEM = { red: '#ef4444', orange: '#f97316', amber: '#f59e0b', green: '#10b981' }

const LIMITING_FACTOR_LABEL = {
  [LIMITING_FACTORS.tread]: 'Tread wear',
  [LIMITING_FACTORS.km]: 'KM lifecycle',
  [LIMITING_FACTORS.age]: 'Age (5yr)',
}

const RISK_BAND_STYLE = {
  extreme:  'bg-red-900/40 text-red-300 border-red-800/50',
  high:     'bg-orange-900/40 text-orange-300 border-orange-800/50',
  elevated: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  low:      'bg-green-900/20 text-green-400 border-green-800/40',
  unknown:  'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

const SELECT_CLS = 'min-h-[44px] bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
const BTN_CLS = 'btn-secondary inline-flex items-center gap-2 text-xs px-3 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

// ── Formatting helpers (N/A for anything unmeasurable, never a fake 0) ─────────
function fmt(n, dec = 0) {
  if (n == null || Number.isNaN(Number(n))) return 'N/A'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmtCurrency(n, currency) {
  // No currency = the All-countries view: SAR, AED and EGP are never added up.
  if (!currency) return 'N/A'
  if (n == null || Number.isNaN(Number(n))) return 'N/A'
  return `${currency} ${fmt(n, 0)}`
}

function fmtDate(date) {
  return date ? formatDate(date) : 'N/A'
}

function todayStamp(now) {
  return new Date(now).toISOString().slice(0, 10)
}

// ── Chart option factories ─────────────────────────────────────────────────────
function tooltipBase() {
  return {
    backgroundColor: 'var(--panel)',
    borderColor: 'var(--hairline)',
    borderWidth: 1,
    titleColor: 'var(--text-primary)',
    bodyColor: 'var(--text-secondary)',
  }
}

function axes(yCallback) {
  return {
    x: { grid: { color: CHART_GRID }, ticks: { color: CHART_TEXT, font: { size: 10 } } },
    y: {
      grid: { color: CHART_GRID },
      ticks: { color: CHART_TEXT, font: { size: 10 }, ...(yCallback ? { callback: yCallback } : {}) },
      beginAtZero: true,
    },
  }
}

function lineOpts(currency) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: CHART_TEXT, font: { size: 11 } } },
      tooltip: { ...tooltipBase(), callbacks: { label: (ctx) => ` ${currency} ${fmt(ctx.raw, 0)}` } },
    },
    scales: axes((v) => `${currency} ${fmt(v, 0)}`),
  }
}

function countBarOpts(unit = 'tyres') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { ...tooltipBase(), callbacks: { label: (ctx) => ` ${ctx.raw} ${unit}` } },
    },
    scales: axes(),
  }
}

// ── Small presentational pieces ────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  const colorMap = {
    red:    { bg: 'bg-red-900/20 border-red-800/40',       icon: 'text-red-400',    val: 'text-red-300' },
    amber:  { bg: 'bg-amber-900/20 border-amber-800/40',   icon: 'text-amber-400',  val: 'text-amber-300' },
    green:  { bg: 'bg-green-900/20 border-green-800/40',   icon: 'text-green-400',  val: 'text-green-300' },
    blue:   { bg: 'bg-blue-900/20 border-blue-800/40',     icon: 'text-blue-400',   val: 'text-blue-300' },
    purple: { bg: 'bg-purple-900/20 border-purple-800/40', icon: 'text-purple-400', val: 'text-purple-300' },
    cyan:   { bg: 'bg-cyan-900/20 border-cyan-800/40',     icon: 'text-cyan-400',   val: 'text-cyan-300' },
  }
  const c = colorMap[color] || colorMap.blue
  return (
    <div className={`border rounded-xl p-4 flex gap-3 items-start min-w-0 ${c.bg}`}>
      <div className={`mt-0.5 ${c.icon}`} aria-hidden="true"><Icon size={20} /></div>
      <div className="min-w-0">
        <p className="text-xs text-[var(--text-muted)] leading-tight">{label}</p>
        <p className={`text-lg font-bold leading-tight mt-0.5 tabular-nums break-words ${c.val}`}>{value}</p>
        {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function Panel({ title, subtitle, icon: Icon, children, actions }) {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 min-w-0">
      <div className="flex flex-wrap items-start gap-2 mb-3">
        {Icon && <Icon size={15} className="text-blue-400 mt-0.5" aria-hidden="true" />}
        <div className="min-w-0 mr-auto">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          {subtitle && <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

// Every status badge carries a text label and a shape, so colour is never the
// only signal.
function UrgencyBadge({ urgency }) {
  const map = {
    Urgent: 'bg-red-900/40 text-red-300 border-red-800/50',
    Soon: 'bg-amber-900/40 text-amber-300 border-amber-800/50',
    Monitor: 'bg-green-900/20 text-green-400 border-green-800/40',
  }
  const Icon = urgency === 'Urgent' ? AlertTriangle : urgency === 'Soon' ? Clock : CheckCircle
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${map[urgency] || map.Monitor}`}>
      <Icon size={11} aria-hidden="true" />{urgency || 'Monitor'}
    </span>
  )
}

function RiskBandBadge({ band, score }) {
  const cls = RISK_BAND_STYLE[band] || RISK_BAND_STYLE.unknown
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      <span className="tabular-nums">{score != null ? score : 'N/A'}</span> | {band || 'unknown'}
    </span>
  )
}

function ConfidenceBadge({ label, value }) {
  const map = {
    high:   'text-green-400 border-green-800/40 bg-green-900/15',
    medium: 'text-amber-300 border-amber-800/40 bg-amber-900/15',
    low:    'text-[var(--text-muted)] border-[var(--input-border)] bg-[var(--input-bg)]/40',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border ${map[label] || map.low}`}
      title={value != null ? `confidence ${Math.round(value * 100)}%` : ''}>
      <Gauge size={10} aria-hidden="true" /> {label || 'low'}
    </span>
  )
}

function LimitingFactorChip({ factor }) {
  if (!factor) return <span className="text-[var(--text-dim)]">N/A</span>
  const Icon = factor === LIMITING_FACTORS.tread ? TrendingDown : factor === LIMITING_FACTORS.age ? Clock : Activity
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-blue-300 border border-blue-800/40 bg-blue-900/15">
      <Icon size={11} aria-hidden="true" /> {LIMITING_FACTOR_LABEL[factor] || factor}
    </span>
  )
}

function TreadCell({ value }) {
  if (value == null) return <span className="text-[var(--text-dim)]">N/A</span>
  const cls = value < URGENT_TREAD_MM ? 'text-red-400' : value < SOON_TREAD_MM ? 'text-amber-400' : 'text-green-400'
  return <span className={`font-semibold tabular-nums ${cls}`}>{value}</span>
}

function RiskFactorBar({ label, value, max, muted }) {
  const pct = max > 0 ? Math.min(100, (Math.max(0, Number(value) || 0) / max) * 100) : 0
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-[11px] mb-0.5">
        <span className={muted ? 'text-[var(--text-dim)]' : 'text-[var(--text-muted)]'}>{label}</span>
        <span className={`tabular-nums ${muted ? 'text-[var(--text-dim)]' : 'text-[var(--text-secondary)]'}`}>{fmt(value, 1)}</span>
      </div>
      <div className="bg-[var(--input-bg)] rounded-full h-1.5" role="presentation">
        <div className={`h-1.5 rounded-full ${muted ? 'bg-[var(--text-dim)]/40' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function DetailRow({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--text-muted)]">{k}</span>
      <span className="text-[var(--text-secondary)] font-medium text-right">{v}</span>
    </div>
  )
}

function SearchField({ id, value, onChange, placeholder }) {
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-none sm:w-64">
      <label htmlFor={id} className="text-xs text-[var(--text-muted)]">Search</label>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
        <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className={`${SELECT_CLS} w-full pl-8`} />
      </div>
    </div>
  )
}

// ── Failure-risk detail (replaces the old inline expanded table row) ──────────
function RiskDetail({ row, onClose }) {
  return (
    <section aria-label={`Risk reasoning for ${row.asset_no} ${row.position}`}
      className="bg-[var(--surface-1)] border border-blue-800/40 rounded-xl p-4">
      <div className="flex items-start gap-2 mb-3">
        <div className="mr-auto min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {row.asset_no} | {row.position || 'N/A'} | {row.brand || 'N/A'} {row.size || ''}
          </h3>
          <p className="text-xs text-[var(--text-muted)]">Why this tyre scored {fmt(row.risk_score)} ({row.risk_band})</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close risk reasoning"
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div>
          <p className="font-semibold text-blue-300 mb-2">Composite risk breakdown (0 to 100)</p>
          <RiskFactorBar label="Mileage (Weibull x40)" value={row.factors?.mileage} max={40} />
          <RiskFactorBar label="Tread (up to 30)" value={row.factors?.tread} max={30} />
          <RiskFactorBar label={`Age (up to 15)${row.age_has_data ? '' : ', no data'}`} value={row.factors?.age} max={15} muted={!row.age_has_data} />
          <RiskFactorBar label={`Pressure (up to 15)${row.pressure_has_data ? '' : ', no reading'}`} value={row.factors?.pressure} max={15} muted={!row.pressure_has_data} />
        </div>
        <div className="space-y-1.5">
          <p className="font-semibold text-blue-300 mb-2">Reliability model</p>
          <DetailRow k="Failure probability" v={row.failure_prob_pct != null ? `${fmt(row.failure_prob_pct, 1)}%` : 'N/A'} />
          <DetailRow k="Characteristic life eta" v={row.eta_km != null ? `${fmt(row.eta_km)} km` : 'N/A'} />
          <DetailRow k="Weibull shape beta" v="2.2 (wear-out)" />
          <DetailRow k="In-service age" v={row.age_has_data ? `${fmt(row.age_days)} days` : 'Unknown (no fitment date)'} />
          <DetailRow k="Pressure deviation" v={row.pressure_has_data ? `${fmt(row.pressure_dev_pct, 1)}% vs ${PRESSURE_TARGET_PSI} psi` : 'No reading'} />
        </div>
        <div className="space-y-1.5">
          <p className="font-semibold text-blue-300 mb-2">Cohort position and confidence</p>
          {row.cohort ? (
            <>
              <DetailRow k="Cohort survival" v={`${fmt(row.cohort.survivalPct, 1)}%`} />
              <DetailRow k="Percentile in cohort" v={`${fmt(row.cohort.percentileInCohort, 1)}%`} />
              <DetailRow k="Expected remaining" v={`${fmt(row.cohort.expectedRemainingKm)} km`} />
              <DetailRow k="Cohort samples" v={`${row.cohort.n} (+/-${fmt(row.cohort.ciSpread, 1)}pp)`} />
            </>
          ) : (
            <p className="text-[var(--text-muted)]">No fitted cohort (brand and size need at least 5 completed lives).</p>
          )}
          <DetailRow k="Prediction confidence"
            v={row.confidence != null ? `${row.confidence_label} (${Math.round(row.confidence * 100)}%, ${row.completed_samples} samples)` : 'N/A'} />
        </div>
      </div>
    </section>
  )
}

// ── Failure Risk panel (G3 composite risk + G4 cohort + G5 confidence) ───────
function FailureRiskPanel({
  rows, totalRows, kpis, cohortRows, siteFilter, setSiteFilter, uniqueSites,
  riskBandFilter, setRiskBandFilter, search, setSearch, selectedId, setSelectedId,
}) {
  const bandBarData = {
    labels: ['Extreme (70+)', 'High (50 to 69)', 'Elevated (30 to 49)', 'Low (under 30)'],
    datasets: [{
      data: [kpis.extreme, kpis.high, kpis.elevated, kpis.low],
      backgroundColor: [SEM.red, SEM.orange, SEM.amber, SEM.green].map((c) => withAlpha(c, 0.65)),
      borderColor: [SEM.red, SEM.orange, SEM.amber, SEM.green],
      borderWidth: 1,
      borderRadius: 4,
    }],
  }

  const cohortColumns = useMemo(() => [
    { id: 'brand', header: 'Brand', accessorKey: 'brand' },
    { id: 'size', header: 'Size', accessorKey: 'size' },
    { id: 'n', header: 'Samples', accessorKey: 'n', meta: { align: 'right' } },
    { id: 'etaKm', header: 'Eta (km)', accessorKey: 'etaKm', meta: { align: 'right' }, cell: ({ getValue }) => fmt(getValue()) },
    { id: 'beta', header: 'Beta shape', accessorKey: 'beta', meta: { align: 'right' }, cell: ({ getValue }) => fmt(getValue(), 3) },
    { id: 'meanKm', header: 'Mean life (km)', accessorKey: 'meanKm', meta: { align: 'right' }, cell: ({ getValue }) => fmt(getValue()) },
    { id: 'cv', header: 'CV', accessorKey: 'cv', meta: { align: 'right' }, cell: ({ getValue }) => fmt(getValue(), 2) },
    { id: 'ciSpread', header: '+/- CI (pp)', accessorKey: 'ciSpread', meta: { align: 'right' }, cell: ({ getValue }) => fmt(getValue(), 1) },
  ], [])

  const riskColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset No', accessorKey: 'asset_no', cell: ({ getValue }) => <span className="font-mono font-semibold text-blue-300">{getValue()}</span> },
    { id: 'site', header: 'Site', accessorKey: 'site' },
    { id: 'position', header: 'Position', accessorKey: 'position' },
    { id: 'brand', header: 'Brand', accessorKey: 'brand' },
    { id: 'size', header: 'Size', accessorKey: 'size' },
    { id: 'tread_depth', header: 'Tread (mm)', accessorKey: 'tread_depth', meta: { align: 'right' }, cell: ({ getValue }) => <TreadCell value={getValue()} /> },
    { id: 'total_km', header: 'Total KM', accessorKey: 'total_km', meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue())}</span> },
    { id: 'failure_prob_pct', header: 'Failure prob', accessorKey: 'failure_prob_pct', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() != null ? `${fmt(getValue(), 1)}%` : 'N/A'}</span> },
    { id: 'risk_score', header: 'Risk', accessorKey: 'risk_score', cell: ({ row }) => <RiskBandBadge band={row.original.risk_band} score={row.original.risk_score} /> },
    { id: 'confidence', header: 'Confidence', accessorKey: 'confidence', cell: ({ row }) => <ConfidenceBadge label={row.original.confidence_label} value={row.original.confidence} /> },
  ], [])

  const selected = rows.find((r) => r.id === selectedId) || null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard icon={ShieldAlert} label="Extreme risk (70+)" value={`${fmt(kpis.extreme)} tyres`} sub="Immediate action" color="red" />
        <KpiCard icon={AlertTriangle} label="High risk (50 to 69)" value={`${fmt(kpis.high)} tyres`} sub="Inspect within 7 days" color="amber" />
        <KpiCard icon={Activity} label="Elevated (30 to 49)" value={`${fmt(kpis.elevated)} tyres`} sub="Monitor closely" color="purple" />
        <KpiCard icon={Percent} label="Avg failure probability" value={kpis.avgFailureProbPct != null ? `${fmt(kpis.avgFailureProbPct, 1)}%` : 'N/A'} sub="Weibull, brand-adjusted" color="cyan" />
        <KpiCard icon={Gauge} label="Avg composite risk" value={fmt(kpis.avgRiskScore, 1)} sub={`${fmt(kpis.total)} assessed`} color="blue" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel title="Risk Band Distribution" subtitle="Active tyres by composite risk score">
          {kpis.total === 0 ? (
            <p className="text-xs text-[var(--text-muted)] py-10 text-center">No scored tyres yet.</p>
          ) : (
            <div style={{ height: 220 }} role="img"
              aria-label={`Risk bands: ${kpis.extreme} extreme, ${kpis.high} high, ${kpis.elevated} elevated, ${kpis.low} low`}>
              <Bar data={bandBarData} options={countBarOpts('tyres')} />
            </div>
          )}
        </Panel>

        <div className="xl:col-span-2 min-w-0">
          <Panel title="Cohort Weibull Life Models" icon={Sigma}
            subtitle="Method-of-moments fit per brand and size (at least 5 completed lives)">
            {cohortRows.length === 0 ? (
              <div className="text-center py-8">
                <Target className="text-[var(--text-dim)] mx-auto mb-2" size={24} aria-hidden="true" />
                <p className="text-[var(--text-muted)] text-xs">No cohort has 5 completed lives yet. Cohort survival appears once history accrues.</p>
              </div>
            ) : (
              <EnterpriseTable
                columns={cohortColumns}
                data={cohortRows}
                getRowId={(r) => r.id}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                initialPageSize={25}
                emptyMessage="No cohorts"
              />
            )}
          </Panel>
        </div>
      </div>

      <section aria-label="Failure risk filters" className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <SearchField id="pm-risk-search" value={search} onChange={setSearch} placeholder="Asset, site, brand, size" />
          <div className="flex flex-col gap-1">
            <label htmlFor="pm-risk-site" className="text-xs text-[var(--text-muted)]">Site</label>
            <select id="pm-risk-site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className={SELECT_CLS}>
              {uniqueSites.map((s) => <option key={s} value={s}>{s === 'all' ? 'All sites' : s}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pm-risk-band" className="text-xs text-[var(--text-muted)]">Risk band</label>
            <select id="pm-risk-band" value={riskBandFilter} onChange={(e) => setRiskBandFilter(e.target.value)} className={SELECT_CLS}>
              <option value="all">All bands</option>
              <option value="extreme">Extreme</option>
              <option value="high">High</option>
              <option value="elevated">Elevated</option>
              <option value="low">Low</option>
            </select>
          </div>
          <p className="ml-auto text-sm text-[var(--text-secondary)]" role="status">
            Showing <span className="font-semibold tabular-nums">{fmt(rows.length)}</span> of {fmt(totalRows)} tyres
          </p>
        </div>
      </section>

      <Panel title="Per-Tyre Failure Risk" subtitle="Sorted by composite risk. Select a row to see the reasoning.">
        <EnterpriseTable
          columns={riskColumns}
          data={rows}
          getRowId={(r) => String(r.id)}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          onRowClick={(r) => setSelectedId(r.id === selectedId ? null : r.id)}
          emptyMessage={totalRows === 0 ? 'No active tyres have been scored yet' : 'No tyres match the selected filters'}
        />
      </Panel>

      {selected && <RiskDetail row={selected} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PredictiveMaintenance() {
  const loadId = useRef(0)
  const { activeCurrency, activeCountry } = useSettings()
  // Money is shown only for one country, in that country's own currency.
  const moneyCurrency = activeCountry && activeCountry !== 'All' ? activeCurrency : null
  // One clock read per mount: every engine gets the same injected "now".
  const [now] = useState(() => new Date())

  const [records, setRecords]         = useState([])
  const [fleetMaster, setFleetMaster] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [fleetMasterAvailable, setFleetMasterAvailable] = useState(true)

  const [activeTab, setActiveTab]       = useState('forecast') // 'forecast' | 'risk'
  const [siteFilter, setSiteFilter]     = useState('all')
  const [urgencyFilter, setUrgencyFilter] = useState('all')
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState('all')
  const [horizonFilter, setHorizonFilter] = useState('90d')
  const [search, setSearch]             = useState('')

  const [riskBandFilter, setRiskBandFilter] = useState('all')
  const [riskSearch, setRiskSearch]     = useState('')
  const [selectedRisk, setSelectedRisk] = useState(null)

  const [assumptionsOpen, setAssumptionsOpen] = useState(false)

  // Overview state (hero, KPI strip, cards, recommendations).
  const { hasCapability } = useAuth()
  const canCreateJob = typeof hasCapability === 'function' ? hasCapability('work_orders', 'create') : false
  const [fcMonths, setFcMonths] = useState(6)
  const [typeHorizon, setTypeHorizon] = useState(180)
  const [recLevel, setRecLevel] = useState('all')
  const [pmState, setPmState] = useState({ loading: true, rows: [], error: null })
  const [openJobs, setOpenJobs] = useState(() => new Set())
  const [jobDraft, setJobDraft] = useState(null)
  const [jobBusy, setJobBusy] = useState(false)
  const [jobError, setJobError] = useState(null)
  const [notice, setNotice] = useState(null)
  const detailRef = useRef(null)

  // ── Data loading ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const request = ++loadId.current
    setRecords([]); setFleetMaster([]); setFleetMasterAvailable(false)
    setLoading(true)
    setError(null)
    // Null-safe country scoping (mirrors the app-wide applyCountry convention):
    // "All" applies no predicate; a specific country returns its own rows plus
    // rows with a NULL country, never silently dropping uncategorised rows. This
    // keeps per-country budget/cost figures in a single currency (activeCurrency)
    // instead of blending SAR + AED + EGP. Applied server-side so a scoped view
    // fetches only its own rows.
    const scopeCountry = (q) =>
      activeCountry && activeCountry !== 'All'
        ? q.or(`country.eq.${activeCountry},country.is.null`)
        : q
    try {
      const { data: tyreData, error: tyreErr } = await fetchAllPages((from, to) => scopeCountry(supabase
        .from('tyre_records')
        .select('id,asset_no,site,brand,size,tyre_serial,position,tread_depth,pressure_reading,total_km,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,fitment_date,removal_date,status,risk_level,category')
        .order('issue_date', { ascending: false }))
        .range(from, to))

      if (request !== loadId.current) return
      if (tyreErr) throw tyreErr
      setRecords(tyreData || [])

      // vehicle_fleet is optional (graceful if missing). Paged past the 1000-row
      // cap so the fleet budget total is not summed over a capped subset.
      try {
        const { data: fleetData, error: fleetErr } = await fetchAllPages((from, to) => scopeCountry(supabase
          .from('vehicle_fleet')
          .select('asset_no,site,country,vehicle_type,make,model,expected_km_per_tyre,monthly_tyre_budget,current_km')
          .order('asset_no').order('id')).range(from, to), { max: 20000 })

        if (request !== loadId.current) return
        if (fleetErr) {
          setFleetMaster([])
          setFleetMasterAvailable(false)
        } else {
          setFleetMaster(fleetData || [])
          setFleetMasterAvailable(true)
        }
      } catch {
        if (request !== loadId.current) return
        setFleetMaster([])
        setFleetMasterAvailable(false)
      }
    } catch (err) {
      if (request !== loadId.current) return
      setError(toUserMessage(err, 'Failed to load data'))
    } finally {
      if (request === loadId.current) setLoading(false)
    }
  }, [activeCountry])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the current request on cleanup.
  useEffect(() => { loadData(); return () => { loadId.current++ } }, [loadData])

  // Preventive-maintenance plans feed the forecast, Due soon and Due for service.
  // A failed read is shown on those cards, never as "nothing due".
  const loadPm = useCallback(async () => {
    setPmState((st) => ({ ...st, loading: true, error: null }))
    try {
      const rows = await listPmPrograms({ country: activeCountry && activeCountry !== 'All' ? activeCountry : undefined })
      setPmState({ loading: false, rows: rows || [], error: null })
    } catch (err) {
      setPmState({ loading: false, rows: [], error: toUserMessage(err, 'Service plans could not be loaded.') })
    }
  }, [activeCountry])
  useEffect(() => { loadPm() }, [loadPm])

  // ── Engines (canonical libs) ─────────────────────────────────────────────────
  const fleetStats = useMemo(() => computeFleetStats(records), [records])
  const cohortModels = useMemo(() => buildCohortModels(records), [records])

  const allPredictions = useMemo(() => {
    if (!records.length) return []
    return buildPredictions(records, fleetMaster, {
      fleetAvgCost: fleetStats.avgCost,
      fleetAvgKmLife: fleetStats.avgKmLife,
      fleetAvgDailyKm: fleetStats.avgDailyKm,
      cohortModels,
      nowMs: now.getTime(),
    })
  }, [records, fleetMaster, fleetStats, cohortModels, now])

  const failureRiskRows = useMemo(() => {
    if (!records.length) return []
    return buildFailureRiskRows(records, { cohortModels, nowMs: now.getTime() })
  }, [records, cohortModels, now])

  const uniqueSites = useMemo(
    () => ['all', ...uniqueSorted([...allPredictions.map((p) => p.site), ...failureRiskRows.map((r) => r.site)])],
    [allPredictions, failureRiskRows],
  )
  const uniqueVehicleTypes = useMemo(() => ['all', ...uniqueSorted(fleetMaster.map((f) => f.vehicle_type))], [fleetMaster])

  // ── Scoping ──────────────────────────────────────────────────────────────────
  // `forecastBase` = population filters (site, vehicle type, search); the two
  // TIME filters are held out because every forecast surface plots its own
  // timeline. `filteredPredictions` adds urgency + horizon for the table.
  const forecastBase = useMemo(
    () => buildForecastBase(allPredictions, { site: siteFilter, vehicleType: vehicleTypeFilter, search }),
    [allPredictions, siteFilter, vehicleTypeFilter, search],
  )
  const filteredPredictions = useMemo(
    () => filterPredictions(forecastBase, { urgency: urgencyFilter, horizon: horizonFilter }),
    [forecastBase, urgencyFilter, horizonFilter],
  )
  const forecastScopeActive = siteFilter !== 'all' || vehicleTypeFilter !== 'all' || search.trim() !== ''
  const timeScopeActive = urgencyFilter !== 'all' || horizonFilter !== '12mo'

  const filteredRisk = useMemo(
    () => filterRisk(failureRiskRows, { site: siteFilter, band: riskBandFilter, search: riskSearch }),
    [failureRiskRows, siteFilter, riskBandFilter, riskSearch],
  )
  const riskKpis = useMemo(() => buildRiskKpis(failureRiskRows), [failureRiskRows])
  const cohortRows = useMemo(() => buildCohortRows(cohortModels), [cohortModels])

  // ── Rollups ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => forecastKpis(forecastBase), [forecastBase])
  const monthlyBudget = useMemo(() => buildMonthlyBudget(forecastBase, now), [forecastBase, now])
  const avgMonthlyFleetBudget = useMemo(() => monthlyFleetBudget(fleetMaster), [fleetMaster])
  const siteBreakdown = useMemo(() => buildSiteBreakdown(forecastBase), [forecastBase])
  const quarterly = useMemo(() => quarterlyForecast(monthlyBudget), [monthlyBudget])
  const urgentVehicles = useMemo(() => buildUrgentVehicles(forecastBase), [forecastBase])

  // ── Overview (pure engine: src/lib/predictiveOverview.js) ────────────────────
  const currencySafe = !!activeCountry && activeCountry !== 'All'
  const assetRisk = useMemo(() => buildAssetRisk(failureRiskRows, allPredictions, fleetMaster), [failureRiskRows, allPredictions, fleetMaster])
  const riskDist = useMemo(() => riskDistribution(assetRisk), [assetRisk])
  const ovKpis = useMemo(
    () => overviewKpis({ assets: assetRisk, predictions: allPredictions, pmPrograms: pmState.rows, now, currencySafe }),
    [assetRisk, allPredictions, pmState.rows, now, currencySafe],
  )
  const ovForecast = useMemo(
    () => maintenanceForecast({ predictions: allPredictions, pmPrograms: pmState.rows, now, months: fcMonths }),
    [allPredictions, pmState.rows, now, fcMonths],
  )
  const dueRows = useMemo(
    () => dueSoon({ predictions: allPredictions, pmPrograms: pmState.rows, now, fleet: fleetMaster }),
    [allPredictions, pmState.rows, now, fleetMaster],
  )
  const hasCompletedLives = useMemo(
    () => records.some((r) => r.km_at_removal != null && r.km_at_fitment != null && Number(r.km_at_removal) > Number(r.km_at_fitment)),
    [records],
  )
  const removals = useMemo(
    () => removalTrend(records, now, 6, hasCompletedLives ? fleetStats.avgKmLife : null),
    [records, now, hasCompletedLives, fleetStats.avgKmLife],
  )
  const failTypes = useMemo(() => failureTypes(allPredictions, typeHorizon), [allPredictions, typeHorizon])
  const recAssetKey = useMemo(
    () => buildRecommendations({ assets: assetRisk, predictions: allPredictions }).map((r) => r.asset_no).join('|'),
    [assetRisk, allPredictions],
  )
  useEffect(() => {
    let live = true
    const assets = recAssetKey ? recAssetKey.split('|') : []
    if (!assets.length) { setOpenJobs(new Set()); return undefined }
    listOpenJobAssets(assets, activeCountry && activeCountry !== 'All' ? activeCountry : undefined)
      .then((set) => { if (live) setOpenJobs(set) })
      .catch(() => { if (live) setOpenJobs(new Set()) })
    return () => { live = false }
  }, [recAssetKey, activeCountry])
  const recommendations = useMemo(
    () => buildRecommendations({ assets: assetRisk, predictions: allPredictions, openJobs, currencySafe }),
    [assetRisk, allPredictions, openJobs, currencySafe],
  )
  const recSites = useMemo(() => uniqueSorted(recommendations.map((r) => r.site)), [recommendations])
  const heroStat = useMemo(() => {
    const src = fleetMasterAvailable && fleetMaster.length ? fleetMaster : null
    if (!src) return null
    const sites = new Set(src.map((f) => f.site).filter(Boolean))
    const countries = new Set(src.map((f) => f.country).filter(Boolean))
    return {
      value: fmt(src.length),
      lines: ['Vehicles across', `${fmt(sites.size)} site${sites.size === 1 ? '' : 's'}`, `${fmt(countries.size)} countr${countries.size === 1 ? 'y' : 'ies'}`],
    }
  }, [fleetMaster, fleetMasterAvailable])

  const openDetail = useCallback((tab) => {
    setActiveTab(tab)
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const exportRecs = useCallback((rows) => {
    exportToExcel(
      rows.map((r) => ({
        ...r,
        level: r.level || 'N/A',
        cost: r.cost != null ? `${activeCurrency} ${Math.round(r.cost)}` : 'N/A',
        confidence: r.confidence != null ? `${Math.round(r.confidence * 100)}%` : 'N/A',
        targetDays: r.targetDays != null ? r.targetDays : 'N/A',
        status: r.status === 'job_open' ? 'Job open' : 'No job',
      })),
      ['asset_no', 'site', 'text', 'benefit', 'cost', 'confidence', 'level', 'targetDays', 'status'],
      ['Asset No', 'Site', 'Recommendation', 'Predicted Benefit', 'Est. Cost', 'Confidence', 'Risk Level', 'Target (days)', 'Status'],
      reportFileName('Predictive Recommendations', todayStamp(now)),
      'Recommendations',
    )
  }, [activeCurrency, now])

  const startJob = useCallback((rec) => {
    const target = new Date(now)
    target.setDate(target.getDate() + Math.max(0, rec.targetDays ?? 7))
    setJobError(null)
    setJobDraft({
      rec,
      work_type: rec.type === 'replace' ? 'Tyre Change' : 'Inspection',
      priority: rec.level === 'high' ? 'High' : rec.level === 'medium' ? 'Medium' : 'Low',
      description: rec.text,
      target_completion: target.toISOString().slice(0, 10),
    })
  }, [now])

  const submitJob = useCallback(async () => {
    if (!jobDraft) return
    setJobBusy(true)
    setJobError(null)
    try {
      const row = await createJob({
        asset_no: jobDraft.rec.asset_no,
        work_type: jobDraft.work_type,
        priority: jobDraft.priority,
        description: jobDraft.description,
        target_completion: jobDraft.target_completion,
        site: jobDraft.rec.site || undefined,
        country: currencySafe ? activeCountry : undefined,
      })
      setOpenJobs((s) => new Set(s).add(jobDraft.rec.asset_no))
      setNotice(`Work order ${row?.work_order_no || ''} created for ${jobDraft.rec.asset_no}.`.replace('  ', ' '))
      setJobDraft(null)
    } catch (err) {
      setJobError(toUserMessage(err, 'The work order could not be created.'))
    } finally {
      setJobBusy(false)
    }
  }, [jobDraft, currencySafe, activeCountry])

  // ── Chart data ────────────────────────────────────────────────────────────────
  const lineChartData = useMemo(() => {
    const labels = monthlyBudget.map((m) => formatMonthYear(m.date))
    const spend = colorAt(0)
    const datasets = [{
      label: 'Forecast spend',
      data: monthlyBudget.map((m) => m.cost),
      borderColor: spend,
      backgroundColor: withAlpha(spend, 0.12),
      fill: true,
      tension: 0.4,
      pointBackgroundColor: spend,
      pointRadius: 4,
    }]
    if (avgMonthlyFleetBudget) {
      const budget = colorAt(1)
      datasets.push({
        label: 'Monthly budget',
        data: labels.map(() => avgMonthlyFleetBudget),
        borderColor: budget,
        borderDash: [6, 4],
        backgroundColor: 'transparent',
        pointRadius: 0,
        tension: 0,
      })
    }
    return { labels, datasets }
  }, [monthlyBudget, avgMonthlyFleetBudget])

  const urgencyBarData = useMemo(() => ({
    labels: [`Urgent (${URGENT_DAYS}d or less)`, `Soon (31 to ${SOON_DAYS}d)`, 'Monitor (91 to 365d)'],
    datasets: [{
      data: [kpis.urgentCount, kpis.soonCount, kpis.monitorCount],
      backgroundColor: [SEM.red, SEM.amber, SEM.green].map((c) => withAlpha(c, 0.65)),
      borderColor: [SEM.red, SEM.amber, SEM.green],
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [kpis])

  // ── Table columns ────────────────────────────────────────────────────────────
  const forecastColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset No', accessorKey: 'asset_no', cell: ({ getValue }) => <span className="font-mono font-semibold text-blue-300">{getValue()}</span> },
    { id: 'site', header: 'Site', accessorKey: 'site' },
    { id: 'vehicle_type', header: 'Type', accessorKey: 'vehicle_type' },
    { id: 'position', header: 'Position', accessorKey: 'position' },
    { id: 'brand', header: 'Brand', accessorKey: 'brand' },
    { id: 'tread_depth', header: 'Tread (mm)', accessorKey: 'tread_depth', meta: { align: 'right' }, cell: ({ getValue }) => <TreadCell value={getValue()} /> },
    { id: 'km_remaining', header: 'KM remaining', accessorKey: 'km_remaining', meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue())}</span> },
    { id: 'due_date', header: 'Due date', accessorFn: (r) => (r.due_date ? new Date(r.due_date).getTime() : null), cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.due_date)}</span> },
    { id: 'urgency', header: 'Urgency', accessorKey: 'urgency', cell: ({ getValue }) => <UrgencyBadge urgency={getValue()} /> },
    { id: 'limiting_factor', header: 'Limiting factor', accessorKey: 'limiting_factor', cell: ({ getValue }) => <LimitingFactorChip factor={getValue()} /> },
    { id: 'confidence', header: 'Confidence', accessorKey: 'confidence', cell: ({ row }) => <ConfidenceBadge label={row.original.confidence_label} value={row.original.confidence} /> },
    { id: 'estimated_cost', header: 'Est. cost', accessorKey: 'estimated_cost', meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{fmtCurrency(getValue(), moneyCurrency)}</span> },
    { id: 'days_away', header: 'Days away', accessorKey: 'days_away', meta: { align: 'right' },
      cell: ({ getValue }) => {
        const d = getValue()
        const cls = d <= URGENT_DAYS ? 'text-red-400' : d <= SOON_DAYS ? 'text-amber-400' : 'text-[var(--text-muted)]'
        return <span className={`font-semibold tabular-nums ${cls}`}>{d != null ? `${d}d` : 'N/A'}</span>
      } },
  ], [moneyCurrency])

  const siteColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorKey: 'site', cell: ({ getValue }) => <span className="font-semibold">{getValue()}</span> },
    { id: 'due30', header: `Due ${URGENT_DAYS}d`, accessorKey: 'due30', meta: { align: 'right' }, cell: ({ getValue }) => <span className={`tabular-nums font-semibold ${getValue() > 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>{getValue()}</span> },
    { id: 'due90', header: `Due ${SOON_DAYS}d`, accessorKey: 'due90', meta: { align: 'right' }, cell: ({ getValue }) => <span className={`tabular-nums font-semibold ${getValue() > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{getValue()}</span> },
    { id: 'due12mo', header: 'Due 12mo', accessorKey: 'due12mo', meta: { align: 'right' } },
    { id: 'cost', header: 'Forecast cost', accessorKey: 'cost', meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{fmtCurrency(getValue(), moneyCurrency)}</span> },
    { id: 'pctBudget', header: 'Share of forecast', accessorKey: 'pctBudget',
      cell: ({ getValue }) => {
        const v = getValue()
        if (v == null) return <span className="text-[var(--text-dim)]">N/A</span>
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 bg-[var(--input-bg)] rounded-full h-1.5" role="presentation">
              <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, v)}%` }} />
            </div>
            <span className="text-[var(--text-muted)] w-12 text-right tabular-nums">{v}%</span>
          </div>
        )
      } },
  ], [moneyCurrency])

  const vehicleColumns = useMemo(() => [
    { id: 'rank', header: '#', accessorKey: 'rank', meta: { align: 'right' } },
    { id: 'asset_no', header: 'Asset No', accessorKey: 'asset_no', cell: ({ getValue }) => <span className="font-mono font-semibold text-blue-300">{getValue()}</span> },
    { id: 'site', header: 'Site', accessorKey: 'site' },
    { id: 'vehicle_type', header: 'Type', accessorKey: 'vehicle_type' },
    { id: 'urgent_count', header: 'Urgent', accessorKey: 'urgent_count', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() > 0 ? <span className="px-1.5 py-0.5 bg-red-900/40 text-red-300 rounded font-bold tabular-nums">{getValue()}</span> : <span className="text-[var(--text-dim)]">0</span>) },
    { id: 'soon_count', header: 'Soon', accessorKey: 'soon_count', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() > 0 ? <span className="px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded font-bold tabular-nums">{getValue()}</span> : <span className="text-[var(--text-dim)]">0</span>) },
    { id: 'total_cost', header: 'Forecast cost', accessorKey: 'total_cost', meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{fmtCurrency(getValue(), moneyCurrency)}</span> },
    { id: 'recommended_action', header: 'Recommended action', accessorKey: 'recommended_action' },
  ], [moneyCurrency])

  // ── Export handlers ───────────────────────────────────────────────────────────
  const stamp = todayStamp(now)
  const forecastFile = reportFileName('Predictive Maintenance', stamp)
  const riskFile = reportFileName('Predictive Failure Risk', stamp)

  const handleExcelExport = useCallback(() => {
    const rows = filteredPredictions.map((p) => ({
      ...p,
      due_date: fmtDate(p.due_date),
      estimated_cost: moneyCurrency ? `${moneyCurrency} ${p.estimated_cost}` : 'N/A',
      tread_depth: p.tread_depth ?? 'N/A',
      limiting_factor: LIMITING_FACTOR_LABEL[p.limiting_factor] || 'N/A',
    }))
    exportToExcel(
      rows,
      ['asset_no','site','vehicle_type','position','brand','size','tread_depth','km_remaining','due_date','urgency','limiting_factor','confidence_label','risk_score','estimated_cost','days_away'],
      ['Asset No','Site','Vehicle Type','Position','Brand','Size','Tread Depth (mm)','KM Remaining','Due Date','Urgency','Limiting Factor','Confidence','Risk Score','Estimated Cost','Days Away'],
      forecastFile,
      'Upcoming Replacements',
    )
  }, [filteredPredictions, moneyCurrency, forecastFile])

  // A landscape A4 page holds ~30 of these rows, so 500 is already ~17 pages and
  // the whole document is built in memory. The cap stays; the header says when
  // it bites instead of reading as the whole filtered forecast.
  const PDF_ROW_CAP = 500

  const handlePdfExport = useCallback((opts = {}) => {
    const rows = filteredPredictions.slice(0, PDF_ROW_CAP).map((p) => ({
      ...p,
      due_date: fmtDate(p.due_date),
      estimated_cost: fmtCurrency(p.estimated_cost, moneyCurrency),
      tread_depth: p.tread_depth != null ? `${p.tread_depth} mm` : 'N/A',
      limiting_factor: LIMITING_FACTOR_LABEL[p.limiting_factor] || 'N/A',
    }))
    return exportToPdf(
      rows,
      [
        { key: 'asset_no',        header: 'Asset No' },
        { key: 'site',            header: 'Site' },
        { key: 'position',        header: 'Position' },
        { key: 'brand',           header: 'Brand' },
        { key: 'tread_depth',     header: 'Tread' },
        { key: 'km_remaining',    header: 'KM Remaining' },
        { key: 'due_date',        header: 'Due Date' },
        { key: 'urgency',         header: 'Urgency' },
        { key: 'limiting_factor', header: 'Limiting Factor' },
        { key: 'confidence_label',header: 'Confidence' },
        { key: 'estimated_cost',  header: 'Est. Cost' },
        { key: 'days_away',       header: 'Days Away' },
      ],
      'Predictive Maintenance: Upcoming Tyre Replacements',
      forecastFile,
      'landscape',
      '',
      {
        ...opts,
        subtitleNote: filteredPredictions.length > PDF_ROW_CAP
          ? `of ${fmt(filteredPredictions.length)} matching, narrow the filters to include the rest`
          : opts.subtitleNote,
      },
    )
  }, [filteredPredictions, moneyCurrency, forecastFile])

  const riskExportRows = useCallback(() => filteredRisk.map((r) => ({
    ...r,
    tread_depth: r.tread_depth ?? 'N/A',
    failure_prob_pct: r.failure_prob_pct != null ? `${fmt(r.failure_prob_pct, 1)}%` : 'N/A',
    cohort_survival: r.cohort ? `${fmt(r.cohort.survivalPct, 1)}%` : 'N/A',
  })), [filteredRisk])

  const handleRiskExcel = useCallback(() => {
    exportToExcel(
      riskExportRows(),
      ['asset_no','site','position','brand','size','tread_depth','total_km','eta_km','failure_prob_pct','risk_score','risk_band','confidence_label','completed_samples','cohort_survival'],
      ['Asset No','Site','Position','Brand','Size','Tread (mm)','Total KM','Eta (km)','Failure Prob','Risk Score','Risk Band','Confidence','Samples','Cohort Survival'],
      riskFile,
      'Failure Risk',
    )
  }, [riskExportRows, riskFile])

  const handleRiskPdf = useCallback(() => {
    const all = riskExportRows()
    return exportToPdf(
      all.slice(0, PDF_ROW_CAP),
      [
        { key: 'asset_no', header: 'Asset No' },
        { key: 'site', header: 'Site' },
        { key: 'position', header: 'Position' },
        { key: 'brand', header: 'Brand' },
        { key: 'size', header: 'Size' },
        { key: 'tread_depth', header: 'Tread (mm)' },
        { key: 'failure_prob_pct', header: 'Failure Prob' },
        { key: 'risk_score', header: 'Risk Score' },
        { key: 'risk_band', header: 'Risk Band' },
        { key: 'confidence_label', header: 'Confidence' },
      ],
      'Predictive Maintenance: Tyre Failure Risk',
      riskFile,
      'landscape',
      '',
      all.length > PDF_ROW_CAP ? { subtitleNote: `of ${fmt(all.length)} matching, narrow the filters to include the rest` } : {},
    )
  }, [riskExportRows, riskFile])

  // ── Render ────────────────────────────────────────────────────────────────────
  const hasAnyData = allPredictions.length > 0 || failureRiskRows.length > 0
  const detailTabs = [
    { key: 'forecast', label: 'Replacement forecast', count: fmt(allPredictions.length) },
    { key: 'risk', label: 'Failure risk', count: fmt(failureRiskRows.length) },
  ]
  const money30 = ovKpis.cost30 != null ? `${activeCurrency} ${fmt(ovKpis.cost30)}` : 'N/A'

  const exportActions = activeTab === 'forecast' ? (
    <>
      <button type="button" onClick={handleExcelExport} disabled={!filteredPredictions.length} className="cc-btn-ghost">
        <Download size={14} aria-hidden="true" /> Excel
      </button>
      <button type="button" onClick={() => handlePdfExport()} disabled={!filteredPredictions.length} className="cc-btn-ghost">
        <FileText size={14} aria-hidden="true" /> PDF
      </button>
      <EmailPdfButton
        className="cc-btn-ghost"
        getPdf={async () => ({
          base64: await handlePdfExport({ returnBase64: true }),
          filename: `${forecastFile}.pdf`,
          subject: 'Predictive Maintenance',
          bodyHtml: '<p>Attached is the Predictive Maintenance report.</p>',
        })}
      />
    </>
  ) : (
    <>
      <button type="button" onClick={handleRiskExcel} disabled={!filteredRisk.length} className="cc-btn-ghost">
        <Download size={14} aria-hidden="true" /> Excel
      </button>
      <button type="button" onClick={() => handleRiskPdf()} disabled={!filteredRisk.length} className="cc-btn-ghost">
        <FileText size={14} aria-hidden="true" /> PDF
      </button>
    </>
  )

  return (
    <div className="cc pm-page min-w-0">
      <PageHero
        title="Predictive Maintenance"
        lead={(
          <>
            Predict issues. Prevent downtime. Maximise tyre life.
            <span className="pm-lead-2">Data-driven insights to keep your fleet moving, safely and cost-effectively.</span>
          </>
        )}
        imgLight="/dashboard/hero-predictive-light.webp"
        imgDark="/dashboard/hero-predictive-dark.webp"
        stat={heroStat}
      />

      <div className="pm-toolbar">
        <p className="pm-asof">Forecast as of {fmtDate(now)}</p>
        {!fleetMasterAvailable && !loading && (
          <span className="cc-pill warn">Fleet master unavailable, using tyre records only</span>
        )}
        <button type="button" className="cc-btn-ghost" onClick={() => { loadData(); loadPm() }} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>

      {notice && (
        <div className="pm-banner pm-banner-good" role="status">
          <CheckCircle size={14} aria-hidden="true" /><span>{notice}</span>
          <button type="button" className="cc-icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}

      {loading ? (
        <div role="status" aria-live="polite" aria-label="Loading predictive maintenance data">
          <div className="cc-kpis pm-kpis">{Array.from({ length: 5 }, (_, i) => <div key={i} className="cc-card cc-skel" style={{ height: 70 }} />)}</div>
          <div className="pm-grid" style={{ marginTop: 14 }}>{Array.from({ length: 3 }, (_, i) => <div key={i} className="cc-card cc-skel" style={{ height: 260 }} />)}</div>
        </div>
      ) : error ? (
        <div className="cc-card pm-error" role="alert">
          <AlertTriangle size={28} aria-hidden="true" />
          <p className="cc-card-title">Predictive maintenance data could not be loaded</p>
          <p className="cc-card-sub">{error}</p>
          <p className="cc-card-sub">No forecast is shown, because a failed read is not the same as no replacements due.</p>
          <button type="button" onClick={loadData} className="cc-btn-primary">Retry</button>
        </div>
      ) : (
        <>
          {activeCountry === 'All' && hasAnyData && (
            <div className="pm-banner pm-banner-warn">
              <Info size={13} aria-hidden="true" />
              <span>Showing all countries. Cost figures span several currencies (SAR, AED, EGP) and are not added together. Select a country to see cost in that country's currency.</span>
            </div>
          )}

          {!hasAnyData ? (
            <div className="cc-card cc-empty pm-empty">
              <div>
                <CalendarClock size={36} aria-hidden="true" />
                <p className="cc-card-title">No active tyre records found</p>
                <p className="cc-card-sub">Upload tyre fitment data to generate replacement forecasts and risk scores.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="cc-kpis pm-kpis">
                <Kpi icon={Truck} tone="t-green" value={ovKpis.assetsMonitored} label="Assets monitored"
                  title="Assets with at least one active tyre scored by the prediction engine" onClick={() => openDetail('risk')} />
                <Kpi icon={ShieldAlert} tone="t-red" value={ovKpis.highRisk} label="High-risk assets" danger={ovKpis.highRisk > 0}
                  title="Assets whose worst tyre has a composite risk of 70 or more" onClick={() => { setRiskBandFilter('extreme'); openDetail('risk') }} />
                <Kpi icon={Wrench} tone="t-amber" value={ovKpis.predictedFailures} label="Predicted failures"
                  title={`Tyres forecast to reach their replacement limit within ${PREDICTED_FAILURE_DAYS} days`}
                  onClick={() => { setHorizonFilter('30d'); openDetail('forecast') }} />
                <Kpi icon={CalendarCheck} tone="t-blue" value={pmState.error ? null : ovKpis.dueForService}
                  display={pmState.loading ? '...' : undefined}
                  label="Due for service"
                  title={pmState.error ? 'Service plans could not be loaded' : `Active service plans due within ${DUE_SOON_DAYS} days, including overdue`}
                  to="/pm-programs" />
                <Kpi icon={Coins} tone="t-green" display={money30} label={`Replacement cost, next ${PREDICTED_FAILURE_DAYS} days`}
                  title={currencySafe
                    ? `Estimated cost of the tyres forecast for replacement in the next ${PREDICTED_FAILURE_DAYS} days, from recorded tyre prices`
                    : 'Pick a country: costs are not added across currencies'} />
              </div>

              <div className="pm-grid">
                <RiskScoredAssets assets={assetRisk} onViewAll={() => openDetail('risk')} />
                <MaintenanceForecast forecast={ovForecast} months={fcMonths} onMonths={setFcMonths} pmState={pmState} />
                <DueSoon rows={dueRows} onViewAll={() => { setHorizonFilter('30d'); openDetail('forecast') }} />
              </div>

              <div className="pm-grid pm-grid-2">
                <TyreHealthTrend trend={removals} />
                <RiskDistribution dist={riskDist} onSelect={(level) => setRecLevel(level)} />
                <FailureTypes types={failTypes} horizon={typeHorizon} onHorizon={setTypeHorizon} />
              </div>

              <Recommendations
                recs={recommendations}
                sites={recSites}
                currency={activeCurrency}
                currencySafe={currencySafe}
                canCreate={canCreateJob}
                onCreateJob={startJob}
                onExport={exportRecs}
                filterLevel={recLevel}
                setFilterLevel={setRecLevel}
              />

              <section className="cc-card pm-detail" ref={detailRef} aria-label="Detailed analysis">
                <div className="pm-detail-head">
                  <Tabs variant="line" label="Predictive maintenance views" tabs={detailTabs} value={activeTab} onChange={setActiveTab} />
                  <div className="pm-detail-actions">{exportActions}</div>
                </div>
      {hasAnyData && activeTab === 'forecast' && (
        <div role="tabpanel" aria-label="Replacement forecast" className="space-y-6 pm-panel">
          {allPredictions.length === 0 ? (
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-10 text-center">
              <CalendarClock className="text-[var(--text-dim)] mx-auto mb-3" size={36} aria-hidden="true" />
              <p className="text-[var(--text-secondary)] font-semibold">No active replacement forecasts</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">Switch to the Failure Risk tab to review scored tyres.</p>
            </div>
          ) : (
            <>
              {/* Filters sit above the KPI strip so the scope is visible before
                  the figures it shapes. */}
              <section aria-label="Forecast filters" className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Filter size={14} className="text-[var(--text-muted)]" aria-hidden="true" />
                  <span className="text-sm font-medium text-[var(--text-secondary)]">Filters</span>
                </div>
                <div className="flex flex-wrap gap-3 items-end">
                  <SearchField id="pm-forecast-search" value={search} onChange={setSearch} placeholder="Asset, site, brand, size" />
                  <div className="flex flex-col gap-1">
                    <label htmlFor="pm-site" className="text-xs text-[var(--text-muted)]">Site</label>
                    <select id="pm-site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className={SELECT_CLS}>
                      {uniqueSites.map((s) => <option key={s} value={s}>{s === 'all' ? 'All sites' : s}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="pm-urgency" className="text-xs text-[var(--text-muted)]">Urgency</label>
                    <select id="pm-urgency" value={urgencyFilter} onChange={(e) => setUrgencyFilter(e.target.value)} className={SELECT_CLS}>
                      <option value="all">All urgencies</option>
                      <option value="Urgent">Urgent</option>
                      <option value="Soon">Soon</option>
                      <option value="Monitor">Monitor</option>
                    </select>
                  </div>
                  {uniqueVehicleTypes.length > 1 && (
                    <div className="flex flex-col gap-1">
                      <label htmlFor="pm-type" className="text-xs text-[var(--text-muted)]">Vehicle type</label>
                      <select id="pm-type" value={vehicleTypeFilter} onChange={(e) => setVehicleTypeFilter(e.target.value)} className={SELECT_CLS}>
                        {uniqueVehicleTypes.map((t) => <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>)}
                      </select>
                    </div>
                  )}
                  <fieldset className="flex flex-col gap-1">
                    <legend className="text-xs text-[var(--text-muted)] mb-1">Horizon</legend>
                    <div className="flex flex-wrap gap-1">
                      {HORIZONS.map((h) => (
                        <button
                          key={h.key}
                          type="button"
                          aria-pressed={horizonFilter === h.key}
                          onClick={() => setHorizonFilter(h.key)}
                          className={`min-h-[44px] px-3 rounded-lg text-xs font-medium transition-colors border focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            horizonFilter === h.key
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)] hover:bg-[var(--input-bg-hover)]'
                          }`}
                        >
                          {h.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <p className="ml-auto text-sm text-[var(--text-secondary)]" role="status">
                    <span className="font-semibold tabular-nums">{fmt(filteredPredictions.length)}</span> replacements in the table
                  </p>
                </div>
              </section>

              {forecastScopeActive && (
                <p className="text-xs text-[var(--text-muted)]">
                  Forecast figures cover {fmt(forecastBase.length)} of {fmt(allPredictions.length)} tyres
                  {siteFilter !== 'all' ? ` at ${siteFilter}` : ''}
                  {vehicleTypeFilter !== 'all' ? ` on ${vehicleTypeFilter}` : ''}
                  {search.trim() ? ` matching "${search.trim()}"` : ''}.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiCard icon={AlertTriangle} label={`Replacements due in ${URGENT_DAYS} days`} value={`${fmt(kpis.urgentCount)} tyres`} sub={fmtCurrency(kpis.urgentCost, moneyCurrency)} color="red" />
                <KpiCard icon={Clock} label={`Replacements due 31 to ${SOON_DAYS} days`} value={`${fmt(kpis.soonCount)} tyres`} sub={fmtCurrency(kpis.soonCost, moneyCurrency)} color="amber" />
                <KpiCard icon={CheckCircle} label="Replacements due 91 to 365 days" value={`${fmt(kpis.monitorCount)} tyres`} sub={fmtCurrency(kpis.monitorCost, moneyCurrency)} color="green" />
                <KpiCard icon={DollarSign} label="12-month budget forecast" value={fmtCurrency(kpis.annualCost, moneyCurrency)} sub={`${fmt(kpis.yearCount)} replacements`} color="blue" />
                <KpiCard icon={TrendingUp} label="Fleet avg tyre life" value={fleetStats.avgKmLife != null ? `${fmt(fleetStats.avgKmLife, 0)} km` : 'N/A'} sub="Based on completed records" color="purple" />
                <KpiCard icon={Truck} label="Fleet avg daily km per vehicle" value={fleetStats.avgDailyKm != null ? `${fmt(fleetStats.avgDailyKm, 0)} km` : 'N/A'} sub="Estimated from records" color="cyan" />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 min-w-0">
                  <Panel title="12-Month Budget Forecast" subtitle="Forecast tyre replacement spend by month">
                    <div style={{ height: 240 }} role="img"
                      aria-label={`12-month replacement spend forecast totalling ${fmtCurrency(quarterly.total, moneyCurrency)}`}>
                      {moneyCurrency
                        ? <Line data={lineChartData} options={lineOpts(moneyCurrency)} />
                        : <p className="text-xs text-[var(--text-muted)] py-16 text-center">Pick a country to see forecast spend in that country's currency.</p>}
                    </div>
                  </Panel>
                </div>
                <Panel title="Replacement Urgency Distribution" subtitle="Active tyres by urgency horizon">
                  <div style={{ height: 240 }} role="img"
                    aria-label={`${kpis.urgentCount} urgent, ${kpis.soonCount} soon, ${kpis.monitorCount} monitor`}>
                    <Bar data={urgencyBarData} options={countBarOpts('tyres')} />
                  </div>
                </Panel>
              </div>

              {timeScopeActive && (
                <p className="text-xs text-[var(--text-muted)]">
                  The forecast charts and quarterly cards plot their own timeline, so the urgency and
                  horizon filters shape the table below but not these figures. Site, vehicle type and search do apply.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Q1 forecast (months 1 to 3)', value: quarterly.q1 },
                  { label: 'Q2 forecast (months 4 to 6)', value: quarterly.q2 },
                  { label: 'H2 forecast (months 7 to 12)', value: quarterly.h2 },
                  { label: 'Annual total', value: quarterly.total },
                ].map((card) => (
                  <div key={card.label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                    <p className="text-xs text-[var(--text-muted)]">{card.label}</p>
                    <p className="text-lg font-bold text-[var(--text-primary)] mt-1 tabular-nums">{fmtCurrency(card.value, moneyCurrency)}</p>
                  </div>
                ))}
              </div>

              <Panel title="Upcoming Replacements Calendar" subtitle={`${fmt(filteredPredictions.length)} records, sorted by due date`}>
                <EnterpriseTable
                  columns={forecastColumns}
                  data={filteredPredictions}
                  getRowId={(r, i) => `${r.id}-${i}`}
                  enableGlobalFilter={false}
                  enableColumnFilters={false}
                  enableExport={false}
                  initialPageSize={25}
                  emptyMessage="No replacements due within the selected horizon and filters"
                />
              </Panel>

              {siteBreakdown.length > 0 && (
                <Panel title="Site Breakdown: 12-Month Forecast" subtitle="Replacement demand and share of the forecast by site">
                  <EnterpriseTable
                    columns={siteColumns}
                    data={siteBreakdown}
                    getRowId={(r) => r.site}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableExport={false}
                    initialPageSize={25}
                    emptyMessage="No site demand in the next 12 months"
                  />
                </Panel>
              )}

              {urgentVehicles.length > 0 && (
                <Panel title="Vehicles Needing Immediate Attention" icon={AlertTriangle}
                  subtitle="Top 10 vehicles by urgent replacement count">
                  <EnterpriseTable
                    columns={vehicleColumns}
                    data={urgentVehicles}
                    getRowId={(r) => r.asset_no}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableExport={false}
                    initialPageSize={25}
                    emptyMessage="No vehicles need immediate attention"
                  />
                </Panel>
              )}

              <section className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                <button
                  type="button"
                  aria-expanded={assumptionsOpen}
                  aria-controls="pm-assumptions"
                  onClick={() => setAssumptionsOpen((o) => !o)}
                  className="w-full min-h-[44px] flex items-center justify-between p-4 hover:bg-[var(--input-bg)]/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                >
                  <span className="flex items-center gap-2">
                    <Info className="text-blue-400" size={16} aria-hidden="true" />
                    <span className="text-sm font-medium text-[var(--text-secondary)]">Prediction model assumptions and methodology</span>
                  </span>
                  {assumptionsOpen ? <ChevronUp size={16} className="text-[var(--text-muted)]" aria-hidden="true" /> : <ChevronDown size={16} className="text-[var(--text-muted)]" aria-hidden="true" />}
                </button>
                {assumptionsOpen && (
                  <div id="pm-assumptions" className="px-4 pb-4 border-t border-[var(--input-border)]">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      {[
                        {
                          title: 'G1: Tread wear rate',
                          body: `Wear rate (mm/km) = (nominal new tread minus current tread) divided by lifetime km, clamped to a physical range. Nominal new tread is a documented size-class value (heavy-commercial ${fmt(DEFAULT_NEW_TREAD_MM, 0)}mm, light ~9mm) because this dataset has no per-tyre initial reading or inspection time-series. Days-to-limit projects tread to the ${LEGAL_MIN_TREAD_MM}mm legal minimum.`,
                        },
                        {
                          title: 'G2: Min-of-three forecast',
                          body: `Days-to-replace = min(tread-wear, km-lifecycle, age). Km-lifecycle uses avg tyre life (${fmt(fleetStats.avgKmLife, 0)} km fallback) divided by daily km. Age is measured from fitment_date to the ${MAX_AGE_YEARS}yr GCC guideline, an APPROXIMATION, as pre-fitment shelf age is unknown (no manufacture_date). The limiting-factor column shows which bound wins.`,
                        },
                        {
                          title: 'G3: Weibull failure risk',
                          body: `Reliability R(t)=exp(-(km/eta)^2.2) with a brand eta table (Michelin 135k to default 110k km). Composite 0 to 100 risk = failure-prob x40 + tread (up to 30) + age (up to 15) + pressure (up to 15). Pressure uses the single ${PRESSURE_TARGET_PSI} psi deviation only (no TPMS series) and is flagged when absent, never fabricated.`,
                        },
                        {
                          title: 'G4: Cohort life distribution',
                          body: 'Completed lives (km_at_removal minus km_at_fitment) are grouped by brand and size; cohorts with at least 5 samples get a method-of-moments Weibull fit (beta from CV, eta = mean/Gamma(1+1/beta)). Gives survival %, cohort percentile and expected remaining km for each active tyre.',
                        },
                        {
                          title: 'G5: Confidence',
                          body: 'Per-asset confidence = min(1, completed samples / 6). Cohort CI half-width = 30/sqrt(n) (3 to 35pp). Attached to every prediction and risk row so thin-history estimates are labelled, not overstated.',
                        },
                        {
                          title: 'Cost and fleet master',
                          body: `${fleetMasterAvailable ? 'vehicle_fleet loaded: expected km/tyre, current_km and budgets used.' : 'vehicle_fleet unavailable, tyre_records history only.'} Cost uses the tyre's cost_per_tyre, else asset mean, else fleet average (${fmtCurrency(fleetStats.avgCost, moneyCurrency)}). No fabricated costs.`,
                        },
                      ].map((item) => (
                        <div key={item.title} className="bg-[var(--input-bg)]/40 rounded-lg p-3">
                          <p className="text-xs font-semibold text-blue-300 mb-1">{item.title}</p>
                          <p className="text-xs text-[var(--text-muted)] leading-relaxed">{item.body}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-[var(--text-dim)] mt-3">
                      All forecasts are statistical estimates based on historical patterns. Actual replacement dates may vary due to road conditions, load factors, driver behaviour, and maintenance quality.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {hasAnyData && activeTab === 'risk' && (
        <div role="tabpanel" aria-label="Failure risk" className="pm-panel">
          <FailureRiskPanel
            rows={filteredRisk}
            totalRows={failureRiskRows.length}
            kpis={riskKpis}
            cohortRows={cohortRows}
            siteFilter={siteFilter}
            setSiteFilter={setSiteFilter}
            uniqueSites={uniqueSites}
            riskBandFilter={riskBandFilter}
            setRiskBandFilter={setRiskBandFilter}
            search={riskSearch}
            setSearch={setRiskSearch}
            selectedId={selectedRisk}
            setSelectedId={setSelectedRisk}
          />
        </div>
      )}
              </section>
            </>
          )}
        </>
      )}

      <Modal
        open={!!jobDraft}
        onClose={() => { if (!jobBusy) setJobDraft(null) }}
        closeOnBackdrop={!jobBusy}
        title="Create work order"
        subtitle={jobDraft ? `From the recommendation for ${jobDraft.rec.asset_no}` : undefined}
        size="sm"
        footer={(
          <div className="cc pm-modal-foot">
            <button type="button" className="cc-btn-ghost" onClick={() => setJobDraft(null)} disabled={jobBusy}>Cancel</button>
            <button type="button" className="cc-btn-primary" onClick={submitJob} disabled={jobBusy || !jobDraft?.description?.trim()}>
              {jobBusy ? 'Creating...' : 'Create work order'}
            </button>
          </div>
        )}
      >
        {jobDraft && (
          <div className="cc pm-form">
            <div className="pm-form-row"><span>Asset</span><b>{jobDraft.rec.asset_no}{jobDraft.rec.site ? `, ${jobDraft.rec.site}` : ''}</b></div>
            <label>
              <span>Work type</span>
              <select className="cc-select" value={jobDraft.work_type} onChange={(e) => setJobDraft((d) => ({ ...d, work_type: e.target.value }))}>
                {['Tyre Change', 'Inspection', 'Rotation', 'Pressure Check', 'Repair'].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select className="cc-select" value={jobDraft.priority} onChange={(e) => setJobDraft((d) => ({ ...d, priority: e.target.value }))}>
                {['Critical', 'High', 'Medium', 'Low'].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label>
              <span>Target completion</span>
              <input type="date" className="cc-select pm-input" value={jobDraft.target_completion}
                onChange={(e) => setJobDraft((d) => ({ ...d, target_completion: e.target.value }))} />
            </label>
            <label>
              <span>Description</span>
              <textarea className="pm-input" rows={3} value={jobDraft.description}
                onChange={(e) => setJobDraft((d) => ({ ...d, description: e.target.value }))} />
            </label>
            {jobError && <p className="pm-form-error" role="alert">{jobError}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}
