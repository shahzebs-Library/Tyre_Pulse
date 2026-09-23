/**
 * Supabase boundary for `accident_fleet_validation_items` - the saved state of
 * the six Fleet Validation checklist items (mock M6), one row per
 * (accident_id, item_key). Direct RLS-governed read/write, same convention as
 * accidentLiability.js / accidentCommunications.js.
 *
 * SHIP-BEFORE-MIGRATE: the table is created by
 * supabase/migrations/20260916130000_accident_mock_field_parity.sql and may not
 * be applied yet. A missing relation degrades to `{ rows: [], persisted: false }`
 * so the panel can render the derived checklist and SAY the ticks are not saved,
 * instead of throwing or pretending a save landed.
 */
import { supabase, unwrap, isMissingRelation } from './_client'
import { FLEET_VALIDATION_ITEMS, CHECK_STATES } from '../accidentCaseVocab'

const ITEM_COLS =
  'id,accident_id,country,site,item_key,state,count_done,count_required,' +
  'checked_by_id,checked_by_name,checked_at,note,created_at,updated_at'

const ITEM_KEYS = new Set(FLEET_VALIDATION_ITEMS.map((i) => i.key))

/**
 * Saved checklist rows for one case.
 * @returns {Promise<{rows:object[], persisted:boolean}>} persisted=false when the table is not provisioned.
 */
export async function listFleetValidationItems(accidentId) {
  if (!accidentId) return { rows: [], persisted: true }
  try {
    const rows = unwrap(
      await supabase
        .from('accident_fleet_validation_items')
        .select(ITEM_COLS)
        .eq('accident_id', accidentId)
        .order('item_key'),
    ) || []
    return { rows, persisted: true }
  } catch (err) {
    if (isMissingRelation(err)) return { rows: [], persisted: false }
    throw err
  }
}

function validate(itemKey, patch) {
  if (!ITEM_KEYS.has(itemKey)) throw new Error(`Unknown checklist item "${itemKey}".`)
  if (patch.state != null && !CHECK_STATES.includes(patch.state)) throw new Error(`Invalid checklist state "${patch.state}".`)
}

function rowFor(accidentId, itemKey, patch, ctx) {
  const row = { accident_id: accidentId, item_key: itemKey }
  if (ctx?.country) row.country = ctx.country
  if (ctx?.site) row.site = ctx.site
  for (const k of ['state', 'count_done', 'count_required', 'checked_by_id', 'checked_by_name', 'checked_at', 'note']) {
    if (k in patch) row[k] = patch[k] ?? null
  }
  return row
}

/**
 * Save one item (insert or update on the unique (accident_id, item_key) key).
 * @param {string} accidentId
 * @param {string} itemKey one of FLEET_VALIDATION_ITEMS
 * @param {{state?, count_done?, count_required?, checked_by_id?, checked_by_name?, checked_at?, note?}} patch
 * @param {{country?:string, site?:string}} [ctx] stamped so country/site RLS can scope the row
 */
export async function upsertFleetValidationItem(accidentId, itemKey, patch = {}, ctx = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  validate(itemKey, patch)
  return unwrap(
    await supabase
      .from('accident_fleet_validation_items')
      .upsert(rowFor(accidentId, itemKey, patch, ctx), { onConflict: 'accident_id,item_key' })
      .select(ITEM_COLS)
      .single(),
  )
}

/**
 * Save several items in one round trip ("Save progress").
 * @param {string} accidentId
 * @param {{itemKey:string, patch:object}[]} entries
 */
export async function upsertFleetValidationItems(accidentId, entries = [], ctx = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  if (!entries.length) return []
  entries.forEach((e) => validate(e.itemKey, e.patch || {}))
  return unwrap(
    await supabase
      .from('accident_fleet_validation_items')
      .upsert(entries.map((e) => rowFor(accidentId, e.itemKey, e.patch || {}, ctx)), { onConflict: 'accident_id,item_key' })
      .select(ITEM_COLS),
  ) || []
}
