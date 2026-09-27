import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronLeft, ChevronRight, Clock, FileSpreadsheet, FileText, Gavel,
  RotateCcw, Search, Send, Wallet, X,
} from 'lucide-react'
import { loadDriverFineRegister, runDriverFineReminders } from '../../lib/api/driverWorkspace'
import { exportDriverFineRegisterExcel, exportDriverFineRegisterPdf } from '../../lib/driverFineReports'
import { toUserMessage } from '../../lib/safeError'
import EnterpriseTable from '../ui/EnterpriseTable'
import {
  FINE_PAGE_SIZE, splitFinePage, summarizeFinePage, formatBalances, activeFineFilterCount, humanFineValue as human,
} from '../../lib/driverFineRegisterAnalytics'

const PAGE_SIZE = FINE_PAGE_SIZE
const EMPTY_FILTERS = { search: '', status: '', review_stage: '', overdue: false }

function Tile({ icon: Icon, label, value, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={13} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
      </div>
      <p className={`text-base font-bold tabular-nums truncate ${tone}`} title={String(value)}>{value}</p>
    </div>
  )
}

/**
 * Traffic fine register. Paged server-side (the RPC returns one look-ahead row
 * to say whether another page exists), so the summary tiles describe the page
 * on screen and say so, while the exports walk every page of the filtered set.
 */
