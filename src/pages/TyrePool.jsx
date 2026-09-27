/**
 * TyrePool (route /tyre-pool) - the tyre pool home. Two complementary views on
 * one canonical module:
 *
 *   1. Pool manager: the hot-spare POOL MANAGER. A curated spare / buffer
 *      inventory with a tracked lifecycle: add a tyre to the pool, deploy an
 *      available spare to an asset, and return it (its condition routes it back
 *      to stock, to maintenance, or retires it). Backed by the org-scoped
 *      `tyre_pool` table (V209) via `src/lib/api/tyrePool.js`.
 *   2. Pool analytics: the unfitted / available tyres derived from
 *      `tyre_records` (spare and stock that can still be allocated).
 *
 * Pool maths live in `src/lib/tyrePool.js`; the page-level wrapping (whole-pool
 * KPIs, honest N/A, filters, exports) in `src/lib/tyrePoolAnalytics.js`.
 * Vehicle to vehicle transfers are owned by TyreExchange.jsx, not here.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  PackageCheck, Boxes, Wallet, Tags, Ruler, Search, X, FileSpreadsheet, FileText,
  AlertTriangle, Plus, ArrowRight, RotateCcw, Lightbulb, MapPin, Warehouse, Gauge,
  Truck, Wrench, CheckCircle2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import NotInUseNotice from '../components/ui/NotInUseNotice'
import { useSettings } from '../contexts/SettingsContext'
import {
  listPoolCandidates, listPoolEntries, addToPool, assignFromPool, returnToPool,
  countActiveVehicles, isMissingRelation,
} from '../lib/api/tyrePool'
import { probeRelation } from '../lib/api/_client'
import { summarizePool } from '../lib/tyrePool'
import {
  managerSummary, filterEntries, reasonMix, filterCandidates, candidateValue,
  entryExportRows, candidateExportRows, reasonLabel, positionOf, poolSerialOf,
  POOL_REASONS, POOL_ENTRY_STATUSES, ENTRY_EXPORT_COLS, ENTRY_EXPORT_HEADERS,
  CANDIDATE_EXPORT_COLS, CANDIDATE_EXPORT_HEADERS,
} from '../lib/tyrePoolAnalytics'
import { formatCurrencyCompact } from '../lib/formatters'
import { categorical, colorAt, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')
const FIELD = 'input w-full min-h-[44px]'
const ENTRY_LIMIT = 1000

const STATUS_META = {
  available: { label: 'Available', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  reserved: { label: 'Reserved', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  deployed: { label: 'Deployed', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  maintenance: { label: 'Maintenance', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  retired: { label: 'Retired', cls: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]' },
}
const EMPTY_ADD = { tyre_serial: '', pool_location: '', reason: 'hot_spare', min_qty: '1', notes: '' }
const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())

function StatusBadge({ status }) {
  const meta = STATUS_META[status]
  if (!meta) return <span className="text-[var(--text-muted)]">N/A</span>
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
}

const DONUT_OPTS = {
  responsive: true, maintainAspectRatio: false, cutout: '58%',
  plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
}
const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false, indexAxis: 'y',
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 }, precision: 0 }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
  },
}

function Banner({ tone, title, children, onRetry, busy }) {
  const crit = tone === 'crit'
  return (
    <div className={`card border ${crit ? 'border-red-800/50' : 'border-amber-800/50'} flex flex-wrap items-start gap-3`} role={crit ? 'alert' : 'status'}>
      <AlertTriangle size={18} className={`${crit ? 'text-red-400' : 'text-amber-400'} mt-0.5 shrink-0`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className={`${crit ? 'text-red-300' : 'text-amber-300'} font-medium`}>{title}</p>
        <div className="text-[var(--text-muted)] text-sm mt-1">{children}</div>
      </div>
      {onRetry && <button type="button" onClick={onRetry} disabled={busy} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RotateCcw size={14} /> Retry</button>}
    </div>
  )
}

export default function TyrePool() {
  const { activeCountry, activeCurrency } = useSettings()
  const [tab, setTab] = useState('manager')

  // Pool manager (V209)
  const [entries, setEntries] = useState(null)
  const [activeVehicles, setActiveVehicles] = useState(null)
  const [mgrError, setMgrError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [reasonFilter, setReasonFilter] = useState('')
  const [entrySearch, setEntrySearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_ADD)
  const [addError, setAddError] = useState('')
  const [saving, setSaving] = useState(false)
  const [action, setAction] = useState(null) // { entry, mode, ...fields }
  const [actionError, setActionError] = useState('')
  const [rowBusy, setRowBusy] = useState(false)
  const [pageError, setPageError] = useState('')

  // Pool analytics (tyre_records)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [brandFilter, setBrandFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  // Loads the WHOLE pool; status is a client-side filter so the KPIs and the
  // replenishment recommendation are never computed on a filtered subset.
  const loadManager = useCallback(async () => {
    setMgrError(''); setNotProvisioned(false)
    try {
      const [list, vehicles] = await Promise.all([
        listPoolEntries({ country: activeCountry, limit: ENTRY_LIMIT }),
        countActiveVehicles({ country: activeCountry }).catch(() => 0),
      ])
      const arr = Array.isArray(list) ? list : []
      setEntries(arr)
      // countActiveVehicles degrades a failure to 0, which is indistinguishable
      // from an empty fleet; treat 0 as unknown rather than recommend against it.
      setActiveVehicles(vehicles > 0 ? vehicles : null)
      // listPoolEntries returns [] for a missing table, so probe before saying so.
      if (arr.length === 0) {
        const { exists, checked } = await probeRelation('tyre_pool')
        setNotProvisioned(checked && !exists)
      }
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setEntries([]) }
      else { setMgrError(toUserMessage(err, 'Could not load the tyre pool.')); setEntries(null) }
    }
  }, [activeCountry])

  const loadAnalytics = useCallback(async () => {
    setError('')
    try {
      const data = await listPoolCandidates({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(toUserMessage(err, 'Could not load tyre records.'))
      setRows(null)
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

  const money = !!activeCountry && activeCountry !== 'All'
  const mgrLoaded = Array.isArray(entries)
  const allEntries = useMemo(() => entries || [], [entries])
  const mgr = useMemo(() => managerSummary(allEntries, activeVehicles), [allEntries, activeVehicles])
  const filteredEntries = useMemo(() => filterEntries(allEntries, {
    status: statusFilter, location: locationFilter, reason: reasonFilter, search: entrySearch,
  }), [allEntries, statusFilter, locationFilter, reasonFilter, entrySearch])
  const reasons = useMemo(() => reasonMix(allEntries), [allEntries])
  const locationOptions = useMemo(() => [...new Set(allEntries.map((e) => e.pool_location || 'Unassigned'))].sort(), [allEntries])

  const loaded = Array.isArray(rows)
  const summary = useMemo(() => summarizePool(rows || []), [rows])
  const { pool, byBrand, bySize } = summary
  const filtered = useMemo(() => filterCandidates(pool, { brand: brandFilter, size: sizeFilter, site: siteFilter, search }),
    [pool, brandFilter, sizeFilter, siteFilter, search])
  const poolValue = useMemo(() => candidateValue(pool, { money }), [pool, money])
  const filteredValue = useMemo(() => candidateValue(filtered, { money }), [filtered, money])
  const brandOptions = useMemo(() => [...new Set(pool.map((r) => r.brand).filter(Boolean))].sort(), [pool])
  const sizeOptions = useMemo(() => [...new Set(pool.map((r) => r.size).filter(Boolean))].sort(), [pool])
  const siteOptions = useMemo(() => [...new Set(pool.map((r) => r.site).filter(Boolean))].sort(), [pool])

  // ── Exports ──────────────────────────────────────────────────────────────
  const exportFile = async (label) => {
    const { reportFileName, reportDateLabel } = await loadExportUtils()
    return reportFileName(`TyrePulse ${label}`, activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  }
  const runExport = async (kind, format) => {
    try {
      const u = await loadExportUtils()
      const isEntries = kind === 'entries'
      const data = isEntries ? entryExportRows(filteredEntries) : candidateExportRows(filtered, { money })
      const cols = isEntries ? ENTRY_EXPORT_COLS : CANDIDATE_EXPORT_COLS
      const headers = isEntries ? ENTRY_EXPORT_HEADERS : CANDIDATE_EXPORT_HEADERS.map((h) => (h === 'Cost' && money ? `Cost (${activeCurrency})` : h))
      const label = isEntries ? 'Tyre Pool Manager' : 'Tyre Pool'
      const name = await exportFile(label)
      if (format === 'pdf') await u.exportToPdf(data, cols.map((c, i) => ({ key: c, header: headers[i] })), label, name, 'landscape')
      else await u.exportToExcel(data, cols, headers, name)
    } catch (e) { setPageError(toUserMessage(e, 'Export failed. Please try again.')) }
  }

  // ── Manager actions (service semantics unchanged) ───────────────────────
  const setAdd = (k, v) => setAddForm((f) => ({ ...f, [k]: v }))
  const submitAdd = useCallback(async (e) => {
    e?.preventDefault?.()
    setAddError('')
    if (!addForm.tyre_serial.trim()) { setAddError('A tyre serial is required.'); return }
    if (addForm.min_qty !== '' && (!Number.isFinite(Number(addForm.min_qty)) || Number(addForm.min_qty) < 0)) {
      setAddError('Minimum quantity must be zero or more.'); return
    }
    setSaving(true)
    try {
      await addToPool({ ...addForm, country: activeCountry && activeCountry !== 'All' ? activeCountry : null })
      setShowAdd(false); setAddForm(EMPTY_ADD)
      await loadManager()
    } catch (err) {
      setAddError(toUserMessage(err, 'Could not add the tyre to the pool.'))
    } finally {
      setSaving(false)
    }
  }, [addForm, activeCountry, loadManager])

  const openAction = useCallback((entry, mode) => {
    setActionError('')
    setAction(mode === 'assign'
      ? { entry, mode, assigned_to: '', position: '', notes: '' }
      : { entry, mode, condition: 'good', notes: '' })
  }, [])
  const setActionField = (k, v) => setAction((a) => ({ ...a, [k]: v }))

  const confirmAction = useCallback(async () => {
    if (!action) return
    setActionError('')
    if (action.mode === 'assign' && !String(action.assigned_to || '').trim()) { setActionError('An asset or vehicle is required.'); return }
    setRowBusy(true)
    try {
      if (action.mode === 'assign') await assignFromPool(action.entry.id, { assigned_to: action.assigned_to, position: action.position, notes: action.notes })
      else await returnToPool(action.entry.id, { condition: action.condition || 'good', notes: action.notes })
      setAction(null)
      await loadManager()
    } catch (err) {
      setActionError(toUserMessage(err, action.mode === 'assign' ? 'Could not deploy the spare.' : 'Could not return the spare.'))
    } finally {
      setRowBusy(false)
    }
  }, [action, loadManager])

  // ── Tables ───────────────────────────────────────────────────────────────
  const entryColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (e) => e.tyre_serial || 'N/A', size: 160,
      cell: ({ row }) => <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">{row.original.tyre_serial || 'N/A'}</span> },
    { id: 'status', header: 'Status', accessorFn: (e) => STATUS_META[e.status]?.label || 'N/A', size: 120, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: 'location', header: 'Location', accessorFn: (e) => e.pool_location || 'Unassigned', size: 150 },
    { id: 'reason', header: 'Reason', accessorFn: (e) => reasonLabel(e.reason), size: 160 },
    { id: 'deployed', header: 'Deployed to', accessorFn: (e) => e.assigned_to || 'N/A', size: 120 },
    { id: 'minqty', header: 'Min qty', accessorFn: (e) => e.min_qty ?? null, size: 80, meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.min_qty) },
    { id: 'notes', header: 'Notes', accessorFn: (e) => e.notes || '', size: 200, cell: ({ row }) => <span className="text-xs text-[var(--text-secondary)]">{row.original.notes || ''}</span> },
    { id: 'actions', header: '', size: 130, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const e = row.original
        if (e.status === 'available') return <button type="button" onClick={() => openAction(e, 'assign')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" aria-label={`Deploy spare ${e.tyre_serial}`}><ArrowRight size={13} /> Deploy</button>
        if (e.status === 'deployed') return <button type="button" onClick={() => openAction(e, 'return')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" aria-label={`Return spare ${e.tyre_serial}`}><RotateCcw size={13} /> Return</button>
        return <span className="text-[11px] text-[var(--text-muted)]">No action</span>
      } },
  ], [openAction])

  const locationColumns = useMemo(() => [
    { id: 'location', header: 'Location', accessorFn: (l) => l.location, size: 220 },
    { id: 'count', header: 'Available spares', accessorFn: (l) => l.count, size: 140, meta: { align: 'right' } },
    { id: 'share', header: 'Share of available', accessorFn: (l) => (mgr.available ? l.count / mgr.available : null), size: 140, meta: { align: 'right' },
      cell: ({ row }) => (mgr.available ? `${Math.round((row.original.count / mgr.available) * 100)}%` : 'N/A') },
  ], [mgr.available])

  const candidateColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => poolSerialOf(r) || 'N/A', size: 150,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{poolSerialOf(row.original) || 'N/A'}</span> },
    { id: 'brand', header: 'Brand', accessorFn: (r) => r.brand || 'N/A', size: 120 },
    { id: 'size', header: 'Size', accessorFn: (r) => r.size || 'N/A', size: 120 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 120 },
    { id: 'position', header: 'Position', accessorFn: (r) => positionOf(r) || 'N/A', size: 100 },
    { id: 'tread', header: 'Tread', accessorFn: (r) => (r.tread_depth == null || r.tread_depth === '' ? null : Number(r.tread_depth)), size: 90, meta: { align: 'right' },
      cell: ({ row }) => (row.original.tread_depth == null || row.original.tread_depth === '' ? 'N/A' : `${row.original.tread_depth} mm`) },
    { id: 'status', header: 'Status', accessorFn: (r) => r.status || 'N/A', size: 110 },
    { id: 'cost', header: 'Cost', accessorFn: (r) => (money && r.cost_per_tyre != null && r.cost_per_tyre !== '' ? Number(r.cost_per_tyre) : null), size: 110, meta: { align: 'right' },
      cell: ({ row }) => (!money || row.original.cost_per_tyre == null || row.original.cost_per_tyre === '' ? 'N/A' : formatCurrencyCompact(row.original.cost_per_tyre, activeCurrency)) },
  ], [money, activeCurrency])

  const donut = (groups) => ({
    labels: groups.slice(0, 10).map((g) => g.key),
    datasets: [{ data: groups.slice(0, 10).map((g) => g.count), backgroundColor: categorical(Math.min(groups.length, 10)), borderWidth: 0 }],
  })
  const reasonData = {
    labels: reasons.map((r) => r.label),
    datasets: [{ data: reasons.map((r) => r.count), backgroundColor: withAlpha(colorAt(2), 0.75), borderRadius: 4 }],
  }

  const mgrTiles = [
    { label: 'Total in pool', value: mgrLoaded ? fmtNum(mgr.total) : 'N/A', icon: Boxes },
    { label: 'Available', value: mgrLoaded ? fmtNum(mgr.available) : 'N/A', icon: CheckCircle2, tone: 'accent' },
    { label: 'Deployed', value: mgrLoaded ? fmtNum(mgr.deployed) : 'N/A', icon: Truck, tone: 'info' },
    { label: 'Maintenance', value: mgrLoaded ? fmtNum(mgr.maintenance) : 'N/A', icon: Wrench, tone: 'warn' },
    { label: 'Utilisation', value: mgrLoaded && mgr.utilisationPct != null ? `${mgr.utilisationPct}%` : 'N/A', icon: Gauge, tone: mgr.utilisationPct > 80 ? 'crit' : 'neutral', sub: 'Deployed share of the pool' },
    { label: 'Retired', value: mgrLoaded ? fmtNum(mgr.retired) : 'N/A', icon: X, sub: `${fmtNum(mgr.reserved)} reserved` },
  ]
  const analyticsTiles = [
    { label: 'Pool tyres', value: loaded ? fmtNum(summary.totalTyres) : 'N/A', icon: Boxes },
    { label: 'Pool value', value: loaded ? (poolValue.value == null ? 'N/A' : formatCurrencyCompact(poolValue.value, activeCurrency)) : 'N/A', icon: Wallet, tone: 'accent', sub: !money ? 'Pick a country: mixed currencies' : `${fmtNum(poolValue.unpriced)} without a price` },
    { label: 'Distinct brands', value: loaded ? fmtNum(summary.distinctBrands) : 'N/A', icon: Tags, tone: 'info' },
    { label: 'Distinct sizes', value: loaded ? fmtNum(summary.distinctSizes) : 'N/A', icon: Ruler },
  ]

  const TABS = [
    { id: 'manager', label: 'Pool manager', icon: Warehouse },
    { id: 'location', label: 'By location', icon: MapPin },
    { id: 'analytics', label: 'Pool analytics', icon: PackageCheck },
  ]
  const clearEntryFilters = () => { setStatusFilter(''); setLocationFilter(''); setReasonFilter(''); setEntrySearch('') }
  const hasEntryFilters = !!(statusFilter || locationFilter || reasonFilter || entrySearch)
  const clearFilters = () => { setBrandFilter(''); setSizeFilter(''); setSiteFilter(''); setSearch('') }
  const hasFilters = !!(brandFilter || sizeFilter || siteFilter || search)

  const notProvisionedBanner = notProvisioned && (
    <Banner tone="warn" title="The hot-spare Pool Manager is not enabled on this database yet.">
      Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V209_TYRE_POOL.sql</span>, then reload. The Pool analytics tab works without it.
    </Banner>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Pool"
        subtitle="Manage the hot-spare pool (add, deploy and return spares, track utilisation and replenishment) or analyse the unfitted spare and stock tyres available for allocation."
        icon={PackageCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'analytics' ? (
              <>
                <button type="button" onClick={() => runExport('candidates', 'excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}><FileSpreadsheet size={14} /> Excel</button>
                <button type="button" onClick={() => runExport('candidates', 'pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}><FileText size={14} /> PDF</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => runExport('entries', 'excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filteredEntries.length}><FileSpreadsheet size={14} /> Excel</button>
                <button type="button" onClick={() => runExport('entries', 'pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filteredEntries.length}><FileText size={14} /> PDF</button>
                <button type="button" onClick={() => { setShowAdd(true); setAddError('') }} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned || !mgrLoaded}><Plus size={14} /> Add to pool</button>
              </>
            )}
          </div>
        }
      />
      <NotInUseNotice count={entries?.length} label="tyres in the pool" hint="Tyres appear once one is added to the spare pool." />

      {pageError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{pageError}</p>
          <button type="button" onClick={() => setPageError('')} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto" role="tablist" aria-label="Tyre pool views">
        {TABS.map((t) => {
          const Icon = t.icon
          const on = tab === t.id
          return (
            <button type="button" role="tab" aria-selected={on} key={t.id} onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${on ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={15} aria-hidden="true" /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'manager' && (
        <div className="space-y-5" role="tabpanel">
          {notProvisionedBanner}
          {mgrError && <Banner tone="crit" title="Could not load the tyre pool." onRetry={loadManager} busy={refreshing}>{mgrError}</Banner>}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {mgrTiles.map((t, i) => <StatTile key={t.label} index={i} label={t.label} value={t.value} icon={t.icon} tone={t.tone} sub={t.sub} />)}
          </div>
          {mgrLoaded && allEntries.length >= ENTRY_LIMIT && (
            <p className="text-xs text-[var(--text-muted)] -mt-2">Only the most recent {ENTRY_LIMIT} pool entries are loaded; older entries are not included in these figures.</p>
          )}

          {mgrLoaded && !notProvisioned && (
            mgr.replen == null ? (
              <div className="card flex items-start gap-3" role="status">
                <Lightbulb size={18} className="text-[var(--text-muted)] mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-sm text-[var(--text-secondary)]">Replenishment cannot be recommended: the active fleet size could not be counted for this scope. {fmtNum(mgr.available)} spares are available now.</p>
              </div>
            ) : mgr.replen.gap > 0 ? (
              <div className="card flex flex-wrap items-start gap-3" role="status" style={{ borderLeft: `4px solid ${mgr.replen.status === 'critical' ? '#ef4444' : '#f59e0b'}` }}>
                <Lightbulb size={18} className={`mt-0.5 shrink-0 ${mgr.replen.status === 'critical' ? 'text-red-400' : 'text-amber-400'}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Pool replenishment recommended ({mgr.replen.status})</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{mgr.replen.advice}</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">{fmtNum(mgr.activeVehicles)} active vehicles | {mgr.replen.current} available | recommended {mgr.replen.recommended}</p>
                </div>
              </div>
            ) : mgr.total > 0 && (
              <div className="card flex items-center gap-3" role="status" style={{ borderLeft: '4px solid #10b981' }}>
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0" aria-hidden="true" />
                <p className="text-sm text-[var(--text-secondary)]">{mgr.replen.advice} <span className="text-[var(--text-muted)]">({mgr.replen.current} available of {mgr.replen.recommended} recommended)</span></p>
              </div>
            )
          )}

          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
              {['', ...POOL_ENTRY_STATUSES].map((s) => {
                const on = statusFilter === s
                const count = s ? mgr[s] : mgr.total
                return (
                  <button type="button" key={s || 'all'} onClick={() => setStatusFilter(s)} aria-pressed={on}
                    className={`text-xs px-3 min-h-[44px] rounded-full font-medium border transition-colors ${on ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-secondary)]'}`}>
                    {s ? STATUS_META[s].label : 'All'} ({mgrLoaded ? fmtNum(count) : 'N/A'})
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label htmlFor="pool-search" className="label">Search</label>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input id="pool-search" className={`${FIELD} pl-9`} placeholder="Serial, location, asset, notes" value={entrySearch} onChange={(e) => setEntrySearch(e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="pool-location" className="label">Location</label>
                <select id="pool-location" className={FIELD} value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                  <option value="">All locations</option>
                  {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="pool-reason" className="label">Reason</label>
                <select id="pool-reason" className={FIELD} value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}>
                  <option value="">All reasons</option>
                  {POOL_REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasEntryFilters && <button type="button" onClick={clearEntryFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear filters</button>}
              <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{fmtNum(filteredEntries.length)} of {fmtNum(allEntries.length)} entries</span>
            </div>
          </div>

          <EnterpriseTable
            columns={entryColumns}
            data={filteredEntries}
            getRowId={(e) => String(e.id)}
            loading={!mgrLoaded && !mgrError}
            error={mgrError && !mgrLoaded ? mgrError : null}
            onRetry={loadManager}
            emptyMessage={notProvisioned ? 'Enable the module to start managing spares.' : allEntries.length === 0 ? 'No pool entries yet. Add a tyre to the hot-spare pool to get started.' : 'No entries match these filters.'}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            viewKey="tyre-pool-entries"
          />
        </div>
      )}

      {tab === 'location' && (
        <div className="space-y-5" role="tabpanel">
          {notProvisionedBanner}
          {mgrError && <Banner tone="crit" title="Could not load the tyre pool." onRetry={loadManager} busy={refreshing}>{mgrError}</Banner>}
          <p className="text-sm text-[var(--text-muted)]">Available spares by holding location: where deployable stock sits now.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Available spares by location</h2>
              <div className="h-64" role="img" aria-label="Available spares per holding location">
                {!mgrLoaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                  : mgr.locations.length ? <Bar data={{ labels: mgr.locations.map((l) => l.location), datasets: [{ data: mgr.locations.map((l) => l.count), backgroundColor: withAlpha(colorAt(0), 0.75), borderRadius: 4 }] }} options={BAR_OPTS} />
                    : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No available spares to locate.</p>}
              </div>
            </div>
            <div className="card">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Why tyres are held</h2>
              <div className="h-64" role="img" aria-label="Pool entries per holding reason">
                {!mgrLoaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                  : reasons.length ? <Bar data={reasonData} options={BAR_OPTS} />
                    : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No pool entries yet.</p>}
              </div>
            </div>
          </div>
          <EnterpriseTable
            columns={locationColumns}
            data={mgr.locations}
            getRowId={(l) => l.location}
            loading={!mgrLoaded && !mgrError}
            emptyMessage="No available spares. Available pool tyres appear here grouped by holding location."
            enableColumnFilters={false}
            enableExport={false}
            searchPlaceholder="Search locations"
          />
        </div>
      )}

      {tab === 'analytics' && (
        <div className="space-y-5" role="tabpanel">
          {error && <Banner tone="crit" title="Could not load tyre records." onRetry={loadAnalytics} busy={refreshing}>{error}</Banner>}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {analyticsTiles.map((t, i) => <StatTile key={t.label} index={i} label={t.label} value={t.value} icon={t.icon} tone={t.tone} sub={t.sub} />)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Pool by brand (top 10)</h2>
              <div className="h-64" role="img" aria-label="Spare tyres per brand">
                {!loaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                  : pool.length ? <Doughnut data={donut(byBrand)} options={DONUT_OPTS} />
                    : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No pool tyres.</p>}
              </div>
            </div>
            <div className="card">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Pool by size (top 10)</h2>
              <div className="h-64" role="img" aria-label="Spare tyres per size">
                {!loaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
                  : pool.length ? <Doughnut data={donut(bySize)} options={DONUT_OPTS} />
                    : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No pool tyres.</p>}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <div>
                <label htmlFor="cand-search" className="label">Search</label>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input id="cand-search" className={`${FIELD} pl-9`} placeholder="Serial, brand, size, site" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="cand-brand" className="label">Brand</label>
                <select id="cand-brand" className={FIELD} value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
                  <option value="">All brands</option>
                  {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="cand-size" className="label">Size</label>
                <select id="cand-size" className={FIELD} value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)}>
                  <option value="">All sizes</option>
                  {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="cand-site" className="label">Site</label>
                <select id="cand-site" className={FIELD} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
                  <option value="">All sites</option>
                  {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear filters</button>}
              <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">
                {fmtNum(filtered.length)} of {fmtNum(summary.totalTyres)} | value {filteredValue.value == null ? 'N/A' : formatCurrencyCompact(filteredValue.value, activeCurrency)}
              </span>
            </div>
          </div>

          <EnterpriseTable
            columns={candidateColumns}
            data={filtered}
            getRowId={(r, i) => String(r.id ?? i)}
            loading={!loaded && !error}
            error={error && !loaded ? error : null}
            onRetry={loadAnalytics}
            emptyMessage={summary.totalTyres === 0 ? 'No unfitted or spare tyres in the pool.' : 'No pool tyres match these filters.'}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            viewKey="tyre-pool-candidates"
          />
        </div>
      )}

      {/* Add to pool */}
      <Modal
        open={showAdd}
        onClose={() => { if (!saving) setShowAdd(false) }}
        title="Add tyre to pool"
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="pool-add-form" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>{saving ? 'Adding...' : 'Add to pool'}</button>
          </div>
        }
      >
        <form id="pool-add-form" onSubmit={submitAdd} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pa-serial" className="label">Tyre serial <span className="text-red-400" aria-hidden="true">*</span></label>
              <input id="pa-serial" className={FIELD} placeholder="e.g. BR-11R225-0091" value={addForm.tyre_serial} maxLength={120} required onChange={(e) => setAdd('tyre_serial', e.target.value)} />
            </div>
            <div>
              <label htmlFor="pa-location" className="label">Pool location</label>
              <input id="pa-location" className={FIELD} placeholder="e.g. Dubai Workshop" value={addForm.pool_location} maxLength={200} onChange={(e) => setAdd('pool_location', e.target.value)} />
            </div>
            <div>
              <label htmlFor="pa-reason" className="label">Reason</label>
              <select id="pa-reason" className={FIELD} value={addForm.reason} onChange={(e) => setAdd('reason', e.target.value)}>
                {POOL_REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pa-min" className="label">Minimum quantity (reorder trigger)</label>
              <input id="pa-min" className={FIELD} type="number" min="0" step="1" inputMode="numeric" value={addForm.min_qty} onChange={(e) => setAdd('min_qty', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="pa-notes" className="label">Notes (optional)</label>
            <input id="pa-notes" className={FIELD} placeholder="e.g. warranty-hold spare for eastern depots" value={addForm.notes} maxLength={8000} onChange={(e) => setAdd('notes', e.target.value)} />
          </div>
          {addError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {addError}
            </div>
          )}
        </form>
      </Modal>

      {/* Deploy / return */}
      <Modal
        open={!!action}
        onClose={() => { if (!rowBusy) setAction(null) }}
        title={action?.mode === 'assign' ? `Deploy spare ${action?.entry?.tyre_serial || ''}` : `Return spare ${action?.entry?.tyre_serial || ''}`}
        subtitle={action?.entry?.pool_location ? `Held at ${action.entry.pool_location}` : undefined}
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={() => setAction(null)} className="btn-secondary text-sm min-h-[44px]" disabled={rowBusy}>Cancel</button>
            <button type="button" onClick={confirmAction} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={rowBusy}>
              {action?.mode === 'assign' ? <ArrowRight size={13} /> : <RotateCcw size={13} />}
              {rowBusy ? (action?.mode === 'assign' ? 'Deploying...' : 'Returning...') : (action?.mode === 'assign' ? 'Confirm deploy' : 'Confirm return')}
            </button>
          </div>
        }
      >
        {action?.mode === 'assign' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pd-asset" className="label">Asset or vehicle <span className="text-red-400" aria-hidden="true">*</span></label>
              <input id="pd-asset" className={FIELD} placeholder="e.g. TM517" value={action.assigned_to} onChange={(e) => setActionField('assigned_to', e.target.value)} />
            </div>
            <div>
              <label htmlFor="pd-pos" className="label">Position (optional)</label>
              <input id="pd-pos" className={FIELD} placeholder="e.g. FL or Drive" value={action.position} onChange={(e) => setActionField('position', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pd-notes" className="label">Notes (optional)</label>
              <input id="pd-notes" className={FIELD} value={action.notes} onChange={(e) => setActionField('notes', e.target.value)} />
            </div>
          </div>
        )}
        {action?.mode === 'return' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pr-cond" className="label">Return condition</label>
              <select id="pr-cond" className={FIELD} value={action.condition} onChange={(e) => setActionField('condition', e.target.value)}>
                <option value="good">Good: back to available</option>
                <option value="worn">Worn: to maintenance</option>
                <option value="damaged">Damaged: retire</option>
              </select>
            </div>
            <div>
              <label htmlFor="pr-notes" className="label">Notes (optional)</label>
              <input id="pr-notes" className={FIELD} placeholder="e.g. returned after breakdown callout" value={action.notes} onChange={(e) => setActionField('notes', e.target.value)} />
            </div>
          </div>
        )}
        {actionError && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2 mt-4" role="alert">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {actionError}
          </div>
        )}
      </Modal>
    </div>
  )
}
