/**
 * tyreLifetimeCpk - PHYSICAL TYRE LIFETIME CPK from the database
 * (RPC get_tyre_lifetime_cpk, migration 20261109160000).
 *
 * Same definition as src/lib/tyreLifetime.js toLifetimeTyres() (SQL mirror):
 * one purchase per physical tyre, km summed over its non-overlapping fitments,
 * weighted aggregate, FINAL (tyre no longer fitted) kept apart from PROVISIONAL
 * (still fitted, life so far). Each country in its own currency (rule T10).
 *
 * Forgiving: an RPC error degrades to { ok:false, error } so a panel can show an
 * honest error state; it never throws.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

function shapeBlock(b) {
  if (!b) return null
  return {
    tyres: num(b.tyres) ?? 0,
    physicalTyres: num(b.physical_tyres) ?? 0,
    measurable: num(b.measurable) ?? 0,
    purchaseCost: num(b.purchase_cost),
    fullCost: num(b.full_cost),
    km: num(b.km),
    cpkPurchase: num(b.cpk_purchase),
    cpkFull: num(b.cpk_full),
    repairCost: num(b.repair_cost) ?? 0,
    retreadCost: num(b.retread_cost) ?? 0,
    recovery: num(b.recovery) ?? 0,
    estimatedCostInCpk: num(b.estimated_cost_in_cpk) ?? 0,
    refittedTyres: num(b.refitted_tyres) ?? 0,
    tyresWithOverlap: num(b.tyres_with_overlap) ?? 0,
    coverage: { complete: 0, partial: 0, none: 0, ...(b.km_coverage || {}) },
    costStatus: { ACTUAL: 0, ESTIMATED: 0, CONFIRMED_ZERO: 0, DISPUTED: 0, MISSING: 0, ...(b.cost_status || {}) },
  }
}

const shapeGroup = (rows) => (Array.isArray(rows) ? rows : []).map((g) => ({
  key: g.key,
  tyres: num(g.tyres) ?? 0,
  km: num(g.km),
  cpkPurchase: num(g.cpk_purchase),
  cpkFull: num(g.cpk_full),
}))

/** Pure: shape the RPC payload. Exported for tests. */
export function shapeLifetimeCpk(payload) {
  const countries = (payload?.countries || []).map((c) => ({
    country: c.country,
    final: shapeBlock(c.final),
    provisional: shapeBlock(c.provisional),
    byBrand: shapeGroup(c.by_brand),
    bySize: shapeGroup(c.by_size),
    byVehicleType: shapeGroup(c.by_vehicle_type),
    unlinkedRepairLines: c.unlinked_repair_lines
      ? { lines: num(c.unlinked_repair_lines.lines) ?? 0, amount: num(c.unlinked_repair_lines.amount) ?? 0 }
      : { lines: 0, amount: 0 },
  }))
  return { ok: true, definition: payload?.definition || {}, countries }
}

/** Share (0..1) of the cost behind the CPK that is ESTIMATED; null when no cost. */
export function estimatedShare(block) {
  if (!block || !(block.purchaseCost > 0)) return null
  return block.estimatedCostInCpk / block.purchaseCost
}

/**
 * @param {{country?:string, from?:string, to?:string, site?:string}} opts
 * @returns {Promise<{ok:true, definition:object, countries:Array}|{ok:false, error:string}>}
 */
export async function getTyreLifetimeCpk({ country, from, to, site } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_tyre_lifetime_cpk', {
      p_country: !country || country === 'All' ? null : country,
      p_from: from || null,
      p_to: to || null,
      p_site: site || null,
    })
    if (error) return { ok: false, error: toUserMessage(error, 'Could not load tyre lifetime CPK.') }
    return shapeLifetimeCpk(data)
  } catch (err) {
    return { ok: false, error: toUserMessage(err, 'Could not load tyre lifetime CPK.') }
  }
}
