/**
 * DriverTraining (route /driver-training) — Driver Training Records. Captures
 * the training courses and certifications completed by drivers (defensive
 * driving, hazmat, first aid, vehicle-specific, induction, compliance) along
 * with completion dates, scores, results, and — critically — certification
 * expiry dates that drive renewal planning and compliance risk.
 *
 * Runs on the new `driver_training` table (V182). Real data, KPI tiles, an
 * expiring/expired attention strip, create/edit modal, filters, search, delete
 * confirm, Excel/PDF export, and loading/empty/error states throughout.
 * Certification-currency and KPI logic live in the pure
 * `src/lib/driverTraining.js` helpers (deterministic, unit-tested).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  GraduationCap, Users, ShieldCheck, CalendarClock, Clock, BadgeCheck,
  AlertTriangle, Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil,
  Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDriverTraining, createDriverTrainingRecord, updateDriverTrainingRecord,
  deleteDriverTrainingRecord,
} from '../lib/api/driverTraining'
import {
  summariseTraining, byCategory, daysUntilExpiry, expiryStatus,
} from '../lib/driverTraining'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  driver_name: '', course_name: '', category: '', provider: '',
  completed_date: '', expiry_date: '', score: '', pass_mark: '', result: '',
  certificate_no: '', certificate_url: '', cost: '', currency: '', notes: '',
}

const CATEGORY_OPTIONS = [
  { value: 'defensive', label: 'Defensive Driving' },
  { value: 'hazmat', label: 'Hazmat' },
  { value: 'first_aid', label: 'First Aid' },
  { value: 'vehicle_specific', label: 'Vehicle Specific' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'induction', label: 'Induction' },
  { value: 'other', label: 'Other' },
]
const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map((c) => [c.value, c.label]))

const RESULT_OPTIONS = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'pending', label: 'Pending' },
]

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

const RESULT_BADGE = {
  pass: 'bg-green-900/30 text-green-300 border-green-800/50',
  fail: 'bg-red-900/30 text-red-300 border-red-800/50',
  pending: 'bg-slate-700/40 text-[var(--text-secondary)] border-[var(--input-border)]',
}

const EXPIRY_BADGE = {
  expired: 'bg-red-900/30 text-red-300 border-red-800/50',
  expiring_soon: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  valid: 'bg-green-900/30 text-green-300 border-green-800/50',
  unknown: 'bg-slate-700/40 text-[var(--text-muted)] border-[var(--input-border)]',
}

function expiryLabel(status, days) {
  if (status === 'expired') return days == null ? 'Expired' : `Expired ${Math.abs(days)}d ago`
  if (status === 'expiring_soon') return days === 0 ? 'Expires today' : `${days}d left`
  if (status === 'valid') return 'Valid'
  return 'No expiry'
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function DriverTraining() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [categoryFilter, setCategoryFilter] = useState('')
  const [resultFilter, setResultFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Single clock read per render pass, threaded into the pure helpers so the
  // component and its derived memos all agree on "now".
  const nowMs = Date.now()

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listDriverTraining({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load driver training records.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseTraining(rows || [], nowMs), [rows, nowMs])
  const categories = useMemo(() => byCategory(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (categoryFilter && r.category !== categoryFilter) return false
      if (resultFilter && r.result !== resultFilter) return false
      if (countryFilter && r.country !== countryFilter) return false
      if (q) {
        const hay = `${r.driver_name || ''} ${r.course_name || ''} ${r.provider || ''} ${r.certificate_no || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, categoryFilter, resultFilter, countryFilter, search])

  // Records needing attention (expired first, then soonest expiring).
  const attention = useMemo(() => {
    return (rows || [])
      .map((r) => ({ r, status: expiryStatus(r, nowMs), days: daysUntilExpiry(r, nowMs) }))
      .filter((x) => x.status === 'expired' || x.status === 'expiring_soon')
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
  }, [rows, nowMs])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Training records', value: summary.totalRecords, icon: GraduationCap, tone: 'text-[var(--text-primary)]' },
    { label: 'Drivers trained', value: summary.distinctDrivers, icon: Users, tone: 'text-sky-400' },
    { label: 'Expired certs', value: summary.expiredCount, icon: AlertTriangle, tone: summary.expiredCount > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Expiring ≤30d', value: summary.expiringSoonCount, icon: CalendarClock, tone: summary.expiringSoonCount > 0 ? 'text-amber-400' : 'text-green-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = [
    'driver_name', 'course_name', 'category', 'provider', 'completed_date',
    'expiry_date', 'expiry_status', 'result', 'score', 'certificate_no', 'cost',
  ]
  const EXPORT_HEADERS = [
    'Driver', 'Course', 'Category', 'Provider', 'Completed', 'Expiry',
    'Expiry status', 'Result', 'Score', 'Certificate', 'Cost',
  ]
  const exportRows = filtered.map((r) => ({
    driver_name: r.driver_name || '',
    course_name: r.course_name || '',
    category: CATEGORY_LABEL[r.category] || r.category || '',
    provider: r.provider || '',
    completed_date: r.completed_date || '',
    expiry_date: r.expiry_date || '',
    expiry_status: expiryStatus(r, nowMs),
    result: r.result || '',
    score: r.score ?? '',
    certificate_no: r.certificate_no || '',
    cost: r.cost ?? '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      driver_name: r.driver_name || '', course_name: r.course_name || '',
      category: r.category || '', provider: r.provider || '',
      completed_date: r.completed_date || '', expiry_date: r.expiry_date || '',
      score: r.score ?? '', pass_mark: r.pass_mark ?? '', result: r.result || '',
      certificate_no: r.certificate_no || '', certificate_url: r.certificate_url || '',
      cost: r.cost ?? '', currency: r.currency || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
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
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateDriverTrainingRecord(editing.id, payload)
      else await createDriverTrainingRecord(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the training record.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteDriverTrainingRecord(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the training record.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCategoryFilter(''); setResultFilter(''); setCountryFilter(''); setSearch('') }
  const hasFilters = categoryFilter || resultFilter || countryFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Training Records"
        subtitle="Track driver training courses and certifications — completion, scores, results, and expiry dates that drive renewal planning and compliance."
        icon={GraduationCap}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'driver_training')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Driver Training Records', 'driver_training', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Add record
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Driver training tracking isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V182_DRIVER_TRAINING.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load driver training records.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Expiring / expired attention strip */}
      {rows !== null && attention.length > 0 && (
        <div className="card border border-amber-800/40">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Clock size={15} className="text-amber-400" /> Certifications needing attention
            <span className="text-xs text-[var(--text-muted)] font-normal">({attention.length})</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {attention.slice(0, 24).map(({ r, status, days }) => (
              <button
                key={r.id}
                onClick={() => openEdit(r)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${EXPIRY_BADGE[status]}`}
              >
                <p className="text-xs font-semibold">{r.driver_name || '—'}</p>
                <p className="text-[11px] opacity-90">{CATEGORY_LABEL[r.category] || r.course_name || 'Training'}</p>
                <p className="text-[11px] font-medium mt-0.5">{expiryLabel(status, days)} · {fmtDate(r.expiry_date)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Category breakdown */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <BadgeCheck size={15} /> Training by category
        </h3>
        {rows === null ? (
          <div className="h-12 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : categories.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No categorised training records yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <div key={c.category} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                <p className="text-xs text-[var(--text-muted)]">{CATEGORY_LABEL[c.category] || c.category}</p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{c.count}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search driver, course, provider, certificate…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select className="input" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} aria-label="Result">
            <option value="">All results</option>
            {RESULT_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalRecords}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Driver', 'Course', 'Category', 'Completed', 'Expiry', 'Result', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No training records yet — add your first record.' : 'No records match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const status = expiryStatus(r, nowMs)
                  const days = daysUntilExpiry(r, nowMs)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.driver_name || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.course_name || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{CATEGORY_LABEL[r.category] || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.completed_date)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${EXPIRY_BADGE[status]}`}>
                          {expiryLabel(status, days)}
                        </span>
                        <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">{fmtDate(r.expiry_date)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {r.result ? (
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${RESULT_BADGE[r.result] || RESULT_BADGE.pending}`}>
                            {r.result}
                          </span>
                        ) : <span className="text-[var(--text-muted)]">—</span>}
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit training record' : 'Add training record'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Driver name</label>
                  <input className="input w-full" placeholder="e.g. Ahmed Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Course name</label>
                  <input className="input w-full" placeholder="e.g. Advanced Defensive Driving" value={form.course_name} maxLength={200} onChange={(e) => set('course_name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Category</label>
                  <select className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    <option value="">Select category…</option>
                    {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Provider</label>
                  <input className="input w-full" placeholder="Training provider" value={form.provider} maxLength={200} onChange={(e) => set('provider', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Completed date</label>
                  <input className="input w-full" type="date" value={form.completed_date} onChange={(e) => set('completed_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Expiry date</label>
                  <input className="input w-full" type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank if the certification does not expire.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Result</label>
                  <select className="input w-full" value={form.result} onChange={(e) => set('result', e.target.value)}>
                    <option value="">—</option>
                    {RESULT_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Score</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="e.g. 92" value={form.score} onChange={(e) => set('score', e.target.value)} />
                </div>
                <div>
                  <label className="label">Pass mark</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="e.g. 70" value={form.pass_mark} onChange={(e) => set('pass_mark', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Certificate no.</label>
                  <input className="input w-full" placeholder="Cert / reference no." value={form.certificate_no} maxLength={120} onChange={(e) => set('certificate_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Cost</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="0.00" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Certificate URL (optional)</label>
                <input className="input w-full" placeholder="https://…" value={form.certificate_url} maxLength={2000} onChange={(e) => set('certificate_url', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. refresher required annually" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add record'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this training record?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.driver_name || 'Record'} · {CATEGORY_LABEL[confirmDelete.category] || confirmDelete.course_name || 'Training'} · {fmtDate(confirmDelete.completed_date)}. This can’t be undone.
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
