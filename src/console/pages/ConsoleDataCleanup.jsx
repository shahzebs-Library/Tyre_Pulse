/**
 * ConsoleDataCleanup - super-admin "clean old data" console (V289).
 *
 * Controlled deletion of OLD records, one target at a time, in plain English:
 *   1. A table of cleanup targets (logs + business data) with total rows and the
 *      oldest / newest date present.
 *   2. Pick a target, choose "older than" (age preset or a date), Preview the
 *      exact count that would be removed.
 *   3. Delete behind a typed CLEAN confirmation. The server takes a recovery
 *      SNAPSHOT first (recoverable from Console -> Backups) and logs every run.
 *
 * Business targets (accidents / tyres / inspections / work orders) are flagged
 * red with an extra warning; log targets are the safe default. No raw SQL, no
 * em/en dashes. Super-admin only (the whole /console is gated).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Trash2, RefreshCw, AlertTriangle, Info, Database, ShieldCheck, X, Loader2,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listCleanupTargets, previewCleanup, runCleanup, monthsAgoISO, AGE_PRESETS,
} from '../../lib/api/dataCleanup'

const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 10)
}
const fmtNum = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A')

export default function ConsoleDataCleanup() {
  const { logAction } = useConsoleAuth()
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selected, setSelected] = useState(null)   // target object
  const [before, setBefore] = useState(monthsAgoISO(24))
  const [preview, setPreview] = useState(null)      // { count } | null
  const [previewing, setPreviewing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)        // { deleted, snapshot } | null

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setTargets(await listCleanupTargets())
    } catch (e) {
      setError(e?.message || 'Could not load cleanup targets.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function selectTarget(t) {
    setSelected(t); setPreview(null); setResult(null); setError('')
    setBefore(monthsAgoISO(24))
  }

  async function doPreview() {
    if (!selected) return
    setPreviewing(true); setPreview(null); setResult(null); setError('')
    try {
      setPreview(await previewCleanup(selected.key, before))
    } catch (e) {
      setError(e?.message || 'Could not preview.')
    } finally {
      setPreviewing(false)
    }
  }

  async function doRun() {
    if (!selected) return
    setRunning(true); setError('')
    try {
      const res = await runCleanup(selected.key, before)
      setResult(res)
      setConfirmOpen(false); setConfirmText('')
      logAction?.('data_cleanup', null, selected.key, { before, deleted: res?.deleted })
      // Refresh totals so the table reflects the deletion.
      load()
      setPreview(null)
    } catch (e) {
      setError(e?.message || 'Could not run the cleanup.')
    } finally {
      setRunning(false)
    }
  }

  const isBusiness = selected?.kind === 'business'

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Trash2 size={18} className="text-orange-400" /> Data Cleanup
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Delete old records you no longer need. A recovery snapshot is taken automatically before anything is removed.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-sky-950/30 border border-sky-800/40">
        <ShieldCheck size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-200">Safe by design: pick a target, preview the exact number of old records, then confirm. The system snapshots the data first so a cleanup can be recovered from Backups, and every run is logged.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-950/40 border border-red-800/50">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-7 h-7 text-orange-500 animate-spin" />
        </div>
      ) : targets.length === 0 ? (
        <div className="text-center text-sm text-gray-500 py-16 border border-gray-800 rounded-xl">
          No cleanup targets are available.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Targets table */}
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-800 text-xs font-semibold text-gray-300 flex items-center gap-2">
              <Database size={13} className="text-gray-500" /> Targets
            </div>
            <div className="divide-y divide-gray-800/60 max-h-[520px] overflow-y-auto">
              {targets.map((t) => {
                const active = selected?.key === t.key
                return (
                  <button key={t.key} onClick={() => selectTarget(t)}
                    className={`w-full text-left px-4 py-3 transition-colors ${active ? 'bg-orange-900/20' : 'hover:bg-black/20'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-200">{t.label}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                        t.kind === 'business'
                          ? 'text-red-300 border-red-800/50 bg-red-900/20'
                          : 'text-gray-400 border-gray-700 bg-gray-800/50'
                      }`}>{t.kind === 'business' ? 'Business data' : 'Logs'}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                      {fmtNum(t.total)} rows · {fmtDate(t.oldest)} to {fmtDate(t.newest)}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Cleanup panel */}
          <div className="rounded-xl border border-gray-800 p-4">
            {!selected ? (
              <div className="text-center text-sm text-gray-600 py-16">Select a target to clean up.</div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">{selected.label}</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">{fmtNum(selected.total)} rows total, from {fmtDate(selected.oldest)} to {fmtDate(selected.newest)}.</p>
                </div>

                {isBusiness && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-950/40 border border-red-800/50">
                    <AlertTriangle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-300">This is operational business data. Deleting removes those records permanently (recoverable only from the snapshot). Only clean data you are sure is no longer needed.</p>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 mb-1.5">Delete records older than</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {AGE_PRESETS.map((p) => {
                      const d = monthsAgoISO(p.months)
                      const on = before === d
                      return (
                        <button key={p.months} onClick={() => { setBefore(d); setPreview(null); setResult(null) }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] border ${on ? 'bg-orange-600 border-orange-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'}`}>
                          {p.label}
                        </button>
                      )
                    })}
                  </div>
                  <input type="date" value={before} max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => { setBefore(e.target.value); setPreview(null); setResult(null) }}
                    className="w-full h-9 bg-gray-800/80 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-orange-500" />
                  <p className="text-[10px] text-gray-600 mt-1 flex items-center gap-1">
                    <Info size={10} /> Cutoff {fmtDate(before)}. Records dated before this are removed; newer records are kept.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={doPreview} disabled={previewing || !before}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-200 hover:text-white text-xs border border-gray-700 disabled:opacity-50">
                    {previewing ? <Loader2 size={12} className="animate-spin" /> : <Info size={12} />} Preview
                  </button>
                  <button onClick={() => { setConfirmOpen(true); setConfirmText('') }}
                    disabled={!preview || Number(preview.count) === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg,#dc2626,#ef4444)' }}>
                    <Trash2 size={12} /> Delete old records
                  </button>
                </div>

                {preview && (
                  <div className="px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700">
                    <p className="text-xs text-gray-200">
                      <span className="font-bold text-white">{fmtNum(preview.count)}</span> record(s) are older than {fmtDate(before)} and would be deleted.
                    </p>
                    {Number(preview.count) === 0 && <p className="text-[10px] text-gray-500 mt-0.5">Nothing to clean for this cutoff.</p>}
                  </div>
                )}

                {result && (
                  <div className="px-3 py-2 rounded-lg bg-green-950/40 border border-green-800/50">
                    <p className="text-xs text-green-300">
                      Deleted {fmtNum(result.deleted)} old record(s).{result.snapshot ? ' A recovery snapshot was saved to Backups.' : ''}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {confirmOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={() => !running && setConfirmOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-[#0d0d12] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle size={15} className="text-red-400" /> Confirm cleanup
              </h3>
              <button onClick={() => !running && setConfirmOpen(false)} className="text-gray-500 hover:text-white"><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              This will permanently delete <span className="font-bold text-white">{fmtNum(preview?.count)}</span> {selected.label.toLowerCase()} dated before <span className="font-bold text-white">{fmtDate(before)}</span>. A recovery snapshot is saved to Backups first.
            </p>
            <p className="text-[11px] text-gray-500 mt-3 mb-1.5">Type <span className="font-mono text-orange-300">CLEAN</span> to confirm.</p>
            <input autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              className="w-full h-9 bg-gray-800/80 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-red-500" />
            <div className="flex items-center gap-2 mt-4">
              <button onClick={() => setConfirmOpen(false)} disabled={running}
                className="flex-1 px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white text-xs border border-gray-700">Cancel</button>
              <button onClick={doRun} disabled={running || confirmText.trim().toUpperCase() !== 'CLEAN'}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#dc2626,#ef4444)' }}>
                {running ? <><Loader2 size={12} className="animate-spin" /> Cleaning...</> : <><Trash2 size={12} /> Delete permanently</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
