import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Scatter, Doughnut } from 'react-chartjs-2'
import {
  Fuel, TrendingUp, TrendingDown, Leaf, Zap, AlertTriangle,
  ChevronDown, ChevronUp, RefreshCw, Loader2, Download,
  FileSpreadsheet, FileText, Settings2, Wind, Thermometer,
  DollarSign, BarChart2, Activity, Globe, CheckCircle, XCircle,
  Info, ArrowUpRight, ArrowDownRight, ShieldCheck, Lock, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import { formatMonthYear } from '../lib/formatters'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

// ── Scientific Constants ───────────────────────────────────────────────────────
const UNDER_INFLATION_FUEL_PCT_PER_10PCT = 0.02   // +2% fuel per 10% under-inflation
const WORN_TREAD_FUEL_PENALTY_PCT = 0.03           // ≤3mm vs >8mm = +3% fuel
const MISALIGNMENT_FUEL_PENALTY_PCT = 0.05         // +5% fuel per misaligned vehicle
const CO2_KG_PER_LITER = 2.68
const TREES_PER_TONNE_CO2_YEAR = 21                // ~21 trees absorb 1 tonne CO2/yr
const DEFAULT_FUEL_COST_PER_LITER = 22             // ZAR
const DEFAULT_FLEET_CONSUMPTION_L_100KM = 35       // L/100km heavy truck
const NOMINAL_PRESSURE_PSI = 110                   // typical truck tyre nominal
const TREAD_NEW_MM = 8
const TREAD_WORN_MM = 3

// ── Chart shared defaults ──────────────────────────────────────────────────────
const CHART_OPTS = {
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

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
]

function fmt(n, dec = 0) {
  if (n == null || !isFinite(n)) return '0'
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmtCur(n, currency) {
  if (n == null || !isFinite(n)) return `${currency} 0`
  if (Math.abs(n) >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${currency} ${(n / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(n).toLocaleString()}`
}

// ── Pressure deviation → % under-inflation ───────────────────────────────────
function calcPressureDev(reading, nominal = NOMINAL_PRESSURE_PSI) {
  if (!reading || reading <= 0) return 0
  return Math.max(0, (nominal - reading) / nominal)
}

// ── Fuel penalty fraction for a tyre record ───────────────────────────────────
function calcTyreFuelPenalty(record) {
  const pressDev = calcPressureDev(record.pressure_reading)
  const pressurePenalty = (pressDev / 0.10) * UNDER_INFLATION_FUEL_PCT_PER_10PCT

  let treadPenalty = 0
  const td = parseFloat(record.tread_depth)
  if (!isNaN(td)) {
    if (td <= TREAD_WORN_MM) treadPenalty = WORN_TREAD_FUEL_PENALTY_PCT
    else if (td < TREAD_NEW_MM) {
      treadPenalty = WORN_TREAD_FUEL_PENALTY_PCT * (TREAD_NEW_MM - td) / (TREAD_NEW_MM - TREAD_WORN_MM)
    }
  }

  return pressurePenalty + treadPenalty
}

// ── Monthly km derived from km_at_fitment / km_at_removal ────────────────────
function deriveMonthlyKm(records) {
  const pairs = records.filter(r => r.km_at_fitment != null && r.km_at_removal != null && r.km_at_removal > r.km_at_fitment)
  if (!pairs.length) return 5000
  const totalKm = pairs.reduce((s, r) => s + (r.km_at_removal - r.km_at_fitment), 0)
  return Math.round(totalKm / pairs.length / 3) // assume avg tyre life ~3 months
}

// ─────────────────────────────────────────────────────────────────────────────
export default function FuelEfficiency() {
  const { activeCurrency, activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const { t } = useLanguage()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  // ── Config state ──────────────────────────────────────────────────────────
  const [configOpen, setConfigOpen] = useState(true)
  const [fuelCostPerLiter, setFuelCostPerLiter] = useState(DEFAULT_FUEL_COST_PER_LITER)
  const [fleetConsumption, setFleetConsumption] = useState(DEFAULT_FLEET_CONSUMPTION_L_100KM)
  const [fleetSizeOverride, setFleetSizeOverride] = useState(null)
  const [monthlyKmOverride, setMonthlyKmOverride] = useState(null)
  const [complianceSlider, setComplianceSlider] = useState(95)

  // ── Data state ────────────────────────────────────────────────────────────
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  // ── Fuel-exception approval state ─────────────────────────────────────────
  // A per-vehicle fuel-waste anomaly (row in "Fuel Savings Opportunities") is
  // the approval subject requiring management sign-off before a formal
  // exception report is issued. `reviewException` holds the open row; `wfLocked`
  // mirrors the shared engine state so the row's strongest action (Issue
  // Exception Report) is disabled while an approval is active/locked. The page
  // is aggregated read-only analytics, so — as DriverManagement did by driver
  // name — the exception is keyed by asset_no.
  const [reviewException, setReviewException] = useState(null)
  const [wfLocked, setWfLocked] = useState(false)
  // Reset the lock whenever a different vehicle exception (or none) is opened.
  useEffect(() => { setWfLocked(false) }, [reviewException?.asset_no])

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: recs, error: rErr } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,asset_no,serial_number,position,tread_depth,pressure_reading,risk_level,km_at_fitment,km_at_removal,site,country,brand,issue_date')
        // Null-safe country scope - never silently drop uncategorised rows
        if (activeCountry && activeCountry !== 'All') q = q.or(`country.eq.${activeCountry},country.is.null`)
        return q.range(from, to)
      })
      if (rErr) throw rErr
      setRecords(recs ?? [])
      setLastRefresh(new Date())
    } catch (e) {
      setError(e.message ?? 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Derived config values ─────────────────────────────────────────────────
  const derivedMonthlyKm = useMemo(() => deriveMonthlyKm(records), [records])
  const monthlyKm = monthlyKmOverride ?? derivedMonthlyKm
  const uniqueAssets = useMemo(() => [...new Set(records.map(r => r.asset_no).filter(Boolean))], [records])
  const fleetSize = fleetSizeOverride ?? uniqueAssets.length

  // ── Per-record fuel metrics ───────────────────────────────────────────────
  const enriched = useMemo(() => {
    return records.map(r => {
      const penalty = calcTyreFuelPenalty(r)
      const pressDev = calcPressureDev(r.pressure_reading)
      const underInflatedPct = pressDev * 100
      const extraFuelPctPerMonth = penalty
      const baseMonthlyFuel = (fleetConsumption / 100) * monthlyKm
      const extraFuelLitersMonth = baseMonthlyFuel * penalty
      const extraCostMonth = extraFuelLitersMonth * fuelCostPerLiter
      return {
        ...r,
        penalty,
        pressDev,
        underInflatedPct: +underInflatedPct.toFixed(1),
        extraFuelPctMonth: +(extraFuelPctPerMonth * 100).toFixed(2),
        extraFuelLitersMonth: +extraFuelLitersMonth.toFixed(1),
        extraCostMonth: +extraCostMonth.toFixed(2),
      }
    })
  }, [records, fleetConsumption, monthlyKm, fuelCostPerLiter])

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!enriched.length) return null
    const baseMonthlyFuelPerVehicle = (fleetConsumption / 100) * monthlyKm

    // Avg pressure deviation across all records with readings
    const withPressure = enriched.filter(r => r.pressure_reading > 0)
    const avgPressureDev = withPressure.length
      ? withPressure.reduce((s, r) => s + r.pressDev, 0) / withPressure.length
      : 0
    const avgDevPct = avgPressureDev * 100

    // Current compliance (records at or above nominal)
    const compliantCount = withPressure.filter(r => r.pressDev < 0.05).length
    const currentCompliancePct = withPressure.length ? (compliantCount / withPressure.length) * 100 : 0

    // Estimated monthly fuel loss (all vehicles aggregate)
    const totalExtraFuelMonth = enriched.reduce((s, r) => s + r.extraFuelLitersMonth, 0)
    const totalExtraCostMonth = enriched.reduce((s, r) => s + r.extraCostMonth, 0)

    // Potential saving if fleet reaches 95% compliance
    const improvementFraction = Math.max(0, (0.95 - currentCompliancePct / 100))
    const potentialFuelSavingMonth = improvementFraction * UNDER_INFLATION_FUEL_PCT_PER_10PCT * baseMonthlyFuelPerVehicle * fleetSize
    const potentialCostSavingAnnual = potentialFuelSavingMonth * fuelCostPerLiter * 12

    // Rolling resistance score (weighted, 0=perfect, 10=worst)
    const rrScore = Math.min(10, (avgDevPct / 10) * 10)

    // CO2 impact
    const co2Tonnes = (totalExtraFuelMonth * CO2_KG_PER_LITER) / 1000

    return {
      totalExtraCostMonth,
      rrScore: +rrScore.toFixed(1),
      potentialCostSavingAnnual,
      avgDevPct: +avgDevPct.toFixed(1),
      co2Tonnes: +co2Tonnes.toFixed(2),
      currentCompliancePct: +currentCompliancePct.toFixed(1),
      totalExtraFuelMonth: +totalExtraFuelMonth.toFixed(0),
      baseMonthlyFuelPerVehicle,
      improvementFraction,
    }
  }, [enriched, fleetSize, fleetConsumption, monthlyKm, fuelCostPerLiter])

  // ── Slider savings ────────────────────────────────────────────────────────
  const sliderSavings = useMemo(() => {
    if (!kpis) return { monthly: 0, annual: 0 }
    const currentComp = kpis.currentCompliancePct / 100
    const targetComp = complianceSlider / 100
    const improvement = Math.max(0, targetComp - currentComp)
    const monthly = improvement * UNDER_INFLATION_FUEL_PCT_PER_10PCT * kpis.baseMonthlyFuelPerVehicle * fleetSize * fuelCostPerLiter
    return { monthly: +monthly.toFixed(2), annual: +(monthly * 12).toFixed(2) }
  }, [kpis, complianceSlider, fleetSize, fuelCostPerLiter])

  // ── Per-vehicle aggregation ───────────────────────────────────────────────
  const vehicleMetrics = useMemo(() => {
    const map = {}
    for (const r of enriched) {
      if (!r.asset_no) continue
      if (!map[r.asset_no]) {
        map[r.asset_no] = {
          asset_no: r.asset_no,
          site: r.site ?? '-',
          tyreCount: 0,
          totalPressureDev: 0,
          pressureCount: 0,
          totalTreadPenalty: 0,
          totalExtraCostMonth: 0,
          treadReadings: [],
        }
      }
      const v = map[r.asset_no]
      v.tyreCount++
      v.totalExtraCostMonth += r.extraCostMonth
      if (r.pressure_reading > 0) {
        v.totalPressureDev += r.pressDev
        v.pressureCount++
      }
      const td = parseFloat(r.tread_depth)
      if (!isNaN(td)) v.treadReadings.push(td)
    }
    return Object.values(map).map(v => {
      const avgDevPct = v.pressureCount ? (v.totalPressureDev / v.pressureCount) * 100 : 0
      const avgTread = v.treadReadings.length ? v.treadReadings.reduce((s, x) => s + x, 0) / v.treadReadings.length : null
      const compliancePct = v.pressureCount
        ? ((v.pressureCount - Math.round(v.totalPressureDev * 20)) / v.pressureCount) * 100
        : 100
      return {
        ...v,
        avgDevPct: +avgDevPct.toFixed(1),
        avgTread: avgTread != null ? +avgTread.toFixed(1) : null,
        compliancePct: Math.max(0, Math.min(100, +compliancePct.toFixed(1))),
        annualExtraCost: +(v.totalExtraCostMonth * 12).toFixed(2),
      }
    }).sort((a, b) => b.totalExtraCostMonth - a.totalExtraCostMonth)
  }, [enriched])

  // ── Site aggregation ──────────────────────────────────────────────────────
  const siteMetrics = useMemo(() => {
    const map = {}
    for (const v of vehicleMetrics) {
      const s = v.site || 'Unknown'
      if (!map[s]) map[s] = { site: s, vehicles: 0, totalExtraCostMonth: 0, totalDevPct: 0, devCount: 0, treadSums: [] }
      map[s].vehicles++
      map[s].totalExtraCostMonth += v.totalExtraCostMonth
      if (v.avgDevPct > 0) { map[s].totalDevPct += v.avgDevPct; map[s].devCount++ }
      if (v.avgTread != null) map[s].treadSums.push(v.avgTread)
    }
    return Object.values(map).map(s => {
      const avgTread = s.treadSums.length ? s.treadSums.reduce((a, b) => a + b, 0) / s.treadSums.length : null
      const avgDevPct = s.devCount ? s.totalDevPct / s.devCount : 0
      const compliancePct = Math.max(0, Math.min(100, 100 - avgDevPct * 10))
      const extraFuelMonth = s.totalExtraCostMonth / fuelCostPerLiter
      return {
        ...s,
        avgDevPct: +avgDevPct.toFixed(1),
        compliancePct: +compliancePct.toFixed(1),
        avgTread: avgTread != null ? +avgTread.toFixed(1) : null,
        extraFuelMonth: +extraFuelMonth.toFixed(0),
        annualExtraCost: +(s.totalExtraCostMonth * 12).toFixed(0),
      }
    }).sort((a, b) => b.annualExtraCost - a.annualExtraCost)
  }, [vehicleMetrics, fuelCostPerLiter])

  // ── Tread scatter data ────────────────────────────────────────────────────
  const scatterData = useMemo(() => {
    const sites = [...new Set(enriched.map(r => r.site).filter(Boolean))]
    const datasets = sites.map((site, i) => ({
      label: site,
      data: enriched
        .filter(r => r.site === site && parseFloat(r.tread_depth) > 0)
        .slice(0, 200)
        .map(r => ({
          x: parseFloat(r.tread_depth),
          y: +(r.extraFuelPctMonth),
        })),
      backgroundColor: PALETTE[i % PALETTE.length] + '99',
      pointRadius: 4,
    }))

    // Trend line
    const allPts = enriched
      .filter(r => parseFloat(r.tread_depth) > 0)
      .map(r => ({ x: parseFloat(r.tread_depth), y: r.extraFuelPctMonth }))

    if (allPts.length >= 2) {
      const n = allPts.length
      const sx = allPts.reduce((s, p) => s + p.x, 0)
      const sy = allPts.reduce((s, p) => s + p.y, 0)
      const sxx = allPts.reduce((s, p) => s + p.x * p.x, 0)
      const sxy = allPts.reduce((s, p) => s + p.x * p.y, 0)
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
      const intercept = (sy - slope * sx) / n
      const xs = [1, 4, 8, 12]
      datasets.push({
        label: t('fuel.charts.trendSeries'),
        data: xs.map(x => ({ x, y: Math.max(0, slope * x + intercept) })),
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        showLine: true,
        pointRadius: 0,
        borderDash: [5, 5],
        type: 'line',
      })
    }

    return { datasets }
  }, [enriched, t])

  // ── Monthly trend (12 months) ─────────────────────────────────────────────
  const monthlyTrend = useMemo(() => {
    const months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      months.push({
        label: formatMonthYear(d),
        year: d.getFullYear(),
        month: d.getMonth(),
      })
    }

    return months.map(m => {
      const monthRecords = enriched.filter(r => {
        if (!r.issue_date) return false
        const d = new Date(r.issue_date)
        return d.getFullYear() === m.year && d.getMonth() === m.month
      })
      const totalExtraCost = monthRecords.reduce((s, r) => s + r.extraCostMonth, 0)
      const avgPenalty = monthRecords.length
        ? monthRecords.reduce((s, r) => s + r.extraFuelPctMonth, 0) / monthRecords.length
        : 0
      return { ...m, totalExtraCost, avgPenalty, count: monthRecords.length }
    })
  }, [enriched])

  // ── Doughnut - current compliance ─────────────────────────────────────────
  const complianceDoughnut = useMemo(() => {
    const comp = kpis?.currentCompliancePct ?? 0
    return {
      labels: [t('fuel.compliance.compliant'), t('fuel.compliance.nonCompliant')],
      datasets: [{
        data: [+comp.toFixed(1), +(100 - comp).toFixed(1)],
        backgroundColor: ['#10b981', '#ef4444'],
        borderWidth: 0,
      }],
    }
  }, [kpis, t])

  // ── Recommendations ───────────────────────────────────────────────────────
  const recommendations = useMemo(() => {
    if (!kpis || !siteMetrics.length) return []
    const recs = []
    const worst = siteMetrics[0]
    if (worst) {
      const saving = (0.95 - worst.compliancePct / 100) * UNDER_INFLATION_FUEL_PCT_PER_10PCT
        * (fleetConsumption / 100) * monthlyKm * worst.vehicles * fuelCostPerLiter
      if (saving > 0) {
        recs.push({
          icon: Fuel,
          color: 'text-amber-400',
          text: t('fuel.recommendations.siteCompliance', { site: worst.site, from: worst.compliancePct, value: fmtCur(saving, activeCurrency) }),
          impact: 'High',
        })
      }
    }
    const fleetRRSaving = 0.01 * (fleetConsumption / 100) * monthlyKm * fleetSize * fuelCostPerLiter * 12
    recs.push({
      icon: TrendingDown,
      color: 'text-green-400',
      text: t('fuel.recommendations.fleetRR', { value: fmtCur(fleetRRSaving, activeCurrency) }),
      impact: 'High',
    })
    const rotationSaving = 0.025 * (fleetConsumption / 100) * monthlyKm * fleetSize * fuelCostPerLiter * 12
    recs.push({
      icon: Activity,
      color: 'text-blue-400',
      text: t('fuel.recommendations.rotation', { value: fmtCur(rotationSaving, activeCurrency) }),
      impact: 'Medium',
    })
    const worn = enriched.filter(r => parseFloat(r.tread_depth) <= TREAD_WORN_MM).length
    if (worn > 0) {
      const wornCost = worn * WORN_TREAD_FUEL_PENALTY_PCT * (fleetConsumption / 100) * monthlyKm * fuelCostPerLiter
      recs.push({
        icon: AlertTriangle,
        color: 'text-red-400',
        text: t('fuel.recommendations.wornTread', { count: worn, value: fmtCur(wornCost, activeCurrency) }),
        impact: 'Critical',
      })
    }
    if (kpis.avgDevPct > 10) {
      recs.push({
        icon: Wind,
        color: 'text-purple-400',
        text: t('fuel.recommendations.pressureAudit', { pct: kpis.avgDevPct.toFixed(1) }),
        impact: 'High',
      })
    }
    return recs
  }, [kpis, siteMetrics, enriched, fleetSize, fleetConsumption, monthlyKm, fuelCostPerLiter, activeCurrency, t])

  // ── Environmental ─────────────────────────────────────────────────────────
  const envMetrics = useMemo(() => {
    if (!kpis) return null
    const co2Month = kpis.co2Tonnes
    const treesNeeded = Math.ceil(co2Month * 12 * TREES_PER_TONNE_CO2_YEAR)
    const extraFuelMonth = kpis.totalExtraFuelMonth
    const unnecessaryKm = fleetConsumption > 0 ? (extraFuelMonth / fleetConsumption) * 100 : 0
    return { co2Month, treesNeeded, unnecessaryKm: +unnecessaryKm.toFixed(0) }
  }, [kpis, fleetConsumption])

  // ── Top 10 savings opportunities ──────────────────────────────────────────
  const savingsOpportunities = useMemo(() => {
    return vehicleMetrics.slice(0, 10).map(v => {
      const potentialSaving = Math.max(0, v.totalExtraCostMonth * 0.8)
      return { ...v, potentialSaving: +potentialSaving.toFixed(2) }
    })
  }, [vehicleMetrics])

  // ── Export PDF ────────────────────────────────────────────────────────────
  const exportPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Fuel Efficiency Impact Report', `Fleet: ${fleetSize} vehicles`, company, brand)

    // ── Empty state: no site fuel-impact data ──
    if (siteMetrics.length === 0) {
      pdfEmptyState(doc, 'No site fuel-impact data for the current fleet')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save('TyrePulse_Fuel_Efficiency_Report.pdf')
      return
    }

    if (kpis) {
      doc.setTextColor(30, 30, 30)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('Key Performance Indicators', 14, 30)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      const kpiLines = [
        `Estimated Monthly Fuel Loss Cost: ${activeCurrency} ${fmt(kpis.totalExtraCostMonth, 2)}`,
        `Fleet Rolling Resistance Score: ${kpis.rrScore}/10`,
        `Potential Annual Fuel Savings: ${activeCurrency} ${fmt(kpis.potentialCostSavingAnnual, 2)}`,
        `Avg Pressure Deviation: ${kpis.avgDevPct}%`,
        `CO2 Impact: ${kpis.co2Tonnes} tonnes/month`,
        `Current Pressure Compliance: ${kpis.currentCompliancePct}%`,
      ]
      kpiLines.forEach((l, i) => doc.text(l, 14, 38 + i * 7))
    }

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 85,
      head: [['Site', 'Vehicles', 'Compliance %', 'Avg Tread (mm)', 'Extra Fuel/Month (L)', 'Extra Cost/Month', 'Annual Impact']],
      body: siteMetrics.map(s => [
        s.site,
        s.vehicles,
        `${s.compliancePct}%`,
        s.avgTread ?? 'N/A',
        fmt(s.extraFuelMonth),
        `${activeCurrency} ${fmt(s.totalExtraCostMonth, 2)}`,
        `${activeCurrency} ${fmt(s.annualExtraCost)}`,
      ]),
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save('TyrePulse_Fuel_Efficiency_Report.pdf')
  }, [kpis, siteMetrics, fleetSize, activeCurrency, branding, company])

  // ── Export Excel ──────────────────────────────────────────────────────────
  const exportExcel = useCallback(async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    const vehicleRows = vehicleMetrics.map(v => ({
      'Asset No': v.asset_no,
      'Site': v.site,
      'Tyres': v.tyreCount,
      'Avg Pressure Dev %': v.avgDevPct,
      'Compliance %': v.compliancePct,
      'Avg Tread (mm)': v.avgTread ?? '',
      'Monthly Extra Fuel (L)': fmt(v.totalExtraCostMonth / fuelCostPerLiter, 1),
      'Monthly Extra Cost (R)': v.totalExtraCostMonth,
      'Annual Extra Cost (R)': v.annualExtraCost,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vehicleRows), 'Vehicles')

    const siteRows = siteMetrics.map(s => ({
      'Site': s.site,
      'Vehicles': s.vehicles,
      'Compliance %': s.compliancePct,
      'Avg Tread (mm)': s.avgTread ?? '',
      'Extra Fuel/Month (L)': s.extraFuelMonth,
      'Monthly Extra Cost (R)': s.totalExtraCostMonth,
      'Annual Impact (R)': s.annualExtraCost,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(siteRows), 'Sites')

    XLSX.writeFile(wb, 'TyrePulse_Fuel_Efficiency.xlsx')
  }, [vehicleMetrics, siteMetrics, fuelCostPerLiter])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="text-[var(--text-primary)] space-y-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <PageHeader
        title={t('fuel.title')}
        subtitle={t('fuel.subtitle')}
        icon={Fuel}
        actions={<>
          {lastRefresh && (
            <span className="text-xs text-muted">
              {t('fuel.actions.updated', { time: lastRefresh.toLocaleTimeString() })}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('fuel.actions.refresh')}
          </button>
          <button
            onClick={exportPDF}
            className="btn-secondary gap-1.5"
          >
            <FileText className="w-4 h-4" />
            {t('fuel.actions.pdf')}
          </button>
          <button
            onClick={exportExcel}
            className="btn-secondary gap-1.5"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {t('fuel.actions.excel')}
          </button>
        </>}
      />

      {/* ── Estimate disclosure ───────────────────────────────────────────── */}
      <div className="bg-amber-900/20 border border-amber-700/50 text-amber-200 rounded-xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 mt-0.5 shrink-0 text-amber-400" />
        <div className="text-sm leading-relaxed">
          <span className="font-semibold">{t('fuel.disclosure.title')}</span>{' '}
          {t('fuel.disclosure.body', { rate: fmtCur(fuelCostPerLiter, activeCurrency), consumption: fleetConsumption })}
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-xl p-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
        </div>
      )}

      {!loading && (
        <>
          {/* ── 1. Configuration Panel ──────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl overflow-hidden"
          >
            <button
              onClick={() => setConfigOpen(o => !o)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-[var(--surface-2)] transition-colors"
            >
              <span className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                <Settings2 className="w-5 h-5 text-amber-400" />
                {t('fuel.config.heading')}
              </span>
              {configOpen ? <ChevronUp className="w-5 h-5 text-[var(--text-secondary)]" /> : <ChevronDown className="w-5 h-5 text-[var(--text-secondary)]" />}
            </button>
            <AnimatePresence initial={false}>
              {configOpen && (
                <motion.div
                  key="config"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-[var(--border-dim)]">
                    <ConfigField
                      label={t('fuel.config.fuelCostPerLiter', { currency: activeCurrency })}
                      value={fuelCostPerLiter}
                      onChange={v => setFuelCostPerLiter(+v)}
                      step={0.5}
                      min={1}
                    />
                    <ConfigField
                      label={t('fuel.config.fleetConsumption')}
                      value={fleetConsumption}
                      onChange={v => setFleetConsumption(+v)}
                      step={1}
                      min={5}
                    />
                    <ConfigField
                      label={t('fuel.config.fleetSize', { count: uniqueAssets.length })}
                      value={fleetSizeOverride ?? uniqueAssets.length}
                      onChange={v => setFleetSizeOverride(+v || null)}
                      step={1}
                      min={1}
                    />
                    <ConfigField
                      label={t('fuel.config.monthlyKm', { km: derivedMonthlyKm })}
                      value={monthlyKmOverride ?? derivedMonthlyKm}
                      onChange={v => setMonthlyKmOverride(+v || null)}
                      step={500}
                      min={100}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ── 2. KPI Cards ───────────────────────────────────────────────── */}
          {kpis && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <KpiCard
                label={t('fuel.kpi.monthlyLoss')}
                value={fmtCur(kpis.totalExtraCostMonth, activeCurrency)}
                sub={t('fuel.kpi.monthlyLossSub', { liters: fmt(kpis.totalExtraFuelMonth) })}
                icon={Fuel}
                color="amber"
                trend="down"
              />
              <KpiCard
                label={t('fuel.kpi.rrScore')}
                value={`${kpis.rrScore}/10`}
                sub={t('fuel.kpi.rrScoreSub')}
                icon={Activity}
                color={kpis.rrScore < 3 ? 'green' : kpis.rrScore < 6 ? 'amber' : 'red'}
              />
              <KpiCard
                label={t('fuel.kpi.potentialSavings')}
                value={fmtCur(kpis.potentialCostSavingAnnual, activeCurrency)}
                sub={t('fuel.kpi.potentialSavingsSub')}
                icon={TrendingDown}
                color="green"
                trend="up"
              />
              <KpiCard
                label={t('fuel.kpi.avgDeviation')}
                value={`${kpis.avgDevPct}%`}
                sub={t('fuel.kpi.avgDeviationSub', { pct: kpis.currentCompliancePct })}
                icon={Wind}
                color={kpis.avgDevPct < 5 ? 'green' : kpis.avgDevPct < 10 ? 'amber' : 'red'}
              />
              <KpiCard
                label={t('fuel.kpi.co2Impact')}
                value={`${kpis.co2Tonnes}t`}
                sub={t('fuel.kpi.co2ImpactSub')}
                icon={Leaf}
                color="blue"
              />
            </div>
          )}

          {/* ── 3. Pressure vs Fuel Calculator ──────────────────────────── */}
          {kpis && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid md:grid-cols-2 gap-4"
            >
              {/* Compliance doughnut */}
              <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5">
                <h3 className="font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                  <BarChart2 className="w-5 h-5 text-blue-400" />
                  {t('fuel.compliance.heading')}
                </h3>
                <div className="flex items-center gap-6">
                  <div className="w-40 h-40 shrink-0">
                    <Doughnut
                      data={complianceDoughnut}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '75%',
                        plugins: {
                          legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 11 } } },
                          tooltip: { backgroundColor: 'var(--panel)', titleColor: '#f9fafb', bodyColor: '#d1d5db' },
                        },
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[var(--text-secondary)] text-xs">{t('fuel.compliance.compliantTyres')}</p>
                      <p className="text-2xl font-bold text-green-400">{kpis.currentCompliancePct}%</p>
                    </div>
                    <div>
                      <p className="text-[var(--text-secondary)] text-xs">{t('fuel.compliance.avgDeviationFromNominal')}</p>
                      <p className="text-2xl font-bold text-amber-400">{kpis.avgDevPct}%</p>
                    </div>
                    <div>
                      <p className="text-[var(--text-secondary)] text-xs">{t('fuel.compliance.nominalPressure')}</p>
                      <p className="text-lg font-semibold text-[var(--text-secondary)]">{NOMINAL_PRESSURE_PSI}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Savings slider */}
              <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5">
                <h3 className="font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-400" />
                  {t('fuel.calculator.heading')}
                </h3>
                <div className="space-y-5">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-[var(--text-secondary)]">{t('fuel.calculator.current', { pct: kpis.currentCompliancePct })}</span>
                      <span className="text-[var(--text-secondary)]">{t('fuel.calculator.target', { pct: complianceSlider })}</span>
                    </div>
                    <input
                      type="range"
                      min={Math.ceil(kpis.currentCompliancePct)}
                      max={99}
                      value={complianceSlider}
                      onChange={e => setComplianceSlider(+e.target.value)}
                      className="w-full h-2 bg-[var(--surface-3)] rounded-lg appearance-none cursor-pointer accent-amber-400"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[var(--surface-2)] rounded-xl p-4">
                      <p className="text-[var(--text-secondary)] text-xs mb-1">{t('fuel.calculator.monthlySaving')}</p>
                      <p className="text-xl font-bold text-green-400">{fmtCur(sliderSavings.monthly, activeCurrency)}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{t('fuel.calculator.litersSaved', { liters: fmt(fuelCostPerLiter > 0 ? sliderSavings.monthly / fuelCostPerLiter : 0, 0) })}</p>
                    </div>
                    <div className="bg-[var(--surface-2)] rounded-xl p-4">
                      <p className="text-[var(--text-secondary)] text-xs mb-1">{t('fuel.calculator.annualSaving')}</p>
                      <p className="text-xl font-bold text-green-400">{fmtCur(sliderSavings.annual, activeCurrency)}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{t('fuel.calculator.litersSaved', { liters: fmt(sliderSavings.annual / fuelCostPerLiter, 0) })}</p>
                    </div>
                  </div>
                  <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-3 text-xs text-blue-300">
                    {t('fuel.calculator.formula', { liters: fmt(kpis.baseMonthlyFuelPerVehicle, 0), fleetSize })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── 4. Rolling Resistance by Vehicle ───────────────────────── */}
          {vehicleMetrics.length > 0 && (
            <ChartCard title={t('fuel.charts.rrByVehicle')} subtitle={t('fuel.charts.rrByVehicleSub')} icon={BarChart2}>
              <div className="h-72">
                <Bar
                  data={{
                    labels: vehicleMetrics.slice(0, 20).map(v => v.asset_no),
                    datasets: [{
                      label: t('fuel.charts.extraCostSeries', { currency: activeCurrency }),
                      data: vehicleMetrics.slice(0, 20).map(v => v.totalExtraCostMonth),
                      backgroundColor: vehicleMetrics.slice(0, 20).map(v =>
                        v.totalExtraCostMonth > 500 ? '#ef4444cc' : v.totalExtraCostMonth > 200 ? '#f59e0bcc' : '#3b82f6cc'
                      ),
                      borderRadius: 4,
                    }],
                  }}
                  options={{
                    ...CHART_OPTS,
                    plugins: {
                      ...CHART_OPTS.plugins,
                      tooltip: {
                        ...CHART_OPTS.plugins.tooltip,
                        callbacks: {
                          afterLabel: (ctx) => {
                            const v = vehicleMetrics[ctx.dataIndex]
                            if (!v) return ''
                            return [
                              t('fuel.charts.tooltipPressureDev', { pct: v.avgDevPct }),
                              t('fuel.charts.tooltipAvgTread', { value: v.avgTread ?? t('fuel.na') }),
                              t('fuel.charts.tooltipCompliance', { pct: v.compliancePct }),
                            ]
                          },
                          label: ctx => t('fuel.charts.tooltipExtraMonth', { currency: activeCurrency, value: fmt(ctx.raw, 2) }),
                        },
                      },
                    },
                  }}
                />
              </div>
            </ChartCard>
          )}

          {/* ── 5. Tread Depth vs Fuel Correlation ──────────────────────── */}
          {scatterData.datasets.length > 0 && (
            <ChartCard title={t('fuel.charts.treadCorrelation')} subtitle={t('fuel.charts.treadCorrelationSub')} icon={Activity}>
              <div className="h-72">
                <Scatter
                  data={scatterData}
                  options={{
                    ...CHART_OPTS,
                    plugins: {
                      ...CHART_OPTS.plugins,
                      tooltip: {
                        ...CHART_OPTS.plugins.tooltip,
                        callbacks: {
                          label: ctx => t('fuel.charts.tooltipTreadFuel', { x: ctx.parsed.x, y: ctx.parsed.y.toFixed(2) }),
                        },
                      },
                    },
                    scales: {
                      x: { ...CHART_OPTS.scales.x, title: { display: true, text: t('fuel.charts.axisTreadDepth'), color: '#9ca3af' } },
                      y: { ...CHART_OPTS.scales.y, title: { display: true, text: t('fuel.charts.axisFuelImpact'), color: '#9ca3af' } },
                    },
                  }}
                />
              </div>
            </ChartCard>
          )}

          {/* ── 6. Site Fuel Impact Table ───────────────────────────────── */}
          {siteMetrics.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-[var(--border-dim)] flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-400" />
                <h3 className="font-semibold text-[var(--text-primary)]">{t('fuel.siteTable.heading')}</h3>
                <span className="ml-auto text-xs text-[var(--text-muted)]">{t('fuel.siteTable.sortedBy')}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[var(--surface-2)] text-[var(--text-secondary)] text-xs uppercase tracking-wide">
                      <th className="px-4 py-3 text-left">{t('fuel.siteTable.columns.site')}</th>
                      <th className="px-4 py-3 text-right">{t('fuel.siteTable.columns.vehicles')}</th>
                      <th className="px-4 py-3 text-right">{t('fuel.siteTable.columns.pressureCompliance')}</th>
                      <th className="px-4 py-3 text-right">{t('fuel.siteTable.columns.avgTread')}</th>
                      <th className="px-4 py-3 text-right">{t('fuel.siteTable.columns.extraFuelMonth')}</th>
                      <th className="px-4 py-3 text-right">{t('fuel.siteTable.columns.monthlyExtraCost')}</th>
                      <th className="px-4 py-3 text-right">{t('fuel.siteTable.columns.annualImpact')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-dim)]">
                    {siteMetrics.map((s, i) => (
                      <tr key={s.site} className="hover:bg-[var(--surface-2)] transition-colors">
                        <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{s.site}</td>
                        <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{s.vehicles}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-medium ${s.compliancePct >= 90 ? 'text-green-400' : s.compliancePct >= 75 ? 'text-amber-400' : 'text-red-400'}`}>
                            {s.compliancePct}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {s.avgTread != null
                            ? <span className={s.avgTread <= 3 ? 'text-red-400' : s.avgTread <= 5 ? 'text-amber-400' : 'text-green-400'}>{s.avgTread}</span>
                            : <span className="text-[var(--text-muted)]">{t('fuel.na')}</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{fmt(s.extraFuelMonth)}</td>
                        <td className="px-4 py-3 text-right text-amber-400 font-medium">{fmtCur(s.totalExtraCostMonth, activeCurrency)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold ${i === 0 ? 'text-red-400' : i === 1 ? 'text-orange-400' : 'text-[var(--text-secondary)]'}`}>
                            {fmtCur(s.annualExtraCost, activeCurrency)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--surface-2)] font-semibold text-[var(--text-primary)]">
                      <td className="px-4 py-3">{t('fuel.siteTable.total')}</td>
                      <td className="px-4 py-3 text-right">{siteMetrics.reduce((s, r) => s + r.vehicles, 0)}</td>
                      <td className="px-4 py-3 text-right">-</td>
                      <td className="px-4 py-3 text-right">-</td>
                      <td className="px-4 py-3 text-right">{fmt(siteMetrics.reduce((s, r) => s + r.extraFuelMonth, 0))}</td>
                      <td className="px-4 py-3 text-right text-amber-400">{fmtCur(siteMetrics.reduce((s, r) => s + r.totalExtraCostMonth, 0), activeCurrency)}</td>
                      <td className="px-4 py-3 text-right text-red-400">{fmtCur(siteMetrics.reduce((s, r) => s + r.annualExtraCost, 0), activeCurrency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </motion.div>
          )}

          {/* ── 7. Fuel Savings Opportunities ──────────────────────────── */}
          {savingsOpportunities.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-[var(--border-dim)] flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-green-400" />
                <h3 className="font-semibold text-[var(--text-primary)]">{t('fuel.opportunitiesTable.heading')}</h3>
                <span className="ml-auto text-xs text-[var(--text-muted)]">{t('fuel.opportunitiesTable.sortedBy')}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[var(--surface-2)] text-[var(--text-secondary)] text-xs uppercase tracking-wide">
                      <th className="px-4 py-3 text-left">{t('fuel.opportunitiesTable.columns.rank')}</th>
                      <th className="px-4 py-3 text-left">{t('fuel.opportunitiesTable.columns.asset')}</th>
                      <th className="px-4 py-3 text-left">{t('fuel.opportunitiesTable.columns.site')}</th>
                      <th className="px-4 py-3 text-right">{t('fuel.opportunitiesTable.columns.compliance')}</th>
                      <th className="px-4 py-3 text-right">{t('fuel.opportunitiesTable.columns.avgTread')}</th>
                      <th className="px-4 py-3 text-right">{t('fuel.opportunitiesTable.columns.monthlyWaste')}</th>
                      <th className="px-4 py-3 text-right">{t('fuel.opportunitiesTable.columns.potentialSaving')}</th>
                      <th className="px-4 py-3 text-right">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-dim)]">
                    {savingsOpportunities.map((v, i) => (
                      <tr key={v.asset_no} className="hover:bg-[var(--surface-2)] transition-colors">
                        <td className="px-4 py-3 text-[var(--text-muted)] font-mono">{i + 1}</td>
                        <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">{v.asset_no}</td>
                        <td className="px-4 py-3 text-[var(--text-secondary)]">{v.site}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={v.compliancePct >= 90 ? 'text-green-400' : v.compliancePct >= 75 ? 'text-amber-400' : 'text-red-400'}>
                            {v.compliancePct}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {v.avgTread != null
                            ? <span className={v.avgTread <= 3 ? 'text-red-400' : v.avgTread <= 5 ? 'text-amber-400' : 'text-[var(--text-secondary)]'}>{v.avgTread}mm</span>
                            : <span className="text-[var(--text-muted)]">{t('fuel.na')}</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-red-400">{fmtCur(v.totalExtraCostMonth, activeCurrency)}</td>
                        <td className="px-4 py-3 text-right text-green-400 font-semibold">{fmtCur(v.potentialSaving, activeCurrency)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setReviewException(v)}
                            title="Review fuel exception & manage approval"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-300 hover:text-amber-200 transition-colors"
                            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* ── 8. Year-over-Year Fuel Impact Trend ─────────────────────── */}
          {monthlyTrend.length > 0 && (
            <ChartCard
              title={t('fuel.charts.trend12Month')}
              subtitle={t('fuel.charts.trend12MonthSub')}
              icon={TrendingUp}
            >
              <div className="h-72">
                <Line
                  data={{
                    labels: monthlyTrend.map(m => m.label),
                    datasets: [
                      {
                        label: t('fuel.charts.monthlyExtraFuelCostSeries', { currency: activeCurrency }),
                        data: monthlyTrend.map(m => m.totalExtraCost),
                        borderColor: '#f59e0b',
                        backgroundColor: '#f59e0b22',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointBackgroundColor: '#f59e0b',
                      },
                    ],
                  }}
                  options={{
                    ...CHART_OPTS,
                    plugins: {
                      ...CHART_OPTS.plugins,
                      tooltip: {
                        ...CHART_OPTS.plugins.tooltip,
                        callbacks: {
                          label: ctx => t('fuel.charts.tooltipCurrencyValue', { currency: activeCurrency, value: fmt(ctx.raw, 2) }),
                          afterLabel: ctx => {
                            const m = monthlyTrend[ctx.dataIndex]
                            return t('fuel.charts.tooltipRecordsAvgPenalty', { count: m.count, pct: m.avgPenalty.toFixed(2) })
                          },
                        },
                      },
                    },
                  }}
                />
              </div>
            </ChartCard>
          )}

          {/* ── 9. Environmental Impact ──────────────────────────────────── */}
          {envMetrics && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5"
            >
              <h3 className="font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <Leaf className="w-5 h-5 text-green-400" />
                {t('fuel.env.heading')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <EnvCard
                  icon={Wind}
                  color="blue"
                  value={t('fuel.env.co2Value', { tonnes: envMetrics.co2Month })}
                  label={t('fuel.env.co2Label')}
                  sub={t('fuel.env.co2Sub', { kg: fmt(envMetrics.co2Month * CO2_KG_PER_LITER * 1000, 0) })}
                />
                <EnvCard
                  icon={Leaf}
                  color="green"
                  value={fmt(envMetrics.treesNeeded)}
                  label={t('fuel.env.treesLabel')}
                  sub={t('fuel.env.treesSub')}
                />
                <EnvCard
                  icon={Fuel}
                  color="amber"
                  value={t('fuel.env.kmValue', { km: fmt(envMetrics.unnecessaryKm) })}
                  label={t('fuel.env.kmLabel')}
                  sub={t('fuel.env.kmSub')}
                />
              </div>
            </motion.div>
          )}

          {/* ── 10. Recommendations ─────────────────────────────────────── */}
          {recommendations.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-[var(--border-dim)] flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                <h3 className="font-semibold text-[var(--text-primary)]">{t('fuel.recommendations.heading')}</h3>
                <span className="ml-auto text-xs text-[var(--text-muted)]">{t('fuel.recommendations.autoGenerated')}</span>
              </div>
              <div className="divide-y divide-[var(--border-dim)]">
                {recommendations.map((r, i) => (
                  <div key={i} className="px-5 py-4 flex items-start gap-4">
                    <div className="mt-0.5">
                      <r.icon className={`w-5 h-5 ${r.color}`} />
                    </div>
                    <div className="flex-1">
                      <p className="text-[var(--text-primary)] text-sm">{r.text}</p>
                    </div>
                    <ImpactBadge impact={r.impact} />
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Empty state ──────────────────────────────────────────────── */}
          {!loading && !error && records.length === 0 && (
            <div className="text-center py-24 text-[var(--text-muted)]">
              <Fuel className="w-16 h-16 mx-auto mb-4 text-[var(--text-dim)]" />
              <p className="text-lg font-medium text-[var(--text-secondary)]">{t('fuel.empty.title')}</p>
              <p className="text-sm mt-1">{t('fuel.empty.subtitle')}</p>
            </div>
          )}
        </>
      )}

      {/* ── Fuel Exception Review & Approval Modal ─────────────────────────────
          The reviewed vehicle row is the fuel-waste anomaly document under
          management review. The shared Approval & Workflow Engine drives status,
          the immutable trail, and requirement-gated actions; the page gates its
          strongest action — issuing the formal exception report — while the
          approval is active/locked. ──────────────────────────────────────── */}
      <AnimatePresence>
        {reviewException && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setReviewException(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 16 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl"
            >
              <div className="sticky top-0 bg-[var(--surface-1)] border-b border-[var(--border-dim)] px-6 py-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                  <div>
                    <h2 className="text-[var(--text-primary)] font-bold text-lg leading-tight">
                      {`Fuel Exception — ${reviewException.asset_no}`}
                    </h2>
                    <p className="text-xs text-[var(--text-muted)]">
                      {reviewException.site} · {fmtCur(reviewException.totalExtraCostMonth, activeCurrency)}/mo
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setReviewException(null)}
                  className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Anomaly snapshot */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <ExceptionStat label="Compliance" value={`${reviewException.compliancePct}%`} />
                  <ExceptionStat label="Avg Tread" value={reviewException.avgTread != null ? `${reviewException.avgTread}mm` : t('fuel.na')} />
                  <ExceptionStat label="Monthly Waste" value={fmtCur(reviewException.totalExtraCostMonth, activeCurrency)} />
                  <ExceptionStat label="Annual Impact" value={fmtCur(reviewException.annualExtraCost, activeCurrency)} />
                </div>

                {/* Shared approval engine — keyed by asset_no (aggregated data) */}
                <EntityApprovalPanel
                  entityType="fuel_exception"
                  entityId={reviewException.asset_no}
                  entityLabel={reviewException.asset_no}
                  context={{
                    variance: reviewException.avgDevPct,
                    cost: Math.round(reviewException.totalExtraCostMonth || 0),
                    deviation_pct: reviewException.avgDevPct,
                    compliance_pct: reviewException.compliancePct,
                    avg_tread_mm: reviewException.avgTread,
                    annual_cost: Math.round(reviewException.annualExtraCost || 0),
                    site: reviewException.site,
                  }}
                  onStateChange={(s) => setWfLocked(!!(s?.isActive || s?.isLocked))}
                  title="Fuel Exception Approval"
                />

                {/* Strongest action — gated while approval is active/locked */}
                <div className="flex items-center justify-between gap-3 pt-1">
                  {wfLocked ? (
                    <span className="flex items-center gap-1.5 text-xs text-[var(--accent)]">
                      <Lock className="w-3.5 h-3.5" />
                      Locked — in approval
                    </span>
                  ) : <span />}
                  <button
                    onClick={() => { if (!wfLocked) exportPDF() }}
                    disabled={wfLocked}
                    title={wfLocked ? 'Locked — in approval' : 'Issue formal fuel exception report'}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-300 hover:text-amber-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}
                  >
                    {wfLocked ? <Lock className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                    Issue Exception Report
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ExceptionStat({ label, value }) {
  return (
    <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg px-3 py-2">
      <p className="text-[var(--text-muted)] text-[11px] uppercase tracking-wide">{label}</p>
      <p className="text-[var(--text-primary)] text-sm font-semibold mt-0.5">{value}</p>
    </div>
  )
}

function ConfigField({ label, value, onChange, step = 1, min = 0 }) {
  return (
    <div className="pt-4">
      <label className="block text-xs text-[var(--text-secondary)] mb-1.5">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        step={step}
        min={min}
        className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-amber-500 transition-colors"
      />
    </div>
  )
}

const COLOR_MAP = {
  amber: { bg: 'bg-amber-900/20', border: 'border-amber-800/50', icon: 'text-amber-400', value: 'text-amber-400' },
  green: { bg: 'bg-green-900/20', border: 'border-green-800/50', icon: 'text-green-400', value: 'text-green-400' },
  red: { bg: 'bg-red-900/20', border: 'border-red-800/50', icon: 'text-red-400', value: 'text-red-400' },
  blue: { bg: 'bg-blue-900/20', border: 'border-blue-800/50', icon: 'text-blue-400', value: 'text-blue-400' },
}

function KpiCard({ label, value, sub, icon: Icon, color = 'blue', trend }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.blue
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`${c.bg} border ${c.border} rounded-xl p-4 flex flex-col gap-2`}
    >
      <div className="flex items-center justify-between">
        <Icon className={`w-5 h-5 ${c.icon}`} />
        {trend === 'up' && <ArrowUpRight className="w-4 h-4 text-green-400" />}
        {trend === 'down' && <ArrowDownRight className="w-4 h-4 text-red-400" />}
      </div>
      <p className={`text-xl font-bold ${c.value}`}>{value}</p>
      <p className="text-[var(--text-secondary)] text-xs font-medium leading-tight">{label}</p>
      {sub && <p className="text-[var(--text-muted)] text-xs">{sub}</p>}
    </motion.div>
  )
}

function ChartCard({ title, subtitle, icon: Icon, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5"
    >
      <div className="mb-4">
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Icon className="w-5 h-5 text-blue-400" />
          {title}
        </h3>
        {subtitle && <p className="text-[var(--text-muted)] text-xs mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </motion.div>
  )
}

function EnvCard({ icon: Icon, color, value, label, sub }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.blue
  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-5 flex items-start gap-4`}>
      <Icon className={`w-8 h-8 ${c.icon} mt-1 shrink-0`} />
      <div>
        <p className={`text-2xl font-bold ${c.value}`}>{value}</p>
        <p className="text-[var(--text-secondary)] text-sm font-medium">{label}</p>
        <p className="text-[var(--text-muted)] text-xs mt-0.5">{sub}</p>
      </div>
    </div>
  )
}

function ImpactBadge({ impact }) {
  const { t } = useLanguage()
  const cls = {
    Critical: 'bg-red-900/40 text-red-400 border-red-800',
    High: 'bg-orange-900/40 text-orange-400 border-orange-800',
    Medium: 'bg-amber-900/40 text-amber-400 border-amber-800',
    Low: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]',
  }[impact] ?? 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
  return (
    <span className={`shrink-0 text-xs border rounded-full px-2.5 py-0.5 font-medium ${cls}`}>
      {t(`fuel.impact.${impact.toLowerCase()}`)}
    </span>
  )
}
