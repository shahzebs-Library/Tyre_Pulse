import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, RefreshCw, Download, FileText, AlertCircle, CheckCircle2, Clock,
  Eye, EyeOff, ArrowRight, MapPin, Layers, Percent, Search,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { safeInternalPath } from '../lib/safeUrl'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { detectAlerts, ALERT_TYPE_LABELS } from '../lib/alertEngine'
import {
  buildAlertRows, summarizeAlerts, filterAlertRows, sortAlertRows, alertExportRows,
  ALERT_EXPORT_COLS, ALERT_EXPORT_HEADERS, AGE_THRESHOLDS, DEFAULT_AGE_THRESHOLD,
  SEVERITY_ORDER, UNRATED, NO_SITE,
} from '../lib/alertsAnalytics'
import { SEVERITY_META } from '../lib/severity'
import PageHeader from '../components/ui/PageHeader'
import Skeleton from '../components/ui/Skeleton'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { cn } from '../lib/cn'
import { toUserMessage } from '../lib/safeError'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

const DISMISS_KEY = 'tp_dismissed_alerts'
const UNRATED_BADGE = 'bg-gray-500/15 text-gray-400 border border-gray-500/30'

function sevBadge(sev) {
  return SEVERITY_META[sev]?.badge || UNRATED_BADGE
}

function readDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')) }
  catch { return new Set() }
}

function fmtAge(days) {
  if (days == null) return 'N/A'
  return days === 1 ? '1 day' : `${days} days`
}

function KpiCard({ label, value, sub, active, onClick, dot }) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        {dot && <span className={cn('w-2 h-2 rounded-full', dot)} />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted truncate">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums text-[var(--text-primary)] mt-2">{value}</p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </>
  )
  if (!onClick) return <div className="card !p-4">{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('card !p-4 text-left transition-colors', active && 'ring-1 ring-[var(--accent)]')}
    >
      {body}
    </button>
  )
}

