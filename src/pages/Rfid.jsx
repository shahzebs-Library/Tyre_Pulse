/**
 * Rfid (route /rfid) — RFID Registry. Register passive/RAIN RFID tags, map them
 * to tyres (by serial) and assets, and resolve a scanned tag to its mapping.
 * Ported (structure/logic) from tyre_saas RFIDPage and wired to Tyre Pulse's
 * service layer + `rfid_tags` table. Real data, KPI tiles, scan lookup, create/
 * edit modal, filters, search, export and loading/empty/error states throughout.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Radio, Plus, Search, X, Filter, ScanLine, RefreshCw, AlertTriangle,
  CheckCircle2, Link2, Trash2, Pencil, FileSpreadsheet, FileText, Tag, Boxes,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listTags, createTag, updateTag, deleteTag, findByTag } from '../lib/api/rfid'
import { summarizeTags, normalizeTagId, RFID_STATUSES, RFID_STATUS_META } from '../lib/rfid'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_STYLES = {
  active: 'bg-green-900/40 text-green-300 border border-green-700/50',
  unassigned: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  retired: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
const EMPTY = { tag_id: '', tyre_serial: '', asset_no: '', site: '', status: 'active', notes: '' }

function TagModal({ open, initial, onClose, onSaved, country }) {
  const editing = Boolean(initial?.id)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(initial?.id
      ? {
          tag_id: initial.tag_id || '', tyre_serial: initial.tyre_serial || '',
          asset_no: initial.asset_no || '', site: initial.site || '',
          status: RFID_STATUSES.includes(initial.status) ? initial.status : 'active',
          notes: initial.notes || '',
        }
      : EMPTY)
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!normalizeTagId(form.tag_id)) { setError('A tag ID is required.'); return }
    setBusy(true)
    try {
      if (editing) await updateTag(initial.id, form)
      else await createTag({ ...form, country: country && country !== 'All' ? country : null })
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Could not save the tag.')
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, onSaved, onClose, country])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="card w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Tag size={18} className="text-[var(--brand-bright)]" /> {editing ? 'Edit tag' : 'Register RFID tag'}
          </h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div>
          <label className="label">Tag ID (EPC / UID)</label>
          <input
            className="input w-full font-mono"
            placeholder="E2003412B802A001…"
            value={form.tag_id}
            maxLength={128}
            onChange={(e) => set('tag_id', e.target.value)}
            autoFocus
          />
          <p className="text-[11px] text-[var(--text-muted)] mt-1">Normalised to upper-case with spaces removed.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Tyre serial</label>
            <input className="input w-full font-mono" placeholder="Optional" value={form.tyre_serial} maxLength={128} onChange={(e) => set('tyre_serial', e.target.value)} />
          </div>
          <div>
            <label className="label">Asset no</label>
            <input className="input w-full" placeholder="Optional" value={form.asset_no} maxLength={128} onChange={(e) => set('asset_no', e.target.value)} />
          </div>
          <div>
            <label className="label">Site</label>
            <input className="input w-full" placeholder="Optional" value={form.site} maxLength={128} onChange={(e) => set('site', e.target.value)} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {RFID_STATUSES.map((s) => <option key={s} value={s}>{RFID_STATUS_META[s]?.label || s}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input w-full min-h-[80px] resize-y" placeholder="Optional" value={form.notes} maxLength={2000} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {busy ? 'Saving…' : (editing ? 'Save changes' : 'Register tag')}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </form>
    </div>
  )
}

// ─── Scan / lookup panel ──────────────────────────────────────────────────────
function ScanPanel({ country, onEdit }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(undefined) // undefined = idle, null = not found, row = found
  const [error, setError] = useState('')

  const lookup = useCallback(async (e) => {
    e?.preventDefault?.()
    const normalized = normalizeTagId(value)
    if (!normalized) { setResult(undefined); return }
    setBusy(true); setError('')
    try {
      const row = await findByTag(normalized, { country: country && country !== 'All' ? country : undefined })
      setResult(row || null)
    } catch (err) {
      setError(err?.message || 'Lookup failed.')
      setResult(undefined)
    } finally {
      setBusy(false)
    }
  }, [value, country])

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <ScanLine size={16} className="text-[var(--brand-bright)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Scan / lookup tag</h3>
      </div>
      <form onSubmit={lookup} className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Radio size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            className="input pl-9 w-full font-mono"
            placeholder="Scan or type a tag ID…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <button type="submit" disabled={busy || !value.trim()} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Look up
        </button>
        {(result !== undefined || value) && (
          <button type="button" onClick={() => { setValue(''); setResult(undefined); setError('') }} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>
        )}
      </form>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {result === null && (
        <div className="flex items-center gap-2 text-sm text-amber-300 bg-amber-900/20 border border-amber-800/50 rounded-lg px-3 py-2">
          <AlertTriangle size={15} className="shrink-0" /> No tag registered for “{normalizeTagId(value)}”.
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-[var(--brand-bright)]/30 bg-[var(--brand-subtle)]/30 px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <CheckCircle2 size={15} className="text-green-400" /> {result.tag_id}
            </p>
            <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[result.status] || STATUS_STYLES.retired}`}>
              {RFID_STATUS_META[result.status]?.label || result.status}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-[var(--text-secondary)]">
            <div><span className="text-[var(--text-muted)]">Tyre serial</span><br />{result.tyre_serial || '—'}</div>
            <div><span className="text-[var(--text-muted)]">Asset</span><br />{result.asset_no || '—'}</div>
            <div><span className="text-[var(--text-muted)]">Site</span><br />{result.site || '—'}</div>
            <div><span className="text-[var(--text-muted)]">Last scanned</span><br />{fmtDateTime(result.last_scanned_at)}</div>
          </div>
          <button type="button" onClick={() => onEdit?.(result)} className="btn-secondary text-xs inline-flex items-center gap-1.5 mt-1"><Pencil size={12} /> Open in editor</button>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Rfid() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listTags({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load RFID tags.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeTags(rows || []), [rows])
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
        const hay = `${r.tag_id || ''} ${r.tyre_serial || ''} ${r.asset_no || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, siteFilter, search])

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (row) => { setEditing(row); setModalOpen(true) }

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTag(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the tag.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter('all'); setSiteFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || siteFilter || search

  const EXPORT_COLS = ['tag_id', 'tyre_serial', 'asset_no', 'site', 'status', 'last_scanned_at', 'created_at']
  const EXPORT_HEADERS = ['Tag ID', 'Tyre serial', 'Asset', 'Site', 'Status', 'Last scanned', 'Registered']
  const exportRows = filtered.map((r) => ({
    tag_id: r.tag_id || '', tyre_serial: r.tyre_serial || '', asset_no: r.asset_no || '',
    site: r.site || '', status: RFID_STATUS_META[r.status]?.label || r.status || '',
    last_scanned_at: r.last_scanned_at || '', created_at: r.created_at || '',
  }))

  const kpis = [
    { label: 'Total tags', value: summary.total, icon: Radio, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.byStatus.active, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Unassigned', value: summary.unassigned, icon: Link2, tone: 'text-amber-400' },
    { label: 'Assets covered', value: summary.assets, icon: Boxes, tone: 'text-[var(--brand-bright)]' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFID Registry"
        subtitle="Register RFID tags, map them to tyres and assets, and resolve scans to their mapping."
        icon={Radio}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'rfid_tags')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'RFID Registry', 'rfid_tags', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={missing}>
              <Plus size={14} /> Register tag
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The RFID Registry isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V132_RFID_TAGS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load RFID tags.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Scan / lookup */}
      {!missing && <ScanPanel country={activeCountry} onEdit={openEdit} />}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search tag, serial, asset, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {RFID_STATUSES.map((s) => <option key={s} value={s}>{RFID_STATUS_META[s]?.label || s}</option>)}
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
                {['Tag ID', 'Tyre serial', 'Asset', 'Site', 'Status', 'Last scanned', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    {summary.total === 0 ? (
                      <><Radio size={22} className="mx-auto mb-2 opacity-60" />No RFID tags registered yet.
                        {!missing && <div className="mt-3"><button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={14} /> Register the first tag</button></div>}
                      </>
                    ) : (
                      <><Filter size={22} className="mx-auto mb-2 opacity-60" />No tags match these filters.</>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.tag_id}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">
                      {r.tyre_serial ? <span className="inline-flex items-center gap-1"><Link2 size={12} className="text-[var(--text-muted)]" />{r.tyre_serial}</span> : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      {r.asset_no ? <span className="inline-flex items-center gap-1"><Boxes size={12} className="text-[var(--text-muted)]" />{r.asset_no}</span> : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || STATUS_STYLES.retired}`}>{RFID_STATUS_META[r.status]?.label || r.status}</span></td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.last_scanned_at)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      <TagModal
        open={modalOpen}
        initial={editing}
        country={activeCountry}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-[var(--text-primary)]">
              <Trash2 size={18} className="text-red-400" /><h2 className="text-lg font-bold">Delete tag?</h2>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              This permanently removes tag <span className="font-mono text-[var(--text-primary)]">{confirmDelete.tag_id}</span> from the registry. This cannot be undone.
            </p>
            <div className="flex items-center gap-3">
              <button onClick={doDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-500 border-red-600 inline-flex items-center gap-2 disabled:opacity-60">
                {deleting ? <RefreshCw size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
              </button>
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
