/**
 * Inspection approvals - supervisor queue
 *
 * Lists inspections submitted from the field that are awaiting sign-off
 * (approval_status = 'pending'), newest first. Each row opens a review screen
 * where the supervisor inspects the recorded tyre conditions + the inspector's
 * drawn signature and either approves (with their own signature) or returns it.
 *
 * Access is gated by the `approvals` module (canAccess) in nav AND by the
 * inspections RLS at the database, so hiding the entry is never the only defence.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { View, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../../contexts/AuthContext'
import { useLanguage } from '../../../../contexts/LanguageContext'
import { useTheme } from '../../../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../../../lib/theme'
import { Screen, AppText, Badge, EmptyState, ErrorState, Loading } from '../../../../components/ui'
import { listPendingInspectionApprovals, InspectionApprovalItem } from '../../../../lib/inspectionApprovals'
import { toUserMessage } from '../../../../lib/safeError'

import { withModuleGuard } from '../../../../components/ModuleGuard'

export default withModuleGuard(InspectionApprovalsScreen, 'approvals')

function InspectionApprovalsScreen() {
  const { profile, canAccess } = useAuth()
  const { isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const c = theme.color
  const router = useRouter()

  const [items, setItems] = useState<InspectionApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const allowed = canAccess('approvals')

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return }
    setError(null)
    try {
      setItems(await listPendingInspectionApprovals(profile?.country))
    } catch (e: any) {
      setError(toUserMessage(e, 'Could not load approvals.'))
    } finally {
      setLoading(false)
    }
  }, [allowed, profile?.country])

  useEffect(() => { load() }, [load])
  // Refresh when returning from the review screen (a decision removes an item).
  useFocusEffect(useCallback(() => { load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  function open(s: InspectionApprovalItem) {
    router.push({ pathname: '/(app)/inspection/approvals/[id]', params: { id: s.id } })
  }

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)')
  }, [router])

  const header = (
    <View style={[styles.header, isRTL && styles.rowR]}>
      <TouchableOpacity onPress={goBack} style={styles.backBtn}>
        <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={c.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <AppText variant="h2" style={{ textAlign }}>Inspection Approvals</AppText>
        <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 2 }}>
          {items.length} awaiting sign-off
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
          message="Inspection approvals are limited to supervisors and managers."
        />
      </Screen>
    )
  }

  return (
    <Screen>
      {header}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={onRefresh} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={s => s.id}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          windowSize={11}
          ListEmptyComponent={
            <View style={styles.inlineEmpty}>
              <Ionicons name="checkmark-done-outline" size={22} color={c.primary} />
              <AppText style={[typography.body, { fontWeight: '700', color: c.primaryDark }]}>Nothing awaiting approval</AppText>
            </View>
          }
          renderItem={({ item: s }) => {
            const when = s.created_at
              ? new Date(s.created_at).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })
              : 'N/A'
            return (
              <TouchableOpacity
                style={[styles.card, isRTL && styles.rowR]}
                activeOpacity={0.75}
                onPress={() => open(s)}
              >
                <View style={styles.icon}>
                  <Ionicons name="clipboard-outline" size={20} color={c.warning.base} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <AppText style={[typography.title, { textAlign }]} numberOfLines={1}>
                    {[s.asset_no, s.vehicle_type].filter(Boolean).join(' · ') || s.title || 'Inspection'}
                  </AppText>
                  {!!s.site && (
                    <View style={[styles.metaRow, isRTL && styles.rowR]}>
                      <Ionicons name="location-outline" size={12} color={c.textMuted} />
                      <AppText style={styles.metaText} numberOfLines={1}>{s.site}</AppText>
                    </View>
                  )}
                  <View style={[styles.metaRow, isRTL && styles.rowR]}>
                    <Ionicons name="person-outline" size={12} color={c.textMuted} />
                    <AppText style={styles.metaText} numberOfLines={1}>{s.inspector || 'Inspector'}</AppText>
                    <AppText style={styles.metaText}>|</AppText>
                    <Ionicons name="calendar-outline" size={12} color={c.textMuted} />
                    <AppText style={styles.metaText}>{when}</AppText>
                  </View>
                </View>
                {s.inspector_signature ? (
                  <Ionicons name="create-outline" size={16} color={c.success.base} />
                ) : null}
                <Badge kind="warning">Pending</Badge>
                <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={c.textMuted} />
              </TouchableOpacity>
            )
          }}
        />
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
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border,
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
      width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.warning.soft,
      alignItems: 'center', justifyContent: 'center',
    },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
    metaText: { ...typography.caption, color: c.textMuted },
  })
}
