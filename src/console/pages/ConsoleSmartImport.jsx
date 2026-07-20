/**
 * ConsoleSmartImport - super-admin "just upload a file, it figures out the rest".
 *
 * Drop any Excel/CSV export and the console:
 *   1. Reads every sheet (parseWorkbook).
 *   2. AUTO-DETECTS which module the columns belong to - fleet / tyre / stock /
 *      accident / inspection / work order / warranty / gate pass / supplier /
 *      driver (detectModule). The operator can override the guess.
 *   3. AUTO-MAPS each source column to the right field (suggestMapping), with a
 *      confidence badge; every mapping is editable and unmatched columns are
 *      preserved, never dropped.
 *   4. Shows a transformed + validated PREVIEW with ready / needs-review / error
 *      counts (transformRow + validateRow) so nothing bad is committed blind.
 *   5. Commits into the live table through the SAME proven staging pipeline the
 *      Data Intake Center uses (createBatch -> saveSheets -> stageRows ->
 *      approveBatch -> commitBatch) - org + country RLS enforced server-side.
 *
 * This is a new SURFACE over the single import engine, not a second engine: it
 * reuses src/lib/import and src/lib/api/imports verbatim. Super-admin only (the
 * whole /console is gated). No raw SQL, no em/en dashes; every error is sanitized
 * via toUserMessage so no database or endpoint internals ever reach the screen.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  UploadCloud, Wand2, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2,
  Database, ArrowRight, RefreshCw, X, ShieldCheck, Info,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  parseWorkbook, detectModule, rankModules, suggestMapping, transformRow,
  validateRow, rowFingerprint, MODULE_FIELDS, MODULE_TABLES,
} from '../../lib/import'
import * as imports from '../../lib/api/imports'
import { toUserMessage } from '../../lib/safeError'

const MODULE_LABELS = {
  fleet: 'Vehicles / Fleet', tyre: 'Tyres', stock: 'Stock / Inventory',
  accident: 'Accidents / Incidents', inspection: 'Inspections', workorder: 'Work Orders',
  warranty: 'Warranty Claims', gatepass: 'Gate Passes', supplier: 'Suppliers', driver: 'Drivers',
}
const moduleLabel = (m) => MODULE_LABELS[m] || m
const fmtNum = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')
const PREVIEW_ROWS = 12

function confBadge(conf) {
  if (conf >= 90) return { text: 'Auto', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }
  if (conf >= 60) return { text: `${conf}%`, cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
  if (conf > 0) return { text: 'Review', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' }
  return { text: 'Custom', cls: 'bg-gray-500/15 text-gray-300 border-gray-500/40' }
}

export default function ConsoleSmartImport() {
  const { logAction } = useConsoleAuth()
  const fileRef = useRef(null)

  const [phase, setPhase] = useState('idle') // idle | parsing | ready | committing | done
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)  // { sheets }
  const [sheetIdx, setSheetIdx] = useState(0)
  const [module, setModule] = useState('')
  const [ranked, setRanked] = useState([])
  const [confident, setConfident] = useState(false)
  const [mapping, setMapping] = useState([])  // [{ sourceHeader, target, confidence, action }]
  const [country, setCountry] = useState('')
  const [result, setResult] = useState(null)  // { inserted, skipped, failed, ... }
  const [progress, setProgress] = useState(null)

  const sheet = parsed?.sheets?.[sheetIdx] || null
  const fields = module ? (MODULE_FIELDS[module] || []) : []

  // Re-run auto-mapping whenever the chosen sheet or module changes.
  const remap = useCallback((sh, mod) => {
    if (!sh || !mod) { setMapping([]); return }
    try {
      const plan = suggestMapping({ columns: sh.columns, module: mod, sampleRows: (sh.rows || []).slice(0, 20) })
      setMapping(plan)
    } catch (e) {
      setError(toUserMessage(e, 'Could not map the columns.'))
      setMapping([])
    }
  }, [])

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhase('parsing'); setError(''); setResult(null); setProgress(null)
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const p = await parseWorkbook(buf)
      const sheets = (p?.sheets || []).filter((s) => (s.rows?.length || 0) > 0)
      if (!sheets.length) throw new Error('This file has no data rows to import.')
      const first = sheets[0]
      const det = detectModule(first.columns, (first.rows || []).slice(0, 20))
      setParsed({ sheets })
      setSheetIdx(0)
      setRanked(det.ranked)
      setConfident(det.confident)
      const mod = det.module || 'fleet'
      setModule(mod)
      remap(first, mod)
      setPhase('ready')
    } catch (err) {
      setError(toUserMessage(err, 'Could not read this file. Use an Excel (.xlsx) or CSV export.'))
      setPhase('idle')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function pickSheet(i) {
    const sh = parsed?.sheets?.[i]
    if (!sh) return
    setSheetIdx(i)
    const det = detectModule(sh.columns, (sh.rows || []).slice(0, 20))
    setRanked(det.ranked); setConfident(det.confident)
    const mod = det.module || module || 'fleet'
    setModule(mod); remap(sh, mod)
    setResult(null)
  }

  function changeModule(mod) {
    setModule(mod); remap(sheet, mod); setResult(null)
  }

  function setTarget(sourceHeader, target) {
    setMapping((prev) => prev.map((m) =>
      m.sourceHeader === sourceHeader
        ? { ...m, target: target || null, action: target ? 'suggest' : 'preserve_custom' }
        : m))
  }

  // Transformed + validated preview over the whole sheet (counts) + first rows.
  const previewInfo = useMemo(() => {
    if (!sheet || !module || !mapping.length) return null
    let ready = 0, warning = 0, errorRows = 0
    const sampleOut = []
    const activeTargets = mapping.filter((m) => m.target).map((m) => m.target)
    for (let i = 0; i < sheet.rows.length; i++) {
      const raw = sheet.rows[i]
      let t
      try {
        const { transformed } = transformRow(raw, mapping, { module })
        t = transformed
      } catch { t = {} }
      const v = validateRow(t, module)
      if (v.status === 'error') errorRows++
      else if (v.status === 'warning') warning++
      else ready++
      if (sampleOut.length < PREVIEW_ROWS) sampleOut.push({ t, status: v.status })
    }
    return { ready, warning, errorRows, total: sheet.rows.length, activeTargets, sampleOut }
  }, [sheet, module, mapping])

  const requiredMissing = useMemo(() => {
    if (!module || !previewInfo) return []
    const have = new Set(previewInfo.activeTargets)
    return fields.filter((f) => f.required && !have.has(f.key)).map((f) => f.label)
  }, [module, previewInfo, fields])

  async function commit() {
    if (!sheet || !module) return
    setPhase('committing'); setError(''); setResult(null); setProgress(null)
    try {
      const scopeCountry = country.trim() || null
      const batchId = await imports.createBatch({ country: scopeCountry, module, sheet: sheet.name, sourceSystem: 'console-smart-import' })
      await imports.saveSheets(batchId, [{ ...sheet, selected: true }])

      const staged = sheet.rows.map((raw, i) => {
        let mapped = {}, transformed = {}, custom = {}
        try {
          const r = transformRow(raw, mapping, { module })
          mapped = r.mapped; transformed = r.transformed; custom = r.custom
        } catch { /* keep empty; validation will flag it */ }
        const v = validateRow(transformed, module)
        return {
          sheetName: sheet.name, sourceRowNo: i + 1, raw, mapped, transformed, custom,
          validationStatus: v.status, action: 'insert', fingerprint: rowFingerprint(raw),
        }
      })

      await imports.stageRows(batchId, staged)
      const counts = staged.reduce((a, r) => {
        a.total++
        if (r.validationStatus === 'error') a.error++
        else if (r.validationStatus === 'warning') a.warning++
        else a.ready++
        return a
      }, { total: 0, ready: 0, warning: 0, error: 0, duplicate: 0, conflict: 0 })
      await imports.setBatchCounts(batchId, counts)
      await imports.approveBatch(batchId)

      const res = await imports.commitBatch(batchId, { onProgress: (p) => setProgress({ ...p }) })
      setResult({ ...res, batchId, module, table: MODULE_TABLES[module] })
      setPhase('done')
      try { await logAction?.('smart_import_commit', batchId, 'import_batch', { module, inserted: res.inserted, failed: res.failed }) } catch { /* audit best-effort */ }
    } catch (err) {
      setError(toUserMessage(err, 'The import could not be completed. Please check the file and try again.'))
      setPhase('ready')
    }
  }

  function reset() {
    setPhase('idle'); setParsed(null); setMapping([]); setModule(''); setRanked([])
    setResult(null); setProgress(null); setError(''); setFileName('')
  }

  return (
    <div className="p-6 max-w-6xl mx-auto text-gray-100">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
          <Wand2 className="text-orange-400" size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold">Smart Import</h1>
          <p className="text-sm text-gray-400">Upload any Excel or CSV file. The console detects what it is, maps the columns, and loads it.</p>
        </div>
        {phase !== 'idle' && (
          <button onClick={reset} className="ml-auto inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800">
            <RefreshCw size={14} /> Start over
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {/* Upload */}
      {phase === 'idle' && (
        <label className="mt-6 block cursor-pointer rounded-2xl border-2 border-dashed border-gray-700 hover:border-orange-500/50 bg-gray-900/40 p-12 text-center transition">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden" onChange={onFile} />
          <UploadCloud className="mx-auto text-orange-400" size={40} />
          <div className="mt-3 font-semibold">Choose a file or drag it here</div>
          <div className="text-sm text-gray-400 mt-1">Excel (.xlsx, .xls) or CSV. Vehicles, tyres, stock, accidents, inspections, work orders, warranty, gate passes, suppliers, drivers.</div>
        </label>
      )}

      {phase === 'parsing' && (
        <div className="mt-10 flex items-center justify-center gap-2 text-gray-300">
          <Loader2 className="animate-spin" size={18} /> Reading and analysing the file...
        </div>
      )}

      {/* Ready: detection + mapping + preview */}
      {(phase === 'ready' || phase === 'committing' || phase === 'done') && sheet && (
        <div className="mt-6 space-y-5">
          {/* File + sheet + detection */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <FileSpreadsheet className="text-orange-400" size={18} />
              <span className="font-medium">{fileName}</span>
              <span className="text-xs text-gray-400">{fmtNum(sheet.rows.length)} rows | {sheet.columns.length} columns</span>
              {parsed.sheets.length > 1 && (
                <select value={sheetIdx} onChange={(e) => pickSheet(Number(e.target.value))}
                  className="ml-auto bg-gray-800 border border-gray-700 rounded-lg text-sm px-2 py-1">
                  {parsed.sheets.map((s, i) => <option key={i} value={i}>{s.name} ({fmtNum(s.rows.length)})</option>)}
                </select>
              )}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-wide text-gray-400">Detected as</label>
                <div className="mt-1 flex items-center gap-2">
                  <select value={module} onChange={(e) => changeModule(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg text-sm px-3 py-2">
                    {rankModules(sheet.columns, (sheet.rows || []).slice(0, 20)).map((r) => (
                      <option key={r.module} value={r.module}>{moduleLabel(r.module)} ({r.score}% match)</option>
                    ))}
                  </select>
                  {confident
                    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 size={14} /> confident</span>
                    : <span className="inline-flex items-center gap-1 text-xs text-amber-300"><Info size={14} /> please confirm</span>}
                </div>
                <p className="mt-1 text-xs text-gray-500">Loads into <span className="text-gray-300 font-mono">{MODULE_TABLES[module]}</span></p>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-gray-400">Country (optional)</label>
                <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Leave blank to use your default scope"
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg text-sm px-3 py-2" />
                <p className="mt-1 text-xs text-gray-500">Stamps every imported row with this country for data isolation.</p>
              </div>
            </div>
          </div>

          {/* Mapping table */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
              <Wand2 size={16} className="text-orange-400" />
              <span className="font-medium text-sm">Column mapping</span>
              <span className="text-xs text-gray-500">auto-filled - adjust any row</span>
            </div>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-gray-500 bg-gray-900/70 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2">File column</th>
                    <th className="text-left px-4 py-2">Maps to</th>
                    <th className="text-left px-4 py-2 w-24">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.map((m) => {
                    const b = confBadge(m.confidence)
                    return (
                      <tr key={m.sourceHeader} className="border-t border-gray-800/70">
                        <td className="px-4 py-2 text-gray-300">{m.sourceHeader}</td>
                        <td className="px-4 py-2">
                          <select value={m.target || ''} onChange={(e) => setTarget(m.sourceHeader, e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-sm px-2 py-1.5">
                            <option value="">Keep as-is (not imported)</option>
                            {fields.map((f) => (
                              <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-block text-xs px-2 py-0.5 rounded border ${b.cls}`}>{b.text}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Preview + counts */}
          {previewInfo && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="inline-flex items-center gap-1.5 text-emerald-300"><CheckCircle2 size={15} /> {fmtNum(previewInfo.ready)} ready</span>
                <span className="inline-flex items-center gap-1.5 text-amber-300"><Info size={15} /> {fmtNum(previewInfo.warning)} needs review</span>
                <span className="inline-flex items-center gap-1.5 text-red-300"><AlertTriangle size={15} /> {fmtNum(previewInfo.errorRows)} would fail</span>
              </div>
              {requiredMissing.length > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>Required field(s) not yet mapped: <strong>{requiredMissing.join(', ')}</strong>. Rows without them will be skipped.</span>
                </div>
              )}
              <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-gray-800">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 bg-gray-900/70 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-1.5 w-16">Status</th>
                      {previewInfo.activeTargets.slice(0, 6).map((t) => (
                        <th key={t} className="text-left px-3 py-1.5">{(fields.find((f) => f.key === t) || {}).label || t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewInfo.sampleOut.map((row, i) => (
                      <tr key={i} className="border-t border-gray-800/70">
                        <td className="px-3 py-1.5">
                          {row.status === 'error'
                            ? <span className="text-red-300">fail</span>
                            : row.status === 'warning' ? <span className="text-amber-300">review</span> : <span className="text-emerald-300">ok</span>}
                        </td>
                        {previewInfo.activeTargets.slice(0, 6).map((t) => (
                          <td key={t} className="px-3 py-1.5 text-gray-300 truncate max-w-[160px]">{row.t[t] == null ? '' : String(row.t[t])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Commit */}
          {phase !== 'done' && (
            <div className="flex items-center gap-3">
              <button onClick={commit} disabled={phase === 'committing' || !previewInfo || previewInfo.ready + previewInfo.warning === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium disabled:opacity-50">
                {phase === 'committing'
                  ? <><Loader2 className="animate-spin" size={16} /> Importing{progress ? ` ${fmtNum(progress.inserted)} saved...` : '...'}</>
                  : <><Database size={16} /> Import {fmtNum((previewInfo?.ready || 0) + (previewInfo?.warning || 0))} rows <ArrowRight size={15} /></>}
              </button>
              <span className="text-xs text-gray-500">Rows that would fail are skipped automatically.</span>
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {phase === 'done' && result && (
        <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
          <div className="flex items-center gap-2 text-emerald-300 font-semibold">
            <ShieldCheck size={18} /> Import complete
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Inserted" value={result.inserted} tone="emerald" />
            <Stat label="Merged" value={result.merged} tone="sky" />
            <Stat label="Skipped" value={result.skipped} tone="amber" />
            <Stat label="Failed" value={result.failed} tone="red" />
          </div>
          <p className="mt-3 text-xs text-gray-400">Loaded into <span className="font-mono text-gray-300">{result.table}</span> ({moduleLabel(result.module)}). It is now live across the app. This run is recorded in the audit trail and can be reversed from the Data Intake history.</p>
          <button onClick={reset} className="mt-4 inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700">
            <UploadCloud size={15} /> Import another file
          </button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  const tones = {
    emerald: 'text-emerald-300', sky: 'text-sky-300', amber: 'text-amber-300', red: 'text-red-300',
  }
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${tones[tone] || 'text-gray-200'}`}>{fmtNum(value || 0)}</div>
    </div>
  )
}
