import { useState, useEffect, useMemo } from 'react'
import {
  View, StyleSheet, TouchableOpacity, Alert, Switch,
  ScrollView, ActivityIndicator, TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage, Language } from '../../contexts/LanguageContext'
import { useTheme, ThemePreference } from '../../contexts/ThemeContext'
import { Theme, spacing, radius, typography, elevation } from '../../lib/theme'
import { Screen, Card, AppText, Button, ListRow, SectionHeader } from '../../components/ui'
import { getPendingCount, syncQueue, retryFailed, clearSynced, getQueue } from '../../lib/offlineQueue'
import {
  getPendingRecordCount, syncRecordQueue, retryFailedRecords,
  clearSyncedRecords, getRecordQueue,
} from '../../lib/recordQueue'
import { canAccessAdmin, canManageUsers, canUseAI, canViewAccidents } from '../../lib/permissions'
import { requestAccountDeletion } from '../../lib/accountDeletion'
import {
  requestNotificationPermission,
  registerPushToken,
  scheduleDailyInspectionReminder,
  cancelDailyInspectionReminder,
  getDailyReminderTrigger,
} from '../../lib/notifications'

const LANG_OPTIONS: { code: Language; labelKey: string }[] = [
  { code: 'en', labelKey: 'language.english' },
  { code: 'ar', labelKey: 'language.arabic' },
  { code: 'ur', labelKey: 'language.urdu' },
]

type IconName = React.ComponentProps<typeof Ionicons>['name']

const APPEARANCE_OPTIONS: {
  key: ThemePreference; labelKey: string; icon: IconName; hintKey?: string
}[] = [
  { key: 'light', labelKey: 'profile.themeLight', icon: 'sunny-outline', hintKey: 'profile.themeRecommended' },
  { key: 'dark', labelKey: 'profile.themeDark', icon: 'moon-outline' },
  { key: 'system', labelKey: 'profile.themeSystem', icon: 'phone-portrait-outline' },
]

