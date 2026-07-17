/**
 * ChecklistItemSheet
 *
 * The tap-to-record popup for a single checklist item, mirroring the tyre
 * inspection's TyreDetailModal feel: a large iconic bottom sheet where the
 * operator records one item at a time with BIG, gloved-hand-friendly controls
 * instead of a fiddly inline form.
 *
 * Choice items (select / boolean / rating / multiselect) render as large icon
 * buttons with Pass / Fail / NA colouring inferred from the option text, so a
 * non-technical user sees green = good, red = problem at a glance. Text, number,
 * date, reference, photo and signature items fall back to their large native
 * controls. All edits flow straight to the parent through onChange; nothing is
 * buffered here.
 */
import { useMemo } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../lib/theme'
import PhotoCapture from './PhotoCapture'
import SignaturePad from './SignaturePad'
import ChecklistReferencePicker from './ChecklistReferencePicker'
import {
  ChecklistField, isReferenceField, referenceSource, isAutoField,
} from '../lib/checklistFields'

type IconName = keyof typeof Ionicons.glyphMap
type Tone = 'pass' | 'fail' | 'na' | 'neutral'

// ── Option semantics ─────────────────────────────────────────────────────────
// Infer a Pass / Fail / NA meaning from free-text option labels so choices can
// be coloured and iconised without any template change. Anything unrecognised
// stays neutral (still a clear, tappable button).
const PASS_WORDS = ['pass', 'ok', 'okay', 'good', 'yes', 'present', 'working', 'serviceable', 'done', 'compliant', 'passed', 'safe', 'clean', 'available', 'fitted']
const FAIL_WORDS = ['fail', 'not ok', 'no', 'bad', 'defect', 'faulty', 'fault', 'missing', 'damaged', 'worn', 'leak', 'failed', 'unsafe', 'broken', 'low', 'overdue', 'expired', 'not working']
const NA_WORDS = ['n/a', 'na', 'not applicable', 'none', 'skip', 'not checked']

export function optionTone(opt: string): Tone {
  const s = String(opt ?? '').toLowerCase().trim()
  if (!s) return 'neutral'
  if (NA_WORDS.some(w => s === w || s.startsWith(w))) return 'na'
  if (FAIL_WORDS.some(w => s === w || s.includes(w))) return 'fail'
  if (PASS_WORDS.some(w => s === w || s.includes(w))) return 'pass'
  return 'neutral'
}

function toneIcon(tone: Tone): IconName {
  switch (tone) {
    case 'pass': return 'checkmark-circle'
    case 'fail': return 'close-circle'
    case 'na': return 'remove-circle'
    default: return 'ellipse-outline'
  }
}

interface Props {
  visible: boolean
  field: ChecklistField | null
  value: any
  photos: string[]
  printedName: string
  signatureData: string | null
  country?: string | null
  error?: string
  onChange: (v: any) => void
  onPhotos: (urls: string[]) => void
  onPrintedName: (v: string) => void
  onSignature: (v: string | null) => void
  onClose: () => void
}

type ToneColors = { fg: string; bg: string; border: string }

function toneColorFor(c: Theme['color'], tone: Tone): ToneColors {
  switch (tone) {
    case 'pass': return { fg: c.success.on, bg: c.success.soft, border: c.success.base }
    case 'fail': return { fg: c.danger.on, bg: c.danger.soft, border: c.danger.base }
    case 'na': return { fg: c.neutral.on, bg: c.neutral.soft, border: c.neutral.base }
    default: return { fg: c.info.on, bg: c.info.soft, border: c.info.base }
  }
}

