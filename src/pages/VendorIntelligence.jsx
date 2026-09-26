import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { applyCountry } from '../lib/countryFilter'
import { normalizePosition } from '../lib/tyrePositions'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import {
  computeVendorPerformance,
  computeWorkshopPerformance,
  computeCpkByBrand,
  computeAvgTyreLife,
} from '../lib/kpiEngine'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  filterVendorRecords, uniqueSites as uniqueSitesOf, rankByScore, enrichVendors,
  actionsBySite, buildExecSummary, buildRecommendations, vendorKpis, radarSeries,
} from '../lib/vendorIntelligenceAnalytics'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { loadGovernedCostSplit } from '../lib/api/governedCost'
import { toUserMessage } from '../lib/safeError'
import {
  Trophy, Download, FileText, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, RefreshCw, Building2, Package,
  Star, Award, Medal, BarChart3, Target,
  ShieldAlert, Wrench, DollarSign, Activity, Zap, Mail, Info,
} from 'lucide-react'
import EmailReportModal from '../components/EmailReportModal'
import PageHeader from '../components/ui/PageHeader'
import PeriodFilter, { filterByPeriodValue, periodLabel } from '../components/ui/PeriodFilter'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
} from 'chart.js'
import { Bar, Radar } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
)

// ── Constants ──────────────────────────────────────────────────────────────────
// Hard ceiling for the bounded tyre_records read. Country scope stays
// server-side; a truncated read past this ceiling is surfaced as a capped note.
const ROW_CAP = 50000
const POSITIONS = ['All', 'Steer', 'Drive', 'Trailer', 'Other']
// i18n key lookup for POSITIONS labels (constant stays stable for filter value comparisons)
const POSITION_I18N_KEYS = { All: 'all', Steer: 'steer', Drive: 'drive', Trailer: 'trailer', Other: 'other' }

// Theme tokens: chartVarPlugin resolves var(--x) on the canvas, so these follow
// light and dark mode instead of being pinned to dark-only hex values.
const CHART_THEME = {
  gridColor: 'var(--panel-2)',
  tickColor: 'var(--text-muted)',
  tooltipBg: 'var(--surface-raised)',
  tooltipTitle: 'var(--text-primary)',
  tooltipBody: 'var(--text-secondary)',
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtCpk(v, currency) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${currency} ${v.toFixed(4)}`
}

function fmtNum(v, decimals = 1) {
  if (v == null || !isFinite(v)) return 'N/A'
  return v.toFixed(decimals)
}

function fmtKm(v) {
  if (v == null || !isFinite(v) || v === 0) return 'N/A'
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k km`
  return `${Math.round(v)} km`
}

function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}

function cpkColor(cpk) {
  if (cpk == null || !isFinite(cpk)) return 'text-[var(--text-muted)]'
  if (cpk <= 1.0) return 'text-green-400'
  if (cpk <= 2.0) return 'text-yellow-400'
  return 'text-red-400'
}

function cpkBgColor(cpk) {
  if (cpk == null || !isFinite(cpk)) return 'var(--panel-2)'
  if (cpk <= 1.0) return '#16a34a'
  if (cpk <= 2.0) return '#d97706'
  return '#dc2626'
}

function riskColor(rate) {
  if (rate >= 30) return 'text-red-400'
  if (rate >= 15) return 'text-yellow-400'
  return 'text-green-400'
}

function rankBadgeStyle(rank) {
  if (rank === 1) return { bg: 'bg-yellow-500/10 border-yellow-500/50', text: 'text-yellow-500', medal: true }
  if (rank === 2) return { bg: 'bg-[var(--surface-2)] border-[var(--border-bright)]', text: 'text-[var(--text-secondary)]', medal: true }
  if (rank === 3) return { bg: 'bg-amber-700/10 border-amber-700/40', text: 'text-amber-600', medal: true }
  return { bg: 'bg-[var(--surface-2)] border-[var(--border-bright)]', text: 'text-[var(--text-secondary)]', medal: false }
}

/** Rank marker: an SVG medal plus the rank number, never an emoji. */
function RankMark({ rank, className = '' }) {
  const badge = rankBadgeStyle(rank)
  return (
    <span className={`inline-flex items-center gap-1 font-bold ${badge.text} ${className}`}>
      {badge.medal && <Medal size={14} aria-hidden="true" />}
      <span>#{rank}</span>
    </span>
  )
}

