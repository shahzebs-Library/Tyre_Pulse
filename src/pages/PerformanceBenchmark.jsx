// ─────────────────────────────────────────────────────────────────────────────
// PerformanceBenchmark.jsx — Fleet vs Industry Benchmarking · /benchmark
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  RadialLinearScale,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Radar, Doughnut } from 'react-chartjs-2'
import {
  Target, TrendingUp, TrendingDown, Award, Minus,
  BarChart2, Loader2, RefreshCw, Download, FileSpreadsheet, FileText,
  Star, AlertTriangle, CheckCircle, Info, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import { computeAllKpis, computeCpkByBrand } from '../lib/kpiEngine'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  RadialLinearScale,
  Title, Tooltip, Legend, Filler,
)

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: '#111827', borderColor: '#374151', borderWidth: 1, titleColor: '#f9fafb', bodyColor: '#d1d5db' },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
  },
}

// ── Industry benchmarks (truck/heavy fleet, Southern Africa) ──────────────────
const BENCHMARKS = {
  cpk: {
    label: 'Cost Per Kilometer (CPK)',
    unit: '/km',
    world_class: 0.80,
    good: 1.20,
    average: 1.80,
    poor: 2.50,
    description: 'Amount spent per kilometre on tyre costs. Lower is better.',
    format: (v, cur = 'SAR') => typeof v === 'number' && isFinite(v) ? `${cur} ${v.toFixed(2)}/km` : 'N/A',
  },
  tyre_life: {
    label: 'Average Tyre Life',
    unit: 'km',
    world_class: 150000,
    good: 100000,
    average: 70000,
    poor: 45000,
    description: 'Average distance per tyre before removal. Higher is better.',
    format: (v) => typeof v === 'number' && isFinite(v) ? `${(v / 1000).toFixed(0)}k km` : 'N/A',
    higherIsBetter: true,
  },
  failure_rate: {
    label: 'Failure Rate',
    unit: '%',
    world_class: 3,
    good: 8,
    average: 15,
    poor: 25,
    description: 'Percentage of tyres removed due to failure (not wear-out). Lower is better.',
    format: (v) => typeof v === 'number' && isFinite(v) ? `${v.toFixed(1)}%` : 'N/A',
  },
  pressure_compliance: {
    label: 'Pressure Compliance',
    unit: '%',
    world_class: 97,
    good: 92,
    average: 85,
    poor: 70,
    description: 'Percentage of inspections with pressure within ±10% spec. Higher is better.',
    format: (v) => typeof v === 'number' && isFinite(v) ? `${v.toFixed(1)}%` : 'N/A',
    higherIsBetter: true,
  },
  scrap_rate: {
    label: 'Scrap Rate',
    unit: '%',
    world_class: 5,
    good: 12,
    average: 20,
    poor: 35,
    description: 'Percentage of removed tyres that are scrapped vs retreaded. Lower is better.',
    format: (v) => typeof v === 'number' && isFinite(v) ? `${v.toFixed(1)}%` : 'N/A',
  },
  inspection_compliance: {
    label: 'Inspection Compliance',
    unit: '%',
    world_class: 98,
    good: 92,
    average: 80,
    poor: 65,
    description: 'Percentage of scheduled inspections completed. Higher is better.',
    format: (v) => typeof v === 'number' && isFinite(v) ? `${v.toFixed(1)}%` : 'N/A',
    higherIsBetter: true,
  },
}

