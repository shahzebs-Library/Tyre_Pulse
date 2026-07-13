/**
 * Checklist approvals — supervisor queue
 *
 * Lists submissions from `require_approval` templates that are still pending
 * (approval_status = 'pending'), newest first, each opening a review screen
 * where the approver inspects the inspector's answers + drawn signature and
 * signs off (approve) or returns it with a note (reject).
 *
 * Access is gated to elevated roles both in nav (canApproveChecklists) and at
 * the database (V212 RLS) so hiding the entry is never the only defence.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, StatusBar, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../../contexts/AuthContext'
import { useLanguage } from '../../../../contexts/LanguageContext'
import { canApproveChecklists } from '../../../../lib/permissions'
import { listPendingApprovals, ChecklistSubmission } from '../../../../lib/checklists'

function looksLikeMissingTable(msg: string): boolean {
  const m = (msg || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache')
}

export default function ChecklistApprovalsScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
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
        <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { textAlign }]}>Approvals</Text>
        <Text style={[styles.sub, { textAlign }]}>
          {count} awaiting sign-off
        </Text>
      </View>
    </View>
  )

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
        {header}
        <View style={styles.stateWrap}>
          <Ionicons name="lock-closed-outline" size={52} color="#cbd5e1" />
          <Text style={styles.stateTitle}>Not available</Text>
          <Text style={styles.stateText}>
            Checklist approvals are limited to supervisors and managers.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      {header}

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#16a34a" />
        </View>
      ) : notEnabled ? (
        <View style={styles.stateWrap}>
          <Ionicons name="shield-checkmark-outline" size={52} color="#cbd5e1" />
          <Text style={styles.stateTitle}>Approvals aren't enabled yet</Text>
          <Text style={styles.stateText}>
            Publish checklist templates with approval required to build a queue here.
          </Text>
        </View>
      ) : error ? (
        <View style={styles.stateWrap}>
          <Ionicons name="cloud-offline-outline" size={52} color="#fca5a5" />
          <Text style={styles.stateTitle}>Couldn't load approvals</Text>
          <Text style={styles.stateText} numberOfLines={3}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={onRefresh} disabled={refreshing}>
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
          showsVerticalScrollIndicator={false}
        >
          {count === 0 ? (
            <View style={styles.inlineEmpty}>
              <Ionicons name="checkmark-done-outline" size={22} color="#16a34a" />
              <Text style={styles.inlineEmptyText}>Nothing awaiting approval</Text>
            </View>
          ) : (
            items.map(s => {
              const when = s.submitted_at
                ? new Date(s.submitted_at).toLocaleDateString(dateLocale, {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })
                : '—'
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.card, isRTL && styles.rowR]}
                  activeOpacity={0.75}
                  onPress={() => open(s)}
                >
                  <View style={styles.icon}>
                    <Ionicons name="shield-checkmark-outline" size={20} color="#b45309" />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[styles.cardTitle, { textAlign }]} numberOfLines={1}>
                      {s.title || s.template_name || 'Checklist'}
                    </Text>
                    {!!(s.site || s.asset_no) && (
                      <View style={[styles.metaRow, isRTL && styles.rowR]}>
                        <Ionicons name="location-outline" size={12} color="#94a3b8" />
                        <Text style={styles.metaText} numberOfLines={1}>
                          {[s.site, s.asset_no].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                    )}
                    <View style={[styles.metaRow, isRTL && styles.rowR]}>
                      <Ionicons name="calendar-outline" size={12} color="#94a3b8" />
                      <Text style={styles.metaText}>{when}</Text>
                      {s.score_pct != null && (
                        <>
                          <Text style={styles.metaDot}>·</Text>
                          <Text style={[styles.scoreText, s.score_passed === false && styles.scoreFail]}>
                            {s.score_pct}%
                          </Text>
                        </>
                      )}
                    </View>
                  </View>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>Pending</Text>
                  </View>
                  <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color="#cbd5e1" />
                </TouchableOpacity>
              )
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  rowR: { flexDirection: 'row-reverse' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  backBtn: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  sub: { fontSize: 12, color: '#64748b', marginTop: 2 },

  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 10 },

  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  stateTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  stateText: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
    backgroundColor: '#16a34a', borderRadius: 12, paddingHorizontal: 18, height: 44,
    justifyContent: 'center',
  },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  inlineEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },
  inlineEmptyText: { fontSize: 13, fontWeight: '700', color: '#16a34a' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  icon: {
    width: 40, height: 40, borderRadius: 11,
    backgroundColor: 'rgba(245,158,11,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  metaText: { fontSize: 11.5, color: '#94a3b8' },
  metaDot: { fontSize: 11.5, color: '#cbd5e1' },
  scoreText: { fontSize: 11.5, fontWeight: '800', color: '#15803d' },
  scoreFail: { color: '#dc2626' },
  pill: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: 'rgba(245,158,11,0.12)' },
  pillText: { fontSize: 10, fontWeight: '800', color: '#b45309' },
})
