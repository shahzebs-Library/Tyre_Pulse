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
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
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
import { usePagedRows, TablePagination } from '../components/ui/TablePagination'
import { probeRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

// Semantic band palette: the colour carries meaning, so it stays fixed.
const BAND_COLORS = { valid: '#10b981', expiring: '#f59e0b', expired: '#ef4444', revoked: '#64748b' }
const STATUS_STYLES = {
  valid: 'bg-green-900/40 text-green-300 border border-green-700/50',
  expiring: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  expired: 'bg-red-900/40 text-red-300 border border-red-700/50',
  revoked: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
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
      const list = Array.isArray(data) ? data : []
      setRows(list)
      // `listCertifications` DEGRADES a missing table to [] rather than throwing,
      // so the catch below could NEVER see one - which left this compliance page
      // inviting the user to "record a licence" into a table that is not there.
      // Probe only when the list is empty, and believe only a DEFINITE answer:
      // an unknown result must not render "apply the migration".
      if (list.length === 0) {
        const { exists, checked } = await probeRelation('certifications')
        setMissing(checked && !exists)
      } else {
        setMissing(false)
      }
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      // A real failure only. The missing-table case is handled above by the
      // probe, because the service never lets it reach here.
      setError(toUserMessage(err, 'Could not load certifications.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  /**
   * The SCOPE the tiles and the three charts cover: subject + free-text search.
   *
   * Status, certificate type and the expiry dates are deliberately held out,
   * because each is the dimension a figure on this page REPORTS ON - the status
   * doughnut and the Valid/Expiring/Expired tiles are status readings, the
   * by-type bar is a type reading, and the renewal pipeline is a time reading.
   * Narrowing any of them by its own filter makes it restate the choice the
   * reader just made. Subject and search are not reported on by anything, so
   * they DO apply: without them the tiles stated register-wide figures above a
   * table narrowed to one driver or one search.
   */
  const analyticsScope = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (subjectFilter !== 'all' && r.subject_type !== subjectFilter) return false
      if (q) {
        const hay = `${r.subject_name || ''} ${r.cert_type || ''} ${r.cert_number || ''} ${r.issuer || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, subjectFilter, search])

  const analytics = useMemo(() => buildCertAnalytics(analyticsScope, now), [analyticsScope, now])
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
  // Paged, not capped: this table used to render filtered.slice(0, 500) with no
  // way to reach row 501. The exports below still cover `filtered` in full.
  const pager = usePagedRows(filtered)

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
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'certifications') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Certifications', 'certifications', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New certification
            </button>
          </div>
        }
      />

      {/* `border border-amber-800/50` was DEAD here: Card sets `border` inline and
          a plain utility class loses to it, so the amber edge simply never
          rendered. `tone` is the one route that reaches the border. The row
          direction is inline for the same reason in reverse - Card is
          `flex flex-col`, and an unprefixed `flex-row` class cannot beat it. */}
      {missing && (
        <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Certifications are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V136_CERTIFICATIONS.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Something went wrong.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-sm">Retry</button>
        </Card>
      )}

      {/* Renewal banner. The old `!py-3` survived (an !important stylesheet rule
          does beat an inline declaration) but it is retired anyway: the padding
          longhands below are spread after Card's `padding` shorthand, so they
          win on their own without an !important that the next nesting breaks. */}
      {(analytics.expiredCount > 0 || analytics.expiringSoonCount > 0) && (
        <Card
          tone="warn"
          className="items-center gap-3"
          style={{ flexDirection: 'row', paddingTop: 'var(--space-3)', paddingBottom: 'var(--space-3)' }}
        >
          <Clock size={16} className="text-amber-400 shrink-0" />
          <span className="text-sm text-amber-200">
            {analytics.expiredCount > 0 && (<><span className="font-semibold">{analytics.expiredCount}</span> expired</>)}
            {analytics.expiredCount > 0 && analytics.expiringSoonCount > 0 && ' and '}
            {analytics.expiringSoonCount > 0 && (<><span className="font-semibold">{analytics.expiringSoonCount}</span> expiring within {EXPIRING_SOON_DAYS} days</>)}
            {' '}require renewal.
            {analytics.pipeline.overdue > 0 && ` ${analytics.pipeline.overdue} overdue in the pipeline.`}
          </span>
        </Card>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <Card key={k.label}>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{loading ? 'N/A' : k.value}</p>
              {k.sub && !loading && <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{k.sub}</p>}
            </Card>
          )
        })}
      </div>

      {/* When the tiles and charts cover a narrowed set, say so. */}
      {!loading && analyticsScope.length !== (rows || []).length && (
        <p className="text-xs text-[var(--text-muted)] -mt-1">
          These figures cover the {analyticsScope.length} certificate{analyticsScope.length === 1 ? '' : 's'} matching
          your subject and search filters, of {(rows || []).length} tracked. The status, type and expiry filters are
          not applied here, so the status, type and renewal views stay readable.
        </p>
      )}

      {/* Charts */}
      {!missing && !empty && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* `iconTone` is why CardHeader is usable here at all: these three
              icons carry meaning (sky = a status reading, amber = time, green =
              a breakdown), and a kit that forced them all to muted would be the
              worse choice on exactly the cards whose colour says something.
              The chart well keeps a DEFINITE height - chart.js sizes from its
              parent under maintainAspectRatio:false. */}
          <Card>
            <CardHeader title="Status distribution" icon={PieChart} iconTone="info" />
            <CardBody style={{ height: '16rem' }}>
              {loading ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                : analytics.total > 0 ? <Doughnut data={statusDoughnut} options={doughnutOpts} />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No certifications yet.</div>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={`Renewal pipeline (next ${analytics.pipeline.horizon} months)`} icon={CalendarClock} iconTone="warn" />
            <CardBody style={{ height: '16rem' }}>
              {loading ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                : analytics.pipeline.months.some((m) => m.count > 0) ? <Bar data={pipelineBar} options={chartAxis} />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No upcoming expiries in this window.</div>}
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="By certification type" icon={BarChart3} iconTone="good" />
            <CardBody style={{ height: '16rem' }}>
              {loading ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                : analytics.byType.length > 0 ? <Bar data={typeBar} options={{ ...chartAxis, indexAxis: 'y' }} />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No certification types recorded.</div>}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Filters. Deliberately NOT `clip`: these are native <select>s, whose
          option list the browser paints as an OS-level popup outside the page's
          overflow context, so there is nothing here for a card to cut off. */}
      <Card className="space-y-3">
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
      </Card>

      {/* Table. `!p-0` is retired to `pad="none"` and `overflow-hidden` to
          `clip`, which is the one legitimate use: the table must be cropped to
          the card radius. TablePagination's rows-per-page control is a native
          <select>, so clipping cannot reach it. */}
      <Card pad="none" clip>
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
                pager.pageRows.map((r) => {
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
        <TablePagination {...pager} />
      </Card>

      {/* Create / edit dialog. Every close path - Escape, the backdrop and the
          X - now runs through ONE guarded `onClose`, so a save in flight cannot
          be dismissed from any of them. `submit` clears `saving` in a `finally`,
          so the dialog can never be left unclosable. The submit button stays
          INSIDE the form rather than moving to `footer`, or it would stop
          submitting it. */}
      <Modal
        open={modalOpen}
        onClose={() => { if (!saving) setModalOpen(false) }}
        title={editing ? 'Edit certification' : 'New certification'}
        size="md"
      >
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
            <button type="button" onClick={() => { if (!saving) setModalOpen(false) }} disabled={saving} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation. This one is form-less, so the buttons belong in
          `footer`. The hand-rolled version had NO close control at all beside
          Cancel; Modal adds Escape and an X, and both are held behind the same
          `deleting` guard the backdrop already had. */}
      {confirmDelete && (
        <Modal
          open
          onClose={() => { if (!deleting) setConfirmDelete(null) }}
          title="Delete certification?"
          size="sm"
          footer={(
            <>
              <button onClick={() => { if (!deleting) setConfirmDelete(null) }} disabled={deleting} className="btn-secondary">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-500 border-red-600 inline-flex items-center gap-2 disabled:opacity-60">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting' : 'Delete'}
              </button>
            </>
          )}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0">
              <ShieldOff size={20} className="text-red-400" />
            </div>
            <p className="text-sm text-[var(--text-muted)] flex-1">
              This permanently removes the record for <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.subject_name}</span>. This cannot be undone.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
