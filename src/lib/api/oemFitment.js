/**
 * OEM depth service: fitment evidence, stock visibility, alternatives and the
 * unmatched-manual-row worklist (engine: src/lib/inventory/oemFitment.js).
 *
 * Reads are paged with an `id` tiebreak and a ceiling (readAll from the OEM
 * cross-reference service), or chunked by id lists. Nothing here writes a table
 * directly. The one write is a governed correction REQUEST
 * (inv_correction_request, action add_reference, alias_type alternative or
 * superseded); a second person approves it in Corrections through
 * inv_correction_decide, which refuses the requester deciding their own.
 */
import { ServiceError } from './_client'
import { readAll } from './oemCrossRef'
import { requestCorrection } from './physicalInventory'
import { buildAlternativeRequest } from '../inventory/oemFitment'

const CHUNK = 200
const MANUAL_COLS = 'id,country,manufacturer,model,model_code,equipment_no,revision,source_file_name'
const FLEET_COLS = 'id,country,asset_no,make,model,vehicle_type,site'
const LINK_COLS = 'id,country,canonical_id,item_id'
const BALANCE_COLS = 'id,item_id,item_code,site,country,qty_on_hand,uom'
const ERP_COLS = 'id,item_code,item_name,country'
const ALIAS_COLS = 'id,canonical_id,alias_type,value,source,verified,ref_status'

const uniq = (list) => [...new Set((list || []).filter(Boolean))]

async function readByIds(table, cols, column, ids, label) {
  const list = uniq(ids)
  const rows = []
  let truncated = false
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK)
    const res = await readAll(table, cols, (q) => q.in(column, chunk), label)
    rows.push(...res.rows)
    truncated = truncated || res.truncated
  }
  return { rows, truncated }
}

/** Manuals and the fleet register, for fitment evidence. */
export async function loadFitmentSources({ country } = {}) {
  const byCountry = (q) => (country && country !== 'All' ? q.eq('country', country) : q)
  const [manuals, fleet] = await Promise.all([
    readAll('oem_parts_manuals', MANUAL_COLS, byCountry, 'OEM manuals'),
    readAll('vehicle_fleet', FLEET_COLS, byCountry, 'the fleet register'),
  ])
  return { manuals: manuals.rows, fleet: fleet.rows, truncated: manuals.truncated || fleet.truncated }
}

/** On-hand balances for ERP item ids. */
export function loadBalances(itemIds) {
  return readByIds('v_inv_balances', BALANCE_COLS, 'item_id', itemIds, 'stock balances')
}

/** Catalogue to ERP links for catalogue ids, then their balances. */
export async function loadCatalogueStock(canonicalIds) {
  const links = await readByIds('material_canonical_items', LINK_COLS, 'canonical_id', canonicalIds, 'catalogue to ERP links')
  const balances = await loadBalances(links.rows.map((l) => l.item_id))
  return { links: links.rows, balances: balances.rows, truncated: links.truncated || balances.truncated }
}

/** ERP items and balances behind stored OEM links. */
export async function loadLinkStock(references) {
  const ids = (references || []).filter((r) => r?.status === 'approved' || r?.status === 'proposed').map((r) => r.item_id)
  const [erp, balances] = await Promise.all([
    readByIds('material_master', ERP_COLS, 'id', ids, 'ERP items'),
    loadBalances(ids),
  ])
  return { erpItems: erp.rows, balances: balances.rows, truncated: erp.truncated || balances.truncated }
}

/** Every reference type on catalogue items (OEM, ERP SKU, alternative, superseded...). */
export function loadAllCatalogueReferences() {
  return readAll('material_aliases', ALIAS_COLS, (q) => q.not('canonical_id', 'is', null), 'catalogue references')
}

/**
 * Submit "A can replace B" as a correction request on B. It is NOT applied:
 * a second person approves it in Corrections.
 */
export function proposeAlternative(input, idempotencyKey) {
  let payload
  try {
    payload = buildAlternativeRequest(input)
  } catch (err) {
    // Our own validation sentence, shown as written (INV_* contract).
    return Promise.reject(new ServiceError(err.message, 'INV_INVALID'))
  }
  return requestCorrection(payload, idempotencyKey)
}
