/**
 * ConsoleBackups - super-admin Automated Backups console (Admin Control Module 4).
 *
 * A pure console page (navy + orange theme, useConsoleAuth for the admin gate).
 * It surfaces the automated nightly database backups in plain English so a non
 * technical owner can operate them:
 *   1. Explainer + "Back up now" (on-demand snapshot)
 *   2. Snapshot list (nightly / manual badge, table + row counts, expandable)
 *   3. Per table "Preview restore" -> a plain-English safety panel
 *   4. "Recover missing rows" gated behind a typed RESTORE confirmation modal
 *      (NON DESTRUCTIVE: only re-adds deleted rows, never overwrites)
 *   5. Excel export of the snapshot list
 *
 * Every technical term (snapshot, restore, retention) carries a small (i)
 * plain-English tooltip. No raw SQL is ever shown. Strings avoid em/en dashes,
 * arrows, curly quotes and middle dots.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, RefreshCw, ShieldAlert, Info, Plus, Download, ChevronRight,
  ChevronDown, Database, RotateCcw, CheckCircle2, AlertTriangle, ShieldCheck,
  X, Clock,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  createBackupSnapshot, listBackupSnapshots, restorePreview, restoreMissing,
} from '../../lib/api/backups'
import { exportToExcel } from '../../lib/exportUtils'

const REFRESH_MS = 120_000

// ── Small building blocks ─────────────────────────────────────────────────────

/** Plain-English tooltip marker sitting next to a technical term. */
function InfoDot({ text }) {
  return (
    <span className="inline-flex align-middle ml-1 text-gray-600 hover:text-gray-300 cursor-help" title={text}>
      <Info size={11} />
    </span>
  )
}

