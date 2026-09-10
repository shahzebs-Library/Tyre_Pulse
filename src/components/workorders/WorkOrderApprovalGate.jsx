import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useSettings } from '../../contexts/SettingsContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { getWorkOrderApproval, requestWorkOrderApproval } from '../../lib/api/workOrderApprovals'
import { isApprovalReviewUnavailable } from '../../lib/api/approvalDecisions'
import { toUserMessage } from '../../lib/safeError'
import ApprovalReview from '../workflow/ApprovalReview'

/** The request ID is separate from the source job-card ID. Approval authorises execution; it never starts work. */
export default function WorkOrderApprovalGate({ orderId, revision, legacy, onGateChange }) {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const { language } = useLanguage()
  const ar = language === 'ar'
  const copy = (en, arabic) => ar ? arabic : en
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [reviewRequestId, setReviewRequestId] = useState(null)
  const [retry, setRetry] = useState(false)
  const generation = useRef(0)
  const operation = useRef(null)
  const mutation = useRef(false)
  const notify = useRef(onGateChange)
  useLayoutEffect(() => { notify.current = onGateChange })
  useLayoutEffect(() => {
    if (loading || error) notify.current?.({ canExecute: false })
    else if (unavailable || state?.mode === 'legacy') notify.current?.({ canExecute: true })
    else notify.current?.({ canExecute: state?.can_execute === true,
      lockEdits: !!state?.request_id && ['pending', 'pending_approval', 'in_review'].includes(state?.review?.status) })
  }, [state, loading, error, unavailable])
  const load = useCallback(async () => {
    const token = ++generation.current
    setLoading(true); setError(''); setState(null); setUnavailable(false)
    try {
      const data = await getWorkOrderApproval(orderId)
      if (token === generation.current) setState(data)
    } catch (err) {
      if (token !== generation.current) return
      if (isApprovalReviewUnavailable(err)) setUnavailable(true)
      else setError(toUserMessage(err, 'Work-order approval could not be verified.'))
    } finally { if (token === generation.current) setLoading(false) }
  }, [orderId])
  useEffect(() => {
    operation.current = null; setRetry(false); setReason(''); setReviewRequestId(null)
    load()
    const requests = generation
    return () => { ++requests.current }
  }, [load, revision, activeCountry, profile?.id, profile?.org_id, profile?.role])
  async function submit() {
    if (mutation.current || !reason.trim()) return
    mutation.current = true; setBusy(true); setError('')
    const token = generation.current
    operation.current ||= { id: crypto.randomUUID(), reason: reason.trim() }
    try {
      const data = await requestWorkOrderApproval(orderId, operation.current.id, operation.current.reason)
      if (token !== generation.current) return
      setState(data); setRetry(false); operation.current = null; setReason('')
    } catch (err) {
      if (token === generation.current) { setError(toUserMessage(err, copy('Submission was not confirmed. Retry the same request.', 'لم يتم تأكيد التقديم. أعد محاولة الطلب نفسه.'))); setRetry(true) }
    } finally { mutation.current = false; if (token === generation.current) setBusy(false) }
  }
  if (!loading && !error && (unavailable || state?.mode === 'legacy')) return legacy
  return <section dir={ar ? 'rtl' : 'ltr'} className="card space-y-3" aria-label={copy('Approval before execution', 'الموافقة قبل التنفيذ')}>
    <h3 className="font-semibold">{copy('Approval before execution', 'الموافقة قبل التنفيذ')}</h3>
    {loading && <p role="status">{copy('Checking approval…', 'جارٍ التحقق من الموافقة…')}</p>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {!loading && <p>{state?.can_execute ? copy('The approved work order may proceed. Start work using the status controls.', 'يمكن تنفيذ أمر العمل المعتمد. ابدأ العمل باستخدام عناصر التحكم بالحالة.') : copy('Execution is blocked until this exact work order is approved.', 'التنفيذ محظور حتى اعتماد نسخة أمر العمل هذه.')}</p>}
    {state?.can_submit && <label className="block text-sm">{copy('Submission reason', 'سبب التقديم')}<textarea className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3" value={reason} maxLength={2000} disabled={busy || retry} onChange={e => setReason(e.target.value)} /></label>}
    <div className="flex flex-wrap gap-2">
      {(state?.can_submit || retry) && <button type="button" className="btn-primary min-h-11" disabled={busy || !reason.trim()} onClick={submit}>{retry ? copy('Retry the same request', 'إعادة محاولة الطلب نفسه') : copy('Request approval', 'طلب الموافقة')}</button>}
      {state?.request_id && <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => setReviewRequestId(state.request_id)}>{copy('Review approval request', 'مراجعة طلب الموافقة')}</button>}
      <button type="button" className="btn-secondary min-h-11" disabled={busy || loading} onClick={() => { operation.current = null; setRetry(false); load() }}>{copy('Refresh', 'تحديث')}</button>
    </div>
    {reviewRequestId && <ApprovalReview entityType="work_order" entityId={reviewRequestId} onClose={() => setReviewRequestId(null)} onActed={load} />}
  </section>
}
