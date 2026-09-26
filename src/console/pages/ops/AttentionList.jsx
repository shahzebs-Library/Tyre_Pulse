/**
 * AttentionList - "what needs attention", worst first, one action each. When
 * nothing needs attention it says so plainly; when the data could not be read
 * the caller passes `unknown` so a failed read never reads as "all clear".
 */
import { AlertTriangle, CheckCircle2, HelpCircle, Info, XCircle } from 'lucide-react'
import { Btn, Panel, PanelHeader } from '../../components/ui'

const TONE = {
  danger: { icon: XCircle, cls: 'text-red-400' },
  warning: { icon: AlertTriangle, cls: 'text-amber-400' },
  info: { icon: Info, cls: 'text-gray-400' },
}

export default function AttentionList({ items = [], unknown, clearText = 'Nothing needs attention right now.', title = 'Needs attention', subtitle }) {
  return (
    <Panel>
      <PanelHeader icon={AlertTriangle} title={title} subtitle={subtitle} tone={items.some((i) => i.tone === 'danger') ? 'danger' : 'default'} />
      {items.length === 0 ? (
        unknown ? (
          <p className="flex items-center gap-2 text-xs text-gray-400"><HelpCircle size={14} className="text-gray-500" aria-hidden="true" />{unknown}</p>
        ) : (
          <p className="flex items-center gap-2 text-xs text-gray-400"><CheckCircle2 size={14} className="text-emerald-400" aria-hidden="true" />{clearText}</p>
        )
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => {
            const t = TONE[it.tone] || TONE.info
            const Icon = t.icon
            return (
              <li key={it.key || i} className="flex items-start gap-2.5 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
                <Icon size={14} className={`${t.cls} mt-0.5 shrink-0`} aria-hidden="true" />
                <div className="flex-1 min-w-0 text-xs">
                  <p className="text-gray-200 break-words">{it.title}</p>
                  {it.detail && <p className="text-gray-500 mt-0.5 break-words">{it.detail}</p>}
                </div>
                {it.action && <Btn size="xs" onClick={it.action.onClick}>{it.action.label}</Btn>}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
