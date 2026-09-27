/**
 * Fuel Efficiency (route /fuel-efficiency) - the modelled fuel cost of tyre
 * condition (under-inflation and worn tread).
 *
 * Every calculation lives in the pure engine `src/lib/fuelEfficiencyAnalytics.js`.
 * The page only loads tyre records, collects the user's assumptions and renders.
 *
 * HONESTY RULES this page enforces
 *  - No invented fuel price. Cost figures stay N/A until a price per litre is
 *    entered (remembered per country on this device).
 *  - No invented distance. Litre figures need a monthly km, derived from real
 *    removed-tyre km or entered by hand; with neither they read N/A.
 *  - Pressure compliance reads N/A when no tyre carries a pressure reading.
 *  - Unmeasured tyres (no pressure, no tread) are excluded, never counted as
 *    perfect tyres.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Scatter, Doughnut } from 'react-chartjs-2'
import {
  Fuel, TrendingUp, TrendingDown, Leaf, Zap, AlertTriangle,
  RefreshCw, Loader2, FileSpreadsheet, FileText, Settings2, Wind,
  BarChart2, Activity, Globe, ShieldCheck, Lock, Info, Search, X, Truck, Gauge,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toUserMessage } from '../lib/safeError'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme, reportFileName } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/EmptyState'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { loadAutoTable } from '../lib/pdfEngine'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  FUEL_CONSTANTS, deriveMonthlyKm, fuelSites, filterFuelRecords, enrichTyres,
  vehicleMetrics as buildVehicleMetrics, siteMetrics as buildSiteMetrics, fuelKpis,
  complianceSavings, treadScatter, monthlyPenaltyTrend, environmentalImpact,
  fuelRecommendations,
} from '../lib/fuelEfficiencyAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

// Hard ceiling for the bounded tyre_records read. Country scope stays
// server-side; a truncated read past this ceiling is surfaced as a capped note.
const ROW_CAP = 50000
const PREFS_KEY = 'tp_fuel_efficiency_inputs_v1'

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: 'var(--text-primary)',
      bodyColor: 'var(--text-secondary)',
    },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}

const SORT = {
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
}
const blankToUndef = (v) => (v == null || v === '' ? undefined : v)

function fmt(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return 'N/A'
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmtCur(n, currency) {
  if (n == null || !Number.isFinite(n)) return 'N/A'
  if (Math.abs(n) >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${currency} ${(n / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(n).toLocaleString()}`
}

const pct = (v) => (v == null ? 'N/A' : `${v}%`)
const complianceTone = (v) => (v == null ? 'text-[var(--text-muted)]' : v >= 90 ? 'text-green-400' : v >= 75 ? 'text-orange-400' : 'text-red-400')
const treadTone = (v) => (v == null ? 'text-[var(--text-muted)]' : v <= 3 ? 'text-red-400' : v <= 5 ? 'text-orange-400' : 'text-[var(--text-secondary)]')

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {} } catch { return {} }
}
function writePrefs(v) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(v)) } catch { /* private mode: keep in memory only */ }
}
const toInput = (v) => (v == null || v === '' ? '' : String(v))
const toNumOrNull = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ─────────────────────────────────────────────────────────────────────────────
export default function FuelEfficiency() {
  const { activeCurrency, activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const { t } = useLanguage()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const countryKey = activeCountry || 'All'

  // ── Assumption inputs (remembered per country on this device) ─────────────
  const [configOpen, setConfigOpen] = useState(true)
  const [priceInput, setPriceInput] = useState('')
  const [consumptionInput, setConsumptionInput] = useState(String(FUEL_CONSTANTS.DEFAULT_CONSUMPTION_L_100KM))
  const [fleetSizeInput, setFleetSizeInput] = useState('')
  const [monthlyKmInput, setMonthlyKmInput] = useState('')
  const [complianceTarget, setComplianceTarget] = useState(95)

  useEffect(() => {
    const p = readPrefs()[countryKey] || {}
    setPriceInput(toInput(p.price))
    setConsumptionInput(toInput(p.consumption ?? FUEL_CONSTANTS.DEFAULT_CONSUMPTION_L_100KM))
    setMonthlyKmInput(toInput(p.monthlyKm))
    setFleetSizeInput('')
  }, [countryKey])

  useEffect(() => {
    const all = readPrefs()
    all[countryKey] = { price: toNumOrNull(priceInput), consumption: toNumOrNull(consumptionInput), monthlyKm: toNumOrNull(monthlyKmInput) }
    writePrefs(all)
  }, [countryKey, priceInput, consumptionInput, monthlyKmInput])

  // ── Filters ───────────────────────────────────────────────────────────────
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  // ── Data state ────────────────────────────────────────────────────────────
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exportError, setExportError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [capped, setCapped] = useState(false)
  const [now] = useState(() => Date.now())

  // ── Fuel-exception approval state ─────────────────────────────────────────
  // A per-vehicle fuel-waste anomaly (row in "Fuel Savings Opportunities") is
  // the approval subject requiring management sign-off before a formal
  // exception report is issued. `reviewException` holds the open row; `wfLocked`
  // mirrors the shared engine state so the row's strongest action (Issue
  // Exception Report) is disabled while an approval is active/locked. The page
  // is aggregated read-only analytics, so - as DriverManagement did by driver
  // name - the exception is keyed by asset_no.
  const [reviewException, setReviewException] = useState(null)
  const [wfLocked, setWfLocked] = useState(false)
  // Reset the lock whenever a different vehicle exception (or none) is opened.
  useEffect(() => { setWfLocked(false) }, [reviewException?.asset_no])

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: recs, error: rErr, truncated } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,asset_no,serial_number:serial_no,position,tread_depth,pressure_reading,risk_level,km_at_fitment,km_at_removal,site,country,brand,issue_date')
          .order('id')
        // Null-safe country scope - never silently drop uncategorised rows
        if (activeCountry && activeCountry !== 'All') q = q.or(`country.eq.${activeCountry},country.is.null`)
        return q.range(from, to)
      }, { max: ROW_CAP })
      if (rErr) throw rErr
      setRecords(recs ?? [])
      setCapped(Boolean(truncated))
      setLastRefresh(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load data'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Derived ───────────────────────────────────────────────────────────────
  const siteOptions = useMemo(() => fuelSites(records), [records])
  const scoped = useMemo(() => filterFuelRecords(records, { site: siteFilter, search }), [records, siteFilter, search])
  const derivedKm = useMemo(() => deriveMonthlyKm(records), [records])

  const price = toNumOrNull(priceInput)
  const consumption = toNumOrNull(consumptionInput)
  const monthlyKm = toNumOrNull(monthlyKmInput) ?? derivedKm.km
  const inputs = useMemo(() => ({ consumptionL100: consumption, monthlyKm, pricePerL: price }), [consumption, monthlyKm, price])

  const enriched = useMemo(() => enrichTyres(scoped), [scoped])
  const vehicles = useMemo(() => buildVehicleMetrics(enriched, inputs), [enriched, inputs])
  const sites = useMemo(() => buildSiteMetrics(enriched, vehicles), [enriched, vehicles])
  const kpis = useMemo(() => fuelKpis(enriched, vehicles, inputs), [enriched, vehicles, inputs])
  const fleetSize = toNumOrNull(fleetSizeInput) ?? vehicles.length
  const savingsToTarget = useMemo(
    () => complianceSavings(kpis.compliancePct, complianceTarget, { fleetSize, ...inputs }),
    [kpis.compliancePct, complianceTarget, fleetSize, inputs],
  )
  const savings95 = useMemo(
    () => complianceSavings(kpis.compliancePct, 95, { fleetSize, ...inputs }),
    [kpis.compliancePct, fleetSize, inputs],
  )
  const scatter = useMemo(() => treadScatter(enriched), [enriched])
  const trend = useMemo(() => monthlyPenaltyTrend(enriched, now), [enriched, now])
  const env = useMemo(() => environmentalImpact(kpis, consumption), [kpis, consumption])
  const recommendations = useMemo(
    () => fuelRecommendations({ kpis, sites, fmtMoney: (v) => fmtCur(v, activeCurrency) }),
    [kpis, sites, activeCurrency],
  )

  const filtersActive = Boolean(siteFilter || search.trim())
  const scopeLine = filtersActive
    ? `${scoped.length.toLocaleString()} of ${records.length.toLocaleString()} tyre records${siteFilter ? `, site ${siteFilter}` : ''}${search.trim() ? `, search "${search.trim()}"` : ''}`
    : `${records.length.toLocaleString()} tyre records`

  // ── Charts ────────────────────────────────────────────────────────────────
  const topVehicles = useMemo(
    () => vehicles.filter((v) => v.penaltyPct != null).sort((a, b) => b.penaltyPct - a.penaltyPct).filter((_, i) => i < 20),
    [vehicles],
  )
  const complianceDoughnut = useMemo(() => {
    const comp = kpis.compliancePct ?? 0
    return {
      labels: [t('fuel.compliance.compliant'), t('fuel.compliance.nonCompliant')],
      datasets: [{ data: [comp, +(100 - comp).toFixed(1)], backgroundColor: ['#10b981', '#ef4444'], borderWidth: 0 }],
    }
  }, [kpis.compliancePct, t])

  const scatterData = useMemo(() => {
    const datasets = scatter.series.map((s, i) => ({
      label: s.site,
      data: s.points,
      backgroundColor: withAlpha(colorAt(i), 0.6),
      pointRadius: 4,
    }))
    if (scatter.trend) {
      datasets.push({
        label: t('fuel.charts.trendSeries'),
        data: scatter.trend,
        borderColor: colorAt(datasets.length),
        backgroundColor: 'transparent',
        showLine: true,
        pointRadius: 0,
        borderDash: [5, 5],
        type: 'line',
      })
    }
    return { datasets }
  }, [scatter, t])

  // ── Table columns ─────────────────────────────────────────────────────────
  const vehicleColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorKey: 'asset_no', size: 110, ...SORT,
      cell: ({ row }) => <span className="font-semibold text-[var(--text-primary)]">{row.original.asset_no}</span> },
    { id: 'site', header: 'Site', accessorFn: (v) => blankToUndef(v.site), size: 120, ...SORT,
      cell: ({ row }) => row.original.site || 'Not recorded' },
    { id: 'tyreCount', header: 'Tyres', accessorKey: 'tyreCount', size: 70, ...SORT, meta: { align: 'right' } },
    { id: 'measuredTyres', header: 'Measured', accessorKey: 'measuredTyres', size: 90, ...SORT, meta: { align: 'right' } },
    { id: 'compliancePct', header: 'Compliance', accessorFn: (v) => blankToUndef(v.compliancePct), size: 100, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => <span className={complianceTone(row.original.compliancePct)}>{pct(row.original.compliancePct)}</span> },
    { id: 'avgDevPct', header: 'Under-inflation', accessorFn: (v) => blankToUndef(v.avgDevPct), size: 120, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => pct(row.original.avgDevPct) },
    { id: 'avgTread', header: 'Avg tread (mm)', accessorFn: (v) => blankToUndef(v.avgTread), size: 110, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => <span className={treadTone(row.original.avgTread)}>{row.original.avgTread ?? 'N/A'}</span> },
    { id: 'penaltyPct', header: 'Fuel penalty', accessorFn: (v) => blankToUndef(v.penaltyPct), size: 100, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => pct(row.original.penaltyPct) },
    { id: 'extraLitresMonth', header: 'Extra L / month', accessorFn: (v) => blankToUndef(v.extraLitresMonth), size: 120, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => fmt(row.original.extraLitresMonth, 1) },
    { id: 'extraCostMonth', header: `Extra ${activeCurrency} / month`, accessorFn: (v) => blankToUndef(v.extraCostMonth), size: 130, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => <span className="text-red-400">{fmtCur(row.original.extraCostMonth, activeCurrency)}</span> },
    { id: 'annualExtraCost', header: `Annual ${activeCurrency}`, accessorFn: (v) => blankToUndef(v.annualExtraCost), size: 120, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => fmtCur(row.original.annualExtraCost, activeCurrency) },
    {
      id: 'review', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setReviewException(row.original) }}
          aria-label={`Review fuel exception for ${row.original.asset_no}`}
          className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-amber-300 bg-amber-900/20 border border-amber-700/50 hover:bg-amber-900/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Review
        </button>
      ),
    },
  ], [activeCurrency])

  const siteColumns = useMemo(() => [
    { id: 'site', header: t('fuel.siteTable.columns.site'), accessorKey: 'site', size: 140, ...SORT,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.site}</span> },
    { id: 'vehicles', header: t('fuel.siteTable.columns.vehicles'), accessorKey: 'vehicles', size: 90, ...SORT, meta: { align: 'right' } },
    { id: 'measuredTyres', header: 'Measured tyres', accessorKey: 'measuredTyres', size: 120, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => `${row.original.measuredTyres} of ${row.original.tyres}` },
    { id: 'compliancePct', header: t('fuel.siteTable.columns.pressureCompliance'), accessorFn: (s) => blankToUndef(s.compliancePct), size: 140, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => <span className={`font-medium ${complianceTone(row.original.compliancePct)}`}>{pct(row.original.compliancePct)}</span> },
    { id: 'avgTread', header: t('fuel.siteTable.columns.avgTread'), accessorFn: (s) => blankToUndef(s.avgTread), size: 120, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => <span className={treadTone(row.original.avgTread)}>{row.original.avgTread ?? 'N/A'}</span> },
    { id: 'extraLitresMonth', header: t('fuel.siteTable.columns.extraFuelMonth'), accessorFn: (s) => blankToUndef(s.extraLitresMonth), size: 130, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => fmt(row.original.extraLitresMonth) },
    { id: 'extraCostMonth', header: t('fuel.siteTable.columns.monthlyExtraCost'), accessorFn: (s) => blankToUndef(s.extraCostMonth), size: 140, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => fmtCur(row.original.extraCostMonth, activeCurrency) },
    { id: 'annualExtraCost', header: t('fuel.siteTable.columns.annualImpact'), accessorFn: (s) => blankToUndef(s.annualExtraCost), size: 130, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-semibold">{fmtCur(row.original.annualExtraCost, activeCurrency)}</span> },
  ], [t, activeCurrency])

  // ── Export PDF ────────────────────────────────────────────────────────────
  const exportPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const fileName = `${reportFileName('TyrePulse Fuel Efficiency Report')}.pdf`
    pdfHeader(doc, 'Fuel Efficiency Impact Report', `${scopeLine} | ${vehicles.length} vehicles`, company, brand)

    if (sites.length === 0) {
      pdfEmptyState(doc, 'No site fuel-impact data for the current selection')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(fileName)
      return
    }

    doc.setTextColor(30, 30, 30)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Key figures (modelled estimates)', 14, 30)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const kpiLines = [
      `Monthly fuel loss cost: ${fmtCur(kpis.extraCostMonth, activeCurrency)}${price == null ? ' (enter a fuel price to compute)' : ''}`,
      `Monthly excess fuel: ${fmt(kpis.extraLitresMonth)} L`,
      `Pressure compliance: ${pct(kpis.compliancePct)} (${kpis.pressureReadings} tyres with a reading)`,
      `Average under-inflation: ${pct(kpis.avgDevPct)}`,
      `Potential annual saving at 95% compliance: ${fmtCur(savings95.annualCost, activeCurrency)}`,
      `Assumptions: ${consumption ?? 'N/A'} L/100km, ${monthlyKm ?? 'N/A'} km per vehicle per month, ${price == null ? 'no fuel price' : `${activeCurrency} ${price}/L`}`,
    ]
    kpiLines.forEach((l, i) => doc.text(l, 14, 38 + i * 7))

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 85,
      head: [['Site', 'Vehicles', 'Compliance %', 'Avg Tread (mm)', 'Extra Fuel/Month (L)', 'Extra Cost/Month', 'Annual Impact']],
      body: sites.map(s => [
        s.site,
        s.vehicles,
        pct(s.compliancePct),
        s.avgTread ?? 'N/A',
        fmt(s.extraLitresMonth),
        fmtCur(s.extraCostMonth, activeCurrency),
        fmtCur(s.annualExtraCost, activeCurrency),
      ]),
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
    doc.save(fileName)
  }, [kpis, sites, vehicles.length, activeCurrency, branding, company, scopeLine, price, consumption, monthlyKm, savings95])

  // ── Export Excel ──────────────────────────────────────────────────────────
  const exportExcel = useCallback(async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const na = (v) => (v == null ? 'N/A' : v)

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      Report: 'Fuel Efficiency Impact (modelled estimates)',
      Scope: scopeLine,
      'Fuel price per litre': price == null ? 'Not entered' : `${activeCurrency} ${price}`,
      'Consumption (L/100km)': na(consumption),
      'Monthly km per vehicle': na(monthlyKm),
      'Pressure compliance %': na(kpis.compliancePct),
      'Monthly excess fuel (L)': na(kpis.extraLitresMonth),
      [`Monthly fuel loss cost (${activeCurrency})`]: na(kpis.extraCostMonth),
    }]), 'Summary')

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vehicles.map(v => ({
      'Asset No': v.asset_no,
      Site: v.site || 'Not recorded',
      Tyres: v.tyreCount,
      'Measured Tyres': v.measuredTyres,
      'Compliance %': na(v.compliancePct),
      'Avg Under-inflation %': na(v.avgDevPct),
      'Avg Tread (mm)': na(v.avgTread),
      'Fuel Penalty %': na(v.penaltyPct),
      'Monthly Extra Fuel (L)': na(v.extraLitresMonth),
      [`Monthly Extra Cost (${activeCurrency})`]: na(v.extraCostMonth),
      [`Annual Extra Cost (${activeCurrency})`]: na(v.annualExtraCost),
    }))), 'Vehicles')

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sites.map(s => ({
      Site: s.site,
      Vehicles: s.vehicles,
      'Measured Tyres': s.measuredTyres,
      'Compliance %': na(s.compliancePct),
      'Avg Tread (mm)': na(s.avgTread),
      'Extra Fuel/Month (L)': na(s.extraLitresMonth),
      [`Monthly Extra Cost (${activeCurrency})`]: na(s.extraCostMonth),
      [`Annual Impact (${activeCurrency})`]: na(s.annualExtraCost),
    }))), 'Sites')

    XLSX.writeFile(wb, `${reportFileName('TyrePulse Fuel Efficiency')}.xlsx`)
  }, [vehicles, sites, kpis, activeCurrency, scopeLine, price, consumption, monthlyKm])

  const runExport = async (fn) => {
    setExportError('')
    try { await fn() } catch (e) { setExportError(toUserMessage(e, 'Could not export. Please retry.')) }
  }

  const inputCls = 'w-full min-h-[44px] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="text-[var(--text-primary)] space-y-6">

      <PageHeader
        title={t('fuel.title')}
        subtitle={t('fuel.subtitle')}
        icon={Fuel}
        actions={<>
          {lastRefresh && (
            <span className="text-xs text-[var(--text-muted)]">
              {t('fuel.actions.updated', { time: lastRefresh.toLocaleTimeString() })}
            </span>
          )}
          <button type="button" onClick={fetchData} disabled={loading} className="btn-secondary gap-1.5 min-h-[40px]">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
            {t('fuel.actions.refresh')}
          </button>
          <button type="button" onClick={() => runExport(exportPDF)} disabled={loading || !records.length} className="btn-secondary gap-1.5 min-h-[40px]">
            <FileText className="w-4 h-4" aria-hidden="true" /> {t('fuel.actions.pdf')}
          </button>
          <button type="button" onClick={() => runExport(exportExcel)} disabled={loading || !records.length} className="btn-secondary gap-1.5 min-h-[40px]">
            <FileSpreadsheet className="w-4 h-4" aria-hidden="true" /> {t('fuel.actions.excel')}
          </button>
        </>}
      />

      {/* ── Estimate disclosure ───────────────────────────────────────────── */}
      <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          <span className="font-semibold text-amber-300">Modelled estimates, not measured fuel consumption.</span>{' '}
          Figures apply published rolling-resistance rules (about 2% more fuel per 10% under-inflation, up to 3% for worn tread)
          to the pressure and tread readings on record. Enter your own fuel price and distances below; nothing is assumed for you.
        </p>
      </div>

      {capped && !loading && (
        <div className="bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)] rounded-xl px-4 py-2.5 text-xs">
          Showing a capped view of {ROW_CAP.toLocaleString()} tyre records for this selection. Narrow the country for the full set.
        </div>
      )}

      {exportError && (
        <p role="alert" className="bg-red-900/30 border border-red-700 text-red-300 rounded-xl px-4 py-2.5 text-sm">{exportError}</p>
      )}

      {error && (
        <div role="alert" className="bg-red-900/30 border border-red-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-red-300 text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button type="button" onClick={fetchData} className="btn-secondary gap-1.5 min-h-[40px] shrink-0">
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading fuel efficiency data">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-24 rounded-xl bg-[var(--surface-1)] border border-[var(--border-dim)] animate-pulse" />)}
          </div>
          <div className="h-72 rounded-xl bg-[var(--surface-1)] border border-[var(--border-dim)] animate-pulse" />
        </div>
      )}

      {!loading && !error && records.length === 0 && (
        <EmptyState
          icon={Fuel}
          title={t('fuel.empty.title')}
          description={t('fuel.empty.subtitle')}
          action={{ label: 'Refresh', onClick: fetchData }}
        />
      )}

      {!loading && !error && records.length > 0 && (
        <>
          {/* ── Filters ───────────────────────────────────────────────── */}
          <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-3 grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-2 items-center">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                className={`${inputCls} pl-8`}
                placeholder="Search asset, serial, brand or position"
                aria-label="Search tyre records"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className={inputCls} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Filter by site">
              <option value="">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="flex items-center gap-2 justify-end">
              <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{scoped.length.toLocaleString()} of {records.length.toLocaleString()}</span>
              {filtersActive && (
                <button type="button" onClick={() => { setSiteFilter(''); setSearch('') }} className="btn-secondary text-xs gap-1 min-h-[36px]">
                  <X size={12} aria-hidden="true" /> Clear
                </button>
              )}
            </div>
          </div>

          {/* ── Assumptions ───────────────────────────────────────────── */}
          <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl">
            <button
              type="button"
              onClick={() => setConfigOpen(o => !o)}
              aria-expanded={configOpen}
              aria-controls="fuel-assumptions"
              className="w-full min-h-[48px] flex items-center justify-between px-5 py-3 hover:bg-[var(--surface-2)] rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                <Settings2 className="w-5 h-5 text-amber-300" aria-hidden="true" />
                Assumptions
              </span>
              <span className="text-xs text-[var(--text-muted)]">{configOpen ? 'Hide' : 'Show'}</span>
            </button>
            {configOpen && (
              <div id="fuel-assumptions" className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-[var(--border-dim)]">
                <ConfigField id="fe-price" label={`Fuel price per litre (${activeCurrency})`} value={priceInput} onChange={setPriceInput} step={0.01}
                  hint={price == null ? 'Required for any cost figure.' : 'Remembered for this country on this device.'} className={inputCls} />
                <ConfigField id="fe-consumption" label="Fleet consumption (L/100km)" value={consumptionInput} onChange={setConsumptionInput} step={1}
                  hint="35 is a heavy-truck baseline. Replace with your figure." className={inputCls} />
                <ConfigField id="fe-km" label="Monthly km per vehicle" value={monthlyKmInput} onChange={setMonthlyKmInput} step={100}
                  placeholder={derivedKm.km == null ? 'Enter a distance' : String(derivedKm.km)}
                  hint={derivedKm.km == null
                    ? 'No removed tyre carries both km readings, so no distance can be derived.'
                    : `Derived ${derivedKm.km.toLocaleString()} km from ${derivedKm.samples} removed tyres (assumes about 3 months on the vehicle).`}
                  className={inputCls} />
                <ConfigField id="fe-fleet" label="Fleet size for savings" value={fleetSizeInput} onChange={setFleetSizeInput} step={1}
                  placeholder={String(vehicles.length)} hint={`${vehicles.length} vehicles in scope carry a tyre record.`} className={inputCls} />
              </div>
            )}
          </div>

          {/* ── KPI strip ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <KpiCard label={t('fuel.kpi.monthlyLoss')} value={fmtCur(kpis.extraCostMonth, activeCurrency)}
              sub={kpis.extraLitresMonth == null ? 'Needs a monthly distance' : `${fmt(kpis.extraLitresMonth)} L excess per month`}
              icon={Fuel} color="amber" />
            <KpiCard label="Pressure compliance" value={pct(kpis.compliancePct)}
              sub={kpis.pressureReadings ? `${kpis.pressureReadings.toLocaleString()} tyres with a reading` : 'No pressure readings in scope'}
              icon={Gauge} color={kpis.compliancePct == null ? 'slate' : kpis.compliancePct >= 90 ? 'green' : kpis.compliancePct >= 75 ? 'amber' : 'red'} />
            <KpiCard label={t('fuel.kpi.avgDeviation')} value={pct(kpis.avgDevPct)} sub="Average below nominal pressure"
              icon={Wind} color={kpis.avgDevPct == null ? 'slate' : kpis.avgDevPct < 5 ? 'green' : kpis.avgDevPct < 10 ? 'amber' : 'red'} />
            <KpiCard label={t('fuel.kpi.rrScore')} value={kpis.rrScore == null ? 'N/A' : `${kpis.rrScore}/10`} sub={t('fuel.kpi.rrScoreSub')}
              icon={Activity} color={kpis.rrScore == null ? 'slate' : kpis.rrScore < 3 ? 'green' : kpis.rrScore < 6 ? 'amber' : 'red'} />
            <KpiCard label={t('fuel.kpi.potentialSavings')} value={fmtCur(savings95.annualCost, activeCurrency)}
              sub="Reaching 95% pressure compliance" icon={TrendingDown} color="green" />
            <KpiCard label="Measured tyres" value={`${kpis.measuredTyres.toLocaleString()} / ${kpis.tyres.toLocaleString()}`}
              sub={`${kpis.wornTyres} at or below 3 mm tread`} icon={Truck} color="blue" />
          </div>
          {filtersActive && <p className="text-xs text-[var(--text-muted)] -mt-3">These figures cover {scopeLine}.</p>}

          {kpis.measuredTyres === 0 ? (
            <EmptyState
              icon={Gauge}
              title="No tyre in this selection carries a pressure or tread reading"
              description="Fuel impact cannot be modelled from tyres that were never measured. Record pressures and tread depths at inspection to populate this page."
            />
          ) : (
            <>
              {/* ── Compliance + calculator ───────────────────────────── */}
              <div className="grid md:grid-cols-2 gap-4">
                <Panel title={t('fuel.compliance.heading')} icon={BarChart2}>
                  {kpis.compliancePct == null ? (
                    <p className="text-sm text-[var(--text-muted)]">No tyre in this selection carries a pressure reading, so compliance cannot be measured.</p>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-center gap-6">
                      <div className="w-40 h-40 shrink-0" role="img" aria-label={`Pressure compliance ${kpis.compliancePct}%`}>
                        <Doughnut data={complianceDoughnut}
                          options={{ responsive: true, maintainAspectRatio: false, cutout: '75%',
                            plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-muted)', font: { size: 11 } } }, tooltip: CHART_OPTS.plugins.tooltip } }} />
                      </div>
                      <dl className="space-y-2">
                        <div><dt className="text-[var(--text-secondary)] text-xs">{t('fuel.compliance.compliantTyres')}</dt><dd className="text-2xl font-bold text-green-400">{pct(kpis.compliancePct)}</dd></div>
                        <div><dt className="text-[var(--text-secondary)] text-xs">{t('fuel.compliance.avgDeviationFromNominal')}</dt><dd className="text-2xl font-bold text-orange-400">{pct(kpis.avgDevPct)}</dd></div>
                        <div><dt className="text-[var(--text-secondary)] text-xs">{t('fuel.compliance.nominalPressure')}</dt><dd className="text-lg font-semibold text-[var(--text-secondary)]">{FUEL_CONSTANTS.NOMINAL_PRESSURE_PSI}</dd></div>
                      </dl>
                    </div>
                  )}
                </Panel>

                <Panel title={t('fuel.calculator.heading')} icon={Zap}>
                  {kpis.compliancePct == null ? (
                    <p className="text-sm text-[var(--text-muted)]">The savings calculator needs a measured compliance figure.</p>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="fe-target" className="flex justify-between text-sm mb-2 text-[var(--text-secondary)]">
                          <span>Current {kpis.compliancePct}%</span>
                          <span>Target {complianceTarget}%</span>
                        </label>
                        <input
                          id="fe-target"
                          type="range"
                          min={Math.min(99, Math.ceil(kpis.compliancePct))}
                          max={99}
                          value={Math.max(complianceTarget, Math.min(99, Math.ceil(kpis.compliancePct)))}
                          onChange={e => setComplianceTarget(+e.target.value)}
                          className="w-full h-2 rounded-lg cursor-pointer accent-amber-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-[var(--surface-2)] rounded-xl p-4">
                          <p className="text-[var(--text-secondary)] text-xs mb-1">{t('fuel.calculator.monthlySaving')}</p>
                          <p className="text-xl font-bold text-green-400">{fmtCur(savingsToTarget.monthlyCost, activeCurrency)}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-1">{fmt(savingsToTarget.monthlyLitres)} L</p>
                        </div>
                        <div className="bg-[var(--surface-2)] rounded-xl p-4">
                          <p className="text-[var(--text-secondary)] text-xs mb-1">{t('fuel.calculator.annualSaving')}</p>
                          <p className="text-xl font-bold text-green-400">{fmtCur(savingsToTarget.annualCost, activeCurrency)}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-1">{savingsToTarget.monthlyLitres == null ? 'N/A' : `${fmt(savingsToTarget.monthlyLitres * 12)} L`}</p>
                        </div>
                      </div>
                      <p className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 text-xs text-blue-300">
                        Improvement x 2% fuel per 10% under-inflation x {monthlyKm == null || consumption == null ? 'N/A' : fmt((consumption / 100) * monthlyKm)} L per vehicle per month x {fleetSize} vehicles.
                      </p>
                    </div>
                  )}
                </Panel>
              </div>

              {/* ── Charts ────────────────────────────────────────────── */}
              {topVehicles.length > 0 && (
                <Panel title="Fuel penalty by vehicle" subtitle="Top 20 vehicles by modelled fuel penalty from tyre condition" icon={BarChart2}>
                  <div className="h-72">
                    <Bar
                      data={{
                        labels: topVehicles.map(v => v.asset_no),
                        datasets: [{
                          label: 'Fuel penalty %',
                          data: topVehicles.map(v => v.penaltyPct),
                          backgroundColor: topVehicles.map(v => (v.penaltyPct >= 3 ? '#ef4444cc' : v.penaltyPct >= 1.5 ? '#f59e0bcc' : withAlpha(colorAt(0), 0.8))),
                          borderRadius: 4,
                        }],
                      }}
                      options={{
                        ...CHART_OPTS,
                        plugins: {
                          ...CHART_OPTS.plugins,
                          legend: { display: false },
                          tooltip: {
                            ...CHART_OPTS.plugins.tooltip,
                            callbacks: {
                              label: (ctx) => `Fuel penalty ${ctx.raw}%`,
                              afterLabel: (ctx) => {
                                const v = topVehicles[ctx.dataIndex]
                                if (!v) return ''
                                return [`Compliance ${pct(v.compliancePct)}`, `Avg tread ${v.avgTread ?? 'N/A'} mm`, `Extra ${fmtCur(v.extraCostMonth, activeCurrency)} per month`]
                              },
                            },
                          },
                        },
                      }}
                    />
                  </div>
                </Panel>
              )}

              <div className="grid lg:grid-cols-2 gap-4">
                <Panel title={t('fuel.charts.treadCorrelation')} subtitle="Tread depth against modelled fuel penalty, coloured by site" icon={Activity}>
                  {scatter.points < 2 ? (
                    <p className="text-sm text-[var(--text-muted)]">Needs at least two tyres with a tread depth.</p>
                  ) : (
                    <div className="h-72">
                      <Scatter
                        data={scatterData}
                        options={{
                          ...CHART_OPTS,
                          plugins: { ...CHART_OPTS.plugins, tooltip: { ...CHART_OPTS.plugins.tooltip, callbacks: { label: ctx => `Tread ${ctx.parsed.x} mm, penalty ${ctx.parsed.y}%` } } },
                          scales: {
                            x: { ...CHART_OPTS.scales.x, title: { display: true, text: t('fuel.charts.axisTreadDepth'), color: 'var(--text-muted)' } },
                            y: { ...CHART_OPTS.scales.y, title: { display: true, text: 'Fuel penalty %', color: 'var(--text-muted)' } },
                          },
                        }}
                      />
                    </div>
                  )}
                </Panel>

                <Panel title="Fuel penalty by fitment month" subtitle="Average modelled penalty of tyres fitted each month; months with no measured tyre are left blank" icon={TrendingUp}>
                  {trend.every((m) => m.avgPenaltyPct == null) ? (
                    <p className="text-sm text-[var(--text-muted)]">No measured tyre was fitted in the last 12 months.</p>
                  ) : (
                    <div className="h-72">
                      <Line
                        data={{
                          labels: trend.map(m => m.key),
                          datasets: [{
                            label: 'Average fuel penalty %',
                            data: trend.map(m => m.avgPenaltyPct),
                            borderColor: colorAt(2),
                            backgroundColor: withAlpha(colorAt(2), 0.15),
                            fill: true,
                            tension: 0.35,
                            spanGaps: false,
                            pointRadius: 4,
                          }],
                        }}
                        options={{
                          ...CHART_OPTS,
                          plugins: {
                            ...CHART_OPTS.plugins,
                            legend: { display: false },
                            tooltip: { ...CHART_OPTS.plugins.tooltip, callbacks: { afterLabel: (ctx) => `${trend[ctx.dataIndex].measured} measured of ${trend[ctx.dataIndex].count} fitted` } },
                          },
                        }}
                      />
                    </div>
                  )}
                </Panel>
              </div>

              {/* ── Site table ────────────────────────────────────────── */}
              <section className="space-y-2" aria-labelledby="fe-sites">
                <h2 id="fe-sites" className="font-semibold text-[var(--text-primary)] flex items-center gap-2 px-1">
                  <Globe className="w-5 h-5 text-blue-400" aria-hidden="true" /> {t('fuel.siteTable.heading')}
                </h2>
                <EnterpriseTable
                  columns={siteColumns}
                  data={sites}
                  getRowId={(s) => s.site}
                  enableColumnFilters={false}
                  searchPlaceholder="Search site"
                  exportFileName={reportFileName('TyrePulse Fuel Efficiency Sites')}
                  reportMeta={{ title: 'Fuel efficiency by site', company, currency: activeCurrency }}
                  initialPageSize={25}
                  emptyMessage="No site in this selection."
                />
              </section>

              {/* ── Vehicle table (savings opportunities + review) ─────── */}
              <section className="space-y-2" aria-labelledby="fe-vehicles">
                <h2 id="fe-vehicles" className="font-semibold text-[var(--text-primary)] flex items-center gap-2 px-1">
                  <TrendingDown className="w-5 h-5 text-green-400" aria-hidden="true" /> Fuel savings opportunities by vehicle
                </h2>
                <EnterpriseTable
                  columns={vehicleColumns}
                  data={vehicles}
                  getRowId={(v) => v.asset_no}
                  enableColumnFilters={false}
                  searchPlaceholder="Search asset or site"
                  exportFileName={reportFileName('TyrePulse Fuel Efficiency Vehicles')}
                  reportMeta={{ title: 'Fuel efficiency by vehicle', company, currency: activeCurrency }}
                  initialPageSize={25}
                  onRowClick={(v) => setReviewException(v)}
                  emptyMessage="No vehicle in this selection."
                />
              </section>

              {/* ── Environmental ─────────────────────────────────────── */}
              {env && (
                <Panel title={t('fuel.env.heading')} icon={Leaf}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <EnvCard icon={Wind} color="blue" value={`${env.co2TonnesMonth} t`} label="Excess CO2 per month" sub={`${fmt(env.co2KgMonth)} kg from ${fmt(kpis.extraLitresMonth)} L`} />
                    <EnvCard icon={Leaf} color="green" value={fmt(env.treesNeeded)} label="Trees to offset a year" sub="About 21 trees absorb 1 tonne of CO2 a year" />
                    <EnvCard icon={Fuel} color="amber" value={env.equivalentKm == null ? 'N/A' : `${fmt(env.equivalentKm)} km`} label="Equivalent distance per month" sub="Fuel that bought no distance" />
                  </div>
                </Panel>
              )}

              {/* ── Recommendations ───────────────────────────────────── */}
              <Panel title={t('fuel.recommendations.heading')} subtitle="Generated only from the readings on record" icon={Zap}>
                {recommendations.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">No action stands out in this selection.</p>
                ) : (
                  <ul className="divide-y divide-[var(--border-dim)]">
                    {recommendations.map((r) => (
                      <li key={r.key} className="py-3 flex items-start gap-4">
                        <AlertTriangle className={`w-5 h-5 mt-0.5 shrink-0 ${r.impact === 'Critical' ? 'text-red-400' : 'text-orange-400'}`} aria-hidden="true" />
                        <p className="flex-1 text-sm text-[var(--text-primary)]">{r.text}</p>
                        <ImpactBadge impact={r.impact} />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          )}
        </>
      )}

      {/* ── Fuel Exception Review & Approval ───────────────────────────────
          The reviewed vehicle row is the fuel-waste anomaly document under
          management review. The shared Approval & Workflow Engine drives status,
          the immutable trail, and requirement-gated actions; the page gates its
          strongest action - issuing the formal exception report - while the
          approval is active/locked. ──────────────────────────────────────── */}
      {reviewException && (
        <Modal
          open
          onClose={() => setReviewException(null)}
          title={`Fuel exception: ${reviewException.asset_no}`}
          subtitle={`${reviewException.site || 'Site not recorded'} | ${fmtCur(reviewException.extraCostMonth, activeCurrency)} per month`}
          size="lg"
        >
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ExceptionStat label="Compliance" value={pct(reviewException.compliancePct)} />
              <ExceptionStat label="Avg tread" value={reviewException.avgTread != null ? `${reviewException.avgTread} mm` : 'N/A'} />
              <ExceptionStat label="Monthly waste" value={fmtCur(reviewException.extraCostMonth, activeCurrency)} />
              <ExceptionStat label="Annual impact" value={fmtCur(reviewException.annualExtraCost, activeCurrency)} />
            </div>

            {/* Shared approval engine - keyed by asset_no (aggregated data) */}
            <EntityApprovalPanel
              entityType="fuel_exception"
              entityId={reviewException.asset_no}
              entityLabel={reviewException.asset_no}
              context={{
                variance: reviewException.avgDevPct,
                cost: Math.round(reviewException.extraCostMonth || 0),
                deviation_pct: reviewException.avgDevPct,
                compliance_pct: reviewException.compliancePct,
                avg_tread_mm: reviewException.avgTread,
                annual_cost: Math.round(reviewException.annualExtraCost || 0),
                site: reviewException.site,
              }}
              onStateChange={(s) => setWfLocked(!!(s?.isActive || s?.isLocked))}
              title="Fuel Exception Approval"
            />

            <div className="flex items-center justify-between gap-3 pt-1">
              {wfLocked ? (
                <span className="flex items-center gap-1.5 text-xs text-[var(--accent)]">
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  Locked, in approval
                </span>
              ) : <span />}
              <button
                type="button"
                onClick={() => { if (!wfLocked) runExport(exportPDF) }}
                disabled={wfLocked}
                title={wfLocked ? 'Locked, in approval' : 'Issue formal fuel exception report'}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg text-xs font-medium text-amber-300 bg-amber-900/20 border border-amber-700/50 hover:bg-amber-900/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {wfLocked ? <Lock className="w-3.5 h-3.5" aria-hidden="true" /> : <FileText className="w-3.5 h-3.5" aria-hidden="true" />}
                Issue exception report
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ExceptionStat({ label, value }) {
  return (
    <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg px-3 py-2">
      <p className="text-[var(--text-muted)] text-[11px] uppercase tracking-wide">{label}</p>
      <p className="text-[var(--text-primary)] text-sm font-semibold mt-0.5">{value}</p>
    </div>
  )
}

function ConfigField({ id, label, value, onChange, step = 1, hint, placeholder, className }) {
  return (
    <div className="pt-4">
      <label htmlFor={id} className="block text-xs text-[var(--text-secondary)] mb-1.5">{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        value={value}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={e => onChange(e.target.value)}
        step={step}
        className={className}
      />
      {hint && <p id={`${id}-hint`} className="text-[11px] text-[var(--text-muted)] mt-1">{hint}</p>}
    </div>
  )
}

const COLOR_MAP = {
  amber: { bg: 'bg-amber-900/20', border: 'border-amber-700/50', icon: 'text-amber-300', value: 'text-orange-400' },
  green: { bg: 'bg-green-900/20', border: 'border-green-700/50', icon: 'text-green-400', value: 'text-green-400' },
  red: { bg: 'bg-red-900/20', border: 'border-red-700/50', icon: 'text-red-400', value: 'text-red-400' },
  blue: { bg: 'bg-blue-900/20', border: 'border-blue-700/50', icon: 'text-blue-400', value: 'text-blue-400' },
  slate: { bg: 'bg-[var(--surface-1)]', border: 'border-[var(--border-dim)]', icon: 'text-[var(--text-muted)]', value: 'text-[var(--text-muted)]' },
}

function KpiCard({ label, value, sub, icon: Icon, color = 'blue' }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.blue
  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4 flex flex-col gap-1.5 min-w-0`}>
      <Icon className={`w-5 h-5 ${c.icon}`} aria-hidden="true" />
      <p className={`text-xl font-bold tabular-nums ${c.value}`}>{value}</p>
      <p className="text-[var(--text-secondary)] text-xs font-medium leading-tight">{label}</p>
      {sub && <p className="text-[var(--text-muted)] text-xs">{sub}</p>}
    </div>
  )
}

function Panel({ title, subtitle, icon: Icon, children }) {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-blue-400" aria-hidden="true" />}
          {title}
        </h2>
        {subtitle && <p className="text-[var(--text-muted)] text-xs mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

function EnvCard({ icon: Icon, color, value, label, sub }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.blue
  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-5 flex items-start gap-4`}>
      <Icon className={`w-8 h-8 ${c.icon} mt-1 shrink-0`} aria-hidden="true" />
      <div>
        <p className={`text-2xl font-bold ${c.value}`}>{value}</p>
        <p className="text-[var(--text-secondary)] text-sm font-medium">{label}</p>
        <p className="text-[var(--text-muted)] text-xs mt-0.5">{sub}</p>
      </div>
    </div>
  )
}

function ImpactBadge({ impact }) {
  const cls = {
    Critical: 'bg-red-900/40 text-red-300 border-red-700',
    High: 'bg-orange-900/40 text-orange-300 border-orange-700',
    Medium: 'bg-amber-900/40 text-amber-300 border-amber-700',
  }[impact] ?? 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
  return (
    <span className={`shrink-0 text-xs border rounded-full px-2.5 py-0.5 font-medium ${cls}`}>{impact}</span>
  )
}
