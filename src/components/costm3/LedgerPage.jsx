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
import { IMPORT_TEMPLATES, mapImportRows, summarizeLedger } from '../../lib/costPerM3'
import { parseWorkbook } from '../../lib/import/parseWorkbook'
import { logIntakeToHistory } from '../../lib/api/costPerM3'
import { exportToExcel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

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
  const fileRef = useRef(null)

  const tpl = IMPORT_TEMPLATES[kind]

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true); setError('')
    service.list({ country, from: bounds.from, to: bounds.to })
      .then((res) => { if (!cancelled) setRows(Array.isArray(res) ? res : []) })
      .catch((e) => { if (!cancelled) { setRows([]); setError(toUserMessage(e)) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, bounds.from, bounds.to, service])

  useEffect(() => load(), [load])

  const total = useMemo(
    () => rows.reduce((s, r) => s + (num(r[amountKey]) || 0), 0),
    [rows, amountKey],
  )

  // Summary-first applies to the three period ledgers; the sites register keeps
  // its plain always-visible table (no amounts, tiny dataset).
  const hasSummary = kind === 'sco' || kind === 'sany' || kind === 'production'
  const summary = useMemo(() => (hasSummary ? summarizeLedger(rows, kind) : null), [hasSummary, rows, kind])
  const isProd = kind === 'production'
  const oneCurrency = summary && !summary.totals.mixedCurrency ? (summary.totals.currencies[0] || '') : ''
  const fmtSummaryVal = (v) => {
    if (v == null) return 'N/A'
    if (isProd) return `${Math.round(v).toLocaleString()} M3`
    if (summary?.totals.mixedCurrency) return `${Math.round(v).toLocaleString()} (mixed currencies)`
    return `${oneCurrency ? oneCurrency + ' ' : ''}${Math.round(v).toLocaleString()}`
  }
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

      {/* Summary first: tiles + by-month + by-site over the filtered rows. */}
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
              <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryTile label="Rows" value={summary.totals.rows.toLocaleString()} />
                <SummaryTile label={isProd ? 'Approved M3' : 'Total value'} value={fmtSummaryVal(summary.totals.value)} strong />
                <SummaryTile label="Sites" value={summary.totals.sites.toLocaleString()} />
                <SummaryTile
                  label="Period covered"
                  value={summary.totals.firstMonth
                    ? (summary.totals.firstMonth === summary.totals.lastMonth
                      ? summary.totals.firstMonth
                      : `${summary.totals.firstMonth} to ${summary.totals.lastMonth}`)
                    : 'N/A'}
                />
                {isProd && <SummaryTile label="Supplied M3" value={fmtSummaryVal(summary.totals.supplied_m3)} />}
                {isProd && <SummaryTile label="Rejected loads" value={summary.totals.rejected_loads.toLocaleString()} />}
                {kind === 'sany' && <SummaryTile label="Counted for Cost/M3 (non-detail)" value={fmtSummaryVal(summary.totals.counted_value)} />}
                {kind === 'sany' && <SummaryTile label="Detail lines" value={summary.totals.detail_rows.toLocaleString()} />}
              </div>
              {summary.totals.rows >= 500 && (
                <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Summary covers the {summary.totals.rows.toLocaleString()} loaded rows for this period (the list is bounded). The server-side monthly summary above this page covers every row.
                </p>
              )}
              {summary.totals.mixedCurrency && (
                <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Rows carry more than one currency ({summary.totals.currencies.join(', ')}) - totals are not labelled with a single currency.
                </p>
              )}
              <div className="grid md:grid-cols-2 gap-4">
                <SummaryTable
                  title="By month"
                  nameHeader="Month"
                  valueHeader={isProd ? 'Approved M3' : 'Value'}
                  rows={summary.byMonth.map((m) => ({ name: m.month, rows: m.rows, value: m.value }))}
                  fmtVal={fmtSummaryVal}
                />
                <SummaryTable
                  title="By site"
                  nameHeader="Site"
                  valueHeader={isProd ? 'Approved M3' : 'Value'}
                  rows={summary.bySite.slice(0, 10).map((s) => ({ name: s.site, rows: s.rows, value: s.value }))}
                  fmtVal={fmtSummaryVal}
                  footnote={summary.bySite.length > 10 ? `and ${summary.bySite.length - 10} more sites - see all rows below` : ''}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* All-rows toggle: raw detail stays available, collapsed by default. */}
      {hasSummary && !loading && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowRows((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            {showRows ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showRows ? 'Hide rows' : `Show all rows (${rows.length.toLocaleString()})`}
          </button>
        </div>
      )}

      {/* Table */}
      {rowsVisible && (
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full text-sm border-collapse">
          <thead style={{ background: 'var(--surface-raised, var(--bg-elevated))' }}>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-secondary)' }}>{c.header}</th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center" style={{ color: 'var(--text-secondary)' }}>Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center" style={{ color: 'var(--text-secondary)' }}>No rows for {country} in this period. Add one or import a file.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border-subtle)]">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}>{fmtCell(c, r)}</td>
                ))}
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => remove(r.id)} title="Delete" className="opacity-60 hover:opacity-100"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}

function SummaryTile({ label, value, strong }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-3">
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className={`mt-1 tabular-nums ${strong ? 'text-lg font-bold' : 'text-base font-semibold'}`}>{value}</div>
    </div>
  )
}

function SummaryTable({ title, nameHeader, valueHeader, rows = [], fmtVal, footnote }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
      <div className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{title}</div>
      <table className="w-full text-sm border-collapse">
        <thead style={{ background: 'var(--surface-raised, var(--bg-elevated))' }}>
          <tr>
            <th className="px-3 py-1.5 text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>{nameHeader}</th>
            <th className="px-3 py-1.5 text-right font-semibold" style={{ color: 'var(--text-secondary)' }}>Rows</th>
            <th className="px-3 py-1.5 text-right font-semibold" style={{ color: 'var(--text-secondary)' }}>{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={3} className="px-3 py-3 text-center" style={{ color: 'var(--text-secondary)' }}>None</td></tr>
          ) : rows.map((r, i) => (
            <tr key={r.name || i} className="border-t border-[var(--border-subtle)]">
              <td className="px-3 py-1.5">{r.name}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{r.rows.toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmtVal(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {footnote ? <p className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{footnote}</p> : null}
    </div>
  )
}
