/**
 * ConsoleSelfHealing - super-admin Self-Healing console (Admin Control Module 2).
 *
 * A pure console page (useConsoleAuth gate). It SCANS the platform read-only and
 * FLAGS data-integrity issues, then offers only the SAFE, already-guarded fixes
 * that live in the reconciliation layer:
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
  Info, Link2Off, Copy, Shuffle, Clock, Activity, BarChart3,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  runScans, scanAnomalies, applyBackfillOrphan, applyBackfillAllOrphans,
  applyMergeDuplicate, logHealFinding,
} from '../../lib/api/selfHealing'
import { detectStaleGroups, summarizeFindings } from '../../lib/selfHealing'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Code,
  LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { BarsChart, STATUS, useChartTheme } from '../components/ui/charts'

// ── Presentation helpers ──────────────────────────────────────────────────────

const SEV_TONE = { warning: 'warning', info: 'info', critical: 'danger' }
const SEV_COLOR = { warning: 'medium', info: 'low', critical: 'critical' }
const ANOMALY_TONE = { high: 'danger', medium: 'warning', low: 'quiet' }

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

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsoleSelfHealing() {
  const { admin } = useConsoleAuth()
  const theme = useChartTheme()

  const [scan, setScan]       = useState(null)   // { orphans, duplicates, serialConflicts, stale, anomalies }
  const [summary, setSummary] = useState(null)
  const [scannedAt, setScannedAt] = useState(null)
  const [scanning, setScanning]   = useState(false)
  const [error, setError]         = useState(null)
  const [busyKey, setBusyKey]     = useState(null) // which fix is running
  const [notice, setNotice]       = useState(null)
  const [pending, setPending]     = useState(null) // fix awaiting confirmation

  const mountedRef = useRef(true)

  const runScan = useCallback(async () => {
    setScanning(true)
    setError(null)
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
      if (mountedRef.current) setError(toUserMessage(err, 'The scan could not complete. Please try again.'))
    } finally {
      if (mountedRef.current) setScanning(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    runScan()
    return () => { mountedRef.current = false }
  }, [runScan])

  const rescan = () => { setNotice(null); runScan() }

  // ── Safe fix handlers (each confirms first, then re-scans) ──
  function askFix(key, title, message, fn, okMsg) {
    if (busyKey) return
    setPending({ key, title, message, fn, okMsg })
  }

  async function confirmFix() {
    const p = pending
    if (!p || busyKey) return
    setPending(null)
    setBusyKey(p.key)
    setError(null)
    setNotice(null)
    try {
      const result = await p.fn()
      if (mountedRef.current) setNotice(typeof p.okMsg === 'function' ? p.okMsg(result) : p.okMsg)
      await runScan()
    } catch (err) {
      if (mountedRef.current) setError(toUserMessage(err, 'That fix could not be applied.'))
    } finally {
      if (mountedRef.current) setBusyKey(null)
    }
  }

  const backfillOne = (assetNo) => askFix(
    `orphan:${assetNo}`,
    'Backfill this asset?',
    `Create the missing fleet record for asset "${assetNo}"? This is a safe insert and removes nothing.`,
    () => applyBackfillOrphan(assetNo),
    `Asset "${assetNo}" was added to the fleet list.`,
  )

  const backfillAll = () => askFix(
    'orphan:all',
    'Backfill every orphaned asset?',
    `Create fleet records for all ${scan?.orphans?.length || 0} orphaned assets? This is a safe insert and removes nothing.`,
    () => applyBackfillAllOrphans(),
    (n) => `${n || 0} asset${n === 1 ? '' : 's'} added to the fleet list.`,
  )

  const mergeOne = (row) => askFix(
    `dup:${row.keep_id}`,
    'Merge identical copies?',
    `Merge ${((row.remove_ids || []).length) + 1} identical copies of tyre "${row.serial_no || row.asset_no || ''}" into one? Only truly identical rows are removed; the server rejects the merge otherwise.`,
    () => applyMergeDuplicate(row.keep_id, row.remove_ids || []),
    (n) => `${n || 0} duplicate row${n === 1 ? '' : 's'} removed.`,
  )

  const itemsByKey = useMemo(
    () => Object.fromEntries((summary?.items || []).map(i => [i.key, i])),
    [summary],
  )

  const colors = STATUS[theme]
  const findingBars = useMemo(
    () => (summary?.items || []).map(i => ({
      label: i.label, value: i.count, color: colors[SEV_COLOR[i.severity] || 'low'],
    })),
    [summary, colors],
  )

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Panel tone="danger">
          <EmptyState icon={ShieldAlert} title="Restricted" reason="Self-Healing is reserved for system administrators." />
        </Panel>
      </div>
    )
  }

  const nothingToHeal = summary && summary.total === 0

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2">
            <Wand2 size={18} className="text-orange-400" /> Self-Healing
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Scans for data issues and offers only safe, non-destructive fixes
            {scannedAt && <span> | last scan {fmtDateTime(scannedAt)}</span>}
          </p>
        </div>
        <Btn variant="primary" icon={RefreshCw} onClick={rescan} busy={scanning}>
          {scanning ? 'Scanning' : 'Scan now'}
        </Btn>
      </header>

      {/* Safety note */}
      <Note icon={ShieldCheck} tone="accent">
        These actions are safe and non-destructive. The scan only reads data. Fixes are limited to
        backfilling a missing asset and merging exact-duplicate rows, and both are guarded on the
        server. Serial conflicts, stale sites and anomalies are flagged for review only, never
        changed automatically.
      </Note>

      <ErrorState message={error} onRetry={rescan} />
      {notice && (
        <Note icon={CheckCircle2} tone="accent">{notice}</Note>
      )}

      {/* Summary strip + chart */}
      {summary && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid grid-cols-3 lg:grid-cols-1 gap-3">
            <div title="How many data issues the last scan found in total.">
              <StatTile label="Total findings" value={summary.total} tone={summary.total > 0 ? 'warning' : 'good'} icon={Wand2} />
            </div>
            <div title="Issues worth acting on, some with a safe one-click fix.">
              <StatTile label="Warnings" value={summary.bySeverity.warning} tone={summary.bySeverity.warning > 0 ? 'warning' : 'good'} icon={AlertTriangle} />
            </div>
            <div title="Informational items to check by hand. Nothing is changed automatically.">
              <StatTile label="For review" value={summary.bySeverity.info} tone="default" icon={Info} />
            </div>
          </div>
          <Panel className="lg:col-span-2">
            <PanelHeader icon={BarChart3} title="Findings by check"
              subtitle="Bars are coloured by severity: amber is a warning, grey is review only." />
            <BarsChart
              bars={findingBars}
              summary={findingBars.map(b => `${b.label} ${b.value}`).join(', ')}
              emptyText="The last scan found nothing to show."
            />
          </Panel>
        </div>
      )}

      {/* Empty / loading / findings */}
      {scanning && !scan ? (
        <Panel><LoadingState label="Running scans" /></Panel>
      ) : nothingToHeal ? (
        <Panel>
          <EmptyState icon={ShieldCheck} title="Nothing needs healing, all clear"
            reason="The last scan found no data issues across the platform." />
        </Panel>
      ) : scan ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Orphan assets - fixable */}
          <FindingCard meta={itemsByKey.orphans} icon={CARD_META.orphans.Icon} tip={CARD_META.orphans.tip}
            action={itemsByKey.orphans?.fixable && (
              <Btn size="xs" variant="primary" onClick={backfillAll} disabled={!!busyKey && busyKey !== 'orphan:all'}
                busy={busyKey === 'orphan:all'}>
                Backfill all
              </Btn>
            )}>
            <RowList
              rows={scan.orphans} empty="No orphaned assets."
              render={(r) => (
                <div key={r.asset_no} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-800/60 last:border-0">
                  <div className="min-w-0 flex items-center gap-2">
                    <Code>{r.asset_no}</Code>
                    <span className="text-[11px] text-gray-500 truncate">{r.vehicle_type || 'unknown type'} | {r.tyre_count} tyre{r.tyre_count === 1 ? '' : 's'}</span>
                  </div>
                  <Btn size="xs" onClick={() => backfillOne(r.asset_no)} disabled={!!busyKey && busyKey !== `orphan:${r.asset_no}`}
                    busy={busyKey === `orphan:${r.asset_no}`}>
                    Backfill
                  </Btn>
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
                  <div className="min-w-0 flex items-center gap-2">
                    <Code>{r.serial_no || 'No serial'}</Code>
                    <span className="text-[11px] text-gray-500 truncate">asset {r.asset_no || 'N/A'} | {r.row_count} identical copies</span>
                  </div>
                  <Btn size="xs" onClick={() => mergeOne(r)} disabled={!!busyKey && busyKey !== `dup:${r.keep_id}`}
                    busy={busyKey === `dup:${r.keep_id}`}>
                    Merge
                  </Btn>
                </div>
              )}
            />
          </FindingCard>

          {/* Serial conflicts - read only */}
          <FindingCard meta={itemsByKey.serialConflicts} icon={CARD_META.serialConflicts.Icon} tip={CARD_META.serialConflicts.tip} readOnly>
            <p className="text-[11px] text-gray-400 mb-2 flex items-start gap-1.5">
              <Info size={11} className="mt-0.5 shrink-0 text-gray-500" />
              These are legitimate tyre movements between vehicles, not errors. Review only, no fix applied.
            </p>
            <RowList
              rows={scan.serialConflicts} empty="No serial conflicts."
              render={(r) => (
                <div key={r.serial_no} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-800/60 last:border-0">
                  <Code>{r.serial_no}</Code>
                  <span className="text-[11px] text-gray-500">seen on {r.asset_count} assets</span>
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
                  <span className="text-[11px] text-gray-500 whitespace-nowrap">quiet {r.daysStale}d | last {fmtDate(r.lastSeen)}</span>
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
                  <Badge tone={ANOMALY_TONE[a.severity] || 'quiet'}>
                    <span className="capitalize">{a.severity || 'low'}</span>
                  </Badge>
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

      <Modal
        open={!!pending}
        title={pending?.title || 'Apply fix?'}
        subtitle="Guarded on the server. The scan runs again once it finishes."
        onClose={() => setPending(null)}
        width="max-w-md"
        footer={(
          <>
            <Btn onClick={() => setPending(null)}>Cancel</Btn>
            <Btn variant="primary" icon={Wand2} onClick={confirmFix}>Apply fix</Btn>
          </>
        )}
      >
        <p className="text-sm text-gray-300">{pending?.message}</p>
      </Modal>
    </div>
  )
}

