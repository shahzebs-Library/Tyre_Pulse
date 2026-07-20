/**
 * workshopApi - Workshop Live Control data layer (technician side).
 *
 * Reads (my jobs, my recent events) go direct to Supabase, scoped server-side by
 * org / country / site RLS and, for tech_activity_events, by "own rows only".
 * The WRITE (every activity tap + check in/out) routes through the typed,
 * offline-safe record queue (WORKSHOP_EVENT) so a tap with no signal is never
 * lost. Every read []-degrades on a missing relation so a not-yet-migrated
 * environment shows an honest empty state instead of crashing.
 */
import { supabase } from './supabase'
import { saveCommand } from './recordQueue'
import { uploadModulePhoto } from './photoUpload'
import { WorkshopEventType, WorkshopReason, WorkshopEventLike } from './workshopLive'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkshopJob {
  id: string
  work_order_no: string | null
  asset_no: string | null
  status: string | null
  priority: string | null
  target_completion: string | null
  site: string | null
  /** Assignment role (from wo_assignments), when the job came via an assignment. */
  role?: string | null
}

export interface WorkshopEvent extends WorkshopEventLike {
  id: string
  user_id: string | null
  job_id: string | null
  asset_no: string | null
  event_type: string
  reason_code: string | null
  note: string | null
  at: string | null
}

/** A task within a work order (wo_tasks) - splits a job into steps a
 * technician picks before starting / completing work. */
export interface WorkshopTask {
  id: string
  job_id: string | null
  seq: number | null
  title: string | null
  skill: string | null
  est_minutes: number | null
  status: string | null
  assignee_user_id: string | null
}

// Work-order statuses that are NOT open (nothing more for a technician to do).
const CLOSED_STATUSES = new Set([
  'completed', 'complete', 'closed', 'cancelled', 'canceled', 'done', 'rejected',
])

function isOpenJob(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  if (!s) return true // no status yet = still actionable
  return !CLOSED_STATUSES.has(s)
}

