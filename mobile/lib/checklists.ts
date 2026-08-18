/**
 * Mobile checklists service — read published templates + the operator's due
 * assignments, and submit a completed checklist offline-safely through the typed
 * record queue (idempotent via a client-generated id + client_uuid, V125).
 * Reads use supabase directly; the only WRITE goes through recordQueue.
 */
import { supabase } from './supabase'
import { nextStatusFor, stageFor, type ApprovalSubmissionLike, type ApprovalTemplateLike } from './checklistApproval'
import { saveCommand } from './recordQueue'
import { uploadModulePhoto } from './photoUpload'
import { safeUuid } from './ids'
import type { ChecklistField } from './checklistFields'
import { filterTemplatesForRole, filterAssignmentsForRole } from './checklistRoles'
import { fetchAllRows, fetchAllRpcRows } from './fetchAllRows'

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
  /**
   * V594. true = a supervisor sign-off is NOT the end: the sheet moves to
   * pending_area_manager and only an area manager can close it.
   */
  require_area_manager?: boolean | null
  /** Document-number prefix, e.g. WDC. The number itself is minted server-side. */
  doc_prefix?: string | null
  /** Expected days between visits for the same machine. Advisory - it warns. */
  min_interval_days?: number | null
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
// ONE string literal on purpose: splitting it across a concatenation breaks
// supabase-js row-type inference and every read comes back as GenericStringError[].
const TEMPLATE_COLS = 'id,name,description,category,icon,status,version,require_signature,require_approval,require_area_manager,doc_prefix,min_interval_days,scored,pass_threshold,fields,country,assignee_roles,name_i18n,description_i18n,option_sets'
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
    // Identity-paged: an RPC that ignored the range would otherwise be asked 20
    // times for the same first 1,000 rows while a field user waits.
    const rows = await fetchAllRpcRows<any>(
      (from, to) => supabase.rpc('reference_asset_options', { p_country: scoped }).range(from, to),
      (r) => (typeof r?.asset_no === 'string' && r.asset_no ? r.asset_no : null),
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
  /** Per-line remarks keyed by field id (V212). Selected but never typed until now. */
  notes?: Record<string, any> | null
  /**
   * EVERY captured signature keyed by field id (V212). A workshop sheet is
   * signed by three trades, so reading only `signature_data` shows one of three.
   */
  signatures?: Record<string, string> | null
  signature_data: string | null
  printed_name: string | null
  submitted_by: string | null
  submitted_at: string | null
  score_pct: number | null
  score_passed: boolean | null
  approval_status: 'not_required' | 'pending' | 'pending_area_manager' | 'approved' | 'rejected'
  /** Minted server-side at INSERT, e.g. WDC-TM514-2026-0001. */
  document_no: string | null
  /** The FINAL approver. On a two-stage sheet this is the AREA MANAGER. */
  approver_name: string | null
  approver_signature: string | null
  approved_at: string | null
  /** The first rung: the supervisor who signed it off (V594). */
  supervisor_name: string | null
  supervisor_signature: string | null
  supervisor_at: string | null
  review_note: string | null
  locked: boolean | null
  template_version?: number | null
}

const SUBMISSION_COLS =
  'id,template_id,template_name,template_version,title,site,asset_no,status,answers,photos,notes,signatures,signature_data,printed_name,' +
  'submitted_by,submitted_at,score_pct,score_passed,approval_status,document_no,approver_name,' +
  'approver_signature,approved_at,supervisor_name,supervisor_signature,supervisor_at,review_note,locked'

