import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { getTyreChangeApprovalContext, requestTyreChangeApproval, executeApprovedTyreChange, tyreChangePayload } from '../../lib/api/tyreChangeApprovals'
import { isApprovalReviewUnavailable } from '../../lib/api/approvalDecisions'
import { toUserMessage } from '../../lib/safeError'
import ApprovalReview from './ApprovalReview'
import Modal from '../ui/Modal'

const copy = {
  en: { title: 'Tyre change approvals', loading: 'Checking tyre change authority…', retry: 'Refresh', request: 'Request tyre change', review: 'Review request', execute: 'Execute approved change', confirm: 'Confirm execution', confirmation: 'This records the approved tyre operation. Verify the vehicle and tyres before continuing.', reason: 'Reason for the change', action: 'Operation', install: 'Install into empty position', replace: 'Replace fitted tyre', remove: 'Remove tyre', move: 'Move / swap tyre', current: 'Current tyre', position: 'Target position', target: 'Target asset number (blank for same vehicle)', serial: 'Replacement serial', brand: 'Brand', km: 'Odometer (km)', cost: 'Tyre cost', date: 'Operation date', save: 'Submit for approval', cancel: 'Close', saved: 'Request submitted. Wait for approval before executing the tyre change.', executed: 'Tyre change executed and confirmed by the server.', empty: 'No tyre change requests for this vehicle.', rule: 'Submit the proposed change, obtain approval, then execute it. Direct changes are locked while this policy is enforced.', pending: 'A saved operation awaits confirmation. Retry it before editing.', retryIntent: 'Retry saved operation', storage: 'The draft could not be saved on this device. Keep this screen open and retry.', draft: 'Draft saved on this device.', required: 'Enter a reason for the change.', choose: 'Choose a tyre', status: 'Status', permission: 'You cannot submit tyre changes for this vehicle.' },
  ar: { title: 'اعتمادات تغيير الإطارات', loading: 'جارٍ التحقق من صلاحية تغيير الإطارات…', retry: 'تحديث', request: 'طلب تغيير إطار', review: 'مراجعة الطلب', execute: 'تنفيذ التغيير المعتمد', confirm: 'تأكيد التنفيذ', confirmation: 'يسجل هذا الإجراء عملية الإطار المعتمدة. تحقق من المركبة والإطارات قبل المتابعة.', reason: 'سبب التغيير', action: 'العملية', install: 'تركيب في موضع فارغ', replace: 'استبدال إطار مركب', remove: 'إزالة إطار', move: 'نقل / تبديل إطار', current: 'الإطار الحالي', position: 'الموضع المستهدف', target: 'رقم الأصل المستهدف (فارغ لنفس المركبة)', serial: 'الرقم التسلسلي للإطار البديل', brand: 'العلامة التجارية', km: 'قراءة العداد (كم)', cost: 'تكلفة الإطار', date: 'تاريخ العملية', save: 'إرسال للاعتماد', cancel: 'إغلاق', saved: 'تم إرسال الطلب. انتظر الاعتماد قبل تنفيذ تغيير الإطار.', executed: 'تم تنفيذ تغيير الإطار وتأكيده من الخادم.', empty: 'لا توجد طلبات تغيير إطارات لهذه المركبة.', rule: 'أرسل التغيير المقترح واحصل على الاعتماد ثم نفذه. تُقفل التغييرات المباشرة أثناء تطبيق السياسة.', pending: 'توجد عملية محفوظة تنتظر التأكيد. أعد المحاولة قبل التعديل.', retryIntent: 'إعادة محاولة العملية المحفوظة', storage: 'تعذر حفظ المسودة على هذا الجهاز. أبقِ الشاشة مفتوحة وأعد المحاولة.', draft: 'المسودة محفوظة على هذا الجهاز.', required: 'أدخل سبب التغيير.', choose: 'اختر إطاراً', status: 'الحالة', permission: 'ليس لديك صلاحية إرسال تغييرات إطارات لهذه المركبة.' },
}
const input = 'w-full min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2'
const button = 'min-h-11 rounded-lg border border-[var(--input-border)] px-3 py-2 disabled:opacity-40'
const blank = () => ({ action: 'replace', tyreId: '', position: '', targetAsset: '', serial: '', brand: '', km: '', cost: '', date: new Date().toISOString().slice(0, 10), reason: '' })
const rejectedTransaction = error => ['22023', '22004', '23514', '23505', '42501', '40001', 'P0002'].includes(error?.code)
function Field({ label, children }) { return <label className="flex flex-col gap-1 text-sm"><span>{label}</span>{children}</label> }

