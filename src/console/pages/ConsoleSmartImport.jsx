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
  UploadCloud, Wand2, FileSpreadsheet, CheckCircle2, AlertTriangle,
  Database, ArrowRight, RefreshCw, ShieldCheck, Info, PieChart,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Code, Btn, Select, Table, THead, Th, Tr, Td,
  LoadingState, ErrorState,
} from '../components/ui'
import { ShareChart, STATUS, useChartTheme } from '../components/ui/charts'
import {
  parseWorkbook, detectModule, rankModules, suggestMapping, transformRow,
  validateRow, rowFingerprint, MODULE_FIELDS, MODULE_TABLES,
} from '../../lib/import'
import * as imports from '../../lib/api/imports'
import { checkImportFingerprint, fileSha256 } from '../../lib/api/importHistory'
import { toUserMessage } from '../../lib/safeError'

const MODULE_LABELS = {
  fleet: 'Vehicles / Fleet', tyre: 'Tyres', stock: 'Stock / Inventory',
  accident: 'Accidents / Incidents', inspection: 'Inspections', workorder: 'Work Orders',
  warranty: 'Warranty Claims', gatepass: 'Gate Passes', supplier: 'Suppliers', driver: 'Drivers',
}
const moduleLabel = (m) => MODULE_LABELS[m] || m
const fmtNum = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')
const PREVIEW_ROWS = 12
// The on-screen preview counts are estimated from a bounded SAMPLE so a 50k-100k
// row sheet never freezes the main thread. The commit path still processes every
// row via the resilient staging pipeline.
const PREVIEW_SAMPLE = 2000
// Above this many rows, suggest the Supabase Table Editor CSV import as the
// fastest path (the in-app import still works, just slower for very large files).
const LARGE_FILE_ROWS = 50000

// Move any out-of-vocab enum value aside so a DB CHECK constraint (e.g.
// inspection status / accident severity) cannot reject the whole row. The column
// falls back to its table default and the original value is kept in custom_data
// for review. Mirrors the Data Intake Center behavior so imports never fail with
// a raw "value not compatible" constraint error.
function sanitizeEnums(transformed, mapped, custom, issues) {
  const t = { ...(transformed || {}) }
  const m = { ...(mapped || {}) }
  const c = { ...(custom || {}) }
  for (const iss of issues || []) {
    if (iss.code === 'ENUM_INVALID' && t[iss.field] != null) {
      c[`${iss.field}__unmapped`] = t[iss.field]
      delete t[iss.field]
      delete m[iss.field]
    }
  }
  return { transformed: t, mapped: m, custom: c }
}

function confBadge(conf) {
  if (conf >= 90) return { text: 'Auto', tone: 'good' }
  if (conf >= 60) return { text: `${conf}%`, tone: 'warning' }
  if (conf > 0) return { text: 'Review', tone: 'accent' }
  return { text: 'Custom', tone: 'quiet' }
}

