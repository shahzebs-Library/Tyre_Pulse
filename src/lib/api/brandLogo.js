/**
 * Company logo service - the single Supabase boundary for the org-wide brand
 * logo shown on every shared TV report and public report link.
 *
 * The logo is stored ONCE by a super-admin in `system_config` under the key
 * `company_logo`. The public TV viewer reads it server-side inside the
 * `get_report_snapshot` RPC, so this module owns only the SET/GET side used by
 * the console. Super-admin RLS on `system_config` governs writes; this layer
 * never re-implements that gate - it only relocates the call and normalises
 * error surfacing (mirrors the report-palette save in ConsoleReportAppearance).
 *
 * getCompanyLogo never throws (returns '' on any error) so the console can
 * degrade to an honest "No logo set" state. setCompanyLogo validates the URL
 * (http/https or a data:image URI only) and throws a ServiceError on a bad URL
 * or a failed write so the page can report it.
 */
import { supabase, ServiceError } from './_client'

/** system_config key that both this service and get_report_snapshot read. */
export const LOGO_CONFIG_KEY = 'company_logo'

/**
 * Return true when `url` is safe to store as a company logo image source: an
 * absolute http(s) URL or a `data:image/*` URI. Everything else (javascript:,
 * data:text/html, relative paths, blobs, other schemes) is rejected - the
 * value is persisted and later rendered on a public page, so it must be a real,
 * fetchable image reference.
 *
 * @param {string} url trimmed candidate URL
 * @returns {boolean}
 */
export function isValidLogoUrl(url) {
  if (typeof url !== 'string') return false
  const s = url.trim()
  if (s === '') return false
  if (/^https?:\/\/./i.test(s)) return true
  if (/^data:image\/[a-z0-9.+-]+;/i.test(s)) return true
  return false
}

/**
 * Read the current company logo URL from `system_config.company_logo`.
 * Never throws - returns '' on a missing row or any error.
 *
 * @returns {Promise<string>} the stored logo URL, or '' when none/on error
 */
export async function getCompanyLogo() {
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('value_text, value')
      .eq('key', LOGO_CONFIG_KEY)
      .maybeSingle()
    if (error) return ''
    const url = data?.value_text ?? data?.value ?? ''
    return typeof url === 'string' ? url : ''
  } catch {
    return ''
  }
}

/**
 * Store (or clear) the org-wide company logo URL in `system_config.company_logo`
 * via an upsert - the exact pattern the report-palette save uses. Passing an
 * empty string clears the logo. Any non-empty value must be an http(s) URL or a
 * data:image URI, else a ServiceError is thrown. Throws a ServiceError on a
 * failed write too.
 *
 * @param {string} url the logo URL to persist ('' to clear)
 * @returns {Promise<{ ok: true }>}
 */
export async function setCompanyLogo(url) {
  const value = typeof url === 'string' ? url.trim() : ''
  if (value !== '' && !isValidLogoUrl(value)) {
    throw new ServiceError(
      'Enter a valid image URL (http, https, or a data:image URI).',
      'invalid_logo_url',
    )
  }
  const { error } = await supabase
    .from('system_config')
    .upsert(
      [{ key: LOGO_CONFIG_KEY, value_text: value, value, updated_at: new Date().toISOString() }],
      { onConflict: 'key', ignoreDuplicates: false },
    )
  if (error) throw new ServiceError(error.message, error.code, error)
  return { ok: true }
}
