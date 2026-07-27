/**
 * Asset ownership service - reads the V376 `get_asset_ownership` RPC, which
 * separates which country OWNS an asset from which country BORE its cost.
 *
 * The RPC is org-scoped and self-gating (SECURITY DEFINER + app_is_active), so this
 * layer adds no scoping of its own. It NEVER throws: a missing relation, an
 * unavailable RPC or an unauthorised caller all degrade to an empty, well-formed
 * payload so the panels render an honest empty state instead of an error.
 *
 * Cost is returned PER COUNTRY in that country's own currency and is never summed
 * across currencies - see src/lib/assetOwnership.js for the display rules.
 *
 * @module api/assetOwnership
 */
import { supabase } from './_client'
import { normalizeOwnership } from '../assetOwnership'

/** A well-formed empty payload, used for every failure path. */
function emptyPayload(reason) {
  return normalizeOwnership({ ok: false, reason: reason || 'unavailable' })
}

/**
 * Ownership for many assets, plus the per-country money summary.
 *
 * @param {{search?:string, limit?:number, crossOnly?:boolean}} [opts]
 *   `crossOnly` restricts the list to assets seen in more than one country. The
 *   summary always describes the set the RPC evaluated.
 * @returns {Promise<ReturnType<typeof normalizeOwnership>>}
 */
export async function getAssetOwnership({ search, limit = 500, crossOnly = false } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_asset_ownership', {
      p_search: search && String(search).trim() ? String(search).trim() : null,
      p_limit: limit,
      p_cross_only: !!crossOnly,
      p_asset: null,
    })
    if (error) return emptyPayload('unavailable')
    return normalizeOwnership(data)
  } catch {
    return emptyPayload('unavailable')
  }
}

/**
 * Ownership for ONE asset, via the RPC's indexed exact-match fast path (about
 * 20ms against roughly 1.2s for the full sweep), for the asset detail page.
 *
 * @param {string} assetNo
 * @returns {Promise<null|ReturnType<typeof normalizeOwnership>['assets'][0]>}
 *   null when the asset has no expense history, so the panel can stay hidden.
 */
export async function getAssetOwnershipFor(assetNo) {
  const key = String(assetNo ?? '').trim()
  if (!key) return null
  try {
    const { data, error } = await supabase.rpc('get_asset_ownership', {
      p_search: null,
      p_limit: 1,
      p_cross_only: false,
      p_asset: key,
    })
    if (error) return null
    const payload = normalizeOwnership(data)
    if (!payload.ok) return null
    const want = key.toUpperCase()
    return payload.assets.find((a) => a.assetNo.toUpperCase() === want) ?? null
  } catch {
    return null
  }
}