/** Lightweight toast, auto-clears after a few seconds. */
function Toast({ toast, onClose }) {
  if (!toast) return null
  const tone = toast.tone === 'error'
    ? 'border-red-700/50 bg-red-950/80 text-red-200'
    : 'border-emerald-700/50 bg-emerald-950/80 text-emerald-200'
  return (
    <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl ${tone}`}>
      {toast.tone === 'error' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      <span>{toast.message}</span>
      <button onClick={onClose} className="ml-1 text-gray-400 hover:text-white"><X size={13} /></button>
    </div>
  )
}

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString()
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
  const [toast, setToast]         = useState(null)

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
  const toastTimer = useRef(null)

  const flash = useCallback((message, tone = 'ok') => {
    setToast({ message, tone })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => {
      if (mountedRef.current) setToast(null)
    }, 4500)
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const rows = await listBackupSnapshots(60)
      if (mountedRef.current) setSnapshots(Array.isArray(rows) ? rows : [])
    } catch (err) {
      if (mountedRef.current) setError(err?.message || 'Could not load your backups')
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
      if (toastTimer.current) clearTimeout(toastTimer.current)
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
      flash(err?.message || 'Could not create the backup. Please try again.', 'error')
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
      if (mountedRef.current) setPreviewError(err?.message || 'Could not build the restore preview.')
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

  async function handleRestore() {
    if (!confirmTarget || confirmText.trim().toUpperCase() !== 'RESTORE') return
    setRestoring(true)
    try {
      const res = await restoreMissing(confirmTarget.snapshotId, confirmTarget.table)
      flash(`Recovered ${fmtNum(res?.restored)} missing row${Number(res?.restored) === 1 ? '' : 's'} into ${confirmTarget.table}.`)
      setConfirmTarget(null)
      setConfirmText('')
      // Refresh the preview so the counts reflect the recovery.
      handlePreview(confirmTarget.snapshotId, confirmTarget.table)
      load()
    } catch (err) {
      flash(err?.message || 'The recovery did not complete. No data was changed.', 'error')
    } finally {
      if (mountedRef.current) setRestoring(false)
    }
  }

  function handleExport() {
    const rows = snapshots.map(s => ({
      taken_at: fmtDateTime(s.taken_at),
      kind: isNightly(s.reason) ? 'Nightly (automatic)' : 'Manual',
      reason: s.reason ?? '',
      taken_by: s.taken_by ?? '',
      table_count: s.table_count ?? 0,
      total_rows: s.total_rows ?? 0,
    }))
    exportToExcel(
      rows,
      ['taken_at', 'kind', 'reason', 'taken_by', 'table_count', 'total_rows'],
      ['Taken at', 'Kind', 'Reason', 'Taken by', 'Tables', 'Total rows'],
      'TyrePulse Backups',
      'Backups',
      { title: 'TyrePulse Backups' },
    )
  }

  const totalRowsAcross = useMemo(
    () => snapshots.reduce((s, x) => s + (Number(x.total_rows) || 0), 0),
    [snapshots],
  )

  if (!admin) {
    return (
      <div className="max-w-md mx-auto mt-16 rounded-xl border border-red-800/40 bg-red-950/20 p-8 text-center">
        <ShieldAlert size={22} className="text-red-400 mx-auto mb-3" />
        <h1 className="text-lg font-bold text-white">Restricted</h1>
        <p className="text-sm text-gray-400 mt-1">Automated Backups are reserved for system administrators.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Archive size={18} className="text-orange-400" /> Automated Backups
          </h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Automatic nightly backups of your core data. Kept 30 days.
            <InfoDot text="Retention: how long a backup is stored before it is automatically deleted. Backups older than 30 days are removed to save space." />
            {' '}You can also make a backup now.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={refreshing || loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={handleExport} disabled={snapshots.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Download the list of backups as an Excel spreadsheet">
            <Download size={12} /> Export
          </button>
          <button onClick={handleBackupNow} disabled={backingUp}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-orange-600 text-white hover:bg-orange-500 text-xs font-semibold transition-colors disabled:opacity-50"
            title="Take a snapshot of your core data right now, in addition to the automatic nightly one">
            {backingUp ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
            {backingUp ? 'Backing up...' : 'Back up now'}
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {!loading && snapshots.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SummaryCard label="Backups kept" value={fmtNum(snapshots.length)}
            tip="Snapshot: a saved copy of your data at a moment in time. This is how many are currently stored." />
          <SummaryCard label="Newest backup" value={fmtRelative(snapshots[0]?.taken_at)}
            sub={fmtDateTime(snapshots[0]?.taken_at)}
            tip="When the most recent backup was taken. Nightly backups run automatically overnight." />
          <SummaryCard label="Rows protected" value={fmtNum(totalRowsAcross)}
            tip="The total number of data rows saved across all stored backups." />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-3 text-sm text-red-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={refresh} className="text-xs text-orange-400 hover:text-orange-300 whitespace-nowrap">Try again</button>
        </div>
      )}

      {/* Snapshot list */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="flex items-center gap-2 p-4 border-b border-gray-800">
          <Archive size={14} className="text-gray-500" />
          <h3 className="text-sm font-semibold text-white flex items-center">
            Stored backups
            <InfoDot text="Each row is one snapshot: a complete saved copy of your core tables taken at a point in time. Expand a snapshot to see how many rows were saved per table." />
          </h3>
        </div>

        {loading ? (
          <p className="p-8 text-xs text-gray-600 text-center">Loading your backups...</p>
        ) : snapshots.length === 0 ? (
          <div className="p-10 text-center">
            <Clock size={22} className="text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No backups yet - the first nightly backup runs tonight, or make one now.</p>
            <button onClick={handleBackupNow} disabled={backingUp}
              className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-orange-600 text-white hover:bg-orange-500 text-xs font-semibold transition-colors disabled:opacity-50">
              {backingUp ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
              {backingUp ? 'Backing up...' : 'Back up now'}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/70">
            {snapshots.map(snap => {
              const isOpen = expanded.has(snap.id)
              const nightly = isNightly(snap.reason)
              return (
                <div key={snap.id}>
                  {/* Snapshot header row */}
                  <button onClick={() => toggleExpand(snap.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/30 transition-colors">
                    <span className="text-gray-500">
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white">{fmtDateTime(snap.taken_at)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${
                          nightly
                            ? 'text-blue-300 bg-blue-900/30 border-blue-700/40'
                            : 'text-orange-300 bg-orange-900/30 border-orange-700/40'
                        }`}>
                          {nightly ? 'Nightly' : 'Manual'}
                        </span>
                        <span className="text-[10px] text-gray-600">{fmtRelative(snap.taken_at)}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                        {fmtNum(snap.table_count)} tables, {fmtNum(snap.total_rows)} rows saved
                        {snap.taken_by ? ` | by ${snap.taken_by}` : ''}
                      </p>
                    </div>
                  </button>

                  {/* Expanded per-table list */}
                  {isOpen && (
                    <div className="px-4 pb-4">
                      {Array.isArray(snap.tables) && snap.tables.length > 0 ? (
                        <div className="rounded-lg border border-gray-800 overflow-hidden">
                          <table className="w-full text-left">
                            <thead>
                              <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-gray-800 bg-gray-900/60">
                                <th className="px-3 py-2 font-semibold">Table</th>
                                <th className="px-3 py-2 font-semibold text-right">Rows saved</th>
                                <th className="px-3 py-2 font-semibold text-right">Recovery</th>
                              </tr>
                            </thead>
                            <tbody>
                              {snap.tables.map(t => {
                                const key = `${snap.id}:${t.table_name}`
                                const active = previewKey === key
                                return (
                                  <Fragment key={key}>
                                    <tr className="border-b border-gray-800/50 hover:bg-gray-800/20">
                                      <td className="px-3 py-2 text-xs text-gray-300 flex items-center gap-2">
                                        <Database size={11} className="text-gray-600 flex-shrink-0" />
                                        <span className="font-mono">{t.table_name}</span>
                                      </td>
                                      <td className="px-3 py-2 text-xs text-gray-400 text-right">{fmtNum(t.row_count)}</td>
                                      <td className="px-3 py-2 text-right">
                                        <button onClick={() => active ? closePreview() : handlePreview(snap.id, t.table_name)}
                                          className="text-[11px] text-orange-400 hover:text-orange-300 inline-flex items-center gap-1"
                                          title="Check what could be safely recovered from this backup, without changing anything">
                                          <RotateCcw size={11} /> {active ? 'Hide' : 'Preview restore'}
                                        </button>
                                      </td>
                                    </tr>
                                    {active && (
                                      <tr>
                                        <td colSpan={3} className="px-3 py-3 bg-gray-950/40">
                                          <SafetyPanel
                                            loading={previewLoading}
                                            error={previewError}
                                            preview={preview}
                                            onRecover={() => openConfirm(snap.id, t.table_name, snap.taken_at, preview?.missing_rows)}
                                          />
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
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
      </div>

      <p className="text-[11px] text-gray-600">
        Backups are read-only safety copies. Recovering rows only re-adds records that were deleted after a backup was
        taken. It never overwrites, edits or removes anything that is currently in your live data.
      </p>

      {/* Typed-confirmation restore modal */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-900/30 border border-emerald-700/40 flex items-center justify-center flex-shrink-0">
                <ShieldCheck size={18} className="text-emerald-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white">Recover missing rows</h3>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{confirmTarget.table}</p>
              </div>
              <button onClick={() => setConfirmTarget(null)} className="ml-auto text-gray-500 hover:text-white"><X size={16} /></button>
            </div>

            <div className="mt-4 rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3">
              <p className="text-xs text-emerald-200 flex items-start gap-2">
                <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" />
                <span>
                  This is safe and <strong>non destructive</strong>. It only re-adds rows that were deleted after this
                  backup was taken. Nothing currently in your live data will be changed, overwritten or removed.
                </span>
              </p>
            </div>

            <p className="text-sm text-gray-300 mt-4">
              About to recover <strong className="text-white">{fmtNum(confirmTarget.missing)}</strong> missing row
              {Number(confirmTarget.missing) === 1 ? '' : 's'} into
              {' '}<span className="font-mono text-white">{confirmTarget.table}</span>
              {' '}from the backup taken {fmtDateTime(confirmTarget.taken_at)}.
            </p>

            <label className="block mt-4">
              <span className="text-xs text-gray-400">Type <span className="font-mono font-bold text-white">RESTORE</span> to confirm</span>
              <input
                autoFocus
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRestore() }}
                placeholder="RESTORE"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-600 font-mono tracking-wider"
              />
            </label>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmTarget(null)} disabled={restoring}
                className="px-3.5 py-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleRestore}
                disabled={restoring || confirmText.trim().toUpperCase() !== 'RESTORE'}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {restoring ? <RefreshCw size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                {restoring ? 'Recovering...' : 'Recover missing rows'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

// ── Sub components ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, tip }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 flex items-center">
        {label}{tip && <InfoDot text={tip} />}
      </p>
      <p className="text-lg font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  )
}

/**
 * The plain-English restore safety panel shown under a table when its
 * "Preview restore" is expanded.
 */
function SafetyPanel({ loading, error, preview, onRecover }) {
  if (loading) {
    return <p className="text-xs text-gray-500 flex items-center gap-2"><RefreshCw size={12} className="animate-spin" /> Checking what can be safely recovered...</p>
  }
  if (error) {
    return <p className="text-xs text-red-300 flex items-center gap-2"><AlertTriangle size={12} /> {error}</p>
  }
  if (!preview) return null

  const snapshotRows = Number(preview.snapshot_rows) || 0
  const currentRows  = Number(preview.current_rows) || 0
  const missing      = Number(preview.missing_rows) || 0
  const newer        = Number(preview.newer_current_rows) || 0

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-300 leading-relaxed">
        This backup has <strong className="text-white">{fmtNum(snapshotRows)}</strong> rows, your live table has
        {' '}<strong className="text-white">{fmtNum(currentRows)}</strong> rows.
        {' '}
        <strong className={missing > 0 ? 'text-amber-300' : 'text-white'}>{fmtNum(missing)}</strong> row
        {missing === 1 ? ' is' : 's are'} in the backup but missing now
        {' '}(these can be safely recovered), and
        {' '}<strong className="text-white">{fmtNum(newer)}</strong> live row{newer === 1 ? ' is' : 's are'} newer than
        this backup (these will NOT be touched).
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MiniStat label="In backup" value={fmtNum(snapshotRows)} tip="How many rows this snapshot saved for this table." tone="gray" />
        <MiniStat label="Live now" value={fmtNum(currentRows)} tip="How many rows are in the table right now." tone="gray" />
        <MiniStat label="Recoverable" value={fmtNum(missing)} tip="Rows that were in the backup but have since been deleted. These can be safely re-added." tone={missing > 0 ? 'amber' : 'green'} />
        <MiniStat label="Kept as-is" value={fmtNum(newer)} tip="Newer live rows that did not exist in the backup. Recovery never touches these." tone="green" />
      </div>

      {missing > 0 ? (
        <button onClick={onRecover}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 text-xs font-semibold border border-emerald-700/40 transition-colors">
          <RotateCcw size={12} /> Recover missing rows
        </button>
      ) : (
        <p className="text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 size={13} /> Nothing to recover. Every row in this backup is still present in your live data.
        </p>
      )}
    </div>
  )
}

function MiniStat({ label, value, tip, tone }) {
  const text = tone === 'amber' ? 'text-amber-300' : tone === 'green' ? 'text-emerald-300' : 'text-gray-200'
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-2.5">
      <p className="text-[9px] uppercase tracking-wider text-gray-600 flex items-center">
        {label}{tip && <InfoDot text={tip} />}
      </p>
      <p className={`text-sm font-bold mt-0.5 ${text}`}>{value}</p>
    </div>
  )
}
