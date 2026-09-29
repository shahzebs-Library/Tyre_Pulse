/**
 * Predictive Maintenance overview reads that are not already covered by the
 * page's own tyre/fleet loaders:
 *  - which of a set of assets already has an OPEN work order (so a
 *    recommendation can say "Job open" instead of inventing a status).
 *
 * Country-scoped with the null-safe applyCountry convention and chunked so an
 * `in (...)` list never grows past a safe URL length. Terminal statuses are
 * excluded server-side (both tokenisations plus the legacy 'Closed').
 */
import { supabase, applyCountry, fetchAllPages, unwrap, isMissingRelation } from './_client'
import { isOpenWoStatus } from '../workOrderStatus'

const CHUNK = 150

/** @returns {Promise<Set<string>>} asset numbers with at least one open work order */
export async function listOpenJobAssets(assetNos = [], country) {
  const ids = [...new Set(assetNos.filter(Boolean))]
  const open = new Set()
  if (!ids.length) return open
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK)
      const rows = unwrap(await fetchAllPages((from, to) => applyCountry(
        supabase.from('work_orders').select('id,asset_no,status').in('asset_no', part)
          .not('status', 'in', '("Completed","Cancelled","Closed","completed","cancelled","closed")'),
        country,
      ).order('id').range(from, to), { max: 20000 })) || []
      for (const r of rows) if (r.asset_no && isOpenWoStatus(r.status)) open.add(r.asset_no)
    }
    return open
  } catch (err) {
    if (isMissingRelation(err)) return open
    throw err
  }
}
