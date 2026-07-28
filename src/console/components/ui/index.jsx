/**
 * Console UI kit.
 *
 * Thirty-four console pages each hand-rolled their own cards, tables, tabs and
 * empty states, so no two looked alike and every new page started from nothing.
 * This is the shared vocabulary. Use it for anything new; move an old page over
 * when you are already editing it.
 *
 * TWO RULES THAT ARE NOT COSMETIC:
 *
 * 1. Stay inside the gray and orange class families. The light theme is built
 *    from attribute selectors in index.css (`html.light .console-root
 *    [class*="bg-gray-900"]` and friends), so a surface painted with slate or
 *    zinc would stay dark for anyone using light mode. Dark output is unchanged
 *    by those rules, which is why they are safe.
 *
 * 2. An empty state is not an error and a zero is not a blank. `EmptyState`
 *    takes a reason, because "no rows" and "we could not look" read identically
 *    on screen and mean opposite things.
 */
import { Loader2, Inbox, AlertTriangle, Search, X, ChevronDown } from 'lucide-react'

/* ── surfaces ─────────────────────────────────────────────────────────────── */

export function Panel({ children, className = '', flush = false, tone }) {
  const toneRing = tone === 'warning' ? 'border-amber-800/40'
    : tone === 'danger' ? 'border-red-800/40'
      : tone === 'accent' ? 'border-orange-800/40'
        : 'border-gray-800'
  return (
    <section className={`bg-gray-900/50 border ${toneRing} rounded-xl ${flush ? '' : 'p-4'} ${className}`}>
      {children}
    </section>
  )
}

export function PanelHeader({ icon: Icon, title, subtitle, actions, tone = 'default' }) {
  const iconTone = tone === 'warning' ? 'text-amber-400'
    : tone === 'danger' ? 'text-red-400' : 'text-orange-400'
  return (
    <header className="flex items-start gap-3 mb-3">
      {Icon && <Icon size={16} className={`${iconTone} mt-0.5 shrink-0`} />}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  )
}

/** A short explanatory note. Deliberately quiet: it explains, it does not warn. */
export function Note({ icon: Icon, children, tone = 'default' }) {
  const map = {
    default: 'bg-gray-900/50 border-gray-800 text-gray-400',
    accent: 'bg-orange-950/20 border-orange-800/40 text-gray-300',
    warning: 'bg-amber-950/25 border-amber-800/40 text-amber-200',
    danger: 'bg-red-950/25 border-red-800/40 text-red-200',
  }
  const iconTone = { default: 'text-gray-500', accent: 'text-orange-400', warning: 'text-amber-400', danger: 'text-red-400' }
  return (
    <div className={`flex items-start gap-2 text-xs border rounded-lg p-3 ${map[tone] || map.default}`}>
      {Icon && <Icon size={14} className={`${iconTone[tone] || iconTone.default} mt-0.5 shrink-0`} />}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

/* ── numbers ──────────────────────────────────────────────────────────────── */

const TILE_TONE = {
  default: 'text-gray-100',
  accent: 'text-orange-300',
  good: 'text-emerald-300',
  warning: 'text-amber-300',
  danger: 'text-red-300',
  muted: 'text-gray-400',
}

/**
 * One number with its meaning attached. `value` is rendered as given, so the
 * caller decides between "0" and "N/A" - the two are not interchangeable and
 * this component will not guess.
 */
export function StatTile({ label, value, sub, tone = 'default', icon: Icon, onClick, active }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`text-left bg-gray-900/50 border rounded-xl p-3 transition-colors w-full ${
        active ? 'border-orange-600/60 bg-orange-950/20' : 'border-gray-800'
      } ${onClick ? 'hover:border-gray-700 hover:bg-gray-900' : ''}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon size={12} className="text-gray-600" />}
        <p className="text-[11px] uppercase tracking-wide text-gray-500 truncate">{label}</p>
      </div>
      <p className={`text-xl font-semibold tabular-nums ${TILE_TONE[tone] || TILE_TONE.default}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{sub}</p>}
    </Tag>
  )
}

