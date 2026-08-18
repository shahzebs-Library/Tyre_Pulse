/**
 * Checklist approvals - the review queue
 *
 * Lists submissions that are still waiting on a signature, newest first. Since
 * V594 there are TWO waiting states, not one: a sheet sits at `pending` until a
 * supervisor signs it off and then at `pending_area_manager` until the area
 * manager closes it, so a row can be in this queue for two different people.
 * `statusSummary` says which, and the "Needs me" filter narrows the list to the
 * rows THIS reader can actually act on.
 *
 * THE SCROLL BUG THIS SCREEN EXISTS TO NOT HAVE. The queue reloads whenever it
 * regains focus, which is right - a decision must leave the queue. What was
 * wrong was HOW: every refresh replaced `items` with a brand-new array of
 * brand-new objects, so the list re-rendered from scratch and the reviewer was
 * thrown back to the top after every single decision. `reconcileById` merges
 * the refreshed rows INTO the array already on screen, keeping the existing
 * object for any row that has not changed and returning the very same array
 * when nothing has changed at all, so an unchanged refresh costs zero renders.
 * `maintainVisibleContentPosition` then holds the reader's place when a decided
 * row disappears from above them.
 *
 * Access is gated in nav (canApproveChecklists), per rung by canActOnStage, and
 * at the database (V212 RLS + guard_checklist_approval_stages) so hiding a
 * button is never the only defence.
 */
