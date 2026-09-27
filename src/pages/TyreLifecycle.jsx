import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend, PointElement, LineElement,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  CircleDot, RefreshCw, Trash2, Search, X, FileText, FileSpreadsheet, Gauge,
  DollarSign, Activity, Filter, ChevronRight, AlertTriangle, History, CheckCircle2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { escapeLike } from '../lib/searchFilter'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { exportToPdf, exportToExcel, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha, categorical } from '../lib/reportColors'
import PageHeader from '../components/ui/PageHeader'
import EmailPdfButton from '../components/EmailPdfButton'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { SkeletonCards, SkeletonChart } from '../components/ui/Skeleton'
import PeriodFilter, { filterByPeriodValue, periodLabel } from '../components/ui/PeriodFilter'
import TyreRunningLife from '../components/tyre/TyreRunningLife'
import TyreConsumptionSection from '../components/tyre/TyreConsumptionSection'
import TyreChangeTracking from '../components/tyre/TyreChangeTracking'
import {
  CATEGORIES, STAGES, filterLifecycle, distinct, lifecycleKpis, stageFunnel, brandLife,
  costByCategory, kmBandCounts, lifecycleRows, lifecycleExportRows, EXPORT_COLS, EXPORT_HEADERS,
  kmRun, lifecycleStage,
} from '../lib/tyreLifecycleAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend, PointElement, LineElement,
)

const GRID = { color: 'var(--panel-2)' }
const TICK = { color: 'var(--text-secondary)' }
const LEGEND = { labels: { color: 'var(--text-secondary)', boxWidth: 12 } }

const BASE_CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: LEGEND },
  scales: { x: { ticks: TICK, grid: GRID }, y: { ticks: TICK, grid: GRID, beginAtZero: true } },
}

const DONUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom', labels: { color: 'var(--text-secondary)', boxWidth: 12, padding: 12 } },
    tooltip: {
      callbacks: {
        label: ctx => {
          const sum = ctx.dataset.data.reduce((a, b) => a + b, 0)
          return ` ${ctx.label}: ${ctx.parsed.toLocaleString()} (${sum ? ((ctx.parsed / sum) * 100).toFixed(1) : 0}%)`
        },
      },
    },
  },
}

const SORT = { sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)), sortUndefined: 'last' }
const undef = (v) => (v == null || v === '' ? undefined : v)

// Semantic stage colours. Every pill also carries the stage name as text.
const STAGE_CLS = {
  'In Service': 'text-green-400 bg-green-500/10 border-green-500/30',
  'Retread Eligible': 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  Retreaded: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  Scrapped: 'text-red-400 bg-red-500/10 border-red-500/30',
  Removed: 'text-[var(--text-secondary)] bg-[var(--panel-2)] border-[var(--border)]',
}
const STAGE_ICON = { 'In Service': Activity, 'Retread Eligible': CircleDot, Retreaded: RefreshCw, Scrapped: Trash2, Removed: CheckCircle2 }

const inputCls =
  'w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 min-h-[44px] sm:min-h-[38px] text-sm '
  + 'text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const btnCls =
  'inline-flex items-center gap-1.5 px-3 min-h-[44px] sm:min-h-[36px] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] '
  + 'border border-[var(--border-bright)] rounded-lg text-sm text-[var(--text-secondary)] transition-colors '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40'

const fmtNum = (v, d = 0) => (v == null || !Number.isFinite(v) ? 'N/A' : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }))
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(1)}%`)

function StagePill({ stage }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${STAGE_CLS[stage] || STAGE_CLS.Removed}`}>{stage}</span>
}

