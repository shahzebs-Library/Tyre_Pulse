/**
 * Small pieces shared by the Runtime screens (Database Center and Storage).
 * Kept in the gray / orange families so the console light theme applies.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toUserMessage } from '../../../lib/safeError'

/** Load one source. A failure keeps the message; it never turns into empty data. */
export function useLoad(fn, { auto = true } = {}) {
  const [state, setState] = useState({ data: null, error: '', loading: auto })
  const fnRef = useRef(fn)
  fnRef.current = fn
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const data = await fnRef.current()
      setState({ data, error: '', loading: false })
      return data
    } catch (e) {
      setState((s) => ({ data: s.data, error: toUserMessage(e, 'This could not be loaded.'), loading: false }))
      return null
    }
  }, [])
  useEffect(() => { if (auto) load() }, [auto, load])
  return { ...state, reload: load }
}

const CELL_TONE = { danger: 'text-red-400', warning: 'text-amber-300', good: 'text-emerald-400', muted: 'text-gray-500' }

/** The thin figures strip under the page header. */
export function StatusStrip({ cells = [], label = 'Status' }) {
  return (
    <section aria-label={label}
      className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-px rounded-xl overflow-hidden border border-gray-800 bg-gray-800">
      {cells.map((c) => (
        <div key={c.label} className="bg-gray-950 px-3 py-2.5 min-w-0">
          <p className="text-[10px] text-gray-500 truncate">{c.label}</p>
          <p className={`text-xs font-semibold truncate tabular-nums ${CELL_TONE[c.tone] || 'text-gray-200'}`} title={String(c.value)}>
            {c.value}{c.extra && <span className="ml-1 font-normal text-gray-500">{c.extra}</span>}
          </p>
          {c.sub && <p className="text-[10px] text-gray-500 truncate" title={c.sub}>{c.sub}</p>}
        </div>
      ))}
    </section>
  )
}

/** "Moved here from" chips: each old page is still one click away. */
export function MovedFrom({ items = [], note, icon: Icon }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {Icon && <Icon size={12} className="text-gray-500" aria-hidden="true" />}
      <span className="font-semibold text-gray-400">Moved here from:</span>
      {items.map((i) => (
        <Link key={i.label} to={i.to}
          className="px-1.5 py-0.5 rounded border border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
          {i.label}
        </Link>
      ))}
      {note && <span className="text-gray-500">{note}</span>}
    </div>
  )
}

/** Section tabs in a strip, deep-linked through ?tab=. */
export function SectionTabs({ tabs = [], value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label}
      className="flex gap-1 overflow-x-auto rounded-xl border border-gray-800 bg-gray-900/50 p-1.5">
      {tabs.map((t) => {
        const Icon = t.icon
        const on = t.key === value
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
              on ? 'bg-orange-500/15 text-orange-300 border border-orange-600/50 font-medium' : 'border border-transparent text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'}`}>
            {Icon && <Icon size={13} aria-hidden="true" />}{t.label}
            {t.count != null && <span className="tabular-nums text-[10px] px-1 rounded bg-gray-800 text-gray-400">{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

const BAR_TONE = { accent: 'bg-orange-500', warning: 'bg-amber-500', danger: 'bg-red-500', good: 'bg-emerald-500', info: 'bg-blue-500', muted: 'bg-gray-600' }

/** A small horizontal bar with its value to the right. */
export function BarCell({ pct, label, tone = 'info', width = 'w-24' }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`${width} h-1.5 rounded-full bg-gray-800 overflow-hidden shrink-0`} aria-hidden="true">
        <div className={`h-full ${BAR_TONE[tone] || BAR_TONE.info}`} style={{ width: `${p < 0.5 && p > 0 ? 0.5 : p}%` }} />
      </div>
      <span className="text-[11px] text-gray-300 tabular-nums whitespace-nowrap">{label}</span>
    </div>
  )
}

const DOT = { good: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-red-500', info: 'bg-blue-500', default: 'bg-gray-500' }

/** One row of a quiet list: dot, title, small line, right side. */
export function ListRow({ tone, title, sub, right, children }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${tone ? DOT[tone] || DOT.default : 'bg-transparent'}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-200 break-words">{title}</p>
        {sub && <p className="text-[11px] text-gray-500 break-words">{sub}</p>}
        {children}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </li>
  )
}

/** A row of small labelled figures inside a panel. */
export function MetricRow({ items = [] }) {
  return (
    <div className="grid gap-px border-t border-gray-800 bg-gray-800" style={{ gridTemplateColumns: `repeat(${items.length || 1}, minmax(0, 1fr))` }}>
      {items.map((m) => (
        <div key={m.label} className="bg-gray-950/40 px-4 py-3 min-w-0">
          <p className="text-[10px] text-gray-500 truncate">{m.label}</p>
          <p className={`text-base font-semibold tabular-nums ${CELL_TONE[m.tone] || 'text-gray-100'}`}>{m.value}</p>
          {m.sub && <p className="text-[10px] text-gray-500 truncate" title={m.sub}>{m.sub}</p>}
        </div>
      ))}
    </div>
  )
}

/** A panel footer line: quiet, explanatory. */
export function PanelFoot({ icon: Icon, children }) {
  return (
    <p className="flex items-start gap-2 px-4 py-2.5 text-[11px] text-gray-500 border-t border-gray-800">
      {Icon && <Icon size={12} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <span>{children}</span>
    </p>
  )
}
