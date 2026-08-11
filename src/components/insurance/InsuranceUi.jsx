/**
 * Shared presentational primitives for the insurance portfolio surfaces.
 *
 * These are deliberately dumb: they take data and render it. Every number that
 * arrives as null renders "N/A" rather than 0, because a missing figure and a
 * figure of zero are different statements and the insurance file is full of the
 * former. Nothing here fetches, derives or guesses.
 *
 * Theme comes from the app tokens (var(--*)) so the panels read in light and
 * dark alike.
 */
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, RefreshCw, Search, Inbox, AlertTriangle } from 'lucide-react'
import { formatCurrency, formatDate } from '../../lib/formatters'

/** Number coercion that keeps "not recorded" distinct from zero. */
export function n(v) {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

export function money(v, ccy = 'SAR') {
  const x = n(v)
  return x == null ? 'N/A' : formatCurrency(x, ccy)
}

/**
 * Render the engine's sumMoney shape { total, currency, mixedCurrency, byCurrency,
 * counted, missing }. A mixed-currency total is printed per currency and NEVER
 * added together; nothing counted reads N/A rather than a confident zero.
 */
export function moneyOf(m, fallback = 'N/A') {
  if (!m) return fallback
  if (m.mixedCurrency) {
    const parts = Object.entries(m.byCurrency || {}).sort((a, b) => b[1] - a[1])
    return parts.length ? parts.map(([c, v]) => formatCurrency(v, c)).join(' + ') : fallback
  }
  if (m.total == null) return fallback
  return formatCurrency(m.total, m.currency || 'SAR')
}

/** "from 12 of 200 rows" - the basis line that keeps a total honest. */
export function moneyBasis(m, noun = 'row') {
  if (!m) return null
  if (m.counted === 0) return `No ${noun} carries a figure`
  if (m.missing > 0) return `From ${m.counted.toLocaleString()} of ${(m.counted + m.missing).toLocaleString()} ${noun}(s)`
  return `From all ${m.counted.toLocaleString()} ${noun}(s)`
}

export function count(v) {
  const x = n(v)
  return x == null ? 'N/A' : x.toLocaleString()
}

export function pct(v, digits = 1) {
  const x = n(v)
  return x == null ? 'N/A' : `${x.toFixed(digits)}%`
}

export function dateText(v, country = 'All') {
  if (!v) return 'N/A'
  return formatDate(v, country)
}

export function textOr(v, fallback = 'N/A') {
  const s = v == null ? '' : String(v).trim()
  return s ? s : fallback
}

/** Whole days from today to a date. Negative means it already passed. */
export function daysUntil(v) {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((a - b) / 86400000)
}

const TONE_CLASS = {
  neutral: 'border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-secondary)]',
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  bad: 'border-red-500/30 bg-red-500/10 text-red-300',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
}

export function Pill({ tone = 'neutral', children, title }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone] || TONE_CLASS.neutral}`}>
      {children}
    </span>
  )
}

/** Expiry chip that never invents a date: no date means "no period on file". */
export function ExpiryPill({ to }) {
  const d = daysUntil(to)
  if (d == null) return <Pill tone="neutral">No period on file</Pill>
  if (d < 0) return <Pill tone="bad">Expired {Math.abs(d)}d ago</Pill>
  if (d <= 30) return <Pill tone="warn">{d}d to expiry</Pill>
  if (d <= 90) return <Pill tone="info">{d}d to expiry</Pill>
  return <Pill tone="good">{d}d to expiry</Pill>
}

/** A KPI tile. `basis` states what the figure rests on; it is never optional noise. */
export function Kpi({ label, value, basis, tone = 'neutral', icon: Icon }) {
  const accent = tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300'
    : tone === 'good' ? 'text-emerald-300' : 'text-[var(--text-primary)]'
  return (
    <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--surface-1)] p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {Icon ? <Icon size={13} /> : null}
        <span>{label}</span>
      </div>
      <p className={`mt-1.5 text-xl font-semibold tabular-nums ${accent}`}>{value}</p>
      {basis ? <p className="mt-1 text-[11px] text-[var(--text-muted)]">{basis}</p> : null}
    </div>
  )
}

export function Fact({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-sm text-[var(--text-primary)]">{value}</p>
    </div>
  )
}

export function SectionCard({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-[var(--border-dim)] bg-[var(--surface-1)] p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title ? <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3> : null}
            {subtitle ? <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * The single loading / error / empty gate for these panels.
 * An unreadable feed says so and offers Retry; it never renders as "nothing".
 */
export function DataState({ loading, error, empty, emptyTitle, emptyHint, onRetry, children }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] p-10 text-sm text-[var(--text-secondary)]">
        <RefreshCw size={15} className="animate-spin" /> Loading...
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        <span className="flex items-center gap-2"><AlertTriangle size={15} /> {error}</span>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-md border border-red-400/40 px-2 py-1 text-red-200 hover:bg-red-500/20">
            <RefreshCw size={13} /> Retry
          </button>
        ) : null}
      </div>
    )
  }
  if (empty) {
    return (
      <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] p-10 text-center">
        <Inbox className="mx-auto mb-2 text-[var(--text-muted)]" size={26} />
        <p className="text-sm text-[var(--text-secondary)]">{emptyTitle || 'Nothing to show.'}</p>
        {emptyHint ? <p className="mt-1 text-xs text-[var(--text-muted)]">{emptyHint}</p> : null}
      </div>
    )
  }
  return children
}

export function SearchBox({ value, onChange, placeholder = 'Search' }) {
  return (
    <div className="relative min-w-[200px] flex-1">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--border-dim)] bg-[var(--input-bg,var(--surface-2))] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-emerald-500 focus:outline-none"
      />
    </div>
  )
}

export function Picker({ label, value, onChange, options }) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
      <span className="whitespace-nowrap">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--border-dim)] bg-[var(--input-bg,var(--surface-2))] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

export function ToolButton({ onClick, icon: Icon, children, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-dim)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-2)] disabled:opacity-50"
    >
      {Icon ? <Icon size={14} /> : null}{children}
    </button>
  )
}

/** Build the distinct non-blank values of a field as picker options. */
export function optionsFrom(rows, field, allLabel = 'All') {
  const set = new Set()
  for (const r of rows || []) {
    const v = r?.[field]
    if (v != null && String(v).trim()) set.add(String(v).trim())
  }
  return [{ value: '', label: allLabel }, ...[...set].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }))]
}

/**
 * Compact sortable table. Columns: { key, header, render?, align?, sortValue?, width? }.
 * Sorting is client side over rows already filtered by the caller; a null sorts
 * last in both directions so "not recorded" never masquerades as the smallest value.
 */
export function SortTable({ columns, rows, rowKey = 'id', maxHeight = '28rem', onRowClick, footer }) {
  const [sort, setSort] = useState({ key: null, dir: 'asc' })

  const sorted = useMemo(() => {
    if (!sort.key) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const val = (r) => (col.sortValue ? col.sortValue(r) : r?.[col.key])
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = val(a); const y = val(b)
      const xn = x === null || x === undefined || x === ''
      const yn = y === null || y === undefined || y === ''
      if (xn && yn) return 0
      if (xn) return 1
      if (yn) return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  }, [rows, sort, columns])

  function toggle(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-dim)]">
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
            <tr>
              {columns.map((c) => {
                const active = sort.key === c.key
                const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={`whitespace-nowrap border-b border-[var(--border-dim)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    <button type="button" onClick={() => toggle(c.key)} className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${c.align === 'right' ? 'flex-row-reverse' : ''}`}>
                      {c.header}
                      <Icon size={12} className={active ? 'text-emerald-400' : 'opacity-40'} />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={r?.[rowKey] ?? i}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`border-b border-[var(--border-dim)] last:border-0 ${i % 2 ? 'bg-[var(--surface-2)]/40' : ''} ${onRowClick ? 'cursor-pointer hover:bg-[var(--surface-2)]' : ''}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 align-top text-[var(--text-secondary)] ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {c.render ? c.render(r) : textOr(r?.[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer ? <tfoot className="sticky bottom-0 bg-[var(--surface-2)]">{footer}</tfoot> : null}
        </table>
      </div>
    </div>
  )
}

/** A horizontal magnitude bar list. Values are shown, never only implied. */
export function BarList({ rows, colorAt, formatValue, emptyText = 'Nothing recorded.' }) {
  const max = Math.max(0, ...rows.map((r) => n(r.value) || 0))
  if (!rows.length) return <p className="text-sm text-[var(--text-muted)]">{emptyText}</p>
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const v = n(r.value) || 0
        const w = max > 0 ? Math.max(2, (v / max) * 100) : 0
        return (
          <div key={r.label ?? i}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-[var(--text-secondary)]" title={r.label}>{textOr(r.label)}</span>
              <span className="shrink-0 tabular-nums text-[var(--text-primary)]">
                {formatValue ? formatValue(r) : count(r.value)}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div className="h-full rounded-full" style={{ width: `${w}%`, background: colorAt ? colorAt(i) : 'var(--accent)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
