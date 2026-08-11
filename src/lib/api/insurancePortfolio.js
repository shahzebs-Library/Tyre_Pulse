/**
 * Insurance Portfolio service - the I/O half of the insurance intelligence
 * layer (the maths lives in the PURE `src/lib/insurancePortfolio.js`, the
 * linking in `src/lib/insuranceMatch.js`; do not re-derive either here).
 *
 * Reads the V526 tables (insurance_policy_assets / insurance_property_risks /
 * insurance_claim_register / insurance_loss_runs) plus vehicle_fleet and
 * accidents, and offers ONE writer that persists resolved claim -> asset links
 * back onto the register.
 *
 * Conventions per `_client.js`: explicit column lists (never SELECT *),
 * null-safe country scoping, `fetchAllPages` with a hard `max` and a unique
 * order tiebreak, a table that is not provisioned degrades to [] rather than
 * failing, and no raw database error ever reaches a caller.
 *
 * NOTE ON READ PERMISSIONS: insurance_claim_register is app_is_elevated() only,
 * because it carries driver national IDs. A non-elevated reader gets an RLS
 * denial, which is surfaced here as an empty list plus an error message - it is
 * NOT silently reported as "no claims", which would read as a clean loss record.
 */
import { supabase, applyCountry, fetchAllPages, isMissingRelation } from './_client'
import { toUserMessage } from '../safeError'
import { buildFleetIndex, matchToAsset, linkClaimToAccident, MIN_CONFIDENT_MATCH } from '../insuranceMatch'
import { buildInsurancePortfolio } from '../insurancePortfolio'

/** Ceiling on any single read. Well above the real document set (~59 claims,
 *  a few thousand schedule lines); a runaway table is truncated, not fetched. */
const MAX_ROWS = 20000

const SCHEDULE_COLS =
  'id,country,policy_id,policy_no,cover_type,asset_no,plate_no,chassis_no,description,make,model_year,sum_insured,premium,currency,location,site,cover_from,cover_to,status,certificate_no,source_file,match_method'

const PROPERTY_COLS =
  'id,country,policy_id,policy_no,risk_id,location_name,site,city,gps_lat,gps_lng,building_age,floors,item_no,item_description,quantity,total_value,premium,currency,status,cover_description,period_from,period_to'

/**
 * Claim-register columns. `driver_id` is a national ID and is DELIBERATELY not
 * selected - no metric in this module needs it, and a column that is never read
 * cannot be leaked into an export or a chart tooltip. `nationality` is likewise
 * omitted: see the engine's note on why it is not a metric.
 */
const CLAIM_COLS =
  'id,country,claim_no,sub_claim_no,intimation_date,accident_date,policy_no,policy_id,uw_year,claim_type,cause_of_loss,estimate_payment,paid_amount,outstanding_amount,currency,make,chassis_no,plate_no,claim_city,driver_name,claim_source,survey_no,asset_no,accident_id,match_method,match_confidence'

const LOSS_RUN_COLS =
  'id,country,policy_no,policy_id,cover_type,policy_year,period_from,period_to,month_no,month_label,paid_count,paid_amount,outstanding_count,outstanding_amount,salvage_received,salvage_receivable,sum_insured,premium,currency,is_total,report_date'

/** Only the fleet fields the matcher and the groupings actually need. */
const FLEET_COLS =
  'id,asset_no,country,site,chassis_no,vin,registration_no,vehicle_type,asset_category,make,model,status,is_active'

/** Accident fields needed to reconcile against the register. */
const ACCIDENT_COLS = 'id,asset_no,country,incident_date,claim_amount,insurance_claim_no,policy_no,plate_number,site'

function ok(data) { return { data, error: null } }
function fail(e, fallback, empty = []) {
  if (isMissingRelation(e)) return { data: empty, error: null }
  return { data: empty, error: toUserMessage(e, fallback) }
}

/**
 * Paged read helper. Orders by the given column WITH an `id` tiebreak - paging
 * on a non-unique key drops or repeats rows at a page boundary.
 */
async function pagedList(table, cols, { country, orderBy = 'id' } = {}) {
  const { data, error } = await fetchAllPages(
    (from, to) => {
      let q = supabase.from(table).select(cols).order(orderBy, { ascending: true }).order('id', { ascending: true })
      q = applyCountry(q, country)
      return q.range(from, to)
    },
    { max: MAX_ROWS },
  )
  if (error) throw error
  return Array.isArray(data) ? data : []
}

