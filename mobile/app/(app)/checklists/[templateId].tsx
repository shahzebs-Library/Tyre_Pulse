/**
 * Checklist fill & submit - workshop sheet (V594 / V595)
 *
 * This is the screen a mechanic, an auto electrician or a driver actually fills
 * standing next to the machine, with gloves on, in the sun. The workshop sheet
 * is 49 fields of which 31 are checks, so everything here is judged on one
 * question: how many taps does it cost to record an honest answer.
 *
 * WHAT THE SHEET DOES NOW, and why each piece is the way it is:
 *
 * 1. MARKS ARE ICONS, RECORDED IN PLACE. The 8-mark legend (OK, Not OK, Not
 *    applicable, Changed, Repaired, Added / Top-Up, Adjusted, Lubricated) is
 *    drawn as a row of big icon buttons ON the item, not behind a popup, so a
 *    check costs one tap instead of three. Each mark carries its MEANING from
 *    the legend and the chosen one shows it, because a mark nobody can explain
 *    is a mark that gets picked at random. Glyph and tone come from
 *    checklistMarks.markMeta - never invented here.
 *
 * 2. THE ASSET FILLS THE SHEET. Picking (or arriving with) an asset resolves
 *    the full vehicle_fleet row and applies checklistMarks.autoFillAnswers, so
 *    location and registration / fleet number arrive by themselves.
 *    EVERY QUESTION IS ASKED ONCE. The context card used to carry a Title box
 *    and a Site box on top of the sheet's own fields, so the operator answered
 *    Location twice and was asked to name a sheet whose reference the server
 *    mints anyway. Both are now DERIVED FROM THE TEMPLATE, never from a name:
 *    a template that carries a `site` field owns that question (the header
 *    writes the register's site through to it) and a template with a
 *    `doc_prefix` owns its own reference. A template with neither keeps the
 *    box, because then there is nowhere else to record it.
 *    READ-ONLY IS CONDITIONAL AND THAT IS DELIBERATE: fleet_number is populated
 *    on 398 of 1,030 KSA assets and on NONE of the 452 UAE or 135 Egypt ones,
 *    so a field that locked whatever the register held would be permanently
 *    blank and unfillable for most of the fleet. isFieldLocked locks a field
 *    only once a value actually arrived; otherwise the man on the floor can
 *    still type what is stamped on the machine. The date is locked outright.
 *
 * 3. KM AND HOUR METER ARE A PAIR. Either satisfies the sheet, neither may be
 *    skipped: 98 of 227 KSA transit mixers carry no odometer at all while every
 *    one of them has engine hours. A reading LOWER than the register's warns
 *    and never blocks, because a meter really can be replaced.
 *
 * 4. SUBMIT vs CLOSE ARE DIFFERENT GATES. Submit is blocked by a missing
 *    required answer, an unanswered meter pair and a fault with no remark.
 *    A fault ITSELF never blocks submit - a fault found on the last item of the
 *    day must still be recordable - it blocks CLOSING, which is what the
 *    approval trigger enforces server-side. The banner says exactly that.
 *
 * 5. THE 10-DAY RULE IS ADVISORY. An early visit warns and is never refused,
 *    and a lookup that fails says NOTHING, because "we could not look" is not
 *    "it is not due".
 *
 * 6. THE DOCUMENT NUMBER IS MINTED SERVER-SIDE. The screen shows the prefix and
 *    says the reference is assigned on submit. It never invents one.
 *
 * INHERITED FIXES THAT MUST NOT REGRESS: signatures are a MAP keyed by field id
 * (one shared slot let three trades overwrite each other); `require_signature`
 * is satisfiable through a template-level pad; `load` depends only on the
 * primitives it reads, so an unrelated profiles write can no longer wipe the
 * answers mid-fill; content goes through checklistI18n and THE STORED ANSWER IS
 * ALWAYS THE ENGLISH VALUE, whatever language it was read in.
 */
