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
  Router, Wifi, WifiOff, HardDrive, Plus, Pencil, Trash2, Search, X,
  FileSpreadsheet, FileText, AlertTriangle, Loader2, Save, Clock, MapPin,
  Radio, Activity, Percent, Building2, Gauge, PlugZap, CircleSlash,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDevicesWithMeta, createDevice, updateDevice, deleteDevice, countFleetAssets,
} from '../lib/api/telematicsDevices'
import {
  analyzeTelematics, filterDevices, sortDevices, hoursSinceSeen,
  DEVICE_STATUSES, DEVICE_STATUS_META, DEFAULT_STALE_THRESHOLD_HOURS,
  connectivityState, lastSeenLabel, activeShareLabel, deviceExportRows,
  DEVICE_EXPORT_COLS, DEVICE_EXPORT_HEADERS,
} from '../lib/telematicsAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
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

// Status badges: semantic tint plus the status word, readable in both themes.
const STATUS_BADGE = {
  active: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  offline: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  decommissioned: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}
const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'
const TICK = 'var(--text-muted)'

function LastSeen({ device, now, thresholdHours }) {
  const state = connectivityState(device, now, thresholdHours)
  if (state === 'never') return <span className="text-[var(--text-dim)]">Never</span>
  const online = state === 'online'
  return (
    <span className={`inline-flex items-center gap-1.5 ${online ? 'text-emerald-500' : 'text-[var(--text-muted)]'}`}>
      {online ? <Wifi size={13} aria-hidden="true" /> : <WifiOff size={13} aria-hidden="true" />}
      <span>{lastSeenLabel(device, now)}</span>
      <span className="sr-only">{online ? '(online)' : '(offline)'}</span>
    </span>
  )
}

const CHART_OPTS = (horizontal = false) => ({
  responsive: true, maintainAspectRatio: false,
  indexAxis: horizontal ? 'y' : 'x',
  plugins: { legend: { display: horizontal, labels: { color: TICK, boxWidth: 12 } }, tooltip: { enabled: true } },
  scales: {
    x: { grid: { color: 'var(--panel-2)' }, ticks: { color: TICK, precision: 0 }, stacked: horizontal },
    y: { grid: { color: 'var(--panel-2)' }, ticks: { color: TICK, precision: 0 }, stacked: horizontal },
  },
})

// --- Create / edit dialog ------------------------------------------------
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

  const close = () => { if (!busy) onClose?.() }
  const field = (id, label, props) => (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input w-full" {...props} />
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      closeOnBackdrop={!busy}
      title={editing ? 'Edit device' : 'Register device'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={close} className="btn-secondary text-sm min-h-[44px]" disabled={busy}>Cancel</button>
          <button type="submit" form="device-form" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Register device'}
          </button>
        </div>
      }
    >
      <form id="device-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('td-id', 'Device ID (IMEI / serial) *', { className: 'input w-full font-mono', placeholder: '356938035643809', value: form.device_id, maxLength: 120, required: true, onChange: (e) => set('device_id', e.target.value) })}
          {field('td-provider', 'Provider', { placeholder: 'Teltonika, Queclink...', value: form.provider, maxLength: 120, onChange: (e) => set('provider', e.target.value) })}
          {field('td-sim', 'SIM number', { placeholder: 'ICCID / MSISDN', value: form.sim_number, maxLength: 60, onChange: (e) => set('sim_number', e.target.value) })}
          {field('td-asset', 'Asset number', { placeholder: 'Vehicle / trailer no.', value: form.asset_no, maxLength: 60, onChange: (e) => set('asset_no', e.target.value) })}
          {field('td-install', 'Install date', { type: 'date', value: form.install_date, onChange: (e) => set('install_date', e.target.value) })}
          {field('td-seen', 'Last seen', { type: 'datetime-local', value: form.last_seen_at, onChange: (e) => set('last_seen_at', e.target.value) })}
          <div>
            <label className="label" htmlFor="td-status">Status</label>
            <select id="td-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {DEVICE_STATUSES.map((st) => <option key={st} value={st}>{DEVICE_STATUS_META[st]?.label || st}</option>)}
            </select>
          </div>
          {field('td-site', 'Site', { placeholder: 'Depot / branch', value: form.site, maxLength: 200, onChange: (e) => set('site', e.target.value) })}
        </div>
        <div>
          <label className="label" htmlFor="td-notes">Notes</label>
          <textarea id="td-notes" className="input w-full min-h-[80px] resize-y" placeholder="Firmware, install technician, wiring notes..." value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {error && (
          <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
          </div>
        )}
      </form>
    </Modal>
  )
}

