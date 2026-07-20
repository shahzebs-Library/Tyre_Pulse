/**
 * PartsRequests (route /parts-requests) - the workshop parts-request lifecycle.
 *
 * A technician raises a parts request for a job (status 'requested'); a foreman
 * or storekeeper approves ('approved'), issues ('issued') and fulfils
 * ('fulfilled') it - which is what resolves the technician's blocked-for-parts
 * time on the Workshop Live board.
 *
 * View is open to Admin / Manager / Director + super-admin; the status-advance
 * write actions are enforced server-side by RLS (elevated only) and gated in the
 * UI. All maths live in the pure, unit-tested partsRequests engine; this page is
 * presentation + orchestration only. Honest loading / empty / error states, no
 * fabricated data. Light + dark via var(--*).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  PackagePlus, Boxes, Clock, CheckCircle2, AlertTriangle, Filter, X, Plus,
  Loader2, FileSpreadsheet, FileText, Search, ClipboardList, PieChart,
  BarChart3, Check, ThumbsUp, Ban, ArrowRight, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EChart from '../components/charts/EChart'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listPartsRequests, createPartsRequest, setPartsRequestStatus,
  listOpenJobs, listPartCatalog, distinctSites,
} from '../lib/api/partsRequests'
import {
  summarizeParts, isOpenParts, nextPartsStatus, PARTS_STATUS,
  PARTS_STATUS_LABEL, PARTS_PRIORITIES, PARTS_PRIORITY_LABEL, normalizePartsStatus,
} from '../lib/partsRequests'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])

// Forward-action label per current open status.
const FORWARD_ACTION = {
  requested: { label: 'Approve', icon: ThumbsUp },
  approved: { label: 'Issue', icon: ArrowRight },
  issued: { label: 'Fulfil', icon: Check },
}

const STATUS_TONE = {
  requested: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  approved: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  issued: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  fulfilled: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-300 border-red-500/30',
  cancelled: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}
const PRIORITY_TONE = {
  low: 'text-[var(--text-muted)]',
  medium: 'text-sky-300',
  high: 'text-amber-300',
  critical: 'text-red-300',
}

const EMPTY_FORM = {
  job_id: '', asset_no: '', part_id: '', part_name: '', qty: '1',
  priority: 'medium', needed_by: '', notes: '',
}

const todayISO = () => new Date().toISOString().slice(0, 10)

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 16) : d.toLocaleString()
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString()
}
function fmtNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : 'N/A'
}
function fmtHours(v) {
  return v == null ? 'N/A' : `${v} h`
}

export default function PartsRequests() {
  const { activeCountry, activeCurrency } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const canWrite = isSuperAdmin === true || WRITE_ROLES.has(profile?.role)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [filters, setFilters] = useState({ status: 'All', site: 'All', q: '' })
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const clearFilters = () => setFilters({ status: 'All', site: 'All', q: '' })

  // Per-row status action in flight.
  const [busyId, setBusyId] = useState(null)

  // New-request modal.
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [jobs, setJobs] = useState([])
  const [parts, setParts] = useState([])
  const [pickerLoading, setPickerLoading] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const data = await listPartsRequests({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setMissing(false)
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load parts requests.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { setLoading(true); load() }, [load])

  // Load picker sources when the modal opens (best-effort).
  const openModal = useCallback(async () => {
    setForm({ ...EMPTY_FORM })
    setFormError('')
    setShowModal(true)
    setPickerLoading(true)
    try {
      const [j, p] = await Promise.all([
        listOpenJobs({ country: activeCountry }).catch(() => []),
        listPartCatalog({ country: activeCountry }).catch(() => []),
      ])
      setJobs(Array.isArray(j) ? j : [])
      setParts(Array.isArray(p) ? p : [])
    } finally {
      setPickerLoading(false)
    }
  }, [activeCountry])

  const siteOptions = useMemo(() => distinctSites(rows), [rows])

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return rows.filter((r) => {
      if (filters.status !== 'All' && normalizePartsStatus(r.status) !== filters.status) return false
      if (filters.site !== 'All' && String(r.site || '') !== filters.site) return false
      if (q) {
        const hay = `${r.part_name || ''} ${r.asset_no || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, filters])

  const summary = useMemo(() => summarizeParts(rows, {}), [rows])

  const fulfilledToday = useMemo(() => {
    const today = todayISO()
    return rows.filter((r) => normalizePartsStatus(r.status) === 'fulfilled'
      && String(r.fulfilled_at || '').slice(0, 10) === today).length
  }, [rows])

  // ── Charts (EChart + reportColors) ─────────────────────────────────────────
  const statusChartOption = useMemo(() => {
    const data = PARTS_STATUS
      .map((s) => ({ name: PARTS_STATUS_LABEL[s], value: summary.byStatus[s] || 0 }))
      .filter((d) => d.value > 0)
    const colors = categorical(data.length)
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { color: 'rgba(148,163,184,0.95)', fontSize: 11 } },
      series: [{
        type: 'pie', radius: ['45%', '70%'], center: ['50%', '45%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: 'var(--card-bg, transparent)', borderWidth: 1 },
        label: { color: 'rgba(148,163,184,0.95)', fontSize: 11 },
        data: data.map((d, i) => ({ ...d, itemStyle: { color: colors[i] } })),
      }],
    }
  }, [summary.byStatus])

  const partChartOption = useMemo(() => {
    const top = summary.byPart.slice(0, 10)
    return {
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', minInterval: 1, axisLabel: { color: 'rgba(148,163,184,0.9)', fontSize: 10 }, splitLine: { lineStyle: { color: 'var(--panel-2)' } } },
      yAxis: {
        type: 'category', inverse: true,
        data: top.map((p) => p.part),
        axisLabel: { color: 'rgba(148,163,184,0.9)', fontSize: 10, width: 120, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: top.map((p, i) => ({ value: p.count, itemStyle: { color: colorAt(i), borderRadius: [0, 4, 4, 0] } })),
      }],
    }
  }, [summary.byPart])

  // ── Status advance ─────────────────────────────────────────────────────────
  const advance = useCallback(async (row, status) => {
    if (!canWrite) return
    setBusyId(row.id)
    setError('')
    try {
      const updated = await setPartsRequestStatus(row.id, status)
      if (updated) setRows((r) => r.map((x) => (x.id === row.id ? updated : x)))
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not update the request.'))
    } finally {
      setBusyId(null)
    }
  }, [canWrite])

  // ── Create ─────────────────────────────────────────────────────────────────
  const onPickPart = useCallback((partId) => {
    const p = parts.find((x) => x.id === partId)
    setForm((f) => ({
      ...f,
      part_id: partId,
      part_name: p ? (p.name || f.part_name) : f.part_name,
    }))
  }, [parts])

  const onPickJob = useCallback((jobId) => {
    const j = jobs.find((x) => x.id === jobId)
    setForm((f) => ({
      ...f,
      job_id: jobId,
      asset_no: j ? (j.asset_no || f.asset_no) : f.asset_no,
      site: f.site,
    }))
  }, [jobs])

  const submitForm = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.part_id && !String(form.part_name || '').trim()) {
      setFormError('Select a part or enter a part name.')
      return
    }
    setSaving(true)
    try {
      const job = jobs.find((x) => x.id === form.job_id)
      const created = await createPartsRequest({
        ...form,
        site: job?.site || null,
        needed_by: form.needed_by ? new Date(form.needed_by).toISOString() : null,
        country: activeCountry !== 'All' ? activeCountry : null,
      })
      if (created) setRows((r) => [created, ...r])
      setShowModal(false)
      setForm({ ...EMPTY_FORM })
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not raise the request.'))
    } finally {
      setSaving(false)
    }
  }, [form, jobs, activeCountry])

  // ── Exports ────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['requested_at', 'part_name', 'qty', 'asset_no', 'site', 'priority', 'status', 'needed_by', 'fulfilled_at']
  const EXPORT_HEADERS = ['Requested', 'Part', 'Qty', 'Asset', 'Site', 'Priority', 'Status', 'Needed by', 'Fulfilled']
  const exportRows = () => filtered.map((r) => ({
    requested_at: r.requested_at ? String(r.requested_at).slice(0, 16).replace('T', ' ') : '',
    part_name: r.part_name || '',
    qty: r.qty ?? '',
    asset_no: r.asset_no || '',
    site: r.site || '',
    priority: PARTS_PRIORITY_LABEL[r.priority] || r.priority || '',
    status: PARTS_STATUS_LABEL[normalizePartsStatus(r.status)] || r.status || '',
    needed_by: r.needed_by ? String(r.needed_by).slice(0, 10) : '',
    fulfilled_at: r.fulfilled_at ? String(r.fulfilled_at).slice(0, 16).replace('T', ' ') : '',
  }))
  const exportExcel = () => {
    const name = reportFileName('Parts Requests', reportDateLabel())
    exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, name, 'Parts Requests', { title: 'Parts Requests', currency: activeCurrency })
  }
  const exportPdf = () => {
    const name = reportFileName('Parts Requests', reportDateLabel())
    exportToPdf(exportRows(), EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Parts Requests Report', name, 'landscape', '', { currency: activeCurrency })
  }

  const kpis = [
    { label: 'Open Requests', value: fmtNum(summary.open), icon: Boxes },
    { label: 'Overdue', value: fmtNum(summary.overdue), icon: AlertTriangle, tone: summary.overdue > 0 ? 'text-red-300' : undefined },
    { label: 'Fulfilled Today', value: fmtNum(fulfilledToday), icon: CheckCircle2 },
    { label: 'Avg Fulfil Hours', value: fmtHours(summary.avgFulfilOreHours), icon: Clock },
  ]

  const inputCls = 'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parts Requests"
        subtitle="Technicians raise parts requests for their jobs; a foreman or storekeeper approves and issues them, which resolves blocked-for-parts time on the workshop board."
        icon={PackagePlus}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={canWrite && (
          <button onClick={openModal} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={missing}>
            <Plus size={14} /> New request
          </button>
        )}
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Parts Requests is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply the <span className="font-mono text-[var(--text-primary)]">v296_parts_requests</span> migration, then reload.
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
          <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <RefreshCw size={13} /> Retry
          </button>
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
                <Icon size={15} className="text-[var(--text-muted)]" />
              </div>
              <p className={`text-xl font-bold mt-1 ${k.tone || 'text-[var(--text-primary)]'}`}>{loading ? '-' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <PieChart size={16} className="text-[var(--text-secondary)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">Requests by status</h3>
          </div>
          <div className="h-[240px]">
            {summary.total === 0
              ? <EmptyChart />
              : <EChart option={statusChartOption} className="h-full" ariaLabel="Requests by status" />}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={16} className="text-[var(--text-secondary)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">Most requested parts</h3>
          </div>
          <div className="h-[240px]">
            {summary.byPart.length === 0
              ? <EmptyChart />
              : <EChart option={partChartOption} className="h-full" ariaLabel="Most requested parts" />}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <Filter size={15} /> <span className="text-sm font-medium">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Status</span>
            <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={inputCls}>
              <option value="All">All statuses</option>
              {PARTS_STATUS.map((s) => <option key={s} value={s}>{PARTS_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Site</span>
            <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)} className={inputCls}>
              <option value="All">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
            <span>Search</span>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input value={filters.q} onChange={(e) => setFilter('q', e.target.value)} className={`${inputCls} pl-9`} placeholder="Part, asset or note..." />
            </div>
          </label>
        </div>
        {(filters.status !== 'All' || filters.site !== 'All' || filters.q) && (
          <button onClick={clearFilters} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X size={13} /> Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList size={16} className="text-[var(--text-secondary)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">Parts requests</h3>
          <span className="text-[11px] text-[var(--text-muted)]">{filtered.length} shown</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportExcel} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={exportPdf} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
              <FileText size={14} /> PDF
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-[var(--text-muted)]">
            <Boxes size={28} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">{rows.length === 0 ? 'No parts requests yet.' : 'No requests match the filters.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                  <th className="py-2 pr-3 font-medium">Requested</th>
                  <th className="py-2 pr-3 font-medium">Part</th>
                  <th className="py-2 pr-3 font-medium text-right">Qty</th>
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 pr-3 font-medium">Site</th>
                  <th className="py-2 pr-3 font-medium">Priority</th>
                  <th className="py-2 pr-3 font-medium">Needed by</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  {canWrite && <th className="py-2 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((r) => {
                  const status = normalizePartsStatus(r.status)
                  const fwd = FORWARD_ACTION[status]
                  const FwdIcon = fwd?.icon
                  const open = isOpenParts(status)
                  const overdue = open && r.needed_by && new Date(r.needed_by).getTime() < Date.now()
                  const rowBusy = busyId === r.id
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/50">
                      <td className="py-2 pr-3 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.requested_at)}</td>
                      <td className="py-2 pr-3 text-[var(--text-primary)]">{r.part_name || 'N/A'}</td>
                      <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtNum(r.qty)}</td>
                      <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.asset_no || 'N/A'}</td>
                      <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                      <td className="py-2 pr-3">
                        <span className={`text-xs font-medium ${PRIORITY_TONE[r.priority] || 'text-[var(--text-secondary)]'}`}>
                          {PARTS_PRIORITY_LABEL[r.priority] || r.priority || 'N/A'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {r.needed_by ? (
                          <span className={overdue ? 'text-red-300 font-medium' : 'text-[var(--text-secondary)]'}>
                            {fmtDate(r.needed_by)}{overdue ? ' (overdue)' : ''}
                          </span>
                        ) : <span className="text-[var(--text-muted)]">N/A</span>}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONE[status] || STATUS_TONE.cancelled}`}>
                          {PARTS_STATUS_LABEL[status] || r.status || 'N/A'}
                        </span>
                      </td>
                      {canWrite && (
                        <td className="py-2 text-right whitespace-nowrap">
                          {open ? (
                            <div className="inline-flex items-center gap-1.5">
                              {fwd && (
                                <button
                                  onClick={() => advance(r, nextPartsStatus(status))}
                                  disabled={rowBusy}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white disabled:opacity-60"
                                  title={fwd.label}
                                >
                                  {rowBusy ? <Loader2 size={12} className="animate-spin" /> : (FwdIcon && <FwdIcon size={12} />)} {fwd.label}
                                </button>
                              )}
                              <button
                                onClick={() => advance(r, 'rejected')}
                                disabled={rowBusy}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-red-300 hover:border-red-500/40 disabled:opacity-60"
                                title="Reject"
                              >
                                <Ban size={12} /> Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-[var(--text-muted)]">Closed</span>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <p className="text-[11px] text-[var(--text-muted)] mt-2">Showing the first 500 of {filtered.length}. Narrow the filters or export for the full set.</p>
            )}
          </div>
        )}
      </div>

      {/* New request modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setShowModal(false)}>
          <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <PackagePlus size={18} className="text-[var(--text-secondary)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">New parts request</h3>
              <button onClick={() => setShowModal(false)} className="ml-auto p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
            </div>

            {formError && (
              <div className="mb-4 rounded-lg border border-red-800/50 bg-red-500/10 flex items-center gap-2 px-3 py-2">
                <AlertTriangle size={15} className="text-red-400" />
                <span className="text-sm text-red-200">{formError}</span>
              </div>
            )}

            <form onSubmit={submitForm} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
                <span>Job (open work order) <span className="text-[var(--text-muted)]">(optional)</span></span>
                <select value={form.job_id} onChange={(e) => onPickJob(e.target.value)} className={inputCls} disabled={pickerLoading}>
                  <option value="">{pickerLoading ? 'Loading jobs...' : 'No job / general request'}</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {[j.work_order_no || j.id.slice(0, 8), j.asset_no, j.status].filter(Boolean).join(' | ')}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Part (catalog)</span>
                <select value={form.part_id} onChange={(e) => onPickPart(e.target.value)} className={inputCls} disabled={pickerLoading}>
                  <option value="">{pickerLoading ? 'Loading parts...' : 'Not in catalog / type name'}</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {[p.part_no, p.name].filter(Boolean).join(' - ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Part name <span className="text-red-400">*</span></span>
                <input value={form.part_name} onChange={(e) => setField('part_name', e.target.value)} className={inputCls} placeholder="e.g. Brake pad set" />
              </label>

              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Quantity</span>
                <input type="number" min="1" step="any" value={form.qty} onChange={(e) => setField('qty', e.target.value)} className={inputCls} />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Priority</span>
                <select value={form.priority} onChange={(e) => setField('priority', e.target.value)} className={inputCls}>
                  {PARTS_PRIORITIES.map((p) => <option key={p} value={p}>{PARTS_PRIORITY_LABEL[p]}</option>)}
                </select>
              </label>

              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Asset <span className="text-[var(--text-muted)]">(optional)</span></span>
                <input value={form.asset_no} onChange={(e) => setField('asset_no', e.target.value)} className={inputCls} placeholder="auto-filled from job" />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Needed by <span className="text-[var(--text-muted)]">(optional)</span></span>
                <input type="date" value={form.needed_by} onChange={(e) => setField('needed_by', e.target.value)} className={inputCls} />
              </label>

              <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
                <span>Notes <span className="text-[var(--text-muted)]">(optional)</span></span>
                <input value={form.notes} onChange={(e) => setField('notes', e.target.value)} className={inputCls} placeholder="optional" />
              </label>

              <div className="sm:col-span-2 flex items-center gap-3 pt-1">
                <button type="submit" disabled={saving} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Raise request
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyChart({ hint = 'No requests yet.' }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
      <Boxes size={26} className="opacity-40 mb-2" />
      <p className="text-xs">{hint}</p>
    </div>
  )
}
