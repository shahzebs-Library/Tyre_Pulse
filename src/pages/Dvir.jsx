/**
 * Dvir (route /dvir) — Driver Vehicle Inspection Reports.
 *
 * Log daily pre/post-trip vehicle inspections: which asset, who inspected it,
 * the date, whether defects were found, whether the vehicle is safe to operate,
 * and a status lifecycle (open -> resolved -> closed). Full CRUD with a defects
 * vs clean breakdown chart, KPI tiles, filters, search, Excel/PDF export, and
 * loading / empty / error states throughout.
 *
 * Runs on the new `dvir_reports` table (MIGRATIONS_V155). When the table is not
 * yet deployed the lister degrades to [] and the page surfaces a migration hint.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  ClipboardCheck, ClipboardList, CheckCircle2, AlertTriangle, Truck,
  Plus, Pencil, Trash2, Search, X, Filter, Save, Loader2,
  FileSpreadsheet, FileText,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDvirReports, createDvirReport, updateDvirReport, deleteDvirReport,
  DVIR_INSPECTION_TYPES, DVIR_STATUS_VALUES,
} from '../lib/api/dvir'
import { summarizeDvir, DVIR_TYPE_META, DVIR_STATUS_META } from '../lib/dvir'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(ArcElement, Tooltip, Legend)

const TYPE_STYLES = {
  pre_trip: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  post_trip: 'bg-violet-900/40 text-violet-300 border border-violet-700/50',
}
const STATUS_STYLES = {
  open: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  resolved: 'bg-green-900/40 text-green-300 border border-green-700/50',
  closed: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
}
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

const EMPTY_FORM = {
  asset_no: '', driver_name: '', inspection_type: 'pre_trip', inspection_date: todayStr(),
  defects_found: false, defect_notes: '', safe_to_operate: true, site: '', status: 'open',
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function DvirModal({ initial, activeCountry, onClose, onSaved }) {
  const editing = !!initial?.id
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    ...(initial || {}),
    inspection_date: initial?.inspection_date || todayStr(),
    defects_found: !!initial?.defects_found,
    safe_to_operate: initial?.safe_to_operate == null ? true : !!initial.safe_to_operate,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.asset_no.trim()) { setError('An asset number is required.'); return }
    setBusy(true)
    try {
      const payload = {
        asset_no: form.asset_no,
        driver_name: form.driver_name || null,
        inspection_type: form.inspection_type,
        inspection_date: form.inspection_date || null,
        defects_found: !!form.defects_found,
        defect_notes: form.defect_notes || null,
        safe_to_operate: !!form.safe_to_operate,
        site: form.site || null,
        status: form.status,
      }
      if (editing) {
        await updateDvirReport(initial.id, payload)
      } else {
        await createDvirReport({
          ...payload,
          country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
        })
      }
      onSaved?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the inspection report.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, activeCountry, onSaved])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--input-border)] bg-[var(--card-bg)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--input-border)] bg-[var(--card-bg)]">
          <h3 className="text-base font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
            <ClipboardCheck size={18} className="text-[var(--brand-bright)]" />
            {editing ? 'Edit inspection report' : 'New inspection report'}
          </h3>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Asset number *</label>
              <input className="input w-full" value={form.asset_no} maxLength={120}
                placeholder="e.g. TRK-1042"
                onChange={(e) => set('asset_no', e.target.value)} autoFocus />
            </div>
            <div>
              <label className="label">Driver</label>
              <input className="input w-full" value={form.driver_name} maxLength={160}
                placeholder="Inspecting driver"
                onChange={(e) => set('driver_name', e.target.value)} />
            </div>
            <div>
              <label className="label">Inspection type</label>
              <select className="input w-full" value={form.inspection_type} onChange={(e) => set('inspection_type', e.target.value)}>
                {DVIR_INSPECTION_TYPES.map((t) => <option key={t} value={t}>{DVIR_TYPE_META[t]?.label || t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Inspection date</label>
              <input type="date" className="input w-full" value={form.inspection_date || ''}
                onChange={(e) => set('inspection_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Site</label>
              <input className="input w-full" value={form.site} maxLength={120}
                placeholder="Depot / branch"
                onChange={(e) => set('site', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {DVIR_STATUS_VALUES.map((s) => <option key={s} value={s}>{DVIR_STATUS_META[s]?.label || s}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 pt-1">
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" checked={!!form.defects_found} onChange={(e) => set('defects_found', e.target.checked)} />
              Defects found
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" checked={!!form.safe_to_operate} onChange={(e) => set('safe_to_operate', e.target.checked)} />
              Safe to operate
            </label>
          </div>

          <div>
            <label className="label">Defect notes</label>
            <textarea className="input w-full min-h-[100px] resize-y" value={form.defect_notes} maxLength={4000}
              placeholder="Describe any defects found during the inspection…"
              onChange={(e) => set('defect_notes', e.target.value)} />
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
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({ row, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true); setError('')
    try { await deleteDvirReport(row.id); onConfirm?.() }
    catch (err) { setError(toUserMessage(err, 'Could not delete the report.')); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-[var(--input-border)] bg-[var(--card-bg)] shadow-2xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-900/30 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Delete inspection report?</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Report for asset <span className="font-medium text-[var(--text-secondary)]">{row.asset_no}</span>
              {row.inspection_date ? ` on ${fmtDate(row.inspection_date)}` : ''} will be permanently removed.
            </p>
          </div>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button type="button" onClick={go} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Dvir() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modal, setModal] = useState(null)       // { row } | { row: null } for create
  const [deleting, setDeleting] = useState(null)  // row

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listDvirReports({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load inspection reports.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeDvir(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (typeFilter !== 'all' && r.inspection_type !== typeFilter) return false
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.site || ''} ${r.defect_notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, typeFilter, assetFilter, search])

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donutData = {
    labels: ['With defects', 'Clean'],
    datasets: [{
      data: [summary.withDefects, Math.max(0, summary.total - summary.withDefects)],
      backgroundColor: ['#ef4444', '#22c55e'],
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
  }

  const EXPORT_COLS = ['asset_no', 'driver_name', 'inspection_type', 'inspection_date', 'defects_found', 'safe_to_operate', 'site', 'status']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'Type', 'Date', 'Defects', 'Safe to operate', 'Site', 'Status']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '',
    driver_name: r.driver_name || '',
    inspection_type: DVIR_TYPE_META[r.inspection_type]?.label || r.inspection_type || '',
    inspection_date: fmtDate(r.inspection_date),
    defects_found: r.defects_found ? 'Yes' : 'No',
    safe_to_operate: r.safe_to_operate ? 'Yes' : 'No',
    site: r.site || '',
    status: DVIR_STATUS_META[r.status]?.label || r.status || '',
  }))

  const kpis = [
    { label: 'Total reports', value: summary.total, icon: ClipboardList, tone: 'text-[var(--text-primary)]' },
    { label: 'With defects', value: summary.withDefects, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Unsafe to operate', value: summary.unsafe, icon: Truck, tone: 'text-amber-400' },
    { label: 'Open', value: summary.open, icon: ClipboardCheck, tone: 'text-sky-400' },
  ]

  const clearFilters = () => { setStatusFilter('all'); setTypeFilter('all'); setAssetFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || assetFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="DVIR Reports"
        subtitle="Driver Vehicle Inspection Reports — daily pre/post-trip checks, defects found, and safe-to-operate status across the fleet."
        icon={ClipboardCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'dvir_reports') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'DVIR Reports', 'dvir_reports', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={() => setModal({ row: null })} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={15} /> New report
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">DVIR reports aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V155_DVIR_REPORTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load inspection reports.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Chart + summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Defects vs clean</h3>
          <div className="h-64">
            {rows && rows.length ? <Doughnut data={donutData} options={donutOpts} /> : <EmptyChart loading={rows === null} />}
          </div>
        </div>
        <div className="card lg:col-span-2 flex flex-col justify-center">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">At a glance</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <MiniStat label="Distinct assets" value={rows === null ? '—' : summary.distinctAssets} />
            <MiniStat label="Clean reports" value={rows === null ? '—' : Math.max(0, summary.total - summary.withDefects)} />
            <MiniStat label="Defect rate" value={rows === null || !summary.total ? '—' : `${Math.round((summary.withDefects / summary.total) * 100)}%`} tone="text-red-400" />
            <MiniStat label="Unsafe reports" value={rows === null ? '—' : summary.unsafe} tone="text-amber-400" />
            <MiniStat label="Open" value={rows === null ? '—' : summary.open} tone="text-sky-400" />
            <MiniStat label="Showing" value={rows === null ? '—' : `${filtered.length} / ${summary.total}`} />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, driver, site, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {DVIR_STATUS_VALUES.map((s) => <option key={s} value={s}>{DVIR_STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
            <option value="all">All types</option>
            {DVIR_INSPECTION_TYPES.map((t) => <option key={t} value={t}>{DVIR_TYPE_META[t]?.label || t}</option>)}
          </select>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
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
                {['Asset', 'Driver', 'Type', 'Date', 'Defects', 'Safe', 'Site', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {summary.total === 0 ? (
                    <><ClipboardList size={22} className="mx-auto mb-2 opacity-60" />No inspection reports yet. Log the first one to get started.</>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No reports match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.driver_name || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`badge text-[11px] px-2 py-0.5 rounded ${TYPE_STYLES[r.inspection_type] || ''}`}>{DVIR_TYPE_META[r.inspection_type]?.label || r.inspection_type}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.inspection_date)}</td>
                    <td className="px-4 py-2.5">
                      {r.defects_found
                        ? <span className="badge text-[11px] px-2 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/50 inline-flex items-center gap-1"><AlertTriangle size={11} /> Defects</span>
                        : <span className="badge text-[11px] px-2 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-700/50 inline-flex items-center gap-1"><CheckCircle2 size={11} /> Clean</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.safe_to_operate
                        ? <span className="text-green-400 inline-flex items-center gap-1 text-xs"><CheckCircle2 size={13} /> Safe</span>
                        : <span className="text-red-400 inline-flex items-center gap-1 text-xs"><X size={13} /> Unsafe</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || ''}`}>{DVIR_STATUS_META[r.status]?.label || r.status}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => setModal({ row: r })} className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]" aria-label="Edit"><Pencil size={15} /></button>
                        <button type="button" onClick={() => setDeleting(r)} className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)]" aria-label="Delete"><Trash2 size={15} /></button>
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

      {modal && (
        <DvirModal
          initial={modal.row}
          activeCountry={activeCountry}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          row={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => { setDeleting(null); load() }}
        />
      )}
    </div>
  )
}

function MiniStat({ label, value, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2.5">
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${tone}`}>{value}</p>
    </div>
  )
}

function EmptyChart({ loading, empty = 'No data.' }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
      {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : empty}
    </div>
  )
}
