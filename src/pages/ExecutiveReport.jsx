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
  ChevronRight, Award, Package, Users, Mail,
  ScrollText, Presentation,
  Settings2, Plus, Eye, EyeOff, X, ArrowUp, ArrowDown,
  Trash2, GripVertical, RotateCcw, StickyNote, SeparatorHorizontal,
  LayoutList, Layers,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
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
import { fetchAllPages } from '../lib/fetchAll'
import { recordCost } from '../lib/analyticsEngine'
import { loadCostSplit } from '../lib/api/costSummary'
import { COST_MODES, pickCost, costModeLabel, pickMonthly, splitTotals } from '../lib/costSources'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { captureChartOnPaper, paperChartOptions } from '../lib/chartCapture'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import PageHeader from '../components/ui/PageHeader'
import PeriodFilter, { filterByPeriodValue, periodLabel as periodValueLabel } from '../components/ui/PeriodFilter'

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
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
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
    x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#1f2937' } },
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
// the shared PeriodFilter, so historic imports always have a matching window.
function filterByPeriod(records, period, dateField = 'issue_date') {
  return filterByPeriodValue(records, period, dateField)
}

// ── Root cause classifier ─────────────────────────────────────────────────────
const RC_CATEGORIES = [
  {
    key: 'inflation',
    label: 'Inflation Issues',
    color: '#ef4444',
    keywords: ['inflation', 'pressure', 'under-inflat', 'over-inflat', 'deflat', 'blow'],
    prevention: 'Implement weekly pressure checks, install TPMS sensors, calibrate gauges quarterly.',
  },
  {
    key: 'alignment',
    label: 'Alignment / Suspension',
    color: '#f97316',
    keywords: ['align', 'suspension', 'camber', 'toe', 'wheel balance', 'balancing', 'bounce'],
    prevention: 'Schedule alignment checks every 20,000 km, inspect after impact events.',
  },
  {
    key: 'driver',
    label: 'Driver Behavior',
    color: '#eab308',
    keywords: ['driver', 'driving', 'speed', 'braking', 'cornering', 'abuse', 'misuse', 'overload'],
    prevention: 'Deploy telematics, run defensive driving training, review high-loss records monthly.',
  },
  {
    key: 'road',
    label: 'Road / Load Conditions',
    color: '#8b5cf6',
    keywords: ['road', 'terrain', 'load', 'overload', 'weight', 'debris', 'pothole', 'cut'],
    prevention: 'Map high-risk routes, enforce load compliance, carry puncture repair kits.',
  },
  {
    key: 'maintenance',
    label: 'Maintenance Quality',
    color: '#06b6d4',
    keywords: ['mainten', 'workshop', 'rotation', 'install', 'torque', 'fitment', 'rim'],
    prevention: 'Audit workshop standards, enforce mandatory service intervals, verify torque spec.',
  },
  {
    key: 'manufacturing',
    label: 'Manufacturing Defects',
    color: '#10b981',
    keywords: ['defect', 'manufactur', 'warranty', 'sidewall', 'bead', 'delamination', 'separation'],
    prevention: 'Raise warranty claims, audit supplier quality, inspect all incoming tyres.',
  },
  {
    key: 'other',
    label: 'Other / Unclassified',
    color: '#6b7280',
    keywords: [],
    prevention: 'Investigate individual records and assign to appropriate root cause category.',
  },
]

function classifyRootCause(record) {
  const text = [record.findings, record.category, record.risk_level]
    .join(' ')
    .toLowerCase()
  for (const cat of RC_CATEGORIES.slice(0, -1)) {
    if (cat.keywords.some(kw => text.includes(kw))) return cat.key
  }
  // Additional heuristics
  if (record.risk_level === 'Critical' || record.risk_level === 'High') {
    if (text.includes('tread')) return 'maintenance'
    if (text.includes('pressure')) return 'inflation'
  }
  return 'other'
}

function computeRootCauses(records) {
  const counts = {}
  RC_CATEGORIES.forEach(c => { counts[c.key] = { count: 0, cost: 0 } })
  records.forEach(r => {
    const key = classifyRootCause(r)
    counts[key].count += 1
    counts[key].cost += recordCost(r)
  })
  const total = records.length
  return RC_CATEGORIES.map(cat => ({
    ...cat,
    count:   counts[cat.key].count,
    cost:    counts[cat.key].cost,
    pct:     total > 0 ? (counts[cat.key].count / total) * 100 : 0,
  })).filter(c => c.count > 0).sort((a, b) => b.count - a.count)
}

