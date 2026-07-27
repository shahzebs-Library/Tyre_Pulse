/**
 * ConsoleImportHistory - super-admin view of every data load (V364).
 *
 * Two tabs, because there are genuinely two kinds of import and only one of them
 * was ever recorded:
 *
 *   Uploads   - files loaded through the app. import_files already stored a sha256
 *               of every file, so a repeat upload of identical content is flagged
 *               with the date it was first imported. That warning existed in the
 *               data all along and was never shown to anyone.
 *   Activity  - loads done straight through the Supabase Table Editor, which write
 *               no upload record at all. Reconstructed from insertion-time clusters
 *               on the destination table. Two clusters of the SAME row count within
 *               a few minutes is the signature of a resent chunk, and those are
 *               called out in amber.
 *
 * Read-only. No raw SQL, no em/en dashes. Super-admin only (the whole /console is gated).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  History, RefreshCw, AlertTriangle, FileUp, Loader2, Info, Activity, Download, CopyX,
  CalendarDays,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  listImportHistory, listUnloggedImports, flagSuspiciousClusters, importRowSummary,
} from '../../lib/api/importHistory'
import { listDuplicateTargets } from '../../lib/api/duplicateControl'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import UploadCoveragePanel from './importHistory/UploadCoveragePanel'

const fmtNum = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A')
const fmtTime = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 16).replace('T', ' ')
}
const fmtBytes = (n) => {
  const b = Number(n)
  if (!Number.isFinite(b) || b <= 0) return 'N/A'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

export default function ConsoleImportHistory() {
  const [tab, setTab] = useState('uploads')
  const [rows, setRows] = useState([])
  const [targets, setTargets] = useState([])
  const [targetKey, setTargetKey] = useState('parts_expense')
  const [clusters, setClusters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [h, t] = await Promise.all([listImportHistory(200), listDuplicateTargets()])
      setRows(h); setTargets(t)
    } catch (e) {
      setError(e?.message || 'Could not load import history.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadClusters = useCallback(async (key) => {
    setError('')
    try {
      setClusters(await listUnloggedImports(key, 80))
    } catch (e) {
      setError(e?.message || 'Could not load import activity.')
      setClusters([])
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'activity') loadClusters(targetKey) }, [tab, targetKey, loadClusters])

  const flagged = useMemo(() => flagSuspiciousClusters(clusters), [clusters])
  const suspiciousCount = useMemo(() => flagged.filter((c) => c.suspicious).length, [flagged])
  const reuploads = useMemo(() => rows.filter((r) => r.reupload_of), [rows])

  function downloadUploads() {
    const out = rows.map((r) => ({
      file: r.filename,
      module: r.module || 'N/A',
      country: r.country || 'N/A',
      uploaded_at: fmtTime(r.uploaded_at),
      size: fmtBytes(r.size_bytes),
      rows_read: r.total_rows ?? 0,
      rows_imported: r.imported_rows ?? 0,
      duplicates_flagged: r.duplicate_rows ?? 0,
      errors: r.error_rows ?? 0,
      status: r.import_status || r.approval_status || 'N/A',
      same_file_imported_before: r.reupload_of ? fmtTime(r.reupload_first_seen) : 'No',
    }))
    const keys = Object.keys(out[0] || { file: '' })
    exportToExcel(out, keys, keys.map((k) => k.replace(/_/g, ' ')),
      reportFileName('TyrePulse Import History'))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <History size={18} className="text-orange-400" /> Import History
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Every data load, who did it, and whether the same file has been imported before.
          </p>
        </div>
        <div className="flex gap-2">
          {tab === 'uploads' && rows.length > 0 && (
            <button onClick={downloadUploads}
              className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white flex items-center gap-2">
              <Download size={13} /> Excel
            </button>
          )}
          <button onClick={load} disabled={loading}
            className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white flex items-center gap-2 disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 border-b border-gray-800">
        {[['uploads', 'Uploads', FileUp], ['activity', 'Load activity', Activity],
          ['coverage', 'Daily coverage', CalendarDays]].map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
              tab === k ? 'border-orange-500 text-orange-300' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-950/40 border border-red-800/50">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Coverage loads its own data, so it renders before the shared spinner. */}
      {tab === 'coverage' ? (
        <UploadCoveragePanel />
      ) : loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-7 h-7 text-orange-500 animate-spin" />
        </div>
      ) : tab === 'uploads' ? (
        <>
          {reuploads.length > 0 && (
            <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-amber-950/30 border border-amber-800/40">
              <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200">
                {reuploads.length === 1
                  ? '1 file has been uploaded more than once.'
                  : `${reuploads.length} files have been uploaded more than once.`}
                {' '}They are marked below. Check{' '}
                <Link to="/console/duplicates" className="underline hover:text-amber-100">Duplicate Control</Link>
                {' '}if any of them added rows.
              </p>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-16 border border-gray-800 rounded-xl">
              No uploads recorded yet. Files loaded straight through the Supabase Table Editor
              do not appear here; see the Load activity tab.
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-black/30 text-[10px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">File</th>
                      <th className="px-3 py-2.5 font-semibold">Module</th>
                      <th className="px-3 py-2.5 font-semibold">Country</th>
                      <th className="px-3 py-2.5 font-semibold">When</th>
                      <th className="px-3 py-2.5 font-semibold">Rows</th>
                      <th className="px-3 py-2.5 font-semibold">Repeat upload</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {rows.map((r, i) => (
                      <tr key={`${r.file_id}-${r.batch_id || i}`} className="hover:bg-black/20">
                        <td className="px-4 py-2.5">
                          <p className="text-xs text-gray-200 truncate max-w-[260px]" title={r.filename}>
                            {r.filename || 'N/A'}
                          </p>
                          <p className="text-[10px] text-gray-600">{fmtBytes(r.size_bytes)}</p>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-gray-400">{r.module || 'N/A'}</td>
                        <td className="px-3 py-2.5 text-[11px] text-gray-400">{r.country || 'N/A'}</td>
                        <td className="px-3 py-2.5 text-[11px] text-gray-400 whitespace-nowrap">
                          {fmtTime(r.uploaded_at)}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-[11px] text-gray-300">{importRowSummary(r)}</p>
                          {Number(r.duplicate_rows) > 0 && (
                            <p className="text-[10px] text-amber-400">
                              {fmtNum(r.duplicate_rows)} flagged as duplicate
                            </p>
                          )}
                          {Number(r.error_rows) > 0 && (
                            <p className="text-[10px] text-red-400">{fmtNum(r.error_rows)} errors</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.reupload_of ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold text-amber-300 border border-amber-800/50 bg-amber-900/20 whitespace-nowrap">
                              Same file as {fmtTime(r.reupload_first_seen)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-600">First time</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-sky-950/30 border border-sky-800/40">
            <Info size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-sky-200">
              Loads done straight through the Supabase Table Editor leave no upload record, so
              this rebuilds them from when the rows actually landed. Two loads of the SAME row
              count within a few minutes usually means one upload was sent twice.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {targets.map((t) => (
              <button key={t.key} onClick={() => setTargetKey(t.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] border ${
                  targetKey === t.key ? 'bg-orange-600 border-orange-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {suspiciousCount > 0 && (
            <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-amber-950/30 border border-amber-800/40">
              <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200">
                {suspiciousCount} load(s) here match another load of the same size.{' '}
                <Link to="/console/duplicates" className="underline hover:text-amber-100">
                  Check Duplicate Control
                </Link>{' '}to see whether they actually added duplicate rows.
              </p>
            </div>
          )}

          {flagged.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-16 border border-gray-800 rounded-xl">
              No load activity recorded for this table.
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <div className="max-h-[520px] overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="bg-black/30 text-[10px] uppercase tracking-wide text-gray-500 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Landed</th>
                      <th className="px-3 py-2.5 font-semibold">Country</th>
                      <th className="px-3 py-2.5 font-semibold">Rows</th>
                      <th className="px-3 py-2.5 font-semibold">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {flagged.map((c, i) => (
                      <tr key={i} className={c.suspicious ? 'bg-amber-950/10' : 'hover:bg-black/20'}>
                        <td className="px-4 py-2 text-[11px] text-gray-300 whitespace-nowrap">
                          {fmtTime(c.inserted_at)}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-gray-400">{c.country || 'N/A'}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-200">{fmtNum(c.rows)}</td>
                        <td className="px-3 py-2">
                          {c.suspicious ? (
                            <span className="text-[10px] text-amber-300 flex items-center gap-1">
                              <CopyX size={10} /> same size as {fmtTime(c.pairedWith)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-600">Looks normal</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
