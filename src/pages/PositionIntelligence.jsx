import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import {
  MapPin, RefreshCw, AlertTriangle, Download, FileText, Info, Activity, Gauge,
  Truck, Layers, BarChart2, Wrench, Tag, ListChecks, LayoutGrid,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import StatTile from '../components/ui/StatTile'
import FilterBar from '../components/ui/FilterBar'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { toUserMessage } from '../lib/safeError'
import { useSettings, COUNTRIES, COUNTRY_CURRENCY } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  groupMetrics, positionCodeMetrics, siteGroupMatrix, brandsForGroup, assetsForGroup,
  monthlyRemovals, filterRecords, fleetPositionKpis, positionInsights, positionExportRows,
  POSITION_EXPORT_COLS, POSITION_EXPORT_HEADERS,
} from '../lib/positionIntelligenceAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

const loadExportUtils = () => import('../lib/exportUtils')

const ROW_CAP = 50000
const COLS = 'id,issue_date,asset_no,serial_no,brand,site,country,cost_per_tyre,qty,km_at_fitment,km_at_removal,removal_date,removal_reason,position,tyre_position,status'

const fmtN = (v, d = 0) => (v == null || !Number.isFinite(v) ? 'N/A' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }))
const fmtPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(d)}%`)
const fmtKm = (v) => (v == null || !Number.isFinite(v) ? 'N/A' : `${Math.round(v).toLocaleString()} km`)
const fmtCpk = (v) => (v == null || !Number.isFinite(v) ? 'N/A' : v.toFixed(4))

const TABS = [
  { key: 'overview', label: 'Axle groups', icon: Layers },
  { key: 'positions', label: 'Wheel positions', icon: MapPin },
  { key: 'sites', label: 'Site matrix', icon: LayoutGrid },
  { key: 'brands', label: 'Brands', icon: Tag },
  { key: 'assets', label: 'Assets', icon: Truck },
  { key: 'findings', label: 'Findings', icon: ListChecks },
]

const DATE_PRESETS = [
  { key: '90', label: '90 days', days: 90 },
  { key: '180', label: '6 months', days: 180 },
  { key: '365', label: '12 months', days: 365 },
  { key: 'all', label: 'All time', days: 0 },
]

function isoDaysAgo(days) {
  if (!days) return ''
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

function chartOptions({ horizontal = false, xTitle = '', yTitle = '', legend = false, pctAxis = false, max } = {}) {
  const axis = (title) => ({
    grid: { color: 'var(--panel-2)' },
    ticks: { color: 'var(--text-muted)', font: { size: 11 } },
    title: title ? { display: true, text: title, color: 'var(--text-muted)', font: { size: 11 } } : { display: false },
  })
  const value = { ...axis(horizontal ? xTitle : yTitle), min: 0, ...(max != null ? { max } : {}) }
  if (pctAxis) value.ticks = { ...value.ticks, callback: (v) => `${v}%` }
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: { legend: { display: legend, labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12 } } },
    scales: horizontal ? { x: value, y: axis(yTitle) } : { x: axis(xTitle), y: value },
  }
}

function Section({ title, subtitle, icon: Icon, actions, children }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            {Icon && <Icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />}{title}
          </h2>
          {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  )
}

function ChartBox({ empty, label, height = 260, children }) {
  if (empty) return <div className="flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4" style={{ height }}>{empty}</div>
  return <div role="img" aria-label={label} style={{ height }}>{children}</div>
}

/** Failure-rate band shown in words and colour. */
function RateBadge({ value, sample }) {
  if (value == null) return <span className="text-xs text-[var(--text-muted)]" title="No removal with a usable reason">N/A</span>
  const band = value >= 30 ? ['Critical', 'bg-red-500/15 text-red-300 border-red-500/40']
    : value >= 15 ? ['Elevated', 'bg-amber-500/15 text-amber-300 border-amber-500/40']
      : ['Normal', 'bg-green-500/15 text-green-300 border-green-500/40']
  return (
    <span className="inline-flex items-center gap-1.5" title={`${sample} removals with a reason`}>
      <span className="tabular-nums text-[var(--text-primary)]">{value.toFixed(1)}%</span>
      <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${band[1]}`}>{band[0]}</span>
    </span>
  )
}

