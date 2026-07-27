/**
 * Currency rates - the one place FX rates are read and written.
 *
 * The rate table has existed since the multi-country work but has always been
 * empty, which is why no combined-country total has ever been shown. Nothing
 * here invents a rate: a figure with no approved rate behind it comes back as
 * null and the caller says "not available".
 *
 * A rate must be APPROVED before any conversion uses it. Entering one is not the
 * same as standing behind it, and a management report should only translate
 * money at a rate someone has signed off.
 *
 * @module api/currencyRates
 */
import { supabase } from './_client'

/** The three policies, and what each one actually means for a reader. */
export const FX_POLICIES = Object.freeze([
  {
    key: 'transaction',
    label: 'Transaction date',
    detail: 'Each cost is converted at the rate on the day it was incurred. Most faithful '
      + 'to the individual line, but one month then mixes many different rates.',
  },
  {
    key: 'monthly_avg',
    label: 'Monthly average',
    detail: 'One rate per calendar month. The usual choice for management reporting: '
      + 'months stay comparable and a single volatile day cannot move a total.',
  },
  {
    key: 'closing',
    label: 'Period closing',
    detail: 'The rate at the end of the period, applied to everything in it. Matches how '
      + 'a balance sheet is translated.',
  },
])

const missing = (error) => {
  const m = String(error?.message || error?.code || '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find')
    || m.includes('schema cache') || m === 'pgrst202' || m === '42p01'
}

const COLS = 'id,base_currency,quote_currency,rate,rate_date,source,approved,approved_at,created_at'

/**
 * Every rate on record, newest first. Degrades to an empty list rather than
 * throwing, so the panel renders even before the table is provisioned.
 */
export async function listCurrencyRates({ limit = 200 } = {}) {
  const { data, error } = await supabase
    .from('currency_rates').select(COLS)
    .order('rate_date', { ascending: false })
    .limit(limit)
  if (error) { if (missing(error)) return []; throw error }
  return Array.isArray(data) ? data : []
}

/**
 * Record a rate. Deliberately NOT approved on creation: entering a number and
 * standing behind it are two different acts, and only the second one should
 * move reported money.
 */
export async function addCurrencyRate({ base, quote, rate, rateDate, source = 'manual' }) {
  const value = Number(rate)
  if (!base || !quote) throw new Error('Both currencies are required.')
  if (!Number.isFinite(value) || value <= 0) throw new Error('The rate must be a positive number.')
  if (String(base).toUpperCase() === String(quote).toUpperCase()) {
    throw new Error('A currency does not need a rate against itself.')
  }
  const { data, error } = await supabase.from('currency_rates').insert({
    base_currency: String(base).toUpperCase().trim(),
    quote_currency: String(quote).toUpperCase().trim(),
    rate: value,
    rate_date: rateDate,
    source,
    approved: false,
  }).select(COLS).single()
  if (error) throw error
  return data
}

/** Approve or un-approve a rate. Only approved rates are ever used. */
export async function setRateApproval(id, approved) {
  const { error } = await supabase.from('currency_rates')
    .update({
      approved: !!approved,
      approved_at: approved ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) throw error
  return true
}

export async function deleteCurrencyRate(id) {
  const { error } = await supabase.from('currency_rates').delete().eq('id', id)
  if (error) throw error
  return true
}

/**
 * Which currencies in the data can currently be converted into `target`, and
 * whether the set is complete. A combined total must only ever be offered when
 * `complete` is true; otherwise it would silently omit whatever has no rate.
 * @returns {Promise<{ok:boolean, policy?:string, currencies?:Array, complete?:boolean}>}
 */
export async function getFxCoverage({ target = 'SAR', from, to } = {}) {
  const { data, error } = await supabase.rpc('fx_coverage', {
    p_to: target, p_from: from || null, p_to_date: to || null,
  })
  if (error) { if (missing(error)) return { ok: false, reason: 'not_provisioned' }; throw error }
  return data && data.ok ? data : { ok: false }
}
