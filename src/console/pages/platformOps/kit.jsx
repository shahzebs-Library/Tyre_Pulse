/**
 * Page-level building blocks shared by the platform and operations console
 * pages (trust alerts, pipeline monitor, announcements, system config, AI
 * usage, mobile app, platform map, report appearance, navigation, vehicle
 * designer). They sit ON the console UI kit and never restyle it; the kit
 * stays the vocabulary for cards, tables and states.
 *
 * Why these exist: every one of those pages had grown into a long scrolling
 * wall. The fix is structure, not less content:
 *   - PageHeader    one compact header: title, one-line purpose, the primary
 *                   action, when the data was read and a Refresh
 *   - useUrlTab     the active tab lives in ?tab= so a view can be linked to
 *   - Pager         tables are paged, never endless
 *   - Collapsible   rarely used panels start closed
 *   - AttentionList "what needs you" callouts, each with ONE action
 *
 * Everything works without a router too (a couple of render tests mount pages
 * bare), falling back to local state and a plain anchor.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Link, useInRouterContext, useSearchParams } from 'react-router-dom'
import {
  RefreshCw, ChevronDown, ChevronRight, ChevronLeft, ArrowRight, AlertTriangle, CheckCircle2, Info,
} from 'lucide-react'
import { Btn } from '../../components/ui'
import { pageSlice, ageText } from './paging'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

/** Re-render every `ms` so relative times ("3 min ago") stay true. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/**
 * The compact page header. `refreshedAt` is when the data on screen was read;
 * it is printed so nobody acts on a stale view without knowing it is stale.
 */
export function PageHeader({ icon: Icon, title, purpose, actions, refreshedAt, onRefresh, refreshing, meta }) {
  const now = useNow()
  const age = ageText(refreshedAt, now)
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2">
          {Icon && <Icon size={18} className="text-orange-400 shrink-0" aria-hidden="true" />}
          {title}
        </h1>
        {purpose && <p className="text-xs text-gray-400 mt-1 max-w-3xl">{purpose}</p>}
        {(onRefresh || meta) && (
          <p className="text-[11px] text-gray-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {onRefresh && (
              <span aria-live="polite">
                {refreshing ? 'Reading latest data...' : age ? `Data read ${age}` : 'Not read yet'}
              </span>
            )}
            {meta}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onRefresh && <Btn icon={RefreshCw} onClick={onRefresh} busy={refreshing}>Refresh</Btn>}
        {actions}
      </div>
    </header>
  )
}

function useRouterTab(keys, fallback, param) {
  const [params, setParams] = useSearchParams()
  const raw = params.get(param)
  const value = keys.includes(raw) ? raw : fallback
  const set = useCallback((key) => {
    const next = new URLSearchParams(params)
    next.set(param, key)
    setParams(next, { replace: true })
  }, [params, setParams, param])
  return [value, set]
}

function useLocalTab(keys, fallback) {
  const [value, setValue] = useState(fallback)
  const set = useCallback((key) => { if (keys.includes(key)) setValue(key) }, [keys])
  return [keys.includes(value) ? value : fallback, set]
}

/**
 * The active tab, kept in the URL (?tab= by default) so a view can be deep
 * linked and survives a reload. Outside a router it is plain local state.
 */
export function useUrlTab(keys, fallback, param = 'tab') {
  const inRouter = useInRouterContext()
  // Router presence never changes for a mounted page, so the hook order is
  // stable even though the branch looks conditional.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return inRouter ? useRouterTab(keys, fallback, param) : useLocalTab(keys, fallback)
}

/**
 * Paging state for a list. The page resets to 1 whenever `resetKey` changes
 * (a new search or filter), so a narrowed list never opens on an empty page.
 */
export function usePaged(rows, size = 25, resetKey = '') {
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [resetKey])
  const view = useMemo(() => pageSlice(rows, page, size), [rows, page, size])
  return { ...view, setPage }
}

/** "Showing 26-50 of 212" plus previous/next. Hidden when one page holds everything. */
export function Pager({ paged, label = 'rows' }) {
  if (!paged || paged.pages <= 1) {
    return paged && paged.total > 0
      ? <p className="text-[11px] text-gray-500 tabular-nums px-1 py-2">{paged.total} {label}</p>
      : null
  }
  return (
    <nav aria-label={`Pages of ${label}`} className="flex flex-wrap items-center justify-between gap-2 px-1 py-2">
      <p className="text-[11px] text-gray-500 tabular-nums">
        Showing {paged.start}-{paged.end} of {paged.total} {label}
      </p>
      <div className="flex items-center gap-1.5">
        <Btn size="xs" icon={ChevronLeft} onClick={() => paged.setPage(paged.page - 1)} disabled={paged.page <= 1}>
          Previous
        </Btn>
        <span className="text-[11px] text-gray-500 tabular-nums">Page {paged.page} of {paged.pages}</span>
        <Btn size="xs" onClick={() => paged.setPage(paged.page + 1)} disabled={paged.page >= paged.pages}>
          Next <ChevronRight size={12} aria-hidden="true" />
        </Btn>
      </div>
    </nav>
  )
}