/** Per-machine insurance schedule lines (CMI / TPL / CPM / PAR). */
export async function listPolicyAssets({ country } = {}) {
  try {
    return ok(await pagedList('insurance_policy_assets', SCHEDULE_COLS, { country, orderBy: 'policy_no' }))
  } catch (e) { return fail(e, 'Could not load the insurance schedule.') }
}

/** Property / plant risk schedule rows. */
export async function listPropertyRisks({ country } = {}) {
  try {
    return ok(await pagedList('insurance_property_risks', PROPERTY_COLS, { country, orderBy: 'policy_no' }))
  } catch (e) { return fail(e, 'Could not load the property risk schedule.') }
}

/** The insurer's claim register (elevated read - carries personal data). */
export async function listClaimRegister({ country } = {}) {
  try {
    return ok(await pagedList('insurance_claim_register', CLAIM_COLS, { country, orderBy: 'accident_date' }))
  } catch (e) { return fail(e, 'Could not load the claim register.') }
}

/** The insurer's monthly loss runs. */
export async function listLossRuns({ country } = {}) {
  try {
    return ok(await pagedList('insurance_loss_runs', LOSS_RUN_COLS, { country, orderBy: 'policy_no' }))
  } catch (e) { return fail(e, 'Could not load the loss runs.') }
}

/** Fleet register rows used as the matching target. */
export async function listFleetForInsurance({ country } = {}) {
  try {
    return ok(await pagedList('vehicle_fleet', FLEET_COLS, { country, orderBy: 'asset_no' }))
  } catch (e) { return fail(e, 'Could not load the fleet register.') }
}

/** Accidents used for the claim reconciliation gap. */
export async function listAccidentsForInsurance({ country } = {}) {
  try {
    return ok(await pagedList('accidents', ACCIDENT_COLS, { country, orderBy: 'incident_date' }))
  } catch (e) { return fail(e, 'Could not load accidents.') }
}

/**
 * Load everything and compose the portfolio through the pure engine.
 *
 * Every source is read independently and a failing one degrades to [] with its
 * reason collected in `sourceErrors` - one table an org has not provisioned
 * must not blank the whole screen, and a partial view has to SAY it is partial
 * rather than presenting a short list as the full picture.
 */
export async function loadInsurancePortfolio({ country, now = Date.now(), renewalDays } = {}) {
  try {
    const [schedule, property, claims, lossRuns, fleet, accidents] = await Promise.all([
      listPolicyAssets({ country }),
      listPropertyRisks({ country }),
      listClaimRegister({ country }),
      listLossRuns({ country }),
      listFleetForInsurance({ country }),
      listAccidentsForInsurance({ country }),
    ])

    const sourceErrors = {}
    for (const [key, res] of Object.entries({ schedule, property, claims, lossRuns, fleet, accidents })) {
      if (res.error) sourceErrors[key] = res.error
    }

    const portfolio = buildInsurancePortfolio({
      fleet: fleet.data,
      schedule: schedule.data,
      claims: claims.data,
      lossRuns: lossRuns.data,
      propertyRisks: property.data,
      accidents: accidents.data,
      country,
      now,
      renewalDays,
    })

    return ok({
      ...portfolio,
      sources: {
        schedule: schedule.data,
        property: property.data,
        claims: claims.data,
        lossRuns: lossRuns.data,
        fleet: fleet.data,
        accidents: accidents.data,
      },
      sourceErrors,
      complete: Object.keys(sourceErrors).length === 0,
    })
  } catch (e) {
    return { data: null, error: toUserMessage(e, 'Could not load the insurance portfolio.') }
  }
}

/* ------------------------------------------------------------------ *
 * Match persistence
 * ------------------------------------------------------------------ */

/**
 * Auto-written matches carry this prefix on `match_method`.
 *
 * It is what makes the write REVERSIBLE and safe: `clearClaimMatches` only ever
 * clears rows whose method starts with it, so a link a human set by hand can
 * never be wiped by an automated undo. A method with no prefix is somebody's
 * decision and outranks this process.
 */
export const AUTO_MATCH_PREFIX = 'auto:'

/** Is this row's current link one this process wrote (and may therefore alter)? */
export function isAutoMatch(row) {
  return typeof row?.match_method === 'string' && row.match_method.startsWith(AUTO_MATCH_PREFIX)
}

/**
 * Resolve every claim in the register against the fleet and the accident log,
 * WITHOUT writing anything. This is the preview: the caller sees exactly which
 * rows would change and how confidently before any of it is committed.
 *
 * @returns {{data: {proposals: Array, skipped: Array, summary: object}, error: null|string}}
 */
