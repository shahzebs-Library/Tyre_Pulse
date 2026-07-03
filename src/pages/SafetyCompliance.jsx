// ─────────────────────────────────────────────────────────────────────────────
// SafetyCompliance.jsx - Fleet Safety & Regulatory Compliance Dashboard · /safety-compliance
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
import { Bar, Doughnut, Line, Radar } from 'react-chartjs-2'
import {
  ShieldCheck, ShieldAlert, AlertTriangle, AlertOctagon,
  CheckCircle, XCircle, Clock, TrendingUp, TrendingDown,
  FileText, Download, RefreshCw, Filter, BarChart2,
  Loader2, FileSpreadsheet, Minus, Car, CircleDot,
} from 'lucide-react'
import * as analytics from '../lib/api/analyticsReads'
import { normalizePosition } from '../lib/tyrePositions'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'

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
    tooltip: { backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1, titleColor: '#f9fafb', bodyColor: '#d1d5db' },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
  },
}

// Minimum legal tread depth thresholds (mm)
const LEGAL_TREAD = { steer: 3, drive: 3, trailer: 3, default: 2 }
// Pressure tolerance %
const PRESSURE_TOLERANCE = 10

function getPosition(pos) {
  // Map any coded/free-text position to a LEGAL_TREAD key via the shared mapper.
  const g = normalizePosition(pos)
  if (g === 'Steer')   return 'steer'
  if (g === 'Drive')   return 'drive'
  if (g === 'Trailer') return 'trailer'
  return 'default'
}

