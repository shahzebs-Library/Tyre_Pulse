/**
 * LedgerPage - a reusable, config-driven entry + import + list page used by the
 * SCO cost, SANY invoice and Production (approved M3) surfaces of the Cost per M3
 * module. One country + one bounded period at a time (default current month) so
 * it loads fast.
 *
 * Config supplies: the ledger title, its columns, the add-form fields, the import
 * `kind` (into costPerM3.mapImportRows) and the service functions (list / create /
 * import / remove). Everything else - country + month controls, add form, file
 * import, table, delete, totals, honest states - is generic here.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Plus, Upload, Trash2, RefreshCcw, X, FileSpreadsheet, ChevronDown, ChevronUp } from 'lucide-react'
import PageHeader from '../ui/PageHeader'
import { useSettings, COUNTRIES } from '../../contexts/SettingsContext'
import { CPK_PERIODS, DEFAULT_PERIOD, periodBounds, periodLabel } from '../../lib/cpkModule'
import { IMPORT_TEMPLATES, mapImportRows, summaryFromMonthly } from '../../lib/costPerM3'
import { parseWorkbook } from '../../lib/import/parseWorkbook'
import {
  logIntakeToHistory, countCostM3Rows, getProductionMonthly, getLedgerMonthly,
} from '../../lib/api/costPerM3'
import { currencyFor } from '../../lib/api/tyrePriceBackfill'
import { exportToExcel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import CostM3Table, { MEASURE_COLUMNS } from './CostM3Table'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

export default function LedgerPage({
  title,
  subtitle,
  icon: Icon,
  kind,               // 'sco' | 'sany' | 'production'
  columns,            // [{ key, header, align, kind:'text'|'money'|'int', render? }]
  formFields,         // [{ key, label, type:'text'|'number'|'month'|'select', options?, required?, currencyOf? }]
  amountKey = 'amount',
  service,            // { list, create, import, remove }
  hideTotal = false,  // hide the on-screen sum (e.g. sites have no amount)
  hidePeriod = false, // hide the month selector (e.g. sites are not period-bound)
}) {
  const { activeCountry } = useSettings()
  const initialCountry = activeCountry && activeCountry !== 'All' ? activeCountry : COUNTRIES[0]
  const [country, setCountry] = useState(initialCountry)
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD)
  const bounds = useMemo(() => periodBounds(periodKey, new Date()), [periodKey])

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importPct, setImportPct] = useState(0)
  const [notice, setNotice] = useState('')
  // Summary-first (owner preference): the raw row table is collapsed by default
  // behind "Show all rows"; the summary above answers the everyday questions.
  const [showRows, setShowRows] = useState(false)
  const [rowsLoading, setRowsLoading] = useState(false)
  // The server's monthly aggregate. null until it lands, so "no data" and
  // "not asked yet" stay different statements.
  const [monthly, setMonthly] = useState(null)
  // The true number of rows in the current window, or null when unknown. Only
  // ever used to be HONEST about a bounded read - never to fake a total.
  const [totalRows, setTotalRows] = useState(null)
  const fileRef = useRef(null)

  const tpl = IMPORT_TEMPLATES[kind]
  // One country, one currency. The monthly aggregate carries amounts but not a
  // currency code, and the page is always scoped to a single country.
  const currency = currencyFor(country)

  // Summary-first applies to the three period ledgers; the sites register keeps
  // its plain always-visible table (no amounts, tiny dataset).
  const hasSummary = kind === 'sco' || kind === 'sany' || kind === 'production'

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true); setError('')
    setTotalRows(null)
    setMonthly(null)
    setRows([])
    setShowRows(false)

    if (hasSummary) {
      // NOT ONE ROW IS READ TO OPEN THIS PAGE. It used to pull up to 20,000
      // rows into the browser purely to add them up, over a production table
      // holding hundreds of thousands - slow, and the sums only ever covered
      // as far as the bounded read reached. The database already groups these
      // by month, so the page asks for the summary and nothing else.
      const monthlyFor = kind === 'production'
        ? getProductionMonthly({ country, from: bounds.from, to: bounds.to })
        : getLedgerMonthly(kind, { country, from: bounds.from, to: bounds.to })
      monthlyFor
        .then((res) => { if (!cancelled) setMonthly(Array.isArray(res) ? res : []) })
        .catch((e) => { if (!cancelled) { setMonthly([]); setError(toUserMessage(e)) } })
        .finally(() => { if (!cancelled) setLoading(false) })

      // The true number of rows behind the summary. Shown so "Show all rows"
      // can say what it is about to fetch, never used to fake a total.
      countCostM3Rows({ country, from: bounds.from, to: bounds.to })
        .then((c) => { if (!cancelled) setTotalRows(c?.[kind] ?? null) })
        .catch(() => { if (!cancelled) setTotalRows(null) })
      return () => { cancelled = true }
    }

    service.list({ country, from: bounds.from, to: bounds.to })
      .then((res) => { if (!cancelled) setRows(Array.isArray(res) ? res : []) })
      .catch((e) => { if (!cancelled) { setRows([]); setError(toUserMessage(e)) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, bounds.from, bounds.to, service, kind, hasSummary])

  useEffect(() => load(), [load])

  // Rows arrive only when somebody actually asks to see them.
  const loadRows = useCallback(() => {
    setShowRows(true)
    if (rows.length || rowsLoading) return
    setRowsLoading(true)
    service.list({ country, from: bounds.from, to: bounds.to })
      .then((res) => setRows(Array.isArray(res) ? res : []))
      .catch((e) => setError(toUserMessage(e)))
      .finally(() => setRowsLoading(false))
  }, [country, bounds.from, bounds.to, service, rows.length, rowsLoading])

  const summary = useMemo(
    () => (hasSummary && monthly ? summaryFromMonthly(monthly, kind, { totalRows, currency }) : null),
    [hasSummary, monthly, kind, totalRows, currency],
  )

  // The window total. From the summary when there is one, so it covers the
  // whole period rather than only the rows that happen to be loaded.
  const total = useMemo(() => {
    if (hasSummary) return summary?.totals?.value ?? 0
    return rows.reduce((s, r) => s + (num(r[amountKey]) || 0), 0)
  }, [hasSummary, summary, rows, amountKey])

  const isProd = kind === 'production'
  const oneCurrency = summary && !summary.totals.mixedCurrency ? (summary.totals.currencies[0] || '') : ''
  const fmtSummaryVal = (v) => {
    if (v == null) return 'N/A'
    if (isProd) return `${Math.round(v).toLocaleString()} M3`
    if (summary?.totals.mixedCurrency) return `${Math.round(v).toLocaleString()} (mixed currencies)`
    return `${oneCurrency ? oneCurrency + ' ' : ''}${Math.round(v).toLocaleString()}`
  }
  // A bounded read that did not reach the end of the window. `truncated` is the
  // only thing that may weaken a stated figure, and it is derived from the
  // SERVER count, not from whether we happened to hit the page size.
  const truncated = showRows && rows.length > 0 && totalRows != null && totalRows > rows.length
  const rowsLabel = totalRows != null
    ? totalRows.toLocaleString()
    : rows.length.toLocaleString()
  const rowsVisible = !hasSummary || showRows

  function openForm() {
    const blank = { country, period_date: bounds.from }
    for (const f of formFields) if (!(f.key in blank)) blank[f.key] = ''
    setForm(blank)
    setShowForm(true)
  }

  async function save() {
    setSaving(true); setError('')
    try {
      await service.create({ ...form, country: form.country || country })
      setShowForm(false)
      setNotice('Saved.')
      load()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true); setImportPct(0); setError(''); setNotice('')
    try {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
      let dataRows
      if (isPdf) {
        const { pdfRowsFor } = await import('../../lib/import/parsePdf')
        dataRows = await pdfRowsFor(kind, file) // throws a clear message for unsupported kinds
      } else {
        const wb = await parseWorkbook(file)
        // Use the sheet with the most rows (some exports carry a title/summary sheet first).
        // parseWorkbook returns each sheet's records under `rows` (not `dataRows`).
        const sheets = wb?.sheets || []
        const sheet = sheets.reduce((best, s) => ((s?.rows?.length || 0) > (best?.rows?.length || 0) ? s : best), sheets[0])
        dataRows = sheet?.rows || []
      }
      if (!dataRows.length) {
        setError(`No data rows found in ${file.name}. Check the header row and that the file is .xlsx / .csv / .pdf.`)
        return
      }
      const mapped = mapImportRows(kind, dataRows).map((r) => ({ ...r, country: r.country || country }))
      if (!mapped.length) {
        // A Ramco parts/expense grid ("griddetails") is an ERP expense file, not a
        // Cost/M3 ledger - steer it to the Data Intake Center rather than a bare
        // column-mismatch error.
        const headerLine = Object.keys(dataRows[0] || {}).join(' ').toLowerCase()
        // The SCO issue grid ("bj_griddetails" with an Issue Number column) IS a
        // valid SCO cost file despite its Trye/Spare columns - never steer it away.
        const isScoIssueGrid = kind === 'sco' && /issue\s*n(umber|o)/.test(headerLine)
        const looksLikeGrid = !isScoIssueGrid
          && (/grid\s*detail|parts?\s*consumption|trye|item\s*desc/i.test(file.name) || headerLine.includes('trye'))
        setError(
          looksLikeGrid
            ? `${file.name} looks like an ERP expense/parts grid. Upload it in the Data Intake Center (ERP Import), not here. This page only takes ${title} files (columns: ${tpl?.headers?.join(', ') || 'see below'}).`
            : `Read ${dataRows.length} rows but none matched the expected columns. Expected: ${tpl?.headers?.join(', ') || 'see below'}.`,
        )
        return
      }
      const res = await service.import(mapped, (p) => {
        if (p?.total) setImportPct(Math.round((p.done / p.total) * 100))
      })
      const parts = [`Read ${res.read ?? dataRows.length}`, `imported ${res.inserted || 0}`]
      if (res.skipped) {
        const rr = res.skip_reasons || {}
        const why = [
          rr.no_date && `${rr.no_date} with an unreadable date`,
          rr.no_amount && `${rr.no_amount} with no amount`,
          rr.no_country && `${rr.no_country} with no country`,
        ].filter(Boolean).join(', ')
        parts.push(`${res.skipped} skipped${why ? ` (${why})` : ' (missing country/amount/date)'}`)
      }
      if (res.failed) parts.push(`${res.failed} failed`)
      if (res.updated) parts.splice(2, 0, `${res.updated} updated`)
      let msg = `${file.name}: ${parts.join(', ')}.`
      if (res.failed && res.errors?.length) msg += ` First error: ${res.errors[0]}`
      // Nothing imported is a problem to fix, not a success to skim past.
      if (res.failed || !res.inserted) setError(msg); else setNotice(msg)
      logIntakeToHistory({ filename: file.name, sizeBytes: file.size, module: kind, country, result: res, at: new Date().toISOString() })
      load()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setImporting(false)
      setImportPct(0)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove(id) {
    try { await service.remove(id); load() } catch (e) { setError(toUserMessage(e)) }
  }

  function exportExcel() {
    if (!rows.length) return
    const keys = columns.map((c) => c.key)
    const headers = columns.map((c) => c.header)
    const flat = rows.map((r) => {
      const o = {}
      for (const c of columns) {
        const v = c.render ? c.render(r) : r[c.key]
        o[c.key] = c.kind === 'money' || c.kind === 'int' ? (num(v) ?? '') : (v ?? '')
      }
      return o
    })
    exportToExcel(flat, keys, headers, `TyrePulse_${kind}_${country}`, title)
  }

  // The headline figures, as table rows. Same order the tiles were in, so the
  // page still reads top-down the way it did.
  const summaryMeasures = !summary ? [] : [
    { key: 'rows', label: 'Rows', value: rowsLabel },
    { key: 'value', label: isProd ? 'Approved M3' : 'Total value', value: fmtSummaryVal(summary.totals.value), strong: true },
    { key: 'sites', label: 'Sites', value: summary.totals.sites.toLocaleString() },
    {
      key: 'period',
      label: 'Period covered',
      value: summary.totals.firstMonth
        ? (summary.totals.firstMonth === summary.totals.lastMonth
          ? summary.totals.firstMonth
          : `${summary.totals.firstMonth} to ${summary.totals.lastMonth}`)
        : 'N/A',
    },
    ...(isProd ? [
      { key: 'supplied', label: 'Supplied M3', value: fmtSummaryVal(summary.totals.supplied_m3) },
      { key: 'rejected', label: 'Rejected loads', value: summary.totals.rejected_loads.toLocaleString() },
    ] : []),
    ...(kind === 'sany' ? [
      { key: 'counted', label: 'Counted for Cost/M3 (non-detail)', value: fmtSummaryVal(summary.totals.counted_value) },
      { key: 'detail', label: 'Detail lines', value: summary.totals.detail_rows.toLocaleString() },
    ] : []),
  ]

  // By month and by site answer the same question about a different grouping,
  // so they take the same three columns.
  const groupColumns = (nameHeader, valueHeader) => ([
    { key: 'name', header: nameHeader, align: 'left' },
    { key: 'rows', header: 'Rows', align: 'right', render: (r) => r.rows.toLocaleString() },
    { key: 'value', header: valueHeader, align: 'right', render: (r) => <span className="font-medium">{fmtSummaryVal(r.value)}</span> },
  ])

  function fmtCell(col, row) {
    if (col.render) return col.render(row)
    const raw = row[col.key]
    if (col.kind === 'money' || col.kind === 'int') {
      const n = num(raw)
      return n == null ? 'N/A' : Math.round(n).toLocaleString()
    }
    return raw == null || raw === '' ? '-' : String(raw)
  }

  return (
    <div className="p-4 md:p-6 max-w-[1300px] mx-auto">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={openForm} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] text-white px-3 py-1.5 text-sm">
              <Plus size={14} /> Add
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm disabled:opacity-50">
              <Upload size={14} /> {importing ? `Importing... ${importPct}%` : 'Import'}
            </button>
            <button type="button" onClick={exportExcel} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm">
              <FileSpreadsheet size={14} /> Export
            </button>
            <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm">
              <RefreshCcw size={14} /> Refresh
            </button>
            <input ref={fileRef} type="file" accept={kind === 'sany' ? '.xlsx,.xls,.csv,.pdf' : '.xlsx,.xls,.csv'} className="hidden" onChange={onFile} />
          </div>
        }
      />

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border-subtle)] p-0.5">
          {COUNTRIES.map((c) => (
            <button key={c} type="button" onClick={() => setCountry(c)}
              className={`px-3 py-1.5 text-sm rounded-md ${country === c ? 'bg-[var(--accent)] text-white' : ''}`}
              style={country === c ? undefined : { color: 'var(--text-secondary)' }}>{c}</button>
          ))}
        </div>
        {!hidePeriod && (
          <>
            <select value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} className="rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-sm">
              {CPK_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{periodLabel(bounds)}</span>
          </>
        )}
        {!hideTotal && (
          <span className="ml-auto text-sm font-semibold tabular-nums">
            Total: {Math.round(total).toLocaleString()}
          </span>
        )}
      </div>

      {tpl && (
        <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Import columns: {tpl.headers.join(', ')}
        </p>
      )}

      {notice && <div className="mb-3 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm">{notice}</div>}
      {error && <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">{error}</div>}

      {/* Add form */}
      {showForm && (
        <div className="mb-4 rounded-xl border border-[var(--border-subtle)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Add {title.toLowerCase()}</h3>
            <button type="button" onClick={() => setShowForm(false)}><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {formFields.map((f) => (
              <label key={f.key} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {f.label}{f.required ? ' *' : ''}
                {f.type === 'select' ? (
                  <select value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-sm text-[var(--text-primary)]">
                    <option value="">-</option>
                    {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.type === 'number' ? 'number' : f.type === 'month' ? 'month' : 'text'}
                    value={f.type === 'month' ? String(form[f.key] || '').slice(0, 7) : (form[f.key] ?? '')}
                    onChange={(e) => setForm({ ...form, [f.key]: f.type === 'month' ? `${e.target.value}-01` : e.target.value })}
                    className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-sm text-[var(--text-primary)]"
                  />
                )}
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={save} disabled={saving} className="rounded-md bg-[var(--accent)] text-white px-4 py-1.5 text-sm disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-[var(--border-subtle)] px-4 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Summary first: headline figures + by-month + by-site, all as tables. */}
      {hasSummary && (
        <div className="mb-4 rounded-xl border border-[var(--border-subtle)] p-4">
          <h3 className="mb-3 text-sm font-semibold">Summary - {country}{hidePeriod ? '' : `, ${periodLabel(bounds)}`}</h3>
          {loading ? (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Loading...</p>
          ) : summary.totals.rows === 0 ? (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              No rows for {country} in this period. Add one or import a file.
            </p>
          ) : (
            <>
              <div className="mb-4">
                <CostM3Table
                  dense
                  columns={MEASURE_COLUMNS}
                  rows={summaryMeasures}
                  rowKey="key"
                  empty="No figures for this period."
                />
              </div>
              {/* Say exactly what the summary rests on. This used to fire on a
                  row-count guess and describe the list as "bounded"; it now
                  states the real gap from the server count, and says nothing at
                  all when the read genuinely covered the whole window. */}
              {truncated && (
                <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  These figures cover the {rows.length.toLocaleString()} most recent rows of{' '}
                  {totalRows.toLocaleString()} in this period, not the full window. Narrow the
                  period for a complete summary, or use the monthly summary above, which is
                  computed on the server over every row.
                </p>
              )}
              {summary.totals.mixedCurrency && (
                <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Rows carry more than one currency ({summary.totals.currencies.join(', ')}) - totals are not labelled with a single currency.
                </p>
              )}
              <div className="grid md:grid-cols-2 gap-4">
                <CostM3Table
                  dense
                  title="By month"
                  columns={groupColumns('Month', isProd ? 'Approved M3' : 'Value')}
                  rows={summary.byMonth.map((m) => ({ name: m.month, rows: m.rows, value: m.value }))}
                  rowKey="name"
                  empty="None"
                />
                <CostM3Table
                  dense
                  title="By site"
                  columns={groupColumns('Site', isProd ? 'Approved M3' : 'Value')}
                  rows={summary.bySite.slice(0, 10).map((s) => ({ name: s.site, rows: s.rows, value: s.value }))}
                  rowKey="name"
                  empty="None"
                  footnote={summary.bySite.length > 10 ? `and ${summary.bySite.length - 10} more sites - see all rows below` : ''}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* The raw rows are never fetched to open this page. They are fetched
          here, on the press, because that is the only moment anyone wants them.
          The button says how many are coming so a large window is a choice. */}
      {hasSummary && !loading && (
        <div className="mb-3 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => (showRows ? setShowRows(false) : loadRows())}
            disabled={rowsLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm disabled:opacity-60"
            style={{ color: 'var(--text-secondary)' }}
          >
            {showRows ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {rowsLoading ? 'Loading rows...' : showRows ? 'Hide rows' : `Show rows (${rowsLabel})`}
          </button>
          {!showRows && (
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
              The summary above is the whole period. Rows load only when you open them.
            </span>
          )}
        </div>
      )}

      {/* Table */}
      {rowsVisible && (
        <CostM3Table
          columns={[
            ...columns.map((c) => ({
              key: c.key,
              header: c.header,
              align: c.align,
              cellClass: 'whitespace-nowrap',
              render: (r) => fmtCell(c, r),
            })),
            {
              key: '__actions',
              header: '',
              align: 'right',
              width: '1%',
              render: (r) => (
                <button type="button" onClick={() => remove(r.id)} title="Delete" className="opacity-60 hover:opacity-100">
                  <Trash2 size={14} />
                </button>
              ),
            },
          ]}
          rows={rows}
          // "Still fetching" is not "there is nothing here" - the lazy row read
          // must not render the add-or-import prompt while it is in flight.
          loading={loading || rowsLoading}
          empty={`No rows for ${country} in this period. Add one or import a file.`}
        />
      )}
    </div>
  )
}