export default function ProfileScreen() {
  const { profile, signOut } = useAuth()
  const { t, language, setLanguage, isRTL } = useLanguage()
  const { theme, preference, setPreference } = useTheme()
  const router = useRouter()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [queueTotal, setQueueTotal] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderHour, setReminderHour] = useState(7)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'

  // DB stores roles Title-cased ("Tyre Man"); locale keys are snake_case.
  const roleKey = (profile?.role ?? '').toLowerCase().replace(/\s+/g, '_')
  const roleLabel = t(`profile.roles.${roleKey}`) !== `profile.roles.${roleKey}`
    ? t(`profile.roles.${roleKey}`)
    : (profile?.role ?? '')

  async function load() {
    // Include BOTH queues: inspections and the typed record queue.
    const [inspCount, recCount, inspQueue, recQueue] = await Promise.all([
      getPendingCount(), getPendingRecordCount(), getQueue(), getRecordQueue(),
    ])
    setPending(inspCount + recCount)
    setQueueTotal(inspQueue.length + recQueue.length)
  }

  useEffect(() => { load() }, [])

  // Register push token and load reminder state on mount.
  useEffect(() => {
    if (profile?.id) {
      registerPushToken(profile.id).catch(() => {})
    }
    getDailyReminderTrigger().then(trigger => {
      if (trigger) { setReminderEnabled(true); setReminderHour(trigger.hour) }
    })
  }, [profile?.id])

  async function toggleReminder(enabled: boolean) {
    const granted = await requestNotificationPermission()
    if (!granted) {
      Alert.alert(t('profile.notifBlockedTitle'), t('profile.notifBlockedMsg'))
      return
    }
    setReminderEnabled(enabled)
    if (enabled) {
      await scheduleDailyInspectionReminder(reminderHour, 0)
    } else {
      await cancelDailyInspectionReminder()
    }
  }

  const reminderHours = [6, 7, 8, 9, 10]

  async function handleSync() {
    setSyncing(true)
    try {
      await Promise.all([retryFailed(), retryFailedRecords()])
      const [insp, recs] = await Promise.all([syncQueue(), syncRecordQueue()])
      await load()
      const synced = insp.synced + recs.synced
      const failed = insp.failed + recs.failed
      const uploadedLabel = synced !== 1 ? t('profile.uploadsPlural') : t('profile.uploaded')
      const failedSuffix = failed > 0 ? ` ${failed} ${t('profile.syncFailed')}` : ''
      Alert.alert(t('profile.syncCompleteTitle'), `${synced} ${uploadedLabel}${failedSuffix}`)
    } finally {
      setSyncing(false)
    }
  }

  async function handleClearSynced() {
    Alert.alert(
      t('profile.clearTitle'),
      t('profile.clearMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.clearConfirm'), style: 'destructive',
          onPress: async () => { await Promise.all([clearSynced(), clearSyncedRecords()]); load() },
        },
      ]
    )
  }

  async function handleLogout() {
    Alert.alert(
      t('profile.signOutTitle'),
      t('profile.signOutMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.signOut'), style: 'destructive',
          onPress: async () => {
            setLoggingOut(true)
            await signOut()
          },
        },
      ]
    )
  }

  async function handleDeleteAccount() {
    const confirmWord = t('profile.deleteConfirmWord')
    if (deleteConfirm.trim().toUpperCase() !== confirmWord.toUpperCase()) {
      Alert.alert(t('profile.deleteErrorTitle'), t('profile.deleteMismatch'))
      return
    }
    setDeleting(true)
    try {
      const res = await requestAccountDeletion(deleteReason)
      if (res.ok) {
        setDeleteOpen(false)
        setDeleteReason('')
        setDeleteConfirm('')
        Alert.alert(t('profile.deleteSuccessTitle'), t('profile.deleteSuccessMsg'))
      } else {
        Alert.alert(t('profile.deleteErrorTitle'), res.message ?? t('common.error'))
      }
    } finally {
      setDeleting(false)
    }
  }

  const role = profile?.role
  type Tool = { key: string; label: string; icon: IconName; tint: 'blue' | 'violet' | 'green' | 'amber'; show: boolean; go: () => void }
  const tools: Tool[] = ([
    { key: 'team',  label: t('modules.workspace.team'),         icon: 'people-outline',    tint: 'blue',   show: canManageUsers(role) || canAccessAdmin(role), go: () => router.push('/(app)/team') },
    { key: 'users', label: t('modules.workspace.manageUsers'),  icon: 'person-add-outline', tint: 'violet', show: canManageUsers(role), go: () => router.push('/(app)/admin/users') },
    { key: 'admin', label: t('modules.workspace.admin'),        icon: 'shield-outline',    tint: 'violet', show: canAccessAdmin(role), go: () => router.push('/(app)/admin') },
    { key: 'ai',    label: t('modules.workspace.ai'),           icon: 'sparkles-outline',  tint: 'green',  show: canUseAI(role), go: () => router.push('/(app)/admin/ai-chat') },
    { key: 'acc',   label: t('modules.workspace.accidents'),    icon: 'warning-outline',   tint: 'amber',  show: canViewAccidents(role), go: () => router.push('/(app)/accident/dashboard') },
  ] as Tool[]).filter(x => x.show)

  return (
    <Screen edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* Profile card */}
        <Card level={2} style={StyleSheet.flatten([styles.profileCard, isRTL && styles.rowReverse])}>
          <View style={styles.avatar}>
            <AppText variant="h2" color="inverse" style={styles.avatarInitial}>
              {profile?.full_name?.[0]?.toUpperCase() ?? profile?.username?.[0]?.toUpperCase() ?? '?'}
            </AppText>
          </View>
          <View style={styles.profileInfo}>
            <AppText variant="h3" numberOfLines={1} style={{ textAlign }}>
              {profile?.full_name ?? profile?.username ?? t('tabs.profile')}
            </AppText>
            <View style={styles.roleBadge}>
              <AppText variant="micro" style={styles.roleText}>{roleLabel}</AppText>
            </View>
          </View>
        </Card>

        {/* Details */}
        {(profile?.employee_id || profile?.site || profile?.country) ? (
          <Card padded={false} style={styles.groupCard}>
            {profile?.employee_id && (
              <View style={[styles.detailRow, isRTL && styles.rowReverse]}>
                <Ionicons name="id-card-outline" size={16} color={theme.color.textMuted} />
                <AppText variant="body" color="secondary" style={[styles.detailLabel, { textAlign }]}>{t('profile.employeeId')}</AppText>
                <AppText variant="bodyStrong" style={{ textAlign }}>{profile.employee_id}</AppText>
              </View>
            )}
            {profile?.site && (
              <View style={[styles.detailRow, isRTL && styles.rowReverse]}>
                <Ionicons name="location-outline" size={16} color={theme.color.textMuted} />
                <AppText variant="body" color="secondary" style={[styles.detailLabel, { textAlign }]}>{t('profile.assignedSite')}</AppText>
                <AppText variant="bodyStrong" style={{ textAlign }}>{profile.site}</AppText>
              </View>
            )}
            {profile?.country && (
              <View style={[styles.detailRow, styles.detailRowLast, isRTL && styles.rowReverse]}>
                <Ionicons name="globe-outline" size={16} color={theme.color.textMuted} />
                <AppText variant="body" color="secondary" style={[styles.detailLabel, { textAlign }]}>{t('profile.country')}</AppText>
                <AppText variant="bodyStrong" style={{ textAlign }}>{profile.country}</AppText>
              </View>
            )}
          </Card>
        ) : null}

        {/* Workspace - role-specific shortcuts */}
        {tools.length > 0 && (
          <>
            <SectionHeader title={t('modules.workspace.title')} />
            <View style={styles.rowStack}>
              {tools.map(x => (
                <ListRow
                  key={x.key}
                  title={x.label}
                  icon={x.icon}
                  tint={x.tint}
                  onPress={x.go}
                />
              ))}
            </View>
          </>
        )}

        {/* Appearance section */}
        <SectionHeader title={t('profile.appearance')} />
        <Card padded={false} style={styles.groupCard}>
          <View style={styles.segment}>
            {APPEARANCE_OPTIONS.map(opt => {
              const active = preference === opt.key
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                  onPress={() => setPreference(opt.key)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={opt.icon}
                    size={20}
                    color={active ? theme.color.onPrimary : theme.color.textSecondary}
                  />
                  <AppText
                    variant="label"
                    style={{ color: active ? theme.color.onPrimary : theme.color.textSecondary }}
                  >
                    {t(opt.labelKey)}
                  </AppText>
                  {opt.hintKey ? (
                    <AppText
                      variant="micro"
                      style={{ color: active ? theme.color.onPrimary : theme.color.textMuted }}
                    >
                      {t(opt.hintKey)}
                    </AppText>
                  ) : null}
                </TouchableOpacity>
              )
            })}
          </View>
        </Card>

        {/* Language section */}
        <SectionHeader title={t('language.sectionTitle')} />
        <Card padded={false} style={styles.groupCard}>
          {LANG_OPTIONS.map((opt, idx) => {
            const active = language === opt.code
            return (
              <TouchableOpacity
                key={opt.code}
                style={[
                  styles.langRow,
                  isRTL && styles.rowReverse,
                  idx < LANG_OPTIONS.length - 1 && styles.divider,
                  active && styles.langRowActive,
                ]}
                onPress={() => setLanguage(opt.code)}
                activeOpacity={0.7}
              >
                <AppText
                  variant={active ? 'bodyStrong' : 'body'}
                  style={{ color: active ? theme.color.primaryDark : theme.color.text }}
                >
                  {t(opt.labelKey)}
                </AppText>
                {active && (
                  <Ionicons name="checkmark-circle" size={20} color={theme.color.primary} />
                )}
              </TouchableOpacity>
            )
          })}
        </Card>

        {/* Notifications section */}
        <SectionHeader title={t('profile.notifications')} />
        <Card padded={false} style={styles.groupCard}>
          <View style={[styles.detailRow, styles.detailRowLast, isRTL && styles.rowReverse]}>
            <Ionicons name="notifications-outline" size={16} color={theme.color.textMuted} />
            <AppText variant="body" color="secondary" style={[styles.detailLabel, { flex: 1, textAlign }]}>{t('profile.dailyReminder')}</AppText>
            <Switch
              value={reminderEnabled}
              onValueChange={toggleReminder}
              trackColor={{ false: theme.color.surfaceSunken, true: theme.color.primarySoft }}
              thumbColor={reminderEnabled ? theme.color.primary : theme.color.textMuted}
            />
          </View>
          {reminderEnabled && (
            <View style={[styles.reminderTimeRow, isRTL && styles.rowReverse]}>
              <AppText variant="caption" color="secondary" style={styles.reminderTimeLabel}>{t('profile.remindAt')}</AppText>
              <View style={styles.reminderHourRow}>
                {reminderHours.map(h => {
                  const active = reminderHour === h
                  return (
                    <TouchableOpacity
                      key={h}
                      style={[styles.hourChip, active && styles.hourChipActive]}
                      onPress={async () => {
                        setReminderHour(h)
                        await scheduleDailyInspectionReminder(h, 0)
                      }}
                    >
                      <AppText
                        variant="caption"
                        style={{ color: active ? theme.color.onPrimary : theme.color.textSecondary }}
                      >
                        {h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`}
                      </AppText>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
          )}
        </Card>

        {/* Sync section */}
        <SectionHeader title={t('profile.offlineQueue')} />
        <Card padded={false} style={styles.groupCard}>
          <View style={styles.syncStats}>
            <View style={styles.syncStat}>
              <AppText variant="display" style={{ color: pending > 0 ? theme.color.warning.base : theme.color.text }}>{pending}</AppText>
              <AppText variant="caption" color="muted">{t('profile.pending')}</AppText>
            </View>
            <View style={styles.syncStatDivider} />
            <View style={styles.syncStat}>
              <AppText variant="display">{queueTotal}</AppText>
              <AppText variant="caption" color="muted">{t('profile.totalQueued')}</AppText>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.actionBtn, syncing && styles.actionBtnDisabled]}
            onPress={handleSync}
            disabled={syncing}
          >
            {syncing
              ? <ActivityIndicator size="small" color={theme.color.primary} />
              : <Ionicons name="cloud-upload-outline" size={18} color={theme.color.primary} />
            }
            <AppText variant="bodyStrong" color="primary">
              {syncing ? t('profile.syncing') : t('profile.syncNow')}
            </AppText>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostBtn} onPress={handleClearSynced}>
            <Ionicons name="trash-outline" size={16} color={theme.color.textMuted} />
            <AppText variant="caption" color="muted">{t('profile.clearSynced')}</AppText>
          </TouchableOpacity>
        </Card>

        {/* Account / Sign out */}
        <SectionHeader title={t('profile.account')} />
        <Button
          label={t('profile.signOut')}
          icon="log-out-outline"
          variant="danger"
          full
          loading={loggingOut}
          onPress={handleLogout}
        />

        {/* Danger zone - account & data deletion request (Play requirement) */}
        <SectionHeader title={t('profile.dangerZone')} />
        <Card padded={false} style={styles.groupCard}>
          <TouchableOpacity
            style={[styles.deleteToggle, isRTL && styles.rowReverse]}
            onPress={() => setDeleteOpen(o => !o)}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={18} color={theme.color.danger.base} />
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong" style={{ color: theme.color.danger.base, textAlign }}>
                {t('profile.deleteAccount')}
              </AppText>
              <AppText variant="caption" color="muted" style={{ textAlign }}>
                {t('profile.deleteAccountSubtitle')}
              </AppText>
            </View>
            <Ionicons
              name={deleteOpen ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={theme.color.textMuted}
            />
          </TouchableOpacity>

          {deleteOpen && (
            <View style={styles.deletePanel}>
              <AppText variant="caption" color="secondary" style={{ textAlign }}>
                {t('profile.deleteIntro')}
              </AppText>
              <AppText variant="caption" color="muted" style={{ textAlign }}>
                {t('profile.deleteWhatHappens')}
              </AppText>
              <AppText variant="caption" color="muted" style={{ textAlign }}>
                {t('profile.deleteTimeline')}
              </AppText>

              <AppText variant="label" color="secondary" style={[styles.deleteFieldLabel, { textAlign }]}>
                {t('profile.deleteReasonLabel')}
              </AppText>
              <TextInput
                style={[styles.input, styles.inputMultiline, { textAlign }]}
                value={deleteReason}
                onChangeText={setDeleteReason}
                placeholder={t('profile.deleteReasonPlaceholder')}
                placeholderTextColor={theme.color.textMuted}
                multiline
                numberOfLines={3}
                editable={!deleting}
              />

              <AppText variant="label" color="secondary" style={[styles.deleteFieldLabel, { textAlign }]}>
                {t('profile.deleteConfirmLabel')}
              </AppText>
              <TextInput
                style={[styles.input, { textAlign }]}
                value={deleteConfirm}
                onChangeText={setDeleteConfirm}
                placeholder={t('profile.deleteConfirmPlaceholder')}
                placeholderTextColor={theme.color.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!deleting}
              />

              <Button
                label={deleting ? t('profile.deleteSubmitting') : t('profile.deleteSubmit')}
                icon="trash-outline"
                variant="danger"
                full
                loading={deleting}
                disabled={deleting || deleteConfirm.trim().toUpperCase() !== t('profile.deleteConfirmWord').toUpperCase()}
                onPress={handleDeleteAccount}
              />
            </View>
          )}
        </Card>

        <AppText variant="caption" color="muted" center style={styles.version}>{t('profile.version')}</AppText>
      </ScrollView>
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    scroll: { flex: 1 },
    content: { padding: spacing.xl, paddingBottom: spacing['4xl'], gap: spacing.md },
    rowReverse: { flexDirection: 'row-reverse' },
    rowStack: { gap: spacing.sm },
    groupCard: { overflow: 'hidden' },

    profileCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: radius.lg,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: { lineHeight: 30 },
    profileInfo: { flex: 1, gap: spacing.xs },
    roleBadge: {
      alignSelf: 'flex-start',
      backgroundColor: c.primarySoft,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 3,
    },
    roleText: { color: c.primaryDark, textTransform: 'uppercase' },

    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg - 2,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    detailRowLast: { borderBottomWidth: 0 },
    detailLabel: { flex: 1 },

    segment: {
      flexDirection: 'row',
      padding: spacing.xs,
      gap: spacing.xs,
    },
    segmentItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.surfaceAlt,
    },
    segmentItemActive: {
      backgroundColor: c.primary,
      ...elevation(theme, 1),
    },

    langRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg - 1,
    },
    langRowActive: { backgroundColor: c.primarySoft },
    divider: { borderBottomWidth: 1, borderBottomColor: c.border },

    syncStats: {
      flexDirection: 'row',
      paddingVertical: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    syncStat: { flex: 1, alignItems: 'center', gap: spacing.xs },
    syncStatDivider: { width: 1, backgroundColor: c.border, marginVertical: spacing.sm },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.lg - 2,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    actionBtnDisabled: { opacity: 0.5 },
    ghostBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
    },

    version: { marginTop: spacing.sm },

    reminderTimeRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, flexWrap: 'wrap',
    },
    reminderTimeLabel: { minWidth: 80 },
    reminderHourRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    hourChip: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1, borderRadius: radius.sm,
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
    },
    hourChipActive: { backgroundColor: c.primary, borderColor: c.primary },

    deleteToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg - 2,
    },
    deletePanel: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      gap: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: spacing.md,
    },
    deleteFieldLabel: { marginTop: spacing.sm },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      color: c.text,
      ...typography.body,
    },
    inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  })
}
