import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { formatDate, formatMonthYear } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
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
  ChevronLeft, ChevronRight, Info, Filter,
  ShieldAlert, Activity, Gauge, Sigma, Percent, Target, TrendingDown,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EmailPdfButton from '../components/EmailPdfButton'
import {
  buildPredictions, buildFailureRiskRows, buildCohortModels, computeFleetStats,
  LEGAL_MIN_TREAD_MM, REPLACE_TARGET_MM, PRESSURE_TARGET_PSI, MAX_AGE_YEARS,
  DEFAULT_NEW_TREAD_MM, DEFAULT_AVG_KM_LIFE, DEFAULT_DAILY_KM as LIB_DEFAULT_DAILY_KM,
  LIMITING_FACTORS,
} from '../lib/predictiveMaintenance'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ──────────────────────────────────────────────────────────────────
// Engine constants live in the pure lib (src/lib/predictiveMaintenance.js); the
// page keeps only presentation-layer values and thin aliases for copy.
const DEFAULT_DAILY_KM   = LIB_DEFAULT_DAILY_KM
const DEFAULT_AVG_KM     = DEFAULT_AVG_KM_LIFE
const URGENT_TREAD_MM    = REPLACE_TARGET_MM
const SOON_TREAD_MM      = 5
const URGENT_DAYS        = 30
const SOON_DAYS          = 90
const PAGE_SIZE          = 25
const TODAY              = new Date()

const CHART_DARK = {
  color: '#9ca3af',
  grid: 'rgba(255,255,255,0.08)',
}

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

// ── Utility helpers ────────────────────────────────────────────────────────────
function addMonths(date, n) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(date) {
  return formatMonthYear(date)
}

function fmt(n, dec = 0) {
  if (n == null || isNaN(n)) return '-'
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })
}

function fmtCurrency(n, currency) {
  if (n == null || isNaN(n)) return '-'
  return `${currency} ${fmt(n, 0)}`
}

function fmtDate(date) {
  return formatDate(date)
}

function mean(arr) {
  if (!arr.length) return null
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

// ── Budget forecast bucketing ──────────────────────────────────────────────────
function buildMonthlyBudget(predictions) {
  const buckets = {}
  for (let i = 0; i < 12; i++) {
    const m = addMonths(TODAY, i)
    buckets[monthKey(m)] = { label: monthLabel(m), cost: 0, count: 0, date: m }
  }
  for (const p of predictions) {
    const k = monthKey(p.due_date)
    if (buckets[k]) {
      buckets[k].cost += p.estimated_cost
      buckets[k].count++
    }
  }
  return Object.values(buckets)
}

// ── Site breakdown ─────────────────────────────────────────────────────────────
function buildSiteBreakdown(predictions, totalBudget) {
  const sites = {}
  for (const p of predictions) {
    if (!sites[p.site]) sites[p.site] = { site: p.site, due30: 0, due90: 0, due12mo: 0, cost: 0 }
    sites[p.site].due12mo++
    sites[p.site].cost += p.estimated_cost
    if (p.days_away <= 30) sites[p.site].due30++
    if (p.days_away <= 90) sites[p.site].due90++
  }
  return Object.values(sites)
    .sort((a, b) => b.cost - a.cost)
    .map(s => ({
      ...s,
      pct_budget: totalBudget > 0 ? ((s.cost / totalBudget) * 100).toFixed(1) : '0.0',
    }))
}

// ── Horizon filter helper ──────────────────────────────────────────────────────
function horizonDays(h) {
  if (h === '30d') return 30
  if (h === '90d') return 90
  if (h === '6mo') return 180
  return 365
}

// ── Chart options factories ────────────────────────────────────────────────────
function lineOpts(currency) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: CHART_DARK.color, font: { size: 11 } } },
      tooltip: {
        backgroundColor: 'var(--panel)',
        borderColor: 'var(--hairline)',
        borderWidth: 1,
        titleColor: '#f9fafb',
        bodyColor: '#9ca3af',
        callbacks: {
          label: ctx => ` ${currency} ${fmt(ctx.raw, 0)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: CHART_DARK.grid },
        ticks: { color: CHART_DARK.color, font: { size: 10 } },
      },
      y: {
        grid: { color: CHART_DARK.grid },
        ticks: {
          color: CHART_DARK.color,
          font: { size: 10 },
          callback: v => `${currency} ${fmt(v, 0)}`,
        },
        beginAtZero: true,
      },
    },
  }
}

function barOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'var(--panel)',
        borderColor: 'var(--hairline)',
        borderWidth: 1,
        titleColor: '#f9fafb',
        bodyColor: '#9ca3af',
        callbacks: {
          label: ctx => ` Count: ${ctx.raw}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: CHART_DARK.grid },
        ticks: { color: CHART_DARK.color, font: { size: 10 } },
      },
      y: {
        grid: { color: CHART_DARK.grid },
        ticks: { color: CHART_DARK.color, font: { size: 10 } },
        beginAtZero: true,
      },
    },
  }
}

// ── KPI Card component ─────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'blue', loading }) {
  const colorMap = {
    red:    { bg: 'bg-red-900/20 border-red-800/40',    icon: 'text-red-400',    val: 'text-red-300' },
    amber:  { bg: 'bg-amber-900/20 border-amber-800/40', icon: 'text-amber-400',  val: 'text-amber-300' },
    green:  { bg: 'bg-green-900/20 border-green-800/40', icon: 'text-green-400',  val: 'text-green-300' },
    blue:   { bg: 'bg-blue-900/20 border-blue-800/40',  icon: 'text-blue-400',   val: 'text-blue-300' },
    purple: { bg: 'bg-purple-900/20 border-purple-800/40', icon: 'text-purple-400', val: 'text-purple-300' },
    cyan:   { bg: 'bg-cyan-900/20 border-cyan-800/40',  icon: 'text-cyan-400',   val: 'text-cyan-300' },
  }
  const c = colorMap[color] || colorMap.blue
  return (
    <div className={`border rounded-xl p-4 flex gap-3 items-start ${c.bg}`}>
      <div className={`mt-0.5 ${c.icon}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[var(--text-muted)] leading-tight">{label}</p>
        {loading
          ? <div className="h-6 w-24 bg-[var(--input-bg)] rounded animate-pulse mt-1" />
          : <p className={`text-lg font-bold leading-tight mt-0.5 ${c.val}`}>{value}</p>
        }
        {sub && !loading && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Urgency badge ──────────────────────────────────────────────────────────────
function UrgencyBadge({ urgency }) {
  if (urgency === 'Urgent')  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-900/40 text-red-300 border border-red-800/50"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Urgent</span>
  if (urgency === 'Soon')    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-900/40 text-amber-300 border border-amber-800/50"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Soon</span>
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900/20 text-green-400 border border-green-800/40"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Monitor</span>
}

// ── Risk band badge ──────────────────────────────────────────────────────────
function RiskBandBadge({ band, score }) {
  const cls = RISK_BAND_STYLE[band] || RISK_BAND_STYLE.unknown
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {score != null ? score : '-'} · {band}
    </span>
  )
}

// ── Confidence pill ──────────────────────────────────────────────────────────
function ConfidenceBadge({ label, value }) {
  const map = {
    high:   'text-green-400 border-green-800/40 bg-green-900/15',
    medium: 'text-amber-300 border-amber-800/40 bg-amber-900/15',
    low:    'text-[var(--text-muted)] border-[var(--input-border)] bg-[var(--input-bg)]/40',
  }
  const cls = map[label] || map.low
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`} title={value != null ? `confidence ${Math.round(value * 100)}%` : ''}>
      <Gauge size={10} /> {label}
    </span>
  )
}

