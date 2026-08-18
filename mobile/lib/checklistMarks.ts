/**
 * checklistMarks - MOBILE MIRROR of src/lib/checklist/checklistMarks.js.
 *
 * A checklist item used to be answered from a flat list of six words with no
 * stated meaning, and "Not OK" carried no consequence: a sheet full of faults
 * could be signed off as complete. V595 gave the legend an icon per mark, a
 * plain-English meaning and a `blocking` list, and this is the single place
 * that reads them on the phone.
 *
 * THE ONE RULE WORTH REMEMBERING. A blocking mark stops the sheet being CLOSED,
 * never being SUBMITTED. A mechanic who finds a fault on the last item of the
 * day must still be able to record it and go home; what must not happen is that
 * fault being signed off as done. The database enforces the same split in
 * guard_checklist_approval_stages.
 *
 * CHANGE BOTH FILES TOGETHER. src/test/checklistMarks.test.js reads THIS file's
 * source and fails if the two drift.
 */

export interface MarkIcon { ionicon: string; tone: MarkTone }
export type MarkTone = 'good' | 'bad' | 'fixed' | 'muted'

/**
 * Icon per mark token. Every glyph verified against the INSTALLED Ionicons map,
 * never from memory - an invented name renders a blank square, which is exactly
 * the bug V591 had to fix on the checklist cards.
 */
export const MARK_ICONS: Record<string, MarkIcon> = {
  ok:        { ionicon: 'checkmark-circle-outline', tone: 'good' },
  fault:     { ionicon: 'warning-outline',          tone: 'bad' },
  na:        { ionicon: 'remove-circle-outline',    tone: 'muted' },
  swap:      { ionicon: 'swap-horizontal-outline',  tone: 'fixed' },
  repair:    { ionicon: 'construct-outline',        tone: 'fixed' },
  topup:     { ionicon: 'water-outline',            tone: 'fixed' },
  adjust:    { ionicon: 'options-outline',          tone: 'fixed' },
  lubricant: { ionicon: 'color-fill-outline',       tone: 'fixed' },
}

