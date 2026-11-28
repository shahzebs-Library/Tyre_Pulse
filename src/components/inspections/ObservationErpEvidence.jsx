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
import { useLanguage } from '../../contexts/LanguageContext'

const empty = () => ({ status: 'loading', candidates: [], orphanTyreJobCards: [], evidenceLimited: false, error: '' })
const fmtDate = (v, none) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : none

function Candidate({ candidate, actionId, linked, limited, stale, blocked, onDecide, busy }) {
  const { t } = useLanguage()
  const p = (k, v) => t(`inspections.erp.${k}`, v)
  const day = (v) => fmtDate(v, p('dateNotRecorded'))
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
            {day(wo.completed_at || wo.opened_at)} · {wo.status || p('statusNotRecorded')}
          </p>
        </div>
        <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${viable ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
          {viable ? p('ready') : manual ? p('manual') : p('needsEvidence')}
        </span>
      </div>
      <p className="text-sm leading-relaxed">{wo.description || p('descNotRecorded')}</p>
      {manual && <p className="text-xs text-amber-600" role="status">
        {p('manualHint')}
      </p>}
      {candidate.serialExceptionPossible && <p className="text-xs text-[var(--text-secondary)]">
        {p('serialException')}
      </p>}
      {evidence.canonicalPosition && <p className="text-xs text-[var(--text-secondary)]">{p('wheel', { position: evidence.canonicalPosition })}</p>}
      <div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
        <span>{evidence.tyreRows === 1 ? p('tyreMovementOne') : p('tyreMovements', { count: evidence.tyreRows })}</span>
        <span aria-hidden="true">·</span>
        <span>{evidence.expenseRows === 1 ? p('expenseLineOne') : p('expenseLines', { count: evidence.expenseRows })}</span>
      </div>
      <button type="button" onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded} className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)]">
        <ChevronDown size={13} className={expanded ? 'rotate-180' : ''} aria-hidden="true" />
        {expanded ? p('hideEvidence') : p('showEvidence')}
      </button>
      {expanded && <div className="space-y-2 rounded-lg bg-[var(--surface-secondary,var(--surface))] p-3 text-xs">
        {candidate.reasons.map((r,i) => <p key={i} className="text-[var(--text-secondary)]">✓ {r}</p>)}
        {candidate.conflicts.map((r,i) => <p key={i} className="text-amber-600">{r}</p>)}
        {(candidate.notes || []).map((r,i) => <p key={`n${i}`} className="text-[var(--text-secondary)]">{p('note', { text: r })}</p>)}
        {candidate.fitments?.map(f => <p key={f.id}>{p('tyre', { serial: f.serial_no || p('serialNotRecorded') })} · {f.tyre_position || f.position || p('positionMissing')} · {day(f.removal_date || f.issue_date)}</p>)}
        {candidate.expenses?.length > 0 && <details>
          <summary className="cursor-pointer">{p('expenseDetails', { count: candidate.expenses.length })}</summary>
          <div className="mt-2 space-y-1">
            {candidate.expenses.map(e => <p key={e.id}>{e.item_description || p('unclassified')} · {p('qty', { value: e.qty ?? p('na') })} · {p('tyreAmount', { value: e.tyre_amount ?? p('na') })} · {p('spareAmount', { value: e.spare_parts_amount ?? p('na') })}</p>)}
          </div>
        </details>}
      </div>}
      {!linked && actionId && !blocked && <div className="space-y-2">
        {viable && !stale && <button type="button" className="cc-btn-primary"
          onClick={() => setReview(v => !v)} disabled={!!busy}>{p('reviewLink')}</button>}
        {review && <div className="border-t border-[var(--border)] pt-3 space-y-2">
          <label className="text-xs font-medium block" htmlFor={`erp-reason-${wo.id}`}>{p('whyLabel')}</label>
          <textarea id={`erp-reason-${wo.id}`} value={reason} rows={3} maxLength={2000}
            onChange={e => setReason(e.target.value)} placeholder={p('whyPlaceholder')}
            className="input w-full" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="cc-btn-primary"
              disabled={!viable || stale || !!busy || reason.trim().length < 5}
              onClick={() => onDecide(candidate, 'confirm', reason)}>{p('confirm')}</button>
            <button type="button" className="cc-btn" disabled={!!busy || reason.trim().length < 5}
              onClick={() => onDecide(candidate, 'reject', reason)}>{p('reject')}</button>
          </div>
        </div>}
      </div>}
      {!actionId && viable && <p className="text-xs text-[var(--text-secondary)]">{p('raiseFirst')}</p>}
    </article>
  )
}

