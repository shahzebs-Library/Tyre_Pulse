/**
 * recordQueue - TYPED offline command queue.
 *
 * Mobile clients MUST NOT choose Supabase table names. Every write is a typed
 * command whose `type` is looked up in the COMMANDS registry, which fixes the
 * target table and an allow-list of payload fields (verified against the live
 * schema). Unknown types are rejected; unknown payload keys are stripped before
 * insert. This prevents a compromised/buggy client from writing to arbitrary
 * tables or columns.
 *
 * Mechanics preserved from v1: immediate insert, offline enqueue, auto-flush on
 * reconnect, retry. Added: per-command idempotency key + retry-with-backoff and
 * retry_count so transient failures self-heal.
 */
import { supabase } from './supabase'
import { secureStorage } from './secureStorage'
import { uploadModulePhoto } from './photoUpload'

const KEY = 'tp_record_queue_v2'
const MAX_RETRIES = 8
const BASE_BACKOFF_MS = 30_000 // 30s, doubled per attempt, capped

export type QueueStatus = 'pending' | 'synced' | 'failed'

/** Fixed set of write commands the mobile app is allowed to issue. */
export type CommandType =
  | 'TYRE_CHANGE'
  | 'WORK_ORDER'
  | 'RCA'
  | 'REPORT_ISSUE'
  | 'STOCK_ADJUST'
  | 'WORK_ORDER_STATUS'
  | 'CORRECTIVE_ACTION_STATUS'
  | 'CHECKLIST_SUBMISSION'
  | 'CHECKLIST_ASSIGNMENT_STATUS'
  | 'CHECKLIST_APPROVAL'
  | 'ODOMETER_LOG'
  | 'ENGINE_HOURS_LOG'

/** How a command mutates its table. Defaults to 'insert' to preserve v1 behavior. */
export type CommandOp = 'insert' | 'update'

interface CommandSpec {
  table: string
  /** Only these payload keys survive; everything else is dropped. */
  fields: readonly string[]
  /**
   * Write mode. 'insert' (default) creates a new row. 'update' patches an
   * existing row matched by `matchField`; the match column is used in the WHERE
   * clause and excluded from the SET so the primary key is never rewritten.
   */
  op?: CommandOp
  /** Column used to locate the row for an 'update' command. Defaults to 'id'. */
  matchField?: string
}

/**
 * The ONLY place a table name may appear on the client. Fields are restricted to
 * columns that actually exist on the live schema, so stripped payloads never
 * fail an insert on an unknown column.
 */
export const COMMANDS: Record<CommandType, CommandSpec> = {
  TYRE_CHANGE: {
    table: 'tyre_records',
    fields: [
      'asset_no', 'serial_no', 'serial_number', 'tyre_serial', 'brand', 'size',
      'site', 'country', 'cost_per_tyre', 'qty', 'position', 'tyre_position',
      'km_at_fitment', 'km_at_removal', 'hrs_at_fitment', 'hrs_at_removal',
      'tread_depth', 'removal_reason', 'removal_date', 'fitment_date', 'issue_date',
      'status', 'risk_level', 'category', 'photos',
    ],
  },
  WORK_ORDER: {
    table: 'work_orders',
    fields: [
      'work_order_no', 'asset_no', 'tyre_serial', 'status', 'priority',
      'work_type', 'description', 'technician_name', 'site', 'country',
      'opened_at', 'labour_cost', 'parts_cost', 'total_cost', 'notes', 'created_by',
    ],
  },
  RCA: {
    table: 'rca_records',
    fields: [
      'asset_no', 'tyre_serial', 'brand', 'site', 'region',
      'failure_date', 'km_at_failure', 'root_cause', 'contributing_factors',
      'photos', 'corrective_action_id', 'created_by', 'country',
    ],
  },
  REPORT_ISSUE: {
    table: 'corrective_actions',
    fields: [
      'title', 'priority', 'site', 'region', 'description', 'assigned_to',
      'status', 'root_cause', 'asset_no', 'tyre_serial', 'created_by',
      'country', 'due_date', 'photos',
    ],
  },
  // ---- UPDATE-by-id commands (offline-safe status/quantity changes) ----
  STOCK_ADJUST: {
    table: 'stock_records',
    op: 'update',
    matchField: 'id',
    fields: ['id', 'stock_qty', 'stock_status', 'updated_by', 'updated_at'],
  },
  WORK_ORDER_STATUS: {
    table: 'work_orders',
    op: 'update',
    matchField: 'id',
    fields: ['id', 'status', 'started_at', 'completed_at'],
  },
  CORRECTIVE_ACTION_STATUS: {
    table: 'corrective_actions',
    op: 'update',
    matchField: 'id',
    fields: ['id', 'status', 'closed_at'],
  },
  // ---- Checklist submission (insert) + assignment completion (update) ----
  CHECKLIST_SUBMISSION: {
    table: 'checklist_submissions',
    fields: [
      'id', 'template_id', 'template_name', 'template_version', 'country', 'site',
      'asset_no', 'title', 'status', 'answers', 'photos', 'signature_data',
      'printed_name', 'score_pct', 'score_passed', 'approval_status',
    ],
  },
  CHECKLIST_ASSIGNMENT_STATUS: {
    table: 'checklist_assignments',
    op: 'update',
    matchField: 'id',
    fields: ['id', 'status', 'submission_id', 'completed_at'],
  },
  // Supervisor approve/reject of a submission (elevated-role RLS, V212).
  CHECKLIST_APPROVAL: {
    table: 'checklist_submissions',
    op: 'update',
    matchField: 'id',
    fields: [
      'id', 'approval_status', 'approver_name', 'approver_signature',
      'approved_by', 'approved_at', 'review_note', 'locked',
    ],
  },
  // Driver daily meter readings (V162/V161 + V213 photo). Odometer feeds
  // vehicle_fleet.current_km via a server trigger (V213).
  ODOMETER_LOG: {
    table: 'odometer_logs',
    fields: [
      'asset_no', 'odometer_km', 'reading_date', 'source', 'site',
      'country', 'notes', 'photos', 'created_by',
    ],
  },
  ENGINE_HOURS_LOG: {
    table: 'engine_hours_logs',
    fields: [
      'asset_no', 'engine_hours', 'reading_date', 'source', 'site',
      'country', 'notes', 'photos', 'created_by',
    ],
  },
}