function miniBar(pct, color = colorAt(0)) {
  const clamped = Math.min(Math.max(pct, 0), 100)
  return (
    <div className="h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden mt-1" aria-hidden="true">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${clamped}%`, backgroundColor: color }} />
    </div>
  )
}

// normalizePosition now sourced from lib/tyrePositions (recognises coded
// positions like LHF1 / LHRI as well as free-text labels).

// ── Chart options factories ────────────────────────────────────────────────────
function barOpts(horizontal = false, tickCallback) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: CHART_THEME.tooltipBg,
        titleColor: CHART_THEME.tooltipTitle,
        bodyColor: CHART_THEME.tooltipBody,
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { color: CHART_THEME.gridColor },
        ticks: { color: CHART_THEME.tickColor, font: { size: 11 }, ...(tickCallback && !horizontal ? { callback: tickCallback } : {}) },
      },
      y: {
        grid: { color: CHART_THEME.gridColor },
        ticks: { color: CHART_THEME.tickColor, font: { size: 11 }, ...(tickCallback && horizontal ? { callback: tickCallback } : {}) },
      },
    },
  }
}

function radarOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: CHART_THEME.tickColor, font: { size: 11 }, padding: 12, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: CHART_THEME.tooltipBg,
        titleColor: CHART_THEME.tooltipTitle,
        bodyColor: CHART_THEME.tooltipBody,
        padding: 10,
        cornerRadius: 8,
        callbacks: { label: ctx => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)}` },
      },
    },
    scales: {
      r: {
        min: 0,
        max: 100,
        grid: { color: CHART_THEME.gridColor },
        angleLines: { color: CHART_THEME.gridColor },
        pointLabels: { color: CHART_THEME.tickColor, font: { size: 11 } },
        ticks: { color: CHART_THEME.tickColor, font: { size: 9 }, backdropColor: 'transparent', stepSize: 20 },
      },
    },
  }
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function VendorIntelligence() {
  const { t } = useLanguage()
  const { activeCurrency, activeCountry } = useSettings()

  // Data state
  const [records, setRecords] = useState([])
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [capped, setCapped] = useState(false)
  const [exportError, setExportError] = useState('')
  // Authoritative fleet-level tyre cost from the classified expense grid
  // (loadGovernedCostSplit -> loadCostSplit). NEVER a sum of cost_per_tyre.
  const [fleetCost, setFleetCost] = useState({ loading: true, tyre: null, blended: false, failed: false, window: null })

  // Filters
  const [period, setPeriod] = useState({ mode: 'all' })
  const [siteFilter, setSiteFilter] = useState('all')
  const [positionFilter, setPositionFilter] = useState('all')
  const [minRecords, setMinRecords] = useState(3)

  // UI state
  const [activeSection, setActiveSection] = useState('vendors')
  const [emailModalOpen, setEmailModalOpen] = useState(false)

  // ── Data fetch ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [recRes, actRes] = await Promise.all([
        fetchAllPages((from, to) => applyCountry(supabase
          .from('tyre_records')
          .select('id,asset_no,site,brand,supplier,tyre_serial,position,risk_level,category,findings,tread_depth,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,removal_reason')
          .order('id'), activeCountry)
          .range(from, to), { max: ROW_CAP }),
        // Paged rather than `.limit(2000)`: the server caps any single response
        // at 1000 rows, so a limit above that was a silent truncation.
        fetchAllPages((from, to) => applyCountry(supabase
          .from('corrective_actions')
          .select('id,site,status,priority,created_at,resolved_at')
          .order('id'), activeCountry)
          .range(from, to), { max: 20000 }),
      ])
      if (recRes.error) throw recRes.error
      if (actRes.error) throw actRes.error
      setRecords(recRes.data || [])
      setActions(actRes.data || [])
      setCapped(Boolean(recRes.truncated))
    } catch (e) {
      setError(toUserMessage(e, t('vendorintel.errors.loadFailed')))
    } finally {
      setLoading(false)
    }
  }, [activeCountry, t])

  useEffect(() => { load() }, [load])

  // Fleet-level tyre spend from the expense grid. A blended (All countries)
  // answer adds SAR + AED + EGP, so it is reported as not comparable.
  useEffect(() => {
    let alive = true
    setFleetCost((c) => ({ ...c, loading: true, failed: false }))
    loadGovernedCostSplit({ country: activeCountry })
      .then((r) => {
        if (!alive) return
        setFleetCost({ loading: false, tyre: r?.tyre ?? null, blended: Boolean(r?.blended), failed: false, window: r?.window || null })
      })
      .catch(() => { if (alive) setFleetCost({ loading: false, tyre: null, blended: false, failed: true, window: null }) })
    return () => { alive = false }
  }, [activeCountry])

  const fleetTyreCost = fleetCost.blended || fleetCost.failed ? null : fleetCost.tyre

  // ── Filtered records ───────────────────────────────────────────────────────
  const uniqueSites = useMemo(() => uniqueSitesOf(records), [records])

  const filteredRecords = useMemo(
    () => filterVendorRecords(filterByPeriodValue(records, period, 'issue_date'), { site: siteFilter, position: positionFilter }, normalizePosition),
    [records, period, siteFilter, positionFilter],
  )

  const filteredActions = useMemo(
    () => actions.filter((a) => siteFilter === 'all' || a.site === siteFilter),
    [actions, siteFilter],
  )

  // ── Vendor computations (kpiEngine maths, engine ranking) ─────────────────
  const rawVendors = useMemo(() => computeVendorPerformance(filteredRecords), [filteredRecords])
  const vendors = useMemo(() => rankByScore(rawVendors, minRecords, 'count'), [rawVendors, minRecords])
  const cpkByBrand = useMemo(() => computeCpkByBrand(filteredRecords), [filteredRecords])
  const avgTyreLife = useMemo(() => computeAvgTyreLife(filteredRecords), [filteredRecords])
  const enrichedVendors = useMemo(() => enrichVendors(vendors, cpkByBrand, avgTyreLife), [vendors, cpkByBrand, avgTyreLife])

  // ── Workshop computations ─────────────────────────────────────────────────
  const rawWorkshop = useMemo(
    () => computeWorkshopPerformance(filteredRecords, filteredActions),
    [filteredRecords, filteredActions]
  )
  const workshops = useMemo(() => rankByScore(rawWorkshop.bySite, minRecords, 'recordCount'), [rawWorkshop, minRecords])
  const siteActionCounts = useMemo(() => actionsBySite(filteredActions), [filteredActions])

  // ── Executive summary + KPIs ──────────────────────────────────────────────
  const execSummary = useMemo(
    () => buildExecSummary({ vendors: enrichedVendors, workshops, records: filteredRecords, fleetTyreCost }),
    [enrichedVendors, workshops, filteredRecords, fleetTyreCost],
  )
  const kpi = useMemo(
    () => vendorKpis({ records: filteredRecords, vendors: enrichedVendors, workshops, exec: execSummary }),
    [filteredRecords, enrichedVendors, workshops, execSummary],
  )

  // ── Procurement recommendations (engine descriptors, translated here) ─────
  const recommendations = useMemo(() => {
    const fmt = { cpk: (v) => fmtCpk(v, activeCurrency), ratio: fmtPct, number: (v) => fmtNum(v), km: fmtKm }
    return buildRecommendations(enrichedVendors, workshops).map((r) => {
      const vars = { ...r.vars }
      for (const [k, kind] of Object.entries(r.format || {})) vars[k] = fmt[kind](vars[k])
      return { priority: r.priority, icon: r.icon, text: t(`vendorintel.recommendations.messages.${r.key}`, vars) }
    })
  }, [enrichedVendors, workshops, activeCurrency, t])

  // ── Radar chart data ───────────────────────────────────────────────────────
  const radarData = useMemo(() => {
    const series = radarSeries(enrichedVendors)
    if (!series.length) return null
    return {
      labels: [
        t('vendorintel.vendor.radarLabels.cpkEfficiency'), t('vendorintel.vendor.radarLabels.quality'),
        t('vendorintel.vendor.radarLabels.tyreLife'), t('vendorintel.vendor.radarLabels.lowScrap'),
        t('vendorintel.vendor.radarLabels.volume'),
      ],
      datasets: series.map((v, i) => ({
        label: v.brand,
        data: v.values,
        backgroundColor: withAlpha(colorAt(i), 0.2),
        borderColor: colorAt(i),
        borderWidth: 2,
        pointBackgroundColor: colorAt(i),
        pointRadius: 3,
      })),
    }
  }, [enrichedVendors, t])

  // ── CPK by Brand chart ─────────────────────────────────────────────────────
  const cpkBarData = useMemo(() => {
    const sorted = [...enrichedVendors]
      .filter(v => v.avgCpk != null)
      .sort((a, b) => (a.avgCpk ?? 0) - (b.avgCpk ?? 0))
      .slice(0, 15)
    return {
      labels: sorted.map(v => v.brand),
      datasets: [{
        label: t('vendorintel.vendor.cpkDatasetLabel'),
        data: sorted.map(v => v.avgCpk),
        backgroundColor: sorted.map(v => cpkBgColor(v.avgCpk)),
        borderRadius: 4,
      }],
    }
  }, [enrichedVendors, t])

  // ── Tyre Life by Brand chart ───────────────────────────────────────────────
  const lifeBarData = useMemo(() => {
    const sorted = [...enrichedVendors]
      .filter(v => v.avgLifeKm && v.avgLifeKm > 0)
      .sort((a, b) => (b.avgLifeKm ?? 0) - (a.avgLifeKm ?? 0))
      .slice(0, 15)
    return {
      labels: sorted.map(v => v.brand),
      datasets: [{
        label: t('vendorintel.vendor.lifeDatasetLabel'),
        data: sorted.map(v => v.avgLifeKm),
        backgroundColor: colorAt(0),
        borderRadius: 4,
      }],
    }
  }, [enrichedVendors, t])

  // ── Failure Rate by Brand chart ───────────────────────────────────────────
  const failureBarData = useMemo(() => {
    const sorted = [...enrichedVendors]
      .sort((a, b) => (b.failureRate ?? 0) - (a.failureRate ?? 0))
      .slice(0, 15)
    return {
      labels: sorted.map(v => v.brand),
      datasets: [{
        label: t('vendorintel.vendor.failureDatasetLabel'),
        data: sorted.map(v => (v.failureRate ?? 0) * 100),
        backgroundColor: sorted.map(v => {
          const pct = (v.failureRate ?? 0) * 100
          return pct >= 25 ? '#dc2626' : pct >= 15 ? '#d97706' : '#16a34a'
        }),
        borderRadius: 4,
      }],
    }
  }, [enrichedVendors, t])

  // ── Workshop chart data ────────────────────────────────────────────────────
  const workshopRiskData = useMemo(() => ({
    labels: workshops.slice(0, 12).map(w => w.site),
    datasets: [{
      label: t('vendorintel.workshop.riskDatasetLabel'),
      data: workshops.slice(0, 12).map(w => w.highRiskPct),
      backgroundColor: workshops.slice(0, 12).map(w =>
        w.highRiskPct >= 30 ? '#dc2626' : w.highRiskPct >= 15 ? '#d97706' : '#16a34a'
      ),
      borderRadius: 4,
    }],
  }), [workshops, t])

  const workshopCpkData = useMemo(() => ({
    labels: workshops.slice(0, 12).map(w => w.site),
    datasets: [{
      label: t('vendorintel.workshop.cpkDatasetLabel'),
      data: workshops.slice(0, 12).map(w => w.avgCpk),
      backgroundColor: workshops.slice(0, 12).map(w => cpkBgColor(w.avgCpk)),
      borderRadius: 4,
    }],
  }), [workshops, t])

  const workshopCloseData = useMemo(() => ({
    labels: workshops.slice(0, 12).map(w => w.site),
    datasets: [{
      label: t('vendorintel.workshop.closeDatasetLabel'),
      data: workshops.slice(0, 12).map(w => (w.actionCloseRate ?? 0) * 100),
      backgroundColor: workshops.slice(0, 12).map(w => {
        const r = (w.actionCloseRate ?? 0) * 100
        return r >= 70 ? '#16a34a' : r >= 40 ? '#d97706' : '#dc2626'
      }),
      borderRadius: 4,
    }],
  }), [workshops, t])

  // ── Export ────────────────────────────────────────────────────────────────
  // Rank order (the score order the leaderboard shows). Every figure a row
  // cannot measure exports blank, never a fabricated zero.
  const vendorExportRows = useMemo(() => enrichedVendors.map(v => ({
    rank: v.rank,
    brand: v.brand,
    records: v.count,
    validCpk: v.validCount,
    avgCpk: v.avgCpk != null ? v.avgCpk.toFixed(4) : '',
    medianCpk: v.medianCpk != null ? v.medianCpk.toFixed(4) : '',
    avgLifeKm: v.avgLifeKm != null ? Math.round(v.avgLifeKm) : '',
    failureRate: v.failureRate != null ? (v.failureRate * 100).toFixed(1) + '%' : '',
    scrapRate: v.scrapRate != null ? (v.scrapRate * 100).toFixed(1) + '%' : '',
    totalCost: Number.isFinite(v.totalCost) ? Math.round(v.totalCost) : '',
    score: v.displayScore.toFixed(1),
  })), [enrichedVendors])

  const workshopExportRows = useMemo(() => workshops.map(w => ({
    rank: w.rank,
    site: w.site,
    records: w.recordCount,
    highRiskPct: w.highRiskPct != null ? fmtNum(w.highRiskPct) + '%' : '',
    avgCpk: w.avgCpk != null ? w.avgCpk.toFixed(4) : '',
    avgCost: Number.isFinite(w.avgCost) ? Math.round(w.avgCost) : '',
    actionsRaised: siteActionCounts.get(w.site) || 0,
    actionCloseRate: w.actionCloseRate != null ? fmtPct(w.actionCloseRate) : '',
    score: w.displayScore.toFixed(1),
  })), [workshops, siteActionCounts])

  async function handleExcelExport() {
    setExportError('')
    try {
      await exportToExcel(
        vendorExportRows,
        ['rank', 'brand', 'records', 'validCpk', 'avgCpk', 'medianCpk', 'avgLifeKm', 'failureRate', 'scrapRate', 'totalCost', 'score'],
        ['Rank', 'Brand', 'Records', 'Valid (CPK)', 'Avg CPK', 'Median CPK', 'Avg Life (km)', 'Failure Rate', 'Scrap Rate', 'Tyre record cost', 'Score'],
        reportFileName('Vendor Intelligence Brands'),
        'Brand Performance',
        { currency: activeCurrency },
      )
      if (workshopExportRows.length) {
        await exportToExcel(
          workshopExportRows,
          ['rank', 'site', 'records', 'highRiskPct', 'avgCpk', 'avgCost', 'actionsRaised', 'actionCloseRate', 'score'],
          ['Rank', 'Site', 'Records', 'High Risk %', 'Avg CPK', 'Avg Cost', 'Actions raised', 'Close Rate', 'Score'],
          reportFileName('Vendor Intelligence Workshops'),
          'Workshop Performance',
          { currency: activeCurrency },
        )
      }
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  async function handlePdfExport() {
    setExportError('')
    try {
      const vendorRows = enrichedVendors.map(v => ({
        rank: String(v.rank),
        brand: v.brand,
        records: String(v.count),
        avgCpk: v.avgCpk != null ? fmtCpk(v.avgCpk, activeCurrency) : 'N/A',
        avgLifeKm: fmtKm(v.avgLifeKm),
        failureRate: fmtPct(v.failureRate),
        scrapRate: fmtPct(v.scrapRate),
        score: v.displayScore.toFixed(1),
      }))
      await exportToPdf(
        vendorRows,
        [
          { key: 'rank', header: 'Rank' },
          { key: 'brand', header: 'Brand' },
          { key: 'records', header: 'Records' },
          { key: 'avgCpk', header: 'Avg CPK' },
          { key: 'avgLifeKm', header: 'Avg Life' },
          { key: 'failureRate', header: 'Failure Rate' },
          { key: 'scrapRate', header: 'Scrap Rate' },
          { key: 'score', header: 'Score' },
        ],
        'Vendor and Workshop Intelligence',
        reportFileName('Vendor Intelligence'),
        'landscape',
        '',
        { currency: activeCurrency },
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── Table columns (EnterpriseTable owns sorting, paging and search) ───────
  const naText = t('vendorintel.na')
  const vendorColumns = useMemo(() => [
    { id: 'rank', header: t('vendorintel.vendor.columns.rank'), accessorFn: (v) => v.rank, cell: ({ row }) => <RankMark rank={row.original.rank} className="text-xs" /> },
    { id: 'brand', header: t('vendorintel.vendor.columns.brand'), accessorFn: (v) => v.brand,
      cell: ({ row }) => <span className="font-semibold text-[var(--text-primary)]">{row.original.brand}</span> },
    { id: 'count', header: t('vendorintel.vendor.columns.records'), accessorFn: (v) => v.count, meta: { align: 'right' },
      cell: ({ row }) => row.original.count.toLocaleString() },
    { id: 'validCount', header: t('vendorintel.vendor.columns.validCpk'), accessorFn: (v) => v.validCount, meta: { align: 'right' } },
    { id: 'avgCpk', header: t('vendorintel.vendor.columns.avgCpk'), accessorFn: (v) => v.avgCpk ?? -1, meta: { align: 'right' },
      cell: ({ row }) => <span className={`font-semibold tabular-nums ${cpkColor(row.original.avgCpk)}`}>{row.original.avgCpk != null ? row.original.avgCpk.toFixed(4) : naText}</span> },
    { id: 'medianCpk', header: t('vendorintel.vendor.columns.medianCpk'), accessorFn: (v) => v.medianCpk ?? -1, meta: { align: 'right' },
      cell: ({ row }) => (row.original.medianCpk != null ? row.original.medianCpk.toFixed(4) : naText) },
    { id: 'avgLifeKm', header: t('vendorintel.vendor.columns.avgLifeKm'), accessorFn: (v) => v.avgLifeKm ?? -1, meta: { align: 'right' },
      cell: ({ row }) => (row.original.avgLifeKm != null && row.original.avgLifeKm > 0 ? Math.round(row.original.avgLifeKm).toLocaleString() : naText) },
    { id: 'failureRate', header: t('vendorintel.vendor.columns.failureRate'), accessorFn: (v) => v.failureRate ?? -1, meta: { align: 'right' },
      cell: ({ row }) => <span className={`font-semibold ${row.original.failureRate == null ? 'text-[var(--text-muted)]' : riskColor(row.original.failureRate * 100)}`}>{fmtPct(row.original.failureRate)}</span> },
    { id: 'scrapRate', header: t('vendorintel.vendor.columns.scrapRate'), accessorFn: (v) => v.scrapRate ?? -1, meta: { align: 'right' },
      cell: ({ row }) => {
        const r = row.original.scrapRate
        return <span className={`font-semibold ${r == null ? 'text-[var(--text-muted)]' : r > 0.20 ? 'text-red-400' : r > 0.10 ? 'text-yellow-400' : 'text-green-400'}`}>{fmtPct(r)}</span>
      } },
    { id: 'totalCost', header: t('vendorintel.vendor.columns.totalCost'), accessorFn: (v) => v.totalCost ?? 0, meta: { align: 'right' },
      cell: ({ row }) => fmtCurrency(row.original.totalCost, activeCurrency) },
    { id: 'displayScore', header: t('vendorintel.vendor.columns.score'), accessorFn: (v) => v.displayScore, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-bold text-sm text-[var(--text-primary)] tabular-nums">{row.original.displayScore.toFixed(0)}</span> },
  ], [t, naText, activeCurrency])

  const workshopColumns = useMemo(() => [
    { id: 'rank', header: t('vendorintel.workshop.columns.rank'), accessorFn: (w) => w.rank, cell: ({ row }) => <RankMark rank={row.original.rank} className="text-xs" /> },
    { id: 'site', header: t('vendorintel.workshop.columns.site'), accessorFn: (w) => w.site,
      cell: ({ row }) => <span className="font-semibold text-[var(--text-primary)]">{row.original.site}</span> },
    { id: 'recordCount', header: t('vendorintel.workshop.columns.records'), accessorFn: (w) => w.recordCount, meta: { align: 'right' },
      cell: ({ row }) => row.original.recordCount.toLocaleString() },
    { id: 'highRiskPct', header: t('vendorintel.workshop.columns.highRiskPct'), accessorFn: (w) => w.highRiskPct ?? -1, meta: { align: 'right' },
      cell: ({ row }) => <span className={`font-semibold ${riskColor(row.original.highRiskPct)}`}>{fmtNum(row.original.highRiskPct)}%</span> },
    { id: 'avgCpk', header: t('vendorintel.workshop.columns.avgCpk'), accessorFn: (w) => w.avgCpk ?? -1, meta: { align: 'right' },
      cell: ({ row }) => <span className={`font-semibold tabular-nums ${cpkColor(row.original.avgCpk)}`}>{row.original.avgCpk != null ? row.original.avgCpk.toFixed(4) : naText}</span> },
    { id: 'avgCost', header: t('vendorintel.workshop.columns.avgCost'), accessorFn: (w) => w.avgCost ?? 0, meta: { align: 'right' },
      cell: ({ row }) => fmtCurrency(row.original.avgCost, activeCurrency) },
    { id: 'actionsRaised', header: t('vendorintel.workshop.columns.actionsRaised'), accessorFn: (w) => siteActionCounts.get(w.site) || 0, meta: { align: 'right' } },
    { id: 'actionCloseRate', header: t('vendorintel.workshop.columns.closeRatePct'), accessorFn: (w) => w.actionCloseRate ?? -1, meta: { align: 'right' },
      cell: ({ row }) => {
        const r = row.original.actionCloseRate
        return <span className={`font-semibold ${r == null ? 'text-[var(--text-muted)]' : r >= 0.7 ? 'text-green-400' : r >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>{fmtPct(r)}</span>
      } },
    { id: 'displayScore', header: t('vendorintel.workshop.columns.score'), accessorFn: (w) => w.displayScore, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-bold text-sm text-[var(--text-primary)] tabular-nums">{row.original.displayScore.toFixed(0)}</span> },
  ], [t, naText, activeCurrency, siteActionCounts])

  // ── Loading / Error / Empty ───────────────────────────────────────────────
  if (loading) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center justify-center h-72 gap-4 text-[var(--text-secondary)]">
        <RefreshCw className="animate-spin text-[var(--accent)]" size={36} aria-hidden="true" />
        <span className="text-sm">{t('vendorintel.loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center h-72 gap-3 text-center">
        <AlertTriangle size={36} className="text-red-400" aria-hidden="true" />
        <span className="text-sm font-medium text-[var(--text-primary)]">{error}</span>
        <button
          type="button"
          onClick={load}
          className="btn-secondary min-h-[44px] px-4 text-sm inline-flex items-center gap-1.5"
        >
          <RefreshCw size={14} aria-hidden="true" />
          {t('vendorintel.retry')}
        </button>
      </div>
    )
  }

  const hasVendorData = enrichedVendors.length > 0
  const hasWorkshopData = workshops.length > 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-10">

      <PageHeader
        title={t('vendorintel.title')}
        subtitle={t('vendorintel.subtitle')}
        icon={Trophy}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExcelExport}
              type="button"
              disabled={!enrichedVendors.length && !workshops.length}
              className="btn-secondary min-h-[44px] inline-flex items-center gap-1.5 px-3 text-xs disabled:opacity-50"
            >
              <Download size={13} aria-hidden="true" /> {t('vendorintel.actions.excel')}
            </button>
            <button
              onClick={handlePdfExport}
              type="button"
              disabled={!enrichedVendors.length && !workshops.length}
              className="btn-secondary min-h-[44px] inline-flex items-center gap-1.5 px-3 text-xs disabled:opacity-50"
            >
              <FileText size={13} aria-hidden="true" /> {t('vendorintel.actions.pdf')}
            </button>
            <button
              onClick={() => setEmailModalOpen(true)}
              type="button"
              disabled={!enrichedVendors.length && !workshops.length}
              className="btn-secondary min-h-[44px] inline-flex items-center gap-1.5 px-3 text-xs disabled:opacity-50"
            >
              <Mail size={13} aria-hidden="true" /> {t('vendorintel.actions.emailReport')}
            </button>
          </div>
        }
      />

      {/* ─── Filters ─────────────────────────────────────────────────────────── */}
      <div className="card flex flex-wrap items-center gap-3">
        {/* Period selection */}
        <PeriodFilter records={records} value={period} onChange={setPeriod} />

        {/* Divider */}
        <div className="hidden sm:block h-4 w-px bg-[var(--surface-3)]" aria-hidden="true" />

        {/* Site filter */}
        <select
          className="input text-xs min-h-[44px]"
          aria-label="Site"
          value={siteFilter}
          onChange={e => setSiteFilter(e.target.value)}
        >
          <option value="all">{t('vendorintel.filters.allSites')}</option>
          {uniqueSites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Position filter */}
        <select
          className="input text-xs min-h-[44px]"
          aria-label="Tyre position"
          value={positionFilter}
          onChange={e => setPositionFilter(e.target.value)}
        >
          {POSITIONS.map(p => (
            <option key={p} value={p.toLowerCase() === 'all' ? 'all' : p}>{t(`vendorintel.positions.${POSITION_I18N_KEYS[p]}`)}</option>
          ))}
        </select>

        {/* Min records */}
        <div className="flex items-center gap-2">
          <label htmlFor="vi-min-records" className="text-xs text-[var(--text-muted)]">{t('vendorintel.filters.minRecords')}</label>
          <input
            id="vi-min-records"
            type="number"
            min={1}
            max={50}
            value={minRecords}
            onChange={e => setMinRecords(Math.max(1, Number(e.target.value)))}
            className="input text-xs w-20 min-h-[44px]"
          />
        </div>

        <button
          type="button"
          onClick={load}
          className="btn-secondary min-h-[44px] inline-flex items-center gap-1.5 px-3 text-xs"
        >
          <RefreshCw size={12} aria-hidden="true" /> {t('vendorintel.filters.refresh')}
        </button>

        <span className="ml-auto text-xs text-[var(--text-muted)]">{t('vendorintel.filters.recordsCount', { count: filteredRecords.length.toLocaleString() })}</span>
      </div>

      {/* ─── Capped view note ────────────────────────────────────────────────── */}
      {capped && (
        <div className="bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)] rounded-xl px-4 py-2.5 text-xs">
          Showing a capped view of the most recent {ROW_CAP.toLocaleString()} tyre records for this selection. Narrow the country or period for the full set.
        </div>
      )}

      {exportError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-800/50 bg-red-900/10 px-4 py-2.5 text-xs text-[var(--text-primary)]">
          <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" /> {exportError}
        </div>
      )}

      {/* ─── KPI strip ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: 'Records analysed', value: kpi.records.toLocaleString(), sub: `${periodLabel(period)}`, icon: Package },
          { label: 'Brands ranked', value: kpi.brands.toLocaleString(), sub: `Min ${minRecords} records each`, icon: Award },
          { label: 'Sites ranked', value: kpi.sites.toLocaleString(), sub: `${filteredActions.length.toLocaleString()} corrective actions`, icon: Building2 },
          { label: 'Weighted avg CPK', value: kpi.weightedCpk != null ? fmtCpk(kpi.weightedCpk, activeCurrency) : 'N/A', sub: kpi.weightedCpk != null ? 'Per km, across ranked brands' : 'No measured km and cost yet', icon: Target },
          {
            label: 'Fleet tyre spend',
            value: fleetCost.loading ? 'Loading' : fleetTyreCost != null ? fmtCurrency(fleetTyreCost, activeCurrency) : 'N/A',
            sub: fleetCost.blended ? 'Pick one country: currencies differ' : fleetCost.failed ? 'Expense grid unavailable' : 'Expense grid, last 12 months',
            icon: DollarSign,
          },
          {
            label: 'Potential saving',
            value: kpi.estAnnualSaving != null && kpi.estAnnualSaving > 0 ? fmtCurrency(kpi.estAnnualSaving, activeCurrency) : 'N/A',
            sub: kpi.estAnnualSaving != null && kpi.estAnnualSaving > 0 ? 'Worst to best CPK brand' : 'Needs two brands with CPK',
            icon: TrendingDown,
          },
        ].map(({ label, value, sub, icon: Icon }) => (
          <div key={label} className="card !p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-[var(--text-muted)]">{label}</p>
              <Icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
            </div>
            <p className="text-lg font-bold text-[var(--text-primary)] mt-1 tabular-nums truncate" title={value}>{value}</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate" title={sub}>{sub}</p>
          </div>
        ))}
      </div>

      {/* ─── Section Toggle ──────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Vendor intelligence sections" className="flex flex-wrap gap-1 p-1 bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl w-fit max-w-full">
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'vendors'}
          onClick={() => setActiveSection('vendors')}
          className={`flex items-center gap-2 px-4 min-h-[44px] rounded-lg text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
            activeSection === 'vendors'
              ? 'bg-[var(--accent)] text-white shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Package size={15} aria-hidden="true" /> {t('vendorintel.sections.brandRankings')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'workshops'}
          onClick={() => setActiveSection('workshops')}
          className={`flex items-center gap-2 px-4 min-h-[44px] rounded-lg text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
            activeSection === 'workshops'
              ? 'bg-[var(--accent)] text-white shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Building2 size={15} aria-hidden="true" /> {t('vendorintel.sections.workshopPerformance')}
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          VENDOR SECTION
      ═══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence mode="wait">
        {activeSection === 'vendors' && (
          <motion.div
            key="vendors"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            {/* ─── 3a: Vendor Leaderboard ──────────────────────────────────── */}
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <Award size={15} className="text-yellow-400" /> {t('vendorintel.vendor.leaderboard')}
              </h2>

              {!hasVendorData ? (
                <div className="card text-center py-16 text-[var(--text-dim)] text-sm">
                  {t('vendorintel.vendor.emptyThreshold', { minRecords })}
                </div>
              ) : (
                <>
                  {/* Top 3 featured cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    {enrichedVendors.slice(0, 3).map(v => {
                      const badge = rankBadgeStyle(v.rank)
                      const totalCostDisplay = fmtCurrency(v.totalCost, activeCurrency)
                      return (
                        <motion.div
                          key={v.brand}
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: v.rank * 0.05 }}
                          className={`bg-[var(--surface-1)] border rounded-xl p-5 ${badge.bg}`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Medal size={24} className={badge.text} aria-hidden="true" />
                              <div>
                                <p className={`text-xs font-bold uppercase tracking-wider ${badge.text}`}>{t('vendorintel.vendor.rank', { rank: v.rank })}</p>
                                <p className="text-lg font-bold text-[var(--text-primary)]">{v.brand}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-black text-[var(--text-primary)]">{v.displayScore.toFixed(0)}</p>
                              <p className="text-[10px] text-[var(--text-muted)]">{t('vendorintel.vendor.outOf100')}</p>
                            </div>
                          </div>

                          {/* Score bar */}
                          <div className="mb-4">
                            <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${
                                  v.rank === 1 ? 'bg-yellow-400' : v.rank === 2 ? 'bg-gray-400' : 'bg-amber-600'
                                }`}
                                style={{ width: `${v.displayScore}%` }}
                              />
                            </div>
                          </div>

                          {/* 5 metrics */}
                          <div className="space-y-2.5">
                            {/* CPK */}
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-[var(--text-muted)]">{t('vendorintel.vendor.avgCpk')}</span>
                                <span className={`font-semibold ${cpkColor(v.avgCpk)}`}>
                                  {v.avgCpk != null ? fmtCpk(v.avgCpk, activeCurrency) : t('vendorintel.na')}
                                </span>
                              </div>
                              {v.avgCpk != null && miniBar(
                                Math.max(0, 100 - (v.avgCpk / 3) * 100),
                                v.avgCpk <= 1.0 ? '#16a34a' : v.avgCpk <= 2.0 ? '#d97706' : '#dc2626'
                              )}
                            </div>
                            {/* Failure Rate */}
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-[var(--text-muted)]">{t('vendorintel.vendor.failureRate')}</span>
                                <span className={`font-semibold ${riskColor((v.failureRate ?? 0) * 100)}`}>
                                  {fmtPct(v.failureRate)}
                                </span>
                              </div>
                              {miniBar(100 - (v.failureRate ?? 0) * 100, colorAt(0))}
                            </div>
                            {/* Avg Life */}
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-[var(--text-muted)]">{t('vendorintel.vendor.avgTyreLife')}</span>
                                <span className="text-[var(--text-primary)] font-medium">{fmtKm(v.avgLifeKm)}</span>
                              </div>
                            </div>
                            {/* Scrap Rate */}
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-[var(--text-muted)]">{t('vendorintel.vendor.scrapRate')}</span>
                                <span className={`font-semibold ${(v.scrapRate ?? 0) > 0.20 ? 'text-red-400' : (v.scrapRate ?? 0) > 0.10 ? 'text-yellow-400' : 'text-green-400'}`}>
                                  {fmtPct(v.scrapRate)}
                                </span>
                              </div>
                            </div>
                            {/* Records */}
                            <div className="flex justify-between text-xs">
                              <span className="text-[var(--text-muted)]">{t('vendorintel.vendor.totalRecords')}</span>
                              <span className="text-[var(--text-primary)] font-medium">{v.count.toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="mt-3 pt-3 border-t border-[var(--border-dim)] flex justify-between text-xs">
                            <span className="text-[var(--text-muted)]">{t('vendorintel.vendor.totalInvestment')}</span>
                            <span className="text-[var(--text-primary)] font-semibold">{totalCostDisplay}</span>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>

                  {enrichedVendors.length > 3 && (
                    <p className="text-xs text-[var(--text-muted)]">All {enrichedVendors.length} ranked brands are in the Brand Performance table below.</p>
                  )}
                </>
              )}
            </div>

            {/* ─── 3b-3e: Brand Charts 2×2 ─────────────────────────────────── */}
            {hasVendorData && (
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <BarChart3 size={15} className="text-green-400" /> {t('vendorintel.vendor.analyticsTitle')}
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* Radar chart */}
                  <div className="card">
                    <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">{t('vendorintel.vendor.radarTitle')}</p>
                    <p className="text-[10px] text-[var(--text-dim)] mb-3">{t('vendorintel.vendor.radarSub')}</p>
                    {radarData ? (
                      <div style={{ height: 300 }}>
                        <Radar data={radarData} options={radarOpts()} />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-[300px] text-[var(--text-dim)] text-xs">
                        {t('vendorintel.vendor.radarInsufficient')}
                      </div>
                    )}
                  </div>

                  {/* CPK bar chart */}
                  <div className="card">
                    <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">{t('vendorintel.vendor.cpkChartTitle', { currency: activeCurrency })}</p>
                    <p className="text-[10px] text-[var(--text-dim)] mb-3">{t('vendorintel.vendor.cpkChartSub')}</p>
                    {cpkBarData.labels.length > 0 ? (
                      <div style={{ height: 280 }}>
                        <Bar
                          data={cpkBarData}
                          options={{
                            ...barOpts(true),
                            plugins: {
                              legend: { display: false },
                              tooltip: {
                                backgroundColor: CHART_THEME.tooltipBg,
                                titleColor: CHART_THEME.tooltipTitle,
                                bodyColor: CHART_THEME.tooltipBody,
                                padding: 10,
                                cornerRadius: 8,
                                callbacks: {
                                  label: ctx => `${activeCurrency} ${Number(ctx.raw).toFixed(4)}/km`,
                                },
                              },
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-[var(--text-dim)] text-xs">
                        {t('vendorintel.vendor.cpkChartEmpty')}
                      </div>
                    )}
                  </div>

                  {/* Tyre Life bar chart */}
                  <div className="card">
                    <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">{t('vendorintel.vendor.lifeChartTitle')}</p>
                    <p className="text-[10px] text-[var(--text-dim)] mb-3">{t('vendorintel.vendor.lifeChartSub')}</p>
                    {lifeBarData.labels.length > 0 ? (
                      <div style={{ height: 280 }}>
                        <Bar
                          data={lifeBarData}
                          options={{
                            ...barOpts(true),
                            plugins: {
                              legend: { display: false },
                              tooltip: {
                                backgroundColor: CHART_THEME.tooltipBg,
                                titleColor: CHART_THEME.tooltipTitle,
                                bodyColor: CHART_THEME.tooltipBody,
                                padding: 10,
                                cornerRadius: 8,
                                callbacks: {
                                  label: ctx => `${Math.round(ctx.raw).toLocaleString()} km`,
                                },
                              },
                            },
                            scales: {
                              x: {
                                grid: { color: CHART_THEME.gridColor },
                                ticks: {
                                  color: CHART_THEME.tickColor,
                                  font: { size: 11 },
                                  callback: v => `${(v / 1000).toFixed(0)}k`,
                                },
                              },
                              y: {
                                grid: { color: CHART_THEME.gridColor },
                                ticks: { color: CHART_THEME.tickColor, font: { size: 11 } },
                              },
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-[var(--text-dim)] text-xs">
                        {t('vendorintel.vendor.lifeChartEmpty')}
                      </div>
                    )}
                  </div>

                  {/* Failure Rate bar chart */}
                  <div className="card">
                    <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">{t('vendorintel.vendor.failureChartTitle')}</p>
                    <p className="text-[10px] text-[var(--text-dim)] mb-3">{t('vendorintel.vendor.failureChartSub')}</p>
                    {failureBarData.labels.length > 0 ? (
                      <div style={{ height: 280 }}>
                        <Bar
                          data={failureBarData}
                          options={{
                            ...barOpts(false),
                            plugins: {
                              legend: { display: false },
                              tooltip: {
                                backgroundColor: CHART_THEME.tooltipBg,
                                titleColor: CHART_THEME.tooltipTitle,
                                bodyColor: CHART_THEME.tooltipBody,
                                padding: 10,
                                cornerRadius: 8,
                                callbacks: {
                                  label: ctx => `${Number(ctx.raw).toFixed(1)}%`,
                                },
                              },
                            },
                            scales: {
                              x: {
                                grid: { color: CHART_THEME.gridColor },
                                ticks: { color: CHART_THEME.tickColor, font: { size: 11 } },
                              },
                              y: {
                                grid: { color: CHART_THEME.gridColor },
                                ticks: {
                                  color: CHART_THEME.tickColor,
                                  font: { size: 11 },
                                  callback: v => `${v}%`,
                                },
                              },
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-[var(--text-dim)] text-xs">
                        {t('vendorintel.vendor.failureChartEmpty')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ─── 3f: Brand Performance Table ─────────────────────────────── */}
            {hasVendorData && (
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <Target size={15} className="text-[var(--accent)]" aria-hidden="true" /> {t('vendorintel.vendor.fullTableTitle')}
                </h2>
                <p className="text-[11px] text-[var(--text-muted)] mb-3 flex items-start gap-1.5">
                  <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  Cost by brand is from tyre records (unpriced tyres add nothing). The authoritative fleet tyre spend is the expense grid figure in the KPI strip.
                </p>
                <div className="card !p-3">
                  <EnterpriseTable
                    columns={vendorColumns}
                    data={enrichedVendors}
                    getRowId={(v) => v.brand}
                    enableColumnFilters={false}
                    enableExport={false}
                    searchPlaceholder="Search brands"
                    initialPageSize={25}
                    viewKey="vendor-intel-brands"
                    emptyMessage={t('vendorintel.vendor.emptyThreshold', { minRecords })}
                  />
                </div>
              </div>
            )}

          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            WORKSHOP SECTION
        ═══════════════════════════════════════════════════════════════════════ */}
        {activeSection === 'workshops' && (
          <motion.div
            key="workshops"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            {/* ─── 4a: Workshop Rankings ───────────────────────────────────── */}
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <Building2 size={15} className="text-green-400" /> {t('vendorintel.workshop.rankings')}
              </h2>

              {!hasWorkshopData ? (
                <div className="card text-center py-16 text-[var(--text-dim)] text-sm">
                  {t('vendorintel.workshop.emptyThreshold', { minRecords })}
                </div>
              ) : (
                <>
                  {/* Top 3 featured workshop cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    {workshops.slice(0, 3).map(w => {
                      const badge = rankBadgeStyle(w.rank)
                      return (
                        <motion.div
                          key={w.site}
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: w.rank * 0.05 }}
                          className={`bg-[var(--surface-1)] border rounded-xl p-5 ${badge.bg}`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Medal size={24} className={badge.text} aria-hidden="true" />
                              <div>
                                <p className={`text-xs font-bold uppercase tracking-wider ${badge.text}`}>{t('vendorintel.vendor.rank', { rank: w.rank })}</p>
                                <p className="text-base font-bold text-[var(--text-primary)]">{w.site}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-black text-[var(--text-primary)]">{w.displayScore.toFixed(0)}</p>
                              <p className="text-[10px] text-[var(--text-muted)]">{t('vendorintel.vendor.outOf100')}</p>
                            </div>
                          </div>

                          {/* Score bar */}
                          <div className="mb-4">
                            <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${
                                  w.rank === 1 ? 'bg-yellow-400' : w.rank === 2 ? 'bg-gray-400' : 'bg-amber-600'
                                }`}
                                style={{ width: `${w.displayScore}%` }}
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-[var(--text-muted)]">{t('vendorintel.workshop.records')}</span>
                              <span className="text-[var(--text-primary)] font-medium">{w.recordCount.toLocaleString()}</span>
                            </div>
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-[var(--text-muted)]">{t('vendorintel.workshop.highRiskPct')}</span>
                                <span className={`font-semibold ${riskColor(w.highRiskPct)}`}>
                                  {fmtNum(w.highRiskPct)}%
                                </span>
                              </div>
                              {miniBar(
                                100 - w.highRiskPct,
                                w.highRiskPct >= 30 ? '#dc2626' : w.highRiskPct >= 15 ? '#d97706' : '#16a34a'
                              )}
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-[var(--text-muted)]">{t('vendorintel.workshop.avgCpk')}</span>
                              <span className={`font-semibold ${cpkColor(w.avgCpk)}`}>
                                {w.avgCpk != null ? fmtCpk(w.avgCpk, activeCurrency) : t('vendorintel.na')}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-[var(--text-muted)]">{t('vendorintel.workshop.avgCostPerTyre')}</span>
                              <span className="text-[var(--text-primary)] font-medium">{fmtCurrency(w.avgCost, activeCurrency)}</span>
                            </div>
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-[var(--text-muted)]">{t('vendorintel.workshop.actionCloseRate')}</span>
                                <span className={`font-semibold ${(w.actionCloseRate ?? 0) >= 0.7 ? 'text-green-400' : (w.actionCloseRate ?? 0) >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                                  {fmtPct(w.actionCloseRate)}
                                </span>
                              </div>
                              {miniBar((w.actionCloseRate ?? 0) * 100, colorAt(0))}
                            </div>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>

                  {workshops.length > 3 && (
                    <p className="text-xs text-[var(--text-muted)]">All {workshops.length} ranked sites are in the Workshop Performance table below.</p>
                  )}
                </>
              )}
            </div>

            {/* ─── 4b-4c: Workshop Charts ──────────────────────────────────── */}
            {hasWorkshopData && (
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <BarChart3 size={15} className="text-green-400" /> {t('vendorintel.workshop.analyticsTitle')}
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

                  {/* High Risk % by Site */}
                  <div className="card">
                    <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">{t('vendorintel.workshop.riskChartTitle')}</p>
                    <p className="text-[10px] text-[var(--text-dim)] mb-3">{t('vendorintel.workshop.riskChartSub')}</p>
                    <div style={{ height: 260 }}>
                      <Bar
                        data={workshopRiskData}
                        options={{
                          ...barOpts(false),
                          plugins: {
                            legend: { display: false },
                            tooltip: {
                              backgroundColor: CHART_THEME.tooltipBg,
                              titleColor: CHART_THEME.tooltipTitle,
                              bodyColor: CHART_THEME.tooltipBody,
                              padding: 10,
                              cornerRadius: 8,
                              callbacks: { label: ctx => `${Number(ctx.raw).toFixed(1)}%` },
                            },
                          },
                          scales: {
                            x: { grid: { color: CHART_THEME.gridColor }, ticks: { color: CHART_THEME.tickColor, font: { size: 10 }, maxRotation: 35 } },
                            y: { grid: { color: CHART_THEME.gridColor }, ticks: { color: CHART_THEME.tickColor, font: { size: 10 }, callback: v => `${v}%` } },
                          },
                        }}
                      />
                    </div>
                  </div>

                  {/* Avg CPK by Site */}
                  <div className="card">
                    <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">{t('vendorintel.workshop.cpkChartTitle', { currency: activeCurrency })}</p>
                    <p className="text-[10px] text-[var(--text-dim)] mb-3">{t('vendorintel.workshop.cpkChartSub')}</p>
                    <div style={{ height: 260 }}>
                      <Bar
                        data={workshopCpkData}
                        options={{
                          ...barOpts(false),
                          plugins: {
                            legend: { display: false },
                            tooltip: {
                              backgroundColor: CHART_THEME.tooltipBg,
                              titleColor: CHART_THEME.tooltipTitle,
                              bodyColor: CHART_THEME.tooltipBody,
                              padding: 10,
                              cornerRadius: 8,
                              callbacks: { label: ctx => `${activeCurrency} ${Number(ctx.raw).toFixed(4)}/km` },
                            },
                          },
                          scales: {
                            x: { grid: { color: CHART_THEME.gridColor }, ticks: { color: CHART_THEME.tickColor, font: { size: 10 }, maxRotation: 35 } },
                            y: { grid: { color: CHART_THEME.gridColor }, ticks: { color: CHART_THEME.tickColor, font: { size: 10 } } },
                          },
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Action Close Rate */}
                <div className="card">
                  <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">{t('vendorintel.workshop.closeChartTitle')}</p>
                  <p className="text-[10px] text-[var(--text-dim)] mb-3">{t('vendorintel.workshop.closeChartSub')}</p>
                  <div style={{ height: 220 }}>
                    <Bar
                      data={workshopCloseData}
                      options={{
                        ...barOpts(false),
                        plugins: {
                          legend: { display: false },
                          tooltip: {
                            backgroundColor: CHART_THEME.tooltipBg,
                            titleColor: CHART_THEME.tooltipTitle,
                            bodyColor: CHART_THEME.tooltipBody,
                            padding: 10,
                            cornerRadius: 8,
                            callbacks: { label: ctx => `${Number(ctx.raw).toFixed(1)}%` },
                          },
                        },
                        scales: {
                          x: { grid: { color: CHART_THEME.gridColor }, ticks: { color: CHART_THEME.tickColor, font: { size: 10 }, maxRotation: 35 } },
                          y: {
                            grid: { color: CHART_THEME.gridColor },
                            ticks: { color: CHART_THEME.tickColor, font: { size: 10 }, callback: v => `${v}%` },
                            min: 0,
                            max: 100,
                          },
                        },
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ─── 4d: Workshop Performance Table ─────────────────────────── */}
            {hasWorkshopData && (
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <Target size={15} className="text-[var(--accent)]" aria-hidden="true" /> {t('vendorintel.workshop.tableTitle')}
                </h2>
                <p className="text-[11px] text-[var(--text-muted)] mb-3">Every site at or above the minimum record count. Average cost per tyre is from tyre records; the fleet total is from the expense grid.</p>
                <div className="card !p-3">
                  <EnterpriseTable
                    columns={workshopColumns}
                    data={workshops}
                    getRowId={(w) => w.site}
                    enableColumnFilters={false}
                    enableExport={false}
                    searchPlaceholder="Search sites"
                    initialPageSize={25}
                    viewKey="vendor-intel-workshops"
                    emptyMessage={t('vendorintel.workshop.emptyThreshold', { minRecords })}
                  />
                </div>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Section 5: Procurement Recommendations ─────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Zap size={15} className="text-amber-400" /> {t('vendorintel.recommendations.title')}
        </h2>

        {recommendations.length === 0 ? (
          <div className="bg-[var(--surface-1)] border border-green-800/40 rounded-xl p-4 flex items-center gap-3 bg-green-950/10">
            <CheckCircle size={20} className="text-green-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-300">{t('vendorintel.recommendations.allGoodTitle')}</p>
              <p className="text-xs text-green-400/70 mt-0.5">{t('vendorintel.recommendations.allGoodDesc')}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {recommendations.map((rec, i) => {
              const priorityStyles = {
                Critical: { border: 'border-red-700/40', bg: 'bg-red-950/15', badge: 'bg-red-900/60 text-red-300 border border-red-700/40', icon: <ShieldAlert size={14} className="text-red-400" /> },
                High: { border: 'border-yellow-700/40', bg: 'bg-yellow-950/15', badge: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700/40', icon: <AlertTriangle size={14} className="text-yellow-400" /> },
                Medium: { border: 'border-blue-700/40', bg: 'bg-blue-950/15', badge: 'bg-blue-900/60 text-blue-300 border border-blue-700/40', icon: <Activity size={14} className="text-blue-400" /> },
              }
              const style = priorityStyles[rec.priority] ?? priorityStyles.Medium
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={`bg-[var(--surface-1)] border rounded-xl p-4 ${style.border} ${style.bg}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">{style.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${style.badge}`}>
                          {t(`vendorintel.recommendations.priority.${rec.priority}`)}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{rec.text}</p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Section 6: Executive Summary Card ──────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Star size={15} className="text-yellow-400" /> {t('vendorintel.execSummary.title')}
        </h2>
        <div className="bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-xl p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            {/* Best Value Brand */}
            <div className="bg-green-950/20 border border-green-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown size={14} className="text-green-400" />
                <span className="text-xs font-semibold text-green-300">{t('vendorintel.execSummary.bestValueBrand')}</span>
              </div>
              <p className="text-lg font-black text-[var(--text-primary)]">{execSummary.bestBrand?.brand ?? 'N/A'}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {execSummary.bestBrand?.avgCpk != null
                  ? t('vendorintel.execSummary.avgCpkPerKm', { cpk: fmtCpk(execSummary.bestBrand.avgCpk, activeCurrency) })
                  : t('vendorintel.execSummary.noCpkData')}
              </p>
              <p className="text-[11px] text-green-400/70 mt-1">{t('vendorintel.execSummary.bestValueNote')}</p>
            </div>

            {/* Worst Value Brand */}
            <div className="bg-red-950/20 border border-red-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={14} className="text-red-400" />
                <span className="text-xs font-semibold text-red-300">{t('vendorintel.execSummary.highestCostBrand')}</span>
              </div>
              <p className="text-lg font-black text-[var(--text-primary)]">{execSummary.worstBrand?.brand ?? 'N/A'}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {execSummary.worstBrand?.avgCpk != null
                  ? t('vendorintel.execSummary.avgCpkPerKm', { cpk: fmtCpk(execSummary.worstBrand.avgCpk, activeCurrency) })
                  : t('vendorintel.execSummary.noCpkData')}
              </p>
              <p className="text-[11px] text-red-400/70 mt-1">{t('vendorintel.execSummary.highestCostNote')}</p>
            </div>

            {/* Estimated Annual Saving */}
            <div className="bg-yellow-950/20 border border-yellow-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={14} className="text-yellow-400" />
                <span className="text-xs font-semibold text-yellow-300">{t('vendorintel.execSummary.potentialAnnualSaving')}</span>
              </div>
              <p className="text-lg font-black text-yellow-300">
                {(execSummary.estAnnualSaving ?? 0) > 0
                  ? fmtCurrency(execSummary.estAnnualSaving, activeCurrency)
                  : 'N/A'}
              </p>
              <p className="text-[11px] text-yellow-400/70 mt-1">
                {(execSummary.estAnnualSaving ?? 0) > 0
                  ? t('vendorintel.execSummary.savingSwitch', { worst: execSummary.worstBrand?.brand ?? 'N/A', best: execSummary.bestBrand?.brand ?? 'N/A' })
                  : t('vendorintel.execSummary.savingUnlock')}
              </p>
            </div>

            {/* Best Site */}
            <div className="bg-blue-950/20 border border-blue-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle size={14} className="text-blue-400" />
                <span className="text-xs font-semibold text-blue-300">{t('vendorintel.execSummary.bestPerformingSite')}</span>
              </div>
              <p className="text-lg font-black text-[var(--text-primary)]">{execSummary.bestSite?.site ?? 'N/A'}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {execSummary.bestSite
                  ? t('vendorintel.execSummary.siteScoreLine', { score: execSummary.bestSite.displayScore.toFixed(0), pct: fmtNum(execSummary.bestSite.highRiskPct) })
                  : t('vendorintel.execSummary.noSiteData')}
              </p>
              <p className="text-[11px] text-blue-400/70 mt-1">{t('vendorintel.execSummary.bestSiteNote')}</p>
            </div>

            {/* Site Needing Attention */}
            <div className="bg-orange-950/20 border border-orange-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-orange-400" />
                <span className="text-xs font-semibold text-orange-300">{t('vendorintel.execSummary.siteNeedingAttention')}</span>
              </div>
              <p className="text-lg font-black text-[var(--text-primary)]">{execSummary.worstSite?.site ?? 'N/A'}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {execSummary.worstSite
                  ? t('vendorintel.execSummary.siteScoreLine', { score: execSummary.worstSite.displayScore.toFixed(0), pct: fmtNum(execSummary.worstSite.highRiskPct) })
                  : t('vendorintel.execSummary.noSiteData')}
              </p>
              <p className="text-[11px] text-orange-400/70 mt-1">{t('vendorintel.execSummary.attentionNote')}</p>
            </div>

            {/* Total Fleet Investment */}
            <div className="bg-purple-950/20 border border-purple-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wrench size={14} className="text-purple-400" />
                <span className="text-xs font-semibold text-purple-300">{t('vendorintel.execSummary.totalFleetInvestment')}</span>
              </div>
              <p className="text-lg font-black text-[var(--text-primary)]">{fleetTyreCost != null ? fmtCurrency(fleetTyreCost, activeCurrency) : 'N/A'}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {fleetCost.blended
                  ? 'Choose one country: the expense grid reports each country in its own currency.'
                  : fleetCost.failed
                    ? 'The expense grid could not be read.'
                    : 'From the classified expense grid, last 12 months, all sites.'}
              </p>
              <p className="text-[11px] text-purple-400/70 mt-1">
                {enrichedVendors.length > 0 ? t('vendorintel.execSummary.brandsTracked', { count: enrichedVendors.length }) : t('vendorintel.execSummary.noBrandData')}
              </p>
            </div>

          </div>
        </div>
      </div>

      <EmailReportModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        reportTitle="Vendor & Workshop Intelligence Report"
        pdfColumns={['Rank', 'Brand', 'Records', 'Avg CPK', 'Avg Life', 'Failure Rate', 'Scrap Rate', 'Score']}
        pdfRows={enrichedVendors.map(v => [
          String(v.rank),
          v.brand,
          String(v.count),
          v.avgCpk != null ? fmtCpk(v.avgCpk, activeCurrency) : 'N/A',
          fmtKm(v.avgLifeKm),
          fmtPct(v.failureRate),
          fmtPct(v.scrapRate),
          v.displayScore.toFixed(0),
        ])}
        kpiSummary={{
          'Total Brands Tracked': String(enrichedVendors.length),
          'Best Value Brand': execSummary.bestBrand?.brand ?? 'N/A',
          'Best Brand CPK': execSummary.bestBrand?.avgCpk != null ? fmtCpk(execSummary.bestBrand.avgCpk, activeCurrency) : 'N/A',
          'Highest Cost Brand': execSummary.worstBrand?.brand ?? 'N/A',
          'Fleet Tyre Spend (expense grid, 12 months)': fleetTyreCost != null ? fmtCurrency(fleetTyreCost, activeCurrency) : 'N/A',
          'Potential Annual Saving': (execSummary.estAnnualSaving ?? 0) > 0 ? fmtCurrency(execSummary.estAnnualSaving, activeCurrency) : 'N/A',
          'Best Performing Site': execSummary.bestSite?.site ?? 'N/A',
          'Total Records Analysed': String(filteredRecords.length),
        }}
        period={`Period: ${periodLabel(period)}`}
      />
    </div>
  )
}
