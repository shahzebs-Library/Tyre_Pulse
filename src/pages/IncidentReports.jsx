/**
 * IncidentReports (route /incidents) — logs operational incidents (near-miss,
 * damage, breakdown, safety, theft…) raised against an asset/site. Distinct from
 * the formal Accidents module: this is the lightweight operational log with a
 * status lifecycle, severity grading, root-cause / action tracking and export.
 *
 * Real data, KPI tiles, a severity/type chart, search + status/severity/type
 * filters, create/edit modal, delete confirmation, Excel/PDF export, and
 * loading / empty / error states throughout. Runs on the `incident_reports`
 * table (apply MIGRATIONS_V138_INCIDENT_REPORTS.sql).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  AlertOctagon, Plus, Trash2, Pencil, X, Search, Filter, ShieldAlert,
  CheckCircle2, Inbox, FileSpreadsheet, FileText, AlertTriangle, Loader2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listIncidents, createIncident, updateIncident, deleteIncident,
  INCIDENT_TYPES, INCIDENT_SEVERITIES, INCIDENT_STATUSES,
} from '../lib/api/incidents'
import { summarizeIncidents, incidentAgeDays } from '../lib/incidents'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(ArcElement, Tooltip, Legend)

const TYPE_META = {
  near_miss: { label: 'Near miss' },
  damage: { label: 'Damage' },
  breakdown: { label: 'Breakdown' },
  safety: { label: 'Safety' },
  theft: { label: 'Theft' },
  other: { label: 'Other' },
}
const typeLabel = (t) => TYPE_META[t]?.label || (t ? t.replace(/_/g, ' ') : '—')

const SEVERITY_META = {
  low: { label: 'Low', cls: 'bg-slate-700/40 text-slate-300 border border-slate-600/50', color: '#64748b' },
  medium: { label: 'Medium', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50', color: '#0ea5e9' },
  high: { label: 'High', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50', color: '#f59e0b' },
  critical: { label: 'Critical', cls: 'bg-red-900/40 text-red-300 border border-red-700/50', color: '#ef4444' },
}
const STATUS_META = {
  open: { label: 'Open', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50' },
  investigating: { label: 'Investigating', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  resolved: { label: 'Resolved', cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
  closed: { label: 'Closed', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}

const emptyForm = (country) => ({
  incident_no: '',
  incident_type: 'other',
  asset_no: '',
  site: '',
  incident_date: new Date().toISOString().slice(0, 10),
  severity: 'medium',
  reported_by: '',
  description: '',
  action_taken: '',
  status: 'open',
  country: country && country !== 'All' ? country : null,
})

export default function IncidentReports() {
  const { activeCountry } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm(activeCountry))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listIncidents({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      else setError(toUserMessage(err, 'Could not load incident reports.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeIncidents(rows || []), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false
      if (typeFilter !== 'all' && r.incident_type !== typeFilter) return false
      if (q) {
        const hay = `${r.incident_no || ''} ${r.asset_no || ''} ${r.site || ''} ${r.reported_by || ''} ${r.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, severityFilter, typeFilter, search])

  // Chart: incidents by severity (donut).
  const chartText = typeof document !== 'undefined'
    ? (getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af')
    : '#9ca3af'
  const donutData = {
    labels: INCIDENT_SEVERITIES.map((s) => SEVERITY_META[s].label),
    datasets: [{
      data: INCIDENT_SEVERITIES.map((s) => summary.bySeverity[s]),
      backgroundColor: INCIDENT_SEVERITIES.map((s) => SEVERITY_META[s].color),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: chartText, boxWidth: 12, padding: 14 } } },
  }
  const hasChartData = INCIDENT_SEVERITIES.some((s) => summary.bySeverity[s] > 0)

  const kpis = [
    { label: 'Total incidents', value: summary.total, icon: AlertOctagon, tone: 'text-[var(--text-primary)]' },
    { label: 'Open / investigating', value: summary.open, icon: Inbox, tone: 'text-sky-400' },
    { label: 'High / critical', value: summary.bySeverity.high + summary.bySeverity.critical, icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'Resolved', value: summary.byStatus.resolved + summary.byStatus.closed, icon: CheckCircle2, tone: 'text-green-400' },
  ]

  // Export --------------------------------------------------------------------
  const EXPORT_COLS = ['incident_no', 'incident_type', 'asset_no', 'site', 'incident_date', 'severity', 'status', 'age_days', 'reported_by', 'description']
  const EXPORT_HEADERS = ['Incident #', 'Type', 'Asset', 'Site', 'Date', 'Severity', 'Status', 'Age (days)', 'Reported by', 'Description']
  const exportRows = filtered.map((r) => ({
    incident_no: r.incident_no || '',
    incident_type: typeLabel(r.incident_type),
    asset_no: r.asset_no || '',
    site: r.site || '',
    incident_date: r.incident_date || '',
    severity: SEVERITY_META[r.severity]?.label || r.severity || '',
    status: STATUS_META[r.status]?.label || r.status || '',
    age_days: incidentAgeDays(r, Date.now()) ?? '',
    reported_by: r.reported_by || '',
    description: r.description || '',
  }))

  // Form handlers -------------------------------------------------------------
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm(activeCountry))
    setFormError('')
    setModalOpen(true)
  }
  const openEdit = (inc) => {
    setEditing(inc)
    setForm({
      incident_no: inc.incident_no || '',
      incident_type: inc.incident_type || 'other',
      asset_no: inc.asset_no || '',
      site: inc.site || '',
      incident_date: (inc.incident_date || '').slice(0, 10),
      severity: inc.severity || 'medium',
      reported_by: inc.reported_by || '',
      description: inc.description || '',
      action_taken: inc.action_taken || '',
      status: inc.status || 'open',
      country: inc.country ?? null,
    })
    setFormError('')
    setModalOpen(true)
  }

  const save = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.description.trim() && !form.asset_no.trim()) {
      setFormError('Add a description or link an asset before saving.')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const updated = await updateIncident(editing.id, form)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createIncident(form)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the incident. Please try again.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteIncident(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the incident.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  const clearFilters = () => { setStatusFilter('all'); setSeverityFilter('all'); setTypeFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || severityFilter !== 'all' || typeFilter !== 'all' || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incident Reports"
        subtitle="Operational incident log — near-miss, damage, breakdown, safety, theft — tracked from report to resolution."
        icon={AlertOctagon}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'incident_reports')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Incident Reports', 'incident_reports', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={15} /> Report incident
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Incident reports aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V138_INCIDENT_REPORTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load incident reports.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Chart + status summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Incidents by severity</h3>
          <div className="h-64">
            {rows === null ? (
              <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
            ) : hasChartData ? (
              <Doughnut data={donutData} options={donutOpts} />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No incidents to chart.</div>
            )}
          </div>
        </div>
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Lifecycle status</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {INCIDENT_STATUSES.map((s) => (
              <div key={s} className="rounded-lg border border-[var(--input-border)] p-4 text-center">
                <p className={`text-2xl font-bold ${s === 'open' ? 'text-sky-400' : s === 'investigating' ? 'text-amber-400' : s === 'resolved' ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>
                  {rows === null ? '—' : summary.byStatus[s]}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{STATUS_META[s].label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-4 flex items-center gap-1.5">
            <ShieldAlert size={12} /> {summary.open} incident{summary.open === 1 ? '' : 's'} still require attention.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search incident #, asset, site, reporter, description…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <select className="input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="all">All severities</option>
            {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
            <option value="all">All types</option>
            {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Incident #', 'Type', 'Asset', 'Site', 'Date', 'Severity', 'Status', 'Age', ''].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {(rows.length === 0 && !missing) ? (
                    <span className="inline-flex flex-col items-center gap-2">
                      <AlertOctagon size={26} className="opacity-60" />
                      No incidents logged yet.
                      <button onClick={openCreate} className="btn-primary text-xs inline-flex items-center gap-1.5 mt-1"><Plus size={13} /> Report the first incident</button>
                    </span>
                  ) : (
                    <span className="inline-flex flex-col items-center gap-2"><Filter size={22} className="opacity-60" />No incidents match these filters.</span>
                  )}
                </td></tr>
              ) : (
                filtered.map((r) => {
                  const age = incidentAgeDays(r, Date.now())
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.incident_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] capitalize">{typeLabel(r.incident_type)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.incident_date)}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${SEVERITY_META[r.severity]?.cls || SEVERITY_META.medium.cls}`}>{SEVERITY_META[r.severity]?.label || r.severity}</span></td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_META[r.status]?.cls || STATUS_META.open.cls}`}>{STATUS_META[r.status]?.label || r.status}</span></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{age == null ? '—' : `${age}d`}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
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
      </div>

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => !saving && setModalOpen(false)}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto !p-0" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-[var(--card-bg)] border-b border-[var(--input-border)] px-6 py-4 flex items-center justify-between z-10">
              <h2 className="font-bold text-[var(--text-primary)] inline-flex items-center gap-2">
                <AlertOctagon size={18} className="text-[var(--brand-bright)]" /> {editing ? 'Edit incident' : 'Report incident'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Incident #</label>
                  <input className="input w-full" placeholder="Optional reference" value={form.incident_no} maxLength={60} onChange={(e) => set('incident_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select className="input w-full" value={form.incident_type} onChange={(e) => set('incident_type', e.target.value)}>
                    {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Asset #</label>
                  <input className="input w-full" placeholder="e.g. TRK-104" value={form.asset_no} maxLength={60} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" placeholder="Depot / location" value={form.site} maxLength={120} onChange={(e) => set('site', e.target.value)} />
                </div>
                <div>
                  <label className="label">Incident date</label>
                  <input type="date" className="input w-full" value={form.incident_date || ''} onChange={(e) => set('incident_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Severity</label>
                  <select className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                    {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Reported by</label>
                  <input className="input w-full" placeholder="Name" value={form.reported_by} maxLength={120} onChange={(e) => set('reported_by', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input w-full min-h-[100px] resize-y" placeholder="What happened? Include the sequence of events and any contributing factors." value={form.description} maxLength={8000} onChange={(e) => set('description', e.target.value)} />
              </div>
              <div>
                <label className="label">Action taken</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Immediate action, containment, and any corrective steps." value={form.action_taken} maxLength={8000} onChange={(e) => set('action_taken', e.target.value)} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60" disabled={saving}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  {saving ? 'Saving…' : editing ? 'Update incident' : 'Save incident'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--text-primary)]">Delete this incident?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {typeLabel(confirmDelete.incident_type)}{confirmDelete.asset_no ? ` · ${confirmDelete.asset_no}` : ''}{confirmDelete.incident_no ? ` · ${confirmDelete.incident_no}` : ''}. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-primary text-sm inline-flex items-center gap-2 !bg-red-600 hover:!bg-red-500 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