function fmtPct(n) { return isNaN(n) ? '-' : n.toFixed(1) + '%' }
function fmtDate(d) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SafetyCompliance() {
  const { activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const [tyreRecords, setTyreRecords] = useState([])
  const [inspections, setInspections]  = useState([])
  const [accidents, setAccidents]      = useState([])
  const [loading, setLoading]          = useState(true)
  const [error, setError]              = useState(null)
  const [activeTab, setActiveTab]      = useState('overview')
  const [dateRange, setDateRange]      = useState('90d')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const country = activeCountry !== 'All' ? activeCountry : null
      const daysBack = dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : dateRange === '6m' ? 180 : 365
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack)
      const from = cutoff.toISOString()

      const queries = [
        analytics.listTyreRecordsSince({ country, since: from }),
        analytics.listInspectionsSince({ since: from.slice(0, 10) }),
        analytics.listAccidentsSince({ since: from.slice(0, 10) }),
      ]
      const [tr, insp, acc] = await Promise.all(queries)
      setTyreRecords(tr.data || [])
      setInspections(insp.data || [])
      setAccidents(acc.data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeCountry, dateRange])

  useEffect(() => { load() }, [load])

  // ── Compliance computations ───────────────────────────────────────────────
  const compliance = useMemo(() => {
    const total = tyreRecords.length
    if (!total) return null

    // Tread depth compliance
    const withTread = tyreRecords.filter(r => r.tread_depth != null && r.tread_depth !== '')
    const treadFails = withTread.filter(r => {
      const pos = getPosition(r.tyre_position || r.position)
      const limit = LEGAL_TREAD[pos] || LEGAL_TREAD.default
      return parseFloat(r.tread_depth) < limit
    })
    const treadCompliance = withTread.length ? ((withTread.length - treadFails.length) / withTread.length) * 100 : 100

    // Pressure compliance
    const withPressure = inspections.filter(r => r.pressure_reading != null && r.recommended_pressure != null)
    const pressureFails = withPressure.filter(r => {
      const diff = Math.abs((parseFloat(r.pressure_reading) - parseFloat(r.recommended_pressure)) / parseFloat(r.recommended_pressure)) * 100
      return diff > PRESSURE_TOLERANCE
    })
    const pressureCompliance = withPressure.length ? ((withPressure.length - pressureFails.length) / withPressure.length) * 100 : 100

    // Critical risk tyres
    const criticalCount = tyreRecords.filter(r => r.risk_level === 'Critical').length
    const highRiskCount = tyreRecords.filter(r => r.risk_level === 'High').length
    const criticalPct = (criticalCount / total) * 100

    // Inspection frequency compliance (vehicles inspected at least once in period)
    const uniqueAssets = new Set(tyreRecords.map(r => r.asset_number || r.asset_no)).size
    const inspectedAssets = new Set(inspections.map(r => r.asset_no)).size
    const inspectionCompliance = uniqueAssets ? Math.min(100, (inspectedAssets / uniqueAssets) * 100) : 100

    // Risk distribution
    const riskDist = { Critical: 0, High: 0, Medium: 0, Low: 0 }
    tyreRecords.forEach(r => { if (riskDist[r.risk_level] !== undefined) riskDist[r.risk_level]++ })

    // Tread compliance by site
    const bySite = {}
    tyreRecords.forEach(r => {
      const site = r.site || 'Unknown'
      if (!bySite[site]) bySite[site] = { total: 0, fails: 0 }
      bySite[site].total++
      if (r.tread_depth != null) {
        const pos = getPosition(r.tyre_position || r.position)
        if (parseFloat(r.tread_depth) < (LEGAL_TREAD[pos] || LEGAL_TREAD.default)) bySite[site].fails++
      }
    })
    const siteTread = Object.entries(bySite)
      .map(([site, d]) => ({ site, compliance: d.total ? ((d.total - d.fails) / d.total) * 100 : 100, fails: d.fails, total: d.total }))
      .sort((a, b) => a.compliance - b.compliance)

    // Monthly trend (last 6 months)
    const monthlyTrend = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i)
      const month = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const monthRecords = tyreRecords.filter(r => (r.created_at || '').startsWith(monthKey))
      const monthInspections = inspections.filter(r => (r.inspection_date || '').startsWith(monthKey))
      const critPct = monthRecords.length ? (monthRecords.filter(r => r.risk_level === 'Critical').length / monthRecords.length) * 100 : 0
      const inspPct = monthInspections.length > 0 ? 100 : 0
      monthlyTrend.push({ month, critPct, inspPct })
    }

    // Accident correlation
    const accidentsWithTyreIssue = accidents.filter(a => {
      const asset = a.asset_no || a.vehicle
      const critTyres = tyreRecords.filter(r => (r.asset_number || r.asset_no) === asset && (r.risk_level === 'Critical' || r.risk_level === 'High'))
      return critTyres.length > 0
    })
    const accidentCorrelation = accidents.length ? (accidentsWithTyreIssue.length / accidents.length) * 100 : 0

    // Overall compliance score
    const overallScore = (treadCompliance * 0.35 + pressureCompliance * 0.25 + inspectionCompliance * 0.30 + Math.max(0, 100 - criticalPct * 5) * 0.10)

    return {
      total, treadCompliance, pressureCompliance, inspectionCompliance,
      criticalCount, highRiskCount, criticalPct, overallScore,
      riskDist, siteTread, monthlyTrend, treadFails,
      pressureFails: pressureFails.length, withPressure: withPressure.length,
      accidentCorrelation, accidents: accidents.length, accidentsWithTyreIssue: accidentsWithTyreIssue.length,
    }
  }, [tyreRecords, inspections, accidents])

  // ── Chart data ────────────────────────────────────────────────────────────
  const riskChartData = useMemo(() => {
    if (!compliance) return null
    const { riskDist } = compliance
    return {
      labels: Object.keys(riskDist),
      datasets: [{
        data: Object.values(riskDist),
        backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#3b82f6'],
        borderColor: 'var(--panel-2)', borderWidth: 2,
      }],
    }
  }, [compliance])

  const trendChartData = useMemo(() => {
    if (!compliance) return null
    return {
      labels: compliance.monthlyTrend.map(m => m.month),
      datasets: [
        {
          label: 'Critical Risk %',
          data: compliance.monthlyTrend.map(m => m.critPct),
          borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)',
          fill: true, tension: 0.4,
        },
      ],
    }
  }, [compliance])

  const siteChartData = useMemo(() => {
    if (!compliance) return null
    const top10 = compliance.siteTread.slice(0, 10)
    return {
      labels: top10.map(s => s.site),
      datasets: [{
        label: 'Tread Compliance %',
        data: top10.map(s => s.compliance),
        backgroundColor: top10.map(s => s.compliance >= 90 ? '#10b981' : s.compliance >= 75 ? '#f59e0b' : '#ef4444'),
      }],
    }
  }, [compliance])

  const radarData = useMemo(() => {
    if (!compliance) return null
    return {
      labels: ['Tread Depth', 'Pressure', 'Inspection Rate', 'Risk Level', 'Accident Safety'],
      datasets: [{
        label: 'Compliance Score',
        data: [
          compliance.treadCompliance,
          compliance.pressureCompliance,
          compliance.inspectionCompliance,
          Math.max(0, 100 - compliance.criticalPct * 10),
          Math.max(0, 100 - compliance.accidentCorrelation),
        ],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.15)',
        pointBackgroundColor: '#3b82f6',
        borderWidth: 2,
      }],
    }
  }, [compliance])

  // ── Export ────────────────────────────────────────────────────────────────
  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    if (!compliance) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Safety & Compliance Report', `Overall Score: ${compliance.overallScore.toFixed(1)}%`, company, brand)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 28,
      head: [['Metric', 'Score', 'Status']],
      body: [
        ['Tread Depth Compliance', fmtPct(compliance.treadCompliance), compliance.treadCompliance >= 90 ? 'PASS' : compliance.treadCompliance >= 75 ? 'WARNING' : 'FAIL'],
        ['Pressure Compliance', fmtPct(compliance.pressureCompliance), compliance.pressureCompliance >= 90 ? 'PASS' : 'WARNING'],
        ['Inspection Compliance', fmtPct(compliance.inspectionCompliance), compliance.inspectionCompliance >= 80 ? 'PASS' : 'WARNING'],
        ['Critical Risk Tyres', compliance.criticalCount + ' tyres (' + fmtPct(compliance.criticalPct) + ')', compliance.criticalCount === 0 ? 'PASS' : 'ACTION REQUIRED'],
        ['Accident-Tyre Correlation', fmtPct(compliance.accidentCorrelation), compliance.accidents === 0 ? 'N/A' : compliance.accidentCorrelation < 30 ? 'LOW' : 'REVIEW'],
        ['Overall Score', fmtPct(compliance.overallScore), compliance.overallScore >= 90 ? 'EXCELLENT' : compliance.overallScore >= 75 ? 'GOOD' : 'NEEDS ATTENTION'],
      ],
    })

    if (compliance.siteTread.length > 0) {
      const y = (doc.lastAutoTable?.finalY || 80) + 8
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: y,
        head: [['Site', 'Tread Compliance %', 'Total Tyres', 'Failures', 'Status']],
        body: compliance.siteTread.map(s => [
          s.site, fmtPct(s.compliance), s.total, s.fails,
          s.compliance >= 90 ? 'COMPLIANT' : s.compliance >= 75 ? 'WARNING' : 'NON-COMPLIANT',
        ]),
      })
    }

    const pgCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pgCount; i++) { doc.setPage(i); pdfFooter(doc, i, pgCount, company, brand) }
    doc.save(`safety-compliance-${new Date().toISOString().slice(0,10)}.pdf`)
  }

  async function exportExcel() {
    const XLSX = await import('xlsx')
    if (!compliance) return
    const ws = XLSX.utils.json_to_sheet([
      { Metric: 'Tread Depth Compliance', Score: compliance.treadCompliance.toFixed(1) + '%' },
      { Metric: 'Pressure Compliance', Score: compliance.pressureCompliance.toFixed(1) + '%' },
      { Metric: 'Inspection Compliance', Score: compliance.inspectionCompliance.toFixed(1) + '%' },
      { Metric: 'Critical Risk Tyres', Score: compliance.criticalCount },
      { Metric: 'Overall Score', Score: compliance.overallScore.toFixed(1) + '%' },
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Compliance')
    if (compliance.siteTread.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(compliance.siteTread.map(s => ({
        Site: s.site,
        'Tread Compliance %': s.compliance.toFixed(1),
        'Total Tyres': s.total,
        Failures: s.fails,
      })))
      XLSX.utils.book_append_sheet(wb, ws2, 'By Site')
    }
    XLSX.writeFile(wb, `safety-compliance-${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  // ── Score color ───────────────────────────────────────────────────────────
  function scoreColor(pct) {
    if (pct >= 90) return 'text-green-400'
    if (pct >= 75) return 'text-yellow-400'
    if (pct >= 60) return 'text-orange-400'
    return 'text-red-400'
  }
  function scoreLabel(pct) {
    if (pct >= 90) return { text: 'Compliant', color: 'text-green-400', bg: 'bg-green-900/30', border: 'border-green-700' }
    if (pct >= 75) return { text: 'Warning', color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700' }
    if (pct >= 60) return { text: 'Attention', color: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700' }
    return { text: 'Non-Compliant', color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-700' }
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-center"><Loader2 className="animate-spin text-blue-400 mx-auto mb-3" size={40} /><p className="text-gray-400">Loading compliance data...</p></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Safety & Compliance"
        subtitle="Fleet regulatory compliance and safety monitoring"
        icon={ShieldCheck}
        actions={
          <div className="flex items-center gap-2">
            <select value={dateRange} onChange={e => setDateRange(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none">
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="6m">Last 6 Months</option>
              <option value="1y">Last Year</option>
            </select>
            <button onClick={load} className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white transition-colors"><RefreshCw size={16} /></button>
            <button onClick={exportPdf} className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm rounded-lg transition-colors"><FileText size={16} />PDF</button>
            <button onClick={exportExcel} className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm rounded-lg transition-colors"><FileSpreadsheet size={16} />Excel</button>
          </div>
        }
      />

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 flex items-center gap-3 text-red-300">
          <AlertTriangle size={18} /><span className="text-sm">{error}</span>
        </div>
      )}

      {!compliance && !loading && (
        <div className="text-center py-20">
          <ShieldCheck size={48} className="mx-auto text-gray-700 mb-4" />
          <p className="text-gray-400">No tyre data found for the selected period.</p>
        </div>
      )}

      {compliance && (
        <>
          {/* Overall Score */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6">
              <div className="text-center min-w-36">
                <div className={`text-5xl font-bold ${scoreColor(compliance.overallScore)}`}>
                  {compliance.overallScore.toFixed(0)}<span className="text-2xl">%</span>
                </div>
                <div className="text-gray-400 text-sm mt-1">Overall Score</div>
                {(() => { const sl = scoreLabel(compliance.overallScore); return (
                  <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium border ${sl.color} ${sl.bg} ${sl.border}`}>{sl.text}</span>
                ) })()}
              </div>
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Tread Depth', value: compliance.treadCompliance, icon: CircleDot, detail: `${compliance.treadFails.length} below legal limit` },
                  { label: 'Pressure', value: compliance.pressureCompliance, icon: BarChart2, detail: `${compliance.pressureFails} non-compliant readings` },
                  { label: 'Inspections', value: compliance.inspectionCompliance, icon: ShieldCheck, detail: `${inspections.length} completed` },
                  { label: 'Risk Level', value: Math.max(0, 100 - compliance.criticalPct * 10), icon: AlertOctagon, detail: `${compliance.criticalCount} critical tyres` },
                ].map(({ label, value, icon: Icon, detail }) => {
                  const sl = scoreLabel(value)
                  return (
                    <div key={label} className="bg-gray-800 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon size={15} className={scoreColor(value)} />
                        <span className="text-gray-400 text-xs">{label}</span>
                      </div>
                      <div className={`text-2xl font-bold ${scoreColor(value)}`}>{value.toFixed(0)}%</div>
                      <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${value >= 90 ? 'bg-green-500' : value >= 75 ? 'bg-yellow-500' : 'bg-red-500'} transition-all duration-700`}
                          style={{ width: `${value}%` }} />
                      </div>
                      <div className="text-gray-500 text-xs mt-1">{detail}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Alerts */}
          {compliance.criticalCount > 0 && (
            <div className="bg-red-950/40 border border-red-800 rounded-xl p-4 flex items-start gap-3">
              <AlertOctagon size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-300 font-medium">{compliance.criticalCount} Critical Risk Tyre{compliance.criticalCount !== 1 ? 's' : ''} Detected</p>
                <p className="text-red-400/70 text-sm mt-1">
                  {compliance.criticalCount} tyre{compliance.criticalCount !== 1 ? 's' : ''} classified as Critical risk require immediate inspection and potential removal from service.
                  Legal and safety liability risk is HIGH. Take immediate action.
                </p>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'tread', label: 'Tread Depth' },
              { id: 'pressure', label: 'Pressure' },
              { id: 'inspections', label: 'Inspections' },
              { id: 'sites', label: 'By Site' },
              { id: 'trends', label: 'Trends' },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === t.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Risk distribution */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-4">Risk Level Distribution</h3>
                <div className="h-52">
                  {riskChartData && <Doughnut data={riskChartData} options={{ ...CHART_OPTS, scales: undefined, plugins: { ...CHART_OPTS.plugins, legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } } } }} />}
                </div>
              </div>

              {/* Radar */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-4">Compliance Radar</h3>
                <div className="h-52">
                  {radarData && <Radar data={radarData} options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: CHART_OPTS.plugins.tooltip },
                    scales: { r: { ticks: { color: '#6b7280', backdropColor: 'transparent', font: { size: 10 } }, grid: { color: '#1f2937' }, pointLabels: { color: '#9ca3af', font: { size: 11 } }, suggestedMin: 0, suggestedMax: 100 } },
                  }} />}
                </div>
              </div>

              {/* KPI summary cards */}
              <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Total Tyres Monitored', value: compliance.total, icon: CircleDot, color: 'blue' },
                  { label: 'Critical Tyres', value: compliance.criticalCount, icon: AlertOctagon, color: 'red' },
                  { label: 'High Risk Tyres', value: compliance.highRiskCount, icon: AlertTriangle, color: 'orange' },
                  { label: 'Accidents (Period)', value: compliance.accidents, icon: Car, color: 'yellow' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div className={`flex items-center gap-2 mb-2`}>
                      <Icon size={16} className={`text-${color}-400`} />
                      <span className="text-gray-400 text-xs">{label}</span>
                    </div>
                    <div className={`text-2xl font-bold text-${color}-400`}>{value}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Tread Depth Tab */}
          {activeTab === 'tread' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: 'Overall Tread Compliance', value: compliance.treadCompliance },
                  { label: 'Below Legal Limit', value: (compliance.treadFails.length / Math.max(1, tyreRecords.filter(r => r.tread_depth != null).length)) * 100 },
                  { label: 'Avg Tread Depth (mm)', value: (() => { const vals = tyreRecords.filter(r => r.tread_depth != null).map(r => parseFloat(r.tread_depth)).filter(v => !isNaN(v)); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 })() },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                    <div className="text-gray-400 text-sm mb-1">{label}</div>
                    <div className={`text-3xl font-bold ${scoreColor(label.includes('Avg') ? (value >= 4 ? 100 : value >= 3 ? 75 : 50) : value)}`}>
                      {label.includes('Avg') ? value.toFixed(1) + 'mm' : value.toFixed(1) + '%'}
                    </div>
                  </div>
                ))}
              </div>

              {/* Below legal limit table */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800">
                  <h3 className="text-white font-semibold">Tyres Below Legal Tread Limit</h3>
                  <p className="text-gray-400 text-sm mt-0.5">Minimum legal: Steer/Drive/Trailer 3mm, Others 2mm</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['Asset', 'Serial', 'Position', 'Tread Depth', 'Legal Min', 'Deficit', 'Risk Level', 'Site'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-gray-400 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compliance.treadFails.slice(0, 50).map(r => {
                        const pos = getPosition(r.tyre_position || r.position)
                        const limit = LEGAL_TREAD[pos] || LEGAL_TREAD.default
                        const deficit = (limit - parseFloat(r.tread_depth)).toFixed(1)
                        return (
                          <tr key={r.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                            <td className="px-4 py-3 text-white font-medium">{r.asset_number || r.asset_no || '-'}</td>
                            <td className="px-4 py-3 text-gray-300">{r.serial_number || r.serial_no || '-'}</td>
                            <td className="px-4 py-3 text-gray-300">{r.tyre_position || r.position || '-'}</td>
                            <td className="px-4 py-3 text-red-400 font-bold">{r.tread_depth}mm</td>
                            <td className="px-4 py-3 text-gray-400">{limit}mm</td>
                            <td className="px-4 py-3 text-red-400">-{deficit}mm</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-medium ${r.risk_level === 'Critical' ? 'text-red-400' : r.risk_level === 'High' ? 'text-orange-400' : 'text-yellow-400'}`}>{r.risk_level || '-'}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-400">{r.site || '-'}</td>
                          </tr>
                        )
                      })}
                      {compliance.treadFails.length === 0 && (
                        <tr><td colSpan={8} className="text-center py-10 text-green-400"><CheckCircle size={28} className="mx-auto mb-2" />All tyres above legal tread limit</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* Pressure Tab */}
          {activeTab === 'pressure' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="text-gray-400 text-sm mb-1">Pressure Compliance</div>
                  <div className={`text-3xl font-bold ${scoreColor(compliance.pressureCompliance)}`}>{fmtPct(compliance.pressureCompliance)}</div>
                  <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div className={`h-full ${compliance.pressureCompliance >= 90 ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${compliance.pressureCompliance}%` }} />
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="text-gray-400 text-sm mb-1">Inspections Checked</div>
                  <div className="text-3xl font-bold text-blue-400">{compliance.withPressure}</div>
                  <div className="text-gray-500 text-xs mt-1">with pressure readings</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="text-gray-400 text-sm mb-1">Pressure Failures</div>
                  <div className="text-3xl font-bold text-red-400">{compliance.pressureFails}</div>
                  <div className="text-gray-500 text-xs mt-1">outside ±{PRESSURE_TOLERANCE}% tolerance</div>
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-1">Pressure Tolerance Policy</h3>
                <p className="text-gray-400 text-sm">
                  Any inspection where the recorded pressure reading deviates more than <strong className="text-white">±{PRESSURE_TOLERANCE}%</strong> from
                  the vehicle manufacturer's recommended pressure is flagged as non-compliant.
                  Under-inflation accelerates wear, generates heat, and increases risk of blowout.
                  Over-inflation reduces contact patch and increases susceptibility to impact damage.
                </p>
              </div>
            </motion.div>
          )}

          {/* Inspections Tab */}
          {activeTab === 'inspections' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="text-gray-400 text-sm mb-1">Inspection Compliance</div>
                  <div className={`text-3xl font-bold ${scoreColor(compliance.inspectionCompliance)}`}>{fmtPct(compliance.inspectionCompliance)}</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="text-gray-400 text-sm mb-1">Total Inspections</div>
                  <div className="text-3xl font-bold text-blue-400">{inspections.length}</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="text-gray-400 text-sm mb-1">Vehicles Inspected</div>
                  <div className="text-3xl font-bold text-green-400">{new Set(inspections.map(r => r.asset_no)).size}</div>
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800">
                  <h3 className="text-white font-semibold">Recent Inspections</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['Asset No', 'Inspector', 'Date', 'Site', 'Tread Noted', 'Pressure Noted'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-gray-400 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inspections.slice(0, 30).map(r => (
                        <tr key={r.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                          <td className="px-4 py-3 text-white font-medium">{r.asset_no || '-'}</td>
                          <td className="px-4 py-3 text-gray-300">{r.inspector || '-'}</td>
                          <td className="px-4 py-3 text-gray-400">{fmtDate(r.inspection_date)}</td>
                          <td className="px-4 py-3 text-gray-400">{r.site || '-'}</td>
                          <td className="px-4 py-3">{r.tread_depth != null ? <CheckCircle size={14} className="text-green-400" /> : <XCircle size={14} className="text-red-400" />}</td>
                          <td className="px-4 py-3">{r.pressure_reading != null ? <CheckCircle size={14} className="text-green-400" /> : <XCircle size={14} className="text-red-400" />}</td>
                        </tr>
                      ))}
                      {inspections.length === 0 && (
                        <tr><td colSpan={6} className="text-center py-10 text-gray-500">No inspections found for this period</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* By Site Tab */}
          {activeTab === 'sites' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-4">Tread Compliance by Site</h3>
                <div className="h-72">
                  {siteChartData && <Bar data={siteChartData} options={{ ...CHART_OPTS, indexAxis: 'y', plugins: { ...CHART_OPTS.plugins, legend: { display: false } }, scales: { x: { ...CHART_OPTS.scales.x, min: 0, max: 100 }, y: CHART_OPTS.scales.y } }} />}
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['Site', 'Total Tyres', 'Tread Failures', 'Compliance %', 'Status'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-gray-400 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compliance.siteTread.map(s => {
                        const sl = scoreLabel(s.compliance)
                        return (
                          <tr key={s.site} className="border-b border-gray-800 hover:bg-gray-800/50">
                            <td className="px-4 py-3 text-white font-medium">{s.site}</td>
                            <td className="px-4 py-3 text-gray-300">{s.total}</td>
                            <td className="px-4 py-3 text-red-400">{s.fails}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${s.compliance >= 90 ? 'bg-green-500' : s.compliance >= 75 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${s.compliance}%` }} />
                                </div>
                                <span className={`${scoreColor(s.compliance)} font-medium`}>{s.compliance.toFixed(1)}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${sl.color} ${sl.bg} ${sl.border}`}>{sl.text}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* Trends Tab */}
          {activeTab === 'trends' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 gap-6">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-4">Critical Risk Trend (6 Months)</h3>
                <div className="h-64">
                  {trendChartData && <Line data={trendChartData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />}
                </div>
              </div>

              {/* Accident correlation */}
              {compliance.accidents > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <h3 className="text-white font-semibold mb-4">Accident-Tyre Correlation</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-gray-800 rounded-xl p-4">
                      <div className="text-gray-400 text-sm">Total Accidents</div>
                      <div className="text-2xl font-bold text-yellow-400">{compliance.accidents}</div>
                    </div>
                    <div className="bg-gray-800 rounded-xl p-4">
                      <div className="text-gray-400 text-sm">With Tyre Issues</div>
                      <div className="text-2xl font-bold text-orange-400">{compliance.accidentsWithTyreIssue}</div>
                    </div>
                    <div className="bg-gray-800 rounded-xl p-4">
                      <div className="text-gray-400 text-sm">Correlation Rate</div>
                      <div className={`text-2xl font-bold ${scoreColor(100 - compliance.accidentCorrelation)}`}>{fmtPct(compliance.accidentCorrelation)}</div>
                    </div>
                  </div>
                  <p className="text-gray-400 text-sm mt-4">
                    {compliance.accidentCorrelation > 50
                      ? 'HIGH RISK: More than half of recorded accidents occurred on vehicles with High/Critical risk tyres. Immediate tyre management review required.'
                      : compliance.accidentCorrelation > 25
                      ? 'MODERATE: A significant proportion of accidents involved vehicles with tyre risk. Review maintenance schedules.'
                      : 'LOW CORRELATION: Most accidents did not involve vehicles with high-risk tyres. Continue monitoring.'}
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}
    </div>
  )
}
