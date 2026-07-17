/**
 * Checklists — operator hub
 *
 * Section A "Due"  → the operator's pending/overdue assignments (overdue-first),
 *                    each opening the fill screen pre-linked to the assignment.
 * Section B "All"  → every published template as a card, opening a blank fill.
 *
 * Reads are country-scoped through the checklists service. Errors degrade
 * gracefully: a missing backing table shows a friendly "not enabled yet" state
 * instead of a raw Postgres error, everything else offers a retry.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../../lib/theme'
import {
  Screen, AppText, Badge, EmptyState, ErrorState, Loading,
} from '../../../components/ui'
import {
  listTemplates, listAssignments, listPendingApprovals,
  ChecklistTemplate, ChecklistAssignment,
} from '../../../lib/checklists'
import { isValueField } from '../../../lib/checklistFields'
import { canApproveChecklists } from '../../../lib/permissions'

// Local midnight ISO date (YYYY-MM-DD) — assignment due_date is a plain date.
function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

// Whole-day delta between a YYYY-MM-DD due date and today (negative = overdue).
function daysUntil(due: string): number {
  const d = new Date(due + 'T00:00:00').getTime()
  const t = new Date(todayStr() + 'T00:00:00').getTime()
  return Math.round((d - t) / 86400000)
}

function relativeHint(due: string, t: (k: string) => string): string {
  const n = daysUntil(due)
  if (n === 0) return t('modules.checklists.dueToday')
  if (n < 0) return `${Math.abs(n)} ${t('modules.checklists.daysOverdue')}`
  return `${t('modules.checklists.dueIn')} ${n} ${t('modules.checklists.days')}`
}

// An assignment is effectively overdue when pending and its due date has passed.
function effectiveStatus(a: ChecklistAssignment): 'pending' | 'overdue' {
  if (a.status === 'overdue') return 'overdue'
  return daysUntil(a.due_date) < 0 ? 'overdue' : 'pending'
}

// Distinguish "table not provisioned" from real failures so we can show a calm
// empty state rather than an alarming database error to field users.
function looksLikeMissingTable(msg: string): boolean {
  const m = (msg || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache')
}

export default function ChecklistsScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const router = useRouter()

  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [assignments, setAssignments] = useState<ChecklistAssignment[]>([])
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notEnabled, setNotEnabled] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const canApprove = canApproveChecklists(profile?.role)

  const load = useCallback(async () => {
    setError(null)
    setNotEnabled(false)
    try {
      const [as, ts] = await Promise.all([
        listAssignments(profile?.country),
        listTemplates(profile?.country),
      ])
      setAssignments(as)
      setTemplates(ts)
    } catch (e: any) {
      const msg = e?.message || e?.error_description || t('modules.checklists.loadError')
      if (looksLikeMissingTable(msg)) setNotEnabled(true)
      else setError(msg)
    } finally {
      setLoading(false)
    }
    // Approver badge — best-effort, never blocks the operator's own view.
    if (canApprove) {
      try {
        const pend = await listPendingApprovals(profile?.country)
        setPendingApprovals(pend.length)
      } catch { setPendingApprovals(0) }
    }
  }, [profile?.country, canApprove])

  useEffect(() => { load() }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  // Due list: pending/overdue only, overdue-first then soonest due date.
  const due = useMemo(() => {
    return assignments
      .filter(a => a.status === 'pending' || a.status === 'overdue' || effectiveStatus(a) === 'overdue')
      .filter(a => a.status !== 'completed' && a.status !== 'skipped')
      .sort((x, y) => {
        const dx = daysUntil(x.due_date)
        const dy = daysUntil(y.due_date)
        return dx - dy
      })
  }, [assignments])

  function openAssignment(a: ChecklistAssignment) {
    router.push({
      pathname: '/(app)/checklists/[templateId]',
      params: {
        templateId: a.template_id ?? '',
        assignment: a.id,
        site: a.site ?? '',
        asset_no: a.asset_no ?? '',
      },
    })
  }

  function openTemplate(t: ChecklistTemplate) {
    router.push({
      pathname: '/(app)/checklists/[templateId]',
      params: { templateId: t.id },
    })
  }

  function fieldCount(t: ChecklistTemplate): number {
    return (t.fields ?? []).filter(f => isValueField(f.type)).length
  }

  // Everything above the (potentially long) "All checklists" template list. The
  // Due list is bounded per-operator so it stays a plain map inside the header;
  // only the unbounded templates list below is virtualized via FlatList.
  const listHeader = (
    <View style={{ gap: spacing.md }}>
      {/* Approver entry (elevated roles) */}
      {canApprove && (
        <TouchableOpacity
          style={[styles.approvalsCard, isRTL && styles.rowR]}
          activeOpacity={0.8}
          onPress={() => router.push('/(app)/checklists/approvals')}
        >
          <View style={styles.approvalsIcon}>
            <Ionicons name="shield-checkmark-outline" size={20} color={theme.color.warning.on} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText style={[typography.bodyStrong, { textAlign }]}>{t('modules.checklists.approvals')}</AppText>
            <AppText variant="caption" style={[{ color: theme.color.warning.on, textAlign, marginTop: 2 }]}>
              {pendingApprovals > 0
                ? `${pendingApprovals} ${t('modules.checklists.awaitingSignoff')}`
                : t('modules.checklists.reviewSignoff')}
            </AppText>
          </View>
          {pendingApprovals > 0 && (
            <View style={styles.approvalsBadge}>
              <AppText style={[typography.micro, { color: theme.color.onPrimary }]}>{pendingApprovals}</AppText>
            </View>
          )}
          <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={theme.color.textMuted} />
        </TouchableOpacity>
      )}

      {/* Section A - Due */}
      <View style={styles.sectionHead}>
        <AppText style={typography.h3}>{t('modules.checklists.due')}</AppText>
        {due.length > 0 && (
          <View style={styles.countPill}>
            <AppText style={[typography.micro, { color: theme.color.danger.on }]}>{due.length}</AppText>
          </View>
        )}
      </View>

      {due.length === 0 ? (
        <View style={styles.inlineEmpty}>
          <Ionicons name="checkmark-done-outline" size={22} color={theme.color.primary} />
          <AppText style={[typography.body, { fontWeight: '700', color: theme.color.primaryDark }]}>{t('modules.checklists.noneDue')}</AppText>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {due.map(a => {
            const st = effectiveStatus(a)
            const overdue = st === 'overdue'
            const dueLabel = new Date(a.due_date + 'T00:00:00').toLocaleDateString(dateLocale, {
              day: 'numeric', month: 'short', year: 'numeric',
            })
            return (
              <TouchableOpacity
                key={a.id}
                style={[styles.dueCard, isRTL && styles.rowR]}
                activeOpacity={0.75}
                onPress={() => openAssignment(a)}
              >
                <View style={[styles.dueIcon, overdue && styles.dueIconOverdue]}>
                  <Ionicons
                    name={overdue ? 'alert-circle-outline' : 'time-outline'}
                    size={20}
                    color={overdue ? theme.color.danger.base : theme.color.warning.base}
                  />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <AppText style={[typography.title, { textAlign }]} numberOfLines={1}>
                    {a.template_name ?? t('modules.checklists.checklistFallback')}
                  </AppText>
                  <View style={[styles.metaRow, isRTL && styles.rowR]}>
                    {!!(a.site || a.asset_no) && (
                      <>
                        <Ionicons name="location-outline" size={12} color={theme.color.textMuted} />
                        <AppText style={styles.metaText} numberOfLines={1}>
                          {[a.site, a.asset_no].filter(Boolean).join(' · ')}
                        </AppText>
                      </>
                    )}
                  </View>
                  <View style={[styles.metaRow, isRTL && styles.rowR]}>
                    <Ionicons name="calendar-outline" size={12} color={theme.color.textMuted} />
                    <AppText style={styles.metaText}>{dueLabel}</AppText>
                    <AppText style={styles.metaDot}>·</AppText>
                    <AppText style={[styles.hintText, overdue && styles.hintOverdue]}>
                      {relativeHint(a.due_date, t)}
                    </AppText>
                  </View>
                </View>
                <Badge kind={overdue ? 'danger' : 'warning'}>{overdue ? t('modules.checklists.overdue') : t('modules.checklists.pending')}</Badge>
              </TouchableOpacity>
            )
          })}
        </View>
      )}

      {/* Section B - All checklists (list rendered by FlatList below) */}
      <View style={[styles.sectionHead, { marginTop: 8 }]}>
        <AppText style={typography.h3}>{t('modules.checklists.allChecklists')}</AppText>
      </View>
    </View>
  )

  return (
    <Screen>
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.checklists.title')}</AppText>
          <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 2 }}>
            {due.length} {t('modules.checklists.dueWord')} · {templates.length} {t('modules.checklists.availableWord')}
          </AppText>
        </View>
      </View>

      {loading ? (
        <Loading />
      ) : notEnabled ? (
        <EmptyState
          icon="checkbox-outline"
          title={t('modules.checklists.notEnabledTitle')}
          message={t('modules.checklists.notEnabledMsg')}
        />
      ) : error ? (
        <ErrorState message={error} onRetry={onRefresh} />
      ) : (
        <FlatList
          data={templates}
          keyExtractor={item => item.id}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          windowSize={11}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <View style={styles.inlineEmpty}>
              <Ionicons name="document-outline" size={22} color={theme.color.textMuted} />
              <AppText style={[typography.body, { fontWeight: '700', color: theme.color.textMuted }]}>{t('modules.checklists.noPublished')}</AppText>
            </View>
          }
          renderItem={({ item: tpl }) => (
            <TouchableOpacity
              style={styles.tplCard}
              activeOpacity={0.75}
              onPress={() => openTemplate(tpl)}
            >
              <View style={[styles.tplHead, isRTL && styles.rowR]}>
                <View style={styles.tplIcon}>
                  <Ionicons name={(tpl.icon as any) || 'checkbox-outline'} size={20} color={theme.color.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText style={[typography.title, { textAlign }]} numberOfLines={1}>{tpl.name}</AppText>
                  {!!tpl.category && (
                    <AppText style={[styles.tplCategory, { textAlign }]} numberOfLines={1}>{tpl.category}</AppText>
                  )}
                </View>
                <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={theme.color.textMuted} />
              </View>

              <View style={[styles.badgeRow, isRTL && styles.rowR]}>
                <View style={styles.badge}>
                  <Ionicons name="list-outline" size={12} color={theme.color.textSecondary} />
                  <AppText style={styles.badgeText}>{fieldCount(tpl)} {t('modules.checklists.fields')}</AppText>
                </View>
                {tpl.scored && (
                  <View style={[styles.badge, styles.badgeGreen]}>
                    <Ionicons name="ribbon-outline" size={12} color={theme.color.primary} />
                    <AppText style={[styles.badgeText, { color: theme.color.primaryDark }]}>{t('modules.checklists.scored')}</AppText>
                  </View>
                )}
                {tpl.require_signature && (
                  <View style={[styles.badge, styles.badgeBlue]}>
                    <Ionicons name="create-outline" size={12} color={theme.color.info.base} />
                    <AppText style={[styles.badgeText, { color: theme.color.info.on }]}>{t('modules.checklists.signature')}</AppText>
                  </View>
                )}
                {tpl.require_approval && (
                  <View style={[styles.badge, styles.badgeAmber]}>
                    <Ionicons name="shield-checkmark-outline" size={12} color={theme.color.warning.base} />
                    <AppText style={[styles.badgeText, { color: theme.color.warning.on }]}>{t('modules.checklists.approval')}</AppText>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
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
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.border,
    },

    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md },

    approvalsCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: c.warning.soft, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.warning.base,
    },
    approvalsIcon: {
      width: 40, height: 40, borderRadius: radius.md,
      backgroundColor: c.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    approvalsBadge: {
      minWidth: 22, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm,
      backgroundColor: c.warning.base, alignItems: 'center',
    },

    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    countPill: {
      minWidth: 22, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm,
      backgroundColor: c.danger.soft, alignItems: 'center',
    },

    inlineEmpty: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border,
    },

    dueCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
    },
    dueIcon: {
      width: 40, height: 40, borderRadius: radius.md,
      backgroundColor: c.warning.soft,
      alignItems: 'center', justifyContent: 'center',
    },
    dueIconOverdue: { backgroundColor: c.danger.soft },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
    metaText: { ...typography.caption, color: c.textMuted },
    metaDot: { ...typography.caption, color: c.textMuted },
    hintText: { ...typography.caption, fontWeight: '700', color: c.warning.on },
    hintOverdue: { color: c.danger.base },

    tplCard: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm,
      borderWidth: 1, borderColor: c.border,
    },
    tplHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    tplIcon: {
      width: 40, height: 40, borderRadius: radius.md,
      backgroundColor: c.primarySoft,
      alignItems: 'center', justifyContent: 'center',
    },
    tplCategory: { ...typography.caption, color: c.textMuted, marginTop: 2 },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    badge: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      backgroundColor: c.surfaceAlt, borderRadius: radius.sm,
      paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    },
    badgeGreen: { backgroundColor: c.primarySoft },
    badgeBlue: { backgroundColor: c.info.soft },
    badgeAmber: { backgroundColor: c.warning.soft },
    badgeText: { ...typography.micro, color: c.textSecondary },
  })
}
