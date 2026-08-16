/**
 * Context rules: which modules apply in which working context.
 *
 * The shell spec asks for context-aware navigation, and says to choose the
 * behaviour "based on actual business rules". There were no such rules recorded
 * anywhere, so these were DERIVED FROM THE DATA rather than invented, by counting
 * rows per country in each module's own table (measured 2026-08-16):
 *
 *   parts_consumption  KSA 108,891  UAE 59,810  Egypt 40,680
 *   work_orders        KSA  62,127  UAE 14,976  Egypt 12,525
 *   tyre_records       KSA   8,145  UAE  2,455  Egypt    591
 *   vehicle_fleet      KSA   1,030  UAE    452  Egypt    135
 *   production_logs    KSA 212,567  UAE      0  Egypt      0
 *   sco_costs          KSA     672  UAE      0  Egypt      0
 *   sany_invoices      KSA       4  UAE      0  Egypt      0
 *   inspections        KSA     353  UAE      0  Egypt      0
 *   accidents          KSA      38  UAE      0  Egypt      0
 *   asset_disposals    KSA      37  UAE      0  Egypt      0
 *   asset_breakdowns   KSA      30  UAE      0  Egypt      0
 *
 * THE CENTRAL DISTINCTION, and the reason this file is careful rather than a
 * simple country list: a module holding no rows for a country means one of two
 * completely different things, and they need opposite treatment.
 *
 *   'structural'  - the module cannot apply there. SANY and SCO are KSA supplier
 *                   contracts; the concrete production ledger (m3) belongs to the
 *                   KSA plants. Another country will never have these rows because
 *                   the arrangement does not exist there.
 *
 *   'not_rolled_out' - the module applies perfectly well, nobody has used it there
 *                   yet. Inspections, accidents, breakdowns and disposals are all
 *                   in this group: the field app and the source sheets covered KSA
 *                   first. HIDING these would be actively harmful, because it would
 *                   stop the first UAE inspection ever being recorded, and the
 *                   emptiness would look like a decision instead of a gap.
 *
 * So DEFAULT BEHAVIOUR IS 'notice', never 'hide': the module stays reachable and
 * says plainly that this location has no data and why. That is option 2 of the
 * three the spec offers. 'hide' exists for a rule someone is willing to assert,
 * and no rule here claims it by default - asserting "never" about a business we
 * only observe through its data is not something the data can support.
 *
 * Modules whose table is empty in EVERY country (tyre_pool, certifications,
 * warranty_claims, purchase_orders, suppliers, drivers, pm_programs, ...) are
 * deliberately NOT listed. Those are unused modules, not context-specific ones,
 * and they already have their own honest treatment via NotInUseNotice.
 */

/** How an out-of-context module behaves. */
export const CONTEXT_MODES = Object.freeze({
  NOTICE: 'notice',   // stays reachable, says why it is empty here (default)
  HIDE: 'hide',       // removed from the nav for that context
})

/**
 * route -> { countries, why, reason, mode }
 *  countries: where the module HAS data / applies. Empty context ('All') always passes.
 *  why:       'structural' | 'not_rolled_out'
 *  reason:    plain sentence shown to the user. ASCII only (repo rule).
 */
export const CONTEXT_RULES = Object.freeze({
  '/cost-per-m3': {
    countries: ['KSA'], why: 'structural', mode: CONTEXT_MODES.NOTICE,
    reason: 'Concrete production is recorded for KSA plants only, so there is no cubic metre figure to divide cost by in this location.',
  },
  '/production-m3': {
    countries: ['KSA'], why: 'structural', mode: CONTEXT_MODES.NOTICE,
    reason: 'The production ledger covers the KSA plants only.',
  },
  '/sco-costs': {
    countries: ['KSA'], why: 'structural', mode: CONTEXT_MODES.NOTICE,
    reason: 'SCO is a KSA supplier arrangement, so no SCO cost is recorded in this location.',
  },
  '/sany-invoices': {
    countries: ['KSA'], why: 'structural', mode: CONTEXT_MODES.NOTICE,
    reason: 'The SANY service contract is a KSA arrangement.',
  },
  '/sany-delay-penalty': {
    countries: ['KSA'], why: 'structural', mode: CONTEXT_MODES.NOTICE,
    reason: 'The SANY service contract, and its repair delay penalty, is a KSA arrangement.',
  },
  '/inspections': {
    countries: ['KSA'], why: 'not_rolled_out', mode: CONTEXT_MODES.NOTICE,
    reason: 'No inspection has been recorded in this location yet. The module works here; it has not been used yet.',
  },
  '/accidents': {
    countries: ['KSA'], why: 'not_rolled_out', mode: CONTEXT_MODES.NOTICE,
    reason: 'No incident has been recorded in this location yet.',
  },
  '/asset-breakdowns': {
    countries: ['KSA'], why: 'not_rolled_out', mode: CONTEXT_MODES.NOTICE,
    reason: 'The breakdown register currently covers KSA assets only.',
  },
  '/asset-disposals': {
    countries: ['KSA'], why: 'not_rolled_out', mode: CONTEXT_MODES.NOTICE,
    reason: 'The disposal register currently covers KSA assets only.',
  },
})

const norm = (v) => String(v ?? '').trim().toLowerCase()

/** The rule for a route, or null when the module applies everywhere. */
export function contextRuleFor(route) {
  return CONTEXT_RULES[route] || null
}

/**
 * Does this module apply in this working context?
 *
 * An absent or 'All' country ALWAYS passes: a reader looking across every country
 * must still see a module that applies to one of them, or the all-countries view
 * would hide exactly the thing they opened it to compare.
 */
export function isModuleInContext(route, country) {
  const rule = contextRuleFor(route)
  if (!rule) return true
  const c = norm(country)
  if (!c || c === 'all') return true
  return rule.countries.some((x) => norm(x) === c)
}

/** True only when the rule says to remove it from the nav entirely. */
export function isModuleHiddenInContext(route, country) {
  const rule = contextRuleFor(route)
  if (!rule || rule.mode !== CONTEXT_MODES.HIDE) return false
  return !isModuleInContext(route, country)
}

/**
 * The message for an out-of-context module, or null when it applies here.
 * Names the current location so the reader knows which context they are in.
 */
export function contextNoticeFor(route, country) {
  const rule = contextRuleFor(route)
  if (!rule || isModuleInContext(route, country)) return null
  const where = rule.countries.join(', ')
  return {
    reason: rule.reason,
    availableIn: rule.countries,
    // Never states or implies that the module is broken or forbidden.
    hint: `Available in ${where}. Switch your working location, or use All countries to see everything.`,
    why: rule.why,
  }
}

/** Routes carrying a rule, for the admin surface and for tests. */
export const CONTEXT_RULE_ROUTES = Object.freeze(Object.keys(CONTEXT_RULES))
