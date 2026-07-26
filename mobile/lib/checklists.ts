/**
 * Mobile checklists service — read published templates + the operator's due
 * assignments, and submit a completed checklist offline-safely through the typed
 * record queue (idempotent via a client-generated id + client_uuid, V125).
 * Reads use supabase directly; the only WRITE goes through recordQueue.
 */
import { supabase } from './supabase'
import { saveCommand } from './recordQueue'
import { uploadModulePhoto } from './photoUpload'
import { persistPhotoForQueue } from './durablePhotos'
import { safeUuid } from './ids'
import type { ChecklistField } from './checklistFields'

export interface ChecklistTemplate {
  id: string
  name: string
  description?: string | null
  category?: string | null
  icon?: string | null
  status: string
  version: number
  require_signature: boolean
  require_approval: boolean
  scored?: boolean
  pass_threshold?: number | null
  fields: ChecklistField[]
  country?: string | null
}

export interface ChecklistAssignment {
  id: string
  template_id: string | null
  template_name: string | null
  site: string | null
  asset_no: string | null
  assignee_role: string | null
  due_date: string
  status: 'pending' | 'completed' | 'overdue' | 'skipped'
  submission_id: string | null
}

const TEMPLATE_COLS =
  'id,name,description,category,icon,status,version,require_signature,require_approval,scored,pass_threshold,fields,country'
const ASSIGN_COLS =
  'id,template_id,template_name,site,asset_no,assignee_role,due_date,status,submission_id'

function scopeCountry<T extends { or: Function; }>(q: T, country?: string | null): T {
  if (country && country !== 'All') return (q as any).or(`country.eq.${country},country.is.null`)
  return q
}

export async function listTemplates(country?: string | null): Promise<ChecklistTemplate[]> {
  let q = supabase.from('checklist_templates').select(TEMPLATE_COLS).eq('status', 'published')
  q = scopeCountry(q, country)
  const { data, error } = await q.order('name', { ascending: true }).limit(200)
  if (error) throw error
  return (data ?? []) as ChecklistTemplate[]
}

export async function getTemplate(id: string): Promise<ChecklistTemplate | null> {
  const { data, error } = await supabase.from('checklist_templates').select(TEMPLATE_COLS).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as ChecklistTemplate) ?? null
}

export async function listAssignments(country?: string | null): Promise<ChecklistAssignment[]> {
  let q = supabase.from('checklist_assignments').select(ASSIGN_COLS)
  q = scopeCountry(q, country)
  const { data, error } = await q.order('due_date', { ascending: true }).limit(300)
  if (error) throw error
  return (data ?? []) as ChecklistAssignment[]
}

// ── Reference-field option sources (live data for asset/site/user pickers) ──

function uniqSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && !!v.trim())))
    .sort((a, b) => a.localeCompare(b))
}

/** Distinct site names from LIVE operational data (RPC v129), with fallbacks. */
export async function listSiteOptions(country?: string | null): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('reference_site_options', {
      p_country: country && country !== 'All' ? country : null,
    })
    if (!error && Array.isArray(data) && data.length) return uniqSorted(data.map((r: any) => r.name))
  } catch { /* fall through */ }
  try {
    let q = supabase.from('sites').select('name').eq('active', true)
    if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
    const { data, error } = await q.limit(1000)
    if (!error && data && data.length) return uniqSorted(data.map((r: any) => r.name))
  } catch { /* fall through to fleet fallback */ }
  const { data } = await supabase.from('vehicle_fleet').select('site').limit(2000)
  return uniqSorted((data ?? []).map((r: any) => r.site))
}

/** Distinct asset numbers from LIVE operational data (RPC v129), with fallback. */
export async function listAssetOptions(country?: string | null): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('reference_asset_options', {
      p_country: country && country !== 'All' ? country : null,
    })
    if (!error && Array.isArray(data) && data.length) return uniqSorted(data.map((r: any) => r.asset_no))
  } catch { /* fall through */ }
  let q = supabase.from('vehicle_fleet').select('asset_no')
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  const { data, error } = await q.limit(3000)
  if (error) throw error
  return uniqSorted((data ?? []).map((r: any) => r.asset_no))
}

