/**
 * ExpenseImport (route /expense-import) - in-app importer for the Ramco
 * "grid details" maintenance/parts EXPENSE export.
 *
 * An admin uploads the .xls / .xlsx / .csv export directly (no Supabase
 * dashboard). The pure engine (partsExpense) auto-classifies every line into
 * Tyres / Spare / Oil from the item itself and re-buckets any tyre cost that the
 * ERP mis-filed under Spare or Oil. The DB trigger classifies authoritatively on
 * insert, so the client only sends the raw grid columns.
 *
 * Tri-state, honest flow: choose file -> preview (KPIs + intelligence + sample)
 * -> import (resilient chunked insert with progress) -> done. All errors are
 * routed through toUserMessage; empty/error states are explicit.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Upload, FileSpreadsheet, Wand2, CheckCircle2, AlertTriangle, Loader2,
  Trash2, ArrowRight, Receipt,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { parseWorkbook } from '../lib/import/parseWorkbook'
import { rowsFromParsedSheet, summarizeRows, classifyLine } from '../lib/partsExpense'
import {
  insertPartsConsumption, countPartsConsumption, clearPartsConsumption,
} from '../lib/api/partsConsumption'

const LARGE_FILE_ROWS = 60000
const SAMPLE_LIMIT = 20

const CATEGORY_LABEL = { tyre: 'Tyres', spare: 'Spare', oil: 'Oil' }
const CATEGORY_STYLE = {
  tyre: 'bg-[var(--accent-2,#22c55e)]/15 text-[var(--text-primary)] border border-[var(--border)]',
  spare: 'bg-[var(--surface-2,#1e293b)]/60 text-[var(--text-secondary)] border border-[var(--border)]',
  oil: 'bg-[var(--surface-2,#1e293b)]/60 text-[var(--text-secondary)] border border-[var(--border)]',
}

/** One KPI tile. */
function KpiTile({ label, value, sub }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{value}</p>
      {sub != null && <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">{sub}</p>}
    </div>
  )
}

