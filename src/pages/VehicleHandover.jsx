/**
 * VehicleHandover (route /vehicle-handover) — Vehicle Handover / Condition
 * Reports. Captures check-in / check-out condition records whenever a vehicle
 * changes hands between drivers: outgoing/incoming driver, odometer, fuel level,
 * overall condition, logged damages, cleanliness, and supporting
 * signature/photo evidence. Condition history underpins damage attribution,
 * cost recovery, driver accountability, and downtime analysis, so every report
 * is org-isolated and country-scoped.
 *
 * Runs on the new `handover_reports` table (V181). Real data, KPI tiles,
 * create/edit modal, filters, search, delete confirm, Excel/PDF export, and
 * loading/empty/error states throughout. Fleet KPI roll-ups live in the pure
 * `src/lib/handoverReports.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ClipboardCheck, ArrowLeftRight, LogOut, LogIn, ShieldAlert, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, AlertTriangle, Users,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listHandoverReports, createHandoverReport, updateHandoverReport, deleteHandoverReport,
} from '../lib/api/handoverReports'
import { summariseHandovers, byCondition, damageCount } from '../lib/handoverReports'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const EMPTY_FORM = {
  asset_no: '', report_no: '', handover_type: 'checkout', from_driver: '', to_driver: '',
  handover_at: '', odometer_km: '', fuel_level_pct: '', condition_rating: 'good',
  cleanliness: 'clean', signature_url: '', photo_url: '', notes: '',
}

const TYPE_META = {
  checkout: { label: 'Check-out', icon: LogOut, cls: 'bg-amber-900/30 text-amber-300 border border-amber-800/50' },
  checkin: { label: 'Check-in', icon: LogIn, cls: 'bg-sky-900/30 text-sky-300 border border-sky-800/50' },
}
const CONDITION_META = {
  excellent: { label: 'Excellent', cls: 'bg-emerald-900/30 text-emerald-300 border border-emerald-800/50' },
  good: { label: 'Good', cls: 'bg-green-900/30 text-green-300 border border-green-800/50' },
  fair: { label: 'Fair', cls: 'bg-amber-900/30 text-amber-300 border border-amber-800/50' },
  poor: { label: 'Poor', cls: 'bg-red-900/30 text-red-300 border border-red-800/50' },
}
const CLEANLINESS_OPTIONS = ['clean', 'acceptable', 'dirty']

const fmtKm = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()} km`)
const fmtPct = (v) => (v == null || v === '' ? '—' : `${Number(v)}%`)

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}
/** timestamptz → value for <input type="datetime-local">. */
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

function TypeBadge({ type }) {
  const meta = TYPE_META[type]
  if (!meta) return <span className="text-[var(--text-muted)]">—</span>
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
      <Icon size={11} /> {meta.label}
    </span>
  )
}
function ConditionBadge({ rating }) {
  const meta = CONDITION_META[rating]
  if (!meta) return <span className="text-[var(--text-muted)]">—</span>
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
}

