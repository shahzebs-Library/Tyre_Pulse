/**
 * insuranceKnowledge.js - PURE reasoning engine for the Insurance Policy
 * knowledge base (no I/O, no React, no Supabase). It turns fleet insurance
 * policy CONDITIONS into concrete claim assessments:
 *
 *   - assessClaim(conditions, ctx) explains WHY a claim would be rejected or
 *     delayed, citing the exact seeded policy condition (policy no + clause).
 *   - totalLossAssessment(...) decides constructive total loss from repair cost
 *     vs the policy's total-loss threshold.
 *
 * Everything is ASCII only and honest about missing data (null, never a
 * fabricated 0). Matching is generic: a check only fires when a relevant
 * condition exists in `conditions`, matched by category (+ keywords when
 * available) so it keeps working as an admin edits the seeded clauses.
 */

// ── Label maps (single source for the UI) ─────────────────────────────────────
export const POLICY_TYPE_LABELS = {
  motor_comprehensive: 'Motor Comprehensive',
  plant_equipment: 'Plant & Equipment',
  motor_tpl: 'Motor Third-Party Liability',
  property: 'Property',
  other: 'Other',
}

export const CONDITION_CATEGORY_LABELS = {
  claim_process: 'Claim Process',
  driver: 'Driver',
  total_loss: 'Total Loss',
  theft: 'Theft',
  deductible: 'Deductible',
  coverage: 'Coverage',
  exclusion: 'Exclusion',
  value: 'Value',
  other: 'Other',
}

/** Honest-null number coercion: '', null, undefined, NaN -> null. */
export function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── Condition matching ────────────────────────────────────────────────────────
const lc = (v) => String(v == null ? '' : v).toLowerCase()

/** True when a condition matches ANY of the given keyword fragments. */
function conditionMatchesKeywords(cond, keywords) {
  if (!keywords || keywords.length === 0) return true
  const hay = [lc(cond.clause_text), ...(Array.isArray(cond.keywords) ? cond.keywords.map(lc) : [])].join(' | ')
  return keywords.some((k) => hay.includes(lc(k)))
}

/**
 * Find the most relevant condition for a check. Prefers a condition matching
 * the category AND a keyword; falls back to a category-only match so a check
 * still cites its policy when the clause wording is edited. Returns null when
 * no condition in that category exists (so the check emits nothing).
 */
function findCondition(conditions, categories, keywords) {
  const cats = Array.isArray(categories) ? categories : [categories]
  const inCat = (conditions || []).filter((c) => c && cats.includes(c.category))
  if (inCat.length === 0) return null
  return inCat.find((c) => conditionMatchesKeywords(c, keywords)) || inCat[0]
}

function policyNoOf(cond, ctx) {
  return cond.policy_no ?? cond.policyNo ?? ctx?.policyNo ?? null
}

function makeFinding(severity, title, reason, cond, ctx) {
  return {
    severity,
    title,
    reason,
    policyNo: policyNoOf(cond, ctx),
    conditionSeq: cond.seq ?? null,
    clauseText: cond.clause_text || '',
    category: cond.category || 'other',
  }
}

const SEVERITY_RANK = { reject: 0, delay: 1, info: 2 }

/**
 * Assess a claim scenario against a policy's conditions.
 *
 * @param {Array} conditions  the policy's insurance_policy_conditions rows
 *                            (ideally enriched with policy_no by the caller).
 * @param {object} ctx        operator-supplied flags:
 *   repairedBeforeApproval, driverLicenceValid, driverAge, vehicleCommercial,
 *   authorizedDriver, stolen, originalKeysHandedOver, reportedToPolice,
 *   thirdPartyFaultPct, outsideKsa, repairCost, insuredValue
 * @returns {Array} findings sorted reject > delay > info.
 */