// ── Number formatters ────────────────────────────────────────────────────────
function fmtCurrency(n, currency) {
  if (!isFinite(n) || n === 0) return `${currency} 0`
  return `${currency} ${Math.round(n).toLocaleString()}`
}
function fmtNum(n, decimals = 0) {
  if (!isFinite(n)) return '0'
  return n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function fmtPct(n) { return `${fmtNum(n, 1)}%` }
function fmtCpk(n, currency) {
  if (!isFinite(n) || n === 0) return `${currency} 0.00`
  return `${currency} ${n.toFixed(4)}`
}

// ── Status color helpers ──────────────────────────────────────────────────────
function cpkStatus(cpk) {
  if (cpk <= 0.005) return 'green'
  if (cpk <= 0.012) return 'amber'
  return 'red'
}
function pctStatus(pct, goodAbove = 85) {
  if (pct >= goodAbove) return 'green'
  if (pct >= goodAbove * 0.7) return 'amber'
  return 'red'
}
function failStatus(rate) {
  if (rate <= 0.1) return 'green'
  if (rate <= 0.25) return 'amber'
  return 'red'
}
const STATUS_COLORS = {
  green: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30', dot: 'bg-emerald-400' },
  amber: { text: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/30', dot: 'bg-amber-400' },
  red:   { text: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30', dot: 'bg-red-400' },
}

const PRIORITY_STYLES = {
  Critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  High:     'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  Medium:   'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  Low:      'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
}

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
        className="no-print absolute top-3 right-3 z-10 p-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-dim)] opacity-0 group-hover:opacity-100 transition-opacity"
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
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [period,      setPeriod]      = useState({ mode: 'all' })
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
        // Paginate past the PostgREST 1000-row cap so analytics see the FULL
        // dataset (otherwise totals/KPIs are computed on a 1000-row sample).
        const [rRes, iRes, aRes, fRes] = await Promise.all([
          fetchAllPages((from, to) => applyCountry(supabase.from('tyre_records').select(
            'id,asset_no,site,brand,position,risk_level,category,findings,km_at_fitment,km_at_removal,cost_per_tyre,qty,issue_date,tread_depth,pressure_reading,country'
          ), activeCountry).order('issue_date', { ascending: false }).range(from, to), { max: 200000 }),
          fetchAllPages((from, to) => applyCountry(supabase.from('inspections').select(
            'id,asset_no,site,status,scheduled_date,completed_date,findings,country'
          ), activeCountry).order('scheduled_date', { ascending: false }).range(from, to), { max: 50000 }),
          fetchAllPages((from, to) => applyCountry(supabase.from('corrective_actions').select(
            'id,site,status,priority,title,created_at,resolved_at,country'
          ), activeCountry).order('created_at', { ascending: false }).range(from, to), { max: 50000 }),
          applyCountry(supabase.from('vehicle_fleet').select('asset_no,site,vehicle_type,monthly_tyre_budget,country'), activeCountry).then(
            res => ({ data: res.data || [], error: null })
          ).catch(() => ({ data: [], error: null })),
        ])
        if (cancelled) return
        if (rRes.error) throw rRes.error
        if (iRes.error) throw iRes.error
        if (aRes.error) throw aRes.error
        setRecords(rRes.data || [])
        setInspections(iRes.data || [])
        setActions(aRes.data || [])
        setFleet(fRes.data || [])
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeCountry])

  // ── Tyres vs Maintenance cost split load (12 calendar months) ──────────────
  useEffect(() => {
    let cancelled = false
    setCostSplitState('loading')
    loadCostSplit({ country: activeCountry })
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
  }, [activeCountry])

  // ── Period-filtered datasets ───────────────────────────────────────────────
  const periodRecords     = useMemo(() => filterByPeriod(records,     period, 'issue_date'),      [records,     period])
  const periodInspections = useMemo(() => filterByPeriod(inspections, period, 'scheduled_date'),  [inspections, period])
  const periodActions     = useMemo(() => filterByPeriod(actions,     period, 'created_at'),      [actions,     period])

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const fleetSize = useMemo(() =>
    fleet.length > 0
      ? fleet.length
      : new Set(records.map(r => r.asset_no).filter(Boolean)).size,
    [fleet, records]
  )

  const kpis        = useMemo(() => computeAllKpis(periodRecords, periodInspections, periodActions, fleetSize), [periodRecords, periodInspections, periodActions, fleetSize])
  const costTrend   = useMemo(() => computeCostTrend(periodRecords), [periodRecords])
  const vendors     = useMemo(() => computeVendorPerformance(periodRecords), [periodRecords])
  const rootCauses  = useMemo(() => computeRootCauses(periodRecords), [periodRecords])

  // ── Financial computations ────────────────────────────────────────────────
  const totalSpend = useMemo(() =>
    periodRecords.reduce((s, r) => s + recordCost(r), 0),
    [periodRecords]
  )

  const totalBudget = useMemo(() => {
    if (!fleet.length) return 0
    // Months covered by the selected period, measured from the data itself.
    const dates = periodRecords.map(r => r.issue_date).filter(Boolean).sort()
    const months = dates.length
      ? Math.max(1, Math.round((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 2_592_000_000) + 1)
      : 1
    return fleet.reduce((s, v) => s + (Number(v.monthly_tyre_budget) || 0), 0) * months
  }, [fleet, period])

  const projectedAnnual = useMemo(() => {
    if (!costTrend.avgMonthlyCost) return 0
    return costTrend.avgMonthlyCost * 12
  }, [costTrend])

  const topCostVehicles = useMemo(() => {
    const byAsset = {}
    periodRecords.forEach(r => {
      if (!r.asset_no) return
      if (!byAsset[r.asset_no]) byAsset[r.asset_no] = { asset_no: r.asset_no, site: r.site, cost: 0, count: 0 }
      byAsset[r.asset_no].cost  += recordCost(r)
      byAsset[r.asset_no].count += 1
    })
    return Object.values(byAsset).sort((a, b) => b.cost - a.cost).slice(0, 5)
  }, [periodRecords])

  const costBySite = useMemo(() => {
    const by = {}
    periodRecords.forEach(r => {
      const site = r.site || 'Unknown'
      if (!by[site]) by[site] = 0
      by[site] += recordCost(r)
    })
    return Object.entries(by).map(([site, cost]) => ({ site, cost })).sort((a, b) => b.cost - a.cost)
  }, [periodRecords])

  const costByBrand = useMemo(() => {
    const by = {}
    periodRecords.forEach(r => {
      const brand = r.brand || 'Unknown'
      if (!by[brand]) by[brand] = 0
      by[brand] += recordCost(r)
    })
    return Object.entries(by).map(([brand, cost]) => ({ brand, cost })).sort((a, b) => b.cost - a.cost).slice(0, 8)
  }, [periodRecords])

  // ── Cost savings opportunity ──────────────────────────────────────────────
  const savingsOpportunity = useMemo(() => {
    if (!kpis.cpk.fleetAvgCpk || !kpis.cpk.p10Cpk) return 0
    const improvement = kpis.cpk.fleetAvgCpk - kpis.cpk.p10Cpk
    if (improvement <= 0) return 0
    const totalKm = periodRecords.filter(r => {
      const f = Number(r.km_at_fitment), rem = Number(r.km_at_removal)
      return isFinite(f) && isFinite(rem) && rem > f
    }).reduce((s, r) => s + (Number(r.km_at_removal) - Number(r.km_at_fitment)), 0)
    const dates2 = periodRecords.map(r => r.issue_date).filter(Boolean).sort()
    const periodDays = dates2.length
      ? Math.max(30, (new Date(dates2[dates2.length - 1]) - new Date(dates2[0])) / 86_400_000 + 1)
      : 90
    return improvement * totalKm * (12 / periodDays * 30)
  }, [kpis, periodRecords, period])

  // ── Risk matrix ───────────────────────────────────────────────────────────
  const riskMatrix = useMemo(() => {
    const sites = [...new Set(periodRecords.map(r => r.site).filter(Boolean))]
    const levels = ['Critical', 'High', 'Medium', 'Low']
    return sites.map(site => {
      const siteRecs = periodRecords.filter(r => r.site === site)
      const counts = {}
      levels.forEach(l => { counts[l] = siteRecs.filter(r => r.risk_level === l).length })
      const score = (counts.Critical * 4 + counts.High * 3 + counts.Medium * 2 + counts.Low) /
        Math.max(siteRecs.length, 1)
      return { site, ...counts, total: siteRecs.length, score }
    }).sort((a, b) => b.score - a.score)
  }, [periodRecords])

  const fleetRiskScore = useMemo(() => {
    const total = periodRecords.length
    if (!total) return 0
    const weighted =
      periodRecords.filter(r => r.risk_level === 'Critical').length * 4 +
      periodRecords.filter(r => r.risk_level === 'High').length * 3 +
      periodRecords.filter(r => r.risk_level === 'Medium').length * 2 +
      periodRecords.filter(r => r.risk_level === 'Low').length
    return weighted / total
  }, [periodRecords])

  const top10HighRisk = useMemo(() =>
    [...periodRecords]
      .filter(r => r.risk_level === 'Critical' || r.risk_level === 'High')
      .sort((a, b) => {
        const order = { Critical: 0, High: 1 }
        return (order[a.risk_level] ?? 2) - (order[b.risk_level] ?? 2)
      })
      .slice(0, 10),
    [periodRecords]
  )

  // ── Risk trend (6-month) ──────────────────────────────────────────────────
  const riskTrend6m = useMemo(() => {
    const months = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      months.push(key)
    }
    return months.map(mo => {
      const recs = records.filter(r => {
        if (!r.issue_date) return false
        const k = r.issue_date.slice(0, 7)
        return k === mo
      })
      const total = recs.length
      if (!total) return { month: mo, score: 0 }
      const score =
        (recs.filter(r => r.risk_level === 'Critical').length * 4 +
         recs.filter(r => r.risk_level === 'High').length * 3 +
         recs.filter(r => r.risk_level === 'Medium').length * 2 +
         recs.filter(r => r.risk_level === 'Low').length) / total
      return { month: mo, score }
    })
  }, [records])

  // ── Month-over-month cost change ──────────────────────────────────────────
  const momChange = useMemo(() => {
    const months = costTrend.byMonth
    if (months.length < 2) return null
    const last = months[months.length - 1]
    const prev = months[months.length - 2]
    if (!prev.totalCost) return null
    return ((last.totalCost - prev.totalCost) / prev.totalCost) * 100
  }, [costTrend])

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
    const inspComp = kpis.inspectionCompliance?.compliancePct ?? 0
    const scrapRate = kpis.scrapRate?.scrapRate ?? 0
    const failRate  = kpis.failureRate?.failureRate ?? 0
    const critRate  = kpis.failureRate?.criticalRate ?? 0
    const fleetCpk  = kpis.cpk?.fleetAvgCpk ?? 0

    if (critRate > 0.15) {
      recs.push({
        priority: 'Critical',
        title: t('execreport.recommendations.criticalRemoval.title'),
        description: t('execreport.recommendations.criticalRemoval.description', { pct: fmtPct(critRate * 100) }),
        impact: t('execreport.recommendations.criticalRemoval.impact', { amount: fmtCurrency(kpis.scrapRate?.estimatedScrapCost * 0.4, currency) }),
        owner: t('execreport.owners.fleetManager'),
      })
    }

    if (inspComp < 85) {
      recs.push({
        priority: critRate > 0.1 ? 'Critical' : 'High',
        title: t('execreport.recommendations.inspectionCompliance.title'),
        description: t('execreport.recommendations.inspectionCompliance.description', { pct: fmtPct(inspComp) }),
        impact: t('execreport.recommendations.inspectionCompliance.impact', { amount: fmtCurrency(totalSpend * 0.15, currency) }),
        owner: t('execreport.owners.management'),
      })
    }

    if (bestBrandByScore && vendors.length > 2) {
      const worst = vendors[vendors.length - 1]
      recs.push({
        priority: 'High',
        title: t('execreport.recommendations.procurementReview.title', { brand: worst.brand }),
        description: t('execreport.recommendations.procurementReview.description', { brand: worst.brand, cpk: fmtCpk(worst.avgCpk, currency), rate: fmtPct(worst.failureRate * 100) }),
        impact: t('execreport.recommendations.procurementReview.impact', { bestBrand: bestBrandByScore.brand, amount: fmtCurrency(savingsOpportunity * 0.3, currency) }),
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

    if (scrapRate > 0.15) {
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

    if (kpis.cpk.fleetAvgCpk > 0 && savingsOpportunity > 5000) {
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
        impact: t('execreport.recommendations.tyreRotation.impact', { amount: fmtCurrency(totalSpend * 0.1, currency) }),
        owner: t('execreport.owners.workshop'),
      })
    }

    return recs.slice(0, 10)
  }, [kpis, vendors, topRootCause, worstSiteByFailure, totalSpend, savingsOpportunity, currency, costBySite, t])

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
        owner: t('execreport.owners.fleetManager'), saving: fmtCurrency(totalSpend * 0.08, currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.mandatePressureCheck'),
        priority: 'High', timeline: t('execreport.actionPlan.daysSuffix', { range: '1-7' }),
        owner: t('execreport.owners.workshop'), saving: fmtCurrency(topRootCause?.cost * 0.3 || 0, currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.issueCorrectiveNotices'),
        priority: 'High', timeline: t('execreport.actionPlan.daysSuffix', { range: '7-30' }),
        owner: t('execreport.owners.management'), saving: fmtCurrency(totalSpend * 0.1, currency), status: t('execreport.status.open'),
      },
    ]
    const actions60 = [
      {
        action: t('execreport.actionPlan.actions.procurementReviewBrand'),
        priority: 'High', timeline: t('execreport.actionPlan.daysSuffix', { range: '30-60' }),
        owner: t('execreport.owners.procurement'), saving: fmtCurrency(savingsOpportunity * 0.3, currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.deployTelematics'),
        priority: 'High', timeline: t('execreport.actionPlan.daysSuffix', { range: '30-60' }),
        owner: t('execreport.owners.fleetManager'), saving: fmtCurrency(totalSpend * 0.12, currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.implementRotation'),
        priority: 'Medium', timeline: t('execreport.actionPlan.daysSuffix', { range: '30-60' }),
        owner: t('execreport.owners.workshop'), saving: fmtCurrency(totalSpend * 0.1, currency), status: t('execreport.status.open'),
      },
    ]
    const actions90 = [
      {
        action: t('execreport.actionPlan.actions.completeTpms'),
        priority: 'High', timeline: t('execreport.actionPlan.daysSuffix', { range: '60-90' }),
        owner: t('execreport.owners.fleetManager'), saving: fmtCurrency(totalSpend * 0.15, currency), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.monthlyReview'),
        priority: 'Medium', timeline: t('execreport.actionPlan.daysSuffix', { range: '60-90' }),
        owner: t('execreport.owners.management'), saving: t('execreport.actionPlan.processLabel'), status: t('execreport.status.open'),
      },
      {
        action: t('execreport.actionPlan.actions.negotiateContracts'),
        priority: 'Medium', timeline: t('execreport.actionPlan.daysSuffix', { range: '60-90' }),
        owner: t('execreport.owners.procurement'), saving: fmtCurrency(savingsOpportunity * 0.4, currency), status: t('execreport.status.open'),
      },
    ]
    return [...actions30, ...actions60, ...actions90]
  }, [periodRecords, kpis, totalSpend, savingsOpportunity, topRootCause, currency, t])

  // ── KPI cards (single source: on-screen grid + PDF/PPTX exports) ───────────
  const kpiCards = useMemo(() => [
    {
      label: t('execreport.kpi.fleetAvgCpk'),
      value: fmtCpk(kpis.cpk.fleetAvgCpk, currency),
      status: cpkStatus(kpis.cpk.fleetAvgCpk),
      target: '< 0.012',
      icon: DollarSign,
    },
    {
      label: t('execreport.kpi.medianCpk'),
      value: fmtCpk(kpis.cpk.medianCpk, currency),
      status: cpkStatus(kpis.cpk.medianCpk),
      target: '< 0.012',
      icon: BarChart2,
    },
    {
      label: t('execreport.kpi.fleetAvgTyreLife'),
      value: `${fmtNum(kpis.avgTyreLife.avgKm)} km`,
      status: kpis.avgTyreLife.avgKm >= 60000 ? 'green' : kpis.avgTyreLife.avgKm >= 40000 ? 'amber' : 'red',
      target: '>= 60,000 km',
      icon: Activity,
    },
    {
      label: t('execreport.kpi.inspectionCompliance'),
      value: fmtPct(kpis.inspectionCompliance.compliancePct),
      status: pctStatus(kpis.inspectionCompliance.compliancePct),
      target: '>= 85%',
      icon: CheckCircle,
    },
    {
      label: t('execreport.kpi.pressureCompliance'),
      value: fmtPct(kpis.pressureCompliance.compliancePct),
      status: pctStatus(kpis.pressureCompliance.compliancePct),
      target: '>= 90%',
      icon: Target,
    },
    {
      label: t('execreport.kpi.failureRate'),
      value: fmtPct(kpis.failureRate.failureRate * 100),
      status: failStatus(kpis.failureRate.failureRate),
      target: '< 10%',
      icon: AlertTriangle,
    },
    {
      label: t('execreport.kpi.criticalRate'),
      value: fmtPct(kpis.failureRate.criticalRate * 100),
      status: kpis.failureRate.criticalRate <= 0.05 ? 'green' : kpis.failureRate.criticalRate <= 0.15 ? 'amber' : 'red',
      target: '< 5%',
      icon: ShieldAlert,
    },
    {
      label: t('execreport.kpi.scrapRate'),
      value: fmtPct(kpis.scrapRate.scrapRate * 100),
      status: kpis.scrapRate.scrapRate <= 0.15 ? 'green' : kpis.scrapRate.scrapRate <= 0.25 ? 'amber' : 'red',
      target: '< 15%',
      icon: Package,
    },
    {
      label: t('execreport.kpi.replacementRate'),
      value: `${fmtNum(kpis.replacementRate.avgPerVehiclePerMonth, 2)}/veh/mo`,
      status: 'amber',
      target: '< 1.0',
      icon: Wrench,
    },
    {
      label: t('execreport.kpi.totalDowntimeHours'),
      value: `${fmtNum(kpis.downtimeImpact.totalDowntimeHours)} hrs`,
      status: kpis.downtimeImpact.totalDowntimeHours <= 100 ? 'green' : kpis.downtimeImpact.totalDowntimeHours <= 300 ? 'amber' : 'red',
      target: '< 100 hrs',
      icon: Clock,
    },
    {
      label: t('execreport.kpi.fleetAvailability'),
      value: fmtPct(kpis.fleetAvailability.availabilityPct),
      status: pctStatus(kpis.fleetAvailability.availabilityPct, 95),
      target: '>= 95%',
      icon: Zap,
    },
    {
      label: t('execreport.kpi.costTrend'),
      value: t(`execreport.trend.${costTrend.trend}`),
      status: costTrend.trend === 'improving' ? 'green' : costTrend.trend === 'stable' ? 'amber' : 'red',
      target: t('execreport.kpi.improvingTarget'),
      icon: TrendingUp,
    },
  ], [kpis, costTrend, currency, t])

  // ── Chart datasets ────────────────────────────────────────────────────────
  const costTrendChart = useMemo(() => ({
    labels: costTrend.byMonth.slice(-12).map(m => m.month),
    datasets: [{
      label: 'Monthly Spend',
      data: costTrend.byMonth.slice(-12).map(m => m.totalCost),
      backgroundColor: 'rgba(16,185,129,0.7)',
      borderColor: '#10b981',
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
      backgroundColor: 'rgba(99,102,241,0.7)',
      borderColor: '#6366f1',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [costBySite])

  const costByBrandChart = useMemo(() => ({
    labels: costByBrand.map(b => b.brand),
    datasets: [{
      label: 'Total Cost',
      data: costByBrand.map(b => b.cost),
      backgroundColor: 'rgba(245,158,11,0.7)',
      borderColor: '#f59e0b',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [costByBrand])

  const riskTrendChart = useMemo(() => ({
    labels: riskTrend6m.map(m => m.month),
    datasets: [{
      label: 'Risk Score',
      data: riskTrend6m.map(m => m.score),
      borderColor: '#f97316',
      backgroundColor: 'rgba(249,115,22,0.1)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: '#f97316',
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
      backgroundColor: 'rgba(20,184,166,0.7)',
      borderColor: '#14b8a6',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [costSplitSeries, costMode])

  // ── PDF Export (WYSIWYG: KPI cards + charts + tables, matches report view) ──
  const exportPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    setExporting(true)
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(branding)
      const periodLabel = periodValueLabel(period)
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
            body: riskMatrix.map(r => [r.site, r.Critical, r.High, r.Medium, r.Low, r.total, r.score.toFixed(2)]),
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
      console.error('PDF export failed', e)
    } finally {
      setExporting(false)
    }
  }, [period, kpis, rootCauses, riskMatrix, actionPlan, recommendations, kpiCards, totalSpend, projectedAnnual, costTrend, currency, company, branding, savingsOpportunity, chartImg, visibleBuiltinKeys, costMode, costSplitHeadline, costSplitSums, costSplitHasData])

  // ── PowerPoint Export (WYSIWYG white deck: title + KPI + chart + table slides) ─
  const exportPPTX = useCallback(async () => {
    const PptxGen = (await import('pptxgenjs')).default
    setExporting(true)
    try {
      const pptx = new PptxGen()
      pptx.defineLayout({ name: 'TP16x9', width: 13.33, height: 7.5 })
      pptx.layout = 'TP16x9'
      const periodLabel = periodValueLabel(period)
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
            riskMatrix.map(r => [r.site, r.Critical, r.High, r.Medium, r.Low, r.total, r.score.toFixed(2)]))
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
      console.error('PPTX export failed', e)
    } finally {
      setExporting(false)
    }
  }, [period, kpiCards, rootCauses, riskMatrix, actionPlan, recommendations, currency, company, chartImg, visibleBuiltinKeys, costMode, costSplitByMonth])

  // ── Excel Export ──────────────────────────────────────────────────────────
  const exportExcel = useCallback(async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    const kpiRows = [
      { KPI: 'Fleet Avg CPK', Value: Number(kpis.cpk.fleetAvgCpk || 0).toFixed(6), Unit: `${currency}/km` },
      { KPI: 'Median CPK', Value: Number(kpis.cpk.medianCpk || 0).toFixed(6), Unit: `${currency}/km` },
      { KPI: 'Fleet Avg Tyre Life', Value: Math.round(Number(kpis.avgTyreLife.avgKm) || 0), Unit: 'km' },
      { KPI: 'Inspection Compliance', Value: Number(kpis.inspectionCompliance.compliancePct || 0).toFixed(1), Unit: '%' },
      { KPI: 'Failure Rate', Value: (kpis.failureRate.failureRate * 100).toFixed(1), Unit: '%' },
      { KPI: 'Critical Rate', Value: (kpis.failureRate.criticalRate * 100).toFixed(1), Unit: '%' },
      { KPI: 'Scrap Rate', Value: (kpis.scrapRate.scrapRate * 100).toFixed(1), Unit: '%' },
      { KPI: 'Total Downtime Hours', Value: Math.round(kpis.downtimeImpact.totalDowntimeHours), Unit: 'hrs' },
      { KPI: 'Fleet Availability', Value: kpis.fleetAvailability.availabilityPct.toFixed(1), Unit: '%' },
      { KPI: 'Total Spend', Value: Math.round(totalSpend), Unit: currency },
      { KPI: 'Projected Annual Spend', Value: Math.round(projectedAnnual), Unit: currency },
    ]
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
        Low: r.Low, Total: r.total, 'Risk Score': r.score.toFixed(2),
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

    XLSX.writeFile(wb, `TyrePulse_Executive_Report_${periodValueLabel(period).replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [kpis, rootCauses, riskMatrix, actionPlan, recommendations, costTrend, costBySite, totalSpend, projectedAnnual, currency, period, visibleBuiltinKeys, costSplitByMonth])

  const exportActionPlanPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Action Plan', `Period: ${periodValueLabel(period)}`, company, brand)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 28,
      head: [['#', 'Action', 'Priority', 'Timeline', 'Owner', 'Est. Saving', 'Status']],
      body: actionPlan.map((a, i) => [i + 1, a.action, a.priority, a.timeline, a.owner, a.saving, a.status]),
      columnStyles: { 1: { cellWidth: 100 } },
    })
    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
    doc.save(`TyrePulse_ActionPlan_${new Date().toISOString().slice(0, 10)}.pdf`)
  }, [actionPlan, company, branding, period])

  // ── Loading / Error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface-0)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
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
          <p className="text-[var(--text-secondary)] text-sm">{error}</p>
        </Card>
      </div>
    )
  }

  if (!periodRecords.length && !periodInspections.length) {
    return (
      <div className="min-h-screen bg-[var(--surface-0)] flex items-center justify-center">
        <Card className="max-w-md text-center">
          <FileText className="w-10 h-10 text-[var(--text-dim)] mx-auto mb-3" />
          <p className="text-[var(--text-primary)] font-semibold mb-1">{t('execreport.states.emptyTitle')}</p>
          <p className="text-[var(--text-secondary)] text-sm">{t('execreport.states.emptyDesc')}</p>
        </Card>
      </div>
    )
  }

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
              className="no-print absolute top-3 right-3 z-10 p-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-dim)] opacity-0 group-hover:opacity-100 transition-opacity"
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
              className="no-print absolute top-0 right-0 z-10 p-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-dim)] opacity-0 group-hover:opacity-100 transition-opacity"
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
              {riskTrend6m.length > 0 ? <Line data={riskTrendChart} options={lineOpts} /> : emptyState('No risk trend data')}
            </div>
          </WidgetShell>
        )
      case 'w:tableTopVehicles':
        return (
          <WidgetShell onRemove={() => removeBlock(item.id)} icon={Users} title="Top Cost Vehicles" subtitle="Highest-cost vehicles in the period">
            {topCostVehicles.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-dim)]">
                      <th className="text-left py-2 px-3 text-[var(--text-secondary)] font-medium">#</th>
                      <th className="text-left py-2 px-3 text-[var(--text-secondary)] font-medium">Asset No</th>
                      <th className="text-left py-2 px-3 text-[var(--text-secondary)] font-medium">Site</th>
                      <th className="text-right py-2 px-3 text-[var(--text-secondary)] font-medium">Tyres</th>
                      <th className="text-right py-2 px-3 text-[var(--text-secondary)] font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCostVehicles.map((v, i) => (
                      <tr key={v.asset_no} className="border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)] transition-colors">
                        <td className="py-2 px-3 text-[var(--text-muted)]">{i + 1}</td>
                        <td className="py-2 px-3 text-[var(--text-primary)] font-medium">{v.asset_no}</td>
                        <td className="py-2 px-3 text-[var(--text-secondary)]">{v.site || '-'}</td>
                        <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{v.count}</td>
                        <td className="py-2 px-3 text-right text-amber-400 font-bold">{fmtCurrency(v.cost, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : emptyState('No vehicle cost data')}
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
              <PeriodFilter records={records} value={period} onChange={setPeriod} />
              <button
                onClick={() => setCustomizeOpen(o => !o)}
                aria-pressed={customizeOpen}
                title="Customize which sections show, reorder them, and add blocks"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  customizeOpen
                    ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500'
                    : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] border-[var(--border-bright)]'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
                Customize
              </button>
              <button
                onClick={() => setReportMode(m => !m)}
                aria-pressed={reportMode}
                title={reportMode ? 'Switch back to dark dashboard' : 'Switch to white report view'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  reportMode
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500'
                    : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] border-[var(--border-bright)]'
                }`}
              >
                <ScrollText className="w-3.5 h-3.5" />
                {reportMode ? 'Dashboard view' : 'Report view'}
              </button>
              <button
                onClick={exportExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] text-xs font-medium transition-all border border-[var(--border-bright)]"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                {t('execreport.header.excel')}
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] text-xs font-medium transition-all border border-[var(--border-bright)]"
              >
                <Printer className="w-3.5 h-3.5" />
                {t('execreport.header.print')}
              </button>
              <button
                onClick={exportPDF}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-all disabled:opacity-50"
              >
                {exporting
                  ? <div className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />
                  : <Download className="w-3.5 h-3.5" />
                }
                {t('execreport.header.exportPdf')}
              </button>
              <button
                onClick={exportPPTX}
                disabled={exporting}
                title="Export a white 16:9 PowerPoint deck"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium transition-all disabled:opacity-50"
              >
                <Presentation className="w-3.5 h-3.5" />
                Export PPTX
              </button>
              <button
                onClick={() => setEmailModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Mail size={16} />{t('execreport.header.emailReport')}
              </button>
            </>}
          />
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-4 py-6 flex flex-col gap-8">

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
                    cpk: fmtCpk(kpis.cpk.fleetAvgCpk, currency),
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
                    criticalCount: periodRecords.filter(r => r.risk_level === 'Critical').length,
                    criticalPct: fmtPct(kpis.failureRate.criticalRate * 100),
                    failureRate: fmtPct(kpis.failureRate.failureRate * 100),
                    inspectionCompliance: fmtPct(kpis.inspectionCompliance.compliancePct),
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
                    avgLife: fmtNum(kpis.avgTyreLife.avgKm),
                    availability: fmtPct(kpis.fleetAvailability.availabilityPct),
                  })}
                </p>
              </div>
             </div>

             {/* Right: Key Highlights (saves vertical space — UI/UX #12) */}
             <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 flex flex-col gap-2.5">
               <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-0.5">{t('execreport.section1.keyHighlights')}</p>
               {[
                 { key: 'fleetAvailability', label: t('execreport.section1.highlights.fleetAvailability'),    value: fmtPct(kpis.fleetAvailability.availabilityPct),   good: kpis.fleetAvailability.availabilityPct >= 95 },
                 { key: 'inspectionCompliance', label: t('execreport.section1.highlights.inspectionCompliance'), value: fmtPct(kpis.inspectionCompliance.compliancePct),  good: kpis.inspectionCompliance.compliancePct >= 85 },
                 { key: 'failureRate', label: t('execreport.section1.highlights.failureRate'),          value: fmtPct(kpis.failureRate.failureRate * 100),        good: kpis.failureRate.failureRate <= 0.1 },
                 { key: 'avgCostPerKm', label: t('execreport.section1.highlights.avgCostPerKm'),         value: `${fmtCpk(kpis.cpk.fleetAvgCpk, currency)}`,       good: true, neutral: true },
                 { key: 'criticalAlerts', label: t('execreport.section1.highlights.criticalAlerts'),       value: periodRecords.filter(r => r.risk_level === 'Critical').length.toLocaleString(), good: periodRecords.filter(r => r.risk_level === 'Critical').length === 0 },
               ].map((h) => (
                 <div key={h.key} className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-lg px-3 py-2.5 flex items-center justify-between">
                   <span className="text-xs text-[var(--text-secondary)]">{h.label}</span>
                   <span className={`text-base font-bold tabular-nums ${h.neutral ? 'text-[var(--text-primary)]' : h.good ? 'text-emerald-400' : 'text-amber-400'}`}>{h.value}</span>
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
                      <IconComp className={`w-4 h-4 ${sc.text}`} />
                      <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
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
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-dim)]">
                      <th className="text-left py-2 text-[var(--text-secondary)] font-medium">Cause</th>
                      <th className="text-right py-2 text-[var(--text-secondary)] font-medium">Count</th>
                      <th className="text-right py-2 text-[var(--text-secondary)] font-medium">%</th>
                      <th className="text-right py-2 text-[var(--text-secondary)] font-medium">Cost Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rootCauses.map(cause => (
                      <tr key={cause.key} className="border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)] transition-colors">
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cause.color }} />
                            <span className="text-[var(--text-primary)]">{cause.label}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right text-[var(--text-primary)] font-medium">{cause.count}</td>
                        <td className="py-2 text-right">
                          <span className="text-[var(--text-secondary)]">{fmtPct(cause.pct)}</span>
                        </td>
                        <td className="py-2 text-right text-amber-400">{fmtCurrency(cause.cost, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                { label: 'Total Period Spend', value: fmtCurrency(totalSpend, currency), sub: periodValueLabel(period), color: 'text-[var(--text-primary)]' },
                { label: 'Projected Annual', value: fmtCurrency(projectedAnnual, currency), sub: 'at current rate', color: 'text-amber-400' },
                { label: 'Budget vs Actual', value: totalBudget > 0 ? fmtPct(((totalSpend / totalBudget) * 100)) : 'N/A', sub: totalBudget > 0 ? `Budget: ${fmtCurrency(totalBudget, currency)}` : 'No budget data', color: totalBudget > 0 && totalSpend > totalBudget ? 'text-red-400' : 'text-emerald-400' },
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
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Cost by Site</p>
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
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Cost by Brand</p>
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
                        <p className="text-xs text-[var(--text-muted)]">{v.site} · {v.count} tyres</p>
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
                <div className={`text-5xl font-black mb-2 tabular-nums ${
                  fleetRiskScore >= 3 ? 'text-red-400' : fleetRiskScore >= 2 ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {fleetRiskScore.toFixed(2)}
                </div>
                <p className="text-xs text-[var(--text-muted)]">out of 4.00 (max)</p>
                <div className="mt-3 w-full bg-[var(--surface-3)] rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      fleetRiskScore >= 3 ? 'bg-red-500' : fleetRiskScore >= 2 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min((fleetRiskScore / 4) * 100, 100)}%` }}
                  />
                </div>
                <p className={`text-xs font-semibold mt-2 ${
                  fleetRiskScore >= 3 ? 'text-red-400' : fleetRiskScore >= 2 ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {fleetRiskScore >= 3 ? 'HIGH RISK' : fleetRiskScore >= 2 ? 'MODERATE RISK' : 'ACCEPTABLE RISK'}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 w-full text-xs">
                  {[
                    { label: 'Critical', count: periodRecords.filter(r => r.risk_level === 'Critical').length, color: 'text-red-400' },
                    { label: 'High', count: periodRecords.filter(r => r.risk_level === 'High').length, color: 'text-orange-400' },
                    { label: 'Medium', count: periodRecords.filter(r => r.risk_level === 'Medium').length, color: 'text-amber-400' },
                    { label: 'Low', count: periodRecords.filter(r => r.risk_level === 'Low').length, color: 'text-emerald-400' },
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
                <div className="h-56">
                  <Line ref={riskTrendRef} data={riskTrendChart} options={lineOpts} />
                </div>
              </div>

              {/* Risk heat map */}
              <div>
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Site Risk Heat Map</p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {riskMatrix.slice(0, 10).map(row => {
                    const sc = row.score >= 3 ? 'bg-red-500/20 border-red-500/30 text-red-400'
                      : row.score >= 2 ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                      : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                    return (
                      <div key={row.site} className={`flex items-center justify-between rounded-lg px-3 py-2 border ${sc} text-xs`}>
                        <span className="font-medium text-[var(--text-primary)]">{row.site}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-red-400">{row.Critical}C</span>
                          <span className="text-orange-400">{row.High}H</span>
                          <span className="text-amber-400">{row.Medium}M</span>
                          <span className="font-bold">{row.score.toFixed(1)}</span>
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
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-dim)]">
                      <th className="text-left py-2 px-3 text-[var(--text-secondary)] font-medium">Site</th>
                      <th className="text-center py-2 px-3 text-red-400 font-medium">Critical</th>
                      <th className="text-center py-2 px-3 text-orange-400 font-medium">High</th>
                      <th className="text-center py-2 px-3 text-amber-400 font-medium">Medium</th>
                      <th className="text-center py-2 px-3 text-emerald-400 font-medium">Low</th>
                      <th className="text-center py-2 px-3 text-[var(--text-secondary)] font-medium">Total</th>
                      <th className="text-center py-2 px-3 text-[var(--text-secondary)] font-medium">Risk Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskMatrix.map(row => (
                      <tr key={row.site} className="border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)] transition-colors">
                        <td className="py-2 px-3 text-[var(--text-primary)] font-medium">{row.site}</td>
                        <td className="py-2 px-3 text-center">
                          {row.Critical > 0
                            ? <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">{row.Critical}</span>
                            : <span className="text-[var(--text-dim)]">-</span>}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row.High > 0
                            ? <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-bold">{row.High}</span>
                            : <span className="text-[var(--text-dim)]">-</span>}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row.Medium > 0
                            ? <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">{row.Medium}</span>
                            : <span className="text-[var(--text-dim)]">-</span>}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row.Low > 0
                            ? <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">{row.Low}</span>
                            : <span className="text-[var(--text-dim)]">-</span>}
                        </td>
                        <td className="py-2 px-3 text-center text-[var(--text-secondary)]">{row.total}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-bold ${row.score >= 3 ? 'text-red-400' : row.score >= 2 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {row.score.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top 10 high risk records */}
            {top10HighRisk.length > 0 && (
              <div className="mt-6">
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wide">Top 10 Highest-Risk Records</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border-dim)]">
                        <th className="text-left py-2 px-3 text-[var(--text-secondary)] font-medium">Asset No</th>
                        <th className="text-left py-2 px-3 text-[var(--text-secondary)] font-medium">Site</th>
                        <th className="text-center py-2 px-3 text-[var(--text-secondary)] font-medium">Risk</th>
                        <th className="text-left py-2 px-3 text-[var(--text-secondary)] font-medium">Brand</th>
                        <th className="text-left py-2 px-3 text-[var(--text-secondary)] font-medium">Position</th>
                        <th className="text-left py-2 px-3 text-[var(--text-secondary)] font-medium">Findings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top10HighRisk.map((r, i) => (
                        <tr key={r.id || i} className="border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)] transition-colors">
                          <td className="py-2 px-3 text-[var(--text-primary)] font-medium">{r.asset_no || '-'}</td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">{r.site || '-'}</td>
                          <td className="py-2 px-3 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                              r.risk_level === 'Critical' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'
                            }`}>
                              {r.risk_level}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">{r.brand || '-'}</td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">{r.position || '-'}</td>
                          <td className="py-2 px-3 text-[var(--text-secondary)] max-w-xs truncate">{r.findings?.slice(0, 60) || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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

            {/* Phase dividers */}
            {[
              { label: '30-Day Actions: Immediate', days: '0-30', color: 'text-red-400 border-red-500/30 bg-red-500/5', rows: actionPlan.slice(0, 4) },
              { label: '60-Day Actions: Short Term', days: '30-60', color: 'text-amber-400 border-amber-500/30 bg-amber-500/5', rows: actionPlan.slice(4, 7) },
              { label: '90-Day Actions: Strategic', days: '60-90', color: 'text-blue-400 border-blue-500/30 bg-blue-500/5', rows: actionPlan.slice(7) },
            ].map(phase => (
              <div key={phase.label} className="mb-5">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border mb-3 ${phase.color}`}>
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-xs font-semibold">{phase.label}</span>
                  <ChevronRight className="w-3 h-3 ml-auto" />
                  <span className="text-xs">{phase.days} days</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border-dim)]">
                        <th className="text-left py-1.5 px-3 text-[var(--text-muted)] font-medium">Action</th>
                        <th className="text-center py-1.5 px-3 text-[var(--text-muted)] font-medium">Priority</th>
                        <th className="text-center py-1.5 px-3 text-[var(--text-muted)] font-medium">Timeline</th>
                        <th className="text-center py-1.5 px-3 text-[var(--text-muted)] font-medium">Owner</th>
                        <th className="text-right py-1.5 px-3 text-[var(--text-muted)] font-medium">Est. Saving</th>
                        <th className="text-center py-1.5 px-3 text-[var(--text-muted)] font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {phase.rows.map((action, i) => (
                        <tr key={i} className="border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)] transition-colors">
                          <td className="py-2 px-3 text-[var(--text-primary)] max-w-sm">{action.action}</td>
                          <td className="py-2 px-3 text-center">
                            <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${PRIORITY_STYLES[action.priority]}`}>
                              {action.priority}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center text-[var(--text-secondary)]">{action.timeline}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-secondary)] text-xs">{action.owner}</span>
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-400 font-medium">{action.saving}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs">
                              {action.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* Summary footer */}
            <div className="mt-4 border-t border-[var(--border-dim)] pt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                {actionPlan.length} actions identified
              </span>
              <span className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                Total opportunity: {fmtCurrency(savingsOpportunity + totalSpend * 0.15, currency)} estimated annually
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
          <div className="relative w-full max-w-md h-full bg-[var(--surface-0)] border-l border-[var(--border-bright)] shadow-2xl flex flex-col">
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
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => moveBlock(item.id, 1)}
                            disabled={i === layout.length - 1}
                            className="p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleVisible(item.id)}
                            className={`p-1 rounded hover:bg-[var(--surface-3)] ${vis ? 'text-emerald-400' : 'text-[var(--text-dim)]'}`}
                            title={vis ? 'Hide block' : 'Show block'}
                          >
                            {vis ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                          {!item.builtin && (
                            <button
                              onClick={() => removeBlock(item.id)}
                              className="p-1 rounded hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400"
                              title="Remove block"
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
        pdfRows={riskMatrix.map(r => [r.site, r.Critical, r.High, r.Medium, r.Low, r.total, r.score.toFixed(2)])}
        kpiSummary={{
          'Fleet Avg CPK':          fmtCpk(kpis.cpk.fleetAvgCpk, currency),
          'Total Period Spend':     fmtCurrency(totalSpend, currency),
          'Projected Annual':       fmtCurrency(projectedAnnual, currency),
          'Failure Rate':           fmtPct(kpis.failureRate.failureRate * 100),
          'Inspection Compliance':  fmtPct(kpis.inspectionCompliance.compliancePct),
          'Fleet Availability':     fmtPct(kpis.fleetAvailability.availabilityPct),
          'Scrap Rate':             fmtPct(kpis.scrapRate.scrapRate * 100),
          'Savings Opportunity':    fmtCurrency(savingsOpportunity, currency),
        }}
        period={periodValueLabel(period) || 'Quarter'}
      />
    </div>
  )
}
