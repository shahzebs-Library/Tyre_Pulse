import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  TrendingUp, TrendingDown, Minus, Calendar, FileSpreadsheet, FileText, AlertTriangle,
  Package, DollarSign, BarChart2, Activity, Target, MapPin, Tag, Layers, Mail, RefreshCw, Info,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import EmailReportModal from '../components/EmailReportModal'
import { supabase } from '../lib/supabase'
import { toUserMessage } from '../lib/safeError'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import LoadingState from '../components/LoadingState'
import EmptyState from '../components/EmptyState'
import { forecastTyreDemand } from '../lib/tyreDemandForecast'
import { forecastWindow } from '../lib/forecastPeriod'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  buildForecastModel, nextMonthLabels, monthLabel, forecastExportRows,
  FAILURE_ALERT_PCT, CONFIDENCE_BAND,
} from '../lib/forecastingEngineAnalytics'
import TyreForecastSection from '../components/tyre/TyreForecastSection'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

// Chart chrome reads theme tokens (resolved per theme by chartVarPlugin), so the
// same options work in light and dark mode.
const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top', labels: { color: 'var(--text-secondary)', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: 'var(--text-primary)',
      bodyColor: 'var(--text-secondary)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
    y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
  },
}

const HORIZONS = [
  { val: 3, label: 'Next 3 months' },
  { val: 6, label: 'Next 6 months' },
  { val: 12, label: 'Next 12 months' },
]

