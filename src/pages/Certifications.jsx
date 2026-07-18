/**
 * Certifications (route /certifications) tracks driver, vehicle, technician
 * and site certifications / licences, permits and inspections with issue +
 * expiry dates. A compliance + renewal-planning surface: expiry banding, a
 * 12-month renewal pipeline, by-type / by-holder breakdowns, status charts,
 * filterable + sortable register, and full role-gated CRUD.
 *
 * Backed by the real `certifications` table (V136), org-isolated + country
 * scoped. Every number is derived from real rows only (pure engine
 * certificationsAnalytics.js) with honest empty states. No fabricated data.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  BadgeCheck, AlertTriangle, Clock, ShieldOff, Search, X, Filter,
  Plus, Pencil, Trash2, FileSpreadsheet, FileText, Loader2, Save, CalendarClock,
  PieChart, BarChart3, Percent, ArrowDownUp,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCertifications, createCertification, updateCertification, deleteCertification,
} from '../lib/api/certifications'
import {
  buildCertAnalytics, enrichCertifications, sortBySoonestExpiry,
  CERT_STATUS_META, SUBJECT_TYPES, SUBJECT_LABELS, EXPIRING_SOON_DAYS,
} from '../lib/certificationsAnalytics'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

// Semantic band palette: the colour carries meaning, so it stays fixed.
const BAND_COLORS = { valid: '#10b981', expiring: '#f59e0b', expired: '#ef4444', revoked: '#64748b' }
const STATUS_STYLES = {
  valid: 'bg-green-900/40 text-green-300 border border-green-700/50',
  expiring: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  expired: 'bg-red-900/40 text-red-300 border border-red-700/50',
  revoked: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
function daysLabel(days) {
  if (days == null) return ''
  if (days < 0) return `${Math.abs(days)}d ago`
  if (days === 0) return 'today'
  return `${days}d`
}

const EMPTY_FORM = {
  subject_type: 'driver', subject_name: '', cert_type: '', cert_number: '',
  issuer: '', issue_date: '', expiry_date: '', status: 'valid', notes: '',
}

const SORTS = {
  soonest: 'Soonest expiry',
  latest: 'Latest expiry',
  subject: 'Subject (A-Z)',
  recent: 'Recently added',
}

export default function Certifications() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [expiryFrom, setExpiryFrom] = useState('')
  const [expiryTo, setExpiryTo] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('soonest')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Reference clock captured once per load so bands are stable within a view.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listCertifications({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load certifications.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const analytics = useMemo(() => buildCertAnalytics(rows || [], now), [rows, now])
  const enriched = useMemo(() => enrichCertifications(rows || [], now), [rows, now])

  const certTypes = useMemo(() => {
    const set = new Set()
    for (const r of rows || []) { const t = String(r?.cert_type || '').trim(); if (t) set.add(t) }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = enriched.filter((r) => {
      if (statusFilter !== 'all' && r._status !== statusFilter) return false
      if (subjectFilter !== 'all' && r.subject_type !== subjectFilter) return false
      if (typeFilter !== 'all' && (String(r.cert_type || '').trim() || 'Unspecified') !== typeFilter) return false
      if (expiryFrom && (!r.expiry_date || r.expiry_date < expiryFrom)) return false
      if (expiryTo && (!r.expiry_date || r.expiry_date > expiryTo)) return false
      if (q) {
        const hay = `${r.subject_name || ''} ${r.cert_type || ''} ${r.cert_number || ''} ${r.issuer || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    if (sortBy === 'soonest') return sortBySoonestExpiry(list, now)
    if (sortBy === 'latest') return sortBySoonestExpiry(list, now).reverse()
    if (sortBy === 'subject') return [...list].sort((a, b) => String(a.subject_name || '').localeCompare(String(b.subject_name || '')))
    if (sortBy === 'recent') return [...list].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    return list
  }, [enriched, statusFilter, subjectFilter, typeFilter, expiryFrom, expiryTo, search, sortBy, now])

  const clearFilters = () => {
    setStatusFilter('all'); setSubjectFilter('all'); setTypeFilter('all')
    setExpiryFrom(''); setExpiryTo(''); setSearch('')
  }
  const hasFilters = statusFilter !== 'all' || subjectFilter !== 'all' || typeFilter !== 'all' || expiryFrom || expiryTo || search

  // Chart data (real, from the engine; empty-safe) ------------------------------
  const statusDoughnut = useMemo(() => {
    const dist = analytics.statusDistribution.filter((s) => s.count > 0)
    return {
      labels: dist.map((s) => s.label),
      datasets: [{ data: dist.map((s) => s.count), backgroundColor: dist.map((s) => BAND_COLORS[s.status]), borderWidth: 0 }],
    }
  }, [analytics])

  const pipelineBar = useMemo(() => {
    const m = analytics.pipeline.months
    return {
      labels: m.map((b) => b.label),
      datasets: [{
        label: 'Expiring',
        data: m.map((b) => b.count),
        backgroundColor: m.map((b) => (b.soon > 0 ? withAlpha(BAND_COLORS.expiring, 0.85) : withAlpha(colorAt(0), 0.75))),
        borderWidth: 0,
      }],
    }
  }, [analytics])

  const typeBar = useMemo(() => {
    const t = analytics.byType.slice(0, 10)
    return {
      labels: t.map((g) => g.type),
      datasets: [{ label: 'Certifications', data: t.map((g) => g.count), backgroundColor: categorical(t.length), borderWidth: 0 }],
    }
  }, [analytics])

  const chartAxis = {
    plugins: { legend: { display: false }, tooltip: { enabled: true } },
    scales: {
      x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
      y: { beginAtZero: true, ticks: { color: '#9ca3af', font: { size: 11 }, precision: 0 }, grid: { color: 'var(--panel-2)' } },
    },
    maintainAspectRatio: false,
    responsive: true,
  }
  const doughnutOpts = {
    maintainAspectRatio: false,
    responsive: true,
    plugins: { legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } } },
  }

  // CRUD handlers ---------------------------------------------------------------
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      subject_type: r.subject_type || 'driver',
      subject_name: r.subject_name || '',
      cert_type: r.cert_type || '',
      cert_number: r.cert_number || '',
      issuer: r.issuer || '',
      issue_date: r.issue_date || '',
      expiry_date: r.expiry_date || '',
      status: r.status || 'valid',
      notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.subject_name.trim()) { setFormError('Subject name is required.'); return }
    if (form.issue_date && form.expiry_date && form.expiry_date < form.issue_date) {
      setFormError('Expiry date cannot be before the issue date.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) {
        const updated = await updateCertification(editing.id, payload)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createCertification(payload)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the certification.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteCertification(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the certification.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  // Export ----------------------------------------------------------------------
  const EXPORT_COLS = ['subject_type', 'subject_name', 'cert_type', 'cert_number', 'issuer', 'issue_date', 'expiry_date', 'days', 'status']
  const EXPORT_HEADERS = ['Subject type', 'Subject', 'Cert type', 'Cert number', 'Issuer', 'Issue date', 'Expiry date', 'Days to expiry', 'Status']
  const exportRows = filtered.map((r) => ({
    subject_type: SUBJECT_LABELS[r.subject_type] || r.subject_type || '',
    subject_name: r.subject_name || '', cert_type: r.cert_type || '', cert_number: r.cert_number || '',
    issuer: r.issuer || '', issue_date: r.issue_date || '', expiry_date: r.expiry_date || '',
    days: r._days == null ? '' : r._days,
    status: CERT_STATUS_META[r._status]?.label || r._status || '',
  }))

  const nextExp = analytics.nextExpiry
  const kpis = [
    { label: 'Total tracked', value: analytics.total, icon: BadgeCheck, tone: 'text-[var(--text-primary)]' },
    { label: 'Valid', value: analytics.validPct == null ? 'N/A' : `${analytics.validPct}%`, sub: `${analytics.byStatus.valid} of ${analytics.total}`, icon: Percent, tone: 'text-green-400' },
    { label: `Expiring (<=${EXPIRING_SOON_DAYS}d)`, value: analytics.expiringSoonCount, icon: Clock, tone: 'text-amber-400' },
    { label: 'Expired', value: analytics.expiredCount, icon: AlertTriangle, tone: 'text-red-400' },
    {
      label: 'Next expiry',
      value: nextExp ? daysLabel(nextExp.days) : 'N/A',
      sub: nextExp ? `${nextExp.cert.subject_name || 'N/A'} - ${fmtDate(nextExp.expiry_date)}` : 'None upcoming',
      icon: CalendarClock,
      tone: 'text-sky-400',
    },
  ]

  const loading = rows === null
  const empty = !loading && (rows || []).length === 0 && !missing && !error

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certifications"
        subtitle="Driver, vehicle, technician and site licences, permits and inspections, with expiry banding and renewal planning."
        icon={BadgeCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'certifications')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Certifications', 'certifications', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New certification
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Certifications are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V136_CERTIFICATIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Something went wrong.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-sm">Retry</button>
        </div>
      )}

      {/* Renewal banner */}
      {(analytics.expiredCount > 0 || analytics.expiringSoonCount > 0) && (
        <div className="card border border-amber-800/50 flex items-center gap-3 !py-3">
          <Clock size={16} className="text-amber-400 shrink-0" />
          <span className="text-sm text-amber-200">
            {analytics.expiredCount > 0 && (<><span className="font-semibold">{analytics.expiredCount}</span> expired</>)}
            {analytics.expiredCount > 0 && analytics.expiringSoonCount > 0 && ' and '}
            {analytics.expiringSoonCount > 0 && (<><span className="font-semibold">{analytics.expiringSoonCount}</span> expiring within {EXPIRING_SOON_DAYS} days</>)}
            {' '}require renewal.
            {analytics.pipeline.overdue > 0 && ` ${analytics.pipeline.overdue} overdue in the pipeline.`}
          </span>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{loading ? 'N/A' : k.value}</p>
              {k.sub && !loading && <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{k.sub}</p>}
            </div>
          )
        })}
      </div>

      {/* Charts */}
      {!missing && !empty && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <PieChart size={16} className="text-sky-400" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Status distribution</h3>
            </div>
            <div className="h-64">
              {loading ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                : analytics.total > 0 ? <Doughnut data={statusDoughnut} options={doughnutOpts} />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No certifications yet.</div>}
            </div>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock size={16} className="text-amber-400" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Renewal pipeline (next {analytics.pipeline.horizon} months)</h3>
            </div>
            <div className="h-64">
              {loading ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                : analytics.pipeline.months.some((m) => m.count > 0) ? <Bar data={pipelineBar} options={chartAxis} />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No upcoming expiries in this window.</div>}
            </div>
          </div>
          <div className="card lg:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={16} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">By certification type</h3>
            </div>
            <div className="h-64">
              {loading ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                : analytics.byType.length > 0 ? <Bar data={typeBar} options={{ ...chartAxis, indexAxis: 'y' }} />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No certification types recorded.</div>}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search subject, cert type, number, issuer" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="valid">Valid</option>
            <option value="expiring">Expiring soon</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
          <select className="input" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} aria-label="Subject type">
            <option value="all">All subjects</option>
            {SUBJECT_TYPES.map((s) => <option key={s} value={s}>{SUBJECT_LABELS[s]}</option>)}
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Certification type" disabled={!certTypes.length}>
            <option value="all">All types</option>
            {certTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
            <ArrowDownUp size={14} />
            <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort">
              {Object.entries(SORTS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--text-muted)]">Expiry from</label>
          <input type="date" className="input" value={expiryFrom} onChange={(e) => setExpiryFrom(e.target.value)} aria-label="Expiry from" />
          <label className="text-xs text-[var(--text-muted)]">to</label>
          <input type="date" className="input" value={expiryTo} onChange={(e) => setExpiryTo(e.target.value)} aria-label="Expiry to" />
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {analytics.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Subject', 'Type', 'Cert type', 'Number', 'Issuer', 'Issue', 'Expiry', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : empty ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <BadgeCheck size={26} className="mx-auto mb-2 opacity-60" />
                  No certifications tracked yet. Use "New certification" to record a licence, permit or inspection and its expiry.
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />No certifications match these filters.</td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const expClass = r._status === 'expired' ? 'text-red-400 font-medium' : r._status === 'expiring' ? 'text-amber-400 font-medium' : 'text-[var(--text-secondary)]'
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.subject_name || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{SUBJECT_LABELS[r.subject_type] || r.subject_type || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.cert_type || 'N/A'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.cert_number || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.issuer || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.issue_date)}</td>
                      <td className={`px-4 py-2.5 ${expClass}`}>
                        {fmtDate(r.expiry_date)}
                        {r._days != null && r.expiry_date && (
                          <span className="ml-1 text-[11px] opacity-80">({daysLabel(r._days)})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${STATUS_STYLES[r._status]}`}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: BAND_COLORS[r._status] }} />
                          {CERT_STATUS_META[r._status]?.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500. Refine filters or export for the full set.</p>}
      </div>

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit certification' : 'New certification'}</h2>
              <button onClick={() => !saving && setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Subject type</label>
                  <select className="input w-full" value={form.subject_type} onChange={(e) => setField('subject_type', e.target.value)}>
                    {SUBJECT_TYPES.map((s) => <option key={s} value={s}>{SUBJECT_LABELS[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Subject name<span className="text-red-400"> *</span></label>
                  <input className="input w-full" placeholder="e.g. J. Smith / Truck 42" value={form.subject_name} maxLength={200} onChange={(e) => setField('subject_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Certification type</label>
                  <input className="input w-full" placeholder="e.g. HGV licence, ADR permit" value={form.cert_type} maxLength={120} onChange={(e) => setField('cert_type', e.target.value)} />
                </div>
                <div>
                  <label className="label">Certificate number</label>
                  <input className="input w-full" value={form.cert_number} maxLength={120} onChange={(e) => setField('cert_number', e.target.value)} />
                </div>
                <div>
                  <label className="label">Issuer</label>
                  <input className="input w-full" placeholder="Issuing authority" value={form.issuer} maxLength={200} onChange={(e) => setField('issuer', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    <option value="valid">Valid</option>
                    <option value="expiring">Expiring soon</option>
                    <option value="expired">Expired</option>
                    <option value="revoked">Revoked</option>
                  </select>
                </div>
                <div>
                  <label className="label">Issue date</label>
                  <input type="date" className="input w-full" value={form.issue_date || ''} onChange={(e) => setField('issue_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Expiry date</label>
                  <input type="date" className="input w-full" value={form.expiry_date || ''} onChange={(e) => setField('expiry_date', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[90px] resize-y" value={form.notes} maxLength={4000} onChange={(e) => setField('notes', e.target.value)} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving' : editing ? 'Save changes' : 'Create certification'}
                </button>
                <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0">
                <ShieldOff size={20} className="text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-[var(--text-primary)]">Delete certification?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  This permanently removes the record for <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.subject_name}</span>. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-5">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="btn-secondary">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-500 border-red-600 inline-flex items-center gap-2 disabled:opacity-60">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
