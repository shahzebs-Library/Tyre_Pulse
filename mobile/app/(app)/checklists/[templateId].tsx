/**
 * Checklist fill & submit
 *
 * Loads a published template, seeds blank answers, and renders each field in
 * order — hiding fields whose `visibleWhen` condition isn't met (recomputed live
 * as answers change). Validation, optional scoring and signature capture run at
 * submit; the write is offline-safe via the checklists service (record queue).
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, StatusBar, Platform,
  KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import PhotoCapture from '../../../components/PhotoCapture'
import ChecklistReferencePicker from '../../../components/ChecklistReferencePicker'
import SignaturePad from '../../../components/SignaturePad'
import { getTemplate, submitChecklist, ChecklistTemplate } from '../../../lib/checklists'
import {
  ChecklistField, blankAnswer, isValueField, isFieldVisible,
  validateSubmission, computeScore, isReferenceField, referenceSource,
  isAutoField, resolveAutoValue,
} from '../../../lib/checklistFields'

export default function ChecklistFillScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const router = useRouter()
  const params = useLocalSearchParams<{
    templateId?: string; assignment?: string; site?: string; asset_no?: string
  }>()
  const templateId = String(params.templateId ?? '')
  const assignmentId = params.assignment ? String(params.assignment) : null

  const [template, setTemplate] = useState<ChecklistTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [site, setSite] = useState(params.site ? String(params.site) : '')
  const [assetNo, setAssetNo] = useState(params.asset_no ? String(params.asset_no) : '')
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [photos, setPhotos] = useState<Record<string, string[]>>({})
  const [printedName, setPrintedName] = useState('')
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const t = await getTemplate(templateId)
      if (!t) { setTemplate(null); setLoading(false); return }
      setTemplate(t)
      setTitle(t.name ?? '')
      // Seed blank answers for every value field so controlled inputs stay stable.
      // Auto-fill + lock fields are prefilled from live context (inspector/today).
      const today = new Date().toISOString().slice(0, 10)
      const userName = profile?.full_name || profile?.username || ''
      const seed: Record<string, any> = {}
      for (const f of t.fields ?? []) {
        if (isValueField(f.type)) {
          seed[f.id] = isAutoField(f) ? resolveAutoValue(f, { userName, today }) : blankAnswer(f)
        }
      }
      setAnswers(seed)
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load this checklist.')
    } finally {
      setLoading(false)
    }
  }, [templateId, profile])

  useEffect(() => { load() }, [load])

  const setAnswer = useCallback((id: string, value: any) => {
    setAnswers(prev => ({ ...prev, [id]: value }))
    setErrors(prev => (prev[id] ? { ...prev, [id]: '' } : prev))
  }, [])

  const setFieldPhotos = useCallback((id: string, urls: string[]) => {
    setPhotos(prev => ({ ...prev, [id]: urls }))
  }, [])

  // Only fields currently visible are rendered / validated / scored.
  const visibleFields = useMemo(
    () => (template?.fields ?? []).filter(f => isFieldVisible(f, answers)),
    [template, answers],
  )

  async function handleSubmit() {
    if (!template || submitting) return

    const { valid, errors: errs } = validateSubmission(template.fields, answers)
    if (!valid) {
      setErrors(errs)
      const first = Object.values(errs)[0]
      Alert.alert('Please review', first || 'Some required fields need attention.')
      return
    }
    setErrors({})

    const name = printedName.trim() || (profile?.full_name ?? '')
    if (template.require_signature) {
      if (!signatureData) {
        Alert.alert('Signature required', 'Please sign in the signature box to complete this checklist.')
        return
      }
      if (!name) {
        Alert.alert('Name required', 'Type your name under the signature to confirm who signed.')
        return
      }
    }

    let score_pct: number | null = null
    let score_passed: boolean | null = null
    if (template.scored) {
      const s = computeScore(template.fields, answers, template.pass_threshold ?? null)
      score_pct = s.pct
      score_passed = s.passed
    }

    setSubmitting(true)
    try {
      const res = await submitChecklist({
        template,
        answers,
        photos,
        printed_name: printedName.trim() || (profile?.full_name ?? null),
        signature_data: signatureData,
        site: site.trim() || null,
        asset_no: assetNo.trim() || null,
        title: title.trim() || template.name,
        country: profile?.country ?? null,
        assignmentId: assignmentId || null,
        score_pct,
        score_passed,
      })

      if (res.offline) {
        Alert.alert('Saved on device', 'Saved on device — will sync when online.', [
          { text: 'OK', onPress: () => router.back() },
        ])
      } else {
        const scoreLine = template.scored && score_pct != null
          ? `\n\nScore: ${score_pct}%${score_passed != null ? ` · ${score_passed ? 'Passed' : 'Failed'}` : ''}`
          : ''
        Alert.alert('Checklist submitted', `Your checklist has been recorded.${scoreLine}`, [
          { text: 'Done', onPress: () => router.back() },
        ])
      }
    } catch (e: any) {
      Alert.alert('Submission failed', e?.message || 'Could not submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading / error / not-found ────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    )
  }

  if (loadError || !template) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
        <View style={[styles.nav, isRTL && styles.rowR]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
          </TouchableOpacity>
          <Text style={[styles.navTitle, { textAlign }]}>Checklist</Text>
        </View>
        <View style={styles.stateWrap}>
          <Ionicons
            name={loadError ? 'cloud-offline-outline' : 'help-circle-outline'}
            size={52}
            color={loadError ? '#fca5a5' : '#cbd5e1'}
          />
          <Text style={styles.stateTitle}>{loadError ? "Couldn't load checklist" : 'Checklist not found'}</Text>
          <Text style={styles.stateText}>
            {loadError || 'This checklist may have been unpublished or removed.'}
          </Text>
          {loadError && (
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load() }}>
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.nav, isRTL && styles.rowR]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.navTitle, { textAlign }]} numberOfLines={1}>{template.name}</Text>
            {!!template.category && (
              <Text style={[styles.navSub, { textAlign }]} numberOfLines={1}>{template.category}</Text>
            )}
          </View>
          {template.scored && (
            <View style={styles.scoredPill}>
              <Ionicons name="ribbon-outline" size={12} color="#15803d" />
              <Text style={styles.scoredPillText}>Scored</Text>
            </View>
          )}
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header block ─────────────────────────────────────────────────── */}
          <View style={styles.card}>
            <Field label="Title">
              <TextInput
                style={[styles.input, { textAlign }]}
                value={title}
                onChangeText={setTitle}
                placeholder={template.name}
                placeholderTextColor="#94a3b8"
              />
            </Field>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Field label="Asset No">
                  <TextInput
                    style={[styles.input, { textAlign }]}
                    value={assetNo}
                    onChangeText={setAssetNo}
                    placeholder="e.g. TRK-001"
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Site">
                  <TextInput
                    style={[styles.input, { textAlign }]}
                    value={site}
                    onChangeText={setSite}
                    placeholder="Site"
                    placeholderTextColor="#94a3b8"
                  />
                </Field>
              </View>
            </View>
          </View>

          {/* ── Dynamic fields ───────────────────────────────────────────────── */}
          {visibleFields.map(field => (
            <FieldRenderer
              key={field.id}
              field={field}
              value={answers[field.id]}
              photos={photos[field.id] ?? []}
              error={errors[field.id]}
              printedName={printedName}
              signatureData={signatureData}
              textAlign={textAlign}
              country={profile?.country ?? null}
              onChange={v => setAnswer(field.id, v)}
              onPhotos={urls => setFieldPhotos(field.id, urls)}
              onPrintedName={setPrintedName}
              onSignature={setSignatureData}
            />
          ))}

          {/* ── Submit ───────────────────────────────────────────────────────── */}
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.88}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                <Text style={styles.submitText}>Submit Checklist</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// ── Field wrapper (label + required asterisk + help + error) ──────────────────
function Field({
  label, required, help, error, children, textAlign = 'left',
}: {
  label?: string; required?: boolean; help?: string; error?: string
  children: React.ReactNode; textAlign?: 'left' | 'right'
}) {
  return (
    <View style={styles.field}>
      {!!label && (
        <Text style={[styles.fieldLabel, { textAlign }]}>
          {label}{required ? <Text style={styles.req}> *</Text> : null}
        </Text>
      )}
      {children}
      {!!help && !error && <Text style={[styles.help, { textAlign }]}>{help}</Text>}
      {!!error && <Text style={[styles.errorText, { textAlign }]}>{error}</Text>}
    </View>
  )
}

