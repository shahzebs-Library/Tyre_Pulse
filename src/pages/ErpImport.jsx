import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Upload, FileSpreadsheet, Database, Loader2, AlertTriangle, CheckCircle2,
  Trash2, Download, Search, ArrowRight, RefreshCw, Info, Rocket, Undo2, ShieldCheck,
  Layers, History, Percent,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import { parseWorkbook } from '../lib/import'
import {
  DATASET_LIST, DATASETS, mapSheetToRows, deriveTyreActivity, validateExpense,
  isEmptyMappedRow, rowHasKey, sheetMatchQuality, normHeader,
} from '../lib/erpImport'
import {
  listImportBatches, listImportRows, saveImportRows, deleteImportBatch,
  previewPromotion, applyPromotion, undoPromotion, promotionStatus,
} from '../lib/api/erpImport'
import { createProductionBulk } from '../lib/api/production'
import { exportToExcel } from '../lib/exportUtils'
import { configNum } from '../lib/api/systemConfig'
import { downloadErpTemplates } from '../lib/erpTemplates'
import { toUserMessage } from '../lib/safeError'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import StatTile from '../components/ui/StatTile'
import {
  humanizeKey, flagsOf, summarizeRows, filterReviewRows, reviewExportRows,
  summarizeBatches, capOverflow, matchRate,
} from '../lib/erpImportAnalytics'

const ELEVATED = ['admin', 'manager', 'director']
const PREVIEW_LIMIT = 500
const ROW_CAP = 100000

function newBatchId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch { /* fall through */ }
  return 'b-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2, 10)
}

/**
 * Auto-detect the sheet whose name matches a dataset's template tab.
 *
 * Falling back to sheet 0 when nothing matches is kept ONLY for a single-sheet
 * workbook, where there is no other sheet it could mean. In a multi-tab
 * workbook that fallback silently mapped the wrong tab against the wrong column
 * set and produced rows in which every business column was null - the user was
 * told "Saved 18 of 18 rows" for a sheet nothing had been read from. When
 * several sheets are present and none matches, the user picks.
 */
