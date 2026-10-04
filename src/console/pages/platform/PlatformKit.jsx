/**
 * Small shared pieces for the Control Center PLATFORM screens (Users, User
 * detail, Organizations, Billing, Settings). Built on the console kit so the
 * light theme and the gray / orange rules apply.
 */
import { Link } from 'react-router-dom'
import { CornerDownRight, ArrowUpRight, Scale } from 'lucide-react'
import { Btn } from '../../components/ui'

/** "Moved here from" line: which old pages live on this screen now. */
export function MovedHere({ from = [], children }) {
  return (
    <div className="flex items-start gap-2 text-[11px] text-gray-400 border border-dashed border-gray-800 rounded-lg px-3 py-2">
      <CornerDownRight size={13} className="text-gray-500 mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0">
        <span className="font-semibold text-gray-300">Moved here from: </span>
        {from.join(', ')}.{children ? <> {children}</> : null}
      </p>
    </div>
  )
}

const TONE_DOT = {
  danger: 'bg-red-500', warning: 'bg-amber-500', accent: 'bg-orange-500', info: 'bg-gray-500', good: 'bg-emerald-500', muted: 'bg-gray-600',
}

/** Needs-attention strip: one card per real problem, each with one action. */
export function AttentionStrip({ title = 'Needs attention', subtitle, items = [], onAction, empty = 'Nothing needs attention right now.' }) {
  return (
    <section className="bg-gray-900/50 border border-gray-800 rounded-xl" aria-label={title}>
      <header className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
        {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
      </header>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-400">{empty}</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-gray-800">
          {items.map((it) => (
            <li key={it.key} className="p-4 flex flex-col gap-1.5 min-w-0">
              <p className="flex items-start gap-2 text-xs font-semibold text-gray-200">
                <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${TONE_DOT[it.tone] || TONE_DOT.info}`} aria-hidden="true" />
                <span>{it.title}</span>
              </p>
              <p className="text-[11px] text-gray-400 leading-relaxed">{it.body}</p>
              <div className="mt-auto pt-1 flex flex-wrap items-center gap-2">
                {it.to ? (
                  <Link to={it.to} className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-400 hover:text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded">
                    {it.action} <ArrowUpRight size={11} aria-hidden="true" />
                  </Link>
                ) : it.action ? (
                  <Btn size="xs" onClick={() => onAction?.(it)}>{it.action}</Btn>
                ) : null}
                {it.decision && <DecisionTag />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Marks something that waits on the owner, not on code. */
export function DecisionTag({ label = 'Needs owner decision' }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-amber-800/40 bg-amber-950/25 text-amber-300">
      <Scale size={10} aria-hidden="true" /> {label}
    </span>
  )
}

/** Compact status pill with a dot. */
export function Pill({ tone = 'muted', children, title }) {
  const map = {
    good: 'text-emerald-300 bg-emerald-950/30 border-emerald-800/40',
    danger: 'text-red-300 bg-red-950/30 border-red-800/40',
    warning: 'text-amber-300 bg-amber-950/25 border-amber-800/40',
    accent: 'text-orange-300 bg-orange-950/25 border-orange-800/40',
    info: 'text-gray-300 bg-gray-900 border-gray-700',
    muted: 'text-gray-400 bg-gray-900 border-gray-800',
  }
  return (
    <span title={title} className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${map[tone] || map.muted}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone] || TONE_DOT.muted}`} aria-hidden="true" />
      {children}
    </span>
  )
}

/** Tab strip that reads like the mockups (underline + count). */
export function PageTabs({ tabs = [], value, onChange, label = 'Sections' }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-gray-800 -mx-1 px-1">
      {tabs.map((t) => {
        const on = t.key === value
        const Icon = t.icon
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-t ${
              on ? 'border-orange-500 text-gray-100' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {Icon && <Icon size={13} aria-hidden="true" />}
            {t.label}
            {t.count != null && <span className={`text-[10px] px-1.5 rounded ${t.countTone === 'danger' ? 'bg-red-950/40 text-red-300' : 'bg-gray-800 text-gray-400'}`}>{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** A label / value fact list where empty values say "Not recorded". */
export function Facts({ rows = [] }) {
  return (
    <dl className="divide-y divide-gray-800/60">
      {rows.map(([k, v, hint]) => (
        <div key={k} className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-xs">
          <dt className="text-gray-500">{k}</dt>
          <dd className="text-gray-200 break-words">
            {v === null || v === undefined || v === '' ? <span className="text-gray-500">Not recorded</span> : v}
            {hint && <span className="text-gray-500"> {hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function fmtNum(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return 'N/A'
  return Number(v).toLocaleString('en-US')
}
