/**
 * Checklist approvals - supervisor queue
 *
 * Lists submissions from `require_approval` templates that are still pending
 * (approval_status = 'pending'), newest first, each opening a review screen
 * where the approver inspects the inspector's answers + drawn signature and
 * signs off (approve) or returns it with a note (reject).
 *
 * Access is gated to elevated roles both in nav (canApproveChecklists) and at
 * the database (V212 RLS) so hiding the entry is never the only defence. Themed
 * with the shared UI kit so it matches the redesigned checklist surfaces.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../../contexts/AuthContext'
import { useLanguage } from '../../../../contexts/LanguageContext'
import { useTheme } from '../../../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../../../lib/theme'
import { Screen, AppText, Badge, EmptyState, ErrorState, Loading } from '../../../../components/ui'
import { canApproveChecklists } from '../../../../lib/permissions'
import { listPendingApprovals, ChecklistSubmission } from '../../../../lib/checklists'

function looksLikeMissingTable(msg: string): boolean {
  const m = (msg || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache')
}

export default function ChecklistApprovalsScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const c = theme.color
  const router = useRouter()

  const [items, setItems] = useState<ChecklistSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notEnabled, setNotEnabled] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const allowed = canApproveChecklists(profile?.role)

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return }
    setError(null)
    setNotEnabled(false)
    try {
      const rows = await listPendingApprovals(profile?.country)
      setItems(rows)
    } catch (e: any) {
      const msg = e?.message || e?.error_description || 'Could not load approvals.'
      if (looksLikeMissingTable(msg)) setNotEnabled(true)
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }, [allowed, profile?.country])

  useEffect(() => { load() }, [load])
  // Refresh when returning from the detail screen (a decision removes an item).
  useFocusEffect(useCallback(() => { load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  function open(s: ChecklistSubmission) {
    router.push({ pathname: '/(app)/checklists/approvals/[submissionId]', params: { submissionId: s.id } })
  }

  const count = items.length
  const header = (
    <View style={[styles.header, isRTL && styles.rowR]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={c.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <AppText variant="h2" style={{ textAlign }}>Approvals</AppText>
        <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 2 }}>
          {count} awaiting sign-off
        </AppText>
      </View>
    </View>
  )

  if (!allowed) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="lock-closed-outline"
          title="Not available"
          message="Checklist approvals are limited to supervisors and managers."
        />
      </Screen>
    )
  }

  return (
    <Screen>
      {header}
      {loading ? (
        <Loading />
      ) : notEnabled ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title="Approvals aren't enabled yet"
          message="Publish checklist templates with approval required to build a queue here."
        />
      ) : error ? (
        <ErrorState message={error} onRetry={onRefresh} />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {count === 0 ? (
            <View style={styles.inlineEmpty}>
              <Ionicons name="checkmark-done-outline" size={22} color={c.primary} />
              <AppText style={[typography.body, { fontWeight: '700', color: c.primaryDark }]}>Nothing awaiting approval</AppText>
            </View>
          ) : (
            items.map(s => {
              const when = s.submitted_at
                ? new Date(s.submitted_at).toLocaleDateString(dateLocale, {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })
                : 'N/A'
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.card, isRTL && styles.rowR]}
                  activeOpacity={0.75}
                  onPress={() => open(s)}
                >
                  <View style={styles.icon}>
                    <Ionicons name="shield-checkmark-outline" size={20} color={c.warning.base} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <AppText style={[typography.title, { textAlign }]} numberOfLines={1}>
                      {s.title || s.template_name || 'Checklist'}
                    </AppText>
                    {!!(s.site || s.asset_no) && (
                      <View style={[styles.metaRow, isRTL && styles.rowR]}>
                        <Ionicons name="location-outline" size={12} color={c.textMuted} />
                        <AppText style={styles.metaText} numberOfLines={1}>
                          {[s.site, s.asset_no].filter(Boolean).join(' - ')}
                        </AppText>
                      </View>
                    )}
                    <View style={[styles.metaRow, isRTL && styles.rowR]}>
                      <Ionicons name="calendar-outline" size={12} color={c.textMuted} />
                      <AppText style={styles.metaText}>{when}</AppText>
                      {s.score_pct != null && (
                        <>
                          <AppText style={styles.metaText}>|</AppText>
                          <AppText style={[styles.scoreText, { color: s.score_passed === false ? c.danger.base : c.success.base }]}>
                            {s.score_pct}%
                          </AppText>
                        </>
                      )}
                    </View>
                  </View>
                  <Badge kind="warning">Pending</Badge>
                  <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={c.textMuted} />
                </TouchableOpacity>
              )
            })
          )}
        </ScrollView>
      )}
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
    backBtn: {
      width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.surface,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.border,
    },

    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md },

    inlineEmpty: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border,
    },

    card: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
    },
    icon: {
      width: 40, height: 40, borderRadius: radius.md,
      backgroundColor: c.warning.soft,
      alignItems: 'center', justifyContent: 'center',
    },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
    metaText: { ...typography.caption, color: c.textMuted },
    scoreText: { ...typography.caption, fontWeight: '800' },
  })
}
