/**
 * Mobile checklists service — read published templates + the operator's due
 * assignments, and submit a completed checklist offline-safely through the typed
 * record queue (idempotent via a client-generated id + client_uuid, V125).
 * Reads use supabase directly; the only WRITE goes through recordQueue.
 */
import { supabase } from './supabase'
import { saveCommand } from './recordQueue'
import { uploadModulePhoto } from './photoUpload'
import { safeUuid } from './ids'
import type { ChecklistField } from './checklistFields'
import { filterTemplatesForRole, filterAssignmentsForRole } from './checklistRoles'
import { fetchAllRows } from './fetchAllRows'

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
  /** Roles this checklist is for (V591). NULL/empty = every role. */
  assignee_roles?: string[] | null
  /** Content translations (optional jsonb columns). */
  name_i18n?: Record<string, string> | null
  description_i18n?: Record<string, string> | null
  /** Shared answer legends a whole sheet points at via field.options_ref. */
  option_sets?: Record<string, any> | null
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

// assignee_roles drives role targeting (V591). name_i18n/description_i18n/
// option_sets are what make the checklist readable in Arabic/Hindi/Urdu and let
// a field resolve its SHARED option list - the phone could do neither while
// these columns were simply never selected.
// ONE STRING LITERAL, NOT A CONCATENATION: supabase-js infers the row type from
// the literal select text, and a `+` join degrades it to `string`, which makes
// every read come back as GenericStringError[] and fails the build.
const TEMPLATE_COLS = 'id,name,description,category,icon,status,version,require_signature,require_approval,scored,pass_threshold,fields,country,assignee_roles,name_i18n,description_i18n,option_sets'
const ASSIGN_COLS =
  'id,template_id,template_name,site,asset_no,assignee_role,due_date,status,submission_id'

function scopeCountry<T extends { or: Function; }>(q: T, country?: string | null): T {
  if (country && country !== 'All') return (q as any).or(`country.eq.${country},country.is.null`)
  return q
}

/**
 * Published templates this operator should be OFFERED.
 *
 * `role` narrows the list to the checklists written for that trade (V591). It is
 * optional so every existing caller keeps its behaviour, and an untargeted
 * template is for everyone, so passing a role can only ever REMOVE checklists
 * that explicitly name somebody else.
 *
 * The filter runs client-side ON PURPOSE and is TARGETING, not a security
 * boundary: templates are already walled by the org + country RLS policies and a
 * published template is a list of questions with no PII. Filtering in SQL would
 * also need the role vocabulary to match exactly, and it does not - the DB
 * stores 'Tyre Man' while this app's UserRole is 'tyre_man', which is exactly
 * the mismatch that would make a naive `.contains()` match nobody.
 * checklistRoles normalises both sides.
 */
export async function listTemplates(
  country?: string | null,
  role?: string | null,
  opts: { isSuperAdmin?: boolean } = {},
): Promise<ChecklistTemplate[]> {
  let q = supabase.from('checklist_templates').select(TEMPLATE_COLS).eq('status', 'published')
  q = scopeCountry(q, country)
  const { data, error } = await q.order('name', { ascending: true }).limit(200)
  if (error) throw error
  const rows = (data ?? []) as ChecklistTemplate[]
  return role === undefined ? rows : filterTemplatesForRole(rows, role, opts)
}

export async function getTemplate(id: string): Promise<ChecklistTemplate | null> {
  const { data, error } = await supabase.from('checklist_templates').select(TEMPLATE_COLS).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as ChecklistTemplate) ?? null
}

/**
 * The operator's due assignments.
 *
 * `checklist_assignments.assignee_role` has existed since the table was created
 * and was READ BY NOBODY - every signed-in user was shown every assignment,
 * including ones raised for another trade. A NULL role means the assignment was
 * not aimed at anyone in particular, so it stays everyone's to pick up.
 */
export async function listAssignments(
  country?: string | null,
  role?: string | null,
  opts: { isSuperAdmin?: boolean } = {},
): Promise<ChecklistAssignment[]> {
  let q = supabase.from('checklist_assignments').select(ASSIGN_COLS)
  q = scopeCountry(q, country)
  const { data, error } = await q.order('due_date', { ascending: true }).limit(300)
  if (error) throw error
  const rows = (data ?? []) as ChecklistAssignment[]
  return role === undefined ? rows : filterAssignmentsForRole(rows, role, opts)
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
  // Last-resort fallback over the fleet: 1,617 rows, so `.limit(2000)` returned
  // 1,000 and quietly lost every site that only appears on a later row.
  const rows = await fetchAllRows<any>(
    (from, to) => supabase.from('vehicle_fleet').select('site').order('site').order('id').range(from, to),
    { max: 20000 },
  ).catch(() => [] as any[])
  return uniqSorted(rows.map((r: any) => r.site))
}