export interface QueuedRecord {
  id: string
  /** Command type; the table is derived from COMMANDS, never client-supplied. */
  type: CommandType
  /** Kept for read-only display/back-compat; equals COMMANDS[type].table. */
  table: string
  payload: Record<string, any>
  idempotency_key: string
  sync_status: QueueStatus
  retry_count: number
  next_attempt_at: string
  created_at: string
  synced_at: string | null
  error: string | null
}

function isCommandType(t: string): t is CommandType {
  return Object.prototype.hasOwnProperty.call(COMMANDS, t)
}

/** Strip a raw payload down to the command's allow-listed fields. */
function sanitize(type: CommandType, payload: Record<string, any>): Record<string, any> {
  const allowed = COMMANDS[type].fields
  const out: Record<string, any> = {}
  for (const k of allowed) {
    if (payload[k] !== undefined) out[k] = payload[k]
  }
  return out
}

function backoffMs(retry: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** retry, 30 * 60_000) // cap 30 min
}

/** Module slug used for photo storage paths, per command. Update commands carry
 * no photos, but every command type needs an entry for exhaustive typing. */
const TYPE_TO_MODULE: Record<CommandType, string> = {
  TYRE_CHANGE: 'tyre-change',
  WORK_ORDER: 'work-order',
  RCA: 'rca',
  REPORT_ISSUE: 'report-issue',
  STOCK_ADJUST: 'stock-adjust',
  WORK_ORDER_STATUS: 'work-order-status',
  CORRECTIVE_ACTION_STATUS: 'corrective-action-status',
  CHECKLIST_SUBMISSION: 'checklist',
  CHECKLIST_ASSIGNMENT_STATUS: 'checklist-assignment',
  CHECKLIST_APPROVAL: 'checklist-approval',
  ODOMETER_LOG: 'meter-log',
  ENGINE_HOURS_LOG: 'meter-log',
}

/** True when a command patches an existing row rather than inserting a new one. */
function isUpdateCommand(type: CommandType): boolean {
  return (COMMANDS[type].op ?? 'insert') === 'update'
}

/**
 * Split an allow-listed payload for an update command into the match key/value
 * (WHERE clause) and the SET body. The match column is excluded from the SET so
 * the primary key is never rewritten and RLS/triggers see a clean patch.
 */
function buildUpdateParts(
  type: CommandType,
  clean: Record<string, any>,
): { matchField: string; matchValue: any; setPayload: Record<string, any> } {
  const matchField = COMMANDS[type].matchField ?? 'id'
  const matchValue = clean[matchField]
  const setPayload: Record<string, any> = {}
  for (const [k, v] of Object.entries(clean)) {
    if (k !== matchField) setPayload[k] = v
  }
  return { matchField, matchValue, setPayload }
}

