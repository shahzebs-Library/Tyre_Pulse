/**
 * Inspection approval review
 *
 * Opens one pending inspection for sign-off: shows the recorded tyre conditions
 * (coloured by condition), the odometer/hour readings + observations, and the
 * inspector's drawn signature, then lets a supervisor either APPROVE - capturing
 * their own drawn signature + name and locking the record - or RETURN it with a
 * note that re-opens it to the field.
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
import { useTheme } from '../../../../contexts/ThemeContext'
import { Theme, spacing, radius } from '../../../../lib/theme'
import { toUserMessage } from '../../../../lib/safeError'
import SignaturePad from '../../../../components/SignaturePad'
import SignatureView from '../../../../components/SignatureView'
import { conditionColor, conditionLabel } from '../../../../lib/inspectionReportPdf'
import {
  getInspectionForApproval, decideInspection, InspectionApprovalItem,
} from '../../../../lib/inspectionApprovals'

export default function InspectionApprovalReviewScreen() {
  const { profile, canAccess } = useAuth()
  const { isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const c = theme.color
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string }>()
  const id = String(params.id ?? '')

  const [insp, setInsp] = useState<InspectionApprovalItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [approverSig, setApproverSig] = useState<string | null>(null)
  const [approverName, setApproverName] = useState(profile?.full_name || profile?.username || '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const allowed = canAccess('approvals')
  const statusBarStyle = theme.mode === 'dark' ? 'light-content' : 'dark-content'

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)/inspection/approvals')
  }, [router])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setInsp(await getInspectionForApproval(id))
    } catch (e: any) {
      setLoadError(toUserMessage(e, 'Could not load this inspection.'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const positions = useMemo(() => {
    const conds = insp?.tyre_conditions ?? {}
    return Object.keys(conds)
  }, [insp])

  async function decide(approved: boolean) {
    if (!insp || busy) return
    const name = approverName.trim()
    if (approved) {
      if (!approverSig) { Alert.alert('Signature required', 'Sign in the approver box to approve this inspection.'); return }
      if (!name) { Alert.alert('Name required', 'Enter your name to record who approved.'); return }
    } else if (!note.trim()) {
      Alert.alert('Reason required', 'Add a short note so the inspector knows what to fix.'); return
    }

    setBusy(approved ? 'approve' : 'reject')
    try {
      await decideInspection({
        id: insp.id,
        approved,
        approverName: name || (profile?.full_name ?? ''),
        approverSignature: approverSig,
        approverId: profile?.id ?? null,
        reviewNote: note.trim() || null,
        existingNotes: insp.notes,
      })
      Alert.alert(
        approved ? 'Inspection approved' : 'Inspection returned',
        `The inspection has been ${approved ? 'approved' : 'returned to the field'}.`,
        [{ text: 'Done', onPress: goBack }],
      )
    } catch (e: any) {
      Alert.alert('Could not save decision', toUserMessage(e, 'Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  const nav = (title: string) => (
    <View style={[styles.nav, isRTL && styles.rowR]}>
      <TouchableOpacity onPress={goBack} style={styles.navBack}>
        <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={c.text} />
      </TouchableOpacity>
      <Text style={[styles.navTitle, { textAlign }]} numberOfLines={1}>{title}</Text>
    </View>
  )

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle={statusBarStyle} backgroundColor={c.bg} />
        {nav('Approval')}
        <View style={styles.stateWrap}>
          <Ionicons name="lock-closed-outline" size={52} color={c.borderStrong} />
          <Text style={styles.stateTitle}>Not available</Text>
          <Text style={styles.stateText}>Inspection approvals are limited to supervisors and managers.</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <StatusBar barStyle={statusBarStyle} backgroundColor={c.bg} />
        <ActivityIndicator size="large" color={c.primary} />
      </SafeAreaView>
    )
  }

  if (loadError || !insp) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle={statusBarStyle} backgroundColor={c.bg} />
        {nav('Approval')}
        <View style={styles.stateWrap}>
          <Ionicons name={loadError ? 'cloud-offline-outline' : 'help-circle-outline'} size={52} color={loadError ? c.danger.base : c.borderStrong} />
          <Text style={styles.stateTitle}>{loadError ? "Couldn't load inspection" : 'Inspection not found'}</Text>
          <Text style={styles.stateText}>{loadError || 'It may have already been reviewed or removed.'}</Text>
          {loadError && (
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load() }}>
              <Ionicons name="refresh" size={16} color={c.onPrimary} />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    )
  }

  const decided = insp.approval_status !== 'pending_approval'
  const when = insp.created_at
    ? new Date(insp.created_at).toLocaleString(dateLocale, {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : 'N/A'
  const conds = insp.tyre_conditions ?? {}

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={statusBarStyle} backgroundColor={c.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {nav([insp.asset_no, insp.vehicle_type].filter(Boolean).join(' · ') || 'Inspection')}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <View style={styles.card}>
            {!!insp.site && (
              <View style={[styles.summaryRow, isRTL && styles.rowR]}>
                <Ionicons name="location-outline" size={16} color={c.textMuted} />
                <Text style={[styles.summaryText, { textAlign }]}>{insp.site}</Text>
              </View>
            )}
            <View style={[styles.summaryRow, isRTL && styles.rowR]}>
              <Ionicons name="person-outline" size={16} color={c.textMuted} />
              <Text style={[styles.summaryText, { textAlign }]}>{insp.inspector || 'Inspector'}</Text>
            </View>
            <View style={[styles.summaryRow, isRTL && styles.rowR]}>
              <Ionicons name="time-outline" size={16} color={c.textMuted} />
              <Text style={[styles.summaryText, { textAlign }]}>{when}</Text>
            </View>
            {(insp.odometer_km != null || insp.hour_meter != null) && (
              <View style={[styles.summaryRow, isRTL && styles.rowR]}>
                <Ionicons name="speedometer-outline" size={16} color={c.textMuted} />
                <Text style={[styles.summaryText, { textAlign }]}>
                  {[insp.odometer_km != null ? `${insp.odometer_km} km` : '', insp.hour_meter != null ? `${insp.hour_meter} h` : '']
                    .filter(Boolean).join('  ·  ')}
                </Text>
              </View>
            )}
          </View>

          {/* Tyre conditions */}
          <Text style={[styles.sectionTitle, { textAlign }]}>Tyre conditions ({positions.length})</Text>
          <View style={styles.card}>
            {positions.length === 0 ? (
              <Text style={[styles.help, { textAlign }]}>No tyre conditions recorded.</Text>
            ) : (
              <View style={styles.tyreGrid}>
                {positions.map(pos => {
                  const d = conds[pos] ?? {}
                  const color = conditionColor(d?.condition ?? d?.risk)
                  const sub = [
                    d?.tread_depth_mm ? `${d.tread_depth_mm}mm` : null,
                    d?.pressure_psi ? `${d.pressure_psi}psi` : null,
                  ].filter(Boolean).join(' · ')
                  return (
                    <View key={pos} style={[styles.tyreCell, { backgroundColor: color }]}>
                      <Text style={styles.tyrePos}>{pos}</Text>
                      <Text style={styles.tyreCond}>{conditionLabel(d)}</Text>
                      {!!sub && <Text style={styles.tyreSub}>{sub}</Text>}
                    </View>
                  )
                })}
              </View>
            )}
          </View>

          {/* Observations */}
          {!!(insp.findings || insp.notes) && (
            <>
              <Text style={[styles.sectionTitle, { textAlign }]}>Observations</Text>
              <View style={styles.card}>
                <Text style={[styles.obsText, { textAlign }]}>{insp.findings || insp.notes}</Text>
              </View>
            </>
          )}

          {/* Inspector signature */}
          <Text style={[styles.sectionTitle, { textAlign }]}>Inspector signature</Text>
          <View style={styles.card}>
            <SignatureView value={insp.inspector_signature} height={110} />
            {!!insp.inspector && <Text style={[styles.signedName, { textAlign }]}>{insp.inspector}</Text>}
          </View>

          {/* Decision */}
          {decided ? (
            <View style={[styles.card, styles.decidedCard]}>
              <Ionicons
                name={insp.approval_status === 'approved' ? 'checkmark-circle' : 'close-circle'}
                size={20}
                color={insp.approval_status === 'approved' ? c.success.base : c.danger.base}
              />
              <Text style={[styles.decidedText, { textAlign }]}>Already {insp.approval_status}.</Text>
            </View>
          ) : (
            <>
              <Text style={[styles.sectionTitle, { textAlign }]}>Your decision</Text>
              <View style={styles.card}>
                <Text style={[styles.fieldLabel, { textAlign }]}>Approver signature</Text>
                <SignaturePad onChange={setApproverSig} height={170} penColor={c.text} />
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.fieldLabel, { textAlign }]}>Approver name</Text>
                  <TextInput
                    style={[styles.input, { textAlign }]}
                    value={approverName}
                    onChangeText={setApproverName}
                    placeholder="Your full name"
                    placeholderTextColor={c.textMuted}
                    autoCapitalize="words"
                  />
                </View>
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.fieldLabel, { textAlign }]}>Note (required to return)</Text>
                  <TextInput
                    style={[styles.input, styles.textArea, { textAlign }]}
                    value={note}
                    onChangeText={setNote}
                    placeholder="Reason if returning to the inspector..."
                    placeholderTextColor={c.textMuted}
                    multiline
                    numberOfLines={3}
                  />
                </View>
              </View>

              <View style={styles.actions}>
                <TouchableOpacity style={[styles.rejectBtn, busy && styles.btnDisabled]} onPress={() => decide(false)} disabled={!!busy} activeOpacity={0.85}>
                  {busy === 'reject' ? <ActivityIndicator size="small" color={c.danger.base} /> : (
                    <>
                      <Ionicons name="arrow-undo-outline" size={18} color={c.danger.base} />
                      <Text style={styles.rejectText}>Return</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.approveBtn, busy && styles.btnDisabled]} onPress={() => decide(true)} disabled={!!busy} activeOpacity={0.88}>
                  {busy === 'approve' ? <ActivityIndicator size="small" color={c.onPrimary} /> : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color={c.onPrimary} />
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

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    center: { justifyContent: 'center', alignItems: 'center' },
    rowR: { flexDirection: 'row-reverse' },
    nav: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12, backgroundColor: c.surface,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    navBack: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    navTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: c.text },
    scroll: { flex: 1 },
    content: { padding: 16, paddingBottom: 48, gap: 12 },
    card: { backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border },
    summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    summaryText: { flex: 1, fontSize: 13, fontWeight: '600', color: c.textSecondary },
    sectionTitle: { fontSize: 14, fontWeight: '800', color: c.text, marginTop: 4 },
    tyreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tyreCell: { borderRadius: 10, padding: 8, minWidth: 84 },
    tyrePos: { fontSize: 13, fontWeight: '800', color: '#fff' },
    tyreCond: { fontSize: 11, fontWeight: '700', color: '#fff', opacity: 0.95, marginTop: 2 },
    tyreSub: { fontSize: 10, color: '#fff', opacity: 0.9, marginTop: 2 },
    obsText: { fontSize: 13, color: c.text, lineHeight: 19 },
    signedName: { fontSize: 13, fontWeight: '700', color: c.text, marginTop: 8 },
    fieldLabel: { fontSize: 12, fontWeight: '700', color: c.textSecondary, marginBottom: 8 },
    help: { fontSize: 12, color: c.textMuted },
    input: {
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.borderStrong,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: c.text,
    },
    textArea: { minHeight: 76, textAlignVertical: 'top' },
    decidedCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    decidedText: { flex: 1, fontSize: 13, fontWeight: '700', color: c.textSecondary },
    actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
    rejectBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      height: 52, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.danger.soft,
    },
    rejectText: { color: c.danger.base, fontSize: 15, fontWeight: '800' },
    approveBtn: {
      flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      height: 52, borderRadius: 14, backgroundColor: c.primary,
    },
    approveText: { color: c.onPrimary, fontSize: 15, fontWeight: '800' },
    btnDisabled: { opacity: 0.5 },
    stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    stateTitle: { fontSize: 17, fontWeight: '800', color: c.text, textAlign: 'center' },
    stateText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 300 },
    retryBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
      backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 18, height: 44, justifyContent: 'center',
    },
    retryText: { color: c.onPrimary, fontSize: 14, fontWeight: '700' },
  })
}
