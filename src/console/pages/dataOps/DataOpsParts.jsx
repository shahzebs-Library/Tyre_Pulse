/**
 * Small shared pieces for the Control Center DATA screens. Built on the console
 * kit so the light theme and the gray / orange rules apply.
 */
import { Link, useInRouterContext } from 'react-router-dom'
import { ArrowUpRight, Info } from 'lucide-react'
import { StatusStrip } from '../runtime/runtimeParts'

export { StatusStrip }

/**
 * The plain-English line under a control: what it changes and who is
 * affected. One shape everywhere so the answers do not drift.
 */
export function ImpactLine({ change, who, undo, className = '' }) {
  if (!change && !who && !undo) return null
  return (
    <p className={`flex items-start gap-1.5 text-[11px] text-gray-500 leading-relaxed ${className}`}>
      <Info size={11} className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
      <span className="min-w-0">
        {change && <><span className="font-semibold text-gray-400">What this changes:</span> {change} </>}
        {who && <><span className="font-semibold text-gray-400">Who is affected:</span> {who} </>}
        {undo && <><span className="font-semibold text-gray-400">Undo:</span> {undo}</>}
      </span>
    </p>
  )
}

const DOT = { danger: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-gray-500', good: 'bg-emerald-500' }

/** A quiet list of recent data changes, newest first. */
export function ActivityList({ items = [], empty = 'Nothing has been changed yet.', fmtTime }) {
  const inRouter = useInRouterContext()
  if (!items.length) return <p className="px-4 py-3 text-xs text-gray-400">{empty}</p>
  return (
    <ul className="divide-y divide-gray-800/70">
      {items.map((it) => (
        <li key={it.id} className="flex items-start gap-3 px-4 py-2.5">
          <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${DOT[it.tone] || DOT.info}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-200 break-words">{it.label}</p>
            <p className="text-[11px] text-gray-500 break-words">
              {[it.who, it.detail, it.reason ? `Reason: ${it.reason}` : null].filter(Boolean).join(' | ')}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap">{fmtTime ? fmtTime(it.at) : it.at}</p>
            {it.route && inRouter && (
              <Link to={it.route} className="inline-flex items-center gap-0.5 text-[11px] text-orange-400 hover:text-orange-300 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                Open <ArrowUpRight size={10} aria-hidden="true" />
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
