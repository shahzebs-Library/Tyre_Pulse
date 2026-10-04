/**
 * ImpactBox + ConfirmImpactDialog - the console's one way of saying what an
 * action will do before it does it.
 *
 * Every risky control in the Control Center answers the same three questions
 * in plain English: what will change, who is affected, and can it be undone.
 * Putting that in one component is what keeps the answers from drifting into
 * a different shape on every screen.
 *
 * Colours stay in the gray / orange / red / amber families so the console
 * light theme applies (see the kit rules in ./index.jsx).
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { Modal, Btn } from './index'

const TONES = {
  info: { wrap: 'bg-gray-900/50 border-gray-800', icon: Info, iconClass: 'text-orange-400' },
  warning: { wrap: 'bg-amber-950/25 border-amber-800/40', icon: AlertTriangle, iconClass: 'text-amber-400' },
  danger: { wrap: 'bg-red-950/25 border-red-800/40', icon: ShieldAlert, iconClass: 'text-red-400' },
}

/**
 * @param {object} p
 * @param {string} [p.what]    one line: the action in plain words
 * @param {string} [p.change]  what will change
 * @param {string} [p.who]     who is affected
 * @param {string} [p.undo]    whether and how it can be undone
 * @param {'info'|'warning'|'danger'} [p.tone]
 * @param {Array<{label:string,value:any}>} [p.stats]  optional measured numbers
 */
export default function ImpactBox({ what, change, who, undo, tone = 'info', stats }) {
  const t = TONES[tone] || TONES.info
  const Icon = t.icon
  const rows = [
    ['What will change', change],
    ['Who is affected', who],
    ['Can it be undone', undo],
  ].filter(([, v]) => v)
  return (
    <div className={`border rounded-lg p-3 text-xs ${t.wrap}`} role="note" aria-label="Impact of this action">
      {what && (
        <p className="flex items-start gap-2 text-gray-200 font-medium mb-2">
          <Icon size={14} className={`${t.iconClass} mt-0.5 shrink-0`} aria-hidden="true" />
          <span>{what}</span>
        </p>
      )}
      {Array.isArray(stats) && stats.length > 0 && (
        <div className="grid grid-cols-3 gap-px rounded-lg overflow-hidden border border-gray-800 mb-2">
          {stats.map((s) => (
            <div key={s.label} className="bg-gray-900/60 px-2.5 py-2">
              <p className="text-[10px] text-gray-500">{s.label}</p>
              <p className="text-sm font-semibold text-gray-100 tabular-nums">{s.value === null || s.value === undefined ? 'N/A' : s.value}</p>
            </div>
          ))}
        </div>
      )}
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-2">
            <dt className="text-gray-500">{k}</dt>
            <dd className="text-gray-300 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * A confirm dialog built around ImpactBox. Optional reason (written to the
 * audit log by the caller) and optional typed confirmation word.
 */
export function ConfirmImpactDialog({
  open, title, impact, confirmLabel = 'Confirm', onCancel, onConfirm,
  requireReason = false, typedWord, busy = false, error, danger = false, children, readyExtra = true,
}) {
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  useEffect(() => { if (open) { setReason(''); setTyped('') } }, [open])
  const reasonOk = !requireReason || reason.trim().length >= 3
  const typedOk = !typedWord || typed.trim() === typedWord
  const ready = reasonOk && typedOk && !busy && readyExtra !== false
  return (
    <Modal open={open} title={title} onClose={busy ? () => {} : onCancel} width="max-w-lg"
      footer={(<>
        <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
        <Btn variant={danger ? 'danger' : 'primary'} busy={busy} disabled={!ready} onClick={() => onConfirm?.({ reason: reason.trim() })}>{confirmLabel}</Btn>
      </>)}>
      <div className="space-y-3">
        {impact && <ImpactBox {...impact} />}
        {children}
        {requireReason && (
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-400 mb-1">Reason (goes to the audit log)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off"
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              placeholder="Why are you doing this?" />
          </label>
        )}
        {typedWord && (
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-400 mb-1">Type <span className="font-mono text-gray-200">{typedWord}</span> to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs font-mono text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              aria-label={`Type ${typedWord} to confirm`} />
          </label>
        )}
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      </div>
    </Modal>
  )
}
