/**
 * costVariance.js - client boundary for the cost variance decomposition (V378).
 *
 * One RPC, `get_cost_variance`, which takes the change in parts spend between a
 * window and the window immediately before it and returns the signed parts that
 * add back up to it: price, volume, lines that started, lines that stopped, and
 * anything with no usable quantity. Plus every dimension ranked by the SIZE OF
 * THE SWING rather than by spend, which is what "what moved" needs and what
 * get_cost_cpk_overview (V374) deliberately does not do.
 *
 * The maths lives in the pure engine at src/lib/costVariance.js. This file only
 * talks to the database.
 *
 * DEGRADES, NEVER THROWS AT THE PAGE. A missing function (the migration has not
 * been applied yet) comes back as a shaped `{ok:false}` rather than an
 * exception, so the panel renders an honest empty state beside a Cost and CPK
 * page that still works.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'
import { callScopedMulti } from './partsConsumption'

/** Postgres codes that mean "this function is not deployed here". */
const MISSING = new Set(['42883', 'PGRST202'])

/**
 * Decompose the change in spend for one window.
 *
 * @param {object} [opts]
 * @param {string} [opts.country] a real country, or null/'All' for org-wide.
 *   Org-wide across more than one country returns `blended:true` and NO money:
 *   SAR, AED and EGP do not add up, and an item code means different things in
 *   different countries (V367).
 * @param {string} [opts.site]
 * @param {string} [opts.from] YYYY-MM-DD
 * @param {string} [opts.to] YYYY-MM-DD
 * @param {number} [opts.limit=25] members per dimension before the tail is
 *   rolled into one signed figure. Clamped 5..100 server-side.
 * @returns {Promise<object>} the payload, or `{ok:false, reason}` - never throws
 */
export async function getCostVariance(opts = {}) {
  const { country, site, from, to, limit = 25 } = opts
  try {
    const { data, error } = await supabase.rpc('get_cost_variance', {
      p_country: country && country !== 'All' ? country : null,
      p_site: site && site !== 'All' ? site : null,
      p_from: from || null,
      p_to: to || null,
      p_limit: limit,
    })
    if (error) {
      if (MISSING.has(error.code)) {
        return { ok: false, reason: 'Cost variance is not available on this database yet.' }
      }
      return { ok: false, reason: toUserMessage(error, 'Could not load the cost breakdown.') }
    }
    return data || { ok: false, reason: 'No breakdown was returned.' }
  } catch (err) {
    return { ok: false, reason: toUserMessage(err, 'Could not load the cost breakdown.') }
  }
}

/**
 * The same decomposition for every country in a reporting scope (V544).
 *
 * One block per country, each in its own currency. There is no scope-level
 * effect total and there cannot be one: price, volume, started and stopped are
 * SIGNED AMOUNTS that must add back up to the delta, and that closure only holds
 * inside a single currency. Adding a SAR price effect to an AED one would break
 * the one property that makes this decomposition trustworthy.
 *
 * @param {{countries:string[], site?:string, from?:string, to?:string, limit?:number}} opts
 * @returns {Promise<{ok:boolean, blocks:Array, refused:string[]}>} never throws
 */
export async function getCostVarianceMulti(opts = {}) {
  const { countries, site, from, to, limit = 25 } = opts
  try {
    return await callScopedMulti('get_cost_variance_multi', countries, {
      p_site: site && site !== 'All' ? site : null,
      p_from: from || null,
      p_to: to || null,
      p_limit: limit,
    })
  } catch {
    return { ok: false, blocks: [], refused: [] }
  }
}

export default { getCostVariance, getCostVarianceMulti }
