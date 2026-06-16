import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, StatusBar, ActivityIndicator, TextInput, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { useRealtime } from '../../hooks/useRealtime'
import { canManageUsers } from '../../lib/permissions'
import { UserRole } from '../../lib/types'

const VIEW_ROLES: UserRole[] = ['admin', 'manager', 'director']

interface Member {
  id: string
  full_name: string | null
  username: string | null
  role: string | null
  site: string | null
  country: string | null
  phone: string | null
  email: string | null
  approved: boolean | null
  last_login_at: string | null
}

const ROLE_COLOR: Record<string, string> = {
  admin: '#7c3aed', director: '#1d4ed8', manager: '#2563eb',
  inspector: '#16a34a', tyre_man: '#0891b2', driver: '#ca8a04', viewer: '#64748b',
}
const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', manager: 'Manager', director: 'Director',
  inspector: 'Inspector', tyre_man: 'Tyre Tech', driver: 'Driver', viewer: 'Viewer',
}

function norm(role: string | null): string {
  return (role ?? '').toLowerCase().replace(/\s+/g, '_')
}

export default function TeamScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const router = useRouter()
  const { allowed } = useRoleGuard(VIEW_ROLES)
  const [rows, setRows] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')

  const textAlign = isRTL ? 'right' : 'left'
  const mayManage = canManageUsers(profile?.role)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id,full_name,username,role,site,country,phone,email,approved,last_login_at')
      .order('full_name')
      .limit(1000)
    setRows((data as Member[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, load])
  useRealtime('profiles', load, { enabled: allowed })

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const shown = useMemo(() => {
    const s = query.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(m =>
      m.full_name?.toLowerCase().includes(s) ||
      m.username?.toLowerCase().includes(s) ||
      norm(m.role).includes(s) ||
      m.site?.toLowerCase().includes(s),
    )
  }, [rows, query])

  const pending = useMemo(() => rows.filter(m => m.approved === false).length, [rows])

  if (!allowed) return null

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { textAlign }]}>Team</Text>
          <Text style={[styles.sub, { textAlign }]}>
            {rows.length} member{rows.length === 1 ? '' : 's'}{pending > 0 ? ` · ${pending} pending` : ''}
          </Text>
        </View>
        {mayManage && (
          <TouchableOpacity style={styles.manageBtn} onPress={() => router.push('/(app)/admin/users')}>
            <Ionicons name="settings-outline" size={16} color="#7c3aed" />
            <Text style={styles.manageText}>Manage</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color="#94a3b8" />
        <TextInput
          style={[styles.search, { textAlign }]}
          placeholder="Search name, role, site…"
          placeholderTextColor="#94a3b8"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {loading ? (
        <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>No members</Text>
            </View>
          }
          renderItem={({ item }) => {
            const rk = norm(item.role)
            const rc = ROLE_COLOR[rk] ?? '#64748b'
            const initials = (item.full_name ?? item.username ?? '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
            return (
              <View style={styles.card}>
                <View style={[styles.avatar, { backgroundColor: rc + '1a' }]}>
                  <Text style={[styles.avatarText, { color: rc }]}>{initials}</Text>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.cardTitle, { textAlign }]}>{item.full_name ?? item.username ?? 'Unknown'}</Text>
                  <View style={[styles.badges, isRTL && styles.rowR]}>
                    <View style={[styles.roleBadge, { backgroundColor: rc + '1a' }]}>
                      <Text style={[styles.roleText, { color: rc }]}>{ROLE_LABEL[rk] ?? item.role ?? '—'}</Text>
                    </View>
                    {item.site && <Text style={styles.cardMeta}>{item.site}</Text>}
                    {item.approved === false && (
                      <View style={styles.pendingBadge}><Text style={styles.pendingText}>Pending</Text></View>
                    )}
                  </View>
                </View>
                <View style={[styles.actions, isRTL && styles.rowR]}>
                  {item.phone ? (
                    <TouchableOpacity style={styles.actBtn} onPress={() => Linking.openURL(`tel:${item.phone}`)}>
                      <Ionicons name="call" size={18} color="#16a34a" />
                    </TouchableOpacity>
                  ) : null}
                  {item.email ? (
                    <TouchableOpacity style={styles.actBtn} onPress={() => Linking.openURL(`mailto:${item.email}`)}>
                      <Ionicons name="mail" size={18} color="#2563eb" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  rowR: { flexDirection: 'row-reverse' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  sub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  manageBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(124,58,237,0.1)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  manageText: { fontSize: 12, fontWeight: '700', color: '#7c3aed' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  search: { flex: 1, paddingVertical: 11, fontSize: 14, color: '#0f172a' },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  roleBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  roleText: { fontSize: 10, fontWeight: '800' },
  cardMeta: { fontSize: 11.5, color: '#94a3b8' },
  pendingBadge: { backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  pendingText: { fontSize: 10, fontWeight: '800', color: '#b45309' },
  actions: { flexDirection: 'row', gap: 6 },
  actBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#94a3b8' },
})