import { useEffect, useState, useCallback, useMemo, useRef, memo } from 'react'
import {
  View, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Text,
  AppState, AppStateStatus,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../../lib/theme'
import { AppText, Screen, Badge, EmptyState, ErrorState, Loading } from '../../../components/ui'
import ChecklistItemSheet from '../../../components/ChecklistItemSheet'
import SignaturePad from '../../../components/SignaturePad'
import PhotoCapture from '../../../components/PhotoCapture'
import { withModuleGuard } from '../../../components/ModuleGuard'
import { getTemplate, submitChecklist, getLastSubmission, ChecklistTemplate } from '../../../lib/checklists'
import { lookupAssetByCode, AssetLookupRecord } from '../../../lib/assetLookup'
import { supabase } from '../../../lib/supabase'
import { escapeLike, orIlike } from '../../../lib/queryFilters'
import { toUserMessage } from '../../../lib/safeError'
import { backTo } from '../../../lib/goBack'
import {
  ChecklistField, Signatures, blankAnswer, isValueField, visibleChecklistFields,
  validateSubmission, computeScore, isAutoField, resolveAutoValue,
  isFieldAnswered, fieldSummaryText, signatureFields, meterRegression,
  requiresPrimarySignature, primarySignatureSatisfied,
} from '../../../lib/checklistFields'
import {
  autoFillAnswers, blockingAnswers, fieldOptionSet, isFieldLocked, markMeta, MARK_ICONS,
  FieldLike as MarkField, MarkInfo, MarkTone, missingNotes, noteRequiredMarks,
  recurrenceNotice, TemplateLike, unsatisfiedGroups,
} from '../../../lib/checklistMarks'
import {
  CHECKLIST_LANGS, DEFAULT_LANG, FieldOption, fieldLabel, fieldOptions,
  fieldOptionValues, langDir, optionLabel, templateLangs, templateName,
} from '../../../lib/checklistI18n'
import { resolveChecklistIcon } from '../../../lib/checklistIcons'
import {
  ChecklistDraft, DraftInput, discardDraft, draftAge, draftKey, getDraft,
  resumeCandidates, saveDraft, loadDrafts,
} from '../../../lib/checklistDraft'

type IconName = keyof typeof Ionicons.glyphMap

/** Shared empty array so a row's `photos` prop keeps a stable identity and the
 *  memoised row does not re-render on every keystroke elsewhere on the sheet. */
const NO_PHOTOS: string[] = []

/**
 * The marks engine models a field structurally and types `options_ref` as
 * `string | undefined`, while the template's own type allows an explicit null.
 * The two describe the same object; this is the one place that says so, rather
 * than an `as any` scattered across every call.
 */
const asMarkField = (f: ChecklistField): MarkField => f as unknown as MarkField

function looksLikeMissingTable(msg: string): boolean {
  const m = (msg || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache')
}

// Compact search-first asset picker (mirrors the accident report pattern):
// nothing is listed until the operator types; results are plain text rows.
interface AssetSearchRow {
  id: string
  asset_no: string
  site: string | null
  vehicle_type: string | null
  fleet_number: string | null
}

// PostgREST or() filters break on commas/parens and ilike on unescaped %/_ -
// escapeLike strips them so a typed query is always a safe literal.
function sanitizeAssetQuery(raw: string): string {
  return escapeLike(raw ?? '').slice(0, 40)
}

// A friendly icon per field type, for the items that still open the sheet.
function fieldIcon(f: ChecklistField): IconName {
  switch (f.type) {
    case 'boolean': return 'checkmark-done-circle-outline'
    case 'select': return 'options-outline'
    case 'multiselect': return 'apps-outline'
    case 'rating': return 'star-outline'
    case 'number': return 'calculator-outline'
    case 'date': return 'calendar-outline'
    case 'textarea': return 'document-text-outline'
    case 'asset': return 'car-outline'
    case 'site': return 'business-outline'
    case 'user': return 'person-outline'
    case 'photo': return 'camera-outline'
    case 'signature': return 'create-outline'
    default: return 'create-outline'
  }
}

/**
 * Mark tone -> theme colour. The legend's tone token is the meaning ("this is
 * a fault", "this was put right"); the palette is the app's, so the marks stay
 * legible in dark mode and in direct sun instead of carrying frozen hexes.
 */
function toneColor(c: Theme['color'], tone: MarkTone): { fg: string; bg: string } {
  switch (tone) {
    case 'good':  return { fg: c.success.base, bg: c.success.soft }
    case 'bad':   return { fg: c.danger.base, bg: c.danger.soft }
    case 'fixed': return { fg: c.info.base, bg: c.info.soft }
    default:      return { fg: c.textMuted, bg: c.surfaceAlt }
  }
}

/**
 * The real Ionicons glyph for a mark. MarkInfo.icon is a TOKEN from the shared
 * vocabulary, never a glyph name - resolving it here is what keeps the phone
 * and the web drawing the same legend from one source.
 */
function markGlyph(info: MarkInfo | undefined): IconName {
  const key = info?.icon
  const hit = key ? MARK_ICONS[key] : undefined
  return (hit ? hit.ionicon : 'remove-circle-outline') as IconName
}

/** How a row is drawn. Everything except `tile` is recorded in place. */
type RowKind = 'marks' | 'choices' | 'text' | 'number' | 'tile'

/**
 * Everything about a row that depends only on the TEMPLATE and the reading
 * language, computed once. Keeping it out of the render path is what lets the
 * 31 check rows stay memoised while answers change.
 */
interface RowMeta {
  kind: RowKind
  label: string
  help: string
  options: FieldOption[]
  /** Mark info per ENGLISH option value (icon, tone, meaning). */
  marks: Record<string, MarkInfo>
  /** Marks that oblige a remark. */
  noteRequired: string[]
  /** Labels of the other fields that satisfy the same either-or group. */
  groupPeers: string[]
  unit: string
}

/* ─────────────────────────────────────────────────────────────────────────────
 * One checklist row.
 *
 * MEMOISED ON PURPOSE. The workshop sheet renders 49 rows at once; without this
 * every keystroke in one remarks box would re-render all of them. The props are
 * primitives plus stable callbacks and a per-template `meta`, so only the row
 * whose own answer, remark, photos or error changed does any work.
 * ────────────────────────────────────────────────────────────────────────── */
interface ItemRowProps {
  field: ChecklistField
  meta: RowMeta
  value: any
  note: string
  photos: string[]
  error?: string
  answered: boolean
  /** Locked = the register (or the clock) owns this value; show, do not edit. */
  locked: boolean
  lockReason: 'register' | 'auto' | 'picked' | ''
  /** readOnly field that the register could not fill, so it stays typeable. */
  registerBlank: boolean
  /** The register's previous meter reading, '' when there is none. */
  previousMeter: string
  meterWarn: boolean
  align: 'left' | 'right'
  rowReverse: boolean
  styles: ReturnType<typeof makeStyles>
  c: Theme['color']
  t: (k: string) => string
  onValue: (id: string, v: any) => void
  onPick: (id: string, v: any) => void
  onNote: (id: string, v: string) => void
  onPhotos: (id: string, urls: string[]) => void
  onOpenSheet: (id: string) => void
  onLayoutY: (id: string, y: number) => void
  summary: string
}

const ItemRow = memo(function ItemRow(p: ItemRowProps) {
  const { field, meta, styles, c, t, align, rowReverse } = p
  const stored = p.value == null ? '' : String(p.value)
  const chosen = meta.marks[stored]
  const noteIsRequired = !!stored && meta.noteRequired.includes(stored)
  const noteMissing = noteIsRequired && !String(p.note ?? '').trim()
  // Details (remark + photos) appear once there is something to say about the
  // line. Showing 31 empty photo grids at once is noise, not helpfulness.
  const showDetails =
    (field.allow_note || field.allow_photo) &&
    (p.answered || noteIsRequired || !!String(p.note ?? '').trim() || p.photos.length > 0)

  const title = (
    <AppText style={[typography.title, { textAlign: align }]} numberOfLines={3}>
      {meta.label || t('modules.checklistFill.itemFallback')}
      {field.required ? <AppText style={{ color: c.danger.base }}> *</AppText> : null}
    </AppText>
  )

  // ── Locked: the value is shown, never edited ───────────────────────────────
  if (p.locked) {
    return (
      <View
        style={[styles.lockedRow, rowReverse && styles.rowR]}
        onLayout={e => p.onLayoutY(field.id, e.nativeEvent.layout.y)}
      >
        <Ionicons name="lock-closed" size={16} color={c.textMuted} />
        <View style={{ flex: 1 }}>
          <AppText variant="label" color="secondary" style={{ textAlign: align }} numberOfLines={2}>
            {meta.label}
          </AppText>
          <AppText style={[typography.bodyStrong, { textAlign: align }]} numberOfLines={2}>
            {stored || '-'}
          </AppText>
          <AppText variant="caption" color="muted" style={{ textAlign: align, marginTop: 2 }}>
            {p.lockReason === 'picked'
              ? t('modules.checklistFill.fromAssetAbove')
              : p.lockReason === 'register'
                ? t('modules.checklistFill.fromRegister')
                : t('modules.checklistFill.setAutomatically')}
          </AppText>
        </View>
      </View>
    )
  }

  const body: React.ReactNode[] = []

  // ── Marks: the 8-icon legend, recorded in one tap ──────────────────────────
  if (meta.kind === 'marks' || meta.kind === 'choices') {
    body.push(
      <View key="opts" style={[styles.markRow, rowReverse && styles.rowWrapR]}>
        {meta.options.map(opt => {
          const info = meta.marks[opt.value]
          const active = stored === opt.value
          const tone = toneColor(c, info ? info.tone : 'muted')
          if (meta.kind === 'choices') {
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.choicePill, active && { backgroundColor: tone.bg, borderColor: tone.fg }]}
                onPress={() => p.onPick(field.id, active ? '' : opt.value)}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                accessibilityState={{ selected: active }}
                activeOpacity={0.8}
              >
                <Text style={[styles.choicePillText, active && { color: tone.fg }]} numberOfLines={1}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            )
          }
          return (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.markBtn,
                { backgroundColor: active ? tone.bg : c.surfaceAlt, borderColor: active ? tone.fg : c.border },
              ]}
              onPress={() => p.onPick(field.id, active ? '' : opt.value)}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected: active }}
              activeOpacity={0.8}
            >
              {/* MARK_ICONS[token].ionicon, NOT the token. `info.icon` is a
                  vocabulary key ('ok', 'repair', 'topup'); handing that
                  straight to Ionicons made every button on the sheet render a
                  "?" - and the `as IconName` cast is what stopped the
                  typechecker saying so.
                  The icon carries its tone ALWAYS - a green tick, a red
                  warning - so the operator can read the row at a glance
                  instead of only after tapping. Selection is shown by the
                  filled background and border. */}
              <Ionicons
                name={markGlyph(info)}
                size={24}
                color={tone.fg}
              />
              <Text
                style={[styles.markText, { color: active ? tone.fg : c.textSecondary }]}
                numberOfLines={2}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>,
    )
    // The meaning of the mark that was actually chosen. It comes from the
    // legend, so it is the same sentence the office sees on the web.
    if (chosen && chosen.meaning) {
      body.push(
        <View key="meaning" style={[styles.meaningRow, rowReverse && styles.rowR]}>
          <Ionicons name="information-circle-outline" size={14} color={c.textMuted} />
          <AppText variant="caption" color="secondary" style={{ flex: 1, textAlign: align }}>
            {chosen.meaning}
          </AppText>
        </View>,
      )
    }
  }

  // ── Typed answers, entered right here ──────────────────────────────────────
  if (meta.kind === 'text') {
    body.push(
      <TextInput
        key="text"
        style={[styles.input, meta.help ? null : { marginTop: 2 }, { textAlign: align },
          field.type === 'textarea' && styles.inputMultiline]}
        value={stored}
        onChangeText={v => p.onValue(field.id, v)}
        placeholder={p.registerBlank
          ? t('modules.checklistFill.typeFromMachine')
          : t('modules.checklistFill.enterText')}
        placeholderTextColor={c.textMuted}
        multiline={field.type === 'textarea'}
      />,
    )
  }

  if (meta.kind === 'number') {
    body.push(
      <View key="num" style={[styles.numRow, rowReverse && styles.rowR]}>
        <TextInput
          style={[styles.input, { flex: 1, textAlign: align }]}
          value={stored}
          onChangeText={v => p.onValue(field.id, v)}
          placeholder={t('modules.checklistFill.enterReading')}
          placeholderTextColor={c.textMuted}
          keyboardType="numeric"
        />
        {!!meta.unit && (
          <View style={styles.unitChip}>
            <AppText variant="caption" color="secondary">{meta.unit}</AppText>
          </View>
        )}
      </View>,
    )
    if (p.previousMeter) {
      body.push(
        <AppText key="prev" variant="caption" color="muted" style={{ textAlign: align, marginTop: 4 }}>
          {t('modules.checklistFill.lastRecorded')} {p.previousMeter}{meta.unit ? ` ${meta.unit}` : ''}
        </AppText>,
      )
    }
    // A meter can genuinely be replaced, so this warns and never refuses.
    if (p.meterWarn) {
      body.push(
        <View key="warn" style={[styles.warnRow, rowReverse && styles.rowR]}>
          <Ionicons name="alert-circle-outline" size={14} color={c.warning.base} />
          <AppText variant="caption" style={{ flex: 1, color: c.warning.on, textAlign: align }}>
            {t('modules.checklistFill.meterLower')}
          </AppText>
        </View>,
      )
    }
  }

  // ── Everything else keeps the tap-to-record sheet ──────────────────────────
  if (meta.kind === 'tile') {
    body.push(
      <TouchableOpacity
        key="tile"
        style={[styles.tileBtn, rowReverse && styles.rowR]}
        onPress={() => p.onOpenSheet(field.id)}
        activeOpacity={0.75}
        accessibilityRole="button"
      >
        <Ionicons name={fieldIcon(field)} size={20} color={p.answered ? c.primary : c.textMuted} />
        <AppText
          variant="body"
          color={p.answered ? 'text' : 'muted'}
          style={{ flex: 1, textAlign: align }}
          numberOfLines={2}
        >
          {p.summary || t('modules.checklistFill.tapToRecord')}
        </AppText>
        <Ionicons name={rowReverse ? 'chevron-back' : 'chevron-forward'} size={18} color={c.textMuted} />
      </TouchableOpacity>,
    )
  }

  return (
    <View
      style={[
        styles.itemCard,
        p.answered && { borderColor: c.borderStrong },
        (!!p.error || noteMissing) && { borderColor: c.danger.base },
      ]}
      onLayout={e => p.onLayoutY(field.id, e.nativeEvent.layout.y)}
    >
      <View style={[styles.itemHead, rowReverse && styles.rowR]}>
        <View style={{ flex: 1 }}>
          {title}
          {!!meta.help && (
            <AppText variant="caption" color="muted" style={{ textAlign: align, marginTop: 2 }} numberOfLines={2}>
              {meta.help}
            </AppText>
          )}
          {meta.groupPeers.length > 0 && (
            <AppText variant="caption" color="muted" style={{ textAlign: align, marginTop: 2 }}>
              {t('modules.checklistFill.eitherOr')} {meta.groupPeers.join(' / ')}
            </AppText>
          )}
        </View>
        {p.answered && <Ionicons name="checkmark-circle" size={20} color={c.success.base} />}
      </View>

      {body}

      {!!p.error && (
        <AppText variant="caption" style={{ color: c.danger.base, fontWeight: '700', textAlign: align, marginTop: 6 }}>
          {p.error}
        </AppText>
      )}

      {showDetails && (
        <View style={styles.detailBlock}>
          {field.allow_note && (
            <>
              <AppText
                variant="label"
                style={{ color: noteMissing ? c.danger.base : c.textSecondary, textAlign: align, marginBottom: 4 }}
              >
                {t('modules.checklistFill.remarks')}
                {noteIsRequired ? <AppText style={{ color: c.danger.base }}> *</AppText> : null}
              </AppText>
              <TextInput
                style={[styles.input, styles.inputMultiline, { textAlign: align },
                  noteMissing && { borderColor: c.danger.base }]}
                value={p.note}
                onChangeText={v => p.onNote(field.id, v)}
                placeholder={noteIsRequired
                  ? t('modules.checklistFill.remarkRequiredPh')
                  : t('modules.checklistFill.remarksPlaceholder')}
                placeholderTextColor={c.textMuted}
                multiline
              />
            </>
          )}
          {field.allow_photo && (
            <View style={{ marginTop: field.allow_note ? spacing.sm : 0 }}>
              <PhotoCapture
                value={p.photos}
                onChange={urls => p.onPhotos(field.id, urls)}
                module="checklist"
                tint={c.primary}
                max={4}
                label={t('modules.checklistFill.addPhoto')}
              />
            </View>
          )}
        </View>
      )}
    </View>
  )
})

