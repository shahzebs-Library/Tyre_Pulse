/**
 * Supplier Management page reads/writes - the exact selects/mutations the
 * Supplier Management screen consumes (directory, ratings, contracts, scorecard).
 *
 * Read-only pass-throughs return the raw Supabase query builder (thenable) the
 * page reads via `.data` / `.error`, preserving the page's existing error
 * handling exactly. Country scoping is null-safe (`applyCountry`) - identical to
 * the page's prior local `applyCountryFilter` (same `country.eq.X,country.is.null`
 * OR filter). Explicit column lists (no SELECT *). Additive only.
 */
import { supabase, applyCountry } from './_client'

/** Tyre records for the supplier directory/scorecard, country-scoped, paged range. */
export function listSupplierTyres({ from, to, country } = {}) {
  return applyCountry(
    supabase
      .from('tyre_records')
      .select('id, brand, supplier, qty, cost_per_tyre, issue_date, site, country, position, km_at_fitment, km_at_removal, risk_level, size, serial_number, asset_no'),
    country,
  ).range(from, to)
}

/** Supplier ratings/notes rows (per brand), country-scoped. */
export function listSupplierRatings({ country } = {}) {
  return applyCountry(
    supabase.from('supplier_ratings').select('id, brand, rating, notes, country'),
    country,
  )
}

/** Supplier contracts (newest first), country-scoped. */
export function listSupplierContracts({ country } = {}) {
  return applyCountry(
    supabase
      .from('supplier_contracts')
      .select('id, supplier_name, contract_start, contract_end, payment_terms, price_per_unit, min_order, notes, country')
      .order('created_at', { ascending: false }),
    country,
  )
}

/**
 * Warranty claims feeding the supplier scorecard, country-scoped.
 * `created_at` powers the scorecard's period-over-period trend bucketing.
 */
export function listScorecardWarrantyClaims({ country } = {}) {
  return applyCountry(
    supabase.from('warranty_claims').select('id, supplier, brand, claim_status, credit_amount, created_at, country'),
    country,
  )
}

/**
 * Purchase orders feeding the supplier scorecard, country-scoped.
 * `order_date` powers the scorecard's period-over-period trend bucketing.
 */
export function listScorecardPurchaseOrders({ country } = {}) {
  return applyCountry(
    supabase.from('purchase_orders').select('id, supplier_name, vendor_name, order_date, expected_delivery, actual_delivery, country'),
    country,
  )
}

/**
 * Upsert one supplier_ratings row per (brand, country). Pass-through: the page
 * reads `.error`. Conflict target matches the page's prior inline upsert.
 */
export function upsertSupplierRating(payload) {
  return supabase.from('supplier_ratings').upsert(payload, { onConflict: 'brand,country' })
}

/** Update an existing supplier contract by id. Pass-through (page reads `.error`). */
export function updateSupplierContract(id, payload) {
  return supabase.from('supplier_contracts').update(payload).eq('id', id)
}

/** Insert a new supplier contract. Pass-through (page reads `.error`). */
export function insertSupplierContract(payload) {
  return supabase.from('supplier_contracts').insert(payload)
}

/**
 * Delete a supplier contract by id, returning the deleted id so the page can
 * detect a no-op delete (RLS / already removed). Pass-through: page reads
 * `.data` (length) and `.error`.
 */
export function deleteSupplierContract(id) {
  return supabase.from('supplier_contracts').delete().eq('id', id).select('id')
}
