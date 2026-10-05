/**
 * Brand asset registry - owner and review status per brand asset, stored in
 * `brand_asset_registry` (migration 20261005150000). The assets themselves
 * live in code and org settings; this table only adds governance metadata.
 *
 * Before the migration is applied `listBrandAssetMeta` reports
 * `provisioned: false` (never an empty list dressed up as "nothing reviewed"),
 * so the page can say the registry is not set up yet.
 */
import { supabase, ServiceError, isNotProvisioned } from './_client'
import { toUserMessage } from '../safeError'

const COLS = 'id,asset_id,asset_kind,owner,status,notes,updated_at'
export const REGISTRY_STATUSES = ['approved', 'draft', 'deprecated']

/** @returns {Promise<{provisioned:boolean, rows:Array}>} throws on any other failure */
export async function listBrandAssetMeta() {
  const { data, error } = await supabase.from('brand_asset_registry').select(COLS).order('asset_id').limit(2000)
  if (error) {
    if (isNotProvisioned(error)) return { provisioned: false, rows: [] }
    throw new ServiceError(toUserMessage(error, 'Could not read the brand asset registry.'), error.code, error)
  }
  return { provisioned: true, rows: data || [] }
}

/** Create or update the governance row for one asset. */
export async function saveBrandAssetMeta({ asset_id, asset_kind, owner, status, notes }) {
  const id = String(asset_id || '').trim()
  if (!id) throw new ServiceError('Pick an asset first.', 'invalid')
  if (!REGISTRY_STATUSES.includes(status)) throw new ServiceError('Pick a valid status.', 'invalid')
  const row = {
    asset_id: id.slice(0, 200),
    asset_kind,
    owner: owner ? String(owner).trim().slice(0, 200) || null : null,
    status,
    notes: notes ? String(notes).trim().slice(0, 4000) || null : null,
  }
  const { data, error } = await supabase
    .from('brand_asset_registry')
    .upsert(row, { onConflict: 'organisation_id,asset_id' })
    .select(COLS)
    .single()
  if (error) throw new ServiceError(toUserMessage(error, 'Could not save the asset details.'), error.code, error)
  return data
}
