/**
 * TelematicsDevices (route /telematics-devices) — Telematics Device Registry.
 *
 * Registers GPS/telematics hardware (IMEI/serial, provider, SIM) and maps each
 * device to a fleet asset, tracking install date, operational status and
 * last-seen contact. Full CRUD on the org-isolated `telematics_devices` table
 * (V147) via the service layer, with KPI tiles, status/asset/search filters,
 * create/edit modal, delete confirmation, Excel/PDF export and
 * loading/empty/error states throughout.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Router, Wifi, WifiOff, HardDrive, Plus, Pencil, Trash2, Search, X, Filter,
  FileSpreadsheet, FileText, AlertTriangle, Loader2, Save, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDevices, createDevice, updateDevice, deleteDevice,
} from '../lib/api/telematicsDevices'
import {
  summarizeDevices, deviceOnline, hoursSinceSeen, DEVICE_STATUSES,
  DEVICE_STATUS_META, DEFAULT_ONLINE_THRESHOLD_HOURS,
} from '../lib/telematicsDevices'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  device_id: '', provider: '', sim_number: '', asset_no: '',
  install_date: '', last_seen_at: '', status: 'active', site: '', notes: '',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') || m.includes('could not find the table') ||
    m.includes('schema cache') || (m.includes('relation') && m.includes('telematics_devices'))
  )
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function LastSeen({ device, now }) {
  if (!device.last_seen_at) return <span className="text-[var(--text-dim)]">Never</span>
  const h = hoursSinceSeen(device, now)
  const online = deviceOnline(device, now)
  const label = h == null ? '—' : h < 1 ? '< 1 h ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`
  return (
    <span className={`inline-flex items-center gap-1.5 ${online ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`}>
      {online ? <Wifi size={13} /> : <WifiOff size={13} />} {label}
    </span>
  )
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function DeviceModal({ open, initial, onClose, onSaved, activeCountry }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(initial?.id)

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(initial
      ? {
          device_id: initial.device_id || '', provider: initial.provider || '',
          sim_number: initial.sim_number || '', asset_no: initial.asset_no || '',
          install_date: initial.install_date ? String(initial.install_date).slice(0, 10) : '',
          last_seen_at: initial.last_seen_at ? new Date(initial.last_seen_at).toISOString().slice(0, 16) : '',
          status: initial.status || 'active', site: initial.site || '', notes: initial.notes || '',
        }
      : EMPTY_FORM)
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.device_id.trim()) { setError('A device ID (IMEI or serial) is required.'); return }
    setBusy(true)
    try {
      const country = activeCountry && activeCountry !== 'All' ? activeCountry : null
      const payload = { ...form, last_seen_at: form.last_seen_at || null, install_date: form.install_date || null }
      if (editing) await updateDevice(initial.id, payload)
      else await createDevice({ ...payload, country })
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Could not save the device.')
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, activeCountry, onSaved, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)] inline-flex items-center gap-2">
            <Router size={18} className="text-brand-bright" /> {editing ? 'Edit device' : 'Register device'}
          </h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Device ID (IMEI / serial) *</label>
              <input className="input w-full font-mono" placeholder="356938035643809" value={form.device_id} maxLength={120} onChange={(e) => set('device_id', e.target.value)} />
            </div>
            <div>
              <label className="label">Provider</label>
              <input className="input w-full" placeholder="Teltonika, Queclink…" value={form.provider} maxLength={120} onChange={(e) => set('provider', e.target.value)} />
            </div>
            <div>
              <label className="label">SIM number</label>
              <input className="input w-full" placeholder="ICCID / MSISDN" value={form.sim_number} maxLength={60} onChange={(e) => set('sim_number', e.target.value)} />
            </div>
            <div>
              <label className="label">Asset number</label>
              <input className="input w-full" placeholder="Vehicle / trailer no." value={form.asset_no} maxLength={60} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label className="label">Install date</label>
              <input type="date" className="input w-full" value={form.install_date} onChange={(e) => set('install_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Last seen</label>
              <input type="datetime-local" className="input w-full" value={form.last_seen_at} onChange={(e) => set('last_seen_at', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {DEVICE_STATUSES.map((s) => <option key={s} value={s}>{DEVICE_STATUS_META[s]?.label || s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Site</label>
              <input className="input w-full" placeholder="Depot / branch" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="Firmware, install technician, wiring notes…" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Register device'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({ device, onCancel, onConfirm, busy }) {
  if (!device) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-900/30 border border-red-800/50 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <h3 className="font-bold text-[var(--text-primary)]">Remove device?</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Device <span className="font-mono text-[var(--text-secondary)]">{device.device_id}</span> will be permanently removed from the registry. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Remove
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TelematicsDevices() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const now = Date.now()

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listDevices({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load telematics devices.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeDevices(rows || [], now, DEFAULT_ONLINE_THRESHOLD_HOURS), [rows, now])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.device_id || ''} ${r.provider || ''} ${r.sim_number || ''} ${r.asset_no || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, assetFilter, search])

  const kpis = [
    { label: 'Total devices', value: summary.total, icon: HardDrive, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.byStatus.active, icon: Router, tone: 'text-emerald-400' },
    { label: 'Offline', value: summary.offline, icon: WifiOff, tone: 'text-amber-400' },
    { label: 'Assets covered', value: summary.assetsCovered, icon: Wifi, tone: 'text-sky-400' },
  ]

  const EXPORT_COLS = ['device_id', 'provider', 'sim_number', 'asset_no', 'status', 'install_date', 'last_seen_at', 'site']
  const EXPORT_HEADERS = ['Device ID', 'Provider', 'SIM', 'Asset', 'Status', 'Install date', 'Last seen', 'Site']
  const exportRows = filtered.map((r) => ({
    device_id: r.device_id || '', provider: r.provider || '', sim_number: r.sim_number || '',
    asset_no: r.asset_no || '', status: DEVICE_STATUS_META[r.status]?.label || r.status || '',
    install_date: r.install_date || '', last_seen_at: r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : '',
    site: r.site || '',
  }))

  const clearFilters = () => { setStatusFilter('all'); setAssetFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || assetFilter || search

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (d) => { setEditing(d); setModalOpen(true) }

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deleteDevice(deleting.id)
      setDeleting(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not remove the device.')
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, load])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Telematics Devices"
        subtitle="GPS/telematics device registry — map hardware to assets, track SIM, install date and last-seen status."
        icon={Router}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'telematics_devices')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Telematics Devices', 'telematics_devices', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> Register device
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The telematics device registry isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V147_TELEMATICS_DEVICES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load telematics devices.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
            <input className="input pl-9 w-full" placeholder="Search device ID, provider, SIM, asset, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {DEVICE_STATUSES.map((s) => <option key={s} value={s}>{DEVICE_STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
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
                {['Device ID', 'Provider', 'SIM', 'Asset', 'Site', 'Install', 'Last seen', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {rows.length === 0 && !missing ? (
                    <><Router size={22} className="mx-auto mb-2 opacity-60" />No telematics devices registered yet. Click “Register device” to add one.</>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No devices match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.device_id}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.provider || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.sim_number || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || <span className="text-[var(--text-dim)]">Unassigned</span>}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.install_date)}</td>
                    <td className="px-4 py-2.5"><LastSeen device={r} now={now} /></td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${DEVICE_STATUS_META[r.status]?.cls || ''}`}>{DEVICE_STATUS_META[r.status]?.label || r.status}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setDeleting(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
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

      {rows && rows.length > 0 && (
        <p className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
          <Clock size={12} /> Devices with no contact in the last {DEFAULT_ONLINE_THRESHOLD_HOURS}h are shown as offline. {summary.neverSeen > 0 ? `${summary.neverSeen} device(s) have never reported in.` : ''}
        </p>
      )}

      <DeviceModal
        open={modalOpen}
        initial={editing}
        activeCountry={activeCountry}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
      <DeleteConfirm device={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} busy={deleteBusy} />
    </div>
  )
}
