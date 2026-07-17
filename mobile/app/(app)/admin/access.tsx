/**
 * Super-Admin Access Console
 *
 * Lets the platform super-admin grant or revoke each MOBILE app module for one
 * specific user. This overlays the role default with a per-user override stored
 * in `user_access_grants` under the `mobile:` namespace, so it is SEPARATE from
 * the web app's access and from the checklist Approvals screen.
 *
 * Flow:
 *   1. Pick a user (searchable list).
 *   2. For that user, every module (grouped) shows its EFFECTIVE state plus a
 *      3-way control: Default (no override) / Allow (grant) / Deny (revoke).
 *
 * Access changes reach the affected user's app on their next refresh (AuthContext
 * re-pulls grants on focus and via realtime).
 *
 * Super-admin ONLY. Non-super-admins see a restricted empty state.
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  View, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, RefreshControl,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { normaliseRole } from '../../../lib/types'
import {
  MODULES, MODULE_GROUPS, ModuleKey, GrantMap,
  moduleAllowedByRole, resolveModuleAccess,
} from '../../../lib/permissions'
import {
  listUsers, listUserMobileGrants, setUserMobileGrant, clearUserMobileGrant,
  AdminUserRow, MobileGrantEntryMap,
} from '../../../lib/accessAdmin'
import {
  Screen, AppText, Card, Badge, ListRow, EmptyState, ErrorState, Loading,
} from '../../../components/ui'
import { spacing, radius, typography } from '../../../lib/theme'

type ThreeWay = 'default' | 'grant' | 'revoke'

const APPLY_NOTE = 'Changes apply to this user\'s app on their next refresh.'

export default function AccessConsoleScreen() {
  const { isSuperAdmin } = useAuth()
  const { theme } = useTheme()
  const c = theme.color

  // ── Step 1: users ──────────────────────────────────────────────────────────
  const [users, setUsers]       = useState<AdminUserRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadErr, setLoadErr]   = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch]     = useState('')

  // ── Step 2: selected user + their overrides ────────────────────────────────
  const [selected, setSelected]         = useState<AdminUserRow | null>(null)
  const [grants, setGrants]             = useState<MobileGrantEntryMap>({})
  const [grantsLoading, setGrantsLoading] = useState(false)
  const [grantsErr, setGrantsErr]       = useState<string | null>(null)
  const [savingKey, setSavingKey]       = useState<ModuleKey | null>(null)
  const [banner, setBanner]             = useState<string | null>(null)

  const loadUsers = useCallback(async () => {
    setLoadErr(null)
    try {
      const rows = await listUsers()
      setUsers(rows)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Could not load users.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (isSuperAdmin) loadUsers() }, [isSuperAdmin, loadUsers])

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await loadUsers(); setRefreshing(false)
  }, [loadUsers])

  const loadGrants = useCallback(async (userId: string) => {
    setGrantsErr(null); setGrantsLoading(true)
    try {
      setGrants(await listUserMobileGrants(userId))
    } catch (e) {
      setGrantsErr(e instanceof Error ? e.message : 'Could not load access.')
    } finally {
      setGrantsLoading(false)
    }
  }, [])

  function openUser(u: AdminUserRow) {
    setSelected(u); setGrants({}); setBanner(null); loadGrants(u.id)
  }
  function backToList() {
    setSelected(null); setGrants({}); setBanner(null); setSavingKey(null)
  }

  // Overlay map (effect only) used by resolveModuleAccess.
  const grantMap: GrantMap = useMemo(() => {
    const m: GrantMap = {}
    for (const [k, v] of Object.entries(grants)) if (v) m[k] = v.effect
    return m
  }, [grants])

  async function applyChange(key: ModuleKey, target: ThreeWay) {
    if (!selected) return
    const existing = grants[key]
    const current: ThreeWay = existing ? existing.effect : 'default'
    if (current === target) return

    setBanner(null)
    setSavingKey(key)
    // Optimistic overlay update.
    setGrants(prev => {
      const next = { ...prev }
      if (target === 'default') delete next[key]
      else next[key] = { id: existing?.id ?? '__pending__', effect: target }
      return next
    })

    try {
      if (target === 'default') {
        if (existing) await clearUserMobileGrant(existing.id)
      } else {
        await setUserMobileGrant(selected.id, key, target)
      }
      // Reconcile ids / true state from the server.
      setGrants(await listUserMobileGrants(selected.id))
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Could not update access.')
      // Reload to reflect the actual stored state after a failed write.
      try { setGrants(await listUserMobileGrants(selected.id)) } catch { /* keep banner */ }
    } finally {
      setSavingKey(null)
    }
  }

  // ── Guard: super-admin only ────────────────────────────────────────────────
  if (!isSuperAdmin) {
    return (
      <Screen padded>
        <ScreenHeader title="Access Control" />
        <EmptyState
          icon="lock-closed-outline"
          title="Restricted"
          message="This console is restricted to the super administrator."
        />
      </Screen>
    )
  }

  // ── Step 2: manage a selected user ─────────────────────────────────────────
  if (selected) {
    const role = normaliseRole(selected.role)
    return (
      <Screen>
        <ScreenHeader
          title={selected.full_name ?? selected.username ?? 'User'}
          subtitle={`${prettyRole(role)} access overrides`}
          onBack={backToList}
        />
        <ScrollView contentContainerStyle={styles.content}>
          <AppText variant="caption" color="muted" style={styles.note}>{APPLY_NOTE}</AppText>

          {banner ? (
            <View style={[styles.banner, { backgroundColor: c.danger.soft, borderColor: c.danger.base }]}>
              <Ionicons name="warning-outline" size={16} color={c.danger.base} />
              <AppText variant="caption" style={{ color: c.danger.on, flex: 1 }}>{banner}</AppText>
              <TouchableOpacity onPress={() => setBanner(null)} hitSlop={8}>
                <Ionicons name="close" size={16} color={c.danger.base} />
              </TouchableOpacity>
            </View>
          ) : null}

          {grantsLoading ? (
            <Loading label="Loading access..." />
          ) : grantsErr ? (
            <ErrorState message={grantsErr} onRetry={() => loadGrants(selected.id)} />
          ) : (
            MODULE_GROUPS.map(group => (
              <View key={group} style={styles.group}>
                <AppText
                  style={[typography.label, { color: c.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm }]}
                >
                  {group}
                </AppText>
                <Card padded={false}>
                  {MODULES.filter(m => m.group === group).map((mod, i, arr) => {
                    const override = grants[mod.key]
                    const sel: ThreeWay = override ? override.effect : 'default'
                    const roleDefault = moduleAllowedByRole(mod.key, role)
                    const effective = resolveModuleAccess(mod.key, role, grantMap, false)
                    const saving = savingKey === mod.key
                    return (
                      <View
                        key={mod.key}
                        style={[styles.modRow, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.border }]}
                      >
                        <View style={styles.modTop}>
                          <View style={[styles.modIcon, { backgroundColor: c.surfaceAlt }]}>
                            <Ionicons name={mod.icon as any} size={18} color={c.textSecondary} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <AppText style={typography.title} numberOfLines={1}>{mod.label}</AppText>
                            <AppText variant="micro" color="muted">
                              Default: {roleDefault ? 'Allowed' : 'Hidden'} for {prettyRole(role)}
                            </AppText>
                          </View>
                          {saving ? (
                            <ActivityIndicator size="small" color={c.primary} />
                          ) : (
                            <Badge kind={effective ? 'success' : 'neutral'}>
                              {effective ? 'Visible' : 'Hidden'}
                            </Badge>
                          )}
                        </View>
                        <View style={styles.segRow}>
                          <Segment
                            label="Default" active={sel === 'default'} disabled={saving}
                            activeBg={c.neutral.soft} activeFg={c.neutral.on}
                            onPress={() => applyChange(mod.key, 'default')}
                          />
                          <Segment
                            label="Allow" active={sel === 'grant'} disabled={saving}
                            activeBg={c.success.soft} activeFg={c.success.on}
                            onPress={() => applyChange(mod.key, 'grant')}
                          />
                          <Segment
                            label="Deny" active={sel === 'revoke'} disabled={saving}
                            activeBg={c.danger.soft} activeFg={c.danger.on}
                            onPress={() => applyChange(mod.key, 'revoke')}
                          />
                        </View>
                      </View>
                    )
                  })}
                </Card>
              </View>
            ))
          )}
          <View style={{ height: spacing['3xl'] }} />
        </ScrollView>
      </Screen>
    )
  }

  // ── Step 1: pick a user ────────────────────────────────────────────────────
  const q = search.trim().toLowerCase()
  const filtered = q
    ? users.filter(u =>
        (u.full_name ?? '').toLowerCase().includes(q) ||
        (u.username ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.site ?? '').toLowerCase().includes(q))
    : users

  return (
    <Screen>
      <ScreenHeader title="Access Control" subtitle="Grant or revoke modules per user" />

      <View style={[styles.searchWrap, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Ionicons name="search-outline" size={16} color={c.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: c.text }]}
          placeholder="Search name, username, email, site"
          placeholderTextColor={c.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      {loading ? (
        <Loading label="Loading users..." />
      ) : loadErr ? (
        <ErrorState message={loadErr} onRetry={loadUsers} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
        >
          {filtered.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No users found"
              message={q ? 'Try a different search.' : 'No user profiles are available.'}
            />
          ) : (
            filtered.map(u => {
              const role = normaliseRole(u.role)
              return (
                <ListRow
                  key={u.id}
                  title={u.full_name ?? u.username ?? 'Unnamed user'}
                  subtitle={[u.email ?? u.username, u.site].filter(Boolean).join('  |  ') || undefined}
                  icon="person-circle-outline"
                  tint="violet"
                  onPress={() => openUser(u)}
                  right={<Badge kind="neutral">{prettyRole(role)}</Badge>}
                  style={{ marginBottom: spacing.sm }}
                />
              )
            })
          )}
          <View style={{ height: spacing['3xl'] }} />
        </ScrollView>
      )}
    </Screen>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScreenHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  const { theme } = useTheme()
  const c = theme.color
  return (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          hitSlop={10}
          style={[styles.backBtn, { backgroundColor: c.surfaceAlt }]}
        >
          <Ionicons name="chevron-back" size={20} color={c.text} />
        </TouchableOpacity>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="h2" numberOfLines={1}>{title}</AppText>
        {subtitle ? <AppText variant="caption" color="muted" numberOfLines={1}>{subtitle}</AppText> : null}
      </View>
    </View>
  )
}

function Segment({
  label, active, disabled, activeBg, activeFg, onPress,
}: {
  label: string; active: boolean; disabled?: boolean
  activeBg: string; activeFg: string; onPress: () => void
}) {
  const { theme } = useTheme()
  const c = theme.color
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.segment,
        { borderColor: active ? 'transparent' : c.border, backgroundColor: active ? activeBg : 'transparent' },
        disabled && { opacity: 0.5 },
      ]}
    >
      <AppText style={[typography.caption, { color: active ? activeFg : c.textSecondary }]}>{label}</AppText>
    </TouchableOpacity>
  )
}

function prettyRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, ' ')
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    borderWidth: 1, borderRadius: radius.lg,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },

  content: { padding: spacing.lg, paddingTop: spacing.md },
  note: { marginBottom: spacing.md },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1,
    marginBottom: spacing.lg,
  },

  group: { marginBottom: spacing.xl },

  modRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  modTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  segRow: { flexDirection: 'row', gap: spacing.sm },
  segment: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1,
  },
})
