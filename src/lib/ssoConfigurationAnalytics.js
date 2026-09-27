/**
 * SSO configuration analytics: pure presentation engine for the SSO
 * Configuration page (/sso-configuration). Builds on ./ssoConfig
 * (certStatus, certDaysRemaining, parseDomains, summariseSso, byProtocol) and
 * adds filter, KPI, certificate-attention and export shaping. No I/O; the clock
 * is injected.
 *
 * HONESTY: ratios are null (rendered N/A) with no connections; a connection
 * with no certificate expiry recorded is "No cert", never "Valid".
 */
import { summariseSso, byProtocol, certStatus, certDaysRemaining, parseDomains } from './ssoConfig'

export { byProtocol, certStatus, certDaysRemaining, parseDomains }

export const PROTOCOL_OPTIONS = [
  { value: 'saml', label: 'SAML 2.0' },
  { value: 'oidc', label: 'OpenID Connect' },
  { value: 'oauth2', label: 'OAuth 2.0' },
]
export const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'error', label: 'Error' },
]
export const PROTOCOL_LABEL = { saml: 'SAML 2.0', oidc: 'OpenID Connect', oauth2: 'OAuth 2.0', unknown: 'Unspecified' }
export const CERT_LABEL = { valid: 'Valid', expiring_soon: 'Expiring soon', expired: 'Expired', unknown: 'No cert' }

export const titleize = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '')
const truthy = (v) => v === true || v === 'true'

export function filterSso(rows = [], { protocol = '', status = '', country = '', cert = '', search = '' } = {}, now = Date.now()) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (protocol && (r.protocol || 'unknown') !== protocol) return false
    if (status && (r.status || 'unknown') !== status) return false
    if (country && r.country !== country) return false
    if (cert && certStatus(r, now) !== cert) return false
    if (q) {
      const hay = `${r.connection_name || ''} ${r.idp_provider || ''} ${r.idp_entity_id || ''} ${r.sso_url || ''} ${r.domains || ''} ${r.default_role || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Expired then expiring-soon certificates, soonest first. */
export function certAttention(rows = [], now = Date.now()) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ row: r, status: certStatus(r, now), days: certDaysRemaining(r, now) }))
    .filter((x) => x.status === 'expired' || x.status === 'expiring_soon')
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
}

/** Human text for a certificate attention item. */
export function certAttentionLabel(status, days) {
  if (days == null) return CERT_LABEL[status] || ''
  return status === 'expired' ? `Expired ${Math.abs(days)}d ago` : `Expires in ${days}d`
}

export function ssoKpis(rows = [], now = Date.now()) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseSso(list, now)
  const domains = new Set()
  let noCert = 0
  for (const r of list) {
    for (const d of parseDomains(r)) domains.add(d.toLowerCase())
    if (certStatus(r, now) === 'unknown') noCert += 1
  }
  return {
    ...base,
    enforcementRate: list.length ? Math.round((base.enforcedCount / list.length) * 1000) / 10 : null,
    domainsCovered: domains.size,
    noCertCount: noCert,
  }
}

export const EXPORT_COLS = ['connection_name', 'protocol', 'idp_provider', 'idp_entity_id', 'sso_url', 'domains', 'default_role', 'enforce_sso', 'jit_provisioning', 'status', 'cert_expiry', 'cert_status']
export const EXPORT_HEADERS = ['Connection', 'Protocol', 'IdP provider', 'Entity/Issuer ID', 'SSO URL', 'Domains', 'Default role', 'Enforced', 'JIT', 'Status', 'Cert expiry', 'Cert status']

export function ssoExportRows(rows = [], now = Date.now()) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    connection_name: r.connection_name || '',
    protocol: PROTOCOL_LABEL[r.protocol || 'unknown'] || r.protocol || '',
    idp_provider: r.idp_provider || '',
    idp_entity_id: r.idp_entity_id || '',
    sso_url: r.sso_url || '',
    domains: parseDomains(r).join(', '),
    default_role: r.default_role || '',
    enforce_sso: truthy(r.enforce_sso) ? 'Yes' : 'No',
    jit_provisioning: truthy(r.jit_provisioning) ? 'Yes' : 'No',
    status: titleize(r.status || ''),
    cert_expiry: r.cert_expiry || '',
    cert_status: CERT_LABEL[certStatus(r, now)] || '',
  }))
}