const SEG_TONE = {
  accent: 'bg-orange-500',
  good: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  muted: 'bg-gray-600',
}

/**
 * Proportions as a single bar. Reads at a glance in a way three numbers in a
 * row never do. Segments whose value rounds to nothing are dropped rather than
 * drawn as a sliver that cannot be seen or hovered.
 */
export function ProportionBar({ segments = [], total }) {
  const sum = Number(total) || segments.reduce((a, s) => a + (Number(s.value) || 0), 0)
  if (!sum) return <div className="h-1.5 rounded-full bg-gray-800" />
  const parts = segments
    .map((s) => ({ ...s, pct: ((Number(s.value) || 0) / sum) * 100 }))
    .filter((s) => s.pct >= 0.5)
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-800" role="img"
      aria-label={parts.map((p) => `${p.label} ${p.pct.toFixed(0)}%`).join(', ')}>
      {parts.map((p, i) => (
        <div key={i} title={`${p.label}: ${p.pct.toFixed(1)}%`}
          className={SEG_TONE[p.tone] || SEG_TONE.muted} style={{ width: `${p.pct}%` }} />
      ))}
    </div>
  )
}

const BADGE_TONE = {
  default: 'bg-gray-800 text-gray-300 border-gray-700',
  accent: 'bg-orange-500/15 text-orange-300 border-orange-700/50',
  good: 'bg-emerald-500/15 text-emerald-300 border-emerald-700/50',
  warning: 'bg-amber-500/15 text-amber-200 border-amber-700/50',
  danger: 'bg-red-500/15 text-red-300 border-red-700/50',
  info: 'bg-blue-500/15 text-blue-300 border-blue-700/50',
  quiet: 'bg-gray-900 text-gray-500 border-gray-800',
}

export function Badge({ children, tone = 'default', icon: Icon, title }) {
  return (
    <span title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap ${BADGE_TONE[tone] || BADGE_TONE.default}`}>
      {Icon && <Icon size={10} />}
      {children}
    </span>
  )
}

/** Monospaced identifier: an item code, a header name, a job card number. */
export function Code({ children, title }) {
  return (
    <span title={title} className="px-1.5 py-0.5 rounded bg-gray-800/80 font-mono text-[11px] text-gray-300">
      {children}
    </span>
  )
}

/* ── controls ─────────────────────────────────────────────────────────────── */

export function Btn({ children, onClick, variant = 'ghost', size = 'sm', icon: Icon, busy, disabled, title, type = 'button' }) {
  const variants = {
    primary: 'bg-orange-500 hover:bg-orange-400 text-black font-medium border-orange-500',
    good: 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600',
    danger: 'bg-red-600 hover:bg-red-500 text-white border-red-600',
    ghost: 'border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-800/60',
    quiet: 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/60',
  }
  const sizes = { xs: 'px-2 py-1 text-[11px]', sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} title={title}
      className={`rounded-lg border inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant] || variants.ghost} ${sizes[size] || sizes.sm}`}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : (Icon && <Icon size={13} />)}
      {children}
    </button>
  )
}

/**
 * Tabs with their counts on them. A tab whose count you cannot see until you
 * click it is a guess, and the count is usually the reason to click.
 */
export function Segmented({ options = [], value, onChange, size = 'sm' }) {
  const pad = size === 'md' ? 'px-3.5 py-2 text-sm' : 'px-3 py-1.5 text-xs'
  return (
    <div className="inline-flex flex-wrap gap-1 p-1 rounded-lg bg-gray-900/70 border border-gray-800">
      {options.map((o) => {
        const on = o.key === value
        return (
          <button key={o.key} onClick={() => onChange?.(o.key)} title={o.hint}
            className={`rounded-md inline-flex items-center gap-1.5 transition-colors ${pad} ${
              on ? 'bg-orange-500/20 text-orange-200 border border-orange-600/50'
                 : 'border border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/60'}`}>
            {o.label}
            {o.count != null && (
              <span className={`tabular-nums text-[10px] px-1 rounded ${on ? 'bg-orange-500/25' : 'bg-gray-800 text-gray-500'}`}>
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
      <input value={value} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder}
        className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none" />
      {value ? (
        <button onClick={() => onChange?.('')} title="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300">
          <X size={12} />
        </button>
      ) : null}
    </div>
  )
}

export function Select({ value, onChange, options = [], placeholder, disabled, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange?.(e.target.value)} disabled={disabled}
        className="w-full appearance-none pl-2.5 pr-7 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 disabled:opacity-50 focus:border-gray-700 focus:outline-none">
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
    </div>
  )
}

export function Toolbar({ children, className = '' }) {
  return <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>
}

/* ── table ────────────────────────────────────────────────────────────────── */

export function Table({ children, className = '' }) {
  return (
    <div className={`overflow-x-auto border border-gray-800 rounded-xl ${className}`}>
      <table className="w-full text-xs">{children}</table>
    </div>
  )
}

export function THead({ children }) {
  return (
    <thead className="bg-gray-900/90 text-gray-500 sticky top-0 z-10 backdrop-blur">
      <tr>{children}</tr>
    </thead>
  )
}

export function Th({ children, align = 'left', sortKey, sort, onSort, className = '' }) {
  const active = sortKey && sort?.key === sortKey
  const clickable = !!(sortKey && onSort)
  return (
    <th
      onClick={clickable ? () => onSort(sortKey) : undefined}
      className={`px-3 py-2 font-medium text-${align} ${clickable ? 'cursor-pointer select-none hover:text-gray-300' : ''} ${active ? 'text-orange-300' : ''} ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-[9px]">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  )
}

