import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Upload, FileSpreadsheet, Database, Loader2, AlertTriangle, CheckCircle2,
  Trash2, Download, Search, ArrowRight, RefreshCw, Info,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import { parseWorkbook } from '../lib/import'
import {
  DATASET_LIST, DATASETS, mapSheetToRows, deriveTyreActivity, validateExpense,
  isEmptyMappedRow, normHeader,
} from '../lib/erpImport'
import {
  listImportBatches, listImportRows, saveImportRows, deleteImportBatch,
} from '../lib/api/erpImport'
import { createProduction } from '../lib/api/production'
import { exportToExcel } from '../lib/exportUtils'
import { configNum } from '../lib/api/systemConfig'
import { downloadErpTemplates } from '../lib/erpTemplates'
import { toUserMessage } from '../lib/safeError'

const ELEVATED = ['admin', 'manager', 'director']
const PREVIEW_LIMIT = 50
const ROW_CAP = 100000

function newBatchId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch { /* fall through */ }
  return 'b-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2, 10)
}

/** Auto-detect the sheet whose name matches a dataset's template tab. */
function detectSheetIndex(sheets, dataset) {
  const wanted = new Set((dataset.tabAliases || []).map(normHeader))
  const idx = (sheets || []).findIndex((s) => wanted.has(normHeader(s.name)))
  return idx >= 0 ? idx : (sheets?.length ? 0 : -1)
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const s = String(v)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

export default function ErpImport() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const canWrite = ELEVATED.includes(String(profile?.role || '').toLowerCase())
  const countryTag = activeCountry && activeCountry !== 'All' ? activeCountry : null

  const [tab, setTab] = useState('import')
  const [datasetKey, setDatasetKey] = useState('asset')
  const dataset = DATASETS[datasetKey]

  // ── Import state ───────────────────────────────────────────────────────────
  const fileRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)   // { sheets: [...] }
  const [sheetIdx, setSheetIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saveResult, setSaveResult] = useState(null)

  const sheet = parsed?.sheets?.[sheetIdx] || null

  // Mapped rows for the currently selected sheet + dataset.
  const mapped = useMemo(() => {
    if (!sheet) return []
    const rows = mapSheetToRows(datasetKey, sheet.rows || [])
    return rows.filter((r) => !isEmptyMappedRow(datasetKey, r))
  }, [sheet, datasetKey])

  // Derived intelligence: active-vs-old for change; expense cross-check.
  const derived = useMemo(() => {
    if (datasetKey === 'change') return deriveTyreActivity(mapped)
    if (datasetKey === 'expense') {
      // Cross-check against the Tyre Change Log tab in the SAME workbook (if any).
      const changeIdx = detectSheetIndex(parsed?.sheets, DATASETS.change)
      let changeSerials = []
      let hasChangeTab = false
      if (parsed?.sheets && changeIdx >= 0 && normHeader(parsed.sheets[changeIdx]?.name) !== normHeader(sheet?.name || '')) {
        const changeRows = mapSheetToRows('change', parsed.sheets[changeIdx].rows || [])
        changeSerials = changeRows.map((r) => r.serial_no).filter(Boolean)
        hasChangeTab = true
      }
      const v = validateExpense(mapped, changeSerials)
      return v.rows.map((r) => ({ ...r, _hasChangeTab: hasChangeTab }))
    }
    return mapped
  }, [mapped, datasetKey, parsed, sheet])

  const activeCount = useMemo(
    () => (datasetKey === 'change' ? derived.filter((r) => r.is_active).length : null),
    [derived, datasetKey],
  )
  const warnCount = useMemo(
    () => derived.filter((r) => Array.isArray(r.warnings) && r.warnings.length > 0).length,
    [derived],
  )

  function resetImport() {
    setParsed(null); setSheetIdx(0); setFileName(''); setError(''); setSaveResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setError(''); setSaveResult(null); setBusy(true)
    try {
      const wb = await parseWorkbook(await f.arrayBuffer(), { fileName: f.name })
      setParsed(wb); setFileName(f.name)
      setSheetIdx(detectSheetIndex(wb.sheets, dataset))
    } catch (err) {
      setError(toUserMessage(err, 'Could not read the file.'))
      setParsed(null)
    } finally { setBusy(false) }
  }

  // Re-auto-detect the sheet when the dataset changes while a file is loaded.
  useEffect(() => {
    if (parsed?.sheets?.length) setSheetIdx(detectSheetIndex(parsed.sheets, dataset))
    setSaveResult(null)
  }, [datasetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!mapped.length) return
    // Admin upload policy (System Configuration -> max_upload_rows). 0/unset = the
    // browser cap governs; a positive limit hard-blocks an over-size import here
    // just as it does in the Data Intake Center. Never silently truncate past it.
    const maxRows = configNum('max_upload_rows', 0)
    if (maxRows > 0 && mapped.length > maxRows) {
      setError(`This sheet has ${mapped.length.toLocaleString()} rows which exceeds the maximum of ${maxRows.toLocaleString()} allowed per upload. Split the file and try again.`)
      return
    }
    setError(''); setBusy(true); setSaveResult(null)
    try {
      if (datasetKey === 'production') {
        // m3 loads into the LIVE production_logs table (not a staging table).
        const kept = mapped.slice(0, ROW_CAP)
        let saved = 0
        const failures = []
        for (const r of kept) {
          try {
            await createProduction({
              site: r.site, asset_no: r.asset_no, period_date: r.period_date,
              m3: r.m3, source: r.source || 'ERP import', notes: r.notes,
              country: countryTag,
            })
            saved += 1
          } catch (e2) {
            failures.push(`Row ${r.source_row}: ${toUserMessage(e2, 'save failed')}`)
          }
        }
        setSaveResult({
          dataset: 'production', saved, requested: mapped.length,
          capped: Math.max(0, mapped.length - ROW_CAP), failures,
          batch_id: null,
        })
      } else {
        const batchId = newBatchId()
        const res = await saveImportRows(datasetKey, mapped, batchId, { country: countryTag })
        setSaveResult({ ...res, dataset: datasetKey, failures: [] })
      }
    } catch (err) {
      // Chunked saves commit independently: surface how many rows landed before
      // a transient network drop so the upload is not reported as a total loss.
      const partial = Number.isFinite(err?.saved) ? err.saved : 0
      const base = toUserMessage(err, 'Could not save the import.')
      setError(
        partial > 0
          ? `${base} Saved ${partial.toLocaleString()} row(s) before the connection dropped. Open the Review tab to check that batch, then re-upload the file to save the rest (delete the partial batch first to avoid duplicates).`
          : `${base} If you are on a corporate or VPN network, a firewall may be blocking large uploads. Try again, or split the file into smaller parts.`,
      )
    } finally { setBusy(false) }
  }

  return (
    <div className="p-6 max-w-[1800px] mx-auto text-[var(--text-primary)]">
      <PageHeader
        title="ERP Data Import"
        subtitle="Parse a filled ERP template, save rows into review tables, then cross-check every detail before promotion."
        icon={Database}
        showBack
      />

      {/* Tabs */}
      <div className="flex items-center gap-2 my-5">
        {[['import', 'Import', Upload], ['review', 'Review saved', Search]].map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 border ${tab === k ? 'bg-green-600 border-green-600 text-white' : 'bg-[var(--surface-1)] border-[var(--border-bright)] hover:border-green-600/50'}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Dataset picker (shared) */}
      <div className="mb-5">
        <label className="block text-sm text-[var(--text-secondary)] mb-2">Dataset</label>
        <div className="flex flex-wrap gap-2">
          {DATASET_LIST.map((d) => (
            <button
              key={d.key}
              onClick={() => { setDatasetKey(d.key); setError('') }}
              className={`px-4 py-2 rounded-lg text-sm border ${datasetKey === d.key ? 'bg-green-600 border-green-600 text-white' : 'bg-[var(--surface-1)] border-[var(--border-bright)] hover:border-green-600/50'}`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-2 flex items-center gap-1.5">
          <Info size={13} />
          {datasetKey === 'production'
            ? 'Production m3 loads directly into the live Cost Center production log.'
            : 'Rows are saved to a review table first. Promotion into the master tables is a separate, deliberate step.'}
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm flex gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {tab === 'import'
        ? (
          <ImportPanel
            dataset={dataset}
            datasetKey={datasetKey}
            canWrite={canWrite}
            countryTag={countryTag}
            fileRef={fileRef}
            fileName={fileName}
            parsed={parsed}
            sheet={sheet}
            sheetIdx={sheetIdx}
            setSheetIdx={setSheetIdx}
            busy={busy}
            mapped={mapped}
            derived={derived}
            activeCount={activeCount}
            warnCount={warnCount}
            saveResult={saveResult}
            onFile={onFile}
            onSave={save}
            onReset={resetImport}
          />
        )
        : (
          <ReviewPanel datasetKey={datasetKey} dataset={dataset} canWrite={canWrite} countryTag={countryTag} />
        )}
    </div>
  )
}

/* ── Import panel ──────────────────────────────────────────────────────────── */

function ImportPanel({
  dataset, datasetKey, canWrite, countryTag, fileRef, fileName, parsed, sheet, sheetIdx,
  setSheetIdx, busy, mapped, derived, activeCount, warnCount, saveResult, onFile, onSave, onReset,
}) {
  const displayCols = dataset.columns.map((c) => c.key)
  const previewRows = derived.slice(0, PREVIEW_LIMIT)

  const [tplBusy, setTplBusy] = useState(false)
  const [tplErr, setTplErr] = useState('')

  async function handleTemplate(keys) {
    setTplErr(''); setTplBusy(true)
    try {
      await downloadErpTemplates(keys)
    } catch (e) {
      setTplErr(toUserMessage(e, 'Could not build the template file.'))
    } finally {
      setTplBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {!canWrite && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-3 text-amber-300 text-sm flex gap-2">
          <AlertTriangle size={16} /> Only Admin, Manager, or Director can save imports. You can still preview a file.
        </div>
      )}

      {/* Downloadable ERP templates */}
      <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <FileSpreadsheet size={18} className="shrink-0 text-green-400 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Download import templates</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Send these templates to your ERP vendor, then upload the filled file here. Every sheet header is exactly what the importer expects, so a filled file maps automatically on upload.
            </p>
          </div>
        </div>
        {tplErr && (
          <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-2.5 text-red-300 text-xs flex gap-2">
            <AlertTriangle size={14} /> {tplErr}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleTemplate(null)}
            disabled={tplBusy}
            className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {tplBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            Download all templates
          </button>
          <button
            onClick={() => handleTemplate([datasetKey])}
            disabled={tplBusy}
            className="px-4 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Download size={15} /> {dataset.label} template
          </button>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          One workbook with four sheets: Asset Master, Tyre Change Log, Tyre Expense (Purchase) and Production m3. Each sheet has the header row plus an example row and a format hint row.
        </p>
      </div>

      {/* File chooser */}
      <label className="block border-2 border-dashed border-[var(--border-bright)] rounded-xl p-8 text-center cursor-pointer hover:border-green-600/60">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt" className="hidden" onChange={onFile} />
        {busy && !parsed
          ? <Loader2 className="animate-spin mx-auto text-green-400" />
          : <Upload className="mx-auto text-[var(--text-muted)]" size={32} />}
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {fileName || `Choose the filled ERP template (.xlsx) for ${dataset.label}`}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">The matching tab is detected automatically. If not found, pick the sheet below.</p>
      </label>

      {parsed?.sheets?.length > 0 && (
        <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 space-y-3">
          <p className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
            <FileSpreadsheet size={15} /> {parsed.sheets.length} sheet(s). Selected tab feeds the {dataset.label} mapping.
          </p>
          <div className="flex flex-wrap gap-2">
            {parsed.sheets.map((s, i) => (
              <button
                key={s.name + i}
                onClick={() => setSheetIdx(i)}
                className={`px-3 py-1.5 rounded-lg text-xs ${i === sheetIdx ? 'bg-green-600 text-white' : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'}`}
              >
                {s.name} <span className="opacity-70">({(s.rows || []).length})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Summary counts */}
      {sheet && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Rows mapped" value={mapped.length} color="text-[var(--text-primary)]" />
          {datasetKey === 'change' && <Stat label="Current (active)" value={activeCount ?? 0} color="text-green-400" />}
          {datasetKey === 'change' && <Stat label="Old / history" value={Math.max(0, mapped.length - (activeCount ?? 0))} color="text-sky-400" />}
          <Stat label="Rows with warnings" value={warnCount} color={warnCount ? 'text-amber-400' : 'text-[var(--text-primary)]'} />
          <Stat label="Country tag" value={countryTag || 'None'} color="text-[var(--text-secondary)]" small />
        </div>
      )}

      {/* Large-file honesty note */}
      {mapped.length > ROW_CAP && (
        <div className="bg-amber-900/20 border border-amber-600/50 rounded-xl p-3 text-amber-300 text-sm flex gap-2">
          <AlertTriangle size={16} />
          This sheet has {mapped.length.toLocaleString()} rows. The browser import saves the first {ROW_CAP.toLocaleString()}. For very large files (100k+ rows) use the server load. Contact an administrator.
        </div>
      )}

      {/* Preview */}
      {sheet && mapped.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--text-secondary)]">
            Preview of the first {Math.min(PREVIEW_LIMIT, mapped.length)} of {mapped.length.toLocaleString()} mapped rows.
          </p>
          <div className="overflow-x-auto border border-[var(--border-dim)] rounded-xl max-h-[520px]">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-[var(--surface-2)] text-[var(--text-secondary)] sticky top-0">
                <tr>
                  <th className="text-left px-2 py-2">#</th>
                  {(datasetKey === 'change' || datasetKey === 'expense') && <th className="text-left px-2 py-2">Flags</th>}
                  {displayCols.map((c) => <th key={c} className="text-left px-2 py-2">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r, i) => (
                  <tr key={i} className="border-t border-[var(--border-dim)]">
                    <td className="px-2 py-1.5 text-[var(--text-muted)]">{r.source_row}</td>
                    {(datasetKey === 'change' || datasetKey === 'expense') && (
                      <td className="px-2 py-1.5"><FlagCell row={r} datasetKey={datasetKey} /></td>
                    )}
                    {displayCols.map((c) => (
                      <td key={c} className="px-2 py-1.5 text-[var(--text-secondary)]">
                        {r[c] == null || r[c] === '' ? <span className="text-[var(--text-dim)]">-</span> : String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sheet && mapped.length === 0 && (
        <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-6 text-center text-sm text-[var(--text-muted)]">
          No rows mapped from this sheet. Check that you selected the right tab for {dataset.label}.
        </div>
      )}

      {/* Save result */}
      {saveResult && (
        <div className="bg-green-900/15 border border-green-700/40 rounded-xl p-4 text-sm space-y-1">
          <p className="text-green-300 flex items-center gap-2">
            <CheckCircle2 size={16} />
            Saved {saveResult.saved.toLocaleString()} of {saveResult.requested.toLocaleString()} row(s)
            {saveResult.dataset === 'production' ? ' into the live production log.' : ' to the review table.'}
          </p>
          {saveResult.capped > 0 && (
            <p className="text-amber-300">{saveResult.capped.toLocaleString()} row(s) beyond the {ROW_CAP.toLocaleString()} browser cap were not saved. Use the server load for the rest.</p>
          )}
          {saveResult.failures?.length > 0 && (
            <p className="text-amber-300">{saveResult.failures.length} row(s) failed: {saveResult.failures.slice(0, 3).join('; ')}{saveResult.failures.length > 3 ? ' ...' : ''}</p>
          )}
          {saveResult.dataset !== 'production' && (
            <p className="text-[var(--text-secondary)]">Open the Review tab to cross-check this batch before promotion.</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSave}
          disabled={busy || !canWrite || mapped.length === 0 || !!saveResult}
          className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
          {datasetKey === 'production' ? 'Save to production log' : 'Save to review table'}
        </button>
        {(parsed || saveResult) && (
          <button onClick={onReset} className="px-4 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-sm flex items-center gap-2">
            <RefreshCw size={15} /> New file
          </button>
        )}
      </div>
    </div>
  )
}

function FlagCell({ row, datasetKey }) {
  const warns = Array.isArray(row.warnings) ? row.warnings : []
  return (
    <div className="flex flex-wrap items-center gap-1">
      {datasetKey === 'change' && (
        row.is_active
          ? <span className="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300">Active</span>
          : <span className="px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300">Old</span>
      )}
      {datasetKey === 'change' && row.chain_ok === false && (
        <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300" title="Chain break">Chain</span>
      )}
      {datasetKey === 'expense' && row._hasChangeTab && !row.serial_in_change && (
        <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300" title="No matching fitment">No fitment</span>
      )}
      {warns.length > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300" title={warns.join('; ')}>
          <AlertTriangle size={11} className="inline" /> {warns.length}
        </span>
      )}
    </div>
  )
}

/* ── Review panel ──────────────────────────────────────────────────────────── */

function ReviewPanel({ datasetKey, dataset, canWrite, countryTag }) {
  const isProduction = datasetKey === 'production'
  const [batches, setBatches] = useState([])
  const [batchId, setBatchId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [flagFilter, setFlagFilter] = useState('all')
  const [deleting, setDeleting] = useState(false)

  const loadBatches = useCallback(async () => {
    if (isProduction) return
    setError('')
    try {
      const list = await listImportBatches(datasetKey, { country: countryTag })
      setBatches(list)
      setBatchId((cur) => (list.some((b) => b.batch_id === cur) ? cur : (list[0]?.batch_id || '')))
    } catch (err) {
      setError(toUserMessage(err, 'Could not load saved batches.'))
    }
  }, [datasetKey, countryTag, isProduction])

  useEffect(() => { loadBatches() }, [loadBatches])

  const loadRows = useCallback(async () => {
    if (isProduction || !batchId) { setRows([]); return }
    setLoading(true); setError('')
    try {
      const data = await listImportRows(datasetKey, { batch_id: batchId, country: countryTag })
      setRows(datasetKey === 'change' ? deriveTyreActivity(data) : data)
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the batch rows.'))
    } finally { setLoading(false) }
  }, [datasetKey, batchId, countryTag, isProduction])

  useEffect(() => { loadRows() }, [loadRows])

  const filtered = useMemo(() => {
    let out = rows
    if (datasetKey === 'change' && flagFilter !== 'all') {
      out = out.filter((r) => (flagFilter === 'active' ? r.is_active : flagFilter === 'old' ? !r.is_active : (r.warnings?.length > 0 || r.chain_ok === false)))
    }
    const q = search.trim().toLowerCase()
    if (q) {
      out = out.filter((r) => Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(q)))
    }
    return out
  }, [rows, search, flagFilter, datasetKey])

  const displayCols = dataset.columns.map((c) => c.key)

  async function onDelete() {
    if (!batchId || !window.confirm('Delete this saved batch? Every row in it is removed from the review table.')) return
    setDeleting(true); setError('')
    try {
      await deleteImportBatch(datasetKey, batchId)
      setBatchId(''); setRows([])
      await loadBatches()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the batch.'))
    } finally { setDeleting(false) }
  }

  function onExport() {
    if (!filtered.length) return
    const cols = datasetKey === 'change' ? ['source_row', 'is_active', 'chain_ok', ...displayCols] : ['source_row', ...displayCols]
    const headers = cols.map((c) => (c === 'is_active' ? 'Active' : c === 'chain_ok' ? 'Chain OK' : c))
    const flat = filtered.map((r) => {
      const o = {}
      for (const c of cols) o[c] = c === 'is_active' ? (r.is_active ? 'Active' : 'Old') : r[c] ?? ''
      return o
    })
    exportToExcel(flat, cols, headers, `ERP ${dataset.label} ${batchId.slice(0, 8)}`)
  }

  if (isProduction) {
    return (
      <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-6 text-sm text-[var(--text-secondary)] flex gap-3">
        <Info size={18} className="shrink-0 text-sky-400" />
        <p>Production m3 loads directly into the live production log (it is not staged for review). Review and edit m3 entries on the Cost Center page under "Cost per unit".</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm flex gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Saved batch</label>
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm min-w-[280px]"
          >
            {batches.length === 0 && <option value="">No saved batches</option>}
            {batches.map((b) => (
              <option key={b.batch_id} value={b.batch_id}>
                {fmtDate(b.created_at)} | {b.count.toLocaleString()} rows{b.country ? ` (${b.country})` : ''}
              </option>
            ))}
          </select>
        </div>
        <button onClick={loadBatches} className="px-3 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-sm flex items-center gap-2">
          <RefreshCw size={14} /> Refresh
        </button>
        {datasetKey === 'change' && (
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Show</label>
            <select value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)} className="bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm">
              <option value="all">All fitments</option>
              <option value="active">Current (active)</option>
              <option value="old">Old / history</option>
              <option value="flagged">Flagged only</option>
            </select>
          </div>
        )}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-[var(--text-muted)] mb-1">Search</label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search any field"
              className="w-full bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-lg pl-8 pr-3 py-2 text-sm"
            />
          </div>
        </div>
        <button onClick={onExport} disabled={!filtered.length} className="px-3 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-sm flex items-center gap-2 disabled:opacity-50">
          <Download size={14} /> Excel
        </button>
        <button onClick={onDelete} disabled={!batchId || deleting || !canWrite} className="px-3 py-2 rounded-lg bg-red-900/40 hover:bg-red-900/60 text-red-200 text-sm flex items-center gap-2 disabled:opacity-50" title={canWrite ? 'Delete this batch' : 'Requires Admin / Manager / Director'}>
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete batch
        </button>
      </div>

      {loading
        ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-10 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading rows...
          </div>
        )
        : !batchId
          ? (
            <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-8 text-center text-sm text-[var(--text-muted)]">
              No saved {dataset.label} batches yet. Import a file to create one.
            </div>
          )
          : filtered.length === 0
            ? (
              <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-8 text-center text-sm text-[var(--text-muted)]">
                No rows match the current filters.
              </div>
            )
            : (
              <>
                <p className="text-xs text-[var(--text-muted)]">{filtered.length.toLocaleString()} row(s)</p>
                <div className="overflow-x-auto border border-[var(--border-dim)] rounded-xl max-h-[600px]">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-[var(--surface-2)] text-[var(--text-secondary)] sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-2">#</th>
                        {datasetKey === 'change' && <th className="text-left px-2 py-2">Flags</th>}
                        {displayCols.map((c) => <th key={c} className="text-left px-2 py-2">{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 2000).map((r, i) => (
                        <tr key={r.id || i} className="border-t border-[var(--border-dim)]">
                          <td className="px-2 py-1.5 text-[var(--text-muted)]">{r.source_row}</td>
                          {datasetKey === 'change' && <td className="px-2 py-1.5"><FlagCell row={r} datasetKey="change" /></td>}
                          {displayCols.map((c) => (
                            <td key={c} className="px-2 py-1.5 text-[var(--text-secondary)]">
                              {r[c] == null || r[c] === '' ? <span className="text-[var(--text-dim)]">-</span> : String(r[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filtered.length > 2000 && (
                  <p className="text-xs text-[var(--text-muted)]">Showing the first 2,000 rows. Export to Excel for the full batch.</p>
                )}
              </>
            )}
    </div>
  )
}

function Stat({ label, value, color, small }) {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`font-bold ${small ? 'text-base' : 'text-2xl'} ${color}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}
