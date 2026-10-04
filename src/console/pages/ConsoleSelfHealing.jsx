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
 * Every fix states what it changes, who is affected and whether it can be
 * undone before it runs. Merging duplicates removes rows, so it is red, needs a
 * reason and the word MERGE typed; backfilling every orphan needs a reason.
 * Each applied fix is written to the console audit log. Nothing destructive is
 * ever invented here. Findings are also logged to the System Health board, and
 * the "Past scans" panel reads them back from there (system_logs), so history
 * survives a reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Wand2, RefreshCw, ShieldAlert, ShieldCheck, CheckCircle2, AlertTriangle,
  Info, Link2Off, Copy, Shuffle, Clock, Activity, BarChart3, List, History,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  runScans, scanAnomalies, applyBackfillOrphan, applyBackfillAllOrphans,
  applyMergeDuplicate, logHealFinding, SCAN_LABELS,
} from '../../lib/api/selfHealing'
import { detectStaleGroups, summarizeFindings } from '../../lib/selfHealing'
import { listSystemLogs } from '../../lib/api/systemLogs'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Code, Segmented, SearchInput, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, ConfirmImpactDialog,
} from '../components/ui'
import ExportButtons from './shared/ExportButtons'
import {
  PageHeader as OpsPageHeader, Pager, usePaged, PAGE_SIZE, Drawer, Collapsible, AttentionList, useUrlTab,
} from './shared/pageKit'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
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

function deltaText(now, before) {
  if (before == null) return ''
  const d = now - before
  if (d === 0) return 'same as the previous scan'
  return d < 0 ? `${-d} fewer than the previous scan` : `${d} more than the previous scan`
}

