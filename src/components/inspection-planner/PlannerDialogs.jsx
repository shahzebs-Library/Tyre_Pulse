import { Children, cloneElement, useId, useMemo, useState } from 'react'
import Modal from '../ui/Modal'
import EntityApprovalPanel from '../workflow/EntityApprovalPanel'
import { todayStr, addDays, buildScheduleDates, findScheduleConflicts, MAX_PLANNER_BATCH } from '../../lib/inspectionPlanner'
import { toUserMessage } from '../../lib/safeError'
import { useEntityWorkflow } from '../../hooks/useEntityWorkflow'

const english = (en) => en
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const validDate = value => { try { return addDays(value, 0) === value } catch { return false } }
const inputClass = 'w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]'
const types = [['Routine', 'دوري'], ['Pressure', 'ضغط'], ['Visual', 'بصري'], ['Full', 'شامل'], ['Pre-Trip', 'قبل الرحلة']]
function Field({ label, children }) {
  const id = useId()
  return <div className="space-y-1 text-sm text-[var(--text-secondary)]"><label htmlFor={id} className="block">{label}</label>{Children.map(children, (child, index) => index === 0 ? cloneElement(child, { id }) : child)}</div>
}
function ConflictNotice({ conflicts, accepted, onAccept, t }) {
  if (!conflicts.length) return null
  return <div className="rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 space-y-2 text-sm text-[var(--text-primary)]">
    <p className="font-medium">{t('Review possible scheduling conflicts', 'راجع تعارضات الجدولة المحتملة')}</p>
    <ul className="list-disc ps-5 max-h-32 overflow-auto">{conflicts.map((c, i) => <li key={i}>{c.item.asset_no} · {c.item.inspection_date} · {c.type === 'asset' ? t('Vehicle already scheduled', 'المركبة مجدولة بالفعل') : t('Inspector has another appointment', 'لدى المفتش موعد آخر')} ({c.existing.inspection_time?.slice(0, 5) || '—'})</li>)}</ul>
    <label className="flex items-start gap-2"><input type="checkbox" checked={accepted} onChange={e => onAccept(e.target.checked)} className="mt-1" />{t('I reviewed these appointments and want to continue.', 'راجعت هذه المواعيد وأريد المتابعة.')}</label>
  </div>
}
function Actions({ saving, disabled, onClose, onSave, bulk, t }) {
  return <div className="flex items-center justify-end gap-3"><button type="button" disabled={saving} onClick={onClose} className="btn-secondary">{t('Cancel', 'إلغاء')}</button><button type="button" onClick={onSave} disabled={disabled || saving} className="btn-primary disabled:opacity-50">{saving ? t('Saving...', 'جارٍ الحفظ...') : bulk ? t('Schedule All', 'جدولة الكل') : t('Save', 'حفظ')}</button></div>
}