function Kpi({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <Icon size={13} aria-hidden="true" /><span className="truncate">{label}</span>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] mt-1 tabular-nums truncate">{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function TyreLifecycle() {
  const { activeCountry, activeCurrency } = useSettings()

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [capped, setCapped] = useState(false)

  const [search, setSearch] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterSite, setFilterSite] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [period, setPeriod] = useState({ mode: 'all' })

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: qErr, truncated } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,asset_no,serial_number:serial_no,position,brand,size,tread_depth,cost_per_tyre,qty,issue_date,removal_date,km_at_fitment,km_at_removal,risk_level,site,country,category')
          .order('issue_date', { ascending: false })
          .order('id', { ascending: false })
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      }, { max: 50000 })
      if (qErr) throw qErr
      setRecords(data || [])
      setCapped(Boolean(truncated))
    } catch (err) {
      setError(toUserMessage(err, 'Could not load lifecycle data.'))
      setRecords([])
      setCapped(false)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { fetchData() }, [fetchData])

  const uniqueBrands = useMemo(() => distinct(records, 'brand'), [records])
  const uniqueSites = useMemo(() => distinct(records, 'site'), [records])

  const filtered = useMemo(
    () => filterLifecycle(filterByPeriodValue(records, period, 'issue_date'), {
      search, brand: filterBrand, site: filterSite, category: filterCategory, stage: filterStage,
    }),
    [records, search, filterBrand, filterSite, filterCategory, filterStage, period],
  )
  const hasFilter = Boolean(search || filterBrand || filterSite || filterCategory || filterStage || period.mode !== 'all')

  function clearFilters() {
    setSearch(''); setFilterBrand(''); setFilterSite('')
    setFilterCategory(''); setFilterStage(''); setPeriod({ mode: 'all' })
  }

  const kpis = useMemo(() => lifecycleKpis(filtered), [filtered])
  const funnel = useMemo(() => stageFunnel(filtered), [filtered])
  const brands = useMemo(() => brandLife(filtered), [filtered])
  const cost = useMemo(() => costByCategory(filtered), [filtered])
  const bands = useMemo(() => kmBandCounts(filtered), [filtered])
  const rows = useMemo(() => lifecycleRows(filtered), [filtered])

  const brandChart = {
    labels: brands.map(b => b.brand),
    datasets: [
      { label: 'New (avg km)', data: brands.map(b => (b.newAvg == null ? null : Math.round(b.newAvg))), backgroundColor: withAlpha(colorAt(0), 0.75), borderRadius: 4 },
      { label: 'Retread (avg km)', data: brands.map(b => (b.retreadAvg == null ? null : Math.round(b.retreadAvg))), backgroundColor: withAlpha(colorAt(1), 0.75), borderRadius: 4 },
    ],
  }
  const donutColors = categorical(cost.buckets.length)
  const costDonut = {
    labels: cost.buckets.map(b => b.label),
    datasets: [{
      data: cost.buckets.map(b => Math.round(b.total)),
      backgroundColor: donutColors.map(c => withAlpha(c, 0.85)),
      borderColor: 'var(--panel)', borderWidth: 2,
    }],
  }
  const bandChart = {
    labels: bands.map(b => b.label),
    datasets: [{ label: 'Tyres', data: bands.map(b => b.count), backgroundColor: bands.map((_, i) => withAlpha(colorAt(i), 0.75)), borderRadius: 4 }],
  }

  // ── Serial history (selected row) ──────────────────────────────────────────
  const [selectedSerial, setSelectedSerial] = useState(null)
  const [history, setHistory] = useState({})
  const [historyError, setHistoryError] = useState(null)

  const loadHistory = useCallback(async (serial) => {
    setHistoryError(null)
    const { data, error: hErr } = await supabase
      .from('tyre_records')
      .select('id,asset_no,serial_number:serial_no,position,brand,size,issue_date,removal_date,km_at_fitment,km_at_removal,category,risk_level,cost_per_tyre,site,tread_depth')
      .ilike('serial_no', escapeLike(serial))
      .order('issue_date')
    if (hErr) { setHistoryError(toUserMessage(hErr, 'Could not load this tyre history.')); return }
    setHistory(prev => ({ ...prev, [serial]: data || [] }))
  }, [])

  function selectRow(r) {
    if (!r?.serial_number) return
    if (selectedSerial === r.serial_number) { setSelectedSerial(null); return }
    setSelectedSerial(r.serial_number)
    if (!history[r.serial_number]) loadHistory(r.serial_number)
  }

  // ── Export (whole filtered set, never a page) ─────────────────────────────
  const scope = [periodLabel(period), filterBrand, filterSite, filterCategory, filterStage].filter(Boolean).join(' | ')
  const fileName = reportFileName('TyrePulse Tyre Lifecycle', activeCountry !== 'All' ? activeCountry : null)
  function handlePdfExport(opts = {}) {
    return exportToPdf(
      lifecycleExportRows(filtered),
      EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
      `Tyre Lifecycle Report${scope ? ` (${scope})` : ''}`,
      fileName, 'landscape', '', opts,
    )
  }
  function handleExcelExport() {
    exportToExcel(lifecycleExportRows(filtered), EXPORT_COLS, EXPORT_HEADERS, fileName, 'Lifecycle')
  }

  const na = <span className="text-[var(--text-muted)]">N/A</span>
  const columns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: r => undef(r.serial_number), size: 140, ...SORT, cell: ({ getValue }) => (getValue() ? <span className="font-mono text-xs">{getValue()}</span> : na) },
    { id: 'brand', header: 'Brand', accessorFn: r => undef(r.brand), size: 120, ...SORT, cell: ({ getValue }) => getValue() ?? na },
    { id: 'size', header: 'Size', accessorFn: r => undef(r.size), size: 110, ...SORT, cell: ({ getValue }) => getValue() ?? na },
    { id: 'position', header: 'Position', accessorFn: r => undef(r.position), size: 90, ...SORT, cell: ({ getValue }) => getValue() ?? na },
    { id: 'asset', header: 'Asset', accessorFn: r => undef(r.asset_no), size: 100, ...SORT, cell: ({ getValue }) => getValue() ?? na },
    { id: 'site', header: 'Site', accessorFn: r => undef(r.site), size: 110, ...SORT, cell: ({ getValue }) => getValue() ?? na },
    { id: 'issue_date', header: 'Fitment date', accessorFn: r => undef(r.issue_date), size: 110, ...SORT, cell: ({ getValue }) => getValue() ?? na },
    { id: 'removal_date', header: 'Removal date', accessorFn: r => undef(r.removal_date), size: 110, ...SORT, cell: ({ getValue }) => getValue() ?? na },
    { id: 'km', header: 'km run', accessorFn: r => undef(r._km), size: 90, meta: { align: 'right' }, ...SORT, cell: ({ getValue }) => (getValue() == null ? na : <span className="tabular-nums">{getValue().toLocaleString()}</span>) },
    { id: 'category', header: 'Category', accessorFn: r => r._category, size: 100, meta: { filterVariant: 'select', filterOptions: CATEGORIES }, ...SORT },
    { id: 'cpk', header: 'Cost per km', accessorFn: r => undef(r._cpk), size: 100, meta: { align: 'right' }, ...SORT, cell: ({ getValue }) => (getValue() == null ? na : <span className="tabular-nums">{getValue().toFixed(4)}</span>) },
    { id: 'stage', header: 'Stage', accessorFn: r => r._stage, size: 130, meta: { filterVariant: 'select', filterOptions: STAGES }, ...SORT, cell: ({ getValue }) => <StagePill stage={getValue()} /> },
  ], []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedHistory = selectedSerial ? history[selectedSerial] : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Lifecycle Tracker"
        subtitle="Full lifecycle visibility from fitment to retirement"
        icon={Activity}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => handlePdfExport()} disabled={loading || !filtered.length} className={btnCls}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <EmailPdfButton
              className={btnCls}
              getPdf={async () => ({
                base64: await handlePdfExport({ returnBase64: true }),
                filename: `${fileName}.pdf`,
                subject: 'Tyre Lifecycle',
                bodyHtml: '<p>Attached is the Tyre Lifecycle report.</p>',
              })}
            />
            <button onClick={handleExcelExport} disabled={loading || !filtered.length} className={btnCls}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
          </div>
        )}
      />

      {error && (
        <div className="card border border-red-500/30 flex flex-wrap items-center gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 shrink-0" aria-hidden="true" />
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={fetchData} className={btnCls}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {capped && (
        <div className="card border border-amber-500/30 flex items-center gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 shrink-0" aria-hidden="true" />
          <p className="text-sm text-amber-400 flex-1">
            Capped view: showing the most recent 50,000 tyre records. Narrow the country or period for a complete view.
          </p>
        </div>
      )}

      {loading ? (
        <>
          <SkeletonCards count={5} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><SkeletonChart /><SkeletonChart /></div>
        </>
      ) : error ? null : records.length === 0 ? (
        <div className="card py-16 flex flex-col items-center gap-3 text-center">
          <CircleDot size={40} className="text-[var(--text-dim)]" aria-hidden="true" />
          <p className="text-[var(--text-secondary)] font-medium">No tyre records for this country yet</p>
          <p className="text-[var(--text-muted)] text-sm">Import tyre records to track each tyre from fitment to retirement.</p>
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi icon={CircleDot} label="Tyres tracked" value={fmtNum(kpis.serials)} sub={`${fmtNum(kpis.records)} records${kpis.missingSerial ? `, ${fmtNum(kpis.missingSerial)} without serial` : ''}`} />
            <Kpi icon={Gauge} label="Avg life" value={kpis.avgLifeKm == null ? 'N/A' : `${fmtNum(kpis.avgLifeKm)} km`} sub={`${fmtNum(kpis.measuredLife)} tyres measured`} />
            <Kpi icon={RefreshCw} label="Retread rate" value={fmtPct(kpis.retreadRate)} sub={kpis.categorised ? `of ${fmtNum(kpis.categorised)} categorised` : 'No category recorded'} />
            <Kpi icon={Trash2} label="Scrap rate" value={fmtPct(kpis.scrapRate)} sub={kpis.removed ? `${fmtNum(kpis.scrapped)} of ${fmtNum(kpis.removed)} removed` : 'No removals recorded'} />
            <Kpi icon={DollarSign} label="Avg cost per km" value={kpis.avgCpk == null ? 'N/A' : kpis.avgCpk.toFixed(4)} sub={kpis.measuredCpk ? `${fmtNum(kpis.measuredCpk)} priced and measured` : 'Needs price and removal km'} />
          </div>

          {/* Filters */}
          <section className="card p-4 space-y-3" aria-label="Filters">
            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] font-medium">
              <Filter size={14} aria-hidden="true" />
              <span>Filters</span>
              <span className="text-xs text-[var(--text-muted)] font-normal">{fmtNum(filtered.length)} of {fmtNum(records.length)} records</span>
              {hasFilter && (
                <button onClick={clearFilters} className={`ml-auto ${btnCls}`}>
                  <X size={12} aria-hidden="true" /> Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <label className="relative sm:col-span-2 lg:col-span-1">
                <span className="sr-only">Search serial, asset or brand</span>
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input type="search" placeholder="Serial, asset or brand" value={search} onChange={e => setSearch(e.target.value)} className={`${inputCls} pl-8`} />
              </label>
              <label><span className="sr-only">Brand</span>
                <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} className={inputCls}>
                  <option value="">All brands</option>
                  {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
              <label><span className="sr-only">Site</span>
                <select value={filterSite} onChange={e => setFilterSite(e.target.value)} className={inputCls}>
                  <option value="">All sites</option>
                  {uniqueSites.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label><span className="sr-only">Category</span>
                <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={inputCls}>
                  <option value="">All categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label><span className="sr-only">Stage</span>
                <select value={filterStage} onChange={e => setFilterStage(e.target.value)} className={inputCls}>
                  <option value="">All stages</option>
                  {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <PeriodFilter records={records} value={period} onChange={setPeriod} className="sm:col-span-2 lg:col-span-1" />
            </div>
          </section>

          {/* Lifecycle funnel: each stage is a filter button */}
          <section className="card p-5" aria-labelledby="tl-funnel">
            <h2 id="tl-funnel" className="text-sm font-semibold text-[var(--text-primary)] mb-1">Lifecycle stages</h2>
            <p className="text-xs text-[var(--text-muted)] mb-4">Select a stage to filter the table. Stages are mutually exclusive and add up to the records in scope.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {funnel.map((s, i) => {
                const Icon = STAGE_ICON[s.stage]
                const active = filterStage === s.stage
                return (
                  <div key={s.stage} className="flex items-center">
                    <button
                      onClick={() => setFilterStage(active ? '' : s.stage)}
                      aria-pressed={active}
                      className={`flex-1 rounded-xl border p-4 text-left min-h-[44px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${STAGE_CLS[s.stage]} ${active ? 'ring-2 ring-[var(--accent)]' : ''}`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-medium"><Icon size={14} aria-hidden="true" />{s.stage}</div>
                      <p className="text-2xl font-bold mt-1 tabular-nums">{fmtNum(s.count)}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{fmtPct(s.pct)} of records</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {s.avgCost == null ? 'Avg price N/A' : `Avg ${activeCurrency} ${fmtNum(s.avgCost)}`}
                      </p>
                    </button>
                    {i < funnel.length - 1 && <ChevronRight size={16} className="hidden lg:block text-[var(--text-dim)] shrink-0" aria-hidden="true" />}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Brand lifecycle (avg km run: new vs retread)</h2>
              <div style={{ height: 280 }}>
                {brands.length > 0 ? (
                  <div className="h-full" role="img" aria-label={`Average km run for ${brands.length} brands, new and retread`}>
                    <Bar data={brandChart} options={BASE_CHART_OPTS} />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm text-center px-4">
                    No tyre in scope has both a fitment and a removal km, so life cannot be measured.
                  </div>
                )}
              </div>
            </div>
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Spend by category</h2>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Priced tyre records only ({fmtNum(cost.priced)} priced); the authoritative total is from the expense grid.
              </p>
              <div style={{ height: 260 }}>
                {cost.total ? (
                  <div className="h-full" role="img" aria-label={`Spend by category, ${cost.buckets.map(b => `${b.label} ${Math.round(b.total)}`).join(', ')}`}>
                    <Doughnut data={costDonut} options={DONUT_OPTS} />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No priced tyres in scope</div>
                )}
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Life distribution (km run bands)</h2>
            {kpis.measuredLife === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No measured tyre life in scope.</p>
            ) : (
              <div style={{ height: 220 }} role="img" aria-label={`Tyres per km band: ${bands.map(b => `${b.label} ${b.count}`).join(', ')}`}>
                <Bar
                  data={bandChart}
                  options={{
                    ...BASE_CHART_OPTS,
                    plugins: { legend: { display: false } },
                    scales: { x: { ticks: TICK, grid: GRID }, y: { ticks: TICK, grid: GRID, beginAtZero: true, title: { display: true, text: 'Tyres', color: 'var(--text-muted)' } } },
                  }}
                />
              </div>
            )}
          </div>

          {/* Lifecycle register */}
          <section className="space-y-2" aria-labelledby="tl-table">
            <h2 id="tl-table" className="text-sm font-semibold text-[var(--text-primary)]">Tyre lifecycle register</h2>
            <p className="text-xs text-[var(--text-muted)]">Select a row with a serial to see where that tyre has been.</p>
            <EnterpriseTable
              viewKey="tyre-lifecycle"
              columns={columns}
              data={rows}
              getRowId={r => String(r.id)}
              enableGlobalFilter={false}
              enableColumnFilters
              enableExport={false}
              initialPageSize={25}
              pageSizeOptions={[25, 50, 100]}
              onRowClick={selectRow}
              emptyMessage="No records match the current filters"
            />
          </section>

          {selectedSerial && (
            <section className="card border border-[var(--border-brand)] space-y-3" aria-label={`History of tyre ${selectedSerial}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <History size={15} aria-hidden="true" /> Tyre history <span className="font-mono">{selectedSerial}</span>
                </h3>
                <button onClick={() => setSelectedSerial(null)} aria-label="Close tyre history" className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--panel-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              {historyError ? (
                <div role="alert" className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-red-400">{historyError}</p>
                  <button onClick={() => loadHistory(selectedSerial)} className={btnCls}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
                </div>
              ) : !selectedHistory ? (
                <p className="text-xs text-[var(--text-muted)]" role="status">Loading history...</p>
              ) : selectedHistory.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No history records found for this serial.</p>
              ) : (
                <ol className="relative pl-4 border-l border-[var(--border)] space-y-3">
                  {selectedHistory.map(h => {
                    const hStage = lifecycleStage(h)
                    const hKm = kmRun(h)
                    return (
                      <li key={h.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                        <span className="text-[var(--text-primary)] font-medium">{h.issue_date || 'Date N/A'}</span>
                        <span className="text-[var(--text-secondary)]">Asset {h.asset_no || 'N/A'}</span>
                        <span className="text-[var(--text-secondary)]">Site {h.site || 'N/A'}</span>
                        <span className="text-[var(--text-secondary)]">Position {h.position || 'N/A'}</span>
                        <span className="text-[var(--text-secondary)]">{hKm != null ? `${hKm.toLocaleString()} km` : 'km N/A'}</span>
                        <StagePill stage={hStage} />
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>
          )}
        </>
      )}

      <TyreConsumptionSection />

      <TyreRunningLife />

      {/* Flagged tyres tracked through to replacement. Lives here, beside
          Running & Remaining, because the flags come from that same life
          judgement - a separate page would split one story across two routes. */}
      <TyreChangeTracking />
    </div>
  )
}
