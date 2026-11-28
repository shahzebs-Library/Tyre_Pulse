/**
 * Service for accident ownership + notification settings and the task views.
 * Tables / RPCs: accident_team_roles, accident_notify_rules,
 * accident_team_role_preview, accident_my_tasks, accident_task_holdings,
 * accident_ws_assign (existing reassign RPC).
 *
 * Every read degrades to "not provisioned" (ok:false) when the migration is not
 * applied yet, so a screen can say so instead of failing.
 */
import { supabase, unwrap, isNotProvisioned, toServiceError } from './_client'

const TEAM_COLS =
  'id,workstream_key,country,site,owner_role,owner_user_ids,sla_minutes_minor,' +
  'sla_minutes_moderate,sla_minutes_major,warning_pct,active,updated_at'
const RULE_COLS =
  'id,event_key,name,notify_owner,roles,user_ids,notify_driver,only_when_serious,' +
  'serious_cost,channel_in_app,channel_push,stalled_days,active,updated_at'

async function readOrNotProvisioned(fn) {
  try {
    return { ok: true, rows: (await fn()) || [] }
  } catch (err) {
    if (isNotProvisioned(err)) return { ok: false, rows: [] }
    throw err
  }
}

export function listTeamRoles() {
  return readOrNotProvisioned(async () => unwrap(
    await supabase.from('accident_team_roles').select(TEAM_COLS)
      .order('workstream_key').order('country', { nullsFirst: true }).order('site', { nullsFirst: true })))
}

export async function saveTeamRole(row) {
  const values = {
    workstream_key: row.workstream_key,
    country: row.country || null,
    site: row.site || null,
    owner_role: row.owner_role || null,
    owner_user_ids: Array.isArray(row.owner_user_ids) ? row.owner_user_ids : [],
    sla_minutes_minor: row.sla_minutes_minor ?? null,
    sla_minutes_moderate: row.sla_minutes_moderate ?? null,
    sla_minutes_major: row.sla_minutes_major ?? null,
    warning_pct: row.warning_pct ?? 80,
    active: row.active !== false,
  }
  const q = row.id
    ? supabase.from('accident_team_roles').update(values).eq('id', row.id)
    : supabase.from('accident_team_roles').insert(values)
  return unwrap(await q.select(TEAM_COLS).single())
}

export async function removeTeamRole(id) {
  return unwrap(await supabase.from('accident_team_roles').delete().eq('id', id))
}

export function listNotifyRules() {
  return readOrNotProvisioned(async () => unwrap(
    await supabase.from('accident_notify_rules').select(RULE_COLS).order('event_key').order('name')))
}

export async function saveNotifyRule(row) {
  const values = {
    event_key: row.event_key,
    name: row.name || null,
    notify_owner: row.notify_owner === true,
    roles: Array.isArray(row.roles) ? row.roles : [],
    user_ids: Array.isArray(row.user_ids) ? row.user_ids : [],
    notify_driver: row.notify_driver === true,
    only_when_serious: row.only_when_serious === true,
    serious_cost: row.serious_cost ?? 20000,
    channel_in_app: row.channel_in_app !== false,
    channel_push: row.channel_push !== false,
    stalled_days: row.stalled_days ?? null,
    active: row.active !== false,
  }
  const q = row.id
    ? supabase.from('accident_notify_rules').update(values).eq('id', row.id)
    : supabase.from('accident_notify_rules').insert(values)
  return unwrap(await q.select(RULE_COLS).single())
}

export async function removeNotifyRule(id) {
  return unwrap(await supabase.from('accident_notify_rules').delete().eq('id', id))
}

/** People who could be named as owners or recipients (active, approved). */
export async function listAssignablePeople() {
  const rows = unwrap(await supabase.from('profiles')
    .select('id,full_name,username,role,country,site,locked')
    .eq('approved', true)
    .neq('role', 'Driver')
    .order('full_name')
    .limit(500))
  return (rows || []).filter((p) => p && (p.locked !== true))
}

/** "Will notify N people, M have a phone" for a role + named people in scope. */
export async function previewTeamRole({ role, country, site, userIds }) {
  const { data, error } = await supabase.rpc('accident_team_role_preview', {
    p_role: role || null, p_country: country || null, p_site: site || null,
    p_user_ids: Array.isArray(userIds) ? userIds : [],
  })
  if (error) throw toServiceError(error, 'Could not preview this owner.')
  return data || { people: 0, with_device: 0, names: [] }
}

export function listMyAccidentTasks() {
  return readOrNotProvisioned(async () => {
    const { data, error } = await supabase.rpc('accident_my_tasks')
    if (error) throw error
    return data
  })
}

export function listAccidentTaskHoldings() {
  return readOrNotProvisioned(async () => {
    const { data, error } = await supabase.rpc('accident_task_holdings')
    if (error) throw error
    return data
  })
}

/** One-click reassign of a step through the existing guarded RPC. */
export async function reassignStep(accidentId, workstreamKey, { ownerId = null, ownerRole = null } = {}) {
  const { error } = await supabase.rpc('accident_ws_assign', {
    p_accident_id: accidentId,
    p_workstream_key: workstreamKey,
    p_owner_id: ownerId,
    p_owner_role: ownerRole,
    p_team: ownerRole,
  })
  if (error) throw toServiceError(error, 'Could not reassign this step.')
  return true
}
