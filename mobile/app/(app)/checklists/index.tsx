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
  TextInput, ActivityIndicator, Alert,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../../lib/theme'
import {
  Screen, AppText, Badge, EmptyState, ErrorState, Loading,
} from '../../../components/ui'
import {
  listTemplates, listAssignments, listPendingApprovals, listReferenceOptions,
  ChecklistTemplate, ChecklistAssignment,
} from '../../../lib/checklists'
import { isValueField } from '../../../lib/checklistFields'
import { resolveChecklistIcon } from '../../../lib/checklistIcons'
import { roleTargetLabel } from '../../../lib/checklistRoles'
import { templateName as i18nTemplateName } from '../../../lib/checklistI18n'
import { toUserMessage } from '../../../lib/safeError'
import { canApproveChecklists } from '../../../lib/permissions'
import { lookupAssetByCode } from '../../../lib/assetLookup'
import { backTo } from '../../../lib/goBack'
import {
  ChecklistDraft, discardDraft, draftAge, listUserDrafts,
} from '../../../lib/checklistDraft'

/**
 * Route entry. A TYRE MAN gets a search-first single-asset flow (find one asset,
 * then pick its checklist) instead of scrolling the full "Due + All templates"
 * hub. Every other role keeps the existing hub verbatim.
 */
import { withModuleGuard } from '../../../components/ModuleGuard'

export default withModuleGuard(ChecklistsRoute, 'checklists')

function ChecklistsRoute() {
  const { profile } = useAuth()
  if (profile?.role === 'tyre_man') return <TyreManChecklistFlow />
  return <ChecklistsScreen />
}

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

/**
 * Unfinished sheets - "continue by own history".
 *
 * A checklist left half-filled is kept on the device (see lib/checklistDraft.ts;
 * it is deliberately NOT a server row, so an abandoned fill never burns a
 * document number). This is where the operator finds it again: one row per
 * unfinished sheet, saying which machine it is for and when it was last worked
 * on, opening straight back into it.
 *
 * IT RENDERS NOTHING WHEN THERE IS NOTHING TO CONTINUE, so the hub is unchanged
 * for anyone who never leaves a sheet part-filled. A read that FAILED is not
 * the same statement as "you have no unfinished work" and says so instead.
 */
