/**
 * ConsoleBackups - super-admin Automated Backups console (Admin Control Module 4).
 *
 * It surfaces the automated nightly database backups in plain English so a non
 * technical owner can operate them:
 *   1. Explainer + "Back up now" (on-demand snapshot)
 *   2. Charts: rows saved per snapshot over time, and rows per table in the
 *      newest snapshot
 *   3. Snapshot list (nightly / manual badge, table + row counts, expandable)
 *   4. Per table "Preview restore" -> a plain-English safety panel
 *   5. "Recover missing rows" gated behind a typed RESTORE confirmation modal
 *      (NON DESTRUCTIVE: only re-adds deleted rows, never overwrites)
 *   6. Excel export of the snapshot list
 *
 * Every technical term (snapshot, restore, retention) carries a small (i)
 * plain-English tooltip. No raw SQL is ever shown. Strings avoid em/en dashes,
 * arrows, curly quotes and middle dots.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, RefreshCw, ShieldAlert, Info, Plus, ChevronRight,
  Database, RotateCcw, CheckCircle2, AlertTriangle, ShieldCheck,
  Clock, BarChart3, History,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Code, Btn, Table, THead, Th, Tr, Td, Segmented,
  LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { TrendChart, BarsChart } from '../components/ui/charts'
import {
  createBackupSnapshot, listBackupSnapshots, restorePreview, restoreMissing,
} from '../../lib/api/backups'
import { sortRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, TabBar, useUrlTab, usePager, Pager, AttentionList } from './dataKit'
import { toUserMessage } from '../../lib/safeError'

const REFRESH_MS = 120_000
const CONFIRM_WORD = 'RESTORE'
const TAB_KEYS = ['backups', 'trends']
const SNAPSHOT_COLUMNS = [
  { key: 'taken_at', header: 'Taken at', value: (s) => fmtDateTime(s.taken_at) },
  { key: 'kind', header: 'Kind', value: (s) => (isNightly(s.reason) ? 'Nightly (automatic)' : 'Manual') },
  { key: 'reason', header: 'Reason' },
  { key: 'taken_by', header: 'Taken by' },
  { key: 'table_count', header: 'Tables', value: (s) => s.table_count ?? 0 },
  { key: 'total_rows', header: 'Total rows', value: (s) => s.total_rows ?? 0 },
]
const SNAP_ACCESSORS = { kind: (s) => (isNightly(s.reason) ? 1 : 0), total_rows: (s) => Number(s.total_rows) || 0, table_count: (s) => Number(s.table_count) || 0 }

// ── Small building blocks ─────────────────────────────────────────────────────

/** Plain-English tooltip marker sitting next to a technical term. */
function InfoDot({ text }) {
  return (
    <span role="img" aria-label={text} className="inline-flex align-middle ml-1 text-gray-500 hover:text-gray-300 cursor-help" title={text}>
      <Info size={11} />
    </span>
  )
}

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString()
}

function fmtShortDate(v) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function fmtRelative(v) {
  if (!v) return 'N/A'
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return 'N/A'
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.floor(hrs / 24)
  return `${days} d ago`
}

function fmtNum(n) {
  return n != null && Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A'
}

