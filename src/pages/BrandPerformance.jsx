import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { linearRegression, bucketByMonth, recordCost } from '../lib/analyticsEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  Maximize2, X, BarChart2, Download, FileText, Award, AlertTriangle, RefreshCw,
  Ruler, Trophy, Tag, ShieldAlert, Layers, Coins,
} from 'lucide-react'
import { getBrandSizeCpk } from '../lib/api/brandSizeCpk'
import { groupBySize, recommendationFor, formatNumber, formatCpk } from '../lib/brandSizeCpk'
import { SkeletonCards, SkeletonChart } from '../components/ui/Skeleton'
import PageHeader from '../components/ui/PageHeader'
import PeriodFilter, { filterByPeriodValue, periodLabel } from '../components/ui/PeriodFilter'
import { ChartModal } from '../components/ChartModal'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import { loadGovernedCostSplit, COST_SPLIT_TTL_MS } from '../lib/api/governedCost'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import { toUserMessage } from '../lib/safeError'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  RISK_LEVELS, sitesOf, filterBrandRecords, buildBrandMetrics, summarizeBrands,
  failureBand, FAILURE_BAND_LABEL, categoryBreakdown, brandExportRows,
  BRAND_EXPORT_COLS, BRAND_EXPORT_HEADERS, flattenSizeGroups,
} from '../lib/brandPerformanceAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

// One sort rule for every column: number/date aware, blanks last.
const SORT = {
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
}
const undef = (v) => (v == null || v === '' ? undefined : v)

const TICK = { color: 'var(--text-secondary)' }
const GRID = { color: 'var(--panel-2)' }
const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: { x: { grid: GRID, ticks: TICK }, y: { grid: GRID, ticks: TICK, beginAtZero: true } },
}

// Semantic failure bands keep their meaning (and always carry a text label).
const BAND_CLS = {
  high: 'bg-red-500/15 text-red-400 border-red-500/30',
  elevated: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  low: 'bg-green-500/15 text-green-400 border-green-500/30',
}
const BAND_FILL = { high: 'rgba(239,68,68,0.7)', elevated: 'rgba(245,158,11,0.7)', low: 'rgba(16,185,129,0.7)' }

const chipCls = (active) =>
  'min-h-[44px] sm:min-h-[36px] px-3 rounded-full text-xs font-medium border transition-colors '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] '
  + (active
    ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
    : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-bright)]')

const inputCls =
  'rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 min-h-[44px] sm:min-h-[38px] '
  + 'text-sm text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(d)}%`)

function Kpi({ icon: Icon, label, value, sub, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        {Icon && <Icon size={13} aria-hidden="true" />}<span className="truncate">{label}</span>
      </div>
      <p className={`text-xl font-bold mt-1 truncate tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

function BandPill({ rate }) {
  const band = failureBand(rate)
  if (!band) return <span className="text-xs text-[var(--text-muted)]">N/A</span>
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${BAND_CLS[band]}`}>
      {rate.toFixed(1)}% <span className="sr-only sm:not-sr-only">{FAILURE_BAND_LABEL[band]}</span>
    </span>
  )
}

