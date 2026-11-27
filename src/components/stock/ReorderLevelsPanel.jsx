import { useMemo, useState } from 'react'
import { Check, Info, Loader2 } from 'lucide-react'
import EnterpriseTable from '../ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../ui/TablePagination'
import Modal from '../ui/Modal'
import { stock } from '../../lib/api'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import { usageFor, registerItemCode, USAGE_MONTHS } from '../../lib/stockRegisterDetail'
import {
  buildReorderSuggestions, summarizeSuggestions, levelPatch, DEFAULT_LEAD_DAYS,
} from '../../lib/inventory/reorderLevels'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'
const APPLY_CONCURRENCY = 4

const fmt = (v, na = 'N/A') => (v === null || v === undefined ? na : String(v))

function Pair({ now, next }) {
  const { t } = useLanguage()
  const na = t('wmsissue.common.na')
  const same = now === next
  return (
    <span className="tabular-nums whitespace-nowrap">
      <span className="text-[var(--text-muted)]">{fmt(now, na)}</span>
      <span className="text-[var(--text-dim)] inline-block mx-1 rtl-flip" aria-hidden="true">→</span>
      <span className="sr-only"> {t('wmsissue.reorder.toNew')} </span>
      <span className={same ? 'text-[var(--text-muted)]' : 'font-semibold text-[var(--text-primary)]'}>{fmt(next, na)}</span>
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
  const { t } = useLanguage()
  const na = t('wmsissue.common.na')
  const [site, setSite] = useState('all')
  const [onlyDiffer, setOnlyDiffer] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)

  const items = useMemo(
    () => (usageIdx ? buildReorderSuggestions(records, r => usageFor(r, usageIdx), { t }) : []),
    [records, usageIdx, t],
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
          failed.push({ id: it.row.id, label: t('wmsissue.reorder.itemAtSite', { item: registerItemCode(it.row) || it.row.description || t('wmsissue.cols.item'), site: it.row.site || t('wmsissue.reorder.unknownSite') }), message: toUserMessage(err, t('wmsissue.reorder.saveError')) })
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
        <input type="checkbox" aria-label={t('wmsissue.reorder.selectAll')} checked={allSelected}
          disabled={!canApply || selectable.length === 0} onChange={toggleAll} className={FOCUS} />
      ),
      cell: ({ row }) => {
        const it = row.original
        return (
          <input type="checkbox" aria-label={t('wmsissue.reorder.selectRow', { item: registerItemCode(it.row) || t('wmsissue.reorder.row'), site: it.row.site || '' })}
            checked={selected.has(it.row.id)} disabled={!canApply || !it.s.differs}
            onChange={() => toggle(it.row.id)} className={FOCUS} />
        )
      } },
    { id: 'item', header: t('wmsissue.cols.item'), size: 260,
      cell: ({ row }) => {
        const r = row.original.row
        return (
          <div className="min-w-0">
            <div className="font-mono text-xs text-[var(--text-muted)]" dir="ltr">{registerItemCode(r) || na}</div>
            <div className="truncate text-[var(--text-primary)]" title={r.item?.item_name || r.description || ''}>{r.item?.item_name || r.description || na}</div>
          </div>
        )
      } },
    { id: 'site', header: t('wmsissue.filters.site'), size: 120, cell: ({ row }) => row.original.row.site || na },
    { id: 'qty', header: t('wmsissue.reorder.onHand'), size: 80, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.row.stock_qty, na)}</span> },
    { id: 'rate', header: t('wmsissue.reorder.usedPerMonth'), size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmt(row.original.s.avgPerMonth, na)}</span> },
    { id: 'critical', header: t('wmsissue.reorder.critical'), size: 100, cell: ({ row }) => <Pair now={row.original.s.current.critical} next={row.original.s.critical} /> },
    { id: 'min', header: t('wmsissue.reorder.min'), size: 100, cell: ({ row }) => <Pair now={row.original.s.current.min} next={row.original.s.min} /> },
    { id: 'reorder', header: t('wmsissue.reorder.reorderQty'), size: 110, cell: ({ row }) => <Pair now={row.original.s.current.reorderQty} next={row.original.s.reorderQty} /> },
    { id: 'why', header: t('wmsissue.reorder.basis'), size: 320,
      cell: ({ row }) => <span className="text-xs text-[var(--text-secondary)] whitespace-normal">{row.original.s.explanation}</span> },
  // toggle / toggleAll read current state; recomputed when that state changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [selected, allSelected, canApply, selectable, t, na])

  if (detailState === 'loading' && !usageIdx) {
    return (
      <div className="card p-6 flex items-center gap-2 text-sm text-[var(--text-muted)]" role="status">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t('wmsissue.reorder.reading', { months: USAGE_MONTHS })}
      </div>
    )
  }
  if (!usageIdx) {
    return (
      <div className="card p-6 text-sm text-[var(--text-secondary)]" role="alert">
        {t('wmsissue.reorder.historyError')}
      </div>
    )
  }

  return (
    <section className="space-y-3" aria-label={t('wmsissue.reorder.title')}>
      <div className="card p-4 space-y-2">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('wmsissue.reorder.title')}</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          {t('wmsissue.reorder.explain', { months: USAGE_MONTHS, days: DEFAULT_LEAD_DAYS })}
        </p>
        <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t('wmsissue.reorder.coverage', {
              suggested: summary.suggested, total: summary.total, differs: summary.differs,
              countryOnly: summary.countryOnly, noUsage: summary.noUsage, noCode: summary.noCode,
            })}
          </span>
        </p>
        {!canApply && (
          <p className="text-xs text-amber-500">{t('wmsissue.reorder.noPermission')}</p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          {t('wmsissue.filters.search')}
          <input type="search" className="input min-h-[44px] w-56" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('wmsissue.reorder.searchPlaceholder')} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          {t('wmsissue.filters.site')}
          <select className="input min-h-[44px]" value={site} onChange={e => setSite(e.target.value)}>
            <option value="all">{t('wmsissue.filters.allSites')}</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 min-h-[44px] text-sm text-[var(--text-secondary)]">
          <input type="checkbox" checked={onlyDiffer} onChange={e => setOnlyDiffer(e.target.checked)} className={FOCUS} />
          {t('wmsissue.reorder.onlyDiffer')}
        </label>
        <div className="ms-auto flex items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">{t('wmsissue.reorder.selected', { count: selectedItems.length })}</span>
          <button type="button" disabled={!canApply || selectedItems.length === 0 || applying}
            onClick={() => { setResult(null); setConfirmOpen(true) }}
            className={`btn-primary min-h-[44px] px-4 inline-flex items-center gap-2 disabled:opacity-50 ${FOCUS}`}>
            <Check size={16} aria-hidden="true" /> {t('wmsissue.reorder.apply')}
          </button>
        </div>
      </div>

      {result && (
        <div className="card p-3 text-sm" role="status">
          <p className="text-[var(--text-primary)]">{t('wmsissue.reorder.updated', { count: result.ok })}{result.failed.length ? ` ${t('wmsissue.reorder.failed', { count: result.failed.length })}` : ''}</p>
          {result.failed.length > 0 && (
            <ul className="mt-1 list-disc ps-5 text-red-500 text-xs space-y-0.5">
              {result.failed.slice(0, 20).map(f => <li key={f.id}>{f.label}: {f.message}</li>)}
              {result.failed.length > 20 && <li>{t('wmsissue.reorder.andMore', { count: result.failed.length - 20 })}</li>}
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
          ? t('wmsissue.reorder.emptyNoUsage')
          : t('wmsissue.reorder.noMatch')}
      />
      <TablePagination {...pager} />

      <Modal open={confirmOpen} onClose={() => { if (!applying) setConfirmOpen(false) }} title={t('wmsissue.reorder.confirmTitle')} size="sm">
        <div className="space-y-3 text-sm text-[var(--text-secondary)]">
          <p>{t('wmsissue.reorder.confirmBody', { count: selectedItems.length })}</p>
          {applying && <p role="status" className="tabular-nums">{t('wmsissue.reorder.saving', { done: progress, total: selectedItems.length })}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={`btn-secondary min-h-[44px] px-4 ${FOCUS}`} disabled={applying} onClick={() => setConfirmOpen(false)}>{t('wmsissue.common.cancel')}</button>
            <button type="button" className={`btn-primary min-h-[44px] px-4 inline-flex items-center gap-2 ${FOCUS}`} disabled={applying} onClick={applySelected}>
              {applying && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} {t('wmsissue.reorder.applyTo', { count: selectedItems.length })}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