export default function DriverFineRegister({ canRunReminders, onOpenDriver }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [applied, setApplied] = useState(filters)
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [reminding, setReminding] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async (isActive = () => true) => {
    setLoading(true); setLoadError('')
    try {
      const result = await loadDriverFineRegister(applied, offset)
      if (isActive()) setRows(result?.rows || [])
    } catch (error) {
      // A failed read is an error state, never an empty register.
      if (isActive()) { setRows([]); setLoadError(toUserMessage(error, 'The fine register could not be loaded.')) }
    } finally { if (isActive()) setLoading(false) }
  }, [applied, offset])
  useEffect(() => { let active = true; load(() => active); return () => { active = false } }, [load])

  const { visible: visibleRows, hasNext } = useMemo(() => splitFinePage(rows, PAGE_SIZE), [rows])
  const summary = useMemo(() => summarizeFinePage(visibleRows), [visibleRows])
  const filterCount = activeFineFilterCount(applied)

  async function exportRows(format) {
    setMessage(''); setExporting(true)
    try {
      const allRows = []
      for (let pageOffset = 0; pageOffset < 10000; pageOffset += PAGE_SIZE) {
        const page = await loadDriverFineRegister(applied, pageOffset); const pageRows = page?.rows || []
        allRows.push(...pageRows.slice(0, PAGE_SIZE))
        if (pageRows.length <= PAGE_SIZE) break
        if (pageOffset === 9900) throw new Error('The report exceeds 10,000 rows. Narrow the filters and export again.')
      }
      await (format === 'excel' ? exportDriverFineRegisterExcel(allRows) : exportDriverFineRegisterPdf(allRows))
    } catch (error) { setMessage(toUserMessage(error, 'The report could not be generated.')) }
    finally { setExporting(false) }
  }
  async function reminders() {
    setMessage(''); setReminding(true)
    try { const result = await runDriverFineReminders(); await load(); setMessage(`Reminder run complete: ${result.sent || 0} sent, ${result.skipped || 0} skipped.`) }
    catch (error) { setMessage(toUserMessage(error, 'The reminder run could not be completed.')) }
    finally { setReminding(false) }
  }
  function clearFilters() { setFilters(EMPTY_FILTERS); setOffset(0); setApplied(EMPTY_FILTERS) }

  const columns = useMemo(() => [
    { id: 'notice', header: 'Notice', accessorFn: (r) => r.notice_reference || '', size: 170,
      cell: ({ row }) => (
        <div className="min-w-0">
          <strong className="text-[var(--text-primary)]">{row.original.notice_reference}</strong>
          <p className="text-xs text-[var(--text-muted)]">{row.original.authority || 'Authority not recorded'}</p>
        </div>
      ) },
    { id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || '', size: 170,
      cell: ({ row }) => (
        <div className="min-w-0">
          <span className="text-[var(--text-primary)]">{row.original.driver_name || 'Not recorded'}</span>
          <p className="text-xs text-[var(--text-muted)]">{row.original.employee_id || 'No employee ID'}</p>
        </div>
      ) },
    { id: 'vehicle', header: 'Vehicle', accessorFn: (r) => r.asset_no || 'Not assigned', size: 110 },
    { id: 'amount', header: 'Amount / balance', accessorFn: (r) => Number(r.balance) || 0, size: 150,
      meta: { align: 'right', exportValue: (r) => `${r.currency || ''} ${r.amount ?? ''} (balance ${r.balance ?? ''})` },
      cell: ({ row }) => (
        <div className="tabular-nums">
          <span className="text-[var(--text-primary)]">{row.original.currency} {row.original.amount}</span>
          <p className="text-xs text-[var(--text-muted)]">Balance {row.original.balance ?? 'not recorded'}</p>
        </div>
      ) },
    { id: 'status', header: 'Status', accessorFn: (r) => `${human(r.status)} ${human(r.review_stage)}`, size: 150,
      cell: ({ row }) => (
        <div>
          <span className="capitalize text-[var(--text-primary)]">{human(row.original.status)}</span>
          <p className="text-xs text-[var(--text-muted)] capitalize">{human(row.original.review_stage)}</p>
        </div>
      ) },
    { id: 'due', header: 'Due', accessorFn: (r) => r.due_date || '', size: 130,
      cell: ({ row }) => (
        <div>
          <span className="text-[var(--text-secondary)]">{row.original.due_date || 'Not supplied'}</span>
          {row.original.overdue && (
            <strong className="flex items-center gap-1 text-red-500 text-xs"><AlertTriangle size={11} aria-hidden="true" /> Overdue</strong>
          )}
        </div>
      ) },
    { id: 'action', header: 'Action', enableSorting: false, size: 120, meta: { export: false },
      cell: ({ row }) => (
        <button type="button" className="btn-secondary text-xs min-h-[36px]" onClick={() => onOpenDriver(row.original.driver_id)}>Open case</button>
      ) },
  ], [onOpenDriver])

  const pageFrom = visibleRows.length ? offset + 1 : 0
  const pageTo = offset + visibleRows.length

  return <section className="space-y-3 rounded-xl border border-[var(--input-border)] p-4" aria-labelledby="fine-register-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 id="fine-register-title" className="text-lg font-bold">Traffic fine register</h2>
        <p className="text-sm text-[var(--text-muted)]">Driver, supervisor and finance workflow across all accessible cases.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary inline-flex items-center gap-1.5" disabled={!visibleRows.length || exporting} onClick={() => exportRows('excel')}><FileSpreadsheet size={14} aria-hidden="true" />Export Excel</button>
        <button className="btn-secondary inline-flex items-center gap-1.5" disabled={!visibleRows.length || exporting} onClick={() => exportRows('pdf')}><FileText size={14} aria-hidden="true" />Export PDF</button>
        {canRunReminders && <button className="btn-secondary inline-flex items-center gap-1.5" disabled={reminding} onClick={reminders}><Send size={14} aria-hidden="true" />Run due reminders</button>}
      </div>
    </div>

    <form className="grid gap-2 md:grid-cols-6" onSubmit={event => { event.preventDefault(); setOffset(0); setApplied(filters) }}>
      <div className="relative md:col-span-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
        <input className="input w-full pl-9" aria-label="Search fine register" placeholder="Driver, ID, notice, vehicle, authority or site" value={filters.search} onChange={event => setFilters(value => ({ ...value, search: event.target.value }))} />
      </div>
      <select className="input" aria-label="Case status" value={filters.status} onChange={event => setFilters(value => ({ ...value, status: event.target.value }))}><option value="">All case statuses</option><option value="open">Open</option><option value="settled">Settled</option><option value="cancelled">Cancelled</option></select>
      <select className="input" aria-label="Review stage" value={filters.review_stage} onChange={event => setFilters(value => ({ ...value, review_stage: event.target.value }))}><option value="">All review stages</option><option value="driver">Driver action</option><option value="supervisor">Supervisor review</option><option value="finance">Finance approval</option><option value="complete">Complete / payment</option></select>
      <label className="flex items-center gap-2 text-sm min-h-[40px]"><input type="checkbox" checked={filters.overdue} onChange={event => setFilters(value => ({ ...value, overdue: event.target.checked }))} />Overdue only</label>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" type="submit">Apply filters</button>
        {filterCount > 0 && <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={clearFilters}><X size={13} aria-hidden="true" />Clear</button>}
      </div>
    </form>

    {!loading && !loadError && visibleRows.length > 0 && (
      <div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2" aria-label="Fine register summary for this page">
          <Tile icon={Gavel} label="Fines on this page" value={summary.rows} />
          <Tile icon={Clock} label="Open" value={summary.open} />
          <Tile icon={AlertTriangle} label="Overdue" value={summary.overdue} tone={summary.overdue ? 'text-red-500' : 'text-[var(--text-primary)]'} />
          <Tile icon={Clock} label="Awaiting supervisor" value={summary.byStage.supervisor} />
          <Tile icon={Clock} label="Awaiting finance" value={summary.byStage.finance} />
          <Tile icon={Wallet} label="Balance on this page" value={formatBalances(summary.balances)} />
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-1">
          These figures cover rows {pageFrom} to {pageTo}{hasNext ? ' of a larger filtered set' : ''}{filterCount ? ` with ${filterCount} filter${filterCount === 1 ? '' : 's'} applied` : ''}. Balances are shown per currency and never added across currencies{summary.unpricedBalances ? `; ${summary.unpricedBalances} fine${summary.unpricedBalances === 1 ? ' has' : 's have'} no recorded balance` : ''}.
        </p>
      </div>
    )}

    {loadError && (
      <div className="flex items-start gap-2 rounded-lg border border-red-700/50 px-3 py-2" role="alert">
        <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
        <p className="text-sm flex-1">{loadError}</p>
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => load()}><RotateCcw size={12} aria-hidden="true" />Retry</button>
      </div>
    )}
    {message && <p role="status" className="text-sm">{message}</p>}

    {!loadError && (
      <EnterpriseTable
        columns={columns}
        data={visibleRows}
        getRowId={(r) => String(r.id)}
        loading={loading}
        skeletonRows={5}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        emptyMessage={filterCount ? 'No fines match these filters.' : 'No traffic fines recorded yet.'}
        manualPagination
        pageIndex={0}
        pageCount={1}
        totalRows={visibleRows.length}
        paginationLabel={() => `Rows ${pageFrom} to ${pageTo}${hasNext ? ' (more on the next page)' : ''}`}
      />
    )}

    {(offset > 0 || hasNext) && (
      <nav className="flex items-center gap-2" aria-label="Fine register pages">
        {offset > 0 && <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}><ChevronLeft size={14} aria-hidden="true" />Previous</button>}
        {hasNext && <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => setOffset(value => value + PAGE_SIZE)}>Next<ChevronRight size={14} aria-hidden="true" /></button>}
      </nav>
    )}
  </section>
}
