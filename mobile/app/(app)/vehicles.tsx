import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, TextInput, ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { assetClassOf, classChips, isTyreAsset } from '../../lib/assetClasses'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { canInspect } from '../../lib/permissions'
import { useModuleGuard } from '../../hooks/useRoleGuard'
import {
  Theme, StatusKind, spacing, radius, elevation,
} from '../../lib/theme'
import {
  Screen, Card, AppText, Badge, Button, Loading, EmptyState, ErrorState,
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

import { withModuleGuard } from '../../components/ModuleGuard'
import { backTo } from '../../lib/goBack'

export default withModuleGuard(VehiclesScreen, 'vehicles')

function VehiclesScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const s = useMemo(() => makeStyles(theme), [theme])
  const [rows, setRows] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  // Class filter: 'TYRES' (default) = only classes that carry tyres (TM/MP/WL/
  // SL/PL/BH...), keeping the list well under the full register; null = all
  // equipment; or one specific class code.
  const [classFilter, setClassFilter] = useState<string | null>('TYRES')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Must match the `vehicles` entry in lib/permissions.ts, or a role that sees
  // the tile on Home taps into a blank screen.
  const { allowed } = useModuleGuard('vehicles')
  const textAlign = isRTL ? 'right' : 'left'
  const mayInspect = canInspect(profile?.role)

  const load = useCallback(async () => {
    try {
      setError(null)
      // Paged: the server caps any single response at 1000 rows, and the KSA
      // fleet alone is past that - a .limit(2000) still lost the tail.
      const data = await fetchAllRows<Vehicle>((from, to) => {
        let q = supabase
          .from('vehicle_fleet')
          .select('id,asset_no,fleet_number,make,model,vehicle_type,site,status,operator_name,tyre_size,current_km,country,department,region,registration_no,year')
          .order('asset_no').order('id')
          .range(from, to)
        if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
        return q
      }, { max: 5000 })
      setRows(data ?? [])
    } catch (e: any) {
      if (__DEV__) console.warn('[vehicles] load failed:', e?.message)
      setError(t('modules.vehicles.loadError'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [profile?.country])

  useEffect(() => { load() }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const chips = useMemo(() => classChips(rows), [rows])
  const classed = useMemo(() => {
    if (classFilter === 'TYRES') return rows.filter(v => isTyreAsset(v.asset_no))
    if (classFilter) return rows.filter(v => assetClassOf(v.asset_no) === classFilter)
    return rows
  }, [rows, classFilter])

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return classed
    // A typed search always covers the WHOLE fleet - the class chips only
    // shape browsing, they must never make an asset unfindable.
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
  }, [rows, classed, query])

  if (!allowed) return null

  return (
    <Screen edges={['top']}>
      <View style={[s.header, isRTL && s.rowR]}>
        <TouchableOpacity onPress={() => backTo(router, '/(app)')} style={s.backBtn} activeOpacity={0.7}>
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

      {/* Class chips: default shows only tyre-carrying classes (TM/MP/WL...),
          which keeps the list small; All reveals the full register. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll} contentContainerStyle={s.chipRow}>
        <TouchableOpacity
          style={[s.chip, classFilter === 'TYRES' && s.chipActive]}
          onPress={() => setClassFilter('TYRES')}
        >
          <Ionicons name="ellipse-outline" size={12} color={classFilter === 'TYRES' ? theme.color.onPrimary : theme.color.primary} />
          <AppText variant="caption" style={[s.chipText, classFilter === 'TYRES' && s.chipTextActive]}>
            {t('modules.vehicles.tyreAssets')}
          </AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.chip, classFilter == null && s.chipActive]}
          onPress={() => setClassFilter(null)}
        >
          <AppText variant="caption" style={[s.chipText, classFilter == null && s.chipTextActive]}>
            {t('common.all')}
          </AppText>
        </TouchableOpacity>
        {chips.map(ch => (
          <TouchableOpacity
            key={ch.cls}
            style={[s.chip, classFilter === ch.cls && s.chipActive]}
            onPress={() => setClassFilter(classFilter === ch.cls ? 'TYRES' : ch.cls)}
          >
            <AppText variant="caption" style={[s.chipText, classFilter === ch.cls && s.chipTextActive]}>
              {ch.cls} {ch.count}
            </AppText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <Loading label={t('modules.vehicles.loadingLabel')} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={i => i.id}
          contentContainerStyle={s.list}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={9}
          removeClippedSubviews
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
          ListEmptyComponent={
            error ? (
              <ErrorState message={error} onRetry={onRefresh} />
            ) : (
              <EmptyState
                icon="bus-outline"
                title={t('modules.vehicles.none')}
                message={query ? t('modules.vehicles.tryTerm') : undefined}
              />
            )
          }
          renderItem={({ item }) => {
            const open = expandedId === item.id
            const details: Array<[string, string]> = [
              [t('modules.vehicles.fleetNo'), item.fleet_number ?? '-'],
              [t('modules.vehicles.type'), item.vehicle_type ?? '-'],
              [t('modules.vehicles.makeModel'), [item.make, item.model].filter(Boolean).join(' ') || '-'],
              [t('modules.vehicles.year'), item.year != null ? String(item.year) : '-'],
              [t('modules.vehicles.currentKm'), item.current_km != null ? `${fmtNum(item.current_km)} km` : '-'],
              [t('modules.vehicles.operator'), item.operator_name ?? '-'],
              [t('modules.vehicles.department'), item.department ?? '-'],
              [t('modules.vehicles.site'), item.site ?? '-'],
              [t('modules.vehicles.region'), item.region ?? '-'],
              [t('modules.vehicles.country'), item.country ?? '-'],
              [t('modules.vehicles.tyreSize'), item.tyre_size ?? '-'],
              [t('modules.vehicles.registration'), item.registration_no ?? '-'],
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
                      {item.asset_no ?? item.fleet_number ?? t('modules.vehicles.unknown')}
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
                        label={t('modules.vehicles.startInspection')}
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
    chipScroll: { flexGrow: 0, marginBottom: spacing.sm },
    chipRow: { paddingHorizontal: spacing.lg, gap: spacing.xs + 2 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: spacing.sm + 2, paddingVertical: 6,
      borderRadius: radius.md, borderWidth: 1,
      borderColor: c.border, backgroundColor: c.surface,
    },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { fontWeight: '700' },
    chipTextActive: { color: c.onPrimary },
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