/** Org users as display names (full_name || username). */
export async function listUserOptions(): Promise<string[]> {
  const { data, error } = await supabase.from('profiles').select('full_name,username').limit(1000)
  if (error) throw error
  return uniqSorted((data ?? []).map((r: any) => r.full_name || r.username))
}

/** Load options for a reference source. */
export async function listReferenceOptions(source: 'asset' | 'site' | 'user', country?: string | null): Promise<string[]> {
  if (source === 'site') return listSiteOptions(country)
  if (source === 'asset') return listAssetOptions(country)
  return listUserOptions()
}

export interface SubmitInput {
  template: ChecklistTemplate
  answers: Record<string, any>
  photos: Record<string, string[]>
  signature_data?: string | null
  printed_name?: string | null
  site?: string | null
  asset_no?: string | null
  title?: string | null
  country?: string | null
  score_pct?: number | null
  score_passed?: boolean | null
  assignmentId?: string | null
}

/** Storage module slug for checklist photos (matches recordQueue TYPE_TO_MODULE). */
const PHOTO_MODULE = 'checklist'

/**
 * Resolve the per-field photo map to permanent tp-storage:// refs BEFORE the
 * submission is handed to the record queue.
 *
 * WHY THIS EXISTS: the queue's photo pipeline (persistPayloadPhotos and
 * resolveCommandPhotos in recordQueue.ts) both begin with `Array.isArray(photos)`,
 * so they only understand a FLAT string[]. A checklist submits
 * Record<fieldId, string[]> - the shape checklist_submissions.photos stores and
 * the approval screen reads - so both queue steps skip it entirely. Without this
 * resolver, a photo that PhotoCapture could not upload at capture time (offline)
 * keeps its device-local file:// cache URI, is never uploaded, and is written
 * verbatim into the database: the submit looks successful while the evidence is
 * unreachable for everyone and the bytes sit in an OS cache the device may purge.
 *
 * Entries that are already permanent refs pass straight through, so the ONLINE
 * path (PhotoCapture uploads on capture) costs nothing extra. A file:// that
 * still cannot be uploaded is copied into durable document storage so the bytes
 * survive cache eviction until an upload succeeds.
 *
 * Never throws: uploadModulePhoto and persistPhotoForQueue both return null on
 * failure, so photo handling can never block a submit.
 */
async function resolveSubmissionPhotos(
  photos: Record<string, string[]> | null | undefined,
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  if (!photos || typeof photos !== 'object') return out

  let index = 0
  for (const [fieldId, list] of Object.entries(photos)) {
    if (!Array.isArray(list) || list.length === 0) continue
    const resolved: string[] = []
    for (const raw of list) {
      if (typeof raw !== 'string' || !raw) continue
      if (!raw.startsWith('file://')) { resolved.push(raw); continue } // already a permanent ref
      const ref = await uploadModulePhoto(raw, PHOTO_MODULE, index++)
      if (ref) { resolved.push(ref); continue }
      // Upload failed (offline, or the file is gone). Copy the bytes out of the
      // evictable OS cache so a later attempt still has them, and keep that path.
      const durable = await persistPhotoForQueue(raw)
      resolved.push(durable ? durable.localPath : raw)
    }
    if (resolved.length) out[fieldId] = resolved
  }
  return out
}

/**
 * Submit a completed checklist. Generates the submission id up-front so it is
 * known even offline (for navigation + linking the assignment). Enqueues through
 * saveCommand, which inserts immediately when online and queues + auto-syncs when
 * offline. Returns the id and whether it was stored offline.
 */
