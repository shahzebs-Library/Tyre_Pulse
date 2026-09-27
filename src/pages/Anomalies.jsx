import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AlertTriangle, Activity, ChevronDown, ShieldAlert, ShieldQuestion,
  Zap, Clock, Layers, Repeat, DollarSign, Copy, Fingerprint,
  Search, X, Wrench, CalendarClock, TrendingUp, Download, FileText, MapPin, Car, RefreshCw,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import DateField from '../components/ui/DateField'
import { formatCurrencyCompact } from '../lib/formatters'
import { currencyForCountry } from '../lib/governedCost'
import { cn } from '../lib/cn'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import {
  detectAnomalies,
  detectVisitFrequency,
  computeVisitStats,
  ANOMALY_TYPES,
  ANOMALY_SEVERITY,
  ANOMALY_TYPE_DESC,
} from '../lib/anomalyEngine'
import {
  DATA_QUALITY, TYPE_ORDER, TYPE_LABELS as LABELS, SEVERITIES, detectDataQuality, filterAnomalies,
  groupAnomalies, siteOptions, anomalyKpis, visitSummary as buildVisitSummary, filterVisits,
  anomalyExportRows, ANOMALY_EXPORT_COLUMNS, visitExportRows, VISIT_EXPORT_COLUMNS,
} from '../lib/anomaliesAnalytics'

const loadExportUtils = () => import('../lib/exportUtils')

// Ceilings on the two paged scans. Both sit above the live table sizes
// (tyre_records ~11,132; work_orders ~89,913 is bounded by the date window the
// page applies server-side). If either is hit the page SAYS the scan is
// partial rather than presenting a partial sweep as a clean bill of health.
const TYRE_SCAN_CAP = 40000
const WORK_ORDER_SCAN_CAP = 40000

// Per-type presentation metadata (icon + accent) for the rich engine types + DQ.
// Clean semantic accents - red = serious repeat/identity issues, amber = cost or
// cadence patterns worth a look, gray = data quality. No decorative rainbow:
// the color IS the meaning (green stays reserved for "good" app-wide).
const TYPE_META = {
  [ANOMALY_TYPES.RAPID_RECURRENCE]: { icon: Repeat,       accent: 'text-red-400' },
  [ANOMALY_TYPES.SERIAL_REUSE]:     { icon: Fingerprint,  accent: 'text-red-400' },
  [ANOMALY_TYPES.DUPLICATE_ENTRY]:  { icon: Copy,         accent: 'text-red-400' },
  [ANOMALY_TYPES.FREQUENT_VISITS]:  { icon: Wrench,       accent: 'text-amber-400' },
  [ANOMALY_TYPES.SHORT_INTERVAL]:   { icon: Clock,        accent: 'text-amber-400' },
  [ANOMALY_TYPES.SAME_DAY_BURST]:   { icon: Layers,       accent: 'text-amber-400' },
  [ANOMALY_TYPES.COST_SPIKE]:       { icon: DollarSign,   accent: 'text-amber-400' },
  [DATA_QUALITY]:                   { icon: ShieldQuestion, accent: 'text-[var(--text-secondary)]' },
}

const DESCS = { ...ANOMALY_TYPE_DESC, [DATA_QUALITY]: 'Records missing cost, issue date or asset number needed for analytics' }

const SEVERITY_BADGE = {
  [ANOMALY_SEVERITY.HIGH]:   'bg-red-900/40 text-red-400 border border-red-500/30',
  [ANOMALY_SEVERITY.MEDIUM]: 'bg-amber-900/40 text-amber-400 border border-amber-500/30',
  [ANOMALY_SEVERITY.LOW]:    'bg-sky-900/40 text-sky-400 border border-sky-500/30',
}