/** Submissions awaiting approval (require_approval templates), newest first. */
export async function listPendingApprovals(country?: string | null): Promise<ChecklistSubmission[]> {
  // BOTH waiting states, not just 'pending' - a sheet a supervisor has already
  // signed off sits at pending_area_manager, and reading only 'pending' would
  // make it vanish from every queue with nobody able to close it.
  let q = supabase.from('checklist_submissions').select(SUBMISSION_COLS)
    .in('approval_status', ['pending', 'pending_area_manager'])
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
/**
 * Sign off or send back a submission.
 *
 * WHICH RUNG this is depends on the template and the submission's CURRENT
 * status, resolved by the shared engine so the phone and the database agree:
 *   two-stage, pending              -> supervisor signs   -> pending_area_manager
 *   two-stage, pending_area_manager -> area manager signs -> approved (closed)
 *   single-stage, pending           -> one approval       -> approved (closed)
 * The DB trigger guard_checklist_approval_stages refuses a rung that is skipped
 * or signed by the wrong role, so this can never widen what is allowed - it only
 * makes the phone ask for the right thing.
 *
 * Routes through the offline-safe command queue like every other write. The
 * dedupe key carries the target status, so a supervisor sign-off queued offline
 * and a later area-manager approval are two DIFFERENT commands rather than one
 * overwriting the other.
 */
export async function decideApproval(input: {
  id: string
  approved: boolean
  approverName: string
  approverSignature?: string | null
  reviewNote?: string | null
  approverId?: string | null
  /** The template + submission, so the rung can be resolved. */
  template?: ApprovalTemplateLike | null
  submission?: ApprovalSubmissionLike | null
}): Promise<{ offline: boolean; status: string }> {
  const status = input.submission
    ? nextStatusFor(input.template ?? null, input.submission, input.approved)
    : (input.approved ? 'approved' : 'rejected')

  const stage = stageFor(input.template ?? null, input.submission ?? null)
  const signature = input.approved ? (input.approverSignature ?? null) : null
  const now = new Date().toISOString()

  // A supervisor rung writes the supervisor columns; the final rung writes the
  // approver columns. Writing both would make one person look like two.
  const stageFields = status === 'pending_area_manager'
    ? {
        supervisor_name: input.approverName || null,
        supervisor_signature: signature,
        supervisor_by: input.approverId ?? null,
        supervisor_at: now,
      }
    : {
        approver_name: input.approverName || null,
        approver_signature: signature,
        approved_by: input.approverId ?? null,
        approved_at: now,
      }

  const res = await saveCommand('CHECKLIST_APPROVAL', {
    id: input.id,
    approval_status: status,
    ...stageFields,
    review_note: input.approved ? null : (input.reviewNote ?? null),
    // Only a CLOSED sheet locks. A supervisor sign-off must leave it editable,
    // because the area manager may send it back.
    locked: status === 'approved',
  }, `approve_${input.id}_${status}`)
  return { offline: !!res.offline, status }
}

/**
 * The previous visit for this machine on this sheet, for the "it is not due
 * yet" warning. ADVISORY and best-effort: a failure resolves to null, because
 * "we could not look" is not the same as "it is not due", and the phone may be
 * offline when it asks.
 */
export async function getLastSubmission(
  templateId: string,
  assetNo: string,
): Promise<{ found: boolean; days_ago?: number; document_no?: string | null; submitted_at?: string } | null> {
  if (!templateId || !String(assetNo ?? '').trim()) return null
  try {
    const { data, error } = await supabase.rpc('checklist_last_submission' as any, {
      p_template_id: templateId,
      p_asset_no: assetNo,
    })
    if (error) return null
    return (data as any) ?? null
  } catch {
    return null
  }
}

// ── History: the sheets a person has already filled ─────────────────────────
//
// A tradesman could FILL a checklist and had no way to see the ones they had
// already done - no history screen existed at all. This is the read behind it.
//
// SCOPE IS A VIEW, NOT A BOUNDARY, and that has to be said plainly. The live
// SELECT policy on checklist_submissions is `auth.uid() IS NOT NULL` plus the
// RESTRICTIVE org + country policies, so every signed-in user in the tenant can
// already read every submission their country scope allows. `submittedBy`
// therefore narrows what is SHOWN; it is not what stops anyone reading a
// colleague's sheet. RLS is that, and it is the same wall the approvals queue
// stands behind.

/**
 * Lean columns for the LIST. Deliberately WITHOUT answers / photos / notes /
 * signatures: those are per-sheet jsonb blobs, and pulling 300 of them onto a
 * 2 GB handset to render a date and a status is the same mistake that made
 * mobile Analytics an out-of-memory crash. The detail view calls getSubmission
 * for the one row the reader actually opened.
 */
const HISTORY_COLS =
  'id,template_id,template_name,title,site,asset_no,status,submitted_by,submitted_at,' +
  'score_pct,score_passed,approval_status,document_no,approver_name,approved_at,' +
  'supervisor_name,supervisor_at,review_note,locked'

/** One row of the history list. A strict subset of the full submission. */
export type ChecklistHistoryRow = Pick<
  ChecklistSubmission,
  'id' | 'template_id' | 'template_name' | 'title' | 'site' | 'asset_no' | 'status'
  | 'submitted_by' | 'submitted_at' | 'score_pct' | 'score_passed' | 'approval_status'
  | 'document_no' | 'approver_name' | 'approved_at' | 'supervisor_name' | 'supervisor_at'
  | 'review_note' | 'locked'
>

/**
 * How many sheets one read returns. PostgREST caps EVERY response at 1,000 rows
 * whatever `.limit()` says, so this is paged with `.range()`; the ceiling exists
 * so a phone never pulls an unbounded register, and the screen SAYS when it has
 * been reached rather than truncating in silence.
 */
export const HISTORY_MAX = 300

export interface SubmissionHistory {
  rows: ChecklistHistoryRow[]
  /**
   * Exact server count for the SAME filter, or null when the count could not be
   * read. Null means "we do not know", never zero - the two are opposite claims.
   */
  total: number | null
  /** True when there are older sheets this read did not return. */
  bounded: boolean
  max: number
}

export type HistoryScope = 'mine' | 'team'

/**
 * Turn a chosen scope into the filter to send.
 *
 * THE ONE RULE: 'mine' with no known user id must NOT fall back to everybody.
 * Silently widening a personal history into the whole team's is exactly the kind
 * of quiet mis-scope that reads as a feature until someone notices their name on
 * a sheet they never filled.
 */
export function historyScopeQuery(
  scope: HistoryScope,
  userId: string | null | undefined,
): { ok: true; submittedBy: string | null } | { ok: false; reason: 'unknown_user' } {
  if (scope === 'team') return { ok: true, submittedBy: null }
  const id = String(userId ?? '').trim()
  if (!id) return { ok: false, reason: 'unknown_user' }
  return { ok: true, submittedBy: id }
}

/**
 * Submitted checklists, newest first.
 *
 * `submittedBy` null = every submission this reader's org + country scope can
 * see (the supervisor view). Ordering carries an `id` tiebreak on purpose:
 * `submitted_at` is a server DEFAULT, so a batch of offline sheets synced in one
 * go can share a timestamp, and an order that is not total drops or repeats a
 * row at a page boundary.
 */
export async function listSubmissionHistory(opts: {
  country?: string | null
  submittedBy?: string | null
  max?: number
} = {}): Promise<SubmissionHistory> {
  const max = Math.max(1, Math.min(HISTORY_MAX, opts.max ?? HISTORY_MAX))

  const rows = await fetchAllRows<any>((from, to) => {
    let q = supabase.from('checklist_submissions').select(HISTORY_COLS)
    if (opts.submittedBy) q = q.eq('submitted_by', opts.submittedBy)
    q = scopeCountry(q, opts.country)
    return q
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, to)
  }, { pageSize: 100, max })

  // The exact size of the same filtered set, so the screen can say "300 of 812"
  // instead of implying 300 is all there is. Best-effort: a count we could not
  // read stays null and the screen says so.
  let total: number | null = null
  try {
    let cq = supabase.from('checklist_submissions').select('id', { count: 'exact', head: true })
    if (opts.submittedBy) cq = cq.eq('submitted_by', opts.submittedBy)
    cq = scopeCountry(cq, opts.country)
    const { count, error } = await cq
    if (!error && typeof count === 'number') total = count
  } catch { /* unknown, not zero */ }

  const list = (rows ?? []) as unknown as ChecklistHistoryRow[]
  return {
    rows: list,
    total,
    bounded: total == null ? list.length >= max : total > list.length,
    max,
  }
}

