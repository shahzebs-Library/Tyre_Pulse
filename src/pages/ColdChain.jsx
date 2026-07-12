/**
 * ColdChain (route /cold-chain) — Cold-Chain Monitor. Logs refrigerated-cargo
 * temperature readings for an asset/site against a configured safe range and
 * flags breaches (outside range) and warnings (within 1°C of a bound). Manual
 * entry today; the schema + service are sensor-ready for a future ingest feed.
 *
 * Runs on the new `cold_chain_logs` table (V143). Real data, KPI tiles, a
 * status doughnut, create/edit modal, filters, search, delete confirm,
 * Excel/PDF export, and loading/empty/error states throughout. Breach/warning
 * classification lives in the pure `src/lib/coldChain.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  Snowflake, ThermometerSnowflake, AlertTriangle, CheckCircle2,
  Boxes, Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listReadings, createReading, updateReading, deleteReading,
} from '../lib/api/coldChain'
import {
  classifyTemp, summarizeColdChain, COLD_CHAIN_STATUS_META, COLD_CHAIN_STATUSES,
} from '../lib/coldChain'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(ArcElement, Tooltip, Legend)

const STATUS_STYLES = {
  breach: 'bg-red-900/40 text-red-300 border border-red-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  ok: 'bg-green-900/40 text-green-300 border border-green-700/50',
}
const TEMP_TONE = { breach: 'text-red-400', warning: 'text-amber-400', ok: 'text-[var(--text-primary)]' }

const EMPTY_FORM = {
  asset_no: '', site: '', temperature_c: '', min_threshold_c: '', max_threshold_c: '',
  recorded_at: '', notes: '',
}

function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}
const rangeText = (r) => {
  const lo = r.min_threshold_c
  const hi = r.max_threshold_c
  if (lo == null && hi == null) return '—'
  if (lo != null && hi != null) return `${lo}° to ${hi}°C`
  if (lo != null) return `≥ ${lo}°C`
  return `≤ ${hi}°C`
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function ColdChain() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
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
      const data = await listReadings({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load cold-chain readings.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeColdChain(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, assetFilter, search])

  // ── Chart ────────────────────────────────────────────────────────────────
  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donutData = {
    labels: ['OK', 'Warning', 'Breach'],
    datasets: [{
      data: [summary.ok, summary.warning, summary.breach],
      backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'],
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Readings logged', value: summary.total, icon: ThermometerSnowflake, tone: 'text-[var(--text-primary)]' },
    { label: 'Breaches', value: summary.breaches, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Warnings', value: summary.warnings, icon: AlertTriangle, tone: 'text-amber-400' },
    { label: 'Assets monitored', value: summary.assetsMonitored, icon: Boxes, tone: 'text-sky-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'site', 'temperature_c', 'range', 'status', 'recorded_at', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Site', 'Temp (°C)', 'Safe range', 'Status', 'Recorded at', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', site: r.site || '',
    temperature_c: r.temperature_c ?? '', range: rangeText(r),
    status: COLD_CHAIN_STATUS_META[r.status]?.label || r.status || '',
    recorded_at: r.recorded_at ? new Date(r.recorded_at).toLocaleString() : '',
    notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', site: r.site || '',
      temperature_c: r.temperature_c ?? '', min_threshold_c: r.min_threshold_c ?? '',
      max_threshold_c: r.max_threshold_c ?? '', recorded_at: toLocalInput(r.recorded_at),
      notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Live preview of how this reading will classify.
  const previewStatus = useMemo(
    () => classifyTemp(form.temperature_c, form.min_threshold_c, form.max_threshold_c),
    [form.temperature_c, form.min_threshold_c, form.max_threshold_c],
  )

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset (unit) number is required.'); return }
    if (form.temperature_c === '' || form.temperature_c == null) { setFormError('A temperature reading is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
        recorded_at: form.recorded_at ? new Date(form.recorded_at).toISOString() : null,
      }
      if (editing) await updateReading(editing.id, payload)
      else await createReading(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the reading.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteReading(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the reading.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter('all'); setAssetFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || assetFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cold-Chain Monitor"
        subtitle="Log and monitor refrigerated-cargo temperatures against a safe range — breaches and near-limit warnings flagged automatically."
        icon={Snowflake}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'cold_chain_readings')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Cold-Chain Monitor', 'cold_chain_readings', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log reading
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Cold-Chain monitoring isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V143_COLD_CHAIN_LOGS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load cold-chain readings.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Readings by status</h3>
          <div className="h-64">
            {rows && rows.length
              ? <Doughnut data={donutData} options={donutOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No readings logged yet.'}</div>}
          </div>
        </div>
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Compliance snapshot</h3>
          <div className="grid grid-cols-3 gap-3">
            {COLD_CHAIN_STATUSES.map((s) => (
              <div key={s} className={`rounded-lg px-3 py-4 ${STATUS_STYLES[s]}`}>
                <p className="text-xs uppercase tracking-wider opacity-80">{COLD_CHAIN_STATUS_META[s].label}</p>
                <p className="text-2xl font-bold mt-1">{rows === null ? '—' : summary[s]}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-4 flex items-center gap-1.5">
            <ThermometerSnowflake size={12} />
            Compliance rate:{' '}
            <span className="font-semibold text-[var(--text-secondary)]">
              {summary.total ? `${Math.round((summary.ok / summary.total) * 100)}%` : '—'}
            </span>
            {' '}of readings within safe limits · {summary.assetsMonitored} asset{summary.assetsMonitored === 1 ? '' : 's'} monitored.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, site, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="breach">Breach</option>
            <option value="warning">Warning</option>
            <option value="ok">OK</option>
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
                {['Asset', 'Site', 'Temperature', 'Safe range', 'Status', 'Recorded at', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No readings logged yet — log your first reading.' : 'No readings match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className={`px-4 py-2.5 font-semibold ${TEMP_TONE[r.status] || 'text-[var(--text-primary)]'}`}>
                      {r.temperature_c == null ? '—' : `${r.temperature_c}°C`}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{rangeText(r)}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || ''}`}>{COLD_CHAIN_STATUS_META[r.status]?.label || r.status}</span></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.recorded_at)}</td>
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
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit reading' : 'Log temperature reading'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset / unit no.</label>
                  <input className="input w-full" placeholder="e.g. REEFER-01" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Site (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh DC" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Temperature (°C)</label>
                  <input className="input w-full" type="number" step="0.1" placeholder="-18" value={form.temperature_c} onChange={(e) => set('temperature_c', e.target.value)} />
                </div>
                <div>
                  <label className="label">Min safe (°C)</label>
                  <input className="input w-full" type="number" step="0.1" placeholder="-20" value={form.min_threshold_c} onChange={(e) => set('min_threshold_c', e.target.value)} />
                </div>
                <div>
                  <label className="label">Max safe (°C)</label>
                  <input className="input w-full" type="number" step="0.1" placeholder="-15" value={form.max_threshold_c} onChange={(e) => set('max_threshold_c', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Recorded at (optional)</label>
                <input className="input w-full" type="datetime-local" value={form.recorded_at} onChange={(e) => set('recorded_at', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to stamp now.</p>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Door left open during loading…" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {form.temperature_c !== '' && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--text-muted)]">This reading classifies as</span>
                  <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[previewStatus]}`}>{COLD_CHAIN_STATUS_META[previewStatus].label}</span>
                </div>
              )}

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Log reading'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this reading?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Reading'} · {confirmDelete.temperature_c == null ? '—' : `${confirmDelete.temperature_c}°C`} · {fmtDateTime(confirmDelete.recorded_at)}. This can’t be undone.
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
