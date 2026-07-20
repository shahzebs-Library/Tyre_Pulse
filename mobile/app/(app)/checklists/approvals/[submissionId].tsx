/**
 * Checklist approval review
 *
 * Opens one pending submission for sign-off: shows the inspector's answers
 * (labelled from the template), attached photos count, and their drawn
 * signature, then lets an approver either APPROVE — capturing the approver's
 * own drawn signature + name and locking the record — or REJECT with a required
 * note that returns it to the field. Both decisions route through the typed,
 * offline-safe record queue and are enforced server-side by V212 RLS.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, StatusBar, Platform, KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../../contexts/AuthContext'
import { useLanguage } from '../../../../contexts/LanguageContext'
import { canApproveChecklists } from '../../../../lib/permissions'
import { toUserMessage } from '../../../../lib/safeError'
import SignaturePad from '../../../../components/SignaturePad'
import SignatureView from '../../../../components/SignatureView'
import {
  getSubmission, getTemplate, decideApproval,
  ChecklistSubmission, ChecklistTemplate,
} from '../../../../lib/checklists'
import { ChecklistField, isValueField } from '../../../../lib/checklistFields'

// Render any stored answer value as readable text (arrays, booleans, ratings).
function formatAnswer(field: ChecklistField, value: any): string {
  if (value == null || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (field.type === 'rating') return `${value}/5`
  return String(value)
}

import { withModuleGuard } from '../../../../components/ModuleGuard'

export default withModuleGuard(ChecklistApprovalReviewScreen, 'approvals')

function ChecklistApprovalReviewScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const router = useRouter()
  const params = useLocalSearchParams<{ submissionId?: string }>()
  const submissionId = String(params.submissionId ?? '')

  const [submission, setSubmission] = useState<ChecklistSubmission | null>(null)
  const [template, setTemplate] = useState<ChecklistTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [approverSig, setApproverSig] = useState<string | null>(null)
  const [approverName, setApproverName] = useState(profile?.full_name || profile?.username || '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const allowed = canApproveChecklists(profile?.role)

  // Back = previous screen when there is history, else the approvals queue.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)/checklists/approvals')
  }, [router])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const s = await getSubmission(submissionId)
      if (!s) { setSubmission(null); setLoading(false); return }
      setSubmission(s)
      if (s.template_id) {
        try { setTemplate(await getTemplate(s.template_id)) } catch { /* labels degrade to field ids */ }
      }
    } catch (e: any) {
      setLoadError(toUserMessage(e, 'Could not load this submission.'))
    } finally {
      setLoading(false)
    }
  }, [submissionId])

  useEffect(() => { load() }, [load])

  // Answers to display: template value-fields in order (falls back to raw keys).
  const rows = useMemo(() => {
    const answers = submission?.answers ?? {}
    const fields = template?.fields ?? []
    if (fields.length) {
      return fields
        .filter(f => isValueField(f.type))
        .map(f => ({ id: f.id, label: f.label || f.id, text: formatAnswer(f, answers[f.id]) }))
    }
    return Object.entries(answers).map(([k, v]) => ({
      id: k, label: k, text: formatAnswer({ type: 'text' } as ChecklistField, v),
    }))
  }, [submission, template])

  const photoCount = useMemo(() => {
    const p = submission?.photos ?? {}
    return Object.values(p).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
  }, [submission])

  async function decide(approved: boolean) {
    if (!submission || busy) return
    const name = approverName.trim()
    if (approved) {
      if (!approverSig) {
        Alert.alert('Signature required', 'Sign in the approver box to approve this checklist.')
        return
      }
      if (!name) {
        Alert.alert('Name required', 'Enter your name to record who approved.')
        return
      }
    } else if (!note.trim()) {
      Alert.alert('Reason required', 'Add a short note so the inspector knows what to fix.')
      return
    }

    setBusy(approved ? 'approve' : 'reject')
    try {
      const res = await decideApproval({
        id: submission.id,
        approved,
        approverName: name || (profile?.full_name ?? ''),
        approverSignature: approverSig,
        reviewNote: note.trim() || null,
        approverId: profile?.id ?? null,
      })
      const verb = approved ? 'approved' : 'returned'
      const tail = res.offline ? ' It will sync when back online.' : ''
      Alert.alert(
        approved ? 'Checklist approved' : 'Checklist returned',
        `The submission has been ${verb}.${tail}`,
        [{ text: 'Done', onPress: goBack }],
      )
    } catch (e: any) {
      Alert.alert('Could not save decision', toUserMessage(e, 'Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  // ── Loading / error / not-found / not-permitted ─────────────────────────────
  const nav = (title: string) => (
    <View style={[styles.nav, isRTL && styles.rowR]}>
      <TouchableOpacity onPress={goBack} style={styles.navBack}>
        <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
      </TouchableOpacity>
      <Text style={[styles.navTitle, { textAlign }]} numberOfLines={1}>{title}</Text>
    </View>
  )

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />
        {nav('Approval')}
        <View style={styles.stateWrap}>
          <Ionicons name="lock-closed-outline" size={52} color="#cbd5e1" />
          <Text style={styles.stateTitle}>Not available</Text>
          <Text style={styles.stateText}>Checklist approvals are limited to supervisors and managers.</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    )
  }

  if (loadError || !submission) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />
        {nav('Approval')}
        <View style={styles.stateWrap}>
          <Ionicons name={loadError ? 'cloud-offline-outline' : 'help-circle-outline'} size={52} color={loadError ? '#fca5a5' : '#cbd5e1'} />
          <Text style={styles.stateTitle}>{loadError ? "Couldn't load submission" : 'Submission not found'}</Text>
          <Text style={styles.stateText}>{loadError || 'It may have already been reviewed or removed.'}</Text>
          {loadError && (
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load() }}>
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    )
  }

  const decided = submission.approval_status !== 'pending'
  const submittedWhen = submission.submitted_at
    ? new Date(submission.submitted_at).toLocaleString(dateLocale, {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—'

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {nav(submission.title || submission.template_name || 'Checklist')}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Summary */}
          <View style={styles.card}>
            <View style={[styles.summaryRow, isRTL && styles.rowR]}>
              <Ionicons name="document-text-outline" size={16} color="#64748b" />
              <Text style={[styles.summaryText, { textAlign }]} numberOfLines={1}>
                {submission.template_name || '—'}
              </Text>
            </View>
            {!!(submission.site || submission.asset_no) && (
              <View style={[styles.summaryRow, isRTL && styles.rowR]}>
                <Ionicons name="location-outline" size={16} color="#64748b" />
                <Text style={[styles.summaryText, { textAlign }]} numberOfLines={1}>
                  {[submission.site, submission.asset_no].filter(Boolean).join(' · ')}
                </Text>
              </View>
            )}
            <View style={[styles.summaryRow, isRTL && styles.rowR]}>
              <Ionicons name="time-outline" size={16} color="#64748b" />
              <Text style={[styles.summaryText, { textAlign }]}>{submittedWhen}</Text>
            </View>
            <View style={[styles.summaryRow, isRTL && styles.rowR]}>
              {submission.score_pct != null && (
                <View style={[styles.scorePill, submission.score_passed === false && styles.scorePillFail]}>
                  <Ionicons name="ribbon-outline" size={12} color={submission.score_passed === false ? '#dc2626' : '#15803d'} />
                  <Text style={[styles.scorePillText, submission.score_passed === false && { color: '#dc2626' }]}>
                    {submission.score_pct}%{submission.score_passed != null ? (submission.score_passed ? ' · Pass' : ' · Fail') : ''}
                  </Text>
                </View>
              )}
              {photoCount > 0 && (
                <View style={styles.metaChip}>
                  <Ionicons name="image-outline" size={12} color="#64748b" />
                  <Text style={styles.metaChipText}>{photoCount} photo{photoCount === 1 ? '' : 's'}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Answers */}
          <Text style={[styles.sectionTitle, { textAlign }]}>Responses</Text>
          <View style={styles.card}>
            {rows.length === 0 ? (
              <Text style={[styles.help, { textAlign }]}>No responses recorded.</Text>
            ) : (
              rows.map((r, i) => (
                <View key={r.id} style={[styles.answerRow, i > 0 && styles.answerRowBorder]}>
                  <Text style={[styles.answerLabel, { textAlign }]}>{r.label}</Text>
                  <Text style={[styles.answerValue, { textAlign }]}>{r.text}</Text>
                </View>
              ))
            )}
          </View>

          {/* Inspector signature */}
          <Text style={[styles.sectionTitle, { textAlign }]}>Inspector signature</Text>
          <View style={styles.card}>
            <SignatureView value={submission.signature_data} height={110} />
            {!!submission.printed_name && (
              <Text style={[styles.signedName, { textAlign }]}>{submission.printed_name}</Text>
            )}
          </View>

          {/* Decision */}
          {decided ? (
            <View style={[styles.card, styles.decidedCard]}>
              <Ionicons
                name={submission.approval_status === 'approved' ? 'checkmark-circle' : 'close-circle'}
                size={20}
                color={submission.approval_status === 'approved' ? '#16a34a' : '#dc2626'}
              />
              <Text style={[styles.decidedText, { textAlign }]}>
                Already {submission.approval_status}
                {submission.approver_name ? ` by ${submission.approver_name}` : ''}.
              </Text>
            </View>
          ) : (
            <>
              <Text style={[styles.sectionTitle, { textAlign }]}>Your decision</Text>
              <View style={styles.card}>
                <Text style={[styles.fieldLabel, { textAlign }]}>Approver signature</Text>
                <SignaturePad onChange={setApproverSig} height={170} />
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.fieldLabel, { textAlign }]}>Approver name</Text>
                  <TextInput
                    style={[styles.input, { textAlign }]}
                    value={approverName}
                    onChangeText={setApproverName}
                    placeholder="Your full name"
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="words"
                  />
                </View>
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.fieldLabel, { textAlign }]}>Note (required to return)</Text>
                  <TextInput
                    style={[styles.input, styles.textArea, { textAlign }]}
                    value={note}
                    onChangeText={setNote}
                    placeholder="Reason if returning to the inspector…"
                    placeholderTextColor="#94a3b8"
                    multiline
                    numberOfLines={3}
                  />
                </View>
              </View>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.rejectBtn, busy && styles.btnDisabled]}
                  onPress={() => decide(false)}
                  disabled={!!busy}
                  activeOpacity={0.85}
                >
                  {busy === 'reject' ? (
                    <ActivityIndicator size="small" color="#dc2626" />
                  ) : (
                    <>
                      <Ionicons name="arrow-undo-outline" size={18} color="#dc2626" />
                      <Text style={styles.rejectText}>Return</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.approveBtn, busy && styles.btnDisabled]}
                  onPress={() => decide(true)}
                  disabled={!!busy}
                  activeOpacity={0.88}
                >
                  {busy === 'approve' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                      <Text style={styles.approveText}>Approve</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  center: { justifyContent: 'center', alignItems: 'center' },
  rowR: { flexDirection: 'row-reverse' },

  nav: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.07)',
  },
  navBack: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  navTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#0f172a' },

  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 12 },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  summaryText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#334155' },
  scorePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(22,163,74,0.1)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  scorePillFail: { backgroundColor: 'rgba(220,38,38,0.1)' },
  scorePillText: { fontSize: 11, fontWeight: '800', color: '#15803d' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  metaChipText: { fontSize: 11, fontWeight: '700', color: '#64748b' },

  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginTop: 4 },

  answerRow: { paddingVertical: 10, gap: 3 },
  answerRowBorder: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  answerLabel: { fontSize: 11.5, fontWeight: '700', color: '#64748b' },
  answerValue: { fontSize: 14, fontWeight: '600', color: '#0f172a' },

  signedName: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginTop: 8 },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 8 },
  help: { fontSize: 12, color: '#94a3b8' },
  input: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0f172a',
  },
  textArea: { minHeight: 76, textAlignVertical: 'top' },

  decidedCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  decidedText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#334155' },

  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 14, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#fecaca',
  },
  rejectText: { color: '#dc2626', fontSize: 15, fontWeight: '800' },
  approveBtn: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 14, backgroundColor: '#16a34a',
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  approveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },

  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  stateTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  stateText: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
    backgroundColor: '#16a34a', borderRadius: 12, paddingHorizontal: 18, height: 44, justifyContent: 'center',
  },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
