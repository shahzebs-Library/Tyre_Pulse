import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import useLatestRequest from '../lib/useLatestRequest'
import { motion } from 'framer-motion'
import { costCenter } from '../lib/api'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportSheetsToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { COST_MODES, costModeLabel, pickMonthly, splitTotals } from '../lib/costSources'

import { loadGovernedCostSplit, COST_SPLIT_TTL_MS } from '../lib/api/governedCost'
import CostValue, { costScopeLabel } from '../components/cost/CostValue'
import { buildCostIntelligence, UNIT_META } from '../lib/costIntelligence'
import { listProduction, createProduction, updateProduction, deleteProduction, sumProductionM3 } from '../lib/api/production'
import { parseWorkbook } from '../lib/import'
import { mapSheetToRows, DATASETS, normHeader } from '../lib/erpImport'
import { useAuth } from '../contexts/AuthContext'
import { toUserMessage } from '../lib/safeError'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { useFilterState } from '../hooks/useFilterState'
import {
  INDUSTRY_BENCHMARK_CPK, ANOMALY_VEHICLE_POPULATION,
  normaliseRecords, filterRecords, optionsFrom, buildRecordKpis, buildSpendKpis,
  groupBySite, groupByBrand, groupByVehicle, groupByMonth, buildAnomalies, roiFor,
  cpkDelta, monthLabel, movingAvg, topShare, productionSummary,
} from '../lib/costCenterAnalytics'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import FilterBar from '../components/ui/FilterBar'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import SegmentedControl from '../components/ui/SegmentedControl'
import YearlyTrendPanel from '../components/expense/YearlyTrendPanel'
import EmailPdfButton from '../components/EmailPdfButton'
import BudgetTabs from '../components/budgets/BudgetTabs'
import {
  DollarSign, TrendingUp, TrendingDown, BarChart2, PieChart, Target,
  AlertTriangle, Award, ArrowUpRight, ArrowDownRight, Minus,
  RefreshCw, Loader2, FileSpreadsheet, FileText, Zap, SlidersHorizontal, Wrench,
  Gauge, Navigation, Boxes, Timer, Plus, Trash2, Pencil, Save, X, CheckCircle2,
  Percent, ShieldAlert, Info, CornerDownRight,
} from 'lucide-react'
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ───────────────────────────────────────────────────────────────────
// Ceiling on the analytical tyre_records pull. This page derives per-tyre CPK by
// brand / vehicle / site / month (no server RPC covers those), so it needs row
// level data - but it must never load the whole table into the browser. Country
// and the date window are applied SERVER-SIDE (see fetchData); this bounds what
// remains. The authoritative spend totals come from the expense grid via
// loadGovernedCostSplit: the KPI strip, the Tyres vs Maintenance panel and the
// Cost per unit section. cost_per_tyre is never summed into a headline figure.
const TYRE_ROW_CEILING = 50000
const MODE_INDEX = { combined: 0, tyres: 1, maintenance: 2 }

const PERIOD_PRESETS = [
  { label: '30d',  days: 30 },
  { label: '90d',  days: 90 },
  { label: '6m',   days: 180 },
  { label: '1yr',  days: 365 },
  { label: 'All',  days: null },
]

const DIMENSION_TAB_KEYS = ['bySite', 'byBrand', 'byVehicle', 'byMonth']
const FILTER_DEFAULTS = { q: '', site: '', brand: '' }

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: 'var(--text-primary)',
      bodyColor: 'var(--text-secondary)',
      borderColor: 'var(--border-dim)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}