export default function ConsoleSmartImport() {
  const { logAction } = useConsoleAuth()
  const fileRef = useRef(null)

  const [phase, setPhase] = useState('idle') // idle | parsing | ready | committing | done
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [fileName, setFileName] = useState('')
  // Set when this exact file content has been loaded before. The commit button
  // stays disabled until the operator says they meant to repeat it.
  const [fingerprint, setFingerprint] = useState(null)
  const [repeatAck, setRepeatAck] = useState(false)
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
  const fields = useMemo(() => (module ? (MODULE_FIELDS[module] || []) : []), [module])

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
    setFingerprint(null); setRepeatAck(false)
    try {
      const buf = await file.arrayBuffer()
      // Content fingerprint before anything else. This is the only check that
      // catches a repeat upload of a file whose rows carry no ERP line number,
      // which is almost every Egypt and UAE expense row.
      try {
        const sha = await fileSha256(buf)
        if (sha) {
          const seen = await checkImportFingerprint(sha)
          if (seen?.seen) setFingerprint({ ...seen, sha256: sha })
        }
      } catch { /* an aid, never a gate */ }
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

  // Transformed + validated preview over a bounded SAMPLE (first PREVIEW_SAMPLE
  // rows) so a very large sheet cannot freeze the UI. Counts are exact when the
  // sheet fits inside the sample and clearly labelled as an estimate otherwise.
  // The commit path (below) always processes EVERY row.
  // Memoised: this was called inline in the JSX, so it re-scored all ten module
  // definitions on every render - measured at 84 ms, paid on every keystroke in
  // the fields beside it.
  const rankedModules = useMemo(
    () => (sheet ? rankModules(sheet.columns, (sheet.rows || []).slice(0, 20)) : []),
    [sheet],
  )

  const previewInfo = useMemo(() => {
    if (!sheet || !module || !mapping.length) return null
    let ready = 0, warning = 0, errorRows = 0
    const sampleOut = []
    const activeTargets = mapping.filter((m) => m.target).map((m) => m.target)
    const total = sheet.rows.length
    const scan = Math.min(total, PREVIEW_SAMPLE)
    for (let i = 0; i < scan; i++) {
      const raw = sheet.rows[i]
      let t
      try {
        const { transformed } = transformRow(raw, mapping, { module })
        t = transformed
      } catch { t = {} }
      // Reflect the same enum cleanup the commit applies, so the preview counts
      // are honest: an out-of-vocab enum does not count as a failing row.
      const v0 = validateRow(t, module)
      t = sanitizeEnums(t, {}, {}, v0.issues).transformed
      const v = validateRow(t, module)
      if (v.status === 'error') errorRows++
      else if (v.status === 'warning') warning++
      else ready++
      if (sampleOut.length < PREVIEW_ROWS) sampleOut.push({ t, status: v.status })
    }
    return { ready, warning, errorRows, total, scanned: scan, isEstimate: total > scan, activeTargets, sampleOut }
  }, [sheet, module, mapping])

  const requiredMissing = useMemo(() => {
    if (!module || !previewInfo) return []
    const have = new Set(previewInfo.activeTargets)
    return fields.filter((f) => f.required && !have.has(f.key)).map((f) => f.label)
  }, [module, previewInfo, fields])

  async function commit() {
    if (!sheet || !module) return
    setPhase('committing'); setError(''); setResult(null)
    // Reflect the pre-staging work in the button before the (synchronous) heavy
    // transform loop, so a large file does not look frozen.
    setProgress({ phase: 'preparing', inserted: 0 })
    // Yield one frame so the "Preparing rows..." state can paint first.
    await new Promise((r) => setTimeout(r, 0))
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
        // Strip out-of-vocab enum values so a DB CHECK cannot reject the row;
        // the original is preserved in custom_data and the column takes its
        // table default.
        const issues = (validateRow(transformed, module).issues) || []
        const cleaned = sanitizeEnums(transformed, mapped, custom, issues)
        mapped = cleaned.mapped; transformed = cleaned.transformed; custom = cleaned.custom
        const v = validateRow(transformed, module)
        return {
          sheetName: sheet.name, sourceRowNo: i + 1, raw, mapped, transformed, custom,
          validationStatus: v.status, action: 'insert', fingerprint: rowFingerprint(raw),
        }
      })

      await imports.stageRows(batchId, staged, {
        // uploading is the long phase; report it through the existing indicator
        onProgress: (done, total) => setProgress({ phase: 'uploading', inserted: done, total }),
      })
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
    // A repeat warning belongs to the file it was raised for.
    setFingerprint(null); setRepeatAck(false)
  }


  const moduleOptions = rankedModules.map((r) => ({ value: r.module, label: `${moduleLabel(r.module)} (${r.score}% match)` }))
  const fieldOptions = fields.map((f) => ({ value: f.key, label: `${f.label}${f.required ? ' *' : ''}` }))
  const canCommit = phase !== 'committing' && previewInfo && previewInfo.ready + previewInfo.warning > 0 && (!fingerprint || repeatAck)
  const mappedCount = mapping.filter((m) => m.target).length

  const commitLabel = phase === 'committing'
    ? (progress?.phase === 'preparing'
      ? 'Preparing rows'
      : progress?.phase === 'uploading'
        ? `Uploading ${fmtNum(progress.inserted)} of ${fmtNum(progress.total)}`
        : `Importing${progress ? ` ${fmtNum(progress.inserted)} saved` : ''}`)
    : `Import ${previewInfo?.isEstimate ? `up to ${fmtNum(previewInfo?.total || 0)}` : fmtNum((previewInfo?.ready || 0) + (previewInfo?.warning || 0))} rows`

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><Wand2 size={18} className="text-orange-400" /> Smart Import</h1>
          <p className="text-xs text-gray-500 mt-1">Upload any Excel or CSV file. The console detects what it is, maps the columns, and loads it.</p>
        </div>
        {phase !== 'idle' && (
          <Btn icon={RefreshCw} onClick={reset} disabled={phase === 'committing' || phase === 'parsing'}>Start over</Btn>
        )}
      </header>

      <ErrorState message={error} />

      {phase === 'idle' && (
        // The input is visually hidden but stays focusable, so the picker opens
        // from the keyboard; the drop handler makes "drag it here" true.
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false)
            const file = e.dataTransfer?.files?.[0]
            if (file) onFile({ target: { files: [file] } })
          }}
          className={`block cursor-pointer rounded-xl border-2 border-dashed ${dragOver ? 'border-orange-500 bg-orange-950/20' : 'border-gray-800 bg-gray-900/50'} hover:border-orange-600/60 p-6 sm:p-12 text-center transition-colors focus-within:ring-2 focus-within:ring-orange-500`}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="sr-only" onChange={onFile}
            aria-label="Choose a file to import" />
          <UploadCloud className="mx-auto text-orange-400" size={36} />
          <p className="mt-3 text-sm font-semibold text-gray-200">Choose a file or drag it here</p>
          <p className="text-xs text-gray-500 mt-1">Excel (.xlsx, .xls) or CSV. Vehicles, tyres, stock, accidents, inspections, work orders, warranty, gate passes, suppliers, drivers.</p>
        </label>
      )}

      {phase === 'parsing' && <LoadingState label="Reading and analysing the file" />}

      {(phase === 'ready' || phase === 'committing' || phase === 'done') && sheet && (
        <div className="space-y-5">
          <Panel>
            <PanelHeader icon={FileSpreadsheet} title={fileName || 'Uploaded file'}
              subtitle={`${fmtNum(sheet.rows.length)} rows | ${sheet.columns.length} columns`}
              actions={parsed.sheets.length > 1 && (
                <Select ariaLabel="Sheet" value={String(sheetIdx)} onChange={(v) => pickSheet(Number(v))} className="w-56"
                  options={parsed.sheets.map((s, i) => ({ value: String(i), label: `${s.name} (${fmtNum(s.rows.length)})` }))} />
              )} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Detected as</p>
                <div className="mt-1 flex items-center gap-2">
                  <Select ariaLabel="Module" value={module} onChange={changeModule} options={moduleOptions} className="flex-1" disabled={phase !== 'ready'} />
                  {confident
                    ? <Badge tone="good" icon={CheckCircle2}>Confident</Badge>
                    : <Badge tone="warning" icon={Info}>Please confirm</Badge>}
                </div>
                <p className="mt-1 text-xs text-gray-500">Loads into <Code>{MODULE_TABLES[module] || 'N/A'}</Code></p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Country (optional)</p>
                <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Leave blank to use your default scope"
                  disabled={phase !== 'ready'} aria-label="Country"
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50" />
                <p className="mt-1 text-xs text-gray-500">Stamps every imported row with this country for data isolation.</p>
              </div>
            </div>
          </Panel>

          {sheet.rows.length > LARGE_FILE_ROWS && (
            <Note icon={Info} tone="accent">
              This sheet has {fmtNum(sheet.rows.length)} rows. You can import it here, but for very large files the fastest path is the Supabase Table Editor Import data from CSV option, which streams the whole file and stamps your organisation automatically. The in-app import below will still work; it just takes longer.
            </Note>
          )}

          <Panel flush>
            <div className="px-4 pt-4">
              <PanelHeader icon={Wand2} title="Column mapping"
                subtitle={`Auto-filled. ${fmtNum(mappedCount)} of ${fmtNum(mapping.length)} columns mapped; adjust any row.`} />
            </div>
            <div className="max-h-80 overflow-auto px-4 pb-4">
              <Table>
                <THead><Th>File column</Th><Th>Maps to</Th><Th>Match</Th></THead>
                <tbody>
                  {mapping.map((m) => {
                    const b = confBadge(m.confidence)
                    return (
                      <Tr key={m.sourceHeader}>
                        <Td><span className="text-gray-300">{m.sourceHeader}</span></Td>
                        <Td>
                          <Select ariaLabel={`Field for column ${m.sourceHeader}`} value={m.target || ''} onChange={(v) => setTarget(m.sourceHeader, v)}
                            placeholder="Keep as-is (not imported)" options={fieldOptions} disabled={phase !== 'ready'} />
                        </Td>
                        <Td><Badge tone={b.tone}>{b.text}</Badge></Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          </Panel>

          {previewInfo && (
            <Panel>
              <PanelHeader icon={PieChart} title="Preview"
                subtitle={previewInfo.isEstimate
                  ? `Estimate based on the first ${fmtNum(previewInfo.scanned)} of ${fmtNum(previewInfo.total)} rows. Every row is checked when you import.`
                  : `All ${fmtNum(previewInfo.total)} rows checked.`} />
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-center">
                <PreviewShare info={previewInfo} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <StatTile label="Ready" value={fmtNum(previewInfo.ready)} tone="good" icon={CheckCircle2} />
                  <StatTile label="Needs review" value={fmtNum(previewInfo.warning)} tone="warning" icon={Info} />
                  <StatTile label="Would fail" value={fmtNum(previewInfo.errorRows)} tone={previewInfo.errorRows ? 'danger' : 'default'} icon={AlertTriangle} />
                </div>
              </div>

              {requiredMissing.length > 0 && (
                <div className="mt-3">
                  <Note icon={AlertTriangle} tone="warning">
                    Required field(s) not yet mapped: <strong>{requiredMissing.join(', ')}</strong>. Rows without them will be skipped.
                  </Note>
                </div>
              )}

              <div className="mt-3 max-h-72 overflow-auto">
                <Table>
                  <THead>
                    <Th>Status</Th>
                    {previewInfo.activeTargets.slice(0, 6).map((t) => (
                      <Th key={t}>{(fields.find((f) => f.key === t) || {}).label || t}</Th>
                    ))}
                  </THead>
                  <tbody>
                    {previewInfo.sampleOut.map((row, i) => (
                      <Tr key={i}>
                        <Td>
                          {row.status === 'error'
                            ? <Badge tone="danger">Fail</Badge>
                            : row.status === 'warning' ? <Badge tone="warning">Review</Badge> : <Badge tone="good">OK</Badge>}
                        </Td>
                        {previewInfo.activeTargets.slice(0, 6).map((t) => (
                          <Td key={t}><span className="block truncate max-w-[160px] text-gray-300">{row.t[t] == null ? '' : String(row.t[t])}</span></Td>
                        ))}
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Panel>
          )}

          {fingerprint && (
            <Panel tone="warning">
              <PanelHeader icon={AlertTriangle} tone="warning" title="This file has been uploaded before"
                subtitle={`The same file content was loaded${fingerprint.first_seen_at ? ` on ${String(fingerprint.first_seen_at).slice(0, 10)}` : ' previously'}${fingerprint.filename ? ` as "${fingerprint.filename}"` : ''}. Committing it again adds those rows a second time.`} />
              <label className="flex items-center gap-2 text-xs text-amber-200 cursor-pointer">
                <input type="checkbox" checked={repeatAck} onChange={(e) => setRepeatAck(e.target.checked)} disabled={phase !== 'ready'}
                  className="accent-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
                I know this is a repeat and I want to import it anyway
              </label>
            </Panel>
          )}

          {phase !== 'done' && (
            <div className="flex flex-wrap items-center gap-3">
              <Btn variant="primary" size="md" icon={phase === 'committing' ? undefined : Database}
                busy={phase === 'committing'} onClick={commit} disabled={!canCommit}>
                {commitLabel}{phase !== 'committing' && <ArrowRight size={14} />}
              </Btn>
              <span className="text-xs text-gray-500">Rows that would fail are skipped automatically.</span>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && result && (
        <Panel tone={Number(result.failed) > 0 ? 'warning' : 'accent'}>
          <PanelHeader icon={Number(result.failed) > 0 ? AlertTriangle : ShieldCheck}
            tone={Number(result.failed) > 0 ? 'warning' : 'default'}
            title={Number(result.failed) > 0 ? 'Import finished with failures' : 'Import complete'}
            subtitle={`Loaded into ${result.table || 'N/A'} (${moduleLabel(result.module)}). This run is recorded in the audit trail and can be reversed from the Data Intake history.`} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="Inserted" value={fmtNum(result.inserted || 0)} tone="good" />
            <StatTile label="Merged" value={fmtNum(result.merged || 0)} tone="accent" />
            <StatTile label="Skipped" value={fmtNum(result.skipped || 0)} tone={result.skipped ? 'warning' : 'default'} />
            <StatTile label="Failed" value={fmtNum(result.failed || 0)} tone={result.failed ? 'danger' : 'default'} />
          </div>
          <div className="mt-4">
            <Btn icon={UploadCloud} onClick={reset}>Import another file</Btn>
          </div>
        </Panel>
      )}
    </div>
  )
}

/** Ready / review / fail as shares of the scanned rows, in the reserved status colours. */
function PreviewShare({ info }) {
  const theme = useChartTheme()
  const parts = [
    { label: 'Ready', value: info.ready, color: STATUS[theme].good },
    { label: 'Needs review', value: info.warning, color: STATUS[theme].medium },
    { label: 'Would fail', value: info.errorRows, color: STATUS[theme].critical },
  ]
  return (
    <ShareChart parts={parts} height={150}
      center={{ value: fmtNum(info.scanned), label: info.isEstimate ? 'sampled' : 'rows' }}
      summary={`Ready ${info.ready}, needs review ${info.warning}, would fail ${info.errorRows}`}
      emptyText="No rows to preview." />
  )
}
