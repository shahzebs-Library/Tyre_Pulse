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

// ── Write ─────────────────────────────────────────────────────────────────────

export interface RecordEventInput {
  userId: string
  eventType: WorkshopEventType
  jobId?: string | null
  taskId?: string | null
  assetNo?: string | null
  reasonCode?: WorkshopReason | string | null
  note?: string | null
  site?: string | null
  country?: string | null
  device?: string | null
  gpsLat?: number | null
  gpsLng?: number | null
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
    note: input.note?.toString().trim() || null,
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