export default function Anomalies() {
  const { profile } = useAuth()
  const { activeCountry, activeCurrency } = useSettings()
  const [anomalies, setAnomalies] = useState([])
  const [visitStats, setVisitStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [partialScan, setPartialScan] = useState(false)
  const [sourceWarning, setSourceWarning] = useState('')
  const [activeType, setActiveType] = useState('ALL')
  const [view, setView] = useState('anomalies') // 'anomalies' | 'visits'
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  // Optional date range - blank = all time. Applied server-side so detection
  // runs over exactly the chosen window.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Changing the date range refetches without waiting for the load already in
  // flight. If the earlier one finishes last it lists the PREVIOUS window's
  // anomalies under the new dates, which reads as a real finding rather than a
  // stale one.
  const latestLoad = useLatestRequest()

  const load = useCallback(async () => {
    const stale = latestLoad.begin()
    setLoading(true); setError(null); setSourceWarning(''); setAnomalies([]); setVisitStats([]); setPartialScan(false)
    try {
      // PAGED. The old `.limit(5000)` returned 1000 rows - the server caps
      // every response at 1000 whatever a limit says - so detection ran over
      // 9% of tyre_records (KSA alone is past 8,000) and reported as complete.
      // `id` is the paging tiebreak; issue_date is very much not unique.
      const buildTyres = (from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id, issue_date, brand, serial_no, asset_no, site, category, risk_level, cost_per_tyre, qty, country')
          .order('issue_date', { ascending: false, nullsFirst: false })
          .order('id')
          .range(from, to)
        if (activeCountry !== 'All' && activeCountry) q = q.eq('country', activeCountry)
        if (fromDate) q = q.gte('issue_date', fromDate)
        if (toDate) q = q.lte('issue_date', toDate)
        return q
      }
      const { data, error: err, truncated: tyreTruncated } = await fetchAllPages(buildTyres, { max: TYRE_SCAN_CAP })
      if (err) throw err
      const rows = data || []

      // Workshop visits are unioned from tyre-change events + work_orders (when
      // present). The work_orders read is best-effort so an empty/blocked table
      // never breaks the page.
      let workOrders = []
      let partial = !!tyreTruncated
      try {
        const buildWo = (from, to) => {
          let wq = supabase
            .from('work_orders')
            .select('id, asset_no, tyre_serial, work_type, site, country, opened_at, total_cost')
            .not('opened_at', 'is', null)
            .order('opened_at', { ascending: false })
            .order('id')
            .range(from, to)
          if (activeCountry !== 'All' && activeCountry) wq = wq.eq('country', activeCountry)
          if (fromDate) wq = wq.gte('opened_at', fromDate)
          if (toDate) wq = wq.lte('opened_at', `${toDate}T23:59:59`)
          return wq
        }
        const { data: wo, error: woError, truncated: woTruncated } = await fetchAllPages(buildWo, { max: WORK_ORDER_SCAN_CAP })
        if (woError) throw woError
        workOrders = wo || []
        partial = partial || !!woTruncated
      } catch { if (!stale()) setSourceWarning('Workshop records could not be loaded. Visit counts and anomaly results are incomplete; retry the scan.') }

      const engine = detectAnomalies(rows)
      const dq = detectDataQuality(rows)
      const freq = detectVisitFrequency(rows, { workOrders })
      if (stale()) return
      setAnomalies([...freq, ...engine, ...dq])
      setVisitStats(computeVisitStats(rows, { workOrders }))
      setPartialScan(partial)
    } catch (e) {
      // A superseded load must not raise a banner over data that loaded fine.
      if (!stale()) setError(toUserMessage(e, 'Failed to load anomalies'))
    } finally {
      // Clearing this from a stale load would make the newer one look finished.
      if (!stale()) setLoading(false)
    }
  }, [activeCountry, fromDate, toDate, latestLoad])

  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()

  // ── Severity KPIs (engine + DQ combined) ─────────────────────────────────
  const summary = useMemo(() => anomalyKpis(anomalies), [anomalies])
  const typeCounts = summary.byType

  // ── Filtered set for the active chip, severity, site and search ──────────
  const filtered = useMemo(
    () => filterAnomalies(anomalies, { type: activeType, severity: severityFilter, site: siteFilter, search }),
    [anomalies, activeType, severityFilter, siteFilter, search],
  )
  const groups = useMemo(() => groupAnomalies(filtered, DESCS), [filtered])
  const sites = useMemo(() => siteOptions(anomalies), [anomalies])

  // Chips: All + only types actually present, in stable order.
  const chips = useMemo(() => {
    const present = TYPE_ORDER.filter(t => typeCounts[t] > 0)
    return [{ type: 'ALL', label: 'All', desc: 'All detected anomalies', count: summary.total }, ...present.map(t => ({
      type: t, label: LABELS[t], desc: DESCS[t], count: typeCounts[t] || 0,
    }))]
  }, [typeCounts, summary.total])

  // ── Workshop-visit analytics ─────────────────────────────────────────────
  const visitSites = useMemo(() => [...new Set(visitStats.map(v => v.site || 'N/A'))].sort(), [visitStats])
  const visitFiltered = useMemo(() => filterVisits(visitStats, { search, site: siteFilter }), [visitStats, search, siteFilter])
  const visitSummary = useMemo(() => buildVisitSummary(visitStats), [visitStats])
  const filtersActive = Boolean(q) || activeType !== 'ALL' || severityFilter !== 'all' || siteFilter !== 'all'

  function clearFilters() {
    setSearch(''); setActiveType('ALL'); setSeverityFilter('all'); setSiteFilter('all')
  }

  async function doExport(kind) {
    const { exportToExcel, exportToPdf, reportFileName, reportDateLabel } = await loadExportUtils()
    const range = fromDate || toDate ? `${fromDate || 'start'} to ${toDate || 'today'}` : 'All dates'
    const scope = `${activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'} | ${range}${filtersActive ? ' | filtered' : ''}`
    if (view === 'visits') {
      const rows = visitExportRows(visitFiltered)
      const name = reportFileName('TyrePulse Workshop Visits', reportDateLabel())
      if (kind === 'excel') exportToExcel(rows, VISIT_EXPORT_COLUMNS.map(c => c.key), VISIT_EXPORT_COLUMNS.map(c => c.header), name)
      else exportToPdf(rows, VISIT_EXPORT_COLUMNS, 'Workshop Visits by Vehicle', name, 'landscape', '', { subtitleNote: scope })
      return
    }
    const rows = anomalyExportRows(filtered)
    const name = reportFileName('TyrePulse Anomalies', reportDateLabel())
    if (kind === 'excel') exportToExcel(rows, ANOMALY_EXPORT_COLUMNS.map(c => c.key), ANOMALY_EXPORT_COLUMNS.map(c => c.header), name)
    else exportToPdf(rows, ANOMALY_EXPORT_COLUMNS, 'Anomaly Intelligence', name, 'landscape', '', { subtitleNote: `${scope}${partialScan ? ' | partial scan' : ''}` })
  }
  const exportCount = view === 'visits' ? visitFiltered.length : filtered.length

  const visitColumns = useMemo(() => [
    {
      id: 'asset_no', header: 'Vehicle', accessorFn: r => r.asset_no ?? 'N/A', size: 120,
      cell: ({ getValue }) => <span className="font-mono text-blue-400">{getValue()}</span>,
    },
    { id: 'site', header: 'Site', accessorFn: r => r.site ?? 'N/A', size: 130 },
    { id: 'total', header: 'Total Visits', accessorFn: r => r.total, size: 100, meta: { align: 'right' } },
    { id: 'last7', header: 'This Week', accessorFn: r => r.last7, size: 100, meta: { align: 'right' } },
    { id: 'last30', header: 'This Month', accessorFn: r => r.last30, size: 100, meta: { align: 'right' } },
    { id: 'last90', header: 'Last 90d', accessorFn: r => r.last90, size: 90, meta: { align: 'right' } },
    {
      id: 'peak90', header: 'Peak / 90d', accessorFn: r => r.peak90, size: 100, meta: { align: 'right' },
      cell: ({ getValue }) => {
        const v = getValue()
        return <span className={cn(v >= 3 ? 'text-rose-400 font-semibold' : 'text-[var(--text-secondary)]')}>{v}</span>
      },
    },
    { id: 'country', header: 'Country', accessorFn: r => r.country || 'Not recorded', size: 100 },
    { id: 'currency', header: 'Currency', accessorFn: r => currencyForCountry(r.country) || 'Not recorded', size: 80 },
    { id: 'visits_per_month', header: 'Rate /mo', accessorFn: r => r.visits_per_month, size: 90, meta: { align: 'right' } },
    { id: 'last_visit', header: 'Last Visit', accessorFn: r => r.last_visit ?? 'N/A', size: 110 },
    {
      id: 'total_cost', header: 'Total Cost',
      accessorFn: r => r.total_cost || 0,
      cell: ({ getValue, row }) => (getValue() > 0 ? formatCurrencyCompact(getValue(), currencyForCountry(row.original.country) || activeCurrency) : 'N/A'),
      size: 110, meta: { align: 'right' },
    },
  ], [activeCurrency])

  // Drill-down columns for underlying records (shared across groups).
  const detailColumns = useMemo(() => [
    { id: 'issue_date', header: 'Date', accessorFn: r => r.issue_date ?? 'N/A', size: 110 },
    { id: 'brand', header: 'Brand', accessorFn: r => r.brand ?? 'N/A', size: 120 },
    {
      id: 'serial_no', header: 'Serial No', accessorFn: r => r.serial_no ?? 'N/A', size: 150,
      cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-secondary)]">{getValue()}</span>,
    },
    {
      id: 'asset_no', header: 'Asset No', accessorFn: r => r.asset_no ?? 'N/A', size: 120,
      cell: ({ getValue }) => <span className="font-mono text-blue-400">{getValue()}</span>,
    },
    { id: 'site', header: 'Site', accessorFn: r => r.site ?? 'N/A', size: 130 },
    {
      id: 'risk_level', header: 'Risk', accessorFn: r => r.risk_level ?? 'N/A', size: 90,
      cell: ({ getValue }) => {
        const v = getValue()
        return (
          <span className={cn(
            'px-1.5 py-0.5 rounded text-xs',
            v === 'High' || v === 'Critical' ? 'bg-red-900/40 text-red-400' :
            v === 'Medium' ? 'bg-yellow-900/40 text-yellow-400' : 'bg-green-900/40 text-green-400',
          )}>{v}</span>
        )
      },
    },
    {
      id: 'cost', header: 'Cost',
      accessorFn: r => (r.cost_per_tyre != null && r.cost_per_tyre !== '' ? Number(r.cost_per_tyre) : null),
      cell: ({ getValue, row }) => (getValue() != null ? formatCurrencyCompact(getValue(), currencyForCountry(row.original.country) || activeCurrency) : 'N/A'),
      size: 110,
      meta: {
        align: 'right',
        exportValue: r => (r.cost_per_tyre != null && r.cost_per_tyre !== '' ? Number(r.cost_per_tyre) : ''),
      },
    },
  ], [activeCurrency])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anomaly Intelligence"
        subtitle="Suspicious tyre records, cost outliers, data-quality issues and workshop-visit frequency, searchable by vehicle"
        icon={AlertTriangle}
        actions={(
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={load} disabled={loading} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Rescan
            </button>
            <button type="button" onClick={() => doExport('excel')} disabled={loading || !!error || !exportCount} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-40">
              <Download size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} disabled={loading || !!error || !exportCount} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-40">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        )}
      />

      {/* Toolbar: view toggle + vehicle search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="inline-flex rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-0.5">
          {[
            { key: 'anomalies', label: 'Anomalies', icon: AlertTriangle },
            { key: 'visits', label: 'Workshop Visits', icon: Wrench },
          ].map(t => {
            const active = view === t.key
            const Icon = t.icon
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setView(t.key)}
                aria-pressed={active}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 min-h-[40px] text-sm transition-colors',
                  active ? 'bg-[var(--input-bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                <Icon size={15} />
                <span>{t.label}</span>
              </button>
            )
          })}
        </div>
        <div className="relative flex-1 sm:max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search vehicle, serial or site…"
            aria-label="Search anomalies and vehicles"
            className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] py-2 pl-9 pr-9 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--text-dim)] focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-1 min-h-[36px] min-w-[36px] inline-flex items-center justify-center top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <select
          className="input text-sm w-auto min-h-[44px]"
          value={siteFilter}
          onChange={e => setSiteFilter(e.target.value)}
          aria-label="Filter by site"
        >
          <option value="all">All sites</option>
          {(view === 'visits' ? visitSites : sites).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {view === 'anomalies' && (
          <select
            className="input text-sm w-auto min-h-[44px]"
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value)}
            aria-label="Filter by severity"
          >
            <option value="all">All severities</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        )}
        {/* Date range - detection re-runs over the chosen window */}
        <div className="flex items-center gap-2">
          <CalendarClock size={15} className="text-[var(--text-muted)] shrink-0" />
          <DateField value={fromDate} onChange={setFromDate} placeholder="From" aria-label="Anomaly range from" />
          <span className="text-[var(--text-muted)] text-xs">to</span>
          <DateField value={toDate} onChange={setToDate} placeholder="To" aria-label="Anomaly range to" />
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setFromDate(''); setToDate('') }}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline whitespace-nowrap"
            >
              All dates
            </button>
          )}
        </div>
      </div>


      {sourceWarning && !error && <p role="alert" className="card text-amber-500">{sourceWarning}</p>}
      {partialScan && !error && (
        <div className="flex items-start gap-2 text-amber-400 text-sm bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Partial scan: the row ceiling was reached, so anomalies outside the rows read are not listed. Narrow the date range for a complete sweep.</span>
        </div>
      )}

      {error ? (
        <div role="alert" className="card py-12 flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-8 h-8 text-red-400" aria-hidden="true" />
          <p className="text-[var(--text-primary)] font-semibold">Anomaly scan unavailable</p>
          <p className="text-[var(--text-muted)] text-sm max-w-md">{error} No clean result is shown until the tyre records can be scanned.</p>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] px-3">
            <RefreshCw size={14} aria-hidden="true" /> Retry scan
          </button>
        </div>
      ) : loading ? (
        <div className="space-y-4" aria-busy="true">
          {[1, 2, 3].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="h-6 w-48 bg-[var(--input-bg)] rounded mb-3" />
              <div className="h-20 bg-[var(--input-bg)] rounded" />
            </div>
          ))}
        </div>
      ) : view === 'visits' ? (
        <WorkshopVisitsView
          summary={visitSummary}
          rows={visitFiltered}
          columns={visitColumns}
          activeCurrency={activeCurrency}
          searching={!!q}
        />
      ) : (
        <>
          {/* Severity KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <SeverityCard
              label="High Severity" value={summary.bySeverity.high} icon={ShieldAlert}
              valueClass="text-red-400" ringClass="ring-red-500/20"
              hint="Immediate review required"
            />
            <SeverityCard
              label="Medium Severity" value={summary.bySeverity.medium} icon={Zap}
              valueClass="text-amber-400" ringClass="ring-amber-500/20"
              hint="Investigate soon"
            />
            <SeverityCard
              label="Low Severity" value={summary.bySeverity.low} icon={ShieldQuestion}
              valueClass="text-sky-400" ringClass="ring-sky-500/20"
              hint="Data quality / minor"
            />
            <SeverityCard
              label="Total Anomalies" value={summary.total} icon={Activity}
              valueClass="text-[var(--text-primary)]" ringClass="ring-white/10"
              hint={`${summary.ruleFindings} rule findings, ${summary.dataQuality} data quality`}
            />
            <SeverityCard
              label="Affected Vehicles" value={summary.affectedAssets} icon={Car}
              valueClass="text-[var(--text-primary)]" ringClass="ring-white/10"
              hint={`Across ${summary.affectedSites} site${summary.affectedSites !== 1 ? 's' : ''}`}
            />
            <SeverityCard
              label="Hotspot Site" value={summary.hotSite || 'None'} icon={MapPin}
              valueClass="text-[var(--text-primary)]" ringClass="ring-white/10"
              hint={summary.hotSite ? `${summary.hotSiteHigh} high severity` : 'No high severity finding'}
            />
          </div>
          {filtersActive && (
            <p className="text-xs text-[var(--text-muted)]" role="status">
              Showing {filtered.length} of {summary.total} anomalies.{' '}
              <button type="button" onClick={clearFilters} className="underline min-h-[44px]">Clear filters</button>
            </p>
          )}

          {/* Type filter chips */}
          {anomalies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map(chip => {
                const meta = chip.type === 'ALL' ? null : TYPE_META[chip.type]
                const Icon = meta?.icon
                const active = activeType === chip.type
                return (
                  <button
                    key={chip.type}
                    type="button"
                    onClick={() => setActiveType(chip.type)}
                    title={chip.desc}
                    aria-pressed={active}
                    className={cn(
                      'group flex items-center gap-2 rounded-lg px-3 min-h-[40px] text-sm border transition-colors',
                      active
                        ? 'bg-[var(--input-bg-hover)] border-[var(--text-dim)] text-[var(--text-primary)]'
                        : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)] hover:bg-[var(--input-bg-hover)] hover:text-[var(--text-primary)]',
                    )}
                  >
                    {Icon && <Icon size={14} className={cn(active ? meta.accent : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]')} />}
                    <span>{chip.label}</span>
                    <span className={cn(
                      'rounded-md px-1.5 py-0.5 text-xs font-semibold',
                      active ? 'bg-[var(--input-bg-hover)] text-[var(--text-primary)]' : 'bg-[var(--input-bg)] text-[var(--text-secondary)]',
                    )}>{chip.count}</span>
                  </button>
                )
              })}
            </div>
          )}

          {anomalies.length === 0 ? (
            <div className="card py-16 text-center">
              <Activity className="w-10 h-10 mx-auto mb-3 text-[var(--text-dim)]" />
              <p className="text-[var(--text-secondary)] font-medium">
                {fromDate || toDate ? 'No anomalies detected in the available records for this date range' : 'No anomalies detected in the available records'}
              </p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                Rule-based checks ran over every tyre record and work order in this scope{partialScan ? ' up to the scan ceiling' : ''}. Anomalies appear here when detected.
              </p>
            </div>
          ) : groups.length === 0 ? (
            <div className="card py-12 text-center">
              <Activity className="w-8 h-8 mx-auto mb-2 text-[var(--text-dim)]" />
              <p className="text-[var(--text-secondary)] text-sm">
                {q ? `No anomalies match "${search}".` : 'No anomalies for this filter.'}
              </p>
              <button type="button" onClick={clearFilters} className="btn-secondary text-xs mt-3 min-h-[44px] px-3">Clear filters</button>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map(group => (
                <AnomalyTypeGroup
                  key={group.type}
                  group={group}
                  detailColumns={detailColumns}
                  defaultOpen={groups.length === 1 || activeType !== 'ALL'}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function WorkshopVisitsView({ summary, rows, columns, activeCurrency, searching }) {
  return (
    <div className="space-y-6">
      {/* Visit KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <SeverityCard
          label="Visits This Week" value={summary.thisWeek} icon={CalendarClock}
          valueClass="text-sky-400" ringClass="ring-sky-500/20"
          hint="Shop trips in the last 7 days"
        />
        <SeverityCard
          label="Visits This Month" value={summary.thisMonth} icon={CalendarClock}
          valueClass="text-indigo-400" ringClass="ring-indigo-500/20"
          hint="Shop trips in the last 30 days"
        />
        <SeverityCard
          label="Total Visits" value={summary.totalVisits} icon={Wrench}
          valueClass="text-[var(--text-primary)]" ringClass="ring-white/10"
          hint={`${summary.assets} vehicle${summary.assets !== 1 ? 's' : ''} serviced`}
        />
        <SeverityCard
          label="Busiest Vehicle"
          value={summary.busiest ? summary.busiest.asset_no : 'N/A'}
          icon={TrendingUp}
          valueClass="text-rose-400"
          ringClass="ring-rose-500/20"
          hint={summary.busiest ? `${summary.busiest.total} visits, peak ${summary.busiest.peak90} per 90d` : 'No visits yet'}
        />
        <SeverityCard
          label="Repeat Visitors" value={summary.repeatAssets} icon={Repeat}
          valueClass="text-amber-400" ringClass="ring-amber-500/20"
          hint="3 or more visits in a 90 day window"
        />
        <SeverityCard
          label="Visits per Vehicle" value={summary.avgPerAsset ?? 'N/A'} icon={Activity}
          valueClass="text-[var(--text-primary)]" ringClass="ring-white/10"
          hint="Average over serviced vehicles"
        />
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--input-border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">Workshop Visits by Vehicle</h3>
            <p className="text-xs text-[var(--text-muted)]">
              One visit = an asset at the workshop on a day (tyre changes + work orders). Sortable & exportable.
            </p>
          </div>
          <span className="rounded-md bg-[var(--input-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--text-secondary)]">
            {rows.length}
          </span>
        </div>
        <EnterpriseTable
          columns={columns}
          data={rows}
          getRowId={r => JSON.stringify([r.country || '', r.asset_no])}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableSorting
          enableColumnVisibility={false}
          enableExport={false}
          exportFileName="workshop_visits_by_vehicle"
          initialPageSize={25}
          pageSizeOptions={[10, 25, 50, 100]}
          emptyMessage={searching ? 'No vehicles match your search.' : 'No workshop visits found.'}
        />
      </div>
    </div>
  )
}

function SeverityCard({ label, value, icon: Icon, valueClass, ringClass, hint }) {
  return (
    <div className={cn('card flex items-start justify-between ring-1', ringClass)}>
      <div>
        <p className={cn('text-2xl font-bold', valueClass)}>{value}</p>
        <p className="text-xs text-[var(--text-secondary)] mt-1">{label}</p>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{hint}</p>
      </div>
      <Icon className={cn('w-5 h-5 shrink-0', valueClass)} />
    </div>
  )
}

function AnomalyTypeGroup({ group, detailColumns, defaultOpen }) {
  const [expanded, setExpanded] = useState(!!defaultOpen)
  const meta = TYPE_META[group.type]
  const Icon = meta?.icon || AlertTriangle

  return (
    <div className="card overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--input-bg-hover)] transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--input-bg)]', meta?.accent)}>
            <Icon size={18} />
          </span>
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">{group.label}</h3>
            <p className="text-xs text-[var(--text-muted)]">{group.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-[var(--input-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--text-secondary)]">
            {group.items.length}
          </span>
          <ChevronDown size={18} className={cn('text-[var(--text-muted)] transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--input-border)] divide-y divide-[var(--input-border)]">
          {group.items.map(a => (
            <AnomalyRow key={a.id} anomaly={a} detailColumns={detailColumns} />
          ))}
        </div>
      )}
    </div>
  )
}

function AnomalyRow({ anomaly, detailColumns }) {
  const [open, setOpen] = useState(false)
  const records = anomaly.records || []
  const canDrill = records.length > 0

  return (
    <div className="px-5 py-3">
      <button
        type="button"
        onClick={() => canDrill && setOpen(v => !v)}
        aria-expanded={open}
        className={cn(
          'w-full flex items-start gap-3 text-left',
          canDrill && 'cursor-pointer',
        )}
      >
        <span className={cn(
          'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
          SEVERITY_BADGE[anomaly.severity] || SEVERITY_BADGE.low,
        )}>
          {anomaly.severity}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--text-primary)]">{anomaly.message}</p>
          {anomaly.detail && <p className="text-xs text-[var(--text-muted)] mt-0.5">{anomaly.detail}</p>}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
            {anomaly.asset_no && <span>Asset: <span className="text-[var(--text-secondary)]">{anomaly.asset_no}</span></span>}
            {anomaly.site && <span>Site: <span className="text-[var(--text-secondary)]">{anomaly.site}</span></span>}
            <span>{records.length} record{records.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        {canDrill && (
          <ChevronDown size={16} className={cn('mt-1 shrink-0 text-[var(--text-muted)] transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open && canDrill && (
        <div className="mt-3">
          <EnterpriseTable
            columns={detailColumns}
            data={records}
            getRowId={r => r.id}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableSorting={records.length > 1}
            enableColumnVisibility={false}
            enableExport
            exportFileName={`anomaly_${anomaly.id}`}
            initialPageSize={10}
            pageSizeOptions={[10, 25, 50]}
            emptyMessage="No records"
          />
        </div>
      )}
    </div>
  )
}