// ── Formatting ──────────────────────────────────────────────────────────────────
function fmtCurrency(v, currency) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  if (Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `${currency} ${(v / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function fmtCpk(v, currency) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${currency} ${v.toFixed(4)}/km`
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${v.toFixed(1)}%`
}

function dateFromPreset(days) {
  if (!days) return ''
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-colors disabled:opacity-50'
const TEXT_BTN = 'inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-colors disabled:opacity-50'
const PANEL = 'rounded-xl border border-[var(--border-dim)] p-5 bg-[var(--surface-1)]'

// ── Main Component ───────────────────────────────────────────────────────────────
export default function CostCenter() {
  const { activeCurrency, activeCountry } = useSettings()
  const { t } = useLanguage()
  const [filters, setFilter, resetFilters, hasActiveFilters] = useFilterState(FILTER_DEFAULTS)

  const [records, setRecords]           = useState([])
  const [truncated, setTruncated]       = useState(false)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [activeTab, setActiveTab]       = useState('bySite')
  const [preset, setPreset]             = useState('1yr')
  const [dateFrom, setDateFrom]         = useState(dateFromPreset(365))
  const [dateTo, setDateTo]             = useState(new Date().toISOString().slice(0, 10))
  const [roiSlider, setRoiSlider]       = useState(10)   // % improvement
  const [exporting, setExporting]       = useState(false)

  // ── Tyres vs Maintenance cost switch (independent load, country scoped) ────────
  const [costMode, setCostMode]         = useState('combined')
  const [split, setSplit]               = useState(null)
  const [splitLoading, setSplitLoading] = useState(true)
  const [splitError, setSplitError]     = useState(null)
  const [splitNonce, setSplitNonce]     = useState(0)

  useEffect(() => {
    let cancelled = false
    setSplitLoading(true)
    setSplitError(null)
    loadGovernedCostSplit({ country: activeCountry, maxAgeMs: COST_SPLIT_TTL_MS })
      .then(res => { if (!cancelled) setSplit(res) })
      .catch(e => { if (!cancelled) setSplitError(toUserMessage(e, 'Failed to load cost split')) })
      .finally(() => { if (!cancelled) setSplitLoading(false) })
    return () => { cancelled = true }
  }, [activeCountry, splitNonce])

  // ── Spend for the SELECTED window: the KPI strip's authoritative figure ──────
  // Read from the expense grid, never summed from cost_per_tyre.
  const [spendSplit, setSpendSplit]     = useState(null)
  const [spendError, setSpendError]     = useState(null)
  const [spendLoading, setSpendLoading] = useState(true)
  const latestSpend = useLatestRequest()
  const loadSpend = useCallback(async () => {
    const stale = latestSpend.begin()
    setSpendLoading(true)
    setSpendError(null)
    try {
      const res = await loadGovernedCostSplit({
        country: activeCountry, from: dateFrom || undefined, to: dateTo || undefined, maxAgeMs: COST_SPLIT_TTL_MS,
      })
      if (!stale()) setSpendSplit(res)
    } catch (e) {
      if (!stale()) { setSpendSplit(null); setSpendError(toUserMessage(e, 'Could not load spend for this period')) }
    } finally {
      if (!stale()) setSpendLoading(false)
    }
  }, [activeCountry, dateFrom, dateTo, latestSpend])
  useEffect(() => { loadSpend() }, [loadSpend])

  // ── Data Fetch ────────────────────────────────────────────────────────────────
  // A newer filter change supersedes an in-flight read: drop the stale answer.
  const latestFetch = useLatestRequest()
  const fetchData = useCallback(async () => {
    const stale = latestFetch.begin()
    setLoading(true)
    setError(null)
    setTruncated(false)
    try {
      const { data, truncated: trunc } = await costCenter.fetchCostCenterRecords({
        country: activeCountry,
        dateFrom,
        dateTo
      })
      if (stale()) return
      setRecords(data)
      setTruncated(trunc)
    } catch (e) {
      if (!stale()) setError(toUserMessage(e, 'Failed to load data'))
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [activeCountry, dateFrom, dateTo, latestFetch])

  useEffect(() => { fetchData() }, [fetchData])

  const refreshAll = useCallback(() => {
    fetchData()
    loadSpend()
    setSplitNonce(n => n + 1)
  }, [fetchData, loadSpend])

  // ── Derived (all maths in src/lib/costCenterAnalytics.js) ──────────────────────
  const normalised = useMemo(() => normaliseRecords(records), [records])
  const siteOptions = useMemo(() => optionsFrom(normalised, 'siteKey'), [normalised])
  const brandOptions = useMemo(() => optionsFrom(normalised, 'brandKey'), [normalised])
  const scoped = useMemo(
    () => filterRecords(normalised, { q: filters.q, site: filters.site, brand: filters.brand }),
    [normalised, filters.q, filters.site, filters.brand],
  )

  const recordKpis = useMemo(() => buildRecordKpis(scoped, { fallbackCurrency: activeCurrency }), [scoped, activeCurrency])
  const fleetAvgCpk = recordKpis.fleetAvgCpk
  const cpkCurrency = recordKpis.mixedCurrency ? activeCurrency : (recordKpis.currency || activeCurrency)
  const spend = useMemo(
    () => buildSpendKpis(spendSplit, { from: dateFrom, to: dateTo, fleetAvgCpk, mode: 'tyres' }),
    [spendSplit, dateFrom, dateTo, fleetAvgCpk],
  )
  const spendCurrency = spendSplit && !spendSplit.blended ? spendSplit.currency : activeCurrency

  const bySite = useMemo(() => groupBySite(scoped, { fallbackCurrency: activeCurrency }), [scoped, activeCurrency])
  const byBrand = useMemo(() => groupByBrand(scoped, { fallbackCurrency: activeCurrency }), [scoped, activeCurrency])
  const byVehicle = useMemo(
    () => groupByVehicle(scoped, { fleetAvgCpk, fallbackCurrency: activeCurrency }),
    [scoped, fleetAvgCpk, activeCurrency],
  )
  const byMonth = useMemo(() => groupByMonth(scoped, { fallbackCurrency: activeCurrency }), [scoped, activeCurrency])

  // The ANOMALY FEED keeps its 50-asset population on purpose. It scans the most
  // expensive assets for CPK outliers, and widening it to every asset would
  // change which alerts a manager is shown - a different decision from making a
  // table readable, and not one to slip into a paging change.
  const byVehicleTop50 = useMemo(() => byVehicle.slice(0, 50), [byVehicle])

  const anomalies = useMemo(() => buildAnomalies({
    vehicles: byVehicleTop50, sites: bySite, brands: byBrand, fleetAvgCpk,
  }), [byVehicleTop50, bySite, byBrand, fleetAvgCpk])

  const roi = useMemo(() => roiFor(roiSlider, spend.monthlyBurn), [roiSlider, spend.monthlyBurn])
  const siteConcentration = useMemo(() => topShare(bySite, 3), [bySite])

  // ── Tyres vs Maintenance derived values ───────────────────────────────────────
  const splitByMonth = useMemo(() => split?.byMonth ?? [], [split?.byMonth])
  const splitAgg = useMemo(() => splitTotals(splitByMonth), [splitByMonth])
  const splitSeries = useMemo(() => pickMonthly(costMode, splitByMonth), [costMode, splitByMonth])
  const modeColor = colorAt(MODE_INDEX[costMode] ?? 0)
  const splitChartData = useMemo(() => ({
    labels: splitSeries.map(m => monthLabel(m.month)),
    datasets: [{
      label: `${costModeLabel(costMode)} spend`,
      data: splitSeries.map(m => m.value),
      backgroundColor: withAlpha(modeColor, 0.7),
      borderColor: modeColor,
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [splitSeries, costMode, modeColor])
  const splitHasData = splitAgg.combined > 0

  // ── Period preset handler ─────────────────────────────────────────────────────
  function applyPreset(label) {
    const p = PERIOD_PRESETS.find(x => x.label === label)
    if (!p) return
    setPreset(p.label)
    setDateFrom(dateFromPreset(p.days))
    setDateTo(new Date().toISOString().slice(0, 10))
  }

  // ── Chart Data (money charts skip rows whose currency is mixed: N/A) ─────────
  const valuedSites = useMemo(() => bySite.filter(s => s.totalCost != null), [bySite])
  const siteBarData = useMemo(() => ({
    labels: valuedSites.slice(0, 10).map(s => s.site),
    datasets: [{
      label: t('costcenter.charts.totalCost'),
      data: valuedSites.slice(0, 10).map(s => s.totalCost),
      backgroundColor: categorical(Math.min(10, valuedSites.length)),
      borderRadius: 4,
    }],
  }), [valuedSites, t])

  const brandCpk = useMemo(() => byBrand.filter(b => b.avgCpk != null), [byBrand])
  const brandBarData = useMemo(() => ({
    labels: brandCpk.slice(0, 10).map(b => b.brand),
    datasets: [{
      label: t('costcenter.charts.avgCpk'),
      data: brandCpk.slice(0, 10).map(b => b.avgCpk),
      backgroundColor: categorical(Math.min(10, brandCpk.length)),
      borderRadius: 4,
    }],
  }), [brandCpk, t])

  const monthlyLineData = useMemo(() => ({
    labels: byMonth.map(m => monthLabel(m.month)),
    datasets: [
      {
        label: t('costcenter.charts.totalCost'),
        data: byMonth.map(m => m.totalCost),
        borderColor: colorAt(0),
        backgroundColor: withAlpha(colorAt(0), 0.12),
        tension: 0.3, fill: true, yAxisID: 'y', pointRadius: 4, pointHoverRadius: 6, spanGaps: false,
      },
      {
        label: t('costcenter.charts.avgCpk'),
        data: byMonth.map(m => m.avgCpk),
        borderColor: colorAt(1),
        backgroundColor: 'transparent',
        tension: 0.3, fill: false, yAxisID: 'y1', borderDash: [4, 4], pointRadius: 3, pointHoverRadius: 5, spanGaps: false,
      },
    ],
  }), [byMonth, t])

  const monthlyTrendData = useMemo(() => {
    const costs = byMonth.map(m => m.totalCost)
    return {
      labels: byMonth.map(m => monthLabel(m.month)),
      datasets: [
        { label: t('costcenter.charts.monthlySpend'), data: costs, backgroundColor: withAlpha(colorAt(0), 0.7), borderRadius: 4, type: 'bar' },
        {
          label: t('costcenter.charts.movingAvg3'), data: movingAvg(costs, 3), borderColor: colorAt(2),
          backgroundColor: 'transparent', type: 'line', tension: 0.4, borderWidth: 2, pointRadius: 0, yAxisID: 'y',
        },
      ],
    }
  }, [byMonth, t])

  const doughnutData = useMemo(() => {
    const top8  = bySite.slice(0, 8).filter(s => s.totalCost != null)
    const other = bySite.slice(8).reduce((s, r) => s + (r.totalCost ?? 0), 0)
    const labels = [...top8.map(s => s.site)]
    const data   = [...top8.map(s => s.totalCost)]
    if (other > 0) { labels.push(t('costcenter.charts.other')); data.push(other) }
    return {
      labels,
      datasets: [{ data, backgroundColor: categorical(labels.length), borderColor: 'var(--surface-1)', borderWidth: 1 }],
    }
  }, [bySite, t])

  const topAssetsData = useMemo(() => {
    const top10 = byVehicle.slice(0, 10).filter(v => v.totalCost != null)
    return {
      labels: top10.map(v => v.asset),
      datasets: [{ label: t('costcenter.charts.totalCost'), data: top10.map(v => v.totalCost), backgroundColor: withAlpha(colorAt(4), 0.75), borderRadius: 4 }],
    }
  }, [byVehicle, t])

  // ── Table columns ─────────────────────────────────────────────────────────────
  const money = useCallback((v, cur) => fmtCurrency(v, cur || activeCurrency), [activeCurrency])

  const siteColumns = useMemo(() => [
    { id: 'site', header: t('costcenter.columns.bySite.site'), accessorFn: s => s.site, size: 180, meta: { filterVariant: 'text' },
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.site}</span> },
    { id: 'count', header: t('costcenter.columns.bySite.tyres'), accessorFn: s => s.count, size: 90, meta: { align: 'right' } },
    { id: 'priced', header: 'Priced', accessorFn: s => s.priced, size: 90, meta: { align: 'right' } },
    { id: 'totalCost', header: t('costcenter.columns.bySite.totalCost'), accessorFn: s => s.totalCost ?? -1, size: 140, meta: { align: 'right', exportValue: s => s.totalCost ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{money(row.original.totalCost, row.original.currency)}</span> },
    { id: 'avgCost', header: t('costcenter.columns.bySite.avgCostPerTyre'), accessorFn: s => s.avgCost ?? -1, size: 140, meta: { align: 'right', exportValue: s => s.avgCost ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{money(row.original.avgCost, row.original.currency)}</span> },
    { id: 'avgCpk', header: t('costcenter.columns.bySite.avgCpk'), accessorFn: s => s.avgCpk ?? -1, size: 140, meta: { align: 'right', exportValue: s => s.avgCpk ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCpk(row.original.avgCpk, row.original.currency || activeCurrency)}</span> },
    { id: 'delta', header: t('costcenter.columns.bySite.vsFleetAvg'), accessorFn: s => cpkDelta(s.avgCpk, fleetAvgCpk)?.pct ?? null, size: 130, enableSorting: true,
      meta: { exportValue: s => { const d = cpkDelta(s.avgCpk, fleetAvgCpk); return d ? `${d.pct.toFixed(0)}%` : 'N/A' } },
      cell: ({ row }) => <DeltaBadge delta={cpkDelta(row.original.avgCpk, fleetAvgCpk)} /> },
  ], [t, money, activeCurrency, fleetAvgCpk])

  const brandColumns = useMemo(() => [
    { id: 'rank', header: t('costcenter.columns.byBrand.rank'), accessorFn: b => b.rank, size: 80, cell: ({ row }) => <RankBadge rank={row.original.rank} /> },
    { id: 'brand', header: t('costcenter.columns.byBrand.brand'), accessorFn: b => b.brand, size: 160, meta: { filterVariant: 'text' },
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.brand}</span> },
    { id: 'count', header: t('costcenter.columns.byBrand.count'), accessorFn: b => b.count, size: 90, meta: { align: 'right' } },
    { id: 'totalCost', header: t('costcenter.columns.byBrand.totalCost'), accessorFn: b => b.totalCost ?? -1, size: 140, meta: { align: 'right', exportValue: b => b.totalCost ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{money(row.original.totalCost, row.original.currency)}</span> },
    { id: 'avgCpk', header: t('costcenter.columns.byBrand.avgCpk'), accessorFn: b => b.avgCpk ?? -1, size: 140, meta: { align: 'right', exportValue: b => b.avgCpk ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCpk(row.original.avgCpk, row.original.currency || activeCurrency)}</span> },
    { id: 'failureRate', header: t('costcenter.columns.byBrand.failureRate'), accessorFn: b => b.failureRate ?? -1, size: 130, meta: { align: 'right', exportValue: b => b.failureRate ?? 'N/A' },
      cell: ({ row }) => <FailureBadge rate={row.original.failureRate} /> },
    { id: 'bestPosition', header: t('costcenter.columns.byBrand.bestPosition'), accessorFn: b => b.bestPosition, size: 130 },
  ], [t, money, activeCurrency])

  const vehicleColumns = useMemo(() => [
    { id: 'asset', header: t('costcenter.columns.byVehicle.assetNo'), accessorFn: v => v.asset, size: 140, meta: { filterVariant: 'text' },
      cell: ({ row }) => <span className="font-mono text-xs font-medium text-[var(--text-primary)]">{row.original.asset}</span> },
    { id: 'count', header: t('costcenter.columns.byVehicle.tyres'), accessorFn: v => v.count, size: 90, meta: { align: 'right' } },
    { id: 'totalCost', header: t('costcenter.columns.byVehicle.totalCost'), accessorFn: v => v.totalCost ?? -1, size: 140, meta: { align: 'right', exportValue: v => v.totalCost ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{money(row.original.totalCost, row.original.currency)}</span> },
    { id: 'avgCpk', header: t('costcenter.columns.byVehicle.avgCpk'), accessorFn: v => v.avgCpk ?? -1, size: 140, meta: { align: 'right', exportValue: v => v.avgCpk ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCpk(row.original.avgCpk, row.original.currency || activeCurrency)}</span> },
    { id: 'riskScore', header: t('costcenter.columns.byVehicle.riskScore'), accessorFn: v => v.riskScore, size: 130, meta: { align: 'right' },
      cell: ({ row }) => <RiskBadge score={row.original.riskScore} t={t} /> },
    { id: 'trend', header: t('costcenter.columns.byVehicle.trend'), accessorFn: v => v.trend, size: 140,
      meta: { filterVariant: 'select', filterOptions: ['up', 'down', 'flat', 'unknown'] },
      cell: ({ row }) => <TrendBadge trend={row.original.trend} t={t} /> },
  ], [t, money, activeCurrency])

  const monthColumns = useMemo(() => [
    { id: 'month', header: 'Month', accessorFn: m => m.month, size: 120, cell: ({ row }) => monthLabel(row.original.month) },
    { id: 'count', header: 'Tyres', accessorFn: m => m.count, size: 90, meta: { align: 'right' } },
    { id: 'totalCost', header: 'Priced value', accessorFn: m => m.totalCost ?? -1, size: 140, meta: { align: 'right', exportValue: m => m.totalCost ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{money(row.original.totalCost, row.original.currency)}</span> },
    { id: 'avgCpk', header: 'Avg CPK', accessorFn: m => m.avgCpk ?? -1, size: 140, meta: { align: 'right', exportValue: m => m.avgCpk ?? 'N/A' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCpk(row.original.avgCpk, row.original.currency || activeCurrency)}</span> },
  ], [money, activeCurrency])

  // ── Export Handlers (always the FULL filtered set, never a visible page) ─────
  const exportTitle = reportFileName('Cost Center', activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries')
  function sheetsForExport() {
    const na = (v, digits = 0) => (v == null ? 'N/A' : Number(v.toFixed(digits)))
    return [
      {
        name: 'By Site',
        rows: bySite.map(s => ({
          site: s.site, count: s.count, priced: s.priced, currency: s.mixedCurrency ? 'Mixed' : (s.currency || activeCurrency),
          totalCost: na(s.totalCost), avgCost: na(s.avgCost), avgCpk: na(s.avgCpk, 4),
        })),
        columns: ['site', 'count', 'priced', 'currency', 'totalCost', 'avgCost', 'avgCpk'],
        headers: ['Site', 'Tyres', 'Priced tyres', 'Currency', 'Priced value', 'Avg cost per priced tyre', 'Avg CPK'],
      },
      {
        name: 'By Brand',
        rows: byBrand.map(b => ({
          rank: b.rank, brand: b.brand, count: b.count, currency: b.mixedCurrency ? 'Mixed' : (b.currency || activeCurrency),
          totalCost: na(b.totalCost), avgCpk: na(b.avgCpk, 4), failureRate: na(b.failureRate, 1), bestPosition: b.bestPosition,
        })),
        columns: ['rank', 'brand', 'count', 'currency', 'totalCost', 'avgCpk', 'failureRate', 'bestPosition'],
        headers: ['Rank', 'Brand', 'Tyres', 'Currency', 'Priced value', 'Avg CPK', 'Failure rate %', 'Most used position'],
      },
      {
        name: 'By Vehicle',
        rows: byVehicle.map(v => ({
          asset: v.asset, count: v.count, currency: v.mixedCurrency ? 'Mixed' : (v.currency || activeCurrency),
          totalCost: na(v.totalCost), avgCpk: na(v.avgCpk, 4), riskScore: v.riskScore, trend: v.trend,
        })),
        columns: ['asset', 'count', 'currency', 'totalCost', 'avgCpk', 'riskScore', 'trend'],
        headers: ['Asset', 'Tyres', 'Currency', 'Priced value', 'Avg CPK', 'High-risk tyres', 'CPK vs fleet'],
      },
      {
        name: 'By Month',
        rows: byMonth.map(m => ({ month: monthLabel(m.month), count: m.count, totalCost: na(m.totalCost), avgCpk: na(m.avgCpk, 4) })),
        columns: ['month', 'count', 'totalCost', 'avgCpk'],
        headers: ['Month', 'Tyres', 'Priced value', 'Avg CPK'],
      },
    ]
  }

  async function handleExcelExport() {
    setExporting(true)
    try {
      await exportSheetsToExcel(sheetsForExport(), exportTitle, {
        title: 'Cost Center',
        dateRange: dateFrom || dateTo ? `${dateFrom || 'start'} to ${dateTo || 'today'}` : 'All dates',
        notes: [
          'Values are priced tyre records (cost_per_tyre). The authoritative spend total comes from the expense grid.',
          'A row spanning more than one currency shows N/A; currencies are never added together.',
        ],
      })
    } catch (e) {
      setError(toUserMessage(e, 'Could not export the workbook'))
    } finally { setExporting(false) }
  }

  async function handlePdfExport(opts = {}) {
    setExporting(true)
    try {
      return await exportToPdf(
        bySite.map(s => ({
          site:      s.site,
          count:     s.count,
          totalCost: fmtCurrency(s.totalCost, s.currency || activeCurrency),
          avgCpk:    fmtCpk(s.avgCpk, s.currency || activeCurrency),
          delta:     (() => { const d = cpkDelta(s.avgCpk, fleetAvgCpk); return d ? `${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(0)}%` : 'N/A' })(),
        })),
        [
          { key: 'site',      header: 'Site' },
          { key: 'count',     header: 'Tyres' },
          { key: 'totalCost', header: 'Priced value' },
          { key: 'avgCpk',    header: 'Avg CPK' },
          { key: 'delta',     header: 'vs Fleet Avg' },
        ],
        'Cost Center: Cost by Site',
        exportTitle,
        'landscape',
        '',
        { currency: activeCurrency, ...opts },
      )
    } catch (e) {
      if (!opts.returnBase64) setError(toUserMessage(e, 'Could not export the PDF'))
      else throw e
    } finally { setExporting(false) }
  }

  const tabOptions = DIMENSION_TAB_KEYS.map(k => ({ value: k, label: t(`costcenter.tabs.${k}`) }))
  const scopeIsMixed = recordKpis.mixedCurrency || Boolean(spendSplit?.blended)
  const periodText = dateFrom || dateTo ? `${dateFrom || 'start'} to ${dateTo || 'today'}` : 'All dates'

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >

      <BudgetTabs />
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        title={t('costcenter.title')}
        subtitle={t('costcenter.subtitle')}
        icon={DollarSign}
        actions={<>
          <SegmentedControl
            ariaLabel="Period"
            size="sm"
            value={preset}
            onChange={applyPreset}
            options={PERIOD_PRESETS.map(p => ({ value: p.label, label: t(`costcenter.periods.${p.label}`) }))}
          />
          <DateField
            className="text-sm w-40" value={dateFrom}
            onChange={(v) => { setDateFrom(v); setPreset('custom') }}
            placeholder="From date" ariaLabel="From date" max={dateTo || undefined}
          />
          <span className="text-[var(--text-muted)] text-xs">to</span>
          <DateField
            className="text-sm w-40" value={dateTo}
            onChange={(v) => { setDateTo(v); setPreset('custom') }}
            placeholder="To date" ariaLabel="To date" min={dateFrom || undefined}
          />
          <button
            type="button"
            onClick={refreshAll}
            disabled={loading}
            aria-label="Refresh cost data"
            title="Refresh cost data"
            className={ICON_BTN}
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
          <button type="button" onClick={handleExcelExport} disabled={exporting || loading} className={TEXT_BTN}>
            <FileSpreadsheet size={14} />
            {t('costcenter.actions.excel')}
          </button>
          <button type="button" onClick={() => handlePdfExport()} disabled={exporting || loading} className={TEXT_BTN}>
            <FileText size={14} />
            {t('costcenter.actions.pdf')}
          </button>
          <EmailPdfButton
            disabled={exporting || loading}
            className={TEXT_BTN}
            getPdf={async () => ({
              base64: await handlePdfExport({ returnBase64: true }),
              filename: `${exportTitle}.pdf`,
              subject: 'Cost Center',
              bodyHtml: '<p>Attached is the Cost Center report.</p>',
            })}
          />
        </>}
      />

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1 min-w-0">{error}</span>
          <button type="button" onClick={fetchData} className={TEXT_BTN}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────────────── */}
      {loading && (
        <div className="space-y-4" aria-busy="true">
          <SkeletonCards count={4} />
          <SkeletonTable rows={8} cols={5} />
        </div>
      )}

      {!loading && !error && (
        <>
          {/* ── Capped view note ─────────────────────────────────────────────── */}
          {truncated && (
            <div role="status" className="flex items-center gap-2 p-3 rounded-lg bg-yellow-900/25 border border-yellow-800/50 text-yellow-200 text-sm">
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span>
                Capped view: showing the most recent {TYRE_ROW_CEILING.toLocaleString()} tyre records for this selection. CPK and the per-dimension tables below cover this bounded set only. The spend figures read the expense grid and are not capped. Narrow the country or date range for exact figures.
              </span>
            </div>
          )}

          {scopeIsMixed && (
            <div role="note" className="flex items-start gap-2 p-3 rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-secondary)] text-sm">
              <Info size={16} className="shrink-0 mt-0.5 text-[var(--text-muted)]" />
              <span>
                This view spans more than one currency. Spend is shown per currency and never added together; CPK, burn rate and any row that mixes currencies read N/A. Pick a single country for comparable figures.
              </span>
            </div>
          )}

          {/* ── 1. KPI strip ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile
              index={0}
              icon={DollarSign}
              label="Tyre spend (expense grid)"
              value={spendLoading ? '...' : spendError ? 'N/A' : <CostValue split={spendSplit} mode="tyres" compact />}
              sub={spendError ? 'Could not read spend' : periodText}
              tone="accent"
            />
            <StatTile
              index={1}
              icon={Target}
              label={t('costcenter.kpi.fleetAvgCpk.label')}
              value={fmtCpk(fleetAvgCpk, cpkCurrency)}
              sub={fleetAvgCpk == null
                ? (recordKpis.mixedCurrency ? 'Mixed currencies' : 'No measurable CPK')
                : `${recordKpis.cpkCount.toLocaleString()} tyres measured. Benchmark ${INDUSTRY_BENCHMARK_CPK}/km`}
              tone={fleetAvgCpk != null && fleetAvgCpk > INDUSTRY_BENCHMARK_CPK ? 'crit' : 'neutral'}
            />
            <StatTile
              index={2}
              icon={BarChart2}
              label={t('costcenter.kpi.monthlyBurn.label')}
              value={fmtCurrency(spend.monthlyBurn, spendCurrency)}
              sub={spend.months ? `Over ${spend.months.toFixed(1)} months` : 'Period not measurable'}
              tone="info"
            />
            <StatTile
              index={3}
              icon={TrendingUp}
              label={t('costcenter.kpi.annualized.label')}
              value={fmtCurrency(spend.annualized, spendCurrency)}
              sub={t('costcenter.kpi.annualized.sub')}
              tone="neutral"
            />
            <StatTile
              index={4}
              icon={Zap}
              label={t('costcenter.kpi.savings.label')}
              value={spend.savings == null ? 'N/A' : spend.savings > 0 ? fmtCurrency(spend.savings, spendCurrency) : t('costcenter.kpi.savings.onTarget')}
              sub={spend.savings == null ? 'Needs spend and CPK' : spend.savings > 0 ? t('costcenter.kpi.savings.subOpportunity') : t('costcenter.kpi.savings.subOnTarget')}
              tone={spend.savings > 0 ? 'warn' : 'neutral'}
            />
            <StatTile
              index={5}
              icon={Percent}
              label="Priced records"
              value={fmtPct(recordKpis.pricedPct)}
              sub={`${recordKpis.priced.toLocaleString()} of ${recordKpis.records.toLocaleString()} tyres carry a price`}
              tone={recordKpis.pricedPct != null && recordKpis.pricedPct < 60 ? 'warn' : 'neutral'}
            />
          </div>

          {/* ── Filters (record-level views) ──────────────────────────────────── */}
          <FilterBar
            search={filters.q}
            onSearch={(v) => setFilter('q', v)}
            searchLabel="Search tyre cost records"
            placeholder="Search asset, site, brand, position or removal reason"
            selects={[
              { key: 'site', value: filters.site, onChange: (v) => setFilter('site', v), placeholder: 'All sites', ariaLabel: 'Filter by site',
                options: siteOptions.map(v => ({ value: v, label: v })) },
              { key: 'brand', value: filters.brand, onChange: (v) => setFilter('brand', v), placeholder: 'All brands', ariaLabel: 'Filter by brand',
                options: brandOptions.map(v => ({ value: v, label: v })) },
            ]}
            resultCount={scoped.length}
            onClearAll={hasActiveFilters ? resetFilters : undefined}
          />
          {hasActiveFilters && (
            <p className="text-xs text-[var(--text-muted)] -mt-3">
              These filters narrow the CPK figures, charts, tables and anomalies to {scoped.length.toLocaleString()} of {normalised.length.toLocaleString()} tyre records.
              The spend figures read the expense grid for the whole {activeCountry && activeCountry !== 'All' ? activeCountry : 'selected'} scope and are not narrowed by site, brand or search.
            </p>
          )}

          {/* ── 1b. Tyres vs Maintenance switch ──────────────────────────────── */}
          <section className={PANEL} aria-labelledby="cc-split-heading">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-5">
              <div>
                <h3 id="cc-split-heading" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <SlidersHorizontal size={15} className="text-[var(--accent)]" />
                  Tyres vs Maintenance
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  One click separates tyre spend from maintenance spend (pm services plus work order repairs) over the last 12 months.
                </p>
              </div>
              <SegmentedControl
                ariaLabel="Cost view"
                value={costMode}
                onChange={setCostMode}
                options={COST_MODES.map(m => ({ value: m.key, label: m.label }))}
              />
            </div>

            {splitError ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm">
                <AlertTriangle size={16} />
                <span className="flex-1 min-w-0">{splitError}</span>
                <button type="button" onClick={() => setSplitNonce(n => n + 1)} className={TEXT_BTN}><RefreshCw size={13} /> Retry</button>
              </div>
            ) : splitLoading ? (
              <div className="flex items-center justify-center py-16 text-[var(--text-muted)] text-sm gap-2">
                <Loader2 size={16} className="animate-spin" />
                Loading cost split
              </div>
            ) : !splitHasData ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Wrench size={32} className="text-[var(--text-dim)]" />
                <p className="text-[var(--text-secondary)] text-sm font-medium">No tyre or maintenance spend recorded</p>
                <p className="text-[var(--text-muted)] text-xs">Costs will appear here once tyre or maintenance records exist for this period.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="space-y-3">
                  <div className="p-4 rounded-xl border" style={{ borderColor: withAlpha(modeColor, 0.4), background: withAlpha(modeColor, 0.07) }}>
                    <p className="text-xs text-[var(--text-muted)] font-medium">{costModeLabel(costMode)} spend (12 months)</p>
                    {/* GOVERNED: one figure per currency, never a blend. */}
                    <p className="text-2xl font-bold mt-1 text-[var(--text-primary)] tabular-nums">
                      <CostValue split={split} mode={costMode} />
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setCostMode('tyres')}
                      aria-pressed={costMode === 'tyres'}
                      className={`min-h-[44px] p-3 rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${costMode === 'tyres' ? 'border-[var(--accent)]' : 'border-[var(--border-dim)]'}`}
                    >
                      <p className="text-[11px] text-[var(--text-muted)]">Tyres</p>
                      <p className="text-sm font-bold text-[var(--text-primary)] mt-0.5 tabular-nums"><CostValue split={split} mode="tyres" /></p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCostMode('maintenance')}
                      aria-pressed={costMode === 'maintenance'}
                      className={`min-h-[44px] p-3 rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${costMode === 'maintenance' ? 'border-[var(--accent)]' : 'border-[var(--border-dim)]'}`}
                    >
                      <p className="text-[11px] text-[var(--text-muted)]">Maintenance</p>
                      <p className="text-sm font-bold text-[var(--text-primary)] mt-0.5 tabular-nums"><CostValue split={split} mode="maintenance" /></p>
                    </button>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)]">
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {split?.blended
                        ? `Scope: ${costScopeLabel(split)}. Shares are not shown across currencies.`
                        : `Tyres are ${fmtPct(splitAgg.combined > 0 ? (splitAgg.tyre / splitAgg.combined) * 100 : null)} of total spend, maintenance ${fmtPct(splitAgg.combined > 0 ? (splitAgg.maintenance / splitAgg.combined) * 100 : null)}.`}
                    </p>
                  </div>
                </div>

                <div className="lg:col-span-2 h-64" role="img" aria-label={`${costModeLabel(costMode)} spend by month for the last 12 months`}>
                  <Bar
                    data={splitChartData}
                    options={{
                      ...CHART_DEFAULTS,
                      plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                      scales: {
                        ...CHART_DEFAULTS.scales,
                        y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${(v/1000).toFixed(0)}K` } },
                      },
                    }}
                  />
                </div>
              </div>
            )}
          </section>

          {/* ── Multi-year expense trend + forecast ──────────────────────────── */}
          <YearlyTrendPanel title="Expense trend by year (tyres / spare / lubricant) + forecast" />

          {/* ── 1c. Cost per unit (m3 / km / engine-hour) ────────────────────── */}
          <CostPerUnitSection
            currency={activeCurrency}
            country={activeCountry}
            siteOptions={bySite.map(s => s.site).filter(s => s && s !== 'Unknown')}
          />

          {/* ── 2. Dimension tabs ────────────────────────────────────────────── */}
          <section className={PANEL} aria-labelledby="cc-dim-heading">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
              <div>
                <h3 id="cc-dim-heading" className="text-sm font-semibold text-[var(--text-primary)]">Priced tyre records by dimension</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Ranks where tyre value and cost per km concentrate. Values are priced tyre records, not the expense total.
                  {siteConcentration != null && ` The top 3 sites hold ${siteConcentration.toFixed(0)}% of the priced value.`}
                </p>
              </div>
              <SegmentedControl ariaLabel="Dimension" value={activeTab} onChange={setActiveTab} options={tabOptions} />
            </div>

            {activeTab === 'bySite' && (
              <div className="space-y-5">
                <ChartBox label="Priced value by site, top 10" empty={siteBarData.labels.length === 0} emptyText={t('costcenter.states.noData')} className="h-64">
                  <Bar data={siteBarData} options={{ ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                    scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${(v/1000).toFixed(0)}K` } } } }} />
                </ChartBox>
                <EnterpriseTable
                  enableKeyboard={false}
                  columns={siteColumns}
                  data={bySite}
                  getRowId={s => s.site}
                  emptyMessage={hasActiveFilters ? 'No sites match these filters' : t('costcenter.states.noDataPeriod')}
                  searchPlaceholder="Search sites"
                  exportFileName={reportFileName('Cost Center by Site')}
                  reportMeta={{ title: 'Cost Center: by site', currency: activeCurrency, dateRange: periodText }}
                  viewKey="cost-center-site"
                />
              </div>
            )}

            {activeTab === 'byBrand' && (
              <div className="space-y-5">
                <ChartBox label="Average CPK by brand, lowest 10" empty={brandBarData.labels.length === 0} emptyText="No brand has a measurable CPK" className="h-64">
                  <Bar data={brandBarData} options={{ ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                    scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => v.toFixed(3) } } } }} />
                </ChartBox>
                <EnterpriseTable
                  enableKeyboard={false}
                  columns={brandColumns}
                  data={byBrand}
                  getRowId={b => b.brand}
                  emptyMessage={hasActiveFilters ? 'No brands match these filters' : t('costcenter.states.noDataPeriod')}
                  searchPlaceholder="Search brands"
                  exportFileName={reportFileName('Cost Center by Brand')}
                  reportMeta={{ title: 'Cost Center: by brand', currency: activeCurrency, dateRange: periodText }}
                  viewKey="cost-center-brand"
                />
              </div>
            )}

            {activeTab === 'byVehicle' && (
              <EnterpriseTable
                enableKeyboard={false}
                columns={vehicleColumns}
                data={byVehicle}
                getRowId={v => v.asset}
                emptyMessage={hasActiveFilters ? 'No vehicles match these filters' : t('costcenter.states.noDataPeriod')}
                searchPlaceholder="Search assets"
                exportFileName={reportFileName('Cost Center by Vehicle')}
                reportMeta={{ title: 'Cost Center: by vehicle', currency: activeCurrency, dateRange: periodText }}
                viewKey="cost-center-vehicle"
              />
            )}

            {activeTab === 'byMonth' && (
              <div className="space-y-5">
                <ChartBox label="Priced value and average CPK by month" empty={byMonth.length === 0} emptyText={t('costcenter.states.noMonthlyData')} className="h-80">
                  <Line
                    data={monthlyLineData}
                    options={{
                      ...CHART_DEFAULTS,
                      scales: {
                        x: CHART_DEFAULTS.scales.x,
                        y: { ...CHART_DEFAULTS.scales.y, position: 'left', ticks: { color: 'var(--text-muted)', callback: v => `${(v/1000).toFixed(0)}K` } },
                        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: 'var(--text-muted)', callback: v => v.toFixed(3) } },
                      },
                    }}
                  />
                </ChartBox>
                <EnterpriseTable
                  enableKeyboard={false}
                  columns={monthColumns}
                  data={byMonth}
                  getRowId={m => m.month}
                  emptyMessage={t('costcenter.states.noMonthlyData')}
                  enableColumnFilters={false}
                  exportFileName={reportFileName('Cost Center by Month')}
                  reportMeta={{ title: 'Cost Center: by month', currency: activeCurrency, dateRange: periodText }}
                />
              </div>
            )}
          </section>

          {/* ── 3. Breakdown Charts ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className={PANEL}>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <PieChart size={15} className="text-[var(--text-muted)]" />
                {t('costcenter.charts.costDistribution')}
              </h3>
              <ChartBox label="Share of priced value by site" empty={doughnutData.datasets[0].data.length === 0} emptyText={t('costcenter.states.noData')} className="h-56">
                <Doughnut
                  data={doughnutData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: 'right', labels: { color: 'var(--text-muted)', font: { size: 10 }, boxWidth: 12, padding: 8 } },
                      tooltip: CHART_DEFAULTS.plugins.tooltip,
                    },
                    cutout: '62%',
                  }}
                />
              </ChartBox>
            </div>

            <div className={PANEL}>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <Award size={15} className="text-[var(--text-muted)]" />
                {t('costcenter.charts.topAssets')}
              </h3>
              <ChartBox label="Top 10 assets by priced value" empty={topAssetsData.datasets[0].data.length === 0} emptyText={t('costcenter.states.noData')} className="h-56">
                <Bar
                  data={topAssetsData}
                  options={{
                    ...CHART_DEFAULTS,
                    indexAxis: 'y',
                    plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                    scales: {
                      x: { ...CHART_DEFAULTS.scales.x, ticks: { ...CHART_DEFAULTS.scales.x.ticks, callback: v => `${(v/1000).toFixed(0)}K` } },
                      y: { ...CHART_DEFAULTS.scales.y, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
                    },
                  }}
                />
              </ChartBox>
            </div>

            <div className={PANEL}>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <TrendingUp size={15} className="text-[var(--text-muted)]" />
                {t('costcenter.charts.monthlyTrend')}
              </h3>
              <ChartBox label="Monthly priced value with a 3 month moving average" empty={byMonth.length === 0} emptyText={t('costcenter.states.noData')} className="h-56">
                <Bar
                  data={monthlyTrendData}
                  options={{
                    ...CHART_DEFAULTS,
                    plugins: { ...CHART_DEFAULTS.plugins, legend: { labels: { color: 'var(--text-muted)', font: { size: 10 }, boxWidth: 12 } } },
                    scales: {
                      x: { ...CHART_DEFAULTS.scales.x, ticks: { color: 'var(--text-muted)', font: { size: 9 } } },
                      y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${(v/1000).toFixed(0)}K` } },
                    },
                  }}
                />
              </ChartBox>
            </div>
          </div>

          {/* ── 4. Anomaly Detection ─────────────────────────────────────────── */}
          <section className={PANEL} aria-labelledby="cc-anomaly-heading">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h3 id="cc-anomaly-heading" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <ShieldAlert size={15} className="text-[var(--text-muted)]" />
                {t('costcenter.anomaly.heading')}
                {anomalies.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 text-xs font-bold border border-red-800/60">
                    {anomalies.length}
                  </span>
                )}
              </h3>
              <span className="text-xs text-[var(--text-muted)]">
                {t('costcenter.anomaly.fleetAvgCpk', { value: fmtCpk(fleetAvgCpk, cpkCurrency) })}. Vehicles scanned: top {ANOMALY_VEHICLE_POPULATION} by value.
              </span>
            </div>

            {fleetAvgCpk == null && anomalies.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                CPK anomalies need a measurable fleet average, which this scope does not have. Brand failure rates are still checked.
              </p>
            ) : anomalies.length === 0 ? (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-900/20 border border-green-800/40">
                <CheckCircle2 size={18} className="text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{t('costcenter.anomaly.noneTitle')}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{t('costcenter.anomaly.noneDesc')}</p>
                </div>
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {anomalies.map(a => (
                  <li key={`${a.type}-${a.id}`} className="p-4 rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)]">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)] leading-tight">{anomalyLabel(a, t)}</span>
                      <SeverityBadge severity={a.severity} t={t} />
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mb-1">{anomalyMetric(a, t, activeCurrency)}</p>
                    <p className="text-xs text-[var(--text-muted)] mb-2">{anomalyDescription(a, t)}</p>
                    <p className="text-[11px] text-[var(--text-secondary)] font-medium leading-tight flex items-start gap-1">
                      <CornerDownRight size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
                      {t(`costcenter.anomaly.rec${a.type === 'vehicle' ? 'Vehicle' : a.type === 'site' ? 'Site' : 'Brand'}`)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── 5. ROI Calculator ────────────────────────────────────────────── */}
          <section className={PANEL} aria-labelledby="cc-roi-heading">
            <h3 id="cc-roi-heading" className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2">
              <Zap size={15} className="text-[var(--text-muted)]" />
              {t('costcenter.roi.heading')}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mb-5">
              {t('costcenter.roi.subtitle')} Based on the tyre spend from the expense grid for the selected period.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label htmlFor="cc-roi-slider" className="text-sm text-[var(--text-secondary)] font-medium">{t('costcenter.roi.sliderLabel')}</label>
                  <span className="text-xl font-bold text-[var(--text-primary)] tabular-nums">{roiSlider}%</span>
                </div>
                <input
                  id="cc-roi-slider"
                  type="range"
                  min={1} max={40} step={1}
                  value={roiSlider}
                  onChange={e => setRoiSlider(Number(e.target.value))}
                  aria-valuetext={`${roiSlider} percent`}
                  className="w-full h-2 rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <div className="flex justify-between text-xs text-[var(--text-muted)] mt-1.5">
                  <span>1%</span><span>20%</span><span>40%</span>
                </div>

                <div className="mt-4 p-3 rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)]">
                  <p className="text-xs text-[var(--text-muted)] font-medium">{t('costcenter.roi.benchmarkTitle')}</p>
                  <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                    <span className="font-bold text-[var(--text-primary)]">{t('costcenter.roi.benchmarkTarget', { currency: cpkCurrency, value: INDUSTRY_BENCHMARK_CPK })}</span>
                    {fleetAvgCpk != null && fleetAvgCpk > 0 && (
                      <span className="ml-2 text-[var(--text-muted)]">
                        ({fleetAvgCpk > INDUSTRY_BENCHMARK_CPK
                          ? t('costcenter.roi.aboveBenchmark', { pct: ((fleetAvgCpk / INDUSTRY_BENCHMARK_CPK - 1) * 100).toFixed(0) })
                          : t('costcenter.roi.withinBenchmark')})
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <RoiTile label={t('costcenter.roi.monthlySavings')} value={fmtCurrency(roi.monthlySavings, spendCurrency)} />
                <RoiTile label={t('costcenter.roi.annualSavings')} value={fmtCurrency(roi.annualSavings, spendCurrency)} />
                <RoiTile
                  label={t('costcenter.roi.paybackPeriod')}
                  value={roi.paybackMonths != null && Number.isFinite(roi.paybackMonths)
                    ? t('costcenter.roi.paybackMonths', { months: roi.paybackMonths.toFixed(1) })
                    : t('costcenter.states.na')}
                />
                <div className="sm:col-span-3 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)]">
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {roi.annualSavings == null
                      ? 'Savings need a single-currency tyre spend for a measurable period. Pick a country and a date range to estimate them.'
                      : t('costcenter.roi.insight', { pct: roiSlider, count: scoped.length, savings: fmtCurrency(roi.annualSavings, spendCurrency) })}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ── Empty state ──────────────────────────────────────────────────── */}
          {normalised.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <BarChart2 size={40} className="text-[var(--text-dim)]" />
              <p className="text-[var(--text-secondary)] font-medium">{t('costcenter.empty.title')}</p>
              <p className="text-[var(--text-muted)] text-sm">{t('costcenter.empty.subtitle')}</p>
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────────
function ChartBox({ label, empty, emptyText, className = '', children }) {
  if (empty) {
    return <div className={`flex items-center justify-center text-[var(--text-muted)] text-sm ${className}`}>{emptyText}</div>
  }
  return <div className={className} role="img" aria-label={label}>{children}</div>
}

function RoiTile({ label, value }) {
  return (
    <div className="p-4 rounded-xl border border-[var(--border-dim)] text-center">
      <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
      <p className="text-lg font-bold text-[var(--text-primary)] tabular-nums">{value}</p>
    </div>
  )
}

function DeltaBadge({ delta }) {
  if (!delta) return <span className="text-[var(--text-muted)] text-xs">N/A</span>
  if (delta.direction === 'flat') {
    return <span className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]"><Minus size={12} aria-hidden="true" />Near average</span>
  }
  const up = delta.direction === 'up'
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-red-400' : 'text-green-400'}`}>
      <Icon size={12} aria-hidden="true" />
      {up ? '+' : ''}{delta.pct.toFixed(0)}% {up ? 'above' : 'below'}
    </span>
  )
}

function FailureBadge({ rate }) {
  if (rate == null) return <span className="text-[var(--text-muted)] text-xs">N/A</span>
  const cls = rate > 20 ? 'text-red-400' : rate > 10 ? 'text-orange-400' : 'text-green-400'
  const word = rate > 20 ? 'High' : rate > 10 ? 'Watch' : 'OK'
  return <span className={`text-xs font-medium tabular-nums ${cls}`}>{fmtPct(rate)} <span className="opacity-80">{word}</span></span>
}

function RiskBadge({ score, t }) {
  const cls = score > 3 ? 'text-red-400' : score > 1 ? 'text-orange-400' : 'text-green-400'
  return <span className={`text-xs font-bold ${cls}`}>{score > 0 ? t('costcenter.risk.high', { count: score }) : t('costcenter.risk.low')}</span>
}

function TrendBadge({ trend, t }) {
  if (trend === 'up') return <span className="inline-flex items-center gap-1 text-xs text-red-400"><TrendingUp size={12} aria-hidden="true" />{t('costcenter.trend.rising')}</span>
  if (trend === 'down') return <span className="inline-flex items-center gap-1 text-xs text-green-400"><TrendingDown size={12} aria-hidden="true" />{t('costcenter.trend.falling')}</span>
  if (trend === 'flat') return <span className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]"><Minus size={12} aria-hidden="true" />{t('costcenter.trend.stable')}</span>
  return <span className="text-xs text-[var(--text-muted)]">N/A</span>
}

const SEVERITY_STYLE = {
  Critical: 'bg-red-900/40 text-red-300 border border-red-800/60',
  High:     'bg-orange-900/40 text-orange-300 border border-orange-800/60',
  Medium:   'bg-yellow-900/40 text-yellow-300 border border-yellow-800/60',
  Low:      'bg-green-900/40 text-green-300 border border-green-800/60',
}

function SeverityBadge({ severity, t }) {
  return (
    <span className={`flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${SEVERITY_STYLE[severity] ?? ''}`}>
      {t(`costcenter.severity.${String(severity).toLowerCase()}`)}
    </span>
  )
}

function anomalyLabel(a, t) {
  if (a.type === 'vehicle') return t('costcenter.anomaly.vehicleLabel', { asset: a.id })
  if (a.type === 'site') return t('costcenter.anomaly.siteLabel', { site: a.id })
  return t('costcenter.anomaly.brandLabel', { brand: a.id })
}

function anomalyMetric(a, t, currency) {
  if (a.type === 'brand') return t('costcenter.anomaly.metricFailureRate', { value: fmtPct(a.value) })
  return t('costcenter.anomaly.metricCpk', { value: fmtCpk(a.value, a.currency || currency) })
}

function anomalyDescription(a, t) {
  if (a.type === 'vehicle') return t('costcenter.anomaly.descVehicle', { pct: a.pct.toFixed(0) })
  if (a.type === 'site') return t('costcenter.anomaly.descSite', { pct: a.pct.toFixed(0) })
  return t('costcenter.anomaly.descBrand', { failures: a.failures, count: a.count })
}

function RankBadge({ rank }) {
  if (rank === 1) return <span className="inline-flex items-center gap-1 text-yellow-400 text-xs font-bold"><Award size={13} aria-hidden="true" /> #1</span>
  if (rank <= 3) return <span className="inline-flex items-center gap-1 text-[var(--text-secondary)] text-xs font-bold">#{rank}</span>
  return <span className="text-[var(--text-muted)] text-xs font-medium">#{rank}</span>
}

// ── Cost per unit (m3 / km / engine-hour) ────────────────────────────────────
const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])
const UNIT_RANGES = [
  { label: '3m', months: 3 },
  { label: '6m', months: 6 },
  { label: '1yr', months: 12 },
  { label: 'YTD', ytd: true },
  { label: 'All', all: true },
]

