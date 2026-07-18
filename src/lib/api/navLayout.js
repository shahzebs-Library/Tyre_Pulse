/**
 * Nav layout service — the single Supabase boundary for the org-wide sidebar
 * customization set by a super-admin in the console Navigation Customizer.
 *
 * The layout is stored ONCE in `system_config` under key `nav_layout` (JSON),
 * mirroring the report-palette / company-logo pattern: super-admin RLS governs
 * writes, authenticated read. This module never re-implements that gate — it only
 * relocates the call, normalizes the payload via the pure engine, and caches the
 * read so the Layout shell can load it once per session.
 *
 * getNavLayout never throws (returns {} on any error → applyNavLayout yields the
 * built-in defaults, so a missing/broken row is a no-op). saveNavLayout upserts
 * the normalized layout and throws a ServiceError on a failed write.
 */
import { supabase, ServiceError } from './_client'
import { normalizeNavLayout } from '../navLayout'

/** system_config key holding the org-wide nav overlay. */
export const NAV_LAYOUT_CONFIG_KEY = 'nav_layout'

// Session cache: the sidebar loads the layout on every mount; keep it to one
// network round-trip. Invalidated on save so the editor sees its own write.
let _cache

/**
 * Read the persisted nav layout from `system_config.nav_layout`. Cached for the
 * session. Never throws — returns {} (→ defaults) on a missing row or any error.
 *
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<object>} normalized layout, or {} when none/on error
 */
export async function getNavLayout({ force = false } = {}) {
  if (_cache && !force) return _cache
  _cache = (async () => {
    try {
      const { data, error } = await supabase
        .from('system_config')
        .select('value, value_text')
        .eq('key', NAV_LAYOUT_CONFIG_KEY)
        .maybeSingle()
      if (error) return {}
      const raw = data?.value ?? data?.value_text
      if (raw == null || raw === '') return {}
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      return normalizeNavLayout(parsed)
    } catch {
      return {}
    }
  })()
  return _cache
}

/** Drop the cached layout so the next getNavLayout() re-reads from the DB. */
export function invalidateNavLayout() {
  _cache = undefined
}

/**
 * Persist the org-wide nav layout via an upsert (super-admin RLS enforced by the
 * DB). The layout is normalized before write, so only valid entries are stored.
 * Throws a ServiceError on a failed write.
 *
 * @param {object} layout the editor-produced layout
 * @returns {Promise<{ok:true, layout:object}>}
 */
export async function saveNavLayout(layout) {
  const clean = normalizeNavLayout(layout)
  const value = JSON.stringify(clean)
  const { error } = await supabase
    .from('system_config')
    .upsert(
      [{ key: NAV_LAYOUT_CONFIG_KEY, value, value_text: value, updated_at: new Date().toISOString() }],
      { onConflict: 'key', ignoreDuplicates: false },
    )
  if (error) throw new ServiceError(error.message, error.code, error)
  _cache = Promise.resolve(clean) // keep the cache in sync with the write
  return { ok: true, layout: clean }
}
