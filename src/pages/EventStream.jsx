import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Radio, RefreshCw, Search, X, XCircle, Loader2, Filter,
  ChevronDown, ChevronRight, ChevronLeft, CheckCircle, Clock,
  AlertTriangle, Plug, Inbox,
} from 'lucide-react'
import * as domainEvents from '../lib/api/domainEvents'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTime } from '../lib/formatters'

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

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${meta.badge}`}>
      <Icon className="w-3 h-3" /> {meta.label}
    </span>
  )
}

// ─── Consumers panel ──────────────────────────────────────────────────────────

function ConsumersPanel({ consumers, loading }) {
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
      ) : consumers.length === 0 ? (
        <p className="text-gray-500 text-xs px-4 py-6 text-center">No consumers registered.</p>
      ) : (
        <ul className="divide-y divide-gray-700/60">
          {consumers.map(c => (
            <li key={c.consumer} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-gray-200 text-xs font-mono font-medium truncate">{c.consumer}</p>
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  c.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${c.enabled ? 'bg-green-400' : 'bg-gray-500'}`} />
                  {c.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              {c.description && <p className="text-gray-500 text-[11px] mt-1 leading-relaxed">{c.description}</p>}
              <p className="text-gray-600 text-[10px] mt-1">
                {c.event_types?.length ? `${c.event_types.length} event type${c.event_types.length !== 1 ? 's' : ''}` : 'All events'}
              </p>
            </li>
          ))}
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
  const [expanded, setExpanded]     = useState(null)
  const [types, setTypes]           = useState([])
  const [consumers, setConsumers]   = useState([])
  const [metaLoading, setMetaLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const fetchEvents = useCallback(async ({ silent = false } = {}) => {
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
      setRows(data || [])
      setCount(total || 0)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err.message || 'Failed to load events')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [page, eventType, status, debounced])

  const fetchMeta = useCallback(async () => {
    setMetaLoading(true)
    try {
      const [t, c] = await Promise.all([
        domainEvents.listEventTypes(),
        domainEvents.listEventConsumers(),
      ])
      setTypes(t || [])
      setConsumers(c || [])
    } catch { /* non-fatal — panel simply stays empty */ }
    finally { setMetaLoading(false) }
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])
  useEffect(() => { fetchMeta() }, [fetchMeta])

  // Auto-refresh polling (silent, cleaned up)
  const fetchRef = useRef(fetchEvents)
  useEffect(() => { fetchRef.current = fetchEvents }, [fetchEvents])
  useEffect(() => {
    const iv = setInterval(() => fetchRef.current({ silent: true }), REFRESH_MS)
    return () => clearInterval(iv)
  }, [])

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const hasFilters = eventType !== 'all' || status !== 'all' || debounced

  function clearFilters() { setEventType('all'); setStatus('all'); setSearch(''); setPage(0) }

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
            Domain event outbox — auto-refreshes every 30s
            {lastRefresh && <span className="text-gray-600"> · updated {relativeTime(lastRefresh)}</span>}
          </p>
        </div>
        <button
          onClick={() => { fetchEvents({ silent: true }); fetchMeta() }}
          disabled={refreshing || loading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50 transition-all self-start"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search events (type, entity, payload)..."
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
          className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
        >
          <option value="all">All Event Types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processed">Processed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => fetchEvents()}
            className="ml-auto shrink-0 px-3 py-1 text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30 transition-all"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Content grid ── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr,300px] gap-5 items-start">
        {/* Table */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-11 rounded-lg bg-gray-700/50 animate-pulse" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-900 border border-gray-700 flex items-center justify-center">
                <Inbox className="w-7 h-7 text-gray-500" />
              </div>
              <div className="text-center">
                <p className="text-gray-300 text-sm font-medium">
                  {hasFilters ? 'No events match your filters' : 'No domain events yet'}
                </p>
                <p className="text-gray-500 text-xs mt-1">
                  {hasFilters
                    ? 'Try widening the search or clearing filters.'
                    : 'Events appear here automatically as inspections, work orders and stock movements happen.'}
                </p>
                {hasFilters && (
                  <button onClick={clearFilters} className="mt-3 text-orange-400 text-xs hover:text-orange-300 transition-colors inline-flex items-center gap-1">
                    <Filter className="w-3 h-3" /> Clear filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left">
                    <th className="w-8 px-3 py-2.5" aria-label="Expand" />
                    <th className="px-3 py-2.5 text-gray-400 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Time</th>
                    <th className="px-3 py-2.5 text-gray-400 text-xs font-semibold uppercase tracking-wider">Event Type</th>
                    <th className="px-3 py-2.5 text-gray-400 text-xs font-semibold uppercase tracking-wider">Entity</th>
                    <th className="px-3 py-2.5 text-gray-400 text-xs font-semibold uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2.5 text-gray-400 text-xs font-semibold uppercase tracking-wider text-right">Attempts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/60">
                  {rows.map(ev => {
                    const isOpen = expanded === ev.id
                    return [
                      <tr
                        key={ev.id}
                        onClick={() => setExpanded(isOpen ? null : ev.id)}
                        className="cursor-pointer hover:bg-gray-700/30 transition-colors"
                      >
                        <td className="px-3 py-2.5 text-gray-500">
                          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <p className="text-gray-300 text-xs">{formatDateTime(ev.created_at)}</p>
                          <p className="text-gray-600 text-[10px]">{relativeTime(ev.created_at)}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-mono font-medium ${typeBadgeClass(ev.event_type)}`}>
                            {ev.event_type}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-gray-300 text-xs truncate max-w-[180px]">
                            {ev.entity_type || '—'}{ev.entity_id ? <span className="text-gray-500"> #{ev.entity_id}</span> : ''}
                          </p>
                        </td>
                        <td className="px-3 py-2.5"><StatusBadge status={ev.status} /></td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`text-xs font-semibold ${ev.attempts > 1 ? 'text-yellow-400' : 'text-gray-400'}`}>{ev.attempts}</span>
                        </td>
                      </tr>,
                      isOpen && (
                        <tr key={`${ev.id}-detail`} className="bg-gray-900/60">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="space-y-3">
                              <div>
                                <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest mb-1">Payload</p>
                                <pre className="text-xs text-gray-300 font-mono bg-gray-900 border border-gray-700 rounded-lg p-3 overflow-x-auto max-h-64">
                                  {JSON.stringify(ev.payload ?? {}, null, 2)}
                                </pre>
                              </div>
                              {ev.last_error && (
                                <div>
                                  <p className="text-red-400 text-[10px] font-semibold uppercase tracking-widest mb-1">Last Error</p>
                                  <pre className="text-xs text-red-300 font-mono bg-red-500/5 border border-red-500/25 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{ev.last_error}</pre>
                                </div>
                              )}
                              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-gray-500">
                                <span>Event ID: <span className="text-gray-400 font-mono">{ev.id}</span></span>
                                {ev.processed_at && <span>Processed: <span className="text-gray-400">{formatDateTime(ev.processed_at)}</span></span>}
                                {ev.actor_id && <span>Actor: <span className="text-gray-400 font-mono">{ev.actor_id}</span></span>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && count > 0 && (
            <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-between gap-3">
              <p className="text-gray-500 text-xs">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, count)} of {count.toLocaleString()} events
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Prev
                </button>
                <span className="text-gray-500 text-xs">Page {page + 1} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Consumers side panel */}
        <ConsumersPanel consumers={consumers} loading={metaLoading} />
      </div>
    </div>
  )
}
