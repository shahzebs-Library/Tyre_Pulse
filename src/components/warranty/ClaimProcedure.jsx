import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, XCircle, Clock } from 'lucide-react'
import { listClaimEvents } from '../../lib/api/warranty'
import {
  CLAIM_FLOW, claimStepIndex, supplierWaitDays, SUPPLIER_WAIT_LIMIT_DAYS,
} from '../../lib/warrantyTrackerAnalytics'
import { formatDate } from '../../lib/formatters'
import { toUserMessage } from '../../lib/safeError'

function fmtWhen(iso) {
  if (!iso) return 'N/A'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Where a warranty claim sits in the procedure, and every status change it has
 * been through (recorded by the server, so it cannot be edited here).
 */
export default function ClaimProcedure({ claim }) {
  const [events, setEvents] = useState([])
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    if (!claim?.id) return undefined
    setState('loading')
    listClaimEvents(claim.id)
      .then(rows => { if (alive) { setEvents(rows); setState('ready') } })
      .catch(e => { if (alive) { setError(toUserMessage(e, 'Could not load the claim history.')); setState('error') } })
    return () => { alive = false }
  }, [claim?.id, claim?.claim_status])

  if (!claim) return null
  const rejected = claim.claim_status === 'Rejected'
  const current = claimStepIndex(claim.claim_status)
  const wait = supplierWaitDays(claim)

  return (
    <div className="space-y-3" aria-label="Claim procedure">
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {CLAIM_FLOW.map((f, i) => {
          const isRejectStep = rejected && i === current
          const done = i < current || (i === current && ['Closed', 'Credit Issued'].includes(claim.claim_status))
          const active = i === current && !done
          return (
            <li key={f.status} className="flex items-center gap-1.5">
              {isRejectStep ? <XCircle size={14} className="text-red-400" aria-hidden="true" />
                : done ? <CheckCircle2 size={14} className="text-emerald-400" aria-hidden="true" />
                  : active ? <Clock size={14} className="text-amber-400" aria-hidden="true" />
                    : <Circle size={14} className="text-[var(--text-muted)]" aria-hidden="true" />}
              <span className={active || isRejectStep ? 'font-semibold text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}>
                {isRejectStep ? 'Rejected by supplier' : f.step}
              </span>
              {i < CLAIM_FLOW.length - 1 && <span className="text-[var(--text-muted)]" aria-hidden="true">/</span>}
            </li>
          )
        })}
      </ol>

      {wait != null && (
        <p className={`text-xs ${wait > SUPPLIER_WAIT_LIMIT_DAYS ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
          Waiting on the supplier for {wait} day{wait === 1 ? '' : 's'}
          {wait > SUPPLIER_WAIT_LIMIT_DAYS ? ` (over the ${SUPPLIER_WAIT_LIMIT_DAYS}-day follow-up limit)` : ''}.
        </p>
      )}

      <div>
        <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">Status history</p>
        {state === 'loading' && <p className="text-xs text-[var(--text-muted)]">Loading...</p>}
        {state === 'error' && <p className="text-xs text-red-400" role="alert">{error}</p>}
        {state === 'ready' && events.length === 0 && (
          <p className="text-xs text-[var(--text-muted)]">No status changes recorded yet.</p>
        )}
        {state === 'ready' && events.length > 0 && (
          <ul className="space-y-1">
            {events.map(e => (
              <li key={e.id} className="text-xs text-[var(--text-dim)]">
                <span className="text-[var(--text-muted)]">{fmtWhen(e.changed_at)}</span>{' : '}
                {e.from_status ? `${e.from_status} to ${e.to_status}` : `Raised as ${e.to_status}`}
                {e.changed_by_name ? ` by ${e.changed_by_name}` : ''}
                {e.note ? ` (${e.note})` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
