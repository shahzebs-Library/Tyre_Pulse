/**
 * Checklist fill & submit (visual, tap-to-record)
 *
 * Every checklist item is a big, iconic tile showing its live state (Pass /
 * Fail / a value or "Tap to record"). Tapping a tile opens ChecklistItemSheet -
 * a bottom sheet with large icon buttons - so a non-technical operator records
 * one item at a time with gloves in the sun. A sticky progress bar shows
 * "X of Y done". Fields whose `visibleWhen` condition isn't met are hidden and
 * recomputed live as answers change.
 *
 * FIVE REAL DEFECTS THIS SCREEN CARRIED, all now fixed here:
 *
 * 1. ONE SIGNATURE SLOT FOR EVERY SIGNATURE FIELD. The screen held a single
 *    `signatureData`, so a workshop sheet signed off by three trades kept only
 *    the last signature, every signature tile flipped to "done" the moment any
 *    one of them was signed, and the progress bar lied. Signatures are now a
 *    MAP keyed by field id (`signatures`), which is also what the helpers take.
 *
 * 2. `require_signature` WAS UNSATISFIABLE. The flag lives on the TEMPLATE but
 *    the only control that could set `signatureData` was a signature FIELD, so
 *    a template with the flag and no such field could be filled completely and
 *    never submitted - the footer hint pointed at a control that did not exist
 *    and the work was lost on back-out. There is now a template-level sign-off
 *    pad (`primarySignature`), rendered only when the template needs one, and
 *    the requirement is judged by `primarySignatureSatisfied` (that pad OR any
 *    signed signature field), exactly as the web does it.
 *
 * 3. REQUIRED SIGNATURE FIELDS WERE NEVER VALIDATED. `validateSubmission` now
 *    receives the map, so a missing one names WHICH signature is missing.
 *
 * 4. ANY `profiles` UPDATE MID-FILL WIPED EVERY ANSWER. `load` depended on the
 *    whole `profile` OBJECT, and AuthContext replaces that object on every
 *    realtime update of the user's own row (an admin editing their role or
 *    site, the language-preference write, the push-token write). A new object
 *    identity re-created `load`, re-fired the effect and re-seeded `answers`
 *    with blanks - with no spinner, because that path never set `loading`, and
 *    with photos/signatures left behind, so the operator was staring at a
 *    half-erased sheet. `load` now depends only on the primitives it reads, and
 *    a reload can never clobber answers already entered.
 *
 * 5. NO CONTENT TRANSLATION AND NO SHARED OPTION SETS. Labels and choices were
 *    rendered raw, and `options_ref` (the template's shared, live option list)
 *    was ignored in favour of the field's stale copy. Both now go through
 *    checklistI18n, and the operator can switch the reading language - but only
 *    to a language this template actually carries. THE STORED ANSWER IS ALWAYS
 *    THE ENGLISH OPTION VALUE, whatever language it was read in.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  View, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Text,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../../lib/theme'
import { AppText, Screen, Badge, EmptyState, ErrorState, Loading } from '../../../components/ui'
import ChecklistItemSheet, { optionTone } from '../../../components/ChecklistItemSheet'
import SignaturePad from '../../../components/SignaturePad'
import { getTemplate, submitChecklist, ChecklistTemplate } from '../../../lib/checklists'
import { supabase } from '../../../lib/supabase'
import { escapeLike, orIlike } from '../../../lib/queryFilters'
import { toUserMessage } from '../../../lib/safeError'
import {
  ChecklistField, Signatures, blankAnswer, isValueField, visibleChecklistFields,
  validateSubmission, computeScore, isAutoField, resolveAutoValue,
  isFieldAnswered, fieldSummaryText, signatureFields,
  requiresPrimarySignature, primarySignatureSatisfied,
} from '../../../lib/checklistFields'
import {
  CHECKLIST_LANGS, DEFAULT_LANG, fieldLabel, fieldOptionValues, langDir,
  optionLabel, templateLangs, templateName,
} from '../../../lib/checklistI18n'
import { resolveChecklistIcon } from '../../../lib/checklistIcons'

type IconName = keyof typeof Ionicons.glyphMap

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

// PostgREST or() filters break on commas/parens and ilike on unescaped %/_ —
// escapeLike strips them so a typed query is always a safe literal.
function sanitizeAssetQuery(raw: string): string {
  return escapeLike(raw ?? '').slice(0, 40)
}

// A friendly icon per field type for the tile.
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

import { withModuleGuard } from '../../../components/ModuleGuard'

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
  const [assetMeta, setAssetMeta] = useState<{ site?: string | null; vehicle_type?: string | null } | null>(null)
  const [assetQuery, setAssetQuery] = useState('')
  const [assetResults, setAssetResults] = useState<AssetSearchRow[]>([])
  const [assetSearching, setAssetSearching] = useState(false)
  const assetSearchStamp = useRef(0)
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

  // Back = previous screen when there is history, else the checklists list.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)/checklists')
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

  const contentAlign = langDir(readLang) === 'rtl' ? 'right' : 'left'
  const contentRowReverse = langDir(readLang) === 'rtl'

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
  }, [markDirty])

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

  // Debounced fleet search — runs only while no asset is selected and at least
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

  // Tap a result: commit the asset, remember its meta for the chip, and fill
  // the site only when the operator has not typed one (never overwrites).
  const selectAsset = useCallback((row: AssetSearchRow) => {
    setAssetNo(row.asset_no)
    setAssetMeta({ site: row.site, vehicle_type: row.vehicle_type })
    setSite(prev => (prev.trim() ? prev : (row.site ?? prev)))
    setAssetQuery('')
    setAssetResults([])
  }, [])

  const clearAsset = useCallback(() => {
    setAssetNo('')
    setAssetMeta(null)
    setAssetQuery('')
    setAssetResults([])
  }, [])

  // Only currently-visible fields are rendered / validated / scored.
  const visibleFields = useMemo(
    () => visibleChecklistFields(template?.fields, answers),
    [template, answers],
  )

  // Progress across recordable (non-section) visible items.
  const { total, done } = useMemo(() => {
    const items = visibleFields.filter(f => f.type !== 'section')
    const d = items.filter(f => isFieldAnswered(f, answers, photos, signatures)).length
    return { total: items.length, done: d }
  }, [visibleFields, answers, photos, signatures])

  const pct = total > 0 ? Math.round((done / total) * 100) : 0

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
   * Tile summary in the reader's language.
   *
   * fieldSummaryText is the shared helper, but it can only return the RAW
   * stored value and a few English words - and the stored value of a choice is
   * deliberately English. So the cases that carry vocabulary are localised here
   * and the helper is used for the plain text / number / date case it handles
   * correctly.
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

  async function handleSubmit() {
    if (!template || submitting) return

    // Signatures are validated with everything else now, so a missing required
    // signature names WHICH one instead of failing at the generic gate below.
    const { valid, errors: errs } = validateSubmission(template.fields, answers, {
      signatures, labelFor, optionsFor,
    })
    if (!valid) {
      setErrors(errs)
      const first = Object.values(errs)[0]
      Alert.alert(t('modules.checklistFill.reviewTitle'), first || t('modules.checklistFill.reviewMsg'))
      return
    }
    setErrors({})

    // The template-level requirement is met by the sign-off pad OR by any
    // signature field: a sheet already carrying three trade signatures must not
    // demand a fourth.
    const firstFieldSignature = signatureFields(template.fields)
      .map(f => signatures[f.id])
      .find(s => typeof s === 'string' && s) || null
    const primary = primarySignature || firstFieldSignature

    const name = printedName.trim() || (profile?.full_name ?? '')
    if (requiresPrimarySignature(template)) {
      if (!primarySignatureSatisfied(template, signatures, primarySignature)) {
        Alert.alert(t('modules.checklistFill.signatureRequired'), t('modules.checklistFill.signatureRequiredMsg'))
        return
      }
      if (!name) {
        Alert.alert(t('modules.checklistFill.nameRequired'), t('modules.checklistFill.nameRequiredMsg'))
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
        printed_name: printedName.trim() || (profile?.full_name ?? null),
        signature_data: primary,
        site: site.trim() || null,
        asset_no: assetNo.trim() || null,
        title: title.trim() || template.name,
        country: userCountry,
        assignmentId: assignmentId || null,
        score_pct,
        score_passed,
      }
      const res = await submitChecklist(payload)

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

      {/* Sticky progress */}
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
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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

        {/* Context: title / asset / site */}
        <View style={styles.card}>
          <AppText variant="label" color="secondary" style={{ marginBottom: 6 }}>{t('modules.checklistFill.titleLabel')}</AppText>
          <TextInput
            style={[styles.input, { textAlign }]}
            value={title}
            onChangeText={setTitle}
            placeholder={template.name}
            placeholderTextColor={c.textMuted}
          />
          {/* Asset - compact search-first picker (no tiles, no icons in rows) */}
          <AppText variant="label" color="secondary" style={{ marginBottom: 6, marginTop: spacing.md }}>{t('modules.checklistFill.assetNo')}</AppText>
          {assetNo ? (
            <View style={[styles.assetChip, isRTL && styles.rowR]}>
              <View style={{ flex: 1 }}>
                <AppText style={[typography.bodyStrong, { textAlign }]} numberOfLines={1}>{assetNo}</AppText>
                {!!(assetMeta?.site || assetMeta?.vehicle_type) && (
                  <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 1 }} numberOfLines={1}>
                    {[assetMeta?.site, assetMeta?.vehicle_type].filter(Boolean).join(' · ')}
                  </AppText>
                )}
              </View>
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
                        onPress={() => selectAsset(row)}
                      >
                        <AppText style={[typography.bodyStrong, { textAlign }]} numberOfLines={1}>{row.asset_no}</AppText>
                        {!!(row.site || row.vehicle_type) && (
                          <AppText variant="caption" color="muted" style={{ flexShrink: 1 }} numberOfLines={1}>
                            {[row.site, row.vehicle_type].filter(Boolean).join(' · ')}
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
                        onPress={() => { setAssetNo(typed); setAssetMeta(null); setAssetQuery(''); setAssetResults([]) }}
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

          {/* Site */}
          <AppText variant="label" color="secondary" style={{ marginBottom: 6, marginTop: spacing.md }}>{t('modules.checklistFill.site')}</AppText>
          <TextInput
            style={[styles.input, { textAlign }]}
            value={site}
            onChangeText={setSite}
            placeholder={t('modules.checklistFill.site')}
            placeholderTextColor={c.textMuted}
          />
        </View>

        {/* Item tiles + section headings */}
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

          const answered = isFieldAnswered(field, answers, photos, signatures)
          const summary = summaryFor(field)
          const locked = isAutoField(field)
          const err = errors[field.id]
          const noteText = String(notes[field.id] ?? '').trim()

          // Tile status pill tone: pass/fail from option semantics where
          // possible. Toned from the stored ENGLISH value, never a translation.
          let pillKind: 'success' | 'danger' | 'neutral' | 'info' = answered ? 'info' : 'neutral'
          if (answered) {
            if (field.type === 'boolean') pillKind = answers[field.id] === true ? 'success' : 'danger'
            else if (field.type === 'select') {
              const tone = optionTone(String(answers[field.id] ?? ''))
              pillKind = tone === 'pass' ? 'success' : tone === 'fail' ? 'danger' : tone === 'na' ? 'neutral' : 'info'
            }
          }
          const iconTint =
            pillKind === 'success' ? c.success.base
            : pillKind === 'danger' ? c.danger.base
            : answered ? c.primary : c.textMuted

          return (
            <TouchableOpacity
              key={field.id}
              style={[
                styles.tile,
                contentRowReverse && styles.rowR,
                answered && { borderColor: c.borderStrong },
                !!err && { borderColor: c.danger.base, backgroundColor: c.danger.soft },
              ]}
              activeOpacity={locked ? 1 : 0.75}
              onPress={() => setActiveFieldId(field.id)}
            >
              <View style={[styles.tileIcon, { backgroundColor: answered ? c.primarySoft : c.surfaceAlt }]}>
                <Ionicons name={locked ? 'lock-closed-outline' : fieldIcon(field)} size={22} color={iconTint} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={[typography.title, { textAlign: contentAlign }]} numberOfLines={2}>
                  {fieldLabel(field, readLang) || t('modules.checklistFill.itemFallback')}
                  {field.required ? <AppText style={{ color: c.danger.base }}> *</AppText> : null}
                </AppText>
                {!!err ? (
                  <AppText variant="caption" style={{ color: c.danger.base, textAlign: contentAlign, marginTop: 2, fontWeight: '700' }} numberOfLines={2}>
                    {err}
                  </AppText>
                ) : summary ? (
                  <AppText variant="caption" color="secondary" style={{ textAlign: contentAlign, marginTop: 2 }} numberOfLines={2}>
                    {summary}
                  </AppText>
                ) : field.help ? (
                  <AppText variant="caption" color="muted" style={{ textAlign: contentAlign, marginTop: 2 }} numberOfLines={2}>
                    {field.help}
                  </AppText>
                ) : (
                  <AppText variant="caption" color="muted" style={{ textAlign: contentAlign, marginTop: 2 }}>
                    {t('modules.checklistFill.tapToRecord')}
                  </AppText>
                )}
                {/* A recorded remark is the reason a line failed: show it on the
                    tile so it is not invisible until the sheet is reopened. */}
                {!!noteText && (
                  <View style={[styles.noteRow, contentRowReverse && styles.rowR]}>
                    <Ionicons name="chatbubble-ellipses-outline" size={12} color={c.textMuted} />
                    <AppText variant="caption" color="muted" style={{ flex: 1, textAlign: contentAlign }} numberOfLines={2}>
                      {noteText}
                    </AppText>
                  </View>
                )}
              </View>
              {answered ? (
                <Ionicons name="checkmark-circle" size={22} color={iconTint} />
              ) : (
                <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={c.textMuted} />
              )}
            </TouchableOpacity>
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

      {/* Tap-to-record popup */}
      <ChecklistItemSheet
        visible={!!activeField}
        field={activeField}
        template={template}
        lang={readLang}
        value={activeField ? answers[activeField.id] : undefined}
        photos={activeField ? (photos[activeField.id] ?? []) : []}
        printedName={printedName}
        signature={activeField ? (signatures[activeField.id] ?? null) : null}
        note={activeField ? (notes[activeField.id] ?? '') : ''}
        country={userCountry}
        error={activeField ? errors[activeField.id] : undefined}
        onChange={v => activeField && setAnswer(activeField.id, v)}
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

    tile: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
      minHeight: 72,
    },
    tileIcon: {
      width: 46, height: 46, borderRadius: radius.md,
      alignItems: 'center', justifyContent: 'center',
    },
    noteRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },

    submitBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.primary, borderRadius: radius.md, height: 56,
    },
  })
}