export function ScheduleModal({ onClose, onSave, prefill = null, assets = [], inspectors = [], schedule = [], canSchedule = true, t = english }) {
  const listId = useId()
  const approval = useEntityWorkflow('pm_service', prefill?.id, { enabled: !!prefill?.id })
  const [form, setForm] = useState({ asset_no: prefill?.asset_no || '', inspection_date: prefill?.inspection_date ?? todayStr(), inspection_time: prefill?.inspection_time?.slice(0, 5) ?? '08:00', inspector_name: prefill?.inspector_name || '', site: prefill?.site || '', notes: prefill?.notes || '', type: prefill?.type || 'Routine', status: prefill?.status || 'Scheduled', priority: prefill?.priority ?? null })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [wfLocked, setWfLocked] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const approvalBlocked = !!prefill?.id && (approval.loading || !!approval.error || approval.isActive || approval.isLocked || wfLocked)
  const item = { ...form, country: prefill?.country || assets.find(a => a.asset_no === form.asset_no)?.country, inspector_name: form.inspector_name.trim(), ...(prefill?.id ? { id: prefill.id } : {}) }
  const conflicts = findScheduleConflicts([item], schedule)
  const validAsset = assets.some(a => a.asset_no === form.asset_no) || (!!prefill?.id && prefill.asset_no === form.asset_no)
  const valid = canSchedule && validAsset && validDate(form.inspection_date) && validTime(form.inspection_time) && item.inspector_name
  function change(key, value) {
    setAccepted(false)
    setError('')
    setForm(f => ({ ...f, [key]: value, ...(key === 'asset_no' ? { site: assets.find(a => a.asset_no === value)?.site || '' } : {}) }))
  }
  async function save() {
    if (saving || approvalBlocked || !valid || (conflicts.length && !accepted)) return
    setSaving(true)
    setError('')
    try {
      if (await onSave(item) === false) setError(t('Could not save this inspection. Please try again.', 'تعذر حفظ الفحص. حاول مرة أخرى.'))
    } catch (err) { setError(toUserMessage(err, t('Could not save this inspection. Please try again.', 'تعذر حفظ الفحص. حاول مرة أخرى.'))) }
    finally { setSaving(false) }
  }
  return <Modal open onClose={saving ? undefined : onClose} title={prefill?.id ? t('Edit Inspection', 'تعديل الفحص') : t('Schedule Inspection', 'جدولة فحص')} bodyClassName="space-y-4" footer={<Actions saving={saving} disabled={!valid || approvalBlocked || (conflicts.length > 0 && !accepted)} onClose={onClose} onSave={save} t={t} />}>
    {error && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-[var(--text-primary)]">{error}</p>}
    <Field label={t('Asset No *', 'رقم الأصل *')}><input list={`${listId}-assets`} className={inputClass} value={form.asset_no} onChange={e => change('asset_no', e.target.value)} /><datalist id={`${listId}-assets`}>{assets.map(a => <option key={a.asset_no} value={a.asset_no}>{a.site}</option>)}</datalist></Field>
    {form.asset_no && !validAsset && <p className="text-sm text-[var(--text-secondary)]">{t('Choose an existing vehicle from the list.', 'اختر مركبة موجودة من القائمة.')}</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label={t('Date *', 'التاريخ *')}><input type="date" className={inputClass} value={form.inspection_date} onChange={e => change('inspection_date', e.target.value)} /></Field><Field label={t('Time *', 'الوقت *')}><input type="time" className={inputClass} value={form.inspection_time} onChange={e => change('inspection_time', e.target.value)} /></Field></div>
    <Field label={t('Inspector *', 'المفتش *')}><input list={`${listId}-inspectors`} className={inputClass} value={form.inspector_name} onChange={e => change('inspector_name', e.target.value)} /><datalist id={`${listId}-inspectors`}>{inspectors.map(i => <option key={i} value={i} />)}</datalist></Field>
    <p className="text-xs text-[var(--text-secondary)]">{t('Suggestions come from previous inspections. Confirm the inspector’s availability before saving.', 'الاقتراحات من الفحوصات السابقة. تأكد من توفر المفتش قبل الحفظ.')}</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label={t('Site', 'الموقع')}><input className={inputClass} value={form.site} onChange={e => change('site', e.target.value)} /></Field><Field label={t('Type', 'النوع')}><select className={inputClass} value={form.type} onChange={e => change('type', e.target.value)}>{types.map(([en, ar]) => <option key={en} value={en}>{t(en, ar)}</option>)}</select></Field></div>
    <Field label={t('Notes', 'ملاحظات')}><textarea rows={2} className={inputClass} value={form.notes} onChange={e => change('notes', e.target.value)} /></Field>
    <ConflictNotice conflicts={conflicts} accepted={accepted} onAccept={setAccepted} t={t} />
    {prefill?.id && <EntityApprovalPanel entityType="pm_service" entityId={prefill.id} entityLabel={prefill.asset_no || prefill.id} context={{ asset_no: prefill.asset_no, due_date: prefill.inspection_date, service_type: prefill.type, status: prefill.status, site: prefill.site }} onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))} title={t('Inspection approval', 'اعتماد الفحص')} />}
    {prefill?.id && approval.loading && <p role="status" className="text-sm text-[var(--text-secondary)]">{t('Checking approval status...', 'جارٍ التحقق من حالة الاعتماد...')}</p>}
    {prefill?.id && approval.error && <div role="alert" className="text-sm text-[var(--text-primary)]"><p>{t('Approval status could not be verified. Saving is disabled until it can be checked.', 'تعذر التحقق من حالة الاعتماد. الحفظ معطل حتى يتم التحقق منها.')}</p><button type="button" className="btn-secondary mt-2" onClick={approval.refresh}>{t('Retry approval check', 'إعادة التحقق من الاعتماد')}</button></div>}
    {(wfLocked || approval.isActive || approval.isLocked) && <p role="status" className="text-sm text-[var(--text-secondary)]">{t('Locked, in approval', 'مقفل ضمن دورة الاعتماد')}</p>}
  </Modal>
}

