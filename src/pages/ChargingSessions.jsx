/**
 * ChargingSessions (route /charging-sessions) — EV Charging Sessions. Captures
 * one record per charging session for an electric asset: station, connector,
 * energy delivered (kWh), cost, state-of-charge start/end, duration, and
 * outcome. Charging spend and energy history are the EV backbone for cost-per-km
 * and utilisation analytics, so every session is org-isolated and country-scoped.
 *
 * Runs on the new `charging_sessions` table (V166). Real data, KPI tiles,
 * create/edit modal, filters, search, delete confirm, Excel/PDF export, and
 * loading/empty/error states throughout. Cost-efficiency and the fleet KPI
 * summary live in the pure `src/lib/chargingSessions.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BatteryCharging, Zap, DollarSign, TrendingUp, Truck, AlertTriangle, Search, X,
  Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2, Plug,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listChargingSessions, createChargingSession, updateChargingSession, deleteChargingSession,
} from '../lib/api/chargingSessions'
import { summariseCharging, costPerKwh } from '../lib/chargingSessions'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const EMPTY_FORM = {
  asset_no: '', station_name: '', connector_type: '', started_at: '', ended_at: '',
  energy_kwh: '', cost: '', currency: '', start_soc: '', end_soc: '', duration_min: '',
  status: '', notes: '',
}

const STATUS_OPTIONS = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'interrupted', label: 'Interrupted' },
  { value: 'failed', label: 'Failed' },
]

const STATUS_TONE = {
  in_progress: 'text-sky-400',
  completed: 'text-green-400',
  interrupted: 'text-amber-400',
  failed: 'text-red-400',
}
const statusLabel = (v) => STATUS_OPTIONS.find((s) => s.value === v)?.label || (v || '—')

const fmtKwh = (v) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`

const fmtMoney = (v, currency) =>
  v == null || v === '' ? '—' : `${currency ? `${currency} ` : ''}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

const fmtSoc = (v) => (v == null || v === '' ? '—' : `${Number(v)}%`)

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

export default function ChargingSessions() {
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
      const data = await listChargingSessions({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load charging sessions.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseCharging(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  // Currency shown in KPI/money columns: first non-empty currency in the set.
  const currency = useMemo(
    () => (rows || []).find((r) => r.currency)?.currency || '',
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.station_name || ''} ${r.connector_type || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, assetFilter, statusFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Sessions logged', value: summary.totalSessions, icon: BatteryCharging, tone: 'text-[var(--text-primary)]' },
    { label: 'Total energy', value: `${Math.round(summary.totalKwh).toLocaleString()} kWh`, icon: Zap, tone: 'text-sky-400' },
    { label: 'Total cost', value: summary.totalCost > 0 ? fmtMoney(summary.totalCost, currency) : '—', icon: DollarSign, tone: 'text-amber-400' },
    { label: 'Avg cost / kWh', value: summary.avgCostPerKwh == null ? '—' : fmtMoney(summary.avgCostPerKwh, currency), icon: TrendingUp, tone: 'text-green-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'station_name', 'connector_type', 'started_at', 'ended_at', 'energy_kwh', 'cost', 'currency', 'cost_per_kwh', 'start_soc', 'end_soc', 'duration_min', 'status', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Station', 'Connector', 'Started', 'Ended', 'Energy (kWh)', 'Cost', 'Currency', 'Cost/kWh', 'Start SoC', 'End SoC', 'Duration (min)', 'Status', 'Notes']
  const exportRows = filtered.map((r) => {
    const cpk = costPerKwh(r)
    return {
      asset_no: r.asset_no || '', station_name: r.station_name || '',
      connector_type: r.connector_type || '', started_at: r.started_at || '',
      ended_at: r.ended_at || '', energy_kwh: r.energy_kwh ?? '',
      cost: r.cost ?? '', currency: r.currency || '',
      cost_per_kwh: cpk == null ? '' : Math.round(cpk * 1000) / 1000,
      start_soc: r.start_soc ?? '', end_soc: r.end_soc ?? '',
      duration_min: r.duration_min ?? '', status: statusLabel(r.status),
      notes: r.notes || '',
    }
  })

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', station_name: r.station_name || '',
      connector_type: r.connector_type || '',
      started_at: toLocalInput(r.started_at), ended_at: toLocalInput(r.ended_at),
      energy_kwh: r.energy_kwh ?? '', cost: r.cost ?? '', currency: r.currency || '',
      start_soc: r.start_soc ?? '', end_soc: r.end_soc ?? '',
      duration_min: r.duration_min ?? '', status: r.status || '', notes: r.notes || '',
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
      if (editing) await updateChargingSession(editing.id, payload)
      else await createChargingSession(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the session.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteChargingSession(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the session.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setAssetFilter(''); setStatusFilter(''); setSearch('') }
  const hasFilters = assetFilter || statusFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="EV Charging Sessions"
        subtitle="Log and track EV charging sessions — energy (kWh), cost, state-of-charge, and duration per asset. The energy-cost basis for EV cost-per-km and utilisation analytics."
        icon={BatteryCharging}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'charging_sessions') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'EV Charging Sessions', 'charging_sessions', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log session
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">EV charging sessions aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V166_CHARGING_SESSIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load charging sessions.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Secondary stat strip */}
      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-[var(--text-muted)]">Assets charged</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">{rows === null ? '—' : summary.distinctAssets}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Completed</p>
            <p className="text-lg font-semibold text-green-400">{rows === null ? '—' : summary.completedCount}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Avg SoC gain</p>
            <p className="text-lg font-semibold text-sky-400">{rows === null || summary.avgSocGainPct == null ? '—' : `${Math.round(summary.avgSocGainPct)}%`}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Total energy</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">{rows === null ? '—' : `${Math.round(summary.totalKwh).toLocaleString()} kWh`}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, station, connector, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalSessions}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Station', 'Started', 'Energy', 'Cost', 'Cost/kWh', 'SoC', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No charging sessions logged yet — log your first session.' : 'No sessions match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const cpk = costPerKwh(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        <span className="inline-flex items-center gap-1.5">
                          {r.connector_type ? <Plug size={13} className="text-[var(--text-muted)]" /> : null}
                          {r.station_name || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{fmtKwh(r.energy_kwh)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtMoney(r.cost, r.currency || currency)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{cpk == null ? '—' : fmtMoney(cpk, r.currency || currency)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtSoc(r.start_soc)} → {fmtSoc(r.end_soc)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`text-xs font-medium ${STATUS_TONE[r.status] || 'text-[var(--text-muted)]'}`}>{statusLabel(r.status)}</span>
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit charging session' : 'Log charging session'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. EV-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="">—</option>
                    {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Station (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh depot fast charger" value={form.station_name} maxLength={200} onChange={(e) => set('station_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Connector (optional)</label>
                  <input className="input w-full" placeholder="CCS2 / CHAdeMO / Type 2" value={form.connector_type} maxLength={60} onChange={(e) => set('connector_type', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Started at</label>
                  <input className="input w-full" type="datetime-local" value={form.started_at} onChange={(e) => set('started_at', e.target.value)} />
                </div>
                <div>
                  <label className="label">Ended at</label>
                  <input className="input w-full" type="datetime-local" value={form.ended_at} onChange={(e) => set('ended_at', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Energy (kWh)</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="42.5" value={form.energy_kwh} onChange={(e) => set('energy_kwh', e.target.value)} />
                </div>
                <div>
                  <label className="label">Cost</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="63.75" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Start SoC (%)</label>
                  <input className="input w-full" type="number" step="1" min="0" max="100" placeholder="20" value={form.start_soc} onChange={(e) => set('start_soc', e.target.value)} />
                </div>
                <div>
                  <label className="label">End SoC (%)</label>
                  <input className="input w-full" type="number" step="1" min="0" max="100" placeholder="90" value={form.end_soc} onChange={(e) => set('end_soc', e.target.value)} />
                </div>
                <div>
                  <label className="label">Duration (min)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="45" value={form.duration_min} onChange={(e) => set('duration_min', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. overnight depot charge" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Log session'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this session?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Session'} · {fmtKwh(confirmDelete.energy_kwh)} · {fmtDateTime(confirmDelete.started_at)}. This can’t be undone.
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

/** Convert an ISO timestamp to the value a <input type="datetime-local"> expects. */
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
