/**
 * Checklist history - the sheets I have already filled
 *
 * WHY THIS EXISTS. A mechanic, electrician or driver could FILL a checklist and
 * then had no way to see it again: there was no history screen at all, only the
 * fill list and the supervisors' approval queue. So the person who did the work
 * could not answer "did I do that machine last week", could not read back what
 * they recorded, and could not tell whether their sheet had been signed off or
 * sent back to them.
 *
 * IT NAMES THE RUNG, NOT "PENDING". Since V594 a sheet waits on TWO people in
 * turn - a supervisor signs it off, then the area manager closes it - so
 * "pending" told the reader nothing about who is holding their sheet. The
 * wording comes from the shared engine (checklistApproval) so this screen, the
 * approval queue and the database can never disagree about what a status means.
 *
 * WHOSE SHEETS. The default is the reader's own. A supervisor / area manager /
 * admin can switch to the whole team's, because they are the people who sign
 * them off. THAT TOGGLE IS A VIEW, NOT A SECURITY BOUNDARY, and must never be
 * described as one: the live SELECT policy on checklist_submissions is
 * `auth.uid() IS NOT NULL` plus the org + country RESTRICTIVE policies, so RLS
 * is what actually bounds who can read a colleague's sheet.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  View, FlatList, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  RefreshControl, Modal, Image,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { useModuleGuard } from '../../../hooks/useRoleGuard'
import { Theme, spacing, radius, typography, StatusKind } from '../../../lib/theme'
import { Screen, AppText, Badge, EmptyState, ErrorState, Loading, BackButton } from '../../../components/ui'
import SignatureView from '../../../components/SignatureView'
import { canApproveChecklists } from '../../../lib/permissions'
import {
  listSubmissionHistory, listSubmitterNames, getSubmission, getTemplate,
  filterHistory, historyCounts, historyScopeQuery,
  historyTemplateOptions, submissionReference,
  ChecklistHistoryRow, ChecklistSubmission, ChecklistTemplate,
  HistoryScope, HistoryState,
} from '../../../lib/checklists'
import { approvalProgress, isTwoStage, statusSummary, ApprovalRung } from '../../../lib/checklistApproval'
import {
  fieldOptionSet, markMeta, MARK_ICONS, MARK_TONES, MarkTone, TemplateLike, FieldLike,
} from '../../../lib/checklistMarks'
import { isValueField, ChecklistField } from '../../../lib/checklistFields'
import { fieldLabel, optionLabel, normalizeLang } from '../../../lib/checklistI18n'
import { resolveStorageUrls } from '../../../lib/storageRefs'
import { safeImageSrc } from '../../../lib/safeUrl'
import { toUserMessage } from '../../../lib/safeError'

/** statusSummary speaks in tones; Badge speaks in status kinds. */
const TONE_KIND: Record<string, StatusKind> = {
  good: 'success', bad: 'danger', warn: 'warning', muted: 'neutral',
}

const STATE_FILTERS: Array<HistoryState | 'all'> = ['all', 'waiting', 'closed', 'sent_back', 'no_approval']

const STATE_LABEL_KEY: Record<HistoryState | 'all', string> = {
  all: 'modules.checklistHistory.stateAll',
  waiting: 'modules.checklistHistory.stateWaiting',
  closed: 'modules.checklistHistory.stateClosed',
  sent_back: 'modules.checklistHistory.stateSentBack',
  no_approval: 'modules.checklistHistory.stateNoApproval',
}

/**
 * The engine decides WHICH rung is outstanding; the locale file owns the words,
 * so an Arabic reader is never shown an English status. A row whose template has
 * not loaded yet falls back to the generic wording rather than guessing.
 */
function statusKey(status: string | null | undefined, twoStage: boolean): string {
  const st = String(status ?? '')
  if (st === 'approved') return 'modules.checklistHistory.statusClosed'
  if (st === 'rejected') return 'modules.checklistHistory.statusSentBack'
  if (st === 'pending_area_manager') return 'modules.checklistHistory.statusWaitingAreaManager'
  if (st === 'pending') {
    return twoStage
      ? 'modules.checklistHistory.statusWaitingSupervisor'
      : 'modules.checklistHistory.statusWaitingApproval'
  }
  return 'modules.checklistHistory.statusNoApproval'
}

