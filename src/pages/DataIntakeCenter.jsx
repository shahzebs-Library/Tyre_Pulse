import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  UploadCloud, FileSpreadsheet, Wand2, ShieldCheck, CheckCircle2, AlertTriangle,
  Loader2, ArrowRight, ArrowLeft, RefreshCw, Database, Save, Bookmark,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  parseWorkbook, sha256OfArrayBuffer, suggestMapping, transformRow, validateRow,
  classifyDuplicates, rowFingerprint, MODULE_FIELDS,
} from '../lib/import'
import * as imports from '../lib/api/imports'

const MODULES = [
  { key: 'fleet', label: 'Fleet / Assets' },
  { key: 'tyre', label: 'Tyre Lifecycle' },
  { key: 'stock', label: 'Stock' },
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

  const [step, setStep] = useState(0)
  const [module, setModule] = useState('fleet')
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

  const sheet = parsed?.sheets?.[sheetIdx] || null
  const targetOptions = useMemo(
    () => (MODULE_FIELDS[module] || []).map((f) => ({ key: f.key, label: f.label || f.key, required: f.required })),
    [module],
  )

  const loadRecent = useCallback(async () => {
    try { setRecent(await imports.listBatches({ country: activeCountry, limit: 8 })) } catch { /* non-blocking */ }
  }, [activeCountry])
  useEffect(() => { loadRecent() }, [loadRecent])

  function reset() {
    setStep(0); setFile(null); setParsed(null); setSheetIdx(0); setBatchId(null)
    setMapping([]); setAnnotated([]); setCounts(null); setResult(null); setError(''); setProfiles([])
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

  // ── Step 3: validate + classify ──────────────────────────────────────────────
  function runValidation() {
    const rows = sheet.rows.map((raw, i) => {
      const { mapped, transformed, custom } = transformRow(raw, mapping, { module })
      const v = validateRow(transformed, module)
      return {
        sourceRowNo: i + 1, raw, mapped, transformed, custom,
        validationStatus: v.status, issues: v.issues || [],
        fingerprint: rowFingerprint(raw),
      }
    })
    const withDup = classifyDuplicates(rows.map((r) => r.transformed), module)
    rows.forEach((r, i) => { r.dupStatus = withDup[i]?.dup_status || 'none' })
    const c = { total: rows.length, ready: 0, warning: 0, error: 0, duplicate: 0, conflict: 0 }
    rows.forEach((r) => {
      c[r.validationStatus] = (c[r.validationStatus] || 0) + 1
      if (r.dupStatus === 'duplicate') c.duplicate++
      if (r.dupStatus === 'conflict') c.conflict++
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
        dupStatus: r.dupStatus, action: r.validationStatus === 'error' ? 'reject' : 'insert',
        fingerprint: r.fingerprint,
      })))
      await imports.setBatchCounts(batchId, counts)
      setStep(3)
    } catch (err) {
      setError(err?.message || 'Could not stage the rows.')
    } finally { setBusy(false) }
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[['Total', counts.total, 'text-white'], ['Ready', counts.ready, 'text-green-400'], ['Warning', counts.warning, 'text-amber-400'], ['Error', counts.error, 'text-red-400'], ['Duplicate', counts.duplicate, 'text-purple-400']].map(([l, v, c]) => (
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
                    <td className="px-3 py-1.5 text-xs text-gray-400">{r.dupStatus !== 'none' ? r.dupStatus : '—'}</td>
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
            <thead className="bg-gray-800/60 text-gray-400 text-xs"><tr><th className="text-left px-3 py-2">Module</th><th className="text-left px-3 py-2">Country</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Rows</th><th className="text-left px-3 py-2">When</th></tr></thead>
            <tbody>
              {recent.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-600">No imports yet.</td></tr>}
              {recent.map((b) => (
                <tr key={b.id} className="border-t border-gray-800">
                  <td className="px-3 py-1.5 capitalize">{b.module}</td>
                  <td className="px-3 py-1.5 text-gray-400">{b.country || '—'}</td>
                  <td className="px-3 py-1.5"><span className={`text-xs px-2 py-0.5 rounded ${b.import_status === 'committed' ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-400'}`}>{b.import_status}</span></td>
                  <td className="px-3 py-1.5 text-gray-400">{b.imported_rows || 0}/{b.total_rows || 0}</td>
                  <td className="px-3 py-1.5 text-gray-500 text-xs">{b.created_at ? new Date(b.created_at).toLocaleString('en-GB') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-600">Original files are stored privately; every source row is preserved. Commits run server-side (permission + country scope + idempotency). <Link to="/upload" className="underline">Legacy upload</Link></p>
      </div>
    </div>
  )
}
