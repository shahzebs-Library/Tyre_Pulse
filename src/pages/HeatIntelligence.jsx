/**
 * HeatIntelligence (route /heat-intelligence) — tyre thermal monitoring &
 * overheating detection. Captures timestamped tyre temperature readings per
 * asset/position (manual, telematics, or infrared gun) and turns them into
 * operational intelligence: severity classification, ranked hotspots, and a
 * per-position latest snapshot. Overheating is a leading indicator of bearing
 * failure, dragging brakes, chronic under-inflation, and overload — so every
 * reading is org-isolated and country-scoped.
 *
 * Runs on the new `tyre_temperature_readings` table (V188). Real data, KPI
 * tiles, a hotspots attention panel, a latest-per-position snapshot, filters,
 * search, create/edit modal, delete confirm, Excel/PDF export, and
 * loading/empty/error/not-provisioned states throughout. Classification and
 * roll-ups live in the pure `src/lib/heatIntelligence.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Thermometer, ThermometerSun, Flame, Activity, TrendingUp, Truck,
  AlertTriangle, ShieldAlert, Search, X, Filter, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTemperatureReadings, createTemperatureReading,
  updateTemperatureReading, deleteTemperatureReading,
} from '../lib/api/heatIntelligence'
import {
  summariseHeat, latestPerPosition, hotspots, classifyTemp, tempOverAmbient,
} from '../lib/heatIntelligence'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  asset_no: '', tyre_position: '', tyre_serial: '', temperature_c: '', ambient_c: '',
  pressure_bar: '', speed_kmh: '', threshold_c: '', status: '', location: '',
  recorded_at: '', notes: '',
}

const STATUS_META = {
  critical: { label: 'Critical', badge: 'bg-red-900/40 text-red-300 border-red-800/50', dot: 'bg-red-400', icon: Flame },
  high: { label: 'High', badge: 'bg-orange-900/40 text-orange-300 border-orange-800/50', dot: 'bg-orange-400', icon: ThermometerSun },
  elevated: { label: 'Elevated', badge: 'bg-amber-900/30 text-amber-300 border-amber-800/50', dot: 'bg-amber-400', icon: Thermometer },
  normal: { label: 'Normal', badge: 'bg-emerald-900/30 text-emerald-300 border-emerald-800/50', dot: 'bg-emerald-400', icon: Thermometer },
}

const fmtC = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()} °C`)
const fmtBar = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()} bar`)
const fmtNum = (v, unit) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()}${unit ? ` ${unit}` : ''}`)

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

/** Severity badge — colour-scaled by classification band. */
function StatusBadge({ band }) {
  const meta = STATUS_META[band] || STATUS_META.normal
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${meta.badge}`}>
      <Icon size={11} /> {meta.label}
    </span>
  )
}

/** Temperature cell — text colour scales with the band for at-a-glance scanning. */
function TempCell({ reading }) {
  const band = classifyTemp(reading)
  const color = band === 'critical' ? 'text-red-400'
    : band === 'high' ? 'text-orange-400'
    : band === 'elevated' ? 'text-amber-400'
    : 'text-[var(--text-primary)]'
  return <span className={`font-semibold ${color}`}>{fmtC(reading.temperature_c)}</span>
}

export default function HeatIntelligence() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
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
      const data = await listTemperatureReadings({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load temperature readings.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseHeat(rows || []), [rows])
  const latest = useMemo(() => latestPerPosition(rows || []), [rows])
  const hot = useMemo(() => hotspots(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )
  const positionOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.tyre_position).filter(Boolean))].sort(),
    [rows],
  )
  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (positionFilter && r.tyre_position !== positionFilter) return false
      if (countryFilter && r.country !== countryFilter) return false
      if (statusFilter && classifyTemp(r) !== statusFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.tyre_position || ''} ${r.tyre_serial || ''} ${r.location || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, assetFilter, positionFilter, countryFilter, statusFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Readings logged', value: summary.totalReadings, icon: Activity, tone: 'text-[var(--text-primary)]' },
    { label: 'Critical', value: summary.criticalCount, icon: Flame, tone: 'text-red-400' },
    { label: 'High', value: summary.highCount, icon: ThermometerSun, tone: 'text-orange-400' },
    { label: 'Assets tracked', value: summary.distinctAssets, icon: Truck, tone: 'text-sky-400' },
    { label: 'Max temperature', value: summary.maxTempC == null ? '—' : fmtC(summary.maxTempC), icon: Thermometer, tone: 'text-amber-400' },
    { label: 'Avg temperature', value: summary.avgTempC == null ? '—' : fmtC(Math.round(summary.avgTempC * 10) / 10), icon: TrendingUp, tone: 'text-green-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'tyre_position', 'tyre_serial', 'temperature_c', 'ambient_c', 'rise_c', 'pressure_bar', 'speed_kmh', 'threshold_c', 'status', 'location', 'recorded_at', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Position', 'Serial', 'Temp (°C)', 'Ambient (°C)', 'Rise (°C)', 'Pressure (bar)', 'Speed (km/h)', 'Threshold (°C)', 'Status', 'Location', 'Recorded', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '',
    tyre_position: r.tyre_position || '',
    tyre_serial: r.tyre_serial || '',
    temperature_c: r.temperature_c ?? '',
    ambient_c: r.ambient_c ?? '',
    rise_c: tempOverAmbient(r) ?? '',
    pressure_bar: r.pressure_bar ?? '',
    speed_kmh: r.speed_kmh ?? '',
    threshold_c: r.threshold_c ?? '',
    status: STATUS_META[classifyTemp(r)]?.label || '',
    location: r.location || '',
    recorded_at: r.recorded_at || '',
    notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', tyre_position: r.tyre_position || '', tyre_serial: r.tyre_serial || '',
      temperature_c: r.temperature_c ?? '', ambient_c: r.ambient_c ?? '', pressure_bar: r.pressure_bar ?? '',
      speed_kmh: r.speed_kmh ?? '', threshold_c: r.threshold_c ?? '', status: r.status || '',
      location: r.location || '',
      recorded_at: r.recorded_at ? new Date(r.recorded_at).toISOString().slice(0, 16) : '',
      notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Live severity preview inside the modal
  const previewBand = useMemo(
    () => classifyTemp({ temperature_c: form.temperature_c, threshold_c: form.threshold_c }),
    [form.temperature_c, form.threshold_c],
  )

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      // Auto-classify status from temperature when the user leaves it blank.
      const status = form.status || classifyTemp({ temperature_c: form.temperature_c, threshold_c: form.threshold_c })
      const payload = {
        ...form,
        status,
        recorded_at: form.recorded_at || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateTemperatureReading(editing.id, payload)
      else await createTemperatureReading(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the reading.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTemperatureReading(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the reading.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setAssetFilter(''); setStatusFilter(''); setPositionFilter(''); setCountryFilter(''); setSearch('') }
  const hasFilters = assetFilter || statusFilter || positionFilter || countryFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Heat Intelligence"
        subtitle="Monitor tyre thermal readings and detect overheating early — the leading indicator of bearing failure, dragging brakes, chronic under-inflation, and overload."
        icon={ThermometerSun}
        badge={summary.criticalCount > 0 ? `${summary.criticalCount} critical` : undefined}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'heat_intelligence')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Heat Intelligence', 'heat_intelligence', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log reading
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Heat Intelligence isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V188_TYRE_TEMPERATURE_READINGS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load temperature readings.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Hotspots attention panel */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <ShieldAlert size={15} className="text-red-400" /> Thermal hotspots
          <span className="text-xs font-normal text-[var(--text-muted)]">(high &amp; critical, hottest first)</span>
        </h3>
        {rows === null ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : hot.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] flex items-center gap-2">
            <Thermometer size={15} className="text-emerald-400" /> No tyres reading high or critical — fleet is within safe thermal limits.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {hot.slice(0, 24).map((h, i) => {
              const meta = STATUS_META[h.status] || STATUS_META.high
              const Icon = meta.icon
              return (
                <div key={`${h.asset_no}-${h.tyre_position}-${i}`} className={`rounded-lg border px-3 py-2 ${meta.badge}`}>
                  <div className="flex items-center gap-1.5">
                    <Icon size={13} />
                    <span className="text-xs font-semibold">{h.asset_no || '—'}</span>
                    {h.tyre_position && <span className="text-[11px] opacity-80">· {h.tyre_position}</span>}
                  </div>
                  <p className="text-lg font-bold leading-tight mt-0.5">{fmtC(h.temperature_c)}</p>
                </div>
              )
            })}
            {hot.length > 24 && <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 flex items-center text-xs text-[var(--text-muted)]">+{hot.length - 24} more</div>}
          </div>
        )}
      </div>

      {/* Latest-per-position snapshot */}
      <div className="card overflow-hidden !p-0">
        <div className="px-4 pt-4 pb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Thermometer size={15} /> Latest reading per tyre position
          </h3>
        </div>
        {rows === null ? (
          <div className="px-4 pb-4"><div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" /></div>
        ) : latest.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-[var(--text-muted)]">No readings logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  {['Asset', 'Position', 'Temp', 'Rise vs ambient', 'Pressure', 'Status', 'Recorded'].map((h, i) => <th key={i} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {latest
                  .slice()
                  .sort((a, b) => (Number(b.temperature_c) || -Infinity) - (Number(a.temperature_c) || -Infinity))
                  .slice(0, 40)
                  .map((r) => {
                    const rise = tempOverAmbient(r)
                    return (
                      <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                        <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">{r.tyre_position || '—'}</td>
                        <td className="px-4 py-2"><TempCell reading={r} /></td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">{rise == null ? '—' : `+${fmtC(rise)}`}</td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">{fmtBar(r.pressure_bar)}</td>
                        <td className="px-4 py-2"><StatusBadge band={classifyTemp(r)} /></td>
                        <td className="px-4 py-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.recorded_at)}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, position, serial, location, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} aria-label="Position">
            <option value="">All positions</option>
            {positionOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="elevated">Elevated</option>
            <option value="normal">Normal</option>
          </select>
          {countryOptions.length > 1 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalReadings}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Position', 'Temp', 'Ambient', 'Rise', 'Pressure', 'Speed', 'Status', 'Recorded', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No readings logged yet — log your first thermal reading.' : 'No readings match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const rise = tempOverAmbient(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.tyre_position || '—'}</td>
                      <td className="px-4 py-2.5"><TempCell reading={r} /></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtC(r.ambient_c)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{rise == null ? '—' : `+${fmtC(rise)}`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtBar(r.pressure_bar)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtNum(r.speed_kmh, 'km/h')}</td>
                      <td className="px-4 py-2.5"><StatusBadge band={classifyTemp(r)} /></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.recorded_at)}</td>
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit reading' : 'Log temperature reading'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Tyre position (optional)</label>
                  <input className="input w-full" placeholder="e.g. FL, RRo, Drive-2" value={form.tyre_position} maxLength={60} onChange={(e) => set('tyre_position', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Temperature (°C)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="95" value={form.temperature_c} onChange={(e) => set('temperature_c', e.target.value)} />
                </div>
                <div>
                  <label className="label">Ambient (°C, optional)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="42" value={form.ambient_c} onChange={(e) => set('ambient_c', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Pressure (bar, optional)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="8.5" value={form.pressure_bar} onChange={(e) => set('pressure_bar', e.target.value)} />
                </div>
                <div>
                  <label className="label">Speed (km/h, optional)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="80" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label">Alarm threshold (°C, optional)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="90" value={form.threshold_c} onChange={(e) => set('threshold_c', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Tyre serial (optional)</label>
                  <input className="input w-full" placeholder="e.g. DOT-3521-XT" value={form.tyre_serial} maxLength={120} onChange={(e) => set('tyre_serial', e.target.value)} />
                </div>
                <div>
                  <label className="label">Recorded at (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.recorded_at} onChange={(e) => set('recorded_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Status (optional)</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="">Auto-classify from temperature</option>
                    <option value="normal">Normal</option>
                    <option value="elevated">Elevated</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1 inline-flex items-center gap-1">
                    Live classification: <StatusBadge band={previewBand} />
                  </p>
                </div>
                <div>
                  <label className="label">Location (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh depot, Route 40" value={form.location} maxLength={200} onChange={(e) => set('location', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. infrared gun reading after 4h haul; hub warm to touch" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Log reading'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this reading?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Reading'}{confirmDelete.tyre_position ? ` · ${confirmDelete.tyre_position}` : ''} · {fmtC(confirmDelete.temperature_c)} · {fmtDateTime(confirmDelete.recorded_at)}. This can’t be undone.
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