export default function ChecklistHistoryScreen() {
  // ONE guard, reading the SAME registry the Home tile and the tab bar read.
  // The key is `checklists` on purpose: whoever may FILL a sheet may see the
  // ones they filled, and sharing the key makes that true by construction
  // rather than by two lists agreeing today and drifting tomorrow.
  const { allowed } = useModuleGuard('checklists')

  const { profile, isSuperAdmin } = useAuth()
  const { t, isRTL, language } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const c = theme.color

  const canSeeTeam = canApproveChecklists(profile?.role) || isSuperAdmin === true

  const [scope, setScope] = useState<HistoryScope>('mine')
  const [rows, setRows] = useState<ChecklistHistoryRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [bounded, setBounded] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  const [templates, setTemplates] = useState<Record<string, ChecklistTemplate | null>>({})

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set when we cannot tell WHO the reader is - never widened to everyone. */
  const [unknownUser, setUnknownUser] = useState(false)

  const [showFilters, setShowFilters] = useState(false)
  const [state, setState] = useState<HistoryState | 'all'>('all')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [openId, setOpenId] = useState<string | null>(null)

  // `t` gets a new identity on every language-provider render; holding it in a
  // ref keeps it OUT of the loader's dependency list so a re-render can never
  // trigger a refetch.
  const tRef = useRef(t)
  tRef.current = t
  const templatesRef = useRef<Record<string, ChecklistTemplate | null>>({})

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const userId = profile?.id ?? null

  const load = useCallback(async () => {
    setError(null)
    setUnknownUser(false)

    const q = historyScopeQuery(scope, userId)
    if (!q.ok) {
      // "Mine" with no known account: show nothing and say why. Falling back to
      // everyone's sheets under a heading that says "mine" would be a lie.
      setRows([])
      setTotal(null)
      setBounded(false)
      setUnknownUser(true)
      setLoading(false)
      return
    }

    try {
      const res = await listSubmissionHistory({
        country: profile?.country,
        submittedBy: q.submittedBy,
      })
      setRows(res.rows)
      setTotal(res.total)
      setBounded(res.bounded)

      // Names, only where they add something: in "mine" every row is the reader.
      if (q.submittedBy === null) {
        setNames(await listSubmitterNames(res.rows.map((r) => r.submitted_by)))
      } else {
        setNames({})
      }

      // Templates decide the WORDING of a waiting state (one-stage sheets say
      // "waiting for approval", two-stage ones "waiting for a supervisor").
      // Best-effort and bounded: an unreadable template leaves the generic
      // wording rather than blocking the list.
      const ids = Array.from(new Set(res.rows.map((r) => r.template_id).filter(Boolean))) as string[]
      const missing = ids.filter((id) => !(id in templatesRef.current)).slice(0, 20)
      if (missing.length) {
        const fetched = await Promise.all(missing.map(async (id) => {
          try { return [id, await getTemplate(id)] as const } catch { return [id, null] as const }
        }))
        for (const [id, tpl] of fetched) templatesRef.current[id] = tpl
        setTemplates({ ...templatesRef.current })
      }
    } catch (e: any) {
      setError(toUserMessage(e, tRef.current('modules.checklistHistory.loadError')))
    } finally {
      setLoading(false)
    }
  }, [scope, userId, profile?.country])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  function changeScope(next: HistoryScope) {
    if (next === scope) return
    setScope(next)
    setLoading(true)
    // The template picker is derived from the rows on screen, so a filter left
    // over from the other scope could point at a template this one never shows.
    setTemplateId(null)
  }

  const templateFor = useCallback(
    (r: { template_id?: string | null }) => (r.template_id ? templates[r.template_id] ?? null : null),
    [templates],
  )

  const counts = useMemo(() => historyCounts(rows), [rows])
  const templateOptions = useMemo(() => historyTemplateOptions(rows), [rows])
  const visible = useMemo(
    () => filterHistory(rows, { state, templateId, search }),
    [rows, state, templateId, search],
  )
  const filtering = state !== 'all' || !!templateId || !!search.trim()
  const activeFilters = (state !== 'all' ? 1 : 0) + (templateId ? 1 : 0) + (search.trim() ? 1 : 0)
  const denominator = filtering ? rows.length : total

  const header = (
    <View style={styles.headerWrap}>
      <View style={[styles.header, isRTL && styles.rowR]}>
        <BackButton fallback="/(app)/checklists" />
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.checklistHistory.title')}</AppText>
          <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 2 }}>
            {scope === 'mine'
              ? t('modules.checklistHistory.subtitleMine')
              : t('modules.checklistHistory.subtitleTeam')}
          </AppText>
        </View>
        <TouchableOpacity
          onPress={() => setShowFilters((v) => !v)}
          activeOpacity={0.8}
          accessibilityRole="button"
          style={[styles.filterBtn, activeFilters > 0 && { borderColor: c.primary }]}
        >
          <Ionicons name="funnel-outline" size={16} color={activeFilters > 0 ? c.primary : c.textMuted} />
          <AppText style={[typography.micro, { color: activeFilters > 0 ? c.primary : c.textMuted }]}>
            {activeFilters > 0
              ? t('modules.checklistHistory.filters') + ' (' + activeFilters + ')'
              : t('modules.checklistHistory.filters')}
          </AppText>
        </TouchableOpacity>
      </View>

      {canSeeTeam && (
        <View style={styles.scopeWrap}>
          <View style={[styles.scopeRow, isRTL && styles.rowR]}>
            {(['mine', 'team'] as HistoryScope[]).map((key) => {
              const active = scope === key
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => changeScope(key)}
                  activeOpacity={0.8}
                  style={[styles.chip, active && { backgroundColor: c.primary, borderColor: c.primary }]}
                >
                  <Ionicons
                    name={key === 'mine' ? 'person-outline' : 'people-outline'}
                    size={13}
                    color={active ? '#FFFFFF' : c.textMuted}
                  />
                  <AppText style={[typography.micro, { color: active ? '#FFFFFF' : c.textMuted }]}>
                    {key === 'mine'
                      ? t('modules.checklistHistory.scopeMine')
                      : t('modules.checklistHistory.scopeTeam')}
                  </AppText>
                </TouchableOpacity>
              )
            })}
          </View>
          {scope === 'team' && (
            <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 4 }}>
              {t('modules.checklistHistory.scopeNote')}
            </AppText>
          )}
        </View>
      )}

      {showFilters && (
        <View style={styles.filterPanel}>
          <View style={[styles.searchBox, isRTL && styles.rowR]}>
            <Ionicons name="search-outline" size={16} color={c.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('modules.checklistHistory.searchPlaceholder')}
              placeholderTextColor={c.textMuted}
              style={[styles.searchInput, { color: c.text, textAlign }]}
              autoCorrect={false}
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch('')} accessibilityRole="button">
                <Ionicons name="close-circle" size={16} color={c.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
            {STATE_FILTERS.map((key) => {
              const active = state === key
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => setState(key)}
                  activeOpacity={0.8}
                  style={[styles.chip, active && { backgroundColor: c.primary, borderColor: c.primary }]}
                >
                  <AppText style={[typography.micro, { color: active ? '#FFFFFF' : c.textMuted }]}>
                    {t(STATE_LABEL_KEY[key]) + ' (' + counts[key] + ')'}
                  </AppText>
                </TouchableOpacity>
              )
            })}
          </ScrollView>

          {templateOptions.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
              <TouchableOpacity
                onPress={() => setTemplateId(null)}
                activeOpacity={0.8}
                style={[styles.chip, !templateId && { backgroundColor: c.primary, borderColor: c.primary }]}
              >
                <AppText style={[typography.micro, { color: !templateId ? '#FFFFFF' : c.textMuted }]}>
                  {t('modules.checklistHistory.allTemplates')}
                </AppText>
              </TouchableOpacity>
              {templateOptions.map((opt) => {
                const active = templateId === opt.id
                return (
                  <TouchableOpacity
                    key={opt.id}
                    onPress={() => setTemplateId(active ? null : opt.id)}
                    activeOpacity={0.8}
                    style={[styles.chip, active && { backgroundColor: c.primary, borderColor: c.primary }]}
                  >
                    <AppText
                      numberOfLines={1}
                      style={[typography.micro, { color: active ? '#FFFFFF' : c.textMuted, maxWidth: 160 }]}
                    >
                      {opt.name + ' (' + opt.count + ')'}
                    </AppText>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          )}

          {filtering && (
            <TouchableOpacity
              onPress={() => { setState('all'); setTemplateId(null); setSearch('') }}
              activeOpacity={0.8}
              style={styles.clearBtn}
            >
              <Ionicons name="close-outline" size={14} color={c.textMuted} />
              <AppText style={[typography.micro, { color: c.textMuted }]}>
                {t('modules.checklistHistory.clearFilters')}
              </AppText>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!loading && !error && !unknownUser && rows.length > 0 && (
        <AppText variant="caption" color="muted" style={[styles.countLine, { textAlign }]}>
          {/* While filtering, the denominator is what is LOADED - comparing a
              filtered count against the server total would read as though the
              server had hidden the rest. Unfiltered, it is the true total, and
              null total means we could not count, so no denominator is shown. */}
          {t('modules.checklistHistory.showing') + ' ' + visible.length
            + (denominator != null ? ' ' + t('modules.checklistHistory.of') + ' ' + denominator : '')
            + (bounded ? '. ' + t('modules.checklistHistory.olderNotShown') : '')}
        </AppText>
      )}
    </View>
  )

  // The guard redirects when the module is denied; render nothing meanwhile so
  // protected content never flashes.
  if (!allowed) return null

  return (
    <Screen>
      {header}
      {loading ? (
        <Loading />
      ) : unknownUser ? (
        <EmptyState
          icon="person-circle-outline"
          title={t('modules.checklistHistory.unknownUserTitle')}
          message={t('modules.checklistHistory.unknownUserMsg')}
          actionLabel={t('common.retry')}
          onAction={() => { setLoading(true); load() }}
        />
      ) : error ? (
        // "We could not look" is a different statement from "there is nothing".
        <ErrorState message={error} onRetry={onRefresh} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(r) => r.id}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          windowSize={11}
          ListEmptyComponent={
            filtering ? (
              <EmptyState
                icon="funnel-outline"
                title={t('modules.checklistHistory.emptyFilteredTitle')}
                message={t('modules.checklistHistory.emptyFilteredMsg')}
              />
            ) : (
              <EmptyState
                icon="time-outline"
                title={scope === 'mine'
                  ? t('modules.checklistHistory.emptyMineTitle')
                  : t('modules.checklistHistory.emptyTeamTitle')}
                message={scope === 'mine'
                  ? t('modules.checklistHistory.emptyMineMsg')
                  : t('modules.checklistHistory.emptyTeamMsg')}
              />
            )
          }
          renderItem={({ item: r }) => {
            const tpl = templateFor(r)
            const summary = statusSummary(tpl, r)
            const summaryText = t(statusKey(r.approval_status, isTwoStage(tpl)))
            const reference = submissionReference(r)
            const when = r.submitted_at
              ? new Date(r.submitted_at).toLocaleDateString(dateLocale, {
                  day: 'numeric', month: 'short', year: 'numeric',
                })
              : t('common.notAvailable')
            const who = scope === 'team' && r.submitted_by
              ? names[r.submitted_by] ?? t('modules.checklistHistory.unknownPerson')
              : null
            return (
              <TouchableOpacity
                style={[styles.card, isRTL && styles.rowR]}
                activeOpacity={0.75}
                onPress={() => setOpenId(r.id)}
              >
                <View style={[styles.icon, { backgroundColor: c.surfaceAlt }]}>
                  <Ionicons name="document-text-outline" size={20} color={c.primary} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <AppText style={[typography.title, { textAlign }]} numberOfLines={1}>
                    {r.title || r.template_name || t('modules.checklists.checklistFallback')}
                  </AppText>
                  <View style={[styles.metaRow, isRTL && styles.rowR]}>
                    <Ionicons name="pricetag-outline" size={12} color={c.textMuted} />
                    {/* A blank where an identity should be reads as a bug; every
                        sheet filled before V594 genuinely carries no number. */}
                    <AppText style={styles.metaText} numberOfLines={1}>
                      {reference ?? t('modules.checklistHistory.notNumbered')}
                    </AppText>
                  </View>
                  {!!(r.site || r.asset_no) && (
                    <View style={[styles.metaRow, isRTL && styles.rowR]}>
                      <Ionicons name="location-outline" size={12} color={c.textMuted} />
                      <AppText style={styles.metaText} numberOfLines={1}>
                        {[r.asset_no, r.site].filter(Boolean).join(' - ')}
                      </AppText>
                    </View>
                  )}
                  <View style={[styles.metaRow, isRTL && styles.rowR]}>
                    <Ionicons name="calendar-outline" size={12} color={c.textMuted} />
                    <AppText style={styles.metaText}>{when}</AppText>
                    {!!who && (
                      <>
                        <AppText style={styles.metaText}>|</AppText>
                        <AppText style={styles.metaText} numberOfLines={1}>{who}</AppText>
                      </>
                    )}
                    {r.score_pct != null && (
                      <>
                        <AppText style={styles.metaText}>|</AppText>
                        <AppText
                          style={[styles.scoreText, { color: r.score_passed === false ? c.danger.base : c.success.base }]}
                        >
                          {r.score_pct + '%'}
                        </AppText>
                      </>
                    )}
                  </View>
                  <View style={[styles.metaRow, isRTL && styles.rowR, { marginTop: 2 }]}>
                    <Badge kind={TONE_KIND[summary.tone] ?? 'neutral'}>{summaryText}</Badge>
                  </View>
                </View>
                <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={c.textMuted} />
              </TouchableOpacity>
            )
          }}
        />
      )}

      <SubmissionDetail
        submissionId={openId}
        onClose={() => setOpenId(null)}
        lang={normalizeLang(language)}
        submitterNames={names}
      />
    </Screen>
  )
}

/* ------------------------------------------------------------- the detail */

interface AnswerRow {
  id: string
  label: string
  text: string
  icon?: string
  tone?: MarkTone
  meaning?: string
  note?: string
}

/**
 * Read back ONE submitted sheet.
 *
 * Renders the marks as the ICONS and MEANINGS the legend defines (V595) rather
 * than as bare words, and shows the signatures with the names of who signed -
 * a sheet is a record of what a person saw and who stood behind it, so both
 * halves have to come back.
 */
function SubmissionDetail({
  submissionId, onClose, lang, submitterNames,
}: {
  submissionId: string | null
  onClose: () => void
  lang: string
  submitterNames: Record<string, string>
}) {
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const c = theme.color

  const [submission, setSubmission] = useState<ChecklistSubmission | null>(null)
  const [template, setTemplate] = useState<ChecklistTemplate | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoUrls, setPhotoUrls] = useState<string[]>([])

  const tRef = useRef(t)
  tRef.current = t
  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'

  const load = useCallback(async () => {
    if (!submissionId) return
    setLoading(true)
    setError(null)
    setPhotoUrls([])
    try {
      const s = await getSubmission(submissionId)
      setSubmission(s)
      if (s?.template_id) {
        try { setTemplate(await getTemplate(s.template_id)) } catch { /* labels degrade to field ids */ }
      }
      // Signed URLs for the evidence. Bounded, and best-effort: a photo we
      // cannot resolve is simply not shown, never a broken frame.
      const refs = Object.values(s?.photos ?? {})
        .flatMap((v) => (Array.isArray(v) ? v : []))
        .filter((v): v is string => typeof v === 'string' && !!v)
        .slice(0, 12)
      if (refs.length) {
        try { setPhotoUrls(await resolveStorageUrls(refs)) } catch { /* leave empty */ }
      }
    } catch (e: any) {
      setError(toUserMessage(e, tRef.current('modules.checklistHistory.detailLoadError')))
    } finally {
      setLoading(false)
    }
  }, [submissionId])

  useEffect(() => {
    if (!submissionId) { setSubmission(null); setTemplate(null); setPhotoUrls([]); setError(null); return }
    load()
  }, [submissionId, load])

  const tplLike = template as unknown as TemplateLike | null
  const twoStage = isTwoStage(template)

  const fmtDateTime = useCallback((iso?: string | null) => (
    iso
      ? new Date(iso).toLocaleString(dateLocale, {
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      : t('common.notAvailable')
  ), [dateLocale, t])

  const rows: AnswerRow[] = useMemo(() => {
    const answers = submission?.answers ?? {}
    const notes = (submission?.notes ?? {}) as Record<string, any>
    const fields = template?.fields ?? []
    const asText = (field: ChecklistField, value: any): string => {
      if (value == null || value === '') return t('common.notAvailable')
      if (Array.isArray(value)) {
        return value.length
          ? value.map((v) => optionLabel(field, template, v, lang)).join(', ')
          : t('common.notAvailable')
      }
      if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
      if (field.type === 'rating') return String(value) + '/5'
      return optionLabel(field, template, value, lang) || String(value)
    }
    if (fields.length) {
      return fields.filter((f) => isValueField(f.type)).map((f) => {
        const raw = answers[f.id]
        const set = fieldOptionSet(tplLike, f as unknown as FieldLike)
        const first = Array.isArray(raw) ? raw[0] : raw
        const meta = markMeta(set, first)
        const remark = String(notes?.[f.id] ?? '').trim()
        return {
          id: f.id,
          label: fieldLabel(f, lang) || f.id,
          text: asText(f, raw),
          icon: meta.known ? MARK_ICONS[meta.icon]?.ionicon : undefined,
          tone: meta.known ? meta.tone : undefined,
          meaning: meta.known ? meta.meaning : undefined,
          note: remark || undefined,
        }
      })
    }
    // No template: fall back to the raw answer keys rather than showing nothing.
    return Object.entries(answers).map(([k, v]) => ({
      id: k, label: k, text: asText({ type: 'text' } as ChecklistField, v),
    }))
  }, [submission, template, tplLike, lang, t])

  const progress = useMemo(() => approvalProgress(template, submission), [template, submission])

  /** Every signature on the sheet: the primary one plus each signed field. */
  const signatures = useMemo(() => {
    const out: Array<{ id: string; label: string; value: string }> = []
    const primary = String(submission?.signature_data ?? '')
    if (primary) {
      out.push({ id: '__primary', label: t('modules.checklistHistory.primarySignature'), value: primary })
    }
    const map = submission?.signatures ?? {}
    const byId = new Map((template?.fields ?? []).map((f) => [f.id, f]))
    for (const [fieldId, value] of Object.entries(map)) {
      const v = String(value ?? '')
      if (!v || v === primary) continue
      const f = byId.get(fieldId)
      out.push({ id: fieldId, label: f ? fieldLabel(f, lang) || fieldId : fieldId, value: v })
    }
    return out
  }, [submission, template, lang, t])

  const rungLabel = useCallback((rung: ApprovalRung) => (
    rung.key === 'area_manager'
      ? t('modules.checklistHistory.stageAreaManager')
      : twoStage
        ? t('modules.checklistHistory.stageSupervisor')
        : t('modules.checklistHistory.stageApproval')
  ), [t, twoStage])

  const reference = submissionReference(submission)
  const summary = statusSummary(template, submission)
  const who = submission?.submitted_by ? submitterNames[submission.submitted_by] : null

  return (
    <Modal
      visible={!!submissionId}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <Screen>
        <View style={[styles.header, isRTL && styles.rowR]}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={22} color={c.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <AppText variant="h3" style={{ textAlign }} numberOfLines={1}>
              {reference ?? t('modules.checklistHistory.notNumbered')}
            </AppText>
            <AppText variant="caption" color="muted" style={{ textAlign }} numberOfLines={1}>
              {submission?.template_name || t('modules.checklistHistory.detailTitle')}
            </AppText>
          </View>
        </View>

        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !submission ? (
          <EmptyState
            icon="help-circle-outline"
            title={t('modules.checklistHistory.notFound')}
            message={t('modules.checklistHistory.notFoundMsg')}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
            <View style={styles.panel}>
              <Badge kind={TONE_KIND[summary.tone] ?? 'neutral'}>
                {t(statusKey(submission.approval_status, twoStage))}
              </Badge>
              <DetailLine label={t('modules.checklistHistory.submittedOn')} value={fmtDateTime(submission.submitted_at)} styles={styles} isRTL={isRTL} />
              {!!who && (
                <DetailLine label={t('modules.checklistHistory.submittedBy')} value={who} styles={styles} isRTL={isRTL} />
              )}
              <DetailLine
                label={t('modules.checklistHistory.asset')}
                value={submission.asset_no || t('common.notAvailable')}
                styles={styles} isRTL={isRTL}
              />
              <DetailLine
                label={t('modules.checklistHistory.site')}
                value={submission.site || t('common.notAvailable')}
                styles={styles} isRTL={isRTL}
              />
              {submission.score_pct != null && (
                <DetailLine
                  label={t('modules.checklistHistory.score')}
                  value={submission.score_pct + '%'}
                  styles={styles} isRTL={isRTL}
                />
              )}
              {!!submission.review_note && (
                <View style={styles.reviewNote}>
                  <AppText style={[typography.caption, { color: c.danger.base, textAlign }]}>
                    {t('modules.checklistHistory.reviewNote')}
                  </AppText>
                  <AppText style={[typography.body, { color: c.text, textAlign }]}>
                    {submission.review_note}
                  </AppText>
                </View>
              )}
            </View>

            {/* The ladder: who has signed, when, and their actual signature. */}
            <AppText style={[typography.label, styles.sectionLabel, { textAlign }]}>
              {t('modules.checklistHistory.approvalLadder')}
            </AppText>
            <View style={styles.panel}>
              {progress.map((rung) => (
                <View key={rung.key} style={styles.rung}>
                  <View style={[styles.metaRow, isRTL && styles.rowR]}>
                    <Ionicons
                      name={rung.done ? 'checkmark-circle' : rung.current ? 'time-outline' : 'ellipse-outline'}
                      size={16}
                      color={rung.done ? c.success.base : rung.current ? c.warning.base : c.textMuted}
                    />
                    <AppText style={[typography.title, { textAlign }]}>{rungLabel(rung)}</AppText>
                  </View>
                  <AppText style={[styles.metaText, { textAlign }]}>
                    {rung.done && rung.name
                      ? t('modules.checklistHistory.signedBy') + ' ' + rung.name + ' - ' + fmtDateTime(rung.at)
                      : rung.current
                        ? t('modules.checklistHistory.awaiting')
                        : t('modules.checklistHistory.notSignedYet')}
                  </AppText>
                  {!!rung.signature && <SignatureView value={rung.signature} height={70} />}
                </View>
              ))}
            </View>

            <AppText style={[typography.label, styles.sectionLabel, { textAlign }]}>
              {t('modules.checklistHistory.answers')}
            </AppText>
            {rows.length === 0 ? (
              <View style={styles.panel}>
                <AppText style={[styles.metaText, { textAlign }]}>
                  {t('modules.checklistHistory.noAnswers')}
                </AppText>
              </View>
            ) : (
              <View style={styles.panel}>
                {rows.map((r) => {
                  const tone = r.tone ? MARK_TONES[r.tone] : null
                  return (
                    <View key={r.id} style={styles.answerRow}>
                      <View style={[styles.metaRow, isRTL && styles.rowR]}>
                        {!!r.icon && (
                          <View style={[styles.markIcon, tone ? { backgroundColor: tone.bg } : null]}>
                            <Ionicons name={r.icon as any} size={14} color={tone ? tone.fg : c.textMuted} />
                          </View>
                        )}
                        <AppText style={[typography.body, { flex: 1, textAlign }]}>{r.label}</AppText>
                        <AppText
                          style={[typography.body, { fontWeight: '700', color: tone ? tone.fg : c.text }]}
                          numberOfLines={2}
                        >
                          {r.text}
                        </AppText>
                      </View>
                      {!!r.meaning && (
                        <AppText style={[styles.metaText, { textAlign }]}>{r.meaning}</AppText>
                      )}
                      {!!r.note && (
                        <AppText style={[styles.metaText, { textAlign, fontStyle: 'italic' }]}>
                          {t('modules.checklistHistory.remark') + ': ' + r.note}
                        </AppText>
                      )}
                    </View>
                  )
                })}
              </View>
            )}

            {photoUrls.length > 0 && (
              <>
                <AppText style={[typography.label, styles.sectionLabel, { textAlign }]}>
                  {t('modules.checklistHistory.photos')}
                </AppText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                  {photoUrls.map((url, i) => {
                    const src = safeImageSrc(url)
                    return src ? (
                      <Image key={String(i)} source={{ uri: src }} style={styles.photo} resizeMode="cover" />
                    ) : null
                  })}
                </ScrollView>
              </>
            )}

            {signatures.length > 0 && (
              <>
                <AppText style={[typography.label, styles.sectionLabel, { textAlign }]}>
                  {t('modules.checklistHistory.signatures')}
                </AppText>
                <View style={styles.panel}>
                  {signatures.map((sig) => (
                    <View key={sig.id} style={styles.rung}>
                      <AppText style={[typography.caption, { color: c.textMuted, textAlign }]}>{sig.label}</AppText>
                      <SignatureView value={sig.value} height={70} />
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        )}
      </Screen>
    </Modal>
  )
}

function DetailLine({
  label, value, styles, isRTL,
}: { label: string; value: string; styles: ReturnType<typeof makeStyles>; isRTL: boolean }) {
  return (
    <View style={[styles.detailLine, isRTL && styles.rowR]}>
      <AppText style={styles.metaText}>{label}</AppText>
      <AppText style={[typography.body, { flex: 1, textAlign: isRTL ? 'left' : 'right' }]} numberOfLines={2}>
        {value}
      </AppText>
    </View>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    headerWrap: { paddingBottom: spacing.xs },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
    closeBtn: {
      width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    },
    filterBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: spacing.md, paddingVertical: 7,
      borderRadius: radius.pill, backgroundColor: c.surface,
      borderWidth: 1, borderColor: c.border,
    },

    scopeWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    scopeRow: { flexDirection: 'row', gap: spacing.sm },
    filterPanel: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
    chipScroll: { gap: spacing.sm, paddingVertical: 2, paddingEnd: spacing.lg },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: spacing.md, paddingVertical: 7,
      borderRadius: radius.pill, backgroundColor: c.surface,
      borderWidth: 1, borderColor: c.border,
    },
    clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
    searchBox: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surface, borderRadius: radius.md,
      borderWidth: 1, borderColor: c.border,
      paddingHorizontal: spacing.md, paddingVertical: 6,
    },
    searchInput: { flex: 1, ...typography.body, paddingVertical: 4 },
    countLine: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },

    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
    },
    icon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
    metaText: { ...typography.caption, color: c.textMuted },
    scoreText: { ...typography.caption, fontWeight: '800' },

    detailContent: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.sm },
    sectionLabel: { color: c.textMuted, textTransform: 'uppercase', marginTop: spacing.md },
    panel: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border, gap: spacing.sm,
    },
    detailLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    reviewNote: {
      backgroundColor: c.danger.soft, borderRadius: radius.md, padding: spacing.sm, gap: 2,
    },
    rung: { gap: 4, paddingVertical: spacing.xs },
    answerRow: { gap: 2, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    markIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    photo: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: c.surfaceAlt },
  })
}
