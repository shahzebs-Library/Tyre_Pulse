import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { canInspect } from '../../lib/permissions'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import {
  Theme, StatusKind, spacing, radius, elevation,
} from '../../lib/theme'
import {
  Screen, Card, AppText, Badge, Button, Loading, EmptyState,
} from '../../components/ui'

interface Vehicle {
  id: string
  asset_no: string | null
  fleet_number: string | null
  make: string | null
  model: string | null
  vehicle_type: string | null
  site: string | null
  status: string | null
  operator_name: string | null
  tyre_size: string | null
  current_km: number | null
  country: string | null
  department: string | null
  region: string | null
  registration_no: string | null
  year: number | null
}

const fmtNum = (n: number | null | undefined) =>
  n == null ? '-' : Number(n).toLocaleString('en-US')

/** Fleet status -> design-system status kind. */
const STATUS_KIND: Record<string, StatusKind> = {
  active: 'success', operational: 'success',
  maintenance: 'warning', repair: 'danger',
  inactive: 'neutral', retired: 'neutral', sold: 'neutral',
}
function statusKind(status?: string | null): StatusKind {
  return STATUS_KIND[(status ?? '').toLowerCase()] ?? 'neutral'
}

export default function VehiclesScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const s = useMemo(() => makeStyles(theme), [theme])
  const [rows, setRows] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { allowed } = useRoleGuard(['inspector', 'tyre_man', 'admin', 'manager', 'director'])
  const textAlign = isRTL ? 'right' : 'left'
  const mayInspect = canInspect(profile?.role)

  const load = useCallback(async () => {
    let q = supabase
      .from('vehicle_fleet')
      .select('id,asset_no,fleet_number,make,model,vehicle_type,site,status,operator_name,tyre_size,current_km,country,department,region,registration_no,year')
      .order('asset_no')
      .limit(2000)
    if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
    const { data } = await q
    setRows((data as Vehicle[]) ?? [])
    setLoading(false)
  }, [profile?.country])

  useEffect(() => { load() }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(v =>
      v.asset_no?.toLowerCase().includes(term) ||
      v.fleet_number?.toLowerCase().includes(term) ||
      v.make?.toLowerCase().includes(term) ||
      v.model?.toLowerCase().includes(term) ||
      v.vehicle_type?.toLowerCase().includes(term) ||
      v.operator_name?.toLowerCase().includes(term) ||
      v.registration_no?.toLowerCase().includes(term) ||
      v.site?.toLowerCase().includes(term),
    )
  }, [rows, query])

  if (!allowed) return null

  return (
    <Screen edges={['top']}>
      <View style={[s.header, isRTL && s.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.vehicles.title')}</AppText>
          <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }}>
            {rows.length} {t('modules.vehicles.inFleet')}
          </AppText>
        </View>
      </View>

      <View style={[s.searchWrap, isRTL && s.rowR]}>
        <Ionicons name="search-outline" size={18} color={theme.color.textMuted} />
        <TextInput
          style={[s.search, { color: theme.color.text, textAlign }]}
          placeholder={t('modules.vehicles.searchPh')}
          placeholderTextColor={theme.color.textMuted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={theme.color.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <Loading label="Loading fleet" />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={i => i.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="bus-outline"
              title={t('modules.vehicles.none')}
              message={query ? 'Try a different search term.' : undefined}
            />
          }
          renderItem={({ item }) => {
            const open = expandedId === item.id
            const details: Array<[string, string]> = [
              ['Fleet No', item.fleet_number ?? '-'],
              ['Type', item.vehicle_type ?? '-'],
              ['Make / Model', [item.make, item.model].filter(Boolean).join(' ') || '-'],
              ['Year', item.year != null ? String(item.year) : '-'],
              ['Current KM', item.current_km != null ? `${fmtNum(item.current_km)} km` : '-'],
              ['Operator', item.operator_name ?? '-'],
              ['Department', item.department ?? '-'],
              ['Site', item.site ?? '-'],
              ['Region', item.region ?? '-'],
              ['Country', item.country ?? '-'],
              ['Tyre Size', item.tyre_size ?? '-'],
              ['Registration', item.registration_no ?? '-'],
            ]
            return (
              <Card padded={false} style={s.card}>
                <TouchableOpacity
                  style={[s.cardHead, isRTL && s.rowR]}
                  activeOpacity={0.85}
                  onPress={() => setExpandedId(open ? null : item.id)}
                >
                  <View style={[s.vIcon, { backgroundColor: theme.color.primarySoft }]}>
                    <Ionicons name="bus" size={20} color={theme.color.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <AppText variant="title" style={{ textAlign }} numberOfLines={1}>
                      {item.asset_no ?? item.fleet_number ?? 'Unknown'}
                    </AppText>
                    <AppText variant="caption" color="muted" style={{ textAlign }} numberOfLines={1}>
                      {[item.make, item.model, item.vehicle_type].filter(Boolean).join(' · ') || '-'}
                    </AppText>
                    <AppText variant="micro" color="muted" style={{ textAlign }} numberOfLines={1}>
                      {[item.site, item.current_km != null ? `${fmtNum(item.current_km)} km` : null, item.tyre_size].filter(Boolean).join(' · ') || '-'}
                    </AppText>
                  </View>
                  <View style={s.headRight}>
                    {item.status ? (
                      <Badge kind={statusKind(item.status)}>{item.status}</Badge>
                    ) : null}
                    <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.color.textMuted} />
                  </View>
                </TouchableOpacity>

                {open && (
                  <View style={[s.detail, { borderTopColor: theme.color.border, backgroundColor: theme.color.surfaceAlt }]}>
                    <View style={s.detailGrid}>
                      {details.map(([k, v]) => (
                        <View key={k} style={s.detailItem}>
                          <AppText variant="micro" color="muted" style={[s.detailLabel, { textAlign }]}>{k.toUpperCase()}</AppText>
                          <AppText variant="body" style={{ textAlign }} numberOfLines={2}>{v}</AppText>
                        </View>
                      ))}
                    </View>
                    {mayInspect && (
                      <Button
                        label="Start Inspection"
                        icon="clipboard-outline"
                        full
                        onPress={() => router.push({ pathname: '/(app)/inspection/new', params: { site: item.site ?? '', asset: item.asset_no ?? '' } })}
                        style={{ marginTop: spacing.sm }}
                      />
                    )}
                  </View>
                )}
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
    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginHorizontal: spacing.lg, marginBottom: spacing.sm,
      backgroundColor: c.surface, borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      borderWidth: 1.5, borderColor: c.border,
    },
    search: { flex: 1, paddingVertical: 12, fontSize: 15, fontWeight: '500' },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md, paddingTop: spacing.xs },

    card: { overflow: 'hidden' },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
    vIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    headRight: { alignItems: 'flex-end', gap: spacing.sm },

    detail: { borderTopWidth: 1, padding: spacing.lg, gap: spacing.md },
    detailGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    detailItem: { width: '50%', paddingVertical: spacing.sm, paddingRight: spacing.sm, gap: 2 },
    detailLabel: { letterSpacing: 0.4, marginBottom: 2 },
  })
}
