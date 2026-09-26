import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Radio, RefreshCw, Search, X, XCircle, CheckCircle, Clock,
  AlertTriangle, Plug, Inbox, FileSpreadsheet, FileText, Activity, Timer, BarChart3,
} from 'lucide-react'
import * as domainEvents from '../lib/api/domainEvents'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTime } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import {
  EVENT_SAMPLE_LIMIT, EVENT_STATUS_LABEL, eventsByType, volumeByHour, volumeByDay,
  consumerHealth, eventStreamKpis, formatAge, eventExportRows,
  EVENT_EXPORT_COLS, EVENT_EXPORT_HEADERS,
} from '../lib/eventStreamAnalytics'

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50
const REFRESH_MS = 30_000

const STATUS_META = {
  pending:   { label: 'Pending',   badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Clock },
  processed: { label: 'Processed', badge: 'bg-green-500/20 text-green-400 border-green-500/30',    icon: CheckCircle },
  failed:    { label: 'Failed',    badge: 'bg-red-500/20 text-red-400 border-red-500/30',          icon: AlertTriangle },
}

const TYPE_COLORS = [
  'bg-orange-500/15 text-orange-300',
  'bg-blue-500/15 text-blue-300',
  'bg-purple-500/15 text-purple-300',
  'bg-teal-500/15 text-teal-300',
  'bg-pink-500/15 text-pink-300',
  'bg-indigo-500/15 text-indigo-300',
  'bg-amber-500/15 text-amber-300',
]

function typeBadgeClass(type = '') {
  let h = 0
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0
  return TYPE_COLORS[h % TYPE_COLORS.length]
}

function relativeTime(ts) {
  if (!ts) return null
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }) }
  catch { return null }
}

const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtPct = (v) => (v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`)

// Settled promise -> value or null (null = could not be read, never 0).
const settledCount = (r) => (r.status === 'fulfilled' ? r.value.count : null)

// ─── Small pieces ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const meta = STATUS_META[status]
  if (!meta) {
    return <span className="inline-flex px-2 py-0.5 rounded-full border border-gray-600 text-[11px] text-gray-400">{status || 'Unknown'}</span>
  }
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${meta.badge}`}>
      <Icon className="w-3 h-3" /> {meta.label}
    </span>
  )
}

function Kpi({ icon: Icon, label, value, hint, tone = 'text-orange-400', loading }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 text-gray-400 text-xs">
        <Icon className={`w-4 h-4 ${tone}`} /> {label}
      </div>
      {loading
        ? <div className="h-7 mt-1.5 w-20 rounded bg-gray-700/60 animate-pulse" />
        : <p className="text-white font-bold text-xl mt-1">{value}</p>}
      {hint && !loading && <p className="text-gray-500 text-[11px] mt-0.5">{hint}</p>}
    </div>
  )
}