function getBenchmarkRating(key, value) {
  const b = BENCHMARKS[key]
  if (!b || typeof value !== 'number' || !isFinite(value)) return { rating: 'N/A', score: 0, color: 'text-gray-400' }
  const better = b.higherIsBetter
  if (better) {
    if (value >= b.world_class)  return { rating: 'World Class', score: 100, color: 'text-green-400' }
    if (value >= b.good)        return { rating: 'Good', score: 75, color: 'text-blue-400' }
    if (value >= b.average)     return { rating: 'Average', score: 50, color: 'text-yellow-400' }
    if (value >= b.poor)        return { rating: 'Below Average', score: 25, color: 'text-orange-400' }
    return { rating: 'Poor', score: 10, color: 'text-red-400' }
  } else {
    if (value <= b.world_class) return { rating: 'World Class', score: 100, color: 'text-green-400' }
    if (value <= b.good)        return { rating: 'Good', score: 75, color: 'text-blue-400' }
    if (value <= b.average)     return { rating: 'Average', score: 50, color: 'text-yellow-400' }
    if (value <= b.poor)        return { rating: 'Below Average', score: 25, color: 'text-orange-400' }
    return { rating: 'Poor', score: 10, color: 'text-red-400' }
  }
}

function DeltaIcon({ better }) {
  if (better === null) return <Minus size={14} className="text-gray-500" />
  return better
    ? <ArrowUpRight size={14} className="text-green-400" />
    : <ArrowDownRight size={14} className="text-red-400" />
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PerformanceBenchmark() {
  const { activeCountry } = useSettings()
  const [records, setRecords]      = useState([])
  const [inspections, setInspections] = useState([])
  const [loading, setLoading]      = useState(true)
  const [error, setError]          = useState(null)
  const [period, setPeriod]        = useState('1yr')
  const [site, setSite]            = useState('All')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const country = activeCountry !== 'All' ? activeCountry : null
      const daysBack = period === '90d' ? 90 : period === '6m' ? 180 : period === '1yr' ? 365 : 730
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack)
      const from = cutoff.toISOString()

      let q = supabase.from('tyre_records').select('*').gte('created_at', from)
      if (country) q = q.eq('country', country)
      const [tr, insp] = await Promise.all([
        q,
        supabase.from('inspections').select('*').gte('inspection_date', from.slice(0, 10)),
      ])
      setRecords(tr.data || [])
      setInspections(insp.data || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [activeCountry, period])

  useEffect(() => { load() }, [load])

  const sites = useMemo(() => ['All', ...new Set(records.map(r => r.site).filter(Boolean))], [records])

  const filtered = useMemo(() => {
    if (site === 'All') return records
    return records.filter(r => r.site === site)
  }, [records, site])

  // ── Fleet KPIs ────────────────────────────────────────────────────────────
  const fleetKpis = useMemo(() => {
    if (!filtered.length) return null
    const kpis = computeAllKpis(filtered, inspections)

    // Scrap rate
    const totalRec = filtered.length
    const scrapCount = filtered.filter(r =>
      r.category === 'Scrap' || r.risk_level === 'Critical' || r.removal_reason?.toLowerCase().includes('scrap')
    ).length
    const scrapRate = totalRec ? (scrapCount / totalRec) * 100 : 0

    // Pressure compliance from inspections
    const withPressure = inspections.filter(r => r.pressure_reading != null && r.recommended_pressure != null)
    const pressureFails = withPressure.filter(r =>
      Math.abs((parseFloat(r.pressure_reading) - parseFloat(r.recommended_pressure)) / parseFloat(r.recommended_pressure)) * 100 > 10
    )
    const pressureCompliance = withPressure.length ? ((withPressure.length - pressureFails.length) / withPressure.length) * 100 : 95

    // Avg tyre life
    const withLife = filtered.filter(r => r.km_at_removal && r.km_at_fitment && r.km_at_removal > r.km_at_fitment)
    const avgLife = withLife.length
      ? withLife.reduce((s, r) => s + (r.km_at_removal - r.km_at_fitment), 0) / withLife.length
      : 0

    // Inspection compliance
    const uniqueAssets = new Set(filtered.map(r => r.asset_number || r.asset_no)).size
    const inspectedAssets = new Set(inspections.map(r => r.asset_no)).size
    const inspectionCompliance = uniqueAssets ? Math.min(100, (inspectedAssets / uniqueAssets) * 100) : 95

    return {
      cpk: kpis.cpk?.fleetAvgCpk ?? 0,
      tyre_life: avgLife,
      failure_rate: (kpis.failureRate?.failureRate ?? 0) * 100,
      pressure_compliance: pressureCompliance,
      scrap_rate: scrapRate,
      inspection_compliance: inspectionCompliance,
    }
  }, [filtered, inspections])

  // ── Benchmarked metrics ───────────────────────────────────────────────────
  const benchmarked = useMemo(() => {
    if (!fleetKpis) return []
    return Object.entries(BENCHMARKS).map(([key, b]) => {
      const value = fleetKpis[key]
      const rating = getBenchmarkRating(key, value)
      const benchmarkTarget = b.good
      const better = b.higherIsBetter ? value >= benchmarkTarget : value <= benchmarkTarget
      const delta = b.higherIsBetter
        ? ((value - benchmarkTarget) / Math.max(0.001, benchmarkTarget)) * 100
        : ((benchmarkTarget - value) / Math.max(0.001, benchmarkTarget)) * 100
      return { key, ...b, value, rating, better, delta }
    })
  }, [fleetKpis])

  // Overall score (weighted average of benchmark scores)
  const overallScore = useMemo(() => {
    if (!benchmarked.length) return 0
    const scores = benchmarked.map(m => getBenchmarkRating(m.key, m.value).score)
    return scores.reduce((a, b) => a + b, 0) / scores.length
  }, [benchmarked])

  // ── Brand benchmarking ────────────────────────────────────────────────────
  const brandBench = useMemo(() => {
    if (!filtered.length) return []
    const brands = computeCpkByBrand(filtered)
    return brands
      .filter(b => b.count >= 3)
      .map(b => ({
        ...b,
        rating: getBenchmarkRating('cpk', b.avgCpk),
      }))
      .sort((a, b) => a.avgCpk - b.avgCpk)
  }, [filtered])

  // ── Radar chart ───────────────────────────────────────────────────────────
  const radarData = useMemo(() => {
    if (!fleetKpis) return null
    const labels = ['CPK', 'Tyre Life', 'Failure Rate', 'Pressure', 'Scrap Rate', 'Inspections']
    const fleet = [
      getBenchmarkRating('cpk', fleetKpis.cpk).score,
      getBenchmarkRating('tyre_life', fleetKpis.tyre_life).score,
      getBenchmarkRating('failure_rate', fleetKpis.failure_rate).score,
      getBenchmarkRating('pressure_compliance', fleetKpis.pressure_compliance).score,
      getBenchmarkRating('scrap_rate', fleetKpis.scrap_rate).score,
      getBenchmarkRating('inspection_compliance', fleetKpis.inspection_compliance).score,
    ]
    return {
      labels,
      datasets: [
        {
          label: 'Your Fleet',
          data: fleet,
          borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.15)',
          pointBackgroundColor: '#3b82f6', borderWidth: 2,
        },
        {
          label: 'Industry Average',
          data: [50, 50, 50, 50, 50, 50],
          borderColor: '#6b7280', backgroundColor: 'rgba(107,114,128,0.05)',
          pointBackgroundColor: '#6b7280', borderWidth: 1, borderDash: [4, 4],
        },
        {
          label: 'World Class',
          data: [100, 100, 100, 100, 100, 100],
          borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.05)',
          pointBackgroundColor: '#10b981', borderWidth: 1, borderDash: [4, 4],
        },
      ],
    }
  }, [fleetKpis])

  // ── CPK bar chart (fleet vs benchmarks) ───────────────────────────────────
  const cpkBarData = useMemo(() => {
    if (!fleetKpis) return null
    return {
      labels: ['Your Fleet', 'World Class', 'Good', 'Industry Average', 'Poor'],
      datasets: [{
        label: 'CPK (R/km)',
        data: [
          fleetKpis.cpk,
          BENCHMARKS.cpk.world_class,
          BENCHMARKS.cpk.good,
          BENCHMARKS.cpk.average,
          BENCHMARKS.cpk.poor,
        ],
        backgroundColor: ['#3b82f6', '#10b981', '#06b6d4', '#f59e0b', '#ef4444'],
      }],
    }
  }, [fleetKpis])

  // ── Brand CPK chart ───────────────────────────────────────────────────────
  const brandCpkData = useMemo(() => {
    if (!brandBench.length) return null
    const top10 = brandBench.slice(0, 10)
    const benchmark = BENCHMARKS.cpk.good
    return {
      labels: top10.map(b => b.brand),
      datasets: [
        {
          label: 'Brand CPK',
          data: top10.map(b => b.avgCpk),
          backgroundColor: top10.map(b => b.avgCpk <= benchmark ? '#10b981' : b.avgCpk <= BENCHMARKS.cpk.average ? '#f59e0b' : '#ef4444'),
        },
        {
          label: 'Good Benchmark',
          data: top10.map(() => benchmark),
          type: 'line',
          borderColor: '#3b82f6',
          borderWidth: 2,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    }
  }, [brandBench])

  // ── Export ────────────────────────────────────────────────────────────────
  function exportPdf() {
    if (!benchmarked.length) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    doc.setFillColor(15, 23, 42); doc.rect(0, 0, 297, 32, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('TyrePulse', 14, 13)
    doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.text('Fleet Performance Benchmarking Report', 14, 22)
    doc.setFontSize(8); doc.setTextColor(156, 163, 175)
    doc.text(`Generated: ${new Date().toLocaleDateString('en-ZA', { dateStyle: 'long' })}`, 14, 29)
    doc.text(`Overall Score: ${overallScore.toFixed(0)}/100`, 200, 29)

    autoTable(doc, {
      startY: 42,
      head: [['KPI', 'Your Fleet', 'World Class', 'Good', 'Average', 'Rating']],
      body: benchmarked.map(m => [
        m.label,
        m.format(m.value),
        m.format(m.world_class),
        m.format(m.good),
        m.format(m.average),
        m.rating.rating,
      ]),
      theme: 'striped',
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      margin: { left: 14, right: 14 },
    })

    const pgCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pgCount; i++) {
      doc.setPage(i); doc.setFontSize(7); doc.setTextColor(156, 163, 175)
      doc.text(`TyrePulse Fleet Benchmarking — Page ${i} of ${pgCount}`, 14, 202)
    }
    doc.save(`performance-benchmark-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  function exportExcel() {
    if (!benchmarked.length) return
    const ws = XLSX.utils.json_to_sheet(benchmarked.map(m => ({
      KPI: m.label,
      'Your Fleet': m.format(m.value),
      'World Class': m.format(m.world_class),
      Good: m.format(m.good),
      Average: m.format(m.average),
      Poor: m.format(m.poor),
      Rating: m.rating.rating,
      Score: m.rating.score,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Benchmarks')
    if (brandBench.length) {
      const ws2 = XLSX.utils.json_to_sheet(brandBench.map(b => ({
        Brand: b.brand,
        Count: b.count,
        'Avg CPK': b.avgCpk?.toFixed(4),
        Rating: b.rating.rating,
      })))
      XLSX.utils.book_append_sheet(wb, ws2, 'Brand Benchmarks')
    }
    XLSX.writeFile(wb, `performance-benchmark-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function scoreColor(score) {
    if (score >= 80) return 'text-green-400'
    if (score >= 60) return 'text-blue-400'
    if (score >= 40) return 'text-yellow-400'
    if (score >= 20) return 'text-orange-400'
    return 'text-red-400'
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-center"><Loader2 className="animate-spin text-blue-400 mx-auto mb-3" size={40} /><p className="text-gray-400">Loading benchmark data…</p></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6 space-y-6">
      {/* Header */}
      <PageHeader
        title="Performance Benchmarking"
        subtitle={`Fleet performance vs industry standards — ${filtered.length} tyre records`}
        icon={Target}
        actions={<>
          <select value={period} onChange={e => setPeriod(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none">
            <option value="90d">Last 90 Days</option>
            <option value="6m">Last 6 Months</option>
            <option value="1yr">Last Year</option>
            <option value="2yr">Last 2 Years</option>
          </select>
          <select value={site} onChange={e => setSite(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none">
            {sites.map(s => <option key={s}>{s}</option>)}
          </select>
          <button onClick={load} className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white transition-colors"><RefreshCw size={16} /></button>
          <button onClick={exportPdf} className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm rounded-lg transition-colors"><FileText size={16} />PDF</button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm rounded-lg transition-colors"><FileSpreadsheet size={16} />Excel</button>
        </>}
      />

      {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>}

      {!fleetKpis && !loading && (
        <div className="text-center py-20">
          <Target size={48} className="mx-auto text-gray-700 mb-4" />
          <p className="text-gray-400">No data found for the selected period.</p>
        </div>
      )}

      {fleetKpis && (
        <>
          {/* Overall Score */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-8">
              <div className="text-center min-w-40">
                <div className={`text-5xl font-bold ${scoreColor(overallScore)}`}>
                  {overallScore.toFixed(0)}<span className="text-2xl">/100</span>
                </div>
                <div className="text-gray-400 text-sm mt-1">Overall Score</div>
                <div className="mt-3 h-3 bg-gray-800 rounded-full overflow-hidden w-36 mx-auto">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      overallScore >= 80 ? 'bg-green-500' :
                      overallScore >= 60 ? 'bg-blue-500' :
                      overallScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${overallScore}%` }}
                  />
                </div>
              </div>

              {/* Score breakdown */}
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {benchmarked.map(m => (
                  <div key={m.key} className="bg-gray-800 rounded-xl p-3 text-center">
                    <div className={`text-xs text-gray-500 mb-1 truncate`}>{m.label.replace('Average', 'Avg')}</div>
                    <div className={`text-lg font-bold ${m.rating.color}`}>{m.format(m.value)}</div>
                    <div className={`text-xs mt-1 ${m.rating.color}`}>{m.rating.rating}</div>
                    <div className="mt-1.5 h-1 bg-gray-700 rounded-full overflow-hidden">
                      <div className={`h-full ${m.rating.score >= 80 ? 'bg-green-500' : m.rating.score >= 60 ? 'bg-blue-500' : m.rating.score >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${m.rating.score}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detailed benchmark cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {benchmarked.map(m => (
              <motion.div key={m.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-white font-semibold text-sm">{m.label}</h3>
                    <p className="text-gray-500 text-xs mt-0.5">{m.description}</p>
                  </div>
                  <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                    m.rating.score >= 80 ? 'bg-green-900/30 text-green-400 border border-green-700' :
                    m.rating.score >= 60 ? 'bg-blue-900/30 text-blue-400 border border-blue-700' :
                    m.rating.score >= 40 ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700' :
                    'bg-red-900/30 text-red-400 border border-red-700'
                  }`}>{m.rating.rating}</span>
                </div>

                <div className="flex items-end gap-2 mb-3">
                  <span className={`text-3xl font-bold ${m.rating.color}`}>{m.format(m.value)}</span>
                  <div className={`flex items-center gap-0.5 text-sm ${m.better ? 'text-green-400' : 'text-red-400'} mb-0.5`}>
                    <DeltaIcon better={m.better} />
                    <span>{Math.abs(m.delta).toFixed(1)}% vs good</span>
                  </div>
                </div>

                {/* Benchmark range */}
                <div className="space-y-1.5 text-xs">
                  {[
                    { label: 'World Class', value: m.world_class, color: 'text-green-400' },
                    { label: 'Good', value: m.good, color: 'text-blue-400' },
                    { label: 'Average', value: m.average, color: 'text-yellow-400' },
                    { label: 'Poor', value: m.poor, color: 'text-red-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-gray-500">{label}</span>
                      <span className={color}>{m.format(value)}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4">Fleet vs Industry Benchmarks</h3>
              <div className="h-72">
                {radarData && <Radar data={radarData} options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: '#9ca3af', boxWidth: 10, font: { size: 10 } } }, tooltip: CHART_OPTS.plugins.tooltip },
                  scales: { r: { ticks: { color: '#6b7280', backdropColor: 'transparent', font: { size: 9 } }, grid: { color: '#1f2937' }, pointLabels: { color: '#9ca3af', font: { size: 10 } }, suggestedMin: 0, suggestedMax: 100 } },
                }} />}
              </div>
            </div>

            {/* CPK comparison */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4">CPK vs Benchmarks</h3>
              <div className="h-72">
                {cpkBarData && <Bar data={cpkBarData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />}
              </div>
            </div>
          </div>

          {/* Brand benchmarking */}
          {brandBench.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-4">Brand CPK vs Good Benchmark</h3>
                <div className="h-64">
                  {brandCpkData && <Bar data={brandCpkData} options={{
                    ...CHART_OPTS,
                    plugins: { ...CHART_OPTS.plugins, legend: { labels: { color: '#9ca3af', boxWidth: 10, font: { size: 10 } } } },
                  }} />}
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800"><h3 className="text-white font-semibold">Brand Scorecard</h3></div>
                <div className="overflow-y-auto max-h-64">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-900">
                      <tr className="border-b border-gray-800">
                        {['Rank', 'Brand', 'Count', 'Avg CPK', 'Rating'].map(h => (
                          <th key={h} className="px-4 py-2 text-left text-gray-400 font-medium text-xs">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {brandBench.map((b, i) => (
                        <tr key={b.brand} className="border-b border-gray-800 hover:bg-gray-800/50">
                          <td className="px-4 py-2.5">
                            {i === 0 ? <Award size={16} className="text-yellow-400" /> :
                             i === 1 ? <Award size={16} className="text-gray-300" /> :
                             i === 2 ? <Award size={16} className="text-amber-600" /> :
                             <span className="text-gray-500 text-xs">#{i + 1}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-white font-medium">{b.brand}</td>
                          <td className="px-4 py-2.5 text-gray-400">{b.count}</td>
                          <td className={`px-4 py-2.5 font-medium ${b.rating.color}`}>
                            {BENCHMARKS.cpk.format(b.avgCpk)}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs font-medium ${b.rating.color}`}>{b.rating.rating}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Improvement Recommendations */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-white font-semibold mb-4">Performance Improvement Recommendations</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {benchmarked.filter(m => m.rating.score < 75).map(m => (
                <div key={m.key} className="bg-gray-800 rounded-xl p-4 border-l-4 border-orange-700">
                  <div className="flex items-start gap-2 mb-2">
                    <AlertTriangle size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-white text-sm font-medium">{m.label}</p>
                      <p className="text-gray-400 text-xs mt-0.5">Current: {m.format(m.value)} → Target: {m.format(m.good)}</p>
                    </div>
                  </div>
                  <p className="text-gray-400 text-xs leading-relaxed">
                    {m.key === 'cpk' && 'Review tyre rotation schedules, improve inflation compliance, and source higher-durability brands for high-wear positions.'}
                    {m.key === 'tyre_life' && 'Audit alignment and suspension on high-wear vehicles. Enforce rotation schedules. Consider premium brands for drive positions.'}
                    {m.key === 'failure_rate' && 'Investigate root causes of failures. Check for overloading, alignment issues, and inflation compliance. Review driver behaviour reports.'}
                    {m.key === 'pressure_compliance' && 'Increase inspection frequency, automate pressure monitoring, and train technicians on correct pressure readings.'}
                    {m.key === 'scrap_rate' && 'Increase retreading program. Remove tyres before they become too worn to retread. Improve maintenance schedules.'}
                    {m.key === 'inspection_compliance' && 'Implement mandatory weekly inspections. Use the Maintenance Calendar to track scheduled inspections. Set up automated reminders.'}
                  </p>
                </div>
              ))}
              {benchmarked.filter(m => m.rating.score < 75).length === 0 && (
                <div className="col-span-3 text-center py-8">
                  <CheckCircle size={36} className="mx-auto text-green-400 mb-2" />
                  <p className="text-green-400 font-medium">Excellent! All KPIs are at or above industry Good benchmark.</p>
                  <p className="text-gray-400 text-sm mt-1">Focus on maintaining current standards and targeting World Class performance.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
