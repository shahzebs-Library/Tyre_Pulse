/**
 * Onboarding readiness facts - the read-only Supabase boundary behind the
 * Onboarding Wizard's go-live checks. Every fact is measured from a real table
 * (RLS scopes each read to the caller's organisation and country). A read that
 * fails returns `null` for that fact, never 0, so the page reports "could not
 * check" instead of a false gap.
 *
 * Counts use head-only exact counts on small tables and a single-row probe
 * (`limit 1`) on large ones, so the whole set is cheap.
 */
import { supabase, applyCountry, fetchAllPages } from './_client'
import { getOrgBranding } from './branding'
import { getCompanyLogo } from './brandLogo'
import { ACCESS_ROLES } from '../moduleCatalog'
import { CHECKLIST_ONLY_ROLES } from '../checklistAccess'

const BUILTIN_ROLES = new Set([...ACCESS_ROLES, ...CHECKLIST_ONLY_ROLES, 'Store Keeper', 'Super Admin'])

async function count(table, build = (q) => q) {
  try {
    const { count: n, error } = await build(supabase.from(table).select('id', { count: 'exact', head: true }))
    return error ? null : (n ?? 0)
  } catch { return null }
}

async function exists(table, build = (q) => q) {
  try {
    const { data, error } = await build(supabase.from(table).select('id')).limit(1)
    return error ? null : (Array.isArray(data) && data.length > 0)
  } catch { return null }
}

const blank = (v) => v == null || (Array.isArray(v) ? v.filter((x) => String(x || '').trim()).length === 0 : !String(v).trim())

/**
 * Pure: from profile rows and role-matrix rows, the user-and-role facts.
 * Exported for tests.
 */
export function userRoleFacts(profiles, matrix) {
  const out = { approvedUsers: null, pendingUsers: null, unscopedUsers: null, matrixRows: null, customRolesWithoutModules: null }
  if (Array.isArray(profiles)) {
    const active = profiles.filter((p) => !p.locked)
    out.approvedUsers = active.filter((p) => p.approved).length
    out.pendingUsers = active.filter((p) => !p.approved).length
    out.unscopedUsers = active.filter((p) => p.approved && !p.is_super_admin && p.role !== 'Admin'
      && (blank(p.country) || blank(p.sites))).length
  }
  if (Array.isArray(matrix)) {
    out.matrixRows = matrix.filter((m) => m.enabled).length
    if (Array.isArray(profiles)) {
      const enabledRoles = new Set(matrix.filter((m) => m.enabled).map((m) => m.role))
      const inUse = new Set(profiles.filter((p) => p.approved && !p.locked && p.role).map((p) => p.role))
      out.customRolesWithoutModules = [...inUse].filter((r) => !BUILTIN_ROLES.has(r) && !enabledRoles.has(r)).sort()
    }
  }
  return out
}

/** Load every readiness fact for the active country ('All' = no filter). */
export async function loadReadinessFacts(country) {
  const scoped = (q) => applyCountry(q, country)
  const [
    branding, logo, sites, sitesWithRegion, fleet, fleetUntyped, tyres, inspections,
    hasWorkOrders, hasExpenses, hasImportBatches, apiKeys, devices, profilesRes, matrixRes,
  ] = await Promise.all([
    getOrgBranding().catch(() => null),
    getCompanyLogo().catch(() => null),
    count('sites', scoped),
    count('sites', (q) => scoped(q).not('region', 'is', null).neq('region', '')),
    count('vehicle_fleet', scoped),
    count('vehicle_fleet', (q) => scoped(q).or('vehicle_type.is.null,vehicle_type.eq.')),
    count('tyre_records', scoped),
    count('inspections', scoped),
    exists('work_orders', scoped),
    exists('parts_consumption', scoped),
    exists('import_batches'),
    count('api_keys', (q) => q.eq('active', true)),
    count('user_devices', (q) => q.eq('revoked', false)),
    fetchAllPages((from, to) => supabase.from('profiles')
      .select('id,role,approved,locked,country,sites,is_super_admin')
      .order('id').range(from, to), { max: 20000 }).catch((e) => ({ error: e })),
    fetchAllPages((from, to) => supabase.from('module_permissions')
      .select('role,module_key,org_id,enabled')
      .order('role').order('module_key').order('org_id').range(from, to), { max: 20000 }).catch((e) => ({ error: e })),
  ])
  const profiles = profilesRes?.error ? null : profilesRes?.data || []
  const matrix = matrixRes?.error ? null : matrixRes?.data || []
  return {
    orgNamed: branding && typeof branding === 'object'
      ? !!(String(branding.legal_name || '').trim() || String(branding.display_name || '').trim())
      : null,
    companyLogo: logo == null ? null : !!String(logo).trim(),
    sites, sitesWithRegion, fleet, fleetUntyped, tyres, inspections,
    hasWorkOrders, hasExpenses, hasImportBatches, apiKeys, devices,
    ...userRoleFacts(profiles, matrix),
  }
}
