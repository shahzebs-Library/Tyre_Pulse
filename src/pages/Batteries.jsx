/**
 * Batteries (route /batteries) - Battery Lifecycle. Registers and tracks
 * vehicle/asset batteries: install date, warranty term, state-of-health, live
 * voltage, and a status lifecycle (healthy, weak, replace, retired). Derives
 * warranty expiry and a warranty window, flags batteries needing attention, and
 * surfaces a status distribution chart, KPI tiles, filters, search, a sortable
 * EnterpriseTable register, create/edit, delete, and Excel/PDF export.
 *
 * Runs on the `batteries` table (MIGRATIONS_V146_BATTERIES.sql). When the table
 * is not deployed the page says so rather than pretending the fleet has no
 * batteries. Lifecycle maths lives in `src/lib/batteries.js`; the page shaping
 * (enrichment, filters, KPI strip, warranty window, export rows) lives in
 * `src/lib/batteriesAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  BatteryCharging, Battery, AlertTriangle, Activity, HeartPulse, Plus, Pencil,
  Trash2, Search, X, FileSpreadsheet, FileText, ShieldCheck, CalendarClock, Gauge,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listBatteries, createBattery, updateBattery, deleteBattery,
} from '../lib/api/batteries'
import { warrantyExpiry } from '../lib/batteries'
import {
  BATTERY_STATUSES, BATTERY_STATUS_META, EMPTY_BATTERY_FILTERS, WARRANTY_SOON_DAYS,
  enrichBatteries, filterBatteries, batteryKpis, attentionList, assetOptions,
  activeBatteryFilterCount, batteryExportRows, BATTERY_EXPORT_COLUMNS, statusLabel,
} from '../lib/batteriesAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(ArcElement, Tooltip, Legend)

// Semantic tints: a 500/15 wash reads on both themes and every text-*-300 has a
// light-mode override. The label always names the status.
const STATUS_BADGE = {
  healthy: 'bg-green-500/15 text-green-300 border border-green-500/40',
  weak: 'bg-amber-500/15 text-amber-300 border border-amber-500/40',
  replace: 'bg-red-500/15 text-red-300 border border-red-500/40',
  retired: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
// Semantic status colours (meaning, not decoration), so they stay fixed.
const STATUS_COLOR = { healthy: '#22c55e', weak: '#f59e0b', replace: '#ef4444', retired: '#64748b' }
const BAND_TEXT = { good: 'text-green-400', fair: 'text-amber-400', poor: 'text-red-400', unknown: 'text-[var(--text-muted)]' }
const BAND_BAR = { good: 'bg-green-500', fair: 'bg-amber-500', poor: 'bg-red-500', unknown: 'bg-[var(--text-dim)]' }
const WARRANTY_TEXT = { expired: 'text-red-400', soon: 'text-amber-400', active: 'text-[var(--text-secondary)]', unknown: 'text-[var(--text-muted)]' }

const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

const EMPTY_FORM = {
  serial_no: '', asset_no: '', brand: '', install_date: '', warranty_months: '',
  health_pct: '', voltage: '', status: 'healthy', site: '', notes: '',
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 10)
}

function Kpi({ label, value, icon: Icon, tone, sub, loading }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-3xl font-bold mt-1 tabular-nums ${tone}`}>
        {loading ? <span className="inline-block h-8 w-16 rounded bg-[var(--input-bg)] animate-pulse" aria-label="Loading" /> : (value ?? 'N/A')}
      </p>
      {sub && !loading && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function Batteries() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [filters, setFilters] = useState(EMPTY_BATTERY_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listBatteries({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load batteries.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  const failed = Boolean(error)
  const enriched = useMemo(() => enrichBatteries(rows || [], nowMs), [rows, nowMs])
  const kpi = useMemo(() => batteryKpis(enriched), [enriched])
  const attention = useMemo(() => attentionList(enriched), [enriched])
  const assets = useMemo(() => assetOptions(rows || []), [rows])
  const filtered = useMemo(() => filterBatteries(enriched, filters), [enriched, filters])
  const filterCount = activeBatteryFilterCount(filters)

  const donutData = {
    labels: BATTERY_STATUSES.map((s) => BATTERY_STATUS_META[s].label),
    datasets: [{
      data: BATTERY_STATUSES.map((s) => kpi.byStatus[s]),
      backgroundColor: BATTERY_STATUSES.map((s) => STATUS_COLOR[s]),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '58%',
    plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12 } } },
  }

  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Total batteries', value: kv(kpi.total), icon: BatteryCharging, tone: 'text-[var(--text-primary)]', sub: failed ? null : `${kpi.inService} in service` },
    { label: 'Healthy', value: kv(kpi.byStatus.healthy), icon: Battery, tone: 'text-green-400' },
    { label: 'Needs attention', value: kv(kpi.needingAttention), icon: AlertTriangle, tone: 'text-red-400', sub: 'Weak, replace or health under 50%' },
    { label: 'Avg health', value: failed || kpi.avgHealth == null ? null : `${kpi.avgHealth}%`, icon: HeartPulse, tone: 'text-sky-400', sub: failed || kpi.measuredPct == null ? null : `${kpi.measured} of ${kpi.total} measured` },
    { label: 'Warranty ending soon', value: kv(kpi.expiringSoon), icon: CalendarClock, tone: 'text-amber-400', sub: `Within ${WARRANTY_SOON_DAYS} days` },
    { label: 'Out of warranty', value: kv(kpi.outOfWarranty), icon: ShieldCheck, tone: 'text-orange-400', sub: 'In service, warranty ended' },
  ]

  const doExport = async (kind) => {
    const out = batteryExportRows(filtered)
    const keys = BATTERY_EXPORT_COLUMNS.map(([k]) => k)
    const headers = BATTERY_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Battery Lifecycle')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Battery Lifecycle', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      serial_no: r.serial_no || '', asset_no: r.asset_no || '', brand: r.brand || '',
      install_date: r.install_date || '', warranty_months: r.warranty_months ?? '',
      health_pct: r.health_pct ?? '', voltage: r.voltage ?? '', status: r.status || 'healthy',
      site: r.site || '', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }, [])
  const closeModal = () => { if (!saving) { setModalOpen(false); setEditing(null) } }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim() && !form.serial_no.trim()) {
      setFormError('Enter an asset number or a serial number.'); return
    }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry && activeCountry !== 'All' ? activeCountry : null }
      const saved = editing ? await updateBattery(editing.id, payload) : await createBattery(payload)
      setRows((prev) => {
        const list = prev || []
        return editing ? list.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...list]
      })
      setModalOpen(false); setEditing(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the battery.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await deleteBattery(confirmDel.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDel.id))
      setConfirmDel(null)
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not delete the battery.'))
      setConfirmDel(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDel])

  const columns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial_no || '', size: 150, cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 110, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'brand', header: 'Brand', accessorFn: (r) => r.brand || '', size: 120, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || '', size: 120, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'health', header: 'Health', accessorFn: (r) => r._health, size: 150, sortUndefined: 'last',
      cell: ({ row }) => {
        const r = row.original
        if (r._health == null) return <span className="text-[var(--text-muted)]">Not measured</span>
        return (
          <div className="flex items-center gap-2">
            <span className={`font-semibold tabular-nums ${BAND_TEXT[r._band.key]}`}>{r._health}%</span>
            <div className="w-14 bg-[var(--input-bg)] rounded-full h-1.5" aria-hidden="true">
              <div className={`h-1.5 rounded-full ${BAND_BAR[r._band.key]}`} style={{ width: `${Math.max(0, Math.min(100, r._health))}%` }} />
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">{r._band.label}</span>
          </div>
        )
      },
    },
    {
      id: 'voltage', header: 'Voltage', accessorFn: (r) => (r.voltage == null || r.voltage === '' ? null : Number(r.voltage)),
      size: 90, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() == null ? 'N/A' : `${getValue()}V`),
    },
    { id: 'installed', header: 'Installed', accessorFn: (r) => r.install_date || '', size: 110, cell: ({ getValue }) => fmtDate(getValue()) },
    {
      id: 'expiry', header: 'Warranty expiry', accessorFn: (r) => (r._expiry ? r._expiry.getTime() : null), size: 150, sortUndefined: 'last',
      cell: ({ row }) => {
        const w = row.original._warranty
        return (
          <span className={WARRANTY_TEXT[w.key]}>
            {row.original._expiry ? fmtDate(row.original._expiry) : 'Not recorded'}
            {w.key !== 'unknown' && <span className="block text-[11px]">{w.key === 'expired' ? 'Expired' : w.label}</span>}
          </span>
        )
      },
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r._statusLabel, size: 110,
      cell: ({ row }) => <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded ${STATUS_BADGE[row.original.status] || STATUS_BADGE.retired}`}>{row.original._statusLabel}</span>,
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => {
        const who = row.original.asset_no || row.original.serial_no || 'battery'
        return (
          <div className="flex items-center gap-1 justify-end">
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className={`${ICON_BTN} hover:text-[var(--text-primary)]`} aria-label={`Edit ${who}`}><Pencil size={15} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDel(row.original) }} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete ${who}`}><Trash2 size={15} /></button>
          </div>
        )
      },
    },
  ], [openEdit])

  const previewExpiry = form.install_date && form.warranty_months
    ? warrantyExpiry({ install_date: form.install_date, warranty_months: form.warranty_months })
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Battery Lifecycle"
        subtitle="Register, track health, and forecast replacement for every battery across the fleet."
        icon={BatteryCharging}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={14} /> Register battery
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Battery tracking is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V146_BATTERIES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load batteries.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error} The figures below are unavailable until the register loads.</p>
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px]" disabled={refreshing}>Retry</button>
        </div>
      )}

      {notice && (
        <div className="card border border-amber-500/40 flex items-start justify-between gap-3" role="status">
          <p className="text-sm text-amber-300">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Gauge size={15} aria-hidden="true" /> Status distribution</h2>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Unavailable: the register could not be loaded.</div>
                : kpi.total ? (
                  <div className="h-full" role="img" aria-label={BATTERY_STATUSES.map((s) => `${BATTERY_STATUS_META[s].label} ${kpi.byStatus[s]}`).join(', ')}>
                    <Doughnut data={donutData} options={donutOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No batteries registered yet.</div>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <Activity size={15} className="text-amber-400" aria-hidden="true" /> Batteries needing attention
          </h2>
          {loading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : failed ? (
            <p className="text-sm text-[var(--text-muted)]">Unavailable: the register could not be loaded.</p>
          ) : attention.length === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-sm text-[var(--text-muted)] gap-2">
              <Battery size={24} className="text-green-400" aria-hidden="true" /> {kpi.total ? 'All batteries are within healthy limits.' : 'No batteries registered yet.'}
            </div>
          ) : (
            <ul className="max-h-56 overflow-y-auto divide-y divide-[var(--input-border)]">
              {attention.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => openEdit(r)} className="w-full flex items-center justify-between gap-3 py-2 px-1 min-h-[44px] text-left rounded hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">{r.asset_no || r.serial_no || 'N/A'}</p>
                      <p className="text-xs text-[var(--text-muted)] truncate">{r.brand || 'Unknown brand'}{r.site ? `, ${r.site}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-sm font-semibold ${BAND_TEXT[r._band.key]}`}>{r._health == null ? 'Not measured' : `${r._health}%`}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[r.status] || STATUS_BADGE.retired}`}>{r._statusLabel}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,2fr)_1fr_1fr_1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Serial, asset, brand, site, notes" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="all">All statuses</option>
              {BATTERY_STATUSES.map((s) => <option key={s} value={s}>{BATTERY_STATUS_META[s].label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Asset</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.asset} onChange={(e) => setFilter('asset', e.target.value)}>
              <option value="">All assets</option>
              {assets.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Warranty</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.warranty} onChange={(e) => setFilter('warranty', e.target.value)}>
              <option value="all">Any warranty state</option>
              <option value="active">In warranty</option>
              <option value="soon">Ending within {WARRANTY_SOON_DAYS} days</option>
              <option value="expired">Expired</option>
              <option value="unknown">Not recorded</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFilter('attentionOnly', !filters.attentionOnly)}
            aria-pressed={filters.attentionOnly}
            className={`text-sm inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-lg border ${filters.attentionOnly ? 'bg-brand-subtle text-brand-bright border-[var(--accent)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            <AlertTriangle size={14} aria-hidden="true" /> Needs attention
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">{filtered.length} of {kpi.total} batteries</span>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_BATTERY_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={failed ? error : null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        initialPageSize={25}
        viewKey="batteries"
        onRowClick={(r) => openEdit(r)}
        emptyMessage={
          missing ? 'Enable battery tracking to start the register.'
            : kpi.total === 0 ? 'No batteries registered yet. Use Register battery to add the first one.'
              : 'No batteries match these filters.'
        }
      />

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit battery' : 'Register battery'}
        size="md"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Asset number</span>
              <input className="input w-full" placeholder="TRK-014" value={form.asset_no} onChange={(e) => set('asset_no', e.target.value)} maxLength={120} />
            </label>
            <label className="block"><span className="label">Serial number</span>
              <input className="input w-full" placeholder="BAT-2026-00123" value={form.serial_no} onChange={(e) => set('serial_no', e.target.value)} maxLength={120} />
            </label>
            <label className="block"><span className="label">Brand</span>
              <input className="input w-full" placeholder="Exide, Varta, Bosch" value={form.brand} onChange={(e) => set('brand', e.target.value)} maxLength={120} />
            </label>
            <label className="block"><span className="label">Site</span>
              <input className="input w-full" placeholder="Riyadh Depot" value={form.site} onChange={(e) => set('site', e.target.value)} maxLength={120} />
            </label>
            <label className="block"><span className="label">Install date</span>
              <input type="date" className="input w-full" value={form.install_date} onChange={(e) => set('install_date', e.target.value)} />
            </label>
            <label className="block"><span className="label">Warranty (months)</span>
              <input type="number" min="0" className="input w-full" placeholder="24" value={form.warranty_months} onChange={(e) => set('warranty_months', e.target.value)} />
            </label>
            <label className="block"><span className="label">Health %</span>
              <input type="number" min="0" max="100" step="0.1" className="input w-full" placeholder="95" value={form.health_pct} onChange={(e) => set('health_pct', e.target.value)} />
            </label>
            <label className="block"><span className="label">Voltage (V)</span>
              <input type="number" step="0.1" className="input w-full" placeholder="12.6" value={form.voltage} onChange={(e) => set('voltage', e.target.value)} />
            </label>
            <label className="block sm:col-span-2"><span className="label">Status</span>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {BATTERY_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </label>
          </div>
          <label className="block"><span className="label">Notes</span>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="Fitment notes, load test results, supplier" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </label>
          {previewExpiry && (
            <p className="text-xs text-[var(--text-muted)]">
              Warranty expires <span className="font-semibold text-[var(--text-secondary)]">{fmtDate(previewExpiry)}</span>.
            </p>
          )}
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Register battery'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmDel)}
        onClose={() => { if (!deleting) setConfirmDel(null) }}
        title="Delete battery?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDel(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
      >
        {confirmDel && (
          <p className="text-sm text-[var(--text-muted)]">
            This permanently removes battery <span className="font-semibold text-[var(--text-secondary)]">{confirmDel.asset_no || confirmDel.serial_no || confirmDel.id}</span>. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
