/**
 * TyreFailureCpkBoard - a customizable "Tyre Failure & CPK" board over the
 * tyre_records lifecycle data (active vs removed, removal reasons, CPK by brand
 * and site, tyre life, worst-cost assets).
 *
 * Mirrors BoardOverview.jsx: section toggles (persisted), colourful KPI tiles,
 * chart cards, honest empty/loading/error states, PDF export via chart capture,
 * and an Excel export. All numbers come from the shared CPK engine (kpiEngine)
 * via the pure tyreFailureBoard engine - nothing is fabricated; an empty scope
 * renders an honest "N/A" / empty state. Colours use the single shared palette
 * (reportColors) so it reads as one system. No em/en dashes.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  AlertTriangle, Gauge, PieChart, TrendingUp, Download, RefreshCw, Eye, EyeOff,
  Table, FileSpreadsheet,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { listAllRecords } from '../lib/api/tyreRecords'
import { buildTyreFailureBoard } from '../lib/tyreFailureBoard'
import { stylize, ACCENTS } from '../lib/reportColors'
import { reportFileName, reportDateLabel, exportToExcel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const LS_KEY = 'tyreFailureBoard.sections.v1'
const SECTIONS = [
  ['kpis', 'KPIs', Gauge],
  ['failure', 'Failures', AlertTriangle],
  ['cpk', 'CPK', TrendingUp],
  ['life', 'Tyre life', PieChart],
  ['assets', 'Worst assets', Table],
]
const SECTION_DEFAULTS = { kpis: true, failure: true, cpk: true, life: true, assets: true }

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${Number(v)}%`)

const chartBase = (legend = false) => ({
  responsive: true,
  maintainAspectRatio: false,
  layout: { padding: { top: 8 } },
  plugins: {
    legend: { display: legend, labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: 'var(--panel-2)', titleColor: 'var(--panel-ink)', bodyColor: '#9ca3af', borderColor: 'var(--hairline)', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.12)' } },
    y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
  },
})
const HBAR_OPTS = { ...chartBase(false), indexAxis: 'y' }
const DOUGHNUT_OPTS = {
  responsive: true, maintainAspectRatio: false, cutout: '58%',
  plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
}

/** Colourful KPI tile. */
function Kpi({ label, value, accent = ACCENTS.primary, sub }) {
  return (
    <div className="card" style={{ borderTop: `3px solid ${accent}` }}>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
      <p className="text-xs text-[var(--text-muted)] mt-1">{label}</p>
      {sub ? <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p> : null}
    </div>
  )
}

function ChartCard({ title, children, refCb }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      <div style={{ height: 240 }} ref={refCb}>{children}</div>
    </div>
  )
}

const hasChartData = (cd) => !!(cd && Array.isArray(cd.labels) && cd.labels.length)