export default function PositionIntelligence() {
  const { activeCountry, appSettings } = useSettings()
  const company = appSettings?.company_name || ''

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [capped, setCapped] = useState(false)
  const reqIdRef = useRef(0)

  const [country, setCountry] = useState(activeCountry !== 'All' ? activeCountry : '')
  const [preset, setPreset] = useState('all')
  const [search, setSearch] = useState('')
  const [site, setSite] = useState('')
  const [group, setGroup] = useState('')
  const [brand, setBrand] = useState('')
  const [tab, setTab] = useState('overview')
  const [brandGroup, setBrandGroup] = useState('Steer')
  const [exportError, setExportError] = useState(null)

  useEffect(() => { setCountry(activeCountry !== 'All' ? activeCountry : '') }, [activeCountry])

  const dateFrom = useMemo(() => isoDaysAgo(DATE_PRESETS.find((p) => p.key === preset)?.days || 0), [preset])

  const load = useCallback(async () => {
    const my = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      // Country and date window applied server-side, bounded, paged with an id
      // tiebreak so a page boundary never drops or repeats a row.
      const { data, error: err, truncated } = await fetchAllPages((f, t) => {
        let q = supabase.from('tyre_records').select(COLS)
        if (country) q = q.eq('country', country)
        if (dateFrom) q = q.gte('issue_date', dateFrom)
        return q.order('issue_date', { ascending: false }).order('id', { ascending: false }).range(f, t)
      }, { max: ROW_CAP })
      if (my !== reqIdRef.current) return
      if (err) throw err
      setRecords(data || [])
      setCapped(Boolean(truncated))
    } catch (e) {
      if (my === reqIdRef.current) setError(toUserMessage(e, 'Could not load position data.'))
    } finally {
      if (my === reqIdRef.current) setLoading(false)
    }
  }, [country, dateFrom])

  useEffect(() => { load() }, [load])

  const sites = useMemo(() => [...new Set(records.map((r) => r.site).filter(Boolean))].sort(), [records])
  const brands = useMemo(() => [...new Set(records.map((r) => String(r.brand || '').trim().toUpperCase()).filter(Boolean))].sort(), [records])

  const filtered = useMemo(() => filterRecords(records, { site, group, brand, search }), [records, site, group, brand, search])
  const kpis = useMemo(() => fleetPositionKpis(filtered), [filtered])
  const groups = useMemo(() => groupMetrics(filtered), [filtered])
  const codes = useMemo(() => positionCodeMetrics(filtered), [filtered])
  const matrix = useMemo(() => siteGroupMatrix(filtered), [filtered])
  const brandRows = useMemo(() => brandsForGroup(filtered, brandGroup), [filtered, brandGroup])
  const assetRows = useMemo(() => assetsForGroup(filtered, group), [filtered, group])
  const trend = useMemo(() => monthlyRemovals(filtered, { now: Date.now() }), [filtered])
  const insights = useMemo(() => positionInsights(filtered), [filtered])
  const groupOptions = useMemo(() => groups.map((g) => g.group), [groups])

  // A recorded tyre price can only be totalled inside one currency.
  const currency = country ? COUNTRY_CURRENCY[country] : null
  const fmtMoney = (v) => (currency && v != null ? formatCurrency(v, currency, 0) : 'N/A')

  const filtersActive = Boolean(search || site || group || brand)
  const clearAll = () => { setSearch(''); setSite(''); setGroup(''); setBrand('') }

  // ── charts ────────────────────────────────────────────────────────────────
  const rateData = useMemo(() => {
    const rows = groups.filter((g) => g.failureRatePct != null)
    return {
      labels: rows.map((g) => g.group),
      datasets: [
        { label: 'Failure removals %', data: rows.map((g) => Number(g.failureRatePct.toFixed(1))), backgroundColor: withAlpha(colorAt(3), 0.75), borderRadius: 3 },
        { label: 'Wear-out removals %', data: rows.map((g) => Number((g.wearRatePct ?? 0).toFixed(1))), backgroundColor: withAlpha(colorAt(1), 0.75), borderRadius: 3 },
      ],
    }
  }, [groups])

  const lifeRows = useMemo(() => groups.filter((g) => g.avgLifeKm != null), [groups])
  const lifeData = useMemo(() => ({
    labels: lifeRows.map((g) => g.group),
    datasets: [{ label: 'Average tyre life (km)', data: lifeRows.map((g) => Math.round(g.avgLifeKm)), backgroundColor: lifeRows.map((_, i) => withAlpha(colorAt(i), 0.75)), borderRadius: 3 }],
  }), [lifeRows])

  const trendData = useMemo(() => ({
    labels: trend.months.map((m) => {
      const [y, mo] = m.split('-')
      return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en', { month: 'short', year: '2-digit' })
    }),
    datasets: trend.series.map((s, i) => ({
      label: s.group, data: s.data, borderColor: colorAt(i), backgroundColor: withAlpha(colorAt(i), 0.1), tension: 0.3, pointRadius: 2,
    })),
  }), [trend])

  // ── table columns ─────────────────────────────────────────────────────────
  const metricCols = useCallback((first) => [
    ...first,
    { id: 'count', header: 'Tyre records', accessorFn: (r) => r.count, size: 110, meta: { align: 'right' } },
    { id: 'removed', header: 'Removed', accessorFn: (r) => r.removed, size: 90, meta: { align: 'right' } },
    { id: 'withReason', header: 'With reason', accessorFn: (r) => r.withReason, size: 100, meta: { align: 'right' } },
    {
      id: 'failure', header: 'Failure removals', accessorFn: (r) => r.failureRatePct ?? -1, size: 170,
      meta: { exportValue: (r) => (r.failureRatePct == null ? 'N/A' : Number(r.failureRatePct.toFixed(1))) },
      cell: ({ row }) => <RateBadge value={row.original.failureRatePct} sample={row.original.withReason} />,
    },
    { id: 'life', header: 'Avg life', accessorFn: (r) => r.avgLifeKm ?? -1, size: 120, meta: { align: 'right', exportValue: (r) => (r.avgLifeKm == null ? 'N/A' : Math.round(r.avgLifeKm)) }, cell: ({ row }) => fmtKm(row.original.avgLifeKm) },
    { id: 'lifeN', header: 'Life sample', accessorFn: (r) => r.lifeSample, size: 100, meta: { align: 'right' } },
    { id: 'cpk', header: 'Avg CPK', accessorFn: (r) => r.avgCpk ?? -1, size: 100, meta: { align: 'right', exportValue: (r) => (r.avgCpk == null ? 'N/A' : Number(r.avgCpk.toFixed(4))) }, cell: ({ row }) => fmtCpk(row.original.avgCpk) },
    { id: 'reason', header: 'Top reason', accessorFn: (r) => r.topReasons[0]?.reason || 'N/A', size: 170 },
  ], [])

  const groupColumns = useMemo(() => metricCols([
    { id: 'group', header: 'Axle group', accessorFn: (r) => r.group, size: 120 },
    { id: 'share', header: 'Share', accessorFn: (r) => r.sharePct ?? 0, size: 80, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.sharePct, 0) },
  ]), [metricCols])

  const codeColumns = useMemo(() => metricCols([
    { id: 'code', header: 'Position', accessorFn: (r) => r.code, size: 90 },
    { id: 'label', header: 'Description', accessorFn: (r) => r.label, size: 200 },
    { id: 'group', header: 'Axle', accessorFn: (r) => r.group, size: 90, meta: { filterVariant: 'select' } },
  ]), [metricCols])

  const brandColumns = useMemo(() => metricCols([
    { id: 'brand', header: 'Brand', accessorFn: (r) => r.brand, size: 150 },
  ]), [metricCols])

  const assetColumns = useMemo(() => metricCols([
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no, size: 110 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 110 },
    { id: 'failures', header: 'Failure removals', accessorFn: (r) => r.failures, size: 130, meta: { align: 'right' } },
  ]), [metricCols])

  const matrixColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: (r) => r.site, size: 150 },
    { id: 'count', header: 'Tyre records', accessorFn: (r) => r.count, size: 110, meta: { align: 'right' } },
    ...matrix.groups.map((g) => ({
      id: g, header: `${g} failure %`, size: 140,
      accessorFn: (r) => r[g]?.failureRatePct ?? -1,
      meta: { align: 'right', exportValue: (r) => (r[g]?.failureRatePct == null ? 'N/A' : Number(r[g].failureRatePct.toFixed(1))) },
      cell: ({ row }) => {
        const c = row.original[g]
        if (!c) return <span className="text-[var(--text-muted)]">None</span>
        if (c.failureRatePct == null) return <span className="text-[var(--text-muted)]" title={`${c.count} records, none with a removal reason`}>N/A</span>
        return <RateBadge value={c.failureRatePct} sample={c.withReason} />
      },
    })),
  ], [matrix.groups])

  // ── exports ───────────────────────────────────────────────────────────────
  const scopeLabel = [country || 'All countries', DATE_PRESETS.find((p) => p.key === preset)?.label, site, group, brand].filter(Boolean).join(' | ')

  async function exportExcel() {
    setExportError(null)
    try {
      const { exportSheetsToExcel, reportFileName, reportDateLabel } = await loadExportUtils()
      const groupRows = groups.map((g) => ({
        group: g.group, count: g.count, removed: g.removed, withReason: g.withReason, failures: g.failures,
        failureRatePct: g.failureRatePct == null ? 'N/A' : Number(g.failureRatePct.toFixed(1)),
        avgLifeKm: g.avgLifeKm == null ? 'N/A' : Math.round(g.avgLifeKm),
        avgCpk: g.avgCpk == null ? 'N/A' : Number(g.avgCpk.toFixed(4)),
        recordedPrice: currency && g.recordedPrice != null ? Math.round(g.recordedPrice) : 'N/A',
      }))
      await exportSheetsToExcel([
        { name: 'Axle groups', rows: groupRows, columns: ['group', 'count', 'removed', 'withReason', 'failures', 'failureRatePct', 'avgLifeKm', 'avgCpk', 'recordedPrice'], headers: ['Axle group', 'Tyre records', 'Removed', 'Removals with reason', 'Failure removals', 'Failure rate %', 'Avg life km', 'Avg CPK', `Recorded tyre price ${currency || ''}`.trim()] },
        { name: 'Wheel positions', rows: positionExportRows(filtered), columns: POSITION_EXPORT_COLS, headers: POSITION_EXPORT_HEADERS },
        { name: 'Findings', rows: insights, columns: ['priority', 'message'], headers: ['Priority', 'Finding'] },
      ], reportFileName('Tyre Position Intelligence', reportDateLabel()), {
        title: 'Tyre Position Intelligence', company,
        notes: [scopeLabel, 'Failure rate = removals whose recorded reason names a failure (damage, puncture, burst, separation, flat) over removals with a usable reason.'],
      })
    } catch (e) {
      setExportError(toUserMessage(e, 'The Excel file could not be created.'))
    }
  }

  async function exportPdf(opts = {}) {
    setExportError(null)
    try {
      const { exportToPdf, reportFileName, reportDateLabel } = await loadExportUtils()
      return await exportToPdf(
        positionExportRows(filtered),
        POSITION_EXPORT_COLS.map((key, i) => ({ key, header: POSITION_EXPORT_HEADERS[i] })),
        'Tyre Position Intelligence',
        reportFileName('Tyre Position Intelligence', reportDateLabel()),
        'landscape',
        company,
        { subtitleNote: `${scopeLabel} | failure rate over removals with a reason`, emptyHint: 'No tyre records carry a position for these filters.', ...opts },
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'The PDF could not be created.'))
      return null
    }
  }

  const hasData = records.length > 0

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Tyre Position Intelligence"
        subtitle="Which axles and wheels fail, wear out and cost the most, from recorded tyre changes"
        icon={MapPin}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={load} disabled={loading} className="btn-secondary text-xs min-h-[40px] px-3 inline-flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
            <button type="button" onClick={exportExcel} disabled={!hasData} className="btn-secondary text-xs min-h-[40px] px-3 inline-flex items-center gap-1.5 disabled:opacity-50">
              <Download size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => exportPdf()} disabled={!hasData} className="btn-secondary text-xs min-h-[40px] px-3 inline-flex items-center gap-1.5 disabled:opacity-50">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <EmailPdfButton
              className="btn-secondary text-xs min-h-[40px] px-3 inline-flex items-center gap-1.5"
              disabled={!hasData}
              getPdf={async () => ({
                base64: await exportPdf({ returnBase64: true }),
                filename: 'Tyre Position Intelligence.pdf',
                subject: 'Tyre Position Intelligence',
                bodyHtml: '<p>Attached is the Tyre Position Intelligence report.</p>',
              })}
            />
          </div>
        }
      />

      {exportError && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{exportError}</div>}

      <FilterBar
        search={search}
        onSearch={setSearch}
        placeholder="Search asset, serial, brand, position or reason"
        searchLabel="Search tyre records"
        resultCount={hasData ? filtered.length : null}
        onClearAll={filtersActive ? clearAll : undefined}
        selects={[
          { key: 'country', value: country, onChange: setCountry, placeholder: 'All countries', ariaLabel: 'Filter by country', options: COUNTRIES.map((c) => ({ value: c, label: c })) },
          { key: 'site', value: site, onChange: setSite, placeholder: 'All sites', ariaLabel: 'Filter by site', options: sites.map((s) => ({ value: s, label: s })) },
          { key: 'group', value: group, onChange: setGroup, placeholder: 'All axles', ariaLabel: 'Filter by axle group', options: groupOptions.map((s) => ({ value: s, label: s })) },
          { key: 'brand', value: brand, onChange: setBrand, placeholder: 'All brands', ariaLabel: 'Filter by brand', options: brands.map((s) => ({ value: s, label: s })) },
        ]}
      >
        <div role="group" aria-label="Tyre record date window" className="flex flex-wrap gap-1">
          {DATE_PRESETS.map((p) => (
            <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => setPreset(p.key)}
              className={`px-3 min-h-[40px] rounded-xl text-xs font-medium border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${preset === p.key ? 'bg-[var(--accent)] text-white border-transparent' : 'border-[var(--border-dim)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </FilterBar>

      {loading && !hasData ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" aria-busy="true" aria-label="Loading position data">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="card h-[108px] animate-pulse" />)}
        </div>
      ) : error ? (
        <Card>
          <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle size={28} className="text-red-400" aria-hidden="true" />
            <p className="text-sm text-[var(--text-primary)] font-medium">Position data could not be loaded</p>
            <p className="text-xs text-[var(--text-muted)] max-w-md">{error}</p>
            <button type="button" onClick={load} className="btn-primary text-sm min-h-[44px] px-4 inline-flex items-center gap-2"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
          </div>
        </Card>
      ) : !hasData ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <MapPin size={32} className="text-[var(--text-muted)]" aria-hidden="true" />
            <p className="text-sm text-[var(--text-primary)] font-medium">No tyre records in this window</p>
            <p className="text-xs text-[var(--text-muted)] max-w-md">Widen the date window or choose another country. Records appear here once tyre changes are imported or entered.</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)] px-4 py-3 text-xs text-[var(--text-secondary)]">
            <Info size={14} className="shrink-0 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
            <p>
              Failure rate is the share of removals whose recorded reason names a failure (damage, puncture, burst, separation, flat) among removals that carry a usable reason.
              Brands typed into the reason column and import markers are not counted as reasons. Life and CPK use only tyres with both a fitment and a removal odometer reading.
              {!currency && ' Recorded tyre prices are shown per country only, because countries report in different currencies.'}
              {capped && ` Capped view: the newest ${ROW_CAP.toLocaleString()} records are loaded.`}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatTile index={0} icon={Wrench} label="Failure removals" value={fmtPct(kpis.failureRatePct)} sub={`${fmtN(kpis.failures)} of ${fmtN(kpis.withReason)} reasoned`} tone={kpis.failureRatePct == null ? 'neutral' : kpis.failureRatePct >= 30 ? 'crit' : kpis.failureRatePct >= 15 ? 'warn' : 'accent'} />
            <StatTile index={1} icon={AlertTriangle} label="Worst axle" value={kpis.worstGroup?.group || 'N/A'} sub={kpis.worstGroup ? `${fmtPct(kpis.worstGroup.failureRatePct)} of ${kpis.worstGroup.sample}` : 'Too few reasoned removals'} tone={kpis.worstGroup ? 'crit' : 'neutral'} />
            <StatTile index={2} icon={Gauge} label="Avg tyre life" value={kpis.avgLifeKm == null ? 'N/A' : Math.round(kpis.avgLifeKm).toLocaleString()} unit={kpis.avgLifeKm == null ? undefined : 'km'} sub={`${fmtN(kpis.lifeSample)} tyres measured`} tone="info" />
            <StatTile index={3} icon={Activity} label="Shortest-lived axle" value={kpis.shortestLifeGroup?.group || 'N/A'} sub={kpis.shortestLifeGroup ? fmtKm(kpis.shortestLifeGroup.avgLifeKm) : 'Too few measured tyres'} tone="warn" />
            <StatTile index={4} icon={BarChart2} label="Avg CPK" value={fmtCpk(kpis.avgCpk)} sub={`${fmtN(kpis.cpkSample)} priced and measured`} tone="neutral" />
            <StatTile index={5} icon={MapPin} label="Position known" value={fmtPct(kpis.positionCoveragePct, 0)} sub={`${fmtN(kpis.unplaced)} records without a readable position`} tone="neutral" />
          </div>

          <div role="tablist" aria-label="Position intelligence sections" className="flex flex-wrap gap-2 border-b border-[var(--border-dim)] pb-3">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`inline-flex items-center gap-2 px-3.5 min-h-[40px] rounded-lg text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${tab === key ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                <Icon size={15} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Section title="Why tyres came off, by axle" icon={Wrench} subtitle="Share of reasoned removals that were failures versus wear-out">
                  <ChartBox empty={rateData.labels.length ? null : 'No removals carry a usable reason in this scope.'} label="Failure and wear-out removal share by axle group">
                    <Bar data={rateData} options={chartOptions({ yTitle: '% of reasoned removals', pctAxis: true, max: 100, legend: true })} />
                  </ChartBox>
                </Section>
                <Section title="Average tyre life by axle" icon={Gauge} subtitle="Removal odometer minus fitment odometer">
                  <ChartBox empty={lifeRows.length ? null : 'No tyre carries both odometer readings in this scope.'} label="Average tyre life in km by axle group">
                    <Bar data={lifeData} options={chartOptions({ yTitle: 'km' })} />
                  </ChartBox>
                </Section>
              </div>
              <Section title="Removals per month by axle" icon={Activity} subtitle="Last 12 months, by removal date">
                <ChartBox empty={trend.series.some((s) => s.data.some((v) => v > 0)) ? null : 'No removals dated in the last 12 months.'} label="Monthly tyre removals by axle group">
                  <Line data={trendData} options={chartOptions({ yTitle: 'Removals', legend: true })} />
                </ChartBox>
              </Section>
              <Section title="Axle group scorecard" icon={Layers} subtitle={currency ? `Recorded tyre price in ${currency} is on the per-group export` : 'Select a country to see recorded tyre prices'}>
                <EnterpriseTable columns={groupColumns} data={groups} getRowId={(r) => r.group} enableGlobalFilter={false} enableColumnFilters={false} exportFileName="Position axle groups" emptyMessage="No axle groups in scope." />
                {currency && (
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
                    {groups.map((g) => (
                      <span key={g.group} className="rounded-lg border border-[var(--border-dim)] px-2.5 py-1">
                        {g.group}: {fmtMoney(g.recordedPrice)} recorded over {fmtN(g.pricedCount)} priced tyres
                      </span>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          )}

          {tab === 'positions' && (
            <Section title="Every wheel position" icon={MapPin} subtitle="Sorted by failure share. Positions are read from the canonical codes and the field app slot ids.">
              <EnterpriseTable columns={codeColumns} data={codes} getRowId={(r) => r.code} viewKey="position-intelligence-codes" initialPageSize={25} exportFileName="Position wheel positions" emptyMessage="No tyre records carry a position." />
            </Section>
          )}

          {tab === 'sites' && (
            <Section title="Failure share by site and axle" icon={LayoutGrid} subtitle="N/A means records exist but none carries a usable removal reason. None means no records for that axle at the site.">
              <EnterpriseTable columns={matrixColumns} data={matrix.rows} getRowId={(r) => r.site} initialPageSize={25} exportFileName="Position site matrix" emptyMessage="No sites in scope." />
            </Section>
          )}

          {tab === 'brands' && (
            <Section
              title="Brands on one axle"
              icon={Tag}
              subtitle="Compare brands where they actually run"
              actions={(
                <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  Axle
                  <select value={brandGroup} onChange={(e) => setBrandGroup(e.target.value)} className="input text-sm min-h-[40px]" aria-label="Axle group for brand comparison">
                    {(groupOptions.length ? groupOptions : ['Steer']).map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
              )}
            >
              <EnterpriseTable columns={brandColumns} data={brandRows} getRowId={(r) => r.brand} initialPageSize={25} exportFileName={`Position brands ${brandGroup}`} emptyMessage="No tyres on this axle in scope." />
            </Section>
          )}

          {tab === 'assets' && (
            <Section title={group ? `Assets on the ${group} axle` : 'Assets'} icon={Truck} subtitle="Ranked by failure removals, top 50">
              <EnterpriseTable columns={assetColumns} data={assetRows} getRowId={(r) => r.asset_no} initialPageSize={25} exportFileName="Position assets" emptyMessage="No assets in scope." />
            </Section>
          )}

          {tab === 'findings' && (
            <Section title="Findings" icon={ListChecks} subtitle="Only figures resting on at least 10 removals become a finding">
              {insights.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-6 text-center">No axle or wheel stands out against the fleet in this scope.</p>
              ) : (
                <ul className="space-y-2">
                  {insights.map((i, n) => (
                    <li key={n} className="flex items-start gap-3 rounded-lg border border-[var(--border-dim)] px-3 py-2">
                      <span className={`text-[11px] font-semibold uppercase tracking-wide shrink-0 mt-0.5 ${i.priority === 'Critical' ? 'text-red-400' : i.priority === 'High' ? 'text-orange-400' : 'text-amber-300'}`}>{i.priority}</span>
                      <span className="text-sm text-[var(--text-secondary)]">{i.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  )
}
