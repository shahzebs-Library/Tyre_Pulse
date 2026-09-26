// ─────────────────────────────────────────────────────────────────────────────
// ExecutiveReport.jsx - Executive Intelligence Report · /executive-report
// Full management-ready report: 7 mandatory sections.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  FileText, Download, Printer, FileSpreadsheet,
  TrendingUp, TrendingDown, Minus, AlertTriangle,
  ShieldAlert, DollarSign, BarChart2, Target,
  Zap, CheckCircle, XCircle, Clock, Activity,
  Building2, Wrench, Star, AlertOctagon,
  Award, Package, Users, Mail, RefreshCw,
  ScrollText, Presentation,
  Settings2, Plus, Eye, EyeOff, X, ArrowUp, ArrowDown,
  Trash2, GripVertical, RotateCcw, StickyNote, SeparatorHorizontal,
  LayoutList, Layers,
} from 'lucide-react'
import { executiveReport } from '../lib/api'
import { toUserMessage } from '../lib/safeError'
import EmailReportModal from '../components/EmailReportModal'
import {
  computeAllKpis,
  computeCostTrend,
  computeVendorPerformance,
  computeFailureRate,
} from '../lib/kpiEngine'
import { useSettings } from '../contexts/SettingsContext'
import { applyCountry } from '../lib/countryFilter'
import { formatDate } from '../lib/formatters'

import { recordCost } from '../lib/analyticsEngine'
import { loadGovernedCostSplit, COST_SPLIT_TTL_MS } from '../lib/api/governedCost'
import { COST_MODES, pickCost, costModeLabel, pickMonthly, splitTotals } from '../lib/costSources'
import { resolveReportTyreSpend, spendShare, spendWindow, distinctCountries } from '../lib/executiveSpend'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { captureChartOnPaper, paperChartOptions } from '../lib/chartCapture'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import PageHeader from '../components/ui/PageHeader'
import YearlyTrendPanel from '../components/expense/YearlyTrendPanel'
import PeriodFilter, { filterByPeriodValue, periodLabel as periodValueLabel } from '../components/ui/PeriodFilter'
import { loadAutoTable } from '../lib/pdfEngine'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  fmtCurrency, fmtNum, fmtPct, fmtRatio, fmtCpk, withUnit,
  statusLabel, cpkStatus, pctStatus, lowerIsBetter, higherIsBetter,
  periodBounds, siteOptions, filterBySite, ALL_SITES,
  computeRootCauses, topCostVehicles as rankCostVehicles, costByDimension,
  periodBudget, projectAnnual, monthOverMonth, savingsOpportunity as computeSavings,
  riskCounts, riskScore, riskBand, buildRiskMatrix, topHighRisk, riskTrend,
  honestKpis, kpiExportRows, actionPhaseOf, RISK_LEVELS,
} from '../lib/executiveReportAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

// ── Dark chart base ───────────────────────────────────────────────────────────
const CHART_DARK = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}
const CHART_DARK_NO_LEGEND = {
  ...CHART_DARK,
  plugins: { ...CHART_DARK.plugins, legend: { display: false } },
}
const CHART_HORIZONTAL = {
  ...CHART_DARK_NO_LEGEND,
  indexAxis: 'y',
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
  },
}
const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: CHART_DARK.plugins.tooltip,
  },
}

// ── Period helpers ────────────────────────────────────────────────────────────
// Period selection is data-aware (All time / data years / custom calendar) via
// the shared PeriodFilter. All report maths (root causes, risk, cost breakdowns,
// honest KPI view, formatters) lives in src/lib/executiveReportAnalytics.js.
function filterByPeriod(records, period, dateField = 'issue_date') {
  return filterByPeriodValue(records, period, dateField)
}

