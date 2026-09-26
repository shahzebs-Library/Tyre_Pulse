/**
 * AttentionList - "what needs attention" callouts, each with exactly one
 * action. An empty list renders the `clear` line so "nothing is wrong" is a
 * statement, not a missing panel.
 */
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { Btn } from '../../components/ui'
import ConsoleLink from './ConsoleLink'

const TONE = {
  danger: { cls: 'border-red-800/50 bg-red-950/20', Icon: AlertTriangle, ic: 'text-red-400', word: 'Urgent' },
  warning: { cls: 'border-amber-800/50 bg-amber-950/20', Icon: AlertTriangle, ic: 'text-amber-400', word: 'Review' },
  info: { cls: 'border-gray-800 bg-gray-900/40', Icon: Info, ic: 'text-gray-400', word: 'Note' },
}

export default function AttentionList({ items = [], clear = 'Nothing needs attention right now.', title = 'Needs attention' }) {
  if (!items.length) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 px-3 py-2 rounded-lg border border-gray-800 bg-gray-900/40">
        <CheckCircle2 size={14} className="text-emerald-400 shrink-0" aria-hidden="true" /> {clear}
      </div>
    )
  }
  return (
    <section aria-label={title} className="space-y-1.5">
      {items.map((a) => {
        const t = TONE[a.tone] || TONE.info
        return (
          <div key={a.key} className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border ${t.cls}`}>
            <t.Icon size={14} className={`${t.ic} shrink-0`} aria-hidden="true" />
            <span className="sr-only">{t.word}: </span>
            <span className="text-xs text-gray-200 flex-1 min-w-0 break-words">{a.text}</span>
            {a.action?.to
              ? <ConsoleLink to={a.action.to} icon={a.action.icon}>{a.action.label}</ConsoleLink>
              : a.action && <Btn size="xs" onClick={a.action.onClick} icon={a.action.icon}>{a.action.label}</Btn>}
          </div>
        )
      })}
    </section>
  )
}