/** Column specs for the "view all" drawer of each check. */
const DETAIL_SPECS = {
  orphans: {
    title: 'Orphaned assets', search: ['asset_no', 'vehicle_type'],
    columns: [
      { key: 'asset_no', header: 'Asset' },
      { key: 'vehicle_type', header: 'Vehicle type', value: (r) => r.vehicle_type || 'unknown type' },
      { key: 'tyre_count', header: 'Tyres' },
    ],
    rowKey: (r) => r.asset_no, actionLabel: 'Backfill', busyKeyOf: (r) => `orphan:${r.asset_no}`,
  },
  duplicates: {
    title: 'Exact-duplicate tyres', search: ['serial_no', 'asset_no'],
    columns: [
      { key: 'serial_no', header: 'Serial', value: (r) => r.serial_no || 'No serial' },
      { key: 'asset_no', header: 'Asset', value: (r) => r.asset_no || 'N/A' },
      { key: 'row_count', header: 'Identical copies' },
    ],
    rowKey: (r) => r.keep_id || `${r.serial_no}:${r.asset_no}`, actionLabel: 'Merge', busyKeyOf: (r) => `dup:${r.keep_id}`,
  },
  serialConflicts: {
    title: 'Serial conflicts', search: ['serial_no'], readOnly: true,
    columns: [
      { key: 'serial_no', header: 'Serial' },
      { key: 'asset_count', header: 'Assets' },
    ],
    rowKey: (r) => r.serial_no,
  },
  stale: {
    title: 'Quiet sites', search: ['group'], readOnly: true,
    columns: [
      { key: 'group', header: 'Site' },
      { key: 'daysStale', header: 'Days quiet' },
      { key: 'lastSeen', header: 'Last activity', value: (r) => fmtDate(r.lastSeen) },
    ],
    rowKey: (r) => r.group,
  },
  anomalies: {
    title: 'Unusual tyre patterns', search: ['message', 'severity'], readOnly: true,
    columns: [
      { key: 'severity', header: 'Severity', value: (r) => r.severity || 'low' },
      { key: 'message', header: 'Finding' },
    ],
    rowKey: (r) => r.id,
  },
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsoleSelfHealing({ tabParam = 'tab' } = {}) {
  const { admin, logAction } = useConsoleAuth()
  const theme = useChartTheme()
  const [pastScans, setPastScans] = useState({ loading: true, error: '', rows: [] })
  const [fixError, setFixError] = useState('')

  const [scan, setScan]       = useState(null)   // { orphans, duplicates, serialConflicts, stale, anomalies }
  const [summary, setSummary] = useState(null)
  const [scannedAt, setScannedAt] = useState(null)
  const [scanning, setScanning]   = useState(false)
  const [error, setError]         = useState(null)
  // Checks that could not run on the last scan ({ key, label, message }). Their
  // buckets are empty because they were NOT read, not because they are clean.
  const [failedChecks, setFailedChecks] = useState([])
  const [busyKey, setBusyKey]     = useState(null) // which fix is running
  const [notice, setNotice]       = useState(null)
  const [pending, setPending]     = useState(null) // fix awaiting confirmation
  const [history, setHistory]     = useState([])   // this session's scan totals, newest first
  const [detailKey, setDetailKey] = useState(null) // which check's full list is open
  const [tab, setTab] = useUrlTab(['findings', 'summary'], 'findings', tabParam)

  const mountedRef = useRef(true)

  const runScan = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      // Each check is isolated: a failing one is recorded, never read as "clean".
      const [base, anomalyRes] = await Promise.all([
        runScans(),
        scanAnomalies().then(
          (rows) => ({ ok: true, rows }),
          (err) => ({ ok: false, err }),
        ),
      ])
      const failed = [...(base.failed || [])]
      if (!anomalyRes.ok) {
        failed.push({
          key: 'anomalies',
          label: SCAN_LABELS.anomalies,
          message: toUserMessage(anomalyRes.err, 'This check could not run.'),
        })
      }
      const anomalies = anomalyRes.ok ? anomalyRes.rows : []
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
      setFailedChecks(failed)
      const at = new Date().toISOString()
      setScannedAt(at)
      setHistory((h) => [{ at, total: sum.total, failed: failed.length }, ...h].slice(0, 10))
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

  // Scans logged to System Health by earlier sessions (logHealFinding writes
  // only when a scan found something, so a clean scan leaves no row).
  const loadPast = useCallback(async () => {
    setPastScans((p) => ({ ...p, loading: true, error: '' }))
    try {
      const rows = await listSystemLogs({ module: 'self-healing', limit: 20 })
      if (mountedRef.current) setPastScans({ loading: false, error: '', rows: (rows || []).filter((r) => r.module_id === 'self-healing') })
    } catch (e) {
      if (mountedRef.current) setPastScans({ loading: false, error: toUserMessage(e, 'Past scans could not be read.'), rows: [] })
    }
  }, [])
  useEffect(() => { loadPast() }, [loadPast, scannedAt])

  const rescan = () => { setNotice(null); runScan() }

  // ── Safe fix handlers (each confirms first, then re-scans) ──
  function askFix(key, title, impact, fn, okMsg, opts = {}) {
    if (busyKey) return
    setFixError('')
    setPending({ key, title, impact, fn, okMsg, ...opts })
  }

  async function confirmFix({ reason } = {}) {
    const p = pending
    if (!p || busyKey) return
    setBusyKey(p.key)
    setError(null)
    setNotice(null)
    setFixError('')
    try {
      const result = await p.fn()
      await logAction?.(p.audit || 'self_heal_fix', null, 'self_healing', { fix: p.key, reason: reason || null, result: typeof result === 'number' ? result : null })
      setPending(null)
      if (mountedRef.current) setNotice(typeof p.okMsg === 'function' ? p.okMsg(result) : p.okMsg)
      await runScan()
    } catch (err) {
      if (mountedRef.current) setFixError(toUserMessage(err, 'That fix could not be applied. Nothing was changed.'))
    } finally {
      if (mountedRef.current) setBusyKey(null)
    }
  }

  const backfillOne = (assetNo) => askFix(
    `orphan:${assetNo}`,
    'Backfill this asset?',
    {
      what: `Create the missing fleet record for asset "${assetNo}".`, tone: 'info',
      change: 'One asset row is added to the fleet list. This is a safe insert and removes nothing.',
      who: 'Everyone who reads per-asset reports: the tyres on this asset start appearing there.',
      undo: 'Yes. The new asset can be edited or removed from the fleet list.',
    },
    () => applyBackfillOrphan(assetNo),
    `Asset "${assetNo}" was added to the fleet list.`,
    { audit: 'self_heal_backfill' },
  )

  const backfillAll = () => askFix(
    'orphan:all',
    'Backfill every orphaned asset?',
    {
      what: `Create fleet records for all ${scan?.orphans?.length || 0} orphaned assets.`, tone: 'warning',
      stats: [{ label: 'Assets added', value: scan?.orphans?.length || 0 }, { label: 'Rows removed', value: 0 }, { label: 'Tyres linked', value: (scan?.orphans || []).reduce((a, r) => a + (Number(r.tyre_count) || 0), 0) }],
      change: 'One asset row is added per orphan. Nothing is removed or overwritten.',
      who: 'Every organisation: their tyres start appearing in per-asset reports and fleet counts rise.',
      undo: 'Yes, one by one from the fleet list. There is no single undo for the batch.',
    },
    () => applyBackfillAllOrphans(),
    (n) => `${n || 0} asset${n === 1 ? '' : 's'} added to the fleet list.`,
    { audit: 'self_heal_backfill_all', requireReason: true },
  )

  const mergeOne = (row) => askFix(
    `dup:${row.keep_id}`,
    'Merge identical copies?',
    {
      what: `Merge ${((row.remove_ids || []).length) + 1} identical copies of tyre "${row.serial_no || row.asset_no || ''}" into one.`, tone: 'danger',
      change: `${(row.remove_ids || []).length} row${(row.remove_ids || []).length === 1 ? '' : 's'} are deleted and one is kept. The server refuses unless every field is identical.`,
      who: 'Reports that counted this tyre more than once now count it once (tyre totals and spend can fall).',
      undo: 'Not from this page. Restore from Backups if needed.',
    },
    () => applyMergeDuplicate(row.keep_id, row.remove_ids || []),
    (n) => `${n || 0} duplicate row${n === 1 ? '' : 's'} removed.`,
    { audit: 'self_heal_merge', requireReason: true, typedWord: 'MERGE', danger: true },
  )

  const prevTotal = history.length > 1 ? history[1].total : null

  const attention = useMemo(() => {
    const out = []
    // A check that did not run is already stated (with Retry) in the danger note above.
    const orphans = scan?.orphans?.length || 0
    if (orphans) out.push({
      key: 'orphans', tone: 'warning',
      text: `${orphans} tyre-bearing ${orphans === 1 ? 'asset is' : 'assets are'} missing from the fleet list, so their tyres drop out of per-asset reports.`,
      action: { label: 'Backfill all', onClick: backfillAll },
    })
    const dups = scan?.duplicates?.length || 0
    if (dups) out.push({
      key: 'dups', tone: 'warning',
      text: `${dups} tyre ${dups === 1 ? 'record is' : 'records are'} saved more than once with every field identical.`,
      action: { label: 'Review', onClick: () => setDetailKey('duplicates') },
    })
    const highAnom = (scan?.anomalies || []).filter((a) => a.severity === 'high').length
    if (highAnom) out.push({
      key: 'anom', tone: 'info',
      text: `${highAnom} high-severity tyre ${highAnom === 1 ? 'pattern needs' : 'patterns need'} a human look.`,
      action: { label: 'Review', onClick: () => setDetailKey('anomalies') },
    })
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, failedChecks])

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

  const detailSpec = detailKey ? DETAIL_SPECS[detailKey] : null

  const failedByKey = Object.fromEntries(failedChecks.map((f) => [f.key, f]))
  // "All clear" only when every check actually ran and found nothing.
  const nothingToHeal = summary && summary.total === 0 && failedChecks.length === 0

  return (
    <div className="space-y-5 max-w-7xl">
      <OpsPageHeader
        icon={Wand2}
        title="Self-Healing"
        purpose="Scans for data issues and offers only guarded fixes. Each fix says what it changes before it runs and is written to the audit log."
        refreshedAt={scannedAt}
        actions={(
          <Btn variant="primary" icon={RefreshCw} onClick={rescan} busy={scanning}>
            {scanning ? 'Scanning...' : 'Scan now'}
          </Btn>
        )}
      />

      <Collapsible icon={ShieldCheck} title="How these fixes stay safe"
        subtitle="The scan only reads. Two guarded fixes; everything else is review only.">
        <Note icon={ShieldCheck} tone="accent">
          These actions are safe and non-destructive. The scan only reads data. Fixes are limited to
          backfilling a missing asset and merging exact-duplicate rows, and both are guarded on the
          server. Serial conflicts, stale sites and anomalies are flagged for review only, never
          changed automatically.
        </Note>
      </Collapsible>

      <ErrorState message={error} onRetry={rescan} />
      {failedChecks.length > 0 && (
        <Note icon={AlertTriangle} tone="danger">
          <span role="alert" className="block">
            {failedChecks.length === 1 ? 'One check' : `${failedChecks.length} checks`} could not run, so the
            counts below are incomplete. A check that did not run is not reported as clean.
          </span>
          <ul className="mt-1.5 space-y-0.5">
            {failedChecks.map((f) => (
              <li key={`${f.key}:${f.message}`} className="text-[11px]">
                <span className="font-medium">{f.label}:</span> {f.message}
              </li>
            ))}
          </ul>
          <span className="mt-2 inline-block"><Btn size="xs" icon={RefreshCw} onClick={rescan} busy={scanning}>Retry scan</Btn></span>
        </Note>
      )}
      {notice && (
        <Note icon={CheckCircle2} tone="accent">{notice}</Note>
      )}

      {/* KPI row */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div title="How many data issues the last scan found in total.">
            <StatTile label="Total findings" value={summary.total}
              tone={summary.total > 0 ? 'warning' : failedChecks.length > 0 ? 'default' : 'good'} icon={Wand2}
              sub={failedChecks.length > 0 ? `Incomplete: ${failedChecks.length} check${failedChecks.length === 1 ? '' : 's'} did not run`
                : prevTotal != null ? deltaText(summary.total, prevTotal) : undefined}
              onClick={() => setTab('findings')} active={tab === 'findings'} />
          </div>
          <div title="Issues worth acting on, some with a safe one-click fix.">
            <StatTile label="Warnings" value={summary.bySeverity.warning} tone={summary.bySeverity.warning > 0 ? 'warning' : 'good'} icon={AlertTriangle} />
          </div>
          <div title="Informational items to check by hand. Nothing is changed automatically.">
            <StatTile label="For review" value={summary.bySeverity.info} tone="default" icon={Info} />
          </div>
          <div title="Findings a one-click, server-guarded fix can clear.">
            <StatTile label="Fixable now" icon={CheckCircle2}
              value={(scan?.orphans?.length || 0) + (scan?.duplicates?.length || 0)}
              tone={(scan?.orphans?.length || 0) + (scan?.duplicates?.length || 0) > 0 ? 'accent' : 'good'}
              sub="Backfill or merge" onClick={() => setTab('summary')} active={tab === 'summary'} />
          </div>
        </div>
      )}

      {summary && !scanning && (
        <AttentionList items={attention} clear={failedChecks.length ? 'Some checks did not run, so this list may be incomplete.' : 'Nothing needs attention: no fixable findings on the last scan.'} />
      )}

      {summary && (
        <Segmented value={tab} onChange={setTab} ariaLabel="Self-healing views" options={[
          { key: 'findings', label: 'Findings', count: summary.total },
          { key: 'summary', label: 'Summary' },
        ]} />
      )}

      {tab === 'summary' && summary && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel className="lg:col-span-2">
            <PanelHeader icon={BarChart3} title="Findings by check"
              subtitle="Bars are coloured by severity: amber is a warning, grey is review only."
              actions={<ExportButtons rows={summary.items || []} title="Self Healing Findings" columns={[
                { key: 'label', header: 'Check' },
                { key: 'severity', header: 'Severity' },
                { key: 'count', header: 'Findings' },
              ]} />} />
            <BarsChart
              bars={findingBars}
              summary={findingBars.map(b => `${b.label} ${b.value}`).join(', ')}
              emptyText="The last scan found nothing to show."
            />
          </Panel>
          <Panel>
            <PanelHeader icon={Clock} title="Scans this session" subtitle="Totals after each scan, newest first. Resets when the page is reopened." />
            {history.length === 0 ? (
              <EmptyState icon={Clock} title="No scans yet" reason="The first scan is still running." />
            ) : (
              <ul className="space-y-1">
                {history.map((h, i) => (
                  <li key={h.at} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-gray-400">{fmtDateTime(h.at)}</span>
                    <span className="tabular-nums text-gray-200">
                      {h.total} finding{h.total === 1 ? '' : 's'}{h.failed ? `, ${h.failed} not run` : ''}
                      {i < history.length - 1 && <span className="text-gray-500"> ({deltaText(h.total, history[i + 1].total)})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel className="lg:col-span-3">
            <PanelHeader icon={History} title="Past scans with findings"
              subtitle="Read back from System Health. A scan that found nothing leaves no record, so a gap here means clean or not run." />
            {pastScans.loading ? <LoadingState label="Reading past scans" rows={2} /> : pastScans.error ? (
              <ErrorState message={pastScans.error} onRetry={loadPast} />
            ) : pastScans.rows.length === 0 ? (
              <EmptyState icon={History} title="No past scan is recorded" reason="No earlier scan found anything, or none has run before." />
            ) : (
              <ul className="divide-y divide-gray-800/70">
                {pastScans.rows.map((r) => (
                  <li key={r.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                    <span className="text-gray-300 min-w-0 break-words">{r.message}</span>
                    <span className="text-gray-500 whitespace-nowrap">{fmtDateTime(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
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
      ) : scan && tab === 'findings' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Orphan assets - fixable */}
          <FindingCard meta={itemsByKey.orphans} failure={failedByKey.orphans} icon={CARD_META.orphans.Icon} tip={CARD_META.orphans.tip}
            action={itemsByKey.orphans?.fixable && (
              <Btn size="xs" variant="primary" onClick={backfillAll} disabled={!!busyKey && busyKey !== 'orphan:all'}
                busy={busyKey === 'orphan:all'}>
                Backfill all
              </Btn>
            )}>
            <RowList
              rows={scan.orphans} onViewAll={() => setDetailKey('orphans')} empty="No orphaned assets."
              render={(r) => (
                <div key={r.asset_no} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-800/60 last:border-0">
                  <div className="min-w-0 flex items-center gap-2">
                    <Code>{r.asset_no}</Code>
                    <span className="text-[11px] text-gray-400 truncate" title={`${r.vehicle_type || 'unknown type'} | ${r.tyre_count} tyres`}>{r.vehicle_type || 'unknown type'} | {r.tyre_count} tyre{r.tyre_count === 1 ? '' : 's'}</span>
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
          <FindingCard meta={itemsByKey.duplicates} failure={failedByKey.duplicates} icon={CARD_META.duplicates.Icon} tip={CARD_META.duplicates.tip}>
            <RowList
              rows={scan.duplicates} onViewAll={() => setDetailKey('duplicates')} empty="No exact-duplicate tyre rows."
              render={(r) => (
                <div key={r.keep_id || `${r.serial_no}:${r.asset_no}`} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-800/60 last:border-0">
                  <div className="min-w-0 flex items-center gap-2">
                    <Code>{r.serial_no || 'No serial'}</Code>
                    <span className="text-[11px] text-gray-400 truncate" title={`asset ${r.asset_no || 'N/A'} | ${r.row_count} identical copies`}>asset {r.asset_no || 'N/A'} | {r.row_count} identical copies</span>
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
          <FindingCard meta={itemsByKey.serialConflicts} failure={failedByKey.serialConflicts} icon={CARD_META.serialConflicts.Icon} tip={CARD_META.serialConflicts.tip} readOnly>
            <p className="text-[11px] text-gray-400 mb-2 flex items-start gap-1.5">
              <Info size={11} className="mt-0.5 shrink-0 text-gray-500" />
              These are legitimate tyre movements between vehicles, not errors. Review only, no fix applied.
            </p>
            <RowList
              rows={scan.serialConflicts} onViewAll={() => setDetailKey('serialConflicts')} empty="No serial conflicts."
              render={(r) => (
                <div key={r.serial_no} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-800/60 last:border-0">
                  <Code>{r.serial_no}</Code>
                  <span className="text-[11px] text-gray-500">seen on {r.asset_count} assets</span>
                </div>
              )}
            />
          </FindingCard>

          {/* Stale sites - read only */}
          <FindingCard meta={itemsByKey.stale} failure={failedByKey.stale} icon={CARD_META.stale.Icon} tip={CARD_META.stale.tip} readOnly>
            <RowList
              rows={scan.stale} onViewAll={() => setDetailKey('stale')} empty="Every site has recent activity."
              render={(r) => (
                <div key={r.group} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-800/60 last:border-0">
                  <span className="text-xs text-gray-200 font-medium min-w-0 break-words">{r.group}</span>
                  <span className="text-[11px] text-gray-500 whitespace-nowrap">quiet {r.daysStale}d | last {fmtDate(r.lastSeen)}</span>
                </div>
              )}
            />
          </FindingCard>

          {/* Predictive anomalies - read only */}
          <FindingCard meta={itemsByKey.anomalies} failure={failedByKey.anomalies} icon={CARD_META.anomalies.Icon} tip={CARD_META.anomalies.tip} readOnly wide>
            <RowList
              rows={scan.anomalies} onViewAll={() => setDetailKey('anomalies')} empty="No unusual tyre patterns detected." max={12}
              render={(a) => (
                <div key={a.id} className="flex items-start gap-2 py-1.5 border-b border-gray-800/60 last:border-0">
                  <Badge tone={ANOMALY_TONE[a.severity] || 'quiet'}>
                    <span className="capitalize">{a.severity || 'low'}</span>
                  </Badge>
                  <span className="text-[11px] text-gray-300 min-w-0 break-words">{a.message}</span>
                </div>
              )}
            />
          </FindingCard>
        </div>
      ) : null}

      <p className="text-[11px] text-gray-500">
        Self-Healing reuses the existing data reconciliation checks. It never deletes non-identical rows,
        never merges tyres that moved between vehicles, and always asks for confirmation before a fix.
      </p>

      <Drawer open={!!detailSpec} onClose={() => setDetailKey(null)} width="max-w-3xl"
        title={detailSpec ? `${SCAN_LABELS[detailKey] || detailSpec.title}: every finding` : ''}
        subtitle={detailSpec?.readOnly ? 'Review only. Nothing here is changed automatically.' : 'Each fix asks for confirmation first.'}>
        {detailSpec && (
          <FindingTable spec={detailSpec} rows={scan?.[detailKey] || []} title={SCAN_LABELS[detailKey] || detailSpec.title}
            busyKey={busyKey}
            onRowAction={detailKey === 'orphans' ? (r) => backfillOne(r.asset_no) : detailKey === 'duplicates' ? (r) => mergeOne(r) : null} />
        )}
      </Drawer>

      <ConfirmImpactDialog
        open={!!pending}
        title={pending?.title || 'Apply fix?'}
        impact={pending?.impact}
        confirmLabel="Apply fix"
        danger={!!pending?.danger}
        requireReason={!!pending?.requireReason}
        typedWord={pending?.typedWord}
        busy={!!busyKey}
        error={fixError}
        onCancel={() => { if (!busyKey) setPending(null) }}
        onConfirm={confirmFix}
      >
        <p className="text-[11px] text-gray-500">Guarded on the server. The scan runs again once it finishes.</p>
      </ConfirmImpactDialog>
    </div>
  )
}

// ── Sub components ─────────────────────────────────────────────────────────────

function FindingCard({ meta, failure, icon: Icon, tip, action, children, readOnly, wide }) {
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
            <span className="tabular-nums text-gray-100">{failure && count === 0 ? 'N/A' : count}</span>
            {failure && <Badge tone="danger">Could not check</Badge>}
            <Badge tone={SEV_TONE[sev] || 'info'}><span className="capitalize">{sev}</span></Badge>
            {readOnly && <Badge tone="quiet">Review only</Badge>}
          </span>
        )}
        subtitle={tip}
        actions={action || null}
      />
      {failure && (
        <p className="text-[11px] text-red-300 mb-2 flex items-start gap-1.5">
          <AlertTriangle size={11} className="mt-0.5 shrink-0 text-red-400" />
          {failure.message}
        </p>
      )}
      {/* A check that did not run shows no rows, never its "nothing found" line. */}
      {failure && count === 0 ? null : children}
    </Panel>
  )
}

function RowList({ rows, render, empty, max = 5, onViewAll }) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) {
    return <p className="text-[11px] text-gray-400 py-2">{empty}</p>
  }
  const shown = list.slice(0, max)
  return (
    <div>
      {shown.map(render)}
      {list.length > shown.length && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <span className="text-[11px] text-gray-500">+ {list.length - shown.length} more</span>
          {onViewAll && <Btn size="xs" icon={List} onClick={onViewAll}>View all {list.length}</Btn>}
        </div>
      )}
    </div>
  )
}

/** Every finding of one check: searchable, sortable, paged, exportable. */
function FindingTable({ spec, rows, title, busyKey, onRowAction }) {
  const [q, setQ] = useState('')
  const { sort, onSort } = useTableSort(null)
  const accessors = useMemo(() => Object.fromEntries(spec.columns.filter((c) => c.value).map((c) => [c.key, c.value])), [spec])
  const visible = useMemo(() => sortRows(searchRows(rows, q, spec.search), sort, accessors), [rows, q, sort, spec, accessors])
  const paged = usePaged(visible, PAGE_SIZE, `${q}|${sort?.key}${sort?.dir}`)
  return (
    <div className="space-y-3">
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder={`Search ${title.toLowerCase()}`} className="w-full sm:w-64" />
        <span className="ml-auto flex items-center gap-2">
          <ExportButtons rows={visible} columns={spec.columns} title={`Self Healing ${title}`} />
        </span>
      </Toolbar>
      {visible.length === 0 ? (
        <EmptyState title="Nothing matches" reason={q ? 'No finding matches this search.' : 'This check found nothing.'} />
      ) : (
        <>
          <Table>
            <THead>
              {spec.columns.map((c) => <Th key={c.key} sortKey={c.key} sort={sort} onSort={onSort}>{c.header}</Th>)}
              {onRowAction && <Th align="right">Fix</Th>}
            </THead>
            <tbody>
              {paged.slice.map((r) => (
                <Tr key={spec.rowKey(r)}>
                  {spec.columns.map((c) => (
                    <Td key={c.key} className="break-words">{c.value ? c.value(r) : (r[c.key] ?? 'N/A')}</Td>
                  ))}
                  {onRowAction && (
                    <Td align="right">
                      <Btn size="xs" busy={busyKey === spec.busyKeyOf(r)} disabled={!!busyKey && busyKey !== spec.busyKeyOf(r)}
                        onClick={() => onRowAction(r)}>{spec.actionLabel}</Btn>
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager {...paged} label="findings" />
        </>
      )}
    </div>
  )
}
