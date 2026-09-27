/**
 * pageKit - THE page-structure kit for every super-admin console page.
 *
 * The console UI kit (../../components/ui) owns the atoms (buttons, tables,
 * panels). This file owns the STRUCTURE every console page shares, so there
 * is one definition of each piece instead of one per page family. It replaced
 * six parallel kits (ops/, opsKit/, dataKit/, dataTrust/kit, accessKit/,
 * platformOps/kit + paging) that had drifted apart. Their props are all still
 * accepted here, so a page reads the same whichever kit it was written for.
 *
 *   PageHeader        title, one-line purpose, actions, last refreshed + Refresh
 *   useUrlTab         active tab mirrored into ?tab= (router optional)
 *   useUrlParam       any other deep-linkable value (?review=<id>)
 *   TabBar / TabPanel the kit Segmented as a tablist, and its panel
 *   Collapsible       rarely used content, closed by default (alias: Section)
 *   Drawer            row detail as a right-hand dialog (alias: SideDrawer)
 *   Field / DetailList / DetailGrid   label/value lists for drawers and modals
 *   usePaged / Pager  client paging with a page-size choice (alias: usePager)
 *   AttentionList     "what needs attention", one action each
 *   ConsoleLink       router link that degrades to an anchor outside a router
 *   useNow / useRefreshStamp          relative-time bookkeeping
 *   ageText / whenText / fmtRelative / fmtDateTime / pageSlice / clampPage
 *
 * Sorting, search and export stay in src/lib/consoleTable.js and
 * ./ExportButtons.jsx. Colours stay inside the gray-* / orange-* families so
 * the console light theme applies. Nothing here shows a failed read as zero.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useInRouterContext, useSearchParams } from 'react-router-dom'
import {
  RefreshCw, ChevronDown, ChevronRight, ChevronLeft, X, ArrowRight,
  AlertTriangle, AlertOctagon, CheckCircle2, HelpCircle, Info,
} from 'lucide-react'
import { Btn, Segmented, Select } from '../../components/ui'
import useDialogBehavior from '../../../components/ui/useDialogBehavior'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

/* ── pure time + paging helpers ───────────────────────────────────────────── */

/**
 * Relative age in plain English ("just now", "4 min ago", "3 h ago", "2 days
 * ago"). Null for a missing or unparseable time, so a caller prints "never"
 * or "N/A" rather than "NaN min ago".
 */
export function ageText(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null
  const t = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime()
  if (!Number.isFinite(t)) return null
  const s = Math.round((now - t) / 1000)
  if (s < 0) return 'in the future'
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** A date-time for tables, or 'N/A' when the value is missing or junk. */
export function whenText(value) {
  if (!value) return 'N/A'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** "5 min ago" / "in 3 h" for scheduled times that may be in the future. */
export function fmtRelative(v, now = Date.now()) {
  if (!v) return 'N/A'
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return 'N/A'
  const diff = now - t
  const past = diff >= 0
  const mins = Math.floor(Math.abs(diff) / 60000)
  if (mins < 1) return 'just now'
  const shape = (n, unit) => (past ? `${n} ${unit} ago` : `in ${n} ${unit}`)
  if (mins < 60) return shape(mins, 'min')
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return shape(hrs, 'h')
  return shape(Math.floor(hrs / 24), 'd')
}

/** The browser's local date-time, or 'N/A'. */
export function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString()
}

/** The last-refreshed stamp the header prints. */
export function refreshedLabel(ts, now = Date.now()) {
  const age = ageText(ts, now)
  return age ? `Updated ${age}` : 'Not loaded yet'
}

/** Clamp a requested page to the pages that exist (1-based). */
export function clampPage(page, total, size) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / Math.max(1, size)))
  const p = Math.floor(Number(page) || 1)
  return Math.min(Math.max(1, p), pages)
}

/**
 * One page of `rows` (1-based page). `start`/`end` are 1-based and inclusive,
 * both 0 for an empty list so a pager can say "0 of 0" instead of "1-0 of 0".
 */
export function pageSlice(rows, page, size = 25) {
  const list = Array.isArray(rows) ? rows : []
  const n = Math.max(1, Math.floor(size) || 25)
  const total = list.length
  const pages = Math.max(1, Math.ceil(total / n))
  const current = clampPage(page, total, n)
  const from = (current - 1) * n
  const slice = list.slice(from, from + n)
  return { rows: slice, page: current, pages, total, start: total ? from + 1 : 0, end: total ? from + slice.length : 0 }
}

/* ── time hooks ───────────────────────────────────────────────────────────── */