export default function ExpenseImport() {
  const { activeCountry, activeCurrency } = useSettings()
  const currency = activeCurrency || 'SAR'
  const country = activeCountry && activeCountry !== 'All' ? activeCountry : null

  const [storedCount, setStoredCount] = useState(null)
  const [storedError, setStoredError] = useState(null)

  const [phase, setPhase] = useState('idle') // idle | parsing | preview | importing | done
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [replaceFirst, setReplaceFirst] = useState(false)
  const [progress, setProgress] = useState({ d: 0, t: 0 })
  const [importedCount, setImportedCount] = useState(0)
  const [dragging, setDragging] = useState(false)

  const inputRef = useRef(null)

  const refreshStored = useCallback(async () => {
    try {
      const n = await countPartsConsumption()
      setStoredCount(n)
      setStoredError(null)
    } catch (err) {
      setStoredCount(null)
      setStoredError(toUserMessage(err, 'Could not read stored expense data.'))
    }
  }, [])

  useEffect(() => { refreshStored() }, [refreshStored])

  const summary = useMemo(() => (rows.length ? summarizeRows(rows) : null), [rows])

  const sample = useMemo(() => rows.slice(0, SAMPLE_LIMIT).map((r) => {
    const c = classifyLine({
      description: r.item_description, value: r.value_amount, spare: r.spare_parts_amount,
      tyre: r.tyre_amount, oil: r.oil_amount, total: r.total_amount,
    })
    return { r, category: c.category, lineCost: c.lineCost }
  }), [rows])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setError(null)
    setPhase('parsing')
    setFileName(file.name || '')
    setRows([])
    try {
      const parsed = await parseWorkbook(file)
      const sheets = Array.isArray(parsed?.sheets) ? parsed.sheets : []
      if (!sheets.length) {
        setError('No readable sheet was found in this file.')
        setPhase('idle')
        return
      }
      const sheet = [...sheets].sort(
        (a, b) => (b?.rows?.length || 0) - (a?.rows?.length || 0),
      )[0]
      const { rows: mapped, missing } = rowsFromParsedSheet(sheet, { country })
      if (missing && missing.length) {
        setError('Could not find the Values / Item Description columns - is this the grid-details export?')
        setPhase('idle')
        return
      }
      if (!mapped.length) {
        setError('No data rows found.')
        setPhase('idle')
        return
      }
      setRows(mapped)
      setPhase('preview')
    } catch (err) {
      setError(toUserMessage(err, 'Could not read this file.'))
      setPhase('idle')
    }
  }, [country])

  const onInputChange = useCallback((e) => {
    const file = e.target.files && e.target.files[0]
    if (file) handleFile(file)
    // allow re-selecting the same file name
    if (inputRef.current) inputRef.current.value = ''
  }, [handleFile])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer?.files && e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const runImport = useCallback(async () => {
    if (!rows.length) return
    setError(null)
    setPhase('importing')
    setProgress({ d: 0, t: rows.length })
    try {
      if (replaceFirst) await clearPartsConsumption()
      const res = await insertPartsConsumption(rows, {
        country,
        onProgress: (d, t) => setProgress({ d, t }),
      })
      setImportedCount(res?.inserted ?? rows.length)
      setPhase('done')
      refreshStored()
    } catch (err) {
      setError(toUserMessage(err, 'Import failed. Please try again.'))
      setPhase('preview')
    }
  }, [rows, replaceFirst, country, refreshStored])

  const reset = useCallback(() => {
    setPhase('idle')
    setFileName('')
    setRows([])
    setError(null)
    setReplaceFirst(false)
    setProgress({ d: 0, t: 0 })
    setImportedCount(0)
  }, [])

  const busy = phase === 'parsing' || phase === 'importing'
  const isLarge = rows.length > LARGE_FILE_ROWS
  const pct = progress.t ? Math.round((progress.d / progress.t) * 100) : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expense Import"
        subtitle="Upload your Ramco maintenance and parts expense export"
        icon={Receipt}
      />

      {/* Explainer + stored count */}
      <div className="card p-5">
        <p className="text-sm text-[var(--text-secondary)]">
          Upload your Ramco grid-details expense export (.xls, .xlsx or .csv). Amounts are
          auto-classified into Tyres / Spare / Oil, and any tyre cost filed under Spare or Oil
          is moved to Tyres automatically.
        </p>
        <div className="mt-3 text-sm text-[var(--text-tertiary)]">
          {storedError ? (
            <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
              <AlertTriangle className="h-4 w-4" /> {storedError}
            </span>
          ) : storedCount == null ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking stored expense data...
            </span>
          ) : (
            <span>
              Currently stored: <span className="font-semibold text-[var(--text-primary)]">
                {storedCount.toLocaleString('en-US')}
              </span> expense rows
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="card p-4 border border-[var(--border)] flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 mt-0.5 text-[var(--text-secondary)] shrink-0" />
          <p className="text-sm text-[var(--text-secondary)]">{error}</p>
        </div>
      )}

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
                  Drag and drop your export here, or
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
              className="hidden"
              onChange={onInputChange}
            />
          </div>
        </div>
      )}

      {/* STEP 2: preview (preview / importing) */}
      {(phase === 'preview' || phase === 'importing') && summary && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-[var(--text-secondary)] inline-flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" /> {fileName}
            </p>
            {phase === 'preview' && (
              <button type="button" className="btn-secondary" onClick={reset} disabled={busy}>
                Choose a different file
              </button>
            )}
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiTile label="Rows" value={summary.rows.toLocaleString('en-US')} />
            <KpiTile label="Total expense" value={formatCurrency(summary.total, currency)} />
            <KpiTile
              label="Tyres"
              value={formatCurrency(summary.tyre, currency)}
              sub={`${summary.tyreLines.toLocaleString('en-US')} lines`}
            />
            <KpiTile
              label="Spare"
              value={formatCurrency(summary.spare, currency)}
              sub={`${summary.spareLines.toLocaleString('en-US')} lines`}
            />
            <KpiTile
              label="Oil"
              value={formatCurrency(summary.oil, currency)}
              sub={`${summary.oilLines.toLocaleString('en-US')} lines`}
            />
          </div>

          {/* Intelligence note */}
          <div className="card p-4 flex items-start gap-2">
            <Wand2 className="h-5 w-5 mt-0.5 text-[var(--text-secondary)] shrink-0" />
            <div className="text-sm text-[var(--text-secondary)] space-y-1">
              <p className="font-medium text-[var(--text-primary)]">Intelligence applied</p>
              <p>
                {summary.reassignedToTyre.toLocaleString('en-US')} tyre amounts moved from
                Spare/Oil into Tyres
              </p>
              <p>
                {summary.reassignedFromTyre.toLocaleString('en-US')} non-tyre amounts moved out
                of the tyre column
              </p>
            </div>
          </div>

          {/* Sample table */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Sample (first {Math.min(SAMPLE_LIMIT, rows.length)} of {rows.length.toLocaleString('en-US')} rows)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-tertiary)]">
                    <th className="px-4 py-2 font-medium">Item description</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.map((s, i) => (
                    <tr key={i} className="border-t border-[var(--border)]">
                      <td className="px-4 py-2 text-[var(--text-secondary)] max-w-md truncate">
                        {s.r.item_description || 'N/A'}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--text-primary)]">
                        {formatCurrency(s.lineCost, currency)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs ${CATEGORY_STYLE[s.category] || ''}`}>
                          {CATEGORY_LABEL[s.category] || s.category}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Options */}
          <div className="card p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={replaceFirst}
                onChange={(e) => setReplaceFirst(e.target.checked)}
                disabled={busy}
              />
              Replace all existing expense data first
            </label>
            {replaceFirst && (
              <div className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                <Trash2 className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  Warning: this permanently deletes all stored expense rows for this organisation
                  before importing the new file.
                </p>
              </div>
            )}
            {isLarge && (
              <p className="text-xs text-[var(--text-tertiary)]">
                This is a large file ({rows.length.toLocaleString('en-US')} rows). The import can
                take a few minutes; please keep this tab open.
              </p>
            )}
          </div>

          {/* Progress + import button */}
          {phase === 'importing' ? (
            <div className="card p-4 space-y-2">
              <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Importing...
                </span>
                <span>
                  {progress.d.toLocaleString('en-US')} / {progress.t.toLocaleString('en-US')} ({pct}%)
                </span>
              </div>
              <div className="h-2 w-full rounded bg-[var(--surface-2,#1e293b)] overflow-hidden">
                <div
                  className="h-full bg-[var(--accent,#22c55e)] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                onClick={runImport}
                disabled={busy || !rows.length}
              >
                <ArrowRight className="h-4 w-4" />
                Import {rows.length.toLocaleString('en-US')} rows
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
            <p className="mt-3 text-lg font-semibold text-[var(--text-primary)]">
              Imported {importedCount.toLocaleString('en-US')} rows
            </p>
            <p className="mt-1 text-sm text-[var(--text-tertiary)]">
              Amounts have been classified into Tyres / Spare / Oil.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Link to="/expense-report" className="btn-primary inline-flex items-center gap-2">
                <ArrowRight className="h-4 w-4" /> View expense report
              </Link>
              <button type="button" className="btn-secondary" onClick={reset}>
                Import another file
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