function UnfinishedSheets({ userId, refreshKey }: { userId: string; refreshKey: number }) {
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const router = useRouter()
  const [drafts, setDrafts] = useState<ChecklistDraft[]>([])
  const [unreadable, setUnreadable] = useState(false)
  const textAlign = isRTL ? 'right' : 'left'

  const reload = useCallback(async () => {
    if (!userId) { setDrafts([]); setUnreadable(false); return }
    const load = await listUserDrafts(userId)
    if (!load.ok) { setUnreadable(true); setDrafts([]); return }
    setUnreadable(false)
    setDrafts(load.drafts)
  }, [userId])

  useEffect(() => { void reload() }, [reload, refreshKey])
  // Re-read on focus: a sheet submitted on the fill screen must be gone from
  // this list the moment the operator comes back, not on the next cold start.
  useFocusEffect(useCallback(() => { void reload() }, [reload]))

  const ageLine = useCallback((d: ChecklistDraft) => {
    const age = draftAge(d)
    if (age.unit === 'unknown') return ''
    if (age.unit === 'now') return t('modules.checklistDraft.justNow')
    if (age.unit === 'minutes') return `${age.value} ${t('modules.checklistDraft.minutesAgo')}`
    if (age.unit === 'hours') return `${age.value} ${t('modules.checklistDraft.hoursAgo')}`
    return `${age.value} ${t('modules.checklistDraft.daysAgo')}`
  }, [t])

  function resume(d: ChecklistDraft) {
    router.push({
      pathname: '/(app)/checklists/[templateId]',
      params: {
        templateId: d.templateId,
        asset_no: d.assetNo,
        site: d.site ?? '',
        assignment: d.assignmentId ?? '',
        // The explicit choice. The fill screen restores this sheet straight
        // away rather than offering it again.
        resume: d.key,
      },
    })
  }

  function remove(d: ChecklistDraft) {
    Alert.alert(
      t('modules.checklistDraft.discardTitle'),
      t('modules.checklistDraft.discardMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('modules.checklistDraft.discardConfirm'),
          style: 'destructive',
          onPress: () => {
            discardDraft(d.key)
              .then(reload)
              // A store we could not read keeps its sheet: better to leave work
              // listed than to delete it on a failed read.
              .catch(() => {})
          },
        },
      ],
    )
  }

  if (unreadable) {
    return (
      <View style={{ gap: spacing.md }}>
        <View style={styles.sectionHead}>
          <AppText style={typography.h3}>{t('modules.checklistDraft.sectionTitle')}</AppText>
        </View>
        <View style={styles.inlineEmpty}>
          <Ionicons name="help-circle-outline" size={22} color={theme.color.textMuted} />
          <AppText style={[typography.body, { fontWeight: '700', color: theme.color.textMuted }]}>
            {t('modules.checklistDraft.couldNotCheck')}
          </AppText>
        </View>
      </View>
    )
  }

  if (!drafts.length) return null

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.sectionHead}>
        <AppText style={typography.h3}>{t('modules.checklistDraft.sectionTitle')}</AppText>
        <View style={styles.countPill}>
          <AppText style={[typography.micro, { color: theme.color.danger.on }]}>{drafts.length}</AppText>
        </View>
      </View>
      <View style={{ gap: 10 }}>
        {drafts.map(d => (
          <TouchableOpacity
            key={d.key}
            style={[styles.draftCard, isRTL && styles.rowR]}
            activeOpacity={0.75}
            onPress={() => resume(d)}
          >
            <View style={styles.draftIcon}>
              <Ionicons name="create-outline" size={20} color={theme.color.info.base} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <AppText style={[typography.title, { textAlign }]} numberOfLines={1}>
                {d.templateName || t('modules.checklists.checklistFallback')}
              </AppText>
              <View style={[styles.metaRow, isRTL && styles.rowR]}>
                <Ionicons name="car-outline" size={12} color={theme.color.textMuted} />
                <AppText style={styles.metaText} numberOfLines={1}>
                  {d.assetNo || t('modules.checklistDraft.noAsset')}
                </AppText>
                <AppText style={styles.metaDot}>·</AppText>
                <AppText style={styles.metaText}>
                  {d.filled} {t('modules.checklistFill.of')} {d.total}
                </AppText>
              </View>
              <AppText style={styles.metaText}>{ageLine(d)}</AppText>
            </View>
            <TouchableOpacity
              onPress={() => remove(d)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={t('modules.checklistDraft.discardConfirm')}
            >
              <Ionicons name="close" size={18} color={theme.color.textMuted} />
            </TouchableOpacity>
            <Badge kind="info">{t('modules.checklistDraft.continue')}</Badge>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

function ChecklistsScreen() {
  const { profile, isSuperAdmin } = useAuth()
  const { t, isRTL, language: lang } = useLanguage()
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
  /** Bumped by pull-to-refresh so the unfinished list re-reads with everything
   *  else. Focus already covers returning from a fill. */
  const [draftRefresh, setDraftRefresh] = useState(0)

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const canApprove = canApproveChecklists(profile?.role)
  // The CARD follows the app UI language. (The fill screen has its own content
  // language picker, because a checklist can carry Hindi and Urdu that the app
  // shell does not ship.) A template with no translation falls back to English.
  const contentLang = lang

  const load = useCallback(async () => {
    setError(null)
    setNotEnabled(false)
    try {
      // Role-scoped (V591): a mechanic is offered the mechanics' checklists, a
      // driver theirs, and an untargeted checklist stays everyone's. Passing the
      // role can only ever REMOVE a checklist that explicitly names somebody
      // else, so nothing a person sees today disappears.
      const [as, ts] = await Promise.all([
        listAssignments(profile?.country, profile?.role, { isSuperAdmin }),
        listTemplates(profile?.country, profile?.role, { isSuperAdmin }),
      ])
      setAssignments(as)
      setTemplates(ts)
    } catch (e: any) {
      const msg = toUserMessage(e, t('modules.checklists.loadError'))
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
    // Depends on the PRIMITIVE fields, never the profile object: AuthContext
    // replaces that object on every realtime profile update, and an object dep
    // would re-run this load (and reset the screen) on an unrelated change.
  }, [profile?.country, profile?.role, isSuperAdmin, canApprove])

  useEffect(() => { load() }, [load])

  async function onRefresh() {
    setRefreshing(true)
    setDraftRefresh(n => n + 1)
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
      {/* Unfinished work first: a sheet somebody is part-way through is more
          urgent than anything they have not started. Renders nothing when
          there is none. */}
      <UnfinishedSheets userId={profile?.id ?? ''} refreshKey={draftRefresh} />

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
        <TouchableOpacity onPress={() => backTo(router, '/(app)')} style={styles.backBtn}>
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
          renderItem={({ item: tpl }) => {
            // `icon` is free text holding an emoji, a lucide name or nothing at
            // all. Handing it straight to <Ionicons> drew a BLANK SQUARE for
            // four of the six live templates; the resolver always yields
            // something renderable.
            const ico = resolveChecklistIcon(tpl)
            const forRoles = roleTargetLabel(tpl)
            return (
            <TouchableOpacity
              style={styles.tplCard}
              activeOpacity={0.75}
              onPress={() => openTemplate(tpl)}
            >
              <View style={[styles.tplHead, isRTL && styles.rowR]}>
                <View style={styles.tplIcon}>
                  {ico.kind === 'emoji'
                    ? <AppText style={styles.tplEmoji}>{ico.emoji}</AppText>
                    : <Ionicons name={ico.ionicon as any} size={20} color={theme.color.primary} />}
                </View>
                <View style={{ flex: 1 }}>
                  <AppText style={[typography.title, { textAlign }]} numberOfLines={1}>
                    {i18nTemplateName(tpl, contentLang) || tpl.name}
                  </AppText>
                  {!!tpl.category && (
                    <AppText style={[styles.tplCategory, { textAlign }]} numberOfLines={1}>{tpl.category}</AppText>
                  )}
                </View>
                <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={theme.color.textMuted} />
              </View>

              <View style={[styles.badgeRow, isRTL && styles.rowR]}>
                {/* Rendered only when the checklist names roles: a "For:
                    Everyone" chip on every card is noise. */}
                {!!forRoles && (
                  <View style={[styles.badge, styles.badgePurple]}>
                    <Ionicons name="people-outline" size={12} color={theme.color.textSecondary} />
                    <AppText style={styles.badgeText} numberOfLines={1}>
                      {t('modules.checklists.forRoles')} {forRoles}
                    </AppText>
                  </View>
                )}
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
            )
          }}
        />
      )}
    </Screen>
  )
}

/**
 * Tyre Man flow: search ONE asset, then pick its checklist. No long scrolling
 * list. Step 1 = a search box (2+ chars, compact rows) over the asset options;
 * Step 2 = the published templates, each opening a blank fill pre-linked to the
 * chosen asset. Country-scoped and offline-friendly (asset options + templates
 * are fetched once; template open works from cached data).
 */
function TyreManChecklistFlow() {
  const { profile, isSuperAdmin } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeTmStyles(theme), [theme])
  const router = useRouter()

  const [assets, setAssets] = useState<string[]>([])
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notEnabled, setNotEnabled] = useState(false)

  const [search, setSearch] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [resolvingSite, setResolvingSite] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'

  const load = useCallback(async () => {
    setError(null)
    setNotEnabled(false)
    setLoading(true)
    try {
      const [opts, ts] = await Promise.all([
        listReferenceOptions('asset', profile?.country).catch(() => [] as string[]),
        listTemplates(profile?.country, profile?.role, { isSuperAdmin }),
      ])
      setAssets(Array.isArray(opts) ? opts : [])
      setTemplates(ts)
    } catch (e: any) {
      const msg = toUserMessage(e, t('modules.checklists.loadError'))
      if (looksLikeMissingTable(msg)) setNotEnabled(true)
      else setError(msg)
    } finally {
      setLoading(false)
    }
    // Primitive deps only - see the note on the hub's load().
  }, [profile?.country, profile?.role, isSuperAdmin, t])

  useEffect(() => { load() }, [load])

  // How many assets the picker shows at once. Enough to browse, small enough
  // that a 1,000 asset fleet does not have to render before the first tap.
  const ASSET_LIST_LIMIT = 40
  const query = search.trim().toLowerCase()
  // BROWSING COMES FIRST. This list used to stay empty until two characters
  // were typed, so a tyre man who did not already know the asset code had no
  // way to reach one - the fleet was there and simply never shown. An empty
  // box now lists the first assets and typing narrows them, which is how the
  // screen behaved before the search box was added.
  const matches = useMemo(() => {
    const base = query.length === 0 ? assets : assets.filter(a => a.toLowerCase().includes(query))
    return base.slice(0, ASSET_LIST_LIMIT)
  }, [assets, query])

  const pickAsset = useCallback(async (asset: string) => {
    setSelectedAsset(asset)
    setSelectedSite('')
    setResolvingSite(true)
    // Best-effort site prefill from the fleet master (never blocks the flow).
    try {
      const rec = await lookupAssetByCode(asset)
      setSelectedSite(rec?.site?.trim() || '')
    } catch {
      setSelectedSite('')
    } finally {
      setResolvingSite(false)
    }
  }, [])

  function openTemplateForAsset(tpl: ChecklistTemplate) {
    router.push({
      pathname: '/(app)/checklists/[templateId]',
      params: {
        templateId: tpl.id,
        asset_no: selectedAsset ?? '',
        site: selectedSite,
      },
    })
  }

  function fieldCount(tpl: ChecklistTemplate): number {
    return (tpl.fields ?? []).filter(f => isValueField(f.type)).length
  }

  return (
    <Screen>
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity
          onPress={() => (selectedAsset ? setSelectedAsset(null) : backTo(router, '/(app)'))}
          style={styles.backBtn}
        >
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.checklists.title')}</AppText>
          <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 2 }}>
            {selectedAsset ? selectedAsset : t('modules.checklists.tmPickAsset')}
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
        <ErrorState message={error} onRetry={load} />
      ) : !selectedAsset ? (
        // Step 1 - search one asset. An unfinished sheet comes FIRST: a tyre man
        // who was part-way through one should not have to find the machine
        // again to get back to it.
        <View style={styles.body}>
          <UnfinishedSheets userId={profile?.id ?? ''} refreshKey={0} />
          <View style={[styles.searchBox, isRTL && styles.rowR]}>
            <Ionicons name="search-outline" size={18} color={theme.color.textMuted} />
            <TextInput
              style={[styles.searchInput, { textAlign }]}
              value={search}
              onChangeText={setSearch}
              placeholder={t('modules.checklists.tmSearchPlaceholder')}
              placeholderTextColor={theme.color.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={theme.color.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {matches.length === 0 ? (
            <View style={styles.hintBox}>
              <Ionicons name="car-outline" size={26} color={theme.color.textMuted} />
              <AppText style={[typography.body, { fontWeight: '700', color: theme.color.textSecondary, textAlign: 'center' }]}>
                {t('modules.checklists.tmSearchHint')}
              </AppText>
            </View>
          ) : (
            <FlatList
              data={matches}
              keyExtractor={(item, i) => `${item}-${i}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.assetRow, isRTL && styles.rowR]} activeOpacity={0.75} onPress={() => pickAsset(item)}>
                  <Ionicons name="car-outline" size={18} color={theme.color.primary} />
                  <AppText style={[styles.assetText, { textAlign }]} numberOfLines={1}>{item}</AppText>
                  <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={theme.color.textMuted} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.hintBox}>
                  <Ionicons name="search-outline" size={24} color={theme.color.textMuted} />
                  <AppText style={[typography.body, { fontWeight: '700', color: theme.color.textMuted, textAlign: 'center' }]}>
                    {t('modules.checklists.tmNoMatch')}
                  </AppText>
                </View>
              }
            />
          )}
        </View>
      ) : (
        // Step 2 - pick a checklist for the chosen asset
        <View style={styles.body}>
          <View style={[styles.assetChip, isRTL && styles.rowR]}>
            <Ionicons name="car" size={16} color={theme.color.primaryDark} />
            <View style={{ flex: 1 }}>
              <AppText style={[styles.assetChipText, { textAlign }]} numberOfLines={1}>{selectedAsset}</AppText>
              {resolvingSite ? (
                <ActivityIndicator size="small" color={theme.color.textMuted} style={{ alignSelf: isRTL ? 'flex-end' : 'flex-start' }} />
              ) : selectedSite ? (
                <AppText style={[styles.assetChipSub, { textAlign }]} numberOfLines={1}>{selectedSite}</AppText>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => setSelectedAsset(null)} style={styles.changeBtn} activeOpacity={0.8}>
              <Ionicons name="swap-horizontal-outline" size={14} color={theme.color.primary} />
              <AppText style={styles.changeBtnText}>{t('modules.checklists.tmChange')}</AppText>
            </TouchableOpacity>
          </View>

          <FlatList
            data={templates}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.hintBox}>
                <Ionicons name="document-outline" size={24} color={theme.color.textMuted} />
                <AppText style={[typography.body, { fontWeight: '700', color: theme.color.textMuted, textAlign: 'center' }]}>
                  {t('modules.checklists.noPublished')}
                </AppText>
              </View>
            }
            renderItem={({ item: tpl }) => {
              const ico = resolveChecklistIcon(tpl)
              return (
              <TouchableOpacity style={styles.tplCard} activeOpacity={0.75} onPress={() => openTemplateForAsset(tpl)}>
                <View style={[styles.tplHead, isRTL && styles.rowR]}>
                  <View style={styles.tplIcon}>
                    {ico.kind === 'emoji'
                      ? <AppText style={styles.tplEmoji}>{ico.emoji}</AppText>
                      : <Ionicons name={ico.ionicon as any} size={20} color={theme.color.primary} />}
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
                  {tpl.require_signature && (
                    <View style={[styles.badge, styles.badgeBlue]}>
                      <Ionicons name="create-outline" size={12} color={theme.color.info.base} />
                      <AppText style={[styles.badgeText, { color: theme.color.info.on }]}>{t('modules.checklists.signature')}</AppText>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
              )
            }}
          />
        </View>
      )}
    </Screen>
  )
}

function makeTmStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
    backBtn: {
      width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.surface,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border,
    },
    body: { flex: 1, paddingHorizontal: spacing.lg },
    searchBox: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, height: 50,
    },
    searchInput: { flex: 1, fontSize: 15, fontWeight: '600', color: c.text, letterSpacing: 0.3 },
    hintBox: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing['3xl'] },
    list: { paddingVertical: spacing.md, paddingBottom: spacing['4xl'], gap: 10 },
    assetRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
    },
    assetText: { flex: 1, ...typography.body, fontWeight: '700', color: c.text },
    assetChip: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.primarySoft, borderRadius: radius.md, padding: spacing.md,
      borderWidth: 1, borderColor: c.primary, marginTop: spacing.md,
    },
    assetChipText: { ...typography.body, fontWeight: '800', color: c.primaryDark },
    assetChipSub: { ...typography.micro, color: c.textMuted, marginTop: 1 },
    changeBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md,
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    },
    changeBtnText: { ...typography.caption, fontWeight: '800', color: c.primary },
    tplCard: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm,
      borderWidth: 1, borderColor: c.border,
    },
    tplHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    tplIcon: {
      width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.primarySoft,
      alignItems: 'center', justifyContent: 'center',
    },
    tplCategory: { ...typography.caption, color: c.textMuted, marginTop: 2 },
    tplEmoji: { fontSize: 22, lineHeight: 26 },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    badge: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      backgroundColor: c.surfaceAlt, borderRadius: radius.sm,
      paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    },
    badgeBlue: { backgroundColor: c.info.soft },
    badgeText: { ...typography.micro, color: c.textSecondary },
  })
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
    // Unfinished (part-filled) sheet
    draftCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.info.base,
    },
    draftIcon: {
      width: 40, height: 40, borderRadius: radius.md,
      backgroundColor: c.info.soft,
      alignItems: 'center', justifyContent: 'center',
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
    // An emoji is drawn as text, so it needs a size of its own - an <Ionicons>
    // size prop does nothing for it.
    tplEmoji: { fontSize: 22, lineHeight: 26 },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    badge: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      backgroundColor: c.surfaceAlt, borderRadius: radius.sm,
      paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    },
    badgeGreen: { backgroundColor: c.primarySoft },
    badgeBlue: { backgroundColor: c.info.soft },
    badgeAmber: { backgroundColor: c.warning.soft },
    badgePurple: { backgroundColor: c.surfaceAlt, maxWidth: '100%' },
    badgeText: { ...typography.micro, color: c.textSecondary },
  })
}
