/**
 * Checklist fill & submit (visual, tap-to-record)
 *
 * Redesigned to mirror the tyre inspection's tap-a-thing feel: every checklist
 * item is a big, iconic tile showing its live state (Pass / Fail / a value or
 * "Tap to record"). Tapping a tile opens ChecklistItemSheet - a bottom sheet
 * with large icon buttons - so a non-technical operator records one item at a
 * time with gloves in the sun. A sticky progress bar shows "X of Y done".
 *
 * The data model, validation, optional scoring, signature capture and the
 * offline-safe submit path are unchanged (submitChecklist through the record
 * queue); only the presentation is new. Fields whose `visibleWhen` condition
 * isn't met are hidden and recomputed live as answers change.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../../lib/theme'
import { AppText, Screen, Badge, EmptyState, ErrorState, Loading } from '../../../components/ui'
import ChecklistItemSheet, { optionTone } from '../../../components/ChecklistItemSheet'
import { getTemplate, submitChecklist, ChecklistTemplate } from '../../../lib/checklists'
import { toUserMessage } from '../../../lib/safeError'
import {
  ChecklistField, blankAnswer, isValueField, isFieldVisible,
  validateSubmission, computeScore, isAutoField, resolveAutoValue,
  isFieldAnswered, fieldSummaryText,
} from '../../../lib/checklistFields'

type IconName = keyof typeof Ionicons.glyphMap

function looksLikeMissingTable(msg: string): boolean {
  const m = (msg || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache')
}

// A friendly icon per field type for the tile.
function fieldIcon(f: ChecklistField): IconName {
  switch (f.type) {
    case 'boolean': return 'checkmark-done-circle-outline'
    case 'select': return 'options-outline'
    case 'multiselect': return 'apps-outline'
    case 'rating': return 'star-outline'
    case 'number': return 'calculator-outline'
    case 'date': return 'calendar-outline'
    case 'textarea': return 'document-text-outline'
    case 'asset': return 'car-outline'
    case 'site': return 'business-outline'
    case 'user': return 'person-outline'
    case 'photo': return 'camera-outline'
    case 'signature': return 'create-outline'
    default: return 'create-outline'
  }
}

export default function ChecklistFillScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const c = theme.color
  const router = useRouter()
  const params = useLocalSearchParams<{
    templateId?: string; assignment?: string; site?: string; asset_no?: string
  }>()
  const templateId = String(params.templateId ?? '')
  const assignmentId = params.assignment ? String(params.assignment) : null

  const [template, setTemplate] = useState<ChecklistTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notEnabled, setNotEnabled] = useState(false)

  const [title, setTitle] = useState('')
  const [site, setSite] = useState(params.site ? String(params.site) : '')
  const [assetNo, setAssetNo] = useState(params.asset_no ? String(params.asset_no) : '')
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [photos, setPhotos] = useState<Record<string, string[]>>({})
  const [printedName, setPrintedName] = useState('')
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null)

  const textAlign = isRTL ? 'right' : 'left'

  // Back = previous screen when there is history, else the checklists list.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)/checklists')
  }, [router])

  const load = useCallback(async () => {
    setLoadError(null)
    setNotEnabled(false)
    try {
      const tpl = await getTemplate(templateId)
      if (!tpl) { setTemplate(null); setLoading(false); return }
      setTemplate(tpl)
      setTitle(tpl.name ?? '')
      const today = new Date().toISOString().slice(0, 10)
      const userName = profile?.full_name || profile?.username || ''
      const seed: Record<string, any> = {}
      for (const f of tpl.fields ?? []) {
        if (isValueField(f.type)) {
          seed[f.id] = isAutoField(f) ? resolveAutoValue(f, { userName, today }) : blankAnswer(f)
        }
      }
      setAnswers(seed)
    } catch (e: any) {
      const msg = toUserMessage(e, t('modules.checklistFill.loadError'))
      if (looksLikeMissingTable(msg)) setNotEnabled(true)
      else setLoadError(msg)
    } finally {
      setLoading(false)
    }
  }, [templateId, profile])

  useEffect(() => { load() }, [load])

  const setAnswer = useCallback((id: string, value: any) => {
    setAnswers(prev => ({ ...prev, [id]: value }))
    setErrors(prev => (prev[id] ? { ...prev, [id]: '' } : prev))
  }, [])

  const setFieldPhotos = useCallback((id: string, urls: string[]) => {
    setPhotos(prev => ({ ...prev, [id]: urls }))
  }, [])

  // Only currently-visible fields are rendered / validated / scored.
  const visibleFields = useMemo(
    () => (template?.fields ?? []).filter(f => isFieldVisible(f, answers)),
    [template, answers],
  )

  // Progress across recordable (non-section) visible items.
  const { total, done } = useMemo(() => {
    const items = visibleFields.filter(f => f.type !== 'section')
    const d = items.filter(f => isFieldAnswered(f, answers, photos, signatureData)).length
    return { total: items.length, done: d }
  }, [visibleFields, answers, photos, signatureData])

  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const activeField = useMemo(
    () => visibleFields.find(f => f.id === activeFieldId) ?? null,
    [visibleFields, activeFieldId],
  )

  async function handleSubmit() {
    if (!template || submitting) return

    const { valid, errors: errs } = validateSubmission(template.fields, answers)
    if (!valid) {
      setErrors(errs)
      const first = Object.values(errs)[0]
      Alert.alert(t('modules.checklistFill.reviewTitle'), first || t('modules.checklistFill.reviewMsg'))
      return
    }
    setErrors({})

    const name = printedName.trim() || (profile?.full_name ?? '')
    if (template.require_signature) {
      if (!signatureData) {
        Alert.alert(t('modules.checklistFill.signatureRequired'), t('modules.checklistFill.signatureRequiredMsg'))
        return
      }
      if (!name) {
        Alert.alert(t('modules.checklistFill.nameRequired'), t('modules.checklistFill.nameRequiredMsg'))
        return
      }
    }

    let score_pct: number | null = null
    let score_passed: boolean | null = null
    if (template.scored) {
      const s = computeScore(template.fields, answers, template.pass_threshold ?? null)
      score_pct = s.pct
      score_passed = s.passed
    }

    setSubmitting(true)
    try {
      const res = await submitChecklist({
        template,
        answers,
        photos,
        printed_name: printedName.trim() || (profile?.full_name ?? null),
        signature_data: signatureData,
        site: site.trim() || null,
        asset_no: assetNo.trim() || null,
        title: title.trim() || template.name,
        country: profile?.country ?? null,
        assignmentId: assignmentId || null,
        score_pct,
        score_passed,
      })

      if (res.offline) {
        Alert.alert(t('modules.checklistFill.savedOnDevice'), t('modules.checklistFill.savedOnDeviceMsg'), [
          { text: t('common.ok'), onPress: goBack },
        ])
      } else {
        const scoreLine = template.scored && score_pct != null
          ? `\n\n${t('modules.checklistFill.scoreLabel')} ${score_pct}%${score_passed != null ? ` (${score_passed ? t('modules.checklistFill.passed') : t('modules.checklistFill.failed')})` : ''}`
          : ''
        Alert.alert(t('modules.checklistFill.submittedTitle'), `${t('modules.checklistFill.submittedMsg')}${scoreLine}`, [
          { text: t('common.done'), onPress: goBack },
        ])
      }
    } catch (e: any) {
      Alert.alert(t('modules.checklistFill.submitFailTitle'), toUserMessage(e, t('modules.checklistFill.submitFailMsg')))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Header (shared) ─────────────────────────────────────────────────────────
  const header = (
    <View style={[styles.nav, isRTL && styles.rowR]}>
      <TouchableOpacity onPress={goBack} style={styles.navBack}>
        <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={c.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <AppText variant="h3" style={{ textAlign }} numberOfLines={1}>
          {template?.name ?? t('modules.checklists.checklistFallback')}
        </AppText>
        {!!template?.category && (
          <AppText variant="caption" color="muted" style={{ textAlign }} numberOfLines={1}>
            {template.category}
          </AppText>
        )}
      </View>
      {template?.scored && <Badge kind="success">{t('modules.checklists.scored')}</Badge>}
    </View>
  )

  // ── Loading / not-enabled / error / not-found ───────────────────────────────
  if (loading) {
    return <Screen>{header}<Loading /></Screen>
  }
  if (notEnabled) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="checkbox-outline"
          title={t('modules.checklists.notEnabledTitle')}
          message={t('modules.checklists.notEnabledMsg')}
        />
      </Screen>
    )
  }
  if (loadError) {
    return (
      <Screen>
        {header}
        <ErrorState message={loadError} onRetry={() => { setLoading(true); load() }} />
      </Screen>
    )
  }
  if (!template) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="help-circle-outline"
          title={t('modules.checklistFill.notFoundTitle')}
          message={t('modules.checklistFill.notFoundMsg')}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      {header}

      {/* Sticky progress */}
      <View style={styles.progressBar}>
        <View style={[styles.progressHead, isRTL && styles.rowR]}>
          <AppText variant="label" color="secondary">
            {done} {t('modules.checklistFill.of')} {total} {t('modules.checklistFill.doneWord')}
          </AppText>
          <AppText variant="label" style={{ color: pct === 100 ? c.success.base : c.textMuted }}>
            {pct}%
          </AppText>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: pct === 100 ? c.success.base : c.primary }]} />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Context: title / asset / site */}
        <View style={styles.card}>
          <AppText variant="label" color="secondary" style={{ marginBottom: 6 }}>{t('modules.checklistFill.titleLabel')}</AppText>
          <TextInput
            style={[styles.input, { textAlign }]}
            value={title}
            onChangeText={setTitle}
            placeholder={template.name}
            placeholderTextColor={c.textMuted}
          />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <AppText variant="label" color="secondary" style={{ marginBottom: 6, marginTop: spacing.md }}>{t('modules.checklistFill.assetNo')}</AppText>
              <TextInput
                style={[styles.input, { textAlign }]}
                value={assetNo}
                onChangeText={setAssetNo}
                placeholder={t('modules.checklistFill.assetPlaceholder')}
                placeholderTextColor={c.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="label" color="secondary" style={{ marginBottom: 6, marginTop: spacing.md }}>{t('modules.checklistFill.site')}</AppText>
              <TextInput
                style={[styles.input, { textAlign }]}
                value={site}
                onChangeText={setSite}
                placeholder={t('modules.checklistFill.site')}
                placeholderTextColor={c.textMuted}
              />
            </View>
          </View>
        </View>

        {/* Item tiles + section headings */}
        {visibleFields.map(field => {
          if (field.type === 'section') {
            return (
              <View key={field.id} style={styles.section}>
                <AppText variant="h3" style={{ textAlign }}>{field.label || t('modules.checklistFill.sectionFallback')}</AppText>
                {!!field.help && (
                  <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 4 }}>{field.help}</AppText>
                )}
              </View>
            )
          }

          const answered = isFieldAnswered(field, answers, photos, signatureData)
          const summary = fieldSummaryText(field, answers, photos, signatureData)
          const locked = isAutoField(field)
          const err = errors[field.id]

          // Tile status pill tone: pass/fail from option semantics where possible.
          let pillKind: 'success' | 'danger' | 'neutral' | 'info' = answered ? 'info' : 'neutral'
          if (answered) {
            if (field.type === 'boolean') pillKind = answers[field.id] === true ? 'success' : 'danger'
            else if (field.type === 'select') {
              const t = optionTone(String(answers[field.id] ?? ''))
              pillKind = t === 'pass' ? 'success' : t === 'fail' ? 'danger' : t === 'na' ? 'neutral' : 'info'
            }
          }
          const iconTint =
            pillKind === 'success' ? c.success.base
            : pillKind === 'danger' ? c.danger.base
            : answered ? c.primary : c.textMuted

          return (
            <TouchableOpacity
              key={field.id}
              style={[
                styles.tile,
                isRTL && styles.rowR,
                answered && { borderColor: c.borderStrong },
                !!err && { borderColor: c.danger.base, backgroundColor: c.danger.soft },
              ]}
              activeOpacity={locked ? 1 : 0.75}
              onPress={() => setActiveFieldId(field.id)}
            >
              <View style={[styles.tileIcon, { backgroundColor: answered ? c.primarySoft : c.surfaceAlt }]}>
                <Ionicons name={locked ? 'lock-closed-outline' : fieldIcon(field)} size={22} color={iconTint} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={[typography.title, { textAlign }]} numberOfLines={2}>
                  {field.label || t('modules.checklistFill.itemFallback')}
                  {field.required ? <AppText style={{ color: c.danger.base }}> *</AppText> : null}
                </AppText>
                {!!err ? (
                  <AppText variant="caption" style={{ color: c.danger.base, textAlign, marginTop: 2, fontWeight: '700' }} numberOfLines={2}>
                    {err}
                  </AppText>
                ) : summary ? (
                  <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }} numberOfLines={2}>
                    {summary}
                  </AppText>
                ) : field.help ? (
                  <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 2 }} numberOfLines={2}>
                    {field.help}
                  </AppText>
                ) : (
                  <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 2 }}>
                    {t('modules.checklistFill.tapToRecord')}
                  </AppText>
                )}
              </View>
              {answered ? (
                <Ionicons name="checkmark-circle" size={22} color={iconTint} />
              ) : (
                <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={c.textMuted} />
              )}
            </TouchableOpacity>
          )
        })}

        {/* Submit */}
        <View style={{ marginTop: spacing.sm }}>
          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.55 }]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.9}
          >
            <Ionicons name="cloud-upload-outline" size={19} color={c.onPrimary} />
            <AppText style={[typography.h3, { color: c.onPrimary }]}>
              {submitting ? t('modules.checklistFill.submitting') : t('modules.checklistFill.submitChecklist')}
            </AppText>
          </TouchableOpacity>
          {template.require_signature && !signatureData && (
            <AppText variant="caption" color="muted" center style={{ marginTop: spacing.sm }}>
              {t('modules.checklistFill.signatureNeeded')}
            </AppText>
          )}
        </View>
      </ScrollView>

      {/* Tap-to-record popup */}
      <ChecklistItemSheet
        visible={!!activeField}
        field={activeField}
        value={activeField ? answers[activeField.id] : undefined}
        photos={activeField ? (photos[activeField.id] ?? []) : []}
        printedName={printedName}
        signatureData={signatureData}
        country={profile?.country ?? null}
        error={activeField ? errors[activeField.id] : undefined}
        onChange={v => activeField && setAnswer(activeField.id, v)}
        onPhotos={urls => activeField && setFieldPhotos(activeField.id, urls)}
        onPrintedName={setPrintedName}
        onSignature={setSignatureData}
        onClose={() => setActiveFieldId(null)}
      />
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },

    nav: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    },
    navBack: {
      width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.surface,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.border,
    },

    progressBar: {
      paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 6,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    track: { height: 8, borderRadius: 4, backgroundColor: c.surfaceSunken, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4 },

    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md },

    card: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border,
    },
    row2: { flexDirection: 'row', gap: spacing.md },
    input: {
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
      ...typography.body, color: c.text,
    },

    section: { marginTop: spacing.sm, paddingBottom: 2 },

    tile: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
      minHeight: 72,
    },
    tileIcon: {
      width: 46, height: 46, borderRadius: radius.md,
      alignItems: 'center', justifyContent: 'center',
    },

    submitBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.primary, borderRadius: radius.md, height: 56,
    },
  })
}