// ── Sub components ─────────────────────────────────────────────────────────────

function FindingCard({ meta, icon: Icon, tip, action, children, readOnly, wide }) {
  const sev = meta?.severity || 'info'
  const count = meta?.count ?? 0
  return (
    <Panel className={wide ? 'lg:col-span-2' : ''} tone={sev === 'warning' && count > 0 ? 'warning' : undefined}>
      <PanelHeader
        icon={Icon}
        tone={sev === 'warning' && count > 0 ? 'warning' : 'default'}
        title={(
          <span className="inline-flex items-center gap-2 flex-wrap" title={tip}>
            {meta?.label || 'Findings'}
            <span className="tabular-nums text-gray-100">{count}</span>
            <Badge tone={SEV_TONE[sev] || 'info'}><span className="capitalize">{sev}</span></Badge>
            {readOnly && <Badge tone="quiet">Review only</Badge>}
          </span>
        )}
        subtitle={tip}
        actions={action || null}
      />
      {children}
    </Panel>
  )
}

function RowList({ rows, render, empty, max = 8 }) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) {
    return <p className="text-[11px] text-gray-500 py-2">{empty}</p>
  }
  const shown = list.slice(0, max)
  return (
    <div>
      {shown.map(render)}
      {list.length > shown.length && (
        <p className="text-[11px] text-gray-500 pt-2">+ {list.length - shown.length} more</p>
      )}
    </div>
  )
}
