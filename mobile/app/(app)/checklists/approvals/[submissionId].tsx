/**
 * Checklist approval review - the decision screen
 *
 * THE LADDER IS THE POINT. Before V594 a checklist had one approver field and
 * one waiting state, so a supervisor signature and a final approval were the
 * same event and one person could close a sheet alone. The owner's rule is two
 * sign-offs: the trade fills and signs, a SUPERVISOR signs it off, and only
 * then the AREA MANAGER closes it. This screen shows both rungs - who signed,
 * when, and their actual signature on tap - and offers the button for the rung
 * that is genuinely outstanding, to the person who may act on it.
 *
 * IT NEVER OFFERS A BUTTON THE SERVER WILL REFUSE. guard_checklist_approval_
 * stages rejects a rung signed by the wrong role (42501), a rung signed with no
 * signature, and a CLOSE while any answer still carries a blocking mark
 * (22023). Every one of those is checked here first, through the shared engine,
 * so the reviewer is told BEFORE they sign rather than after.
 *
 * A blocking mark stops a sheet being CLOSED, never being SENT BACK - returning
 * it to the field is how the fault gets fixed, so Return stays available in
 * exactly the state that disables Approve.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, Modal,
  StyleSheet, Alert, ActivityIndicator, StatusBar, Platform, KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../../contexts/AuthContext'
import { useLanguage } from '../../../../contexts/LanguageContext'
import { useGoBack } from '../../../../hooks/useGoBack'
import { canApproveChecklists } from '../../../../lib/permissions'
import { toUserMessage } from '../../../../lib/safeError'
import SignaturePad from '../../../../components/SignaturePad'
import SignatureView from '../../../../components/SignatureView'
import {
  getSubmission, getTemplate, decideApproval,
  ChecklistSubmission, ChecklistTemplate,
} from '../../../../lib/checklists'
import { ChecklistField, isValueField } from '../../../../lib/checklistFields'
import {
  approvalProgress, canDecide, isTwoStage, nextStatusFor, stageFor,
  statusSummary, ApprovalRung, ApprovalStage,
} from '../../../../lib/checklistApproval'
import {
  canClose, fieldOptionSet, markMeta, MARK_ICONS, MARK_TONES, MarkTone,
  TemplateLike, FieldLike,
} from '../../../../lib/checklistMarks'

/** The queue is the parent of this screen, whatever route the user arrived by. */
const APPROVALS_QUEUE = '/(app)/checklists/approvals'

/** SUBMISSION_COLS selects `notes`; the shared row type predates the column. */
type SubmissionRow = ChecklistSubmission & { notes?: Record<string, any> | null }

interface AnswerRow {
  id: string
  label: string
  text: string
  /** Mark styling, present only when the legend actually knows this answer. */
  icon?: string
  tone?: MarkTone
  meaning?: string
  note?: string
}

import { withModuleGuard } from '../../../../components/ModuleGuard'

export default withModuleGuard(ChecklistApprovalReviewScreen, 'approvals')

