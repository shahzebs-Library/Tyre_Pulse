/**
 * FleetRenewal (route /fleet-renewal) — Fleet Renewal Planning.
 *
 * Fleet managers plan vehicle replacements/renewals: for each asset they capture
 * its current age & mileage, a recommended action, a target replacement date, an
 * estimated cost, and a priority + lifecycle status
 * (planned → approved → deferred → completed). The page surfaces KPI tiles, a
 * priority/status distribution chart, filters + search, full CRUD via a modal,
 * a delete confirm, and Excel/PDF export — with loading / empty / error states.
 *
 * Backed by `fleet_renewal_plans` (MIGRATIONS_V159_FLEET_RENEWAL.sql). All table
 * access is null-safe country-scoped; org isolation + RBAC are enforced by RLS.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  Truck, TrendingUp, Calendar, DollarSign, Plus, Pencil, Trash2, Search, X,
  Filter, Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, ClipboardList,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listRenewalPlans, createRenewalPlan, updateRenewalPlan, deleteRenewalPlan,
} from '../lib/api/fleetRenewal'
import {
  summarizeRenewal, RENEWAL_STATUSES, RENEWAL_PRIORITIES,
  RENEWAL_STATUS_META, RENEWAL_PRIORITY_META,
} from '../lib/fleetRenewal'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(ArcElement, Tooltip, Legend)

const STATUS_STYLES = {
  planned:   'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  approved:  'bg-green-900/40 text-green-300 border border-green-700/50',
  deferred:  'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  completed: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
}
const PRIORITY_STYLES = {
  low:    'bg-slate-700/40 text-slate-300 border border-slate-600/50',
  medium: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  high:   'bg-red-900/40 text-red-300 border border-red-700/50',
}
const PRIORITY_HEX = { low: '#64748b', medium: '#0ea5e9', high: '#ef4444' }

const EMPTY_FORM = {
  asset_no: '', current_km: '', age_years: '', recommendation: '',
  target_replace_date: '', est_cost: '', priority: 'medium', status: 'planned',
  site: '', notes: '',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find the table') ||
    m.includes('schema cache') || (m.includes('relation') && m.includes('fleet_renewal_plans'))
}
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '—')
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString())

export default function FleetRenewal() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listRenewalPlans({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(isMissingRelation(err) ? 'missing' : (err?.message || 'Could not load renewal plans.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeRenewal(rows || []), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (priorityFilter !== 'all' && r.priority !== priorityFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.recommendation || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, priorityFilter, search])

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donutData = {
    labels: RENEWAL_PRIORITIES.map((p) => RENEWAL_PRIORITY_META[p].label),
    datasets: [{
      data: RENEWAL_PRIORITIES.map((p) => summary.byPriority[p]),
      backgroundColor: RENEWAL_PRIORITIES.map((p) => PRIORITY_HEX[p]),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'site', 'age_years', 'current_km', 'recommendation', 'priority', 'target_replace_date', 'est_cost', 'status']
  const EXPORT_HEADERS = ['Asset', 'Site', 'Age (yrs)', 'Current km', 'Recommendation', 'Priority', 'Target date', 'Est. cost', 'Status']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '',
    site: r.site || '',
    age_years: r.age_years ?? '',
    current_km: r.current_km ?? '',
    recommendation: r.recommendation || '',
    priority: RENEWAL_PRIORITY_META[r.priority]?.label || r.priority || '',
    target_replace_date: r.target_replace_date || '',
    est_cost: r.est_cost ?? '',
    status: RENEWAL_STATUS_META[r.status]?.label || r.status || '',
  }))

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', current_km: r.current_km ?? '', age_years: r.age_years ?? '',
      recommendation: r.recommendation || '', target_replace_date: r.target_replace_date ? String(r.target_replace_date).slice(0, 10) : '',
      est_cost: r.est_cost ?? '', priority: r.priority || 'medium', status: r.status || 'planned',
      site: r.site || '', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) {
        const updated = await updateRenewalPlan(editing.id, payload)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createRenewalPlan(payload)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(err?.message || 'Could not save the plan.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteRenewalPlan(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setFormError(err?.message || 'Could not delete the plan.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  const clearFilters = () => { setStatusFilter('all'); setPriorityFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || priorityFilter !== 'all' || search

  const kpis = [
    { label: 'Total plans', value: summary.total, icon: ClipboardList, tone: 'text-[var(--text-primary)]' },
    { label: 'High priority', value: summary.highPriority, icon: TrendingUp, tone: 'text-red-400' },
    { label: 'Planned', value: summary.planned, icon: Calendar, tone: 'text-sky-400' },
    { label: 'Total est. cost', value: formatCurrencyCompact(summary.totalEstCost, activeCurrency), icon: DollarSign, tone: 'text-amber-400' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Renewal Planning"
        subtitle="Plan vehicle replacements & renewals — age, mileage, recommended action, target date and budget, by priority."
        icon={Truck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'fleet_renewal_plans')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Fleet Renewal Planning', 'fleet_renewal_plans', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New plan
            </button>
          </div>
        }
      />

      {error === 'missing' ? (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Fleet renewal planning isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V159_FLEET_RENEWAL.sql</span>, then reload.
            </p>
          </div>
        </div>
      ) : error ? (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load renewal plans.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      ) : null}

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

      {/* Chart + lifecycle breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Plans by priority</h3>
          <div className="h-64">
            {rows && rows.length ? <Doughnut data={donutData} options={donutOpts} /> : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                {rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No plans yet.'}
              </div>
            )}
          </div>
        </div>
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Lifecycle</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {RENEWAL_STATUSES.map((s) => (
              <div key={s} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3">
                <p className="text-xs text-[var(--text-muted)]">{RENEWAL_STATUS_META[s].label}</p>
                <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{rows === null ? '—' : summary.byStatus[s]}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-4 flex items-center gap-1.5">
            <DollarSign size={12} /> Estimated renewal budget across all plans:
            <span className="font-semibold text-[var(--text-secondary)]">{formatCurrencyCompact(summary.totalEstCost, activeCurrency)}</span>
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, recommendation, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {RENEWAL_STATUSES.map((s) => <option key={s} value={s}>{RENEWAL_STATUS_META[s].label}</option>)}
          </select>
          <select className="input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Priority">
            <option value="all">All priorities</option>
            {RENEWAL_PRIORITIES.map((p) => <option key={p} value={p}>{RENEWAL_PRIORITY_META[p].label}</option>)}
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
                {['Asset', 'Site', 'Age', 'Current km', 'Recommendation', 'Priority', 'Target date', 'Est. cost', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {summary.total === 0 ? 'No renewal plans yet — create the first to start planning.' : 'No plans match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.age_years == null ? '—' : `${r.age_years} yr`}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{num(r.current_km)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[240px] truncate" title={r.recommendation || ''}>{r.recommendation || '—'}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${PRIORITY_STYLES[r.priority] || ''}`}>{RENEWAL_PRIORITY_META[r.priority]?.label || r.priority}</span></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.target_replace_date)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.est_cost == null ? '—' : formatCurrencyCompact(r.est_cost, activeCurrency)}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || ''}`}>{RENEWAL_STATUS_META[r.status]?.label || r.status}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-300" aria-label="Delete"><Trash2 size={14} /></button>
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
      {modalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--input-border)] flex items-center justify-between">
              <h2 className="font-bold text-[var(--text-primary)]">{editing ? 'Edit renewal plan' : 'New renewal plan'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number *</label>
                  <input className="input w-full" value={form.asset_no} onChange={(e) => setField('asset_no', e.target.value)} placeholder="e.g. TRK-1042" maxLength={120} />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" value={form.site} onChange={(e) => setField('site', e.target.value)} placeholder="Depot / branch" />
                </div>
                <div>
                  <label className="label">Current km</label>
                  <input type="number" className="input w-full" value={form.current_km} onChange={(e) => setField('current_km', e.target.value)} placeholder="e.g. 385000" />
                </div>
                <div>
                  <label className="label">Age (years)</label>
                  <input type="number" step="0.1" className="input w-full" value={form.age_years} onChange={(e) => setField('age_years', e.target.value)} placeholder="e.g. 8" />
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input w-full" value={form.priority} onChange={(e) => setField('priority', e.target.value)}>
                    {RENEWAL_PRIORITIES.map((p) => <option key={p} value={p}>{RENEWAL_PRIORITY_META[p].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    {RENEWAL_STATUSES.map((s) => <option key={s} value={s}>{RENEWAL_STATUS_META[s].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Target replace date</label>
                  <input type="date" className="input w-full" value={form.target_replace_date} onChange={(e) => setField('target_replace_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Estimated cost ({activeCurrency})</label>
                  <input type="number" className="input w-full" value={form.est_cost} onChange={(e) => setField('est_cost', e.target.value)} placeholder="e.g. 250000" />
                </div>
              </div>
              <div>
                <label className="label">Recommended action</label>
                <input className="input w-full" value={form.recommendation} onChange={(e) => setField('recommendation', e.target.value)} placeholder="e.g. Replace with EV tractor unit" maxLength={8000} />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[80px] resize-y" value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Justification, TCO context, procurement notes…" maxLength={8000} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving…' : (editing ? 'Save changes' : 'Create plan')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">Delete renewal plan?</p>
                  <p className="text-sm text-[var(--text-muted)] mt-1">Plan for <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.asset_no}</span> will be permanently removed.</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
                <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                  {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
