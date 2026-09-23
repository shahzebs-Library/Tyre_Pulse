import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Image, ScrollView, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { Screen, AppText, Button, Loading, ErrorState, EmptyState } from '../../components/ui'
import { withModuleGuard } from '../../components/ModuleGuard'
import GovernedApprovalPanel from '../../components/GovernedApprovalPanel'
import { ApprovalReview, getApprovalReview, listOperationalApprovals } from '../../lib/governedApprovals'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { toUserMessage } from '../../lib/safeError'
import { backTo } from '../../lib/goBack'

type PhotoState = (reference: string, loaded: boolean) => void
function EvidencePhoto({ reference, onPhotoState }: { reference: string; onPhotoState: PhotoState }) {
  const [url, setUrl] = useState<string | null>(null), [failed, setFailed] = useState(false)
  const { language } = useLanguage()
  useEffect(() => {
    let active = true
    setUrl(null); setFailed(false)
    resolveStorageUrl(reference).then(value => {
      if (!active) return
      if (value && /^https:\/\//i.test(value)) setUrl(value)
      else setFailed(true)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [reference])
  if (failed) return <AppText>{language === 'ar' ? 'تعذر تحميل الصورة. حدث المراجعة قبل التوقيع.' : 'Photo unavailable. Refresh the review before signing.'}</AppText>
  return url ? <Image source={{ uri: url }} resizeMode="contain" style={{ width: '100%', height: 240 }} onLoad={() => onPhotoState(reference, true)} onError={() => { setFailed(true); onPhotoState(reference, false) }} /> : <Loading />
}
/** Submitted immutable data, including nested vehicle/tyre identities. Never
 * substitute current_source_snapshot for the evidence the request captured. */
function EvidenceFields({ value, field = '', onPhotoState }: { value: unknown; field?: string; onPhotoState: PhotoState }) {
  if (value == null || value === '') return null
  if (Array.isArray(value)) return <View style={{ gap: 8 }}>{value.map((item, i) => field === 'photos' && typeof item === 'string'
    ? <EvidencePhoto key={i} reference={item} onPhotoState={onPhotoState} /> : <EvidenceFields key={i} value={item} field={field} onPhotoState={onPhotoState} />)}</View>
  if (typeof value === 'object') return <View style={{ gap: 8 }}>{Object.entries(value).map(([key, item]) => <View key={key} style={{ gap: 4 }}>
    <AppText variant="bodyStrong">{key.replace(/_/g, ' ')}</AppText><EvidenceFields value={item} field={key} onPhotoState={onPhotoState} />
  </View>)}</View>
  return <AppText>{String(value)}</AppText>
}
function photoReferences(value: unknown, field = ''): string[] {
  if (Array.isArray(value)) return value.flatMap(item => field === 'photos' && typeof item === 'string' ? [item] : photoReferences(item, field))
  return value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => photoReferences(item, key)) : []
}
export default withModuleGuard(OperationalApprovalsScreen, 'approvals')
function OperationalApprovalsScreen() {
  const router = useRouter(), params = useLocalSearchParams<{ id?: string; type?: string }>()
  const { profile, canAccess } = useAuth(), { language } = useLanguage()
  const ar = language === 'ar', id = String(params.id || ''), type = String(params.type || '')
  const [rows, setRows] = useState<any[]>([]), [review, setReview] = useState<ApprovalReview | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [unverifiedPhotos, setUnverifiedPhotos] = useState<Set<string>>(new Set())
  const photoState = useCallback<PhotoState>((reference, loaded) => setUnverifiedPhotos(previous => {
    const next = new Set(previous); loaded ? next.delete(reference) : next.add(reference); return next
  }), [])
  const generation = useRef(0)
  const allowed = canAccess('approvals')
  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true); setError(''); setReview(null); setRows([])
    try {
      if (!allowed) throw new Error('Approval access denied.')
      if (id) {
        if (type !== 'work_order' && type !== 'tyre_change') throw new Error('Unsupported approval type.')
        const result = await getApprovalReview(type, id)
        if (current === generation.current) {
          setUnverifiedPhotos(new Set([...photoReferences(result.document.payload), ...photoReferences(result.document.source_snapshot)]))
          setReview(result)
        }
      } else {
        const result = await listOperationalApprovals()
        if (current === generation.current) setRows(result)
      }
    } catch (e: any) { if (current === generation.current) setError(toUserMessage(e, 'Could not load approvals. Retry online.')) }
    finally { if (current === generation.current) setLoading(false) }
  }, [id, type, allowed, profile?.id, profile?.role, profile?.country])
  useFocusEffect(useCallback(() => { load(); return () => { generation.current += 1 } }, [load]))
  return <Screen padded>
    <Button label={ar ? 'رجوع' : 'Back'} variant="ghost" onPress={() => backTo(router, id ? '/(app)/approvals' : '/(app)')} />
    <AppText variant="h2">{ar ? 'موافقات العمليات' : 'Operational Approvals'}</AppText>
    {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : review ? <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
      <AppText variant="h3">{review.document.title || review.document.entity_label}</AppText>
      <AppText>{ar ? 'الموافقة تسمح بتنفيذ الطلب المحدد ولا تنفذه تلقائياً.' : 'Approval authorises the submitted request. It does not execute the operation automatically.'}</AppText>
      <AppText variant="h3">{ar ? 'الطلب المقدم' : 'Submitted request'}</AppText>
      <EvidenceFields value={review.document.payload} onPhotoState={photoState} />
      <AppText variant="h3">{ar ? 'السجل عند تقديم الطلب' : 'Record at submission'}</AppText>
      <EvidenceFields value={review.document.source_snapshot} onPhotoState={photoState} />
      <GovernedApprovalPanel review={review} onRefresh={load} approvalBlockedMessage={unverifiedPhotos.size ? (ar ? 'انتظر تحميل جميع صور الأدلة قبل الاعتماد.' : 'All evidence photos must load before approval.') : undefined} />
    </ScrollView> : rows.length ? <ScrollView contentContainerStyle={{ gap: 12, paddingVertical: 16 }}>{rows.map(row => <Button key={row.id}
      label={[row.entity_label || row.definition_name, row.entity_type === 'work_order' ? (ar ? 'أمر عمل' : 'Work order') : (ar ? 'عملية إطار' : 'Tyre operation')].filter(Boolean).join(' · ')}
      variant="secondary" onPress={() => router.push({ pathname: '/(app)/approvals', params: { id: row.entity_id, type: row.entity_type } })} />)}</ScrollView>
      : <EmptyState title={ar ? 'لا توجد طلبات تنتظر قرارك' : 'No requests awaiting your decision'} message={ar ? 'تظهر هنا طلبات أوامر العمل وعمليات الإطارات الموجهة إليك.' : 'Work-order and tyre-operation requests assigned to you appear here.'} actionLabel={ar ? 'تحديث' : 'Refresh'} onAction={load} />}
  </Screen>
}
