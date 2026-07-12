/**
 * Mobile checklists service — read published templates + the operator's due
 * assignments, and submit a completed checklist offline-safely through the typed
 * record queue (idempotent via a client-generated id + client_uuid, V125).
 * Reads use supabase directly; the only WRITE goes through recordQueue.
 */
import { supabase } from './supabase'
import { saveCommand } from './recordQueue'
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

/** Distinct site names (Sites master, with a vehicle_fleet fallback). */
export async function listSiteOptions(country?: string | null): Promise<string[]> {
  try {
    let q = supabase.from('sites').select('name').eq('active', true)
    if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
    const { data, error } = await q.limit(1000)
    if (!error && data && data.length) return uniqSorted(data.map((r: any) => r.name))
  } catch { /* fall through to fleet fallback */ }
  const { data } = await supabase.from('vehicle_fleet').select('site').limit(2000)
  return uniqSorted((data ?? []).map((r: any) => r.site))
}

/** Distinct asset numbers from the fleet. */
export async function listAssetOptions(country?: string | null): Promise<string[]> {
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

/**
 * Submit a completed checklist. Generates the submission id up-front so it is
 * known even offline (for navigation + linking the assignment). Enqueues through
 * saveCommand, which inserts immediately when online and queues + auto-syncs when
 * offline. Returns the id and whether it was stored offline.
 */
export async function submitChecklist(input: SubmitInput): Promise<{ id: string; offline: boolean }> {
  const id = safeUuid()
  const t = input.template
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
    photos: input.photos ?? {},
    signature_data: input.signature_data ?? null,
    printed_name: input.printed_name ?? null,
    score_pct: input.score_pct ?? null,
    score_passed: input.score_passed ?? null,
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
