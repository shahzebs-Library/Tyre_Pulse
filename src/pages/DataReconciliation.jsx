import { useEffect, useState, useCallback, useMemo } from 'react'
import * as api from '../lib/api'
import { toUserMessage } from '../lib/safeError'
import { exportSheetsToExcel, reportFileName } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/EmptyState'
import FilterBar from '../components/ui/FilterBar'
import DateField from '../components/ui/DateField'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { TablePagination, usePagedRows } from '../components/ui/TablePagination'
import { useFilterState } from '../hooks/useFilterState'
import BrandGapSection from '../components/reconciliation/BrandGapSection'
import TyreLearningSection from '../components/reconciliation/TyreLearningSection'
import TyrePriceSection from '../components/reconciliation/TyrePriceSection'
import JobcardDateSection from '../components/reconciliation/JobcardDateSection'
import DupKeyTyresSection from '../components/reconciliation/DupKeyTyresSection'
import SerialMultiAssetSection from '../components/reconciliation/SerialMultiAssetSection'
import FreetextTyreSection from '../components/reconciliation/FreetextTyreSection'
import TyreLifeCapSection from '../components/reconciliation/TyreLifeCapSection'
import DataQualityScorecard from '../components/reconciliation/DataQualityScorecard'
import AssetMasterSection from '../components/reconciliation/AssetMasterSection'
import DataTrustSection from '../components/reconciliation/DataTrustSection'
import {
  normalizeOrphan, normalizeDupe, normalizeMovement,
  filterOrphans, filterDupes, filterMovements, countriesOf, reconSummary,
  pick, num,
} from '../lib/dataReconciliationAnalytics'
import {
  GitCompare, Building2, Copy, ArrowLeftRight, AlertTriangle, CheckCircle2,
  X, Check, RefreshCw, Info, Layers, ShieldCheck, FileSpreadsheet, Disc,
} from 'lucide-react'

// The reconciliation service is delivered by a sibling module. Import
// defensively so this page builds and renders even before it lands: any
// missing function degrades a section to a graceful error state instead of
// crashing the route.
const recon = api.dataReconciliation || {}
const FILTER_DEFAULTS = { q: '', country: '', from: '', to: '' }
const EMPTY_SECTION = { loading: true, error: null, rows: [] }

const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40'

// ─── Toast ──────────────────────────────────────────────────────────────────
function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={`fixed bottom-6 right-6 left-6 sm:left-auto z-[60] flex items-center gap-3 px-4 py-3 rounded-lg border shadow-xl text-sm font-medium sm:max-w-md bg-[var(--surface-1)]
        ${type === 'error' ? 'border-red-700/70 text-red-300' : 'border-green-700/70 text-green-300'}`}
    >
      {type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
      <span className="flex-1 text-[var(--text-primary)]">{message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss notification" className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
        <X size={14} />
      </button>
    </div>
  )
}

