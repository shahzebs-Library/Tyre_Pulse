/**
 * consolePlatform service - the single Supabase boundary for the Control Center
 * PLATFORM screens (Users, User detail, Organizations, Billing, Settings).
 *
 * Reads that need auth.users or cross-table counts go through super-admin
 * SECURITY DEFINER RPCs (migrations 20260930170000, 20260930171000,
 * 20260930172000). Everything else reads tables under RLS. Every failure is a
 * ServiceError with a message safe to show; no database text reaches the UI.
 */
import { supabase, unwrap, ServiceError, fetchAllOrThrow } from './_client'
import { toUserMessage } from '../safeError'

async function rpc(name, args, fallback) {
  let res
  try {
    res = await supabase.rpc(name, args)
  } catch (err) {
    throw new ServiceError(toUserMessage(err, fallback), err?.code, err)
  }
  if (res?.error) throw new ServiceError(toUserMessage(res.error, fallback), res.error.code, res.error)
  return res?.data ?? null
}

const PROFILE_COLS =
  'id,username,full_name,role,employee_id,approved,locked,is_super_admin,country,site,sites,region,' +
  'email,phone,organisation_id,org_id,web_access,created_at,updated_at,notes'

/** Every profile (paged past the 1000-row cap). */
export async function listPlatformProfiles() {
  return fetchAllOrThrow((from, to) => supabase
    .from('profiles')
    .select(PROFILE_COLS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to), { max: 50000 })
}

export async function getPlatformProfile(id) {
  const res = await supabase.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle()
  if (res.error) throw new ServiceError(toUserMessage(res.error, 'Could not load this person.'), res.error.code, res.error)
  return res.data
}

/** { people:[{id,last_sign_in_at,mfa,phones,app_version,...}] } */
export async function getUserDirectory() {
  const data = await rpc('admin_user_directory', {}, 'Could not load sign-in and phone details.')
  return Array.isArray(data?.people) ? data.people : []
}

export async function listAccountsWithoutProfile() {
  const data = await rpc('admin_accounts_without_profile', {}, 'Could not load sign-in accounts.')
  return Array.isArray(data?.accounts) ? data.accounts : []
}

export async function getUserHealth(id) {
  return rpc('admin_user_health', { p_user: id }, 'Could not load this person\'s record.')
}

export async function getOrgOverview() {
  const data = await rpc('admin_org_overview', {}, 'Could not load organization figures.')
  return Array.isArray(data?.orgs) ? data.orgs : []
}

export async function listOrgsFull() {
  return unwrap(await supabase
    .from('organisations')
    .select('id,name,slug,plan,active,locked,max_users,country,countries,primary_country,contact_email,created_at,updated_at,notes')
    .order('created_at', { ascending: true }))
}

export async function listPlans() {
  return unwrap(await supabase
    .from('subscription_plans')
    .select('id,code,name,description,price_monthly,price_annual,currency,max_vehicles,max_users,max_api_keys,max_storage_gb,features,is_public,sort_order,active')
    .order('sort_order', { ascending: true }))
}

/** Row counts for billing tables; null when a read fails. */
export async function billingCounts() {
  const count = async (table, filter) => {
    try {
      let q = supabase.from(table).select('id', { count: 'exact', head: true })
      if (filter) q = filter(q)
      const { count: n, error } = await q
      return error ? null : (n ?? 0)
    } catch { return null }
  }
  const [subs, invoices, pastDue, apiKeys, trialing] = await Promise.all([
    count('org_subscriptions'),
    count('invoices'),
    count('invoices', (q) => q.eq('status', 'past_due')),
    count('api_keys'),
    count('org_subscriptions', (q) => q.eq('status', 'trialing')),
  ])
  return { subs, invoices, pastDue, apiKeys, trialing }
}

/** Latest device-version rule for the phone app. */
export async function getMobileMinVersion() {
  const res = await supabase.from('system_config').select('key,value').in('key', ['mobile_min_version', 'mobile_latest_version'])
  if (res.error) return { min: null, latest: null }
  const m = Object.fromEntries((res.data || []).map((r) => [r.key, r.value]))
  return { min: m.mobile_min_version || null, latest: m.mobile_latest_version || null }
}

/* ── settings ────────────────────────────────────────────────────────────── */

export async function listConfigRows() {
  return unwrap(await supabase
    .from('system_config')
    .select('key,value,category,description,updated_at,updated_by')
    .order('key', { ascending: true }))
}

