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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, RefreshCw, ShieldAlert, Info, Plus, Download, ChevronRight,
  ChevronDown, Database, RotateCcw, CheckCircle2, AlertTriangle, ShieldCheck,
  Clock, BarChart3, History,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Code, Btn, Table, THead, Th, Tr, Td,
  LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { TrendChart, BarsChart } from '../components/ui/charts'
import {
  createBackupSnapshot, listBackupSnapshots, restorePreview, restoreMissing,
} from '../../lib/api/backups'
import { exportToExcel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

const REFRESH_MS = 120_000
const CONFIRM_WORD = 'RESTORE'

// ── Small building blocks ─────────────────────────────────────────────────────

/** Plain-English tooltip marker sitting next to a technical term. */
function InfoDot({ text }) {
  return (
    <span className="inline-flex align-middle ml-1 text-gray-600 hover:text-gray-300 cursor-help" title={text}>
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
  return n != null && Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0'
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

  const [expanded, setExpanded]   = useState(() => new Set())   // snapshot ids

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
      if (mountedRef.current) setSnapshots(Array.isArray(rows) ? rows : [])
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

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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

  function openConfirm(snapshotId, table, taken_at, missing) {
    setConfirmTarget({ snapshotId, table, taken_at, missing })
    setConfirmText('')
  }

  function closeConfirm() {
    if (restoring) return
    setConfirmTarget(null)
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
      // Refresh the preview so the counts reflect the recovery.
      handlePreview(target.snapshotId, target.table)
      load()
    } catch (err) {
      flash(toUserMessage(err, 'The recovery did not complete. No data was changed.'), 'error')
    } finally {
      if (mountedRef.current) setRestoring(false)
    }
  }

  async function handleExport() {
    const rows = snapshots.map(s => ({
      taken_at: fmtDateTime(s.taken_at),
      kind: isNightly(s.reason) ? 'Nightly (automatic)' : 'Manual',
      reason: s.reason ?? '',
      taken_by: s.taken_by ?? '',
      table_count: s.table_count ?? 0,
      total_rows: s.total_rows ?? 0,
    }))
    try {
      await exportToExcel(
        rows,
        ['taken_at', 'kind', 'reason', 'taken_by', 'table_count', 'total_rows'],
        ['Taken at', 'Kind', 'Reason', 'Taken by', 'Tables', 'Total rows'],
        'TyrePulse Backups',
        'Backups',
        { title: 'TyrePulse Backups' },
      )
    } catch (err) {
      flash(toUserMessage(err, 'Could not export. Please try again.'), 'error')
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

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><Archive size={18} className="text-orange-400" /> Automated Backups</h1>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Automatic nightly backups of your core data. Kept 30 days.
            <InfoDot text="Retention: how long a backup is stored before it is automatically deleted. Backups older than 30 days are removed to save space." />
            {' '}You can also make a backup now.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn icon={RefreshCw} onClick={refresh} busy={refreshing} disabled={loading}>Refresh</Btn>
          <Btn icon={Download} onClick={handleExport} disabled={snapshots.length === 0}
            title="Download the list of backups as an Excel spreadsheet">Export</Btn>
          <Btn variant="primary" icon={Plus} onClick={handleBackupNow} busy={backingUp}
            title="Take a snapshot of your core data right now, in addition to the automatic nightly one">
            {backingUp ? 'Backing up' : 'Back up now'}
          </Btn>
        </div>
      </header>

      {notice && (
        <Note icon={notice.tone === 'error' ? AlertTriangle : CheckCircle2} tone={notice.tone === 'error' ? 'danger' : 'accent'}>
          <span role="status">{notice.message}</span>
        </Note>
      )}

      <ErrorState message={error} onRetry={refresh} />

      {!loading && snapshots.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Backups kept" value={fmtNum(snapshots.length)} icon={Archive}
            sub={`${fmtNum(stats.nightly)} nightly, ${fmtNum(stats.manual)} manual`} />
          <StatTile label="Newest backup" value={fmtRelative(newest?.taken_at)} icon={Clock}
            sub={fmtDateTime(newest?.taken_at)} tone="accent" />
          <StatTile label="Rows in newest" value={fmtNum(newest?.total_rows)} icon={Database}
            sub="What a recovery can draw on today" />
          <StatTile label="Tables covered" value={fmtNum(newest?.table_count)}
            sub="In the newest backup" />
        </div>
      )}

      {!loading && snapshots.length > 0 && (
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
      )}

      <Panel flush>
        <div className="px-4 pt-4">
          <PanelHeader icon={Archive} title={(
            <span className="inline-flex items-center">
              Stored backups
              <InfoDot text="Each row is one snapshot: a complete saved copy of your core tables taken at a point in time. Expand a snapshot to see how many rows were saved per table." />
            </span>
          )} subtitle="Expand a backup to preview what it could recover, table by table." />
        </div>

        {loading ? (
          <div className="px-4 pb-4"><LoadingState label="Loading your backups" /></div>
        ) : snapshots.length === 0 ? (
          !error && (
            <EmptyState icon={Clock} title="No backups yet"
              reason="The first nightly backup runs tonight, or you can make one now."
              action={<Btn variant="primary" icon={Plus} onClick={handleBackupNow} busy={backingUp}>Back up now</Btn>} />
          )
        ) : (
          <div className="divide-y divide-gray-800/70 border-t border-gray-800">
            {snapshots.map(snap => {
              const isOpen = expanded.has(snap.id)
              const nightly = isNightly(snap.reason)
              return (
                <div key={snap.id}>
                  <button onClick={() => toggleExpand(snap.id)} aria-expanded={isOpen}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-900/60 transition-colors">
                    <span className="text-gray-500">
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-200">{fmtDateTime(snap.taken_at)}</span>
                        <Badge tone={nightly ? 'info' : 'accent'}>{nightly ? 'Nightly' : 'Manual'}</Badge>
                        <span className="text-[10px] text-gray-600">{fmtRelative(snap.taken_at)}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                        {fmtNum(snap.table_count)} tables, {fmtNum(snap.total_rows)} rows saved
                        {snap.taken_by ? ` | by ${snap.taken_by}` : ''}
                      </p>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4">
                      {Array.isArray(snap.tables) && snap.tables.length > 0 ? (
                        <Table>
                          <THead>
                            <Th>Table</Th>
                            <Th align="right">Rows saved</Th>
                            <Th align="right">Recovery</Th>
                          </THead>
                          <tbody>
                            {snap.tables.map(t => {
                              const key = `${snap.id}:${t.table_name}`
                              const active = previewKey === key
                              return (
                                <Fragment key={key}>
                                  <Tr>
                                    <Td><span className="inline-flex items-center gap-2"><Database size={11} className="text-gray-600" /><Code>{t.table_name}</Code></span></Td>
                                    <Td align="right"><span className="tabular-nums text-gray-400">{fmtNum(t.row_count)}</span></Td>
                                    <Td align="right">
                                      <Btn size="xs" variant="quiet" icon={RotateCcw}
                                        onClick={() => (active ? closePreview() : handlePreview(snap.id, t.table_name))}
                                        title="Check what could be safely recovered from this backup, without changing anything">
                                        {active ? 'Hide' : 'Preview restore'}
                                      </Btn>
                                    </Td>
                                  </Tr>
                                  {active && (
                                    <tr>
                                      <td colSpan={3} className="px-3 py-3 bg-gray-900/30">
                                        <SafetyPanel
                                          loading={previewLoading}
                                          error={previewError}
                                          preview={preview}
                                          onRetry={() => handlePreview(snap.id, t.table_name)}
                                          onRecover={() => openConfirm(snap.id, t.table_name, snap.taken_at, preview?.missing_rows)}
                                        />
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              )
                            })}
                          </tbody>
                        </Table>
                      ) : (
                        <p className="text-[11px] text-gray-600 py-2">
                          No per-table detail was recorded for this snapshot.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <Note icon={ShieldCheck}>
        Backups are read-only safety copies. Recovering rows only re-adds records that were deleted after a backup was
        taken. It never overwrites, edits or removes anything that is currently in your live data.
      </Note>

      <Modal open={!!confirmTarget} onClose={closeConfirm} width="max-w-lg"
        title="Recover missing rows" subtitle={confirmTarget?.table}
        footer={(
          <>
            <Btn onClick={closeConfirm} disabled={restoring}>Cancel</Btn>
            <Btn variant="good" icon={RotateCcw} onClick={handleRestore} busy={restoring}
              disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD}>
              {restoring ? 'Recovering' : 'Recover missing rows'}
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
    return <p className="text-xs text-gray-500 flex items-center gap-2"><RefreshCw size={12} className="animate-spin" /> Checking what can be safely recovered...</p>
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