export default function BrandPerformance() {
  const reportMeta = useReportMeta('Brand Performance')
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState([])
  const [recordsTruncated, setRecordsTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  // Authoritative fleet-level tyre cost from the classified expense grid.
  const [fleetTyreCost, setFleetTyreCost] = useState(null)

  const [period, setPeriod] = useState({ mode: 'all' })
  const [selectedSites, setSelectedSites] = useState([])
  const [riskLevels, setRiskLevels] = useState([])

  const [modalOpen, setModalOpen] = useState(false)
  const chartRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Per-row brand aggregation has no server RPC, so this stays a client pull.
      // BOUNDED: country-scoped, newest-first, capped at 50,000 rows. The Period
      // filter is applied client-side over the loaded set.
      const { data, error: e, truncated } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,issue_date,brand,site,category,risk_level,cost_per_tyre,qty,description,remarks')
          .order('issue_date', { ascending: false })
          .order('id', { ascending: true })
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      }, { max: 50000 })
      if (e) throw e
      setRecords(data || [])
      setRecordsTruncated(!!truncated)
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load brand data.'))
      setRecords([])
      setRecordsTruncated(false)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let alive = true
    loadGovernedCostSplit({ country: activeCountry, maxAgeMs: COST_SPLIT_TTL_MS })
      .then(r => { if (alive) setFleetTyreCost(r?.tyre ?? null) })
      .catch(() => { if (alive) setFleetTyreCost(null) })
    return () => { alive = false }
  }, [activeCountry])

  const uniqueSites = useMemo(() => sitesOf(records), [records])
  const filtered = useMemo(
    () => filterBrandRecords(filterByPeriodValue(records, period, 'issue_date'), { sites: selectedSites, riskLevels }),
    [records, period, selectedSites, riskLevels],
  )
  const metrics = useMemo(() => buildBrandMetrics(filtered), [filtered])
  const summary = useMemo(() => summarizeBrands(metrics, { fleetTyreCost }), [metrics, fleetTyreCost])
  const selectedData = useMemo(() => (selected ? filtered.filter(r => (r.brand || 'Unknown') === selected) : []), [filtered, selected])

  const hasActiveFilter = period.mode !== 'all' || selectedSites.length > 0 || riskLevels.length > 0
  const scopeLabel = [
    periodLabel(period),
    selectedSites.length ? `Sites: ${selectedSites.join(', ')}` : null,
    riskLevels.length ? `Risk: ${riskLevels.join(', ')}` : null,
  ].filter(Boolean).join(' | ')

  const toggle = (setter) => (v) => setter(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]))
  const toggleSite = toggle(setSelectedSites)
  const toggleRisk = toggle(setRiskLevels)
  function clearFilters() { setPeriod({ mode: 'all' }); setSelectedSites([]); setRiskLevels([]) }

  const top10 = metrics.slice(0, 10)
  const rankingChart = {
    labels: top10.map(b => b.brand),
    datasets: [{
      label: 'Records',
      data: top10.map(b => b.count),
      backgroundColor: top10.map((b, i) => BAND_FILL[failureBand(b.failureRate)] || withAlpha(colorAt(i), 0.7)),
      borderRadius: 4,
    }],
  }
  const rated10 = metrics.filter(b => b.failureRate != null).slice(0, 10)
  const failureRateChart = {
    labels: rated10.map(b => b.brand),
    datasets: [{
      label: 'High-risk failure rate %',
      data: rated10.map(b => Number(b.failureRate.toFixed(1))),
      backgroundColor: rated10.map(b => BAND_FILL[failureBand(b.failureRate)]),
      borderRadius: 4,
    }],
  }

  const exportFile = reportFileName('TyrePulse Brand Performance', activeCountry !== 'All' ? activeCountry : null)
  const doExcel = () => exportToExcel(brandExportRows(metrics), BRAND_EXPORT_COLS, BRAND_EXPORT_HEADERS, exportFile, 'Brands')
  const doPdf = () => exportToPdf(
    brandExportRows(metrics),
    BRAND_EXPORT_COLS.map((k, i) => ({ key: k, header: BRAND_EXPORT_HEADERS[i] })),
    `Brand Performance (${scopeLabel || 'All periods'})`,
    exportFile, 'landscape',
  )

  const brandColumns = useMemo(() => [
    { id: 'rank', header: '#', accessorFn: r => r.rank, size: 48, meta: { align: 'center' }, ...SORT },
    {
      id: 'brand', header: 'Brand', accessorFn: r => r.brand, size: 140, ...SORT,
      cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span>,
    },
    { id: 'count', header: 'Records', accessorFn: r => r.count, size: 80, meta: { align: 'right' }, ...SORT },
    {
      id: 'totalCost', header: 'Total cost', accessorFn: r => undef(r.totalCost), size: 110, meta: { align: 'right', exportValue: r => r.totalCost ?? 'N/A' }, ...SORT,
      cell: ({ getValue }) => (getValue() == null ? <span className="text-[var(--text-muted)]">N/A</span> : formatCurrencyCompact(getValue(), activeCurrency)),
    },
    {
      id: 'avgCost', header: 'Avg per priced tyre', accessorFn: r => undef(r.avgCost), size: 120, meta: { align: 'right', exportValue: r => r.avgCost ?? 'N/A' }, ...SORT,
      cell: ({ getValue }) => (getValue() == null ? <span className="text-[var(--text-muted)]">N/A</span> : formatCurrencyCompact(getValue(), activeCurrency)),
    },
    {
      id: 'failureRate', header: 'Failure rate', accessorFn: r => undef(r.failureRate), size: 120, meta: { align: 'right', exportValue: r => r.failureRate ?? 'N/A' }, ...SORT,
      cell: ({ getValue, row }) => (
        <span title={`${row.original.ratedCount} of ${row.original.count} records carry a risk rating`}>
          <BandPill rate={getValue()} />
        </span>
      ),
    },
    { id: 'rated', header: 'Rated', accessorFn: r => r.ratedCount, size: 70, meta: { align: 'right' }, ...SORT },
    {
      id: 'topCategory', header: 'Top category', accessorFn: r => undef(r.topCategory), size: 130, ...SORT,
      cell: ({ getValue }) => getValue() ?? <span className="text-[var(--text-muted)]">N/A</span>,
    },
    {
      id: 'riskScore', header: 'Risk score', accessorFn: r => undef(r.riskScore), size: 100, meta: { align: 'right', exportValue: r => r.riskScore ?? 'N/A' }, ...SORT,
      cell: ({ getValue }) => {
        const v = getValue()
        if (v == null) return <span className="text-[var(--text-muted)]">N/A</span>
        return <span className="font-mono text-xs tabular-nums text-[var(--text-primary)]">{v.toFixed(2)}</span>
      },
    },
  ], [activeCurrency])

  if (loading) return (
    <div className="space-y-5">
      <PageHeader title="Brand Performance" subtitle="Loading brand data..." icon={BarChart2} />
      <SkeletonCards count={4} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><SkeletonChart /><SkeletonChart /></div>
    </div>
  )

  if (error) return (
    <div className="space-y-5">
      <PageHeader title="Brand Performance" subtitle="Could not load data" icon={BarChart2} />
      <div className="card py-16 flex flex-col items-center gap-3 text-center" role="alert">
        <AlertTriangle size={40} className="text-red-400" aria-hidden="true" />
        <p className="text-red-400 font-medium">Could not load brand performance</p>
        <p className="text-[var(--text-muted)] text-sm">{error}</p>
        <button onClick={load} className="btn-primary min-h-[44px] mt-2 inline-flex items-center gap-2 px-4">
          <RefreshCw size={16} aria-hidden="true" /> Retry
        </button>
      </div>
    </div>
  )

  if (records.length === 0) return (
    <div className="space-y-5">
      <PageHeader title="Brand Performance" subtitle="No brand data available" icon={BarChart2} />
      <div className="card py-16 flex flex-col items-center gap-3 text-center">
        <BarChart2 size={40} className="text-[var(--text-dim)]" aria-hidden="true" />
        <p className="text-[var(--text-secondary)] font-medium">No tyre records for this country yet</p>
        <p className="text-[var(--text-muted)] text-sm">Import tyre records with brand information to see performance analytics.</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brand Performance"
        subtitle="Failure rates, cost and ranking by brand"
        icon={BarChart2}
        actions={(
          <div className="flex gap-2">
            <button onClick={doExcel} disabled={!metrics.length} className="btn-secondary min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 text-sm px-3 disabled:opacity-40">
              <Download size={14} aria-hidden="true" /> Excel
            </button>
            <button onClick={doPdf} disabled={!metrics.length} className="btn-secondary min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 text-sm px-3 disabled:opacity-40">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        )}
      />

      {recordsTruncated && (
        <div role="status" className="px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-400">
          Capped view: showing the most recent 50,000 tyre records for the selected country. Total fleet cost is a
          server aggregate and stays exact. Narrow the country or period for complete per brand detail.
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi icon={Layers} label="Brands tracked" value={formatNumber(summary.brandCount)} sub={`${formatNumber(summary.records)} records in scope`} />
        <Kpi
          icon={Coins}
          label="Total fleet tyre cost"
          value={summary.totalCost == null ? 'N/A' : formatCurrencyCompact(summary.totalCost, activeCurrency)}
          sub={summary.costBasis === 'grid' ? 'From the expense grid' : summary.costBasis === 'records' ? 'Priced tyre records only' : 'No priced records'}
        />
        <Kpi
          icon={ShieldAlert}
          label="Fleet failure rate"
          value={pct(summary.fleetFailureRate)}
          sub={summary.ratedPct == null ? 'No records' : `${summary.ratedPct.toFixed(0)}% of records rated`}
        />
        <Kpi
          icon={Award}
          label="Best brand"
          value={summary.best ? summary.best.brand : 'N/A'}
          sub={summary.best ? `${pct(summary.best.failureRate)} failure, ${summary.best.ratedCount} rated` : 'No risk ratings recorded'}
          tone={summary.best ? 'text-green-400' : 'text-[var(--text-muted)]'}
        />
        <Kpi
          icon={AlertTriangle}
          label="Highest risk brand"
          value={summary.worst ? summary.worst.brand : 'N/A'}
          sub={summary.worst ? `${pct(summary.worst.failureRate)} failure, ${summary.worst.ratedCount} rated` : 'Needs two rated brands'}
          tone={summary.worst ? 'text-red-400' : 'text-[var(--text-muted)]'}
        />
      </div>

      {summary.ratedCount === 0 && (
        <p className="text-xs text-[var(--text-muted)]" role="note">
          No record in this scope carries a risk rating, so failure rate and risk score read N/A rather than 0%.
        </p>
      )}

      {/* Filters */}
      <section className="card space-y-3" aria-label="Filters">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <span className="label text-xs" id="bp-period">Period</span>
            <div aria-labelledby="bp-period"><PeriodFilter records={records} value={period} onChange={setPeriod} /></div>
          </div>
          {hasActiveFilter && (
            <button onClick={clearFilters} className="btn-secondary min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 text-sm px-3 self-end">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>

        {uniqueSites.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by site">
            <span className="text-xs text-[var(--text-muted)]">Sites:</span>
            <button onClick={() => setSelectedSites([])} aria-pressed={selectedSites.length === 0} className={chipCls(selectedSites.length === 0)}>All</button>
            {uniqueSites.map(site => (
              <button key={site} onClick={() => toggleSite(site)} aria-pressed={selectedSites.includes(site)} className={chipCls(selectedSites.includes(site))}>
                {site}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by risk level">
          <span className="text-xs text-[var(--text-muted)]">Risk:</span>
          <button onClick={() => setRiskLevels([])} aria-pressed={riskLevels.length === 0} className={chipCls(riskLevels.length === 0)}>All</button>
          {RISK_LEVELS.map(level => (
            <button key={level} onClick={() => toggleRisk(level)} aria-pressed={riskLevels.includes(level)} className={chipCls(riskLevels.includes(level))}>
              {level}
            </button>
          ))}
        </div>
      </section>

      {metrics.length === 0 ? (
        <div className="card py-12 flex flex-col items-center gap-3 text-center">
          <BarChart2 size={32} className="text-[var(--text-dim)]" aria-hidden="true" />
          <p className="text-[var(--text-secondary)] font-medium">No records match these filters</p>
          <button onClick={clearFilters} className="btn-secondary min-h-[44px] px-4 inline-flex items-center gap-1.5">
            <X size={14} aria-hidden="true" /> Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card relative">
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4 pr-10">Volume by brand (top 10)</h3>
              <button
                onClick={() => setModalOpen(true)}
                aria-label="Open volume by brand chart fullscreen"
                className="absolute top-2 right-2 z-10 w-11 h-11 inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--panel-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <Maximize2 size={15} aria-hidden="true" />
              </button>
              <div style={{ height: 240 }} role="img" aria-label={`Bar chart of tyre records for the top ${top10.length} brands`}>
                <Bar ref={chartRef} data={rankingChart} options={CHART_OPTS} />
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-2">Bar colour shows the failure band; grey tones mean the brand has no rated records.</p>
            </div>
            <div className="card">
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">High-risk failure rate % (rated brands, top 10)</h3>
              {rated10.length === 0 ? (
                <div className="h-[240px] flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4">
                  No brand in this scope has risk-rated records, so there is no failure rate to chart.
                </div>
              ) : (
                <div style={{ height: 240 }} role="img" aria-label={`Bar chart of failure rate for ${rated10.length} rated brands`}>
                  <Bar data={failureRateChart} options={CHART_OPTS} />
                </div>
              )}
            </div>
          </div>

          <p className="text-[11px] text-[var(--text-muted)]">
            Cost by brand sums priced tyre records; the authoritative fleet total is from the expense grid. Select a row to drill down.
          </p>
          <EnterpriseTable
            viewKey="brand-performance"
            reportMeta={reportMeta}
            columns={brandColumns}
            data={metrics}
            getRowId={r => r.brand}
            enableGlobalFilter={true}
            searchPlaceholder="Search brand..."
            enableSorting
            enableExport
            exportFileName={exportFile}
            initialPageSize={25}
            pageSizeOptions={[10, 25, 50]}
            emptyMessage="No brands match your search"
            onRowClick={(row) => setSelected(selected === row.brand ? null : row.brand)}
            enableRowSelection={false}
          />

          {selected && <BrandDrillDown brand={selected} records={selectedData} onClose={() => setSelected(null)} />}
        </>
      )}

      <BrandSizeValuePanel country={activeCountry} />

      <ChartModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Volume by brand (top 10)"
        chartRef={chartRef}
        filters={{}}
        filterOptions={{ sites: uniqueSites, brands: [] }}
        showSite={false}
        showBrand={false}
      >
        <div style={{ height: 480 }}>
          <Bar ref={chartRef} data={rankingChart} options={CHART_OPTS} />
        </div>
      </ChartModal>
    </div>
  )
}

function BrandDrillDown({ brand, records, onClose }) {
  const monthly = useMemo(() => bucketByMonth(records, r => r.issue_date, r => recordCost(r)), [records])
  const reg = monthly.length >= 2 ? linearRegression(monthly.map((d, i) => [i, d.count])) : null
  const cats = useMemo(() => categoryBreakdown(records), [records])
  const line = colorAt(0)

  const chartData = {
    labels: monthly.map(d => d.month),
    datasets: [
      { label: 'Records', data: monthly.map(d => d.count), borderColor: line, backgroundColor: withAlpha(line, 0.15), fill: true, tension: 0.4 },
      reg && {
        label: 'Trend', data: monthly.map((_, i) => Math.max(0, Math.round(reg.predict(i)))),
        borderColor: 'var(--text-muted)', borderDash: [4, 4], fill: false, pointRadius: 0,
      },
    ].filter(Boolean),
  }
  const lineOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--text-secondary)' } } },
    scales: { x: { grid: GRID, ticks: TICK }, y: { grid: GRID, ticks: TICK, beginAtZero: true } },
  }

  return (
    <section className="card border border-[var(--border-brand)] space-y-4" aria-label={`Drill-down for ${brand}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-[var(--text-primary)]">Drill-down: {brand}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">{records.length} records</span>
          <button onClick={onClose} aria-label="Close drill-down" className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--panel-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-[var(--text-secondary)] mb-3">Monthly record trend</p>
          {monthly.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No dated records for this brand.</p>
          ) : (
            <div style={{ height: 220 }} role="img" aria-label={`Monthly records for ${brand}`}><Line data={chartData} options={lineOpts} /></div>
          )}
          {reg && (
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Trend slope: {reg.slope > 0 ? 'up' : 'down'} {Math.abs(reg.slope).toFixed(2)} per month | R2 = {reg.r2.toFixed(2)}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)] mb-3">Category breakdown</p>
          <ul className="space-y-2">
            {cats.map(c => (
              <li key={c.category}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--text-primary)]">{c.category}</span>
                  <span className="text-[var(--text-secondary)] tabular-nums">{c.count} ({c.pct.toFixed(0)}%)</span>
                </div>
                <div className="h-1.5 bg-[var(--panel-2)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: line }} />
                </div>
              </li>
            ))}
            {cats.length === 0 && <li className="text-[var(--text-muted)] text-sm">No category recorded on these tyres.</li>}
          </ul>
        </div>
      </div>
    </section>
  )
}

/**
 * BrandSizeValuePanel - for the SAME tyre size, which brand is cheapest to RUN
 * (cost per km), not just cheapest to buy. Reads get_brand_size_cpk (V446) and
 * ranks with the pure brandSizeCpk engine. Self-contained fetch.
 */
function BrandSizeValuePanel({ country }) {
  const { activeCurrency } = useSettings()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [minTyres, setMinTyres] = useState(2)
  const [bestOnly, setBestOnly] = useState(false)

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    getBrandSizeCpk({ country, from: from || null, to: to || null })
      .then(setRows)
      .catch(e => setErr(toUserMessage(e, 'Could not load the value comparison.')))
      .finally(() => setLoading(false))
  }, [country, from, to])

  useEffect(() => { load() }, [load])

  const groups = useMemo(() => groupBySize(rows, { minTyres }), [rows, minTyres])
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(g => g.size.toLowerCase().includes(q) || g.brands.some(b => b.brand.toLowerCase().includes(q)))
  }, [groups, search])
  const flat = useMemo(() => {
    const all = flattenSizeGroups(visibleGroups)
    return bestOnly ? all.filter(r => r.isBestValue) : all
  }, [visibleGroups, bestOnly])
  const sizesWithBest = visibleGroups.filter(g => g.brands.some(b => b.isBestValue)).length

  const exportRows = flat.map(b => ({
    size: b.size, brand: b.brand, tyres: b.tyres ?? 'N/A',
    avg_price: b.avgPrice != null ? Number(b.avgPrice.toFixed(2)) : 'N/A',
    median_price: b.medianPrice != null ? Number(b.medianPrice.toFixed(2)) : 'N/A',
    avg_life_km: b.avgLifeKm ?? 'N/A',
    cpk: b.cpk != null ? Number(b.cpk.toFixed(5)) : 'N/A',
    currency: b.currency, best_value: b.isBestValue ? 'Yes' : '',
  }))
  const EXPORT_COLS = ['size', 'brand', 'tyres', 'avg_price', 'median_price', 'avg_life_km', 'cpk', 'currency', 'best_value']
  const EXPORT_HEADERS = ['Size', 'Brand', 'Tyres', 'Avg price', 'Median price', 'Avg life (km)', 'Cost per km', 'Currency', 'Best value']
  const file = reportFileName('TyrePulse Brand Value By Size', country && country !== 'All' ? country : null)
  const doExcel = () => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, file, 'Value by size')
  const doPdf = () => exportToPdf(
    exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
    'Brand and price by size, value comparison' + (country && country !== 'All' ? ` (${country})` : ''),
    file, 'landscape',
  )

  const na = <span className="text-[var(--text-muted)]">N/A</span>
  const numCell = ({ getValue }) => (getValue() == null ? na : formatNumber(getValue()))
  const columns = useMemo(() => [
    { id: 'size', header: 'Size', accessorFn: r => r.size, size: 120, meta: { filterVariant: 'select' }, ...SORT },
    {
      id: 'brand', header: 'Brand', accessorFn: r => r.brand, size: 170, ...SORT,
      cell: ({ row }) => {
        const b = row.original
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`font-medium ${b.isBestValue ? 'text-green-400' : 'text-[var(--text-primary)]'}`}>{b.brand}</span>
            {b.isBestValue && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-green-400 bg-green-500/15 px-1.5 py-0.5 rounded-full">
                <Trophy size={10} aria-hidden="true" /> best value
              </span>
            )}
            {b.isCheapest && !b.isBestValue && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded-full">
                <Tag size={10} aria-hidden="true" /> cheapest
              </span>
            )}
          </div>
        )
      },
    },
    { id: 'avgPrice', header: 'Avg price', accessorFn: r => undef(r.avgPrice), size: 100, meta: { align: 'right' }, cell: numCell, ...SORT },
    { id: 'medianPrice', header: 'Median price', accessorFn: r => undef(r.medianPrice), size: 110, meta: { align: 'right' }, cell: numCell, ...SORT },
    { id: 'avgLifeKm', header: 'Avg life (km)', accessorFn: r => undef(r.avgLifeKm), size: 110, meta: { align: 'right' }, cell: numCell, ...SORT },
    {
      id: 'cpk', header: 'Cost per km', accessorFn: r => undef(r.cpk), size: 110, meta: { align: 'right' }, ...SORT,
      cell: ({ getValue, row }) => (getValue() == null ? na : (
        <span className={`font-mono tabular-nums ${row.original.isBestValue ? 'text-green-400 font-semibold' : 'text-[var(--text-primary)]'}`}>{formatCpk(getValue())}</span>
      )),
    },
    {
      id: 'cpkGapPct', header: 'vs best', accessorFn: r => undef(r.cpkGapPct), size: 90, meta: { align: 'right' }, ...SORT,
      cell: ({ getValue }) => {
        const v = getValue()
        if (v == null) return na
        return v === 0 ? <span className="text-green-400 text-xs">best</span> : <span className="text-amber-400 text-xs">+{formatNumber(v)}%</span>
      },
    },
    { id: 'tyres', header: 'Tyres', accessorFn: r => undef(r.tyres), size: 80, meta: { align: 'right' }, cell: numCell, ...SORT },
    { id: 'currency', header: 'Currency', accessorFn: r => undef(r.currency), size: 80, ...SORT },
  ], []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card space-y-4" aria-labelledby="bsv-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Ruler size={18} className="text-[var(--accent)] mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 id="bsv-title" className="font-semibold text-[var(--text-primary)]">Brand and price by size (value comparison)</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-2xl">
              For the same size, each brand&apos;s purchase price and the cost per km it actually delivers. A cheaper
              tyre that wears out fast can cost more per km than a pricier long-life tyre. Cost per km reads N/A
              until life data exists.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={doExcel} disabled={exportRows.length === 0} className="btn-secondary min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 text-xs px-3 disabled:opacity-40">
            <Download size={14} aria-hidden="true" /> Excel
          </button>
          <button onClick={doPdf} disabled={exportRows.length === 0} className="btn-secondary min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 text-xs px-3 disabled:opacity-40">
            <FileText size={14} aria-hidden="true" /> PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Sizes compared" value={loading || err ? 'N/A' : formatNumber(visibleGroups.length)} />
        <Kpi label="Brand and size pairs" value={loading || err ? 'N/A' : formatNumber(flat.length)} />
        <Kpi label="Sizes with a best value" value={loading || err ? 'N/A' : formatNumber(sizesWithBest)} />
        <Kpi label="Sizes with thin life data" value={loading || err ? 'N/A' : formatNumber(visibleGroups.filter(g => g.thin).length)} />
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          From
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          To
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Min tyres per brand
          <select value={minTyres} onChange={e => setMinTyres(Number(e.target.value))} className={inputCls}>
            {[1, 2, 5, 10, 25].map(n => <option key={n} value={n}>{n}+</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[160px] text-xs text-[var(--text-secondary)]">
          Search size or brand
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="e.g. 315/80 or Techking" className={inputCls} />
        </label>
        <label className="inline-flex items-center gap-2 min-h-[44px] text-xs text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={bestOnly} onChange={e => setBestOnly(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
          Best value only
        </label>
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo('') }} className="btn-secondary min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1 text-xs px-3 self-end">
            <X size={13} aria-hidden="true" /> Clear dates
          </button>
        )}
      </div>

      <EnterpriseTable
        viewKey="brand-value-by-size"
        columns={columns}
        data={flat}
        getRowId={r => r.id}
        loading={loading}
        error={err}
        onRetry={load}
        enableGlobalFilter={false}
        enableColumnFilters
        enableExport={false}
        initialPageSize={25}
        pageSizeOptions={[25, 50, 100]}
        emptyMessage="No priced brand-by-size data for this selection. It needs tyre records with a size, a brand and a purchase price; widen the dates or lower the minimum tyres per brand."
      />

      {!loading && !err && visibleGroups.length > 0 && (
        <details className="rounded-lg border border-[var(--border)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)] min-h-[32px] flex items-center">
            Recommendations by size ({visibleGroups.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {visibleGroups.map(g => (
              <li key={g.size} className="text-xs text-[var(--text-secondary)] leading-relaxed">
                <span className="font-medium text-[var(--text-primary)]">Size {g.size}: </span>
                {recommendationFor(g)}
                {g.thin && <span className="ml-1 text-amber-400">(thin life data)</span>}
                {(g.currency || activeCurrency) && <span className="ml-1 text-[var(--text-muted)]">prices in {g.currency || activeCurrency}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
