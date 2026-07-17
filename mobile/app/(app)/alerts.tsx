import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useRealtime } from '../../hooks/useRealtime'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { Theme, StatusKind, spacing, radius, elevation } from '../../lib/theme'
import {
  Screen, Card, AppText, Badge, StatTile, Loading, EmptyState, ErrorState,
} from '../../components/ui'

type FilterKey = 'all' | 'Critical' | 'High'

interface AlertRow {
  id: string
  asset_no: string | null
  site: string | null
  brand: string | null
  position: string | null
  risk_level: string | null
  serial_no: string | null
  tread_depth: number | null
  issue_date: string | null
}

/** Risk band -> design-system status kind (sun-legible, theme-aware). */
const RISK_KIND: Record<string, StatusKind> = { Critical: 'critical', High: 'danger' }
function riskKind(level?: string | null): StatusKind {
  return RISK_KIND[level ?? ''] ?? 'neutral'
}

export default function AlertsScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const s = useMemo(() => makeStyles(theme), [theme])
  const [rows, setRows] = useState<AlertRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [error, setError] = useState<string | null>(null)
  const [ackingId, setAckingId] = useState<string | null>(null)

  const { allowed } = useRoleGuard(['inspector', 'tyre_man', 'admin', 'manager', 'director'])
  const textAlign = isRTL ? 'right' : 'left'

  const load = useCallback(async () => {
    try {
      setError(null)
      let q = supabase
        .from('tyre_records')
        .select('id,asset_no,site,brand,position,risk_level,serial_no,tread_depth,issue_date')
        .in('risk_level', ['Critical', 'High'])
        .order('issue_date', { ascending: false })
        .limit(300)
      if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)

      // Pull already-acknowledged risk alerts so resolved items disappear.
      // Each ack stores the tyre_records id in `message` as `rec:<id>`.
      const ackQ = supabase
        .from('alerts')
        .select('message')
        .eq('alert_type', 'tyre_risk')
        .eq('resolved', true)

      const [{ data, error: rErr }, { data: acks }] = await Promise.all([q, ackQ])
      if (rErr) throw rErr

      const acked = new Set(
        (acks ?? [])
          .map((a: any) => (typeof a.message === 'string' && a.message.startsWith('rec:') ? a.message.slice(4) : null))
          .filter(Boolean),
      )
      setRows(((data as AlertRow[]) ?? []).filter(r => !acked.has(r.id)))
    } catch (e: any) {
      if (__DEV__) console.warn('[alerts] load failed:', e?.message)
      setError(t('modules.alerts.loadError'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [profile?.country])

  useEffect(() => { load() }, [load])
  useRealtime('tyre_records', load)
  useRealtime('alerts', load)

  const acknowledge = useCallback((item: AlertRow) => {
    Alert.alert(
      t('modules.alerts.ackTitle'),
      `${t('modules.alerts.ackMsgA')} ${item.risk_level} ${t('modules.alerts.ackMsgB')} ${item.asset_no ?? t('modules.alerts.thisAsset')} ${t('modules.alerts.ackMsgC')}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('modules.alerts.acknowledge'),
          onPress: async () => {
            setAckingId(item.id)
            // Optimistic removal
            setRows(prev => prev.filter(r => r.id !== item.id))
            const { error: insErr } = await supabase.from('alerts').insert({
              asset_no: item.asset_no,
              alert_type: 'tyre_risk',
              severity: item.risk_level,
              message: `rec:${item.id}`,
              site: item.site,
              country: profile?.country ?? null,
              resolved: true,
              is_active: false,
              created_by: profile?.id ?? null,
            })
            setAckingId(null)
            if (insErr) {
              // Roll back optimistic removal and surface the failure
              if (__DEV__) console.warn('[alerts] acknowledge failed:', insErr.message)
              Alert.alert(t('modules.alerts.ackFailTitle'), t('modules.alerts.ackFailMsg'))
              load()
            }
          },
        },
      ],
    )
  }, [profile?.country, profile?.id, load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter(r => r.risk_level === filter)),
    [rows, filter],
  )
  const critCount = useMemo(() => rows.filter(r => r.risk_level === 'Critical').length, [rows])
  const highCount = useMemo(() => rows.filter(r => r.risk_level === 'High').length, [rows])

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'all', label: t('modules.alerts.all') },
    { key: 'Critical', label: t('modules.alerts.critical') },
    { key: 'High', label: t('modules.alerts.high') },
  ]

  if (!allowed) return null

  return (
    <Screen edges={['top']}>
      <View style={[s.header, isRTL && s.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.alerts.title')}</AppText>
          <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }}>
            {critCount} {t('modules.alerts.criticalN')} · {rows.length} {t('modules.alerts.flagged')}
          </AppText>
        </View>
      </View>

      {!loading && !error && (
        <View style={s.statRow}>
          <StatTile
            label={t('modules.alerts.critical')} value={critCount}
            icon="alert-circle" tint="red"
            onPress={() => setFilter('Critical')}
          />
          <StatTile
            label={t('modules.alerts.high')} value={highCount}
            icon="warning" tint="amber"
            onPress={() => setFilter('High')}
          />
          <StatTile
            label={t('modules.alerts.flagged')} value={rows.length}
            icon="shield-half" tint="slate"
            onPress={() => setFilter('all')}
          />
        </View>
      )}

      <View style={[s.filters, isRTL && s.rowR]}>
        {FILTERS.map(({ key, label }) => {
          const active = filter === key
          return (
            <TouchableOpacity
              key={key}
              style={[s.chip, active && s.chipActive]}
              onPress={() => setFilter(key)}
              activeOpacity={0.8}
            >
              <AppText variant="label" style={{ color: active ? theme.color.onPrimary : theme.color.textSecondary }}>
                {label}
              </AppText>
            </TouchableOpacity>
          )
        })}
      </View>

      {loading ? (
        <Loading label={t('modules.alerts.loadingLabel')} />
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
                icon="shield-checkmark-outline"
                title={t('modules.alerts.none')}
                message={filter !== 'all' ? t('modules.alerts.noneFilter') : undefined}
              />
            )
          }
          renderItem={({ item }) => {
            const kind = riskKind(item.risk_level)
            const meta = [item.site, item.brand, item.position].filter(Boolean).join(' · ') || '-'
            const spec = [
              item.serial_no ? `SN ${item.serial_no}` : null,
              item.tread_depth != null ? `${item.tread_depth}mm` : null,
            ].filter(Boolean).join('  ·  ')
            return (
              <Card
                padded={false}
                accent={theme.color[kind].base}
                onPress={() => item.asset_no && router.push({ pathname: '/(app)/inspection/new', params: { site: item.site ?? '', asset: item.asset_no } })}
                style={s.card}
              >
                <View style={[s.cardRow, isRTL && s.rowR]}>
                  <View style={[s.riskIcon, { backgroundColor: theme.color[kind].soft }]}>
                    <Ionicons name="alert" size={20} color={theme.color[kind].base} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <AppText variant="title" style={{ textAlign }} numberOfLines={1}>
                      {item.asset_no ?? t('modules.alerts.unknownAsset')}
                    </AppText>
                    <AppText variant="caption" color="muted" style={{ textAlign }} numberOfLines={1}>{meta}</AppText>
                    {spec ? (
                      <AppText variant="micro" color="muted" style={{ textAlign }} numberOfLines={1}>{spec}</AppText>
                    ) : null}
                  </View>
                  <View style={s.cardRight}>
                    <Badge kind={kind}>{item.risk_level ?? '-'}</Badge>
                    <TouchableOpacity
                      style={[s.ackBtn, { borderColor: theme.color.primary, backgroundColor: theme.color.primarySoft }]}
                      onPress={() => acknowledge(item)}
                      disabled={ackingId === item.id}
                      activeOpacity={0.8}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      {ackingId === item.id ? (
                        <ActivityIndicator size="small" color={theme.color.primary} />
                      ) : (
                        <>
                          <Ionicons name="checkmark-done" size={14} color={theme.color.primaryDark} />
                          <AppText variant="micro" style={{ color: theme.color.primaryDark }}>{t('modules.alerts.ack')}</AppText>
                        </>
                      )}
                    </TouchableOpacity>
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
    statRow: {
      flexDirection: 'row', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    },
    filters: {
      flexDirection: 'row', gap: spacing.sm,
      paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    },
    chip: {
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
      borderRadius: radius.pill, backgroundColor: c.surface,
      borderWidth: 1.5, borderColor: c.border,
    },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md, paddingTop: spacing.xs, flexGrow: 1 },
    card: { overflow: 'hidden' },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
    riskIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    cardRight: { alignItems: 'flex-end', gap: spacing.sm },
    ackBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: spacing.md, paddingVertical: 6,
      borderRadius: radius.sm, borderWidth: 1,
      minWidth: 56, justifyContent: 'center',
    },
  })
}
