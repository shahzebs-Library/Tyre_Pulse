/**
 * AdvancedSearch (route /advanced-search) — Advanced / Global Search. A single
 * command surface that (a) runs *live* cross-entity searches across the fleet's
 * core operational tables — assets (vehicle_fleet), tyres (tyre_records), work
 * orders, and inspections — and (b) lets operators persist named searches they
 * re-run on demand.
 *
 * Runs on the new `saved_searches` table (V198) for the saved-search library,
 * and queries the live operational tables through the service for the query
 * builder. Real data, KPI tiles, grouped live results, saved-search library
 * with pin/re-run, create/edit modal, Excel/PDF export, and loading/empty/error
 * states throughout. Pure roll-ups live in `src/lib/advancedSearch.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2, Pin,
  PinOff, Play, Bookmark, Layers, Database, AlertTriangle, Truck, Package,
  ClipboardCheck, Wrench, Globe, RefreshCw, Save, Zap,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listSavedSearches, createSavedSearch, updateSavedSearch, deleteSavedSearch,
  setSavedSearchPinned, markSavedSearchRun, runGlobalSearch,
} from '../lib/api/advancedSearch'
import { summariseSearches, groupByEntity } from '../lib/advancedSearch'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

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
    sub: (r) => [r.make, r.model].filter(Boolean).join(' ') || r.vehicle_type || '—',
    tags: (r) => [r.site, r.status].filter(Boolean),
  },
  {
    key: 'tyres', entity: 'tyres', icon: Package, tone: 'text-amber-400',
    title: (r) => r.serial_no || 'Tyre',
    sub: (r) => [r.brand, r.size].filter(Boolean).join(' · ') || '—',
    tags: (r) => [r.asset_no, r.position, r.risk_level].filter(Boolean),
  },
  {
    key: 'workOrders', entity: 'work_orders', icon: Wrench, tone: 'text-violet-400',
    title: (r) => r.work_order_no || 'Work order',
    sub: (r) => [r.work_type, r.workshop_name].filter(Boolean).join(' · ') || '—',
    tags: (r) => [r.asset_no, r.status, r.priority].filter(Boolean),
  },
  {
    key: 'inspections', entity: 'inspections', icon: ClipboardCheck, tone: 'text-green-400',
    title: (r) => r.title || 'Inspection',
    sub: (r) => [r.inspection_type, r.inspector].filter(Boolean).join(' · ') || '—',
    tags: (r) => [r.asset_no, r.status, r.severity].filter(Boolean),
  },
]

const EMPTY_FORM = { name: '', entity: 'all', query_text: '', notes: '' }

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function AdvancedSearch() {
  const { activeCountry } = useSettings()

  // ── Saved-search library state ──────────────────────────────────────────
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [entityFilter, setEntityFilter] = useState('')
  const [librarySearch, setLibrarySearch] = useState('')

  // ── Live query-builder state ────────────────────────────────────────────
  const [term, setTerm] = useState('')
  const [scope, setScope] = useState('all')
  const [results, setResults] = useState(null) // null = never run
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [ranTerm, setRanTerm] = useState('')

  // ── Modal state ─────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listSavedSearches({ country: activeCountry })
      setSaved(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load saved searches.'))
      setSaved([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseSearches(saved || []), [saved])
  const entityGroups = useMemo(() => groupByEntity(saved || []), [saved])

  const filteredSaved = useMemo(() => {
    const q = librarySearch.trim().toLowerCase()
    return (saved || []).filter((r) => {
      if (entityFilter && r.entity !== entityFilter) return false
      if (q) {
        const hay = `${r.name || ''} ${r.query_text || ''} ${r.notes || ''} ${r.entity || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [saved, entityFilter, librarySearch])

  // ── Live global search ──────────────────────────────────────────────────
  const runSearch = useCallback(async (rawTerm, rawScope) => {
    const t = String(rawTerm ?? term).trim()
    const s = rawScope ?? scope
    setSearchError('')
    if (!t) { setResults(null); setRanTerm(''); return null }
    setSearching(true)
    try {
      const out = await runGlobalSearch({ term: t, entity: s, country: activeCountry, limitPer: 25 })
      setResults(out); setRanTerm(t)
      return out
    } catch (err) {
      setSearchError(toUserMessage(err, 'Search failed.'))
      setResults({ assets: [], tyres: [], workOrders: [], inspections: [], total: 0 })
      return null
    } finally {
      setSearching(false)
    }
  }, [term, scope, activeCountry])

  const onSubmitSearch = (e) => { e?.preventDefault?.(); runSearch(term, scope) }
  const clearSearch = () => { setTerm(''); setResults(null); setRanTerm(''); setSearchError('') }

  // Re-run a saved search inside the live builder and stamp its run metadata.
  const rerunSaved = useCallback(async (row) => {
    setTerm(row.query_text || '')
    setScope(row.entity || 'all')
    const out = await runSearch(row.query_text || '', row.entity || 'all')
    if (out && !notProvisioned) {
      try {
        await markSavedSearchRun(row.id, out.total)
        setSaved((prev) => (prev || []).map((r) =>
          r.id === row.id ? { ...r, last_run_at: new Date().toISOString(), result_count: out.total } : r))
      } catch { /* non-fatal: run still succeeded */ }
    }
  }, [runSearch, notProvisioned])

  const togglePin = useCallback(async (row) => {
    const next = !row.pinned
    setSaved((prev) => (prev || []).map((r) => r.id === row.id ? { ...r, pinned: next } : r))
    try {
      await setSavedSearchPinned(row.id, next)
    } catch (err) {
      setSaved((prev) => (prev || []).map((r) => r.id === row.id ? { ...r, pinned: !next } : r))
      setError(toUserMessage(err, 'Could not update pin.'))
    }
  }, [])

  // ── KPIs ────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Saved searches', value: summary.totalSaved, icon: Bookmark, tone: 'text-[var(--text-primary)]' },
    { label: 'Pinned', value: summary.pinnedCount, icon: Pin, tone: 'text-amber-400' },
    { label: 'Entities covered', value: summary.distinctEntities, icon: Layers, tone: 'text-sky-400' },
    { label: 'Results indexed', value: summary.totalResultsIndexed.toLocaleString(), icon: Database, tone: 'text-green-400' },
  ]

  // ── Export (saved-search library) ───────────────────────────────────────
  const EXPORT_COLS = ['name', 'entity', 'query_text', 'result_count', 'pinned', 'last_run_at', 'notes']
  const EXPORT_HEADERS = ['Name', 'Entity', 'Query', 'Last results', 'Pinned', 'Last run', 'Notes']
  const exportRows = filteredSaved.map((r) => ({
    name: r.name || '', entity: ENTITY_META[r.entity]?.short || r.entity || 'all',
    query_text: r.query_text || '', result_count: r.result_count ?? '',
    pinned: r.pinned ? 'Yes' : 'No', last_run_at: r.last_run_at ? fmtDateTime(r.last_run_at) : '',
    notes: r.notes || '',
  }))

  // ── Modal ───────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, query_text: term, entity: scope })
    setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({ name: r.name || '', entity: r.entity || 'all', query_text: r.query_text || '', notes: r.notes || '' })
    setFormError(''); setShowModal(true)
  }
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
        result_count: (results && ranTerm && ranTerm === form.query_text.trim()) ? results.total : undefined,
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
  }, [form, editing, activeCountry, results, ranTerm, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteSavedSearch(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the search.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setEntityFilter(''); setLibrarySearch('') }
  const hasFilters = entityFilter || librarySearch

  const totalResults = results?.total ?? 0
  const hasRun = results !== null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advanced Search"
        subtitle="Search assets, tyres, work orders and inspections from one place — then save the queries you run often and re-run them on demand."
        icon={Search}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'saved_searches') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filteredSaved.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Saved Searches', 'saved_searches', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filteredSaved.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Save a search
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Saved searches aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V198_SAVED_SEARCHES.sql</span>, then reload. Live search still works below.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Something went wrong.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* ── Live global search builder ─────────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-indigo-400" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Global query builder</h3>
          <span className="text-xs text-[var(--text-muted)]">Live search across the fleet’s core tables</span>
        </div>
        <form onSubmit={onSubmitSearch} className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              className="input pl-9 w-full"
              placeholder="Search asset no, tyre serial, work order, inspection…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            {term && (
              <button type="button" onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Clear">
                <X size={15} />
              </button>
            )}
          </div>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope">
            {ENTITY_ORDER.map((e) => <option key={e} value={e}>{ENTITY_META[e].label}</option>)}
          </select>
          <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={searching || !term.trim()}>
            {searching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            {searching ? 'Searching…' : 'Search'}
          </button>
          {hasRun && !searching && (
            <button type="button" onClick={openCreate} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned || !term.trim()}>
              <Save size={14} /> Save this
            </button>
          )}
        </form>

        {/* Live results / states */}
        {searchError && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {searchError}
          </div>
        )}

        {searching ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 bg-[var(--input-bg)] rounded-lg animate-pulse" />)}
          </div>
        ) : !hasRun ? (
          <div className="text-center py-8 text-[var(--text-muted)]">
            <Globe size={26} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm">Enter a term and search to query assets, tyres, work orders and inspections at once.</p>
          </div>
        ) : totalResults === 0 ? (
          <div className="text-center py-8 text-[var(--text-muted)]">
            <Search size={26} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm">No matches for <span className="font-semibold text-[var(--text-primary)]">“{ranTerm}”</span>{scope !== 'all' ? ` in ${ENTITY_META[scope].label.toLowerCase()}` : ''}.</p>
            <p className="text-xs mt-1">Try a shorter term, widen the scope, or check a different country.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--text-muted)]">{totalResults} match{totalResults === 1 ? '' : 'es'} for</span>
              <span className="font-semibold text-[var(--text-primary)]">“{ranTerm}”</span>
              {RESULT_GROUPS.map((g) => {
                const n = results[g.key]?.length || 0
                if (!n) return null
                const Icon = g.icon
                return (
                  <span key={g.key} className="inline-flex items-center gap-1 rounded-full border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-2 py-0.5">
                    <Icon size={12} className={g.tone} /> {ENTITY_META[g.entity].short} {n}
                  </span>
                )
              })}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {RESULT_GROUPS.map((g) => {
                const list = results[g.key] || []
                if (!list.length) return null
                const Icon = g.icon
                return (
                  <div key={g.key} className="rounded-lg border border-[var(--input-border)] overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--input-border)] bg-[var(--input-bg)]/40">
                      <div className="flex items-center gap-2">
                        <Icon size={15} className={g.tone} />
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{ENTITY_META[g.entity].label}</span>
                      </div>
                      <span className="text-xs text-[var(--text-muted)]">{list.length}{list.length >= 25 ? '+' : ''}</span>
                    </div>
                    <div className="divide-y divide-[var(--input-border)]/50 max-h-72 overflow-y-auto">
                      {list.map((r) => (
                        <div key={r.id} className="px-3 py-2 hover:bg-[var(--input-bg)]/40">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{g.title(r)}</p>
                          </div>
                          <p className="text-xs text-[var(--text-muted)] truncate">{g.sub(r)}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {g.tags(r).map((t, i) => (
                              <span key={i} className="text-[10px] rounded bg-[var(--input-bg)] text-[var(--text-secondary)] px-1.5 py-0.5">{t}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── KPI tiles (saved-search library) ───────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{saved === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Entity coverage chips */}
      {entityGroups.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Layers size={15} /> Coverage by entity</h3>
          <div className="flex flex-wrap gap-2">
            {entityGroups.map((g) => {
              const meta = ENTITY_META[g.entity] || ENTITY_META.all
              const Icon = meta.icon
              const active = entityFilter === g.entity
              return (
                <button
                  key={g.entity}
                  onClick={() => setEntityFilter(active ? '' : g.entity)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${active ? 'border-indigo-500 bg-indigo-500/10 text-[var(--text-primary)]' : 'border-[var(--input-border)] bg-[var(--input-bg)]/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  <Icon size={14} className={meta.tone} /> {meta.short}
                  <span className="text-xs text-[var(--text-muted)]">{g.count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Library filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Filter saved searches by name, query, notes…" value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} />
          </div>
          <select className="input" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} aria-label="Entity">
            <option value="">All entities</option>
            {ENTITY_ORDER.filter((e) => e !== 'all').map((e) => <option key={e} value={e}>{ENTITY_META[e].label}</option>)}
            <option value="all">All-entity searches</option>
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filteredSaved.length} of {summary.totalSaved}</span>
        </div>
      </div>

      {/* Saved-search library */}
      <div className="card overflow-hidden !p-0">
        <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
          <Bookmark size={15} className="text-[var(--text-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Saved search library</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['', 'Name', 'Entity', 'Query', 'Last results', 'Last run', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {saved === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filteredSaved.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {(saved.length === 0 && !notProvisioned) ? 'No saved searches yet — run a search above and save it.' : notProvisioned ? 'Enable saved searches to build a reusable library.' : 'No saved searches match these filters.'}
                </td></tr>
              ) : (
                filteredSaved.map((r) => {
                  const meta = ENTITY_META[r.entity] || ENTITY_META.all
                  const Icon = meta.icon
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5">
                        <button onClick={() => togglePin(r)} className={`p-1 rounded ${r.pinned ? 'text-amber-400' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`} aria-label={r.pinned ? 'Unpin' : 'Pin'}>
                          {r.pinned ? <Pin size={15} /> : <PinOff size={15} />}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.name}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                          <Icon size={13} className={meta.tone} /> {meta.short}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[240px] truncate">{r.query_text || <span className="text-[var(--text-muted)]">—</span>}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.result_count == null ? '—' : Number(r.result_count).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.last_run_at)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => rerunSaved(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-indigo-400" aria-label="Re-run" title="Re-run search"><Play size={14} /></button>
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit saved search' : 'Save a search'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label">Name</label>
                <input className="input w-full" placeholder="e.g. Critical steer tyres" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Entity scope</label>
                  <select className="input w-full" value={form.entity} onChange={(e) => set('entity', e.target.value)}>
                    {ENTITY_ORDER.map((e) => <option key={e} value={e}>{ENTITY_META[e].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Query term</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.query_text} maxLength={2000} onChange={(e) => set('query_text', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. weekly review of high-risk tyres" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Save search'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this saved search?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  “{confirmDelete.name}” · {ENTITY_META[confirmDelete.entity]?.short || confirmDelete.entity}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
