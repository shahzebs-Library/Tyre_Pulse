/**
 * accessKit - page-structure helpers for the People-and-access / Security
 * console pages (Users, Sessions, Access Reviews, API Keys, JIT Elevation,
 * Access Policies, Security Audit, Support Sessions, Account Deletions,
 * Organisations, Security, Access Control).
 *
 * The shared console kit (../../components/ui) owns the primitives. This file
 * only adds the STRUCTURE those pages kept re-deriving so they stop being long
 * scrolling walls:
 *
 *   PageHeader      title, one-line purpose, primary action, last refreshed + Refresh
 *   useUrlTab       active tab synced to ?tab= so a tab is deep-linkable
 *   Collapsible     a section closed by default for rarely used panels
 *   Drawer          a right-hand side sheet for row detail (instead of inline expansion)
 *   usePaged/Pager  client-side paging so a list is never an endless table
 *   AttentionList   "what needs attention" callouts, one action each
 *   useRefreshStamp last-refreshed bookkeeping
 *
 * Stays inside the gray and orange class families (the console light theme
 * re-colours only those), and never shows a failed read as zero.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useInRouterContext, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, RefreshCw, X, CheckCircle2, AlertTriangle, AlertOctagon, Info } from 'lucide-react'
import { Btn } from '../../components/ui'
import useDialogBehavior from '../../../components/ui/useDialogBehavior'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

/** "just now", "3 min ago", "2 h ago", or a date. Null when never refreshed. */
export function relativeTime(date, now = Date.now()) {
  if (!date) return null
  const t = date instanceof Date ? date.getTime() : Date.parse(date)
  if (!Number.isFinite(t)) return null
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(t).toLocaleString()
}

/** Records when a page last finished loading, and re-renders the label each minute. */
export function useRefreshStamp() {
  const [at, setAt] = useState(null)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60000)
    return () => clearInterval(id)
  }, [])
  const stamp = useCallback(() => setAt(new Date()), [])
  return { refreshedAt: at, stamp }
}

/**
 * The compact header every page in this group opens with. `primary` is the
 * one primary action (at most one). `actions` holds secondary buttons such as
 * exports. Refresh is always last and always states when data was last read.
 */
export function PageHeader({ icon: Icon, title, purpose, primary, actions, refreshedAt, onRefresh, refreshing }) {
  const rel = relativeTime(refreshedAt)
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2">
          {Icon && <Icon size={18} className="text-orange-400" aria-hidden="true" />} {title}
        </h1>
        {purpose && <p className="text-xs text-gray-400 mt-1 max-w-3xl">{purpose}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {primary}
        {onRefresh && (
          <span className="inline-flex items-center gap-2">
            <span className="text-[11px] text-gray-500 tabular-nums" aria-live="polite">
              {refreshing ? 'Refreshing' : rel ? `Updated ${rel}` : 'Not loaded yet'}
            </span>
            <Btn icon={RefreshCw} onClick={onRefresh} busy={refreshing}>Refresh</Btn>
          </span>
        )}
      </div>
    </header>
  )
}

/**
 * Active tab held in the URL (?tab= by default) so a link opens the right
 * view. An unknown value falls back to `fallback` rather than rendering blank.
 *
 * Inside a router it goes through useSearchParams so router navigation and the
 * tab stay in step. Outside one (a page rendered on its own in a unit test) it
 * keeps the tab in local state. Whether a component sits inside a router never
 * changes for the life of that component, so the branch below is stable
 * between renders even though it selects between two hooks.
 */
export function useUrlTab(keys, fallback, param = 'tab') {
  const inRouter = useInRouterContext()
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return inRouter ? useRouterTab(keys, fallback, param) : useLocalTab(keys, fallback)
}

function useRouterTab(keys, fallback, param) {
  const [params, setParams] = useSearchParams()
  const raw = params.get(param)
  const active = keys.includes(raw) ? raw : fallback
  const setActive = useCallback((key) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (key === fallback) next.delete(param)
      else next.set(param, key)
      return next
    }, { replace: true })
  }, [setParams, fallback, param])
  return [active, setActive]
}

function useLocalTab(keys, fallback) {
  const [tab, setTab] = useState(fallback)
  return [keys.includes(tab) ? tab : fallback, setTab]
}

/**
 * A free-form value held in the URL (for example ?review=<id>) so an opened
 * record is deep-linkable. Falls back to local state outside a router, on the
 * same reasoning as useUrlTab.
 */
export function useUrlParam(param) {
  const inRouter = useInRouterContext()
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return inRouter ? useRouterParam(param) : useState(null)
}

function useRouterParam(param) {
  const [params, setParams] = useSearchParams()
  const value = params.get(param) || null
  const setValue = useCallback((v) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (v == null || v === '') next.delete(param)
      else next.set(param, String(v))
      return next
    }, { replace: true })
  }, [setParams, param])
  return [value, setValue]
}

