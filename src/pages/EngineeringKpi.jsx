import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import * as engKpiApi from '../lib/api/engineeringKpi'
import { fetchAllPages } from '../lib/fetchAll'
import { toUserMessage } from '../lib/safeError'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { loadGridTyreByAsset } from '../lib/api/costSummary'
import { loadGovernedCostSplit, COST_SPLIT_TTL_MS } from '../lib/api/governedCost'
import { COST_MODES } from '../lib/costSources'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { computeAllKpis } from '../lib/kpiEngine'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  presetRange, DATE_PRESETS, monthAxis, headlineMetrics, assetCpkRows, brandScorecardRows,
  gridCostTrend, costModeFigure, failureBySite, inspectionSeries, filterKpiCards, statusCounts,
  kpiExportRows, cpkStatus, lifeStatus, lowerIsBetterPctStatus, higherIsBetterPctStatus, STATUS_LABEL,
} from '../lib/engineeringKpiAnalytics'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  Cpu, Download, FileText, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle, XCircle, Info, Mail,
  Gauge, Search, X, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import ExplainThisNumber from '../components/trust/ExplainThisNumber'
import YearlyTrendPanel from '../components/expense/YearlyTrendPanel'
import SectionTabs, { KPI_TABS } from '../components/ui/SectionTabs'
import EmailReportModal from '../components/EmailReportModal'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
)

// Semantic band colours (the colour carries meaning, so it is not palettized).
const BAND = { good: '#22c55e', warning: '#eab308', critical: '#ef4444', neutral: '#94a3b8' }
const TOUCH = 'min-h-[44px]'

// ── Chart options (theme tokens are resolved per theme by chartVarPlugin) ─────
function chartOpts({ horizontal = false, yLabel = '', xLabel = '', suffix = '' } = {}) {
  const tick = { color: 'var(--text-muted)', font: { size: 10 } }
  const title = (text) => (text ? { display: true, text, color: 'var(--text-muted)', font: { size: 10 } } : { display: false })
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { labels: { color: 'var(--text-secondary)', font: { size: 10 } } },
      title: { display: false },
      tooltip: {
        backgroundColor: 'var(--panel)', titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)',
        borderColor: 'var(--hairline)', borderWidth: 1,
        callbacks: suffix ? { label: (ctx) => `${ctx.dataset.label}: ${ctx.formattedValue}${suffix}` } : undefined,
      },
    },
    scales: {
      x: { grid: { color: 'var(--panel-2)' }, ticks: tick, title: title(xLabel) },
      y: { grid: { color: 'var(--panel-2)' }, ticks: tick, title: title(yLabel) },
    },
  }
}

function statusClass(status) {
  if (status === 'good')     return 'border-green-700/50 bg-green-950/20'
  if (status === 'warning')  return 'border-yellow-700/50 bg-yellow-950/10'
  if (status === 'critical') return 'border-red-700/50 bg-red-950/20'
  return 'border-[var(--border-bright)] bg-[var(--surface-2)]'
}

function StatusIcon({ status, size = 14 }) {
  if (status === 'good')     return <CheckCircle size={size} className="text-green-400" aria-hidden="true" />
  if (status === 'warning')  return <AlertTriangle size={size} className="text-yellow-400" aria-hidden="true" />
  if (status === 'critical') return <XCircle size={size} className="text-red-400" aria-hidden="true" />
  return <Info size={size} className="text-[var(--text-muted)]" aria-hidden="true" />
}