/** A snapshot is "nightly" when its reason marks it as automatic. */
function isNightly(reason) {
  return /night|auto|cron|schedul/i.test(String(reason ?? ''))
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsoleBackups() {
  const { admin } = useConsoleAuth()

  const [snapshots, setSnapshots] = useState([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]         = useState(null)
  const [backingUp, setBackingUp] = useState(false)
  const [notice, setNotice]       = useState(null)   // { message, tone }

  // The snapshot whose per-table detail is open in the side panel.
  const [detailId, setDetailId]   = useState(null)
  // Where to return after the typed confirmation closes (the detail it came from).
  const returnToRef = useRef(null)
  const [refreshedAt, setRefreshedAt] = useState(null)
  const [tab, setTab] = useUrlTab(TAB_KEYS, 'backups')

  // Restore preview state: { snapshotId, table } -> loading / delta / error.
  const [previewKey, setPreviewKey] = useState(null)   // `${snapshotId}:${table}`
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview]     = useState(null)
  const [previewError, setPreviewError] = useState(null)

  // Typed-confirmation modal for the actual recovery.
  const [confirmTarget, setConfirmTarget] = useState(null) // { snapshotId, table, taken_at, missing }
  const [confirmText, setConfirmText] = useState('')
  const [restoring, setRestoring] = useState(false)

  const mountedRef = useRef(true)
  const noticeTimer = useRef(null)

  const flash = useCallback((message, tone = 'ok') => {
    setNotice({ message, tone })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => {
      if (mountedRef.current) setNotice(null)
    }, 6000)
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const rows = await listBackupSnapshots(60)
      if (mountedRef.current) { setSnapshots(Array.isArray(rows) ? rows : []); setRefreshedAt(Date.now()) }
    } catch (err) {
      if (mountedRef.current) setError(toUserMessage(err, 'Could not load your backups'))
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false) }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    load()
    const timer = setInterval(() => {
      if (mountedRef.current) { setRefreshing(true); load() }
    }, REFRESH_MS)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    }
  }, [load])

  function refresh() { setRefreshing(true); load() }

  async function handleBackupNow() {
    setBackingUp(true)
    try {
      const header = await createBackupSnapshot('manual')
      await load()
      flash(`Backup created. It saved ${fmtNum(header?.total_rows)} rows across ${fmtNum(header?.table_count)} tables.`)
    } catch (err) {
      flash(toUserMessage(err, 'Could not create the backup. Please try again.'), 'error')
    } finally {
      if (mountedRef.current) setBackingUp(false)
    }
  }

  function openDetail(id) {
    closePreview()
    setDetailId(id)
  }

  async function handlePreview(snapshotId, table) {
    const key = `${snapshotId}:${table}`
    setPreviewKey(key)
    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(true)
    try {
      const delta = await restorePreview(snapshotId, table)
      if (mountedRef.current) setPreview({ key, snapshotId, table, ...delta })
    } catch (err) {
      if (mountedRef.current) setPreviewError(toUserMessage(err, 'Could not build the restore preview.'))
    } finally {
      if (mountedRef.current) setPreviewLoading(false)
    }
  }

  function closePreview() {
    setPreviewKey(null)
    setPreview(null)
    setPreviewError(null)
  }

  // The detail panel closes while the typed confirmation is open, so only one
  // dialog ever holds focus; it re-opens on the same snapshot afterwards.
  function openConfirm(snapshotId, table, taken_at, missing) {
    returnToRef.current = snapshotId
    setDetailId(null)
    setConfirmTarget({ snapshotId, table, taken_at, missing })
    setConfirmText('')
  }

  function closeConfirm() {
    if (restoring) return
    setConfirmTarget(null)
    if (returnToRef.current) { setDetailId(returnToRef.current); returnToRef.current = null }
  }

  async function handleRestore() {
    // `restoring` guard: pressing Enter twice used to fire a second recovery
    // while the first was still in flight.
    if (restoring || !confirmTarget || confirmText.trim().toUpperCase() !== CONFIRM_WORD) return
    const target = confirmTarget
    setRestoring(true)
    try {
      const res = await restoreMissing(target.snapshotId, target.table)
      flash(`Recovered ${fmtNum(res?.restored)} missing row${Number(res?.restored) === 1 ? '' : 's'} into ${target.table}.`)
      setConfirmTarget(null)
      setConfirmText('')
      returnToRef.current = null
      setDetailId(target.snapshotId)
      // Refresh the preview so the counts reflect the recovery.
      handlePreview(target.snapshotId, target.table)
      load()
    } catch (err) {
      flash(toUserMessage(err, 'The recovery did not complete. No data was changed.'), 'error')
    } finally {
      if (mountedRef.current) setRestoring(false)
    }
  }

  // Newest first from the service. Summing total_rows ACROSS snapshots counted
  // the same rows once per stored copy, so the old "rows protected" tile grew
  // with every nightly run while the data did not. The newest snapshot is what
  // is actually protected today.
  const newest = snapshots[0] || null
  const stats = useMemo(() => {
    const nightly = snapshots.filter(s => isNightly(s.reason)).length
    return { nightly, manual: snapshots.length - nightly }
  }, [snapshots])

  const trend = useMemo(() => {
    const ordered = [...snapshots]
      .filter(s => s.taken_at && !Number.isNaN(new Date(s.taken_at).getTime()))
      .sort((a, b) => new Date(a.taken_at) - new Date(b.taken_at))
    return {
      labels: ordered.map(s => fmtShortDate(s.taken_at)),
      values: ordered.map(s => Number(s.total_rows) || 0),
    }
  }, [snapshots])

  // A nightly job that silently stops is the failure that matters most here
  // (it happened once for 20 days), so the age of the newest copy is checked.
  const STALE_HOURS = 36
  const newestAgeHours = newest?.taken_at ? (Date.now() - new Date(newest.taken_at).getTime()) / 3600000 : null
  const stale = newestAgeHours != null && Number.isFinite(newestAgeHours) && newestAgeHours > STALE_HOURS
  const [kindView, setKindView] = useState('all')
  const shownSnapshots = useMemo(() => (kindView === 'all' ? snapshots
    : snapshots.filter((s) => (kindView === 'nightly' ? isNightly(s.reason) : !isNightly(s.reason)))), [snapshots, kindView])

  const { sort, onSort } = useTableSort(null)
  const sortedSnapshots = useMemo(() => (sort ? sortRows(shownSnapshots, sort, SNAP_ACCESSORS) : shownSnapshots), [shownSnapshots, sort])
  const pager = usePager(sortedSnapshots, 25)
  const detail = useMemo(() => snapshots.find((x) => x.id === detailId) || null, [snapshots, detailId])

  // Day-over-day change in rows saved: a sharp fall between consecutive backups
  // means a table shrank before it was saved, which is worth a look.
  const drops = useMemo(() => {
    const out = []
    for (let i = 0; i < snapshots.length - 1; i++) {
      const cur = Number(snapshots[i].total_rows)
      const prev = Number(snapshots[i + 1].total_rows)
      if (Number.isFinite(cur) && Number.isFinite(prev) && prev > 0 && cur < prev * 0.9) {
        out.push({ snap: snapshots[i], lost: prev - cur, pct: Math.round(((prev - cur) / prev) * 100) })
      }
    }
    return out
  }, [snapshots])

  const tableBars = useMemo(() => (Array.isArray(newest?.tables) ? newest.tables : [])
    .map(t => ({ label: t.table_name, value: Number(t.row_count) || 0 }))
    .sort((a, b) => b.value - a.value), [newest])

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <Panel tone="danger">
          <EmptyState icon={ShieldAlert} title="Restricted"
            reason="Automated Backups are reserved for system administrators." />
        </Panel>
      </div>
    )
  }

  const attention = [
    stale && {
      key: 'stale', tone: 'warning',
      title: `The newest backup is ${fmtRelative(newest.taken_at)}`,
      detail: `Taken ${fmtDateTime(newest.taken_at)}. The nightly backup should have run since then; check Automation Health for the backup job.`,
      action: handleBackupNow, actionLabel: 'Back up now', actionIcon: Plus,
    },
    drops[0] && {
      key: 'drop', tone: 'warning',
      title: `Rows saved fell ${drops[0].pct}% on ${fmtShortDate(drops[0].snap.taken_at)}`,
      detail: `${fmtNum(drops[0].lost)} fewer rows than the backup before it. A table may have shrunk before it was saved; preview it to see what can be recovered.`,
      action: () => { setTab('backups'); openDetail(drops[0].snap.id) }, actionLabel: 'Open backup', actionIcon: ChevronRight,
    },
  ]

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={Archive} title="Automated Backups"
        purpose={<>
          Automatic nightly backups of your core data. Kept 30 days.
          <InfoDot text="Retention: how long a backup is stored before it is automatically deleted. Backups older than 30 days are removed to save space." />
          {' '}You can also make a backup now.
        </>}
        refreshedAt={refreshedAt} onRefresh={refresh} refreshing={refreshing} refreshDisabled={loading}
        actions={(
          <Btn variant="primary" icon={Plus} onClick={handleBackupNow} busy={backingUp}
            title="Take a snapshot of your core data right now, in addition to the automatic nightly one">
            {backingUp ? 'Backing up...' : 'Back up now'}
          </Btn>
        )} />

      {notice && (
        <Note icon={notice.tone === 'error' ? AlertTriangle : CheckCircle2} tone={notice.tone === 'error' ? 'danger' : 'accent'}>
          <span role="status">{notice.message}</span>
        </Note>
      )}

      <ErrorState message={error} onRetry={refresh} />

      {!loading && snapshots.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Backups kept" value={fmtNum(snapshots.length)} icon={Archive}
            sub={`${fmtNum(stats.nightly)} nightly, ${fmtNum(stats.manual)} manual`}
            onClick={() => { setTab('backups'); setKindView('all') }} active={tab === 'backups' && kindView === 'all'} />
          <StatTile label="Newest backup" value={fmtRelative(newest?.taken_at)} icon={Clock}
            sub={fmtDateTime(newest?.taken_at)} tone={stale ? 'warning' : 'accent'}
            onClick={() => { setTab('backups'); openDetail(newest.id) }} />
          <StatTile label="Rows in newest" value={fmtNum(newest?.total_rows)} icon={Database}
            sub="What a recovery can draw on today" />
          <StatTile label="Tables covered" value={fmtNum(newest?.table_count)}
            sub="In the newest backup" onClick={() => setTab('trends')} active={tab === 'trends'} />
        </div>
      )}

      {!loading && <AttentionList items={attention} />}

      <TabBar ariaLabel="Backups view" value={tab} onChange={setTab} tabs={[
        { key: 'backups', label: 'Stored backups', icon: Archive, count: snapshots.length },
        { key: 'trends', label: 'Trends', icon: BarChart3 },
      ]} />

      {tab === 'trends' ? (
        loading ? <LoadingState label="Loading your backups" /> : snapshots.length === 0 ? (
          <Panel><EmptyState icon={BarChart3} title="Nothing to chart yet" reason={error ? 'The backup list could not be read.' : 'Charts appear once the first backup exists.'} /></Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader icon={History} title="Rows saved per backup"
                subtitle="One point per stored backup, oldest to newest. A sudden drop means a table shrank before it was saved." />
              <TrendChart labels={trend.labels} series={[{ label: 'Rows saved', values: trend.values }]}
                summary={`Rows saved across ${trend.values.length} backups`} emptyText="No dated backups to plot." />
            </Panel>
            <Panel>
              <PanelHeader icon={BarChart3} title="Rows per table in the newest backup"
                subtitle={newest ? `Taken ${fmtDateTime(newest.taken_at)}.` : undefined} />
              <BarsChart bars={tableBars} valueFormat={(v) => `${fmtNum(v)} rows`}
                summary={tableBars.map(b => `${b.label}: ${b.value}`).join(', ')}
                emptyText="No per-table detail was recorded for the newest backup." />
            </Panel>
          </div>
        )
      ) : (
        <Panel flush>
          <div className="px-4 pt-4">
            <PanelHeader icon={Archive} title={(
              <span className="inline-flex items-center">
                Stored backups
                <InfoDot text="Each row is one snapshot: a complete saved copy of your core tables taken at a point in time. Open a snapshot to see how many rows were saved per table." />
              </span>
            )} subtitle="Open a backup to preview what it could recover, table by table."
              actions={snapshots.length > 0 ? (
                <>
                  <Segmented role="group" ariaLabel="Backup type" value={kindView} onChange={setKindView} options={[
                    { key: 'all', label: 'All', count: snapshots.length },
                    { key: 'nightly', label: 'Nightly', count: stats.nightly },
                    { key: 'manual', label: 'Manual', count: stats.manual },
                  ]} />
                  <ExportButtons rows={sortedSnapshots} columns={SNAPSHOT_COLUMNS} title="TyrePulse Backups" />
                </>
              ) : null} />
          </div>

          {loading ? (
            <div className="px-4 pb-4"><LoadingState label="Loading your backups" /></div>
          ) : snapshots.length === 0 ? (
            !error && (
              <EmptyState icon={Clock} title="No backups yet"
                reason="The first nightly backup runs tonight, or you can make one now."
                action={<Btn variant="primary" icon={Plus} onClick={handleBackupNow} busy={backingUp}>Back up now</Btn>} />
            )
          ) : shownSnapshots.length === 0 ? (
            <EmptyState icon={Archive} title="No backups of this type" reason="Switch to All to see every stored backup." />
          ) : (
            <div className="px-4 pb-4">
              <Table>
                <THead>
                  <Th sortKey="taken_at" sort={sort} onSort={onSort}>Taken</Th>
                  <Th sortKey="kind" sort={sort} onSort={onSort}>Kind</Th>
                  <Th sortKey="table_count" sort={sort} onSort={onSort} align="right">Tables</Th>
                  <Th sortKey="total_rows" sort={sort} onSort={onSort} align="right">Rows</Th>
                  <Th>By</Th>
                  <Th align="right">Detail</Th>
                </THead>
                <tbody>
                  {pager.pageRows.map(snap => {
                    const nightly = isNightly(snap.reason)
                    return (
                      <Tr key={snap.id} onClick={() => openDetail(snap.id)} ariaLabel={`Open backup taken ${fmtDateTime(snap.taken_at)}`}>
                        <Td nowrap>
                          <span className="text-sm text-gray-200">{fmtDateTime(snap.taken_at)}</span>
                          <span className="block text-[10px] text-gray-400">{fmtRelative(snap.taken_at)}</span>
                        </Td>
                        <Td><Badge tone={nightly ? 'info' : 'accent'}>{nightly ? 'Nightly' : 'Manual'}</Badge></Td>
                        <Td align="right" nowrap><span className="tabular-nums text-gray-300">{fmtNum(snap.table_count)}</span></Td>
                        <Td align="right" nowrap>
                          <span className="tabular-nums text-gray-300">{fmtNum(snap.total_rows)}</span>
                          <span className="sr-only">{fmtNum(snap.table_count)} tables, {fmtNum(snap.total_rows)} rows saved</span>
                        </Td>
                        <Td><span className="text-gray-400">{snap.taken_by || 'System'}</span></Td>
                        <Td align="right">
                          <Btn size="xs" variant="quiet" icon={ChevronRight} onClick={(e) => { e.stopPropagation(); openDetail(snap.id) }}>
                            {fmtNum(snap.table_count)} tables, {fmtNum(snap.total_rows)} rows saved
                          </Btn>
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
              <Pager pager={pager} label="backups" />
            </div>
          )}
        </Panel>
      )}

      <Note icon={ShieldCheck}>
        Backups are read-only safety copies. Recovering rows only re-adds records that were deleted after a backup was
        taken. It never overwrites, edits or removes anything that is currently in your live data.
      </Note>

      <Modal open={!!detail} onClose={() => { setDetailId(null); closePreview() }} width="max-w-3xl"
        title={detail ? `Backup taken ${fmtDateTime(detail.taken_at)}` : ''}
        subtitle={detail ? `${isNightly(detail.reason) ? 'Nightly' : 'Manual'} | ${fmtNum(detail.table_count)} tables | ${fmtNum(detail.total_rows)} rows${detail.taken_by ? ` | by ${detail.taken_by}` : ''}` : undefined}
        footer={<Btn onClick={() => { setDetailId(null); closePreview() }}>Close</Btn>}>
        {detail && (Array.isArray(detail.tables) && detail.tables.length > 0 ? (
          <div className="space-y-3">
            <Table>
              <THead>
                <Th>Table</Th>
                <Th align="right">Rows saved</Th>
                <Th align="right">Recovery</Th>
              </THead>
              <tbody>
                {detail.tables.map(t => {
                  const key = `${detail.id}:${t.table_name}`
                  const active = previewKey === key
                  return (
                    <Tr key={key} className={active ? 'bg-orange-950/20' : ''}>
                      <Td><span className="inline-flex items-center gap-2"><Database size={11} className="text-gray-600" aria-hidden="true" /><Code>{t.table_name}</Code></span></Td>
                      <Td align="right"><span className="tabular-nums text-gray-400">{fmtNum(t.row_count)}</span></Td>
                      <Td align="right">
                        <Btn size="xs" variant="quiet" icon={RotateCcw}
                          onClick={() => (active ? closePreview() : handlePreview(detail.id, t.table_name))}
                          title="Check what could be safely recovered from this backup, without changing anything">
                          {active ? 'Hide' : 'Preview restore'}
                        </Btn>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
            {previewKey && previewKey.startsWith(`${detail.id}:`) && (
              <div className="rounded-lg border border-gray-800 bg-gray-900/30 p-3">
                <p className="text-[11px] text-gray-500 mb-2">Restore preview for <Code>{previewKey.slice(detail.id.length + 1)}</Code></p>
                <SafetyPanel
                  loading={previewLoading}
                  error={previewError}
                  preview={preview}
                  onRetry={() => handlePreview(detail.id, previewKey.slice(detail.id.length + 1))}
                  onRecover={() => openConfirm(detail.id, previewKey.slice(detail.id.length + 1), detail.taken_at, preview?.missing_rows)}
                />
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-gray-500 py-2">No per-table detail was recorded for this snapshot.</p>
        ))}
      </Modal>

      <Modal open={!!confirmTarget} onClose={closeConfirm} width="max-w-lg"
        title="Recover missing rows" subtitle={confirmTarget?.table}
        footer={(
          <>
            <Btn onClick={closeConfirm} disabled={restoring}>Cancel</Btn>
            <Btn variant="good" icon={RotateCcw} onClick={handleRestore} busy={restoring}
              disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD}>
              {restoring ? 'Recovering...' : 'Recover missing rows'}
            </Btn>
          </>
        )}>
        {confirmTarget && (
          <div className="space-y-4">
            <Note icon={CheckCircle2} tone="accent">
              This is safe and <strong>non destructive</strong>. It only re-adds rows that were deleted after this
              backup was taken. Nothing currently in your live data will be changed, overwritten or removed.
            </Note>
            <p className="text-sm text-gray-300">
              About to recover <strong className="text-gray-100">{fmtNum(confirmTarget.missing)}</strong> missing row
              {Number(confirmTarget.missing) === 1 ? '' : 's'} into
              {' '}<Code>{confirmTarget.table}</Code>
              {' '}from the backup taken {fmtDateTime(confirmTarget.taken_at)}.
            </p>
            <label className="block">
              <span className="text-xs text-gray-400">Type <span className="font-mono font-semibold text-gray-100">{CONFIRM_WORD}</span> to confirm</span>
              <input
                autoFocus
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRestore() }}
                placeholder={CONFIRM_WORD}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-600 font-mono tracking-wider"
              />
            </label>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ── Sub components ─────────────────────────────────────────────────────────────

/**
 * The plain-English restore safety panel shown under a table when its
 * "Preview restore" is expanded.
 */
function SafetyPanel({ loading, error, preview, onRecover, onRetry }) {
  if (loading) {
    return <p role="status" className="text-xs text-gray-400 flex items-center gap-2"><RefreshCw size={12} className="animate-spin" /> Checking what can be safely recovered...</p>
  }
  if (error) return <ErrorState message={error} onRetry={onRetry} />
  if (!preview) return null

  const snapshotRows = Number(preview.snapshot_rows) || 0
  const currentRows  = Number(preview.current_rows) || 0
  const missing      = Number(preview.missing_rows) || 0
  const newer        = Number(preview.newer_current_rows) || 0

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-300 leading-relaxed">
        This backup has <strong className="text-gray-100">{fmtNum(snapshotRows)}</strong> rows, your live table has
        {' '}<strong className="text-gray-100">{fmtNum(currentRows)}</strong> rows.
        {' '}
        <strong className={missing > 0 ? 'text-amber-300' : 'text-gray-100'}>{fmtNum(missing)}</strong> row
        {missing === 1 ? ' is' : 's are'} in the backup but missing now
        {' '}(these can be safely recovered), and
        {' '}<strong className="text-gray-100">{fmtNum(newer)}</strong> live row{newer === 1 ? ' is' : 's are'} newer than
        this backup (these will NOT be touched).
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatTile label="In backup" value={fmtNum(snapshotRows)} sub="Saved in this snapshot" />
        <StatTile label="Live now" value={fmtNum(currentRows)} sub="In the table right now" />
        <StatTile label="Recoverable" value={fmtNum(missing)} tone={missing > 0 ? 'warning' : 'good'} sub="Deleted since, can be re-added" />
        <StatTile label="Kept as-is" value={fmtNum(newer)} tone="good" sub="Newer rows, never touched" />
      </div>

      {missing > 0 ? (
        <Btn variant="good" icon={RotateCcw} onClick={onRecover}>Recover missing rows</Btn>
      ) : (
        <p className="text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 size={13} /> Nothing to recover. Every row in this backup is still present in your live data.
        </p>
      )}
    </div>
  )
}
