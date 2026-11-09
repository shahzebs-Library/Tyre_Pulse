/**
 * tyreLifecycleEvents service - server reads of the Phase 3 lifecycle and site
 * history objects (migrations 20261110100000 / 20261110101000). Read-only.
 *
 * Forgiving: an RPC error degrades to { ok:false, error } (sanitised text) so a
 * panel can show an honest error state; nothing here throws.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

/** One tyre's lifecycle events by serial (and optional country). */
export async function getTyreLifecycleEvents(serial, { country } = {}) {
  const s = String(serial || '').trim()
  if (!s) return { ok: true, rows: [] }
  const { data, error } = await supabase.rpc('get_tyre_lifecycle_events', { p_serial: s, p_country: country || null })
  if (error) return { ok: false, error: toUserMessage(error, 'Could not load the tyre history.'), rows: [] }
  return { ok: true, rows: Array.isArray(data) ? data : [] }
}

/** Event counts per country and type (and ambiguity reason). */
export async function getTyreLifecycleEventCounts({ country } = {}) {
  const { data, error } = await supabase.rpc('get_tyre_lifecycle_event_counts', { p_country: country || null })
  if (error) return { ok: false, error: toUserMessage(error, 'Could not load the event counts.'), countries: [] }
  return {
    ok: true,
    countries: (Array.isArray(data) ? data : []).map((c) => ({
      country: c.country, byType: c.by_type || {}, ambiguous: c.ambiguous || {},
    })),
  }
}

/**
 * The site an asset belonged to on a date (operational attribution, opt-in).
 * Returns { ok, site, provisional, evidence }; no evidence -> site null (show N/A).
 */
export async function getAssetSiteAt(assetNo, date, { country } = {}) {
  const a = String(assetNo || '').trim()
  if (!a || !date) return { ok: true, site: null, provisional: true, evidence: 'none' }
  const { data, error } = await supabase.rpc('asset_site_at', { p_asset: a, p_country: country || null, p_date: String(date).slice(0, 10) })
  if (error) return { ok: false, error: toUserMessage(error, 'Could not load the site history.'), site: null, provisional: true, evidence: 'none' }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { ok: true, site: null, provisional: true, evidence: 'none' }
  return { ok: true, site: row.site ?? null, provisional: row.provisional !== false, evidence: row.evidence || 'none' }
}