// ── KPI Card (status is carried by icon + text, never colour alone) ───────────
function KpiCard({ title, value, subValue, description, status, trend, trendLabel }) {
  const trendColor = status === 'critical' ? 'text-red-400' : status === 'good' ? 'text-green-400' : 'text-[var(--text-muted)]'
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${statusClass(status)}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-[var(--text-secondary)] font-medium">{title}</span>
        <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] shrink-0">
          <StatusIcon status={status} size={13} />
          {STATUS_LABEL[status] || STATUS_LABEL.neutral}
        </span>
      </div>
      <div>
        <p className="text-lg font-bold text-[var(--text-primary)] leading-tight tabular-nums">{value}</p>
        {subValue && <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subValue}</p>}
      </div>
      {description && <p className="text-xs text-[var(--text-muted)] leading-snug">{description}</p>}
      {trendLabel && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trendColor}`}>
          {trend === 'up' ? <TrendingUp size={12} aria-hidden="true" /> : trend === 'down' ? <TrendingDown size={12} aria-hidden="true" /> : <Minus size={12} aria-hidden="true" />}
          {trendLabel}
        </div>
      )}
    </div>
  )
}

// ── Headline KPI Strip Card ───────────────────────────────────────────────────
function HeadlineCard({ title, value, sub, status, metricId, country }) {
  const valueColor = status === 'good' ? 'text-green-400'
    : status === 'warning' ? 'text-yellow-400'
    : status === 'critical' ? 'text-red-400'
    : 'text-[var(--text-primary)]'
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-1.5 ${statusClass(status)}`}>
      <div className="flex items-center justify-between gap-1">
        <p className="text-xs text-[var(--text-secondary)] font-medium">{title}</p>
        {metricId && <ExplainThisNumber metricId={metricId} country={country} value={value} label={title} />}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${valueColor}`}>{value}</p>
      <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
        <StatusIcon status={status} size={11} />
        <span>{sub || STATUS_LABEL[status]}</span>
      </p>
    </div>
  )
}

function ChartCard({ title, hint, empty, emptyText, children }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">{title}</h3>
        {hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>}
      </div>
      {empty ? (
        <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm text-center px-4">{emptyText}</div>
      ) : (
        <div style={{ height: 280 }}>{children}</div>
      )}
    </div>
  )
}

// ── Helpers for N/A display ───────────────────────────────────────────────────
// A KPI with no measurable input is legitimately null (e.g. pressure compliance
// with no recorded PSI). Dereferencing it threw `null.toFixed` and took the whole
// page down behind the error boundary, so null/non-finite reads N/A. Any real
// number, 0 included, formats exactly as it did before.
function fmtPct(v) {
  if (!isMeasured(v)) return 'N/A'
  return `${Number(v).toFixed(1)}%`
}

function isMeasured(v) {
  return v != null && Number.isFinite(Number(v))
}

function fmtKm(v) {
  return isMeasured(v) ? `${Math.round(v).toLocaleString()} km` : 'N/A'
}

function fmtMoney(v, currency) {
  return isMeasured(v) ? `${currency} ${Math.round(v).toLocaleString()}` : 'N/A'
}

// Null-last sort for EnterpriseTable, sharing compareValues with the console lists.
function sortNullLast(rowA, rowB, id) {
  const a = rowA.getValue(id)
  const b = rowB.getValue(id)
  const ba = a == null || a === ''
  const bb = b == null || b === ''
  if (ba && bb) return 0
  if (ba) return 1
  if (bb) return -1
  return compareValues(a, b)
}

function BandText({ value, band, children }) {
  const cls = band === 'good' ? 'text-green-400' : band === 'warning' ? 'text-yellow-400' : band === 'critical' ? 'text-red-400' : 'text-[var(--text-muted)]'
  if (!isMeasured(value)) return <span className="text-[var(--text-muted)]">N/A</span>
  return <span className={`tabular-nums font-medium ${cls}`}>{children}</span>
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function EngineeringKpi() {
  const { activeCountry, activeCurrency } = useSettings()

  // Filter state
  const [countryChip, setCountryChip] = useState('All')
  const [siteFilter,  setSiteFilter]  = useState('')
  // Every site the loaded rows cover, built BEFORE the site filter narrows them.
  const [siteOptions, setSiteOptions] = useState([])
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [cardQuery,   setCardQuery]   = useState('')
  const [cardStatus,  setCardStatus]  = useState('all')

  // Data state
  const [records,     setRecords]     = useState([])
  const [inspections, setInspections] = useState([])
  const [actions,     setActions]     = useState([])
  const [fleetSize,   setFleetSize]   = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [truncated,   setTruncated]   = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [exportError, setExportError] = useState('')

  // Tyres vs General(Maintenance) vs Combined cost switch, read from the governed
  // expense grid (never a cost_per_tyre sum).
  const [costMode, setCostMode] = useState('tyres')
  const [costSplit, setCostSplit] = useState(null)
  const [costSplitLoading, setCostSplitLoading] = useState(true)
  const [costSplitError, setCostSplitError] = useState(false)
  // Authoritative per-asset tyre cost from the expense grid (V347 RPC). Null when
  // the grid is unavailable for this scope; the asset table then reads N/A.
  const [gridByAsset, setGridByAsset] = useState(null)

  // Fleet CPK (cost per km / hour) lives in its own module at /cpk-intelligence.
  const effectiveCountry = countryChip !== 'All' ? countryChip : (activeCountry !== 'All' ? activeCountry : undefined)

  const loadCost = useCallback(() => {
    let cancelled = false
    setCostSplitLoading(true)
    setCostSplitError(false)
    loadGovernedCostSplit({
      country: effectiveCountry,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      site: siteFilter || undefined,
      maxAgeMs: COST_SPLIT_TTL_MS,
    })
      .then(res => { if (!cancelled) setCostSplit(res) })
      .catch(() => { if (!cancelled) { setCostSplit(null); setCostSplitError(true) } })
      .finally(() => { if (!cancelled) setCostSplitLoading(false) })
    return () => { cancelled = true }
  }, [effectiveCountry, dateFrom, dateTo, siteFilter])

  useEffect(() => loadCost(), [loadCost])

  useEffect(() => {
    let cancelled = false
    loadGridTyreByAsset({
      country: effectiveCountry,
      from: dateFrom || undefined,
      to: dateTo || undefined,
    })
      .then(res => { if (!cancelled) setGridByAsset(res) })
      .catch(() => { if (!cancelled) setGridByAsset(null) })
    return () => { cancelled = true }
  }, [effectiveCountry, dateFrom, dateTo])

  const costFigure = useMemo(() => costModeFigure(costSplit, costMode), [costSplit, costMode])
  const costTrend = useMemo(() => gridCostTrend(costSplit, 'tyres'), [costSplit])
  const costModeOptions = COST_MODES.map(m => ({ ...m, label: m.key === 'maintenance' ? 'General' : m.label }))

  function applyPreset(preset) {
    const { from, to } = presetRange(preset, new Date())
    setDateFrom(from)
    setDateTo(to)
  }

  function clearFilters() {
    setDateFrom(''); setDateTo(''); setSiteFilter(''); setCountryChip('All')
  }

  // Guards against a slow earlier response overwriting a newer one after the
  // country/site/date filters change (fetch-race cancellation).
  const reqIdRef = useRef(0)

  const loadData = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const country = countryChip !== 'All' ? countryChip : (activeCountry !== 'All' ? activeCountry : null)

      const [recRes, insRes, actRes, fleetRes] = await Promise.all([
        fetchAllPages((from, to) =>
          engKpiApi.listKpiTyreRecords({ country, dateFrom, dateTo, from, to })
        , { max: 200000 }),
        // Site and the date window reach these three too, so pressure compliance,
        // inspection compliance, workshop performance and fleet availability
        // describe the same population as the tyre KPIs beside them.
        fetchAllPages((from, to) =>
          engKpiApi.listKpiInspections({ country, site: siteFilter || undefined, dateFrom, dateTo, from, to })
        , { max: 200000 }),
        fetchAllPages((from, to) =>
          engKpiApi.listKpiCorrectiveActions({ country, site: siteFilter || undefined, dateFrom, dateTo, from, to })
        , { max: 200000 }),
        fetchAllPages((from, to) =>
          engKpiApi.listKpiFleet({ country, site: siteFilter || undefined, from, to })
        , { max: 200000 }),
      ])

      if (myReq !== reqIdRef.current) return
      if (recRes.error)  throw recRes.error
      if (insRes.error)  throw insRes.error
      if (actRes.error)  throw actRes.error
      if (fleetRes.error) throw fleetRes.error

      const allRecs = recRes.data || []
      // The site list is built from the UNFILTERED rows so a chosen site never
      // collapses the dropdown to itself.
      setSiteOptions([...new Set(allRecs.map(r => r.site).filter(Boolean))].sort())
      const recs = siteFilter ? allRecs.filter(r => r.site === siteFilter) : allRecs

      setRecords(recs)
      setInspections(insRes.data || [])
      setActions(actRes.data || [])
      setFleetSize((fleetRes.data || []).length)
      setTruncated(Boolean(recRes.truncated || insRes.truncated || actRes.truncated || fleetRes.truncated))
    } catch (err) {
      if (myReq === reqIdRef.current) setError(toUserMessage(err, 'Could not load engineering KPIs.'))
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [countryChip, activeCountry, siteFilter, dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  // All 17 KPIs from the single engine.
  const kpis = useMemo(() => {
    if (!records.length) return null
    return computeAllKpis(records, inspections, actions, fleetSize)
  }, [records, inspections, actions, fleetSize])

  const head = useMemo(() => headlineMetrics(kpis, { inspectionsLoaded: inspections.length }), [kpis, inspections.length])

  const assetRows = useMemo(() => assetCpkRows(kpis, records, gridByAsset?.map ?? null), [kpis, records, gridByAsset])
  const brandRows = useMemo(() => brandScorecardRows(kpis, records), [kpis, records])

  // Brand CPK chart (top 10 by best CPK)
  const cpkBrandChart = useMemo(() => {
    if (!kpis?.cpkByBrand?.length) return null
    const top = kpis.cpkByBrand.filter(b => isMeasured(b.avgCpk)).slice(0, 10)
    if (!top.length) return null
    return {
      labels: top.map(b => `${b.brand} (n=${b.count})`),
      datasets: [{
        label: `Avg CPK (${activeCurrency}/km)`,
        data: top.map(b => Number(b.avgCpk.toFixed(4))),
        backgroundColor: top.map(b => withAlpha(BAND[cpkStatus(b.avgCpk)], 0.7)),
        borderColor: top.map(b => BAND[cpkStatus(b.avgCpk)]),
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [kpis, activeCurrency])

  // Monthly tyre spend from the governed expense grid, with a fitted trend line.
  const costTrendChart = useMemo(() => {
    if (!costTrend?.series?.length) return null
    const lineColor = colorAt(0)
    const datasets = [{
      label: `Tyre spend (${costTrend.currency || activeCurrency})`,
      data: costTrend.series.map(s => s.value),
      borderColor: lineColor,
      backgroundColor: withAlpha(lineColor, 0.1),
      fill: true, tension: 0.35, pointRadius: 3,
    }]
    if (costTrend.fitted) {
      datasets.push({
        label: 'Trend line',
        data: costTrend.fitted,
        borderColor: withAlpha(colorAt(1), 0.7),
        borderDash: [5, 3], fill: false, pointRadius: 0, tension: 0,
      })
    }
    return { labels: costTrend.series.map(s => s.month), datasets }
  }, [costTrend, activeCurrency])

  const failureSites = useMemo(() => failureBySite(kpis, 12), [kpis])
  const failureBySiteChart = useMemo(() => {
    if (!failureSites.length) return null
    return {
      labels: failureSites.map(s => s.site),
      datasets: [{
        label: 'Failure rate % (rated tyres)',
        data: failureSites.map(s => Number(s.pct.toFixed(1))),
        backgroundColor: failureSites.map(s => withAlpha(BAND[lowerIsBetterPctStatus(s.pct, 15, 30)], 0.75)),
        borderColor: failureSites.map(s => BAND[lowerIsBetterPctStatus(s.pct, 15, 30)]),
        borderWidth: 1, borderRadius: 3,
      }],
    }
  }, [failureSites])

  const inspCompChart = useMemo(() => {
    if (!kpis || !inspections.length) return null
    const axis = monthAxis(12, new Date())
    const data = inspectionSeries(kpis, axis)
    if (!data.some(v => v != null)) return null
    const lineColor = colorAt(2)
    return {
      labels: axis,
      datasets: [
        {
          label: 'Compliance %',
          data,
          borderColor: lineColor,
          backgroundColor: withAlpha(lineColor, 0.08),
          fill: true, tension: 0.35, spanGaps: true, pointRadius: 3,
        },
        {
          label: 'Target 85%',
          data: axis.map(() => 85),
          borderColor: withAlpha(BAND.good, 0.6),
          borderDash: [6, 3], fill: false, pointRadius: 0,
        },
      ],
    }
  }, [kpis, inspections.length])

  // ── 17 KPI card definitions ─────────────────────────────────────────────────
  const kpiCards = useMemo(() => {
    if (!kpis || !head) return []
    const {
      cpk, avgTyreLife, fleetTyreLife, removalRate, failureRate, replacementRate,
      pressureCompliance, inspectionCompliance, retreadPerformance, scrapRate,
      downtimeImpact, workshopPerformance,
    } = kpis
    const currency = activeCurrency
    const cpkMeasured = head.cpk != null

    // Failure rate: null means no tyre was rated; `null * 100` would be 0 and
    // flatter an unmeasured metric to "0.0% good".
    const failPct = head.failurePct
    const failStatus = lowerIsBetterPctStatus(failPct, 15, 30)

    // Pressure compliance: null means nothing was measurable; `null > 60` is
    // false, which would paint an unmeasured metric critical.
    const pressPct = pressureCompliance.compliancePct
    const pressMeasured = pressPct != null
    const pressStatus = pressMeasured ? higherIsBetterPctStatus(pressPct, 85, 60) : 'neutral'

    const inspPct = head.inspectionPct
    const scrapPct = head.scrapPct
    const availPct = head.availabilityPct

    const topVendor    = brandRows[0]
    const bottomVendor = brandRows[brandRows.length - 1]
    const bestSite  = workshopPerformance.bySite[0]
    const worstSite = workshopPerformance.bySite[workshopPerformance.bySite.length - 1]
    const siteFailPct = (site) => {
      const rate = failureRate.bySite.find(s => s.site === site)?.rate
      return rate == null ? null : rate * 100
    }
    const siteFail = (site) => fmtPct(siteFailPct(site))

    const trendKey = costTrend?.trend
    return [
      {
        title: 'CPK Fleet Average',
        value: cpkMeasured ? `${currency} ${head.cpk.toFixed(4)}/km` : 'N/A (no km data)',
        subValue: `Coverage: ${cpk.validCount} of ${cpk.totalCount} records (${cpk.coveragePct.toFixed(0)}%)`,
        description: `Median CPK: ${cpkMeasured && isMeasured(cpk.medianCpk) ? `${currency} ${cpk.medianCpk.toFixed(4)}/km` : 'N/A'}`,
        status: cpkStatus(head.cpk),
        trend: cpkMeasured ? (head.cpk < 1.5 ? 'down' : 'up') : null,
        trendLabel: cpkMeasured ? (head.cpk < 1.5 ? 'Optimal range' : 'Above target') : null,
      },
      {
        title: 'Cost Per Mile',
        value: cpkMeasured ? `${currency} ${(head.cpk * 1.60934).toFixed(4)}/mile` : 'N/A (no km data)',
        subValue: 'Derived from CPK x 1.609',
        description: cpkMeasured && isMeasured(cpk.p10Cpk)
          ? `P10: ${currency} ${(cpk.p10Cpk * 1.60934).toFixed(4)}, P90: ${currency} ${(cpk.p90Cpk * 1.60934).toFixed(4)}`
          : 'Upload km at fitment and km at removal',
        status: cpkStatus(head.cpk),
      },
      {
        title: 'Average Tyre Life',
        value: fmtKm(head.avgLifeKm),
        subValue: head.avgLifeKm != null ? `Median: ${fmtKm(avgTyreLife.medianKm)}` : '',
        description: head.avgLifeKm != null ? `Based on ${avgTyreLife.validCount} records with km data` : 'Requires km at fitment and km at removal',
        status: lifeStatus(head.avgLifeKm),
        trend: head.avgLifeKm != null ? (head.avgLifeKm > 40000 ? 'up' : 'down') : null,
        trendLabel: head.avgLifeKm != null ? (head.avgLifeKm > 40000 ? 'Above fleet target' : 'Below 40k km target') : null,
      },
      {
        title: 'Fleet Avg Tyre Life',
        value: head.avgLifeKm != null ? fmtKm(fleetTyreLife.avgKm) : 'N/A (no km data)',
        subValue: fleetTyreLife.trend.length > 0 ? `${fleetTyreLife.trend.length} monthly data points` : 'Insufficient time data',
        description: avgTyreLife.byBrand[0]
          ? `Best brand: ${avgTyreLife.byBrand[0].brand} (${fmtKm(avgTyreLife.byBrand[0].avgKm)})`
          : 'No brand breakdown available',
        status: lifeStatus(head.avgLifeKm),
      },
      {
        title: 'Tyre Removal Rate',
        value: removalRate.estimatedFleetKm > 0 ? `${removalRate.removalPer1000Km.toFixed(2)} per 1,000 km` : 'N/A (no km data)',
        subValue: `Total removals: ${removalRate.totalRemovals.toLocaleString()}`,
        description: removalRate.estimatedFleetKm > 0
          ? `Fleet km base: ${Math.round(removalRate.estimatedFleetKm).toLocaleString()} km`
          : 'Upload km data to compute removal rate',
        status: removalRate.estimatedFleetKm > 0
          ? (removalRate.removalPer1000Km < 0.05 ? 'good' : removalRate.removalPer1000Km < 0.15 ? 'warning' : 'critical')
          : 'neutral',
      },
      {
        title: 'Tyre Failure Rate',
        value: fmtPct(failPct),
        subValue: failPct != null
          ? `${failureRate.failureCount} failures of ${failureRate.ratedCount} rated`
          : `No tyres rated of ${failureRate.totalCount} total`,
        description: failPct != null
          ? `Critical: ${fmtPct(failureRate.criticalRate * 100)} | High: ${fmtPct(failureRate.highRate * 100)}`
          : 'Not measured (no risk level recorded)',
        status: failStatus,
        trend: failPct != null ? (failPct > 20 ? 'up' : 'down') : null,
        trendLabel: failPct == null ? 'Not measured' : failPct > 20 ? 'Exceeds 20% threshold' : 'Within acceptable range',
      },
      {
        title: 'Tyre Replacement Rate',
        value: replacementRate.activeVehicles > 0 ? `${replacementRate.avgPerVehiclePerMonth.toFixed(2)} per vehicle/month` : 'N/A',
        subValue: `${replacementRate.totalReplacements} total over ${replacementRate.activeVehicles} vehicles`,
        description: `Monthly data: ${replacementRate.byMonth.length} months observed`,
        status: replacementRate.activeVehicles === 0 ? 'neutral'
          : replacementRate.avgPerVehiclePerMonth < 0.5 ? 'good'
          : replacementRate.avgPerVehiclePerMonth < 1.5 ? 'warning' : 'critical',
      },
      {
        title: 'Pressure Compliance %',
        value: inspections.length === 0 ? 'N/A (no inspections)' : fmtPct(pressPct),
        subValue: pressMeasured
          ? `${pressureCompliance.compliantCount} of ${pressureCompliance.totalCount} readings within tolerance`
          : 'No pressure readings recorded',
        description: pressureCompliance.basis,
        status: inspections.length === 0 ? 'neutral' : pressStatus,
        trend: pressMeasured ? (pressPct > 85 ? 'up' : 'down') : null,
        trendLabel: pressMeasured ? (pressPct > 85 ? 'Target achieved' : 'Below 85% target') : null,
      },
      {
        title: 'Inspection Compliance %',
        value: inspPct == null ? (inspections.length === 0 ? 'N/A (no inspections)' : 'N/A (none scheduled)') : fmtPct(inspPct),
        subValue: `On-time: ${inspectionCompliance.onTimeCount} of ${inspectionCompliance.totalScheduled} scheduled`,
        description: `Overdue: ${inspectionCompliance.overdueCount} | Late: ${inspectionCompliance.lateCount}`,
        status: higherIsBetterPctStatus(inspPct, 85, 60),
        trend: inspPct != null ? (inspPct > 85 ? 'up' : 'down') : null,
        trendLabel: inspPct == null ? null : inspPct > 85 ? 'Target achieved' : `${(85 - inspPct).toFixed(1)}% gap to 85% target`,
      },
      {
        title: 'Retread Performance',
        value: retreadPerformance === null
          ? 'N/A (insufficient data)'
          : retreadPerformance.savingsPct > 0
            ? `${retreadPerformance.savingsPct.toFixed(1)}% cheaper`
            : `${Math.abs(retreadPerformance.savingsPct).toFixed(1)}% more expensive`,
        subValue: retreadPerformance
          ? `Retread CPK: ${currency} ${retreadPerformance.retreadCpk.toFixed(4)} | New: ${currency} ${retreadPerformance.newCpk.toFixed(4)}`
          : 'Need retread records with km data',
        description: retreadPerformance
          ? `${retreadPerformance.retreadCount} retreads vs ${retreadPerformance.newCount} new tyres`
          : 'Tag records with category "Retread" to enable',
        status: retreadPerformance === null ? 'neutral'
          : retreadPerformance.savingsPct > 10 ? 'good'
          : retreadPerformance.savingsPct > 0 ? 'warning' : 'critical',
      },
      {
        title: 'Scrap Rate',
        value: fmtPct(scrapPct),
        subValue: `${scrapRate.scrapCount} scrapped of ${scrapRate.totalCount} total`,
        description: 'Scrap spend is reported from the expense grid in Scrap Management, not summed from tyre prices here.',
        status: lowerIsBetterPctStatus(scrapPct, 10, 20),
        trend: scrapPct != null ? (scrapPct > 15 ? 'up' : 'down') : null,
        trendLabel: scrapPct == null ? null : scrapPct > 15 ? 'High scrap, investigate early removal' : 'Scrap within normal range',
      },
      {
        title: 'Fleet Availability Impact',
        value: availPct == null ? 'N/A (no risk ratings)' : fmtPct(availPct),
        subValue: availPct == null
          ? 'Availability is derived from Critical tyre ratings, and none are recorded'
          : `${head.unavailableCount} vehicles critical (last 30 days)`,
        description: `Fleet size: ${kpis.fleetAvailability.fleetSize} vehicles`,
        status: higherIsBetterPctStatus(availPct, 90, 75),
      },
      {
        title: 'Vehicle Downtime Impact',
        value: `${downtimeImpact.totalDowntimeHours.toLocaleString()} hrs estimated`,
        subValue: `Avg ${downtimeImpact.avgDowntimePerVehicle.toFixed(1)} hrs/vehicle`,
        description: 'Estimate: tyre replacements x 2 hrs industry average',
        status: downtimeImpact.totalDowntimeHours > 500 ? 'critical' : downtimeImpact.totalDowntimeHours > 100 ? 'warning' : 'good',
      },
      {
        title: 'Tyre Spend Trend (expense grid)',
        value: !costTrend ? (costFigure.blended ? 'N/A (mixed currencies)' : 'N/A (no grid data)')
          : trendKey === 'improving' ? 'Improving'
          : trendKey === 'worsening' ? 'Worsening'
          : trendKey === 'stable' ? 'Stable' : 'Not enough months',
        subValue: costTrend?.slope != null
          ? `Slope: ${costTrend.slope > 0 ? '+' : '-'}${costTrend.currency || currency} ${Math.round(Math.abs(costTrend.slope)).toLocaleString()}/month`
          : 'Pick one country for a single-currency trend',
        description: costTrend
          ? `Forecast next month: ${fmtMoney(costTrend.forecastNextMonth, costTrend.currency || currency)} | Avg monthly: ${fmtMoney(costTrend.avgMonthly, costTrend.currency || currency)}`
          : '',
        status: !costTrend || trendKey === 'insufficient' ? 'neutral'
          : trendKey === 'improving' ? 'good' : trendKey === 'stable' ? 'neutral' : 'warning',
        trend: trendKey === 'improving' ? 'down' : trendKey === 'worsening' ? 'up' : null,
        trendLabel: trendKey === 'improving' ? 'Spend declining' : trendKey === 'worsening' ? 'Spend increasing, action needed' : null,
      },
      {
        title: 'Vendor Performance',
        value: topVendor ? `Top: ${topVendor.brand}` : 'N/A (no brands)',
        subValue: topVendor && topVendor.avgCpk != null
          ? `CPK: ${currency} ${topVendor.avgCpk.toFixed(4)}/km, Score: ${topVendor.score?.toFixed(2) ?? 'N/A'}`
          : topVendor ? 'No CPK data for top brand' : 'Upload km data for vendor ranking',
        description: bottomVendor && topVendor && bottomVendor.brand !== topVendor.brand
          ? `Lowest ranked: ${bottomVendor.brand} (CPK: ${bottomVendor.avgCpk != null ? `${currency} ${bottomVendor.avgCpk.toFixed(4)}` : 'N/A'})`
          : brandRows.length > 0 ? `${brandRows.length} brands ranked` : '',
        status: topVendor ? cpkStatus(topVendor.avgCpk) : 'neutral',
      },
      {
        title: 'Workshop Performance',
        value: bestSite ? `Best: ${bestSite.site}` : 'N/A (no site data)',
        subValue: bestSite ? `Score: ${bestSite.score.toFixed(2)} | Failure: ${siteFail(bestSite.site)}` : '',
        description: worstSite && bestSite && worstSite.site !== bestSite.site
          ? `Lowest: ${worstSite.site} (Score: ${worstSite.score.toFixed(2)} | Failure: ${siteFail(worstSite.site)})`
          : workshopPerformance.bySite.length > 0 ? `${workshopPerformance.bySite.length} sites evaluated` : '',
        status: bestSite ? lowerIsBetterPctStatus(siteFailPct(bestSite.site), 15, 30) : 'neutral',
      },
      {
        title: 'Fleet CPK Coverage',
        value: cpk.totalCount > 0 ? `${cpk.coveragePct.toFixed(1)}% of records` : 'N/A',
        subValue: `${cpk.validCount} valid | ${cpk.totalCount - cpk.validCount} missing km or price`,
        description: cpk.coveragePct < 50
          ? 'Low coverage: CPK metrics unreliable. Upload km at fitment and km at removal.'
          : cpk.coveragePct < 80
            ? 'Moderate coverage: some CPK calculations may be skewed'
            : 'Good coverage: CPK metrics are reliable',
        status: cpk.coveragePct > 80 ? 'good' : cpk.coveragePct > 50 ? 'warning' : 'critical',
      },
    ].map((c, i) => ({ ...c, title: `${String(i + 1).padStart(2, '0')}. ${c.title}` }))
  }, [kpis, head, activeCurrency, inspections.length, brandRows, costTrend, costFigure.blended])

  const counts = useMemo(() => statusCounts(kpiCards), [kpiCards])
  const visibleCards = useMemo(() => filterKpiCards(kpiCards, { query: cardQuery, status: cardStatus }), [kpiCards, cardQuery, cardStatus])

  // ── Export handlers ─────────────────────────────────────────────────────────
  const scopeLabel = [
    countryChip !== 'All' ? countryChip : (activeCountry !== 'All' ? activeCountry : 'All countries'),
    siteFilter || null,
    dateFrom || dateTo ? `${dateFrom || 'start'} to ${dateTo || 'today'}` : null,
  ].filter(Boolean).join(' ')

  async function handleExcelExport() {
    if (!kpiCards.length) return
    setExportError('')
    try {
      await exportToExcel(
        kpiExportRows(kpiCards),
        ['no', 'kpi', 'value', 'status', 'detail'],
        ['#', 'KPI', 'Value', 'Status', 'Basis'],
        reportFileName('TyrePulse Engineering KPIs', scopeLabel),
        'KPI Summary',
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  async function handlePdfExport() {
    if (!kpiCards.length) return
    setExportError('')
    try {
      await exportToPdf(
        kpiExportRows(kpiCards),
        [
          { key: 'no', header: '#' },
          { key: 'kpi', header: 'KPI' },
          { key: 'value', header: 'Value' },
          { key: 'status', header: 'Status' },
          { key: 'detail', header: 'Basis' },
        ],
        `Engineering KPI Dashboard: ${scopeLabel}`,
        reportFileName('TyrePulse Engineering KPIs', scopeLabel),
        'landscape',
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── Tables ──────────────────────────────────────────────────────────────────
  const assetColumns = useMemo(() => [
    { id: 'rank', header: '#', accessorFn: r => r.rank, size: 56, sortingFn: sortNullLast, meta: { align: 'right' } },
    { id: 'assetNo', header: 'Asset No', accessorFn: r => r.assetNo, size: 130, sortingFn: sortNullLast,
      cell: ({ row }) => <span className="font-mono text-[var(--text-primary)]">{row.original.assetNo}</span> },
    { id: 'cpk', header: `CPK (${activeCurrency}/km)`, accessorFn: r => r.cpk ?? undefined, sortUndefined: 'last', size: 130, meta: { align: 'right', exportValue: r => r.cpk == null ? 'N/A' : r.cpk.toFixed(4) },
      cell: ({ row }) => <BandText value={row.original.cpk} band={row.original.cpkBand}>{row.original.cpk?.toFixed(4)}</BandText> },
    { id: 'avgLifeKm', header: 'Avg Life', accessorFn: r => r.avgLifeKm ?? undefined, sortUndefined: 'last', size: 120, meta: { align: 'right', exportValue: r => fmtKm(r.avgLifeKm) },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)]">{fmtKm(row.original.avgLifeKm)}</span> },
    { id: 'totalCost', header: `Tyre spend (grid, ${activeCurrency})`, accessorFn: r => r.totalCost ?? undefined, sortUndefined: 'last', size: 170, meta: { align: 'right', exportValue: r => r.totalCost == null ? 'N/A' : Math.round(r.totalCost) },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)]">{row.original.totalCost == null ? 'Not in grid' : Math.round(row.original.totalCost).toLocaleString()}</span> },
    { id: 'failurePct', header: 'Fail % (rated)', accessorFn: r => r.failurePct ?? undefined, sortUndefined: 'last', size: 120, meta: { align: 'right', exportValue: r => fmtPct(r.failurePct) },
      cell: ({ row }) => <BandText value={row.original.failurePct} band={lowerIsBetterPctStatus(row.original.failurePct, 15, 30)}>{fmtPct(row.original.failurePct)}</BandText> },
    { id: 'records', header: 'Records', accessorFn: r => r.records, size: 90, meta: { align: 'right' } },
  ], [activeCurrency])

  const brandColumns = useMemo(() => [
    { id: 'rank', header: '#', accessorFn: r => r.rank, size: 56, meta: { align: 'right' } },
    { id: 'brand', header: 'Brand', accessorFn: r => r.brand, size: 150, sortingFn: sortNullLast,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.brand}</span> },
    { id: 'avgCpk', header: `Avg CPK (${activeCurrency}/km)`, accessorFn: r => r.avgCpk ?? undefined, sortUndefined: 'last', size: 140, meta: { align: 'right', exportValue: r => r.avgCpk == null ? 'N/A' : r.avgCpk.toFixed(4) },
      cell: ({ row }) => <BandText value={row.original.avgCpk} band={cpkStatus(row.original.avgCpk)}>{row.original.avgCpk?.toFixed(4)}</BandText> },
    { id: 'failurePct', header: 'Fail % (rated)', accessorFn: r => r.failurePct ?? undefined, sortUndefined: 'last', size: 120, meta: { align: 'right', exportValue: r => fmtPct(r.failurePct) },
      cell: ({ row }) => <BandText value={row.original.failurePct} band={lowerIsBetterPctStatus(row.original.failurePct, 15, 30)}>{fmtPct(row.original.failurePct)}</BandText> },
    { id: 'avgLifeKm', header: 'Avg Life', accessorFn: r => r.avgLifeKm ?? undefined, sortUndefined: 'last', size: 120, meta: { align: 'right', exportValue: r => fmtKm(r.avgLifeKm) },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)]">{fmtKm(row.original.avgLifeKm)}</span> },
    { id: 'scrapPct', header: 'Scrap %', accessorFn: r => r.scrapPct ?? undefined, sortUndefined: 'last', size: 100, meta: { align: 'right', exportValue: r => fmtPct(r.scrapPct) },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)]">{fmtPct(row.original.scrapPct)}</span> },
    { id: 'score', header: 'Score', accessorFn: r => r.score ?? undefined, sortUndefined: 'last', size: 110, meta: { align: 'right', exportValue: r => r.score == null ? 'N/A' : r.score.toFixed(2) },
      cell: ({ row }) => {
        const r = row.original
        const tier = r.tier === 'top' ? 'Top 30%' : r.tier === 'bottom' ? 'Bottom 30%' : ''
        const cls = r.tier === 'top' ? 'text-green-400' : r.tier === 'bottom' ? 'text-red-400' : 'text-[var(--text-primary)]'
        return (
          <span className={`tabular-nums font-semibold ${cls}`}>
            {r.score == null ? 'N/A' : r.score.toFixed(2)}
            {tier && <span className="sr-only"> ({tier})</span>}
          </span>
        )
      } },
    { id: 'count', header: 'Records', accessorFn: r => r.count, size: 90, meta: { align: 'right' } },
  ], [activeCurrency])

  const filtersActive = Boolean(dateFrom || dateTo || siteFilter || countryChip !== 'All')

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <SectionTabs tabs={KPI_TABS} />

      <PageHeader
        title="Engineering KPI Dashboard"
        subtitle={`17 tyre engineering KPIs computed from fleet data${records.length > 0 ? `, ${records.length.toLocaleString()} records in scope` : ''}`}
        icon={Cpu}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              aria-label="Refresh engineering KPIs"
              className={`btn-secondary flex items-center justify-center px-3 ${TOUCH} disabled:opacity-40`}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" onClick={handleExcelExport} disabled={!kpiCards.length}
              className={`btn-secondary flex items-center gap-1.5 text-sm px-3 ${TOUCH} disabled:opacity-40`}>
              <Download size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={handlePdfExport} disabled={!kpiCards.length}
              className={`btn-secondary flex items-center gap-1.5 text-sm px-3 ${TOUCH} disabled:opacity-40`}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={() => setEmailModalOpen(true)} disabled={!kpis}
              className={`btn-primary flex items-center gap-2 text-sm px-4 ${TOUCH} disabled:opacity-40`}>
              <Mail size={16} aria-hidden="true" /> Email Report
            </button>
          </div>
        }
      />

      {exportError && <p role="alert" className="text-sm text-red-400">{exportError}</p>}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <section aria-label="Filters" className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Country">
          <span className="text-xs text-[var(--text-muted)] w-14 shrink-0">Country</span>
          {['All', ...COUNTRIES].map(c => (
            <button
              key={c}
              type="button"
              aria-pressed={countryChip === c}
              onClick={() => setCountryChip(c)}
              className={`px-3 ${TOUCH} rounded-full text-xs font-medium border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                countryChip === c
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)] hover:border-[var(--text-muted)]'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="ekpi-site" className="label text-xs">Site</label>
            <select id="ekpi-site" className={`input text-sm lg:w-48 ${TOUCH}`} value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
              <option value="">All sites</option>
              {siteOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="label text-xs">From</span>
            <DateField className="text-sm lg:w-40" value={dateFrom} onChange={setDateFrom} placeholder="From date" ariaLabel="From date" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="label text-xs">To</span>
            <DateField className="text-sm lg:w-40" value={dateTo} onChange={setDateTo} placeholder="To date" ariaLabel="To date" min={dateFrom || undefined} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2 lg:col-span-1" role="group" aria-label="Date presets">
            {DATE_PRESETS.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => applyPreset(key)}
                className={`px-3 ${TOUCH} text-xs rounded-lg border border-[var(--border-bright)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors`}>
                {label}
              </button>
            ))}
            {filtersActive && (
              <button type="button" onClick={clearFilters}
                className={`px-3 ${TOUCH} text-xs rounded-lg border border-[var(--border-bright)] bg-[var(--surface-2)] text-red-400 hover:border-red-700 transition-colors flex items-center gap-1`}>
                <X size={12} aria-hidden="true" /> Clear filters
              </button>
            )}
          </div>
        </div>
      </section>

      {truncated && !loading && (
        <div role="status" className="flex items-center gap-2 text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-2.5">
          <AlertTriangle size={13} aria-hidden="true" />
          Capped view: at least one read reached its 200,000-row ceiling. Narrow the country, site or date range for exact figures.
        </div>
      )}

      {/* ── Cost view (Tyres / General / Combined) from the expense grid ─────── */}
      <section aria-label="Cost view" className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--text-secondary)] font-medium">Spend from the expense grid (follows the country, site and date filters)</p>
          {costSplitLoading ? (
            <p className="text-2xl font-bold text-[var(--text-muted)] mt-0.5" aria-busy="true">Loading</p>
          ) : costSplitError ? (
            <p className="text-sm text-red-400 mt-1 flex items-center gap-2">
              Could not load spend.
              <button type="button" onClick={loadCost} className="underline">Retry</button>
            </p>
          ) : costFigure.blended ? (
            <div className="mt-1 flex flex-wrap gap-3">
              {costFigure.byCountry.length === 0
                ? <p className="text-sm text-[var(--text-muted)]">No spend recorded for this scope.</p>
                : costFigure.byCountry.map(r => (
                  <p key={r.country} className="text-sm text-[var(--text-primary)] tabular-nums">
                    <span className="text-[var(--text-muted)]">{r.country}: </span>{fmtMoney(r.amount, r.currency || '')}
                  </p>
                ))}
              <p className="text-xs text-[var(--text-muted)] w-full">Each country is shown in its own currency; pick one country for a single total.</p>
            </div>
          ) : (
            <p className="text-2xl font-bold text-green-400 mt-0.5 tabular-nums">{fmtMoney(costFigure.amount, costFigure.currency || activeCurrency)}</p>
          )}
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {costMode === 'tyres' ? 'Tyre spend' : costMode === 'maintenance' ? 'General (maintenance) spend' : 'Combined tyre and maintenance spend'}
            {dateFrom || dateTo ? ` (${dateFrom || 'start'} to ${dateTo || 'today'})` : ' (last 12 calendar months)'}
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--surface-2)] border border-[var(--border-bright)] w-fit" role="group" aria-label="Cost view">
          {costModeOptions.map(m => (
            <button key={m.key} type="button" aria-pressed={costMode === m.key} onClick={() => setCostMode(m.key)}
              className={`px-4 ${TOUCH} text-xs rounded-md font-medium transition-all ${
                costMode === m.key ? 'bg-green-700 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}>
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <YearlyTrendPanel title="Expense trend by year (tyres / spare / lubricant) + forecast" />

      {/* ── Fleet CPK lives in its own module ────────────────────────────────── */}
      <Link
        to="/cpk-intelligence"
        className="card flex items-center justify-between gap-3 border border-[var(--border-bright)] hover:border-blue-500/60 transition-colors no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Gauge size={20} className="text-blue-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">CPK Intelligence (its own module)</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Cost per km (movable) and cost per hour (non-movable), by country and period, with the what-if
              scenario, brand value and why-it-changed views.
            </p>
          </div>
        </div>
        <span className="text-xs font-medium text-blue-400 whitespace-nowrap">Open</span>
      </Link>

      {/* ── States ──────────────────────────────────────────────────────────── */}
      {loading && (
        <div aria-busy="true" aria-live="polite" className="space-y-3">
          <p className="text-[var(--text-muted)] text-sm">Computing 17 engineering KPIs...</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card h-24 animate-pulse" />)}
          </div>
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="flex items-start gap-3 bg-red-950/40 border border-red-700/50 rounded-xl p-4">
          <XCircle size={18} className="text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-red-300 font-medium text-sm">Engineering KPIs could not be loaded</p>
            <p className="text-red-400/80 text-xs mt-1">{error}</p>
            <button type="button" onClick={loadData} className={`btn-secondary text-xs mt-3 px-4 ${TOUCH}`}>Retry</button>
          </div>
        </div>
      )}

      {!loading && !error && !kpis && (
        <div className="card flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Cpu size={40} className="text-[var(--text-dim)]" aria-hidden="true" />
          <p className="text-[var(--text-secondary)] text-base font-medium">No tyre records for the selected filters</p>
          <p className="text-[var(--text-muted)] text-sm max-w-md">
            All 17 KPIs are computed automatically once tyre records exist in this scope.
          </p>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className={`btn-secondary text-sm px-4 ${TOUCH}`}>Clear filters</button>
          )}
        </div>
      )}

      {!loading && !error && kpis && head && (
        <>
          {/* ── Headline strip ─────────────────────────────────────────────── */}
          <section aria-label="Headline KPIs" className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <HeadlineCard
              metricId="fleet_cpk"
              country={activeCountry}
              title="Fleet CPK"
              value={head.cpk == null ? 'N/A' : `${activeCurrency} ${head.cpk.toFixed(4)}`}
              sub={head.cpk == null ? 'No km and price data' : `${activeCurrency}/km, ${head.cpkCoveragePct.toFixed(0)}% coverage`}
              status={cpkStatus(head.cpk)}
            />
            <HeadlineCard
              metricId="avg_tyre_life"
              country={activeCountry}
              title="Avg Tyre Life"
              value={fmtKm(head.avgLifeKm)}
              sub={head.avgLifeKm == null ? 'No km data' : `${head.lifeValidCount} records`}
              status={lifeStatus(head.avgLifeKm)}
            />
            <HeadlineCard
              metricId="failure_rate"
              country={activeCountry}
              title="Failure Rate"
              value={fmtPct(head.failurePct)}
              sub={head.failurePct == null ? `No tyres rated of ${head.totalCount} records` : `${head.failureCount} of ${head.ratedCount} rated`}
              status={lowerIsBetterPctStatus(head.failurePct, 15, 30)}
            />
            <HeadlineCard
              title="Inspection Compliance"
              value={fmtPct(head.inspectionPct)}
              sub={head.inspectionPct == null ? 'No scheduled inspections' : `${kpis.inspectionCompliance.onTimeCount} on time`}
              status={higherIsBetterPctStatus(head.inspectionPct, 85, 60)}
            />
            <HeadlineCard
              title="Fleet Availability"
              value={fmtPct(head.availabilityPct)}
              sub={head.availabilityPct == null ? 'No risk ratings recorded' : `${head.unavailableCount} vehicles critical`}
              status={higherIsBetterPctStatus(head.availabilityPct, 90, 75)}
            />
          </section>

          {/* ── 17 KPI cards with search + status filter ─────────────────── */}
          <section aria-labelledby="ekpi-cards-h">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
              <h2 id="ekpi-cards-h" className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                All 17 Engineering KPIs
              </h2>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="Search KPIs"
                    className={`input pl-8 text-sm w-full sm:w-56 ${TOUCH}`}
                    placeholder="Search KPIs"
                    value={cardQuery}
                    onChange={e => setCardQuery(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
                  {['all', 'critical', 'warning', 'good', 'neutral'].map(s => (
                    <button key={s} type="button" aria-pressed={cardStatus === s} onClick={() => setCardStatus(s)}
                      className={`px-3 ${TOUCH} text-xs rounded-full border transition-colors ${
                        cardStatus === s ? 'bg-blue-600 text-white border-blue-500' : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
                      }`}>
                      {s === 'all' ? 'All' : STATUS_LABEL[s]} ({counts[s]})
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {visibleCards.length === 0 ? (
              <div className="card text-center py-8 text-sm text-[var(--text-muted)]">
                No KPI matches the search or status filter.
                <button type="button" onClick={() => { setCardQuery(''); setCardStatus('all') }} className="underline ml-2">Show all</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleCards.map(card => <KpiCard key={card.title} {...card} />)}
              </div>
            )}
          </section>

          {/* ── Charts ─────────────────────────────────────────────────────── */}
          <section aria-labelledby="ekpi-charts-h">
            <h2 id="ekpi-charts-h" className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
              Analytical Charts
            </h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <ChartCard title="CPK by Brand: best 10" hint="Lower is better. Green under 1.0, amber 1 to 2, red 2 and over"
                empty={!cpkBrandChart} emptyText="No brand has both km and price data yet.">
                <Bar data={cpkBrandChart} options={chartOpts({ horizontal: true, yLabel: '', xLabel: `${activeCurrency}/km` })}
                  aria-label="Bar chart of average cost per km by brand" role="img" />
              </ChartCard>
              <ChartCard title="Monthly Tyre Spend (expense grid)"
                hint={costTrend ? `Trend: ${costTrend.trend === 'insufficient' ? 'not enough months' : costTrend.trend}` : 'Single country only'}
                empty={!costTrendChart}
                emptyText={costFigure.blended ? 'Spend spans several currencies. Pick one country to chart a single-currency trend.' : 'No tyre spend in the expense grid for this scope.'}>
                <Line data={costTrendChart} options={chartOpts({ yLabel: `Spend (${costTrend?.currency || activeCurrency})`, xLabel: 'Month' })}
                  aria-label="Line chart of monthly tyre spend with trend line" role="img" />
              </ChartCard>
              <ChartCard title="Failure Rate by Site (rated tyres)" hint="Worst first. Red over 30%, amber over 15%"
                empty={!failureBySiteChart} emptyText="Not measured: no tyre in this scope carries a risk level.">
                <Bar data={failureBySiteChart} options={chartOpts({ yLabel: 'Failure rate %', xLabel: 'Site', suffix: '%' })}
                  aria-label="Bar chart of failure rate by site" role="img" />
              </ChartCard>
              <ChartCard title="Inspection Compliance by Month (12 months)" hint="Target 85%"
                empty={!inspCompChart} emptyText="No scheduled inspections in this scope.">
                <Line data={inspCompChart} options={chartOpts({ yLabel: 'Compliance %', xLabel: 'Month', suffix: '%' })}
                  aria-label="Line chart of monthly inspection compliance against an 85 percent target" role="img" />
              </ChartCard>
            </div>
          </section>

          {/* ── Tables ─────────────────────────────────────────────────────── */}
          <section aria-labelledby="ekpi-assets-h" className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 id="ekpi-assets-h" className="text-sm font-medium text-[var(--text-primary)]">Asset CPK ranking (worst first)</h3>
              <span className="text-xs text-[var(--text-muted)]">
                {assetRows.length} assets with km and price data. Tyre spend is the expense-grid figure; assets not in the grid read "Not in grid".
              </span>
            </div>
            <EnterpriseTable
              columns={assetColumns}
              data={assetRows}
              getRowId={r => String(r.assetNo)}
              enableColumnFilters={false}
              searchPlaceholder="Search asset"
              initialPageSize={25}
              exportFileName={reportFileName('TyrePulse Asset CPK', scopeLabel)}
              reportMeta={{ title: 'Asset CPK ranking', currency: activeCurrency }}
              emptyMessage="No asset has both km and price data in this scope."
            />
          </section>

          <section aria-labelledby="ekpi-brands-h" className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 id="ekpi-brands-h" className="text-sm font-medium text-[var(--text-primary)]">Brand Performance Scorecard</h3>
              <span className="text-xs text-[var(--text-muted)]">{brandRows.length} brands. Green score = top 30%, red = bottom 30%.</span>
            </div>
            <EnterpriseTable
              columns={brandColumns}
              data={brandRows}
              getRowId={r => String(r.brand)}
              enableColumnFilters={false}
              searchPlaceholder="Search brand"
              initialPageSize={25}
              exportFileName={reportFileName('TyrePulse Brand Scorecard', scopeLabel)}
              reportMeta={{ title: 'Brand performance scorecard', currency: activeCurrency }}
              emptyMessage="No brand data in this scope."
            />
          </section>
        </>
      )}

      {kpis && head && (
        <EmailReportModal
          isOpen={emailModalOpen}
          onClose={() => setEmailModalOpen(false)}
          reportTitle="Engineering KPI Report"
          pdfColumns={['Brand', 'Avg CPK', 'Failure % (rated)', 'Avg Life (km)', 'Scrap %', 'Score']}
          pdfRows={brandRows.map(b => [
            b.brand,
            b.avgCpk != null ? b.avgCpk.toFixed(4) : 'N/A',
            fmtPct(b.failurePct),
            fmtKm(b.avgLifeKm),
            fmtPct(b.scrapPct),
            b.score != null ? b.score.toFixed(2) : 'N/A',
          ])}
          kpiSummary={{
            'Fleet CPK':             head.cpk != null ? `${activeCurrency} ${head.cpk.toFixed(4)}/km` : 'N/A',
            'Avg Tyre Life':         fmtKm(head.avgLifeKm),
            'Failure Rate':          fmtPct(head.failurePct),
            'Inspection Compliance': fmtPct(head.inspectionPct),
            'Fleet Availability':    fmtPct(head.availabilityPct),
            'Scrap Rate':            fmtPct(head.scrapPct),
            'Tyre Spend Trend':      costTrend ? costTrend.trend : 'N/A',
            'Downtime Hours':        `${kpis.downtimeImpact.totalDowntimeHours.toLocaleString()} hrs`,
          }}
          period={dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : 'All time'}
        />
      )}
    </div>
  )
}