export function BulkModal({ selected = [], inspectors = [], onClose, onSave, schedule = [], canSchedule = true, t = english }) {
  const listId = useId()
  const [form, setForm] = useState({ inspector: '', start: todayStr(), end: addDays(todayStr(), 6), time: '08:00', spacing: 30, type: 'Routine', weekdays: [0, 1, 2, 3, 4, 5, 6] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const change = (key, value) => { setForm(f => ({ ...f, [key]: value })); setAccepted(false); setError('') }
  const plan = useMemo(() => {
    if (selected.length > MAX_PLANNER_BATCH) return { items: [], error: t(`Schedule up to ${MAX_PLANNER_BATCH} vehicles at a time. Reduce your selection to continue.`, `يمكن جدولة ${MAX_PLANNER_BATCH} مركبة كحد أقصى في المرة الواحدة. قلل عدد المركبات المحددة للمتابعة.`) }
    try {
      const dates = buildScheduleDates(form.start, form.end, form.weekdays)
      if (!dates.length) return { items: [], error: t('No selected working days in this date range.', 'لا توجد أيام عمل محددة في هذا النطاق.') }
      if (!validTime(form.time) || !Number.isInteger(Number(form.spacing)) || form.spacing < 5 || form.spacing > 480) return { items: [], error: t('Enter a start time and slot spacing between 5 and 480 minutes.', 'أدخل وقت البداية وفاصل مواعيد بين 5 و480 دقيقة.') }
      const [hours, minutes] = form.time.split(':').map(Number)
      const items = selected.map((v, i) => {
        const slot = hours * 60 + minutes + Math.floor(i / dates.length) * Number(form.spacing)
        if (slot >= 1440) throw new RangeError('capacity')
        return { asset_no: v.asset_no, country: v.country, site: v.site || '', inspector_name: form.inspector.trim(), inspection_date: dates[i % dates.length], inspection_time: `${String(Math.floor(slot / 60)).padStart(2, '0')}:${String(slot % 60).padStart(2, '0')}`, type: form.type, notes: '', status: 'Scheduled' }
      })
      return { items, dates }
    } catch { return { items: [], error: t('Choose a valid date range of up to 366 days, with working days selected and enough time before midnight.', 'اختر نطاقاً صالحاً حتى 366 يوماً مع تحديد أيام العمل ووقت كافٍ قبل منتصف الليل.') } }
  }, [form, selected, t])
  const conflicts = findScheduleConflicts(plan.items, schedule)
  const disabled = !canSchedule || !form.inspector.trim() || !plan.items.length || !!plan.error || (conflicts.length > 0 && !accepted)
  async function save() {
    if (saving || disabled) return
    setSaving(true)
    setError('')
    try { if (await onSave(plan.items) === false) setError(t('Could not save the schedule. Please try again.', 'تعذر حفظ الجدول. حاول مرة أخرى.')) }
    catch (err) { setError(toUserMessage(err, t('Could not save the schedule. Please try again.', 'تعذر حفظ الجدول. حاول مرة أخرى.'))) }
    finally { setSaving(false) }
  }
  const days = [['Sun', 'الأحد'], ['Mon', 'الاثنين'], ['Tue', 'الثلاثاء'], ['Wed', 'الأربعاء'], ['Thu', 'الخميس'], ['Fri', 'الجمعة'], ['Sat', 'السبت']]
  return <Modal open onClose={saving ? undefined : onClose} title={`${t('Bulk Schedule', 'جدولة جماعية')} · ${selected.length}`} bodyClassName="space-y-4" footer={<Actions bulk saving={saving} disabled={disabled} onClose={onClose} onSave={save} t={t} />}>
    {error && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-[var(--text-primary)]">{error}</p>}
    <Field label={t('Inspector *', 'المفتش *')}><input list={listId} className={inputClass} value={form.inspector} onChange={e => change('inspector', e.target.value)} /><datalist id={listId}>{inspectors.map(i => <option key={i} value={i} />)}</datalist></Field>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label={t('Start date', 'تاريخ البداية')}><input type="date" className={inputClass} value={form.start} onChange={e => change('start', e.target.value)} /></Field><Field label={t('End date', 'تاريخ النهاية')}><input type="date" className={inputClass} min={form.start} value={form.end} onChange={e => change('end', e.target.value)} /></Field></div>
    <fieldset><legend className="text-sm text-[var(--text-secondary)] mb-2">{t('Working days', 'أيام العمل')}</legend><div className="flex flex-wrap gap-3">{days.map(([en, ar], i) => <label key={en} className="flex items-center gap-1 text-sm text-[var(--text-primary)]"><input type="checkbox" checked={form.weekdays.includes(i)} onChange={e => change('weekdays', e.target.checked ? [...form.weekdays, i] : form.weekdays.filter(d => d !== i))} />{t(en, ar)}</label>)}</div></fieldset>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label={t('Daily start time', 'وقت البداية اليومي')}><input type="time" className={inputClass} value={form.time} onChange={e => change('time', e.target.value)} /></Field><Field label={t('Slot spacing (minutes)', 'الفاصل بين المواعيد (دقائق)')}><input type="number" min={5} max={480} className={inputClass} value={form.spacing} onChange={e => change('spacing', e.target.value)} /></Field></div>
    <p className="text-xs text-[var(--text-secondary)]">{t('Spacing arranges start times only. Confirm inspector availability and inspection duration separately.', 'الفاصل ينظم أوقات البداية فقط. تحقق من توفر المفتش ومدة الفحص بشكل منفصل.')}</p>
    <Field label={t('Inspection Type', 'نوع الفحص')}><select className={inputClass} value={form.type} onChange={e => change('type', e.target.value)}>{types.map(([en, ar]) => <option key={en} value={en}>{t(en, ar)}</option>)}</select></Field>
    {plan.error ? <p role="alert" className="text-sm text-[var(--text-primary)]">{plan.error}</p> : <div className="space-y-2"><p className="text-sm text-[var(--text-secondary)]">{plan.dates.length} {form.weekdays.length === 7 ? t('calendar days', 'أيام تقويمية') : t('selected working dates', 'تواريخ عمل محددة')} · {t('Schedule preview', 'معاينة الجدول')}</p><ul aria-label={t('Schedule preview', 'معاينة الجدول')} className="max-h-48 overflow-auto space-y-1">{plan.items.map((item, i) => <li key={`${item.asset_no}-${i}`} className="flex flex-wrap justify-between gap-2 rounded-lg bg-[var(--input-bg)] p-2 text-sm text-[var(--text-primary)]"><span>{item.asset_no} · {item.site}</span><span dir="ltr">{item.inspection_date} · {item.inspection_time}</span></li>)}</ul></div>}
    <ConflictNotice conflicts={conflicts} accepted={accepted} onAccept={setAccepted} t={t} />
  </Modal>
}
