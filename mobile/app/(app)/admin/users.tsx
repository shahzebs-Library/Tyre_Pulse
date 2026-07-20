/**
 * Admin User Management
 *
 * Review and approve pending user registrations. Search, filter by role, and
 * manage all profiles in the caller's organisation.
 *
 * SECURITY (findings #6 / #12): every lifecycle change (approve / lock / unlock /
 * deactivate / change role) goes through the SECURITY DEFINER RPC
 * `admin_mobile_user_action`, NOT direct table writes. The server enforces the
 * organisation boundary, the super-admin requirement for privileged transitions,
 * the last-admin lockout guard, self-action guards, and writes an immutable
 * reason-bearing audit row. There is NO client hard-delete: removal is a soft
 * DEACTIVATION (approved=false + locked=true). True auth-identity deletion is an
 * Admin-web + service-role action, out of scope for mobile.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, RefreshControl, TextInput, Alert, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { toUserMessage } from '../../../lib/safeError'
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
  is_super_admin: boolean | null
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
type ActionKey = 'approve' | 'lock' | 'unlock' | 'deactivate' | 'set_role'

// Map normalised keys to the DB role labels the profiles table stores.
const ROLE_DB_LABELS: Record<string, string> = {
  admin: 'Admin', manager: 'Manager', director: 'Director',
  inspector: 'Inspector', tyre_man: 'Tyre Man',
}

interface ReasonModalState {
  visible: boolean
  title: string
  message: string
  confirmLabel: string
  destructive: boolean
  required: boolean
  onConfirm: (reason: string) => void
}

const EMPTY_REASON_MODAL: ReasonModalState = {
  visible: false, title: '', message: '', confirmLabel: 'Confirm',
  destructive: false, required: false, onConfirm: () => {},
}

export default function UserManagementScreen() {
  const { allowed, loading: guardLoading } = useAdminGuard()   // admin only
  const { profile, isSuperAdmin } = useAuth()
  const router = useRouter()

  const [users, setUsers]         = useState<UserProfile[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState<FilterKey>('pending')
  const [acting, setActing]       = useState<string | null>(null) // userId being actioned
  const [reasonModal, setReasonModal] = useState<ReasonModalState>(EMPTY_REASON_MODAL)
  const [reasonText, setReasonText]   = useState('')

  const load = useCallback(async () => {
    try {
      const { data, error: qErr } = await supabase
        .from('profiles')
        .select('id, full_name, username, employee_id, role, site, country, approved, locked, is_super_admin, created_at, pending_reason')
        .order('approved', { ascending: true }) // pending first
        .order('created_at', { ascending: false })
        .limit(200)
      if (qErr) throw qErr
      setUsers((data ?? []) as UserProfile[])
      setError(null)
    } catch (e: any) {
      if (__DEV__) console.warn('[users] load failed', e)
      setError(toUserMessage(e, 'Failed to load users.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false) }

  function openReasonModal(cfg: Omit<ReasonModalState, 'visible'>) {
    setReasonText('')
    setReasonModal({ ...cfg, visible: true })
  }
  function closeReasonModal() { setReasonModal(EMPTY_REASON_MODAL); setReasonText('') }

  /**
   * Central server-side action dispatcher. All privileged rules (org boundary,
   * super-admin requirement, last-admin guard, self-action guard, audit) live
   * in the RPC. This only relays the result and updates local state.
   */
  async function runAction(
    user: UserProfile,
    action: ActionKey,
    opts: { reason?: string; role?: string } = {},
  ) {
    setActing(user.id)
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_mobile_user_action', {
        p_user_id: user.id,
        p_action: action,
        p_reason: opts.reason ?? null,
        p_role: opts.role ?? null,
      })
      if (rpcErr) {
        // Migration not applied yet -> degrade cleanly instead of crashing.
        const code = String((rpcErr as any).code ?? '')
        const msg  = String((rpcErr as any).message ?? '').toLowerCase()
        if (code === 'PGRST202' || code === '42883' || msg.includes('admin_mobile_user_action')) {
          Alert.alert('Update needed', 'This action requires a server update. Please try again later.')
          return
        }
        throw rpcErr
      }
      if (data && (data as any).success === false) {
        Alert.alert('Not allowed', (data as any).error || 'That action could not be completed.')
        return
      }
      // Reflect the change locally (matches the server-side effect).
      setUsers(prev => prev.map(u => {
        if (u.id !== user.id) return u
        if (action === 'approve')    return { ...u, approved: true }
        if (action === 'lock')       return { ...u, locked: true }
        if (action === 'unlock')     return { ...u, locked: false }
        if (action === 'deactivate') return { ...u, approved: false, locked: true }
        if (action === 'set_role' && opts.role) return { ...u, role: opts.role }
        return u
      }))
    } catch (e: any) {
      if (__DEV__) console.warn('[users] action failed', action, e)
      Alert.alert('Error', toUserMessage(e, 'That action could not be completed.'))
    } finally {
      setActing(null)
    }
  }

  // ── Permission helpers (client-side gating; the server is authoritative) ──
  const meId = profile?.id
  function targetIsPrivileged(user: UserProfile): boolean {
    return user.is_super_admin === true || normaliseRole(user.role) === 'admin'
  }
  function canApprove(user: UserProfile): boolean {
    return isSuperAdmin || !targetIsPrivileged(user)
  }
  function canToggleAccess(user: UserProfile): boolean {
    if (user.id === meId) return false
    return isSuperAdmin || !targetIsPrivileged(user)
  }
  function canChangeRole(user: UserProfile): boolean {
    if (user.id === meId) return false
    return isSuperAdmin || !targetIsPrivileged(user)
  }

  // ── Action initiators ──────────────────────────────────────────────────
  function approve(user: UserProfile) {
    Alert.alert(
      'Approve User',
      `Grant ${user.full_name ?? user.username ?? 'this user'} access to TyrePulse?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => runAction(user, 'approve') },
      ],
    )
  }

  function deactivate(user: UserProfile) {
    // Soft disable (approved=false + locked=true). NOT a hard delete: the auth
    // identity stays and can be fully removed later from the web admin console.
    openReasonModal({
      title: 'Deactivate User',
      message: `Revoke all access for ${user.full_name ?? user.username ?? 'this user'}? Their account is disabled, not deleted. A reason is required.`,
      confirmLabel: 'Deactivate',
      destructive: true,
      required: true,
      onConfirm: (reason) => runAction(user, 'deactivate', { reason }),
    })
  }

  function toggleLock(user: UserProfile) {
    const willLock = !user.locked
    if (!willLock) {
      Alert.alert(
        'Restore Access',
        `Restore access for ${user.full_name ?? user.username ?? 'this user'}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Restore', onPress: () => runAction(user, 'unlock') },
        ],
      )
      return
    }
    openReasonModal({
      title: 'Revoke Access',
      message: `Disable access for ${user.full_name ?? user.username ?? 'this user'}? They will not be able to use the app until restored. A reason is optional.`,
      confirmLabel: 'Revoke',
      destructive: true,
      required: false,
      onConfirm: (reason) => runAction(user, 'lock', { reason: reason || undefined }),
    })
  }

  function changeRole(user: UserProfile) {
    // Non-super admins cannot grant the Admin role (server enforced too).
    const keys = ['manager', 'director', 'inspector', 'tyre_man']
    if (isSuperAdmin) keys.unshift('admin')
    Alert.alert(
      'Change Role',
      `Current role: ${user.role ?? 'none'}. Pick a new role, then enter a reason.`,
      [
        ...keys.map(k => ({
          text: ROLE_DB_LABELS[k],
          onPress: () => {
            const label = ROLE_DB_LABELS[k]
            openReasonModal({
              title: 'Change Role',
              message: `Set ${user.full_name ?? user.username ?? 'this user'} to ${label}? A reason is required.`,
              confirmLabel: 'Change Role',
              destructive: k === 'admin',
              required: true,
              onConfirm: (reason) => runAction(user, 'set_role', { role: label, reason }),
            })
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  function changeCountry(user: UserProfile) {
    // Country scope is a data-visibility attribute (not one of the two findings).
    // It is guarded + auto-audited server-side (V307 privileged guard + V228
    // access_audit trigger); left as a scoped direct update.
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
            if (error) Alert.alert('Error', toUserMessage(error, 'Failed to update country.'))
            else setUsers(prev => prev.map(u => u.id === user.id ? { ...u, country: c } : u))
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  function submitReason() {
    const trimmed = reasonText.trim()
    if (reasonModal.required && !trimmed) {
      Alert.alert('Reason required', 'Please enter a reason for this action.')
      return
    }
    const fn = reasonModal.onConfirm
    closeReasonModal()
    fn(trimmed)
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
        <StatusBar barStyle="light-content" />
        <View style={styles.loader}><ActivityIndicator size="large" color="#7c3aed" /></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>User Management</Text>
          <Text style={styles.headerSub}>{users.length} users total · {pendingCount} pending</Text>
        </View>
      </View>

      {/* Search */}
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

      {/* Filter tabs */}
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

      <FlatList
        style={styles.scroll}
        contentContainerStyle={styles.content}
        data={filtered}
        keyExtractor={u => u.id}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={11}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />}
        ListEmptyComponent={
          error ? (
            <View style={styles.empty}>
              <Ionicons name="alert-circle-outline" size={52} color="#f87171" />
              <Text style={styles.emptyTitle}>Couldn't load users</Text>
              <Text style={styles.emptyHint}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={load}>
                <Ionicons name="refresh" size={16} color="#7c3aed" />
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={52} color="#a78bfa" />
              <Text style={styles.emptyTitle}>No users found</Text>
              <Text style={styles.emptyHint}>
                {filter === 'pending' ? 'No pending approvals - you\'re all caught up' : 'Try adjusting your search'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={<View style={{ height: 32 }} />}
        renderItem={({ item: user }) => {
            const norm = normaliseRole(user.role)
            const rc   = ROLE_COLORS[norm] ?? ROLE_COLORS.reporter
            const isActing = acting === user.id
            const roleEditable = canChangeRole(user)
            const accessEditable = canToggleAccess(user)
            return (
              <View style={styles.userCard}>
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
                    <TouchableOpacity
                      style={[styles.roleChip, { backgroundColor: rc.bg }, !roleEditable && styles.chipDisabled]}
                      onPress={() => changeRole(user)}
                      disabled={!roleEditable || isActing}
                    >
                      <Text style={[styles.roleChipText, { color: rc.text }]}>{user.role ?? 'No role'}</Text>
                      {roleEditable && <Ionicons name="chevron-down" size={10} color={rc.text} />}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.roleChip, { backgroundColor: user.country ? '#ecfeff' : '#fef2f2' }]}
                      onPress={() => changeCountry(user)}
                      disabled={isActing}
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
                        onPress={() => deactivate(user)}
                        disabled={isActing}
                      >
                        {isActing
                          ? <ActivityIndicator size="small" color="#dc2626" />
                          : <><Ionicons name="close-outline" size={16} color="#dc2626" /><Text style={styles.rejectBtnText}>Reject</Text></>
                        }
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.approveBtn, !canApprove(user) && styles.btnDisabled]}
                        onPress={() => approve(user)}
                        disabled={isActing || !canApprove(user)}
                      >
                        {isActing
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <><Ionicons name="checkmark-outline" size={16} color="#fff" /><Text style={styles.approveBtnText}>Approve</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Access control for approved users (not self, permitted only) */}
                  {user.approved && accessEditable && (
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
        }}
      />

      {/* Reason capture modal */}
      <Modal
        visible={reasonModal.visible}
        transparent
        animationType="fade"
        onRequestClose={closeReasonModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{reasonModal.title}</Text>
            <Text style={styles.modalMessage}>{reasonModal.message}</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder={reasonModal.required ? 'Reason (required)' : 'Reason (optional)'}
              placeholderTextColor="#94a3b8"
              value={reasonText}
              onChangeText={setReasonText}
              multiline
              numberOfLines={3}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={closeReasonModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, reasonModal.destructive && styles.modalConfirmDanger]}
                onPress={submitReason}
              >
                <Text style={styles.modalConfirmText}>{reasonModal.confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  chipDisabled: { opacity: 0.75 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#f8fafc' },
  metaChipText: { fontSize: 11, color: '#64748b' },

  pendingReason: { fontSize: 12, color: '#78716c', fontStyle: 'italic', paddingLeft: 2 },
  joinedText:    { fontSize: 11, color: '#94a3b8' },

  actionRow:      { flexDirection: 'row', gap: 8, marginTop: 2 },
  rejectBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: '#fecaca', backgroundColor: '#fff5f5' },
  rejectBtnText:  { fontSize: 13, fontWeight: '700', color: '#dc2626' },
  approveBtn:     { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, backgroundColor: '#7c3aed' },
  approveBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  btnDisabled:    { opacity: 0.4 },

  empty:      { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptyHint:  { fontSize: 13, color: '#94a3b8', textAlign: 'center', paddingHorizontal: 20 },
  retryBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: '#ddd6fe', backgroundColor: '#f5f3ff' },
  retryBtnText: { fontSize: 13, fontWeight: '700', color: '#7c3aed' },

  // Reason modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard:    { width: '100%', maxWidth: 440, backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12 },
  modalTitle:   { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  modalMessage: { fontSize: 13, color: '#475569', lineHeight: 19 },
  reasonInput:  {
    minHeight: 72, borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 10,
    padding: 12, fontSize: 13, color: '#0f172a', textAlignVertical: 'top', backgroundColor: '#f8fafc',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  modalCancel:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0' },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  modalConfirm: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 10, backgroundColor: '#7c3aed' },
  modalConfirmDanger: { backgroundColor: '#dc2626' },
  modalConfirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
})