export default function TyreFailureCpkBoard() {
  const { activeCountry, appSettings, activeCurrency } = useSettings()
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [exporting, setExporting] = useState(false)

  const [sections, setSections] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
      return { ...SECTION_DEFAULTS, ...(raw || {}) }
    } catch { return { ...SECTION_DEFAULTS } }
  })
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(sections)) } catch { /* ignore */ } }, [sections])
  const toggle = (key) => setSections((s) => ({ ...s, [key]: !s[key] }))

  const chartRefs = useRef({})
  const setRef = (key) => (el) => { chartRefs.current[key] = el }

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const { data } = await listAllRecords({ country: activeCountry })
      setBoard(buildTyreFailureBoard(data || []))
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the tyre failure and CPK board.'))
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const k = board?.kpis
  const money = useCallback((v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v), activeCurrency, 0)), [activeCurrency])
  const hasAny = !!(k && k.totalCount)

  // Build the PDF doc (shared shape with BoardOverview: KPI tiles + captured charts).
  const buildDoc = useCallback(async () => {
    if (!board) return null
    const { captureChartOnPaper } = await import('../lib/chartCapture')
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    const M = 12
    const company = appSettings?.company_name || 'TyrePulse'
    const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
    doc.setFontSize(16); doc.setTextColor(15, 23, 42)
    doc.text(`${company} - Tyre Failure & CPK`, M, 16)
    doc.setFontSize(9); doc.setTextColor(100, 116, 139)
    doc.text(`${scope}  |  ${reportDateLabel(new Date())}`, M, 22)

    const tiles = [
      ['Total tyres', num(k.totalCount)], ['Active', num(k.activeCount)],
      ['Removed', num(k.removedCount)], ['Fleet avg CPK', money(k.fleetAvgCpk)],
      ['Avg life km', num(k.avgLifeKm)], ['Failure rate', pct(k.failureRatePct)],
    ]
    let y = 30
    tiles.forEach((t, i) => {
      const col = i % 6
      const x = M + col * ((W - 2 * M) / 6)
      doc.setTextColor(15, 23, 42); doc.setFontSize(11); doc.text(String(t[1]), x, y + 6)
      doc.setTextColor(100, 116, 139); doc.setFontSize(7.5); doc.text(String(t[0]), x, y + 11)
    })
    y += 20

    const order = ['status', 'reasons', 'cpkBrand', 'cpkSite', 'lifeBrand', 'position']
    let placed = 0
    for (const key of order) {
      const el = chartRefs.current[key]
      const canvas = el?.querySelector?.('canvas')
      if (!canvas) continue
      const img = captureChartOnPaper(canvas) || canvas.toDataURL('image/png', 1)
      if (!img) continue
      const cw = (W - 2 * M - 8) / 2
      const ch = 55
      const col = placed % 2
      const rowY = y + Math.floor(placed / 2) * (ch + 6)
      if (rowY + ch > doc.internal.pageSize.getHeight() - 10) { doc.addPage('a4', 'landscape'); y = 14; placed = 0 }
      const x = M + col * (cw + 8)
      const yy = y + Math.floor(placed / 2) * (ch + 6)
      doc.addImage(img, 'PNG', x, yy, cw, ch)
      placed += 1
    }
    return { doc, company }
  }, [board, appSettings, activeCountry, k, money])

  async function exportPdf() {
    if (!board) return
    setExporting(true)
    try {
      const built = await buildDoc()
      if (built) built.doc.save(`${reportFileName(built.company, 'Tyre Failure CPK', reportDateLabel())}.pdf`)
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  async function exportExcel() {
    if (!board) return
    setExporting(true)
    try {
      const company = appSettings?.company_name || 'TyrePulse'
      // Worst-cost assets sheet.
      const assetRows = (board.worstAssets || []).map((a) => ({
        asset_no: a.asset_no,
        avgCpk: a.avgCpk,
        totalCost: a.totalCost,
        count: a.count,
      }))
      const reasonRows = (board.failureReasons?.labels || []).map((label, i) => ({
        reason: label,
        removed: board.failureReasons.datasets[0].data[i],
      }))
      const rows = [
        ...assetRows.map((r) => ({ ...r, section: 'Worst assets' })),
        ...reasonRows.map((r) => ({ section: 'Failure reasons', reason: r.reason, count: r.removed })),
      ]
      await exportToExcel(
        rows,
        ['section', 'asset_no', 'avgCpk', 'totalCost', 'count', 'reason'],
        ['Section', 'Asset', 'Avg CPK', 'Total cost', 'Count', 'Reason'],
        reportFileName(company, 'Tyre Failure CPK', reportDateLabel()),
      )
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Tyre Failure & CPK" subtitle="Removals, failure reasons and cost per km across the tyre fleet" icon={AlertTriangle} />

      {/* Section toggles + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {SECTIONS.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${sections[key] ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}
            >
              <Icon size={13} /> {label} {sections[key] ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && <span className="text-[11px] text-[var(--text-muted)]">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button onClick={load} disabled={refreshing} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={exportExcel} disabled={exporting || !hasAny} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <FileSpreadsheet size={14} /> Excel
          </button>
          <button onClick={exportPdf} disabled={exporting || !hasAny} className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download size={14} /> {exporting ? 'Preparing...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {error && <div className="card border border-red-700/50 text-red-300 text-sm">{error}</div>}
      {loading ? (
        <div className="card text-center text-[var(--text-muted)] py-10">Loading the tyre failure and CPK board...</div>
      ) : !hasAny ? (
        <div className="card text-center text-[var(--text-muted)] py-10">No tyre records yet for the selected scope. Records will appear here as they are captured.</div>
      ) : (
        <>
          {/* KPIs */}
          {sections.kpis && k && (
            <section className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="Total tyres" value={num(k.totalCount)} accent={ACCENTS.primary} sub={`${num(k.withPriceCount)} with price`} />
                <Kpi label="Active" value={num(k.activeCount)} accent={ACCENTS.good} />
                <Kpi label="Removed" value={num(k.removedCount)} accent={ACCENTS.risk} />
                <Kpi label="Fleet avg CPK" value={money(k.fleetAvgCpk)} accent={ACCENTS.info} />
                <Kpi label="Avg life km" value={num(k.avgLifeKm)} accent={ACCENTS.watch} />
                <Kpi label="Failure rate" value={pct(k.failureRatePct)} accent={ACCENTS.risk} />
              </div>
            </section>
          )}

          {/* Failures */}
          {sections.failure && board && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><AlertTriangle size={15} /> Failures & removals</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Status split" refCb={setRef('status')}>
                  <Doughnut data={stylize(board.statusSplit, 'doughnut')} options={DOUGHNUT_OPTS} />
                </ChartCard>
                <ChartCard title="Removal reasons" refCb={setRef('reasons')}>
                  {hasChartData(board.failureReasons)
                    ? <Doughnut data={stylize(board.failureReasons, 'doughnut')} options={DOUGHNUT_OPTS} />
                    : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No removals recorded.</div>}
                </ChartCard>
                <div className="lg:col-span-2">
                  <ChartCard title="Removed tyres by position" refCb={setRef('position')}>
                    {hasChartData(board.byPosition)
                      ? <Bar data={stylize(board.byPosition, 'bar')} options={chartBase(false)} />
                      : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No removals recorded.</div>}
                  </ChartCard>
                </div>
              </div>
            </section>
          )}

          {/* CPK */}
          {sections.cpk && board && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><TrendingUp size={15} /> Cost per km</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="CPK by brand" refCb={setRef('cpkBrand')}>
                  {hasChartData(board.cpkByBrand)
                    ? <Bar data={stylize(board.cpkByBrand, 'bar')} options={HBAR_OPTS} />
                    : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Not enough priced records to compute CPK.</div>}
                </ChartCard>
                <ChartCard title="CPK by site" refCb={setRef('cpkSite')}>
                  {hasChartData(board.cpkBySite)
                    ? <Bar data={stylize(board.cpkBySite, 'bar')} options={HBAR_OPTS} />
                    : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Not enough priced records to compute CPK.</div>}
                </ChartCard>
              </div>
            </section>
          )}

          {/* Tyre life */}
          {sections.life && board && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><PieChart size={15} /> Tyre life</h2>
              <ChartCard title="Average life (km) by brand" refCb={setRef('lifeBrand')}>
                {hasChartData(board.lifeByBrand)
                  ? <Bar data={stylize(board.lifeByBrand, 'bar')} options={HBAR_OPTS} />
                  : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No fitment/removal km recorded to compute tyre life.</div>}
              </ChartCard>
            </section>
          )}

          {/* Worst assets */}
          {sections.assets && board && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Table size={15} /> Worst-cost assets</h2>
              <div className="card overflow-x-auto">
                {board.worstAssets.length === 0 ? (
                  <div className="text-center text-[var(--text-muted)] py-6 text-sm">Not enough priced records to rank assets by CPK.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                        <th className="py-2 pr-4 font-semibold">Asset</th>
                        <th className="py-2 pr-4 font-semibold text-right">Avg CPK</th>
                        <th className="py-2 pr-4 font-semibold text-right">Total cost</th>
                        <th className="py-2 pr-4 font-semibold text-right">Tyres</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.worstAssets.map((a) => (
                        <tr key={a.asset_no} className="border-b border-[var(--hairline)]/50">
                          <td className="py-2 pr-4 text-[var(--text-primary)] font-medium">{a.asset_no}</td>
                          <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">{money(a.avgCpk)}</td>
                          <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">{money(a.totalCost)}</td>
                          <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">{num(a.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