export default function TyreChangeApprovals(props) {
  const { profile } = useAuth()
  const scope = `${profile?.org_id || ''}:${profile?.id || ''}:${props.asset?.id || ''}`
  return <ScopedTyreChangeApprovals key={scope} {...props} scope={scope} />
}

function ScopedTyreChangeApprovals({ asset, tyres = [], positions = [], scope, onModeChange, onExecuted }) {
  const { language, isRTL } = useLanguage()
  const c = copy[language] || copy.en
  const storageKey = `tp:tyre-approval:${scope}`
  const [saved, setSaved] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || 'null')
      return { form: { ...blank(), ...value?.form }, intent: value?.intent || null, executions: value?.executions || {} }
    } catch { return { form: blank(), intent: null, executions: {}, unreadable: true } }
  })
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [storageError, setStorageError] = useState(saved.unreadable === true)
  const [draftSaved, setDraftSaved] = useState(false)
  const [open, setOpen] = useState(false)
  const [review, setReview] = useState(null)
  const [execution, setExecution] = useState(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const lock = useRef(false)
  const generation = useRef(0)
  const modeCallback = useRef(onModeChange)
  modeCallback.current = onModeChange
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1 } }, [])
  const load = useCallback(async () => {
    const sequence = ++generation.current
    setLoading(true); setError(''); modeCallback.current?.('loading')
    try {
      if (!asset?.id) throw new Error('A registered vehicle is required to verify tyre change authority.')
      const data = await getTyreChangeApprovalContext(asset.id)
      if (!alive.current || sequence !== generation.current) return
      setContext(data); modeCallback.current?.(data.mode)
    } catch (e) {
      if (!alive.current || sequence !== generation.current) return
      if (isApprovalReviewUnavailable(e)) { setContext({ mode: 'legacy', requests: [] }); modeCallback.current?.('legacy') }
      else { setError(toUserMessage(e)); modeCallback.current?.('error') }
    } finally { if (alive.current && sequence === generation.current) setLoading(false) }
  }, [asset?.id])
  useEffect(() => { load() }, [load])

  function persist(next) {
    setSaved(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false); setDraftSaved(true); return true }
    catch { setStorageError(true); return false }
  }
  function change(key, value) {
    const form = { ...saved.form, [key]: value }
    if (key === 'tyreId' && form.action === 'replace') {
      const tyre = tyres.find(row => row.id === value)
      form.position = tyre?.tyre_position || tyre?.position || ''
    }
    persist({ ...saved, form })
  }
  async function submit() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try {
      if (!saved.form.reason.trim()) throw new Error(c.required)
      const intent = saved.intent || { p_vehicle_id: asset.id, p_change: tyreChangePayload(saved.form), p_operation_id: crypto.randomUUID(), p_reason: saved.form.reason.trim() }
      if (!persist({ ...saved, intent })) throw new Error(c.storage)
      await requestTyreChangeApproval(intent)
      if (!alive.current) return
      persist({ form: blank(), intent: null, executions: saved.executions }); setOpen(false); setMessage(c.saved)
      await load()
    } catch (e) { if (alive.current) { if (rejectedTransaction(e)) persist({ ...saved, intent: null }); setError(toUserMessage(e)) } }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function execute() {
    if (lock.current || !execution) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const intent = saved.executions[execution.id] || { p_request_id: execution.id, p_operation_id: crypto.randomUUID() }
      const executions = { ...saved.executions, [execution.id]: intent }
      if (!persist({ ...saved, executions })) throw new Error(c.storage)
      await executeApprovedTyreChange(intent)
      if (!alive.current) return
      delete executions[execution.id]
      persist({ ...saved, executions }); setExecution(null); setMessage(c.executed)
      await load(); onExecuted?.()
    } catch (e) {
      if (alive.current) {
        if (rejectedTransaction(e)) {
          const executions = { ...saved.executions }; delete executions[execution.id]
          persist({ ...saved, executions })
        }
        setError(toUserMessage(e))
      }
    }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  if (context?.mode === 'legacy' && !loading && !error) return null
  const form = saved.form
  return <section className="card p-4 space-y-3" dir={isRTL ? 'rtl' : 'ltr'} aria-label={c.title}>
    <h3 className="font-semibold">{c.title}</h3>
    {loading ? <p role="status">{c.loading}</p> : <p className="text-sm text-[var(--text-muted)]">{c.rule}</p>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {storageError && <p role="alert" className="text-amber-400">{c.storage}</p>}
    {message && <p role="status">{message}</p>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || loading} onClick={load}>{c.retry}</button>
      {context?.can_submit && <button className="btn-primary min-h-11" disabled={busy || loading} onClick={() => setOpen(true)}>{saved.intent ? c.retryIntent : c.request}</button>}</div>
    {!loading && context?.mode === 'enforced' && !context.can_submit && <p>{c.permission}</p>}
    {!loading && context?.requests.length === 0 && <p>{c.empty}</p>}
    <ul className="space-y-2">{context?.requests.map(row => <li key={row.id} className="rounded-lg border border-[var(--border-dim)] p-3 space-y-2">
      <p className="font-medium">{c[row.action] || row.title} · {asset.asset_no}</p>
      <p className="text-sm">{c.status}: {row.status} · {row.created_at ? new Date(row.created_at).toLocaleString(language === 'ar' ? 'ar' : 'en') : ''}</p>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => setReview(row.id)}>{c.review}</button>
        {(row.can_execute || saved.executions[row.id]) && <button className="btn-primary min-h-11" disabled={busy || loading} onClick={() => setExecution(row)}>{saved.executions[row.id] ? c.retryIntent : c.execute}</button>}</div>
    </li>)}</ul>
    {review && <ApprovalReview entityType="tyre_change" entityId={review} title={`${c.title} · ${asset.asset_no}`} onClose={() => setReview(null)} onActed={load} />}
    <Modal open={open} onClose={() => !busy && setOpen(false)} title={c.request} size="lg" footer={<button className="btn-primary min-h-11" disabled={busy || !context?.can_submit} onClick={submit}>{saved.intent ? c.retryIntent : c.save}</button>}>
      {error && <p role="alert" className="text-red-400 mb-3">{error}</p>}
      {saved.intent && <p className="mb-3">{c.pending}</p>}
      <fieldset disabled={busy || !!saved.intent} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={c.action}><select className={input} value={form.action} onChange={e => change('action', e.target.value)}>{['install','replace','remove','move'].map(action => <option key={action} value={action}>{c[action]}</option>)}</select></Field>
        {form.action !== 'install' && <Field label={c.current}><select className={input} value={form.tyreId} onChange={e => change('tyreId', e.target.value)}><option value="">{c.choose}</option>{tyres.filter(row => !row.removal_date && !/removed|scrap|sold|retired/i.test(row.status || '')).map(row => <option key={row.id} value={row.id}>{row.serial_no || row.serial_number || row.tyre_serial} · {row.tyre_position || row.position}</option>)}</select></Field>}
        {form.action !== 'remove' && <Field label={c.position}><input className={input} list={`positions-${asset.id}`} value={form.position} onChange={e => change('position', e.target.value)} /><datalist id={`positions-${asset.id}`}>{positions.map(p => <option key={p.code} value={p.code} />)}</datalist></Field>}
        {form.action === 'move' && <Field label={c.target}><input className={input} value={form.targetAsset} onChange={e => change('targetAsset', e.target.value)} /></Field>}
        {['install','replace'].includes(form.action) && <><Field label={c.serial}><input className={input} value={form.serial} onChange={e => change('serial', e.target.value)} /></Field><Field label={c.brand}><input className={input} value={form.brand} onChange={e => change('brand', e.target.value)} /></Field><Field label={c.cost}><input className={input} type="number" min="0" value={form.cost} onChange={e => change('cost', e.target.value)} /></Field></>}
        <Field label={c.km}><input className={input} type="number" min="0" value={form.km} onChange={e => change('km', e.target.value)} /></Field>
        {form.action !== 'move' && <Field label={c.date}><input className={input} type="date" value={form.date} onChange={e => change('date', e.target.value)} /></Field>}
        <Field label={c.reason}><textarea className={input} value={form.reason} onChange={e => change('reason', e.target.value)} /></Field>
      </fieldset>{(storageError || draftSaved) && <p className="text-xs mt-3">{storageError ? c.storage : c.draft}</p>}
    </Modal>
    <Modal open={!!execution} onClose={() => !busy && setExecution(null)} title={c.confirm} footer={<button className="btn-primary min-h-11" disabled={busy} onClick={execute}>{c.confirm}</button>}>
      <p>{c.confirmation}</p><p className="mt-2">{asset.asset_no} · {c[execution?.action]} · {execution?.id}</p>
      {error && <p role="alert" className="text-red-400 mt-3">{error}</p>}
    </Modal>
  </section>
}
