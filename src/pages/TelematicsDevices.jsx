/**
 * TelematicsDevices (route /telematics-devices) - Telematics Device Registry &
 * Fleet Connectivity Intelligence.
 *
 * Registers GPS/telematics hardware (IMEI/serial, provider, SIM) and maps each
 * device to a fleet asset, then turns the registry into operational
 * intelligence: device-health KPIs, status + connectivity + coverage charts,
 * per-vendor / per-site breakdowns, an install pipeline and honest data-quality
 * flags. Full CRUD on the org-isolated `telematics_devices` table (V147) via the
 * service layer. All figures come from real columns only
 * (status, last_seen_at, asset_no, provider, site, install_date); connectivity
 * is derived from last-heartbeat age against a tunable staleness threshold and
 * fleet coverage % is computed against the live `vehicle_fleet` count - never
 * fabricated. Loading / error+Retry / empty states throughout, plus Excel/PDF
 * export of the filtered set.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Router, Wifi, WifiOff, HardDrive, Plus, Pencil, Trash2, Search, X, Filter,
  FileSpreadsheet, FileText, AlertTriangle, Loader2, Save, Clock, MapPin,
  Radio, Activity, Percent, Building2, ArrowUpDown, Gauge, PlugZap, CircleSlash,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDevicesWithMeta, createDevice, updateDevice, deleteDevice, countFleetAssets,
} from '../lib/api/telematicsDevices'
import {
  analyzeTelematics, filterDevices, sortDevices, SORT_KEYS,
  deviceOnline, hoursSinceSeen, DEVICE_STATUSES, DEVICE_STATUS_META,
  DEFAULT_STALE_THRESHOLD_HOURS,
} from '../lib/telematicsAnalytics'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const THRESHOLD_OPTIONS = [
  { hours: 6, label: '6 hours' },
  { hours: 12, label: '12 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 48, label: '48 hours' },
  { hours: 24 * 7, label: '7 days' },
]

const EMPTY_FORM = {
  device_id: '', provider: '', sim_number: '', asset_no: '',
  install_date: '', last_seen_at: '', status: 'active', site: '', notes: '',
}

// Semantic colours for status/connectivity carry meaning -> kept fixed (not palettized).
const STATUS_HEX = { active: '#10b981', offline: '#f59e0b', decommissioned: '#64748b' }

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

function LastSeen({ device, now, thresholdHours }) {
  if (!device.last_seen_at) return <span className="text-[var(--text-dim)]">Never</span>
  const h = hoursSinceSeen(device, now)
  const online = deviceOnline(device, now, thresholdHours)
  const label = h == null ? 'N/A' : h < 1 ? 'under 1 h ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`
  return (
    <span className={`inline-flex items-center gap-1.5 ${online ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`}>
      {online ? <Wifi size={13} /> : <WifiOff size={13} />} {label}
    </span>
  )
}

const CHART_OPTS = (horizontal = false) => ({
  responsive: true, maintainAspectRatio: false,
  indexAxis: horizontal ? 'y' : 'x',
  plugins: { legend: { display: false }, tooltip: { enabled: true } },
  scales: {
    x: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af', precision: 0 }, stacked: horizontal },
    y: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af', precision: 0 }, stacked: horizontal },
  },
})

// --- Create / edit modal --------------------------------------------------
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
      setError(toUserMessage(err, 'Could not save the device.'))
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
              <input className="input w-full" placeholder="Teltonika, Queclink..." value={form.provider} maxLength={120} onChange={(e) => set('provider', e.target.value)} />
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
                {DEVICE_STATUSES.map((st) => <option key={st} value={st}>{DEVICE_STATUS_META[st]?.label || st}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Site</label>
              <input className="input w-full" placeholder="Depot / branch" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="Firmware, install technician, wiring notes..." value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
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
              {busy ? 'Saving...' : editing ? 'Save changes' : 'Register device'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// --- Delete confirm -------------------------------------------------------
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

// --- KPI tile -------------------------------------------------------------
function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} />
      </div>
      <p className={`text-3xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub != null && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

// --- Chart card -----------------------------------------------------------
function ChartCard({ title, icon: Icon, children, hint }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
          <Icon size={15} className="text-brand-bright" /> {title}
        </h3>
        {hint && <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

// --- Page -----------------------------------------------------------------
export default function TelematicsDevices() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [fleetTotal, setFleetTotal] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [connFilter, setConnFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [thresholdHours, setThresholdHours] = useState(DEFAULT_STALE_THRESHOLD_HOURS)
  const [sortKey, setSortKey] = useState('last_seen')
  const [sortDir, setSortDir] = useState('desc')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const now = Date.now()

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const [meta, total] = await Promise.all([
        listDevicesWithMeta({ country: activeCountry }),
        countFleetAssets({ country: activeCountry }),
      ])
      const list = Array.isArray(meta?.rows) ? meta.rows : []
      setRows(list)
      setFleetTotal(typeof total === 'number' ? total : null)
      setUpdatedAt(new Date())
      setMissing(Boolean(meta?.missing))
    } catch (err) {
      setError(toUserMessage(err, 'Could not load telematics devices.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const analysis = useMemo(
    () => analyzeTelematics(rows || [], { now, thresholdHours, totalAssets: fleetTotal }),
    [rows, now, thresholdHours, fleetTotal],
  )

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )
  const vendorOptions = useMemo(() => analysis.vendors.map((v) => v.key), [analysis])
  const siteOptions = useMemo(() => analysis.sites.map((s) => s.key), [analysis])

  const filtered = useMemo(() => {
    const f = filterDevices(
      rows || [],
      { status: statusFilter, site: siteFilter, vendor: vendorFilter, connectivity: connFilter, search },
      now, thresholdHours,
    )
    const withAsset = assetFilter ? f.filter((r) => r.asset_no === assetFilter) : f
    return sortDevices(withAsset, sortKey, sortDir)
  }, [rows, statusFilter, siteFilter, vendorFilter, connFilter, search, assetFilter, sortKey, sortDir, now, thresholdHours])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'last_seen' || key === 'install_date' ? 'desc' : 'asc') }
  }

  // --- charts (real data; semantic colours fixed, categorical follow theme) --
  const statusChart = useMemo(() => ({
    labels: analysis.status.items.map((i) => i.label),
    datasets: [{
      data: analysis.status.items.map((i) => i.count),
      backgroundColor: analysis.status.items.map((i) => STATUS_HEX[i.key] || '#64748b'),
      borderWidth: 0,
    }],
  }), [analysis])

  const connChart = useMemo(() => ({
    labels: analysis.connectivity.buckets.map((b) => b.label),
    datasets: [{
      label: 'Devices',
      data: analysis.connectivity.buckets.map((b) => b.count),
      backgroundColor: ['#10b981', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#64748b'],
      borderRadius: 4,
    }],
  }), [analysis])

  const siteChart = useMemo(() => {
    const top = analysis.sites.slice(0, 8)
    return {
      labels: top.map((s) => s.label),
      datasets: [
        { label: 'Online', data: top.map((s) => s.online), backgroundColor: '#10b981', borderRadius: 3 },
        { label: 'Offline', data: top.map((s) => s.offline), backgroundColor: '#f59e0b', borderRadius: 3 },
      ],
    }
  }, [analysis])

  const vendorChart = useMemo(() => {
    const top = analysis.vendors.slice(0, 8)
    return {
      labels: top.map((v) => v.label),
      datasets: [{
        label: 'Devices',
        data: top.map((v) => v.total),
        backgroundColor: categorical(top.length).map((c) => withAlpha(c, 0.85)),
        borderColor: categorical(top.length),
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [analysis])

  const { kpis, connectivity: conn, coverage, pipeline, flags } = analysis

  const EXPORT_COLS = ['device_id', 'provider', 'sim_number', 'asset_no', 'status', 'connectivity', 'install_date', 'last_seen_at', 'site']
  const EXPORT_HEADERS = ['Device ID', 'Provider', 'SIM', 'Asset', 'Status', 'Connectivity', 'Install date', 'Last seen', 'Site']
  const exportRows = filtered.map((r) => ({
    device_id: r.device_id || '', provider: r.provider || '', sim_number: r.sim_number || '',
    asset_no: r.asset_no || '', status: DEVICE_STATUS_META[r.status]?.label || r.status || '',
    connectivity: !r.last_seen_at ? 'Never' : deviceOnline(r, now, thresholdHours) ? 'Online' : 'Offline',
    install_date: r.install_date || '', last_seen_at: r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : '',
    site: r.site || '',
  }))

  const clearFilters = () => { setStatusFilter('all'); setAssetFilter(''); setVendorFilter(''); setSiteFilter(''); setConnFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || assetFilter || vendorFilter || siteFilter || connFilter !== 'all' || search

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
      setError(toUserMessage(err, 'Could not remove the device.'))
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, load])

  const coveragePctLabel = coverage.coveragePct == null ? 'N/A' : `${coverage.coveragePct}%`
  const loading = rows === null

  const SortTh = ({ label, k }) => (
    <th className="px-4 py-3 font-semibold whitespace-nowrap">
      {SORT_KEYS.includes(k) ? (
        <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${sortKey === k ? 'text-[var(--text-primary)]' : ''}`}>
          {label} <ArrowUpDown size={11} className={sortKey === k ? 'opacity-100' : 'opacity-40'} />
        </button>
      ) : label}
    </th>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Telematics Devices"
        subtitle="GPS/telematics device registry and fleet connectivity intelligence: hardware-to-asset mapping, heartbeat health, coverage and install pipeline."
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
            <p className="text-amber-300 font-medium">The telematics device registry is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V147_TELEMATICS_DEVICES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div><p className="text-red-300 font-medium">Could not load telematics devices.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button onClick={load} className="btn-secondary text-sm shrink-0">Retry</button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total devices" value={loading ? '-' : kpis.total} icon={HardDrive} tone="text-[var(--text-primary)]" />
        <Kpi label="Active" value={loading ? '-' : `${kpis.activePct}%`} sub={loading ? null : `${kpis.active} of ${kpis.total}`} icon={Radio} tone="text-emerald-400" />
        <Kpi label="Online now" value={loading ? '-' : conn.online} sub={loading ? null : conn.onlinePct == null ? 'no heartbeats' : `${conn.onlinePct}% of expected`} icon={Wifi} tone="text-sky-400" />
        <Kpi label="Offline / stale" value={loading ? '-' : kpis.offlineStale} sub={loading ? null : `${conn.never} never reported`} icon={WifiOff} tone="text-amber-400" />
        <Kpi label="Fleet coverage" value={loading ? '-' : coveragePctLabel} sub={loading ? null : coverage.totalAssets == null ? `${coverage.assetsCovered} assets covered` : `${coverage.assetsCovered} of ${coverage.totalAssets} assets`} icon={Percent} tone="text-indigo-400" />
        <Kpi label="Unassigned" value={loading ? '-' : kpis.unassigned} sub={loading ? null : 'no asset mapping'} icon={CircleSlash} tone="text-rose-400" />
      </div>

      {/* Charts */}
      {!loading && kpis.total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Status distribution" icon={Gauge}>
            <div className="h-56"><Doughnut data={statusChart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12 } } }, cutout: '58%' }} /></div>
          </ChartCard>
          <ChartCard title="Connectivity by last heartbeat" icon={Activity} hint={conn.hasHeartbeatData ? `stale after ${thresholdHours < 24 ? `${thresholdHours}h` : `${Math.round(thresholdHours / 24)}d`}` : 'no heartbeat data'}>
            {conn.hasHeartbeatData
              ? <div className="h-56"><Bar data={connChart} options={CHART_OPTS()} /></div>
              : <div className="h-56 flex flex-col items-center justify-center text-[var(--text-muted)] text-sm gap-2"><PlugZap size={22} className="opacity-60" />No last-seen data recorded yet. Connectivity appears once devices report a heartbeat.</div>}
          </ChartCard>
          <ChartCard title="Coverage by site (online vs offline)" icon={MapPin} hint="top 8 sites">
            {analysis.sites.length
              ? <div className="h-56"><Bar data={siteChart} options={CHART_OPTS(true)} /></div>
              : <div className="h-56 flex items-center justify-center text-[var(--text-muted)] text-sm">No site data.</div>}
          </ChartCard>
          <ChartCard title="Devices by provider" icon={Building2} hint="top 8 vendors">
            {analysis.vendors.length
              ? <div className="h-56"><Bar data={vendorChart} options={CHART_OPTS()} /></div>
              : <div className="h-56 flex items-center justify-center text-[var(--text-muted)] text-sm">No provider data.</div>}
          </ChartCard>
        </div>
      )}

      {/* Install pipeline + data-quality flags */}
      {!loading && kpis.total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 mb-3"><HardDrive size={15} className="text-brand-bright" /> Install pipeline</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-[var(--input-border)] p-3">
                <p className="text-xs text-[var(--text-muted)]">Installed</p>
                <p className="text-2xl font-bold text-emerald-400">{pipeline.installed}</p>
                <p className="text-[11px] text-[var(--text-muted)]">have an install date</p>
              </div>
              <div className="rounded-lg border border-[var(--input-border)] p-3">
                <p className="text-xs text-[var(--text-muted)]">Pending fitment</p>
                <p className="text-2xl font-bold text-amber-400">{pipeline.pending}</p>
                <p className="text-[11px] text-[var(--text-muted)]">no install date recorded</p>
              </div>
            </div>
            {pipeline.recent.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Recent installs</p>
                <div className="space-y-1">
                  {pipeline.recent.map((m) => (
                    <div key={m.month} className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-secondary)] w-16">{m.month}</span>
                      <div className="flex-1 h-2 rounded bg-[var(--input-bg)] overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${Math.min(100, (m.count / Math.max(...pipeline.recent.map((x) => x.count))) * 100)}%`, background: colorAt(0) }} />
                      </div>
                      <span className="text-xs text-[var(--text-muted)] w-6 text-right">{m.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 mb-3"><AlertTriangle size={15} className="text-amber-400" /> Data quality</h3>
            {flags.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-400"><Radio size={15} /> No data-quality issues detected in the current view.</div>
            ) : (
              <div className="space-y-2">
                {flags.map((f) => (
                  <div key={f.key} className="flex items-center justify-between rounded-lg border border-[var(--input-border)] px-3 py-2">
                    <span className="text-sm text-[var(--text-secondary)]">{f.label}</span>
                    <span className="badge text-[11px] px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/50">{f.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search device ID, provider, SIM, asset, site..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {DEVICE_STATUSES.map((st) => <option key={st} value={st}>{DEVICE_STATUS_META[st]?.label || st}</option>)}
          </select>
          <select className="input" value={connFilter} onChange={(e) => setConnFilter(e.target.value)} aria-label="Connectivity">
            <option value="all">Any connectivity</option>
            <option value="online">Online</option>
            <option value="offline">Offline / stale</option>
            <option value="never">Never reported</option>
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} aria-label="Provider">
            <option value="">All providers</option>
            {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5"><Clock size={12} /> Offline after</label>
          <select className="input py-1 text-sm" value={thresholdHours} onChange={(e) => setThresholdHours(Number(e.target.value))} aria-label="Staleness threshold">
            {THRESHOLD_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {kpis.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <SortTh label="Device ID" k="device_id" />
                <SortTh label="Provider" k="provider" />
                <th className="px-4 py-3 font-semibold whitespace-nowrap">SIM</th>
                <SortTh label="Asset" k="asset_no" />
                <SortTh label="Site" k="site" />
                <SortTh label="Install" k="install_date" />
                <SortTh label="Last seen" k="last_seen" />
                <SortTh label="Status" k="status" />
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {(rows || []).length === 0 && !missing ? (
                    <><Router size={22} className="mx-auto mb-2 opacity-60" />No telematics devices registered yet. Click "Register device" to add one.</>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No devices match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.device_id}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.provider || 'N/A'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.sim_number || 'N/A'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || <span className="text-[var(--text-dim)]">Unassigned</span>}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.install_date)}</td>
                    <td className="px-4 py-2.5"><LastSeen device={r} now={now} thresholdHours={thresholdHours} /></td>
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
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500. Refine filters or export for the full set.</p>}
      </div>

      {rows && rows.length > 0 && (
        <p className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
          <Clock size={12} /> Devices with no contact in the selected window are shown as offline. {conn.never > 0 ? `${conn.never} device(s) have never reported in.` : ''}
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
