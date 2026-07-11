/**
 * Tenant branding service — the single Supabase boundary for per-organisation
 * report branding (legal name, colours, logo, report theme, footer, disclaimer,
 * contact block). Reads/writes go through the server-side RPCs `get_org_branding`
 * / `set_org_branding` (V68), which enforce org-admin authorisation and validate
 * colours/theme on the server. The browser never writes `organisations` directly.
 */
import { supabase, unwrap } from './_client'

/** Default palette used when an org has not configured branding yet. */
export const DEFAULT_BRANDING = Object.freeze({
  legal_name: '',
  display_name: '',
  primary_color: '#16A34A',
  secondary_color: '#0F172A',
  accent_color: '#22C55E',
  logo_url: '',
  report_theme: 'light',
  footer_text: '',
  disclaimer: '',
  address: '',
  contact_email: '',
  contact_phone: '',
  website: '',
  logos: {},          // placement map: slot → asset id | URL (V120)
})

/** Editable field keys sent to `set_org_branding` (order = form order). */
export const BRANDING_FIELDS = [
  'legal_name', 'display_name',
  'primary_color', 'secondary_color', 'accent_color',
  'logo_url', 'report_theme',
  'footer_text', 'disclaimer',
  'address', 'contact_email', 'contact_phone', 'website',
]

/**
 * Read branding for an org. Pass no id to read the caller's own org.
 * Returns the merged branding object (may be `{}` if the caller has no org).
 */
export async function getOrgBranding(orgId = null) {
  return unwrap(await supabase.rpc('get_org_branding', { p_org_id: orgId }))
}

/**
 * Persist branding for an org. Only the whitelisted `BRANDING_FIELDS` are sent;
 * the server re-validates and stamps `updated_at`/`updated_by`.
 * @param {string} orgId
 * @param {object} branding
 * @returns {Promise<object>} the merged branding as stored
 */
export async function setOrgBranding(orgId, branding) {
  const payload = {}
  for (const k of BRANDING_FIELDS) {
    const v = branding?.[k]
    if (v !== undefined && v !== null) payload[k] = typeof v === 'string' ? v.trim() : v
  }
  // Logo placement map (V120). Only sent when explicitly provided so callers
  // that don't manage placements (e.g. the colour/report editor) leave the
  // stored logos untouched — the server preserves them when the key is absent.
  if (branding?.logos && typeof branding.logos === 'object') {
    const logos = {}
    for (const [slot, val] of Object.entries(branding.logos)) {
      const s = typeof val === 'string' ? val.trim() : ''
      if (s) logos[slot] = s
    }
    payload.logos = logos
  }
  return unwrap(await supabase.rpc('set_org_branding', { p_org_id: orgId, p_branding: payload }))
}

/** Merge stored branding over the defaults so the UI always has every field. */
export function withBrandingDefaults(branding) {
  return { ...DEFAULT_BRANDING, ...(branding || {}), logos: { ...(branding?.logos || {}) } }
}
