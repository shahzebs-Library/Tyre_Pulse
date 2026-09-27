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
  Trash2, RefreshCw, Percent, Target, Wallet, PieChart,
} from 'lucide-react'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import { formatCurrencyCompact } from '../lib/formatters'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDriverTraining, createDriverTrainingRecord, updateDriverTrainingRecord,
  deleteDriverTrainingRecord,
} from '../lib/api/driverTraining'
import { daysUntilExpiry, expiryStatus } from '../lib/driverTraining'
import { analyzeTraining, filterTraining, attentionList, EXPIRY_BUCKETS, EXPIRY_BUCKET_LABEL } from '../lib/driverTrainingAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend)

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
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
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

// Semantic expiry colours (meaning-bearing, deliberately not palettized).
const EXPIRY_CHART = { expired: '#ef4444', expiring_soon: '#f59e0b', valid: '#22c55e', unknown: '#94a3b8' }

function expiryLabel(status, days) {
  if (status === 'expired') return days == null ? 'Expired' : `Expired ${Math.abs(days)}d ago`
  if (status === 'expiring_soon') return days === 0 ? 'Expires today' : `${days}d left`
  if (status === 'valid') return 'Valid'
  return 'No expiry'
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
  const [expiryFilter, setExpiryFilter] = useState('')
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
      else setError(toUserMessage(err, 'Could not load driver training records.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  // A failed read is not "no records": figures read N/A until a retry works.
  const unknown = loading || !!error

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(
    () => filterTraining(rows || [], {
      category: categoryFilter, result: resultFilter, country: countryFilter, expiry: expiryFilter, search,
    }, nowMs),
    // nowMs is a per-render clock; day granularity makes it stable enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, categoryFilter, resultFilter, countryFilter, expiryFilter, search],
  )
  const all = useMemo(() => analyzeTraining(rows || [], nowMs), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(() => analyzeTraining(filtered, nowMs), [filtered]) // eslint-disable-line react-hooks/exhaustive-deps
  const attention = useMemo(() => attentionList(rows || [], nowMs), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const vk = view.kpis

  const na = (v, fmt = (x) => x) => (unknown || v == null ? 'N/A' : fmt(v))
  const costText = unknown ? 'N/A'
    : vk.mixedCurrency ? 'Mixed currencies'
      : vk.totalCost == null ? 'N/A'
        : formatCurrencyCompact(vk.totalCost, vk.costCurrency || undefined)

  // ── KPIs (all follow the active filters) ─────────────────────────────────
  const kpis = [
    { label: 'Training records', value: na(vk.totalRecords), sub: `${vk.distinctDrivers} drivers`, icon: GraduationCap, tone: 'text-[var(--text-primary)]' },
    { label: 'Drivers trained', value: na(vk.distinctDrivers), sub: `${vk.driversWithExpired} with an expired cert`, icon: Users, tone: 'text-sky-400' },
    { label: 'Pass rate', value: na(vk.passRate, (x) => `${x}%`), sub: `${vk.passCount + vk.failCount} with a result`, icon: Percent, tone: 'text-emerald-400' },
    { label: 'Average score', value: na(vk.avgScore), sub: 'recorded scores only', icon: Target, tone: 'text-indigo-400' },
    { label: 'Certs current', value: na(vk.currencyRate, (x) => `${x}%`), sub: 'of certs with an expiry', icon: ShieldCheck, tone: 'text-green-400' },
    { label: 'Expired certs', value: na(vk.expiredCount), sub: 'renew now', icon: AlertTriangle, tone: vk.expiredCount > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Expiring in 30 days', value: na(vk.expiringSoonCount), sub: 'plan renewal', icon: CalendarClock, tone: vk.expiringSoonCount > 0 ? 'text-amber-400' : 'text-green-400' },
    { label: 'Training cost', value: costText, sub: `${vk.costedCount} costed records`, icon: Wallet, tone: 'text-[var(--brand-bright)]' },
  ]

  // ── Charts ───────────────────────────────────────────────────────────────
  const catData = useMemo(() => ({
    labels: view.categories.map((c) => CATEGORY_LABEL[c.category] || (c.category === 'uncategorised' ? 'Uncategorised' : c.category)),
    datasets: [{
      label: 'Records', data: view.categories.map((c) => c.count),
      backgroundColor: withAlpha(colorAt(0), 0.6), borderColor: colorAt(0), borderWidth: 1, borderRadius: 4,
    }],
  }), [view.categories])
  const catOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { afterLabel: (ctx) => { const c = view.categories[ctx.dataIndex]; return c.passRate == null ? 'Pass rate: N/A' : `Pass rate: ${c.passRate}%` } } },
    },
    scales: {
      x: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
      y: { ticks: { color: 'var(--text-secondary)', font: { size: 11 } }, grid: { display: false } },
    },
  }
  const expiryData = useMemo(() => ({
    labels: view.expiry.map((b) => b.label),
    datasets: [{ data: view.expiry.map((b) => b.count), backgroundColor: view.expiry.map((b) => EXPIRY_CHART[b.key]), borderColor: 'var(--card-bg)', borderWidth: 2 }],
  }), [view.expiry])
  const expiryOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '62%',
    plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12 } } },
  }

  // ── Register columns ─────────────────────────────────────────────────────
  const columns = useMemo(() => [
    { id: 'driver_name', header: 'Driver', accessorFn: (r) => r.driver_name || 'N/A', size: 170,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.driver_name || 'N/A'}</span> },
    { id: 'course_name', header: 'Course', accessorFn: (r) => r.course_name || 'N/A', size: 200 },
    { id: 'category', header: 'Category', accessorFn: (r) => CATEGORY_LABEL[r.category] || 'N/A', size: 140 },
    { id: 'provider', header: 'Provider', accessorFn: (r) => r.provider || 'N/A', size: 140 },
    { id: 'completed_date', header: 'Completed', accessorFn: (r) => r.completed_date || '', size: 120, cell: ({ row }) => fmtDate(row.original.completed_date) },
    {
      id: 'expiry', header: 'Expiry', size: 160, accessorFn: (r) => { const d = daysUntilExpiry(r, nowMs); return d == null ? Number.POSITIVE_INFINITY : d },
      meta: { exportValue: (r) => expiryLabel(expiryStatus(r, nowMs), daysUntilExpiry(r, nowMs)) },
      cell: ({ row }) => {
        const status = expiryStatus(row.original, nowMs)
        const days = daysUntilExpiry(row.original, nowMs)
        return (
          <span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${EXPIRY_BADGE[status]}`}>{expiryLabel(status, days)}</span>
            <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">{fmtDate(row.original.expiry_date)}</span>
          </span>
        )
      },
    },
    {
      id: 'result', header: 'Result', accessorFn: (r) => r.result || 'N/A', size: 110,
      cell: ({ row }) => (row.original.result
        ? <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${RESULT_BADGE[row.original.result] || RESULT_BADGE.pending}`}>{row.original.result}</span>
        : <span className="text-[var(--text-muted)]">N/A</span>),
    },
    { id: 'score', header: 'Score', accessorFn: (r) => (r.score == null || r.score === '' ? null : Number(r.score)), sortUndefined: 'last', size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.score == null || row.original.score === '' ? 'N/A' : row.original.score}</span> },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)]" aria-label={`Edit training record for ${row.original.driver_name || 'driver'}`}><Pencil size={14} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400" aria-label={`Delete training record for ${row.original.driver_name || 'driver'}`}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ], []) // eslint-disable-line react-hooks/exhaustive-deps

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
      setFormError(toUserMessage(err, 'Could not save the training record.'))
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
      setError(toUserMessage(err, 'Could not delete the training record.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCategoryFilter(''); setResultFilter(''); setCountryFilter(''); setExpiryFilter(''); setSearch('') }
  const hasFilters = categoryFilter || resultFilter || countryFilter || expiryFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Training Records"
        subtitle="Track driver training courses and certifications: completion, scores, results, and expiry dates that drive renewal planning and compliance."
        icon={GraduationCap}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, reportFileName('Driver Training Records', activeCountry)) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Driver Training Records', reportFileName('Driver Training Records', activeCountry), 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
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
            <p className="text-amber-300 font-medium">Driver training tracking is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V182_DRIVER_TRAINING.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-800/50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div><p className="text-red-300 font-medium">Could not load driver training records.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {/* KPI tiles (follow the active filters) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>
              {!unknown && k.sub && <p className="text-xs text-[var(--text-muted)] mt-1">{k.sub}</p>}
            </div>
          )
        })}
      </div>
      {!unknown && hasFilters && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">These figures cover the {filtered.length} of {all.kpis.totalRecords} records matching the current filters.</p>
      )}

      {/* Expiring / expired attention strip */}
      {rows !== null && attention.length > 0 && (
        <div className="card border border-amber-800/40">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Clock size={15} className="text-amber-400" aria-hidden="true" /> Certifications needing attention
            <span className="text-xs text-[var(--text-muted)] font-normal">({attention.length}{attention.length > 24 ? ', showing the 24 most urgent' : ''})</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {attention.slice(0, 24).map(({ r, status, days }) => (
              <button
                type="button"
                key={r.id}
                onClick={() => openEdit(r)}
                className={`rounded-lg border px-3 py-2 min-h-[44px] text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)] ${EXPIRY_BADGE[status]}`}
              >
                <p className="text-xs font-semibold">{r.driver_name || 'N/A'}</p>
                <p className="text-[11px] opacity-90">{CATEGORY_LABEL[r.category] || r.course_name || 'Training'}</p>
                <p className="text-[11px] font-medium mt-0.5">{expiryLabel(status, days)} | {fmtDate(r.expiry_date)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <BadgeCheck size={15} aria-hidden="true" /> Training by category
          </h3>
          <div className="h-64" role="img" aria-label={`Training records by category: ${view.categories.map((c) => `${CATEGORY_LABEL[c.category] || c.category} ${c.count}`).join(', ') || 'none'}`}>
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : error ? <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Not available until the records load.</div>
                : view.categories.length === 0 ? <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{hasFilters ? 'No records match these filters.' : 'No training records yet.'}</div>
                  : <Bar data={catData} options={catOpts} />}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <PieChart size={15} aria-hidden="true" /> Certification currency
          </h3>
          <div className="h-64" role="img" aria-label={`Certification currency: ${view.expiry.map((b) => `${b.label} ${b.count}`).join(', ')}`}>
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : error ? <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Not available until the records load.</div>
                : filtered.length === 0 ? <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No records to chart.</div>
                  : <Doughnut data={expiryData} options={expiryOpts} />}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" aria-label="Search training records" placeholder="Search driver, course, provider, certificate..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select className="input" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} aria-label="Result">
            <option value="">All results</option>
            {RESULT_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select className="input" value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value)} aria-label="Certification expiry">
            <option value="">All expiry states</option>
            {EXPIRY_BUCKETS.map((k) => <option key={k} value={k}>{EXPIRY_BUCKET_LABEL[k]}</option>)}
          </select>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {all.kpis.totalRecords}</span>
        </div>
      </div>

      {/* Register */}
      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        viewKey="driver-training"
        initialPageSize={25}
        emptyMessage={(rows || []).length === 0 && !notProvisioned ? 'No training records yet. Add your first record.' : 'No records match these filters.'}
        emptyIcon={<Filter size={22} className="opacity-60" aria-hidden="true" />}
        onRowClick={(r) => openEdit(r)}
      />

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit training record' : 'Add training record'}</h3>
              <button type="button" onClick={closeModal} aria-label="Close" className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="dt-driver_name">Driver name</label>
                  <input id="dt-driver_name" className="input w-full" placeholder="e.g. Ahmed Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="dt-course_name">Course name</label>
                  <input id="dt-course_name" className="input w-full" placeholder="e.g. Advanced Defensive Driving" value={form.course_name} maxLength={200} onChange={(e) => set('course_name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="dt-category">Category</label>
                  <select id="dt-category" className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    <option value="">Select category…</option>
                    {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="dt-provider">Provider</label>
                  <input id="dt-provider" className="input w-full" placeholder="Training provider" value={form.provider} maxLength={200} onChange={(e) => set('provider', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="dt-completed_date">Completed date</label>
                  <input id="dt-completed_date" className="input w-full" type="date" value={form.completed_date} onChange={(e) => set('completed_date', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="dt-expiry_date">Expiry date</label>
                  <input id="dt-expiry_date" className="input w-full" type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank if the certification does not expire.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label" htmlFor="dt-result">Result</label>
                  <select id="dt-result" className="input w-full" value={form.result} onChange={(e) => set('result', e.target.value)}>
                    <option value="">None</option>
                    {RESULT_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="dt-score">Score</label>
                  <input id="dt-score" className="input w-full" type="number" step="0.01" min="0" placeholder="e.g. 92" value={form.score} onChange={(e) => set('score', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="dt-pass_mark">Pass mark</label>
                  <input id="dt-pass_mark" className="input w-full" type="number" step="0.01" min="0" placeholder="e.g. 70" value={form.pass_mark} onChange={(e) => set('pass_mark', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label" htmlFor="dt-certificate_no">Certificate no.</label>
                  <input id="dt-certificate_no" className="input w-full" placeholder="Cert / reference no." value={form.certificate_no} maxLength={120} onChange={(e) => set('certificate_no', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="dt-cost">Cost</label>
                  <input id="dt-cost" className="input w-full" type="number" step="0.01" min="0" placeholder="0.00" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="dt-currency">Currency</label>
                  <input id="dt-currency" className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="dt-certificate_url">Certificate URL (optional)</label>
                <input id="dt-certificate_url" className="input w-full" placeholder="https://…" value={form.certificate_url} maxLength={2000} onChange={(e) => set('certificate_url', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="dt-notes">Notes (optional)</label>
                <textarea id="dt-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. refresher required annually" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
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
                  {confirmDelete.driver_name || 'Record'} | {CATEGORY_LABEL[confirmDelete.category] || confirmDelete.course_name || 'Training'} | {fmtDate(confirmDelete.completed_date)}. This cannot be undone.
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
