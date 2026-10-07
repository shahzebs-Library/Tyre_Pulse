/**
 * Workshop Status - one vehicle: what the daily file says, plus the quick update
 * form a technician fills on the phone.
 *
 * The ONLY writer is workshop_status_update_record. We send just the changed
 * fields plus the record's updated_at EXACTLY as read; the server checks
 * permission, validates the vocabulary and stamps who/when. A stale updated_at
 * comes back as PT409 and the user is asked to reload - never a silent overwrite.
 *
 * The route param is usually a record id. A notification that names only the
 * asset may open `/(app)/workshop-status/<asset>`; when the param is not a uuid
 * it is treated as an asset number and resolved to its active record.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, ScrollView, StyleSheet, TouchableOpacity, TextInput, Modal, FlatList, Platform,
  Alert, KeyboardAvoidingView,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'

import { withModuleGuard } from '../../../components/ModuleGuard'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { Theme, spacing, radius } from '../../../lib/theme'
import {
  Screen, Card, AppText, Badge, Button, BackButton, Loading, ErrorState,
} from '../../../components/ui'
import {
  getRecord, findActiveByAsset, loadPermissions, updateRecord, listAssignablePeople,
  loadPeopleNames, WorkshopStatusError, Person,
} from '../../../lib/workshopStatus'
import {
  WorkshopRecord, WorkshopForm, WorkshopPerms, EditableField, formFromRecord, diffPatch,
  validateForm, daysDown, updatedToday, localDay, parseDay, FormError,
} from '../../../lib/workshopStatusView'
import {
  SELECTABLE_STAGES, DELAY_REASONS, PARTS_STATUSES, RELEASED_STAGE, needsDetailedReason, vocabKey,
} from '../../../lib/workshopStatusVocab'
import { toUserMessage } from '../../../lib/safeError'

export default withModuleGuard(WorkshopStatusDetailScreen, 'workshopStatus')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIST = '/(app)/workshop-status'

type VocabList = 'stages' | 'delayReasons' | 'partsStatuses'

const ERROR_KEY: Record<Exclude<FormError, null>, string> = {
  stage: 'modules.workshopStatus.errStage',
  delay: 'modules.workshopStatus.errDelay',
  parts: 'modules.workshopStatus.errParts',
  detailedReason: 'modules.workshopStatus.errDetailedReason',
  partDate: 'modules.workshopStatus.errDate',
  releaseDate: 'modules.workshopStatus.errDate',
}

function WorkshopStatusDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const s = useMemo(() => makeStyles(theme), [theme])

  const [record, setRecord] = useState<WorkshopRecord | null>(null)
  const [perms, setPerms] = useState<WorkshopPerms | null>(null)
  const [original, setOriginal] = useState<WorkshopForm | null>(null)
  const [form, setForm] = useState<WorkshopForm | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [people, setPeople] = useState<Person[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState(false)
  const seq = useRef(0)

  const vocabLabel = useCallback((list: VocabList, value: string) => {
    if (!value) return ''
    if (list === 'stages' && value === RELEASED_STAGE) return t('modules.workshopStatus.released')
    const k = `modules.workshopStatus.${list}.${vocabKey(value)}`
    const tr = t(k)
    return tr === k ? value : tr
  }, [t])

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    try {
      const raw = String(id || '').trim()
      const [p, rec] = await Promise.all([
        loadPermissions(),
        UUID_RE.test(raw) ? getRecord(raw) : findActiveByAsset(raw),
      ])
      if (my !== seq.current) return
      setPerms(p)
      if (!rec) { setNotFound(true); setRecord(null); return }
      setNotFound(false)
      const f = formFromRecord(rec)
      setRecord(rec)
      setOriginal(f)
      setForm(f)
      setError(null)
      setFormError(null)
      const n = await loadPeopleNames([rec.responsible_user_id, rec.supporting_user_id])
      if (my === seq.current) setNames(n)
    } catch (e: any) {
      if (my !== seq.current) return
      setError(toUserMessage(e, t('modules.workshopStatus.loadError')))
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [id, t])

  useEffect(() => { load() }, [load])

  // The people list is only needed by someone who may assign.
  useEffect(() => {
    if (!perms?.assign || people) return
    let live = true
    listAssignablePeople().then((p) => { if (live) setPeople(p) }).catch(() => { if (live) setPeople([]) })
    return () => { live = false }
  }, [perms?.assign, people])

  const set = (field: EditableField, value: string) => {
    setForm((f) => (f ? { ...f, [field]: value } : f))
    setFormError(null)
    setSavedNote(false)
  }

  const released = !!record && (!record.current_active || record.current_stage === RELEASED_STAGE)
  const canEdit = !!perms?.update && !released
  const canAssign = !!perms?.assign && !released

  const save = async () => {
    if (!record || !form || !original) return
    const invalid = validateForm(form)
    if (invalid) { setFormError(t(ERROR_KEY[invalid])); return }
    const patch = diffPatch(original, form, canAssign)
    if (Object.keys(patch).length === 0) { setFormError(t('modules.workshopStatus.nothingChanged')); return }
    setSaving(true)
    try {
      await updateRecord(record.id, patch, record.updated_at)
      setSavedNote(true)
      await load()
      setSavedNote(true)
    } catch (e: any) {
      if (e instanceof WorkshopStatusError && e.code === 'record_changed') {
        Alert.alert(
          t('modules.workshopStatus.staleTitle'),
          t('modules.workshopStatus.staleBody'),
          [{ text: t('modules.workshopStatus.reload'), onPress: () => { load() } }],
        )
      } else {
        setFormError(toUserMessage(e, t('modules.workshopStatus.saveError')))
      }
    } finally {
      setSaving(false)
    }
  }

  const header = (
    <View style={[s.header, isRTL && s.rowRtl]}>
      <BackButton fallback={LIST} />
      <View style={{ flex: 1 }}>
        <AppText variant="h2" align="start">{record?.asset_no || t('modules.workshopStatus.title')}</AppText>
        {record ? (
          <AppText variant="caption" color="secondary" align="start">
            {[record.site, record.country].filter(Boolean).join(' - ')}
          </AppText>
        ) : null}
      </View>
    </View>
  )

  if (loading && !record) return <Screen padded>{header}<Loading label={t('common.loading')} /></Screen>
  if (error && !record) return <Screen padded>{header}<ErrorState message={error} onRetry={load} /></Screen>
  if (notFound || !record || !form) {
    return (
      <Screen padded>
        {header}
        <ErrorState message={t('modules.workshopStatus.notFound')} onRetry={load} />
      </Screen>
    )
  }

  const days = daysDown(record)
  const personName = (pid: string) => (pid ? (names[pid] || people?.find((p) => p.id === pid)?.name || t('modules.workshopStatus.unknownPerson')) : '')
  const lastUpdate = record.last_manual_update_at
    ? `${record.last_updated_by_name || t('modules.workshopStatus.unknownPerson')} - ${new Date(record.last_manual_update_at).toLocaleString()}`
    : t('modules.workshopStatus.neverUpdated')

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {header}

          <Card style={s.card}>
            <View style={[s.factRow, isRTL && s.rowRtl]}>
              <Fact label={t('modules.workshopStatus.daysDown')} value={days == null ? '-' : String(days)} />
              <Fact label={t('modules.workshopStatus.oocSince')} value={record.ooc_since ? record.ooc_since.slice(0, 10) : '-'} />
            </View>
            {record.complaint ? (
              <View style={s.block}>
                <AppText variant="micro" color="muted" align="start">{t('modules.workshopStatus.complaint')}</AppText>
                <AppText variant="body" align="start">{record.complaint}</AppText>
              </View>
            ) : null}
            <View style={[s.badges, isRTL && s.rowRtl]}>
              {released
                ? <Badge kind="neutral" icon="exit-outline">{t('modules.workshopStatus.released')}</Badge>
                : updatedToday(record)
                  ? <Badge kind="success" icon="checkmark-circle-outline">{t('modules.workshopStatus.updatedToday')}</Badge>
                  : <Badge kind="warning" icon="time-outline">{t('modules.workshopStatus.notUpdatedToday')}</Badge>}
            </View>
            <AppText variant="caption" color="secondary" align="start" style={s.block}>
              {`${t('modules.workshopStatus.lastUpdate')}: ${lastUpdate}`}
            </AppText>
          </Card>

          {released ? (
            <AppText variant="body" color="secondary" align="start" style={s.note}>{t('modules.workshopStatus.releasedNote')}</AppText>
          ) : !perms?.update ? (
            <AppText variant="body" color="secondary" align="start" style={s.note}>{t('modules.workshopStatus.viewOnly')}</AppText>
          ) : null}

          <Card style={s.card}>
            <SectionTitle text={t('modules.workshopStatus.statusSection')} />
            <PickerField
              label={t('modules.workshopStatus.stage')} value={form.current_stage}
              display={(v) => vocabLabel('stages', v)} options={SELECTABLE_STAGES}
              onSelect={(v) => set('current_stage', v)} disabled={!canEdit}
            />
            <PickerField
              label={t('modules.workshopStatus.delayReason')} value={form.delay_reason}
              display={(v) => vocabLabel('delayReasons', v)} options={DELAY_REASONS}
              onSelect={(v) => set('delay_reason', v)} disabled={!canEdit} clearable
            />
            {needsDetailedReason(form.delay_reason) || form.detailed_reason ? (
              <TextField
                label={`${t('modules.workshopStatus.detailedReason')}${needsDetailedReason(form.delay_reason) ? ' *' : ''}`}
                value={form.detailed_reason} onChange={(v) => set('detailed_reason', v)} disabled={!canEdit} multiline
              />
            ) : null}
            <TextField label={t('modules.workshopStatus.blocker')} value={form.blocker} onChange={(v) => set('blocker', v)} disabled={!canEdit} />
          </Card>

          <Card style={s.card}>
            <SectionTitle text={t('modules.workshopStatus.workSection')} />
            <TextField label={t('modules.workshopStatus.workDone')} value={form.work_done} onChange={(v) => set('work_done', v)} disabled={!canEdit} multiline />
            <TextField label={t('modules.workshopStatus.actionTaken')} value={form.action_taken} onChange={(v) => set('action_taken', v)} disabled={!canEdit} multiline />
            <TextField label={t('modules.workshopStatus.nextAction')} value={form.next_action} onChange={(v) => set('next_action', v)} disabled={!canEdit} multiline />
          </Card>

          <Card style={s.card}>
            <SectionTitle text={t('modules.workshopStatus.partsSection')} />
            <PickerField
              label={t('modules.workshopStatus.partsStatus')} value={form.parts_status}
              display={(v) => vocabLabel('partsStatuses', v)} options={PARTS_STATUSES}
              onSelect={(v) => set('parts_status', v)} disabled={!canEdit} clearable
            />
            <View style={[s.factRow, isRTL && s.rowRtl]}>
              <View style={{ flex: 1 }}>
                <TextField label={t('modules.workshopStatus.mrNumber')} value={form.mr_number} onChange={(v) => set('mr_number', v)} disabled={!canEdit} />
              </View>
              <View style={{ flex: 1 }}>
                <TextField label={t('modules.workshopStatus.poNumber')} value={form.po_number} onChange={(v) => set('po_number', v)} disabled={!canEdit} />
              </View>
            </View>
            <DateField label={t('modules.workshopStatus.expectedPartDate')} value={form.expected_part_date} onChange={(v) => set('expected_part_date', v)} disabled={!canEdit} />
            <DateField label={t('modules.workshopStatus.expectedReleaseDate')} value={form.expected_release_date} onChange={(v) => set('expected_release_date', v)} disabled={!canEdit} />
          </Card>

          <Card style={s.card}>
            <SectionTitle text={t('modules.workshopStatus.peopleSection')} />
            {canAssign ? (
              <>
                <PersonField label={t('modules.workshopStatus.responsible')} value={form.responsible_user_id}
                  people={people} display={personName} onSelect={(v) => set('responsible_user_id', v)}
                  meId={user?.id ?? null} />
                <PersonField label={t('modules.workshopStatus.supporting')} value={form.supporting_user_id}
                  people={people} display={personName} onSelect={(v) => set('supporting_user_id', v)}
                  meId={user?.id ?? null} />
              </>
            ) : (
              <View style={s.block}>
                <ReadOnly label={t('modules.workshopStatus.responsible')} value={personName(form.responsible_user_id) || t('modules.workshopStatus.notAssigned')} />
                <ReadOnly label={t('modules.workshopStatus.supporting')} value={personName(form.supporting_user_id) || t('modules.workshopStatus.notAssigned')} />
              </View>
            )}
            <TextField label={t('modules.workshopStatus.remarks')} value={form.remarks} onChange={(v) => set('remarks', v)} disabled={!canEdit} multiline />
          </Card>

          {formError ? <AppText variant="bodyStrong" color="danger" align="start" style={s.note}>{formError}</AppText> : null}
          {savedNote && !formError ? <AppText variant="bodyStrong" color="success" align="start" style={s.note}>{t('modules.workshopStatus.saved')}</AppText> : null}

          {canEdit ? (
            <Button label={saving ? t('common.saving') : t('common.save')} icon="save-outline" onPress={save}
              loading={saving} disabled={saving} full size="lg" />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

// ── Small building blocks ─────────────────────────────────────────────────────

function SectionTitle({ text }: { text: string }) {
  return <AppText variant="label" color="muted" align="start" style={{ marginBottom: spacing.sm, textTransform: 'uppercase' }}>{text}</AppText>
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <AppText variant="micro" color="muted" align="start">{label}</AppText>
      <AppText variant="h3" align="start">{value}</AppText>
    </View>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="micro" color="muted" align="start">{label}</AppText>
      <AppText variant="body" align="start">{value}</AppText>
    </View>
  )
}

function TextField({ label, value, onChange, disabled, multiline }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean; multiline?: boolean
}) {
  const { theme } = useTheme()
  const { isRTL } = useLanguage()
  const c = theme.color
  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="micro" color="secondary" align="start" style={{ marginBottom: 4 }}>{label}</AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        multiline={multiline}
        accessibilityLabel={label}
        style={{
          minHeight: multiline ? 72 : 46, borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
          paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15,
          color: disabled ? c.textMuted : c.text, backgroundColor: disabled ? c.surfaceAlt : c.surface,
          textAlignVertical: multiline ? 'top' : 'center', textAlign: isRTL ? 'right' : 'left',
        }}
      />
    </View>
  )
}

function SelectBox({ label, text, placeholder, onPress, disabled, icon, onClear }: {
  label: string; text: string; placeholder: string; onPress: () => void; disabled?: boolean
  icon: React.ComponentProps<typeof Ionicons>['name']; onClear?: () => void
}) {
  const { theme } = useTheme()
  const { t } = useLanguage()
  const c = theme.color
  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="micro" color="secondary" align="start" style={{ marginBottom: 4 }}>{label}</AppText>
      <TouchableOpacity
        onPress={onPress} disabled={disabled} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={label}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46,
          borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: spacing.md,
          backgroundColor: disabled ? c.surfaceAlt : c.surface,
        }}
      >
        <Ionicons name={icon} size={16} color={c.textSecondary} />
        <AppText variant="body" style={{ flex: 1, color: text ? (disabled ? c.textMuted : c.text) : c.textMuted }} numberOfLines={1}>
          {text || placeholder}
        </AppText>
        {onClear && text && !disabled ? (
          <TouchableOpacity onPress={onClear} accessibilityLabel={t('common.clear')} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Ionicons name="close-circle" size={16} color={c.borderStrong} />
          </TouchableOpacity>
        ) : (
          !disabled ? <Ionicons name="chevron-down" size={16} color={c.textSecondary} /> : null
        )}
      </TouchableOpacity>
    </View>
  )
}

function OptionSheet({ visible, title, options, selected, display, onPick, onClose }: {
  visible: boolean; title: string; options: readonly string[]; selected: string
  display: (v: string) => string; onPick: (v: string) => void; onClose: () => void
}) {
  const { theme } = useTheme()
  const { t } = useLanguage()
  const c = theme.color
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} activeOpacity={1} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={{ maxHeight: '70%', backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: spacing['2xl'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg }}>
          <AppText variant="title" style={{ flex: 1 }} align="start">{title}</AppText>
          <TouchableOpacity onPress={onClose} accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={22} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        <FlatList
          data={options as string[]}
          keyExtractor={(o) => o}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => { onPick(item); onClose() }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 48, borderTopWidth: 1, borderTopColor: c.border }}
              accessibilityRole="button" accessibilityState={{ selected: item === selected }}
            >
              <AppText variant={item === selected ? 'bodyStrong' : 'body'} style={{ flex: 1 }} align="start">{display(item)}</AppText>
              {item === selected ? <Ionicons name="checkmark" size={18} color={c.primary} /> : null}
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  )
}

function PickerField({ label, value, options, display, onSelect, disabled, clearable }: {
  label: string; value: string; options: readonly string[]; display: (v: string) => string
  onSelect: (v: string) => void; disabled?: boolean; clearable?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <>
      <SelectBox label={label} text={value ? display(value) : ''} placeholder={t('modules.workshopStatus.choose')}
        onPress={() => setOpen(true)} disabled={disabled} icon="list-outline"
        onClear={clearable ? () => onSelect('') : undefined} />
      <OptionSheet visible={open} title={label} options={options} selected={value} display={display}
        onPick={onSelect} onClose={() => setOpen(false)} />
    </>
  )
}

function PersonField({ label, value, people, display, onSelect, meId }: {
  label: string; value: string; people: Person[] | null; display: (id: string) => string
  onSelect: (v: string) => void; meId: string | null
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  // "Me" first, so a technician can take a vehicle in one tap.
  const ids = useMemo(() => {
    const list = (people || []).map((p) => p.id)
    if (meId && list.includes(meId)) return [meId, ...list.filter((x) => x !== meId)]
    return list
  }, [people, meId])
  const nameOf = (id: string) => (people || []).find((p) => p.id === id)?.name || display(id)
  return (
    <>
      <SelectBox label={label} text={value ? display(value) : ''} placeholder={t('modules.workshopStatus.notAssigned')}
        onPress={() => setOpen(true)} disabled={!people} icon="person-outline" onClear={() => onSelect('')} />
      <OptionSheet visible={open} title={label} options={ids} selected={value}
        display={(id) => (id === meId ? `${nameOf(id)} (${t('modules.workshopStatus.me')})` : nameOf(id))}
        onPick={onSelect} onClose={() => setOpen(false)} />
    </>
  )
}

function DateField({ label, value, onChange, disabled }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean
}) {
  const { t } = useLanguage()
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const parsed = parseDay(value) ?? new Date()
  const onPicked = (event: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS !== 'ios') setOpen(false)
    if (event.type === 'set' && d) onChange(localDay(d))
  }
  return (
    <>
      <SelectBox label={label} text={value} placeholder="YYYY-MM-DD" onPress={() => setOpen(true)}
        disabled={disabled} icon="calendar-outline" onClear={() => onChange('')} />
      {open ? (
        <>
          <DateTimePicker value={parsed} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={onPicked} />
          {Platform.OS === 'ios' ? (
            <TouchableOpacity
              style={{ alignItems: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: theme.color.surfaceAlt, marginBottom: spacing.md }}
              onPress={() => { if (!value) onChange(localDay(parsed)); setOpen(false) }}
            >
              <AppText variant="bodyStrong" color="secondary">{t('common.done')}</AppText>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
    </>
  )
}

function makeStyles(_theme: Theme) {
  return StyleSheet.create({
    scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'] },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md },
    rowRtl: { flexDirection: 'row-reverse' },
    card: { marginBottom: spacing.md },
    factRow: { flexDirection: 'row', gap: spacing.md },
    block: { marginTop: spacing.md },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    note: { marginBottom: spacing.md },
  })
}
