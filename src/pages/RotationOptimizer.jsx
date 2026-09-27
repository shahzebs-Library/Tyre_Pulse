/**
 * RotationOptimizer (route /rotation-optimizer) - maintenance-planning tool.
 * For every vehicle it analyses the tyres currently fitted and recommends
 * rotations/swaps that even out tread wear and extend overall tyre life.
 *
 * Runs on the existing `tyre_records` table (in-service tyres, removal_date IS
 * NULL). KPI strip, most-imbalanced chart, status mix, filters + search, a
 * sortable EnterpriseTable of analysed assets (opening one shows its narrative,
 * compliance issues, swaps and fitted tyres), a swap work list, and Excel/PDF
 * export. All optimisation and page shaping lives in the pure, unit-tested
 * `src/lib/rotationOptimizer.js`. Honest empty/error/loading states, no mock data.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  RotateCcw, AlertTriangle, Truck, Search, X, FileSpreadsheet, FileText, ArrowRightLeft,
  CheckCircle2, Info, ShieldAlert, ShieldCheck, Zap, ArrowRight, Scale, BarChart3, Gauge,
} from 'lucide-react'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip as ChartTooltip, Legend,
} from 'chart.js'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import { listInServiceTyres } from '../lib/api/rotationOptimizer'
import {
  optimizeFleet, serialOf, positionOf, treadOf, DEFAULT_ROTATION_OPTS, LEGAL_MIN_TREAD_MM,
  ROTATION_STATUS_KEYS, ROTATION_STATUS_LABEL, EMPTY_ROTATION_FILTERS, enrichRotationAssets,
  rotationSiteOptions, activeRotationFilterCount, filterRotationAssets, rotationPageKpis,
  flattenSwaps, mostImbalanced, rotationExportRows, ROTATION_EXPORT_COLUMNS,
} from '../lib/rotationOptimizer'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, ChartTooltip, Legend)

// Semantic status: colour carries urgency and every badge also names it with an icon.
const STATUS_META = {
  critical: { cls: 'bg-red-500/15 text-red-300 border border-red-500/40', color: '#ef4444', icon: ShieldAlert },
  warning: { cls: 'bg-orange-500/15 text-orange-300 border border-orange-500/40', color: '#f97316', icon: AlertTriangle },
  advisory: { cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/40', color: '#f59e0b', icon: AlertTriangle },
  good: { cls: 'bg-green-500/15 text-green-300 border border-green-500/40', color: '#22c55e', icon: ShieldCheck },
}
const URGENCY_BAR = { critical: '#ef4444', warning: '#f97316', advisory: '#0ea5e9' }
const treadTone = (mm) =>
  mm == null ? 'text-[var(--text-muted)]' : mm < LEGAL_MIN_TREAD_MM ? 'text-red-400' : mm < 4 ? 'text-amber-400' : 'text-emerald-400'

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.good
  const Icon = m.icon
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded shrink-0 inline-flex items-center gap-1 whitespace-nowrap ${m.cls}`}>
      <Icon size={11} aria-hidden="true" /> {ROTATION_STATUS_LABEL[status] || 'Good'}
    </span>
  )
}

function Kpi({ label, value, icon: Icon, tone, sub, loading }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-3xl font-bold mt-1 tabular-nums ${tone}`}>
        {loading ? <span className="inline-block h-8 w-16 rounded bg-[var(--input-bg)] animate-pulse" aria-label="Loading" /> : (value ?? 'N/A')}
      </p>
      {sub && !loading && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p>}
    </div>
  )
}

const tyreColumns = (stats) => [
  { id: 'serial', header: 'Serial', accessorFn: (t) => serialOf(t) || '', size: 150, cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
  { id: 'position', header: 'Position', accessorFn: (t) => positionOf(t) || '', size: 110, cell: ({ getValue }) => getValue() || 'N/A' },
  { id: 'brand', header: 'Brand / Size', accessorFn: (t) => `${t.brand || ''} ${t.size || ''}`.trim(), size: 180, cell: ({ row }) => `${row.original.brand || 'N/A'}${row.original.size ? `, ${row.original.size}` : ''}` },
  {
    id: 'tread', header: 'Tread', accessorFn: (t) => treadOf(t), size: 120, sortUndefined: 'last', meta: { align: 'right' },
    cell: ({ getValue }) => {
      const tr = getValue()
      if (tr == null) return <span className="text-[var(--text-muted)]">N/A</span>
      const isMin = tr === stats.min
      const isMax = tr === stats.max
      return (
        <span className={`${treadTone(tr)} ${isMin || isMax ? 'font-semibold' : ''}`}>
          {tr}mm{isMin ? ' (most worn)' : isMax ? ' (freshest)' : ''}
        </span>
      )
    },
  },
  {
    id: 'km', header: 'Total km', accessorFn: (t) => (t.total_km == null ? null : Number(t.total_km)), size: 110, sortUndefined: 'last', meta: { align: 'right' },
    cell: ({ getValue }) => (getValue() == null ? 'N/A' : getValue().toLocaleString()),
  },
]

export default function RotationOptimizer() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [filters, setFilters] = useState(EMPTY_ROTATION_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const [openAsset, setOpenAsset] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listInServiceTyres({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load tyre records.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  const failed = Boolean(error)
  const { assets, summary } = useMemo(() => optimizeFleet(rows || [], DEFAULT_ROTATION_OPTS), [rows])
  const enriched = useMemo(() => enrichRotationAssets(assets, rows || []), [assets, rows])
  const sites = useMemo(() => rotationSiteOptions(enriched), [enriched])
  const filtered = useMemo(() => filterRotationAssets(enriched, filters), [enriched, filters])
  const pageKpi = useMemo(() => rotationPageKpis(filtered), [filtered])
  const swaps = useMemo(() => flattenSwaps(filtered), [filtered])
  const top = useMemo(() => mostImbalanced(filtered), [filtered])
  const filterCount = activeRotationFilterCount(filters)

  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Assets analysed', value: kv(pageKpi.assets), icon: Truck, tone: 'text-[var(--text-primary)]', sub: failed ? null : `${summary.assetsAnalyzed} in the fleet with 2 or more readings` },
    { label: 'Need rotation', value: kv(pageKpi.needing), icon: RotateCcw, tone: 'text-amber-400' },
    { label: 'Critical (safety)', value: kv(pageKpi.critical), icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'Avg wear balance', value: failed || pageKpi.avgWearBalance == null ? null : `${pageKpi.avgWearBalance}/100`, icon: Scale, tone: 'text-[var(--text-primary)]' },
    { label: 'Recommended swaps', value: kv(pageKpi.swaps), icon: ArrowRightLeft, tone: 'text-[var(--brand-bright)]', sub: failed || pageKpi.benefitKm == null ? null : `About ${pageKpi.benefitKm.toLocaleString()} km recovered` },
    { label: `Tyres under ${LEGAL_MIN_TREAD_MM}mm`, value: kv(pageKpi.belowLegal), icon: Gauge, tone: pageKpi.belowLegal ? 'text-red-400' : 'text-green-400', sub: 'Below the legal minimum' },
  ]

  const chart = useMemo(() => {
    if (!top.length) return null
    return {
      data: {
        labels: top.map((a) => String(a.asset_no)),
        datasets: [{
          label: 'Tread spread (mm)',
          data: top.map((a) => a.spread),
          backgroundColor: top.map((a) => URGENCY_BAR[a.urgency] || '#0ea5e9'),
          borderRadius: 4,
          maxBarThickness: 34,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y}mm spread` } } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)' }, title: { display: true, text: 'mm', color: 'var(--text-muted)' } },
          x: { grid: { display: false }, ticks: { color: 'var(--text-muted)', maxRotation: 60, minRotation: 0, autoSkip: false } },
        },
      },
    }
  }, [top])

  const statusChart = {
    labels: ROTATION_STATUS_KEYS.map((k) => ROTATION_STATUS_LABEL[k]),
    datasets: [{ data: ROTATION_STATUS_KEYS.map((k) => pageKpi.byStatus[k]), backgroundColor: ROTATION_STATUS_KEYS.map((k) => STATUS_META[k].color), borderWidth: 0 }],
  }
  const statusOpts = { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12 } } } }

  const doExport = async (kind) => {
    const out = rotationExportRows(filtered)
    const keys = ROTATION_EXPORT_COLUMNS.map(([k]) => k)
    const headers = ROTATION_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Rotation Optimizer')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Rotation Optimizer', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const assetColumns = useMemo(() => [
    {
      id: 'asset', header: 'Asset', accessorFn: (a) => String(a.asset_no || ''), size: 140,
      cell: ({ row }) => (
        <span className="font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
          <Truck size={13} className="text-[var(--text-muted)]" aria-hidden="true" /> {row.original.asset_no}
        </span>
      ),
    },
    { id: 'site', header: 'Site', accessorFn: (a) => a.site || '', size: 120, cell: ({ getValue }) => getValue() || 'Unassigned site' },
    { id: 'status', header: 'Status', accessorFn: (a) => ROTATION_STATUS_KEYS.indexOf(a.overallStatus), size: 120, cell: ({ row }) => <StatusBadge status={row.original.overallStatus} /> },
    {
      id: 'balance', header: 'Wear balance', accessorFn: (a) => a.wearBalanceScore, size: 130, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() == null ? <span className="text-[var(--text-muted)]">N/A</span> : <span className="tabular-nums">{getValue()}/100</span>),
    },
    {
      id: 'spread', header: 'Spread', accessorFn: (a) => a.spread, size: 100, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => {
        const a = row.original
        if (a.spread == null) return <span className="text-[var(--text-muted)]">N/A</span>
        return <span className={`font-semibold ${a.urgency === 'critical' ? 'text-red-400' : a.urgency === 'warning' ? 'text-orange-400' : 'text-[var(--text-secondary)]'}`}>{a.spread}mm</span>
      },
    },
    { id: 'range', header: 'Tread range', accessorFn: (a) => a.stats.min, size: 130, sortUndefined: 'last', cell: ({ row }) => (row.original.stats.min == null ? 'N/A' : `${row.original.stats.min} to ${row.original.stats.max}mm`) },
    { id: 'tyres', header: 'Tyres', accessorFn: (a) => a.stats.count, size: 80, meta: { align: 'right' } },
    { id: 'swaps', header: 'Swaps', accessorFn: (a) => a.swaps.length, size: 80, meta: { align: 'right' }, cell: ({ getValue }) => (getValue() ? <span className="text-[var(--brand-bright)] font-semibold">{getValue()}</span> : '0') },
    { id: 'issues', header: 'Issues', accessorFn: (a) => a.violations.length, size: 80, meta: { align: 'right' }, cell: ({ getValue }) => (getValue() ? <span className="text-red-400 font-semibold">{getValue()}</span> : '0') },
    {
      id: 'benefit', header: 'Km recovered', accessorFn: (a) => a._benefitKm, size: 130, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() == null ? <span className="text-[var(--text-muted)]">N/A</span> : `~${getValue().toLocaleString()} km`),
    },
  ], [])

  const swapColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (s) => String(s.asset_no || ''), size: 120 },
    { id: 'tyre', header: 'Tyre', accessorFn: (s) => s.tyre || '', size: 150, cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || 'N/A'}</span> },
    {
      id: 'move', header: 'Move', accessorFn: (s) => `${s.from_position || ''} ${s.to_position || ''}`, size: 260,
      cell: ({ row }) => {
        const s = row.original
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-[var(--text-secondary)]">
            <span>{s.from_position || 'unknown position'}</span>
            <span className={`font-semibold ${treadTone(s.from_tread_mm)}`}>{s.from_tread_mm}mm</span>
            <ArrowRight size={14} className="text-[var(--brand-bright)]" aria-label="to" />
            <span>{s.to_position || 'unknown position'}</span>
            <span className={`font-semibold ${treadTone(s.to_tread_mm)}`}>{s.to_tread_mm}mm</span>
          </span>
        )
      },
    },
    { id: 'gain', header: 'Tread gain', accessorFn: (s) => s.tread_delta_mm, size: 110, meta: { align: 'right' }, cell: ({ getValue }) => `+${getValue()}mm` },
    { id: 'benefit', header: 'Km recovered', accessorFn: (s) => s.expected_benefit_km, size: 130, meta: { align: 'right' }, cell: ({ getValue }) => `~${Number(getValue()).toLocaleString()} km` },
    {
      id: 'impact', header: 'Impact', accessorFn: (s) => s.impact_score, size: 100, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="inline-flex items-center gap-1 tabular-nums"><Zap size={11} aria-hidden="true" /> {getValue()}</span>,
    },
  ], [])

  const unavailable = <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Unavailable: tyre records could not be loaded.</div>

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rotation Optimizer"
        subtitle="Analyses each vehicle's fitted tyres and recommends rotations to even out tread wear and extend tyre life."
        icon={RotateCcw}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load tyre records.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error} The figures below are unavailable until the records load.</p>
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px]" disabled={refreshing}>Retry</button>
        </div>
      )}

      {notice && (
        <div className="card border border-amber-500/40 flex items-start justify-between gap-3" role="status">
          <p className="text-sm text-amber-300">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)]" aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      {/* Honest limitation note: axle role is inferred from free-text positions. */}
      <div className="card border border-[var(--input-border)] flex items-start gap-2.5 py-2.5">
        <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" aria-hidden="true" />
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Axle roles (steer, drive, trailer) are <span className="text-[var(--text-secondary)]">inferred from each tyre's free-text position label</span>. This dataset has no per-axle, side, or inner/outer wheel data and a single tread value per tyre. Steer-imbalance checks are therefore <span className="text-[var(--text-secondary)]">heuristic</span>; the <span className="text-red-300">below-legal-minimum (under {LEGAL_MIN_TREAD_MM}mm)</span> check is exact. No values are estimated where a signal is missing.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><BarChart3 size={15} aria-hidden="true" /> Most imbalanced assets</h2>
          <p className="text-xs text-[var(--text-muted)] mb-3">Tread spread (max minus min) across each vehicle's fitted tyres. Red is critical, orange is a warning.</p>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? unavailable
                : chart ? (
                  <div className="h-full" role="img" aria-label={top.map((a) => `${a.asset_no} ${a.spread}mm`).join(', ')}>
                    <Bar data={chart.data} options={chart.options} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No assets with a measured spread in this view.</div>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><ShieldCheck size={15} aria-hidden="true" /> Status mix</h2>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? unavailable
                : filtered.length ? (
                  <div className="h-full" role="img" aria-label={ROTATION_STATUS_KEYS.map((k) => `${ROTATION_STATUS_LABEL[k]} ${pageKpi.byStatus[k]}`).join(', ')}>
                    <Doughnut data={statusChart} options={statusOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No assets in this view.</div>}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,2fr)_1fr_1fr_1fr] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Asset, site or tyre serial" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Priority</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
              <option value="all">All assets</option>
              <option value="needs">Needs rotation</option>
              <option value="high">High priority</option>
              <option value="medium">Medium priority</option>
              <option value="balanced">Balanced</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="all">All statuses</option>
              {ROTATION_STATUS_KEYS.map((k) => <option key={k} value={k}>{ROTATION_STATUS_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Site</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.site} onChange={(e) => setFilter('site', e.target.value)}>
              <option value="">All sites</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">{filtered.length} of {summary.assetsAnalyzed} assets</span>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_ROTATION_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      </div>

      <section aria-labelledby="rotation-assets-heading" className="space-y-2">
        <h2 id="rotation-assets-heading" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Truck size={15} aria-hidden="true" /> Analysed assets</h2>
        <p className="text-xs text-[var(--text-muted)]">Select an asset to see its narrative, compliance issues, swaps and fitted tyres.</p>
        <EnterpriseTable
          columns={assetColumns}
          data={filtered}
          getRowId={(a) => String(a.asset_no)}
          loading={loading}
          enableGlobalFilter={false}
          enableExport={false}
          initialPageSize={25}
          viewKey="rotation-assets"
          onRowClick={(a) => setOpenAsset(a)}
          emptyMessage={
            failed ? 'Tyre records are unavailable.'
              : enriched.length === 0 ? 'No assets to analyse. Rotation analysis needs at least two fitted tyres with tread readings on a vehicle.'
                : 'No assets match these filters.'
          }
        />
      </section>

      <section aria-labelledby="rotation-swaps-heading" className="space-y-2">
        <h2 id="rotation-swaps-heading" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><ArrowRightLeft size={15} aria-hidden="true" /> Swap work list</h2>
        <p className="text-xs text-[var(--text-muted)]">Every recommended swap in this view, highest impact first. Swaps never cross tyre sizes.</p>
        <EnterpriseTable
          columns={swapColumns}
          data={swaps}
          getRowId={(s) => s.id}
          loading={loading}
          enableGlobalFilter={false}
          enableExport={false}
          initialPageSize={25}
          viewKey="rotation-swaps"
          onRowClick={(s) => setOpenAsset(filtered.find((a) => a.asset_no === s.asset_no) || null)}
          emptyMessage={failed ? 'Tyre records are unavailable.' : 'No swaps recommended in this view. Wear is balanced.'}
        />
      </section>

      <Modal
        open={Boolean(openAsset)}
        onClose={() => setOpenAsset(null)}
        title={openAsset ? `Asset ${openAsset.asset_no}` : ''}
        subtitle={openAsset ? `${openAsset.site || 'Unassigned site'}. ${openAsset.stats.count} tyres with readings. Wear balance ${openAsset.wearBalanceScore == null ? 'N/A' : `${openAsset.wearBalanceScore}/100`}.` : ''}
        size="xl"
        headerExtra={openAsset ? <StatusBadge status={openAsset.overallStatus} /> : null}
      >
        {openAsset && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-sm bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2.5">
              {openAsset.overallStatus === 'good'
                ? <CheckCircle2 size={15} className="text-green-400 mt-0.5 shrink-0" aria-hidden="true" />
                : <Info size={15} className="text-[var(--brand-bright)] mt-0.5 shrink-0" aria-hidden="true" />}
              <span className="text-[var(--text-secondary)]">{openAsset.narrative}</span>
            </div>

            {openAsset.violations.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-red-300 flex items-center gap-1.5"><ShieldAlert size={13} aria-hidden="true" /> Compliance and safety ({openAsset.violations.length})</h3>
                {openAsset.violations.map((v, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      {v.message}
                      {v.heuristic && <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40">heuristic</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {openAsset.swaps.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5"><ArrowRightLeft size={13} aria-hidden="true" /> Recommended swaps ({openAsset.swaps.length})</h3>
                {openAsset.swaps.map((s, i) => (
                  <div key={i} className="border border-[var(--input-border)] rounded-lg px-3 py-2.5 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-[var(--text-primary)] bg-[var(--input-bg)] px-1.5 py-0.5 rounded">{s.tyre || 'unknown'}</span>
                    <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                      <span>{s.from_position || 'unknown position'}</span>
                      <span className={`font-semibold ${treadTone(s.from_tread_mm)}`}>{s.from_tread_mm}mm</span>
                      <ArrowRight size={14} className="text-[var(--brand-bright)]" aria-label="to" />
                      <span>{s.to_position || 'unknown position'}</span>
                      <span className={`font-semibold ${treadTone(s.to_tread_mm)}`}>{s.to_tread_mm}mm</span>
                    </span>
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-300 border border-green-500/40">+{s.tread_delta_mm}mm, about {Number(s.expected_benefit_km).toLocaleString()} km</span>
                      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/40" title="Impact score (0 to 100)"><Zap size={11} aria-hidden="true" /> {s.impact_score}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : openAsset.overallStatus !== 'critical' && (
              <div className="flex items-center gap-2 text-sm text-green-300">
                <CheckCircle2 size={15} aria-hidden="true" /> {openAsset.reason || 'Wear is balanced. No rotation required.'}
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5"><Info size={13} aria-hidden="true" /> Fitted tyres ({openAsset.tyres.length})</h3>
              <EnterpriseTable
                columns={tyreColumns(openAsset.stats)}
                data={openAsset.tyres}
                getRowId={(t) => String(t.id)}
                initialPageSize={25}
                exportFileName={reportFileName('TyrePulse Fitted Tyres', String(openAsset.asset_no))}
                searchPlaceholder="Search fitted tyres"
                emptyMessage="No fitted tyres recorded."
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