export default withModuleGuard(ChecklistFillScreen, 'checklists')

function ChecklistFillScreen() {
  const { profile } = useAuth()
  const { t, isRTL, language } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const c = theme.color
  const router = useRouter()
  const params = useLocalSearchParams<{
    templateId?: string; assignment?: string; site?: string; asset_no?: string
    /** Draft key. Present only when the operator tapped Continue on an
     *  unfinished sheet, which is an explicit choice - so that sheet is
     *  restored straight away instead of being offered again. */
    resume?: string
  }>()
  const templateId = String(params.templateId ?? '')
  const assignmentId = params.assignment ? String(params.assignment) : null

  const [template, setTemplate] = useState<ChecklistTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notEnabled, setNotEnabled] = useState(false)

  const [title, setTitle] = useState('')
  const [site, setSite] = useState(params.site ? String(params.site) : '')
  const [assetNo, setAssetNo] = useState(params.asset_no ? String(params.asset_no) : '')
  /** The full register row behind the chosen asset. It is what fills the sheet
   *  and what a meter reading is compared against. */
  const [asset, setAsset] = useState<AssetLookupRecord | null>(null)
  const [assetLoading, setAssetLoading] = useState(false)
  const [assetQuery, setAssetQuery] = useState('')
  const [assetResults, setAssetResults] = useState<AssetSearchRow[]>([])
  const [assetSearching, setAssetSearching] = useState(false)
  const assetSearchStamp = useRef(0)
  /** Guards a late asset lookup landing under a different machine. */
  const assetApplyStamp = useRef(0)
  /** The asset whose register row has already been applied to this sheet. */
  const seededAssetRef = useRef('')
  const [recurrence, setRecurrence] = useState<ReturnType<typeof recurrenceNotice>>(null)

  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [photos, setPhotos] = useState<Record<string, string[]>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [printedName, setPrintedName] = useState('')
  // One signature PER FIELD. A shared slot is what let three trades overwrite
  // one another and made every signature tile read "done" after one signing.
  const [signatures, setSignatures] = useState<Signatures>({})
  // The template-level sign-off, separate from any field. This is the control
  // that makes `require_signature` satisfiable on a template that has no
  // signature field of its own.
  const [primarySignature, setPrimarySignature] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null)

  const textAlign = isRTL ? 'right' : 'left'

  // Only the primitives `load` actually reads. Depending on the profile OBJECT
  // is what made an unrelated profile write erase the operator's answers.
  const userName = profile?.full_name || profile?.username || ''
  const userCountry = profile?.country ?? null

  // Set the moment the operator records anything. A reload may then only ADD
  // newly-appeared fields; it may never re-seed over entered work.
  const dirtyRef = useRef(false)
  const markDirty = useCallback(() => { dirtyRef.current = true }, [])
  useEffect(() => { dirtyRef.current = false }, [templateId])

  // Scroll plumbing for "go to the next unanswered item".
  const scrollRef = useRef<ScrollView | null>(null)
  const rowY = useRef<Record<string, number>>({})
  const onLayoutY = useCallback((id: string, y: number) => { rowY.current[id] = y }, [])

  // Back = previous screen when there is history, else the checklists list.
  //
  // This USED to hand-roll the canGoBack/back/replace triple. It is routed
  // through the shared `backTo` helper now, because a second copy of the rule
  // is exactly how the two drift apart - and this screen is the one the owner
  // reported. `backTo` can never be a no-op, and the fallback names this
  // screen's REAL parent (the checklists list), not the Home hub.
  const goBack = useCallback(() => {
    backTo(router, '/(app)/checklists')
  }, [router])

  const load = useCallback(async () => {
    setLoadError(null)
    setNotEnabled(false)
    try {
      const tpl = await getTemplate(templateId)
      if (!tpl) { setTemplate(null); setLoading(false); return }
      setTemplate(tpl)
      setTitle(prev => (prev.trim() ? prev : (tpl.name ?? '')))
      const today = new Date().toISOString().slice(0, 10)
      const seed: Record<string, any> = {}
      for (const f of tpl.fields ?? []) {
        if (isValueField(f.type)) {
          seed[f.id] = isAutoField(f) ? resolveAutoValue(f, { userName, today }) : blankAnswer(f)
        }
      }
      // Never clobber work in progress: once anything has been recorded a
      // reload only fills in fields that did not exist before.
      setAnswers(prev => {
        if (!dirtyRef.current) return seed
        const merged = { ...prev }
        for (const [k, v] of Object.entries(seed)) {
          if (!(k in merged)) merged[k] = v
        }
        return merged
      })
    } catch (e: any) {
      const msg = toUserMessage(e, t('modules.checklistFill.loadError'))
      if (looksLikeMissingTable(msg)) setNotEnabled(true)
      else setLoadError(msg)
    } finally {
      setLoading(false)
    }
    // `t` is stable enough for a message fallback and is deliberately not a dep:
    // re-running the load on a language change would refetch for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, userName])

  useEffect(() => { load() }, [load])

  // ── Reading language ───────────────────────────────────────────────────────
  // Offer ONLY the languages this template really carries; a picker whose every
  // option renders English is a lie. Default to the app language when the
  // template has it, then leave the operator's explicit choice alone.
  const offeredLangCodes = useMemo(
    () => (template ? templateLangs(template) : [DEFAULT_LANG]),
    [template],
  )
  const offeredKey = offeredLangCodes.join(',')
  const offeredLangs = useMemo(
    () => CHECKLIST_LANGS.filter(l => offeredLangCodes.includes(l.code)),
    [offeredKey], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const [readLang, setReadLang] = useState<string>(DEFAULT_LANG)
  const langInitRef = useRef<string>('')
  useEffect(() => {
    const key = `${templateId}|${offeredKey}`
    if (langInitRef.current === key) return
    langInitRef.current = key
    setReadLang(offeredLangCodes.includes(language) ? language : DEFAULT_LANG)
  }, [templateId, offeredKey, language, offeredLangCodes])

  const contentAlign: 'left' | 'right' = langDir(readLang) === 'rtl' ? 'right' : 'left'
  const contentRowReverse = langDir(readLang) === 'rtl'

  /** The template as the marks engine sees it (its option_sets may be null). */
  const markTemplate = template as unknown as TemplateLike

  // Translated label / resolved English option values, threaded into validation
  // so a message names the line as the reader sees it and a valid answer is
  // never rejected against the field's stale option copy.
  const labelFor = useCallback(
    (f: ChecklistField) => fieldLabel(f, readLang) || String(f.label ?? ''),
    [readLang],
  )
  const optionsFor = useCallback(
    (f: ChecklistField) => fieldOptionValues(f, template),
    [template],
  )

  /**
   * Per-row presentation, computed once per template + reading language. This
   * is what keeps 49 memoised rows cheap: nothing in here changes when an
   * answer does.
   */
  const rowMeta = useMemo(() => {
    const map = new Map<string, RowMeta>()
    const fields = template?.fields ?? []
    // Labels of every field in each either-or group, so a row can name its peer.
    const groups = new Map<string, ChecklistField[]>()
    for (const f of fields) {
      if (f?.group_require_one) {
        const g = groups.get(f.group_require_one) ?? []
        g.push(f)
        groups.set(f.group_require_one, g)
      }
    }
    for (const f of fields) {
      if (!f || f.type === 'section') continue
      const opts = fieldOptions(f, template, readLang)
      const set = fieldOptionSet(markTemplate, asMarkField(f))
      const marks: Record<string, MarkInfo> = {}
      let anyKnown = false
      for (const o of opts) {
        const info = markMeta(set, o.value)
        marks[o.value] = info
        if (info.known) anyKnown = true
      }
      let kind: RowKind = 'tile'
      if ((f.type === 'select' || f.type === 'multiselect') && opts.length) {
        // multiselect keeps the sheet: a single tap here would replace, not add.
        kind = f.type === 'select' ? (anyKnown ? 'marks' : 'choices') : 'tile'
      } else if (f.type === 'number') kind = 'number'
      else if (f.type === 'text' || f.type === 'textarea') kind = 'text'

      const peers = f.group_require_one
        ? (groups.get(f.group_require_one) ?? [])
            .filter(x => x.id !== f.id)
            .map(x => fieldLabel(x, readLang) || String(x.label ?? x.id))
        : []

      map.set(f.id, {
        kind,
        label: fieldLabel(f, readLang) || String(f.label ?? ''),
        help: String(f.help ?? ''),
        options: opts,
        marks,
        noteRequired: Array.from(new Set([
          ...noteRequiredMarks(set),
          ...(Array.isArray(f.require_note_when) ? f.require_note_when.map(String) : []),
        ])),
        groupPeers: peers,
        unit: String(f.unit ?? ''),
      })
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, readLang])

  const clearError = useCallback((id: string) => {
    setErrors(prev => (prev[id] ? { ...prev, [id]: '' } : prev))
  }, [])

  const setAnswer = useCallback((id: string, value: any) => {
    markDirty()
    setAnswers(prev => ({ ...prev, [id]: value }))
    clearError(id)
  }, [markDirty, clearError])

  const setFieldPhotos = useCallback((id: string, urls: string[]) => {
    markDirty()
    setPhotos(prev => ({ ...prev, [id]: urls }))
    clearError(id)
  }, [markDirty, clearError])

  const setFieldNote = useCallback((id: string, text: string) => {
    markDirty()
    setNotes(prev => ({ ...prev, [id]: text }))
    clearError(id)
  }, [markDirty, clearError])

  // A field signature lands under ITS OWN id; clearing removes the key so
  // "signed" and "not signed" stay distinguishable.
  const setFieldSignature = useCallback((id: string, svg: string | null) => {
    markDirty()
    setSignatures(prev => {
      if (svg) return { ...prev, [id]: svg }
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    clearError(id)
  }, [markDirty, clearError])

  const setPrimary = useCallback((svg: string | null) => {
    markDirty()
    setPrimarySignature(svg)
  }, [markDirty])

  // Only currently-visible fields are rendered / validated / scored.
  const visibleFields = useMemo(
    () => visibleChecklistFields(template?.fields, answers),
    [template, answers],
  )

  const recordable = useMemo(
    () => visibleFields.filter(f => f.type !== 'section'),
    [visibleFields],
  )

  /**
   * Latest render state for the "move to the next unanswered item" jump.
   * Read from an event handler one tick after setState, so it is deliberately
   * one render behind - which is correct, because the jump always starts AFTER
   * the field just answered and no other field changed.
   */
  const jumpRef = useRef({ recordable, answers, photos, signatures })
  useEffect(() => {
    jumpRef.current = { recordable, answers, photos, signatures }
  }, [recordable, answers, photos, signatures])

  const scrollToField = useCallback((id: string) => {
    const y = rowY.current[id]
    if (typeof y !== 'number') return
    // A short delay lets a newly-revealed remarks box settle before we measure.
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true })
    }, 60)
  }, [])

  const firstUnansweredId = useCallback((afterId?: string) => {
    const s = jumpRef.current
    const start = afterId ? s.recordable.findIndex(f => f.id === afterId) + 1 : 0
    const hunt = (from: number, to: number) => {
      for (let i = from; i < to; i += 1) {
        const f = s.recordable[i]
        if (!f) continue
        if (f.id === afterId) continue
        if (isFieldLocked(asMarkField(f), s.answers[f.id])) continue
        if (!isFieldAnswered(f, s.answers, s.photos, s.signatures)) return f.id
      }
      return null
    }
    return hunt(start, s.recordable.length) ?? hunt(0, start)
  }, [])

  /**
   * A discrete choice (a mark). Records it and moves on, EXCEPT when the mark
   * obliges a remark - then the sheet stays put so the reason gets typed, which
   * is the whole point of the "Not OK" rule.
   */
  const pickAnswer = useCallback((id: string, value: any) => {
    setAnswer(id, value)
    const meta = rowMeta.get(id)
    const needsNote = !!value && !!meta && meta.noteRequired.includes(String(value))
    if (needsNote) { scrollToField(id); return }
    if (!value) return
    const next = firstUnansweredId(id)
    if (next) scrollToField(next)
  }, [setAnswer, rowMeta, scrollToField, firstUnansweredId])

  const goToNextUnanswered = useCallback(() => {
    const next = firstUnansweredId()
    if (next) scrollToField(next)
  }, [firstUnansweredId, scrollToField])

  const openSheet = useCallback((id: string) => setActiveFieldId(id), [])

  /**
   * Commit an asset: the register row fills the sheet, and the 10-day rule is
   * consulted. Both halves are best effort - an offline phone still fills the
   * sheet by hand, and a lookup that fails says NOTHING about the 10 days.
   */
  const applyAsset = useCallback(async (code: string, seedSite?: string | null) => {
    const clean = String(code ?? '').trim()
    if (!clean) return
    // Claim the guard here, not only in the effect: without this a pick from the
    // search list set assetNo, the effect saw an unseeded asset and ran the
    // whole lookup a second time.
    seededAssetRef.current = clean
    const stamp = ++assetApplyStamp.current
    setAssetNo(clean)
    setAssetQuery('')
    setAssetResults([])
    setRecurrence(null)
    if (seedSite) setSite(prev => (prev.trim() ? prev : seedSite))
    setAssetLoading(true)
    try {
      const row = await lookupAssetByCode(clean)
      if (assetApplyStamp.current !== stamp) return
      setAsset(row)
      if (row) {
        setSite(prev => (prev.trim() ? prev : (row.site ?? prev)))
        const tpl = template
        if (tpl) {
          markDirty()
          setAnswers(prev => {
            const patch = autoFillAnswers(tpl as unknown as TemplateLike, row, prev)
            return Object.keys(patch).length ? { ...prev, ...patch } : prev
          })
        }
      }
    } catch {
      if (assetApplyStamp.current === stamp) setAsset(null)
    } finally {
      if (assetApplyStamp.current === stamp) setAssetLoading(false)
    }

    // The 10-day rule. Advisory: it warns, it never refuses, and a null result
    // (including a failed lookup) says nothing at all.
    try {
      const last = await getLastSubmission(templateId, clean)
      if (assetApplyStamp.current !== stamp) return
      setRecurrence(recurrenceNotice(last, template?.min_interval_days))
    } catch {
      /* silence is correct: "we could not look" is not "it is not due" */
    }
  }, [template, templateId, markDirty])

  // An asset carried in from a scan, a link or an assignment fills the sheet
  // exactly as a picked one does.
  useEffect(() => {
    if (!template || !assetNo) return
    if (seededAssetRef.current === assetNo) return
    void applyAsset(assetNo)
  }, [template, assetNo, applyAsset])

  /**
   * THE ASSET IS PICKED IN ONE PLACE.
   *
   * The workshop sheet carries its own `asset` field AND this screen has a
   * picker in the header, so the operator saw the same question twice - which
   * is exactly what the owner asked to be removed. Worse, that field is
   * REQUIRED: a sheet filled entirely from the header picker failed validation
   * on a line the operator could see was already answered, with no way to tell
   * why. The header picker is now the single control and it writes through to
   * every asset field, which then renders locked.
   */
  useEffect(() => {
    if (!template) return
    const ids = (template.fields ?? []).filter(f => f?.type === 'asset').map(f => f.id)
    if (!ids.length) return
    setAnswers(prev => {
      let next = prev
      for (const id of ids) {
        if (String(prev[id] ?? '') === assetNo) continue
        if (next === prev) next = { ...prev }
        next[id] = assetNo
      }
      return next
    })
    if (assetNo) markDirty()
  }, [template, assetNo, markDirty])

  /**
   * SITE IS ASKED ONCE TOO, AND THE TEMPLATE DECIDES WHERE.
   *
   * Every published sheet carries its own site field - the workshop and mixer
   * sheets label it "Location" - while this screen also had a Site box in the
   * context card, so the same question was answered twice. The sheet's own
   * field is now the single control whenever the template has one, and the box
   * above is not rendered at all in that case.
   *
   * IT ONLY EVER FILLS A BLANK. A read-only site field is already owned by
   * autoFillAnswers (the register IS its source of truth); an editable one
   * belongs to whoever typed in it, and a site seeded from a link or an
   * assignment must never overwrite a correction made on the sheet itself.
   */
  const siteFieldIds = useMemo(
    () => (template?.fields ?? []).filter(f => f?.type === 'site').map(f => f.id),
    [template],
  )
  /** True when the sheet asks for the site itself, so the header must not. */
  const templateOwnsSite = siteFieldIds.length > 0

  useEffect(() => {
    if (!siteFieldIds.length) return
    const value = site.trim()
    if (!value) return
    setAnswers(prev => {
      let next = prev
      for (const id of siteFieldIds) {
        if (String(prev[id] ?? '').trim()) continue
        if (next === prev) next = { ...prev }
        next[id] = value
      }
      return next
    })
    markDirty()
  }, [siteFieldIds, site, markDirty])

  /**
   * The site actually recorded on the submission. When the sheet owns the
   * question its own answer is the truth - otherwise a site corrected on the
   * sheet would be filed under the stale header value.
   */
  const effectiveSite = useMemo(() => {
    for (const id of siteFieldIds) {
      const v = String(answers[id] ?? '').trim()
      if (v) return v
    }
    return site.trim()
  }, [siteFieldIds, answers, site])

  const clearAsset = useCallback(() => {
    assetApplyStamp.current += 1
    seededAssetRef.current = ''
    setAssetNo('')
    setAsset(null)
    setAssetQuery('')
    setAssetResults([])
    setRecurrence(null)
  }, [])

  // Debounced fleet search - runs only while no asset is selected and at least
  // 2 characters are typed. A stamp guards against stale responses landing late.
  useEffect(() => {
    if (assetNo) return
    const q = sanitizeAssetQuery(assetQuery)
    if (q.length < 2) {
      setAssetResults([])
      setAssetSearching(false)
      return
    }
    const searchOr = orIlike(['asset_no', 'fleet_number', 'vehicle_type'], q)
    if (!searchOr) {
      setAssetResults([])
      setAssetSearching(false)
      return
    }
    setAssetSearching(true)
    const stamp = ++assetSearchStamp.current
    const h = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('vehicle_fleet')
          .select('id, asset_no, site, vehicle_type, fleet_number')
          .or(searchOr)
          .order('asset_no')
          .limit(20)
        if (assetSearchStamp.current === stamp) setAssetResults((data as AssetSearchRow[]) ?? [])
      } catch (e: any) {
        if (__DEV__) console.warn('[checklist] asset search failed:', e?.message)
        if (assetSearchStamp.current === stamp) setAssetResults([])
      } finally {
        if (assetSearchStamp.current === stamp) setAssetSearching(false)
      }
    }, 350)
    return () => clearTimeout(h)
  }, [assetQuery, assetNo])

  // Progress across recordable (non-section) visible items.
  const { total, done } = useMemo(() => {
    const d = recordable.filter(f => isFieldAnswered(f, answers, photos, signatures)).length
    return { total: recordable.length, done: d }
  }, [recordable, answers, photos, signatures])

  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const remaining = Math.max(0, total - done)

  /* ── Resume: a sheet left half-filled is waiting when you come back ────────
   *
   * WHY THIS EXISTS. Everything recorded above lived only in React state, so a
   * backgrounded app reclaimed by Android, a flat battery or a crash took the
   * lot - 49 fields of work, with nothing left to show the operator had ever
   * started. The draft store is the memory that survives that.
   *
   * IT IS A DEVICE DRAFT, NEVER A ROW. Inserting a placeholder submission would
   * burn a document number on every abandoned fill (V594 mints it on INSERT
   * precisely so it cannot be burned at fill time) and leave permanent holes in
   * a numbered register. Nothing here touches the server.
   *
   * RESUMING IS OFFERED, NEVER FORCED, AND STARTING FRESH IS ALWAYS ONE TAP.
   */
  const userId = profile?.id ?? ''
  /** Unfinished sheets this operator could continue here. Empty = nothing to
   *  offer, which is a different thing from having not looked yet. */
  const [resumeOffer, setResumeOffer] = useState<ChecklistDraft[]>([])
  /** How many photos a restore could not bring back. Stated, never hidden: a
   *  dead path carried on would be submitted and reported as success. */
  const [restoredNotice, setRestoredNotice] = useState<{ dropped: number } | null>(null)
  /** Set once this sheet is submitted or deliberately started fresh; from then
   *  on autosave must not resurrect the draft it just cleared. */
  const draftClosedRef = useRef(false)
  /** The offer is answered ONCE per asset. Without this, dismissing it and then
   *  typing would put it straight back on screen. */
  const offerAnsweredRef = useRef<Set<string>>(new Set())
  const restoreStampRef = useRef('')
  /**
   * The key this sheet was last saved under.
   *
   * A draft is keyed by (user, template, ASSET), and the asset is very often
   * picked AFTER the operator has started recording - so the sheet legitimately
   * changes key mid-fill. Without this the earlier key would be left behind as
   * a second, permanently orphaned "unfinished sheet" for the same work.
   */
  const savedKeyRef = useRef('')

  /**
   * Everything worth restoring, in one object, so the autosave timer and the
   * backgrounding flush always write the CURRENT sheet rather than whatever was
   * current when their closure was created.
   *
   * Assigned during RENDER rather than in an effect on purpose: backgrounding
   * can arrive before an effect has run, and a flush that wrote the previous
   * render's state would quietly lose the last thing the operator recorded -
   * which is the exact moment this feature exists for.
   */
  const snapshotRef = useRef<DraftInput | null>(null)
  snapshotRef.current = {
    userId,
    templateId,
    templateName: template?.name ?? '',
    assetNo,
    assignmentId,
    site,
    title,
    readLang,
    answers, photos, notes, signatures, primarySignature,
    printedName,
    filled: done,
    total,
  }

  /** Restore a draft into the sheet. The asset lookup is deliberately left to
   *  re-run afterwards: it re-attaches the register row a meter reading is
   *  judged against, and autoFillAnswers only ever rewrites fields the register
   *  itself owns, so restored work is never overwritten. */
  const applyDraft = useCallback(async (key: string) => {
    let found: { draft: ChecklistDraft; droppedPhotos: number } | null = null
    try {
      found = await getDraft(key)
    } catch {
      /* a store we could not read is not a sheet we may overwrite - carry on
         with a blank fill and leave the draft exactly where it is */
    }
    if (!found) return false
    const d = found.draft
    // Dirty FIRST: a later load() retry must merge new fields in, never re-seed
    // over what was just restored.
    markDirty()
    setAnswers(prev => ({ ...prev, ...(d.answers ?? {}) }))
    setPhotos(d.photos ?? {})
    setNotes(d.notes ?? {})
    setSignatures(d.signatures ?? {})
    setPrimarySignature(d.primarySignature ?? null)
    setPrintedName(d.printedName ?? '')
    if (d.title) setTitle(d.title)
    if (d.site) setSite(d.site)
    if (d.readLang) { langInitRef.current = `${templateId}|restored`; setReadLang(d.readLang) }
    if (d.assetNo) setAssetNo(d.assetNo)
    setResumeOffer([])
    offerAnsweredRef.current.add(d.assetNo || '')
    setRestoredNotice({ dropped: found.droppedPhotos })
    savedKeyRef.current = d.key
    return true
  }, [markDirty, templateId])

  /**
   * Look for something to continue. Runs once the template is loaded and again
   * when the asset changes, because scanning the machine is exactly how an
   * operator finds the sheet they had already started on it.
   */
  useEffect(() => {
    if (!template || !userId || draftClosedRef.current) return
    const asset = assetNo.trim().toUpperCase()
    const stamp = `${templateId}|${asset}`
    if (restoreStampRef.current === stamp) return
    restoreStampRef.current = stamp
    let cancelled = false
    ;(async () => {
      // An explicit Continue from the list carries the key: restore it, do not
      // ask again.
      const wanted = params.resume ? String(params.resume) : ''
      if (wanted && !offerAnsweredRef.current.has(asset)) {
        const ok = await applyDraft(wanted)
        if (ok || cancelled) return
      }
      if (offerAnsweredRef.current.has(asset)) return
      const load = await loadDrafts()
      if (cancelled || !load.ok) return   // could not look: say nothing
      const found = resumeCandidates(load.drafts, { userId, templateId, assetNo: asset })
      // Never offer to resume a sheet the operator has already started typing
      // into: that would invite replacing live work with older work.
      if (dirtyRef.current && found.length) return
      if (found.length) setResumeOffer(found)
    })()
    return () => { cancelled = true }
  }, [template, userId, templateId, assetNo, params.resume, applyDraft])

  /** Start fresh. Destructive, so it is confirmed - and it clears the stored
   *  sheet outright rather than leaving a ghost that reappears tomorrow. */
  const startFresh = useCallback((d: ChecklistDraft) => {
    Alert.alert(
      t('modules.checklistDraft.startNewTitle'),
      t('modules.checklistDraft.startNewMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('modules.checklistDraft.startNewConfirm'),
          style: 'destructive',
          onPress: () => {
            offerAnsweredRef.current.add(d.assetNo || '')
            setResumeOffer(prev => prev.filter(x => x.key !== d.key))
            discardDraft(d.key).catch(() => {
              // A store we could not read keeps its draft. Better a sheet that
              // is offered once more than one deleted on a failed read.
            })
          },
        },
      ],
    )
  }, [t])

  /** "3 of 31 recorded". Concatenated, because mobile `t()` takes no variables. */
  const draftProgressLine = useCallback(
    (d: ChecklistDraft) => `${d.filled} ${t('modules.checklistFill.of')} ${d.total} ${t('modules.checklistFill.doneWord')}`,
    [t],
  )

  /** "2 h ago". An unparseable timestamp says nothing rather than "just now". */
  const draftAgeLine = useCallback((d: ChecklistDraft) => {
    const age = draftAge(d)
    if (age.unit === 'unknown') return ''
    if (age.unit === 'now') return t('modules.checklistDraft.justNow')
    if (age.unit === 'minutes') return `${age.value} ${t('modules.checklistDraft.minutesAgo')}`
    if (age.unit === 'hours') return `${age.value} ${t('modules.checklistDraft.hoursAgo')}`
    return `${age.value} ${t('modules.checklistDraft.daysAgo')}`
  }, [t])

  const dismissOffer = useCallback(() => {
    offerAnsweredRef.current.add(assetNo.trim().toUpperCase())
    setResumeOffer([])
  }, [assetNo])

  /**
   * Autosave.
   *
   * Debounced because every write goes to the Android Keystore over binder IPC
   * and hammering it on each keystroke is what caused the permanent-spinner
   * ANR this app has already been reported for. Nothing is written until the
   * operator has actually recorded something (dirtyRef), and a failure is
   * swallowed: a missed tick is a nuisance, an interrupted fill is not.
   */
  const flushDraft = useCallback(async () => {
    if (draftClosedRef.current) return
    if (!dirtyRef.current) return
    const snap = snapshotRef.current
    if (!snap?.userId || !snap?.templateId) return
    const key = draftKey(snap.userId, snap.templateId, snap.assetNo)
    try {
      await saveDraft(snap)
      // The sheet moved to a different key (the machine was picked, or
      // changed). Retire the old one AFTER the new one is safely stored, so an
      // interrupted migration leaves a duplicate rather than nothing.
      const previousKey = savedKeyRef.current
      savedKeyRef.current = key
      if (previousKey && previousKey !== key) {
        await discardDraft(previousKey).catch(() => {})
      }
    } catch {
      /* DraftStoreUnreadableError included: we do NOT write over a store we
         could not read. The sheet on screen is untouched and the next tick
         tries again. */
    }
  }, [])

  useEffect(() => {
    if (loading || submitting || draftClosedRef.current) return
    if (!dirtyRef.current) return
    const h = setTimeout(() => { void flushDraft() }, 1200)
    return () => clearTimeout(h)
  }, [answers, photos, notes, signatures, primarySignature, printedName,
      assetNo, site, title, readLang, loading, submitting, flushDraft])

  /** A phone killed from the recents list gives no other warning, so the sheet
   *  is written the moment the app goes to the background - not on a timer that
   *  may never fire. Unmounting is flushed for the same reason. */
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') void flushDraft()
    }
    const sub = AppState.addEventListener('change', onChange)
    return () => {
      sub.remove()
      void flushDraft()
    }
  }, [flushDraft])

  const activeField = useMemo(
    () => visibleFields.find(f => f.id === activeFieldId) ?? null,
    [visibleFields, activeFieldId],
  )

  const needsPrimary = requiresPrimarySignature(template)
  const primaryOk = primarySignatureSatisfied(template, signatures, primarySignature)
  // Which signature FIELD is currently covering the template requirement, so
  // the sign-off card can say so instead of demanding a redundant signature.
  const coveringSignature = useMemo(() => {
    if (!needsPrimary || primarySignature) return null
    const hit = signatureFields(template?.fields).find(f => !!signatures[f.id])
    return hit ? (fieldLabel(hit, readLang) || String(hit.label ?? '')) : null
  }, [needsPrimary, primarySignature, template, signatures, readLang])

  /**
   * The close gates, live. `blocking` does NOT stop a submission - it stops the
   * sheet being CLOSED, which is exactly what the approval trigger enforces. The
   * other two DO stop a submission, because a sheet with no meter reading and a
   * fault with no reason records nothing anyone can act on.
   */
  const blocking = useMemo(
    () => (template ? blockingAnswers(markTemplate, answers) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template, answers],
  )
  const openGroups = useMemo(
    () => (template ? unsatisfiedGroups(markTemplate, answers) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template, answers],
  )
  const openNotes = useMemo(
    () => (template ? missingNotes(markTemplate, answers, notes) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template, answers, notes],
  )

  /** A blocking mark named in the reader's language, for the banner. */
  const blockingLines = useMemo(
    () => blocking.map(b => rowMeta.get(b.id)?.label || b.label),
    [blocking, rowMeta],
  )

  /**
   * Tile summary in the reader's language, for the items that still open the
   * sheet. fieldSummaryText can only return the RAW stored value and a few
   * English words - and the stored value of a choice is deliberately English -
   * so the cases carrying vocabulary are localised here.
   */
  const summaryFor = useCallback((f: ChecklistField): string => {
    if (f.type === 'photo') {
      const n = photos[f.id]?.length ?? 0
      return n > 0 ? `${n} ${n === 1 ? t('modules.checklistFill.photo') : t('modules.checklistFill.photos')}` : ''
    }
    if (f.type === 'signature') return signatures[f.id] ? t('modules.checklistFill.signed') : ''
    const v = answers[f.id]
    if (v == null || v === '') return ''
    if (f.type === 'boolean') return v === true ? t('common.yes') : v === false ? t('common.no') : ''
    if (f.type === 'select') return optionLabel(f, template, v, readLang)
    if (f.type === 'multiselect') {
      const arr = Array.isArray(v) ? v : []
      return arr.length ? arr.map(x => optionLabel(f, template, x, readLang)).join(', ') : ''
    }
    return fieldSummaryText(f, answers, photos, signatures)
  }, [answers, photos, signatures, template, readLang, t])

  async function doSubmit() {
    if (!template) return
    const name = printedName.trim() || (profile?.full_name ?? '')

    const firstFieldSignature = signatureFields(template.fields)
      .map(f => signatures[f.id])
      .find(s => typeof s === 'string' && s) || null
    const primary = primarySignature || firstFieldSignature

    let score_pct: number | null = null
    let score_passed: boolean | null = null
    if (template.scored) {
      const s = computeScore(template.fields, answers, template.pass_threshold ?? null)
      score_pct = s.pct
      score_passed = s.passed
    }

    // Keep only real remarks, on lines that asked for one and are still
    // visible. A blank box is not an observation.
    const noteMap: Record<string, string> = {}
    for (const f of visibleFields) {
      if (!f?.allow_note) continue
      const text = String(notes[f.id] ?? '').trim()
      if (text) noteMap[f.id] = text
    }
    // Only signatures belonging to a field this template still has.
    const signatureMap: Signatures = {}
    for (const f of signatureFields(template.fields)) {
      const s = signatures[f.id]
      if (typeof s === 'string' && s) signatureMap[f.id] = s
    }

    setSubmitting(true)
    try {
      const payload = {
        template,
        answers,
        photos,
        notes: noteMap,
        // Every captured signature, keyed by field id. signature_data keeps its
        // meaning as the single primary sign-off, so every existing reader,
        // export and PDF is unchanged.
        signatures: signatureMap,
        printed_name: name || null,
        signature_data: primary,
        site: effectiveSite || null,
        asset_no: assetNo.trim() || null,
        title: title.trim() || template.name,
        country: userCountry,
        assignmentId: assignmentId || null,
        score_pct,
        score_passed,
      }
      const res = await submitChecklist(payload)

      // THE DRAFT IS CLEARED FOR AN OFFLINE SUBMIT TOO. The work now belongs to
      // the record queue, which took its own durable copy of every photo at
      // enqueue; a draft left behind would let the same sheet be filled in and
      // submitted a second time. Only a submit that THREW keeps its draft.
      draftClosedRef.current = true
      try {
        const current = draftKey(userId, templateId, assetNo)
        await discardDraft(current)
        // The sheet may still be stored under an earlier key if the machine was
        // picked after work began and the migration had not run yet.
        if (savedKeyRef.current && savedKeyRef.current !== current) {
          await discardDraft(savedKeyRef.current)
        }
      } catch {
        /* A store we could not read keeps the draft. Harmless: the queue
           already owns the submission, and the operator is told below. */
      }

      if (res.offline) {
        Alert.alert(t('modules.checklistFill.savedOnDevice'), t('modules.checklistFill.savedOnDeviceMsg'), [
          { text: t('common.ok'), onPress: goBack },
        ])
      } else {
        const scoreLine = template.scored && score_pct != null
          ? `\n\n${t('modules.checklistFill.scoreLabel')} ${score_pct}%${score_passed != null ? ` (${score_passed ? t('modules.checklistFill.passed') : t('modules.checklistFill.failed')})` : ''}`
          : ''
        Alert.alert(t('modules.checklistFill.submittedTitle'), `${t('modules.checklistFill.submittedMsg')}${scoreLine}`, [
          { text: t('common.done'), onPress: goBack },
        ])
      }
    } catch (e: any) {
      Alert.alert(t('modules.checklistFill.submitFailTitle'), toUserMessage(e, t('modules.checklistFill.submitFailMsg')))
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit() {
    if (!template || submitting) return

    // 1. Required answers, ranges and required signatures. A missing required
    //    signature names WHICH one instead of failing at a generic gate.
    const { valid, errors: errs } = validateSubmission(template.fields, answers, {
      signatures, labelFor, optionsFor,
    })
    if (!valid) {
      setErrors(errs)
      const firstId = Object.keys(errs)[0]
      if (firstId) scrollToField(firstId)
      Alert.alert(t('modules.checklistFill.reviewTitle'), errs[firstId] || t('modules.checklistFill.reviewMsg'))
      return
    }

    // 2. The meter pair. Either reading satisfies it; neither may be skipped.
    if (openGroups.length) {
      const names = openGroups
        .flatMap(g => g.fields.map(f => rowMeta.get(f.id)?.label || f.label))
        .join(' / ')
      const firstId = openGroups[0]?.fields?.[0]?.id
      if (firstId) scrollToField(firstId)
      setErrors({})
      Alert.alert(t('modules.checklistFill.meterNeededTitle'), `${t('modules.checklistFill.meterNeededMsg')} ${names}`)
      return
    }

    // 3. A fault with no reason records nothing anyone can act on.
    if (openNotes.length) {
      const errs2: Record<string, string> = {}
      for (const n of openNotes) {
        errs2[n.id] = t('modules.checklistFill.remarkRequiredErr')
      }
      setErrors(errs2)
      scrollToField(openNotes[0].id)
      const names = openNotes.map(n => rowMeta.get(n.id)?.label || n.label).join(', ')
      Alert.alert(t('modules.checklistFill.remarkNeededTitle'), `${t('modules.checklistFill.remarkNeededMsg')} ${names}`)
      return
    }

    setErrors({})

    // The template-level requirement is met by the sign-off pad OR by any
    // signature field: a sheet already carrying three trade signatures must not
    // demand a fourth.
    if (requiresPrimarySignature(template)) {
      if (!primarySignatureSatisfied(template, signatures, primarySignature)) {
        Alert.alert(t('modules.checklistFill.signatureRequired'), t('modules.checklistFill.signatureRequiredMsg'))
        return
      }
      if (!(printedName.trim() || (profile?.full_name ?? ''))) {
        Alert.alert(t('modules.checklistFill.nameRequired'), t('modules.checklistFill.nameRequiredMsg'))
        return
      }
    }

    // 4. Faults are recordable but not closeable. Confirmed, never refused: a
    //    fault found on the last item of the day must still reach the office.
    if (blocking.length) {
      Alert.alert(
        t('modules.checklistFill.faultsTitle'),
        `${t('modules.checklistFill.faultsSubmitMsg')}\n\n${blockingLines.join('\n')}`,
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('modules.checklistFill.submitAnyway'), onPress: () => { void doSubmit() } },
        ],
      )
      return
    }

    void doSubmit()
  }

  // ── Header (shared) ─────────────────────────────────────────────────────────
  // `checklist_templates.icon` holds an emoji, a foreign (lucide) component name
  // or nothing at all; handing any of the last two to Ionicons rendered a blank
  // square. resolveChecklistIcon always yields something drawable.
  const icon = resolveChecklistIcon(template ?? {})
  const header = (
    <View style={[styles.nav, isRTL && styles.rowR]}>
      <TouchableOpacity onPress={goBack} style={styles.navBack} accessibilityLabel={t('common.back')}>
        <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={c.text} />
      </TouchableOpacity>
      <View style={styles.navIcon}>
        {icon.kind === 'emoji'
          ? <Text style={styles.navEmoji}>{icon.emoji}</Text>
          : <Ionicons name={icon.ionicon as IconName} size={20} color={c.primary} />}
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="h3" style={{ textAlign }} numberOfLines={1}>
          {templateName(template, readLang) || template?.name || t('modules.checklists.checklistFallback')}
        </AppText>
        {!!template?.category && (
          <AppText variant="caption" color="muted" style={{ textAlign }} numberOfLines={1}>
            {template.category}
          </AppText>
        )}
      </View>
      {template?.scored && <Badge kind="success">{t('modules.checklists.scored')}</Badge>}
    </View>
  )

  // ── Loading / not-enabled / error / not-found ───────────────────────────────
  if (loading) {
    return <Screen>{header}<Loading /></Screen>
  }
  if (notEnabled) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="checkbox-outline"
          title={t('modules.checklists.notEnabledTitle')}
          message={t('modules.checklists.notEnabledMsg')}
        />
      </Screen>
    )
  }
  if (loadError) {
    return (
      <Screen>
        {header}
        <ErrorState message={loadError} onRetry={() => { setLoading(true); load() }} />
      </Screen>
    )
  }
  if (!template) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="help-circle-outline"
          title={t('modules.checklistFill.notFoundTitle')}
          message={t('modules.checklistFill.notFoundMsg')}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      {header}

      {/* Sticky progress + the jump to the next unrecorded item. */}
      <View style={styles.progressBar}>
        <View style={[styles.progressHead, isRTL && styles.rowR]}>
          <AppText variant="label" color="secondary">
            {done} {t('modules.checklistFill.of')} {total} {t('modules.checklistFill.doneWord')}
          </AppText>
          <AppText variant="label" style={{ color: pct === 100 ? c.success.base : c.textMuted }}>
            {pct}%
          </AppText>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: pct === 100 ? c.success.base : c.primary }]} />
        </View>
        {remaining > 0 ? (
          <TouchableOpacity
            style={[styles.nextBtn, isRTL && styles.rowR]}
            onPress={goToNextUnanswered}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-down-circle-outline" size={16} color={c.primaryDark} />
            <AppText variant="label" style={{ color: c.primaryDark }}>
              {t('modules.checklistFill.nextItem')} ({remaining})
            </AppText>
          </TouchableOpacity>
        ) : (
          <View style={[styles.nextBtnDone, isRTL && styles.rowR]}>
            <Ionicons name="checkmark-circle" size={16} color={c.success.base} />
            <AppText variant="label" style={{ color: c.success.base }}>
              {t('modules.checklistFill.allRecorded')}
            </AppText>
          </View>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Unfinished sheet ──────────────────────────────────────────────
            Offered, never forced. Continue restores everything that was
            recorded; Start new discards it and is confirmed first, because
            throwing away somebody's half-finished work is destructive. */}
        {resumeOffer.length > 0 && (
          <View style={[styles.noticeCard, { backgroundColor: c.info.soft, borderColor: c.info.base }]}>
            <View style={[styles.noticeHead, isRTL && styles.rowR]}>
              <Ionicons name="refresh-circle-outline" size={18} color={c.info.base} />
              <AppText variant="label" style={{ color: c.info.on, flex: 1, textAlign }}>
                {t('modules.checklistDraft.unfinishedTitle')}
              </AppText>
              <TouchableOpacity onPress={dismissOffer} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={18} color={c.info.on} />
              </TouchableOpacity>
            </View>
            <AppText variant="caption" style={{ color: c.info.on, textAlign, marginTop: 4 }}>
              {t('modules.checklistDraft.unfinishedMsg')}
            </AppText>
            {resumeOffer.map(d => (
              <View key={d.key} style={styles.resumeRow}>
                <View style={{ flex: 1 }}>
                  <AppText style={[typography.bodyStrong, { textAlign }]} numberOfLines={1}>
                    {d.assetNo || t('modules.checklistDraft.noAsset')}
                  </AppText>
                  <AppText variant="caption" color="muted" style={{ textAlign }}>
                    {draftProgressLine(d)}{'  '}{draftAgeLine(d)}
                  </AppText>
                </View>
                <TouchableOpacity
                  style={[styles.resumeBtn, { backgroundColor: c.primary }]}
                  onPress={() => { void applyDraft(d.key) }}
                  accessibilityRole="button"
                >
                  <AppText variant="label" style={{ color: c.onPrimary }}>
                    {t('modules.checklistDraft.continue')}
                  </AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.resumeBtnGhost}
                  onPress={() => startFresh(d)}
                  accessibilityRole="button"
                >
                  <AppText variant="label" style={{ color: c.textSecondary }}>
                    {t('modules.checklistDraft.startNew')}
                  </AppText>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* What a restore could NOT bring back. An OS cache purge can take a
            photo before the operator returns; carried on silently it would be
            submitted as a dead path and the sheet would report success. */}
        {!!restoredNotice && (
          <View
            style={[
              styles.noticeCard,
              restoredNotice.dropped > 0
                ? { backgroundColor: c.warning.soft, borderColor: c.warning.base }
                : { backgroundColor: c.success.soft, borderColor: c.success.base },
            ]}
          >
            <View style={[styles.noticeHead, isRTL && styles.rowR]}>
              <Ionicons
                name={restoredNotice.dropped > 0 ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                size={18}
                color={restoredNotice.dropped > 0 ? c.warning.base : c.success.base}
              />
              <AppText
                variant="label"
                style={{ flex: 1, textAlign, color: restoredNotice.dropped > 0 ? c.warning.on : c.success.on }}
              >
                {restoredNotice.dropped > 0
                  ? `${t('modules.checklistDraft.restoredPartial')} ${restoredNotice.dropped} ${t('modules.checklistDraft.photosLost')}`
                  : t('modules.checklistDraft.restoredOk')}
              </AppText>
              <TouchableOpacity onPress={() => setRestoredNotice(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons
                  name="close"
                  size={18}
                  color={restoredNotice.dropped > 0 ? c.warning.on : c.success.on}
                />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Reading language. Only languages this template really carries. */}
        {offeredLangs.length > 1 && (
          <View style={styles.card}>
            <View style={[styles.langHead, isRTL && styles.rowR]}>
              <Ionicons name="language-outline" size={16} color={c.textMuted} />
              <AppText variant="label" color="secondary">{t('modules.checklistFill.readingLanguage')}</AppText>
            </View>
            <View style={[styles.langRow, isRTL && styles.rowWrapR]}>
              {offeredLangs.map(l => {
                const active = readLang === l.code
                return (
                  <TouchableOpacity
                    key={l.code}
                    style={[styles.langPill, active && { backgroundColor: c.primary, borderColor: c.primary }]}
                    onPress={() => setReadLang(l.code)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.langPillText, active && { color: c.onPrimary }]}>{l.native}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            <AppText variant="caption" color="muted" style={{ marginTop: spacing.sm, textAlign }}>
              {t('modules.checklistFill.answersStayEnglish')}
            </AppText>
          </View>
        )}

        {/* Context: asset first (it fills the sheet), then title and site. */}
        <View style={styles.card}>
          <AppText variant="label" color="secondary" style={{ marginBottom: 6 }}>{t('modules.checklistFill.assetNo')}</AppText>
          {assetNo ? (
            <View style={[styles.assetChip, isRTL && styles.rowR]}>
              <View style={{ flex: 1 }}>
                <AppText style={[typography.bodyStrong, { textAlign }]} numberOfLines={1}>{assetNo}</AppText>
                {!!(asset?.site || asset?.vehicle_type) && (
                  <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 1 }} numberOfLines={1}>
                    {[asset?.site, asset?.vehicle_type].filter(Boolean).join(' - ')}
                  </AppText>
                )}
              </View>
              {assetLoading && <ActivityIndicator size="small" color={c.primary} />}
              <TouchableOpacity
                onPress={clearAsset}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={t('modules.checklistFill.clearAsset')}
              >
                <Ionicons name="close-circle" size={20} color={c.textMuted} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <AppText variant="caption" color="muted" style={{ textAlign }}>
                {t('modules.checklistFill.assetFirst')}
              </AppText>
              <View style={[styles.assetSearchBox, isRTL && styles.rowR]}>
                <Ionicons name="search-outline" size={16} color={c.textMuted} />
                <TextInput
                  style={[styles.assetSearchInput, { textAlign }]}
                  value={assetQuery}
                  onChangeText={setAssetQuery}
                  placeholder={t('accident.report.phSearchVehicle')}
                  placeholderTextColor={c.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                {assetQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setAssetQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={16} color={c.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              {(() => {
                const typed = sanitizeAssetQuery(assetQuery)
                if (typed.length < 2) {
                  return (
                    <AppText variant="caption" color="muted" style={{ textAlign }}>
                      {t('checklists.assetSearchHint')}
                    </AppText>
                  )
                }
                if (assetSearching) {
                  return <ActivityIndicator size="small" color={c.primary} />
                }
                const exact = assetResults.some(r => r.asset_no?.toLowerCase() === typed.toLowerCase())
                return (
                  <View style={styles.assetResults}>
                    {assetResults.map(row => (
                      <TouchableOpacity
                        key={row.id}
                        style={[styles.assetRow, isRTL && styles.rowR]}
                        activeOpacity={0.7}
                        onPress={() => { void applyAsset(row.asset_no, row.site) }}
                      >
                        <AppText style={[typography.bodyStrong, { textAlign }]} numberOfLines={1}>{row.asset_no}</AppText>
                        {!!(row.site || row.vehicle_type) && (
                          <AppText variant="caption" color="muted" style={{ flexShrink: 1 }} numberOfLines={1}>
                            {[row.site, row.vehicle_type].filter(Boolean).join(' - ')}
                          </AppText>
                        )}
                      </TouchableOpacity>
                    ))}
                    {assetResults.length === 0 && (
                      <AppText variant="caption" color="muted" style={[{ textAlign }, styles.assetRowPad]}>
                        {t('inspection.vehicleNoMatch')}
                      </AppText>
                    )}
                    {!exact && (
                      <TouchableOpacity
                        style={[styles.assetRow, isRTL && styles.rowR]}
                        activeOpacity={0.7}
                        onPress={() => { void applyAsset(typed) }}
                      >
                        <AppText variant="caption" style={{ color: c.primaryDark, fontWeight: '700', textAlign }} numberOfLines={1}>
                          {t('checklists.useTypedAsset')} "{typed}"
                        </AppText>
                      </TouchableOpacity>
                    )}
                  </View>
                )
              })()}
            </View>
          )}

          {/* THE DOCUMENT NUMBER IS THE TITLE. It is minted server-side on
              insert, so a sheet that has a prefix already has its reference and
              a Title box beside it only invites a second, conflicting name for
              the same sheet. A template with no prefix keeps the box, because
              then there is nothing else the sheet can be called. */}
          {template.doc_prefix ? (
            <AppText variant="caption" color="muted" style={{ marginTop: spacing.md, textAlign }}>
              {t('modules.checklistFill.referenceLabel')}: {template.doc_prefix} - {t('modules.checklistFill.referenceHelp')}
            </AppText>
          ) : (
            <>
              <AppText variant="label" color="secondary" style={{ marginBottom: 6, marginTop: spacing.md }}>{t('modules.checklistFill.titleLabel')}</AppText>
              <TextInput
                style={[styles.input, { textAlign }]}
                value={title}
                onChangeText={setTitle}
                placeholder={template.name}
                placeholderTextColor={c.textMuted}
              />
            </>
          )}

          {/* Site: only when the sheet does not ask for it itself. When it does,
              the question lives on its own line further down and this box would
              be the duplicate the owner reported. */}
          {!templateOwnsSite && (
            <>
              <AppText variant="label" color="secondary" style={{ marginBottom: 6, marginTop: spacing.md }}>{t('modules.checklistFill.site')}</AppText>
              <TextInput
                style={[styles.input, { textAlign }]}
                value={site}
                onChangeText={setSite}
                placeholder={t('modules.checklistFill.site')}
                placeholderTextColor={c.textMuted}
              />
            </>
          )}
        </View>

        {/* The 10-day rule. Advisory: it warns, it never refuses. */}
        {!!recurrence && (
          <View style={[styles.noticeCard, { backgroundColor: c.warning.soft, borderColor: c.warning.base }]}>
            <View style={[styles.noticeHead, isRTL && styles.rowR]}>
              <Ionicons name="time-outline" size={18} color={c.warning.base} />
              <AppText variant="label" style={{ color: c.warning.on, flex: 1, textAlign }}>
                {t('modules.checklistFill.notDueTitle')}
              </AppText>
            </View>
            <AppText variant="caption" style={{ color: c.warning.on, textAlign, marginTop: 4 }}>
              {t('modules.checklistFill.lastChecked')} {recurrence.daysAgo} {t('modules.checklistFill.daysWord')}
              {recurrence.documentNo ? ` (${recurrence.documentNo})` : ''}
              {'. '}
              {t('modules.checklistFill.notDueFor')} {recurrence.dueInDays} {t('modules.checklistFill.daysWord2')}
              {'. '}
              {t('modules.checklistFill.notDueStillAllowed')}
            </AppText>
          </View>
        )}

        {/* Items */}
        {visibleFields.map(field => {
          if (field.type === 'section') {
            return (
              <View key={field.id} style={styles.section}>
                <AppText variant="h3" style={{ textAlign: contentAlign }}>
                  {fieldLabel(field, readLang) || t('modules.checklistFill.sectionFallback')}
                </AppText>
                {!!field.help && (
                  <AppText variant="caption" color="muted" style={{ textAlign: contentAlign, marginTop: 4 }}>{field.help}</AppText>
                )}
              </View>
            )
          }

          const meta = rowMeta.get(field.id)
          if (!meta) return null
          const value = answers[field.id]
          // An auto field (inspector name, today's date) locks too, but ONLY
          // once it actually resolved to something: locking an empty box is the
          // very failure this screen exists to avoid.
          const locked = isFieldLocked(asMarkField(field), value)
            || (isAutoField(field) && String(value ?? '').trim() !== '')
            || (field.type === 'asset' && String(value ?? '').trim() !== '')
          // The register owns a value iff the field says where it came from;
          // everything else that locks was set by the app (the sheet date).
          const lockReason: 'auto' | 'register' | 'picked' =
            field.type === 'asset' ? 'picked' : field.autoFrom ? 'register' : 'auto'
          // A readOnly field the register could NOT fill stays typeable: outside
          // KSA the fleet number and chassis are simply not recorded. Only claim
          // that once an asset was actually looked up - an offline lookup that
          // returned nothing is not evidence the register is empty.
          const registerBlank = !!field.readOnly && !locked && !!asset
          // Only the odometer has a register figure to compare against today.
          const previousMeter = field.compareTo === 'asset.current_km' && asset?.current_km != null
            ? String(asset.current_km)
            : ''
          const meterWarn = !!previousMeter && meterRegression(value, asset?.current_km)

          return (
            <ItemRow
              key={field.id}
              field={field}
              meta={meta}
              value={value}
              note={notes[field.id] ?? ''}
              photos={photos[field.id] ?? NO_PHOTOS}
              error={errors[field.id] || undefined}
              answered={isFieldAnswered(field, answers, photos, signatures)}
              locked={locked}
              lockReason={lockReason}
              registerBlank={registerBlank}
              previousMeter={previousMeter}
              meterWarn={meterWarn}
              align={contentAlign}
              rowReverse={contentRowReverse}
              styles={styles}
              c={c}
              t={t}
              onValue={setAnswer}
              onPick={pickAnswer}
              onNote={setFieldNote}
              onPhotos={setFieldPhotos}
              onOpenSheet={openSheet}
              onLayoutY={onLayoutY}
              summary={summaryFor(field)}
            />
          )
        })}

        {/* Template-level sign-off. Rendered only when the template asks for a
            signature; without it a `require_signature` template that has no
            signature FIELD could never be submitted at all. */}
        {needsPrimary && (
          <View style={styles.card}>
            <View style={[styles.langHead, isRTL && styles.rowR]}>
              <Ionicons name="create-outline" size={16} color={c.primary} />
              <AppText variant="label" color="secondary">
                {t('modules.checklistFill.signOff')}
                <AppText style={{ color: c.danger.base }}> *</AppText>
              </AppText>
            </View>
            {coveringSignature ? (
              <View style={[styles.coveredRow, isRTL && styles.rowR]}>
                <Ionicons name="checkmark-circle" size={16} color={c.success.base} />
                <AppText variant="caption" color="secondary" style={{ flex: 1, textAlign }}>
                  {t('modules.checklistFill.signOffCovered')} {coveringSignature}
                </AppText>
              </View>
            ) : null}
            <View style={{ marginTop: spacing.sm }}>
              <SignaturePad value={primarySignature} onChange={setPrimary} height={170} penColor={c.text} />
            </View>
            <AppText variant="label" color="secondary" style={{ marginBottom: 6, marginTop: spacing.md }}>
              {t('modules.checklistFill.printedName')}
            </AppText>
            <TextInput
              style={[styles.input, { textAlign }]}
              value={printedName}
              onChangeText={setPrintedName}
              placeholder={t('modules.checklistFill.printedNamePlaceholder')}
              placeholderTextColor={c.textMuted}
              autoCapitalize="words"
            />
            <AppText variant="caption" color="muted" style={{ marginTop: 6, textAlign }}>
              {coveringSignature
                ? t('modules.checklistFill.signOffOptionalHelp')
                : t('modules.checklistFill.signOffHelp')}
            </AppText>
          </View>
        )}

        {/* Faults recorded. SUBMIT is still allowed; CLOSING is not, and the
            approval trigger enforces exactly that server-side. */}
        {blocking.length > 0 && (
          <View style={[styles.noticeCard, { backgroundColor: c.danger.soft, borderColor: c.danger.base }]}>
            <View style={[styles.noticeHead, isRTL && styles.rowR]}>
              <Ionicons name="warning-outline" size={18} color={c.danger.base} />
              <AppText variant="label" style={{ color: c.danger.on, flex: 1, textAlign }}>
                {t('modules.checklistFill.faultsTitle')} ({blocking.length})
              </AppText>
            </View>
            <AppText variant="caption" style={{ color: c.danger.on, textAlign, marginTop: 4 }}>
              {t('modules.checklistFill.faultsBody')}
            </AppText>
            {blockingLines.map((line, i) => (
              <AppText
                key={`${line}-${i}`}
                variant="caption"
                style={{ color: c.danger.on, textAlign, marginTop: 2 }}
                numberOfLines={2}
              >
                {'- '}{line}
              </AppText>
            ))}
          </View>
        )}

        {/* Submit */}
        <View style={{ marginTop: spacing.sm }}>
          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.55 }]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.9}
          >
            <Ionicons name="cloud-upload-outline" size={19} color={c.onPrimary} />
            <AppText style={[typography.h3, { color: c.onPrimary }]}>
              {submitting ? t('modules.checklistFill.submitting') : t('modules.checklistFill.submitChecklist')}
            </AppText>
          </TouchableOpacity>
          {needsPrimary && !primaryOk && (
            <AppText variant="caption" color="muted" center style={{ marginTop: spacing.sm }}>
              {t('modules.checklistFill.signatureNeeded')}
            </AppText>
          )}
        </View>
      </ScrollView>

      {/* Tap-to-record popup, for the item types that are not recorded in place */}
      <ChecklistItemSheet
        visible={!!activeField}
        field={activeField}
        template={template}
        lang={readLang}
        value={activeField ? answers[activeField.id] : undefined}
        photos={activeField ? (photos[activeField.id] ?? NO_PHOTOS) : NO_PHOTOS}
        printedName={printedName}
        signature={activeField ? (signatures[activeField.id] ?? null) : null}
        note={activeField ? (notes[activeField.id] ?? '') : ''}
        country={userCountry}
        error={activeField ? errors[activeField.id] : undefined}
        onChange={v => {
          if (!activeField) return
          setAnswer(activeField.id, v)
          // The only way to reach an asset field is before one is chosen; adopt
          // it so the submission and the header agree on one machine.
          if (activeField.type === 'asset' && String(v ?? '').trim()) void applyAsset(String(v))
        }}
        onPhotos={urls => activeField && setFieldPhotos(activeField.id, urls)}
        onPrintedName={setPrintedName}
        onSignature={svg => activeField && setFieldSignature(activeField.id, svg)}
        onNote={text => activeField && setFieldNote(activeField.id, text)}
        onClose={() => setActiveFieldId(null)}
      />
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    rowWrapR: { flexDirection: 'row-reverse' },

    nav: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    },
    navBack: {
      width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.surface,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.border,
    },
    navIcon: {
      width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.primarySoft,
      alignItems: 'center', justifyContent: 'center',
    },
    navEmoji: { fontSize: 20, lineHeight: 24 },

    progressBar: {
      paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 6,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    track: { height: 8, borderRadius: 4, backgroundColor: c.surfaceSunken, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4 },
    nextBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      alignSelf: 'stretch', marginTop: 2,
      backgroundColor: c.primarySoft, borderRadius: radius.md, paddingVertical: 8,
    },
    nextBtnDone: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      alignSelf: 'stretch', marginTop: 2, paddingVertical: 8,
    },

    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md },

    card: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border,
    },
    input: {
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
      ...typography.body, color: c.text,
    },
    inputMultiline: { minHeight: 64, textAlignVertical: 'top' },

    // Reading-language switcher
    langHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
    langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    langPill: {
      paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md,
      borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt,
    },
    langPillText: { ...typography.bodyStrong, color: c.textSecondary },

    coveredRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.success.soft, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: 10,
    },

    // Compact search-first asset picker
    assetSearchBox: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, height: 46,
    },
    assetSearchInput: { flex: 1, ...typography.body, color: c.text, paddingVertical: 0 },
    assetResults: {
      borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
      backgroundColor: c.surface, overflow: 'hidden',
    },
    assetRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
      paddingHorizontal: spacing.md, paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    assetRowPad: { paddingHorizontal: spacing.md, paddingVertical: 11 },
    assetChip: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      alignSelf: 'stretch',
      backgroundColor: c.primarySoft, borderWidth: 1, borderColor: c.borderStrong,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
    },

    section: { marginTop: spacing.sm, paddingBottom: 2 },

    // Advisory / fault banners
    noticeCard: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.md },
    noticeHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },

    // Unfinished-sheet offer
    resumeRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginTop: spacing.sm, paddingTop: spacing.sm,
      borderTopWidth: 1, borderTopColor: c.border,
    },
    resumeBtn: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md },
    resumeBtnGhost: {
      paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md,
      borderWidth: 1, borderColor: c.border,
    },

    // One checklist item
    itemCard: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border, gap: spacing.sm,
    },
    itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    lockedRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surfaceAlt, borderRadius: radius.md, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
    },

    // The mark legend: big, gloved-hand targets.
    markRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    // Four marks per row on a small phone and four on a large one: a percentage
    // basis packs the eight-mark legend into exactly two rows at any width,
    // while minWidth keeps every target a real gloved-hand target.
    markBtn: {
      flexBasis: '22%', flexGrow: 1, minWidth: 64, minHeight: 68,
      borderRadius: radius.md, borderWidth: 1.5,
      alignItems: 'center', justifyContent: 'center', gap: 3,
      paddingHorizontal: 3, paddingVertical: 8,
    },
    markText: { fontSize: 9.5, lineHeight: 12, fontWeight: '700', textAlign: 'center' },
    meaningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },

    choicePill: {
      paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.md,
      borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surfaceAlt,
      minWidth: 96, alignItems: 'center',
    },
    choicePillText: { ...typography.bodyStrong, color: c.textSecondary },

    numRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    unitChip: {
      paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md,
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
    },
    warnRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },

    tileBtn: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surfaceAlt, borderRadius: radius.md,
      paddingHorizontal: spacing.md, minHeight: 52,
    },

    detailBlock: {
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
      paddingTop: spacing.sm, marginTop: 2,
    },

    submitBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.primary, borderRadius: radius.md, height: 56,
    },
  })
}
