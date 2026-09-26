// ─────────────────────────────────────────────────────────────────────────────
// SafetyCompliance.jsx - Fleet Safety & Regulatory Compliance Dashboard · /safety-compliance
//
// Every figure comes from the pure engine `src/lib/safetyComplianceAnalytics.js`
// (tested). A component with no measurement renders N/A and the overall score
// renormalises its weights over the measured components only - it is never a
// flattering 100% built from absent data.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  RadialLinearScale,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Doughnut, Radar } from 'react-chartjs-2'
import {
  ShieldCheck, AlertTriangle, AlertOctagon, CircleDot, Gauge, ClipboardCheck,
  Car, RefreshCw, FileText, FileSpreadsheet, MapPin, Activity, Layers,
} from 'lucide-react'
import * as analytics from '../lib/api/analyticsReads'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import {
  resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme,
  exportSheetsToExcel, reportFileName, reportDateLabel,
} from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { Skeleton } from '../components/ui/Skeleton'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { loadAutoTable } from '../lib/pdfEngine'
import { ACCENTS, withAlpha } from '../lib/reportColors'
import {
  computeSafetyCompliance, complianceSummaryRows, inspectionRows, filterBySite,
  siteOptions, scoreBand, rangeCutoff, RANGE_OPTIONS, PRESSURE_TOLERANCE, LEGAL_TREAD,
} from '../lib/safetyComplianceAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  RadialLinearScale,
  Title, Tooltip, Legend, Filler,
)

// Theme-aware chart chrome: chartVarPlugin resolves var(--token) per theme.
const TICK = 'var(--text-muted)'
const GRID = 'var(--panel-2)'
const TOOLTIP = {
  backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1,
  titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)',
}
const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: TICK, boxWidth: 12, font: { size: 11 } } },
    tooltip: TOOLTIP,
  },
  scales: {
    x: { ticks: { color: TICK, font: { size: 11 } }, grid: { color: GRID } },
    y: { ticks: { color: TICK, font: { size: 11 } }, grid: { color: GRID } },
  },
}

// Semantic band colours (text label always rendered beside them).
const BAND_TEXT = {
  compliant: 'text-green-400',
  warning: 'text-yellow-400',
  attention: 'text-orange-400',
  non_compliant: 'text-red-400',
  not_measured: 'text-[var(--text-muted)]',
}
const BAND_BADGE = {
  compliant: 'bg-green-900/40 text-green-300 border-green-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  attention: 'bg-orange-900/40 text-orange-300 border-orange-700/50',
  non_compliant: 'bg-red-900/40 text-red-300 border-red-700/50',
  not_measured: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}
const BAND_BAR = {
  compliant: ACCENTS.good, warning: ACCENTS.watch, attention: '#f97316', non_compliant: ACCENTS.risk, not_measured: 'var(--input-border)',
}
const RISK_COLOURS = { Critical: ACCENTS.risk, High: '#f97316', Medium: ACCENTS.watch, Low: ACCENTS.info }

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tread', label: 'Tread depth' },
  { id: 'pressure', label: 'Pressure' },
  { id: 'inspections', label: 'Inspections' },
  { id: 'sites', label: 'By site' },
  { id: 'trends', label: 'Trends' },
]

const NA = 'N/A'
const fmtPct = (n) => (n == null || Number.isNaN(n) ? NA : `${n.toFixed(1)}%`)
const fmtDay = (d) => (d ? formatDate(d, 'All', { day: '2-digit', month: 'short', year: 'numeric' }) : NA)
const text = (v) => (v == null || v === '' ? NA : v)

function BandBadge({ value }) {
  const b = scoreBand(value)
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${BAND_BADGE[b.key]}`}>{b.label}</span>
  )
}

function Meter({ value, label }) {
  const b = scoreBand(value)
  return (
    <div
      className="h-1.5 bg-[var(--input-border)] rounded-full overflow-hidden"
      role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={value == null ? undefined : Math.round(value)}
      aria-valuetext={value == null ? 'Not measured' : `${value.toFixed(0)} percent, ${b.label}`}
    >
      <div className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${value ?? 0}%`, background: BAND_BAR[b.key] }} />
    </div>
  )
}

