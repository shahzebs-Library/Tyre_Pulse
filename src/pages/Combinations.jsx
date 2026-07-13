/**
 * Combinations (route /combinations) — Combination Manager + combined-unit tyre
 * intelligence. Two tabs:
 *   • Registry: full CRUD on the `asset_combinations` table (V141) — the
 *     operational units fleets dispatch (a prime-mover asset linked to one or
 *     more trailers) — with KPI tiles, filters, search, Excel/PDF export.
 *   • Unit intelligence: pick a combination and see its resolved member assets
 *     (with data-quality warnings for unresolved ones), blended combined-unit
 *     KPIs (fitted tyres, unit CPK, unit spend, scrap), a position-class
 *     breakdown, and an honest note that live per-tyre pressure/temperature and
 *     the axle schematic need telemetry / wheel-position data this dataset does
 *     not capture (no fabricated gauges).
 *
 * All tyre maths reuse the canonical calc services (kpiEngine/tco via
 * src/lib/combinations.js) — no second CPK engine.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Combine, Truck, Link2, Boxes, Search, X, Filter, Plus, Pencil, Trash2,
  FileSpreadsheet, FileText, AlertTriangle, Database, Network, Gauge,
  DollarSign, Recycle, CircleDot, CheckCircle2, XCircle, Info, Activity, Layers,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCombinations, createCombination, updateCombination, deleteCombination,
  getCombinationIntelligence, COMBINATION_STATUSES,
} from '../lib/api/combinations'
import {
  parseTrailerList, summarizeCombinations, computeCombinationRollup,
  detectDuplicateTrailers,
} from '../lib/combinations'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrency, fmt } from '../lib/formatters'

const STATUS_STYLES = {
  active: 'bg-green-900/40 text-green-300 border border-green-700/50',
  inactive: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

const POSITION_LABELS = {
  steer: 'Steer', drive: 'Drive', trailer: 'Trailer', other: 'Other / Unclassified',
}

const EMPTY_FORM = { name: '', prime_mover_no: '', trailer_nos: '', site: '', status: 'active', notes: '' }

export default function Combinations() {
  const { activeCountry, activeCurrency } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [view, setView] = useState('registry')

  const [statusFilter, setStatusFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Unit-intelligence state
  const [selectedId, setSelectedId] = useState('')
  const [intel, setIntel] = useState(null) // { vehicles, tyres }
  const [intelLoading, setIntelLoading] = useState(false)
  const [intelError, setIntelError] = useState('')

  const currency = activeCurrency || 'SAR'

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listCombinations({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Could not load combinations.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeCombinations(rows || []), [rows])
  const duplicateTrailers = useMemo(() => detectDuplicateTrailers(rows || []), [rows])

  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (q) {
        const hay = `${r.name || ''} ${r.prime_mover_no || ''} ${(parseTrailerList(r.trailer_nos)).join(' ')} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, siteFilter, search])

  const clearFilters = () => { setStatusFilter('all'); setSiteFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || siteFilter || search

  // ── Selected combination + rollup (Unit intelligence) ───────────────────────
  const selectedCombo = useMemo(
    () => (rows || []).find((r) => String(r.id) === String(selectedId)) || null,
    [rows, selectedId],
  )

  // Default the selector to the first combination once data lands.
  useEffect(() => {
    if (!selectedId && rows && rows.length) setSelectedId(String(rows[0].id))
  }, [rows, selectedId])

  const loadIntel = useCallback(async (combo) => {
    if (!combo) { setIntel(null); return }
    setIntelLoading(true); setIntelError('')
    try {
      const data = await getCombinationIntelligence(combo, { country: activeCountry })
      setIntel(data)
    } catch (err) {
      setIntelError(err?.message || 'Could not load combined-unit data.')
      setIntel(null)
    } finally {
      setIntelLoading(false)
    }
  }, [activeCountry])

  useEffect(() => {
    if (view === 'intelligence' && selectedCombo) loadIntel(selectedCombo)
  }, [view, selectedCombo, loadIntel])

  const rollup = useMemo(() => {
    if (!selectedCombo || !intel) return null
    return computeCombinationRollup(selectedCombo, intel.tyres, intel.vehicles)
  }, [selectedCombo, intel])

  // ── Export (Registry) ───────────────────────────────────────────────────────
  const EXPORT_COLS = ['name', 'prime_mover_no', 'trailers', 'site', 'status', 'notes']
  const EXPORT_HEADERS = ['Name', 'Prime Mover', 'Trailers', 'Site', 'Status', 'Notes']
  const exportRows = filtered.map((r) => ({
    name: r.name || '',
    prime_mover_no: r.prime_mover_no || '',
    trailers: parseTrailerList(r.trailer_nos).join(', '),
    site: r.site || '',
    status: r.status || '',
    notes: r.notes || '',
  }))

  // ── Modal ─────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      name: r.name || '',
      prime_mover_no: r.prime_mover_no || '',
      trailer_nos: parseTrailerList(r.trailer_nos).join(', '),
      site: r.site || '',
      status: r.status || 'active',
      notes: r.notes || '',
    })
    setFormError('')
    setModalOpen(true)
  }
  const closeModal = () => { if (!saving) { setModalOpen(false); setEditing(null) } }

  const submitForm = async (e) => {
    e.preventDefault()
    setSaving(true); setFormError('')
    try {
      const payload = {
        name: form.name,
        prime_mover_no: form.prime_mover_no,
        trailer_nos: form.trailer_nos,
        site: form.site,
        status: form.status,
        notes: form.notes,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateCombination(editing.id, payload)
      else await createCombination(payload)
      setModalOpen(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save combination.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteCombination(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete combination.')
    } finally {
      setDeleting(false)
    }
  }

  const kpis = [
    { label: 'Combinations', value: summary.total, icon: Combine, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.active, icon: Truck, tone: 'text-green-400' },
    { label: 'Trailers linked', value: summary.trailers, icon: Link2, tone: 'text-indigo-400' },
    { label: 'Total units', value: summary.units, icon: Boxes, tone: 'text-amber-400' },
  ]

  const TABS = [
    { key: 'registry', label: 'Registry', icon: Boxes },
    { key: 'intelligence', label: 'Unit intelligence', icon: Network },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Combination Manager"
        subtitle="Prime-mover ↔ trailer combinations — the operational units your fleet dispatches."
        icon={Combine}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          view === 'registry' ? (
            <div className="flex items-center gap-2">
              <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'combinations')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
                <FileSpreadsheet size={14} /> Excel
              </button>
              <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Asset Combinations', 'combinations', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
                <FileText size={14} /> PDF
              </button>
              <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
                <Plus size={14} /> New combination
              </button>
            </div>
          ) : null
        }
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-[var(--input-border)]">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = view === t.key
          return (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-brand-bright text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-red-300 font-medium">Couldn't load combinations.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1 break-words">{error}</p>
            <p className="text-[var(--text-muted)] text-xs mt-2 flex items-center gap-1.5">
              <Database size={12} /> If this is a missing-table error, apply <span className="font-mono">MIGRATIONS_V141_ASSET_COMBINATIONS.sql</span>.
            </p>
          </div>
        </div>
      )}

      {/* Duplicate-trailer data-quality warning (both tabs) */}
      {duplicateTrailers.length > 0 && (
        <div className="card border border-amber-700/50 bg-amber-900/10 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-amber-300 font-medium">
              {duplicateTrailers.length} trailer{duplicateTrailers.length !== 1 ? 's' : ''} assigned to more than one active combination.
            </p>
            <p className="text-[var(--text-muted)] text-sm mt-1">A trailer can only be part of one active unit at a time — review these registry entries.</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {duplicateTrailers.map((d) => (
                <span key={d.trailer} className="badge text-[11px] px-2 py-0.5 rounded bg-amber-900/30 text-amber-300 border border-amber-700/50 font-mono">
                  {d.trailer} ×{d.combinations.length}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {view === 'registry' ? (
        <RegistryTab
          rows={rows} filtered={filtered} summary={summary} kpis={kpis}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          siteFilter={siteFilter} setSiteFilter={setSiteFilter}
          search={search} setSearch={setSearch}
          siteOptions={siteOptions} hasFilters={hasFilters} clearFilters={clearFilters}
          openEdit={openEdit} setConfirmDelete={setConfirmDelete}
        />
      ) : (
        <IntelligenceTab
          rows={rows}
          selectedId={selectedId} setSelectedId={setSelectedId}
          selectedCombo={selectedCombo}
          intelLoading={intelLoading} intelError={intelError}
          rollup={rollup} currency={currency}
        />
      )}

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Combine size={18} className="text-brand-bright" />
                {editing ? 'Edit combination' : 'New combination'}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)]"><X size={16} /></button>
            </div>

            <form onSubmit={submitForm} className="space-y-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Name</label>
                <input className="input w-full" placeholder="e.g. Route 12 rig" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Prime mover number <span className="text-red-400">*</span></label>
                <input className="input w-full font-mono" placeholder="e.g. PM-1024" value={form.prime_mover_no} onChange={(e) => setForm((f) => ({ ...f, prime_mover_no: e.target.value }))} required />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Trailer numbers</label>
                <input className="input w-full font-mono" placeholder="Comma-separated, e.g. TR-01, TR-02" value={form.trailer_nos} onChange={(e) => setForm((f) => ({ ...f, trailer_nos: e.target.value }))} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">{parseTrailerList(form.trailer_nos).length} trailer(s)</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Site</label>
                  <input className="input w-full" placeholder="Depot / yard" value={form.site} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                    {COMBINATION_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Notes</label>
                <textarea className="input w-full min-h-[72px]" placeholder="Optional context…" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>

              {formError && (
                <div className="text-sm text-red-300 bg-red-900/30 border border-red-800/50 rounded px-3 py-2 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span className="break-words">{formError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" onClick={closeModal} disabled={saving} className="btn-secondary text-sm">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create combination'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2 mb-2">
              <Trash2 size={18} className="text-red-400" /> Delete combination
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              Delete <span className="font-semibold text-[var(--text-secondary)]">{confirmDelete.name || confirmDelete.prime_mover_no}</span>? This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="btn-secondary text-sm">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="btn-primary text-sm !bg-red-600 hover:!bg-red-700 disabled:opacity-60">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Registry tab ─────────────────────────────────────────────────────────────
function RegistryTab({
  rows, filtered, summary, kpis, statusFilter, setStatusFilter, siteFilter, setSiteFilter,
  search, setSearch, siteOptions, hasFilters, clearFilters, openEdit, setConfirmDelete,
}) {
  return (
    <>
      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search name, prime mover, trailer, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {COMBINATION_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Name', 'Prime Mover', 'Trailers', 'Site', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 ? 'No combinations yet — create your first prime-mover ↔ trailer link.' : 'No combinations match these filters.'}
                </td></tr>
              ) : (
                filtered.map((r) => {
                  const trailers = parseTrailerList(r.trailer_nos)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">{r.name || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.prime_mover_no || '—'}</td>
                      <td className="px-4 py-2.5">
                        {trailers.length ? (
                          <div className="flex flex-wrap gap-1">
                            {trailers.map((t, i) => (
                              <span key={`${t}-${i}`} className="badge text-[11px] px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)] font-mono">{t}</span>
                            ))}
                          </div>
                        ) : <span className="text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || STATUS_STYLES.inactive}`}>{r.status || 'inactive'}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
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
    </>
  )
}

// ── Unit-intelligence tab ────────────────────────────────────────────────────
function IntelligenceTab({
  rows, selectedId, setSelectedId, selectedCombo, intelLoading, intelError, rollup, currency,
}) {
  if (rows === null) {
    return <div className="card"><div className="h-40 bg-[var(--input-bg)] rounded animate-pulse" /></div>
  }
  if (rows.length === 0) {
    return (
      <div className="card py-12 text-center text-[var(--text-muted)]">
        <Network size={26} className="mx-auto mb-2 opacity-60" />
        No combinations yet — create one in the Registry tab to analyse it as a combined unit.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Selector */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-[var(--text-muted)] inline-flex items-center gap-1.5">
            <Combine size={15} className="text-brand-bright" /> Combined unit
          </label>
          <select className="input min-w-[240px]" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} aria-label="Select combination">
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {(r.name || r.prime_mover_no || 'Unnamed')} · {r.prime_mover_no || '—'} ({parseTrailerList(r.trailer_nos).length} trailer{parseTrailerList(r.trailer_nos).length !== 1 ? 's' : ''})
              </option>
            ))}
          </select>
          {selectedCombo && (
            <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[selectedCombo.status] || STATUS_STYLES.inactive}`}>
              {selectedCombo.status || 'inactive'}
            </span>
          )}
          {selectedCombo?.site && <span className="text-xs text-[var(--text-muted)]">Site: {selectedCombo.site}</span>}
        </div>
      </div>

      {intelError && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-red-300 font-medium">Couldn't load combined-unit data.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1 break-words">{intelError}</p>
          </div>
        </div>
      )}

      {intelLoading || !rollup ? (
        !intelError && (
          <div className="grid gap-3">
            <div className="card"><div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" /></div>
            <div className="card"><div className="h-40 bg-[var(--input-bg)] rounded animate-pulse" /></div>
          </div>
        )
      ) : (
        <>
          {/* Combined-unit KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <IntelKpi icon={CircleDot} tone="text-indigo-400" label="Fitted tyres" value={rollup.fittedTyres}
              sub={`${rollup.tyreCount} record${rollup.tyreCount !== 1 ? 's' : ''} across unit`} />
            <IntelKpi icon={Gauge} tone="text-brand-bright" label="Unit CPK (blended)"
              value={rollup.blendedCpk != null ? `${currency} ${fmt(rollup.blendedCpk, 3)}` : '—'}
              sub={rollup.canonicalCpk?.validCount ? `Canonical avg ${currency} ${fmt(rollup.canonicalCpk.fleetAvgCpk, 3)} · ${rollup.canonicalCpk.validCount} valid` : 'No valid cost/km rows'} />
            <IntelKpi icon={DollarSign} tone="text-emerald-400" label="Unit tyre spend"
              value={formatCurrency(rollup.totalSpend, currency, 0)}
              sub={rollup.avgTyreLifeKm != null ? `Avg life ${rollup.avgTyreLifeKm.toLocaleString()} km` : 'No km data'} />
            <IntelKpi icon={Recycle} tone={rollup.scrapTyres > 0 ? 'text-red-400' : 'text-green-400'} label="Scrapped tyres"
              value={rollup.scrapTyres} sub={rollup.fittedTyres + rollup.scrapTyres > 0 ? `${Math.round((rollup.scrapTyres / (rollup.fittedTyres + rollup.scrapTyres)) * 100)}% of fitted+scrap` : 'No scrap recorded'} />
          </div>

          {/* Members */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                <Truck size={15} className="text-brand-bright" /> Member assets
              </h3>
              <span className="text-xs text-[var(--text-muted)]">
                {rollup.resolution.resolvedCount}/{rollup.members.length} resolved in fleet master
              </span>
            </div>

            {rollup.resolution.unresolvedCount > 0 && (
              <div className="mb-3 rounded border border-amber-700/50 bg-amber-900/10 px-3 py-2 text-sm text-amber-300 flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {rollup.resolution.unresolvedCount} member{rollup.resolution.unresolvedCount !== 1 ? 's' : ''} not found in <span className="font-mono">vehicle_fleet</span>:{' '}
                  <span className="font-mono">{rollup.resolution.unresolved.join(', ')}</span>. Add them to fleet master for complete intelligence.
                </span>
              </div>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {rollup.members.map((m) => (
                <div key={`${m.role}-${m.asset_no}`} className={`rounded-lg border p-3 ${m.resolved ? 'border-[var(--input-border)] bg-[var(--input-bg)]/40' : 'border-amber-700/50 bg-amber-900/10'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">{m.asset_no}</span>
                    {m.resolved
                      ? <CheckCircle2 size={15} className="text-green-400" />
                      : <XCircle size={15} className="text-amber-400" />}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] mt-0.5">
                    {m.role === 'prime_mover' ? 'Prime mover' : 'Trailer'}
                  </div>
                  {m.resolved ? (
                    <div className="text-xs text-[var(--text-secondary)] mt-1.5 space-y-0.5">
                      <div>{[m.make, m.model].filter(Boolean).join(' ') || m.vehicle_type || '—'}</div>
                      <div className="text-[var(--text-muted)]">{m.vehicle_type || '—'}{m.status ? ` · ${m.status}` : ''}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-amber-300/80 mt-1.5">Not in fleet master</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Position-class breakdown */}
          <div className="card overflow-hidden !p-0">
            <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-1.5">
              <Layers size={15} className="text-brand-bright" />
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Position-class breakdown</h3>
            </div>
            {rollup.positionBreakdown.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                No tyre records found for this unit's members.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                      <th className="px-4 py-2.5 font-semibold">Position class</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Tyres</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Spend</th>
                      <th className="px-4 py-2.5 font-semibold text-right">CPK (blended)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollup.positionBreakdown.map((p) => (
                      <tr key={p.positionClass} className="border-b border-[var(--input-border)]/50">
                        <td className="px-4 py-2.5 text-[var(--text-primary)]">{POSITION_LABELS[p.positionClass] || p.positionClass}</td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{p.count}</td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{formatCurrency(p.spend, currency, 0)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-[var(--text-secondary)]">{p.cpk != null ? `${currency} ${fmt(p.cpk, 3)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-4 py-2 text-[11px] text-[var(--text-muted)] border-t border-[var(--input-border)]/60">
              Positions that don't parse to steer / drive / trailer are grouped honestly as "Other / Unclassified".
            </p>
          </div>

          {/* Honest telemetry / schematic panel */}
          <div className="card border border-[var(--input-border)] bg-[var(--input-bg)]/30">
            <div className="flex items-start gap-3">
              <Info size={18} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Activity size={14} /> Live telemetry &amp; axle schematic — not available in this dataset
                </h3>
                <p className="text-sm text-[var(--text-muted)] mt-1.5">
                  Per-tyre pressure (PSI), temperature and the top-down axle / wheel-position diagram require
                  live TPMS telemetry and a wheel-position map. This deployment's <span className="font-mono">tyre_records</span> and{' '}
                  <span className="font-mono">vehicle_fleet</span> tables do not capture those signals, so no gauges or
                  schematics are shown here rather than fabricating readings. Connect a TPMS / wheel-position source to enable them.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {['Live PSI', 'Temperature', 'Pressure target', 'Wheel positions', 'Axle schematic'].map((x) => (
                    <span key={x} className="badge text-[11px] px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]">
                      {x} · no source
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function IntelKpi({ icon: Icon, tone, label, value, sub }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} />
      </div>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-1">{sub}</p>}
    </div>
  )
}