function isoDaysAgo(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}
function isoMonthsAgo(months) {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0, 10)
}
function todayIso() { return new Date().toISOString().slice(0, 10) }
function firstOfYearIso() { return `${new Date().getFullYear()}-01-01` }

function fmtPerUnit(value, currency, suffix) {
  if (value == null || !isFinite(value)) return null
  return `${currency} ${value.toFixed(4)}${suffix}`
}

/**
 * Sum meter movement (km or engine-hours) across a date range as the sum of
 * per-asset (max reading - min reading). Degrades to 0 when the table is
 * missing / errors, so a per-unit figure is never fabricated.
 */


/** How many production entries the list below asks the server for. */
const PROD_ROW_LIMIT = 200

function CostPerUnitSection({ currency, country, siteOptions = [] }) {
  const { profile, isSuperAdmin } = useAuth()
  const canWrite = isSuperAdmin === true || WRITE_ROLES.has(profile?.role)

  const [mode, setMode] = useState('combined')
  const [from, setFrom] = useState(firstOfYearIso())
  const [to, setTo] = useState(todayIso())
  const [rangeKey, setRangeKey] = useState('YTD')
  const [site, setSite] = useState('All')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState({ split: { tyre: 0, maintenance: 0 }, m3: 0, km: 0, hours: 0 })
  const [prodRows, setProdRows] = useState([])

  // m3 entry form.
  const [form, setForm] = useState({ site: '', period: new Date().toISOString().slice(0, 7), m3: '', source: '', notes: '' })
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const allSites = useMemo(() => {
    const set = new Set(siteOptions)
    for (const r of prodRows) if (r?.site) set.add(r.site)
    return [...set].sort((a, b) => String(a).localeCompare(String(b)))
  }, [siteOptions, prodRows])

  // The site picker reads the FULL set, and the m3 figure this panel divides by
  // comes from sumProductionM3 - a server sum over the whole window - so neither
  // depends on which rows the table below has on screen.
  const prodStats = useMemo(() => productionSummary(prodRows), [prodRows])
  // listProduction asks for at most PROD_ROW_LIMIT rows, so a full response is a
  // read that stopped at its own limit rather than at the end of the data. Say
  // so, or the pager's "of 200" reads as the total for the range.
  const prodAtLimit = prodRows.length >= PROD_ROW_LIMIT

  const latestUnitLoad = useLatestRequest()
  const load = useCallback(async () => {
    const stale = latestUnitLoad.begin()
    setLoading(true)
    setError('')
    try {
      const siteArg = site && site !== 'All' ? site : undefined
      const [split, m3, meters, rows] = await Promise.all([
        loadGovernedCostSplit({ country, from: from || undefined, to: to || undefined, site: siteArg }),
        sumProductionM3({ country, site: siteArg, from: from || undefined, to: to || undefined }),
        costCenter.getMeterDeltas({ country, site: siteArg, from, to }),
        listProduction({ country, site: siteArg, from: from || undefined, to: to || undefined, limit: PROD_ROW_LIMIT }),
      ])
      if (stale()) return
      setData({ split: { tyre: split.tyre, maintenance: split.maintenance }, m3, km: meters.odometer, hours: meters.engineHours })
      setProdRows(rows)
    } catch (e) {
      if (!stale()) setError(toUserMessage(e, 'Could not load unit cost data.'))
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [country, from, to, site, latestUnitLoad])

  useEffect(() => { load() }, [load])

  const ci = useMemo(
    () => buildCostIntelligence({ split: data.split, mode, km: data.km, hours: data.hours, m3: data.m3 }),
    [data, mode],
  )

  function applyRange(r) {
    setRangeKey(r.label)
    if (r.all) { setFrom(''); setTo('') }
    else if (r.ytd) { setFrom(firstOfYearIso()); setTo(todayIso()) }
    else { setFrom(isoMonthsAgo(r.months)); setTo(todayIso()) }
  }

  function resetForm() {
    setForm({ site: '', period: new Date().toISOString().slice(0, 7), m3: '', source: '', notes: '' })
    setEditingId(null)
    setFormError('')
  }

  async function submitProduction(e) {
    e.preventDefault()
    setFormError('')
    setSaving(true)
    try {
      const values = {
        site: form.site,
        period_date: form.period ? `${form.period}-01` : '',
        m3: form.m3,
        source: form.source,
        notes: form.notes,
        country: country && country !== 'All' ? country : null,
      }
      if (editingId) await updateProduction(editingId, values)
      else await createProduction(values)
      resetForm()
      await load()
    } catch (e2) {
      setFormError(toUserMessage(e2, 'Could not save the production entry.'))
    } finally {
      setSaving(false)
    }
  }

  // ── m3 bulk import (reuses the shared workbook parser + ERP mapper) ──────────
  const importRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState('')

  async function onImportM3(e) {
    const f = e.target.files?.[0]
    if (importRef.current) importRef.current.value = ''
    if (!f) return
    setFormError(''); setImportResult(''); setImporting(true)
    try {
      const wb = await parseWorkbook(await f.arrayBuffer(), { fileName: f.name })
      const wanted = new Set((DATASETS.production.tabAliases || []).map(normHeader))
      const sheet = wb.sheets.find((s) => wanted.has(normHeader(s.name))) || wb.sheets[0]
      if (!sheet) throw new Error('No sheet found in the file.')
      const rows = mapSheetToRows('production', sheet.rows || [])
        .filter((r) => r.site && r.period_date && r.m3 != null)
      if (rows.length === 0) throw new Error('No valid production rows found (need Site, Period, m3).')
      const kept = rows.slice(0, 20000)
      let saved = 0
      const failures = []
      for (const r of kept) {
        try {
          await createProduction({
            site: r.site, asset_no: r.asset_no, period_date: r.period_date,
            m3: r.m3, source: r.source || 'ERP import', notes: r.notes,
            country: country && country !== 'All' ? country : null,
          })
          saved += 1
        } catch (err) { failures.push(r.source_row) }
      }
      const capped = rows.length - kept.length
      setImportResult(
        `Imported ${saved} of ${rows.length} row(s)` +
        (capped > 0 ? `. ${capped} beyond the 20000 browser cap were skipped` : '') +
        (failures.length ? `. ${failures.length} row(s) failed` : '') + '.',
      )
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not import the production file.'))
    } finally {
      setImporting(false)
    }
  }

  function startEdit(row) {
    setEditingId(row.id)
    setFormError('')
    setForm({
      site: row.site || '',
      period: String(row.period_date || '').slice(0, 7) || new Date().toISOString().slice(0, 7),
      m3: row.m3 == null ? '' : String(row.m3),
      source: row.source || '',
      notes: row.notes || '',
    })
  }

  async function removeProduction(id) {
    if (!window.confirm('Delete this production entry?')) return
    try {
      await deleteProduction(id)
      if (editingId === id) resetForm()
      await load()
    } catch (e) {
      setFormError(toUserMessage(e, 'Could not delete the production entry.'))
    }
  }

  const prodColumns = [
    { id: 'site', header: 'Site', accessorFn: r => r.site || 'N/A', size: 150, meta: { filterVariant: 'select' } },
    { id: 'period', header: 'Period', accessorFn: r => String(r.period_date || '').slice(0, 7) || 'N/A', size: 110 },
    { id: 'm3', header: 'm3', accessorFn: r => (r.m3 == null ? null : Number(r.m3)), size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.m3 == null ? 'N/A' : Number(row.original.m3).toLocaleString()}</span> },
    { id: 'source', header: 'Source', accessorFn: r => r.source || 'N/A', size: 140 },
    ...(canWrite ? [{
      id: 'actions', header: 'Actions', size: 120, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => startEdit(row.original)} className={ICON_BTN} aria-label={`Edit production entry for ${row.original.site || 'site'}`} title="Edit">
            <Pencil size={14} />
          </button>
          <button type="button" onClick={() => removeProduction(row.original.id)} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete production entry for ${row.original.site || 'site'}`} title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      ),
    }] : []),
  ]

  const modeOptions = COST_MODES.map(m => ({ ...m, label: m.key === 'maintenance' ? 'General' : m.label }))
  const modeLabel = mode === 'maintenance' ? 'General' : costModeLabel(mode)

  const tiles = [
    {
      key: 'exp', icon: DollarSign, accent: colorAt(0),
      label: `Total expenses (${modeLabel})`,
      value: fmtCurrency(ci.expenses, currency),
      sub: from || to ? `${from || 'start'} to ${to || 'today'}` : 'All dates',
    },
    {
      key: 'm3', icon: Boxes, accent: colorAt(1),
      label: 'Cost per m3',
      value: fmtPerUnit(ci.perM3.value, currency, UNIT_META.m3.suffix) || 'N/A - no m3 recorded',
      sub: ci.perM3.value != null ? `over ${Math.round(ci.perM3.running).toLocaleString()} m3` : 'Log production below',
      na: ci.perM3.value == null,
    },
    {
      key: 'km', icon: Navigation, accent: colorAt(2),
      label: 'Cost per km',
      value: fmtPerUnit(ci.perKm.value, currency, UNIT_META.km.suffix) || 'N/A - no km recorded',
      sub: ci.perKm.value != null ? `over ${Math.round(ci.perKm.running).toLocaleString()} km` : 'From odometer logs',
      na: ci.perKm.value == null,
    },
    {
      key: 'hr', icon: Timer, accent: colorAt(3),
      label: 'Cost per engine-hour',
      value: fmtPerUnit(ci.perHour.value, currency, UNIT_META.engine_hours.suffix) || 'N/A - no engine hours',
      sub: ci.perHour.value != null ? `over ${Math.round(ci.perHour.running).toLocaleString()} hours` : 'From engine hour logs',
      na: ci.perHour.value == null,
    },
  ]

  return (
    <div className="rounded-xl border border-[var(--border-dim)] p-5 bg-[var(--surface-1)]">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-5">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Gauge size={15} className="text-[var(--accent)]" />
            Cost per unit (m3 / km / engine-hour)
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Unit-aware cost over a date range. m3 is location-wise production; km and engine hours come from meter logs. When a running unit has no data the tile falls back to total expenses only.
          </p>
        </div>
        <SegmentedControl ariaLabel="Unit cost view" value={mode} onChange={setMode}
          options={modeOptions.map(m => ({ value: m.key, label: m.label }))} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <SegmentedControl ariaLabel="Unit cost range" size="sm" value={rangeKey}
          onChange={(k) => { const r = UNIT_RANGES.find(x => x.label === k); if (r) applyRange(r) }}
          options={UNIT_RANGES.map(r => ({ value: r.label, label: r.label }))} />
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--text-muted)]" aria-hidden="true">From</span>
          <DateField className="text-sm w-40" value={from} onChange={v => { setFrom(v); setRangeKey('custom') }}
            placeholder="From date" ariaLabel="From date" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--text-muted)]" aria-hidden="true">To</span>
          <DateField className="text-sm w-40" value={to} onChange={v => { setTo(v); setRangeKey('custom') }}
            placeholder="To date" ariaLabel="To date" min={from || undefined} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cpu-site-filter" className="text-[11px] text-[var(--text-muted)]">Site</label>
          <select id="cpu-site-filter" value={site} onChange={e => setSite(e.target.value)}
            className="text-xs bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-primary)] rounded-lg px-2 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] min-w-[9rem]">
            <option value="All">All sites</option>
            {allSites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button type="button" onClick={load} disabled={loading} aria-label="Refresh unit costs" title="Refresh unit costs" className={ICON_BTN}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        </button>
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm">
          <AlertTriangle size={16} /><span className="flex-1 min-w-0">{error}</span>
          <button type="button" onClick={load} className={TEXT_BTN}><RefreshCw size={13} /> Retry</button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12 text-[var(--text-muted)] text-sm gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading unit costs
        </div>
      ) : (
        <>
          {/* Tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {tiles.map(tile => (
              <div key={tile.key} className="p-4 rounded-xl border"
                style={{ borderColor: withAlpha(tile.accent, 0.3), background: withAlpha(tile.accent, 0.06) }}>
                <div className="flex items-center gap-2 mb-2">
                  <tile.icon size={14} style={{ color: tile.accent }} />
                  <span className="text-[11px] text-[var(--text-muted)] font-medium">{tile.label}</span>
                </div>
                <p className={`text-lg font-bold leading-none tabular-nums ${tile.na ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                  {tile.value}
                </p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1.5">{tile.sub}</p>
              </div>
            ))}
          </div>

          {/* m3 entry */}
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="p-4 rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)]">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Boxes size={13} className="text-[var(--text-muted)]" />
                  {editingId ? 'Edit production (m3)' : 'Log production (m3)'}
                </h4>
                {canWrite && (
                  <label className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-[var(--surface-1)] border border-[var(--border-dim)] text-[var(--text-secondary)] text-[11px] hover:text-[var(--text-primary)] cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-[var(--accent)]" title="Import m3 from an Excel file (Site, Period, m3)">
                    <input ref={importRef} type="file" accept=".xlsx,.xls,.xlsm,.csv,.tsv" className="sr-only" onChange={onImportM3} disabled={importing} />
                    {importing ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />} Import m3
                  </label>
                )}
              </div>
              {importResult && (
                <div role="status" className="mb-2 flex items-center gap-2 p-2 rounded-lg bg-green-900/25 border border-green-800/50 text-green-300 text-[11px]">
                  <CheckCircle2 size={12} />{importResult}
                </div>
              )}
              {!canWrite ? (
                <p className="text-xs text-[var(--text-muted)]">Only Admin, Manager, or Director can record production output.</p>
              ) : (
                <form onSubmit={submitProduction} className="space-y-2.5">
                  {formError && (
                    <div role="alert" className="flex items-center gap-2 p-2 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-xs">
                      <AlertTriangle size={13} />{formError}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="cpu-form-site" className="text-[11px] text-[var(--text-muted)]">Site</label>
                      <input id="cpu-form-site" list="cpu-sites" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                        placeholder="Site name" required
                        className="text-xs bg-[var(--surface-1)] border border-[var(--border-dim)] text-[var(--text-primary)] rounded-lg px-2 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
                      <datalist id="cpu-sites">{allSites.map(s => <option key={s} value={s} />)}</datalist>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="cpu-form-period" className="text-[11px] text-[var(--text-muted)]">Period (month)</label>
                      <input id="cpu-form-period" type="month" value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} required
                        className="text-xs bg-[var(--surface-1)] border border-[var(--border-dim)] text-[var(--text-primary)] rounded-lg px-2 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="cpu-form-m3" className="text-[11px] text-[var(--text-muted)]">Production (m3)</label>
                      <input id="cpu-form-m3" type="number" step="any" min="0" value={form.m3} onChange={e => setForm(f => ({ ...f, m3: e.target.value }))}
                        placeholder="0" required
                        className="text-xs bg-[var(--surface-1)] border border-[var(--border-dim)] text-[var(--text-primary)] rounded-lg px-2 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="cpu-form-source" className="text-[11px] text-[var(--text-muted)]">Source (optional)</label>
                      <input id="cpu-form-source" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                        placeholder="e.g. batching log"
                        className="text-xs bg-[var(--surface-1)] border border-[var(--border-dim)] text-[var(--text-primary)] rounded-lg px-2 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="cpu-form-notes" className="text-[11px] text-[var(--text-muted)]">Notes (optional)</label>
                    <input id="cpu-form-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      className="text-xs bg-[var(--surface-1)] border border-[var(--border-dim)] text-[var(--text-primary)] rounded-lg px-2 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button type="submit" disabled={saving}
                      className="btn-primary inline-flex items-center gap-1.5 min-h-[44px] px-3 text-xs font-medium disabled:opacity-50">
                      {saving ? <Loader2 size={13} className="animate-spin" /> : editingId ? <Save size={13} /> : <Plus size={13} />}
                      {editingId ? 'Save changes' : 'Add production'}
                    </button>
                    {editingId && (
                      <button type="button" onClick={resetForm}
                        className={TEXT_BTN}>
                        <X size={13} /> Cancel
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>

            {/* Recent m3 list */}
            <div className="p-4 rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)]">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <h4 className="text-xs font-semibold text-[var(--text-primary)]">Recent production entries</h4>
                {prodRows.length > 0 && (
                  <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
                    {prodStats.entries.toLocaleString()} entries, {Math.round(prodStats.m3).toLocaleString()} m3 across {prodStats.sites} site{prodStats.sites === 1 ? '' : 's'} (loaded rows)
                  </span>
                )}
              </div>
              {prodRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <Boxes size={26} className="text-[var(--text-dim)]" />
                  <p className="text-[var(--text-muted)] text-xs">No m3 recorded for this range yet.</p>
                </div>
              ) : (
                <div>
                  {prodAtLimit && (
                    <p className="text-[11px] text-amber-400 mb-2">
                      This list asks for the {PROD_ROW_LIMIT} most recent entries in the range, so older ones are not in it.
                      Narrow the dates or the site to reach them. The m3 total above is a server sum over the whole range and is not limited.
                    </p>
                  )}
                  <EnterpriseTable
                    enableKeyboard={false}
                    columns={prodColumns}
                    data={prodRows}
                    getRowId={r => r.id}
                    initialPageSize={25}
                    emptyMessage="No m3 recorded for this range yet."
                    searchPlaceholder="Search site or source"
                    exportFileName={reportFileName('Production m3', from || 'start', 'to', to || 'today')}
                    reportMeta={{ title: 'Production entries (m3)', dateRange: `${from || 'start'} to ${to || 'today'}` }}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
