/**
 * ConsoleSelfHealing - super-admin Self-Healing console (Admin Control Module 2).
 *
 * A pure console page (navy + orange theme, useConsoleAuth gate). It SCANS the
 * platform read-only and FLAGS data-integrity issues, then offers only the SAFE,
 * already-guarded fixes that live in the reconciliation layer:
 *   - Orphan assets      -> backfill the missing asset row (safe insert)
 *   - Duplicate tyres    -> merge byte-identical rows (server refuses non-identical)
 *   - Serial conflicts   -> READ-ONLY (a serial on two assets is a legitimate tyre
 *                           MOVEMENT between vehicles, never auto-touched)
 *   - Stale sites        -> READ-ONLY (a site gone quiet needs a human/data action)
 *   - Predictive anomaly -> READ-ONLY (surfaced for review only)
 *
 * Every fix asks for confirmation first, and nothing destructive is ever invented
 * here. Findings are also logged to the System Health board.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Wand2, RefreshCw, ShieldAlert, ShieldCheck, CheckCircle2, AlertTriangle,
  Info, Link2Off, Copy, Shuffle, Clock, Activity,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  runScans, scanAnomalies, applyBackfillOrphan, applyBackfillAllOrphans,
  applyMergeDuplicate, logHealFinding,
} from '../../lib/api/selfHealing'
import { detectStaleGroups, summarizeFindings } from '../../lib/selfHealing'

// ── Presentation helpers ──────────────────────────────────────────────────────

function InfoDot({ text }) {
  return (
    <span className="inline-flex align-middle ml-1 text-gray-600 hover:text-gray-300 cursor-help" title={text}>
      <Info size={11} />
    </span>
  )
}

const SEV_TEXT = { warning: 'text-amber-400', info: 'text-blue-300', critical: 'text-red-400' }
const SEV_RING = {
  warning: 'border-amber-500/30 bg-amber-500/5',
  info: 'border-blue-500/30 bg-blue-500/5',
  critical: 'border-red-500/30 bg-red-500/5',
}
const SEV_BADGE = {
  warning: 'text-amber-300 bg-amber-900/30 border-amber-700/40',
  info: 'text-blue-300 bg-blue-900/30 border-blue-700/40',
  critical: 'text-red-300 bg-red-900/40 border-red-700/40',
}

const CARD_META = {
  orphans: {
    Icon: Link2Off,
    tip: 'A tyre points at an asset that is missing from the fleet list. Backfill safely creates the missing asset record so reports stop losing these tyres.',
  },
  duplicates: {
    Icon: Copy,
    tip: 'The exact same tyre record was saved more than once (every field identical). Merge keeps one copy and removes the rest. The server refuses to merge unless the rows are truly identical.',
  },
  serialConflicts: {
    Icon: Shuffle,
    tip: 'The same tyre serial appears on more than one asset. This is normally a legitimate tyre MOVEMENT between vehicles, not an error, so it is shown for review only and never changed automatically.',
  },
  stale: {
    Icon: Clock,
    tip: 'A site has recorded no new activity for a week or more. It may just be quiet, or data entry may have stopped. Flagged for a human to check.',
  },
  anomalies: {
    Icon: Activity,
    tip: 'Unusual tyre patterns spotted by the local rules engine (short replacement intervals, cost spikes, same-day bursts). Shown for review only, never auto-resolved.',
  },
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsoleSelfHealing() {
  const { admin } = useConsoleAuth()

  const [scan, setScan]       = useState(null)   // { orphans, duplicates, serialConflicts, stale, anomalies }
  const [summary, setSummary] = useState(null)
  const [scannedAt, setScannedAt] = useState(null)
  const [scanning, setScanning]   = useState(false)
  const [error, setError]         = useState(null)
  const [busyKey, setBusyKey]     = useState(null) // which fix is running
  const [notice, setNotice]       = useState(null)

  const mountedRef = useRef(true)

  const runScan = useCallback(async () => {
    setScanning(true)
    setError(null)
    setNotice(null)
    try {
      const [base, anomalies] = await Promise.all([runScans(), scanAnomalies()])
      const stale = detectStaleGroups(base.staleRows, { now: Date.now() })
      const buckets = {
        orphans: base.orphans,
        duplicates: base.duplicates,
        serialConflicts: base.serialConflicts,
        stale,
        anomalies,
      }
      const sum = summarizeFindings(buckets)
      if (!mountedRef.current) return
      setScan(buckets)
      setSummary(sum)
      setScannedAt(new Date().toISOString())
      logHealFinding(sum) // fire-and-forget: surface findings on System Health
    } catch (err) {
      if (mountedRef.current) setError(err?.message || 'The scan could not complete. Please try again.')
    } finally {
      if (mountedRef.current) setScanning(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    runScan()
    return () => { mountedRef.current = false }
  }, [runScan])

  // ── Safe fix handlers (each confirms first, then re-scans) ──
  async function withFix(key, confirmMsg, fn, okMsg) {
    if (busyKey) return
    // eslint-disable-next-line no-alert
    if (!window.confirm(confirmMsg)) return
    setBusyKey(key)
    setError(null)
    setNotice(null)
    try {
      const result = await fn()
      if (mountedRef.current) setNotice(typeof okMsg === 'function' ? okMsg(result) : okMsg)
      await runScan()
    } catch (err) {
      if (mountedRef.current) setError(err?.message || 'That fix could not be applied.')
    } finally {
      if (mountedRef.current) setBusyKey(null)
    }
  }

  const backfillOne = (assetNo) => withFix(
    `orphan:${assetNo}`,
    `Create the missing fleet record for asset "${assetNo}"? This is a safe insert and removes nothing.`,
    () => applyBackfillOrphan(assetNo),
    `Asset "${assetNo}" was added to the fleet list.`,
  )

  const backfillAll = () => withFix(
    'orphan:all',
    'Create fleet records for every orphaned asset? This is a safe insert and removes nothing.',
    () => applyBackfillAllOrphans(),
    (n) => `${n || 0} asset${n === 1 ? '' : 's'} added to the fleet list.`,
  )

  const mergeOne = (row) => withFix(
    `dup:${row.keep_id}`,
    `Merge ${((row.remove_ids || []).length) + 1} identical copies of tyre "${row.serial_no || row.asset_no || ''}" into one? Only truly identical rows are removed; the server rejects the merge otherwise.`,
    () => applyMergeDuplicate(row.keep_id, row.remove_ids || []),
    (n) => `${n || 0} duplicate row${n === 1 ? '' : 's'} removed.`,
  )

  const itemsByKey = useMemo(
    () => Object.fromEntries((summary?.items || []).map(i => [i.key, i])),
    [summary],
  )

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16 rounded-xl border border-red-800/40 bg-red-950/20 p-8 text-center">
        <ShieldAlert size={22} className="text-red-400 mx-auto mb-3" />
        <h1 className="text-lg font-bold text-white">Restricted</h1>
        <p className="text-sm text-gray-400 mt-1">Self-Healing is reserved for system administrators.</p>
      </div>
    )
  }

  const nothingToHeal = summary && summary.total === 0

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Wand2 size={18} className="text-orange-400" /> Self-Healing
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Scans for data issues and offers only safe, non-destructive fixes
            {scannedAt && <span className="text-gray-600"> | last scan {fmtDate(scannedAt)} {new Date(scannedAt).toLocaleTimeString()}</span>}
          </p>
        </div>
        <button onClick={runScan} disabled={scanning}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-600/20 text-orange-300 hover:bg-orange-600/30 text-xs border border-orange-700/40 transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} /> {scanning ? 'Scanning...' : 'Scan now'}
        </button>
      </div>

      {/* Safety note */}
      <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-200/90 flex items-start gap-2">
        <ShieldCheck size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" />
        <span>
          These actions are safe and non-destructive. The scan only reads data. Fixes are limited to
          backfilling a missing asset and merging exact-duplicate rows, and both are guarded on the
          server. Serial conflicts, stale sites and anomalies are flagged for review only, never
          changed automatically.
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-300 flex items-center gap-2">
          <CheckCircle2 size={14} /> {notice}
        </div>
      )}

      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile label="Total findings" value={summary.total} tone={summary.total > 0 ? 'amber' : 'green'}
            tip="How many data issues the last scan found in total." />
          <SummaryTile label="Warnings" value={summary.bySeverity.warning} tone={summary.bySeverity.warning > 0 ? 'amber' : 'green'}
            tip="Issues worth acting on, some with a safe one-click fix." />
          <SummaryTile label="For review" value={summary.bySeverity.info} tone="blue"
            tip="Informational items to check by hand. Nothing is changed automatically." />
        </div>
      )}

      {/* Empty / loading / findings */}
      {scanning && !scan ? (
        <p className="text-xs text-gray-600 py-8 text-center">Running scans...</p>
      ) : nothingToHeal ? (
        <div className="rounded-2xl border border-emerald-800/40 bg-emerald-950/10 p-10 text-center">
          <ShieldCheck size={26} className="text-emerald-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white">Nothing needs healing - all clear</h2>
          <p className="text-sm text-gray-400 mt-1">The last scan found no data issues across the platform.</p>
        </div>
      ) : scan ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Orphan assets - fixable */}
          <FindingCard meta={itemsByKey.orphans} icon={CARD_META.orphans.Icon} tip={CARD_META.orphans.tip}
            action={itemsByKey.orphans?.fixable && (
              <button onClick={backfillAll} disabled={!!busyKey}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-orange-600/20 text-orange-300 hover:bg-orange-600/30 border border-orange-700/40 disabled:opacity-40">
                {busyKey === 'orphan:all' ? 'Fixing...' : 'Backfill all'}
              </button>
            )}>
            <RowList
              rows={scan.orphans} empty="No orphaned assets."
              render={(r) => (
                <div key={r.asset_no} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-800/60 last:border-0">
                  <div className="min-w-0">
                    <span className="text-xs text-gray-200 font-medium">{r.asset_no}</span>
                    <span className="text-[10px] text-gray-600 ml-2">{r.vehicle_type || 'unknown type'} | {r.tyre_count} tyre{r.tyre_count === 1 ? '' : 's'}</span>
                  </div>
                  <button onClick={() => backfillOne(r.asset_no)} disabled={!!busyKey}
                    className="text-[11px] text-orange-400 hover:text-orange-300 whitespace-nowrap disabled:opacity-40">
                    {busyKey === `orphan:${r.asset_no}` ? 'Fixing...' : 'Backfill'}
                  </button>
                </div>
              )}
            />
          </FindingCard>

          {/* Duplicate tyres - fixable (identical only) */}
          <FindingCard meta={itemsByKey.duplicates} icon={CARD_META.duplicates.Icon} tip={CARD_META.duplicates.tip}>
            <RowList
              rows={scan.duplicates} empty="No exact-duplicate tyre rows."
              render={(r) => (
                <div key={r.keep_id || `${r.serial_no}:${r.asset_no}`} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-800/60 last:border-0">
                  <div className="min-w-0">
                    <span className="text-xs text-gray-200 font-medium">{r.serial_no || '(no serial)'}</span>
                    <span className="text-[10px] text-gray-600 ml-2">asset {r.asset_no || 'N/A'} | {r.row_count} identical copies</span>
                  </div>
                  <button onClick={() => mergeOne(r)} disabled={!!busyKey}
                    className="text-[11px] text-orange-400 hover:text-orange-300 whitespace-nowrap disabled:opacity-40">
                    {busyKey === `dup:${r.keep_id}` ? 'Merging...' : 'Merge'}
                  </button>
                </div>
              )}
            />
          </FindingCard>

          {/* Serial conflicts - read only */}
          <FindingCard meta={itemsByKey.serialConflicts} icon={CARD_META.serialConflicts.Icon} tip={CARD_META.serialConflicts.tip} readOnly>
            <p className="text-[11px] text-blue-300/80 mb-2 flex items-start gap-1.5">
              <Info size={11} className="mt-0.5 flex-shrink-0" />
              These are legitimate tyre movements between vehicles, not errors. Review only, no fix applied.
            </p>
            <RowList
              rows={scan.serialConflicts} empty="No serial conflicts."
              render={(r) => (
                <div key={r.serial_no} className="py-1.5 border-b border-gray-800/60 last:border-0">
                  <span className="text-xs text-gray-200 font-medium">{r.serial_no}</span>
                  <span className="text-[10px] text-gray-600 ml-2">seen on {r.asset_count} assets</span>
                </div>
              )}
            />
          </FindingCard>

          {/* Stale sites - read only */}
          <FindingCard meta={itemsByKey.stale} icon={CARD_META.stale.Icon} tip={CARD_META.stale.tip} readOnly>
            <RowList
              rows={scan.stale} empty="Every site has recent activity."
              render={(r) => (
                <div key={r.group} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-800/60 last:border-0">
                  <span className="text-xs text-gray-200 font-medium">{r.group}</span>
                  <span className="text-[10px] text-gray-600 whitespace-nowrap">quiet {r.daysStale}d | last {fmtDate(r.lastSeen)}</span>
                </div>
              )}
            />
          </FindingCard>

          {/* Predictive anomalies - read only */}
          <FindingCard meta={itemsByKey.anomalies} icon={CARD_META.anomalies.Icon} tip={CARD_META.anomalies.tip} readOnly wide>
            <RowList
              rows={scan.anomalies} empty="No unusual tyre patterns detected." max={12}
              render={(a) => (
                <div key={a.id} className="flex items-start gap-2 py-1.5 border-b border-gray-800/60 last:border-0">
                  <AlertTriangle size={12} className={`mt-0.5 flex-shrink-0 ${a.severity === 'high' ? 'text-red-400' : a.severity === 'medium' ? 'text-amber-400' : 'text-gray-500'}`} />
                  <span className="text-[11px] text-gray-300">{a.message}</span>
                </div>
              )}
            />
          </FindingCard>
        </div>
      ) : null}

      <p className="text-[11px] text-gray-600">
        Self-Healing reuses the existing data reconciliation checks. It never deletes non-identical rows,
        never merges tyres that moved between vehicles, and always asks for confirmation before a fix.
      </p>
    </div>
  )
}

