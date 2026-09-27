/**
 * FleetAnalytics (route /fleet-analytics) - per-asset tyre history, cost,
 * failure frequency and lifecycle.
 *
 * Per-asset metrics: `report_asset_metrics` RPC. Per-asset tyre COST: the
 * expense grid (`loadGridTyreByAsset`), with the tyre-record sum as the
 * fallback for an asset the grid does not carry - each row states its basis.
 * All shaping, filtering and KPI maths live in the pure `fleetAnalyticsView`
 * engine (which reuses `analyticsEngine` for the monthly buckets and trend).
 *
 * States: skeleton while loading, error + Retry on a failed read (never an
 * empty register), honest "no match" empty state. Light + dark via tokens.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import * as analytics from '../lib/api/analyticsReads'
import { useSettings } from '../contexts/SettingsContext'
import { recordCost } from '../lib/analyticsEngine'
import { loadGridTyreByAsset } from '../lib/api/costSummary'
import {
  BarChart2, Download, FileText, AlertTriangle, RefreshCw, X, Layers, Activity, Coins, ShieldAlert, Eye,
} from 'lucide-react'
import { SkeletonCards, SkeletonChart } from '../components/ui/Skeleton'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import DateField from '../components/ui/DateField'
import EmailPdfButton from '../components/EmailPdfButton'
import SectionTabs, { FLEET_TABS } from '../components/ui/SectionTabs'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { formatCurrencyCompact } from '../lib/formatters'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  withGridCost, assetRows, siteOptions, brandOptions, filterAssets, activeFilterCount,
  fleetKpis, assetTrend, trendNote, serialLifecycle, exportRows, EXPORT_COLUMNS, HIGH_FREQ_PER_MONTH,
} from '../lib/fleetAnalyticsView'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler)

// Risk keeps its semantic tint; the level is always printed as text too.
const RISK_BADGE = {
  Critical: 'bg-red-500/15 text-red-400 border-red-500/40',
  High:     'bg-red-500/15 text-red-400 border-red-500/40',
  Medium:   'bg-amber-500/15 text-amber-300 border-amber-500/40',
  Low:      'bg-green-500/15 text-green-400 border-green-500/40',
  Unknown:  'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-dim)]',
}

const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-sm border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)] disabled:opacity-50 disabled:cursor-not-allowed'
const SELECT = 'input text-sm min-h-[44px]'
const EMPTY_FILTERS = { search: '', from: '', to: '', site: '', brand: '', risk: '' }

function Kpi({ icon: Icon, label, value, sub }) {
  return (
    <Card pad="tight">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
      </div>
      <p className="text-2xl font-bold text-[var(--text-primary)] mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </Card>
  )
}

export default function FleetAnalytics() {
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  const [assetMetrics, setAssetMetrics] = useState([])
  // Authoritative per-asset tyre cost from the expense grid (V347). null when the
  // grid is unavailable for this scope -> per-asset totals fall back to tyre_records.
  const [gridCost, setGridCost] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [exportError, setExportError] = useState('')
  const [filters, setFilters]   = useState(EMPTY_FILTERS)
  const [selected, setSelected] = useState(null)
  const [selectedRecords, setSelectedRecords] = useState([])
  const [selectedLoading, setSelectedLoading] = useState(false)
  const [selectedError, setSelectedError] = useState('')
  const [selectedNonce, setSelectedNonce] = useState(0)

  // Guards against a slow earlier response overwriting a newer one after the
  // active country changes (fetch-race cancellation).
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true); setError(null)
    try {
      const [{ data, error: e }, grid] = await Promise.all([
        analytics.reportAssetMetrics({ country: activeCountry }),
        loadGridTyreByAsset({ country: activeCountry }),
      ])
      if (myReq !== reqIdRef.current) return
      if (e) throw e
      setAssetMetrics(data || [])
      setGridCost(grid && grid.map ? grid.map : null)
    } catch (e) {
      if (myReq === reqIdRef.current) setError(toUserMessage(e, t('fleetanalytics.loadErrorFallback')))
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [activeCountry, t])

  useEffect(() => { load() }, [load])

  // Lazy-load the selected asset's raw rows for the detail view.
  useEffect(() => {
    if (!selected) { setSelectedRecords([]); setSelectedError(''); return }
    let cancelled = false
    setSelectedLoading(true); setSelectedError('')
    analytics.listAssetTyreRecords({ assetNo: selected, country: activeCountry })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) { setSelectedError(toUserMessage(e, 'Could not load this asset\'s records.')); setSelectedRecords([]) }
        else setSelectedRecords(data || [])
      })
      .catch((e) => { if (!cancelled) { setSelectedError(toUserMessage(e, 'Could not load this asset\'s records.')); setSelectedRecords([]) } })
      .finally(() => { if (!cancelled) setSelectedLoading(false) })
    return () => { cancelled = true }
  }, [selected, activeCountry, selectedNonce])

  const rows = useMemo(() => assetRows(withGridCost(assetMetrics, gridCost)), [assetMetrics, gridCost])
  const sites = useMemo(() => siteOptions(rows), [rows])
  const brands = useMemo(() => brandOptions(rows), [rows])
  const filtered = useMemo(() => filterAssets(rows, filters), [rows, filters])
  const filterCount = activeFilterCount(filters)
  const kpis = useMemo(() => fleetKpis(filtered), [filtered])
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const money = (v) => (v == null ? 'N/A' : formatCurrencyCompact(v, activeCurrency))

  const columns = useMemo(() => [
    { id: 'assetNo', header: t('fleetanalytics.table.assetNo'), accessorFn: (a) => a.assetNo, size: 140,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-[var(--text-primary)]">
          {row.original.assetNo}
          {selected === row.original.assetNo && <span className="text-[10px] font-sans px-1.5 py-0.5 rounded border border-[var(--border-bright)] text-[var(--text-secondary)]">Open</span>}
        </span>
      ) },
    { id: 'count', header: t('fleetanalytics.table.records'), accessorFn: (a) => a.count, size: 100, meta: { align: 'right' } },
    { id: 'totalCost', header: t('fleetanalytics.table.totalCost'), accessorFn: (a) => a.totalCost, size: 140, meta: { align: 'right', exportValue: (a) => a.totalCost ?? 'N/A' },
      cell: ({ row }) => (
        <span className="tabular-nums" title={row.original.costBasis === 'grid' ? 'From the expense grid' : 'From tyre records (asset not in the expense grid)'}>
          {money(row.original.totalCost)}
          {row.original.costBasis !== 'grid' && <span className="text-[var(--text-dim)] text-[10px]"> (records)</span>}
        </span>
      ) },
    { id: 'highRiskCount', header: t('fleetanalytics.table.highRisk'), accessorFn: (a) => a.highRiskCount, size: 110, meta: { align: 'right' },
      cell: ({ row }) => (row.original.highRiskCount > 0
        ? <span className="text-xs px-2 py-0.5 rounded-full border bg-red-500/15 text-red-400 border-red-500/40 tabular-nums">{row.original.highRiskCount} high</span>
        : <span className="text-[var(--text-dim)] tabular-nums">0</span>) },
    { id: 'failureFreqPerMonth', header: t('fleetanalytics.table.failPerMonth'), accessorFn: (a) => a.failureFreqPerMonth, size: 100, meta: { align: 'right' },
      cell: ({ row }) => {
        const v = row.original.failureFreqPerMonth
        return <span className={`tabular-nums text-xs ${v != null && v > HIGH_FREQ_PER_MONTH ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{v == null ? 'N/A' : v.toFixed(1)}</span>
      } },
    { id: 'sites', header: t('fleetanalytics.table.sites'), accessorFn: (a) => a.sites.join(', '), size: 180,
      cell: ({ row }) => <span className="text-xs text-[var(--text-secondary)] whitespace-normal">{row.original.sites.join(', ') || 'N/A'}</span> },
    { id: 'brands', header: t('fleetanalytics.table.brands'), accessorFn: (a) => a.brands.join(', '), size: 180,
      cell: ({ row }) => <span className="text-xs text-[var(--text-secondary)] whitespace-normal">{row.original.brands.join(', ') || 'N/A'}</span> },
    { id: 'lastSeen', header: t('fleetanalytics.table.lastSeen'), accessorFn: (a) => a.lastSeen, size: 120,
      cell: ({ row }) => <span className="text-xs text-[var(--text-muted)]">{row.original.lastSeen || 'N/A'}</span> },
    { id: 'open', header: '', enableSorting: false, size: 90, meta: { export: false },
      cell: ({ row }) => (
        <button type="button"
          onClick={(e) => { e.stopPropagation(); setSelected(selected === row.original.assetNo ? null : row.original.assetNo) }}
          aria-label={`${selected === row.original.assetNo ? 'Close' : 'Open'} detail for asset ${row.original.assetNo}`}
          aria-expanded={selected === row.original.assetNo}
          className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)]">
          <Eye size={16} aria-hidden="true" />
        </button>
      ) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, selected, activeCurrency])

  const pdfColumns = EXPORT_COLUMNS.map(([key, header]) => ({ key, header }))
  const pdfRows = () => exportRows(filtered).map((r) => ({ ...r, total_cost: r.total_cost === 'N/A' ? 'N/A' : formatCurrencyCompact(r.total_cost, activeCurrency) }))

  async function runExport(kind) {
    setExportError('')
    try {
      if (kind === 'excel') {
        await exportToExcel(exportRows(filtered), EXPORT_COLUMNS.map(([k]) => k), EXPORT_COLUMNS.map(([, h]) => h), 'TyrePulse_FleetAnalytics')
      } else {
        await exportToPdf(pdfRows(), pdfColumns, 'Fleet Analytics Report', 'TyrePulse_FleetAnalytics', 'landscape')
      }
    } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  if (loading && !assetMetrics.length) return (
    <div className="space-y-5">
      <PageHeader title={t('fleetanalytics.title')} subtitle={t('fleetanalytics.loading')} icon={BarChart2} />
      <SkeletonCards count={4} />
      <SkeletonChart />
    </div>
  )

  if (error && !assetMetrics.length) return (
    <div className="space-y-5">
      <PageHeader title={t('fleetanalytics.title')} subtitle={t('fleetanalytics.subtitleError')} icon={BarChart2} />
      <Card tone="crit" role="alert" className="items-center text-center gap-2" style={{ padding: 'var(--space-8)' }}>
        <AlertTriangle size={40} className="text-red-400" aria-hidden="true" />
        <p className="text-[var(--text-primary)] font-medium">{t('fleetanalytics.loadErrorTitle')}</p>
        <p className="text-[var(--text-muted)] text-sm">{error}</p>
        <button type="button" onClick={load} className={BTN}>
          <RefreshCw size={16} aria-hidden="true" /> {t('fleetanalytics.retry')}
        </button>
      </Card>
    </div>
  )

  const selectedAsset = selected
    ? { ...(rows.find(a => a.assetNo === selected) || { assetNo: selected, sites: [], brands: [], count: 0, totalCost: null }), records: selectedRecords }
    : null

  return (
    <div className="space-y-6">
      <SectionTabs tabs={FLEET_TABS} />
      <PageHeader
        title={t('fleetanalytics.title')}
        subtitle={t('fleetanalytics.subtitleFull')}
        icon={BarChart2}
        onRefresh={load}
        refreshing={loading}
        actions={(
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => runExport('excel')} disabled={!filtered.length} className={BTN}>
              <Download size={14} aria-hidden="true" /> {t('fleetanalytics.actions.excel')}
            </button>
            <button type="button" onClick={() => runExport('pdf')} disabled={!filtered.length} className={BTN}>
              <FileText size={14} aria-hidden="true" /> {t('fleetanalytics.actions.pdf')}
            </button>
            <EmailPdfButton
              className={BTN}
              getPdf={async () => ({
                base64: await exportToPdf(pdfRows(), pdfColumns, 'Fleet Analytics Report', 'TyrePulse_FleetAnalytics', 'landscape', '', { returnBase64: true }),
                filename: 'TyrePulse_FleetAnalytics.pdf',
                subject: 'Fleet Analytics',
                bodyHtml: '<p>Attached is the Fleet Analytics report.</p>',
              })}
            />
          </div>
        )}
      />

      {error && (
        <Card tone="crit" role="alert" className="flex-wrap items-center justify-between gap-3" style={{ flexDirection: 'row' }}>
          <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]"><AlertTriangle size={16} className="text-red-400" aria-hidden="true" /> {error}</span>
          <button type="button" onClick={load} className={BTN}><RefreshCw size={14} aria-hidden="true" /> {t('fleetanalytics.retry')}</button>
        </Card>
      )}
      {exportError && (
        <Card tone="crit" role="alert" className="items-center gap-2" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={16} className="text-red-400" aria-hidden="true" />
          <span className="text-sm text-[var(--text-primary)]">{exportError}</span>
        </Card>
      )}

      {/* KPI strip - describes exactly the assets matching the filters. */}
      <div>
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={Layers} label={t('fleetanalytics.summary.totalAssets')} value={kpis.assets.toLocaleString()} sub={`${kpis.records.toLocaleString()} tyre records`} />
          <Kpi icon={Activity} label={t('fleetanalytics.summary.highFreqAssets')} value={kpis.highFreq.toLocaleString()} sub={`Above ${HIGH_FREQ_PER_MONTH} failures per month`} />
          <Kpi icon={ShieldAlert} label="Assets with high-risk tyres" value={kpis.highRiskAssets.toLocaleString()} sub="At least one high-risk record" />
          <Kpi icon={Coins} label={t('fleetanalytics.summary.avgCostPerAsset')} value={money(kpis.avgCost)}
            sub={`${kpis.gridCosted.toLocaleString()} of ${kpis.assets.toLocaleString()} costed from the expense grid`} />
        </div>
        {filterCount > 0 && (
          <p className="text-xs text-[var(--text-muted)] mt-2">These figures cover the {kpis.assets.toLocaleString()} assets matching the current filters.</p>
        )}
      </div>

      {/* Filters */}
      <Card pad="tight" className="gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--text-muted)] space-y-1 flex-1 min-w-[12rem]">
            <span className="block">Asset</span>
            <input className="input w-full min-h-[44px]" placeholder={t('fleetanalytics.filters.searchPlaceholder')}
              value={filters.search} onChange={e => setFilter('search', e.target.value)} />
          </label>
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            <span className="block">Last activity from</span>
            <DateField className="text-sm w-40" value={filters.from} onChange={(v) => setFilter('from', v)} placeholder={t('fleetanalytics.filters.fromPlaceholder')} ariaLabel="Last activity from" />
          </div>
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            <span className="block">Last activity to</span>
            <DateField className="text-sm w-40" value={filters.to} onChange={(v) => setFilter('to', v)} placeholder={t('fleetanalytics.filters.toPlaceholder')} ariaLabel="Last activity to" min={filters.from || undefined} />
          </div>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span className="block">Site</span>
            <select className={SELECT} value={filters.site} onChange={e => setFilter('site', e.target.value)}>
              <option value="">{t('fleetanalytics.filters.allSites')}</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span className="block">Brand</span>
            <select className={SELECT} value={filters.brand} onChange={e => setFilter('brand', e.target.value)}>
              <option value="">All brands</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span className="block">Risk</span>
            <select className={SELECT} value={filters.risk} onChange={e => setFilter('risk', e.target.value)}>
              <option value="">All assets</option>
              <option value="high">With high-risk tyres</option>
              <option value="frequent">Frequent failures</option>
            </select>
          </label>
          {(filterCount > 0 || filters.search) && (
            <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className={BTN}>
              <X size={14} aria-hidden="true" /> Clear filters{filterCount ? ` (${filterCount})` : ''}
            </button>
          )}
        </div>
      </Card>

      <Card pad="tight">
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(a) => a.id}
          loading={loading}
          enableGlobalFilter={false}
          initialPageSize={25}
          onRowClick={(a) => setSelected((cur) => (cur === a.assetNo ? null : a.assetNo))}
          emptyMessage={t('fleetanalytics.empty.noMatch')}
          exportFileName="Fleet Analytics"
          reportMeta={{ title: 'Fleet Analytics', currency: activeCurrency }}
        />
      </Card>

      {selectedAsset && (
        <AssetDrillDown
          asset={selectedAsset}
          currency={activeCurrency}
          loading={selectedLoading}
          error={selectedError}
          onRetry={() => setSelectedNonce((n) => n + 1)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function AssetDrillDown({ asset, currency, loading, error, onRetry, onClose }) {
  const { t } = useLanguage()
  const { monthly, reg } = useMemo(() => assetTrend(asset.records), [asset.records])
  const serials = useMemo(() => serialLifecycle(asset.records), [asset.records])
  const note = trendNote(reg)

  const costData = {
    labels: monthly.map(d => d.month),
    datasets: [{
      label: t('fleetanalytics.drill.costDataset', { currency }),
      data: monthly.map(d => Math.round(d.total)),
      backgroundColor: withAlpha(colorAt(0), 0.55),
      borderColor: colorAt(0),
      borderRadius: 4,
    }],
  }
  const countData = {
    labels: monthly.map(d => d.month),
    datasets: [
      {
        label: t('fleetanalytics.drill.recordsDataset'),
        data: monthly.map(d => d.count),
        borderColor: colorAt(1),
        backgroundColor: withAlpha(colorAt(1), 0.12),
        fill: true, tension: 0.4,
      },
      reg && {
        label: t('fleetanalytics.drill.trendDataset'),
        data: monthly.map((_, i) => Math.max(0, parseFloat(reg.predict(i).toFixed(1)))),
        borderColor: 'var(--text-muted)',
        borderDash: [4, 4], fill: false, pointRadius: 0,
      },
    ].filter(Boolean),
  }
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--text-secondary)', font: { size: 11 } } } },
    scales: {
      x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
      y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)' } },
    },
  }
  const barOpts = { ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } } }

  const serialColumns = [
    { id: 'serial', header: t('fleetanalytics.drill.columns.serial'), accessorFn: (r) => r.serial, size: 160,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{row.original.serial}</span> },
    { id: 'risk', header: t('fleetanalytics.drill.columns.risk'), accessorFn: (r) => r.risk || 'Unknown', size: 110, meta: { filterVariant: 'select' },
      cell: ({ row }) => <span className={`text-xs px-2 py-0.5 rounded-full border ${RISK_BADGE[row.original.risk] || RISK_BADGE.Unknown}`}>{row.original.risk || t('fleetanalytics.drill.unknownRisk')}</span> },
    { id: 'brand', header: t('fleetanalytics.drill.columns.brand'), accessorFn: (r) => r.brand || t('fleetanalytics.drill.unknownBrand'), size: 140 },
    { id: 'category', header: t('fleetanalytics.drill.columns.category'), accessorFn: (r) => r.category || t('fleetanalytics.drill.uncategorised'), size: 140 },
    { id: 'events', header: 'Events', accessorFn: (r) => r.events, size: 90, meta: { align: 'right' } },
    { id: 'firstDate', header: 'First seen', accessorFn: (r) => r.firstDate, size: 120 },
    { id: 'latestDate', header: 'Latest', accessorFn: (r) => r.latestDate, size: 120 },
  ]
  const historyColumns = [
    { id: 'issue_date', header: t('fleetanalytics.drill.columns.date'), accessorFn: (r) => r.issue_date, size: 110,
      cell: ({ row }) => <span className="text-[var(--text-muted)]">{row.original.issue_date || 'N/A'}</span> },
    { id: 'serial_no', header: t('fleetanalytics.drill.columns.serial'), accessorFn: (r) => r.serial_no || '', size: 150,
      cell: ({ row }) => <span className="font-mono text-[var(--text-secondary)]">{row.original.serial_no || 'N/A'}</span> },
    { id: 'brand', header: t('fleetanalytics.drill.columns.brand'), accessorFn: (r) => r.brand || '', size: 120 },
    { id: 'category', header: t('fleetanalytics.drill.columns.category'), accessorFn: (r) => r.category || '', size: 120 },
    { id: 'risk_level', header: t('fleetanalytics.drill.columns.risk'), accessorFn: (r) => r.risk_level || 'Unknown', size: 100, meta: { filterVariant: 'select' },
      cell: ({ row }) => <span className={`px-1.5 py-0.5 rounded text-xs border ${RISK_BADGE[row.original.risk_level] || RISK_BADGE.Unknown}`}>{row.original.risk_level || 'Unknown'}</span> },
    { id: 'cost', header: t('fleetanalytics.drill.columns.cost'), accessorFn: (r) => (r.cost_per_tyre == null ? null : recordCost(r)), size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.cost_per_tyre == null ? 'N/A' : formatCurrencyCompact(recordCost(row.original), currency)}</span> },
    { id: 'remarks', header: t('fleetanalytics.drill.columns.remarks'), accessorFn: (r) => r.remarks_cleaned || r.remarks || '', size: 260,
      cell: ({ row }) => <span className="text-[var(--text-muted)] whitespace-normal">{row.original.remarks_cleaned || row.original.remarks || 'N/A'}</span> },
  ]

  return (
    <Card className="gap-6" aria-labelledby="fa-drill-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="fa-drill-title" className="text-[var(--text-primary)] font-bold text-lg font-mono">{asset.assetNo}</h3>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            {`${(asset.count ?? 0).toLocaleString()} records | ${asset.totalCost == null ? 'N/A' : formatCurrencyCompact(asset.totalCost, currency)} tyre cost${asset.costBasis === 'grid' ? ' (expense grid)' : ' (tyre records)'} | active since ${asset.firstSeen || 'N/A'}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(asset.sites || []).map(s => (
            <span key={s} className="text-xs px-2 py-0.5 rounded-full border border-[var(--border-dim)] text-[var(--text-secondary)]">{s}</span>
          ))}
          <button type="button" onClick={onClose} aria-label={`Close detail for asset ${asset.assetNo}`}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)]">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 p-3">
          <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]"><AlertTriangle size={16} className="text-red-400" aria-hidden="true" /> {error}</span>
          <button type="button" onClick={onRetry} className={BTN}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      ) : loading ? (
        <SkeletonChart />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-[var(--text-muted)] mb-2">{t('fleetanalytics.drill.monthlyCost', { currency })}</p>
              <div style={{ height: 200 }} role="img" aria-label={`Monthly tyre record cost for ${asset.assetNo}`}>
                {monthly.length ? <Bar data={costData} options={barOpts} /> : <p className="text-xs text-[var(--text-muted)]">No dated records.</p>}
              </div>
              <p className="text-xs text-[var(--text-dim)] mt-1">Breakdown from tyre records; the authoritative total comes from the expense grid.</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)] mb-2">{t('fleetanalytics.drill.failureFrequency')}</p>
              <div style={{ height: 200 }} role="img" aria-label={`Monthly record count and trend for ${asset.assetNo}`}>
                {monthly.length ? <Line data={countData} options={chartOpts} /> : <p className="text-xs text-[var(--text-muted)]">No dated records.</p>}
              </div>
              <p className="text-xs text-[var(--text-dim)] mt-1">{note || 'Trend needs at least two months of records.'}</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-[var(--text-secondary)] mb-3">Tyre lifecycle by serial number</p>
            <EnterpriseTable
              columns={serialColumns}
              data={serials}
              getRowId={(r) => r.id}
              initialPageSize={10}
              pageSizeOptions={[10, 25, 50]}
              searchPlaceholder="Search serials"
              emptyMessage={t('fleetanalytics.drill.noSerialData')}
              exportFileName={`Tyre lifecycle ${asset.assetNo}`}
              reportMeta={{ title: `Tyre lifecycle ${asset.assetNo}` }}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-[var(--text-secondary)] mb-3">Full record history</p>
            <EnterpriseTable
              columns={historyColumns}
              data={asset.records}
              getRowId={(r, i) => String(r.id ?? i)}
              initialPageSize={25}
              searchPlaceholder="Search records"
              emptyMessage="No tyre records for this asset."
              exportFileName={`Tyre records ${asset.assetNo}`}
              reportMeta={{ title: `Tyre records ${asset.assetNo}`, currency }}
            />
          </div>
        </>
      )}
    </Card>
  )
}
