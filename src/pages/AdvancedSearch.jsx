/**
 * AdvancedSearch (route /advanced-search) - Advanced / Global Search. A single
 * command surface that (a) runs *live* cross-entity searches across the fleet's
 * core operational tables - assets (vehicle_fleet), tyres (tyre_records), work
 * orders, and inspections - and (b) lets operators persist named searches they
 * re-run on demand.
 *
 * Runs on the `saved_searches` table (V198) for the saved-search library, and
 * queries the live operational tables through the service for the query
 * builder. Real data, KPI tiles, grouped live results, a sortable EnterpriseTable
 * library with pin/re-run, create/edit dialog, Excel/PDF export, and
 * loading/empty/error states throughout. Roll-ups live in
 * `src/lib/advancedSearch.js`; the page shaping (filters, KPI strip with honest
 * nulls, result summary, table + export rows) in
 * `src/lib/advancedSearchAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Search, X, FileSpreadsheet, FileText, Plus, Pencil, Trash2, Pin,
  PinOff, Play, Bookmark, Layers, Database, AlertTriangle, Truck, Package,
  ClipboardCheck, Wrench, Globe, RefreshCw, Save, Zap, History,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listSavedSearches, createSavedSearch, updateSavedSearch, deleteSavedSearch,
  setSavedSearchPinned, markSavedSearchRun, runGlobalSearch,
} from '../lib/api/advancedSearch'
import {
  groupByEntity, EMPTY_LIBRARY_FILTERS, STALE_DAYS, activeLibraryFilterCount,
  filterSavedSearches, savedSearchKpis, resultSummary, savedTableRows,
  savedExportRows, SAVED_EXPORT_COLUMNS, runStateLabel,
} from '../lib/advancedSearchAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

// ── Entity metadata (labels, icons, live-result shaping) ─────────────────────
const ENTITY_META = {
  all:          { label: 'All entities', short: 'All',          icon: Layers,         tone: 'text-indigo-400' },
  assets:       { label: 'Assets',        short: 'Assets',       icon: Truck,          tone: 'text-sky-400' },
  tyres:        { label: 'Tyres',         short: 'Tyres',        icon: Package,        tone: 'text-amber-400' },
  work_orders:  { label: 'Work orders',   short: 'Work orders',  icon: Wrench,         tone: 'text-violet-400' },
  inspections:  { label: 'Inspections',   short: 'Inspections',  icon: ClipboardCheck, tone: 'text-green-400' },
}
const ENTITY_ORDER = ['all', 'assets', 'tyres', 'work_orders', 'inspections']

// How each live result group is titled and which fields render per card.
const RESULT_GROUPS = [
  {
    key: 'assets', entity: 'assets', icon: Truck, tone: 'text-sky-400',
    title: (r) => r.asset_no || r.fleet_number || 'Asset',
    sub: (r) => [r.make, r.model].filter(Boolean).join(' ') || r.vehicle_type || 'N/A',
    tags: (r) => [r.site, r.status].filter(Boolean),
  },
  {
    key: 'tyres', entity: 'tyres', icon: Package, tone: 'text-amber-400',
    title: (r) => r.serial_no || 'Tyre',
    sub: (r) => [r.brand, r.size].filter(Boolean).join(', ') || 'N/A',
    tags: (r) => [r.asset_no, r.position, r.risk_level].filter(Boolean),
  },
  {
    key: 'workOrders', entity: 'work_orders', icon: Wrench, tone: 'text-violet-400',
    title: (r) => r.work_order_no || 'Work order',
    sub: (r) => [r.work_type, r.workshop_name].filter(Boolean).join(', ') || 'N/A',
    tags: (r) => [r.asset_no, r.status, r.priority].filter(Boolean),
  },
  {
    key: 'inspections', entity: 'inspections', icon: ClipboardCheck, tone: 'text-green-400',
    title: (r) => r.title || 'Inspection',
    sub: (r) => [r.inspection_type, r.inspector].filter(Boolean).join(', ') || 'N/A',
    tags: (r) => [r.asset_no, r.status, r.severity].filter(Boolean),
  },
]
const GROUP_KEYS = RESULT_GROUPS.map((g) => g.key)

const EMPTY_FORM = { name: '', entity: 'all', query_text: '', notes: '' }
const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
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

export default function AdvancedSearch() {
  const { activeCountry } = useSettings()

  // ── Saved-search library state ──────────────────────────────────────────
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [filters, setFilters] = useState(EMPTY_LIBRARY_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  // ── Live query-builder state ────────────────────────────────────────────
  const [term, setTerm] = useState('')
  const [scope, setScope] = useState('all')
  const [results, setResults] = useState(null) // null = never run
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [ranTerm, setRanTerm] = useState('')
  const [ranScope, setRanScope] = useState('all')
  const requestVersion = useRef(0)
  useEffect(() => { requestVersion.current += 1; setResults(null); setSearching(false); setRanTerm('') }, [activeCountry])

  // ── Dialog state ────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const savedRequest = useRef(0)

  const load = useCallback(async () => {
    const version = ++savedRequest.current
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listSavedSearches({ country: activeCountry })
      if (version !== savedRequest.current) return
      setSaved(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      if (version !== savedRequest.current) return
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load saved searches.'))
      setSaved([])
    } finally {
      if (version === savedRequest.current) setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const all = useMemo(() => saved || [], [saved])
  const loading = saved === null
  const failed = Boolean(error)
  const kpi = useMemo(() => savedSearchKpis(all, nowMs), [all, nowMs])
  const entityGroups = useMemo(() => groupByEntity(all), [all])
  const filteredSaved = useMemo(() => filterSavedSearches(all, filters, nowMs), [all, filters, nowMs])
  const tableRows = useMemo(() => savedTableRows(filteredSaved, nowMs), [filteredSaved, nowMs])
  const filterCount = activeLibraryFilterCount(filters)

  // ── Live global search ──────────────────────────────────────────────────
  const runSearch = useCallback(async (rawTerm, rawScope) => {
    const t = String(rawTerm ?? term).trim()
    const s = rawScope ?? scope
    setSearchError('')
    if (!t) { requestVersion.current += 1; setSearching(false); setResults(null); setRanTerm(''); return null }
    const version = ++requestVersion.current
    setSearching(true)
    try {
      const out = await runGlobalSearch({ term: t, entity: s, country: activeCountry, limitPer: 25 })
      if (version !== requestVersion.current) return null
      setResults(out); setRanTerm(t); setRanScope(s)
      return out
    } catch (err) {
      if (version !== requestVersion.current) return null
      setSearchError(toUserMessage(err, 'Search failed.'))
      setResults(null)
      return null
    } finally {
      if (version === requestVersion.current) setSearching(false)
    }
  }, [term, scope, activeCountry])

  const onSubmitSearch = (e) => { e?.preventDefault?.(); runSearch(term, scope) }
  const clearSearch = () => { requestVersion.current += 1; setSearching(false); setTerm(''); setResults(null); setRanTerm(''); setSearchError('') }

  // Re-run a saved search inside the live builder and stamp its run metadata.
  const rerunSaved = useCallback(async (row) => {
    setTerm(row.query_text || '')
    setScope(row.entity || 'all')
    const out = await runSearch(row.query_text || '', row.entity || 'all')
    if (out && !notProvisioned) {
      try {
        await markSavedSearchRun(row.id, out.complete ? out.totalMatches : null)
        setSaved((prev) => (prev || []).map((r) =>
          r.id === row.id ? { ...r, last_run_at: new Date().toISOString(), result_count: out.complete ? out.totalMatches : null } : r))
        setNowMs(Date.now())
      } catch (err) { setNotice(toUserMessage(err, 'Search results loaded, but run history could not be saved.')) }
    }
  }, [runSearch, notProvisioned])

  const togglePin = useCallback(async (row) => {
    const next = !row.pinned
    setSaved((prev) => (prev || []).map((r) => (r.id === row.id ? { ...r, pinned: next } : r)))
    try {
      await setSavedSearchPinned(row.id, next)
    } catch (err) {
      setSaved((prev) => (prev || []).map((r) => (r.id === row.id ? { ...r, pinned: !next } : r)))
      setNotice(toUserMessage(err, 'Could not update pin.'))
    }
  }, [])

  // ── KPIs ────────────────────────────────────────────────────────────────
  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Saved searches', value: kv(kpi.totalSaved), icon: Bookmark, tone: 'text-[var(--text-primary)]' },
    { label: 'Pinned', value: kv(kpi.pinnedCount), icon: Pin, tone: 'text-amber-400' },
    { label: 'Entities covered', value: kv(kpi.distinctEntities), icon: Layers, tone: 'text-sky-400' },
    {
      label: 'Last recorded matches', value: failed || kpi.lastRecordedMatches == null ? null : kpi.lastRecordedMatches.toLocaleString(),
      icon: Database, tone: 'text-green-400', sub: failed ? null : `${kpi.recordedCount} of ${kpi.totalSaved} searches have a count`,
    },
    { label: 'Never run', value: kv(kpi.neverRun), icon: Play, tone: 'text-violet-400' },
    { label: `Not run in ${STALE_DAYS}+ days`, value: kv(kpi.stale), icon: History, tone: 'text-orange-400' },
  ]

  // ── Export (saved-search library, full filtered set) ────────────────────
  const doExport = async (kind) => {
    const out = savedExportRows(filteredSaved, nowMs)
    const keys = SAVED_EXPORT_COLUMNS.map(([k]) => k)
    const headers = SAVED_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Saved Searches')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Saved Searches', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Dialog ──────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, query_text: term, entity: scope })
    setFormError(''); setShowModal(true)
  }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({ name: r.name || '', entity: r.entity || 'all', query_text: r.query_text || '', notes: r.notes || '' })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.name.trim()) { setFormError('A name is required to save a search.'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        entity: form.entity,
        query_text: form.query_text,
        notes: form.notes,
        result_count: (results?.complete && ranTerm === form.query_text.trim() && ranScope === form.entity) ? results.totalMatches : null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateSavedSearch(editing.id, payload)
      else await createSavedSearch(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the search.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, results, ranTerm, ranScope, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteSavedSearch(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not delete the search.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const summary = useMemo(() => resultSummary(results, GROUP_KEYS), [results])
  const hasRun = results !== null
  const totalResults = summary?.total ?? 0

  const columns = useMemo(() => [
    {
      id: 'pin', header: '', enableSorting: false, size: 60, meta: { export: false },
      cell: ({ row }) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); togglePin(row.original) }}
          className={`${ICON_BTN} ${row.original.pinned ? 'text-amber-400' : 'hover:text-[var(--text-primary)]'}`}
          aria-pressed={!!row.original.pinned}
          aria-label={row.original.pinned ? `Unpin ${row.original.name}` : `Pin ${row.original.name}`}>
          {row.original.pinned ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
      ),
    },
    { id: 'name', header: 'Name', accessorFn: (r) => r.name || '', size: 200, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    {
      id: 'entity', header: 'Entity', accessorFn: (r) => r._entity, size: 130,
      cell: ({ row }) => {
        const meta = ENTITY_META[row.original.entity] || ENTITY_META.all
        const Icon = meta.icon
        return <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><Icon size={13} className={meta.tone} aria-hidden="true" /> {meta.short}</span>
      },
    },
    { id: 'query', header: 'Query', accessorFn: (r) => r.query_text || '', size: 220, cell: ({ getValue }) => <span className="block max-w-[240px] truncate text-[var(--text-secondary)]">{getValue() || 'N/A'}</span> },
    {
      id: 'results', header: 'Last results', accessorFn: (r) => r._results, size: 110, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() == null ? 'Not counted' : Number(getValue()).toLocaleString()}</span>,
    },
    {
      id: 'lastRun', header: 'Last run', accessorFn: (r) => r.last_run_at || '', size: 180,
      cell: ({ row }) => (
        <span className={`whitespace-nowrap ${row.original._runState === 'stale' ? 'text-orange-400' : 'text-[var(--text-secondary)]'}`}>
          {row.original.last_run_at ? fmtDateTime(row.original.last_run_at) : 'Never run'}
          {row.original._runState === 'stale' && <span className="block text-[11px]">{runStateLabel('stale')}</span>}
        </span>
      ),
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 160, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); rerunSaved(row.original) }} className={`${ICON_BTN} hover:text-indigo-400`} aria-label={`Re-run ${row.original.name}`}><Play size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className={`${ICON_BTN} hover:text-[var(--text-primary)]`} aria-label={`Edit ${row.original.name}`}><Pencil size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete ${row.original.name}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [togglePin, rerunSaved, openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advanced Search"
        subtitle="Search assets, tyres, work orders and inspections from one place, then save the queries you run often and re-run them on demand."
        icon={Search}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filteredSaved.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filteredSaved.length}>
              <FileText size={14} /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} /> Save a search
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Saved searches are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Saved-search storage is unavailable. Live search below still works and shows which sources can be reached.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load saved searches.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error} Live search still works.</p>
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px]" disabled={refreshing}>Retry</button>
        </div>
      )}

      {notice && (
        <div className="card border border-amber-500/40 flex items-start justify-between gap-3" role="status">
          <p className="text-sm text-amber-300">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* ── Live global search builder ─────────────────────────────────────── */}
      <section className="card space-y-4" aria-labelledby="global-query-heading">
        <div className="flex flex-wrap items-center gap-2">
          <Zap size={16} className="text-indigo-400" aria-hidden="true" />
          <h2 id="global-query-heading" className="text-sm font-semibold text-[var(--text-primary)]">Global query builder</h2>
          <span className="text-xs text-[var(--text-muted)]">Live search across the fleet core tables</span>
        </div>
        <form onSubmit={onSubmitSearch} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-end" role="search">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search term</span>
            <div className="relative mt-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                className="input pl-9 pr-12 w-full min-h-[44px]"
                placeholder="Asset no, tyre serial, work order, inspection"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              {term && (
                <button type="button" onClick={clearSearch} className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-11 h-11 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Clear search">
                  <X size={15} />
                </button>
              )}
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Scope</span>
            <select className="input w-full mt-1 min-h-[44px]" value={scope} onChange={(e) => setScope(e.target.value)}>
              {ENTITY_ORDER.map((e) => <option key={e} value={e}>{ENTITY_META[e].label}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={searching || !term.trim()}>
              {searching ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
              {searching ? 'Searching...' : 'Search'}
            </button>
            {hasRun && !searching && (
              <button type="button" onClick={openCreate} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned || !term.trim()}>
                <Save size={14} aria-hidden="true" /> Save this
              </button>
            )}
          </div>
        </form>

        {searchError && (
          <div className="flex flex-wrap items-start justify-between gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
            <span className="flex items-start gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {searchError}</span>
            <button type="button" onClick={() => runSearch(term, scope)} className="btn-secondary text-xs min-h-[44px]">Retry</button>
          </div>
        )}

        {summary && summary.failed.length > 0 && (
          <div role="alert" className="text-sm text-amber-400 space-y-1">
            <p>Search is incomplete. Some sources could not be checked:</p>
            {RESULT_GROUPS.filter((g) => results.errors[g.key]).map((g) => <p key={g.key}>{ENTITY_META[g.entity].label}: {results.errors[g.key]}</p>)}
          </div>
        )}

        <div aria-live="polite">
          {searching ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 bg-[var(--input-bg)] rounded-lg animate-pulse" />)}
            </div>
          ) : !hasRun ? (
            <div className="text-center py-8 text-[var(--text-muted)]">
              <Globe size={26} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
              <p className="text-sm">Enter a term and search to query assets, tyres, work orders and inspections at once.</p>
            </div>
          ) : totalResults === 0 && summary.failed.length > 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No results returned from the available sources. The sources that failed may contain matches.</p>
          ) : totalResults === 0 ? (
            <div className="text-center py-8 text-[var(--text-muted)]">
              <Search size={26} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
              <p className="text-sm">No matches for <span className="font-semibold text-[var(--text-primary)]">"{ranTerm}"</span>{ranScope !== 'all' ? ` in ${ENTITY_META[ranScope].label.toLowerCase()}` : ''}.</p>
              <p className="text-xs mt-1">Try a shorter term, widen the scope, or check a different country.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[var(--text-muted)]">{totalResults} shown{summary.matches != null ? ` of ${summary.matches} matches` : ' (total unavailable)'} for</span>
                <span className="font-semibold text-[var(--text-primary)]">"{ranTerm}"</span>
                {summary.perGroup.map((pg) => {
                  if (!pg.shown) return null
                  const g = RESULT_GROUPS.find((x) => x.key === pg.key)
                  const Icon = g.icon
                  return (
                    <span key={pg.key} className="inline-flex items-center gap-1 rounded-full border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-0.5">
                      <Icon size={12} className={g.tone} aria-hidden="true" /> {ENTITY_META[g.entity].short} {pg.shown}{pg.truncated ? '+' : ''}
                    </span>
                  )
                })}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {RESULT_GROUPS.map((g) => {
                  const list = results[g.key] || []
                  if (!list.length) return null
                  const Icon = g.icon
                  const pg = summary.perGroup.find((x) => x.key === g.key)
                  return (
                    <div key={g.key} className="rounded-lg border border-[var(--input-border)] overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--input-border)] bg-[var(--input-bg)]">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon size={15} className={g.tone} aria-hidden="true" />
                          <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {ENTITY_META[g.entity].label}{pg?.truncated ? `, showing ${list.length} of ${pg.count ?? 'more'} matches` : ''}
                          </h3>
                        </div>
                        <span className="text-xs text-[var(--text-muted)] shrink-0">{list.length}{pg?.truncated ? '+' : ''}</span>
                      </div>
                      <ul className="divide-y divide-[var(--input-border)] max-h-72 overflow-y-auto">
                        {list.map((r) => (
                          <li key={r.id} className="px-3 py-2">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{g.title(r)}</p>
                            <p className="text-xs text-[var(--text-muted)] truncate">{g.sub(r)}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {g.tags(r).map((tg, i) => (
                                <span key={i} className="text-[10px] rounded bg-[var(--input-bg)] text-[var(--text-secondary)] px-1.5 py-0.5">{tg}</span>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── KPI tiles (saved-search library) ───────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      {/* Entity coverage chips */}
      {!failed && entityGroups.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Layers size={15} aria-hidden="true" /> Coverage by entity</h2>
          <div className="flex flex-wrap gap-2">
            {entityGroups.map((g) => {
              const meta = ENTITY_META[g.entity] || ENTITY_META.all
              const Icon = meta.icon
              const active = filters.entity === g.entity
              return (
                <button
                  type="button"
                  key={g.entity}
                  onClick={() => setFilter('entity', active ? '' : g.entity)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 min-h-[44px] text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${active ? 'border-[var(--accent)] bg-[var(--input-bg)] text-[var(--text-primary)]' : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  <Icon size={14} className={meta.tone} aria-hidden="true" /> {meta.short}
                  <span className="text-xs text-[var(--text-muted)]">{g.count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Library filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,2fr)_1fr_1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Filter the library</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Name, query, notes" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Entity</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.entity} onChange={(e) => setFilter('entity', e.target.value)}>
              <option value="">All entities</option>
              {ENTITY_ORDER.filter((e) => e !== 'all').map((e) => <option key={e} value={e}>{ENTITY_META[e].label}</option>)}
              <option value="all">All-entity searches</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Run history</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.runState} onChange={(e) => setFilter('runState', e.target.value)}>
              <option value="">Any</option>
              <option value="recent">Run in the last {STALE_DAYS} days</option>
              <option value="stale">Not run in {STALE_DAYS}+ days</option>
              <option value="never">Never run</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFilter('pinnedOnly', !filters.pinnedOnly)}
            aria-pressed={filters.pinnedOnly}
            className={`text-sm inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-lg border ${filters.pinnedOnly ? 'bg-brand-subtle text-brand-bright border-[var(--accent)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            <Pin size={14} aria-hidden="true" /> Pinned only
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">{filteredSaved.length} of {kpi.totalSaved} saved searches. Pinned first, then most recently run.</span>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_LIBRARY_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear filters</button>
          )}
        </div>
      </div>

      {/* Saved-search library */}
      <section aria-labelledby="library-heading" className="space-y-2">
        <h2 id="library-heading" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Bookmark size={15} className="text-[var(--text-muted)]" aria-hidden="true" /> Saved search library
        </h2>
        <EnterpriseTable
          columns={columns}
          data={tableRows}
          getRowId={(r) => String(r.id)}
          loading={loading}
          error={failed ? error : null}
          onRetry={load}
          enableGlobalFilter={false}
          enableExport={false}
          initialPageSize={25}
          viewKey="advanced-search-library"
          emptyMessage={
            notProvisioned ? 'Enable saved searches to build a reusable library.'
              : all.length === 0 ? 'No saved searches yet. Run a search above and save it.'
                : 'No saved searches match these filters.'
          }
        />
      </section>

      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit saved search' : 'Save a search'} size="md">
        <form onSubmit={submit} className="space-y-4">
          <label className="block"><span className="label">Name</span>
            <input className="input w-full" required placeholder="e.g. Critical steer tyres" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Entity scope</span>
              <select className="input w-full" value={form.entity} onChange={(e) => set('entity', e.target.value)}>
                {ENTITY_ORDER.map((e) => <option key={e} value={e}>{ENTITY_META[e].label}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Query term</span>
              <input className="input w-full" placeholder="e.g. TRK-1042" value={form.query_text} maxLength={2000} onChange={(e) => set('query_text', e.target.value)} />
            </label>
          </div>
          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. weekly review of high-risk tyres" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </label>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Save search'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this saved search?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            "{confirmDelete.name}" ({ENTITY_META[confirmDelete.entity]?.short || confirmDelete.entity}). This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
