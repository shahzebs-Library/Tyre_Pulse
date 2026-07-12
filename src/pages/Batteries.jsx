/**
 * Batteries (route /batteries) — Battery Lifecycle. Registers and tracks
 * vehicle/asset batteries: install date, warranty term, state-of-health, live
 * voltage, and a status lifecycle (healthy → weak → replace → retired). Derives
 * warranty expiry and an "expected replacement" window, flags batteries needing
 * attention, and surfaces a status distribution chart, KPI tiles, filters,
 * search, create/edit, delete, and Excel/PDF export.
 *
 * Runs on the new `batteries` table (MIGRATIONS_V146_BATTERIES.sql). When the
 * table is not yet deployed the service degrades to [] and the page prompts to
 * apply the migration. Real data, loading/empty/error states throughout.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  BatteryCharging, Battery, AlertTriangle, Activity, HeartPulse, Plus, Pencil,
  Trash2, Search, X, Filter, FileSpreadsheet, FileText,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listBatteries, createBattery, updateBattery, deleteBattery,
} from '../lib/api/batteries'
import {
  warrantyExpiry, batteryNeedsAttention, summarizeBatteries,
  BATTERY_STATUSES, BATTERY_STATUS_META,
} from '../lib/batteries'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(ArcElement, Tooltip, Legend)

const STATUS_BADGE = {
  healthy: 'bg-green-900/40 text-green-300 border border-green-700/50',
  weak: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  replace: 'bg-red-900/40 text-red-300 border border-red-700/50',
  retired: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const STATUS_COLOR = { healthy: '#22c55e', weak: '#f59e0b', replace: '#ef4444', retired: '#64748b' }

const EMPTY_FORM = {
  serial_no: '', asset_no: '', brand: '', install_date: '', warranty_months: '',
  health_pct: '', voltage: '', status: 'healthy', site: '', notes: '',
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
function healthTone(pct) {
  if (pct == null) return 'text-[var(--text-muted)]'
  if (pct >= 70) return 'text-green-400'
  if (pct >= 50) return 'text-amber-400'
  return 'text-red-400'
}
function healthBar(pct) {
  if (pct == null) return 'bg-slate-600'
  if (pct >= 70) return 'bg-green-500'
  if (pct >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

export default function Batteries() {
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
      const data = await listBatteries({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load batteries.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeBatteries(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const enriched = useMemo(
    () => (rows || []).map((r) => {
      const expiry = warrantyExpiry(r)
      return {
        ...r,
        _expiry: expiry,
        _needsAttention: batteryNeedsAttention(r),
        _health: r.health_pct == null || r.health_pct === '' ? null : Number(r.health_pct),
      }
    }),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.serial_no || ''} ${r.asset_no || ''} ${r.brand || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, statusFilter, assetFilter, search])

  // Chart — status distribution
  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donutData = {
    labels: BATTERY_STATUSES.map((s) => BATTERY_STATUS_META[s].label),
    datasets: [{
      data: BATTERY_STATUSES.map((s) => summary.byStatus[s]),
      backgroundColor: BATTERY_STATUSES.map((s) => STATUS_COLOR[s]),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
  }

  const kpis = [
    { label: 'Total batteries', value: summary.total, icon: BatteryCharging, tone: 'text-[var(--text-primary)]' },
    { label: 'Healthy', value: summary.byStatus.healthy, icon: Battery, tone: 'text-green-400' },
    { label: 'Needs attention', value: summary.needingAttention, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Avg health', value: summary.avgHealth == null ? '—' : `${summary.avgHealth}%`, icon: HeartPulse, tone: 'text-sky-400' },
  ]

  // Export
  const EXPORT_COLS = ['serial_no', 'asset_no', 'brand', 'site', 'status', 'health_pct', 'voltage', 'install_date', 'warranty_months', 'expiry']
  const EXPORT_HEADERS = ['Serial', 'Asset', 'Brand', 'Site', 'Status', 'Health %', 'Voltage', 'Installed', 'Warranty (mo)', 'Warranty expiry']
  const exportRows = filtered.map((r) => ({
    serial_no: r.serial_no || '', asset_no: r.asset_no || '', brand: r.brand || '', site: r.site || '',
    status: BATTERY_STATUS_META[r.status]?.label || r.status || '',
    health_pct: r._health ?? '', voltage: r.voltage ?? '',
    install_date: r.install_date || '', warranty_months: r.warranty_months ?? '',
    expiry: r._expiry ? fmtDate(r._expiry) : '',
  }))

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      serial_no: r.serial_no || '', asset_no: r.asset_no || '', brand: r.brand || '',
      install_date: r.install_date || '', warranty_months: r.warranty_months ?? '',
      health_pct: r.health_pct ?? '', voltage: r.voltage ?? '', status: r.status || 'healthy',
      site: r.site || '', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const closeModal = () => { if (!saving) { setModalOpen(false); setEditing(null) } }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim() && !form.serial_no.trim()) {
      setFormError('Enter an asset number or a serial number.'); return
    }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry && activeCountry !== 'All' ? activeCountry : null }
      const saved = editing ? await updateBattery(editing.id, payload) : await createBattery(payload)
      setRows((prev) => {
        const list = prev || []
        return editing ? list.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...list]
      })
      setModalOpen(false); setEditing(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(err?.message || 'Could not save the battery.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await deleteBattery(confirmDel.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDel.id))
      setConfirmDel(null)
    } catch (err) {
      setError(err?.message || 'Could not delete the battery.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDel])

  const clearFilters = () => { setStatusFilter('all'); setAssetFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || assetFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Battery Lifecycle"
        subtitle="Register, track health, and forecast replacement for every battery across the fleet."
        icon={BatteryCharging}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'batteries')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Battery Lifecycle', 'batteries', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> Register battery
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Battery tracking isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V146_BATTERIES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load batteries.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Chart + attention */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Status distribution</h3>
          <div className="h-64">
            {rows && summary.total ? <Doughnut data={donutData} options={donutOpts} /> : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                {rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No batteries registered yet.'}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <Activity size={15} className="text-amber-400" /> Batteries needing attention
          </h3>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : enriched.filter((r) => r._needsAttention).length === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-sm text-[var(--text-muted)] gap-2">
              <Battery size={24} className="text-green-400" /> All batteries are within healthy limits.
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto divide-y divide-[var(--input-border)]/60">
              {enriched.filter((r) => r._needsAttention).slice(0, 30).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">{r.asset_no || r.serial_no || '—'}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{r.brand || 'Unknown'}{r.site ? ` · ${r.site}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-sm font-semibold ${healthTone(r._health)}`}>{r._health == null ? '—' : `${r._health}%`}</span>
                    <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[r.status]}`}>{BATTERY_STATUS_META[r.status]?.label || r.status}</span>
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
            <input className="input pl-9 w-full" placeholder="Search serial, asset, brand, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {BATTERY_STATUSES.map((s) => <option key={s} value={s}>{BATTERY_STATUS_META[s].label}</option>)}
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
                {['Serial', 'Asset', 'Brand', 'Site', 'Health', 'Voltage', 'Installed', 'Warranty expiry', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {summary.total === 0 && !missing ? (
                    <div className="flex flex-col items-center gap-3">
                      <Battery size={26} className="opacity-60" />
                      <p>No batteries registered yet.</p>
                      <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={14} /> Register your first battery</button>
                    </div>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No batteries match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.serial_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.brand || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5">
                      {r._health == null ? <span className="text-[var(--text-muted)]">—</span> : (
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold ${healthTone(r._health)}`}>{r._health}%</span>
                          <div className="w-16 bg-[var(--input-bg)] rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${healthBar(r._health)}`} style={{ width: `${Math.max(0, Math.min(100, r._health))}%` }} />
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.voltage == null || r.voltage === '' ? '—' : `${r.voltage}V`}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.install_date)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r._expiry ? fmtDate(r._expiry) : '—'}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[r.status]}`}>{BATTERY_STATUS_META[r.status]?.label || r.status}</span></td>
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
                <BatteryCharging size={18} className="text-[var(--brand-bright)]" />
                {editing ? 'Edit battery' : 'Register battery'}
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
                  <label className="label">Serial number</label>
                  <input className="input w-full" placeholder="BAT-2026-00123" value={form.serial_no} onChange={(e) => set('serial_no', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Brand</label>
                  <input className="input w-full" placeholder="Exide, Varta, Bosch…" value={form.brand} onChange={(e) => set('brand', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" placeholder="Riyadh Depot" value={form.site} onChange={(e) => set('site', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Install date</label>
                  <input type="date" className="input w-full" value={form.install_date} onChange={(e) => set('install_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Warranty (months)</label>
                  <input type="number" min="0" className="input w-full" placeholder="24" value={form.warranty_months} onChange={(e) => set('warranty_months', e.target.value)} />
                </div>
                <div>
                  <label className="label">Health %</label>
                  <input type="number" min="0" max="100" step="0.1" className="input w-full" placeholder="95" value={form.health_pct} onChange={(e) => set('health_pct', e.target.value)} />
                </div>
                <div>
                  <label className="label">Voltage (V)</label>
                  <input type="number" step="0.1" className="input w-full" placeholder="12.6" value={form.voltage} onChange={(e) => set('voltage', e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {BATTERY_STATUSES.map((s) => <option key={s} value={s}>{BATTERY_STATUS_META[s].label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Fitment notes, load test results, supplier…" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
              </div>
              {form.install_date && form.warranty_months && (
                <p className="text-xs text-[var(--text-muted)]">
                  Warranty expires <span className="font-semibold text-[var(--text-secondary)]">{fmtDate(warrantyExpiry({ install_date: form.install_date, warranty_months: form.warranty_months }))}</span>.
                </p>
              )}
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Register battery'}
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
            <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2"><Trash2 size={18} className="text-red-400" /> Delete battery?</h2>
            <p className="text-sm text-[var(--text-muted)] mt-2">
              This permanently removes battery <span className="font-semibold text-[var(--text-secondary)]">{confirmDel.asset_no || confirmDel.serial_no || confirmDel.id}</span>. This cannot be undone.
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
