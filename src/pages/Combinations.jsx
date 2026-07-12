/**
 * Combinations (route /combinations) — Combination Manager. Records the
 * operational unit fleets dispatch: a prime-mover asset linked to one or more
 * trailer assets, under a named, status-tracked combination. Full CRUD on the
 * new `asset_combinations` table (V141) with KPI tiles, filters, search,
 * Excel/PDF export and loading / empty / error states.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Combine, Truck, Link2, Boxes, Search, X, Filter, Plus, Pencil, Trash2,
  FileSpreadsheet, FileText, AlertTriangle, Database,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCombinations, createCombination, updateCombination, deleteCombination,
  COMBINATION_STATUSES,
} from '../lib/api/combinations'
import { parseTrailerList, summarizeCombinations } from '../lib/combinations'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_STYLES = {
  active: 'bg-green-900/40 text-green-300 border border-green-700/50',
  inactive: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

const EMPTY_FORM = { name: '', prime_mover_no: '', trailer_nos: '', site: '', status: 'active', notes: '' }

export default function Combinations() {
  const { activeCountry } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

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

  // ── Export ────────────────────────────────────────────────────────────────
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
        }
      />

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
