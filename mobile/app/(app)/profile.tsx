import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ScrollView, StatusBar, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { getPendingCount, syncQueue, retryFailed, clearSynced, getQueue } from '../../lib/offlineQueue'

export default function ProfileScreen() {
  const { profile, signOut } = useAuth()
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [queueTotal, setQueueTotal] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)

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
      Alert.alert(
        'Sync Complete',
        `${synced} inspection${synced !== 1 ? 's' : ''} uploaded.${failed > 0 ? ` ${failed} failed — check connection.` : ''}`,
      )
    } finally {
      setSyncing(false)
    }
  }

  async function handleClearSynced() {
    Alert.alert(
      'Clear Synced Records',
      'Remove already-synced records from the offline queue? This does NOT delete them from the server.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear', style: 'destructive',
          onPress: async () => { await clearSynced(); load() },
        },
      ]
    )
  }

  async function handleLogout() {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out', style: 'destructive',
          onPress: async () => {
            setLoggingOut(true)
            await signOut()
          },
        },
      ]
    )
  }

  const roleLabel: Record<string, string> = {
    admin: 'Administrator',
    manager: 'Manager',
    director: 'Director',
    inspector: 'Inspector',
    tyre_man: 'Tyre Man',
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Profile card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>
              {profile?.full_name?.[0]?.toUpperCase() ?? profile?.username?.[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.name}>{profile?.full_name ?? profile?.username ?? 'Inspector'}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{roleLabel[profile?.role ?? ''] ?? profile?.role}</Text>
            </View>
          </View>
        </View>

        {/* Details */}
        <View style={styles.section}>
          {profile?.employee_id && (
            <View style={styles.detailRow}>
              <Ionicons name="id-card-outline" size={16} color="#64748b" />
              <Text style={styles.detailLabel}>Employee ID</Text>
              <Text style={styles.detailValue}>{profile.employee_id}</Text>
            </View>
          )}
          {profile?.site && (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={16} color="#64748b" />
              <Text style={styles.detailLabel}>Assigned Site</Text>
              <Text style={styles.detailValue}>{profile.site}</Text>
            </View>
          )}
          {profile?.country && (
            <View style={styles.detailRow}>
              <Ionicons name="globe-outline" size={16} color="#64748b" />
              <Text style={styles.detailLabel}>Country</Text>
              <Text style={styles.detailValue}>{profile.country}</Text>
            </View>
          )}
        </View>

        {/* Sync section */}
        <Text style={styles.sectionTitle}>Offline Queue</Text>
        <View style={styles.section}>
          <View style={styles.syncStats}>
            <View style={styles.syncStat}>
              <Text style={[styles.syncStatNum, pending > 0 && { color: '#d97706' }]}>{pending}</Text>
              <Text style={styles.syncStatLabel}>Pending</Text>
            </View>
            <View style={styles.syncStatDivider} />
            <View style={styles.syncStat}>
              <Text style={styles.syncStatNum}>{queueTotal}</Text>
              <Text style={styles.syncStatLabel}>Total Queued</Text>
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
              {syncing ? 'Syncing…' : 'Sync Now'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostBtn} onPress={handleClearSynced}>
            <Ionicons name="trash-outline" size={16} color="#94a3b8" />
            <Text style={styles.ghostBtnText}>Clear synced records</Text>
          </TouchableOpacity>
        </View>

        {/* Sign out */}
        <Text style={styles.sectionTitle}>Account</Text>
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
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.version}>TyrePulse Inspector v1.0.0</Text>
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
  detailLabel: { fontSize: 13, color: '#64748b', flex: 1 },
  detailValue: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
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
