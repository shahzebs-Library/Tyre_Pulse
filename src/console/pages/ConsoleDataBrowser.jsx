/**
 * ConsoleDataBrowser  (Module 3)
 *
 * A no-code data browser for super admins. It lets an operator pick a safelisted
 * operational table, filter it with a single plain-English predicate (built by
 * dropdowns or parsed from a natural-language question by the AI), preview the
 * matching rows, export them to Excel, and correct or remove a single row.
 *
 * EDITING (V364) is deliberately narrow, because a generic write path over live
 * operational data is the easiest way to lose data quietly:
 *   - one row at a time, never a bulk update;
 *   - identity, tenancy and generated columns are refused by the server, so a row
 *     can never be re-keyed or moved to another company;
 *   - every change stores the complete before and after row and can be undone from
 *     the Recent changes list, including bringing a deleted row back.
 *
 * Safety model: the AI only converts a question into a { column, op, value }
 * FILTER. Your data is never sent to the model for computation, and every query
 * runs through server-side super-admin RPCs that whitelist the table, column and
 * operator and bind the value as a parameter. No raw SQL is ever shown or run.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Database, Search, Sparkles, Play, Download, RefreshCw,
  Table2, Filter, AlertTriangle, Info, Loader2, X, Pencil, Trash2, Undo2, Lock,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listTables, listColumns, queryTable,
  updateRow, deleteRow, revertChange, listRowChanges, isEditableColumn,
} from '../../lib/api/dataBrowser'
import { askDataToFilter } from '../../lib/api/askData'
import {
  QUERY_OPERATORS, operatorLabel, normalizeFilter, describeFilter, isValidOperator,
} from '../../lib/queryBuilder'
import { exportToExcel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

const LIMIT_OPTIONS = [50, 100, 500]
const EMPTY_FILTER = { column: '', op: 'eq', value: '' }

export default function ConsoleDataBrowser() {
  const { admin } = useConsoleAuth()

  const [tables, setTables]         = useState([])
  const [tablesLoading, setTablesLoading] = useState(true)
  const [selected, setSelected]     = useState('')

  const [columns, setColumns]       = useState([])
  const [filter, setFilter]         = useState(EMPTY_FILTER)
  const [limit, setLimit]           = useState(100)

  const [rows, setRows]             = useState([])
  const [running, setRunning]       = useState(false)
  const [error, setError]           = useState(null)
  const [ran, setRan]               = useState(false)

  const [question, setQuestion]     = useState('')
  const [asking, setAsking]         = useState(false)
  const [askError, setAskError]     = useState(null)
  const [askNote, setAskNote]       = useState(null)

  // Row editing (V364)
  const [editRow, setEditRow]       = useState(null)   // the row being edited
  const [editDraft, setEditDraft]   = useState({})     // column -> new value
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busy, setBusy]             = useState(false)
  const [changes, setChanges]       = useState([])
  const [notice, setNotice]         = useState('')

  const tableNames = useMemo(() => tables.map(t => t.table_name), [tables])
  const columnLabels = useMemo(
    () => columns.map(c => ({ key: c.column_name, label: c.column_name })),
    [columns],
  )
  const rowKeys = useMemo(
    () => (rows.length ? Object.keys(rows[0]) : columns.map(c => c.column_name)),
    [rows, columns],
  )

  // ── Initial load: the safelisted tables with row counts ──
  useEffect(() => { loadTables() }, [])
  // Show any prior edits/deletes so the undo list survives a page reload.
  useEffect(() => { listRowChanges(20).then(setChanges).catch(() => setChanges([])) }, [])

  async function loadTables() {
    setTablesLoading(true)
    const data = await listTables()
    setTables(data)
    setTablesLoading(false)
    if (data.length && !selected) selectTable(data[0].table_name, data)
  }

  // ── Pick a table: load its columns, reset the filter, preview first rows ──
  async function selectTable(name, tableSource = tables) {
    setSelected(name)
    setFilter(EMPTY_FILTER)
    setAskNote(null)
    setAskError(null)
    setError(null)
    setRan(false)
    setRows([])
    const cols = await listColumns(name)
    setColumns(cols)
    await run(name, EMPTY_FILTER, limit)
    void tableSource
  }

  // ── Run a query against the server RPC ──
  async function run(table, f, lim) {
    if (!table) return
    setRunning(true)
    setError(null)
    try {
      const clean = normalizeFilter({ table, ...f })
      const data = await queryTable({
        table,
        column: clean?.column || null,
        op: clean?.op || null,
        value: clean ? clean.value : null,
        limit: lim,
      })
      setRows(Array.isArray(data) ? data : [])
      setRan(true)
    } catch (e) {
      setError('Could not load rows. Please try again.')
      setRows([])
    } finally {
      setRunning(false)
    }
  }

  function handleRun() {
    run(selected, filter, limit)
  }

  function handleLimit(n) {
    setLimit(n)
    if (selected) run(selected, filter, n)
  }

  // ── Ask your data: turn a question into a filter, then run it ──
  async function handleAsk(e) {
    e?.preventDefault?.()
    const q = question.trim()
    if (!q || asking) return
    setAsking(true)
    setAskError(null)
    setAskNote(null)
    try {
      const res = await askDataToFilter(q, { tables: tableNames })
      if (!res?.ok) {
        setAskError(res?.reason || 'Could not read that question into a filter. Try the dropdown filter below.')
        return
      }
      const { filter: aiFilter, explanation } = res
      const nextTable = aiFilter.table && tableNames.includes(aiFilter.table) ? aiFilter.table : selected
      const nextFilter = {
        column: aiFilter.column || '',
        op: isValidOperator(aiFilter.op) ? aiFilter.op : 'eq',
        value: aiFilter.value == null ? '' : String(aiFilter.value),
      }
      setAskNote(explanation || null)
      if (nextTable !== selected) {
        setSelected(nextTable)
        const cols = await listColumns(nextTable)
        setColumns(cols)
      }
      setFilter(nextFilter)
      await run(nextTable, nextFilter, limit)
    } catch (err) {
      setAskError('The assistant is unavailable right now. Use the dropdown filter below.')
    } finally {
      setAsking(false)
    }
  }

  // ── Excel export of the current result rows ──
  async function handleExport() {
    if (!rows.length) return
    const keys = rowKeys
    try {
      await exportToExcel(
        rows,
        keys,
        keys,
        `TyrePulse ${selected} Data`,
        'Data',
        { title: `${selected} data browser export` },
      )
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Please try again.'))
    }
  }

  // ── Row editing (V364) ──────────────────────────────────────────────────
  // The undo list is only fetched once a change exists, so an untouched console
  // makes no extra request.
  async function refreshChanges() {
    setChanges(await listRowChanges(20))
  }

  function openEdit(row) {
    setEditRow(row); setEditDraft({}); setNotice(''); setError(null)
  }

  /** Only the columns that actually changed are sent. */
  function draftPatch() {
    const patch = {}
    for (const [k, v] of Object.entries(editDraft)) {
      const original = editRow?.[k]
      const before = original == null ? '' : String(original)
      if (String(v) !== before) patch[k] = v
    }
    return patch
  }

  async function saveEdit() {
    const patch = draftPatch()
    if (!editRow?.id || !Object.keys(patch).length) { setEditRow(null); return }
    setBusy(true); setError(null)
    try {
      await updateRow(selected, editRow.id, patch)
      const changed = Object.keys(patch)
      setNotice(`Saved ${changed.length} change(s) to ${changed.join(', ')}. You can undo this below.`)
      setEditRow(null); setEditDraft({})
      await Promise.all([run(selected, filter, limit), refreshChanges()])
    } catch (err) {
      setError(err?.message || 'Could not save that change.')
    } finally {
      setBusy(false)
    }
  }

  async function doDelete() {
    if (!confirmDelete?.id) return
    setBusy(true); setError(null)
    try {
      await deleteRow(selected, confirmDelete.id)
      setNotice('Row deleted. It is kept in full and can be brought back below.')
      setConfirmDelete(null)
      await Promise.all([run(selected, filter, limit), refreshChanges()])
    } catch (err) {
      setError(err?.message || 'Could not delete that row.')
    } finally {
      setBusy(false)
    }
  }

  async function doRevert(changeId) {
    setBusy(true); setError(null)
    try {
      const r = await revertChange(changeId)
      setNotice(r?.action === 'delete' ? 'Row restored.' : 'Edit undone.')
      await Promise.all([run(selected, filter, limit), refreshChanges()])
    } catch (err) {
      setError(err?.message || 'Could not undo that change.')
    } finally {
      setBusy(false)
    }
  }

  const filterSummary = describeFilter({ table: selected, ...filter }, { columns: columnLabels })
  const canExport = rows.length > 0 && !running
  // Editing needs a row id to target; a projection without one stays read-only.
  const canEditRows = rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0] || {}, 'id')

  return (
    <div className="space-y-5 max-w-7xl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Database size={20} className="text-orange-400" /> Data Browser
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {admin?.full_name ? `${admin.full_name} | ` : ''}Read only. Browse, filter and export operational data with no SQL.
          </p>
        </div>
        <button onClick={loadTables} disabled={tablesLoading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={tablesLoading ? 'animate-spin' : ''} /> Refresh tables
        </button>
      </div>

      {/* ── Scope banner ── */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-800/40 bg-blue-900/20 px-3 py-2">
        <Info size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-blue-200/90">
          Browse, filter and export any of these tables, and correct or remove a single row.
          Every edit and delete keeps the original and can be undone below. The row id, the owning
          company and any value the database calculates itself cannot be changed here.
        </p>
      </div>

      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-800/40 bg-emerald-900/20 px-3 py-2">
          <Info size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-emerald-200/90">{notice}</p>
        </div>
      )}

      {/* ── Undo list: only appears once something has been changed ── */}
      {changes.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-800 text-[11px] font-semibold text-gray-300 flex items-center gap-2">
            <Undo2 size={12} className="text-gray-500" /> Recent changes
            <span className="text-[10px] text-gray-600 font-normal">every one can be undone</span>
          </div>
          <div className="divide-y divide-gray-800/60 max-h-44 overflow-y-auto">
            {changes.map((c) => (
              <div key={c.id} className="px-4 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-200">
                    {c.action === 'delete' ? 'Deleted a row from' : 'Edited a row in'} {c.tbl}
                  </p>
                  <p className="text-[10px] text-gray-600">
                    {new Date(c.created_at).toISOString().slice(0, 16).replace('T', ' ')}
                  </p>
                </div>
                {c.reverted_at ? (
                  <span className="px-2 py-0.5 rounded text-[9px] font-semibold text-emerald-300 border border-emerald-800/50 bg-emerald-900/20 flex-shrink-0">
                    Undone
                  </span>
                ) : (
                  <button onClick={() => doRevert(c.id)} disabled={busy}
                    className="h-7 px-2.5 rounded-lg bg-gray-800 border border-gray-700 text-[11px] text-gray-300 hover:text-white flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50">
                    <Undo2 size={11} /> Undo
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Ask your data ── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={15} className="text-orange-400" />
          <h3 className="text-sm font-semibold text-white">Ask your data</h3>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">
          The assistant reads your question into a filter. Your data is never sent for computation. It only
          picks a column, an operator and a value, then the query runs on the server.
        </p>
        <form onSubmit={handleAsk} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="e.g. tyres at the NHC site, or accidents where severity equals major"
              title="Ask in plain English. The assistant turns it into a column, operator and value filter."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/60"
            />
          </div>
          <button type="submit" disabled={asking || !question.trim() || !tableNames.length}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-orange-500/90 hover:bg-orange-500 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {asking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {asking ? 'Reading' : 'Ask'}
          </button>
        </form>
        {askNote && (
          <p className="mt-2 text-[11px] text-emerald-300/90 flex items-center gap-1.5">
            <Filter size={12} /> {askNote}
          </p>
        )}
        {askError && (
          <p className="mt-2 text-[11px] text-amber-300/90 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {askError}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* ── Left: table picker ── */}
        <div className="lg:col-span-1 rounded-xl border border-gray-800 bg-gray-900/50 p-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Table2 size={13} /> Tables
          </h3>
          {tablesLoading
            ? <p className="text-xs text-gray-600 py-2">Loading tables...</p>
            : tables.length === 0
              ? <p className="text-xs text-gray-600 py-2">No tables available.</p>
              : (
                <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
                  {tables.map(t => (
                    <button key={t.table_name} onClick={() => selectTable(t.table_name)}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                        selected === t.table_name
                          ? 'bg-orange-500/15 border border-orange-500/40'
                          : 'hover:bg-gray-800 border border-transparent'
                      }`}>
                      <span className={`text-xs font-medium truncate ${selected === t.table_name ? 'text-orange-200' : 'text-gray-300'}`}>
                        {t.table_name}
                      </span>
                      <span className="text-[10px] text-gray-500 flex-shrink-0">{fmtNum(t.row_count)}</span>
                    </button>
                  ))}
                </div>
              )
          }
        </div>

        {/* ── Right: filter builder + results ── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Filter builder */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter size={14} className="text-orange-400" />
              <h3 className="text-sm font-semibold text-white">Filter {selected ? <span className="text-gray-500 font-normal">on {selected}</span> : ''}</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <select
                value={filter.column}
                onChange={e => setFilter(f => ({ ...f, column: e.target.value }))}
                title="Choose which column to filter on."
                className="sm:col-span-4 px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-sm text-white focus:outline-none focus:border-orange-500/60">
                <option value="">All columns (no filter)</option>
                {columns.map(c => (
                  <option key={c.column_name} value={c.column_name}>{c.column_name}</option>
                ))}
              </select>
              <select
                value={filter.op}
                onChange={e => setFilter(f => ({ ...f, op: e.target.value }))}
                title="Choose how to compare. Contains does a partial text match."
                className="sm:col-span-3 px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-sm text-white focus:outline-none focus:border-orange-500/60">
                {QUERY_OPERATORS.map(o => (
                  <option key={o.key} value={o.key}>{operatorLabel(o.key)}</option>
                ))}
              </select>
              <input
                value={filter.value}
                onChange={e => setFilter(f => ({ ...f, value: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') handleRun() }}
                placeholder="Value"
                title="The value to compare against. Leave blank with All columns to see every row."
                className="sm:col-span-3 px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/60"
              />
              <button onClick={handleRun} disabled={running || !selected}
                className="sm:col-span-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-orange-500/90 hover:bg-orange-500 text-white text-sm font-semibold transition-colors disabled:opacity-40">
                {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run
              </button>
            </div>
            <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
              <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <Info size={12} /> {filterSummary}
                {filter.column && (
                  <button onClick={() => { const nf = EMPTY_FILTER; setFilter(nf); run(selected, nf, limit) }}
                    title="Clear the filter and show all rows."
                    className="ml-1 text-gray-600 hover:text-gray-300 inline-flex items-center gap-0.5">
                    <X size={11} /> clear
                  </button>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-500">Rows</span>
                {LIMIT_OPTIONS.map(n => (
                  <button key={n} onClick={() => handleLimit(n)}
                    title={`Show up to ${n} rows.`}
                    className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                      limit === n
                        ? 'bg-orange-500/15 border-orange-500/40 text-orange-200'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                    }`}>{n}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">
                Results {ran && !running && <span className="text-gray-500 font-normal">({rows.length} row{rows.length === 1 ? '' : 's'}{rows.length === limit ? `, showing first ${limit}` : ''})</span>}
              </h3>
              <button onClick={handleExport} disabled={!canExport}
                title={canExport ? 'Download these rows as an Excel workbook.' : 'Run a query with results to export.'}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                <Download size={13} /> Export Excel
              </button>
            </div>

            {running
              ? <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-500">
                  <Loader2 size={22} className="animate-spin text-orange-400" />
                  <p className="text-xs">Loading rows...</p>
                </div>
              : error
                ? <div className="py-12 flex flex-col items-center justify-center gap-2">
                    <AlertTriangle size={22} className="text-red-400" />
                    <p className="text-xs text-red-300">{error}</p>
                    <button onClick={handleRun}
                      className="mt-1 text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">
                      Retry
                    </button>
                  </div>
                : rows.length === 0
                  ? <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-600">
                      <Search size={22} />
                      <p className="text-xs">No rows match</p>
                    </div>
                  : (
                    <div className="overflow-auto max-h-[540px] rounded-lg border border-gray-800">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-gray-950 z-10">
                          <tr>
                            {canEditRows && (
                              <th className="px-3 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-800 whitespace-nowrap w-20">
                                Actions
                              </th>
                            )}
                            {rowKeys.map(k => (
                              <th key={k} className="px-3 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-800 whitespace-nowrap">
                                {k}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={r.id || i} className="hover:bg-gray-800/40">
                              {canEditRows && (
                                <td className="px-3 py-1.5 border-b border-gray-800/60 whitespace-nowrap">
                                  <div className="flex items-center gap-1">
                                    <button onClick={() => openEdit(r)} disabled={busy}
                                      title="Correct a value in this row"
                                      className="p-1 rounded text-gray-400 hover:text-orange-300 hover:bg-gray-800 disabled:opacity-40">
                                      <Pencil size={12} />
                                    </button>
                                    <button onClick={() => { setConfirmDelete(r); setNotice('') }} disabled={busy}
                                      title="Delete this row (can be undone)"
                                      className="p-1 rounded text-gray-400 hover:text-red-300 hover:bg-gray-800 disabled:opacity-40">
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </td>
                              )}
                              {rowKeys.map(k => (
                                <td key={k} className="px-3 py-1.5 text-xs text-gray-300 border-b border-gray-800/60 whitespace-nowrap max-w-[280px] truncate" title={cellText(r[k])}>
                                  {cellText(r[k])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
            }
          </div>
        </div>
      </div>

      {/* ── Edit one row ── */}
      {editRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setEditRow(null)}>
          <div className="w-full max-w-2xl rounded-xl bg-[#0f0f16] border border-gray-800 flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Pencil size={14} className="text-orange-400" /> Edit row in {selected}
              </h3>
              <button onClick={() => setEditRow(null)} className="text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-3 overflow-y-auto space-y-2.5">
              <p className="text-[11px] text-gray-500">
                Change only what you need. Blank means the value is cleared. Locked fields are the
                row id, the owning company and values the database calculates itself.
              </p>
              {rowKeys.map((k) => {
                const locked = !isEditableColumn(k, columns)
                const current = editRow[k] == null ? '' : cellText(editRow[k])
                const value = editDraft[k] !== undefined ? editDraft[k] : current
                const dirty = String(value) !== current
                return (
                  <div key={k} className="grid grid-cols-3 gap-2 items-center">
                    <label className="text-[11px] text-gray-400 truncate flex items-center gap-1" title={k}>
                      {locked && <Lock size={9} className="text-gray-600 flex-shrink-0" />}
                      {k}
                    </label>
                    <input
                      value={value}
                      disabled={locked || busy}
                      onChange={e => setEditDraft(d => ({ ...d, [k]: e.target.value }))}
                      className={`col-span-2 h-8 rounded-lg px-2.5 text-xs bg-gray-800/80 border text-white focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                        dirty ? 'border-orange-500' : 'border-gray-700 focus:border-orange-500'
                      }`}
                    />
                  </div>
                )
              })}
            </div>

            <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-500">
                {Object.keys(draftPatch()).length
                  ? `${Object.keys(draftPatch()).length} field(s) changed`
                  : 'Nothing changed yet'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setEditRow(null)}
                  className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white">
                  Cancel
                </button>
                <button onClick={saveEdit} disabled={busy || !Object.keys(draftPatch()).length}
                  className="h-9 px-3 rounded-lg bg-orange-600 hover:bg-orange-500 text-xs font-semibold text-white flex items-center gap-2 disabled:opacity-40">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />} Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm delete ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setConfirmDelete(null)}>
          <div className="w-full max-w-md rounded-xl bg-[#0f0f16] border border-gray-800 p-5 space-y-4"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-400" /> Delete this row
            </h3>
            <p className="text-xs text-gray-400">
              This removes one row from {selected}. The complete row is kept, so you can bring it
              back from Recent changes straight afterwards.
            </p>
            <div className="rounded-lg bg-black/40 border border-gray-800 px-3 py-2 max-h-32 overflow-y-auto">
              {rowKeys.slice(0, 6).map(k => (
                <p key={k} className="text-[10px] text-gray-500 truncate">
                  <span className="text-gray-400">{k}:</span> {cellText(confirmDelete[k]) || 'N/A'}
                </p>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)}
                className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white">
                Cancel
              </button>
              <button onClick={doDelete} disabled={busy}
                className="h-9 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white flex items-center gap-2 disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtNum(n) { return n != null ? Number(n).toLocaleString() : '0' }

function cellText(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}