function fmtNum(n, decimals = 0) {
  if (n == null || Number.isNaN(Number(n))) return 'N/A'
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtMoney(n, currency, compact = false) {
  if (n == null || Number.isNaN(Number(n))) return 'N/A'
  const v = Number(n)
  if (compact && Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(1)}M`
  if (compact && Math.abs(v) >= 1_000) return `${currency} ${(v / 1_000).toFixed(0)}K`
  return `${currency} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

const num = (cell) => <span className="tabular-nums">{fmtNum(cell.getValue())}</span>
const pct = (v) => (v == null ? 'N/A' : `${Math.round(v * 100)}%`)

function Trend({ dir }) {
  if (dir === 'up') return <span className="inline-flex items-center gap-1 text-xs text-red-400"><TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />Rising</span>
  if (dir === 'down') return <span className="inline-flex items-center gap-1 text-xs text-green-400"><TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />Falling</span>
  return <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]"><Minus className="w-3.5 h-3.5" aria-hidden="true" />Flat</span>
}

const TONE_PILL = {
  danger: 'text-red-400 bg-red-950/40 border-red-900/40',
  warning: 'text-amber-400 bg-amber-950/40 border-amber-900/40',
  info: 'text-sky-300 bg-sky-950/40 border-sky-900/40',
  good: 'text-green-400 bg-green-950/40 border-green-900/40',
  quiet: 'text-[var(--text-muted)] bg-[var(--input-bg)] border-[var(--input-border)]',
}
const PRIORITY_TONE = { High: 'danger', Medium: 'warning', Low: 'good' }

function Pill({ tone, children }) {
  return <span className={`text-xs px-2 py-0.5 rounded border ${TONE_PILL[tone] || TONE_PILL.quiet}`}>{children}</span>
}

function Notice({ tone = 'warning', children }) {
  const cls = tone === 'danger'
    ? 'bg-red-950/30 border-red-800/50 text-red-300'
    : 'bg-amber-950/30 border-amber-800/50 text-amber-300'
  return (
    <div role="status" className={`flex items-start gap-2 border rounded-xl p-4 text-sm ${cls}`}>
      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}

function SectionCard({ title, icon: Icon, children, note }) {
  return (
    <section className="card">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
      </div>
      {note && <p className="text-xs text-[var(--text-muted)] mb-3">{note}</p>}
      {!note && <div className="mb-3" />}
      {children}
    </section>
  )
}

export default function ForecastingEngine() {
  const { activeCurrency, activeCountry } = useSettings()
  const moneyAllowed = !!activeCountry && activeCountry !== 'All'
  const currency = activeCurrency

  const [records, setRecords] = useState([])
  const [fleet, setFleet] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [horizon, setHorizon] = useState(12)
  const [siteFilter, setSiteFilter] = useState('all')
  const [emailModalOpen, setEmailModalOpen] = useState(false)

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    async function load() {
      try {
        const cf = activeCountry !== 'All' ? activeCountry : null
        const [recRes, fleetRes] = await Promise.all([
          fetchAllPages((from, to) => {
            let q = supabase
              .from('tyre_records')
              .select('id,asset_no,site,brand,size,qty,position,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,risk_level,category')
              .order('issue_date', { ascending: true })
              .order('id', { ascending: true })
            // Null-safe country scope (its rows plus NULL-country rows); All = no predicate.
            if (cf) q = q.or(`country.eq.${cf},country.is.null`)
            return q.range(from, to)
          }, { max: 50000 }),
          fetchAllPages((from, to) => {
            let q = supabase
              .from('vehicle_fleet')
              .select('asset_no,site,vehicle_type,expected_km_per_tyre,monthly_tyre_budget,current_km')
            if (cf) q = q.or(`country.eq.${cf},country.is.null`)
            return q.order('asset_no').order('id').range(from, to)
          }, { max: 20000 }),
        ])
        if (cancelled) return
        if (recRes.error) throw recRes.error
        if (fleetRes.error) throw fleetRes.error
        setRecords(recRes.data || [])
        setFleet(fleetRes.data || [])
        setTruncated(!!recRes.truncated)
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Could not load the forecasting data.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeCountry, reloadKey])

  // A site picked under another country must not survive a country switch.
  useEffect(() => { setSiteFilter('all') }, [activeCountry])

  const model = useMemo(
    () => buildForecastModel({ records, fleet, site: siteFilter, horizon, moneyAllowed, now: new Date() }),
    [records, fleet, siteFilter, horizon, moneyAllowed],
  )

  // Tyre demand by size (single country so cost stays in one currency).
  const sizeForecast = useMemo(
    () => (moneyAllowed ? forecastTyreDemand(records, { window: 12, ahead: 3 }) : null),
    [records, moneyAllowed],
  )

  // WHICH months, not just how many. The projection runs forward from the latest
  // month that HAS DATA, so it states the window and warns when that is behind.
  const window12 = useMemo(
    () => forecastWindow({ anchor: model.anchor, historyMonths: 12, ahead: horizon, now: new Date() }),
    [model.anchor, horizon],
  )
  const periodLabel = window12.ok ? window12.label : `Next ${horizon} months`

  const histLabels = useMemo(() => model.keys12.map(monthLabel), [model.keys12])
  const nextLabels = useMemo(() => nextMonthLabels(model.anchor, horizon), [model.anchor, horizon])
  const allLabels = useMemo(() => [...histLabels, ...nextLabels], [histLabels, nextLabels])
  const pad = (n) => Array(n).fill(null)

  const demandChartData = useMemo(() => {
    const fc = model.demandForecast.slice(0, horizon)
    const c0 = colorAt(0), c1 = colorAt(1)
    return {
      labels: allLabels,
      datasets: [
        { label: 'Historical replacements', data: [...model.monthlyDemand, ...pad(horizon)], borderColor: c0, backgroundColor: withAlpha(c0, 0.12), fill: true, tension: 0.3, pointRadius: 3 },
        { label: 'Forecast', data: [...pad(12), ...fc], borderColor: c1, borderDash: [5, 5], tension: 0.3, pointRadius: 2 },
        { label: `Upper band (+${CONFIDENCE_BAND * 100}%)`, data: [...pad(12), ...fc.map((v) => (v == null ? null : v * (1 + CONFIDENCE_BAND)))], borderColor: withAlpha(c1, 0.3), borderDash: [2, 4], fill: '+1', backgroundColor: withAlpha(c1, 0.06), pointRadius: 0, tension: 0.3 },
        { label: `Lower band (-${CONFIDENCE_BAND * 100}%)`, data: [...pad(12), ...fc.map((v) => (v == null ? null : v * (1 - CONFIDENCE_BAND)))], borderColor: withAlpha(c1, 0.3), borderDash: [2, 4], pointRadius: 0, tension: 0.3 },
      ],
    }
  }, [model, horizon, allLabels])

  const budgetChartData = useMemo(() => {
    if (!moneyAllowed || model.annualBudget == null) return null
    const c0 = colorAt(0), c2 = colorAt(2), c3 = colorAt(3)
    return {
      labels: allLabels,
      datasets: [
        { label: 'Historical spend', data: [...model.monthlySpend, ...pad(horizon)], borderColor: c0, backgroundColor: withAlpha(c0, 0.1), fill: true, tension: 0.3, pointRadius: 3 },
        { label: 'Forecast spend', data: [...pad(12), ...model.budgetForecast.slice(0, horizon)], borderColor: c2, borderDash: [5, 5], tension: 0.3, pointRadius: 2 },
        ...(model.fleetMonthlyBudgetTarget != null ? [{
          label: 'Monthly budget target', data: Array(12 + horizon).fill(model.fleetMonthlyBudgetTarget), borderColor: withAlpha(c3, 0.6), borderDash: [8, 4], pointRadius: 0, fill: false,
        }] : []),
      ],
    }
  }, [model, horizon, allLabels, moneyAllowed])

  const failureChartData = useMemo(() => {
    const c3 = colorAt(3), c4 = colorAt(4)
    return {
      labels: allLabels,
      datasets: [
        { label: 'Historical failure rate %', data: [...model.failureHistory, ...pad(horizon)], borderColor: c3, backgroundColor: withAlpha(c3, 0.1), fill: true, tension: 0.3, pointRadius: 3, spanGaps: false },
        { label: 'Forecast failure rate %', data: [...pad(12), ...model.failureForecast.slice(0, horizon)], borderColor: c4, borderDash: [5, 5], tension: 0.3, pointRadius: 2 },
        { label: `${FAILURE_ALERT_PCT}% alert threshold`, data: Array(12 + horizon).fill(FAILURE_ALERT_PCT), borderColor: withAlpha(c3, 0.5), borderDash: [8, 4], pointRadius: 0, fill: false },
      ],
    }
  }, [model, horizon, allLabels])

  const inventoryBarData = useMemo(() => {
    const top = model.siteForecast.slice(0, 12)
    return {
      labels: top.map((s) => s.site),
      datasets: [
        { label: 'Recommended stock (3 months)', data: top.map((s) => s.recommendedStock), backgroundColor: withAlpha(colorAt(0), 0.8), borderRadius: 4 },
        { label: 'Fitted now (stock proxy)', data: top.map((s) => s.currentStock), backgroundColor: withAlpha(colorAt(1), 0.8), borderRadius: 4 },
      ],
    }
  }, [model.siteForecast])

  // ── Tables ───────────────────────────────────────────────────────────────
  const money = useCallback((v) => (moneyAllowed ? fmtMoney(v, currency, true) : 'N/A'), [moneyAllowed, currency])

  const brandColumns = useMemo(() => [
    { id: 'brand', header: 'Brand', accessorKey: 'brand', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'actual12', header: 'Last 12 months', accessorKey: 'actual12', cell: num, meta: { align: 'right' } },
    { id: 'forecast3', header: 'Next 3 months', accessorKey: 'forecast3', cell: num, meta: { align: 'right' } },
    { id: 'forecast12', header: 'Next 12 months', accessorKey: 'forecast12', cell: num, meta: { align: 'right' } },
    { id: 'estCost12', header: `Est. cost 12 months${moneyAllowed ? ` (${currency})` : ''}`, accessorFn: (r) => r.estCost12 ?? -1, cell: ({ row }) => <span className="tabular-nums">{money(row.original.estCost12)}</span>, meta: { align: 'right', exportValue: (r) => r.estCost12 ?? 'N/A' } },
    { id: 'trend', header: 'Trend', accessorKey: 'trend', cell: ({ row }) => <Trend dir={row.original.trend} /> },
  ], [money, moneyAllowed, currency])

  const siteColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorKey: 'site', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'actual12', header: 'Last 12 months', accessorKey: 'actual12', cell: num, meta: { align: 'right' } },
    { id: 'forecast3', header: 'Next 3 months', accessorKey: 'forecast3', cell: num, meta: { align: 'right' } },
    { id: 'forecast12', header: 'Next 12 months', accessorKey: 'forecast12', cell: num, meta: { align: 'right' } },
    { id: 'estCost12', header: `Est. cost${moneyAllowed ? ` (${currency})` : ''}`, accessorFn: (r) => r.estCost12 ?? -1, cell: ({ row }) => <span className="tabular-nums">{money(row.original.estCost12)}</span>, meta: { align: 'right', exportValue: (r) => r.estCost12 ?? 'N/A' } },
    { id: 'trend', header: 'Trend', accessorKey: 'trend', cell: ({ row }) => <Trend dir={row.original.trend} /> },
  ], [money, moneyAllowed, currency])

  const inventoryColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorKey: 'site', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'recommendedStock', header: 'Recommended', accessorKey: 'recommendedStock', cell: num, meta: { align: 'right' } },
    { id: 'currentStock', header: 'Fitted now', accessorKey: 'currentStock', cell: num, meta: { align: 'right' } },
    { id: 'stockGap', header: 'Gap', accessorKey: 'stockGap', meta: { align: 'right' }, cell: ({ getValue }) => { const g = getValue(); return <span className="tabular-nums font-medium">{g > 0 ? `+${fmtNum(g)}` : fmtNum(g)}</span> } },
    { id: 'status', header: 'Status', accessorFn: (r) => r.status.label, meta: { filterVariant: 'select' }, cell: ({ row }) => <Pill tone={row.original.status.tone}>{row.original.status.label}</Pill> },
  ], [])

  const vendorColumns = useMemo(() => [
    { id: 'brand', header: 'Brand', accessorKey: 'brand', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'forecast3', header: 'Qty needed (3 months)', accessorKey: 'forecast3', cell: num, meta: { align: 'right' } },
    { id: 'forecast12', header: 'Qty needed (12 months)', accessorKey: 'forecast12', cell: num, meta: { align: 'right' } },
    { id: 'estCost12', header: `Est. cost 12 months${moneyAllowed ? ` (${currency})` : ''}`, accessorFn: (r) => r.estCost12 ?? -1, cell: ({ row }) => <span className="tabular-nums">{money(row.original.estCost12)}</span>, meta: { align: 'right', exportValue: (r) => r.estCost12 ?? 'N/A' } },
    { id: 'priority', header: 'Priority', accessorKey: 'priority', meta: { filterVariant: 'select' }, cell: ({ getValue }) => <Pill tone={PRIORITY_TONE[getValue()]}>{getValue()}</Pill> },
  ], [money, moneyAllowed, currency])

  // ── Exports ──────────────────────────────────────────────────────────────
  const fileBase = reportFileName('Forecasting Engine', activeCountry, siteFilter !== 'all' ? siteFilter : '', window12.ok ? `${window12.forecastFrom} to ${window12.forecastTo}` : '')

  function handleExportExcel() {
    const rows = forecastExportRows(model, horizon, nextLabels)
    exportToExcel(
      rows,
      ['month', 'demand_forecast', 'budget_forecast', 'failure_rate_forecast'],
      ['Month', 'Demand forecast (tyres)', moneyAllowed ? `Budget forecast (${currency})` : 'Budget forecast (N/A, pick a country)', 'Failure rate forecast'],
      fileBase,
      'Forecast',
    )
  }

  const brandPdfRows = model.brands.map((b) => ({
    brand: b.brand,
    actual12: fmtNum(b.actual12),
    forecast3: fmtNum(b.forecast3),
    forecast12: fmtNum(b.forecast12),
    estCost12: money(b.estCost12),
  }))
  const BRAND_PDF_COLS = [
    { key: 'brand', header: 'Brand' },
    { key: 'actual12', header: 'Last 12 months' },
    { key: 'forecast3', header: 'Next 3 months' },
    { key: 'forecast12', header: 'Next 12 months' },
    { key: 'estCost12', header: 'Est. cost 12 months' },
  ]

  function handleExportPdf() {
    exportToPdf(brandPdfRows, BRAND_PDF_COLS, `Brand demand forecast. ${periodLabel}`, fileBase, 'landscape', '', {
      currency: moneyAllowed ? currency : undefined,
      subtitleNote: moneyAllowed ? `${activeCountry} in ${currency}` : 'All countries: money withheld, currencies are not added together',
    })
  }

  // ── Render guards ────────────────────────────────────────────────────────
  if (loading) return <LoadingState message="Loading forecasting data..." />

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState icon={AlertTriangle} title="Forecasting data could not be read" description={error} action={{ label: 'Retry', onClick: retry }} />
      </div>
    )
  }

  if (!records.length) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState icon={BarChart2} title="No tyre records found" description="Add tyre records to generate demand, budget and inventory forecasts." action={{ label: 'Reload', onClick: retry }} />
      </div>
    )
  }

  const confidenceTone = model.confidence == null ? 'neutral' : model.confidence >= 75 ? 'accent' : model.confidence >= 50 ? 'warn' : 'crit'

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Forecasting Engine"
        subtitle="Demand, budget and inventory forecasts to support proactive planning"
        icon={TrendingUp}
        actions={<>
          <button type="button" onClick={retry} className="btn-secondary gap-1.5 min-h-[44px]">
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
          </button>
          <button type="button" onClick={handleExportExcel} className="btn-secondary gap-1.5 min-h-[44px]">
            <FileSpreadsheet className="w-4 h-4" aria-hidden="true" /> Excel
          </button>
          <button type="button" onClick={handleExportPdf} className="btn-secondary gap-1.5 min-h-[44px]">
            <FileText className="w-4 h-4" aria-hidden="true" /> PDF
          </button>
          <button type="button" onClick={() => setEmailModalOpen(true)} className="btn-secondary gap-1.5 min-h-[44px]">
            <Mail className="w-4 h-4" aria-hidden="true" /> Email report
          </button>
        </>}
      />

      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-4">
        <div className="min-w-[180px]">
          <label htmlFor="fc-site" className="label text-xs">Site</label>
          <select id="fc-site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className="input text-sm min-h-[44px]">
            <option value="all">All sites</option>
            {model.sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <span id="fc-horizon" className="label text-xs">Horizon</span>
          <div role="group" aria-labelledby="fc-horizon" className="flex flex-wrap gap-1 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-1">
            {HORIZONS.map((h) => (
              <button
                key={h.val}
                type="button"
                aria-pressed={horizon === h.val}
                onClick={() => setHorizon(h.val)}
                className={`px-4 min-h-[40px] text-sm rounded-lg transition-colors font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                  horizon === h.val ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-[var(--text-secondary)] basis-full">
          <span className="text-[var(--text-muted)]">Period: </span>
          <span className="font-medium text-[var(--text-primary)]">{periodLabel}</span>
          <span className="text-[var(--text-muted)]"> | {fmtNum(model.hist12Count)} records in the 12-month history{siteFilter !== 'all' ? ` at ${siteFilter}` : ''}</span>
        </p>
      </div>

      {window12.note && <Notice>{window12.note}</Notice>}
      {!moneyAllowed && (
        <Notice>
          All countries is selected. Each country reports in its own currency, so every spend and budget figure is withheld (N/A) rather than added across SAR, AED and EGP. Demand, inventory and failure forecasts still cover all countries. Pick a country for money.
        </Notice>
      )}
      {truncated && (
        <Notice>Capped view: only the first 50,000 tyre records were loaded, so these forecasts may be incomplete. Narrow the country to see full detail.</Notice>
      )}
      {moneyAllowed && model.pricedShare != null && model.pricedShare < 1 && (
        <div role="status" className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>{pct(model.pricedShare)} of tyres in the history carry a price. Spend and cost figures are built from priced tyres only; unpriced tyres are not counted as free.</span>
        </div>
      )}
      {model.failureAlert && (
        <Notice tone="danger">
          <strong>Failure rate alert.</strong> The forecast failure rate exceeds {FAILURE_ALERT_PCT}% within the selected horizon. Review maintenance protocols and inspection compliance.
        </Notice>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatTile index={0} icon={Package} tone="info" label="12-month demand" value={fmtNum(model.annualDemand)} unit="tyres" sub="Projected replacements" />
        <StatTile index={1} icon={DollarSign} tone="accent" label="12-month budget" value={money(model.annualBudget)} sub={moneyAllowed ? 'Projected spend' : 'Pick a country'} />
        <StatTile index={2} icon={Activity} tone="neutral" label="Monthly avg demand" value={fmtNum(model.monthlyAvgDemand, 1)} unit="tyres" />
        <StatTile index={3} icon={Target} tone="neutral" label="Monthly avg budget" value={money(model.monthlyAvgBudget)} sub={moneyAllowed ? 'Avg monthly spend' : 'Pick a country'} />
        <StatTile index={4} icon={BarChart2} tone={confidenceTone} label="Model confidence" value={model.confidence == null ? 'N/A' : `${model.confidence}%`} sub={model.confidence == null ? 'Needs 6 months of history' : '3-month back-test (MAPE)'} />
      </div>

      <SectionCard title="Demand forecast: monthly replacement projections" icon={TrendingUp} note={`${periodLabel}. Solid line is history, dashed is forecast, shaded band is +/-${CONFIDENCE_BAND * 100}%.`}>
        <div className="h-72" role="img" aria-label={`Monthly tyre replacements for the last 12 months and a ${horizon}-month forecast totalling ${fmtNum(model.demandForecast.slice(0, horizon).reduce((s, v) => s + (v || 0), 0))} tyres.`}>
          <Line
            data={demandChartData}
            options={{
              ...BASE_OPTS,
              plugins: { ...BASE_OPTS.plugins, tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)} tyres` } } },
              scales: { ...BASE_OPTS.scales, y: { ...BASE_OPTS.scales.y, title: { display: true, text: 'Tyres', color: 'var(--text-muted)', font: { size: 10 } } } },
            }}
          />
        </div>
      </SectionCard>

      <SectionCard title="Budget forecast: monthly spend projections" icon={DollarSign} note={moneyAllowed ? `${periodLabel}. In ${currency}, priced tyres only.` : 'Withheld on the All countries view: currencies are never added together.'}>
        {budgetChartData ? (
          <>
            <div className="h-72" role="img" aria-label={`Monthly tyre spend in ${currency} with a ${horizon}-month forecast.`}>
              <Line
                data={budgetChartData}
                options={{
                  ...BASE_OPTS,
                  plugins: { ...BASE_OPTS.plugins, tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y, currency, true)}` } } },
                  scales: { ...BASE_OPTS.scales, y: { ...BASE_OPTS.scales.y, ticks: { ...BASE_OPTS.scales.y.ticks, callback: (v) => fmtMoney(v, currency, true) } } },
                }}
              />
            </div>
            {model.fleetMonthlyBudgetTarget != null && (
              <p className="text-xs text-[var(--text-muted)] mt-2">Fleet monthly budget target: {fmtMoney(model.fleetMonthlyBudgetTarget, currency)} (from the vehicle master)</p>
            )}
          </>
        ) : (
          <EmptyState compact icon={DollarSign} title={moneyAllowed ? 'No priced tyres in the history' : 'Pick a country to see spend'} description={moneyAllowed ? 'None of the tyres in the last 12 months carries a price, so spend cannot be projected.' : 'Spend is reported per country in its own currency.'} />
        )}
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SectionCard title="Brand demand forecast" icon={Tag} note="Tyres per brand, last 12 months and projected.">
          <EnterpriseTable
            columns={brandColumns}
            data={model.brands}
            getRowId={(r) => String(r.brand)}
            enableColumnFilters={false}
            searchPlaceholder="Search brands"
            exportFileName={reportFileName(fileBase, 'brands')}
            initialPageSize={25}
            emptyMessage="No brand is recorded on the tyres in this window."
          />
        </SectionCard>
        <SectionCard title="Site demand forecast" icon={MapPin} note="Tyres per site, last 12 months and projected.">
          <EnterpriseTable
            columns={siteColumns}
            data={model.siteForecast}
            getRowId={(r) => String(r.site)}
            enableColumnFilters={false}
            searchPlaceholder="Search sites"
            exportFileName={reportFileName(fileBase, 'sites')}
            initialPageSize={25}
            emptyMessage="No site is recorded on the tyres in this window."
          />
        </SectionCard>
      </div>

      <SectionCard title="Inventory requirement (3-month demand x 1.2 safety stock)" icon={Layers} note="Fitted now counts tyres currently on vehicles at the site. It is a proxy for stock, not a store count.">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <EnterpriseTable
            columns={inventoryColumns}
            data={model.siteForecast}
            getRowId={(r) => String(r.site)}
            searchPlaceholder="Search sites"
            exportFileName={reportFileName(fileBase, 'inventory')}
            initialPageSize={25}
            emptyMessage="No site data in this window."
          />
          <div className="h-72" role="img" aria-label="Recommended stock versus tyres fitted now, top 12 sites.">
            {model.siteForecast.length > 0 ? (
              <Bar data={inventoryBarData} options={{ ...BASE_OPTS, indexAxis: 'y' }} />
            ) : (
              <EmptyState compact icon={Layers} title="No inventory data" description="No site carries tyres in this window." />
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Failure rate forecast" icon={AlertTriangle} note={`${periodLabel}. A month with no tyre records has no rate and is left blank, not drawn as 0%.`}>
        <div className="h-64" role="img" aria-label={`Monthly failure rate with a ${horizon}-month forecast and a ${FAILURE_ALERT_PCT}% alert threshold.`}>
          <Line
            data={failureChartData}
            options={{
              ...BASE_OPTS,
              plugins: { ...BASE_OPTS.plugins, tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y != null ? `${ctx.parsed.y.toFixed(1)}%` : 'N/A'}` } } },
              scales: { ...BASE_OPTS.scales, y: { ...BASE_OPTS.scales.y, min: 0, ticks: { ...BASE_OPTS.scales.y.ticks, callback: (v) => `${v}%` } } },
            }}
          />
        </div>
      </SectionCard>

      <SectionCard title="Vendor (brand) requirement summary" icon={Package} note="Priority: High above 50 tyres in 12 months, Medium above 20.">
        <EnterpriseTable
          columns={vendorColumns}
          data={model.brands}
          getRowId={(r) => String(r.brand)}
          searchPlaceholder="Search brands"
          exportFileName={reportFileName(fileBase, 'vendors')}
          initialPageSize={25}
          emptyMessage="No brand is recorded on the tyres in this window."
        />
      </SectionCard>

      <section className="card">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-[var(--accent)]" aria-hidden="true" />
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Annual budget planning summary</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile index={5} icon={DollarSign} tone="accent" label="Total annual forecast spend" value={money(model.annualBudget)} sub={`${fmtNum(model.annualDemand)} projected replacements`} />
          <StatTile index={6} icon={Calendar} tone="neutral" label="Last year actual" value={money(model.lastYearActual)}
            sub={model.budgetChange == null ? 'No priced tyres in the prior 12 months' : `${model.budgetChange > 0 ? 'Up' : 'Down'} ${Math.abs(model.budgetChange).toFixed(1)}% year on year`} />
          <StatTile index={7} icon={Target} tone="neutral" label="Monthly budget target" value={money(model.fleetMonthlyBudgetTarget)} sub={model.fleetMonthlyBudgetTarget == null ? 'No target in the fleet master' : 'From the fleet master'}
            />
          <StatTile index={8} icon={AlertTriangle} tone={model.monthsOverBudget ? 'warn' : 'neutral'} label="Months over budget" value={model.monthsOverBudget == null ? 'N/A' : fmtNum(model.monthsOverBudget)} sub={model.monthsOverBudget == null ? 'Needs a target and priced spend' : `of ${horizon} forecast months`} />
          <StatTile index={9} icon={TrendingUp} tone="accent" label="Recommended annual budget" value={money(model.recommendedAnnualBudget)} sub="Forecast plus 10% buffer" />
          <StatTile index={10} icon={DollarSign} tone="neutral" label="Avg cost per tyre" value={moneyAllowed ? fmtMoney(model.avgCostPerTyre, currency) : 'N/A'} sub={`Priced share ${pct(model.pricedShare)}`} />
          <StatTile index={11} icon={Tag} tone="neutral" label="Active brands" value={fmtNum(model.brands.length)} />
          <StatTile index={12} icon={MapPin} tone="neutral" label="Active sites" value={fmtNum(model.siteForecast.length)} sub={`${fmtNum(records.length)} records analysed`} />
        </div>
      </section>

      {moneyAllowed && sizeForecast && (
        <TyreForecastSection
          forecast={sizeForecast}
          country={activeCountry}
          currency={currency}
          money={(v) => fmtMoney(v, currency)}
          filePrefix="Forecast"
        />
      )}

      <EmailReportModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        reportTitle="Forecasting Engine Report"
        pdfColumns={BRAND_PDF_COLS.map((c) => c.header)}
        pdfRows={brandPdfRows.map((r) => BRAND_PDF_COLS.map((c) => r[c.key]))}
        kpiSummary={{
          'Period': periodLabel,
          'Scope': moneyAllowed ? `${activeCountry} (${currency})` : 'All countries (money withheld)',
          '12-month demand forecast': fmtNum(model.annualDemand),
          '12-month budget forecast': money(model.annualBudget),
          'Monthly avg demand': fmtNum(model.monthlyAvgDemand, 1),
          'Monthly avg budget': money(model.monthlyAvgBudget),
          'Model confidence': model.confidence != null ? `${model.confidence}%` : 'N/A',
          'Recommended annual budget': money(model.recommendedAnnualBudget),
        }}
        period={periodLabel}
      />
    </div>
  )
}
