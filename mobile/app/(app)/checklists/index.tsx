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
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, StatusBar, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
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

function relativeHint(due: string): string {
  const n = daysUntil(due)
  if (n === 0) return 'due today'
  if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} overdue`
  return `due in ${n} day${n === 1 ? '' : 's'}`
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
  const { isRTL } = useLanguage()
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
      const msg = e?.message || e?.error_description || 'Could not load checklists.'
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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />

      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { textAlign }]}>Checklists</Text>
          <Text style={[styles.sub, { textAlign }]}>
            {due.length} due · {templates.length} available
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#16a34a" />
        </View>
      ) : notEnabled ? (
        <View style={styles.stateWrap}>
          <Ionicons name="checkbox-outline" size={52} color="#cbd5e1" />
          <Text style={styles.stateTitle}>Checklists aren't enabled yet</Text>
          <Text style={styles.stateText}>
            Ask your administrator to publish checklist templates for your site.
          </Text>
        </View>
      ) : error ? (
        <View style={styles.stateWrap}>
          <Ionicons name="cloud-offline-outline" size={52} color="#fca5a5" />
          <Text style={styles.stateTitle}>Couldn't load checklists</Text>
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
          {/* ── Approver entry (elevated roles) ──────────────────────────────── */}
          {canApprove && (
            <TouchableOpacity
              style={[styles.approvalsCard, isRTL && styles.rowR]}
              activeOpacity={0.8}
              onPress={() => router.push('/(app)/checklists/approvals')}
            >
              <View style={styles.approvalsIcon}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#b45309" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.approvalsTitle, { textAlign }]}>Approvals</Text>
                <Text style={[styles.approvalsSub, { textAlign }]}>
                  {pendingApprovals > 0
                    ? `${pendingApprovals} checklist${pendingApprovals === 1 ? '' : 's'} awaiting sign-off`
                    : 'Review and sign off submitted checklists'}
                </Text>
              </View>
              {pendingApprovals > 0 && (
                <View style={styles.approvalsBadge}>
                  <Text style={styles.approvalsBadgeText}>{pendingApprovals}</Text>
                </View>
              )}
              <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color="#cbd5e1" />
            </TouchableOpacity>
          )}

          {/* ── Section A · Due ──────────────────────────────────────────────── */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Due</Text>
            {due.length > 0 && (
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>{due.length}</Text>
              </View>
            )}
          </View>

          {due.length === 0 ? (
            <View style={styles.inlineEmpty}>
              <Ionicons name="checkmark-done-outline" size={22} color="#16a34a" />
              <Text style={styles.inlineEmptyText}>No checklists due</Text>
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
                        color={overdue ? '#dc2626' : '#d97706'}
                      />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={[styles.cardTitle, { textAlign }]} numberOfLines={1}>
                        {a.template_name ?? 'Checklist'}
                      </Text>
                      <View style={[styles.metaRow, isRTL && styles.rowR]}>
                        {!!(a.site || a.asset_no) && (
                          <>
                            <Ionicons name="location-outline" size={12} color="#94a3b8" />
                            <Text style={styles.metaText} numberOfLines={1}>
                              {[a.site, a.asset_no].filter(Boolean).join(' · ')}
                            </Text>
                          </>
                        )}
                      </View>
                      <View style={[styles.metaRow, isRTL && styles.rowR]}>
                        <Ionicons name="calendar-outline" size={12} color="#94a3b8" />
                        <Text style={styles.metaText}>{dueLabel}</Text>
                        <Text style={styles.metaDot}>·</Text>
                        <Text style={[styles.hintText, overdue && styles.hintOverdue]}>
                          {relativeHint(a.due_date)}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.statusPill, overdue ? styles.pillOverdue : styles.pillPending]}>
                      <Text style={[styles.statusPillText, overdue ? styles.pillTextOverdue : styles.pillTextPending]}>
                        {overdue ? 'Overdue' : 'Pending'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )
              })}
            </View>
          )}

          {/* ── Section B · All checklists ───────────────────────────────────── */}
          <View style={[styles.sectionHead, { marginTop: 8 }]}>
            <Text style={styles.sectionTitle}>All checklists</Text>
          </View>

          {templates.length === 0 ? (
            <View style={styles.inlineEmpty}>
              <Ionicons name="document-outline" size={22} color="#cbd5e1" />
              <Text style={[styles.inlineEmptyText, { color: '#94a3b8' }]}>No published checklists</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {templates.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.tplCard}
                  activeOpacity={0.75}
                  onPress={() => openTemplate(t)}
                >
                  <View style={[styles.tplHead, isRTL && styles.rowR]}>
                    <View style={styles.tplIcon}>
                      <Ionicons name={(t.icon as any) || 'checkbox-outline'} size={20} color="#16a34a" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardTitle, { textAlign }]} numberOfLines={1}>{t.name}</Text>
                      {!!t.category && (
                        <Text style={[styles.tplCategory, { textAlign }]} numberOfLines={1}>{t.category}</Text>
                      )}
                    </View>
                    <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color="#cbd5e1" />
                  </View>

                  <View style={[styles.badgeRow, isRTL && styles.rowR]}>
                    <View style={styles.badge}>
                      <Ionicons name="list-outline" size={12} color="#64748b" />
                      <Text style={styles.badgeText}>{fieldCount(t)} fields</Text>
                    </View>
                    {t.scored && (
                      <View style={[styles.badge, styles.badgeGreen]}>
                        <Ionicons name="ribbon-outline" size={12} color="#16a34a" />
                        <Text style={[styles.badgeText, { color: '#15803d' }]}>Scored</Text>
                      </View>
                    )}
                    {t.require_signature && (
                      <View style={[styles.badge, styles.badgeBlue]}>
                        <Ionicons name="create-outline" size={12} color="#2563eb" />
                        <Text style={[styles.badgeText, { color: '#1d4ed8' }]}>Signature</Text>
                      </View>
                    )}
                    {t.require_approval && (
                      <View style={[styles.badge, styles.badgeAmber]}>
                        <Ionicons name="shield-checkmark-outline" size={12} color="#b45309" />
                        <Text style={[styles.badgeText, { color: '#b45309' }]}>Approval</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
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
  content: { padding: 16, paddingBottom: 40, gap: 12 },

  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  stateTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  stateText: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
    backgroundColor: '#16a34a', borderRadius: 12, paddingHorizontal: 18, height: 44,
    justifyContent: 'center',
  },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  approvalsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fffbeb', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)',
  },
  approvalsIcon: {
    width: 40, height: 40, borderRadius: 11,
    backgroundColor: 'rgba(245,158,11,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  approvalsTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  approvalsSub: { fontSize: 11.5, color: '#92400e', marginTop: 2 },
  approvalsBadge: {
    minWidth: 22, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10,
    backgroundColor: '#b45309', alignItems: 'center',
  },
  approvalsBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  countPill: {
    minWidth: 22, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10,
    backgroundColor: 'rgba(220,38,38,0.1)', alignItems: 'center',
  },
  countPillText: { fontSize: 11, fontWeight: '800', color: '#dc2626' },

  inlineEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },
  inlineEmptyText: { fontSize: 13, fontWeight: '700', color: '#16a34a' },

  dueCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  dueIcon: {
    width: 40, height: 40, borderRadius: 11,
    backgroundColor: 'rgba(245,158,11,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  dueIconOverdue: { backgroundColor: 'rgba(220,38,38,0.1)' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  metaText: { fontSize: 11.5, color: '#94a3b8' },
  metaDot: { fontSize: 11.5, color: '#cbd5e1' },
  hintText: { fontSize: 11.5, fontWeight: '700', color: '#d97706' },
  hintOverdue: { color: '#dc2626' },
  statusPill: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  pillPending: { backgroundColor: 'rgba(245,158,11,0.12)' },
  pillOverdue: { backgroundColor: 'rgba(220,38,38,0.12)' },
  statusPillText: { fontSize: 10, fontWeight: '800' },
  pillTextPending: { color: '#b45309' },
  pillTextOverdue: { color: '#dc2626' },

  tplCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 10,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  tplHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tplIcon: {
    width: 40, height: 40, borderRadius: 11,
    backgroundColor: 'rgba(22,163,74,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  tplCategory: { fontSize: 11.5, color: '#94a3b8', marginTop: 2 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f1f5f9', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  badgeGreen: { backgroundColor: 'rgba(22,163,74,0.1)' },
  badgeBlue: { backgroundColor: 'rgba(37,99,235,0.1)' },
  badgeAmber: { backgroundColor: 'rgba(245,158,11,0.12)' },
  badgeText: { fontSize: 10.5, fontWeight: '700', color: '#64748b' },
})
