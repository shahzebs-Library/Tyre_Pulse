/**
 * Access Policies service (console IP allowlist + SSO enforcement).
 * Migration: supabase/migrations/20260924117000_access_policies.sql.
 *
 * Every admin_* RPC is SECURITY DEFINER and refuses anyone who is not a super
 * admin (42501). The two runtime checks used by the sign-in flows FAIL OPEN on
 * any error by design: a bug or an outage must never lock the owner out. The
 * server itself is strict; failing open only means a broken check is skipped.
 */
import { supabase, unwrap } from './_client'

// Short sentences the RPCs raise themselves (22023). They carry a code, so the
// generic sanitiser would hide them; pass through only ones we wrote.
const OWN = [
  /^Give /, /^That /, /^A \/0 range/, /^Your current IP/, /^This organisation/,
  /^These domains are not registered/, /^The console IP allowlist can only/,
]

async function call(fn, args) {
  const res = await supabase.rpc(fn, args)
  if (res?.error) {
    const msg = typeof res.error.message === 'string' ? res.error.message.trim() : ''
    if (msg && OWN.some((re) => re.test(msg))) throw new Error(msg)
  }
  return unwrap(res)
}

/** Read the whole policy picture for the console page. */
export async function getAccessPolicies() {
  const raw = (await call('admin_get_access_policies', {})) || {}
  const ip = raw.ip || {}
  const sso = raw.sso || {}
  return {
    ip: {
      enabled: ip.enabled === true,
      callerIp: ip.caller_ip || null,
      callerCovered: ip.caller_covered === true,
      entries: Array.isArray(ip.entries) ? ip.entries : [],
    },
    sso: {
      registeredProviders: Number(sso.registered_providers) || 0,
      registeredDomains: Array.isArray(sso.registered_domains) ? sso.registered_domains : [],
      orgs: Array.isArray(sso.orgs) ? sso.orgs : [],
    },
  }
}

export async function addAllowlistEntry(label, cidr) {
  return call('admin_ip_allowlist_add', { p_label: label, p_cidr: cidr })
}

export async function setAllowlistEntryActive(id, active) {
  return call('admin_ip_allowlist_set_active', { p_id: id, p_active: !!active })
}

export async function deleteAllowlistEntry(id) {
  return call('admin_ip_allowlist_delete', { p_id: id })
}

export async function setConsoleIpAllowlist(enabled, reason) {
  return call('admin_set_console_ip_allowlist', { p_enabled: !!enabled, p_reason: reason || '' })
}

export async function setSsoRequired(orgId, required, reason) {
  return call('admin_set_sso_required', { p_org: orgId, p_required: !!required, p_reason: reason || '' })
}

/**
 * Console IP gate. FAILS OPEN: any RPC error or unexpected shape returns
 * allowed:true with failedOpen:true, so a bug in the check can never lock a
 * super admin out of the console. Only an explicit allowed:false blocks.
 */
export async function checkConsoleAccess() {
  try {
    const { data, error } = await supabase.rpc('console_check_access')
    if (error || !data || typeof data !== 'object') return { allowed: true, failedOpen: true }
    return {
      allowed: data.allowed !== false,
      enabled: data.enabled === true,
      reason: data.reason || null,
      ip: data.ip || null,
      failedOpen: false,
    }
  } catch {
    return { allowed: true, failedOpen: true }
  }
}

/**
 * Main-app SSO rule, asked right after a PASSWORD sign-in succeeded. FAILS
 * OPEN on any error. Super admins are always exempt server-side.
 */
export async function checkSsoPasswordLogin() {
  try {
    const { data, error } = await supabase.rpc('sso_password_login_check')
    if (error || !data || typeof data !== 'object') return { allowed: true, failedOpen: true }
    return { allowed: data.allowed !== false, reason: data.reason || null, failedOpen: false }
  } catch {
    return { allowed: true, failedOpen: true }
  }
}
