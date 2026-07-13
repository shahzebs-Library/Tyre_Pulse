/**
 * SSO Configuration service — the single seam between the SSO Configuration page
 * (/sso-configuration) and Supabase (table `sso_connections`, V200). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping, and
 * input validation. RLS enforces org isolation and privileged writes (Admin/
 * Manager/Director); this layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `sso_connections` relation (org has not run
 * the migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 *
 * SECURITY: this service never accepts or persists private keys or client
 * secrets — only public connection metadata. Whitelisted enums (protocol,
 * status) are validated against the DB CHECK constraints before insert/update.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../ssoConfig'
import { safeHref } from '../safeUrl'

/** Scheme-guard a URL on write: safe → the string, anything unsafe/blank → null. */
const asUrl = (v) => { const s = safeHref(v); return s === undefined ? null : s }

export const COLS =
  'id,organisation_id,country,connection_name,protocol,idp_provider,idp_entity_id,' +
  'sso_url,domains,default_role,enforce_sso,jit_provisioning,cert_expiry,status,' +
  'last_login_at,notes,created_by,created_at,updated_at'

/** Whitelisted enum values — must match the V200 CHECK constraints exactly. */
const PROTOCOLS = new Set(['saml', 'oidc', 'oauth2'])
const STATUSES = new Set(['draft', 'active', 'disabled', 'error'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('sso_connections'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asBool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on'
const asEnum = (v, set) => {
  const s = v == null ? '' : String(v).trim().toLowerCase()
  return set.has(s) ? s : null
}

/**
 * List SSO connections (by connection_name asc, then created_at desc). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listSsoConnections({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('sso_connections').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('connection_name', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getSsoConnection(id) {
  return unwrap(await supabase.from('sso_connections').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create an SSO connection. Requires a connection name. Protocol and status are
 * whitelisted against the DB CHECK constraints; the enforce_sso and
 * jit_provisioning flags are coerced to booleans. Secrets are never accepted.
 */
export async function createSsoConnection(values = {}) {
  const connection_name = asText(values.connection_name, 200)
  if (!connection_name) throw new Error('A connection name is required.')

  const payload = {
    connection_name,
    protocol: asEnum(values.protocol, PROTOCOLS),
    idp_provider: asText(values.idp_provider, 200),
    idp_entity_id: asText(values.idp_entity_id, 500),
    sso_url: asUrl(asText(values.sso_url, 1000)),
    domains: asText(values.domains, 2000),
    default_role: asText(values.default_role, 120),
    enforce_sso: asBool(values.enforce_sso),
    jit_provisioning: asBool(values.jit_provisioning),
    cert_expiry: asDate(values.cert_expiry),
    status: asEnum(values.status, STATUSES) || 'draft',
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('sso_connections').insert(payload).select(COLS).single())
}

/**
 * Patch an SSO connection. Strips immutable/ownership fields (id, organisation_id,
 * created_by, created_at, updated_at); coerces each field present so the stored
 * value never drifts from the validated shape. Secrets are never accepted.
 */
export async function updateSsoConnection(id, patch = {}) {
  const clean = {}
  if (patch.connection_name !== undefined) {
    const connection_name = asText(patch.connection_name, 200)
    if (!connection_name) throw new Error('A connection name is required.')
    clean.connection_name = connection_name
  }
  if (patch.protocol !== undefined) clean.protocol = asEnum(patch.protocol, PROTOCOLS)
  if (patch.idp_provider !== undefined) clean.idp_provider = asText(patch.idp_provider, 200)
  if (patch.idp_entity_id !== undefined) clean.idp_entity_id = asText(patch.idp_entity_id, 500)
  if (patch.sso_url !== undefined) clean.sso_url = asUrl(asText(patch.sso_url, 1000))
  if (patch.domains !== undefined) clean.domains = asText(patch.domains, 2000)
  if (patch.default_role !== undefined) clean.default_role = asText(patch.default_role, 120)
  if (patch.enforce_sso !== undefined) clean.enforce_sso = asBool(patch.enforce_sso)
  if (patch.jit_provisioning !== undefined) clean.jit_provisioning = asBool(patch.jit_provisioning)
  if (patch.cert_expiry !== undefined) clean.cert_expiry = asDate(patch.cert_expiry)
  if (patch.status !== undefined) clean.status = asEnum(patch.status, STATUSES) || 'draft'
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('sso_connections').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteSsoConnection(id) {
  return unwrap(await supabase.from('sso_connections').delete().eq('id', id))
}