// ── Per-type field renderer ───────────────────────────────────────────────────
function FieldRenderer({
  field, value, photos, error, printedName, signatureData, textAlign, country,
  onChange, onPhotos, onPrintedName, onSignature,
}: {
  field: ChecklistField
  value: any
  photos: string[]
  error?: string
  printedName: string
  signatureData: string | null
  textAlign: 'left' | 'right'
  country?: string | null
  onChange: (v: any) => void
  onPhotos: (urls: string[]) => void
  onPrintedName: (v: string) => void
  onSignature: (v: string | null) => void
}) {
  // Section: a bold divider heading, no input.
  if (field.type === 'section') {
    return (
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { textAlign }]}>{field.label || 'Section'}</Text>
        {!!field.help && <Text style={[styles.sectionHelp, { textAlign }]}>{field.help}</Text>}
      </View>
    )
  }

  // Photo field: capture grid stored under the field id.
  if (field.type === 'photo') {
    return (
      <View style={styles.card}>
        <Field label={field.label} required={field.required} help={field.help} error={error} textAlign={textAlign}>
          <PhotoCapture value={photos} onChange={onPhotos} module="checklist" tint="#16a34a" />
        </Field>
      </View>
    )
  }

  // Signature: a real finger-drawn signature (captured as SVG) plus the printed
  // name of who signed. Both are validated at submit when require_signature.
  if (field.type === 'signature') {
    return (
      <View style={styles.card}>
        <Field label={field.label || 'Signature'} required={field.required} error={error} textAlign={textAlign}>
          <SignaturePad onChange={onSignature} height={180} />
        </Field>
        <View style={{ marginTop: 12 }}>
          <Text style={[styles.fieldLabel, { textAlign }]}>Printed name</Text>
          <TextInput
            style={[styles.input, { textAlign }]}
            value={printedName}
            onChangeText={onPrintedName}
            placeholder="Type your full name"
            placeholderTextColor="#94a3b8"
            autoCapitalize="words"
          />
          <Text style={[styles.help, { textAlign }]}>
            {signatureData ? 'Signed — printed name confirms who signed.' : 'Sign above, then print your name.'}
          </Text>
        </View>
      </View>
    )
  }

  // Auto-fill + lock: prefilled from context and shown read-only (no editable control).
  if (isAutoField(field)) {
    return (
      <View style={styles.card}>
        <Field label={field.label} required={field.required} help={field.help} error={error} textAlign={textAlign}>
          <View style={styles.lockedRow}>
            <Text style={[styles.lockedText, { textAlign }]} numberOfLines={1}>
              {value != null && value !== '' ? String(value) : '—'}
            </Text>
            <View style={styles.lockedHint}>
              <Ionicons name="lock-closed" size={12} color="#94a3b8" />
              <Text style={styles.lockedHintText}>Auto · locked</Text>
            </View>
          </View>
        </Field>
      </View>
    )
  }

  return (
    <View style={styles.card}>
      <Field label={field.label} required={field.required} help={field.help} error={error} textAlign={textAlign}>
        <ValueInput field={field} value={value} textAlign={textAlign} country={country} onChange={onChange} />
      </Field>
      {/* Any non-photo field flagged allow_photo gets an inline capture. */}
      {field.allow_photo && (
        <View style={{ marginTop: 10 }}>
          <Text style={[styles.help, { textAlign, marginBottom: 6 }]}>Attach photo</Text>
          <PhotoCapture value={photos} onChange={onPhotos} module="checklist" tint="#16a34a" max={4} />
        </View>
      )}
    </View>
  )
}