/** A section that is closed by default. Its header states what is inside. */
export function Collapsible({ icon: Icon, title, subtitle, count, defaultOpen = false, children, actions, keepMounted = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  return (
    <section className="bg-gray-900/50 border border-gray-800 rounded-xl">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
          className={`flex-1 min-w-0 flex items-center gap-2 text-left rounded ${FOCUS_RING}`}>
          {open ? <ChevronDown size={14} className="text-gray-500 shrink-0" aria-hidden="true" />
            : <ChevronRight size={14} className="text-gray-500 shrink-0" aria-hidden="true" />}
          {Icon && <Icon size={15} className="text-orange-400 shrink-0" aria-hidden="true" />}
          <span className="min-w-0">
            <span className="text-sm font-semibold text-gray-200">{title}</span>
            {count != null && <span className="ml-2 text-[11px] tabular-nums px-1.5 rounded bg-gray-800 text-gray-400">{count}</span>}
            {subtitle && <span className="block text-xs text-gray-500 mt-0.5">{subtitle}</span>}
          </span>
        </button>
        {actions && open && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {/* keepMounted keeps a child with its own unsaved draft alive while it is folded away. */}
      {(open || keepMounted) && <div id={bodyId} hidden={!open} className="px-4 pb-4">{children}</div>}
    </section>
  )
}

/** A right-hand side sheet for one record's detail. */
export function Drawer({ open, title, subtitle, onClose, children, footer, width = 'max-w-xl' }) {
  const panelRef = useRef(null)
  const titleId = useId()
  useDialogBehavior(open, panelRef, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 console-root"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} tabIndex={-1}
        className={`w-full ${width} h-full flex flex-col bg-gray-950 border-l border-gray-800 shadow-2xl`}>
        <header className="flex items-start gap-3 px-5 py-3.5 border-b border-gray-800 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-gray-200 break-words">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5 break-words">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" title="Close"
            className={`p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 shrink-0 ${FOCUS_RING}`}>
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-gray-800 shrink-0">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  )
}

/** A label / value list for drawer bodies. Blank values read N/A, never a dash. */
export function DetailList({ items = [] }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
      {items.filter(Boolean).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-gray-500">{label}</dt>
          <dd className="col-span-2 text-gray-200 break-words">{value == null || value === '' ? 'N/A' : value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Client-side paging. Resets to the first page whenever the list identity or
 * `resetKey` changes (a new filter), so a narrowed list never opens on an
 * empty page 7.
 */
export function usePaged(rows, pageSize = 25, resetKey) {
  const list = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize))
  useEffect(() => { setPage(0) }, [resetKey, list.length])
  const safe = Math.min(page, pageCount - 1)
  const pageRows = useMemo(() => list.slice(safe * pageSize, (safe + 1) * pageSize), [list, safe, pageSize])
  return { page: safe, setPage, pageRows, pageCount, total: list.length, pageSize }
}

/** Prev / Next with an honest "x to y of z". Renders nothing for one page. */
export function Pager({ page, pageCount, total, pageSize, onPage, className = '' }) {
  if (!total || pageCount <= 1) return null
  const from = page * pageSize + 1
  const to = Math.min((page + 1) * pageSize, total)
  return (
    <nav aria-label="Pagination" className={`flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-800 ${className}`}>
      <p className="text-xs text-gray-400 tabular-nums">Showing {from} to {to} of {total.toLocaleString()}</p>
      <div className="flex items-center gap-2">
        <Btn size="xs" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}>Prev</Btn>
        <span className="text-[11px] text-gray-500 tabular-nums">Page {page + 1} of {pageCount}</span>
        <Btn size="xs" onClick={() => onPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}>Next</Btn>
      </div>
    </nav>
  )
}

const ATTN = {
  danger: { icon: AlertOctagon, cls: 'border-red-800/40 bg-red-950/20', iconCls: 'text-red-400' },
  warning: { icon: AlertTriangle, cls: 'border-amber-800/40 bg-amber-950/20', iconCls: 'text-amber-400' },
  info: { icon: Info, cls: 'border-gray-800 bg-gray-900/50', iconCls: 'text-orange-400' },
}

/**
 * "What needs attention", each with exactly one action. `ready` must be true
 * before an empty list may claim that nothing needs attention: a page that
 * could not read its data has not checked.
 */
export function AttentionList({ items = [], ready = true, clearText = 'Nothing needs attention right now.' }) {
  if (!ready) return null
  if (!items.length) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-800 bg-gray-900/50 text-xs text-gray-400">
        <CheckCircle2 size={14} className="text-emerald-400 shrink-0" aria-hidden="true" /> {clearText}
      </div>
    )
  }
  return (
    <ul className="space-y-2" aria-label="Needs attention">
      {items.map((it) => {
        const t = ATTN[it.tone] || ATTN.info
        const Icon = t.icon
        return (
          <li key={it.key} className={`flex flex-wrap items-start gap-2 px-3 py-2.5 rounded-lg border ${t.cls}`}>
            <Icon size={14} className={`${t.iconCls} shrink-0 mt-0.5`} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-200">{it.title}</p>
              {it.detail && <p className="text-[11px] text-gray-400 mt-0.5 break-words">{it.detail}</p>}
            </div>
            {it.action && <Btn size="xs" onClick={it.action.onClick}>{it.action.label}</Btn>}
          </li>
        )
      })}
    </ul>
  )
}