/**
 * Display names for the people who submitted the visible rows, keyed by user id.
 *
 * Only needed for the team view - in "mine" every row is the reader. Bounded by
 * the ids actually on screen and best-effort: a name we cannot read leaves the
 * row saying so rather than blocking the list.
 */
export async function listSubmitterNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => !!v && !!v.trim()))).slice(0, 200)
  if (!unique.length) return {}
  try {
    const { data, error } = await supabase
      .from('profiles').select('id,full_name,username').in('id', unique)
    if (error) return {}
    const out: Record<string, string> = {}
    for (const r of (data ?? []) as any[]) {
      const name = String(r?.full_name ?? '').trim() || String(r?.username ?? '').trim()
      if (r?.id && name) out[String(r.id)] = name
    }
    return out
  } catch {
    return {}
  }
}

/* ---------------------------------------------------------- pure filtering */

/**
 * The buckets a reader filters by. Deliberately coarser than approval_status:
 * both waiting states are "waiting" here, and the ROW still names which rung it
 * is waiting on, because "waiting" is the useful filter while "waiting on whom"
 * is the useful label.
 */
export type HistoryState = 'waiting' | 'closed' | 'sent_back' | 'no_approval'

export function historyStateOf(s: { approval_status?: string | null } | null | undefined): HistoryState {
  const st = String(s?.approval_status ?? '')
  if (st === 'approved') return 'closed'
  if (st === 'rejected') return 'sent_back'
  if (st === 'pending' || st === 'pending_area_manager') return 'waiting'
  return 'no_approval'
}