// ── Limiting-factor chip ─────────────────────────────────────────────────────
function LimitingFactorChip({ factor }) {
  if (!factor) return <span className="text-[var(--text-dim)]">-</span>
  const icon = factor === LIMITING_FACTORS.tread
    ? <TrendingDown size={11} />
    : factor === LIMITING_FACTORS.age
      ? <Clock size={11} />
      : <Activity size={11} />
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-blue-300 border border-blue-800/40 bg-blue-900/15">
      {icon} {LIMITING_FACTOR_LABEL[factor] || factor}
    </span>
  )
}

// ── Failure Risk panel (G3 composite risk + G4 cohort + G5 confidence) ───────
function FailureRiskPanel({
  rows, totalRows, kpis, cohortRows, siteFilter, setSiteFilter, uniqueSites,
  riskBandFilter, setRiskBandFilter, page, setPage, expanded, setExpanded,
}) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages)
  const paged = rows.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)

  const bandBarData = {
    labels: ['Extreme (≥70)', 'High (50-69)', 'Elevated (30-49)', 'Low (<30)'],
    datasets: [{
      data: [
        kpis.extreme,
        kpis.high,
        kpis.elevated,
        Math.max(0, kpis.total - kpis.extreme - kpis.high - kpis.elevated),
      ],
      backgroundColor: ['rgba(239,68,68,0.7)', 'rgba(249,115,22,0.7)', 'rgba(245,158,11,0.6)', 'rgba(16,185,129,0.5)'],
      borderColor: ['#ef4444', '#f97316', '#f59e0b', '#10b981'],
      borderWidth: 1,
      borderRadius: 4,
    }],
  }
  const bandBarOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw} tyres` } } },
    scales: {
      x: { grid: { color: CHART_DARK.grid }, ticks: { color: CHART_DARK.color, font: { size: 10 } } },
      y: { grid: { color: CHART_DARK.grid }, ticks: { color: CHART_DARK.color, font: { size: 10 } }, beginAtZero: true },
    },
  }

  return (
    <div className="space-y-4">
      {/* Risk KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard icon={ShieldAlert} label="Extreme risk (≥70)" value={`${fmt(kpis.extreme)} tyres`} sub="immediate action" color="red" />
        <KpiCard icon={AlertTriangle} label="High risk (50-69)" value={`${fmt(kpis.high)} tyres`} sub="inspect within 7 days" color="amber" />
        <KpiCard icon={Activity} label="Elevated (30-49)" value={`${fmt(kpis.elevated)} tyres`} sub="monitor closely" color="purple" />
        <KpiCard icon={Percent} label="Avg failure probability" value={`${fmt(kpis.avgFp, 1)}%`} sub="Weibull, brand-adjusted" color="cyan" />
        <KpiCard icon={Gauge} label="Avg composite risk" value={fmt(kpis.avgScore, 1)} sub={`${fmt(kpis.total)} assessed`} color="blue" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Band distribution */}
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Risk Band Distribution</h2>
            <p className="text-xs text-[var(--text-muted)]">Active tyres by composite risk score</p>
          </div>
          <div style={{ height: 220 }}><Bar data={bandBarData} options={bandBarOpts} /></div>
        </div>

        {/* Cohort models */}
        <div className="xl:col-span-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sigma size={15} className="text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Cohort Weibull Life Models</h2>
              <p className="text-xs text-[var(--text-muted)]">Method-of-moments fit per brand + size (≥5 completed lives)</p>
            </div>
          </div>
          {cohortRows.length === 0 ? (
            <div className="text-center py-8">
              <Target className="text-[var(--text-dim)] mx-auto mb-2" size={24} />
              <p className="text-[var(--text-muted)] text-xs">No cohort has ≥5 completed lives yet. Cohort survival appears once history accrues.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--input-border)]">
                    {['Brand','Size','Samples','η (km)','β shape','Mean life','CV','± CI'].map(h => (
                      <th key={h} className="text-left text-[var(--text-muted)] font-medium py-2 px-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cohortRows.map((c, i) => (
                    <tr key={`${c.brand}-${c.size}-${i}`} className="border-b border-[var(--input-border)]/40 hover:bg-[var(--input-bg)]/30">
                      <td className="py-2 px-2 text-[var(--text-secondary)] font-medium">{c.brand}</td>
                      <td className="py-2 px-2 text-[var(--text-muted)]">{c.size}</td>
                      <td className="py-2 px-2 text-center text-[var(--text-secondary)]">{c.n}</td>
                      <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{fmt(c.etaKm)}</td>
                      <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{c.beta}</td>
                      <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{fmt(c.meanKm)}</td>
                      <td className="py-2 px-2 text-right text-[var(--text-muted)]">{c.cv}</td>
                      <td className="py-2 px-2 text-right text-[var(--text-muted)]">±{c.ciSpread}pp</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)]">Site</label>
            <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}
              className="bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500">
              {uniqueSites.map(s => <option key={s} value={s}>{s === 'all' ? 'All Sites' : s}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)]">Risk band</label>
            <select value={riskBandFilter} onChange={e => setRiskBandFilter(e.target.value)}
              className="bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500">
              <option value="all">All bands</option>
              <option value="extreme">Extreme</option>
              <option value="high">High</option>
              <option value="elevated">Elevated</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 ml-auto justify-end">
            <p className="text-xs text-[var(--text-muted)] text-right">Showing</p>
            <p className="text-sm font-semibold text-[var(--text-secondary)] text-right">{fmt(rows.length)} of {fmt(totalRows)} tyres</p>
          </div>
        </div>
      </div>

      {/* Risk table */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Per-Tyre Failure Risk</h2>
          <p className="text-xs text-[var(--text-muted)]">Sorted by composite risk · click a row for the reasoning breakdown</p>
        </div>
        {rows.length === 0 ? (
          <div className="text-center py-10">
            <CheckCircle className="text-green-500 mx-auto mb-2" size={28} />
            <p className="text-[var(--text-muted)] text-sm">No tyres match the selected filters</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--input-border)]">
                    {['','Asset No','Site','Position','Brand','Size','Tread','Total KM','Failure Prob','Risk','Confidence'].map((h, i) => (
                      <th key={i} className="text-left text-[var(--text-muted)] font-medium py-2 px-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r, i) => {
                    const isOpen = expanded === r.id
                    return (
                      <Fragment key={`${r.id}-${i}`}>
                        <tr
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                          className={`border-b border-[var(--input-border)]/50 cursor-pointer transition-colors ${
                            r.risk_band === 'extreme' ? 'bg-red-900/10 hover:bg-red-900/20'
                              : r.risk_band === 'high' ? 'bg-orange-900/5 hover:bg-orange-900/15'
                                : 'hover:bg-[var(--input-bg)]/40'
                          }`}
                        >
                          <td className="py-2 px-2 text-[var(--text-muted)]">{isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</td>
                          <td className="py-2 px-2 font-mono font-semibold text-blue-300">{r.asset_no}</td>
                          <td className="py-2 px-2 text-[var(--text-secondary)]">{r.site}</td>
                          <td className="py-2 px-2 text-[var(--text-secondary)]">{r.position}</td>
                          <td className="py-2 px-2 text-[var(--text-secondary)]">{r.brand}</td>
                          <td className="py-2 px-2 text-[var(--text-muted)]">{r.size}</td>
                          <td className="py-2 px-2 text-center">
                            {r.tread_depth != null
                              ? <span className={`font-semibold ${r.tread_depth < URGENT_TREAD_MM ? 'text-red-400' : r.tread_depth < SOON_TREAD_MM ? 'text-amber-400' : 'text-green-400'}`}>{r.tread_depth}</span>
                              : <span className="text-[var(--text-dim)]">-</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{fmt(r.total_km)}</td>
                          <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{fmt(r.failure_prob_pct, 1)}%</td>
                          <td className="py-2 px-2"><RiskBandBadge band={r.risk_band} score={r.risk_score} /></td>
                          <td className="py-2 px-2"><ConfidenceBadge label={r.confidence_label} value={r.confidence} /></td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-[var(--input-bg)]/30 border-b border-[var(--input-border)]/50">
                            <td colSpan={11} className="p-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Risk factor breakdown */}
                                <div>
                                  <p className="text-xs font-semibold text-blue-300 mb-2">Composite risk breakdown (0-100)</p>
                                  <RiskFactorBar label="Mileage (Weibull ×40)" value={r.factors.mileage} max={40} />
                                  <RiskFactorBar label="Tread (≤30)" value={r.factors.tread} max={30} />
                                  <RiskFactorBar label={`Age (≤15)${r.age_has_data ? '' : ' · no data'}`} value={r.factors.age} max={15} muted={!r.age_has_data} />
                                  <RiskFactorBar label={`Pressure (≤15)${r.pressure_has_data ? '' : ' · no reading'}`} value={r.factors.pressure} max={15} muted={!r.pressure_has_data} />
                                </div>
                                {/* Weibull detail */}
                                <div className="text-xs space-y-1.5">
                                  <p className="text-xs font-semibold text-blue-300 mb-2">Reliability model</p>
                                  <DetailRow k="Failure probability" v={`${fmt(r.failure_prob_pct, 1)}%`} />
                                  <DetailRow k="Characteristic life η" v={`${fmt(r.eta_km)} km`} />
                                  <DetailRow k="Weibull shape β" v="2.2 (wear-out)" />
                                  <DetailRow k="In-service age" v={r.age_has_data ? `${fmt(r.age_days)} days` : 'unknown (no fitment date)'} />
                                  <DetailRow k="Pressure deviation" v={r.pressure_has_data ? `${fmt(r.pressure_dev_pct, 1)}% vs ${PRESSURE_TARGET_PSI} psi` : 'no reading'} />
                                </div>
                                {/* Cohort + confidence */}
                                <div className="text-xs space-y-1.5">
                                  <p className="text-xs font-semibold text-blue-300 mb-2">Cohort position & confidence</p>
                                  {r.cohort ? (
                                    <>
                                      <DetailRow k="Cohort survival" v={`${fmt(r.cohort.survivalPct, 1)}%`} />
                                      <DetailRow k="Percentile in cohort" v={`${fmt(r.cohort.percentileInCohort, 1)}%`} />
                                      <DetailRow k="Expected remaining" v={`${fmt(r.cohort.expectedRemainingKm)} km`} />
                                      <DetailRow k="Cohort samples" v={`${r.cohort.n} (±${fmt(r.cohort.ciSpread, 1)}pp)`} />
                                    </>
                                  ) : (
                                    <p className="text-[var(--text-muted)]">No fitted cohort (brand+size needs ≥5 completed lives).</p>
                                  )}
                                  <DetailRow k="Prediction confidence" v={`${r.confidence_label} (${Math.round((r.confidence ?? 0) * 100)}% · ${r.completed_samples} samples)`} />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--input-border)]">
                <p className="text-xs text-[var(--text-muted)]">Page {clampedPage} of {totalPages} · {fmt(rows.length)} total</p>
                <div className="flex gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={clampedPage === 1}
                    className="p-1.5 rounded bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronLeft size={14} />
                  </button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={clampedPage === totalPages}
                    className="p-1.5 rounded bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function RiskFactorBar({ label, value, max, muted }) {
  const pct = max > 0 ? Math.min(100, (Math.max(0, value) / max) * 100) : 0
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className={muted ? 'text-[var(--text-dim)]' : 'text-[var(--text-muted)]'}>{label}</span>
        <span className={muted ? 'text-[var(--text-dim)]' : 'text-[var(--text-secondary)]'}>{fmt(value, 1)}</span>
      </div>
      <div className="bg-[var(--input-bg)] rounded-full h-1.5">
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

// ── Main component ─────────────────────────────────────────────────────────────
export default function PredictiveMaintenance() {
  const { activeCurrency } = useSettings()

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
  const [currentPage, setCurrentPage]   = useState(1)

  const [riskBandFilter, setRiskBandFilter] = useState('all')
  const [riskPage, setRiskPage]         = useState(1)
  const [expandedRisk, setExpandedRisk] = useState(null)

  const [assumptionsOpen, setAssumptionsOpen] = useState(false)

  // ── Data loading ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Load tyre_records
      const { data: tyreData, error: tyreErr } = await fetchAllPages((from, to) => supabase
        .from('tyre_records')
        .select('id,asset_no,site,brand,size,tyre_serial,position,tread_depth,pressure_reading,total_km,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,fitment_date,removal_date,status,risk_level,category')
        .order('issue_date', { ascending: false })
        .range(from, to))

      if (tyreErr) throw tyreErr
      setRecords(tyreData || [])

      // Load vehicle_fleet (graceful if missing)
      try {
        const { data: fleetData, error: fleetErr } = await supabase
          .from('vehicle_fleet')
          .select('asset_no,site,vehicle_type,expected_km_per_tyre,monthly_tyre_budget,current_km')

        if (fleetErr) {
          setFleetMaster([])
          setFleetMasterAvailable(false)
        } else {
          setFleetMaster(fleetData || [])
          setFleetMasterAvailable(true)
        }
      } catch {
        setFleetMaster([])
        setFleetMasterAvailable(false)
      }
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load data'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Fleet-level computed constants (canonical lib) ───────────────────────────
  const fleetStats = useMemo(() => computeFleetStats(records), [records])

  // ── Cohort Weibull models (G4) — shared across engines ───────────────────────
  const cohortModels = useMemo(() => buildCohortModels(records), [records])

  // ── Predictions (deepened engine: G1 wear + G2 min-of-three + G3/G4/G5) ──────
  const allPredictions = useMemo(() => {
    if (!records.length) return []
    return buildPredictions(records, fleetMaster, {
      fleetAvgCost: fleetStats.avgCost,
      fleetAvgKmLife: fleetStats.avgKmLife,
      fleetAvgDailyKm: fleetStats.avgDailyKm,
      cohortModels,
      nowMs: TODAY.getTime(),
    })
  }, [records, fleetMaster, fleetStats, cohortModels])

  // ── Per-tyre failure-risk rows (G3 composite + G4 cohort + G5 confidence) ─────
  const failureRiskRows = useMemo(() => {
    if (!records.length) return []
    return buildFailureRiskRows(records, { cohortModels, nowMs: TODAY.getTime() })
  }, [records, cohortModels])

  // ── Derived lists ─────────────────────────────────────────────────────────────
  const uniqueSites = useMemo(() => {
    const s = new Set(allPredictions.map(p => p.site).filter(v => v && v !== '-'))
    for (const r of failureRiskRows) if (r.site && r.site !== '-') s.add(r.site)
    return ['all', ...Array.from(s).sort()]
  }, [allPredictions, failureRiskRows])

  const uniqueVehicleTypes = useMemo(() => {
    const t = new Set(fleetMaster.map(f => f.vehicle_type).filter(Boolean))
    return ['all', ...Array.from(t).sort()]
  }, [fleetMaster])

  // ── Filtered predictions ──────────────────────────────────────────────────────
  const filteredPredictions = useMemo(() => {
    const maxDays = horizonDays(horizonFilter)
    return allPredictions.filter(p => {
      if (siteFilter !== 'all' && p.site !== siteFilter) return false
      if (urgencyFilter !== 'all' && p.urgency !== urgencyFilter) return false
      if (vehicleTypeFilter !== 'all' && p.vehicle_type !== vehicleTypeFilter) return false
      if (p.days_away > maxDays) return false
      return true
    })
  }, [allPredictions, siteFilter, urgencyFilter, vehicleTypeFilter, horizonFilter])

  // ── Failure-risk filtering + KPIs ─────────────────────────────────────────────
  const filteredRisk = useMemo(() => {
    return failureRiskRows.filter(r => {
      if (siteFilter !== 'all' && r.site !== siteFilter) return false
      if (riskBandFilter !== 'all' && r.risk_band !== riskBandFilter) return false
      return true
    })
  }, [failureRiskRows, siteFilter, riskBandFilter])

  const riskKpis = useMemo(() => {
    const rows = failureRiskRows
    const extreme = rows.filter(r => r.risk_band === 'extreme').length
    const high = rows.filter(r => r.risk_band === 'high').length
    const elevated = rows.filter(r => r.risk_band === 'elevated').length
    const avgFp = rows.length ? mean(rows.map(r => r.failure_prob_pct)) : 0
    const avgScore = rows.length ? mean(rows.map(r => r.risk_score)) : 0
    return { total: rows.length, extreme, high, elevated, avgFp, avgScore }
  }, [failureRiskRows])

  const cohortRows = useMemo(() => {
    return Array.from(cohortModels.values())
      .map(m => ({
        brand: m.brand,
        size: m.size,
        n: m.n,
        etaKm: Math.round(m.eta),
        beta: Math.round(m.beta * 1000) / 1000,
        meanKm: Math.round(m.mean),
        cv: Math.round(m.cv * 100) / 100,
        ciSpread: Math.round(m.ciSpread * 10) / 10,
      }))
      .sort((a, b) => b.n - a.n)
  }, [cohortModels])

  // ── KPI summary ───────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const urgent = allPredictions.filter(p => p.urgency === 'Urgent')
    const soon   = allPredictions.filter(p => p.urgency === 'Soon')
    const monitor = allPredictions.filter(p => p.urgency === 'Monitor' && p.days_away <= 365)
    const yr12   = allPredictions.filter(p => p.days_away <= 365)

    const urgentCost  = urgent.reduce((s, p) => s + p.estimated_cost, 0)
    const soonCost    = soon.reduce((s, p) => s + p.estimated_cost, 0)
    const monitorCost = monitor.reduce((s, p) => s + p.estimated_cost, 0)
    const annualCost  = yr12.reduce((s, p) => s + p.estimated_cost, 0)

    return { urgent, soon, monitor, yr12, urgentCost, soonCost, monitorCost, annualCost }
  }, [allPredictions])

  // ── Monthly budget forecast (12 months) ───────────────────────────────────────
  const monthlyBudget = useMemo(() => buildMonthlyBudget(allPredictions), [allPredictions])

  const avgMonthlyFleetBudget = useMemo(() => {
    if (!fleetMaster.length) return null
    const budgets = fleetMaster.map(f => f.monthly_tyre_budget).filter(v => v > 0)
    return budgets.length > 0 ? budgets.reduce((s, v) => s + v, 0) : null
  }, [fleetMaster])

  // ── Site breakdown ────────────────────────────────────────────────────────────
  const siteBreakdown = useMemo(() => {
    const annual = allPredictions.filter(p => p.days_away <= 365)
    const totalCost = annual.reduce((s, p) => s + p.estimated_cost, 0)
    return buildSiteBreakdown(annual, totalCost)
  }, [allPredictions])

  // ── Quarterly forecasts ───────────────────────────────────────────────────────
  const quarterlyForecast = useMemo(() => {
    const q1 = monthlyBudget.slice(0, 3).reduce((s, m) => s + m.cost, 0)
    const q2 = monthlyBudget.slice(3, 6).reduce((s, m) => s + m.cost, 0)
    const h2 = monthlyBudget.slice(6, 12).reduce((s, m) => s + m.cost, 0)
    const total = q1 + q2 + h2
    return { q1, q2, h2, total }
  }, [monthlyBudget])

  // ── Top urgent vehicles ───────────────────────────────────────────────────────
  const urgentVehicles = useMemo(() => {
    const byAsset = {}
    for (const p of allPredictions) {
      if (!byAsset[p.asset_no]) {
        byAsset[p.asset_no] = {
          asset_no: p.asset_no,
          site: p.site,
          vehicle_type: p.vehicle_type,
          urgent_count: 0,
          soon_count: 0,
          total_cost: 0,
          min_days: p.days_away,
        }
      }
      byAsset[p.asset_no].total_cost += p.estimated_cost
      if (p.urgency === 'Urgent') byAsset[p.asset_no].urgent_count++
      if (p.urgency === 'Soon')   byAsset[p.asset_no].soon_count++
      if (p.days_away < byAsset[p.asset_no].min_days) byAsset[p.asset_no].min_days = p.days_away
    }
    return Object.values(byAsset)
      .filter(v => v.urgent_count > 0 || v.min_days <= SOON_DAYS)
      .sort((a, b) => b.urgent_count - a.urgent_count || a.min_days - b.min_days)
      .slice(0, 10)
      .map(v => ({
        ...v,
        recommended_action: v.urgent_count >= 3
          ? 'Schedule immediate full set replacement'
          : v.urgent_count >= 1
            ? 'Urgent inspection + prioritise replacement'
            : 'Schedule within 90 days',
      }))
  }, [allPredictions])

  // ── Pagination ────────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredPredictions.length / PAGE_SIZE))
  const pagedRows  = filteredPredictions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1) }, [siteFilter, urgencyFilter, vehicleTypeFilter, horizonFilter])
  useEffect(() => { setRiskPage(1) }, [siteFilter, riskBandFilter])

  // ── Chart data ────────────────────────────────────────────────────────────────
  const lineChartData = useMemo(() => {
    const labels = monthlyBudget.map(m => m.label)
    const costs  = monthlyBudget.map(m => m.cost)
    const datasets = [
      {
        label: 'Forecast Spend',
        data: costs,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#3b82f6',
        pointRadius: 4,
      },
    ]
    if (avgMonthlyFleetBudget) {
      datasets.push({
        label: 'Monthly Budget',
        data: labels.map(() => avgMonthlyFleetBudget),
        borderColor: '#10b981',
        borderDash: [6, 4],
        backgroundColor: 'transparent',
        pointRadius: 0,
        tension: 0,
      })
    }
    return { labels, datasets }
  }, [monthlyBudget, avgMonthlyFleetBudget])

  const urgencyBarData = useMemo(() => {
    return {
      labels: ['Urgent (≤30d)', 'Soon (31-90d)', 'Monitor (91-365d)'],
      datasets: [{
        data: [kpis.urgent.length, kpis.soon.length, kpis.monitor.length],
        backgroundColor: ['rgba(239,68,68,0.7)', 'rgba(245,158,11,0.7)', 'rgba(16,185,129,0.5)'],
        borderColor: ['#ef4444', '#f59e0b', '#10b981'],
        borderWidth: 1,
        borderRadius: 4,
      }],
    }
  }, [kpis])

  // ── Export handlers ───────────────────────────────────────────────────────────
  const handleExcelExport = useCallback(() => {
    const rows = filteredPredictions.map(p => ({
      ...p,
      due_date: fmtDate(p.due_date),
      estimated_cost: `${activeCurrency} ${p.estimated_cost}`,
      limiting_factor: LIMITING_FACTOR_LABEL[p.limiting_factor] || '-',
    }))
    exportToExcel(
      rows,
      ['asset_no','site','vehicle_type','position','brand','size','tread_depth','km_remaining','due_date','urgency','limiting_factor','confidence_label','risk_score','estimated_cost','days_away'],
      ['Asset No','Site','Vehicle Type','Position','Brand','Size','Tread Depth (mm)','KM Remaining','Due Date','Urgency','Limiting Factor','Confidence','Risk Score','Estimated Cost','Days Away'],
      `Predictive_Maintenance_${new Date().toISOString().slice(0,10)}`,
      'Upcoming Replacements',
    )
  }, [filteredPredictions, activeCurrency])

  const handlePdfExport = useCallback((opts = {}) => {
    const rows = filteredPredictions.slice(0, 500).map(p => ({
      ...p,
      due_date: fmtDate(p.due_date),
      estimated_cost: `${activeCurrency} ${fmt(p.estimated_cost, 0)}`,
      tread_depth: p.tread_depth != null ? `${p.tread_depth} mm` : '-',
      limiting_factor: LIMITING_FACTOR_LABEL[p.limiting_factor] || '-',
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
      `Predictive_Maintenance_${new Date().toISOString().slice(0,10)}`,
      'landscape',
      '',
      opts,
    )
  }, [filteredPredictions, activeCurrency])

  const handleRiskExport = useCallback(() => {
    const rows = filteredRisk.map(r => ({
      ...r,
      failure_prob_pct: `${fmt(r.failure_prob_pct, 1)}%`,
      cohort_survival: r.cohort ? `${fmt(r.cohort.survivalPct, 1)}%` : '-',
    }))
    exportToExcel(
      rows,
      ['asset_no','site','position','brand','size','tread_depth','total_km','eta_km','failure_prob_pct','risk_score','risk_band','confidence_label','completed_samples','cohort_survival'],
      ['Asset No','Site','Position','Brand','Size','Tread (mm)','Total KM','Eta (km)','Failure Prob','Risk Score','Risk Band','Confidence','Samples','Cohort Survival'],
      `Predictive_Failure_Risk_${new Date().toISOString().slice(0,10)}`,
      'Failure Risk',
    )
  }, [filteredRisk])

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface-1)] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-[var(--text-muted)] text-sm">Loading predictive maintenance data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--surface-1)] flex items-center justify-center">
        <div className="bg-[var(--surface-1)] border border-red-800/50 rounded-xl p-8 max-w-md text-center space-y-3">
          <AlertTriangle className="text-red-400 mx-auto" size={32} />
          <p className="text-red-300 font-semibold">Failed to load data</p>
          <p className="text-[var(--text-muted)] text-sm">{error}</p>
          <button onClick={loadData} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const hasAnyData = allPredictions.length > 0 || failureRiskRows.length > 0

  return (
    <div className="space-y-6">

      <PageHeader
        title="Predictive Maintenance Engine"
        subtitle={`AI-powered tyre replacement forecasting, failure-risk scoring and budget planning · ${fmtDate(TODAY)}`}
        icon={CalendarClock}
        onRefresh={loadData}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {!fleetMasterAvailable && (
              <span className="text-xs text-amber-400 border border-amber-800/40 bg-amber-900/20 px-2 py-1 rounded-lg">
                Fleet master unavailable, using tyre records only
              </span>
            )}
            {activeTab === 'forecast' ? (
              <>
                <button onClick={handleExcelExport} className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5">
                  <Download size={14} /> Excel
                </button>
                <button onClick={() => handlePdfExport()} className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5">
                  <FileText size={14} /> PDF
                </button>
                <EmailPdfButton
                  className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5"
                  getPdf={async () => ({
                    base64: await handlePdfExport({ returnBase64: true }),
                    filename: `Predictive_Maintenance_${new Date().toISOString().slice(0,10)}.pdf`,
                    subject: 'Predictive Maintenance',
                    bodyHtml: '<p>Attached is the Predictive Maintenance report.</p>',
                  })}
                />
              </>
            ) : (
              <button onClick={handleRiskExport} className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5">
                <Download size={14} /> Export Risk
              </button>
            )}
          </div>
        }
      />

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!hasAnyData && (
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-12 text-center">
          <CalendarClock className="text-[var(--text-dim)] mx-auto mb-3" size={40} />
          <p className="text-[var(--text-secondary)] font-semibold">No active tyre records found</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">Upload tyre fitment data to generate replacement forecasts</p>
        </div>
      )}

      {/* ── Tab switcher ────────────────────────────────────────────────────── */}
      {hasAnyData && (
        <div className="flex items-center gap-1 border-b border-[var(--input-border)]">
          {[
            { key: 'forecast', label: 'Replacement Forecast', icon: CalendarClock, count: allPredictions.length },
            { key: 'risk', label: 'Failure Risk', icon: ShieldAlert, count: failureRiskRows.length },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t.key
                  ? 'border-blue-500 text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <t.icon size={15} /> {t.label}
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--input-bg)] text-[var(--text-muted)]">{fmt(t.count)}</span>
            </button>
          ))}
        </div>
      )}

      {activeTab === 'forecast' && allPredictions.length === 0 && failureRiskRows.length > 0 && (
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-10 text-center">
          <CalendarClock className="text-[var(--text-dim)] mx-auto mb-3" size={36} />
          <p className="text-[var(--text-secondary)] font-semibold">No active replacement forecasts</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">Switch to the Failure Risk tab to review scored tyres.</p>
        </div>
      )}

      {activeTab === 'forecast' && allPredictions.length > 0 && (
        <>
          {/* ── KPI Strip ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard
              icon={AlertTriangle}
              label="Replacements due ≤30 days"
              value={`${fmt(kpis.urgent.length)} tyres`}
              sub={fmtCurrency(kpis.urgentCost, activeCurrency)}
              color="red"
            />
            <KpiCard
              icon={Clock}
              label="Replacements due 31-90 days"
              value={`${fmt(kpis.soon.length)} tyres`}
              sub={fmtCurrency(kpis.soonCost, activeCurrency)}
              color="amber"
            />
            <KpiCard
              icon={CheckCircle}
              label="Replacements due 91-365 days"
              value={`${fmt(kpis.monitor.length)} tyres`}
              sub={fmtCurrency(kpis.monitorCost, activeCurrency)}
              color="green"
            />
            <KpiCard
              icon={DollarSign}
              label="12-month budget forecast"
              value={fmtCurrency(kpis.annualCost, activeCurrency)}
              sub={`${fmt(kpis.yr12.length)} replacements`}
              color="blue"
            />
            <KpiCard
              icon={TrendingUp}
              label="Fleet avg tyre life"
              value={`${fmt(fleetStats.avgKmLife, 0)} km`}
              sub="based on completed records"
              color="purple"
            />
            <KpiCard
              icon={Truck}
              label="Fleet avg daily km / vehicle"
              value={`${fmt(fleetStats.avgDailyKm, 0)} km`}
              sub="estimated from records"
              color="cyan"
            />
          </div>

          {/* ── Filters ────────────────────────────────────────────────────── */}
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter size={14} className="text-[var(--text-muted)]" />
              <span className="text-sm font-medium text-[var(--text-secondary)]">Filters</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {/* Site */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-muted)]">Site</label>
                <select
                  value={siteFilter}
                  onChange={e => setSiteFilter(e.target.value)}
                  className="bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                >
                  {uniqueSites.map(s => (
                    <option key={s} value={s}>{s === 'all' ? 'All Sites' : s}</option>
                  ))}
                </select>
              </div>

              {/* Urgency */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-muted)]">Urgency</label>
                <select
                  value={urgencyFilter}
                  onChange={e => setUrgencyFilter(e.target.value)}
                  className="bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All Urgencies</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Soon">Soon</option>
                  <option value="Monitor">Monitor</option>
                </select>
              </div>

              {/* Vehicle type */}
              {uniqueVehicleTypes.length > 1 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-[var(--text-muted)]">Vehicle Type</label>
                  <select
                    value={vehicleTypeFilter}
                    onChange={e => setVehicleTypeFilter(e.target.value)}
                    className="bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                  >
                    {uniqueVehicleTypes.map(t => (
                      <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Horizon */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-muted)]">Horizon</label>
                <div className="flex gap-1">
                  {['30d','90d','6mo','12mo'].map(h => (
                    <button
                      key={h}
                      onClick={() => setHorizonFilter(h)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        horizonFilter === h
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)] hover:bg-[var(--input-bg-hover)]'
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>

              {/* Result count */}
              <div className="flex flex-col gap-1 ml-auto justify-end">
                <p className="text-xs text-[var(--text-muted)] text-right">Showing</p>
                <p className="text-sm font-semibold text-[var(--text-secondary)] text-right">{fmt(filteredPredictions.length)} replacements</p>
              </div>
            </div>
          </div>

          {/* ── Charts row ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Budget forecast line chart */}
            <div className="xl:col-span-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">12-Month Budget Forecast</h2>
                <p className="text-xs text-[var(--text-muted)]">Forecasted tyre replacement spend by month</p>
              </div>
              <div style={{ height: 240 }}>
                <Line data={lineChartData} options={lineOpts(activeCurrency)} />
              </div>
            </div>

            {/* Urgency bar chart */}
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Replacement Urgency Distribution</h2>
                <p className="text-xs text-[var(--text-muted)]">Active tyres by urgency horizon</p>
              </div>
              <div style={{ height: 240 }}>
                <Bar data={urgencyBarData} options={barOpts()} />
              </div>
            </div>
          </div>

          {/* ── Quarterly forecast cards ────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Q1 Forecast (Months 1-3)',  value: quarterlyForecast.q1,    color: 'from-blue-900/30 to-blue-800/10 border-blue-800/40' },
              { label: 'Q2 Forecast (Months 4-6)',  value: quarterlyForecast.q2,    color: 'from-purple-900/30 to-purple-800/10 border-purple-800/40' },
              { label: 'H2 Forecast (Months 7-12)', value: quarterlyForecast.h2,    color: 'from-cyan-900/30 to-cyan-800/10 border-cyan-800/40' },
              { label: 'Annual Total',               value: quarterlyForecast.total, color: 'from-green-900/30 to-green-800/10 border-green-800/40' },
            ].map(card => (
              <div key={card.label} className={`bg-gradient-to-br ${card.color} border rounded-xl p-4`}>
                <p className="text-xs text-[var(--text-muted)]">{card.label}</p>
                <p className="text-lg font-bold text-[var(--text-primary)] mt-1">{fmtCurrency(card.value, activeCurrency)}</p>
              </div>
            ))}
          </div>

          {/* ── Upcoming Replacements Table ────────────────────────────────── */}
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming Replacements Calendar</h2>
                <p className="text-xs text-[var(--text-muted)]">{fmt(filteredPredictions.length)} records · sorted by due date</p>
              </div>
            </div>

            {filteredPredictions.length === 0 ? (
              <div className="text-center py-10">
                <CheckCircle className="text-green-500 mx-auto mb-2" size={28} />
                <p className="text-[var(--text-muted)] text-sm">No replacements due within selected horizon and filters</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--input-border)]">
                        {['Asset No','Site','Type','Position','Brand','Tread (mm)','KM Remaining','Due Date','Urgency','Limiting Factor','Confidence','Est. Cost','Days Away'].map(h => (
                          <th key={h} className="text-left text-[var(--text-muted)] font-medium py-2 px-2 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRows.map((p, i) => (
                        <tr
                          key={`${p.id}-${i}`}
                          className={`border-b border-[var(--input-border)]/50 transition-colors ${
                            p.urgency === 'Urgent'
                              ? 'bg-red-900/10 hover:bg-red-900/20'
                              : p.urgency === 'Soon'
                                ? 'bg-amber-900/5 hover:bg-amber-900/15'
                                : 'hover:bg-[var(--input-bg)]/40'
                          }`}
                        >
                          <td className="py-2 px-2 font-mono font-semibold text-blue-300">{p.asset_no}</td>
                          <td className="py-2 px-2 text-[var(--text-secondary)]">{p.site}</td>
                          <td className="py-2 px-2 text-[var(--text-muted)]">{p.vehicle_type}</td>
                          <td className="py-2 px-2 text-[var(--text-secondary)]">{p.position}</td>
                          <td className="py-2 px-2 text-[var(--text-secondary)]">{p.brand}</td>
                          <td className="py-2 px-2 text-center">
                            {p.tread_depth != null
                              ? <span className={`font-semibold ${p.tread_depth < URGENT_TREAD_MM ? 'text-red-400' : p.tread_depth < SOON_TREAD_MM ? 'text-amber-400' : 'text-green-400'}`}>{p.tread_depth}</span>
                              : <span className="text-[var(--text-dim)]">-</span>
                            }
                          </td>
                          <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{fmt(p.km_remaining)}</td>
                          <td className="py-2 px-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(p.due_date)}</td>
                          <td className="py-2 px-2"><UrgencyBadge urgency={p.urgency} /></td>
                          <td className="py-2 px-2"><LimitingFactorChip factor={p.limiting_factor} /></td>
                          <td className="py-2 px-2"><ConfidenceBadge label={p.confidence_label} value={p.confidence} /></td>
                          <td className="py-2 px-2 text-right font-semibold text-[var(--text-secondary)]">{fmtCurrency(p.estimated_cost, activeCurrency)}</td>
                          <td className="py-2 px-2 text-right">
                            <span className={`font-semibold ${p.days_away <= 30 ? 'text-red-400' : p.days_away <= 90 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
                              {p.days_away}d
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--input-border)]">
                    <p className="text-xs text-[var(--text-muted)]">
                      Page {currentPage} of {totalPages} · {fmt(filteredPredictions.length)} total
                    </p>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-1.5 rounded bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                        let page
                        if (totalPages <= 7) {
                          page = i + 1
                        } else if (currentPage <= 4) {
                          page = i + 1
                          if (i === 6) page = totalPages
                        } else if (currentPage >= totalPages - 3) {
                          page = totalPages - 6 + i
                        } else {
                          const offsets = [-3, -2, -1, 0, 1, 2, 3]
                          page = currentPage + offsets[i]
                        }
                        return (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                              currentPage === page
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg-hover)]'
                            }`}
                          >
                            {page}
                          </button>
                        )
                      })}
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-1.5 rounded bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Site Breakdown Table ────────────────────────────────────────── */}
          {siteBreakdown.length > 0 && (
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Site Breakdown: 12-Month Forecast</h2>
                <p className="text-xs text-[var(--text-muted)]">Replacement demand and budget allocation by site</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--input-border)]">
                      {['Site','Due ≤30d','Due ≤90d','Due ≤12mo','Forecast Cost','% of Budget'].map(h => (
                        <th key={h} className="text-left text-[var(--text-muted)] font-medium py-2 px-3 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {siteBreakdown.map((s) => (
                      <tr key={s.site} className="border-b border-[var(--input-border)]/40 hover:bg-[var(--input-bg)]/30 transition-colors">
                        <td className="py-2 px-3 font-semibold text-[var(--text-secondary)]">{s.site}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-semibold ${s.due30 > 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>{s.due30}</span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-semibold ${s.due90 > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{s.due90}</span>
                        </td>
                        <td className="py-2 px-3 text-center text-[var(--text-secondary)]">{s.due12mo}</td>
                        <td className="py-2 px-3 text-right font-semibold text-[var(--text-secondary)]">{fmtCurrency(s.cost, activeCurrency)}</td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-[var(--input-bg)] rounded-full h-1.5">
                              <div
                                className="bg-blue-500 h-1.5 rounded-full"
                                style={{ width: `${Math.min(100, parseFloat(s.pct_budget))}%` }}
                              />
                            </div>
                            <span className="text-[var(--text-muted)] w-10 text-right">{s.pct_budget}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Vehicles Needing Immediate Attention ───────────────────────── */}
          {urgentVehicles.length > 0 && (
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="text-red-400" size={16} />
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">Vehicles Needing Immediate Attention</h2>
                  <p className="text-xs text-[var(--text-muted)]">Top 10 vehicles with highest urgent replacement count</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--input-border)]">
                      {['#','Asset No','Site','Type','Urgent','Soon','Forecast Cost','Recommended Action'].map(h => (
                        <th key={h} className="text-left text-[var(--text-muted)] font-medium py-2 px-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {urgentVehicles.map((v, i) => (
                      <tr key={v.asset_no} className="border-b border-[var(--input-border)]/40 hover:bg-[var(--input-bg)]/30 transition-colors">
                        <td className="py-2 px-2 text-[var(--text-muted)]">{i + 1}</td>
                        <td className="py-2 px-2 font-mono font-semibold text-blue-300">{v.asset_no}</td>
                        <td className="py-2 px-2 text-[var(--text-secondary)]">{v.site}</td>
                        <td className="py-2 px-2 text-[var(--text-muted)]">{v.vehicle_type}</td>
                        <td className="py-2 px-2 text-center">
                          {v.urgent_count > 0
                            ? <span className="px-1.5 py-0.5 bg-red-900/40 text-red-300 rounded font-bold">{v.urgent_count}</span>
                            : <span className="text-[var(--text-dim)]">0</span>
                          }
                        </td>
                        <td className="py-2 px-2 text-center">
                          {v.soon_count > 0
                            ? <span className="px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded font-bold">{v.soon_count}</span>
                            : <span className="text-[var(--text-dim)]">0</span>
                          }
                        </td>
                        <td className="py-2 px-2 text-right font-semibold text-[var(--text-secondary)]">{fmtCurrency(v.total_cost, activeCurrency)}</td>
                        <td className="py-2 px-2 text-[var(--text-muted)] italic">{v.recommended_action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Assumptions & Methodology ───────────────────────────────────── */}
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
            <button
              onClick={() => setAssumptionsOpen(o => !o)}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--input-bg)]/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Info className="text-blue-400" size={16} />
                <span className="text-sm font-medium text-[var(--text-secondary)]">Prediction Model Assumptions & Methodology</span>
              </div>
              {assumptionsOpen ? <ChevronUp size={16} className="text-[var(--text-muted)]" /> : <ChevronDown size={16} className="text-[var(--text-muted)]" />}
            </button>
            {assumptionsOpen && (
              <div className="px-4 pb-4 border-t border-[var(--input-border)]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  {[
                    {
                      title: 'G1 · Tread Wear Rate',
                      body: `Wear rate (mm/km) = (nominal new tread − current tread) ÷ lifetime km, clamped to a physical range. Nominal new tread is a documented size-class value (heavy-commercial ${fmt(DEFAULT_NEW_TREAD_MM, 0)}mm, light ~9mm) because this dataset has no per-tyre initial reading or inspection time-series. Days-to-limit projects tread to the ${LEGAL_MIN_TREAD_MM}mm legal minimum.`,
                    },
                    {
                      title: 'G2 · Min-of-Three Forecast',
                      body: `Days-to-replace = min(tread-wear, km-lifecycle, age). Km-lifecycle uses avg tyre life (${fmt(fleetStats.avgKmLife, 0)} km fallback) ÷ daily km. Age is measured from fitment_date to the ${MAX_AGE_YEARS}yr GCC guideline — an APPROXIMATION, as pre-fitment shelf age is unknown (no manufacture_date). The limiting-factor column shows which bound wins.`,
                    },
                    {
                      title: 'G3 · Weibull Failure Risk',
                      body: `Reliability R(t)=exp(−(km/η)^2.2) with a brand η table (Michelin 135k … default 110k km). Composite 0–100 risk = failure-prob×40 + tread(≤30) + age(≤15) + pressure(≤15). Pressure uses the single ${PRESSURE_TARGET_PSI} psi deviation only (no TPMS series) and is flagged when absent — never fabricated.`,
                    },
                    {
                      title: 'G4 · Cohort Life Distribution',
                      body: 'Completed lives (km_at_removal − km_at_fitment) are grouped by brand+size; cohorts with ≥5 samples get a method-of-moments Weibull fit (β from CV, η = mean/Γ(1+1/β)). Gives survival %, cohort percentile and expected remaining km for each active tyre.',
                    },
                    {
                      title: 'G5 · Confidence',
                      body: 'Per-asset confidence = min(1, completed samples ÷ 6). Cohort CI half-width = 30/√n (±3–35pp). Attached to every prediction and risk row so thin-history estimates are labelled, not overstated.',
                    },
                    {
                      title: 'Cost & Fleet Master',
                      body: `${fleetMasterAvailable ? 'vehicle_fleet loaded — expected km/tyre, current_km and budgets used.' : 'vehicle_fleet unavailable — tyre_records history only.'} Cost uses the tyre's cost_per_tyre, else asset mean, else fleet average (${fmtCurrency(fleetStats.avgCost, activeCurrency)}). No fabricated costs.`,
                    },
                  ].map(item => (
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
          </div>
        </>
      )}

      {/* ── Failure Risk tab ────────────────────────────────────────────────── */}
      {activeTab === 'risk' && (
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
          page={riskPage}
          setPage={setRiskPage}
          expanded={expandedRisk}
          setExpanded={setExpandedRisk}
        />
      )}
    </div>
  )
}
