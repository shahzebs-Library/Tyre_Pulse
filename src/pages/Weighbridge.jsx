/**
 * Weighbridge (route /weighbridge) — Weighbridge Tickets / Axle Weight. Captures
 * weighing events per asset: gross / tare / net weight, per-axle loads, and the
 * legal gross limit, then flags overweight vehicles. Overloading is a primary
 * root cause of accelerated tyre wear and casing failure, so this weight history
 * is org-isolated, country-scoped, and feeds tyre-life / CPK analytics.
 *
 * Runs on the new `weighbridge_tickets` table (V177). Real data, KPI tiles, an
 * overweight attention strip, create/edit modal, filters, search, delete
 * confirm, Excel/PDF export, and loading/empty/error states throughout. Weight
 * math and the fleet KPI summary live in the pure `src/lib/weighbridgeTickets.js`
 * helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Scale, Activity, Truck, ShieldAlert, Package, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listWeighbridgeTickets, createWeighbridgeTicket, updateWeighbridgeTicket, deleteWeighbridgeTicket,
} from '../lib/api/weighbridgeTickets'
import { summariseTickets, netWeight, overloadKg, isOverweight } from '../lib/weighbridgeTickets'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const EMPTY_FORM = {
  ticket_no: '', asset_no: '', driver_name: '', site: '', weighed_at: '',
  gross_weight_kg: '', tare_weight_kg: '', net_weight_kg: '', gross_limit_kg: '',
  cargo_type: '', status: '', notes: '',
}

const STATUS_OPTIONS = ['draft', 'recorded', 'overweight', 'disputed', 'cleared']

const STATUS_TONE = {
  draft: 'bg-slate-700/40 text-slate-300',
  recorded: 'bg-sky-900/40 text-sky-300',
  overweight: 'bg-red-900/40 text-red-300',
  disputed: 'bg-amber-900/40 text-amber-300',
  cleared: 'bg-green-900/40 text-green-300',
}

const fmtKg = (v) =>
  v == null || v === '' ? '—' : `${Math.round(Number(v)).toLocaleString()} kg`

const fmtTonnes = (v) =>
  v == null ? '0 t' : `${(Number(v) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} t`

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** value → <input type="datetime-local"> string, trimmed to minutes. */
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function Weighbridge() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

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
      const data = await listWeighbridgeTickets({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load weighbridge tickets.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseTickets(rows || []), [rows])

  const overweightRows = useMemo(
    () => (rows || [])
      .filter(isOverweight)
      .sort((a, b) => overloadKg(b) - overloadKg(a)),
    [rows],
  )

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (statusFilter && (r.status || '') !== statusFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.ticket_no || ''} ${r.driver_name || ''} ${r.site || ''} ${r.cargo_type || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, assetFilter, statusFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Tickets', value: summary.totalTickets, icon: Activity, tone: 'text-[var(--text-primary)]' },
    { label: 'Total net weight', value: fmtTonnes(summary.totalNetKg), icon: Package, tone: 'text-sky-400' },
    { label: 'Overweight tickets', value: summary.overweightCount, icon: ShieldAlert, tone: summary.overweightCount > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Max overload', value: summary.maxOverloadKg > 0 ? fmtKg(summary.maxOverloadKg) : '—', icon: AlertTriangle, tone: 'text-amber-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['ticket_no', 'asset_no', 'driver_name', 'site', 'weighed_at', 'gross_weight_kg', 'tare_weight_kg', 'net_weight_kg', 'gross_limit_kg', 'overload_kg', 'cargo_type', 'status', 'notes']
  const EXPORT_HEADERS = ['Ticket', 'Asset', 'Driver', 'Site', 'Weighed at', 'Gross (kg)', 'Tare (kg)', 'Net (kg)', 'Limit (kg)', 'Overload (kg)', 'Cargo', 'Status', 'Notes']
  const exportRows = filtered.map((r) => ({
    ticket_no: r.ticket_no || '', asset_no: r.asset_no || '',
    driver_name: r.driver_name || '', site: r.site || '',
    weighed_at: r.weighed_at || '', gross_weight_kg: r.gross_weight_kg ?? '',
    tare_weight_kg: r.tare_weight_kg ?? '',
    net_weight_kg: netWeight(r) ?? '', gross_limit_kg: r.gross_limit_kg ?? '',
    overload_kg: overloadKg(r) || '', cargo_type: r.cargo_type || '',
    status: r.status || '', notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      ticket_no: r.ticket_no || '', asset_no: r.asset_no || '',
      driver_name: r.driver_name || '', site: r.site || '',
      weighed_at: toLocalInput(r.weighed_at), gross_weight_kg: r.gross_weight_kg ?? '',
      tare_weight_kg: r.tare_weight_kg ?? '', net_weight_kg: r.net_weight_kg ?? '',
      gross_limit_kg: r.gross_limit_kg ?? '', cargo_type: r.cargo_type || '',
      status: r.status || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        status: form.status || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateWeighbridgeTicket(editing.id, payload)
      else await createWeighbridgeTicket(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the ticket.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteWeighbridgeTicket(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the ticket.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setAssetFilter(''); setStatusFilter(''); setSearch('') }
  const hasFilters = assetFilter || statusFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weighbridge Tickets"
        subtitle="Record gross / tare / net and per-axle weights per asset, flag overweight vehicles, and retain a compliance trail — the load basis for tyre-life and reliability analytics."
        icon={Scale}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'weighbridge_tickets')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Weighbridge Tickets', 'weighbridge_tickets', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New ticket
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Weighbridge tickets aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V177_WEIGHBRIDGE_TICKETS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load weighbridge tickets.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Overweight attention strip */}
      {rows !== null && overweightRows.length > 0 && (
        <div className="card border border-red-800/50">
          <h3 className="text-sm font-semibold text-red-300 mb-3 flex items-center gap-2">
            <ShieldAlert size={15} /> Overweight vehicles need attention
            <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">{overweightRows.length} over legal limit</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {overweightRows.slice(0, 24).map((r) => (
              <button
                key={r.id}
                onClick={() => openEdit(r)}
                className="text-left rounded-lg border border-red-800/50 bg-red-900/15 px-3 py-2 hover:bg-red-900/25"
              >
                <p className="text-xs text-[var(--text-muted)]">{r.asset_no}{r.ticket_no ? ` · ${r.ticket_no}` : ''}</p>
                <p className="text-sm font-semibold text-red-300">+{fmtKg(overloadKg(r))} over</p>
                <p className="text-[11px] text-[var(--text-muted)]">{fmtDateTime(r.weighed_at)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, ticket, driver, site, cargo, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalTickets}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Ticket', 'Asset', 'Weighed at', 'Net weight', 'Limit', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No tickets recorded yet — record your first weighbridge ticket.' : 'No tickets match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const over = overloadKg(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.ticket_no || '—'}</td>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.weighed_at)}</td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] whitespace-nowrap">
                        {fmtKg(netWeight(r))}
                        {over > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-900/40 text-red-300 px-2 py-0.5 text-[11px] font-medium align-middle">
                            <ShieldAlert size={11} /> +{fmtKg(over)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtKg(r.gross_limit_kg)}</td>
                      <td className="px-4 py-2.5">
                        {r.status
                          ? <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status] || 'bg-slate-700/40 text-slate-300'}`}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span>
                          : <span className="text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
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
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit ticket' : 'New weighbridge ticket'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Ticket number (optional)</label>
                  <input className="input w-full" placeholder="e.g. WB-2026-0182" value={form.ticket_no} maxLength={120} onChange={(e) => set('ticket_no', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Driver (optional)</label>
                  <input className="input w-full" placeholder="Driver name" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Weighed at</label>
                  <input className="input w-full" type="datetime-local" value={form.weighed_at} onChange={(e) => set('weighed_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Gross weight (kg)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="18000" value={form.gross_weight_kg} onChange={(e) => set('gross_weight_kg', e.target.value)} />
                </div>
                <div>
                  <label className="label">Tare weight (kg)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="7000" value={form.tare_weight_kg} onChange={(e) => set('tare_weight_kg', e.target.value)} />
                </div>
                <div>
                  <label className="label">Net weight (kg)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="auto = gross − tare" value={form.net_weight_kg} onChange={(e) => set('net_weight_kg', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to derive from gross − tare.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Gross limit (kg)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="17000" value={form.gross_limit_kg} onChange={(e) => set('gross_limit_kg', e.target.value)} />
                </div>
                <div>
                  <label className="label">Cargo type (optional)</label>
                  <input className="input w-full" placeholder="e.g. Aggregate" value={form.cargo_type} maxLength={200} onChange={(e) => set('cargo_type', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="">—</option>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Site (optional)</label>
                <input className="input w-full" placeholder="e.g. Riyadh weighbridge" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. axle 2 near limit; recheck load distribution" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create ticket'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this ticket?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Ticket'}{confirmDelete.ticket_no ? ` · ${confirmDelete.ticket_no}` : ''} · {fmtKg(netWeight(confirmDelete))} net · {fmtDateTime(confirmDelete.weighed_at)}. This can’t be undone.
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
