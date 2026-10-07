/**
 * Workshop Status service (mobile). Reads go through RLS (org, country, site and
 * the workshop `view` permission); the ONE writer is the SECURITY DEFINER RPC
 * workshop_status_update_record, which validates the vocabulary, checks the
 * update/assign permission and stamps who/when itself. Nothing here sends a
 * name or a time for "updated by".
 */
import { supabase } from './supabase'
import { fetchAllRows } from './fetchAllRows'
import {
  WorkshopRecord, WorkshopPerms, shapePermissions, isStaleError,
} from './workshopStatusView'

export const RECORD_COLS = [
  'id', 'asset_no', 'site', 'country', 'complaint', 'current_stage', 'delay_reason',
  'detailed_reason', 'work_done', 'action_taken', 'next_action', 'parts_status',
  'mr_number', 'po_number', 'responsible_user_id', 'supporting_user_id',
  'expected_part_date', 'expected_release_date', 'blocker', 'remarks',
  'current_active', 'deleted_at', 'ooc_since', 'excel_down_days', 'updated_at',
  'last_updated_by_name', 'last_manual_update_at', 'removed_at',
].join(',')

const MAX_ROWS = 20000

/** Error carrying a stable code so the screen can say "updated by someone else". */
export class WorkshopStatusError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Active vehicles in the current report. Paged past the 1000-row cap. */
export async function listActiveRecords(): Promise<WorkshopRecord[]> {
  return fetchAllRows<WorkshopRecord>((from, to) => supabase
    .from('workshop_status_records')
    .select(RECORD_COLS)
    .eq('current_active', true)
    .is('deleted_at', null)
    .order('asset_no', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: WorkshopRecord[] | null; error: any }>,
  { max: MAX_ROWS })
}

/** One record by id (any state - a released vehicle still opens read-only). */
export async function getRecord(id: string): Promise<WorkshopRecord | null> {
  if (!id) return null
  const { data, error } = await supabase
    .from('workshop_status_records')
    .select(RECORD_COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return (data as unknown as WorkshopRecord) ?? null
}

/** The active record for an asset number, when a notification names only the asset. */
export async function findActiveByAsset(assetNo: string): Promise<WorkshopRecord | null> {
  const a = String(assetNo || '').trim()
  if (!a) return null
  const { data, error } = await supabase
    .from('workshop_status_records')
    .select(RECORD_COLS)
    .eq('asset_no', a)
    .eq('current_active', true)
    .is('deleted_at', null)
    .order('id', { ascending: true })
    .limit(1)
  if (error) throw error
  return ((data as unknown as WorkshopRecord[]) || [])[0] ?? null
}

/** My Workshop Status permissions. A failed read FAILS CLOSED (all false). */
export async function loadPermissions(): Promise<WorkshopPerms> {
  try {
    const { data, error } = await supabase.rpc('workshop_status_my_permissions')
    if (error) return shapePermissions(null)
    return shapePermissions(data)
  } catch {
    return shapePermissions(null)
  }
}

/**
 * Save a manual update. `expectedUpdatedAt` must be the record's updated_at
 * EXACTLY as read from the server (a JS Date drops microseconds and would read
 * as stale every time). Throws WorkshopStatusError('record_changed') when
 * someone else saved first.
 */
export async function updateRecord(
  recordId: string,
  patch: Record<string, string | null>,
  expectedUpdatedAt: string | null,
): Promise<unknown> {
  const { data, error } = await supabase.rpc('workshop_status_update_record', {
    p_record_id: recordId,
    p_patch: patch,
    p_expected_updated_at: expectedUpdatedAt,
  })
  if (error) {
    if (isStaleError(error)) throw new WorkshopStatusError('record_changed', 'record_changed')
    throw error
  }
  return data
}

export interface Person { id: string; name: string }

/** People who can be named responsible / supporting (approved, unlocked). */
export async function listAssignablePeople(): Promise<Person[]> {
  const rows = await fetchAllRows<{ id: string; full_name: string | null; username: string | null }>((from, to) => supabase
    .from('profiles')
    .select('id,full_name,username')
    .eq('approved', true)
    .eq('locked', false)
    .order('id', { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: any[] | null; error: any }>,
  { max: 5000 })
  return rows
    .map((r) => ({ id: r.id, name: (r.full_name || r.username || '').trim() }))
    .filter((p) => p.id && p.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** id -> display name for the given profile ids. Best effort: {} on failure. */
export async function loadPeopleNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = Array.from(new Set(ids.filter((v): v is string => !!v)))
  const out: Record<string, string> = {}
  for (let i = 0; i < list.length; i += 200) {
    try {
      const { data, error } = await supabase
        .from('profiles').select('id,full_name,username').in('id', list.slice(i, i + 200)).limit(200)
      if (error) return out
      for (const p of (data as any[]) || []) out[p.id] = (p.full_name || p.username || '').trim()
    } catch {
      return out
    }
  }
  return out
}