const STATUS_COLORS = {
  green: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30', dot: 'bg-emerald-400' },
  amber: { text: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/30', dot: 'bg-amber-400' },
  red:   { text: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30', dot: 'bg-red-400' },
  // "not measured" - deliberately colourless so an unknown never reads as a verdict
  neutral: { text: 'text-[var(--text-muted)]', bg: 'bg-[var(--surface-2)]', border: 'border-[var(--border-bright)]', dot: 'bg-[var(--text-dim)]' },
}

const PRIORITY_STYLES = {
  Critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  High:     'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  Medium:   'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  Low:      'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
}

// EnterpriseTable cell for a risk-level count: a tinted chip when non-zero.
function riskCountCell(tone) {
  return function RiskCountCell({ getValue }) {
    const v = getValue()
    return v > 0
      ? <span className={`px-1.5 py-0.5 rounded font-bold tabular-nums ${tone}`}>{v}</span>
      : <span className="text-[var(--text-dim)]">0</span>
  }
}

// Shared header action style: 44px touch target, visible keyboard focus.
const HEADER_BTN = 'inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-medium transition-colors border disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-1'

// ── Card component ────────────────────────────────────────────────────────────
function Card({ children, className = '' }) {
  return (
    <div className={`bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

function SectionHeader({ icon: Icon, title, subtitle, badge }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
          <Icon className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          {subtitle && <p className="text-sm text-[var(--text-secondary)] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {badge && (
        <span className="px-2 py-1 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          {badge}
        </span>
      )}
    </div>
  )
}

// Shell for an added palette widget: titled Card with a hover "remove" control.
function WidgetShell({ onRemove, icon: Icon, title, subtitle, children }) {
  return (
    <div className="relative group">
      <button
        onClick={onRemove}
        title="Remove this block"
        aria-label="Remove this block"
        className="no-print absolute top-3 right-3 z-10 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg bg-[var(--surface-2)] hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-dim)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none transition-opacity"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <Card>
        {(title || Icon) && (
          <div className="flex items-center gap-3 mb-4">
            {Icon && (
              <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <Icon className="w-5 h-5 text-blue-400" />
              </div>
            )}
            <div>
              {title && <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>}
              {subtitle && <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</p>}
            </div>
          </div>
        )}
        {children}
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Customizable layout model
// The report is a persisted, ordered list of blocks. Seven built-in sections
// (always present, can be hidden + reordered) plus any number of user-added
// widgets (charts / tables / notes / dividers) drawn from the block palette.
// Persisted to localStorage so a user's tailored layout survives reloads.
// ─────────────────────────────────────────────────────────────────────────────
const LAYOUT_STORAGE_KEY = 'executiveReport.layout.v1'

const BUILTIN_DEFS = [
  { key: 'summary',         label: 'Executive Summary' },
  { key: 'kpis',            label: 'KPI Dashboard' },
  { key: 'rootcause',       label: 'Root Cause Analysis' },
  { key: 'financial',       label: 'Financial Impact' },
  { key: 'costsplit',       label: 'Tyres vs Maintenance Cost' },
  { key: 'risk',            label: 'Risk Assessment' },
  { key: 'recommendations', label: 'Recommendations' },
  { key: 'actionplan',      label: 'Action Plan' },
]
const BUILTIN_KEYS = BUILTIN_DEFS.map(b => b.key)

// Addable widgets - every one is bound to data already loaded on the page.
const WIDGET_DEFS = [
  { key: 'w:note',            label: 'Free Text Note',       icon: StickyNote,          desc: 'A written commentary or note block.' },
  { key: 'w:divider',         label: 'Divider',              icon: SeparatorHorizontal, desc: 'A horizontal separator line.' },
  { key: 'w:chartCostTrend',  label: 'Monthly Spend Trend',  icon: BarChart2,           desc: 'Bar chart of tyre spend by month.' },
  { key: 'w:chartRootCause',  label: 'Root Cause Breakdown', icon: AlertTriangle,       desc: 'Bar chart of failure drivers.' },
  { key: 'w:chartCostSite',   label: 'Cost by Site',         icon: Building2,           desc: 'Cost distribution across sites.' },
  { key: 'w:chartCostBrand',  label: 'Cost by Brand',        icon: Package,             desc: 'Cost distribution across brands.' },
  { key: 'w:chartRiskTrend',  label: 'Risk Score Trend',     icon: ShieldAlert,         desc: 'Six-month fleet risk score line.' },
  { key: 'w:tableTopVehicles',label: 'Top Cost Vehicles',    icon: Users,               desc: 'Table of the highest-cost vehicles.' },
  { key: 'w:insights',        label: 'Key Wins & Concerns',  icon: Award,               desc: 'Best brand and worst site highlight cards.' },
]
const WIDGET_LABELS = Object.fromEntries(WIDGET_DEFS.map(w => [w.key, w.label]))

function defaultLayout() {
  return BUILTIN_DEFS.map(b => ({ id: b.key, key: b.key, builtin: true, visible: true }))
}

// Merge a persisted layout with the current block catalog: keep the user's
// order/visibility, drop unknown keys, guarantee every built-in is present.
function normalizeLayout(raw) {
  if (!Array.isArray(raw)) return defaultLayout()
  const seen = new Set()
  const out = []
  for (const it of raw) {
    if (!it || typeof it.key !== 'string') continue
    const builtin = BUILTIN_KEYS.includes(it.key)
    const isWidget = WIDGET_LABELS[it.key] !== undefined
    if (!builtin && !isWidget) continue
    const id = typeof it.id === 'string' && it.id ? it.id : it.key
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      key: it.key,
      builtin,
      visible: it.visible !== false,
      ...(typeof it.text === 'string' ? { text: it.text } : {}),
    })
  }
  for (const b of BUILTIN_DEFS) {
    if (!out.some(o => o.builtin && o.key === b.key)) {
      out.push({ id: b.key, key: b.key, builtin: true, visible: true })
    }
  }
  return out
}

function blockLabel(item) {
  if (item.builtin) return BUILTIN_DEFS.find(b => b.key === item.key)?.label || item.key
  return WIDGET_LABELS[item.key] || 'Block'
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ExecutiveReport() {
  const { t } = useLanguage()
  const { appSettings, activeCurrency, activeCountry } = useSettings()
  const { branding } = useTenant()
  const currency = activeCurrency
  const companyName = appSettings?.company_name || 'TyrePulse Fleet'
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [records,     setRecords]     = useState([])
  const [inspections, setInspections] = useState([])
  const [actions,     setActions]     = useState([])
  const [fleet,       setFleet]       = useState([])
  // Stable snapshot of the full (all-time) dataset used ONLY to populate the
  // PeriodFilter year list; refreshed only on an all-time load so narrowing the
  // period (which now scopes the server read) never collapses the year dropdown.
  const [periodBasis, setPeriodBasis] = useState([])
  // Per-dataset truncation flags from fetchAllPages (row ceiling hit).
  const [truncated,   setTruncated]   = useState({ records: false, inspections: false, actions: false })
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [period,      setPeriod]      = useState({ mode: 'all' })
  // Site scope for the whole report (All = every site in the active country).
  const [site,        setSite]        = useState(ALL_SITES)
  // Re-run the main load without changing any filter (Retry after an error).
  const [reloadKey,   setReloadKey]   = useState(0)
  // Export failures are surfaced, never swallowed into the console.
  const [exportError, setExportError] = useState(null)
  const [exporting,   setExporting]   = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  // Executive reports open as a clean WHITE printed-document view by default
  // (non-technical users expect white paper, not the dark dashboard). The
  // header toggle still lets power users flip back to the dark dashboard.
  const [reportMode,  setReportMode]  = useState(true)

  // ── Tyres vs Maintenance cost split (own tri-state, independent of the main
  // dataset load so a missing maintenance relation never blocks the report). ──
  const [costSplit,        setCostSplit]        = useState({ tyre: 0, maintenance: 0, byMonth: [] })
  const [costSplitState,   setCostSplitState]   = useState('loading') // 'loading' | 'ready' | 'error'
  const [costMode,         setCostMode]         = useState('combined')

  // ── Customizable layout (persisted) ────────────────────────────────────────
  const [layout, setLayout] = useState(() => {
    try { return normalizeLayout(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || 'null')) }
    catch { return defaultLayout() }
  })
  const [customizeOpen, setCustomizeOpen] = useState(false)
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout)) } catch { /* private mode / quota */ }
  }, [layout])

  const orderOf = useCallback((id) => {
    const i = layout.findIndex(x => x.id === id)
    return i < 0 ? 999 : i
  }, [layout])
  const builtinVisible = useCallback((key) => {
    const it = layout.find(x => x.builtin && x.key === key)
    return it ? it.visible !== false : true
  }, [layout])
  const blockStyle = useCallback((key) => ({
    order: orderOf(key),
    display: builtinVisible(key) ? undefined : 'none',
  }), [orderOf, builtinVisible])
  const visibleBuiltinKeys = useMemo(
    () => layout.filter(x => x.builtin && x.visible !== false).map(x => x.key),
    [layout],
  )
  const addedBlocks = useMemo(
    () => layout.filter(x => !x.builtin && x.visible !== false),
    [layout],
  )

  const toggleVisible = useCallback((id) => setLayout(l => l.map(x => (
    x.id === id ? { ...x, visible: !(x.visible !== false) } : x
  ))), [])
  const moveBlock = useCallback((id, dir) => setLayout(l => {
    const i = l.findIndex(x => x.id === id)
    if (i < 0) return l
    const j = i + dir
    if (j < 0 || j >= l.length) return l
    const copy = l.slice()
    const [m] = copy.splice(i, 1)
    copy.splice(j, 0, m)
    return copy
  }), [])
  const removeBlock = useCallback((id) => setLayout(l => l.filter(x => x.id !== id)), [])
  const addWidget = useCallback((key) => setLayout(l => [...l, {
    id: `${key}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    key, builtin: false, visible: true,
    ...(key === 'w:note' ? { text: '' } : {}),
  }]), [])
  const updateBlockText = useCallback((id, text) => setLayout(l => l.map(x => (
    x.id === id ? { ...x, text } : x
  ))), [])
  const resetLayout = useCallback(() => setLayout(defaultLayout()), [])
  // Escape closes the customize drawer (keyboard escape route).
  useEffect(() => {
    if (!customizeOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setCustomizeOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [customizeOpen])

  // Live chart -> white-paper PNG (falls back to the raw canvas), null-guarded for
  // pre-mount refs so export never throws before charts render.
  const chartImg = useCallback(
    (ref) => captureChartOnPaper(ref?.current) || ref?.current?.toBase64Image?.('image/png', 1) || null,
    [],
  )

  // Chart refs for PDF export
  const costTrendRef    = useRef(null)
  const rootCauseRef    = useRef(null)
  const costBySiteRef   = useRef(null)
  const riskTrendRef    = useRef(null)
  const costByBrandRef  = useRef(null)
  const costSplitRef    = useRef(null)

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { records, inspections, actions, fleet, truncated } =
          await executiveReport.loadExecutiveData({ country: activeCountry, period })
        if (cancelled) return
        setRecords(records)
        setInspections(inspections)
        setActions(actions)
        setFleet(fleet)
        setTruncated(truncated)
        const bounds = periodBounds(period)
        if (!bounds) setPeriodBasis(records)
      } catch (e) {
        if (!cancelled) setError(toUserMessage(e, 'Failed to load data'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeCountry, period, reloadKey])

  // ── Tyres vs Maintenance cost split load (12 calendar months) ──────────────
  useEffect(() => {
    let cancelled = false
    setCostSplitState('loading')
    loadGovernedCostSplit({ country: activeCountry, site: site === ALL_SITES ? undefined : site, maxAgeMs: COST_SPLIT_TTL_MS })
      .then((res) => {
        if (cancelled) return
        setCostSplit(res || { tyre: 0, maintenance: 0, byMonth: [] })
        setCostSplitState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setCostSplit({ tyre: 0, maintenance: 0, byMonth: [] })
        setCostSplitState('error')
      })
    return () => { cancelled = true }
  }, [activeCountry, site, reloadKey])

  // ── Authoritative tyre SPEND for the report period (expense grid) ─────────
  // The headline "Total Period Spend" used to sum tyre_records.cost_per_tyre,
  // which misses every fitment without a price. It now reads the expense grid
  // for the SAME window the report shows; the per-tyre sum is a fallback only.
  const spendWin = useMemo(() => spendWindow(periodBounds(period), records), [period, records])
  const [gridSpend, setGridSpend] = useState(null) // { amount, blended, source } | null
  useEffect(() => {
    let cancelled = false
    setGridSpend(null)
    if (!spendWin) return () => { cancelled = true }
    loadGovernedCostSplit({ country: activeCountry, site: site === ALL_SITES ? undefined : site, from: spendWin.from, to: spendWin.to, maxAgeMs: COST_SPLIT_TTL_MS })
      .then((res) => {
        if (cancelled) return
        const amt = Number(res?.tyre)
        setGridSpend({ amount: Number.isFinite(amt) ? amt : null, blended: Boolean(res?.blended), source: res?.source || null })
      })
      .catch(() => { if (!cancelled) setGridSpend(null) })
    return () => { cancelled = true }
  }, [activeCountry, spendWin, site])

  // ── Period-filtered datasets ───────────────────────────────────────────────
  const sites             = useMemo(() => siteOptions(records, fleet), [records, fleet])
  // A site that disappears from the options (country switch) falls back to All.
  useEffect(() => { if (site !== ALL_SITES && sites.length && !sites.includes(site)) setSite(ALL_SITES) }, [sites, site])
  const siteRecords       = useMemo(() => filterBySite(records, site), [records, site])
  const siteFleet         = useMemo(() => filterBySite(fleet, site), [fleet, site])
  const periodRecords     = useMemo(() => filterByPeriod(siteRecords, period, 'issue_date'), [siteRecords, period])
  const periodInspections = useMemo(() => filterByPeriod(filterBySite(inspections, site), period, 'scheduled_date'), [inspections, period, site])
  const periodActions     = useMemo(() => filterByPeriod(filterBySite(actions, site), period, 'created_at'), [actions, period, site])

  // True when any raw pull hit its 50,000-row ceiling: the report then reflects a
  // capped sample of the selected period, not the full history.
  const cappedView = truncated.records || truncated.inspections || truncated.actions

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const fleetSize = useMemo(() =>
    siteFleet.length > 0
      ? siteFleet.length
      : new Set(siteRecords.map(r => r.asset_no).filter(Boolean)).size,
    [siteFleet, siteRecords]
  )

  const kpis        = useMemo(() => computeAllKpis(periodRecords, periodInspections, periodActions, fleetSize), [periodRecords, periodInspections, periodActions, fleetSize])
  const costTrend   = useMemo(() => computeCostTrend(periodRecords), [periodRecords])
  const vendors     = useMemo(() => computeVendorPerformance(periodRecords), [periodRecords])
  const rootCauses  = useMemo(() => computeRootCauses(periodRecords), [periodRecords])
  // Honest view of the KPIs: an unmeasured figure is null (renders N/A).
  const hk          = useMemo(() => honestKpis(kpis, periodRecords), [kpis, periodRecords])

  // ── Financial computations ────────────────────────────────────────────────
  // Per-tyre sum over the period's records. Kept ONLY as the fallback when the
  // expense grid holds nothing for this scope; per-brand / per-site / per-asset
  // breakdowns below still read tyre_records (the grid cannot attribute them).
  const legacyTyreSpend = useMemo(() =>
    periodRecords.reduce((s, r) => s + recordCost(r), 0),
    [periodRecords]
  )
  const spendResolved = useMemo(() => resolveReportTyreSpend({
    grid: gridSpend,
    legacy: legacyTyreSpend,
    legacyCountries: distinctCountries(periodRecords),
  }), [gridSpend, legacyTyreSpend, periodRecords])
  // null = unknown (no data, or a mixed-currency scope). Every consumer below is
  // null-safe: shares go through spendShare, text through fmtCurrency (N/A).
  const totalSpend = spendResolved.amount
  const spendBasisNote = spendResolved.source === 'grid'
    ? 'Tyre spend from the expense grid'
    : spendResolved.source === 'tyre_records'
      ? 'Tyre spend from priced tyre records (expense grid had no data)'
      : spendResolved.reason === 'mixed_currency'
        ? 'Mixed currencies: pick a country for a spend total'
        : 'No tyre spend recorded for this period'

  // Engine-derived figures (src/lib/executiveReportAnalytics.js). Each one is
  // null when the data cannot support it, so the page renders N/A, not a 0.
  const totalBudget      = useMemo(() => periodBudget(siteFleet, periodRecords), [siteFleet, periodRecords])
  const projectedAnnual  = useMemo(() => projectAnnual(costTrend.avgMonthlyCost), [costTrend])
  const topCostVehicles  = useMemo(() => rankCostVehicles(periodRecords, 5), [periodRecords])
  const costBySite       = useMemo(() => costByDimension(periodRecords, 'site'), [periodRecords])
  const costByBrand      = useMemo(() => costByDimension(periodRecords, 'brand', 8), [periodRecords])
  const savingsOpportunity = useMemo(() => computeSavings(kpis.cpk, periodRecords), [kpis, periodRecords])
  const riskMatrix       = useMemo(() => buildRiskMatrix(periodRecords), [periodRecords])
  const riskTally        = useMemo(() => riskCounts(periodRecords), [periodRecords])
  const fleetRiskScore   = useMemo(() => riskScore(periodRecords), [periodRecords])
  const fleetRiskBand    = riskBand(fleetRiskScore)
  const top10HighRisk    = useMemo(() => topHighRisk(periodRecords, 10), [periodRecords])
  const riskTrend6m      = useMemo(() => riskTrend(siteRecords, { months: 6, now: new Date() }), [siteRecords])
  const momChange        = useMemo(() => monthOverMonth(costTrend.byMonth), [costTrend])

  // ── Best brand by CPK ─────────────────────────────────────────────────────
  const bestBrand = useMemo(() => {
    const v = vendors.filter(b => b.validCount >= 3)
    return v.length ? v[v.length - 1] : null // sorted best last (highest score = rank 1)
  }, [vendors])

  const bestBrandByScore = useMemo(() => {
    const v = vendors.filter(b => b.validCount >= 3)
    return v.length ? v[0] : null
  }, [vendors])

  // ── Worst site by failure rate ────────────────────────────────────────────
  const worstSiteByFailure = useMemo(() => {
    const fr = kpis.failureRate?.bySite
    return fr?.length ? fr[0] : null
  }, [kpis])

  // ── Top root cause ────────────────────────────────────────────────────────
  const topRootCause = useMemo(() => rootCauses[0] || null, [rootCauses])

  // ── Recommendations ───────────────────────────────────────────────────────
  const recommendations = useMemo(() => {
    const recs = []
    // Recommendations fire only on MEASURED figures: an unknown compliance or
    // rate is not evidence of a problem (hk.* is null when unmeasured).
    const inspComp = hk.inspectionPct
    const scrapRate = hk.scrapRate
    const critRate  = hk.criticalRate

    if (critRate != null && critRate > 0.15) {
      recs.push({
        priority: 'Critical',
        title: t('execreport.recommendations.criticalRemoval.title'),
        description: t('execreport.recommendations.criticalRemoval.description', { pct: fmtPct(critRate * 100) }),
        impact: t('execreport.recommendations.criticalRemoval.impact', { amount: fmtCurrency(kpis.scrapRate?.estimatedScrapCost * 0.4, currency) }),
        owner: t('execreport.owners.fleetManager'),
      })
    }

    if (inspComp != null && inspComp < 85) {
      recs.push({
        priority: critRate != null && critRate > 0.1 ? 'Critical' : 'High',
        title: t('execreport.recommendations.inspectionCompliance.title'),
        description: t('execreport.recommendations.inspectionCompliance.description', { pct: fmtPct(inspComp) }),
        impact: t('execreport.recommendations.inspectionCompliance.impact', { amount: fmtCurrency(spendShare(totalSpend, 0.15), currency) }),
        owner: t('execreport.owners.management'),
      })
    }

    if (bestBrandByScore && vendors.length > 2) {
      const worst = vendors[vendors.length - 1]
      recs.push({
        priority: 'High',
        title: t('execreport.recommendations.procurementReview.title', { brand: worst.brand }),
        description: t('execreport.recommendations.procurementReview.description', { brand: worst.brand, cpk: fmtCpk(worst.avgCpk, currency), rate: fmtPct(worst.failureRate * 100) }),
        impact: t('execreport.recommendations.procurementReview.impact', { bestBrand: bestBrandByScore.brand, amount: fmtCurrency(spendShare(savingsOpportunity, 0.3), currency) }),
        owner: t('execreport.owners.procurement'),
      })
    }

    if (topRootCause && topRootCause.key === 'inflation') {
      recs.push({
        priority: 'High',
        title: t('execreport.recommendations.tpmsDeployment.title'),
        description: t('execreport.recommendations.tpmsDeployment.description', { pct: fmtPct(topRootCause.pct) }),
        impact: t('execreport.recommendations.tpmsDeployment.impact', { amount: fmtCurrency(topRootCause.cost * 0.6, currency) }),
        owner: t('execreport.owners.fleetManager'),
      })
    }

    if (topRootCause && topRootCause.key === 'driver') {
      recs.push({
        priority: 'High',
        title: t('execreport.recommendations.driverBehaviour.title'),
        description: t('execreport.recommendations.driverBehaviour.description', { pct: fmtPct(topRootCause.pct) }),
        impact: t('execreport.recommendations.driverBehaviour.impact', { amount: fmtCurrency(topRootCause.cost * 0.5, currency) }),
        owner: t('execreport.owners.fleetManager'),
      })
    }

    if (scrapRate != null && scrapRate > 0.15) {
      recs.push({
        priority: 'High',
        title: t('execreport.recommendations.scrapRateInvestigation.title'),
        description: t('execreport.recommendations.scrapRateInvestigation.description', { pct: fmtPct(scrapRate * 100) }),
        impact: t('execreport.recommendations.scrapRateInvestigation.impact', { amount: fmtCurrency(kpis.scrapRate?.estimatedScrapCost * 0.5, currency) }),
        owner: t('execreport.owners.workshop'),
      })
    }

    if (worstSiteByFailure) {
      recs.push({
        priority: 'Medium',
        title: t('execreport.recommendations.siteAudit.title', { site: worstSiteByFailure.site }),
        description: t('execreport.recommendations.siteAudit.description', { site: worstSiteByFailure.site, pct: fmtPct(worstSiteByFailure.rate * 100) }),
        impact: t('execreport.recommendations.siteAudit.impact', { site: worstSiteByFailure.site, amount: fmtCurrency(costBySite.find(s => s.site === worstSiteByFailure.site)?.cost * 0.2 || 0, currency) }),
        owner: t('execreport.owners.fleetManager'),
      })
    }

    if (kpis.cpk.fleetAvgCpk > 0 && savingsOpportunity != null && savingsOpportunity > 5000) {
      recs.push({
        priority: 'Medium',
        title: t('execreport.recommendations.cpkOptimisation.title'),
        description: t('execreport.recommendations.cpkOptimisation.description', { fleetCpk: fmtCpk(kpis.cpk.fleetAvgCpk, currency), bestCpk: fmtCpk(kpis.cpk.p10Cpk, currency) }),
        impact: t('execreport.recommendations.cpkOptimisation.impact', { amount: fmtCurrency(savingsOpportunity, currency) }),
        owner: t('execreport.owners.management'),
      })
    }

    if (kpis.downtimeImpact?.totalDowntimeHours > 100) {
      recs.push({
        priority: 'Medium',
        title: t('execreport.recommendations.downtimeMaintenance.title'),
        description: t('execreport.recommendations.downtimeMaintenance.description', { assets: kpis.downtimeImpact.worstAssets?.slice(0, 3).map(a => a.assetNo).join(', ') }),
        impact: t('execreport.recommendations.downtimeMaintenance.impact', { hours: Math.round(kpis.downtimeImpact.totalDowntimeHours * 0.3) }),
        owner: t('execreport.owners.workshop'),
      })
    }

    if (recs.length < 6) {
      recs.push({
        priority: 'Medium',
        title: t('execreport.recommendations.tyreRotation.title'),
        description: t('execreport.recommendations.tyreRotation.description'),
        impact: t('execreport.recommendations.tyreRotation.impact', { amount: fmtCurrency(spendShare(totalSpend, 0.1), currency) }),
        owner: t('execreport.owners.workshop'),
      })
    }

    return recs.slice(0, 10)
  }, [kpis, hk, vendors, bestBrandByScore, topRootCause, worstSiteByFailure, totalSpend, savingsOpportunity, currency, costBySite, t])

  // ── Action plan ───────────────────────────────────────────────────────────
  const actionPlan = useMemo(() => {
    const critCount = periodRecords.filter(r => r.risk_level === 'Critical').length
    const actions30 = [
      {
        action: t('execreport.actionPlan.actions.removeCritical', { count: critCount }),
        priority: 'Critical', timeline: t('execreport.actionPlan.daysSuffix', { range: '0-7' }),
        owner: t('execreport.owners.fleetManager'), saving: fmtCurrency(kpis.scrapRate?.estimatedScrapCost * 0.2, currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.auditSites'),
        priority: 'Critical', timeline: t('execreport.actionPlan.daysSuffix', { range: '7-14' }),
        owner: t('execreport.owners.fleetManager'), saving: fmtCurrency(spendShare(totalSpend, 0.08), currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.mandatePressureCheck'),
        priority: 'High', timeline: t('execreport.actionPlan.daysSuffix', { range: '1-7' }),
        owner: t('execreport.owners.workshop'), saving: fmtCurrency(topRootCause?.cost * 0.3 || 0, currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.issueCorrectiveNotices'),
        priority: 'High', timeline: t('execreport.actionPlan.daysSuffix', { range: '7-30' }),
        owner: t('execreport.owners.management'), saving: fmtCurrency(spendShare(totalSpend, 0.1), currency), status: t('execreport.status.open'),
      },
    ]
    const actions60 = [
      {
        action: t('execreport.actionPlan.actions.procurementReviewBrand'),
        priority: 'High', timeline: t('execreport.actionPlan.daysSuffix', { range: '30-60' }),
        owner: t('execreport.owners.procurement'), saving: fmtCurrency(spendShare(savingsOpportunity, 0.3), currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.deployTelematics'),
        priority: 'High', timeline: t('execreport.actionPlan.daysSuffix', { range: '30-60' }),
        owner: t('execreport.owners.fleetManager'), saving: fmtCurrency(spendShare(totalSpend, 0.12), currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.implementRotation'),
        priority: 'Medium', timeline: t('execreport.actionPlan.daysSuffix', { range: '30-60' }),
        owner: t('execreport.owners.workshop'), saving: fmtCurrency(spendShare(totalSpend, 0.1), currency), status: t('execreport.status.open'),
      },
    ]
    const actions90 = [
      {
        action: t('execreport.actionPlan.actions.completeTpms'),
        priority: 'High', timeline: t('execreport.actionPlan.daysSuffix', { range: '60-90' }),
        owner: t('execreport.owners.fleetManager'), saving: fmtCurrency(spendShare(totalSpend, 0.15), currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.monthlyReview'),
        priority: 'Medium', timeline: t('execreport.actionPlan.daysSuffix', { range: '60-90' }),
        owner: t('execreport.owners.management'), saving: t('execreport.actionPlan.processLabel'), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.negotiateContracts'),
        priority: 'Medium', timeline: t('execreport.actionPlan.daysSuffix', { range: '60-90' }),
        owner: t('execreport.owners.procurement'), saving: fmtCurrency(spendShare(savingsOpportunity, 0.4), currency), status: t('execreport.status.open'),
      },
    ]
    return [...actions30, ...actions60, ...actions90]
  }, [periodRecords, kpis, totalSpend, savingsOpportunity, topRootCause, currency, t])

  // ── Table column definitions (EnterpriseTable: search, sort, filter, export) ─
  const actionPlanRows = useMemo(
    () => actionPlan.map((a, i) => ({ ...a, id: `ap-${i}`, seq: i + 1, phase: actionPhaseOf(i) })),
    [actionPlan],
  )
  const reportMeta = useMemo(() => ({
    title: 'Executive Intelligence Report',
    company,
    currency,
    branding,
    dateRange: site === ALL_SITES ? periodValueLabel(period) : `${periodValueLabel(period)} | ${site}`,
  }), [company, currency, branding, period, site])

  const topVehicleColumns = useMemo(() => [
    { id: 'rank', header: '#', accessorFn: (_r, i) => i + 1, size: 50, enableSorting: false },
    { id: 'asset_no', header: 'Asset No', accessorKey: 'asset_no', size: 140,
      cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 140, meta: { filterVariant: 'select' } },
    { id: 'count', header: 'Tyres', accessorKey: 'count', size: 80, meta: { align: 'right' } },
    { id: 'cost', header: 'Cost', accessorKey: 'cost', size: 140, meta: { align: 'right', exportValue: (r) => Math.round(r.cost) },
      cell: ({ getValue }) => <span className="font-semibold tabular-nums text-amber-400">{fmtCurrency(getValue(), currency)}</span> },
  ], [currency])

  const rootCauseColumns = useMemo(() => [
    { id: 'label', header: 'Cause', accessorKey: 'label', size: 200,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.original.color }} aria-hidden="true" />
          <span className="text-[var(--text-primary)]">{row.original.label}</span>
        </span>
      ) },
    { id: 'count', header: 'Count', accessorKey: 'count', size: 80, meta: { align: 'right' } },
    { id: 'pct', header: '%', accessorKey: 'pct', size: 80, meta: { align: 'right', exportValue: (r) => Number(r.pct.toFixed(1)) },
      cell: ({ getValue }) => <span className="tabular-nums">{fmtPct(getValue())}</span> },
    { id: 'cost', header: 'Cost Impact', accessorKey: 'cost', size: 130, meta: { align: 'right', exportValue: (r) => Math.round(r.cost) },
      cell: ({ getValue }) => <span className="tabular-nums text-amber-400">{fmtCurrency(getValue(), currency)}</span> },
    { id: 'prevention', header: 'Prevention', accessorKey: 'prevention', size: 280,
      cell: ({ getValue }) => <span className="text-xs text-[var(--text-muted)]">{getValue()}</span> },
  ], [currency])

  const riskMatrixColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorKey: 'site', size: 160,
      cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'Critical', header: 'Critical', accessorKey: 'Critical', size: 90, meta: { align: 'center' }, cell: riskCountCell('bg-red-500/20 text-red-400') },
    { id: 'High', header: 'High', accessorKey: 'High', size: 90, meta: { align: 'center' }, cell: riskCountCell('bg-orange-500/20 text-orange-400') },
    { id: 'Medium', header: 'Medium', accessorKey: 'Medium', size: 90, meta: { align: 'center' }, cell: riskCountCell('bg-amber-500/20 text-amber-400') },
    { id: 'Low', header: 'Low', accessorKey: 'Low', size: 90, meta: { align: 'center' }, cell: riskCountCell('bg-emerald-500/20 text-emerald-400') },
    { id: 'rated', header: 'Rated', accessorKey: 'rated', size: 80, meta: { align: 'center' } },
    { id: 'total', header: 'Total', accessorKey: 'total', size: 80, meta: { align: 'center' } },
    { id: 'score', header: 'Risk Score', accessorFn: (r) => r.score ?? -1, size: 150,
      meta: { align: 'center', exportValue: (r) => (r.score == null ? 'N/A' : Number(r.score.toFixed(2))) },
      cell: ({ row }) => {
        const band = riskBand(row.original.score)
        return (
          <span className={`font-bold tabular-nums ${(STATUS_COLORS[band.key] || STATUS_COLORS.neutral).text}`}>
            {fmtNum(row.original.score, 2)} <span className="text-[10px] font-medium">{band.label}</span>
          </span>
        )
      } },
  ], [])

  const highRiskColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset No', accessorFn: (r) => r.asset_no || 'N/A', size: 120,
      cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 130, meta: { filterVariant: 'select' } },
    { id: 'risk_level', header: 'Risk', accessorKey: 'risk_level', size: 100, meta: { align: 'center', filterVariant: 'select' },
      cell: ({ getValue }) => (
        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${getValue() === 'Critical' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'}`}>
          {getValue()}
        </span>
      ) },
    { id: 'brand', header: 'Brand', accessorFn: (r) => r.brand || 'N/A', size: 120 },
    { id: 'position', header: 'Position', accessorFn: (r) => r.position || 'N/A', size: 100 },
    { id: 'findings', header: 'Findings', accessorFn: (r) => r.findings || 'N/A', size: 280,
      cell: ({ getValue }) => <span className="block max-w-xs truncate" title={getValue()}>{getValue()}</span> },
  ], [])

  const actionPlanColumns = useMemo(() => [
    { id: 'seq', header: '#', accessorKey: 'seq', size: 50 },
    { id: 'phase', header: 'Phase', accessorKey: 'phase', size: 110, meta: { filterVariant: 'select' } },
    { id: 'action', header: 'Action', accessorKey: 'action', size: 320,
      cell: ({ getValue }) => <span className="text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'priority', header: 'Priority', accessorKey: 'priority', size: 100, meta: { align: 'center', filterVariant: 'select' },
      cell: ({ getValue }) => <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${PRIORITY_STYLES[getValue()] || ''}`}>{getValue()}</span> },
    { id: 'timeline', header: 'Timeline', accessorKey: 'timeline', size: 110, meta: { align: 'center' } },
    { id: 'owner', header: 'Owner', accessorKey: 'owner', size: 140, meta: { filterVariant: 'select' } },
    { id: 'saving', header: 'Est. Saving', accessorKey: 'saving', size: 130, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="font-medium tabular-nums text-emerald-400">{getValue()}</span> },
    { id: 'status', header: 'Status', accessorKey: 'status', size: 100, meta: { align: 'center' } },
  ], [])

  // ── KPI cards (single source: on-screen grid + PDF/PPTX exports) ───────────
  const kpiCards = useMemo(() => [
    { label: t('execreport.kpi.fleetAvgCpk'), value: fmtCpk(hk.fleetAvgCpk, currency), status: cpkStatus(hk.fleetAvgCpk), target: '< 0.012', icon: DollarSign },
    { label: t('execreport.kpi.medianCpk'), value: fmtCpk(hk.medianCpk, currency), status: cpkStatus(hk.medianCpk), target: '< 0.012', icon: BarChart2 },
    { label: t('execreport.kpi.fleetAvgTyreLife'), value: withUnit(fmtNum(hk.avgTyreLifeKm), 'km'), status: higherIsBetter(hk.avgTyreLifeKm, 60000, 40000), target: '>= 60,000 km', icon: Activity },
    { label: t('execreport.kpi.inspectionCompliance'), value: fmtPct(hk.inspectionPct), status: pctStatus(hk.inspectionPct), target: '>= 85%', icon: CheckCircle },
    { label: t('execreport.kpi.pressureCompliance'), value: fmtPct(hk.pressurePct), status: pctStatus(hk.pressurePct), target: '>= 90%', icon: Target },
    { label: t('execreport.kpi.failureRate'), value: fmtRatio(hk.failureRate), status: lowerIsBetter(hk.failureRate, 0.1, 0.25), target: '< 10%', icon: AlertTriangle },
    { label: t('execreport.kpi.criticalRate'), value: fmtRatio(hk.criticalRate), status: lowerIsBetter(hk.criticalRate, 0.05, 0.15), target: '< 5%', icon: ShieldAlert },
    { label: t('execreport.kpi.scrapRate'), value: fmtRatio(hk.scrapRate), status: lowerIsBetter(hk.scrapRate, 0.15, 0.25), target: '< 15%', icon: Package },
    { label: t('execreport.kpi.replacementRate'), value: withUnit(fmtNum(hk.replacementPerVehicleMonth, 2), '/veh/mo'), status: lowerIsBetter(hk.replacementPerVehicleMonth, 1, 1.5), target: '< 1.0', icon: Wrench },
    { label: t('execreport.kpi.totalDowntimeHours'), value: withUnit(fmtNum(hk.downtimeHours), 'hrs'), status: lowerIsBetter(hk.downtimeHours, 100, 300), target: '< 100 hrs', icon: Clock },
    { label: t('execreport.kpi.fleetAvailability'), value: fmtPct(hk.availabilityPct), status: pctStatus(hk.availabilityPct, 95), target: '>= 95%', icon: Zap },
    {
      label: t('execreport.kpi.costTrend'),
      value: costTrend.byMonth.length >= 2 ? t(`execreport.trend.${costTrend.trend}`) : 'N/A',
      status: costTrend.byMonth.length < 2 ? 'neutral' : costTrend.trend === 'improving' ? 'green' : costTrend.trend === 'stable' ? 'amber' : 'red',
      target: t('execreport.kpi.improvingTarget'),
      icon: TrendingUp,
    },
  ], [hk, costTrend, currency, t])

  // ── Chart datasets ────────────────────────────────────────────────────────
  const costTrendChart = useMemo(() => ({
    labels: costTrend.byMonth.slice(-12).map(m => m.month),
    datasets: [{
      label: 'Monthly Spend',
      data: costTrend.byMonth.slice(-12).map(m => m.totalCost),
      backgroundColor: withAlpha(colorAt(0), 0.7),
      borderColor: colorAt(0),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [costTrend])

  const rcaChart = useMemo(() => ({
    labels: rootCauses.slice(0, 7).map(c => c.label),
    datasets: [{
      data:            rootCauses.slice(0, 7).map(c => c.count),
      backgroundColor: rootCauses.slice(0, 7).map(c => c.color + 'cc'),
      borderColor:     rootCauses.slice(0, 7).map(c => c.color),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [rootCauses])

  const costBySiteChart = useMemo(() => ({
    labels: costBySite.slice(0, 8).map(s => s.site),
    datasets: [{
      label: 'Total Cost',
      data: costBySite.slice(0, 8).map(s => s.cost),
      backgroundColor: withAlpha(colorAt(1), 0.7),
      borderColor: colorAt(1),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [costBySite])

  const costByBrandChart = useMemo(() => ({
    labels: costByBrand.map(b => b.brand),
    datasets: [{
      label: 'Total Cost',
      data: costByBrand.map(b => b.cost),
      backgroundColor: withAlpha(colorAt(2), 0.7),
      borderColor: colorAt(2),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [costByBrand])

  const riskTrendChart = useMemo(() => ({
    labels: riskTrend6m.map(m => m.month),
    datasets: [{
      label: 'Risk Score',
      data: riskTrend6m.map(m => m.score),
      borderColor: colorAt(3),
      backgroundColor: withAlpha(colorAt(3), 0.1),
      fill: true,
      tension: 0.4,
      pointBackgroundColor: colorAt(3),
      pointRadius: 4,
    }],
  }), [riskTrend6m])

  // ── Tyres vs Maintenance cost derivations (single source: costSources) ─────
  const costSplitByMonth  = useMemo(() => (Array.isArray(costSplit?.byMonth) ? costSplit.byMonth : []), [costSplit])
  const costSplitSums      = useMemo(() => splitTotals(costSplitByMonth), [costSplitByMonth])
  const costSplitHeadline  = useMemo(() => pickCost(costMode, costSplitSums), [costMode, costSplitSums])
  const costSplitSeries    = useMemo(() => pickMonthly(costMode, costSplitByMonth), [costMode, costSplitByMonth])
  const costSplitHasData   = costSplitSums.combined > 0

  const costSplitChart = useMemo(() => ({
    labels: costSplitSeries.map(m => m.month),
    datasets: [{
      label: `${costModeLabel(costMode)} Spend`,
      data: costSplitSeries.map(m => m.value),
      backgroundColor: withAlpha(colorAt(4), 0.7),
      borderColor: colorAt(4),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [costSplitSeries, costMode])

  // ── PDF Export (WYSIWYG: KPI cards + charts + tables, matches report view) ──
  const exportPDF = useCallback(async () => {
    setExporting(true)
    setExportError(null)
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = await loadAutoTable()
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(branding)
      const periodLabel = site === ALL_SITES ? periodValueLabel(period) : `${periodValueLabel(period)} | ${site}`
      const W = doc.internal.pageSize.getWidth()
      const H = doc.internal.pageSize.getHeight()
      const M = 14
      const GAP = 4
      const INK = [15, 23, 42]
      const MUTED = [100, 116, 139]

      // Draw a captured live chart into a white card, aspect-preserving. Honest
      // "no chart data" placeholder when the ref is unmounted / empty.
      const drawChart = (ref, x, y, cw, ch, title) => {
        if (title) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
          doc.text(String(title), x, y - 1.6, { maxWidth: cw })
        }
        doc.setDrawColor(226, 232, 240); doc.setFillColor(255, 255, 255)
        doc.roundedRect(x, y, cw, ch, 1.5, 1.5, 'FD')
        const live = ref?.current
        const img = chartImg(ref)
        if (!img || !live) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
          doc.text('No chart data', x + cw / 2, y + ch / 2, { align: 'center' })
          return
        }
        const iw0 = live.width || live.canvas?.width || cw
        const ih0 = live.height || live.canvas?.height || ch
        const scale = Math.min((cw - 4) / iw0, (ch - 4) / ih0)
        const iw = iw0 * scale, ih = ih0 * scale
        doc.addImage(img, 'PNG', x + (cw - iw) / 2, y + (ch - ih) / 2, iw, ih)
      }

      // Each built-in section maps to one PDF page renderer. Pages are emitted
      // in the user's customized order and hidden sections are skipped, so the
      // export mirrors the on-screen tailored layout.
      const halfW = (W - 2 * M - GAP) / 2
      const pdfPageRenderers = {
        kpis: () => {
          pdfHeader(doc, 'Executive Intelligence Report', `KPI Dashboard | ${periodLabel}`, company, brand)
          const perRow = 6
          const gridY = 32
          const cardW = (W - 2 * M - (perRow - 1) * GAP) / perRow
          const cardH = 27
          kpiCards.forEach((c, i) => {
            const col = i % perRow, row = Math.floor(i / perRow)
            const x = M + col * (cardW + GAP)
            const y = gridY + row * (cardH + GAP)
            doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252)
            doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD')
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK)
            doc.text(String(c.value), x + cardW / 2, y + 9, { align: 'center', maxWidth: cardW - 3 })
            doc.setFont('helvetica', 'normal'); doc.setFontSize(6.4); doc.setTextColor(...MUTED)
            doc.text(String(c.label).toUpperCase(), x + cardW / 2, y + 15.5, { align: 'center', maxWidth: cardW - 3 })
            doc.setFontSize(6); doc.setTextColor(148, 163, 184)
            doc.text(`Target: ${String(c.target)}`, x + cardW / 2, y + 22, { align: 'center', maxWidth: cardW - 3 })
          })
        },
        rootcause: () => {
          pdfHeader(doc, 'Root Cause Analysis', periodLabel, company, brand)
          drawChart(rootCauseRef, M, 34, halfW, 92, 'Failure Driver Classification')
          autoTable(doc, {
            ...pdfTableTheme(brand.accent),
            startY: 30,
            margin: { left: M + halfW + GAP },
            tableWidth: halfW,
            head: [['Root Cause', 'Count', '%', 'Cost Impact']],
            body: rootCauses.map(c => [c.label, c.count, fmtPct(c.pct), fmtCurrency(c.cost, currency)]),
          })
        },
        financial: () => {
          pdfHeader(doc, 'Financial Impact', periodLabel, company, brand)
          drawChart(costTrendRef, M, 34, W - 2 * M, 68, 'Monthly Spend Trend')
          const finBottomY = 108
          const finH = H - finBottomY - M
          drawChart(costBySiteRef, M, finBottomY, halfW, finH, 'Cost by Site')
          drawChart(costByBrandRef, M + halfW + GAP, finBottomY, halfW, finH, 'Cost by Brand')
        },
        costsplit: () => {
          pdfHeader(doc, 'Tyres vs Maintenance Cost', `${costModeLabel(costMode)} | Last 12 months`, company, brand)
          doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...INK)
          doc.text(fmtCurrency(costSplitHeadline, currency), M, 40)
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
          doc.text(`${costModeLabel(costMode)} spend | Tyres ${fmtCurrency(costSplitSums.tyre, currency)} | Maintenance ${fmtCurrency(costSplitSums.maintenance, currency)}`, M, 46)
          if (costSplitHasData) {
            drawChart(costSplitRef, M, 52, W - 2 * M, H - 52 - M, `${costModeLabel(costMode)} spend by month`)
          } else {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED)
            doc.text('No tyre or maintenance cost recorded in the last 12 months.', M, 58)
          }
        },
        risk: () => {
          pdfHeader(doc, 'Risk Assessment', periodLabel, company, brand)
          drawChart(riskTrendRef, M, 34, halfW, 92, '6-Month Risk Score Trend')
          autoTable(doc, {
            ...pdfTableTheme(brand.accent),
            startY: 30,
            margin: { left: M + halfW + GAP },
            tableWidth: halfW,
            head: [['Site', 'Crit', 'High', 'Med', 'Low', 'Total', 'Score']],
            body: riskMatrix.map(r => [r.site, r.Critical, r.High, r.Medium, r.Low, r.total, fmtNum(r.score, 2)]),
          })
        },
        recommendations: () => {
          pdfHeader(doc, 'Recommendations', periodLabel, company, brand)
          autoTable(doc, {
            ...pdfTableTheme(brand.accent),
            startY: 30,
            head: [['Priority', 'Recommendation', 'Owner', 'Expected Impact']],
            body: recommendations.map(r => [r.priority, r.title, r.owner, r.impact]),
            columnStyles: { 1: { cellWidth: 110 }, 3: { cellWidth: 70 } },
          })
        },
        actionplan: () => {
          pdfHeader(doc, 'Action Plan', periodLabel, company, brand)
          autoTable(doc, {
            ...pdfTableTheme(brand.accent),
            startY: 30,
            head: [['Action', 'Priority', 'Timeline', 'Owner', 'Est. Saving', 'Status']],
            body: actionPlan.map(a => [a.action, a.priority, a.timeline, a.owner, a.saving, a.status]),
            columnStyles: { 0: { cellWidth: 120 } },
          })
        },
      }
      const pdfSeq = visibleBuiltinKeys.filter(k => pdfPageRenderers[k])
      const finalPdfSeq = pdfSeq.length ? pdfSeq : ['kpis']
      finalPdfSeq.forEach((k, i) => { if (i > 0) doc.addPage(); pdfPageRenderers[k]() })

      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

      doc.save(`${reportFileName('TyrePulse Executive Report', periodLabel, reportDateLabel())}.pdf`)
    } catch (e) {
      setExportError(toUserMessage(e, 'The PDF export could not be created.'))
    } finally {
      setExporting(false)
    }
  }, [period, site, rootCauses, riskMatrix, actionPlan, recommendations, kpiCards, currency, company, branding, chartImg, visibleBuiltinKeys, costMode, costSplitHeadline, costSplitSums, costSplitHasData])

  // ── PowerPoint Export (WYSIWYG white deck: title + KPI + chart + table slides) ─
  const exportPPTX = useCallback(async () => {
    setExporting(true)
    setExportError(null)
    try {
      const PptxGen = (await import('pptxgenjs')).default
      const pptx = new PptxGen()
      pptx.defineLayout({ name: 'TP16x9', width: 13.33, height: 7.5 })
      pptx.layout = 'TP16x9'
      const periodLabel = site === ALL_SITES ? periodValueLabel(period) : `${periodValueLabel(period)} | ${site}`
      const BG = 'FFFFFF', INK = '0F172A', SUBTLE = '475569', MUTED = '94A3B8'
      const CARD = 'F8FAFC', BORDER = 'E2E8F0', HEAD = '1E293B'

      // Title slide
      let s = pptx.addSlide(); s.background = { color: BG }
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 3.4, w: 13.33, h: 0.06, fill: { color: '10B981' } })
      s.addText('Executive Intelligence Report', { x: 0.6, y: 2.3, w: 12.1, h: 1, fontSize: 34, bold: true, color: INK })
      s.addText(`${company}  |  ${periodLabel}`, { x: 0.6, y: 3.6, w: 12.1, h: 0.6, fontSize: 16, color: SUBTLE })
      s.addText(`Generated ${reportDateLabel()}  |  CONFIDENTIAL`, { x: 0.6, y: 4.2, w: 12.1, h: 0.5, fontSize: 12, color: MUTED })

      // KPI dashboard slide (labelled cards)
      const kpiSlide = () => {
        const sl = pptx.addSlide(); sl.background = { color: BG }
        sl.addText('KPI Dashboard', { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: INK })
        const perRow = 4, cardW = 2.98, cardH = 1.28, gx = 0.13, gy = 0.22, ox = 0.5, oy = 1.15
        kpiCards.forEach((c, i) => {
          const col = i % perRow, row = Math.floor(i / perRow)
          const x = ox + col * (cardW + gx), y = oy + row * (cardH + gy)
          sl.addShape(pptx.ShapeType.roundRect, { x, y, w: cardW, h: cardH, rectRadius: 0.06, fill: { color: CARD }, line: { color: BORDER, width: 1 } })
          sl.addText(String(c.value), { x: x + 0.12, y: y + 0.12, w: cardW - 0.24, h: 0.5, fontSize: 17, bold: true, color: INK })
          sl.addText(String(c.label), { x: x + 0.12, y: y + 0.62, w: cardW - 0.24, h: 0.34, fontSize: 9, color: SUBTLE })
          sl.addText(`Target: ${String(c.target)}`, { x: x + 0.12, y: y + 0.94, w: cardW - 0.24, h: 0.28, fontSize: 8, color: MUTED })
        })
      }

      // One slide per chart (WYSIWYG capture)
      const chartSlide = (ref, title) => {
        const sl = pptx.addSlide(); sl.background = { color: BG }
        sl.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: INK })
        const img = chartImg(ref)
        if (img) sl.addImage({ data: img, x: 1.4, y: 1.1, w: 10.5, h: 5.9, sizing: { type: 'contain', w: 10.5, h: 5.9 } })
        else sl.addText('No chart data', { x: 0.5, y: 3.2, w: 12.3, h: 0.6, fontSize: 14, color: SUBTLE, align: 'center' })
      }

      // Table slides
      const tableSlide = (title, head, rows) => {
        const sl = pptx.addSlide(); sl.background = { color: BG }
        sl.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: INK })
        const body = rows.length ? rows : [head.map(() => 'N/A')]
        const tbl = [
          head.map(h => ({ text: String(h), options: { bold: true, color: 'FFFFFF', fill: { color: HEAD } } })),
          ...body.map(r => r.map(c => ({ text: String(c), options: { color: INK } }))),
        ]
        sl.addTable(tbl, {
          x: 0.5, y: 1.05, w: 12.3, border: { type: 'solid', color: BORDER, pt: 0.5 },
          fontSize: 10, valign: 'middle', autoPage: true, autoPageRepeatHeader: true,
          fill: { color: BG },
        })
      }

      // Slides are emitted per visible built-in section, in the customized order.
      const pptxRenderers = {
        kpis: () => kpiSlide(),
        rootcause: () => {
          chartSlide(rootCauseRef, 'Root Cause Analysis')
          tableSlide('Root Cause Analysis', ['Root Cause', 'Count', '%', 'Cost Impact'],
            rootCauses.map(c => [c.label, c.count, fmtPct(c.pct), fmtCurrency(c.cost, currency)]))
        },
        financial: () => {
          chartSlide(costTrendRef, 'Monthly Spend Trend')
          chartSlide(costBySiteRef, 'Cost by Site')
          chartSlide(costByBrandRef, 'Cost by Brand')
        },
        costsplit: () => {
          chartSlide(costSplitRef, `Tyres vs Maintenance Cost: ${costModeLabel(costMode)}`)
          tableSlide('Tyres vs Maintenance Cost', ['Month', 'Tyres', 'Maintenance', 'Combined'],
            costSplitByMonth.map(m => [m.month, fmtCurrency(m.tyre, currency), fmtCurrency(m.maintenance, currency), fmtCurrency(pickCost('combined', m), currency)]))
        },
        risk: () => {
          chartSlide(riskTrendRef, '6-Month Risk Score Trend')
          tableSlide('Risk Matrix', ['Site', 'Critical', 'High', 'Medium', 'Low', 'Total', 'Risk Score'],
            riskMatrix.map(r => [r.site, r.Critical, r.High, r.Medium, r.Low, r.total, fmtNum(r.score, 2)]))
        },
        recommendations: () => {
          tableSlide('Recommendations', ['Priority', 'Recommendation', 'Owner', 'Expected Impact'],
            recommendations.map(r => [r.priority, r.title, r.owner, r.impact]))
        },
        actionplan: () => {
          tableSlide('Action Plan', ['Action', 'Priority', 'Timeline', 'Owner', 'Est. Saving', 'Status'],
            actionPlan.map(a => [a.action, a.priority, a.timeline, a.owner, a.saving, a.status]))
        },
      }
      const pptxSeq = visibleBuiltinKeys.filter(k => pptxRenderers[k])
      ;(pptxSeq.length ? pptxSeq : ['kpis']).forEach(k => pptxRenderers[k]())

      await pptx.writeFile({ fileName: `${reportFileName('TyrePulse Executive Report', periodLabel, reportDateLabel())}.pptx` })
    } catch (e) {
      setExportError(toUserMessage(e, 'The PowerPoint export could not be created.'))
    } finally {
      setExporting(false)
    }
  }, [period, site, kpiCards, rootCauses, riskMatrix, actionPlan, recommendations, currency, company, chartImg, visibleBuiltinKeys, costMode, costSplitByMonth])

  // ── Excel Export ──────────────────────────────────────────────────────────
  const exportExcel = useCallback(async () => {
    setExportError(null)
    try {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    const kpiRows = kpiExportRows(hk, { currency, totalSpend, projectedAnnual })
    const addSheet = (rows, name) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name)

    // Sheets are appended per visible built-in section, in the customized order.
    const excelRenderers = {
      kpis: () => addSheet(kpiRows, 'KPI Dashboard'),
      rootcause: () => addSheet(rootCauses.map(c => ({
        'Root Cause': c.label, Count: c.count, 'Pct of Total': c.pct.toFixed(1) + '%',
        'Est Cost Impact': Math.round(c.cost), Prevention: c.prevention,
      })), 'Root Cause Analysis'),
      financial: () => {
        addSheet(costTrend.byMonth.map(m => ({ Month: m.month, 'Total Cost': Math.round(m.totalCost), Count: m.count })), 'Cost Trend')
        addSheet(costBySite.map(s => ({ Site: s.site, 'Total Cost': Math.round(s.cost) })), 'Cost by Site')
      },
      costsplit: () => addSheet(costSplitByMonth.map(m => ({
        Month: m.month, Tyres: Math.round(m.tyre), Maintenance: Math.round(m.maintenance),
        Combined: Math.round(pickCost('combined', m)),
      })), 'Tyres vs Maintenance'),
      risk: () => addSheet(riskMatrix.map(r => ({
        Site: r.site, Critical: r.Critical, High: r.High, Medium: r.Medium,
        Low: r.Low, Rated: r.rated, Total: r.total, 'Risk Score': fmtNum(r.score, 2),
      })), 'Risk Matrix'),
      recommendations: () => addSheet(recommendations.map(r => ({
        Priority: r.priority, Recommendation: r.title, Owner: r.owner, 'Expected Impact': r.impact,
      })), 'Recommendations'),
      actionplan: () => addSheet(actionPlan.map(a => ({
        Action: a.action, Priority: a.priority, Timeline: a.timeline,
        Owner: a.owner, 'Est Saving': a.saving, Status: a.status,
      })), 'Action Plan'),
    }
    const excelSeq = visibleBuiltinKeys.filter(k => excelRenderers[k])
    ;(excelSeq.length ? excelSeq : ['kpis']).forEach(k => excelRenderers[k]())

    XLSX.writeFile(wb, `${reportFileName('TyrePulse Executive Report', periodValueLabel(period), site === ALL_SITES ? '' : site, reportDateLabel())}.xlsx`)
    } catch (e) {
      setExportError(toUserMessage(e, 'The Excel export could not be created.'))
    }
  }, [hk, site, rootCauses, riskMatrix, actionPlan, recommendations, costTrend, costBySite, totalSpend, projectedAnnual, currency, period, visibleBuiltinKeys, costSplitByMonth])

  const exportActionPlanPDF = useCallback(async () => {
    setExportError(null)
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = await loadAutoTable()
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(branding)
      const scopeLabel = site === ALL_SITES ? periodValueLabel(period) : `${periodValueLabel(period)} | ${site}`
      pdfHeader(doc, 'Action Plan', `Period: ${scopeLabel}`, company, brand)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 28,
        head: [['#', 'Phase', 'Action', 'Priority', 'Timeline', 'Owner', 'Est. Saving', 'Status']],
        body: actionPlan.map((a, i) => [i + 1, actionPhaseOf(i), a.action, a.priority, a.timeline, a.owner, a.saving, a.status]),
        columnStyles: { 2: { cellWidth: 95 } },
      })
      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
      doc.save(`${reportFileName('TyrePulse Action Plan', scopeLabel, reportDateLabel())}.pdf`)
    } catch (e) {
      setExportError(toUserMessage(e, 'The action plan PDF could not be created.'))
    }
  }, [actionPlan, company, branding, period, site])

  // ── Loading / Error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface-0)] flex items-center justify-center">
        <div className="text-center" role="status" aria-live="polite">
          <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" aria-hidden="true" />
          <p className="text-[var(--text-secondary)] text-sm">{t('execreport.states.loading')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--surface-0)] flex items-center justify-center">
        <Card className="max-w-md text-center">
          <AlertOctagon className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-[var(--text-primary)] font-semibold mb-1">{t('execreport.states.errorTitle')}</p>
          <p className="text-[var(--text-secondary)] text-sm" role="alert">{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey(k => k + 1)}
            className="mt-4 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Retry
          </button>
        </Card>
      </div>
    )
  }

  // Empty scope: the header (period + site filters) stays on screen so the user
  // can widen the scope again; an early return here used to strand them.
  const isEmpty = !periodRecords.length && !periodInspections.length

  const trendIcon = costTrend.trend === 'improving'
    ? <TrendingDown className="w-4 h-4 text-emerald-400" />
    : costTrend.trend === 'worsening'
      ? <TrendingUp className="w-4 h-4 text-red-400" />
      : <Minus className="w-4 h-4 text-amber-400" />

  // ── Chart options: light "report view" theme when reportMode is on, so the
  // on-screen charts match the white-paper PNG captured for PDF/PPTX exports. ──
  const barOpts   = reportMode ? paperChartOptions(CHART_DARK_NO_LEGEND) : CHART_DARK_NO_LEGEND
  const horizOpts = reportMode ? paperChartOptions(CHART_HORIZONTAL)     : CHART_HORIZONTAL
  const lineBase  = { ...CHART_DARK, plugins: { ...CHART_DARK.plugins, legend: { display: false } } }
  const lineOpts  = reportMode ? paperChartOptions(lineBase) : lineBase
  const rcaBase   = {
    ...CHART_DARK_NO_LEGEND,
    plugins: {
      ...CHART_DARK_NO_LEGEND.plugins,
      tooltip: {
        ...CHART_DARK.plugins.tooltip,
        callbacks: {
          label: ctx => `${ctx.raw} events (${((ctx.raw / Math.max(periodRecords.length, 1)) * 100).toFixed(1)}%)`,
        },
      },
    },
  }
  const rcaOpts = reportMode ? paperChartOptions(rcaBase) : rcaBase

  // ── Added-widget renderer (palette blocks) ─────────────────────────────────
  // Every widget is bound to data already computed above - honest empty states,
  // never fabricated. A hover "remove" control mirrors the Customize panel.
  const emptyState = (label) => (
    <div className="h-full min-h-[10rem] flex items-center justify-center text-[var(--text-dim)] text-sm">{label}</div>
  )

  function renderWidget(item) {
    switch (item.key) {
      case 'w:note':
        return (
          <div className="relative group">
            <button
              onClick={() => removeBlock(item.id)}
              title="Remove this block"
              aria-label="Remove this block"
              className="no-print absolute top-3 right-3 z-10 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg bg-[var(--surface-2)] hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-dim)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none transition-opacity"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <StickyNote className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Note</span>
              </div>
              <textarea
                value={item.text || ''}
                onChange={(e) => updateBlockText(item.id, e.target.value)}
                placeholder="Type a note, commentary, or context for this report..."
                aria-label="Report note"
                rows={3}
                className="w-full resize-y bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-lg p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-blue-400"
              />
            </Card>
          </div>
        )
      case 'w:divider':
        return (
          <div className="relative group py-1">
            <button
              onClick={() => removeBlock(item.id)}
              title="Remove this block"
              aria-label="Remove this divider"
              className="no-print absolute top-0 right-0 z-10 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg bg-[var(--surface-2)] hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-dim)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none transition-opacity"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <hr className="border-t border-[var(--border-bright)]" />
          </div>
        )
      case 'w:chartCostTrend':
        return (
          <WidgetShell onRemove={() => removeBlock(item.id)} icon={BarChart2} title="Monthly Spend Trend" subtitle="Tyre spend by month">
            <div className="h-64">
              {costTrend.byMonth.length > 0 ? <Bar data={costTrendChart} options={barOpts} /> : emptyState('No trend data')}
            </div>
          </WidgetShell>
        )
      case 'w:chartRootCause':
        return (
          <WidgetShell onRemove={() => removeBlock(item.id)} icon={AlertTriangle} title="Root Cause Breakdown" subtitle="Failure driver classification">
            <div className="h-64">
              {rootCauses.length > 0 ? <Bar data={rcaChart} options={rcaOpts} /> : emptyState('No root cause data')}
            </div>
          </WidgetShell>
        )
      case 'w:chartCostSite':
        return (
          <WidgetShell onRemove={() => removeBlock(item.id)} icon={Building2} title="Cost by Site" subtitle="Cost distribution across sites">
            <div className="h-64">
              {costBySite.length > 0 ? <Bar data={costBySiteChart} options={horizOpts} /> : emptyState('No site data')}
            </div>
          </WidgetShell>
        )
      case 'w:chartCostBrand':
        return (
          <WidgetShell onRemove={() => removeBlock(item.id)} icon={Package} title="Cost by Brand" subtitle="Cost distribution across brands">
            <div className="h-64">
              {costByBrand.length > 0 ? <Bar data={costByBrandChart} options={horizOpts} /> : emptyState('No brand data')}
            </div>
          </WidgetShell>
        )
      case 'w:chartRiskTrend':
        return (
          <WidgetShell onRemove={() => removeBlock(item.id)} icon={ShieldAlert} title="Risk Score Trend" subtitle="Six-month fleet risk score">
            <div className="h-64">
              {riskTrend6m.some(m => m.score != null) ? <Line data={riskTrendChart} options={lineOpts} /> : emptyState('No rated tyres in the last six months')}
            </div>
          </WidgetShell>
        )
      case 'w:tableTopVehicles':
        return (
          <WidgetShell onRemove={() => removeBlock(item.id)} icon={Users} title="Top Cost Vehicles" subtitle="Highest-cost vehicles in the period">
            <EnterpriseTable
              columns={topVehicleColumns}
              data={topCostVehicles}
              getRowId={(r) => String(r.asset_no)}
              emptyMessage="No priced tyre records in this scope, so there is no vehicle cost ranking."
              exportFileName={reportFileName('TyrePulse Top Cost Vehicles', reportDateLabel())}
              reportMeta={reportMeta}
              enableColumnFilters={false}
              initialPageSize={25}
            />
          </WidgetShell>
        )
      case 'w:insights':
        return (
          <WidgetShell onRemove={() => removeBlock(item.id)} icon={Award} title="Key Wins & Concerns" subtitle="Best-performing brand and highest-risk site">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {bestBrandByScore ? (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Award className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Key Win</span>
                  </div>
                  <p className="text-sm text-[var(--text-primary)]">
                    {bestBrandByScore.brand} leads on cost efficiency at {fmtCpk(bestBrandByScore.avgCpk, currency)}/km with a {fmtPct(bestBrandByScore.failureRate * 100)} failure rate.
                  </p>
                </div>
              ) : (
                <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-lg p-3 text-sm text-[var(--text-dim)]">No brand benchmark yet.</div>
              )}
              {worstSiteByFailure ? (
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertOctagon className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">Key Concern</span>
                  </div>
                  <p className="text-sm text-[var(--text-primary)]">
                    {worstSiteByFailure.site} shows the highest failure rate at {fmtPct(worstSiteByFailure.rate * 100)} and needs an operations review.
                  </p>
                </div>
              ) : (
                <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-lg p-3 text-sm text-[var(--text-dim)]">No site risk outlier yet.</div>
              )}
            </div>
          </WidgetShell>
        )
      default:
        return null
    }
  }

  return (
    <div className={`text-[var(--text-primary)] print:bg-white print:text-black space-y-6${reportMode ? ' tp-report-paper' : ''}`}>

      {/* ── Print + Report-view Styles ─────────────────────────────────────
          .tp-report-paper flips every var-driven surface to a white "paper"
          theme with zero JSX churn, so the on-screen report matches the PDF. */}
      <style>{`
        .tp-report-paper {
          --surface-0:#ffffff; --surface-1:#f8fafc; --surface-2:#f1f5f9; --surface-3:#e2e8f0;
          --border-dim:#e5e7eb; --border-bright:#cbd5e1;
          --text-primary:#0f172a; --text-secondary:#334155; --text-muted:#64748b; --text-dim:#94a3b8;
          background:#ffffff;
        }
        /* Darken accent text so status colours stay legible on white paper
           (the 400-weight tints are tuned for dark backgrounds). */
        .tp-report-paper .text-emerald-400 { color:#047857 !important; }
        .tp-report-paper .text-emerald-500 { color:#059669 !important; }
        .tp-report-paper .text-amber-400   { color:#b45309 !important; }
        .tp-report-paper .text-red-400     { color:#dc2626 !important; }
        .tp-report-paper .text-orange-400  { color:#ea580c !important; }
        .tp-report-paper .text-blue-400    { color:#2563eb !important; }
        @media print {
          .no-print { display: none !important; }
          .print-break { page-break-before: always; }
          body { background: white; color: black; }
          [class*="surface-0"], [class*="surface-1"], [class*="surface-2"], [class*="surface-3"] { background: white !important; }
          [class*="border-dim"], [class*="border-bright"] { border-color: #e5e7eb !important; }
          [class*="text-primary"] { color: black !important; }
          [class*="text-secondary"], [class*="text-muted"], [class*="text-dim"] { color: #6b7280 !important; }
        }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-[var(--surface-0)] backdrop-blur border-b border-[var(--border-dim)] no-print">
        <div className="max-w-[1800px] mx-auto px-4 py-3">
          <PageHeader
            title={t('execreport.header.title')}
            subtitle={t('execreport.header.subtitle', { company: companyName, date: formatDate(new Date(), 'All', { day: '2-digit', month: 'long', year: 'numeric' }) })}
            icon={FileText}
            actions={<>
              <PeriodFilter records={periodBasis} value={period} onChange={setPeriod} />
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span>Site</span>
                <select
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  aria-label="Filter the report by site"
                  className="min-h-[44px] rounded-lg border border-[var(--border-bright)] bg-[var(--surface-1)] px-2 text-xs text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <option value={ALL_SITES}>All sites</option>
                  {sites.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setCustomizeOpen(o => !o)}
                aria-pressed={customizeOpen}
                title="Customize which sections show, reorder them, and add blocks"
                className={`${HEADER_BTN} ${
                  customizeOpen
                    ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500'
                    : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] border-[var(--border-bright)]'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
                Customize
              </button>
              <button
                type="button"
                onClick={() => setReportMode(m => !m)}
                aria-pressed={reportMode}
                title={reportMode ? 'Switch back to dark dashboard' : 'Switch to white report view'}
                className={`${HEADER_BTN} ${
                  reportMode
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500'
                    : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] border-[var(--border-bright)]'
                }`}
              >
                <ScrollText className="w-3.5 h-3.5" aria-hidden="true" />
                {reportMode ? 'Dashboard view' : 'Report view'}
              </button>
              <button
                type="button"
                onClick={exportExcel}
                disabled={isEmpty}
                className={`${HEADER_BTN} bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] border-[var(--border-bright)]`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                {t('execreport.header.excel')}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className={`${HEADER_BTN} bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] border-[var(--border-bright)]`}
              >
                <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                {t('execreport.header.print')}
              </button>
              <button
                type="button"
                onClick={exportPDF}
                disabled={exporting || isEmpty}
                aria-busy={exporting}
                className={`${HEADER_BTN} bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500`}
              >
                {exporting
                  ? <div className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  : <Download className="w-3.5 h-3.5" aria-hidden="true" />
                }
                {t('execreport.header.exportPdf')}
              </button>
              <button
                type="button"
                onClick={exportPPTX}
                disabled={exporting || isEmpty}
                aria-busy={exporting}
                title="Export a white 16:9 PowerPoint deck"
                className={`${HEADER_BTN} bg-orange-600 hover:bg-orange-500 text-white border-orange-500`}
              >
                <Presentation className="w-3.5 h-3.5" aria-hidden="true" />
                Export PPTX
              </button>
              <button
                type="button"
                onClick={() => setEmailModalOpen(true)}
                disabled={isEmpty}
                className={`${HEADER_BTN} bg-blue-600 hover:bg-blue-700 text-white border-blue-500`}
              >
                <Mail className="w-3.5 h-3.5" aria-hidden="true" />{t('execreport.header.emailReport')}
              </button>
            </>}
          />
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-4 py-6 flex flex-col gap-8">

        {/* Capped-view advisory: shown only when a raw pull hit its row ceiling. */}
        {cappedView && (
          <div className="no-print flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              Capped view: this report shows the most recent 50,000 rows per dataset for the
              selected period, so totals reflect that capped sample, not the full history. Narrow
              the period for complete figures.
            </span>
          </div>
        )}

        {exportError && (
          <div role="alert" className="no-print flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
            <AlertOctagon className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span className="flex-1">{exportError}</span>
            <button
              type="button"
              onClick={() => setExportError(null)}
              aria-label="Dismiss export error"
              className="min-h-[44px] min-w-[44px] -my-2.5 inline-flex items-center justify-center rounded-lg hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Scope strip: what the report below is built from, stated up front so
            every figure is read against its real basis. */}
        <section aria-label="Report scope" className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: 'Scope', value: site === ALL_SITES ? 'All sites' : site, sub: periodValueLabel(period) },
            { label: 'Tyre records', value: periodRecords.length.toLocaleString(), sub: cappedView ? 'Capped sample' : 'In selected period' },
            { label: 'Risk rated', value: riskTally.rated.toLocaleString(), sub: periodRecords.length ? `${fmtPct((riskTally.rated / periodRecords.length) * 100)} of records` : 'No records' },
            { label: 'Inspections', value: periodInspections.length.toLocaleString(), sub: `${periodActions.length.toLocaleString()} corrective actions` },
            { label: 'Tyre spend', value: fmtCurrency(totalSpend, currency), sub: spendBasisNote },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-[var(--border-dim)] bg-[var(--surface-1)] px-4 py-3 min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{k.label}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-[var(--text-primary)] truncate" title={String(k.value)}>{k.value}</p>
              <p className="text-[11px] text-[var(--text-muted)] truncate" title={k.sub}>{k.sub}</p>
            </div>
          ))}
        </section>

        {/* Multi-year expense trend + forecast (on-screen intelligence block). */}
        <YearlyTrendPanel title="Expense trend by year (tyres / spare / lubricant) + forecast" />

        {isEmpty ? (
          <Card className="text-center py-10">
            <FileText className="w-10 h-10 text-[var(--text-dim)] mx-auto mb-3" aria-hidden="true" />
            <p className="text-[var(--text-primary)] font-semibold mb-1">{t('execreport.states.emptyTitle')}</p>
            <p className="text-[var(--text-secondary)] text-sm max-w-md mx-auto">{t('execreport.states.emptyDesc')}</p>
            {(site !== ALL_SITES || (period && period.mode !== 'all')) && (
              <button
                type="button"
                onClick={() => { setSite(ALL_SITES); setPeriod({ mode: 'all' }) }}
                className="mt-4 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-[var(--border-bright)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-sm text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                Show all sites and all time
              </button>
            )}
          </Card>
        ) : (<>

        {/* User-added palette widgets, positioned by the shared flex order. */}
        {addedBlocks.map((item) => (
          <div key={item.id} style={{ order: orderOf(item.id) }}>
            {renderWidget(item)}
          </div>
        ))}

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 1 - EXECUTIVE SUMMARY
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div style={blockStyle('summary')} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <Card className="border-emerald-800/40">
            {/* Confidential badge */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <Star className="w-5 h-5 text-emerald-400" />
                </div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('execreport.section1.title')}</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-red-500/10 text-red-400 border border-red-500/20 tracking-wide">
                  {t('execreport.section1.confidential')}
                </span>
                <span className="px-2.5 py-1 text-xs rounded-full bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border-bright)]">
                  {t('execreport.section1.badge')}
                </span>
              </div>
            </div>


            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
             <div className="lg:col-span-2 bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5 space-y-4">
              <div className="border-l-4 border-emerald-500 pl-4">
                <p className="text-sm leading-relaxed text-[var(--text-primary)]">
                  {t('execreport.section1.p1', {
                    period: periodValueLabel(period),
                    company: companyName,
                    fleetSize: fleetSize.toLocaleString(),
                    records: periodRecords.length.toLocaleString(),
                    spend: fmtCurrency(totalSpend, currency),
                    cpk: fmtCpk(hk.fleetAvgCpk, currency),
                  })}
                  {momChange !== null && (
                    <>{' '}
                      <strong className={momChange < 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {momChange < 0
                          ? t('execreport.section1.momImproved', { pct: fmtPct(Math.abs(momChange)) })
                          : t('execreport.section1.momIncreased', { pct: fmtPct(Math.abs(momChange)) })}
                      </strong>
                    </>
                  )}
                </p>
              </div>

              <div className="border-l-4 border-amber-500 pl-4">
                <p className="text-sm leading-relaxed text-[var(--text-primary)]">
                  {t('execreport.section1.p2', {
                    criticalCount: riskTally.rated ? riskTally.Critical : 'N/A',
                    criticalPct: fmtRatio(hk.criticalRate),
                    failureRate: fmtRatio(hk.failureRate),
                    inspectionCompliance: fmtPct(hk.inspectionPct),
                  })}
                  {topRootCause && (
                    <>{' '}
                      {t('execreport.section1.p2RootCause', {
                        rootCause: t(`execreport.rootCauses.${topRootCause.key}.label`),
                        pct: fmtPct(topRootCause.pct),
                      })}
                    </>
                  )}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {bestBrandByScore && (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Award className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">{t('execreport.section1.keyWinLabel')}</span>
                    </div>
                    <p className="text-sm text-[var(--text-primary)]">
                      {t('execreport.section1.keyWinText', {
                        brand: bestBrandByScore.brand,
                        cpk: fmtCpk(bestBrandByScore.avgCpk, currency),
                        rate: fmtPct(bestBrandByScore.failureRate * 100),
                      })}
                    </p>
                  </div>
                )}
                {worstSiteByFailure && (
                  <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertOctagon className="w-4 h-4 text-red-400" />
                      <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">{t('execreport.section1.keyConcernLabel')}</span>
                    </div>
                    <p className="text-sm text-[var(--text-primary)]">
                      {t('execreport.section1.keyConcernText', {
                        site: worstSiteByFailure.site,
                        rate: fmtPct(worstSiteByFailure.rate * 100),
                      })}
                    </p>
                  </div>
                )}
              </div>

              <div className="border-l-4 border-blue-500 pl-4">
                <p className="text-sm leading-relaxed text-[var(--text-primary)]">
                  {t('execreport.section1.p4', { projectedAnnual: fmtCurrency(projectedAnnual, currency) })}
                  {savingsOpportunity > 1000 && (
                    <>{' '}{t('execreport.section1.p4Savings', { savings: `${fmtCurrency(savingsOpportunity, currency)}` })}</>
                  )}
                  {' '}
                  {t('execreport.section1.p4Closing', {
                    avgLife: fmtNum(hk.avgTyreLifeKm),
                    availability: fmtPct(hk.availabilityPct),
                  })}
                </p>
              </div>
             </div>

             {/* Right: Key Highlights (saves vertical space — UI/UX #12) */}
             <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 flex flex-col gap-2.5">
               <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-0.5">{t('execreport.section1.keyHighlights')}</p>
               {[
                 { key: 'fleetAvailability', label: t('execreport.section1.highlights.fleetAvailability'), value: fmtPct(hk.availabilityPct), status: pctStatus(hk.availabilityPct, 95) },
                 { key: 'inspectionCompliance', label: t('execreport.section1.highlights.inspectionCompliance'), value: fmtPct(hk.inspectionPct), status: pctStatus(hk.inspectionPct) },
                 { key: 'failureRate', label: t('execreport.section1.highlights.failureRate'), value: fmtRatio(hk.failureRate), status: lowerIsBetter(hk.failureRate, 0.1, 0.25) },
                 { key: 'avgCostPerKm', label: t('execreport.section1.highlights.avgCostPerKm'), value: fmtCpk(hk.fleetAvgCpk, currency), status: 'info' },
                 { key: 'criticalAlerts', label: t('execreport.section1.highlights.criticalAlerts'), value: riskTally.rated ? riskTally.Critical.toLocaleString() : 'N/A', status: riskTally.rated ? (riskTally.Critical === 0 ? 'green' : 'red') : 'neutral' },
               ].map((h) => (
                 <div key={h.key} className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-lg px-3 py-2.5 flex items-center justify-between">
                   <span className="text-xs text-[var(--text-secondary)]">{h.label}</span>
                   <span className="text-right">
                     <span className={`block text-base font-bold tabular-nums ${h.status === 'info' ? 'text-[var(--text-primary)]' : (STATUS_COLORS[h.status] || STATUS_COLORS.neutral).text}`}>{h.value}</span>
                     {h.status !== 'info' && <span className="block text-[10px] text-[var(--text-muted)]">{statusLabel(h.status)}</span>}
                   </span>
                 </div>
               ))}
             </div>
            </div>
          </Card>
        </motion.div>


        {/* ═══════════════════════════════════════════════════════════════
            SECTION 2 - KPI DASHBOARD
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div style={blockStyle('kpis')} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
          <Card>
            <SectionHeader
              icon={BarChart2}
              title="Section 2: KPI Dashboard"
              subtitle={`${periodRecords.length.toLocaleString()} tyre records · ${periodValueLabel(period)}`}
              badge="12 Metrics"
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {kpiCards.map((card) => {
                const sc = STATUS_COLORS[card.status]
                const IconComp = card.icon
                return (
                  <div
                    key={card.label}
                    className={`rounded-xl p-3 border ${sc.border} ${sc.bg} flex flex-col gap-2`}
                  >
                    <div className="flex items-center justify-between">
                      <IconComp className={`w-4 h-4 ${sc.text}`} aria-hidden="true" />
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-secondary)]">
                        <span className={`w-2 h-2 rounded-full ${sc.dot}`} aria-hidden="true" />
                        {statusLabel(card.status)}
                      </span>
                    </div>
                    <div>
                      <p className={`text-lg font-bold leading-tight tabular-nums ${sc.text}`}>{card.value}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-tight">{card.label}</p>
                    </div>
                    <p className="text-xs text-[var(--text-dim)] leading-tight">Target: {card.target}</p>
                  </div>
                )
              })}
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 3 - ROOT CAUSE ANALYSIS
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div style={blockStyle('rootcause')} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
          <Card>
            <SectionHeader
              icon={AlertTriangle}
              title="Section 3: Root Cause Analysis"
              subtitle="Failure driver classification across all tyre events in period"
              badge={`${rootCauses.length} Categories`}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart */}
              <div className="h-64">
                {rootCauses.length > 0 ? (
                  <Bar
                    ref={rootCauseRef}
                    data={rcaChart}
                    options={rcaOpts}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No root cause data</div>
                )}
              </div>

              {/* Table */}
              <EnterpriseTable
                columns={rootCauseColumns}
                data={rootCauses}
                getRowId={(r) => r.key}
                emptyMessage="No tyre events in this scope to classify."
                exportFileName={reportFileName('TyrePulse Root Causes', reportDateLabel())}
                reportMeta={reportMeta}
                enableColumnFilters={false}
                initialPageSize={25}
              />
            </div>

            {/* Prevention summaries */}
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {rootCauses.slice(0, 3).map(cause => (
                <div key={cause.key} className="bg-[var(--surface-1)] rounded-lg p-3 border border-[var(--border-dim)]">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cause.color }} />
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">{cause.label}</span>
                    <span className="ml-auto text-xs text-red-400 font-bold">{fmtPct(cause.pct)}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">{cause.prevention}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 4 - FINANCIAL IMPACT
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div style={blockStyle('financial')} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
          <Card>
            <SectionHeader
              icon={DollarSign}
              title="Section 4: Financial Impact"
              subtitle="Cost analysis, budget tracking, and financial projections"
            />

            {/* Top stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Total Period Spend', value: fmtCurrency(totalSpend, currency), sub: `${periodValueLabel(period)} | ${spendBasisNote}`, color: 'text-[var(--text-primary)]' },
                { label: 'Projected Annual', value: fmtCurrency(projectedAnnual, currency), sub: 'at current rate', color: 'text-amber-400' },
                { label: 'Budget vs Actual', value: totalBudget > 0 && totalSpend != null ? fmtPct(((totalSpend / totalBudget) * 100)) : 'N/A', sub: totalBudget > 0 ? `Budget: ${fmtCurrency(totalBudget, currency)}` : 'No budget data', color: totalBudget > 0 && totalSpend != null && totalSpend > totalBudget ? 'text-red-400' : 'text-emerald-400' },
                { label: 'Savings Opportunity', value: fmtCurrency(savingsOpportunity, currency), sub: 'if CPK reached fleet best', color: 'text-emerald-400' },
              ].map(s => (
                <div key={s.label} className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4">
                  <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-[var(--text-primary)] font-medium mt-1">{s.label}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2">
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Monthly Spend Trend</p>
                <div className="h-52">
                  {costTrend.byMonth.length > 0 ? (
                    <Bar ref={costTrendRef} data={costTrendChart} options={barOpts} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No trend data</div>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Cost by Site <span className="normal-case font-normal text-[var(--text-dim)]">(priced tyre records)</span></p>
                <div className="h-52">
                  {costBySite.length > 0 ? (
                    <Bar ref={costBySiteRef} data={costBySiteChart} options={horizOpts} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No site data</div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
              {/* Cost by Brand */}
              <div>
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Cost by Brand <span className="normal-case font-normal text-[var(--text-dim)]">(priced tyre records)</span></p>
                <div className="h-44">
                  {costByBrand.length > 0 ? (
                    <Bar ref={costByBrandRef} data={costByBrandChart} options={horizOpts} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No brand data</div>
                  )}
                </div>
              </div>

              {/* Top 5 cost drivers */}
              <div>
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Top 5 Cost Vehicles</p>
                <div className="space-y-2">
                  {topCostVehicles.map((v, i) => (
                    <div key={v.asset_no} className="flex items-center gap-3 bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--border-dim)]">
                      <span className="text-xs font-bold text-[var(--text-muted)] w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{v.asset_no}</p>
                        <p className="text-xs text-[var(--text-muted)]">{v.site || 'N/A'} | {v.count} tyres</p>
                      </div>
                      <span className="text-xs font-bold text-amber-400">{fmtCurrency(v.cost, currency)}</span>
                    </div>
                  ))}
                  {topCostVehicles.length === 0 && (
                    <p className="text-xs text-[var(--text-dim)] text-center py-4">No vehicle cost data</p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION - TYRES VS MAINTENANCE COST
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div style={blockStyle('costsplit')} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.18 }}>
          <Card>
            <SectionHeader
              icon={Layers}
              title="Tyres vs Maintenance Cost"
              subtitle="Combined, tyre only or maintenance only spend across the last 12 months"
              badge={costModeLabel(costMode)}
            />

            {/* Segmented mode switch */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="inline-flex rounded-lg border border-[var(--border-bright)] overflow-hidden">
                {COST_MODES.map((m) => {
                  const on = costMode === m.key
                  return (
                    <button
                      key={m.key}
                      onClick={() => setCostMode(m.key)}
                      aria-pressed={on}
                      className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                        on
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      {m.label}
                    </button>
                  )
                })}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">{fmtCurrency(costSplitHeadline, currency)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{costModeLabel(costMode)} spend, last 12 months</p>
              </div>
            </div>

            {/* Split summary tiles */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: 'Tyres', value: costSplitSums.tyre },
                { label: 'Maintenance', value: costSplitSums.maintenance },
                { label: 'Combined', value: costSplitSums.combined },
              ].map(s => (
                <div key={s.label} className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-3">
                  <p className="text-base font-bold tabular-nums text-[var(--text-primary)]">{fmtCurrency(s.value, currency)}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Monthly chart */}
            <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">{costModeLabel(costMode)} spend by month</p>
            <div className="h-64">
              {costSplitState === 'loading' ? (
                <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">Loading cost split...</div>
              ) : costSplitState === 'error' ? (
                <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">Cost split unavailable</div>
              ) : costSplitHasData ? (
                <Bar ref={costSplitRef} data={costSplitChart} options={barOpts} />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No tyre or maintenance cost recorded in the last 12 months</div>
              )}
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 5 - RISK ASSESSMENT
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div style={blockStyle('risk')} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}>
          <Card>
            <SectionHeader
              icon={ShieldAlert}
              title="Section 5: Risk Assessment"
              subtitle="Fleet risk exposure, site matrix, and risk trend analysis"
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Fleet risk score */}
              <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 flex flex-col items-center justify-center text-center">
                <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wide font-medium mb-3">Fleet Risk Score</p>
                <div className={`text-5xl font-black mb-2 tabular-nums ${(STATUS_COLORS[fleetRiskBand.key] || STATUS_COLORS.neutral).text}`}>
                  {fmtNum(fleetRiskScore, 2)}
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  {fleetRiskScore == null
                    ? 'No tyre in this scope carries a risk rating yet'
                    : `out of 4.00 (max), from ${riskTally.rated.toLocaleString()} rated of ${periodRecords.length.toLocaleString()} records`}
                </p>
                <div
                  className="mt-3 w-full bg-[var(--surface-3)] rounded-full h-2"
                  role="meter"
                  aria-label="Fleet risk score"
                  aria-valuemin={0}
                  aria-valuemax={4}
                  aria-valuenow={fleetRiskScore == null ? undefined : Number(fleetRiskScore.toFixed(2))}
                  aria-valuetext={fleetRiskScore == null ? 'Not rated' : `${fleetRiskScore.toFixed(2)} of 4, ${fleetRiskBand.label}`}
                >
                  <div
                    className={`h-2 rounded-full transition-all ${(STATUS_COLORS[fleetRiskBand.key] || STATUS_COLORS.neutral).dot}`}
                    style={{ width: `${fleetRiskScore == null ? 0 : Math.min((fleetRiskScore / 4) * 100, 100)}%` }}
                  />
                </div>
                <p className={`text-xs font-semibold mt-2 uppercase ${(STATUS_COLORS[fleetRiskBand.key] || STATUS_COLORS.neutral).text}`}>
                  {fleetRiskBand.label}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 w-full text-xs">
                  {[
                    { label: 'Critical', count: riskTally.Critical, color: 'text-red-400' },
                    { label: 'High', count: riskTally.High, color: 'text-orange-400' },
                    { label: 'Medium', count: riskTally.Medium, color: 'text-amber-400' },
                    { label: 'Low', count: riskTally.Low, color: 'text-emerald-400' },
                  ].map(item => (
                    <div key={item.label} className="bg-[var(--surface-1)] rounded-lg p-2 border border-[var(--border-dim)]">
                      <p className={`text-base font-bold ${item.color}`}>{item.count}</p>
                      <p className="text-[var(--text-muted)]">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Risk trend chart */}
              <div>
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">6-Month Risk Score Trend</p>
                <div className="h-56" role="img" aria-label={`Six month fleet risk score trend: ${riskTrend6m.map(m => `${m.month} ${fmtNum(m.score, 2)}`).join(', ')}`}>
                  {riskTrend6m.some(m => m.score != null)
                    ? <Line ref={riskTrendRef} data={riskTrendChart} options={lineOpts} />
                    : <div className="h-full flex items-center justify-center text-center px-4 text-[var(--text-dim)] text-sm">No rated tyres in the last six months, so there is no risk trend to draw.</div>}
                </div>
              </div>

              {/* Risk heat map */}
              <div>
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Site Risk Heat Map</p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {riskMatrix.slice(0, 10).map(row => {
                    const band = riskBand(row.score)
                    const sc = band.key === 'red' ? 'bg-red-500/20 border-red-500/30 text-red-400'
                      : band.key === 'amber' ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                      : band.key === 'green' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                      : 'bg-[var(--surface-2)] border-[var(--border-dim)] text-[var(--text-muted)]'
                    return (
                      <div key={row.site} className={`flex items-center justify-between rounded-lg px-3 py-2 border ${sc} text-xs`}>
                        <span className="font-medium text-[var(--text-primary)]">{row.site}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-red-400">{row.Critical}C</span>
                          <span className="text-orange-400">{row.High}H</span>
                          <span className="text-amber-400">{row.Medium}M</span>
                          <span className="font-bold" title={band.label}>{fmtNum(row.score, 1)}</span>
                        </div>
                      </div>
                    )
                  })}
                  {riskMatrix.length === 0 && (
                    <p className="text-xs text-[var(--text-dim)] text-center py-6">No risk data</p>
                  )}
                </div>
              </div>
            </div>

            {/* Risk matrix table */}
            <div className="mt-6">
              <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Risk Matrix: Sites × Risk Level</p>
              <EnterpriseTable
                columns={riskMatrixColumns}
                data={riskMatrix}
                getRowId={(r) => r.site}
                emptyMessage="No site in this scope has tyre records."
                exportFileName={reportFileName('TyrePulse Risk Matrix', reportDateLabel())}
                reportMeta={reportMeta}
                enableColumnFilters={false}
                initialPageSize={25}
              />
            </div>

            {/* Top 10 high risk records */}
            <div className="mt-6">
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Top 10 Highest-Risk Records</p>
                <EnterpriseTable
                  columns={highRiskColumns}
                  data={top10HighRisk}
                  getRowId={(r, i) => String(r.id ?? i)}
                  emptyMessage="No Critical or High rated tyres in this scope."
                  exportFileName={reportFileName('TyrePulse Highest Risk Records', reportDateLabel())}
                  reportMeta={reportMeta}
                  initialPageSize={25}
                />
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 6 - RECOMMENDATIONS
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div style={blockStyle('recommendations')} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.25 }}>
          <Card>
            <SectionHeader
              icon={Target}
              title="Section 6: Recommendations"
              subtitle="Prioritised management recommendations based on fleet intelligence"
              badge={`${recommendations.length} Actions`}
            />

            <div className="space-y-3">
              {recommendations.map((rec, i) => (
                <div
                  key={i}
                  className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 hover:border-[var(--border-bright)] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PRIORITY_STYLES[rec.priority]}`}>
                        {rec.priority}
                      </span>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{rec.title}</h3>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Building2 className="w-3 h-3 text-[var(--text-muted)]" />
                      <span className="text-xs text-[var(--text-secondary)]">{rec.owner}</span>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-2">{rec.description}</p>
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="w-3 h-3 text-emerald-500" />
                    <span className="text-xs text-emerald-400">{rec.impact}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 7 - ACTION PLAN
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div style={blockStyle('actionplan')} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }}>
          <Card>
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">Section 7: Action Plan</h2>
                  <p className="text-sm text-[var(--text-secondary)] mt-0.5">30/60/90 day structured delivery plan</p>
                </div>
              </div>
              <button
                onClick={exportActionPlanPDF}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-all no-print"
              >
                <Download className="w-3.5 h-3.5" />
                Export Action Plan
              </button>
            </div>

            {/* Phase summary: counts per 30/60/90 day phase (text + colour) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {[
                { label: '30-Day Actions: Immediate', phase: '0-30 days', color: 'text-red-400 border-red-500/30 bg-red-500/5' },
                { label: '60-Day Actions: Short Term', phase: '30-60 days', color: 'text-amber-400 border-amber-500/30 bg-amber-500/5' },
                { label: '90-Day Actions: Strategic', phase: '60-90 days', color: 'text-blue-400 border-blue-500/30 bg-blue-500/5' },
              ].map(ph => (
                <div key={ph.phase} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${ph.color}`}>
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="text-xs font-semibold">{ph.label}</span>
                  <span className="ml-auto text-xs tabular-nums">{actionPlanRows.filter(r => r.phase === ph.phase).length} actions</span>
                </div>
              ))}
            </div>
            <EnterpriseTable
              columns={actionPlanColumns}
              data={actionPlanRows}
              getRowId={(r) => r.id}
              emptyMessage="No actions in the plan."
              exportFileName={reportFileName('TyrePulse Action Plan', reportDateLabel())}
              reportMeta={reportMeta}
              initialPageSize={25}
            />

            {/* Summary footer */}
            <div className="mt-4 border-t border-[var(--border-dim)] pt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                {actionPlan.length} actions identified
              </span>
              <span className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                Total opportunity: {fmtCurrency(totalSpend == null ? null : (savingsOpportunity ?? 0) + totalSpend * 0.15, currency)} estimated annually
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-blue-400" />
                4 stakeholder groups engaged
              </span>
              <span className="ml-auto text-[var(--text-dim)]">
                Report generated {formatDate(new Date(), 'All', { day: '2-digit', month: 'long', year: 'numeric' })}
              </span>
            </div>
          </Card>
        </motion.div>
        </>)}

      </div>

      {/* ── Customize drawer ─────────────────────────────────────────────
          Show/hide, reorder, remove, and add report blocks. Persisted to
          localStorage. Var-driven surfaces keep it readable on white paper. */}
      {customizeOpen && (
        <div className="no-print fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setCustomizeOpen(false)}
          />
          <div role="dialog" aria-modal="true" aria-label="Customize report" className="relative w-full max-w-md h-full bg-[var(--surface-0)] border-l border-[var(--border-bright)] shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-dim)]">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-blue-500/10 rounded-lg border border-blue-500/20">
                  <Settings2 className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Customize Report</h3>
                  <p className="text-xs text-[var(--text-secondary)]">Show, hide, reorder and add blocks</p>
                </div>
              </div>
              <button
                onClick={() => setCustomizeOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-muted)]"
                title="Close"
                aria-label="Close customize panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              {/* Layout list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] flex items-center gap-1.5">
                    <LayoutList className="w-3.5 h-3.5" /> Report blocks
                  </p>
                  <button
                    onClick={resetLayout}
                    className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    title="Reset to the default layout"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reset
                  </button>
                </div>
                <div className="space-y-1.5">
                  {layout.map((item, i) => {
                    const vis = item.visible !== false
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors ${
                          vis
                            ? 'bg-[var(--surface-1)] border-[var(--border-dim)]'
                            : 'bg-[var(--surface-1)]/40 border-[var(--border-dim)] opacity-60'
                        }`}
                      >
                        <GripVertical className="w-3.5 h-3.5 text-[var(--text-dim)] flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[var(--text-primary)] truncate">{blockLabel(item)}</p>
                          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">{item.builtin ? 'Section' : 'Added block'}</p>
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => moveBlock(item.id, -1)}
                            disabled={i === 0}
                            className="p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move up"
                            aria-label={`Move ${blockLabel(item)} up`}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => moveBlock(item.id, 1)}
                            disabled={i === layout.length - 1}
                            className="p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move down"
                            aria-label={`Move ${blockLabel(item)} down`}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleVisible(item.id)}
                            className={`p-1 rounded hover:bg-[var(--surface-3)] ${vis ? 'text-emerald-400' : 'text-[var(--text-dim)]'}`}
                            title={vis ? 'Hide block' : 'Show block'}
                            aria-label={`${vis ? 'Hide' : 'Show'} ${blockLabel(item)}`}
                            aria-pressed={vis}
                          >
                            {vis ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                          {!item.builtin && (
                            <button
                              onClick={() => removeBlock(item.id)}
                              className="p-1 rounded hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400"
                              title="Remove block"
                              aria-label={`Remove ${blockLabel(item)}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Add block palette */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] flex items-center gap-1.5 mb-2">
                  <Plus className="w-3.5 h-3.5" /> Add a block
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {WIDGET_DEFS.map((w) => {
                    const Icon = w.icon
                    return (
                      <button
                        key={w.key}
                        onClick={() => addWidget(w.key)}
                        className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border-dim)] hover:border-blue-400/50 hover:bg-[var(--surface-2)] text-left transition-colors"
                      >
                        <div className="p-1.5 bg-blue-500/10 rounded-lg border border-blue-500/20 flex-shrink-0">
                          <Icon className="w-4 h-4 text-blue-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[var(--text-primary)]">{w.label}</p>
                          <p className="text-[11px] text-[var(--text-muted)] leading-snug">{w.desc}</p>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-[var(--text-dim)] ml-auto flex-shrink-0 self-center" />
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-[var(--border-dim)] text-[11px] text-[var(--text-muted)]">
              Your layout is saved automatically and applies to the on-screen report and PDF, PowerPoint and Excel exports.
            </div>
          </div>
        </div>
      )}

      <EmailReportModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        reportTitle="Executive Fleet Report"
        pdfColumns={['Site', 'Critical', 'High', 'Medium', 'Low', 'Total', 'Risk Score']}
        pdfRows={riskMatrix.map(r => [r.site, r.Critical, r.High, r.Medium, r.Low, r.total, fmtNum(r.score, 2)])}
        kpiSummary={{
          'Fleet Avg CPK':          fmtCpk(hk.fleetAvgCpk, currency),
          'Total Period Spend':     fmtCurrency(totalSpend, currency),
          'Projected Annual':       fmtCurrency(projectedAnnual, currency),
          'Failure Rate':           fmtRatio(hk.failureRate),
          'Inspection Compliance':  fmtPct(hk.inspectionPct),
          'Fleet Availability':     fmtPct(hk.availabilityPct),
          'Scrap Rate':             fmtRatio(hk.scrapRate),
          'Savings Opportunity':    fmtCurrency(savingsOpportunity, currency),
        }}
        period={periodValueLabel(period) || 'Quarter'}
      />
    </div>
  )
}