function BreakdownList({ title, icon: Icon, items, activeValue, onPick }) {
  const max = items.length ? items[0].count : 0
  return (
    <div className="card !p-4">
      <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
        <Icon size={14} className="text-muted" /> {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted">No open alerts.</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 8).map((it) => (
            <li key={it.name}>
              <button
                type="button"
                onClick={() => onPick(activeValue === it.name ? 'all' : it.name)}
                className="w-full text-left"
                aria-pressed={activeValue === it.name}
              >
                <div className="flex justify-between text-xs">
                  <span className={cn('truncate', activeValue === it.name ? 'text-[var(--text-primary)] font-semibold' : 'text-secondary')}>{it.name}</span>
                  <span className="text-muted tabular-nums">{it.count}</span>
                </div>
                <div className="h-1.5 mt-1 rounded-full bg-[var(--input-bg)] overflow-hidden">
                  <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${max ? (it.count / max) * 100 : 0}%` }} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Alerts() {
  const navigate = useNavigate()
  const { activeCountry } = useSettings()
  const { t } = useLanguage()

  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)

  const [status, setStatus] = useState('open')
  const [sevFilter, setSevFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [olderThan, setOlderThan] = useState(DEFAULT_AGE_THRESHOLD)
  const [agedOnly, setAgedOnly] = useState(false)
  const [dismissed, setDismissed] = useState(readDismissed)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const country = activeCountry !== 'All' ? activeCountry : null
      const found = await detectAlerts(supabase, country)
      setAlerts(found)
      setLastRefresh(new Date())
    } catch (error) {
      setAlerts([])
      setLoadError(toUserMessage(error, 'Could not scan operational alerts.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { refresh() }, [refresh])

  // Persist dismissals via an effect, never inside a setState updater (StrictMode
  // double-invokes updaters, which would double-write).
  useEffect(() => {
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed])) }
    catch { /* storage disabled */ }
  }, [dismissed])

  const dismiss = (id) => setDismissed((prev) => new Set(prev).add(id))
  const restore = (id) => setDismissed((prev) => { const n = new Set(prev); n.delete(id); return n })

  // ── Derived ───────────────────────────────────────────────────────────────
  const rows = useMemo(
    () => buildAlertRows(alerts, dismissed, { now: lastRefresh || new Date(), typeLabels: ALERT_TYPE_LABELS }),
    [alerts, dismissed, lastRefresh],
  )
  const kpi = useMemo(() => summarizeAlerts(rows, { olderThanDays: olderThan }), [rows, olderThan])

  const visible = useMemo(() => sortAlertRows(filterAlertRows(rows, {
    status, severity: sevFilter, type: typeFilter, site: siteFilter, search,
    minAgeDays: agedOnly ? olderThan : null,
  })), [rows, status, sevFilter, typeFilter, siteFilter, search, agedOnly, olderThan])

  const typeOptions = useMemo(() => {
    const m = new Map()
    rows.forEach((r) => { if (r.type) m.set(r.type, r.typeLabel) })
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])
  const siteOptions = useMemo(
    () => [...new Set(rows.map((r) => r.site ?? NO_SITE))].sort(),
    [rows],
  )
  const severityTiles = SEVERITY_ORDER.filter((s) => s !== UNRATED || kpi.bySeverity[UNRATED] > 0)
    .filter((s) => s !== 'Low' || kpi.bySeverity.Low > 0)

  const filtersActive = status !== 'open' || sevFilter !== 'all' || typeFilter !== 'all'
    || siteFilter !== 'all' || search || agedOnly
  const clearFilters = () => {
    setStatus('open'); setSevFilter('all'); setTypeFilter('all'); setSiteFilter('all'); setSearch(''); setAgedOnly(false)
  }
  const dismissVisible = () => setDismissed((prev) => {
    const n = new Set(prev); visible.forEach((r) => { if (!r.dismissed) n.add(r.id) }); return n
  })

  // ── Exports ───────────────────────────────────────────────────────────────
  const exportRows = useMemo(() => alertExportRows(visible), [visible])
  async function doExcelExport() {
    const { exportToExcel, reportFileName, reportDateLabel } = await loadExportUtils()
    exportToExcel(exportRows, ALERT_EXPORT_COLS, ALERT_EXPORT_HEADERS,
      reportFileName('TyrePulse Alerts', activeCountry !== 'All' ? activeCountry : null, reportDateLabel()))
  }
  async function doPdfExport() {
    const { exportToPdf, reportFileName, reportDateLabel } = await loadExportUtils()
    exportToPdf(
      exportRows,
      ALERT_EXPORT_COLS.map((key, i) => ({ key, header: ALERT_EXPORT_HEADERS[i] })),
      'Operational Alerts Report',
      reportFileName('TyrePulse Alerts', activeCountry !== 'All' ? activeCountry : null, reportDateLabel()),
      'landscape',
    )
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  const columns = useMemo(() => [
    {
      id: 'severity', header: 'Severity', accessorFn: (r) => r.rank, size: 100,
      cell: ({ row }) => (
        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', sevBadge(row.original.severity))}>{row.original.severity}</span>
      ),
    },
    {
      id: 'title', header: 'Alert', accessorFn: (r) => r.title, size: 360,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{row.original.title}</p>
          <p className="text-xs text-muted line-clamp-2">{row.original.message}</p>
        </div>
      ),
    },
    { id: 'type', header: 'Type', accessorFn: (r) => r.typeLabel, size: 130 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? 'N/A', size: 120 },
    {
      id: 'age', header: 'Condition age', accessorFn: (r) => r.ageDays ?? -1, size: 120, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className={cn('tabular-nums', row.original.ageDays != null && row.original.ageDays >= olderThan ? 'text-amber-400' : 'text-muted')}>
          {fmtAge(row.original.ageDays)}
        </span>
      ),
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 170, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const to = safeInternalPath(r.link)
        return (
          <div className="flex items-center justify-end gap-2">
            {to && (
              <button type="button" onClick={() => navigate(to)}
                className="text-xs px-2 py-1 rounded-lg border border-[var(--input-border)] text-secondary hover:text-[var(--text-primary)] inline-flex items-center gap-1">
                {t('alerts.item.view')} <ArrowRight size={12} />
              </button>
            )}
            {r.dismissed ? (
              <button type="button" onClick={() => restore(r.id)} className="text-xs text-muted hover:text-[var(--text-primary)] inline-flex items-center gap-1">
                <Eye size={12} /> {t('alerts.dismissed.restore')}
              </button>
            ) : (
              <button type="button" onClick={() => dismiss(r.id)} className="text-xs text-muted hover:text-[var(--text-primary)] inline-flex items-center gap-1">
                <EyeOff size={12} /> {t('alerts.item.dismiss')}
              </button>
            )}
          </div>
        )
      },
    },
  ], [navigate, t, olderThan])

  const selectCls = 'input text-xs py-1.5 w-auto'

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('alerts.header.title')}
        subtitle={t('alerts.header.subtitle')}
        icon={Bell}
        badge={kpi.open > 0 ? t('alerts.header.badge', { count: kpi.open }) : undefined}
        actions={(
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={refresh} disabled={loading} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
              title={lastRefresh ? t('alerts.toolbar.lastScanned', { time: lastRefresh.toLocaleTimeString() }) : t('alerts.toolbar.scanTooltip')}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              {loading ? t('alerts.toolbar.scanning') : t('alerts.toolbar.refresh')}
            </button>
            <button onClick={doExcelExport} disabled={!exportRows.length} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-40">
              <Download size={13} /> {t('alerts.toolbar.excel')}
            </button>
            <button onClick={doPdfExport} disabled={!exportRows.length} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-40">
              <FileText size={13} /> {t('alerts.toolbar.pdf')}
            </button>
          </div>
        )}
      />

      {loadError ? (
        <div role="alert" className="card py-10 px-6 flex flex-col items-center gap-3 text-center border border-red-700/40">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <p className="text-[var(--text-primary)] font-semibold">Alert scan unavailable</p>
          <p className="text-muted text-sm max-w-md">{loadError} No all-clear conclusion is shown until every safety source can be checked.</p>
          <button type="button" onClick={refresh} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw size={14} /> Retry scan</button>
        </div>
      ) : loading && alerts.length === 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[96px] w-full rounded-2xl" />)}
          </div>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[56px] w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          {/* Severity KPIs (open alerts) */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            {severityTiles.map((sev) => (
              <KpiCard
                key={sev}
                label={`${sev} open`}
                value={kpi.bySeverity[sev] ?? 0}
                dot={SEVERITY_META[sev]?.dot || 'bg-gray-500'}
                active={sevFilter === sev}
                onClick={() => setSevFilter(sevFilter === sev ? 'all' : sev)}
              />
            ))}
            <KpiCard
              label={`Older than ${olderThan} days`}
              value={kpi.olderThan ?? 'N/A'}
              sub={kpi.oldestDays != null ? `Oldest ${fmtAge(kpi.oldestDays)}` : 'No dated conditions'}
              active={agedOnly}
              onClick={() => setAgedOnly((v) => !v)}
            />
            <KpiCard
              label="Dismissed rate"
              value={kpi.ackRate == null ? 'N/A' : `${kpi.ackRate}%`}
              sub={`${kpi.acknowledged} of ${kpi.total} on this device`}
            />
          </div>

          {/* Breakdowns */}
          <div className="grid md:grid-cols-3 gap-3">
            <BreakdownList title="Open alerts by site" icon={MapPin} items={kpi.bySite} activeValue={siteFilter} onPick={setSiteFilter} />
            <BreakdownList
              title="Open alerts by type"
              icon={Layers}
              items={kpi.byType}
              activeValue={typeOptions.find(([k]) => k === typeFilter)?.[1]}
              onPick={(label) => setTypeFilter(label === 'all' ? 'all' : (typeOptions.find(([, l]) => l === label)?.[0] ?? 'all'))}
            />
            <div className="card !p-4 space-y-2 text-xs">
              <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Percent size={14} className="text-muted" /> Coverage</p>
              <div className="flex justify-between"><span className="text-muted">Critical and high open</span><span className="tabular-nums text-[var(--text-primary)]">{kpi.urgent}</span></div>
              <div className="flex justify-between"><span className="text-muted">Sites affected</span><span className="tabular-nums text-[var(--text-primary)]">{kpi.sitesAffected}</span></div>
              <div className="flex justify-between"><span className="text-muted">Open alerts with a dated condition</span><span className="tabular-nums text-[var(--text-primary)]">{kpi.ageCoverage == null ? 'N/A' : `${kpi.ageCoverage}%`}</span></div>
              <p className="text-muted pt-1">
                Age is measured from the source record: an action&apos;s due date, an inspection&apos;s scheduled date or a vehicle&apos;s last activity.
                Stock, budget, cost and data quality alerts carry no such date, so their age reads N/A.
              </p>
              {lastRefresh && <p className="text-dim flex items-center gap-1"><Clock size={11} /> {t('alerts.list.scannedAt', { time: lastRefresh.toLocaleTimeString() })}</p>}
            </div>
          </div>

          {/* Filters */}
          <div className="card !p-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input pl-8 text-sm" placeholder={t('alerts.toolbar.searchPlaceholder')} value={search}
                onChange={(e) => setSearch(e.target.value)} aria-label="Search alerts" />
            </div>
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="open">Open</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All</option>
            </select>
            <select className={selectCls} value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} aria-label="Filter by severity">
              <option value="all">All severities</option>
              {SEVERITY_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={selectCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
              <option value="all">All types</option>
              {typeOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select className={selectCls} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Filter by site">
              <option value="all">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={selectCls} value={olderThan} onChange={(e) => setOlderThan(Number(e.target.value))} aria-label="Age threshold in days">
              {AGE_THRESHOLDS.map((d) => <option key={d} value={d}>Older than {d} days</option>)}
            </select>
            <label className="text-xs text-secondary inline-flex items-center gap-1.5">
              <input type="checkbox" checked={agedOnly} onChange={(e) => setAgedOnly(e.target.checked)} /> Only older ones
            </label>
            <span className="ml-auto text-xs text-muted">{visible.length} shown</span>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="text-xs text-blue-400 hover:text-blue-300">{t('alerts.states.clearFilters')}</button>
            )}
            {status !== 'dismissed' && visible.some((r) => !r.dismissed) && visible.length > 1 && (
              <button type="button" onClick={dismissVisible} className="text-xs text-muted hover:text-[var(--text-primary)] inline-flex items-center gap-1">
                <EyeOff size={11} /> {t('alerts.list.dismissAllVisible')}
              </button>
            )}
            {dismissed.size > 0 && (
              <button type="button" onClick={() => setDismissed(new Set())} className="text-xs text-muted hover:text-[var(--text-primary)]">
                {t('alerts.dismissed.restoreAll')}
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="card py-16 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-brand-bright opacity-60" />
              <p className="text-[var(--text-primary)] font-semibold">{t('alerts.states.allClear')}</p>
              <p className="text-muted text-sm">{t('alerts.states.allClearDesc')}</p>
            </div>
          ) : (
            <EnterpriseTable
              columns={columns}
              data={visible}
              getRowId={(r) => String(r.id)}
              loading={loading}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              initialPageSize={25}
              emptyMessage={filtersActive ? t('alerts.states.noMatch') : 'No open alerts. Every alert in this scan has been dismissed.'}
            />
          )}
        </>
      )}
    </div>
  )
}