function ChecklistApprovalReviewScreen() {
  const { profile, isSuperAdmin } = useAuth()
  const { t, isRTL } = useLanguage()
  const params = useLocalSearchParams<{ submissionId?: string }>()
  const submissionId = String(params.submissionId ?? '')

  // Never a no-op: pops history, and lands on the queue when there is none
  // (a push-notification tap or a deep link arrives with no history at all).
  const goBack = useGoBack(APPROVALS_QUEUE)

  const [submission, setSubmission] = useState<SubmissionRow | null>(null)
  const [template, setTemplate] = useState<ChecklistTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [approverSig, setApproverSig] = useState<string | null>(null)
  const [approverName, setApproverName] = useState(profile?.full_name || profile?.username || '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)
  const [sigView, setSigView] = useState<{ title: string; name: string | null; value: string } | null>(null)

  // Kept out of `load`'s dependency list: `t` gets a new identity whenever the
  // language provider re-renders, which would otherwise refetch on re-render.
  const tRef = useRef(t)
  tRef.current = t

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const allowed = canApproveChecklists(profile?.role)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const s = (await getSubmission(submissionId)) as SubmissionRow | null
      if (!s) { setSubmission(null); setLoading(false); return }
      setSubmission(s)
      if (s.template_id) {
        try { setTemplate(await getTemplate(s.template_id)) } catch { /* labels degrade to field ids */ }
      }
    } catch (e: any) {
      setLoadError(toUserMessage(e, tRef.current('modules.checklistApprovals.loadOneError')))
    } finally {
      setLoading(false)
    }
  }, [submissionId])

  useEffect(() => { load() }, [load])

  const tplLike = template as unknown as TemplateLike | null
  const twoStage = isTwoStage(template)

  const fmtDateTime = useCallback((iso?: string | null) => (
    iso
      ? new Date(iso).toLocaleString(dateLocale, {
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      : t('common.notAvailable')
  ), [dateLocale, t])

  /** Rung wording lives in the locale file; the engine owns the rung ITSELF. */
  const rungLabel = useCallback((rung: ApprovalRung) => (
    rung.key === 'area_manager'
      ? t('modules.checklistApprovals.stageAreaManager')
      : twoStage
        ? t('modules.checklistApprovals.stageSupervisor')
        : t('modules.checklistApprovals.stageApproval')
  ), [t, twoStage])

  /** Same split for the status line: engine picks the tone, locale the words. */
  const statusText = useCallback((s: SubmissionRow | null) => {
    const st = String(s?.approval_status ?? '')
    if (st === 'approved') return t('modules.checklistApprovals.statusClosed')
    if (st === 'rejected') return t('modules.checklistApprovals.statusSentBack')
    if (st === 'pending_area_manager') return t('modules.checklistApprovals.statusWaitingAreaManager')
    if (st === 'pending') {
      return twoStage
        ? t('modules.checklistApprovals.statusWaitingSupervisor')
        : t('modules.checklistApprovals.statusWaitingApproval')
    }
    return t('modules.checklistApprovals.statusNoApproval')
  }, [t, twoStage])

  // Answers to display: template value-fields in order (falls back to raw keys),
  // each carrying its mark icon + meaning and the fitter's remark when there is
  // one - a fail with no reason reads as "nothing to report" without it.
  const rows: AnswerRow[] = useMemo(() => {
    const answers = submission?.answers ?? {}
    const notes = submission?.notes ?? {}
    const fields = template?.fields ?? []
    const asText = (field: ChecklistField, value: any): string => {
      if (value == null || value === '') return t('common.notAvailable')
      if (Array.isArray(value)) return value.length ? value.join(', ') : t('common.notAvailable')
      if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
      if (field.type === 'rating') return `${value}/5`
      return String(value)
    }
    if (fields.length) {
      return fields.filter(f => isValueField(f.type)).map(f => {
        const raw = answers[f.id]
        const set = fieldOptionSet(tplLike, f as unknown as FieldLike)
        const first = Array.isArray(raw) ? raw[0] : raw
        const meta = markMeta(set, first)
        const remark = String((notes as Record<string, any>)?.[f.id] ?? '').trim()
        return {
          id: f.id,
          label: f.label || f.id,
          text: asText(f, raw),
          icon: meta.known ? MARK_ICONS[meta.icon]?.ionicon : undefined,
          tone: meta.known ? meta.tone : undefined,
          meaning: meta.known ? meta.meaning : undefined,
          note: remark || undefined,
        }
      })
    }
    return Object.entries(answers).map(([k, v]) => ({
      id: k, label: k, text: asText({ type: 'text' } as ChecklistField, v),
    }))
  }, [submission, template, tplLike, t])

  const photoCount = useMemo(() => {
    const p = submission?.photos ?? {}
    return Object.values(p).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
  }, [submission])

  const progress = useMemo(() => approvalProgress(template, submission), [template, submission])
  const stage: ApprovalStage | null = stageFor(template, submission)
  const myTurn = canDecide(template, submission, profile?.role, { isSuperAdmin })
  // Only the rung that CLOSES the sheet is blocked by an outstanding fault.
  const closing = Boolean(stage) && nextStatusFor(template, submission, true) === 'approved'
  const closeCheck = useMemo(() => (
    tplLike && closing ? canClose(tplLike, submission?.answers ?? {}) : { ok: true, blocking: [] as Array<{ id: string; label: string; value: string }> }
  ), [tplLike, closing, submission])
  const blockedFromClosing = closing && !closeCheck.ok

  async function decide(approved: boolean) {
    if (!submission || busy) return
    const name = approverName.trim()
    if (approved) {
      if (blockedFromClosing) {
        Alert.alert(
          t('modules.checklistApprovals.cannotCloseTitle'),
          t('modules.checklistApprovals.cannotCloseMsg'),
        )
        return
      }
      if (!approverSig) {
        Alert.alert(
          t('modules.checklistApprovals.signatureRequired'),
          t('modules.checklistApprovals.signatureRequiredMsg'),
        )
        return
      }
      if (!name) {
        Alert.alert(
          t('modules.checklistApprovals.nameRequired'),
          t('modules.checklistApprovals.nameRequiredMsg'),
        )
        return
      }
    } else if (!note.trim()) {
      Alert.alert(
        t('modules.checklistApprovals.reasonRequired'),
        t('modules.checklistApprovals.reasonRequiredMsg'),
      )
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
        template,
        submission,
      })
      const title = !approved
        ? t('modules.checklistApprovals.sentBackTitle')
        : res.status === 'pending_area_manager'
          ? t('modules.checklistApprovals.signedOffTitle')
          : t('modules.checklistApprovals.approvedTitle')
      const body = !approved
        ? t('modules.checklistApprovals.sentBackMsg')
        : res.status === 'pending_area_manager'
          ? t('modules.checklistApprovals.signedOffMsg')
          : t('modules.checklistApprovals.approvedMsg')
      const tail = res.offline ? ' ' + t('modules.checklistApprovals.willSync') : ''
      // Straight back to the queue - that is the list the reviewer is working
      // through, and the row they just signed is gone from it. The old flow
      // asked "stay here or go back", which on a screen opened from a
      // notification could leave them at Home instead.
      goBack()
      Alert.alert(title, body + tail)
    } catch (e: any) {
      Alert.alert(t('modules.checklistApprovals.saveFailed'), toUserMessage(e, t('common.tryAgain')))
    } finally {
      setBusy(null)
    }
  }

  // Loading / error / not-found / not-permitted
  const nav = (title: string) => (
    <View style={[styles.nav, isRTL && styles.rowR]}>
      <TouchableOpacity onPress={goBack} style={styles.navBack} accessibilityRole="button" accessibilityLabel={t('common.back')}>
        <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
      </TouchableOpacity>
      <Text style={[styles.navTitle, { textAlign }]} numberOfLines={1}>{title}</Text>
    </View>
  )

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />
        {nav(t('modules.checklistApprovals.reviewTitle'))}
        <View style={styles.stateWrap}>
          <Ionicons name="lock-closed-outline" size={52} color="#cbd5e1" />
          <Text style={styles.stateTitle}>{t('modules.checklistApprovals.notAvailable')}</Text>
          <Text style={styles.stateText}>{t('modules.checklistApprovals.notAvailableMsg')}</Text>
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
        {nav(t('modules.checklistApprovals.reviewTitle'))}
        <View style={styles.stateWrap}>
          <Ionicons name={loadError ? 'cloud-offline-outline' : 'help-circle-outline'} size={52} color={loadError ? '#fca5a5' : '#cbd5e1'} />
          <Text style={styles.stateTitle}>
            {loadError ? t('modules.checklistApprovals.loadOneFailed') : t('modules.checklistApprovals.notFound')}
          </Text>
          <Text style={styles.stateText}>
            {loadError || t('modules.checklistApprovals.notFoundMsg')}
          </Text>
          {!!loadError && (
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load() }}>
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    )
  }

  const summaryTone = statusSummary(template, submission).tone
  const toneColor = summaryTone === 'good' ? '#16a34a' : summaryTone === 'bad' ? '#dc2626' : summaryTone === 'warn' ? '#b45309' : '#64748b'

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {nav(submission.title || submission.template_name || t('modules.checklists.checklistFallback'))}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Where this sheet has got to */}
          <View style={[styles.statusBar, { borderColor: toneColor }]}>
            <Ionicons
              name={summaryTone === 'good' ? 'checkmark-circle' : summaryTone === 'bad' ? 'close-circle' : 'hourglass-outline'}
              size={18}
              color={toneColor}
            />
            <Text style={[styles.statusText, { color: toneColor, textAlign }]}>{statusText(submission)}</Text>
          </View>

          {/* Summary */}
          <View style={styles.card}>
            <View style={[styles.summaryRow, isRTL && styles.rowR]}>
              <Ionicons name="document-text-outline" size={16} color="#64748b" />
              <Text style={[styles.summaryText, { textAlign }]} numberOfLines={1}>
                {submission.template_name || t('common.notAvailable')}
              </Text>
            </View>
            {!!submission.document_no && (
              <View style={[styles.summaryRow, isRTL && styles.rowR]}>
                <Ionicons name="pricetag-outline" size={16} color="#64748b" />
                <Text style={[styles.summaryText, { textAlign }]} numberOfLines={1}>{submission.document_no}</Text>
              </View>
            )}
            {!!(submission.site || submission.asset_no) && (
              <View style={[styles.summaryRow, isRTL && styles.rowR]}>
                <Ionicons name="location-outline" size={16} color="#64748b" />
                <Text style={[styles.summaryText, { textAlign }]} numberOfLines={1}>
                  {[submission.site, submission.asset_no].filter(Boolean).join(' | ')}
                </Text>
              </View>
            )}
            <View style={[styles.summaryRow, isRTL && styles.rowR]}>
              <Ionicons name="time-outline" size={16} color="#64748b" />
              <Text style={[styles.summaryText, { textAlign }]}>{fmtDateTime(submission.submitted_at)}</Text>
            </View>
            <View style={[styles.summaryRow, isRTL && styles.rowR]}>
              {submission.score_pct != null && (
                <View style={[styles.scorePill, submission.score_passed === false && styles.scorePillFail]}>
                  <Ionicons name="ribbon-outline" size={12} color={submission.score_passed === false ? '#dc2626' : '#15803d'} />
                  <Text style={[styles.scorePillText, submission.score_passed === false && { color: '#dc2626' }]}>
                    {submission.score_pct}%
                  </Text>
                </View>
              )}
              {photoCount > 0 && (
                <View style={styles.metaChip}>
                  <Ionicons name="image-outline" size={12} color="#64748b" />
                  <Text style={styles.metaChipText}>
                    {photoCount} {photoCount === 1 ? t('modules.checklistApprovals.photo') : t('modules.checklistApprovals.photos')}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* The sign-off ladder */}
          <Text style={[styles.sectionTitle, { textAlign }]}>{t('modules.checklistApprovals.signOffs')}</Text>
          <View style={styles.card}>
            {/* Rung 0 is the person who filled it in - the ladder starts there. */}
            <RungRow
              index={1}
              label={t('modules.checklistApprovals.stageFilledBy')}
              name={submission.printed_name}
              at={submission.submitted_at}
              done
              current={false}
              signature={submission.signature_data}
              isRTL={isRTL}
              textAlign={textAlign}
              fmtDateTime={fmtDateTime}
              onOpen={sig => setSigView({ title: t('modules.checklistApprovals.stageFilledBy'), name: submission.printed_name, value: sig })}
              tapHint={t('modules.checklistApprovals.tapToSee')}
              notSignedYet={t('modules.checklistApprovals.notSignedYet')}
            />
            {progress.map((rung, i) => (
              <RungRow
                key={rung.key}
                index={i + 2}
                label={rungLabel(rung)}
                name={rung.name}
                at={rung.at}
                done={rung.done}
                current={rung.current}
                signature={rung.signature}
                isRTL={isRTL}
                textAlign={textAlign}
                fmtDateTime={fmtDateTime}
                onOpen={sig => setSigView({ title: rungLabel(rung), name: rung.name, value: sig })}
                tapHint={t('modules.checklistApprovals.tapToSee')}
                notSignedYet={t('modules.checklistApprovals.notSignedYet')}
              />
            ))}
          </View>

          {/* Responses */}
          <Text style={[styles.sectionTitle, { textAlign }]}>{t('modules.checklistApprovals.responses')}</Text>
          <View style={styles.card}>
            {rows.length === 0 ? (
              <Text style={[styles.help, { textAlign }]}>{t('modules.checklistApprovals.noResponses')}</Text>
            ) : (
              rows.map((r, i) => (
                <View key={r.id} style={[styles.answerRow, i > 0 && styles.answerRowBorder]}>
                  <Text style={[styles.answerLabel, { textAlign }]}>{r.label}</Text>
                  <View style={[styles.answerValueRow, isRTL && styles.rowR]}>
                    {!!r.icon && !!r.tone && (
                      <View style={[styles.markDot, { backgroundColor: MARK_TONES[r.tone].bg }]}>
                        <Ionicons name={r.icon as any} size={13} color={MARK_TONES[r.tone].fg} />
                      </View>
                    )}
                    <Text
                      style={[
                        styles.answerValue,
                        { textAlign, flex: 1 },
                        r.tone ? { color: MARK_TONES[r.tone].fg } : null,
                      ]}
                    >
                      {r.text}
                    </Text>
                  </View>
                  {!!r.meaning && <Text style={[styles.answerMeaning, { textAlign }]}>{r.meaning}</Text>}
                  {!!r.note && (
                    <View style={[styles.remarkRow, isRTL && styles.rowR]}>
                      <Ionicons name="chatbubble-ellipses-outline" size={12} color="#64748b" />
                      <Text style={[styles.remarkText, { textAlign }]}>{r.note}</Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>

          {/* Faults that stop a close */}
          {blockedFromClosing && (
            <View style={[styles.card, styles.blockCard]}>
              <View style={[styles.summaryRow, isRTL && styles.rowR]}>
                <Ionicons name="alert-circle-outline" size={18} color="#dc2626" />
                <Text style={[styles.blockTitle, { textAlign }]}>{t('modules.checklistApprovals.cannotCloseTitle')}</Text>
              </View>
              <Text style={[styles.blockText, { textAlign }]}>{t('modules.checklistApprovals.cannotCloseMsg')}</Text>
              {closeCheck.blocking.map(b => (
                <View key={b.id} style={[styles.blockLine, isRTL && styles.rowR]}>
                  <Ionicons name="warning-outline" size={13} color="#dc2626" />
                  <Text style={[styles.blockLineText, { textAlign }]}>{b.label}: {b.value}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Decision */}
          {!stage ? (
            <View style={[styles.card, styles.decidedCard]}>
              <Ionicons
                name={submission.approval_status === 'approved' ? 'checkmark-circle' : 'close-circle'}
                size={20}
                color={submission.approval_status === 'approved' ? '#16a34a' : '#dc2626'}
              />
              <Text style={[styles.decidedText, { textAlign }]}>{statusText(submission)}</Text>
            </View>
          ) : !myTurn ? (
            <View style={[styles.card, styles.decidedCard]}>
              <Ionicons name="people-outline" size={20} color="#b45309" />
              <Text style={[styles.decidedText, { textAlign }]}>
                {t('modules.checklistApprovals.notYourRung')} {statusText(submission)}
              </Text>
            </View>
          ) : (
            <>
              <Text style={[styles.sectionTitle, { textAlign }]}>{t('modules.checklistApprovals.yourDecision')}</Text>
              <View style={styles.card}>
                <Text style={[styles.fieldLabel, { textAlign }]}>
                  {closing
                    ? t('modules.checklistApprovals.areaManagerSignature')
                    : t('modules.checklistApprovals.supervisorSignature')}
                </Text>
                {/* `value` re-hydrates the pad: without it, reopening this
                    screen showed a blank pad over a captured signature and
                    Clear then erased what was there. */}
                <SignaturePad value={approverSig} onChange={setApproverSig} height={170} />
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.fieldLabel, { textAlign }]}>{t('modules.checklistApprovals.yourName')}</Text>
                  <TextInput
                    style={[styles.input, { textAlign }]}
                    value={approverName}
                    onChangeText={setApproverName}
                    placeholder={t('modules.checklistApprovals.yourNamePlaceholder')}
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="words"
                  />
                </View>
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.fieldLabel, { textAlign }]}>{t('modules.checklistApprovals.noteLabel')}</Text>
                  <TextInput
                    style={[styles.input, styles.textArea, { textAlign }]}
                    value={note}
                    onChangeText={setNote}
                    placeholder={t('modules.checklistApprovals.notePlaceholder')}
                    placeholderTextColor="#94a3b8"
                    multiline
                    numberOfLines={3}
                  />
                </View>
              </View>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.rejectBtn, !!busy && styles.btnDisabled]}
                  onPress={() => decide(false)}
                  disabled={!!busy}
                  activeOpacity={0.85}
                >
                  {busy === 'reject' ? (
                    <ActivityIndicator size="small" color="#dc2626" />
                  ) : (
                    <>
                      <Ionicons name="arrow-undo-outline" size={18} color="#dc2626" />
                      <Text style={styles.rejectText}>{t('modules.checklistApprovals.sendBack')}</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.approveBtn, (!!busy || blockedFromClosing) && styles.btnDisabled]}
                  onPress={() => decide(true)}
                  disabled={!!busy || blockedFromClosing}
                  activeOpacity={0.88}
                >
                  {busy === 'approve' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                      <Text style={styles.approveText}>
                        {closing
                          ? t('modules.checklistApprovals.approveAndClose')
                          : t('modules.checklistApprovals.signOff')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* A signed rung, opened */}
      <Modal visible={!!sigView} transparent animationType="fade" onRequestClose={() => setSigView(null)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <View style={[styles.modalHead, isRTL && styles.rowR]}>
              <Text style={[styles.modalTitle, { textAlign }]} numberOfLines={1}>{sigView?.title ?? ''}</Text>
              <TouchableOpacity onPress={() => setSigView(null)} style={styles.modalClose} accessibilityRole="button" accessibilityLabel={t('common.close')}>
                <Ionicons name="close" size={20} color="#0f172a" />
              </TouchableOpacity>
            </View>
            <SignatureView value={sigView?.value} height={190} />
            {!!sigView?.name && <Text style={[styles.signedName, { textAlign }]}>{sigView.name}</Text>}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

/** One rung of the ladder. Tappable only when there is a signature to show. */
function RungRow(props: {
  index: number
  label: string
  name?: string | null
  at?: string | null
  done: boolean
  current: boolean
  signature?: string | null
  isRTL: boolean
  textAlign: 'left' | 'right'
  fmtDateTime: (iso?: string | null) => string
  onOpen: (sig: string) => void
  tapHint: string
  notSignedYet: string
}) {
  const {
    index, label, name, at, done, current, signature,
    isRTL, textAlign, fmtDateTime, onOpen, tapHint, notSignedYet,
  } = props
  const hasSig = typeof signature === 'string' && !!signature.trim()
  const tint = done ? '#16a34a' : current ? '#b45309' : '#94a3b8'

  const body = (
    <View style={[styles.rung, isRTL && styles.rowR]}>
      <View style={[styles.rungDot, { borderColor: tint, backgroundColor: done ? 'rgba(22,163,74,0.12)' : 'transparent' }]}>
        {done
          ? <Ionicons name="checkmark" size={14} color={tint} />
          : <Text style={[styles.rungIndex, { color: tint }]}>{index}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rungLabel, { textAlign }]} numberOfLines={1}>{label}</Text>
        <Text style={[styles.rungMeta, { textAlign }]} numberOfLines={1}>
          {done || name ? [name, at ? fmtDateTime(at) : null].filter(Boolean).join(' | ') : notSignedYet}
        </Text>
        {hasSig && <Text style={[styles.rungHint, { textAlign }]}>{tapHint}</Text>}
      </View>
      {hasSig && <Ionicons name="eye-outline" size={16} color="#64748b" />}
    </View>
  )

  return hasSig
    ? <TouchableOpacity activeOpacity={0.7} onPress={() => onOpen(signature as string)}>{body}</TouchableOpacity>
    : body
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

  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 14, padding: 12,
    borderWidth: 1.5,
  },
  statusText: { flex: 1, fontSize: 13.5, fontWeight: '800' },

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

  rung: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  rungDot: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  rungIndex: { fontSize: 12, fontWeight: '800' },
  rungLabel: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  rungMeta: { fontSize: 11.5, fontWeight: '600', color: '#64748b', marginTop: 1 },
  rungHint: { fontSize: 10.5, fontWeight: '700', color: '#2563eb', marginTop: 2 },

  answerRow: { paddingVertical: 10, gap: 3 },
  answerRowBorder: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  answerLabel: { fontSize: 11.5, fontWeight: '700', color: '#64748b' },
  answerValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  answerValue: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  answerMeaning: { fontSize: 11, fontWeight: '600', color: '#94a3b8' },
  markDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  remarkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  remarkText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#475569', fontStyle: 'italic' },

  blockCard: { borderColor: '#fecaca', backgroundColor: '#fff5f5', gap: 4 },
  blockTitle: { flex: 1, fontSize: 13.5, fontWeight: '800', color: '#dc2626' },
  blockText: { fontSize: 12, fontWeight: '600', color: '#7f1d1d', marginBottom: 4 },
  blockLine: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  blockLineText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: '#7f1d1d' },

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

  modalScrim: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  modalCard: { width: '100%', maxWidth: 460, backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  modalTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#0f172a' },
  modalClose: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },

  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  stateTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  stateText: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
    backgroundColor: '#16a34a', borderRadius: 12, paddingHorizontal: 18, height: 44, justifyContent: 'center',
  },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