/**
 * Distinct asset numbers from LIVE operational data (RPC v129), with a fallback.
 *
 * BOTH PATHS ARE PAGED, and both had to be. `reference_asset_options` is a
 * SET-RETURNING function, so PostgREST applies the same 1,000-row cap to it as
 * to a table read - measured live as a real KSA-only Manager it returns 1,033
 * asset numbers, so the picker was already dropping 33 of that user's own
 * assets with no error and nothing on screen to show it. The fallback's
 * `.limit(3000)` was the same illusion: a limit above the cap returns 1,000.
 * `vehicle_fleet` now holds 1,617 rows (KSA 1,030 / UAE 452 / Egypt 135).
 *
 * The symptom is the confusing one: a field user types a real asset number,
 * the client-side filter finds nothing in the truncated array, and the asset
 * looks like it is missing from the system.
 */
export async function listAssetOptions(country?: string | null): Promise<string[]> {
  const scoped = country && country !== 'All' ? country : null
  try {
    const rows = await fetchAllRows<any>(
      (from, to) => supabase.rpc('reference_asset_options', { p_country: scoped }).range(from, to),
      { max: 20000 },
    )
    if (rows.length) return uniqSorted(rows.map((r: any) => r.asset_no))
  } catch { /* fall through to the fleet-master fallback */ }
  // asset_no is unique per COUNTRY, not globally, so the id tiebreak is what
  // stops a row falling between two pages.
  const rows = await fetchAllRows<any>((from, to) => {
    let q = supabase.from('vehicle_fleet').select('asset_no').order('asset_no').order('id')
    if (scoped) q = q.or(`country.eq.${scoped},country.is.null`)
    return q.range(from, to)
  }, { max: 20000 })
  return uniqSorted(rows.map((r: any) => r.asset_no))
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
  /**
   * EVERY captured signature, keyed by field id. A workshop sheet is signed off
   * by three trades as three separate signature fields; `signature_data` stays
   * the primary sign-off so everything already reading it is unchanged.
   * The column has existed since V212 and mobile never wrote it, so two of the
   * three signatures on a paper-derived sheet were simply lost.
   */
  signatures?: Record<string, string> | null
  /**
   * Per-line remarks, keyed by field id. On a paper-derived sheet this is where
   * a fitter says WHY a line failed. Also a real column mobile never wrote, so a
   * phone-filled submission showed an empty Remarks column in the web viewer -
   * indistinguishable from "nothing to report".
   */
  notes?: Record<string, string> | null
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
 * WHY THIS EXISTS: uploading here, while the user is still on the submit screen,
 * is the fastest path to a permanent ref - the ONLINE case never touches the
 * queue's photo machinery at all. Entries that are already permanent refs pass
 * straight through, so this costs nothing extra.
 *
 * OFFLINE is now handled downstream and no longer loses anything. The queue's
 * photo pipeline (persistPayloadPhotos / resolveCommandPhotos /
 * sweepOrphanQueuedPhotos in recordQueue.ts) used to begin with
 * `Array.isArray(photos)` and so skipped this keyed Record<fieldId, string[]>
 * entirely: a local path enqueued here was never copied into durable storage,
 * never re-uploaded, and was written verbatim into the database - the submit
 * reported success while the evidence was unreachable for everyone. Those three
 * functions now read either shape (readPhotoBag / writePhotoBag), so a local
 * path kept below is persisted durably at enqueue and uploaded on the next sync.
 *
 * Still do NOT call persistPhotoForQueue from here: enqueueCommand already does
 * it for every queued command, and a second durable copy would be an orphan the
 * sweep deletes.
 *
 * Never throws: uploadModulePhoto returns null on failure, so photo handling can
 * never block a submit.
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
      // Upload failed (offline, or the file is gone): keep the local path so the
      // answer is not silently dropped. The record queue persists it durably at
      // enqueue and uploads it on the next sync.
      resolved.push(ref || raw)
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
  // Uploaded here when online so the submit carries permanent refs; anything
  // still local falls through to the queue, which now understands this keyed
  // map too (see resolveSubmissionPhotos).
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
    // Sent as {} rather than null when empty: the web viewer renders a missing
    // key and an empty object identically, and {} keeps the column's shape
    // consistent with what the web writes.
    signatures: input.signatures ?? {},
    notes: input.notes ?? {},
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
