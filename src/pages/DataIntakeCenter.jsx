import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  UploadCloud, FileSpreadsheet, Wand2, ShieldCheck, CheckCircle2, AlertTriangle,
  Loader2, ArrowRight, ArrowLeft, RefreshCw, Database, Save, Bookmark, Paperclip, FileArchive,
  Trash2, RotateCcw,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  parseWorkbook, sha256OfArrayBuffer, suggestMapping, transformRow, validateRow,
  classifyDuplicates, naturalKey, rowFingerprint, MODULE_FIELDS,
  extractZip, matchAttachment, buildMatchRows,
} from '../lib/import'
import * as imports from '../lib/api/imports'

const MODULES = [
  { key: 'fleet', label: 'Fleet / Assets' },
  { key: 'tyre', label: 'Tyre Lifecycle' },
  { key: 'stock', label: 'Stock' },
  { key: 'accident', label: 'Accidents / Insurance' },
  { key: 'inspection', label: 'Inspections' },
  { key: 'workorder', label: 'Work Orders' },
  { key: 'warranty', label: 'Warranty Claims' },
  { key: 'gatepass', label: 'Gate Pass' },
  { key: 'supplier', label: 'Suppliers' },
  { key: 'driver', label: 'Drivers' },
]
const ELEVATED = ['admin', 'manager', 'director']
const STEPS = ['Upload', 'Map columns', 'Validate', 'Approve & Commit']

function statusColor(s) {
  return s === 'ready' ? 'text-green-400 bg-green-900/30'
    : s === 'warning' ? 'text-amber-400 bg-amber-900/30'
    : s === 'error' ? 'text-red-400 bg-red-900/30'
    : 'text-gray-400 bg-gray-800'
}

