import { useMemo, useState } from 'react'
import { Check, Info, Loader2 } from 'lucide-react'
import EnterpriseTable from '../ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../ui/TablePagination'
import Modal from '../ui/Modal'
import { stock } from '../../lib/api'
import { toUserMessage } from '../../lib/safeError'
import { usageFor, registerItemCode, USAGE_MONTHS } from '../../lib/stockRegisterDetail'
import {
  buildReorderSuggestions, summarizeSuggestions, levelPatch, DEFAULT_LEAD_DAYS,
} from '../../lib/inventory/reorderLevels'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'
const APPLY_CONCURRENCY = 4

const fmt = (v) => (v === null || v === undefined ? 'N/A' : String(v))

function Pair({ now, next }) {
  const same = now === next
  return (
    <span className="tabular-nums whitespace-nowrap">
      <span className="text-[var(--text-muted)]">{fmt(now)}</span>
      <span className="text-[var(--text-dim)]" aria-hidden="true"> → </span>
      <span className={same ? 'text-[var(--text-muted)]' : 'font-semibold text-[var(--text-primary)]'}>{fmt(next)}</span>
    </span>
  )
}

/**
 * Suggested reorder levels from the last 12 months of ERP issues at each site.
 * Applying writes min / critical level and reorder qty through the SAME service
 * call the register's Edit form uses (stock.updateStockRecord). Nothing is written
 * until a person selects rows and confirms.
 */
