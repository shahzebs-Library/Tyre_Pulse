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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Database, Sparkles, Play, Download, RefreshCw,
  Table2, Filter, AlertTriangle, Info, X, Pencil, Trash2, Undo2, Lock, CheckCircle2, BarChart3,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Code, Btn, Segmented, SearchInput, Select,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { BarsChart } from '../components/ui/charts'
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
  // Show any prior edits/deletes so the undo list survives a page reload.
  useEffect(() => { listRowChanges(20).then(setChanges).catch(() => setChanges([])) }, [])

  const loadTables = useCallback(async () => {
    setTablesLoading(true)
    try {
      setTables(await listTables())
    } catch (err) {
      setError(toUserMessage(err, 'Could not refresh the table list.'))
    } finally {
      setTablesLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function loadInitialTable() {
      setTablesLoading(true)
      try {
        const data = await listTables()
        if (!active) return
        setTables(data)
        if (!data.length) return
        const name = data[0].table_name
        setSelected(name)
        setRunning(true)
        const [cols, initialRows] = await Promise.all([
          listColumns(name),
          queryTable({ table: name, column: null, op: null, value: null, limit: 100 }),
        ])
        if (!active) return
        setColumns(cols)
        setRows(Array.isArray(initialRows) ? initialRows : [])
        setRan(true)
      } catch (err) {
        if (active) setError(toUserMessage(err, 'Could not load the data browser. Please try again.'))
      } finally {
        if (active) {
          setTablesLoading(false)
          setRunning(false)
        }
      }
    }
    loadInitialTable()
    return () => { active = false }
  }, [])

  // ── Pick a table: load its columns, reset the filter, preview first rows ──
  async function selectTable(name, tableSource = tables) {
    setSelected(name)
    setFilter(EMPTY_FILTER)
    setAskNote(null)
    setAskError(null)
    setError(null)
    setRan(false)
    setRows([])
    try {
      const cols = await listColumns(name)
      setColumns(cols)
      await run(name, EMPTY_FILTER, limit)
    } catch (err) {
      setError(toUserMessage(err, 'Could not open that table.'))
    }
    void tableSource
  }

  // ── Run a query against the server RPC ──
  // Each run is numbered: switching tables quickly used to let the slower,
  // older answer land last and show one table's rows under another's name.
  const runSeq = useRef(0)
  async function run(table, f, lim) {
    if (!table) return
    const seq = ++runSeq.current
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
      if (seq !== runSeq.current) return
      setRows(Array.isArray(data) ? data : [])
      setRan(true)
    } catch (e) {
      if (seq !== runSeq.current) return
      setError(toUserMessage(e, 'Could not load rows. Please try again.'))
      setRows([])
    } finally {
      if (seq === runSeq.current) setRunning(false)
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
        let cols
        try {
          cols = await listColumns(nextTable)
        } catch (colErr) {
          // A failed column read is a data-access error, not an assistant outage.
          setError(toUserMessage(colErr, 'Could not open that table.'))
          return
        }
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
      // Same text the input shows. String() on a json value gave "[object Object]",
      // so an untouched-then-restored json field was sent as a change.
      const before = original == null ? '' : cellText(original)
      if (String(v) !== before) patch[k] = v
    }
    return patch
  }

  async function saveEdit() {
    if (busy) return
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
      setError(toUserMessage(err, 'Could not save that change.'))
    } finally {
      setBusy(false)
    }
  }

  async function doDelete() {
    if (busy || !confirmDelete?.id) return
    setBusy(true); setError(null)
    try {
      await deleteRow(selected, confirmDelete.id)
      setNotice('Row deleted. It is kept in full and can be brought back below.')
      setConfirmDelete(null)
      await Promise.all([run(selected, filter, limit), refreshChanges()])
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete that row.'))
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
      setError(toUserMessage(err, 'Could not undo that change.'))
    } finally {
      setBusy(false)
    }
  }

  const filterSummary = describeFilter({ table: selected, ...filter }, { columns: columnLabels })
  const canExport = rows.length > 0 && !running
  // Editing needs a row id to target; a projection without one stays read-only.
  const canEditRows = rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0] || {}, 'id')
  const patchCount = editRow ? Object.keys(draftPatch()).length : 0

  const [tableSearch, setTableSearch] = useState('')
  const visibleTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase()
    return q ? tables.filter((t) => String(t.table_name).toLowerCase().includes(q)) : tables
  }, [tables, tableSearch])

  // Row count per safelisted table, from the server's own count. Largest first.
  const tableBars = useMemo(() => tables
    .map((t) => ({ label: t.table_name, value: Number(t.row_count) || 0 }))
    .sort((a, b) => b.value - a.value), [tables])
  const totalRows = tableBars.reduce((a, b) => a + b.value, 0)
  const openChanges = changes.filter((c) => !c.reverted_at).length

  const columnOptions = columns.map((c) => ({ value: c.column_name, label: c.column_name }))
  const opOptions = QUERY_OPERATORS.map((o) => ({ value: o.key, label: operatorLabel(o.key) }))

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><Database size={18} className="text-orange-400" /> Data Browser</h1>
          <p className="text-xs text-gray-500 mt-1">
            {admin?.full_name ? `${admin.full_name} | ` : ''}Browse, filter and export operational data with no SQL, and correct or remove a single row.
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={loadTables} busy={tablesLoading}>Refresh tables</Btn>
      </header>

      <Note icon={Info} tone="accent">
        Browse, filter and export any of these tables, and correct or remove a single row.
        Every edit and delete keeps the original and can be undone below. The row id, the owning
        company and any value the database calculates itself cannot be changed here.
      </Note>

      {notice && <Note icon={CheckCircle2} tone="accent"><span role="status">{notice}</span></Note>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Tables available" value={tablesLoading && !tables.length ? 'N/A' : fmtNum(tables.length)} icon={Table2} />
        <StatTile label="Rows across tables" value={tablesLoading && !tables.length ? 'N/A' : fmtNum(totalRows)} icon={Database}
          sub="Server count per table" />
        <StatTile label="Showing" value={ran ? fmtNum(rows.length) : 'N/A'}
          sub={ran && rows.length === limit ? `Capped at ${limit} rows` : selected || 'No table selected'} />
        <StatTile label="Changes undoable" value={fmtNum(openChanges)} icon={Undo2}
          tone={openChanges ? 'accent' : 'default'} sub={`${fmtNum(changes.length)} recent change(s)`} />
      </div>

      {changes.length > 0 && (
        <Panel flush>
          <div className="px-4 pt-4"><PanelHeader icon={Undo2} title="Recent changes" subtitle="Every one can be undone." /></div>
          <div className="max-h-56 overflow-y-auto px-4 pb-4">
            <Table>
              <THead><Th>When</Th><Th>Change</Th><Th align="right">Action</Th></THead>
              <tbody>
                {changes.map((c) => (
                  <Tr key={c.id}>
                    <Td nowrap><span className="text-gray-500">{fmtStamp(c.created_at)}</span></Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <Badge tone={c.action === 'delete' ? 'danger' : 'info'}>{c.action === 'delete' ? 'Deleted' : 'Edited'}</Badge>
                        <Code>{c.tbl}</Code>
                      </span>
                    </Td>
                    <Td align="right">
                      {c.reverted_at
                        ? <Badge tone="good" icon={CheckCircle2}>Undone</Badge>
                        : <Btn size="xs" icon={Undo2} onClick={() => doRevert(c.id)} disabled={busy}>Undo</Btn>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader icon={Sparkles} title="Ask your data"
          subtitle="The assistant reads your question into a filter. Your data is never sent for computation. It only picks a column, an operator and a value, then the query runs on the server." />
        <form onSubmit={handleAsk} className="flex flex-col sm:flex-row gap-2">
          <SearchInput value={question} onChange={setQuestion} className="flex-1"
            placeholder="e.g. tyres at the NHC site, or accidents where severity equals major" />
          <Btn type="submit" variant="primary" icon={Sparkles} busy={asking}
            disabled={!question.trim() || !tableNames.length}>{asking ? 'Reading' : 'Ask'}</Btn>
        </form>
        {askNote && (
          <p className="mt-2 text-[11px] text-emerald-300 flex items-center gap-1.5"><Filter size={12} /> {askNote}</p>
        )}
        {askError && (
          <div className="mt-2"><Note icon={AlertTriangle} tone="warning">{askError}</Note></div>
        )}
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Panel className="lg:col-span-1">
          <PanelHeader icon={Table2} title="Tables" />
          <SearchInput value={tableSearch} onChange={setTableSearch} placeholder="Find a table" className="mb-2" />
          {tablesLoading && !tables.length
            ? <LoadingState label="Loading tables" rows={3} />
            : tables.length === 0
              ? <EmptyState icon={Table2} title="No tables available."
                  reason="The safelist returned nothing, or it could not be read. Try Refresh tables." />
              : visibleTables.length === 0
                ? <EmptyState title="No table matches." reason="Clear the search to see every table." />
                : (
                  <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
                    {visibleTables.map((t) => {
                      const on = selected === t.table_name
                      return (
                        <button key={t.table_name} onClick={() => selectTable(t.table_name)}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors border ${
                            on ? 'bg-orange-500/15 border-orange-600/50' : 'border-transparent hover:bg-gray-800/60'}`}>
                          <span className={`text-xs font-medium truncate ${on ? 'text-orange-200' : 'text-gray-300'}`}>{t.table_name}</span>
                          <span className="text-[10px] text-gray-500 tabular-nums flex-shrink-0">{fmtNum(t.row_count)}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
        </Panel>

        <div className="lg:col-span-3 space-y-4">
          <Panel>
            <PanelHeader icon={Filter} title={selected ? `Filter on ${selected}` : 'Filter'} />
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <Select className="sm:col-span-4" value={filter.column} placeholder="All columns (no filter)"
                options={columnOptions} onChange={(v) => setFilter((f) => ({ ...f, column: v }))} />
              <Select className="sm:col-span-3" value={filter.op} options={opOptions}
                onChange={(v) => setFilter((f) => ({ ...f, op: v }))} />
              <input
                value={filter.value}
                onChange={(e) => setFilter((f) => ({ ...f, value: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRun() }}
                placeholder="Value" aria-label="Filter value"
                title="The value to compare against. Leave blank with All columns to see every row."
                className="sm:col-span-3 px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none"
              />
              <div className="sm:col-span-2">
                <Btn variant="primary" icon={Play} onClick={handleRun} busy={running} disabled={!selected}>Run</Btn>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
              <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <Info size={12} /> {filterSummary}
                {filter.column && (
                  <Btn size="xs" variant="quiet" icon={X}
                    onClick={() => { const nf = EMPTY_FILTER; setFilter(nf); run(selected, nf, limit) }}
                    title="Clear the filter and show all rows.">Clear</Btn>
                )}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500">Rows</span>
                <Segmented value={limit} onChange={handleLimit}
                  options={LIMIT_OPTIONS.map((n) => ({ key: n, label: String(n), hint: `Show up to ${n} rows.` }))} />
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Results"
              subtitle={ran && !running
                ? `${rows.length} row${rows.length === 1 ? '' : 's'}${rows.length === limit ? `, showing first ${limit}` : ''}`
                : undefined}
              actions={(
                <Btn icon={Download} onClick={handleExport} disabled={!canExport}
                  title={canExport ? 'Download these rows as an Excel workbook.' : 'Run a query with results to export.'}>
                  Export Excel
                </Btn>
              )} />

            {running
              ? <LoadingState label="Loading rows" />
              : error
                ? <ErrorState message={error} onRetry={selected ? handleRun : undefined} />
                : rows.length === 0
                  ? <EmptyState title={ran ? 'No rows match' : 'Nothing run yet'}
                      reason={ran ? 'The query ran and returned no rows. Loosen or clear the filter.' : 'Pick a table to preview its rows.'} />
                  : (
                    <div className="max-h-[540px] overflow-auto">
                      <Table>
                        <THead>
                          {canEditRows && <Th className="w-20">Actions</Th>}
                          {rowKeys.map((k) => <Th key={k} className="whitespace-nowrap">{k}</Th>)}
                        </THead>
                        <tbody>
                          {rows.map((r, i) => (
                            <Tr key={r.id || i}>
                              {canEditRows && (
                                <Td nowrap>
                                  <span className="flex items-center gap-1">
                                    <button onClick={() => openEdit(r)} disabled={busy} aria-label="Edit row"
                                      title="Correct a value in this row"
                                      className="p-1 rounded text-gray-400 hover:text-orange-300 hover:bg-gray-800 disabled:opacity-40">
                                      <Pencil size={12} />
                                    </button>
                                    <button onClick={() => { setConfirmDelete(r); setNotice('') }} disabled={busy} aria-label="Delete row"
                                      title="Delete this row (can be undone)"
                                      className="p-1 rounded text-gray-400 hover:text-red-300 hover:bg-gray-800 disabled:opacity-40">
                                      <Trash2 size={12} />
                                    </button>
                                  </span>
                                </Td>
                              )}
                              {rowKeys.map((k) => (
                                <Td key={k} nowrap className="max-w-[280px] truncate">
                                  <span className="text-gray-300" title={cellText(r[k])}>{cellText(r[k])}</span>
                                </Td>
                              ))}
                            </Tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
          </Panel>
        </div>
      </div>

      {tableBars.length > 0 && (
        <Panel>
          <PanelHeader icon={BarChart3} title="Rows per table"
            subtitle="The server's own count for every safelisted table. Helps you see where the data actually lives before you filter." />
          <BarsChart bars={tableBars} valueFormat={(v) => `${fmtNum(v)} rows`}
            summary={tableBars.map((b) => `${b.label}: ${b.value}`).join(', ')} emptyText="Every safelisted table is empty." />
        </Panel>
      )}

      <Modal open={!!editRow} onClose={() => { if (!busy) setEditRow(null) }} width="max-w-2xl"
        title={`Edit row in ${selected}`}
        subtitle="Change only what you need. Blank means the value is cleared. Locked fields are the row id, the owning company and values the database calculates itself."
        footer={(
          <>
            <span className="mr-auto self-center text-[11px] text-gray-500">
              {patchCount ? `${patchCount} field(s) changed` : 'Nothing changed yet'}
            </span>
            <Btn onClick={() => setEditRow(null)} disabled={busy}>Cancel</Btn>
            <Btn variant="primary" icon={Pencil} onClick={saveEdit} busy={busy} disabled={!patchCount}>Save</Btn>
          </>
        )}>
        {editRow && (
          <div className="space-y-2.5">
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
                    aria-label={k}
                    onChange={(e) => setEditDraft((d) => ({ ...d, [k]: e.target.value }))}
                    className={`col-span-2 px-2.5 py-1.5 rounded-lg text-xs bg-gray-900 border text-gray-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                      dirty ? 'border-orange-500' : 'border-gray-800 focus:border-gray-700'
                    }`}
                  />
                </div>
              )
            })}
            <ErrorState message={error} />
          </div>
        )}
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => { if (!busy) setConfirmDelete(null) }} width="max-w-md"
        title="Delete this row"
        subtitle={`This removes one row from ${selected}. The complete row is kept, so you can bring it back from Recent changes straight afterwards.`}
        footer={(
          <>
            <Btn onClick={() => setConfirmDelete(null)} disabled={busy}>Cancel</Btn>
            <Btn variant="danger" icon={Trash2} onClick={doDelete} busy={busy}>Delete</Btn>
          </>
        )}>
        {confirmDelete && (
          <div className="space-y-3">
            <div className="rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 max-h-40 overflow-y-auto">
              {rowKeys.slice(0, 6).map((k) => (
                <p key={k} className="text-[11px] text-gray-500 truncate">
                  <span className="text-gray-400">{k}:</span> {cellText(confirmDelete[k]) || 'N/A'}
                </p>
              ))}
            </div>
            <ErrorState message={error} />
          </div>
        )}
      </Modal>
    </div>
  )
}

function fmtNum(n) { return n != null && Number.isFinite(Number(n)) ? Number(n).toLocaleString() : 'N/A' }

function fmtStamp(v) {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 16).replace('T', ' ')
}

function cellText(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}