export function planClaimMatches({ claims = [], fleet = [], accidents = [], country, minConfidence = MIN_CONFIDENT_MATCH } = {}) {
  const index = buildFleetIndex(fleet, { country })
  const proposals = []
  const skipped = []

  for (const claim of Array.isArray(claims) ? claims : []) {
    const assetMatch = matchToAsset(claim, index)
    const accMatch = linkClaimToAccident(claim, accidents)
    const asset_no = assetMatch.confidence >= minConfidence ? assetMatch.asset_no : null
    const accident_id = accMatch.confidence >= minConfidence ? accMatch.accident_id || null : null

    if (!asset_no && !accident_id) {
      skipped.push({ id: claim.id, claim_no: claim.claim_no, reason: assetMatch.reason || assetMatch.method })
      continue
    }
    // A human-set link is never overwritten by a machine one.
    if (claim.match_method && !isAutoMatch(claim)) {
      skipped.push({ id: claim.id, claim_no: claim.claim_no, reason: 'manually_matched' })
      continue
    }
    const method = `${AUTO_MATCH_PREFIX}${assetMatch.method}${accident_id ? `+${accMatch.method}` : ''}`
    const confidence = Math.min(
      asset_no ? assetMatch.confidence : 1,
      accident_id ? accMatch.confidence : 1,
    )
    // Idempotent: a row already carrying exactly this link is not rewritten.
    const unchanged =
      (claim.asset_no || null) === asset_no &&
      (claim.accident_id || null) === accident_id &&
      claim.match_method === method
    if (unchanged) {
      skipped.push({ id: claim.id, claim_no: claim.claim_no, reason: 'already_current' })
      continue
    }
    proposals.push({ id: claim.id, claim_no: claim.claim_no, asset_no, accident_id, match_method: method, match_confidence: confidence })
  }

  return ok({
    proposals,
    skipped,
    summary: {
      total: (claims || []).length,
      toWrite: proposals.length,
      skipped: skipped.length,
      minConfidence,
    },
  })
}

/**
 * Commit the proposals from `planClaimMatches` onto insurance_claim_register.
 *
 * Only confident matches are written (the plan has already filtered them), each
 * row is updated by primary key so the write cannot spill onto a neighbour, and
 * re-running is a no-op because the plan drops rows that already carry the same
 * link. Failures are collected per row rather than aborting the batch - one bad
 * row must not discard the other fifty-eight.
 *
 * @param {Array} proposals rows from planClaimMatches().data.proposals
 */
export async function persistClaimMatches(proposals = []) {
  const list = Array.isArray(proposals) ? proposals : []
  if (list.length === 0) return ok({ updated: 0, failed: [] })
  let updated = 0
  const failed = []
  for (const p of list) {
    if (!p?.id) { failed.push({ id: null, error: 'Row has no id.' }); continue }
    try {
      const { error } = await supabase
        .from('insurance_claim_register')
        .update({
          asset_no: p.asset_no ?? null,
          accident_id: p.accident_id ?? null,
          match_method: p.match_method,
          match_confidence: p.match_confidence,
        })
        .eq('id', p.id)
      if (error) throw error
      updated += 1
    } catch (e) {
      failed.push({ id: p.id, error: toUserMessage(e, 'Could not save this match.') })
    }
  }
  // Reports every outcome separately: "50 saved" is only ever said when fifty
  // actually saved.
  return ok({ updated, failed, attempted: list.length })
}

/**
 * Undo: clear the links this process wrote. Rows whose `match_method` was set
 * by a person are left untouched (see AUTO_MATCH_PREFIX), so the undo can never
 * destroy a human decision.
 *
 * @param {string[]} [ids] restrict to these register rows; omit for all auto rows.
 */
export async function clearClaimMatches(ids) {
  try {
    let q = supabase
      .from('insurance_claim_register')
      .update({ asset_no: null, accident_id: null, match_method: null, match_confidence: null })
      .like('match_method', `${AUTO_MATCH_PREFIX}%`)
    if (Array.isArray(ids) && ids.length > 0) q = q.in('id', ids)
    const { error } = await q
    if (error) throw error
    return ok({ cleared: true })
  } catch (e) {
    if (isMissingRelation(e)) return ok({ cleared: false })
    return { data: null, error: toUserMessage(e, 'Could not clear the saved matches.') }
  }
}