export default function ReorderLevelsPanel({ records = [], usageIdx = null, detailState = 'loading', canApply = false, userId = null, onApplied }) {
  const [site, setSite] = useState('all')
  const [onlyDiffer, setOnlyDiffer] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)

  const items = useMemo(
    () => (usageIdx ? buildReorderSuggestions(records, r => usageFor(r, usageIdx)) : []),
    [records, usageIdx],
  )
  const summary = useMemo(() => summarizeSuggestions(items), [items])
  const sites = useMemo(
    () => [...new Set(items.filter(i => i.s.ok).map(i => i.row.site).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [items],
  )
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter(i => i.s.ok)
      .filter(i => (site === 'all' ? true : i.row.site === site))
      .filter(i => (onlyDiffer ? i.s.differs : true))
      .filter(i => {
        if (!q) return true
        const hay = `${registerItemCode(i.row) || ''} ${i.row.description || ''} ${i.row.item?.item_name || ''} ${i.row.site || ''}`.toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) => (b.s.avgPerMonth || 0) - (a.s.avgPerMonth || 0))
  }, [items, site, onlyDiffer, search])

  const pager = usePagedRows(rows, { pageSize: 25 })
  const byId = useMemo(() => new Map(items.map(i => [i.row.id, i])), [items])
  const selectable = useMemo(() => rows.filter(i => i.s.differs), [rows])
  const selectedItems = useMemo(() => [...selected].map(id => byId.get(id)).filter(i => i?.s.ok && i.s.differs), [selected, byId])
  const allSelected = selectable.length > 0 && selectable.every(i => selected.has(i.row.id))

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) selectable.forEach(i => next.delete(i.row.id))
      else selectable.forEach(i => next.add(i.row.id))
      return next
    })
  }

  async function applySelected() {
    setApplying(true)
    setProgress(0)
    setResult(null)
    const queue = [...selectedItems]
    const ok = []
    const failed = []
    let done = 0
    const stamp = new Date().toISOString()
    async function worker() {
      while (queue.length) {
        const it = queue.shift()
        const patch = levelPatch(it.s)
        try {
          await stock.updateStockRecord(it.row.id, { ...patch, updated_by: userId, updated_at: stamp })
          ok.push(it.row.id)
        } catch (err) {
          failed.push({ id: it.row.id, label: `${registerItemCode(it.row) || it.row.description || 'Item'} at ${it.row.site || 'unknown site'}`, message: toUserMessage(err, 'Could not save the levels.') })
        }
        done += 1
        setProgress(done)
      }
    }
    await Promise.all(Array.from({ length: Math.min(APPLY_CONCURRENCY, queue.length) }, worker))
    setApplying(false)
    setConfirmOpen(false)
    setResult({ ok: ok.length, failed })
    setSelected(prev => {
      const next = new Set(prev)
      ok.forEach(id => next.delete(id))
      return next
    })
    if (ok.length && typeof onApplied === 'function') onApplied()
  }

  const columns = useMemo(() => [
    { id: 'pick', size: 44,
      header: () => (
        <input type="checkbox" aria-label="Select all rows that differ" checked={allSelected}
          disabled={!canApply || selectable.length === 0} onChange={toggleAll} className={FOCUS} />
      ),
      cell: ({ row }) => {
        const it = row.original
        return (
          <input type="checkbox" aria-label={`Select ${registerItemCode(it.row) || 'row'} at ${it.row.site || ''}`}
            checked={selected.has(it.row.id)} disabled={!canApply || !it.s.differs}
            onChange={() => toggle(it.row.id)} className={FOCUS} />
        )
      } },
    { id: 'item', header: 'Item', size: 260,
      cell: ({ row }) => {
        const r = row.original.row
        return (
          <div className="min-w-0">
            <div className="font-mono text-xs text-[var(--text-muted)]">{registerItemCode(r) || 'N/A'}</div>
            <div className="truncate text-[var(--text-primary)]" title={r.item?.item_name || r.description || ''}>{r.item?.item_name || r.description || 'N/A'}</div>
          </div>
        )
      } },
    { id: 'site', header: 'Site', size: 120, cell: ({ row }) => row.original.row.site || 'N/A' },
    { id: 'qty', header: 'On hand', size: 80, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.row.stock_qty)}</span> },
    { id: 'rate', header: 'Used / month', size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.s.avgPerMonth)}</span> },
    { id: 'critical', header: 'Critical', size: 100, cell: ({ row }) => <Pair now={row.original.s.current.critical} next={row.original.s.critical} /> },
    { id: 'min', header: 'Min', size: 100, cell: ({ row }) => <Pair now={row.original.s.current.min} next={row.original.s.min} /> },
    { id: 'reorder', header: 'Reorder qty', size: 110, cell: ({ row }) => <Pair now={row.original.s.current.reorderQty} next={row.original.s.reorderQty} /> },
    { id: 'why', header: 'Basis', size: 320,
      cell: ({ row }) => <span className="text-xs text-[var(--text-secondary)] whitespace-normal">{row.original.s.explanation}</span> },
  // toggle / toggleAll read current state; recomputed when that state changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [selected, allSelected, canApply, selectable])

  if (detailState === 'loading' && !usageIdx) {
    return (
      <div className="card p-6 flex items-center gap-2 text-sm text-[var(--text-muted)]" role="status">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Reading the last {USAGE_MONTHS} months of issues…
      </div>
    )
  }
  if (!usageIdx) {
    return (
      <div className="card p-6 text-sm text-[var(--text-secondary)]" role="alert">
        Issue history could not be read for this scope, so no levels can be suggested. Pick one country and reload the page.
      </div>
    )
  }

  return (
    <section className="space-y-3" aria-label="Suggested reorder levels">
      <div className="card p-4 space-y-2">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Suggested reorder levels</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Sized from each site&apos;s ERP issues over the last {USAGE_MONTHS} months. Critical level covers the lead time
          (Material Master lead time when set, otherwise {DEFAULT_LEAD_DAYS} days); min adds half a month of safety stock;
          reorder qty covers two months. Nothing changes until you select rows and apply them.
        </p>
        <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {summary.suggested} of {summary.total} rows have a site rate ({summary.differs} differ from today&apos;s levels).
            {' '}{summary.countryOnly} only have usage at other sites in the country and get no suggestion;
            {' '}{summary.noUsage} had no issues; {summary.noCode} have no item code.
          </span>
        </p>
        {!canApply && (
          <p className="text-xs text-amber-500">You can view suggestions but do not have permission to edit stock levels.</p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Search
          <input type="search" className="input min-h-[44px] w-56" value={search} onChange={e => setSearch(e.target.value)} placeholder="Code, name or site" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Site
          <select className="input min-h-[44px]" value={site} onChange={e => setSite(e.target.value)}>
            <option value="all">All sites</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 min-h-[44px] text-sm text-[var(--text-secondary)]">
          <input type="checkbox" checked={onlyDiffer} onChange={e => setOnlyDiffer(e.target.checked)} className={FOCUS} />
          Only rows that differ
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">{selectedItems.length} selected</span>
          <button type="button" disabled={!canApply || selectedItems.length === 0 || applying}
            onClick={() => { setResult(null); setConfirmOpen(true) }}
            className={`btn-primary min-h-[44px] px-4 inline-flex items-center gap-2 disabled:opacity-50 ${FOCUS}`}>
            <Check size={16} aria-hidden="true" /> Apply
          </button>
        </div>
      </div>

      {result && (
        <div className="card p-3 text-sm" role="status">
          <p className="text-[var(--text-primary)]">{result.ok} row{result.ok === 1 ? '' : 's'} updated.{result.failed.length ? ` ${result.failed.length} failed:` : ''}</p>
          {result.failed.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-red-500 text-xs space-y-0.5">
              {result.failed.slice(0, 20).map(f => <li key={f.id}>{f.label}: {f.message}</li>)}
              {result.failed.length > 20 && <li>and {result.failed.length - 20} more</li>}
            </ul>
          )}
        </div>
      )}

      <EnterpriseTable
        columns={columns}
        data={pager.pageRows}
        getRowId={r => r.row.id}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        emptyMessage={summary.suggested === 0
          ? 'No row has issues at its own site in the last 12 months, so there is nothing to size levels from.'
          : 'No rows match these filters.'}
      />
      <TablePagination {...pager} />

      <Modal open={confirmOpen} onClose={() => { if (!applying) setConfirmOpen(false) }} title="Apply suggested levels" size="sm">
        <div className="space-y-3 text-sm text-[var(--text-secondary)]">
          <p>
            This writes min level, critical level and reorder qty on {selectedItems.length} stock row{selectedItems.length === 1 ? '' : 's'}.
            Stock quantities are not changed. Each row can be edited back from the register.
          </p>
          {applying && <p role="status" className="tabular-nums">Saving {progress} of {selectedItems.length}…</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={`btn-secondary min-h-[44px] px-4 ${FOCUS}`} disabled={applying} onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button type="button" className={`btn-primary min-h-[44px] px-4 inline-flex items-center gap-2 ${FOCUS}`} disabled={applying} onClick={applySelected}>
              {applying && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Apply to {selectedItems.length}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