/**
 * Resolve a command's `photos` array before insert: upload any local file://
 * URIs to storage and replace them with permanent tp-storage:// refs. Already-
 * uploaded refs pass through. A file:// that can't be uploaded (offline / file
 * gone) is KEPT so the next sync attempt retries it, and `pending` is set true
 * so the caller keeps the record queued rather than inserting without photos.
 */
async function resolveCommandPhotos(
  type: CommandType,
  payload: Record<string, any>,
): Promise<{ payload: Record<string, any>; pending: boolean }> {
  const photos = payload.photos
  if (!Array.isArray(photos) || photos.length === 0) return { payload, pending: false }

  const out: string[] = []
  let pending = false
  let i = 0
  for (const p of photos) {
    if (typeof p === 'string' && p.startsWith('file://')) {
      const ref = await uploadModulePhoto(p, TYPE_TO_MODULE[type], i)
      if (ref) out.push(ref)
      else { out.push(p); pending = true } // keep local URI for a later retry
    } else if (p) {
      out.push(p)
    }
    i++
  }
  return { payload: { ...payload, photos: out.length ? out : null }, pending }
}

export async function getRecordQueue(): Promise<QueuedRecord[]> {
  try {
    const raw = await secureStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function save(queue: QueuedRecord[]): Promise<void> {
  await secureStorage.setItem(KEY, JSON.stringify(queue))
}

/** Enqueue a typed command. Throws on unknown type. */
export async function enqueueCommand(
  type: CommandType,
  payload: Record<string, any>,
  idempotencyKey?: string,
): Promise<string> {
  if (!isCommandType(type)) throw new Error(`Unknown command type: ${type}`)
  const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const queue = await getRecordQueue()
  queue.unshift({
    id,
    type,
    table: COMMANDS[type].table,
    payload: sanitize(type, payload),
    idempotency_key: idempotencyKey ?? id,
    sync_status: 'pending',
    retry_count: 0,
    next_attempt_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    synced_at: null,
    error: null,
  })
  await save(queue)
  return id
}

export async function getPendingRecordCount(): Promise<number> {
  const queue = await getRecordQueue()
  return queue.filter(i => i.sync_status !== 'synced').length
}

/**
 * Typed write. Validates the command type, strips the payload to allow-listed
 * fields, tries an immediate insert, and on any failure queues it offline so the
 * data is never lost.
 */
export async function saveCommand(
  type: CommandType,
  payload: Record<string, any>,
  idempotencyKey?: string,
): Promise<{ ok: boolean; offline: boolean; error?: string }> {
  if (!isCommandType(type)) {
    return { ok: false, offline: false, error: `Unknown command type: ${type}` }
  }
  const clean = sanitize(type, payload)

  // UPDATE-by-id command: patch an existing row. Retries are naturally
  // idempotent because callers send absolute values (e.g. the new quantity or
  // status), so re-applying a queued update yields the same result.
  if (isUpdateCommand(type)) {
    const { matchField, matchValue, setPayload } = buildUpdateParts(type, clean)
    if (matchValue === undefined || matchValue === null) {
      return { ok: false, offline: false, error: `Missing "${matchField}" for update command ${type}` }
    }
    try {
      const { error } = await supabase
        .from(COMMANDS[type].table)
        .update(setPayload)
        .eq(matchField, matchValue)
      if (error) throw error
      return { ok: true, offline: false }
    } catch (e: any) {
      await enqueueCommand(type, clean, idempotencyKey)
      return { ok: true, offline: true, error: e?.message }
    }
  }

  // One stable client id shared by the immediate attempt AND any queued retry, so
  // a lost response / crash can never create a duplicate (the retry upserts on the
  // same client_uuid and is ignored).
  const cuid = idempotencyKey ?? `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  try {
    // Upload any locally-captured photos first; keep the record queued (never
    // insert without them) if any can't be uploaded right now.
    const { payload: prepared, pending } = await resolveCommandPhotos(type, clean)
    if (pending) {
      await enqueueCommand(type, prepared, cuid)
      return { ok: true, offline: true }
    }
    const { error } = await supabase.from(COMMANDS[type].table)
      .upsert({ ...prepared, client_uuid: cuid }, { onConflict: 'client_uuid', ignoreDuplicates: true })
    if (error) throw error
    return { ok: true, offline: false }
  } catch (e: any) {
    await enqueueCommand(type, clean, cuid)
    return { ok: true, offline: true, error: e?.message }
  }
}

// Global in-flight guard: the queue is synced from a 10s poll, pull-to-refresh on
// several screens, and a manual button. Without this, two overlapping runs would
// each loop the same pending items and double-apply inserts. All callers await the
// same run.
let syncInFlight: Promise<{ synced: number; failed: number }> | null = null

export async function syncRecordQueue(): Promise<{ synced: number; failed: number }> {
  if (syncInFlight) return syncInFlight
  syncInFlight = doSyncRecordQueue().finally(() => { syncInFlight = null })
  return syncInFlight
}

async function doSyncRecordQueue(): Promise<{ synced: number; failed: number }> {
  const queue = await getRecordQueue()
  const now = Date.now()
  let synced = 0, failed = 0
  for (const item of queue) {
    if (item.sync_status === 'synced') continue
    // Guard: never trust a stored type - reject anything not in the allow-list.
    if (!isCommandType(item.type)) {
      item.sync_status = 'failed'
      item.error = 'Unknown command type'
      failed++
      continue
    }
    if (item.next_attempt_at && Date.parse(item.next_attempt_at) > now) continue
    try {
      const clean = sanitize(item.type, item.payload)
      if (isUpdateCommand(item.type)) {
        // Patch-by-id: idempotent, so a replayed attempt is safe.
        const { matchField, matchValue, setPayload } = buildUpdateParts(item.type, clean)
        if (matchValue === undefined || matchValue === null) {
          throw new Error(`Missing "${matchField}" for update command ${item.type}`)
        }
        const { error } = await supabase
          .from(COMMANDS[item.type].table)
          .update(setPayload)
          .eq(matchField, matchValue)
        if (error) throw error
      } else {
        // Upload any still-local photos and persist the resolved refs back onto
        // the queued item so we never re-upload them on a subsequent attempt.
        const { payload: prepared, pending } = await resolveCommandPhotos(item.type, clean)
        item.payload = prepared
        if (pending) throw new Error('Photos pending upload - will retry')
        // Upsert on the stable client id: a replayed attempt (after a crash or a
        // lost response) is ignored instead of inserting a second row.
        const { error } = await supabase.from(COMMANDS[item.type].table)
          .upsert({ ...prepared, client_uuid: item.idempotency_key }, { onConflict: 'client_uuid', ignoreDuplicates: true })
        if (error) throw error
      }
      item.sync_status = 'synced'
      item.synced_at = new Date().toISOString()
      item.error = null
      synced++
    } catch (err: any) {
      item.retry_count = (item.retry_count ?? 0) + 1
      item.error = err?.message ?? 'Unknown error'
      if (item.retry_count >= MAX_RETRIES) {
        item.sync_status = 'failed'
      } else {
        item.sync_status = 'pending'
        item.next_attempt_at = new Date(now + backoffMs(item.retry_count)).toISOString()
      }
      failed++
    }
    // Persist after EACH item so a crash mid-loop can't lose a 'synced' marking
    // and replay an already-committed insert.
    await save(queue)
  }
  await save(queue)
  // Prune synced entries - they are safely in the database, and keeping them
  // would grow SecureStore without bound. Pending/failed entries are preserved
  // so retries and manual "retry failed" still work.
  const remaining = queue.filter(i => i.sync_status !== 'synced')
  if (remaining.length !== queue.length) await save(remaining)
  return { synced, failed }
}

export async function retryFailedRecords(): Promise<void> {
  const queue = await getRecordQueue()
  const nowIso = new Date().toISOString()
  for (const i of queue) {
    if (i.sync_status === 'failed') {
      i.sync_status = 'pending'
      i.retry_count = 0
      i.next_attempt_at = nowIso
      i.error = null
    }
  }
  await save(queue)
}

export async function clearSyncedRecords(): Promise<void> {
  const queue = await getRecordQueue()
  await save(queue.filter(i => i.sync_status !== 'synced'))
}

/**
 * Wipe the ENTIRE typed record queue (pending included). Used on logout so a
 * different account on a shared device cannot inherit this user's queued work.
 */
export async function clearRecordQueue(): Promise<void> {
  await secureStorage.removeItem(KEY)
}

/** Legacy table names → command types, so any un-migrated call site still routes
 * through the typed allow-list instead of an arbitrary insert. */
const TABLE_TO_TYPE: Record<string, CommandType> = {
  tyre_records: 'TYRE_CHANGE',
  work_orders: 'WORK_ORDER',
  rca_records: 'RCA',
  corrective_actions: 'REPORT_ISSUE',
}

/**
 * @deprecated Back-compat shim. Callers should migrate to saveCommand(type, ...).
 * Rejects any table not in the allow-list.
 */
export async function saveRecord(
  table: string,
  payload: Record<string, any>,
): Promise<{ ok: boolean; offline: boolean; error?: string }> {
  const type = TABLE_TO_TYPE[table]
  if (!type) return { ok: false, offline: false, error: `Table not allowed: ${table}` }
  return saveCommand(type, payload)
}
