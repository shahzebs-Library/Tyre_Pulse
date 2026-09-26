/**
 * dataTrust/kit - the page-structure pieces the Data Trust console pages
 * (Import History, Data Quality, Reconciliation, Correction Center, Lineage,
 * Metric Catalogue, Classification Learning, Data Learning) share so they
 * stay short and read the same way:
 *
 *   PageHeader     title + one-line purpose + primary action + last refreshed
 *   useUrlTab      the active tab lives in ?tab= so a deep link opens it
 *   usePaged/Pager a table shows one page at a time, never an endless wall
 *   Collapsible    a rarely used panel starts closed
 *   AttentionList  "what needs attention", one action each
 *
 * Sorting, search and export come from src/lib/consoleTable.js (the ONE sort
 * helper) and ../shared/ExportButtons.jsx - nothing here re-implements them.
 * Colours stay in the gray-* / orange-* families so the light theme applies.
 */
import { useCallback, useEffect, useMemo, useState, useId } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { RefreshCw, ChevronDown, ChevronLeft, ChevronRight, AlertTriangle, Info, CheckCircle2 } from 'lucide-react'
import { Btn } from '../../components/ui'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

/** "just now" / "4 min ago" / a clock time for anything older than an hour. */
export function refreshedLabel(ts, now = Date.now()) {
  if (!ts) return 'Not loaded yet'
  const t = ts instanceof Date ? ts.getTime() : Date.parse(ts)
  if (!Number.isFinite(t)) return 'Not loaded yet'
  const mins = Math.floor((now - t) / 60000)
  if (mins < 1) return 'Updated just now'
  if (mins < 60) return `Updated ${mins} min ago`
  return `Updated ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function PageHeader({ icon: Icon, title, purpose, actions, refreshedAt, onRefresh, refreshing }) {
  // Re-render once a minute so "4 min ago" does not freeze.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!refreshedAt) return undefined
    const id = setInterval(() => tick((n) => n + 1), 60000)
    return () => clearInterval(id)
  }, [refreshedAt])
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          {Icon && <Icon size={18} className="text-orange-400" aria-hidden="true" />} {title}
        </h1>
        {purpose && <p className="text-xs text-gray-400 mt-1 max-w-3xl">{purpose}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {onRefresh && (
          <span className="inline-flex items-center gap-2">
            <span className="text-[11px] text-gray-500 tabular-nums" aria-live="polite">{refreshedLabel(refreshedAt)}</span>
            <Btn icon={RefreshCw} busy={refreshing} onClick={onRefresh}>Refresh</Btn>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The active tab, read from and written to the URL (?tab= by default) so a
 * deep link or a browser back lands on the same view. An unknown value falls
 * back to the first key rather than rendering nothing.
 */
export function useUrlTab(keys, fallback, param = 'tab') {
  const [params, setParams] = useSearchParams()
  const raw = params.get(param)
  const tab = keys.includes(raw) ? raw : (fallback || keys[0])
  const setTab = useCallback((next) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (!next || next === (fallback || keys[0])) p.delete(param)
      else p.set(param, next)
      return p
    }, { replace: true })
  }, [setParams, param, fallback, keys])
  return [tab, setTab]
}

/**
 * One page of rows at a time. The page resets when the row set shrinks under
 * it (a new filter), so a narrowed list never opens on an empty page 7.
 */
export function usePaged(rows, pageSize = 25) {
  const list = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize))
  const [page, setPage] = useState(0)
  const safe = Math.min(page, pageCount - 1)
  useEffect(() => { if (page !== safe) setPage(safe) }, [page, safe])
  const pageRows = useMemo(() => list.slice(safe * pageSize, safe * pageSize + pageSize), [list, safe, pageSize])
  return { page: safe, setPage, pageRows, pageCount, total: list.length, pageSize }
}

export function Pager({ page, pageCount, total, pageSize, setPage, label = 'rows' }) {
  if (!total || pageCount <= 1) {
    return total ? <p className="text-[11px] text-gray-500 mt-2">{total.toLocaleString()} {label}</p> : null
  }
  const from = page * pageSize + 1
  const to = Math.min(total, from + pageSize - 1)
  return (
    <nav className="flex items-center justify-between gap-2 mt-2 flex-wrap" aria-label={`${label} pages`}>
      <p className="text-[11px] text-gray-500 tabular-nums">
        {from.toLocaleString()} to {to.toLocaleString()} of {total.toLocaleString()} {label}
      </p>
      <div className="flex items-center gap-1">
        <Btn size="xs" icon={ChevronLeft} disabled={page <= 0} onClick={() => setPage(page - 1)}>Previous</Btn>
        <span className="text-[11px] text-gray-500 px-1 tabular-nums">Page {page + 1} of {pageCount}</span>
        <Btn size="xs" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
          Next <ChevronRight size={12} aria-hidden="true" />
        </Btn>
      </div>
    </nav>
  )
}

/** A section that starts closed; the header button says how much is inside. */
export function Collapsible({ icon: Icon, title, subtitle, count, defaultOpen = false, children, actions }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/40">
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={id}
          className={`flex-1 min-w-0 flex items-center gap-2 text-left rounded ${FOCUS}`}>
          <ChevronDown size={14} className={`text-gray-500 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
          {Icon && <Icon size={14} className="text-orange-400 shrink-0" aria-hidden="true" />}
          <span className="min-w-0">
            <span className="text-sm font-semibold text-gray-200">{title}</span>
            {count != null && <span className="ml-2 text-[11px] text-gray-500 tabular-nums">{count}</span>}
            {subtitle && <span className="block text-[11px] text-gray-500 mt-0.5">{subtitle}</span>}
          </span>
        </button>
        {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
      </div>
      {open && <div id={id} className="px-4 pb-4">{children}</div>}
    </section>
  )
}