// Big square-ish option button used by select / multiselect / boolean.
// Module-level on purpose: components declared inside a render body get a new
// identity every render, which remounts their subtree on each keystroke
// (focus loss + keyboard flicker). Never move this back inside the sheet.
function OptionButton({
  label, active, tone, onPress, styles, c,
}: {
  label: string; active: boolean; tone: Tone; onPress: () => void
  styles: ReturnType<typeof makeStyles>; c: Theme['color']
}) {
  const t = toneColorFor(c, tone)
  return (
    <TouchableOpacity
      style={[
        styles.optBtn,
        { borderColor: c.border },
        active && { backgroundColor: t.bg, borderColor: t.border },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Ionicons
        name={toneIcon(tone)}
        size={30}
        color={active ? t.border : c.textMuted}
      />
      <Text
        style={[styles.optLabel, active && { color: t.fg }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
}

export default function ChecklistItemSheet({
  visible, field, value, photos, printedName, signatureData, country, error,
  onChange, onPhotos, onPrintedName, onSignature, onClose,
}: Props) {
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const c = theme.color

  if (!field) {
    return <Modal visible={false} transparent animationType="slide" onRequestClose={onClose} />
  }

  // Plain render FUNCTION (called as renderBody(), never as <Body />): a JSX
  // component defined here would remount on every parent render, dropping
  // TextInput focus on each keystroke and making the keyboard blink.
  const renderBody = () => {
    const f = field!

    // Reference (asset / site / user) — live searchable picker.
    if (isReferenceField(f.type)) {
      return (
        <ChecklistReferencePicker
          source={referenceSource(f.type)!}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          country={country}
          placeholder={`Select a ${f.type}...`}
        />
      )
    }

    switch (f.type) {
      case 'photo':
        return <PhotoCapture value={photos} onChange={onPhotos} module="checklist" tint={c.primary} />

      case 'signature':
        return (
          <View style={{ gap: spacing.md }}>
            <SignaturePad onChange={onSignature} height={180} />
            <View>
              <Text style={styles.miniLabel}>Printed name</Text>
              <TextInput
                style={styles.input}
                value={printedName}
                onChangeText={onPrintedName}
                placeholder="Type your full name"
                placeholderTextColor={c.textMuted}
                autoCapitalize="words"
              />
              <Text style={styles.help}>
                {signatureData ? 'Signed. Printed name confirms who signed.' : 'Sign above, then print your name.'}
              </Text>
            </View>
          </View>
        )

      case 'boolean': {
        const opts: { label: string; val: boolean; tone: Tone }[] = [
          { label: 'Yes', val: true, tone: 'pass' },
          { label: 'No', val: false, tone: 'fail' },
        ]
        return (
          <View style={styles.optGrid}>
            {opts.map(o => (
              <OptionButton
                key={o.label}
                label={o.label}
                tone={o.tone}
                active={value === o.val}
                onPress={() => onChange(value === o.val ? null : o.val)}
                styles={styles}
                c={c}
              />
            ))}
          </View>
        )
      }

      case 'select': {
        const opts = f.options ?? []
        return (
          <View style={styles.optGrid}>
            {opts.map(opt => (
              <OptionButton
                key={opt}
                label={opt}
                tone={optionTone(opt)}
                active={value === opt}
                onPress={() => onChange(value === opt ? '' : opt)}
                styles={styles}
                c={c}
              />
            ))}
          </View>
        )
      }

      case 'multiselect': {
        const opts = f.options ?? []
        const arr: any[] = Array.isArray(value) ? value : []
        return (
          <View style={styles.optGrid}>
            {opts.map(opt => {
              const active = arr.includes(opt)
              return (
                <OptionButton
                  key={opt}
                  label={opt}
                  tone={optionTone(opt)}
                  active={active}
                  onPress={() => onChange(active ? arr.filter(v => v !== opt) : [...arr, opt])}
                  styles={styles}
                  c={c}
                />
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
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={star <= n ? 'star' : 'star-outline'}
                  size={46}
                  color={star <= n ? '#F59E0B' : c.borderStrong}
                />
              </TouchableOpacity>
            ))}
          </View>
        )
      }

      case 'textarea':
        return (
          <TextInput
            style={[styles.input, styles.textArea]}
            value={String(value ?? '')}
            onChangeText={onChange}
            placeholder="Enter details..."
            placeholderTextColor={c.textMuted}
            multiline
            numberOfLines={5}
            autoFocus
          />
        )

      case 'number':
        return (
          <TextInput
            style={[styles.input, styles.bigInput]}
            value={String(value ?? '')}
            onChangeText={onChange}
            placeholder="0"
            placeholderTextColor={c.textMuted}
            keyboardType="numeric"
            autoFocus
          />
        )

      case 'date':
        return (
          <TextInput
            style={[styles.input, styles.bigInput]}
            value={String(value ?? '')}
            onChangeText={onChange}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )

      case 'text':
      default:
        return (
          <TextInput
            style={[styles.input, styles.bigInput]}
            value={String(value ?? '')}
            onChangeText={onChange}
            placeholder="Enter text..."
            placeholderTextColor={c.textMuted}
            autoFocus
          />
        )
    }
  }

  const locked = isAutoField(field)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>
                {field.label || 'Item'}
                {field.required ? <Text style={styles.req}> *</Text> : null}
              </Text>
              {!!field.help && <Text style={styles.headerHelp} numberOfLines={3}>{field.help}</Text>}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={22} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator
          >
            {locked ? (
              <View style={styles.lockedRow}>
                <Text style={styles.lockedText} numberOfLines={1}>
                  {value != null && value !== '' ? String(value) : 'N/A'}
                </Text>
                <View style={styles.lockedHint}>
                  <Ionicons name="lock-closed" size={12} color={c.textMuted} />
                  <Text style={styles.lockedHintText}>Auto - locked</Text>
                </View>
              </View>
            ) : (
              renderBody()
            )}

            {/* Inline photo attach for any non-photo item flagged allow_photo. */}
            {!locked && field.allow_photo && field.type !== 'photo' && (
              <View style={{ marginTop: spacing.lg }}>
                <Text style={styles.miniLabel}>Attach photo</Text>
                <PhotoCapture value={photos} onChange={onPhotos} module="checklist" tint={c.primary} max={4} />
              </View>
            )}

            {!!error && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={15} color={c.danger.base} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.9}>
            <Ionicons name="checkmark" size={19} color={c.onPrimary} />
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: c.overlay },
    sheetWrap: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'],
      paddingHorizontal: spacing.xl, paddingTop: spacing.md,
      paddingBottom: Platform.OS === 'ios' ? 34 : spacing.xl,
      maxHeight: '88%',
    },
    handle: {
      alignSelf: 'center', width: 40, height: 5, borderRadius: 3,
      backgroundColor: c.border, marginBottom: spacing.md,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingBottom: spacing.md },
    title: { ...typography.h3, color: c.text },
    req: { color: c.danger.base, fontWeight: '800' },
    headerHelp: { ...typography.caption, color: c.textMuted, marginTop: 3, lineHeight: 17 },
    closeBtn: {
      width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },

    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { paddingBottom: spacing.xl },

    optGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    optBtn: {
      flexGrow: 1, flexBasis: '46%', minHeight: 84,
      alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
      borderRadius: radius.lg, borderWidth: 1.5,
      backgroundColor: c.surfaceAlt,
    },
    optLabel: { ...typography.bodyStrong, color: c.textSecondary, textAlign: 'center' },

    starRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },

    input: {
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
      ...typography.body, color: c.text,
    },
    bigInput: { fontSize: 18, lineHeight: 24, paddingVertical: 14 },
    textArea: { minHeight: 120, textAlignVertical: 'top' },

    miniLabel: { ...typography.label, color: c.textSecondary, marginBottom: 8 },
    help: { ...typography.caption, color: c.textMuted, marginTop: 6, lineHeight: 16 },

    lockedRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 14,
    },
    lockedText: { flex: 1, ...typography.bodyStrong, color: c.textSecondary },
    lockedHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    lockedHintText: { ...typography.micro, color: c.textMuted },

    errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
    errorText: { ...typography.caption, color: c.danger.base, fontWeight: '700', flex: 1 },

    doneBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.primary, borderRadius: radius.md, height: 54, marginTop: spacing.sm,
    },
    doneBtnText: { ...typography.h3, color: c.onPrimary },
  })
}
