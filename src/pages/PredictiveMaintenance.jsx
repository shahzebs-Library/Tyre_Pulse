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
  TrendingDown, Search, X,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
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
          .select('asset_no,site,vehicle_type,expected_km_per_tyre,monthly_tyre_budget,current_km')
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
    { id: 'estimated_cost', header: 'Est. cost', accessorKey: 'estimated_cost', meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{fmtCurrency(getValue(), activeCurrency)}</span> },
    { id: 'days_away', header: 'Days away', accessorKey: 'days_away', meta: { align: 'right' },
      cell: ({ getValue }) => {
        const d = getValue()
        const cls = d <= URGENT_DAYS ? 'text-red-400' : d <= SOON_DAYS ? 'text-amber-400' : 'text-[var(--text-muted)]'
        return <span className={`font-semibold tabular-nums ${cls}`}>{d != null ? `${d}d` : 'N/A'}</span>
      } },
  ], [activeCurrency])

  const siteColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorKey: 'site', cell: ({ getValue }) => <span className="font-semibold">{getValue()}</span> },
    { id: 'due30', header: `Due ${URGENT_DAYS}d`, accessorKey: 'due30', meta: { align: 'right' }, cell: ({ getValue }) => <span className={`tabular-nums font-semibold ${getValue() > 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>{getValue()}</span> },
    { id: 'due90', header: `Due ${SOON_DAYS}d`, accessorKey: 'due90', meta: { align: 'right' }, cell: ({ getValue }) => <span className={`tabular-nums font-semibold ${getValue() > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{getValue()}</span> },
    { id: 'due12mo', header: 'Due 12mo', accessorKey: 'due12mo', meta: { align: 'right' } },
    { id: 'cost', header: 'Forecast cost', accessorKey: 'cost', meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{fmtCurrency(getValue(), activeCurrency)}</span> },
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
  ], [activeCurrency])

  const vehicleColumns = useMemo(() => [
    { id: 'rank', header: '#', accessorKey: 'rank', meta: { align: 'right' } },
    { id: 'asset_no', header: 'Asset No', accessorKey: 'asset_no', cell: ({ getValue }) => <span className="font-mono font-semibold text-blue-300">{getValue()}</span> },
    { id: 'site', header: 'Site', accessorKey: 'site' },
    { id: 'vehicle_type', header: 'Type', accessorKey: 'vehicle_type' },
    { id: 'urgent_count', header: 'Urgent', accessorKey: 'urgent_count', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() > 0 ? <span className="px-1.5 py-0.5 bg-red-900/40 text-red-300 rounded font-bold tabular-nums">{getValue()}</span> : <span className="text-[var(--text-dim)]">0</span>) },
    { id: 'soon_count', header: 'Soon', accessorKey: 'soon_count', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() > 0 ? <span className="px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded font-bold tabular-nums">{getValue()}</span> : <span className="text-[var(--text-dim)]">0</span>) },
    { id: 'total_cost', header: 'Forecast cost', accessorKey: 'total_cost', meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{fmtCurrency(getValue(), activeCurrency)}</span> },
    { id: 'recommended_action', header: 'Recommended action', accessorKey: 'recommended_action' },
  ], [activeCurrency])

  // ── Export handlers ───────────────────────────────────────────────────────────
  const stamp = todayStamp(now)
  const forecastFile = reportFileName('Predictive Maintenance', stamp)
  const riskFile = reportFileName('Predictive Failure Risk', stamp)

  const handleExcelExport = useCallback(() => {
    const rows = filteredPredictions.map((p) => ({
      ...p,
      due_date: fmtDate(p.due_date),
      estimated_cost: `${activeCurrency} ${p.estimated_cost}`,
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
  }, [filteredPredictions, activeCurrency, forecastFile])

  // A landscape A4 page holds ~30 of these rows, so 500 is already ~17 pages and
  // the whole document is built in memory. The cap stays; the header says when
  // it bites instead of reading as the whole filtered forecast.
  const PDF_ROW_CAP = 500

  const handlePdfExport = useCallback((opts = {}) => {
    const rows = filteredPredictions.slice(0, PDF_ROW_CAP).map((p) => ({
      ...p,
      due_date: fmtDate(p.due_date),
      estimated_cost: fmtCurrency(p.estimated_cost, activeCurrency),
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
  }, [filteredPredictions, activeCurrency, forecastFile])

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
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" aria-hidden="true" />
          <p className="text-[var(--text-muted)] text-sm">Loading predictive maintenance data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24">
        <div role="alert" className="bg-[var(--surface-1)] border border-red-800/50 rounded-xl p-8 max-w-md text-center space-y-3">
          <AlertTriangle className="text-red-400 mx-auto" size={32} aria-hidden="true" />
          <p className="text-red-300 font-semibold">Predictive maintenance data could not be loaded</p>
          <p className="text-[var(--text-muted)] text-sm">{error}</p>
          <p className="text-[var(--text-muted)] text-xs">No forecast is shown, because a failed read is not the same as no replacements due.</p>
          <button type="button" onClick={loadData}
            className="min-h-[44px] px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const hasAnyData = allPredictions.length > 0 || failureRiskRows.length > 0
  const tabs = [
    { key: 'forecast', label: 'Replacement Forecast', icon: CalendarClock, count: allPredictions.length },
    { key: 'risk', label: 'Failure Risk', icon: ShieldAlert, count: failureRiskRows.length },
  ]

  return (
    <div className="space-y-6 min-w-0">

      <PageHeader
        title="Predictive Maintenance Engine"
        subtitle={`Tyre replacement forecasting, failure-risk scoring and budget planning | ${fmtDate(now)}`}
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
                <button type="button" onClick={handleExcelExport} disabled={!filteredPredictions.length} className={BTN_CLS}>
                  <Download size={14} aria-hidden="true" /> Excel
                </button>
                <button type="button" onClick={() => handlePdfExport()} disabled={!filteredPredictions.length} className={BTN_CLS}>
                  <FileText size={14} aria-hidden="true" /> PDF
                </button>
                <EmailPdfButton
                  className={BTN_CLS}
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
                <button type="button" onClick={handleRiskExcel} disabled={!filteredRisk.length} className={BTN_CLS}>
                  <Download size={14} aria-hidden="true" /> Excel
                </button>
                <button type="button" onClick={() => handleRiskPdf()} disabled={!filteredRisk.length} className={BTN_CLS}>
                  <FileText size={14} aria-hidden="true" /> PDF
                </button>
              </>
            )}
          </div>
        }
      />

      {activeCountry === 'All' && hasAnyData && (
        <div className="flex items-start gap-2 text-xs text-amber-400/90 bg-amber-900/15 border border-amber-800/40 rounded-lg px-3 py-2">
          <Info size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>Showing all countries. Cost and budget figures span multiple currencies (SAR, AED, EGP) and are not a single-currency total. Select a country to see figures in that country's currency.</span>
        </div>
      )}

      {!hasAnyData && (
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-12 text-center">
          <CalendarClock className="text-[var(--text-dim)] mx-auto mb-3" size={40} aria-hidden="true" />
          <p className="text-[var(--text-secondary)] font-semibold">No active tyre records found</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">Upload tyre fitment data to generate replacement forecasts.</p>
        </div>
      )}

      {hasAnyData && (
        <div role="tablist" aria-label="Predictive maintenance views" className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`pm-tab-${t.key}`}
              aria-selected={activeTab === t.key}
              aria-controls={`pm-panel-${t.key}`}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-2 px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                activeTab === t.key
                  ? 'border-blue-500 text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <t.icon size={15} aria-hidden="true" /> {t.label}
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--input-bg)] text-[var(--text-muted)] tabular-nums">{fmt(t.count)}</span>
            </button>
          ))}
        </div>
      )}

      {hasAnyData && activeTab === 'forecast' && (
        <div role="tabpanel" id="pm-panel-forecast" aria-labelledby="pm-tab-forecast" className="space-y-6">
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
                <KpiCard icon={AlertTriangle} label={`Replacements due in ${URGENT_DAYS} days`} value={`${fmt(kpis.urgentCount)} tyres`} sub={fmtCurrency(kpis.urgentCost, activeCurrency)} color="red" />
                <KpiCard icon={Clock} label={`Replacements due 31 to ${SOON_DAYS} days`} value={`${fmt(kpis.soonCount)} tyres`} sub={fmtCurrency(kpis.soonCost, activeCurrency)} color="amber" />
                <KpiCard icon={CheckCircle} label="Replacements due 91 to 365 days" value={`${fmt(kpis.monitorCount)} tyres`} sub={fmtCurrency(kpis.monitorCost, activeCurrency)} color="green" />
                <KpiCard icon={DollarSign} label="12-month budget forecast" value={fmtCurrency(kpis.annualCost, activeCurrency)} sub={`${fmt(kpis.yearCount)} replacements`} color="blue" />
                <KpiCard icon={TrendingUp} label="Fleet avg tyre life" value={fleetStats.avgKmLife != null ? `${fmt(fleetStats.avgKmLife, 0)} km` : 'N/A'} sub="Based on completed records" color="purple" />
                <KpiCard icon={Truck} label="Fleet avg daily km per vehicle" value={fleetStats.avgDailyKm != null ? `${fmt(fleetStats.avgDailyKm, 0)} km` : 'N/A'} sub="Estimated from records" color="cyan" />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 min-w-0">
                  <Panel title="12-Month Budget Forecast" subtitle="Forecast tyre replacement spend by month">
                    <div style={{ height: 240 }} role="img"
                      aria-label={`12-month replacement spend forecast totalling ${fmtCurrency(quarterly.total, activeCurrency)}`}>
                      <Line data={lineChartData} options={lineOpts(activeCurrency)} />
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
                    <p className="text-lg font-bold text-[var(--text-primary)] mt-1 tabular-nums">{fmtCurrency(card.value, activeCurrency)}</p>
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
                          body: `${fleetMasterAvailable ? 'vehicle_fleet loaded: expected km/tyre, current_km and budgets used.' : 'vehicle_fleet unavailable, tyre_records history only.'} Cost uses the tyre's cost_per_tyre, else asset mean, else fleet average (${fmtCurrency(fleetStats.avgCost, activeCurrency)}). No fabricated costs.`,
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
        <div role="tabpanel" id="pm-panel-risk" aria-labelledby="pm-tab-risk">
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
    </div>
  )
}
