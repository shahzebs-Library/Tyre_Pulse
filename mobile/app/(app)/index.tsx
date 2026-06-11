import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, StatusBar,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { getQueue, getPendingCount, syncQueue } from '../../lib/offlineQueue'
import { supabase } from '../../lib/supabase'
import SyncBanner from '../../components/SyncBanner'

export default function HomeScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()
  const [pendingCount, setPendingCount] = useState(0)
  const [recentInspections, setRecentInspections] = useState<any[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [todayCount, setTodayCount] = useState(0)

  const today = new Date().toLocaleDateString(isRTL ? 'ar-SA' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  const load = useCallback(async () => {
    const count = await getPendingCount()
    setPendingCount(count)

    const queue = await getQueue()
    const offlineItems = queue.slice(0, 3).map(item => ({
      id: item.id,
      title: item.payload.title,
      site: item.payload.site,
      asset_no: item.payload.asset_no,
      inspection_date: item.payload.inspection_date,
      sync_status: item.sync_status,
      isOffline: true,
    }))

    const { data: dbItems } = await supabase
      .from('inspections')
      .select('id, title, site, asset_no, inspection_date, status')
      .eq('created_by', profile?.id)
      .order('created_at', { ascending: false })
      .limit(5)

    const todayStr = new Date().toISOString().split('T')[0]
    const todayItems = dbItems?.filter(i => i.inspection_date?.startsWith(todayStr)) ?? []
    setTodayCount(todayItems.length + queue.filter(i =>
      i.payload.inspection_date?.startsWith(todayStr)
    ).length)

    const combined = [...offlineItems, ...(dbItems ?? [])].slice(0, 5)
    setRecentInspections(combined)
  }, [profile?.id])

  useEffect(() => { load() }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await syncQueue()
    await load()
    setRefreshing(false)
  }

  const firstName = profile?.full_name?.split(' ')[0] ?? t('tabs.profile')
  const hour = new Date().getHours()
  const greeting = hour < 12
    ? t('home.goodMorning')
    : hour < 17
    ? t('home.goodAfternoon')
    : t('home.goodEvening')

  const textAlign = isRTL ? 'right' : 'left'

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <SyncBanner />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />
        }
      >
        {/* Header */}
        <View style={[styles.header, isRTL && styles.headerRTL]}>
          <View>
            <Text style={[styles.greeting, { textAlign }]}>{greeting}, {firstName} 👋</Text>
            <Text style={[styles.date, { textAlign }]}>{today}</Text>
          </View>
          {pendingCount > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
              <Text style={styles.pendingBadgeLabel}>{t('home.pending')}</Text>
            </View>
          )}
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{todayCount}</Text>
            <Text style={styles.statLabel}>{t('home.today')}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, pendingCount > 0 && { color: '#f59e0b' }]}>
              {pendingCount}
            </Text>
            <Text style={styles.statLabel}>{t('home.pendingSync')}</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="checkmark-circle" size={22} color="#16a34a" />
            <Text style={styles.statLabel}>
              {profile?.site ?? t('home.allSites')}
            </Text>
          </View>
        </View>

        {/* Primary CTA */}
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => router.push('/(app)/inspection/new')}
          activeOpacity={0.88}
        >
          <View style={styles.ctaIcon}>
            <Ionicons name="add-circle" size={28} color="#fff" />
          </View>
          <View style={styles.ctaText}>
            <Text style={styles.ctaTitle}>{t('home.startInspection')}</Text>
            <Text style={styles.ctaSubtitle}>{t('home.startSubtitle')}</Text>
          </View>
          <Ionicons
            name={isRTL ? 'arrow-back-circle' : 'arrow-forward-circle'}
            size={28}
            color="rgba(255,255,255,0.7)"
          />
        </TouchableOpacity>

        {/* Secondary: Scanner */}
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => router.push('/(app)/scanner')}
          activeOpacity={0.85}
        >
          <View style={styles.scanIcon}>
            <Ionicons name="scan" size={24} color="#16a34a" />
          </View>
          <View style={styles.ctaText}>
            <Text style={[styles.scanTitle, { textAlign }]}>{t('home.scanAsset')}</Text>
            <Text style={[styles.scanSubtitle, { textAlign }]}>{t('home.scanSubtitle')}</Text>
          </View>
          <Ionicons
            name={isRTL ? 'chevron-back' : 'chevron-forward'}
            size={22}
            color="#94a3b8"
          />
        </TouchableOpacity>

        {/* Recent */}
        {recentInspections.length > 0 && (
          <View style={styles.section}>
            <View style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}>
              <Text style={[styles.sectionTitle, { textAlign }]}>{t('home.recentInspections')}</Text>
              <TouchableOpacity onPress={() => router.push('/(app)/history')}>
                <Text style={styles.sectionLink}>{t('home.viewAll')}</Text>
              </TouchableOpacity>
            </View>
            {recentInspections.map(item => (
              <View key={item.id} style={styles.recentCard}>
                <View style={styles.recentIcon}>
                  <Ionicons name="document-text-outline" size={18} color="#16a34a" />
                </View>
                <View style={styles.recentInfo}>
                  <Text style={[styles.recentTitle, { textAlign }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[styles.recentMeta, { textAlign }]}>
                    {item.site} · {item.asset_no} · {
                      new Date(item.inspection_date).toLocaleDateString(isRTL ? 'ar-SA' : 'en-GB', {
                        day: 'numeric', month: 'short',
                      })
                    }
                  </Text>
                </View>
                <View style={[
                  styles.syncBadge,
                  item.sync_status === 'pending' && styles.syncBadgePending,
                  item.sync_status === 'failed' && styles.syncBadgeFailed,
                ]}>
                  <Text style={[
                    styles.syncBadgeText,
                    item.sync_status === 'pending' && { color: '#b45309' },
                    item.sync_status === 'failed' && { color: '#dc2626' },
                  ]}>
                    {item.sync_status === 'pending' ? t('home.pending')
                      : item.sync_status === 'failed' ? t('home.failed')
                      : t('home.synced')}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {recentInspections.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="clipboard-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyTitle}>{t('home.noInspections')}</Text>
            <Text style={styles.emptySubtitle}>{t('home.noInspectionsHint')}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  scroll: { flex: 1 },
  content: { padding: 20, gap: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerRTL: { flexDirection: 'row-reverse' },
  greeting: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  date: { fontSize: 13, color: '#64748b', marginTop: 3 },
  pendingBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pendingBadgeText: { fontSize: 18, fontWeight: '800', color: '#d97706' },
  pendingBadgeLabel: { fontSize: 10, color: '#b45309', fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  statNumber: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  statLabel: { fontSize: 11, color: '#64748b', fontWeight: '500', textAlign: 'center' },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#16a34a',
    borderRadius: 18,
    padding: 18,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  ctaIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { flex: 1 },
  ctaTitle: { fontSize: 17, fontWeight: '800', color: '#fff' },
  ctaSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(22,163,74,0.25)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  scanIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(22,163,74,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  scanSubtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionHeaderRTL: { flexDirection: 'row-reverse' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  sectionLink: { fontSize: 13, color: '#16a34a', fontWeight: '600' },
  recentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  recentIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(22,163,74,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentInfo: { flex: 1, gap: 3 },
  recentTitle: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  recentMeta: { fontSize: 11, color: '#94a3b8' },
  syncBadge: {
    backgroundColor: 'rgba(22,163,74,0.08)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  syncBadgePending: { backgroundColor: 'rgba(245,158,11,0.1)' },
  syncBadgeFailed: { backgroundColor: 'rgba(239,68,68,0.1)' },
  syncBadgeText: { fontSize: 10, fontWeight: '700', color: '#15803d' },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#94a3b8' },
  emptySubtitle: { fontSize: 13, color: '#cbd5e1', textAlign: 'center' },
})