function mapWo(wo: any): WorkshopJob {
  return {
    id: wo.id,
    work_order_no: wo.work_order_no ?? null,
    asset_no: wo.asset_no ?? null,
    status: wo.status ?? null,
    priority: wo.priority ?? null,
    target_completion: wo.target_completion ?? null,
    site: wo.site ?? null,
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * The technician's OPEN jobs. Two honest sources, merged + de-duplicated:
 *   1. active `wo_assignments` for this user, joined to their work_orders.
 *   2. work_orders whose `assigned_owner_id` is this user (single-owner model).
 * Either source []-degrades independently, so a missing table / column never
 * breaks the screen. Only jobs with an open status are returned.
 */
export async function listMyJobs(userId: string): Promise<WorkshopJob[]> {
  if (!userId) return []
  const byId = new Map<string, WorkshopJob>()

  // 1. Assignment-based jobs (job_id -> work_orders embed).
  try {
    const { data, error } = await supabase
      .from('wo_assignments')
      .select('role, active, work_orders:job_id(id, work_order_no, asset_no, status, priority, target_completion, site)')
      .eq('user_id', userId)
      .eq('active', true)
    if (!error && Array.isArray(data)) {
      for (const row of data as any[]) {
        const wo = row.work_orders
        if (wo?.id) byId.set(wo.id, { ...mapWo(wo), role: row.role ?? null })
      }
    }
  } catch {
    /* []-degrade: table/relationship not present */
  }

  // 2. Single-owner jobs (assigned_owner_id). Best-effort; column may not exist.
  try {
    const { data, error } = await supabase
      .from('work_orders')
      .select('id, work_order_no, asset_no, status, priority, target_completion, site')
      .eq('assigned_owner_id', userId)
    if (!error && Array.isArray(data)) {
      for (const wo of data as any[]) {
        if (wo?.id && !byId.has(wo.id)) byId.set(wo.id, mapWo(wo))
      }
    }
  } catch {
    /* ignore - the assignment source is the primary one */
  }

  return Array.from(byId.values()).filter((j) => isOpenJob(j.status))
}

/**
 * This user's recent activity events (own rows only, RLS-enforced), oldest ->
 * newest so the status engine can read the last meaningful one. []-degrades.
 */
export async function listMyRecentEvents(userId: string, limit = 200): Promise<WorkshopEvent[]> {
  if (!userId) return []
  try {
    const { data, error } = await supabase
      .from('tech_activity_events')
      .select('id, user_id, job_id, asset_no, event_type, reason_code, note, at')
      .eq('user_id', userId)
      .order('at', { ascending: true })
      .limit(limit)
    if (error || !Array.isArray(data)) return []
    return data as WorkshopEvent[]
  } catch {
    return []
  }
}

/**
 * Tasks for one job (wo_tasks), ordered by their sequence. Lets the technician
 * pick a specific step before Start / Complete so the recorded event carries a
 * `task_id`. []-degrades if the table is absent (jobs without tasks keep the
 * plain job-level flow).
 */
export async function listTasksForJob(jobId: string): Promise<WorkshopTask[]> {
  if (!jobId) return []
  try {
    const { data, error } = await supabase
      .from('wo_tasks')
      .select('id, job_id, seq, title, skill, est_minutes, status, assignee_user_id')
      .eq('job_id', jobId)
      .order('seq', { ascending: true })
    if (error || !Array.isArray(data)) return []
    return data as WorkshopTask[]
  } catch {
    return []
  }
}

/**
 * This user's activity events from the start of the local day, oldest -> newest,
 * so the compact "my productivity today" rollup only counts today. []-degrades.
 */
export async function listMyEventsToday(userId: string): Promise<WorkshopEvent[]> {
  if (!userId) return []
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  try {
    const { data, error } = await supabase
      .from('tech_activity_events')
      .select('id, user_id, job_id, asset_no, event_type, reason_code, note, at')
      .eq('user_id', userId)
      .gte('at', start.toISOString())
      .order('at', { ascending: true })
      .limit(500)
    if (error || !Array.isArray(data)) return []
    return data as WorkshopEvent[]
  } catch {
    return []
  }
}

/**
 * Upload locally captured workshop photos to storage (resize/compress first),
 * returning their permanent tp-storage:// references. Already-permanent refs pass
 * through. A file:// that cannot upload right now (offline / error) is DROPPED
 * from the result - the technician's event still records with its text note; the
 * photo simply is not attached (photos need connectivity, honestly reported).
 */
export async function resolveWorkshopPhotos(uris: string[] | null | undefined): Promise<string[]> {
  const out: string[] = []
  let i = 0
  for (const u of (Array.isArray(uris) ? uris : [])) {
    if (!u) { i++; continue }
    if (u.startsWith('file://')) {
      const ref = await uploadModulePhoto(u, 'workshop', i)
      if (ref) out.push(ref)
    } else {
      out.push(u)
    }
    i++
  }
  return out
}

// ── Write ─────────────────────────────────────────────────────────────────────

export interface RecordEventInput {
  userId: string
  eventType: WorkshopEventType
  jobId?: string | null
  taskId?: string | null
  assetNo?: string | null
  reasonCode?: WorkshopReason | string | null
  note?: string | null
  /**
   * Permanent photo references (tp-storage://) to attach. tech_activity_events
   * has NO photos column, so refs are folded into the free-text `note` (labelled
   * "Photos:") - the only honest place to store them without inventing a column.
   */
  photoRefs?: string[] | null
  site?: string | null
  country?: string | null
  device?: string | null
  gpsLat?: number | null
  gpsLng?: number | null
}

/** Fold photo references into the event note (no photos column exists). */
function noteWithPhotos(note: string | null | undefined, photoRefs: string[] | null | undefined): string | null {
  const parts: string[] = []
  const base = note?.toString().trim()
  if (base) parts.push(base)
  const refs = (Array.isArray(photoRefs) ? photoRefs : []).filter(Boolean)
  if (refs.length) parts.push('Photos: ' + refs.join(' | '))
  return parts.length ? parts.join('\n') : null
}

/**
 * Record ONE activity event. Offline-safe: the write goes through the typed
 * record queue (WORKSHOP_EVENT), which inserts immediately when online and
 * queues + retries when offline. The event timestamp (`at`) is set server-side
 * (default now()), never by the client. Returns whether it was stored offline.
 */
export async function recordWorkshopEvent(input: RecordEventInput): Promise<{ offline: boolean }> {
  const res = await saveCommand('WORKSHOP_EVENT', {
    user_id: input.userId,
    job_id: input.jobId ?? null,
    task_id: input.taskId ?? null,
    asset_no: input.assetNo?.toString().trim() || null,
    event_type: input.eventType,
    reason_code: input.reasonCode ? String(input.reasonCode) : null,
    note: noteWithPhotos(input.note, input.photoRefs),
    device: input.device ?? null,
    gps_lat: input.gpsLat ?? null,
    gps_lng: input.gpsLng ?? null,
    site: input.site?.toString().trim() || null,
    country: input.country ?? null,
  })
  return { offline: !!res.offline }
}

/** Check in for the shift (no job). */
export function checkIn(input: Omit<RecordEventInput, 'eventType' | 'jobId'>): Promise<{ offline: boolean }> {
  return recordWorkshopEvent({ ...input, eventType: 'check_in', jobId: null })
}

/** Check out at the end of the shift (no job). */
export function checkOut(input: Omit<RecordEventInput, 'eventType' | 'jobId'>): Promise<{ offline: boolean }> {
  return recordWorkshopEvent({ ...input, eventType: 'check_out', jobId: null })
}