export function Tr({ children, onClick, className = '', tone }) {
  const toneCls = tone === 'warning' ? 'bg-amber-950/10' : ''
  return (
    <tr onClick={onClick}
      className={`border-t border-gray-800/70 align-top ${toneCls} ${onClick ? 'cursor-pointer hover:bg-gray-900/60' : 'hover:bg-gray-900/40'} ${className}`}>
      {children}
    </tr>
  )
}

export function Td({ children, align = 'left', className = '', colSpan, nowrap }) {
  return (
    <td colSpan={colSpan}
      className={`px-3 py-2 text-${align} ${nowrap ? 'whitespace-nowrap' : ''} ${className}`}>
      {children}
    </td>
  )
}

/* ── states ───────────────────────────────────────────────────────────────── */

export function LoadingState({ label = 'Loading', rows = 4 }) {
  return (
    <div className="py-6" role="status" aria-label={label}>
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-8 rounded-lg bg-gray-900/60 animate-pulse" style={{ opacity: 1 - i * 0.15 }} />
        ))}
      </div>
      <p className="text-xs text-gray-600 text-center mt-3">{label}...</p>
    </div>
  )
}

/**
 * Nothing to show. `reason` is required by convention rather than by the type
 * system: "no rows matched" and "we could not read this" look identical on
 * screen and mean opposite things, so the caller must say which it is.
 */
export function EmptyState({ icon: Icon = Inbox, title, reason, action }) {
  return (
    <div className="py-10 text-center">
      <Icon size={22} className="mx-auto text-gray-700 mb-2" />
      <p className="text-sm text-gray-400">{title}</p>
      {reason && <p className="text-xs text-gray-600 mt-1 max-w-md mx-auto">{reason}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-950/30 border border-red-800/50">
      <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
      <p className="text-xs text-red-300 flex-1">{message}</p>
      {onRetry && <Btn size="xs" onClick={onRetry}>Retry</Btn>}
    </div>
  )
}

/* ── overlay ──────────────────────────────────────────────────────────────── */

/**
 * A modal, because the global `.card` style sets overflow:hidden and clips
 * anything that tries to escape a panel. Overlays here are always fixed.
 */
export function Modal({ open, title, subtitle, onClose, children, footer, width = 'max-w-2xl' }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`w-full ${width} max-h-[88vh] flex flex-col rounded-xl bg-gray-950 border border-gray-800 shadow-2xl`}>
        <header className="flex items-start gap-3 px-5 py-3.5 border-b border-gray-800">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-800 shrink-0">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-gray-800">{footer}</footer>}
      </div>
    </div>
  )
}