// ─── Confirm modal (shared Modal shell: focus trap, Escape, scroll lock) ────
function ConfirmModal({ title, icon: Icon = ShieldCheck, tone = 'primary', body, confirmLabel, busy, onConfirm, onClose }) {
  return (
    <Modal
      open
      size="sm"
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      title={title}
      headerExtra={
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center order-first mr-3 ${tone === 'danger' ? 'bg-red-900/30 text-red-400' : 'bg-blue-900/30 text-blue-400'}`} aria-hidden="true">
          <Icon size={18} />
        </span>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-3 w-full">
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary min-h-[44px] disabled:opacity-40">Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`${tone === 'danger' ? 'btn-danger' : 'btn-primary'} min-h-[44px] flex items-center gap-2 disabled:opacity-40`}
          >
            {busy ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />}
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="text-sm text-[var(--text-secondary)] leading-relaxed space-y-2">{body}</div>
    </Modal>
  )
}

// ─── Section shell ────────────────────────────────────────────────────────────
function Section({ icon: Icon, title, subtitle, badge, headerAction, children }) {
  return (
    <section className="card p-0 overflow-hidden" aria-label={title}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border-dim)]">
        <div className="w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
            {badge != null && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-secondary)] tabular-nums">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
        {headerAction}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

// ─── Error banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ message, onRetry }) {
  return (
    <div role="alert" className="rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-3 flex flex-wrap items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">Could not load this section</p>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5 break-words">{message}</p>
      </div>
      <button type="button" onClick={onRetry} className={`btn-secondary ${BTN}`}>
        <RefreshCw size={13} /> Retry
      </button>
    </div>
  )
}

const fmtCount = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())

export default function DataReconciliation() {
  const [filters, setFilter, resetFilters, hasActiveFilters] = useFilterState(FILTER_DEFAULTS)
  const [orphans, setOrphans] = useState(EMPTY_SECTION)
  const [dupes, setDupes] = useState(EMPTY_SECTION)
  const [conflicts, setConflicts] = useState(EMPTY_SECTION)

  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [toast, setToast] = useState(null)
  const [confirm, setConfirm] = useState(null) // { type, payload }
  const [busy, setBusy] = useState(false)
  const [rowBusy, setRowBusy] = useState({}) // { key: true }
  const [selectedSerial, setSelectedSerial] = useState(null)
  const [exporting, setExporting] = useState(false)

  // Presentation-only category switcher. Every section stays mounted (inactive
  // groups are hidden via CSS) so no child re-fetches when the group changes.
  const [group, setGroup] = useState('overview')
  const GROUPS = [
    ['overview', 'Overview'],
    ['trust', 'Trust'],
    ['completeness', 'Completeness'],
    ['integrity', 'Integrity'],
    ['assets', 'Assets'],
  ]

  const notify = (message, type = 'success') => setToast({ message, type })
  const closeToast = useCallback(() => setToast(null), [])

  // ── Loaders (each isolated so one failure never blanks the others) ──────────
  const makeLoader = useCallback((fnName, setter, normalize) => async () => {
    setter((s) => ({ ...s, loading: true, error: null }))
    if (typeof recon[fnName] !== 'function') {
      setter({ loading: false, error: 'Reconciliation service unavailable.', rows: [] })
      return
    }
    try {
      const rows = await recon[fnName]()
      setter({ loading: false, error: null, rows: Array.isArray(rows) ? rows.map(normalize) : [] })
    } catch (e) {
      setter({ loading: false, error: toUserMessage(e), rows: [] })
    }
  }, [])

  const loadOrphans = useMemo(() => makeLoader('listOrphanAssets', setOrphans, normalizeOrphan), [makeLoader])
  const loadDupes = useMemo(() => makeLoader('listDuplicateTyres', setDupes, normalizeDupe), [makeLoader])
  const loadConflicts = useMemo(() => makeLoader('listSerialConflicts', setConflicts, normalizeMovement), [makeLoader])

  const reloadAll = useCallback(async () => {
    setRefreshing(true)
    await Promise.allSettled([loadOrphans(), loadDupes(), loadConflicts()])
    setUpdatedAt(new Date())
    setRefreshing(false)
  }, [loadOrphans, loadDupes, loadConflicts])

  useEffect(() => { reloadAll() }, [reloadAll])

  // ── Actions (unchanged guarded RPCs) ────────────────────────────────────────
  const markRow = (key, v) => setRowBusy((m) => ({ ...m, [key]: v }))

  async function backfillOne(row) {
    const assetNo = pick(row.raw, ['asset_no', 'assetNo', 'fleet_number'])
    if (!assetNo || typeof recon.backfillAsset !== 'function') return
    markRow(row.key, true)
    try {
      await recon.backfillAsset(assetNo)
      notify(`1 asset added: ${assetNo}`)
      await Promise.allSettled([loadOrphans(), loadConflicts()])
      setUpdatedAt(new Date())
    } catch (e) {
      notify(toUserMessage(e), 'error')
    } finally {
      markRow(row.key, false)
    }
  }

  async function backfillAll() {
    if (typeof recon.backfillAllOrphanAssets !== 'function') return
    setBusy(true)
    try {
      const res = await recon.backfillAllOrphanAssets()
      const n = typeof res === 'number' ? res : (res?.count ?? res?.inserted ?? orphans.rows.length)
      notify(`${n} asset${n === 1 ? '' : 's'} added`)
      setConfirm(null)
      await Promise.allSettled([loadOrphans(), loadConflicts()])
      setUpdatedAt(new Date())
    } catch (e) {
      notify(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function mergeDupe(row) {
    if (typeof recon.mergeDuplicate !== 'function') return
    const keepId = pick(row, ['keep_id', 'keepId', 'newest_id', 'id'])
    let removeIds = pick(row, ['remove_ids', 'removeIds', 'duplicate_ids'], [])
    if (!Array.isArray(removeIds)) removeIds = removeIds ? [removeIds] : []
    setBusy(true)
    try {
      await recon.mergeDuplicate(keepId, removeIds)
      const removed = removeIds.length
      notify(`Merged: ${removed} duplicate cop${removed === 1 ? 'y' : 'ies'} removed`)
      setConfirm(null)
      await loadDupes()
      setUpdatedAt(new Date())
    } catch (e) {
      notify(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── Derived (engine: src/lib/dataReconciliationAnalytics.js) ────────────────
  const summary = useMemo(() => reconSummary({ orphans, dupes, movements: conflicts }), [orphans, dupes, conflicts])
  const countries = useMemo(() => countriesOf(orphans.rows), [orphans.rows])
  const filteredOrphans = useMemo(() => filterOrphans(orphans.rows, filters), [orphans.rows, filters])
  const filteredDupes = useMemo(() => filterDupes(dupes.rows, filters), [dupes.rows, filters])
  const filteredConflicts = useMemo(() => filterMovements(conflicts.rows, filters), [conflicts.rows, filters])
  const filteredTotal = filteredOrphans.length + filteredDupes.length + filteredConflicts.length
  const selected = useMemo(
    () => (selectedSerial ? conflicts.rows.find((r) => r.key === selectedSerial) || null : null),
    [selectedSerial, conflicts.rows],
  )
  // A moved tyre can have been on many vehicles; its placement list pages too.
  const placementPager = usePagedRows(selected?.placements || [])

  const orphanColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.assetNo ?? 'N/A', size: 140, meta: { filterVariant: 'text' },
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.assetNo ?? 'N/A'}</span> },
    { id: 'type', header: 'Type', accessorFn: (r) => r.type ?? 'N/A', size: 150, meta: { filterVariant: 'select' } },
    { id: 'country', header: 'Country', accessorFn: (r) => r.country ?? 'N/A', size: 110, meta: { filterVariant: 'select' } },
    { id: 'tyres', header: 'Tyres', accessorFn: (r) => r.tyres, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCount(row.original.tyres)}</span> },
    {
      id: 'action', header: 'Action', size: 150, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        const working = !!rowBusy[r.key]
        return (
          <button
            type="button"
            onClick={() => backfillOne(r)}
            disabled={working || !r.assetNo || typeof recon.backfillAsset !== 'function'}
            className={`btn-secondary ${BTN}`}
          >
            {working ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
            {working ? 'Adding...' : 'Add to fleet'}
          </button>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rowBusy])

  const dupeColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial ?? 'N/A', size: 170, meta: { filterVariant: 'text' },
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.serial ?? 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.assetNo ?? 'N/A', size: 140 },
    { id: 'copies', header: 'Copies', accessorFn: (r) => r.copies, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCount(row.original.copies)}</span> },
    { id: 'removable', header: 'Removable', accessorFn: (r) => r.removable, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCount(row.original.removable)}</span> },
    {
      id: 'action', header: 'Action', size: 190, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => setConfirm({ type: 'merge', payload: row.original.raw })}
          disabled={typeof recon.mergeDuplicate !== 'function'}
          className={`btn-secondary ${BTN}`}
        >
          <ArrowLeftRight size={13} /> Merge (keep newest)
        </button>
      ),
    },
  ], [])

  const movementColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial ?? 'N/A', size: 170, meta: { filterVariant: 'text' },
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.serial ?? 'N/A'}</span> },
    { id: 'vehicles', header: 'Placements', accessorFn: (r) => r.vehicles, size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCount(row.original.vehicles)}</span> },
    { id: 'assets', header: 'Distinct vehicles', accessorFn: (r) => r.distinctAssets, size: 140, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCount(row.original.distinctAssets)}</span> },
    { id: 'first', header: 'First seen', accessorFn: (r) => r.firstSeen ?? 'N/A', size: 120 },
    { id: 'last', header: 'Last seen', accessorFn: (r) => r.lastSeen ?? 'N/A', size: 120 },
    {
      id: 'detail', header: 'History', size: 130, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        const open = selectedSerial === r.key
        return (
          <button
            type="button"
            onClick={() => setSelectedSerial(open ? null : r.key)}
            disabled={!r.placements.length}
            aria-pressed={open}
            aria-label={`${open ? 'Hide' : 'Show'} movement history for serial ${r.serial ?? 'unknown'}`}
            className={`btn-secondary ${BTN}`}
          >
            {open ? 'Hide' : 'Show'}
          </button>
        )
      },
    },
  ], [selectedSerial])

  async function exportAll() {
    setExporting(true)
    try {
      await exportSheetsToExcel([
        {
          name: 'Orphan assets',
          rows: filteredOrphans.map((r) => ({ asset: r.assetNo ?? 'N/A', type: r.type ?? 'N/A', country: r.country ?? 'N/A', tyres: r.tyres ?? 'N/A' })),
          columns: ['asset', 'type', 'country', 'tyres'],
          headers: ['Asset', 'Type', 'Country', 'Tyres'],
        },
        {
          name: 'Exact duplicates',
          rows: filteredDupes.map((r) => ({ serial: r.serial ?? 'N/A', asset: r.assetNo ?? 'N/A', copies: r.copies, removable: r.removable })),
          columns: ['serial', 'asset', 'copies', 'removable'],
          headers: ['Serial', 'Asset', 'Copies', 'Removable copies'],
        },
        {
          name: 'Tyre movement',
          rows: filteredConflicts.flatMap((r) => (r.placements.length ? r.placements : [{}]).map((p) => ({
            serial: r.serial ?? 'N/A', asset: p.assetNo ?? 'N/A', status: p.status ?? 'N/A', date: p.day ?? 'N/A',
          }))),
          columns: ['serial', 'asset', 'status', 'date'],
          headers: ['Serial', 'Asset', 'Status', 'Date'],
        },
      ], reportFileName('Data Reconciliation'), {
        title: 'Data Reconciliation',
        notes: [
          'Each sheet is the filtered set on screen at export time.',
          'Tyre movement is informational: the same serial on several vehicles over time is normal history.',
        ],
      })
    } catch (e) {
      notify(toUserMessage(e), 'error')
    } finally {
      setExporting(false)
    }
  }

  const orphanEmpty = hasActiveFilters ? 'No orphan assets match these filters' : 'Every asset is registered'
  const dupeEmpty = hasActiveFilters ? 'No exact duplicates match this search' : 'No exact duplicates found'
  const movementEmpty = hasActiveFilters ? 'No movements match these filters' : 'No cross-vehicle movement found'

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <PageHeader
        icon={GitCompare}
        title="Data Reconciliation"
        subtitle="Cross-check fleet, tyre and movement records. Close data gaps non-destructively."
        onRefresh={reloadAll}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <button type="button" onClick={exportAll} disabled={exporting || !summary.complete} className={`btn-secondary ${BTN}`}>
            <FileSpreadsheet size={14} /> {exporting ? 'Exporting...' : 'Export Excel'}
          </button>
        }
      />

      {/* KPI strip: null (N/A) until the section's read has succeeded */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile index={0} icon={Building2} label="Orphan assets" value={orphans.loading ? '...' : fmtCount(summary.orphanAssets)}
          sub={orphans.error ? 'Could not load' : 'Tyres but no fleet record'} tone={summary.orphanAssets > 0 ? 'warn' : 'neutral'} />
        <StatTile index={1} icon={Disc} label="Tyres on orphans" value={orphans.loading ? '...' : fmtCount(summary.orphanTyres)}
          sub={orphans.error ? 'Could not load' : 'Tyre records affected'} tone="neutral" />
        <StatTile index={2} icon={Copy} label="Duplicate groups" value={dupes.loading ? '...' : fmtCount(summary.dupeGroups)}
          sub={dupes.error ? 'Could not load' : 'Byte-identical tyre copies'} tone={summary.dupeGroups > 0 ? 'crit' : 'neutral'} />
        <StatTile index={3} icon={X} label="Removable copies" value={dupes.loading ? '...' : fmtCount(summary.removableCopies)}
          sub={dupes.error ? 'Could not load' : 'Safe to merge away'} tone="neutral" />
        <StatTile index={4} icon={ArrowLeftRight} label="Moved serials" value={conflicts.loading ? '...' : fmtCount(summary.movedSerials)}
          sub={conflicts.error ? 'Could not load' : 'Informational only'} tone="info" />
        <StatTile index={5} icon={Layers} label="Placements" value={conflicts.loading ? '...' : fmtCount(summary.placements)}
          sub={conflicts.error ? 'Could not load' : 'Vehicle fitments recorded'} tone="neutral" />
      </div>

      <FilterBar
        search={filters.q}
        onSearch={(value) => setFilter('q', value)}
        searchLabel="Search reconciliation issues"
        placeholder="Search asset, serial, type or status"
        selects={[{
          key: 'country', value: filters.country, onChange: (value) => setFilter('country', value),
          placeholder: 'All countries', ariaLabel: 'Filter orphan assets by country',
          options: countries.map((value) => ({ value, label: value })),
        }]}
        resultCount={summary.complete ? filteredTotal : undefined}
        onClearAll={hasActiveFilters ? resetFilters : undefined}
      >
        <DateField value={filters.from} onChange={(value) => setFilter('from', value)} placeholder="Movement from" ariaLabel="Filter movements from date" max={filters.to || undefined} />
        <DateField value={filters.to} onChange={(value) => setFilter('to', value)} placeholder="Movement to" ariaLabel="Filter movements to date" min={filters.from || undefined} />
      </FilterBar>

      {/* Category switcher (presentation only) */}
      <div role="tablist" aria-label="Reconciliation categories" className="flex flex-wrap gap-1 p-1 bg-[var(--surface-2)] rounded-lg w-full sm:w-fit">
        {GROUPS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={group === key}
            onClick={() => setGroup(key)}
            className={`min-h-[44px] px-4 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              group === key ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ═══ Overview group ══════════════════════════════════════════════════ */}
      <div className={group === 'overview' ? 'space-y-5' : 'hidden'}>
        <DataQualityScorecard />
        {!summary.complete && !orphans.loading && !dupes.loading && !conflicts.loading && (
          <div role="status" className="flex items-start gap-2 p-3 rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] text-sm text-[var(--text-secondary)]">
            <Info size={16} className="shrink-0 mt-0.5 text-[var(--text-muted)]" />
            <span>One or more checks could not be read, so their figures show N/A rather than zero. Open the Completeness or Integrity tab to retry.</span>
          </div>
        )}
      </div>

      {/* ═══ Trust group ═════════════════════════════════════════════════════ */}
      {/* Data Trust Centre: the confidence layer that attaches a 0-100 score
          and its reasons to every KPI domain. Self-loading and self-degrading. */}
      <div className={group === 'trust' ? 'space-y-5' : 'hidden'}>
        <DataTrustSection />
      </div>

      {/* ═══ Completeness group ══════════════════════════════════════════════ */}
      <div className={group === 'completeness' ? 'space-y-5' : 'hidden'}>
        {/* ── Section A: Orphan assets ─────────────────────────────────────── */}
        <Section
          icon={Building2}
          title="Assets missing from the fleet register"
          subtitle="These asset numbers appear on tyre records but were never entered into the fleet register. Add them to close the gap."
          badge={orphans.loading || orphans.error ? null : `${filteredOrphans.length} of ${orphans.rows.length}`}
          headerAction={
            !orphans.loading && !orphans.error && orphans.rows.length > 0 && typeof recon.backfillAllOrphanAssets === 'function' ? (
              <button type="button" onClick={() => setConfirm({ type: 'backfillAll' })} className={`btn-primary ${BTN}`}>
                <Layers size={14} /> Backfill all ({orphans.rows.length})
              </button>
            ) : null
          }
        >
          {orphans.error ? (
            <ErrorBanner message={orphans.error} onRetry={loadOrphans} />
          ) : !orphans.loading && orphans.rows.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Every asset is registered"
              description="No tyre records reference an asset that is missing from the fleet register."
              compact
            />
          ) : (
            <EnterpriseTable
              enableKeyboard={false}
              columns={orphanColumns}
              data={filteredOrphans}
              getRowId={(r) => r.key}
              loading={orphans.loading}
              emptyMessage={orphanEmpty}
              searchPlaceholder="Search orphan assets"
              exportFileName={reportFileName('Orphan assets')}
              reportMeta={{ title: 'Assets missing from the fleet register' }}
              skeletonRows={5}
            />
          )}
        </Section>

        <BrandGapSection />
        <TyreLearningSection />
        <TyrePriceSection />
      </div>

      {/* ═══ Integrity group ═════════════════════════════════════════════════ */}
      <div className={group === 'integrity' ? 'space-y-5' : 'hidden'}>
        {/* ── Section B: Exact duplicates ──────────────────────────────────── */}
        <Section
          icon={Copy}
          title="Exact duplicates"
          subtitle="Byte-identical tyre rows that can be safely merged. Merging keeps the newest copy and removes only the exact duplicates."
          badge={dupes.loading || dupes.error ? null : `${filteredDupes.length} of ${dupes.rows.length}`}
        >
          {dupes.error ? (
            <ErrorBanner message={dupes.error} onRetry={loadDupes} />
          ) : !dupes.loading && dupes.rows.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No exact duplicates found."
              description="No byte-identical tyre records exist in the current scope."
              compact
            />
          ) : (
            <EnterpriseTable
              enableKeyboard={false}
              columns={dupeColumns}
              data={filteredDupes}
              getRowId={(r) => r.key}
              loading={dupes.loading}
              emptyMessage={dupeEmpty}
              searchPlaceholder="Search duplicates"
              exportFileName={reportFileName('Exact duplicate tyres')}
              reportMeta={{ title: 'Exact duplicate tyre records' }}
              skeletonRows={4}
            />
          )}
        </Section>

        {/* ── Section C: Movement (serial conflicts) ───────────────────────── */}
        <Section
          icon={ArrowLeftRight}
          title="Tyre movement (same serial, different vehicles)"
          subtitle="Normal tyre history, no action needed. These are the same tyre fitted to different vehicles over time, not duplicates."
          badge={conflicts.loading || conflicts.error ? null : `${filteredConflicts.length} of ${conflicts.rows.length}`}
          headerAction={
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-full px-2.5 py-1">
              <Info size={12} /> Informational only
            </span>
          }
        >
          {conflicts.error ? (
            <ErrorBanner message={conflicts.error} onRetry={loadConflicts} />
          ) : !conflicts.loading && conflicts.rows.length === 0 ? (
            <EmptyState
              icon={Info}
              title="No cross-vehicle movement found"
              description="No serial currently appears on more than one vehicle."
              compact
            />
          ) : (
            <div className="space-y-4">
              <EnterpriseTable
                enableKeyboard={false}
                columns={movementColumns}
                data={filteredConflicts}
                getRowId={(r) => r.key}
                loading={conflicts.loading}
                emptyMessage={movementEmpty}
                searchPlaceholder="Search serials"
                exportFileName={reportFileName('Tyre movement')}
                reportMeta={{ title: 'Tyre movement across vehicles' }}
                skeletonRows={4}
              />
              {selected && (
                <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)]" aria-live="polite">
                  <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border-dim)]">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">
                      Serial {selected.serial ?? 'N/A'}: {selected.placements.length} placement{selected.placements.length === 1 ? '' : 's'}
                    </p>
                    <button type="button" onClick={() => setSelectedSerial(null)} aria-label="Close movement history"
                      className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                      <X size={14} />
                    </button>
                  </div>
                  <ul className="divide-y divide-[var(--border-dim)]">
                    {placementPager.pageRows.map((p, i) => (
                      <li key={`${p.assetNo}-${p.day}-${i}`} className="grid grid-cols-3 gap-3 px-4 py-2 text-xs">
                        <span className="text-[var(--text-primary)] font-medium">{p.assetNo ?? 'N/A'}</span>
                        <span className="text-[var(--text-secondary)]">{p.status ?? 'N/A'}</span>
                        <span className="text-[var(--text-muted)] tabular-nums">{p.day ?? 'N/A'}</span>
                      </li>
                    ))}
                  </ul>
                  <TablePagination {...placementPager} />
                </div>
              )}
            </div>
          )}
        </Section>

        <JobcardDateSection />
        <DupKeyTyresSection />
        <SerialMultiAssetSection />
        <FreetextTyreSection />
        <TyreLifeCapSection />
      </div>

      {/* ═══ Assets group ════════════════════════════════════════════════════ */}
      <div className={group === 'assets' ? 'space-y-5' : 'hidden'}>
        <AssetMasterSection />
      </div>

      {/* ── Confirm modals ───────────────────────────────────────────────────── */}
      {confirm?.type === 'backfillAll' && (
        <ConfirmModal
          title={`Backfill ${orphans.rows.length} asset${orphans.rows.length === 1 ? '' : 's'}?`}
          icon={Layers}
          confirmLabel={`Backfill all (${orphans.rows.length})`}
          busy={busy}
          onConfirm={backfillAll}
          onClose={() => !busy && setConfirm(null)}
          body={
            <>
              <p>
                This creates a fleet register entry for every asset number that currently appears on
                tyre records but has no vehicle record.
              </p>
              <p className="text-[var(--text-muted)]">
                Non-destructive: it only adds missing records. Existing data is never changed or removed.
              </p>
            </>
          }
        />
      )}

      {confirm?.type === 'merge' && (
        <ConfirmModal
          title="Merge exact duplicate?"
          icon={ArrowLeftRight}
          tone="danger"
          confirmLabel="Merge (keep newest)"
          busy={busy}
          onConfirm={() => mergeDupe(confirm.payload)}
          onClose={() => !busy && setConfirm(null)}
          body={
            <>
              <p>
                Serial{' '}
                <span className="font-semibold text-[var(--text-primary)]">
                  {pick(confirm.payload, ['serial', 'serial_no', 'tyre_serial'], 'N/A')}
                </span>{' '}
                has {num(confirm.payload, ['copies', 'count', 'copy_count'], 2).toLocaleString()} byte-identical copies.
              </p>
              <p>
                Merging keeps the newest record and deletes only the exact, byte-identical copies. No unique
                or differing data is ever removed.
              </p>
            </>
          }
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={closeToast} />}
    </div>
  )
}
