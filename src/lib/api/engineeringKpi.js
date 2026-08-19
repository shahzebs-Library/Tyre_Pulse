/**
 * Engineering KPI page reads - the exact selects the Engineering KPI screen
 * consumes to compute the full CPK / life / failure / compliance KPI set.
 *
 * Read-only pass-throughs return the raw Supabase query builder (thenable) the
 * page reads via `.data` / `.error` (records/inspections through `fetchAllPages`,
 * actions/fleet directly through `Promise.all`). Country scoping here is a
 * STRICT `.eq('country', X)` (NOT null-safe) to preserve the page's prior
 * behaviour exactly. Explicit column lists (no SELECT *). Additive only.
 */
import { supabase, applyCountries, countryList } from './_client'

/**
 * Strict (non null-safe) country scope, matching the page's prior inline helper.
 *
 * `countries` is the REPORTING-SCOPE form: a set of countries an analytics
 * surface aggregates over. When it is absent (every caller but Board Overview)
 * the query is built exactly as it always was, so nothing else moves. When it
 * holds ONE country the emitted filter is the same `country=eq.X`.
 *
 * The `id` tiebreak is added on the WHOLE reporting-scope path, including a
 * one-country scope - NOT just the multi-country one.
 *
 * These selects carry no ORDER BY of their own, and every reporting-scope caller
 * drives them through `fetchAllPages`, which fetches pages CONCURRENTLY. An
 * OFFSET/LIMIT read with no sort key has no defined row order, so two pages can
 * omit and duplicate the same rows. Measured on live data: page 2 of the KSA
 * tyre_records read (8,145 rows = 9 pages) returned 781 DIFFERENT rows out of
 * 1,000 when the planner chose a different scan - a one-country scope is not
 * safe merely because it is one country, it is unsafe as soon as it pages.
 * `id` is a uuid with a unique index on every table read here, so it is a real
 * tiebreak; ordering cannot change WHICH rows match, only that paging is stable.
 *
 * The legacy scalar `country` path is deliberately left byte-identical, so the
 * Engineering KPI page's own queries do not move with this change.
 */
function scopeCountry(query, country, countries) {
  const list = countryList(countries)
  if (list.length) return applyCountries(query, list, { nullSafe: false }).order('id')
  return country ? query.eq('country', country) : query
}

/**
 * Tyre records for KPI computation, strict country scope + optional issue_date
 * window, paged range (drives `fetchAllPages`).
 */
export function listKpiTyreRecords({ country, countries, dateFrom, dateTo, from, to } = {}) {
  let q = supabase
    .from('tyre_records')
    .select('id,issue_date,asset_no,brand,site,country,cost_per_tyre,qty,risk_level,km_at_fitment,km_at_removal,position,category,remarks')
  if (dateFrom) q = q.gte('issue_date', dateFrom)
  if (dateTo) q = q.lte('issue_date', dateTo)
  q = scopeCountry(q, country, countries)
  return q.range(from, to)
}

/**
 * Inspections for KPI computation: country + optional site and scheduled-date
 * window, paged range.
 *
 * `tyre_conditions` IS THE ONE THAT MATTERS. `computePressureCompliance` reads
 * its pressure readings out of that column, and it was not in this select - so
 * `pressureReadings()` saw undefined on every row, returned [], and the KPI
 * reported "not measured" for the whole fleet. Measured on the live data:
 * 359 of 426 inspections carry four or more usable readings across 11 sites,
 * every one of which the page was reporting as unmeasurable. It is the largest
 * column here, so it is fetched precisely because a KPI depends on it, not for
 * completeness.
 *
 * THE WINDOW IS ON `scheduled_date`, NOT `completed_date`, and that is the
 * question inspection compliance asks: of the inspections DUE in this period,
 * how many were done and how many on time. Windowing on completion would drop
 * every overdue inspection - the exact rows the compliance figure exists to
 * count - and flatter the number. Safe on this data: 0 of 426 rows have a null
 * scheduled_date, so nothing is silently excluded by the bound.
 */
export function listKpiInspections({
  country, countries, site, dateFrom, dateTo, from, to,
} = {}) {
  let q = supabase
    .from('inspections')
    .select('id,asset_no,site,country,status,scheduled_date,completed_date,findings,inspection_type,tyre_conditions')
  if (site) q = q.eq('site', site)
  if (dateFrom) q = q.gte('scheduled_date', dateFrom)
  if (dateTo) q = q.lte('scheduled_date', dateTo)
  return scopeCountry(q, country, countries).range(from, to)
}

/**
 * Corrective actions for KPI computation, strict country scope.
 * `from`/`to` are optional: when supplied the query is ranged so callers can
 * drive it through `fetchAllPages` past the PostgREST 1000-row cap. Omitting
 * them preserves the original single-shot pass-through exactly.
 */
export function listKpiCorrectiveActions({
  country, countries, site, dateFrom, dateTo, from, to,
} = {}) {
  let base = supabase.from('corrective_actions').select('id,status,site,country,due_date,created_at')
  if (site) base = base.eq('site', site)
  // Windowed on when the action was RAISED, not when it falls due: the KPI it
  // feeds is a close rate, and "of the work raised in this period, how much was
  // closed" is answerable, while grouping by due date would move an action into
  // a period nobody worked in it.
  if (dateFrom) base = base.gte('created_at', dateFrom)
  if (dateTo) base = base.lte('created_at', `${dateTo}T23:59:59.999Z`)
  const q = scopeCountry(base, country, countries)
  return Number.isFinite(from) && Number.isFinite(to) ? q.range(from, to) : q
}

/**
 * Fleet roster (id/asset_no) for fleet-size denominators.
 *
 * Takes `country` because this feeds a DENOMINATOR: on a country-scoped screen
 * every numerator (tyres, inspections, accidents) is filtered to that country,
 * so an unscoped fleet count mixes in other countries' vehicles and understates
 * every per-vehicle ratio and the Fleet Availability KPI.
 * `from`/`to` are optional and drive `fetchAllPages` - the fleet register is
 * over 1000 rows, so an un-ranged read silently truncated the count.
 */
export function listKpiFleet({ country, countries, site, from, to } = {}) {
  // Site matters here for the same reason country does: this is a DENOMINATOR.
  // With one site selected the numerator is that site's tyres while an unscoped
  // count is the whole country's register, so Fleet Availability reads far
  // worse than it is. Deliberately NOT date-windowed - a fleet register is the
  // machines that exist now, not the ones acquired in a period.
  // `site` is FILTERED ON but deliberately not selected: the page only takes
  // .length of this, and PostgREST filters a column it does not return, so
  // fetching it would add a string to 1,617 rows nothing reads.
  let base = supabase.from('vehicle_fleet').select('id,asset_no')
  if (site) base = base.eq('site', site)
  const q = scopeCountry(base, country, countries)
  return Number.isFinite(from) && Number.isFinite(to) ? q.range(from, to) : q
}
