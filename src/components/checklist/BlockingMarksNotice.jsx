import { AlertTriangle } from 'lucide-react'
import { canClose } from '../../lib/checklist/checklistMarks'
import { acknowledgedLabel } from '../../lib/closureWorkflow'
import { useLanguage } from '../../contexts/LanguageContext'

/** Where the sheet stands: still in approval, or signed with the fault recorded. */
export const STATUS_OPEN = 'open'
export const STATUS_ACKNOWLEDGED = 'acknowledged'
export const STATUS_RESOLVED = 'resolved'
export const STATUS_EXCEPTION = 'exception'

export function blockingStatus(submission) {
  const ack = submission ? acknowledgedLabel(submission) : null
  if (!ack) return STATUS_OPEN
  if (ack.key === 'ack_exception') return STATUS_EXCEPTION
  if (ack.key === 'ack_resolved') return STATUS_RESOLVED
  return STATUS_ACKNOWLEDGED
}

/**
 * The heading over the fault list. Only a sheet still in approval "cannot be
 * closed"; an acknowledged or compliant-by-exception sheet has already been
 * signed, so saying it cannot be closed contradicts the badge beside it.
 * Literal keys on purpose, so the i18n coverage test can see every one.
 */
export function blockingHeading(t, status, n) {
  const one = n === 1
  if (status === STATUS_EXCEPTION) return one ? t('closure.blocking.exceptionOne') : t('closure.blocking.exceptionMany', { n })
  if (status === STATUS_RESOLVED) return one ? t('closure.blocking.resolvedOne') : t('closure.blocking.resolvedMany', { n })
  if (status === STATUS_ACKNOWLEDGED) return one ? t('closure.blocking.acknowledgedOne') : t('closure.blocking.acknowledgedMany', { n })
  return one ? t('closure.blocking.openOne') : t('closure.blocking.openMany', { n })
}

/**
 * The closing sentence under the fault list. An acknowledged sheet has already
 * been signed with the fault recorded, so telling the reader to correct it or
 * send it back is wrong advice: say where the fault now lives instead.
 */
export function blockingHint(t, status) {
  if (status === STATUS_EXCEPTION) return t('closure.blocking.hintException')
  if (status === STATUS_RESOLVED) return t('closure.blocking.hintResolved')
  if (status === STATUS_ACKNOWLEDGED) return t('closure.blocking.hintAcknowledged')
  return t('closure.blocking.hintOpen')
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
  const { t } = useLanguage()
  const { ok, blocking } = canClose(template, answers || {})
  if (ok) return null
  const status = blockingStatus(submission)
  const open = status === STATUS_OPEN

  return (
    <div data-status={status} className={`rounded-xl border p-3 ${open ? 'border-red-700/50 bg-red-500/[0.07]' : 'border-amber-700/40 bg-amber-500/[0.06]'} ${className}`}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${open ? 'text-red-400' : 'text-amber-400'}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${open ? 'text-red-300' : 'text-amber-300'}`}>
            {blockingHeading(t, status, blocking.length)}
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
            {blockingHint(t, status)}
          </p>
        </div>
      </div>
    </div>
  )
}
