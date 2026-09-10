import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useSettings } from '../../contexts/SettingsContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { getApprovalReview, createApprovalIntent, submitApprovalIntent, isApprovalReviewUnavailable, listApprovalReviewPeople, recoverApprovalRoute, reassignApprovalStage, delegateApprovalStage, revokeApprovalDelegation } from '../../lib/api/approvalDecisions'
import { signChecklistPhotoUrl } from '../../lib/api/checklists'
import { toUserMessage } from '../../lib/safeError'
import Modal from '../ui/Modal'
import ChecklistAnswers from '../checklist/ChecklistAnswers'
import InspectionAnswers from '../inspection/InspectionAnswers'
import SignatureField from '../checklist/SignatureField'
import OperationalApprovalDetails from './OperationalApprovalDetails'

/** Reuse existing evidence views, bound to the document actually reviewed. */
export default function ApprovalReview({ entityType, entityId, title, onClose, onActed, legacy = null }) {
  const { profile, modulePerms, grantOverrides, capabilities } = useAuth()
  const { activeCountry } = useSettings()
  const { language } = useLanguage()
  const ar = language === 'ar'
  const accessKey = JSON.stringify([profile?.id, profile?.org_id, profile?.role, profile?.country,
    profile?.countries, profile?.site, profile?.sites, profile?.approved, profile?.locked,
    profile?.is_super_admin, modulePerms, grantOverrides, capabilities])
  const copy = (en, arabic) => ar ? arabic : en
  const actionLabel = action => ({
    approved: copy('Approved', 'معتمد'), rejected: copy('Rejected', 'مرفوض'),
    returned: copy('Returned for correction', 'أعيد للتصحيح'), reassigned: copy('Reviewer reassigned', 'أعيد تعيين المراجع'),
    route_recovered: copy('Routing resolved', 'تمت معالجة المسار'), delegated: copy('Delegated', 'تم التفويض'), delegation_revoked: copy('Delegation revoked', 'أُلغي التفويض'),
  })[action] || action
  const statusLabel = status => ar ? ({ approved: 'معتمد', rejected: 'مرفوض', pending: 'بانتظار المراجعة', pending_approval: 'بانتظار الموافقة', pending_area_manager: 'بانتظار مدير المنطقة' })[status] || status : status
  const [review, setReview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [signature, setSignature] = useState(null)
  const [accepted, setAccepted] = useState(null)
  const [retry, setRetry] = useState(false)
  const [routeAction, setRouteAction] = useState(null)
  const [routeReason, setRouteReason] = useState('')
  const [replacement, setReplacement] = useState('')
  const [people, setPeople] = useState([])
  const [peopleQuery, setPeopleQuery] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [revokingId, setRevokingId] = useState(null)
  const generation = useRef(0)
  const intent = useRef(null)
  const mutationLock = useRef(false)

  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true); setReview(null); setError(''); setUnavailable(false); setBusy(false)
    setNote(''); setSignature(null); setAccepted(null); setRetry(false); intent.current = null
    setRouteAction(null); setRouteReason(''); setReplacement(''); setPeople([])
    try {
      const result = await getApprovalReview(entityType, entityId)
      if (entityType === 'checklist' && result.document.photos) {
        const photos = await Promise.all(Object.entries(result.document.photos).map(async ([key, values]) => [
          key, Array.isArray(values) ? await Promise.all(values.map(signChecklistPhotoUrl)) : values,
        ]))
        result.document = { ...result.document, photos: Object.fromEntries(photos) }
      }
      if (current === generation.current) setReview(result)
    } catch (err) {
      if (current !== generation.current) return
      if (isApprovalReviewUnavailable(err)) setUnavailable(true)
      else setError(toUserMessage(err, 'Could not load the approval. Retry online.'))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [entityType, entityId])

  useEffect(() => {
    load()
    const requests = generation
    return () => { requests.current += 1 }
  }, [load, accessKey, activeCountry])

  async function decide(approved, repeat = false, decision = null) {
    if (mutationLock.current) return
    mutationLock.current = true
    const current = generation.current
    try {
      if (!repeat) intent.current = createApprovalIntent(review, { approved, decision, note, signature })
      setBusy(true); setError('')
      const result = await submitApprovalIntent(intent.current)
      if (current !== generation.current) return
      setAccepted(result); setRetry(false)
      try {
        await onActed?.({ keepOpen: true, result })
      } catch {
        if (current === generation.current) setError(copy('The decision was recorded, but the approval list could not refresh. Reopen the list to update it.', 'تم تسجيل القرار، لكن تعذر تحديث قائمة الموافقات. أعد فتح القائمة لتحديثها.'))
      }
    } catch (err) {
      if (current !== generation.current) return
      setError(toUserMessage(err, 'The decision was not confirmed. Retry or refresh before deciding again.'))
      setRetry(!!intent.current)
    } finally {
      mutationLock.current = false
      if (current === generation.current) setBusy(false)
    }
  }

  async function openRouteAction(action) {
    if (mutationLock.current) return
    setRouteReason(''); setReplacement(''); setPeopleQuery(''); setStartsAt(''); setEndsAt(''); setError('')
    if (action === 'recover') { setRouteAction(action); return }
    mutationLock.current = true; setBusy(true)
    const current = generation.current
    try {
      const candidates = await listApprovalReviewPeople(entityType, entityId)
      if (current !== generation.current) return
      setPeople(candidates); setRouteAction(action)
    } catch (err) {
      if (current === generation.current) setError(toUserMessage(err, copy('Eligible reviewers could not be verified. Retry online.', 'تعذر التحقق من المراجعين المؤهلين. أعد المحاولة عبر الإنترنت.')))
    } finally {
      mutationLock.current = false
      if (current === generation.current) setBusy(false)
    }
  }

  async function changeRoute() {
    if (mutationLock.current || !routeReason.trim() || (['reassign', 'delegate'].includes(routeAction) && !replacement)) return
    mutationLock.current = true; setBusy(true); setError('')
    const current = generation.current
    try {
      if (routeAction === 'recover') await recoverApprovalRoute(review, routeReason)
      else if (routeAction === 'reassign') await reassignApprovalStage(review, replacement, routeReason)
      else if (routeAction === 'delegate') await delegateApprovalStage(review, replacement, startsAt, endsAt, routeReason)
      else if (routeAction === 'revoke') await revokeApprovalDelegation(revokingId, routeReason)
      if (current !== generation.current) return
      // Refresh the entire snapshot and its signed evidence URLs. Any old
      // signature or queued intent must be reviewed again after a route change.
      await load()
      onActed?.({ keepOpen: true })
    } catch (err) {
      if (current === generation.current) setError(toUserMessage(err, copy('The route change was not confirmed. Refresh before retrying.', 'لم يتم تأكيد تغيير المسار. حدّث البيانات قبل إعادة المحاولة.')))
    } finally {
      mutationLock.current = false
      if (current === generation.current) setBusy(false)
    }
  }

  if (unavailable && legacy) return legacy
  const stage = review?.stages?.[review.current_stage]
  const lifecycleStatus = review?.workflow_status || review?.status
  const pendingStage = ['pending', 'in_review', 'pending_approval', 'pending_area_manager'].includes(lifecycleStatus)
  const needsSignature = review?.mode === 'legacy' || stage?.require_signature !== false
  const canDecide = review?.can_decide === true && !accepted && !retry
  const canReturn = review?.can_return === true && !accepted && !retry
  return (
    <Modal open title={title || copy('Approval review', 'مراجعة الاعتماد')} onClose={busy ? undefined : onClose} size="xl">
      <div dir={ar ? 'rtl' : 'ltr'} className="space-y-5 text-[var(--text-primary)]">
        {loading && <p role="status">{copy('Loading the current record and approval route…', 'جارٍ تحميل السجل الحالي ومسار الاعتماد…')}</p>}
        {unavailable && <p role="alert">{copy('The approval service is not installed yet.', 'خدمة الاعتماد غير مثبتة بعد.')}</p>}
        {error && <div role="alert" className="rounded-lg border border-red-500/40 p-3 text-red-500">{error}</div>}
        {!loading && !busy && !accepted && <button type="button" onClick={load} className="btn-secondary min-h-11">{copy('Refresh and review again', 'تحديث وإعادة المراجعة')}</button>}
        {review && <>
          <p className="text-sm text-[var(--text-secondary)]">
            {review.mode === 'enforced'
              ? `${review.policy?.name || copy('Published policy', 'سياسة منشورة')} · ${copy('Version', 'الإصدار')} ${review.policy?.version || ''}`
              : copy('Existing approval rules apply.', 'تُطبق قواعد الاعتماد الحالية.')}
          </p>
          {review.stages?.length > 0 && <ol aria-label={copy('Approval stages', 'مراحل الاعتماد')} className="space-y-2">
            {review.stages.map((step, index) => <li key={index} aria-current={!accepted && pendingStage && index === review.current_stage ? 'step' : undefined} className="rounded-lg border border-[var(--hairline)] p-3">
              <span className="font-semibold">{index + 1}. {step.name}</span>
              <span className="ms-2 text-sm text-[var(--text-secondary)]">{step.approver_name || step.approver_role || copy('Assigned reviewer', 'المراجع المعيّن')}</span>
              {!accepted && pendingStage && index === review.current_stage && <span className="ms-2 text-sm">{copy('Current stage', 'المرحلة الحالية')}</span>}
            </li>)}
          </ol>}
          {entityType === 'checklist' && <ChecklistAnswers submission={review.document} lang={language} showApproval={review.mode !== 'enforced'} />}
          {entityType === 'inspection' && <InspectionAnswers inspection={review.document} />}
          {['work_order', 'tyre_change'].includes(entityType) && <OperationalApprovalDetails entityType={entityType} document={review.document} language={language} />}
          {review.history?.length > 0 && <section aria-label={copy('Decision history', 'سجل القرارات')}>
            <h3 className="font-semibold">{copy('Decision history', 'سجل القرارات')}</h3>
            <ol className="space-y-2">{review.history.map((event, i) => <li key={event.id || i} className="border-b border-[var(--hairline)] py-2 text-sm">
              <p>{event.step_name} · {actionLabel(event.action)} · {event.printed_name || event.actor_name || copy('Recorded reviewer', 'المراجع المسجل')}</p>
              {event.comment && <p className="whitespace-pre-wrap">{event.comment}</p>}
              {event.created_at && <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString(language)}</time>}
            </li>)}</ol>
          </section>}
          {accepted && <p role="status" className="rounded-lg border border-green-500/40 p-3">
            {accepted.decision === 'returned'
              ? copy('Returned for correction. A new review is required after resubmission.', 'تمت الإعادة للتصحيح. تلزم مراجعة جديدة بعد إعادة التقديم.')
              : <>{copy('Decision recorded. Current status:', 'تم تسجيل القرار. الحالة الحالية:')} {statusLabel(accepted.status)}</>}
          </p>}
          {!review.can_decide && !accepted && <p role="status">{['approved', 'rejected', 'returned'].includes(lifecycleStatus)
            ? <>{copy('Review completed:', 'اكتملت المراجعة:')} {actionLabel(lifecycleStatus)}</>
            : copy('Approval and rejection are unavailable at this stage.', 'الموافقة والرفض غير متاحين في هذه المرحلة.')}</p>}
          {!accepted && !retry && (review.can_recover || review.can_reassign || review.can_delegate || review.delegations?.length > 0) && <section className="space-y-3" aria-label={copy('Approval routing actions', 'إجراءات مسار الموافقة')}>
            <div className="flex flex-wrap gap-2">
              {review.can_recover && <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => openRouteAction('recover')}>{copy('Resolve routing exception', 'معالجة استثناء المسار')}</button>}
              {review.can_reassign && <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => openRouteAction('reassign')}>{copy('Reassign current stage', 'إعادة تعيين المرحلة الحالية')}</button>}
              {review.can_delegate && <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => openRouteAction('delegate')}>{copy('Delegate current stage', 'تفويض المرحلة الحالية')}</button>}
            </div>
            {review.delegations?.length > 0 && <ul className="space-y-2">{review.delegations.map(delegation => <li key={delegation.id} className="rounded-lg border border-[var(--hairline)] p-3 text-sm"><p>{delegation.delegator_name} → {delegation.delegate_name}</p><p>{new Date(delegation.starts_at).toLocaleString(language)} — {new Date(delegation.ends_at).toLocaleString(language)}</p><p>{!delegation.active ? copy('Revoked', 'ملغى') : new Date(delegation.ends_at) <= new Date() ? copy('Expired', 'منتهي') : new Date(delegation.starts_at) > new Date() ? copy('Scheduled', 'مجدول') : copy('Active', 'نشط')}</p>{delegation.can_revoke && delegation.active && <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => { setRevokingId(delegation.id); setRouteReason(''); setRouteAction('revoke') }}>{copy('Revoke delegation', 'إلغاء التفويض')}</button>}</li>)}</ul>}
            {routeAction && <fieldset disabled={busy} className="space-y-3 rounded-lg border border-[var(--hairline)] p-3">
              <p className="text-sm">{copy('This change is audited. The server rechecks authority for pending decisions. Review again after confirmation.', 'يُحفظ هذا التغيير في السجل. يعيد الخادم التحقق من الصلاحيات للقرارات المعلقة. أعد المراجعة بعد التأكيد.')}</p>
              {['reassign', 'delegate'].includes(routeAction) && <>
                <label className="block text-sm">{copy('Search eligible reviewers', 'البحث عن المراجعين المؤهلين')}<input className="mt-1 w-full min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3" value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} /></label>
                <label className="block text-sm">{copy('Replacement reviewer', 'المراجع البديل')}<select className="mt-1 w-full min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3" value={replacement} onChange={e => setReplacement(e.target.value)}><option value="">{copy('Choose a reviewer', 'اختر مراجعاً')}</option>{people.filter(person => person.id === replacement || `${person.full_name} ${person.role}`.toLowerCase().includes(peopleQuery.toLowerCase())).map(person => <option key={person.id} value={person.id}>{person.full_name} · {person.role}</option>)}</select></label>
                {!people.length && <p role="status">{copy('No eligible replacement reviewers are available.', 'لا يوجد مراجعون بدلاء مؤهلون.')}</p>}
              </>}
              {routeAction === 'delegate' && <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">{copy('Delegation starts (local time)', 'بداية التفويض (بالتوقيت المحلي)')}<input type="datetime-local" className="mt-1 w-full min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3" value={startsAt} onChange={e => setStartsAt(e.target.value)} /></label><label className="block text-sm">{copy('Delegation ends (maximum 90 days)', 'نهاية التفويض (90 يوماً كحد أقصى)')}<input type="datetime-local" className="mt-1 w-full min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3" value={endsAt} onChange={e => setEndsAt(e.target.value)} /></label></div>}
              <label className="block text-sm">{copy('Routing change reason', 'سبب تغيير المسار')}<textarea className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3" value={routeReason} maxLength={2000} onChange={e => setRouteReason(e.target.value)} /></label>
              <div className="flex gap-2"><button type="button" className="btn-primary min-h-11" disabled={busy || !routeReason.trim() || (['reassign', 'delegate'].includes(routeAction) && !replacement) || (routeAction === 'delegate' && (!startsAt || !endsAt))} onClick={changeRoute}>{copy('Confirm routing change', 'تأكيد تغيير المسار')}</button><button type="button" className="btn-secondary min-h-11" onClick={() => setRouteAction(null)}>{copy('Cancel', 'إلغاء')}</button></div>
            </fieldset>}
          </section>}
          {(canDecide || canReturn) && <fieldset disabled={busy} className="space-y-3">
            <label className="block text-sm">{copy('Reason (required to reject or return)', 'السبب (مطلوب للرفض أو الإعادة)')}
              <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={8000} rows={3} className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3" />
            </label>
            {canDecide && needsSignature && <SignatureField key={`${entityId}:${review.stage_token}`} label={copy('Approval signature', 'توقيع الاعتماد')} onChange={setSignature} />}
            <div className="flex flex-wrap gap-3">
              {canReturn && <button type="button" className="btn-secondary min-h-11" disabled={busy || !note.trim()} onClick={() => decide(false, false, 'returned')}>{copy('Return for correction', 'إعادة للتصحيح')}</button>}
              {canDecide && <button type="button" className="btn-secondary min-h-11" disabled={busy || !note.trim()} onClick={() => decide(false)}>{copy('Reject', 'رفض')}</button>}
              {canDecide && <button type="button" className="btn-primary min-h-11" disabled={busy || (needsSignature && !signature)} onClick={() => decide(true)}>{busy ? copy('Saving…', 'جارٍ الحفظ…') : copy('Approve this stage', 'اعتماد هذه المرحلة')}</button>}
            </div>
          </fieldset>}
          {retry && !accepted && <button type="button" disabled={busy} onClick={() => decide(false, true)} className="btn-primary min-h-11">{copy('Retry the same decision', 'إعادة محاولة القرار نفسه')}</button>}
        </>}
      </div>
    </Modal>
  )
}
