/**
 * dataKit - page-structure helpers shared by the console DATA pages
 * (Data Operations, Tenant Export, Backups, Data Cleanup, Data Browser,
 * Material Master, Duplicate Control, Smart Import).
 *
 * The console kit (components/ui) supplies the atoms. These pieces solve the
 * one problem those pages all had: they were long scrolling walls. So every
 * data page now has the same frame:
 *
 *   PageHeader   title, one-line purpose, primary action, last refreshed + Refresh
 *   useUrlTab    the active tab lives in ?tab= so a deep link opens the right view
 *   TabBar       the kit Segmented as a real tablist, with counts
 *   Section      a collapsible panel for rarely used content, closed by default
 *   usePager / Pager   tables page instead of scrolling for ever
 *
 * useUrlTab deliberately reads and writes window.location through
 * history.replaceState rather than react-router's useSearchParams: several of
 * these pages are rendered in tests without a router, and a hook that throws
 * outside a router would crash them. replaceState keeps the router's own
 * history state (idx/key) so back and forward still behave.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { RefreshCw, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react'
import { Btn, Segmented } from '../../components/ui'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

/* ── URL-synced tab ───────────────────────────────────────────────────────── */

function readParam(name) {
  if (typeof window === 'undefined') return null
  try { return new URLSearchParams(window.location.search).get(name) } catch { return null }
}

function writeParam(name, value, fallback) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  try {
    const url = new URL(window.location.href)
    if (value == null || value === fallback) url.searchParams.delete(name)
    else url.searchParams.set(name, value)
    const next = `${url.pathname}${url.search}${url.hash}`
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', next)
    }
  } catch { /* a URL that cannot be rewritten simply keeps its old tab */ }
}

/**
 * `const [tab, setTab] = useUrlTab(['a','b'], 'a')`. An unknown value in the
 * URL falls back to the default rather than rendering an empty view.
 */
export function useUrlTab(allowed, fallback, param = 'tab') {
  const pick = useCallback((v) => (allowed.includes(v) ? v : fallback), [allowed, fallback])
  const [tab, setTabState] = useState(() => pick(readParam(param)))
  useEffect(() => {
    const onPop = () => setTabState(pick(readParam(param)))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [pick, param])
  const setTab = useCallback((v) => {
    const next = pick(v)
    setTabState(next)
    writeParam(param, next, fallback)
  }, [pick, param, fallback])
  return [tab, setTab]
}

/* ── header ───────────────────────────────────────────────────────────────── */

/** "3 min ago" for the last-refreshed stamp. N/A when nothing has loaded yet. */
export function fmtAgo(ts, now = Date.now()) {
  if (!ts) return 'N/A'
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
  if (!Number.isFinite(t)) return 'N/A'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/**
 * The compact page header every data page opens with. `actions` holds the one
 * primary action (and at most a secondary); Refresh and its timestamp are
 * rendered here so every page reports freshness the same way.
 */
export function PageHeader({ icon: Icon, title, purpose, actions, refreshedAt, onRefresh, refreshing, refreshLabel = 'Refresh', refreshDisabled }) {
  // Re-render once a minute so "2 min ago" does not freeze on screen.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!refreshedAt) return undefined
    const id = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [refreshedAt])
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          {Icon && <Icon size={18} className="text-orange-400 shrink-0" aria-hidden="true" />} {title}
        </h1>
        {purpose && <p className="text-xs text-gray-400 mt-1 max-w-2xl">{purpose}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onRefresh && (
          <span className="text-[11px] text-gray-500" aria-live="polite">
            {refreshing ? 'Refreshing...' : `Updated ${fmtAgo(refreshedAt)}`}
          </span>
        )}
        {onRefresh && (
          <Btn icon={RefreshCw} onClick={onRefresh} busy={refreshing} disabled={refreshDisabled}>{refreshLabel}</Btn>
        )}
        {actions}
      </div>
    </header>
  )
}

/* ── tabs ─────────────────────────────────────────────────────────────────── */

/** The kit Segmented as a tablist. `tabs` = [{ key, label, count, icon }]. */
export function TabBar({ tabs, value, onChange, ariaLabel }) {
  const options = tabs.map((t) => ({
    key: t.key,
    count: t.count == null ? undefined : t.count,
    hint: t.hint,
    label: t.icon
      ? <span className="inline-flex items-center gap-1.5"><t.icon size={13} aria-hidden="true" /> {t.label}</span>
      : t.label,
  }))
  return <Segmented ariaLabel={ariaLabel} value={value} onChange={onChange} options={options} />
}