export async function submitChecklist(input: SubmitInput): Promise<{ id: string; offline: boolean }> {
  const id = safeUuid()
  const t = input.template
  // Uploaded here, not by the queue: the queue's photo pipeline only handles a
  // flat string[] and would skip this keyed map (see resolveSubmissionPhotos).
  const photos = await resolveSubmissionPhotos(input.photos)
  const res = await saveCommand('CHECKLIST_SUBMISSION', {
    id,
    template_id: t.id,
    template_name: t.name,
    template_version: t.version ?? 1,
    country: input.country ?? t.country ?? null,
    site: input.site ?? null,
    asset_no: input.asset_no ?? null,
    title: input.title ?? t.name ?? null,
    status: 'submitted',
    answers: input.answers ?? {},
    photos,
    signature_data: input.signature_data ?? null,
    printed_name: input.printed_name ?? null,
    score_pct: input.score_pct ?? null,
    score_passed: input.score_passed ?? null,
    // Approval lifecycle (V212): templates flagged require_approval start pending.
    approval_status: t.require_approval ? 'pending' : 'not_required',
  }, id)

  // Link the assignment (update-by-id; idempotent). Best-effort — a failure here
  // still leaves the submission recorded.
  if (input.assignmentId) {
    try {
      await saveCommand('CHECKLIST_ASSIGNMENT_STATUS', {
        id: input.assignmentId,
        status: 'completed',
        submission_id: id,
        completed_at: new Date().toISOString(),
      })
    } catch { /* non-blocking */ }
  }

  return { id, offline: !!res.offline }
}

// ── Approval (V212) ─────────────────────────────────────────────────────────

export interface ChecklistSubmission {
  id: string
  template_id: string | null
  template_name: string | null
  title: string | null
  site: string | null
  asset_no: string | null
  status: string | null
  answers: Record<string, any> | null
  photos: Record<string, string[]> | null
  signature_data: string | null
  printed_name: string | null
  submitted_by: string | null
  submitted_at: string | null
  score_pct: number | null
  score_passed: boolean | null
  approval_status: 'not_required' | 'pending' | 'approved' | 'rejected'
  approver_name: string | null
  approver_signature: string | null
  approved_at: string | null
  review_note: string | null
  locked: boolean | null
}

const SUBMISSION_COLS =
  'id,template_id,template_name,title,site,asset_no,status,answers,photos,signature_data,printed_name,' +
  'submitted_by,submitted_at,score_pct,score_passed,approval_status,approver_name,' +
  'approver_signature,approved_at,review_note,locked'

/** Submissions awaiting approval (require_approval templates), newest first. */
export async function listPendingApprovals(country?: string | null): Promise<ChecklistSubmission[]> {
  let q = supabase.from('checklist_submissions').select(SUBMISSION_COLS).eq('approval_status', 'pending')
  q = scopeCountry(q, country)
  const { data, error } = await q.order('submitted_at', { ascending: false, nullsFirst: false }).limit(200)
  if (error) throw error
  // Cast through unknown: the generated DB types predate the V212 approval
  // columns, so the typed client can't infer this row shape yet.
  return (data ?? []) as unknown as ChecklistSubmission[]
}

export async function getSubmission(id: string): Promise<ChecklistSubmission | null> {
  const { data, error } = await supabase.from('checklist_submissions').select(SUBMISSION_COLS).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as unknown as ChecklistSubmission) ?? null
}

/**
 * Approve or reject a submission (elevated-role RLS enforces who can). Routes
 * through the typed, offline-safe command queue like every other write.
 */
export async function decideApproval(input: {
  id: string
  approved: boolean
  approverName: string
  approverSignature?: string | null
  reviewNote?: string | null
  approverId?: string | null
}): Promise<{ offline: boolean }> {
  const res = await saveCommand('CHECKLIST_APPROVAL', {
    id: input.id,
    approval_status: input.approved ? 'approved' : 'rejected',
    approver_name: input.approverName || null,
    approver_signature: input.approved ? (input.approverSignature ?? null) : null,
    approved_by: input.approverId ?? null,
    approved_at: new Date().toISOString(),
    review_note: input.approved ? null : (input.reviewNote ?? null),
    locked: input.approved,
  }, `approve_${input.id}`)
  return { offline: !!res.offline }
}
