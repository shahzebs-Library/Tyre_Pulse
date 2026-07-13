/**
 * TyrePool (route /tyre-pool) — the tyre pool home. Two complementary views on
 * one canonical module (no duplication):
 *
 *   1. Pool manager  — the hot-spare POOL MANAGER (ported from tyre_saas).
 *      A curated hot-spare / buffer inventory with a tracked lifecycle: add a
 *      tyre to the pool, deploy an available spare to an asset, and return it
 *      (its condition routes it back to stock, to maintenance, or to scrap).
 *      Utilisation %, a fleet-sized replenishment recommendation, and an
 *      available-stock-by-location breakdown turn the pool into a decision tool.
 *      Backed by the org-scoped `tyre_pool` table (V209) via
 *      `src/lib/api/tyrePool.js`; all pool maths live in the pure, unit-tested
 *      `src/lib/tyrePool.js`.
 *
 *   2. Pool analytics — the original read-only view of the unfitted / available
 *      tyres derived from `tyre_records` (spare & stock inventory that can still
 *      be allocated), grouped by brand, size and site with counts and value.
 *
 * NOTE: vehicle→vehicle transfers/swaps are deliberately NOT built here — that
 * is owned by TyreExchange.jsx. This module is the hot-spare pool only.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  PackageCheck, Boxes, Wallet, Tags, Ruler, Search, X,
  FileSpreadsheet, FileText, AlertTriangle, Plus, ArrowRight, RotateCcw,
  Lightbulb, MapPin, Warehouse, Gauge, Truck, Wrench, CheckCircle2, Package,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listPoolCandidates, listPoolEntries, addToPool, assignFromPool,
  returnToPool, countActiveVehicles, isMissingRelation,
} from '../lib/api/tyrePool'
import {
  summarizePool, poolSerialOf, poolStats, byLocation, replenishment,
  POOL_REASONS,
} from '../lib/tyrePool'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(ArcElement, Tooltip, Legend)

// Deterministic categorical palette (shared look with the rest of the app).
const CHART_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
  '#14b8a6', '#ec4899', '#eab308', '#6366f1', '#64748b',
]

const positionOf = (r) => r.position || r.tyre_position || '—'

const STATUS_META = {
  available:   { label: 'Available',   cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  reserved:    { label: 'Reserved',    cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  deployed:    { label: 'Deployed',    cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  maintenance: { label: 'Maintenance', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  retired:     { label: 'Retired',     cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
}

const REASON_LABEL = (r) => String(r || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const EMPTY_ADD = { tyre_serial: '', pool_location: '', reason: 'hot_spare', min_qty: '1', notes: '' }

function StatusBadge({ status }) {
  const meta = STATUS_META[status]
  if (!meta) return <span className="text-[var(--text-muted)]">—</span>
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

export default function TyrePool() {
  const { activeCountry, activeCurrency } = useSettings()
  const [tab, setTab] = useState('manager') // 'manager' | 'location' | 'analytics'

  // ── Pool manager state (V209 table) ────────────────────────────────────────
  const [entries, setEntries] = useState(null)
  const [activeVehicles, setActiveVehicles] = useState(0)
  const [mgrError, setMgrError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_ADD)
  const [addError, setAddError] = useState('')
  const [saving, setSaving] = useState(false)
  // Per-row inline action panel: { [poolId]: { mode:'assign'|'return', ...fields } }
  const [action, setAction] = useState({})
  const [rowBusy, setRowBusy] = useState('')
  const [rowError, setRowError] = useState('')

  // ── Pool analytics state (tyre_records-derived) ────────────────────────────
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [brandFilter, setBrandFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadManager = useCallback(async () => {
    setMgrError(''); setNotProvisioned(false)
    try {
      const [list, vehicles] = await Promise.all([
        listPoolEntries({ country: activeCountry, status: statusFilter || undefined }),
        countActiveVehicles({ country: activeCountry }).catch(() => 0),
      ])
      setEntries(Array.isArray(list) ? list : [])
      setActiveVehicles(vehicles || 0)
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setMgrError(err?.message || 'Could not load the tyre pool.')
      setEntries([])
    }
  }, [activeCountry, statusFilter])

  const loadAnalytics = useCallback(async () => {
    setError('')
    try {
      const data = await listPoolCandidates({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.message || 'Could not load tyre records.')
      setRows([])
    }
  }, [activeCountry])

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([loadManager(), loadAnalytics()])
      setUpdatedAt(new Date())
    } finally {
      setRefreshing(false)
    }
  }, [loadManager, loadAnalytics])

  useEffect(() => { load() }, [load])

  // ── Manager derived ─────────────────────────────────────────────────────────
  const stats = useMemo(() => poolStats(entries || []), [entries])
  const locations = useMemo(() => byLocation(entries || []), [entries])
  // Replenishment uses the FULL available stock (unfiltered) — the status pill
  // filter narrows the list, not the recommendation. When a status filter is
  // active `stats.available` may be 0, so recompute available from unfiltered.
  const availableCount = useMemo(
    () => (entries || []).filter((e) => e.status === 'available').length,
    [entries],
  )
  const replen = useMemo(
    () => replenishment(activeVehicles, availableCount),
    [activeVehicles, availableCount],
  )

  const mgrKpis = [
    { label: 'Total in pool', value: stats.total, icon: Boxes, tone: 'text-[var(--text-primary)]' },
    { label: 'Available', value: stats.available, icon: CheckCircle2, tone: 'text-emerald-400' },
    { label: 'Deployed', value: stats.deployed, icon: Truck, tone: 'text-blue-400' },
    { label: 'Maintenance', value: stats.maintenance, icon: Wrench, tone: 'text-amber-400' },
    {
      label: 'Utilisation',
      value: `${stats.utilisationPct}%`,
      icon: Gauge,
      tone: stats.utilisationPct > 80 ? 'text-red-400' : 'text-[var(--text-primary)]',
    },
  ]

  const MGR_EXPORT_COLS = ['tyre_serial', 'pool_location', 'reason', 'status', 'assigned_to', 'min_qty']
  const MGR_EXPORT_HEADERS = ['Serial', 'Location', 'Reason', 'Status', 'Deployed to', 'Min qty']
  const mgrExportRows = (entries || []).map((e) => ({
    tyre_serial: e.tyre_serial || '',
    pool_location: e.pool_location || '',
    reason: REASON_LABEL(e.reason),
    status: STATUS_META[e.status]?.label || e.status || '',
    assigned_to: e.assigned_to || '',
    min_qty: e.min_qty ?? '',
  }))

  // ── Manager actions ─────────────────────────────────────────────────────────
  const setAdd = (k, v) => setAddForm((f) => ({ ...f, [k]: v }))
  const submitAdd = useCallback(async (e) => {
    e?.preventDefault?.()
    setAddError('')
    if (!addForm.tyre_serial.trim()) { setAddError('A tyre serial is required.'); return }
    setSaving(true)
    try {
      await addToPool({ ...addForm, country: activeCountry && activeCountry !== 'All' ? activeCountry : null })
      setShowAdd(false); setAddForm(EMPTY_ADD)
      await loadManager()
    } catch (err) {
      setAddError(err?.message || 'Could not add the tyre to the pool.')
    } finally {
      setSaving(false)
    }
  }, [addForm, activeCountry, loadManager])

  const openAction = (id, mode) =>
    setAction((a) => ({
      ...a,
      [id]: mode === 'assign'
        ? { mode, assigned_to: '', position: '', notes: '' }
        : { mode, condition: 'good', notes: '' },
    }))
  const closeAction = (id) => setAction((a) => { const n = { ...a }; delete n[id]; return n })
  const setActionField = (id, k, v) => setAction((a) => ({ ...a, [id]: { ...a[id], [k]: v } }))

  const doAssign = useCallback(async (id) => {
    const f = action[id] || {}
    setRowError('')
    if (!String(f.assigned_to || '').trim()) { setRowError('An asset / vehicle is required.'); return }
    setRowBusy(id)
    try {
      await assignFromPool(id, { assigned_to: f.assigned_to, position: f.position, notes: f.notes })
      closeAction(id)
      await loadManager()
    } catch (err) {
      setRowError(err?.message || 'Could not deploy the spare.')
    } finally {
      setRowBusy('')
    }
  }, [action, loadManager])

  const doReturn = useCallback(async (id) => {
    const f = action[id] || {}
    setRowError('')
    setRowBusy(id)
    try {
      await returnToPool(id, { condition: f.condition || 'good', notes: f.notes })
      closeAction(id)
      await loadManager()
    } catch (err) {
      setRowError(err?.message || 'Could not return the spare.')
    } finally {
      setRowBusy('')
    }
  }, [action, loadManager])

  // ── Analytics derived (unchanged behaviour) ─────────────────────────────────
  const summary = useMemo(() => summarizePool(rows || []), [rows])
  const { pool, totalTyres, totalValue, distinctBrands, distinctSizes, byBrand, bySize } = summary

  const brandOptions = useMemo(() => [...new Set(pool.map((r) => r.brand).filter(Boolean))].sort(), [pool])
  const sizeOptions = useMemo(() => [...new Set(pool.map((r) => r.size).filter(Boolean))].sort(), [pool])
  const siteOptions = useMemo(() => [...new Set(pool.map((r) => r.site).filter(Boolean))].sort(), [pool])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pool.filter((r) => {
      if (brandFilter && r.brand !== brandFilter) return false
      if (sizeFilter && r.size !== sizeFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (q) {
        const hay = `${poolSerialOf(r) || ''} ${r.asset_no || ''} ${r.brand || ''} ${r.size || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [pool, brandFilter, sizeFilter, siteFilter, search])

  const filteredValue = useMemo(
    () => filtered.reduce((s, r) => s + (parseFloat(r.cost_per_tyre) || 0), 0),
    [filtered],
  )

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donut = (groups) => ({
    labels: groups.slice(0, 10).map((g) => g.key),
    datasets: [{ data: groups.slice(0, 10).map((g) => g.count), backgroundColor: CHART_COLORS, borderWidth: 0 }],
  })
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'right', labels: { color: chartText, boxWidth: 12, font: { size: 11 } } } },
  }

  const EXPORT_COLS = ['serial', 'brand', 'size', 'site', 'position', 'tread_depth', 'status', 'cost']
  const EXPORT_HEADERS = ['Serial', 'Brand', 'Size', 'Site', 'Position', 'Tread (mm)', 'Status', `Cost (${activeCurrency})`]
  const exportRows = filtered.map((r) => ({
    serial: poolSerialOf(r) || '',
    brand: r.brand || '',
    size: r.size || '',
    site: r.site || '',
    position: positionOf(r),
    tread_depth: r.tread_depth ?? '',
    status: r.status || '',
    cost: r.cost_per_tyre ?? '',
  }))

  const kpis = [
    { label: 'Pool tyres', value: totalTyres, icon: Boxes, tone: 'text-[var(--text-primary)]' },
    { label: 'Pool value', value: formatCurrencyCompact(totalValue, activeCurrency), icon: Wallet, tone: 'text-green-400' },
    { label: 'Distinct brands', value: distinctBrands, icon: Tags, tone: 'text-blue-400' },
    { label: 'Distinct sizes', value: distinctSizes, icon: Ruler, tone: 'text-purple-400' },
  ]

  const clearFilters = () => { setBrandFilter(''); setSizeFilter(''); setSiteFilter(''); setSearch('') }
  const hasFilters = brandFilter || sizeFilter || siteFilter || search

  const TABS = [
    { id: 'manager', label: 'Pool manager', icon: Warehouse },
    { id: 'location', label: 'By location', icon: MapPin },
    { id: 'analytics', label: 'Pool analytics', icon: PackageCheck },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Pool"
        subtitle="Manage the hot-spare pool — add, deploy and return spares, track utilisation and replenishment — or analyse the unfitted spare & stock tyres available for allocation."
        icon={PackageCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          tab === 'analytics' ? (
            <div className="flex items-center gap-2">
              <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'tyre_pool')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
                <FileSpreadsheet size={14} /> Excel
              </button>
              <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tyre Pool', 'tyre_pool', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
                <FileText size={14} /> PDF
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => exportToExcel(mgrExportRows, MGR_EXPORT_COLS, MGR_EXPORT_HEADERS, 'tyre_pool_manager')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!mgrExportRows.length}>
                <FileSpreadsheet size={14} /> Excel
              </button>
              <button onClick={() => { setShowAdd((s) => !s); setAddError('') }} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
                <Plus size={14} /> Add to pool
              </button>
            </div>
          )
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--input-border)]">
        {TABS.map((t) => {
          const Icon = t.icon
          const on = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${on ? 'border-blue-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ══════════════════════════ POOL MANAGER ══════════════════════════ */}
      {tab === 'manager' && (
        <div className="space-y-6">
          {notProvisioned && (
            <div className="card border border-amber-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-amber-300 font-medium">The hot-spare Pool Manager isn’t enabled on this database yet.</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">
                  Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V209_TYRE_POOL.sql</span>, then reload. The Pool analytics tab works without it.
                </p>
              </div>
            </div>
          )}

          {mgrError && (
            <div className="card border border-red-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
              <div><p className="text-red-300 font-medium">Couldn’t load the tyre pool.</p><p className="text-[var(--text-muted)] text-sm mt-1">{mgrError}</p></div>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {mgrKpis.map((k) => {
              const Icon = k.icon
              return (
                <div key={k.label} className="card">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                    <Icon size={16} className={k.tone} />
                  </div>
                  <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{entries === null ? '—' : k.value}</p>
                </div>
              )
            })}
          </div>

          {/* Replenishment banner */}
          {entries !== null && replen.gap > 0 && (
            <div className={`card flex items-start gap-3 border-l-4 ${replen.status === 'critical' ? 'border-l-red-500 border-red-800/40' : 'border-l-amber-400 border-amber-800/40'}`}>
              <Lightbulb size={18} className={`mt-0.5 shrink-0 ${replen.status === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Pool replenishment recommended</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{replen.advice}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  {activeVehicles} active vehicle{activeVehicles === 1 ? '' : 's'} · {replen.current} available · recommended {replen.recommended}
                </p>
              </div>
              <span className={`ml-auto shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${replen.status === 'critical' ? 'bg-red-500/15 text-red-300 border-red-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
                {replen.status}
              </span>
            </div>
          )}
          {entries !== null && !notProvisioned && replen.gap === 0 && stats.total > 0 && (
            <div className="card flex items-center gap-3 border-l-4 border-l-emerald-500 border-emerald-800/40">
              <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
              <p className="text-sm text-[var(--text-secondary)]">{replen.advice} <span className="text-[var(--text-muted)]">({replen.current} available of {replen.recommended} recommended)</span></p>
            </div>
          )}

          {/* Add form */}
          {showAdd && !notProvisioned && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Plus size={15} /> Add tyre to pool</h3>
                <button onClick={() => setShowAdd(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
              </div>
              <form onSubmit={submitAdd} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="label">Tyre serial</label>
                    <input className="input w-full" placeholder="e.g. BR-11R225-0091" value={addForm.tyre_serial} maxLength={120} onChange={(e) => setAdd('tyre_serial', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Pool location</label>
                    <input className="input w-full" placeholder="e.g. Dubai Workshop" value={addForm.pool_location} maxLength={200} onChange={(e) => setAdd('pool_location', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Reason</label>
                    <select className="input w-full" value={addForm.reason} onChange={(e) => setAdd('reason', e.target.value)}>
                      {POOL_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL(r)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Min. qty (reorder trigger)</label>
                    <input className="input w-full" type="number" min="0" step="1" value={addForm.min_qty} onChange={(e) => setAdd('min_qty', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="label">Notes (optional)</label>
                  <input className="input w-full" placeholder="e.g. warranty-hold spare for eastern depots" value={addForm.notes} maxLength={8000} onChange={(e) => setAdd('notes', e.target.value)} />
                </div>
                {addError && (
                  <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {addError}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                  <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                    {saving ? 'Adding…' : 'Add to pool'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Status filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {['', 'available', 'deployed', 'maintenance', 'retired'].map((s) => {
              const on = statusFilter === s
              return (
                <button
                  key={s || 'all'}
                  onClick={() => setStatusFilter(s)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${on ? 'bg-blue-500 text-white border-blue-500' : 'bg-transparent text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-secondary)]'}`}
                >
                  {s ? (STATUS_META[s]?.label || s) : 'All'}
                </button>
              )
            })}
            {entries !== null && <span className="text-xs text-[var(--text-muted)] ml-auto">{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>}
          </div>

          {rowError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {rowError}
            </div>
          )}

          {/* Entry cards */}
          {entries === null ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-24 bg-[var(--input-bg)] rounded-xl animate-pulse" />)}
            </div>
          ) : entries.length === 0 ? (
            <div className="card py-16 text-center text-[var(--text-muted)]">
              <Package size={26} className="mx-auto mb-2 opacity-60" />
              <p className="font-semibold text-[var(--text-secondary)]">{notProvisioned ? 'Enable the module to start managing spares.' : (statusFilter ? `No ${STATUS_META[statusFilter]?.label.toLowerCase()} entries.` : 'No pool entries yet.')}</p>
              {!notProvisioned && !statusFilter && <p className="text-sm mt-1">Add a tyre to the hot-spare pool to get started.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((e) => {
                const act = action[e.id]
                const busy = rowBusy === e.id
                return (
                  <div key={e.id} className="card">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-[var(--text-primary)]">{e.tyre_serial}</span>
                          <StatusBadge status={e.status} />
                          {e.pool_location && (
                            <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1">
                              <MapPin size={11} className="opacity-60" />{e.pool_location}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          {REASON_LABEL(e.reason)} · min qty {e.min_qty ?? 1}
                          {e.assigned_to && <span className="text-blue-300"> · deployed → {e.assigned_to}</span>}
                        </p>
                        {e.notes && <p className="text-xs text-[var(--text-secondary)] mt-1">{e.notes}</p>}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {e.status === 'available' && !act && (
                          <button onClick={() => openAction(e.id, 'assign')} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                            <ArrowRight size={13} /> Deploy
                          </button>
                        )}
                        {e.status === 'deployed' && !act && (
                          <button onClick={() => openAction(e.id, 'return')} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                            <RotateCcw size={13} /> Return
                          </button>
                        )}
                        {(e.status === 'maintenance' || e.status === 'retired' || e.status === 'reserved') && !act && (
                          <span className="text-[11px] text-[var(--text-muted)]">No action</span>
                        )}
                      </div>
                    </div>

                    {/* Inline action panel (confirm step) */}
                    {act?.mode === 'assign' && (
                      <div className="mt-3 pt-3 border-t border-[var(--input-border)] grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="label">Asset / vehicle</label>
                          <input className="input w-full" placeholder="e.g. TM517" value={act.assigned_to} onChange={(ev) => setActionField(e.id, 'assigned_to', ev.target.value)} />
                        </div>
                        <div>
                          <label className="label">Position (optional)</label>
                          <input className="input w-full" placeholder="e.g. FL / Drive" value={act.position} onChange={(ev) => setActionField(e.id, 'position', ev.target.value)} />
                        </div>
                        <div className="flex items-end gap-2">
                          <button onClick={() => doAssign(e.id)} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                            <ArrowRight size={13} /> {busy ? 'Deploying…' : 'Confirm deploy'}
                          </button>
                          <button onClick={() => closeAction(e.id)} disabled={busy} className="btn-secondary text-sm">Cancel</button>
                        </div>
                      </div>
                    )}
                    {act?.mode === 'return' && (
                      <div className="mt-3 pt-3 border-t border-[var(--input-border)] grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="label">Return condition</label>
                          <select className="input w-full" value={act.condition} onChange={(ev) => setActionField(e.id, 'condition', ev.target.value)}>
                            <option value="good">Good — back to available</option>
                            <option value="worn">Worn — to maintenance</option>
                            <option value="damaged">Damaged — retire</option>
                          </select>
                        </div>
                        <div>
                          <label className="label">Notes (optional)</label>
                          <input className="input w-full" placeholder="e.g. returned after breakdown callout" value={act.notes} onChange={(ev) => setActionField(e.id, 'notes', ev.target.value)} />
                        </div>
                        <div className="flex items-end gap-2">
                          <button onClick={() => doReturn(e.id)} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                            <RotateCcw size={13} /> {busy ? 'Returning…' : 'Confirm return'}
                          </button>
                          <button onClick={() => closeAction(e.id)} disabled={busy} className="btn-secondary text-sm">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════ BY LOCATION ══════════════════════════ */}
      {tab === 'location' && (
        <div className="space-y-4">
          {notProvisioned ? (
            <div className="card border border-amber-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-amber-300 font-medium">The hot-spare Pool Manager isn’t enabled on this database yet.</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V209_TYRE_POOL.sql</span>, then reload.</p>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--text-muted)]">Available spares by holding location — where deployable stock currently sits.</p>
              {entries === null ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[0, 1, 2].map((i) => <div key={i} className="h-28 bg-[var(--input-bg)] rounded-xl animate-pulse" />)}
                </div>
              ) : locations.length === 0 ? (
                <div className="card py-16 text-center text-[var(--text-muted)]">
                  <Warehouse size={26} className="mx-auto mb-2 opacity-60" />
                  <p className="font-semibold text-[var(--text-secondary)]">No available spares to locate.</p>
                  <p className="text-sm mt-1">Available pool tyres appear here grouped by their holding location.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {locations.map((loc) => (
                    <div key={loc.location} className="card">
                      <div className="flex items-center gap-2">
                        <Warehouse size={16} className="text-blue-400" />
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{loc.location}</p>
                      </div>
                      <p className="text-3xl font-black text-blue-400 mt-2">{loc.count}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">available spare{loc.count === 1 ? '' : 's'}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════ POOL ANALYTICS ══════════════════════════ */}
      {tab === 'analytics' && (
        <div className="space-y-6">
          {error && (
            <div className="card border border-red-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
              <div><p className="text-red-300 font-medium">Couldn’t load tyre records.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Pool by brand</h3>
              <div className="h-64">{pool.length ? <Doughnut data={donut(byBrand)} options={donutOpts} /> : <EmptyChart loading={rows === null} empty="No pool tyres." />}</div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Pool by size</h3>
              <div className="h-64">{pool.length ? <Doughnut data={donut(bySize)} options={donutOpts} /> : <EmptyChart loading={rows === null} empty="No pool tyres." />}</div>
            </div>
          </div>

          {/* Filters */}
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input className="input pl-9 w-full" placeholder="Search serial, brand, size, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} aria-label="Brand">
                <option value="">All brands</option>
                {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <select className="input" value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)} aria-label="Size">
                <option value="">All sizes</option>
                {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
                <option value="">All sites</option>
                {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
              <span className="text-xs text-[var(--text-muted)] ml-auto">
                {filtered.length} of {totalTyres} · {formatCurrencyCompact(filteredValue, activeCurrency)}
              </span>
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    {['Serial', 'Brand / Size', 'Site', 'Position', 'Tread', 'Status', 'Cost'].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows === null ? (
                    [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                      <PackageCheck size={22} className="mx-auto mb-2 opacity-60" />
                      {totalTyres === 0 ? 'No unfitted or spare tyres in the pool.' : 'No pool tyres match these filters.'}
                    </td></tr>
                  ) : (
                    filtered.slice(0, 500).map((r) => (
                      <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                        <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{poolSerialOf(r) || '—'}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.brand || '—'}{r.size ? ` · ${r.size}` : ''}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{positionOf(r)}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.tread_depth == null || r.tread_depth === '' ? '—' : `${r.tread_depth} mm`}</td>
                        <td className="px-4 py-2.5">
                          <span className="badge text-[11px] px-2 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-700/50">
                            {r.status || 'Available'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.cost_per_tyre == null || r.cost_per_tyre === '' ? '—' : formatCurrencyCompact(r.cost_per_tyre, activeCurrency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
          </div>
        </div>
      )}
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