function detectSheetIndex(sheets, dataset) {
  const list = sheets || []
  if (!list.length) return -1
  const wanted = new Set((dataset.tabAliases || []).map(normHeader))
  const idx = list.findIndex((s) => wanted.has(normHeader(s.name)))
  if (idx >= 0) return idx
  return list.length === 1 ? 0 : -1
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
  // {done,total} while a long save runs, so the button is not a dead spinner
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [saveResult, setSaveResult] = useState(null)

  const sheet = parsed?.sheets?.[sheetIdx] || null

  // Mapped rows for the currently selected sheet + dataset.
  //
  // A row without the dataset's identifying value is dropped. "Not every column
  // is null" was the old test and it was far too weak: one incidental alias hit
  // was enough to save rows carrying no asset, serial, date or job card.
  const mapped = useMemo(() => {
    if (!sheet) return []
    const rows = mapSheetToRows(datasetKey, sheet.rows || [])
    return rows.filter((r) => rowHasKey(datasetKey, r))
  }, [sheet, datasetKey])

  // How well this sheet matched, so the page can say so instead of saving
  // content-free rows and calling it a success.
  const match = useMemo(() => {
    if (!sheet) return null
    return sheetMatchQuality(datasetKey, mapSheetToRows(datasetKey, sheet.rows || []))
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

  const summary = useMemo(() => summarizeRows(derived, datasetKey), [derived, datasetKey])

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
        // Chunked, not one request per row. The per-row loop this replaces cost
        // a round trip per line, so a 10,000 row file took about 27 minutes.
        const kept = mapped.slice(0, ROW_CAP)
        const { saved, failures } = await createProductionBulk(
          kept.map((r) => ({
            site: r.site, asset_no: r.asset_no, period_date: r.period_date,
            m3: r.m3, source: r.source || 'ERP import', notes: r.notes,
            country: countryTag, source_row: r.source_row,
          })),
          { onProgress: (done, total) => setProgress({ done, total }) },
        )
        setProgress(null)
        setSaveResult({
          dataset: 'production', saved, requested: mapped.length,
          capped: Math.max(0, mapped.length - ROW_CAP), failures,
          batch_id: null,
        })
      } else {
        const batchId = newBatchId()
        const res = await saveImportRows(datasetKey, mapped, batchId, {
          country: countryTag,
          onProgress: (done, total) => setProgress({ done, total }),
        })
        setProgress(null)
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
    } finally { setBusy(false); setProgress(null) }
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1800px] mx-auto text-[var(--text-primary)]">
      <PageHeader
        title="ERP Data Import"
        subtitle="Parse a filled ERP template and save rows into a review table you can check, export and delete."
        icon={Database}
        showBack
      />

      {/* Tabs */}
      <div role="tablist" aria-label="ERP import sections" className="flex flex-wrap items-center gap-2 my-5">
        {[['import', 'Import', Upload], ['review', 'Review & promote', Search]].map(([k, label, Icon]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-[44px] px-4 py-2 rounded-lg text-sm flex items-center gap-2 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${tab === k ? 'bg-green-600 border-green-600 text-white' : 'bg-[var(--surface-1)] border-[var(--border-bright)] hover:border-green-500/40'}`}
          >
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      {/* Dataset picker (shared) */}
      <div className="mb-5" role="group" aria-labelledby="erp-dataset-label">
        <p id="erp-dataset-label" className="block text-sm text-[var(--text-secondary)] mb-2">Dataset</p>
        <div className="flex flex-wrap gap-2">
          {DATASET_LIST.map((d) => (
            <button
              key={d.key}
              aria-pressed={datasetKey === d.key}
              onClick={() => { setDatasetKey(d.key); setError('') }}
              className={`min-h-[44px] px-4 py-2 rounded-lg text-sm border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${datasetKey === d.key ? 'bg-green-600 border-green-600 text-white' : 'bg-[var(--surface-1)] border-[var(--border-bright)] hover:border-green-500/40'}`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-2 flex items-center gap-1.5">
          <Info size={13} aria-hidden="true" className="shrink-0" />
          {datasetKey === 'production'
            ? 'Production m3 loads directly into the live Cost Center production log.'
            : 'Rows are saved to a review table first. When you are happy with the batch, open the Review tab and Promote it into the master tables (assets, tyres or costs). Promotion is reversible.'}
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-4 bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-red-500 text-sm flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" /> <span>{error}</span>
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
            progress={progress}
            mapped={mapped}
            match={match}
            derived={derived}
            summary={summary}
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
  setSheetIdx, busy, progress, mapped, match, derived, summary, onFile, onSave, onReset,
  saveResult,
}) {
  const previewRows = useMemo(() => derived.slice(0, PREVIEW_LIMIT), [derived])
  const previewColumns = useDatasetColumns(dataset, datasetKey, { withFlags: datasetKey === 'change' || datasetKey === 'expense' })
  const overflow = capOverflow(mapped.length, ROW_CAP)
  const rate = matchRate(match)

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
        <div role="status" className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3 text-amber-500 text-sm flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" /> Only Admin, Manager, or Director can save imports. You can still preview a file.
        </div>
      )}

      {/* Downloadable ERP templates - collapsed by default so the upload is the
          first thing on screen; the vendor hand-off is a one-off task. */}
      <details className="group bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl">
        <summary className="flex items-center gap-3 p-4 cursor-pointer list-none min-h-[44px] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">
          <FileSpreadsheet size={18} className="shrink-0 text-green-500" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-[var(--text-primary)]">Download import templates</span>
            <span className="block text-xs text-[var(--text-muted)] mt-0.5">Send these to your ERP vendor, then upload the filled file below.</span>
          </span>
          <span className="text-xs text-[var(--text-muted)] group-open:hidden">Show</span>
          <span className="text-xs text-[var(--text-muted)] hidden group-open:inline">Hide</span>
        </summary>
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Every sheet header is exactly what the importer expects, so a filled file maps automatically on upload.
          </p>
          {tplErr && (
            <div role="alert" className="bg-red-500/10 border border-red-500/40 rounded-lg p-2.5 text-red-500 text-xs flex gap-2">
              <AlertTriangle size={14} className="shrink-0" aria-hidden="true" /> {tplErr}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleTemplate(null)}
              disabled={tplBusy}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
            >
              {tplBusy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
              Download all templates
            </button>
            <button
              onClick={() => handleTemplate([datasetKey])}
              disabled={tplBusy}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] text-sm flex items-center gap-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
            >
              <Download size={15} aria-hidden="true" /> {dataset.label} template
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            One workbook with four sheets: Asset Master, Tyre Change Log, Tyre Expense (Purchase) and Production m3. Each sheet has the header row plus an example row and a format hint row.
          </p>
        </div>
      </details>

      {/* File chooser. The input stays in the tab order (sr-only, not hidden)
          so a keyboard user can open the picker. */}
      <label className="block border-2 border-dashed border-[var(--border-bright)] rounded-xl p-6 sm:p-8 text-center cursor-pointer hover:border-green-600/60 focus-within:ring-2 focus-within:ring-green-500">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt" className="sr-only" onChange={onFile} aria-label={`Choose the filled ERP template for ${dataset.label}`} />
        {busy && !parsed
          ? <Loader2 className="animate-spin mx-auto text-green-500" aria-hidden="true" />
          : <Upload className="mx-auto text-[var(--text-muted)]" size={32} aria-hidden="true" />}
        <p className="mt-2 text-sm text-[var(--text-secondary)] break-all">
          {busy && !parsed ? 'Reading file...' : fileName || `Choose the filled ERP template (.xlsx) for ${dataset.label}`}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">The matching tab is detected automatically. If not found, pick the sheet below.</p>
      </label>

      {parsed?.sheets?.length > 0 && (
        <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 space-y-3">
          <p className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
            <FileSpreadsheet size={15} aria-hidden="true" /> {parsed.sheets.length} sheet(s). Selected tab feeds the {dataset.label} mapping.
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Workbook sheets">
            {parsed.sheets.map((s, i) => (
              <button
                key={s.name + i}
                aria-pressed={i === sheetIdx}
                onClick={() => setSheetIdx(i)}
                className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${i === sheetIdx ? 'bg-green-600 border-green-600 text-white' : 'bg-[var(--surface-2)] border-[var(--border-bright)] hover:bg-[var(--surface-3)]'}`}
              >
                {s.name} <span className="opacity-70">({(s.rows || []).length})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* KPI strip */}
      {sheet && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatTile label="Rows mapped" value={summary.rows.toLocaleString()} icon={Layers} />
          <StatTile label="Key match rate" value={rate == null ? 'N/A' : `${rate}%`} sub={match ? `${match.keyed.toLocaleString()} of ${match.read.toLocaleString()} read rows carry ${match.keyField || 'a key'}` : undefined} tone={rate != null && rate < 90 ? 'warn' : 'accent'} icon={Percent} />
          {datasetKey === 'change' && <StatTile label="Current (active)" value={(summary.active ?? 0).toLocaleString()} tone="accent" icon={CheckCircle2} />}
          {datasetKey === 'change' && <StatTile label="Old / history" value={(summary.old ?? 0).toLocaleString()} tone="info" icon={History} />}
          <StatTile label="Rows flagged" value={summary.flagged.toLocaleString()} sub={summary.flaggedPct == null ? undefined : `${summary.flaggedPct}% of mapped rows`} tone={summary.flagged ? 'warn' : 'neutral'} icon={AlertTriangle} />
          <StatTile label="Country tag" value={countryTag || 'None'} sub={countryTag ? undefined : 'Pick a country in the top bar to stamp rows'} icon={Database} />
        </div>
      )}

      {/* Large-file honesty note */}
      {overflow > 0 && (
        <div role="status" className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 text-amber-500 text-sm flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
          This sheet has {mapped.length.toLocaleString()} rows. The browser import saves the first {ROW_CAP.toLocaleString()}; {overflow.toLocaleString()} would be left behind. For very large files (100k+ rows) use the server load. Contact an administrator.
        </div>
      )}

      {/* Preview */}
      {sheet && mapped.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--text-secondary)]">
            Preview of the first {Math.min(PREVIEW_LIMIT, mapped.length).toLocaleString()} of {mapped.length.toLocaleString()} mapped rows. Every mapped row is saved, not only the preview.
          </p>
          <EnterpriseTable
            columns={previewColumns}
            data={previewRows}
            getRowId={(r, i) => `${r.source_row ?? 'r'}-${i}`}
            enableColumnFilters={false}
            searchPlaceholder="Search the preview..."
            initialPageSize={25}
            exportFileName={`ERP ${dataset.label} preview`}
            reportMeta={{ title: `ERP ${dataset.label} import preview` }}
            emptyMessage="No rows to preview."
          />
        </div>
      )}

      {/* A sheet that produced rows but no IDENTIFIABLE rows is the wrong sheet.
          Saying so is the whole point: this exact case previously saved 18 rows
          in which every business column was null and reported it as a success. */}
      {sheet && match?.unusable && (
        <div role="alert" className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-sm space-y-1">
          <p className="text-amber-500 flex items-center gap-2">
            <AlertTriangle size={16} aria-hidden="true" />
            This does not look like a {dataset.label} sheet.
          </p>
          <p className="text-[var(--text-secondary)]">
            {match.read.toLocaleString()} row(s) were read and none of them has a
            {' '}<span className="text-[var(--text-primary)] font-medium">{match.keyField}</span>, which is the value
            {' '}{dataset.label} rows are identified by. Nothing will be saved from it.
            Pick the tab that holds your {dataset.label} data, or switch the type above.
          </p>
        </div>
      )}

      {sheet && mapped.length === 0 && !match?.unusable && (
        <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-6 text-center text-sm text-[var(--text-muted)]">
          No rows mapped from this sheet. Check that you selected the right tab for {dataset.label}.
        </div>
      )}

      {parsed && sheetIdx < 0 && (
        <div role="status" className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 text-sm text-[var(--text-muted)]">
          No tab in this workbook is named like a {dataset.label} sheet. Choose the right one above.
        </div>
      )}

      {/* Save result */}
      {saveResult && (
        <div role="status" className="bg-green-500/10 border border-green-500/40 rounded-xl p-4 text-sm space-y-1">
          <p className="text-green-500 flex items-center gap-2">
            <CheckCircle2 size={16} aria-hidden="true" />
            Saved {saveResult.saved.toLocaleString()} of {saveResult.requested.toLocaleString()} row(s)
            {saveResult.dataset === 'production' ? ' into the live production log.' : ' to the review table.'}
          </p>
          {saveResult.capped > 0 && (
            <p className="text-amber-500">{saveResult.capped.toLocaleString()} row(s) beyond the {ROW_CAP.toLocaleString()} browser cap were not saved. Use the server load for the rest.</p>
          )}
          {saveResult.failures?.length > 0 && (
            <p className="text-amber-500">{saveResult.failures.length} row(s) failed: {saveResult.failures.slice(0, 3).join('; ')}{saveResult.failures.length > 3 ? ' ...' : ''}</p>
          )}
          {saveResult.dataset !== 'production' && (
            <p className="text-[var(--text-secondary)]">Open the Review tab to check the batch, then Promote it into the master tables when it looks right.</p>
          )}
        </div>
      )}

      {/* Progress */}
      {progress && progress.total > 0 && (
        <div className="space-y-1" aria-live="polite">
          <div className="flex justify-between text-xs text-[var(--text-muted)]">
            <span>Saving {progress.done.toLocaleString()} of {progress.total.toLocaleString()}</span>
            <span>{Math.round((progress.done / progress.total) * 100)}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="h-full bg-green-600 transition-[width] duration-300" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSave}
          disabled={busy || !canWrite || mapped.length === 0 || !!saveResult}
          className="min-h-[44px] px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
          {/* Show real counts while saving. A spinner alone on a multi-minute
              upload is indistinguishable from a hung tab. */}
          {progress
            ? `Saving ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`
            : datasetKey === 'production' ? 'Save to production log' : 'Save to review table'}
        </button>
        {(parsed || saveResult) && (
          <button onClick={onReset} className="min-h-[44px] px-4 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] text-sm flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400">
            <RefreshCw size={15} aria-hidden="true" /> New file
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * EnterpriseTable column defs for a dataset: source row, optional flags, then
 * one column per staging column. Blank cells read N/A (never a fabricated 0).
 */
function useDatasetColumns(dataset, datasetKey, { withFlags } = {}) {
  return useMemo(() => {
    const cols = [
      { id: 'source_row', header: '#', accessorFn: (r) => Number(r.source_row) || 0, size: 70, meta: { align: 'right' },
        cell: ({ row }) => <span className="text-[var(--text-muted)]">{row.original.source_row ?? 'N/A'}</span> },
    ]
    if (withFlags) {
      cols.push({
        id: 'flags', header: 'Flags', accessorFn: (r) => flagsOf(r, datasetKey).join(', '), size: 170,
        cell: ({ row }) => <FlagCell row={row.original} datasetKey={datasetKey} />,
      })
    }
    for (const c of dataset.columns) {
      cols.push({
        id: c.key,
        header: humanizeKey(c.key),
        accessorFn: (r) => (r[c.key] == null || r[c.key] === '' ? '' : r[c.key]),
        size: 150,
        meta: { exportHeader: c.key, exportValue: (r) => (r[c.key] == null || r[c.key] === '' ? '' : r[c.key]), align: c.type === 'num' || c.type === 'int' ? 'right' : undefined },
        cell: ({ row }) => {
          const v = row.original[c.key]
          return v == null || v === ''
            ? <span className="text-[var(--text-dim)]">N/A</span>
            : <span className="text-[var(--text-secondary)] whitespace-nowrap">{String(v)}</span>
        },
      })
    }
    return cols
  }, [dataset, datasetKey, withFlags])
}

/* ── Promotion panel (staging -> master tables) ──────────────────────────────
 * The step the page used to be missing. Preview (dry run) the exact counts a
 * promotion would move, apply it into the master tables, and undo it - all
 * reversible and idempotent (server side V415).
 */
function fmtPromoMoney(byCountry) {
  if (!byCountry || typeof byCountry !== 'object') return null
  const parts = Object.entries(byCountry).map(([c, v]) => {
    if (v && typeof v === 'object') {
      const n = Number(v.count || 0)
      const val = Number(v.value || 0)
      return `${c}: ${n.toLocaleString()} line(s), ${val.toLocaleString()} ${v.currency || ''}`.trim()
    }
    return `${c}: ${Number(v || 0).toLocaleString()}`
  })
  return parts.length ? parts.join(' | ') : null
}

function PromoteSummary({ datasetKey, res, applied }) {
  if (!res) return null
  const verb = applied ? 'Promoted' : 'Would promote'
  if (datasetKey === 'asset') {
    const updated = Number(res.updated || 0)
    const exact = Number(res.exact_duplicates || 0)
    return (
      <div className="text-sm space-y-0.5">
        <p>{verb} <b>{Number(res.to_insert_total || 0).toLocaleString()}</b> new asset(s) into the fleet register.</p>
        {updated > 0 && <p className="text-[var(--text-muted)]">{updated.toLocaleString()} same-key asset(s) refreshed with changed supplied values.</p>}
        {exact > 0 && <p className="text-[var(--text-muted)]">{exact.toLocaleString()} exact duplicate(s) dropped.</p>}
        {fmtPromoMoney(res.to_insert_by_country) && <p className="text-[var(--text-muted)]">By country: {fmtPromoMoney(res.to_insert_by_country)}</p>}
        {res.skipped_no_asset_no > 0 && <p className="text-amber-500">{res.skipped_no_asset_no.toLocaleString()} row(s) skipped - no asset number.</p>}
      </div>
    )
  }
  if (datasetKey === 'change') {
    const updated = Number(res.updated || 0)
    const exact = Number(res.exact_duplicates ?? res.already_present ?? 0)
    return (
      <div className="text-sm space-y-0.5">
        <p>{verb} <b>{Number(res.to_insert_total || 0).toLocaleString()}</b> tyre record(s) ({Number(res.to_insert_active || 0).toLocaleString()} current, {Number(res.to_insert_old || 0).toLocaleString()} history).</p>
        {fmtPromoMoney(res.to_insert_by_country) && <p className="text-[var(--text-muted)]">By country: {fmtPromoMoney(res.to_insert_by_country)}</p>}
        {updated > 0 && <p className="text-[var(--text-muted)]">{updated.toLocaleString()} same-fitment row(s) refreshed.</p>}
        {exact > 0 && <p className="text-[var(--text-muted)]">{exact.toLocaleString()} exact duplicate(s) dropped.</p>}
        {res.skipped_no_key > 0 && <p className="text-amber-500">{res.skipped_no_key.toLocaleString()} row(s) skipped - missing serial or asset.</p>}
        {res.active_position_conflicts > 0 && <p className="text-amber-500">{res.active_position_conflicts.toLocaleString()} landed as history - that asset/position already had an active tyre.</p>}
      </div>
    )
  }
  return (
    <div className="text-sm space-y-0.5">
      <p>{verb} <b>{Number(res.to_insert_total || 0).toLocaleString()}</b> tyre cost line(s) into the expense grid.</p>
      {fmtPromoMoney(res.by_country) && <p className="text-[var(--text-muted)]">{fmtPromoMoney(res.by_country)}</p>}
      {res.already_present > 0 && <p className="text-[var(--text-muted)]">{res.already_present.toLocaleString()} exact duplicate cost line(s) dropped.</p>}
      {res.skipped_no_cost > 0 && <p className="text-amber-500">{res.skipped_no_cost.toLocaleString()} row(s) skipped - no cost.</p>}
    </div>
  )
}

const MASTER_LABEL = { asset: 'fleet register', change: 'tyre records', expense: 'expense grid' }

function PromotePanel({ datasetKey, batchId, canWrite, onChanged }) {
  const [status, setStatus] = useState(null)
  const [preview, setPreview] = useState(null)
  const [applied, setApplied] = useState(null)
  const [busy, setBusy] = useState('')   // '', 'status', 'preview', 'apply', 'undo'
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    if (!batchId) { setStatus(null); return }
    setBusy('status'); setError('')
    try { setStatus(await promotionStatus(datasetKey, batchId)) }
    catch (err) { setError(toUserMessage(err, 'Could not read promotion status.')) }
    finally { setBusy('') }
  }, [datasetKey, batchId])

  // Reset the panel whenever the selected batch or dataset changes.
  useEffect(() => { setPreview(null); setApplied(null); setError(''); loadStatus() }, [loadStatus])

  async function onPreview() {
    setBusy('preview'); setError(''); setApplied(null)
    try { setPreview(await previewPromotion(datasetKey, batchId)) }
    catch (err) { setError(toUserMessage(err, 'Could not preview the promotion.')) }
    finally { setBusy('') }
  }

  async function onApply() {
    if (!window.confirm(`Promote this batch into the ${MASTER_LABEL[datasetKey]}? You can undo it afterwards.`)) return
    setBusy('apply'); setError('')
    try {
      const res = await applyPromotion(datasetKey, batchId)
      setApplied(res); setPreview(null)
      await loadStatus()
      onChanged?.()
    } catch (err) { setError(toUserMessage(err, 'Could not promote the batch.')) }
    finally { setBusy('') }
  }

  async function onUndo() {
    if (!window.confirm(`Undo this promotion? Every row this batch added to the ${MASTER_LABEL[datasetKey]} is removed.`)) return
    setBusy('undo'); setError('')
    try {
      const res = await undoPromotion(datasetKey, batchId)
      setApplied(null); setPreview(null)
      setError('')
      await loadStatus()
      onChanged?.()
      window.alert(`Undone. ${Number(res?.deleted || 0).toLocaleString()} row(s) removed from the ${MASTER_LABEL[datasetKey]}.`)
    } catch (err) { setError(toUserMessage(err, 'Could not undo the promotion.')) }
    finally { setBusy('') }
  }

  if (!batchId) return null
  const isPromoted = status?.promoted
  const anyBusy = !!busy

  return (
    <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <ShieldCheck size={18} className="shrink-0 text-green-500 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-[var(--text-primary)]">Promote to the {MASTER_LABEL[datasetKey]}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Move every valid reviewed row into the master tables. Changed same-key rows refresh; only exact copies are dropped. Preview the counts first.
          </p>
          {isPromoted && (
            <p className="text-xs text-green-500 mt-1.5 flex items-center gap-1.5">
              <CheckCircle2 size={13} />
              Promotion complete: {Number(status.inserted || 0).toLocaleString()} added, {Number(status.updated || 0).toLocaleString()} refreshed, {Number(status.exact_duplicates ?? status.existing ?? 0).toLocaleString()} exact duplicate(s) dropped.
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-2.5 text-red-500 text-xs flex gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {preview && !applied && (
        <div className="bg-sky-500/10 border border-sky-500/40 rounded-lg p-3 text-[var(--text-secondary)]">
          <p className="text-sky-500 text-xs font-medium mb-1">Preview (nothing written yet)</p>
          <PromoteSummary datasetKey={datasetKey} res={preview} applied={false} />
        </div>
      )}
      {applied && (
        <div className="bg-green-500/10 border border-green-500/40 rounded-lg p-3 text-[var(--text-secondary)]">
          <p className="text-green-500 text-xs font-medium mb-1 flex items-center gap-1.5"><CheckCircle2 size={13} /> Promoted</p>
          <PromoteSummary datasetKey={datasetKey} res={applied} applied />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onPreview}
          disabled={anyBusy}
          className="px-3 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-sm flex items-center gap-2 disabled:opacity-50"
        >
          {busy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Preview promotion
        </button>
        <button
          onClick={onApply}
          disabled={anyBusy || !canWrite}
          title={canWrite ? 'Promote into the master tables' : 'Requires Admin / Manager / Director'}
          className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50"
        >
          {busy === 'apply' ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />} Promote to system
        </button>
        {isPromoted && (
          <button
            onClick={onUndo}
            disabled={anyBusy || !canWrite}
            title={canWrite ? 'Remove the rows this batch added' : 'Requires Admin / Manager / Director'}
            className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {busy === 'undo' ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Undo promotion
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
          ? <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">Active</span>
          : <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-500">Old</span>
      )}
      {datasetKey === 'change' && row.chain_ok === false && (
        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500" title="Chain break">Chain</span>
      )}
      {datasetKey === 'expense' && row._hasChangeTab && !row.serial_in_change && (
        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500" title="No matching fitment">No fitment</span>
      )}
      {warns.length > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-500" title={warns.join('; ')}>
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
  const [batchesLoading, setBatchesLoading] = useState(false)
  const [batchesError, setBatchesError] = useState('')
  const [batchId, setBatchId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [rowsError, setRowsError] = useState('')
  const [actionError, setActionError] = useState('')
  const [search, setSearch] = useState('')
  const [flagFilter, setFlagFilter] = useState('all')
  const [deleting, setDeleting] = useState(false)
  const [now] = useState(() => new Date())

  const loadBatches = useCallback(async () => {
    if (isProduction) return
    setBatchesError(''); setBatchesLoading(true)
    try {
      const list = await listImportBatches(datasetKey, { country: countryTag })
      setBatches(list)
      setBatchId((cur) => (list.some((b) => b.batch_id === cur) ? cur : (list[0]?.batch_id || '')))
    } catch (err) {
      setBatchesError(toUserMessage(err, 'Could not load saved batches.'))
    } finally { setBatchesLoading(false) }
  }, [datasetKey, countryTag, isProduction])

  useEffect(() => { loadBatches() }, [loadBatches])

  const loadRows = useCallback(async () => {
    if (isProduction || !batchId) { setRows([]); return }
    setLoading(true); setRowsError('')
    try {
      const data = await listImportRows(datasetKey, { batch_id: batchId, country: countryTag })
      setRows(datasetKey === 'change' ? deriveTyreActivity(data) : data)
    } catch (err) {
      setRowsError(toUserMessage(err, 'Could not load the batch rows.'))
    } finally { setLoading(false) }
  }, [datasetKey, batchId, countryTag, isProduction])

  useEffect(() => { loadRows() }, [loadRows])

  // Reset a dataset-specific flag filter when the dataset changes.
  useEffect(() => { setFlagFilter('all') }, [datasetKey])

  const filtered = useMemo(
    () => filterReviewRows(rows, { search, flag: flagFilter, datasetKey }),
    [rows, search, flagFilter, datasetKey],
  )
  const batchSummary = useMemo(() => summarizeBatches(batches, now), [batches, now])
  const rowSummary = useMemo(() => summarizeRows(rows, datasetKey), [rows, datasetKey])
  const columns = useDatasetColumns(dataset, datasetKey, { withFlags: datasetKey === 'change' })
  const displayCols = dataset.columns.map((c) => c.key)
  const filtersActive = !!search.trim() || flagFilter !== 'all'

  async function onDelete() {
    if (!batchId || !window.confirm('Delete this saved batch? Every row in it is removed from the review table.')) return
    setDeleting(true); setActionError('')
    try {
      await deleteImportBatch(datasetKey, batchId)
      setBatchId(''); setRows([])
      await loadBatches()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the batch.'))
    } finally { setDeleting(false) }
  }

  function onExport() {
    if (!filtered.length) return
    const { cols, headers, flat } = reviewExportRows(filtered, displayCols, datasetKey)
    exportToExcel(flat, cols, headers, `ERP ${dataset.label} ${batchId.slice(0, 8)}`)
  }

  if (isProduction) {
    return (
      <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-6 text-sm text-[var(--text-secondary)] flex gap-3">
        <Info size={18} className="shrink-0 text-sky-500" aria-hidden="true" />
        <p>Production m3 loads directly into the live production log (it is not staged for review). Review and edit m3 entries on the Cost Center page under "Cost per unit".</p>
      </div>
    )
  }

  const selectCls = 'min-h-[44px] bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500'
  const btnCls = 'min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] text-sm flex items-center gap-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400'

  return (
    <div className="space-y-4">
      {batchesError && (
        <div role="alert" className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-red-500 text-sm flex flex-wrap items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" aria-hidden="true" /> <span className="flex-1 min-w-0">{batchesError}</span>
          <button onClick={loadBatches} className={btnCls}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && (
        <div role="alert" className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-red-500 text-sm flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" /> {actionError}
        </div>
      )}

      {/* KPI strip - batches are whole-dataset figures; the row figures cover the selected batch. */}
      {!batchesError && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatTile label="Saved batches" value={batchesLoading ? '...' : batchSummary.batches.toLocaleString()} icon={Layers} />
          <StatTile label="Rows staged (all batches)" value={batchesLoading ? '...' : batchSummary.rows.toLocaleString()} icon={Database} />
          <StatTile label="Latest batch" value={batchesLoading ? '...' : batchSummary.latestAgeDays == null ? 'N/A' : batchSummary.latestAgeDays === 0 ? 'Today' : `${batchSummary.latestAgeDays}d ago`} icon={History} />
          <StatTile label="Rows in this batch" value={loading ? '...' : batchId ? rowSummary.rows.toLocaleString() : 'N/A'} icon={FileSpreadsheet} />
          {datasetKey === 'change'
            ? <StatTile label="Current / history" value={loading ? '...' : batchId ? `${(rowSummary.active ?? 0).toLocaleString()} / ${(rowSummary.old ?? 0).toLocaleString()}` : 'N/A'} tone="info" icon={CheckCircle2} />
            : <StatTile label="Countries" value={batchesLoading ? '...' : batchSummary.countries.length ? batchSummary.countries.join(', ') : 'N/A'} icon={Info} />}
          <StatTile label="Flagged rows" value={loading ? '...' : batchId ? rowSummary.flagged.toLocaleString() : 'N/A'} sub={batchId && rowSummary.flaggedPct != null ? `${rowSummary.flaggedPct}% of this batch` : undefined} tone={rowSummary.flagged ? 'warn' : 'neutral'} icon={AlertTriangle} />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 w-full sm:w-auto">
          <label htmlFor="erp-batch" className="block text-xs text-[var(--text-muted)] mb-1">Saved batch</label>
          <select
            id="erp-batch"
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className={`${selectCls} w-full sm:min-w-[280px]`}
          >
            {batches.length === 0 && <option value="">{batchesLoading ? 'Loading batches...' : 'No saved batches'}</option>}
            {batches.map((b) => (
              <option key={b.batch_id} value={b.batch_id}>
                {fmtDate(b.created_at)} | {b.count.toLocaleString()} rows{b.country ? ` (${b.country})` : ''}
              </option>
            ))}
          </select>
        </div>
        <button onClick={loadBatches} disabled={batchesLoading} className={btnCls}>
          <RefreshCw size={14} className={batchesLoading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
        </button>
        <div>
          <label htmlFor="erp-flag" className="block text-xs text-[var(--text-muted)] mb-1">Show</label>
          <select id="erp-flag" value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)} className={selectCls}>
            <option value="all">{datasetKey === 'change' ? 'All fitments' : 'All rows'}</option>
            {datasetKey === 'change' && <option value="active">Current (active)</option>}
            {datasetKey === 'change' && <option value="old">Old / history</option>}
            <option value="flagged">Flagged only</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="erp-search" className="block text-xs text-[var(--text-muted)] mb-1">Search</label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              id="erp-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search any field"
              className={`${selectCls} w-full pl-8`}
            />
          </div>
        </div>
        <button onClick={onExport} disabled={!filtered.length} className={btnCls}>
          <Download size={14} aria-hidden="true" /> Excel (all filtered)
        </button>
        <button onClick={onDelete} disabled={!batchId || deleting || !canWrite} className="min-h-[44px] px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-500 text-sm flex items-center gap-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" title={canWrite ? 'Delete this batch' : 'Requires Admin / Manager / Director'}>
          {deleting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} Delete batch
        </button>
      </div>

      {batchId && (
        <PromotePanel
          datasetKey={datasetKey}
          batchId={batchId}
          canWrite={canWrite}
          onChanged={() => { loadRows(); loadBatches() }}
        />
      )}

      {!batchId && !batchesLoading && !batchesError
        ? (
          <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-8 text-center text-sm text-[var(--text-muted)]">
            No saved {dataset.label} batches yet. Import a file to create one.
          </div>
        )
        : batchId && (
          <div className="space-y-2">
            {!loading && !rowsError && (
              <p className="text-xs text-[var(--text-muted)]">
                {filtersActive ? `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} row(s) match` : `${rows.length.toLocaleString()} row(s)`}
              </p>
            )}
            <EnterpriseTable
              columns={columns}
              data={filtered}
              getRowId={(r, i) => String(r.id ?? `${r.source_row}-${i}`)}
              loading={loading}
              error={rowsError || null}
              onRetry={loadRows}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              initialPageSize={50}
              pageSizeOptions={[25, 50, 100, 250]}
              exportFileName={`ERP ${dataset.label} batch`}
              reportMeta={{ title: `ERP ${dataset.label} review batch` }}
              emptyMessage={filtersActive ? 'No rows match the current filters.' : 'This batch has no rows.'}
            />
          </div>
        )}
    </div>
  )
}