// ── The actual input control per value type ───────────────────────────────────
function ValueInput({
  field, value, textAlign, country, onChange,
}: {
  field: ChecklistField; value: any; textAlign: 'left' | 'right'
  country?: string | null; onChange: (v: any) => void
}) {
  // Reference fields (asset/site/user) use the live searchable picker.
  if (isReferenceField(field.type)) {
    return (
      <ChecklistReferencePicker
        source={referenceSource(field.type)!}
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
        country={country}
        placeholder={`Select a ${field.type}…`}
      />
    )
  }

  switch (field.type) {
    case 'textarea':
      return (
        <TextInput
          style={[styles.input, styles.textArea, { textAlign }]}
          value={String(value ?? '')}
          onChangeText={onChange}
          placeholder="Enter details..."
          placeholderTextColor="#94a3b8"
          multiline
          numberOfLines={4}
        />
      )

    case 'number':
      return (
        <TextInput
          style={[styles.input, { textAlign }]}
          value={String(value ?? '')}
          onChangeText={onChange}
          placeholder="0"
          placeholderTextColor="#94a3b8"
          keyboardType="numeric"
        />
      )

    case 'date':
      return (
        <TextInput
          style={[styles.input, { textAlign }]}
          value={String(value ?? '')}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          autoCorrect={false}
        />
      )

    case 'select': {
      const opts = field.options ?? []
      return (
        <View style={styles.chipWrap}>
          {opts.map(opt => {
            const active = value === opt
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.choiceChip, active && styles.choiceChipActive]}
                onPress={() => onChange(active ? '' : opt)}
                activeOpacity={0.75}
              >
                <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{opt}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      )
    }

    case 'multiselect': {
      const opts = field.options ?? []
      const arr: any[] = Array.isArray(value) ? value : []
      return (
        <View style={styles.chipWrap}>
          {opts.map(opt => {
            const active = arr.includes(opt)
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.choiceChip, active && styles.choiceChipActive]}
                onPress={() => onChange(active ? arr.filter(v => v !== opt) : [...arr, opt])}
                activeOpacity={0.75}
              >
                {active && <Ionicons name="checkmark" size={13} color="#fff" />}
                <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{opt}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      )
    }

    case 'boolean': {
      const opts: { label: string; val: boolean }[] = [
        { label: 'Yes', val: true },
        { label: 'No', val: false },
      ]
      return (
        <View style={styles.segment}>
          {opts.map(o => {
            const active = value === o.val
            return (
              <TouchableOpacity
                key={o.label}
                style={[styles.segmentBtn, active && (o.val ? styles.segmentYes : styles.segmentNo)]}
                onPress={() => onChange(active ? null : o.val)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={o.val ? 'checkmark-circle-outline' : 'close-circle-outline'}
                  size={16}
                  color={active ? '#fff' : (o.val ? '#16a34a' : '#dc2626')}
                />
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      )
    }

    case 'rating': {
      const n = Number(value) || 0
      return (
        <View style={styles.starRow}>
          {[1, 2, 3, 4, 5].map(star => (
            <TouchableOpacity
              key={star}
              onPress={() => onChange(n === star ? 0 : star)}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={star <= n ? 'star' : 'star-outline'}
                size={30}
                color={star <= n ? '#f59e0b' : '#cbd5e1'}
              />
            </TouchableOpacity>
          ))}
          {n > 0 && <Text style={styles.ratingValue}>{n}/5</Text>}
        </View>
      )
    }

    case 'text':
    default:
      return (
        <TextInput
          style={[styles.input, { textAlign }]}
          value={String(value ?? '')}
          onChangeText={onChange}
          placeholder="Enter text..."
          placeholderTextColor="#94a3b8"
        />
      )
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  center: { justifyContent: 'center', alignItems: 'center' },
  rowR: { flexDirection: 'row-reverse' },

  nav: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.07)',
  },
  navBack: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  navTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  navSub: { fontSize: 11, color: '#64748b', marginTop: 1 },
  scoredPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(22,163,74,0.1)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  scoredPillText: { fontSize: 10.5, fontWeight: '800', color: '#15803d' },

  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 12 },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },
  row2: { flexDirection: 'row', gap: 12 },

  field: { gap: 0 },
  fieldLabel: {
    fontSize: 12, fontWeight: '700', color: '#334155',
    marginBottom: 8,
  },
  req: { color: '#dc2626', fontWeight: '800' },
  help: { fontSize: 11.5, color: '#94a3b8', marginTop: 6, lineHeight: 16 },
  errorText: { fontSize: 11.5, color: '#dc2626', fontWeight: '600', marginTop: 6 },

  input: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: '#0f172a',
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },

  lockedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11,
  },
  lockedText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#475569' },
  lockedHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lockedHintText: { fontSize: 11, fontWeight: '700', color: '#94a3b8' },

  section: { marginTop: 6, paddingBottom: 2 },
  sectionLabel: {
    fontSize: 15, fontWeight: '800', color: '#0f172a',
    borderBottomWidth: 2, borderBottomColor: '#16a34a',
    paddingBottom: 6, alignSelf: 'flex-start',
  },
  sectionHelp: { fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 17 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  choiceChipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  choiceText: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  choiceTextActive: { color: '#fff' },

  segment: { flexDirection: 'row', gap: 10 },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, height: 46, borderRadius: 12,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  segmentYes: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  segmentNo: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  segmentText: { fontSize: 14, fontWeight: '700', color: '#334155' },
  segmentTextActive: { color: '#fff' },

  starRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingValue: { fontSize: 13, fontWeight: '800', color: '#0f172a', marginLeft: 6 },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#16a34a', borderRadius: 14, height: 52, marginTop: 6,
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  stateTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  stateText: { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
    backgroundColor: '#16a34a', borderRadius: 12, paddingHorizontal: 18, height: 44,
    justifyContent: 'center',
  },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
