import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, TextInput, Linking,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { useRealtime } from '../../hooks/useRealtime'
import { canManageUsers } from '../../lib/permissions'
import { UserRole } from '../../lib/types'
import { Theme, spacing, radius, elevation } from '../../lib/theme'
import {
  Screen, Card, AppText, Badge, StatTile, Loading, EmptyState, ErrorState,
} from '../../components/ui'

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

/** Role -> accent tint (fg/bg) for avatars + role pills. Theme-aware. */
const ROLE_TINT: Record<string, keyof Theme['tint']> = {
  admin: 'violet', director: 'blue', manager: 'blue',
  inspector: 'green', tyre_man: 'teal', driver: 'amber', viewer: 'slate',
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
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const s = useMemo(() => makeStyles(theme), [theme])
  const { allowed } = useRoleGuard(VIEW_ROLES)
  const [rows, setRows] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const textAlign = isRTL ? 'right' : 'left'
  const mayManage = canManageUsers(profile?.role)

  const load = useCallback(async () => {
    try {
      const { data, error: qErr } = await supabase
        .from('profiles')
        .select('id,full_name,username,role,site,country,phone,email,approved,last_login_at')
        .order('full_name')
        .limit(1000)
      if (qErr) throw qErr
      setRows((data as Member[]) ?? [])
      setError(null)
    } catch (e: any) {
      if (__DEV__) console.warn('[team] load failed', e)
      setError(e?.message ?? 'Failed to load team members.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, load])
  useRealtime('profiles', load, { enabled: allowed })

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(m =>
      m.full_name?.toLowerCase().includes(term) ||
      m.username?.toLowerCase().includes(term) ||
      norm(m.role).includes(term) ||
      m.site?.toLowerCase().includes(term),
    )
  }, [rows, query])

  const pending = useMemo(() => rows.filter(m => m.approved === false).length, [rows])
  const active = useMemo(() => rows.filter(m => m.approved !== false).length, [rows])

  if (!allowed) return null

  return (
    <Screen edges={['top']}>
      <View style={[s.header, isRTL && s.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.team.title')}</AppText>
          <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }}>
            {rows.length} {t('modules.team.members')}{pending > 0 ? ` · ${pending} ${t('modules.team.pending')}` : ''}
          </AppText>
        </View>
        {mayManage && (
          <TouchableOpacity
            style={[s.manageBtn, { backgroundColor: theme.tint.violet.bg }]}
            onPress={() => router.push('/(app)/admin/users')}
            activeOpacity={0.8}
          >
            <Ionicons name="settings-outline" size={16} color={theme.tint.violet.fg} />
            <AppText variant="label" style={{ color: theme.tint.violet.fg }}>{t('modules.team.manage')}</AppText>
          </TouchableOpacity>
        )}
      </View>

      {!loading && (
        <View style={s.statRow}>
          <StatTile label={t('modules.team.members')} value={rows.length} icon="people" tint="blue" />
          <StatTile label="Active" value={active} icon="checkmark-circle" tint="green" />
          <StatTile label={t('modules.team.pending')} value={pending} icon="hourglass-outline" tint="amber" />
        </View>
      )}

      <View style={[s.searchWrap, isRTL && s.rowR]}>
        <Ionicons name="search-outline" size={18} color={theme.color.textMuted} />
        <TextInput
          style={[s.search, { color: theme.color.text, textAlign }]}
          placeholder={t('modules.team.searchPh')}
          placeholderTextColor={theme.color.textMuted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={theme.color.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <Loading label="Loading team" />
      ) : error && rows.length === 0 ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={i => i.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={t('modules.team.none')}
              message={query ? 'Try a different search term.' : undefined}
            />
          }
          renderItem={({ item }) => {
            const rk = norm(item.role)
            const tint = theme.tint[ROLE_TINT[rk] ?? 'slate']
            const initials = (item.full_name ?? item.username ?? '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
            const roleLabel = ROLE_LABEL[rk] ? t(`modules.teamRoles.${rk}`) : item.role ?? '-'
            return (
              <Card padded={false} style={s.card}>
                <View style={[s.cardRow, isRTL && s.rowR]}>
                  <View style={[s.avatar, { backgroundColor: tint.bg }]}>
                    <AppText variant="h3" style={{ color: tint.fg }}>{initials}</AppText>
                  </View>
                  <View style={{ flex: 1, gap: 5 }}>
                    <AppText variant="title" style={{ textAlign }} numberOfLines={1}>
                      {item.full_name ?? item.username ?? 'Unknown'}
                    </AppText>
                    <View style={[s.badges, isRTL && s.rowR]}>
                      <View style={[s.rolePill, { backgroundColor: tint.bg }]}>
                        <AppText variant="micro" style={{ color: tint.fg }}>{roleLabel}</AppText>
                      </View>
                      {item.site ? <AppText variant="caption" color="muted">{item.site}</AppText> : null}
                      {item.approved === false ? <Badge kind="warning">{t('modules.team.pending')}</Badge> : null}
                    </View>
                  </View>
                  <View style={[s.actions, isRTL && s.rowR]}>
                    {item.phone ? (
                      <TouchableOpacity style={[s.actBtn, { backgroundColor: theme.color.success.soft }]} onPress={() => Linking.openURL(`tel:${item.phone}`)} activeOpacity={0.7}>
                        <Ionicons name="call" size={18} color={theme.color.success.base} />
                      </TouchableOpacity>
                    ) : null}
                    {item.email ? (
                      <TouchableOpacity style={[s.actBtn, { backgroundColor: theme.color.info.soft }]} onPress={() => Linking.openURL(`mailto:${item.email}`)} activeOpacity={0.7}>
                        <Ionicons name="mail" size={18} color={theme.color.info.base} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </Card>
            )
          }}
        />
      )}
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    },
    backBtn: {
      width: 40, height: 40, borderRadius: radius.md,
      backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.border, ...elevation(theme, 1),
    },
    manageBtn: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    },
    statRow: {
      flexDirection: 'row', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginHorizontal: spacing.lg, marginBottom: spacing.sm,
      backgroundColor: c.surface, borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      borderWidth: 1.5, borderColor: c.border,
    },
    search: { flex: 1, paddingVertical: 12, fontSize: 15, fontWeight: '500' },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md, paddingTop: spacing.xs, flexGrow: 1 },
    card: { overflow: 'hidden' },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
    avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
    badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    rolePill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
    actions: { flexDirection: 'row', gap: spacing.sm },
    actBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  })
}
