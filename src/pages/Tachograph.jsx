/**
 * Tachograph (route /tachograph): Tachograph Records. Captures EU driver
 * tachograph download records (driver card or vehicle unit) with aggregated
 * driving / rest / work / availability minutes, distance, and infringements.
 * This is the compliance backbone for driver-hours (EC 561/2006) analytics, so
 * every record is org-isolated and country-scoped.
 *
 * Runs on the `tachograph_records` table (V183). Real data only: KPI strip, a
 * per-driver infringement roll-up, filters + search, a sortable paged
 * EnterpriseTable, create/edit dialog, delete confirm, Excel/PDF export of the
 * whole filtered set, and loading / empty / error+Retry / not-provisioned
 * states. All calculation lives in the pure `src/lib/tachographAnalytics.js`
 * engine (built on `src/lib/tachographRecords.js`).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  FileClock, Users, ShieldAlert, ShieldCheck, BadgeAlert, AlertTriangle, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Timer, Gauge, CalendarDays,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTachographRecords, createTachographRecord, updateTachographRecord,
  deleteTachographRecord,
} from '../lib/api/tachographRecords'
import {
  tachographKpis, byDriver, hasInfringement, filterTachograph, optionsFor,
  tachographExportRows, EXPORT_COLS, EXPORT_HEADERS, fmtDuration,
  fmtInfringementTypes, parseInfringementTypes, DOWNLOAD_TYPES, TACHO_STATUSES,
  DL_LABEL, STATUS_LABEL,
} from '../lib/tachographAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  driver_name: '', asset_no: '', card_number: '', record_date: '',
  download_type: '', driving_min: '', rest_min: '', work_min: '',
  available_min: '', distance_km: '', infringement_count: '',
  infringement_types: '', status: '', notes: '',
}

// Semantic status tints (meaning, not decoration) with a text label, so colour
// is never the only signal.
const STATUS_BADGE = {
  downloaded: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  reviewed: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  flagged: 'bg-red-500/15 text-red-500 border-red-500/30',
  archived: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
const fmtKm = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} km`)

function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums break-words ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function Tachograph() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [countryFilter, setCountryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
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
      const data = await listTachographRecords({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load tachograph records.')); setRows((prev) => prev ?? null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loaded = Array.isArray(rows)
  // A failed first read is NOT "no records": KPIs stay N/A until a read succeeds.
  const kpi = useMemo(() => (loaded ? tachographKpis(rows, { now: Date.now() }) : null), [rows, loaded])
  const drivers = useMemo(() => byDriver(rows || []), [rows])
  const countryOptions = useMemo(() => optionsFor(rows || [], 'country'), [rows])

  const filtered = useMemo(
    () => filterTachograph(rows || [], { country: countryFilter, status: statusFilter, type: typeFilter, search }),
    [rows, countryFilter, statusFilter, typeFilter, search],
  )
  const exportRows = useMemo(() => tachographExportRows(filtered), [filtered])
  const fileBase = () => reportFileName('TyrePulse Tachograph Records', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())

  const doExport = async (kind) => {
    setActionError('')
    try {
      if (kind === 'xlsx') await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase(), 'Tachograph', { title: 'Tachograph Records' })
      else await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tachograph Records', fileBase(), 'landscape')
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      driver_name: r.driver_name || '', asset_no: r.asset_no || '',
      card_number: r.card_number || '', record_date: r.record_date || '',
      download_type: r.download_type || '', driving_min: r.driving_min ?? '',
      rest_min: r.rest_min ?? '', work_min: r.work_min ?? '',
      available_min: r.available_min ?? '', distance_km: r.distance_km ?? '',
      infringement_count: r.infringement_count ?? '',
      infringement_types: fmtInfringementTypes(r.infringement_types),
      status: r.status || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.driver_name.trim()) { setFormError('A driver name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        infringement_types: parseInfringementTypes(form.infringement_types),
        download_type: form.download_type || null,
        status: form.status || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateTachographRecord(editing.id, payload)
      else await createTachographRecord(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the record.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTachographRecord(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the record.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCountryFilter(''); setStatusFilter(''); setTypeFilter(''); setSearch('') }
  const hasFilters = countryFilter || statusFilter || typeFilter || search

  const columns = useMemo(() => [
    {
      id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || '', size: 180,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.driver_name || 'N/A'}</span>,
    },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 110 },
    {
      id: 'date', header: 'Record date', accessorFn: (r) => r.record_date || '', size: 120,
      cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.record_date)}</span>,
      meta: { exportValue: (r) => r.record_date || '' },
    },
    { id: 'type', header: 'Type', accessorFn: (r) => DL_LABEL[r.download_type] || 'N/A', size: 120 },
    {
      id: 'driving', header: 'Driving', accessorFn: (r) => (r.driving_min == null || r.driving_min === '' ? -1 : Number(r.driving_min)), size: 100,
      cell: ({ row }) => <span className="tabular-nums whitespace-nowrap">{fmtDuration(row.original.driving_min)}</span>, meta: { align: 'right' },
    },
    {
      id: 'rest', header: 'Rest', accessorFn: (r) => (r.rest_min == null || r.rest_min === '' ? -1 : Number(r.rest_min)), size: 100,
      cell: ({ row }) => <span className="tabular-nums whitespace-nowrap">{fmtDuration(row.original.rest_min)}</span>, meta: { align: 'right' },
    },
    {
      id: 'distance', header: 'Distance', accessorFn: (r) => (r.distance_km == null || r.distance_km === '' ? -1 : Number(r.distance_km)), size: 110,
      cell: ({ row }) => <span className="tabular-nums whitespace-nowrap">{fmtKm(row.original.distance_km)}</span>, meta: { align: 'right' },
    },
    {
      id: 'infringements', header: 'Infringements', accessorFn: (r) => Number(r.infringement_count) || (hasInfringement(r) ? 1 : 0), size: 130,
      cell: ({ row }) => {
        const r = row.original
        const count = Number(r.infringement_count) || 0
        return hasInfringement(r) ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-500">
            <ShieldAlert size={12} aria-hidden="true" /> {count > 0 ? count : 'Over limit'}
          </span>
        ) : <span className="text-xs text-[var(--text-muted)]">None</span>
      },
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => STATUS_LABEL[r.status] || r.status || 'N/A', size: 120,
      meta: { filterVariant: 'select' },
      cell: ({ row }) => {
        const s = row.original.status
        return s ? (
          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s] || STATUS_BADGE.archived}`}>
            {STATUS_LABEL[s] || s}
          </span>
        ) : 'N/A'
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit record for ${row.original.driver_name || 'driver'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Delete record for ${row.original.driver_name || 'driver'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  const na = (v) => (kpi == null || v == null ? 'N/A' : v)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tachograph Records"
        subtitle="EU driver tachograph downloads: driving, rest and work time with infringement tracking for EC 561/2006 compliance."
        icon={FileClock}
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
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> Add record
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Tachograph records are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V183_TACHOGRAPH_RECORDS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {actionError && (
        <div role="alert" className="card border border-red-500/40 flex items-start justify-between gap-3">
          <p className="text-sm text-red-500">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Records" value={na(kpi?.totalRecords)} sub={kpi ? `${kpi.recordsInWindow} in last ${kpi.windowDays} days` : null} icon={FileClock} tone="text-[var(--text-primary)]" />
        <Kpi label="Drivers" value={na(kpi?.distinctDrivers)} icon={Users} tone="text-sky-500" />
        <Kpi label="Infringements" value={na(kpi?.totalInfringements)} sub={kpi ? `${kpi.overDriveDays} over the 9h daily limit` : null} icon={ShieldAlert} tone="text-red-500" />
        <Kpi label="Compliance rate" value={kpi?.complianceRate == null ? 'N/A' : `${kpi.complianceRate}%`} sub={kpi ? `${kpi.infringingRecords} record(s) with an infringement` : null} icon={ShieldCheck} tone="text-emerald-500" />
        <Kpi label="Avg driving / record" value={kpi?.avgDrivingMin == null ? 'N/A' : fmtDuration(kpi.avgDrivingMin)} sub={kpi?.totalDistanceKm == null ? 'No distance recorded' : `${kpi.totalDistanceKm.toLocaleString()} km total`} icon={Timer} tone="text-indigo-500" />
        <Kpi label="Flagged" value={na(kpi?.flaggedCount)} icon={BadgeAlert} tone="text-amber-500" />
      </div>

      {/* By-driver infringement roll-up */}
      <section className="card" aria-labelledby="tacho-drivers">
        <h2 id="tacho-drivers" className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Gauge size={15} aria-hidden="true" /> Infringements by driver
        </h2>
        {rows === null && !error ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : rows === null ? (
          <p className="text-sm text-[var(--text-muted)]">Unavailable until the records load.</p>
        ) : drivers.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No tachograph records yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {drivers.slice(0, 12).map((d) => (
              <button
                type="button"
                key={d.driver_name}
                onClick={() => setSearch(d.driver_name)}
                className={`text-left rounded-lg border px-3 py-2 min-h-[44px] ${d.infringements > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-[var(--input-border)] bg-[var(--input-bg)]'}`}
                aria-label={`Show records for ${d.driver_name}`}
              >
                <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 truncate">
                  {d.infringements > 0 && <ShieldAlert size={11} className="text-red-500" aria-hidden="true" />} {d.driver_name}
                </p>
                <p className={`text-sm font-semibold ${d.infringements > 0 ? 'text-red-500' : 'text-[var(--text-primary)]'}`}>
                  {d.infringements} infringement{d.infringements === 1 ? '' : 's'}
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">{d.records} record{d.records === 1 ? '' : 's'}, {fmtDuration(d.drivingMin)} driving</p>
              </button>
            ))}
          </div>
        )}
        {drivers.length > 12 && <p className="text-xs text-[var(--text-muted)] mt-2">Showing the 12 highest-risk of {drivers.length} drivers. Search a name to see any driver.</p>}
      </section>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="tacho-search" className="sr-only">Search tachograph records</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="tacho-search" className="input pl-9 w-full min-h-[44px]" placeholder="Search driver, asset, card, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
            <option value="">All countries</option>
            {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {TACHO_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Download type">
            <option value="">All download types</option>
            {DOWNLOAD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto self-center" aria-live="polite">{filtered.length} of {kpi ? kpi.totalRecords : 'N/A'}</span>
        </div>
      </div>

      {/* Register */}
      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={rows === null && !error}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        viewKey="tachograph-records"
        emptyMessage={
          notProvisioned ? 'Tachograph records are not provisioned yet.'
            : (rows || []).length === 0 ? 'No tachograph records yet. Add your first record.'
              : 'No records match these filters.'
        }
        emptyIcon={<CalendarDays size={22} className="opacity-60" />}
      />

      {/* Create / Edit dialog */}
      <Modal
        open={showModal}
        onClose={closeModal}
        size="lg"
        title={editing ? 'Edit record' : 'Add tachograph record'}
        closeOnBackdrop={!saving}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="tacho-form" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Add record'}
            </button>
          </div>
        }
      >
        <form id="tacho-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="tf-driver">Driver name *</label>
              <input id="tf-driver" className="input w-full" placeholder="e.g. J. Kowalski" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} required aria-invalid={Boolean(formError && !form.driver_name.trim())} />
            </div>
            <div>
              <label className="label" htmlFor="tf-asset">Asset number (optional)</label>
              <input id="tf-asset" className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label" htmlFor="tf-card">Card number (optional)</label>
              <input id="tf-card" className="input w-full" placeholder="Driver card number" value={form.card_number} maxLength={120} onChange={(e) => set('card_number', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="tf-date">Record date</label>
              <input id="tf-date" className="input w-full" type="date" value={form.record_date} onChange={(e) => set('record_date', e.target.value)} aria-describedby="tf-date-help" />
              <p id="tf-date-help" className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use today.</p>
            </div>
            <div>
              <label className="label" htmlFor="tf-type">Download type</label>
              <select id="tf-type" className="input w-full" value={form.download_type} onChange={(e) => set('download_type', e.target.value)}>
                <option value="">None</option>
                {DOWNLOAD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <fieldset className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <legend className="sr-only">Activity minutes</legend>
            {[['driving_min', 'Driving (min)'], ['rest_min', 'Rest (min)'], ['work_min', 'Work (min)'], ['available_min', 'Available (min)']].map(([k, l]) => (
              <div key={k}>
                <label className="label" htmlFor={`tf-${k}`}>{l}</label>
                <input id={`tf-${k}`} className="input w-full" type="number" step="1" min="0" placeholder="0" value={form[k]} onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
          </fieldset>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label" htmlFor="tf-dist">Distance (km)</label>
              <input id="tf-dist" className="input w-full" type="number" step="0.1" min="0" placeholder="0" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="tf-infr">Infringement count</label>
              <input id="tf-infr" className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.infringement_count} onChange={(e) => set('infringement_count', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="tf-status">Status</label>
              <select id="tf-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">None</option>
                {TACHO_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="tf-types">Infringement types (optional)</label>
            <input id="tf-types" className="input w-full" placeholder="e.g. Daily driving exceeded, Insufficient rest" value={form.infringement_types} onChange={(e) => set('infringement_types', e.target.value)} aria-describedby="tf-types-help" />
            <p id="tf-types-help" className="text-[11px] text-[var(--text-muted)] mt-1">Comma-separated, or a JSON array/object.</p>
          </div>
          <div>
            <label className="label" htmlFor="tf-notes">Notes (optional)</label>
            <textarea id="tf-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. reviewed against roster" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => !deleting && setConfirmDelete(null)}
        size="sm"
        title="Delete this record?"
        closeOnBackdrop={!deleting}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-secondary)]">
            {confirmDelete.driver_name || 'Record'}, {fmtDate(confirmDelete.record_date)}, {fmtDuration(confirmDelete.driving_min)} driving. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