/** Re-render every `ms` so relative times ("3 min ago") stay true. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** Records when a page last finished loading: `const { refreshedAt, stamp } = useRefreshStamp()`. */
export function useRefreshStamp() {
  const [at, setAt] = useState(null)
  const stamp = useCallback(() => setAt(new Date()), [])
  return { refreshedAt: at, stamp }
}

/* ── header ───────────────────────────────────────────────────────────────── */

/**
 * The compact header every console page opens with. `primary` is the one
 * primary action, `actions` the secondary ones (exports); Refresh is always
 * last and always states when the data on screen was read.
 */
export function PageHeader({
  icon: Icon, title, purpose, actions, primary, meta, children,
  refreshedAt, onRefresh, refreshing, busy, refreshLabel = 'Refresh', refreshDisabled,
}) {
  const now = useNow()
  const working = refreshing ?? busy
  const age = ageText(refreshedAt, now)
  const showStamp = Boolean(onRefresh || refreshedAt)
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2">
          {Icon && <Icon size={18} className="text-orange-400 shrink-0" aria-hidden="true" />} {title}
        </h1>
        {purpose && <p className="text-xs text-gray-400 mt-1 max-w-3xl">{purpose}</p>}
        {meta && <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">{meta}</div>}
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {primary}
        {showStamp && (
          <span className="text-[11px] text-gray-500 tabular-nums" aria-live="polite"
            title={refreshedAt ? fmtDateTime(refreshedAt) : undefined}>
            {working ? 'Refreshing...' : age ? `Updated ${age}` : 'Not loaded yet'}
          </span>
        )}
        {onRefresh && (
          <Btn icon={RefreshCw} onClick={onRefresh} busy={working} disabled={refreshDisabled}>{refreshLabel}</Btn>
        )}
      </div>
    </header>
  )
}

/* ── URL state ────────────────────────────────────────────────────────────── */

function readParam(name) {
  if (typeof window === 'undefined') return null
  try { return new URLSearchParams(window.location.search).get(name) } catch { return null }
}

function writeParam(name, value) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  try {
    const url = new URL(window.location.href)
    if (value == null || value === '') url.searchParams.delete(name)
    else url.searchParams.set(name, String(value))
    const next = `${url.pathname}${url.search}${url.hash}`
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      // replaceState keeps the router's own history.state: a tab switch is not a navigation.
      window.history.replaceState(window.history.state, '', next)
    }
  } catch { /* URL sync is a convenience; the value still changes in local state */ }
}

/** Router-backed value: goes through useSearchParams so the router stays in step. */
function useRouterValue(param) {
  const [params, setParams] = useSearchParams()
  const raw = params.get(param)
  const set = useCallback((v) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (v == null || v === '') next.delete(param)
      else next.set(param, String(v))
      return next
    }, { replace: true })
  }, [setParams, param])
  return [raw, set]
}

/**
 * Outside a router (a page mounted bare in a unit test): local state is the
 * source of truth, mirrored into the address bar with history.replaceState
 * and back again on popstate.
 */
function useWindowValue(param) {
  const [raw, setRaw] = useState(() => readParam(param))
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onPop = () => setRaw(readParam(param))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [param])
  const set = useCallback((v) => {
    setRaw(v == null || v === '' ? null : String(v))
    writeParam(param, v)
  }, [param])
  return [raw, set]
}

/** Router presence never changes for a mounted component, so hook order is stable. */
function useUrlValue(param) {
  const inRouter = useInRouterContext()
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return inRouter ? useRouterValue(param) : useWindowValue(param)
}

/**
 * `const [tab, setTab] = useUrlTab(['a', 'b'], 'a')`. The active tab lives in
 * ?tab= (or `param`) so it can be deep-linked, bookmarked and survives a
 * reload. An unknown value falls back to `fallback` (default: first key)
 * rather than rendering an empty view; the fallback itself is written as no
 * parameter at all, so the plain page URL stays clean.
 */
export function useUrlTab(keys, fallback, param = 'tab') {
  const list = Array.isArray(keys) ? keys : []
  const def = fallback ?? list[0]
  const [raw, setRaw] = useUrlValue(param)
  const tab = raw && list.includes(raw) ? raw : def
  const keyStr = list.join('|')
  const setTab = useCallback((next) => {
    const v = keyStr.split('|').includes(next) ? next : def
    setRaw(v === def ? null : v)
  }, [keyStr, def, setRaw])
  return [tab, setTab]
}

/** A free-form value in the URL (for example ?review=<id>). Null when absent. */
export function useUrlParam(param) {
  const [raw, set] = useUrlValue(param)
  return [raw || null, set]
}

/* ── tabs ─────────────────────────────────────────────────────────────────── */

