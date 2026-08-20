import { useState } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useModuleGuard } from '../../hooks/useRoleGuard'
import { saveCommand } from '../../lib/recordQueue'
import PhotoCapture from '../../components/PhotoCapture'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme } from '../../lib/theme'

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const
const PRI_COLOR: Record<string, string> = { Low: '#16a34a', Medium: '#ca8a04', High: '#ea580c', Critical: '#dc2626' }
const DUE_PRESETS = [
  { label: 'No date', days: null as number | null },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
]
const DUE_LABEL_KEY: Record<string, string> = {
  'No date': 'modules.reportIssue.dueNone',
  '3 days': 'modules.reportIssue.due3',
  '1 week': 'modules.reportIssue.due1w',
  '2 weeks': 'modules.reportIssue.due2w',
}

import { withModuleGuard } from '../../components/ModuleGuard'
import { backTo } from '../../lib/goBack'

export default withModuleGuard(ReportIssueScreen, 'reportIssue')

function ReportIssueScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()
  const { theme } = useTheme()
  const s = useMemo(() => makeStyles(theme), [theme])
  const params = useLocalSearchParams<{ asset?: string; site?: string; serial?: string }>()
  const { allowed } = useModuleGuard('reportIssue')

  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('Medium')
  const [site, setSite] = useState(params.site ?? profile?.site ?? '')
  const [assetNo, setAssetNo] = useState(params.asset ?? '')
  const [description, setDescription] = useState('')
  const [dueDays, setDueDays] = useState<number | null>(7)
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'

  async function submit() {
    if (saving) return
    if (!title.trim()) { Alert.alert(t('modules.reportIssue.raisedTitle'), t('modules.reportIssue.missingTitle')); return }
    setSaving(true)
    const due = dueDays != null ? new Date(Date.now() + dueDays * 86400000).toISOString() : null
    const res = await saveCommand('REPORT_ISSUE', {
      title: title.trim(),
      priority,
      site: site.trim() || null,
      asset_no: assetNo.trim() || null,
      tyre_serial: params.serial ?? null,
      description: description.trim() || null,
      status: 'Open',
      assigned_to: profile?.full_name ?? profile?.username ?? null,
      due_date: due,
      photos: photos.filter(Boolean).length ? photos.filter(Boolean) : null,
      country: profile?.country ?? null,
      created_by: profile?.id ?? null,
    })
    setSaving(false)
    Alert.alert(res.offline ? t('modules.common.offlineSaved') : t('modules.reportIssue.raisedTitle'), t('modules.reportIssue.raisedMsg'), [
      { text: t('common.ok'), onPress: () => router.replace('/(app)/tasks') },
    ])
  }

  if (!allowed) return null

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={[s.header, isRTL && s.rowR]}>
        <TouchableOpacity onPress={() => backTo(router, '/(app)')} style={s.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.mode === 'dark' ? theme.color.text : '#0f172a'} />
        </TouchableOpacity>
        <Text style={[s.title, { textAlign }]}>{t('modules.reportIssue.title')}</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={[s.label, { textAlign }]}>{t('modules.reportIssue.problem')}</Text>
          <TextInput
            style={[s.input, { textAlign }]}
            placeholder={t('modules.reportIssue.problemPh')}
            placeholderTextColor={theme.color.textMuted}
            value={title}
            onChangeText={setTitle}
          />

          <Text style={[s.label, { textAlign }]}>{t('modules.common.priority')}</Text>
          <View style={s.chipRow}>
            {PRIORITIES.map(p => (
              <TouchableOpacity
                key={p}
                style={[s.chip, priority === p && { backgroundColor: PRI_COLOR[p], borderColor: PRI_COLOR[p] }]}
                onPress={() => setPriority(p)}
              >
                <Text style={[s.chipText, priority === p && s.chipTextActive]}>{t(`modules.priority.${p}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.row2}>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, { textAlign }]}>{t('modules.common.site')}</Text>
              <TextInput style={[s.input, { textAlign }]} placeholder={t('modules.reportIssue.sitePh')} placeholderTextColor={theme.color.textMuted} value={site} onChangeText={setSite} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, { textAlign }]}>{t('modules.common.asset')}</Text>
              <TextInput style={[s.input, { textAlign }]} placeholder={t('modules.reportIssue.assetPh')} placeholderTextColor={theme.color.textMuted} value={assetNo} onChangeText={setAssetNo} autoCapitalize="characters" />
            </View>
          </View>

          <Text style={[s.label, { textAlign }]}>{t('modules.reportIssue.dueIn')}</Text>
          <View style={s.chipRow}>
            {DUE_PRESETS.map(d => (
              <TouchableOpacity
                key={d.label}
                style={[s.chip, dueDays === d.days && s.chipActiveGreen]}
                onPress={() => setDueDays(d.days)}
              >
                <Text style={[s.chipText, dueDays === d.days && s.chipTextActive]}>{t(DUE_LABEL_KEY[d.label])}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[s.label, { textAlign }]}>{`${t('modules.common.details')} ${t('modules.common.optional')}`}</Text>
          <TextInput
            style={[s.input, s.textarea, { textAlign }]}
            placeholder={t('modules.reportIssue.detailsPh')}
            placeholderTextColor={theme.color.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <Text style={[s.label, { textAlign }]}>{`${t('modules.common.photos')} ${t('modules.common.optional')}`}</Text>
          <PhotoCapture value={photos} onChange={setPhotos} module="report-issue" tint={theme.color.danger.base} />

          <TouchableOpacity style={[s.submit, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color={theme.color.onPrimary} /> : (
              <>
                <Ionicons name="send" size={18} color={theme.color.onPrimary} />
                <Text style={s.submitText}>{t('modules.reportIssue.raise')}</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.mode === 'dark' ? c.bg : '#f0f5f1' },
    rowR: { flexDirection: 'row-reverse' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
    backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.06)' },
    title: { fontSize: 20, fontWeight: '800', color: theme.mode === 'dark' ? c.text : '#0f172a' },
    content: { padding: 16, gap: 8, paddingBottom: 48 },
    label: { fontSize: 13, fontWeight: '700', color: theme.mode === 'dark' ? c.textSecondary : '#475569', marginTop: 10 },
    input: { backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: theme.mode === 'dark' ? c.text : '#0f172a', borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.08)' },
    textarea: { minHeight: 90, textAlignVertical: 'top' },
    row2: { flexDirection: 'row', gap: 10 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.1)' },
    chipActiveGreen: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { fontSize: 12.5, fontWeight: '700', color: theme.mode === 'dark' ? c.textSecondary : '#64748b' },
    chipTextActive: { color: c.onPrimary },
    submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, borderRadius: 14, padding: 16, marginTop: 20, shadowColor: c.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
    submitText: { fontSize: 16, fontWeight: '800', color: c.onPrimary },
  })
}
