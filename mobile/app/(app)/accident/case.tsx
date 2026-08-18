/**
 * Accident Case Status - READ-ONLY.
 *
 * A field user opens an accident and sees its workflow case status plus the
 * per-workstream progress (which team is Done / In progress / Pending / Not
 * required). Mobile mirror of the web CaseCompletionPanel. There is NO edit /
 * write action here by design - view only.
 *
 * Follows the accidents module permission (same role guard + ModuleGuard as the
 * accident detail screen); it does NOT widen access. Degrades honestly: when the
 * case model is not provisioned yet (web migration not applied) it shows a "not
 * yet activated" note rather than an error.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { useRoleGuard } from '../../../hooks/useRoleGuard'
import { withModuleGuard } from '../../../components/ModuleGuard'
import { Theme, spacing, StatusKind } from '../../../lib/theme'
import { Screen, Card, AppText, Badge, Loading, ErrorState, EmptyState } from '../../../components/ui'
import { toUserMessage } from '../../../lib/safeError'
import {
  loadAccidentCase, caseChipFor, AccidentCaseResult, CaseChip,
} from '../../../lib/accidentCase'
import { backTo } from '../../../lib/goBack'

type IconName = React.ComponentProps<typeof Ionicons>['name']

const CHIP_KIND: Record<CaseChip, StatusKind> = {
  done: 'success',
  in_progress: 'info',
  pending: 'warning',
  not_required: 'neutral',
}
const CHIP_ICON: Record<CaseChip, IconName> = {
  done: 'checkmark-circle-outline',
  in_progress: 'time-outline',
  pending: 'ellipse-outline',
  not_required: 'remove-circle-outline',
}

/** Humanise a DB status/stage token for display (data, not a UI label). */
function humanise(token: unknown): string {
  const s = String(token ?? '').trim()
  if (!s) return ''
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

export default withModuleGuard(AccidentCaseScreen, 'accidents')

function AccidentCaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { allowed, loading: guardLoading } = useRoleGuard(['admin', 'manager', 'director', 'inspector'])
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const c = theme.color
  const styles = useMemo(() => createStyles(theme), [theme])
  const router = useRouter()

  const [result, setResult] = useState<AccidentCaseResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function goBack() {
    backTo(router, '/(app)/accident/dashboard')
  }

  const load = useCallback(async () => {
    if (!allowed || !id) return
    setLoading(true)
    setError(null)
    try {
      const res = await loadAccidentCase(id, { country: profile?.country })
      setResult(res)
    } catch (e: any) {
      if (__DEV__) console.warn('[accident/case] load failed:', e?.message)
      setError(toUserMessage(e, t('accident.case.loadError')))
    } finally {
      setLoading(false)
    }
  }, [allowed, id, profile?.country, t])

  useEffect(() => { load() }, [load])

  const header = (
    <View style={[styles.header, isRTL && { flexDirection: 'row-reverse' }]}>
      <TouchableOpacity style={styles.iconBtn} onPress={goBack}>
        <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={22} color={c.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <AppText variant="h3" numberOfLines={1}>{t('accident.case.title')}</AppText>
        <AppText variant="micro" color="muted">{t('accident.case.subtitle')}</AppText>
      </View>
    </View>
  )

  if (guardLoading || !allowed || loading) {
    return <Screen>{header}<Loading label={t('common.loading')} /></Screen>
  }
  if (error) {
    return <Screen>{header}<ErrorState message={error} onRetry={load} /></Screen>
  }
  if (!result) {
    return (
      <Screen>
        {header}
        <EmptyState icon="help-circle-outline" title={t('accident.case.notFoundTitle')} message={t('accident.case.notFoundMsg')} />
      </Screen>
    )
  }

  const rec = result.case
  const reference = String(rec.reference_no ?? rec.case_no ?? rec.id.slice(0, 8).toUpperCase())
  const overallStatus = humanise(rec.case_status ?? rec.status)
  const stage = humanise(rec.workflow_stage)
  const severityToken = String(rec.severity ?? '').trim().toLowerCase()
  const severityLabel = severityToken ? t(`accident.severities.${severityToken}`) : ''
  const overallPct = typeof rec.completion_overall === 'number' ? rec.completion_overall : null

  return (
    <Screen>
      {header}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* Case header card */}
        <Card style={{ gap: spacing.sm }}>
          <View style={styles.refRow}>
            <Ionicons name="folder-open-outline" size={16} color={c.primary} />
            <AppText variant="bodyStrong" style={{ flex: 1 }}>{reference}</AppText>
            {severityLabel ? (
              <Badge kind={severityToken === 'minor' ? 'success' : severityToken === 'moderate' ? 'warning' : 'critical'}>
                {severityLabel}
              </Badge>
            ) : null}
          </View>
          {overallStatus ? (
            <InfoRow label={t('accident.case.overallStatus')} value={overallStatus} theme={theme} />
          ) : null}
          {stage ? (
            <InfoRow label={t('accident.case.stage')} value={stage} theme={theme} />
          ) : null}
          {overallPct != null ? (
            <InfoRow label={t('accident.case.overallCompletion')} value={`${Math.round(overallPct)}%`} theme={theme} />
          ) : null}
        </Card>

        {/* Not provisioned: honest note, no workstreams to show */}
        {!result.provisioned ? (
          <EmptyState
            icon="construct-outline"
            title={t('accident.case.notActivatedTitle')}
            message={t('accident.case.notActivatedMsg')}
          />
        ) : result.workstreams.length === 0 ? (
          <EmptyState
            icon="list-outline"
            title={t('accident.case.noWorkstreamsTitle')}
            message={t('accident.case.noWorkstreamsMsg')}
          />
        ) : (
          <Card padded={false}>
            <View style={styles.sectionHeader}>
              <Ionicons name="git-branch-outline" size={15} color={c.primary} />
              <AppText variant="label" style={{ color: c.text }}>{t('accident.case.workstreamsTitle')}</AppText>
            </View>
            <View style={styles.list}>
              {result.workstreams.map((w, i) => {
                const chip: CaseChip = caseChipFor(w.status, w.not_applicable)
                const name = t(`accident.case.workstreams.${w.workstream_key}`)
                const label = name && !name.startsWith('accident.case.workstreams.') ? name : humanise(w.workstream_key)
                const kind = CHIP_KIND[chip]
                return (
                  <View
                    key={w.id}
                    style={[styles.wsRow, i < result.workstreams.length - 1 && styles.wsRowBorder]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="bodyStrong">{label}</AppText>
                      {w.team ? <AppText variant="micro" color="muted">{w.team}</AppText> : null}
                      {chip === 'not_required' && w.na_reason ? (
                        <AppText variant="micro" color="muted">{w.na_reason}</AppText>
                      ) : null}
                    </View>
                    <Badge kind={kind} icon={CHIP_ICON[chip]}>
                      {t(`accident.case.chips.${chip}`)}
                    </Badge>
                  </View>
                )
              })}
            </View>
          </Card>
        )}

        <AppText variant="micro" color="muted" center style={{ marginTop: spacing.md }}>
          {t('accident.case.readOnlyNote')}
        </AppText>
        <View style={{ height: 32 }} />
      </ScrollView>
    </Screen>
  )
}

function InfoRow({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
      <AppText variant="caption" color="muted" style={{ flex: 1 }}>{label}</AppText>
      <AppText variant="bodyStrong" style={{ color: theme.color.textSecondary, flex: 2, textAlign: 'right' }}>{value}</AppText>
    </View>
  )
}

function createStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    scroll: { flex: 1 },
    content: { padding: spacing.lg, gap: spacing.md },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      backgroundColor: c.surface,
      borderBottomWidth: 1, borderBottomColor: c.border,
      gap: spacing.sm,
    },
    iconBtn: {
      width: 38, height: 38, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    refRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    sectionHeader: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm + 2,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    list: { padding: spacing.lg, gap: spacing.sm },
    wsRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    wsRowBorder: { borderBottomWidth: 1, borderBottomColor: c.border },
  })
}
