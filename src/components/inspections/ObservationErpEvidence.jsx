import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ClipboardCheck, FileSearch, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  findObservationErpEvidence, confirmObservationErpLink, rejectObservationErpSuggestion,
  getObservationErpLink, listObservationErpDecisions, getObservationErpReviewState, isErpReviewNotProvisioned,
  erpDecisionMessage, ERP_DECISIONS_UNAVAILABLE_MESSAGE,
} from '../../lib/api/observationErpEvidence'
import { toUserMessage } from '../../lib/safeError'
import { detectConfirmedErpDrift } from '../../lib/erpObservationMatch'

const empty = () => ({ status: 'loading', candidates: [], orphanTyreJobCards: [], evidenceLimited: false, error: '' })
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Date not recorded'

function Candidate({ candidate, actionId, linked, limited, stale, blocked, onDecide, busy }) {
  const [expanded, setExpanded] = useState(false)
  const [reason, setReason] = useState('')
  const [review, setReview] = useState(false)
  const { workOrder: wo, evidenceSummary: evidence, eligibleToConfirm } = candidate
  const viable = eligibleToConfirm && !limited
  // The wheel could not be established on this vehicle (ambiguous, missing or
  // inconsistent position). It is neither a match nor a mismatch.
  const manual = candidate.status === 'manual_review'
  return (
    <article className="rounded-xl border border-[var(--border)] p-3.5 space-y-2.5">
      <div className="flex flex-wrap justify-between gap-2 items-start">
        <div className="min-w-0">
          <p className="font-semibold text-sm">{wo.work_order_no}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {fmtDate(wo.completed_at || wo.opened_at)} · {wo.status || 'Status not recorded'}
          </p>
        </div>
        <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${viable ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
          {viable ? 'Ready for engineer review' : manual ? 'Pending manual review' : 'Needs more evidence'}
        </span>
      </div>
      <p className="text-sm leading-relaxed">{wo.description || 'Work description not recorded'}</p>
      {manual && <p className="text-xs text-amber-600" role="status">
        The wheel could not be matched on this vehicle, so this job card cannot be confirmed here. It stays pending manual review.
      </p>}
      {candidate.serialExceptionPossible && <p className="text-xs text-[var(--text-secondary)]">
        The observed tyre serial is on this job card. A serial alone does not confirm the work. A documented exception needs two people: one reviewer asks for it and a different, separately authorised person approves it.
      </p>}
      {evidence.canonicalPosition && <p className="text-xs text-[var(--text-secondary)]">Wheel on this vehicle: {evidence.canonicalPosition}</p>}
      <div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
        <span>{evidence.tyreRows} tyre movement{evidence.tyreRows === 1 ? '' : 's'}</span>
        <span aria-hidden="true">·</span>
        <span>{evidence.expenseRows} expense line{evidence.expenseRows === 1 ? '' : 's'}</span>
      </div>
      <button type="button" onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded} className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)]">
        <ChevronDown size={13} className={expanded ? 'rotate-180' : ''} aria-hidden="true" />
        {expanded ? 'Hide supporting evidence' : 'Review supporting evidence'}
      </button>
      {expanded && <div className="space-y-2 rounded-lg bg-[var(--surface-secondary,var(--surface))] p-3 text-xs">
        {candidate.reasons.map((r,i) => <p key={i} className="text-[var(--text-secondary)]">✓ {r}</p>)}
        {candidate.conflicts.map((r,i) => <p key={i} className="text-amber-600">{r}</p>)}
        {(candidate.notes || []).map((r,i) => <p key={`n${i}`} className="text-[var(--text-secondary)]">Note: {r}</p>)}
        {candidate.fitments?.map(f => <p key={f.id}>Tyre {f.serial_no || 'serial not recorded'} · {f.tyre_position || f.position || 'position missing'} · {fmtDate(f.removal_date || f.issue_date)}</p>)}
        {candidate.expenses?.length > 0 && <details>
          <summary className="cursor-pointer">Expense line details ({candidate.expenses.length})</summary>
          <div className="mt-2 space-y-1">
            {candidate.expenses.map(e => <p key={e.id}>{e.item_description || 'Unclassified'} · Qty {e.qty ?? 'N/A'} · Tyre {e.tyre_amount ?? 'N/A'} · Spare parts {e.spare_parts_amount ?? 'N/A'}</p>)}
          </div>
        </details>}
      </div>}
      {!linked && actionId && !blocked && <div className="space-y-2">
        {viable && !stale && <button type="button" className="cc-btn-primary"
          onClick={() => setReview(v => !v)} disabled={!!busy}>Review and link job card</button>}
        {review && <div className="border-t border-[var(--border)] pt-3 space-y-2">
          <label className="text-xs font-medium block" htmlFor={`erp-reason-${wo.id}`}>Why does this job card resolve the tyre issue?</label>
          <textarea id={`erp-reason-${wo.id}`} value={reason} rows={3} maxLength={2000}
            onChange={e => setReason(e.target.value)} placeholder="Confirm tyre position, movement date and evidence reviewed..."
            className="input w-full" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="cc-btn-primary"
              disabled={!viable || stale || !!busy || reason.trim().length < 5}
              onClick={() => onDecide(candidate, 'confirm', reason)}>Confirm this job card</button>
            <button type="button" className="cc-btn" disabled={!!busy || reason.trim().length < 5}
              onClick={() => onDecide(candidate, 'reject', reason)}>Reject with reason</button>
          </div>
        </div>}
      </div>}
      {!actionId && viable && <p className="text-xs text-[var(--text-secondary)]">Raise a corrective action before linking the job card.</p>}
    </article>
  )
}