function ChartEmpty({ children }) {
  return <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4">{children}</div>
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SafetyCompliance() {
  const { activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const [data, setData] = useState({ tyreRecords: [], inspections: [], accidents: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exportError, setExportError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [dateRange, setDateRange] = useState('90d')
  const [site, setSite] = useState('all')

  // Switching the range fires a new load over the old one. If the earlier
  // answer lands last, the compliance scores describe the PREVIOUS window while
  // the chips say otherwise - a safety figure that is quietly wrong.
  const latestLoad = useLatestRequest()

  const load = useCallback(async () => {
    const stale = latestLoad.begin()
    setLoading(true); setError(null)
    try {
      const country = activeCountry !== 'All' ? activeCountry : null
      const from = rangeCutoff(dateRange)
      const [tr, insp, acc] = await Promise.all([
        analytics.listTyreRecordsSince({ country, since: from }),
        analytics.listInspectionsSince({ since: from.slice(0, 10) }),
        analytics.listAccidentsSince({ since: from.slice(0, 10) }),
      ])
      if (stale()) return
      const failed = tr.error || insp.error || acc.error
      if (failed) throw failed
      setData({ tyreRecords: tr.data || [], inspections: insp.data || [], accidents: acc.data || [] })
      setUpdatedAt(new Date())
    } catch (e) {
      // A superseded load must not raise a banner over data that loaded fine.
      if (!stale()) setError(toUserMessage(e, 'Could not load compliance data. Please try again.'))
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [activeCountry, dateRange, latestLoad])

  useEffect(() => { load() }, [load])

  const sites = useMemo(() => siteOptions(data), [data])
  const scoped = useMemo(() => filterBySite(data, site), [data, site])
  const compliance = useMemo(() => computeSafetyCompliance(scoped), [scoped])
  const inspRows = useMemo(() => inspectionRows(scoped.inspections), [scoped])
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === dateRange)?.label || dateRange
  const scopeLabel = `${rangeLabel}${site !== 'all' ? `, ${site}` : ''}`

  // ── Charts ────────────────────────────────────────────────────────────────
  const riskChartData = useMemo(() => {
    if (!compliance || !compliance.ratedCount) return null
    const keys = Object.keys(compliance.riskDist)
    return {
      labels: keys,
      datasets: [{ data: keys.map((k) => compliance.riskDist[k]), backgroundColor: keys.map((k) => RISK_COLOURS[k]), borderColor: 'var(--panel-2)', borderWidth: 2 }],
    }
  }, [compliance])

  const radarData = useMemo(() => {
    if (!compliance) return null
    return {
      labels: ['Tread depth', 'Pressure', 'Inspection coverage', 'Risk level', 'Accident safety'],
      datasets: [{
        label: 'Compliance score',
        data: [compliance.treadCompliance, compliance.pressureCompliance, compliance.inspectionCompliance, compliance.riskScore, compliance.accidentSafety],
        borderColor: ACCENTS.primary, backgroundColor: withAlpha(ACCENTS.primary, 0.15), pointBackgroundColor: ACCENTS.primary, borderWidth: 2,
      }],
    }
  }, [compliance])

  const siteChartData = useMemo(() => {
    if (!compliance) return null
    const rows = compliance.siteTread.filter((s) => s.compliance != null).slice(0, 12)
    if (!rows.length) return null
    return {
      labels: rows.map((s) => s.site),
      datasets: [{ label: 'Tread compliance %', data: rows.map((s) => s.compliance), backgroundColor: rows.map((s) => BAND_BAR[scoreBand(s.compliance).key]) }],
    }
  }, [compliance])

  const trendChartData = useMemo(() => {
    if (!compliance) return null
    const t = compliance.monthlyTrend
    return {
      labels: t.map((m) => m.label),
      datasets: [
        { type: 'line', label: 'Critical risk % (rated tyres)', data: t.map((m) => m.critPct), borderColor: ACCENTS.risk, backgroundColor: withAlpha(ACCENTS.risk, 0.12), fill: true, tension: 0.35, spanGaps: true, yAxisID: 'y' },
        { type: 'bar', label: 'Inspections', data: t.map((m) => m.inspections), backgroundColor: withAlpha(ACCENTS.info, 0.45), yAxisID: 'y1' },
      ],
    }
  }, [compliance])
  const trendHasRisk = compliance?.monthlyTrend.some((m) => m.critPct != null)

  // ── Table columns ─────────────────────────────────────────────────────────
  const treadColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset ?? '', cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{text(row.original.asset)}</span> },
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial ?? '', cell: ({ row }) => text(row.original.serial) },
    { id: 'position', header: 'Position', accessorFn: (r) => r.position ?? '', cell: ({ row }) => text(row.original.position) },
    { id: 'tread', header: 'Tread (mm)', accessorFn: (r) => r.tread, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums font-semibold text-red-400">{row.original.tread.toFixed(1)}</span> },
    { id: 'legalMin', header: 'Legal min (mm)', accessorFn: (r) => r.legalMin, meta: { align: 'right' } },
    { id: 'deficit', header: 'Deficit (mm)', accessorFn: (r) => r.deficit, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums text-red-400">{row.original.deficit.toFixed(1)} below</span> },
    { id: 'risk', header: 'Risk level', accessorFn: (r) => r.risk ?? 'Not rated', meta: { filterVariant: 'select' } },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? '', meta: { filterVariant: 'select' }, cell: ({ row }) => text(row.original.site) },
  ], [])

  const pressureColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset ?? '', cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{text(row.original.asset)}</span> },
    { id: 'date', header: 'Date', accessorFn: (r) => r.date ?? '', cell: ({ row }) => fmtDay(row.original.date) },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? '', cell: ({ row }) => text(row.original.site) },
    { id: 'reading', header: 'Reading', accessorFn: (r) => r.reading, meta: { align: 'right' } },
    { id: 'target', header: 'Recommended', accessorFn: (r) => r.target, meta: { align: 'right' } },
    { id: 'deviation', header: 'Deviation %', accessorFn: (r) => r.deviationPct, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.deviationPct > 0 ? '+' : ''}{row.original.deviationPct.toFixed(1)}%</span> },
    {
      id: 'result', header: 'Result', accessorFn: (r) => (r.compliant ? 'Within tolerance' : 'Out of tolerance'), meta: { filterVariant: 'select' },
      cell: ({ row }) => <BandBadge value={row.original.compliant ? 100 : 0} />,
    },
  ], [])

  const inspectionColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset ?? '', cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{text(row.original.asset)}</span> },
    { id: 'inspector', header: 'Inspector', accessorFn: (r) => r.inspector ?? '', cell: ({ row }) => text(row.original.inspector) },
    { id: 'date', header: 'Date', accessorFn: (r) => r.date ?? '', cell: ({ row }) => fmtDay(row.original.date) },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? '', meta: { filterVariant: 'select' }, cell: ({ row }) => text(row.original.site) },
    { id: 'tread', header: 'Tread recorded', accessorFn: (r) => (r.treadRecorded ? 'Yes' : 'No'), meta: { filterVariant: 'select' } },
    { id: 'pressure', header: 'Pressure recorded', accessorFn: (r) => (r.pressureRecorded ? 'Yes' : 'No'), meta: { filterVariant: 'select' } },
  ], [])

  const siteColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: (r) => r.site, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.site}</span> },
    { id: 'total', header: 'Tyres', accessorFn: (r) => r.total, meta: { align: 'right' } },
    { id: 'measured', header: 'Tread measured', accessorFn: (r) => r.measured, meta: { align: 'right' } },
    { id: 'fails', header: 'Below legal', accessorFn: (r) => r.fails, meta: { align: 'right' } },
    { id: 'critical', header: 'Critical risk', accessorFn: (r) => r.critical, meta: { align: 'right' } },
    {
      id: 'compliance', header: 'Compliance', accessorFn: (r) => r.compliance ?? -1, meta: { align: 'right', exportValue: (r) => (r.compliance == null ? NA : r.compliance) },
      cell: ({ row }) => <span className={`tabular-nums font-medium ${BAND_TEXT[scoreBand(row.original.compliance).key]}`}>{fmtPct(row.original.compliance)}</span>,
    },
    { id: 'status', header: 'Status', accessorFn: (r) => scoreBand(r.compliance).label, meta: { filterVariant: 'select' }, cell: ({ row }) => <BandBadge value={row.original.compliance} /> },
  ], [])

  // ── Export ────────────────────────────────────────────────────────────────
  const fileBase = reportFileName('Safety Compliance', rangeLabel, site !== 'all' ? site : null, reportDateLabel())

  async function exportPdf() {
    if (!compliance) return
    setExportError(null)
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = await loadAutoTable()
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(branding)
      pdfHeader(doc, 'Safety and Compliance Report', `${scopeLabel}. Overall score ${fmtPct(compliance.overallScore)}`, company, brand)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 28,
        head: [['Metric', 'Score', 'Status', 'Basis']],
        body: complianceSummaryRows(compliance).map((r) => [r.metric, r.score, r.status, r.basis]),
      })
      if (compliance.siteTread.length) {
        autoTable(doc, {
          ...pdfTableTheme(brand.accent),
          startY: (doc.lastAutoTable?.finalY || 80) + 8,
          head: [['Site', 'Tyres', 'Tread measured', 'Below legal', 'Compliance', 'Status']],
          body: compliance.siteTread.map((s) => [s.site, s.total, s.measured, s.fails, fmtPct(s.compliance), scoreBand(s.compliance).label]),
        })
      }
      if (compliance.treadFails.length) {
        autoTable(doc, {
          ...pdfTableTheme(brand.accent),
          startY: (doc.lastAutoTable?.finalY || 80) + 8,
          head: [['Asset', 'Serial', 'Position', 'Tread mm', 'Legal min mm', 'Deficit mm', 'Risk', 'Site']],
          body: compliance.treadFails.map((r) => [text(r.asset), text(r.serial), text(r.position), r.tread, r.legalMin, r.deficit, r.risk || 'Not rated', text(r.site)]),
        })
      }
      const pages = doc.internal.getNumberOfPages()
      for (let i = 1; i <= pages; i++) { doc.setPage(i); pdfFooter(doc, i, pages, company, brand) }
      doc.save(`${fileBase}.pdf`)
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export the PDF. Try again.'))
    }
  }

  async function exportExcel() {
    if (!compliance) return
    setExportError(null)
    try {
      await exportSheetsToExcel([
        { name: 'Compliance', rows: complianceSummaryRows(compliance), columns: ['metric', 'score', 'status', 'basis'], headers: ['Metric', 'Score', 'Status', 'Basis'] },
        {
          name: 'By site',
          rows: compliance.siteTread.map((s) => ({ ...s, compliance: s.compliance == null ? NA : s.compliance, status: scoreBand(s.compliance).label })),
          columns: ['site', 'total', 'measured', 'fails', 'critical', 'compliance', 'status'],
          headers: ['Site', 'Tyres', 'Tread measured', 'Below legal', 'Critical risk', 'Compliance %', 'Status'],
        },
        {
          name: 'Below legal tread',
          rows: compliance.treadFails.map((r) => ({ ...r, risk: r.risk || 'Not rated' })),
          columns: ['asset', 'serial', 'position', 'tread', 'legalMin', 'deficit', 'risk', 'site'],
          headers: ['Asset', 'Serial', 'Position', 'Tread mm', 'Legal min mm', 'Deficit mm', 'Risk level', 'Site'],
        },
        {
          name: 'Pressure checks',
          rows: compliance.pressure.map((r) => ({ ...r, result: r.compliant ? 'Within tolerance' : 'Out of tolerance' })),
          columns: ['asset', 'date', 'site', 'reading', 'target', 'deviationPct', 'result'],
          headers: ['Asset', 'Date', 'Site', 'Reading', 'Recommended', 'Deviation %', 'Result'],
        },
        {
          name: 'Inspections',
          rows: inspRows.map((r) => ({ ...r, treadRecorded: r.treadRecorded ? 'Yes' : 'No', pressureRecorded: r.pressureRecorded ? 'Yes' : 'No' })),
          columns: ['asset', 'inspector', 'date', 'site', 'treadRecorded', 'pressureRecorded'],
          headers: ['Asset', 'Inspector', 'Date', 'Site', 'Tread recorded', 'Pressure recorded'],
        },
      ], fileBase, { title: 'Safety and Compliance', company, dateRange: scopeLabel })
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export the workbook. Try again.'))
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  const tabId = (id) => `safety-tab-${id}`
  const panelId = (id) => `safety-panel-${id}`
  const firstLoad = loading && !updatedAt

  return (
    <div className="space-y-6">
      <PageHeader
        title="Safety and Compliance"
        subtitle="Fleet regulatory compliance and safety monitoring. Unmeasured checks show N/A and do not count toward the score."
        icon={ShieldCheck}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportExcel} disabled={!compliance} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
              <FileSpreadsheet size={15} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={exportPdf} disabled={!compliance} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
              <FileText size={15} aria-hidden="true" /> PDF
            </button>
          </div>
        }
      />

      {/* Filters */}
      <Card pad="tight">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] min-w-[160px] flex-1 sm:flex-none">
            Period
            <select className="input min-h-[44px]" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
              {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] min-w-[160px] flex-1 sm:flex-none">
            Site
            <select className="input min-h-[44px]" value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="all">All sites</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {site !== 'all' && (
            <button type="button" onClick={() => setSite('all')} className="btn-secondary text-sm min-h-[44px]">Clear site</button>
          )}
          <p className="text-xs text-[var(--text-muted)] sm:ml-auto" aria-live="polite">
            {loading ? 'Loading' : `${scoped.tyreRecords.length} tyre records, ${scoped.inspections.length} inspections, ${scoped.accidents.length} accidents in scope`}
          </p>
        </div>
      </Card>

      {error && (
        <Card tone="crit" role="alert" className="items-start justify-between gap-[var(--space-3)] sm:items-center" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div><p className="font-medium text-[var(--text-primary)]">Compliance data could not be loaded.</p><p className="text-sm text-[var(--text-muted)] mt-1">{error}</p></div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </Card>
      )}
      {exportError && (
        <Card tone="warn" role="alert" className="items-center gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={16} className="text-amber-300 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-primary)] flex-1">{exportError}</p>
        </Card>
      )}

      {firstLoad && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading compliance data">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        </div>
      )}

      {!firstLoad && !error && !compliance && (
        <Card className="items-center text-center" style={{ paddingBlock: '4rem' }}>
          <ShieldCheck size={44} className="text-[var(--text-dim)] mb-3" aria-hidden="true" />
          <p className="text-[var(--text-primary)] font-medium">No tyre records in this period{site !== 'all' ? ` for ${site}` : ''}.</p>
          <p className="text-sm text-[var(--text-muted)] mt-1">Widen the period or clear the site filter. Compliance cannot be scored without tyre data.</p>
        </Card>
      )}

      {!firstLoad && compliance && (
        <>
          {/* Overall score + components */}
          <Card>
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6">
              <div className="text-center min-w-36">
                <div className={`text-5xl font-bold tabular-nums ${BAND_TEXT[scoreBand(compliance.overallScore).key]}`}>
                  {compliance.overallScore == null ? NA : <>{compliance.overallScore.toFixed(0)}<span className="text-2xl">%</span></>}
                </div>
                <div className="text-[var(--text-muted)] text-sm mt-1">Overall score</div>
                <div className="mt-2"><BandBadge value={compliance.overallScore} /></div>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">Weighted over {compliance.measuredComponents.length} of 4 measured checks</p>
              </div>
              <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  { label: 'Tread depth', value: compliance.treadCompliance, icon: CircleDot, detail: compliance.treadMeasured ? `${compliance.treadFails.length} of ${compliance.treadMeasured} measured below legal` : 'No tread readings in scope' },
                  { label: 'Pressure', value: compliance.pressureCompliance, icon: Gauge, detail: compliance.pressureChecked ? `${compliance.pressureFails} of ${compliance.pressureChecked} outside tolerance` : 'No readings with a recommended pressure' },
                  { label: 'Inspection coverage', value: compliance.inspectionCompliance, icon: ClipboardCheck, detail: `${compliance.inspectedAssets} of ${compliance.tyreAssets} assets inspected` },
                  { label: 'Risk level', value: compliance.riskScore, icon: AlertOctagon, detail: compliance.ratedCount ? `${compliance.criticalCount} critical of ${compliance.ratedCount} rated` : 'No tyres carry a risk rating' },
                ].map(({ label, value, icon: Icon, detail }) => (
                  <div key={label} className="bg-[var(--input-bg)] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon size={15} className={BAND_TEXT[scoreBand(value).key]} aria-hidden="true" />
                      <span className="text-[var(--text-muted)] text-xs">{label}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-2xl font-bold tabular-nums ${BAND_TEXT[scoreBand(value).key]}`}>{value == null ? NA : `${value.toFixed(0)}%`}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">{scoreBand(value).label}</span>
                    </div>
                    <div className="mt-2"><Meter value={value} label={`${label} compliance`} /></div>
                    <div className="text-[var(--text-muted)] text-xs mt-1">{detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile label="Tyres monitored" value={compliance.total} icon={CircleDot} sub={scopeLabel} />
            <StatTile label="Risk rated" value={compliance.ratedCount} icon={Layers} sub={`${compliance.total - compliance.ratedCount} not rated`} tone="info" />
            <StatTile label="Critical tyres" value={compliance.ratedCount ? compliance.criticalCount : NA} icon={AlertOctagon} tone="crit" sub={fmtPct(compliance.criticalPct)} />
            <StatTile label="High risk tyres" value={compliance.ratedCount ? compliance.highRiskCount : NA} icon={AlertTriangle} tone="warn" />
            <StatTile label="Avg tread" value={compliance.avgTread == null ? NA : compliance.avgTread.toFixed(1)} unit={compliance.avgTread == null ? undefined : 'mm'} icon={Activity} sub={`${compliance.treadMeasured} measured`} />
            <StatTile label="Accidents" value={compliance.accidents} icon={Car} tone="warn" sub={compliance.accidentCorrelation == null ? 'Correlation N/A' : `${fmtPct(compliance.accidentCorrelation)} on risky tyres`} />
          </div>

          {compliance.criticalCount > 0 && (
            <Card tone="crit" role="status" className="items-start gap-3" style={{ flexDirection: 'row' }}>
              <AlertOctagon size={20} className="text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-medium text-[var(--text-primary)]">{compliance.criticalCount} critical risk tyre{compliance.criticalCount !== 1 ? 's' : ''} detected</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">Critical tyres need immediate inspection and possible removal from service. See the Tread depth tab for the tyres below the legal limit.</p>
              </div>
            </Card>
          )}

          {/* Tabs */}
          <div role="tablist" aria-label="Compliance sections" className="flex flex-wrap gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1 max-w-full">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={tabId(t.id)}
                aria-selected={activeTab === t.id}
                aria-controls={panelId(t.id)}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 min-h-[44px] rounded-lg text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${activeTab === t.id ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={panelId(activeTab)} aria-labelledby={tabId(activeTab)}>
            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader title="Risk level distribution" description={compliance.ratedCount ? `${compliance.ratedCount} of ${compliance.total} tyres carry a risk rating` : undefined} />
                  <div className="h-56">
                    {riskChartData
                      ? <Doughnut data={riskChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: TICK, boxWidth: 12, font: { size: 11 } } }, tooltip: TOOLTIP } }} aria-label="Risk level distribution chart" />
                      : <ChartEmpty>No tyre in scope carries a risk rating, so the distribution cannot be drawn.</ChartEmpty>}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Compliance radar" description="Unmeasured checks are left off the shape rather than drawn at zero." />
                  <div className="h-56">
                    <Radar data={radarData} aria-label="Compliance radar chart" options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { display: false }, tooltip: TOOLTIP },
                      scales: { r: { ticks: { color: TICK, backdropColor: 'transparent', font: { size: 10 } }, grid: { color: GRID }, angleLines: { color: GRID }, pointLabels: { color: TICK, font: { size: 11 } }, suggestedMin: 0, suggestedMax: 100 } },
                    }} />
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'tread' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatTile label="Tread compliance" value={fmtPct(compliance.treadCompliance)} icon={CircleDot} sub={scoreBand(compliance.treadCompliance).label} />
                  <StatTile label="Below legal limit" value={fmtPct(compliance.belowLimitPct)} icon={AlertTriangle} tone="crit" sub={`${compliance.treadFails.length} tyres`} />
                  <StatTile label="Avg tread depth" value={compliance.avgTread == null ? NA : compliance.avgTread.toFixed(1)} unit={compliance.avgTread == null ? undefined : 'mm'} icon={Activity} sub={`${compliance.treadMeasured} measured`} />
                </div>
                <Card pad="none">
                  <div className="px-5 pt-4">
                    <CardHeader title="Tyres below legal tread limit" description={`Legal minimum: steer, drive and trailer ${LEGAL_TREAD.steer} mm, other positions ${LEGAL_TREAD.default} mm.`} />
                  </div>
                  <EnterpriseTable
                    columns={treadColumns}
                    data={compliance.treadFails}
                    getRowId={(r, i) => String(r.id ?? i)}
                    searchPlaceholder="Search asset, serial, site"
                    enableExport={false}
                    emptyMessage={compliance.treadMeasured ? 'Every measured tyre is above its legal tread limit.' : 'No tread readings in scope, so nothing can be checked against the legal limit.'}
                  />
                </Card>
              </div>
            )}

            {activeTab === 'pressure' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatTile label="Pressure compliance" value={fmtPct(compliance.pressureCompliance)} icon={Gauge} sub={scoreBand(compliance.pressureCompliance).label} />
                  <StatTile label="Readings checked" value={compliance.pressureChecked} icon={ClipboardCheck} tone="info" sub="with a recommended pressure" />
                  <StatTile label="Out of tolerance" value={compliance.pressureChecked ? compliance.pressureFails : NA} icon={AlertTriangle} tone="crit" sub={`more than ${PRESSURE_TOLERANCE}% from recommended`} />
                </div>
                <Card pad="none">
                  <div className="px-5 pt-4">
                    <CardHeader title="Pressure checks" description={`A reading more than ${PRESSURE_TOLERANCE}% above or below the recommended pressure is non-compliant. Under-inflation raises heat and blowout risk; over-inflation shrinks the contact patch.`} />
                  </div>
                  <EnterpriseTable
                    columns={pressureColumns}
                    data={compliance.pressure}
                    getRowId={(r, i) => String(r.id ?? i)}
                    searchPlaceholder="Search asset or site"
                    enableExport={false}
                    emptyMessage="No inspection in scope records both a pressure reading and a recommended pressure."
                  />
                </Card>
              </div>
            )}

            {activeTab === 'inspections' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatTile label="Inspection coverage" value={fmtPct(compliance.inspectionCompliance)} icon={ShieldCheck} sub={scoreBand(compliance.inspectionCompliance).label} />
                  <StatTile label="Inspections" value={compliance.inspectionsCount} icon={ClipboardCheck} tone="info" sub={scopeLabel} />
                  <StatTile label="Assets inspected" value={`${compliance.inspectedAssets} of ${compliance.tyreAssets}`} icon={Car} tone="accent" />
                </div>
                <Card pad="none">
                  <div className="px-5 pt-4"><CardHeader title="Inspections in period" /></div>
                  <EnterpriseTable
                    columns={inspectionColumns}
                    data={inspRows}
                    getRowId={(r, i) => String(r.id ?? i)}
                    searchPlaceholder="Search asset, inspector, site"
                    enableExport={false}
                    emptyMessage="No inspections were recorded in this period."
                  />
                </Card>
              </div>
            )}

            {activeTab === 'sites' && (
              <div className="space-y-6">
                <Card>
                  <CardHeader icon={MapPin} title="Tread compliance by site" description="Worst first. Sites with no tread reading are listed in the table as N/A." />
                  <div className="h-72">
                    {siteChartData
                      ? <Bar data={siteChartData} aria-label="Tread compliance by site chart" options={{ ...BASE_OPTS, indexAxis: 'y', plugins: { ...BASE_OPTS.plugins, legend: { display: false } }, scales: { x: { ...BASE_OPTS.scales.x, min: 0, max: 100 }, y: BASE_OPTS.scales.y } }} />
                      : <ChartEmpty>No site has a tread reading in this scope.</ChartEmpty>}
                  </div>
                </Card>
                <Card pad="none">
                  <EnterpriseTable
                    columns={siteColumns}
                    data={compliance.siteTread}
                    getRowId={(r) => r.site}
                    searchPlaceholder="Search site"
                    enableExport={false}
                    emptyMessage="No sites in scope."
                  />
                </Card>
              </div>
            )}

            {activeTab === 'trends' && (
              <div className="grid grid-cols-1 gap-6">
                <Card>
                  <CardHeader title="Critical risk and inspections, last 6 months" description="Critical share is over risk-rated tyres only; months with none rated are left as gaps." />
                  <div className="h-64">
                    <Bar data={trendChartData} aria-label="Critical risk and inspection trend chart" options={{
                      ...BASE_OPTS,
                      scales: {
                        x: BASE_OPTS.scales.x,
                        y: { ...BASE_OPTS.scales.y, beginAtZero: true, title: { display: true, text: 'Critical %', color: TICK } },
                        y1: { position: 'right', beginAtZero: true, ticks: { color: TICK, precision: 0 }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Inspections', color: TICK } },
                      },
                    }} />
                  </div>
                  {!trendHasRisk && <p className="text-xs text-[var(--text-muted)] mt-2">No risk ratings in the last six months, so only inspection counts are drawn.</p>}
                </Card>
                <Card>
                  <CardHeader title="Accident tyre correlation" description="Share of accidents on assets carrying a High or Critical tyre." />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <StatTile label="Accidents" value={compliance.accidents} icon={Car} tone="warn" />
                    <StatTile label="On risky tyres" value={compliance.accidentsWithTyreIssue == null ? NA : compliance.accidentsWithTyreIssue} icon={AlertTriangle} tone="warn" />
                    <StatTile label="Correlation" value={fmtPct(compliance.accidentCorrelation)} icon={Activity} tone="crit" />
                  </div>
                  <p className="text-[var(--text-muted)] text-sm mt-4">
                    {compliance.accidentCorrelation == null
                      ? (compliance.accidents ? 'Not measurable: no tyre in scope carries a risk rating, so accidents cannot be linked to tyre risk.' : 'No accidents were recorded in this period.')
                      : compliance.accidentCorrelation > 50
                        ? 'High: more than half of recorded accidents were on vehicles with High or Critical tyres. Review tyre management now.'
                        : compliance.accidentCorrelation > 25
                          ? 'Moderate: a significant share of accidents involved vehicles with tyre risk. Review maintenance schedules.'
                          : 'Low: most accidents did not involve vehicles with high risk tyres. Continue monitoring.'}
                  </p>
                </Card>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
