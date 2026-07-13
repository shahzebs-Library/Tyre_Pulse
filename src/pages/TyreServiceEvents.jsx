/**
 * TyreServiceEvents (route /tyre-service-events) — an operational log of every
 * hands-on tyre intervention (rotation, repair, inflation, inspection,
 * replacement) against a tyre serial and/or asset. Full CRUD on the
 * `tyre_service_events` table (V151): create/edit modal, event-type filters +
 * search, a by-type doughnut, KPI tiles (total events, tyres serviced, total
 * cost, most common type), Excel/PDF export, and loading/empty/error states with
 * a migration prompt when the table is absent.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  Wrench, Activity, RotateCcw, Gauge, Plus, Pencil, Trash2, Search, X, Filter,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, CircleDot,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  listServiceEvents, createServiceEvent, updateServiceEvent, deleteServiceEvent,
} from '../lib/api/tyreServiceEvents'
import {
  summarizeServiceEvents, EVENT_TYPES, EVENT_TYPE_META,
} from '../lib/tyreServiceEvents'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(ArcElement, Tooltip, Legend)

const EVENT_ICON = {
  rotation: RotateCcw,
  repair: Wrench,
  inflation: Gauge,
  inspection: Activity,
  replacement: CircleDot,
  other: CircleDot,
}
const BADGE_STYLES = {
  rotation:    'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  repair:      'bg-red-900/40 text-red-300 border border-red-700/50',
  inflation:   'bg-green-900/40 text-green-300 border border-green-700/50',
  inspection:  'bg-violet-900/40 text-violet-300 border border-violet-700/50',
  replacement: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  other:       'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
const num = (v) => (v == null || v === '' ? '—' : v)
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '—')

const EMPTY_FORM = {
  tyre_serial: '', asset_no: '', position: '', event_type: 'inspection',
  event_date: new Date().toISOString().slice(0, 10),
  tread_depth: '', pressure: '', cost: '', technician: '', site: '', notes: '',
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function EventModal({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(initial?.id)

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(initial ? { ...EMPTY_FORM, ...initial, event_date: initial.event_date || EMPTY_FORM.event_date } : EMPTY_FORM)
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.tyre_serial.trim() && !form.asset_no.trim()) {
      setError('Provide a tyre serial or an asset number.'); return
    }
    setBusy(true)
    try {
      if (editing) await updateServiceEvent(initial.id, form)
      else await createServiceEvent(form)
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the service event.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, onSaved, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {editing ? 'Edit service event' : 'Log service event'}
          </h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Tyre serial</label>
            <input className="input w-full font-mono" placeholder="e.g. SN-00123" value={form.tyre_serial} onChange={(e) => set('tyre_serial', e.target.value)} />
          </div>
          <div>
            <label className="label">Asset no.</label>
            <input className="input w-full font-mono" placeholder="e.g. TRK-42" value={form.asset_no} onChange={(e) => set('asset_no', e.target.value)} />
          </div>
          <div>
            <label className="label">Event type</label>
            <select className="input w-full" value={form.event_type} onChange={(e) => set('event_type', e.target.value)}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_META[t]?.label || t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Event date</label>
            <input type="date" className="input w-full" value={form.event_date || ''} onChange={(e) => set('event_date', e.target.value)} />
          </div>
          <div>
            <label className="label">Position</label>
            <input className="input w-full" placeholder="e.g. Steer L, Drive R" value={form.position} onChange={(e) => set('position', e.target.value)} />
          </div>
          <div>
            <label className="label">Site</label>
            <input className="input w-full" placeholder="Workshop / depot" value={form.site} onChange={(e) => set('site', e.target.value)} />
          </div>
          <div>
            <label className="label">Tread depth (mm)</label>
            <input type="number" step="0.1" min="0" className="input w-full" value={form.tread_depth} onChange={(e) => set('tread_depth', e.target.value)} />
          </div>
          <div>
            <label className="label">Pressure (PSI)</label>
            <input type="number" step="0.1" min="0" className="input w-full" value={form.pressure} onChange={(e) => set('pressure', e.target.value)} />
          </div>
          <div>
            <label className="label">Cost</label>
            <input type="number" step="0.01" min="0" className="input w-full" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
          </div>
          <div>
            <label className="label">Technician</label>
            <input className="input w-full" placeholder="Name / ID" value={form.technician} onChange={(e) => set('technician', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input w-full min-h-[90px] resize-y" placeholder="Observations, root cause, actions taken…" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Log event'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
        </div>
      </form>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function ConfirmDelete({ open, onCancel, onConfirm, busy }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onMouseDown={onCancel}>
      <div className="card w-full max-w-sm space-y-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-[var(--text-primary)] font-semibold">Delete this service event?</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">This action cannot be undone.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TyreServiceEvents() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [deleteRow, setDeleteRow] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listServiceEvents({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(isMissingRelation(err) ? 'missing' : (toUserMessage(err, 'Could not load service events.')))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeServiceEvents(rows || []), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (typeFilter !== 'all' && r.event_type !== typeFilter) return false
      if (q) {
        const hay = `${r.tyre_serial || ''} ${r.asset_no || ''} ${r.position || ''} ${r.technician || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, typeFilter, search])

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donutData = {
    labels: EVENT_TYPES.map((t) => EVENT_TYPE_META[t].label),
    datasets: [{
      data: EVENT_TYPES.map((t) => summary.byType[t] || 0),
      backgroundColor: EVENT_TYPES.map((t) => EVENT_TYPE_META[t].color),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'right', labels: { color: chartText, boxWidth: 12 } } },
  }

  const EXPORT_COLS = ['event_date', 'event_type', 'tyre_serial', 'asset_no', 'position', 'tread_depth', 'pressure', 'cost', 'technician', 'site']
  const EXPORT_HEADERS = ['Date', 'Type', 'Serial', 'Asset', 'Position', 'Tread (mm)', 'Pressure', 'Cost', 'Technician', 'Site']
  const exportRows = filtered.map((r) => ({
    event_date: fmtDate(r.event_date),
    event_type: EVENT_TYPE_META[r.event_type]?.label || r.event_type,
    tyre_serial: r.tyre_serial || '',
    asset_no: r.asset_no || '',
    position: r.position || '',
    tread_depth: r.tread_depth ?? '',
    pressure: r.pressure ?? '',
    cost: r.cost ?? '',
    technician: r.technician || '',
    site: r.site || '',
  }))

  const kpis = [
    { label: 'Total events', value: summary.total, icon: Activity, tone: 'text-[var(--text-primary)]' },
    { label: 'Tyres serviced', value: summary.tyresServiced, icon: CircleDot, tone: 'text-sky-400' },
    { label: 'Total cost', value: formatCurrencyCompact(summary.totalCost, activeCurrency), icon: Wrench, tone: 'text-amber-400' },
    { label: 'Most common', value: summary.mostCommonType ? (EVENT_TYPE_META[summary.mostCommonType]?.label || summary.mostCommonType) : '—', icon: Gauge, tone: 'text-green-400' },
  ]

  const clearFilters = () => { setTypeFilter('all'); setSearch('') }
  const hasFilters = typeFilter !== 'all' || search
  const openCreate = () => { setEditRow(null); setModalOpen(true) }
  const openEdit = (r) => { setEditRow(r); setModalOpen(true) }

  const confirmDelete = useCallback(async () => {
    if (!deleteRow) return
    setDeleting(true)
    try {
      await deleteServiceEvent(deleteRow.id)
      setDeleteRow(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the service event.'))
    } finally {
      setDeleting(false)
    }
  }, [deleteRow, load])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Service Events"
        subtitle="Operational log of every tyre intervention — rotation, repair, inflation, inspection & replacement — with tread, pressure, cost and technician."
        icon={Wrench}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'tyre_service_events')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tyre Service Events', 'tyre_service_events', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> Log event
            </button>
          </div>
        }
      />

      {error === 'missing' && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Tyre service events aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V151_TYRE_SERVICE_EVENTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}
      {error && error !== 'missing' && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load service events.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Chart + filters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Events by type</h3>
          <div className="h-64">
            {rows && rows.length
              ? <Doughnut data={donutData} options={donutOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No service events yet.'}</div>}
          </div>
        </div>

        <div className="card lg:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input className="input pl-9 w-full" placeholder="Search serial, asset, technician, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Event type">
              <option value="all">All types</option>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_META[t].label}</option>)}
            </select>
            {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
            <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {EVENT_TYPES.map((t) => (
              <span key={t} className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${BADGE_STYLES[t]}`}>
                {EVENT_TYPE_META[t].label}: <span className="font-semibold">{summary.byType[t] || 0}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Date', 'Type', 'Serial', 'Asset', 'Position', 'Tread', 'PSI', 'Cost', 'Technician', 'Site', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={11} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 ? 'No service events logged yet — use “Log event” to add the first.' : 'No events match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const Icon = EVENT_ICON[r.event_type] || CircleDot
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.event_date)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${BADGE_STYLES[r.event_type] || BADGE_STYLES.other}`}>
                          <Icon size={11} /> {EVENT_TYPE_META[r.event_type]?.label || r.event_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.tyre_serial || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.position || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{num(r.tread_depth)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{num(r.pressure)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.cost == null ? '—' : formatCurrencyCompact(r.cost, activeCurrency)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.technician || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setDeleteRow(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
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

      <EventModal open={modalOpen} initial={editRow} onClose={() => setModalOpen(false)} onSaved={load} />
      <ConfirmDelete open={Boolean(deleteRow)} busy={deleting} onCancel={() => setDeleteRow(null)} onConfirm={confirmDelete} />
    </div>
  )
}