export default function ObservationErpEvidence({ observation }) {
  const inspection = observation?.row
  const actionId = observation?.actionRecord?.id
  const [result, setResult] = useState(empty)
  const [linked, setLinked] = useState(null)
  const [history, setHistory] = useState([])
  const [linkError, setLinkError] = useState('')
  // False when the review tables and functions are not in the database yet.
  const [provisioned, setProvisioned] = useState(true)
  // Whether the database runs the same validated matching rules as this screen. Until that
  // is known to be true, no decision is offered.
  const [decisions, setDecisions] = useState({ available: false, reason: 'checking' })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [stale, setStale] = useState(false)
  const request = useRef(0)
  const valid = !!(inspection?.country && inspection?.asset_no && observation?.rawPosition)
  const lookUp = useCallback(async () => {
    if (!valid) return
    const token = ++request.current
    setResult(empty())
    setStale(false)
    try {
      const data = await findObservationErpEvidence({ inspection, finding: observation })
      if (request.current === token) setResult({ status: 'ready', ...data, error: '' })
    } catch (e) {
      if (request.current === token) setResult({ ...empty(), status: 'error', error: toUserMessage(e) })
    }
  }, [valid, inspection?.id, inspection?.country, inspection?.asset_no, inspection?.inspection_date, observation?.rawPosition])

  useEffect(() => {
    lookUp()
    return () => { request.current += 1 }
  }, [lookUp])

  useEffect(() => {
    let active = true
    setLinked(null); setHistory([]); setMessage(''); setLinkError(''); setProvisioned(true)
    setDecisions({ available: false, reason: 'checking' })
    getObservationErpReviewState(actionId)
      .then((state) => { if (active) { setProvisioned(state.provisioned); setLinked(state.link); setHistory(state.history); setDecisions(state.decisions || { available: false, reason: 'unknown' }) } })
      .catch(() => { if (active) { setDecisions({ available: false, reason: 'unknown' }); setLinkError('Existing job card links could not be checked, so confirmation is unavailable. You can still review ERP evidence.') } })
    return () => { active = false }
  }, [actionId])

  useEffect(() => {
    const imported = (event) => {
      if (event.detail?.country && event.detail.country.toUpperCase() !== inspection?.country?.toUpperCase()) return
      setStale(true)
    }
    window.addEventListener('tyrepulse:data-changed', imported)
    return () => window.removeEventListener('tyrepulse:data-changed', imported)
  }, [inspection?.country])

  async function decide(candidate, decision, reason) {
    if (!actionId || reason.trim().length < 5 || stale || !provisioned || !decisions.available) return
    setBusy(candidate.workOrder.id); setMessage('')
    try {
      if (decision === 'confirm') {
        await confirmObservationErpLink({ actionId, workOrderId: candidate.workOrder.id, note: reason })
        setLinked(await getObservationErpLink(actionId))
        setMessage('Job card linked. The corrective action remains open until the repair is verified.')
      } else {
        await rejectObservationErpSuggestion({ actionId, workOrderId: candidate.workOrder.id, note: reason })
        setMessage('Candidate rejected. Your decision has been recorded.')
      }
      setHistory(await listObservationErpDecisions(actionId))
    } catch (e) {
      if (isErpReviewNotProvisioned(e)) { setProvisioned(false); setMessage('') }
      // The server decides. A refusal is shown in its own plain words, never as a link.
      else {
        const text = erpDecisionMessage(e)
        // EXECUTE withheld (interim lock): stop offering decisions and show the plain status note.
        if (text === ERP_DECISIONS_UNAVAILABLE_MESSAGE) { setDecisions((d) => ({ ...d, available: false, reason: 'locked' })); setMessage('') }
        else setMessage(text)
      }
    }
    finally { setBusy('') }
  }

  if (!valid) return <section className="iw-od-block"><h4>ERP work verification</h4>
    <p className="iw-od-muted">A recorded inspection date, country and wheel position are required to check job cards.</p></section>
  const eligible = result.candidates.filter(c => c.eligibleToConfirm)
  const pending = result.candidates.filter(c => !c.eligibleToConfirm)
  const drift = linked && result.status === 'ready'
    ? detectConfirmedErpDrift(linked.work_order_snapshot, result.candidates.find(c => c.workOrder.id === linked.work_order_id)?.workOrder)
    : []
  return (
    <section className="iw-od-block space-y-3" aria-label="ERP work verification">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4>ERP work verification</h4>
          <p className="iw-od-muted mt-1">Only tyre work related to this inspection is shown.</p>
        </div>
        <button type="button" className="cc-btn inline-flex items-center gap-1.5" onClick={lookUp}
          disabled={result.status === 'loading'} aria-label="Refresh ERP evidence">
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>
      {linked && <div className="rounded-lg border border-emerald-500/40 p-3 space-y-1">
        <p className="font-semibold text-sm flex items-center gap-2"><CheckCircle2 size={16} /> Linked job card {linked.source_job_card}</p>
        <p className="text-xs text-[var(--text-secondary)]">Reviewed {fmtDate(linked.reviewed_at)}. Work still requires separate verification and closure.</p>
        <Link to="/actions" className="cc-link text-xs">View corrective action</Link>
      </div>}
      {!provisioned && <p role="status" className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--text-secondary)]">
        ERP evidence review is not set up yet. You can still look at the ERP evidence below. Confirming or rejecting a job card will be available once it is set up.
      </p>}
      {provisioned && !decisions.available && decisions.reason !== 'checking' && <p role="status" className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--text-secondary)]">
        {ERP_DECISIONS_UNAVAILABLE_MESSAGE}
      </p>}
      {result.status === 'loading' && <p role="status" className="text-sm text-[var(--text-secondary)] flex items-center gap-2"><FileSearch size={16} /> Checking recent tyre and job-card evidence...</p>}
      {result.status === 'error' && <p role="alert" className="text-sm text-amber-600">ERP records could not be checked. {result.error}</p>}
      {result.status === 'ready' && <>
        {stale && <div role="status" className="text-xs text-amber-600">New ERP data was imported. Refresh before confirming a job card.</div>}
        {drift.length > 0 && <div role="alert" className="text-sm text-amber-600">The linked job card needs re-verification: {drift.join(', ')}.</div>}
        {result.evidenceLimited && <p role="status" className="text-xs text-amber-600">Some evidence exceeds the search limit. Confirmation is paused until the data can be reviewed in full.</p>}
        {eligible.length > 0 && <div className="space-y-2">
          <h5 className="text-sm font-semibold flex items-center gap-2"><ClipboardCheck size={16} /> Possible tyre work ({eligible.length})</h5>
          {eligible.map(c => <Candidate key={c.workOrder.id} candidate={c} actionId={actionId} linked={linked}
            limited={result.evidenceLimited} stale={stale} blocked={!!linkError || !provisioned || !decisions.available} busy={busy} onDecide={decide} />)}
        </div>}
        {!eligible.length && <div className="rounded-xl border border-[var(--border)] p-4 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-sm"><FileSearch size={17} /> No verified replacement evidence found</div>
          <p className="text-sm text-[var(--text-secondary)]">
            No imported post-inspection job card currently proves work on this wheel.
            Check the ERP intake or raise a corrective action for review.
          </p>
        </div>}
        {(pending.length > 0 || result.orphanTyreJobCards?.length > 0) &&
          <details className="rounded-lg border border-[var(--border)] p-3 text-sm">
            <summary className="cursor-pointer inline-flex items-center gap-2 font-medium"><AlertCircle size={15} /> Items needing investigation ({pending.length + (result.orphanTyreJobCards?.length || 0)})</summary>
            <div className="space-y-3 mt-3">
              {pending.map(c => <Candidate key={c.workOrder.id} candidate={c} actionId={actionId} linked={linked}
                limited={result.evidenceLimited} stale={stale} blocked={!!linkError || !provisioned || !decisions.available} busy={busy} onDecide={decide} />)}
              {!!result.orphanTyreJobCards?.length && <p className="text-xs text-[var(--text-secondary)]">
                Tyre consumption references job cards not present in the imported work-order records:
                {' '}{result.orphanTyreJobCards.join(', ')}. Review ERP intake before linking.
              </p>}
            </div>
          </details>}
        {linkError && actionId && <p className="text-xs text-amber-600">{linkError}</p>}
        {history.length > 0 && <details className="text-xs rounded-lg border border-[var(--border)] p-3">
          <summary className="cursor-pointer">Review history ({history.length})</summary>
          {history.map(h => <p key={h.id} className="mt-2">{h.decision} · {h.source_job_card} · {fmtDate(h.created_at)} · {h.reason}</p>)}
        </details>}
      </>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  )
}