const ATT_TONE = {
  danger: { cls: 'border-red-800/50 bg-red-950/20', icon: AlertTriangle, ic: 'text-red-400' },
  warning: { cls: 'border-amber-800/50 bg-amber-950/20', icon: AlertTriangle, ic: 'text-amber-400' },
  info: { cls: 'border-gray-800 bg-gray-900/50', icon: Info, ic: 'text-gray-400' },
  good: { cls: 'border-emerald-800/40 bg-emerald-950/15', icon: CheckCircle2, ic: 'text-emerald-400' },
}

/**
 * "What needs attention". Each item: { key, tone, title, detail, action:
 * { label, onClick } | { label, to } }. Renders nothing when `items` is empty
 * so a healthy page is not padded with a green box nobody reads - pass
 * `clearText` to state the all-clear explicitly when it is informative.
 */
export function AttentionList({ items = [], clearText, title = 'What needs attention' }) {
  if (!items.length && !clearText) return null
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{title}</h2>
      {items.length === 0 ? (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${ATT_TONE.good.cls}`}>
          <CheckCircle2 size={14} className={ATT_TONE.good.ic} aria-hidden="true" />
          <p className="text-xs text-gray-300">{clearText}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {items.map((it) => {
            const t = ATT_TONE[it.tone] || ATT_TONE.info
            const Ic = t.icon
            return (
              <li key={it.key || it.title} className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${t.cls}`}>
                <Ic size={14} className={`${t.ic} shrink-0 mt-0.5`} aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-200 font-medium">{it.title}</p>
                  {it.detail && <p className="text-[11px] text-gray-500 mt-0.5">{it.detail}</p>}
                </div>
                {it.action && (it.action.to ? (
                  <Link to={it.action.to} className={`text-[11px] text-orange-300 hover:text-orange-200 whitespace-nowrap rounded ${FOCUS}`}>
                    {it.action.label}
                  </Link>
                ) : (
                  <Btn size="xs" onClick={it.action.onClick}>{it.action.label}</Btn>
                ))}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Tiny labelled field grid used inside detail modals. */
export function DetailGrid({ items = [] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] text-gray-500">{k}</dt>
          <dd className="text-gray-200 break-words">{v === null || v === undefined || v === '' ? 'N/A' : v}</dd>
        </div>
      ))}
    </dl>
  )
}
