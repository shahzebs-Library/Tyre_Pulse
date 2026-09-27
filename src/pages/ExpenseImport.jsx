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
  Trash2, ArrowRight, Receipt, FileText, RotateCcw,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { currencyForCountry } from '../lib/governedCost'
import {
  CATEGORY_LABEL, classifyPreview, filterPreview, previewTotals,
  previewExportRows, PREVIEW_EXPORT_COLUMNS,
} from '../lib/expenseImportAnalytics'
import PageHeader from '../components/ui/PageHeader'
import FilterBar from '../components/ui/FilterBar'
import DateField from '../components/ui/DateField'
import { useFilterState } from '../hooks/useFilterState'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { parseWorkbook } from '../lib/import/parseWorkbook'
import { rowsFromParsedSheet, summarizeRows } from '../lib/partsExpense'
import {
  importExpenseBatch, countPartsConsumption,
} from '../lib/api/partsConsumption'

const LARGE_FILE_ROWS = 60000
const FILTER_DEFAULTS = { q: '', category: '', from: '', to: '' }

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
  const [filters, setFilter, resetFilters, hasActiveFilters] = useFilterState(FILTER_DEFAULTS)
  const { activeCountry, activeCurrency } = useSettings()
  const country = activeCountry && activeCountry !== 'All' ? activeCountry : null
  const currency = currencyForCountry(country) || activeCurrency || 'SAR'

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
  const requestRef = useRef(null)
  const [skippedCount, setSkippedCount] = useState(0)

  const refreshStored = useCallback(async () => {
    try {
      const n = await countPartsConsumption({ country })
      setStoredCount(n)
      setStoredError(null)
    } catch (err) {
      setStoredCount(null)
      setStoredError(toUserMessage(err, 'Could not read stored expense data.'))
    }
  }, [country])

  useEffect(() => { refreshStored() }, [refreshStored])

  const summary = useMemo(() => (rows.length ? summarizeRows(rows) : null), [rows])

  const classifiedRows = useMemo(() => classifyPreview(rows), [rows])
  // Display filters only: the import below always submits the full `rows` array.
  const previewRows = useMemo(() => filterPreview(classifiedRows, filters), [classifiedRows, filters])
  const shown = useMemo(() => previewTotals(previewRows), [previewRows])
  const allTotals = useMemo(() => previewTotals(classifiedRows), [classifiedRows])
  const [exportError, setExportError] = useState('')
  const exportBase = reportFileName('Expense Import Preview', country, fileName.replace(/\.[^.]+$/, ''))
  const exportPreview = async (kind) => {
    setExportError('')
    try {
      const data = previewExportRows(previewRows)
      if (kind === 'excel') await exportToExcel(data, PREVIEW_EXPORT_COLUMNS.map((c) => c.key), PREVIEW_EXPORT_COLUMNS.map((c) => c.header), exportBase, 'Preview', { currency })
      else await exportToPdf(data, PREVIEW_EXPORT_COLUMNS, 'Expense Import Preview', exportBase, 'landscape', '', { currency })
    } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const previewColumns = useMemo(() => [
    { id: 'txn_date', header: 'Date', accessorFn: (s) => String(s.r.txn_date || '').slice(0, 10) || 'N/A', size: 110 },
    { id: 'work_order_no', header: 'Work order', accessorFn: (s) => s.r.work_order_no || 'N/A', size: 130 },
    { id: 'asset_code', header: 'Asset', accessorFn: (s) => s.r.asset_code || 'N/A', size: 100 },
    { id: 'item_description', header: 'Item description', accessorFn: (s) => s.r.item_description || 'N/A', size: 300,
      cell: ({ row }) => <span className="block max-w-md truncate" title={row.original.r.item_description || ''}>{row.original.r.item_description || 'N/A'}</span> },
    { id: 'amount', header: 'Amount', accessorFn: (s) => Number(s.lineCost) || 0, size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-primary)]">{formatCurrency(row.original.lineCost, currency)}</span> },
    { id: 'category', header: 'Category', accessorFn: (s) => CATEGORY_LABEL[s.category] || s.category, size: 110,
      cell: ({ row }) => <span className={`inline-block rounded px-2 py-0.5 text-xs ${CATEGORY_STYLE[row.original.category] || ''}`}>{CATEGORY_LABEL[row.original.category] || row.original.category}</span> },
  ], [currency])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setError(null)
    setPhase('parsing')
    setFileName(file.name || '')
    requestRef.current = null
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
      if (!requestRef.current) requestRef.current = crypto.randomUUID()
      const res = await importExpenseBatch(rows, {
        country, requestId: requestRef.current, replace: replaceFirst, expectedCount: storedCount,
        onProgress: (d, t) => setProgress({ d, t }),
      })
      setImportedCount(res.inserted)
      setSkippedCount(res.skipped || 0)
      setPhase('done')
      refreshStored()
    } catch (err) {
      if (err?.code === '40001' || err?.code === 'PT409') {
        requestRef.current = null
        await refreshStored()
        setError('Stored expense data changed during upload. Review the refreshed replacement count before retrying.')
      } else {
        setError(toUserMessage(err, 'Import failed. Please try again with the same file to verify its outcome.'))
      }
      setPhase('preview')
    }
  }, [rows, replaceFirst, country, refreshStored, storedCount])

  const reset = useCallback(() => {
    setPhase('idle')
    requestRef.current = null
    setSkippedCount(0)
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
            <span className="inline-flex flex-wrap items-center gap-1.5 text-[var(--text-secondary)]" role="alert">
              <AlertTriangle className="h-4 w-4 text-red-400" aria-hidden="true" /> {storedError}
              <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[36px]" onClick={refreshStored}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
              </button>
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
              aria-label="Expense export file"
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiTile label="Rows" value={summary.rows.toLocaleString('en-US')} sub={storedCount == null ? null : `${storedCount.toLocaleString('en-US')} already stored`} />
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
            <KpiTile
              label="Zero-value lines"
              value={allTotals.zeroCost.toLocaleString('en-US')}
              sub="carry no amount in the file"
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

          {/* Complete, filterable preview. Import always uses the original full rows array. */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Import preview ({previewRows.length.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')} rows)
              </p>
            </div>
            <FilterBar
              className="m-3"
              search={filters.q}
              onSearch={(value) => setFilter('q', value)}
              searchLabel="Search expense import preview"
              placeholder="Search item, work order, asset, store or cost centre"
              selects={[{
                key: 'category', value: filters.category, onChange: (value) => setFilter('category', value),
                placeholder: 'All categories', ariaLabel: 'Filter preview by category',
                options: Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
              }]}
              resultCount={previewRows.length}
              onClearAll={hasActiveFilters ? resetFilters : undefined}
            >
              <DateField value={filters.from} onChange={(value) => setFilter('from', value)} placeholder="From date" ariaLabel="Filter preview from date" max={filters.to || undefined} />
              <DateField value={filters.to} onChange={(value) => setFilter('to', value)} placeholder="To date" ariaLabel="Filter preview to date" min={filters.from || undefined} />
            </FilterBar>
            {hasActiveFilters && (
              <p className="px-4 pb-2 text-xs text-[var(--text-tertiary)]">
                Shown: {shown.rows.toLocaleString('en-US')} rows, {formatCurrency(shown.total, currency)} (Tyres {formatCurrency(shown.tyre, currency)}, Spare {formatCurrency(shown.spare, currency)}, Oil {formatCurrency(shown.oil, currency)}). Filters only change this view; the import still sends every row.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 px-3 pb-2">
              <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" onClick={() => exportPreview('excel')} disabled={!previewRows.length}>
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Excel
              </button>
              <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" onClick={() => exportPreview('pdf')} disabled={!previewRows.length}>
                <FileText className="h-4 w-4" aria-hidden="true" /> PDF
              </button>
            </div>
            <div className="px-3 pb-3">
              <EnterpriseTable
                columns={previewColumns}
                data={previewRows}
                getRowId={(s) => String(s.sourceIndex)}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                initialPageSize={25}
                emptyMessage={rows.length ? 'No import rows match these filters. Clear or change the search, category, or date range.' : 'No data rows found.'}
              />
            </div>
          </div>

          {/* Options */}
          <div className="card p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={replaceFirst}
                onChange={(e) => { setReplaceFirst(e.target.checked); requestRef.current = null }}
                disabled={busy}
              />
              Replace existing expense data for {country || 'the selected country'}
            </label>
            {replaceFirst && (
              <div className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                <Trash2 className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  This replaces {storedCount?.toLocaleString('en-US') ?? 'the stored'} rows in {country || 'the selected country'} after the full file is staged. If validation fails, existing data remains intact. Replaced rows are retained in a recovery archive.
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
                  <Loader2 className="h-4 w-4 animate-spin" /> {pct === 100 ? 'Applying verified import...' : 'Staging file...'}
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
              Imported {importedCount.toLocaleString('en-US')} rows{skippedCount > 0 ? `; ${skippedCount.toLocaleString('en-US')} duplicate rows skipped` : ''}
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