export default function ObservationErpEvidence({ observation }) {
  const { t } = useLanguage()
  const p = (k, v) => t(`inspections.erp.${k}`, v)
  const day = (v) => fmtDate(v, p('dateNotRecorded'))
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
      .catch(() => { if (active) { setDecisions({ available: false, reason: 'unknown' }); setLinkError(p('linkError')) } })
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
        setMessage(p('linkedMsg'))
      } else {
        await rejectObservationErpSuggestion({ actionId, workOrderId: candidate.workOrder.id, note: reason })
        setMessage(p('rejectedMsg'))
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

  if (!valid) return <section className="iw-od-block"><h4>{p('title')}</h4>
    <p className="iw-od-muted">{p('invalid')}</p></section>
  const eligible = result.candidates.filter(c => c.eligibleToConfirm)
  const pending = result.candidates.filter(c => !c.eligibleToConfirm)
  const drift = linked && result.status === 'ready'
    ? detectConfirmedErpDrift(linked.work_order_snapshot, result.candidates.find(c => c.workOrder.id === linked.work_order_id)?.workOrder)
    : []
  return (
    <section className="iw-od-block space-y-3" aria-label={p('title')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4>{p('title')}</h4>
          <p className="iw-od-muted mt-1">{p('scope')}</p>
        </div>
        <button type="button" className="cc-btn inline-flex items-center gap-1.5" onClick={lookUp}
          disabled={result.status === 'loading'} aria-label={p('refreshAria')}>
          <RefreshCw size={14} aria-hidden="true" /> {p('refresh')}
        </button>
      </div>
      {linked && <div className="rounded-lg border border-emerald-500/40 p-3 space-y-1">
        <p className="font-semibold text-sm flex items-center gap-2"><CheckCircle2 size={16} /> {p('linkedCard', { jobCard: linked.source_job_card })}</p>
        <p className="text-xs text-[var(--text-secondary)]">{p('reviewedOn', { date: day(linked.reviewed_at) })}</p>
        <Link to="/actions" className="cc-link text-xs">{p('viewAction')}</Link>
      </div>}
      {!provisioned && <p role="status" className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--text-secondary)]">
        {p('notProvisioned')}
      </p>}
      {provisioned && !decisions.available && decisions.reason !== 'checking' && <p role="status" className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--text-secondary)]">
        {ERP_DECISIONS_UNAVAILABLE_MESSAGE}
      </p>}
      {result.status === 'loading' && <p role="status" className="text-sm text-[var(--text-secondary)] flex items-center gap-2"><FileSearch size={16} /> {p('checking')}</p>}
      {result.status === 'error' && <p role="alert" className="text-sm text-amber-600">{p('checkError')} {result.error}</p>}
      {result.status === 'ready' && <>
        {stale && <div role="status" className="text-xs text-amber-600">{p('stale')}</div>}
        {drift.length > 0 && <div role="alert" className="text-sm text-amber-600">{p('drift', { fields: drift.join(', ') })}</div>}
        {result.evidenceLimited && <p role="status" className="text-xs text-amber-600">{p('limited')}</p>}
        {eligible.length > 0 && <div className="space-y-2">
          <h5 className="text-sm font-semibold flex items-center gap-2"><ClipboardCheck size={16} /> {p('possible', { count: eligible.length })}</h5>
          {eligible.map(c => <Candidate key={c.workOrder.id} candidate={c} actionId={actionId} linked={linked}
            limited={result.evidenceLimited} stale={stale} blocked={!!linkError || !provisioned || !decisions.available} busy={busy} onDecide={decide} />)}
        </div>}
        {!eligible.length && <div className="rounded-xl border border-[var(--border)] p-4 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-sm"><FileSearch size={17} /> {p('noneFound')}</div>
          <p className="text-sm text-[var(--text-secondary)]">
            {p('noneFoundHint')}
          </p>
        </div>}
        {(pending.length > 0 || result.orphanTyreJobCards?.length > 0) &&
          <details className="rounded-lg border border-[var(--border)] p-3 text-sm">
            <summary className="cursor-pointer inline-flex items-center gap-2 font-medium"><AlertCircle size={15} /> {p('investigate', { count: pending.length + (result.orphanTyreJobCards?.length || 0) })}</summary>
            <div className="space-y-3 mt-3">
              {pending.map(c => <Candidate key={c.workOrder.id} candidate={c} actionId={actionId} linked={linked}
                limited={result.evidenceLimited} stale={stale} blocked={!!linkError || !provisioned || !decisions.available} busy={busy} onDecide={decide} />)}
              {!!result.orphanTyreJobCards?.length && <p className="text-xs text-[var(--text-secondary)]">
                {p('orphans', { list: result.orphanTyreJobCards.join(', ') })}
              </p>}
            </div>
          </details>}
        {linkError && actionId && <p className="text-xs text-amber-600">{linkError}</p>}
        {history.length > 0 && <details className="text-xs rounded-lg border border-[var(--border)] p-3">
          <summary className="cursor-pointer">{p('history', { count: history.length })}</summary>
          {history.map(h => <p key={h.id} className="mt-2">{h.decision} · {h.source_job_card} · {day(h.created_at)} · {h.reason}</p>)}
        </details>}
      </>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  )
}
