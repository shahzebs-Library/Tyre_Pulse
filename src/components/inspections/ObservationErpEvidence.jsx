import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { findObservationErpEvidence, confirmObservationErpLink, rejectObservationErpSuggestion, getObservationErpLink } from '../../lib/api/observationErpEvidence'
import { toUserMessage } from '../../lib/safeError'

/**
 * Evidence lookup is user-triggered, read-only and scoped to one tyre.
 * Candidate confirmation is an explicit, elevated RPC action with a review note.
 */
export default function ObservationErpEvidence({ observation }) {
  const [state, setState] = useState({ status: 'idle', candidates: [], evidenceLimited: false, error: '' })
  const [linked, setLinked] = useState(null)
  const [note, setNote] = useState('')
  const [working, setWorking] = useState('')
  const [notice, setNotice] = useState('')
  const inspection = observation?.row
  const actionId = observation?.actionRecord?.id

  useEffect(() => {
    let live = true
    setState({ status: 'idle', candidates: [], evidenceLimited: false, error: '' })
    setNotice(''); setNote(''); setLinked(null)
    if (actionId) getObservationErpLink(actionId).then((res) => { if (live) setLinked(res) })
      .catch(() => { if (live) setNotice('Could not verify existing ERP linkage. Confirmation is unavailable.') })
    return () => { live = false }
  }, [observation?.key, actionId])

  if (!inspection?.country || !observation?.rawPosition) return (
    <p className="iw-od-muted">ERP matching requires a saved inspection with a country and tyre position.</p>
  )

  async function lookup() {
    setState({ status: 'loading', candidates: [], evidenceLimited: false, error: '' })
    try {
      const result = await findObservationErpEvidence({ inspection, finding: observation })
      setState({ status: 'ready', ...result, error: '' })
    } catch (error) {
      setState({ status: 'error', candidates: [], evidenceLimited: false, error: toUserMessage(error) })
    }
  }

  async function decide(candidate, decision) {
    if (!actionId || note.trim().length < 5) return
    const id = candidate.workOrder.id
    setWorking(id); setNotice('')
    try {
      if (decision === 'confirm') {
        await confirmObservationErpLink({ actionId, workOrderId: id, note })
        setLinked(await getObservationErpLink(actionId))
        setNotice('Job card linked for audit review. The corrective action remains open until separately verified.')
      } else {
        await rejectObservationErpSuggestion({ actionId, workOrderId: id, note })
        setNotice('Candidate rejected and decision recorded. Other evidence remains available.')
      }
    } catch (error) { setNotice(toUserMessage(error)) }
    finally { setWorking('') }
  }

  return (
    <section className="iw-od-block" aria-label="ERP job card reconciliation">
      <h4>ERP evidence and job card</h4>
      <p className="iw-od-muted">Look up imported job cards, tyre consumption and expense records for this vehicle. Only an authorised reviewer can confirm a matching job card.</p>
      {linked && <div className="iw-od-now good">
        <strong>ERP job card confirmed: {linked.source_job_card}</strong>
        <p>Confirmed {linked.reviewed_at ? new Date(linked.reviewed_at).toLocaleString() : ''}. This does not close the corrective action.</p>
        <Link to="/actions" className="cc-link">Review corrective action</Link>
      </div>}
      <button type="button" className="cc-btn" onClick={lookup} disabled={state.status === 'loading'}>
        {state.status === 'loading' ? 'Checking ERP evidence...' : state.status === 'ready' ? 'Refresh ERP evidence' : 'Find matching ERP job cards'}
      </button>
      {state.error && <p role="alert" className="text-sm text-red-500">{state.error}</p>}
      {state.status === 'ready' && (
        <>
          {state.evidenceLimited && <p role="alert" className="text-sm text-amber-500">ERP result limit reached. This search may be incomplete. Do not confirm from a truncated evidence set.</p>}
          {!state.candidates.length && <p className="iw-od-muted">No imported job cards found for this asset and country. Check intake history or review another work date.</p>}
          {state.candidates.length > 0 && (
            <div className="space-y-3 mt-3">
              {state.candidates.map(c => (
                <div key={c.workOrder.id} className="rounded-xl border border-[var(--border)] p-3 space-y-2">
                  <strong>{c.workOrder.work_order_no}</strong>
                  <p className="text-sm text-[var(--text-secondary)]">{c.workOrder.description || 'No ERP work description'} | {c.workOrder.status || 'No status'}</p>
                  <p className="text-xs">{c.evidenceSummary.tyreRows} tyre records, {c.evidenceSummary.expenseRows} expense lines, {c.evidenceSummary.workDayGap ?? 'Unknown'} days from inspection</p>
                  {c.reasons.map(r => <p key={r} className="text-xs text-[var(--text-secondary)]">Evidence: {r}</p>)}
                  {c.conflicts.map(r => <p key={r} className="text-xs text-red-500">Conflict: {r}</p>)}
                  {c.status === 'insufficient' && <p className="text-xs text-amber-500">Insufficient evidence for confirmation.</p>}
                  {actionId && !linked && (
                    <div className="space-y-2">
                      <label className="block text-xs">Review reason
                        <textarea className="input w-full" rows={2} maxLength={2000} value={note}
                          onChange={e => setNote(e.target.value)} placeholder="Explain how this job card resolves this tyre finding" />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="cc-btn-primary"
                          disabled={!!working || state.evidenceLimited || !c.eligibleToConfirm || note.trim().length < 5}
                          onClick={() => decide(c, 'confirm')}>Confirm job card</button>
                        <button type="button" className="cc-btn" disabled={!!working || note.trim().length < 5}
                          onClick={() => decide(c, 'reject')}>Reject match</button>
                      </div>
                    </div>
                  )}
                  {!actionId && <p className="text-xs text-[var(--text-muted)]">Raise a corrective action first to confirm and link ERP evidence.</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </section>
  )
}