export const MARK_TONES: Record<MarkTone, { fg: string; bg: string }> = {
  good:  { fg: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
  bad:   { fg: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  fixed: { fg: '#2563eb', bg: 'rgba(37,99,235,0.12)' },
  muted: { fg: '#64748b', bg: 'rgba(100,116,139,0.12)' },
}

const DEFAULT_ICON = 'na'

function isMarkTone(v: unknown): v is MarkTone {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MARK_TONES, v)
}

export interface OptionSet {
  options?: string[]
  i18n?: Record<string, string[]>
  meta?: Array<{ value?: string; icon?: string; tone?: string; meaning?: string }>
  blocking?: string[]
  require_note?: string[]
}
export interface MarkInfo { value: string; icon: string; tone: MarkTone; meaning: string; known: boolean }
export interface FieldLike {
  id: string
  type?: string
  label?: string
  options?: string[]
  options_ref?: string
  allow_note?: boolean
  require_note_when?: string[]
  group_require_one?: string
  autoFrom?: string
  readOnly?: boolean
  locked?: boolean
}
export interface TemplateLike { fields?: FieldLike[]; option_sets?: Record<string, OptionSet> }
export interface AssetLike {
  site?: string | null
  fleet_number?: string | null
  registration_no?: string | null
  chassis_no?: string | null
  serial_no?: string | null
  current_km?: number | string | null
  vehicle_type?: string | null
  make?: string | null
  model?: string | null
}

/** The option set a field answers against: its shared ref, else its own copy. */
export function fieldOptionSet(template: TemplateLike | null | undefined, field: FieldLike | null | undefined): OptionSet | null {
  if (!field) return null
  const ref = field.options_ref
  const shared = ref ? template?.option_sets?.[ref] : null
  if (shared) return shared
  const own = Array.isArray(field.options) ? field.options : null
  return own ? { options: own } : null
}

function metaList(optionSet?: OptionSet | null) {
  const m = optionSet?.meta
  return Array.isArray(m) ? m : []
}

/**
 * Everything known about one mark. Always returns an object, never null: an
 * answer recorded before the meta existed, or a value somebody typed by hand,
 * must still render rather than crashing the row it sits on.
 */
export function markMeta(optionSet: OptionSet | null | undefined, value: unknown): MarkInfo {
  const v = String(value ?? '')
  const hit = metaList(optionSet).find((m) => String(m?.value ?? '') === v)
  const icon = hit?.icon && MARK_ICONS[hit.icon] ? hit.icon : DEFAULT_ICON
  return {
    value: v,
    icon,
    tone: isMarkTone(hit?.tone) ? hit!.tone as MarkTone : MARK_ICONS[icon].tone,
    meaning: hit?.meaning ? String(hit.meaning) : '',
    known: Boolean(hit),
  }
}

/** Marks that stop a sheet being closed. Empty when the legend declares none. */
export function blockingMarks(optionSet?: OptionSet | null): string[] {
  const b = optionSet?.blocking
  return Array.isArray(b) ? b.map((x) => String(x)) : []
}

/** Marks that must carry a remark, or the mark says nothing useful. */
export function noteRequiredMarks(optionSet?: OptionSet | null): string[] {
  const r = optionSet?.require_note
  if (Array.isArray(r)) return r.map((x) => String(x))
  return []
}

function answerableFields(template?: TemplateLike | null): FieldLike[] {
  const f = Array.isArray(template?.fields) ? template.fields : []
  return f.filter((x) => x && x.type !== 'section')
}

/**
 * Which answers still block a close. Returns the FIELDS, not just a boolean,
 * because "this sheet cannot be closed" is useless without saying which line.
 */
export function blockingAnswers(template: TemplateLike, answers: Record<string, any> = {}): Array<{ id: string; label: string; value: string }> {
  const out: Array<{ id: string; label: string; value: string }> = []
  for (const field of answerableFields(template)) {
    const set = fieldOptionSet(template, field)
    const blocking = blockingMarks(set)
    if (!blocking.length) continue
    const v = answers?.[field.id]
    const values = Array.isArray(v) ? v : [v]
    for (const one of values) {
      if (one != null && blocking.includes(String(one))) {
        out.push({ id: field.id, label: field.label ?? field.id, value: String(one) })
        break
      }
    }
  }
  return out
}

/**
 * Fields whose mark demands a remark and has none. `notes` is the submission's
 * per-field remark map.
 */
export function missingNotes(template: TemplateLike, answers: Record<string, any> = {}, notes: Record<string, any> = {}): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = []
  for (const field of answerableFields(template)) {
    if (field.allow_note === false) continue
    const set = fieldOptionSet(template, field)
    const needs = new Set([
      ...noteRequiredMarks(set),
      ...(Array.isArray(field.require_note_when) ? field.require_note_when.map(String) : []),
    ])
    if (!needs.size) continue
    const v = answers?.[field.id]
    const values = Array.isArray(v) ? v : [v]
    if (!values.some((one) => one != null && needs.has(String(one)))) continue
    const note = notes?.[field.id]
    if (!String(note ?? '').trim()) out.push({ id: field.id, label: field.label ?? field.id })
  }
  return out
}

/**
 * Meter groups. Km and hour meter are BOTH optional on their own but at least
 * one must be given, because 98 of 227 KSA transit mixers carry no odometer
 * reading at all while every one of them has engine hours - requiring km would
 * make the sheet unfillable for them, and requiring neither loses the reading.
 */
export function meterGroups(template: TemplateLike): Map<string, FieldLike[]> {
  const groups = new Map<string, FieldLike[]>()
  for (const field of answerableFields(template)) {
    const g = field.group_require_one
    if (!g) continue
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(field)
  }
  return groups
}

export function unsatisfiedGroups(template: TemplateLike, answers: Record<string, any> = {}): Array<{ group: string; fields: Array<{ id: string; label: string }> }> {
  const out: Array<{ group: string; fields: Array<{ id: string; label: string }> }> = []
  for (const [name, fields] of meterGroups(template)) {
    const any = fields.some((f) => {
      const v = answers?.[f.id]
      return v != null && String(v).trim() !== ''
    })
    if (!any) out.push({ group: name, fields: fields.map((f) => ({ id: f.id, label: f.label ?? f.id })) })
  }
  return out
}