/** Change history (recorded since 30 Sep 2026). key null = every setting. */
export async function listConfigHistory({ key = null, limit = 500 } = {}) {
  let q = supabase
    .from('system_config_history')
    .select('id,key,action,old_value,new_value,changed_by,reason,changed_at')
    .order('changed_at', { ascending: false })
    .limit(limit)
  if (key) q = q.eq('key', key)
  return unwrap(await q)
}

/** Console audit rows for config saves (older, no key or old value). */
export async function listConsoleConfigSaves({ limit = 50 } = {}) {
  return unwrap(await supabase
    .from('console_sessions')
    .select('id,action,details,created_at,admin_id')
    .in('action', ['update_config', 'set_config'])
    .order('created_at', { ascending: false })
    .limit(limit))
}

/** Save one setting with a reason; the database records who, old, new and why. */
export async function setConfigWithReason(key, value, reason) {
  return rpc('admin_set_config', {
    p_key: key,
    p_value: typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value ?? ''),
    p_reason: reason,
  }, 'Could not save the setting. Nothing was changed.')
}

/** { id: full_name } for the people named in a history list. */
export async function namesFor(ids = []) {
  const list = [...new Set((ids || []).filter(Boolean))]
  if (!list.length) return {}
  const res = await supabase.from('profiles').select('id,full_name').in('id', list.slice(0, 500)).limit(500)
  if (res.error) return {}
  return Object.fromEntries((res.data || []).map((r) => [r.id, r.full_name]))
}

export async function countVehicleDesigns() {
  try {
    const { count, error } = await supabase.from('vehicle_diagram_configs').select('id', { count: 'exact', head: true })
    return error ? null : (count ?? 0)
  } catch { return null }
}

/** Sentry connection status only (never the token). */
export async function getSentryStatusSafe() {
  try {
    const { data, error } = await supabase.rpc('get_sentry_config_status')
    return error ? null : (data || null)
  } catch { return null }
}

/* ── people actions ──────────────────────────────────────────────────────── */

/** Lock or unlock one person through the existing admin RPC (audited). */
export async function setPersonLocked(userId, locked, reason) {
  return rpc('admin_mobile_user_action', {
    p_user_id: userId, p_action: locked ? 'lock' : 'unlock', p_reason: reason || null, p_role: null,
  }, locked ? 'Could not lock this account.' : 'Could not unlock this account.')
}

export async function approvePerson(userId, reason) {
  return rpc('admin_mobile_user_action', {
    p_user_id: userId, p_action: 'approve', p_reason: reason || null, p_role: null,
  }, 'Could not approve this account.')
}

/** A reminder that lands in the person's app bell; audited with the reason. */
export async function sendPersonReminder(userId, { title, body, reason, copyTo = null }) {
  return rpc('admin_send_person_reminder', {
    p_user: userId, p_title: title, p_body: body, p_reason: reason, p_copy_to: copyTo,
  }, 'Could not send the reminder. Nothing was sent.')
}

/* ── organizations and billing ───────────────────────────────────────────── */

/** Subscriptions per organization (0 rows today: billing is not live). null on a failed read. */
export async function listOrgSubscriptions() {
  try {
    const { data, error } = await supabase
      .from('org_subscriptions')
      .select('id,organisation_id,plan_code,status,billing_interval,seats,trial_ends_at,current_period_end,cancel_at_period_end')
    return error ? null : (data || [])
  } catch { return null }
}

/** One system_config value, or null when missing / unreadable. */
export async function getConfigValue(key) {
  try {
    const { data, error } = await supabase.from('system_config').select('value').eq('key', key).maybeSingle()
    return error ? null : (data?.value ?? null)
  } catch { return null }
}

/**
 * Archive one EMPTY organization: sets active = false. Nothing is deleted and it
 * can be reactivated from Edit. Refuses when the organization has members or
 * records, so a company with data can never be archived from here.
 */
export async function archiveEmptyOrg(org, stats) {
  const records = stats ? (stats.vehicles + stats.tyre_records + stats.job_cards + stats.expense_lines + stats.inspections) : null
  if (!stats || stats.members !== 0 || records !== 0) {
    throw new ServiceError('Only an organization with no members and no records can be archived here.')
  }
  return unwrap(await supabase.from('organisations').update({ active: false }).eq('id', org.id).select('id').single())
}

/** Active API keys per organization: { orgId: n }. null on a failed read. */
export async function apiKeysByOrg() {
  try {
    const { data, error } = await supabase.from('api_keys').select('organisation_id,active,revoked_at')
    if (error) return null
    const out = {}
    for (const r of data || []) if (r.active !== false && !r.revoked_at) out[r.organisation_id] = (out[r.organisation_id] || 0) + 1
    return out
  } catch { return null }
}