/** The kit Segmented as a tablist. `tabs` = [{ key, label, count, icon, hint }]. */
export function TabBar({ tabs = [], value, onChange, label, ariaLabel }) {
  const options = tabs.map((t) => ({
    key: t.key,
    count: t.count == null ? undefined : t.count,
    hint: t.hint,
    disabled: t.disabled,
    label: t.icon
      ? <span className="inline-flex items-center gap-1.5"><t.icon size={13} aria-hidden="true" /> {t.label}</span>
      : t.label,
  }))
  return (
    <div className="border-b border-gray-800 pb-3">
      <Segmented ariaLabel={ariaLabel || label || 'Page sections'} value={value} onChange={onChange} options={options} />
    </div>
  )
}

/** Wraps the active tab's content with the tabpanel role the tabs expect. */
export function TabPanel({ label, children }) {
  return <div role="tabpanel" aria-label={label} className="space-y-4">{children}</div>
}

/* ── collapsible ──────────────────────────────────────────────────────────── */

/**
 * A section that folds away, closed by default for content most visits do not
 * need; the header still states what is inside and how many. Controlled when
 * `open` is passed. `keepMounted` keeps a child with its own unsaved draft
 * alive while folded.
 */
export function Collapsible({
  icon: Icon, title, subtitle, count, badge, defaultOpen = false, open: openProp, onToggle,
  actions, tone, keepMounted = false, children,
}) {
  const [openState, setOpenState] = useState(defaultOpen)
  const open = openProp ?? openState
  const bodyId = useId()
  const toggle = () => {
    if (onToggle) onToggle(!open)
    if (openProp === undefined) setOpenState((v) => !v)
  }
  const ring = tone === 'warning' ? 'border-amber-800/40' : tone === 'danger' ? 'border-red-800/40' : 'border-gray-800'
  const iconCls = tone === 'warning' ? 'text-amber-400' : tone === 'danger' ? 'text-red-400' : 'text-orange-400'
  return (
    <section className={`bg-gray-900/50 border ${ring} rounded-xl`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={bodyId}
          className={`flex-1 min-w-0 flex items-start gap-2 text-left rounded ${FOCUS}`}>
          {open
            ? <ChevronDown size={15} className="text-gray-500 mt-0.5 shrink-0" aria-hidden="true" />
            : <ChevronRight size={15} className="text-gray-500 mt-0.5 shrink-0" aria-hidden="true" />}
          {Icon && <Icon size={15} className={`${iconCls} mt-0.5 shrink-0`} aria-hidden="true" />}
          <span className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-gray-200 inline-flex items-center gap-2">
              {title}
              {count != null && <span className="tabular-nums text-[10px] px-1.5 rounded bg-gray-800 text-gray-400">{count}</span>}
            </span>
            {subtitle && <span className="block text-xs text-gray-500 mt-0.5">{subtitle}</span>}
          </span>
          {badge}
        </button>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {(open || keepMounted) && <div id={bodyId} hidden={!open} className="px-4 pb-4">{children}</div>}
    </section>
  )
}

/** dataKit name for the same piece. */
export const Section = Collapsible

/* ── drawer + detail lists ────────────────────────────────────────────────── */

/**
 * Row detail slides in from the right instead of expanding inline, so the
 * list keeps its place. Same dialog behaviour as the kit Modal: Escape closes,
 * focus is trapped inside and returns to the opener on close.
 */
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
            {subtitle && <div className="text-xs text-gray-500 mt-0.5 break-words">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" title="Close"
            className={`p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 shrink-0 ${FOCUS}`}>
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

/** ops name for the same piece. */
export const SideDrawer = Drawer

const blank = (v) => v === null || v === undefined || v === ''

/** One label/value row for a drawer's <dl>. Blank reads N/A. */
export function Field({ label, children }) {
  return (
    <div className="grid grid-cols-3 gap-3 text-xs py-1.5 border-b border-gray-800/60 last:border-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="col-span-2 text-gray-300 break-words min-w-0">{blank(children) ? 'N/A' : children}</dd>
    </div>
  )
}

/** A label/value list: items = [[label, value], ...]. Blank values read N/A. */
export function DetailList({ items = [] }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
      {items.filter(Boolean).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-gray-500">{label}</dt>
          <dd className="col-span-2 text-gray-200 break-words">{blank(value) ? 'N/A' : value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Two-column labelled grid for detail modals: items = [[label, value], ...]. */
export function DetailGrid({ items = [] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] text-gray-500">{k}</dt>
          <dd className="text-gray-200 break-words">{blank(v) ? 'N/A' : v}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ── paging ───────────────────────────────────────────────────────────────── */

export const PAGE_SIZE = 25
export const PAGE_SIZES = [10, 25, 50, 100]

/**
 * Client paging over rows already in memory.
 *
 *   const paged = usePaged(rows, 25, `${search}|${sort?.key}`)
 *   paged.rows.map(...)        // the current page (also .pageRows / .slice)
 *   <Pager paged={paged} label="rows" />   // or <Pager {...paged} />
 *
 * `page` is 0-based; `pageNumber` is the 1-based number people read. The page
 * resets to the first one when `resetKey` changes (a new search or filter) or,
 * when no key is given, when the row count changes. It otherwise clamps, so a
 * shrinking list never shows an empty page 7 of 2.
 */
export function usePaged(rows, size = PAGE_SIZE, resetKey) {
  const list = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const [pageSize, setPageSize] = useState(size)
  const [page, setPageState] = useState(0)
  useEffect(() => { setPageSize(size) }, [size])
  const trigger = resetKey === undefined ? `len:${list.length}` : `key:${String(resetKey)}`
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setPageState(0)
  }, [trigger, pageSize])
  const total = list.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safe = Math.min(Math.max(0, page), pageCount - 1)
  const pageRows = useMemo(() => list.slice(safe * pageSize, safe * pageSize + pageSize), [list, safe, pageSize])
  const setPage = useCallback((p) => {
    setPageState((cur) => Math.max(0, Math.floor(Number(typeof p === 'function' ? p(cur) : p) || 0)))
  }, [])
  const setSize = useCallback((n) => { setPageSize(Math.max(1, Number(n) || PAGE_SIZE)); setPageState(0) }, [])
  const from = total ? safe * pageSize + 1 : 0
  const to = Math.min(total, safe * pageSize + pageSize)
  return {
    rows: pageRows, pageRows, slice: pageRows,
    page: safe, pageNumber: safe + 1, pageCount, pages: pageCount,
    total, size: pageSize, pageSize,
    from, to, start: from, end: to,
    setPage, onPage: setPage, setSize,
  }
}

/** dataKit name for the same hook. */
export const usePager = usePaged

/**
 * "Showing 26 to 50 of 180 rows" with previous / next and a page size.
 * Accepts the hook result as `paged` (or `pager`) or spread as props; plain
 * props (page 0-based, pageCount, total, pageSize, onPage) work for a server
 * paged list. Nothing renders for an empty list, and a list that fits on one
 * page shows only its count.
 */
export function Pager(props) {
  const src = props.paged || props.pager || props
  const label = props.label || 'rows'
  const total = Number(src.total) || 0
  const pageSize = Number(src.pageSize ?? src.size) || PAGE_SIZE
  const pageCount = Number(src.pageCount ?? src.pages) || Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(0, Number(src.page) || 0), pageCount - 1)
  const go = src.setPage || src.onPage || props.onPage || props.setPage
  const setSize = src.setSize
  if (!total) return null
  const from = page * pageSize + 1
  const to = Math.min(total, from + pageSize - 1)
  const sizeChoice = typeof setSize === 'function' && total > PAGE_SIZES[0]
  if (pageCount <= 1 && !sizeChoice) {
    return <p className={`text-[11px] text-gray-500 tabular-nums mt-2 ${props.className || ''}`}>{total.toLocaleString()} {label}</p>
  }
  const sizes = PAGE_SIZES.includes(pageSize) ? PAGE_SIZES : [...PAGE_SIZES, pageSize].sort((a, b) => a - b)
  return (
    <nav aria-label={`Pages of ${label}`} className={`flex flex-wrap items-center justify-between gap-2 mt-3 text-[11px] text-gray-500 ${props.className || ''}`}>
      <span className="tabular-nums" aria-live="polite">
        Showing {from.toLocaleString()} to {to.toLocaleString()} of {total.toLocaleString()} {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {sizeChoice && (
          <Select value={String(pageSize)} onChange={(v) => setSize(Number(v))} ariaLabel="Rows per page" className="w-28"
            options={sizes.map((n) => ({ value: String(n), label: `${n} per page` }))} />
        )}
        {pageCount > 1 && (
          <>
            <Btn size="xs" icon={ChevronLeft} ariaLabel="Previous page" title="Previous page"
              disabled={page <= 0} onClick={() => go?.(page - 1)}>Previous</Btn>
            <span className="tabular-nums">Page {page + 1} of {pageCount}</span>
            <Btn size="xs" ariaLabel="Next page" title="Next page"
              disabled={page >= pageCount - 1} onClick={() => go?.(page + 1)}>
              Next <ChevronRight size={12} aria-hidden="true" />
            </Btn>
          </>
        )}
      </div>
    </nav>
  )
}

/* ── links ────────────────────────────────────────────────────────────────── */

const CHIP = `inline-flex items-center gap-1.5 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 ${FOCUS}`
const PLAIN = `inline-flex items-center gap-1 text-orange-300 hover:text-orange-200 hover:underline underline-offset-2 rounded ${FOCUS}`

/**
 * A drill-down link to another console page: a small chip by default, an
 * inline orange text link with `plain`. Uses the router when there is one (no
 * reload, console session untouched) and a plain anchor otherwise.
 */
export function ConsoleLink({ to, children, icon: Icon, className = '', plain = false }) {
  const inRouter = useInRouterContext()
  const cls = `${plain ? PLAIN : CHIP} ${className}`
  const body = (<>{Icon && <Icon size={12} aria-hidden="true" />}{children}</>)
  return inRouter ? <Link to={to} className={cls}>{body}</Link> : <a href={to} className={cls}>{body}</a>
}

/* ── attention ────────────────────────────────────────────────────────────── */

const ATTN = {
  danger: { icon: AlertOctagon, cls: 'border-red-800/40 bg-red-950/20', mark: 'text-red-400', word: 'Urgent' },
  warning: { icon: AlertTriangle, cls: 'border-amber-800/40 bg-amber-950/20', mark: 'text-amber-400', word: 'Review' },
  info: { icon: Info, cls: 'border-gray-800 bg-gray-900/40', mark: 'text-gray-400', word: 'Note' },
}

/** Every kit spelled an item's action differently; read them all. */
export function normalizeAttentionItem(it) {
  if (!it) return null
  let action = null
  if (typeof it.action === 'function') {
    action = { onClick: it.action, label: it.actionLabel || 'Open', icon: it.actionIcon }
  } else if (it.action && (it.action.onClick || it.action.to)) {
    action = { ...it.action, label: it.action.label || it.actionLabel || 'Open' }
  } else if (it.to) {
    action = { to: it.to, label: it.actionLabel || 'Open' }
  } else if (typeof it.onAction === 'function') {
    action = { onClick: it.onAction, label: it.actionLabel || 'Open', icon: it.actionIcon }
  }
  return { key: it.key, tone: it.tone, text: it.text ?? it.title, detail: it.detail, action }
}

/**
 * "What needs attention", worst first, each with at most ONE action (a button
 * or a link to the console page that fixes it).
 *
 *   ready={false}   the data is not in yet: render nothing (never "all clear")
 *   unknown="..."   the read failed: say so instead of claiming all clear
 *   clear / clearText   the all-clear sentence
 *   quiet           render nothing when empty and no clear text was given
 */
export function AttentionList({
  items = [], title = 'Needs attention', subtitle, clear, clearText, unknown, ready = true, quiet = false,
}) {
  if (!ready) return null
  const shown = (items || []).map(normalizeAttentionItem).filter(Boolean)
  const clearMsg = clear ?? clearText
  if (!shown.length && !unknown && quiet && !clearMsg) return null
  return (
    <section aria-label={title} className="space-y-2">
      {title && <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h2>}
      {subtitle && <p className="text-[11px] text-gray-500 -mt-1">{subtitle}</p>}
      {shown.length === 0 ? (
        unknown ? (
          <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs text-gray-400">
            <HelpCircle size={14} className="text-gray-500 shrink-0" aria-hidden="true" /> {unknown}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs text-gray-400">
            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" aria-hidden="true" />
            {clearMsg || 'Nothing needs attention right now.'}
          </div>
        )
      ) : (
        <ul className="space-y-1.5">
          {shown.map((it, i) => {
            const t = ATTN[it.tone] || ATTN.info
            const Icon = t.icon
            const a = it.action
            return (
              <li key={it.key ?? i} className={`flex flex-wrap items-start gap-2 rounded-lg border px-3 py-2 ${t.cls}`}>
                <Icon size={14} className={`${t.mark} shrink-0 mt-0.5`} aria-hidden="true" />
                <span className="sr-only">{t.word}: </span>
                <div className="flex-1 min-w-0 text-xs">
                  <p className="text-gray-200 break-words">{it.text}</p>
                  {it.detail && <p className="text-[11px] text-gray-400 mt-0.5 break-words">{it.detail}</p>}
                </div>
                {a && (a.to
                  ? <ConsoleLink to={a.to} icon={a.icon} plain>{a.label} {!a.icon && <ArrowRight size={11} aria-hidden="true" />}</ConsoleLink>
                  : <Btn size="xs" icon={a.icon} onClick={a.onClick}>{a.label}</Btn>)}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