/**
 * Can this sheet be CLOSED? Mirrors the database trigger's decision so the
 * screen can explain the refusal before the user hits it, rather than surfacing
 * a raw 22023 after they have signed.
 */
export function canClose(template: TemplateLike, answers: Record<string, any> = {}) {
  const blocking = blockingAnswers(template, answers)
  return { ok: blocking.length === 0, blocking }
}

/* -------------------------------------------------------------- auto-fill */

/**
 * What a field can be filled from. The token is stored on the field as
 * `autoFrom`, so adding a source is a template edit, not a code change - but a
 * token this map does not know resolves to nothing rather than to a guess.
 */
export const AUTO_FILL_SOURCES: Record<string, (a: AssetLike) => unknown> = {
  'asset.site':        (a) => a?.site,
  // The owner's rule: the registration number IS the fleet number. Prefer the
  // fleet number and fall back to the registration, so an asset carrying only
  // one of the two still fills.
  'asset.fleet_no':    (a) => a?.fleet_number || a?.registration_no,
  'asset.registration': (a) => a?.registration_no || a?.fleet_number,
  'asset.chassis_no':  (a) => a?.chassis_no || a?.serial_no,
  'asset.current_km':  (a) => a?.current_km,
  'asset.vehicle_type': (a) => a?.vehicle_type,
  'asset.make':        (a) => a?.make,
  'asset.model':       (a) => a?.model,
}

/** The value an asset supplies for a field, or '' when it supplies nothing. */
export function resolveAutoFill(field: FieldLike | null | undefined, asset: AssetLike | null | undefined): string {
  const token = field?.autoFrom
  if (!token || !asset) return ''
  const fn = AUTO_FILL_SOURCES[token]
  if (!fn) return ''
  const v = fn(asset)
  return v == null || String(v).trim() === '' ? '' : String(v).trim()
}

/**
 * READ-ONLY IS CONDITIONAL, and that is the whole point.
 *
 * fleet_number is populated on 398 of 1,030 KSA assets and on NONE of the 452
 * UAE or 135 Egypt ones; chassis likewise. A field that is read-only whatever
 * the register holds would therefore be permanently blank and unfillable for
 * most of the fleet - the man on the floor could see the machine's plate and
 * have nowhere to put it. So the field locks only once the register actually
 * supplied something.
 */
export function isFieldLocked(field: FieldLike | null | undefined, value: unknown): boolean {
  if (field?.locked) return true
  if (!field?.readOnly) return false
  return String(value ?? '').trim() !== ''
}

/**
 * Apply an asset to a template's answers. Returns ONLY the fields it filled, so
 * a caller merges rather than replacing - a value the user typed before picking
 * the asset is never silently overwritten by a blank.
 */
export function autoFillAnswers(template: TemplateLike, asset: AssetLike | null | undefined, current: Record<string, any> = {}): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const field of answerableFields(template)) {
    if (!field.autoFrom) continue
    const v = resolveAutoFill(field, asset)
    if (!v) continue
    const existing = String(current?.[field.id] ?? '').trim()
    // A read-only field always takes the register's value: that IS its source
    // of truth. An editable one only fills when the user has not typed already.
    if (field.readOnly || !existing) patch[field.id] = v
  }
  return patch
}

/* ------------------------------------------------------- the 10-day rule */

/**
 * Is this machine due? ADVISORY by design: it warns, it never refuses. A genuine
 * early inspection - a breakdown, a machine going out on hire - must still be
 * recordable, and the phone may be offline and unable to ask at all.
 */
export function recurrenceNotice(last: any, minIntervalDays: unknown) {
  const min = Number(minIntervalDays)
  if (!Number.isFinite(min) || min <= 0) return null
  if (!last || last.found !== true) return null
  const days = Number(last.days_ago)
  if (!Number.isFinite(days) || days >= min) return null
  return {
    early: true,
    daysAgo: days,
    minIntervalDays: min,
    dueInDays: Math.max(0, min - days),
    documentNo: last.document_no ?? null,
  }
}