export function assessClaim(conditions, ctx = {}) {
  const conds = Array.isArray(conditions) ? conditions : []
  const findings = []
  const c = ctx || {}

  // 1) Repair carried out before the insurer approved the estimate -> rejection.
  if (c.repairedBeforeApproval === true) {
    const cond = findCondition(conds, ['claim_process', 'exclusion'], ['approval', 'approve', 'repair', 'prior', 'before'])
    if (cond) {
      findings.push(makeFinding(
        'reject',
        'Repair started before insurer approval',
        'The vehicle was repaired before the insurer approved the estimate, which voids the claim under the claim-process condition.',
        cond, c,
      ))
    }
  }

  // 2) Driver licence / minimum-age eligibility -> rejection.
  const age = num(c.driverAge)
  const commercial = c.vehicleCommercial === true
  const ageFloor = commercial ? 25 : 21
  const licenceInvalid = c.driverLicenceValid === false
  const underAge = age != null && age < ageFloor
  if (licenceInvalid || underAge) {
    const cond = findCondition(conds, ['driver'], ['licence', 'license', 'age', '25', '21', 'valid'])
    if (cond) {
      const why = licenceInvalid
        ? 'The driver did not hold a valid licence at the time of the incident.'
        : `The driver was ${age} years old, below the ${ageFloor}-year minimum for a ${commercial ? 'commercial' : 'private'} vehicle.`
      findings.push(makeFinding(
        'reject',
        'Driver eligibility not met',
        `${why} The claim is rejected under the driver condition.`,
        cond, c,
      ))
    }
  }

  // 3) Unauthorized driver -> rejection.
  if (c.authorizedDriver === false) {
    const cond = findCondition(conds, ['driver', 'coverage', 'exclusion'], ['authoriz', 'permission', 'permitted', 'authorised'])
    if (cond) {
      findings.push(makeFinding(
        'reject',
        'Driver not authorized',
        'The vehicle was operated by a driver not authorized under the policy, so cover does not apply.',
        cond, c,
      ))
    }
  }

  // 4) Theft without original keys / police report -> rejection.
  if (c.stolen === true && (c.originalKeysHandedOver === false || c.reportedToPolice === false)) {
    const cond = findCondition(conds, ['theft', 'coverage', 'exclusion'], ['theft', 'stolen', 'keys', 'police'])
    if (cond) {
      const missing = []
      if (c.originalKeysHandedOver === false) missing.push('the original keys were not handed over')
      if (c.reportedToPolice === false) missing.push('the theft was not reported to the police')
      findings.push(makeFinding(
        'reject',
        'Theft claim requirement not met',
        `The vehicle was stolen but ${missing.join(' and ')}. The theft condition is not satisfied.`,
        cond, c,
      ))
    }
  }

  // 5) Third-party fault below 100 percent -> delay (deductible on conviction %, awaiting NAJM).
  const tpFault = num(c.thirdPartyFaultPct)
  if (tpFault != null && tpFault < 100) {
    const cond = findCondition(conds, ['deductible', 'claim_process'], ['deductible', 'fault', 'najm', 'conviction', 'liability'])
    if (cond) {
      findings.push(makeFinding(
        'delay',
        'Deductible applies pending fault confirmation',
        `Third-party fault is ${tpFault}%, so a deductible applies on the convicted share and settlement waits on the NAJM report.`,
        cond, c,
      ))
    }
  }

  // 6) Incident outside KSA -> informational (deductible + depreciation apply).
  if (c.outsideKsa === true) {
    const cond = findCondition(conds, ['coverage', 'deductible', 'exclusion'], ['outside', 'ksa', 'geograph', 'territor', 'depreciat'])
    if (cond) {
      findings.push(makeFinding(
        'info',
        'Incident outside KSA',
        'The incident occurred outside KSA, so the applicable deductible and depreciation apply to any settlement.',
        cond, c,
      ))
    }
  }

  return findings.sort((x, y) => (SEVERITY_RANK[x.severity] ?? 9) - (SEVERITY_RANK[y.severity] ?? 9))
}

/**
 * Constructive total-loss assessment: total loss when repair cost exceeds
 * (thresholdPct / 100) * insured value. Returns honest nulls when inputs are
 * missing so the UI shows N/A rather than a fabricated verdict.
 *
 * @returns {{isTotalLoss:(boolean|null), thresholdValue:(number|null), ratioPct:(number|null), note:string}}
 */
export function totalLossAssessment({ repairCost, insuredValue, thresholdPct } = {}) {
  const repair = num(repairCost)
  const insured = num(insuredValue)
  const pct = num(thresholdPct)

  if (repair == null || insured == null || insured <= 0 || pct == null) {
    return {
      isTotalLoss: null,
      thresholdValue: pct != null && insured != null && insured > 0 ? (pct / 100) * insured : null,
      ratioPct: null,
      note: 'Enter repair cost, insured value and a total-loss threshold to assess constructive total loss.',
    }
  }

  const thresholdValue = (pct / 100) * insured
  const ratioPct = Math.round((repair / insured) * 1000) / 10
  const isTotalLoss = repair > thresholdValue
  const note = isTotalLoss
    ? `Repair cost is ${ratioPct}% of insured value, above the ${pct}% total-loss threshold. Treat as a constructive total loss.`
    : `Repair cost is ${ratioPct}% of insured value, within the ${pct}% total-loss threshold. Repair, not a total loss.`

  return { isTotalLoss, thresholdValue, ratioPct, note }
}
