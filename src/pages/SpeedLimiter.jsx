/**
 * SpeedLimiter (route /speed-limiter) — Speed Limiter Registry. Registers and
 * tracks the speed limiter fitted to each asset: the governed limit (km/h), the
 * limiter/telematics device, the last verification date, and a status lifecycle
 * (active → disabled → fault). Surfaces KPI tiles, a status distribution chart,
 * filters, search, create/edit, delete, and Excel/PDF export.
 *
 * Runs on the new `speed_limiters` table (MIGRATIONS_V153_SPEED_LIMITERS.sql).
 * When the table is not yet deployed the service degrades to [] and the page
 * prompts to apply the migration. Real data, loading/empty/error states
 * throughout.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  Gauge, Zap, AlertTriangle, Settings, Plus, Pencil, Trash2, Search, X, Filter,
  FileSpreadsheet, FileText,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listSpeedLimiters, createSpeedLimiter, updateSpeedLimiter, deleteSpeedLimiter,
} from '../lib/api/speedLimiters'
import {
  summarizeSpeedLimiters, SPEED_LIMITER_STATUSES, SPEED_LIMITER_STATUS_META,
} from '../lib/speedLimiters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(ArcElement, Tooltip, Legend)

const STATUS_BADGE = {
  active: 'bg-green-900/40 text-green-300 border border-green-700/50',
  disabled: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
  fault: 'bg-red-900/40 text-red-300 border border-red-700/50',
}
const STATUS_COLOR = { active: '#22c55e', disabled: '#64748b', fault: '#ef4444' }

const EMPTY_FORM = {
  asset_no: '', limit_kph: '', device_id: '', last_verified_at: '',
  status: 'active', site: '', notes: '',
}

function fmtDate(v) {
  if (!v) return '—'
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10)
}
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}

export default function SpeedLimiter() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listSpeedLimiters({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load speed limiters.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeSpeedLimiters(rows || []), [rows])

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
        const hay = `${r.asset_no || ''} ${r.device_id || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, assetFilter, search])

  // Chart — status distribution
  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donutData = {
    labels: SPEED_LIMITER_STATUSES.map((s) => SPEED_LIMITER_STATUS_META[s].label),
    datasets: [{
      data: SPEED_LIMITER_STATUSES.map((s) => summary.byStatus[s]),
      backgroundColor: SPEED_LIMITER_STATUSES.map((s) => STATUS_COLOR[s]),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
  }

  const kpis = [
    { label: 'Total limiters', value: summary.total, icon: Gauge, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.byStatus.active, icon: Zap, tone: 'text-green-400' },
    { label: 'Faults', value: summary.faults, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Avg limit (km/h)', value: summary.avgLimit == null ? '—' : summary.avgLimit, icon: Settings, tone: 'text-sky-400' },
  ]

  // Export
  const EXPORT_COLS = ['asset_no', 'limit_kph', 'device_id', 'status', 'site', 'last_verified_at']
  const EXPORT_HEADERS = ['Asset', 'Limit (km/h)', 'Device', 'Status', 'Site', 'Last verified']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', limit_kph: r.limit_kph ?? '', device_id: r.device_id || '',
    status: SPEED_LIMITER_STATUS_META[r.status]?.label || r.status || '',
    site: r.site || '', last_verified_at: r.last_verified_at || '',
  }))

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', limit_kph: r.limit_kph ?? '', device_id: r.device_id || '',
      last_verified_at: r.last_verified_at || '', status: r.status || 'active',
      site: r.site || '', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const closeModal = () => { if (!saving) { setModalOpen(false); setEditing(null) } }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('Enter an asset number.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry && activeCountry !== 'All' ? activeCountry : null }
      const saved = editing ? await updateSpeedLimiter(editing.id, payload) : await createSpeedLimiter(payload)
      setRows((prev) => {
        const list = prev || []
        return editing ? list.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...list]
      })
      setModalOpen(false); setEditing(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(err?.message || 'Could not save the speed limiter.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await deleteSpeedLimiter(confirmDel.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDel.id))
      setConfirmDel(null)
    } catch (err) {
      setError(err?.message || 'Could not delete the speed limiter.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDel])

  const clearFilters = () => { setStatusFilter('all'); setAssetFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || assetFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Speed Limiter Registry"
        subtitle="Register and audit the governed speed limiter fitted to every asset — limit, device, status, and last verification."
        icon={Gauge}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'speed_limiters')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Speed Limiter Registry', 'speed_limiters', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> Register limiter
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Speed limiters aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V153_SPEED_LIMITERS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load speed limiters.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Chart + fault list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Status distribution</h3>
          <div className="h-64">
            {rows && summary.total ? <Doughnut data={donutData} options={donutOpts} /> : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                {rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No speed limiters registered yet.'}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <AlertTriangle size={15} className="text-red-400" /> Limiters in fault
          </h3>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : (rows || []).filter((r) => r.status === 'fault').length === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-sm text-[var(--text-muted)] gap-2">
              <Zap size={24} className="text-green-400" /> No limiters currently in fault.
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto divide-y divide-[var(--input-border)]/60">
              {(rows || []).filter((r) => r.status === 'fault').slice(0, 30).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">{r.asset_no || '—'}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{r.device_id || 'No device'}{r.site ? ` · ${r.site}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-sky-400">{r.limit_kph == null || r.limit_kph === '' ? '—' : `${r.limit_kph} km/h`}</span>
                    <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE.fault}`}>{SPEED_LIMITER_STATUS_META.fault.label}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, device, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {SPEED_LIMITER_STATUSES.map((s) => <option key={s} value={s}>{SPEED_LIMITER_STATUS_META[s].label}</option>)}
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
                {['Asset', 'Limit (km/h)', 'Device', 'Site', 'Last verified', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {summary.total === 0 && !missing ? (
                    <div className="flex flex-col items-center gap-3">
                      <Gauge size={26} className="opacity-60" />
                      <p>No speed limiters registered yet.</p>
                      <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={14} /> Register your first limiter</button>
                    </div>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No speed limiters match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.limit_kph == null || r.limit_kph === '' ? '—' : `${r.limit_kph}`}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.device_id || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.last_verified_at)}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[r.status]}`}>{SPEED_LIMITER_STATUS_META[r.status]?.label || r.status}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDel(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-900/20" aria-label="Delete"><Trash2 size={14} /></button>
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

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onMouseDown={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Gauge size={18} className="text-[var(--brand-bright)]" />
                {editing ? 'Edit speed limiter' : 'Register speed limiter'}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="TRK-014" value={form.asset_no} onChange={(e) => set('asset_no', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Limit (km/h)</label>
                  <input type="number" min="0" step="1" className="input w-full" placeholder="80" value={form.limit_kph} onChange={(e) => set('limit_kph', e.target.value)} />
                </div>
                <div>
                  <label className="label">Device ID</label>
                  <input className="input w-full" placeholder="SL-2026-00123" value={form.device_id} onChange={(e) => set('device_id', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" placeholder="Riyadh Depot" value={form.site} onChange={(e) => set('site', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Last verified</label>
                  <input type="date" className="input w-full" value={form.last_verified_at} onChange={(e) => set('last_verified_at', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {SPEED_LIMITER_STATUSES.map((s) => <option key={s} value={s}>{SPEED_LIMITER_STATUS_META[s].label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Calibration notes, installer, certificate reference…" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Register limiter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onMouseDown={() => !deleting && setConfirmDel(null)}>
          <div className="card w-full max-w-md" onMouseDown={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2"><Trash2 size={18} className="text-red-400" /> Delete speed limiter?</h2>
            <p className="text-sm text-[var(--text-muted)] mt-2">
              This permanently removes the limiter for asset <span className="font-semibold text-[var(--text-secondary)]">{confirmDel.asset_no || confirmDel.id}</span>. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDel(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
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
