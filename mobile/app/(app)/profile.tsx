import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ScrollView, StatusBar, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage, Language } from '../../contexts/LanguageContext'
import { getPendingCount, syncQueue, retryFailed, clearSynced, getQueue } from '../../lib/offlineQueue'

const LANG_OPTIONS: { code: Language; labelKey: string }[] = [
  { code: 'en', labelKey: 'language.english' },
  { code: 'ar', labelKey: 'language.arabic' },
  { code: 'ur', labelKey: 'language.urdu' },
]

export default function ProfileScreen() {
  const { profile, signOut } = useAuth()
  const { t, language, setLanguage, isRTL } = useLanguage()
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [queueTotal, setQueueTotal] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'

  // DB stores roles Title-cased ("Tyre Man"); locale keys are snake_case.
  const roleKey = (profile?.role ?? '').toLowerCase().replace(/\s+/g, '_')
  const roleLabel = t(`profile.roles.${roleKey}`) !== `profile.roles.${roleKey}`
    ? t(`profile.roles.${roleKey}`)
    : (profile?.role ?? '')

  async function load() {
    const count = await getPendingCount()
    const queue = await getQueue()
    setPending(count)
    setQueueTotal(queue.length)
  }

  useEffect(() => { load() }, [])

  async function handleSync() {
    setSyncing(true)
    try {
      await retryFailed()
      const { synced, failed } = await syncQueue()
      await load()
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
          onPress: async () => { await clearSynced(); load() },
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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* Profile card */}
        <View style={[styles.profileCard, isRTL && styles.profileCardRTL]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>
              {profile?.full_name?.[0]?.toUpperCase() ?? profile?.username?.[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.name, { textAlign }]}>
              {profile?.full_name ?? profile?.username ?? t('tabs.profile')}
            </Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{roleLabel}</Text>
            </View>
          </View>
        </View>

        {/* Details */}
        <View style={styles.section}>
          {profile?.employee_id && (
            <View style={[styles.detailRow, isRTL && styles.detailRowRTL]}>
              <Ionicons name="id-card-outline" size={16} color="#64748b" />
              <Text style={[styles.detailLabel, { textAlign }]}>{t('profile.employeeId')}</Text>
              <Text style={[styles.detailValue, { textAlign }]}>{profile.employee_id}</Text>
            </View>
          )}
          {profile?.site && (
            <View style={[styles.detailRow, isRTL && styles.detailRowRTL]}>
              <Ionicons name="location-outline" size={16} color="#64748b" />
              <Text style={[styles.detailLabel, { textAlign }]}>{t('profile.assignedSite')}</Text>
              <Text style={[styles.detailValue, { textAlign }]}>{profile.site}</Text>
            </View>
          )}
          {profile?.country && (
            <View style={[styles.detailRow, isRTL && styles.detailRowRTL]}>
              <Ionicons name="globe-outline" size={16} color="#64748b" />
              <Text style={[styles.detailLabel, { textAlign }]}>{t('profile.country')}</Text>
              <Text style={[styles.detailValue, { textAlign }]}>{profile.country}</Text>
            </View>
          )}
        </View>

        {/* Language section */}
        <Text style={[styles.sectionTitle, { textAlign }]}>{t('language.sectionTitle')}</Text>
        <View style={styles.section}>
          {LANG_OPTIONS.map((opt, idx) => (
            <TouchableOpacity
              key={opt.code}
              style={[
                styles.langRow,
                isRTL && styles.langRowRTL,
                idx < LANG_OPTIONS.length - 1 && styles.langRowBorder,
                language === opt.code && styles.langRowActive,
              ]}
              onPress={() => setLanguage(opt.code)}
              activeOpacity={0.7}
            >
              <Text style={[styles.langLabel, language === opt.code && styles.langLabelActive]}>
                {t(opt.labelKey)}
              </Text>
              {language === opt.code && (
                <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Sync section */}
        <Text style={[styles.sectionTitle, { textAlign }]}>{t('profile.offlineQueue')}</Text>
        <View style={styles.section}>
          <View style={styles.syncStats}>
            <View style={styles.syncStat}>
              <Text style={[styles.syncStatNum, pending > 0 && { color: '#d97706' }]}>{pending}</Text>
              <Text style={styles.syncStatLabel}>{t('profile.pending')}</Text>
            </View>
            <View style={styles.syncStatDivider} />
            <View style={styles.syncStat}>
              <Text style={styles.syncStatNum}>{queueTotal}</Text>
              <Text style={styles.syncStatLabel}>{t('profile.totalQueued')}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.actionBtn, syncing && styles.actionBtnDisabled]}
            onPress={handleSync}
            disabled={syncing}
          >
            {syncing
              ? <ActivityIndicator size="small" color="#16a34a" />
              : <Ionicons name="cloud-upload-outline" size={18} color="#16a34a" />
            }
            <Text style={styles.actionBtnText}>
              {syncing ? t('profile.syncing') : t('profile.syncNow')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostBtn} onPress={handleClearSynced}>
            <Ionicons name="trash-outline" size={16} color="#94a3b8" />
            <Text style={styles.ghostBtnText}>{t('profile.clearSynced')}</Text>
          </TouchableOpacity>
        </View>

        {/* Account / Sign out */}
        <Text style={[styles.sectionTitle, { textAlign }]}>{t('profile.account')}</Text>
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.signOutBtn, loggingOut && styles.actionBtnDisabled]}
            onPress={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut
              ? <ActivityIndicator size="small" color="#dc2626" />
              : <Ionicons name="log-out-outline" size={18} color="#dc2626" />
            }
            <Text style={styles.signOutText}>{t('profile.signOut')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.version}>{t('profile.version')}</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 48, gap: 12 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  profileCardRTL: { flexDirection: 'row-reverse' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 24, fontWeight: '800', color: '#fff' },
  profileInfo: { flex: 1, gap: 6 },
  name: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(22,163,74,0.1)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  roleText: { fontSize: 11, fontWeight: '700', color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  detailRowRTL: { flexDirection: 'row-reverse' },
  detailLabel: { fontSize: 13, color: '#64748b', flex: 1 },
  detailValue: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  langRowRTL: { flexDirection: 'row-reverse' },
  langRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  langRowActive: {
    backgroundColor: 'rgba(22,163,74,0.04)',
  },
  langLabel: { fontSize: 15, color: '#0f172a', fontWeight: '500' },
  langLabelActive: { color: '#16a34a', fontWeight: '700' },
  syncStats: {
    flexDirection: 'row',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  syncStat: { flex: 1, alignItems: 'center', gap: 2 },
  syncStatNum: { fontSize: 24, fontWeight: '800', color: '#0f172a' },
  syncStatLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '500' },
  syncStatDivider: { width: 1, backgroundColor: '#f1f5f9', marginVertical: 8 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { fontSize: 15, fontWeight: '700', color: '#16a34a' },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  ghostBtnText: { fontSize: 13, color: '#94a3b8' },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  signOutText: { fontSize: 15, fontWeight: '700', color: '#dc2626' },
  version: { textAlign: 'center', fontSize: 12, color: '#cbd5e1', marginTop: 8 },
})
