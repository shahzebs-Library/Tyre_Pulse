/**
 * Daily Meter Log — driver-facing odometer + engine-hour capture
 *
 * For fleets without telematics (e.g. Egypt), drivers record the actual meter
 * reading each day and photograph the gauge as proof. The odometer reading
 * advances vehicle_fleet.current_km via a server trigger (V213), so "current
 * km" stays real. The write is offline-safe (record queue), and a live "last
 * reading" panel plus monotonic validation stops fat-finger rollbacks and
 * implausible jumps before they enter the fleet's distance history.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, Platform, KeyboardAvoidingView,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../lib/theme'
import { Screen, Button } from '../../components/ui'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import PhotoCapture from '../../components/PhotoCapture'
import ChecklistReferencePicker from '../../components/ChecklistReferencePicker'
import {
  submitMeterReading, getLastOdometer, todayISODate, LastReading,
} from '../../lib/meterLogs'

// A same-day jump beyond this many km is almost certainly a typo, not a shift.
const IMPLAUSIBLE_DAILY_KM = 2000

export default function MeterLogScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const router = useRouter()
  const params = useLocalSearchParams<{ asset?: string; site?: string }>()

  const { allowed } = useRoleGuard(['inspector', 'tyre_man', 'reporter', 'admin', 'manager', 'director'])

  const [assetNo, setAssetNo] = useState(params.asset ? String(params.asset) : '')
  const [site, setSite] = useState(params.site ? String(params.site) : (profile?.site ?? ''))
  const [odometer, setOdometer] = useState('')
  const [odoPhoto, setOdoPhoto] = useState<string[]>([])
  const [engineHours, setEngineHours] = useState('')
  const [hoursPhoto, setHoursPhoto] = useState<string[]>([])
  const [notes, setNotes] = useState('')

  const [last, setLast] = useState<LastReading | null>(null)
  const [loadingLast, setLoadingLast] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const today = todayISODate()

  // Load the asset's last odometer reading whenever the asset changes (debounced).
  useEffect(() => {
    const a = assetNo.trim()
    if (!a) { setLast(null); return }
    let cancelled = false
    setLoadingLast(true)
    const h = setTimeout(async () => {
      try {
        const r = await getLastOdometer(a)
        if (!cancelled) setLast(r)
      } catch {
        if (!cancelled) setLast(null)
      } finally {
        if (!cancelled) setLoadingLast(false)
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(h) }
  }, [assetNo])

  const kmNum = Number(odometer)
  const hasKm = odometer.trim() !== '' && !Number.isNaN(kmNum)
  const dailyDelta = hasKm && last?.odometer_km != null ? kmNum - last.odometer_km : null
  const rollback = dailyDelta != null && dailyDelta < 0
  const bigJump = dailyDelta != null && dailyDelta > IMPLAUSIBLE_DAILY_KM

  const doSubmit = useCallback(async () => {
    setSubmitting(true)
    try {
      const hrsRaw = engineHours.trim()
      const hrsNum = hrsRaw === '' ? null : Number(hrsRaw)
      const res = await submitMeterReading({
        assetNo: assetNo.trim(),
        site: site.trim() || null,
        country: profile?.country ?? null,
        createdBy: profile?.id ?? null,
        readingDate: today,
        odometerKm: kmNum,
        odometerPhoto: odoPhoto.find(Boolean) ?? null,
        engineHours: hrsNum != null && !Number.isNaN(hrsNum) ? hrsNum : null,
        hoursPhoto: hoursPhoto.find(Boolean) ?? null,
        notes: notes.trim() || null,
      })
      Alert.alert(
        res.offline ? 'Saved on device' : 'Reading logged',
        res.offline
          ? 'Saved on device — it will sync when back online.'
          : `Odometer ${kmNum.toLocaleString()} km recorded for ${assetNo.trim()}.`,
        [{ text: 'Done', onPress: () => router.back() }],
      )
    } catch (e: any) {
      Alert.alert('Could not log reading', e?.message || 'Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [assetNo, site, profile, today, kmNum, odoPhoto, engineHours, hoursPhoto, notes, router])

  function handleSubmit() {
    if (submitting) return
    if (!assetNo.trim()) { Alert.alert('Asset required', 'Select the vehicle / asset you are logging.'); return }
    if (!hasKm) { Alert.alert('Reading required', 'Enter the current odometer reading (km).'); return }
    if (kmNum < 0) { Alert.alert('Invalid reading', 'Odometer reading cannot be negative.'); return }
    if (!odoPhoto.find(Boolean)) {
      Alert.alert('Photo required', 'Take a photo of the odometer gauge to confirm the reading.')
      return
    }
    if (rollback) {
      Alert.alert(
        'Reading is lower than last',
        `The last recorded reading was ${last?.odometer_km?.toLocaleString()} km. A meter should not go backwards. Log it anyway?`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Log anyway', style: 'destructive', onPress: doSubmit }],
      )
      return
    }
    if (bigJump) {
      Alert.alert(
        'Large jump since last reading',
        `That is ${dailyDelta?.toLocaleString()} km since the last reading — please double-check the number. Log it anyway?`,
        [{ text: 'Re-check', style: 'cancel' }, { text: 'Log anyway', onPress: doSubmit }],
      )
      return
    }
    doSubmit()
  }

  if (!allowed) return null

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.nav, isRTL && styles.rowR]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.navTitle, { textAlign }]}>Daily Meter Log</Text>
            <Text style={[styles.navSub, { textAlign }]}>
              {new Date().toLocaleDateString(dateLocale, { weekday: 'short', day: 'numeric', month: 'short' })}
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Asset + site */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>Asset / Vehicle *</Text>
            <ChecklistReferencePicker
              source="asset"
              value={assetNo}
              onChange={setAssetNo}
              country={profile?.country ?? null}
              placeholder="Select or type the asset…"
            />
            <View style={{ height: 12 }} />
            <Text style={[styles.label, { textAlign }]}>Site</Text>
            <ChecklistReferencePicker
              source="site"
              value={site}
              onChange={setSite}
              country={profile?.country ?? null}
              placeholder="Select the site…"
            />
          </View>

          {/* Last reading panel */}
          {!!assetNo.trim() && (
            <View style={[styles.lastCard, rollback && styles.lastCardWarn]}>
              <Ionicons
                name={loadingLast ? 'time-outline' : last ? 'speedometer-outline' : 'help-circle-outline'}
                size={18}
                color={rollback ? theme.color.danger.base : theme.color.info.base}
              />
              <View style={{ flex: 1 }}>
                {loadingLast ? (
                  <Text style={[styles.lastText, { textAlign }]}>Checking last reading…</Text>
                ) : last?.odometer_km != null ? (
                  <>
                    <Text style={[styles.lastText, { textAlign }]}>
                      Last: {last.odometer_km.toLocaleString()} km
                      {last.reading_date ? ` · ${new Date(last.reading_date + 'T00:00:00').toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}` : ''}
                    </Text>
                    {dailyDelta != null && (
                      <Text style={[styles.deltaText, rollback && { color: theme.color.danger.base }, bigJump && { color: theme.color.warning.base }, { textAlign }]}>
                        {rollback
                          ? `${dailyDelta.toLocaleString()} km (lower than last!)`
                          : `+${dailyDelta.toLocaleString()} km since last`}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={[styles.lastText, { textAlign }]}>No previous reading on record.</Text>
                )}
              </View>
            </View>
          )}

          {/* Odometer */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>Odometer (km) *</Text>
            <TextInput
              style={[styles.input, styles.bigInput, { textAlign }]}
              value={odometer}
              onChangeText={t => setOdometer(t.replace(/[^0-9.]/g, ''))}
              placeholder="e.g. 128450"
              placeholderTextColor={theme.color.textMuted}
              keyboardType="numeric"
            />
            <Text style={[styles.help, { textAlign }]}>Photo of the odometer gauge *</Text>
            <PhotoCapture value={odoPhoto} onChange={setOdoPhoto} module="meter-log" tint={theme.color.primary} max={1} label="Photograph gauge" />
          </View>

          {/* Engine hours (optional) */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>Engine hours <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={[styles.input, { textAlign }]}
              value={engineHours}
              onChangeText={t => setEngineHours(t.replace(/[^0-9.]/g, ''))}
              placeholder="e.g. 4210"
              placeholderTextColor={theme.color.textMuted}
              keyboardType="numeric"
            />
            {engineHours.trim() !== '' && (
              <>
                <Text style={[styles.help, { textAlign }]}>Photo of the hour-meter gauge</Text>
                <PhotoCapture value={hoursPhoto} onChange={setHoursPhoto} module="meter-log" tint={theme.color.info.base} max={1} label="Photograph gauge" />
              </>
            )}
          </View>

          {/* Notes */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>Notes <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={[styles.input, styles.textArea, { textAlign }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything worth noting…"
              placeholderTextColor={theme.color.textMuted}
              multiline
              numberOfLines={3}
            />
          </View>

          <Button
            label="Log Reading"
            icon="save-outline"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting}
            size="lg"
            full
            style={{ marginTop: spacing.xs }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    nav: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: c.surface,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    navBack: {
      width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },
    navTitle: { ...typography.title, color: c.text },
    navSub: { ...typography.caption, color: c.textMuted, marginTop: 1 },

    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md },

    card: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
    },
    label: { ...typography.label, color: c.textSecondary, marginBottom: spacing.sm },
    optional: { ...typography.caption, color: c.textMuted },
    help: { ...typography.caption, color: c.textMuted, marginTop: spacing.md, marginBottom: spacing.sm },

    input: {
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14, color: c.text,
    },
    bigInput: { fontSize: 20, fontWeight: '800', paddingVertical: 13, letterSpacing: 0.5 },
    textArea: { minHeight: 76, textAlignVertical: 'top' },

    lastCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.info.soft, borderRadius: radius.md, padding: spacing.md,
      borderWidth: 1, borderColor: c.info.base,
    },
    lastCardWarn: { backgroundColor: c.danger.soft, borderColor: c.danger.base },
    lastText: { ...typography.body, fontWeight: '700', color: c.text },
    deltaText: { ...typography.caption, fontWeight: '700', color: c.info.on, marginTop: 2 },
  })
}
