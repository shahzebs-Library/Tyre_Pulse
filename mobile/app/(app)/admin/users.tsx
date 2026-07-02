/**
 * Admin User Management
 *
 * Review and approve pending user registrations.
 * Search, filter by role, and manage all profiles.
 * Admin-only screen - accessed from the Admin tab.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, RefreshControl, TextInput, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { normaliseRole, COUNTRIES } from '../../../lib/types'
import { useAdminGuard } from '../../../hooks/useRoleGuard'

interface UserProfile {
  id: string
  full_name: string | null
  username: string | null
  employee_id: string | null
  role: string | null
  site: string | null
  country: string | null
  approved: boolean
  locked: boolean | null
  created_at: string
  pending_reason: string | null
}

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  admin:     { bg: '#f5f3ff', text: '#7c3aed' },
  manager:   { bg: '#eff6ff', text: '#2563eb' },
  director:  { bg: '#fdf4ff', text: '#9333ea' },
  inspector: { bg: '#f0fdf4', text: '#16a34a' },
  tyre_man:  { bg: '#fff7ed', text: '#ea580c' },
  reporter:  { bg: '#f8fafc', text: '#64748b' },
}

type FilterKey = 'all' | 'pending' | 'approved'

export default function UserManagementScreen() {
  const { allowed, loading: guardLoading } = useAdminGuard()   // admin only
  const { profile } = useAuth()
  const router = useRouter()

  const [users, setUsers]         = useState<UserProfile[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState<FilterKey>('pending')
  const [acting, setActing]       = useState<string | null>(null) // userId being actioned

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, username, employee_id, role, site, country, approved, locked, created_at, pending_reason')
      .order('approved', { ascending: true }) // pending first
      .order('created_at', { ascending: false })
      .limit(200)
    setUsers((data ?? []) as UserProfile[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false) }

  async function approve(user: UserProfile) {
    Alert.alert(
      'Approve User',
      `Grant ${user.full_name ?? user.username ?? 'this user'} access to TyrePulse?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setActing(user.id)
            const { error } = await supabase
              .from('profiles')
              .update({ approved: true })
              .eq('id', user.id)
            setActing(null)
            if (error) Alert.alert('Error', 'Failed to approve user.')
            else setUsers(prev => prev.map(u => u.id === user.id ? { ...u, approved: true } : u))
          },
        },
      ]
    )
  }

  async function reject(user: UserProfile) {
    Alert.alert(
      'Reject & Remove',
      `Remove ${user.full_name ?? user.username ?? 'this user'}? This deletes their profile.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setActing(user.id)
            const { error } = await supabase
              .from('profiles')
              .delete()
              .eq('id', user.id)
            setActing(null)
            if (error) Alert.alert('Error', 'Failed to remove user.')
            else setUsers(prev => prev.filter(u => u.id !== user.id))
          },
        },
      ]
    )
  }

  async function changeRole(user: UserProfile) {
    const roles = ['admin', 'manager', 'director', 'inspector', 'tyre_man']
    // Map normalised keys → display labels for the DB
    const dbLabels: Record<string, string> = {
      admin: 'Admin', manager: 'Manager', director: 'Director',
      inspector: 'Inspector', tyre_man: 'Tyre Man',
    }
    Alert.alert(
      'Change Role',
      `Current role: ${user.role ?? 'none'}`,
      [
        ...roles.map(r => ({
          text: dbLabels[r],
          onPress: async () => {
            setActing(user.id)
            const { error } = await supabase
              .from('profiles')
              .update({ role: dbLabels[r] })
              .eq('id', user.id)
            setActing(null)
            if (error) Alert.alert('Error', 'Failed to update role.')
            else setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: dbLabels[r] } : u))
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    )
  }

  async function changeCountry(user: UserProfile) {
    // A user's country controls what data they see and stamps their
    // mobile-created records - keeping countries isolated.
    Alert.alert(
      'Set Country',
      `Current: ${user.country ?? 'none'}`,
      [
        ...COUNTRIES.map(c => ({
          text: c,
          onPress: async () => {
            setActing(user.id)
            const { error } = await supabase
              .from('profiles')
              .update({ country: c })
              .eq('id', user.id)
            setActing(null)
            if (error) Alert.alert('Error', 'Failed to update country.')
            else setUsers(prev => prev.map(u => u.id === user.id ? { ...u, country: c } : u))
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    )
  }

  async function toggleLock(user: UserProfile) {
    const willLock = !user.locked
    Alert.alert(
      willLock ? 'Revoke Access' : 'Restore Access',
      willLock
        ? `Disable access for ${user.full_name ?? user.username ?? 'this user'}? They won't be able to use the app until restored.`
        : `Restore access for ${user.full_name ?? user.username ?? 'this user'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: willLock ? 'Revoke' : 'Restore',
          style: willLock ? 'destructive' : 'default',
          onPress: async () => {
            setActing(user.id)
            const { error } = await supabase
              .from('profiles')
              .update({ locked: willLock })
              .eq('id', user.id)
            setActing(null)
            if (error) Alert.alert('Error', 'Failed to update access.')
            else setUsers(prev => prev.map(u => u.id === user.id ? { ...u, locked: willLock } : u))
          },
        },
      ]
    )
  }

  // Filters + search
  const q = search.trim().toLowerCase()
  const base = users.filter(u => {
    if (filter === 'pending')  return !u.approved
    if (filter === 'approved') return u.approved
    return true
  })
  const filtered = q
    ? base.filter(u =>
        (u.full_name ?? '').toLowerCase().includes(q) ||
        (u.username ?? '').toLowerCase().includes(q) ||
        (u.employee_id ?? '').toLowerCase().includes(q) ||
        (u.site ?? '').toLowerCase().includes(q)
      )
    : base

  const pendingCount = users.filter(u => !u.approved).length

  if (guardLoading || !allowed || loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#4c1d95" />
        <View style={styles.loader}><ActivityIndicator size="large" color="#7c3aed" /></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#4c1d95" />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>User Management</Text>
          <Text style={styles.headerSub}>{users.length} users total · {pendingCount} pending</Text>
        </View>
      </View>

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#94a3b8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search name, username, employee ID, site..."
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
      </View>

      {/* ── Filter tabs ─────────────────────────────────────────────────────── */}
      <View style={styles.filterRow}>
        {([
          { key: 'pending',  label: `Pending (${pendingCount})` },
          { key: 'approved', label: 'Approved' },
          { key: 'all',      label: 'All' },
        ] as { key: FilterKey; label: string }[]).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.filterTab, filter === tab.key && styles.filterTabActive]}
            onPress={() => setFilter(tab.key)}
          >
            <Text style={[styles.filterTabText, filter === tab.key && styles.filterTabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />}
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={52} color="#a78bfa" />
            <Text style={styles.emptyTitle}>No users found</Text>
            <Text style={styles.emptyHint}>
              {filter === 'pending' ? 'No pending approvals - you\'re all caught up' : 'Try adjusting your search'}
            </Text>
          </View>
        ) : (
          filtered.map(user => {
            const norm = normaliseRole(user.role)
            const rc   = ROLE_COLORS[norm] ?? ROLE_COLORS.reporter
            const isActing = acting === user.id
            return (
              <View key={user.id} style={styles.userCard}>
                {/* Pending indicator strip */}
                {!user.approved && <View style={styles.pendingStrip} />}

                <View style={styles.cardBody}>
                  {/* Top row */}
                  <View style={styles.cardTop}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {(user.full_name ?? user.username ?? '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{user.full_name ?? user.username ?? '-'}</Text>
                      {user.username && user.full_name && (
                        <Text style={styles.username}>@{user.username}</Text>
                      )}
                    </View>
                    {!user.approved && (
                      <View style={styles.pendingBadge}>
                        <Text style={styles.pendingBadgeText}>Pending</Text>
                      </View>
                    )}
                    {user.approved && user.locked && (
                      <View style={styles.revokedBadge}>
                        <Ionicons name="lock-closed" size={10} color="#dc2626" />
                        <Text style={styles.revokedBadgeText}>Revoked</Text>
                      </View>
                    )}
                  </View>

                  {/* Meta row */}
                  <View style={styles.metaRow}>
                    <TouchableOpacity style={[styles.roleChip, { backgroundColor: rc.bg }]} onPress={() => changeRole(user)}>
                      <Text style={[styles.roleChipText, { color: rc.text }]}>{user.role ?? 'No role'}</Text>
                      <Ionicons name="chevron-down" size={10} color={rc.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.roleChip, { backgroundColor: user.country ? '#ecfeff' : '#fef2f2' }]}
                      onPress={() => changeCountry(user)}
                    >
                      <Ionicons name="earth-outline" size={11} color={user.country ? '#0891b2' : '#dc2626'} />
                      <Text style={[styles.roleChipText, { color: user.country ? '#0891b2' : '#dc2626' }]}>
                        {user.country ?? 'Set country'}
                      </Text>
                      <Ionicons name="chevron-down" size={10} color={user.country ? '#0891b2' : '#dc2626'} />
                    </TouchableOpacity>
                    {user.site && (
                      <View style={styles.metaChip}>
                        <Ionicons name="business-outline" size={11} color="#64748b" />
                        <Text style={styles.metaChipText}>{user.site}</Text>
                      </View>
                    )}
                    {user.employee_id && (
                      <View style={styles.metaChip}>
                        <Ionicons name="card-outline" size={11} color="#64748b" />
                        <Text style={styles.metaChipText}>{user.employee_id}</Text>
                      </View>
                    )}
                  </View>

                  {/* Pending reason */}
                  {user.pending_reason && !user.approved && (
                    <Text style={styles.pendingReason}>"{user.pending_reason}"</Text>
                  )}

                  {/* Joined date */}
                  <Text style={styles.joinedText}>
                    Registered {new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>

                  {/* Action buttons for pending users */}
                  {!user.approved && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.rejectBtn}
                        onPress={() => reject(user)}
                        disabled={isActing}
                      >
                        {isActing
                          ? <ActivityIndicator size="small" color="#dc2626" />
                          : <><Ionicons name="close-outline" size={16} color="#dc2626" /><Text style={styles.rejectBtnText}>Reject</Text></>
                        }
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.approveBtn}
                        onPress={() => approve(user)}
                        disabled={isActing}
                      >
                        {isActing
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <><Ionicons name="checkmark-outline" size={16} color="#fff" /><Text style={styles.approveBtnText}>Approve</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Access control for approved users (not self) */}
                  {user.approved && user.id !== profile?.id && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={user.locked ? styles.approveBtn : styles.rejectBtn}
                        onPress={() => toggleLock(user)}
                        disabled={isActing}
                      >
                        {isActing
                          ? <ActivityIndicator size="small" color={user.locked ? '#fff' : '#dc2626'} />
                          : user.locked
                            ? <><Ionicons name="lock-open-outline" size={16} color="#fff" /><Text style={styles.approveBtnText}>Restore Access</Text></>
                            : <><Ionicons name="lock-closed-outline" size={16} color="#dc2626" /><Text style={styles.rejectBtnText}>Revoke Access</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            )
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#f8f5ff' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content:{ padding: 16, gap: 10, paddingBottom: 40 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#4c1d95',
    paddingHorizontal: 16, paddingVertical: 12, gap: 10,
  },
  backBtn:    { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  headerTitle:{ fontSize: 17, fontWeight: '800', color: '#fff' },
  headerSub:  { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  searchInput: { flex: 1, fontSize: 13, color: '#0f172a', padding: 0 },

  filterRow: { flexDirection: 'row', gap: 0, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  filterTab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  filterTabActive: { borderBottomWidth: 2, borderBottomColor: '#7c3aed' },
  filterTabText: { fontSize: 12, fontWeight: '600', color: '#94a3b8' },
  filterTabTextActive: { color: '#7c3aed', fontWeight: '800' },

  userCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  pendingStrip: { width: 4, backgroundColor: '#f59e0b' },
  cardBody:     { flex: 1, padding: 14, gap: 10 },
  cardTop:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center',
  },
  avatarText:   { fontSize: 16, fontWeight: '800', color: '#7c3aed' },
  name:         { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  username:     { fontSize: 11, color: '#94a3b8' },
  pendingBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  pendingBadgeText: { fontSize: 10, fontWeight: '700', color: '#d97706' },
  revokedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fee2e2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  revokedBadgeText: { fontSize: 10, fontWeight: '700', color: '#dc2626' },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  roleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  roleChipText: { fontSize: 11, fontWeight: '700' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#f8fafc' },
  metaChipText: { fontSize: 11, color: '#64748b' },

  pendingReason: { fontSize: 12, color: '#78716c', fontStyle: 'italic', paddingLeft: 2 },
  joinedText:    { fontSize: 11, color: '#94a3b8' },

  actionRow:      { flexDirection: 'row', gap: 8, marginTop: 2 },
  rejectBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: '#fecaca', backgroundColor: '#fff5f5' },
  rejectBtnText:  { fontSize: 13, fontWeight: '700', color: '#dc2626' },
  approveBtn:     { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, backgroundColor: '#7c3aed' },
  approveBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  empty:      { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptyHint:  { fontSize: 13, color: '#94a3b8', textAlign: 'center', paddingHorizontal: 20 },
})
