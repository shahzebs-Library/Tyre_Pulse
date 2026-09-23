import React, { useEffect, useRef, useState } from 'react'
import { TextInput, View } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { AppText, Button } from './ui'
import SignatureField from './SignatureField'
import SignatureView from './SignatureView'
import { readItem, secureStorage } from '../lib/secureStorage'
import { toUserMessage } from '../lib/safeError'
import { ApprovalReview, ApprovalDecision, ApprovalIntent, createApprovalIntent, executeStoredApprovalIntent, isDefinitiveApprovalRejection,
  listApprovalPeople, changeApprovalRoute, delegateApproval, revokeApprovalDelegation } from '../lib/governedApprovals'

/** Online-only policy decisions. An unconfirmed intent survives app restarts;
 * retries carry the original reviewed revision and operation ID. */
export default function GovernedApprovalPanel({ review, onRefresh, approvalBlockedMessage }: { review: ApprovalReview; onRefresh: () => Promise<void>; approvalBlockedMessage?: string }) {
  const { profile } = useAuth()
  const { language, isRTL } = useLanguage()
  const { theme } = useTheme()
  const copy = (en: string, ar: string) => language === 'ar' ? ar : en
  const [note, setNote] = useState(''), [signature, setSignature] = useState<string | null>(null)
  const [error, setError] = useState(''), [receipt, setReceipt] = useState<any>(null)
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false)
  const [pending, setPending] = useState<ApprovalIntent | null>(null)
  const [refused, setRefused] = useState(false)
  const [action, setAction] = useState<'recover' | 'reassign' | 'delegate' | 'revoke' | null>(null)
  const [reason, setReason] = useState(''), [person, setPerson] = useState(''), [people, setPeople] = useState<any[]>([])
  const [delegationId, setDelegationId] = useState('')
  const [start, setStart] = useState<Date | null>(null), [end, setEnd] = useState<Date | null>(null)
  const [dateField, setDateField] = useState<'start' | 'end' | null>(null)
  const lock = useRef(false), generation = useRef(0)
  const key = `approval.intent.${profile?.id}.${review.entity_type}.${review.entity_id}`
  const accessKey = JSON.stringify([profile?.id, profile?.role, profile?.country, review.stage_token, review.revision])
  useEffect(() => {
    const current = ++generation.current
    setReady(false); setBusy(false); setReceipt(null); setPending(null); setNote(''); setSignature(null); setAction(null); setError(''); setRefused(false)
    readItem(key).then(result => {
      if (current !== generation.current) return
      if (result.status !== 'ok' && result.status !== 'absent') throw new Error('A saved decision could not be read. Retry online before signing again.')
      const saved = result.value ? JSON.parse(result.value) as ApprovalIntent : null
      if (saved && (saved.p_entity_type !== review.entity_type || saved.p_entity_id !== review.entity_id || !saved.p_operation_id)) {
        throw new Error('The saved decision could not be verified.')
      }
      setPending(saved); setReady(true)
    }).catch(e => { if (current === generation.current) setError(toUserMessage(e, 'Could not restore the saved decision.')) })
    return () => { generation.current += 1 }
  }, [key, accessKey])

  async function decide(decision?: ApprovalDecision) {
    if (lock.current || !ready) return
    lock.current = true; setBusy(true); setError('')
    const current = generation.current
    try {
      if (!pending && decision === 'approved' && approvalBlockedMessage) throw new Error(approvalBlockedMessage)
      const intent = pending || createApprovalIntent(review, decision!, note, signature)
      // Durable before transmission: a timeout or process exit must not create a new decision.
      if (current !== generation.current) return
      setPending(intent)
      const accepted = await executeStoredApprovalIntent(secureStorage, key, intent, () => current === generation.current)
      if (current !== generation.current) return
      setPending(null); setReceipt(accepted)
      await onRefresh()
    } catch (e: any) {
      if (current === generation.current) { setRefused(isDefinitiveApprovalRejection(e)); setError(toUserMessage(e, 'Not confirmed. Retry online using the same decision.')) }
    } finally { lock.current = false; if (current === generation.current) setBusy(false) }
  }
  async function discardRefused() {
    if (lock.current || !refused) return
    lock.current = true; setBusy(true)
    try { await secureStorage.removeItem(key); setPending(null); setRefused(false); await onRefresh() }
    catch (e: any) { setError(toUserMessage(e, 'Could not refresh the refused decision.')) }
    finally { lock.current = false; setBusy(false) }
  }
  async function openRoute(next: typeof action, id = '') {
    if (lock.current || pending || !ready) return
    lock.current = true; setBusy(true); setError('')
    const current = generation.current
    try {
      const candidates = next === 'delegate' || next === 'reassign' ? await listApprovalPeople(review) : []
      if (current !== generation.current) return
      setPeople(candidates); setPerson(''); setReason(''); setStart(null); setEnd(null)
      setDelegationId(id); setAction(next)
    } catch (e: any) { if (current === generation.current) setError(toUserMessage(e, 'Reviewers unavailable. Retry online.')) }
    finally { lock.current = false; if (current === generation.current) setBusy(false) }
  }
  async function saveRoute() {
    if (lock.current || !action || pending) return
    lock.current = true; setBusy(true); setError('')
    const current = generation.current
    try {
      if (action === 'delegate') await delegateApproval(review, person, start?.toISOString() || '', end?.toISOString() || '', reason)
      else if (action === 'revoke') await revokeApprovalDelegation(delegationId, reason)
      else await changeApprovalRoute(review, action, reason, person)
      if (current === generation.current) { setAction(null); await onRefresh() }
    } catch (e: any) { if (current === generation.current) setError(toUserMessage(e, 'Change not confirmed. Refresh before retrying.')) }
    finally { lock.current = false; if (current === generation.current) setBusy(false) }
  }
  const textAlign = isRTL ? 'right' : 'left'
  const input = { color: theme.color.text, backgroundColor: theme.color.surface, borderColor: theme.color.borderStrong,
    borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 48, textAlign } as const
  return <View style={{ gap: 12, padding: 16, backgroundColor: theme.color.surface, borderRadius: 14 }}>
    <AppText variant="h3">{review.policy?.name || copy('Approval review', 'مراجعة الموافقة')}</AppText>
    <AppText>{copy('Review online. Decisions use the document and stage shown here.', 'راجع عبر الإنترنت. يرتبط القرار بالمستند والمرحلة المعروضين هنا.')}</AppText>
    {review.stages.map((stage, i) => <AppText key={i}>{i + 1}. {stage.name} · {stage.approver_role || stage.approver_name || copy('Assigned reviewer', 'المراجع المعين')}{i === review.current_stage ? ` · ${copy('Current stage', 'المرحلة الحالية')}` : ''}</AppText>)}
    {review.routing_status && review.routing_status !== 'matched' && <AppText>{copy('No valid approval route. An administrator must resolve routing.', 'لا يوجد مسار موافقة صالح. يجب على المسؤول معالجة المسار.')}</AppText>}
    {(review.history || []).map((event: any, i: number) => <View key={event.id || i} style={{ gap: 4 }}>
      <AppText>{event.step_name} · {event.action} · {event.printed_name || event.actor_name}</AppText>
      {event.created_at && <AppText>{new Date(event.created_at).toLocaleString(language)}</AppText>}
      {event.comment && <AppText>{event.comment}</AppText>}
      {event.signature_data && <SignatureView value={event.signature_data} />}
    </View>)}
    {receipt && <AppText accessibilityRole="alert">{copy('Decision recorded', 'تم تسجيل القرار')}: {receipt.decision} · {receipt.status}</AppText>}
    {!!error && <AppText accessibilityRole="alert">{error}</AppText>}
    {!!approvalBlockedMessage && <AppText>{approvalBlockedMessage}</AppText>}
    {pending ? <><AppText>{copy('A previous decision awaits confirmation. Retry it before making another decision.', 'قرار سابق ينتظر التأكيد. أعد المحاولة قبل اتخاذ قرار آخر.')}</AppText><Button label={copy('Retry saved decision', 'إعادة محاولة القرار المحفوظ')} loading={busy} onPress={() => decide()} />{refused && <Button label={copy('Discard refused decision and refresh', 'إلغاء القرار غير المقبول والتحديث')} disabled={busy} onPress={discardRefused} />}</> : <>
      {(review.can_decide || review.can_return) && ready && !action && <>
        <View pointerEvents={busy ? 'none' : 'auto'}><SignatureField key={accessKey} onChange={setSignature} /></View>
        <AppText>{profile?.full_name || profile?.username}</AppText>
        <TextInput accessibilityLabel={copy('Decision note', 'ملاحظة القرار')} placeholder={copy('Reason / comments', 'السبب / الملاحظات')} placeholderTextColor={theme.color.textMuted} style={input} multiline value={note} onChangeText={setNote} editable={!busy} />
        <Button label={copy('Approve', 'اعتماد')} disabled={!review.can_decide || busy || !!approvalBlockedMessage} onPress={() => decide('approved')} />
        <Button label={copy('Return for correction', 'إعادة للتصحيح')} variant="secondary" disabled={!review.can_return || busy} onPress={() => decide('returned')} />
        <Button label={copy('Reject', 'رفض')} variant="danger" disabled={!review.can_decide || busy} onPress={() => decide('rejected')} />
      </>}
      {!review.can_decide && !review.can_return && <AppText>{copy('You cannot decide this stage.', 'لا يمكنك اتخاذ قرار في هذه المرحلة.')}</AppText>}
      {review.can_recover && <Button label={copy('Resolve routing', 'معالجة المسار')} disabled={busy || !ready} onPress={() => openRoute('recover')} />}
      {review.can_reassign && <Button label={copy('Reassign reviewer', 'إعادة تعيين المراجع')} disabled={busy || !ready} onPress={() => openRoute('reassign')} />}
      {review.can_delegate && <Button label={copy('Delegate this stage', 'تفويض هذه المرحلة')} disabled={busy || !ready} onPress={() => openRoute('delegate')} />}
      {(review.delegations || []).map((d: any) => <View key={d.id}><AppText>{d.delegator_name} → {d.delegate_name} · {new Date(d.starts_at).toLocaleDateString(language)} – {new Date(d.ends_at).toLocaleDateString(language)}</AppText>{d.can_revoke && <Button label={copy('Revoke delegation', 'إلغاء التفويض')} disabled={busy || !ready} onPress={() => openRoute('revoke', d.id)} />}</View>)}
      {action && <View style={{ gap: 10 }}>
        {people.map(p => <Button key={p.id} variant={person === p.id ? 'primary' : 'secondary'} label={`${p.full_name} · ${p.role}`} disabled={busy} onPress={() => setPerson(p.id)} />)}
        {['delegate', 'reassign'].includes(action) && !people.length && <AppText>{copy('No eligible reviewers.', 'لا يوجد مراجعون مؤهلون.')}</AppText>}
        {action === 'delegate' && <><Button label={`${copy('Start date', 'تاريخ البداية')}: ${start?.toLocaleDateString(language) || '—'}`} disabled={busy} onPress={() => setDateField('start')} /><Button label={`${copy('End date', 'تاريخ النهاية')}: ${end?.toLocaleDateString(language) || '—'}`} disabled={busy} onPress={() => setDateField('end')} />{dateField && <DateTimePicker mode="date" value={(dateField === 'start' ? start : end) || new Date()} onChange={(event, date) => { if (event.type === 'set' && date) { const boundary = new Date(date); boundary.setHours(dateField === 'end' ? 23 : 0, dateField === 'end' ? 59 : 0, dateField === 'end' ? 59 : 0, 0); dateField === 'start' ? setStart(boundary) : setEnd(boundary) } setDateField(null) }} />}</>}
        <TextInput accessibilityLabel={copy('Change reason', 'سبب التغيير')} placeholder={copy('Change reason', 'سبب التغيير')} placeholderTextColor={theme.color.textMuted} style={input} value={reason} onChangeText={setReason} editable={!busy} />
        <Button label={copy('Save change', 'حفظ التغيير')} loading={busy} onPress={saveRoute} />
        <Button label={copy('Cancel', 'إلغاء')} variant="secondary" disabled={busy} onPress={() => setAction(null)} />
      </View>}
    </>}
    <Button label={copy('Refresh review', 'تحديث المراجعة')} variant="secondary" disabled={busy} onPress={() => { onRefresh().catch(e => setError(toUserMessage(e, 'Could not refresh.'))) }} />
  </View>
}
