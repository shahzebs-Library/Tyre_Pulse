/**
 * Workshop Status - PURE view logic for the mobile screens.
 *
 * No supabase / react-native imports, so the plain Node jest runner can test it.
 * The service (lib/workshopStatus.ts) does the I/O; the screens render.
 */
import {
  CURRENT_STAGES, DELAY_REASONS, PARTS_STATUSES, SELECTABLE_STAGES, needsDetailedReason,
} from './workshopStatusVocab'

export interface WorkshopRecord {
  id: string
  asset_no: string | null
  site: string | null
  country: string | null
  complaint: string | null
  current_stage: string | null
  delay_reason: string | null
  detailed_reason: string | null
  work_done: string | null
  action_taken: string | null
  next_action: string | null
  parts_status: string | null
  mr_number: string | null
  po_number: string | null
  responsible_user_id: string | null
  supporting_user_id: string | null
  expected_part_date: string | null
  expected_release_date: string | null
  blocker: string | null
  remarks: string | null
  current_active: boolean | null
  deleted_at: string | null
  ooc_since: string | null
  excel_down_days: number | null
  /** Kept as the EXACT server string - the RPC compares it for concurrency. */
  updated_at: string | null
  last_updated_by_name: string | null
  last_manual_update_at: string | null
  removed_at: string | null
}

/** The only fields the update RPC accepts. Who/when is stamped server-side. */
export const EDITABLE_FIELDS = [
  'current_stage', 'delay_reason', 'detailed_reason', 'work_done', 'action_taken',
  'next_action', 'parts_status', 'mr_number', 'po_number', 'responsible_user_id',
  'supporting_user_id', 'expected_part_date', 'expected_release_date', 'blocker', 'remarks',
] as const
export type EditableField = typeof EDITABLE_FIELDS[number]
export type WorkshopForm = Record<EditableField, string>

export const PEOPLE_FIELDS: readonly EditableField[] = ['responsible_user_id', 'supporting_user_id']

const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '')

/** YYYY-MM-DD of a Date in LOCAL time (toISOString would roll the day in UTC). */
export function localDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse a date-only 'YYYY-MM-DD' as a LOCAL date (new Date('2026-08-01') is UTC). */
export function parseDay(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Days the vehicle has been down. The daily file's own figure wins; otherwise
 * it is derived from "out of commission since". null when neither is known -
 * never 0, which would read as "just came in".
 */
export function daysDown(r: Pick<WorkshopRecord, 'excel_down_days' | 'ooc_since'>, now: Date = new Date()): number | null {
  if (typeof r.excel_down_days === 'number' && Number.isFinite(r.excel_down_days)) return r.excel_down_days
  const since = parseDay(r.ooc_since)
  if (!since) return null
  const today = parseDay(localDay(now))!
  const days = Math.round((today.getTime() - since.getTime()) / 86400000)
  return days < 0 ? 0 : days
}

/** True when somebody saved a manual update on this vehicle today (local day). */
export function updatedToday(r: Pick<WorkshopRecord, 'last_manual_update_at'>, now: Date = new Date()): boolean {
  if (blank(r.last_manual_update_at)) return false
  const d = new Date(String(r.last_manual_update_at))
  if (Number.isNaN(d.getTime())) return false
  return localDay(d) === localDay(now)
}

/** "Mine" = I am the responsible OR the supporting person. */
export function isMine(r: Pick<WorkshopRecord, 'responsible_user_id' | 'supporting_user_id'>, userId: string | null | undefined): boolean {
  if (!userId) return false
  return r.responsible_user_id === userId || r.supporting_user_id === userId
}

export function filterRecords(
  rows: WorkshopRecord[],
  { mine, userId, query }: { mine: boolean; userId?: string | null; query?: string },
): WorkshopRecord[] {
  const q = String(query || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (mine && !isMine(r, userId)) return false
    if (!q) return true
    return [r.asset_no, r.site, r.complaint, r.current_stage, r.delay_reason]
      .some((v) => String(v || '').toLowerCase().includes(q))
  })
}

/** Longest-down first, so the vehicles costing the most availability lead. */
export function sortByDaysDown(rows: WorkshopRecord[], now: Date = new Date()): WorkshopRecord[] {
  return [...rows].sort((a, b) => {
    const da = daysDown(a, now) ?? -1
    const db = daysDown(b, now) ?? -1
    if (db !== da) return db - da
    return String(a.asset_no || '').localeCompare(String(b.asset_no || ''))
  })
}

export function formFromRecord(r: WorkshopRecord): WorkshopForm {
  const out = {} as WorkshopForm
  for (const f of EDITABLE_FIELDS) {
    const v = (r as unknown as Record<string, unknown>)[f]
    out[f] = v == null ? '' : String(v)
  }
  // Date columns may arrive as full timestamps; the picker works on the day.
  out.expected_part_date = out.expected_part_date.slice(0, 10)
  out.expected_release_date = out.expected_release_date.slice(0, 10)
  return out
}

/**
 * Only the fields that changed, trimmed; a cleared field is sent as null.
 * People fields are only included when `canAssign` (the server refuses them
 * otherwise and the whole save would fail).
 */
export function diffPatch(original: WorkshopForm, form: WorkshopForm, canAssign: boolean): Record<string, string | null> {
  const patch: Record<string, string | null> = {}
  for (const f of EDITABLE_FIELDS) {
    if (!canAssign && PEOPLE_FIELDS.includes(f)) continue
    const before = String(original[f] ?? '').trim()
    const after = String(form[f] ?? '').trim()
    if (before === after) continue
    patch[f] = after === '' ? null : after
  }
  return patch
}

export type FormError = 'stage' | 'delay' | 'parts' | 'detailedReason' | 'partDate' | 'releaseDate' | null

/** Client-side check before the RPC. The server validates again. */
export function validateForm(form: WorkshopForm): FormError {
  const stage = form.current_stage.trim()
  if (stage && !SELECTABLE_STAGES.includes(stage) && !CURRENT_STAGES.includes(stage)) return 'stage'
  const delay = form.delay_reason.trim()
  if (delay && !DELAY_REASONS.includes(delay)) return 'delay'
  if (needsDetailedReason(delay) && blank(form.detailed_reason)) return 'detailedReason'
  const parts = form.parts_status.trim()
  if (parts && !PARTS_STATUSES.includes(parts)) return 'parts'
  if (form.expected_part_date.trim() && !parseDay(form.expected_part_date)) return 'partDate'
  if (form.expected_release_date.trim() && !parseDay(form.expected_release_date)) return 'releaseDate'
  return null
}

/** Permissions map from workshop_status_my_permissions(): FAILS CLOSED. */
export interface WorkshopPerms { view: boolean; update: boolean; assign: boolean }
export function shapePermissions(raw: unknown): WorkshopPerms {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return { view: obj.view === true, update: obj.update === true, assign: obj.assign === true }
}

/** True for the server's optimistic-concurrency refusal (stale updated_at). */
export function isStaleError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; message?: unknown; details?: unknown }
  if (e.code === 'PT409' || e.code === 'record_changed') return true
  const text = `${e.message ?? ''} ${e.details ?? ''}`
  return text.includes('record_changed')
}