// ── Sub components ─────────────────────────────────────────────────────────────

function SummaryTile({ label, value, tone, tip }) {
  const text = tone === 'amber' ? 'text-amber-400' : tone === 'blue' ? 'text-blue-300' : 'text-emerald-400'
  const ring = tone === 'amber' ? 'border-amber-500/30 bg-amber-500/5'
    : tone === 'blue' ? 'border-blue-500/30 bg-blue-500/5' : 'border-emerald-500/30 bg-emerald-500/5'
  return (
    <div className={`rounded-xl border p-4 ${ring}`}>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 flex items-center">
        {label}<InfoDot text={tip} />
      </p>
      <p className={`text-2xl font-black mt-1 ${text}`}>{value}</p>
    </div>
  )
}

function FindingCard({ meta, icon: Icon, tip, action, children, readOnly, wide }) {
  const sev = meta?.severity || 'info'
  const count = meta?.count ?? 0
  return (
    <div className={`rounded-xl border ${SEV_RING[sev] || SEV_RING.info} p-4 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className={SEV_TEXT[sev] || SEV_TEXT.info} />
        <span className="text-sm font-semibold text-white flex items-center">
          {meta?.label || 'Findings'}<InfoDot text={tip} />
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold capitalize ${SEV_BADGE[sev] || SEV_BADGE.info}`}>{sev}</span>
        <span className="text-lg font-black text-white ml-1">{count}</span>
        {readOnly && <span className="text-[10px] text-gray-600 ml-1">review only</span>}
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </div>
  )
}

function RowList({ rows, render, empty, max = 8 }) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) {
    return <p className="text-[11px] text-gray-600 py-2">{empty}</p>
  }
  const shown = list.slice(0, max)
  return (
    <div>
      {shown.map(render)}
      {list.length > shown.length && (
        <p className="text-[10px] text-gray-600 pt-2">+ {list.length - shown.length} more</p>
      )}
    </div>
  )
}
