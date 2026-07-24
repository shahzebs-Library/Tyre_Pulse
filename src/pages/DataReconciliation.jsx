import { useEffect, useState, useCallback, Fragment } from 'react'
import * as api from '../lib/api'
import { toUserMessage } from '../lib/safeError'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
import { SkeletonTable } from '../components/ui/Skeleton'
import BrandGapSection from '../components/reconciliation/BrandGapSection'
import JobcardDateSection from '../components/reconciliation/JobcardDateSection'
import DupKeyTyresSection from '../components/reconciliation/DupKeyTyresSection'
import SerialMultiAssetSection from '../components/reconciliation/SerialMultiAssetSection'
import DataQualityScorecard from '../components/reconciliation/DataQualityScorecard'
import {
  GitCompare, Building2, Copy, ArrowLeftRight, AlertTriangle, CheckCircle2,
  X, Check, RefreshCw, ChevronDown, ChevronRight, Info, Layers, ShieldCheck,
} from 'lucide-react'

// The reconciliation service is delivered by a sibling module. Import
// defensively so this page builds and renders even before it lands: any
// missing function degrades a section to a graceful loading/empty state
// instead of crashing the route.
const recon = api.dataReconciliation || {}

// ─── Toast ──────────────────────────────────────────────────────────────────
function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div
      role="status"
      className={`fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-4 py-3 rounded-lg border shadow-xl text-sm font-medium max-w-md
        ${type === 'error'
          ? 'bg-red-900/90 border-red-700 text-red-200'
          : 'bg-green-900/90 border-green-700 text-green-200'}`}
    >
      {type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
      <span className="flex-1">{message}</span>
      <button onClick={onClose} aria-label="Dismiss"><X size={14} /></button>
    </div>
  )
}