export default function DataIntakeCenter() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const isElevated = ELEVATED.includes(String(profile?.role || '').toLowerCase())
  const countryReady = activeCountry && activeCountry !== 'All'

  const [searchParams] = useSearchParams()
  const initialModule = (() => {
    const requested = String(searchParams.get('module') || '').toLowerCase()
    return MODULES.some((m) => m.key === requested) ? requested : 'fleet'
  })()

  const [step, setStep] = useState(0)
  const [module, setModule] = useState(initialModule)
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [sheetIdx, setSheetIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [batchId, setBatchId] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [mapping, setMapping] = useState([])
  const [annotated, setAnnotated] = useState([])
  const [counts, setCounts] = useState(null)
  const [result, setResult] = useState(null)
  const [recent, setRecent] = useState([])

  // Accident-only: evidence ZIP ingestion (Phase 3). Each item tracks one file
  // through extract → match → upload → record, with a per-file status/error so a
  // single failure never aborts the package.
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachItems, setAttachItems] = useState([]) // { name, sizeBytes, matchedBy, status, error }
  const [attachWarnings, setAttachWarnings] = useState([])
  const [attachDone, setAttachDone] = useState(false)

  const sheet = parsed?.sheets?.[sheetIdx] || null
  const targetOptions = useMemo(
    () => (MODULE_FIELDS[module] || []).map((f) => ({ key: f.key, label: f.label || f.key, required: f.required })),
    [module],
  )

  const loadRecent = useCallback(async () => {
    try { setRecent(await imports.listBatches({ country: activeCountry, limit: 8 })) } catch { /* non-blocking */ }
  }, [activeCountry])
  useEffect(() => { loadRecent() }, [loadRecent])

  // Warn before an accidental full-page reload/close while an import is in
  // progress (state lives in memory and cannot survive a hard navigation).
  useEffect(() => {
    const dirty = step > 0 && !result
    if (!dirty) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [step, result])

  const [rowBusyId, setRowBusyId] = useState(null)

  // Delete an abandoned/staged batch (cascades to its rows). A committed batch
  // is reversed instead, so the live rows it produced are also removed.
  async function deleteRecent(b) {
    if (rowBusyId) return
    const committed = b.import_status === 'committed'
    const msg = committed
      ? `Reverse the committed ${b.module} import? This removes the ${b.imported_rows || 0} rows it added to the live ${b.module} table.`
      : `Delete the ${b.module} import (${b.import_status}, ${b.total_rows || 0} rows)? This permanently removes the staged batch.`
    if (!window.confirm(msg)) return
    setRowBusyId(b.id); setError('')
    try {
      if (committed) await imports.reverseBatch(b.id)
      else await imports.deleteBatch(b.id)
      await loadRecent()
    } catch (err) {
      console.error('[DataIntakeCenter] delete/reverse batch failed:', err)
      setError(err?.message || 'Could not remove the batch.')
    } finally { setRowBusyId(null) }
  }

  function reset() {
    setStep(0); setFile(null); setParsed(null); setSheetIdx(0); setBatchId(null)
    setMapping([]); setAnnotated([]); setCounts(null); setResult(null); setError(''); setProfiles([])
    setAttachItems([]); setAttachWarnings([]); setAttachDone(false); setAttachBusy(false)
  }

  // ── Step 1: parse a chosen file ──────────────────────────────────────────────
  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setError(''); setBusy(true)
    try {
      const buf = await f.arrayBuffer()
      const wb = await parseWorkbook(buf)
      setFile(f); setParsed(wb); setSheetIdx(0)
    } catch (err) {
      setError(err?.message || 'Could not read the file.')
    } finally { setBusy(false) }
  }

  async function startBatch() {
    if (!sheet) return
    setError(''); setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const sha = await sha256OfArrayBuffer(buf)
      const { fileId } = await imports.uploadOriginalFile(file, { module, country: activeCountry, sha256: sha })
      const id = await imports.createBatch({
        fileId, module, country: activeCountry, sheet: sheet.name,
        headerRowDetected: sheet.headerRow, headerRowConfirmed: sheet.headerRow,
      })
      await imports.saveSheets(id, parsed.sheets)
      setBatchId(id)
      // seed mapping suggestions
      setMapping(suggestMapping({ columns: sheet.columns, module, sampleRows: sheet.rows.slice(0, 20) }))
      // offer reusable mapping profiles for this module/country (non-blocking)
      imports.listProfiles({ module, country: activeCountry }).then(setProfiles).catch(() => setProfiles([]))
      setStep(1)
    } catch (err) {
      setError(err?.message || 'Could not start the import.')
    } finally { setBusy(false) }
  }

  function setTarget(sourceHeader, target) {
    setMapping((m) => m.map((row) => row.sourceHeader === sourceHeader
      ? { ...row, target: target || null, action: target ? 'mapped' : 'preserve_custom' }
      : row))
  }

  // Apply a saved mapping profile: re-map source headers to its remembered targets.
  async function applyProfile(profileId) {
    if (!profileId) return
    setError(''); setBusy(true)
    try {
      const rules = await imports.getProfileRules(profileId)
      const byHeader = new Map(rules.map((r) => [r.source_header, r.target_field]))
      setMapping((m) => m.map((row) => {
        if (!byHeader.has(row.sourceHeader)) return row
        const target = byHeader.get(row.sourceHeader) || null
        return { ...row, target, action: target ? 'mapped' : 'preserve_custom', confidence: 100 }
      }))
      imports.touchProfile(profileId).catch(() => {})
    } catch (err) {
      setError(err?.message || 'Could not apply the profile.')
    } finally { setBusy(false) }
  }

  // Save the current column mapping as a reusable profile for this module/country.
  async function saveAsProfile() {
    const name = window.prompt('Save this mapping as a reusable profile. Name:')
    if (!name?.trim()) return
    setError(''); setBusy(true)
    try {
      const rules = mapping
        .filter((m) => m.target)
        .map((m) => ({ sourceHeader: m.sourceHeader, target: m.target, confidence: m.confidence ?? 100 }))
      await imports.saveProfile({ name: name.trim(), module, country: activeCountry }, rules)
      const next = await imports.listProfiles({ module, country: activeCountry })
      setProfiles(next)
    } catch (err) {
      setError(err?.message || 'Could not save the profile.')
    } finally { setBusy(false) }
  }

  // ── Step 3: validate + classify (in-batch + live-table dedup) ────────────────
  async function runValidation() {
    const rows = sheet.rows.map((raw, i) => {
      const { mapped, transformed, custom } = transformRow(raw, mapping, { module })
      const v = validateRow(transformed, module)
      return {
        sourceRowNo: i + 1, raw, mapped, transformed, custom,
        validationStatus: v.status, issues: v.issues || [],
        fingerprint: rowFingerprint(raw),
      }
    })

    // In-batch duplicate classification (rows that repeat within this file).
    const withDup = classifyDuplicates(rows.map((r) => r.transformed), module)
    rows.forEach((r, i) => { r.dupStatus = withDup[i]?.dup_status || 'none' })

    // Live-table duplicate detection (V47). Fault-tolerant: if the RPC is not yet
    // deployed or errors, fall back to in-batch dedup only — never break the wizard.
    let liveKeys = null
    try {
      liveKeys = await imports.existingKeys({ module, country: activeCountry })
    } catch (err) {
      console.warn('Live duplicate detection unavailable; using in-batch dedup only.', err)
    }

    // Default action: reject errors; insert everything else. A row whose natural
    // key already exists live is flagged duplicate and switched to 'skip' so the
    // commit never creates a second live row (conflicts are left for the operator).
    rows.forEach((r) => {
      let action = r.validationStatus === 'error' ? 'reject' : 'insert'
      let isLiveDup = false
      if (liveKeys && r.validationStatus !== 'error') {
        const key = naturalKey(r.transformed, module)
        if (key && liveKeys.has(key)) {
          isLiveDup = true
          if (r.dupStatus !== 'conflict') r.dupStatus = 'duplicate'
          action = 'skip'
        }
      }
      r.liveDuplicate = isLiveDup
      r.action = action
    })

    const c = { total: rows.length, ready: 0, warning: 0, error: 0, duplicate: 0, conflict: 0, liveDuplicate: 0 }
    rows.forEach((r) => {
      c[r.validationStatus] = (c[r.validationStatus] || 0) + 1
      if (r.dupStatus === 'duplicate') c.duplicate++
      if (r.dupStatus === 'conflict') c.conflict++
      if (r.liveDuplicate) c.liveDuplicate++
    })
    setAnnotated(rows); setCounts(c)
  }
  useEffect(() => { if (step === 2 && sheet && mapping.length) runValidation() }, [step]) // eslint-disable-line

  async function stageAll() {
    setError(''); setBusy(true)
    try {
      await imports.stageRows(batchId, annotated.map((r) => ({
        sheetName: sheet.name, sourceRowNo: r.sourceRowNo, raw: r.raw, mapped: r.mapped,
        transformed: r.transformed, custom: r.custom, validationStatus: r.validationStatus,
        dupStatus: r.dupStatus, action: r.action ?? (r.validationStatus === 'error' ? 'reject' : 'insert'),
        fingerprint: r.fingerprint,
      })))
      await imports.setBatchCounts(batchId, counts)
      setStep(3)
    } catch (err) {
      setError(err?.message || 'Could not stage the rows.')
    } finally { setBusy(false) }
  }

  // ── Accident-only: evidence ZIP ingestion (Phase 3) ──────────────────────────
  // Extract a .zip client-side, match each file to a staged accident row by
  // claim/police/asset no, upload each privately, then record the matches.
  // Fully fault-tolerant: a single file failure is surfaced per-row, never aborts.
  async function onAttachmentZip(e) {
    const zip = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!zip || !batchId) return
    setError(''); setAttachBusy(true); setAttachDone(false); setAttachWarnings([])

    try {
      const { files, warnings } = await extractZip(zip)
      setAttachWarnings(warnings)
      if (!files.length) {
        setAttachItems([])
        setError(warnings.length ? 'No usable files found in the archive.' : 'The archive is empty.')
        return
      }

      // Match each file to a staged row, then render a pending table immediately.
      const matches = files.map((f) => matchAttachment(f.name, annotated))
      setAttachItems(files.map((f, i) => ({
        name: f.name, sizeBytes: f.sizeBytes, matchedBy: matches[i]?.matchedBy || null, status: 'pending', error: null,
      })))

      const recordPayload = []
      const finalItems = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const base = { name: f.name, sizeBytes: f.sizeBytes, matchedBy: matches[i]?.matchedBy || null }
        try {
          const { fileId } = await imports.uploadAttachment(f.blob, {
            batchId, country: activeCountry, filename: f.name,
          })
          recordPayload.push({ file: f, match: matches[i], fileId })
          finalItems.push({ ...base, status: 'uploaded', error: null })
        } catch (err) {
          finalItems.push({ ...base, status: 'failed', error: err?.message || 'Upload failed.' })
        }
        setAttachItems([...finalItems]) // progressive UI update
      }

      // Record matches for everything that uploaded (matched + unmatched alike).
      if (recordPayload.length) {
        try {
          const rows = buildMatchRows({ batchId, items: recordPayload, rows: annotated })
          await imports.recordAttachmentMatches(rows)
        } catch (err) {
          setError(`Files uploaded, but recording matches failed: ${err?.message || 'unknown error'}`)
        }
      }
      setAttachDone(true)
    } catch (err) {
      setError(err?.message || 'Could not process the attachment package.')
    } finally {
      setAttachBusy(false)
    }
  }

  // ── Step 4: approve + commit ─────────────────────────────────────────────────
  async function commit() {
    setError(''); setBusy(true)
    try {
      await imports.submitForApproval(batchId)
      if (isElevated) await imports.approveBatch(batchId)
      const res = await imports.commitBatch(batchId)
      setResult(res); loadRecent()
    } catch (err) {
      setError(err?.message || 'Commit failed.')
    } finally { setBusy(false) }
  }

  if (!countryReady) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Data Intake Center</h1>
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-6 text-amber-300 flex gap-3">
          <AlertTriangle className="shrink-0" />
          <p>Select a single country (top bar) before importing. Every import is scoped to one country — mixing countries is not allowed.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto text-gray-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Database size={22} /> Data Intake Center</h1>
          <p className="text-sm text-gray-400">Controlled import for <span className="text-white">{activeCountry}</span> — staged, validated, approved, then committed.</p>
        </div>
        <button onClick={reset} className="text-sm px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center gap-2"><RefreshCw size={15} /> New import</button>
      </div>

      {/* stepper */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => (
          <div key={s} className={`flex items-center gap-2 text-sm ${i === step ? 'text-white' : i < step ? 'text-green-400' : 'text-gray-500'}`}>
            <span className={`w-6 h-6 rounded-full grid place-items-center text-xs ${i === step ? 'bg-green-600 text-white' : i < step ? 'bg-green-900/40' : 'bg-gray-800'}`}>{i + 1}</span>
            {s}{i < STEPS.length - 1 && <span className="text-gray-700 mx-1">—</span>}
          </div>
        ))}
      </div>

      {error && <div className="mb-4 bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm flex gap-2"><AlertTriangle size={16} /> {error}</div>}

      {/* STEP 1 */}
      {step === 0 && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Module</label>
            <div className="flex gap-2">
              {MODULES.map((m) => (
                <button key={m.key} onClick={() => setModule(m.key)} className={`px-4 py-2 rounded-lg text-sm border ${module === m.key ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-900 border-gray-700 hover:border-gray-500'}`}>{m.label}</button>
              ))}
            </div>
          </div>
          <label className="block border-2 border-dashed border-gray-700 rounded-xl p-10 text-center cursor-pointer hover:border-green-600/60">
            <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden" onChange={onFile} />
            {busy ? <Loader2 className="animate-spin mx-auto text-green-400" /> : <UploadCloud className="mx-auto text-gray-500" size={34} />}
            <p className="mt-2 text-sm text-gray-400">{file ? file.name : 'Choose an Excel or CSV file'}</p>
          </label>

          {parsed && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-sm text-gray-400 flex items-center gap-2"><FileSpreadsheet size={15} /> {parsed.sheets.length} sheet(s)</p>
              <div className="flex flex-wrap gap-2">
                {parsed.sheets.map((s, i) => (
                  <button key={s.name + i} onClick={() => setSheetIdx(i)} className={`px-3 py-1.5 rounded-lg text-xs ${i === sheetIdx ? 'bg-green-600 text-white' : 'bg-gray-800 hover:bg-gray-700'}`}>{s.name} <span className="opacity-70">({s.rows.length} rows)</span></button>
                ))}
              </div>
              {sheet && <p className="text-xs text-gray-500">Header row detected at line {(sheet.headerRow ?? 0) + 1} · {sheet.columns.length} columns</p>}
              <button onClick={startBatch} disabled={busy || !sheet} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} Continue to mapping</button>
            </div>
          )}
        </div>
      )}

      {/* STEP 2 */}
      {step === 1 && sheet && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-400 flex items-center gap-2"><Wand2 size={15} /> Review the suggested mapping. Unknown columns are kept (never dropped).</p>
            <div className="flex items-center gap-2">
              {profiles.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Bookmark size={15} className="text-gray-500" />
                  <select
                    defaultValue=""
                    onChange={(e) => { applyProfile(e.target.value); e.target.value = '' }}
                    className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                    title="Apply a saved mapping profile"
                  >
                    <option value="">Apply saved profile…</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <button onClick={saveAsProfile} disabled={busy || !mapping.some((m) => m.target)} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs flex items-center gap-1.5 disabled:opacity-50" title="Save this mapping for reuse"><Save size={14} /> Save as profile</button>
            </div>
          </div>
          <div className="overflow-x-auto border border-gray-800 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/60 text-gray-400 text-xs">
                <tr><th className="text-left px-3 py-2">Source header</th><th className="text-left px-3 py-2">Sample</th><th className="text-left px-3 py-2">Map to</th><th className="text-left px-3 py-2">Confidence</th></tr>
              </thead>
              <tbody>
                {mapping.map((m) => {
                  const sample = sheet.rows.find((r) => r[m.sourceHeader] != null && r[m.sourceHeader] !== '')?.[m.sourceHeader]
                  return (
                    <tr key={m.sourceHeader} className="border-t border-gray-800">
                      <td className="px-3 py-2 font-medium">{m.sourceHeader}</td>
                      <td className="px-3 py-2 text-gray-500 truncate max-w-[160px]">{String(sample ?? '')}</td>
                      <td className="px-3 py-2">
                        <select value={m.target || ''} onChange={(e) => setTarget(m.sourceHeader, e.target.value)} className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs">
                          <option value="">— preserve as custom —</option>
                          {targetOptions.map((t) => <option key={t.key} value={t.key}>{t.label}{t.required ? ' *' : ''}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded ${m.confidence >= 90 ? 'bg-green-900/30 text-green-400' : m.confidence >= 60 ? 'bg-amber-900/30 text-amber-400' : 'bg-gray-800 text-gray-400'}`}>{m.target ? `${m.confidence}%` : 'custom'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(0)} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm flex items-center gap-2"><ArrowLeft size={15} /> Back</button>
            <button onClick={() => setStep(2)} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2">Validate <ArrowRight size={15} /></button>
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 2 && (
        <div className="space-y-4">
          {counts && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {[['Total', counts.total, 'text-white'], ['Ready', counts.ready, 'text-green-400'], ['Warning', counts.warning, 'text-amber-400'], ['Error', counts.error, 'text-red-400'], ['Duplicate', counts.duplicate, 'text-purple-400'], ['Already live', counts.liveDuplicate || 0, 'text-sky-400']].map(([l, v, c]) => (
                <div key={l} className="bg-gray-900 border border-gray-800 rounded-xl p-3"><p className="text-xs text-gray-500">{l}</p><p className={`text-2xl font-bold ${c}`}>{v}</p></div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto border border-gray-800 rounded-xl max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/60 text-gray-400 text-xs sticky top-0"><tr><th className="text-left px-3 py-2">#</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Dup</th><th className="text-left px-3 py-2">Issues</th></tr></thead>
              <tbody>
                {annotated.slice(0, 200).map((r) => (
                  <tr key={r.sourceRowNo} className="border-t border-gray-800">
                    <td className="px-3 py-1.5 text-gray-500">{r.sourceRowNo}</td>
                    <td className="px-3 py-1.5"><span className={`text-xs px-2 py-0.5 rounded ${statusColor(r.validationStatus)}`}>{r.validationStatus}</span></td>
                    <td className="px-3 py-1.5 text-xs text-gray-400">{r.liveDuplicate ? <span className="text-sky-400">already live · skip</span> : r.dupStatus !== 'none' ? r.dupStatus : '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-500 truncate max-w-[280px]">{r.issues.map((i) => i.message).join('; ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm flex items-center gap-2"><ArrowLeft size={15} /> Back</button>
            <button onClick={stageAll} disabled={busy} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Stage & continue</button>
          </div>
        </div>
      )}

      {/* STEP 4 */}
      {step === 3 && (
        <div className="space-y-4 max-w-xl">
          {/* Accident-only: attach an evidence package (.zip) and match to rows */}
          {module === 'accident' && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Paperclip size={16} className="text-sky-400" />
                <h3 className="text-sm font-semibold text-white">Attach evidence package (optional)</h3>
              </div>
              <p className="text-xs text-gray-400">
                Upload a <span className="text-gray-200">.zip</span> of photos, police reports, invoices, quotations, or insurance
                docs. Files are stored privately and matched to staged accident rows by claim no, police report no, or asset no.
                Unmatched files are kept for later reconciliation.
              </p>
              <label className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer ${attachBusy ? 'border-gray-700 opacity-60 pointer-events-none' : 'border-gray-700 hover:border-sky-600/60'}`}>
                <input type="file" accept=".zip,application/zip" className="hidden" onChange={onAttachmentZip} disabled={attachBusy} />
                {attachBusy ? <Loader2 className="animate-spin mx-auto text-sky-400" /> : <FileArchive className="mx-auto text-gray-500" size={28} />}
                <p className="mt-2 text-xs text-gray-400">{attachBusy ? 'Processing package…' : 'Choose a .zip evidence package'}</p>
              </label>

              {attachWarnings.length > 0 && (
                <div className="bg-amber-900/15 border border-amber-700/40 rounded-lg p-3 text-amber-300 text-xs space-y-1">
                  <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> {attachWarnings.length} file(s) skipped</p>
                  <ul className="list-disc pl-5 max-h-28 overflow-y-auto">
                    {attachWarnings.slice(0, 30).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {attachItems.length > 0 && (
                <div className="overflow-x-auto border border-gray-800 rounded-lg max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-800/60 text-gray-400 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">File</th>
                        <th className="text-left px-3 py-2">Matched to</th>
                        <th className="text-left px-3 py-2">Size</th>
                        <th className="text-left px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attachItems.map((it, i) => (
                        <tr key={it.name + i} className="border-t border-gray-800">
                          <td className="px-3 py-1.5 text-gray-200 truncate max-w-[200px]">{it.name}</td>
                          <td className="px-3 py-1.5">
                            {it.matchedBy
                              ? <span className="text-green-400">{it.matchedBy === 'claim_no' ? 'Claim no' : it.matchedBy === 'police_report_no' ? 'Police report' : 'Asset no'}</span>
                              : <span className="text-gray-500">unmatched</span>}
                          </td>
                          <td className="px-3 py-1.5 text-gray-400">{(it.sizeBytes / 1024).toFixed(0)} KB</td>
                          <td className="px-3 py-1.5">
                            <span className={`px-2 py-0.5 rounded ${it.status === 'uploaded' ? 'text-green-400 bg-green-900/30' : it.status === 'failed' ? 'text-red-400 bg-red-900/30' : 'text-gray-400 bg-gray-800'}`}>{it.status}</span>
                            {it.error && <span className="ml-2 text-red-400">{it.error}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {attachDone && attachItems.length > 0 && (
                <p className="text-xs text-green-400 flex items-center gap-1.5">
                  <CheckCircle2 size={13} />
                  {attachItems.filter((i) => i.status === 'uploaded').length} uploaded · {attachItems.filter((i) => i.matchedBy).length} matched · {attachItems.filter((i) => i.status === 'failed').length} failed
                </p>
              )}
            </div>
          )}

          {!result ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
              <p className="text-sm text-gray-300">{counts?.ready ?? 0} ready + {counts?.warning ?? 0} warning rows will be committed to the live <span className="text-white">{module}</span> table. Error rows are skipped.</p>
              {!isElevated && <p className="text-xs text-amber-400">Your role can stage but not approve — this will be submitted for approval.</p>}
              <button onClick={commit} disabled={busy} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} {isElevated ? 'Approve & commit' : 'Submit for approval'}</button>
            </div>
          ) : (
            <div className="bg-green-900/20 border border-green-700/50 rounded-xl p-6 text-green-300">
              <CheckCircle2 className="mb-2" />
              <p className="font-semibold">{result.status === 'committed' ? `Committed — ${result.inserted} row(s) inserted, ${result.skipped} skipped.` : `Status: ${result.status}`}</p>
              <button onClick={reset} className="mt-3 text-sm underline">Start another import</button>
            </div>
          )}
        </div>
      )}

      {/* recent imports */}
      <div className="mt-10">
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Recent imports</h2>
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/60 text-gray-400 text-xs"><tr><th className="text-left px-3 py-2">Module</th><th className="text-left px-3 py-2">Country</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Rows</th><th className="text-left px-3 py-2">When</th><th className="text-right px-3 py-2">Actions</th></tr></thead>
            <tbody>
              {recent.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-600">No imports yet.</td></tr>}
              {recent.map((b) => {
                const committed = b.import_status === 'committed'
                const rowBusy = rowBusyId === b.id
                return (
                <tr key={b.id} className="border-t border-gray-800">
                  <td className="px-3 py-1.5 capitalize">{b.module}</td>
                  <td className="px-3 py-1.5 text-gray-400">{b.country || '—'}</td>
                  <td className="px-3 py-1.5"><span className={`text-xs px-2 py-0.5 rounded ${committed ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-400'}`}>{b.import_status}</span></td>
                  <td className="px-3 py-1.5 text-gray-400">{b.imported_rows || 0}/{b.total_rows || 0}</td>
                  <td className="px-3 py-1.5 text-gray-500 text-xs">{b.created_at ? new Date(b.created_at).toLocaleString('en-GB') : ''}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link to="/data-intake/history" title="Open in import history"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600">
                        Open
                      </Link>
                      <button onClick={() => deleteRecent(b)} disabled={rowBusy}
                        title={committed ? 'Reverse this committed import' : 'Delete this staged batch'}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-700/50 disabled:opacity-50">
                        {rowBusy ? <Loader2 size={12} className="animate-spin" /> : committed ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                        {committed ? 'Reverse' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-600">Original files are stored privately; every source row is preserved. Commits run server-side (permission + country scope + idempotency). <Link to="/upload" className="underline">Legacy upload</Link></p>
      </div>
    </div>
  )
}
