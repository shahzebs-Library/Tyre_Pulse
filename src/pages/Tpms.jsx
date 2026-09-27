/**
 * Tpms (route /tpms) - tyre pressure monitoring and inflation compliance.
 *
 * Reads live sensor rows (tpms_readings) and falls back to the tyre-record
 * pressure baseline (tyre_records.pressure_reading) when no sensor data exists.
 * Tabs: Overview (KPI strip, under-inflation insight, charts), Alerts (every
 * out-of-band reading, sortable), Sites and positions, All readings.
 *
 * Pressure maths: src/lib/tpms.js + src/lib/tpmsAnalytics.js. Page-side
 * normalisation / filtering / exports: src/lib/tpmsPageAnalytics.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import {
  Gauge, AlertTriangle, TrendingDown, TrendingUp, Activity,
  FileSpreadsheet, X, Search, BarChart3, CheckCircle, Radio, Building2, Info,
  LineChart, Percent, Layers, FileText, ShieldAlert, List, AlertCircle, CheckCircle2, HelpCircle, ArrowUp,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { tpms as tpmsApi } from '../lib/api'
import {
  computeKpis, bandDistribution, worstOffenders, complianceTrend,
  siteCompliance, positionBreakdown, underInflationInsights,
} from '../lib/tpmsAnalytics'
import {
  normalizeReading, deviationPct, deviationLabel, filterReadings, distinctValues,
  honestCompliance, complianceTone, targetCoverage, tpmsExportRows, TPMS_EXPORT_COLUMNS,
  BAND_LABEL, DEFAULT_TARGET_PRESSURE, DEFAULT_TOLERANCE_PCT,
} from '../lib/tpmsPageAnalytics'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
)

const loadExportUtils = () => import('../lib/exportUtils')

// Semantic band colours (meaning-carrying, deliberately not palettised).
const BAND_META = {
  optimal:  { color: '#22c55e', text: 'text-green-400',  chip: 'bg-green-500/15 text-green-400 border border-green-500/40', icon: CheckCircle2 },
  under:    { color: '#f97316', text: 'text-orange-400', chip: 'bg-orange-500/15 text-orange-400 border border-orange-500/40', icon: TrendingDown },
  over:     { color: '#eab308', text: 'text-amber-400',  chip: 'bg-amber-500/15 text-amber-400 border border-amber-500/40', icon: ArrowUp },
  critical: { color: '#ef4444', text: 'text-red-400',    chip: 'bg-red-500/15 text-red-400 border border-red-500/40', icon: AlertCircle },
  unknown:  { color: '#6b7280', text: 'text-[var(--text-muted)]', chip: 'bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]', icon: HelpCircle },
}
const BAND_RANK = { critical: 0, under: 1, over: 2, optimal: 3, unknown: 4 }
const TONE_TEXT = { good: 'text-green-400', warn: 'text-amber-400', crit: 'text-red-400', neutral: 'text-[var(--text-muted)]' }

function BandChip({ band }) {
  const m = BAND_META[band] ?? BAND_META.unknown
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${m.chip}`}>
      <Icon size={11} aria-hidden="true" /> {BAND_LABEL[band] || band}
    </span>
  )
}

const chartTooltip = {
  backgroundColor: 'var(--panel)', titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)',
  borderColor: 'var(--hairline)', borderWidth: 1,
}
const axisGrid = { color: 'var(--panel-2)' }
const axisTick = { color: 'var(--text-muted)', font: { size: 10 } }
const legendLabels = { color: 'var(--text-muted)', font: { size: 11 }, boxWidth: 12 }

const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'alerts', label: 'Alerts', icon: AlertTriangle },
  { key: 'breakdown', label: 'Sites and positions', icon: Layers },
  { key: 'readings', label: 'All readings', icon: List },
]

function EmptyChart({ children }) {
  return <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm text-center px-4">{children}</div>
}

export default function Tpms() {
  const { activeCountry, appSettings } = useSettings()
  const company = appSettings?.company_name || 'TyrePulse'

  const [readings, setReadings] = useState(null)
  const [dataSource, setDataSource] = useState('baseline')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exportError, setExportError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [tab, setTab] = useState('overview')

  const [bandFilter, setBandFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sensor = await tpmsApi.listTpmsReadings({ country: activeCountry })
      if (Array.isArray(sensor) && sensor.length > 0) {
        setReadings(sensor.map((r) => normalizeReading(r, 'sensor')))
        setDataSource('sensor')
      } else {
        const baseline = await tpmsApi.listTyrePressureBaseline({ country: activeCountry })
        setReadings((baseline || []).map((r) => normalizeReading(r, 'baseline')))
        setDataSource('baseline')
      }
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load TPMS data'))
      setReadings(null)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const all = useMemo(() => readings || [], [readings])
  const sites = useMemo(() => distinctValues(all, 'site'), [all])
  const positions = useMemo(() => distinctValues(all, 'position'), [all])

  const filtered = useMemo(
    () => filterReadings(all, { band: bandFilter, site: siteFilter, position: positionFilter, search }),
    [all, bandFilter, siteFilter, positionFilter, search],
  )

  const kpis = useMemo(() => computeKpis(filtered), [filtered])
  const compliance = honestCompliance(kpis)
  const dist = useMemo(() => bandDistribution(filtered), [filtered])
  const trend = useMemo(() => complianceTrend(filtered, { months: 12 }), [filtered])
  const sitesRank = useMemo(() => siteCompliance(filtered), [filtered])
  const positionRank = useMemo(() => positionBreakdown(filtered), [filtered])
  const offenders = useMemo(() => worstOffenders(filtered, { limit: 0 }), [filtered])
  const insights = useMemo(() => underInflationInsights(filtered), [filtered])
  const ownTargetPct = useMemo(() => targetCoverage(filtered), [filtered])

  const doughnutData = useMemo(() => ({
    labels: dist.map((d) => d.label),
    datasets: [{
      data: dist.map((d) => d.count),
      backgroundColor: dist.map((d) => BAND_META[d.band]?.color ?? BAND_META.unknown.color),
      borderColor: 'transparent',
      borderWidth: 2,
    }],
  }), [dist])

  const siteBarData = useMemo(() => {
    const rows = sitesRank.slice(0, 12)
    return {
      labels: rows.map((r) => r.site),
      datasets: ['optimal', 'under', 'over', 'critical'].map((b) => ({
        label: BAND_LABEL[b], data: rows.map((r) => r[b]), backgroundColor: BAND_META[b].color, stack: 's',
      })),
    }
  }, [sitesRank])

  const trendData = useMemo(() => ({
    labels: trend.map((m) => m.label),
    datasets: [
      {
        type: 'line', label: 'Compliance %', data: trend.map((m) => ((m.optimal + m.under + m.over + m.critical) > 0 ? m.compliancePct : null)),
        borderColor: BAND_META.optimal.color, backgroundColor: 'rgba(34,197,94,0.15)', fill: true, tension: 0.35, yAxisID: 'y', pointRadius: 3, spanGaps: false,
      },
      {
        type: 'bar', label: 'Under + Critical', data: trend.map((m) => m.under + m.critical),
        backgroundColor: BAND_META.under.color, yAxisID: 'y1', barPercentage: 0.6,
      },
    ],
  }), [trend])

  const exportMeta = useMemo(() => ({
    'Data source': dataSource === 'sensor' ? 'Live sensor (tpms_readings)' : 'Tyre-record baseline',
    'Compliance %': compliance == null ? 'N/A' : `${compliance}%`,
    'Under-inflated': kpis.underInflated,
    'Over-inflated': kpis.overInflated,
    Critical: kpis.critical,
    'Target (bar)': DEFAULT_TARGET_PRESSURE.toFixed(1),
    'Tolerance %': DEFAULT_TOLERANCE_PCT,
  }), [dataSource, compliance, kpis])

  const runExport = useCallback(async (format) => {
    setExporting(true); setExportError(null)
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await loadExportUtils()
      const rows = tpmsExportRows(filtered)
      const file = reportFileName('TPMS Pressure Compliance')
      if (format === 'pdf') {
        await exportToPdf(rows, TPMS_EXPORT_COLUMNS, 'TPMS Pressure Compliance', file, 'landscape', company, {
          emptyHint: 'No pressure readings for the selected filters. Adjust the filters and export again.',
          meta: exportMeta,
        })
      } else {
        await exportToExcel(rows, TPMS_EXPORT_COLUMNS.map((c) => c.key), TPMS_EXPORT_COLUMNS.map((c) => c.header), file, 'TPMS Readings', {
          title: 'TPMS Pressure Compliance', company, meta: exportMeta,
        })
      }
    } catch (e) {
      setExportError(toUserMessage(e, 'Export failed'))
    } finally {
      setExporting(false)
    }
  }, [filtered, company, exportMeta])

  const clearFilters = () => { setBandFilter(''); setSiteFilter(''); setPositionFilter(''); setSearch('') }
  const hasFilter = bandFilter || siteFilter || positionFilter || search

  // Shared column set for the alert and reading tables.
  const readingColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || undefined, sortUndefined: 'last', size: 110,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'position', header: 'Position', accessorFn: (r) => r.position || undefined, sortUndefined: 'last', size: 90 },
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial || undefined, sortUndefined: 'last', size: 130,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-secondary)]">{row.original.serial || 'N/A'}</span> },
    { id: 'pressure', header: 'Pressure', accessorFn: (r) => r.pressure ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 100,
      cell: ({ row }) => <span className={`font-semibold ${BAND_META[row.original.band]?.text ?? ''}`}>{row.original.pressure != null ? `${row.original.pressure.toFixed(1)} bar` : 'N/A'}</span> },
    { id: 'target', header: 'Target', accessorFn: (r) => r.target, meta: { align: 'right' }, size: 90,
      cell: ({ row }) => `${row.original.target.toFixed(1)} bar` },
    { id: 'deviation', header: 'Deviation', accessorFn: (r) => { const d = deviationPct(r); return d == null ? undefined : Math.abs(d) }, sortUndefined: 'last', meta: { align: 'right', exportValue: (r) => deviationLabel(r) }, size: 100,
      cell: ({ row }) => <span className={BAND_META[row.original.band]?.text}>{deviationLabel(row.original)}</span> },
    { id: 'temperature', header: 'Temp', accessorFn: (r) => r.temperature ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 80,
      cell: ({ row }) => (row.original.temperature != null ? `${row.original.temperature.toFixed(0)} C` : 'N/A') },
    { id: 'band', header: 'Status', accessorFn: (r) => BAND_RANK[r.band] ?? 9, meta: { exportValue: (r) => BAND_LABEL[r.band] }, size: 140,
      cell: ({ row }) => <BandChip band={row.original.band} /> },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || undefined, sortUndefined: 'last', size: 110 },
    { id: 'recorded', header: 'Recorded', accessorFn: (r) => (r.date ? String(r.date).slice(0, 10) : undefined), sortUndefined: 'last', size: 110 },
  ], [])

  const groupColumns = useCallback((keyName, label) => [
    { id: keyName, header: label, accessorFn: (r) => r[keyName], size: 150,
      cell: ({ row }) => <span className="text-[var(--text-primary)]">{row.original[keyName]}</span> },
    { id: 'total', header: 'Readings', accessorFn: (r) => r.total, meta: { align: 'right' }, size: 90 },
    { id: 'under', header: 'Under', accessorFn: (r) => r.under, meta: { align: 'right' }, size: 80 },
    { id: 'over', header: 'Over', accessorFn: (r) => r.over, meta: { align: 'right' }, size: 80 },
    { id: 'critical', header: 'Critical', accessorFn: (r) => r.critical, meta: { align: 'right' }, size: 80 },
    { id: 'alerts', header: 'Alerts', accessorFn: (r) => r.alerts, meta: { align: 'right' }, size: 80 },
    { id: 'compliance', header: 'Compliance', accessorFn: (r) => ((r.optimal + r.alerts) > 0 ? r.compliancePct : undefined), sortUndefined: 'last', meta: { align: 'right' }, size: 110,
      cell: ({ row }) => {
        const assessed = row.original.optimal + row.original.alerts
        if (!(assessed > 0)) return <span className="text-[var(--text-muted)]">N/A</span>
        const tone = complianceTone(row.original.compliancePct)
        return <span className={`font-semibold ${TONE_TEXT[tone]}`}>{row.original.compliancePct.toFixed(0)}%</span>
      } },
  ], [])
  const siteColumns = useMemo(() => groupColumns('site', 'Site'), [groupColumns])
  const positionColumns = useMemo(() => groupColumns('position', 'Position'), [groupColumns])

  const unknown = readings === null
  const tileTone = (n, bad) => (n > 0 ? bad : 'neutral')

  return (
    <div className="space-y-5">
      <PageHeader
        title="TPMS: Tyre Pressure Monitoring"
        subtitle={`Pressure compliance with under and over-inflation alerts${kpis.total > 0 ? ` | ${kpis.total.toLocaleString()} readings` : ''}`}
        icon={Radio}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => runExport('excel')} disabled={filtered.length === 0 || exporting} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px] disabled:opacity-40">
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => runExport('pdf')} disabled={filtered.length === 0 || exporting} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px] disabled:opacity-40">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        }
      />

      {!unknown && (
        <Card tone={dataSource === 'sensor' ? 'info' : undefined} className="items-start gap-2" style={{ flexDirection: 'row' }}>
          <Info size={14} className="shrink-0 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
          <p className="text-xs text-[var(--text-secondary)]">
            {dataSource === 'sensor'
              ? <>Live source: <strong className="text-[var(--text-primary)]">TPMS sensor readings</strong> (tpms_readings).</>
              : <>No live sensor readings yet. Showing the <strong className="text-[var(--text-primary)]">tyre-record pressure baseline</strong> (tyre_records.pressure_reading). Ingest sensor data to enable live monitoring.</>}
            {' '}Bands use each reading's own target where recorded, else the {DEFAULT_TARGET_PRESSURE.toFixed(1)} bar fleet default, with a {DEFAULT_TOLERANCE_PCT}% tolerance.
            {ownTargetPct != null && ` ${ownTargetPct}% of readings in view carry their own target.`}
          </p>
        </Card>
      )}

      {error && (
        <Card tone="crit" className="items-center justify-between gap-3" style={{ flexDirection: 'row' }} role="alert">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle size={16} className="text-red-400 shrink-0" aria-hidden="true" />
            <p className="text-sm text-red-300 break-words">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm shrink-0 min-h-[40px]">Retry</button>
        </Card>
      )}
      {exportError && (
        <Card tone="crit" className="items-center justify-between gap-3" style={{ flexDirection: 'row' }} role="alert">
          <p className="text-sm text-red-300 break-words">{exportError}</p>
          <button type="button" onClick={() => setExportError(null)} className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded text-[var(--text-muted)]" aria-label="Dismiss message"><X size={15} /></button>
        </Card>
      )}

      {/* Filters apply to every tab. */}
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_auto_auto_auto_auto] items-center gap-2">
          <div className="relative">
            <label htmlFor="tpms-search" className="sr-only">Search readings</label>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="tpms-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, serial, position, site" className="input pl-9 w-full min-h-[40px]" />
          </div>
          <select className="input min-h-[40px]" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {['optimal', 'under', 'over', 'critical', 'unknown'].map((b) => <option key={b} value={b}>{BAND_LABEL[b]}</option>)}
          </select>
          <select className="input min-h-[40px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Filter by site">
            <option value="">All sites</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input min-h-[40px]" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} aria-label="Filter by position">
            <option value="">All positions</option>
            {positions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex items-center gap-2 justify-between sm:justify-end">
            {hasFilter && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><X size={14} aria-hidden="true" /> Clear</button>}
            <span className="text-xs text-[var(--text-muted)] whitespace-nowrap" aria-live="polite">{unknown ? 'N/A' : `${filtered.length} of ${all.length}`}</span>
          </div>
        </div>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Readings" value={unknown ? 'N/A' : kpis.total.toLocaleString()} icon={Activity} tone="info" sub={unknown ? undefined : `${kpis.assessed.toLocaleString()} assessed`} />
        <StatTile label="Compliance" value={compliance == null ? 'N/A' : `${compliance.toFixed(1)}%`} icon={Percent} tone={complianceTone(compliance) === 'good' ? 'accent' : complianceTone(compliance)} sub="Within target band" />
        <StatTile label="Under-inflated" value={unknown ? 'N/A' : kpis.underInflated.toLocaleString()} icon={TrendingDown} tone={tileTone(kpis.underInflated, 'warn')} sub={kpis.assessed > 0 ? `${kpis.underInflatedPct.toFixed(0)}% of assessed` : 'N/A of assessed'} />
        <StatTile label="Over-inflated" value={unknown ? 'N/A' : kpis.overInflated.toLocaleString()} icon={TrendingUp} tone={tileTone(kpis.overInflated, 'warn')} sub="Above target band" />
        <StatTile label="Critical" value={unknown ? 'N/A' : kpis.critical.toLocaleString()} icon={AlertTriangle} tone={tileTone(kpis.critical, 'crit')} sub="Severe under-inflation" />
        <StatTile label="Avg pressure" value={kpis.avgPressure != null ? kpis.avgPressure.toFixed(1) : 'N/A'} unit={kpis.avgPressure != null ? 'bar' : undefined} icon={Gauge} sub={kpis.avgTarget != null ? `Avg target ${kpis.avgTarget.toFixed(1)} bar` : undefined} />
      </div>

      <div role="tablist" aria-label="TPMS views" className="flex flex-wrap items-center gap-1 border-b border-[var(--input-border)]">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          const count = t.key === 'alerts' ? offenders.length : t.key === 'readings' ? filtered.length : null
          return (
            <button key={t.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-t ${active ? 'border-brand-bright text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={15} aria-hidden="true" /> {t.label}
              {count != null && !unknown && <span className="text-[11px] px-1.5 rounded-full bg-[var(--input-bg)] text-[var(--text-secondary)]">{count}</span>}
            </button>
          )
        })}
      </div>

      {loading && unknown ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading TPMS data">
          <Card><div className="h-64 bg-[var(--input-bg)] rounded animate-pulse" /></Card>
          <Card><div className="h-64 bg-[var(--input-bg)] rounded animate-pulse" /></Card>
        </div>
      ) : unknown ? (
        <Card className="text-center text-sm text-[var(--text-muted)]"><div style={{ paddingBlock: 'var(--space-8)' }}>TPMS data could not be loaded. Use Retry above.</div></Card>
      ) : tab === 'overview' ? (
        kpis.total === 0 ? (
          <Card className="items-center text-center gap-3" style={{ paddingBlock: '4rem' }}>
            <Gauge size={36} className="text-[var(--text-dim)]" aria-hidden="true" />
            <p className="text-[var(--text-muted)] text-sm">{all.length === 0 ? 'No pressure readings recorded yet.' : 'No pressure readings match the selected filters.'}</p>
            {hasFilter && <button type="button" onClick={clearFilters} className="btn-secondary text-sm min-h-[40px]">Clear filters</button>}
          </Card>
        ) : (
          <div className="space-y-4">
            <Card tone={insights.underInflatedCount > 0 ? 'warn' : undefined}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                  <ShieldAlert size={16} className={insights.underInflatedCount > 0 ? 'text-orange-400' : 'text-green-400'} aria-hidden="true" /> Under-inflation intelligence
                </span>
                {insights.underInflatedCount > 0 ? (
                  <>
                    <span className="text-[var(--text-secondary)]"><strong className="text-orange-400">{insights.underInflatedCount}</strong> under-inflated ({insights.underInflatedPct.toFixed(0)}% of assessed), {insights.criticalCount} critical</span>
                    {insights.avgUnderDeviationPct != null && <span className="text-[var(--text-muted)]">Avg shortfall <strong className="text-orange-400">{insights.avgUnderDeviationPct.toFixed(0)}%</strong> below target</span>}
                    <span className="text-[var(--text-muted)]">{insights.sitesAffected} site{insights.sitesAffected === 1 ? '' : 's'} affected</span>
                    {insights.worstSite && <span className="text-[var(--text-muted)]">Worst site: <strong className="text-orange-400">{insights.worstSite.site}</strong> ({insights.worstSite.underInflated})</span>}
                    <span className="text-[var(--text-muted)] basis-full">Under-inflation raises rolling resistance, fuel burn and blow-out risk. Address critical readings first.</span>
                    <button type="button" onClick={() => setTab('alerts')} className="btn-secondary text-sm min-h-[40px]">Review alerts</button>
                  </>
                ) : (
                  <span className="text-[var(--text-secondary)]">No under-inflated readings in the current view. Every assessed tyre is at or above the target band.</span>
                )}
              </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader title="Pressure band split" icon={BarChart3} actions={<span className="text-xs text-[var(--text-muted)]">{kpis.total} readings</span>} />
                <div className="h-64" role="img" aria-label={`Band split: ${dist.map((d) => `${d.label} ${d.count}`).join(', ')}`}>
                  <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: legendLabels }, tooltip: chartTooltip } }} />
                </div>
              </Card>
              <Card>
                <CardHeader title="Compliance trend" icon={LineChart} actions={<span className="text-xs text-[var(--text-muted)]">{trend.length ? `Last ${trend.length} month${trend.length === 1 ? '' : 's'}` : 'No dated readings'}</span>} />
                {trend.length === 0 ? <EmptyChart>No dated readings to trend.</EmptyChart> : (
                  <div className="h-64">
                    <Line data={trendData} options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { labels: legendLabels }, tooltip: chartTooltip },
                      scales: {
                        x: { grid: axisGrid, ticks: axisTick },
                        y: { position: 'left', min: 0, max: 100, grid: axisGrid, ticks: { ...axisTick, callback: (v) => `${v}%` }, title: { display: true, text: 'Compliance %', color: 'var(--text-muted)', font: { size: 10 } } },
                        y1: { position: 'right', min: 0, grid: { drawOnChartArea: false }, ticks: axisTick, title: { display: true, text: 'Under + Critical', color: 'var(--text-muted)', font: { size: 10 } } },
                      },
                    }} />
                  </div>
                )}
              </Card>
            </div>

            <Card>
              <CardHeader title="Readings by site" icon={Building2} actions={<span className="text-xs text-[var(--text-muted)]">Top {Math.min(12, sitesRank.length)} sites, worst first</span>} />
              {sitesRank.length === 0 ? <EmptyChart>No site data.</EmptyChart> : (
                <div className="h-72">
                  <Bar data={siteBarData} options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: legendLabels }, tooltip: chartTooltip },
                    scales: { x: { stacked: true, grid: axisGrid, ticks: axisTick }, y: { stacked: true, grid: axisGrid, ticks: axisTick } },
                  }} />
                </div>
              )}
            </Card>
          </div>
        )
      ) : tab === 'alerts' ? (
        <Card>
          <CardHeader title="Inflation alerts" icon={AlertTriangle} description="Every under, over and critical reading. Worst first; click a header to re-sort." />
          <EnterpriseTable
            columns={readingColumns}
            data={offenders}
            getRowId={(r, i) => String(r.id ?? i)}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            exportFileName="tpms_inflation_alerts"
            reportMeta={{ title: 'TPMS Inflation Alerts', company }}
            viewKey="tpms-alerts"
            initialPageSize={25}
            emptyIcon={<CheckCircle size={26} className="text-green-500" aria-hidden="true" />}
            emptyMessage="No inflation alerts. All assessed readings are within the target band."
          />
        </Card>
      ) : tab === 'breakdown' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Compliance by site" icon={Building2} description="Most alerts first." />
            <EnterpriseTable
              columns={siteColumns}
              data={sitesRank}
              getRowId={(r) => String(r.site)}
              enableColumnFilters={false}
              searchPlaceholder="Search sites"
              exportFileName="tpms_site_compliance"
              reportMeta={{ title: 'TPMS Compliance by Site', company }}
              initialPageSize={25}
              onRowClick={(r) => { if (r.site && r.site !== 'Unspecified') { setSiteFilter(r.site); setTab('alerts') } }}
              emptyMessage="No site data for the current filters."
            />
          </Card>
          <Card>
            <CardHeader title="Compliance by position" icon={Layers} description="Steer positions under-inflated are the highest safety concern." />
            <EnterpriseTable
              columns={positionColumns}
              data={positionRank}
              getRowId={(r) => String(r.position)}
              enableColumnFilters={false}
              searchPlaceholder="Search positions"
              exportFileName="tpms_position_compliance"
              reportMeta={{ title: 'TPMS Compliance by Position', company }}
              initialPageSize={25}
              emptyMessage="No position data for the current filters."
            />
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader title="All readings" icon={List} description="Every reading in the current filter, including optimal and not-assessed rows." />
          <EnterpriseTable
            columns={readingColumns}
            data={filtered}
            getRowId={(r, i) => String(r.id ?? i)}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            exportFileName="tpms_readings"
            reportMeta={{ title: 'TPMS Readings', company }}
            viewKey="tpms-readings"
            virtual={filtered.length > 500}
            initialPageSize={50}
            emptyMessage={all.length === 0 ? 'No pressure readings recorded yet.' : 'No readings match the selected filters.'}
          />
        </Card>
      )}
    </div>
  )
}