export default function VehicleHandover() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [countryFilter, setCountryFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [conditionFilter, setConditionFilter] = useState('')
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
      const data = await listHandoverReports({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load handover reports.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseHandovers(rows || []), [rows])
  const conditionCounts = useMemo(() => byCondition(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (countryFilter && r.country !== countryFilter) return false
      if (typeFilter && r.handover_type !== typeFilter) return false
      if (conditionFilter && r.condition_rating !== conditionFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.report_no || ''} ${r.from_driver || ''} ${r.to_driver || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, countryFilter, typeFilter, conditionFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Handover reports', value: summary.totalReports, icon: ClipboardCheck, tone: 'text-[var(--text-primary)]' },
    { label: 'Check-outs', value: summary.checkoutCount, icon: LogOut, tone: 'text-amber-400' },
    { label: 'Check-ins', value: summary.checkinCount, icon: LogIn, tone: 'text-sky-400' },
    { label: 'Poor condition', value: summary.poorConditionCount, icon: ShieldAlert, tone: 'text-red-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['report_no', 'asset_no', 'handover_type', 'from_driver', 'to_driver', 'handover_at', 'odometer_km', 'fuel_level_pct', 'condition_rating', 'damage_count', 'cleanliness', 'notes']
  const EXPORT_HEADERS = ['Report #', 'Asset', 'Type', 'From driver', 'To driver', 'Handover at', 'Odometer (km)', 'Fuel (%)', 'Condition', 'Damages', 'Cleanliness', 'Notes']
  const exportRows = filtered.map((r) => ({
    report_no: r.report_no || '', asset_no: r.asset_no || '',
    handover_type: TYPE_META[r.handover_type]?.label || r.handover_type || '',
    from_driver: r.from_driver || '', to_driver: r.to_driver || '',
    handover_at: r.handover_at || '', odometer_km: r.odometer_km ?? '',
    fuel_level_pct: r.fuel_level_pct ?? '',
    condition_rating: CONDITION_META[r.condition_rating]?.label || r.condition_rating || '',
    damage_count: damageCount(r), cleanliness: r.cleanliness || '', notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', report_no: r.report_no || '',
      handover_type: r.handover_type || 'checkout',
      from_driver: r.from_driver || '', to_driver: r.to_driver || '',
      handover_at: toLocalInput(r.handover_at), odometer_km: r.odometer_km ?? '',
      fuel_level_pct: r.fuel_level_pct ?? '', condition_rating: r.condition_rating || 'good',
      cleanliness: r.cleanliness || 'clean', signature_url: r.signature_url || '',
      photo_url: r.photo_url || '', notes: r.notes || '',
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
        handover_at: form.handover_at ? new Date(form.handover_at).toISOString() : null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateHandoverReport(editing.id, payload)
      else await createHandoverReport(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the handover report.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteHandoverReport(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the handover report.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCountryFilter(''); setTypeFilter(''); setConditionFilter(''); setSearch('') }
  const hasFilters = countryFilter || typeFilter || conditionFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Handover"
        subtitle="Record check-in / check-out condition reports each time a vehicle changes hands between drivers — the accountability basis for damage attribution, cost recovery, and downtime analysis."
        icon={ClipboardCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'handover_reports')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Vehicle Handover Reports', 'handover_reports', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New handover
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Vehicle handover reporting isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V181_HANDOVER_REPORTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load handover reports.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Condition mix + damage tally */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <ArrowLeftRight size={15} /> Condition mix
        </h3>
        {rows === null ? (
          <div className="h-12 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : summary.totalReports === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No handover reports recorded yet.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {['excellent', 'good', 'fair', 'poor'].map((c) => (
              <div key={c} className={`rounded-lg px-3 py-2 ${CONDITION_META[c].cls}`}>
                <p className="text-[11px] uppercase tracking-wide opacity-80">{CONDITION_META[c].label}</p>
                <p className="text-lg font-bold leading-tight">{conditionCounts[c] || 0}</p>
              </div>
            ))}
            <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 ml-auto">
              <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Damages logged</p>
              <p className="text-lg font-bold leading-tight text-[var(--text-primary)]">{summary.totalDamages}</p>
            </div>
            <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Assets</p>
              <p className="text-lg font-bold leading-tight text-[var(--text-primary)]">{summary.distinctAssets}</p>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, report #, driver, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Handover type">
            <option value="">All types</option>
            <option value="checkout">Check-out</option>
            <option value="checkin">Check-in</option>
          </select>
          <select className="input" value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)} aria-label="Condition">
            <option value="">All conditions</option>
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalReports}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Type', 'Drivers', 'Handover at', 'Odometer', 'Fuel', 'Condition', 'Damages', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No handover reports recorded yet — record your first handover.' : 'No reports match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</div>
                      {r.report_no && <div className="text-[11px] text-[var(--text-muted)]">{r.report_no}</div>}
                    </td>
                    <td className="px-4 py-2.5"><TypeBadge type={r.handover_type} /></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <Users size={13} className="text-[var(--text-muted)] shrink-0" />
                        <span>{r.from_driver || '—'}</span>
                        <ArrowLeftRight size={12} className="text-[var(--text-muted)] shrink-0" />
                        <span>{r.to_driver || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.handover_at)}</td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] whitespace-nowrap">{fmtKm(r.odometer_km)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtPct(r.fuel_level_pct)}</td>
                    <td className="px-4 py-2.5"><ConditionBadge rating={r.condition_rating} /></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      {damageCount(r) > 0
                        ? <span className="inline-flex items-center gap-1 text-amber-400 font-medium"><ShieldAlert size={13} /> {damageCount(r)}</span>
                        : <span className="text-[var(--text-muted)]">0</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
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

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit handover report' : 'New handover report'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Report # (optional)</label>
                  <input className="input w-full" placeholder="e.g. HO-2026-0091" value={form.report_no} maxLength={120} onChange={(e) => set('report_no', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Handover type</label>
                  <select className="input w-full" value={form.handover_type} onChange={(e) => set('handover_type', e.target.value)}>
                    <option value="checkout">Check-out</option>
                    <option value="checkin">Check-in</option>
                  </select>
                </div>
                <div>
                  <label className="label">Handover date &amp; time</label>
                  <input className="input w-full" type="datetime-local" value={form.handover_at} onChange={(e) => set('handover_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">From driver (outgoing)</label>
                  <input className="input w-full" placeholder="e.g. A. Rahman" value={form.from_driver} maxLength={200} onChange={(e) => set('from_driver', e.target.value)} />
                </div>
                <div>
                  <label className="label">To driver (incoming)</label>
                  <input className="input w-full" placeholder="e.g. M. Salah" value={form.to_driver} maxLength={200} onChange={(e) => set('to_driver', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Odometer (km)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="45000" value={form.odometer_km} onChange={(e) => set('odometer_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Fuel level (%)</label>
                  <input className="input w-full" type="number" step="1" min="0" max="100" placeholder="75" value={form.fuel_level_pct} onChange={(e) => set('fuel_level_pct', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Overall condition</label>
                  <select className="input w-full" value={form.condition_rating} onChange={(e) => set('condition_rating', e.target.value)}>
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                  </select>
                </div>
                <div>
                  <label className="label">Cleanliness</label>
                  <select className="input w-full" value={form.cleanliness} onChange={(e) => set('cleanliness', e.target.value)}>
                    {CLEANLINESS_OPTIONS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Signature URL (optional)</label>
                  <input className="input w-full" placeholder="https://…" value={form.signature_url} maxLength={2000} onChange={(e) => set('signature_url', e.target.value)} />
                </div>
                <div>
                  <label className="label">Photo URL (optional)</label>
                  <input className="input w-full" placeholder="https://…" value={form.photo_url} maxLength={2000} onChange={(e) => set('photo_url', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. minor scratch on rear left panel, noted at handover" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Record handover'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this handover report?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Report'} · {TYPE_META[confirmDelete.handover_type]?.label || '—'} · {fmtDateTime(confirmDelete.handover_at)}. This can’t be undone.
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