/** Counts per bucket plus the total, for the filter chips. */
export function historyCounts(rows: ChecklistHistoryRow[]): Record<HistoryState | 'all', number> {
  const out: Record<HistoryState | 'all', number> = {
    all: rows.length, waiting: 0, closed: 0, sent_back: 0, no_approval: 0,
  }
  for (const r of rows) out[historyStateOf(r)] += 1
  return out
}

/**
 * Templates to offer in the picker, DERIVED FROM THE ROWS ON SCREEN. Offering a
 * template the reader has never filled is a filter choice that returns nothing.
 */
export function historyTemplateOptions(
  rows: ChecklistHistoryRow[],
): Array<{ id: string; name: string; count: number }> {
  const by = new Map<string, { id: string; name: string; count: number }>()
  for (const r of rows) {
    const id = String(r.template_id ?? '').trim()
    if (!id) continue
    const name = String(r.template_name ?? '').trim() || id
    const hit = by.get(id)
    if (hit) hit.count += 1
    else by.set(id, { id, name, count: 1 })
  }
  return Array.from(by.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The sheet's reference. `document_no` is minted server-side at INSERT (V594),
 * so every sheet filled before that carries none - measured live, all three
 * existing submissions have a NULL document_no. Returning null lets the screen
 * say "not numbered" instead of rendering a blank where an identity should be.
 */
export function submissionReference(s: { document_no?: string | null } | null | undefined): string | null {
  const v = String(s?.document_no ?? '').trim()
  return v || null
}

/** Case-insensitive match over the fields a row actually shows. */
export function matchesHistorySearch(r: ChecklistHistoryRow, term: string): boolean {
  const q = String(term ?? '').trim().toLowerCase()
  if (!q) return true
  return [r.document_no, r.template_name, r.title, r.asset_no, r.site]
    .some((v) => String(v ?? '').toLowerCase().includes(q))
}

export interface HistoryFilter {
  state?: HistoryState | 'all'
  templateId?: string | null
  search?: string
}

/** Apply the on-screen filters. Pure: same rows in, same rows out. */
export function filterHistory(rows: ChecklistHistoryRow[], f: HistoryFilter = {}): ChecklistHistoryRow[] {
  const state = f.state ?? 'all'
  const tpl = String(f.templateId ?? '').trim()
  return rows.filter((r) => {
    if (state !== 'all' && historyStateOf(r) !== state) return false
    if (tpl && String(r.template_id ?? '') !== tpl) return false
    return matchesHistorySearch(r, f.search ?? '')
  })
}
