/**
 * tyrePriceBackfill.js - filling a tyre's missing price from evidence (V401).
 *
 * ALWAYS PREVIEW FIRST. This writes to `tyre_records.cost_per_tyre`, which feeds
 * CPK and every tyre-cost figure in the app, so the dry run is the default and
 * the apply returns a batch id that undoes it exactly.
 *
 * MONEY IS PER COUNTRY. The response carries no cross-country total on purpose:
 * KSA reports in SAR, UAE in AED and Egypt in EGP, and adding them is the bug
 * this codebase has already had to fix at four separate reader sites.
 *
 * REPLACES `backfill_tyre_prices_from_grid` (V327), which averaged the LINE cost
 * without dividing by quantity and so overstated the per-tyre price 2.5x to 5.1x
 * on the 29% of lines covering more than one tyre. Do not call that function.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

const isMissing = (error) =>
  /could not find the function|does not exist|schema cache/i.test(error?.message || '')

/**
 * Work out which tyres can be priced, and from what.
 *
 * @param {{country?:string, dryRun?:boolean}} [opts]
 * @returns {Promise<object>} {ok, dry_run, batch_id, rows, by_source, by_country, sample}
 */
export async function runTyrePriceBackfill({ country, dryRun = true } = {}) {
  const { data, error } = await supabase.rpc('tyre_price_backfill', {
    p_dry_run: dryRun !== false,
    p_country: country && country !== 'All' ? country : null,
  })
  if (error) {
    if (isMissing(error)) return { ok: false, rows: 0, by_source: {}, by_country: {}, sample: [] }
    throw new Error(toUserMessage(error, 'Could not work out the missing tyre prices.'))
  }
  return data || {}
}

/**
 * Put one applied batch back exactly as it was, NULLs included. The prior value
 * is stored per row rather than re-derived, so an undo restores what the row
 * actually held and not what today's rules would say.
 */
export async function undoTyrePriceBackfill(batchId) {
  if (!batchId) throw new Error('Nothing to undo.')
  const { data, error } = await supabase.rpc('tyre_price_backfill_undo', { p_batch_id: batchId })
  if (error) throw new Error(toUserMessage(error, 'Could not undo that price change.'))
  return data || {}
}

/** How much of the fleet has a price, and why the rest does not. */
export async function getTyrePriceCoverage() {
  const { data, error } = await supabase.rpc('tyre_price_coverage')
  if (error) {
    if (isMissing(error)) return { ok: false, rows: [] }
    throw new Error(toUserMessage(error, 'Could not load the tyre price coverage.'))
  }
  return { ok: true, rows: Array.isArray(data) ? data : [] }
}

/**
 * How much of the priced tyre set is a MACHINE ESTIMATE rather than a real
 * measured price.
 *
 * Cost per km is only as sound as its price input. Measured on the live fleet:
 * of 11,132 tyres, 6,832 carry a price - but 2,989 of those were filled by the
 * backfill engine from a comparable tyre, so only 3,843 (34.5%) rest on a price
 * someone actually paid. Nothing on screen said so, which makes an estimate
 * read as a measurement.
 *
 * Three exact server counts (head-only, no rows transferred) rather than a new
 * RPC - tyre_price_backfill_log already records exactly which tyres the machine
 * priced, and carries its own country, so nothing needs to be derived.
 *
 * Returns nulls rather than zeros when a count cannot be read: "we could not
 * look" must not render as "none are estimated".
 */
export async function getTyrePriceBasis({ country } = {}) {
  const scoped = (q) => (country && country !== 'All' ? q.eq('country', country) : q)
  const countOf = async (build) => {
    try {
      const { count, error } = await build()
      return error ? null : (count ?? null)
    } catch { return null }
  }

  const [total, priced, estimated] = await Promise.all([
    countOf(() => scoped(supabase.from('tyre_records').select('id', { count: 'exact', head: true }))),
    countOf(() => scoped(supabase.from('tyre_records').select('id', { count: 'exact', head: true }).gt('cost_per_tyre', 0))),
    countOf(() => scoped(supabase.from('tyre_price_backfill_log').select('id', { count: 'exact', head: true }))),
  ])

  const real = priced != null && estimated != null ? Math.max(priced - estimated, 0) : null
  return {
    total, priced, estimated, real,
    realPctOfPriced: priced ? (real == null ? null : Math.round((real / priced) * 100)) : null,
  }
}

/**
 * One plain sentence stating what the cost figures rest on, or '' when the
 * basis is unknown or nothing was estimated (saying "0 estimated" on a clean
 * fleet is noise).
 */
export function priceBasisNote(basis) {
  if (!basis || !basis.priced || basis.estimated == null || basis.estimated <= 0) return ''
  return `Cost figures use ${basis.priced.toLocaleString()} priced tyres, of which ` +
    `${basis.estimated.toLocaleString()} carry an estimated price worked out from a comparable tyre ` +
    `rather than one that was actually paid` +
    (basis.total ? `, and ${(basis.total - basis.priced).toLocaleString()} tyres have no price at all` : '') +
    '. Treat cost per km as indicative until those prices are loaded.'
}

/** Currency per country - the same map the rest of the app uses. */
export const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }

export const currencyFor = (country) => COUNTRY_CURRENCY[country] || ''

/**
 * How a price was arrived at, in the words a reviewer needs.
 *
 * `comparable` deliberately says how many tyres the figure rests on: a median of
 * two is a very different claim from a median of ninety, and hiding that would
 * make an estimate look like a measurement.
 */
export const SOURCE_META = {
  own_jobcard: {
    label: 'Its own job card',
    detail: 'The price on this tyre\'s own purchase, divided by how many tyres that line covered.',
    tone: 'good',
  },
  comparable: {
    label: 'Similar tyres',
    detail: 'The middle price of the same brand and size bought earlier in the same country.',
    tone: 'warning',
  },
  warranty: {
    label: 'Warranty',
    detail: 'Replaced under warranty, so the price is zero rather than unknown.',
    tone: 'info',
  },
}

export const sourceLabel = (s) => SOURCE_META[s]?.label || s || 'Unknown'
