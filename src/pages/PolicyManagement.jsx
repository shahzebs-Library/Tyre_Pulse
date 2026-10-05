/**
 * PolicyManagement (route /policies) - govern safety, workshop, fleet and
 * compliance policies across countries. Backed by the `policies` table (V137),
 * a document register: title, category, version, owner, effective/review dates,
 * status lifecycle, body and notes. Any authenticated member reads;
 * Admin/Manager/Director author and maintain (RLS enforces it).
 *
 * Laid out to the owner's mockup on the Command Center kit: KPI strip, policy
 * register with filters, and a detail / version / acknowledgment row, plus the
 * portfolio view (status, renewal pipeline, categories). Figures come from the
 * pure `src/lib/policyView.js` + `policyAnalytics.js`. Anything the table does
 * not record (acknowledgments, departments, sites, attachments, regulations,
 * earlier versions) is shown as "Not recorded", never invented.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ClipboardList, CalendarClock, Users, CheckCircle2, AlertTriangle, Plus, Pencil,
  Trash2, Search, X, FileSpreadsheet, FileText, Loader2, Save, Send, RotateCcw,
  Hash, GitBranch, ShieldCheck, Globe, Calendar, Paperclip, BookOpen, History, Info,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  Card, CardState, Kpi, PageHero, Donut, fmtInt,
} from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listPolicies, createPolicy, updatePolicy, deletePolicy,
} from '../lib/api/policies'
import { POLICY_STATUSES, POLICY_STATUS_META } from '../lib/policies'
import {
  summarizePolicyPortfolio, filterPolicies, sortByExpiry, policyExpiry,
  policyPremium, EXPIRY_BANDS, DEFAULT_WARN_DAYS,
} from '../lib/policyAnalytics'
import {
  policyCode, statusLabel, statusTone, ownerInitials, policyGaps, policyKpis,
  reviewDistance, optionsOf, regionLabel, versionLog, policyDetailRows, categoryBreakdown,
} from '../lib/policyView'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import './PolicyManagement.css'

const BAND_TONE = { expired: 'bad', expiring: 'warn', valid: 'good', none: 'muted' }
const BAND_LABEL = { expired: 'Expired', expiring: 'Expiring', valid: 'Valid', none: 'No date' }
const STATUS_COLOR = { draft: 'var(--cc-ink-3)', active: 'var(--cc-green)', under_review: 'var(--cc-amber)', archived: 'var(--cc-blue)', unknown: 'var(--cc-red)' }
const EMPTY_FORM = {
  title: '', category: '', version: '', owner: '',
  effective_date: '', review_date: '', status: 'draft', body: '', notes: '',
}
const EMPTY_FILTERS = { search: '', country: '', category: '', status: 'all', band: 'all', from: '', to: '', gapsOnly: false }

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// -- Create / edit modal -------------------------------------------------------
function PolicyModal({ open, existing, onClose, onSaved }) {
  const { activeCountry } = useSettings() || {}
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    if (existing) {
      setForm({
        title: existing.title || '', category: existing.category || '',
        version: existing.version || '', owner: existing.owner || '',
        effective_date: existing.effective_date || '', review_date: existing.review_date || '',
        status: existing.status || 'draft', body: existing.body || '', notes: existing.notes || '',
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setError('')
  }, [open, existing])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.title.trim()) { setError('A policy title is required.'); return }
    setBusy(true)
    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        category: form.category.trim() || null,
        version: form.version.trim() || null,
        owner: form.owner.trim() || null,
        effective_date: form.effective_date || null,
        review_date: form.review_date || null,
        body: form.body.trim() || null,
        notes: form.notes.trim() || null,
      }
      if (existing) {
        await updatePolicy(existing.id, payload)
      } else {
        const country = activeCountry && activeCountry !== 'All' ? activeCountry : null
        await createPolicy({ ...payload, country })
      }
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the policy. Please try again.'))
    } finally {
      setBusy(false)
    }
  }, [form, existing, activeCountry, onSaved, onClose])

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} closeOnBackdrop={false} size="lg" title={existing ? 'Edit policy' : 'New policy'}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="pm-title">Title *</label>
            <input id="pm-title" className="input w-full" placeholder="e.g. Fleet Third-Party Liability Cover" value={form.title} maxLength={300} onChange={(e) => set('title', e.target.value)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="pm-category">Coverage type / category</label>
              <input id="pm-category" className="input w-full" placeholder="e.g. Motor, Liability, Cargo" value={form.category} maxLength={120} onChange={(e) => set('category', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pm-version">Version</label>
              <input id="pm-version" className="input w-full" placeholder="e.g. 1.0" value={form.version} maxLength={60} onChange={(e) => set('version', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pm-owner">Owner / responsible party</label>
              <input id="pm-owner" className="input w-full" placeholder="e.g. Fleet Ops, Insurer" value={form.owner} maxLength={160} onChange={(e) => set('owner', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pm-status">Status</label>
              <select id="pm-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {POLICY_STATUSES.map((s) => <option key={s} value={s}>{POLICY_STATUS_META[s]?.label || s}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="pm-effective">Effective date</label>
              <input id="pm-effective" type="date" className="input w-full" value={form.effective_date || ''} onChange={(e) => set('effective_date', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pm-review">Renewal / review date</label>
              <input id="pm-review" type="date" className="input w-full" value={form.review_date || ''} onChange={(e) => set('review_date', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="pm-body">Body</label>
            <textarea id="pm-body" className="input w-full min-h-[120px] resize-y" placeholder="Coverage scope, terms and requirements..." value={form.body} maxLength={20000} onChange={(e) => set('body', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="pm-notes">Notes</label>
            <textarea id="pm-notes" className="input w-full min-h-[70px] resize-y" placeholder="Internal notes, references..." value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {busy ? 'Saving...' : existing ? 'Update policy' : 'Create policy'}
            </button>
          </div>
        </form>
    </Modal>
  )
}

// -- Delete confirm ------------------------------------------------------------
function DeleteConfirm({ policy, onCancel, onConfirm, busy }) {
  if (!policy) return null
  return (
    <Modal
      open
      onClose={busy ? undefined : onCancel}
      closeOnBackdrop={false}
      title="Delete policy?"
      size="sm"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-900/30 border border-red-800/50 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <p className="text-sm text-[var(--text-muted)]">
              "{policy.title}" will be permanently removed. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 !bg-red-600 hover:!bg-red-500 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </Modal>
  )
}

// -- Small helpers ----------------------------------------------------------
function Owner({ name, title }) {
  if (!name) return <span className="cc-na">Not recorded</span>
  return (
    <span className="pm-owner" title={title}>
      <span className="pm-avatar" aria-hidden="true">{ownerInitials(name)}</span>
      <span className="pm-owner-name">{name}</span>
    </span>
  )
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="pm-fact">
      <dt><Icon size={13} aria-hidden="true" /> {label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Bars({ items, color = 'var(--cc-green)', onSelect, emptyText }) {
  const max = items.reduce((m, x) => Math.max(m, x.count), 0)
  if (!items.length || max === 0) return <div className="cc-empty">{emptyText}</div>
  return (
    <ul className="pm-bars">
      {items.map((x) => (
        <li key={x.key || x.label}>
          <button type="button" disabled={!onSelect} onClick={() => onSelect?.(x)}>
            <span className="pm-bar-label">{x.label}</span>
            <span className="pm-bar-track"><i style={{ width: `${(x.count / max) * 100}%`, background: color }} /></span>
            <b>{fmtInt(x.count)}</b>
          </button>
        </li>
      ))}
    </ul>
  )
}

// -- Page ----------------------------------------------------------------------
export default function PolicyManagement() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)

  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const [selectedId, setSelectedId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [statusBusy, setStatusBusy] = useState('')
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(''); setMissing(false)
    try {
      const data = await listPolicies({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load policies.')); setRows(null) }
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // One clock per load, so every figure below agrees on 'today'.
  const now = useMemo(() => Date.now(), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => rows || [], [rows])
  const portfolio = useMemo(() => summarizePolicyPortfolio(all, now), [all, now])
  const kpi = useMemo(() => policyKpis(all, now), [all, now])
  const countryOptions = useMemo(() => optionsOf(all, 'country'), [all])
  const categoryOptions = useMemo(() => optionsOf(all, 'category'), [all])

  const filtered = useMemo(() => {
    let list = filterPolicies(all, {
      status: filters.status, category: filters.category, band: filters.band,
      from: filters.from, to: filters.to, search: filters.search,
    }, now)
    if (filters.country) list = list.filter((r) => (r.country || '') === filters.country)
    if (filters.gapsOnly) list = list.filter((r) => policyGaps(r, now).length > 0)
    // Default order: soonest renewal first. The table re-sorts on any header.
    return sortByExpiry(list, 'asc')
  }, [all, filters, now])

  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)
  const selected = useMemo(
    () => filtered.find((r) => r.id === selectedId) || all.find((r) => r.id === selectedId) || filtered[0] || null,
    [filtered, all, selectedId],
  )

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = useCallback((p) => { setEditing(p); setModalOpen(true) }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deletePolicy(deleting.id)
      if (selectedId === deleting.id) setSelectedId(null)
      setDeleting(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the policy.'))
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, load, selectedId])

  const setStatus = useCallback(async (policy, status) => {
    setActionError(''); setStatusBusy(status)
    try {
      await updatePolicy(policy.id, { status })
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not change the policy status.'))
    } finally {
      setStatusBusy('')
    }
  }, [load])

  // -- export --
  const EXPORT_COLS = ['code', 'title', 'category', 'version', 'owner', 'region', 'status', 'expiry', 'effective_date', 'review_date', 'gaps', 'premium']
  const EXPORT_HEADERS = ['Policy ID', 'Title', 'Category', 'Version', 'Owner', 'Region', 'Status', 'Renewal', 'Effective', 'Next review', 'Governance gaps', 'Premium']
  const exportRows = filtered.map((r) => {
    const prem = policyPremium(r)
    return {
      code: policyCode(r), title: r.title || '', category: r.category || '', version: r.version || '',
      owner: r.owner || '', region: regionLabel(r), status: statusLabel(r.status),
      expiry: BAND_LABEL[policyExpiry(r, now).band] || '',
      effective_date: r.effective_date || '', review_date: r.review_date || '',
      gaps: policyGaps(r, now).join(', ') || 'None',
      premium: prem == null ? 'Not recorded' : String(prem),
    }
  })
  const runExport = async (kind) => {
    setActionError('')
    try {
      if (kind === 'excel') await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, reportFileName('Policies'))
      else await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Policy Management', reportFileName('Policies'), 'landscape')
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }
  const exportOne = async (policy) => {
    setActionError('')
    try {
      await exportToPdf(policyDetailRows(policy, now), [{ key: 'field', header: 'Field' }, { key: 'value', header: 'Value' }],
        policy.title || 'Policy', reportFileName('Policy', policyCode(policy)), 'portrait')
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export the policy.'))
    }
  }

  const loadState = { loading, data: rows, error: error || null, retry: load }
  const kv = (n) => (rows === null ? null : n)

  const kpis = [
    { icon: ClipboardList, tone: 't-green', value: kv(kpi.active), label: 'Active policies', onClick: () => setFilters({ ...EMPTY_FILTERS, status: 'active' }) },
    { icon: CalendarClock, tone: 't-amber', value: kv(kpi.expiringSoon), label: 'Expiring soon', title: `Review date within ${DEFAULT_WARN_DAYS} days`, onClick: () => setFilters({ ...EMPTY_FILTERS, band: 'expiring' }) },
    { icon: Users, tone: 't-blue', value: kv(kpi.pendingReview), label: 'Pending review', title: 'Policies with status Under review', onClick: () => setFilters({ ...EMPTY_FILTERS, status: 'under_review' }) },
    { icon: CheckCircle2, tone: 't-green', display: 'N/A', label: 'Avg. acknowledgment', title: 'Not recorded: no acknowledgment records exist for policies yet' },
    { icon: AlertTriangle, tone: 't-red', value: kv(kpi.withGaps), label: 'Policy gaps', danger: kpi.withGaps > 0, title: 'Non-archived policies with no owner, no review date, an overdue review, no effective date or no policy text', onClick: () => setFilters({ ...EMPTY_FILTERS, gapsOnly: true }) },
  ]

  const columns = [
    { key: 'code', header: 'Policy ID', sortValue: (r) => policyCode(r), cell: (r) => <span className="pm-code">{policyCode(r)}</span> },
    { key: 'title', header: 'Policy title', cell: (r) => <span className="pm-title">{r.title || 'Untitled'}</span> },
    { key: 'owner', header: 'Owner', cell: (r) => <Owner name={r.owner} /> },
    { key: 'category', header: 'Category', cell: (r) => (r.category ? <span className="cc-pill info">{r.category}</span> : <span className="cc-na">Not recorded</span>) },
    { key: 'country', header: 'Region', sortValue: (r) => regionLabel(r), cell: (r) => <span className="pm-region"><Globe size={13} aria-hidden="true" /> {regionLabel(r)}</span> },
    { key: 'version', header: 'Version', cell: (r) => (r.version ? `v${String(r.version).replace(/^v/i, '')}` : <span className="cc-na">N/A</span>) },
    { key: 'effective_date', header: 'Effective date', cell: (r) => fmtDate(r.effective_date) },
    {
      key: 'review_date', header: 'Next review',
      cell: (r) => {
        const e = policyExpiry(r, now)
        return (
          <span className="pm-review">
            {fmtDate(r.review_date)}
            {e.hasDate && r.status !== 'archived' && e.band !== 'valid' && <span className={`cc-pill ${BAND_TONE[e.band]}`}>{BAND_LABEL[e.band]}</span>}
          </span>
        )
      },
    },
    { key: 'status', header: 'Status', sortValue: (r) => statusLabel(r.status), cell: (r) => <span className={`cc-pill ${statusTone(r.status)}`}>{statusLabel(r.status)}</span> },
    { key: 'ack', header: 'Ack. %', sortable: false, cell: () => <span className="cc-na" title="No acknowledgment records exist for policies">Not recorded</span> },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (r) => (
        <span className="pm-actions">
          <button type="button" className="cc-icon-btn" onClick={(e) => { e.stopPropagation(); openEdit(r) }} aria-label={`Edit ${r.title || 'policy'}`} title="Edit"><Pencil size={14} /></button>
          <button type="button" className="cc-icon-btn pm-danger" onClick={(e) => { e.stopPropagation(); setDeleting(r) }} aria-label={`Delete ${r.title || 'policy'}`} title="Delete"><Trash2 size={14} /></button>
        </span>
      ),
    },
  ]

  // The register renders through EnterpriseTable in the kit skin (cc-et), the
  // same table KitTable wraps, so it pages and sorts the whole filtered set.
  const tableColumns = columns.map((c) => ({
    id: c.key,
    header: c.header,
    accessorFn: (r) => (c.sortValue ? c.sortValue(r) : r[c.key]),
    cell: ({ row }) => c.cell(row.original),
    enableSorting: c.sortable !== false,
  }))

  const statusSegments = portfolio.status.list.map((s) => ({ label: s.label, count: s.count, color: STATUS_COLOR[s.status] || 'var(--cc-ink-3)', status: s.status }))
  const pipelineItems = portfolio.pipeline.buckets.map((b) => ({ key: b.key, label: b.label, count: b.count }))
  const categories = categoryBreakdown(all)
  const log = versionLog(selected)
  const gaps = selected ? policyGaps(selected, now) : []
  const distance = selected ? reviewDistance(selected.review_date, now) : null
  const emptyRegister = all.length === 0
    ? (missing ? 'Policy management is not enabled on this database yet.' : 'No policies recorded yet. Create the first fleet policy with New Policy.')
    : null

  return (
    <div className="cc pm-page">
      <PageHero
        hello="Inspections and Compliance"
        title="Policy Management"
        lead="Govern safety, workshop, fleet and compliance policies across countries and sites."
        imgLight="/dashboard/hero-policies-light.webp"
        imgDark="/dashboard/hero-policies-dark.webp"
        stat={rows ? { value: fmtInt(kpi.total), lines: ['Policies in', 'the register'] } : undefined}
      />

      {missing && (
        <div className="cc-card pm-banner warn" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <p>Policy management is not enabled on this database yet. Apply MIGRATIONS_V137_POLICIES.sql, then reload.</p>
        </div>
      )}
      {actionError && (
        <div className="cc-card pm-banner bad" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <p>{actionError}</p>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {portfolio.pipeline.overdue > 0 && (
        <div className="cc-card pm-banner bad" role="status">
          <CalendarClock size={18} aria-hidden="true" />
          <p><b>{portfolio.pipeline.overdue}</b> policy review{portfolio.pipeline.overdue === 1 ? ' is' : 's are'} already overdue.</p>
          <button type="button" className="cc-btn" onClick={() => setFilters({ ...EMPTY_FILTERS, band: 'expired' })}>Show overdue</button>
        </div>
      )}

      <div className="cc-kpis pm-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading && rows === null} />)}
      </div>

      <Card
        className="pm-register"
        title="Policy Register"
        sub="Search and manage all safety, workshop, fleet and compliance policies"
        action={(
          <div className="pm-head-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => runExport('excel')} disabled={!filtered.length}><FileSpreadsheet size={15} aria-hidden="true" /> Excel</button>
            <button type="button" className="cc-btn-ghost" onClick={() => runExport('pdf')} disabled={!filtered.length}><FileText size={15} aria-hidden="true" /> Export PDF</button>
            <button type="button" className="cc-btn-primary" onClick={openCreate}><Plus size={15} aria-hidden="true" /> New Policy</button>
          </div>
        )}
      >
        <div className="cc-filters pm-filters">
          <label className="cc-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" placeholder="Search policies by title, owner, category, version" aria-label="Search policies" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
          </label>
          {countryOptions.length > 1 && (
            <select className="cc-select" aria-label="Country" value={filters.country} onChange={(e) => setFilter('country', e.target.value)}>
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="cc-select" aria-label="Policy type" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
            <option value="">All policy types</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="cc-select" aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="all">All status</option>
            {POLICY_STATUSES.map((s) => <option key={s} value={s}>{POLICY_STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="cc-select" aria-label="Renewal band" value={filters.band} onChange={(e) => setFilter('band', e.target.value)}>
            <option value="all">All renewals</option>
            {EXPIRY_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <label className="pm-date"><span>Review from</span><input type="date" className="cc-select" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} /></label>
          <label className="pm-date"><span>to</span><input type="date" className="cc-select" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} /></label>
          {hasFilters && <button type="button" className="cc-btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)}><RotateCcw size={14} aria-hidden="true" /> Reset</button>}
          <span className="pm-count" aria-live="polite">{rows ? `${filtered.length} of ${all.length}` : ''}</span>
        </div>
        {filters.gapsOnly && <p className="pm-note"><Info size={13} aria-hidden="true" /> Showing policies with governance gaps only.</p>}
        <CardState state={loadState} empty={emptyRegister}>
          <EnterpriseTable
            columns={tableColumns}
            data={filtered}
            getRowId={(r) => String(r.id)}
            emptyMessage="No policies match these filters."
            onRowClick={(r) => setSelectedId(r.id)}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            enableColumnVisibility={false}
            initialPageSize={25}
            className="cc-et cc-et-clickable"
          />
        </CardState>
      </Card>

      <div className="pm-row">
        <Card
          title="Policy Details"
          action={selected ? <button type="button" className="cc-btn" onClick={() => openEdit(selected)}>Edit policy</button> : null}
        >
          <CardState state={loadState} empty={!selected ? 'Select a policy in the register to see its details.' : null}>
            {selected && (
              <div className="pm-detail">
                <div className="pm-detail-head">
                  <h3>{selected.title || 'Untitled'}</h3>
                  <span className={`cc-pill ${statusTone(selected.status)}`}>{statusLabel(selected.status)}</span>
                </div>
                <div className="pm-chips">
                  <span><Hash size={13} aria-hidden="true" /> {policyCode(selected)}</span>
                  <span><GitBranch size={13} aria-hidden="true" /> {selected.version ? `v${String(selected.version).replace(/^v/i, '')}` : 'No version'}</span>
                  <span><ShieldCheck size={13} aria-hidden="true" /> {selected.category || 'Uncategorised'}</span>
                  <span><Globe size={13} aria-hidden="true" /> {regionLabel(selected)}</span>
                </div>
                <p className="pm-body">{selected.body || 'No policy text recorded yet.'}</p>
                <dl className="pm-facts">
                  <Fact icon={Users} label="Owner"><Owner name={selected.owner} /></Fact>
                  <Fact icon={Calendar} label="Effective date">{fmtDate(selected.effective_date)}</Fact>
                  <Fact icon={CalendarClock} label="Next review">
                    {fmtDate(selected.review_date)}{distance && <span className={`pm-dist ${distance.startsWith('overdue') ? 'bad' : ''}`}> ({distance})</span>}
                  </Fact>
                  <Fact icon={Globe} label="Applies to">{regionLabel(selected)}</Fact>
                  <Fact icon={BookOpen} label="Related regulations"><span className="cc-na">Not recorded</span></Fact>
                  <Fact icon={Paperclip} label="Attachments"><span className="cc-na">Not recorded</span></Fact>
                  <Fact icon={AlertTriangle} label="Governance gaps">
                    {gaps.length ? <span className="pm-gaps">{gaps.map((g) => <span key={g} className="cc-pill bad">{g}</span>)}</span> : 'None'}
                  </Fact>
                  {selected.notes && <Fact icon={Info} label="Notes">{selected.notes}</Fact>}
                </dl>
                <div className="pm-detail-actions">
                  <button type="button" className="cc-btn-primary" disabled={!!statusBusy || selected.status === 'active'} onClick={() => setStatus(selected, 'active')}>
                    {statusBusy === 'active' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />} Publish
                  </button>
                  <button type="button" className="cc-btn-ghost" disabled={!!statusBusy || selected.status === 'under_review'} onClick={() => setStatus(selected, 'under_review')}>
                    {statusBusy === 'under_review' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />} Request Review
                  </button>
                  <button type="button" className="cc-btn-ghost" onClick={() => exportOne(selected)}><FileText size={15} aria-hidden="true" /> Export PDF</button>
                  <button type="button" className="cc-icon-btn pm-danger" onClick={() => setDeleting(selected)} aria-label={`Delete ${selected.title || 'policy'}`} title="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
            )}
          </CardState>
        </Card>

        <Card title="Version History and Change Log">
          <CardState state={loadState} empty={!selected ? 'Select a policy to see its history.' : null}>
            {selected && (
              <>
                <ol className="pm-timeline">
                  {log.entries.map((e, i) => (
                    <li key={e.key} className={i === 0 ? 'current' : ''}>
                      <span className="pm-ver">{e.version ? `v${String(e.version).replace(/^v/i, '')}` : <History size={13} aria-hidden="true" />}</span>
                      <div>
                        <div className="pm-tl-top"><b>{fmtDate(e.at)}</b><span className={`cc-pill ${i === 0 ? 'good' : 'muted'}`}>{e.label}</span></div>
                        <p>{e.note}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="pm-note"><Info size={13} aria-hidden="true" /> Earlier versions and per-change notes are not recorded: the register keeps only the current version of each policy.</p>
              </>
            )}
          </CardState>
        </Card>

        <Card title="Policy Acknowledgment and Compliance">
          <div className="cc-empty pm-ack-empty">
            <div>
              <CheckCircle2 size={26} aria-hidden="true" />
              <p><b>Acknowledgments are not recorded yet.</b></p>
              <p>No table stores who has read and accepted each policy, so acknowledgment rates by person or role cannot be measured. Governance gaps above are measured from the register itself.</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="pm-row">
        <Card title="Status distribution" sub="Every policy in the register">
          <CardState state={loadState} empty={all.length === 0 ? 'No policies yet.' : null}>
            <Donut segments={statusSegments} total={portfolio.total} centerLabel="policies" onSelect={(s) => setFilters({ ...EMPTY_FILTERS, status: s.status === 'unknown' ? 'all' : s.status })} />
          </CardState>
        </Card>
        <Card title="Review pipeline" sub={`Next 12 months${portfolio.pipeline.overdue ? `, plus ${portfolio.pipeline.overdue} overdue` : ''}`}>
          <CardState state={loadState}>
            <Bars items={pipelineItems} color="var(--cc-blue)" emptyText="No reviews scheduled in the next 12 months." />
          </CardState>
        </Card>
        <Card title="Policies by category">
          <CardState state={loadState}>
            <Bars items={categories} onSelect={(c) => setFilters({ ...EMPTY_FILTERS, category: c.label === 'Uncategorised' ? '' : c.label })} emptyText="No policies yet." />
          </CardState>
        </Card>
      </div>

      <PolicyModal open={modalOpen} existing={editing} onClose={() => setModalOpen(false)} onSaved={load} />
      <DeleteConfirm policy={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} busy={deleteBusy} />
    </div>
  )
}
