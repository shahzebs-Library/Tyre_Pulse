import { AlertTriangle } from 'lucide-react'
import { canClose } from '../../lib/checklist/checklistMarks'
import { acknowledgedLabel } from '../../lib/closureWorkflow'

export const HINT_OPEN = 'Correct the fault and have the line re-marked, or send the sheet back for correction.'
export const HINT_ACKNOWLEDGED = 'Acknowledged. The fault is tracked as a corrective action.'
export const HINT_RESOLVED = 'Acknowledged. The fault was resolved through its corrective action.'
export const HINT_EXCEPTION = 'Closed by an approved exception.'

/**
 * The closing sentence under the fault list. An acknowledged sheet has already
 * been signed with the fault recorded, so telling the reader to correct it or
 * send it back is wrong advice: say where the fault now lives instead.
 */
export function blockingHint(submission) {
  const ack = submission ? acknowledgedLabel(submission) : null
  if (!ack) return HINT_OPEN
  if (ack.key === 'ack_exception') return HINT_EXCEPTION
  if (ack.key === 'ack_resolved') return HINT_RESOLVED
  return HINT_ACKNOWLEDGED
}

/**
 * What is still stopping this sheet being closed, named line by line.
 *
 * The rule is enforced in the database - guard_checklist_approval_stages refuses
 * an approval while a blocking mark remains - but a raw 22023 arriving AFTER
 * somebody has signed is not a usable answer. This is the same decision made
 * before the button is offered, and it names the exact lines, because "this
 * checklist cannot be closed" is useless without saying which item is wrong.
 *
 * A blocking mark never stops a sheet being SUBMITTED. A fault found on the last
 * item of the day must still be recordable; what must not happen is that fault
 * being signed off as done.
 *
 * Renders nothing when there is nothing outstanding.
 */
export default function BlockingMarksNotice({ template, answers, submission = null, className = '' }) {
  const { ok, blocking } = canClose(template, answers || {})
  if (ok) return null

  return (
    <div className={`rounded-xl border border-red-700/50 bg-red-500/[0.07] p-3 ${className}`}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-300">
            {blocking.length === 1
              ? 'One item is still marked as a fault, so this sheet cannot be closed.'
              : `${blocking.length} items are still marked as a fault, so this sheet cannot be closed.`}
          </p>
          <ul className="mt-2 space-y-1">
            {blocking.map((b) => (
              <li key={b.id} className="text-sm text-[var(--text-primary)] flex items-start gap-2">
                <span className="text-red-400 mt-0.5">-</span>
                <span className="min-w-0">
                  {b.label} <span className="text-red-300 font-medium">({b.value})</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            {blockingHint(submission)}
          </p>
        </div>
      </div>
    </div>
  )
}