/**
 * A section that can fold away. Closed by default for panels most visits do
 * not need; the header still states what is inside and how many.
 */
export function Collapsible({ icon: Icon, title, subtitle, count, defaultOpen = false, open: openProp, onToggle, actions, children, tone }) {
  const [openState, setOpenState] = useState(defaultOpen)
  const open = openProp ?? openState
  const bodyId = useId()
  const toggle = () => {
    if (onToggle) onToggle(!open)
    if (openProp === undefined) setOpenState((v) => !v)
  }
  const ring = tone === 'warning' ? 'border-amber-800/40' : tone === 'danger' ? 'border-red-800/40' : 'border-gray-800'
  return (
    <section className={`bg-gray-900/50 border ${ring} rounded-xl`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={bodyId}
          className={`flex-1 min-w-0 flex items-start gap-2 text-left rounded ${FOCUS}`}>
          {open
            ? <ChevronDown size={15} className="text-gray-500 mt-0.5 shrink-0" aria-hidden="true" />
            : <ChevronRight size={15} className="text-gray-500 mt-0.5 shrink-0" aria-hidden="true" />}
          {Icon && <Icon size={15} className={`${tone === 'warning' ? 'text-amber-400' : tone === 'danger' ? 'text-red-400' : 'text-orange-400'} mt-0.5 shrink-0`} aria-hidden="true" />}
          <span className="min-w-0">
            <span className="text-sm font-semibold text-gray-200 inline-flex items-center gap-2">
              {title}
              {count != null && <span className="tabular-nums text-[10px] px-1.5 rounded bg-gray-800 text-gray-400">{count}</span>}
            </span>
            {subtitle && <span className="block text-xs text-gray-500 mt-0.5">{subtitle}</span>}
          </span>
        </button>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {open && <div id={bodyId} className="px-4 pb-4">{children}</div>}
    </section>
  )
}

/** Router-aware link that degrades to a plain anchor outside a router. */
export function ConsoleLink({ to, children, className = '' }) {
  const inRouter = useInRouterContext()
  const cls = `inline-flex items-center gap-1 text-orange-300 hover:text-orange-200 hover:underline rounded ${FOCUS} ${className}`
  if (inRouter) return <Link to={to} className={cls}>{children}</Link>
  return <a href={to} className={cls}>{children}</a>
}

const ATTN = {
  danger: { icon: AlertTriangle, cls: 'border-red-800/40 bg-red-950/20', ink: 'text-red-300', mark: 'text-red-400' },
  warning: { icon: AlertTriangle, cls: 'border-amber-800/40 bg-amber-950/20', ink: 'text-amber-200', mark: 'text-amber-400' },
  info: { icon: Info, cls: 'border-gray-800 bg-gray-900/40', ink: 'text-gray-300', mark: 'text-gray-500' },
  good: { icon: CheckCircle2, cls: 'border-emerald-800/40 bg-emerald-950/15', ink: 'text-emerald-200', mark: 'text-emerald-400' },
}

/**
 * "What needs attention": short callouts, each with at most ONE action (a
 * button or a link to the console page that fixes it). An empty list renders
 * the `clear` message, so "nothing to do" is a statement, not a blank.
 */
export function AttentionList({ items = [], clear = 'Nothing needs attention right now.', title = 'Needs attention' }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {items.length === 0 ? (
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${ATTN.good.cls} ${ATTN.good.ink}`}>
          <CheckCircle2 size={14} className={ATTN.good.mark} aria-hidden="true" /> {clear}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => {
            const t = ATTN[it.tone] || ATTN.info
            const Icon = t.icon
            return (
              <li key={it.key} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${t.cls}`}>
                <Icon size={14} className={`${t.mark} shrink-0`} aria-hidden="true" />
                <span className={`flex-1 min-w-0 break-words ${t.ink}`}>{it.text}</span>
                {it.to ? (
                  <ConsoleLink to={it.to}>{it.actionLabel || 'Open'} <ArrowRight size={11} aria-hidden="true" /></ConsoleLink>
                ) : it.onAction ? (
                  <Btn size="xs" onClick={it.onAction}>{it.actionLabel || 'Open'}</Btn>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Wraps the active tab's content with the tabpanel role the Segmented tabs expect. */
export function TabPanel({ label, children }) {
  return <div role="tabpanel" aria-label={label} className="space-y-4">{children}</div>
}