function Bars({ buckets }) {
  const max = Math.max(1, ...buckets.map((b) => b.count))
  return (
    <div className="flex items-end gap-1 h-28" role="img" aria-label="Event volume chart">
      {buckets.map((b) => (
        <div key={b.fromMs} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${b.label}: ${b.count} events${b.failed ? `, ${b.failed} failed` : ''}${b.complete ? '' : ' (sample does not reach this far back)'}`}>
          <div className="w-full flex-1 flex items-end">
            <div
              className={`w-full rounded-t ${b.complete ? 'bg-orange-500/70' : 'bg-gray-600/60'}`}
              style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count ? 2 : 0 }}
            />
          </div>
          <span className="text-[9px] text-gray-500 truncate w-full text-center">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Consumers panel ──────────────────────────────────────────────────────────

const HEALTH_META = {
  healthy:   { label: 'Healthy',  cls: 'bg-green-500/20 text-green-400' },
  attention: { label: 'Attention', cls: 'bg-yellow-500/20 text-yellow-400' },
  disabled:  { label: 'Disabled', cls: 'bg-gray-700 text-gray-400' },
}

function ConsumersPanel({ health, loading, error, onRetry }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
        <Plug className="w-4 h-4 text-orange-400" />
        <h2 className="text-white text-sm font-semibold">Event Consumers</h2>
      </div>
      {loading ? (
        <div className="p-4 space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-10 rounded-lg bg-gray-700/50 animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="p-4 text-xs text-red-400 flex items-center gap-2">
          <XCircle className="w-4 h-4 shrink-0" /> {error}
          <button onClick={onRetry} className="ml-auto px-2 py-1 rounded bg-red-500/15 text-red-300 border border-red-500/30">Retry</button>
        </div>
      ) : health.length === 0 ? (
        <p className="text-gray-500 text-xs px-4 py-6 text-center">No consumers registered.</p>
      ) : (
        <ul className="divide-y divide-gray-700/60">
          {health.map(c => {
            const meta = HEALTH_META[c.state]
            return (
              <li key={c.consumer} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-gray-200 text-xs font-mono font-medium truncate">{c.consumer}</p>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
                </div>
                {c.description && <p className="text-gray-500 text-[11px] mt-1 leading-relaxed">{c.description}</p>}
                <p className="text-gray-500 text-[10px] mt-1">
                  {c.subscribesAll ? 'All events' : `${c.eventTypes.length} event type${c.eventTypes.length !== 1 ? 's' : ''}`}
                  {' | '}{c.matched} in sample
                  {c.failed > 0 && <span className="text-red-400"> | {c.failed} failed</span>}
                  {c.pending > 0 && <span className="text-yellow-400"> | {c.pending} pending</span>}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EventStream() {
  const [rows, setRows]             = useState([])
  const [count, setCount]           = useState(0)
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState(null)
  const [page, setPage]             = useState(0)
  const [eventType, setEventType]   = useState('all')
  const [status, setStatus]         = useState('all')
  const [search, setSearch]         = useState('')
  const [debounced, setDebounced]   = useState('')
  const [selected, setSelected]     = useState(null)
  const [types, setTypes]           = useState([])
  const [typesError, setTypesError] = useState(null)
  const [consumers, setConsumers]   = useState(null)
  const [consumersError, setConsumersError] = useState(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [sample, setSample]         = useState([])
  const [totals, setTotals]         = useState({})
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [now, setNow]               = useState(() => new Date())

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  // The search box is debounced, so typing produces a burst of loads and the
  // paging offset changes under them. If an earlier one finishes last it shows
  // the results for a query the box no longer contains.
  const latestLoad = useLatestRequest()

  const fetchEvents = useCallback(async ({ silent = false } = {}) => {
    const stale = latestLoad.begin()
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const { rows: data, count: total } = await domainEvents.listDomainEvents({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        eventType: eventType === 'all' ? null : eventType,
        status: status === 'all' ? null : status,
        search: debounced || null,
      })
      if (stale()) return
      setRows(data || [])
      setCount(total || 0)
      setLastRefresh(new Date())
    } catch (err) {
      if (!stale()) setError(toUserMessage(err, 'Failed to load events'))
    } finally {
      // A stale load clearing these would make the newer one look finished.
      if (!stale()) { setLoading(false); setRefreshing(false) }
    }
  }, [page, eventType, status, debounced, latestLoad])

  // Analytics: a recent sample (newest EVENT_SAMPLE_LIMIT) plus exact server
  // counts per status. Each count is read on its own so one failure leaves the
  // others honest instead of zeroing everything.
  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError(null)
    const [win, pending, failed, processed] = await Promise.allSettled([
      domainEvents.listDomainEvents({ limit: EVENT_SAMPLE_LIMIT }),
      domainEvents.listDomainEvents({ limit: 1, status: 'pending' }),
      domainEvents.listDomainEvents({ limit: 1, status: 'failed' }),
      domainEvents.listDomainEvents({ limit: 1, status: 'processed' }),
    ])
    if (win.status === 'fulfilled') {
      setSample(win.value.rows || [])
    } else {
      setSample([])
      setStatsError(toUserMessage(win.reason, 'Failed to load event statistics'))
    }
    setTotals({
      all: settledCount(win),
      pending: settledCount(pending),
      failed: settledCount(failed),
      processed: settledCount(processed),
    })
    setNow(new Date())
    setStatsLoading(false)
  }, [])

  const fetchMeta = useCallback(async () => {
    setMetaLoading(true)
    setTypesError(null)
    setConsumersError(null)
    const [t, c] = await Promise.allSettled([
      domainEvents.listEventTypes(),
      domainEvents.listEventConsumers(),
    ])
    if (t.status === 'fulfilled') setTypes(t.value || [])
    else setTypesError(toUserMessage(t.reason, 'Could not load event types'))
    if (c.status === 'fulfilled') setConsumers(c.value || [])
    else { setConsumers(null); setConsumersError(toUserMessage(c.reason, 'Could not load consumers')) }
    setMetaLoading(false)
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])
  useEffect(() => { fetchMeta() }, [fetchMeta])
  useEffect(() => { fetchStats() }, [fetchStats])

  // Auto-refresh polling (silent, cleaned up)
  const fetchRef = useRef(fetchEvents)
  const statsRef = useRef(fetchStats)
  useEffect(() => { fetchRef.current = fetchEvents }, [fetchEvents])
  useEffect(() => { statsRef.current = fetchStats }, [fetchStats])
  useEffect(() => {
    const iv = setInterval(() => { fetchRef.current({ silent: true }); statsRef.current() }, REFRESH_MS)
    return () => clearInterval(iv)
  }, [])

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const hasFilters = eventType !== 'all' || status !== 'all' || debounced

  function clearFilters() { setEventType('all'); setStatus('all'); setSearch(''); setPage(0) }
  function refreshAll() { fetchEvents({ silent: true }); fetchMeta(); fetchStats() }

  const kpis = useMemo(
    () => eventStreamKpis({ events: sample, totals, consumers, now }),
    [sample, totals, consumers, now],
  )
  const byType = useMemo(() => eventsByType(sample).slice(0, 8), [sample])
  const hourly = useMemo(() => volumeByHour(sample, { now }), [sample, now])
  const daily = useMemo(() => volumeByDay(sample, { now }), [sample, now])
  const health = useMemo(() => consumerHealth(consumers || [], sample), [consumers, sample])

  const columns = useMemo(() => [
    {
      id: 'created_at',
      header: 'Time',
      accessorKey: 'created_at',
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <p className="text-gray-300 text-xs">{formatDateTime(row.original.created_at)}</p>
          <p className="text-gray-600 text-[10px]">{relativeTime(row.original.created_at)}</p>
        </div>
      ),
    },
    {
      id: 'event_type',
      header: 'Event Type',
      accessorKey: 'event_type',
      cell: ({ getValue }) => (
        <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-mono font-medium ${typeBadgeClass(getValue() || '')}`}>
          {getValue() || 'N/A'}
        </span>
      ),
    },
    {
      id: 'entity',
      header: 'Entity',
      accessorFn: (r) => `${r.entity_type || ''} ${r.entity_id || ''}`.trim(),
      cell: ({ row }) => (
        <span className="text-gray-300 text-xs truncate max-w-[200px] inline-block">
          {row.original.entity_type || 'N/A'}{row.original.entity_id ? <span className="text-gray-500"> #{row.original.entity_id}</span> : ''}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      cell: ({ getValue }) => <StatusBadge status={getValue()} />,
    },
    {
      id: 'attempts',
      header: 'Attempts',
      accessorKey: 'attempts',
      meta: { align: 'right' },
      cell: ({ getValue }) => (
        <span className={`text-xs font-semibold ${getValue() > 1 ? 'text-yellow-400' : 'text-gray-400'}`}>{getValue() ?? 'N/A'}</span>
      ),
    },
  ], [])

  const exportTitle = `Event Stream${eventType !== 'all' ? ` ${eventType}` : ''}${status !== 'all' ? ` ${EVENT_STATUS_LABEL[status]}` : ''} page ${page + 1}`
  const doExcel = () => exportToExcel(
    eventExportRows(rows), EVENT_EXPORT_COLS, EVENT_EXPORT_HEADERS,
    reportFileName('Event Stream', `page ${page + 1}`), 'Events',
  )
  const doPdf = () => exportToPdf(
    eventExportRows(rows),
    EVENT_EXPORT_COLS.map((k, i) => ({ key: k, header: EVENT_EXPORT_HEADERS[i] })),
    exportTitle, reportFileName('Event Stream', `page ${page + 1}`), 'landscape',
  )

  const sel = selected ? rows.find((r) => r.id === selected) : null
  const sampleNote = kpis.sample.truncated
    ? `Charts cover the newest ${kpis.sample.size.toLocaleString()} events only.`
    : `Charts cover all ${kpis.sample.size.toLocaleString()} recorded events.`

  return (
    <div className="text-white space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <Radio className="w-5 h-5 text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Event Stream</h1>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px] font-semibold border border-green-500/25">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
            </span>
          </div>
          <p className="text-gray-400 text-sm ml-11">
            Domain event outbox, auto-refreshes every 30s
            {lastRefresh && <span className="text-gray-600"> | updated {relativeTime(lastRefresh)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <button
            onClick={doExcel}
            disabled={loading || rows.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm text-white bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
          <button
            onClick={doPdf}
            disabled={loading || rows.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm text-white bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" /> PDF
          </button>
          <button
            onClick={refreshAll}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Activity} label="Total events" value={fmtNum(kpis.total)} loading={statsLoading} hint={`${fmtNum(kpis.processed)} processed`} />
        <Kpi icon={Clock} label="Pending" value={fmtNum(kpis.pending)} tone="text-yellow-400" loading={statsLoading} hint="Waiting for consumers" />
        <Kpi icon={AlertTriangle} label="Failed" value={fmtNum(kpis.failed)} tone="text-red-400" loading={statsLoading} hint={`Failure rate ${fmtPct(kpis.failureRate)}`} />
        <Kpi
          icon={BarChart3} label="Events per hour (24h)" loading={statsLoading}
          value={kpis.perHour == null ? 'N/A' : `${kpis.windowComplete ? '' : 'at least '}${kpis.perHour.toFixed(1)}`}
          hint={`${kpis.windowComplete ? '' : 'at least '}${kpis.eventsLast24h.toLocaleString()} in the last 24h`}
        />
        <Kpi icon={Timer} label="Last event" value={formatAge(kpis.lastEventAgeMs)} loading={statsLoading} hint={kpis.lastEventAgeMs == null ? 'No events recorded' : 'ago'} />
        <Kpi
          icon={Plug} label="Consumers needing attention" tone="text-purple-400" loading={metaLoading}
          value={kpis.consumers == null ? 'N/A' : `${kpis.consumersAttention} of ${kpis.consumers}`}
          hint={kpis.consumersDisabled == null ? 'Consumers unavailable' : `${kpis.consumersDisabled} disabled`}
        />
      </div>

      {statsError && (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{statsError}</p>
          <button onClick={fetchStats} className="ml-auto shrink-0 px-3 py-1 text-xs font-semibold text-red-300 bg-red-500/15 rounded-lg border border-red-500/30">Retry</button>
        </div>
      )}

      {/* ── Analytics ── */}
      {!statsLoading && !statsError && sample.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Events per hour (last 24h)</h2>
            <Bars buckets={hourly} />
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Events per day (last 7 days)</h2>
            <Bars buckets={daily} />
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Events per type</h2>
            <ul className="space-y-2">
              {byType.map((t) => (
                <li key={t.type}>
                  <div className="flex items-center justify-between text-xs gap-2">
                    <button
                      onClick={() => { setEventType(t.type); setPage(0) }}
                      className="font-mono text-gray-300 truncate hover:text-orange-300 text-left"
                      title="Filter the register to this type"
                    >
                      {t.type}
                    </button>
                    <span className="text-gray-400 shrink-0">
                      {t.count}{t.failed > 0 && <span className="text-red-400"> | {t.failed} failed</span>}
                    </span>
                  </div>
                  <div className="h-1.5 mt-1 rounded bg-gray-700 overflow-hidden">
                    <div className="h-full bg-orange-500/70" style={{ width: `${(t.share || 0) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <p className="xl:col-span-3 text-[11px] text-gray-500">
            {sampleNote} Grey bars are periods the sample does not reach, so their counts are incomplete.
          </p>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search events (type, entity)..."
            aria-label="Search events"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select
          value={eventType}
          onChange={e => { setEventType(e.target.value); setPage(0) }}
          aria-label="Event type"
          className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all cursor-pointer"
        >
          <option value="all">All Event Types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0) }}
          aria-label="Status"
          className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all cursor-pointer"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processed">Processed</option>
          <option value="failed">Failed</option>
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="px-3 py-2.5 rounded-xl text-sm text-orange-400 hover:text-orange-300 border border-gray-700 bg-gray-800">
            Clear filters
          </button>
        )}
      </div>
      {typesError && <p className="text-xs text-yellow-400">{typesError}. The type filter may be incomplete.</p>}

      {/* ── Content grid ── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr,300px] gap-5 items-start">
        <div className="space-y-4 min-w-0">
          <EnterpriseTable
            columns={columns}
            data={rows}
            getRowId={(r) => String(r.id)}
            loading={loading}
            error={error}
            onRetry={() => fetchEvents()}
            emptyMessage={hasFilters ? 'No events match your filters' : 'No domain events yet. Events appear as inspections, work orders and stock movements happen.'}
            emptyIcon={<Inbox className="w-7 h-7 text-gray-500" />}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            manualPagination
            pageIndex={page}
            pageCount={totalPages}
            totalRows={count}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            paginationLabel={({ from, to, total }) => `${from.toLocaleString()} to ${to.toLocaleString()} of ${total.toLocaleString()} events`}
            onRowClick={(r) => setSelected((cur) => (cur === r.id ? null : r.id))}
          />

          {sel && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white font-mono">{sel.event_type}</h2>
                <button onClick={() => setSelected(null)} aria-label="Close event detail" className="text-gray-500 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div>
                <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest mb-1">Payload</p>
                <pre className="text-xs text-gray-300 font-mono bg-gray-900 border border-gray-700 rounded-lg p-3 overflow-x-auto max-h-64">
                  {JSON.stringify(sel.payload ?? {}, null, 2)}
                </pre>
              </div>
              {sel.last_error && (
                <div>
                  <p className="text-red-400 text-[10px] font-semibold uppercase tracking-widest mb-1">Last Error</p>
                  <pre className="text-xs text-red-300 font-mono bg-red-500/5 border border-red-500/25 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{sel.last_error}</pre>
                </div>
              )}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-gray-500">
                <span>Event ID: <span className="text-gray-400 font-mono">{sel.id}</span></span>
                <span>Status: <span className="text-gray-400">{EVENT_STATUS_LABEL[sel.status] || sel.status || 'Unknown'}</span></span>
                <span>Processed: <span className="text-gray-400">{sel.processed_at ? formatDateTime(sel.processed_at) : 'Not yet'}</span></span>
              </div>
            </div>
          )}
        </div>

        <ConsumersPanel health={health} loading={metaLoading} error={consumersError} onRetry={fetchMeta} />
      </div>
    </div>
  )
}