// ─── Confirm modal ────────────────────────────────────────────────────────────
function ConfirmModal({ title, icon: Icon = ShieldCheck, tone = 'primary', body, confirmLabel, busy, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={busy ? undefined : onClose}>
      <div
        className="bg-[var(--surface-1)] border border-[var(--card-border)] rounded-xl w-full max-w-lg flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--card-border)]">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tone === 'danger' ? 'bg-red-900/40 text-red-300' : 'bg-blue-900/40 text-blue-300'}`}>
            <Icon size={18} />
          </div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
        </div>
        <div className="px-6 py-5 text-sm text-[var(--text-secondary)] leading-relaxed space-y-2">{body}</div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--card-border)]">
          <button onClick={onClose} disabled={busy} className="btn-secondary disabled:opacity-40">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`${tone === 'danger' ? 'btn-danger' : 'btn-primary'} flex items-center gap-2 disabled:opacity-40`}
          >
            {busy ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />}
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Summary strip tile ──────────────────────────────────────────────────────
function SummaryTile({ icon: Icon, label, value, hint, tone = 'default', loading }) {
  const toneRing = {
    default: 'text-[var(--text-primary)]',
    warn: value > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]',
    danger: value > 0 ? 'text-red-400' : 'text-[var(--text-primary)]',
    info: 'text-blue-400',
  }[tone]
  return (
    <div className="card-stat">
      <div className="w-10 h-10 rounded-xl bg-gray-800/60 border border-gray-700/40 flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-[var(--text-muted)]" />
      </div>
      <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">{label}</p>
      {loading
        ? <div className="h-7 w-14 mt-2 rounded bg-gray-800/60 animate-pulse" />
        : <p className={`text-2xl font-bold mt-1 ${toneRing}`}>{value?.toLocaleString?.() ?? value}</p>}
      {hint && <p className="text-[11px] text-[var(--text-muted)] mt-1">{hint}</p>}
    </div>
  )
}

// ─── Section shell ────────────────────────────────────────────────────────────
function Section({ icon: Icon, title, subtitle, badge, headerAction, children }) {
  return (
    <section className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--card-border)]">
        <div className="w-9 h-9 rounded-lg bg-gray-800/60 border border-gray-700/40 flex items-center justify-center shrink-0">
          <Icon className="w-4.5 h-4.5 text-[var(--text-muted)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">{title}</h2>
            {badge != null && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800/70 border border-gray-700/50 text-[var(--text-secondary)]">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
        {headerAction}
      </div>
      {children}
    </section>
  )
}

// Robust field accessor: services may name fields slightly differently.
const pick = (obj, keys, fallback = undefined) => {
  for (const k of keys) {
    if (obj != null && obj[k] != null && obj[k] !== '') return obj[k]
  }
  return fallback
}
const num = (obj, keys, fallback = 0) => {
  const v = pick(obj, keys)
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// A stable-ish key for a row that may lack an id.
const rowKey = (r, i) => pick(r, ['id', 'asset_no', 'serial'], null) ?? `r${i}`

// ─── Error banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ message, onRetry }) {
  return (
    <div className="mx-5 my-5 rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-red-200">Could not load this section</p>
        <p className="text-xs text-red-300/80 mt-0.5 break-words">{message}</p>
      </div>
      <button onClick={onRetry} className="btn-secondary text-xs flex items-center gap-1.5 shrink-0">
        <RefreshCw size={13} /> Retry
      </button>
    </div>
  )
}

export default function DataReconciliation() {
  const [orphans, setOrphans] = useState({ loading: true, error: null, rows: [] })
  const [dupes, setDupes] = useState({ loading: true, error: null, rows: [] })
  const [conflicts, setConflicts] = useState({ loading: true, error: null, rows: [] })

  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [toast, setToast] = useState(null)
  const [confirm, setConfirm] = useState(null) // { type, payload }
  const [busy, setBusy] = useState(false)
  const [rowBusy, setRowBusy] = useState({}) // { key: true }
  const [expanded, setExpanded] = useState({}) // conflict serial -> bool

  const notify = (message, type = 'success') => setToast({ message, type })

  // ── Loaders (each isolated so one failure never blanks the others) ──────────
  const loadOrphans = useCallback(async () => {
    setOrphans((s) => ({ ...s, loading: true, error: null }))
    if (typeof recon.listOrphanAssets !== 'function') {
      setOrphans({ loading: true, error: null, rows: [] }) // sibling not landed yet
      return
    }
    try {
      const rows = await recon.listOrphanAssets()
      setOrphans({ loading: false, error: null, rows: Array.isArray(rows) ? rows : [] })
    } catch (e) {
      setOrphans({ loading: false, error: toUserMessage(e), rows: [] })
    }
  }, [])

  const loadDupes = useCallback(async () => {
    setDupes((s) => ({ ...s, loading: true, error: null }))
    if (typeof recon.listDuplicateTyres !== 'function') {
      setDupes({ loading: true, error: null, rows: [] })
      return
    }
    try {
      const rows = await recon.listDuplicateTyres()
      setDupes({ loading: false, error: null, rows: Array.isArray(rows) ? rows : [] })
    } catch (e) {
      setDupes({ loading: false, error: toUserMessage(e), rows: [] })
    }
  }, [])

  const loadConflicts = useCallback(async () => {
    setConflicts((s) => ({ ...s, loading: true, error: null }))
    if (typeof recon.listSerialConflicts !== 'function') {
      setConflicts({ loading: true, error: null, rows: [] })
      return
    }
    try {
      const rows = await recon.listSerialConflicts()
      setConflicts({ loading: false, error: null, rows: Array.isArray(rows) ? rows : [] })
    } catch (e) {
      setConflicts({ loading: false, error: toUserMessage(e), rows: [] })
    }
  }, [])

  const reloadAll = useCallback(async () => {
    setRefreshing(true)
    await Promise.allSettled([loadOrphans(), loadDupes(), loadConflicts()])
    setUpdatedAt(new Date())
    setRefreshing(false)
  }, [loadOrphans, loadDupes, loadConflicts])

  useEffect(() => { reloadAll() }, [reloadAll])

  // ── Actions ─────────────────────────────────────────────────────────────────
  const markRow = (key, v) => setRowBusy((m) => ({ ...m, [key]: v }))

  async function backfillOne(row, i) {
    const assetNo = pick(row, ['asset_no', 'assetNo', 'fleet_number'])
    if (!assetNo || typeof recon.backfillAsset !== 'function') return
    const key = rowKey(row, i)
    markRow(key, true)
    try {
      await recon.backfillAsset(assetNo)
      notify(`1 asset added: ${assetNo}`)
      await Promise.allSettled([loadOrphans(), loadConflicts()])
      setUpdatedAt(new Date())
    } catch (e) {
      notify(toUserMessage(e), 'error')
    } finally {
      markRow(key, false)
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

  // ── Derived summary ──────────────────────────────────────────────────────────
  const orphanCount = orphans.rows.length
  const dupeCount = dupes.rows.length
  const movementCount = conflicts.rows.length
  const summaryLoading = orphans.loading || dupes.loading || conflicts.loading

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
      />

      {/* Data-quality scorecard (per country) */}
      <DataQualityScorecard />

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <SummaryTile
          icon={Building2}
          label="Orphan assets"
          value={orphanCount}
          hint="Have tyres but no fleet record"
          tone="warn"
          loading={orphans.loading}
        />
        <SummaryTile
          icon={Copy}
          label="Exact duplicates"
          value={dupeCount}
          hint="Byte-identical tyre copies"
          tone="danger"
          loading={dupes.loading}
        />
        <SummaryTile
          icon={ArrowLeftRight}
          label="Movement records"
          value={movementCount}
          hint="Same serial across vehicles (informational)"
          tone="info"
          loading={conflicts.loading}
        />
      </div>

      {/* ── Section A: Orphan assets ─────────────────────────────────────────── */}
      <Section
        icon={Building2}
        title="Assets missing from the fleet register"
        subtitle="These asset numbers appear on tyre records but were never entered into the fleet register. Add them to close the gap."
        badge={orphans.loading ? null : orphanCount}
        headerAction={
          !orphans.loading && !orphans.error && orphanCount > 0 && typeof recon.backfillAllOrphanAssets === 'function' ? (
            <button
              onClick={() => setConfirm({ type: 'backfillAll' })}
              className="btn-primary text-xs flex items-center gap-1.5"
            >
              <Layers size={14} /> Backfill all ({orphanCount})
            </button>
          ) : null
        }
      >
        {orphans.error ? (
          <ErrorBanner message={orphans.error} onRetry={loadOrphans} />
        ) : orphans.loading ? (
          <SkeletonTable rows={5} cols={5} className="border-0" />
        ) : orphanCount === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Every asset is registered"
            description="No tyre records reference an asset that is missing from the fleet register."
            compact
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--card-border)]">
                  <th className="px-5 py-3 font-medium">Asset</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Country</th>
                  <th className="px-5 py-3 font-medium text-right">Tyres</th>
                  <th className="px-5 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {orphans.rows.map((r, i) => {
                  const key = rowKey(r, i)
                  const assetNo = pick(r, ['asset_no', 'assetNo', 'fleet_number'], 'N/A')
                  const type = pick(r, ['type', 'asset_type', 'vehicle_type', 'category'], 'N/A')
                  const country = pick(r, ['country', 'country_code', 'location'], 'N/A')
                  const tyres = num(r, ['tyres', 'tyre_count', 'count'], 0)
                  return (
                    <tr key={key} className="border-b border-[var(--card-border)]/60 hover:bg-white/[0.02]">
                      <td className="px-5 py-3 font-medium text-[var(--text-primary)]">{assetNo}</td>
                      <td className="px-5 py-3 text-[var(--text-secondary)]">{type}</td>
                      <td className="px-5 py-3 text-[var(--text-secondary)]">{country}</td>
                      <td className="px-5 py-3 text-right text-[var(--text-secondary)] tabular-nums">{tyres.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => backfillOne(r, i)}
                          disabled={!!rowBusy[key] || typeof recon.backfillAsset !== 'function'}
                          className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
                        >
                          {rowBusy[key] ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                          {rowBusy[key] ? 'Adding...' : 'Add to fleet'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Section B: Exact duplicates ──────────────────────────────────────── */}
      <Section
        icon={Copy}
        title="Exact duplicates"
        subtitle="Byte-identical tyre rows that can be safely merged. Merging keeps the newest copy and removes only the exact duplicates."
        badge={dupes.loading ? null : dupeCount}
      >
        {dupes.error ? (
          <ErrorBanner message={dupes.error} onRetry={loadDupes} />
        ) : dupes.loading ? (
          <SkeletonTable rows={4} cols={4} className="border-0" />
        ) : dupeCount === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No exact duplicates found."
            description="No byte-identical tyre records exist in the current scope."
            compact
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--card-border)]">
                  <th className="px-5 py-3 font-medium">Serial</th>
                  <th className="px-5 py-3 font-medium">Asset</th>
                  <th className="px-5 py-3 font-medium text-right">Copies</th>
                  <th className="px-5 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {dupes.rows.map((r, i) => {
                  const key = rowKey(r, i)
                  const serial = pick(r, ['serial', 'serial_no', 'tyre_serial'], 'N/A')
                  const assetNo = pick(r, ['asset_no', 'assetNo', 'fleet_number'], 'N/A')
                  const copies = num(r, ['copies', 'count', 'copy_count'], 2)
                  return (
                    <tr key={key} className="border-b border-[var(--card-border)]/60 hover:bg-white/[0.02]">
                      <td className="px-5 py-3 font-medium text-[var(--text-primary)]">{serial}</td>
                      <td className="px-5 py-3 text-[var(--text-secondary)]">{assetNo}</td>
                      <td className="px-5 py-3 text-right text-[var(--text-secondary)] tabular-nums">{copies.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => setConfirm({ type: 'merge', payload: r })}
                          disabled={typeof recon.mergeDuplicate !== 'function'}
                          className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
                        >
                          <ArrowLeftRight size={13} /> Merge (keep newest)
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Section C: Movement (serial conflicts) ───────────────────────────── */}
      <Section
        icon={ArrowLeftRight}
        title="Tyre movement (same serial, different vehicles)"
        subtitle="Normal tyre history, no action needed. These are the same tyre fitted to different vehicles over time, not duplicates."
        badge={conflicts.loading ? null : movementCount}
        headerAction={
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-blue-300 bg-blue-950/40 border border-blue-800/40 rounded-full px-2.5 py-1">
            <Info size={12} /> Informational only
          </span>
        }
      >
        {conflicts.error ? (
          <ErrorBanner message={conflicts.error} onRetry={loadConflicts} />
        ) : conflicts.loading ? (
          <SkeletonTable rows={4} cols={3} className="border-0" />
        ) : movementCount === 0 ? (
          <EmptyState
            icon={Info}
            title="No cross-vehicle movement found"
            description="No serial currently appears on more than one vehicle."
            compact
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--card-border)]">
                  <th className="px-5 py-3 font-medium w-8" />
                  <th className="px-5 py-3 font-medium">Serial</th>
                  <th className="px-5 py-3 font-medium text-right">Vehicles</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.rows.map((r, i) => {
                  const serial = pick(r, ['serial', 'serial_no', 'tyre_serial'], 'N/A')
                  const key = String(pick(r, ['serial', 'serial_no', 'id'], serial) ?? i)
                  let vehicles = pick(r, ['vehicles', 'movements', 'rows', 'placements'], [])
                  if (!Array.isArray(vehicles)) vehicles = []
                  const count = vehicles.length || num(r, ['count', 'vehicle_count', 'vehicles_count'], 0)
                  const isOpen = !!expanded[key]
                  return (
                    <Fragment key={key}>
                      <tr
                        className="border-b border-[var(--card-border)]/60 hover:bg-white/[0.02] cursor-pointer"
                        onClick={() => setExpanded((m) => ({ ...m, [key]: !m[key] }))}
                      >
                        <td className="px-5 py-3 text-[var(--text-muted)]">
                          {vehicles.length ? (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}
                        </td>
                        <td className="px-5 py-3 font-medium text-[var(--text-primary)]">{serial}</td>
                        <td className="px-5 py-3 text-right text-[var(--text-secondary)] tabular-nums">{count.toLocaleString()}</td>
                      </tr>
                      {isOpen && vehicles.length > 0 && (
                        <tr className="bg-black/20">
                          <td />
                          <td colSpan={2} className="px-5 py-3">
                            <div className="rounded-lg border border-[var(--card-border)] overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)] bg-white/[0.02]">
                                    <th className="px-3 py-2 font-medium">Asset</th>
                                    <th className="px-3 py-2 font-medium">Status</th>
                                    <th className="px-3 py-2 font-medium">Date</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {vehicles.map((v, vi) => (
                                    <tr key={vi} className="border-t border-[var(--card-border)]/60">
                                      <td className="px-3 py-2 text-[var(--text-secondary)]">
                                        {pick(v, ['asset_no', 'assetNo', 'fleet_number', 'vehicle'], 'N/A')}
                                      </td>
                                      <td className="px-3 py-2 text-[var(--text-secondary)]">
                                        {pick(v, ['status', 'state', 'condition'], 'N/A')}
                                      </td>
                                      <td className="px-3 py-2 text-[var(--text-muted)] tabular-nums">
                                        {pick(v, ['date', 'fitted_at', 'created_at', 'recorded_at', 'updated_at'], 'N/A')}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Completeness: tyres missing a brand ──────────────────────────────── */}
      <BrandGapSection />

      {/* ── Integrity: job card date mismatches ──────────────────────────────── */}
      <JobcardDateSection />

      {/* ── Integrity: possible duplicate tyres (same serial+asset+date) ──────── */}
      <DupKeyTyresSection />

      {/* ── Integrity: serial on multiple assets (moved tyre or data error) ────── */}
      <SerialMultiAssetSection />

      {/* ── Confirm modals ───────────────────────────────────────────────────── */}
      {confirm?.type === 'backfillAll' && (
        <ConfirmModal
          title={`Backfill ${orphanCount} asset${orphanCount === 1 ? '' : 's'}?`}
          icon={Layers}
          confirmLabel={`Backfill all (${orphanCount})`}
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

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
