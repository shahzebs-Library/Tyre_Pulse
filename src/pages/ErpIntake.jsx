/**
 * ErpIntake (route wired separately) - one-stop in-app Data Intake for the customer's
 * Ramco ERP report exports.
 *
 * An admin uploads ANY recognised Ramco export (.xls / .xlsx / .csv) and each sheet is
 * auto-detected and routed to the right destination table:
 *   - Work Order Details / grid  -> parts_consumption (the ONLY cost source)
 *   - Monthly Tyres Consumption  -> tyre_records (tyre lifecycle)
 *   - Vehicle Complaints History -> work_orders (no cost)
 *   - Open Job Cards             -> open_work_orders (replaceable follow-up snapshot)
 *
 * The header often sits on the 3rd row (a title + date-range band is above it) and the
 * last rows are noise (GRAND TOTAL, Printed By, Applied filters); the pure engines
 * (erpIntake / partsExpense) locate the real header and drop the footer automatically.
 *
 * Tri-state, honest flow: choose file -> per-sheet preview (type, destination, row
 * counts, cost intelligence, sample) -> import (progress per sheet, merge-safe) -> done.
 * All errors route through toUserMessage. ASCII only, no dash punctuation.
 */
import { useState, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Upload, FileSpreadsheet, Wand2, CheckCircle2, AlertTriangle, Loader2,
  ArrowRight, Layers, FileText, RotateCcw,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { currencyForCountry } from '../lib/governedCost'
import {
  num, resultSummary, reconcile, previewTotals, resultTotals, importReportRows, REPORT_COLUMNS,
} from '../lib/erpIntakeAnalytics'
import PageHeader from '../components/ui/PageHeader'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { parseWorkbookRaw } from '../lib/import/parseWorkbook'
import { detectReport, intakeSheet } from '../lib/erpIntake'
import { rowsFromSheet, summarizeRows } from '../lib/partsExpense'
import { insertPartsConsumption } from '../lib/api/partsConsumption'
import { loadIntake, countExistingRows } from '../lib/api/erpIntake'
import { checkImportFingerprint, fileSha256 } from '../lib/api/importHistory'

/** Per-report presentation: label + destination-table label. */
const REPORT_META = {
  grid: { label: 'Work Order Details / grid', target: 'parts_consumption', targetLabel: 'Parts Consumption (cost)' },
  monthly_tyres: { label: 'Monthly Tyres Consumption', target: 'tyre_records', targetLabel: 'Tyre Records (lifecycle)' },
  complaints: { label: 'Vehicle Complaints History', target: 'work_orders', targetLabel: 'Work Orders (no cost)' },
  combined: { label: 'Job Cards + Tyre Changes', target: 'work_orders', targetLabel: 'Work Orders + Tyre Records (no cost)' },
  open_wo: { label: 'Open Job Cards', target: 'open_work_orders', targetLabel: 'Open Work Orders (snapshot)' },
}

/** Sample columns to show per non-grid destination table. */
const SAMPLE_COLS = {
  tyre_records: [
    { key: 'serial_no', header: 'Serial' },
    { key: 'asset_no', header: 'Asset' },
    { key: 'position', header: 'Position' },
    { key: 'issue_date', header: 'Fitted' },
    { key: 'removal_date', header: 'Removed' },
    { key: 'removal_reason', header: 'Reason' },
  ],
  work_orders: [
    { key: 'work_order_no', header: 'WO No' },
    { key: 'asset_no', header: 'Asset' },
    { key: 'status', header: 'Status' },
    { key: 'opened_at', header: 'In' },
    { key: 'completed_at', header: 'Out' },
    { key: 'description', header: 'Complaint' },
  ],
  open_work_orders: [
    { key: 'job_card_no', header: 'Job Card' },
    { key: 'asset_no', header: 'Asset' },
    { key: 'jc_status', header: 'Status' },
    { key: 'days_open', header: 'Days Open' },
    { key: 'location', header: 'Location' },
    { key: 'complaint', header: 'Complaint' },
  ],
}

/** One KPI tile. */
function KpiTile({ label, value, sub, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub != null && <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">{sub}</p>}
    </div>
  )
}

/** Full, paged + sortable preview of the mapped rows for one sheet. */
function SamplePreview({ target, rows }) {
  const columns = useMemo(() => (SAMPLE_COLS[target] || []).map((c) => ({
    id: c.key,
    header: c.header,
    accessorFn: (r) => (r[c.key] == null || r[c.key] === '' ? 'N/A' : String(r[c.key])),
    size: c.key === 'description' || c.key === 'complaint' ? 260 : 130,
  })), [target])
  return (
    <EnterpriseTable
      columns={columns}
      data={rows}
      getRowId={(_, i) => String(i)}
      enableExport={false}
      enableColumnFilters={false}
      searchPlaceholder="Search the mapped rows..."
      initialPageSize={25}
      emptyMessage="No data rows mapped from this sheet."
    />
  )
}

export default function ErpIntake() {
  const { activeCountry, activeCurrency } = useSettings()
  // Which country this upload belongs to. Defaults to the active country when a specific
  // one is selected, else KSA. Every imported row is stamped with it so multi-country
  // data stays correctly scoped (org > country > site).
  const [countryChoice, setCountryChoice] = useState(
    activeCountry && activeCountry !== 'All' ? activeCountry : (COUNTRIES[0] || 'KSA'),
  )
  const country = countryChoice || null
  // Money on this page belongs to the UPLOAD's country, not the page's active
  // country, so an Egypt file previewed from a KSA session reads EGP, not SAR.
  const currency = currencyForCountry(countryChoice) || activeCurrency || 'SAR'

  const [phase, setPhase] = useState('idle') // idle | parsing | preview | importing | done
  const [fileName, setFileName] = useState('')
  const [detected, setDetected] = useState([]) // [{ sheetName, type, target, targetLabel, label, rows, dropped, summary }]
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState({ sheetIdx: 0, d: 0, t: 0 })
  const [results, setResults] = useState([]) // [{ ...detected, inserted, skipped }]
  // Content fingerprint of the chosen file. `seen` means this exact file has been
  // loaded before, which is the one failure this page cannot otherwise detect:
  // the expense grid only recognises an already-loaded LINE when the ERP line
  // number was mapped, and today that is true for KSA and almost nothing else
  // (Egypt carries a line number on 78 of 42,531 rows, UAE on 39 of 67,615).
  const [fingerprint, setFingerprint] = useState(null)

  const inputRef = useRef(null)

  const busy = phase === 'parsing' || phase === 'importing'

  const totals = useMemo(() => previewTotals(detected), [detected])
  const totalRows = totals.rows
  const doneTotals = useMemo(() => resultTotals(results), [results])
  const [exportError, setExportError] = useState('')
  const reportRows = useMemo(() => importReportRows(results, countryChoice), [results, countryChoice])
  const reportBase = reportFileName('ERP Intake Report', countryChoice, fileName.replace(/\.[^.]+$/, ''))
  const exportReport = async (kind) => {
    setExportError('')
    try {
      if (kind === 'excel') await exportToExcel(reportRows, REPORT_COLUMNS.map((c) => c.key), REPORT_COLUMNS.map((c) => c.header), reportBase, 'Import report')
      else await exportToPdf(reportRows, REPORT_COLUMNS, 'ERP Intake Report', reportBase, 'landscape')
    } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // Whole-file reconciliation so nothing is ever silently lost: every row below each
  // header is either mapped, flagged as no-key (needs review), or dropped as footer/blank.
  const recon = useMemo(() => reconcile(detected), [detected])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setError(null)
    setPhase('parsing')
    setFileName(file.name || '')
    setDetected([])
    setResults([])
    setFingerprint(null)
    try {
      // Ask before parsing: hashing the bytes is cheap and the answer changes
      // whether the operator should commit at all. Never blocks on failure -
      // checkImportFingerprint returns not-seen if the RPC is missing.
      try {
        const sha = await fileSha256(file)
        if (sha) {
          const seen = await checkImportFingerprint(sha)
          if (seen?.seen) setFingerprint({ ...seen, sha256: sha })
        }
      } catch { /* a fingerprint is an aid, never a gate on parsing */ }
      const parsed = await parseWorkbookRaw(file)
      const sheets = Array.isArray(parsed?.sheets) ? parsed.sheets : []
      const found = []
      for (const sheet of sheets) {
        const aoa = Array.isArray(sheet?.aoa) ? sheet.aoa : []
        const det = detectReport(aoa)
        if (!det) continue
        const meta = REPORT_META[det.type] || { label: det.type, target: det.target, targetLabel: det.target }
        if (det.type === 'grid') {
          const g = rowsFromSheet(aoa.slice(det.headerIndex), { country })
          const rows = g.rows || []
          // Grid path: rowsFromSheet drops blank + footer rows (same isFooterRow helper as
          // every other branch) and flags no-key rows, so a GRAND TOTAL line can never be
          // imported as an expense line and counted a second time.
          const accounting = {
            read: g.read || 0,
            mapped: rows.length,
            noKey: g.noKey || 0,
            footer: g.footerRows || 0,
            blank: g.blankRows || 0,
          }
          found.push({
            sheetName: sheet.name || '',
            type: det.type,
            target: 'parts_consumption',
            targetLabel: meta.targetLabel,
            label: meta.label,
            rows,
            dropped: accounting.footer + accounting.blank,
            accounting,
            summary: summarizeRows(rows),
          })
        } else {
          const res = intakeSheet(aoa, { country }) || { type: det.type, target: det.target, rows: [], dropped: 0 }
          const rows = res.rows || []
          const accounting = {
            read: res.read || 0,
            mapped: rows.length,
            noKey: res.noKey || 0,
            footer: res.footerRows || 0,
            blank: res.blankRows || 0,
          }
          found.push({
            sheetName: sheet.name || '',
            type: res.type,
            target: res.target,
            targetLabel: meta.targetLabel,
            label: meta.label,
            rows,
            tyreRows: res.tyreRows || [], // combined export: tyre_records loaded alongside
            dropped: res.dropped || 0,
            accounting,
            summary: null,
          })
        }
      }
      if (!found.length) {
        setError('Not a recognised ERP report (checked headers). Supported: grid / monthly tyres / complaints / job cards + tyre changes / open job cards / asset list.')
        setPhase('idle')
        return
      }
      // Surface same-key rows before import. The database later drops exact copies
      // and refreshes records when the uploaded values have changed.
      for (const d of found) {
        try {
          d.dup = await countExistingRows(d.target, d.rows, { country })
          if (Array.isArray(d.tyreRows) && d.tyreRows.length) {
            d.dupTyre = await countExistingRows('tyre_records', d.tyreRows, { country })
          }
        } catch { d.dup = null }
      }
      setDetected(found)
      setPhase('preview')
    } catch (err) {
      setError(toUserMessage(err, 'Could not read this file.'))
      setPhase('idle')
    }
  }, [country])

  const onInputChange = useCallback((e) => {
    const file = e.target.files && e.target.files[0]
    if (file) handleFile(file)
    if (inputRef.current) inputRef.current.value = ''
  }, [handleFile])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer?.files && e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const runImport = useCallback(async () => {
    if (!detected.length) return
    setError(null)
    setPhase('importing')
    setResults([])
    const out = []
    try {
      for (let i = 0; i < detected.length; i += 1) {
        const d = detected[i]
        setProgress({ sheetIdx: i, d: 0, t: d.rows.length })
        const onProgress = (done, total) => setProgress({ sheetIdx: i, d: done, t: total })
        // Stamp the chosen country on every row at import time (so changing the picker
        // after parsing still applies), overriding whatever was set during mapping.
        const rows = d.rows.map((r) => ({ ...r, country }))
        let res
        if (d.target === 'parts_consumption') {
          res = await insertPartsConsumption(rows, { country, onProgress })
        } else {
          res = await loadIntake(d.target, rows, { onProgress, country })
        }
        // Combined job-card + tyre export: also load the tyre_records carried alongside.
        let tyreRes = null
        if (d.type === 'combined' && Array.isArray(d.tyreRows) && d.tyreRows.length) {
          const tyres = d.tyreRows.map((r) => ({ ...r, country }))
          tyreRes = await loadIntake('tyre_records', tyres, { country })
        }
        out.push({
          ...d,
          sourceRows: d.rows.length,
          inserted: res?.inserted ?? d.rows.length,
          updated: res?.updated ?? 0,
          unchanged: res?.unchanged ?? (res?.skipped ?? 0),
          skipped: res?.skipped ?? 0,
          failed: res?.failed ?? 0,
          notAdded: Math.max(0, d.rows.length - (res?.inserted ?? d.rows.length) - (res?.updated ?? 0) - (res?.failed ?? 0)),
          tyresSourceRows: Array.isArray(d.tyreRows) ? d.tyreRows.length : 0,
          tyresInserted: tyreRes?.inserted ?? 0,
          tyresUpdated: tyreRes?.updated ?? 0,
          tyresNotAdded: Math.max(
            0,
            (Array.isArray(d.tyreRows) ? d.tyreRows.length : 0) - (tyreRes?.inserted ?? 0) - (tyreRes?.updated ?? 0) - (tyreRes?.failed ?? 0),
          ),
        })
        setResults([...out])
      }
      setPhase('done')
    } catch (err) {
      setError(toUserMessage(err, 'Import failed. Please try again.'))
      setPhase('preview')
    }
  }, [detected, country])

  const reset = useCallback(() => {
    setPhase('idle')
    setFileName('')
    setDetected([])
    setResults([])
    setError(null)
    setProgress({ sheetIdx: 0, d: 0, t: 0 })
  }, [])

  const pct = progress.t ? Math.round((progress.d / progress.t) * 100) : 0
  const importing = phase === 'importing'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Intake"
        subtitle="Upload any Ramco ERP report export and it is auto-routed to the right table"
        icon={Layers}
      />

      <div className="card flex flex-wrap items-center gap-3 !py-3">
        <label htmlFor="intake-country" className="text-sm font-medium text-[var(--text-secondary)]">
          Country for this upload
        </label>
        <select
          id="intake-country"
          value={countryChoice}
          onChange={(e) => setCountryChoice(e.target.value)}
          disabled={busy}
          className="input min-h-[44px] text-sm disabled:opacity-50"
        >
          {(COUNTRIES || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-[var(--text-tertiary)]">
          Every row in this file is tagged to {countryChoice}. Upload each country&apos;s files with its country selected here.
        </span>
      </div>

      {/* Explainer */}
      <div className="card p-5 space-y-3">
        <p className="text-sm text-[var(--text-secondary)]">
          Upload any of your Ramco exports (.xls, .xlsx or .csv). Each sheet is recognised by its
          header and routed automatically:
        </p>
        <ul className="text-sm text-[var(--text-secondary)] grid gap-2 sm:grid-cols-2">
          <li className="flex items-start gap-2">
            <FileSpreadsheet className="h-4 w-4 mt-0.5 shrink-0 text-[var(--text-tertiary)]" />
            <span><span className="font-medium text-[var(--text-primary)]">Work Order Details / grid</span> to Parts Consumption (cost)</span>
          </li>
          <li className="flex items-start gap-2">
            <FileSpreadsheet className="h-4 w-4 mt-0.5 shrink-0 text-[var(--text-tertiary)]" />
            <span><span className="font-medium text-[var(--text-primary)]">Monthly Tyres Consumption</span> to tyre lifecycle</span>
          </li>
          <li className="flex items-start gap-2">
            <FileSpreadsheet className="h-4 w-4 mt-0.5 shrink-0 text-[var(--text-tertiary)]" />
            <span><span className="font-medium text-[var(--text-primary)]">Vehicle Complaints History</span> to work orders (no cost)</span>
          </li>
          <li className="flex items-start gap-2">
            <FileSpreadsheet className="h-4 w-4 mt-0.5 shrink-0 text-[var(--text-tertiary)]" />
            <span><span className="font-medium text-[var(--text-primary)]">Open Job Cards</span> to the follow-up list</span>
          </li>
        </ul>
        <p className="text-xs text-[var(--text-tertiary)]">
          The header may be on the 3rd row and footer rows (GRAND TOTAL, Printed By, Applied filters)
          are dropped automatically. Cost is taken only from the grid.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div role="alert" className="card p-4 border border-red-800/50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 mt-0.5 text-red-400 shrink-0" aria-hidden="true" />
            <p className="text-sm text-[var(--text-secondary)]">{error}</p>
          </div>
          {phase === 'preview' ? (
            <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0 min-h-[44px]" onClick={runImport} disabled={busy}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Retry import
            </button>
          ) : (
            <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0 min-h-[44px]" onClick={() => inputRef.current && inputRef.current.click()} disabled={busy}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Choose another file
            </button>
          )}
        </div>
      )}
      {exportError && <p role="alert" className="text-sm text-red-300">{exportError}</p>}

      {/* STEP 1: choose file (idle / parsing) */}
      {(phase === 'idle' || phase === 'parsing') && (
        <div
          className={`card p-8 border-2 border-dashed transition-colors ${
            dragging ? 'border-[var(--accent,#22c55e)]' : 'border-[var(--border)]'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="flex flex-col items-center text-center">
            {phase === 'parsing' ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-[var(--text-secondary)]" />
                <p className="mt-3 text-sm text-[var(--text-secondary)]">
                  Reading {fileName || 'file'}...
                </p>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 text-[var(--text-tertiary)]" />
                <p className="mt-3 text-sm text-[var(--text-secondary)]">
                  Drag and drop your ERP export here, or
                </p>
                <button
                  type="button"
                  className="btn-primary mt-3 inline-flex items-center gap-2"
                  onClick={() => inputRef.current && inputRef.current.click()}
                >
                  <FileSpreadsheet className="h-4 w-4" /> Choose file
                </button>
                <p className="mt-3 text-xs text-[var(--text-tertiary)]">
                  Accepted: .xls, .xlsx, .csv
                </p>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xls,.xlsx,.csv"
              aria-label="ERP export file"
              className="hidden"
              onChange={onInputChange}
            />
          </div>
        </div>
      )}

      {/* STEP 2: preview (preview / importing) */}
      {(phase === 'preview' || phase === 'importing') && detected.length > 0 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-[var(--text-secondary)] inline-flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" /> {fileName}
              <span className="text-[var(--text-tertiary)]">
                | {detected.length} report{detected.length === 1 ? '' : 's'} detected | {num(totalRows)} rows
              </span>
            </p>
            {phase === 'preview' && (
              <button type="button" className="btn-secondary" onClick={reset} disabled={busy}>
                Choose a different file
              </button>
            )}
          </div>

          {/* File-level KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile label="Reports detected" value={num(totals.reports)} sub={`${num(recon.read)} rows read`} />
            <KpiTile label="Rows to import" value={num(totals.rows)} sub={totals.tyreRows ? `+ ${num(totals.tyreRows)} tyre changes` : `${num(totals.dropped)} footer/blank dropped`} />
            <KpiTile label="New keys" value={totals.fresh == null ? 'N/A' : num(totals.fresh)} sub={totals.fresh == null ? 'not every sheet could be checked' : 'not yet in the system'} tone="text-[var(--brand-bright)]" />
            <KpiTile label="Same-key rows" value={totals.existing == null ? 'N/A' : num(totals.existing)} sub="refreshed if changed, else dropped" tone={totals.existing ? 'text-amber-400' : 'text-[var(--text-primary)]'} />
          </div>

          {detected.map((d, i) => {
            const done = results[i]
            const active = importing && progress.sheetIdx === i
            const sheetPct = active && progress.t ? Math.round((progress.d / progress.t) * 100) : 0
            return (
              <div key={`${d.sheetName}-${i}`} className="card p-0 overflow-hidden">
                {/* Detected header */}
                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
                      <Wand2 className="h-4 w-4 text-[var(--text-secondary)]" />
                      {d.label}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                      Sheet {d.sheetName || 'Sheet1'} to {d.targetLabel}
                    </p>
                  </div>
                  <div className="text-right text-xs text-[var(--text-tertiary)]">
                    <p><span className="font-semibold text-[var(--text-primary)]">{num(d.rows.length)}</span> data rows</p>
                    {Array.isArray(d.tyreRows) && d.tyreRows.length > 0 && (
                      <p><span className="font-semibold text-[var(--text-primary)]">{num(d.tyreRows.length)}</span> tyre changes</p>
                    )}
                    {d.dup && d.dup.keyed && (
                      <p>
                        <span className="font-semibold text-[var(--accent,#22c55e)]">{num(d.dup.fresh)}</span> new
                        {d.dup.existing > 0 && (
                          <span className="text-[var(--text-tertiary)]"> | {num(d.dup.existing)} same-key row(s) to verify or refresh</span>
                        )}
                      </p>
                    )}
                    <p>{num(d.dropped)} footer/blank rows dropped</p>
                  </div>
                </div>

                {/* Row reconciliation - every row below the header is accounted for */}
                {d.accounting && (
                  <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2,#0f172a)]/40 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-tertiary)]">
                    <span className="inline-flex items-center gap-1">
                      <span className="font-semibold text-[var(--text-primary)]">{num(d.accounting.read)}</span> rows read
                    </span>
                    <span aria-hidden>=</span>
                    <span><span className="font-semibold text-[var(--text-primary)]">{num(d.accounting.mapped)}</span> mapped</span>
                    {d.accounting.noKey > 0 && (
                      <span className="text-[var(--warning,#f59e0b)]">
                        + {num(d.accounting.noKey)} without an ID (review)
                      </span>
                    )}
                    <span className="text-[var(--text-tertiary)]">
                      | {num(d.accounting.footer)} footer + {num(d.accounting.blank)} blank dropped
                    </span>
                  </div>
                )}

                <div className="p-4 space-y-4">
                  {/* GRID: cost totals + intelligence */}
                  {d.type === 'grid' && d.summary && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <KpiTile label="Total" value={formatCurrency(d.summary.total, currency)} />
                        <KpiTile
                          label="Tyres"
                          value={formatCurrency(d.summary.tyre, currency)}
                          sub={`${num(d.summary.tyreLines)} lines`}
                        />
                        <KpiTile
                          label="Spare"
                          value={formatCurrency(d.summary.spare, currency)}
                          sub={`${num(d.summary.spareLines)} lines`}
                        />
                        <KpiTile
                          label="Oil"
                          value={formatCurrency(d.summary.oil, currency)}
                          sub={`${num(d.summary.oilLines)} lines`}
                        />
                      </div>
                      <div className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                        <Wand2 className="h-4 w-4 mt-0.5 shrink-0 text-[var(--text-secondary)]" />
                        <div className="space-y-0.5">
                          <p>{num(d.summary.reassignedToTyre)} tyre amounts moved from Spare/Oil into Tyres</p>
                          <p>{num(d.summary.reassignedFromTyre)} non-tyre amounts moved out of the tyre column</p>
                        </div>
                      </div>
                    </>
                  )}

                  {/* NON-GRID: sample table */}
                  {d.type !== 'grid' && (SAMPLE_COLS[d.target] || []).length > 0 && (
                    <SamplePreview target={d.target} rows={d.rows} />
                  )}

                  {/* Per-sheet import status */}
                  {done ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                        <CheckCircle2 className="h-4 w-4 text-[var(--accent,#22c55e)]" />
                        <span>
                          {resultSummary(done)}
                          {done.tyresSourceRows
                            ? `; tyres: ${num(done.tyresSourceRows)} processed, ${num(done.tyresInserted)} new${done.tyresUpdated ? `, ${num(done.tyresUpdated)} refreshed` : ''}${done.tyresNotAdded ? `, ${num(done.tyresNotAdded)} exact duplicate(s) dropped` : ''}`
                            : ''}
                        </span>
                      </div>
                      {done.failed > 0 && (
                        <div className="flex items-start gap-2 text-sm text-[var(--warning,#f59e0b)]">
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>{num(done.failed)} row(s) could not be saved after retries (network). Re-run the import to retry just these.</span>
                        </div>
                      )}
                    </div>
                  ) : active ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" /> Importing...
                        </span>
                        <span>{num(progress.d)} / {num(progress.t)} ({sheetPct}%)</span>
                      </div>
                      <div className="h-2 w-full rounded bg-[var(--surface-2,#1e293b)] overflow-hidden">
                        <div className="h-full bg-[var(--accent,#22c55e)] transition-all" style={{ width: `${sheetPct}%` }} />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}

          {/* Whole-file reconciliation - proof that no row slipped */}
          <div className="card p-4 space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Every row accounted for</p>
            <p className="text-sm text-[var(--text-secondary)]">
              {num(recon.read)} rows read = {num(recon.mapped)} mapped
              {recon.noKey > 0 ? ` + ${num(recon.noKey)} without an ID (review below)` : ''}
              {(recon.footer + recon.blank) > 0
                ? `, plus ${num(recon.footer)} footer and ${num(recon.blank)} blank rows dropped`
                : ''}.
            </p>
            {recon.noKey > 0 && (
              <p className="text-xs text-[var(--warning,#f59e0b)] inline-flex items-start gap-1">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {num(recon.noKey)} row(s) had data but no serial / work order / item to key on and will be skipped.
                Check the source file if these should import.
              </p>
            )}
          </div>

          {/* Big-file guidance */}
          {totalRows > 40000 && (
            <div className="card p-4 flex items-start gap-2 border border-[var(--warning,#f59e0b)]/40">
              <AlertTriangle className="h-5 w-5 mt-0.5 text-[var(--warning,#f59e0b)] shrink-0" />
              <p className="text-sm text-[var(--text-secondary)]">
                Large file ({num(totalRows)} rows). The import now retries automatically over a weak
                connection and never loses a row, but keep this tab open and awake until it finishes.
                For very large files you can also import the matching CSV directly from the Supabase
                Table Editor.
              </p>
            </div>
          )}

          {/* Merge note - explains why the count differs from the file */}
          <p className="text-xs text-[var(--text-tertiary)]">
            Every valid row proceeds. New keys are inserted, same-key rows with changed supplied
            values are refreshed, and only field-for-field copies are dropped. The open job-card
            list is replaced.
          </p>

          {/* This exact file has been loaded before. Say so before the money moves. */}
          {fingerprint && phase === 'preview' && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
              <p className="text-sm font-semibold text-amber-300">
                This file has been uploaded before
              </p>
              <p className="text-xs text-amber-200">
                The exact same file content was loaded
                {fingerprint.first_seen_at
                  ? ` on ${String(fingerprint.first_seen_at).slice(0, 10)}`
                  : ' previously'}
                {fingerprint.filename ? ` as "${fingerprint.filename}"` : ''}
                {Number.isFinite(Number(fingerprint.rows_imported))
                  ? `, importing ${num(Number(fingerprint.rows_imported))} rows` : ''}.
                The rows will still proceed. Exact copies are dropped automatically and changed
                rows are refreshed.
              </p>
            </div>
          )}

          {/* Import button */}
          {phase === 'preview' && (
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                onClick={runImport}
                disabled={busy || !totalRows}
              >
                <ArrowRight className="h-4 w-4" />
                Import {num(totalRows)} rows
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: done */}
      {phase === 'done' && (
        <div className="card p-8">
          <div className="flex flex-col items-center text-center">
            <CheckCircle2 className="h-12 w-12 text-[var(--accent,#22c55e)]" />
            <p className="mt-3 text-lg font-semibold text-[var(--text-primary)]">Import complete</p>
            <div className="mt-4 w-full grid grid-cols-2 lg:grid-cols-4 gap-3 text-left">
              <KpiTile label="Processed" value={num(doneTotals.processed)} sub={`tagged ${countryChoice}`} />
              <KpiTile label="New" value={num(doneTotals.inserted)} tone="text-[var(--brand-bright)]" sub={doneTotals.tyresInserted ? `+ ${num(doneTotals.tyresInserted)} tyre changes` : null} />
              <KpiTile label="Refreshed" value={num(doneTotals.updated)} sub={`${num(doneTotals.notAdded)} exact duplicates dropped`} />
              <KpiTile label="Failed" value={num(doneTotals.failed)} tone={doneTotals.failed ? 'text-red-400' : 'text-[var(--text-primary)]'} sub={doneTotals.failed ? 're-run to retry these' : 'none'} />
            </div>
            <div className="mt-4 w-full max-w-lg space-y-2 text-left">
              {results.map((r, i) => (
                <div
                  key={`${r.sheetName}-${i}`}
                  className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-2 text-sm"
                >
                  <span className="text-[var(--text-secondary)]">{r.label}</span>
                  <span className="text-[var(--text-primary)] whitespace-nowrap">
                    {resultSummary(r)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Link to="/expense-report" className="btn-primary inline-flex items-center gap-2">
                <ArrowRight className="h-4 w-4" /> View expense report
              </Link>
              <button type="button" className="btn-secondary inline-flex items-center gap-2 min-h-[44px]" onClick={() => exportReport('excel')} disabled={!reportRows.length}>
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Import report (Excel)
              </button>
              <button type="button" className="btn-secondary inline-flex items-center gap-2 min-h-[44px]" onClick={() => exportReport('pdf')} disabled={!reportRows.length}>
                <FileText className="h-4 w-4" aria-hidden="true" /> Import report (PDF)
              </button>
              <button type="button" className="btn-secondary min-h-[44px]" onClick={reset}>
                Import another file
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