/* ── collapsible section ──────────────────────────────────────────────────── */

/**
 * A panel whose body is hidden until asked for. Used for reference material
 * and rarely used tools, so the working view stays one screen tall.
 */
export function Section({ icon: Icon, title, subtitle, defaultOpen = false, badge, actions, children, tone }) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const ring = tone === 'warning' ? 'border-amber-800/40' : tone === 'danger' ? 'border-red-800/40' : 'border-gray-800'
  return (
    <section className={`bg-gray-900/50 border ${ring} rounded-xl`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
          className={`flex-1 min-w-0 flex items-center gap-2 text-left rounded ${FOCUS_RING}`}>
          <span className="text-gray-500" aria-hidden="true">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
          {Icon && <Icon size={15} className="text-orange-400 shrink-0" aria-hidden="true" />}
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-200">{title}</span>
            {subtitle && <span className="block text-xs text-gray-500 mt-0.5">{subtitle}</span>}
          </span>
          {badge}
        </button>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {open && <div id={bodyId} className="px-4 pb-4">{children}</div>}
    </section>
  )
}

/* ── paging ───────────────────────────────────────────────────────────────── */

export const PAGE_SIZES = [25, 50, 100]

/**
 * Client paging over rows already in memory. The page snaps back into range
 * when the list shrinks (a filter or a refresh), so a table never shows an
 * empty page 7 of 2.
 */
export function usePager(rows, initialSize = 25) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(initialSize)
  const total = Array.isArray(rows) ? rows.length : 0
  const pageCount = Math.max(1, Math.ceil(total / size))
  const current = Math.min(page, pageCount)
  const pageRows = useMemo(
    () => (Array.isArray(rows) ? rows.slice((current - 1) * size, current * size) : []),
    [rows, current, size],
  )
  const changeSize = useCallback((n) => { setSize(n); setPage(1) }, [])
  return { page: current, setPage, size, setSize: changeSize, pageCount, total, pageRows }
}

export function Pager({ pager, label = 'rows' }) {
  const { page, setPage, pageCount, total, size, setSize } = pager
  if (!total) return null
  const from = (page - 1) * size + 1
  const to = Math.min(total, page * size)
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 pt-3" aria-label="Pagination">
      <span className="text-[11px] text-gray-500 tabular-nums">
        {from.toLocaleString()} to {to.toLocaleString()} of {total.toLocaleString()} {label}
      </span>
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-gray-500 inline-flex items-center gap-1">
          Per page
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}
            className={`bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-[11px] text-gray-300 ${FOCUS_RING}`}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <Btn size="xs" icon={ChevronLeft} onClick={() => setPage(page - 1)} disabled={page <= 1} aria-label="Previous page" />
        <span className="text-[11px] text-gray-400 tabular-nums">Page {page} of {pageCount}</span>
        <Btn size="xs" icon={ChevronRight} onClick={() => setPage(page + 1)} disabled={page >= pageCount} aria-label="Next page" />
      </div>
    </nav>
  )
}

/**
 * "What needs attention" - one callout per item, each with ONE action. Renders
 * nothing when the list is empty, so a quiet page stays quiet.
 */
export function AttentionList({ items = [], title = 'Needs attention' }) {
  const shown = items.filter(Boolean)
  if (!shown.length) return null
  const tone = { danger: 'border-red-800/40 bg-red-950/20', warning: 'border-amber-800/40 bg-amber-950/20', info: 'border-gray-800 bg-gray-900/50' }
  return (
    <section aria-label={title} className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{title}</p>
      <ul className="grid gap-2 md:grid-cols-2">
        {shown.map((it) => (
          <li key={it.key} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${tone[it.tone] || tone.info}`}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-200">{it.title}</p>
              {it.detail && <p className="text-[11px] text-gray-400 mt-0.5">{it.detail}</p>}
            </div>
            {it.action && <Btn size="xs" icon={it.actionIcon} onClick={it.action}>{it.actionLabel || 'Open'}</Btn>}
          </li>
        ))}
      </ul>
    </section>
  )
}