import { useState, useCallback, useMemo, useRef } from 'react'
import { View, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../../contexts/AuthContext'
import { useLanguage } from '../../../../contexts/LanguageContext'
import { useTheme } from '../../../../contexts/ThemeContext'
import { Theme, spacing, radius, typography, StatusKind } from '../../../../lib/theme'
import { Screen, AppText, Badge, EmptyState, ErrorState, Loading, BackButton } from '../../../../components/ui'
import { canApproveChecklists } from '../../../../lib/permissions'
import { listPendingApprovals, getTemplate, ChecklistSubmission, ChecklistTemplate } from '../../../../lib/checklists'
import { canDecide, isTwoStage, statusSummary } from '../../../../lib/checklistApproval'
import { toUserMessage } from '../../../../lib/safeError'

function looksLikeMissingTable(msg: string): boolean {
  const m = (msg || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache')
}

/** statusSummary speaks in tones; the Badge speaks in status kinds. */
const TONE_KIND: Record<string, StatusKind> = {
  good: 'success', bad: 'danger', warn: 'warning', muted: 'neutral',
}

/**
 * The engine owns the DECISION (which rung, which tone); the locale file owns
 * the words, so an Arabic reader is not shown an English status. Keep the two
 * in step: a new approval_status needs a case here and a key in the locales.
 */
function statusKey(status: string | null | undefined, twoStage: boolean): string {
  const st = String(status ?? '')
  if (st === 'approved') return 'modules.checklistApprovals.statusClosed'
  if (st === 'rejected') return 'modules.checklistApprovals.statusSentBack'
  if (st === 'pending_area_manager') return 'modules.checklistApprovals.statusWaitingAreaManager'
  if (st === 'pending') {
    return twoStage
      ? 'modules.checklistApprovals.statusWaitingSupervisor'
      : 'modules.checklistApprovals.statusWaitingApproval'
  }
  return 'modules.checklistApprovals.statusNoApproval'
}

/**
 * The fields a row actually draws. Two rows with the same signature look
 * identical, so the old object is kept and React has nothing to repaint.
 */
function rowSignature(s: ChecklistSubmission): string {
  return [
    s.approval_status, s.submitted_at, s.title, s.template_name, s.site,
    s.asset_no, s.document_no, s.score_pct, s.score_passed,
  ].join('|')
}

/**
 * Merge a refreshed queue into the one on screen.
 *
 * Existing rows keep their position AND their object identity unless something
 * visible changed; rows the server no longer returns (decided by anyone) drop
 * out; genuinely new rows go on top, which is where the newest-first order puts
 * them anyway. Returns the SAME array reference when nothing moved, so a
 * refresh that finds no news cannot disturb the list at all.
 */
export function reconcileById(
  prev: ChecklistSubmission[],
  next: ChecklistSubmission[],
): ChecklistSubmission[] {
  if (!prev.length) return next
  const byId = new Map(next.map(r => [r.id, r]))
  const kept: ChecklistSubmission[] = []
  for (const old of prev) {
    const fresh = byId.get(old.id)
    if (!fresh) continue
    kept.push(rowSignature(fresh) === rowSignature(old) ? old : fresh)
    byId.delete(old.id)
  }
  const added = next.filter(r => byId.has(r.id))
  const unchanged =
    added.length === 0 &&
    kept.length === prev.length &&
    kept.every((r, i) => r === prev[i])
  return unchanged ? prev : [...added, ...kept]
}

import { withModuleGuard } from '../../../../components/ModuleGuard'

export default withModuleGuard(ChecklistApprovalsScreen, 'approvals')

type QueueFilter = 'all' | 'mine'

function ChecklistApprovalsScreen() {
  const { profile, isSuperAdmin } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const c = theme.color
  const router = useRouter()

  const [items, setItems] = useState<ChecklistSubmission[]>([])
  const [templates, setTemplates] = useState<Record<string, ChecklistTemplate | null>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notEnabled, setNotEnabled] = useState(false)
  const [filter, setFilter] = useState<QueueFilter>('all')

  // Templates are cached in a ref as well as state: the loader needs to know
  // what it already has WITHOUT taking a dependency on state it also writes.
  const templatesRef = useRef<Record<string, ChecklistTemplate | null>>({})
  // `t` is rebuilt whenever the language provider re-renders. Holding it in a
  // ref keeps it OUT of the loader's dependency list, so a re-render can never
  // give `load` a new identity and make the focus effect re-fetch the queue.
  const tRef = useRef(t)
  tRef.current = t

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const allowed = canApproveChecklists(profile?.role)

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return }
    setError(null)
    setNotEnabled(false)
    try {
      const rows = await listPendingApprovals(profile?.country)
      setItems(prev => reconcileById(prev, rows))

      // Templates decide the WORDING of a waiting state (a one-stage sheet is
      // "waiting for approval", a two-stage one is "waiting for a supervisor").
      // Best-effort and bounded: a template we cannot read leaves the row on
      // the generic wording rather than blocking the queue.
      const ids = Array.from(new Set(rows.map(r => r.template_id).filter(Boolean))) as string[]
      const missing = ids.filter(id => !(id in templatesRef.current)).slice(0, 20)
      if (missing.length) {
        const fetched = await Promise.all(missing.map(async id => {
          try { return [id, await getTemplate(id)] as const } catch { return [id, null] as const }
        }))
        for (const [id, tpl] of fetched) templatesRef.current[id] = tpl
        setTemplates({ ...templatesRef.current })
      }
    } catch (e: any) {
      const msg = toUserMessage(e, tRef.current('modules.checklistApprovals.loadError'))
      if (looksLikeMissingTable(msg)) setNotEnabled(true)
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }, [allowed, profile?.country])

  // ONE loader. useFocusEffect already fires on mount, so the old extra
  // useEffect(load) was a duplicate request on every entry to the screen.
  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const templateFor = useCallback(
    (s: ChecklistSubmission) => (s.template_id ? templates[s.template_id] ?? null : null),
    [templates],
  )

  // Rows this reader can act on RIGHT NOW. stageFor reads the submission's own
  // status, so this is correct even before the templates arrive.
  const mine = useMemo(() => {
    const set = new Set<string>()
    for (const s of items) {
      if (canDecide(templateFor(s), s, profile?.role, { isSuperAdmin })) set.add(s.id)
    }
    return set
  }, [items, templateFor, profile?.role, isSuperAdmin])

  const visible = useMemo(
    () => (filter === 'mine' ? items.filter(s => mine.has(s.id)) : items),
    [filter, items, mine],
  )

  function open(s: ChecklistSubmission) {
    router.push({ pathname: '/(app)/checklists/approvals/[submissionId]', params: { submissionId: s.id } })
  }

  const header = (
    <View style={styles.headerWrap}>
      <View style={[styles.header, isRTL && styles.rowR]}>
        <BackButton fallback="/(app)/checklists" />
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.checklistApprovals.title')}</AppText>
          <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 2 }}>
            {items.length} {t('modules.checklistApprovals.awaitingSignoff')}
          </AppText>
        </View>
      </View>
      {allowed && !loading && !notEnabled && !error && items.length > 0 && (
        <View style={[styles.filterRow, isRTL && styles.rowR]}>
          {(['all', 'mine'] as QueueFilter[]).map(key => {
            const active = filter === key
            const n = key === 'mine' ? mine.size : items.length
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setFilter(key)}
                activeOpacity={0.8}
                style={[styles.chip, active && { backgroundColor: c.primary, borderColor: c.primary }]}
              >
                <Ionicons
                  name={key === 'mine' ? 'person-outline' : 'list-outline'}
                  size={13}
                  color={active ? '#FFFFFF' : c.textMuted}
                />
                <AppText style={[typography.micro, { color: active ? '#FFFFFF' : c.textMuted }]}>
                  {key === 'mine' ? t('modules.checklistApprovals.filterMine') : t('modules.checklistApprovals.filterAll')} ({n})
                </AppText>
              </TouchableOpacity>
            )
          })}
        </View>
      )}
    </View>
  )

  if (!allowed) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="lock-closed-outline"
          title={t('modules.checklistApprovals.notAvailable')}
          message={t('modules.checklistApprovals.notAvailableMsg')}
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
          title={t('modules.checklistApprovals.notEnabledTitle')}
          message={t('modules.checklistApprovals.notEnabledMsg')}
        />
      ) : error ? (
        <ErrorState message={error} onRetry={onRefresh} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={s => s.id}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          windowSize={11}
          // Holds the reader's place when a decided row drops out above them.
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          ListEmptyComponent={
            <View style={styles.inlineEmpty}>
              <Ionicons name="checkmark-done-outline" size={22} color={c.primary} />
              <AppText style={[typography.body, { fontWeight: '700', color: c.primaryDark, flex: 1 }]}>
                {filter === 'mine'
                  ? t('modules.checklistApprovals.emptyMine')
                  : t('modules.checklistApprovals.emptyAll')}
              </AppText>
            </View>
          }
          renderItem={({ item: s }) => {
            const tpl = templateFor(s)
            const summary = statusSummary(tpl, s)
            const summaryText = t(statusKey(s.approval_status, isTwoStage(tpl)))
            const when = s.submitted_at
              ? new Date(s.submitted_at).toLocaleDateString(dateLocale, {
                  day: 'numeric', month: 'short', year: 'numeric',
                })
              : t('common.notAvailable')
            const isMine = mine.has(s.id)
            return (
              <TouchableOpacity
                style={[styles.card, isRTL && styles.rowR, isMine && { borderColor: c.primary }]}
                activeOpacity={0.75}
                onPress={() => open(s)}
              >
                <View style={styles.icon}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={c.warning.base} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <AppText style={[typography.title, { textAlign }]} numberOfLines={1}>
                    {s.title || s.template_name || t('modules.checklists.checklistFallback')}
                  </AppText>
                  {!!s.document_no && (
                    <View style={[styles.metaRow, isRTL && styles.rowR]}>
                      <Ionicons name="pricetag-outline" size={12} color={c.textMuted} />
                      <AppText style={styles.metaText} numberOfLines={1}>{s.document_no}</AppText>
                    </View>
                  )}
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
                  <View style={[styles.metaRow, isRTL && styles.rowR, { marginTop: 2 }]}>
                    <Badge kind={TONE_KIND[summary.tone] ?? 'neutral'}>{summaryText}</Badge>
                    {isMine && (
                      <Badge kind="success" icon="person-outline">
                        {t('modules.checklistApprovals.yourTurn')}
                      </Badge>
                    )}
                  </View>
                </View>
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
    headerWrap: { paddingBottom: spacing.xs },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },

    filterRow: {
      flexDirection: 'row', gap: spacing.sm,
      paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: spacing.md, paddingVertical: 7,
      borderRadius: radius.pill, backgroundColor: c.surface,
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