// --- Delete confirm -------------------------------------------------------
function DeleteConfirm({ device, onCancel, onConfirm, busy }) {
  return (
    <Modal
      open={Boolean(device)}
      onClose={() => { if (!busy) onCancel() }}
      size="sm"
      closeOnBackdrop={!busy}
      title="Remove device?"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm min-h-[44px]" disabled={busy}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />} Remove
          </button>
        </div>
      }
    >
      {device && (
        <p className="text-sm text-[var(--text-secondary)]">
          Device <span className="font-mono text-[var(--text-primary)]">{device.device_id}</span> will be permanently removed from the registry. This cannot be undone.
        </p>
      )}
    </Modal>
  )
}

// --- KPI tile -------------------------------------------------------------
function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums break-words ${tone}`}>{value}</p>
      {sub != null && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

// --- Chart card -----------------------------------------------------------
function ChartCard({ title, icon: Icon, children, hint }) {
  return (
    <section className="card" aria-label={title}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
          <Icon size={15} className="text-brand-bright" aria-hidden="true" /> {title}
        </h2>
        {hint && <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>}
      </div>
      {children}
    </section>
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
  const [actionError, setActionError] = useState('')

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
      // A failed read is not an empty registry: keep whatever loaded before
      // (or nothing), so the KPIs read N/A instead of a false zero.
      setError(toUserMessage(err, 'Could not load telematics devices.'))
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
    // Default order: most recent heartbeat first. The table re-sorts on any
    // header click and pages across the WHOLE filtered set (nothing clipped).
    return sortDevices(withAsset, 'last_seen', 'desc')
  }, [rows, statusFilter, siteFilter, vendorFilter, connFilter, search, assetFilter, now, thresholdHours])

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

  const exportRows = useMemo(() => deviceExportRows(filtered, now, thresholdHours), [filtered, now, thresholdHours])
  const fileBase = () => reportFileName('TyrePulse Telematics Devices', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExport = async (kind) => {
    setActionError('')
    try {
      if (kind === 'xlsx') await exportToExcel(exportRows, DEVICE_EXPORT_COLS, DEVICE_EXPORT_HEADERS, fileBase(), 'Devices', { title: 'Telematics Devices' })
      else await exportToPdf(exportRows, DEVICE_EXPORT_COLS.map((k, i) => ({ key: k, header: DEVICE_EXPORT_HEADERS[i] })), 'Telematics Devices', fileBase(), 'landscape')
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const clearFilters = () => { setStatusFilter('all'); setAssetFilter(''); setVendorFilter(''); setSiteFilter(''); setConnFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || assetFilter || vendorFilter || siteFilter || connFilter !== 'all' || search

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = useCallback((d) => { setEditing(d); setModalOpen(true) }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deleteDevice(deleting.id)
      setDeleting(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not remove the device.'))
      setDeleting(null)
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, load])

  const coveragePctLabel = coverage.coveragePct == null ? 'N/A' : `${coverage.coveragePct}%`
  const loaded = Array.isArray(rows)
  const loading = !loaded && !error
  // KPI value helper: N/A until a read has succeeded (never a false zero).
  const v = (x) => (loaded ? x : 'N/A')

  const columns = useMemo(() => [
    { id: 'device', header: 'Device ID', accessorFn: (r) => r.device_id || '', size: 170, cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{row.original.device_id}</span> },
    { id: 'provider', header: 'Provider', accessorFn: (r) => r.provider || 'N/A', size: 130, meta: { filterVariant: 'select' } },
    { id: 'sim', header: 'SIM', accessorFn: (r) => r.sim_number || 'N/A', size: 150, cell: ({ row }) => <span className="font-mono text-xs">{row.original.sim_number || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 120, cell: ({ row }) => row.original.asset_no || <span className="text-[var(--text-dim)]">Unassigned</span> },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 130 },
    { id: 'install', header: 'Install', accessorFn: (r) => r.install_date || '', size: 110, cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.install_date)}</span> },
    {
      id: 'seen', header: 'Last seen', size: 150,
      accessorFn: (r) => { const h = hoursSinceSeen(r, now); return h == null ? Number.POSITIVE_INFINITY : h },
      sortDescFirst: false,
      cell: ({ row }) => <LastSeen device={row.original} now={now} thresholdHours={thresholdHours} />,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => DEVICE_STATUS_META[r.status]?.label || r.status || 'N/A', size: 140, meta: { filterVariant: 'select' },
      cell: ({ row }) => <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[row.original.status] || STATUS_BADGE.decommissioned}`}>{DEVICE_STATUS_META[row.original.status]?.label || row.original.status || 'N/A'}</span>,
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center gap-1 justify-end">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit device ${row.original.device_id}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setDeleting(row.original)} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Remove device ${row.original.device_id}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit, now, thresholdHours])

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
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('xlsx')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> Register device
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">The telematics device registry is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V147_TELEMATICS_DEVICES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-500/40 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
            <div><p className="text-[var(--text-primary)] font-medium">Could not load telematics devices.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm shrink-0 min-h-[44px]">Retry</button>
        </div>
      )}

      {actionError && (
        <div role="alert" className="card border border-red-500/40 flex items-start justify-between gap-3">
          <p className="text-sm text-red-500">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total devices" value={v(kpis.total)} icon={HardDrive} tone="text-[var(--text-primary)]" />
        <Kpi label="Active" value={loaded ? activeShareLabel(kpis) : 'N/A'} sub={loaded ? `${kpis.active} of ${kpis.total}` : null} icon={Radio} tone="text-emerald-500" />
        <Kpi label="Online now" value={v(conn.online)} sub={loaded ? (conn.onlinePct == null ? 'no heartbeats' : `${conn.onlinePct}% of expected`) : null} icon={Wifi} tone="text-sky-500" />
        <Kpi label="Offline / stale" value={v(kpis.offlineStale)} sub={loaded ? `${conn.never} never reported` : null} icon={WifiOff} tone="text-amber-500" />
        <Kpi label="Fleet coverage" value={loaded ? coveragePctLabel : 'N/A'} sub={loaded ? (coverage.totalAssets == null ? `${coverage.assetsCovered} assets covered` : `${coverage.assetsCovered} of ${coverage.totalAssets} assets`) : null} icon={Percent} tone="text-indigo-500" />
        <Kpi label="Unassigned" value={v(kpis.unassigned)} sub={loaded ? 'no asset mapping' : null} icon={CircleSlash} tone="text-rose-500" />
      </div>

      {/* Charts */}
      {loaded && kpis.total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Status distribution" icon={Gauge}>
            <div className="h-56"><Doughnut data={statusChart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: TICK, boxWidth: 12 } } }, cutout: '58%' }} /></div>
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
      {loaded && kpis.total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 mb-3"><HardDrive size={15} className="text-brand-bright" aria-hidden="true" /> Install pipeline</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-[var(--input-border)] p-3">
                <p className="text-xs text-[var(--text-muted)]">Installed</p>
                <p className="text-2xl font-bold text-emerald-500">{pipeline.installed}</p>
                <p className="text-[11px] text-[var(--text-muted)]">have an install date</p>
              </div>
              <div className="rounded-lg border border-[var(--input-border)] p-3">
                <p className="text-xs text-[var(--text-muted)]">Pending fitment</p>
                <p className="text-2xl font-bold text-amber-500">{pipeline.pending}</p>
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
            <h2 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 mb-3"><AlertTriangle size={15} className="text-amber-500" aria-hidden="true" /> Data quality</h2>
            {flags.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-500"><Radio size={15} aria-hidden="true" /> No data-quality issues detected in the current view.</div>
            ) : (
              <div className="space-y-2">
                {flags.map((f) => (
                  <div key={f.key} className="flex items-center justify-between rounded-lg border border-[var(--input-border)] px-3 py-2">
                    <span className="text-sm text-[var(--text-secondary)]">{f.label}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded border bg-amber-500/15 text-amber-500 border-amber-500/30 tabular-nums">{f.count}</span>
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
            <label htmlFor="td-search" className="sr-only">Search devices</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="td-search" className="input pl-9 w-full min-h-[44px]" placeholder="Search device ID, provider, SIM, asset, site" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {DEVICE_STATUSES.map((st) => <option key={st} value={st}>{DEVICE_STATUS_META[st]?.label || st}</option>)}
          </select>
          <select className="input min-h-[44px]" value={connFilter} onChange={(e) => setConnFilter(e.target.value)} aria-label="Connectivity">
            <option value="all">Any connectivity</option>
            <option value="online">Online</option>
            <option value="offline">Offline / stale</option>
            <option value="never">Never reported</option>
          </select>
          <select className="input min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input min-h-[44px]" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} aria-label="Provider">
            <option value="">All providers</option>
            {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input min-h-[44px]" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="td-threshold" className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5"><Clock size={12} aria-hidden="true" /> Offline after</label>
          <select id="td-threshold" className="input min-h-[44px] text-sm" value={thresholdHours} onChange={(e) => setThresholdHours(Number(e.target.value))} aria-label="Staleness threshold">
            {THRESHOLD_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {loaded ? kpis.total : 'N/A'}</span>
        </div>
      </div>

      {/* Register */}
      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={!loaded && error ? error : null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        viewKey="telematics-devices"
        emptyMessage={
          missing ? 'The device registry is not provisioned yet.'
            : (rows || []).length === 0 ? 'No telematics devices registered yet. Choose Register device to add one.'
              : 'No devices match these filters.'
        }
      />

      {rows && rows.length > 0 && (
        <p className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
          <Clock size={12} aria-hidden="true" /> Devices with no contact in the selected window are shown as offline. {conn.never > 0 ? `${conn.never} device(s) have never reported in.` : ''}
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
